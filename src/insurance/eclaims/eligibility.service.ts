/**
 * JaliCare HMIS
 * SHA & DHA HIE Patient Identity Resolution (CR ID) & Eligibility Verification Service
 *
 * Strictly distinguishes:
 *   - Eligible               (only confirmed payer response with isAlive !== false)
 *   - Ineligible             (confirmed payer response or deceased beneficiary isAlive === false)
 *   - Pending                (confirmed pending activation / transition)
 *   - Unable to verify       (API down, timeout, missing credentials, invalid payload)
 *   - Manual review required (identity conflict / household review flagged)
 *
 * Follows DHA HIE Client Registry best practice: resolve `CR ID` via Patient Search
 * and prefer `CLIENT_REGISTRY_ID` (`ClientRegistry ID`) on all subsequent SHA calls.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { maskIdentifier } from '../../integrations/dha/dha.eligibility.ts';
import { openPatientIdentifiers } from '../../security/patient-identifiers.ts';
import {
  defaultShaGatewayAdapter,
  type PayerGatewayAdapter,
} from '../../integrations/sha/sha.adapter.ts';
import { getFacilityPayerConfig } from './configuration.service.ts';
import {
  InsuranceDomainError,
  loadScopedFacility,
  loadTenantPatient,
  recordInsuranceAuditEvent,
  type InsuranceActorScope,
} from './contracts.ts';

export const ALLOWED_SHA_IDENTIFICATION_TYPES = [
  'CLIENT_REGISTRY_ID',
  'SHA_NUMBER',
  'NATIONAL_ID',
  'BIRTH_NOTIFICATION',
  'BIRTH_CERTIFICATE',
  'ALIEN_ID',
  'REFUGEE_ID',
  'MANDATE_NUMBER',
  'PASSPORT',
] as const;

export type ShaIdentificationType = (typeof ALLOWED_SHA_IDENTIFICATION_TYPES)[number];

export interface ResolvePatientIdentityInput {
  patientId: number;
  identificationType?: ShaIdentificationType;
  identificationValue?: string | null;
}

export interface CheckPatientEligibilityInput {
  patientId: number;
  encounterId?: number | null;
  payerCode?: string;
  identificationType?: ShaIdentificationType;
  identificationValue?: string | null;
  intendedServiceArea?: string | null;
}

async function resolvePatientIdentifierForSha(
  patient: typeof schema.patients.$inferSelect,
  explicitType?: ShaIdentificationType,
  explicitValue?: string | null,
  preferCrId = true,
): Promise<{ idType: ShaIdentificationType; idValue: string }> {
  let idType: ShaIdentificationType = explicitType ?? 'CLIENT_REGISTRY_ID';
  let idValue = explicitValue?.trim() || null;

  if (!idValue) {
    if (preferCrId && !explicitType && patient.dhaClientRegistryId?.trim()) {
      idType = 'CLIENT_REGISTRY_ID';
      idValue = patient.dhaClientRegistryId.trim();
    } else if (explicitType === 'CLIENT_REGISTRY_ID' && patient.dhaClientRegistryId?.trim()) {
      idType = 'CLIENT_REGISTRY_ID';
      idValue = patient.dhaClientRegistryId.trim();
    } else if (explicitType === 'NATIONAL_ID' && patient.nationalId?.trim()) {
      idType = 'NATIONAL_ID';
      idValue = patient.nationalId.trim();
    } else if (patient.dhaClientRegistryId?.trim()) {
      idType = 'CLIENT_REGISTRY_ID';
      idValue = patient.dhaClientRegistryId.trim();
    } else if (patient.shaNumber?.trim()) {
      idType = /^CR/i.test(patient.shaNumber.trim()) ? 'CLIENT_REGISTRY_ID' : 'SHA_NUMBER';
      idValue = patient.shaNumber.trim();
    } else if (patient.nationalId?.trim()) {
      idType = 'NATIONAL_ID';
      idValue = patient.nationalId.trim();
    } else {
      const extraIds = await db
        .select()
        .from(schema.patientIdentifiers)
        .where(eq(schema.patientIdentifiers.patientId, patient.id));

      for (const row of extraIds) {
        const normalizedType = row.idType.toUpperCase();
        const val = row.idValue.trim();
        if (!val) continue;
        if (normalizedType === 'CLIENT_REGISTRY_ID' || normalizedType === 'CR_ID') {
          idType = 'CLIENT_REGISTRY_ID';
          idValue = val;
          break;
        }
        if (normalizedType === 'SHA' || normalizedType === 'SHA_NUMBER') {
          idType = 'SHA_NUMBER';
          idValue = val;
          break;
        }
        if (normalizedType === 'NATIONAL_ID') {
          idType = 'NATIONAL_ID';
          idValue = val;
          break;
        }
        if (normalizedType === 'BIRTH_NOTIFICATION') {
          idType = 'BIRTH_NOTIFICATION';
          idValue = val;
          break;
        }
        if (normalizedType === 'BIRTH_CERTIFICATE') {
          idType = 'BIRTH_CERTIFICATE';
          idValue = val;
          break;
        }
        if (normalizedType === 'ALIEN_ID') {
          idType = 'ALIEN_ID';
          idValue = val;
          break;
        }
        if (normalizedType === 'REFUGEE_ID') {
          idType = 'REFUGEE_ID';
          idValue = val;
          break;
        }
        if (normalizedType === 'MANDATE_NUMBER') {
          idType = 'MANDATE_NUMBER';
          idValue = val;
          break;
        }
        if (normalizedType === 'PASSPORT') {
          idType = 'PASSPORT';
          idValue = val;
          break;
        }
      }
    }
  }

  if (!ALLOWED_SHA_IDENTIFICATION_TYPES.includes(idType)) {
    throw new InsuranceDomainError(
      'INVALID_IDENTIFICATION_TYPE',
      `identificationType must be one of: ${ALLOWED_SHA_IDENTIFICATION_TYPES.join(', ')}.`,
      400,
    );
  }

  if (!idValue || idValue.length < 4) {
    throw new InsuranceDomainError(
      'MISSING_SHA_IDENTIFIER',
      'Patient has no Client Registry ID, SHA Number, National ID, Birth Certificate/Notification, Alien/Refugee ID, or Mandate Number on file. Update patient identifiers or supply one.',
      400,
    );
  }

  return { idType, idValue };
}

/**
 * Workflow 1a: Resolve patient identity (`CR ID`) from DHA Client Registry (`GET /patients`).
 * Never overwrites local JaliCare demographics with simulated data.
 */
