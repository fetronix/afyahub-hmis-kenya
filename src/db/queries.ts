import { ScopeAccessError } from '../auth/scope.service.ts';
import { db } from './index.ts';
import * as schema from './schema.ts';
import { eq, desc, and, or, ilike, sql, inArray } from 'drizzle-orm';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import {
  requireTenantScope,
  requireFacilityScope,
  resolveFacilityScope,
} from '../auth/scope.service.ts';

import {
  bedDayDates,
  bedDayTariffCodes,
  chargeForService,
} from '../billing/billing.service.ts';

export { bedDayTariffCodes } from '../billing/billing.service.ts';

// Tenants
export async function getTenants() {
  try {
    return await db.select().from(schema.tenants).where(eq(schema.tenants.isActive, true));
  } catch (error) {
    console.error('Error fetching tenants:', error);
    throw new Error('Failed to fetch tenants from database', { cause: error });
  }
}

export async function getTenantById(id: number) {
  try {
    const res = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id));
    return res[0] || null;
  } catch (error) {
    console.error('Error fetching tenant:', error);
    throw new Error('Failed to fetch tenant', { cause: error });
  }
}

// Facilities
export async function getFacilities(tenantId?: number) {
  try {
    if (tenantId) {
      return await db.select().from(schema.facilities).where(eq(schema.facilities.tenantId, tenantId));
    }
    return await db.select().from(schema.facilities);
  } catch (error) {
    console.error('Error fetching facilities:', error);
    throw new Error('Failed to fetch facilities', { cause: error });
  }
}

// =========================================================
// SECURE TENANT / FACILITY SCOPE QUERIES
// =========================================================

/**
 * Get a tenant only if the authenticated user
 * is authorized to access that tenant.
 *
 * IMPORTANT:
 * This function performs the authorization check BEFORE
 * returning tenant data.
 */
export async function getTenantByIdScoped(
  context: AuthorizationContext,
  tenantId: number,
) {
  try {
    requireTenantScope(
      context,
      tenantId,
    );

    const result = await db
      .select()
      .from(schema.tenants)
      .where(
        and(
          eq(schema.tenants.id, tenantId),
          eq(schema.tenants.isActive, true),
        ),
      )
      .limit(1);

    return result[0] || null;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ScopeAccessError'
    ) {
      throw error;
    }

    console.error(
      'Error fetching scoped tenant:',
      error,
    );

    throw new Error(
      'Failed to fetch tenant',
      { cause: error },
    );
  }
}

/**
 * Get tenants visible to the authenticated user.
 *
 * SUPER_ADMIN:
 *   All active tenants.
 *
 * Tenant user:
 *   Only their own tenant.
 *
 * Facility user:
 *   Only their own tenant.
 */
export async function getTenantsScoped(
  context: AuthorizationContext,
) {
  try {
    if (
      context.tenantId === null
    ) {
      return await db
        .select()
        .from(schema.tenants)
        .where(
          eq(
            schema.tenants.isActive,
            true,
          ),
        );
    }

    return await db
      .select()
      .from(schema.tenants)
      .where(
        and(
          eq(
            schema.tenants.id,
            context.tenantId,
          ),
          eq(
            schema.tenants.isActive,
            true,
          ),
        ),
      );
  } catch (error) {
    console.error(
      'Error fetching scoped tenants:',
      error,
    );

    throw new Error(
      'Failed to fetch tenants',
      { cause: error },
    );
  }
}

/**
 * Get facilities visible to the authenticated user.
 *
 * SUPER_ADMIN:
 *   Can see facilities for any requested tenant.
 *
 * TENANT user:
 *   Can see facilities only within their tenant.
 *
 * FACILITY user:
 *   Can see only their assigned facility.
 *
 * The requested tenantId is NEVER allowed to override
 * the authenticated user's actual tenant.
 */
export async function getFacilitiesScoped(
  context: AuthorizationContext,
  requestedTenantId?: number,
) {
  try {
    /*
     * SUPER_ADMIN
     *
     * They can request a specific tenant's facilities.
     * If no tenant is supplied, they can see all facilities.
     */
    if (
      context.tenantId === null
    ) {
      if (
        requestedTenantId !== undefined
      ) {
        requireTenantScope(
          context,
          requestedTenantId,
        );

        return await db
          .select()
          .from(schema.facilities)
          .where(
            eq(
              schema.facilities.tenantId,
              requestedTenantId,
            ),
          );
      }

      return await db
        .select()
        .from(schema.facilities);
    }

    /*
     * Normal tenant user
     *
     * The authenticated tenant is authoritative.
     */
    const tenantId =
      context.tenantId;

    requireTenantScope(
      context,
      tenantId,
    );

    /*
     * If the frontend supplied another tenantId,
     * requireTenantScope above will reject it.
     */
    if (
      requestedTenantId !== undefined
    ) {
      requireTenantScope(
        context,
        requestedTenantId,
      );
    }

    /*
     * Facility-level user:
     * return ONLY their facility.
     */
    if (
      context.facilityId !== null
    ) {
      return await db
        .select()
        .from(schema.facilities)
        .where(
          and(
            eq(
              schema.facilities.id,
              context.facilityId,
            ),
            eq(
              schema.facilities.tenantId,
              tenantId,
            ),
          ),
        );
    }

    /*
     * Tenant-level user:
     * return all facilities belonging
     * to their tenant.
     */
    return await db
      .select()
      .from(schema.facilities)
      .where(
        eq(
          schema.facilities.tenantId,
          tenantId,
        ),
      );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ScopeAccessError'
    ) {
      throw error;
    }

    console.error(
      'Error fetching scoped facilities:',
      error,
    );

    throw new Error(
      'Failed to fetch facilities',
      { cause: error },
    );
  }
}

/**
 * Get a specific facility only when the authenticated
 * user is authorized to access it.
 *
 * The facility's tenantId is read FROM THE DATABASE.
 * It is never trusted from the request.
 */
export async function getFacilityByIdScoped(
  context: AuthorizationContext,
  facilityId: number,
) {
  try {
    const facilityResult =
      await db
        .select()
        .from(schema.facilities)
        .where(
          eq(
            schema.facilities.id,
            facilityId,
          ),
        )
        .limit(1);

    const facility =
      facilityResult[0];

    if (!facility) {
      return null;
    }

    /*
     * IMPORTANT:
     *
     * facility.tenantId comes from the database.
     *
     * We do NOT use:
     *
     * req.query.tenantId
     * req.body.tenantId
     */
    requireFacilityScope(
      context,
      facility.tenantId,
      facility.id,
    );

    return facility;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ScopeAccessError'
    ) {
      throw error;
    }

    console.error(
      'Error fetching scoped facility:',
      error,
    );

    throw new Error(
      'Failed to fetch facility',
      { cause: error },
    );
  }
}

// Departments
export async function getDepartments(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.departments).where(eq(schema.departments.facilityId, facilityId));
    }
    return await db.select().from(schema.departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    throw new Error('Failed to fetch departments', { cause: error });
  }
}

// Patients
export async function getPatients(
  tenantId?: number,
  facilityId?: number,
  search?: string,
) {
  try {
    let query = db.select().from(schema.patients);
    const conditions = [];

    if (tenantId) {
      conditions.push(
        eq(schema.patients.tenantId, tenantId),
      );
    }

    if (facilityId) {
      conditions.push(
        eq(
          schema.patients.registrationFacilityId,
          facilityId,
        ),
      );
    }

    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;

      conditions.push(
        or(
          ilike(schema.patients.firstName, searchTerm),
          ilike(schema.patients.lastName, searchTerm),
          ilike(schema.patients.mrn, searchTerm),
          ilike(schema.patients.phone, searchTerm),
          ilike(schema.patients.nationalId, searchTerm),
          ilike(schema.patients.shaNumber, searchTerm),
        ),
      );
    }

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.patients.createdAt))
        .limit(50);
    }

    return await query
      .orderBy(desc(schema.patients.createdAt))
      .limit(50);
  } catch (error) {
    console.error('Error fetching patients:', error);

    throw new Error(
      'Failed to fetch patients',
      { cause: error },
    );
  }
}

export async function getPatientById(id: number) {
  try {
    const res = await db.select().from(schema.patients).where(eq(schema.patients.id, id));
    return res[0] || null;
  } catch (error) {
    console.error('Error fetching patient by id:', error);
    throw new Error('Failed to fetch patient', { cause: error });
  }
}

export async function createPatient(data: typeof schema.patients.$inferInsert) {
  try {
    const res = await db.insert(schema.patients).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating patient:', error);
    throw new Error('Failed to create patient record', { cause: error });
  }
}

