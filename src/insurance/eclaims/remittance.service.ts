/**
 * JaliCare HMIS
 * SHA & Insurance Remittance Advices and Financial Reconciliation Service
 *
 * Supports FHIR R4 `PaymentNotice` (Kenya eClaims IG T-06) and authorized
 * remittance advice entry, reconciling remitted funds against SHA eClaims
 * and JaliCare invoices with decimal-safe integer-cents math and additive
 * `billing_payments` receipts (`paymentMethod: 'SHA'`).
 */

import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { matchRecordedPayerPayment, RecordedPaymentError } from '../hub/recorded-payment.ts';
import {
  defaultShaGatewayAdapter,
  type PayerGatewayAdapter,
} from '../../integrations/sha/sha.adapter.ts';
import { parseShaPaymentNotice } from '../../integrations/sha/sha.fhir.ts';
import { getFacilityPayerConfig } from './configuration.service.ts';
import {
  canTransitionEclaimStatus,
  formatCents,
  InsuranceDomainError,
  loadScopedFacility,
  parseMoneyToCents,
  recordInsuranceAuditEvent,
  requireMoneyCents,
  type EclaimStatus,
  type InsuranceActorScope,
} from './contracts.ts';

async function nextRemittanceNumber(): Promise<string> {
  const res = await db.execute(sql`SELECT nextval('sha_remittance_number_seq') AS seq`);
  const rows = (res as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.seq ?? Date.now() % 1_000_000);
  return `REM-SHA-${String(seq).padStart(6, '0')}`;
}

export async function listRemittances(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  payerCode = 'SHA',
) {
  await loadScopedFacility(scope);

  const remittances = await db
    .select()
    .from(schema.insuranceRemittances)
    .where(
      and(
        eq(schema.insuranceRemittances.tenantId, scope.tenantId),
        eq(schema.insuranceRemittances.facilityId, scope.facilityId),
        eq(schema.insuranceRemittances.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.insuranceRemittances.createdAt))
    .limit(100);

  if (remittances.length === 0) return [];

  const remIds = remittances.map((r) => r.id);
  const entries = await db
    .select({
      entry: schema.insuranceReconciliationEntries,
      claimNumber: schema.shaEclaims.claimNumber,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
    })
    .from(schema.insuranceReconciliationEntries)
    .innerJoin(
      schema.shaEclaims,
      eq(schema.shaEclaims.id, schema.insuranceReconciliationEntries.eclaimId),
    )
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingInvoices.id, schema.insuranceReconciliationEntries.invoiceId),
    )
    .where(inArray(schema.insuranceReconciliationEntries.remittanceId, remIds));

  return remittances.map((rem) => ({
    ...rem,
    entries: entries
      .filter((e) => e.entry.remittanceId === rem.id)
      .map((e) => ({
        ...e.entry,
        claimNumber: e.claimNumber,
        invoiceNumber: e.invoiceNumber,
      })),
  }));
}

export interface RecordRemittanceInput {
  payerCode?: string;
  payerRemittanceRef?: string;
  bankReference?: string | null;
  facilityIdType?: 'fr-code' | 'registration-number' | 'fid' | null;
  paymentDate?: string;
  paymentChannel?: string;
  totalRemittedAmount?: string | number;
  notes?: string | null;
  fhirPaymentNotice?: Record<string, unknown> | null;
}

