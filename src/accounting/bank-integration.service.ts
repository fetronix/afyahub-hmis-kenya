/**
 * Bank integration contract and statement parsing primitives.
 *
 * No live bank connector or transfer API is registered. Imported statements
 * and staff matches must never be described as bank-confirmed activity.
 */
import { createHash } from 'node:crypto';
import { centsToKes, parseKesToCents, requireIsoDate } from './accounting.service.ts';
import { hasPostedJournalScopeMismatch } from './journal-scope-integrity.ts';

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
import { postJournalScoped, type AccountingScope } from './accounting.service.ts';

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
  if (await hasPostedJournalScopeMismatch(c, scope.tenantId, scope.facilityId))
    throw new BankStatementError(
      'LEDGER_SCOPE_INCONSISTENT',
      'Posted journal account scope is inconsistent. Finance review is required before reconciliation.',
      409,
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

/* -------------------------------------------------------------------------
 * Reconciliation operations: suggestions, investigation, unmatched reversal,
 * approval and reporting.
 *
 * WHY THESE LIVE HERE
 * -------------------
 * They read and write the same five tables as the import and matching code
 * above, under the same scope rules and the same audit helper. A separate
 * module would have had to duplicate `transaction`, `audit` and the scope
 * predicates, and two copies of a facility-scope check is how one of them ends
 * up subtly wrong.
 *
 * The worksheet in this file is the single source of truth for "do the ledger
 * and the bank agree". Everything below either feeds it or reads its result; no
 * function recalculates the reconciliation arithmetic independently.
 * ---------------------------------------------------------------------- */

/**
 * How much a candidate match is worth trusting, and why.
 *
 * Deliberately coarse. A score that pretends to be precise invites someone to
 * accept a suggestion without reading the reasons, and the reasons are the only
 * part a human can actually judge.
 */
export type MatchConfidence = 'EXACT' | 'STRONG' | 'WEAK';

export interface MatchSuggestion {
  journalLineId: number;
  journalEntryId: number;
  entryDate: string;
  reference: string | null;
  description: string | null;
  amountKes: string;
  direction: BankDirection;
  confidence: MatchConfidence;
  reasons: string[];
}

/** Normalise free text for comparison: case, spacing and punctuation ignored. */
function normaliseText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Suggest posted ledger lines that could explain a statement transaction.
 *
 * This only reads. Nothing is matched, and the caller still has to choose —
 * `matchBankTransactionScoped` is the only thing that writes a match, and it
 * re-validates amount, direction and account regardless of what was suggested
 * here. A suggestion is a hint for a human, never an authorisation.
 *
 * Ordering is by confidence and then by date, so the most likely candidate is
 * first without the list pretending to be ranked beyond that.
 */
export async function suggestMatchesForTransactionScoped(
  scope: AccountingScope,
  transactionId: number,
): Promise<{ transactionId: number; suggestions: MatchSuggestion[]; consideredCount: number }> {
  id(transactionId, 'Bank transaction');
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const found = await c.query(
      `SELECT t.id,t.bank_account_id,t.direction,t.amount_kes,t.reference_number,t.description,
              t.transaction_date,t.match_status,a.gl_account_id
         FROM bank_transactions t
         JOIN bank_accounts a ON a.id=t.bank_account_id
        WHERE t.id=$1 AND t.tenant_id=$2 AND t.facility_id=$3`,
      [transactionId, scope.tenantId, scope.facilityId],
    );
    const bank = found.rows[0];
    if (!bank)
      throw new BankStatementError(
        'BANK_TRANSACTION_NOT_FOUND',
        'Statement transaction not found.',
      );

    /*
     * Only lines on this bank's GL account, posted, with the same amount facing
     * the same way. Anything else cannot be a legal match — the matching
     * function would refuse it — so suggesting it would waste the operator's
     * time and imply it might be acceptable.
     */
    const candidates = await c.query(
      `SELECT l.id AS journal_line_id,j.id AS journal_entry_id,
              j.entry_date::date::text AS entry_date,
              j.journal_number AS reference,j.description,l.debit_cents,l.credit_cents
         FROM journal_lines l
         JOIN journal_entries j ON j.id=l.journal_entry_id
        WHERE l.account_id=$1
          AND j.tenant_id=$2 AND j.facility_id=$3
          AND j.status='POSTED'
          AND (($4='INFLOW'  AND l.debit_cents =$5 AND l.credit_cents=0)
            OR ($4='OUTFLOW' AND l.credit_cents=$5 AND l.debit_cents=0))
          AND NOT EXISTS (
            SELECT 1 FROM bank_transactions m
             WHERE m.matched_journal_line_id=l.id AND m.bank_account_id=$6
          )
        ORDER BY abs(j.entry_date::date - $7::date), j.id
        LIMIT 25`,
      [
        bank.gl_account_id,
        scope.tenantId,
        scope.facilityId,
        bank.direction,
        parseKesToCents(bank.amount_kes).toString(),
        bank.bank_account_id,
        bank.transaction_date,
      ],
    );

    const statementRef = normaliseText(bank.reference_number);
    const statementDesc = normaliseText(bank.description);
    const suggestions: MatchSuggestion[] = candidates.rows.map((row) => {
      const reasons: string[] = [];
      let score = 0;

      /*
       * The statement's reference is matched against both the journal number and
       * the entry description. `journal_entries` has no free-text reference
       * column, so a clerk's invoice number ends up in one or the other
       * depending on how the entry was raised; checking only one would miss
       * half of the real cases.
       */
      const reference = normaliseText(row.reference);
      const description = normaliseText(row.description);
      const referenceHit =
        statementRef &&
        [reference, description].some(
          (candidate) =>
            candidate && (candidate.includes(statementRef) || statementRef.includes(candidate)),
        );
      if (referenceHit) {
        reasons.push('Reference appears on the statement line and the ledger entry.');
        score += 2;
      }
      if (statementDesc && description) {
        const overlap = description
          .split(' ')
          .filter((word) => word.length > 3 && statementDesc.includes(word));
        if (overlap.length > 0) {
          reasons.push(`Description shares: ${[...new Set(overlap)].slice(0, 4).join(', ')}.`);
          score += 1;
        }
      }
      const daysApart = Math.abs(
        Math.round(
          (Date.parse(`${row.entry_date}T00:00:00Z`) -
            Date.parse(`${bank.transaction_date}T00:00:00Z`)) /
            86_400_000,
        ),
      );
      if (daysApart === 0) {
        reasons.push('Same date as the statement line.');
        score += 1;
      } else {
        reasons.push(`${daysApart} day(s) from the statement date.`);
      }

      reasons.unshift('Amount and direction are identical.');

      const confidence: MatchConfidence = score >= 3 ? 'EXACT' : score >= 1 ? 'STRONG' : 'WEAK';
      if (confidence === 'WEAK') reasons.push('Only the amount matches; confirm before accepting.');

      return {
        journalLineId: Number(row.journal_line_id),
        journalEntryId: Number(row.journal_entry_id),
        entryDate: row.entry_date,
        reference: row.reference,
        description: row.description,
        amountKes: centsToKes((BigInt(row.debit_cents) || 0n) + (BigInt(row.credit_cents) || 0n)),
        direction: bank.direction as BankDirection,
        confidence,
        reasons,
      };
    });

    const rank: Record<MatchConfidence, number> = { EXACT: 0, STRONG: 1, WEAK: 2 };
    suggestions.sort(
      (a, b) => rank[a.confidence] - rank[b.confidence] || a.entryDate.localeCompare(b.entryDate),
    );

    return { transactionId, suggestions, consideredCount: candidates.rows.length };
  });
}