export async function createPatientScoped(
  context: AuthorizationContext,
  data: typeof schema.patients.$inferInsert,
) {
  const requestedFacilityId = data.registrationFacilityId;

  if (
    !Number.isInteger(requestedFacilityId) ||
    Number(requestedFacilityId) <= 0
  ) {
    throw new ScopeAccessError(
      'A valid registration facility is required.',
      'FACILITY_REQUIRED',
    );
  }

  const facility = await getFacilityByIdScoped(
    context,
    Number(requestedFacilityId),
  );

  if (!facility) {
    throw new ScopeAccessError(
      'Registration facility not found.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  const {
    id: _id,
    tenantId: _tenantId,
    registrationFacilityId: _requestedFacilityId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...safeData
  } = data;

  const [patient] = await db
    .insert(schema.patients)
    .values({
      ...safeData,
      tenantId: facility.tenantId,
      registrationFacilityId: facility.id,
    })
    .returning();

  return patient;
}

export async function updatePatient(id: number, data: Partial<typeof schema.patients.$inferInsert>) {
  try {
    const res = await db.update(schema.patients).set({ ...data, updatedAt: new Date() }).where(eq(schema.patients.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating patient:', error);
    throw new Error('Failed to update patient record', { cause: error });
  }
}

// Encounters
export async function getEncounters(patientId?: number, facilityId?: number) {
  try {
    let query = db.select().from(schema.encounters);
    const conditions = [];
    if (patientId) conditions.push(eq(schema.encounters.patientId, patientId));
    if (facilityId) conditions.push(eq(schema.encounters.facilityId, facilityId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.encounters.startedAt)).limit(50);
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

export async function updateEncounter(id: number, data: Partial<typeof schema.encounters.$inferInsert>) {
  try {
    const res = await db.update(schema.encounters).set(data).where(eq(schema.encounters.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating encounter:', error);
    throw new Error('Failed to update encounter', { cause: error });
  }
}


/**
 * Scope-aware encounter operations.
 * Facility ownership is verified against the database.
 * Tenant/facility ownership fields are never accepted from update payloads.
 */
const encounterWritableFields = [
  "practitionerId",
  "departmentId",
  "encounterType",
  "status",
  "triageCategory",
  "chiefComplaint",
  "historyOfPresentIllness",
  "physicalExamination",
  "clinicalNotes",
  "followUpDate",
  "referralFacility",
  "startedAt",
  "endedAt",
] as const;

function pickEncounterWritableFields(
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

export async function requirePatientInTenant(
  context: AuthorizationContext,
  patientId: number,
  tenantId: number,
) {
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error("A valid patient ID is required.");
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
      "Patient is outside the authorized tenant.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  return patient;
}

async function validateEncounterReferences(
  facilityId: number,
  tenantId: number,
  data: Record<string, unknown>,
) {
  if (data.practitionerId !== undefined && data.practitionerId !== null) {
    const practitionerId = Number(data.practitionerId);
    if (!Number.isSafeInteger(practitionerId) || practitionerId <= 0) {
      throw new Error("Invalid practitioner ID.");
    }

    const [practitioner] = await db
      .select({ id: schema.practitioners.id })
      .from(schema.practitioners)
      .where(and(
        eq(schema.practitioners.id, practitionerId),
        eq(schema.practitioners.tenantId, tenantId),
        eq(schema.practitioners.facilityId, facilityId),
      ))
      .limit(1);

    if (!practitioner) {
      throw new ScopeAccessError(
        "Practitioner is not assigned to the authorized facility.",
        "FACILITY_ACCESS_DENIED",
      );
    }
  }

  if (data.departmentId !== undefined && data.departmentId !== null) {
    const departmentId = Number(data.departmentId);
    if (!Number.isSafeInteger(departmentId) || departmentId <= 0) {
      throw new Error("Invalid department ID.");
    }

    const [department] = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(and(
        eq(schema.departments.id, departmentId),
        eq(schema.departments.facilityId, facilityId),
      ))
      .limit(1);

    if (!department) {
      throw new ScopeAccessError(
        "Department is not part of the authorized facility.",
        "FACILITY_ACCESS_DENIED",
      );
    }
  }
}

export async function getEncountersScoped(
  context: AuthorizationContext,
  patientId?: number,
  requestedFacilityId?: number,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError("Facility not found.", "FACILITY_ACCESS_DENIED");
  }

  const conditions = [
    eq(schema.encounters.tenantId, facility.tenantId),
    eq(schema.encounters.facilityId, facility.id),
  ];

  if (patientId !== undefined) {
    const patient = await requirePatientInTenant(
      context,
      patientId,
      facility.tenantId,
    );

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
    throw new ScopeAccessError("Facility not found.", "FACILITY_ACCESS_DENIED");
  }

  const patient = await requirePatientInTenant(
    context,
    data.patientId,
    facility.tenantId,
  );

  if (!patient) {
    throw new Error("Patient not found.");
  }

  const safeData = pickEncounterWritableFields(
    data as Record<string, unknown>,
  );

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
    throw new Error("Invalid encounter ID.");
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
      "Encounter is outside the authorized facility.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  if (
    data.patientId !== undefined &&
    data.patientId !== current.patientId
  ) {
    throw new Error(
      "Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.",
    );
  }

  const safeData = pickEncounterWritableFields(
    data as Record<string, unknown>,
  );

  await validateEncounterReferences(facility.id, facility.tenantId, safeData);

  const [updated] = await db
    .update(schema.encounters)
    .set({
      ...safeData,
      updatedAt: new Date(),
    } as Partial<typeof schema.encounters.$inferInsert>)
    .where(and(
      eq(schema.encounters.id, encounterId),
      eq(schema.encounters.tenantId, facility.tenantId),
      eq(schema.encounters.facilityId, facility.id),
    ))
    .returning();

  return updated ?? null;
}
// Queues
export async function getQueues(facilityId?: number, queueType?: string) {
  try {
    let query = db.select().from(schema.queues);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.queues.facilityId, facilityId));
    if (queueType && queueType !== 'All') conditions.push(eq(schema.queues.queueType, queueType));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.queues.createdAt)).limit(100);
    }
    return await query.orderBy(desc(schema.queues.createdAt)).limit(100);
  } catch (error) {
    console.error('Error fetching queues:', error);
    throw new Error('Failed to fetch patient queues', { cause: error });
  }
}

async function resolveQueueOrLabScope(
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
      throw new Error("A valid encounter ID is required.");
    }

    const [found] = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, data.encounterId))
      .limit(1);

    if (!found) {
      throw new Error("Encounter not found.");
    }

    encounter = found;
  }

  // An encounter is authoritative when supplied. This also supports
  // requests where the browser accidentally omits facilityId.
  const requestedFacilityId = data.facilityId ?? encounter?.facilityId;
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError("Facility not found.", "FACILITY_ACCESS_DENIED");
  }

  if (data.tenantId != null && data.tenantId !== facility.tenantId) {
    throw new ScopeAccessError(
      "The requested tenant does not match the authorized facility.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  if (
    encounter &&
    (encounter.facilityId !== facility.id ||
      encounter.tenantId !== facility.tenantId)
  ) {
    throw new ScopeAccessError(
      "The encounter is outside the authorized facility.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  if (
    encounter &&
    data.patientId != null &&
    data.patientId !== encounter.patientId
  ) {
    throw new ScopeAccessError(
      "The patient does not match the encounter.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  const patientId = encounter ? encounter.patientId : data.patientId;

  if (
    typeof patientId !== "number" ||
    !Number.isSafeInteger(patientId) ||
    patientId <= 0
  ) {
    throw new Error("A valid patient ID is required.");
  }

  const patient = await requirePatientInTenant(
    context,
    patientId,
    facility.tenantId,
  );

  if (!patient) {
    throw new Error("Patient not found.");
  }

  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    patientId: patient.id,
    encounterId: encounter?.id ?? null,
  };
}

export async function createQueueEntry(
  context: AuthorizationContext,
  data: typeof schema.queues.$inferInsert,
) {
  const scope = await resolveQueueOrLabScope(context, data);

  try {
    const res = await db
      .insert(schema.queues)
      .values({ ...data, ...scope })
      .returning();

    return res[0];
  } catch (error) {
    console.error('Error creating queue entry:', error);
    throw new Error('Failed to create queue entry', { cause: error });
  }
}

export async function updateQueueStatus(id: number, status: string) {
  try {
    const res = await db.update(schema.queues).set({ status }).where(eq(schema.queues.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating queue status:', error);
    throw new Error('Failed to update queue status', { cause: error });
  }
}

// Appointments
export async function getAppointments(facilityId?: number, practitionerId?: number) {
  try {
    let query = db.select().from(schema.appointments);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.appointments.facilityId, facilityId));
    if (practitionerId) conditions.push(eq(schema.appointments.practitionerId, practitionerId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.appointments.createdAt)).limit(50);
    }
    return await query.orderBy(desc(schema.appointments.createdAt)).limit(50);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    throw new Error('Failed to fetch appointments', { cause: error });
  }
}

export async function createAppointment(data: typeof schema.appointments.$inferInsert) {
  try {
    const res = await db.insert(schema.appointments).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating appointment:', error);
    throw new Error('Failed to create appointment', { cause: error });
  }
}

// Observations / Vitals
export async function getObservations(encounterId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.observations);
    const conditions = [];
    if (encounterId) conditions.push(eq(schema.observations.encounterId, encounterId));
    if (patientId) conditions.push(eq(schema.observations.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.observations.recordedAt)).limit(20);
    }
    return await query.orderBy(desc(schema.observations.recordedAt)).limit(20);
  } catch (error) {
    console.error('Error fetching vitals:', error);
    throw new Error('Failed to fetch vital observations', { cause: error });
  }
}

export async function recordObservation(data: typeof schema.observations.$inferInsert) {
  try {
    const res = await db.insert(schema.observations).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error recording observation:', error);
    throw new Error('Failed to save vital observation', { cause: error });
  }
}

