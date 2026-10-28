/**
 * JaliCare HMIS — Payer-Independent Private Insurance Eligibility Service
 *
 * Supports:
 * 1. Adapter-backed eligibility verification when configured & supported.
 *    - Unavailable / unconfigured / awaiting-documentation integrations
 *      return `Not supported by current integration` or `Unable to verify`
 *      — NEVER `Ineligible` and NEVER fabricated `Eligible`.
 * 2. Explicitly labelled manual verification (`verificationMode: 'MANUAL'`)
 *    recording staff reviewer, timestamp, insurer reference number, and
 *    documentary evidence source — NEVER mislabelled as `LIVE_PAYER_API`.
 */

import { and, desc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { maskIdentifier } from '../../integrations/dha/dha.eligibility.ts';
import { openPatientIdentifiers } from '../../security/patient-identifiers.ts';
import { getPayerAdapter, inspectSecretEnvPresence } from '../core/adapter-registry.ts';
import { PrivateInsuranceError, type PrivateEligibilityOutcome } from '../core/types.ts';
import {
  recordIntegrationDiagnostic,
  recordPrivateInsuranceAudit,
} from '../audit/diagnostics.service.ts';
import { getPayerRowScoped, toPayerRuntimeConfig } from '../payers/payer-config.service.ts';

const MANUAL_ALLOWED_OUTCOMES = new Set<PrivateEligibilityOutcome>([
  'Eligible',
  'Ineligible',
  'Pending',
  'Manual review required',
  'Unable to verify',
]);

const MANUAL_EVIDENCE_SOURCES = new Set([
  'CARD_PRESENTED',
  'COVER_NOTE',
  'EMPLOYER_LETTER',
  'PAYER_PORTAL_MANUAL',
  'CALL_CENTRE_CONFIRMATION',
]);

export async function checkPrivateInsuranceEligibility(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const patientId = Number(params.input.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new PrivateInsuranceError('INVALID_PATIENT_ID', 'Valid patientId is required.', 400);
  }

  const [rawPatient] = await db
    .select()
    .from(schema.patients)
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.tenantId, params.tenantId)))
    .limit(1);

  if (!rawPatient) {
    throw new PrivateInsuranceError('PATIENT_NOT_FOUND', 'Patient not found in tenant.', 404);
  }

  const patient = openPatientIdentifiers(rawPatient);

  // Resolve member policy if provided
  let memberPolicy: typeof schema.insuranceMemberPolicies.$inferSelect | null = null;
  if (params.input.memberPolicyId !== undefined && params.input.memberPolicyId !== null) {
    const mpId = Number(params.input.memberPolicyId);
    const [found] = await db
      .select()
      .from(schema.insuranceMemberPolicies)
      .where(
        and(
          eq(schema.insuranceMemberPolicies.id, mpId),
          eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
          eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
          eq(schema.insuranceMemberPolicies.patientId, patientId),
        ),
      )
      .limit(1);
    if (!found) {
      throw new PrivateInsuranceError(
        'MEMBER_POLICY_NOT_FOUND',
        'Selected membership policy does not belong to this patient and facility.',
        404,
      );
    }
    memberPolicy = found;
  }

  const payerCode = String(params.input.payerCode ?? memberPolicy?.payerCode ?? '')
    .trim()
    .toUpperCase();
  if (!payerCode) {
    throw new PrivateInsuranceError(
      'PAYER_CODE_REQUIRED',
      'Select Britam, PACIS, or another configured insurer.',
      400,
    );
  }

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode,
  });

  if (!payerRow.isActive) {
    throw new PrivateInsuranceError(
      'PAYER_INACTIVE',
      `Insurer ${payerRow.payerName} is currently marked inactive for this facility.`,
      400,
    );
  }

  const memberNumber = String(params.input.memberNumber ?? memberPolicy?.memberNumber ?? '').trim();
  if (!memberNumber) {
    throw new PrivateInsuranceError(
      'MEMBER_NUMBER_REQUIRED',
      'Insurer member number is required for eligibility verification.',
      400,
    );
  }

  const policyNumber =
    typeof params.input.policyNumber === 'string' && params.input.policyNumber.trim()
      ? params.input.policyNumber.trim()
      : (memberPolicy?.policyNumber ?? null);

  let encounterId: number | null = null;
  if (
    params.input.encounterId !== undefined &&
    params.input.encounterId !== null &&
    params.input.encounterId !== ''
  ) {
    const encId = Number(params.input.encounterId);
    const [enc] = await db
      .select({ id: schema.encounters.id })
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, encId),
          eq(schema.encounters.tenantId, params.tenantId),
          eq(schema.encounters.facilityId, params.facilityId),
          eq(schema.encounters.patientId, patientId),
        ),
      )
      .limit(1);
    if (!enc) {
      throw new PrivateInsuranceError(
        'ENCOUNTER_NOT_FOUND',
        'Encounter was not found for this patient in the active facility.',
        404,
      );
    }
    encounterId = enc.id;
  }

  const intendedServiceArea =
    typeof params.input.intendedServiceArea === 'string' && params.input.intendedServiceArea.trim()
      ? params.input.intendedServiceArea.trim()
      : 'OPD_CONSULTATION';

  const verificationMode = String(params.input.verificationMode ?? 'ADAPTER')
    .trim()
    .toUpperCase();
  const correlationId = randomUUID();
  const maskedMemberHint = maskIdentifier(memberNumber);
  const todayStr = new Date().toISOString().slice(0, 10);

  if (verificationMode === 'MANUAL') {
    const manualOutcome = String(params.input.manualOutcome ?? '') as PrivateEligibilityOutcome;
    if (!MANUAL_ALLOWED_OUTCOMES.has(manualOutcome)) {
      throw new PrivateInsuranceError(
        'INVALID_MANUAL_OUTCOME',
        'manualOutcome must be Eligible, Ineligible, Pending, Manual review required, or Unable to verify.',
        400,
      );
    }

    const manualReference = String(params.input.manualReference ?? '').trim();
    if (!manualReference || manualReference.length < 3) {
      throw new PrivateInsuranceError(
        'MANUAL_REFERENCE_REQUIRED',
        'Manual eligibility verification requires an insurer/portal/desk reference number (minimum 3 characters).',
        400,
      );
    }

    const evidenceSource = String(params.input.evidenceSource ?? '')
      .trim()
      .toUpperCase();
    if (!MANUAL_EVIDENCE_SOURCES.has(evidenceSource)) {
      throw new PrivateInsuranceError(
        'EVIDENCE_SOURCE_REQUIRED',
        'Manual verification requires a valid evidenceSource (CARD_PRESENTED, COVER_NOTE, EMPLOYER_LETTER, PAYER_PORTAL_MANUAL, or CALL_CENTRE_CONFIRMATION).',
        400,
      );
    }

    const coverageStartDate =
      typeof params.input.coverageStartDate === 'string' && params.input.coverageStartDate.trim()
        ? params.input.coverageStartDate.trim()
        : (memberPolicy?.validFrom ?? null);
    const coverageEndDate =
      typeof params.input.coverageEndDate === 'string' && params.input.coverageEndDate.trim()
        ? params.input.coverageEndDate.trim()
        : (memberPolicy?.validTo ?? null);
    const restrictions = Array.isArray(params.input.restrictions)
      ? params.input.restrictions.map(String)
      : (memberPolicy?.facilityRestrictions ?? []);

    const [inserted] = await db
      .insert(schema.insuranceEligibilityVerifications)
      .values({
        tenantId: params.tenantId,
        facilityId: params.facilityId,
        patientId,
        memberPolicyId: memberPolicy?.id ?? null,
        encounterId,
        payerCode: payerRow.payerCode,
        identificationType: 'MEMBER_NUMBER',
        identificationHint: maskedMemberHint,
        intendedServiceArea,
        outcome: manualOutcome,
        // NEVER label a manual check as a live API verification!
        source: `MANUAL_VERIFICATION:${evidenceSource}`,
        isSimulated: false,
        payerReference: null,
        manualReference,
        evidenceDocumentRef:
          typeof params.input.evidenceDocumentRef === 'string' &&
          params.input.evidenceDocumentRef.trim()
            ? params.input.evidenceDocumentRef.trim()
            : null,
        memberStatus: manualOutcome.toUpperCase(),
        schemes: memberPolicy?.planName ? [memberPolicy.planName] : [],
        coverageStartDate,
        coverageEndDate,
        restrictions,
        reason:
          typeof params.input.notes === 'string' && params.input.notes.trim()
            ? params.input.notes.trim()
            : `Manually recorded by authorized staff via ${evidenceSource} (Ref: ${manualReference}).`,
        possibleSolution: null,
        responseClassification: `MANUAL_${manualOutcome.toUpperCase().replace(/\s+/g, '_')}`,
        correlationId,
        checkedByUserId: params.actorUserId,
      })
      .returning();

    if (memberPolicy) {
      await db
        .update(schema.insuranceMemberPolicies)
        .set({
          evidenceSource,
          verificationStatus:
            manualOutcome === 'Eligible'
              ? 'MANUALLY_VERIFIED'
              : manualOutcome === 'Ineligible'
                ? 'INACTIVE'
                : 'MANUAL_REVIEW_REQUIRED',
          manualReviewStatus: 'REVIEWED',
          lastVerifiedAt: new Date(),
          verifiedByUserId: params.actorUserId,
          updatedAt: new Date(),
        })
        .where(eq(schema.insuranceMemberPolicies.id, memberPolicy.id));
    }

    await recordPrivateInsuranceAudit({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      actorUserUid: params.actorUserUid,
      actorRole: params.actorRole,
      action: 'PRIVATE_INSURANCE_ELIGIBILITY_MANUAL_RECORDED',
      entityType: 'insurance_eligibility_verification',
      entityId: inserted.id,
      details: {
        payerCode: payerRow.payerCode,
        patientId,
        outcome: manualOutcome,
        evidenceSource,
        manualReference,
      },
    });

    return inserted;
  }

  // Adapter-backed check
  const runtime = toPayerRuntimeConfig(payerRow);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;

  const adapterResult = await adapter.verifyEligibility(
    {
      correlationId,
      payer: runtime,
      memberNumber,
      policyNumber,
      schemeName: memberPolicy?.schemeName ?? null,
      patientNationalId: patient.nationalId ?? null,
      serviceDate: todayStr,
      intendedServiceArea,
    } as any,
    secrets,
  );

  if (!adapterResult.supported) {
    const [inserted] = await db
      .insert(schema.insuranceEligibilityVerifications)
      .values({
        tenantId: params.tenantId,
        facilityId: params.facilityId,
        patientId,
        memberPolicyId: memberPolicy?.id ?? null,
        encounterId,
        payerCode: payerRow.payerCode,
        identificationType: 'MEMBER_NUMBER',
        identificationHint: maskedMemberHint,
        intendedServiceArea,
        outcome: 'Not supported by current integration',
        source: `ADAPTER_UNAVAILABLE:${runtime.adapterKey}`,
        isSimulated: false,
        payerReference: null,
        manualReference: null,
        memberStatus: null,
        schemes: memberPolicy?.planName ? [memberPolicy.planName] : [],
        coverageStartDate: memberPolicy?.validFrom ?? null,
        coverageEndDate: memberPolicy?.validTo ?? null,
        restrictions: memberPolicy?.facilityRestrictions ?? [],
        reason: adapterResult.message,
        possibleSolution:
          'Use the explicitly labelled Manual Verification workflow with card/portal/desk reference while insurer API credentials/specifications are pending.',
        responseClassification: adapterResult.code,
        correlationId,
        checkedByUserId: params.actorUserId,
      })
      .returning();

    await recordIntegrationDiagnostic({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode: payerRow.payerCode,
      adapterKey: runtime.adapterKey,
      environment: runtime.environment,
      operation: 'ELIGIBILITY_VERIFY',
      outcome: adapterResult.code,
      correlationId,
      summary: adapterResult.message,
      actorUserId: params.actorUserId,
    });

    return {
      ...inserted,
      requiredFromInsurer: adapterResult.requiredFromInsurer,
    };
  }

  // Live / Gateway adapter returned a structured response
  const [inserted] = await db
    .insert(schema.insuranceEligibilityVerifications)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      patientId,
      memberPolicyId: memberPolicy?.id ?? null,
      encounterId,
      payerCode: payerRow.payerCode,
      identificationType: 'MEMBER_NUMBER',
      identificationHint: maskedMemberHint,
      intendedServiceArea,
      outcome: adapterResult.outcome,
      source: adapterResult.source,
      isSimulated: false,
      payerReference: adapterResult.payerReference,
      visitSessionRef: adapterResult.visitSessionRef,
      memberStatus: adapterResult.memberStatus,
      schemes: adapterResult.planName ? [adapterResult.planName] : [],
      coverageStartDate: adapterResult.coverageStartDate,
      coverageEndDate: adapterResult.coverageEndDate,
      restrictions: adapterResult.restrictions,
      reason: adapterResult.reason,
      responseClassification: adapterResult.responseClassification,
      correlationId,
      checkedByUserId: params.actorUserId,
    })
    .returning();

  if (memberPolicy && adapterResult.outcome === 'Eligible') {
    await db
      .update(schema.insuranceMemberPolicies)
      .set({
        evidenceSource: 'LIVE_PAYER_API',
        verificationStatus: 'PAYER_API_VERIFIED',
        lastVerifiedAt: new Date(),
        verifiedByUserId: params.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(schema.insuranceMemberPolicies.id, memberPolicy.id));
  }

  await recordIntegrationDiagnostic({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: payerRow.payerCode,
    adapterKey: runtime.adapterKey,
    environment: runtime.environment,
    operation: 'ELIGIBILITY_VERIFY',
    outcome: adapterResult.responseClassification,
    httpStatus: adapterResult.httpStatus ?? null,
    durationMs: adapterResult.durationMs,
    correlationId,
    summary: adapterResult.reason,
    actorUserId: params.actorUserId,
  });

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_ELIGIBILITY_CHECKED',
    entityType: 'insurance_eligibility_verification',
    entityId: inserted.id,
    details: {
      payerCode: payerRow.payerCode,
      patientId,
      outcome: adapterResult.outcome,
      source: adapterResult.source,
    },
  });

  return inserted;
}

export async function getEligibilityVerificationById(params: {
  tenantId: number;
  facilityId: number;
  verificationId: number;
}) {
  const [row] = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.id, params.verificationId),
        eq(schema.insuranceEligibilityVerifications.tenantId, params.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new PrivateInsuranceError(
      'VERIFICATION_NOT_FOUND',
      'Eligibility verification record was not found.',
      404,
    );
  }
  return row;
}

export async function listPrivateEligibilityVerifications(params: {
  tenantId: number;
  facilityId: number;
  patientId?: number;
  payerCode?: string;
  limit?: number;
}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const conditions = [
    eq(schema.insuranceEligibilityVerifications.tenantId, params.tenantId),
    eq(schema.insuranceEligibilityVerifications.facilityId, params.facilityId),
  ];
  if (params.payerCode) {
    conditions.push(
      eq(schema.insuranceEligibilityVerifications.payerCode, params.payerCode.trim().toUpperCase()),
    );
  } else {
    conditions.push(ne(schema.insuranceEligibilityVerifications.payerCode, 'SHA'));
  }
  if (params.patientId) {
    conditions.push(eq(schema.insuranceEligibilityVerifications.patientId, params.patientId));
  }

  return db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(and(...conditions))
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(limit);
}
