/**
 * JaliCare HMIS
 * Insurance claims workflow
 *
 * A claim is a request to a payer for a specific set of charges. This
 * module drafts that request from an invoice, tracks it through
 * submission and adjudication, and — when the payer approves — posts the
 * approved amount against the invoice as a real payment.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It never contacts SHA or any other payer. There is no claim
 * transmission here, no member verification, and no remittance download.
 * A clerk drafts the claim, submits it through whatever channel the
 * payer requires, and records the outcome here. Anything else would be a
 * screen pretending to be an integration.
 *
 * DESIGN RULES
 * ------------
 * 1. A claim may only cover charges that exist on its invoice.
 * 2. Only one claim per invoice may be open (Draft, Submitted, Approved).
 *    The check runs under an invoice row lock, so two clerks cannot both
 *    draft a claim for the same balance.
 * 3. Line items are snapshotted at claim time. Invoices are edited;
 *    a claim must still say what it asked for.
 * 4. "Settled" means money moved: a billing_payments row exists and the
 *    invoice balance is reduced. A status change alone settles nothing.
 * 5. Approved money is applied to the outstanding balance. If a payer
 *    approves more than is still owed, only the owed amount is posted
 *    and the remainder is reported rather than invented as credit.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';

import {
  classifySettlement,
  formatCents,
  parseMoneyToCents,
} from '../billing/settlement.ts';

export type ClaimErrorCode =
  | 'INVALID_INPUT'
  | 'INVOICE_NOT_FOUND'
  | 'FACILITY_NOT_FOUND'
  | 'FACILITY_MODULE_DISABLED'
  | 'CLAIM_NOT_FOUND'
  | 'PATIENT_MISMATCH'
  | 'INVOICE_VOIDED'
  | 'NOTHING_TO_CLAIM'
  | 'CLAIM_EXCEEDS_BALANCE'
  | 'OPEN_CLAIM_EXISTS'
  | 'INVALID_LINE_ITEMS'
  | 'INVALID_TRANSITION'
  | 'APPROVED_EXCEEDS_CLAIM';

export class ClaimDomainError extends Error {
  readonly code: ClaimErrorCode;
  readonly status: number;
  readonly detail: Record<string, unknown>;

  constructor(
    code: ClaimErrorCode,
    message: string,
    status: number,
    detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ClaimDomainError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Statuses that still hold a claim on the invoice. */
const OPEN_STATUSES = ['Draft', 'Submitted', 'Approved'];

export interface DraftClaimInput {
  facilityId?: number | string | null;
  invoiceId: number | string;
  /** Billing item ids. Omit to claim the whole outstanding balance. */
  lineItemIds?: Array<number | string> | null;
  payerName?: string | null;
  policyNumber?: string | null;
  preAuthCode?: string | null;
  notes?: string | null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.slice(0, maxLength);
}

async function resolveFacility(
  context: AuthorizationContext,
  requestedFacilityId?: number | string | null,
) {
  const parsed =
    requestedFacilityId === undefined ||
    requestedFacilityId === null ||
    requestedFacilityId === ''
      ? null
      : Number(requestedFacilityId);

  if (parsed !== null && !Number.isSafeInteger(parsed)) {
    throw new ClaimDomainError('INVALID_INPUT', 'The facility is not valid.', 400, {
      field: 'facilityId',
    });
  }

  const facilityId = resolveFacilityScope(context, parsed);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ClaimDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  }

  if (
    !Array.isArray(facility.enabledModules) ||
    !facility.enabledModules.includes('insurance')
  ) {
    throw new ClaimDomainError(
      'FACILITY_MODULE_DISABLED',
      'The insurance module is disabled for this facility.',
      403,
      { module: 'insurance' },
    );
  }

  return facility;
}

/* ============================================================
   CLAIMABLE LINES
   ============================================================ */

/**
 * The invoice lines a claim could be raised against, with the amount
 * still unclaimed. The screen uses this to prefill the selection.
 */
