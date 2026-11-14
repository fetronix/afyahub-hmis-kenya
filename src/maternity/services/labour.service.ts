import { and, asc, desc, eq } from 'drizzle-orm';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  LIQUORS,
  MEMBRANES,
  buildPartographPlot,
  gestationAt,
  numberInRange,
  oneOf,
  partographGuidance,
  type FieldError,
} from '../maternity-contracts.ts';
import {
  MaternityDomainError,
  collect,
  facilityInScope,
  invalid,
  optionalText,
  optionalTimestamp,
  resolveLabour,
  resolvePregnancy,
  toNumeric,
  uniqueViolation,
} from './shared.ts';

export type StartLabourInput = {
  pregnancyId: number;
  admittedAt: string;
  labourOnsetAt?: string | null;
  membranesRupturedAt?: string | null;
  gestationWeeksAtAdmission?: number;
  notes?: string | null;
  encounterId?: number;
};

export async function startLabour(context: AuthorizationContext, input: StartLabourInput) {
  const pregnancy = await resolvePregnancy(context, input.pregnancyId);

  if (pregnancy.status !== 'Active') {
    throw new MaternityDomainError(
      'PREGNANCY_NOT_ACTIVE',
      `This pregnancy is ${pregnancy.status.toLowerCase()} and cannot start a new labour record.`,
      409,
    );
  }

  const [openLabour] = await db
    .select({ id: schema.labourRecords.id })
    .from(schema.labourRecords)
    .where(
      and(
        eq(schema.labourRecords.pregnancyId, pregnancy.id),
        eq(schema.labourRecords.status, 'In Labour'),
      ),
    )
    .limit(1);

  if (openLabour) {
    throw new MaternityDomainError(
      'LABOUR_ALREADY_OPEN',
      'This pregnancy is already in labour. Continue the existing record.',
      409,
    );
  }

  const errors: FieldError[] = [];

  const admittedAt = optionalTimestamp(input.admittedAt, 'Admission time');

  if (!admittedAt) {
    errors.push({
      field: 'admittedAt',
      message: 'An admission date and time is required.',
    });
  }

  const labourOnsetAt = optionalTimestamp(input.labourOnsetAt, 'Labour onset time');
  const membranesRupturedAt = optionalTimestamp(input.membranesRupturedAt, 'Membranes ruptured at');

  if (labourOnsetAt && admittedAt && labourOnsetAt > admittedAt) {
    errors.push({
      field: 'labourOnsetAt',
      message: 'Labour cannot have started after the admission time.',
    });
  }

  if (membranesRupturedAt && labourOnsetAt && membranesRupturedAt < labourOnsetAt) {
    errors.push({
      field: 'membranesRupturedAt',
      message: 'Membranes cannot have ruptured before labour started.',
    });
  }

  const gestationWeeksAtAdmission = collect(
    numberInRange(
      input.gestationWeeksAtAdmission ??
        (admittedAt ? gestationAt(pregnancy.eddDate, admittedAt.slice(0, 10))?.weeks : undefined),
      'Gestation at admission',
      20,
      45,
    ),
    errors,
  );

  if (errors.length > 0) invalid(errors);

  const [created] = await db
    .insert(schema.labourRecords)
    .values({
      tenantId: context.tenantId!,
      facilityId: pregnancy.facilityId,
      pregnancyId: pregnancy.id,
      patientId: pregnancy.patientId,
      encounterId: input.encounterId ?? null,
      admittedAt: admittedAt!,
      labourOnsetAt,
      membranesRupturedAt,
      gestationWeeksAtAdmission,
      status: 'In Labour',
      notes: optionalText(input.notes, 4000),
      createdBy: context.userId,
    })
    .returning();

  return created;
}

