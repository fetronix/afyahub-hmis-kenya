import { readInvoicePaymentLedger } from '../../billing/payment-ledger.ts';
import {
  lockMutableClaim,
  reserveClaimDispatch,
  releaseClaimDispatch,
  markClaimDispatchUncertain,
} from './claim-dispatch-guard.ts';
/**
 * JaliCare HMIS — Private Insurance Claim Generation, Validation, Submission & Lifecycle
 *
 * Generates multi-insurer claims (Britam, PACIS, etc.) directly from existing
 * JaliCare invoices, invoice lines, encounters, diagnoses, lab/pharmacy/procedure
 * records, member policies, and preauthorizations WITHOUT altering original
 * JaliCare invoices or marking them paid.
 */

import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { formatCents, parseMoneyToCents } from '../../billing/settlement.ts';
import { getPayerAdapter, inspectSecretEnvPresence } from '../core/adapter-registry.ts';
import {
  canTransitionPrivateClaimStatus,
  computeBenefitFinancialsCents,
  inferPrivateServiceCategory,
  moneyToCentsStrict,
  PrivateInsuranceError,
  type PayerClaimRequirements,
  type PayerPreauthRequirements,
  type PrivateClaimStatus,
} from '../core/types.ts';
import {
  recordIntegrationDiagnostic,
  recordPrivateInsuranceAudit,
} from '../audit/diagnostics.service.ts';
import { isEffectiveOnDate } from '../mappings/mappings.service.ts';
import { getPayerRowScoped, toPayerRuntimeConfig } from '../payers/payer-config.service.ts';

export interface PrivateClaimValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  field?: string;
  message: string;
}

export interface PrivateClaimValidationInput {
  payerCode: string;
  memberStatus: string;
  memberNumber: string | null;
  policyNumber: string | null;
  policyValidFrom: string | null;
  policyValidTo: string | null;
  requireVerifiedEligibility: boolean;
  eligibilityOutcome: string | null;
  serviceDateStart: string;
  serviceDateEnd: string;
  encounterType: 'OPD' | 'IPD';
  currency: string;
  diagnoses: Array<{ code: string; display: string; system: string }>;
  attachments: Array<{ documentType: string; fileName: string; storageReference: string }>;
  claimRequirements: PayerClaimRequirements;
  preauthRequirements: PayerPreauthRequirements;
  preauthStatus: string | null;
  preauthReference: string | null;
  hasDuplicateActiveClaim: boolean;
  grossCents: number;
  discountCents: number;
  copayCents: number;
  proposedClaimCents: number;
  lines: Array<{
    lineNumber: number;
    itemDescription: string;
    serviceCategory: string;
    mappingStatus: string;
    payerServiceCode: string | null;
    requiresPreauth: boolean;
    grossCents: number;
    discountCents: number;
    copayCents: number;
    proposedClaimCents: number;
  }>;
  nowIsoDate?: string;
}

/**
 * Pure, deterministic validation rule evaluator for private insurance claims.
 */
export function evaluatePrivateClaimValidation(
  ctx: PrivateClaimValidationInput,
): PrivateClaimValidationIssue[] {
  const issues: PrivateClaimValidationIssue[] = [];

  if (ctx.hasDuplicateActiveClaim) {
    issues.push({
      code: 'DUPLICATE_ACTIVE_CLAIM',
      severity: 'ERROR',
      field: 'invoiceId',
      message: `An active ${ctx.payerCode} claim already exists for this JaliCare invoice.`,
    });
  }

  if (ctx.memberStatus !== 'ACTIVE') {
    issues.push({
      code: 'INACTIVE_MEMBER_POLICY',
      severity: 'ERROR',
      field: 'memberPolicyId',
      message: `Selected ${ctx.payerCode} membership policy status is ${ctx.memberStatus} (must be ACTIVE).`,
    });
  }

  if (!ctx.memberNumber || ctx.memberNumber.trim().length < 3) {
    issues.push({
      code: 'MISSING_MEMBER_NUMBER',
      severity: 'ERROR',
      field: 'memberNumber',
      message: `${ctx.payerCode} member number is required.`,
    });
  }

  if (
    ctx.claimRequirements.requirePolicyNumber &&
    (!ctx.policyNumber || !ctx.policyNumber.trim())
  ) {
    issues.push({
      code: 'MISSING_POLICY_NUMBER',
      severity: 'ERROR',
      field: 'policyNumber',
      message: `${ctx.payerCode} requires a policy/scheme reference number on all claims.`,
    });
  }

  if (ctx.policyValidFrom && ctx.serviceDateStart < ctx.policyValidFrom) {
    issues.push({
      code: 'SERVICE_BEFORE_POLICY_START',
      severity: 'ERROR',
      field: 'serviceDateStart',
      message: `Service start date (${ctx.serviceDateStart}) precedes policy validFrom (${ctx.policyValidFrom}).`,
    });
  }

  if (ctx.policyValidTo && ctx.serviceDateEnd > ctx.policyValidTo) {
    issues.push({
      code: 'SERVICE_AFTER_POLICY_EXPIRY',
      severity: 'ERROR',
      field: 'serviceDateEnd',
      message: `Service end date (${ctx.serviceDateEnd}) exceeds policy validTo (${ctx.policyValidTo}).`,
    });
  }

  if (ctx.serviceDateEnd < ctx.serviceDateStart) {
    issues.push({
      code: 'INVALID_SERVICE_DATE_RANGE',
      severity: 'ERROR',
      field: 'serviceDateEnd',
      message: 'serviceDateEnd cannot precede serviceDateStart.',
    });
  }

  if (ctx.claimRequirements.maxSubmissionDays) {
    const today = ctx.nowIsoDate ?? new Date().toISOString().slice(0, 10);
    const diffDays =
      (new Date(today).getTime() - new Date(ctx.serviceDateEnd).getTime()) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(diffDays) && diffDays > ctx.claimRequirements.maxSubmissionDays) {
      issues.push({
        code: 'LATE_CLAIM_SUBMISSION_WINDOW',
        severity: 'WARNING',
        field: 'serviceDateEnd',
        message: `Service date is ${Math.floor(diffDays)} days old, exceeding ${ctx.payerCode}'s standard ${ctx.claimRequirements.maxSubmissionDays}-day filing window.`,
      });
    }
  }

  if (ctx.requireVerifiedEligibility && ctx.eligibilityOutcome !== 'Eligible') {
    issues.push({
      code: 'MISSING_CONFIRMED_ELIGIBILITY',
      severity: 'ERROR',
      field: 'eligibilityVerificationId',
      message: `Confirmed 'Eligible' verification (live adapter or documented manual check) is required for ${ctx.payerCode} before submission.`,
    });
  }

  if (ctx.claimRequirements.requireDiagnosis !== false && ctx.diagnoses.length === 0) {
    issues.push({
      code: 'MISSING_CLINICAL_DIAGNOSIS',
      severity: 'ERROR',
      field: 'diagnosesSnapshot',
      message: 'At least one clinical diagnosis (ICD-10 / ICD-11) is required.',
    });
  }

  const allowedCodingSystems = Array.isArray(ctx.claimRequirements.allowedCodingSystems)
    ? ctx.claimRequirements.allowedCodingSystems.filter((value) => typeof value === 'string')
    : [];
  const policyEvidence =
    typeof ctx.claimRequirements.codingPolicyEvidence === 'string'
      ? ctx.claimRequirements.codingPolicyEvidence.trim()
      : '';
  if (
    ctx.diagnoses.length > 0 &&
    (ctx.claimRequirements.codingPolicyVerified !== true ||
      !policyEvidence ||
      allowedCodingSystems.length === 0)
  ) {
    issues.push({
      code: 'PAYER_CODING_POLICY_UNVERIFIED',
      severity: 'ERROR',
      field: 'diagnosesSnapshot',
      message:
        'Confirm the payer-approved diagnosis coding systems and record the policy evidence before submitting a claim.',
    });
  }

  const allowed = new Set(allowedCodingSystems.map((system) => system.toUpperCase()));
  for (const d of ctx.diagnoses) {
    if (!d.code || d.code === 'UNCODED') {
      issues.push({
        code: 'DIAGNOSIS_CODE_REQUIRED',
        severity: 'ERROR',
        field: 'diagnosesSnapshot',
        message: 'A coded diagnosis is required before claim submission.',
      });
    }
    if (allowed.size > 0 && !allowed.has(d.system.toUpperCase())) {
      issues.push({
        code: 'UNSUPPORTED_DIAGNOSIS_CODING_SYSTEM',
        severity: 'ERROR',
        field: 'diagnosesSnapshot',
        message: `Diagnosis uses ${d.system}; ${ctx.payerCode} is configured for ${[...allowed].join(', ')}.`,
      });
    }
  }

  if (ctx.currency !== 'KES') {
    issues.push({
      code: 'UNSUPPORTED_CURRENCY',
      severity: 'ERROR',
      field: 'currency',
      message: `Claim currency must be KES (received ${ctx.currency}).`,
    });
  }

  if (ctx.lines.length === 0) {
    issues.push({
      code: 'NO_CLAIM_LINES',
      severity: 'ERROR',
      field: 'lines',
      message: 'Claim must contain at least one billable line item.',
    });
  }

  let sumGross = 0;
  let sumDiscount = 0;
  let sumCopay = 0;
  let sumProposed = 0;
  let anyLineRequiresPreauth = false;

  for (const line of ctx.lines) {
    sumGross += line.grossCents;
    sumDiscount += line.discountCents;
    sumCopay += line.copayCents;
    sumProposed += line.proposedClaimCents;

    if (line.mappingStatus !== 'MAPPED' || !line.payerServiceCode) {
      issues.push({
        code: 'UNMAPPED_SERVICE_LINE',
        severity: 'ERROR',
        field: `lines[${line.lineNumber}]`,
        message: `Line #${line.lineNumber} ("${line.itemDescription}") has mapping status ${line.mappingStatus} for ${ctx.payerCode}. Map the JaliCare service code before submitting.`,
      });
    }

    const expectedLineProposed = Math.max(
      0,
      line.grossCents - line.discountCents - line.copayCents,
    );
    if (line.proposedClaimCents !== expectedLineProposed) {
      issues.push({
        code: 'LINE_CALCULATION_MISMATCH',
        severity: 'ERROR',
        field: `lines[${line.lineNumber}]`,
        message: `Line #${line.lineNumber} proposed claim amount (${formatCents(line.proposedClaimCents)}) does not equal gross - discount - copay (${formatCents(expectedLineProposed)}).`,
      });
    }

    if (line.requiresPreauth) anyLineRequiresPreauth = true;
    if (ctx.preauthRequirements.requirePreauthForImaging && line.serviceCategory === 'IMAGING') {
      anyLineRequiresPreauth = true;
    }
    if (
      ctx.preauthRequirements.requirePreauthForSurgery &&
      line.serviceCategory === 'THEATRE_SPECIALIST'
    ) {
      anyLineRequiresPreauth = true;
    }
  }

  if (ctx.encounterType === 'IPD' && ctx.preauthRequirements.requirePreauthForInpatient) {
    anyLineRequiresPreauth = true;
  }
  if (
    ctx.preauthRequirements.amountThresholdKes &&
    ctx.proposedClaimCents > Math.round(ctx.preauthRequirements.amountThresholdKes * 100)
  ) {
    anyLineRequiresPreauth = true;
  }

  if (
    sumGross !== ctx.grossCents ||
    sumDiscount !== ctx.discountCents ||
    sumCopay !== ctx.copayCents ||
    sumProposed !== ctx.proposedClaimCents
  ) {
    issues.push({
      code: 'CLAIM_HEADER_TOTAL_MISMATCH',
      severity: 'ERROR',
      field: 'proposedClaimAmount',
      message: 'Claim header monetary totals do not match the sum of claim lines.',
    });
  }

  if (ctx.proposedClaimCents <= 0) {
    issues.push({
      code: 'ZERO_OR_NEGATIVE_CLAIM_AMOUNT',
      severity: 'ERROR',
      field: 'proposedClaimAmount',
      message: 'Proposed insurer claim amount must be greater than KES 0.00.',
    });
  }

  if (anyLineRequiresPreauth) {
    const approvedPreauth =
      (ctx.preauthStatus === 'APPROVED' || ctx.preauthStatus === 'PARTIALLY_APPROVED') &&
      Boolean(ctx.preauthReference && ctx.preauthReference.trim());
    if (!approvedPreauth) {
      issues.push({
        code: 'MISSING_APPROVED_PREAUTHORIZATION',
        severity: 'ERROR',
        field: 'preauthorizationId',
        message: `${ctx.payerCode} requires an APPROVED preauthorization with an authentic insurer authorization reference for this claim.`,
      });
    }
  }

  const docTypes = new Set(
    ctx.attachments
      .filter((a) => a.fileName.trim() && a.storageReference.trim())
      .map((a) => a.documentType.toUpperCase()),
  );
  if (ctx.claimRequirements.requireInvoiceAttachment && !docTypes.has('ITEMIZED_INVOICE')) {
    issues.push({
      code: 'MISSING_INVOICE_ATTACHMENT',
      severity: 'ERROR',
      field: 'attachmentsManifest',
      message: `${ctx.payerCode} requires an ITEMIZED_INVOICE attachment.`,
    });
  }
  if (ctx.claimRequirements.requireSignedClaimForm && !docTypes.has('SIGNED_CLAIM_FORM')) {
    issues.push({
      code: 'MISSING_SIGNED_CLAIM_FORM',
      severity: 'ERROR',
      field: 'attachmentsManifest',
      message: `${ctx.payerCode} requires a SIGNED_CLAIM_FORM attachment.`,
    });
  }

  return issues;
}