export async function recordRemittanceAdvice(
  scope: InsuranceActorScope,
  input: RecordRemittanceInput,
) {
  await loadScopedFacility(scope);
  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();

  let payerRemittanceRef = input.payerRemittanceRef?.trim() || null;
  let paymentDate = input.paymentDate?.trim() || null;
  let totalAmountRaw: string | number | null = input.totalRemittedAmount ?? null;
  let source = 'MANUAL_ADVICE';
  const paymentChannel = input.paymentChannel?.trim().toUpperCase() || '';

  if (input.fhirPaymentNotice) {
    const parsed = parseShaPaymentNotice(input.fhirPaymentNotice);
    if (!parsed) {
      throw new InsuranceDomainError(
        'INVALID_PAYMENT_NOTICE',
        'Supplied FHIR PaymentNotice resource is missing required id/identifier, paymentDate, or amount.',
        400,
      );
    }
    payerRemittanceRef = payerRemittanceRef ?? parsed.payerRemittanceRef;
    paymentDate = paymentDate ?? parsed.paymentDate;
    totalAmountRaw = totalAmountRaw ?? parsed.amountKes;
    source = 'FHIR_PAYMENT_NOTICE';
  }

  if (
    !payerRemittanceRef ||
    !paymentDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
    Number.isNaN(Date.parse(`${paymentDate}T00:00:00Z`)) ||
    new Date(`${paymentDate}T00:00:00Z`).toISOString().slice(0, 10) !== paymentDate ||
    !paymentChannel
  ) {
    throw new InsuranceDomainError(
      'INVALID_REMITTANCE_FIELDS',
      'payerRemittanceRef, actual paymentDate (YYYY-MM-DD), and payment channel are required.',
      400,
    );
  }

  const totalCents = requireMoneyCents(totalAmountRaw, 'totalRemittedAmount');
  if (totalCents <= 0) {
    throw new InsuranceDomainError(
      'INVALID_REMITTANCE_AMOUNT',
      'totalRemittedAmount must be greater than zero.',
      400,
    );
  }

  const [dup] = await db
    .select({ id: schema.insuranceRemittances.id })
    .from(schema.insuranceRemittances)
    .where(
      and(
        eq(schema.insuranceRemittances.facilityId, scope.facilityId),
        eq(schema.insuranceRemittances.payerCode, payerCode),
        eq(schema.insuranceRemittances.payerRemittanceRef, payerRemittanceRef),
      ),
    )
    .limit(1);

  if (dup) {
    throw new InsuranceDomainError(
      'DUPLICATE_REMITTANCE_REF',
      `Remittance reference ${payerRemittanceRef} has already been recorded in this facility.`,
      409,
    );
  }

  const remittanceNumber = await nextRemittanceNumber();
  const formattedTotal = formatCents(totalCents);

  const [created] = await db
    .insert(schema.insuranceRemittances)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      payerCode,
      remittanceNumber,
      payerRemittanceRef,
      bankReference: input.bankReference?.trim() || null,
      facilityIdType: input.facilityIdType ?? 'fr-code',
      paymentDate,
      paymentChannel,
      totalRemittedAmount: formattedTotal,
      allocatedAmount: '0.00',
      unallocatedAmount: formattedTotal,
      status: 'RECEIVED',
      source,
      isSimulated: false,
      fhirPaymentNotice: input.fhirPaymentNotice ?? null,
      notes: input.notes?.trim() || null,
      receivedByUserId: scope.userId,
    })
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_REMITTANCE_RECORDED',
    resource: 'insurance_remittances',
    resourceId: created.id,
    summary: {
      remittanceNumber: created.remittanceNumber,
      payerRemittanceRef: created.payerRemittanceRef,
      totalRemittedAmount: created.totalRemittedAmount,
      source: created.source,
    },
  });

  return created;
}

export interface ReconcileAllocationInput {
  eclaimId: number;
  remittedAmount: string | number;
  approvedAmount?: string | number | null;
  varianceReason?: string | null;
  postToInvoice?: boolean;
  billingPaymentId?: number | null;
}

export interface ReconcileRemittanceInput {
  allocations: ReconcileAllocationInput[];
  cashierDisplayName?: string;
}

