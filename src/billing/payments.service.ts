/**
 * JaliCare HMIS
 * Payment settlement service
 *
 * Posts money against an invoice and says what that money did:
 * cleared it, left a balance, or overpaid it.
 *
 * DESIGN RULES
 * ------------
 * 1. The invoice row is locked for the duration of the transaction, so
 *    two tills taking the last part of a balance cannot both succeed.
 * 2. A mobile money code may be posted once. The duplicate check is the
 *    database index, not a read-then-write dance in application code —
 *    two clerks typing the same M-Pesa message at the same second still
 *    end up with exactly one receipt.
 * 3. Overpayment is allowed and surfaced, never swallowed. The excess is
 *    written to `credit_balance`; `balance_amount` never goes negative.
 * 4. Receipt numbers are issued by a sequence, so they cannot collide
 *    and cannot be invented by the client.
 * 5. Money is integer cents throughout.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';

import {
  classifySettlement,
  formatCents,
  isMobileMoney,
  parseMoneyToCents,
  validateTransactionCode,
  type Settlement,
} from './settlement.ts';

export type PaymentErrorCode =
  | 'INVALID_INPUT'
  | 'INVOICE_NOT_FOUND'
  | 'FACILITY_NOT_FOUND'
  | 'FACILITY_MODULE_DISABLED'
  | 'INVOICE_VOIDED'
  | 'DUPLICATE_TRANSACTION_CODE'
  | 'PAYMENT_EXCEEDS_BALANCE';

export class PaymentDomainError extends Error {
  readonly code: PaymentErrorCode;
  readonly status: number;
  readonly detail: Record<string, unknown>;

  constructor(
    code: PaymentErrorCode,
    message: string,
    status: number,
    detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PaymentDomainError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export interface RecordPaymentInput {
  facilityId?: number | string | null;
  invoiceId: number | string;
  amount: number | string;
  paymentMethod: string;
  /** Code from the customer's M-Pesa / Airtel message. */
  transactionCode?: string | null;
  /** Accepted as an alias so older callers keep working. */
  referenceCode?: string | null;
  /** Charging a credit balance back is not a payment. Off by default. */
  allowOverpayment?: boolean | string | null;
}

export interface RecordPaymentResult {
  payment: typeof schema.billingPayments.$inferSelect;
  settlement: Settlement;
  invoice: {
    id: number;
    invoiceNumber: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    creditBalance: string;
    status: string;
  };
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Post a payment against an invoice.
 *
 * The caller must hold `billing.payments.record`.
 */
export async function recordSettledPayment(
  context: AuthorizationContext,
  input: RecordPaymentInput,
  cashierName: string,
): Promise<RecordPaymentResult> {
  const invoiceId = toPositiveInteger(input?.invoiceId);

  if (invoiceId === null) {
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A valid invoice is required.',
      400,
      { field: 'invoiceId' },
    );
  }

  const amountCents = parseMoneyToCents(input?.amount);

