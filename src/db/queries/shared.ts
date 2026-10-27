/**
 * JaliCare HMIS
 * Queries: Helpers used by more than one query module
 *
 * Extracted from `../queries.ts`. The SQL, the scope checks and the transaction
 * boundaries are moved verbatim; nothing was rewritten.
 *
 * Unlike the domain modules, this one is not re-exported by the barrel. These
 * helpers were internal before the split and they stay internal, so the
 * barrel's public surface is unchanged.
 */
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import {
  ACTIVE_ADMISSION_STATUS,
  ADMISSION_STATUS_SET,
  ADMISSION_STATUSES,
  BED_STATUS_SET,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  CLOSED_ADMISSION_STATUS,
  InpatientDomainError,
} from '../inpatient-contracts.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

import { requirePatientInTenant } from './encounters.ts';

/**
 * Scope-aware encounter operations.
 * Facility ownership is verified against the database.
 * Tenant/facility ownership fields are never accepted from update payloads.
 */
export const encounterWritableFields = [
  'practitionerId',
  'departmentId',
  'encounterType',
  'status',
  'triageCategory',
  'chiefComplaint',
  'historyOfPresentIllness',
  'physicalExamination',
  'clinicalNotes',
  'followUpDate',
  'referralFacility',
  'startedAt',
  'endedAt',
] as const;

export function pickEncounterWritableFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set<string>(encounterWritableFields);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key)) continue;
    result[key] = value;
  }

  return result;
}

export async function validateEncounterReferences(
  facilityId: number,
  tenantId: number,
  data: Record<string, unknown>,
) {
  if (data.practitionerId !== undefined && data.practitionerId !== null) {
    const practitionerId = Number(data.practitionerId);
    if (!Number.isSafeInteger(practitionerId) || practitionerId <= 0) {
      throw new Error('Invalid practitioner ID.');
    }

    const [practitioner] = await db
      .select({ id: schema.practitioners.id })
      .from(schema.practitioners)
      .where(
        and(
          eq(schema.practitioners.id, practitionerId),
          eq(schema.practitioners.tenantId, tenantId),
          eq(schema.practitioners.facilityId, facilityId),
        ),
      )
      .limit(1);

    if (!practitioner) {
      throw new ScopeAccessError(
        'Practitioner is not assigned to the authorized facility.',
        'FACILITY_ACCESS_DENIED',
      );
    }
  }

  if (data.departmentId !== undefined && data.departmentId !== null) {
    const departmentId = Number(data.departmentId);
    if (!Number.isSafeInteger(departmentId) || departmentId <= 0) {
      throw new Error('Invalid department ID.');
    }

    const [department] = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(
        and(eq(schema.departments.id, departmentId), eq(schema.departments.facilityId, facilityId)),
      )
      .limit(1);

    if (!department) {
      throw new ScopeAccessError(
        'Department is not part of the authorized facility.',
        'FACILITY_ACCESS_DENIED',
      );
    }
  }
}

export async function resolveQueueOrLabScope(
  context: AuthorizationContext,
  data: {
    tenantId?: number | null;
    facilityId?: number | null;
    patientId?: number | null;
    encounterId?: number | null;
  },
) {
  let encounter: typeof schema.encounters.$inferSelect | undefined;

  if (data.encounterId !== undefined && data.encounterId !== null) {
    if (!Number.isSafeInteger(data.encounterId) || data.encounterId <= 0) {
      throw new Error('A valid encounter ID is required.');
    }

    const [found] = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, data.encounterId))
      .limit(1);

    if (!found) {
      throw new Error('Encounter not found.');
    }

    encounter = found;
  }

  // An encounter is authoritative when supplied. This also supports
  // requests where the browser accidentally omits facilityId.
  const requestedFacilityId = data.facilityId ?? encounter?.facilityId;
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  if (data.tenantId != null && data.tenantId !== facility.tenantId) {
    throw new ScopeAccessError(
      'The requested tenant does not match the authorized facility.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  if (
    encounter &&
    (encounter.facilityId !== facility.id || encounter.tenantId !== facility.tenantId)
  ) {
    throw new ScopeAccessError(
      'The encounter is outside the authorized facility.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  if (encounter && data.patientId != null && data.patientId !== encounter.patientId) {
    throw new ScopeAccessError(
      'The patient does not match the encounter.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  const patientId = encounter ? encounter.patientId : data.patientId;

  if (typeof patientId !== 'number' || !Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error('A valid patient ID is required.');
  }

  const patient = await requirePatientInTenant(context, patientId, facility.tenantId);

  if (!patient) {
    throw new Error('Patient not found.');
  }

  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    patientId: patient.id,
    encounterId: encounter?.id ?? null,
  };
}

/* ============================================================
   CLINICAL RECORD SCOPING
   ============================================================ */

/**
 * Diagnoses and procedures hang off an encounter, and an encounter
 * carries the tenant, facility and patient. Neither table has a facility
 * column, so a bare `select * from diagnoses` is a cross-facility read by
 * construction. These helpers resolve the encounter first and refuse the
 * request when it is outside the caller's scope.
 *
 * Observations are scoped in the nursing service; the equivalents here
 * cover the two paths that were still open.
 */

export async function loadEncounterInScope(context: AuthorizationContext, encounterId: number) {
  if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
    throw new ScopeAccessError('A valid encounter is required.', 'ENCOUNTER_REQUIRED');
  }

  const [encounter] = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);

  if (!encounter) {
    throw new ScopeAccessError('Encounter not found.', 'ENCOUNTER_NOT_FOUND');
  }

  if (encounter.tenantId !== context.tenantId) {
    throw new ScopeAccessError('Encounter not found.', 'ENCOUNTER_NOT_FOUND');
  }

  const facility = await getFacilityByIdScoped(context, encounter.facilityId);

  if (!facility || facility.tenantId !== encounter.tenantId) {
    throw new ScopeAccessError(
      'Encounter not found in the authorized facility.',
      'ENCOUNTER_NOT_FOUND',
    );
  }

  return encounter;
}

