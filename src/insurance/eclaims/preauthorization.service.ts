/**
 * JaliCare HMIS
 * SHA & DHA HIE Beneficiary Consent, Visit Authorization & Preauthorization Service
 *
 * Implements:
 *   - DHA HIE Beneficiary Consent & Visit Authorization (`POST /claims/authorize`,
 *     `POST /claims/visit`, `POST /authorizations/covers`; `AUTHORIZED` vs
 *     `AUTHORIZED_PENDING_VISIT` for elective pre-visit preauths).
 *   - Kenya eClaims FHIR R4 Transaction T-02 (`Claim.use = "preauthorization"`,
 *     including Surgical, Renal, Oncology, Optical, and Imaging profiles) AND
 *     DHA HIE REST `/preauths` (`POST /preauths`, `GET /preauths`, `POST /preauths/cancel`).
 *   - Attending practitioner regulatory body (`KMPDC`, `COC`, `NCK`, `PPB`) &
 *     doctor consent tracking (`needsDoctorAuthorization`, `doctorApproved`).
 *   - Strict protection of approved scope/amount against silent modification
 *     without an audited amendment, and zero fabricated authorization numbers.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { openPatientIdentifiers } from '../../security/patient-identifiers.ts';
import {
  defaultShaGatewayAdapter,
  type PayerGatewayAdapter,
} from '../../integrations/sha/sha.adapter.ts';
import {
  ALLOWED_PRACTITIONER_REGULATORS,
  buildShaFhirBundle,
  isValidShaCatalogueCode,
  validateShaFhirBundle,
  type PractitionerRegulator,
} from '../../integrations/sha/sha.fhir.ts';
import { getFacilityPayerConfig } from './configuration.service.ts';
import {
  canTransitionPreauthStatus,
  formatCents,
  InsuranceDomainError,
  isConsistentShaDispatch,
  loadScopedFacility,
  loadTenantPatient,
  recordInsuranceAuditEvent,
  requireMoneyCents,
  type InsuranceActorScope,
  type PreauthStatus,
} from './contracts.ts';

async function nextPreauthNumber(): Promise<string> {
  const res = await db.execute(sql`SELECT nextval('sha_preauth_number_seq') AS seq`);
  const rows = (res as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.seq ?? Date.now() % 1_000_000);
  return `PA-SHA-${String(seq).padStart(6, '0')}`;
}

export interface AuthorizePatientVisitInput {
  patientId: number;
  encounterId?: number | null;
  memberCrNumber?: string | null;
  serviceType?: 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CAPITATION';
  consentMethod?: 'OTP' | 'BIOMETRICS' | 'MINORS_BIOMETRICS';
  otp?: string | null;
  biometricPayloadRef?: string | null;
  interventions: string[];
  isElectivePreVisit?: boolean;
  startVirtualClaimImmediately?: boolean;
  selectedPomsfScheme?: string | null;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: PractitionerRegulator | null;
}

/**
 * Workflow 5a: Captures beneficiary OTP / Biometrics consent and creates an HIE
 * authorization (`AUTHORIZED` for active visit or `AUTHORIZED_PENDING_VISIT` for elective preauth).
 */