/**
 * The unmatched-statement investigation list for one bank account.
 *
 * For each unmatched statement line it says *whether the ledger has an obvious
 * counterpart* and, when it does not, which of the ordinary explanations is
 * most likely given the data: a ledger entry that never reached the bank, a
 * bank line with no ledger entry (charges, interest, dishonoured items), or a
 * netting of several entries. It does not decide — it tells an operator where
 * to look, because "12 unmatched items" on its own is not actionable.
 */
export async function investigateUnmatchedScoped(
  scope: AccountingScope,
  accountId: number,
): Promise<{
  accountId: number;
  unmatchedCount: number;
  items: Array<{
    transactionId: number;
    date: string;
    reference: string | null;
    description: string;
    direction: BankDirection;
    amountKes: string;
    suggestionCount: number;
    topConfidence: MatchConfidence | null;
    likelyExplanation: string;
    requiresLedgerEntry: boolean;
  }>;
  ledgerOnlyCandidates: Array<{
    journalLineId: number;
    entryDate: string;
    reference: string | null;
    amountKes: string;
    direction: BankDirection;
  }>;
  notice: string;
}> {
  id(accountId, 'Bank account');

  const unmatched = await transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const account = await c.query(
      'SELECT id,gl_account_id FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [accountId, scope.tenantId, scope.facilityId],
    );
    if (!account.rows.length)
      throw new BankStatementError('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found.');
    const rows = await c.query(
      `SELECT id,transaction_date,reference_number,description,direction,amount_kes
         FROM bank_transactions
        WHERE bank_account_id=$1 AND tenant_id=$2 AND facility_id=$3 AND match_status='UNMATCHED'
        ORDER BY transaction_date, id`,
      [accountId, scope.tenantId, scope.facilityId],
    );
    return { gl: account.rows[0].gl_account_id as number, rows: rows.rows };
  });

  const items = [];
  for (const row of unmatched.rows) {
    const { suggestions } = await suggestMatchesForTransactionScoped(scope, Number(row.id));
    const best = suggestions[0] ?? null;
    items.push({
      transactionId: Number(row.id),
      date: row.transaction_date,
      reference: row.reference_number,
      description: row.description,
      direction: row.direction as BankDirection,
      amountKes: row.amount_kes,
      suggestionCount: suggestions.length,
      topConfidence: best?.confidence ?? null,
      likelyExplanation:
        suggestions.length > 0
          ? 'A posted ledger line matches this amount; review the suggestions and match it.'
          : row.direction === 'OUTFLOW'
            ? 'No posted ledger line matches. Bank charges, interest, or an unrecorded payment are the usual causes; if real, the ledger needs the entry before this can be matched.'
            : 'No posted ledger line matches. An unrecorded receipt or a direct deposit is the usual cause; if real, the ledger needs the entry before this can be matched.',
      requiresLedgerEntry: suggestions.length === 0,
    });
  }

  /*
   * The other direction: ledger entries on this bank account that no statement
   * line has explained. These are the "in our books, not on the statement"
   * items — typically unpresented cheques or transfers in transit.
   */
  const ledgerOnly = await transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = await c.query(
      `SELECT l.id,j.entry_date::date::text AS entry_date,
              j.journal_number AS reference,l.debit_cents,l.credit_cents
         FROM journal_lines l
         JOIN journal_entries j ON j.id=l.journal_entry_id
        WHERE l.account_id=$1 AND j.tenant_id=$2 AND j.facility_id=$3 AND j.status='POSTED'
          AND NOT EXISTS (
            SELECT 1 FROM bank_transactions t
             WHERE t.matched_journal_line_id=l.id AND t.bank_account_id=$4
          )
        ORDER BY j.entry_date, l.id
        LIMIT 200`,
      [unmatched.gl, scope.tenantId, scope.facilityId, accountId],
    );
    return rows.rows.map((row) => ({
      journalLineId: Number(row.id),
      entryDate: row.entry_date,
      reference: row.reference,
      amountKes: centsToKes(BigInt(row.debit_cents) + BigInt(row.credit_cents)),
      direction: (BigInt(row.debit_cents) > 0n ? 'INFLOW' : 'OUTFLOW') as BankDirection,
    }));
  });

  return {
    accountId,
    unmatchedCount: items.length,
    items,
    ledgerOnlyCandidates: ledgerOnly,
    notice:
      'Explanations are inferred from the data, not from the bank. Nothing here is confirmation from the bank.',
  };
}

