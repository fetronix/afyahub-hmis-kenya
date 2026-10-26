/**
 * JaliCare HMIS
 * Patient consent
 *
 * `patient_consents` has existed since migration 0002 with columns for
 * version, document hash, method, scope, expiry and revocation — and
 * nothing ever wrote to it. A privacy notice that cannot be evidenced
 * is not consent.
 *
 * WHAT A RECORD MEANS HERE
 * ========================
 *
 * A row states: *this patient, on this date, for this purpose, agreed
 * to this scope, through this method, and here is the hash of the
 * document they were shown.*
 *
 *   - **Scope** is an explicit map. A purpose with no scope grants
 *     nothing; it is not read as "everything".
 *   - **Revocation is a state change**, not a delete. The row stays,
 *     with `revoked_at` and the user who revoked it, because "consent
 *     was withdrawn on 3 March" is itself evidence.
 *   - **Expiry is enforced on read.** An expired consent is reported
 *     as EXPIRED, never as active.
 *   - **No invented consent.** Nothing is created on a patient's
 *     behalf by a migration, a seed or a default.
 *
 * WHAT THIS DOES NOT DO
 * =====================
 *
 * It does not yet gate every clinical read on an active consent. That
 * is a policy decision — emergency care must not be blocked by a
 * missing signature — and it belongs to the organisation. The service
 * exposes `hasActiveConsent()` so a screen or route can ask, and the
 * patient screen shows the current state.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';

/* ============================================================
   Vocabulary
   ============================================================ */

export const CONSENT_PURPOSES = [
  'TREATMENT',
  'SHARING_WITH_FACILITY',
  'SHARING_WITH_INSURER',
  'RESEARCH',
  'TEACHING',
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_METHODS = ['WRITTEN', 'VERBAL_WITNESSED', 'ELECTRONIC'] as const;

export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const CONSENT_SCOPES = [
  'patientProfile',
  'encounters',
  'diagnoses',
  'medications',
  'laboratory',
  'radiology',
  'maternity',
  'billing',
] as const;

export type ConsentScopeKey = (typeof CONSENT_SCOPES)[number];

export type ConsentStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export class ConsentError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ConsentError';
  }
}

/* ============================================================
   Scope and patient resolution
   ============================================================ */

interface ConsentScope {
  facilityId: number;
  tenantId: number;
  userId: number;
}

async function resolvePatient(
  context: AuthorizationContext,
  rawPatientId: unknown,
): Promise<{
  patient: typeof schema.patients.$inferSelect;
  scope: ConsentScope;
}> {
  const patientId = Number(rawPatientId);

  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new ConsentError('A valid patient id is required.', 400, 'INVALID_PATIENT_ID');
  }

  /*
   * The facility is resolved from the session, never from the request.
   * A patient registered elsewhere answers 404 rather than 403, so the
   * response cannot be used to probe which ids exist.
   */
  const facilityId = resolveFacilityScope(context, undefined);
  const facility = await db
    .select({
      id: schema.facilities.id,
      tenantId: schema.facilities.tenantId,
    })
    .from(schema.facilities)
    .where(eq(schema.facilities.id, facilityId))
    .limit(1);

  if (!facility[0]) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(
      and(eq(schema.patients.id, patientId), eq(schema.patients.tenantId, facility[0].tenantId)),
    )
    .limit(1);

  if (!patient) {
    throw new ConsentError('Patient not found.', 404, 'PATIENT_NOT_FOUND');
  }

  return {
    patient,
    scope: {
      facilityId: facility[0].id,
      tenantId: facility[0].tenantId,
      userId: context.userId,
    },
  };
}

/* ============================================================
   Derived state
   ============================================================ */

export function deriveConsentStatus(row: {
  status: string;
  expiresAt: Date | string | null;
}): ConsentStatus {
  if (row.status === 'REVOKED') return 'REVOKED';

  if (row.expiresAt) {
    /*
     * A timestamp can arrive as a Date (drizzle) or as an ISO string
     * (JSON replayed from an audit record, or a test). Both mean the
     * same thing; an unparseable value does not expire the consent,
     * because silently forgetting a permission is worse than keeping
     * it until an operator looks.
     */
    const expiry = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);

    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
      return 'EXPIRED';
    }
  }

  if (row.status === 'EXPIRED') return 'EXPIRED';

  return 'ACTIVE';
}

