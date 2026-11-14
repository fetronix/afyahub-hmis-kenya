/** Independent review of manual patient-receipt refunds; never sends money. */
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { PaymentDomainError } from './payments.service.ts';
import {
  facilityForRefund,
  refundableSource,
  refundKeyValue,
  type RefundTransaction,
} from './refunds.service.ts';
import { formatCents, parseMoneyToCents } from './settlement.ts';

const METHODS = new Set(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CHEQUE']);
type RequestRow = typeof schema.billingRefundRequests.$inferSelect;
type Facility = { id: number; tenantId: number };

function id(value: unknown): number | null {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function requestHash(
  q: Pick<RequestRow, 'invoiceId' | 'paymentId' | 'amount' | 'refundMethod' | 'reason'>,
) {
  return hash({
    invoiceId: q.invoiceId,
    paymentId: q.paymentId,
    amount: parseMoneyToCents(q.amount),
    method: q.refundMethod,
    reason: q.reason,
  });
}
function publicRequest(q: RequestRow) {
  return {
    id: q.id,
    requestNumber: q.requestNumber,
    facilityId: q.facilityId,
    invoiceId: q.invoiceId,
    paymentId: q.paymentId,
    amount: q.amount,
    refundMethod: q.refundMethod,
    reason: q.reason,
    idempotencyKey: q.idempotencyKey,
    status: q.status,
    requestedByUserId: q.requestedByUserId,
    reviewedByUserId: q.reviewedByUserId,
    reviewNotes: q.reviewNotes,
    reviewedAt: q.reviewedAt,
    revokedByUserId: q.revokedByUserId,
    revocationReason: q.revocationReason,
    revokedAt: q.revokedAt,
    settledRefundId: q.settledRefundId,
    createdAt: q.createdAt,
  };
}
async function audit(
  tx: RefundTransaction,
  facility: Facility,
  context: AuthorizationContext,
  action: string,
  q: RequestRow,
  details: Record<string, unknown> = {},
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: String(context.userId),
    action,
    resource: 'RefundRequest',
    resourceId: String(q.id),
    details: JSON.stringify({
      invoiceId: q.invoiceId,
      paymentId: q.paymentId,
      requestNumber: q.requestNumber,
      ...details,
    }),
  });
}

