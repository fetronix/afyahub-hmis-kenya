/**
 * Bank integration contract and statement parsing primitives.
 *
 * No live bank connector or transfer API is registered. Imported statements
 * and staff matches must never be described as bank-confirmed activity.
 */
import { createHash } from 'node:crypto';
import { centsToKes, parseKesToCents, requireIsoDate } from './accounting.service.ts';

export interface BankConnector {
  readonly bankCode: string;
  fetchStatement(input: {
    facilityId: number;
    accountId: number;
    from: string;
    to: string;
  }): Promise<
    | { status: 'UNAVAILABLE'; reason: string }
    | { status: 'RECEIVED'; sourceReference: string; lines: StatementLine[] }
  >;
}

/** Default is explicitly unavailable; adding credentials alone enables nothing. */
export class UnconfiguredBankConnector implements BankConnector {
  readonly bankCode = 'UNCONFIGURED';
  async fetchStatement(): Promise<{ status: 'UNAVAILABLE'; reason: string }> {
    return { status: 'UNAVAILABLE', reason: 'No authorized live bank connector is configured.' };
  }
}

export type BankDirection = 'INFLOW' | 'OUTFLOW';
export interface StatementLine {
  transactionDate: string;
  referenceNumber: string;
  description: string;
  direction: BankDirection;
  amountKes: string;
}

export class BankStatementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BankStatementError';
  }
}

/** RFC-style CSV fields, including quoted commas/newlines and escaped quotes. */
function readCsv(text: string): string[][] {
  if (text.length > 1_000_000)
    throw new BankStatementError('STATEMENT_TOO_LARGE', 'Statement exceeds the allowed size.');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        afterQuote = true;
      } else field += c;
    } else if (c === '"' && field === '' && !afterQuote) quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
      afterQuote = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      afterQuote = false;
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      if (afterQuote && !/\s/.test(c))
        throw new BankStatementError('INVALID_CSV', 'Malformed quoted CSV field.');
      if (!afterQuote) field += c;
    }
  }
  if (quoted) throw new BankStatementError('INVALID_CSV', 'Unclosed quoted CSV field.');
  if (field || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  if (rows.length < 2 || rows.length > 5001)
    throw new BankStatementError('INVALID_CSV', 'Statement requires a header and 1–5000 lines.');
  return rows;
}

/** Required, bank-independent columns: date, reference, description, direction, amount. */
export function parseBankStatementCsv(text: string): StatementLine[] {
  const [head, ...rows] = readCsv(text);
  const headers = head.map((v) => v.trim().toLowerCase());
  const fields = ['date', 'reference', 'description', 'direction', 'amount'];
  if (new Set(headers).size !== headers.length || fields.some((v) => !headers.includes(v))) {
    throw new BankStatementError(
      'INVALID_CSV_COLUMNS',
      'Required unique columns: date, reference, description, direction, amount.',
    );
  }
  const index = Object.fromEntries(fields.map((f) => [f, headers.indexOf(f)]));
  return rows.map((row, offset) => {
    if (row.length !== headers.length)
      throw new BankStatementError(
        'INVALID_CSV_ROW',
        `Invalid number of fields on row ${offset + 2}.`,
      );
    const date = row[index.date].trim();
    const ref = row[index.reference].trim();
    const description = row[index.description].trim();
    const direction = row[index.direction].trim().toUpperCase();
    if (
      !ref ||
      ref.length > 160 ||
      !description ||
      description.length > 500 ||
      !['INFLOW', 'OUTFLOW'].includes(direction)
    ) {
      throw new BankStatementError(
        'INVALID_CSV_ROW',
        `Invalid transaction details on row ${offset + 2}.`,
      );
    }
    let cents: bigint;
    try {
      requireIsoDate(date);
      cents = parseKesToCents(row[index.amount]);
    } catch {
      throw new BankStatementError(
        'INVALID_CSV_ROW',
        `Invalid date or amount on row ${offset + 2}.`,
      );
    }
    if (cents <= 0n)
      throw new BankStatementError(
        'INVALID_CSV_ROW',
        `Amount must be positive on row ${offset + 2}.`,
      );
    return {
      transactionDate: date,
      referenceNumber: ref,
      description,
      direction: direction as BankDirection,
      amountKes: centsToKes(cents),
    };
  });
}

export function statementFingerprint(accountId: number, lines: StatementLine[]): string {
  return createHash('sha256').update(JSON.stringify({ accountId, lines })).digest('hex');
}

