/**
 * Source-to-ledger coverage.
 *
 * WHY THIS EXISTS
 * Billing-to-GL posting is a reviewed manual action: a facility accountant
 * chooses the accounts, and the bridge in `accounting_billing_postings` records
 * what was posted for which source. That design is deliberate — this system
 * does not invent an accounting policy — but it creates a question an auditor
 * asks first: *which money events have no ledger entry?*
 *
 * The existing diagnostics answer that question only for invoices selected by
 * **creation date**, and then read whatever receipts and refunds those invoices
 * happen to have now. A receipt taken today against an invoice opened eight
 * months ago therefore falls outside a "this month" review — exactly the
 * receipt most likely to be missed.
 *
 * This report selects each source family by **its own activity date**:
 *
 *   - invoices: finalized in the window (the moment revenue becomes real);
 *   - receipts: `payment_date` in the window;
 *   - refunds:  recorded in the window.
 *
 * For every source it reports whether an active reviewed posting exists. A
 * source whose journal was reversed is reported as `REVERSED`, not as covered:
 * the reversal removed it from the ledger, and someone has to explain why
 * before the period can be relied on.
 *
 * It never posts, repairs, writes off, or infers an account. Read-only.
 */

import {
  AccountingIntegrityError,
  requireIsoDate,
  transaction,
  type AccountingScope,
} from './accounting.service.ts';

type Family = 'invoices' | 'receipts' | 'refunds';

type FamilyTotals = {
  examined: number;
  posted: number;
  unposted: number;
  reversed: number;
  amount: string;
  unpostedAmount: string;
  reversedAmount: string;
};

type SourceRow = {
  sourceType: string;
  sourceId: number;
  reference: string;
  sourceDate: string;
  amount: string;
  postingId: number | null;
  journalId: number | null;
  reversedOn: string | null;
};

