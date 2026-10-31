import { parseKesToCents, transaction, type AccountingScope } from './accounting.service.ts';
import { inspectBillingConsistencyScoped } from './billing-diagnostics.service.ts';

type SourceRow = {
  sourceType: string;
  sourceId: number;
  invoiceId: number;
  amount: string | null;
  journalCount: number;
  journalIds: number[] | null;
  debit: string;
  credit: string;
  linesDebit: string;
  linesCredit: string;
  nonPosted: number;
  reversed: number;
  payerLinked: boolean;
};

/**
 * Read-only source-to-journal exception report. Matching a source and amount
 * is not proof of correct accounts, recognition, a bank transfer or payer
 * settlement. Existing unlinked manual journals remain unverified.
 */
export async function inspectBillingLedgerScoped(
  scope: AccountingScope,
  input: {
    startDate: unknown;
    endDate: unknown;
    afterId?: unknown;
    limit?: unknown;
  },
) {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const consistency = await inspectBillingConsistencyScoped(scope, input, client);
    const invoiceIds = consistency.invoices.map((row) => row.id);
    if (!invoiceIds.length)
      return {
        ...consistency,
        sourceEvents: [],
        ledgerPageSummary: { examined: 0, unposted: 0, requiringReview: 0 },
        limitations: {
          ledgerReconciliation: 'PARTIAL',
          notice:
            'No matching invoice sources on this page. Automatic posting, account classification, payer and bank reconciliation are not established.',
        },
      };
    const { rows } = await client.query<SourceRow>(
      `WITH sources AS (
       SELECT 'BILLING_ITEM'::text AS source_type,b.id AS source_id,b.invoice_id,b.total_amount::text AS amount,false AS payer_linked
       FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.id=ANY($3::int[])
         AND (NOT EXISTS (SELECT 1 FROM billing_invoice_finalizations f WHERE f.invoice_id=i.id)
           OR EXISTS (SELECT 1 FROM journal_entries x WHERE x.tenant_id=i.tenant_id AND x.facility_id=i.facility_id AND x.source_type='BILLING_ITEM' AND x.source_id=b.id::text))
       UNION ALL
       SELECT 'BILLING_INVOICE',i.id,i.id,i.total_amount::text,false
       FROM billing_invoices i JOIN billing_invoice_finalizations f ON f.invoice_id=i.id
         AND f.tenant_id=i.tenant_id AND f.facility_id=i.facility_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.id=ANY($3::int[])
       UNION ALL
       SELECT 'BILLING_PAYMENT',p.id,p.invoice_id,p.amount::text,
         EXISTS(SELECT 1 FROM insurance_claims c WHERE c.settled_payment_id=p.id)
         OR EXISTS(SELECT 1 FROM insurance_reconciliation_entries c WHERE c.posted_payment_id=p.id)
         OR EXISTS(SELECT 1 FROM private_insurance_remittance_allocations c WHERE c.posted_payment_id=p.id)
         OR EXISTS(SELECT 1 FROM sha_eclaims c WHERE c.settled_payment_id=p.id)
         OR EXISTS(SELECT 1 FROM private_insurance_claims c WHERE c.settled_payment_id=p.id)
       FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.id=ANY($3::int[])
       UNION ALL
       SELECT 'BILLING_REFUND',r.id,r.invoice_id,r.amount::text,false
       FROM billing_refunds r JOIN billing_invoices i ON i.id=r.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND r.tenant_id=$1 AND r.facility_id=$2 AND i.id=ANY($3::int[])
       UNION ALL
       SELECT 'BILLING_VOID',i.id,i.id,i.total_amount::text,false
       FROM billing_invoices i WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.id=ANY($3::int[]) AND (i.status='Void' OR i.voided_at IS NOT NULL)
     )
     SELECT s.source_type AS "sourceType",s.source_id AS "sourceId",s.invoice_id AS "invoiceId",s.amount,s.payer_linked AS "payerLinked",
       j.count AS "journalCount", j.ids AS "journalIds",j.debit,j.credit,j.lines_debit AS "linesDebit",j.lines_credit AS "linesCredit",j.non_posted AS "nonPosted",j.reversed
     FROM sources s
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS count,array_agg(e.id ORDER BY e.id) AS ids,
         COALESCE(sum(e.total_debit_cents),0)::text AS debit, COALESCE(sum(e.total_credit_cents),0)::text AS credit,
         COALESCE(sum((SELECT COALESCE(sum(l.debit_cents),0) FROM journal_lines l WHERE l.journal_entry_id=e.id)),0)::text AS lines_debit,
         COALESCE(sum((SELECT COALESCE(sum(l.credit_cents),0) FROM journal_lines l WHERE l.journal_entry_id=e.id)),0)::text AS lines_credit,
         count(*) FILTER (WHERE e.status <> 'POSTED')::int AS non_posted,
         count(*) FILTER (WHERE e.reversal_of_journal_id IS NOT NULL OR e.reversed_by_journal_id IS NOT NULL OR EXISTS (SELECT 1 FROM journal_entries re WHERE re.reversal_of_journal_id=e.id))::int AS reversed
       FROM journal_entries e WHERE e.tenant_id=$1 AND e.facility_id=$2 AND e.source_type=s.source_type AND e.source_id=s.source_id::text
     ) j ORDER BY s.invoice_id,s.source_type,s.source_id`,
      [scope.tenantId, scope.facilityId, invoiceIds],
    );
    const sourceEvents = rows.map((row) => {
      const issues: string[] = [];
      let amount: bigint | null = null;
      try {
        amount = parseKesToCents(row.amount);
        if (amount <= 0n) amount = null;
      } catch {
        /* surfaced below, never interpreted as zero */
      }
      if (amount === null) issues.push('INVALID_SOURCE_AMOUNT');
      if (row.journalCount === 0) issues.push('UNPOSTED');
      if (row.journalCount > 1) issues.push('MULTIPLE_JOURNALS_REVIEW');
      if (row.nonPosted > 0) issues.push('JOURNAL_NOT_POSTED');
      if (row.reversed > 0) issues.push('REVERSAL_REQUIRES_REVIEW');
      if (
        row.journalCount &&
        amount !== null &&
        (BigInt(row.debit) !== amount || BigInt(row.credit) !== amount)
      )
        issues.push('JOURNAL_AMOUNT_MISMATCH');
      if (
        row.journalCount &&
        (row.debit !== row.linesDebit ||
          row.credit !== row.linesCredit ||
          row.linesDebit !== row.linesCredit)
      )
        issues.push('JOURNAL_LINES_MISMATCH');
      return {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        invoiceId: row.invoiceId,
        amount: row.amount,
        payerLinked: row.payerLinked,
        journalIds: row.journalIds ?? [],
        issues,
        assessment: issues.length ? 'REVIEW' : 'AMOUNT_MATCH_ONLY',
      };
    });
    return {
      ...consistency,
      sourceEvents,
      ledgerPageSummary: {
        examined: sourceEvents.length,
        unposted: sourceEvents.filter((e) => e.issues.includes('UNPOSTED')).length,
        requiringReview: sourceEvents.filter((e) => e.issues.length).length,
      },
      limitations: {
        ledgerReconciliation: 'PARTIAL',
        notice:
          'Checks finalized invoice or line-level source links, receipts, refunds and voids on the selected invoice page using one database snapshot. An amount match does not verify the accounts, recognition, opening balances or a transfer. Existing unlinked manual journals, other sources, payer allocations and bank statements are not fully reconciled; automatic posting is not implemented.',
      },
    };
  });
}