function shapeConsent(row: typeof schema.patientConsents.$inferSelect) {
  return {
    id: row.id,
    patientId: row.patientId,
    purpose: row.purpose,
    status: deriveConsentStatus(row),
    storedStatus: row.status,
    scope: (row.scope ?? {}) as Record<string, boolean>,
    method: row.consentMethod,
    grantedThrough: row.grantedThrough,
    documentHash: row.consentDocumentHash,
    version: row.consentVersion,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
  };
}

/* ============================================================
   Validation
   ============================================================ */

export interface GrantConsentInput {
  purpose: ConsentPurpose;
  method: ConsentMethod;
  scope: Partial<Record<ConsentScopeKey, boolean>>;
  grantedThrough?: string;
  documentHash?: string;
  expiresAt?: string | null;
  notes?: string;
}

export function validateConsentInput(input: unknown): GrantConsentInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConsentError('A consent object is required.', 400, 'INVALID_CONSENT_BODY');
  }

  const body = input as Record<string, unknown>;

  const purpose = body.purpose;

  if (typeof purpose !== 'string' || !CONSENT_PURPOSES.includes(purpose as ConsentPurpose)) {
    throw new ConsentError(
      `purpose must be one of: ${CONSENT_PURPOSES.join(', ')}.`,
      400,
      'INVALID_CONSENT_PURPOSE',
    );
  }

  const method = body.method;

  if (typeof method !== 'string' || !CONSENT_METHODS.includes(method as ConsentMethod)) {
    throw new ConsentError(
      `method must be one of: ${CONSENT_METHODS.join(', ')}.`,
      400,
      'INVALID_CONSENT_METHOD',
    );
  }

  const rawScope = body.scope;

  if (rawScope === null || typeof rawScope !== 'object' || Array.isArray(rawScope)) {
    throw new ConsentError(
      'scope must be an object naming what the patient agreed to share.',
      400,
      'INVALID_CONSENT_SCOPE',
    );
  }

  const scope: Partial<Record<ConsentScopeKey, boolean>> = {};

  for (const [key, value] of Object.entries(rawScope as Record<string, unknown>)) {
    if (!CONSENT_SCOPES.includes(key as ConsentScopeKey)) {
      throw new ConsentError(
        `Unknown scope "${key}". Allowed: ${CONSENT_SCOPES.join(', ')}.`,
        400,
        'UNKNOWN_CONSENT_SCOPE',
      );
    }

    if (typeof value !== 'boolean') {
      throw new ConsentError(`scope.${key} must be true or false.`, 400, 'INVALID_CONSENT_SCOPE');
    }

    scope[key as ConsentScopeKey] = value;
  }

  /*
   * A consent that grants nothing is not a consent. Refusing it here
   * stops a screen from recording a meaningless row that would later
   * look like evidence.
   */
  if (!Object.values(scope).some((granted) => granted === true)) {
    throw new ConsentError('A consent must grant at least one scope.', 400, 'EMPTY_CONSENT_SCOPE');
  }

  let expiresAt: string | null = null;

  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'string' || Number.isNaN(Date.parse(body.expiresAt))) {
      throw new ConsentError(
        'expiresAt must be an ISO date-time or null.',
        400,
        'INVALID_CONSENT_EXPIRY',
      );
    }

    expiresAt = body.expiresAt;
  }

  const documentHash = body.documentHash;

  if (
    documentHash !== undefined &&
    (typeof documentHash !== 'string' || documentHash.length > 200)
  ) {
    throw new ConsentError(
      'documentHash must be a string of at most 200 characters.',
      400,
      'INVALID_DOCUMENT_HASH',
    );
  }

  return {
    purpose: purpose as ConsentPurpose,
    method: method as ConsentMethod,
    scope,
    grantedThrough:
      typeof body.grantedThrough === 'string' ? body.grantedThrough.slice(0, 40) : 'STAFF',
    documentHash: typeof documentHash === 'string' ? documentHash : undefined,
    expiresAt,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : undefined,
  };
}

/* ============================================================
   Read
   ============================================================ */

export async function listConsents(context: AuthorizationContext, rawPatientId: unknown) {
  const { patient } = await resolvePatient(context, rawPatientId);

  const rows = await db
    .select()
    .from(schema.patientConsents)
    .where(eq(schema.patientConsents.patientId, patient.id))
    .orderBy(desc(schema.patientConsents.grantedAt));

  return {
    patientId: patient.id,
    consents: rows.map(shapeConsent),
    hasActiveTreatmentConsent: rows.some(
      (row) => row.purpose === 'TREATMENT' && deriveConsentStatus(row) === 'ACTIVE',
    ),
  };
}

