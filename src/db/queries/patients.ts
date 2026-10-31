/**
 * JaliCare HMIS
 * Queries: Patient records, MRN allocation, and the scoped read/update paths
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import {
  ScopeAccessError,
  requireTenantScope,
  requireFacilityScope,
} from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import {
  identifierLookup,
  openPatientIdentifiers,
  openPatientRows,
  sealPatientIdentifiers,
} from '../../security/patient-identifiers.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.patients');

// Patients
export async function getPatients(tenantId?: number, facilityId?: number, search?: string) {
  try {
    const query = db.select().from(schema.patients);
    const conditions = [];

    if (tenantId) {
      conditions.push(eq(schema.patients.tenantId, tenantId));
    }

    if (facilityId) {
      conditions.push(eq(schema.patients.registrationFacilityId, facilityId));
    }

    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      const nationalIdToken = identifierLookup(search, 'nationalId');
      const shaToken = identifierLookup(search, 'shaNumber');

      conditions.push(
        or(
          ilike(schema.patients.firstName, searchTerm),
          ilike(schema.patients.lastName, searchTerm),
          ilike(schema.patients.mrn, searchTerm),
          ilike(schema.patients.phone, searchTerm),
          /*
           * An encrypted column cannot be matched with ILIKE. With a
           * key configured, an exact identifier is found through the
           * blind index instead; without one, the plaintext column
           * still answers.
           */
          ...(nationalIdToken
            ? [eq(schema.patients.nationalIdBlindIndex, nationalIdToken)]
            : [ilike(schema.patients.nationalId, searchTerm)]),
          ...(shaToken
            ? [eq(schema.patients.shaNumberBlindIndex, shaToken)]
            : [ilike(schema.patients.shaNumber, searchTerm)]),
        ),
      );
    }

    if (conditions.length > 0) {
      const rows = await query
        .where(and(...conditions))
        .orderBy(desc(schema.patients.createdAt))
        .limit(50);

      return openPatientRows(rows);
    }

    const rows = await query.orderBy(desc(schema.patients.createdAt)).limit(50);

    return openPatientRows(rows);
  } catch (error) {
    log.error({ err: error }, 'patients.fetch_failed');

    throw new Error('Failed to fetch patients', { cause: error });
  }
}

export async function getPatientById(id: number) {
  try {
    const res = await db.select().from(schema.patients).where(eq(schema.patients.id, id));
    return res[0] ? openPatientIdentifiers(res[0]) : null;
  } catch (error) {
    log.error({ err: error }, 'patient.fetch_failed');
    throw new Error('Failed to fetch patient', { cause: error });
  }
}

export async function createPatient(data: typeof schema.patients.$inferInsert) {
  try {
    const res = await db.insert(schema.patients).values(sealPatientIdentifiers(data)).returning();

    return res[0] ? openPatientIdentifiers(res[0]) : res[0];
  } catch (error) {
    log.error({ err: error }, 'patient.create_failed');
    throw new Error('Failed to create patient record', { cause: error });
  }
}

/**
 * A patient number the database can defend.
 *
 * The registration screen used to mint `MRN-2026-` plus four digits in
 * the browser, which is 9,000 possible values for an entire database:
 * eventually two patients collide, and the second registration fails
 * with a raw unique-key error. Numbers are now allocated here, one
 * higher than the highest the tenant already has, and the unique index
 * arbitrates if two registrations race.
 */
export async function nextPatientMrn(): Promise<string> {
  /*
   * `patients.mrn` is unique across the whole database, not per
   * tenant, so the sequence is global. A per-tenant counter would hand
   * two organisations the same number and the second insert would fail.
   */
  const [row] = await db
    .select({
      // A valid historical identifier may exceed both PostgreSQL int32 and
      // JavaScript's exact integer range. Preserve its full numeric suffix.
      highest: sql<
        string | null
      >`MAX((substring(${schema.patients.mrn} from '([0-9]+)$'))::numeric)`,
    })
    .from(schema.patients);

  const next = BigInt(row?.highest ?? '0') + 1n;
  const year = new Date().getFullYear();

  return `MRN-${year}-${String(next).padStart(6, '0')}`;
}

/** Raised when a caller supplies an MRN another patient already holds. */
export class PatientMrnConflictError extends Error {
  readonly code = 'MRN_ALREADY_EXISTS';

  constructor(mrn: string) {
    super(`Patient number ${mrn} is already in use. Leave it blank to have one allocated.`);
    this.name = 'PatientMrnConflictError';
  }
}

