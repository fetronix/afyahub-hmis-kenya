/**
 * JaliCare HMIS
 * Postnatal care service
 *
 * The six weeks after delivery, recorded as a series of contacts. The
 * visit hangs off the pregnancy rather than the delivery, because a
 * woman who delivered elsewhere still attends here for her check.
 */

import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';

import {
  BREASTFEEDING,
  BREASTS,
  INVOLUTION,
  LOCHIA,
  MOOD_SCREENING,
  POSTPARTUM_PERINEUM,
  daysBetween,
  isIsoDate,
  oneOf,
  numberInRange,
  type FieldError,
} from '../maternity/maternity-contracts.ts';

import { MaternityDomainError, resolvePregnancy } from '../maternity/maternity.service.ts';

export type PostnatalVisitInput = {
  pregnancyId: number;
  deliveryId?: number | null;
  visitDate: string;
  visitNumber?: number;
  dayPostpartum?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  pulseBpm?: number;
  temperatureC?: number;
  fundalHeightCm?: number;
  involution?: string;
  lochia?: string;
  perineum?: string;
  breasts?: string;
  breastfeeding?: string;
  moodScreening?: string;
  haemoglobinGdl?: number;
  dangerSigns?: string | null;
  notes?: string | null;
  nextVisitDate?: string | null;
  babyWeightGrams?: number;
  babyNotes?: string | null;
};

function optionalText(value: unknown, max = 2000): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed.slice(0, max);
}

function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}