export type SourceLedgerException = {
  sourceType: 'BILLING_INVOICE' | 'BILLING_PAYMENT' | 'BILLING_REFUND';
  sourceId: number;
  reference: string;
  sourceDate: string;
  amount: string;
  reason: 'UNPOSTED' | 'REVERSED';
  journalId: number | null;
  reversedOn: string | null;
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function totals(rows: SourceRow[]): FamilyTotals {
  let examined = 0;
  let posted = 0;
  let unposted = 0;
  let reversed = 0;
  let amountCents = 0n;
  let unpostedCents = 0n;
  let reversedCents = 0n;
  for (const row of rows) {
    examined += 1;
    const cents = BigInt(row.amount); // SQL casts to integer cents.
    amountCents += cents;
    if (!row.postingId) {
      unposted += 1;
      unpostedCents += cents;
    } else if (row.reversedOn) {
      reversed += 1;
      reversedCents += cents;
    } else {
      posted += 1;
    }
  }
  return {
    examined,
    posted,
    unposted,
    reversed,
    amount: centsToKesText(amountCents),
    unpostedAmount: centsToKesText(unpostedCents),
    reversedAmount: centsToKesText(reversedCents),
  };
}

/** Signed integer cents to KES text without a float round-trip. */
function centsToKesText(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export async function inspectSourceLedgerCoverageScoped(
  scope: AccountingScope,
  input: { startDate: unknown; endDate: unknown; limit?: unknown },
) {
  const startDate = requireIsoDate(input.startDate);
  const endDate = requireIsoDate(input.endDate);
  if (startDate > endDate)
    throw new AccountingIntegrityError('INVALID_RANGE', 'Start date must not be after end date.');
  const limit =
    input.limit === undefined || input.limit === '' ? DEFAULT_LIMIT : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new AccountingIntegrityError(
      'INVALID_PAGINATION',
      `Use an exception page size between 1 and ${MAX_LIMIT}.`,
    );

  return transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    /*
     * Each query returns reference data plus a boolean "is this source still in
     * the ledger". The aggregation is done in SQL so a large facility does not
     * stream every receipt into memory; the exception rows are limited.
     *
     * `voided` invoices are excluded from invoice coverage: their receivable was
     * cancelled, so the correct ledger state is a reversal, not an active entry.
     * Their receipts are excluded too, because voiding requires an unpaid
     * invoice — a receipt on a voided invoice is a data-integrity defect the
     * billing diagnostics already report.
     */
    const invoiceRows = (
      await tx.query<SourceRow>(
        `SELECT 'BILLING_INVOICE' AS "sourceType", i.id AS "sourceId",
           i.invoice_number AS reference,
           f.finalized_at::date::text AS "sourceDate",
           round(i.total_amount * 100)::bigint::text AS amount,
           p.id AS "postingId", p.journal_id AS "journalId",
           (SELECT min(r.entry_date)::date::text FROM journal_entries r
              WHERE r.reversal_of_journal_id = p.journal_id AND r.status = 'POSTED') AS "reversedOn"
         FROM billing_invoices i
         JOIN billing_invoice_finalizations f ON f.invoice_id = i.id
           AND f.tenant_id = i.tenant_id AND f.facility_id = i.facility_id
         LEFT JOIN accounting_billing_postings p ON p.tenant_id = i.tenant_id
           AND p.facility_id = i.facility_id
           AND p.source_type = 'BILLING_INVOICE' AND p.source_id = i.id
         WHERE i.tenant_id = $1 AND i.facility_id = $2
           AND i.status <> 'Void' AND i.voided_at IS NULL
           AND f.finalized_at::date BETWEEN $3::date AND $4::date
         ORDER BY f.finalized_at, i.id`,
        [scope.tenantId, scope.facilityId, startDate, endDate],
      )
    ).rows;

    const receiptRows = (
      await tx.query<SourceRow>(
        `SELECT 'BILLING_PAYMENT' AS "sourceType", pm.id AS "sourceId",
           pm.receipt_number AS reference,
           pm.payment_date::date::text AS "sourceDate",
           round(pm.amount * 100)::bigint::text AS amount,
           p.id AS "postingId", p.journal_id AS "journalId",
           (SELECT min(r.entry_date)::date::text FROM journal_entries r
              WHERE r.reversal_of_journal_id = p.journal_id AND r.status = 'POSTED') AS "reversedOn"
         FROM billing_payments pm
         JOIN billing_invoices i ON i.id = pm.invoice_id
         LEFT JOIN accounting_billing_postings p ON p.tenant_id = i.tenant_id
           AND p.facility_id = i.facility_id
           AND p.source_type = 'BILLING_PAYMENT' AND p.source_id = pm.id
         WHERE i.tenant_id = $1 AND i.facility_id = $2
           AND pm.payment_date::date BETWEEN $3::date AND $4::date
         ORDER BY pm.payment_date, pm.id`,
        [scope.tenantId, scope.facilityId, startDate, endDate],
      )
    ).rows;

    const refundRows = (
      await tx.query<SourceRow>(
        `SELECT 'BILLING_REFUND' AS "sourceType", rf.id AS "sourceId",
           rf.refund_number AS reference,
           rf.created_at::date::text AS "sourceDate",
           round(rf.amount * 100)::bigint::text AS amount,
           p.id AS "postingId", p.journal_id AS "journalId",
           (SELECT min(r.entry_date)::date::text FROM journal_entries r
              WHERE r.reversal_of_journal_id = p.journal_id AND r.status = 'POSTED') AS "reversedOn"
         FROM billing_refunds rf
         LEFT JOIN accounting_billing_postings p ON p.tenant_id = rf.tenant_id
           AND p.facility_id = rf.facility_id
           AND p.source_type = 'BILLING_REFUND' AND p.source_id = rf.id
         WHERE rf.tenant_id = $1 AND rf.facility_id = $2
           AND rf.created_at::date BETWEEN $3::date AND $4::date
         ORDER BY rf.created_at, rf.id`,
        [scope.tenantId, scope.facilityId, startDate, endDate],
      )
    ).rows;

    const families: Record<Family, SourceRow[]> = {
      invoices: invoiceRows,
      receipts: receiptRows,
      refunds: refundRows,
    };

    const open = (rows: SourceRow[]) =>
      rows.filter((row) => !row.postingId || row.reversedOn !== null);
    const openRows = open(invoiceRows)
      .concat(open(receiptRows))
      .concat(open(refundRows))
      .sort((a, b) =>
        a.sourceDate === b.sourceDate
          ? a.sourceType.localeCompare(b.sourceType) || a.sourceId - b.sourceId
          : a.sourceDate.localeCompare(b.sourceDate),
      );

    const exceptions: SourceLedgerException[] = openRows.slice(0, limit).map((row) => ({
      sourceType: row.sourceType as SourceLedgerException['sourceType'],
      sourceId: row.sourceId,
      reference: row.reference,
      sourceDate: row.sourceDate,
      amount: centsToKesText(BigInt(row.amount)),
      reason: row.postingId ? 'REVERSED' : 'UNPOSTED',
      journalId: row.journalId,
      reversedOn: row.reversedOn,
    }));

    return {
      window: { startDate, endDate },
      sources: {
        invoices: totals(families.invoices),
        receipts: totals(families.receipts),
        refunds: totals(families.refunds),
      },
      coverage: openRows.length === 0 ? ('COMPLETE' as const) : ('GAPS_FOUND' as const),
      exceptions,
      exceptionsTruncated: openRows.length > exceptions.length,
      openExceptionCount: openRows.length,
      limitations: {
        /* Posting is a reviewed manual action; nothing here posts automatically. */
        posting: 'MANUAL_REVIEWED',
        notice:
          'Coverage reports whether a reviewed posting exists for each source; it does not validate account classification, recognition, cash movement, payer settlement or bank receipt. Reversed postings are listed separately and are not treated as covered.',
      },
    };
  });
}