// Diagnoses
export async function getDiagnoses(encounterId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.diagnoses);
    const conditions = [];
    if (encounterId) conditions.push(eq(schema.diagnoses.encounterId, encounterId));
    if (patientId) conditions.push(eq(schema.diagnoses.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.diagnoses.diagnosedAt));
    }
    return await query.orderBy(desc(schema.diagnoses.diagnosedAt));
  } catch (error) {
    console.error('Error fetching diagnoses:', error);
    throw new Error('Failed to fetch diagnoses', { cause: error });
  }
}

export async function recordDiagnosis(data: typeof schema.diagnoses.$inferInsert) {
  try {
    const res = await db.insert(schema.diagnoses).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error recording diagnosis:', error);
    throw new Error('Failed to record ICD-10 diagnosis', { cause: error });
  }
}

// Clinical Procedures
export async function getProcedures(encounterId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.clinicalProcedures);
    const conditions = [];
    if (encounterId) conditions.push(eq(schema.clinicalProcedures.encounterId, encounterId));
    if (patientId) conditions.push(eq(schema.clinicalProcedures.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.clinicalProcedures.performedAt));
    }
    return await query.orderBy(desc(schema.clinicalProcedures.performedAt));
  } catch (error) {
    console.error('Error fetching procedures:', error);
    throw new Error('Failed to fetch clinical procedures', { cause: error });
  }
}

export async function recordProcedure(data: typeof schema.clinicalProcedures.$inferInsert) {
  try {
    const res = await db.insert(schema.clinicalProcedures).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error recording procedure:', error);
    throw new Error('Failed to record procedure', { cause: error });
  }
}

// Medications & Prescriptions
export async function getMedications(encounterId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.medications);
    const conditions = [];
    if (encounterId) conditions.push(eq(schema.medications.encounterId, encounterId));
    if (patientId) conditions.push(eq(schema.medications.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.medications.prescribedAt));
    }
    return await query.orderBy(desc(schema.medications.prescribedAt));
  } catch (error) {
    console.error('Error fetching medications:', error);
    throw new Error('Failed to fetch prescriptions', { cause: error });
  }
}

export async function createMedication(data: typeof schema.medications.$inferInsert) {
  try {
    const res = await db.insert(schema.medications).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error prescribing medication:', error);
    throw new Error('Failed to prescribe medication', { cause: error });
  }
}

export async function updateMedicationStatus(id: number, status: string) {
  try {
    const res = await db.update(schema.medications).set({ status }).where(eq(schema.medications.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating medication status:', error);
    throw new Error('Failed to update medication status', { cause: error });
  }
}

// ============================================================
// INPATIENT: WARDS, BEDS AND ADMISSIONS (SCOPED)
// ============================================================
//
// Tenant and facility scope are ALWAYS derived from the
// authenticated AuthorizationContext. Client-supplied
// tenantId / facilityId values are never trusted.
//
// Occupancy is created only by admitting a patient, and is
// released only by discharging one. Bed status therefore
// cannot be used to forge an occupied bed.

import {
  ACTIVE_ADMISSION_STATUS,
  ADMISSION_STATUS_SET,
  ADMISSION_STATUSES,
  BED_STATUS_SET,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  CLOSED_ADMISSION_STATUS,
  InpatientDomainError,
} from './inpatient-contracts.ts';

export {
  ADMISSION_STATUSES,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  InpatientDomainError,
  type InpatientErrorCode,
} from './inpatient-contracts.ts';

function requirePositiveId(value: unknown, field: string): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `A valid ${field} is required.`,
      400,
    );
  }

  return id;
}

function optionalText(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.slice(0, maxLength);
}

function formatTimestampNow(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  ].join(' ');
}

function normaliseTimestamp(value: unknown): string {
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
async function requireInpatientFacility(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new InpatientDomainError(
      'FACILITY_NOT_FOUND',
      'Facility not found.',
      404,
    );
  }

  return facility;
}

/**
 * Load a bed and prove that its ward belongs to a facility the
 * authenticated user may access.
 */
async function requireBedInScope(
  context: AuthorizationContext,
  bedId: number,
) {
  const [bed] = await db
    .select()
    .from(schema.beds)
    .where(eq(schema.beds.id, bedId))
    .limit(1);

  if (!bed) {
    throw new InpatientDomainError(
      'BED_NOT_FOUND',
      'Bed not found.',
      404,
    );
  }

  const [ward] = await db
    .select()
    .from(schema.wards)
    .where(eq(schema.wards.id, bed.wardId))
    .limit(1);

  if (!ward) {
    throw new InpatientDomainError(
      'BED_NOT_FOUND',
      'Bed is not attached to a ward.',
      404,
    );
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

/* ------------------------------------------------------------
   WARDS
   ------------------------------------------------------------ */

export async function getWardsScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
) {
  const facility = await requireInpatientFacility(
    context,
    requestedFacilityId,
  );

  return db
    .select()
    .from(schema.wards)
    .where(eq(schema.wards.facilityId, facility.id))
    .orderBy(schema.wards.name);
}

/* ------------------------------------------------------------
   BEDS
   ------------------------------------------------------------ */

export async function getBedsScoped(
  context: AuthorizationContext,
  wardId?: number | null,
) {
  if (wardId !== undefined && wardId !== null) {
    const id = requirePositiveId(wardId, 'ward ID');

    const [ward] = await db
      .select()
      .from(schema.wards)
      .where(eq(schema.wards.id, id))
      .limit(1);

    if (!ward) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Ward not found.',
        404,
      );
    }

    const facility = await getFacilityByIdScoped(context, ward.facilityId);

    if (!facility) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Ward not found in the authorised facility.',
        404,
      );
    }

    return db
      .select()
      .from(schema.beds)
      .where(eq(schema.beds.wardId, ward.id))
      .orderBy(schema.beds.bedNumber);
  }

  const facility = await requireInpatientFacility(context);

  const wardRows = await db
    .select({ id: schema.wards.id })
    .from(schema.wards)
    .where(eq(schema.wards.facilityId, facility.id));

  if (wardRows.length === 0) return [];

  return db
    .select()
    .from(schema.beds)
    .where(
      inArray(
        schema.beds.wardId,
        wardRows.map((row) => row.id),
      ),
    )
    .orderBy(schema.beds.bedNumber);
}

/* ------------------------------------------------------------
   ADMISSIONS — READ
   ------------------------------------------------------------ */

export async function getAdmissionsScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
  status?: string | null,
) {
  const facility = await requireInpatientFacility(
    context,
    requestedFacilityId,
  );

  const conditions = [
    eq(schema.admissions.facilityId, facility.id),
  ];

  if (typeof status === 'string' && status.trim()) {
    const normalised = status.trim();

    if (!ADMISSION_STATUS_SET.has(normalised)) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        `Admission status must be one of: ${ADMISSION_STATUSES.join(', ')}.`,
        400,
      );
    }

    conditions.push(eq(schema.admissions.status, normalised));
  }

  return db
    .select()
    .from(schema.admissions)
    .where(and(...conditions))
    .orderBy(desc(schema.admissions.createdAt));
}

export async function getAdmissionByIdScoped(
  context: AuthorizationContext,
  admissionId: number,
) {
  const id = requirePositiveId(admissionId, 'admission ID');

  const [admission] = await db
    .select()
    .from(schema.admissions)
    .where(eq(schema.admissions.id, id))
    .limit(1);

  if (!admission) return null;

  requireTenantScope(context, admission.tenantId);
  requireFacilityScope(
    context,
    admission.tenantId,
    admission.facilityId,
  );

  return admission;
}

/* ------------------------------------------------------------
   ADMISSIONS — CREATE
   ------------------------------------------------------------ */

export interface CreateAdmissionInput {
  facilityId?: number | null;
  patientId: number;
  wardId: number;
  bedId: number;
  encounterId?: number | null;
  admissionDate?: string;
  admissionType?: string;
  admittingDoctor?: string | null;
  provisionalDiagnosis?: string | null;
  nursingNotes?: string | null;
}

