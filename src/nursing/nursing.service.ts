/**
 * JaliCare HMIS
 * Nursing & Bedside Care service
 *
 * Handles ward vitals, nursing notes, shift handover and the inpatient
 * board that the ward screen and the dashboard both read from.
 *
 * SCOPING
 * -------
 * Every function takes the authenticated AuthorizationContext. Nothing
 * in this module trusts a client-supplied facility, tenant or patient.
 * Observations are reached through the admission's patient, never by
 * patient ID alone, because `observations` carries no facility column.
 */

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';

import {
  assessVitals,
  currentShift,
  dateKey,
  shiftForHour,
  SHIFT_NAMES,
  VITALS_OVERDUE_HOURS,
  type ShiftName,
  type VitalFlag,
  type VitalSeverity,
} from './nursing-contracts.ts';

export {
  assessVitals,
  currentShift,
  dateKey,
  shiftForHour,
  SHIFT_NAMES,
  VITALS_OVERDUE_HOURS,
  VITALS_REFERENCE,
  type ShiftName,
  type VitalFlag,
  type VitalSeverity,
} from './nursing-contracts.ts';

import {
  getAdmissionsScoped,
  getAdmissionByIdScoped,
  getBedsScoped,
  getFacilityByIdScoped,
  getWardsScoped,
  requirePatientInTenant,
  InpatientDomainError,
} from '../db/queries.ts';

/* ============================================================
   ENCOUNTER RESOLUTION
   ============================================================ */

/**
 * Return the encounter that ward vitals should attach to.
 *
 * `observations.encounterId` is NOT NULL, but an admission created from
 * the ward UI may have no encounter because `admissions.encounterId` is
 * optional. Rather than failing the nurse's vitals entry, we resolve the
 * admission's encounter, or reuse the patient's active inpatient
 * encounter, and only create one as a last resort.
 *
 * A created encounter uses encounterType INPATIENT, which the billing
 * engine deliberately excludes from consultation charges.
 */
async function resolveVitalsEncounter(
  context: AuthorizationContext,
  admission: typeof schema.admissions.$inferSelect,
): Promise<number> {
  if (admission.encounterId) {
    return admission.encounterId;
  }

  const [active] = await db
    .select({ id: schema.encounters.id })
    .from(schema.encounters)
    .where(
      and(
        eq(schema.encounters.patientId, admission.patientId),
        eq(schema.encounters.facilityId, admission.facilityId),
        eq(schema.encounters.encounterType, 'INPATIENT'),
        eq(schema.encounters.status, 'ACTIVE'),
      ),
    )
    .orderBy(desc(schema.encounters.id))
    .limit(1);

  if (active) {
    /* Link the admission so the next request resolves immediately. */
    await db
      .update(schema.admissions)
      .set({ encounterId: active.id, updatedAt: new Date() })
      .where(eq(schema.admissions.id, admission.id));

    return active.id;
  }

  const [created] = await db
    .insert(schema.encounters)
    .values({
      tenantId: admission.tenantId,
      facilityId: admission.facilityId,
      patientId: admission.patientId,
      encounterType: 'INPATIENT',
      status: 'ACTIVE',
      chiefComplaint: admission.provisionalDiagnosis ?? null,
    })
    .returning({ id: schema.encounters.id });

  if (!created) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Unable to open an inpatient encounter for these vitals.',
      500,
    );
  }

  await db
    .update(schema.admissions)
    .set({ encounterId: created.id, updatedAt: new Date() })
    .where(eq(schema.admissions.id, admission.id));

  return created.id;
}

/* ============================================================
   VITALS — READ AND WRITE
   ============================================================ */

export interface RecordVitalsInput {
  admissionId: number;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  pulseRate?: number | null;
  temperatureC?: string | number | null;
  respiratoryRate?: number | null;
  spo2Percent?: number | null;
  weightKg?: string | number | null;
  heightCm?: string | number | null;
  bloodGlucoseMmol?: string | number | null;
  recordedBy?: string | null;
}