export interface RefundRequestInput {
  facilityId?: unknown;
  invoiceId: unknown;
  paymentId: unknown;
  amount: unknown;
  refundMethod: unknown;
  reason: unknown;
  idempotencyKey: unknown;
}
export async function createRefundRequest(
  context: AuthorizationContext,
  input: RefundRequestInput,
) {
  const invoiceId = id(input?.invoiceId),
    paymentId = id(input?.paymentId);
  const amount =
    typeof input?.amount === 'string' || typeof input?.amount === 'number'
      ? parseMoneyToCents(input.amount)
      : null;
  const method =
    typeof input?.refundMethod === 'string' ? input.refundMethod.trim().toUpperCase() : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  const key = refundKeyValue(input?.idempotencyKey);
  if (
    !invoiceId ||
    !paymentId ||
    amount === null ||
    amount <= 0 ||
    !METHODS.has(method) ||
    reason.length < 3 ||
    reason.length > 500
  ) {
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A receipt, positive amount, method and reason are required.',
      400,
    );
  }
  const facility = await facilityForRefund(context, input.facilityId);
  const digest = requestHash({
    invoiceId,
    paymentId,
    amount: formatCents(amount),
    refundMethod: method,
    reason,
  });
  return db.transaction(async (tx) => {
    // The same lock is used by the manual-receipt writer, including key collisions.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${facility.id}))`);
    const [prior] = await tx
      .select()
      .from(schema.billingRefundRequests)
      .where(
        and(
          eq(schema.billingRefundRequests.tenantId, facility.tenantId),
          eq(schema.billingRefundRequests.facilityId, facility.id),
          eq(schema.billingRefundRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.requestHash !== digest || requestHash(prior) !== digest)
        throw new PaymentDomainError(
          'REFUND_REQUEST_IDEMPOTENCY_CONFLICT',
          'This retry identity belongs to a different refund request.',
          409,
        );
      return { request: publicRequest(prior), replayed: true };
    }
    const [oldReceipt] = await tx
      .select({ id: schema.billingRefunds.id })
      .from(schema.billingRefunds)
      .where(
        and(
          eq(schema.billingRefunds.tenantId, facility.tenantId),
          eq(schema.billingRefunds.facilityId, facility.id),
          eq(schema.billingRefunds.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (oldReceipt)
      throw new PaymentDomainError(
        'REFUND_REQUEST_IDEMPOTENCY_CONFLICT',
        'This retry identity belongs to an existing refund receipt.',
        409,
      );
    const source = await refundableSource(tx, facility, invoiceId, paymentId, amount, true, true);
    const bankOnly = await tx.execute(
      sql`SELECT facility_id FROM facility_bank_payment_policies WHERE facility_id=${facility.id} AND tenant_id=${facility.tenantId}`,
    );
    if ((source.payment.bankPaymentRecordId || bankOnly.rows.length) && method !== 'BANK_TRANSFER')
      throw new PaymentDomainError(
        'BANK_VERIFICATION_REQUIRED',
        'Bank-only refunds must use verified bank transfer evidence.',
        409,
      );
    const [created] = await tx
      .insert(schema.billingRefundRequests)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        invoiceId,
        paymentId,
        requestNumber: `RFR-${randomUUID()}`,
        amount: formatCents(amount),
        refundMethod: method,
        reason,
        idempotencyKey: key,
        requestHash: digest,
        requestedByUserId: context.userId,
      })
      .returning();
    if (!created) throw new Error('Refund request insert returned no record');
    await audit(tx, facility, context, 'REQUEST', created, { amount: created.amount, method });
    return { request: publicRequest(created), replayed: false };
  });
}

/** Capture the exact request and current receipt/invoice/reservation evidence seen by a reviewer. */
async function assessment(tx: RefundTransaction, facility: Facility, q: RequestRow, lock: boolean) {
  const base = {
    id: q.id,
    requestNumber: q.requestNumber,
    requestHash: q.requestHash,
    actualRequestHash: requestHash(q),
    requestedByUserId: q.requestedByUserId,
  };
  if (base.requestHash !== base.actualRequestHash) {
    const issue = 'REFUND_REQUEST_CHANGED';
    return { reviewHash: hash({ ...base, issue }), issue, evidence: null };
  }
  try {
    const amount = parseMoneyToCents(q.amount);
    if (amount === null || amount <= 0)
      throw new PaymentDomainError('INVALID_INPUT', 'Refund amount is invalid.', 409);
    const source = await refundableSource(
      tx,
      facility,
      q.invoiceId,
      q.paymentId,
      amount,
      lock,
      false,
    );
    const result = await tx.execute(sql`SELECT
      coalesce(sum(amount) FILTER (WHERE payment_id=${q.paymentId}),0)::text AS receipt_reserved,
      coalesce(sum(amount),0)::text AS invoice_reserved
      FROM billing_refund_requests WHERE tenant_id=${facility.tenantId} AND facility_id=${facility.id}
        AND invoice_id=${q.invoiceId} AND status='APPROVED' AND id<>${q.id}`);
    const row = (
      result as unknown as { rows: Array<{ receipt_reserved: string; invoice_reserved: string }> }
    ).rows[0];
    const receiptReserved = parseMoneyToCents(row?.receipt_reserved),
      invoiceReserved = parseMoneyToCents(row?.invoice_reserved);
    if (
      receiptReserved === null ||
      invoiceReserved === null ||
      receiptReserved < 0 ||
      invoiceReserved < 0
    )
      throw new Error('Invalid refund reservation totals');
    const receiptAvailable =
      source.receipt.grossCents - source.receipt.refundedCents - receiptReserved;
    const invoiceAvailable = source.paid - invoiceReserved;
    const issue =
      amount > receiptAvailable || amount > invoiceAvailable
        ? 'REFUND_APPROVAL_EXCEEDS_AVAILABLE'
        : null;
    const evidence = {
      invoiceStatus: source.invoice.status,
      invoiceTotal: formatCents(source.total),
      invoicePaid: formatCents(source.paid),
      invoiceBalance: formatCents(source.balance),
      invoiceCredit: formatCents(source.credit),
      receiptNumber: source.payment.receiptNumber,
      receiptMethod: source.payment.paymentMethod,
      receiptGross: formatCents(source.receipt.grossCents),
      receiptRefunded: formatCents(source.receipt.refundedCents),
      receiptReserved: formatCents(receiptReserved),
      invoiceReserved: formatCents(invoiceReserved),
      receiptAvailable: formatCents(receiptAvailable),
      invoiceAvailable: formatCents(invoiceAvailable),
    };
    return { reviewHash: hash({ ...base, evidence, issue }), issue, evidence };
  } catch (error) {
    if (!(error instanceof PaymentDomainError)) throw error;
    // Rejection remains possible even when source evidence has become ineligible;
    // approval never does. Do not disguise unexpected database failures as a review issue.
    const issue = error.code;
    return { reviewHash: hash({ ...base, issue }), issue, evidence: null };
  }
}

/** Not found does not rule out a delayed request still arriving. */
export async function checkRefundRequestStatus(
  context: AuthorizationContext,
  input: { facilityId?: unknown; idempotencyKey: unknown },
) {
  const key = refundKeyValue(input?.idempotencyKey);
  const facility = await facilityForRefund(context, input.facilityId);
  const [q] = await db
    .select()
    .from(schema.billingRefundRequests)
    .where(
      and(
        eq(schema.billingRefundRequests.tenantId, facility.tenantId),
        eq(schema.billingRefundRequests.facilityId, facility.id),
        eq(schema.billingRefundRequests.idempotencyKey, key),
      ),
    )
    .limit(1);
  return q
    ? { status: 'FOUND' as const, request: publicRequest(q) }
    : { status: 'NOT_FOUND' as const };
}

export async function listRefundRequests(
  context: AuthorizationContext,
  input: { facilityId?: unknown; invoiceId?: unknown; afterId?: unknown; limit?: unknown },
) {
  const facility = await facilityForRefund(context, input.facilityId, 'either');
  const invoiceId =
    input.invoiceId === undefined || input.invoiceId === '' ? null : id(input.invoiceId);
  const afterId = input.afterId === undefined || input.afterId === '' ? 0 : id(input.afterId);
  const limit = input.limit === undefined || input.limit === '' ? 20 : Number(input.limit);
  if (
    (input.invoiceId !== undefined && input.invoiceId !== '' && !invoiceId) ||
    afterId === null ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A valid invoice, cursor and page size are required.',
      400,
    );
  return db.transaction(
    async (tx) => {
      const rows = await tx
        .select()
        .from(schema.billingRefundRequests)
        .where(
          and(
            eq(schema.billingRefundRequests.tenantId, facility.tenantId),
            eq(schema.billingRefundRequests.facilityId, facility.id),
            gt(schema.billingRefundRequests.id, afterId),
            ...(invoiceId ? [eq(schema.billingRefundRequests.invoiceId, invoiceId)] : []),
          ),
        )
        .orderBy(asc(schema.billingRefundRequests.id))
        .limit(limit + 1);
      const visible = rows.slice(0, limit);
      const requests = [];
      for (const q of visible)
        requests.push({
          ...publicRequest(q),
          ...(q.status === 'REQUESTED'
            ? await assessment(tx, facility, q, false)
            : { reviewHash: null, issue: null, evidence: null }),
        });
      return {
        requests,
        nextAfterId: rows.length > limit ? visible[visible.length - 1]!.id : null,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function decideRefundRequest(
  context: AuthorizationContext,
  requestId: unknown,
  input: { facilityId?: unknown; decision: unknown; reviewHash: unknown; notes: unknown },
) {
  const requestIdNumber = id(requestId),
    decision = typeof input?.decision === 'string' ? input.decision : '',
    reviewHash = typeof input?.reviewHash === 'string' ? input.reviewHash : '',
    notes = typeof input?.notes === 'string' ? input.notes.trim() : '';
  if (
    !requestIdNumber ||
    !['APPROVE', 'REJECT'].includes(decision) ||
    !/^[a-f0-9]{64}$/.test(reviewHash) ||
    notes.length < 3 ||
    notes.length > 1000
  )
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A request, decision, current review and notes are required.',
      400,
    );
  const facility = await facilityForRefund(context, input.facilityId, 'billing.refunds.approve');
  return db.transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(schema.billingRefundRequests)
      .where(
        and(
          eq(schema.billingRefundRequests.id, requestIdNumber),
          eq(schema.billingRefundRequests.tenantId, facility.tenantId),
          eq(schema.billingRefundRequests.facilityId, facility.id),
        ),
      )
      .limit(1);
    if (!initial)
      throw new PaymentDomainError('REFUND_REQUEST_NOT_FOUND', 'Refund request not found.', 404);
    if (initial.requestedByUserId === context.userId)
      throw new PaymentDomainError(
        'SELF_REFUND_APPROVAL_FORBIDDEN',
        'A different authorized reviewer is required.',
        403,
      );
    // Invoice and receipt precede the request lock in both settlement and review.
    await tx
      .select({ id: schema.billingInvoices.id })
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, initial.invoiceId))
      .for('update');
    await tx
      .select({ id: schema.billingPayments.id })
      .from(schema.billingPayments)
      .where(eq(schema.billingPayments.id, initial.paymentId))
      .for('update');
    const [q] = await tx
      .select()
      .from(schema.billingRefundRequests)
      .where(eq(schema.billingRefundRequests.id, initial.id))
      .for('update');
    if (!q)
      throw new PaymentDomainError('REFUND_REQUEST_NOT_FOUND', 'Refund request not found.', 404);
    const target = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (
      q.status === target &&
      q.reviewedByUserId === context.userId &&
      q.reviewHash === reviewHash &&
      q.reviewNotes === notes
    )
      return { requestId: q.id, status: q.status, replayed: true };
    if (q.status !== 'REQUESTED')
      throw new PaymentDomainError(
        'REFUND_DECISION_CONFLICT',
        'Refund request has already been decided.',
        409,
      );
    const current = await assessment(tx, facility, q, false);
    if (current.reviewHash !== reviewHash)
      throw new PaymentDomainError(
        'REFUND_REVIEW_CHANGED',
        'Refund evidence changed; refresh the request before deciding.',
        409,
      );
    if (decision === 'APPROVE' && current.issue)
      throw new PaymentDomainError(
        current.issue === 'REFUND_APPROVAL_EXCEEDS_AVAILABLE'
          ? 'REFUND_APPROVAL_EXCEEDS_AVAILABLE'
          : 'REFUND_REVIEW_UNAVAILABLE',
        'Current receipt evidence does not permit approval.',
        409,
      );
    const [updated] = await tx
      .update(schema.billingRefundRequests)
      .set({
        status: target,
        reviewedByUserId: context.userId,
        reviewNotes: notes,
        reviewHash,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.billingRefundRequests.id, q.id))
      .returning();
    if (!updated) throw new Error('Refund review update returned no record');
    await audit(tx, facility, context, decision, updated, { reviewHash, issue: current.issue });
    return { requestId: q.id, status: target, replayed: false };
  });
}

