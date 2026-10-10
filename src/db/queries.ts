import { ScopeAccessError } from '../auth/scope.service.ts';
import { db } from './index.ts';
import * as schema from './schema.ts';
import { eq, desc, and, or, ilike, sql } from 'drizzle-orm';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import {
  requireTenantScope,
  requireFacilityScope,
} from '../auth/scope.service.ts';

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

export async function createQueueEntry(data: typeof schema.queues.$inferInsert) {
  try {
    const res = await db.insert(schema.queues).values(data).returning();
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

// Inpatient Wards & Beds
export async function getWards(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.wards).where(eq(schema.wards.facilityId, facilityId));
    }
    return await db.select().from(schema.wards);
  } catch (error) {
    console.error('Error fetching wards:', error);
    throw new Error('Failed to fetch wards', { cause: error });
  }
}

export async function getBeds(wardId?: number) {
  try {
    if (wardId) {
      return await db.select().from(schema.beds).where(eq(schema.beds.wardId, wardId));
    }
    return await db.select().from(schema.beds);
  } catch (error) {
    console.error('Error fetching beds:', error);
    throw new Error('Failed to fetch beds', { cause: error });
  }
}

export async function updateBedStatus(bedId: number, status: string, currentPatientId: number | null = null) {
  try {
    const res = await db.update(schema.beds).set({ status, currentPatientId }).where(eq(schema.beds.id, bedId)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating bed status:', error);
    throw new Error('Failed to update bed status', { cause: error });
  }
}

export async function getAdmissions(facilityId?: number, status?: string) {
  try {
    let query = db.select().from(schema.admissions);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.admissions.facilityId, facilityId));
    if (status) conditions.push(eq(schema.admissions.status, status));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.admissions.createdAt));
    }
    return await query.orderBy(desc(schema.admissions.createdAt));
  } catch (error) {
    console.error('Error fetching admissions:', error);
    throw new Error('Failed to fetch admissions', { cause: error });
  }
}

export async function createAdmission(data: typeof schema.admissions.$inferInsert) {
  try {
    const res = await db.insert(schema.admissions).values(data).returning();
    // mark bed as occupied
    await db.update(schema.beds).set({ status: 'Occupied', currentPatientId: data.patientId }).where(eq(schema.beds.id, data.bedId));
    return res[0];
  } catch (error) {
    console.error('Error admitting patient:', error);
    throw new Error('Failed to admit patient', { cause: error });
  }
}

export async function dischargeAdmission(id: number, bedId: number, dischargeDate: string, dischargeType: string, dischargeSummary: string) {
  try {
    const res = await db.update(schema.admissions).set({
      status: 'Discharged',
      dischargeDate,
      dischargeType,
      dischargeSummary
    }).where(eq(schema.admissions.id, id)).returning();

    // mark bed as available or cleaning
    await db.update(schema.beds).set({ status: 'Cleaning', currentPatientId: null }).where(eq(schema.beds.id, bedId));
    return res[0];
  } catch (error) {
    console.error('Error discharging patient:', error);
    throw new Error('Failed to discharge patient', { cause: error });
  }
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

export async function getLabOrders(facilityId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.labOrders);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.labOrders.facilityId, facilityId));
    if (patientId) conditions.push(eq(schema.labOrders.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.labOrders.orderedAt));
    }
    return await query.orderBy(desc(schema.labOrders.orderedAt));
  } catch (error) {
    console.error('Error fetching lab orders:', error);
    throw new Error('Failed to fetch lab orders', { cause: error });
  }
}

export async function createLabOrder(data: typeof schema.labOrders.$inferInsert) {
  try {
    const res = await db.insert(schema.labOrders).values(data).returning();
    return res[0];
  } catch (error) {
    console.error('Error creating lab order:', error);
    throw new Error('Failed to order lab test', { cause: error });
  }
}