async function nextPrivateClaimNumber(payerCode: string): Promise<string> {
  const res = await db.execute(sql`SELECT nextval('private_insurance_claim_seq') AS seq`);
  const rows = (res as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.seq ?? Date.now() % 100000);
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `CLM-${payerCode}-${datePart}-${String(seq).padStart(5, '0')}`;
}

export async function listPrivateInsuranceClaims(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  status?: string;
  patientId?: number;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  const conditions = [
    eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
    eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
  ];

  if (params.payerCode) {
    conditions.push(
      eq(schema.privateInsuranceClaims.payerCode, params.payerCode.trim().toUpperCase()),
    );
  }
  if (params.status) {
    conditions.push(eq(schema.privateInsuranceClaims.status, params.status.trim().toUpperCase()));
  }
  if (params.patientId) {
    conditions.push(eq(schema.privateInsuranceClaims.patientId, params.patientId));
  }

  const rows = await db
    .select({
      claim: schema.privateInsuranceClaims,
      patientFirstName: schema.patients.firstName,
      patientLastName: schema.patients.lastName,
      memberNumber: schema.insuranceMemberPolicies.memberNumber,
      policyNumber: schema.insuranceMemberPolicies.policyNumber,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      invoiceStatus: schema.billingInvoices.status,
    })
    .from(schema.privateInsuranceClaims)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.privateInsuranceClaims.patientId))
    .innerJoin(
      schema.insuranceMemberPolicies,
      eq(schema.insuranceMemberPolicies.id, schema.privateInsuranceClaims.memberPolicyId),
    )
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingInvoices.id, schema.privateInsuranceClaims.invoiceId),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.privateInsuranceClaims.updatedAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => {
    const {
      diagnosesSnapshot: _diagnoses,
      clinicalSummary: _clinical,
      attachmentsManifest: _attachments,
      idempotencyKey: _key,
      ...summary
    } = r.claim;
    return {
      ...summary,
      patientName: `${r.patientFirstName} ${r.patientLastName}`.trim(),
      memberNumber: r.memberNumber,
      policyNumber: r.policyNumber,
      invoiceNumber: r.invoiceNumber,
      originalInvoiceStatus: r.invoiceStatus,
    };
  });
}

export async function getPrivateInsuranceClaimById(params: {
  tenantId: number;
  facilityId: number;
  claimId: number;
}) {
  const [row] = await db
    .select({
      claim: schema.privateInsuranceClaims,
      patientFirstName: schema.patients.firstName,
      patientLastName: schema.patients.lastName,
      memberPolicy: schema.insuranceMemberPolicies,
      invoice: schema.billingInvoices,
    })
    .from(schema.privateInsuranceClaims)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.privateInsuranceClaims.patientId))
    .innerJoin(
      schema.insuranceMemberPolicies,
      eq(schema.insuranceMemberPolicies.id, schema.privateInsuranceClaims.memberPolicyId),
    )
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingInvoices.id, schema.privateInsuranceClaims.invoiceId),
    )
    .where(
      and(
        eq(schema.privateInsuranceClaims.id, params.claimId),
        eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
        eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new PrivateInsuranceError('CLAIM_NOT_FOUND', 'Private insurance claim not found.', 404);
  }

  const [lines, submissions, statusHistory, guards] = await Promise.all([
    db
      .select()
      .from(schema.privateInsuranceClaimLines)
      .where(eq(schema.privateInsuranceClaimLines.claimId, row.claim.id))
      .orderBy(asc(schema.privateInsuranceClaimLines.lineNumber)),
    db
      .select()
      .from(schema.privateInsuranceClaimSubmissions)
      .where(eq(schema.privateInsuranceClaimSubmissions.claimId, row.claim.id))
      .orderBy(desc(schema.privateInsuranceClaimSubmissions.attemptNumber)),
    db
      .select()
      .from(schema.privateInsuranceClaimStatusHistory)
      .where(eq(schema.privateInsuranceClaimStatusHistory.claimId, row.claim.id))
      .orderBy(desc(schema.privateInsuranceClaimStatusHistory.createdAt)),
    db
      .select({
        state: schema.insuranceClaimDispatchGuards.state,
        createdAt: schema.insuranceClaimDispatchGuards.createdAt,
      })
      .from(schema.insuranceClaimDispatchGuards)
      .where(
        and(
          eq(schema.insuranceClaimDispatchGuards.workflow, 'PRIVATE'),
          eq(schema.insuranceClaimDispatchGuards.claimId, row.claim.id),
          eq(schema.insuranceClaimDispatchGuards.tenantId, params.tenantId),
          eq(schema.insuranceClaimDispatchGuards.facilityId, params.facilityId),
        ),
      )
      .limit(1),
  ]);

  return {
    ...row.claim,
    patientName: `${row.patientFirstName} ${row.patientLastName}`.trim(),
    memberPolicy: row.memberPolicy,
    originalInvoice: {
      id: row.invoice.id,
      invoiceNumber: row.invoice.invoiceNumber,
      totalAmount: row.invoice.totalAmount,
      paidAmount: row.invoice.paidAmount,
      balanceAmount: row.invoice.balanceAmount,
      status: row.invoice.status,
    },
    lines,
    submissions,
    statusHistory,
    dispatchReview: guards[0] ?? null,
  };
}