export async function loadPatientInScope(context: AuthorizationContext, patientId: number) {
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new ScopeAccessError('A valid patient is required.', 'PATIENT_REQUIRED');
  }

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, patientId))
    .limit(1);

  if (!patient || patient.tenantId !== context.tenantId) {
    throw new ScopeAccessError('Patient not found.', 'PATIENT_NOT_FOUND');
  }

  /*
   * A patient registered elsewhere in the tenant is still treatable here,
   * so the registration facility is not the test. The test is whether this
   * caller can see the patient at all: either they are a tenant-level user,
   * or the patient has been seen at — or registered at — their facility.
   */
  if (context.facilityId) {
    const [seen] = await db
      .select({ id: schema.encounters.id })
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.patientId, patient.id),
          eq(schema.encounters.facilityId, context.facilityId),
        ),
      )
      .limit(1);

    if (!seen && patient.registrationFacilityId !== context.facilityId) {
      throw new ScopeAccessError('Patient not found.', 'PATIENT_NOT_FOUND');
    }
  }

  return patient;
}

export function requirePositiveId(value: unknown, field: string): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', `A valid ${field} is required.`, 400);
  }

  return id;
}

export function optionalText(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.slice(0, maxLength);
}

export function formatTimestampNow(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  ].join(' ');
}

export function normaliseTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed.slice(0, 40);
  }

  return formatTimestampNow();
}

/**
 * Resolve the facility for an inpatient operation and prove it exists
 * inside the user's authorised scope.
 */
export async function requireInpatientFacility(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new InpatientDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  }

  return facility;
}

/**
 * Load a bed and prove that its ward belongs to a facility the
 * authenticated user may access.
 */
export async function requireBedInScope(context: AuthorizationContext, bedId: number) {
  const [bed] = await db.select().from(schema.beds).where(eq(schema.beds.id, bedId)).limit(1);

  if (!bed) {
    throw new InpatientDomainError('BED_NOT_FOUND', 'Bed not found.', 404);
  }

  const [ward] = await db
    .select()
    .from(schema.wards)
    .where(eq(schema.wards.id, bed.wardId))
    .limit(1);

  if (!ward) {
    throw new InpatientDomainError('BED_NOT_FOUND', 'Bed is not attached to a ward.', 404);
  }

  const facility = await getFacilityByIdScoped(context, ward.facilityId);

  if (!facility) {
    throw new InpatientDomainError(
      'BED_NOT_FOUND',
      'Bed not found in the authorised facility.',
      404,
    );
  }

  return { bed, ward, facility };
}

/**
 * Find the catalogue row a free-text investigation name refers to.
 *
 * The outpatient screen orders laboratory tests as text ("Malaria
 * rapid diagnostic test"), not as catalogue ids, so `lab_orders.test_id`
 * was NULL for every such order. That is why a facility could link a
 * test to a tariff and still bill nothing: there was no id to link on.
 *
 * Matching is deliberately strict — an exact, normalised equality of
 * the catalogue code or the catalogue name, inside this facility, for
 * active rows only. It is not a fuzzy search: "Blood" matches nothing
 * unless the catalogue literally has a test called "Blood", and if two
 * active tests normalise to the same name the answer is "ambiguous",
 * not the first row.
 *
 * Returns the test, or null plus the reason, so the caller can bill
 * what it can and report the rest instead of silently guessing.
 */
export async function resolveCatalogueTestByName(
  executor: {
    select: typeof db.select;
  },
  facilityId: number,
  rawName: string,
): Promise<{
  test: { id: number; code: string; name: string } | null;
  reason: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
}> {
  const name = rawName.trim();
  const key = normaliseCatalogueKey(name);

  if (key === '') return { test: null, reason: 'NOT_FOUND' };

  const rows = await executor
    .select({
      id: schema.labTests.id,
      code: schema.labTests.code,
      name: schema.labTests.name,
    })
    .from(schema.labTests)
    .where(
      and(
        eq(schema.labTests.facilityId, facilityId),
        eq(schema.labTests.isActive, true),
        or(
          sql`${normaliseCatalogueKeySql(schema.labTests.name)} = ${key}`,
          sql`${normaliseCatalogueKeySql(schema.labTests.code)} = ${key}`,
        ),
      ),
    )
    .limit(5);

  if (rows.length === 1) return { test: rows[0], reason: 'FOUND' };
  if (rows.length > 1) return { test: null, reason: 'AMBIGUOUS' };

  return { test: null, reason: 'NOT_FOUND' };
}

/** Lower-case words only: punctuation and spacing are not identity. */
export function normaliseCatalogueKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The same normalisation in SQL, so the comparison happens in one place. */
export function normaliseCatalogueKeySql(column: any) {
  return sql`trim(regexp_replace(lower(${column}), '[^a-z0-9]+', ' ', 'g'))`;
}

/* ------------------------------------------------------------
   NURSING NOTES
   ------------------------------------------------------------ */

export const NURSING_NOTE_TYPES = new Set([
  'Progress',
  'Observation',
  'Handover',
  'Medication',
  'Incident',
]);

export function toCentsPositive(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