/**
 * Reverse a match.
 *
 * Without this, a wrong match is permanent: the reconciliation worksheet will
 * keep counting that statement line as explained, and the only remedy would be
 * a database edit. Reversal is audited with the actor and the reason, and the
 * journal entry itself is untouched — unmatching says "this pairing was wrong",
 * it never says "this ledger entry was wrong".
 */
export async function unmatchBankTransactionScoped(
  scope: AccountingScope,
  transactionId: number,
  reason: unknown,
) {
  id(transactionId, 'Bank transaction');
  const why = required(reason, 'Reason for unmatching', 500);
  return transaction(async (c) => {
    const found = await c.query(
      `SELECT id,match_status,matched_journal_line_id,matched_journal_entry_id
         FROM bank_transactions
        WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE`,
      [transactionId, scope.tenantId, scope.facilityId],
    );
    const row = found.rows[0];
    if (!row)
      throw new BankStatementError(
        'BANK_TRANSACTION_NOT_FOUND',
        'Statement transaction not found.',
      );
    if (!row.matched_journal_line_id)
      throw new BankStatementError('NOT_MATCHED', 'This statement transaction is not matched.');

    /*
     * Refuse to unmatch once a reconciliation that includes this line has been
     * approved. The approval asserts a set of pairings; silently changing that
     * set afterwards would make the signed record untrue.
     */
    const approved = await c.query(
      `SELECT id FROM bank_reconciliations
        WHERE bank_account_id=(SELECT bank_account_id FROM bank_transactions WHERE id=$1)
          AND tenant_id=$2 AND facility_id=$3
          AND approved_by_user_id IS NOT NULL
          AND statement_ending_date >= (SELECT transaction_date FROM bank_transactions WHERE id=$1)
        LIMIT 1`,
      [transactionId, scope.tenantId, scope.facilityId],
    );
    if (approved.rows.length)
      throw new BankStatementError(
        'RECONCILIATION_APPROVED',
        `Reconciliation ${approved.rows[0].id} covering this line is already approved. ` +
          'Reopen the period with finance before changing a match it relied on.',
        409,
      );

    const previousJournalLineId = row.matched_journal_line_id;
    await c.query(
      `UPDATE bank_transactions
          SET matched_journal_line_id=NULL, matched_journal_entry_id=NULL,
              matched_by_user_id=NULL, matched_at=NULL, match_status='UNMATCHED'
        WHERE id=$1`,
      [transactionId],
    );
    await audit(c, scope, 'UNMATCH', 'bank_transaction', transactionId, {
      previousJournalLineId,
      previousJournalEntryId: row.matched_journal_entry_id,
      reason: why,
    });
    return { transactionId, previousJournalLineId, unmatched: true };
  });
}