export async function getLabour(context: AuthorizationContext, labourRecordId: number) {
  const labour = await resolveLabour(context, labourRecordId);

  const entries = await db
    .select()
    .from(schema.partographEntries)
    .where(eq(schema.partographEntries.labourRecordId, labour.id))
    .orderBy(asc(schema.partographEntries.recordedAt));

  const [pregnancy] = await db
    .select()
    .from(schema.maternityPregnancies)
    .where(eq(schema.maternityPregnancies.id, labour.pregnancyId))
    .limit(1);

  return {
    ...labour,
    pregnancy,
    entries,
    guidance: partographGuidance(
      entries.map((entry) => ({
        recordedAt: entry.recordedAt,
        cervicalDilatationCm:
          entry.cervicalDilatationCm === null ? null : Number(entry.cervicalDilatationCm),
      })),
    ),
    plot: buildPartographPlot(
      labour.admittedAt,
      entries.map((entry) => ({
        recordedAt: entry.recordedAt,
        cervicalDilatationCm: entry.cervicalDilatationCm,
        fetalHeartRateBpm: entry.fetalHeartRateBpm,
        contractionsPer10Min: entry.contractionsPer10Min,
        contractionDurationSec: entry.contractionDurationSec,
      })),
    ),
  };
}

export async function listLabours(
  context: AuthorizationContext,
  query: { facilityId?: number; status?: string } = {},
) {
  const conditions = [eq(schema.labourRecords.tenantId, context.tenantId!)];

  if (query.facilityId !== undefined) {
    conditions.push(
      eq(schema.labourRecords.facilityId, await facilityInScope(context, query.facilityId)),
    );
  } else if (context.facilityId) {
    conditions.push(eq(schema.labourRecords.facilityId, context.facilityId));
  }

  if (query.status) {
    conditions.push(eq(schema.labourRecords.status, query.status));
  }

  const rows = await db
    .select({
      labour: schema.labourRecords,
      patient: {
        id: schema.patients.id,
        mrn: schema.patients.mrn,
        firstName: schema.patients.firstName,
        lastName: schema.patients.lastName,
      },
    })
    .from(schema.labourRecords)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.labourRecords.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.labourRecords.admittedAt))
    .limit(100);

  return rows.map((row) => ({ ...row.labour, patient: row.patient }));
}

export type UpdateLabourInput = {
  status?: string;
  notes?: string | null;
  labourOnsetAt?: string | null;
  membranesRupturedAt?: string | null;
};

export async function updateLabour(
  context: AuthorizationContext,
  labourRecordId: number,
  input: UpdateLabourInput,
) {
  const labour = await resolveLabour(context, labourRecordId);
  const errors: FieldError[] = [];
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) {
    const status = oneOf(input.status, 'Status', ['In Labour', 'Delivered', 'Referred', 'Closed']);

    if (status.error) errors.push(status.error);
    else patch.status = status.value;
  }

  if (input.notes !== undefined) patch.notes = optionalText(input.notes, 4000);
  if (input.labourOnsetAt !== undefined) {
    patch.labourOnsetAt = optionalTimestamp(input.labourOnsetAt, 'Labour onset time');
  }
  if (input.membranesRupturedAt !== undefined) {
    patch.membranesRupturedAt = optionalTimestamp(
      input.membranesRupturedAt,
      'Membranes ruptured at',
    );
  }

  if (errors.length > 0) invalid(errors);

  if (labour.status === 'Delivered' && patch.status !== undefined && patch.status !== 'Delivered') {
    throw new MaternityDomainError(
      'LABOUR_DELIVERED',
      'This labour already has a delivery recorded and cannot be reopened.',
      409,
    );
  }

  const [updated] = await db
    .update(schema.labourRecords)
    .set(patch)
    .where(eq(schema.labourRecords.id, labour.id))
    .returning();

  return updated;
}

export type PartographInput = {
  labourRecordId: number;
  recordedAt: string;
  cervicalDilatationCm?: number;
  descentStation?: number;
  contractionsPer10Min?: number;
  contractionDurationSec?: number;
  fetalHeartRateBpm?: number;
  membranes?: string;
  liquor?: string;
  maternalPulseBpm?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  temperatureC?: number;
  oxytocin?: string | null;
  drugsGiven?: string | null;
  notes?: string | null;
};