export async function getClaimableLinesScoped(
  context: AuthorizationContext,
  invoiceId: number | string,
  requestedFacilityId?: number | string | null,
) {
  const facility = await resolveFacility(context, requestedFacilityId);
  const id = toPositiveInteger(invoiceId);

  if (id === null) {
    throw new ClaimDomainError('INVALID_INPUT', 'A valid invoice is required.', 400, {
      field: 'invoiceId',
    });
  }

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(
      and(
        eq(schema.billingInvoices.id, id),
        eq(schema.billingInvoices.facilityId, facility.id),
        eq(schema.billingInvoices.tenantId, facility.tenantId),
      ),
    )
    .limit(1);

  if (!invoice) {
    throw new ClaimDomainError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
  }

  const lines = await db
    .select({
      id: schema.billingItems.id,
      description: schema.billingItems.description,
      itemType: schema.billingItems.itemType,
      quantity: schema.billingItems.quantity,
      unitPrice: schema.billingItems.unitPrice,
      totalAmount: schema.billingItems.totalAmount,
    })
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, id))
    .orderBy(asc(schema.billingItems.id));

  const openClaims = await db
    .select({ id: schema.insuranceClaims.id, claimNumber: schema.insuranceClaims.claimNumber })
    .from(schema.insuranceClaims)
    .where(
      and(
        eq(schema.insuranceClaims.invoiceId, id),
        inArray(schema.insuranceClaims.status, OPEN_STATUSES),
      ),
    );

  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      patientId: invoice.patientId,
      totalAmount: String(invoice.totalAmount ?? '0.00'),
      paidAmount: String(invoice.paidAmount ?? '0.00'),
      balanceAmount: String(invoice.balanceAmount ?? '0.00'),
      status: String(invoice.status ?? 'Pending'),
      payerType: String(invoice.payerType ?? 'Self-Pay'),
    },
    lines,
    openClaims,
  };
}

/* ============================================================
   DRAFT
   ============================================================ */

