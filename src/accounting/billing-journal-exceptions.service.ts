/** Journal-side complement to invoice-source review. Read-only; no repair. */
import { pool } from '../db/index.ts';
import {
  AccountingIntegrityError,
  parseKesToCents,
  requireIsoDate,
  type AccountingScope,
} from './accounting.service.ts';

type JournalCandidate = {
  id: number;
  sourceType: string;
  sourceId: string | null;
  entryDate: string;
  status: string;
  debit: string;
  credit: string;
  linesDebit: string;
  linesCredit: string;
  sourceAmount: string | null;
  sourceExists: boolean;
  tracked: boolean;
  reversed: boolean;
};

export async function inspectBillingJournalExceptionsScoped(
  scope: AccountingScope,
  input: { startDate: unknown; endDate: unknown; afterJournalId?: unknown; limit?: unknown },
) {
  const startDate = requireIsoDate(input.startDate);
  const endDate = requireIsoDate(input.endDate);
  const afterJournalId = input.afterJournalId === undefined ? 0 : Number(input.afterJournalId);
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (startDate > endDate)
    throw new AccountingIntegrityError('INVALID_RANGE', 'Start date must not be after end date.');
  if (
    !Number.isSafeInteger(afterJournalId) ||
    afterJournalId < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new AccountingIntegrityError(
      'INVALID_PAGINATION',
      'Use a valid journal cursor and page size between 1 and 200.',
    );
  // Every candidate is returned, including matches, so cursor pagination does
  // not skip later exceptions. A single statement observes one PG snapshot.
  const result = await pool.query<JournalCandidate>(
    `SELECT e.id,e.source_type AS "sourceType",e.source_id AS "sourceId",
      e.entry_date::text AS "entryDate",e.status,e.total_debit_cents::text AS debit,e.total_credit_cents::text AS credit,
      (SELECT COALESCE(sum(l.debit_cents),0)::text FROM journal_lines l WHERE l.journal_entry_id=e.id) AS "linesDebit",
      (SELECT COALESCE(sum(l.credit_cents),0)::text FROM journal_lines l WHERE l.journal_entry_id=e.id) AS "linesCredit",
      CASE e.source_type
        WHEN 'BILLING_INVOICE' THEN (SELECT i.total_amount::text FROM billing_invoices i WHERE i.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id)
        WHEN 'BILLING_ITEM' THEN (SELECT b.total_amount::text FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id WHERE b.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id)
        WHEN 'BILLING_PAYMENT' THEN (SELECT p.amount::text FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id WHERE p.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id)
        WHEN 'BILLING_REFUND' THEN (SELECT r.amount::text FROM billing_refunds r WHERE r.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND r.tenant_id=e.tenant_id AND r.facility_id=e.facility_id)
        WHEN 'BILLING_VOID' THEN (SELECT i.total_amount::text FROM billing_invoices i WHERE i.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id AND (i.status='Void' OR i.voided_at IS NOT NULL))
      END AS "sourceAmount",
      CASE e.source_type
        WHEN 'BILLING_INVOICE' THEN EXISTS (SELECT 1 FROM billing_invoices i WHERE i.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id)
        WHEN 'BILLING_ITEM' THEN EXISTS (SELECT 1 FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id WHERE b.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id)
        WHEN 'BILLING_PAYMENT' THEN EXISTS (SELECT 1 FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id WHERE p.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id)
        WHEN 'BILLING_REFUND' THEN EXISTS (SELECT 1 FROM billing_refunds r WHERE r.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND r.tenant_id=e.tenant_id AND r.facility_id=e.facility_id)
        WHEN 'BILLING_VOID' THEN EXISTS (SELECT 1 FROM billing_invoices i WHERE i.id=CASE WHEN e.source_id ~ '^[1-9][0-9]{0,9}$' THEN e.source_id::bigint ELSE NULL END AND i.tenant_id=e.tenant_id AND i.facility_id=e.facility_id AND (i.status='Void' OR i.voided_at IS NOT NULL))
      END AS "sourceExists",
      EXISTS (SELECT 1 FROM accounting_billing_postings p WHERE p.journal_id=e.id AND p.tenant_id=e.tenant_id AND p.facility_id=e.facility_id) AS tracked,
      EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=e.id AND r.status='POSTED') AS reversed
    FROM journal_entries e WHERE e.tenant_id=$1 AND e.facility_id=$2 AND e.entry_date BETWEEN $3::date AND $4::date
      AND e.id>$5 AND e.source_type IN ('BILLING_INVOICE','BILLING_ITEM','BILLING_PAYMENT','BILLING_REFUND','BILLING_VOID')
    ORDER BY e.id LIMIT $6`,
    [scope.tenantId, scope.facilityId, startDate, endDate, afterJournalId, limit + 1],
  );
  const candidates = result.rows.slice(0, limit).map((row) => {
    const issues: string[] = [];
    if (!row.sourceExists) issues.push('SOURCE_MISSING_OR_OUT_OF_SCOPE');
    else if (row.sourceAmount === null) issues.push('INVALID_SOURCE_AMOUNT');
    else {
      try {
        const amount = parseKesToCents(row.sourceAmount);
        if (amount <= 0n) issues.push('INVALID_SOURCE_AMOUNT');
        else if (BigInt(row.debit) !== amount || BigInt(row.credit) !== amount)
          issues.push('JOURNAL_AMOUNT_MISMATCH');
      } catch {
        issues.push('INVALID_SOURCE_AMOUNT');
      }
    }
    if (row.status !== 'POSTED') issues.push('JOURNAL_NOT_POSTED');
    if (
      row.debit !== row.linesDebit ||
      row.credit !== row.linesCredit ||
      row.linesDebit !== row.linesCredit
    )
      issues.push('JOURNAL_LINES_MISMATCH');
    if (row.reversed) issues.push('REVERSAL_REQUIRES_REVIEW');
    if (
      !row.tracked &&
      ['BILLING_INVOICE', 'BILLING_PAYMENT', 'BILLING_REFUND'].includes(row.sourceType)
    )
      issues.push('UNTRACKED_SOURCE_LINK');
    return {
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      entryDate: row.entryDate,
      issues,
    };
  });
  return {
    journals: candidates,
    pageSummary: {
      examined: candidates.length,
      requiringReview: candidates.filter((j) => j.issues.length > 0).length,
    },
    nextAfterJournalId: result.rows.length > limit ? candidates[candidates.length - 1].id : null,
    limitations:
      'Checks only known billing source types and journal dates, not unlinked manual journals, chart classification, payer contracts, bank settlement or every historical source. Review all pages.',
  };
}