/**
 * Approve a prepared reconciliation.
 *
 * Segregation of duties: the approver must not be the person who prepared it.
 * That is the whole point of the step — a reconciliation says the ledger and the
 * bank agree, and the person who did the matching is the least useful person to
 * confirm it.
 *
 * The worksheet is recomputed at approval time rather than trusted from the
 * stored figures. Between preparation and approval, someone may have matched
 * further transactions; approving stale numbers would sign off a state that no
 * longer exists.
 */
export async function approveBankReconciliationScoped(
  scope: AccountingScope,
  reconciliationId: number,
  input: Record<string, unknown> = {},
) {
  id(reconciliationId, 'Reconciliation');
  const notes = required(input.approvalNotes, 'Approval notes', 1000);
  return transaction(async (c) => {
    const found = await c.query(
      `SELECT r.id,r.bank_account_id,r.statement_import_id,r.status,r.period_code,
              r.reconciled_by_user_id,r.approved_by_user_id,r.notes
         FROM bank_reconciliations r
        WHERE r.id=$1 AND r.tenant_id=$2 AND r.facility_id=$3 FOR UPDATE`,
      [reconciliationId, scope.tenantId, scope.facilityId],
    );
    const row = found.rows[0];
    if (!row) throw new BankStatementError('RECONCILIATION_NOT_FOUND', 'Reconciliation not found.');
    if (row.approved_by_user_id) {
      if (row.approved_by_user_id === scope.actorUserId)
        return { reconciliationId, idempotentReplay: true, status: row.status };
      throw new BankStatementError(
        'ALREADY_APPROVED',
        'This reconciliation has already been approved by another user.',
        409,
      );
    }
    if (row.reconciled_by_user_id === scope.actorUserId)
      throw new BankStatementError(
        'SELF_APPROVAL_FORBIDDEN',
        'A reconciliation must be approved by someone other than the person who prepared it.',
        403,
      );

    /* The financial period must still be open. */
    const period = await c.query(
      `SELECT status FROM financial_periods
        WHERE tenant_id=$1 AND facility_id=$2 AND period_code=$3`,
      [scope.tenantId, scope.facilityId, row.period_code],
    );
    if (period.rows.length && period.rows[0].status === 'CLOSED')
      throw new BankStatementError(
        'PERIOD_CLOSED',
        `Financial period ${row.period_code} is closed; a reconciliation inside it cannot be approved.`,
        409,
      );

    /*
     * Recompute. The stored worksheet was right when it was written; this is
     * what is true now.
     */
    const fresh = await worksheet(c, scope, row.bank_account_id, row.statement_import_id);
    if (!fresh.worksheetBalanced || fresh.unmatchedStatementCount > 0)
      throw new BankStatementError(
        'RECONCILIATION_INCOMPLETE',
        'The worksheet no longer balances or has unmatched statement lines since it was prepared. ' +
          'Re-prepare the reconciliation rather than approving it.',
        409,
      );

    await c.query(
      `UPDATE bank_reconciliations
          SET status='APPROVED', approved_by_user_id=$1, approved_at=now(), approval_notes=$2
        WHERE id=$3`,
      [scope.actorUserId, notes, reconciliationId],
    );
    await c.query(
      `UPDATE bank_accounts SET last_reconciled_at=now(), last_statement_balance_kes=$1
        WHERE id=$2`,
      [fresh.statementBalanceKes, row.bank_account_id],
    );
    await audit(c, scope, 'APPROVE', 'bank_reconciliation', reconciliationId, {
      preparedBy: row.reconciled_by_user_id,
      periodCode: row.period_code,
      statementBalanceKes: fresh.statementBalanceKes,
      note: 'Imported statement only; this is not live bank confirmation.',
    });
    return {
      reconciliationId,
      idempotentReplay: false,
      status: 'APPROVED',
      worksheet: fresh,
    };
  });
}

