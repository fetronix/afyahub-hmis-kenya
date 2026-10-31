import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import {
  AccountingIntegrityError,
  parseKesToCents,
  requireIsoDate,
  type AccountingScope,
} from './accounting.service.ts';

type DiagnosticRow = {
  id: number;
  invoiceNumber: string;
  status: string | null;
  total: string | null;
  paid: string | null;
  balance: string | null;
  credit: string | null;
  lineCount: number;
  lineTotal: string | null;
  invalidLines: number;
  paymentCount: number;
  paymentTotal: string | null;
  invalidPayments: number;
  refundCount: number;
  refundTotal: string | null;
  invalidRefunds: number;
};

function cents(value: string | null): bigint | null {
  try {
    return parseKesToCents(value);
  } catch {
    return null;
  }
}

/**
 * Current invoice/receipt consistency diagnostics, NOT a GL reconciliation.
 * Creation dates filter invoices; their current lines and receipts are examined.
 * This never posts, edits, writes off, or asserts external settlement.
 */
export async function inspectBillingConsistencyScoped(
  scope: AccountingScope,
  input: { startDate: unknown; endDate: unknown; afterId?: unknown; limit?: unknown },
  client: PoolClient | typeof pool = pool,
) {
  const startDate = requireIsoDate(input.startDate);
  const endDate = requireIsoDate(input.endDate);
  if (startDate > endDate)
    throw new AccountingIntegrityError('INVALID_RANGE', 'Start date must not be after end date.');
  const afterId = input.afterId === undefined ? 0 : Number(input.afterId);
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (
    !Number.isSafeInteger(afterId) ||
    afterId < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new AccountingIntegrityError(
      'INVALID_PAGINATION',
      'Use a valid cursor and page size between 1 and 200.',
    );
  }
  const { rows } = await client.query<DiagnosticRow>(
    `SELECT i.id, i.invoice_number AS "invoiceNumber", i.status,
       i.total_amount::text AS total, i.paid_amount::text AS paid,
       i.balance_amount::text AS balance, i.credit_balance::text AS credit,
       li.count AS "lineCount", li.total AS "lineTotal", li.invalid AS "invalidLines",
       p.count AS "paymentCount", p.total AS "paymentTotal", p.invalid AS "invalidPayments",
       r.count AS "refundCount", r.total AS "refundTotal", r.invalid AS "invalidRefunds"
     FROM billing_invoices i
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS count, COALESCE(sum(b.total_amount),0)::text AS total,
         count(*) FILTER (WHERE b.total_amount IS NULL OR b.total_amount < 0 OR b.total_amount::text IN ('NaN','Infinity','-Infinity')
           OR b.quantity IS NULL OR b.quantity <= 0 OR b.unit_price IS NULL OR b.unit_price < 0
           OR b.unit_price::text IN ('NaN','Infinity','-Infinity') OR b.total_amount <> b.quantity * b.unit_price)::int AS invalid
       FROM billing_items b WHERE b.invoice_id=i.id
     ) li
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS count, COALESCE(sum(p.amount),0)::text AS total,
         count(*) FILTER (WHERE p.amount IS NULL OR p.amount <= 0 OR p.amount::text IN ('NaN','Infinity','-Infinity'))::int AS invalid
       FROM billing_payments p WHERE p.invoice_id=i.id
     ) p
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS count, COALESCE(sum(r.amount),0)::text AS total,
         count(*) FILTER (WHERE r.amount IS NULL OR r.amount <= 0 OR r.amount::text IN ('NaN','Infinity','-Infinity')
           OR p2.id IS NULL OR p2.invoice_id <> i.id OR r.tenant_id <> i.tenant_id OR r.facility_id <> i.facility_id
           OR (SELECT sum(r2.amount) FROM billing_refunds r2 WHERE r2.payment_id=r.payment_id) > p2.amount)::int AS invalid
       FROM billing_refunds r LEFT JOIN billing_payments p2 ON p2.id=r.payment_id WHERE r.invoice_id=i.id
     ) r
     WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.created_at >= $3::date
       AND i.created_at < ($4::date + interval '1 day') AND i.id > $5
     ORDER BY i.id LIMIT $6`,
    [scope.tenantId, scope.facilityId, startDate, endDate, afterId, limit + 1],
  );
  const page = rows.slice(0, limit);
  const invoices = page.map((r) => {
    const issues: string[] = [];
    const total = cents(r.total),
      paid = cents(r.paid),
      balance = cents(r.balance),
      credit = cents(r.credit);
    const lineTotal = cents(r.lineTotal),
      paymentTotal = cents(r.paymentTotal),
      refundTotal = cents(r.refundTotal);
    if (total === null || paid === null || balance === null || credit === null)
      issues.push('INVALID_HEADER_AMOUNT');
    if (
      total !== null &&
      paid !== null &&
      balance !== null &&
      balance !== (total > paid ? total - paid : 0n)
    )
      issues.push('BALANCE_MISMATCH');
    if (
      total !== null &&
      paid !== null &&
      credit !== null &&
      credit !== (paid > total ? paid - total : 0n)
    )
      issues.push('CREDIT_MISMATCH');
    if (r.invalidLines || lineTotal === null) issues.push('INVALID_LINE');
    if (total !== null && lineTotal !== null && total !== lineTotal)
      issues.push('LINE_TOTAL_MISMATCH');
    if (r.invalidPayments || paymentTotal === null) issues.push('INVALID_PAYMENT');
    if (
      r.invalidRefunds ||
      refundTotal === null ||
      (paymentTotal !== null && refundTotal > paymentTotal)
    )
      issues.push('INVALID_REFUND');
    const netPayments =
      paymentTotal !== null && refundTotal !== null ? paymentTotal - refundTotal : null;
    if (paid !== null && netPayments !== null && paid !== netPayments)
      issues.push('PAYMENT_TOTAL_MISMATCH');
    if (r.status === 'Void' && (netPayments === null || netPayments > 0n))
      issues.push('VOID_WITH_PAYMENT');
    return { ...r, issues };
  });
  return {
    filters: { startDate, endDate, afterId, limit },
    invoices,
    pageSummary: {
      examined: invoices.length,
      requiringReview: invoices.filter((r) => r.issues.length > 0).length,
    },
    nextAfterId: rows.length > limit ? page[page.length - 1].id : null,
    limitations: {
      ledgerReconciliation: 'NOT_IMPLEMENTED',
      notice:
        'Current invoice totals, lines, receipts and recorded refunds are compared for the selected invoice creation dates. This does not reconcile the general ledger, claims, bank statements or external payment settlement.',
    },
  };
}