export async function updateLabOrderStatus(id: number, status: string, accessionNumber?: string) {
  try {
    const updateData: any = { status };
    if (status === 'Sample Collected') {
      updateData.sampleCollectedAt = new Date();
      updateData.sampleAccessionNumber = accessionNumber || `ACC-${Date.now().toString().slice(-6)}`;
    }
    const res = await db.update(schema.labOrders).set(updateData).where(eq(schema.labOrders.id, id)).returning();
    return res[0];
  } catch (error) {
    console.error('Error updating lab order status:', error);
    throw new Error('Failed to update lab order status', { cause: error });
  }
}

export async function getLabResults(orderId?: number, patientId?: number) {
  try {
    let query = db.select().from(schema.labResults);
    const conditions = [];
    if (orderId) conditions.push(eq(schema.labResults.orderId, orderId));
    if (patientId) conditions.push(eq(schema.labResults.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.labResults.verifiedAt));
    }
    return await query.orderBy(desc(schema.labResults.verifiedAt));
  } catch (error) {
    console.error('Error fetching lab results:', error);
    throw new Error('Failed to fetch lab results', { cause: error });
  }
}

export async function addLabResult(data: typeof schema.labResults.$inferInsert) {
  try {
    const res = await db.insert(schema.labResults).values(data).returning();
    // mark order as published/verified
    await db.update(schema.labOrders).set({ status: 'Published' }).where(eq(schema.labOrders.id, data.orderId));
    return res[0];
  } catch (error) {
    console.error('Error adding lab result:', error);
    throw new Error('Failed to publish lab result', { cause: error });
  }
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

export async function createInvoice(invoiceData: typeof schema.billingInvoices.$inferInsert, items: Array<Omit<typeof schema.billingItems.$inferInsert, 'invoiceId'>>) {
  try {
    const res = await db.insert(schema.billingInvoices).values(invoiceData).returning();
    const invoice = res[0];

    if (items && items.length > 0) {
      const itemsToInsert = items.map(item => ({
        ...item,
        invoiceId: invoice.id,
      }));
      await db.insert(schema.billingItems).values(itemsToInsert);
    }

    return invoice;
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

export async function recordPayment(paymentData: typeof schema.billingPayments.$inferInsert) {
  try {
    const payment = await db.insert(schema.billingPayments).values(paymentData).returning();
    const invoiceId = paymentData.invoiceId;

    // Recalculate invoice paid & balance amounts
    const [inv] = await db.select().from(schema.billingInvoices).where(eq(schema.billingInvoices.id, invoiceId));
    if (inv) {
      const newPaid = Number(inv.paidAmount || 0) + Number(paymentData.amount);
      const newBalance = Math.max(0, Number(inv.totalAmount || 0) - newPaid);
      const newStatus = newBalance <= 0 ? 'Paid' : 'Partially Paid';

      await db.update(schema.billingInvoices).set({
        paidAmount: newPaid.toFixed(2),
        balanceAmount: newBalance.toFixed(2),
        status: newStatus,
      }).where(eq(schema.billingInvoices.id, invoiceId));
    }

    return payment[0];
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
export async function getPublicHealthReports(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.publicHealthReports).where(eq(schema.publicHealthReports.facilityId, facilityId)).orderBy(desc(schema.publicHealthReports.reportedAt));
    }
    return await db.select().from(schema.publicHealthReports).orderBy(desc(schema.publicHealthReports.reportedAt));
  } catch (error) {
    console.error('Error fetching public health reports:', error);
    throw new Error('Failed to fetch surveillance reports', { cause: error });
  }
}

export async function recordPublicHealthReport(data: typeof schema.publicHealthReports.$inferInsert) {
  try {
    const res = await db.insert(schema.publicHealthReports).values(data).returning();
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

export async function getAuditLogs(facilityId?: number) {
  try {
    if (facilityId) {
      return await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.facilityId, facilityId)).orderBy(desc(schema.auditLogs.timestamp)).limit(50);
    }
    return await db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.timestamp)).limit(50);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw new Error('Failed to fetch audit logs', { cause: error });
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