const privateGuardError = (code: string, message: string, status: number) =>
  new PrivateInsuranceError(code, message, status);
function privateGuardScope(
  params: { tenantId: number; facilityId: number; actorUserId: number; actorUserUid: string },
  claim: { id: number; status: string; dispatchRevision: number },
) {
  return {
    workflow: 'PRIVATE' as const,
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserId: params.actorUserId,
    actorUserUid: params.actorUserUid,
    claimId: claim.id,
    revision: claim.dispatchRevision,
    status: claim.status,
  };
}

export async function preparePrivateInsuranceClaim(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const invoiceId = Number(params.input.invoiceId);
  const memberPolicyId = Number(params.input.memberPolicyId);

  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    throw new PrivateInsuranceError(
      'INVALID_INVOICE_ID',
      'Valid JaliCare invoiceId is required.',
      400,
    );
  }
  if (!Number.isInteger(memberPolicyId) || memberPolicyId <= 0) {
    throw new PrivateInsuranceError(
      'INVALID_MEMBER_POLICY_ID',
      'Valid memberPolicyId is required.',
      400,
    );
  }

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(
      and(
        eq(schema.billingInvoices.id, invoiceId),
        eq(schema.billingInvoices.tenantId, params.tenantId),
        eq(schema.billingInvoices.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!invoice) {
    throw new PrivateInsuranceError(
      'INVOICE_NOT_FOUND',
      'JaliCare invoice not found in facility.',
      404,
    );
  }

  const [memberPolicy] = await db
    .select()
    .from(schema.insuranceMemberPolicies)
    .where(
      and(
        eq(schema.insuranceMemberPolicies.id, memberPolicyId),
        eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
        eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
        eq(schema.insuranceMemberPolicies.patientId, invoice.patientId),
      ),
    )
    .limit(1);

  if (!memberPolicy) {
    throw new PrivateInsuranceError(
      'MEMBER_POLICY_MISMATCH',
      'Selected insurance membership policy does not belong to the invoice patient in this facility.',
      400,
    );
  }

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: memberPolicy.payerCode,
  });

  // Duplicate active claim check on same (invoiceId, payerCode)
  const existingActive = await db
    .select({
      id: schema.privateInsuranceClaims.id,
      claimNumber: schema.privateInsuranceClaims.claimNumber,
      status: schema.privateInsuranceClaims.status,
    })
    .from(schema.privateInsuranceClaims)
    .where(
      and(
        eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
        eq(schema.privateInsuranceClaims.invoiceId, invoice.id),
        eq(schema.privateInsuranceClaims.payerCode, payerRow.payerCode),
        ne(schema.privateInsuranceClaims.status, 'CANCELLED'),
      ),
    );

  if (existingActive.length > 0) {
    throw new PrivateInsuranceError(
      'DUPLICATE_INVOICE_CLAIM',
      `An active ${payerRow.payerCode} claim (${existingActive[0].claimNumber}, status ${existingActive[0].status}) already exists for invoice ${invoice.invoiceNumber}.`,
      409,
    );
  }

  const invoiceItems = await db
    .select()
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, invoice.id))
    .orderBy(asc(schema.billingItems.id));

  if (invoiceItems.length === 0) {
    throw new PrivateInsuranceError(
      'EMPTY_INVOICE',
      `Invoice ${invoice.invoiceNumber} has no billable items.`,
      400,
    );
  }

  // Resolve encounter, admission, diagnoses, lab, pharmacy
  const effectiveEncounterId = params.input.encounterId
    ? Number(params.input.encounterId)
    : (invoice.encounterId ?? null);

  let encounter: typeof schema.encounters.$inferSelect | null = null;
  if (effectiveEncounterId) {
    const [enc] = await db
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, effectiveEncounterId),
          eq(schema.encounters.tenantId, params.tenantId),
          eq(schema.encounters.facilityId, params.facilityId),
          eq(schema.encounters.patientId, invoice.patientId),
        ),
      )
      .limit(1);
    if (!enc || (invoice.encounterId && enc.id !== invoice.encounterId))
      throw new PrivateInsuranceError(
        'ENCOUNTER_MISMATCH',
        'Encounter must belong to the patient, facility and invoice.',
        404,
      );
    encounter = enc;
  }

  const [admission] = encounter
    ? await db
        .select()
        .from(schema.admissions)
        .where(
          and(
            eq(schema.admissions.tenantId, params.tenantId),
            eq(schema.admissions.facilityId, params.facilityId),
            eq(schema.admissions.patientId, invoice.patientId),
            eq(schema.admissions.encounterId, encounter.id),
          ),
        )
        .orderBy(desc(schema.admissions.id))
        .limit(1)
    : [];

  const encounterType: 'OPD' | 'IPD' =
    params.input.encounterType === 'IPD' ||
    encounter?.encounterType === 'INPATIENT' ||
    invoiceItems.some((i) => i.sourceType === 'ADMISSION' || i.sourceType === 'BED_DAY')
      ? 'IPD'
      : 'OPD';

  // Diagnoses from override or clinical encounter
  let diagnosesSnapshot: Array<{ code: string; display: string; system: string; type: string }> =
    [];
  if (Array.isArray(params.input.diagnoses) && params.input.diagnoses.length > 0) {
    diagnosesSnapshot = (params.input.diagnoses as Array<Record<string, unknown>>).map(
      (d, idx) => ({
        code: String(d.code ?? '').trim(),
        display: String(d.display ?? '').trim(),
        system: String(d.system ?? payerRow.defaultCodingSystem).trim(),
        type: String(d.type ?? (idx === 0 ? 'principal' : 'secondary')),
      }),
    );
  } else if (encounter) {
    const encDiags = await db
      .select()
      .from(schema.diagnoses)
      .where(
        and(
          eq(schema.diagnoses.encounterId, encounter.id),
          eq(schema.diagnoses.patientId, invoice.patientId),
        ),
      );
    diagnosesSnapshot = encDiags.map((d, idx) => {
      // Historical records remain ICD-10 as recorded; a code's shape is not
      // evidence that it belongs to ICD-11. No automatic crosswalk is applied.
      const isIcd11 = d.codingSystem === 'ICD-11';
      return {
        code: (isIcd11 ? d.icd11Code : d.icd10Code) ?? '',
        display: (isIcd11 ? d.icd11Title : d.icd10Description) ?? '',
        system: isIcd11 ? 'ICD-11' : 'ICD-10',
        type: idx === 0 ? 'principal' : 'secondary',
      };
    });
  }

  // Clinical summary evidence (lab orders, medications)
  const [labOrders, medications] = encounter
    ? await Promise.all([
        db
          .select({ id: schema.labOrders.id, testName: schema.labOrders.testName })
          .from(schema.labOrders)
          .where(
            and(
              eq(schema.labOrders.encounterId, encounter.id),
              eq(schema.labOrders.patientId, invoice.patientId),
              eq(schema.labOrders.tenantId, params.tenantId),
              eq(schema.labOrders.facilityId, params.facilityId),
            ),
          ),
        db
          .select({ id: schema.medications.id })
          .from(schema.medications)
          .where(
            and(
              eq(schema.medications.encounterId, encounter.id),
              eq(schema.medications.patientId, invoice.patientId),
            ),
          ),
      ])
    : [[], []];

  // Latest eligibility & optional preauthorization
  const [latestElig] = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.facilityId, params.facilityId),
        eq(schema.insuranceEligibilityVerifications.patientId, invoice.patientId),
        eq(schema.insuranceEligibilityVerifications.payerCode, payerRow.payerCode),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(1);

  let preauth: typeof schema.insurancePreauthorizations.$inferSelect | null = null;
  if (params.input.preauthorizationId) {
    const [pa] = await db
      .select()
      .from(schema.insurancePreauthorizations)
      .where(
        and(
          eq(schema.insurancePreauthorizations.id, Number(params.input.preauthorizationId)),
          eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
          eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
          eq(schema.insurancePreauthorizations.patientId, invoice.patientId),
          eq(schema.insurancePreauthorizations.payerCode, payerRow.payerCode),
        ),
      )
      .limit(1);
    if (
      !pa ||
      (pa.memberPolicyId && pa.memberPolicyId !== memberPolicy.id) ||
      (pa.invoiceId && pa.invoiceId !== invoice.id) ||
      (pa.encounterId && pa.encounterId !== encounter?.id)
    )
      throw new PrivateInsuranceError(
        'PREAUTH_NOT_FOUND',
        'Preauthorization does not belong to the patient, payer and facility.',
        404,
      );
    preauth = pa;
  }

  // Load insurer mappings & approved benefit rules
  const [mappings, approvedRules, facilityTariffs] = await Promise.all([
    db
      .select()
      .from(schema.payerServiceCodeMappings)
      .where(
        and(
          eq(schema.payerServiceCodeMappings.facilityId, params.facilityId),
          eq(schema.payerServiceCodeMappings.payerCode, payerRow.payerCode),
        ),
      ),
    db
      .select()
      .from(schema.payerBenefitRules)
      .where(
        and(
          eq(schema.payerBenefitRules.facilityId, params.facilityId),
          eq(schema.payerBenefitRules.payerCode, payerRow.payerCode),
          eq(schema.payerBenefitRules.status, 'APPROVED'),
        ),
      ),
    db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.facilityId, params.facilityId)),
  ]);

  const serviceDateStart =
    typeof params.input.serviceDateStart === 'string' && params.input.serviceDateStart.trim()
      ? params.input.serviceDateStart.trim()
      : encounterType === 'IPD' && admission?.admissionDate
        ? admission.admissionDate.slice(0, 10)
        : encounter
          ? encounter.startedAt.toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

  const serviceDateEnd =
    typeof params.input.serviceDateEnd === 'string' && params.input.serviceDateEnd.trim()
      ? params.input.serviceDateEnd.trim()
      : encounterType === 'IPD' && admission?.dischargeDate
        ? admission.dischargeDate.slice(0, 10)
        : serviceDateStart;

  const attachmentsManifest = Array.isArray(params.input.attachmentsManifest)
    ? (params.input.attachmentsManifest as Array<Record<string, unknown>>).map((a) => ({
        documentType: String(a.documentType ?? 'SUPPORTING_DOC').toUpperCase(),
        fileName: String(a.fileName ?? 'attachment.pdf'),
        storageReference: String(a.storageReference ?? ''),
      }))
    : [];

  let totalGrossCents = 0;
  let totalDiscountCents = 0;
  let totalCopayCents = 0;
  let totalProposedCents = 0;

  const preparedLines = invoiceItems.map((bi, idx) => {
    const qty = Math.max(1, bi.quantity ?? 1);
    const tariff =
      (bi.tariffId ? facilityTariffs.find((t) => t.id === bi.tariffId) : undefined) ??
      facilityTariffs.find(
        (t) =>
          (bi.tariffCode && t.code === bi.tariffCode) ||
          t.description.toLowerCase() === bi.description.toLowerCase(),
      );

    const localCode = bi.tariffCode ?? tariff?.code ?? null;
    const category = inferPrivateServiceCategory(
      bi.sourceType ?? bi.itemType ?? tariff?.department ?? bi.description,
    );

    const matchedMapping = mappings.find(
      (m) =>
        (tariff && m.tariffId === tariff.id) ||
        (localCode && m.localCode.toUpperCase() === localCode.toUpperCase()),
    );

    const mappingStatus = matchedMapping
      ? matchedMapping.isActive &&
        isEffectiveOnDate(
          matchedMapping.effectiveFrom,
          matchedMapping.effectiveTo,
          serviceDateStart,
        )
        ? 'MAPPED'
        : 'INACTIVE_MAPPING'
      : 'UNMAPPED';

    const matchedRule =
      approvedRules.find(
        (r) =>
          isEffectiveOnDate(r.effectiveFrom, r.effectiveTo, serviceDateStart) &&
          matchedMapping &&
          r.payerServiceCode &&
          r.payerServiceCode.toUpperCase() === matchedMapping.payerServiceCode.toUpperCase(),
      ) ??
      approvedRules.find(
        (r) =>
          isEffectiveOnDate(r.effectiveFrom, r.effectiveTo, serviceDateStart) &&
          r.serviceCategory.toUpperCase() === category,
      ) ??
      null;

    const unitPriceRaw = matchedMapping?.reimbursementTariff ?? bi.unitPrice ?? '0.00';
    const fin = computeBenefitFinancialsCents({
      unitAmountKes: unitPriceRaw,
      quantity: qty,
      discountAmountKes: '0.00',
      copayType: matchedRule?.copayType ?? 'NONE',
      copayValueKesOrPercent: matchedRule?.copayValue ?? '0.00',
      deductibleAmountKes: idx === 0 ? (matchedRule?.deductibleAmount ?? '0.00') : '0.00',
      coinsurancePercent: matchedRule?.coinsurancePercent ?? '0.00',
      perVisitLimitKes: matchedRule?.perVisitLimit ?? null,
    });

    const lineCopayCents = fin.patientContributionCents;
    const lineProposedCents = fin.estimatedClaimableCents;

    totalGrossCents += fin.grossCents;
    totalDiscountCents += fin.discountCents;
    totalCopayCents += lineCopayCents;
    totalProposedCents += lineProposedCents;

    return {
      billingItemId: bi.id,
      tariffId: tariff?.id ?? null,
      mappingId: matchedMapping?.id ?? null,
      lineNumber: idx + 1,
      serviceCategory: category,
      itemCode: localCode,
      itemDescription: bi.description,
      payerServiceCode:
        mappingStatus === 'MAPPED' ? (matchedMapping?.payerServiceCode ?? null) : null,
      payerServiceName:
        mappingStatus === 'MAPPED' ? (matchedMapping?.payerServiceName ?? null) : null,
      mappingStatus,
      serviceDate: serviceDateStart,
      quantity: qty,
      unitPrice: formatCents(Math.floor(fin.grossCents / qty)),
      grossAmount: fin.grossFormatted,
      discountAmount: fin.discountFormatted,
      copayAmount: formatCents(lineCopayCents),
      proposedClaimAmount: formatCents(lineProposedCents),
      requiresPreauth: Boolean(matchedMapping?.requiresPreauth || matchedRule?.requiresPreauth),
      preauthReference: preauth?.payerAuthReference ?? null,
      grossCents: fin.grossCents,
      discountCents: fin.discountCents,
      copayCents: lineCopayCents,
      proposedClaimCents: lineProposedCents,
    };
  });

  const claimNumber = await nextPrivateClaimNumber(payerRow.payerCode);

  const createdId = await db.transaction(async (tx) => {
    // All claim creators lock the invoice before rechecking duplicates. This
    // covers both independent payer workflows without merging their adapters.
    const [lockedInvoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(
        and(
          eq(schema.billingInvoices.id, invoice.id),
          eq(schema.billingInvoices.tenantId, params.tenantId),
          eq(schema.billingInvoices.facilityId, params.facilityId),
        ),
      )
      .for('update');
    if (!lockedInvoice || lockedInvoice.voidedAt || lockedInvoice.status === 'Void')
      throw new PrivateInsuranceError(
        'INVOICE_NOT_FOUND',
        'Invoice is unavailable for claim preparation.',
        409,
      );
    const currentItems = await tx
      .select()
      .from(schema.billingItems)
      .where(eq(schema.billingItems.invoiceId, invoice.id))
      .orderBy(asc(schema.billingItems.id));
    if (
      lockedInvoice.updatedAt.getTime() !== invoice.updatedAt.getTime() ||
      JSON.stringify(currentItems) !== JSON.stringify(invoiceItems)
    )
      throw new PrivateInsuranceError(
        'INVOICE_CHANGED',
        'The invoice changed during claim preparation. Review and prepare again.',
        409,
      );
    // Gross invoice paid_amount contains patient AND insurer receipts. Do not
    // present it as a patient payment without explicit receipt attribution.
    const ledger = await readInvoicePaymentLedger(tx, invoice.id);
    const recordedPaid = parseMoneyToCents(lockedInvoice.paidAmount);
    if (!ledger || recordedPaid === null || ledger.netCents !== recordedPaid)
      throw new PrivateInsuranceError(
        'PAYMENT_LEDGER_REVIEW_REQUIRED',
        'Review the invoice receipt ledger before preparing a claim.',
        409,
      );
    const attributions = await tx
      .select({
        paymentId: schema.billingPaymentAttributions.paymentId,
        party: schema.billingPaymentAttributions.party,
      })
      .from(schema.billingPaymentAttributions)
      .where(eq(schema.billingPaymentAttributions.invoiceId, invoice.id));
    const parties = new Map(attributions.map((a) => [a.paymentId, a.party]));
    let patientPaidCents = 0;
    for (const [paymentId, receipt] of ledger.byPayment) {
      const net = receipt.grossCents - receipt.refundedCents;
      const party = parties.get(paymentId);
      if (net > 0 && party !== 'PATIENT' && party !== 'INSURER')
        throw new PrivateInsuranceError(
          'PAYMENT_ATTRIBUTION_REQUIRED',
          'Attribute each outstanding receipt to patient or insurer before preparing a claim.',
          409,
        );
      if (party === 'PATIENT') patientPaidCents += net;
      if (!Number.isSafeInteger(patientPaidCents))
        throw new PrivateInsuranceError(
          'PAYMENT_LEDGER_REVIEW_REQUIRED',
          'Review the patient receipt total before preparing a claim.',
          409,
        );
    }
    const normalizedPayer = payerRow.payerCode.trim().toUpperCase();
    const [existingPrivate] = await tx
      .select({ id: schema.privateInsuranceClaims.id })
      .from(schema.privateInsuranceClaims)
      .where(
        and(
          eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
          eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
          eq(schema.privateInsuranceClaims.invoiceId, invoice.id),
          sql`upper(trim(${schema.privateInsuranceClaims.payerCode})) = ${normalizedPayer}`,
          ne(schema.privateInsuranceClaims.status, 'CANCELLED'),
        ),
      )
      .limit(1);
    const [existingSha] = await tx
      .select({ id: schema.shaEclaims.id })
      .from(schema.shaEclaims)
      .where(
        and(
          eq(schema.shaEclaims.tenantId, params.tenantId),
          eq(schema.shaEclaims.facilityId, params.facilityId),
          eq(schema.shaEclaims.invoiceId, invoice.id),
          sql`upper(trim(${schema.shaEclaims.payerCode})) = ${normalizedPayer}`,
          ne(schema.shaEclaims.status, 'CANCELLED'),
        ),
      )
      .limit(1);
    if (existingPrivate || existingSha)
      throw new PrivateInsuranceError(
        'DUPLICATE_INVOICE_CLAIM',
        'An active claim for this invoice and payer already exists.',
        409,
      );
    const [claim] = await tx
      .insert(schema.privateInsuranceClaims)
      .values({
        tenantId: params.tenantId,
        facilityId: params.facilityId,
        patientId: invoice.patientId,
        memberPolicyId: memberPolicy.id,
        encounterId: encounter?.id ?? null,
        admissionId: encounterType === 'IPD' && admission ? admission.id : null,
        invoiceId: invoice.id,
        eligibilityVerificationId: latestElig?.id ?? null,
        preauthorizationId: preauth?.id ?? null,
        payerCode: payerRow.payerCode,
        adapterKey: payerRow.adapterKey,
        integrationType: payerRow.integrationType,
        claimNumber,
        idempotencyKey: randomUUID(),
        encounterType,
        currency: 'KES',
        serviceDateStart,
        serviceDateEnd,
        grossInvoiceAmount: formatCents(totalGrossCents),
        discountAmount: formatCents(totalDiscountCents),
        confirmedCopayAmount: formatCents(totalCopayCents),
        patientPaidAmount: formatCents(patientPaidCents),
        proposedClaimAmount: formatCents(totalProposedCents),
        status: 'DRAFT',
        submissionChannel: 'NONE',
        diagnosesSnapshot,
        clinicalSummary: {
          labOrdersCount: labOrders.length,
          prescriptionsCount: medications.length,
          encounterType,
          originalInvoiceNumber: invoice.invoiceNumber,
        },
        attachmentsManifest,
        validationIssues: [],
        visitSessionRef: latestElig?.visitSessionRef ?? null,
        createdByUserId: params.actorUserId,
      })
      .returning();

    await tx.insert(schema.privateInsuranceClaimLines).values(
      preparedLines.map((l) => ({
        claimId: claim.id,
        billingItemId: l.billingItemId,
        tariffId: l.tariffId,
        mappingId: l.mappingId,
        lineNumber: l.lineNumber,
        serviceCategory: l.serviceCategory,
        itemCode: l.itemCode,
        itemDescription: l.itemDescription,
        payerServiceCode: l.payerServiceCode,
        payerServiceName: l.payerServiceName,
        mappingStatus: l.mappingStatus,
        serviceDate: l.serviceDate,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        grossAmount: l.grossAmount,
        discountAmount: l.discountAmount,
        copayAmount: l.copayAmount,
        proposedClaimAmount: l.proposedClaimAmount,
        preauthReference: l.preauthReference,
      })),
    );

    await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
      claimId: claim.id,
      fromStatus: null,
      toStatus: 'DRAFT',
      source: 'CLAIM_PREPARATION',
      actorUserId: params.actorUserId,
      reason: `Prepared from JaliCare invoice ${invoice.invoiceNumber} without modifying original invoice.`,
      metadata: { invoiceId: invoice.id, payerCode: payerRow.payerCode },
    });

    await tx.insert(schema.patientRecordAccessLogs).values({
      patientId: invoice.patientId,
      userId: params.actorUserId,
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      action: 'VIEW',
      accessChannel: 'STAFF_PORTAL',
      recordType: 'PrivateClaimPreparation',
      recordId: claim.id,
      purpose: 'BILLING',
    });
    return claim.id;
  });

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_CLAIM_PREPARED',
    entityType: 'private_insurance_claim',
    entityId: createdId,
    details: {
      claimNumber,
      payerCode: payerRow.payerCode,
      invoiceId: invoice.id,
      proposedClaimAmount: formatCents(totalProposedCents),
    },
  });

  return getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: createdId,
  });
}

