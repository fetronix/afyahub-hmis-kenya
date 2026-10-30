/**
 * JaliCare HMIS
 * Queries: Laboratory orders, results, verification, radiology, and batch ordering
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { resolveFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { resolveCatalogueTestByName, resolveQueueOrLabScope } from './shared.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

import { getTheatreCaseScoped } from './inpatient.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.laboratory');

// Laboratory
export async function getLabTests(facilityId?: number) {
  try {
    if (facilityId) {
      return await db
        .select()
        .from(schema.labTests)
        .where(and(eq(schema.labTests.facilityId, facilityId), eq(schema.labTests.isActive, true)));
    }
    return await db.select().from(schema.labTests).where(eq(schema.labTests.isActive, true));
  } catch (error) {
    log.error({ err: error }, 'lab_tests.fetch_failed');
    throw new Error('Failed to fetch lab tests catalogue', { cause: error });
  }
}

export async function getLabOrders(
  context: AuthorizationContext,
  facilityId?: number,
  patientId?: number,
) {
  const scopedFacilityId = resolveFacilityScope(context, facilityId);
  const facility = await getFacilityByIdScoped(context, scopedFacilityId);

  if (!facility) {
    throw new Error('Facility not found.');
  }

  const conditions = [
    eq(schema.labOrders.facilityId, facility.id),
    eq(schema.labOrders.tenantId, facility.tenantId),
  ];

  if (patientId !== undefined) {
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new Error('Invalid patient ID.');
    }
    conditions.push(eq(schema.labOrders.patientId, patientId));
  }

  return db
    .select()
    .from(schema.labOrders)
    .where(and(...conditions))
    .orderBy(desc(schema.labOrders.orderedAt));
}

export async function createLabOrder(
  context: AuthorizationContext,
  data: typeof schema.labOrders.$inferInsert,
) {
  const scope = await resolveQueueOrLabScope(context, data);

  try {
    const res = await db
      .insert(schema.labOrders)
      .values({ ...data, ...scope })
      .returning();

    const order = res[0];

    if (!order) return order;

    /*
     * The catalogue code is not a column on `lab_orders`; read it from the
     * test the order points at so the caller can bill against `LAB-CBC`
     * rather than only against the long name.
     */
    let testCode: string | null = null;

    /*
     * A single order may also arrive as free text. Resolve it the same
     * way the batch does, so both routes produce a billable identity.
     */
    if (
      (!Number.isSafeInteger(order.testId) || (order.testId ?? 0) <= 0) &&
      typeof order.testName === 'string'
    ) {
      const resolution = await resolveCatalogueTestByName(db, order.facilityId, order.testName);

      if (resolution.test) {
        const [updated] = await db
          .update(schema.labOrders)
          .set({ testId: resolution.test.id, testName: resolution.test.name })
          .where(eq(schema.labOrders.id, order.id))
          .returning();

        if (updated) {
          return {
            ...updated,
            testCode: resolution.test.code,
            catalogueMatch: 'FOUND' as const,
          };
        }
      }
    }

    if (Number.isSafeInteger(order.testId) && (order.testId ?? 0) > 0) {
      const [test] = await db
        .select({ code: schema.labTests.code })
        .from(schema.labTests)
        .where(
          and(
            eq(schema.labTests.id, order.testId as number),
            eq(schema.labTests.facilityId, order.facilityId),
          ),
        )
        .limit(1);

      testCode = test?.code ?? null;
    }

    return { ...order, testCode };
  } catch (error) {
    log.error({ err: error }, 'lab_order.create_failed');
    throw new Error('Failed to order lab test', { cause: error });
  }
}

export async function updateLabOrderStatus(
  context: AuthorizationContext,
  id: number,
  status: string,
  accessionNumber?: string,
) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid laboratory order ID.');
  }

  // This endpoint handles collection workflow only; it cannot publish results.
  if (status !== 'Ordered' && status !== 'Sample Collected') {
    throw new Error('Unsupported laboratory order status.');
  }

  const found = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, id))
    .limit(1);

  const order = found[0];
  if (!order) {
    throw new Error('Laboratory order not found.');
  }

  const facility = await getFacilityByIdScoped(context, order.facilityId);
  if (!facility || facility.tenantId !== order.tenantId) {
    throw new Error('Laboratory order not found in the authorized facility.');
  }

  const updateData: {
    status: string;
    sampleCollectedAt?: Date;
    sampleAccessionNumber?: string;
  } = { status };

  if (status === 'Sample Collected') {
    updateData.sampleCollectedAt = new Date();
    updateData.sampleAccessionNumber =
      accessionNumber?.trim() || `ACC-${Date.now().toString().slice(-6)}`;
  }

  const updated = await db
    .update(schema.labOrders)
    .set(updateData)
    .where(
      and(
        eq(schema.labOrders.id, id),
        eq(schema.labOrders.facilityId, facility.id),
        eq(schema.labOrders.tenantId, facility.tenantId),
      ),
    )
    .returning();

  if (!updated[0]) {
    throw new Error('Laboratory order could not be updated.');
  }

  return updated[0];
}