export async function createAdmissionScoped(
  context: AuthorizationContext,
  input: CreateAdmissionInput,
) {
  const patientId = requirePositiveId(input?.patientId, 'patient ID');
  const wardId = requirePositiveId(input?.wardId, 'ward ID');
  const bedId = requirePositiveId(input?.bedId, 'bed ID');

  const facility = await requireInpatientFacility(
    context,
    input?.facilityId,
  );

  const patient = await requirePatientInTenant(
    context,
    patientId,
    facility.tenantId,
  );

  if (!patient) {
    throw new InpatientDomainError(
      'PATIENT_NOT_FOUND',
      'Patient not found in the authorised facility.',
      404,
    );
  }

  let encounterId: number | null = null;

  if (
    input?.encounterId !== undefined &&
    input?.encounterId !== null &&
    String(input.encounterId) !== ''
  ) {
    encounterId = requirePositiveId(input.encounterId, 'encounter ID');
  }

  const admissionDate = normaliseTimestamp(input?.admissionDate);
  const admissionType =
    optionalText(input?.admissionType, 60) ?? 'Emergency';

  return await db.transaction(async (tx) => {
    const [ward] = await tx
      .select()
      .from(schema.wards)
      .where(
        and(
          eq(schema.wards.id, wardId),
          eq(schema.wards.facilityId, facility.id),
        ),
      )
      .limit(1);

    if (!ward) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Ward not found in the authorised facility.',
        404,
      );
    }

    const [bed] = await tx
      .select()
      .from(schema.beds)
      .where(
        and(
          eq(schema.beds.id, bedId),
          eq(schema.beds.wardId, ward.id),
        ),
      )
      .limit(1);

    if (!bed) {
      throw new InpatientDomainError(
        'BED_NOT_FOUND',
        'Bed not found in the selected ward.',
        404,
      );
    }

    if (encounterId !== null) {
      const [encounter] = await tx
        .select({ id: schema.encounters.id })
        .from(schema.encounters)
        .where(
          and(
            eq(schema.encounters.id, encounterId),
            eq(schema.encounters.patientId, patient.id),
            eq(schema.encounters.facilityId, facility.id),
          ),
        )
        .limit(1);

      if (!encounter) {
        throw new InpatientDomainError(
          'ENCOUNTER_NOT_FOUND',
          'Encounter not found for this patient at this facility.',
          404,
        );
      }
    }

    /* ---- Bed availability ---------------------------------- */

    const [activeOnBed] = await tx
      .select({ id: schema.admissions.id })
      .from(schema.admissions)
      .where(
        and(
          eq(schema.admissions.bedId, bed.id),
          eq(schema.admissions.status, ACTIVE_ADMISSION_STATUS),
        ),
      )
      .limit(1);

    if (activeOnBed) {
      throw new InpatientDomainError(
        'BED_OCCUPIED',
        'That bed already has an active admission.',
        409,
      );
    }

    if (bed.status === 'Occupied') {
      throw new InpatientDomainError(
        'BED_OCCUPIED',
        'That bed is already marked as occupied.',
        409,
      );
    }

    if (bed.status !== 'Available' && bed.status !== 'Cleaning') {
      throw new InpatientDomainError(
        'BED_NOT_AVAILABLE',
        `That bed is not available (current status: ${bed.status ?? 'unknown'}).`,
        409,
      );
    }

    /* ---- One active admission per patient per facility ------ */

    const [existingAdmission] = await tx
      .select({ id: schema.admissions.id })
      .from(schema.admissions)
      .where(
        and(
          eq(schema.admissions.patientId, patient.id),
          eq(schema.admissions.facilityId, facility.id),
          eq(schema.admissions.status, ACTIVE_ADMISSION_STATUS),
        ),
      )
      .limit(1);

    if (existingAdmission) {
      throw new InpatientDomainError(
        'PATIENT_ALREADY_ADMITTED',
        'This patient already has an active admission at this facility.',
        409,
      );
    }

    /* ---- Insert admission ---------------------------------- */

    const [created] = await tx
      .insert(schema.admissions)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        patientId: patient.id,
        encounterId,
        wardId: ward.id,
        bedId: bed.id,
        admissionDate,
        admissionType,
        admittingDoctor: optionalText(input?.admittingDoctor, 120),
        provisionalDiagnosis: optionalText(
          input?.provisionalDiagnosis,
          2000,
        ),
        nursingNotes: optionalText(input?.nursingNotes, 4000),
        status: ACTIVE_ADMISSION_STATUS,
      })
      .returning();

    /* ---- Occupy the bed in the same transaction ------------ */

    await tx
      .update(schema.beds)
      .set({
        status: 'Occupied',
        currentPatientId: patient.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.beds.id, bed.id));

    return created;
  });
}

/* ------------------------------------------------------------
   ADMISSIONS — DISCHARGE
   ------------------------------------------------------------ */

export interface DischargeAdmissionInput {
  dischargeDate?: string;
  dischargeType?: string | null;
  dischargeSummary?: string | null;
}

export async function dischargeAdmissionScoped(
  context: AuthorizationContext,
  admissionId: number,
  input: DischargeAdmissionInput,
) {
  const id = requirePositiveId(admissionId, 'admission ID');

  return await db.transaction(async (tx) => {
    const [admission] = await tx
      .select()
      .from(schema.admissions)
      .where(eq(schema.admissions.id, id))
      .limit(1);

    if (!admission) {
      throw new InpatientDomainError(
        'ADMISSION_NOT_FOUND',
        'Admission not found.',
        404,
      );
    }

    requireTenantScope(context, admission.tenantId);
    requireFacilityScope(
      context,
      admission.tenantId,
      admission.facilityId,
    );

    if (admission.status !== ACTIVE_ADMISSION_STATUS) {
      throw new InpatientDomainError(
        'ADMISSION_ALREADY_CLOSED',
        `This admission is already closed (status: ${admission.status ?? 'unknown'}).`,
        409,
      );
    }

    const [updated] = await tx
      .update(schema.admissions)
      .set({
        status: CLOSED_ADMISSION_STATUS,
        dischargeDate: normaliseTimestamp(input?.dischargeDate),
        dischargeType: optionalText(input?.dischargeType, 120),
        dischargeSummary: optionalText(input?.dischargeSummary, 8000),
        updatedAt: new Date(),
      })
      .where(eq(schema.admissions.id, admission.id))
      .returning();

    /*
     * Release the bed recorded ON THE ADMISSION.
     *
     * A client-supplied bedId is never used here: doing so allowed one
     * patient's discharge to free another patient's bed. The patient
     * condition additionally prevents clobbering a bed that has since
     * been reassigned.
     */
    if (admission.bedId) {
      await tx
        .update(schema.beds)
        .set({
          status: 'Cleaning',
          currentPatientId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.beds.id, admission.bedId),
            eq(schema.beds.currentPatientId, admission.patientId),
          ),
        );
    }

    return updated;
  });
}

/* ------------------------------------------------------------
   BEDS — STATUS AND RELEASE
   ------------------------------------------------------------ */

export async function setBedStatusScoped(
  context: AuthorizationContext,
  bedId: number,
  nextStatus: unknown,
) {
  const id = requirePositiveId(bedId, 'bed ID');

  if (
    typeof nextStatus !== 'string' ||
    !BED_STATUS_SET.has(nextStatus)
  ) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `Bed status must be one of: ${BED_STATUSES.join(', ')}.`,
      400,
    );
  }

  if (!BED_STATUS_SETTABLE.has(nextStatus)) {
    throw new InpatientDomainError(
      'BED_STATUS_NOT_ALLOWED',
      'Bed occupancy is created by admitting a patient, not by changing bed status.',
      400,
    );
  }

  const { bed } = await requireBedInScope(context, id);

  if (
    bed.status === 'Occupied' ||
    (bed.currentPatientId !== null && bed.currentPatientId !== undefined)
  ) {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      'This bed is occupied. Discharge or transfer the patient first.',
      409,
    );
  }

  const [updated] = await db
    .update(schema.beds)
    .set({
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(schema.beds.id, bed.id))
    .returning();

  return updated;
}

/**
 * Release a cleaned bed back into service (Cleaning → Available).
 *
 * Without this, every discharge removes a bed from the usable board
 * permanently, because nothing else ever restores 'Available'.
 */
export async function releaseBedScoped(
  context: AuthorizationContext,
  bedId: number,
) {
  const id = requirePositiveId(bedId, 'bed ID');

  const { bed } = await requireBedInScope(context, id);

  if (
    bed.currentPatientId !== null &&
    bed.currentPatientId !== undefined
  ) {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      'This bed still has a patient assigned. Discharge or transfer the patient first.',
      409,
    );
  }

  if (bed.status !== 'Cleaning') {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      `Only beds in Cleaning can be released to Available (current status: ${bed.status ?? 'unknown'}).`,
      409,
    );
  }

  const [updated] = await db
    .update(schema.beds)
    .set({
      status: 'Available',
      currentPatientId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.beds.id, bed.id))
    .returning();

  return updated;
}

// Operating Theatres
export async function getTheatreCases(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.theatreCases).where(eq(schema.theatreCases.facilityId, facilityId)).orderBy(desc(schema.theatreCases.createdAt));
    }
    return await db.select().from(schema.theatreCases).orderBy(desc(schema.theatreCases.createdAt));
  } catch (error) {
    console.error('Error fetching theatre cases:', error);
    throw new Error('Failed to fetch theatre cases', { cause: error });
  }
}

export async function createTheatreCase(data: typeof schema.theatreCases.$inferInsert) {
  try {
    const res = await db.insert(schema.theatreCases).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating theatre case:', error);
    throw new Error('Failed to schedule theatre case', { cause: error });
  }
}

export async function updateTheatreCase(id: number, data: Partial<typeof schema.theatreCases.$inferInsert>) {
  try {
    const res = await db.update(schema.theatreCases).set(data).where(eq(schema.theatreCases.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating theatre case:', error);
    throw new Error('Failed to update theatre case', { cause: error });
  }
}

// Laboratory
export async function getLabTests(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.labTests).where(and(eq(schema.labTests.facilityId, facilityId), eq(schema.labTests.isActive, true)));
    }
    return await db.select().from(schema.labTests).where(eq(schema.labTests.isActive, true));
  } catch (error) {
    console.error('Error fetching lab tests:', error);
    throw new Error('Failed to fetch lab tests catalogue', { cause: error });
  }
}

