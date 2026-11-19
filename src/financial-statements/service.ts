/**
 * JaliCare HMIS — the financial statement workflow.
 *
 * Generate from the posted ledger, review, approve, freeze, export, retrieve.
 * Every step is facility-scoped and audited through the accounting service's
 * `audit_logs` convention. Nothing in this file posts to the ledger except the
 * explicit year-end close, which posts one journal through the same
 * `postJournalScoped` path every other module uses.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import {
  closeFinancialPeriodScoped,
  postInsideTransaction,
  transaction,
  type AccountingScope,
  type JournalRequest,
} from '../accounting/accounting.service.ts';
import { loadLedgerWindow, normaliseNotes, type StatementScope } from './data.ts';

export type { StatementScope };
import { buildStatementPayload, type BuildStatementInput } from './engine.ts';
import { cents, centsString, sumCents } from './money.ts';
import {
  financialYear,
  financialYearFor,
  periodLabel,
  resolveComparative,
  resolvePeriod,
  type ComparativeMode,
  type Frequency,
  type PeriodSelection,
  type ResolvedPeriod,
} from './period.ts';
import { exportStatements, type ExportFormat, type ExportStatement } from './export.ts';
import type { ManagementNote, StatementPayload, StatementMeta } from './types.ts';
import { classifyAccounts } from './classification.ts';
import { groupsForAccountType } from './groups.ts';

export class FinancialStatementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'FinancialStatementError';
  }
}

const MAX_NOTE = 4000;
const MAX_REASON = 1000;

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new FinancialStatementError(
      'INVALID_INPUT',
      `${name} is required and must be at most ${max} characters.`,
    );
  }
  return value.trim();
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function audit(
  client: PoolClient,
  scope: StatementScope,
  action: string,
  resource: string,
  resourceId: number,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (tenant_id, facility_id, user_id, action, resource, resource_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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

async function actorName(client: PoolClient, scope: StatementScope): Promise<string | null> {
  const { rows } = await client.query(
    'SELECT full_name FROM users WHERE id = $1 AND tenant_id = $2',
    [scope.actorUserId, scope.tenantId],
  );
  return rows[0]?.full_name ?? null;
}

/* ============================================================
   Settings: financial year and the year-end equity account
   ============================================================ */

export interface StatementSettings {
  financialYearStartMonth: number;
  retainedEarningsAccountId: number | null;
  retainedEarningsAccountCode: string | null;
  retainedEarningsAccountName: string | null;
  preparedByName: string | null;
  source: 'CONFIGURED' | 'FIXED_ASSET_SETTINGS' | 'DEFAULT';
  updatedAt: string | null;
}

async function readSettings(client: PoolClient, scope: StatementScope): Promise<StatementSettings> {
  const configured = await client.query(
    `SELECT s.financial_year_start_month, s.retained_earnings_account_id, s.prepared_by_name,
            s.updated_at::text AS updated_at,
            a.account_code, a.account_name
       FROM financial_statement_settings s
       LEFT JOIN chart_of_accounts a ON a.id = s.retained_earnings_account_id
      WHERE s.tenant_id = $1 AND s.facility_id = $2`,
    [scope.tenantId, scope.facilityId],
  );
  if (configured.rows.length) {
    const row = configured.rows[0];
    return {
      financialYearStartMonth: Number(row.financial_year_start_month),
      retainedEarningsAccountId:
        row.retained_earnings_account_id === null ? null : Number(row.retained_earnings_account_id),
      retainedEarningsAccountCode: row.account_code ?? null,
      retainedEarningsAccountName: row.account_name ?? null,
      preparedByName: row.prepared_by_name ?? null,
      source: 'CONFIGURED',
      updatedAt: row.updated_at ?? null,
    };
  }

  // A facility that configured depreciation has already answered this question
  // for its asset register. Reusing that answer keeps the year consistent; it
  // is not a new default being invented here.
  const assets = await client.query(
    `SELECT financial_year_start_month FROM fixed_asset_settings
      WHERE tenant_id = $1 AND facility_id = $2`,
    [scope.tenantId, scope.facilityId],
  );
  if (assets.rows.length) {
    return {
      financialYearStartMonth: Number(assets.rows[0].financial_year_start_month),
      retainedEarningsAccountId: null,
      retainedEarningsAccountCode: null,
      retainedEarningsAccountName: null,
      preparedByName: null,
      source: 'FIXED_ASSET_SETTINGS',
      updatedAt: null,
    };
  }

  return {
    financialYearStartMonth: 7,
    retainedEarningsAccountId: null,
    retainedEarningsAccountCode: null,
    retainedEarningsAccountName: null,
    preparedByName: null,
    source: 'DEFAULT',
    updatedAt: null,
  };
}

export async function getSettingsScoped(scope: StatementScope): Promise<StatementSettings> {
  return transaction((client) => readSettings(client, scope));
}

export async function saveSettingsScoped(
  scope: StatementScope,
  input: Record<string, unknown>,
): Promise<StatementSettings> {
  const startMonth = Number(input.financialYearStartMonth);
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new FinancialStatementError(
      'INVALID_START_MONTH',
      'The financial year start month must be between 1 (January) and 12 (December).',
    );
  }
  const preparedByName =
    input.preparedByName === null ||
    input.preparedByName === undefined ||
    input.preparedByName === ''
      ? null
      : requiredText(input.preparedByName, 'Prepared by', 160);

  let retainedAccountId: number | null = null;
  if (input.retainedEarningsAccountId !== null && input.retainedEarningsAccountId !== undefined) {
    const candidate = Number(input.retainedEarningsAccountId);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) {
      throw new FinancialStatementError('INVALID_ACCOUNT', 'Choose a retained earnings account.');
    }
    retainedAccountId = candidate;
  }

  await transaction(async (client) => {
    if (retainedAccountId !== null) {
      const account = await client.query(
        `SELECT id, account_type, is_active FROM chart_of_accounts
          WHERE id = $1 AND tenant_id = $2 AND facility_id = $3`,
        [retainedAccountId, scope.tenantId, scope.facilityId],
      );
      if (!account.rows.length) {
        throw new FinancialStatementError(
          'ACCOUNT_NOT_FOUND',
          'That account is not in this facility’s chart.',
          404,
        );
      }
      if (account.rows[0].account_type !== 'EQUITY') {
        throw new FinancialStatementError(
          'ACCOUNT_NOT_EQUITY',
          'A year-end close can only be absorbed by an equity account. Choose a partners’ capital or retained earnings account.',
        );
      }
      if (!account.rows[0].is_active) {
        throw new FinancialStatementError(
          'ACCOUNT_INACTIVE',
          'That equity account is inactive and cannot receive a year-end close.',
        );
      }
    }

    await client.query(
      `INSERT INTO financial_statement_settings
         (tenant_id, facility_id, financial_year_start_month, retained_earnings_account_id,
          prepared_by_name, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (facility_id) DO UPDATE SET
         financial_year_start_month = EXCLUDED.financial_year_start_month,
         retained_earnings_account_id = EXCLUDED.retained_earnings_account_id,
         prepared_by_name = EXCLUDED.prepared_by_name,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = now()`,
      [
        scope.tenantId,
        scope.facilityId,
        startMonth,
        retainedAccountId,
        preparedByName,
        scope.actorUserId,
      ],
    );

    // Keep the depreciation periods aligned with the financial year, when that
    // facility already keeps a fixed-asset policy. Never create that policy here.
    await client.query(
      `UPDATE fixed_asset_settings SET financial_year_start_month = $1, updated_at = now()
        WHERE tenant_id = $2 AND facility_id = $3`,
      [startMonth, scope.tenantId, scope.facilityId],
    );

    await audit(client, scope, 'UPDATE', 'financial_statement_settings', scope.facilityId, {
      financialYearStartMonth: startMonth,
      retainedEarningsAccountId: retainedAccountId,
    });
  });

  return getSettingsScoped(scope);
}

