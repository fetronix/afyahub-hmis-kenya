import { eq } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { parseMoneyToCents } from './settlement.ts';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Receipt totals are gross receipts less immutable refund receipts. Missing,
 * malformed, foreign or over-refunded entries are never treated as zero.
 * The caller must lock the invoice before using the result to change money.
 */
export async function readInvoicePaymentLedger(executor: Executor, invoiceId: number) {
  const payments = await executor
    .select({ id: schema.billingPayments.id, amount: schema.billingPayments.amount })
    .from(schema.billingPayments)
    .where(eq(schema.billingPayments.invoiceId, invoiceId));
  const refunds = await executor
    .select({ paymentId: schema.billingRefunds.paymentId, amount: schema.billingRefunds.amount })
    .from(schema.billingRefunds)
    .where(eq(schema.billingRefunds.invoiceId, invoiceId));
  const byPayment = new Map<number, { grossCents: number; refundedCents: number }>();
  let grossCents = 0;
  let refundedCents = 0;
  for (const payment of payments) {
    const amount = parseMoneyToCents(payment.amount);
    if (amount === null || amount <= 0 || !Number.isSafeInteger(grossCents + amount)) return null;
    grossCents += amount;
    byPayment.set(payment.id, { grossCents: amount, refundedCents: 0 });
  }
  for (const refund of refunds) {
    const amount = parseMoneyToCents(refund.amount);
    const original = byPayment.get(refund.paymentId);
    if (
      !original ||
      amount === null ||
      amount <= 0 ||
      !Number.isSafeInteger(refundedCents + amount) ||
      !Number.isSafeInteger(original.refundedCents + amount)
    )
      return null;
    original.refundedCents += amount;
    refundedCents += amount;
    if (original.refundedCents > original.grossCents) return null;
  }
  if (refundedCents > grossCents) return null;
  return { grossCents, refundedCents, netCents: grossCents - refundedCents, byPayment };
}