export async function getLabOrders(
  context: AuthorizationContext,
  facilityId?: number,
  patientId?: number,
) {
  const scopedFacilityId = resolveFacilityScope(context, facilityId);
  const facility = await getFacilityByIdScoped(context, scopedFacilityId);

  if (!facility) {
    throw new Error('Facility not found.');
  }

  const conditions = [
    eq(schema.labOrders.facilityId, facility.id),
    eq(schema.labOrders.tenantId, facility.tenantId),
  ];

  if (patientId !== undefined) {
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new Error('Invalid patient ID.');
    }
    conditions.push(eq(schema.labOrders.patientId, patientId));
  }

  return db
    .select()
    .from(schema.labOrders)
    .where(and(...conditions))
    .orderBy(desc(schema.labOrders.orderedAt));
}

export async function createLabOrder(
  context: AuthorizationContext,
  data: typeof schema.labOrders.$inferInsert,
) {
  const scope = await resolveQueueOrLabScope(context, data);

  try {
    const res = await db
      .insert(schema.labOrders)
      .values({ ...data, ...scope })
      .returning();

    return res[0];
  } catch (error) {
    console.error('Error creating lab order:', error);
    throw new Error('Failed to order lab test', { cause: error });
  }
}

export async function updateLabOrderStatus(
  context: AuthorizationContext,
  id: number,
  status: string,
  accessionNumber?: string,
) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid laboratory order ID.');
  }

  // This endpoint handles collection workflow only; it cannot publish results.
  if (status !== 'Ordered' && status !== 'Sample Collected') {
    throw new Error('Unsupported laboratory order status.');
  }

  const found = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, id))
    .limit(1);

  const order = found[0];
  if (!order) {
    throw new Error('Laboratory order not found.');
  }

  const facility = await getFacilityByIdScoped(context, order.facilityId);
  if (!facility || facility.tenantId !== order.tenantId) {
    throw new Error('Laboratory order not found in the authorized facility.');
  }

  const updateData: {
    status: string;
    sampleCollectedAt?: Date;
    sampleAccessionNumber?: string;
  } = { status };

  if (status === 'Sample Collected') {
    updateData.sampleCollectedAt = new Date();
    updateData.sampleAccessionNumber =
      accessionNumber?.trim() ||
      `ACC-${Date.now().toString().slice(-6)}`;
  }

  const updated = await db
    .update(schema.labOrders)
    .set(updateData)
    .where(
      and(
        eq(schema.labOrders.id, id),
        eq(schema.labOrders.facilityId, facility.id),
        eq(schema.labOrders.tenantId, facility.tenantId),
      ),
    )
    .returning();

  if (!updated[0]) {
    throw new Error('Laboratory order could not be updated.');
  }

  return updated[0];
}

export async function getLabResults(
  context: AuthorizationContext,
  orderId?: number,
  patientId?: number,
  facilityId?: number,
) {
  if (orderId !== undefined) {
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new Error('Invalid laboratory order ID.');
    }

    const found = await db
      .select()
      .from(schema.labOrders)
      .where(eq(schema.labOrders.id, orderId))
      .limit(1);

    const order = found[0];
    if (!order) {
      throw new Error('Laboratory order not found.');
    }

    const facility = await getFacilityByIdScoped(context, order.facilityId);
    if (!facility || facility.tenantId !== order.tenantId) {
      throw new Error('Laboratory order not found in the authorized facility.');
    }

    if (patientId !== undefined && patientId !== order.patientId) {
      throw new Error('Patient does not match the selected laboratory order.');
    }

    return db
      .select()
      .from(schema.labResults)
      .where(
        and(
          eq(schema.labResults.orderId, order.id),
          eq(schema.labResults.patientId, order.patientId),
        ),
      )
      .orderBy(desc(schema.labResults.verifiedAt));
  }

  // Listing results without an order is still limited to the authorized facility.
  const scopedFacilityId = resolveFacilityScope(context, facilityId);
  const facility = await getFacilityByIdScoped(context, scopedFacilityId);

  if (!facility) {
    throw new Error('Facility not found.');
  }

  const orders = await db
    .select({ id: schema.labOrders.id })
    .from(schema.labOrders)
    .where(
      and(
        eq(schema.labOrders.facilityId, facility.id),
        eq(schema.labOrders.tenantId, facility.tenantId),
        ...(patientId !== undefined
          ? [eq(schema.labOrders.patientId, patientId)]
          : []),
      ),
    );

  if (orders.length === 0) {
    return [];
  }

  return db
    .select()
    .from(schema.labResults)
    .where(inArray(schema.labResults.orderId, orders.map((order) => order.id)))
    .orderBy(desc(schema.labResults.verifiedAt));
}

export async function addLabResult(
  context: AuthorizationContext,
  data: typeof schema.labResults.$inferInsert,
) {
  if (!Number.isInteger(data.orderId) || data.orderId <= 0) {
    throw new Error('Valid laboratory order ID is required.');
  }

  const found = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, data.orderId))
    .limit(1);

  const order = found[0];
  if (!order) {
    throw new Error('Laboratory order not found.');
  }

  const facility = await getFacilityByIdScoped(context, order.facilityId);
  if (!facility || facility.tenantId !== order.tenantId) {
    throw new Error('Laboratory order not found in the authorized facility.');
  }

  if (data.patientId !== order.patientId) {
    throw new Error('Result patient must match the laboratory order patient.');
  }

  if (
    typeof data.parameterName !== 'string' ||
    !data.parameterName.trim() ||
    typeof data.measuredValue !== 'string' ||
    !data.measuredValue.trim()
  ) {
    throw new Error('Parameter name and measured value are required.');
  }

  const inserted = await db
    .insert(schema.labResults)
    .values({
      ...data,
      parameterName: data.parameterName.trim(),
      measuredValue: data.measuredValue.trim(),
      status: 'Pending Verification',
      verifiedBy: null,
      verifiedAt: null,
    })
    .returning();

  return inserted[0];
}

export async function verifyLabResult(
  context: AuthorizationContext,
  resultId: number,
  verifiedBy: string,
) {
  if (!Number.isInteger(resultId) || resultId <= 0) {
    throw new Error('Invalid laboratory result ID.');
  }

  if (!verifiedBy.trim()) {
    throw new Error('Verifier identity is required.');
  }

  const found = await db
    .select()
    .from(schema.labResults)
    .where(eq(schema.labResults.id, resultId))
    .limit(1);

  const result = found[0];
  if (!result) {
    throw new Error('Laboratory result not found.');
  }

  const orderRows = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, result.orderId))
    .limit(1);

  const order = orderRows[0];
  if (!order || order.patientId !== result.patientId) {
    throw new Error('Laboratory result does not match its order patient.');
  }

  const facility = await getFacilityByIdScoped(context, order.facilityId);
  if (!facility || facility.tenantId !== order.tenantId) {
    throw new Error('Laboratory result not found in the authorized facility.');
  }

  if (result.status === 'Verified' || result.verifiedAt || result.verifiedBy) {
    throw new Error('This laboratory result has already been verified.');
  }

  const updated = await db
    .update(schema.labResults)
    .set({
      status: 'Verified',
      verifiedBy: verifiedBy.trim(),
      verifiedAt: new Date(),
    })
    .where(
      and(
        eq(schema.labResults.id, resultId),
        eq(schema.labResults.orderId, order.id),
        eq(schema.labResults.patientId, order.patientId),
      ),
    )
    .returning();

  if (!updated[0]) {
    throw new Error('Laboratory result could not be verified.');
  }

  return updated[0];
}

// Radiology
export async function getRadiologyOrders(facilityId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.radiologyOrders);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.radiologyOrders.facilityId, facilityId));
    if (patientId) conditions.push(eq(schema.radiologyOrders.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.radiologyOrders.createdAt));
    }
    return await query.orderBy(desc(schema.radiologyOrders.createdAt));
  } catch (error) {
    console.error('Error fetching radiology orders:', error);
    throw new Error('Failed to fetch imaging requests', { cause: error });
  }
}

export async function createRadiologyOrder(data: typeof schema.radiologyOrders.$inferInsert) {
  try {
    const res = await db.insert(schema.radiologyOrders).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating radiology order:', error);
    throw new Error('Failed to create radiology order', { cause: error });
  }
}

export async function updateRadiologyReport(id: number, findings: string, impression: string, reportedBy: string) {
  try {
    const res = await db.update(schema.radiologyOrders).set({
      status: 'Reported',
      radiologistFindings: findings,
      impression,
      reportedBy,
      reportedAt: new Date()
    }).where(eq(schema.radiologyOrders.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error saving radiology report:', error);
    throw new Error('Failed to save radiology findings', { cause: error });
  }
}

// Pharmacy & Inventory
export async function getInventoryItems(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.facilityId, facilityId)).orderBy(schema.inventoryItems.name);
    }
    return await db.select().from(schema.inventoryItems).orderBy(schema.inventoryItems.name);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    throw new Error('Failed to fetch pharmacy inventory', { cause: error });
  }
}

export async function createInventoryItem(data: typeof schema.inventoryItems.$inferInsert) {
  try {
    const res = await db.insert(schema.inventoryItems).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating inventory item:', error);
    throw new Error('Failed to create inventory item', { cause: error });
  }
}