export async function authorizePatientVisitConsent(
  scope: InsuranceActorScope,
  input: AuthorizePatientVisitInput,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const patient = await loadTenantPatient(scope.tenantId, input.patientId, scope.facilityId);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, 'SHA');

  const [latestElig] = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
        eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
        eq(schema.insuranceEligibilityVerifications.payerCode, 'SHA'),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(1);

  if (latestElig?.isAlive === false) {
    throw new InsuranceDomainError(
      'PATIENT_DECEASED_BLOCK',
      'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); visit authorization and billing are blocked.',
      409,
    );
  }

  if (
    input.memberCrNumber?.trim() &&
    input.memberCrNumber.trim() !== patient.dhaClientRegistryId?.trim() &&
    input.memberCrNumber.trim() !== latestElig?.memberCrNumber?.trim()
  )
    throw new InsuranceDomainError(
      'IDENTIFIER_PATIENT_MISMATCH',
      'Client Registry ID does not belong to the selected patient.',
      400,
    );

  const crNumber =
    input.memberCrNumber?.trim() ||
    latestElig?.memberCrNumber?.trim() ||
    patient.dhaClientRegistryId?.trim() ||
    null;

  if (!crNumber) {
    throw new InsuranceDomainError(
      'MISSING_CLIENT_REGISTRY_ID',
      'Beneficiary Client Registry ID (CR ID) is required before requesting SHA visit consent authorization.',
      400,
    );
  }

  const interventions = (input.interventions ?? [])
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (interventions.length === 0) {
    throw new InsuranceDomainError(
      'MISSING_INTERVENTIONS',
      'At least one SHA intervention code is required to authorize a visit or elective preauth.',
      400,
    );
  }

  for (const code of interventions) {
    if (!isValidShaCatalogueCode(code)) {
      throw new InsuranceDomainError(
        'INVALID_SHA_CATALOGUE_CODE',
        `Intervention code "${code}" is not a valid SHA / PMF catalogue code.`,
        400,
      );
    }
  }

  const regulator = input.practitionerRegulator
    ? (input.practitionerRegulator.trim().toUpperCase() as PractitionerRegulator)
    : null;
  if (regulator && !ALLOWED_PRACTITIONER_REGULATORS.includes(regulator)) {
    throw new InsuranceDomainError(
      'INVALID_PRACTITIONER_REGULATOR',
      `practitionerRegulator must be one of: ${ALLOWED_PRACTITIONER_REGULATORS.join(', ')}.`,
      400,
    );
  }

  if (!adapter.createVisitAuthorization) {
    throw new InsuranceDomainError(
      'CAPABILITY_UNAVAILABLE',
      'Configured SHA adapter does not implement HIE visit consent authorization.',
      501,
    );
  }

  const authRes = await adapter.createVisitAuthorization({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: payerConfig.facilityRegistryCode,
    memberCrNumber: crNumber,
    serviceType: input.serviceType ?? 'OUTPATIENT',
    consentMethod: input.consentMethod ?? 'OTP',
    otp: input.otp ?? null,
    biometricPayloadRef: input.biometricPayloadRef ?? null,
    interventions,
    isElectivePreVisit: Boolean(input.isElectivePreVisit),
    startVirtualClaimImmediately: Boolean(input.startVirtualClaimImmediately),
    selectedPomsfScheme: input.selectedPomsfScheme ?? null,
    practitionerRegNumber: input.practitionerRegNumber?.trim() || null,
    practitionerRegulator: regulator,
  });

  const [saved] = await db
    .insert(schema.shaPatientAuthorizations)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      patientId: patient.id,
      encounterId: input.encounterId ?? null,
      payerCode: 'SHA',
      memberCrNumber: crNumber,
      serviceType: input.serviceType ?? 'OUTPATIENT',
      consentMethod: input.consentMethod ?? 'OTP',
      authorizationGuid: authRes.authorizationGuid,
      consentToken: authRes.consentToken,
      authCode: authRes.authCode,
      authStatus: authRes.authStatus,
      isElective: Boolean(input.isElectivePreVisit),
      interventions,
      selectedPomsfScheme: input.selectedPomsfScheme ?? null,
      virtualClaimId: authRes.virtualClaimId,
      practitionerRegNumber: input.practitionerRegNumber?.trim() || null,
      practitionerRegulator: regulator,
      expiresAt: authRes.expiresAtIso ? new Date(authRes.expiresAtIso) : null,
      source: authRes.source,
      isSimulated: authRes.isSimulated,
      correlationId: authRes.correlationId,
      createdByUserId: scope.userId,
    })
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_VISIT_CONSENT_AUTHORIZED',
    resource: 'sha_patient_authorizations',
    resourceId: saved.id,
    summary: {
      patientId: patient.id,
      serviceType: saved.serviceType,
      consentMethod: saved.consentMethod,
      authStatus: saved.authStatus,
      isElective: saved.isElective,
      authorized: authRes.authorized,
      isSimulated: saved.isSimulated,
      correlationId: saved.correlationId,
    },
  });

  if (!authRes.authorized) {
    throw new InsuranceDomainError(
      'SHA_CONSENT_AUTHORIZATION_FAILED',
      authRes.errorMessage ?? 'Beneficiary consent authorization was declined or unreachable.',
      authRes.source === 'UNAVAILABLE' ? 502 : 400,
      { authorizationId: saved.id, authStatus: authRes.authStatus },
    );
  }

  return saved;
}

export async function listPatientVisitAuthorizations(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  patientId?: number,
) {
  await loadScopedFacility(scope);
  const conditions = [
    eq(schema.shaPatientAuthorizations.tenantId, scope.tenantId),
    eq(schema.shaPatientAuthorizations.facilityId, scope.facilityId),
  ];
  if (patientId) {
    conditions.push(eq(schema.shaPatientAuthorizations.patientId, patientId));
  }

  return db
    .select()
    .from(schema.shaPatientAuthorizations)
    .where(and(...conditions))
    .orderBy(desc(schema.shaPatientAuthorizations.createdAt))
    .limit(50);
}

export interface CreatePreauthorizationInput {
  patientId: number;
  encounterId?: number | null;
  eligibilityVerificationId?: number | null;
  authorizationId?: number | null;
  consentToken?: string | null;
  tariffId?: number | null;
  payerCode?: string;
  category?: string;
  isElective?: boolean;
  needsDoctorAuthorization?: boolean;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: string | null;
  requiredDocuments?: string[];
  clinicalIndication: string;
  primaryDiagnosisCode: string;
  primaryDiagnosisDisplay: string;
  codingSystem?: 'ICD-11' | 'ICD-10';
  requestedServiceCode: string;
  requestedServiceName: string;
  quantity?: number;
  estimatedAmount: string | number;
  supportingNotes?: string | null;
}

function mapCategoryToHieVariant(
  category: string,
): 'NORMAL' | 'SURGICAL' | 'RENAL' | 'ONCOLOGY' | 'OPTICAL' | 'IMAGING' {
  const upper = category.trim().toUpperCase();
  if (upper === 'SURGICAL' || upper === 'SURGERY' || upper === 'THEATRE') return 'SURGICAL';
  if (upper === 'RENAL' || upper === 'DIALYSIS') return 'RENAL';
  if (upper === 'ONCOLOGY') return 'ONCOLOGY';
  if (upper === 'OPTICAL') return 'OPTICAL';
  if (upper === 'IMAGING' || upper === 'RADIOLOGY') return 'IMAGING';
  return 'NORMAL';
}