export async function getLabResults(
  context: AuthorizationContext,
  orderId?: number,
  patientId?: number,
  facilityId?: number,
) {
  if (orderId !== undefined) {
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new Error('Invalid laboratory order ID.');
    }

    const found = await db
      .select()
      .from(schema.labOrders)
      .where(eq(schema.labOrders.id, orderId))
      .limit(1);

    const order = found[0];
    if (!order) {
      throw new Error('Laboratory order not found.');
    }

    const facility = await getFacilityByIdScoped(context, order.facilityId);
    if (!facility || facility.tenantId !== order.tenantId) {
      throw new Error('Laboratory order not found in the authorized facility.');
    }

    if (patientId !== undefined && patientId !== order.patientId) {
      throw new Error('Patient does not match the selected laboratory order.');
    }

    return db
      .select()
      .from(schema.labResults)
      .where(
        and(
          eq(schema.labResults.orderId, order.id),
          eq(schema.labResults.patientId, order.patientId),
        ),
      )
      .orderBy(desc(schema.labResults.verifiedAt));
  }

  // Listing results without an order is still limited to the authorized facility.
  const scopedFacilityId = resolveFacilityScope(context, facilityId);
  const facility = await getFacilityByIdScoped(context, scopedFacilityId);

  if (!facility) {
    throw new Error('Facility not found.');
  }

  const orders = await db
    .select({ id: schema.labOrders.id })
    .from(schema.labOrders)
    .where(
      and(
        eq(schema.labOrders.facilityId, facility.id),
        eq(schema.labOrders.tenantId, facility.tenantId),
        ...(patientId !== undefined ? [eq(schema.labOrders.patientId, patientId)] : []),
      ),
    );

  if (orders.length === 0) {
    return [];
  }

  return db
    .select()
    .from(schema.labResults)
    .where(
      inArray(
        schema.labResults.orderId,
        orders.map((order) => order.id),
      ),
    )
    .orderBy(desc(schema.labResults.verifiedAt));
}

export async function addLabResult(
  context: AuthorizationContext,
  data: typeof schema.labResults.$inferInsert,
) {
  if (!Number.isInteger(data.orderId) || data.orderId <= 0) {
    throw new Error('Valid laboratory order ID is required.');
  }

  const found = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, data.orderId))
    .limit(1);

  const order = found[0];
  if (!order) {
    throw new Error('Laboratory order not found.');
  }

  const facility = await getFacilityByIdScoped(context, order.facilityId);
  if (!facility || facility.tenantId !== order.tenantId) {
    throw new Error('Laboratory order not found in the authorized facility.');
  }

  if (data.patientId !== order.patientId) {
    throw new Error('Result patient must match the laboratory order patient.');
  }

  if (
    typeof data.parameterName !== 'string' ||
    !data.parameterName.trim() ||
    typeof data.measuredValue !== 'string' ||
    !data.measuredValue.trim()
  ) {
    throw new Error('Parameter name and measured value are required.');
  }

  const inserted = await db
    .insert(schema.labResults)
    .values({
      ...data,
      parameterName: data.parameterName.trim(),
      measuredValue: data.measuredValue.trim(),
      status: 'Pending Verification',
      verifiedBy: null,
      verifiedAt: null,
    })
    .returning();

  return inserted[0];
}