const OBSERVATION_COLUMNS = {
  id: schema.observations.id,
  encounterId: schema.observations.encounterId,
  patientId: schema.observations.patientId,
  systolicBp: schema.observations.systolicBp,
  diastolicBp: schema.observations.diastolicBp,
  pulseRate: schema.observations.pulseRate,
  temperatureC: schema.observations.temperatureC,
  respiratoryRate: schema.observations.respiratoryRate,
  spo2Percent: schema.observations.spo2Percent,
  weightKg: schema.observations.weightKg,
  heightCm: schema.observations.heightCm,
  bmi: schema.observations.bmi,
  bloodGlucoseMmol: schema.observations.bloodGlucoseMmol,
  recordedBy: schema.observations.recordedBy,
  recordedAt: schema.observations.recordedAt,
};

function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} must be a whole number between ${min} and ${max}.`,
      400,
    );
  }

  return parsed;
}

function optionalDecimal(
  value: unknown,
  field: string,
  min: number,
  max: number,
  decimals = 1,
): string | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} must be between ${min} and ${max}.`,
      400,
    );
  }

  return parsed.toFixed(decimals);
}

export async function recordVitalsScoped(context: AuthorizationContext, input: RecordVitalsInput) {
  const admission = await getAdmissionByIdScoped(context, Number(input?.admissionId));

  if (!admission) {
    throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
  }

  if (admission.status !== 'Admitted') {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'Vitals can only be recorded for an active admission.',
      409,
    );
  }

  const systolicBp = optionalInt(input.systolicBp, 'Systolic BP', 40, 300);
  const diastolicBp = optionalInt(input.diastolicBp, 'Diastolic BP', 20, 200);
  const pulseRate = optionalInt(input.pulseRate, 'Pulse rate', 20, 250);
  const respiratoryRate = optionalInt(input.respiratoryRate, 'Respiratory rate', 4, 80);
  const spo2Percent = optionalInt(input.spo2Percent, 'SpO2', 40, 100);

  const temperatureC = optionalDecimal(input.temperatureC, 'Temperature', 30, 45);
  const weightKg = optionalDecimal(input.weightKg, 'Weight', 0.5, 400);
  const heightCm = optionalDecimal(input.heightCm, 'Height', 20, 260);
  const bloodGlucoseMmol = optionalDecimal(input.bloodGlucoseMmol, 'Blood glucose', 0.5, 50);

  /*
   * Reject an entirely empty observation. A "vitals" row with no values
   * is clinical noise, and the project rules forbid inventing values.
   */
  const hasAnyValue = [
    systolicBp,
    diastolicBp,
    pulseRate,
    respiratoryRate,
    spo2Percent,
    temperatureC,
    weightKg,
    heightCm,
    bloodGlucoseMmol,
  ].some((value) => value !== null);

  if (!hasAnyValue) {
    throw new InpatientDomainError('INVALID_INPUT', 'Record at least one observation.', 400);
  }

  if (systolicBp !== null && diastolicBp !== null && systolicBp <= diastolicBp) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Systolic pressure must be higher than diastolic pressure.',
      400,
    );
  }

  /* BMI only when both weight and height were supplied. */
  let bmi: string | null = null;

  if (weightKg !== null && heightCm !== null) {
    const metres = Number(heightCm) / 100;
    const computed = Number(weightKg) / (metres * metres);

    if (Number.isFinite(computed) && computed > 0 && computed < 200) {
      bmi = computed.toFixed(1);
    }
  }

  const encounterId = await resolveVitalsEncounter(context, admission);

  const [created] = await db
    .insert(schema.observations)
    .values({
      encounterId,
      patientId: admission.patientId,
      systolicBp,
      diastolicBp,
      pulseRate,
      temperatureC,
      respiratoryRate,
      spo2Percent,
      weightKg,
      heightCm,
      bmi,
      bloodGlucoseMmol,
      recordedBy:
        typeof input.recordedBy === 'string' && input.recordedBy.trim()
          ? input.recordedBy.trim().slice(0, 120)
          : null,
    })
    .returning(OBSERVATION_COLUMNS);

  return {
    ...created,
    flags: assessVitals(created),
  };
}

/**
 * Record vitals against an outpatient/triage encounter.
 *
 * Kept separate from `recordVitalsScoped` because triage happens before
 * any admission exists. The encounter is resolved first and its facility
 * checked against the caller's scope, so a forged encounter ID cannot be
 * used to write into another tenant's patient record.
 */
