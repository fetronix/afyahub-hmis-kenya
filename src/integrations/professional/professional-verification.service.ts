/**
 * JaliCare HMIS
 * Professional credential verification service
 *
 * One place decides what a verification result means, what gets written,
 * and what an administrator is allowed to do next.
 *
 * The rules that matter:
 *
 *   * A registry lookup is not a licence check. `REGISTRATION_VERIFIED`
 *     and `LICENCE_CONFIRMED` are different statuses and stay different.
 *   * A service that cannot be reached is `SERVICE_UNAVAILABLE`, never a
 *     failed credential check, and it never overwrites a previous good
 *     result.
 *   * Mock mode results are stored with `mode = 'mock'` and can never be
 *     used to issue an invitation for a clinical role. That is the whole
 *     point of labelling them.
 *   * A manual check records its source and the date it was made, and is
 *     never described as an automated verification.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { resolveFacilityScope } from '../../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../../db/queries.ts';

import { dhaCall } from '../dha/dha.client.ts';
import { loadDhaConfig, type DhaConfig } from '../dha/dha.config.ts';
import { DhaError } from '../dha/dha.errors.ts';
import {
  HWR_ENDPOINTS,
  REGULATORS,
  PRACTITIONER_IDENTIFICATION_TYPES,
  isInvitableStatus,
  regulatorByCode,
  regulatorForStaffRole,
  requiresProfessionalVerification,
  type PractitionerIdentificationType,
  type VerificationStatus,
} from './practitioner.contracts.ts';
import { normalisePractitioner } from './practitioner.normalise.ts';

export class ProfessionalVerificationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ProfessionalVerificationError';
  }
}

async function resolveScope(
  context: AuthorizationContext,
  requestedFacilityId?: number | string | null,
) {
  const parsed =
    requestedFacilityId === undefined ||
    requestedFacilityId === null ||
    requestedFacilityId === ''
      ? null
      : Number(requestedFacilityId);

  const facilityId = resolveFacilityScope(context, parsed);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ProfessionalVerificationError('Facility not found.', 404, 'FACILITY_NOT_FOUND');
  }

  return facility;
}

function normaliseDate(value: string | null): string | null {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

export interface VerifyPractitionerInput {
  regulator: string;
  /** The number being looked up. Defaults to registrationNumber. */
  identificationNumber?: string | null;
  registrationNumber?: string | null;
  identificationType?: string | null;
  fullName?: string | null;
  userId?: number | null;
  invitationId?: number | null;
  facilityId?: number | string | null;
}

export interface VerificationOutcome {
  credentialId: number | null;
  status: VerificationStatus;
  regulator: string;
  registrationNumber: string;
  record: {
    fullName: string | null;
    registrationNumber: string | null;
    licenceNumber: string | null;
    profession: string | null;
    specialty: string | null;
    registrationStatus: string | null;
    licenceStatus: string | null;
    licenceExpiry: string | null;
  };
  warnings: string[];
  matchedFields: string[];
  unrecognisedKeys: string[];
  mapping: 'provisional' | 'confirmed';
  mode: string;
  simulated: boolean;
  retrievedAt: string;
  /** Set when the call itself failed; the status will be SERVICE_UNAVAILABLE. */
  serviceError: { code: string; message: string } | null;
  /** True when this result may be used to invite a clinical staff member. */
  invitable: boolean;
}

/**
 * Look a practitioner up and persist what came back.
 */
