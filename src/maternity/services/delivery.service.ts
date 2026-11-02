import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db } from '../../db/index.ts';
import { recordChargeAttempt } from '../../billing/charge-attempts.ts';
import { deliveryChargeRequest } from '../../billing/service-charges.ts';
import { getFacilityByIdScoped } from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import {
  BABY_OUTCOMES,
  DELIVERY_MODES,
  PERINEUM_STATES,
  numberInRange,
  oneOf,
  type FieldError,
} from '../maternity-contracts.ts';
import {
  MaternityDomainError,
  collect,
  facilityInScope,
  invalid,
  notFound,
  optionalText,
  optionalTimestamp,
  requireIsoDate,
  resolveLabour,
  resolvePregnancy,
} from './shared.ts';

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
  facilityServiceId?: number | null;
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

export async function recordDelivery(context: AuthorizationContext, input: RecordDeliveryInput) {
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

  const deliveryMode = collect(oneOf(input.deliveryMode, 'Delivery mode', DELIVERY_MODES), errors);

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

  const perineum = collect(oneOf(input.perineum, 'Perineum', PERINEUM_STATES), errors);

  if (!Array.isArray(input.babies) || input.babies.length === 0) {
    errors.push({
      field: 'babies',
      message: 'Every delivery records at least one baby.',
    });
  } else if (input.babies.length > 6) {
    errors.push({
      field: 'babies',
      message:
        'Six babies is the limit this record accepts. Split the entry if this is a higher-order multiple.',
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

    const sex = oneOf(baby.sex, `${label} sex`, [
      'Male',
      'Female',
      'Ambiguous',
      'Not recorded',
    ] as const);

    if (sex.error) errors.push(sex.error);

    const weight = numberInRange(baby.birthWeightGrams, `${label} birth weight`, 200, 8000, 'g');
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

  const placentaDeliveredAt = optionalTimestamp(input.placentaDeliveredAt, 'Placenta delivered at');

  const result = await db.transaction(async (tx) => {
    // Concurrent submissions must not record two deliveries for the same
    // pregnancy after both observed its earlier Active state.
    const [lockedPregnancy] = await tx
      .select({ status: schema.maternityPregnancies.status })
      .from(schema.maternityPregnancies)
      .where(
        and(
          eq(schema.maternityPregnancies.id, pregnancy.id),
          eq(schema.maternityPregnancies.tenantId, context.tenantId!),
          eq(schema.maternityPregnancies.facilityId, pregnancy.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!lockedPregnancy || lockedPregnancy.status !== 'Active')
      throw new MaternityDomainError(
        'PREGNANCY_NOT_ACTIVE',
        'This pregnancy is no longer active.',
        409,
      );
    // This is an optional, explicit clinical selection. Never derive delivery
    // prices from mode or silently attach a service to a historical record.
    if (input.facilityServiceId !== undefined && input.facilityServiceId !== null) {
      if (!Number.isSafeInteger(input.facilityServiceId) || input.facilityServiceId <= 0)
        throw new MaternityDomainError(
          'INVALID_DELIVERY_SERVICE',
          'Choose a valid delivery service.',
          400,
        );
      const [service] = await tx
        .select({ id: schema.facilityServices.id })
        .from(schema.facilityServices)
        .where(
          and(
            eq(schema.facilityServices.id, input.facilityServiceId),
            eq(schema.facilityServices.tenantId, context.tenantId!),
            eq(schema.facilityServices.facilityId, pregnancy.facilityId),
            eq(schema.facilityServices.category, 'DELIVERY'),
            eq(schema.facilityServices.isActive, true),
          ),
        )
        .limit(1)
        .for('share');
      if (!service)
        throw new MaternityDomainError(
          'INVALID_DELIVERY_SERVICE',
          'The selected delivery service is unavailable in this facility.',
          400,
        );
    }
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
        facilityServiceId: input.facilityServiceId ?? null,
        bloodLossMl: checks.bloodLossMl.value,
        perineum,
        placentaComplete:
          typeof input.placentaComplete === 'boolean' ? input.placentaComplete : null,
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

    const attempt = await recordChargeAttempt(tx, deliveryChargeRequest(delivery), {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      message: 'Delivery recorded; billing evaluation pending.',
    });
    if (attempt === null) throw new Error('DELIVERY_BILLING_QUEUE_UNAVAILABLE');
    return { delivery, babies, pregnancy: closed };
  });

  return result;
}

export async function getDelivery(context: AuthorizationContext, deliveryId: number) {
  const parsed = Number(deliveryId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError('DELIVERY_REQUIRED', 'A valid deliveryId is required.', 400);
  }

  const [delivery] = await db
    .select()
    .from(schema.deliveries)
    .where(eq(schema.deliveries.id, parsed))
    .limit(1);

  if (!delivery) notFound('The delivery record');

  const facility = await getFacilityByIdScoped(context, delivery.facilityId).catch(() => null);

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
      eq(schema.deliveries.facilityId, await facilityInScope(context, query.facilityId)),
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
        .where(inArray(schema.deliveryBabies.deliveryId, ids))
        .orderBy(asc(schema.deliveryBabies.babyNumber))
    : [];

  return rows.map((row) => ({
    ...row.delivery,
    patient: row.patient,
    babies: babies.filter((baby) => baby.deliveryId === row.delivery.id),
  }));
}

export async function maternitySummary(context: AuthorizationContext, facilityId?: number) {
  const scopedFacilityId =
    facilityId !== undefined ? await facilityInScope(context, facilityId) : context.facilityId;

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
    .innerJoin(schema.deliveries, eq(schema.deliveries.id, schema.deliveryBabies.deliveryId))
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