export async function recordObservationForEncounterScoped(
  context: AuthorizationContext,
  input: RecordVitalsInput & { encounterId: number; patientId?: number },
) {
  const encounterId = Number(input.encounterId);

  if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid encounter ID is required.', 400);
  }

  const [encounter] = await db
    .select({
      id: schema.encounters.id,
      facilityId: schema.encounters.facilityId,
      patientId: schema.encounters.patientId,
      tenantId: schema.encounters.tenantId,
      status: schema.encounters.status,
    })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);

  if (!encounter) {
    throw new InpatientDomainError('ENCOUNTER_NOT_FOUND', 'Encounter not found.', 404);
  }

  const facility = await getFacilityByIdScoped(context, encounter.facilityId);

  if (!facility) {
    throw new InpatientDomainError(
      'ENCOUNTER_NOT_FOUND',
      'Encounter not found in the authorised facility.',
      404,
    );
  }

  if (input.patientId !== undefined && Number(input.patientId) !== encounter.patientId) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'The patient does not match that encounter.',
      400,
    );
  }

  const systolicBp = optionalInt(input.systolicBp, 'Systolic BP', 40, 300);
  const diastolicBp = optionalInt(input.diastolicBp, 'Diastolic BP', 20, 200);
  const pulseRate = optionalInt(input.pulseRate, 'Pulse rate', 20, 250);
  const respiratoryRate = optionalInt(input.respiratoryRate, 'Respiratory rate', 4, 80);
  const spo2Percent = optionalInt(input.spo2Percent, 'SpO2', 40, 100);
  const temperatureC = optionalDecimal(input.temperatureC, 'Temperature', 30, 45);
  const weightKg = optionalDecimal(input.weightKg, 'Weight', 0.5, 400);
  const heightCm = optionalDecimal(input.heightCm, 'Height', 20, 260);
  const bloodGlucoseMmol = optionalDecimal(input.bloodGlucoseMmol, 'Blood glucose', 0.5, 50);

  const hasAnyValue = [
    systolicBp,
    diastolicBp,
    pulseRate,
    respiratoryRate,
    spo2Percent,
    temperatureC,
    weightKg,
    heightCm,
    bloodGlucoseMmol,
  ].some((value) => value !== null);

  if (!hasAnyValue) {
    throw new InpatientDomainError('INVALID_INPUT', 'Record at least one observation.', 400);
  }

  if (systolicBp !== null && diastolicBp !== null && systolicBp <= diastolicBp) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Systolic pressure must be higher than diastolic pressure.',
      400,
    );
  }

  /* BMI is derived server-side; a client-supplied value is ignored. */
  let bmi: string | null = null;

  if (weightKg !== null && heightCm !== null) {
    const metres = Number(heightCm) / 100;
    const computed = Number(weightKg) / (metres * metres);

    if (Number.isFinite(computed) && computed > 0 && computed < 200) {
      bmi = computed.toFixed(1);
    }
  }

  const [created] = await db
    .insert(schema.observations)
    .values({
      encounterId: encounter.id,
      patientId: encounter.patientId,
      systolicBp,
      diastolicBp,
      pulseRate,
      temperatureC,
      respiratoryRate,
      spo2Percent,
      weightKg,
      heightCm,
      bmi,
      bloodGlucoseMmol,
      recordedBy:
        typeof input.recordedBy === 'string' && input.recordedBy.trim()
          ? input.recordedBy.trim().slice(0, 120)
          : null,
    })
    .returning(OBSERVATION_COLUMNS);

  return {
    ...created,
    flags: assessVitals(created),
  };
}

