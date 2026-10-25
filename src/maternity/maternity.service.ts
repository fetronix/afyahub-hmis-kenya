/**
 * JaliCare HMIS
 * Maternity / MCH service
 *
 * The clinical pathway, in the order it happens:
 *
 *   bookPregnancy    -> a pregnancy record with a dating and an EDD
 *   recordAncVisit   -> one row per antenatal visit, as many as attended
 *   startLabour      -> an admission in labour, attached to the pregnancy
 *   recordPartograph -> repeated readings through labour
 *   recordDelivery   -> the delivery, plus one row per baby
 *
 * SCOPING
 * -------
 * Every function takes the authenticated AuthorizationContext. A record
 * belonging to another facility answers "not found", not "forbidden",
 * so the response cannot be used to probe for records elsewhere.
 *
 * NOTHING IS INVENTED
 * -------------------
 * Absent measurements stay NULL. There is no default blood pressure, no
 * assumed presentation, and no placeholder Apgar. A field the clinician
 * did not fill is a field the record does not have.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';

import {
  BABY_OUTCOMES,
  DELIVERY_MODES,
  EDD_BASES,
  LIQUORS,
  MEMBRANES,
  PERINEUM_STATES,
  PREGNANCY_STATUSES,
  PRESENTATIONS,
  URINE_DIPSTICK,
  deriveEdd,
  daysBetween,
  gestationAt,
  isIsoDate,
  oneOf,
  numberInRange,
  partographGuidance,
  buildPartographPlot,
  type FieldError,
  type Gestation,
} from './maternity-contracts.ts';

export {
  DELIVERY_MODES,
  BABY_OUTCOMES,
  PERINEUM_STATES,
  PREGNANCY_STATUSES,
  MEMBRANES,
  LIQUORS,
  URINE_DIPSTICK,
  PRESENTATIONS,
  partographGuidance,
  gestationAt,
  deriveEdd,
} from './maternity-contracts.ts';

/* ============================================================
   ERRORS
   ============================================================ */

export class MaternityDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly fields?: FieldError[],
  ) {
    super(message);
    this.name = 'MaternityDomainError';
  }
}

function invalid(fields: FieldError[]): never {
  throw new MaternityDomainError(
    'INVALID_INPUT',
    fields.map((field) => field.message).join(' '),
    400,
    fields,
  );
}

function notFound(what: string): never {
  throw new MaternityDomainError(
    'NOT_FOUND',
    `${what} was not found.`,
    404,
  );
}

/* ============================================================
   SCOPE RESOLUTION
   ============================================================ */

async function facilityInScope(
  context: AuthorizationContext,
  facilityId: unknown,
): Promise<number> {
  const parsed = Number(facilityId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError(
      'FACILITY_REQUIRED',
      'A valid facilityId is required.',
      400,
    );
  }

  /*
   * getFacilityByIdScoped throws when the facility is outside the
   * caller's scope. Convert that to the same answer as a facility that
   * does not exist: a 403 here would confirm which IDs are real.
   */
  const facility = await getFacilityByIdScoped(context, parsed).catch(() => null);

  if (!facility) notFound('The facility');

  return parsed;
}

async function patientInScope(
  context: AuthorizationContext,
  patientId: unknown,
) {
  const parsed = Number(patientId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError(
      'PATIENT_REQUIRED',
      'A valid patientId is required.',
      400,
    );
  }

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, parsed))
    .limit(1);

  if (!patient || patient.tenantId !== context.tenantId) {
    notFound('The patient');
  }

  return patient;
}

export async function resolvePregnancy(
  context: AuthorizationContext,
  pregnancyId: unknown,
) {
  const parsed = Number(pregnancyId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError(
      'PREGNANCY_REQUIRED',
      'A valid pregnancyId is required.',
      400,
    );
  }

  const [pregnancy] = await db
    .select()
    .from(schema.maternityPregnancies)
    .where(eq(schema.maternityPregnancies.id, parsed))
    .limit(1);

  if (!pregnancy) notFound('The pregnancy record');

  /* Another facility's record answers the same way as a missing one. */
  const facility = await getFacilityByIdScoped(
    context,
    pregnancy.facilityId,
  ).catch(() => null);

  if (!facility || facility.tenantId !== pregnancy.tenantId) {
    notFound('The pregnancy record');
  }

  return pregnancy;
}