export async function createPatientScoped(
  context: AuthorizationContext,
  /*
   * The MRN is optional: leave it out and the server allocates the next
   * number for this tenant.
   */
  data: Omit<typeof schema.patients.$inferInsert, 'mrn'> & {
    mrn?: string | null;
  },
) {
  const requestedFacilityId = data.registrationFacilityId;

  if (!Number.isInteger(requestedFacilityId) || Number(requestedFacilityId) <= 0) {
    throw new ScopeAccessError('A valid registration facility is required.', 'FACILITY_REQUIRED');
  }

  const facility = await getFacilityByIdScoped(context, Number(requestedFacilityId));

  if (!facility) {
    throw new ScopeAccessError('Registration facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  const {
    id: _id,
    tenantId: _tenantId,
    registrationFacilityId: _requestedFacilityId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...safeData
  } = data;

  const suppliedMrn =
    typeof safeData.mrn === 'string' && safeData.mrn.trim() !== '' ? safeData.mrn.trim() : null;

  /*
   * Six attempts: a generated number may lose a race to a concurrent
   * registration, in which case the highest-numbered row has moved on
   * and the next attempt takes a fresh one.
   */
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const mrn = suppliedMrn ?? (await nextPatientMrn());

    try {
      const [patient] = await db
        .insert(schema.patients)
        .values(
          sealPatientIdentifiers({
            ...safeData,
            mrn,
            tenantId: facility.tenantId,
            registrationFacilityId: facility.id,
          }),
        )
        .returning();

      return openPatientIdentifiers(patient);
    } catch (error) {
      const code =
        (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;

      if (code !== '23505') throw error;

      lastError = error;

      if (suppliedMrn) throw new PatientMrnConflictError(suppliedMrn);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not allocate a patient number. Try again.');
}

export async function updatePatient(
  id: number,
  data: Partial<typeof schema.patients.$inferInsert>,
) {
  try {
    const res = await db
      .update(schema.patients)
      .set({ ...sealPatientIdentifiers(data), updatedAt: new Date() })
      .where(eq(schema.patients.id, id))
      .returning();

    return res[0] ? openPatientIdentifiers(res[0]) : res[0];
  } catch (error) {
    log.error({ err: error }, 'patient.update_failed');
    throw new Error('Failed to update patient record', { cause: error });
  }
}
// =========================================================
// SCOPED PATIENT QUERIES
// =========================================================

/**
 * Return a patient only if the authenticated user may access
 * the patient's registration facility.
 *
 * Cross-facility access to shared patient records must be
 * implemented separately using patientFacilities and the
 * relevant patient-consent/access policies.
 */
export async function getPatientByIdScoped(context: AuthorizationContext, patientId: number) {
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new Error('Invalid patient ID.');
  }

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, patientId))
    .limit(1);

  if (!patient) return null;

  requireTenantScope(context, patient.tenantId);

  requireFacilityScope(context, patient.tenantId, patient.registrationFacilityId);

  return openPatientIdentifiers(patient);
}

/**
 * List patients within the authenticated user's scope.
 * A facility user's facility assignment takes precedence
 * over any facility ID supplied by the frontend.
 */
export async function getPatientsScoped(
  context: AuthorizationContext,
  requestedTenantId?: number,
  requestedFacilityId?: number,
  search?: string,
) {
  const conditions = [];

  if (context.isSuperAdmin) {
    if (
      requestedTenantId === undefined ||
      !Number.isInteger(requestedTenantId) ||
      requestedTenantId <= 0
    ) {
      throw new Error('Super Admin must specify a valid target tenant.');
    }

    conditions.push(eq(schema.patients.tenantId, requestedTenantId));

    if (requestedFacilityId !== undefined) {
      const facility = await getFacilityByIdScoped(context, requestedFacilityId);

      if (!facility || facility.tenantId !== requestedTenantId) {
        throw new Error('The facility does not belong to the requested tenant.');
      }

      conditions.push(eq(schema.patients.registrationFacilityId, requestedFacilityId));
    }
  } else {
    if (context.tenantId === null) {
      throw new Error('Your account has no tenant assignment.');
    }

    requireTenantScope(context, context.tenantId);

    if (requestedTenantId !== undefined && requestedTenantId !== context.tenantId) {
      requireTenantScope(context, requestedTenantId);
    }

    conditions.push(eq(schema.patients.tenantId, context.tenantId));

    if (context.facilityId !== null) {
      if (requestedFacilityId !== undefined && requestedFacilityId !== context.facilityId) {
        throw new Error('You are not authorized to access this facility.');
      }

      conditions.push(eq(schema.patients.registrationFacilityId, context.facilityId));
    } else if (requestedFacilityId !== undefined) {
      const facility = await getFacilityByIdScoped(context, requestedFacilityId);

      if (!facility || facility.tenantId !== context.tenantId) {
        throw new Error('The facility does not belong to your tenant.');
      }

      conditions.push(eq(schema.patients.registrationFacilityId, requestedFacilityId));
    }
  }

  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    const nationalIdToken = identifierLookup(search, 'nationalId');
    const shaToken = identifierLookup(search, 'shaNumber');

    conditions.push(
      or(
        ilike(schema.patients.firstName, term),
        ilike(schema.patients.lastName, term),
        ilike(schema.patients.mrn, term),
        ilike(schema.patients.phone, term),
        ...(nationalIdToken
          ? [eq(schema.patients.nationalIdBlindIndex, nationalIdToken)]
          : [ilike(schema.patients.nationalId, term)]),
        ...(shaToken
          ? [eq(schema.patients.shaNumberBlindIndex, shaToken)]
          : [ilike(schema.patients.shaNumber, term)]),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(schema.patients)
    .where(and(...conditions))
    .orderBy(desc(schema.patients.createdAt))
    .limit(50);

  return openPatientRows(rows);
}

/**
 * Update a patient only after verifying access to the existing
 * record. Tenant and registration-facility ownership cannot
 * be changed through this function.
 */
export async function updatePatientScoped(
  context: AuthorizationContext,
  patientId: number,
  data: Partial<typeof schema.patients.$inferInsert>,
) {
  const patient = await getPatientByIdScoped(context, patientId);

  if (!patient) return null;

  const {
    id: _id,
    tenantId: _tenantId,
    registrationFacilityId: _facilityId,
    createdAt: _createdAt,
    ...safeData
  } = data;

  const [updated] = await db
    .update(schema.patients)
    .set({
      ...sealPatientIdentifiers(safeData),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.patients.id, patientId),
        eq(schema.patients.tenantId, patient.tenantId),
        eq(schema.patients.registrationFacilityId, patient.registrationFacilityId),
      ),
    )
    .returning();

  return updated ? openPatientIdentifiers(updated) : (updated ?? null);
}