/**
 * Ask whether an active consent covers a purpose.
 *
 * Not wired into every clinical read — see the file header — but
 * available to any route or screen that needs the answer.
 */
export async function hasActiveConsent(
  context: AuthorizationContext,
  rawPatientId: unknown,
  purpose: ConsentPurpose,
): Promise<boolean> {
  const result = await listConsents(context, rawPatientId);

  return result.consents.some(
    (consent) => consent.purpose === purpose && consent.status === 'ACTIVE',
  );
}

/* ============================================================
   Write
   ============================================================ */

export async function grantConsent(
  context: AuthorizationContext,
  rawPatientId: unknown,
  rawInput: unknown,
) {
  const { patient, scope: facilityScope } = await resolvePatient(context, rawPatientId);

  const input = validateConsentInput(rawInput);

  const [row] = await db
    .insert(schema.patientConsents)
    .values({
      patientId: patient.id,
      grantedByUserId: facilityScope.userId,
      recipientFacilityId: facilityScope.facilityId,
      purpose: input.purpose,
      status: 'ACTIVE',
      scope: input.scope,
      grantedAt: new Date(),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      consentVersion: 1,
      consentDocumentHash: input.documentHash ?? null,
      consentMethod: input.method,
      grantedThrough: input.grantedThrough ?? 'STAFF',
      metadata: input.notes ? { notes: input.notes } : {},
      updatedAt: new Date(),
    })
    .returning();

  await db.execute(sql`
    INSERT INTO audit_logs
      (tenant_id, facility_id, user_id, action, resource, resource_id, details, severity)
    VALUES
      (${facilityScope.tenantId}, ${facilityScope.facilityId},
       ${String(context.userId)}, 'CREATE', 'PatientConsent', ${String(row.id)},
       ${`Consent granted: ${input.purpose} (${input.method})`}, 'INFO')
  `);

  return shapeConsent(row);
}

export async function revokeConsent(
  context: AuthorizationContext,
  rawPatientId: unknown,
  rawConsentId: unknown,
  rawReason: unknown,
) {
  const { patient, scope: facilityScope } = await resolvePatient(context, rawPatientId);

  const consentId = Number(rawConsentId);

  if (!Number.isSafeInteger(consentId) || consentId <= 0) {
    throw new ConsentError('A valid consent id is required.', 400, 'INVALID_CONSENT_ID');
  }

  const [existing] = await db
    .select()
    .from(schema.patientConsents)
    .where(
      and(
        eq(schema.patientConsents.id, consentId),
        eq(schema.patientConsents.patientId, patient.id),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new ConsentError('Consent not found.', 404, 'CONSENT_NOT_FOUND');
  }

  if (existing.status === 'REVOKED') {
    return { changed: false, consent: shapeConsent(existing) };
  }

  const reason =
    typeof rawReason === 'string' && rawReason.trim() !== ''
      ? rawReason.trim().slice(0, 300)
      : null;

  const [row] = await db
    .update(schema.patientConsents)
    .set({
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: facilityScope.userId,
      updatedAt: new Date(),
      metadata: {
        ...((existing.metadata ?? {}) as Record<string, unknown>),
        ...(reason ? { revocationReason: reason } : {}),
      },
    })
    .where(eq(schema.patientConsents.id, consentId))
    .returning();

  await db.execute(sql`
    INSERT INTO audit_logs
      (tenant_id, facility_id, user_id, action, resource, resource_id, details, severity)
    VALUES
      (${facilityScope.tenantId}, ${facilityScope.facilityId},
       ${String(context.userId)}, 'UPDATE', 'PatientConsent', ${String(consentId)},
       ${reason ? `Consent revoked: ${reason}` : 'Consent revoked'}, 'WARNING')
  `);

  return { changed: true, consent: shapeConsent(row) };
}

/** Count of rows still holding a given status, for the readiness panel. */
export async function consentCountsForTenant(tenantId: number) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) FILTER (WHERE status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now()))::int`,
      revoked: sql<number>`count(*) FILTER (WHERE status = 'REVOKED')::int`,
    })
    .from(schema.patientConsents)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.patientConsents.patientId))
    .where(
      and(eq(schema.patients.tenantId, tenantId), isNull(schema.patients.mergedIntoPatientId)),
    );

  return row ?? { total: 0, active: 0, revoked: 0 };
}
