/**
 * JaliCare HMIS — Private Insurance Remittance Import, Reconciliation & Dashboard KPIs
 *
 * Imports insurer remittance advices (Britam, PACIS, etc.) and reconciles
 * remitted amounts against `private_insurance_claims` and `billing_invoices`
 * inside a database transaction using decimal-safe cents arithmetic.
 *
 * Posts additive `billing_payments` receipts via `classifySettlement` so
 * original invoice lines and gross totals are never mutated.
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { classifySettlement, formatCents, parseMoneyToCents } from '../../billing/settlement.ts';
import { moneyToCentsStrict, PrivateInsuranceError } from '../core/types.ts';
import { recordPrivateInsuranceAudit } from '../audit/diagnostics.service.ts';
import { getPayerRowScoped, listPrivatePayers } from '../payers/payer-config.service.ts';

async function nextPrivateRemittanceNumber(payerCode: string): Promise<string> {
  const res = await db.execute(
    sql`SELECT nextval('private_insurance_remittance_number_seq') AS seq`,
  );
  const rows = (res as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.seq ?? Date.now() % 100000);
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `REM-${payerCode}-${datePart}-${String(seq).padStart(5, '0')}`;
}

export async function listPrivateRemittances(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  status?: string;
}) {
  const conditions = [
    eq(schema.insuranceRemittances.tenantId, params.tenantId),
    eq(schema.insuranceRemittances.facilityId, params.facilityId),
  ];

  if (params.payerCode) {
    conditions.push(
      eq(schema.insuranceRemittances.payerCode, params.payerCode.trim().toUpperCase()),
    );
  } else {
    conditions.push(ne(schema.insuranceRemittances.payerCode, 'SHA'));
  }

  if (params.status) {
    conditions.push(eq(schema.insuranceRemittances.status, params.status.trim().toUpperCase()));
  }

  return db
    .select()
    .from(schema.insuranceRemittances)
    .where(and(...conditions))
    .orderBy(desc(schema.insuranceRemittances.createdAt))
    .limit(100);
}

export async function importPrivateRemittance(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const payerCode = String(params.input.payerCode ?? '')
    .trim()
    .toUpperCase();
  if (!payerCode) {
    throw new PrivateInsuranceError('PAYER_CODE_REQUIRED', 'payerCode is required.', 400);
  }
  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode,
  });

  const payerRemittanceRef = String(params.input.payerRemittanceRef ?? '').trim();
  if (!payerRemittanceRef || payerRemittanceRef.length < 3) {
    throw new PrivateInsuranceError(
      'REMITTANCE_REF_REQUIRED',
      'Insurer remittance advice / EFT reference (payerRemittanceRef) is required.',
      400,
    );
  }

  const totalCents = moneyToCentsStrict(
    params.input.totalRemittedAmount as string | number,
    'Total remitted amount',
  );
  if (totalCents <= 0) {
    throw new PrivateInsuranceError(
      'INVALID_REMITTED_AMOUNT',
      'totalRemittedAmount must be greater than KES 0.00.',
      400,
    );
  }

  const [dup] = await db
    .select({ id: schema.insuranceRemittances.id })
    .from(schema.insuranceRemittances)
    .where(
      and(
        eq(schema.insuranceRemittances.facilityId, params.facilityId),
        eq(schema.insuranceRemittances.payerCode, payerRow.payerCode),
        eq(schema.insuranceRemittances.payerRemittanceRef, payerRemittanceRef),
      ),
    )
    .limit(1);

  if (dup) {
    throw new PrivateInsuranceError(
      'DUPLICATE_REMITTANCE_REF',
      `Remittance reference "${payerRemittanceRef}" is already recorded for ${payerRow.payerName}.`,
      409,
    );
  }

  const paymentDate =
    typeof params.input.paymentDate === 'string' && params.input.paymentDate.trim()
      ? params.input.paymentDate.trim()
      : new Date().toISOString().slice(0, 10);

  const remittanceNumber = await nextPrivateRemittanceNumber(payerRow.payerCode);
  const formattedTotal = formatCents(totalCents);

  const [created] = await db
    .insert(schema.insuranceRemittances)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode: payerRow.payerCode,
      remittanceNumber,
      payerRemittanceRef,
      paymentDate,
      paymentChannel: String(params.input.paymentChannel ?? 'EFT')
        .trim()
        .toUpperCase(),
      totalRemittedAmount: formattedTotal,
      allocatedAmount: '0.00',
      unallocatedAmount: formattedTotal,
      status: 'RECEIVED',
      source: String(params.input.source ?? 'REMITTANCE_IMPORT')
        .trim()
        .toUpperCase(),
      isSimulated: false,
      notes: typeof params.input.notes === 'string' ? params.input.notes : null,
      receivedByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_REMITTANCE_IMPORTED',
    entityType: 'insurance_remittance',
    entityId: created.id,
    details: {
      payerCode: created.payerCode,
      remittanceNumber: created.remittanceNumber,
      payerRemittanceRef: created.payerRemittanceRef,
      totalRemittedAmount: created.totalRemittedAmount,
    },
  });

  return created;
}

export async function reconcilePrivateRemittance(params: {
  tenantId: number;
  facilityId: number;
  remittanceId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  actorDisplayName?: string;
  input: Record<string, unknown>;
}) {
  const allocations = Array.isArray(params.input.allocations)
    ? (params.input.allocations as Array<Record<string, unknown>>)
    : [];

  if (allocations.length === 0) {
    throw new PrivateInsuranceError(
      'EMPTY_RECONCILIATION_ALLOCATIONS',
      'Provide at least one claim allocation to reconcile.',
      400,
    );
  }

  const [remittance] = await db
    .select()
    .from(schema.insuranceRemittances)
    .where(
      and(
        eq(schema.insuranceRemittances.id, params.remittanceId),
        eq(schema.insuranceRemittances.tenantId, params.tenantId),
        eq(schema.insuranceRemittances.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!remittance) {
    throw new PrivateInsuranceError('REMITTANCE_NOT_FOUND', 'Remittance advice not found.', 404);
  }

  if (remittance.status === 'RECONCILED') {
    throw new PrivateInsuranceError(
      'REMITTANCE_ALREADY_RECONCILED',
      `Remittance ${remittance.remittanceNumber} is already fully reconciled.`,
      409,
    );
  }

  const totalRemittedCents = parseMoneyToCents(remittance.totalRemittedAmount) ?? 0;
  const priorAllocatedCents = parseMoneyToCents(remittance.allocatedAmount) ?? 0;
  let batchAllocatedCents = 0;

  for (const a of allocations) {
    const c = moneyToCentsStrict(a.remittedAmount as string | number, 'Allocated remitted amount');
    if (c <= 0) {
      throw new PrivateInsuranceError(
        'INVALID_ALLOCATION_AMOUNT',
        'Each allocation remittedAmount must be greater than KES 0.00.',
        400,
      );
    }
    batchAllocatedCents += c;
  }

  if (priorAllocatedCents + batchAllocatedCents > totalRemittedCents) {
    throw new PrivateInsuranceError(
      'ALLOCATION_EXCEEDS_REMITTANCE',
      `Total allocations (${formatCents(priorAllocatedCents + batchAllocatedCents)}) exceed remittance total (${remittance.totalRemittedAmount}).`,
      400,
    );
  }

  const result = await db.transaction(async (tx) => {
    const createdAllocations = [];

    for (const alloc of allocations) {
      const claimId = Number(alloc.claimId);
      const [claim] = await tx
        .select()
        .from(schema.privateInsuranceClaims)
        .where(
          and(
            eq(schema.privateInsuranceClaims.id, claimId),
            eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
            eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
            eq(schema.privateInsuranceClaims.payerCode, remittance.payerCode),
          ),
        )
        .limit(1);

      if (!claim) {
        throw new PrivateInsuranceError(
          'CLAIM_NOT_IN_SCOPE',
          `Claim #${claimId} not found in this facility for ${remittance.payerCode}.`,
          404,
        );
      }

      if (
        !['SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_ADJUDICATED', 'ADJUDICATED', 'DISPUTED'].includes(
          claim.status,
        )
      ) {
        throw new PrivateInsuranceError(
          'CLAIM_NOT_RECONCILABLE',
          `Claim ${claim.claimNumber} is in status ${claim.status} and cannot receive remittance settlement.`,
          409,
        );
      }

      const [existingAlloc] = await tx
        .select({ id: schema.privateInsuranceRemittanceAllocations.id })
        .from(schema.privateInsuranceRemittanceAllocations)
        .where(
          and(
            eq(schema.privateInsuranceRemittanceAllocations.remittanceId, remittance.id),
            eq(schema.privateInsuranceRemittanceAllocations.claimId, claim.id),
          ),
        )
        .limit(1);

      if (existingAlloc) {
        throw new PrivateInsuranceError(
          'DUPLICATE_CLAIM_ALLOCATION',
          `Claim ${claim.claimNumber} is already allocated on remittance ${remittance.remittanceNumber}.`,
          409,
        );
      }

      const [invoice] = await tx
        .select()
        .from(schema.billingInvoices)
        .where(
          and(
            eq(schema.billingInvoices.id, claim.invoiceId),
            eq(schema.billingInvoices.facilityId, params.facilityId),
          ),
        )
        .limit(1);

      if (!invoice) {
        throw new PrivateInsuranceError(
          'INVOICE_NOT_FOUND',
          'Linked JaliCare invoice not found.',
          404,
        );
      }

      const claimedCents = parseMoneyToCents(claim.proposedClaimAmount) ?? 0;
      const remittedCents = moneyToCentsStrict(
        alloc.remittedAmount as string | number,
        'Allocated remitted amount',
      );
      const approvedCents =
        alloc.approvedAmount !== undefined &&
        alloc.approvedAmount !== null &&
        alloc.approvedAmount !== ''
          ? moneyToCentsStrict(alloc.approvedAmount as string | number, 'Approved amount')
          : (parseMoneyToCents(claim.approvedAmount) ?? 0) > 0
            ? (parseMoneyToCents(claim.approvedAmount) ?? remittedCents)
            : remittedCents;

      const varianceCents = claimedCents - remittedCents;
      const reconciliationStatus =
        varianceCents === 0 ? 'MATCHED' : varianceCents > 0 ? 'SHORTFALL' : 'OVERPAYMENT';

      let postedPaymentId: number | null = null;
      let appliedCents = 0;

      if (alloc.postToInvoice !== false && remittedCents > 0) {
        const invoiceTotalCents = parseMoneyToCents(invoice.totalAmount) ?? 0;
        const paidBeforeCents = parseMoneyToCents(invoice.paidAmount) ?? 0;
        const priorCreditCents = parseMoneyToCents(invoice.creditBalance) ?? 0;

        const settlement = classifySettlement({
          invoiceTotalCents,
          paidBeforeCents,
          amountCents: remittedCents,
        });

        const receiptNumber = `RCPT-${remittance.payerCode}-${remittance.id}-${claim.id}`;
        const [payment] = await tx
          .insert(schema.billingPayments)
          .values({
            invoiceId: invoice.id,
            receiptNumber,
            paymentMethod: `Insurance - ${remittance.payerCode}`,
            amount: formatCents(remittedCents),
            referenceCode: remittance.payerRemittanceRef,
            transactionCode: claim.externalClaimReference ?? claim.claimNumber,
            settlementStatus: settlement.outcome,
            cashierName:
              params.actorDisplayName ?? `Insurance Reconciliation (${remittance.payerCode})`,
          })
          .returning();

        postedPaymentId = payment.id;
        appliedCents = remittedCents;

        // Additive settlement balance update ONLY — original invoice totalAmount & lines remain intact!
        await tx
          .update(schema.billingInvoices)
          .set({
            paidAmount: formatCents(settlement.paidAfterCents),
            balanceAmount: formatCents(settlement.balanceAfterCents),
            creditBalance: formatCents(Math.max(priorCreditCents, settlement.creditCents)),
            status: settlement.invoiceStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.billingInvoices.id, invoice.id));
      }

      const [allocRow] = await tx
        .insert(schema.privateInsuranceRemittanceAllocations)
        .values({
          tenantId: params.tenantId,
          facilityId: params.facilityId,
          remittanceId: remittance.id,
          claimId: claim.id,
          invoiceId: invoice.id,
          payerCode: remittance.payerCode,
          claimedAmount: formatCents(claimedCents),
          approvedAmount: formatCents(approvedCents),
          remittedAmount: formatCents(remittedCents),
          appliedToInvoiceAmount: formatCents(appliedCents),
          varianceAmount: formatCents(varianceCents),
          varianceReason:
            typeof alloc.varianceReason === 'string' && alloc.varianceReason.trim()
              ? alloc.varianceReason.trim()
              : null,
          reconciliationStatus,
          postedPaymentId,
          reconciledByUserId: params.actorUserId,
        })
        .returning();

      createdAllocations.push(allocRow);

      const priorClaimPaidCents = parseMoneyToCents(claim.paidAmount) ?? 0;
      const newClaimPaidCents = priorClaimPaidCents + remittedCents;
      const nextClaimStatus = newClaimPaidCents >= approvedCents ? 'PAID' : 'PARTIALLY_ADJUDICATED';

      await tx
        .update(schema.privateInsuranceClaims)
        .set({
          approvedAmount: formatCents(approvedCents),
          paidAmount: formatCents(newClaimPaidCents),
          status: nextClaimStatus,
          settledPaymentId: postedPaymentId ?? claim.settledPaymentId,
          paidAt: nextClaimStatus === 'PAID' ? new Date() : claim.paidAt,
          adjudicatedAt: claim.adjudicatedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.privateInsuranceClaims.id, claim.id));

      await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
        claimId: claim.id,
        fromStatus: claim.status,
        toStatus: nextClaimStatus,
        source: 'REMITTANCE_RECONCILIATION',
        actorUserId: params.actorUserId,
        reason: `Reconciled KES ${formatCents(remittedCents)} under remittance ${remittance.remittanceNumber} (${reconciliationStatus}).`,
        metadata: { remittanceId: remittance.id, postedPaymentId },
      });
    }

    const updatedAllocatedCents = priorAllocatedCents + batchAllocatedCents;
    const updatedUnallocatedCents = Math.max(0, totalRemittedCents - updatedAllocatedCents);
    const updatedRemittanceStatus =
      updatedUnallocatedCents === 0 ? 'RECONCILED' : 'PARTIALLY_RECONCILED';

    const [updatedRemittance] = await tx
      .update(schema.insuranceRemittances)
      .set({
        allocatedAmount: formatCents(updatedAllocatedCents),
        unallocatedAmount: formatCents(updatedUnallocatedCents),
        status: updatedRemittanceStatus,
        reconciledByUserId: params.actorUserId,
        reconciledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.insuranceRemittances.id, remittance.id))
      .returning();

    return { remittance: updatedRemittance, allocations: createdAllocations };
  });

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_REMITTANCE_RECONCILED',
    entityType: 'insurance_remittance',
    entityId: remittance.id,
    details: {
      payerCode: remittance.payerCode,
      remittanceNumber: remittance.remittanceNumber,
      status: result.remittance.status,
      allocationsCount: result.allocations.length,
    },
  });

  return result;
}

export async function getPrivateReconciliationRegister(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
}) {
  const conditions = [
    eq(schema.privateInsuranceRemittanceAllocations.tenantId, params.tenantId),
    eq(schema.privateInsuranceRemittanceAllocations.facilityId, params.facilityId),
  ];
  if (params.payerCode) {
    conditions.push(
      eq(
        schema.privateInsuranceRemittanceAllocations.payerCode,
        params.payerCode.trim().toUpperCase(),
      ),
    );
  }

  const rows = await db
    .select({
      allocation: schema.privateInsuranceRemittanceAllocations,
      claimNumber: schema.privateInsuranceClaims.claimNumber,
      claimStatus: schema.privateInsuranceClaims.status,
      remittanceNumber: schema.insuranceRemittances.remittanceNumber,
      payerRemittanceRef: schema.insuranceRemittances.payerRemittanceRef,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      invoiceBalance: schema.billingInvoices.balanceAmount,
    })
    .from(schema.privateInsuranceRemittanceAllocations)
    .innerJoin(
      schema.privateInsuranceClaims,
      eq(schema.privateInsuranceClaims.id, schema.privateInsuranceRemittanceAllocations.claimId),
    )
    .innerJoin(
      schema.insuranceRemittances,
      eq(schema.insuranceRemittances.id, schema.privateInsuranceRemittanceAllocations.remittanceId),
    )
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingInvoices.id, schema.privateInsuranceRemittanceAllocations.invoiceId),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.privateInsuranceRemittanceAllocations.reconciledAt))
    .limit(200);

  let totalClaimedCents = 0;
  let totalRemittedCents = 0;
  let totalVarianceCents = 0;
  for (const r of rows) {
    totalClaimedCents += parseMoneyToCents(r.allocation.claimedAmount) ?? 0;
    totalRemittedCents += parseMoneyToCents(r.allocation.remittedAmount) ?? 0;
    totalVarianceCents += parseMoneyToCents(r.allocation.varianceAmount) ?? 0;
  }

  return {
    summary: {
      entriesCount: rows.length,
      totalClaimedAmount: formatCents(totalClaimedCents),
      totalRemittedAmount: formatCents(totalRemittedCents),
      totalVarianceAmount: formatCents(totalVarianceCents),
    },
    entries: rows.map((r) => ({
      ...r.allocation,
      claimNumber: r.claimNumber,
      claimStatus: r.claimStatus,
      remittanceNumber: r.remittanceNumber,
      payerRemittanceRef: r.payerRemittanceRef,
      invoiceNumber: r.invoiceNumber,
      invoiceBalance: r.invoiceBalance,
    })),
  };
}

export async function getPrivateInsuranceDashboardSummary(params: {
  tenantId: number;
  facilityId: number;
}) {
  const payers = await listPrivatePayers({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
  });

  const [members, claims, preauths, remittances] = await Promise.all([
    db
      .select()
      .from(schema.insuranceMemberPolicies)
      .where(
        and(
          eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
          eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
        ),
      ),
    db
      .select()
      .from(schema.privateInsuranceClaims)
      .where(
        and(
          eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
          eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
        ),
      ),
    db
      .select()
      .from(schema.insurancePreauthorizations)
      .where(
        and(
          eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
          eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
          ne(schema.insurancePreauthorizations.payerCode, 'SHA'),
        ),
      ),
    db
      .select()
      .from(schema.insuranceRemittances)
      .where(
        and(
          eq(schema.insuranceRemittances.tenantId, params.tenantId),
          eq(schema.insuranceRemittances.facilityId, params.facilityId),
          ne(schema.insuranceRemittances.payerCode, 'SHA'),
        ),
      ),
  ]);

  let totalClaimedCents = 0;
  let totalPaidCents = 0;
  let rejectedCount = 0;
  let pendingSubmissionCount = 0;

  for (const c of claims) {
    if (c.status !== 'CANCELLED') {
      totalClaimedCents += parseMoneyToCents(c.proposedClaimAmount) ?? 0;
      totalPaidCents += parseMoneyToCents(c.paidAmount) ?? 0;
    }
    if (c.status === 'REJECTED') rejectedCount += 1;
    if (c.status === 'DRAFT' || c.status === 'READY' || c.status === 'VALIDATION_FAILED') {
      pendingSubmissionCount += 1;
    }
  }

  return {
    payers,
    kpis: {
      configuredPayersCount: payers.length,
      activeMembersCount: members.filter((m) => m.status === 'ACTIVE').length,
      pendingPreauthsCount: preauths.filter(
        (p) => p.status === 'DRAFT' || p.status === 'REQUESTED' || p.status === 'PENDING',
      ).length,
      totalClaimsCount: claims.length,
      pendingSubmissionCount,
      rejectedClaimsCount: rejectedCount,
      totalProposedClaimAmount: formatCents(totalClaimedCents),
      totalReconciledPaidAmount: formatCents(totalPaidCents),
      unreconciledRemittancesCount: remittances.filter((r) => r.status !== 'RECONCILED').length,
    },
  };
}
