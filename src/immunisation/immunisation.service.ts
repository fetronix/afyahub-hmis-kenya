/**
 * JaliCare HMIS
 * Immunisation service
 *
 * Records the doses that were given, and works out what is outstanding
 * against the reference schedule held in code.
 *
 * What it will not do: refuse a dose because the schedule says it is
 * early, or mark a child unimmunised because a dose is missing from the
 * list. A record of what was administered is a fact; a schedule is a
 * recommendation.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';

import {
  ANTIGEN_BY_CODE,
  SCHEDULE_AGREES_NOTE,
  immunisationStatus,
  outstandingDoses,
} from './immunisation-contracts.ts';

/*
 * Served to the screen so it can build its antigen picker from the same
 * array the due-date logic uses. A copy in the UI would be a second
 * schedule, and the second one is always the wrong one.
 */
export { ANTIGENS, SCHEDULE_AGREES_NOTE } from './immunisation-contracts.ts';

export class ImmunisationDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'ImmunisationDomainError';
  }
}

function pgErrorCode(error: unknown): string | undefined {
  return (
    (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function patientInScope(context: AuthorizationContext, patientId: unknown) {
  const parsed = Number(patientId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ImmunisationDomainError('PATIENT_REQUIRED', 'A valid patientId is required.', 400);
  }

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
      dateOfBirth: schema.patients.dateOfBirth,
      gender: schema.patients.gender,
      registrationFacilityId: schema.patients.registrationFacilityId,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, parsed))
    .limit(1);

  if (!patient || patient.tenantId !== context.tenantId) {
    throw new ImmunisationDomainError('NOT_FOUND', 'The patient was not found.', 404);
  }

  return patient;
}

export type RecordImmunisationInput = {
  patientId: number;
  antigenCode: string;
  doseNumber?: number;
  administeredOn: string;
  batchNumber?: string | null;
  site?: string | null;
  route?: string | null;
  deliveryId?: number | null;
  deliveryBabyId?: number | null;
  pregnancyId?: number | null;
  notes?: string | null;
};

export async function recordImmunisation(
  context: AuthorizationContext,
  input: RecordImmunisationInput,
) {
  const patient = await patientInScope(context, input.patientId);

  const antigen = ANTIGEN_BY_CODE.get(String(input.antigenCode ?? '').trim());

  if (!antigen) {
    throw new ImmunisationDomainError(
      'UNKNOWN_ANTIGEN',
      `"${input.antigenCode}" is not an antigen in the reference schedule. Record the dose against one of the listed antigens, or add it to the schedule first.`,
      400,
    );
  }

  if (!ISO_DATE.test(String(input.administeredOn ?? ''))) {
    throw new ImmunisationDomainError(
      'INVALID_DATE',
      'The date given must be a valid date (YYYY-MM-DD).',
      400,
    );
  }

  const administeredOn = input.administeredOn;

  if (administeredOn > today()) {
    throw new ImmunisationDomainError(
      'FUTURE_DATE',
      'A dose cannot be recorded as given in the future.',
      400,
    );
  }

  if (patient.dateOfBirth) {
    const born = String(patient.dateOfBirth).slice(0, 10);

    if (administeredOn < born) {
      throw new ImmunisationDomainError(
        'BEFORE_BIRTH',
        'The date given cannot be before the child was born.',
        400,
      );
    }
  }

  const doseNumber = Number(input.doseNumber ?? 1);

  if (!Number.isSafeInteger(doseNumber) || doseNumber < 1 || doseNumber > 4) {
    throw new ImmunisationDomainError(
      'INVALID_DOSE',
      'The dose number must be between 1 and 4.',
      400,
    );
  }

  const facilityId = context.facilityId ?? patient.registrationFacilityId;

  if (!facilityId) {
    throw new ImmunisationDomainError(
      'FACILITY_REQUIRED',
      'This child has no facility, so the dose cannot be attributed. Register the child at a facility first.',
      400,
    );
  }

  try {
    const [created] = await db
      .insert(schema.immunisationRecords)
      .values({
        tenantId: context.tenantId!,
        facilityId,
        patientId: patient.id,
        deliveryId: input.deliveryId ? Number(input.deliveryId) : null,
        deliveryBabyId: input.deliveryBabyId ? Number(input.deliveryBabyId) : null,
        pregnancyId: input.pregnancyId ? Number(input.pregnancyId) : null,
        antigenCode: antigen.code,
        doseNumber,
        administeredOn,
        batchNumber: input.batchNumber?.trim() || null,
        site: input.site?.trim() || null,
        route: input.route?.trim() || antigen.route,
        administeredBy: context.userId,
        notes: input.notes?.trim() || null,
      })
      .returning();

    return created;
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new ImmunisationDomainError(
        'DOSE_ALREADY_RECORDED',
        `${antigen.name} dose ${doseNumber} has already been recorded for this child.`,
        409,
      );
    }

    throw error;
  }
}

