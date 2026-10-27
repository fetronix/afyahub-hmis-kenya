/**
 * JaliCare HMIS
 * Queries: Clinical encounters and the references they validate
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import {
  ScopeAccessError,
  requireTenantScope,
  resolveFacilityScope,
} from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { pickEncounterWritableFields, validateEncounterReferences } from './shared.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

// Encounters
export async function getEncounters(patientId?: number, facilityId?: number) {
  try {
    const query = db.select().from(schema.encounters);
    const conditions = [];
    if (patientId) conditions.push(eq(schema.encounters.patientId, patientId));
    if (facilityId) conditions.push(eq(schema.encounters.facilityId, facilityId));

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.encounters.startedAt))
        .limit(50);
    }
    return await query.orderBy(desc(schema.encounters.startedAt)).limit(50);
  } catch (error) {
    console.error('Error fetching encounters:', error);
    throw new Error('Failed to fetch clinical encounters', { cause: error });
  }
}

export async function createEncounter(data: typeof schema.encounters.$inferInsert) {
  try {
    const res = await db.insert(schema.encounters).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating encounter:', error);
    throw new Error('Failed to create encounter', { cause: error });
  }
}

export async function updateEncounter(
  id: number,
  data: Partial<typeof schema.encounters.$inferInsert>,
) {
  try {
    const res = await db
      .update(schema.encounters)
      .set(data)
      .where(eq(schema.encounters.id, id))
      .returning();
    return res[0];
  } catch (error) {
    console.error('Error updating encounter:', error);
    throw new Error('Failed to update encounter', { cause: error });
  }
}

export async function requirePatientInTenant(
  context: AuthorizationContext,
  patientId: number,
  tenantId: number,
) {
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error('A valid patient ID is required.');
  }

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, patientId))
    .limit(1);

  if (!patient) return null;

  requireTenantScope(context, patient.tenantId);

  if (patient.tenantId !== tenantId) {
    throw new ScopeAccessError(
      'Patient is outside the authorized tenant.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  return patient;
}

export async function getEncountersScoped(
  context: AuthorizationContext,
  patientId?: number,
  requestedFacilityId?: number,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  const conditions = [
    eq(schema.encounters.tenantId, facility.tenantId),
    eq(schema.encounters.facilityId, facility.id),
  ];

  if (patientId !== undefined) {
    const patient = await requirePatientInTenant(context, patientId, facility.tenantId);

    if (!patient) return [];

    conditions.push(eq(schema.encounters.patientId, patient.id));
  }

  return db
    .select()
    .from(schema.encounters)
    .where(and(...conditions))
    .orderBy(desc(schema.encounters.startedAt))
    .limit(50);
}

export async function createEncounterScoped(
  context: AuthorizationContext,
  data: typeof schema.encounters.$inferInsert,
) {
  const facilityId = resolveFacilityScope(context, data.facilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  const patient = await requirePatientInTenant(context, data.patientId, facility.tenantId);

  if (!patient) {
    throw new Error('Patient not found.');
  }

  const safeData = pickEncounterWritableFields(data as Record<string, unknown>);

  await validateEncounterReferences(facility.id, facility.tenantId, safeData);

  const [created] = await db
    .insert(schema.encounters)
    .values({
      ...safeData,
      tenantId: facility.tenantId,
      facilityId: facility.id,
      patientId: patient.id,
    } as typeof schema.encounters.$inferInsert)
    .returning();

  return created;
}

export async function updateEncounterScoped(
  context: AuthorizationContext,
  encounterId: number,
  data: Partial<typeof schema.encounters.$inferInsert>,
) {
  if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
    throw new Error('Invalid encounter ID.');
  }

  const [current] = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);

  if (!current) return null;

  const facility = await getFacilityByIdScoped(context, current.facilityId);

  if (!facility || facility.tenantId !== current.tenantId) {
    throw new ScopeAccessError(
      'Encounter is outside the authorized facility.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  if (data.patientId !== undefined && data.patientId !== current.patientId) {
    throw new Error(
      'Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.',
    );
  }

  const safeData = pickEncounterWritableFields(data as Record<string, unknown>);

  /*
   * Completing a visit ends it. The screen sends `status` only; a
   * browser-supplied `endedAt` arrived as a string and Drizzle's
   * timestamp mapping cannot take one, so the server stamps it.
   */
  if (safeData.status === 'Completed' || safeData.status === 'Cancelled') {
    safeData.endedAt = safeData.endedAt ?? new Date();
  }

  await validateEncounterReferences(facility.id, facility.tenantId, safeData);

  const [updated] = await db
    .update(schema.encounters)
    .set({
      ...safeData,
      updatedAt: new Date(),
    } as Partial<typeof schema.encounters.$inferInsert>)
    .where(
      and(
        eq(schema.encounters.id, encounterId),
        eq(schema.encounters.tenantId, facility.tenantId),
        eq(schema.encounters.facilityId, facility.id),
      ),
    )
    .returning();

  return updated ?? null;
}
