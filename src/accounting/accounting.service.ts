/**
 * Facility-scoped double-entry ledger foundation.
 *
 * Every posting and its audit row are committed atomically. This service does
 * not post billing, claim or bank events automatically: until those bridges
 * are implemented and reconciled, reports describe ledger postings only.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import { hasPostedJournalScopeMismatch } from './journal-scope-integrity.ts';

export class AccountingIntegrityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AccountingIntegrityError';
  }
}

export interface AccountingScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
}

export interface JournalLineInput {
  accountId: number;
  debitKes?: string | number;
  creditKes?: string | number;
  description?: string | null;
  serviceLine?: string | null;
}

export interface JournalLine {
  accountId: number;
  debitCents: bigint;
  creditCents: bigint;
  description: string | null;
  serviceLine: string | null;
}

export function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new AccountingIntegrityError(
      'INVALID_INPUT',
      `${name} is required and must be at most ${max} characters.`,
    );
  }
  return value.trim();
}

function optionalText(value: unknown, name: string, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, name, max);
}

export function requireIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AccountingIntegrityError(
      'INVALID_DATE',
      'Date must be a real date in YYYY-MM-DD format.',
    );
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new AccountingIntegrityError(
      'INVALID_DATE',
      'Date must be a real date in YYYY-MM-DD format.',
    );
  }
  return value;
}

/** Exact decimal-to-cents conversion; no floating-point rounding or exponent notation. */
export function parseKesToCents(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AccountingIntegrityError(
      'INVALID_AMOUNT',
      'Amount must be a non-negative KES decimal with at most two decimal places.',
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new AccountingIntegrityError('INVALID_AMOUNT', 'Amount must be a finite KES decimal.');
  }
  const text = String(value).trim();
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new AccountingIntegrityError(
      'INVALID_AMOUNT',
      'Amount must be a non-negative KES decimal with at most two decimal places.',
    );
  }
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
}

export function centsToKes(cents: bigint): string {
  const negative = cents < 0n;
  const n = negative ? -cents : cents;
  return `${negative ? '-' : ''}${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}

export function validateBalancedJournalLines(input: unknown): {
  lines: JournalLine[];
  totalCents: bigint;
} {
  if (!Array.isArray(input) || input.length < 2 || input.length > 100) {
    throw new AccountingIntegrityError(
      'JOURNAL_LINES_INVALID',
      'A journal requires between 2 and 100 lines.',
    );
  }
  const lines = input.map((raw, index): JournalLine => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AccountingIntegrityError(
        'JOURNAL_LINE_INVALID',
        `Journal line ${index + 1} is invalid.`,
      );
    }
    const line = raw as Record<string, unknown>;
    const accountId = Number(line.accountId);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      throw new AccountingIntegrityError(
        'JOURNAL_ACCOUNT_INVALID',
        `Journal line ${index + 1} needs a valid account.`,
      );
    }
    const debitCents = parseKesToCents(line.debitKes ?? '0');
    const creditCents = parseKesToCents(line.creditKes ?? '0');
    if ((debitCents === 0n) === (creditCents === 0n)) {
      throw new AccountingIntegrityError(
        'JOURNAL_LINE_ONE_SIDED',
        `Journal line ${index + 1} must have exactly one positive debit or credit.`,
      );
    }
    return {
      accountId,
      debitCents,
      creditCents,
      description: optionalText(line.description, 'Line description', 500),
      serviceLine: optionalText(line.serviceLine, 'Service line', 80),
    };
  });
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0n);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0n);
  if (debit === 0n || debit !== credit) {
    throw new AccountingIntegrityError(
      'JOURNAL_UNBALANCED',
      'Journal debits and credits must be equal.',
    );
  }
  if (debit > 9_000_000_000_000_000_000n) {
    throw new AccountingIntegrityError('AMOUNT_TOO_LARGE', 'Journal total is too large.');
  }
  return { lines, totalCents: debit };
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function audit(
  client: PoolClient,
  scope: AccountingScope,
  action: string,
  resource: string,
  id: number,
  details: object,
) {
  await client.query(
    `INSERT INTO audit_logs (tenant_id, facility_id, user_id, action, resource, resource_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      action,
      resource,
      String(id),
      JSON.stringify(details),
    ],
  );
}

export async function createAccountScoped(scope: AccountingScope, input: Record<string, unknown>) {
  const accountCode = requiredText(input.accountCode, 'Account code', 40);
  const accountName = requiredText(input.accountName, 'Account name', 160);
  const accountType = requiredText(input.accountType, 'Account type', 20).toUpperCase();
  const normalBalance = requiredText(input.normalBalance, 'Normal balance', 10).toUpperCase();
  const subType = requiredText(input.subType, 'Account subtype', 80).toUpperCase();
  if (
    !['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(accountType) ||
    !['DEBIT', 'CREDIT'].includes(normalBalance)
  ) {
    throw new AccountingIntegrityError(
      'INVALID_ACCOUNT_TYPE',
      'Specify a valid account type and normal balance.',
    );
  }
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO chart_of_accounts (tenant_id, facility_id, account_code, account_name, account_type, sub_type, normal_balance, is_system_account, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,true)
         RETURNING id, account_code AS "accountCode", account_name AS "accountName", account_type AS "accountType", sub_type AS "subType", normal_balance AS "normalBalance", is_active AS "isActive"`,
        [
          scope.tenantId,
          scope.facilityId,
          accountCode,
          accountName,
          accountType,
          subType,
          normalBalance,
        ],
      );
      await audit(client, scope, 'CREATE', 'chart_of_accounts', rows[0].id, {
        accountCode,
        accountType,
      });
      return rows[0];
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new AccountingIntegrityError(
        'ACCOUNT_CODE_EXISTS',
        'Account code already exists in this facility.',
        409,
      );
    throw error;
  }
}

export async function createFinancialPeriodScoped(
  scope: AccountingScope,
  input: Record<string, unknown>,
) {
  const periodCode = requiredText(input.periodCode, 'Period code', 40);
  const name = requiredText(input.name, 'Period name', 160);
  const startDate = requireIsoDate(input.startDate);
  const endDate = requireIsoDate(input.endDate);
  if (startDate > endDate)
    throw new AccountingIntegrityError('INVALID_PERIOD', 'Period start must not be after its end.');
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO financial_periods (tenant_id,facility_id,period_code,name,start_date,end_date,status)
         VALUES ($1,$2,$3,$4,$5,$6,'OPEN')
         RETURNING id, period_code AS "periodCode", name, start_date::text AS "startDate", end_date::text AS "endDate", status`,
        [scope.tenantId, scope.facilityId, periodCode, name, startDate, endDate],
      );
      await audit(client, scope, 'CREATE', 'financial_periods', rows[0].id, {
        periodCode,
        startDate,
        endDate,
      });
      return rows[0];
    });
  } catch (error) {
    if (['23505', '23514'].includes((error as { code?: string }).code ?? '')) {
      throw new AccountingIntegrityError(
        'PERIOD_CONFLICT',
        'Period code already exists or dates overlap another period.',
        409,
      );
    }
    throw error;
  }
}