export async function validatePrivateInsuranceClaimById(params: {
  tenantId: number;
  facilityId: number;
  claimId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
}) {
  const claim = await getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: params.claimId,
  });

  if (!['DRAFT', 'VALIDATION_FAILED', 'READY', 'REJECTED'].includes(claim.status)) {
    throw new PrivateInsuranceError(
      'CLAIM_LOCKED_FOR_VALIDATION',
      `Claim ${claim.claimNumber} is in status ${claim.status} and cannot be re-validated directly.`,
      409,
    );
  }

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: claim.payerCode,
  });
  const runtime = toPayerRuntimeConfig(payerRow);

  // Re-sync mappings on unmapped lines in case mappings were added after preparation
  const mappings = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.facilityId, params.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, claim.payerCode),
      ),
    );

  const pendingMappings: Array<{
    lineId: number;
    mappingId: number;
    payerServiceCode: string;
    payerServiceName: string;
  }> = [];
  for (const line of claim.lines) {
    if (line.mappingStatus !== 'MAPPED') {
      const m = mappings.find(
        (cand) =>
          cand.isActive &&
          isEffectiveOnDate(cand.effectiveFrom, cand.effectiveTo, claim.serviceDateStart) &&
          ((line.tariffId && cand.tariffId === line.tariffId) ||
            (line.itemCode && cand.localCode.toUpperCase() === line.itemCode.toUpperCase())),
      );
      if (m) {
        pendingMappings.push({
          lineId: line.id,
          mappingId: m.id,
          payerServiceCode: m.payerServiceCode,
          payerServiceName: m.payerServiceName,
        });
        line.mappingId = m.id;
        line.payerServiceCode = m.payerServiceCode;
        line.payerServiceName = m.payerServiceName;
        line.mappingStatus = 'MAPPED';
      }
    }
  }

  let eligOutcome: string | null = null;
  let newEligibilityId: number | null = null;
  if (claim.eligibilityVerificationId) {
    const [el] = await db
      .select()
      .from(schema.insuranceEligibilityVerifications)
      .where(eq(schema.insuranceEligibilityVerifications.id, claim.eligibilityVerificationId))
      .limit(1);
    eligOutcome = el?.outcome ?? null;
  } else {
    const [latestEl] = await db
      .select()
      .from(schema.insuranceEligibilityVerifications)
      .where(
        and(
          eq(schema.insuranceEligibilityVerifications.facilityId, params.facilityId),
          eq(schema.insuranceEligibilityVerifications.patientId, claim.patientId),
          eq(schema.insuranceEligibilityVerifications.payerCode, claim.payerCode),
        ),
      )
      .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
      .limit(1);
    if (latestEl) {
      eligOutcome = latestEl.outcome;
      newEligibilityId = latestEl.id;
    }
  }

  let preauthStatus: string | null = null;
  let preauthRef: string | null = null;
  if (claim.preauthorizationId) {
    const [pa] = await db
      .select()
      .from(schema.insurancePreauthorizations)
      .where(
        and(
          eq(schema.insurancePreauthorizations.id, claim.preauthorizationId),
          eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
          eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
          eq(schema.insurancePreauthorizations.patientId, claim.patientId),
          eq(schema.insurancePreauthorizations.payerCode, claim.payerCode),
        ),
      )
      .limit(1);
    preauthStatus = pa?.status ?? null;
    preauthRef = pa?.payerAuthReference ?? null;
  }

  const otherActive = await db
    .select({ id: schema.privateInsuranceClaims.id })
    .from(schema.privateInsuranceClaims)
    .where(
      and(
        eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
        eq(schema.privateInsuranceClaims.invoiceId, claim.invoiceId),
        eq(schema.privateInsuranceClaims.payerCode, claim.payerCode),
        ne(schema.privateInsuranceClaims.id, claim.id),
        ne(schema.privateInsuranceClaims.status, 'CANCELLED'),
      ),
    );

  const issues = evaluatePrivateClaimValidation({
    payerCode: claim.payerCode,
    memberStatus: claim.memberPolicy.status,
    memberNumber: claim.memberPolicy.memberNumber,
    policyNumber: claim.memberPolicy.policyNumber,
    policyValidFrom: claim.memberPolicy.validFrom,
    policyValidTo: claim.memberPolicy.validTo,
    requireVerifiedEligibility: runtime.requireVerifiedEligibility,
    eligibilityOutcome: eligOutcome,
    serviceDateStart: claim.serviceDateStart,
    serviceDateEnd: claim.serviceDateEnd,
    encounterType: claim.encounterType as 'OPD' | 'IPD',
    currency: claim.currency,
    diagnoses: claim.diagnosesSnapshot,
    attachments: claim.attachmentsManifest,
    claimRequirements: runtime.claimRequirements,
    preauthRequirements: runtime.preauthRequirements,
    preauthStatus,
    preauthReference: preauthRef,
    hasDuplicateActiveClaim: otherActive.length > 0,
    grossCents: parseMoneyToCents(claim.grossInvoiceAmount) ?? 0,
    discountCents: parseMoneyToCents(claim.discountAmount) ?? 0,
    copayCents: parseMoneyToCents(claim.confirmedCopayAmount) ?? 0,
    proposedClaimCents: parseMoneyToCents(claim.proposedClaimAmount) ?? 0,
    lines: claim.lines.map((l) => {
      const m = mappings.find((cand) => cand.id === l.mappingId);
      return {
        lineNumber: l.lineNumber,
        itemDescription: l.itemDescription,
        serviceCategory: l.serviceCategory,
        mappingStatus: l.mappingStatus,
        payerServiceCode: l.payerServiceCode,
        requiresPreauth: Boolean(m?.requiresPreauth),
        grossCents: parseMoneyToCents(l.grossAmount) ?? 0,
        discountCents: parseMoneyToCents(l.discountAmount) ?? 0,
        copayCents: parseMoneyToCents(l.copayAmount) ?? 0,
        proposedClaimCents: parseMoneyToCents(l.proposedClaimAmount) ?? 0,
      };
    }),
  });

  const hasErrors = issues.some((i) => i.severity === 'ERROR');
  const nextStatus: PrivateClaimStatus = hasErrors ? 'VALIDATION_FAILED' : 'READY';

  await db.transaction(async (tx) => {
    await lockMutableClaim(tx, privateGuardScope(params, claim), privateGuardError);
    for (const mapping of pendingMappings)
      await tx
        .update(schema.privateInsuranceClaimLines)
        .set({
          mappingId: mapping.mappingId,
          payerServiceCode: mapping.payerServiceCode,
          payerServiceName: mapping.payerServiceName,
          mappingStatus: 'MAPPED',
        })
        .where(
          and(
            eq(schema.privateInsuranceClaimLines.id, mapping.lineId),
            eq(schema.privateInsuranceClaimLines.claimId, claim.id),
          ),
        );
    await tx
      .update(schema.privateInsuranceClaims)
      .set({
        ...(newEligibilityId ? { eligibilityVerificationId: newEligibilityId } : {}),
        status: nextStatus,
        validationIssues: issues,
        updatedAt: new Date(),
      })
      .where(eq(schema.privateInsuranceClaims.id, claim.id));

    await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
      claimId: claim.id,
      fromStatus: claim.status,
      toStatus: nextStatus,
      source: 'PRE_SUBMISSION_VALIDATION',
      actorUserId: params.actorUserId,
      reason: hasErrors
        ? `${issues.filter((i) => i.severity === 'ERROR').length} validation error(s) detected.`
        : 'All pre-submission checks passed.',
      metadata: { errorCount: issues.filter((i) => i.severity === 'ERROR').length },
    });
  });

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_CLAIM_VALIDATED',
    entityType: 'private_insurance_claim',
    entityId: claim.id,
    details: { claimNumber: claim.claimNumber, status: nextStatus, issueCount: issues.length },
  });

  return getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: claim.id,
  });
}

