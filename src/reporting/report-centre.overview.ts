/**
 * The Reporting Centre's headline figures.
 *
 * Every number on a hospital dashboard is a claim. A card that shows `0`
 * because a query failed, because a module is switched off or because nobody
 * has the permission to see the source is worse than no card at all: it reads
 * as a real, verified zero and somebody makes a decision on it.
 *
 * So each figure is computed here, on the server, under the same tenant and
 * facility scope as the reports themselves, and every figure carries an
 * explicit status:
 *
 *   ok          a real value, with the definition of what it counts;
 *   restricted  this account lacks a permission the figure needs;
 *   disabled    the facility has the source module switched off or hidden;
 *   error       the source data could not be read, or contains values that
 *               cannot be totalled without review.
 *
 * Only `ok` ever carries a number. The definitions are deliberately narrow:
 * "recorded receipts" is cash taken at the counter, not recognised revenue, and
 * the balance figure is a current invoice-header snapshot, not an aged ledger.
 */
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';
import { pool } from '../db/index.ts';
import { moduleLogger } from '../logging/logger.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { ReportCentreError } from './report-centre.auth.ts';
import { parseCalendarDate } from '../dashboard/date-range.ts';
import { netReceipts, ReceiptReviewRequired } from './receipts.ts';

const log = moduleLogger('report-centre');

export type ReportingKpiId =
  'patient-visits' | 'revenue' | 'outstanding-balances' | 'pharmacy-stock-alerts';

export type ReportingKpiStatus = 'ok' | 'restricted' | 'disabled' | 'error';

export interface ReportingKpiPoint {
  /** Inclusive calendar day, YYYY-MM-DD, in the facility's calendar. */
  day: string;
  value: number;
}

export interface ReportingKpi {
  id: ReportingKpiId;
  label: string;
  status: ReportingKpiStatus;
  /** Present only when status is ok. Counts are whole numbers; money is a string. */
  value?: number;
  amount?: string;
  currency?: string | null;
  /** Exactly what the figure counts, in the words a clinician or auditor can check. */
  definition: string;
  /** The day a snapshot was taken; absent for period figures. */
  asOf?: string;
  /** True when the figure covers the selected period rather than an instant. */
  periodScoped: boolean;
  /** Real daily values, when the source has a trustworthy date axis. */
  series?: ReportingKpiPoint[];
  message?: string;
}

export interface ReportingOverview {
  facilityId: number;
  facilityName: string;
  /** Inclusive calendar days the figures were asked for. */
  from: string;
  to: string;
  generatedAt: string;
  currency: string | null;
  kpis: ReportingKpi[];
  notes: string[];
}

const NOTES = [
  'Figures use the same tenant and facility scope as the reports. A facility id from the browser is checked against your account before anything is read.',
  'A figure is shown only when its source data could be read and totalled. Restricted, disabled and failed figures are labelled rather than shown as zero.',
];

type Facility = NonNullable<Awaited<ReturnType<typeof getFacilityByIdScoped>>>;

function enabled(facility: Facility, module: string): boolean {
  const active = Array.isArray(facility.enabledModules) ? facility.enabledModules : [];
  const hidden = Array.isArray(facility.hiddenModules) ? facility.hiddenModules : [];
  return active.includes(module) && !hidden.includes(module);
}

function permitted(context: AuthorizationContext, ...permissions: string[]): boolean {
  return (
    !context.isSuperAdmin &&
    permissions.every((permission) => context.permissions.includes(permission))
  );
}

type Source = { permissions: string[]; modules: string[] };

/**
 * Build one card. The loader runs only when the permission and module gates
 * pass, so a refused figure never triggers a query and never becomes a zero.
 */
async function card(
  context: AuthorizationContext,
  facility: Facility,
  source: Source,
  base: Omit<ReportingKpi, 'status'>,
  load: () => Promise<Partial<ReportingKpi>>,
): Promise<ReportingKpi> {
  if (!permitted(context, ...source.permissions))
    return {
      ...base,
      status: 'restricted',
      message: 'Your account does not have permission to view this figure.',
    };
  const disabled = source.modules.filter((module) => !enabled(facility, module));
  if (disabled.length)
    return {
      ...base,
      status: 'disabled',
      message: `This facility does not have the ${disabled.join(' and ')} module enabled.`,
    };
  try {
    return { ...base, status: 'ok', ...(await load()) };
  } catch (error) {
    // Never log SQL parameters, patient identity or amounts.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;
    log.error({ section: base.id, code }, 'reporting.overview_failed');
    return {
      ...base,
      status: 'error',
      message:
        error instanceof ReportCentreError
          ? error.message
          : 'This figure could not be read just now. The report behind it may still be available.',
    };
  }
}