export async function recordPostnatalVisit(
  context: AuthorizationContext,
  input: PostnatalVisitInput,
) {
  const pregnancy = await resolvePregnancy(context, input.pregnancyId);

  const errors: FieldError[] = [];

  if (!isIsoDate(input.visitDate)) {
    errors.push({
      field: 'visitDate',
      message: 'A valid visit date is required (YYYY-MM-DD).',
    });
  }

  const visitDate = input.visitDate;

  /*
   * Day postpartum is counted from the delivery date that is recorded,
   * not worked out from today. If the delivery is not linked, the caller
   * may state it — but a number the server can derive is derived.
   */
  let dayPostpartum: number | null = null;

  if (input.deliveryId) {
    const [delivery] = await db
      .select()
      .from(schema.deliveries)
      .where(eq(schema.deliveries.id, Number(input.deliveryId)))
      .limit(1);

    if (!delivery || delivery.pregnancyId !== pregnancy.id) {
      throw new MaternityDomainError(
        'DELIVERY_PREGNANCY_MISMATCH',
        'The delivery does not belong to this pregnancy.',
        409,
      );
    }

    dayPostpartum = daysBetween(delivery.deliveredAt.slice(0, 10), visitDate);
  } else if (input.dayPostpartum !== undefined) {
    dayPostpartum = Number(input.dayPostpartum);
  }

  const checks = {
    visitNumber: numberInRange(input.visitNumber, 'Visit number', 1, 40),
    dayPostpartum: numberInRange(dayPostpartum, 'Day postpartum', 0, 365),
    bpSystolic: numberInRange(input.bpSystolic, 'Systolic blood pressure', 50, 300),
    bpDiastolic: numberInRange(input.bpDiastolic, 'Diastolic blood pressure', 20, 200),
    pulseBpm: numberInRange(input.pulseBpm, 'Pulse', 20, 250),
    temperatureC: numberInRange(input.temperatureC, 'Temperature', 30, 45, '°C'),
    fundalHeightCm: numberInRange(input.fundalHeightCm, 'Fundal height', 0, 40, 'cm'),
    haemoglobinGdl: numberInRange(input.haemoglobinGdl, 'Haemoglobin', 2, 25, 'g/dL'),
    babyWeightGrams: numberInRange(input.babyWeightGrams, 'Baby weight', 500, 12000, 'g'),
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

  const involution = (() => {
    const result = oneOf(input.involution, 'Involution', INVOLUTION);
    if (result.error) errors.push(result.error);
    return result.value;
  })();

  const lochia = (() => {
    const result = oneOf(input.lochia, 'Lochia', LOCHIA);
    if (result.error) errors.push(result.error);
    return result.value;
  })();

  const perineum = (() => {
    const result = oneOf(input.perineum, 'Perineum', POSTPARTUM_PERINEUM);
    if (result.error) errors.push(result.error);
    return result.value;
  })();

  const breasts = (() => {
    const result = oneOf(input.breasts, 'Breasts', BREASTS);
    if (result.error) errors.push(result.error);
    return result.value;
  })();

  const breastfeeding = (() => {
    const result = oneOf(input.breastfeeding, 'Breastfeeding', BREASTFEEDING);
    if (result.error) errors.push(result.error);
    return result.value;
  })();

  const moodScreening = (() => {
    const result = oneOf(input.moodScreening, 'Mood screening', MOOD_SCREENING);
    if (result.error) errors.push(result.error);
    return result.value;
  })();

  const nextVisitDate =
    typeof input.nextVisitDate === 'string' && input.nextVisitDate.trim() !== ''
      ? input.nextVisitDate
      : null;

  if (nextVisitDate && !isIsoDate(nextVisitDate)) {
    errors.push({
      field: 'nextVisitDate',
      message: 'The next visit must be a valid date (YYYY-MM-DD).',
    });
  } else if (nextVisitDate && isIsoDate(visitDate)) {
    if (daysBetween(visitDate, nextVisitDate) <= 0) {
      errors.push({
        field: 'nextVisitDate',
        message: 'The next visit must be after this visit.',
      });
    }
  }

  if (errors.length > 0) {
    throw new MaternityDomainError(
      'INVALID_INPUT',
      errors.map((error) => error.message).join(' '),
      400,
      errors,
    );
  }

  const [created] = await db
    .insert(schema.postnatalVisits)
    .values({
      tenantId: context.tenantId!,
      facilityId: pregnancy.facilityId,
      patientId: pregnancy.patientId,
      pregnancyId: pregnancy.id,
      deliveryId: input.deliveryId ? Number(input.deliveryId) : null,
      visitDate,
      visitNumber: checks.visitNumber.value,
      dayPostpartum: checks.dayPostpartum.value,
      bpSystolic: checks.bpSystolic.value,
      bpDiastolic: checks.bpDiastolic.value,
      pulseBpm: checks.pulseBpm.value,
      temperatureC: toNumeric(checks.temperatureC.value),
      fundalHeightCm: toNumeric(checks.fundalHeightCm.value),
      involution,
      lochia,
      perineum,
      breasts,
      breastfeeding,
      moodScreening,
      haemoglobinGdl: toNumeric(checks.haemoglobinGdl.value),
      dangerSigns: optionalText(input.dangerSigns),
      notes: optionalText(input.notes, 4000),
      nextVisitDate,
      babyWeightGrams: checks.babyWeightGrams.value,
      babyNotes: optionalText(input.babyNotes, 2000),
      recordedBy: context.userId,
    })
    .returning();

  return created;
}

export async function listPostnatalVisits(context: AuthorizationContext, pregnancyId: number) {
  const pregnancy = await resolvePregnancy(context, pregnancyId);

  return db
    .select()
    .from(schema.postnatalVisits)
    .where(eq(schema.postnatalVisits.pregnancyId, pregnancy.id))
    .orderBy(desc(schema.postnatalVisits.visitDate), desc(schema.postnatalVisits.id));
}

/**
 * Recent postnatal contacts at a facility.
 *
 * A register, not a due list: it shows what has been recorded, newest
 * first, so a midwife can see who came back. It does not assert that a
 * woman is overdue for a contact — the facility's schedule decides that,
 * and this table would only be guessing.
 */
export async function listPostnatalVisitsForFacility(
  context: AuthorizationContext,
  facilityId?: number,
) {
  const conditions = [eq(schema.postnatalVisits.tenantId, context.tenantId!)];

  if (facilityId) {
    conditions.push(eq(schema.postnatalVisits.facilityId, facilityId));
  } else if (context.facilityId) {
    conditions.push(eq(schema.postnatalVisits.facilityId, context.facilityId));
  }

  const rows = await db
    .select({
      visit: schema.postnatalVisits,
      patient: {
        id: schema.patients.id,
        mrn: schema.patients.mrn,
        firstName: schema.patients.firstName,
        lastName: schema.patients.lastName,
      },
    })
    .from(schema.postnatalVisits)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.postnatalVisits.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.postnatalVisits.visitDate))
    .limit(50);

  return rows.map((row) => ({ ...row.visit, patient: row.patient }));
}