/* ============================================================
   Presentation mapping
   ============================================================ */

export async function listMappingScoped(scope: StatementScope) {
  return transaction(async (client) => {
    const [accounts, overrides] = await Promise.all([
      client.query(
        `SELECT id, account_code AS code, account_name AS name, account_type AS type,
                sub_type AS "subType", is_active AS "isActive"
           FROM chart_of_accounts
          WHERE tenant_id = $1 AND facility_id = $2
          ORDER BY account_code`,
        [scope.tenantId, scope.facilityId],
      ),
      client.query(
        `SELECT account_id, presentation_group FROM financial_statement_account_groups
          WHERE tenant_id = $1 AND facility_id = $2`,
        [scope.tenantId, scope.facilityId],
      ),
    ]);
    const overrideMap = new Map<number, string>(
      overrides.rows.map((row) => [Number(row.account_id), String(row.presentation_group)]),
    );
    const classified = classifyAccounts(
      accounts.rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        name: row.name,
        type: row.type,
        subType: row.subType,
      })),
      overrideMap,
    );
    return accounts.rows.map((row) => {
      const entry = classified.get(Number(row.id))!;
      return {
        accountId: Number(row.id),
        accountCode: row.code,
        accountName: row.name,
        accountType: row.type,
        subType: row.subType,
        isActive: row.isActive,
        presentationGroup: entry.group,
        source: entry.source,
      };
    });
  });
}