export async function reconcileRemittance(
  scope: InsuranceActorScope,
  remittanceId: number,
  input: ReconcileRemittanceInput,
) {
  await loadScopedFacility(scope);

  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new InsuranceDomainError(
      'EMPTY_RECONCILIATION_ALLOCATIONS',
      'At least one claim allocation is required to reconcile a remittance.',
      400,
    );
  }

  const [remittance] = await db
    .select()
    .from(schema.insuranceRemittances)
    .where(
      and(
        eq(schema.insuranceRemittances.id, remittanceId),
        eq(schema.insuranceRemittances.tenantId, scope.tenantId),
        eq(schema.insuranceRemittances.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!remittance) {
    throw new InsuranceDomainError('REMITTANCE_NOT_FOUND', 'Remittance advice not found.', 404);
  }

  if (remittance.status === 'RECONCILED') {
    throw new InsuranceDomainError(
      'REMITTANCE_ALREADY_RECONCILED',
      `Remittance ${remittance.remittanceNumber} is already fully reconciled.`,
      409,
    );
  }

  const totalRemittedCents = requireMoneyCents(
    remittance.totalRemittedAmount,
    'totalRemittedAmount',
  );
  const previouslyAllocatedCents = parseMoneyToCents(remittance.allocatedAmount) ?? 0;

  let batchAllocationCents = 0;
  for (const alloc of input.allocations) {
    const cents = requireMoneyCents(alloc.remittedAmount, 'remittedAmount');
    if (cents <= 0) {
      throw new InsuranceDomainError(
        'INVALID_ALLOCATION_AMOUNT',
        'Each remittedAmount allocation must be greater than zero.',
        400,
      );
    }
    batchAllocationCents += cents;
  }

  if (previouslyAllocatedCents + batchAllocationCents > totalRemittedCents) {
    throw new InsuranceDomainError(
      'ALLOCATION_EXCEEDS_REMITTANCE',
      `Total allocations (KES ${formatCents(previouslyAllocatedCents + batchAllocationCents)}) exceed remittance total (KES ${formatCents(totalRemittedCents)}).`,
      400,
    );
  }

  const result = await db.transaction(async (tx) => {
    const [lockedRemittance] = await tx
      .select()
      .from(schema.insuranceRemittances)
      .where(
        and(
          eq(schema.insuranceRemittances.id, remittance.id),
          eq(schema.insuranceRemittances.tenantId, scope.tenantId),
          eq(schema.insuranceRemittances.facilityId, scope.facilityId),
        ),
      )
      .for('update');
    if (!lockedRemittance || lockedRemittance.status === 'RECONCILED')
      throw new InsuranceDomainError(
        'REMITTANCE_ALREADY_RECONCILED',
        'Remittance has already been reconciled.',
        409,
      );
    const previouslyAllocatedCents = parseMoneyToCents(lockedRemittance.allocatedAmount) ?? 0;
    if (previouslyAllocatedCents + batchAllocationCents > totalRemittedCents)
      throw new InsuranceDomainError(
        'ALLOCATION_EXCEEDS_REMITTANCE',
        'Allocations exceed the remaining advice balance.',
        409,
      );
    const createdEntries = [];

    for (const alloc of input.allocations) {
      const [claim] = await tx
        .select()
        .from(schema.shaEclaims)
        .where(
          and(
            eq(schema.shaEclaims.id, alloc.eclaimId),
            eq(schema.shaEclaims.tenantId, scope.tenantId),
            eq(schema.shaEclaims.facilityId, scope.facilityId),
            eq(schema.shaEclaims.payerCode, remittance.payerCode),
          ),
        )
        .for('update');

      if (!claim) {
        throw new InsuranceDomainError(
          'CLAIM_NOT_IN_SCOPE',
          `Claim #${alloc.eclaimId} was not found in this facility for payer ${remittance.payerCode}.`,
          404,
        );
      }

      if (
        claim.status !== 'ACKNOWLEDGED' &&
        claim.status !== 'ADJUDICATED' &&
        claim.status !== 'PARTIALLY_ADJUDICATED' &&
        claim.status !== 'DISPUTED'
      ) {
        throw new InsuranceDomainError(
          'CLAIM_NOT_ELIGIBLE_FOR_RECONCILIATION',
          `Claim ${claim.claimNumber} is in status ${claim.status} and cannot receive remittance settlement.`,
          409,
        );
      }

      const [existingRecon] = await tx
        .select({ id: schema.insuranceReconciliationEntries.id })
        .from(schema.insuranceReconciliationEntries)
        .where(
          and(
            eq(schema.insuranceReconciliationEntries.remittanceId, remittance.id),
            eq(schema.insuranceReconciliationEntries.eclaimId, claim.id),
          ),
        )
        .limit(1);

      if (existingRecon) {
        throw new InsuranceDomainError(
          'DUPLICATE_CLAIM_ALLOCATION',
          `Claim ${claim.claimNumber} is already reconciled under remittance ${remittance.remittanceNumber}.`,
          409,
        );
      }

      const [invoice] = await tx
        .select()
        .from(schema.billingInvoices)
        .where(
          and(
            eq(schema.billingInvoices.id, claim.invoiceId),
            eq(schema.billingInvoices.facilityId, scope.facilityId),
            eq(schema.billingInvoices.tenantId, scope.tenantId),
          ),
        )
        .limit(1);

      if (!invoice) {
        throw new InsuranceDomainError(
          'INVOICE_NOT_FOUND',
          `Linked invoice #${claim.invoiceId} was not found.`,
          404,
        );
      }

      const claimedCents = parseMoneyToCents(claim.totalClaimedAmount) ?? 0;
      const remittedCents = requireMoneyCents(alloc.remittedAmount, 'remittedAmount');
      const approvedCents =
        alloc.approvedAmount !== undefined &&
        alloc.approvedAmount !== null &&
        alloc.approvedAmount !== ''
          ? requireMoneyCents(alloc.approvedAmount, 'approvedAmount')
          : (parseMoneyToCents(claim.totalApprovedAmount) ?? 0) > 0
            ? (parseMoneyToCents(claim.totalApprovedAmount) ?? remittedCents)
            : 0;

      const varianceCents = claimedCents - remittedCents;
      const reconciliationStatus =
        varianceCents === 0 ? 'MATCHED' : varianceCents > 0 ? 'SHORTFALL' : 'OVERPAYMENT';

      let postedPaymentId: number | null = null;
      let appliedCents = 0;

      if (alloc.postToInvoice === true)
        throw new InsuranceDomainError(
          'AUTOMATIC_POSTING_DISABLED',
          'Record the receipt through billing first, then match its ID. Reconciliation never posts payments.',
          409,
        );
      if (alloc.billingPaymentId !== undefined && alloc.billingPaymentId !== null) {
        if (remittance.isSimulated || claim.isSimulated)
          throw new InsuranceDomainError(
            'SIMULATED_REMITTANCE',
            'Simulated claims or advice cannot be matched to a real payment.',
            409,
          );
        try {
          const payment = await matchRecordedPayerPayment(tx, {
            paymentId: alloc.billingPaymentId,
            invoiceId: invoice.id,
            payerCode: remittance.payerCode,
            remittanceReference: remittance.payerRemittanceRef,
            bankReference: remittance.bankReference,
            amountCents: remittedCents,
          });
          postedPaymentId = payment.id;
          appliedCents = remittedCents;
        } catch (error) {
          if (error instanceof RecordedPaymentError)
            throw new InsuranceDomainError(error.code, error.message, 409);
          throw error;
        }
      }

      const [reconEntry] = await tx
        .insert(schema.insuranceReconciliationEntries)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          remittanceId: remittance.id,
          eclaimId: claim.id,
          invoiceId: invoice.id,
          claimedAmount: formatCents(claimedCents),
          approvedAmount: formatCents(approvedCents),
          remittedAmount: formatCents(remittedCents),
          appliedToInvoiceAmount: formatCents(appliedCents),
          varianceAmount: formatCents(varianceCents),
          varianceReason: alloc.varianceReason?.trim() || null,
          reconciliationStatus,
          postedPaymentId,
          reconciledByUserId: scope.userId,
        })
        .returning();

      createdEntries.push(reconEntry);

      // A remittance advice is not itself a payer decision or a cash receipt.
      if (postedPaymentId !== null) {
        const priorClaimPaidCents = parseMoneyToCents(claim.totalPaidAmount) ?? 0;
        const newClaimPaidCents = priorClaimPaidCents + appliedCents;
        const recordedApproval = parseMoneyToCents(claim.totalApprovedAmount) ?? 0;
        const targetClaimStatus: EclaimStatus =
          recordedApproval > 0 &&
          newClaimPaidCents >= recordedApproval &&
          ['ADJUDICATED', 'PARTIALLY_ADJUDICATED'].includes(claim.status) &&
          canTransitionEclaimStatus(claim.status, 'PAID')
            ? 'PAID'
            : (claim.status as EclaimStatus);
        await tx
          .update(schema.shaEclaims)
          .set({
            totalPaidAmount: formatCents(newClaimPaidCents),
            settledPaymentId: postedPaymentId,
            status: targetClaimStatus,
            paidAt: targetClaimStatus === 'PAID' ? new Date() : claim.paidAt,
            updatedAt: new Date(),
          })
          .where(eq(schema.shaEclaims.id, claim.id));
        if (targetClaimStatus !== claim.status)
          await tx.insert(schema.shaEclaimStatusHistory).values({
            eclaimId: claim.id,
            fromStatus: claim.status,
            toStatus: targetClaimStatus,
            source: 'REMITTANCE_RECONCILIATION',
            actorUserId: scope.userId,
            reason: 'Matched an existing billing receipt to remittance advice.',
            metadata: { remittanceId: remittance.id, postedPaymentId },
          });
      }
    }

    const nextAllocatedCents = previouslyAllocatedCents + batchAllocationCents;
    const nextUnallocatedCents = Math.max(0, totalRemittedCents - nextAllocatedCents);
    const nextRemStatus = nextUnallocatedCents === 0 ? 'RECONCILED' : 'PARTIALLY_RECONCILED';

    const [updatedRemittance] = await tx
      .update(schema.insuranceRemittances)
      .set({
        allocatedAmount: formatCents(nextAllocatedCents),
        unallocatedAmount: formatCents(nextUnallocatedCents),
        status: nextRemStatus,
        reconciledByUserId: scope.userId,
        reconciledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.insuranceRemittances.id, remittance.id))
      .returning();

    return { remittance: updatedRemittance, entries: createdEntries };
  });

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_REMITTANCE_RECONCILED',
    resource: 'insurance_remittances',
    resourceId: remittance.id,
    summary: {
      remittanceNumber: remittance.remittanceNumber,
      status: result.remittance.status,
      allocatedAmount: result.remittance.allocatedAmount,
      unallocatedAmount: result.remittance.unallocatedAmount,
      reconciledClaimsCount: result.entries.length,
    },
  });

  return result;
}