export async function verifyPractitionerScoped(
  context: AuthorizationContext,
  input: VerifyPractitionerInput,
  options: { config?: DhaConfig } = {},
): Promise<VerificationOutcome> {
  const facility = await resolveScope(context, input.facilityId);

  const regulator = regulatorByCode(input.regulator);

  if (!regulator) {
    throw new ProfessionalVerificationError(
      `Regulator must be one of: ${REGULATORS.map((item) => item.code).join(', ')}.`,
      400,
      'INVALID_REGULATOR',
    );
  }

  if (!regulator.apiSupported) {
    throw new ProfessionalVerificationError(
      `${regulator.shortName} has no authorised automated verification endpoint. Record a manual check instead.`,
      400,
      'REGULATOR_NOT_SUPPORTED',
    );
  }

  const identificationNumber = (
    input.identificationNumber ??
    input.registrationNumber ??
    ''
  ).trim();

  if (!identificationNumber) {
    throw new ProfessionalVerificationError(
      'A professional registration number is required.',
      400,
      'REGISTRATION_NUMBER_REQUIRED',
    );
  }

  if (identificationNumber.length > 64) {
    throw new ProfessionalVerificationError(
      'The registration number is too long to be a regulator registration number.',
      400,
      'REGISTRATION_NUMBER_INVALID',
    );
  }

  const identificationType = (
    input.identificationType ?? 'registration_number'
  ).trim() as PractitionerIdentificationType;

  if (!PRACTITIONER_IDENTIFICATION_TYPES.includes(identificationType)) {
    throw new ProfessionalVerificationError(
      `Identification type must be one of: ${PRACTITIONER_IDENTIFICATION_TYPES.join(', ')}.`,
      400,
      'INVALID_IDENTIFICATION_TYPE',
    );
  }

  const config = options.config ?? loadDhaConfig();

  let message: unknown = null;
  let mode: string = config.mode;
  let simulated = false;
  let retrievedAt = new Date().toISOString();
  let serviceError: { code: string; message: string } | null = null;
  let normalisation = normalisePractitioner({
    message: null,
    regulator: regulator.code,
    identificationNumber,
    expectedFullName: input.fullName ?? null,
  });

  try {
    const response = await dhaCall<{ message?: unknown }>(
      config,
      {
        tenantId: facility.tenantId,
        facilityId: facility.id,
      },
      {
        operation: 'practitioner.search',
        method: 'GET',
        path: HWR_ENDPOINTS.practitioner,
        query: {
          identification_number: identificationNumber,
          identification_type: identificationType,
          regulator: regulator.code,
        },
      },
    );

    message = response.data?.message ?? null;
    mode = response.mode;
    simulated = response.simulated;
    retrievedAt = response.retrievedAt;

    normalisation = normalisePractitioner({
      message,
      regulator: regulator.code,
      identificationNumber,
      expectedFullName: input.fullName ?? null,
    });
  } catch (error) {
    /*
     * A registry that cannot be reached tells us nothing about the
     * practitioner. It is recorded as an outage, not as a finding.
     */
    if (error instanceof DhaError) {
      const notFound = error.status === 404;

      serviceError = notFound
        ? null
        : { code: error.code, message: error.message };

      normalisation = {
        record: normalisation.record,
        status: notFound ? 'RECORD_NOT_FOUND' : 'SERVICE_UNAVAILABLE',
        matchedFields: [],
        warnings: notFound
          ? [
              `The registry returned no practitioner for ${regulator.code} registration number ${identificationNumber}.`,
            ]
          : [
              'The verification service could not be reached. This is not a failed credential check; retry when the service is available.',
            ],
        mapping: 'provisional',
        unrecognisedKeys: [],
      };
    } else {
      throw error;
    }
  }

  const licenceExpiry = normaliseDate(normalisation.record.licenceExpiry);

  const [existing] = await db
    .select({
      id: schema.staffProfessionalCredentials.id,
      status: schema.staffProfessionalCredentials.status,
      userId: schema.staffProfessionalCredentials.userId,
    })
    .from(schema.staffProfessionalCredentials)
    .where(
      and(
        eq(schema.staffProfessionalCredentials.facilityId, facility.id),
        eq(schema.staffProfessionalCredentials.regulator, regulator.code),
        eq(
          schema.staffProfessionalCredentials.registrationNumber,
          identificationNumber,
        ),
      ),
    )
    .limit(1);

  /*
   * An outage must not erase a credential that was verified yesterday.
   * Keep the previous status and record the attempt separately.
   */
  const persistedStatus: VerificationStatus =
    normalisation.status === 'SERVICE_UNAVAILABLE' && existing
      ? (existing.status as VerificationStatus)
      : normalisation.status;

  const values = {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: input.userId ?? existing?.userId ?? null,
    invitationId: input.invitationId ?? null,
    regulator: regulator.code,
    registrationNumber: identificationNumber,
    licenceNumber: normalisation.record.licenceNumber,
    professionalCategory: normalisation.record.profession,
    specialty: normalisation.record.specialty,
    status: persistedStatus,
    registrationStatus: normalisation.record.registrationStatus,
    licenceStatus: normalisation.record.licenceStatus,
    licenceExpiry,
    lastVerifiedAt:
      normalisation.status === 'SERVICE_UNAVAILABLE' ? null : new Date(),
    verificationSource: 'DHA_HWR',
    externalReference: normalisation.record.externalId,
    responseReference: null,
    mode,
    verifiedBy: null,
    warnings: normalisation.warnings,
    matchedFields: normalisation.matchedFields,
    updatedAt: new Date(),
  };

  let credentialId: number | null = existing?.id ?? null;

  if (existing) {
    await db
      .update(schema.staffProfessionalCredentials)
      .set(values)
      .where(eq(schema.staffProfessionalCredentials.id, existing.id));
  } else {
    const [created] = await db
      .insert(schema.staffProfessionalCredentials)
      .values(values)
      .returning({ id: schema.staffProfessionalCredentials.id });

    credentialId = created?.id ?? null;
  }

  await db.insert(schema.professionalVerificationEvents).values({
    tenantId: facility.tenantId,
    facilityId: facility.id,
    credentialId,
    userId: input.userId ?? null,
    invitationId: input.invitationId ?? null,
    action: 'VERIFY',
    statusBefore: existing?.status ?? null,
    statusAfter: persistedStatus,
    source: 'DHA_HWR',
    mode,
    httpStatus: serviceError ? null : 200,
    errorCode: serviceError?.code ?? null,
    performedBy: context.userId ?? null,
    notes: simulated
      ? 'Simulated result from mock mode. Not a regulator verification.'
      : null,
  });

  return {
    credentialId,
    status: persistedStatus,
    regulator: regulator.code,
    registrationNumber: identificationNumber,
    record: {
      fullName: normalisation.record.fullName,
      registrationNumber: normalisation.record.registrationNumber,
      licenceNumber: normalisation.record.licenceNumber,
      profession: normalisation.record.profession,
      specialty: normalisation.record.specialty,
      registrationStatus: normalisation.record.registrationStatus,
      licenceStatus: normalisation.record.licenceStatus,
      licenceExpiry,
    },
    warnings: normalisation.warnings,
    matchedFields: normalisation.matchedFields,
    unrecognisedKeys: normalisation.unrecognisedKeys,
    mapping: normalisation.mapping,
    mode,
    simulated,
    retrievedAt,
    serviceError,
    /* A simulated result may never unlock an invitation. */
    invitable: !simulated && isInvitableStatus(persistedStatus),
  };
}