export async function saveMappingScoped(scope: StatementScope, input: Record<string, unknown>) {
  const accountId = Number(input.accountId);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new FinancialStatementError('INVALID_ACCOUNT', 'Choose an account to map.');
  }
  const raw = input.presentationGroup;
  const clear = raw === null || raw === undefined || raw === '';
  const group = clear ? null : String(raw);

  await transaction(async (client) => {
    const account = await client.query(
      `SELECT id, account_type FROM chart_of_accounts
        WHERE id = $1 AND tenant_id = $2 AND facility_id = $3`,
      [accountId, scope.tenantId, scope.facilityId],
    );
    if (!account.rows.length) {
      throw new FinancialStatementError(
        'ACCOUNT_NOT_FOUND',
        'That account is not in this facility’s chart.',
        404,
      );
    }
    if (group !== null) {
      const allowed = groupsForAccountType(account.rows[0].account_type);
      if (!allowed.includes(group as never)) {
        throw new FinancialStatementError(
          'INVALID_GROUP',
          `"${group}" is not a presentation group for a ${account.rows[0].account_type.toLowerCase()} account. Choose one of: ${allowed.join(', ')}.`,
        );
      }
    }
    if (clear) {
      await client.query(
        `DELETE FROM financial_statement_account_groups
          WHERE tenant_id = $1 AND facility_id = $2 AND account_id = $3`,
        [scope.tenantId, scope.facilityId, accountId],
      );
    } else {
      await client.query(
        `INSERT INTO financial_statement_account_groups
           (tenant_id, facility_id, account_id, presentation_group, updated_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (facility_id, account_id) DO UPDATE SET
           presentation_group = EXCLUDED.presentation_group,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
        [scope.tenantId, scope.facilityId, accountId, group, scope.actorUserId],
      );
    }
    await audit(client, scope, 'UPDATE', 'financial_statement_account_group', accountId, {
      presentationGroup: group,
    });
  });

  return listMappingScoped(scope);
}

/* ============================================================
   Generation
   ============================================================ */

export interface GenerateStatementInput {
  frequency: Frequency;
  startYear?: number;
  month?: number;
  quarter?: number;
  startDate?: string;
  endDate?: string;
  comparativeMode?: ComparativeMode;
  accountingBasis?: string;
  notes?: ManagementNote[];
}

export interface GeneratedRun {
  id: number;
  version: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  financialYear: string;
  frequency: string;
  readyForApproval: boolean;
  failedChecks: Array<{ code: string; label: string; detail: string }>;
}

/**
 * A selection that names a date range outside its financial year, or a month
 * the financial year does not contain, is a bad request and not a server
 * fault. The range resolver stays a pure function and this wrapper translates
 * its message into the route's error contract.
 */
function resolvePeriodOrThrow(selection: PeriodSelection, startMonth: number): ResolvedPeriod {
  try {
    return resolvePeriod(selection, startMonth);
  } catch (error) {
    throw new FinancialStatementError('INVALID_PERIOD', (error as Error).message, 400);
  }
}

function assertBasis(value: unknown): 'ACCRUAL' {
  const basis = value === undefined || value === null ? 'ACCRUAL' : String(value);
  if (basis !== 'ACCRUAL') {
    throw new FinancialStatementError(
      'BASIS_NOT_SUPPORTED',
      'Only the accrual basis is supported. The ledger posts revenue when invoiced and expenses when billed; a cash-basis statement would have to be derived from payments and is not produced here.',
      422,
    );
  }
  return 'ACCRUAL';
}

async function buildMeta(
  client: PoolClient,
  scope: StatementScope,
  period: ResolvedPeriod,
  comparativeMode: ComparativeMode,
  basis: 'ACCRUAL',
  ledger: Awaited<ReturnType<typeof loadLedgerWindow>>,
): Promise<StatementMeta> {
  const settings = await readSettings(client, scope);
  const comparative = resolveComparative(period, comparativeMode);
  const name = await actorName(client, scope);
  return {
    facilityId: scope.facilityId,
    facilityName: ledger.facility.name,
    facilityCode: ledger.facility.code,
    facilityAddress:
      [ledger.facility.address, ledger.facility.county].filter(Boolean).join(', ') || null,
    currency: ledger.facility.currency,
    frequency: period.frequency,
    financialYear: period.financialYear,
    financialYearStartMonth: settings.financialYearStartMonth,
    periodStart: period.start,
    periodEnd: period.end,
    periodLabel: period.label,
    comparativeMode,
    comparativeStart: comparative.range?.start ?? null,
    comparativeEnd: comparative.range?.end ?? null,
    comparativeLabel: comparative.label,
    accountingBasis: basis,
    basisNote:
      'Accrual basis: revenue is recognised when invoiced and expenses when the liability is recorded, from posted journals only. ' +
      'Draft, reversed and unposted journals are excluded by journal status.',
    generatedAt: new Date().toISOString(),
    generatedByName: name,
    ledgerThrough: ledger.ledgerThrough,
    journalCount: ledger.journalCount,
    sourcePeriods: ledger.sourcePeriods,
  };
}

/**
 * Generate one statement set. A period that already carries an approved or
 * reviewed statement cannot be generated again: the caller must revise that
 * statement so the archive keeps a version chain rather than two competing
 * "current" figures.
 */
export async function generateScoped(
  scope: StatementScope,
  input: GenerateStatementInput,
  notes: ManagementNote[] = [],
): Promise<GeneratedRun> {
  const basis = assertBasis(input.accountingBasis);
  const comparativeMode: ComparativeMode = input.comparativeMode ?? 'PRIOR_PERIOD';
  if (!['PRIOR_PERIOD', 'PRIOR_YEAR', 'NONE'].includes(comparativeMode)) {
    throw new FinancialStatementError(
      'INVALID_COMPARATIVE',
      'Choose a supported comparative mode.',
    );
  }

  return transaction(async (client) => {
    const settings = await readSettings(client, scope);
    const period = resolvePeriodOrThrow(
      {
        frequency: input.frequency,
        startYear: input.startYear,
        month: input.month,
        quarter: input.quarter,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      settings.financialYearStartMonth,
    );

    const existing = await client.query(
      `SELECT id, version, status FROM financial_statement_runs
        WHERE tenant_id = $1 AND facility_id = $2 AND period_start = $3::date AND period_end = $4::date
          AND status IN ('REVIEWED', 'APPROVED')
        FOR UPDATE`,
      [scope.tenantId, scope.facilityId, period.start, period.end],
    );
    if (existing.rows.length) {
      throw new FinancialStatementError(
        'STATEMENT_FINALISED',
        `Version ${existing.rows[0].version} of this period is already ${String(existing.rows[0].status).toLowerCase()}. ` +
          'Approved and reviewed statements are not overwritten: revise the existing statement to create the next version.',
        409,
      );
    }

    const ledger = await loadLedgerWindow(client, scope, {
      periodStart: period.start,
      periodEnd: period.end,
      comparativeStart: resolveComparative(period, comparativeMode).range?.start ?? null,
      comparativeEnd: resolveComparative(period, comparativeMode).range?.end ?? null,
    });

    const meta = await buildMeta(client, scope, period, comparativeMode, basis, ledger);
    const buildInput: BuildStatementInput = {
      meta,
      accounts: ledger.accounts,
      movements: ledger.movements,
      tradingMovements: ledger.tradingMovements,
      overrides: await client
        .query(
          `SELECT account_id, presentation_group FROM financial_statement_account_groups
            WHERE tenant_id = $1 AND facility_id = $2`,
          [scope.tenantId, scope.facilityId],
        )
        .then(
          (result) =>
            new Map<number, string>(
              result.rows.map((row) => [Number(row.account_id), String(row.presentation_group)]),
            ),
        ),
      journalLines: ledger.journalLines,
      partyLines: ledger.partyLines,
      bankAccounts: ledger.bankAccounts,
      fixedAssets: ledger.fixedAssets,
      depreciation: ledger.depreciation,
      partnerEquity: ledger.partnerEquity,
      priorApproved: ledger.priorApproved,
      notes,
    };

    const payload = buildStatementPayload(buildInput);
    const versionRow = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM financial_statement_runs
        WHERE tenant_id = $1 AND facility_id = $2 AND period_start = $3::date AND period_end = $4::date`,
      [scope.tenantId, scope.facilityId, period.start, period.end],
    );

    const inserted = await client.query(
      `INSERT INTO financial_statement_runs
         (tenant_id, facility_id, frequency, financial_year, period_start, period_end,
          comparative_start, comparative_end, comparative_mode, accounting_basis, version,
          status, generated_by, source_period_ids, ledger_through, journal_count,
          payload, payload_hash, checks, notes)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::date,$8::date,$9,$10,$11,'DRAFT',$12,
               (SELECT COALESCE(ARRAY_AGG(id), '{}'::int[]) FROM financial_periods
                 WHERE tenant_id=$1 AND facility_id=$2 AND start_date <= $6::date AND end_date >= $5::date),
               $13, $14, $15::jsonb, $16, $17::jsonb, $18::jsonb)
       RETURNING id, version`,
      [
        scope.tenantId,
        scope.facilityId,
        period.frequency,
        period.financialYear,
        period.start,
        period.end,
        meta.comparativeStart,
        meta.comparativeEnd,
        comparativeMode,
        basis,
        Number(versionRow.rows[0].next_version),
        scope.actorUserId,
        meta.ledgerThrough,
        meta.journalCount,
        JSON.stringify(payload),
        sha256(payload),
        JSON.stringify(payload.checks),
        JSON.stringify(payload.notes),
      ],
    );

    const runId = Number(inserted.rows[0].id);
    await audit(client, scope, 'GENERATE', 'financial_statement_run', runId, {
      periodStart: period.start,
      periodEnd: period.end,
      frequency: period.frequency,
      financialYear: period.financialYear,
      version: Number(inserted.rows[0].version),
      readyForApproval: payload.readyForApproval,
      failingChecks: payload.checks
        .filter((check) => check.status === 'FAIL')
        .map((check) => check.code),
    });

    return {
      id: runId,
      version: Number(inserted.rows[0].version),
      status: 'DRAFT',
      periodStart: period.start,
      periodEnd: period.end,
      financialYear: period.financialYear,
      frequency: period.frequency,
      readyForApproval: payload.readyForApproval,
      failedChecks: payload.checks
        .filter((check) => check.status === 'FAIL')
        .map((check) => ({ code: check.code, label: check.label, detail: check.detail })),
    };
  });
}

/* ============================================================
   Archive
   ============================================================ */

export interface RunSummary {
  id: number;
  frequency: string;
  financialYear: string;
  periodStart: string;
  periodEnd: string;
  accountingBasis: string;
  version: number;
  status: string;
  generatedAt: string;
  generatedByName: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  failingChecks: number;
  exportCount: number;
  supersedesId: number | null;
}