export async function getVitalsForAdmissionScoped(
  context: AuthorizationContext,
  admissionId: number,
  limit = 20,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) return [];

  return db
    .select(OBSERVATION_COLUMNS)
    .from(schema.observations)
    .where(eq(schema.observations.patientId, admission.patientId))
    .orderBy(desc(schema.observations.recordedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

/**
 * Scoped replacement for the unscoped `getObservations`.
 *
 * The old implementation returned the newest 20 observations across
 * every tenant when called without filters.
 */
export async function getObservationsScoped(
  context: AuthorizationContext,
  filters: { patientId?: number; encounterId?: number },
) {
  if (filters.patientId !== undefined) {
    const patientId = Number(filters.patientId);

    if (!Number.isSafeInteger(patientId) || patientId <= 0) {
      throw new InpatientDomainError('INVALID_INPUT', 'A valid patient ID is required.', 400);
    }

    await requirePatientInTenant(context, patientId, context.tenantId ?? 0);

    return db
      .select(OBSERVATION_COLUMNS)
      .from(schema.observations)
      .where(eq(schema.observations.patientId, patientId))
      .orderBy(desc(schema.observations.recordedAt))
      .limit(50);
  }

  if (filters.encounterId !== undefined) {
    const encounterId = Number(filters.encounterId);

    if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
      throw new InpatientDomainError('INVALID_INPUT', 'A valid encounter ID is required.', 400);
    }

    const [encounter] = await db
      .select({
        id: schema.encounters.id,
        facilityId: schema.encounters.facilityId,
        patientId: schema.encounters.patientId,
      })
      .from(schema.encounters)
      .where(eq(schema.encounters.id, encounterId))
      .limit(1);

    if (!encounter) {
      throw new InpatientDomainError('ENCOUNTER_NOT_FOUND', 'Encounter not found.', 404);
    }

    const facility = await getFacilityByIdScoped(context, encounter.facilityId);

    if (!facility) {
      throw new InpatientDomainError(
        'ENCOUNTER_NOT_FOUND',
        'Encounter not found in the authorised facility.',
        404,
      );
    }

    return db
      .select(OBSERVATION_COLUMNS)
      .from(schema.observations)
      .where(eq(schema.observations.encounterId, encounterId))
      .orderBy(desc(schema.observations.recordedAt))
      .limit(50);
  }

  /*
   * No filter: return the latest observations for patients currently
   * admitted at the user's facility. Never a cross-tenant listing.
   */
  const admissions = await getAdmissionsScoped(context, undefined, 'Admitted');
  const patientIds = [...new Set(admissions.map((row) => row.patientId))];

  if (patientIds.length === 0) return [];

  return db
    .select(OBSERVATION_COLUMNS)
    .from(schema.observations)
    .where(inArray(schema.observations.patientId, patientIds))
    .orderBy(desc(schema.observations.recordedAt))
    .limit(50);
}

/* ============================================================
   INPATIENT BOARD
   ============================================================ */

export interface InpatientBoardRow {
  admissionId: number;
  patientId: number;
  patientName: string;
  patientMrn: string | null;
  wardId: number;
  wardName: string;
  bedId: number;
  bedNumber: string;
  admissionDate: string;
  admissionType: string | null;
  admittingDoctor: string | null;
  provisionalDiagnosis: string | null;
  lastVitalsAt: string | null;
  lastVitalsFlags: VitalFlag[];
  vitalsOverdue: boolean;
  hoursSinceVitals: number | null;
  notesToday: number;
  lastNoteAt: string | null;
  lastNoteShift: string | null;
}

export interface InpatientBoardSummary {
  facilityId: number;
  generatedAt: string;
  shift: ShiftName;
  wardCount: number;
  bedCount: number;
  occupiedBeds: number;
  availableBeds: number;
  cleaningBeds: number;
  occupancyRate: number;
  admissionCount: number;
  vitalsOverdueCount: number;
  criticalVitalsCount: number;
  notesTodayCount: number;
  rows: InpatientBoardRow[];
}

/**
 * Everything the ward board and the dashboard need, in one scoped call.
 *
 * Built to avoid an N+1: one query for admissions, one for wards, one
 * for beds, one for observations and one for notes; the mapping happens
 * in memory.
 */
export async function getInpatientBoardScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
): Promise<InpatientBoardSummary> {
  const admissions = await getAdmissionsScoped(context, requestedFacilityId, 'Admitted');

  const wards = await getWardsScoped(context, requestedFacilityId);
  const beds = await getBedsScoped(context);

  const facilityId = admissions[0]?.facilityId ?? wards[0]?.facilityId ?? 0;

  const wardNameById = new Map(wards.map((ward) => [ward.id, ward.name]));
  const bedById = new Map(beds.map((bed) => [bed.id, bed]));

  const patientIds = admissions.map((row) => row.patientId);

  /* Patient identities for the board — one query, no per-row lookups. */
  const patientById = new Map<number, { name: string; mrn: string | null }>();

  if (patientIds.length > 0) {
    const rows = await db
      .select({
        id: schema.patients.id,
        firstName: schema.patients.firstName,
        middleName: schema.patients.middleName,
        lastName: schema.patients.lastName,
        mrn: schema.patients.mrn,
      })
      .from(schema.patients)
      .where(inArray(schema.patients.id, patientIds));

    for (const row of rows) {
      const name = [row.firstName, row.middleName, row.lastName]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ');

      patientById.set(row.id, { name, mrn: row.mrn ?? null });
    }
  }

  /* Vitals: latest per patient, within the facility's admitted set. */
  const latestVitalsByPatient = new Map<number, (typeof schema.observations.$inferSelect)[]>();

  if (patientIds.length > 0) {
    const observations = await db
      .select(OBSERVATION_COLUMNS)
      .from(schema.observations)
      .where(inArray(schema.observations.patientId, patientIds))
      .orderBy(desc(schema.observations.recordedAt))
      .limit(500);

    for (const observation of observations) {
      const existing = latestVitalsByPatient.get(observation.patientId);

      if (!existing) {
        latestVitalsByPatient.set(observation.patientId, [observation]);
      } else if (existing.length < 3) {
        existing.push(observation);
      }
    }
  }

  /* Notes: everything recorded since local midnight. */
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const notes = facilityId
    ? await db
        .select({
          id: schema.nursingNotes.id,
          patientId: schema.nursingNotes.patientId,
          admissionId: schema.nursingNotes.admissionId,
          shift: schema.nursingNotes.shift,
          recordedAt: schema.nursingNotes.recordedAt,
        })
        .from(schema.nursingNotes)
        .where(
          and(
            eq(schema.nursingNotes.facilityId, facilityId),
            gte(schema.nursingNotes.recordedAt, startOfDay),
            lte(schema.nursingNotes.recordedAt, endOfDay),
          ),
        )
        .orderBy(desc(schema.nursingNotes.recordedAt))
    : [];

  const notesByAdmission = new Map<
    number,
    { count: number; lastAt: Date | null; lastShift: string | null }
  >();

  for (const note of notes) {
    if (note.admissionId === null) continue;

    const existing = notesByAdmission.get(note.admissionId) ?? {
      count: 0,
      lastAt: null,
      lastShift: null,
    };

    existing.count += 1;

    if (!existing.lastAt || note.recordedAt > existing.lastAt) {
      existing.lastAt = note.recordedAt;
      existing.lastShift = note.shift;
    }

    notesByAdmission.set(note.admissionId, existing);
  }

  const now = Date.now();

  const rows: InpatientBoardRow[] = admissions.map((admission) => {
    const vitals = latestVitalsByPatient.get(admission.patientId) ?? [];
    const latest = vitals[0] ?? null;

    const lastVitalsAt = latest?.recordedAt ?? null;
    const hoursSinceVitals = lastVitalsAt
      ? (now - new Date(lastVitalsAt).getTime()) / 3_600_000
      : null;

    const noteInfo = notesByAdmission.get(admission.id);

    return {
      admissionId: admission.id,
      patientId: admission.patientId,
      patientName: patientById.get(admission.patientId)?.name ?? `Patient #${admission.patientId}`,
      patientMrn: patientById.get(admission.patientId)?.mrn ?? null,
      wardId: admission.wardId,
      wardName: wardNameById.get(admission.wardId) ?? 'Ward',
      bedId: admission.bedId,
      bedNumber: bedById.get(admission.bedId)?.bedNumber ?? String(admission.bedId),
      admissionDate: admission.admissionDate,
      admissionType: admission.admissionType ?? null,
      admittingDoctor: admission.admittingDoctor ?? null,
      provisionalDiagnosis: admission.provisionalDiagnosis ?? null,
      lastVitalsAt: lastVitalsAt ? new Date(lastVitalsAt).toISOString() : null,
      lastVitalsFlags: latest ? assessVitals(latest) : [],
      vitalsOverdue: hoursSinceVitals === null || hoursSinceVitals > VITALS_OVERDUE_HOURS,
      hoursSinceVitals: hoursSinceVitals === null ? null : Math.round(hoursSinceVitals * 10) / 10,
      notesToday: noteInfo?.count ?? 0,
      lastNoteAt: noteInfo?.lastAt ? noteInfo.lastAt.toISOString() : null,
      lastNoteShift: noteInfo?.lastShift ?? null,
    };
  });

  const occupiedBeds = beds.filter((bed) => bed.status === 'Occupied').length;
  const availableBeds = beds.filter((bed) => bed.status === 'Available').length;
  const cleaningBeds = beds.filter((bed) => bed.status === 'Cleaning').length;

  return {
    facilityId,
    generatedAt: new Date().toISOString(),
    shift: currentShift(),
    wardCount: wards.length,
    bedCount: beds.length,
    occupiedBeds,
    availableBeds,
    cleaningBeds,
    occupancyRate: beds.length > 0 ? Math.round((occupiedBeds / beds.length) * 1000) / 10 : 0,
    admissionCount: admissions.length,
    vitalsOverdueCount: rows.filter((row) => row.vitalsOverdue).length,
    criticalVitalsCount: rows.filter((row) =>
      row.lastVitalsFlags.some((flag) => flag.severity === 'critical'),
    ).length,
    notesTodayCount: notes.filter((note) => note.admissionId !== null).length,
    rows,
  };
}

