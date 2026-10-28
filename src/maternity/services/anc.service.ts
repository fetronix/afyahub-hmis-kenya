import { desc, eq } from 'drizzle-orm';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  PRESENTATIONS,
  URINE_DIPSTICK,
  daysBetween,
  gestationAt,
  numberInRange,
  oneOf,
  type FieldError,
} from '../maternity-contracts.ts';
import {
  MaternityDomainError,
  collect,
  invalid,
  optionalIsoDate,
  optionalText,
  requireIsoDate,
  resolvePregnancy,
  toNumeric,
} from './shared.ts';

export type AncVisitInput = {
  pregnancyId: number;
  visitDate: string;
  visitNumber?: number;
  gestationWeeks?: number;
  gestationDays?: number;
  weightKg?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  pulseBpm?: number;
  temperatureC?: number;
  fundalHeightCm?: number;
  fetalHeartRateBpm?: number;
  presentation?: string;
  fetalMovements?: string;
  urineProtein?: string;
  urineGlucose?: string;
  haemoglobinGdl?: number;
  ttDose?: number;
  ifasDispensed?: boolean;
  dangerSigns?: string | null;
  notes?: string | null;
  nextVisitDate?: string | null;
};

export async function recordAncVisit(context: AuthorizationContext, input: AncVisitInput) {
  const pregnancy = await resolvePregnancy(context, input.pregnancyId);

  if (pregnancy.status !== 'Active') {
    throw new MaternityDomainError(
      'PREGNANCY_NOT_ACTIVE',
      `This pregnancy is ${pregnancy.status.toLowerCase()} and no longer takes antenatal visits.`,
      409,
    );
  }

  const errors: FieldError[] = [];

  const visitDate = requireIsoDate(input.visitDate, 'Visit date');

  const computed = gestationAt(pregnancy.eddDate, visitDate);

  const gestationWeeks = collect(
    numberInRange(input.gestationWeeks ?? computed?.weeks, 'Gestation weeks', 0, 45),
    errors,
  );
  const gestationDays = collect(
    numberInRange(input.gestationDays ?? computed?.days, 'Gestation days', 0, 6),
    errors,
  );

  const checks = {
    visitNumber: numberInRange(input.visitNumber, 'Visit number', 1, 40),
    weightKg: numberInRange(input.weightKg, 'Weight', 20, 250, 'kg'),
    bpSystolic: numberInRange(input.bpSystolic, 'Systolic blood pressure', 50, 300),
    bpDiastolic: numberInRange(input.bpDiastolic, 'Diastolic blood pressure', 20, 200),
    pulseBpm: numberInRange(input.pulseBpm, 'Pulse', 20, 250),
    temperatureC: numberInRange(input.temperatureC, 'Temperature', 30, 45, '°C'),
    fundalHeightCm: numberInRange(input.fundalHeightCm, 'Fundal height', 4, 60, 'cm'),
    fetalHeartRateBpm: numberInRange(input.fetalHeartRateBpm, 'Fetal heart rate', 50, 240),
    haemoglobinGdl: numberInRange(input.haemoglobinGdl, 'Haemoglobin', 2, 25, 'g/dL'),
    ttDose: numberInRange(input.ttDose, 'Tetanus toxoid dose', 1, 5),
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

  const presentation = collect(oneOf(input.presentation, 'Presentation', PRESENTATIONS), errors);
  const urineProtein = collect(oneOf(input.urineProtein, 'Urine protein', URINE_DIPSTICK), errors);
  const urineGlucose = collect(oneOf(input.urineGlucose, 'Urine glucose', URINE_DIPSTICK), errors);

  const nextVisitDate = optionalIsoDate(input.nextVisitDate, 'Next visit date');

  if (nextVisitDate && daysBetween(visitDate, nextVisitDate) <= 0) {
    errors.push({
      field: 'nextVisitDate',
      message: 'The next visit must be after this visit.',
    });
  }

  if (errors.length > 0) invalid(errors);

  const [created] = await db
    .insert(schema.ancVisits)
    .values({
      tenantId: context.tenantId!,
      facilityId: pregnancy.facilityId,
      pregnancyId: pregnancy.id,
      patientId: pregnancy.patientId,
      visitDate,
      visitNumber: checks.visitNumber.value,
      gestationWeeks,
      gestationDays,
      weightKg: toNumeric(checks.weightKg.value),
      bpSystolic: checks.bpSystolic.value,
      bpDiastolic: checks.bpDiastolic.value,
      pulseBpm: checks.pulseBpm.value,
      temperatureC: toNumeric(checks.temperatureC.value),
      fundalHeightCm: toNumeric(checks.fundalHeightCm.value),
      fetalHeartRateBpm: checks.fetalHeartRateBpm.value,
      presentation,
      fetalMovements: optionalText(input.fetalMovements, 200),
      urineProtein,
      urineGlucose,
      haemoglobinGdl: toNumeric(checks.haemoglobinGdl.value),
      ttDose: checks.ttDose.value,
      ifasDispensed: input.ifasDispensed === true,
      dangerSigns: optionalText(input.dangerSigns, 2000),
      notes: optionalText(input.notes, 4000),
      nextVisitDate,
      recordedBy: context.userId,
    })
    .returning();

  return created;
}

export async function listAncVisits(context: AuthorizationContext, pregnancyId: number) {
  const pregnancy = await resolvePregnancy(context, pregnancyId);

  return db
    .select()
    .from(schema.ancVisits)
    .where(eq(schema.ancVisits.pregnancyId, pregnancy.id))
    .orderBy(desc(schema.ancVisits.visitDate), desc(schema.ancVisits.id));
}