/**
 * Reconciliation report for one bank account: every statement import, what it
 * reconciled to, and who signed it off.
 *
 * Read-only, and deliberately reporting the *gap* rather than a pass/fail: a
 * statement with no approved reconciliation is the finding.
 */
export async function bankReconciliationReportScoped(scope: AccountingScope, accountId: number) {
  id(accountId, 'Bank account');
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const account = await c.query(
      `SELECT id,account_name,bank_code,bank_name,account_number_masked,gl_account_id,
              opening_balance_kes,last_statement_balance_kes,last_reconciled_at
         FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3`,
      [accountId, scope.tenantId, scope.facilityId],
    );
    if (!account.rows.length)
      throw new BankStatementError('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found.');

    const statements = await c.query(
      `SELECT s.id, s.statement_start_date, s.statement_end_date, s.closing_balance_kes,
              s.line_count, s.imported_at,
              r.id AS reconciliation_id, r.status, r.adjusted_difference_kes,
              r.reconciled_by_user_id, r.approved_by_user_id, r.approved_at, r.period_code
         FROM bank_statement_imports s
         LEFT JOIN bank_reconciliations r ON r.statement_import_id=s.id
        WHERE s.bank_account_id=$1 AND s.tenant_id=$2 AND s.facility_id=$3
        ORDER BY s.statement_end_date DESC, s.id DESC`,
      [accountId, scope.tenantId, scope.facilityId],
    );

    const totals = await c.query(
      `SELECT match_status, COUNT(*)::int AS n, COALESCE(SUM(amount_kes),0)::text AS total
         FROM bank_transactions
        WHERE bank_account_id=$1 AND tenant_id=$2 AND facility_id=$3
        GROUP BY match_status`,
      [accountId, scope.tenantId, scope.facilityId],
    );

    const approved = statements.rows.filter((row) => row.approved_by_user_id !== null).length;
    const rows = statements.rows.map((row) => ({
      statementImportId: Number(row.id),
      startDate: row.statement_start_date,
      endDate: row.statement_end_date,
      closingBalanceKes: row.closing_balance_kes,
      lineCount: Number(row.line_count),
      importedAt: row.imported_at,
      reconciliationId: row.reconciliation_id === null ? null : Number(row.reconciliation_id),
      status: row.status,
      differenceKes: row.adjusted_difference_kes,
      periodCode: row.period_code,
      preparedByUserId: row.reconciled_by_user_id,
      approvedByUserId: row.approved_by_user_id,
      approvedAt: row.approved_at,
    }));

    return {
      account: account.rows[0],
      statements: rows,
      statementCount: rows.length,
      approvedCount: approved,
      unreconciledCount: rows.filter((row) => row.reconciliationId === null).length,
      unapprovedCount: rows.filter(
        (row) => row.reconciliationId !== null && row.approvedByUserId === null,
      ).length,
      transactionTotals: totals.rows.map((row) => ({
        matchStatus: row.match_status,
        count: Number(row.n),
        totalKes: row.total,
      })),
      notice:
        'Figures come from imported statements. They are not a live bank balance and have not been confirmed with the bank.',
    };
  });
}

