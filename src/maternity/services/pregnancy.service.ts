import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  EDD_BASES,
  PREGNANCY_STATUSES,
  daysBetween,
  deriveEdd,
  gestationAt,
  numberInRange,
  oneOf,
  type FieldError,
} from '../maternity-contracts.ts';
import {
  MaternityDomainError,
  collect,
  facilityInScope,
  invalid,
  optionalIsoDate,
  optionalText,
  patientInScope,
  requireIsoDate,
  resolvePregnancy,
  uniqueViolation,
} from './shared.ts';

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

export async function bookPregnancy(context: AuthorizationContext, input: BookPregnancyInput) {
  const patient = await patientInScope(context, input.patientId);
  const facilityId = await facilityInScope(context, input.facilityId);

  const errors: FieldError[] = [];

  const bookedAt = requireIsoDate(input.bookedAt, 'Booked date');
  const lmpDate = optionalIsoDate(input.lmpDate, 'Last menstrual period');
  const eddBasis = collect(oneOf(input.eddBasis ?? 'LMP', 'EDD basis', EDD_BASES), errors) ?? 'LMP';

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

  const gravida = collect(numberInRange(input.gravida, 'Gravida', 0, 30), errors);
  const para = collect(numberInRange(input.para, 'Para', 0, 30), errors);
  const abortions = collect(numberInRange(input.abortions, 'Abortions', 0, 30), errors);
  const livingChildren = collect(
    numberInRange(input.livingChildren, 'Living children', 0, 30),
    errors,
  );
  const heightCm = collect(numberInRange(input.heightCm, 'Height', 50, 250, 'cm'), errors);
  const haemoglobinGdl = collect(
    numberInRange(input.haemoglobinGdl, 'Haemoglobin', 2, 25, 'g/dL'),
    errors,
  );

  if (errors.length > 0) invalid(errors);

  if (gravida !== null && para !== null && abortions !== null && para + abortions > gravida) {
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
        haemoglobinGdl: haemoglobinGdl === null ? null : String(haemoglobinGdl),
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
    conditions.push(eq(schema.maternityPregnancies.facilityId, context.facilityId));
  }

  if (query.patientId !== undefined) {
    const patient = await patientInScope(context, query.patientId);
    conditions.push(eq(schema.maternityPregnancies.patientId, patient.id));
  }

  if (query.status) {
    const status = oneOf(query.status, 'Status', PREGNANCY_STATUSES);

    if (status.error) invalid([status.error]);

    conditions.push(eq(schema.maternityPregnancies.status, status.value!));
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
    .innerJoin(schema.patients, eq(schema.patients.id, schema.maternityPregnancies.patientId))
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

export async function getPregnancy(context: AuthorizationContext, pregnancyId: number) {
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