export async function resolvePatientClientRegistryIdentity(
  scope: InsuranceActorScope,
  input: ResolvePatientIdentityInput,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const rawPatient = await loadTenantPatient(scope.tenantId, input.patientId);
  const patient = { ...rawPatient, ...openPatientIdentifiers(rawPatient) };
  const { idType, idValue } = await resolvePatientIdentifierForSha(
    patient,
    input.identificationType,
    input.identificationValue,
    false,
  );

  const { config: payerConfig } = await getFacilityPayerConfig(scope, 'SHA');

  if (!adapter.searchClientRegistryPatient) {
    throw new InsuranceDomainError(
      'CAPABILITY_UNAVAILABLE',
      'Configured SHA gateway adapter does not support Client Registry patient search.',
      501,
    );
  }

  const registryResult = await adapter.searchClientRegistryPatient({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: payerConfig.facilityRegistryCode,
    identificationType: idType,
    identificationValue: idValue,
  });

  if (
    registryResult.found &&
    registryResult.crId &&
    !registryResult.isSimulated &&
    registryResult.source === 'AUTHORITATIVE_PAYER'
  ) {
    await db
      .update(schema.patients)
      .set({
        dhaClientRegistryId: registryResult.crId,
      })
      .where(eq(schema.patients.id, patient.id));
  }

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_CLIENT_REGISTRY_SEARCHED',
    resource: 'patients',
    resourceId: patient.id,
    summary: {
      patientId: patient.id,
      identificationType: idType,
      identificationHint: maskIdentifier(idValue),
      found: registryResult.found,
      crId: registryResult.crId,
      isAlive: registryResult.isAlive,
      source: registryResult.source,
      isSimulated: registryResult.isSimulated,
      correlationId: registryResult.correlationId,
    },
  });

  return {
    registry: registryResult,
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      fullName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      dhaClientRegistryId:
        !registryResult.isSimulated && registryResult.crId
          ? registryResult.crId
          : (patient.dhaClientRegistryId ?? null),
    },
  };
}

/**
 * Workflow 1b: Verify SHA beneficiary eligibility (`GET /patients/eligibility`).
 */