async function resolveLabour(
  context: AuthorizationContext,
  labourRecordId: unknown,
) {
  const parsed = Number(labourRecordId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError(
      'LABOUR_REQUIRED',
      'A valid labourRecordId is required.',
      400,
    );
  }

  const [labour] = await db
    .select()
    .from(schema.labourRecords)
    .where(eq(schema.labourRecords.id, parsed))
    .limit(1);

  if (!labour) notFound('The labour record');

  const facility = await getFacilityByIdScoped(
    context,
    labour.facilityId,
  ).catch(() => null);

  if (!facility || facility.tenantId !== labour.tenantId) {
    notFound('The labour record');
  }

  return labour;
}

/* ============================================================
   INPUT HELPERS
   ============================================================ */

function requireIsoDate(
  value: unknown,
  field: string,
): string {
  if (!isIsoDate(value)) {
    invalid([{ field, message: `${field} must be a valid date (YYYY-MM-DD).` }]);
  }

  return value.trim();
}

function optionalIsoDate(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (!isIsoDate(value)) {
    invalid([{ field, message: `${field} must be a valid date (YYYY-MM-DD).` }]);
  }

  return value.trim();
}

function optionalTimestamp(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    invalid([
      {
        field,
        message: `${field} must be a date and time (ISO 8601).`,
      },
    ]);
  }

  return value;
}

function optionalText(value: unknown, max = 2000): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  return trimmed.slice(0, max);
}

function collect<T>(
  result: { value: T; error?: FieldError },
  errors: FieldError[],
): T {
  if (result.error) {
    errors.push(result.error);
    return null as unknown as T;
  }

  return result.value;
}

/**
 * Drizzle wraps a driver error in a DrizzleQueryError, so the Postgres
 * SQLSTATE sits on `cause`, not on the thrown object. Checking only
 * `error.code` silently turns every unique violation into a 500.
 */
function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string })?.code;

  if (direct) return direct;

  return (error as { cause?: { code?: string } })?.cause?.code;
}

function uniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505';
}

/* ============================================================
   PREGNANCY
   ============================================================ */

export type BookPregnancyInput = {
  patientId: number;
  facilityId: number;
  bookedAt: string;
  lmpDate?: string | null;
  eddDate?: string | null;
  eddBasis?: string;
  gravida?: number;
  para?: number;
  abortions?: number;
  livingChildren?: number;
  heightCm?: number;
  bloodGroup?: string | null;
  rhesus?: string | null;
  haemoglobinGdl?: number;
  riskFactors?: string | null;
};

