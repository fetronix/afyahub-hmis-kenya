/**
 * JaliCare HMIS
 * Queries: Invoices, payments, insurance claims, and invoice detail
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { InpatientDomainError } from '../inpatient-contracts.ts';

import { requireTenantScope, requireFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { parseMoneyToCents } from '../../billing/settlement.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.billing');

// Finance & Billing
export async function getInvoices(facilityId?: number, patientId?: number) {
  try {
    const query = db.select().from(schema.billingInvoices);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.billingInvoices.facilityId, facilityId));
    if (patientId) conditions.push(eq(schema.billingInvoices.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.billingInvoices.createdAt));
    }
    return await query.orderBy(desc(schema.billingInvoices.createdAt));
  } catch (error) {
    log.error({ err: error }, 'invoices.fetch_failed');
    throw new Error('Failed to fetch billing invoices', { cause: error });
  }
}

export async function createInvoice(
  invoiceData: typeof schema.billingInvoices.$inferInsert,
  items: Array<Omit<typeof schema.billingItems.$inferInsert, 'invoiceId'>>,
) {
  try {
    return await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(schema.billingInvoices).values(invoiceData).returning();

      if (!invoice) {
        throw new Error('Invoice insert returned no record');
      }

      if (items.length > 0) {
        const itemsToInsert = items.map((item) => ({
          ...item,
          invoiceId: invoice.id,
        }));

        await tx.insert(schema.billingItems).values(itemsToInsert);
      }

      return invoice;
    });
  } catch (error) {
    log.error({ err: error }, 'invoice.create_failed');
    throw new Error('Failed to create patient invoice', { cause: error });
  }
}
export async function getInvoiceItems(invoiceId: number) {
  try {
    return await db
      .select()
      .from(schema.billingItems)
      .where(eq(schema.billingItems.invoiceId, invoiceId));
  } catch (error) {
    log.error({ err: error }, 'invoice_items.fetch_failed');
    throw new Error('Failed to fetch invoice line items', { cause: error });
  }
}

/**
 * Legacy unscoped helper: no authenticated actor is available for an audit.
 * HTTP callers must use recordSettledPayment instead. Retained for existing
 * internal compatibility until a reviewed migration can remove it.
 */
export async function recordPayment(paymentData: typeof schema.billingPayments.$inferInsert) {
  try {
    return await db.transaction(async (tx) => {
      // Lock the invoice so simultaneous payments cannot both spend
      // the same outstanding balance.
      const [invoice] = await tx
        .select()
        .from(schema.billingInvoices)
        .where(eq(schema.billingInvoices.id, paymentData.invoiceId))
        .for('update');

      if (!invoice) {
        throw new Error('INVOICE_NOT_FOUND');
      }
      if (invoice.status === 'Void' || invoice.voidedAt) {
        throw new Error('INVOICE_VOIDED');
      }

      const amountCents = parseMoneyToCents(paymentData.amount);
      const balanceCents = parseMoneyToCents(invoice.balanceAmount);
      const totalCents = parseMoneyToCents(invoice.totalAmount);
      const paidCents = parseMoneyToCents(invoice.paidAmount);
      const creditCents = parseMoneyToCents(invoice.creditBalance);

      if (amountCents === null || amountCents <= 0) {
        throw new Error('INVALID_PAYMENT_AMOUNT');
      }
      if (
        balanceCents === null ||
        totalCents === null ||
        paidCents === null ||
        creditCents === null ||
        balanceCents < 0 ||
        totalCents < 0 ||
        paidCents < 0 ||
        creditCents < 0 ||
        balanceCents !== Math.max(0, totalCents - paidCents) ||
        creditCents !== Math.max(0, paidCents - totalCents)
      ) {
        throw new Error('INVOICE_RECONCILIATION_REQUIRED');
      }
      const ledger = await tx
        .select({ amount: schema.billingPayments.amount })
        .from(schema.billingPayments)
        .where(eq(schema.billingPayments.invoiceId, invoice.id));
      let ledgerCents = 0;
      for (const entry of ledger) {
        const cents = parseMoneyToCents(entry.amount);
        if (cents === null || cents <= 0 || !Number.isSafeInteger(ledgerCents + cents)) {
          throw new Error('INVOICE_RECONCILIATION_REQUIRED');
        }
        ledgerCents += cents;
      }
      if (ledgerCents !== paidCents) throw new Error('INVOICE_RECONCILIATION_REQUIRED');

      if (amountCents > balanceCents) {
        throw new Error('PAYMENT_EXCEEDS_BALANCE');
      }

      const newPaidCents = paidCents + amountCents;
      const newBalanceCents = Math.max(0, totalCents - newPaidCents);
      const newStatus =
        newBalanceCents === 0 ? 'Paid' : newPaidCents > 0 ? 'Partially Paid' : 'Unpaid';

      // Both writes are part of the same transaction. If either fails,
      // PostgreSQL rolls back both.
      const [payment] = await tx.insert(schema.billingPayments).values(paymentData).returning();

      if (!payment) {
        throw new Error('Payment insert returned no record');
      }

      await tx
        .update(schema.billingInvoices)
        .set({
          paidAmount: (newPaidCents / 100).toFixed(2),
          balanceAmount: (newBalanceCents / 100).toFixed(2),
          status: newStatus,
        })
        .where(eq(schema.billingInvoices.id, invoice.id));

      return payment;
    });
  } catch (error) {
    // Database error text may include payment parameters; retain the cause
    // for local handling without writing it or its values to application logs.
    log.error('payment.record_failed');
    throw new Error('Failed to record patient payment', { cause: error });
  }
}
// Insurance Claims
export async function getClaims(facilityId?: number) {
  try {
    if (facilityId) {
      return await db
        .select()
        .from(schema.insuranceClaims)
        .where(eq(schema.insuranceClaims.facilityId, facilityId))
        .orderBy(desc(schema.insuranceClaims.claimNumber));
    }
    return await db
      .select()
      .from(schema.insuranceClaims)
      .orderBy(desc(schema.insuranceClaims.claimNumber));
  } catch (error) {
    log.error({ err: error }, 'insurance_claims.fetch_failed');
    throw new Error('Failed to fetch claims', { cause: error });
  }
}