export async function listRunsScoped(
  scope: StatementScope,
  filters: { financialYear?: string; frequency?: string; status?: string; limit?: number } = {},
): Promise<RunSummary[]> {
  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 200);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.frequency, r.financial_year, r.period_start::text AS period_start,
              r.period_end::text AS period_end, r.accounting_basis, r.version, r.status,
              r.generated_at::text AS generated_at, g.full_name AS generated_by_name,
              r.reviewed_at::text AS reviewed_at, r.approved_at::text AS approved_at,
              a.full_name AS approved_by_name, r.supersedes_id,
              COALESCE((SELECT COUNT(*)::int FROM jsonb_array_elements(r.checks) c
                         WHERE c->>'status' = 'FAIL'), 0) AS failing_checks,
              (SELECT COUNT(*)::int FROM financial_statement_exports e WHERE e.run_id = r.id) AS export_count
         FROM financial_statement_runs r
         LEFT JOIN users g ON g.id = r.generated_by
         LEFT JOIN users a ON a.id = r.approved_by
        WHERE r.tenant_id = $1 AND r.facility_id = $2
          AND ($3::text IS NULL OR r.financial_year = $3)
          AND ($4::text IS NULL OR r.frequency = $4)
          AND ($5::text IS NULL OR r.status = $5)
        ORDER BY r.period_end DESC, r.version DESC
        LIMIT $6`,
      [
        scope.tenantId,
        scope.facilityId,
        filters.financialYear ?? null,
        filters.frequency ?? null,
        filters.status ?? null,
        limit,
      ],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      frequency: row.frequency,
      financialYear: row.financial_year,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      accountingBasis: row.accounting_basis,
      version: Number(row.version),
      status: row.status,
      generatedAt: row.generated_at,
      generatedByName: row.generated_by_name ?? null,
      reviewedAt: row.reviewed_at ?? null,
      approvedAt: row.approved_at ?? null,
      approvedByName: row.approved_by_name ?? null,
      failingChecks: Number(row.failing_checks),
      exportCount: Number(row.export_count),
      supersedesId: row.supersedes_id === null ? null : Number(row.supersedes_id),
    }));
  });
}

export async function getRunScoped(scope: StatementScope, runId: number) {
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new FinancialStatementError('INVALID_RUN', 'Invalid statement id.');
  }
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.*, r.period_start::text AS period_start, r.period_end::text AS period_end,
              r.comparative_start::text AS comparative_start, r.comparative_end::text AS comparative_end,
              r.generated_at::text AS generated_at, r.reviewed_at::text AS reviewed_at,
              r.approved_at::text AS approved_at, r.ledger_through::text AS ledger_through,
              g.full_name AS generated_by_name, v.full_name AS reviewed_by_name,
              a.full_name AS approved_by_name
         FROM financial_statement_runs r
         LEFT JOIN users g ON g.id = r.generated_by
         LEFT JOIN users v ON v.id = r.reviewed_by
         LEFT JOIN users a ON a.id = r.approved_by
        WHERE r.id = $1 AND r.tenant_id = $2 AND r.facility_id = $3`,
      [runId, scope.tenantId, scope.facilityId],
    );
    if (!rows.length) {
      throw new FinancialStatementError(
        'RUN_NOT_FOUND',
        'Statement not found in this facility.',
        404,
      );
    }
    const row = rows[0];
    const exports = await client.query(
      `SELECT e.id, e.format, e.statement, e.filename, e.byte_size, e.exported_at::text AS exported_at,
              u.full_name AS exported_by_name
         FROM financial_statement_exports e
         LEFT JOIN users u ON u.id = e.exported_by
        WHERE e.run_id = $1 AND e.tenant_id = $2 AND e.facility_id = $3
        ORDER BY e.exported_at DESC`,
      [runId, scope.tenantId, scope.facilityId],
    );
    const chain = await client.query(
      ` WITH RECURSIVE chain AS (
          SELECT id, version, status, supersedes_id, period_start::text AS period_start,
                 period_end::text AS period_end, generated_at::text AS generated_at
            FROM financial_statement_runs WHERE id = $1
          UNION ALL
          SELECT r.id, r.version, r.status, r.supersedes_id, r.period_start::text,
                 r.period_end::text, r.generated_at::text
            FROM financial_statement_runs r JOIN chain c ON r.id = c.supersedes_id
        )
        SELECT * FROM chain ORDER BY version`,
      [runId],
    );
    const events = await client.query(
      `SELECT action, user_id, timestamp::text AS "at", details
         FROM audit_logs
        WHERE tenant_id = $1 AND facility_id = $2 AND resource = 'financial_statement_run'
          AND resource_id = $3::text
        ORDER BY timestamp DESC, id DESC LIMIT 100`,
      [scope.tenantId, scope.facilityId, String(runId)],
    );

    const watermark = await client.query(
      `SELECT COUNT(*)::int AS journal_count, MAX(posted_at)::text AS ledger_through
         FROM journal_entries
        WHERE tenant_id = $1 AND facility_id = $2 AND status = 'POSTED' AND entry_date <= $3::date`,
      [scope.tenantId, scope.facilityId, row.period_end],
    );
    const currentJournals = Number(watermark.rows[0]?.journal_count ?? 0);
    const currentWatermark = watermark.rows[0]?.ledger_through ?? null;

    return {
      id: Number(row.id),
      facilityId: Number(row.facility_id),
      frequency: row.frequency,
      financialYear: row.financial_year,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      comparativeStart: row.comparative_start,
      comparativeEnd: row.comparative_end,
      comparativeMode: row.comparative_mode,
      accountingBasis: row.accounting_basis,
      version: Number(row.version),
      status: row.status,
      supersedesId: row.supersedes_id === null ? null : Number(row.supersedes_id),
      generatedAt: row.generated_at,
      generatedByName: row.generated_by_name ?? null,
      reviewedAt: row.reviewed_at,
      reviewedByName: row.reviewed_by_name ?? null,
      approvedAt: row.approved_at,
      approvedByName: row.approved_by_name ?? null,
      ledgerThrough: row.ledger_through,
      journalCount: Number(row.journal_count),
      payloadHash: row.payload_hash,
      payload: row.payload as StatementPayload,
      checks: row.checks,
      notes: row.notes,
      exports: exports.rows.map((entry) => ({
        id: Number(entry.id),
        format: entry.format,
        statement: entry.statement,
        filename: entry.filename,
        byteSize: Number(entry.byte_size),
        exportedAt: entry.exported_at,
        exportedByName: entry.exported_by_name ?? null,
      })),
      versions: chain.rows.map((entry) => ({
        id: Number(entry.id),
        version: Number(entry.version),
        status: entry.status,
        periodStart: entry.period_start,
        periodEnd: entry.period_end,
        generatedAt: entry.generated_at,
      })),
      events: events.rows,
      /**
       * Computed, never stored: a reader can see that the ledger moved after
       * approval without the approved figures themselves changing.
       */
      staleSinceApproval:
        row.status === 'APPROVED' &&
        (currentJournals !== Number(row.journal_count) || currentWatermark !== row.ledger_through),
    };
  });
}

