/**
 * Immutable manual refund receipts, not a payment-provider integration.
 * The actor attests that the return of funds was performed outside JaliCare.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';
import { PaymentDomainError } from './payments.service.ts';
import { readInvoicePaymentLedger } from './payment-ledger.ts';
import { formatCents, parseMoneyToCents } from './settlement.ts';

const REFUND_METHODS = new Set(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CHEQUE']);
const PATIENT_RECEIPT_METHODS = new Set(['cash', 'm-pesa', 'airtel money', 'card', 'cheque']);

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requireRefundPermission(context: AuthorizationContext) {
  // Global platform administration is not facility financial authority.
  if (
    context.isSuperAdmin ||
    !context.permissions.includes('billing.read') ||
    !context.permissions.includes('billing.refunds.record')
  ) {
    throw new PaymentDomainError(
      'REFUND_FORBIDDEN',
      'Facility billing and refund permissions are required.',
      403,
    );
  }
}

function keyValue(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new PaymentDomainError('INVALID_INPUT', 'A valid retry identity is required.', 400);
  }
  return key;
}

async function facilityForRefund(context: AuthorizationContext, value: unknown) {
  requireRefundPermission(context);
  const requested =
    value === undefined || value === null || value === '' ? null : positiveId(value);
  if (value !== undefined && value !== null && value !== '' && requested === null) {
    throw new PaymentDomainError('INVALID_INPUT', 'A valid facility is required.', 400);
  }
  const facilityId = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new PaymentDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
    throw new PaymentDomainError('FACILITY_MODULE_DISABLED', 'Finance is disabled.', 403);
  }
  return facility;
}

export interface RecordRefundInput {
  facilityId?: unknown;
  invoiceId: unknown;
  paymentId: unknown;
  amount: unknown;
  refundMethod: unknown;
  externalReference?: unknown;
  reason: unknown;
  manualConfirmation: unknown;
  idempotencyKey: unknown;
}

export async function recordManualRefund(context: AuthorizationContext, input: RecordRefundInput) {
  const invoiceId = positiveId(input?.invoiceId);
  const paymentId = positiveId(input?.paymentId);
  const amount =
    typeof input?.amount === 'string' || typeof input?.amount === 'number'
      ? parseMoneyToCents(input.amount)
      : null;
  const method =
    typeof input?.refundMethod === 'string' ? input.refundMethod.trim().toUpperCase() : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  const reference =
    input?.externalReference === undefined || input.externalReference === null
      ? null
      : typeof input.externalReference === 'string'
        ? input.externalReference.trim() || null
        : undefined;
  const key = keyValue(input?.idempotencyKey);
  if (
    !invoiceId ||
    !paymentId ||
    amount === null ||
    amount <= 0 ||
    !REFUND_METHODS.has(method) ||
    reason.length < 3 ||
    reason.length > 500 ||
    reference === undefined ||
    (reference !== null && reference.length > 100) ||
    (method !== 'CASH' && (!reference || reference.length < 3)) ||
    input?.manualConfirmation !== true
  ) {
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A receipt, positive amount, method, reason and manual confirmation are required. Non-cash refunds need an external reference.',
      400,
    );
  }
  const facility = await facilityForRefund(context, input.facilityId);
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ invoiceId, paymentId, amount, method, reference, reason }))
    .digest('hex');

  return db.transaction(async (tx) => {
    // Retry identity is locked before the invoice, including retries which
    // accidentally target a different invoice in the same facility.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${facility.id}))`);
    const [prior] = await tx
      .select()
      .from(schema.billingRefunds)
      .where(
        and(
          eq(schema.billingRefunds.tenantId, facility.tenantId),
          eq(schema.billingRefunds.facilityId, facility.id),
          eq(schema.billingRefunds.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw new PaymentDomainError(
          'REFUND_IDEMPOTENCY_CONFLICT',
          'This retry identity belongs to a different refund.',
          409,
        );
      }
      return { refund: publicRefund(prior), replayed: true, accounting: 'NOT_POSTED' as const };
    }
    const [invoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(
        and(
          eq(schema.billingInvoices.id, invoiceId),
          eq(schema.billingInvoices.tenantId, facility.tenantId),
          eq(schema.billingInvoices.facilityId, facility.id),
        ),
      )
      .for('update');
    if (!invoice) throw new PaymentDomainError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    if (invoice.status === 'Void' || invoice.voidedAt) {
      throw new PaymentDomainError('INVOICE_VOIDED', 'A voided invoice cannot be refunded.', 409);
    }
    const [payment] = await tx
      .select()
      .from(schema.billingPayments)
      .where(
        and(
          eq(schema.billingPayments.id, paymentId),
          eq(schema.billingPayments.invoiceId, invoice.id),
        ),
      )
      .for('update');
    if (!payment) throw new PaymentDomainError('PAYMENT_NOT_FOUND', 'Receipt not found.', 404);
    if (!PATIENT_RECEIPT_METHODS.has((payment.paymentMethod ?? '').trim().toLowerCase())) {
      throw new PaymentDomainError(
        'PAYER_REFUND_REVIEW_REQUIRED',
        'This receipt requires payer or other authorized reversal review.',
        409,
      );
    }
    // Matching uses this same payment lock. A refund and a claim allocation
    // cannot both succeed based on an earlier unallocated snapshot.
    const linked = await tx.execute(sql`SELECT (
      EXISTS(SELECT 1 FROM insurance_claims WHERE settled_payment_id=${paymentId}) OR
      EXISTS(SELECT 1 FROM insurance_reconciliation_entries WHERE posted_payment_id=${paymentId}) OR
      EXISTS(SELECT 1 FROM private_insurance_remittance_allocations WHERE posted_payment_id=${paymentId}) OR
      EXISTS(SELECT 1 FROM sha_eclaims WHERE settled_payment_id=${paymentId}) OR
      EXISTS(SELECT 1 FROM private_insurance_claims WHERE settled_payment_id=${paymentId})
    ) AS linked`);
    if ((linked as unknown as { rows: Array<{ linked: boolean }> }).rows[0]?.linked) {
      throw new PaymentDomainError(
        'PAYER_REFUND_REVIEW_REQUIRED',
        'A payer-linked receipt requires authorized payer reversal review.',
        409,
      );
    }
    const total = parseMoneyToCents(invoice.totalAmount);
    const paid = parseMoneyToCents(invoice.paidAmount);
    const balance = parseMoneyToCents(invoice.balanceAmount);
    const credit = parseMoneyToCents(invoice.creditBalance);
    const ledger = await readInvoicePaymentLedger(tx, invoice.id);
    if (
      total === null ||
      paid === null ||
      balance === null ||
      credit === null ||
      total < 0 ||
      paid < 0 ||
      balance < 0 ||
      credit < 0 ||
      balance !== Math.max(0, total - paid) ||
      credit !== Math.max(0, paid - total) ||
      !ledger ||
      ledger.netCents !== paid
    ) {
      throw new PaymentDomainError(
        'INVOICE_RECONCILIATION_REQUIRED',
        'Invoice, receipts and refunds require authorized review before refunding.',
        409,
      );
    }
    const receipt = ledger.byPayment.get(payment.id);
    if (!receipt || amount > receipt.grossCents - receipt.refundedCents || amount > paid) {
      throw new PaymentDomainError(
        'REFUND_EXCEEDS_RECEIPT',
        'Refund exceeds the unreversed amount on this receipt.',
        409,
      );
    }
    const sequence = await tx.execute(
      sql`SELECT nextval('billing_refund_receipt_seq')::text AS value`,
    );
    const sequenceValue = (sequence as unknown as { rows: Array<{ value: string }> }).rows[0]
      ?.value;
    if (!sequenceValue || !/^\d+$/.test(sequenceValue))
      throw new Error('Refund sequence unavailable');
    const refundNumber = `REF-${sequenceValue.padStart(10, '0')}`;
    const [refund] = await tx
      .insert(schema.billingRefunds)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        invoiceId,
        paymentId,
        refundNumber,
        amount: formatCents(amount),
        refundMethod: method,
        externalReference: reference,
        reason,
        manualConfirmation: true,
        idempotencyKey: key,
        requestHash,
        actorUserId: context.userId,
      })
      .returning();
    if (!refund) throw new Error('Refund receipt insert returned no record');
    const paidAfter = paid - amount;
    const status =
      paidAfter > total
        ? 'Overpaid'
        : total > 0 && paidAfter === total
          ? 'Paid'
          : paidAfter > 0
            ? 'Partially Paid'
            : 'Unpaid';
    await tx
      .update(schema.billingInvoices)
      .set({
        paidAmount: formatCents(paidAfter),
        balanceAmount: formatCents(Math.max(0, total - paidAfter)),
        creditBalance: formatCents(Math.max(0, paidAfter - total)),
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.billingInvoices.id, invoice.id));
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(context.userId),
      action: 'CREATE',
      resource: 'RefundReceipt',
      resourceId: String(refund.id),
      details: JSON.stringify({
        invoiceId,
        paymentId,
        refundNumber,
        amount: formatCents(amount),
        method,
        manual: true,
      }),
    });
    return { refund: publicRefund(refund), replayed: false, accounting: 'NOT_POSTED' as const };
  });
}

function publicRefund(refund: typeof schema.billingRefunds.$inferSelect) {
  return {
    id: refund.id,
    invoiceId: refund.invoiceId,
    paymentId: refund.paymentId,
    refundNumber: refund.refundNumber,
    amount: refund.amount,
    refundMethod: refund.refundMethod,
    externalReference: refund.externalReference,
    reason: refund.reason,
    actorUserId: refund.actorUserId,
    createdAt: refund.createdAt,
    status: 'MANUALLY_RECORDED' as const,
  };
}

/** A not-found answer cannot rule out a delayed request still arriving. */
export async function checkRefundStatus(
  context: AuthorizationContext,
  input: { facilityId?: unknown; idempotencyKey: unknown },
) {
  const key = keyValue(input?.idempotencyKey);
  const facility = await facilityForRefund(context, input?.facilityId);
  const [refund] = await db
    .select()
    .from(schema.billingRefunds)
    .where(
      and(
        eq(schema.billingRefunds.tenantId, facility.tenantId),
        eq(schema.billingRefunds.facilityId, facility.id),
        eq(schema.billingRefunds.idempotencyKey, key),
      ),
    )
    .limit(1);
  return refund
    ? {
        status: 'RECORDED' as const,
        refund: publicRefund(refund),
        accounting: 'NOT_POSTED' as const,
      }
    : { status: 'NOT_FOUND' as const };
}