  if (amountCents === null || amountCents <= 0) {
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'The amount must be a positive number with at most two decimal places.',
      400,
      { field: 'amount' },
    );
  }

  const paymentMethod =
    typeof input?.paymentMethod === 'string'
      ? input.paymentMethod.trim()
      : '';

  if (!paymentMethod || paymentMethod.length > 40) {
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A payment method is required.',
      400,
      { field: 'paymentMethod' },
    );
  }

  const mobile = isMobileMoney(paymentMethod);
  const rawCode =
    typeof input?.transactionCode === 'string' && input.transactionCode.trim()
      ? input.transactionCode
      : input?.referenceCode;

  let transactionCode: string | null = null;

  if (mobile) {
    const check = validateTransactionCode(paymentMethod, rawCode);

    if (!check.valid) {
      throw new PaymentDomainError('INVALID_INPUT', check.reason ?? 'Invalid transaction code.', 400, {
        field: 'transactionCode',
      });
    }

    transactionCode = check.code;
  } else if (typeof rawCode === 'string' && rawCode.trim()) {
    /* Cash and card can carry a slip reference, but it is not a code we police. */
    transactionCode = rawCode.trim().slice(0, 100);
  }

  /* Resolve the facility and confirm the caller may touch it. */
  const requestedFacilityId =
    input?.facilityId === undefined || input?.facilityId === null || input?.facilityId === ''
      ? null
      : Number(input.facilityId);

  if (requestedFacilityId !== null && !Number.isSafeInteger(requestedFacilityId)) {
    throw new PaymentDomainError('INVALID_INPUT', 'The facility is not valid.', 400, {
      field: 'facilityId',
    });
  }

  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new PaymentDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  }

  if (
    !Array.isArray(facility.enabledModules) ||
    !facility.enabledModules.includes('finance')
  ) {
    throw new PaymentDomainError(
      'FACILITY_MODULE_DISABLED',
      'The finance module is disabled for this facility.',
      403,
      { module: 'finance' },
    );
  }

  const allowOverpayment = truthy(input?.allowOverpayment);

  try {
    return await db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(schema.billingInvoices)
        .where(
          and(
            eq(schema.billingInvoices.id, invoiceId),
            eq(schema.billingInvoices.facilityId, facilityId),
            eq(schema.billingInvoices.tenantId, facility.tenantId),
          ),
        )
        .for('update');

      if (!invoice) {
        throw new PaymentDomainError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
      }

      if (invoice.status === 'Void' || invoice.voidedAt) {
        throw new PaymentDomainError(
          'INVOICE_VOIDED',
          'This invoice has been voided and cannot take payments.',
          409,
          { invoiceNumber: invoice.invoiceNumber },
        );
      }

      if (transactionCode) {
        const [existing] = await tx
          .select({ id: schema.billingPayments.id })
          .from(schema.billingPayments)
          .where(eq(schema.billingPayments.transactionCode, transactionCode))
          .limit(1);

        if (existing) {
          throw new PaymentDomainError(
            'DUPLICATE_TRANSACTION_CODE',
            `Transaction code ${transactionCode} has already been receipted.`,
            409,
            { transactionCode, receiptId: existing.id },
          );
        }
      }

      const totalCents = parseMoneyToCents(invoice.totalAmount) ?? 0;
      const paidCents = parseMoneyToCents(invoice.paidAmount) ?? 0;

      const settlement = classifySettlement({
        invoiceTotalCents: totalCents,
        paidBeforeCents: paidCents,
        amountCents,
      });

      /*
       * Overpaying is a real event at a Kenyan counter: a patient rounds
       * up, or pays a deposit before the bill is final. It is accepted
       * only when explicitly allowed, so a mistyped extra zero is still
       * caught. The excess is recorded as credit, never as a negative
       * balance.
       */
      if (settlement.outcome === 'OVERPAID' && !allowOverpayment) {
        throw new PaymentDomainError(
          'PAYMENT_EXCEEDS_BALANCE',
          `This payment is KES ${formatCents(settlement.creditCents)} more than the outstanding balance. Confirm the overpayment to record it as credit.`,
          400,
          {
            outstandingCents: settlement.balanceBeforeCents,
            amountCents,
            excessCents: settlement.creditCents,
          },
        );
      }

      const receiptNumber = await nextReceiptNumber(tx);

      const [payment] = await tx
        .insert(schema.billingPayments)
        .values({
          invoiceId: invoice.id,
          receiptNumber,
          paymentMethod,
          amount: formatCents(amountCents),
          referenceCode: transactionCode,
          transactionCode,
          settlementStatus: settlement.outcome,
          cashierName: cashierName.slice(0, 150),
        })
        .returning();

      if (!payment) {
        throw new Error('Payment insert returned no record');
      }

      const [updatedInvoice] = await tx
        .update(schema.billingInvoices)
        .set({
          paidAmount: formatCents(settlement.paidAfterCents),
          balanceAmount: formatCents(settlement.balanceAfterCents),
          creditBalance: formatCents(settlement.creditCents),
          status: settlement.invoiceStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.billingInvoices.id, invoice.id))
        .returning();

      if (!updatedInvoice) {
        throw new Error('Invoice update returned no record');
      }

      return {
        payment,
        settlement,
        invoice: {
          id: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          totalAmount: String(updatedInvoice.totalAmount ?? '0.00'),
          paidAmount: String(updatedInvoice.paidAmount ?? '0.00'),
          balanceAmount: String(updatedInvoice.balanceAmount ?? '0.00'),
          creditBalance: String(updatedInvoice.creditBalance ?? '0.00'),
          status: String(updatedInvoice.status ?? 'Pending'),
        },
      };
    });
  } catch (error) {
    /*
     * The unique index is the real guard against a double-posted M-Pesa
     * code; the check above only exists to give a clean message when it
     * wins the race.
     */
    if (
      error instanceof Error &&
      /billing_payments_transaction_code_unique/i.test(error.message)
    ) {
      throw new PaymentDomainError(
        'DUPLICATE_TRANSACTION_CODE',
        `Transaction code ${transactionCode} has already been receipted.`,
        409,
        { transactionCode },
      );
    }

    throw error;
  }
}