export async function closeFinancialPeriodScoped(
  scope: AccountingScope,
  periodId: number,
  notes: unknown,
) {
  if (!Number.isSafeInteger(periodId) || periodId <= 0)
    throw new AccountingIntegrityError('INVALID_PERIOD', 'Invalid period id.');
  const reason = requiredText(notes, 'Closing note', 1000);
  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE financial_periods SET status='CLOSED', closed_by_user_id=$1, closed_at=now(), close_notes=$2
       WHERE id=$3 AND tenant_id=$4 AND facility_id=$5 AND status='OPEN'
       RETURNING id, period_code AS "periodCode", status`,
      [scope.actorUserId, reason, periodId, scope.tenantId, scope.facilityId],
    );
    if (!result.rows.length)
      throw new AccountingIntegrityError(
        'PERIOD_NOT_OPEN',
        'Open period not found in this facility.',
        409,
      );
    await audit(client, scope, 'CLOSE', 'financial_periods', periodId, {
      periodCode: result.rows[0].periodCode,
    });
    return result.rows[0];
  });
}

export interface JournalRequest {
  entryDate: string;
  description: string;
  idempotencyKey: string;
  lines: JournalLine[];
  totalCents: bigint;
  sourceType:
    | 'MANUAL'
    | 'REVERSAL'
    | 'EXPENSE_REQUEST'
    | 'BILLING_INVOICE'
    | 'BILLING_PAYMENT'
    | 'BILLING_REFUND';
  sourceId?: string;
  reversalOf?: number;
  reversalReason?: string;
}

function requestHash(request: JournalRequest): string {
  const value = {
    entryDate: request.entryDate,
    description: request.description,
    sourceType: request.sourceType,
    sourceId: request.sourceId ?? null,
    reversalOf: request.reversalOf ?? null,
    reversalReason: request.reversalReason ?? null,
    lines: request.lines.map((l) => ({
      ...l,
      debitCents: l.debitCents.toString(),
      creditCents: l.creditCents.toString(),
    })),
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function postInsideTransaction(
  client: PoolClient,
  scope: AccountingScope,
  request: JournalRequest,
) {
  // Serializes concurrent retries for this facility and idempotency key.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
    request.idempotencyKey,
    scope.facilityId,
  ]);
  const hash = requestHash(request);
  const prior = await client.query(
    'SELECT id, journal_number AS "journalNumber", request_hash AS "requestHash", status FROM journal_entries WHERE tenant_id=$1 AND facility_id=$2 AND idempotency_key=$3',
    [scope.tenantId, scope.facilityId, request.idempotencyKey],
  );
  if (prior.rows.length) {
    if (prior.rows[0].requestHash !== hash)
      throw new AccountingIntegrityError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for a different journal.',
        409,
      );
    return { journal: prior.rows[0], idempotentReplay: true };
  }
  const period = await client.query(
    `SELECT id, status FROM financial_periods WHERE tenant_id=$1 AND facility_id=$2
      AND start_date <= $3::date AND end_date >= $3::date FOR UPDATE`,
    [scope.tenantId, scope.facilityId, request.entryDate],
  );
  if (period.rows.length !== 1 || period.rows[0].status !== 'OPEN') {
    throw new AccountingIntegrityError(
      'OPEN_PERIOD_REQUIRED',
      'Journal date must be in exactly one open financial period.',
      409,
    );
  }
  const ids = [...new Set(request.lines.map((l) => l.accountId))];
  const accounts = await client.query(
    'SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND facility_id=$2 AND is_active=true AND id=ANY($3::int[]) FOR SHARE',
    [scope.tenantId, scope.facilityId, ids],
  );
  if (accounts.rows.length !== ids.length) {
    throw new AccountingIntegrityError(
      'ACCOUNT_OUT_OF_SCOPE',
      'Every account must be active and belong to this facility.',
      403,
    );
  }
  if (request.reversalOf) {
    const original = await client.query(
      `SELECT id FROM journal_entries WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND status='POSTED' AND reversal_of_journal_id IS NULL FOR UPDATE`,
      [request.reversalOf, scope.tenantId, scope.facilityId],
    );
    if (!original.rows.length)
      throw new AccountingIntegrityError(
        'JOURNAL_NOT_FOUND',
        'Original posted journal was not found.',
        404,
      );
    const reversed = await client.query(
      'SELECT id FROM journal_entries WHERE reversal_of_journal_id=$1',
      [request.reversalOf],
    );
    if (reversed.rows.length)
      throw new AccountingIntegrityError(
        'JOURNAL_ALREADY_REVERSED',
        'This journal has already been reversed.',
        409,
      );
  }
  const journalNumber = `J-${randomUUID()}`;
  const created = await client.query(
    `INSERT INTO journal_entries (tenant_id,facility_id,period_id,journal_number,entry_date,source_type,source_id,idempotency_key,request_hash,description,status,total_debit_cents,total_credit_cents,reversal_of_journal_id,reversal_reason,posted_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11,$11,$12,$13,$14)
     RETURNING id, journal_number AS "journalNumber"`,
    [
      scope.tenantId,
      scope.facilityId,
      period.rows[0].id,
      journalNumber,
      request.entryDate,
      request.sourceType,
      request.sourceId ?? (request.reversalOf ? String(request.reversalOf) : null),
      request.idempotencyKey,
      hash,
      request.description,
      request.totalCents.toString(),
      request.reversalOf ?? null,
      request.reversalReason ?? null,
      scope.actorUserId,
    ],
  );
  const journalId = created.rows[0].id as number;
  for (const line of request.lines) {
    await client.query(
      `INSERT INTO journal_lines (journal_entry_id,account_id,description,service_line,debit_cents,credit_cents)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        journalId,
        line.accountId,
        line.description,
        line.serviceLine,
        line.debitCents.toString(),
        line.creditCents.toString(),
      ],
    );
  }
  await client.query("UPDATE journal_entries SET status='POSTED', posted_at=now() WHERE id=$1", [
    journalId,
  ]);
  await audit(client, scope, 'POST', 'journal_entries', journalId, {
    journalNumber,
    sourceType: request.sourceType,
    reversalOf: request.reversalOf ?? null,
  });
  return { journal: { ...created.rows[0], status: 'POSTED' }, idempotentReplay: false };
}