export async function listImmunisationRecords(context: AuthorizationContext, patientId: number) {
  const patient = await patientInScope(context, patientId);

  return db
    .select()
    .from(schema.immunisationRecords)
    .where(eq(schema.immunisationRecords.patientId, patient.id))
    .orderBy(desc(schema.immunisationRecords.administeredOn));
}

/**
 * The child's card: what was given, and what the schedule says is
 * outstanding as of today.
 */
export async function immunisationCard(context: AuthorizationContext, patientId: number) {
  const patient = await patientInScope(context, patientId);

  const records = await db
    .select()
    .from(schema.immunisationRecords)
    .where(eq(schema.immunisationRecords.patientId, patient.id))
    .orderBy(desc(schema.immunisationRecords.administeredOn));

  const dateOfBirth = patient.dateOfBirth ? String(patient.dateOfBirth).slice(0, 10) : null;

  if (!dateOfBirth) {
    return {
      patient,
      dateOfBirth: null,
      records,
      statuses: [],
      outstanding: [],
      note: 'This child has no date of birth recorded, so due dates cannot be calculated. Record the date of birth first.',
    };
  }

  const statuses = immunisationStatus(
    dateOfBirth,
    today(),
    records.map((record) => ({
      antigenCode: record.antigenCode,
      administeredOn: record.administeredOn,
    })),
  );

  return {
    patient,
    dateOfBirth,
    records,
    statuses,
    outstanding: outstandingDoses(statuses),
    note: SCHEDULE_AGREES_NOTE,
  };
}

/**
 * Children at this facility with at least one dose due or overdue.
 *
 * Bounded on purpose: it looks at children under five who are registered
 * here, capped at 300, rather than every patient in the tenant. A clinic
 * list that takes ten seconds to load is a list nobody opens.
 */
export async function immunisationDueList(context: AuthorizationContext, facilityId?: number) {
  const scopedFacilityId = facilityId ? Number(facilityId) : context.facilityId;

  if (!scopedFacilityId) {
    throw new ImmunisationDomainError(
      'FACILITY_REQUIRED',
      'Select a facility to see the immunisation list.',
      400,
    );
  }

  const facility = await getFacilityByIdScoped(context, scopedFacilityId).catch(() => null);

  if (!facility) {
    throw new ImmunisationDomainError('NOT_FOUND', 'The facility was not found.', 404);
  }

  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 5);

  const children = await db
    .select({
      id: schema.patients.id,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
      dateOfBirth: schema.patients.dateOfBirth,
    })
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.tenantId, context.tenantId!),
        eq(schema.patients.registrationFacilityId, scopedFacilityId),
        sql`${schema.patients.dateOfBirth} >= ${cutoff.toISOString().slice(0, 10)}`,
      ),
    )
    .orderBy(schema.patients.dateOfBirth)
    .limit(300);

  if (children.length === 0) {
    return { asOf: today(), children: [], note: SCHEDULE_AGREES_NOTE };
  }

  const records = await db
    .select({
      patientId: schema.immunisationRecords.patientId,
      antigenCode: schema.immunisationRecords.antigenCode,
      administeredOn: schema.immunisationRecords.administeredOn,
    })
    .from(schema.immunisationRecords)
    .where(
      inArray(
        schema.immunisationRecords.patientId,
        children.map((child) => child.id),
      ),
    );

  const byPatient = new Map<number, Array<{ antigenCode: string; administeredOn: string }>>();

  for (const record of records) {
    const list = byPatient.get(record.patientId) ?? [];
    list.push({
      antigenCode: record.antigenCode,
      administeredOn: record.administeredOn,
    });
    byPatient.set(record.patientId, list);
  }

  const rows = children
    .map((child) => {
      const dateOfBirth = String(child.dateOfBirth).slice(0, 10);

      const statuses = immunisationStatus(dateOfBirth, today(), byPatient.get(child.id) ?? []);

      const outstanding = outstandingDoses(statuses);

      return {
        ...child,
        dateOfBirth,
        outstandingCount: outstanding.length,
        overdueCount: outstanding.filter((dose) => dose.status === 'Overdue').length,
        nextDue: outstanding[0]
          ? {
              antigenCode: outstanding[0].antigenCode,
              name: outstanding[0].name,
              status: outstanding[0].status,
              scheduledWeeks: outstanding[0].scheduledWeeks,
            }
          : null,
      };
    })
    .filter((child) => child.outstandingCount > 0)
    .sort((a, b) => b.overdueCount - a.overdueCount || a.dateOfBirth.localeCompare(b.dateOfBirth));

  return { asOf: today(), children: rows, note: SCHEDULE_AGREES_NOTE };
}
