/**
 * JaliCare HMIS — the invoice gate every insurance claim must pass.
 *
 * WHY THIS EXISTS
 * A claim is a statement to a payer about money the facility says it is owed.
 * Up to this point an insurance claim could be prepared from *any* invoice the
 * facility owned — including a draft whose line items were still being added,
 * and including an invoice that had since been voided. That made the claim a
 * moving target: the payer could adjudicate against a total the facility had
 * already changed, and no historical record existed of which version of the
 * invoice was claimed.
 *
 * Invoice finalization (migration 0037, `billing-invoice.finalized-invoice`)
 * already freezes the invoice, its lines, the responsibility split and a
 * historical snapshot. This module makes claim preparation read *that*
 * frozen record, and copies it onto the claim, so:
 *
 *   - a draft, voided or under-finalized invoice can never be claimed;
 *   - the claim carries the exact invoice state it was built from;
 *   - a later credit note, void or re-finalization cannot silently rewrite
 *     what was already submitted to a payer.
 *
 * It deliberately does NOT decide approval, adjudication or payment. It answers
 * one question: "is this invoice, right now, a legitimate basis for a claim?"
 */

import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import type { InvoiceSnapshot } from '../../billing/finalized-invoice.types.ts';

/** Each caller already has a domain error class; the gate uses theirs. */
export type ClaimInvoiceErrorFactory = (code: string, message: string, status: number) => Error;

export interface ClaimableInvoiceRow {
  id: number;
  invoiceNumber: string;
  status: string | null;
  finalizedAt: Date | null;
  voidedAt: Date | null;
}

export interface ClaimInvoiceFacts {
  invoiceFinalizedAt: Date;
  /** The frozen snapshot recorded at finalization; never re-derived later. */
  snapshot: InvoiceSnapshot;
}

/**
 * The pure decision. Kept separate from the query so it can be tested without a
 * database, and so every caller applies exactly the same rules in the same
 * order (void beats "not finalized": a voided invoice is not a draft, it is
 * cancelled, and the message has to say so).
 */
export function assertInvoiceClaimable(
  invoice: ClaimableInvoiceRow,
  makeError: ClaimInvoiceErrorFactory,
): void {
  if (invoice.voidedAt !== null || invoice.status === 'Void') {
    throw makeError(
      'INVOICE_VOIDED',
      `Invoice ${invoice.invoiceNumber} has been voided and cannot support a claim.`,
      409,
    );
  }

  if (invoice.finalizedAt === null) {
    throw makeError(
      'INVOICE_NOT_FINALIZED',
      `Invoice ${invoice.invoiceNumber} is not finalized. Finalize the invoice before preparing a claim, so the payer is billed against a fixed set of lines.`,
      409,
    );
  }
}

/**
 * Load the finalization record that belongs to this invoice **and** this
 * tenant/facility. Asking for all three is not redundant: it is the same guard
 * that stops a claim in facility A from citing facility B's invoice if an id is
 * ever passed through from a request body.
 */
export async function loadClaimInvoiceFacts(input: {
  tenantId: number;
  facilityId: number;
  invoice: ClaimableInvoiceRow;
  makeError: ClaimInvoiceErrorFactory;
}): Promise<ClaimInvoiceFacts> {
  assertInvoiceClaimable(input.invoice, input.makeError);

  const [finalization] = await db
    .select({
      finalizedAt: schema.billingInvoiceFinalizations.finalizedAt,
      snapshot: schema.billingInvoiceFinalizations.snapshot,
    })
    .from(schema.billingInvoiceFinalizations)
    .where(
      and(
        eq(schema.billingInvoiceFinalizations.invoiceId, input.invoice.id),
        eq(schema.billingInvoiceFinalizations.tenantId, input.tenantId),
        eq(schema.billingInvoiceFinalizations.facilityId, input.facilityId),
      ),
    )
    .limit(1);

  if (!finalization) {
    /*
     * `billing_invoices.finalized_at` and the finalization row are written in
     * one transaction, so this should be unreachable. If it is reached, the
     * invoice claims to be frozen but its snapshot is gone — exactly the case
     * where preparing a claim would be guesswork. Refuse rather than fall back
     * to reading live rows.
     */
    throw input.makeError(
      'INVOICE_FINALIZATION_MISSING',
      `Invoice ${input.invoice.invoiceNumber} is marked finalized but has no finalization record. This needs investigation before it can be claimed.`,
      409,
    );
  }

  return {
    invoiceFinalizedAt: finalization.finalizedAt,
    snapshot: finalization.snapshot,
  };
}

/**
 * Second line of defence, used when a claim that was already prepared is about
 * to be sent. The invoice may have been voided between preparation and dispatch,
 * and a void is a fact about the money that the payer must not be told
 * otherwise about.
 */
export async function assertClaimInvoiceStillValid(input: {
  tenantId: number;
  facilityId: number;
  invoiceId: number;
  makeError: ClaimInvoiceErrorFactory;
}): Promise<void> {
  const [invoice] = await db
    .select({
      id: schema.billingInvoices.id,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      status: schema.billingInvoices.status,
      finalizedAt: schema.billingInvoices.finalizedAt,
      voidedAt: schema.billingInvoices.voidedAt,
    })
    .from(schema.billingInvoices)
    .where(
      and(
        eq(schema.billingInvoices.id, input.invoiceId),
        eq(schema.billingInvoices.tenantId, input.tenantId),
        eq(schema.billingInvoices.facilityId, input.facilityId),
      ),
    )
    .limit(1);

  if (!invoice) {
    throw input.makeError(
      'INVOICE_NOT_FOUND',
      'The invoice this claim was prepared from no longer exists in this facility.',
      409,
    );
  }

  assertInvoiceClaimable(invoice, input.makeError);
}