/* ============================================================
   MANUAL VERIFICATION
   ============================================================ */

export async function recordManualVerificationScoped(
  context: AuthorizationContext,
  input: {
    credentialId?: number | null;
    regulator: string;
    registrationNumber: string;
    fullName?: string | null;
    source: string;
    notes?: string | null;
    status?: string | null;
    licenceExpiry?: string | null;
    facilityId?: number | string | null;
  },
) {
  const facility = await resolveScope(context, input.facilityId);
  const regulator = regulatorByCode(input.regulator);

  if (!regulator) {
    throw new ProfessionalVerificationError(
      `Regulator must be one of: ${REGULATORS.map((item) => item.code).join(', ')}.`,
      400,
      'INVALID_REGULATOR',
    );
  }

  const registrationNumber = (input.registrationNumber ?? '').trim();
  const source = (input.source ?? '').trim();

  if (!registrationNumber) {
    throw new ProfessionalVerificationError(
      'A registration number is required.',
      400,
      'REGISTRATION_NUMBER_REQUIRED',
    );
  }

  if (source.length < 5) {
    throw new ProfessionalVerificationError(
      'Record where the manual check was made, for example the regulator register page or a letter reference.',
      400,
      'MANUAL_SOURCE_REQUIRED',
    );
  }

  const status = (input.status ?? 'MANUALLY_VERIFIED').trim();

  if (status !== 'MANUALLY_VERIFIED' && status !== 'MANUAL_REVIEW_REQUIRED') {
    throw new ProfessionalVerificationError(
      'A manual check can only be recorded as MANUALLY_VERIFIED or MANUAL_REVIEW_REQUIRED.',
      400,
      'INVALID_MANUAL_STATUS',
    );
  }

  const [existing] = input.credentialId
    ? await db
        .select()
        .from(schema.staffProfessionalCredentials)
        .where(
          and(
            eq(schema.staffProfessionalCredentials.id, Number(input.credentialId)),
            eq(schema.staffProfessionalCredentials.facilityId, facility.id),
          ),
        )
        .limit(1)
    : await db
        .select()
        .from(schema.staffProfessionalCredentials)
        .where(
          and(
            eq(schema.staffProfessionalCredentials.facilityId, facility.id),
            eq(schema.staffProfessionalCredentials.regulator, regulator.code),
            eq(
              schema.staffProfessionalCredentials.registrationNumber,
              registrationNumber,
            ),
          ),
        )
        .limit(1);

  const now = new Date();
  const values = {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: existing?.userId ?? null,
    invitationId: existing?.invitationId ?? null,
    regulator: regulator.code,
    registrationNumber,
    professionalCategory: existing?.professionalCategory ?? null,
    status,
    licenceExpiry: normaliseDate(input.licenceExpiry ?? null) ?? existing?.licenceExpiry ?? null,
    verificationSource: 'MANUAL',
    manualSource: source,
    manualCheckedAt: now,
    manualReviewReason: input.notes?.trim() || null,
    verifiedBy: context.userId ?? null,
    mode: 'manual',
    warnings: null,
    updatedAt: now,
  };

  let credentialId = existing?.id ?? null;

  if (existing) {
    await db
      .update(schema.staffProfessionalCredentials)
      .set(values)
      .where(eq(schema.staffProfessionalCredentials.id, existing.id));
  } else {
    const [created] = await db
      .insert(schema.staffProfessionalCredentials)
      .values(values)
      .returning({ id: schema.staffProfessionalCredentials.id });

    credentialId = created?.id ?? null;
  }

  await db.insert(schema.professionalVerificationEvents).values({
    tenantId: facility.tenantId,
    facilityId: facility.id,
    credentialId,
    action: 'MANUAL_VERIFICATION',
    statusBefore: existing?.status ?? null,
    statusAfter: status,
    source: 'MANUAL',
    mode: 'manual',
    performedBy: context.userId ?? null,
    notes: `${source}${input.notes ? ` — ${input.notes}` : ''}`,
  });

  return {
    credentialId,
    status,
    regulator: regulator.code,
    registrationNumber,
    manualSource: source,
    manualCheckedAt: now.toISOString(),
    /* Manual checks are explicitly not automated verification. */
    simulated: false,
    invitable: status === 'MANUALLY_VERIFIED',
  };
}