export async function updateOrCorrectPrivateClaim(params: {
  tenantId: number;
  facilityId: number;
  claimId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const claim = await getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: params.claimId,
  });

  if (!['DRAFT', 'VALIDATION_FAILED', 'READY', 'REJECTED'].includes(claim.status)) {
    throw new PrivateInsuranceError(
      'CLAIM_NOT_EDITABLE',
      `Claim ${claim.claimNumber} in status ${claim.status} cannot be edited.`,
      409,
    );
  }

  const correctionReason =
    typeof params.input.correctionReason === 'string' && params.input.correctionReason.trim()
      ? params.input.correctionReason.trim()
      : 'Updated claim documentation / coding.';

  if (
    claim.status === 'REJECTED' &&
    (typeof params.input.correctionReason !== 'string' ||
      params.input.correctionReason.trim().length < 5)
  )
    throw new PrivateInsuranceError(
      'CORRECTION_REASON_REQUIRED',
      'Record an auditable correction reason.',
      400,
    );

  const updates: Partial<typeof schema.privateInsuranceClaims.$inferInsert> = {
    status: 'DRAFT',
    revisionNumber: claim.status === 'REJECTED' ? claim.revisionNumber + 1 : claim.revisionNumber,
    updatedAt: new Date(),
  };

  if (Array.isArray(params.input.diagnoses)) {
    updates.diagnosesSnapshot = (params.input.diagnoses as Array<Record<string, unknown>>).map(
      (d, idx) => ({
        code: String(d.code ?? '').trim(),
        display: String(d.display ?? '').trim(),
        system: String(d.system ?? 'ICD-10').trim(),
        type: String(d.type ?? (idx === 0 ? 'principal' : 'secondary')),
      }),
    );
  }
  if (Array.isArray(params.input.attachmentsManifest)) {
    updates.attachmentsManifest = (
      params.input.attachmentsManifest as Array<Record<string, unknown>>
    ).map((a) => ({
      documentType: String(a.documentType ?? 'SUPPORTING_DOC').toUpperCase(),
      fileName: String(a.fileName ?? 'document.pdf'),
      storageReference: String(a.storageReference ?? ''),
    }));
  }
  if (params.input.preauthorizationId !== undefined) {
    const requested = params.input.preauthorizationId
      ? Number(params.input.preauthorizationId)
      : null;
    if (requested) {
      const [preauth] = await db
        .select()
        .from(schema.insurancePreauthorizations)
        .where(
          and(
            eq(schema.insurancePreauthorizations.id, requested),
            eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
            eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
            eq(schema.insurancePreauthorizations.patientId, claim.patientId),
            eq(schema.insurancePreauthorizations.payerCode, claim.payerCode),
          ),
        )
        .limit(1);
      if (
        !preauth ||
        (preauth.memberPolicyId && preauth.memberPolicyId !== claim.memberPolicyId) ||
        (preauth.invoiceId && preauth.invoiceId !== claim.invoiceId) ||
        (preauth.encounterId && preauth.encounterId !== claim.encounterId)
      )
        throw new PrivateInsuranceError(
          'PREAUTH_NOT_FOUND',
          'Preauthorization does not belong to this patient, payer and facility.',
          404,
        );
    }
    updates.preauthorizationId = requested;
  }

  await db.transaction(async (tx) => {
    await lockMutableClaim(tx, privateGuardScope(params, claim), privateGuardError);
    await tx
      .update(schema.privateInsuranceClaims)
      .set(updates)
      .where(eq(schema.privateInsuranceClaims.id, claim.id));

    await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
      claimId: claim.id,
      fromStatus: claim.status,
      toStatus: 'DRAFT',
      source: 'CLAIM_CORRECTION',
      actorUserId: params.actorUserId,
      reason: correctionReason,
      metadata: { revisionNumber: updates.revisionNumber },
    });
  });

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_CLAIM_CORRECTED',
    entityType: 'private_insurance_claim',
    entityId: claim.id,
    details: { claimNumber: claim.claimNumber, correctionReason },
  });

  return getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: claim.id,
  });
}