/** Compute a worksheet only. A zero difference is not proof of a live bank feed. */
export function calculateReconciliation(input: {
  statementBalanceCents: bigint;
  ledgerBalanceCents: bigint;
  unmatchedLedgerInflowsCents: bigint;
  unmatchedLedgerOutflowsCents: bigint;
  unmatchedStatementInflowsCents: bigint;
  unmatchedStatementOutflowsCents: bigint;
}) {
  const adjustedBank =
    input.statementBalanceCents +
    input.unmatchedLedgerInflowsCents -
    input.unmatchedLedgerOutflowsCents;
  const adjustedLedger =
    input.ledgerBalanceCents +
    input.unmatchedStatementInflowsCents -
    input.unmatchedStatementOutflowsCents;
  return {
    adjustedBankKes: centsToKes(adjustedBank),
    adjustedLedgerKes: centsToKes(adjustedLedger),
    differenceKes: centsToKes(adjustedBank - adjustedLedger),
    worksheetBalanced: adjustedBank === adjustedLedger,
    bankConfirmed: false,
  };
}

// Database-backed import and matching. They are separate from live banking.
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import type { AccountingScope } from './accounting.service.ts';

function required(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new BankStatementError(
      'INVALID_INPUT',
      `${name} is required and must be at most ${max} characters.`,
    );
  return value.trim();
}
function id(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new BankStatementError('INVALID_INPUT', `${name} must be a positive integer.`);
  return n;
}
function signedCents(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new BankStatementError('INVALID_AMOUNT', 'Invalid statement balance.');
  const s = String(value).trim();
  try {
    return s.startsWith('-') ? -parseKesToCents(s.slice(1)) : parseKesToCents(s);
  } catch {
    throw new BankStatementError('INVALID_AMOUNT', 'Invalid statement balance.');
  }
}
async function transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
async function audit(
  c: PoolClient,
  scope: AccountingScope,
  action: string,
  resource: string,
  resourceId: number,
  details: object = {},
) {
  await c.query(
    'INSERT INTO audit_logs (tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      action,
      resource,
      String(resourceId),
      JSON.stringify(details),
    ],
  );
}