type Executor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Receipt numbers come from a sequence so two tills cannot mint the same
 * number. The sequence is created by migration 0010.
 */
async function nextReceiptNumber(executor: Executor): Promise<string> {
  const result = await executor.execute(
    sql`SELECT nextval('billing_receipt_seq')::text AS value`,
  );

  /* node-postgres returns a QueryResult; the sequence value is in .rows. */
  const rows = (result as unknown as { rows?: Array<{ value?: string }> }).rows;
  const value = rows?.[0]?.value ?? '0';
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('');

  return `RCP-${stamp}-${value.padStart(6, '0')}`;
}

/* ============================================================
   RECONCILIATION
   ============================================================ */

export interface PaymentLedgerFilters {
  facilityId?: number | string | null;
  invoiceId?: number | string | null;
  method?: string | null;
  limit?: number | string | null;
}

/**
 * Payments received at a facility, newest first, for reconciling against
 * the M-Pesa statement at the end of a shift.
 */
export async function getPaymentLedgerScoped(
  context: AuthorizationContext,
  filters: PaymentLedgerFilters,
) {
  const requestedFacilityId =
    filters?.facilityId === undefined || filters?.facilityId === null || filters?.facilityId === ''
      ? null
      : Number(filters.facilityId);

  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new PaymentDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  }

  const invoiceId = filters?.invoiceId ? toPositiveInteger(filters.invoiceId) : null;
  const limitRaw = Number(filters?.limit ?? 200);
  const limit = Number.isSafeInteger(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 500)
    : 200;

  const method =
    typeof filters?.method === 'string' && filters.method.trim()
      ? filters.method.trim()
      : null;

  const conditions = [
    eq(schema.billingInvoices.facilityId, facilityId),
    eq(schema.billingInvoices.tenantId, facility.tenantId),
  ];

  if (invoiceId !== null) {
    conditions.push(eq(schema.billingPayments.invoiceId, invoiceId));
  }

  if (method) {
    conditions.push(eq(schema.billingPayments.paymentMethod, method));
  }

  return db
    .select({
      id: schema.billingPayments.id,
      invoiceId: schema.billingPayments.invoiceId,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      patientId: schema.billingInvoices.patientId,
      receiptNumber: schema.billingPayments.receiptNumber,
      paymentMethod: schema.billingPayments.paymentMethod,
      amount: schema.billingPayments.amount,
      transactionCode: schema.billingPayments.transactionCode,
      settlementStatus: schema.billingPayments.settlementStatus,
      cashierName: schema.billingPayments.cashierName,
      paymentDate: schema.billingPayments.paymentDate,
    })
    .from(schema.billingPayments)
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingPayments.invoiceId, schema.billingInvoices.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.billingPayments.paymentDate), desc(schema.billingPayments.id))
    .limit(limit);
}