export async function createPreauthorization(
  scope: InsuranceActorScope,
  input: CreatePreauthorizationInput,
) {
  await loadScopedFacility(scope);
  const patient = await loadTenantPatient(scope.tenantId, input.patientId, scope.facilityId);
  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();

  const clinicalIndication = input.clinicalIndication.trim();
  const primaryDiagnosisCode = input.primaryDiagnosisCode.trim();
  const primaryDiagnosisDisplay = input.primaryDiagnosisDisplay.trim();
  const requestedServiceCode = input.requestedServiceCode.trim();
  const requestedServiceName = input.requestedServiceName.trim();
  const quantity = input.quantity ?? 1;

  if (
    !clinicalIndication ||
    !primaryDiagnosisCode ||
    !primaryDiagnosisDisplay ||
    !requestedServiceCode ||
    !requestedServiceName
  ) {
    throw new InsuranceDomainError(
      'INVALID_PREAUTH_INPUT',
      'clinicalIndication, primaryDiagnosisCode, primaryDiagnosisDisplay, requestedServiceCode, and requestedServiceName are required.',
      400,
    );
  }
  if (input.codingSystem !== 'ICD-10' && input.codingSystem !== 'ICD-11') {
    throw new InsuranceDomainError(
      'INVALID_DIAGNOSIS_SYSTEM',
      'Select the recorded ICD-10 or ICD-11 coding system.',
      400,
    );
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InsuranceDomainError('INVALID_QUANTITY', 'quantity must be a positive integer.', 400);
  }

  if (payerCode === 'SHA' && !isValidShaCatalogueCode(requestedServiceCode)) {
    throw new InsuranceDomainError(
      'INVALID_SHA_CATALOGUE_CODE',
      `requestedServiceCode "${requestedServiceCode}" is not a valid SHA / PMF intervention code (SNOMED CT codes are prohibited).`,
      400,
    );
  }

  let validatedRegulator: PractitionerRegulator | null = null;
  if (input.practitionerRegulator?.trim()) {
    const regUpper = input.practitionerRegulator.trim().toUpperCase() as PractitionerRegulator;
    if (!ALLOWED_PRACTITIONER_REGULATORS.includes(regUpper)) {
      throw new InsuranceDomainError(
        'INVALID_PRACTITIONER_REGULATOR',
        `practitionerRegulator must be one of: ${ALLOWED_PRACTITIONER_REGULATORS.join(', ')}.`,
        400,
      );
    }
    validatedRegulator = regUpper;
  }

  const estimatedCents = requireMoneyCents(input.estimatedAmount, 'estimatedAmount');

  if (input.encounterId !== undefined && input.encounterId !== null) {
    const [enc] = await db
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, input.encounterId),
          eq(schema.encounters.facilityId, scope.facilityId),
          eq(schema.encounters.patientId, patient.id),
        ),
      )
      .limit(1);
    if (!enc) {
      throw new InsuranceDomainError(
        'ENCOUNTER_NOT_FOUND',
        'Encounter does not belong to this patient at the active facility.',
        404,
      );
    }
  }

  if (input.eligibilityVerificationId) {
    const [verification] = await db
      .select({ id: schema.insuranceEligibilityVerifications.id })
      .from(schema.insuranceEligibilityVerifications)
      .where(
        and(
          eq(schema.insuranceEligibilityVerifications.id, input.eligibilityVerificationId),
          eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
          eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
          eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
          eq(schema.insuranceEligibilityVerifications.payerCode, payerCode),
        ),
      )
      .limit(1);
    if (!verification)
      throw new InsuranceDomainError(
        'ELIGIBILITY_NOT_FOUND',
        'Eligibility does not belong to this patient and facility.',
        404,
      );
  }
  if (input.tariffId) {
    const [tariff] = await db
      .select({ id: schema.facilityServiceTariffs.id })
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.id, input.tariffId),
          eq(schema.facilityServiceTariffs.tenantId, scope.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!tariff)
      throw new InsuranceDomainError(
        'TARIFF_NOT_FOUND',
        'Tariff is not available at this facility.',
        404,
      );
  }
  if (input.consentToken?.trim() && !input.authorizationId)
    throw new InsuranceDomainError(
      'AUTHORIZATION_REQUIRED',
      'Consent token must come from the selected patient authorization.',
      400,
    );
  let resolvedConsentToken = input.consentToken?.trim() || null;
  if (input.authorizationId) {
    const [auth] = await db
      .select()
      .from(schema.shaPatientAuthorizations)
      .where(
        and(
          eq(schema.shaPatientAuthorizations.id, input.authorizationId),
          eq(schema.shaPatientAuthorizations.facilityId, scope.facilityId),
          eq(schema.shaPatientAuthorizations.patientId, patient.id),
        ),
      )
      .limit(1);
    if (!auth) {
      throw new InsuranceDomainError(
        'AUTHORIZATION_NOT_FOUND',
        'Linked SHA visit consent authorization does not belong to this patient.',
        404,
      );
    }
    if (resolvedConsentToken && resolvedConsentToken !== auth.consentToken)
      throw new InsuranceDomainError(
        'AUTHORIZATION_MISMATCH',
        'Consent token does not match the selected patient authorization.',
        400,
      );
    if (!resolvedConsentToken && auth.consentToken) {
      resolvedConsentToken = auth.consentToken;
    }
  }

  const preauthNumber = await nextPreauthNumber();
  const externalBundleId = randomUUID();

  const [created] = await db
    .insert(schema.insurancePreauthorizations)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      patientId: patient.id,
      encounterId: input.encounterId ?? null,
      eligibilityVerificationId: input.eligibilityVerificationId ?? null,
      authorizationId: input.authorizationId ?? null,
      consentToken: resolvedConsentToken,
      tariffId: input.tariffId ?? null,
      payerCode,
      preauthNumber,
      externalBundleId,
      category: (input.category ?? 'GENERAL').trim().toUpperCase(),
      isElective: Boolean(input.isElective),
      needsDoctorAuthorization: Boolean(input.needsDoctorAuthorization),
      practitionerRegNumber: input.practitionerRegNumber?.trim() || null,
      practitionerRegulator: validatedRegulator,
      requiredDocuments: Array.isArray(input.requiredDocuments)
        ? input.requiredDocuments.map(String)
        : [],
      status: 'DRAFT',
      source: 'LOCAL_DRAFT',
      isSimulated: false,
      clinicalIndication,
      primaryDiagnosisCode,
      primaryDiagnosisDisplay,
      codingSystem: input.codingSystem,
      requestedServiceCode,
      requestedServiceName,
      quantity,
      estimatedAmount: formatCents(estimatedCents),
      supportingNotes: input.supportingNotes?.trim() || null,
      createdByUserId: scope.userId,
    })
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_PREAUTH_CREATED',
    resource: 'insurance_preauthorizations',
    resourceId: created.id,
    summary: {
      preauthNumber: created.preauthNumber,
      patientId: patient.id,
      category: created.category,
      isElective: created.isElective,
      requestedServiceCode: created.requestedServiceCode,
      estimatedAmount: created.estimatedAmount,
      status: created.status,
    },
  });

  return created;
}

