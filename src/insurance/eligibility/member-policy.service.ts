/**
 * JaliCare HMIS — Member Registration & Policy Management Service
 *
 * Links existing JaliCare patients to one or more private insurance
 * memberships (Britam, PACIS, etc.) with duplicate prevention,
 * principal/dependent tracking, and auditable corrections.
 *
 * Locally entered policy data is ALWAYS marked `UNVERIFIED_LOCAL` until
 * verified by an explicit manual review with evidence or a live payer API.
 */

import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { findFacilityPatient } from '../hub/patient-scope.ts';
import * as schema from '../../db/schema.ts';
import { PrivateInsuranceError } from '../core/types.ts';
import { recordPrivateInsuranceAudit } from '../audit/diagnostics.service.ts';
import { getPayerRowScoped } from '../payers/payer-config.service.ts';

const VALID_MEMBER_ROLES = new Set(['PRINCIPAL', 'SPOUSE', 'CHILD', 'DEPENDENT']);
const VALID_EVIDENCE_SOURCES = new Set([
  'UNVERIFIED_ENTRY',
  'CARD_PRESENTED',
  'COVER_NOTE',
  'EMPLOYER_LETTER',
  'PAYER_PORTAL_MANUAL',
  'LIVE_PAYER_API',
]);

export function checkDuplicateMemberPolicyRule(params: {
  existingForSamePatient: boolean;
  existingPrincipalOnOtherPatient: boolean;
  memberRole: string;
}): { duplicate: boolean; code?: string; message?: string } {
  if (params.existingForSamePatient) {
    return {
      duplicate: true,
      code: 'DUPLICATE_MEMBER_POLICY',
      message:
        'This patient already has a membership record with the same insurer and member number at this facility.',
    };
  }
  if (params.existingPrincipalOnOtherPatient && params.memberRole === 'PRINCIPAL') {
    return {
      duplicate: true,
      code: 'MEMBER_NUMBER_CONFLICT',
      message:
        'This member number is already registered as a PRINCIPAL member for another patient under the same insurer. Register dependents with memberRole SPOUSE/CHILD/DEPENDENT or use a distinct member suffix.',
    };
  }
  return { duplicate: false };
}

export async function listInsuranceMembers(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  patientId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  const conditions = [
    eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
    eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
  ];

  if (params.payerCode) {
    conditions.push(
      eq(schema.insuranceMemberPolicies.payerCode, params.payerCode.trim().toUpperCase()),
    );
  }
  if (params.patientId) {
    conditions.push(eq(schema.insuranceMemberPolicies.patientId, params.patientId));
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(schema.insuranceMemberPolicies.memberNumber, q),
        ilike(schema.insuranceMemberPolicies.policyNumber, q),
        ilike(schema.insuranceMemberPolicies.schemeName, q),
        ilike(schema.insuranceMemberPolicies.planName, q),
      )!,
    );
  }

  const rows = await db
    .select({
      policy: schema.insuranceMemberPolicies,
      patientFirstName: schema.patients.firstName,
      patientLastName: schema.patients.lastName,
      patientGender: schema.patients.gender,
      patientDob: schema.patients.dateOfBirth,
    })
    .from(schema.insuranceMemberPolicies)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.insuranceMemberPolicies.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.insuranceMemberPolicies.updatedAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r.policy,
    patientName: `${r.patientFirstName} ${r.patientLastName}`.trim(),
    patientGender: r.patientGender,
    patientDob: r.patientDob,
  }));
}

export async function getInsuranceMemberById(params: {
  tenantId: number;
  facilityId: number;
  memberId: number;
}) {
  const [row] = await db
    .select({
      policy: schema.insuranceMemberPolicies,
      patientFirstName: schema.patients.firstName,
      patientLastName: schema.patients.lastName,
      patientGender: schema.patients.gender,
      patientDob: schema.patients.dateOfBirth,
    })
    .from(schema.insuranceMemberPolicies)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.insuranceMemberPolicies.patientId))
    .where(
      and(
        eq(schema.insuranceMemberPolicies.id, params.memberId),
        eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
        eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new PrivateInsuranceError(
      'MEMBER_POLICY_NOT_FOUND',
      'Insurance membership policy was not found in this facility.',
      404,
    );
  }

  return {
    ...row.policy,
    patientName: `${row.patientFirstName} ${row.patientLastName}`.trim(),
    patientGender: row.patientGender,
    patientDob: row.patientDob,
  };
}