export async function dispenseMedication(data: typeof schema.pharmacyDispensations.$inferInsert) {
  try {
    const res = await db.insert(schema.pharmacyDispensations).values(data).returning();
    // deduct from inventory if item specified
    if (data.itemId) {
      await db.update(schema.inventoryItems)
        .set({ currentStock: sql`${schema.inventoryItems.currentStock} - ${data.quantityDispensed}` })
        .where(eq(schema.inventoryItems.id, data.itemId));
    }
    // update prescription status if linked
    if (data.prescriptionId) {
      await db.update(schema.medications)
        .set({ status: 'Dispensed' })
        .where(eq(schema.medications.id, data.prescriptionId));
    }
    return res[0];
  } catch (error) {
    console.error('Error dispensing medication:', error);
    throw new Error('Failed to complete pharmacy dispensing', { cause: error });
  }
}

// Procurement
export async function getSuppliers(tenantId?: number) {
  try {
    if (tenantId) {
      return await db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, tenantId));
    }
    return await db.select().from(schema.suppliers);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    throw new Error('Failed to fetch suppliers', { cause: error });
  }
}

export async function getPurchaseOrders(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.facilityId, facilityId)).orderBy(desc(schema.purchaseOrders.createdAt));
    }
    return await db.select().from(schema.purchaseOrders).orderBy(desc(schema.purchaseOrders.createdAt));
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    throw new Error('Failed to fetch purchase orders', { cause: error });
  }
}

export async function createPurchaseOrder(data: typeof schema.purchaseOrders.$inferInsert) {
  try {
    const res = await db.insert(schema.purchaseOrders).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating PO:', error);
    throw new Error('Failed to create purchase order', { cause: error });
  }
}

// Finance & Billing
export async function getInvoices(facilityId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.billingInvoices);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.billingInvoices.facilityId, facilityId));
    if (patientId) conditions.push(eq(schema.billingInvoices.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.billingInvoices.createdAt));
    }
    return await query.orderBy(desc(schema.billingInvoices.createdAt));
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Failed to fetch billing invoices', { cause: error });
  }
}

export async function createInvoice(
  invoiceData: typeof schema.billingInvoices.$inferInsert,
  items: Array<Omit<typeof schema.billingItems.$inferInsert, 'invoiceId'>>
) {
  try {
    return await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(schema.billingInvoices)
        .values(invoiceData)
        .returning();

      if (!invoice) {
        throw new Error('Invoice insert returned no record');
      }

      if (items.length > 0) {
        const itemsToInsert = items.map((item) => ({
          ...item,
          invoiceId: invoice.id,
        }));

        await tx.insert(schema.billingItems).values(itemsToInsert);
      }

      return invoice;
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    throw new Error('Failed to create patient invoice', { cause: error });
  }
}
export async function getInvoiceItems(invoiceId: number) {
  try {
    return await db.select().from(schema.billingItems).where(eq(schema.billingItems.invoiceId, invoiceId));
  } catch (error) {
    console.error('Error fetching invoice items:', error);
    throw new Error('Failed to fetch invoice line items', { cause: error });
  }
}

export async function recordPayment(
  paymentData: typeof schema.billingPayments.$inferInsert
) {
  try {
    return await db.transaction(async (tx) => {
      // Lock the invoice so simultaneous payments cannot both spend
      // the same outstanding balance.
      const [invoice] = await tx
        .select()
        .from(schema.billingInvoices)
        .where(eq(schema.billingInvoices.id, paymentData.invoiceId))
        .for('update');

      if (!invoice) {
        throw new Error('INVOICE_NOT_FOUND');
      }

      const amountCents = Math.round(Number(paymentData.amount) * 100);
      const balanceCents = Math.round(Number(invoice.balanceAmount ?? 0) * 100);
      const totalCents = Math.round(Number(invoice.totalAmount ?? 0) * 100);
      const paidCents = Math.round(Number(invoice.paidAmount ?? 0) * 100);

      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new Error('INVALID_PAYMENT_AMOUNT');
      }

      if (amountCents > balanceCents) {
        throw new Error('PAYMENT_EXCEEDS_BALANCE');
      }

      const newPaidCents = paidCents + amountCents;
      const newBalanceCents = Math.max(0, totalCents - newPaidCents);
      const newStatus =
        newBalanceCents === 0
          ? 'Paid'
          : newPaidCents > 0
            ? 'Partially Paid'
            : 'Unpaid';

      // Both writes are part of the same transaction. If either fails,
      // PostgreSQL rolls back both.
      const [payment] = await tx
        .insert(schema.billingPayments)
        .values(paymentData)
        .returning();

      if (!payment) {
        throw new Error('Payment insert returned no record');
      }

      await tx
        .update(schema.billingInvoices)
        .set({
          paidAmount: (newPaidCents / 100).toFixed(2),
          balanceAmount: (newBalanceCents / 100).toFixed(2),
          status: newStatus,
        })
        .where(eq(schema.billingInvoices.id, invoice.id));

      return payment;
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    throw new Error('Failed to record patient payment', { cause: error });
  }
}
// Insurance Claims
export async function getClaims(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.insuranceClaims).where(eq(schema.insuranceClaims.facilityId, facilityId)).orderBy(desc(schema.insuranceClaims.claimNumber));
    }
    return await db.select().from(schema.insuranceClaims).orderBy(desc(schema.insuranceClaims.claimNumber));
  } catch (error) {
    console.error('Error fetching insurance claims:', error);
    throw new Error('Failed to fetch claims', { cause: error });
  }
}

export async function createClaim(data: typeof schema.insuranceClaims.$inferInsert) {
  try {
    const res = await db.insert(schema.insuranceClaims).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating insurance claim:', error);
    throw new Error('Failed to submit insurance claim', { cause: error });
  }
}

export async function updateClaimStatus(id: number, status: string, approvedAmount?: string, notes?: string) {
  try {
    const updateData: any = { status };
    if (approvedAmount !== undefined) updateData.approvedAmount = approvedAmount;
    if (notes !== undefined) updateData.adjudicationNotes = notes;
    const res = await db.update(schema.insuranceClaims).set(updateData).where(eq(schema.insuranceClaims.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating claim status:', error);
    throw new Error('Failed to update claim adjudication status', { cause: error });
  }
}

// Public Health

export async function getPublicHealthReports(facilityId: number) {
  if (!Number.isSafeInteger(facilityId) || facilityId <= 0) {
    throw new Error('A valid facility ID is required for public-health reports.');
  }

  try {
    return await db
      .select()
      .from(schema.publicHealthReports)
      .where(eq(schema.publicHealthReports.facilityId, facilityId))
      .orderBy(desc(schema.publicHealthReports.reportedAt));
  } catch (error) {
    console.error('Error fetching public health reports:', error);
    throw new Error('Failed to fetch surveillance reports', { cause: error });
  }
}

export async function recordPublicHealthReport(
  data: typeof schema.publicHealthReports.$inferInsert,
) {
  try {
    const res = await db
      .insert(schema.publicHealthReports)
      .values(data)
      .returning();

    return res[0];
  } catch (error) {
    console.error('Error recording disease surveillance report:', error);
    throw new Error('Failed to record surveillance report', { cause: error });
  }
}

// Audit Logs
export async function logAuditEvent(tenantId: number | null, facilityId: number | null, userId: string | null, action: string, resource: string, resourceId: string | null, details: string) {
  try {
    await db.insert(schema.auditLogs).values({
      tenantId,
      facilityId,
      userId,
      action,
      resource,
      resourceId,
      details,
    });
  } catch (error) {
    console.error('Error writing audit log:', error);
  }
}

export async function getAuditLogs(
  context: AuthorizationContext,
  requestedFacilityId?: number,
) {
  try {
    const conditions = [];

    if (context.isSuperAdmin) {
      if (requestedFacilityId !== undefined) {
        conditions.push(
          eq(schema.auditLogs.facilityId, requestedFacilityId),
        );
      }
    } else if (context.facilityId !== null) {
      if (
        requestedFacilityId !== undefined &&
        requestedFacilityId !== context.facilityId
      ) {
        throw new Error(
          "You are not authorized to view another facility's audit logs.",
        );
      }

      conditions.push(
        eq(schema.auditLogs.facilityId, context.facilityId),
      );
    } else if (context.tenantId !== null) {
      conditions.push(
        eq(schema.auditLogs.tenantId, context.tenantId),
      );

      if (requestedFacilityId !== undefined) {
        conditions.push(
          eq(schema.auditLogs.facilityId, requestedFacilityId),
        );
      }
    } else {
      throw new Error("Audit log authorization scope is unavailable.");
    }

    if (conditions.length === 0) {
      return await db
        .select()
        .from(schema.auditLogs)
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(50);
    }

    return await db
      .select()
      .from(schema.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(50);
  } catch (error) {
    console.error("Error fetching scoped audit logs:", error);
    throw error;
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
export async function getPatientByIdScoped(
  context: AuthorizationContext,
  patientId: number,
) {
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new Error("Invalid patient ID.");
  }

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, patientId))
    .limit(1);

  if (!patient) return null;

  requireTenantScope(context, patient.tenantId);

  requireFacilityScope(
    context,
    patient.tenantId,
    patient.registrationFacilityId,
  );

  return patient;
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
      throw new Error(
        "Super Admin must specify a valid target tenant.",
      );
    }

    conditions.push(
      eq(schema.patients.tenantId, requestedTenantId),
    );

    if (requestedFacilityId !== undefined) {
      const facility = await getFacilityByIdScoped(
        context,
        requestedFacilityId,
      );

      if (!facility || facility.tenantId !== requestedTenantId) {
        throw new Error(
          "The facility does not belong to the requested tenant.",
        );
      }

      conditions.push(
        eq(
          schema.patients.registrationFacilityId,
          requestedFacilityId,
        ),
      );
    }
  } else {
    if (context.tenantId === null) {
      throw new Error("Your account has no tenant assignment.");
    }

    requireTenantScope(context, context.tenantId);

    if (
      requestedTenantId !== undefined &&
      requestedTenantId !== context.tenantId
    ) {
      requireTenantScope(context, requestedTenantId);
    }

    conditions.push(
      eq(schema.patients.tenantId, context.tenantId),
    );

    if (context.facilityId !== null) {
      if (
        requestedFacilityId !== undefined &&
        requestedFacilityId !== context.facilityId
      ) {
        throw new Error(
          "You are not authorized to access this facility.",
        );
      }

      conditions.push(
        eq(
          schema.patients.registrationFacilityId,
          context.facilityId,
        ),
      );
    } else if (requestedFacilityId !== undefined) {
      const facility = await getFacilityByIdScoped(
        context,
        requestedFacilityId,
      );

      if (!facility || facility.tenantId !== context.tenantId) {
        throw new Error(
          "The facility does not belong to your tenant.",
        );
      }

      conditions.push(
        eq(
          schema.patients.registrationFacilityId,
          requestedFacilityId,
        ),
      );
    }
  }

  if (search?.trim()) {
    const term = `%${search.trim()}%`;

    conditions.push(
      or(
        ilike(schema.patients.firstName, term),
        ilike(schema.patients.lastName, term),
        ilike(schema.patients.mrn, term),
        ilike(schema.patients.phone, term),
        ilike(schema.patients.nationalId, term),
        ilike(schema.patients.shaNumber, term),
      )!,
    );
  }

  return db
    .select()
    .from(schema.patients)
    .where(and(...conditions))
    .orderBy(desc(schema.patients.createdAt))
    .limit(50);
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
      ...safeData,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.patients.id, patientId),
        eq(schema.patients.tenantId, patient.tenantId),
        eq(
          schema.patients.registrationFacilityId,
          patient.registrationFacilityId,
        ),
      ),
    )
    .returning();

  return updated ?? null;
}