/* ============================================================
   READ
   ============================================================ */

export async function listCredentialsScoped(
  context: AuthorizationContext,
  facilityId?: number | string | null,
) {
  const facility = await resolveScope(context, facilityId);

  return db
    .select()
    .from(schema.staffProfessionalCredentials)
    .where(eq(schema.staffProfessionalCredentials.facilityId, facility.id))
    .orderBy(desc(schema.staffProfessionalCredentials.updatedAt));
}

export async function getVerificationDashboardScoped(
  context: AuthorizationContext,
  facilityId?: number | string | null,
) {
  const facility = await resolveScope(context, facilityId);
  const credentials = await listCredentialsScoped(context, facility.id);

  const now = Date.now();
  const inSixtyDays = now + 60 * 24 * 60 * 60 * 1000;

  const bucket = (statuses: string[]) =>
    credentials.filter((credential) => statuses.includes(credential.status));

  const expiringSoon = credentials.filter((credential) => {
    if (!credential.licenceExpiry) return false;

    const expiry = new Date(`${credential.licenceExpiry}T23:59:59`).getTime();

    return expiry >= now && expiry <= inSixtyDays;
  });

  const failedAttempts = await db
    .select({
      credentialId: schema.professionalVerificationEvents.credentialId,
      errorCode: schema.professionalVerificationEvents.errorCode,
      createdAt: schema.professionalVerificationEvents.createdAt,
    })
    .from(schema.professionalVerificationEvents)
    .where(
      and(
        eq(schema.professionalVerificationEvents.facilityId, facility.id),
        eq(schema.professionalVerificationEvents.action, 'VERIFY'),
        sql`${schema.professionalVerificationEvents.statusAfter} = 'SERVICE_UNAVAILABLE'`,
      ),
    )
    .orderBy(desc(schema.professionalVerificationEvents.createdAt))
    .limit(25);

  return {
    facilityId: facility.id,
    generatedAt: new Date().toISOString(),
    counts: {
      total: credentials.length,
      notVerified: bucket(['NOT_VERIFIED']).length,
      pending: bucket(['PENDING']).length,
      registrationVerified: bucket(['REGISTRATION_VERIFIED']).length,
      licenceConfirmed: bucket(['LICENCE_CONFIRMED']).length,
      licenceExpired: bucket(['LICENCE_EXPIRED']).length,
      registrationInactive: bucket(['REGISTRATION_INACTIVE']).length,
      identityMismatch: bucket(['IDENTITY_MISMATCH']).length,
      manualReview: bucket(['MANUAL_REVIEW_REQUIRED', 'RECORD_NOT_FOUND']).length,
      serviceUnavailable: bucket(['SERVICE_UNAVAILABLE']).length,
      manuallyVerified: bucket(['MANUALLY_VERIFIED']).length,
    },
    expiringSoon: expiringSoon.map((credential) => ({
      id: credential.id,
      regulator: credential.regulator,
      registrationNumber: credential.registrationNumber,
      licenceExpiry: credential.licenceExpiry,
      status: credential.status,
    })),
    needsReview: bucket(['IDENTITY_MISMATCH', 'MANUAL_REVIEW_REQUIRED', 'RECORD_NOT_FOUND']).map(
      (credential) => ({
        id: credential.id,
        regulator: credential.regulator,
        registrationNumber: credential.registrationNumber,
        status: credential.status,
        warnings: credential.warnings,
        updatedAt: credential.updatedAt,
      }),
    ),
    failedAttempts,
  };
}