/* ============================================================
   Review, approval and revision
   ============================================================ */

export async function reviewRunScoped(scope: StatementScope, runId: number, comment: unknown) {
  const note =
    comment === null || comment === undefined || comment === ''
      ? null
      : requiredText(comment, 'Review comment', MAX_REASON);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, payload FROM financial_statement_runs
        WHERE id = $1 AND tenant_id = $2 AND facility_id = $3 FOR UPDATE`,
      [runId, scope.tenantId, scope.facilityId],
    );
    if (!rows.length) {
      throw new FinancialStatementError(
        'RUN_NOT_FOUND',
        'Statement not found in this facility.',
        404,
      );
    }
    if (rows[0].status !== 'DRAFT') {
      throw new FinancialStatementError(
        'INVALID_STATUS',
        `Only a draft statement can be reviewed; this one is ${String(rows[0].status).toLowerCase()}.`,
        409,
      );
    }
    const payload = rows[0].payload as StatementPayload;
    if (!payload.readyForApproval) {
      throw new FinancialStatementError(
        'CHECKS_FAILING',
        'A statement with failing checks cannot be sent for approval. Resolve the failing checks and generate a new version.',
        409,
      );
    }
    await client.query(
      `UPDATE financial_statement_runs SET status='REVIEWED', reviewed_by=$1, reviewed_at=now()
        WHERE id=$2`,
      [scope.actorUserId, runId],
    );
    await audit(client, scope, 'REVIEW', 'financial_statement_run', runId, { comment: note });
    return { id: runId, status: 'REVIEWED' };
  });
}

export interface ApprovalResult {
  id: number;
  status: 'APPROVED';
  periodClose:
    { closed: true; periodId: number; periodCode: string } | { closed: false; reason: string };
  supersededRunId: number | null;
}

export async function approveRunScoped(
  scope: StatementScope,
  runId: number,
  comment: unknown,
): Promise<ApprovalResult> {
  const note = requiredText(comment, 'Approval note', MAX_REASON);

  const result = await transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.*, r.period_start::text AS period_start, r.period_end::text AS period_end,
              r.ledger_through::text AS ledger_through
         FROM financial_statement_runs r
        WHERE r.id = $1 AND r.tenant_id = $2 AND r.facility_id = $3 FOR UPDATE`,
      [runId, scope.tenantId, scope.facilityId],
    );
    if (!rows.length) {
      throw new FinancialStatementError(
        'RUN_NOT_FOUND',
        'Statement not found in this facility.',
        404,
      );
    }
    const row = rows[0];
    if (row.status === 'APPROVED') {
      throw new FinancialStatementError(
        'ALREADY_APPROVED',
        'This statement is already approved.',
        409,
      );
    }
    if (row.status === 'SUPERSEDED') {
      throw new FinancialStatementError(
        'SUPERSEDED',
        'This statement has been superseded. Approve the later version instead.',
        409,
      );
    }
    if (row.status !== 'REVIEWED') {
      throw new FinancialStatementError(
        'REVIEW_REQUIRED',
        'A statement must be reviewed before it can be approved by a second person.',
        409,
      );
    }
    if (Number(row.reviewed_by) === scope.actorUserId) {
      throw new FinancialStatementError(
        'SEPARATION_OF_DUTIES',
        'The reviewer cannot also approve the statement. A different authorised user must approve it.',
        403,
      );
    }

    const payload = row.payload as StatementPayload;
    if (!payload.readyForApproval) {
      throw new FinancialStatementError(
        'CHECKS_FAILING',
        'The archived checks include a failure. Generate a new version after resolving it.',
        409,
      );
    }

    const watermark = await client.query(
      `SELECT COUNT(*)::int AS journal_count, MAX(posted_at)::text AS ledger_through
         FROM journal_entries
        WHERE tenant_id = $1 AND facility_id = $2 AND status = 'POSTED' AND entry_date <= $3::date`,
      [scope.tenantId, scope.facilityId, row.period_end],
    );
    if (
      Number(watermark.rows[0]?.journal_count ?? 0) !== Number(row.journal_count) ||
      (watermark.rows[0]?.ledger_through ?? null) !== (row.ledger_through ?? null)
    ) {
      throw new FinancialStatementError(
        'LEDGER_MOVED',
        'The ledger has received postings since this statement was generated, so the figures no longer describe the current ledger. ' +
          'Generate a new version from the current ledger and review it.',
        409,
      );
    }

    /*
     * Supersede the earlier version first: only one approved statement may
     * exist for a period, so the old one must step aside before the new one
     * takes its place. Both statements are in this transaction, so a failure
     * leaves the archive exactly as it was.
     */
    let supersededRunId: number | null = null;
    if (row.supersedes_id !== null) {
      const superseded = await client.query(
        `UPDATE financial_statement_runs SET status='SUPERSEDED'
          WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND status='APPROVED'
          RETURNING id`,
        [row.supersedes_id, scope.tenantId, scope.facilityId],
      );
      if (superseded.rows.length) supersededRunId = Number(superseded.rows[0].id);
    }

    await client.query(
      `UPDATE financial_statement_runs SET status='APPROVED', approved_by=$1, approved_at=now()
        WHERE id=$2`,
      [scope.actorUserId, runId],
    );

    await audit(client, scope, 'APPROVE', 'financial_statement_run', runId, {
      version: Number(row.version),
      comment: note,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      supersededRunId,
    });

    const period = await client.query(
      `SELECT id, period_code, status FROM financial_periods
        WHERE tenant_id = $1 AND facility_id = $2
          AND start_date = $3::date AND end_date = $4::date`,
      [scope.tenantId, scope.facilityId, row.period_start, row.period_end],
    );

    return {
      id: runId,
      supersededRunId,
      period: period.rows[0]
        ? {
            id: Number(period.rows[0].id),
            code: String(period.rows[0].period_code),
            status: String(period.rows[0].status),
          }
        : null,
    };
  });

  let periodClose: ApprovalResult['periodClose'];
  if (!result.period) {
    periodClose = {
      closed: false,
      reason:
        'No financial period exactly matches this statement period, so the ledger period was left open. ' +
        'Statements do not close a period they do not match.',
    };
  } else if (result.period.status === 'CLOSED') {
    periodClose = { closed: false, reason: `Period ${result.period.code} was already closed.` };
  } else {
    try {
      await closeFinancialPeriodScoped(
        scope as AccountingScope,
        result.period.id,
        `Closed with approved financial statements version ${result.id}. ${note}`,
      );
      periodClose = { closed: true, periodId: result.period.id, periodCode: result.period.code };
    } catch (error) {
      periodClose = {
        closed: false,
        reason:
          error instanceof Error
            ? `The statement was approved, but the period could not be closed: ${error.message}`
            : 'The statement was approved, but the period could not be closed.',
      };
    }
  }

  return {
    id: result.id,
    status: 'APPROVED',
    periodClose,
    supersededRunId: result.supersededRunId,
  };
}