export async function bookPregnancy(
  context: AuthorizationContext,
  input: BookPregnancyInput,
) {
  const patient = await patientInScope(context, input.patientId);
  const facilityId = await facilityInScope(context, input.facilityId);

  const errors: FieldError[] = [];

  const bookedAt = requireIsoDate(input.bookedAt, 'Booked date');
  const lmpDate = optionalIsoDate(input.lmpDate, 'Last menstrual period');
  const eddBasis = collect(
    oneOf(input.eddBasis ?? 'LMP', 'EDD basis', EDD_BASES),
    errors,
  ) ?? 'LMP';

  let eddDate = optionalIsoDate(input.eddDate, 'Expected delivery date');

  if (!eddDate && lmpDate) {
    eddDate = deriveEdd(lmpDate);
  }

  if (!eddDate) {
    invalid([
      {
        field: 'eddDate',
        message:
          'An expected delivery date is required, or a last menstrual period to derive it from.',
      },
    ]);
  }

  /*
   * When the EDD is dated from the LMP, the two must agree: 40 weeks is
   * arithmetic, not a judgement. A scan may re-date, which is why the
   * basis is recorded and any other basis is allowed to disagree.
   */
  if (lmpDate && eddBasis === 'LMP') {
    const derived = deriveEdd(lmpDate);

    if (derived !== eddDate) {
      invalid([
        {
          field: 'eddDate',
          message: `An EDD dated from the LMP must be ${derived} (LMP + 280 days). Set the basis to Ultrasound or Other if the date has been re-dated.`,
        },
      ]);
    }
  }

  if (lmpDate && daysBetween(lmpDate, bookedAt) < 0) {
    invalid([
      {
        field: 'lmpDate',
        message: 'The last menstrual period cannot be after the booking date.',
      },
    ]);
  }

  if (daysBetween(bookedAt, eddDate) < -42) {
    invalid([
      {
        field: 'eddDate',
        message:
          'The expected delivery date is more than six weeks in the past. Check the dating before booking.',
      },
    ]);
  }

  const gravida = collect(
    numberInRange(input.gravida, 'Gravida', 0, 30),
    errors,
  );
  const para = collect(numberInRange(input.para, 'Para', 0, 30), errors);
  const abortions = collect(
    numberInRange(input.abortions, 'Abortions', 0, 30),
    errors,
  );
  const livingChildren = collect(
    numberInRange(input.livingChildren, 'Living children', 0, 30),
    errors,
  );
  const heightCm = collect(
    numberInRange(input.heightCm, 'Height', 50, 250, 'cm'),
    errors,
  );
  const haemoglobinGdl = collect(
    numberInRange(input.haemoglobinGdl, 'Haemoglobin', 2, 25, 'g/dL'),
    errors,
  );

  if (errors.length > 0) invalid(errors);

  if (
    gravida !== null &&
    para !== null &&
    abortions !== null &&
    para + abortions > gravida
  ) {
    invalid([
      {
        field: 'gravida',
        message:
          'Gravida must be at least para plus abortions. The three are recorded together on the antenatal card.',
      },
    ]);
  }

  try {
    const [created] = await db
      .insert(schema.maternityPregnancies)
      .values({
        tenantId: context.tenantId!,
        facilityId,
        patientId: patient.id,
        bookedAt,
        lmpDate,
        eddDate,
        eddBasis,
        gravida,
        para,
        abortions,
        livingChildren,
        heightCm: heightCm === null ? null : String(heightCm),
        bloodGroup: optionalText(input.bloodGroup, 8),
        rhesus: optionalText(input.rhesus, 16),
        haemoglobinGdl:
          haemoglobinGdl === null ? null : String(haemoglobinGdl),
        riskFactors: optionalText(input.riskFactors, 4000),
        status: 'Active',
        createdBy: context.userId,
      })
      .returning();

    return created;
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new MaternityDomainError(
        'PREGNANCY_ALREADY_ACTIVE',
        'This patient already has an active pregnancy record. Close it before booking another.',
        409,
      );
    }

    throw error;
  }
}

export type PregnancyListQuery = {
  facilityId?: number;
  patientId?: number;
  status?: string;
  limit?: number;
};

export async function listPregnancies(
  context: AuthorizationContext,
  query: PregnancyListQuery = {},
) {
  const conditions = [eq(schema.maternityPregnancies.tenantId, context.tenantId!)];

  if (query.facilityId !== undefined) {
    const facilityId = await facilityInScope(context, query.facilityId);
    conditions.push(eq(schema.maternityPregnancies.facilityId, facilityId));
  } else if (context.facilityId) {
    conditions.push(
      eq(schema.maternityPregnancies.facilityId, context.facilityId),
    );
  }

  if (query.patientId !== undefined) {
    const patient = await patientInScope(context, query.patientId);
    conditions.push(eq(schema.maternityPregnancies.patientId, patient.id));
  }

  if (query.status) {
    const status = oneOf(query.status, 'Status', PREGNANCY_STATUSES);

    if (status.error) invalid([status.error]);

    conditions.push(
      eq(schema.maternityPregnancies.status, status.value!),
    );
  }

  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);

  const rows = await db
    .select({
      pregnancy: schema.maternityPregnancies,
      patient: {
        id: schema.patients.id,
        mrn: schema.patients.mrn,
        firstName: schema.patients.firstName,
        lastName: schema.patients.lastName,
        dateOfBirth: schema.patients.dateOfBirth,
      },
    })
    .from(schema.maternityPregnancies)
    .innerJoin(
      schema.patients,
      eq(schema.patients.id, schema.maternityPregnancies.patientId),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.maternityPregnancies.bookedAt))
    .limit(limit);

  const today = new Date().toISOString().slice(0, 10);

  return rows.map((row) => ({
    ...row.pregnancy,
    patient: row.patient,
    gestation: gestationAt(row.pregnancy.eddDate, today),
    weeksToEdd: daysBetween(today, row.pregnancy.eddDate),
  }));
}