/**
 * Creates a laboratory batch and its queue entry atomically.
 * Duplicate test IDs within one request are rejected.
 */
export async function createLabOrderBatch(
  context: AuthorizationContext,
  data: {
    encounterId: number;
    patientId: number;
    investigations?: string[];
    testIds?: number[];
    clinicalIndication: string;
    specimenType: string;
    priority: string;
    clinicalNotes?: string;
    orderedBy?: string;
  },
) {
  const priority = data.priority;
  const allowedPriorities = ['Routine', 'Urgent', 'STAT'];

  if (!allowedPriorities.includes(priority)) {
    throw new Error('Invalid laboratory priority.');
  }
  if (!data.clinicalIndication?.trim()) {
    throw new Error('Clinical indication is required.');
  }
  if (!data.specimenType?.trim()) {
    throw new Error('Specimen type is required.');
  }
  if (
    data.clinicalIndication.length > 2000 ||
    data.specimenType.length > 120 ||
    (data.clinicalNotes?.length ?? 0) > 5000
  ) {
    throw new Error('Clinical text exceeds the permitted length.');
  }

  const freeTextProvided = data.investigations !== undefined;
  if (freeTextProvided && !Array.isArray(data.investigations)) {
    throw new Error('Invalid laboratory investigations.');
  }

  const investigations: string[] = [];
  if (freeTextProvided) {
    const seen = new Set<string>();
    for (const value of data.investigations!) {
      if (typeof value !== 'string') {
        throw new Error('Invalid laboratory investigation name.');
      }
      const name = value.trim();
      if (!name) continue;
      if (name.length > 200) {
        throw new Error('Each investigation name must be 200 characters or fewer.');
      }
      const key = name.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        investigations.push(name);
      }
    }
    if (investigations.length > 100) {
      throw new Error('Enter no more than 100 laboratory investigations.');
    }
  }

  const testIds = data.testIds ?? [];
  if (!freeTextProvided) {
    if (!Array.isArray(testIds) || testIds.length === 0) {
      throw new Error('Enter at least one laboratory investigation.');
    }
    if (testIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error('One or more laboratory test IDs are invalid.');
    }
    if (new Set(testIds).size !== testIds.length) {
      throw new Error('Duplicate tests are not allowed in one submission.');
    }
  } else if (investigations.length === 0) {
    throw new Error('Enter at least one laboratory investigation.');
  }

  const scope = await resolveQueueOrLabScope(context, {
    encounterId: data.encounterId,
    patientId: data.patientId,
  });

  try {
    return await db.transaction(async (tx) => {
      const tests: Array<{ id: number | null; name: string }> = [];

      if (freeTextProvided) {
        for (const name of investigations) {
          tests.push({ id: null, name });
        }
      } else {
        for (const testId of testIds) {
          const [test] = await tx
            .select()
            .from(schema.labTests)
            .where(and(
              eq(schema.labTests.id, testId),
              eq(schema.labTests.facilityId, scope.facilityId),
              eq(schema.labTests.isActive, true),
            ))
            .limit(1);

          if (!test) {
            throw new Error('A selected test is unavailable at this facility.');
          }
          tests.push({ id: test.id, name: test.name });
        }
      }

      const [queue] = await tx
        .insert(schema.queues)
        .values({
          ...scope,
          queueType: 'Laboratory',
          tokenNumber: `LAB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          priority,
          status: 'Waiting',
          waitingTimeMinutes: 0,
        })
        .returning();

      if (!queue) {
        throw new Error('Laboratory queue entry could not be created.');
      }

      const orders = [];
      for (const test of tests) {
        const [order] = await tx
          .insert(schema.labOrders)
          .values({
            ...scope,
            testId: test.id,
            testName: test.name,
            status: 'Ordered',
            orderedBy: data.orderedBy?.trim() || null,
            clinicalIndication: data.clinicalIndication.trim(),
            specimenType: data.specimenType.trim(),
            priority,
            clinicalNotes: data.clinicalNotes?.trim() || null,
          })
          .returning();

        if (!order) {
          throw new Error('A laboratory order could not be created.');
        }
        orders.push(order);
      }

      return { orders, queue };
    });
  } catch (error) {
    console.error('Laboratory batch transaction failed:', error);
    throw error;
  }
}
// ============================================================
// INPATIENT: TRANSFERS, BED-DAY ACCRUAL AND NURSING NOTES
// ============================================================

/**
 * Accrue one bed-day charge per calendar night of a stay segment.
 *
 * A "segment" runs from the admission date, or from the last transfer,
 * up to `untilDate`. Charge keys are BED_DAY:<admissionId>:<date>, so the
 * boundary day covered by two segments is still billed exactly once.
 *
 * Returns the per-night results so the caller can report what was billed.
 */
export async function accrueBedDaysScoped(
  context: AuthorizationContext,
  admissionId: number,
  untilDate?: string | null,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) {
    throw new InpatientDomainError(
      'ADMISSION_NOT_FOUND',
      'Admission not found.',
      404,
    );
  }

  const [ward] = await db
    .select({
      code: schema.wards.code,
      name: schema.wards.name,
    })
    .from(schema.wards)
    .where(eq(schema.wards.id, admission.wardId))
    .limit(1);

  const transfers = await db
    .select({ transferredAt: schema.admissionTransfers.transferredAt })
    .from(schema.admissionTransfers)
    .where(eq(schema.admissionTransfers.admissionId, admission.id))
    .orderBy(desc(schema.admissionTransfers.transferredAt))
    .limit(1);

  const segmentStart =
    transfers[0]?.transferredAt instanceof Date
      ? transfers[0].transferredAt.toISOString().slice(0, 10)
      : admission.admissionDate;

  const dates = bedDayDates(
    segmentStart,
    untilDate ?? admission.dischargeDate ?? null,
  );

  const results = [];

  for (const date of dates) {
    results.push(
      await chargeForService(db, {
        tenantId: admission.tenantId,
        facilityId: admission.facilityId,
        patientId: admission.patientId,
        encounterId: admission.encounterId ?? null,
        codes: bedDayTariffCodes(ward?.code),
        sourceType: 'BED_DAY',
        sourceId: admission.id,
        idempotencySuffix: date,
        itemType: 'Inpatient',
        description: `${ward?.name ?? 'Ward'} bed — ${date}`,
      }),
    );
  }

  return { nights: dates.length, charges: results };
}

/* Bed-night tariff code precedence lives in the billing module. */

export interface TransferAdmissionInput {
  toWardId: number;
  toBedId: number;
  reason?: string | null;
  transferredBy: string;
}

/**
 * Move an admitted patient to another ward/bed inside the facility.
 *
 * The old bed is released to Cleaning and the new bed occupied in the
 * same transaction, so the board can never show a patient in two beds.
 */
export async function transferAdmissionScoped(
  context: AuthorizationContext,
  admissionId: number,
  input: TransferAdmissionInput,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) {
    throw new InpatientDomainError(
      'ADMISSION_NOT_FOUND',
      'Admission not found.',
      404,
    );
  }

  if (admission.status !== 'Admitted') {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'Only an active admission can be transferred.',
      409,
    );
  }

  const toWardId = Number(input?.toWardId);
  const toBedId = Number(input?.toBedId);

  if (!Number.isSafeInteger(toWardId) || toWardId <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A valid destination ward is required.',
      400,
    );
  }

  if (!Number.isSafeInteger(toBedId) || toBedId <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A valid destination bed is required.',
      400,
    );
  }

  return await db.transaction(async (tx) => {
    const [ward] = await tx
      .select()
      .from(schema.wards)
      .where(
        and(
          eq(schema.wards.id, toWardId),
          eq(schema.wards.facilityId, admission.facilityId),
        ),
      )
      .limit(1);

    if (!ward) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Destination ward not found in this facility.',
        404,
      );
    }

    const [bed] = await tx
      .select()
      .from(schema.beds)
      .where(
        and(
          eq(schema.beds.id, toBedId),
          eq(schema.beds.wardId, ward.id),
        ),
      )
      .limit(1);

    if (!bed) {
      throw new InpatientDomainError(
        'BED_NOT_FOUND',
        'Destination bed not found in that ward.',
        404,
      );
    }

    const [activeOnBed] = await tx
      .select({ id: schema.admissions.id })
      .from(schema.admissions)
      .where(
        and(
          eq(schema.admissions.bedId, bed.id),
          eq(schema.admissions.status, 'Admitted'),
        ),
      )
      .limit(1);

    if (activeOnBed) {
      throw new InpatientDomainError(
        'BED_OCCUPIED',
        'The destination bed already has an active admission.',
        409,
      );
    }

    if (bed.status !== 'Available' && bed.status !== 'Cleaning') {
      throw new InpatientDomainError(
        'BED_NOT_AVAILABLE',
        `The destination bed is not available (current status: ${bed.status ?? 'unknown'}).`,
        409,
      );
    }

    if (bed.id === admission.bedId) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        'The patient is already in that bed.',
        400,
      );
    }

    const [transfer] = await tx
      .insert(schema.admissionTransfers)
      .values({
        tenantId: admission.tenantId,
        facilityId: admission.facilityId,
        admissionId: admission.id,
        patientId: admission.patientId,
        fromWardId: admission.wardId,
        fromBedId: admission.bedId,
        toWardId: ward.id,
        toBedId: bed.id,
        reason: typeof input.reason === 'string' ? input.reason.trim() : null,
        transferredBy: input.transferredBy,
        transferredByUserId: context.userId,
      })
      .returning();

    const [updated] = await tx
      .update(schema.admissions)
      .set({
        wardId: ward.id,
        bedId: bed.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.admissions.id, admission.id))
      .returning();

    /* Release the old bed only if it still holds this patient. */
    if (admission.bedId) {
      await tx
        .update(schema.beds)
        .set({
          status: 'Cleaning',
          currentPatientId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.beds.id, admission.bedId),
            eq(schema.beds.currentPatientId, admission.patientId),
          ),
        );
    }

    await tx
      .update(schema.beds)
      .set({
        status: 'Occupied',
        currentPatientId: admission.patientId,
        updatedAt: new Date(),
      })
      .where(eq(schema.beds.id, bed.id));

    return { transfer, admission: updated };
  });
}

export async function getAdmissionTransfersScoped(
  context: AuthorizationContext,
  admissionId: number,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) return [];

  return db
    .select()
    .from(schema.admissionTransfers)
    .where(eq(schema.admissionTransfers.admissionId, admission.id))
    .orderBy(desc(schema.admissionTransfers.transferredAt));
}

/* ------------------------------------------------------------
   NURSING NOTES
   ------------------------------------------------------------ */

const NURSING_NOTE_TYPES = new Set([
  'Progress',
  'Observation',
  'Handover',
  'Medication',
  'Incident',
]);

export interface CreateNursingNoteInput {
  admissionId?: number | null;
  patientId: number;
  encounterId?: number | null;
  noteType?: string;
  shift?: string | null;
  note: string;
  recordedBy: string;
}

export async function createNursingNoteScoped(
  context: AuthorizationContext,
  input: CreateNursingNoteInput,
) {
  const patientId = Number(input?.patientId);

  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A valid patient is required.',
      400,
    );
  }

  const note = typeof input?.note === 'string' ? input.note.trim() : '';

  if (!note) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A nursing note cannot be empty.',
      400,
    );
  }

  if (note.length > 8000) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A nursing note must be 8000 characters or fewer.',
      400,
    );
  }

  const noteType = NURSING_NOTE_TYPES.has(String(input.noteType))
    ? String(input.noteType)
    : 'Progress';

  let admissionId: number | null = null;
  let tenantId: number;
  let facilityId: number;

  if (input.admissionId !== undefined && input.admissionId !== null) {
    const admission = await getAdmissionByIdScoped(
      context,
      Number(input.admissionId),
    );

    if (!admission) {
      throw new InpatientDomainError(
        'ADMISSION_NOT_FOUND',
        'Admission not found.',
        404,
      );
    }

    if (admission.patientId !== patientId) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        'The patient does not match that admission.',
        400,
      );
    }

    admissionId = admission.id;
    tenantId = admission.tenantId;
    facilityId = admission.facilityId;
  } else {
    const patient = await requirePatientInTenant(
      context,
      patientId,
      context.tenantId ?? 0,
    );

    if (!patient) {
      throw new InpatientDomainError(
        'PATIENT_NOT_FOUND',
        'Patient not found in the authorised tenant.',
        404,
      );
    }

    const facility = await requireInpatientFacility(context);

    tenantId = facility.tenantId;
    facilityId = facility.id;
  }

  const [created] = await db
    .insert(schema.nursingNotes)
    .values({
      tenantId,
      facilityId,
      patientId,
      admissionId,
      encounterId:
        input.encounterId === undefined || input.encounterId === null
          ? null
          : Number(input.encounterId),
      noteType,
      shift:
        typeof input.shift === 'string' && input.shift.trim()
          ? input.shift.trim().slice(0, 20)
          : null,
      note,
      recordedBy:
        typeof input.recordedBy === 'string' && input.recordedBy.trim()
          ? input.recordedBy.trim().slice(0, 120)
          : 'Unknown',
      recordedByUserId: context.userId,
    })
    .returning();

  return created;
}

export async function getNursingNotesScoped(
  context: AuthorizationContext,
  filters: { admissionId?: number; patientId?: number },
) {
  const conditions = [];

  if (filters.admissionId !== undefined) {
    const admission = await getAdmissionByIdScoped(
      context,
      Number(filters.admissionId),
    );

    if (!admission) return [];

    conditions.push(
      eq(schema.nursingNotes.admissionId, admission.id),
    );
  }

  if (filters.patientId !== undefined) {
    const patientId = Number(filters.patientId);

    if (!Number.isSafeInteger(patientId) || patientId <= 0) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        'A valid patient ID is required.',
        400,
      );
    }

    await requirePatientInTenant(context, patientId, context.tenantId ?? 0);

    conditions.push(eq(schema.nursingNotes.patientId, patientId));
  }

  if (conditions.length === 0) {
    const facility = await requireInpatientFacility(context);

    conditions.push(eq(schema.nursingNotes.facilityId, facility.id));
  }

  return db
    .select()
    .from(schema.nursingNotes)
    .where(and(...conditions))
    .orderBy(desc(schema.nursingNotes.recordedAt))
    .limit(200);
}

/* ------------------------------------------------------------
   INVOICE LIFECYCLE
   ------------------------------------------------------------ */

export async function getInvoiceDetailScoped(
  context: AuthorizationContext,
  invoiceId: number,
) {
  const id = Number(invoiceId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A valid invoice ID is required.',
      400,
    );
  }

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, id))
    .limit(1);

  if (!invoice) return null;

  requireTenantScope(context, invoice.tenantId);
  requireFacilityScope(context, invoice.tenantId, invoice.facilityId);

  const items = await db
    .select()
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, invoice.id));

  const payments = await db
    .select()
    .from(schema.billingPayments)
    .where(eq(schema.billingPayments.invoiceId, invoice.id))
    .orderBy(desc(schema.billingPayments.createdAt));

  return { invoice, items, payments };
}

/**
 * Void an invoice.
 *
 * Voiding is additive: the invoice and its lines are retained for audit,
 * and `voided_at` removes it from open-invoice lookups so new charges
 * open a fresh bill. A voided invoice cannot be voided twice.
 */
export async function voidInvoiceScoped(
  context: AuthorizationContext,
  invoiceId: number,
  reason: string,
) {
  const detail = await getInvoiceDetailScoped(context, invoiceId);

  if (!detail) {
    throw new InpatientDomainError(
      'ADMISSION_NOT_FOUND',
      'Invoice not found.',
      404,
    );
  }

  if (detail.invoice.voidedAt) {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'This invoice has already been voided.',
      409,
    );
  }

  if (toCentsPositive(detail.invoice.paidAmount) > 0) {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'A paid invoice cannot be voided. Reverse the payment first.',
      409,
    );
  }

  const [updated] = await db
    .update(schema.billingInvoices)
    .set({
      status: 'Void',
      voidedAt: new Date(),
      voidReason: reason.trim().slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(schema.billingInvoices.id, detail.invoice.id))
    .returning();

  return updated;
}

function toCentsPositive(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