export async function postJournalScoped(scope: AccountingScope, input: Record<string, unknown>) {
  const { lines, totalCents } = validateBalancedJournalLines(input.lines);
  const request: JournalRequest = {
    entryDate: requireIsoDate(input.entryDate),
    description: requiredText(input.description, 'Journal description', 500),
    idempotencyKey: requiredText(input.idempotencyKey, 'Idempotency key', 128),
    lines,
    totalCents,
    sourceType: 'MANUAL',
  };
  return transaction((client) => postInsideTransaction(client, scope, request));
}

export async function reverseJournalScoped(
  scope: AccountingScope,
  journalId: number,
  input: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(journalId) || journalId <= 0)
    throw new AccountingIntegrityError('JOURNAL_NOT_FOUND', 'Original journal not found.', 404);
  const entryDate = requireIsoDate(input.entryDate);
  const reason = requiredText(input.reason, 'Reversal reason', 500);
  const key = requiredText(input.idempotencyKey, 'Idempotency key', 128);
  return transaction(async (client) => {
    const original = await client.query(
      `SELECT id, total_debit_cents, source_type FROM journal_entries WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND status='POSTED' AND reversal_of_journal_id IS NULL`,
      [journalId, scope.tenantId, scope.facilityId],
    );
    if (!original.rows.length)
      throw new AccountingIntegrityError(
        'JOURNAL_NOT_FOUND',
        'Original posted journal not found.',
        404,
      );
    // Source postings and their reversals share the invoice lock. Reversing a
    // parent while an active child exists would leave unexplained GL balances.
    if (
      ['BILLING_INVOICE', 'BILLING_PAYMENT', 'BILLING_REFUND'].includes(
        original.rows[0].source_type,
      )
    ) {
      if (input.billingSourceAuthorized !== true)
        throw new AccountingIntegrityError(
          'BILLING_READ_REQUIRED',
          'Billing read permission is required to reverse a billing source journal.',
          403,
        );
      const bridge = await client.query(
        `SELECT invoice_id, payment_id, source_type FROM accounting_billing_postings
         WHERE journal_id=$1 AND tenant_id=$2 AND facility_id=$3`,
        [journalId, scope.tenantId, scope.facilityId],
      );
      if (bridge.rows.length) {
        const link = bridge.rows[0];
        await client.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [
          link.invoice_id,
        ]);
        if (link.source_type !== 'BILLING_REFUND') {
          const dependent = await client.query(
            `SELECT p.journal_id FROM accounting_billing_postings p
             WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.invoice_id=$3
               AND (($4='BILLING_INVOICE' AND p.source_type IN ('BILLING_PAYMENT','BILLING_REFUND'))
                 OR ($4='BILLING_PAYMENT' AND p.source_type='BILLING_REFUND' AND p.payment_id=$5))
               AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=p.journal_id AND r.status='POSTED')
             LIMIT 1`,
            [scope.tenantId, scope.facilityId, link.invoice_id, link.source_type, link.payment_id],
          );
          if (dependent.rows.length)
            throw new AccountingIntegrityError(
              'ACTIVE_DEPENDENT_POSTING',
              'Reverse the dependent billing journals first; source records remain unchanged.',
              409,
            );
        }
      }
    }
    const existingLines = await client.query(
      `SELECT account_id, debit_cents, credit_cents, description, service_line FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id`,
      [journalId],
    );
    const lines: JournalLine[] = existingLines.rows.map((row) => ({
      accountId: row.account_id,
      debitCents: BigInt(row.credit_cents),
      creditCents: BigInt(row.debit_cents),
      description: row.description,
      serviceLine: row.service_line,
    }));
    return postInsideTransaction(client, scope, {
      entryDate,
      description: `Reversal of journal ${journalId}: ${reason}`,
      idempotencyKey: key,
      sourceType: 'REVERSAL',
      reversalOf: journalId,
      reversalReason: reason,
      lines,
      totalCents: BigInt(original.rows[0].total_debit_cents),
    });
  });
}

interface TrialRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  subType: string;
  normalBalance: string;
  debitCents: string;
  creditCents: string;
}
async function trialRows(
  client: PoolClient,
  scope: AccountingScope,
  startDate: string | null,
  endDate: string,
) {
  const result = await client.query<TrialRow>(
    `SELECT a.id AS "accountId", a.account_code AS "accountCode", a.account_name AS "accountName",
      a.account_type AS "accountType", a.sub_type AS "subType", a.normal_balance AS "normalBalance",
      COALESCE(SUM(l.debit_cents) FILTER (WHERE j.status='POSTED' AND j.entry_date <= $3::date AND ($4::date IS NULL OR j.entry_date >= $4::date)),0)::text AS "debitCents",
      COALESCE(SUM(l.credit_cents) FILTER (WHERE j.status='POSTED' AND j.entry_date <= $3::date AND ($4::date IS NULL OR j.entry_date >= $4::date)),0)::text AS "creditCents"
     FROM chart_of_accounts a LEFT JOIN journal_lines l ON l.account_id=a.id
     LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.tenant_id=a.tenant_id AND j.facility_id=a.facility_id
     WHERE a.tenant_id=$1 AND a.facility_id=$2 GROUP BY a.id ORDER BY a.account_code`,
    [scope.tenantId, scope.facilityId, endDate, startDate],
  );
  return result.rows;
}

