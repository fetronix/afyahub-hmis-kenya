import { hasAllPermissions } from '../auth/authorization.service.ts';
import {
  requireFacilityScope,
  requireTenantScope,
  resolveFacilityScope,
} from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { validateRange } from '../dashboard/date-range.ts';
import { validTimezone } from '../dashboard/timezone.ts';
import { pool } from '../db/index.ts';

export class FinancialReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Recorded transaction activity, not a general ledger or external settlement
 * statement. Date selection uses the receipt/refund event, not its invoice's
 * date. All queries share one PostgreSQL snapshot and are facility-scoped.
 */
export async function getFinancialTransactionsScoped(
  context: AuthorizationContext,
  requestedFacilityId: number | undefined,
  from: unknown,
  to: unknown,
  rawOffset: unknown = 0,
) {
  if (!hasAllPermissions(context, ['reports.read', 'billing.read']))
    throw new FinancialReportError(
      'PERMISSION_REQUIRED',
      'Report and billing permissions are required.',
      403,
    );
  const range = validateRange(from, to);
  if (!range)
    throw new FinancialReportError(
      'INVALID_DATE_RANGE',
      'Choose a valid date range of at most 366 days.',
    );
  const offset =
    typeof rawOffset === 'string' && /^\d+$/.test(rawOffset) ? Number(rawOffset) : rawOffset;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1_000_000
  )
    throw new FinancialReportError('INVALID_OFFSET', 'Enter a valid report page offset.');
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const facility = (
      await client.query<{
        tenant_id: number;
        timezone: string | null;
        tenant_timezone: string | null;
      }>(
        `SELECT f.tenant_id,f.timezone,t.timezone AS tenant_timezone
         FROM facilities f JOIN tenants t ON t.id=f.tenant_id WHERE f.id=$1`,
        [facilityId],
      )
    ).rows[0];
    if (!facility) throw new FinancialReportError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
    requireTenantScope(context, facility.tenant_id);
    requireFacilityScope(context, facility.tenant_id, facilityId);
    const zone = facility.timezone ?? facility.tenant_timezone;
    if (!validTimezone(zone))
      throw new FinancialReportError(
        'TIMEZONE_REQUIRED',
        'A valid facility or tenant timezone is required.',
        409,
      );
    const args = [facility.tenant_id, facilityId, zone, range.start, range.end];
    // Older billing columns are timestamps without a zone. The application
    // interprets them as UTC; legacy data with a different origin needs review.
    const receiptDate = `((p.payment_date AT TIME ZONE 'UTC') AT TIME ZONE $3)::date`;
    const refundDate = `((r.created_at AT TIME ZONE 'UTC') AT TIME ZONE $3)::date`;
    const itemDate = `((b.created_at AT TIME ZONE 'UTC') AT TIME ZONE $3)::date`;
    const invoiceDate = `((i.created_at AT TIME ZONE 'UTC') AT TIME ZONE $3)::date`;
    const receipts = (
      await client.query(
        `SELECT COALESCE(NULLIF(trim(p.payment_method),''),'Unspecified') AS method,
              count(*)::int AS count,COALESCE(sum(p.amount),0)::text AS amount
       FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND ${receiptDate} BETWEEN $4::date AND $5::date
       GROUP BY 1 ORDER BY 1`,
        args,
      )
    ).rows;
    const refunds = (
      await client.query(
        `SELECT COALESCE(NULLIF(trim(r.refund_method),''),'Unspecified') AS method,
              count(*)::int AS count,COALESCE(sum(r.amount),0)::text AS amount
       FROM billing_refunds r JOIN billing_invoices i
         ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
       WHERE r.tenant_id=$1 AND r.facility_id=$2 AND ${refundDate} BETWEEN $4::date AND $5::date
       GROUP BY 1 ORDER BY 1`,
        args,
      )
    ).rows;
    const totals = (
      await client.query(
        `SELECT
       (SELECT count(*)::int FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
        WHERE i.tenant_id=$1 AND i.facility_id=$2 AND ${receiptDate} BETWEEN $4::date AND $5::date) AS "receiptCount",
       (SELECT COALESCE(sum(p.amount),0)::text FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
        WHERE i.tenant_id=$1 AND i.facility_id=$2 AND ${receiptDate} BETWEEN $4::date AND $5::date) AS "grossReceipts",
       (SELECT count(*)::int FROM billing_refunds r JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
        WHERE r.tenant_id=$1 AND r.facility_id=$2 AND ${refundDate} BETWEEN $4::date AND $5::date) AS "refundCount",
       (SELECT COALESCE(sum(r.amount),0)::text FROM billing_refunds r JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
        WHERE r.tenant_id=$1 AND r.facility_id=$2 AND ${refundDate} BETWEEN $4::date AND $5::date) AS "manualRefunds",
       ((SELECT COALESCE(sum(p.amount),0) FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
         WHERE i.tenant_id=$1 AND i.facility_id=$2 AND ${receiptDate} BETWEEN $4::date AND $5::date)
        - (SELECT COALESCE(sum(r.amount),0) FROM billing_refunds r JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
         WHERE r.tenant_id=$1 AND r.facility_id=$2 AND ${refundDate} BETWEEN $4::date AND $5::date))::text AS "netRecorded"`,
        args,
      )
    ).rows[0];
    const departments = (
      await client.query(
        `SELECT COALESCE(NULLIF(trim(b.service_department),''),'Unspecified') AS department,
              COALESCE(NULLIF(trim(b.source_type),''),'Unspecified') AS source,
              count(*)::int AS count,COALESCE(sum(b.total_amount),0)::text AS amount
       FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.voided_at IS NULL
         AND ${itemDate} BETWEEN $4::date AND $5::date
       GROUP BY 1,2 ORDER BY 1,2`,
        args,
      )
    ).rows;
    const bedCharges = (
      await client.query(
        `SELECT COALESCE(n.rate_source_snapshot,'LEGACY_NOT_RECORDED') AS source,
              count(*)::int AS count,COALESCE(sum(b.total_amount),0)::text AS amount
       FROM inpatient_bed_nights n JOIN billing_items b ON b.bed_night_id=n.id AND b.source_type='BED_DAY'
       JOIN billing_invoices i ON i.id=b.invoice_id
       WHERE n.tenant_id=$1 AND n.facility_id=$2 AND i.tenant_id=$1 AND i.facility_id=$2
         AND i.voided_at IS NULL AND n.billing_date BETWEEN $3::date AND $4::date
       GROUP BY 1 ORDER BY 1`,
        [facility.tenant_id, facilityId, range.start, range.end],
      )
    ).rows;
    const invoiceCohort = (
      await client.query(
        `SELECT count(*)::int AS count,COALESCE(sum(i.total_amount),0)::text AS invoiced,
              COALESCE(sum(i.balance_amount),0)::text AS "currentOutstanding"
       FROM billing_invoices i WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.voided_at IS NULL
         AND ${invoiceDate} BETWEEN $4::date AND $5::date`,
        args,
      )
    ).rows[0];
    const anomalies = (
      await client.query(
        `SELECT count(*)::int AS count FROM billing_refunds r
       LEFT JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
       WHERE r.tenant_id=$1 AND r.facility_id=$2 AND i.id IS NULL
         AND ${refundDate} BETWEEN $4::date AND $5::date`,
        args,
      )
    ).rows[0].count as number;
    const pageSize = 100;
    const transactions = (
      await client.query(
        `SELECT * FROM (
         SELECT 'RECEIPT'::text AS kind,p.id,p.receipt_number AS reference,p.payment_method AS method,
                p.amount::text AS amount,i.invoice_number AS "invoiceNumber",
                p.transaction_code AS "externalReference",${receiptDate}::text AS "localDate",
                p.payment_date::text AS "recordedAtUtcAssumed"
         FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
         WHERE i.tenant_id=$1 AND i.facility_id=$2 AND ${receiptDate} BETWEEN $4::date AND $5::date
         UNION ALL
         SELECT 'MANUAL_REFUND',r.id,r.refund_number,r.refund_method,r.amount::text,i.invoice_number,
                r.external_reference,${refundDate}::text,r.created_at::text
         FROM billing_refunds r JOIN billing_invoices i
           ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
         WHERE r.tenant_id=$1 AND r.facility_id=$2 AND ${refundDate} BETWEEN $4::date AND $5::date
       ) events ORDER BY "recordedAtUtcAssumed" DESC,kind,id DESC LIMIT $6 OFFSET $7`,
        [...args, pageSize + 1, offset],
      )
    ).rows;
    await client.query('COMMIT');
    return {
      facilityId,
      from: range.start,
      to: range.end,
      timezone: zone,
      totals,
      receipts,
      refunds,
      departments,
      bedCharges,
      invoiceCohort,
      excludedScopeConflicts: anomalies,
      transactions: {
        rows: transactions.slice(0, pageSize),
        hasMore: transactions.length > pageSize,
        offset,
        pageSize,
      },
      limitations: [
        'Receipts are recorded payment rows, not proof of provider or bank confirmation.',
        'Refunds are manually recorded and do not prove an external transfer.',
        'Department lines are billed amounts, not recognized ledger revenue; bed charges require linked bed-night evidence.',
        'Outstanding is the current balance of invoices created in the selected window, not a historical as-of balance.',
        'Timezone-less timestamps are interpreted as UTC; verify the origin of legacy records before relying on their calendar dates.',
      ],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