/**
 * Post a bank-statement adjustment — a journal for something the statement shows
 * that the books do not (bank charges, interest, a dishonoured item).
 *
 * Keyed to the statement import, not to a reconciliation record, because a
 * reconciliation record is only created once the worksheet already balances.
 * The moment an adjustment is actually needed is just after import, when an
 * unexplained charge appears and there is nothing in the ledger to match it to.
 *
 * WHY THIS DELEGATES INSTEAD OF WRITING ITS OWN ENTRY
 * ---------------------------------------------------
 * `postJournalScoped` already owns validation, double-entry balance, financial
 * period locking, idempotency and audit. Writing a second insert path here would
 * create two ways to reach the ledger, and the weaker one would eventually be
 * the one that skipped a check. This function decides *whether* an adjustment is
 * allowed; the posting service decides *how* a journal is written.
 *
 * WHAT IT REFUSES
 * ---------------
 * - A statement whose reconciliation is already approved. Once signed off, the
 *   pairings and balances it asserts are history.
 * - A closed period, because the posting service would, and failing here gives
 *   the operator a message about the statement rather than about a journal.
 * - Anything that is not a balanced set of lines, enforced by the poster.
 *
 * It never edits, reverses or deletes an existing journal. An adjustment is a
 * new entry, in the open period, traceable to the statement it came from.
 */
export async function postBankStatementAdjustmentScoped(
  scope: AccountingScope,
  statementImportId: number,
  input: Record<string, unknown>,
) {
  id(statementImportId, 'Statement import');

  const context = await transaction(async (c) => {
    const found = await c.query(
      `SELECT s.id,s.bank_account_id,s.statement_end_date,a.gl_account_id
         FROM bank_statement_imports s
         JOIN bank_accounts a ON a.id=s.bank_account_id
        WHERE s.id=$1 AND s.tenant_id=$2 AND s.facility_id=$3`,
      [statementImportId, scope.tenantId, scope.facilityId],
    );
    const row = found.rows[0];
    if (!row) throw new BankStatementError('STATEMENT_NOT_FOUND', 'Statement import not found.');

    const approved = await c.query(
      `SELECT id FROM bank_reconciliations
        WHERE statement_import_id=$1 AND tenant_id=$2 AND facility_id=$3
          AND approved_by_user_id IS NOT NULL LIMIT 1`,
      [statementImportId, scope.tenantId, scope.facilityId],
    );
    if (approved.rows.length)
      throw new BankStatementError(
        'RECONCILIATION_APPROVED',
        `Reconciliation ${approved.rows[0].id} for this statement is approved. ` +
          'Adjustments must be posted before approval, or the period reopened with finance.',
        409,
      );
    return row;
  });

  /*
   * The caller supplies the non-bank side of the entry. The bank side is added
   * here so an adjustment can never be posted against the wrong account, and the
   * two sides must net to zero or the poster will refuse it.
   */
  const rawLines = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : [];
  if (rawLines.length === 0)
    throw new BankStatementError('INVALID_INPUT', 'An adjustment needs at least one line.');

  const amountCents = rawLines.reduce((total, line) => {
    const debit = line.debitKes ? parseKesToCents(String(line.debitKes)) : 0n;
    const credit = line.creditKes ? parseKesToCents(String(line.creditKes)) : 0n;
    return total + debit - credit;
  }, 0n);

  if (amountCents === 0n)
    throw new BankStatementError(
      'INVALID_INPUT',
      'The adjustment lines already balance; there is nothing to post to the bank account.',
    );

  const bankLine =
    amountCents > 0n
      ? { accountId: context.gl_account_id, creditKes: centsToKes(amountCents) }
      : { accountId: context.gl_account_id, debitKes: centsToKes(-amountCents) };

  const posted = await postJournalScoped(scope, {
    entryDate: input.entryDate,
    description: input.description,
    reference: input.reference,
    sourceType: 'MANUAL',
    sourceId: `bank_statement:${statementImportId}`,
    idempotencyKey: input.idempotencyKey,
    lines: [...rawLines, bankLine],
  });

  await transaction(async (c) => {
    await audit(c, scope, 'ADJUST', 'bank_statement_import', statementImportId, {
      journalId: posted.journal.id,
      journalNumber: posted.journal.journalNumber,
      amountKes: centsToKes(amountCents < 0n ? -amountCents : amountCents),
      side: amountCents > 0n ? 'CREDIT_BANK' : 'DEBIT_BANK',
    });
  });

  return {
    statementImportId,
    journalId: posted.journal.id,
    journalNumber: posted.journal.journalNumber,
    notice: 'An adjustment posts a new journal; it never edits an existing one.',
  };
}
