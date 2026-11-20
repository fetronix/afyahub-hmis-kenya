/**
 * Syrona Medical Center HMIS — financial statement data loading.
 *
 * One pass over the posted ledger for the reporting window, the comparative
 * window and the opening position, plus the schedules a statement needs to be
 * supported: bank accounts, the fixed-asset register, posted depreciation
 * batches, the approved partner-equity statement and the last approved
 * statement for this facility. Everything is filtered by tenant and facility
 * in SQL — the service never loads another facility's rows and then discards
 * them.
 *
 * Only journals with status POSTED are included. Draft, voided and cancelled
 * journals are excluded by status, never by date arithmetic, so a reversal
 * nets to zero through its own posted entry instead of being guessed at.
 */

import type { PoolClient } from 'pg';
import { cents, centsFromKes } from './money.ts';
import type { ManagementNote } from './types.ts';
import { classifyAccounts, type ClassifiableAccount } from './classification.ts';
import type {
  AccountMovement,
  BankAccountInput,
  FixedAssetInput,
  LedgerLineInput,
  PartnerEquityInput,
  PartyLineInput,
  PriorApprovedInput,
} from './engine.ts';

export interface StatementScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
}

export interface StatementWindow {
  periodStart: string;
  periodEnd: string;
  comparativeStart: string | null;
  comparativeEnd: string | null;
}

export interface DepreciationEvidence {
  /** Total of POSTED batches whose entry date falls inside the period. */
  batchChargeCents: bigint;
  batchesPosted: number;
  byAssetCode: ReadonlyMap<string, bigint>;
  batches: Array<{
    periodCode: string;
    entryDate: string;
    status: string;
    totalCents: bigint;
    assetCount: number;
    reversedAt: string | null;
  }>;
}