export async function submitPrivateInsuranceClaim(params: {
  tenantId: number;
  facilityId: number;
  claimId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  isResubmission?: boolean;
  input: Record<string, unknown>;
}) {
  let claim = await getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: params.claimId,
  });

  // Duplicate submission protection
  if (
    ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_ADJUDICATED', 'ADJUDICATED', 'PAID'].includes(
      claim.status,
    )
  ) {
    throw new PrivateInsuranceError(
      'DUPLICATE_CLAIM_SUBMISSION_BLOCKED',
      `Claim ${claim.claimNumber} has already been submitted (status: ${claim.status}). Duplicate submission is blocked.`,
      409,
    );
  }

  if (params.isResubmission) {
    const correctionReason = String(params.input.correctionReason ?? '').trim();
    if (!correctionReason || correctionReason.length < 5) {
      throw new PrivateInsuranceError(
        'RESUBMISSION_REASON_REQUIRED',
        'Resubmitting a claim requires an auditable correctionReason (minimum 5 characters).',
        400,
      );
    }
    if (claim.status === 'REJECTED') {
      claim = await updateOrCorrectPrivateClaim({
        ...params,
        input: { ...params.input, correctionReason },
      });
    }
  }

  // Payer rules, eligibility and supporting evidence can change after READY.
  // Revalidate immediately before every dispatch; READY is not a guarantee.
  claim = await validatePrivateInsuranceClaimById(params);

  if (claim.status !== 'READY') {
    throw new PrivateInsuranceError(
      'CLAIM_VALIDATION_FAILED',
      `Claim ${claim.claimNumber} failed pre-submission validation and cannot be submitted until all ERROR issues are resolved.`,
      422,
      { validationIssues: claim.validationIssues },
    );
  }

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: claim.payerCode,
  });
  const runtime = toPayerRuntimeConfig(payerRow);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;

  const submissionMode = String(
    params.input.submissionMode ??
      (runtime.integrationType === 'MANUAL' || runtime.integrationType === 'FILE_EXPORT'
        ? runtime.integrationType
        : 'ADAPTER'),
  )
    .trim()
    .toUpperCase();

  const attemptNumber = claim.submissionCount + 1;
  const correlationId = randomUUID();

  if (
    submissionMode === 'MANUAL' ||
    submissionMode === 'MANUAL_DISPATCH' ||
    submissionMode === 'FILE_EXPORT'
  ) {
    const dispatchRef = String(params.input.dispatchReference ?? '').trim();
    if (!dispatchRef || dispatchRef.length < 3) {
      throw new PrivateInsuranceError(
        'DISPATCH_REFERENCE_REQUIRED',
        `Manual / file-export claim submission requires a dispatchReference (e.g. insurer portal upload batch ID or signed courier manifest ref).`,
        400,
      );
    }

    const channel = submissionMode === 'FILE_EXPORT' ? 'FILE_EXPORT' : 'MANUAL_DISPATCH';
    const guardScope = privateGuardScope(params, claim);
    const guardId = await reserveClaimDispatch(
      { ...guardScope, attemptNumber, correlationId },
      privateGuardError,
    );

    await db.transaction(async (tx) => {
      await tx.insert(schema.privateInsuranceClaimSubmissions).values({
        claimId: claim.id,
        attemptNumber,
        adapterKey: runtime.adapterKey,
        submissionChannel: channel,
        operation: params.isResubmission ? 'CLAIM_RESUBMIT' : 'CLAIM_SUBMIT',
        correlationId,
        outcome: 'SUBMITTED_MANUAL',
        externalReference: dispatchRef,
        responseSummary: `Recorded ${channel} dispatch to ${payerRow.payerName} (Ref: ${dispatchRef}). Not an automated API transmission.`,
        submittedByUserId: params.actorUserId,
      });

      await tx
        .update(schema.privateInsuranceClaims)
        .set({
          status: 'SUBMITTED',
          submissionChannel: channel,
          externalClaimReference: dispatchRef,
          submissionCount: attemptNumber,
          submittedByUserId: params.actorUserId,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.privateInsuranceClaims.id, claim.id));

      await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
        claimId: claim.id,
        fromStatus: 'READY',
        toStatus: 'SUBMITTED',
        source: channel,
        actorUserId: params.actorUserId,
        reason: `Dispatched via ${channel} (Ref: ${dispatchRef}).`,
        metadata: { attemptNumber, dispatchRef },
      });
      await releaseClaimDispatch(tx, guardId, guardScope, 'OUTCOME_RECORDED');
    });

    await recordPrivateInsuranceAudit({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      actorUserUid: params.actorUserUid,
      actorRole: params.actorRole,
      action: params.isResubmission
        ? 'PRIVATE_INSURANCE_CLAIM_RESUBMITTED'
        : 'PRIVATE_INSURANCE_CLAIM_SUBMITTED',
      entityType: 'private_insurance_claim',
      entityId: claim.id,
      details: {
        claimNumber: claim.claimNumber,
        payerCode: claim.payerCode,
        submissionChannel: channel,
        dispatchRef,
      },
    });

    return getPrivateInsuranceClaimById({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      claimId: claim.id,
    });
  }

  // Electronic adapter submission
  let preauthRef: string | null = null;
  if (claim.preauthorizationId) {
    const [pa] = await db
      .select()
      .from(schema.insurancePreauthorizations)
      .where(
        and(
          eq(schema.insurancePreauthorizations.id, claim.preauthorizationId),
          eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
          eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
          eq(schema.insurancePreauthorizations.patientId, claim.patientId),
          eq(schema.insurancePreauthorizations.payerCode, claim.payerCode),
        ),
      )
      .limit(1);
    preauthRef = pa?.payerAuthReference ?? null;
  }

  const guardScope = privateGuardScope(params, claim);
  const guardId = await reserveClaimDispatch(
    { ...guardScope, attemptNumber, correlationId },
    privateGuardError,
  );
  let adapterRes;
  try {
    adapterRes = await adapter.submitClaim(
      {
        correlationId,
        payer: runtime,
        claimNumber: claim.claimNumber,
        idempotencyKey: claim.idempotencyKey,
        memberNumber: claim.memberPolicy.memberNumber,
        policyNumber: claim.memberPolicy.policyNumber,
        encounterType: claim.encounterType as 'OPD' | 'IPD',
        serviceDateStart: claim.serviceDateStart,
        serviceDateEnd: claim.serviceDateEnd,
        currency: claim.currency,
        grossAmount: claim.grossInvoiceAmount,
        discountAmount: claim.discountAmount,
        copayAmount: claim.confirmedCopayAmount,
        proposedClaimAmount: claim.proposedClaimAmount,
        preauthReference: preauthRef,
        visitSessionRef: claim.visitSessionRef,
        diagnoses: claim.diagnosesSnapshot,
        lines: claim.lines.map((l) => ({
          lineNumber: l.lineNumber,
          payerServiceCode: l.payerServiceCode ?? 'UNMAPPED',
          description: l.itemDescription,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          grossAmount: l.grossAmount,
          copayAmount: l.copayAmount,
          proposedClaimAmount: l.proposedClaimAmount,
          serviceDate: l.serviceDate,
        })),
      },
      secrets,
    );
  } catch {
    await db.transaction(async (tx) => {
      await markClaimDispatchUncertain(tx, guardId, guardScope);
    });
    throw new PrivateInsuranceError(
      'CLAIM_DISPATCH_REVIEW_REQUIRED',
      'The insurer dispatch outcome is uncertain. Check the payer record; do not blindly retry.',
      409,
    );
  }

  if (!adapterRes.supported) {
    await recordIntegrationDiagnostic({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode: claim.payerCode,
      adapterKey: runtime.adapterKey,
      environment: runtime.environment,
      operation: 'CLAIM_SUBMIT',
      outcome: adapterRes.code,
      correlationId,
      summary: adapterRes.message,
      actorUserId: params.actorUserId,
    });

    // supported:false guarantees that the adapter performed no dispatch.
    await db.transaction(async (tx) => {
      await releaseClaimDispatch(tx, guardId, guardScope, 'NOT_SENT');
    });
    throw new PrivateInsuranceError(adapterRes.code, adapterRes.message, 422, {
      requiredFromInsurer: adapterRes.requiredFromInsurer,
    });
  }

  if (adapterRes.outcome === 'FAILED_TRANSPORT') {
    await db.transaction(async (tx) => {
      await tx.insert(schema.privateInsuranceClaimSubmissions).values({
        claimId: claim.id,
        attemptNumber,
        adapterKey: runtime.adapterKey,
        submissionChannel: adapterRes.submissionChannel,
        operation: params.isResubmission ? 'CLAIM_RESUBMIT' : 'CLAIM_SUBMIT',
        correlationId,
        httpStatus: adapterRes.httpStatus ?? null,
        outcome: 'FAILED_TRANSPORT',
        errorCode: adapterRes.errorCode ?? 'TRANSPORT_ERROR',
        responseSummary: adapterRes.responseSummary,
        submittedByUserId: params.actorUserId,
      });
      await tx
        .update(schema.privateInsuranceClaims)
        .set({ submissionCount: attemptNumber, updatedAt: new Date() })
        .where(eq(schema.privateInsuranceClaims.id, claim.id));
      await markClaimDispatchUncertain(tx, guardId, guardScope);
    });
    throw new PrivateInsuranceError(
      'CLAIM_DISPATCH_REVIEW_REQUIRED',
      'The insurer dispatch outcome is uncertain. Check the payer record; do not blindly retry.',
      409,
    );
  }

  const nextStatus: PrivateClaimStatus =
    adapterRes.outcome === 'REJECTED'
      ? 'REJECTED'
      : adapterRes.outcome === 'ACKNOWLEDGED'
        ? 'ACKNOWLEDGED'
        : 'SUBMITTED';

  await db.transaction(async (tx) => {
    await tx.insert(schema.privateInsuranceClaimSubmissions).values({
      claimId: claim.id,
      attemptNumber,
      adapterKey: runtime.adapterKey,
      submissionChannel: adapterRes.submissionChannel,
      operation: params.isResubmission ? 'CLAIM_RESUBMIT' : 'CLAIM_SUBMIT',
      correlationId,
      httpStatus: adapterRes.httpStatus ?? null,
      outcome: adapterRes.outcome,
      externalReference: adapterRes.externalReference,
      responseSummary: adapterRes.responseSummary,
      submittedByUserId: params.actorUserId,
    });

    await tx
      .update(schema.privateInsuranceClaims)
      .set({
        status: nextStatus,
        submissionChannel: adapterRes.submissionChannel,
        externalClaimReference: adapterRes.externalReference ?? claim.externalClaimReference,
        rejectionCode: adapterRes.rejectionCode ?? null,
        rejectionReason: adapterRes.rejectionReason ?? null,
        submissionCount: attemptNumber,
        submittedByUserId: params.actorUserId,
        submittedAt: new Date(),
        acknowledgedAt: nextStatus === 'ACKNOWLEDGED' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.privateInsuranceClaims.id, claim.id));

    await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
      claimId: claim.id,
      fromStatus: 'READY',
      toStatus: nextStatus,
      source: adapterRes.submissionChannel,
      actorUserId: params.actorUserId,
      reason: adapterRes.responseSummary,
      metadata: {
        attemptNumber,
        externalReference: adapterRes.externalReference,
        correlationId,
      },
    });
    await releaseClaimDispatch(tx, guardId, guardScope, 'OUTCOME_RECORDED');
  });

  await recordIntegrationDiagnostic({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: claim.payerCode,
    adapterKey: runtime.adapterKey,
    environment: runtime.environment,
    operation: 'CLAIM_SUBMIT',
    outcome: adapterRes.outcome,
    httpStatus: adapterRes.httpStatus ?? null,
    durationMs: adapterRes.durationMs,
    correlationId,
    summary: adapterRes.responseSummary,
    actorUserId: params.actorUserId,
  });

  return getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: claim.id,
  });
}