/* ============================================================
   SHIFT HANDOVER
   ============================================================ */

export interface HandoverGroup {
  shift: ShiftName;
  noteCount: number;
  notes: Array<{
    id: number;
    patientId: number;
    admissionId: number | null;
    noteType: string;
    note: string;
    recordedBy: string;
    recordedAt: string;
    shift: string | null;
  }>;
}

/**
 * Notes for one calendar day, grouped by shift, newest first.
 *
 * Defaults to today. Pass `date` (YYYY-MM-DD) to review an earlier
 * handover. Notes recorded without a shift are grouped under the shift
 * implied by their timestamp, so nothing is silently dropped.
 */
export async function getShiftHandoverScoped(
  context: AuthorizationContext,
  options: { date?: string; shift?: string } = {},
): Promise<{ date: string; groups: HandoverGroup[]; total: number }> {
  const board = await getInpatientBoardScoped(context);

  if (!board.facilityId) {
    return { date: options.date ?? dateKey(new Date()), groups: [], total: 0 };
  }

  const day =
    options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : dateKey(new Date());

  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  if (Number.isNaN(start.getTime())) {
    throw new InpatientDomainError('INVALID_INPUT', 'Enter the handover date as YYYY-MM-DD.', 400);
  }

  const rows = await db
    .select({
      id: schema.nursingNotes.id,
      patientId: schema.nursingNotes.patientId,
      admissionId: schema.nursingNotes.admissionId,
      noteType: schema.nursingNotes.noteType,
      note: schema.nursingNotes.note,
      recordedBy: schema.nursingNotes.recordedBy,
      recordedAt: schema.nursingNotes.recordedAt,
      shift: schema.nursingNotes.shift,
    })
    .from(schema.nursingNotes)
    .where(
      and(
        eq(schema.nursingNotes.facilityId, board.facilityId),
        gte(schema.nursingNotes.recordedAt, start),
        lte(schema.nursingNotes.recordedAt, end),
      ),
    )
    .orderBy(desc(schema.nursingNotes.recordedAt));

  const groups: HandoverGroup[] = SHIFT_NAMES.map((shift) => ({
    shift,
    noteCount: 0,
    notes: [],
  }));

  for (const row of rows) {
    const recorded = row.recordedAt ? new Date(row.recordedAt) : new Date();

    const shift =
      row.shift && (SHIFT_NAMES as readonly string[]).includes(row.shift)
        ? (row.shift as ShiftName)
        : shiftForHour(recorded.getHours());

    const group = groups.find((entry) => entry.shift === shift);

    if (!group) continue;

    group.notes.push({
      id: row.id,
      patientId: row.patientId,
      admissionId: row.admissionId,
      noteType: row.noteType,
      note: row.note,
      recordedBy: row.recordedBy,
      recordedAt: recorded.toISOString(),
      shift: row.shift ?? null,
    });

    group.noteCount += 1;
  }

  const filtered = options.shift ? groups.filter((group) => group.shift === options.shift) : groups;

  return {
    date: day,
    groups: filtered,
    total: filtered.reduce((sum, group) => sum + group.noteCount, 0),
  };
}

/* ============================================================
   SHARED GUARD
   ============================================================ */

/**
 * Re-exported so routes can map scope failures to 403 without importing
 * the whole query layer.
 */
export { ScopeAccessError };