export async function listPreauthorizations(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  filters?: { patientId?: number; status?: string },
) {
  await loadScopedFacility(scope);

  const conditions = [
    eq(schema.insurancePreauthorizations.tenantId, scope.tenantId),
    eq(schema.insurancePreauthorizations.facilityId, scope.facilityId),
  ];
  if (filters?.patientId) {
    conditions.push(eq(schema.insurancePreauthorizations.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(schema.insurancePreauthorizations.status, filters.status.toUpperCase()));
  }

  const rows = await db
    .select({
      preauth: schema.insurancePreauthorizations,
      patientMrn: schema.patients.mrn,
      patientFirstName: schema.patients.firstName,
      patientMiddleName: schema.patients.middleName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.insurancePreauthorizations)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.insurancePreauthorizations.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.insurancePreauthorizations.createdAt))
    .limit(100);

  return rows.map((r) => ({
    ...r.preauth,
    patientMrn: r.patientMrn,
    patientName: [r.patientFirstName, r.patientMiddleName, r.patientLastName]
      .filter(Boolean)
      .join(' '),
  }));
}

export async function getPreauthorizationById(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  preauthId: number,
) {
  await loadScopedFacility(scope);

  const [row] = await db
    .select({
      preauth: schema.insurancePreauthorizations,
      patientMrn: schema.patients.mrn,
      patientFirstName: schema.patients.firstName,
      patientMiddleName: schema.patients.middleName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.insurancePreauthorizations)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.insurancePreauthorizations.patientId))
    .where(
      and(
        eq(schema.insurancePreauthorizations.id, preauthId),
        eq(schema.insurancePreauthorizations.tenantId, scope.tenantId),
        eq(schema.insurancePreauthorizations.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new InsuranceDomainError('PREAUTH_NOT_FOUND', 'Preauthorization not found.', 404);
  }

  return {
    ...row.preauth,
    patientMrn: row.patientMrn,
    patientName: [row.patientFirstName, rFirstMiddleLast(row)].slice(0, 1)[0],
  };
}

function rFirstMiddleLast(row: {
  patientFirstName: string | null;
  patientMiddleName: string | null;
  patientLastName: string | null;
}): string {
  return [row.patientFirstName, row.patientMiddleName, row.patientLastName]
    .filter(Boolean)
    .join(' ');
}

export interface UpdatePreauthorizationInput {
  clinicalIndication?: string;
  primaryDiagnosisCode?: string;
  primaryDiagnosisDisplay?: string;
  requestedServiceCode?: string;
  requestedServiceName?: string;
  quantity?: number;
  estimatedAmount?: string | number;
  supportingNotes?: string | null;
  amendmentReason?: string | null;
  consentToken?: string | null;
  doctorApproved?: boolean | null;

  status?: PreauthStatus;
  payerAuthReference?: string | null;
  approvedAmount?: string | number | null;
  conditions?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  rejectionReason?: string | null;
}

export async function updatePreauthorization(
  scope: InsuranceActorScope,
  preauthId: number,
  input: UpdatePreauthorizationInput,
) {
  await loadScopedFacility(scope);

  const existing = await getPreauthorizationById(scope, preauthId);

  const isScopeModification =
    (input.requestedServiceCode !== undefined &&
      input.requestedServiceCode.trim() !== existing.requestedServiceCode) ||
    (input.requestedServiceName !== undefined &&
      input.requestedServiceName.trim() !== existing.requestedServiceName) ||
    (input.quantity !== undefined && input.quantity !== existing.quantity) ||
    (input.estimatedAmount !== undefined &&
      formatCents(requireMoneyCents(input.estimatedAmount, 'estimatedAmount')) !==
        existing.estimatedAmount);

  // Prevent unauthorized edits to approved scope or amount without auditable amendment!
  if (
    isScopeModification &&
    (existing.status === 'APPROVED' || existing.status === 'PARTIALLY_APPROVED')
  ) {
    const amendmentReason = input.amendmentReason?.trim() || '';
    if (amendmentReason.length < 10) {
      throw new InsuranceDomainError(
        'APPROVED_PREAUTH_SCOPE_LOCKED',
        'Approved preauthorization scope or estimated amount cannot be modified without an explicit amendmentReason (at least 10 characters), which resets approval for re-submission.',
        409,
      );
    }

    const estCents =
      input.estimatedAmount !== undefined
        ? requireMoneyCents(input.estimatedAmount, 'estimatedAmount')
        : requireMoneyCents(existing.estimatedAmount, 'estimatedAmount');

    const [amended] = await db
      .update(schema.insurancePreauthorizations)
      .set({
        requestedServiceCode: input.requestedServiceCode?.trim() || existing.requestedServiceCode,
        requestedServiceName: input.requestedServiceName?.trim() || existing.requestedServiceName,
        quantity: input.quantity ?? existing.quantity,
        estimatedAmount: formatCents(estCents),
        clinicalIndication: input.clinicalIndication?.trim() || existing.clinicalIndication,
        primaryDiagnosisCode: input.primaryDiagnosisCode?.trim() || existing.primaryDiagnosisCode,
        primaryDiagnosisDisplay:
          input.primaryDiagnosisDisplay?.trim() || existing.primaryDiagnosisDisplay,
        supportingNotes:
          input.supportingNotes !== undefined
            ? input.supportingNotes?.trim() || null
            : existing.supportingNotes,
        status: 'DRAFT',
        approvedAmount: null,
        interimApprovedAmount: null,
        payerAuthReference: null,
        hiePreauthGuid: null,
        externalBundleId: randomUUID(),
        amendmentCount: existing.amendmentCount + 1,
        lastAmendmentReason: amendmentReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.insurancePreauthorizations.id, existing.id))
      .returning();

    await recordInsuranceAuditEvent(scope, {
      action: 'SHA_PREAUTH_SCOPE_AMENDED',
      resource: 'insurance_preauthorizations',
      resourceId: amended.id,
      summary: {
        preauthNumber: amended.preauthNumber,
        previousStatus: existing.status,
        previousAuthRef: existing.payerAuthReference,
        amendmentCount: amended.amendmentCount,
        amendmentReason,
        newServiceCode: amended.requestedServiceCode,
        newQuantity: amended.quantity,
        newEstimatedAmount: amended.estimatedAmount,
      },
    });

    return amended;
  }

  let nextStatus = existing.status as PreauthStatus;
  if (input.status && input.status !== existing.status) {
    if (!canTransitionPreauthStatus(existing.status, input.status)) {
      throw new InsuranceDomainError(
        'INVALID_PREAUTH_TRANSITION',
        `Cannot transition preauthorization from ${existing.status} to ${input.status}.`,
        409,
      );
    }
    nextStatus = input.status;
  }

  const effectiveAuthRef =
    input.payerAuthReference !== undefined
      ? input.payerAuthReference?.trim() || null
      : existing.payerAuthReference;

  if ((nextStatus === 'APPROVED' || nextStatus === 'PARTIALLY_APPROVED') && !effectiveAuthRef) {
    throw new InsuranceDomainError(
      'MISSING_PAYER_AUTH_REFERENCE',
      'Cannot mark preauthorization APPROVED without an authoritative payer authorization reference.',
      400,
    );
  }

  if (
    nextStatus === 'REJECTED' &&
    !(input.rejectionReason?.trim() || existing.rejectionReason?.trim())
  )
    throw new InsuranceDomainError(
      'REJECTION_REASON_REQUIRED',
      'Record the payer rejection reason.',
      400,
    );

  const nextApprovedAmount =
    input.approvedAmount !== undefined &&
    input.approvedAmount !== null &&
    input.approvedAmount !== ''
      ? formatCents(requireMoneyCents(input.approvedAmount, 'approvedAmount'))
      : existing.approvedAmount;

  const nextEstimatedAmount =
    input.estimatedAmount !== undefined
      ? formatCents(requireMoneyCents(input.estimatedAmount, 'estimatedAmount'))
      : existing.estimatedAmount;

  const [updated] = await db
    .update(schema.insurancePreauthorizations)
    .set({
      clinicalIndication: input.clinicalIndication?.trim() || existing.clinicalIndication,
      primaryDiagnosisCode: input.primaryDiagnosisCode?.trim() || existing.primaryDiagnosisCode,
      primaryDiagnosisDisplay:
        input.primaryDiagnosisDisplay?.trim() || existing.primaryDiagnosisDisplay,
      requestedServiceCode: input.requestedServiceCode?.trim() || existing.requestedServiceCode,
      requestedServiceName: input.requestedServiceName?.trim() || existing.requestedServiceName,
      quantity: input.quantity ?? existing.quantity,
      estimatedAmount: nextEstimatedAmount,
      consentToken:
        input.consentToken !== undefined
          ? input.consentToken?.trim() || null
          : existing.consentToken,
      doctorApproved:
        input.doctorApproved !== undefined ? input.doctorApproved : existing.doctorApproved,
      supportingNotes:
        input.supportingNotes !== undefined
          ? input.supportingNotes?.trim() || null
          : existing.supportingNotes,
      status: nextStatus,
      payerAuthReference: effectiveAuthRef,
      approvedAmount: nextApprovedAmount,
      conditions:
        input.conditions !== undefined ? input.conditions?.trim() || null : existing.conditions,
      validFrom: input.validFrom !== undefined ? input.validFrom || null : existing.validFrom,
      validUntil: input.validUntil !== undefined ? input.validUntil || null : existing.validUntil,
      rejectionReason:
        input.rejectionReason !== undefined
          ? input.rejectionReason?.trim() || null
          : existing.rejectionReason,
      ...(nextStatus !== existing.status &&
      (nextStatus === 'APPROVED' ||
        nextStatus === 'PARTIALLY_APPROVED' ||
        nextStatus === 'REJECTED')
        ? {
            decidedByUserId: scope.userId,
            decidedAt: new Date(),
            source: existing.isSimulated ? 'SANDBOX_SIMULATION' : 'MANUAL_PAYER_DECISION',
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.insurancePreauthorizations.id, existing.id))
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_PREAUTH_UPDATED',
    resource: 'insurance_preauthorizations',
    resourceId: updated.id,
    summary: {
      preauthNumber: updated.preauthNumber,
      fromStatus: existing.status,
      toStatus: updated.status,
      payerAuthReference: updated.payerAuthReference,
      approvedAmount: updated.approvedAmount,
    },
  });

  return updated;
}

export async function submitPreauthorization(
  scope: InsuranceActorScope,
  preauthId: number,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
  options?: {
    protocol?: 'FHIR_BUNDLE' | 'HIE_PREAUTH';
    consentToken?: string | null;
    serviceStart?: string;
    serviceEnd?: string;
    subType?: 'op' | 'ip';
    schemeCode?: string;
  },
) {
  const facility = await loadScopedFacility(scope);
  const existing = await getPreauthorizationById(scope, preauthId);

  if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
    throw new InsuranceDomainError(
      'PREAUTH_ALREADY_SUBMITTED',
      `Preauthorization in status ${existing.status} cannot be submitted again without an amendment.`,
      409,
    );
  }

  const rawPatient = await loadTenantPatient(scope.tenantId, existing.patientId, scope.facilityId);
  const patient = openPatientIdentifiers(rawPatient);
  if (!patient.shaNumber && !patient.nationalId && !patient.dhaClientRegistryId) {
    throw new InsuranceDomainError(
      'MISSING_PATIENT_IDENTIFIER',
      'Patient must have a SHA Member Number, National ID, or Client Registry ID before submitting SHA preauthorization.',
      400,
    );
  }

  const { config: payerConfig } = await getFacilityPayerConfig(scope, existing.payerCode);
  const facilityRegistryCode = payerConfig.facilityRegistryCode || facility.mflCode;
  if (!facilityRegistryCode)
    throw new InsuranceDomainError(
      'FACILITY_REGISTRY_REQUIRED',
      'Enter the authorized facility registry identifier before submission.',
      400,
    );

  const serviceStart = options?.serviceStart?.trim() ?? '';
  const serviceEnd = options?.serviceEnd?.trim() ?? '';
  const subType = options?.subType;
  const schemeCode = options?.schemeCode?.trim().toUpperCase() ?? '';
  const isDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !isDate(serviceStart) ||
    !isDate(serviceEnd) ||
    serviceStart > serviceEnd ||
    (subType !== 'op' && subType !== 'ip') ||
    !schemeCode ||
    !(payerConfig.contractedSchemes as readonly string[]).includes(schemeCode)
  )
    throw new InsuranceDomainError(
      'PREAUTH_CONTEXT_REQUIRED',
      'Provide actual service dates, care setting and a facility-configured payer scheme; these cannot be inferred.',
      400,
    );
  const unitCents = Math.round(
    requireMoneyCents(existing.estimatedAmount, 'estimatedAmount') / Math.max(1, existing.quantity),
  );

  const fhirBundle = buildShaFhirBundle({
    bundleUuid: existing.externalBundleId,
    claimUuid: existing.externalBundleId,
    claimNumber: existing.preauthNumber,
    use: 'preauthorization',
    preauthCategory: existing.category,
    claimType: 'institutional',
    subType,
    schemeCode,
    facilityRegistryCode,
    facilityName: facility.name,
    patient: {
      internalId: patient.id,
      shaNumber: patient.shaNumber,
      nationalId: patient.nationalId,
      crNumber: patient.dhaClientRegistryId,
      fullName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      firstName: patient.firstName,
      lastName: patient.lastName,
      gender: patient.gender,
      birthDate: patient.dateOfBirth,
    },
    encounterId: existing.encounterId,
    billableStart: serviceStart,
    billableEnd: serviceEnd,
    createdIso: new Date().toISOString(),
    totalClaimedKes: existing.estimatedAmount,
    attendingPractitioner:
      existing.practitionerRegNumber && existing.practitionerRegulator
        ? {
            registrationNumber: existing.practitionerRegNumber,
            regulator: existing.practitionerRegulator,
          }
        : null,
    diagnoses: [
      {
        code: existing.primaryDiagnosisCode,
        display: existing.primaryDiagnosisDisplay,
        system: existing.codingSystem,
        type: 'principal',
      },
    ],
    items: [
      {
        sequence: 1,
        payerServiceCode: existing.requestedServiceCode,
        payerServiceName: existing.requestedServiceName,
        servicedStart: serviceStart,
        servicedEnd: serviceEnd,
        quantity: existing.quantity,
        unitPriceKes: formatCents(unitCents),
        netKes: existing.estimatedAmount,
      },
    ],
  });

  // Always validate FHIR R4 Kenya eClaims IG v0.1.0 conformance before submission!
  const bundleValidation = validateShaFhirBundle(fhirBundle);
  if (!bundleValidation.valid) {
    throw new InsuranceDomainError(
      'FHIR_PREAUTH_VALIDATION_FAILED',
      bundleValidation.issues
        .filter((i) => i.severity === 'ERROR')
        .map((i) => i.message)
        .join(' '),
      400,
      { issues: bundleValidation.issues },
    );
  }

  const effectiveProtocol = options?.protocol ?? 'FHIR_BUNDLE';
  const effectiveConsentToken = options?.consentToken?.trim() || existing.consentToken || null;

  if (effectiveProtocol === 'HIE_PREAUTH') {
    if (!effectiveConsentToken) {
      throw new InsuranceDomainError(
        'MISSING_CONSENT_TOKEN',
        'HIE /preauths submission requires a beneficiary consent_token from POST /claims/authorize or POST /claims/visit.',
        400,
      );
    }
    if (!adapter.submitHiePreauth) {
      throw new InsuranceDomainError(
        'CAPABILITY_UNAVAILABLE',
        'Configured SHA adapter does not implement HIE /preauths submission.',
        501,
      );
    }

    const hieRes = await adapter.submitHiePreauth({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.userId,
      facilityRegistryOverride: facilityRegistryCode,
      consentToken: effectiveConsentToken,
      variant: mapCategoryToHieVariant(existing.category),
      isElective: existing.isElective,
      interventionCode: existing.requestedServiceCode,
      serviceStart,
      serviceEnd,
      clinicalIndications: existing.clinicalIndication,
      diagnoses: [
        {
          icdCode: existing.primaryDiagnosisCode,
          name: existing.primaryDiagnosisDisplay,
          diagnosisType: 'PRIMARY',
        },
      ],
      items: [
        {
          code: existing.requestedServiceCode,
          name: existing.requestedServiceName,
          quantity: existing.quantity,
          unitPriceKes: formatCents(unitCents),
        },
      ],
      doctors:
        existing.practitionerRegNumber && existing.practitionerRegulator
          ? [
              {
                registrationNumber: existing.practitionerRegNumber,
                regulationBody: existing.practitionerRegulator as PractitionerRegulator,
              },
            ]
          : undefined,
      providerNotificationEmail: scope.userEmail ?? null,
    });

    if (
      !hieRes.accepted ||
      hieRes.httpStatus === null ||
      hieRes.httpStatus < 200 ||
      hieRes.httpStatus >= 300 ||
      hieRes.errors.length > 0 ||
      ![
        'SUBMITTED',
        'PENDING',
        'APPROVED',
        'FINALISED',
        'PARTIALLY_APPROVED',
        'REJECTED',
        'DECLINED',
      ].includes(hieRes.status)
    ) {
      throw new InsuranceDomainError(
        'SHA_PREAUTH_SUBMISSION_FAILED',
        hieRes.rejectionReason ?? 'DHA HIE /preauths rejected or failed preauthorization request.',
        502,
        { correlationId: hieRes.correlationId, errors: hieRes.errors },
      );
    }

    const mappedStatus: PreauthStatus =
      hieRes.status === 'APPROVED' || hieRes.status === 'FINALISED'
        ? 'APPROVED'
        : hieRes.status === 'PARTIALLY_APPROVED'
          ? 'PARTIALLY_APPROVED'
          : hieRes.status === 'REJECTED' || hieRes.status === 'DECLINED'
            ? 'REJECTED'
            : 'PENDING';

    const [updated] = await db
      .update(schema.insurancePreauthorizations)
      .set({
        status: mappedStatus,
        source: hieRes.source,
        isSimulated: hieRes.isSimulated,
        consentToken: effectiveConsentToken,
        hiePreauthGuid: hieRes.hiePreauthGuid,
        payerAuthReference: hieRes.payerAuthReference,
        doctorApproved: hieRes.doctorApproved,
        needsDoctorAuthorization: existing.needsDoctorAuthorization || hieRes.needsDoctorApproval,
        interimApprovedAmount: hieRes.interimApprovedAmountKes ?? existing.interimApprovedAmount,
        approvedAmount: hieRes.finalApprovedAmountKes ?? existing.approvedAmount,
        rejectionReason: hieRes.rejectionReason,
        // The response did not supply a validity period; do not invent one.
        validFrom: existing.validFrom,
        validUntil: existing.validUntil,
        fhirBundle,
        submittedByUserId: scope.userId,
        submittedAt: new Date(),
        ...(mappedStatus === 'APPROVED' ||
        mappedStatus === 'PARTIALLY_APPROVED' ||
        mappedStatus === 'REJECTED'
          ? { decidedAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.insurancePreauthorizations.id, existing.id))
      .returning();

    await recordInsuranceAuditEvent(scope, {
      action: 'SHA_HIE_PREAUTH_SUBMITTED',
      resource: 'insurance_preauthorizations',
      resourceId: updated.id,
      summary: {
        preauthNumber: updated.preauthNumber,
        hiePreauthGuid: updated.hiePreauthGuid,
        status: updated.status,
        isElective: updated.isElective,
        doctorApproved: updated.doctorApproved,
        isSimulated: updated.isSimulated,
        correlationId: hieRes.correlationId,
      },
    });

    return {
      preauthorization: updated,
      gateway: {
        mode: hieRes.mode,
        isSimulated: hieRes.isSimulated,
        correlationId: hieRes.correlationId,
        upstreamState: hieRes.status,
      },
    };
  }

  let gatewayRes = await adapter.submitBundle({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: facilityRegistryCode,
    operation: 'preauthorization.submit',
    bundleUuid: existing.externalBundleId,
    claimUuid: existing.externalBundleId,
    fhirBundle,
  });

  if (!isConsistentShaDispatch(gatewayRes))
    gatewayRes = {
      ...gatewayRes,
      accepted: false,
      outcome: 'FAILED',
      approvedAmountKes: null,
      rejectionReason: 'Unrecognized or contradictory payer processing result.',
      errors: ['Unrecognized or contradictory payer processing result.'],
    };

  if (!gatewayRes.accepted && gatewayRes.outcome !== 'REJECTED') {
    throw new InsuranceDomainError(
      'SHA_PREAUTH_SUBMISSION_FAILED',
      gatewayRes.rejectionReason ?? 'SHA gateway could not accept the preauthorization bundle.',
      502,
      {
        correlationId: gatewayRes.correlationId,
        upstreamState: gatewayRes.upstreamState,
        errors: gatewayRes.errors,
      },
    );
  }

  const nextStatus: PreauthStatus =
    gatewayRes.outcome === 'APPROVED'
      ? 'APPROVED'
      : gatewayRes.outcome === 'PARTIALLY_APPROVED'
        ? 'PARTIALLY_APPROVED'
        : gatewayRes.outcome === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING';

  const [updated] = await db
    .update(schema.insurancePreauthorizations)
    .set({
      status: nextStatus,
      source: gatewayRes.source,
      isSimulated: gatewayRes.isSimulated,
      payerAuthReference: gatewayRes.payerReference,
      mediatorId: gatewayRes.mediatorId,
      approvedAmount: gatewayRes.approvedAmountKes ?? existing.approvedAmount,
      rejectionReason: gatewayRes.rejectionReason,
      // The gateway did not supply an authorization validity period.
      validFrom: existing.validFrom,
      validUntil: existing.validUntil,
      fhirBundle,
      submittedByUserId: scope.userId,
      submittedAt: new Date(),
      ...(nextStatus === 'APPROVED' ||
      nextStatus === 'PARTIALLY_APPROVED' ||
      nextStatus === 'REJECTED'
        ? { decidedAt: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.insurancePreauthorizations.id, existing.id))
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_PREAUTH_SUBMITTED',
    resource: 'insurance_preauthorizations',
    resourceId: updated.id,
    summary: {
      preauthNumber: updated.preauthNumber,
      status: updated.status,
      source: updated.source,
      isSimulated: updated.isSimulated,
      payerAuthReference: updated.payerAuthReference,
      correlationId: gatewayRes.correlationId,
    },
  });

  return {
    preauthorization: updated,
    gateway: {
      mode: gatewayRes.mode,
      isSimulated: gatewayRes.isSimulated,
      correlationId: gatewayRes.correlationId,
      upstreamState: gatewayRes.upstreamState,
    },
  };
}

/**
 * Polls DHA HIE `GET /preauths?consent_token=...` or FHIR ClaimResponse to update
 * doctor consent (`doctorApproved`), interim/final approved amounts, and decision state.
 */
export async function refreshPreauthorizationStatus(
  scope: InsuranceActorScope,
  preauthId: number,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const existing = await getPreauthorizationById(scope, preauthId);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, existing.payerCode);

  if (existing.consentToken && adapter.queryHiePreauths) {
    const res = await adapter.queryHiePreauths({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.userId,
      facilityRegistryOverride: payerConfig.facilityRegistryCode,
      consentToken: existing.consentToken,
      hiePreauthGuid: existing.hiePreauthGuid,
    });

    if (res.accepted) {
      const candidate: PreauthStatus =
        res.status === 'APPROVED' || res.status === 'FINALISED'
          ? 'APPROVED'
          : res.status === 'PARTIALLY_APPROVED'
            ? 'PARTIALLY_APPROVED'
            : res.status === 'REJECTED' || res.status === 'DECLINED'
              ? 'REJECTED'
              : (existing.status as PreauthStatus);

      const nextStatus = canTransitionPreauthStatus(existing.status, candidate)
        ? candidate
        : (existing.status as PreauthStatus);

      const [updated] = await db
        .update(schema.insurancePreauthorizations)
        .set({
          status: nextStatus,
          doctorApproved: res.doctorApproved ?? existing.doctorApproved,
          interimApprovedAmount: res.interimApprovedAmountKes ?? existing.interimApprovedAmount,
          approvedAmount: res.finalApprovedAmountKes ?? existing.approvedAmount,
          payerAuthReference: res.payerAuthReference ?? existing.payerAuthReference,
          rejectionReason: res.rejectionReason ?? existing.rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(schema.insurancePreauthorizations.id, existing.id))
        .returning();

      return { preauthorization: updated, gateway: res };
    }
  }

  return { preauthorization: existing, gateway: null };
}

export async function cancelPreauthorization(
  scope: InsuranceActorScope,
  preauthId: number,
  reason: string,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const existing = await getPreauthorizationById(scope, preauthId);
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    throw new InsuranceDomainError(
      'INVALID_CANCEL_REASON',
      'Cancellation reason must be at least 5 characters.',
      400,
    );
  }
  if (!canTransitionPreauthStatus(existing.status, 'CANCELLED')) {
    throw new InsuranceDomainError(
      'INVALID_PREAUTH_TRANSITION',
      `Cannot cancel preauthorization in status ${existing.status}.`,
      409,
    );
  }

  const { config: payerConfig } = await getFacilityPayerConfig(scope, existing.payerCode);
  let gatewayCancel: { cancelled: boolean; isSimulated: boolean; correlationId: string } | null =
    null;

  if (existing.consentToken && adapter.cancelHiePreauth) {
    const res = await adapter.cancelHiePreauth({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.userId,
      facilityRegistryOverride: payerConfig.facilityRegistryCode,
      consentToken: existing.consentToken,
      hiePreauthGuid: existing.hiePreauthGuid,
      reason: cleanReason,
    });
    gatewayCancel = {
      cancelled: res.cancelled,
      isSimulated: res.isSimulated,
      correlationId: res.correlationId,
    };
  }

  const [cancelled] = await db
    .update(schema.insurancePreauthorizations)
    .set({
      status: 'CANCELLED',
      rejectionReason: `Cancelled: ${cleanReason}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.insurancePreauthorizations.id, existing.id))
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_PREAUTH_CANCELLED',
    resource: 'insurance_preauthorizations',
    resourceId: cancelled.id,
    summary: {
      preauthNumber: cancelled.preauthNumber,
      reason: cleanReason,
      gatewayCancelled: gatewayCancel?.cancelled ?? null,
    },
  });

  return { preauthorization: cancelled, gateway: gatewayCancel };
}