export async function recordPrivateClaimDecision(params: {
  tenantId: number;
  facilityId: number;
  claimId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const claim = await getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: params.claimId,
  });

  const nextStatus = String(params.input.status ?? '')
    .trim()
    .toUpperCase() as PrivateClaimStatus;

  if (nextStatus === 'PAID')
    throw new PrivateInsuranceError(
      'RECONCILIATION_REQUIRED',
      'A claim can only be marked paid by matching an existing billing receipt.',
      409,
    );
  if (
    ['ADJUDICATED', 'PARTIALLY_ADJUDICATED'].includes(nextStatus) &&
    (params.input.approvedAmount === undefined ||
      params.input.approvedAmount === null ||
      params.input.approvedAmount === '')
  )
    throw new PrivateInsuranceError(
      'APPROVED_AMOUNT_REQUIRED',
      'Enter the actual payer-approved amount.',
      400,
    );

  if (
    ['ADJUDICATED', 'PARTIALLY_ADJUDICATED', 'REJECTED'].includes(nextStatus) &&
    !(
      typeof params.input.externalClaimReference === 'string' &&
      params.input.externalClaimReference.trim().length >= 3
    )
  )
    throw new PrivateInsuranceError(
      'PAYER_DECISION_REFERENCE_REQUIRED',
      'Record the actual insurer decision reference.',
      400,
    );

  if (!canTransitionPrivateClaimStatus(claim.status as PrivateClaimStatus, nextStatus)) {
    throw new PrivateInsuranceError(
      'INVALID_CLAIM_TRANSITION',
      `Invalid claim status transition from ${claim.status} to ${nextStatus}.`,
      409,
    );
  }

  let approvedAmount = claim.approvedAmount;
  if (
    params.input.approvedAmount !== undefined &&
    params.input.approvedAmount !== null &&
    params.input.approvedAmount !== ''
  ) {
    approvedAmount = formatCents(
      moneyToCentsStrict(params.input.approvedAmount as string | number, 'Approved amount'),
    );
  }

  const rejectionReason =
    typeof params.input.rejectionReason === 'string' && params.input.rejectionReason.trim()
      ? params.input.rejectionReason.trim()
      : claim.rejectionReason;

  if (nextStatus === 'REJECTED' && !rejectionReason) {
    throw new PrivateInsuranceError(
      'REJECTION_REASON_REQUIRED',
      'Recording a REJECTED claim status requires rejectionReason.',
      400,
    );
  }

  await db.transaction(async (tx) => {
    await lockMutableClaim(tx, privateGuardScope(params, claim), privateGuardError);
    await tx
      .update(schema.privateInsuranceClaims)
      .set({
        status: nextStatus,
        externalClaimReference:
          typeof params.input.externalClaimReference === 'string' &&
          params.input.externalClaimReference.trim()
            ? params.input.externalClaimReference.trim()
            : claim.externalClaimReference,
        approvedAmount,
        rejectionCode:
          typeof params.input.rejectionCode === 'string'
            ? params.input.rejectionCode
            : claim.rejectionCode,
        rejectionReason,
        adjudicationNotes:
          typeof params.input.adjudicationNotes === 'string'
            ? params.input.adjudicationNotes
            : claim.adjudicationNotes,
        acknowledgedAt: nextStatus === 'ACKNOWLEDGED' ? new Date() : claim.acknowledgedAt,
        adjudicatedAt:
          nextStatus === 'ADJUDICATED' || nextStatus === 'PARTIALLY_ADJUDICATED'
            ? new Date()
            : claim.adjudicatedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.privateInsuranceClaims.id, claim.id));

    await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
      claimId: claim.id,
      fromStatus: claim.status,
      toStatus: nextStatus,
      source: 'MANUAL_INSURER_DECISION',
      actorUserId: params.actorUserId,
      reason:
        rejectionReason ??
        (typeof params.input.adjudicationNotes === 'string'
          ? params.input.adjudicationNotes
          : `Status updated to ${nextStatus}.`),
      metadata: { approvedAmount },
    });
  });

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_CLAIM_STATUS_UPDATED',
    entityType: 'private_insurance_claim',
    entityId: claim.id,
    details: {
      claimNumber: claim.claimNumber,
      fromStatus: claim.status,
      toStatus: nextStatus,
      approvedAmount,
    },
  });

  return getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: claim.id,
  });
}