/**
 * Workflow 9a (Step 1 of DHA HIE Remittances): Fetches facility remittances
 * (`GET /remittances`) and imports new `bank_reference` advices idempotently.
 */
export async function syncFacilityHieRemittances(
  scope: InsuranceActorScope,
  options?: {
    fromDate?: string | null;
    toDate?: string | null;
    facilityIdType?: 'fr-code' | 'registration-number' | 'fid';
  },
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, 'SHA');

  if (!adapter.fetchFacilityRemittances) {
    throw new InsuranceDomainError(
      'CAPABILITY_UNAVAILABLE',
      'Configured SHA gateway adapter does not support DHA HIE facility remittances sync.',
      501,
    );
  }

  const facilityIdType = options?.facilityIdType ?? 'fr-code';
  const gatewayRes = await adapter.fetchFacilityRemittances({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: payerConfig.facilityRegistryCode,
    fromDate: options?.fromDate ?? null,
    toDate: options?.toDate ?? null,
  });

  if (!gatewayRes.reachable) {
    throw new InsuranceDomainError(
      'SHA_REMITTANCES_UNAVAILABLE',
      gatewayRes.errorMessage ?? 'DHA HIE Remittances endpoint could not be reached.',
      502,
      { correlationId: gatewayRes.correlationId },
    );
  }

  const imported = [];
  for (const adv of gatewayRes.remittances) {
    const [existing] = await db
      .select()
      .from(schema.insuranceRemittances)
      .where(
        and(
          eq(schema.insuranceRemittances.facilityId, scope.facilityId),
          eq(schema.insuranceRemittances.payerCode, 'SHA'),
          eq(schema.insuranceRemittances.payerRemittanceRef, adv.remittanceReference),
        ),
      )
      .limit(1);

    if (existing) continue;

    const remNum = await nextRemittanceNumber();
    const [created] = await db
      .insert(schema.insuranceRemittances)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        payerCode: 'SHA',
        remittanceNumber: remNum,
        payerRemittanceRef: adv.remittanceReference,
        bankReference: adv.bankReference,
        facilityIdType,
        paymentDate: adv.paymentDate,
        paymentChannel: adv.paymentChannel || 'EFT',
        totalRemittedAmount: adv.totalAmountKes,
        allocatedAmount: '0.00',
        unallocatedAmount: adv.totalAmountKes,
        status: 'RECEIVED',
        source: gatewayRes.isSimulated ? 'SANDBOX_SIMULATION' : 'DHA_HIE_REMITTANCE_API',
        isSimulated: gatewayRes.isSimulated,
        notes: `Synced via DHA HIE Get Remittances (bank_reference: ${adv.bankReference}, claimCount: ${adv.claimCount ?? 0})`,
        receivedByUserId: scope.userId,
      })
      .returning();
    imported.push(created);
  }

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_HIE_REMITTANCES_SYNCED',
    resource: 'insurance_remittances',
    resourceId: scope.facilityId,
    summary: {
      fetchedCount: gatewayRes.remittances.length,
      importedCount: imported.length,
      isSimulated: gatewayRes.isSimulated,
      correlationId: gatewayRes.correlationId,
    },
  });

  return {
    imported,
    fetchedCount: gatewayRes.remittances.length,
    isSimulated: gatewayRes.isSimulated,
    correlationId: gatewayRes.correlationId,
  };
}