export async function getAccountingOverviewScoped(
  scope: AccountingScope,
  start: unknown,
  end: unknown,
) {
  const endDate = requireIsoDate(end);
  const startDate =
    start === undefined || start === null || start === '' ? null : requireIsoDate(start);
  if (startDate && startDate > endDate)
    throw new AccountingIntegrityError('INVALID_RANGE', 'Start date must not be after end date.');
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (await hasPostedJournalScopeMismatch(client, scope.tenantId, scope.facilityId))
      throw new AccountingIntegrityError(
        'LEDGER_SCOPE_INCONSISTENT',
        'Posted journal account scope is inconsistent. Finance review is required before reporting.',
        409,
      );
    const periodRows = await trialRows(client, scope, startDate, endDate);
    const inceptionRows = await trialRows(client, scope, null, endDate);
    const periods = await client.query(
      `SELECT id,period_code AS "periodCode",name,start_date::text AS "startDate",end_date::text AS "endDate",status FROM financial_periods WHERE tenant_id=$1 AND facility_id=$2 ORDER BY start_date DESC`,
      [scope.tenantId, scope.facilityId],
    );
    const journals = await client.query(
      `SELECT id,journal_number AS "journalNumber",entry_date::text AS "entryDate",description,status,reversal_of_journal_id AS "reversalOfJournalId",total_debit_cents::text AS "totalDebitCents" FROM journal_entries WHERE tenant_id=$1 AND facility_id=$2 AND status='POSTED' AND entry_date <= $3::date AND ($4::date IS NULL OR entry_date >= $4::date) ORDER BY entry_date DESC,id DESC LIMIT 100`,
      [scope.tenantId, scope.facilityId, endDate, startDate],
    );
    const sum = (rows: TrialRow[], kind: string, debitNormal: boolean) =>
      rows
        .filter((r) => r.accountType === kind)
        .reduce(
          (total, row) =>
            total +
            (debitNormal
              ? BigInt(row.debitCents) - BigInt(row.creditCents)
              : BigInt(row.creditCents) - BigInt(row.debitCents)),
          0n,
        );
    const debit = periodRows.reduce((n, row) => n + BigInt(row.debitCents), 0n);
    const credit = periodRows.reduce((n, row) => n + BigInt(row.creditCents), 0n);
    const revenue = sum(periodRows, 'REVENUE', false);
    const expenses = sum(periodRows, 'EXPENSE', true);
    const assets = sum(inceptionRows, 'ASSET', true);
    const liabilities = sum(inceptionRows, 'LIABILITY', false);
    const postedEquity = sum(inceptionRows, 'EQUITY', false);
    const accumulatedResult =
      sum(inceptionRows, 'REVENUE', false) - sum(inceptionRows, 'EXPENSE', true);
    return {
      filters: { startDate, endDate },
      accounts: periodRows.map((r) => ({
        ...r,
        debitKes: centsToKes(BigInt(r.debitCents)),
        creditKes: centsToKes(BigInt(r.creditCents)),
      })),
      periods: periods.rows,
      journals: journals.rows,
      trialBalance: {
        debitKes: centsToKes(debit),
        creditKes: centsToKes(credit),
        balanced: debit === credit,
      },
      profitAndLoss: {
        postedRevenueKes: centsToKes(revenue),
        postedExpensesKes: centsToKes(expenses),
        ledgerResultKes: centsToKes(revenue - expenses),
      },
      balanceSheet: {
        asOf: endDate,
        assetsKes: centsToKes(assets),
        liabilitiesKes: centsToKes(liabilities),
        equityIncludingAccumulatedResultKes: centsToKes(postedEquity + accumulatedResult),
        balanced: assets === liabilities + postedEquity + accumulatedResult,
      },
      limitations: {
        billingReconciliation: 'NOT_IMPLEMENTED',
        claimSubmissionIsPayment: false,
        serviceLineProfitability: 'UNAVAILABLE_UNTIL_COSTS_AND_ALLOCATIONS_ARE_VERIFIED',
        notice:
          'Statements include posted journal entries only. Billing and payments are not automatically posted or reconciled; unrecorded costs are not included.',
      },
    };
  });
}

export async function recordAccountingExport(
  scope: AccountingScope,
  filters: { startDate: string | null; endDate: string },
) {
  await transaction(async (client) => {
    await audit(client, scope, 'EXPORT', 'accounting_trial_balance', scope.facilityId, filters);
  });
}

/** Expense documents are opaque references only; this code does not upload or verify files. */
function documentReferences(input: unknown): Array<{ name: string; storageReference: string }> {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 20)
    throw new AccountingIntegrityError(
      'INVALID_DOCUMENTS',
      'Supporting documents must be a list of at most 20 private references.',
    );
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new AccountingIntegrityError('INVALID_DOCUMENTS', 'A supporting document is invalid.');
    const item = raw as Record<string, unknown>;
    const name = requiredText(item.name, 'Document name', 160),
      ref = requiredText(item.storageReference, 'Private storage reference', 300);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/:-]*$/.test(ref) || /^https?:/i.test(ref))
      throw new AccountingIntegrityError(
        'INVALID_DOCUMENTS',
        'Use an opaque private storage reference, not a public URL or credential.',
      );
    return { name, storageReference: ref };
  });
}