export async function getPregnancy(
  context: AuthorizationContext,
  pregnancyId: number,
) {
  const pregnancy = await resolvePregnancy(context, pregnancyId);

  const visits = await db
    .select()
    .from(schema.ancVisits)
    .where(eq(schema.ancVisits.pregnancyId, pregnancy.id))
    .orderBy(desc(schema.ancVisits.visitDate));

  const labours = await db
    .select()
    .from(schema.labourRecords)
    .where(eq(schema.labourRecords.pregnancyId, pregnancy.id))
    .orderBy(desc(schema.labourRecords.admittedAt));

  const deliveryRows = await db
    .select()
    .from(schema.deliveries)
    .where(eq(schema.deliveries.pregnancyId, pregnancy.id))
    .orderBy(desc(schema.deliveries.deliveredAt));

  const babies = deliveryRows.length
    ? await db
        .select()
        .from(schema.deliveryBabies)
        .where(
          inArray(
            schema.deliveryBabies.deliveryId,
            deliveryRows.map((row) => row.id),
          ),
        )
        .orderBy(asc(schema.deliveryBabies.babyNumber))
    : [];

  const today = new Date().toISOString().slice(0, 10);

  return {
    ...pregnancy,
    gestation: gestationAt(pregnancy.eddDate, today),
    ancVisits: visits,
    labours,
    deliveries: deliveryRows.map((delivery) => ({
      ...delivery,
      babies: babies.filter((baby) => baby.deliveryId === delivery.id),
    })),
  };
}

export type UpdatePregnancyInput = {
  status?: string;
  riskFactors?: string | null;
  eddDate?: string;
  eddBasis?: string;
  closedReason?: string | null;
};

export async function updatePregnancy(
  context: AuthorizationContext,
  pregnancyId: number,
  input: UpdatePregnancyInput,
) {
  const pregnancy = await resolvePregnancy(context, pregnancyId);
  const errors: FieldError[] = [];

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) {
    const status = oneOf(input.status, 'Status', PREGNANCY_STATUSES);

    if (status.error) errors.push(status.error);
    else {
      patch.status = status.value;

      if (status.value !== 'Active') {
        patch.closedAt = new Date().toISOString().slice(0, 10);
      }
    }
  }

  if (input.eddDate !== undefined) {
    patch.eddDate = requireIsoDate(input.eddDate, 'Expected delivery date');
  }

  if (input.eddBasis !== undefined) {
    const basis = oneOf(input.eddBasis, 'EDD basis', EDD_BASES);

    if (basis.error) errors.push(basis.error);
    else patch.eddBasis = basis.value;
  }

  if (input.riskFactors !== undefined) {
    patch.riskFactors = optionalText(input.riskFactors, 4000);
  }

  if (input.closedReason !== undefined) {
    patch.closedReason = optionalText(input.closedReason, 500);
  }

  if (errors.length > 0) invalid(errors);

  if (
    patch.status &&
    patch.status !== 'Active' &&
    pregnancy.status === 'Delivered' &&
    patch.status !== 'Delivered'
  ) {
    throw new MaternityDomainError(
      'PREGNANCY_DELIVERED',
      'This pregnancy already has a delivery recorded and cannot be reopened.',
      409,
    );
  }

  try {
    const [updated] = await db
      .update(schema.maternityPregnancies)
      .set(patch)
      .where(eq(schema.maternityPregnancies.id, pregnancy.id))
      .returning();

    return updated;
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new MaternityDomainError(
        'PREGNANCY_ALREADY_ACTIVE',
        'This patient already has an active pregnancy record.',
        409,
      );
    }

    throw error;
  }
}

