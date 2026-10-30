import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { parseMoneyToCents } from '../../billing/settlement.ts';

export class RecordedPaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecordedPaymentError';
  }
}
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Match a previously posted, facility-scoped insurance receipt. This never
 * creates a receipt, changes an invoice, or claims to verify a bank payment.
 * Row locking prevents the same receipt being allocated twice concurrently.
 */
export async function matchRecordedPayerPayment(
  tx: Transaction,
  input: {
    paymentId: unknown;
    invoiceId: number;
    payerCode: string;
    remittanceReference: string;
    bankReference: string | null;
    amountCents: number;
  },
) {
  const paymentId = Number(input.paymentId);
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0)
    throw new RecordedPaymentError(
      'INVALID_PAYMENT_ID',
      'Select a valid existing billing receipt.',
    );
  const [payment] = await tx
    .select()
    .from(schema.billingPayments)
    .where(
      and(
        eq(schema.billingPayments.id, paymentId),
        eq(schema.billingPayments.invoiceId, input.invoiceId),
      ),
    )
    .for('update');
  if (!payment)
    throw new RecordedPaymentError('PAYMENT_NOT_FOUND', 'Receipt was not found for this invoice.');
  // Refunds and payer matching share the payment row lock. A receipt that
  // has been reversed, even partially, cannot be allocated as fully paid.
  const [refund] = await tx
    .select({ id: schema.billingRefunds.id })
    .from(schema.billingRefunds)
    .where(eq(schema.billingRefunds.paymentId, payment.id))
    .limit(1);
  if (refund)
    throw new RecordedPaymentError(
      'PAYMENT_REFUNDED',
      'A refunded receipt cannot be allocated to a payer claim.',
    );
  if (parseMoneyToCents(payment.amount) !== input.amountCents)
    throw new RecordedPaymentError(
      'PAYMENT_AMOUNT_MISMATCH',
      'Receipt amount must match this allocation.',
    );
  const method = (payment.paymentMethod ?? '').trim().toUpperCase();
  if (
    method !== input.payerCode.toUpperCase() &&
    method !== `INSURANCE - ${input.payerCode.toUpperCase()}`
  )
    throw new RecordedPaymentError(
      'PAYMENT_PAYER_MISMATCH',
      'Receipt must identify this insurer as the payment method.',
    );
  const expectedRefs = [input.remittanceReference, input.bankReference]
    .filter((v): v is string => Boolean(v?.trim()))
    .map((v) => v.trim().toUpperCase());
  const receiptRefs = [payment.referenceCode, payment.transactionCode]
    .filter((v): v is string => Boolean(v?.trim()))
    .map((v) => v.trim().toUpperCase());
  if (!receiptRefs.some((v) => expectedRefs.includes(v)))
    throw new RecordedPaymentError(
      'PAYMENT_REFERENCE_MISMATCH',
      'Receipt reference must match the remittance or bank reference.',
    );
  const [privateUse] = await tx
    .select({ id: schema.privateInsuranceRemittanceAllocations.id })
    .from(schema.privateInsuranceRemittanceAllocations)
    .where(eq(schema.privateInsuranceRemittanceAllocations.postedPaymentId, payment.id))
    .limit(1);
  const [shaUse] = await tx
    .select({ id: schema.insuranceReconciliationEntries.id })
    .from(schema.insuranceReconciliationEntries)
    .where(eq(schema.insuranceReconciliationEntries.postedPaymentId, payment.id))
    .limit(1);
  const [legacyUse] = await tx
    .select({ id: schema.insuranceClaims.id })
    .from(schema.insuranceClaims)
    .where(eq(schema.insuranceClaims.settledPaymentId, payment.id))
    .limit(1);
  const [shaClaimUse] = await tx
    .select({ id: schema.shaEclaims.id })
    .from(schema.shaEclaims)
    .where(eq(schema.shaEclaims.settledPaymentId, payment.id))
    .limit(1);
  const [privateClaimUse] = await tx
    .select({ id: schema.privateInsuranceClaims.id })
    .from(schema.privateInsuranceClaims)
    .where(eq(schema.privateInsuranceClaims.settledPaymentId, payment.id))
    .limit(1);
  if (privateUse || shaUse || legacyUse || shaClaimUse || privateClaimUse)
    throw new RecordedPaymentError(
      'PAYMENT_ALREADY_ALLOCATED',
      'This receipt is already allocated to an insurance claim.',
    );
  return payment;
}