export async function createInsuranceMemberPolicy(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const patientId = Number(params.input.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new PrivateInsuranceError(
      'INVALID_PATIENT_ID',
      'Valid JaliCare patientId is required.',
      400,
    );
  }

  const patient = await findFacilityPatient(params.tenantId, params.facilityId, patientId);

  if (!patient) {
    throw new PrivateInsuranceError(
      'PATIENT_NOT_FOUND',
      'Existing JaliCare patient was not found for this tenant.',
      404,
    );
  }

  const payerCode = String(params.input.payerCode ?? '')
    .trim()
    .toUpperCase();
  if (!payerCode) {
    throw new PrivateInsuranceError(
      'PAYER_CODE_REQUIRED',
      'payerCode (e.g. BRITAM or PACIS) is required.',
      400,
    );
  }

  // Ensure the insurer exists in this facility
  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode,
  });

  const memberNumber = String(params.input.memberNumber ?? '').trim();
  if (!memberNumber || memberNumber.length < 3) {
    throw new PrivateInsuranceError(
      'INVALID_MEMBER_NUMBER',
      'Insurer memberNumber (at least 3 characters) is required.',
      400,
    );
  }

  const memberRole = String(params.input.memberRole ?? 'PRINCIPAL')
    .trim()
    .toUpperCase();
  if (!VALID_MEMBER_ROLES.has(memberRole)) {
    throw new PrivateInsuranceError(
      'INVALID_MEMBER_ROLE',
      'memberRole must be PRINCIPAL, SPOUSE, CHILD, or DEPENDENT.',
      400,
    );
  }

  const evidenceSource = String(params.input.evidenceSource ?? 'UNVERIFIED_ENTRY')
    .trim()
    .toUpperCase();
  if (!VALID_EVIDENCE_SOURCES.has(evidenceSource) || evidenceSource === 'LIVE_PAYER_API') {
    throw new PrivateInsuranceError(
      'INVALID_EVIDENCE_SOURCE',
      'Manual registration cannot claim LIVE_PAYER_API as evidence source.',
      400,
    );
  }

  const validFrom =
    typeof params.input.validFrom === 'string' && params.input.validFrom.trim()
      ? params.input.validFrom.trim()
      : null;
  const validTo =
    typeof params.input.validTo === 'string' && params.input.validTo.trim()
      ? params.input.validTo.trim()
      : null;
  if (validFrom && validTo && validTo < validFrom) {
    throw new PrivateInsuranceError(
      'INVALID_POLICY_DATES',
      'Policy validTo date cannot precede validFrom date.',
      400,
    );
  }

  // Duplicate check across same patient & across other patients
  const existingMatches = await db
    .select()
    .from(schema.insuranceMemberPolicies)
    .where(
      and(
        eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
        eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
        eq(schema.insuranceMemberPolicies.payerCode, payerRow.payerCode),
        eq(schema.insuranceMemberPolicies.memberNumber, memberNumber),
      ),
    );

  const dupCheck = checkDuplicateMemberPolicyRule({
    existingForSamePatient: existingMatches.some((m) => m.patientId === patientId),
    existingPrincipalOnOtherPatient: existingMatches.some(
      (m) => m.patientId !== patientId && m.memberRole === 'PRINCIPAL' && m.status === 'ACTIVE',
    ),
    memberRole,
  });

  if (dupCheck.duplicate) {
    throw new PrivateInsuranceError(dupCheck.code!, dupCheck.message!, 409);
  }

  const [created] = await db
    .insert(schema.insuranceMemberPolicies)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      patientId,
      payerCode: payerRow.payerCode,
      memberNumber,
      policyNumber:
        typeof params.input.policyNumber === 'string' && params.input.policyNumber.trim()
          ? params.input.policyNumber.trim()
          : null,
      schemeName:
        typeof params.input.schemeName === 'string' && params.input.schemeName.trim()
          ? params.input.schemeName.trim()
          : null,
      planName:
        typeof params.input.planName === 'string' && params.input.planName.trim()
          ? params.input.planName.trim()
          : null,
      memberRole,
      principalMemberName:
        typeof params.input.principalMemberName === 'string' &&
        params.input.principalMemberName.trim()
          ? params.input.principalMemberName.trim()
          : null,
      principalMemberNumber:
        typeof params.input.principalMemberNumber === 'string' &&
        params.input.principalMemberNumber.trim()
          ? params.input.principalMemberNumber.trim()
          : null,
      relationshipToPrincipal:
        typeof params.input.relationshipToPrincipal === 'string' &&
        params.input.relationshipToPrincipal.trim()
          ? params.input.relationshipToPrincipal.trim()
          : memberRole === 'PRINCIPAL'
            ? 'SELF'
            : null,
      externalMemberId:
        typeof params.input.externalMemberId === 'string' && params.input.externalMemberId.trim()
          ? params.input.externalMemberId.trim()
          : null,
      validFrom,
      validTo,
      facilityRestrictions: Array.isArray(params.input.facilityRestrictions)
        ? params.input.facilityRestrictions.map(String)
        : [],
      schemeRestrictions: Array.isArray(params.input.schemeRestrictions)
        ? params.input.schemeRestrictions.map(String)
        : [],
      evidenceSource,
      // Local entry is NEVER treated as payer-confirmed eligibility
      verificationStatus: 'UNVERIFIED_LOCAL',
      manualReviewStatus: 'PENDING_REVIEW',
      manualReviewNotes:
        typeof params.input.manualReviewNotes === 'string' ? params.input.manualReviewNotes : null,
      status: 'ACTIVE',
      createdByUserId: params.actorUserId,
      updatedByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_MEMBER_CREATED',
    entityType: 'insurance_member_policy',
    entityId: created.id,
    details: {
      patientId,
      payerCode: created.payerCode,
      memberRole: created.memberRole,
      verificationStatus: created.verificationStatus,
    },
  });

  return getInsuranceMemberById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    memberId: created.id,
  });
}