/* ============================================================
   ANTENATAL VISITS
   ============================================================ */

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

export async function recordAncVisit(
  context: AuthorizationContext,
  input: AncVisitInput,
) {
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

  /*
   * Gestation is computed from the EDD, so the clinician does not have to
   * work it out again at every visit. An explicit value wins: a scan can
   * change the dating, and the card is the record of what was written.
   */
  const computed = gestationAt(pregnancy.eddDate, visitDate);

  const gestationWeeks = collect(
    numberInRange(
      input.gestationWeeks ?? computed?.weeks,
      'Gestation weeks',
      0,
      45,
    ),
    errors,
  );
  const gestationDays = collect(
    numberInRange(
      input.gestationDays ?? computed?.days,
      'Gestation days',
      0,
      6,
    ),
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
    fetalHeartRateBpm: numberInRange(
      input.fetalHeartRateBpm,
      'Fetal heart rate',
      50,
      240,
    ),
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

  const presentation = collect(
    oneOf(input.presentation, 'Presentation', PRESENTATIONS),
    errors,
  );
  const urineProtein = collect(
    oneOf(input.urineProtein, 'Urine protein', URINE_DIPSTICK),
    errors,
  );
  const urineGlucose = collect(
    oneOf(input.urineGlucose, 'Urine glucose', URINE_DIPSTICK),
    errors,
  );

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

function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}

export async function listAncVisits(
  context: AuthorizationContext,
  pregnancyId: number,
) {
  const pregnancy = await resolvePregnancy(context, pregnancyId);

  return db
    .select()
    .from(schema.ancVisits)
    .where(eq(schema.ancVisits.pregnancyId, pregnancy.id))
    .orderBy(desc(schema.ancVisits.visitDate), desc(schema.ancVisits.id));
}

/* ============================================================
   LABOUR
   ============================================================ */

export type StartLabourInput = {
  pregnancyId: number;
  admittedAt: string;
  labourOnsetAt?: string | null;
  membranesRupturedAt?: string | null;
  gestationWeeksAtAdmission?: number;
  notes?: string | null;
  encounterId?: number;
};

export async function startLabour(
  context: AuthorizationContext,
  input: StartLabourInput,
) {
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
  const membranesRupturedAt = optionalTimestamp(
    input.membranesRupturedAt,
    'Membranes ruptured at',
  );

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
        gestationAt(pregnancy.eddDate, admittedAt!.slice(0, 10))?.weeks,
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

export async function getLabour(
  context: AuthorizationContext,
  labourRecordId: number,
) {
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
          entry.cervicalDilatationCm === null
            ? null
            : Number(entry.cervicalDilatationCm),
      })),
    ),
    /*
     * The same readings, positioned for the chart. Computed here rather
     * than in the screen so that the table and the plot cannot disagree
     * about where the alert line sits.
     */
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
      eq(
        schema.labourRecords.facilityId,
        await facilityInScope(context, query.facilityId),
      ),
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
    .innerJoin(
      schema.patients,
      eq(schema.patients.id, schema.labourRecords.patientId),
    )
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
    const status = oneOf(input.status, 'Status', [
      'In Labour',
      'Delivered',
      'Referred',
      'Closed',
    ]);

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

  if (
    labour.status === 'Delivered' &&
    patch.status !== undefined &&
    patch.status !== 'Delivered'
  ) {
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

/* ============================================================
   PARTOGRAPH
   ============================================================ */

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

export async function recordPartographEntry(
  context: AuthorizationContext,
  input: PartographInput,
) {
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
    contractionsPer10Min: numberInRange(
      input.contractionsPer10Min,
      'Contractions',
      0,
      7,
    ),
    contractionDurationSec: numberInRange(
      input.contractionDurationSec,
      'Contraction duration',
      0,
      120,
      'seconds',
    ),
    fetalHeartRateBpm: numberInRange(
      input.fetalHeartRateBpm,
      'Fetal heart rate',
      50,
      240,
    ),
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

/* ============================================================
   DELIVERY
   ============================================================ */

export type DeliveryBabyInput = {
  sex?: string;
  birthWeightGrams?: number;
  apgar1?: number;
  apgar5?: number;
  apgar10?: number;
  outcome: string;
  resuscitation?: string | null;
  notes?: string | null;
};

export type RecordDeliveryInput = {
  pregnancyId: number;
  labourRecordId?: number | null;
  deliveredAt: string;
  deliveryMode: string;
  bloodLossMl?: number;
  perineum?: string;
  placentaComplete?: boolean;
  placentaDeliveredAt?: string | null;
  oxytocinGiven?: boolean;
  complications?: string | null;
  notes?: string | null;
  conductedByCadre?: string | null;
  babies: DeliveryBabyInput[];
};

export async function recordDelivery(
  context: AuthorizationContext,
  input: RecordDeliveryInput,
) {
  const pregnancy = await resolvePregnancy(context, input.pregnancyId);

  if (pregnancy.status === 'Delivered') {
    throw new MaternityDomainError(
      'ALREADY_DELIVERED',
      'This pregnancy already has a delivery recorded.',
      409,
    );
  }

  if (pregnancy.status !== 'Active') {
    throw new MaternityDomainError(
      'PREGNANCY_NOT_ACTIVE',
      `This pregnancy is ${pregnancy.status.toLowerCase()} and cannot be delivered here.`,
      409,
    );
  }

  let labour: Awaited<ReturnType<typeof resolveLabour>> | null = null;

  if (input.labourRecordId !== undefined && input.labourRecordId !== null) {
    labour = await resolveLabour(context, input.labourRecordId);

    if (labour.pregnancyId !== pregnancy.id) {
      throw new MaternityDomainError(
        'LABOUR_PREGNANCY_MISMATCH',
        'The labour record belongs to a different pregnancy.',
        409,
      );
    }
  }

  const errors: FieldError[] = [];

  const deliveredAt = optionalTimestamp(input.deliveredAt, 'Delivery time');

  if (!deliveredAt) {
    errors.push({
      field: 'deliveredAt',
      message: 'The delivery date and time is required.',
    });
  }

  if (labour && deliveredAt && deliveredAt < labour.admittedAt) {
    errors.push({
      field: 'deliveredAt',
      message: 'The delivery cannot be earlier than the labour admission.',
    });
  }

  const deliveryMode = collect(
    oneOf(input.deliveryMode, 'Delivery mode', DELIVERY_MODES),
    errors,
  );

  if (!deliveryMode) {
    errors.push({
      field: 'deliveryMode',
      message: `Delivery mode is required: ${DELIVERY_MODES.join(', ')}.`,
    });
  }

  const checks = {
    bloodLossMl: numberInRange(input.bloodLossMl, 'Blood loss', 0, 10000, 'ml'),
  };

  for (const check of Object.values(checks)) {
    if (check.error) errors.push(check.error);
  }

  const perineum = collect(
    oneOf(input.perineum, 'Perineum', PERINEUM_STATES),
    errors,
  );

  if (!Array.isArray(input.babies) || input.babies.length === 0) {
    errors.push({
      field: 'babies',
      message: 'Every delivery records at least one baby.',
    });
  } else if (input.babies.length > 6) {
    errors.push({
      field: 'babies',
      message: 'Six babies is the limit this record accepts. Split the entry if this is a higher-order multiple.',
    });
  }

  const babyRows = (input.babies ?? []).map((baby, index) => {
    const label = `Baby ${index + 1}`;
    const outcome = oneOf(baby.outcome, `${label} outcome`, BABY_OUTCOMES);

    if (outcome.error) errors.push(outcome.error);

    if (!baby.outcome) {
      errors.push({
        field: 'babies',
        message: `${label} needs an outcome: ${BABY_OUTCOMES.join(', ')}.`,
      });
    }

    const sex = oneOf(
      baby.sex,
      `${label} sex`,
      ['Male', 'Female', 'Ambiguous', 'Not recorded'] as const,
    );

    if (sex.error) errors.push(sex.error);

    const weight = numberInRange(
      baby.birthWeightGrams,
      `${label} birth weight`,
      200,
      8000,
      'g',
    );
    if (weight.error) errors.push(weight.error);

    const apgar1 = numberInRange(baby.apgar1, `${label} Apgar at 1 min`, 0, 10);
    const apgar5 = numberInRange(baby.apgar5, `${label} Apgar at 5 min`, 0, 10);
    const apgar10 = numberInRange(baby.apgar10, `${label} Apgar at 10 min`, 0, 10);

    for (const check of [apgar1, apgar5, apgar10]) {
      if (check.error) errors.push(check.error);
    }

    return {
      babyNumber: index + 1,
      sex: sex.value,
      birthWeightGrams: weight.value,
      apgar1: apgar1.value,
      apgar5: apgar5.value,
      apgar10: apgar10.value,
      outcome: outcome.value!,
      resuscitation: optionalText(baby.resuscitation, 1000),
      notes: optionalText(baby.notes, 2000),
    };
  });

  if (errors.length > 0) invalid(errors);

  const placentaDeliveredAt = optionalTimestamp(
    input.placentaDeliveredAt,
    'Placenta delivered at',
  );

  const result = await db.transaction(async (tx) => {
    const [delivery] = await tx
      .insert(schema.deliveries)
      .values({
        tenantId: context.tenantId!,
        facilityId: pregnancy.facilityId,
        pregnancyId: pregnancy.id,
        labourRecordId: labour?.id ?? null,
        patientId: pregnancy.patientId,
        deliveredAt: deliveredAt!,
        deliveryMode: deliveryMode!,
        bloodLossMl: checks.bloodLossMl.value,
        perineum,
        placentaComplete:
          typeof input.placentaComplete === 'boolean'
            ? input.placentaComplete
            : null,
        placentaDeliveredAt,
        oxytocinGiven: input.oxytocinGiven === true,
        complications: optionalText(input.complications, 2000),
        notes: optionalText(input.notes, 4000),
        deliveredBy: context.userId,
        conductedByCadre: optionalText(input.conductedByCadre, 100),
      })
      .returning();

    const babies = await tx
      .insert(schema.deliveryBabies)
      .values(
        babyRows.map((baby) => ({
          tenantId: context.tenantId!,
          facilityId: pregnancy.facilityId,
          deliveryId: delivery.id,
          babyNumber: baby.babyNumber,
          sex: baby.sex,
          birthWeightGrams: baby.birthWeightGrams,
          apgar1: baby.apgar1,
          apgar5: baby.apgar5,
          apgar10: baby.apgar10,
          outcome: baby.outcome,
          resuscitation: baby.resuscitation,
          notes: baby.notes,
        })),
      )
      .returning();

    const [closed] = await tx
      .update(schema.maternityPregnancies)
      .set({
        status: 'Delivered',
        closedAt: (deliveredAt as string).slice(0, 10),
        updatedAt: new Date(),
      })
      .where(eq(schema.maternityPregnancies.id, pregnancy.id))
      .returning();

    if (labour) {
      await tx
        .update(schema.labourRecords)
        .set({ status: 'Delivered', updatedAt: new Date() })
        .where(eq(schema.labourRecords.id, labour.id));
    }

    return { delivery, babies, pregnancy: closed };
  });

  return result;
}

export async function getDelivery(
  context: AuthorizationContext,
  deliveryId: number,
) {
  const parsed = Number(deliveryId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError(
      'DELIVERY_REQUIRED',
      'A valid deliveryId is required.',
      400,
    );
  }

  const [delivery] = await db
    .select()
    .from(schema.deliveries)
    .where(eq(schema.deliveries.id, parsed))
    .limit(1);

  if (!delivery) notFound('The delivery record');

  const facility = await getFacilityByIdScoped(
    context,
    delivery.facilityId,
  ).catch(() => null);

  if (!facility || facility.tenantId !== delivery.tenantId) {
    notFound('The delivery record');
  }

  const babies = await db
    .select()
    .from(schema.deliveryBabies)
    .where(eq(schema.deliveryBabies.deliveryId, delivery.id))
    .orderBy(asc(schema.deliveryBabies.babyNumber));

  return { ...delivery, babies };
}

export async function listDeliveries(
  context: AuthorizationContext,
  query: {
    facilityId?: number;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
) {
  const conditions = [eq(schema.deliveries.tenantId, context.tenantId!)];

  if (query.facilityId !== undefined) {
    conditions.push(
      eq(
        schema.deliveries.facilityId,
        await facilityInScope(context, query.facilityId),
      ),
    );
  } else if (context.facilityId) {
    conditions.push(eq(schema.deliveries.facilityId, context.facilityId));
  }

  if (query.from) {
    conditions.push(gte(schema.deliveries.deliveredAt, requireIsoDate(query.from, 'From date')));
  }

  if (query.to) {
    conditions.push(
      lte(schema.deliveries.deliveredAt, `${requireIsoDate(query.to, 'To date')}T23:59:59.999Z`),
    );
  }

  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);

  const rows = await db
    .select({
      delivery: schema.deliveries,
      patient: {
        id: schema.patients.id,
        mrn: schema.patients.mrn,
        firstName: schema.patients.firstName,
        lastName: schema.patients.lastName,
      },
    })
    .from(schema.deliveries)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.deliveries.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.deliveries.deliveredAt))
    .limit(limit);

  const ids = rows.map((row) => row.delivery.id);

  const babies = ids.length
    ? await db
        .select()
        .from(schema.deliveryBabies)
        .where(
          inArray(schema.deliveryBabies.deliveryId, ids),
        )
        .orderBy(asc(schema.deliveryBabies.babyNumber))
    : [];

  return rows.map((row) => ({
    ...row.delivery,
    patient: row.patient,
    babies: babies.filter((baby) => baby.deliveryId === row.delivery.id),
  }));
}