export interface LedgerWindow extends StatementWindow {
  facility: {
    name: string;
    code: string | null;
    county: string | null;
    address: string | null;
    currency: string;
  };
  accounts: ClassifiableAccount[];
  movements: AccountMovement[];
  /** Same shape, excluding year-end closing journals: what the period traded. */
  tradingMovements: AccountMovement[];
  journalLines: LedgerLineInput[];
  partyLines: PartyLineInput[];
  bankAccounts: BankAccountInput[];
  fixedAssets: FixedAssetInput[];
  depreciation: DepreciationEvidence;
  partnerEquity: PartnerEquityInput | null;
  priorApproved: PriorApprovedInput | null;
  sourcePeriods: Array<{
    periodCode: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
  ledgerThrough: string | null;
  journalCount: number;
  /** Set when a cap was hit; the payload reports it instead of hiding it. */
  lineOverflow: boolean;
  partyOverflow: boolean;
}

/** Caps protect the statement and the browser, not the database. */
const LINE_CAP = 20_000;
const PARTY_LINE_CAP = 5_000;

export async function loadLedgerWindow(
  client: PoolClient,
  scope: StatementScope,
  window: StatementWindow,
): Promise<LedgerWindow> {
  const facility = await client.query(
    `SELECT f.name, f.code, f.county, f.address, COALESCE(t.currency, 'KES') AS currency
       FROM facilities f JOIN tenants t ON t.id = f.tenant_id
      WHERE f.tenant_id = $1 AND f.id = $2`,
    [scope.tenantId, scope.facilityId],
  );
  if (!facility.rows.length) {
    throw new Error('The facility for this statement no longer exists.');
  }

  const accountRows = await client.query(
    `SELECT id, account_code, account_name, account_type, sub_type, normal_balance
       FROM chart_of_accounts
      WHERE tenant_id = $1 AND facility_id = $2 AND is_active
      ORDER BY account_code`,
    [scope.tenantId, scope.facilityId],
  );
  const accounts: ClassifiableAccount[] = accountRows.rows.map((row) => ({
    id: Number(row.id),
    code: row.account_code,
    name: row.account_name,
    type: row.account_type,
    subType: row.sub_type,
    normalBalance: row.normal_balance,
  }));

  const overrideRows = await client.query(
    `SELECT account_id, presentation_group
       FROM financial_statement_account_groups
      WHERE tenant_id = $1 AND facility_id = $2`,
    [scope.tenantId, scope.facilityId],
  );
  const overrides = new Map<number, string>(
    overrideRows.rows.map((row) => [Number(row.account_id), String(row.presentation_group)]),
  );
  const classified = classifyAccounts(accounts, overrides);
  const groupOf = (accountId: number) => classified.get(accountId)?.group ?? null;
  const receivableIds = accounts
    .filter((account) => groupOf(account.id) === 'RECEIVABLE')
    .map((a) => a.id);
  const payableIds = accounts
    .filter((account) => groupOf(account.id) === 'PAYABLES')
    .map((a) => a.id);

  /*
   * Four windows in one scan: everything through the period end (the closing
   * position), everything through the comparative end (the prior column), the
   * period movement and the comparative movement. Opening balances are closing
   * minus movement, so they cannot disagree with the closing column.
   */
  const movementRows = await client.query(
    `SELECT l.account_id,
            COALESCE(SUM(l.debit_cents), 0)::text  AS closing_debit,
            COALESCE(SUM(l.credit_cents), 0)::text AS closing_credit,
            COALESCE(SUM(l.debit_cents)  FILTER (WHERE j.source_type <> 'YEAR_END_CLOSE'
                                                  AND j.entry_date >= $3::date), 0)::text  AS trading_debit,
            COALESCE(SUM(l.credit_cents) FILTER (WHERE j.source_type <> 'YEAR_END_CLOSE'
                                                  AND j.entry_date >= $3::date), 0)::text AS trading_credit,
            COALESCE(SUM(l.debit_cents)  FILTER (WHERE j.entry_date >= $3::date), 0)::text  AS period_debit,
            COALESCE(SUM(l.credit_cents) FILTER (WHERE j.entry_date >= $3::date), 0)::text AS period_credit,
            COALESCE(SUM(l.debit_cents)  FILTER (WHERE $5::date IS NOT NULL AND j.entry_date <= $5::date), 0)::text  AS prior_debit,
            COALESCE(SUM(l.credit_cents) FILTER (WHERE $5::date IS NOT NULL AND j.entry_date <= $5::date), 0)::text AS prior_credit,
            COALESCE(SUM(l.debit_cents)  FILTER (WHERE $5::date IS NOT NULL AND $6::date IS NOT NULL
                                                  AND j.entry_date BETWEEN $6::date AND $5::date), 0)::text  AS comparative_debit,
            COALESCE(SUM(l.credit_cents) FILTER (WHERE $5::date IS NOT NULL AND $6::date IS NOT NULL
                                                  AND j.entry_date BETWEEN $6::date AND $5::date), 0)::text AS comparative_credit
       FROM journal_lines l
       JOIN journal_entries j ON j.id = l.journal_entry_id
      WHERE j.tenant_id = $1 AND j.facility_id = $2
        AND j.status = 'POSTED'
        AND j.entry_date <= $4::date
      GROUP BY l.account_id`,
    [
      scope.tenantId,
      scope.facilityId,
      window.periodStart,
      window.periodEnd,
      window.comparativeEnd,
      window.comparativeStart,
    ],
  );

  const movements: AccountMovement[] = [];
  const tradingMovements: AccountMovement[] = [];
  for (const row of movementRows.rows) {
    const movement: AccountMovement = {
      accountId: Number(row.account_id),
      closingDebitCents: cents(row.closing_debit),
      closingCreditCents: cents(row.closing_credit),
      periodDebitCents: cents(row.period_debit),
      periodCreditCents: cents(row.period_credit),
      priorDebitCents: cents(row.prior_debit),
      priorCreditCents: cents(row.prior_credit),
      comparativeDebitCents: cents(row.comparative_debit),
      comparativeCreditCents: cents(row.comparative_credit),
    };
    movements.push(movement);
    tradingMovements.push({
      ...movement,
      periodDebitCents: cents(row.trading_debit),
      periodCreditCents: cents(row.trading_credit),
    });
  }

  const lineRows = await client.query(
    `SELECT l.account_id, j.journal_number, j.entry_date::text AS entry_date, j.source_type,
            l.description, l.debit_cents::text AS debit_cents, l.credit_cents::text AS credit_cents,
            COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''), s.name) AS party
       FROM journal_lines l
       JOIN journal_entries j ON j.id = l.journal_entry_id
       LEFT JOIN patients p ON p.id = l.patient_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id
      WHERE j.tenant_id = $1 AND j.facility_id = $2 AND j.status = 'POSTED'
        AND j.entry_date BETWEEN $3::date AND $4::date
      ORDER BY j.entry_date, j.journal_number, l.id
      LIMIT $5`,
    [scope.tenantId, scope.facilityId, window.periodStart, window.periodEnd, LINE_CAP + 1],
  );
  const lineOverflow = lineRows.rows.length > LINE_CAP;
  const journalLines: LedgerLineInput[] = lineRows.rows.slice(0, LINE_CAP).map((row) => ({
    accountId: Number(row.account_id),
    journalNumber: row.journal_number,
    entryDate: row.entry_date,
    sourceType: row.source_type,
    description: row.description,
    debitCents: cents(row.debit_cents),
    creditCents: cents(row.credit_cents),
    party: row.party ?? null,
  }));

  /*
   * Party sub-ledger lines: every posted line on a receivable or payable
   * control account up to the period end. Unnamed lines are loaded too, so the
   * sub-ledger total can be reconciled to the control account in full rather
   * than only the part that happens to name a patient or supplier.
   */
  const partyIds = [...receivableIds, ...payableIds];
  const partyRows = partyIds.length
    ? await client.query(
        `SELECT l.account_id, l.patient_id, l.supplier_id, j.entry_date::text AS entry_date,
                l.description, l.debit_cents::text AS debit_cents, l.credit_cents::text AS credit_cents,
                NULLIF(TRIM(p.first_name || ' ' || p.last_name), '') AS patient_name,
                p.mrn, s.name AS supplier_name
           FROM journal_lines l
           JOIN journal_entries j ON j.id = l.journal_entry_id
           LEFT JOIN patients p ON p.id = l.patient_id
           LEFT JOIN suppliers s ON s.id = l.supplier_id
          WHERE j.tenant_id = $1 AND j.facility_id = $2 AND j.status = 'POSTED'
            AND j.entry_date <= $3::date
            AND l.account_id = ANY($4::int[])
          ORDER BY j.entry_date, l.id
          LIMIT $5`,
        [scope.tenantId, scope.facilityId, window.periodEnd, partyIds, PARTY_LINE_CAP + 1],
      )
    : { rows: [] as Record<string, unknown>[] };
  const partyOverflow = partyRows.rows.length > PARTY_LINE_CAP;
  const partyLines: PartyLineInput[] = partyRows.rows.slice(0, PARTY_LINE_CAP).map((row) => {
    const onReceivable = receivableIds.includes(Number(row.account_id));
    const patientName = row.patient_name ?? null;
    const supplierName = row.supplier_name ?? null;
    return {
      side: onReceivable ? 'RECEIVABLE' : 'PAYABLE',
      partyId: onReceivable
        ? row.patient_id === null
          ? null
          : Number(row.patient_id)
        : row.supplier_id === null
          ? null
          : Number(row.supplier_id),
      partyName:
        (onReceivable ? patientName : supplierName) ??
        patientName ??
        supplierName ??
        'Unnamed party',
      reference: onReceivable ? (row.mrn ?? null) : null,
      entryDate: row.entry_date,
      debitCents: cents(row.debit_cents),
      creditCents: cents(row.credit_cents),
    };
  });

  const bankAccounts = await loadBankAccounts(client, scope, window);
  const fixed = await loadFixedAssets(client, scope, window);
  const partnerEquity = await loadPartnerEquity(client, scope, window);
  const priorApproved = await loadPriorApproved(client, scope, window);

  const sourcePeriods = await client.query(
    `SELECT period_code AS "periodCode", name, start_date::text AS "startDate",
            end_date::text AS "endDate", status
       FROM financial_periods
      WHERE tenant_id = $1 AND facility_id = $2
        AND start_date <= $3::date AND end_date >= $4::date
      ORDER BY start_date`,
    [scope.tenantId, scope.facilityId, window.periodEnd, window.periodStart],
  );

  const watermark = await client.query(
    `SELECT COUNT(*)::int AS journal_count, MAX(posted_at)::text AS ledger_through
       FROM journal_entries
      WHERE tenant_id = $1 AND facility_id = $2 AND status = 'POSTED' AND entry_date <= $3::date`,
    [scope.tenantId, scope.facilityId, window.periodEnd],
  );

  return {
    ...window,
    facility: {
      name: facility.rows[0].name,
      code: facility.rows[0].code ?? null,
      county: facility.rows[0].county ?? null,
      address: facility.rows[0].address ?? null,
      currency: facility.rows[0].currency,
    },
    accounts,
    movements,
    tradingMovements,
    journalLines,
    partyLines,
    bankAccounts,
    fixedAssets: fixed.assets,
    depreciation: fixed.depreciation,
    partnerEquity,
    priorApproved,
    sourcePeriods: sourcePeriods.rows,
    ledgerThrough: watermark.rows[0]?.ledger_through ?? null,
    journalCount: Number(watermark.rows[0]?.journal_count ?? 0),
    lineOverflow,
    partyOverflow,
  };
}

/**
 * Bank and cash-on-hand accounts from the facility's own register. The book
 * balance is compared with the ledger by the engine; a stored balance that
 * disagrees is a failed reconciliation, not a figure to be silently replaced.
 */
async function loadBankAccounts(
  client: PoolClient,
  scope: StatementScope,
  window: StatementWindow,
): Promise<BankAccountInput[]> {
  const rows = await client.query(
    `SELECT b.id, b.account_name, b.bank_name, b.account_number_masked, b.gl_account_id,
            b.account_kind, b.book_balance_kes::text AS book_balance_kes,
            b.last_reconciled_at::text AS last_reconciled_at
       FROM bank_accounts b
      WHERE b.tenant_id = $1 AND b.facility_id = $2 AND b.is_active
      ORDER BY b.account_name`,
    [scope.tenantId, scope.facilityId],
  );
  if (!rows.rows.length) return [];

  const imports = await client.query(
    `SELECT i.id, i.bank_account_id,
            COALESCE(i.statement_end_date, i.statement_start_date) AS statement_date,
            COUNT(t.id)::int AS line_count,
            COUNT(t.id) FILTER (WHERE t.match_status = 'MATCHED')::int AS matched_count
       FROM bank_statement_imports i
       LEFT JOIN bank_transactions t ON t.statement_import_id = i.id
      WHERE i.tenant_id = $1 AND i.facility_id = $2
        AND COALESCE(i.statement_end_date, i.statement_start_date) BETWEEN $3 AND $4
      GROUP BY i.id, i.bank_account_id, i.statement_end_date, i.statement_start_date
      ORDER BY COALESCE(i.statement_end_date, i.statement_start_date) DESC`,
    [scope.tenantId, scope.facilityId, window.periodStart, window.periodEnd],
  );

  return rows.rows.map((row) => ({
    id: Number(row.id),
    name: row.account_name,
    kind: row.account_kind === 'CASH_ON_HAND' ? 'CASH_ON_HAND' : 'BANK',
    bankName: row.bank_name ?? null,
    accountNumberMasked: row.account_number_masked ?? null,
    glAccountId: Number(row.gl_account_id),
    storedBookBalanceCents: centsFromKes(row.book_balance_kes),
    lastReconciledAt: row.last_reconciled_at ?? null,
    imports: imports.rows
      .filter((entry) => Number(entry.bank_account_id) === Number(row.id))
      .map((entry) => {
        const lineCount = Number(entry.line_count);
        const matched = Number(entry.matched_count);
        return {
          id: Number(entry.id),
          statementDate: entry.statement_date ?? null,
          status:
            lineCount > 0 && matched === lineCount
              ? 'RECONCILED'
              : matched > 0
                ? 'PARTLY_RECONCILED'
                : 'IMPORTED',
          lineCount,
        };
      }),
  }));
}

async function loadFixedAssets(
  client: PoolClient,
  scope: StatementScope,
  window: StatementWindow,
): Promise<{ assets: FixedAssetInput[]; depreciation: DepreciationEvidence }> {
  const assets = await client.query(
    `SELECT asset_code, asset_name, category, acquisition_date::text AS acquisition_date,
            acquisition_cost_kes::text AS cost_kes,
            accumulated_depreciation_kes::text AS accumulated_kes,
            net_book_value_kes::text AS nbv_kes, status
       FROM fixed_assets
      WHERE tenant_id = $1 AND facility_id = $2
      ORDER BY asset_code`,
    [scope.tenantId, scope.facilityId],
  );

  /*
   * `entry_date` is text in the fixed-asset register (it records the date the
   * batch posts, which may be typed before the period exists), so it is
   * compared as ISO text rather than cast to a date.
   */
  const batches = await client.query(
    `SELECT b.period_code, b.status, b.entry_date, b.total_cents::text AS total_cents,
            b.asset_count, b.reversed_at::text AS reversed_at
       FROM fixed_asset_depreciation_batches b
      WHERE b.tenant_id = $1 AND b.facility_id = $2
        AND b.entry_date >= $3 AND b.entry_date <= $4
      ORDER BY b.period_code`,
    [scope.tenantId, scope.facilityId, window.periodStart, window.periodEnd],
  );

  const items = await client.query(
    `SELECT i.asset_code, i.charge_cents::text AS charge_cents
       FROM fixed_asset_depreciation_batch_items i
       JOIN fixed_asset_depreciation_batches b ON b.id = i.batch_id
      WHERE b.tenant_id = $1 AND b.facility_id = $2
        AND b.status = 'POSTED' AND b.reversed_at IS NULL
        AND b.entry_date >= $3 AND b.entry_date <= $4`,
    [scope.tenantId, scope.facilityId, window.periodStart, window.periodEnd],
  );

  const byAssetCode = new Map<string, bigint>();
  let batchChargeCents = 0n;
  for (const row of items.rows) {
    const charge = cents(row.charge_cents);
    batchChargeCents += charge;
    byAssetCode.set(row.asset_code, (byAssetCode.get(row.asset_code) ?? 0n) + charge);
  }
  const postedBatches = batches.rows.filter(
    (row) => row.status === 'POSTED' && row.reversed_at === null,
  );

  return {
    assets: assets.rows.map((row) => ({
      assetCode: row.asset_code,
      assetName: row.asset_name,
      category: row.category,
      acquisitionDate: row.acquisition_date,
      status: row.status,
      costCents: centsFromKes(row.cost_kes),
      accumulatedCents: centsFromKes(row.accumulated_kes),
      netBookValueCents: centsFromKes(row.nbv_kes),
    })),
    depreciation: {
      batchChargeCents: postedBatches.reduce((total, row) => total + cents(row.total_cents), 0n),
      batchesPosted: postedBatches.length,
      byAssetCode,
      batches: batches.rows.map((row) => ({
        periodCode: row.period_code,
        entryDate: row.entry_date,
        status: row.status,
        totalCents: cents(row.total_cents),
        assetCount: Number(row.asset_count ?? 0),
        reversedAt: row.reversed_at ?? null,
      })),
    },
  };
}

/**
 * The partner-equity module keeps its own approved statement in a jsonb model.
 * This is a cross-reference, not a second calculation: the amounts on the
 * statement of changes in equity come from the ledger, and the approved
 * partner statement is reported alongside them so a reader can follow it.
 */
async function loadPartnerEquity(
  client: PoolClient,
  scope: StatementScope,
  window: StatementWindow,
): Promise<PartnerEquityInput | null> {
  const rows = await client.query(
    `SELECT id, end_date::text AS end_date, status, version
       FROM equity_statements
      WHERE tenant_id = $1 AND facility_id = $2 AND end_date <= $3::date
      ORDER BY end_date DESC, version DESC
      LIMIT 1`,
    [scope.tenantId, scope.facilityId, window.periodEnd],
  );
  if (!rows.rows.length) return null;
  return {
    available: true,
    statementId: Number(rows.rows[0].id),
    status: String(rows.rows[0].status),
    periodLabel: rows.rows[0].end_date,
    partners: [],
    reason: null,
  };
}

/**
 * The last approved statement before this period. It is used to carry the
 * opening balances into the comparative column and to confirm that this
 * period opens where the previous one closed — never to fill a gap. When no
 * approved statement exists the comparison is reported as unavailable.
 */
async function loadPriorApproved(
  client: PoolClient,
  scope: StatementScope,
  window: StatementWindow,
): Promise<PriorApprovedInput | null> {
  const rows = await client.query(
    `SELECT id, version, period_end::text AS period_end, payload
       FROM financial_statement_runs
      WHERE tenant_id = $1 AND facility_id = $2 AND status = 'APPROVED'
        AND period_end < $3::date
      ORDER BY period_end DESC, version DESC
      LIMIT 1`,
    [scope.tenantId, scope.facilityId, window.periodStart],
  );
  if (!rows.rows.length) return null;
  const payload = rows.rows[0].payload as {
    statements?: { financialPosition?: { totals?: Record<string, string> } };
  };
  const totals = payload.statements?.financialPosition?.totals ?? {};
  if (
    totals.assetsCents === undefined ||
    totals.equityCents === undefined ||
    totals.liabilitiesCents === undefined
  ) {
    return null;
  }
  return {
    version: Number(rows.rows[0].version),
    periodEnd: rows.rows[0].period_end,
    assetsCents: cents(totals.assetsCents),
    liabilitiesCents: cents(totals.liabilitiesCents),
    equityCents: cents(totals.equityCents),
  };
}

/**
 * Notes travel through jsonb, so a stored note is `unknown` when it comes back
 * out. This reads them defensively: a note that cannot be understood is
 * dropped rather than rendered as a half-parsed row, and the count of readable
 * notes is what the statement shows.
 */
export function normaliseNotes(value: unknown): ManagementNote[] {
  if (!Array.isArray(value)) return [];
  const notes: ManagementNote[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const note = entry as Record<string, unknown>;
    if (typeof note.title !== 'string' || typeof note.body !== 'string') continue;
    notes.push({
      noteRef: typeof note.noteRef === 'string' ? note.noteRef : String(notes.length + 1),
      title: note.title,
      body: note.body,
      authorUserId: typeof note.authorUserId === 'number' ? note.authorUserId : null,
      authorName: typeof note.authorName === 'string' ? note.authorName : null,
      recordedAt: typeof note.recordedAt === 'string' ? note.recordedAt : new Date(0).toISOString(),
    });
  }
  return notes;
}