/**
 * The same question for one invoice's whole life, used from the invoice screen
 * so a cashier can see whether the receipt they just took is in the ledger.
 */
export async function inspectInvoiceLedgerCoverageScoped(
  scope: AccountingScope,
  invoiceId: number,
) {
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0)
    throw new AccountingIntegrityError('INVALID_INPUT', 'A valid invoice ID is required.', 400);
  return transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const [invoice] = (
      await tx.query<{ status: string | null; voided: boolean }>(
        `SELECT status, (voided_at IS NOT NULL) AS voided FROM billing_invoices
         WHERE id = $1 AND tenant_id = $2 AND facility_id = $3`,
        [invoiceId, scope.tenantId, scope.facilityId],
      )
    ).rows;
    if (!invoice) throw new AccountingIntegrityError('SOURCE_NOT_FOUND', 'Invoice not found.', 404);
    const rows = (
      await tx.query<SourceRow>(
        `WITH sources AS (
           SELECT 'BILLING_INVOICE' AS "sourceType", i.id AS "sourceId",
             i.invoice_number AS reference, i.created_at::date::text AS "sourceDate",
             round(i.total_amount * 100)::bigint::text AS amount
           FROM billing_invoices i WHERE i.id = $1
           UNION ALL
           SELECT 'BILLING_PAYMENT', pm.id, pm.receipt_number,
             pm.payment_date::date::text, round(pm.amount * 100)::bigint::text
           FROM billing_payments pm WHERE pm.invoice_id = $1
           UNION ALL
           SELECT 'BILLING_REFUND', rf.id, rf.refund_number,
             rf.created_at::date::text, round(rf.amount * 100)::bigint::text
           FROM billing_refunds rf WHERE rf.invoice_id = $1
         )
         SELECT s.*, p.id AS "postingId", p.journal_id AS "journalId",
           (SELECT min(r.entry_date)::date::text FROM journal_entries r
              WHERE r.reversal_of_journal_id = p.journal_id AND r.status = 'POSTED') AS "reversedOn"
         FROM sources s
         LEFT JOIN accounting_billing_postings p ON p.tenant_id = $2 AND p.facility_id = $3
           AND p.source_type = s."sourceType" AND p.source_id = s."sourceId"
         ORDER BY s."sourceDate", s."sourceType", s."sourceId"`,
        [invoiceId, scope.tenantId, scope.facilityId],
      )
    ).rows;
    return {
      invoiceId,
      invoiceVoided: invoice.voided || invoice.status === 'Void',
      sources: rows.map((row) => ({
        sourceType: row.sourceType as SourceLedgerException['sourceType'],
        sourceId: row.sourceId,
        reference: row.reference,
        sourceDate: row.sourceDate,
        amount: centsToKesText(BigInt(row.amount)),
        state: !row.postingId
          ? ('UNPOSTED' as const)
          : row.reversedOn
            ? ('REVERSED' as const)
            : ('POSTED' as const),
        journalId: row.journalId,
        reversedOn: row.reversedOn,
      })),
      limitations: {
        posting: 'MANUAL_REVIEWED',
        notice:
          'Each source is listed with whether a reviewed posting exists. A posted state confirms a journal link, not correct classification or cash movement.',
      },
    };
  });
}