/* ============================================================
   SUMMARY
   ============================================================ */

/**
 * Counts for the module header. Every number is a count of rows that
 * exist; nothing is estimated or extrapolated.
 */
export async function maternitySummary(
  context: AuthorizationContext,
  facilityId?: number,
) {
  const scopedFacilityId =
    facilityId !== undefined
      ? await facilityInScope(context, facilityId)
      : context.facilityId;

  if (!scopedFacilityId) {
    throw new MaternityDomainError(
      'FACILITY_REQUIRED',
      'Select a facility to see the maternity summary.',
      400,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.maternityPregnancies)
    .where(
      and(
        eq(schema.maternityPregnancies.facilityId, scopedFacilityId),
        eq(schema.maternityPregnancies.status, 'Active'),
      ),
    );

  const [visitsThisMonth] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.ancVisits)
    .where(
      and(
        eq(schema.ancVisits.facilityId, scopedFacilityId),
        gte(schema.ancVisits.visitDate, monthStart),
      ),
    );

  const [inLabour] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.labourRecords)
    .where(
      and(
        eq(schema.labourRecords.facilityId, scopedFacilityId),
        eq(schema.labourRecords.status, 'In Labour'),
      ),
    );

  const [deliveriesThisMonth] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.deliveries)
    .where(
      and(
        eq(schema.deliveries.facilityId, scopedFacilityId),
        gte(schema.deliveries.deliveredAt, monthStart),
      ),
    );

  const [babiesThisMonth] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.deliveryBabies)
    .innerJoin(
      schema.deliveries,
      eq(schema.deliveries.id, schema.deliveryBabies.deliveryId),
    )
    .where(
      and(
        eq(schema.deliveryBabies.facilityId, scopedFacilityId),
        gte(schema.deliveries.deliveredAt, monthStart),
      ),
    );

  return {
    facilityId: scopedFacilityId,
    asOf: today,
    activePregnancies: active?.count ?? 0,
    ancVisitsThisMonth: visitsThisMonth?.count ?? 0,
    inLabour: inLabour?.count ?? 0,
    deliveriesThisMonth: deliveriesThisMonth?.count ?? 0,
    babiesThisMonth: babiesThisMonth?.count ?? 0,
  };
}
