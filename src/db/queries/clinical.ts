/**
 * JaliCare HMIS
 * Queries: Observations, diagnoses, procedures, and medications
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, or } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { ScopeAccessError } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { loadEncounterInScope, loadPatientInScope } from './shared.ts';

// Observations / Vitals
export async function getObservations(encounterId?: number, patientId?: number) {
  try {
    const query = db.select().from(schema.observations);
    const conditions = [];
    if (encounterId) conditions.push(eq(schema.observations.encounterId, encounterId));
    if (patientId) conditions.push(eq(schema.observations.patientId, patientId));

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.observations.recordedAt))
        .limit(20);
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
    const query = db.select().from(schema.diagnoses);
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

export async function getDiagnosesScoped(
  context: AuthorizationContext,
  input: { encounterId?: number; patientId?: number } = {},
) {
  const conditions = [];

  if (input.encounterId) {
    const encounter = await loadEncounterInScope(context, input.encounterId);

    conditions.push(eq(schema.diagnoses.encounterId, encounter.id));
  } else if (input.patientId) {
    const patient = await loadPatientInScope(context, input.patientId);

    conditions.push(eq(schema.diagnoses.patientId, patient.id));
  } else {
    /*
     * Refusing an unfiltered read is the point. Returning "everything"
     * would leak every facility's clinical record to any signed-in user.
     */
    throw new ScopeAccessError('Supply an encounterId or patientId.', 'SCOPE_FILTER_REQUIRED');
  }

  return db
    .select()
    .from(schema.diagnoses)
    .where(and(...conditions))
    .orderBy(desc(schema.diagnoses.diagnosedAt));
}

export async function recordDiagnosisScoped(
  context: AuthorizationContext,
  data: typeof schema.diagnoses.$inferInsert,
) {
  const encounter = await loadEncounterInScope(context, Number(data.encounterId));

  if (Number(data.patientId) !== encounter.patientId) {
    throw new ScopeAccessError(
      'The diagnosis patient does not match the encounter patient.',
      'PATIENT_ENCOUNTER_MISMATCH',
    );
  }

  const [created] = await db
    .insert(schema.diagnoses)
    .values({ ...data, encounterId: encounter.id, patientId: encounter.patientId })
    .returning();

  return created;
}

export async function getProceduresScoped(
  context: AuthorizationContext,
  input: { encounterId?: number; patientId?: number } = {},
) {
  const conditions = [];

  if (input.encounterId) {
    const encounter = await loadEncounterInScope(context, input.encounterId);

    conditions.push(eq(schema.clinicalProcedures.encounterId, encounter.id));
  } else if (input.patientId) {
    const patient = await loadPatientInScope(context, input.patientId);

    conditions.push(eq(schema.clinicalProcedures.patientId, patient.id));
  } else {
    throw new ScopeAccessError('Supply an encounterId or patientId.', 'SCOPE_FILTER_REQUIRED');
  }

  return db
    .select()
    .from(schema.clinicalProcedures)
    .where(and(...conditions))
    .orderBy(desc(schema.clinicalProcedures.id));
}

export async function recordProcedureScoped(
  context: AuthorizationContext,
  data: typeof schema.clinicalProcedures.$inferInsert,
) {
  const encounter = await loadEncounterInScope(context, Number(data.encounterId));

  if (Number(data.patientId) !== encounter.patientId) {
    throw new ScopeAccessError(
      'The procedure patient does not match the encounter patient.',
      'PATIENT_ENCOUNTER_MISMATCH',
    );
  }

  const [created] = await db
    .insert(schema.clinicalProcedures)
    .values({ ...data, encounterId: encounter.id, patientId: encounter.patientId })
    .returning();

  return created;
}

// Clinical Procedures
export async function getProcedures(encounterId?: number, patientId?: number) {
  try {
    const query = db.select().from(schema.clinicalProcedures);
    const conditions = [];
    if (encounterId) conditions.push(eq(schema.clinicalProcedures.encounterId, encounterId));
    if (patientId) conditions.push(eq(schema.clinicalProcedures.patientId, patientId));

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.clinicalProcedures.performedAt));
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
    const query = db.select().from(schema.medications);
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
    const res = await db
      .update(schema.medications)
      .set({ status })
      .where(eq(schema.medications.id, id))
      .returning();
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