export async function recordPartographEntry(context: AuthorizationContext, input: PartographInput) {
  const labour = await resolveLabour(context, input.labourRecordId);

  if (labour.status !== 'In Labour') {
    throw new MaternityDomainError(
      'LABOUR_NOT_OPEN',
      `This labour is ${labour.status.toLowerCase()}; partograph readings are closed.`,
      409,
    );
  }

  const errors: FieldError[] = [];

  const recordedAt = optionalTimestamp(input.recordedAt, 'Reading time');

  if (!recordedAt) {
    errors.push({
      field: 'recordedAt',
      message: 'A date and time is required for every partograph reading.',
    });
  } else if (recordedAt < labour.admittedAt) {
    errors.push({
      field: 'recordedAt',
      message: 'A reading cannot be earlier than the time of admission.',
    });
  }

  const checks = {
    cervicalDilatationCm: numberInRange(
      input.cervicalDilatationCm,
      'Cervical dilatation',
      0,
      10,
      'cm',
    ),
    descentStation: numberInRange(input.descentStation, 'Descent station', -3, 3),
    contractionsPer10Min: numberInRange(input.contractionsPer10Min, 'Contractions', 0, 7),
    contractionDurationSec: numberInRange(
      input.contractionDurationSec,
      'Contraction duration',
      0,
      120,
      'seconds',
    ),
    fetalHeartRateBpm: numberInRange(input.fetalHeartRateBpm, 'Fetal heart rate', 50, 240),
    maternalPulseBpm: numberInRange(input.maternalPulseBpm, 'Maternal pulse', 30, 220),
    bpSystolic: numberInRange(input.bpSystolic, 'Systolic blood pressure', 50, 300),
    bpDiastolic: numberInRange(input.bpDiastolic, 'Diastolic blood pressure', 20, 200),
    temperatureC: numberInRange(input.temperatureC, 'Temperature', 30, 43, '°C'),
  };

  for (const check of Object.values(checks)) {
    if (check.error) errors.push(check.error);
  }

  if (
    checks.bpSystolic.value !== null &&
    checks.bpDiastolic.value !== null &&
    checks.bpSystolic.value <= checks.bpDiastolic.value
  ) {
    errors.push({
      field: 'bpSystolic',
      message: 'Systolic pressure must be higher than diastolic pressure.',
    });
  }

  const membranes = collect(oneOf(input.membranes, 'Membranes', MEMBRANES), errors);
  const liquor = collect(oneOf(input.liquor, 'Liquor', LIQUORS), errors);

  if (errors.length > 0) invalid(errors);

  try {
    const [created] = await db
      .insert(schema.partographEntries)
      .values({
        tenantId: context.tenantId!,
        facilityId: labour.facilityId,
        labourRecordId: labour.id,
        patientId: labour.patientId,
        recordedAt: recordedAt!,
        cervicalDilatationCm: toNumeric(checks.cervicalDilatationCm.value),
        descentStation: checks.descentStation.value,
        contractionsPer10Min: checks.contractionsPer10Min.value,
        contractionDurationSec: checks.contractionDurationSec.value,
        fetalHeartRateBpm: checks.fetalHeartRateBpm.value,
        membranes,
        liquor,
        maternalPulseBpm: checks.maternalPulseBpm.value,
        bpSystolic: checks.bpSystolic.value,
        bpDiastolic: checks.bpDiastolic.value,
        temperatureC: toNumeric(checks.temperatureC.value),
        oxytocin: optionalText(input.oxytocin, 200),
        drugsGiven: optionalText(input.drugsGiven, 1000),
        notes: optionalText(input.notes, 2000),
        recordedBy: context.userId,
      })
      .returning();

    return created;
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new MaternityDomainError(
        'DUPLICATE_READING',
        'There is already a partograph reading at that exact time. Edit the existing row instead of adding a second one.',
        409,
      );
    }

    throw error;
  }
}