interface ExpenseReviewRow {
  id: number;
  tenant_id: number;
  facility_id: number;
  request_number: string;
  incurred_date_text: string;
  expense_account_id: number;
  payment_account_id: number | null;
  payee_name: string;
  category: string;
  amount_kes: string;
  currency: string;
  description: string;
  service_line: string | null;
  supporting_documents: unknown;
  status: string;
  requested_by_user_id: number | null;
  reviewed_by_user_id: number | null;
  review_notes: string | null;
  posted_journal_id: number | null;
  request_hash: string | null;
  expense_account_code: string | null;
  expense_account_name: string | null;
  expense_account_type: string | null;
  expense_account_active: boolean | null;
  expense_account_tenant: number | null;
  expense_account_facility: number | null;
  payable_account_code: string | null;
  payable_account_name: string | null;
  payable_account_type: string | null;
  payable_account_active: boolean | null;
  payable_account_tenant: number | null;
  payable_account_facility: number | null;
  linked_journal_id: number | null;
  linked_journal_status: string | null;
  linked_journal_source_type: string | null;
  linked_journal_source_id: string | null;
  linked_journal_debit: string | null;
  linked_journal_credit: string | null;
  linked_line_count: number;
  linked_expense_line_count: number;
  linked_payable_line_count: number;
  source_journal_count: number;
  reversal_journal_id: number | null;
}

// Include account names and classification in the reviewed snapshot, as well as
// the originally hashed financial source fields. This is a review token, not a
// secret or an approval: authorization and the independent actor are checked
// separately inside the same transaction as posting.
function expenseReview(row: ExpenseReviewRow): {
  reviewHash: string | null;
  reviewIssue: 'SOURCE_CHANGED' | 'ACCOUNT_REVIEW_REQUIRED' | null;
} {
  // These requests and journal amounts are denominated in KES only; a changed
  // legacy currency is inconsistent evidence, not an implicit conversion.
  if (row.currency !== 'KES') return { reviewHash: null, reviewIssue: 'SOURCE_CHANGED' };
  let sourceHash: string;
  try {
    sourceHash = createHash('sha256')
      .update(
        JSON.stringify({
          expenseAccountId: row.expense_account_id,
          payableAccountId: row.payment_account_id,
          amount: parseKesToCents(row.amount_kes).toString(),
          incurredDate: row.incurred_date_text,
          payee: row.payee_name,
          category: row.category,
          description: row.description,
          serviceLine: row.service_line,
          documents: documentReferences(row.supporting_documents),
        }),
      )
      .digest('hex');
  } catch (error) {
    if (error instanceof AccountingIntegrityError)
      return { reviewHash: null, reviewIssue: 'SOURCE_CHANGED' };
    throw error;
  }
  if (!row.request_hash || sourceHash !== row.request_hash)
    return { reviewHash: null, reviewIssue: 'SOURCE_CHANGED' };
  if (
    !row.payment_account_id ||
    row.expense_account_id === row.payment_account_id ||
    row.expense_account_tenant !== row.tenant_id ||
    row.expense_account_facility !== row.facility_id ||
    row.expense_account_type !== 'EXPENSE' ||
    row.expense_account_active !== true ||
    row.payable_account_tenant !== row.tenant_id ||
    row.payable_account_facility !== row.facility_id ||
    row.payable_account_type !== 'LIABILITY' ||
    row.payable_account_active !== true
  )
    return { reviewHash: null, reviewIssue: 'ACCOUNT_REVIEW_REQUIRED' };
  return {
    reviewHash: createHash('sha256')
      .update(
        JSON.stringify({
          id: row.id,
          tenantId: row.tenant_id,
          facilityId: row.facility_id,
          requestNumber: row.request_number,
          currency: row.currency,
          sourceHash,
          requestedBy: row.requested_by_user_id,
          expense: [row.expense_account_id, row.expense_account_code, row.expense_account_name],
          payable: [row.payment_account_id, row.payable_account_code, row.payable_account_name],
        }),
      )
      .digest('hex'),
    reviewIssue: null,
  };
}

const expenseReviewSelect = `SELECT e.*,e.incurred_date::text AS incurred_date_text,
  ea.account_code AS expense_account_code,ea.account_name AS expense_account_name,
  ea.account_type AS expense_account_type,ea.is_active AS expense_account_active,
  ea.tenant_id AS expense_account_tenant,ea.facility_id AS expense_account_facility,
  pa.account_code AS payable_account_code,pa.account_name AS payable_account_name,
  pa.account_type AS payable_account_type,pa.is_active AS payable_account_active,
  pa.tenant_id AS payable_account_tenant,pa.facility_id AS payable_account_facility,
  j.id AS linked_journal_id,j.status AS linked_journal_status,j.source_type AS linked_journal_source_type,
  j.source_id AS linked_journal_source_id,j.total_debit_cents::text AS linked_journal_debit,
  j.total_credit_cents::text AS linked_journal_credit,
  jl.line_count AS linked_line_count,jl.expense_lines AS linked_expense_line_count,
  jl.payable_lines AS linked_payable_line_count,sj.source_count AS source_journal_count,
  r.id AS reversal_journal_id
  FROM expense_requests e
  LEFT JOIN chart_of_accounts ea ON ea.id=e.expense_account_id AND ea.tenant_id=e.tenant_id AND ea.facility_id=e.facility_id
  LEFT JOIN chart_of_accounts pa ON pa.id=e.payment_account_id AND pa.tenant_id=e.tenant_id AND pa.facility_id=e.facility_id
  LEFT JOIN journal_entries j ON j.id=e.posted_journal_id AND j.tenant_id=e.tenant_id AND j.facility_id=e.facility_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS source_count FROM journal_entries source_entry
    WHERE source_entry.tenant_id=e.tenant_id AND source_entry.facility_id=e.facility_id
      AND source_entry.source_type='EXPENSE_REQUEST' AND source_entry.source_id=e.id::text
  ) sj ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS line_count,
      count(*) FILTER (WHERE l.account_id=e.expense_account_id AND l.debit_cents=j.total_debit_cents AND l.credit_cents=0)::int AS expense_lines,
      count(*) FILTER (WHERE l.account_id=e.payment_account_id AND l.credit_cents=j.total_credit_cents AND l.debit_cents=0)::int AS payable_lines
    FROM journal_lines l WHERE l.journal_entry_id=j.id
  ) jl ON true
  LEFT JOIN journal_entries r ON r.reversal_of_journal_id=j.id AND r.tenant_id=e.tenant_id
    AND r.facility_id=e.facility_id AND r.status='POSTED'`;