/**
 * A revised statement is a new draft version of the same period, rebuilt from
 * the current ledger. The approved version stays approved — and keeps its own
 * figures — until the revision is approved, at which point it becomes
 * superseded.
 */
export async function reviseRunScoped(scope: StatementScope, runId: number, reason: unknown) {
  const why = requiredText(reason, 'Revision reason', MAX_REASON);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, frequency, financial_year, period_start::text AS period_start,
              period_end::text AS period_end, comparative_mode, comparative_start::text AS comparative_start,
              comparative_end::text AS comparative_end, version
         FROM financial_statement_runs
        WHERE id = $1 AND tenant_id = $2 AND facility_id = $3 FOR UPDATE`,
      [runId, scope.tenantId, scope.facilityId],
    );
    if (!rows.length) {
      throw new FinancialStatementError(
        'RUN_NOT_FOUND',
        'Statement not found in this facility.',
        404,
      );
    }
    const row = rows[0];
    if (row.status === 'SUPERSEDED') {
      throw new FinancialStatementError(
        'SUPERSEDED',
        'A superseded statement cannot be revised. Revise the version that replaced it.',
        409,
      );
    }
    const newer = await client.query(
      `SELECT id, version, status FROM financial_statement_runs
        WHERE tenant_id = $1 AND facility_id = $2 AND period_start = $3::date AND period_end = $4::date
          AND version > $5 AND status IN ('REVIEWED', 'APPROVED')
        LIMIT 1`,
      [scope.tenantId, scope.facilityId, row.period_start, row.period_end, row.version],
    );
    if (newer.rows.length) {
      throw new FinancialStatementError(
        'NEWER_VERSION_EXISTS',
        `Version ${newer.rows[0].version} already exists for this period and is ${String(newer.rows[0].status).toLowerCase()}.`,
        409,
      );
    }

    await audit(client, scope, 'REVISE_REQUESTED', 'financial_statement_run', runId, {
      reason: why,
    });

    // Reuse the period dates exactly: a revision covers the same span, not a
    // freshly interpreted one.
    const period: ResolvedPeriod = {
      frequency: row.frequency as Frequency,
      financialYear: row.financial_year,
      start: row.period_start,
      end: row.period_end,
      label: periodLabel(row.period_start, row.period_end),
      isFullFinancialYear: false,
    };

    const comparativeMode = row.comparative_mode as ComparativeMode;
    const comparative = resolveComparative(period, comparativeMode);

    const ledger = await loadLedgerWindow(client, scope, {
      periodStart: period.start,
      periodEnd: period.end,
      comparativeStart: comparative.range?.start ?? null,
      comparativeEnd: comparative.range?.end ?? null,
    });
    const meta = await buildMeta(client, scope, period, comparativeMode, 'ACCRUAL', ledger);
    const overrides = await client
      .query(
        `SELECT account_id, presentation_group FROM financial_statement_account_groups
          WHERE tenant_id = $1 AND facility_id = $2`,
        [scope.tenantId, scope.facilityId],
      )
      .then(
        (result) =>
          new Map<number, string>(
            result.rows.map((entry) => [
              Number(entry.account_id),
              String(entry.presentation_group),
            ]),
          ),
      );

    const payload = buildStatementPayload({
      meta,
      accounts: ledger.accounts,
      movements: ledger.movements,
      tradingMovements: ledger.tradingMovements,
      overrides,
      journalLines: ledger.journalLines,
      partyLines: ledger.partyLines,
      bankAccounts: ledger.bankAccounts,
      fixedAssets: ledger.fixedAssets,
      depreciation: ledger.depreciation,
      partnerEquity: ledger.partnerEquity,
      priorApproved: ledger.priorApproved,
      notes: [],
    });

    const nextVersion = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM financial_statement_runs
        WHERE tenant_id = $1 AND facility_id = $2 AND period_start = $3::date AND period_end = $4::date`,
      [scope.tenantId, scope.facilityId, period.start, period.end],
    );

    const inserted = await client.query(
      `INSERT INTO financial_statement_runs
         (tenant_id, facility_id, frequency, financial_year, period_start, period_end,
          comparative_start, comparative_end, comparative_mode, accounting_basis, version,
          supersedes_id, status, generated_by, source_period_ids, ledger_through, journal_count,
          payload, payload_hash, checks, notes)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::date,$8::date,$9,'ACCRUAL',$10,$11,'DRAFT',$12,
               (SELECT COALESCE(ARRAY_AGG(id), '{}'::int[]) FROM financial_periods
                 WHERE tenant_id=$1 AND facility_id=$2 AND start_date <= $6::date AND end_date >= $5::date),
               $13, $14, $15::jsonb, $16, $17::jsonb, '[]'::jsonb)
       RETURNING id, version`,
      [
        scope.tenantId,
        scope.facilityId,
        period.frequency,
        period.financialYear,
        period.start,
        period.end,
        meta.comparativeStart,
        meta.comparativeEnd,
        comparativeMode,
        Number(nextVersion.rows[0].next_version),
        runId,
        scope.actorUserId,
        meta.ledgerThrough,
        meta.journalCount,
        JSON.stringify(payload),
        sha256(payload),
        JSON.stringify(payload.checks),
      ],
    );

    await audit(client, scope, 'REVISE', 'financial_statement_run', Number(inserted.rows[0].id), {
      supersedes: runId,
      reason: why,
      version: Number(inserted.rows[0].version),
      failingChecks: payload.checks
        .filter((check) => check.status === 'FAIL')
        .map((check) => check.code),
    });

    return {
      id: Number(inserted.rows[0].id),
      version: Number(inserted.rows[0].version),
      status: 'DRAFT',
      supersedesId: runId,
      readyForApproval: payload.readyForApproval,
      failedChecks: payload.checks
        .filter((check) => check.status === 'FAIL')
        .map((check) => ({ code: check.code, label: check.label, detail: check.detail })),
    };
  });
}

