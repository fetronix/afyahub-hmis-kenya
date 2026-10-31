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

import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import { readInvoicePaymentLedger } from './payment-ledger.ts';
import { calculateInvoiceFinancialView } from './finalized-invoice.service.ts';
import type { PaymentParty } from './finalized-invoice.types.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { hasAllPermissions } from '../auth/authorization.service.ts';
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
  | 'INVOICE_RECONCILIATION_REQUIRED'
  | 'DUPLICATE_TRANSACTION_CODE'
  | 'PAYMENT_EXCEEDS_BALANCE'
  | 'PAYMENT_IDEMPOTENCY_REQUIRED'
  | 'PAYMENT_IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_REQUEST_CANCELLED'
  | 'PAYMENT_PARTY_REQUIRED'
  | 'PAYMENT_ATTRIBUTION_REQUIRED'
  | 'PAYMENT_EXCEEDS_PARTY_BALANCE'
  | 'REFUND_FORBIDDEN'
  | 'REFUND_IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYER_REFUND_REVIEW_REQUIRED'
  | 'REFUND_EXCEEDS_RECEIPT';

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
  /** Explicit attribution; never inferred from payment method. */
  payerParty?: PaymentParty | null;
  allowPartyOverpayment?: boolean | string | null;
  idempotencyKey?: string | null;
}

export interface RecordPaymentResult {
  idempotentReplay?: boolean;
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
    throw new PaymentDomainError('INVALID_INPUT', 'A valid invoice is required.', 400, {
      field: 'invoiceId',
    });
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

  const paymentMethod = typeof input?.paymentMethod === 'string' ? input.paymentMethod.trim() : '';

  if (!paymentMethod || paymentMethod.length > 40) {
    throw new PaymentDomainError('INVALID_INPUT', 'A payment method is required.', 400, {
      field: 'paymentMethod',
    });
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
      throw new PaymentDomainError(
        'INVALID_INPUT',
        check.reason ?? 'Invalid transaction code.',
        400,
        {
          field: 'transactionCode',
        },
      );
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

  if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
    throw new PaymentDomainError(
      'FACILITY_MODULE_DISABLED',
      'The finance module is disabled for this facility.',
      403,
      { module: 'finance' },
    );
  }