/** An authorized independent reviewer can release an unused approval; no funds move. */
export async function revokeRefundApproval(
  context: AuthorizationContext,
  requestId: unknown,
  input: { facilityId?: unknown; reason: unknown },
) {
  const requestIdNumber = id(requestId),
    reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (!requestIdNumber || reason.length < 3 || reason.length > 1000)
    throw new PaymentDomainError(
      'INVALID_INPUT',
      'A request and revocation reason are required.',
      400,
    );
  const facility = await facilityForRefund(context, input.facilityId, 'billing.refunds.approve');
  return db.transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(schema.billingRefundRequests)
      .where(
        and(
          eq(schema.billingRefundRequests.id, requestIdNumber),
          eq(schema.billingRefundRequests.tenantId, facility.tenantId),
          eq(schema.billingRefundRequests.facilityId, facility.id),
        ),
      )
      .limit(1);
    if (!initial)
      throw new PaymentDomainError('REFUND_REQUEST_NOT_FOUND', 'Refund request not found.', 404);
    if (initial.requestedByUserId === context.userId)
      throw new PaymentDomainError(
        'SELF_REFUND_APPROVAL_FORBIDDEN',
        'A different authorized reviewer is required.',
        403,
      );
    await tx
      .select({ id: schema.billingInvoices.id })
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, initial.invoiceId))
      .for('update');
    const [q] = await tx
      .select()
      .from(schema.billingRefundRequests)
      .where(eq(schema.billingRefundRequests.id, initial.id))
      .for('update');
    if (!q)
      throw new PaymentDomainError('REFUND_REQUEST_NOT_FOUND', 'Refund request not found.', 404);
    if (
      q.status === 'REVOKED' &&
      q.revokedByUserId === context.userId &&
      q.revocationReason === reason
    )
      return { requestId: q.id, status: q.status, replayed: true };
    if (q.status !== 'APPROVED')
      throw new PaymentDomainError(
        'REFUND_DECISION_CONFLICT',
        'Only an unused approval can be revoked.',
        409,
      );
    const [updated] = await tx
      .update(schema.billingRefundRequests)
      .set({
        status: 'REVOKED',
        revokedByUserId: context.userId,
        revocationReason: reason,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.billingRefundRequests.id, q.id))
      .returning();
    if (!updated) throw new Error('Refund revocation update returned no record');
    await audit(tx, facility, context, 'REVOKE', updated);
    return { requestId: q.id, status: 'REVOKED' as const, replayed: false };
  });
}
