/**
 * JaliCare HMIS
 * Queries: Observations, diagnoses, procedures, and medications
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { MedicationWorkflowError } from '../../clinical/medication-workflow-contracts.ts';
import {
  normalizeNewDiagnosisCoding,
  presentPersistedDiagnosis,
} from '../../clinical/icd11/icd11.service.ts';

import { loadEncounterInScope, loadPatientInScope } from './shared.ts';
import { getFacilityByIdScoped } from './tenancy.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.clinical');

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
    log.error({ err: error }, 'vitals.fetch_failed');
    throw new Error('Failed to fetch vital observations', { cause: error });
  }
}

export async function recordObservation(data: typeof schema.observations.$inferInsert) {
  try {
    const res = await db.insert(schema.observations).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'observation.record_failed');
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
    log.error({ err: error }, 'diagnoses.fetch_failed');
    throw new Error('Failed to fetch diagnoses', { cause: error });
  }
}

export async function recordDiagnosis(data: typeof schema.diagnoses.$inferInsert) {
  try {
    const res = await db.insert(schema.diagnoses).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'diagnosis.record_failed');
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
    // A patient seen at two facilities does not make all of their other
    // facility's encounter diagnoses visible to a facility-scoped caller.
    if (context.facilityId !== null) {
      conditions.push(
        inArray(
          schema.diagnoses.encounterId,
          db
            .select({ id: schema.encounters.id })
            .from(schema.encounters)
            .where(
              and(
                eq(schema.encounters.facilityId, context.facilityId),
                eq(schema.encounters.tenantId, patient.tenantId),
              ),
            ),
        ),
      );
    }
  } else {
    /*
     * Refusing an unfiltered read is the point. Returning "everything"
     * would leak every facility's clinical record to any signed-in user.
     */
    throw new ScopeAccessError('Supply an encounterId or patientId.', 'SCOPE_FILTER_REQUIRED');
  }

  const rows = await db
    .select()
    .from(schema.diagnoses)
    .where(and(...conditions))
    .orderBy(desc(schema.diagnoses.diagnosedAt));

  return rows.map((row) => ({
    ...row,
    resolvedCoding: presentPersistedDiagnosis(row),
  }));
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

  const normalizedCoding = await normalizeNewDiagnosisCoding({
    codingSystem: data.codingSystem,
    icd11Code: data.icd11Code,
    icd11Release: data.icd11Release,
    icd10Code: data.icd10Code,
    icd10Description: data.icd10Description,
  });

  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, context.userId))
      .limit(1);
    const [created] = await tx
      .insert(schema.diagnoses)
      .values({
        encounterId: encounter.id,
        patientId: encounter.patientId,
        diagnosisType:
          typeof data.diagnosisType === 'string' ? data.diagnosisType.slice(0, 80) : 'Primary',
        status: typeof data.status === 'string' ? data.status.slice(0, 80) : 'Confirmed',
        notes: typeof data.notes === 'string' ? data.notes.slice(0, 2000) : null,
        diagnosedBy: actor?.fullName ?? `User ${context.userId}`,
        codingSystem: normalizedCoding.codingSystem,
        diagnosisCode: normalizedCoding.diagnosisCode,
        diagnosisDisplay: normalizedCoding.diagnosisDisplay,
        icd10Code: normalizedCoding.icd10Code,
        icd10Description: normalizedCoding.icd10Description,
        icd11Code: normalizedCoding.icd11Code,
        icd11Title: normalizedCoding.icd11Title,
        icd11Release: normalizedCoding.icd11Release,
        icd11FoundationUri: normalizedCoding.icd11FoundationUri,
        icd11LinearizationUri: normalizedCoding.icd11LinearizationUri,
        codingMetadata: normalizedCoding.codingMetadata,
      })
      .returning();

    await tx.insert(schema.auditLogs).values({
      tenantId: encounter.tenantId,
      facilityId: encounter.facilityId,
      userId: String(context.userId),
      action: 'CREATE',
      resource: 'diagnosis',
      resourceId: String(created.id),
      // Deliberately exclude clinical text and patient identifiers.
      details: JSON.stringify({
        codingSystem: created.codingSystem,
        release: created.icd11Release,
      }),
    });

    return { ...created, resolvedCoding: presentPersistedDiagnosis(created) };
  });
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
    log.error({ err: error }, 'procedures.fetch_failed');
    throw new Error('Failed to fetch clinical procedures', { cause: error });
  }
}

export async function recordProcedure(data: typeof schema.clinicalProcedures.$inferInsert) {
  try {
    const res = await db.insert(schema.clinicalProcedures).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'procedure.record_failed');
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
    log.error({ err: error }, 'medications.fetch_failed');
    throw new Error('Failed to fetch prescriptions', { cause: error });
  }
}

/** Facility-scoped worklist. Medication ownership follows the encounter,
 * including older records which have no facility column of their own. */