  const allowOverpayment = truthy(input?.allowOverpayment);
  const allowPartyOverpayment = truthy(input?.allowPartyOverpayment);
  const rawKey = input?.idempotencyKey;
  const key = rawKey == null || rawKey === '' ? null : rawKey;
  if (key !== null && (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))) {
    throw new PaymentDomainError('INVALID_INPUT', 'Use a valid payment retry identity.', 400);
  }
  const party = input?.payerParty == null ? null : input.payerParty;
  if (party !== null && party !== 'PATIENT' && party !== 'INSURER') {
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'Choose patient or insurer as the payer party.',
      400,
    );
  }

  const requestHash = key
    ? createHash('sha256')
        .update(
          JSON.stringify({
            invoiceId,
            amountCents,
            paymentMethod,
            transactionCode,
            allowOverpayment,
            party,
            allowPartyOverpayment,
            actorUserId: context.userId,
          }),
        )
        .digest('hex')
    : null;

  try {
    return await db.transaction(async (tx) => {
      if (key && requestHash) {
        // Serialize retries even when a key is reused against a different invoice.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${facility.id}))`,
        );
        const [prior] = await tx
          .select()
          .from(schema.billingPaymentRequests)
          .where(
            and(
              eq(schema.billingPaymentRequests.tenantId, facility.tenantId),
              eq(schema.billingPaymentRequests.facilityId, facility.id),
              eq(schema.billingPaymentRequests.idempotencyKey, key),
            ),
          )
          .limit(1);
        if (prior) {
          if (prior.requestHash !== requestHash || prior.actorUserId !== context.userId) {
            throw new PaymentDomainError(
              'PAYMENT_IDEMPOTENCY_CONFLICT',
              'This retry identity belongs to a different receipt request.',
              409,
            );
          }
          const [payment] = await tx
            .select()
            .from(schema.billingPayments)
            .where(
              and(
                eq(schema.billingPayments.id, prior.paymentId),
                eq(schema.billingPayments.invoiceId, prior.invoiceId),
              ),
            );
          if (!payment)
            throw new PaymentDomainError(
              'INVOICE_RECONCILIATION_REQUIRED',
              'The saved receipt requires review.',
              409,
            );
          return { payment, ...prior.resultSnapshot, idempotentReplay: true };
        }
        const [cancelled] = await tx
          .select({ id: schema.billingPaymentRequestCancellations.id })
          .from(schema.billingPaymentRequestCancellations)
          .where(
            and(
              eq(schema.billingPaymentRequestCancellations.facilityId, facility.id),
              eq(schema.billingPaymentRequestCancellations.idempotencyKey, key),
            ),
          )
          .limit(1);
        if (cancelled)
          throw new PaymentDomainError(
            'PAYMENT_REQUEST_CANCELLED',
            'This receipt request was cancelled; it cannot be posted later.',
            409,
          );
      }
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

      const totalCents = parseMoneyToCents(invoice.totalAmount);
      const paidCents = parseMoneyToCents(invoice.paidAmount);
      const balanceCents = parseMoneyToCents(invoice.balanceAmount);
      const creditCents = parseMoneyToCents(invoice.creditBalance);
      if (
        totalCents === null ||
        paidCents === null ||
        balanceCents === null ||
        creditCents === null ||
        totalCents < 0 ||
        paidCents < 0 ||
        balanceCents < 0 ||
        creditCents < 0 ||
        balanceCents !== Math.max(0, totalCents - paidCents) ||
        creditCents !== Math.max(0, paidCents - totalCents)
      ) {
        throw new PaymentDomainError(
          'INVOICE_RECONCILIATION_REQUIRED',
          'Invoice amounts are missing or inconsistent; authorized review is required before accepting payment.',
          409,
        );
      }
      const ledger = await readInvoicePaymentLedger(tx, invoice.id);
      if (!ledger || ledger.netCents !== paidCents) {
        throw new PaymentDomainError(
          'INVOICE_RECONCILIATION_REQUIRED',
          'The invoice balance, receipts and refunds disagree; authorized review is required.',
          409,
        );
      }

      if (invoice.finalizedAt) {
        if (!key) {
          throw new PaymentDomainError(
            'PAYMENT_IDEMPOTENCY_REQUIRED',
            'A retry identity is required for a finalized invoice receipt.',
            400,
          );
        }
        if (!party) {
          throw new PaymentDomainError(
            'PAYMENT_PARTY_REQUIRED',
            'Select whether the patient or insurer is paying this finalized invoice.',
            400,
          );
        }
        const [finalization] = await tx
          .select()
          .from(schema.billingInvoiceFinalizations)
          .where(eq(schema.billingInvoiceFinalizations.invoiceId, invoice.id));
        if (
          !finalization ||
          finalization.tenantId !== invoice.tenantId ||
          finalization.facilityId !== invoice.facilityId
        ) {
          throw new PaymentDomainError(
            'INVOICE_RECONCILIATION_REQUIRED',
            'Invoice finalization evidence is missing; review is required.',
            409,
          );
        }
        const split = await calculateInvoiceFinancialView(tx, invoice, finalization);
        if (!split.reconciled || split.patientBalance === null || split.insurerBalance === null) {
          throw new PaymentDomainError(
            'PAYMENT_ATTRIBUTION_REQUIRED',
            'Review and attribute existing receipts before collecting against either party.',
            409,
          );
        }
        const partyBalance = parseMoneyToCents(
          party === 'PATIENT' ? split.patientBalance : split.insurerBalance,
        );
        if (partyBalance === null)
          throw new PaymentDomainError(
            'INVOICE_RECONCILIATION_REQUIRED',
            'Party balance is unavailable.',
            409,
          );
        if (amountCents > partyBalance && !allowPartyOverpayment) {
          throw new PaymentDomainError(
            'PAYMENT_EXCEEDS_PARTY_BALANCE',
            'This receipt exceeds the selected party balance; explicit confirmation is required.',
            400,
            {
              party,
              outstandingCents: partyBalance,
              amountCents,
              excessCents: amountCents - partyBalance,
            },
          );
        }
      }

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
      if (party) {
        await tx.insert(schema.billingPaymentAttributions).values({
          tenantId: facility.tenantId,
          facilityId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          party,
          reason: 'Party selected when receipt was recorded.',
          actorUserId: context.userId,
        });
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
      // A receipt and its minimal audit must commit or roll back together.
      await tx.insert(schema.auditLogs).values({
        tenantId: facility.tenantId,
        facilityId,
        userId: String(context.userId),
        action: 'CREATE',
        resource: 'Payment',
        resourceId: String(payment.id),
        details: 'Payment receipt recorded.',
      });

      const resultSnapshot = {
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
      if (key && requestHash) {
        await tx.insert(schema.billingPaymentRequests).values({
          tenantId: facility.tenantId,
          facilityId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          idempotencyKey: key,
          requestHash,
          actorUserId: context.userId,
          resultSnapshot,
        });
      }
      return { payment, ...resultSnapshot, idempotentReplay: false };
    });
  } catch (error) {
    /*
     * The unique index is the real guard against a double-posted M-Pesa
     * code; the check above only exists to give a clean message when it
     * wins the race.
     */
    if (error instanceof Error && /billing_payments_transaction_code_unique/i.test(error.message)) {
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

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Receipt numbers come from a sequence so two tills cannot mint the same
 * number. The sequence is created by migration 0010.
 */
async function nextReceiptNumber(executor: Executor): Promise<string> {
  const result = await executor.execute(sql`SELECT nextval('billing_receipt_seq')::text AS value`);

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

/** Recovery looks up a single actor's opaque retry identity. NOT_FOUND is not
 * proof that an in-flight or delayed request cannot still arrive. */
export async function checkPaymentRequestStatus(
  context: AuthorizationContext,
  input: { facilityId?: number | string | null; idempotencyKey?: unknown },
) {
  if (!hasAllPermissions(context, ['billing.read', 'billing.payments.record']))
    throw new PaymentDomainError('INVALID_INPUT', 'Payment recovery permission is required.', 403);
  const key = input.idempotencyKey;
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A valid payment retry identity is required.',
      400,
    );
  const requested =
    input.facilityId == null || input.facilityId === '' ? null : Number(input.facilityId);
  const facilityId = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new PaymentDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance'))
    throw new PaymentDomainError(
      'FACILITY_MODULE_DISABLED',
      'Finance is disabled for this facility.',
      403,
    );
  const [row] = await db
    .select({
      invoiceId: schema.billingPaymentRequests.invoiceId,
      paymentId: schema.billingPaymentRequests.paymentId,
      actorUserId: schema.billingPaymentRequests.actorUserId,
      receiptNumber: schema.billingPayments.receiptNumber,
    })
    .from(schema.billingPaymentRequests)
    .innerJoin(
      schema.billingPayments,
      eq(schema.billingPaymentRequests.paymentId, schema.billingPayments.id),
    )
    .where(
      and(
        eq(schema.billingPaymentRequests.tenantId, facility.tenantId),
        eq(schema.billingPaymentRequests.facilityId, facilityId),
        eq(schema.billingPaymentRequests.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (row && row.actorUserId === context.userId)
    return {
      status: 'RECORDED' as const,
      invoiceId: row.invoiceId,
      paymentId: row.paymentId,
      receiptNumber: row.receiptNumber,
    };
  const [cancelled] = await db
    .select({
      invoiceId: schema.billingPaymentRequestCancellations.invoiceId,
      actorUserId: schema.billingPaymentRequestCancellations.actorUserId,
    })
    .from(schema.billingPaymentRequestCancellations)
    .where(
      and(
        eq(schema.billingPaymentRequestCancellations.tenantId, facility.tenantId),
        eq(schema.billingPaymentRequestCancellations.facilityId, facilityId),
        eq(schema.billingPaymentRequestCancellations.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (cancelled && cancelled.actorUserId === context.userId)
    return { status: 'CANCELLED' as const, invoiceId: cancelled.invoiceId };
  return { status: 'NOT_FOUND' as const };
}

/** Atomically prevent a delayed request from posting, or return the receipt
 * if the original request already committed. Never cancels an M-Pesa STK. */
export async function cancelPendingPaymentRequest(
  context: AuthorizationContext,
  input: {
    facilityId?: number | string | null;
    invoiceId?: unknown;
    idempotencyKey?: unknown;
    reason?: unknown;
  },
) {
  if (!hasAllPermissions(context, ['billing.read', 'billing.payments.record']))
    throw new PaymentDomainError('INVALID_INPUT', 'Payment recovery permission is required.', 403);
  const invoiceId = toPositiveInteger(input.invoiceId);
  const key = input.idempotencyKey;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (
    !invoiceId ||
    typeof key !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(key) ||
    reason.length < 3 ||
    reason.length > 500
  )
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'An invoice, retry identity and review reason are required.',
      400,
    );
  const requested =
    input.facilityId == null || input.facilityId === '' ? null : Number(input.facilityId);
  const facilityId = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new PaymentDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance'))
    throw new PaymentDomainError(
      'FACILITY_MODULE_DISABLED',
      'Finance is disabled for this facility.',
      403,
    );
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${facility.id}))`);
    const [prior] = await tx
      .select()
      .from(schema.billingPaymentRequests)
      .where(
        and(
          eq(schema.billingPaymentRequests.tenantId, facility.tenantId),
          eq(schema.billingPaymentRequests.facilityId, facilityId),
          eq(schema.billingPaymentRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.invoiceId !== invoiceId || prior.actorUserId !== context.userId)
        throw new PaymentDomainError(
          'PAYMENT_IDEMPOTENCY_CONFLICT',
          'This retry identity belongs to another request.',
          409,
        );
      const [payment] = await tx
        .select({ receiptNumber: schema.billingPayments.receiptNumber })
        .from(schema.billingPayments)
        .where(eq(schema.billingPayments.id, prior.paymentId));
      if (!payment)
        throw new PaymentDomainError(
          'INVOICE_RECONCILIATION_REQUIRED',
          'The receipt requires review.',
          409,
        );
      return {
        status: 'RECORDED' as const,
        invoiceId,
        paymentId: prior.paymentId,
        receiptNumber: payment.receiptNumber,
      };
    }
    const [cancelled] = await tx
      .select()
      .from(schema.billingPaymentRequestCancellations)
      .where(
        and(
          eq(schema.billingPaymentRequestCancellations.facilityId, facilityId),
          eq(schema.billingPaymentRequestCancellations.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (cancelled) {
      if (
        cancelled.tenantId !== facility.tenantId ||
        cancelled.invoiceId !== invoiceId ||
        cancelled.actorUserId !== context.userId ||
        cancelled.reason !== reason
      )
        throw new PaymentDomainError(
          'PAYMENT_IDEMPOTENCY_CONFLICT',
          'This retry identity belongs to another request.',
          409,
        );
      return { status: 'CANCELLED' as const, invoiceId, idempotentReplay: true };
    }
    const [invoice] = await tx
      .select({ id: schema.billingInvoices.id })
      .from(schema.billingInvoices)
      .where(
        and(
          eq(schema.billingInvoices.id, invoiceId),
          eq(schema.billingInvoices.tenantId, facility.tenantId),
          eq(schema.billingInvoices.facilityId, facilityId),
        ),
      )
      .for('update');
    if (!invoice) throw new PaymentDomainError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    await tx.insert(schema.billingPaymentRequestCancellations).values({
      tenantId: facility.tenantId,
      facilityId,
      invoiceId,
      idempotencyKey: key,
      actorUserId: context.userId,
      reason,
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId,
      userId: String(context.userId),
      action: 'CANCEL',
      resource: 'PaymentRequest',
      resourceId: String(invoiceId),
      details: 'Unrecorded receipt request cancelled after review.',
    });
    return { status: 'CANCELLED' as const, invoiceId, idempotentReplay: false };
  });
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
  const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

  const method =
    typeof filters?.method === 'string' && filters.method.trim() ? filters.method.trim() : null;

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