function expenseAccountingStatus(
  row: ExpenseReviewRow,
): 'NOT_POSTED' | 'POSTED' | 'REVERSED' | 'REVIEW_REQUIRED' {
  if (row.status !== 'POSTED')
    return row.posted_journal_id || row.source_journal_count ? 'REVIEW_REQUIRED' : 'NOT_POSTED';
  let amount: string;
  try {
    amount = parseKesToCents(row.amount_kes).toString();
  } catch {
    return 'REVIEW_REQUIRED';
  }
  if (
    !row.posted_journal_id ||
    row.currency !== 'KES' ||
    row.linked_journal_id !== row.posted_journal_id ||
    row.linked_journal_status !== 'POSTED' ||
    row.linked_journal_source_type !== 'EXPENSE_REQUEST' ||
    row.linked_journal_source_id !== String(row.id) ||
    row.linked_journal_debit !== amount ||
    row.linked_journal_credit !== amount ||
    row.source_journal_count !== 1 ||
    row.linked_line_count !== 2 ||
    row.linked_expense_line_count !== 1 ||
    row.linked_payable_line_count !== 1
  )
    return 'REVIEW_REQUIRED';
  return row.reversal_journal_id ? 'REVERSED' : 'POSTED';
}

export async function createExpenseRequestScoped(
  scope: AccountingScope,
  input: Record<string, unknown>,
) {
  const expenseAccountId = Number(input.expenseAccountId),
    payableAccountId = Number(input.payableAccountId);
  if (
    !Number.isSafeInteger(expenseAccountId) ||
    expenseAccountId <= 0 ||
    !Number.isSafeInteger(payableAccountId) ||
    payableAccountId <= 0 ||
    expenseAccountId === payableAccountId
  )
    throw new AccountingIntegrityError(
      'INVALID_ACCOUNT',
      'Expense and payable accounts must be distinct valid IDs.',
    );
  const amount = parseKesToCents(input.amountKes);
  if (amount <= 0n)
    throw new AccountingIntegrityError('INVALID_AMOUNT', 'Expense amount must be positive.');
  const incurredDate = requireIsoDate(input.incurredDate),
    key = requiredText(input.idempotencyKey, 'Idempotency key', 128),
    payee = requiredText(input.payeeName, 'Payee', 160),
    category = requiredText(input.category, 'Category', 80),
    description = requiredText(input.description, 'Expense description', 500),
    serviceLine = optionalText(input.serviceLine, 'Service line', 80),
    documents = documentReferences(input.supportingDocuments);
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        expenseAccountId,
        payableAccountId,
        amount: amount.toString(),
        incurredDate,
        payee,
        category,
        description,
        serviceLine,
        documents,
      }),
    )
    .digest('hex');
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
      `expense:${key}`,
      scope.facilityId,
    ]);
    const prior = await c.query(
      'SELECT id,request_hash,status FROM expense_requests WHERE tenant_id=$1 AND facility_id=$2 AND idempotency_key=$3',
      [scope.tenantId, scope.facilityId, key],
    );
    if (prior.rows.length) {
      if (prior.rows[0].request_hash !== digest)
        throw new AccountingIntegrityError(
          'IDEMPOTENCY_CONFLICT',
          'Key was used for a different expense request.',
          409,
        );
      return { expenseId: prior.rows[0].id, status: prior.rows[0].status, idempotentReplay: true };
    }
    const accounts = await c.query(
      'SELECT id,account_type FROM chart_of_accounts WHERE id=ANY($1::int[]) AND tenant_id=$2 AND facility_id=$3 AND is_active=true FOR SHARE',
      [[expenseAccountId, payableAccountId], scope.tenantId, scope.facilityId],
    );
    if (
      !accounts.rows.some((a) => a.id === expenseAccountId && a.account_type === 'EXPENSE') ||
      !accounts.rows.some((a) => a.id === payableAccountId && a.account_type === 'LIABILITY')
    )
      throw new AccountingIntegrityError(
        'INVALID_EXPENSE_ACCOUNTS',
        'Select an expense account and a payable liability account from this facility.',
      );
    const row = await c.query(
      `INSERT INTO expense_requests (tenant_id,facility_id,request_number,service_line,expense_account_id,payment_account_id,payee_name,category,amount_kes,currency,description,supporting_documents,status,requested_by_user_id,idempotency_key,request_hash,incurred_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'KES',$10,$11::jsonb,'SUBMITTED',$12,$13,$14,$15) RETURNING id,status`,
      [
        scope.tenantId,
        scope.facilityId,
        `EXP-${randomUUID()}`,
        serviceLine,
        expenseAccountId,
        payableAccountId,
        payee,
        category,
        centsToKes(amount),
        description,
        JSON.stringify(documents),
        scope.actorUserId,
        key,
        digest,
        incurredDate,
      ],
    );
    await audit(c, scope, 'REQUEST', 'expense_request', row.rows[0].id, {
      status: 'SUBMITTED',
      documentReferencesOnly: true,
    });
    return {
      expenseId: row.rows[0].id,
      status: 'SUBMITTED',
      idempotentReplay: false,
      documentsVerified: false,
    };
  });
}

export async function decideExpenseRequestScoped(
  scope: AccountingScope,
  expenseId: number,
  input: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0)
    throw new AccountingIntegrityError('EXPENSE_NOT_FOUND', 'Expense request not found.', 404);
  const decision = requiredText(input.decision, 'Decision', 10).toUpperCase(),
    notes = requiredText(input.notes, 'Review notes', 1000);
  if (!['APPROVE', 'REJECT'].includes(decision))
    throw new AccountingIntegrityError('INVALID_DECISION', 'Decision must be APPROVE or REJECT.');
  return transaction(async (c) => {
    const current = await c.query(
      'SELECT id,status,requested_by_user_id FROM expense_requests WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [expenseId, scope.tenantId, scope.facilityId],
    );
    if (!current.rows.length)
      throw new AccountingIntegrityError('EXPENSE_NOT_FOUND', 'Expense request not found.', 404);
    if (current.rows[0].status !== 'SUBMITTED')
      throw new AccountingIntegrityError(
        'EXPENSE_NOT_SUBMITTED',
        'Only submitted requests may be reviewed.',
        409,
      );
    if (current.rows[0].requested_by_user_id === scope.actorUserId)
      throw new AccountingIntegrityError(
        'SELF_APPROVAL_FORBIDDEN',
        'A different authorized staff member must review the request.',
        403,
      );
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await c.query(
      'UPDATE expense_requests SET status=$1,reviewed_by_user_id=$2,reviewed_at=now(),review_notes=$3,updated_at=now() WHERE id=$4',
      [status, scope.actorUserId, notes, expenseId],
    );
    await audit(c, scope, decision, 'expense_request', expenseId, { status });
    return { expenseId, status };
  });
}