export async function getMedicationsScoped(
  context: AuthorizationContext,
  input: { encounterId?: number; patientId?: number; facilityId?: number } = {},
) {
  const facilityId = resolveFacilityScope(context, input.facilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  for (const id of [input.encounterId, input.patientId]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
      throw new ScopeAccessError('Invalid clinical record filter.', 'INVALID_SCOPE_ID');
  }
  const rows = await db
    .select({
      medication: schema.medications,
      quantityDispensed: sql<number>`COALESCE((SELECT SUM(d.quantity_dispensed) FROM pharmacy_dispensations d WHERE d.prescription_id = ${schema.medications.id}), 0)::int`,
    })
    .from(schema.medications)
    .innerJoin(
      schema.encounters,
      and(
        eq(schema.medications.encounterId, schema.encounters.id),
        eq(schema.medications.patientId, schema.encounters.patientId),
      ),
    )
    .where(
      and(
        eq(schema.encounters.tenantId, facility.tenantId),
        eq(schema.encounters.facilityId, facility.id),
        ...(input.encounterId !== undefined ? [eq(schema.encounters.id, input.encounterId)] : []),
        ...(input.patientId !== undefined
          ? [eq(schema.encounters.patientId, input.patientId)]
          : []),
      ),
    )
    .orderBy(desc(schema.medications.prescribedAt));
  return rows.map((row) => ({ ...row.medication, quantityDispensed: row.quantityDispensed }));
}

/** A prescription cannot be attached to another facility's encounter or patient. */
export async function createMedicationScoped(
  context: AuthorizationContext,
  data: typeof schema.medications.$inferInsert,
) {
  const encounter = await loadEncounterInScope(context, Number(data.encounterId));
  if (encounter.patientId !== Number(data.patientId))
    throw new ScopeAccessError(
      'The patient does not match the encounter.',
      'PATIENT_ENCOUNTER_MISMATCH',
    );
  const [created] = await db
    .insert(schema.medications)
    .values({ ...data, encounterId: encounter.id, patientId: encounter.patientId })
    .returning();
  return created;
}

export async function createMedication(data: typeof schema.medications.$inferInsert) {
  try {
    const res = await db.insert(schema.medications).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'medication.prescribe_failed');
    throw new Error('Failed to prescribe medication', { cause: error });
  }
}

/** Clinician-directed changes do not dispense, administer or reverse medication. */
export async function updateMedicationStatusScoped(
  context: AuthorizationContext,
  id: number,
  action: string,
  reason: string,
) {
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !['On Hold', 'Resume', 'Cancelled', 'Discontinued'].includes(action)
  ) {
    throw new MedicationWorkflowError(
      'MEDICATION_STATUS_WORKFLOW_REQUIRED',
      'Use the appropriate clinical or dispensing workflow.',
      409,
    );
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) {
    throw new MedicationWorkflowError(
      'MEDICATION_REASON_REQUIRED',
      'A reason is required for a medication status change.',
      400,
    );
  }
  const [found] = await db
    .select()
    .from(schema.medications)
    .where(eq(schema.medications.id, id))
    .limit(1);
  if (!found)
    throw new MedicationWorkflowError('MEDICATION_NOT_FOUND', 'Medication not found.', 404);
  const encounter = await loadEncounterInScope(context, found.encounterId);
  if (encounter.patientId !== found.patientId) {
    throw new MedicationWorkflowError(
      'MEDICATION_REVIEW_REQUIRED',
      'Medication and encounter require review.',
      409,
    );
  }
  return db.transaction(async (tx) => {
    const [med] = await tx
      .select()
      .from(schema.medications)
      .where(eq(schema.medications.id, id))
      .limit(1)
      .for('update');
    if (!med || med.encounterId !== encounter.id || med.patientId !== encounter.patientId) {
      throw new MedicationWorkflowError('MEDICATION_NOT_FOUND', 'Medication not found.', 404);
    }
    const rows = await tx
      .select({
        patientId: schema.pharmacyDispensations.patientId,
        tenantId: schema.pharmacyDispensations.tenantId,
        facilityId: schema.pharmacyDispensations.facilityId,
        quantity: schema.pharmacyDispensations.quantityDispensed,
      })
      .from(schema.pharmacyDispensations)
      .where(eq(schema.pharmacyDispensations.prescriptionId, id));
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (
      !med.quantity ||
      med.quantity <= 0 ||
      !Number.isSafeInteger(total) ||
      total > med.quantity ||
      rows.some(
        (r) =>
          r.patientId !== med.patientId ||
          r.tenantId !== encounter.tenantId ||
          r.facilityId !== encounter.facilityId ||
          !Number.isSafeInteger(r.quantity) ||
          r.quantity <= 0,
      )
    ) {
      throw new MedicationWorkflowError(
        'MEDICATION_REVIEW_REQUIRED',
        'Prescription and dispensing history require reconciliation.',
        409,
      );
    }
    const consistentActive =
      (med.status === 'Prescribed' && total === 0) ||
      (med.status === 'Partially Dispensed' && total > 0 && total < med.quantity);
    const held = med.status === 'On Hold' && total < med.quantity;
    if (med.status === action && (held || ['Cancelled', 'Discontinued'].includes(action)))
      return med;
    if (action === 'Resume' && consistentActive) return med;
    let target: string | null = null;
    if (action === 'On Hold' && consistentActive) target = 'On Hold';
    if (action === 'Resume' && held) target = total === 0 ? 'Prescribed' : 'Partially Dispensed';
    if (action === 'Cancelled' && (consistentActive || held) && total === 0) target = 'Cancelled';
    if (action === 'Discontinued' && (consistentActive || held)) target = 'Discontinued';
    if (!target)
      throw new MedicationWorkflowError(
        'MEDICATION_STATE_CONFLICT',
        'This status change is not valid for the current prescription and dispensing history.',
        409,
      );
    const [updated] = await tx
      .update(schema.medications)
      .set({ status: target })
      .where(eq(schema.medications.id, id))
      .returning();
    await tx.insert(schema.medicationStatusEvents).values({
      tenantId: encounter.tenantId,
      facilityId: encounter.facilityId,
      medicationId: id,
      fromStatus: med.status!,
      toStatus: target,
      reason: reason.trim(),
      actorUserId: context.userId,
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: encounter.tenantId,
      facilityId: encounter.facilityId,
      userId: String(context.userId),
      action: 'UPDATE',
      resource: 'Medication',
      resourceId: String(id),
      details: `Prescription status changed from ${med.status} to ${target}.`,
    });
    return updated;
  });
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
    log.error({ err: error }, 'medication_status.update_failed');
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