export async function verifyLabResult(
  context: AuthorizationContext,
  resultId: number,
  verifiedBy: string,
) {
  if (!Number.isInteger(resultId) || resultId <= 0) {
    throw new Error('Invalid laboratory result ID.');
  }

  if (!verifiedBy.trim()) {
    throw new Error('Verifier identity is required.');
  }

  const found = await db
    .select()
    .from(schema.labResults)
    .where(eq(schema.labResults.id, resultId))
    .limit(1);

  const result = found[0];
  if (!result) {
    throw new Error('Laboratory result not found.');
  }

  const orderRows = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, result.orderId))
    .limit(1);

  const order = orderRows[0];
  if (!order || order.patientId !== result.patientId) {
    throw new Error('Laboratory result does not match its order patient.');
  }

  const facility = await getFacilityByIdScoped(context, order.facilityId);
  if (!facility || facility.tenantId !== order.tenantId) {
    throw new Error('Laboratory result not found in the authorized facility.');
  }

  if (result.status === 'Verified' || result.verifiedAt || result.verifiedBy) {
    throw new Error('This laboratory result has already been verified.');
  }

  const updated = await db
    .update(schema.labResults)
    .set({
      status: 'Verified',
      verifiedBy: verifiedBy.trim(),
      verifiedAt: new Date(),
    })
    .where(
      and(
        eq(schema.labResults.id, resultId),
        eq(schema.labResults.orderId, order.id),
        eq(schema.labResults.patientId, order.patientId),
        // Rechecked after the row lock: concurrent verifiers cannot overwrite the first stamp.
        sql`${schema.labResults.status} IS DISTINCT FROM 'Verified'`,
        isNull(schema.labResults.verifiedBy),
        isNull(schema.labResults.verifiedAt),
      ),
    )
    .returning();

  if (!updated[0]) {
    throw new Error('Laboratory result is already verified or requires review.');
  }

  return updated[0];
}

// Radiology
export async function getRadiologyOrders(facilityId?: number, patientId?: number) {
  try {
    const query = db.select().from(schema.radiologyOrders);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.radiologyOrders.facilityId, facilityId));
    if (patientId) conditions.push(eq(schema.radiologyOrders.patientId, patientId));

    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(desc(schema.radiologyOrders.createdAt));
    }
    return await query.orderBy(desc(schema.radiologyOrders.createdAt));
  } catch (error) {
    log.error({ err: error }, 'radiology_orders.fetch_failed');
    throw new Error('Failed to fetch imaging requests', { cause: error });
  }
}

/**
 * Read one radiology order inside a facility, for the same reason as
 * `getTheatreCaseScoped`: reporting a study is a facility-bound act.
 */
export async function getRadiologyOrderScoped(id: number, facilityId: number) {
  const [row] = await db
    .select()
    .from(schema.radiologyOrders)
    .where(
      and(eq(schema.radiologyOrders.id, id), eq(schema.radiologyOrders.facilityId, facilityId)),
    )
    .limit(1);

  return row ?? null;
}

export async function createRadiologyOrder(data: typeof schema.radiologyOrders.$inferInsert) {
  try {
    const res = await db.insert(schema.radiologyOrders).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'radiology_order.create_failed');
    throw new Error('Failed to create radiology order', { cause: error });
  }
}

export async function updateRadiologyReport(
  id: number,
  findings: string | undefined,
  impression: string | undefined,
  reportedBy: string,
) {
  try {
    const res = await db
      .update(schema.radiologyOrders)
      .set({
        status: 'Reported',
        radiologistFindings: findings,
        impression,
        reportedBy,
        reportedAt: new Date(),
      })
      .where(eq(schema.radiologyOrders.id, id))
      .returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'radiology_report.save_failed');
    throw new Error('Failed to save radiology findings', { cause: error });
  }
}

/**
 * Creates a laboratory batch and its queue entry atomically.
 * Duplicate test IDs within one request are rejected.
 */