export async function createClaim(data: typeof schema.insuranceClaims.$inferInsert) {
  try {
    const res = await db.insert(schema.insuranceClaims).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'insurance_claim.create_failed');
    throw new Error('Failed to submit insurance claim', { cause: error });
  }
}

export async function updateClaimStatus(
  id: number,
  status: string,
  approvedAmount?: string,
  notes?: string,
) {
  try {
    const updateData: any = { status };
    if (approvedAmount !== undefined) updateData.approvedAmount = approvedAmount;
    if (notes !== undefined) updateData.adjudicationNotes = notes;
    const res = await db
      .update(schema.insuranceClaims)
      .set(updateData)
      .where(eq(schema.insuranceClaims.id, id))
      .returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'claim_status.update_failed');
    throw new Error('Failed to update claim adjudication status', { cause: error });
  }
}

/* ------------------------------------------------------------
   INVOICE LIFECYCLE
   ------------------------------------------------------------ */

export async function getInvoiceDetailScoped(context: AuthorizationContext, invoiceId: number) {
  const id = Number(invoiceId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid invoice ID is required.', 400);
  }

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, id))
    .limit(1);

  if (!invoice) return null;

  requireTenantScope(context, invoice.tenantId);
  requireFacilityScope(context, invoice.tenantId, invoice.facilityId);

  const items = await db
    .select()
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, invoice.id));

  const payments = await db
    .select()
    .from(schema.billingPayments)
    .where(eq(schema.billingPayments.invoiceId, invoice.id))
    .orderBy(desc(schema.billingPayments.createdAt));

  return { invoice, items, payments };
}

/**
 * Void an invoice.
 *
 * Voiding is additive: the invoice and its lines are retained for audit,
 * and `voided_at` removes it from open-invoice lookups so new charges
 * open a fresh bill. A voided invoice cannot be voided twice.
 */
export async function voidInvoiceScoped(
  context: AuthorizationContext,
  invoiceId: number,
  reason: string,
) {
  const id = Number(invoiceId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid invoice ID is required.', 400);
  }
  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid void reason is required.', 400);
  }

  return db.transaction(async (tx) => {
    // The payment service locks this same row, so a concurrent payment and
    // void cannot both succeed based on an old unpaid snapshot.
    const [invoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, id))
      .limit(1)
      .for('update');
    if (!invoice) throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Invoice not found.', 404);
    requireTenantScope(context, invoice.tenantId);
    requireFacilityScope(context, invoice.tenantId, invoice.facilityId);
    if (invoice.voidedAt || invoice.status === 'Void')
      throw new InpatientDomainError(
        'ADMISSION_ALREADY_CLOSED',
        'This invoice has already been voided.',
        409,
      );

    const paid = parseMoneyToCents(invoice.paidAmount);
    const credit = parseMoneyToCents(invoice.creditBalance);
    const total = parseMoneyToCents(invoice.totalAmount);
    const balance = parseMoneyToCents(invoice.balanceAmount);
    if (
      paid === null ||
      credit === null ||
      total === null ||
      balance === null ||
      total < 0 ||
      balance !== total ||
      paid !== 0 ||
      credit !== 0 ||
      ['Paid', 'Partially Paid', 'Overpaid'].includes(invoice.status ?? '')
    )
      throw new InpatientDomainError(
        'ADMISSION_ALREADY_CLOSED',
        'The invoice has a payment, credit, or inconsistent balance and requires authorized review before voiding.',
        409,
      );
    // Be conservative if a legacy payment exists even when the stored total is wrong.
    const [payment] = await tx
      .select({ id: schema.billingPayments.id })
      .from(schema.billingPayments)
      .where(eq(schema.billingPayments.invoiceId, invoice.id))
      .limit(1);
    if (payment)
      throw new InpatientDomainError(
        'ADMISSION_ALREADY_CLOSED',
        'The invoice has a recorded payment and requires authorized review before voiding.',
        409,
      );

    const [updated] = await tx
      .update(schema.billingInvoices)
      .set({
        status: 'Void',
        voidedAt: new Date(),
        voidReason: normalizedReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.billingInvoices.id, invoice.id))
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: invoice.tenantId,
      facilityId: invoice.facilityId,
      userId: String(context.userId),
      action: 'UPDATE',
      resource: 'Invoice',
      resourceId: String(invoice.id),
      details: 'Invoice voided; reason retained on invoice.',
    });
    return updated;
  });
}