export async function addNoteScoped(
  scope: StatementScope,
  runId: number,
  input: Record<string, unknown>,
) {
  const body = requiredText(input.body, 'Note', MAX_NOTE);
  const title =
    input.title === undefined || input.title === ''
      ? 'Management note'
      : requiredText(input.title, 'Note title', 160);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, payload, notes FROM financial_statement_runs
        WHERE id = $1 AND tenant_id = $2 AND facility_id = $3 FOR UPDATE`,
      [runId, scope.tenantId, scope.facilityId],
    );
    if (!rows.length) {
      throw new FinancialStatementError(
        'RUN_NOT_FOUND',
        'Statement not found in this facility.',
        404,
      );
    }
    if (!['DRAFT', 'REVIEWED'].includes(rows[0].status)) {
      throw new FinancialStatementError(
        'NOTE_LOCKED',
        'An approved statement is immutable. Add the note to a revised version instead.',
        409,
      );
    }
    const payload = rows[0].payload as StatementPayload;
    const name = await actorName(client, scope);
    const payloadNotes = normaliseNotes(payload.notes);
    const next: ManagementNote = {
      noteRef: String(payloadNotes.length + 1),
      title,
      body,
      authorUserId: scope.actorUserId,
      authorName: name,
      recordedAt: new Date().toISOString(),
    };
    const notes = [...payloadNotes, next];
    const updatedPayload = { ...payload, notes };
    await client.query(
      `UPDATE financial_statement_runs
          SET payload = $1::jsonb, payload_hash = $2, notes = $3::jsonb
        WHERE id = $4`,
      [JSON.stringify(updatedPayload), sha256(updatedPayload), JSON.stringify(notes), runId],
    );
    await audit(client, scope, 'NOTE_ADDED', 'financial_statement_run', runId, { title });
    return { id: runId, notes };
  });
}

/* ============================================================
   Exports
   ============================================================ */

export async function exportRunScoped(
  scope: StatementScope,
  runId: number,
  format: ExportFormat,
  statement: ExportStatement,
) {
  const run = await getRunScoped(scope, runId);
  if (run.status === 'SUPERSEDED') {
    throw new FinancialStatementError(
      'SUPERSEDED',
      'This version was superseded. Export the version that replaced it, or use the archive to view the historical figures.',
      409,
    );
  }
  const output = await exportStatements(run.payload, format, statement, {
    status: run.status,
    version: run.version,
    approvedByName: run.approvedByName,
    approvedAt: run.approvedAt,
    generatedByName: run.generatedByName,
  });

  return transaction(async (client) => {
    await client.query(
      `INSERT INTO financial_statement_exports
         (tenant_id, facility_id, run_id, format, statement, filename, byte_size, content_hash, exported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        scope.tenantId,
        scope.facilityId,
        runId,
        format.toUpperCase(),
        statement,
        output.filename,
        output.byteLength,
        output.contentHash,
        scope.actorUserId,
      ],
    );
    await audit(client, scope, 'EXPORT', 'financial_statement_run', runId, {
      format: format.toUpperCase(),
      statement,
      filename: output.filename,
      status: run.status,
    });
    return {
      filename: output.filename,
      contentType: output.contentType,
      base64: output.base64,
      byteLength: output.byteLength,
    };
  });
}

/* ============================================================
   Year-end close and period reopening
   ============================================================ */

export interface YearEndCloseResult {
  journalId: number;
  journalNumber: string;
  financialYear: string;
  entryDate: string;
  retainedEarningsAccountId: number;
  retainedEarningsAccountCode: string;
  netResultCents: string;
  lines: Array<{
    accountCode: string;
    accountName: string;
    debitCents: string;
    creditCents: string;
  }>;
}

/**
 * Close a financial year: every revenue and expense account is returned to
 * zero and the net result transfers to the configured equity account. Balance
 * sheet accounts are untouched and therefore carry forward.
 *
 * Refuses when the equity account is unconfigured, when the year has already
 * been closed, or when it has no result to close. It posts through the normal
 * journal path, so an open period is still required.
 */
export async function closeFinancialYearScoped(
  scope: StatementScope,
  input: Record<string, unknown>,
): Promise<YearEndCloseResult> {
  const startYear = Number(input.startYear);
  const reason = requiredText(input.reason, 'Closing reason', MAX_REASON);

  return transaction(async (client) => {
    const settings = await readSettings(client, scope);
    if (settings.retainedEarningsAccountId === null) {
      throw new FinancialStatementError(
        'EQUITY_ACCOUNT_NOT_CONFIGURED',
        'Configure the equity account that receives the year-end result before closing a financial year. A close never guesses where the result goes.',
        409,
      );
    }
    const fy = financialYear(startYear, settings.financialYearStartMonth);

    const prior = await client.query(
      `SELECT id, journal_number FROM journal_entries
        WHERE tenant_id = $1 AND facility_id = $2 AND source_type = 'YEAR_END_CLOSE' AND source_id = $3`,
      [scope.tenantId, scope.facilityId, fy.label],
    );
    if (prior.rows.length) {
      throw new FinancialStatementError(
        'YEAR_ALREADY_CLOSED',
        `Financial year ${fy.label} has already been closed by journal ${prior.rows[0].journal_number}.`,
        409,
      );
    }

    const balances = await client.query(
      `SELECT a.id, a.account_code, a.account_name,
              COALESCE(SUM(l.debit_cents - l.credit_cents), 0)::text AS net_debit_cents
         FROM chart_of_accounts a
         JOIN journal_lines l ON l.account_id = a.id
         JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE a.tenant_id = $1 AND a.facility_id = $2
          AND a.account_type IN ('REVENUE', 'EXPENSE')
          AND je.tenant_id = $1 AND je.facility_id = $2 AND je.status = 'POSTED'
          AND je.entry_date <= $3::date
        GROUP BY a.id, a.account_code, a.account_name
        HAVING COALESCE(SUM(l.debit_cents - l.credit_cents), 0) <> 0
        ORDER BY a.account_code`,
      [scope.tenantId, scope.facilityId, fy.end],
    );
    if (!balances.rows.length) {
      throw new FinancialStatementError(
        'NOTHING_TO_CLOSE',
        `Financial year ${fy.label} has no revenue or expense balances to close.`,
        409,
      );
    }

    const lines: JournalRequest['lines'] = [];
    let netDebit = 0n;
    const summary: YearEndCloseResult['lines'] = [];
    for (const row of balances.rows) {
      const balance = cents(row.net_debit_cents);
      netDebit += balance;
      const debitCents = balance < 0n ? -balance : 0n;
      const creditCents = balance > 0n ? balance : 0n;
      lines.push({
        accountId: Number(row.id),
        debitCents,
        creditCents,
        description: `Close ${row.account_code} ${row.account_name}`,
        serviceLine: null,
      });
      summary.push({
        accountCode: row.account_code,
        accountName: row.account_name,
        debitCents: centsString(debitCents),
        creditCents: centsString(creditCents),
      });
    }

    /*
     * netDebit is the sum of every revenue and expense balance as a debit.
     * A profit leaves it negative, and the equity account must then be
     * credited by the same amount: the closing entry as a whole balances, and
     * no plug figure is introduced anywhere.
     */
    const equityDebitCents = netDebit > 0n ? netDebit : 0n;
    const equityCreditCents = netDebit < 0n ? -netDebit : 0n;
    lines.push({
      accountId: settings.retainedEarningsAccountId,
      debitCents: equityDebitCents,
      creditCents: equityCreditCents,
      description: `Result for ${fy.label} transferred to ${settings.retainedEarningsAccountCode ?? 'equity'}`,
      serviceLine: null,
    });
    summary.push({
      accountCode: settings.retainedEarningsAccountCode ?? '',
      accountName: settings.retainedEarningsAccountName ?? 'Retained earnings',
      debitCents: centsString(equityDebitCents),
      creditCents: centsString(equityCreditCents),
    });

    const request: JournalRequest = {
      entryDate: fy.end,
      description: `Year-end close ${fy.label}: revenue and expenses transferred to equity`,
      idempotencyKey: `YEAR_END_CLOSE:${fy.label}`,
      lines,
      totalCents: sumCents(lines.map((line) => line.debitCents)),
      sourceType: 'YEAR_END_CLOSE',
      sourceId: fy.label,
    };
    // Same posting path as every other module: open-period check, advisory
    // locks, signed-reconciliation guard and its own audit row.
    const posted = await postInsideTransaction(client, scope as AccountingScope, request);

    await audit(client, scope, 'YEAR_END_CLOSE', 'financial_year', fy.startYear, {
      financialYear: fy.label,
      reason,
      netResultCents: centsString(-netDebit),
      journalId: Number(posted.journal.id),
      journalNumber: String(posted.journal.journalNumber),
      lines: summary.length,
    });

    return {
      journalId: Number(posted.journal.id),
      journalNumber: String(posted.journal.journalNumber),
      financialYear: fy.label,
      entryDate: fy.end,
      retainedEarningsAccountId: settings.retainedEarningsAccountId,
      retainedEarningsAccountCode: settings.retainedEarningsAccountCode ?? '',
      netResultCents: centsString(-netDebit),
      lines: summary,
    };
  });
}