async function lockedExpenseReview(c: PoolClient, scope: AccountingScope, expenseId: number) {
  const initial = await c.query<ExpenseReviewRow>(
    `${expenseReviewSelect} WHERE e.id=$1 AND e.tenant_id=$2 AND e.facility_id=$3 FOR UPDATE OF e`,
    [expenseId, scope.tenantId, scope.facilityId],
  );
  if (!initial.rows.length)
    throw new AccountingIntegrityError('EXPENSE_NOT_FOUND', 'Expense request not found.', 404);
  const first = initial.rows[0];
  const ids = [first.expense_account_id, first.payment_account_id].filter(
    (id): id is number => id !== null,
  );
  // Account changes cannot race the reviewed snapshot or the resulting journal.
  await c.query(
    'SELECT id FROM chart_of_accounts WHERE id=ANY($1::int[]) AND tenant_id=$2 AND facility_id=$3 ORDER BY id FOR SHARE',
    [ids, scope.tenantId, scope.facilityId],
  );
  // Serialize a replay with reversal, then re-read the reversal state. Otherwise
  // a concurrent reversal could commit between the status check and response.
  if (first.posted_journal_id)
    await c.query(
      'SELECT id FROM journal_entries WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [first.posted_journal_id, scope.tenantId, scope.facilityId],
    );
  const refreshed = await c.query<ExpenseReviewRow>(
    `${expenseReviewSelect} WHERE e.id=$1 AND e.tenant_id=$2 AND e.facility_id=$3`,
    [expenseId, scope.tenantId, scope.facilityId],
  );
  return refreshed.rows[0];
}

function requireReviewedExpense(row: ExpenseReviewRow) {
  const assessment = expenseReview(row);
  if (!assessment.reviewHash)
    throw new AccountingIntegrityError(
      'EXPENSE_REVIEW_CHANGED',
      'Expense details or the scoped account classifications require a fresh financial review.',
      409,
    );
  return assessment.reviewHash;
}

async function postApprovedExpenseInsideTransaction(
  c: PoolClient,
  scope: AccountingScope,
  expenseId: number,
) {
  const e = await lockedExpenseReview(c, scope, expenseId);
  const accountingStatus = expenseAccountingStatus(e);
  if (accountingStatus === 'REVERSED')
    throw new AccountingIntegrityError(
      'EXPENSE_POSTING_REVERSED',
      'The expense journal was reversed; use a controlled correction rather than reposting it.',
      409,
    );
  if (accountingStatus === 'REVIEW_REQUIRED')
    throw new AccountingIntegrityError(
      'EXPENSE_POSTING_INCONSISTENT',
      'The expense and its source-linked journal require financial review.',
      409,
    );
  if (e.status === 'POSTED')
    return {
      expenseId,
      status: 'POSTED' as const,
      journalId: e.posted_journal_id!,
      idempotentReplay: true,
      paymentRecorded: false,
    };
  if (e.status !== 'APPROVED')
    throw new AccountingIntegrityError(
      'EXPENSE_NOT_APPROVED',
      'Only approved requests can be posted.',
      409,
    );
  if (
    !e.requested_by_user_id ||
    !e.reviewed_by_user_id ||
    e.requested_by_user_id === e.reviewed_by_user_id
  )
    throw new AccountingIntegrityError(
      'INDEPENDENT_EXPENSE_REVIEW_REQUIRED',
      'A different authorized staff member must approve this expense before posting.',
      409,
    );
  requireReviewedExpense(e);
  const untracked = await c.query(
    "SELECT id FROM journal_entries WHERE tenant_id=$1 AND facility_id=$2 AND source_type='EXPENSE_REQUEST' AND source_id=$3 LIMIT 1",
    [scope.tenantId, scope.facilityId, String(expenseId)],
  );
  if (untracked.rows.length)
    throw new AccountingIntegrityError(
      'EXPENSE_POSTING_INCONSISTENT',
      'An existing source journal is not linked to this expense; review it before posting.',
      409,
    );
  const amount = parseKesToCents(e.amount_kes);
  if (amount <= 0n)
    throw new AccountingIntegrityError('INVALID_AMOUNT', 'Expense amount must be positive.', 409);
  const request: JournalRequest = {
    entryDate: e.incurred_date_text,
    description: `Expense request ${e.request_number}`,
    idempotencyKey: `expense-post:${expenseId}`,
    sourceType: 'EXPENSE_REQUEST',
    sourceId: String(expenseId),
    totalCents: amount,
    lines: [
      {
        accountId: e.expense_account_id,
        debitCents: amount,
        creditCents: 0n,
        description: null,
        serviceLine: e.service_line,
      },
      {
        accountId: e.payment_account_id!,
        debitCents: 0n,
        creditCents: amount,
        description: null,
        serviceLine: e.service_line,
      },
    ],
  };
  const posted = await postInsideTransaction(c, scope, request);
  if (posted.idempotentReplay)
    throw new AccountingIntegrityError(
      'EXPENSE_POSTING_INCONSISTENT',
      'An existing journal is not linked to this expense; review it before posting.',
      409,
    );
  await c.query(
    "UPDATE expense_requests SET status='POSTED',posted_journal_id=$1,updated_at=now() WHERE id=$2",
    [posted.journal.id, expenseId],
  );
  await audit(c, scope, 'POST', 'expense_request', expenseId, {
    journalId: posted.journal.id,
    representsPayment: false,
  });
  return {
    expenseId,
    status: 'POSTED' as const,
    journalId: posted.journal.id,
    idempotentReplay: false,
    paymentRecorded: false,
  };
}