/** Inclusive calendar range, bounded so one request cannot ask for a decade. */
function range(raw: { from?: unknown; to?: unknown }): { from: string; to: string } {
  const from = typeof raw.from === 'string' ? raw.from : '';
  const to = typeof raw.to === 'string' ? raw.to : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Choose an inclusive start and end date.');
  if (!parseCalendarDate(from) || !parseCalendarDate(to))
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Those dates are not calendar dates.');
  if (from > to)
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      'The start date must not be after the end.',
    );
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366)
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Choose a period of 366 days or less.');
  return { from, to };
}

/** One row per calendar day between the range ends, so a gap is visibly empty. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let cursor = start; cursor <= end; cursor += 86_400_000)
    out.push(new Date(cursor).toISOString().slice(0, 10));
  return out;
}

export async function resolveOverviewFacility(
  context: AuthorizationContext,
  requested: number,
): Promise<Facility> {
  if (context.isSuperAdmin)
    throw new ReportCentreError(
      'FACILITY_ACCOUNT_REQUIRED',
      'A facility account is required.',
      403,
    );
  const facilityId = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new ReportCentreError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  if (!enabled(facility, 'analytics'))
    throw new ReportCentreError(
      'FACILITY_MODULE_DISABLED',
      'The reporting module is unavailable for this facility.',
      403,
    );
  return facility;
}

export async function getReportingOverview(
  context: AuthorizationContext,
  input: { facilityId?: unknown; from?: unknown; to?: unknown },
): Promise<ReportingOverview> {
  const facilityId = Number(input.facilityId);
  if (!Number.isSafeInteger(facilityId) || facilityId <= 0)
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Select a facility.');
  const facility = await resolveOverviewFacility(context, facilityId);
  const window = range(input);
  const tenantId = facility.tenantId;
  const id = facility.id;
  const args = [tenantId, id, window.from, window.to];
  /* Same currency source and fallback as the reports themselves. */
  const currencyRows = await pool.query<{ currency: string | null }>(
    'SELECT currency FROM tenants WHERE id=$1',
    [tenantId],
  );
  const currency = currencyRows.rows[0]?.currency?.trim() || null;

  const [visits, revenue, outstanding, stock] = await Promise.all([
    card(
      context,
      facility,
      { permissions: ['reports.read', 'clinical.read'], modules: ['analytics', 'opd'] },
      {
        id: 'patient-visits',
        label: 'Patient visits',
        definition:
          'Encounters with a recorded start date inside the period, outpatient and inpatient together, at this facility.',
        periodScoped: true,
      },
      async () => {
        const total = await pool.query<{ value: number }>(
          `SELECT count(*)::int AS value FROM encounters
           WHERE tenant_id=$1 AND facility_id=$2
             AND started_at::date >= $3::date AND started_at::date <= $4::date`,
          args,
        );
        const daily = await pool.query<{ day: string; value: number }>(
          `SELECT to_char(started_at::date,'YYYY-MM-DD') AS day, count(*)::int AS value
           FROM encounters
           WHERE tenant_id=$1 AND facility_id=$2
             AND started_at::date >= $3::date AND started_at::date <= $4::date
           GROUP BY 1 ORDER BY 1`,
          args,
        );
        const byDay = new Map(daily.rows.map((row) => [row.day, row.value]));
        return {
          value: total.rows[0]?.value ?? 0,
          series: days(window.from, window.to).map((day) => ({
            day,
            value: byDay.get(day) ?? 0,
          })),
        };
      },
    ),
    card(
      context,
      facility,
      { permissions: ['reports.read', 'billing.read'], modules: ['analytics', 'finance'] },
      {
        id: 'revenue',
        label: 'Revenue',
        definition:
          'Payments recorded at the cashier during the period, less refunds recorded against them. Cash received, not recognised or invoiced revenue.',
        periodScoped: true,
      },
      async () => {
        const [payments, refunds] = await Promise.all([
          pool.query<{ day: string; amount: string | null; invalid: number }>(
            `SELECT to_char(p.payment_date,'YYYY-MM-DD') AS day, sum(p.amount)::text AS amount,
                    count(*) FILTER (WHERE p.amount <= 0 OR p.amount::text IN ('NaN','Infinity','-Infinity'))::int AS invalid
             FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
             WHERE i.tenant_id=$1 AND i.facility_id=$2
               AND p.payment_date::date >= $3::date AND p.payment_date::date <= $4::date
             GROUP BY 1 ORDER BY 1`,
            args,
          ),
          pool.query<{ day: string; amount: string | null; invalid: number }>(
            `SELECT to_char(r.created_at,'YYYY-MM-DD') AS day, sum(r.amount)::text AS amount,
                    count(*) FILTER (WHERE r.amount <= 0 OR r.amount::text IN ('NaN','Infinity','-Infinity')
                      OR NOT r.manual_confirmation OR p.id IS NULL OR i.id IS NULL)::int AS invalid
             FROM billing_refunds r
             LEFT JOIN billing_payments p ON p.id=r.payment_id AND p.invoice_id=r.invoice_id
             LEFT JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
             WHERE r.tenant_id=$1 AND r.facility_id=$2
               AND r.created_at::date >= $3::date AND r.created_at::date <= $4::date
             GROUP BY 1 ORDER BY 1`,
            args,
          ),
        ]);
        if ([...payments.rows, ...refunds.rows].some((row) => row.invalid))
          throw new ReportCentreError(
            'RECEIPTS_REQUIRE_REVIEW',
            'Some recorded receipts or refunds cannot be totalled (a non-positive or non-numeric amount). Open the cashier summary to review them.',
            422,
          );
        let totals;
        try {
          totals = netReceipts(payments.rows, refunds.rows);
        } catch (error) {
          if (!(error instanceof ReceiptReviewRequired)) throw error;
          throw new ReportCentreError(
            'RECEIPTS_REQUIRE_REVIEW',
            `${error.message} Open the cashier summary to review the affected receipts.`,
            422,
          );
        }
        return {
          amount: totals.net,
          currency,
          // Exact cents, kept as a number only for the chart's bar heights.
          series: days(window.from, window.to).map((day) => ({
            day,
            value: Number(totals.byDay.get(day) ?? 0n) / 100,
          })),
        };
      },
    ),
    card(
      context,
      facility,
      { permissions: ['reports.read', 'billing.read'], modules: ['analytics', 'finance'] },
      {
        id: 'outstanding-balances',
        label: 'Outstanding balances',
        definition:
          'The sum of positive balances currently recorded on non-voided invoice headers at this facility. A live snapshot taken today, not an aged or as-of-period receivable.',
        periodScoped: false,
      },
      async () => {
        const result = await pool.query<{
          amount: string | null;
          invalid: number;
          invoices: number;
        }>(
          `SELECT sum(balance_amount) FILTER (
                    WHERE balance_amount::text NOT IN ('NaN','Infinity','-Infinity') AND balance_amount > 0
                  )::text AS amount,
                  count(*) FILTER (
                    WHERE balance_amount::text IN ('NaN','Infinity','-Infinity') OR balance_amount < 0
                  )::int AS invalid,
                  count(*) FILTER (WHERE balance_amount > 0)::int AS invoices
           FROM billing_invoices
           WHERE tenant_id=$1 AND facility_id=$2 AND voided_at IS NULL`,
          [tenantId, id],
        );
        const row = result.rows[0];
        if (row?.invalid)
          throw new ReportCentreError(
            'BALANCES_REQUIRE_REVIEW',
            'Some invoices carry a negative or non-numeric balance. They are excluded from this total; open the balance snapshot to review them.',
            422,
          );
        const today = await pool.query<{ day: string }>(
          "SELECT to_char(current_date,'YYYY-MM-DD') AS day",
        );
        return {
          amount: row?.amount ?? '0.00',
          currency,
          asOf: today.rows[0]?.day,
          value: row?.invoices ?? 0,
        };
      },
    ),
    card(
      context,
      facility,
      { permissions: ['reports.read', 'inventory.read'], modules: ['analytics', 'inventory'] },
      {
        id: 'pharmacy-stock-alerts',
        label: 'Pharmacy stock alerts',
        definition:
          'Active pharmacy items whose recorded stock is at or below their recorded reorder level. Items without a recorded reorder level are not counted.',
        periodScoped: false,
      },
      async () => {
        const result = await pool.query<{ value: number; asOf: string }>(
          `SELECT count(*)::int AS value, to_char(current_date,'YYYY-MM-DD') AS "asOf"
           FROM inventory_items i JOIN facilities f ON f.id=i.facility_id
           WHERE f.tenant_id=$1 AND i.facility_id=$2
             AND i.is_active IS TRUE
             AND i.reorder_level IS NOT NULL
             AND lower(coalesce(i.category,'')) LIKE 'pharm%'
             AND coalesce(i.current_stock,0) <= i.reorder_level`,
          [tenantId, id],
        );
        return { value: result.rows[0]?.value ?? 0, asOf: result.rows[0]?.asOf };
      },
    ),
  ]);

  return {
    facilityId: facility.id,
    facilityName: facility.name,
    from: window.from,
    to: window.to,
    generatedAt: new Date().toISOString(),
    currency,
    kpis: [visits, revenue, outstanding, stock],
    notes: NOTES,
  };
}