/* ============================================================
   INVITATION GATE
   ============================================================ */

/**
 * Decide whether an invitation may be issued for this role.
 *
 * Called by the invitation service, so there is exactly one place that
 * decides who needs a credential and what counts as good enough.
 */
export async function assertInvitationCredential(
  input: {
    tenantId: number;
    facilityId: number;
    roleName: string;
    credentialId?: number | null;
  },
) {
  if (!requiresProfessionalVerification(input.roleName)) {
    return { required: false as const, credentialId: null };
  }

  const expectedRegulator = regulatorForStaffRole(input.roleName);

  if (!expectedRegulator) {
    throw new ProfessionalVerificationError(
      `No regulator is mapped to ${input.roleName}, so this role cannot be invited until one is configured.`,
      400,
      'REGULATOR_NOT_MAPPED',
    );
  }

  if (!Number.isSafeInteger(Number(input.credentialId)) || Number(input.credentialId) <= 0) {
    throw new ProfessionalVerificationError(
      `${input.roleName} requires a verified professional registration before an invitation can be issued. Run the verification check first.`,
      400,
      'VERIFICATION_REQUIRED',
    );
  }

  const [credential] = await db
    .select()
    .from(schema.staffProfessionalCredentials)
    .where(
      and(
        eq(schema.staffProfessionalCredentials.id, Number(input.credentialId)),
        eq(schema.staffProfessionalCredentials.facilityId, input.facilityId),
      ),
    )
    .limit(1);

  if (!credential) {
    throw new ProfessionalVerificationError(
      'That verification record does not belong to this facility.',
      403,
      'CREDENTIAL_NOT_FOUND',
    );
  }

  if (credential.regulator !== expectedRegulator.code) {
    throw new ProfessionalVerificationError(
      `${input.roleName} must be verified with ${expectedRegulator.shortName}, but this record is a ${credential.regulator} check.`,
      400,
      'REGULATOR_MISMATCH',
    );
  }

  if (credential.mode === 'mock') {
    throw new ProfessionalVerificationError(
      'This registration was checked against test fixtures, not a regulator. Record a manual check or complete a real verification before inviting.',
      409,
      'SIMULATED_VERIFICATION',
    );
  }

  if (!isInvitableStatus(credential.status)) {
    throw new ProfessionalVerificationError(
      `The registration for this practitioner is "${credential.status}", which does not permit an invitation for ${input.roleName}.`,
      409,
      'CREDENTIAL_NOT_INVITABLE',
    );
  }

  if (credential.userId) {
    throw new ProfessionalVerificationError(
      'This registration is already linked to a staff account at this facility.',
      409,
      'CREDENTIAL_ALREADY_LINKED',
    );
  }

  return {
    required: true as const,
    credentialId: credential.id,
    regulator: credential.regulator,
    registrationNumber: credential.registrationNumber,
  };
}