export async function createLabOrderBatch(
  context: AuthorizationContext,
  data: {
    encounterId: number;
    patientId: number;
    investigations?: string[];
    testIds?: number[];
    clinicalIndication: string;
    specimenType: string;
    priority: string;
    clinicalNotes?: string;
    orderedBy?: string;
  },
) {
  const priority = data.priority;
  const allowedPriorities = ['Routine', 'Urgent', 'STAT'];

  if (!allowedPriorities.includes(priority)) {
    throw new Error('Invalid laboratory priority.');
  }
  if (!data.clinicalIndication?.trim()) {
    throw new Error('Clinical indication is required.');
  }
  if (!data.specimenType?.trim()) {
    throw new Error('Specimen type is required.');
  }
  if (
    data.clinicalIndication.length > 2000 ||
    data.specimenType.length > 120 ||
    (data.clinicalNotes?.length ?? 0) > 5000
  ) {
    throw new Error('Clinical text exceeds the permitted length.');
  }

  const freeTextProvided = data.investigations !== undefined;
  if (freeTextProvided && !Array.isArray(data.investigations)) {
    throw new Error('Invalid laboratory investigations.');
  }

  const investigations: string[] = [];
  if (freeTextProvided) {
    const seen = new Set<string>();
    for (const value of data.investigations!) {
      if (typeof value !== 'string') {
        throw new Error('Invalid laboratory investigation name.');
      }
      const name = value.trim();
      if (!name) continue;
      if (name.length > 200) {
        throw new Error('Each investigation name must be 200 characters or fewer.');
      }
      const key = name.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        investigations.push(name);
      }
    }
    if (investigations.length > 100) {
      throw new Error('Enter no more than 100 laboratory investigations.');
    }
  }

  const testIds = data.testIds ?? [];
  if (!freeTextProvided) {
    if (!Array.isArray(testIds) || testIds.length === 0) {
      throw new Error('Enter at least one laboratory investigation.');
    }
    if (testIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error('One or more laboratory test IDs are invalid.');
    }
    if (new Set(testIds).size !== testIds.length) {
      throw new Error('Duplicate tests are not allowed in one submission.');
    }
  } else if (investigations.length === 0) {
    throw new Error('Enter at least one laboratory investigation.');
  }

  const scope = await resolveQueueOrLabScope(context, {
    encounterId: data.encounterId,
    patientId: data.patientId,
  });

  try {
    return await db.transaction(async (tx) => {
      const tests: Array<{
        id: number | null;
        name: string;
        code: string | null;
        match?: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS';
      }> = [];

      if (freeTextProvided) {
        /*
         * Free text is what the outpatient screen sends. Resolve each
         * name against this facility's own laboratory catalogue so the
         * order carries a stable `test_id` — without it a tariff link
         * has nothing to point at, which is why these orders billed
         * nothing even after the catalogue was priced.
         *
         * Unresolved names still create the order: a clinician's request
         * is never held up because a catalogue entry is missing. They
         * are reported back so the requirement is visible.
         */
        for (const name of investigations) {
          const resolution = await resolveCatalogueTestByName(tx, scope.facilityId, name);

          tests.push({
            id: resolution.test?.id ?? null,
            name: resolution.test?.name ?? name,
            code: resolution.test?.code ?? null,
            match: resolution.reason,
          });
        }
      } else {
        for (const testId of testIds) {
          const [test] = await tx
            .select()
            .from(schema.labTests)
            .where(
              and(
                eq(schema.labTests.id, testId),
                eq(schema.labTests.facilityId, scope.facilityId),
                eq(schema.labTests.isActive, true),
              ),
            )
            .limit(1);

          if (!test) {
            throw new Error('A selected test is unavailable at this facility.');
          }
          /*
           * Carry the catalogue code. The billing engine tries it first:
           * `LAB-CBC` is what the laboratory screen shows and what a
           * facility prices, and before this only the long test name was
           * used, so a priced catalogue still billed nothing.
           */
          tests.push({ id: test.id, name: test.name, code: test.code ?? null, match: 'FOUND' });
        }
      }

      const [queue] = await tx
        .insert(schema.queues)
        .values({
          ...scope,
          queueType: 'Laboratory',
          tokenNumber: `LAB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          priority,
          status: 'Waiting',
          waitingTimeMinutes: 0,
        })
        .returning();

      if (!queue) {
        throw new Error('Laboratory queue entry could not be created.');
      }

      const orders = [];
      for (const test of tests) {
        const [order] = await tx
          .insert(schema.labOrders)
          .values({
            ...scope,
            testId: test.id,
            testName: test.name,
            status: 'Ordered',
            orderedBy: data.orderedBy?.trim() || null,
            clinicalIndication: data.clinicalIndication.trim(),
            specimenType: data.specimenType.trim(),
            priority,
            clinicalNotes: data.clinicalNotes?.trim() || null,
          })
          .returning();

        if (!order) {
          throw new Error('A laboratory order could not be created.');
        }

        orders.push({
          ...order,
          testCode: test.code,
          catalogueMatch: test.match ?? 'FOUND',
        });
      }

      /*
       * What the catalogue could not resolve, by name. The order exists
       * and is routed; the charge for it will be recorded as unpriced
       * with this reason, so an administrator can add the catalogue
       * entry rather than guess which order was missed.
       */
      const unresolved = tests
        .filter((test) => test.id === null && test.match !== undefined)
        .map((test) => test.name);

      const ambiguous = tests.filter((test) => test.match === 'AMBIGUOUS').map((test) => test.name);

      return { orders, queue, unresolved, ambiguous };
    });
  } catch (error) {
    log.error({ err: error }, 'lab.batch_transaction_failed');
    throw error;
  }
}