export async function updateInsuranceMemberPolicy(params: {
  tenantId: number;
  facilityId: number;
  memberId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const existing = await getInsuranceMemberById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    memberId: params.memberId,
  });

  const correctionReason =
    typeof params.input.correctionReason === 'string' ? params.input.correctionReason.trim() : '';
  if (!correctionReason || correctionReason.length < 5) {
    throw new PrivateInsuranceError(
      'CORRECTION_REASON_REQUIRED',
      'An auditable correctionReason (minimum 5 characters) is required when updating an insurance membership record.',
      400,
    );
  }

  const updates: Partial<typeof schema.insuranceMemberPolicies.$inferInsert> = {
    correctionCount: existing.correctionCount + 1,
    lastCorrectionReason: correctionReason,
    updatedByUserId: params.actorUserId,
    updatedAt: new Date(),
  };

  if (typeof params.input.memberNumber === 'string' && params.input.memberNumber.trim()) {
    updates.memberNumber = params.input.memberNumber.trim();
  }
  if (params.input.policyNumber !== undefined) {
    updates.policyNumber =
      params.input.policyNumber && String(params.input.policyNumber).trim()
        ? String(params.input.policyNumber).trim()
        : null;
  }
  if (params.input.schemeName !== undefined) {
    updates.schemeName =
      params.input.schemeName && String(params.input.schemeName).trim()
        ? String(params.input.schemeName).trim()
        : null;
  }
  if (params.input.planName !== undefined) {
    updates.planName =
      params.input.planName && String(params.input.planName).trim()
        ? String(params.input.planName).trim()
        : null;
  }
  if (params.input.validFrom !== undefined) {
    updates.validFrom =
      params.input.validFrom && String(params.input.validFrom).trim()
        ? String(params.input.validFrom).trim()
        : null;
  }
  if (params.input.validTo !== undefined) {
    updates.validTo =
      params.input.validTo && String(params.input.validTo).trim()
        ? String(params.input.validTo).trim()
        : null;
  }
  if (Array.isArray(params.input.facilityRestrictions)) {
    updates.facilityRestrictions = params.input.facilityRestrictions.map(String);
  }
  if (Array.isArray(params.input.schemeRestrictions)) {
    updates.schemeRestrictions = params.input.schemeRestrictions.map(String);
  }
  if (typeof params.input.status === 'string') {
    const nextStatus = params.input.status.trim().toUpperCase();
    if (!['ACTIVE', 'SUSPENDED', 'SUPERSEDED', 'INACTIVE'].includes(nextStatus)) {
      throw new PrivateInsuranceError(
        'INVALID_POLICY_STATUS',
        'Unsupported membership status.',
        400,
      );
    }
    updates.status = nextStatus;
  }
  if (typeof params.input.manualReviewStatus === 'string') {
    const rev = params.input.manualReviewStatus.trim().toUpperCase();
    if (['PENDING_REVIEW', 'REVIEWED', 'FLAGGED'].includes(rev)) {
      updates.manualReviewStatus = rev;
      if (rev === 'REVIEWED') {
        updates.verifiedByUserId = params.actorUserId;
        updates.lastVerifiedAt = new Date();
      }
    }
  }
  if (params.input.manualReviewNotes !== undefined) {
    updates.manualReviewNotes =
      typeof params.input.manualReviewNotes === 'string' ? params.input.manualReviewNotes : null;
  }

  await db
    .update(schema.insuranceMemberPolicies)
    .set(updates)
    .where(eq(schema.insuranceMemberPolicies.id, existing.id));

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_MEMBER_CORRECTED',
    entityType: 'insurance_member_policy',
    entityId: existing.id,
    details: {
      payerCode: existing.payerCode,
      correctionCount: existing.correctionCount + 1,
      correctionReason,
    },
  });

  return getInsuranceMemberById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    memberId: existing.id,
  });
}