export async function postApprovedExpenseScoped(scope: AccountingScope, expenseId: number) {
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0)
    throw new AccountingIntegrityError('EXPENSE_NOT_FOUND', 'Expense request not found.', 404);
  return transaction((c) => postApprovedExpenseInsideTransaction(c, scope, expenseId));
}

/**
 * A reviewer who also has journal-posting permission explicitly approves the
 * displayed source and accounts, then the payable journal is posted in the
 * same transaction. This records no payment and establishes no standing
 * facility mapping or approval policy for other sources.
 */
export async function approveAndPostExpenseScoped(
  scope: AccountingScope,
  expenseId: number,
  input: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0)
    throw new AccountingIntegrityError('EXPENSE_NOT_FOUND', 'Expense request not found.', 404);
  const notes = requiredText(input.notes, 'Review notes', 1000);
  const reviewedHash = typeof input.reviewHash === 'string' ? input.reviewHash : '';
  if (!/^[a-f0-9]{64}$/.test(reviewedHash))
    throw new AccountingIntegrityError('INVALID_REVIEW', 'A current expense review is required.');
  return transaction(async (c) => {
    const e = await lockedExpenseReview(c, scope, expenseId);
    if (e.requested_by_user_id === scope.actorUserId)
      throw new AccountingIntegrityError(
        'SELF_APPROVAL_FORBIDDEN',
        'A different authorized staff member must review the request.',
        403,
      );
    if (e.status === 'POSTED') {
      const priorAudit = await c.query<{ details: string | null }>(
        `SELECT details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2
          AND resource='expense_request' AND resource_id=$3 AND action='APPROVE'
          ORDER BY id DESC LIMIT 1`,
        [scope.tenantId, scope.facilityId, String(expenseId)],
      );
      let priorHash: unknown = null;
      try {
        priorHash = priorAudit.rows[0]?.details
          ? JSON.parse(priorAudit.rows[0].details).reviewHash
          : null;
      } catch {
        // A missing or unreadable approval snapshot cannot establish a safe replay.
        priorHash = null;
      }
      if (
        e.reviewed_by_user_id !== scope.actorUserId ||
        e.review_notes !== notes ||
        priorHash !== reviewedHash
      )
        throw new AccountingIntegrityError(
          'EXPENSE_ALREADY_REVIEWED',
          'This expense was already reviewed with different or unverified approval details.',
          409,
        );
      // A genuine replay is independent of later account deactivation, but a
      // subsequently reversed or inconsistent journal still requires review.
      return postApprovedExpenseInsideTransaction(c, scope, expenseId);
    }
    if (requireReviewedExpense(e) !== reviewedHash)
      throw new AccountingIntegrityError(
        'EXPENSE_REVIEW_CHANGED',
        'The expense or account details changed; refresh and review them before approval.',
        409,
      );
    if (e.status !== 'SUBMITTED')
      throw new AccountingIntegrityError(
        'EXPENSE_NOT_SUBMITTED',
        'Only submitted requests may be reviewed by this action.',
        409,
      );
    await c.query(
      "UPDATE expense_requests SET status='APPROVED',reviewed_by_user_id=$1,reviewed_at=now(),review_notes=$2,updated_at=now() WHERE id=$3",
      [scope.actorUserId, notes, expenseId],
    );
    await audit(c, scope, 'APPROVE', 'expense_request', expenseId, {
      status: 'APPROVED',
      reviewHash: reviewedHash,
      expenseAccountId: e.expense_account_id,
      payableAccountId: e.payment_account_id,
      postsPayableNotPayment: true,
    });
    return postApprovedExpenseInsideTransaction(c, scope, expenseId);
  });
}

export async function listExpensesScoped(
  scope: AccountingScope,
  input: { search?: unknown; afterId?: unknown; limit?: unknown } = {},
) {
  const search = input.search === undefined ? '' : input.search;
  const afterId = input.afterId === undefined || input.afterId === '' ? 0 : Number(input.afterId);
  const limit = input.limit === undefined || input.limit === '' ? 25 : Number(input.limit);
  if (typeof search !== 'string' || search.trim().length > 80)
    throw new AccountingIntegrityError('INVALID_SEARCH', 'Search must be at most 80 characters.');
  if (
    !Number.isSafeInteger(afterId) ||
    afterId < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new AccountingIntegrityError('INVALID_PAGE', 'Choose a valid expense page.');
  const result = await pool.query<ExpenseReviewRow>(
    `${expenseReviewSelect} WHERE e.tenant_id=$1 AND e.facility_id=$2
      AND ($3::int=0 OR e.id<$3)
      AND ($4::text='' OR e.id::text=$4 OR strpos(lower(e.request_number),lower($4))>0
        OR strpos(lower(e.payee_name),lower($4))>0)
      ORDER BY e.id DESC LIMIT $5`,
    [scope.tenantId, scope.facilityId, afterId, search.trim(), limit + 1],
  );
  const page = result.rows.slice(0, limit);
  return {
    expenses: page.map((e) => ({
      id: e.id,
      requestNumber: e.request_number,
      incurredDate: e.incurred_date_text,
      payeeName: e.payee_name,
      category: e.category,
      amountKes: e.amount_kes,
      currency: e.currency,
      description: e.description,
      serviceLine: e.service_line,
      status: e.status,
      requestedByUserId: e.requested_by_user_id,
      reviewedByUserId: e.reviewed_by_user_id,
      journalId: e.linked_journal_id,
      reversalJournalId: e.reversal_journal_id,
      accountingStatus: expenseAccountingStatus(e),
      expenseAccount: {
        id: e.expense_account_facility === e.facility_id ? e.expense_account_id : null,
        code: e.expense_account_code,
        name: e.expense_account_name,
      },
      payableAccount: {
        id: e.payable_account_facility === e.facility_id ? e.payment_account_id : null,
        code: e.payable_account_code,
        name: e.payable_account_name,
      },
      supportingDocuments: e.supporting_documents,
      ...expenseReview(e),
    })),
    nextAfterId: result.rows.length > limit && page.length ? page[page.length - 1].id : null,
    notice:
      'Supporting documents are references only; file upload and existence verification are not implemented. A posted expense is a payable, not a recorded payment.',
  };
}