export async function checkPatientEligibility(
  scope: InsuranceActorScope,
  input: CheckPatientEligibilityInput,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const rawPatient = await loadTenantPatient(scope.tenantId, input.patientId);
  const patient = { ...rawPatient, ...openPatientIdentifiers(rawPatient) };
  const payerCode = (input.payerCode ?? adapter.payerCode).trim().toUpperCase();

  let validatedEncounterId: number | null = null;
  if (input.encounterId !== undefined && input.encounterId !== null) {
    const [encounter] = await db
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, input.encounterId),
          eq(schema.encounters.tenantId, scope.tenantId),
          eq(schema.encounters.facilityId, scope.facilityId),
          eq(schema.encounters.patientId, patient.id),
        ),
      )
      .limit(1);

    if (!encounter) {
      throw new InsuranceDomainError(
        'ENCOUNTER_NOT_FOUND',
        'Selected encounter does not belong to this patient at the active facility.',
        404,
      );
    }
    validatedEncounterId = encounter.id;
  }

  const { idType, idValue } = await resolvePatientIdentifierForSha(
    patient,
    input.identificationType,
    input.identificationValue,
    true,
  );

  const { config: payerConfig } = await getFacilityPayerConfig(scope, payerCode);

  const gatewayResult = await adapter.checkEligibility({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: payerConfig.facilityRegistryCode,
    identificationType: idType,
    identificationValue: idValue,
  });

  const maskedHint = maskIdentifier(idValue);

  const [saved] = await db
    .insert(schema.insuranceEligibilityVerifications)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      patientId: patient.id,
      encounterId: validatedEncounterId,
      payerCode,
      identificationType: idType,
      identificationHint: maskedHint,
      intendedServiceArea: input.intendedServiceArea?.trim().toUpperCase() || null,
      outcome: gatewayResult.outcome,
      source: gatewayResult.source,
      isSimulated: gatewayResult.isSimulated,
      payerReference: gatewayResult.payerReference,
      memberCrNumber: gatewayResult.memberCrNumber,
      memberStatus: gatewayResult.memberStatus,
      isAlive: gatewayResult.isAlive,
      facilityBiometricsEnforced: gatewayResult.facilityBiometricsEnforced,
      whitelistedForOtp: gatewayResult.whitelistedForOtp,
      schemes: gatewayResult.schemes,
      schemeDetails: gatewayResult.schemeDetails ?? [],
      coverageStartDate: gatewayResult.coverageStartDate,
      coverageEndDate: gatewayResult.coverageEndDate,
      restrictions: gatewayResult.restrictions,
      reason: gatewayResult.reason,
      possibleSolution: gatewayResult.possibleSolution,
      responseClassification: gatewayResult.responseClassification,
      correlationId: gatewayResult.correlationId,
      checkedByUserId: scope.userId,
    })
    .returning();

  // Only update authoritative DHA cache columns when NOT simulated and outcome is confirmed
  if (
    !gatewayResult.isSimulated &&
    gatewayResult.source === 'AUTHORITATIVE_PAYER' &&
    (gatewayResult.outcome === 'Eligible' || gatewayResult.outcome === 'Ineligible')
  ) {
    await db
      .update(schema.patients)
      .set({
        dhaEligibilityStatus:
          gatewayResult.isAlive === false ? 'DECEASED' : gatewayResult.outcome.toUpperCase(),
        dhaEligibilityCheckedAt: new Date(),
        ...(gatewayResult.memberCrNumber
          ? { dhaClientRegistryId: gatewayResult.memberCrNumber }
          : {}),
      })
      .where(eq(schema.patients.id, patient.id));
  }

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_ELIGIBILITY_CHECKED',
    resource: 'insurance_eligibility_verifications',
    resourceId: saved.id,
    summary: {
      patientId: patient.id,
      encounterId: validatedEncounterId,
      payerCode,
      identificationType: idType,
      identificationHint: maskedHint,
      outcome: saved.outcome,
      isAlive: saved.isAlive,
      hasPomsfScheme: gatewayResult.hasPomsfScheme,
      source: saved.source,
      isSimulated: saved.isSimulated,
      responseClassification: saved.responseClassification,
      correlationId: saved.correlationId,
    },
  });

  return {
    verification: saved,
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      fullName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth,
      dhaClientRegistryId: patient.dhaClientRegistryId ?? gatewayResult.memberCrNumber ?? null,
    },
  };
}

export async function getEligibilityVerificationById(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  verificationId: number,
) {
  await loadScopedFacility(scope);

  const [row] = await db
    .select({
      verification: schema.insuranceEligibilityVerifications,
      patientMrn: schema.patients.mrn,
      patientFirstName: schema.patients.firstName,
      patientMiddleName: schema.patients.middleName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.insuranceEligibilityVerifications)
    .innerJoin(
      schema.patients,
      eq(schema.patients.id, schema.insuranceEligibilityVerifications.patientId),
    )
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.id, verificationId),
        eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new InsuranceDomainError(
      'ELIGIBILITY_VERIFICATION_NOT_FOUND',
      'Eligibility verification record not found in this facility.',
      404,
    );
  }

  return {
    ...row.verification,
    patientName: [row.patientFirstName, row.patientMiddleName, row.patientLastName]
      .filter(Boolean)
      .join(' '),
    patientMrn: row.patientMrn,
  };
}

export async function listPatientEligibilityHistory(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  patientId: number,
) {
  await loadScopedFacility(scope);
  const patient = await loadTenantPatient(scope.tenantId, patientId);

  const history = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
        eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(50);

  return {
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      fullName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      dhaClientRegistryId: patient.dhaClientRegistryId ?? null,
    },
    history,
  };
}

export async function listFacilityRecentEligibilityChecks(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  limit = 40,
) {
  await loadScopedFacility(scope);

  const rows = await db
    .select({
      verification: schema.insuranceEligibilityVerifications,
      patientMrn: schema.patients.mrn,
      patientFirstName: schema.patients.firstName,
      patientMiddleName: schema.patients.middleName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.insuranceEligibilityVerifications)
    .innerJoin(
      schema.patients,
      eq(schema.patients.id, schema.insuranceEligibilityVerifications.patientId),
    )
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(Math.min(100, Math.max(1, limit)));

  return rows.map((r) => ({
    ...r.verification,
    patientMrn: r.patientMrn,
    patientName: [r.patientFirstName, r.patientMiddleName, r.patientLastName]
      .filter(Boolean)
      .join(' '),
  }));
}