export async function createBankAccountScoped(
  scope: AccountingScope,
  input: Record<string, unknown>,
) {
  const name = required(input.accountName, 'Account name', 160),
    bankCode = required(input.bankCode, 'Bank code', 80),
    bankName = required(input.bankName, 'Bank name', 160),
    glAccountId = id(input.glAccountId, 'GL account');
  const last4 =
    input.accountLastFour == null || input.accountLastFour === ''
      ? null
      : required(input.accountLastFour, 'Account last four digits', 4);
  if (last4 && !/^\d{4}$/.test(last4))
    throw new BankStatementError(
      'INVALID_ACCOUNT_MASK',
      'Provide only the last four digits, not a full account number.',
    );
  try {
    return await transaction(async (c) => {
      const account = await c.query(
        "SELECT id FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND account_type='ASSET' AND normal_balance='DEBIT' AND is_active=true FOR SHARE",
        [glAccountId, scope.tenantId, scope.facilityId],
      );
      if (!account.rows.length)
        throw new BankStatementError(
          'INVALID_BANK_GL_ACCOUNT',
          'Bank account must use an active debit-normal asset account in this facility.',
        );
      const row = await c.query(
        `INSERT INTO bank_accounts (tenant_id,facility_id,account_name,bank_code,bank_name,account_number_masked,gl_account_id,connector_mode,connector_config) VALUES ($1,$2,$3,$4,$5,$6,$7,'STATEMENT_IMPORT_ONLY','{}'::jsonb) RETURNING id,account_name AS "accountName",bank_code AS "bankCode",account_number_masked AS "accountNumberMasked",gl_account_id AS "glAccountId",connector_mode AS "connectorMode"`,
        [
          scope.tenantId,
          scope.facilityId,
          name,
          bankCode,
          bankName,
          last4 ? `****${last4}` : null,
          glAccountId,
        ],
      );
      await audit(c, scope, 'CREATE', 'bank_account', row.rows[0].id);
      return row.rows[0];
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new BankStatementError(
        'BANK_ACCOUNT_CONFLICT',
        'Name or ledger account is already in use.',
      );
    throw e;
  }
}

export async function importStatementScoped(
  scope: AccountingScope,
  accountId: number,
  input: Record<string, unknown>,
) {
  id(accountId, 'Bank account');
  const start = requireIsoDate(input.startDate),
    end = requireIsoDate(input.endDate);
  if (start > end)
    throw new BankStatementError('INVALID_RANGE', 'Start date must not be after end date.');
  const closing = centsToKes(signedCents(input.closingBalanceKes));
  const csv = required(input.csvText, 'CSV statement', 1_000_000),
    lines = parseBankStatementCsv(csv);
  if (lines.some((line) => line.transactionDate < start || line.transactionDate > end))
    throw new BankStatementError(
      'STATEMENT_DATE_OUT_OF_RANGE',
      'Every line must fall inside the statement date range.',
    );
  const fileHash = createHash('sha256')
    .update(JSON.stringify({ accountId, start, end, closing, lines }))
    .digest('hex');
  try {
    return await transaction(async (c) => {
      const account = await c.query(
        'SELECT id FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND is_active=true FOR UPDATE',
        [accountId, scope.tenantId, scope.facilityId],
      );
      if (!account.rows.length)
        throw new BankStatementError('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found.');
      const prior = await c.query(
        'SELECT id FROM bank_statement_imports WHERE bank_account_id=$1 AND file_hash=$2',
        [accountId, fileHash],
      );
      if (prior.rows.length)
        return {
          statementImportId: prior.rows[0].id,
          idempotentReplay: true,
          lineCount: lines.length,
        };
      const row = await c.query(
        `INSERT INTO bank_statement_imports (tenant_id,facility_id,bank_account_id,import_reference,source_type,statement_start_date,statement_end_date,closing_balance_kes,line_count,file_hash,imported_by_user_id) VALUES ($1,$2,$3,$4,'CSV_IMPORT',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          scope.tenantId,
          scope.facilityId,
          accountId,
          `STMT-${fileHash.slice(0, 16)}`,
          start,
          end,
          closing,
          lines.length,
          fileHash,
          scope.actorUserId,
        ],
      );
      for (const line of lines) {
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify({
              date: line.transactionDate,
              reference: line.referenceNumber,
              direction: line.direction,
              amount: line.amountKes,
            }),
          )
          .digest('hex');
        await c.query(
          `INSERT INTO bank_transactions (tenant_id,facility_id,bank_account_id,statement_import_id,transaction_date,reference_number,description,direction,amount_kes,origin_classification,match_status,dedupe_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IMPORTED_STATEMENT','UNMATCHED',$10)`,
          [
            scope.tenantId,
            scope.facilityId,
            accountId,
            row.rows[0].id,
            line.transactionDate,
            line.referenceNumber,
            line.description,
            line.direction,
            line.amountKes,
            fingerprint,
          ],
        );
      }
      await audit(c, scope, 'IMPORT', 'bank_statement_import', row.rows[0].id, {
        lineCount: lines.length,
        source: 'IMPORTED_STATEMENT',
      });
      return {
        statementImportId: row.rows[0].id,
        idempotentReplay: false,
        lineCount: lines.length,
      };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new BankStatementError(
        'DUPLICATE_STATEMENT_LINE',
        'An identical transaction has already been imported; review the overlapping statement.',
      );
    throw e;
  }
}

export async function matchBankTransactionScoped(
  scope: AccountingScope,
  transactionId: number,
  journalLineId: number,
) {
  id(transactionId, 'Bank transaction');
  id(journalLineId, 'Journal line');
  try {
    return await transaction(async (c) => {
      const entry = await c.query(
        `SELECT t.*,a.gl_account_id FROM bank_transactions t JOIN bank_accounts a ON a.id=t.bank_account_id WHERE t.id=$1 AND t.tenant_id=$2 AND t.facility_id=$3 FOR UPDATE OF a,t`,
        [transactionId, scope.tenantId, scope.facilityId],
      );
      const bank = entry.rows[0];
      if (!bank)
        throw new BankStatementError(
          'BANK_TRANSACTION_NOT_FOUND',
          'Statement transaction not found.',
        );
      if (bank.matched_journal_line_id) {
        if (bank.matched_journal_line_id === journalLineId)
          return { transactionId, journalLineId, idempotentReplay: true };
        throw new BankStatementError('ALREADY_MATCHED', 'Transaction already has a match.');
      }
      const line = await c.query(
        `SELECT l.id,l.debit_cents,l.credit_cents,j.id AS journal_id FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE l.id=$1 AND l.account_id=$2 AND j.tenant_id=$3 AND j.facility_id=$4 AND j.status='POSTED' FOR SHARE OF l,j`,
        [journalLineId, bank.gl_account_id, scope.tenantId, scope.facilityId],
      );
      const l = line.rows[0];
      const amount = parseKesToCents(bank.amount_kes);
      if (
        !l ||
        (bank.direction === 'INFLOW'
          ? BigInt(l.debit_cents) !== amount || BigInt(l.credit_cents) !== 0n
          : BigInt(l.credit_cents) !== amount || BigInt(l.debit_cents) !== 0n)
      )
        throw new BankStatementError(
          'BANK_MATCH_MISMATCH',
          'Match must be a posted line on this bank account with the same amount and direction.',
        );
      await c.query(
        "UPDATE bank_transactions SET matched_journal_line_id=$1,matched_journal_entry_id=$2,match_status='MATCHED',matched_by_user_id=$3,matched_at=now() WHERE id=$4",
        [journalLineId, l.journal_id, scope.actorUserId, transactionId],
      );
      await audit(c, scope, 'MATCH', 'bank_transaction', transactionId, {
        journalLineId,
        origin: 'IMPORTED_STATEMENT',
      });
      return { transactionId, journalLineId, idempotentReplay: false };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new BankStatementError(
        'JOURNAL_LINE_ALREADY_MATCHED',
        'Journal line is already matched to another statement transaction.',
      );
    throw e;
  }
}

async function worksheet(
  c: PoolClient,
  scope: AccountingScope,
  accountId: number,
  statementId: number,
) {
  const row = await c.query(
    `SELECT a.gl_account_id,s.statement_end_date,s.closing_balance_kes FROM bank_accounts a JOIN bank_statement_imports s ON s.bank_account_id=a.id WHERE a.id=$1 AND a.tenant_id=$2 AND a.facility_id=$3 AND s.id=$4`,
    [accountId, scope.tenantId, scope.facilityId, statementId],
  );
  if (!row.rows.length)
    throw new BankStatementError(
      'STATEMENT_NOT_FOUND',
      'Statement not found for this facility and bank account.',
    );
  const { gl_account_id: gl, statement_end_date: end, closing_balance_kes: closing } = row.rows[0];
  const ledger = await c.query(
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0)::text AS balance FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE l.account_id=$1 AND j.facility_id=$2 AND j.tenant_id=$3 AND j.status='POSTED' AND j.entry_date <= $4::date`,
    [gl, scope.facilityId, scope.tenantId, end],
  );
  const unmatchedLedger = await c.query(
    `SELECT COALESCE(SUM(l.debit_cents),0)::text AS inflows,COALESCE(SUM(l.credit_cents),0)::text AS outflows FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE l.account_id=$1 AND j.facility_id=$2 AND j.tenant_id=$3 AND j.status='POSTED' AND j.entry_date <= $4::date AND NOT EXISTS (SELECT 1 FROM bank_transactions t WHERE t.matched_journal_line_id=l.id AND t.bank_account_id=$5 AND t.transaction_date::date <= $4::date)`,
    [gl, scope.facilityId, scope.tenantId, end, accountId],
  );
  const unmatchedStatements = await c.query(
    `SELECT direction,amount_kes FROM bank_transactions WHERE bank_account_id=$1 AND facility_id=$2 AND tenant_id=$3 AND transaction_date::date <= $4::date AND match_status='UNMATCHED'`,
    [accountId, scope.facilityId, scope.tenantId, end],
  );
  let statementIn = 0n,
    statementOut = 0n;
  for (const item of unmatchedStatements.rows) {
    if (item.direction === 'INFLOW') statementIn += parseKesToCents(item.amount_kes);
    else statementOut += parseKesToCents(item.amount_kes);
  }
  const calculated = calculateReconciliation({
    statementBalanceCents: signedCents(closing),
    ledgerBalanceCents: BigInt(ledger.rows[0].balance),
    unmatchedLedgerInflowsCents: BigInt(unmatchedLedger.rows[0].inflows),
    unmatchedLedgerOutflowsCents: BigInt(unmatchedLedger.rows[0].outflows),
    unmatchedStatementInflowsCents: statementIn,
    unmatchedStatementOutflowsCents: statementOut,
  });
  return {
    ...calculated,
    statementEndDate: end,
    statementBalanceKes: centsToKes(signedCents(closing)),
    ledgerBalanceKes: centsToKes(BigInt(ledger.rows[0].balance)),
    unmatchedLedgerInflowsKes: centsToKes(BigInt(unmatchedLedger.rows[0].inflows)),
    unmatchedLedgerOutflowsKes: centsToKes(BigInt(unmatchedLedger.rows[0].outflows)),
    unmatchedStatementCount: unmatchedStatements.rows.length,
    source: 'IMPORTED_STATEMENT' as const,
  };
}
export async function previewBankReconciliationScoped(
  scope: AccountingScope,
  accountId: number,
  statementId: number,
) {
  id(accountId, 'Bank account');
  id(statementId, 'Statement');
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return worksheet(c, scope, accountId, statementId);
  });
}
export async function saveBankReconciliationScoped(
  scope: AccountingScope,
  accountId: number,
  statementId: number,
  input: Record<string, unknown>,
) {
  id(accountId, 'Bank account');
  id(statementId, 'Statement');
  const key = required(input.idempotencyKey, 'Idempotency key', 128),
    periodCode = required(input.periodCode, 'Period code', 40),
    notes = required(input.reviewNotes, 'Review notes', 1000);
  try {
    return await transaction(async (c) => {
      const account = await c.query(
        'SELECT id FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
        [accountId, scope.tenantId, scope.facilityId],
      );
      if (!account.rows.length)
        throw new BankStatementError('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found.');
      const prior = await c.query(
        'SELECT id,statement_import_id,period_code FROM bank_reconciliations WHERE bank_account_id=$1 AND idempotency_key=$2',
        [accountId, key],
      );
      if (prior.rows.length) {
        if (
          prior.rows[0].statement_import_id !== statementId ||
          prior.rows[0].period_code !== periodCode
        )
          throw new BankStatementError(
            'IDEMPOTENCY_CONFLICT',
            'Key was already used for another reconciliation.',
          );
        return { reconciliationId: prior.rows[0].id, idempotentReplay: true };
      }
      const w = await worksheet(c, scope, accountId, statementId);
      if (!w.worksheetBalanced || w.unmatchedStatementCount > 0)
        throw new BankStatementError(
          'RECONCILIATION_INCOMPLETE',
          'The worksheet has a difference or unmatched statement transactions.',
        );
      const row = await c.query(
        `INSERT INTO bank_reconciliations (tenant_id,facility_id,bank_account_id,statement_import_id,idempotency_key,period_code,statement_ending_date,statement_ending_balance_kes,ledger_book_balance_kes,unmatched_deposits_kes,unmatched_withdrawals_kes,adjusted_difference_kes,status,reconciled_by_user_id,reconciled_at,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'REVIEWED_IMPORT',$13,now(),$14) RETURNING id`,
        [
          scope.tenantId,
          scope.facilityId,
          accountId,
          statementId,
          key,
          periodCode,
          w.statementEndDate,
          w.statementBalanceKes,
          w.ledgerBalanceKes,
          w.unmatchedLedgerInflowsKes,
          w.unmatchedLedgerOutflowsKes,
          w.differenceKes,
          scope.actorUserId,
          notes,
        ],
      );
      await audit(c, scope, 'REVIEW', 'bank_reconciliation', row.rows[0].id, {
        source: 'IMPORTED_STATEMENT',
        bankConfirmed: false,
      });
      return { reconciliationId: row.rows[0].id, idempotentReplay: false, worksheet: w };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new BankStatementError('IDEMPOTENCY_CONFLICT', 'Reconciliation key already exists.');
    throw e;
  }
}

export async function listBankWorkspaceScoped(scope: AccountingScope) {
  const [accounts, imports, transactions, reconciliations] = await Promise.all([
    pool.query(
      'SELECT id,account_name AS "accountName",bank_code AS "bankCode",bank_name AS "bankName",account_number_masked AS "accountNumberMasked",gl_account_id AS "glAccountId",connector_mode AS "connectorMode" FROM bank_accounts WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,bank_account_id AS "bankAccountId",statement_start_date AS "startDate",statement_end_date AS "endDate",closing_balance_kes AS "closingBalanceKes",line_count AS "lineCount" FROM bank_statement_imports WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 100',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,bank_account_id AS "bankAccountId",transaction_date AS date,reference_number AS reference,description,direction,amount_kes AS "amountKes",origin_classification AS origin,match_status AS "matchStatus",matched_journal_line_id AS "matchedJournalLineId" FROM bank_transactions WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 200',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,bank_account_id AS "bankAccountId",statement_import_id AS "statementImportId",status,adjusted_difference_kes AS "differenceKes" FROM bank_reconciliations WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 100',
      [scope.tenantId, scope.facilityId],
    ),
  ]);
  return {
    accounts: accounts.rows,
    imports: imports.rows,
    transactions: transactions.rows,
    reconciliations: reconciliations.rows,
    notice: 'Imported statements and staff matches are not live bank confirmation.',
  };
}