export async function queryPrivateClaimStatus(params: {
  tenantId: number;
  facilityId: number;
  claimId: number;
  actorUserId: number;
}) {
  const claim = await getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: params.claimId,
  });

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: claim.payerCode,
  });
  const runtime = toPayerRuntimeConfig(payerRow);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;

  if (!claim.externalClaimReference) {
    return {
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      payerCode: claim.payerCode,
      status: claim.status,
      liveStatusChecked: false,
      message: 'Claim has no external insurer reference yet.',
      claim,
    };
  }

  const adapterStatus = await adapter.queryClaimStatus(
    runtime,
    claim.externalClaimReference,
    randomUUID(),
    secrets,
  );

  if (!adapterStatus.supported) {
    return {
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      payerCode: claim.payerCode,
      status: claim.status,
      liveStatusChecked: false,
      capabilityCode: adapterStatus.code,
      message: adapterStatus.message,
      claim,
    };
  }

  if (
    adapterStatus.status !== claim.status &&
    canTransitionPrivateClaimStatus(claim.status as PrivateClaimStatus, adapterStatus.status)
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.privateInsuranceClaims)
        .set({
          status: adapterStatus.status,
          approvedAmount: adapterStatus.approvedAmount ?? claim.approvedAmount,
          rejectionCode: adapterStatus.rejectionCode ?? claim.rejectionCode,
          rejectionReason: adapterStatus.rejectionReason ?? claim.rejectionReason,
          adjudicationNotes: adapterStatus.adjudicationNotes ?? claim.adjudicationNotes,
          updatedAt: new Date(),
        })
        .where(eq(schema.privateInsuranceClaims.id, claim.id));

      await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
        claimId: claim.id,
        fromStatus: claim.status,
        toStatus: adapterStatus.status,
        source: 'LIVE_ADAPTER_POLL',
        actorUserId: params.actorUserId,
        reason: adapterStatus.summary,
        metadata: {},
      });
    });
  }

  const refreshed = await getPrivateInsuranceClaimById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    claimId: claim.id,
  });

  return {
    claimId: refreshed.id,
    claimNumber: refreshed.claimNumber,
    payerCode: refreshed.payerCode,
    status: refreshed.status,
    liveStatusChecked: true,
    message: adapterStatus.summary,
    claim: refreshed,
  };
}