/**
 * Workflow 9b (Step 2 of DHA HIE Remittances): Calls `Get Claims Paid by Remittance`
 * using the remittance's `bank_reference` and matches lines to local JaliCare SHA eClaims.
 */
export async function fetchRemittanceClaimBreakdown(
  scope: InsuranceActorScope,
  remittanceId: number,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const [remittance] = await db
    .select()
    .from(schema.insuranceRemittances)
    .where(
      and(
        eq(schema.insuranceRemittances.id, remittanceId),
        eq(schema.insuranceRemittances.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!remittance) {
    throw new InsuranceDomainError('REMITTANCE_NOT_FOUND', 'Remittance advice not found.', 404);
  }

  const bankReference = remittance.bankReference || remittance.payerRemittanceRef;
  if (!adapter.fetchClaimsPaidByRemittance) {
    throw new InsuranceDomainError(
      'CAPABILITY_UNAVAILABLE',
      'Configured SHA gateway adapter does not implement Get Claims Paid by Remittance.',
      501,
    );
  }

  const { config: payerConfig } = await getFacilityPayerConfig(scope, remittance.payerCode);
  const res = await adapter.fetchClaimsPaidByRemittance({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: payerConfig.facilityRegistryCode,
    bankReference,
  });

  const facilityClaims = await db
    .select()
    .from(schema.shaEclaims)
    .where(eq(schema.shaEclaims.facilityId, scope.facilityId));

  const matchedClaims = res.claims.map((paidLine) => {
    const localMatch =
      facilityClaims.find(
        (c) =>
          c.payerClaimReference === paidLine.payerClaimReference ||
          c.claimNumber === paidLine.claimNumber ||
          c.claimUuid === paidLine.payerClaimReference,
      ) ?? null;

    return {
      ...paidLine,
      matchedLocalEclaimId: localMatch?.id ?? null,
      matchedLocalClaimNumber: localMatch?.claimNumber ?? null,
      matchedLocalStatus: localMatch?.status ?? null,
    };
  });

  return {
    remittanceId: remittance.id,
    bankReference,
    reachable: res.reachable,
    isSimulated: res.isSimulated,
    correlationId: res.correlationId,
    claims: matchedClaims,
  };
}

/**
 * Workflow 10: Operational Reporting & IHE ATNA-Aligned Audit Trail Summary
 * across all 10 SHA workflows for the active facility.
 */
export async function getShaOperationalReport(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  const facility = await loadScopedFacility(scope);

  const [eligibilities, authorizations, preauths, claims, remittances, callbacks, auditRows] =
    await Promise.all([
      db
        .select()
        .from(schema.insuranceEligibilityVerifications)
        .where(
          and(
            eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
            eq(schema.insuranceEligibilityVerifications.payerCode, 'SHA'),
          ),
        ),
      db
        .select()
        .from(schema.shaPatientAuthorizations)
        .where(eq(schema.shaPatientAuthorizations.facilityId, scope.facilityId)),
      db
        .select()
        .from(schema.insurancePreauthorizations)
        .where(
          and(
            eq(schema.insurancePreauthorizations.facilityId, scope.facilityId),
            eq(schema.insurancePreauthorizations.payerCode, 'SHA'),
          ),
        ),
      db
        .select()
        .from(schema.shaEclaims)
        .where(
          and(
            eq(schema.shaEclaims.facilityId, scope.facilityId),
            eq(schema.shaEclaims.payerCode, 'SHA'),
          ),
        ),
      db
        .select()
        .from(schema.insuranceRemittances)
        .where(
          and(
            eq(schema.insuranceRemittances.facilityId, scope.facilityId),
            eq(schema.insuranceRemittances.payerCode, 'SHA'),
          ),
        ),
      db
        .select()
        .from(schema.shaCallbackEvents)
        .where(eq(schema.shaCallbackEvents.facilityId, scope.facilityId))
        .orderBy(desc(schema.shaCallbackEvents.receivedAt))
        .limit(25),
      db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.facilityId, scope.facilityId),
            like(schema.auditLogs.action, 'SHA_%'),
          ),
        )
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(50),
    ]);

  let totalBilledCents = 0;
  let totalClaimedCents = 0;
  let totalApprovedCents = 0;
  let totalPaidCents = 0;
  const claimsByStatus: Record<string, number> = {};

  for (const clm of claims) {
    claimsByStatus[clm.status] = (claimsByStatus[clm.status] ?? 0) + 1;
    totalBilledCents += parseMoneyToCents(clm.totalBilledAmount) ?? 0;
    totalClaimedCents += parseMoneyToCents(clm.totalClaimedAmount) ?? 0;
    totalApprovedCents += parseMoneyToCents(clm.totalApprovedAmount) ?? 0;
    totalPaidCents += parseMoneyToCents(clm.totalPaidAmount) ?? 0;
  }

  let totalRemittedCents = 0;
  let totalUnallocatedCents = 0;
  for (const rem of remittances) {
    totalRemittedCents += parseMoneyToCents(rem.totalRemittedAmount) ?? 0;
    totalUnallocatedCents += parseMoneyToCents(rem.unallocatedAmount) ?? 0;
  }

  // Format recent SHA audit logs into IHE ATNA (RFC 3881 / DICOM AuditMessage) aligned descriptors
  const atnaAuditTrail = auditRows.map((row) => ({
    eventId: row.id,
    eventActionCode: row.action.includes('CREATED') || row.action.includes('PREPARED') ? 'C' : 'U',
    eventDateTime: row.timestamp.toISOString(),
    eventOutcomeIndicator: '0',
    eventTypeCode: row.action,
    activeParticipantUserId: row.userId ? `User/${row.userId}` : 'System/Webhook',
    auditSourceId: facility.mflCode || facility.code,
    participantObjectTypeCode: '2',
    participantObjectId: `${row.resource}/${row.resourceId ?? 'facility'}`,
    details: row.details,
  }));

  return {
    facility: {
      id: facility.id,
      name: facility.name,
      code: facility.code,
      mflCode: facility.mflCode,
    },
    gatewayStatus: adapter.getConnectionStatus(),
    metrics: {
      eligibilityChecksTotal: eligibilities.length,
      eligibleCount: eligibilities.filter((e) => e.outcome === 'Eligible').length,
      ineligibleCount: eligibilities.filter((e) => e.outcome === 'Ineligible').length,
      deceasedBlockedCount: eligibilities.filter((e) => e.isAlive === false).length,
      unableToVerifyCount: eligibilities.filter((e) => e.outcome === 'Unable to verify').length,
      visitAuthorizationsTotal: authorizations.length,
      electivePendingVisitCount: authorizations.filter(
        (a) => a.authStatus === 'AUTHORIZED_PENDING_VISIT',
      ).length,
      preauthorizationsTotal: preauths.length,
      preauthApprovedCount: preauths.filter(
        (p) => p.status === 'APPROVED' || p.status === 'PARTIALLY_APPROVED',
      ).length,
      claimsTotal: claims.length,
      claimsByStatus,
      financialsKes: {
        totalBilled: formatCents(totalBilledCents),
        totalClaimed: formatCents(totalClaimedCents),
        totalApproved: formatCents(totalApprovedCents),
        totalPaid: formatCents(totalPaidCents),
        totalRemitted: formatCents(totalRemittedCents),
        unallocatedRemittance: formatCents(totalUnallocatedCents),
      },
      callbacksReceivedCount: callbacks.length,
    },
    recentCallbacks: callbacks,
    atnaAuditTrail,
  };
}
