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

import { toCentsPositive } from './shared.ts';

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

      const amountCents = Math.round(Number(paymentData.amount) * 100);
      const balanceCents = Math.round(Number(invoice.balanceAmount ?? 0) * 100);
      const totalCents = Math.round(Number(invoice.totalAmount ?? 0) * 100);
      const paidCents = Math.round(Number(invoice.paidAmount ?? 0) * 100);

      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new Error('INVALID_PAYMENT_AMOUNT');
      }

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
    log.error({ err: error }, 'payment.record_failed');
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
  const detail = await getInvoiceDetailScoped(context, invoiceId);

  if (!detail) {
    throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Invoice not found.', 404);
  }

  if (detail.invoice.voidedAt) {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'This invoice has already been voided.',
      409,
    );
  }

  if (toCentsPositive(detail.invoice.paidAmount) > 0) {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'A paid invoice cannot be voided. Reverse the payment first.',
      409,
    );
  }

  const [updated] = await db
    .update(schema.billingInvoices)
    .set({
      status: 'Void',
      voidedAt: new Date(),
      voidReason: reason.trim().slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(schema.billingInvoices.id, detail.invoice.id))
    .returning();

  return updated;
}