/**
 * Reopen a closed period so an adjustment can be posted. The reason is
 * mandatory and the action is audited. Approved statements that cover the
 * period are listed in the response: they keep their approved figures, and a
 * revised version is what supersedes them.
 */
export async function reopenPeriodScoped(scope: StatementScope, input: Record<string, unknown>) {
  const periodId = Number(input.periodId);
  const reason = requiredText(input.reason, 'Reopen reason', MAX_REASON);
  if (!Number.isSafeInteger(periodId) || periodId <= 0) {
    throw new FinancialStatementError('INVALID_PERIOD', 'Choose a financial period.');
  }
  return transaction(async (client) => {
    /*
     * The period guard in the database refuses to change a closed period. It
     * opens exactly one door: a transaction that names the period it is
     * reopening. The key is transaction-local, so it disappears with the
     * commit and cannot authorise a later statement.
     */
    await client.query(`SELECT set_config('jcare.period_reopen', $1, true)`, [String(periodId)]);
    const updated = await client.query(
      `UPDATE financial_periods
          SET status = 'OPEN', closed_by_user_id = NULL, closed_at = NULL,
              close_notes = COALESCE(close_notes || E'\\n', '') || $1
        WHERE id = $2 AND tenant_id = $3 AND facility_id = $4 AND status = 'CLOSED'
        RETURNING id, period_code, start_date::text AS start_date, end_date::text AS end_date`,
      [`Reopened: ${reason}`, periodId, scope.tenantId, scope.facilityId],
    );
    if (!updated.rows.length) {
      throw new FinancialStatementError(
        'PERIOD_NOT_CLOSED',
        'Only a closed period in this facility can be reopened.',
        409,
      );
    }
    const affected = await client.query(
      `SELECT id, version, period_start::text AS period_start, period_end::text AS period_end
         FROM financial_statement_runs
        WHERE tenant_id = $1 AND facility_id = $2 AND status = 'APPROVED'
          AND period_start <= $3::date AND period_end >= $4::date
        ORDER BY period_start DESC, version DESC`,
      [scope.tenantId, scope.facilityId, updated.rows[0].end_date, updated.rows[0].start_date],
    );
    await audit(client, scope, 'REOPEN', 'financial_periods', periodId, {
      reason,
      affectedStatements: affected.rows.map((row) => Number(row.id)),
    });
    return {
      periodId: Number(updated.rows[0].id),
      periodCode: updated.rows[0].period_code,
      startDate: updated.rows[0].start_date,
      endDate: updated.rows[0].end_date,
      affectedStatements: affected.rows.map((row) => ({
        id: Number(row.id),
        version: Number(row.version),
        periodStart: row.period_start,
        periodEnd: row.period_end,
      })),
    };
  });
}

/* ============================================================
   Dashboard
   ============================================================ */

export async function dashboardScoped(scope: StatementScope) {
  return transaction(async (client) => {
    const settings = await readSettings(client, scope);
    const latest = await client.query(
      `SELECT r.id, r.frequency, r.financial_year, r.period_start::text AS period_start,
              r.period_end::text AS period_end, r.version, r.status, r.approved_at::text AS approved_at,
              COALESCE((SELECT COUNT(*)::int FROM jsonb_array_elements(r.checks) c
                         WHERE c->>'status' = 'FAIL'), 0) AS failing_checks
         FROM financial_statement_runs r
        WHERE r.tenant_id = $1 AND r.facility_id = $2
        ORDER BY r.period_end DESC, r.version DESC
        LIMIT 8`,
      [scope.tenantId, scope.facilityId],
    );
    const periods = await client.query(
      `SELECT id, period_code, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM financial_periods
        WHERE tenant_id = $1 AND facility_id = $2
        ORDER BY start_date DESC LIMIT 24`,
      [scope.tenantId, scope.facilityId],
    );
    const years = await client.query(
      `SELECT DISTINCT financial_year FROM financial_statement_runs
        WHERE tenant_id = $1 AND facility_id = $2 ORDER BY financial_year DESC LIMIT 20`,
      [scope.tenantId, scope.facilityId],
    );
    const openPeriodCount = periods.rows.filter((row) => row.status === 'OPEN').length;
    const today = new Date().toISOString().slice(0, 10);
    const currentFy = financialYearFor(today, settings.financialYearStartMonth);
    const unclassified = await client.query(
      `SELECT COUNT(*)::int AS count FROM chart_of_accounts
        WHERE tenant_id = $1 AND facility_id = $2 AND is_active = true`,
      [scope.tenantId, scope.facilityId],
    );
    return {
      settings,
      currentFinancialYear: { label: currentFy.label, start: currentFy.start, end: currentFy.end },
      recentRuns: latest.rows.map((row) => ({
        id: Number(row.id),
        frequency: row.frequency,
        financialYear: row.financial_year,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        version: Number(row.version),
        status: row.status,
        approvedAt: row.approved_at,
        failingChecks: Number(row.failing_checks),
      })),
      periods: periods.rows,
      financialYears: years.rows.map((row) => row.financial_year),
      openPeriodCount,
      accountCount: Number(unclassified.rows[0]?.count ?? 0),
    };
  });
}