export async function draftClaimScoped(
  context: AuthorizationContext,
  input: DraftClaimInput,
  createdByUserId: number,
) {
  const facility = await resolveFacility(context, input?.facilityId);
  const invoiceId = toPositiveInteger(input?.invoiceId);

  if (invoiceId === null) {
    throw new ClaimDomainError('INVALID_INPUT', 'A valid invoice is required.', 400, {
      field: 'invoiceId',
    });
  }

  const requestedItemIds = Array.isArray(input?.lineItemIds)
    ? input.lineItemIds
        .map((value) => toPositiveInteger(value))
        .filter((value): value is number => value !== null)
    : null;

  if (input?.lineItemIds && requestedItemIds && requestedItemIds.length === 0) {
    throw new ClaimDomainError(
      'INVALID_LINE_ITEMS',
      'Select at least one charge to claim, or leave the selection empty to claim the whole balance.',
      400,
    );
  }

  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(
        and(
          eq(schema.billingInvoices.id, invoiceId),
          eq(schema.billingInvoices.facilityId, facility.id),
          eq(schema.billingInvoices.tenantId, facility.tenantId),
        ),
      )
      .for('update');

    if (!invoice) {
      throw new ClaimDomainError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    }

    if (invoice.status === 'Void' || invoice.voidedAt) {
      throw new ClaimDomainError(
        'INVOICE_VOIDED',
        'This invoice has been voided and cannot be claimed against.',
        409,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const balanceCents = parseMoneyToCents(invoice.balanceAmount) ?? 0;

    if (balanceCents <= 0) {
      throw new ClaimDomainError(
        'NOTHING_TO_CLAIM',
        'This invoice has no outstanding balance to claim.',
        409,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const [existing] = await tx
      .select({
        id: schema.insuranceClaims.id,
        claimNumber: schema.insuranceClaims.claimNumber,
        status: schema.insuranceClaims.status,
      })
      .from(schema.insuranceClaims)
      .where(
        and(
          eq(schema.insuranceClaims.invoiceId, invoiceId),
          inArray(schema.insuranceClaims.status, OPEN_STATUSES),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ClaimDomainError(
        'OPEN_CLAIM_EXISTS',
        `Invoice ${invoice.invoiceNumber} already has an open claim (${existing.claimNumber}, ${existing.status}).`,
        409,
        { claimId: existing.id, claimNumber: existing.claimNumber, status: existing.status },
      );
    }

    const allLines = await tx
      .select({
        id: schema.billingItems.id,
        description: schema.billingItems.description,
        totalAmount: schema.billingItems.totalAmount,
      })
      .from(schema.billingItems)
      .where(eq(schema.billingItems.invoiceId, invoiceId))
      .orderBy(asc(schema.billingItems.id));

    let selected = allLines;

    if (requestedItemIds && requestedItemIds.length > 0) {
      const ids = new Set(requestedItemIds);
      selected = allLines.filter((line) => ids.has(line.id));

      if (selected.length !== ids.size) {
        throw new ClaimDomainError(
          'INVALID_LINE_ITEMS',
          'One or more selected charges do not belong to this invoice.',
          400,
          { invoiceId },
        );
      }
    }

    if (selected.length === 0) {
      throw new ClaimDomainError(
        'NOTHING_TO_CLAIM',
        'This invoice has no charges to claim against.',
        409,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const selectedCents = selected.reduce(
      (sum, line) => sum + (parseMoneyToCents(line.totalAmount) ?? 0),
      0,
    );

    /*
     * A claim can never ask for more than the patient still owes. If the
     * whole invoice is claimed after a part payment, the claim is for the
     * outstanding balance, not the original total.
     */
    const claimCents = Math.min(selectedCents, balanceCents);

    if (claimCents <= 0) {
      throw new ClaimDomainError(
        'NOTHING_TO_CLAIM',
        'The selected charges amount to nothing.',
        409,
      );
    }

    const [sequenceRow] = (
      await tx.execute(sql`SELECT nextval('insurance_claim_number_seq')::text AS value`)
    ).rows as Array<{ value: string }>;

    const stamp = [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, '0'),
      String(new Date().getDate()).padStart(2, '0'),
    ].join('');

    const claimNumber = `CLM-${stamp}-${(sequenceRow?.value ?? '0').padStart(6, '0')}`;

    const payerName =
      cleanText(input?.payerName, 120) ??
      (invoice.payerName ? String(invoice.payerName) : 'Social Health Authority (SHA)');

    const [claim] = await tx
      .insert(schema.insuranceClaims)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        patientId: invoice.patientId,
        invoiceId: invoice.id,
        claimNumber,
        payerName,
        policyNumber: cleanText(input?.policyNumber, 80) ?? invoice.memberNumber ?? null,
        preAuthCode: cleanText(input?.preAuthCode, 80),
        claimAmount: formatCents(claimCents),
        approvedAmount: '0.00',
        status: 'Draft',
        adjudicationNotes: cleanText(input?.notes, 2000),
        createdByUserId,
      })
      .returning();

    if (!claim) {
      throw new Error('Claim insert returned no record');
    }

    await tx.insert(schema.insuranceClaimItems).values(
      selected.map((line) => ({
        claimId: claim.id,
        billingItemId: line.id,
        description: String(line.description ?? 'Charge'),
        amount: String(line.totalAmount ?? '0.00'),
      })),
    );

    return {
      claim,
      claimedLines: selected.length,
      /** True when part payments meant the claim covers less than the lines. */
      cappedAtBalance: selectedCents > balanceCents,
      selectedCents,
      balanceCents,
    };
  });
}

/* ============================================================
   STATE TRANSITIONS
   ============================================================ */

async function loadClaimForUpdate(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  context: AuthorizationContext,
  claimId: number,
  requestedFacilityId?: number | string | null,
) {
  const facility = await resolveFacility(context, requestedFacilityId);

  const [claim] = await tx
    .select()
    .from(schema.insuranceClaims)
    .where(
      and(
        eq(schema.insuranceClaims.id, claimId),
        eq(schema.insuranceClaims.facilityId, facility.id),
        eq(schema.insuranceClaims.tenantId, facility.tenantId),
      ),
    )
    .for('update');

  if (!claim) {
    throw new ClaimDomainError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
  }

  return { claim, facility };
}

export async function submitClaimScoped(
  context: AuthorizationContext,
  claimIdInput: number | string,
  requestedFacilityId?: number | string | null,
) {
  const claimId = toPositiveInteger(claimIdInput);

  if (claimId === null) {
    throw new ClaimDomainError('INVALID_INPUT', 'A valid claim is required.', 400);
  }

  return db.transaction(async (tx) => {
    const { claim } = await loadClaimForUpdate(tx, context, claimId, requestedFacilityId);

    if (claim.status !== 'Draft') {
      throw new ClaimDomainError(
        'INVALID_TRANSITION',
        `Only a draft claim can be marked submitted. This claim is ${claim.status}.`,
        409,
        { status: claim.status },
      );
    }

    const [updated] = await tx
      .update(schema.insuranceClaims)
      .set({ status: 'Submitted', submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.insuranceClaims.id, claim.id))
      .returning();

    return updated;
  });
}

export interface AdjudicationInput {
  approvedAmount?: number | string | null;
  notes?: string | null;
  facilityId?: number | string | null;
}

/**
 * Record what the payer decided. `approvedAmount` of zero means the
 * claim was declined.
 */
export async function adjudicateClaimScoped(
  context: AuthorizationContext,
  claimIdInput: number | string,
  input: AdjudicationInput,
) {
  const claimId = toPositiveInteger(claimIdInput);

  if (claimId === null) {
    throw new ClaimDomainError('INVALID_INPUT', 'A valid claim is required.', 400);
  }

  const approvedCents = parseMoneyToCents(input?.approvedAmount);

  if (approvedCents === null || approvedCents < 0) {
    throw new ClaimDomainError(
      'INVALID_INPUT',
      'Enter the amount the payer approved, or 0 if the claim was declined.',
      400,
      { field: 'approvedAmount' },
    );
  }

  return db.transaction(async (tx) => {
    const { claim } = await loadClaimForUpdate(
      tx,
      context,
      claimId,
      input?.facilityId,
    );

    if (claim.status !== 'Submitted') {
      throw new ClaimDomainError(
        'INVALID_TRANSITION',
        `Only a submitted claim can be adjudicated. This claim is ${claim.status}.`,
        409,
        { status: claim.status },
      );
    }

    const claimedCents = parseMoneyToCents(claim.claimAmount) ?? 0;

    if (approvedCents > claimedCents) {
      throw new ClaimDomainError(
        'APPROVED_EXCEEDS_CLAIM',
        `The approved amount cannot exceed the amount claimed (KES ${formatCents(claimedCents)}).`,
        400,
        { claimedCents, approvedCents },
      );
    }

    const [updated] = await tx
      .update(schema.insuranceClaims)
      .set({
        status: approvedCents > 0 ? 'Approved' : 'Rejected',
        approvedAmount: formatCents(approvedCents),
        adjudicationNotes: cleanText(input?.notes, 2000) ?? claim.adjudicationNotes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.insuranceClaims.id, claim.id))
      .returning();

    return updated;
  });
}

/**
 * Post the approved amount against the invoice and close the claim.
 *
 * This is the only place a claim becomes "Settled", and it only does so
 * because a payment row now exists.
 */
export async function settleClaimScoped(
  context: AuthorizationContext,
  claimIdInput: number | string,
  cashierName: string,
  requestedFacilityId?: number | string | null,
) {
  const claimId = toPositiveInteger(claimIdInput);

  if (claimId === null) {
    throw new ClaimDomainError('INVALID_INPUT', 'A valid claim is required.', 400);
  }

  return db.transaction(async (tx) => {
    const { claim, facility } = await loadClaimForUpdate(
      tx,
      context,
      claimId,
      requestedFacilityId,
    );

    if (claim.status !== 'Approved') {
      throw new ClaimDomainError(
        'INVALID_TRANSITION',
        `Only an approved claim can be settled. This claim is ${claim.status}.`,
        409,
        { status: claim.status },
      );
    }

    const approvedCents = parseMoneyToCents(claim.approvedAmount) ?? 0;

    if (approvedCents <= 0) {
      throw new ClaimDomainError(
        'INVALID_TRANSITION',
        'This claim has no approved amount to settle.',
        409,
      );
    }

    const [invoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, claim.invoiceId))
      .for('update');

    if (!invoice) {
      throw new ClaimDomainError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    }

    if (invoice.status === 'Void' || invoice.voidedAt) {
      throw new ClaimDomainError(
        'INVOICE_VOIDED',
        'The invoice for this claim has been voided.',
        409,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    const totalCents = parseMoneyToCents(invoice.totalAmount) ?? 0;
    const paidCents = parseMoneyToCents(invoice.paidAmount) ?? 0;
    const balanceCents = parseMoneyToCents(invoice.balanceAmount) ?? 0;

    if (balanceCents <= 0) {
      throw new ClaimDomainError(
        'NOTHING_TO_CLAIM',
        'This invoice has already been paid. Settling the claim would create a credit.',
        409,
        { invoiceNumber: invoice.invoiceNumber },
      );
    }

    /*
     * A payer can approve more than is still owed if the patient paid in
     * the meantime. Post only what is owed and report the rest; turning
     * the difference into patient credit would be inventing money.
     */
    const appliedCents = Math.min(approvedCents, balanceCents);
    const unappliedCents = approvedCents - appliedCents;

    const settlement = classifySettlement({
      invoiceTotalCents: totalCents,
      paidBeforeCents: paidCents,
      amountCents: appliedCents,
    });

    const [payment] = await tx
      .insert(schema.billingPayments)
      .values({
        invoiceId: invoice.id,
        receiptNumber: `SHA-${claim.claimNumber}`.slice(0, 100),
        paymentMethod: 'SHA',
        amount: formatCents(appliedCents),
        referenceCode: claim.claimNumber,
        transactionCode: claim.claimNumber,
        settlementStatus: settlement.outcome,
        cashierName: `${cashierName} (claim settlement)`.slice(0, 150),
      })
      .returning();

    if (!payment) {
      throw new Error('Payment insert returned no record');
    }

    await tx
      .update(schema.billingInvoices)
      .set({
        paidAmount: formatCents(settlement.paidAfterCents),
        balanceAmount: formatCents(settlement.balanceAfterCents),
        creditBalance: formatCents(settlement.creditCents),
        status: settlement.invoiceStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.billingInvoices.id, invoice.id));

    const [updated] = await tx
      .update(schema.insuranceClaims)
      .set({
        status: 'Settled',
        settledPaymentId: payment.id,
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.insuranceClaims.id, claim.id))
      .returning();

    return {
      claim: updated,
      payment,
      settlement,
      appliedCents,
      unappliedCents,
      facilityId: facility.id,
    };
  });
}

/* ============================================================
   READ
   ============================================================ */

export async function getClaimsScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | string | null,
) {
  const facility = await resolveFacility(context, requestedFacilityId);

  const claims = await db
    .select({
      id: schema.insuranceClaims.id,
      tenantId: schema.insuranceClaims.tenantId,
      facilityId: schema.insuranceClaims.facilityId,
      patientId: schema.insuranceClaims.patientId,
      invoiceId: schema.insuranceClaims.invoiceId,
      claimNumber: schema.insuranceClaims.claimNumber,
      payerName: schema.insuranceClaims.payerName,
      policyNumber: schema.insuranceClaims.policyNumber,
      preAuthCode: schema.insuranceClaims.preAuthCode,
      claimAmount: schema.insuranceClaims.claimAmount,
      approvedAmount: schema.insuranceClaims.approvedAmount,
      status: schema.insuranceClaims.status,
      submittedAt: schema.insuranceClaims.submittedAt,
      adjudicationNotes: schema.insuranceClaims.adjudicationNotes,
      settledPaymentId: schema.insuranceClaims.settledPaymentId,
      settledAt: schema.insuranceClaims.settledAt,
    })
    .from(schema.insuranceClaims)
    .where(eq(schema.insuranceClaims.facilityId, facility.id))
    .orderBy(desc(schema.insuranceClaims.id));

  return claims;
}

export async function getClaimItemsScoped(
  context: AuthorizationContext,
  claimIdInput: number | string,
  requestedFacilityId?: number | string | null,
) {
  const claimId = toPositiveInteger(claimIdInput);

  if (claimId === null) {
    throw new ClaimDomainError('INVALID_INPUT', 'A valid claim is required.', 400);
  }

  const facility = await resolveFacility(context, requestedFacilityId);

  const [claim] = await db
    .select({ id: schema.insuranceClaims.id })
    .from(schema.insuranceClaims)
    .where(
      and(
        eq(schema.insuranceClaims.id, claimId),
        eq(schema.insuranceClaims.facilityId, facility.id),
      ),
    )
    .limit(1);

  if (!claim) {
    throw new ClaimDomainError('CLAIM_NOT_FOUND', 'Claim not found.', 404);
  }

  return db
    .select()
    .from(schema.insuranceClaimItems)
    .where(eq(schema.insuranceClaimItems.claimId, claimId))
    .orderBy(asc(schema.insuranceClaimItems.id));
}
