/**
 * JaliCare HMIS
 * Queries: Laboratory orders, results, verification, radiology, and batch ordering
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { resolveFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { LaboratoryDomainError } from '../../clinical/laboratory-contracts.ts';
import { recordChargeAttempt } from '../../billing/charge-attempts.ts';
import { labOrderChargeRequest, radiologyChargeRequest } from '../../billing/service-charges.ts';

import { resolveQueueOrLabScope } from './shared.ts';

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
    .select({
      ...getTableColumns(schema.labOrders),
      specimenId: sql<
        number | null
      >`(SELECT specimen_id FROM lab_specimen_orders WHERE order_id = "lab_orders"."id")`,
    })
    .from(schema.labOrders)
    .where(and(...conditions))
    .orderBy(desc(schema.labOrders.orderedAt));
}

export async function createLabOrder(
  context: AuthorizationContext,
  data: typeof schema.labOrders.$inferInsert & { specimenOptionId?: number },
) {
  const scope = await resolveQueueOrLabScope(context, data);
  const { specimenOptionId, ...orderData } = data;
  try {
    return await db.transaction(async (tx) => {
      let canonicalName = data.testName;
      let testCode: string | null = null;
      let reviewedSpecimen: string | null = null;
      if (data.testId != null) {
        const [test] = await tx
          .select({ name: schema.labTests.name, code: schema.labTests.code })
          .from(schema.labTests)
          .where(
            and(
              eq(schema.labTests.id, data.testId),
              eq(schema.labTests.facilityId, scope.facilityId),
              eq(schema.labTests.isActive, true),
            ),
          )
          .limit(1)
          .for('share');
        if (!test)
          throw new LaboratoryDomainError(
            'TEST_NOT_AVAILABLE',
            'The selected investigation is not available in this facility.',
            400,
          );
        canonicalName = test.name;
        testCode = test.code;
      }
      if (specimenOptionId !== undefined) {
        if (!Number.isSafeInteger(specimenOptionId) || specimenOptionId <= 0 || !data.testId)
          throw new LaboratoryDomainError(
            'SPECIMEN_NOT_REVIEWED',
            'Select a reviewed specimen for an available test.',
            400,
          );
        const [option] = await tx
          .select({ specimenType: schema.labTestSpecimenOptions.specimenType })
          .from(schema.labTestSpecimenOptions)
          .where(
            and(
              eq(schema.labTestSpecimenOptions.id, specimenOptionId),
              eq(schema.labTestSpecimenOptions.testId, data.testId),
              eq(schema.labTestSpecimenOptions.tenantId, scope.tenantId),
              eq(schema.labTestSpecimenOptions.facilityId, scope.facilityId),
              isNull(schema.labTestSpecimenOptions.retiredAt),
            ),
          )
          .limit(1)
          .for('share');
        if (
          !option ||
          (data.specimenType?.trim() &&
            data.specimenType.trim().toLowerCase() !== option.specimenType.trim().toLowerCase())
        )
          throw new LaboratoryDomainError(
            'SPECIMEN_NOT_REVIEWED',
            'The specimen is unavailable, mismatched or not reviewed for this test.',
            400,
          );
        reviewedSpecimen = option.specimenType;
      }
      // Legacy requests remain clinically available, but neither a test ID nor
      // free text is proof that the specimen was clinically reviewed.
      const clinicalException =
        !data.testId || !reviewedSpecimen || data.clinicalException === true;
      const [order] = await tx
        .insert(schema.labOrders)
        .values({
          ...orderData,
          ...scope,
          testName: canonicalName,
          specimenType: reviewedSpecimen ?? data.specimenType ?? null,
          reviewedSpecimenOptionId: reviewedSpecimen ? specimenOptionId : null,
          clinicalException,
        })
        .returning();
      await tx.insert(schema.auditLogs).values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        userId: String(context.userId),
        action: 'CREATE',
        resource: 'LAB_ORDER_REQUEST',
        resourceId: String(order.id),
        details: JSON.stringify({
          testId: order.testId,
          reviewedSpecimenOptionId: order.reviewedSpecimenOptionId,
          clinicalException,
        }),
      });
      return {
        ...order,
        testCode,
        catalogueMatch: clinicalException ? ('REVIEW_REQUIRED' as const) : ('FOUND' as const),
      };
    });
  } catch (error) {
    if (error instanceof LaboratoryDomainError) throw error;
    log.error('lab_order.create_failed');
    throw new Error('Failed to order lab test', { cause: error });
  }
}

/** Collection is an explicit action. A retry returns the existing accession. */
export async function updateLabOrderStatus(
  context: AuthorizationContext,
  id: number,
  status: string,
  accessionNumber?: string,
  sharedOrderId?: number,
) {
  if (!Number.isSafeInteger(id) || id <= 0 || !['Ordered', 'Sample Collected'].includes(status)) {
    throw new LaboratoryDomainError(
      'LAB_INVALID_INPUT',
      'A valid collection request is required.',
      400,
    );
  }
  const [found] = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, id))
    .limit(1);
  if (!found)
    throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
  const facility = await getFacilityByIdScoped(context, found.facilityId);
  if (!facility || facility.tenantId !== found.tenantId) {
    throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
  }
  try {
    return await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(schema.labOrders)
        .where(
          and(
            eq(schema.labOrders.id, id),
            eq(schema.labOrders.tenantId, facility.tenantId),
            eq(schema.labOrders.facilityId, facility.id),
          ),
        )
        .limit(1)
        .for('update');
      if (!order)
        throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
      const accession = accessionNumber?.trim();
      if (
        status === 'Ordered' &&
        order.status === 'Ordered' &&
        !order.sampleCollectedAt &&
        !order.sampleAccessionNumber
      ) {
        return order;
      }
      if (
        status === 'Sample Collected' &&
        order.status === 'Sample Collected' &&
        order.sampleCollectedAt &&
        order.sampleAccessionNumber
      ) {
        if (
          accession &&
          accession.toLowerCase() !== order.sampleAccessionNumber.trim().toLowerCase()
        ) {
          throw new LaboratoryDomainError(
            'LAB_ACCESSION_CHANGE_REQUIRES_REVIEW',
            'Changing a recorded accession requires an authorized correction workflow.',
            409,
          );
        }
        if (sharedOrderId !== undefined) {
          const links = await tx
            .select({
              specimenId: schema.labSpecimenOrders.specimenId,
              orderId: schema.labSpecimenOrders.orderId,
            })
            .from(schema.labSpecimenOrders)
            .where(inArray(schema.labSpecimenOrders.orderId, [id, sharedOrderId]));
          if (links.length !== 2 || links[0].specimenId !== links[1].specimenId) {
            throw new LaboratoryDomainError(
              'LAB_ACCESSION_CHANGE_REQUIRES_REVIEW',
              'Changing a recorded specimen requires an authorized correction workflow.',
              409,
            );
          }
        }
        return order;
      }
      if (
        status !== 'Sample Collected' ||
        order.status !== 'Ordered' ||
        order.sampleCollectedAt ||
        order.sampleAccessionNumber
      ) {
        throw new LaboratoryDomainError(
          'LAB_STATE_CONFLICT',
          'The laboratory order is not available for collection; review its existing state.',
          409,
        );
      }
      let specimen: typeof schema.labSpecimens.$inferSelect;
      if (sharedOrderId !== undefined) {
        if (!Number.isSafeInteger(sharedOrderId) || sharedOrderId <= 0 || sharedOrderId === id) {
          throw new LaboratoryDomainError(
            'LAB_SHARED_SPECIMEN_INVALID',
            'Select a different collected specimen order.',
            400,
          );
        }
        const [shared] = await tx
          .select({ specimen: schema.labSpecimens, source: schema.labOrders })
          .from(schema.labSpecimenOrders)
          .innerJoin(
            schema.labSpecimens,
            eq(schema.labSpecimens.id, schema.labSpecimenOrders.specimenId),
          )
          .innerJoin(schema.labOrders, eq(schema.labOrders.id, schema.labSpecimenOrders.orderId))
          .where(eq(schema.labSpecimenOrders.orderId, sharedOrderId))
          .limit(1);
        if (
          !shared ||
          shared.specimen.tenantId !== facility.tenantId ||
          shared.specimen.facilityId !== facility.id ||
          shared.specimen.patientId !== order.patientId ||
          shared.source.tenantId !== facility.tenantId ||
          shared.source.facilityId !== facility.id ||
          shared.source.patientId !== order.patientId ||
          shared.source.status !== 'Sample Collected' ||
          !shared.source.sampleCollectedAt ||
          shared.source.sampleAccessionNumber?.trim().toLowerCase() !==
            shared.specimen.accessionNumber.trim().toLowerCase() ||
          !order.specimenType?.trim() ||
          !shared.source.specimenType?.trim() ||
          order.specimenType.trim().toLowerCase() !==
            shared.source.specimenType.trim().toLowerCase() ||
          (accession &&
            accession.toLowerCase() !== shared.specimen.accessionNumber.trim().toLowerCase())
        ) {
          throw new LaboratoryDomainError(
            'LAB_SHARED_SPECIMEN_REVIEW',
            'The selected specimen is unavailable or requires laboratory review.',
            409,
          );
        }
        specimen = shared.specimen;
      } else {
        [specimen] = await tx
          .insert(schema.labSpecimens)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            patientId: order.patientId,
            accessionNumber: accession || `JC-${randomUUID()}`,
            collectedAt: new Date(),
            collectedByUserId: context.userId,
          })
          .returning();
      }
      // Link first so the database guard can recognize an explicitly shared specimen.
      await tx.insert(schema.labSpecimenOrders).values({ specimenId: specimen.id, orderId: id });
      const [updated] = await tx
        .update(schema.labOrders)
        .set({
          status: 'Sample Collected',
          sampleCollectedAt: specimen.collectedAt,
          sampleAccessionNumber: specimen.accessionNumber,
        })
        .where(eq(schema.labOrders.id, id))
        .returning();
      await tx.insert(schema.auditLogs).values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        userId: String(context.userId),
        action: 'UPDATE',
        resource: 'LabOrder',
        resourceId: String(id),
        details:
          sharedOrderId === undefined
            ? 'Specimen collection recorded.'
            : 'Order linked to an existing collected specimen.',
      });
      return updated;
    });
  } catch (error) {
    let cause: unknown = error;
    for (let i = 0; i < 5 && cause && typeof cause === 'object'; i++) {
      const info = cause as { code?: string; constraint?: string; cause?: unknown };
      if (
        info.code === '23505' &&
        [
          'lab_orders_facility_accession_uq',
          'lab_orders_accession_identity_guard',
          'lab_specimens_facility_accession_uq',
        ].includes(info.constraint ?? '')
      ) {
        throw new LaboratoryDomainError(
          'LAB_ACCESSION_IN_USE',
          'That accession is already assigned within this facility.',
          409,
        );
      }
      cause = info.cause;
    }
    throw error;
  }
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
  if (
    !Number.isSafeInteger(data.orderId) ||
    data.orderId <= 0 ||
    typeof data.parameterName !== 'string' ||
    !data.parameterName.trim() ||
    typeof data.measuredValue !== 'string' ||
    !data.measuredValue.trim()
  ) {
    throw new LaboratoryDomainError(
      'LAB_INVALID_INPUT',
      'Order, parameter and measured value are required.',
      400,
    );
  }
  const [found] = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, data.orderId))
    .limit(1);
  if (!found)
    throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
  const facility = await getFacilityByIdScoped(context, found.facilityId);
  if (!facility || facility.tenantId !== found.tenantId) {
    throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
  }
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.labOrders)
      .where(
        and(
          eq(schema.labOrders.id, data.orderId),
          eq(schema.labOrders.tenantId, facility.tenantId),
          eq(schema.labOrders.facilityId, facility.id),
        ),
      )
      .limit(1)
      .for('update');
    if (!order || data.patientId !== order.patientId) {
      throw new LaboratoryDomainError(
        'LAB_ORDER_NOT_FOUND',
        'Laboratory order not found for this patient.',
        404,
      );
    }
    if (
      order.status !== 'Sample Collected' ||
      !order.sampleCollectedAt ||
      !order.sampleAccessionNumber?.trim()
    ) {
      throw new LaboratoryDomainError(
        'LAB_SPECIMEN_NOT_COLLECTED',
        'Record specimen collection before entering results.',
        409,
      );
    }
    const [inserted] = await tx
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
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(context.userId),
      action: 'CREATE',
      resource: 'LabResult',
      resourceId: String(inserted.id),
      details: 'Laboratory result entered; pending verification.',
    });
    return inserted;
  });
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

  if (
    order.status !== 'Sample Collected' ||
    !order.sampleCollectedAt ||
    !order.sampleAccessionNumber?.trim()
  ) {
    throw new LaboratoryDomainError(
      'LAB_SPECIMEN_NOT_COLLECTED',
      'Specimen collection must be reviewed before verification.',
      409,
    );
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
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
          eq(schema.labResults.status, 'Pending Verification'),
          isNull(schema.labResults.verifiedBy),
          isNull(schema.labResults.verifiedAt),
        ),
      )
      .returning();
    if (!updated)
      throw new LaboratoryDomainError(
        'LAB_RESULT_STATE_CONFLICT',
        'This result is already verified or requires review.',
        409,
      );
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(context.userId),
      action: 'UPDATE',
      resource: 'LabResult',
      resourceId: String(resultId),
      details: 'Laboratory result verified.',
    });
    return updated;
  });
}

/** Explicit staff confirmation that the complete investigation/panel was performed.
 * Result verification alone is deliberately not treated as panel completion. */
export async function completeLabInvestigation(context: AuthorizationContext, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new LaboratoryDomainError(
      'LAB_INVALID_INPUT',
      'A valid investigation ID is required.',
      400,
    );
  const [found] = await db
    .select()
    .from(schema.labOrders)
    .where(eq(schema.labOrders.id, id))
    .limit(1);
  if (!found)
    throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
  const facility = await getFacilityByIdScoped(context, found.facilityId);
  if (!facility || facility.tenantId !== found.tenantId)
    throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.labOrders)
      .where(
        and(
          eq(schema.labOrders.id, id),
          eq(schema.labOrders.tenantId, facility.tenantId),
          eq(schema.labOrders.facilityId, facility.id),
        ),
      )
      .limit(1)
      .for('update');
    if (!order)
      throw new LaboratoryDomainError('LAB_ORDER_NOT_FOUND', 'Laboratory order not found.', 404);
    if (order.status === 'Completed' && order.completedAt && order.completedByUserId) return order;
    if (order.status !== 'Sample Collected')
      throw new LaboratoryDomainError(
        'LAB_SPECIMEN_NOT_COLLECTED',
        'A collected specimen and verified results are required.',
        409,
      );
    const results = await tx
      .select()
      .from(schema.labResults)
      .where(eq(schema.labResults.orderId, id));
    if (
      !results.length ||
      results.some(
        (result) =>
          result.patientId !== order.patientId ||
          result.status !== 'Verified' ||
          !result.verifiedAt,
      )
    )
      throw new LaboratoryDomainError(
        'LAB_RESULTS_INCOMPLETE',
        'At least one result is required and all recorded results must be verified before confirming the complete investigation.',
        409,
      );
    const [completed] = await tx
      .update(schema.labOrders)
      .set({ status: 'Completed', completedAt: new Date(), completedByUserId: context.userId })
      .where(eq(schema.labOrders.id, id))
      .returning();
    const attempt = await recordChargeAttempt(tx, labOrderChargeRequest(completed), {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      message: 'Investigation completed; billing evaluation pending.',
    });
    if (attempt === null) throw new Error('LAB_BILLING_QUEUE_UNAVAILABLE');
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(context.userId),
      action: 'UPDATE',
      resource: 'LabOrder',
      resourceId: String(id),
      details:
        'Investigation explicitly confirmed complete after review of verified results; billing work recorded.',
    });
    return completed;
  });
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

/** Retry-safe creation. A request key cannot be reused for a different actor or clinical payload. */
export async function createRadiologyOrderIdempotent(
  data: typeof schema.radiologyOrders.$inferInsert,
  idempotencyKey: string,
  actor: number,
) {
  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        tenantId: data.tenantId,
        facilityId: data.facilityId,
        patientId: data.patientId,
        encounterId: data.encounterId ?? null,
        masterServiceId: data.masterServiceId ?? null,
        modality: data.modality,
        procedureName: data.procedureName,
        clinicalIndication: data.clinicalIndication ?? null,
        orderedBy: data.orderedBy ?? null,
      }),
    )
    .digest('hex');
  return db.transaction(async (tx) => {
    const [request] = await tx
      .insert(schema.radiologyOrderRequests)
      .values({
        tenantId: data.tenantId,
        facilityId: data.facilityId,
        idempotencyKey,
        payloadHash,
        createdByUserId: actor,
      })
      .onConflictDoNothing()
      .returning();
    if (!request) {
      const [prior] = await tx
        .select()
        .from(schema.radiologyOrderRequests)
        .where(
          and(
            eq(schema.radiologyOrderRequests.tenantId, data.tenantId),
            eq(schema.radiologyOrderRequests.facilityId, data.facilityId),
            eq(schema.radiologyOrderRequests.idempotencyKey, idempotencyKey),
          ),
        )
        .for('update');
      if (!prior || prior.payloadHash !== payloadHash || prior.createdByUserId !== actor)
        throw new LaboratoryDomainError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was already used for a different request.',
          409,
        );
      const [order] = prior.orderId
        ? await tx
            .select()
            .from(schema.radiologyOrders)
            .where(
              and(
                eq(schema.radiologyOrders.id, prior.orderId),
                eq(schema.radiologyOrders.tenantId, data.tenantId),
                eq(schema.radiologyOrders.facilityId, data.facilityId),
              ),
            )
        : [];
      if (!order)
        throw new LaboratoryDomainError(
          'REQUEST_REVIEW_REQUIRED',
          'The existing imaging request requires review.',
          409,
        );
      return { order, idempotentReplay: true };
    }
    const [order] = await tx.insert(schema.radiologyOrders).values(data).returning();
    await tx
      .update(schema.radiologyOrderRequests)
      .set({ orderId: order.id })
      .where(eq(schema.radiologyOrderRequests.id, request.id));
    await tx.insert(schema.auditLogs).values({
      tenantId: data.tenantId,
      facilityId: data.facilityId,
      userId: String(actor),
      action: 'CREATE',
      resource: 'RADIOLOGY_ORDER',
      resourceId: String(order.id),
      details: 'Imaging request recorded; no performance or billing inferred.',
    });
    return { order, idempotentReplay: false };
  });
}

export async function updateRadiologyReport(
  id: number,
  findings: string | undefined,
  impression: string | undefined,
  reportedBy: string,
  actorId: number,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.radiologyOrders)
      .where(eq(schema.radiologyOrders.id, id))
      .for('update');
    if (!existing) return null;
    const [updated] = await tx
      .update(schema.radiologyOrders)
      .set({
        status: 'Reported',
        radiologistFindings: findings,
        impression,
        reportedBy,
        reportedAt: existing.reportedAt ?? new Date(),
      })
      .where(eq(schema.radiologyOrders.id, id))
      .returning();
    if (existing.status !== 'Reported') {
      const attempt = await recordChargeAttempt(tx, radiologyChargeRequest(updated), {
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED',
        message: 'Imaging report recorded; billing evaluation pending.',
      });
      if (attempt === null) throw new Error('IMAGING_BILLING_QUEUE_UNAVAILABLE');
    }
    await tx.insert(schema.auditLogs).values({
      tenantId: updated.tenantId,
      facilityId: updated.facilityId,
      userId: String(actorId),
      action: 'UPDATE',
      resource: 'RadiologyOrder',
      resourceId: String(id),
      details:
        existing.status === 'Reported'
          ? 'Radiology report updated; the original billing occurrence is unchanged.'
          : 'Radiology report recorded; billing work recorded.',
    });
    return updated;
  });
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
    clinicalException?: boolean;
    testIds?: number[];
    testSelections?: Array<{ testId: number; specimenOptionId: number }>;
    idempotencyKey?: string;
    clinicalIndication: string;
    specimenType?: string;
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
  if (!data.testSelections && !data.specimenType?.trim()) {
    throw new Error('Specimen type is required.');
  }
  if (
    data.clinicalIndication.length > 2000 ||
    (data.specimenType?.length ?? 0) > 120 ||
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

  const selected = data.testSelections;
  if (
    data.clinicalException &&
    (!freeTextProvided ||
      investigations.length !== 1 ||
      data.testIds ||
      selected ||
      !data.encounterId ||
      !data.idempotencyKey ||
      data.idempotencyKey.length < 16 ||
      data.idempotencyKey.length > 128)
  )
    throw new LaboratoryDomainError(
      'INVALID_EXCEPTION',
      'A clinical exception requires one investigation and its own specimen.',
      400,
    );
  if (
    selected &&
    (freeTextProvided ||
      data.testIds ||
      !data.encounterId ||
      !data.idempotencyKey ||
      data.idempotencyKey.length < 16 ||
      data.idempotencyKey.length > 128 ||
      !selected.length ||
      selected.length > 100 ||
      selected.some(
        (item) =>
          !Number.isSafeInteger(item.testId) ||
          item.testId <= 0 ||
          !Number.isSafeInteger(item.specimenOptionId) ||
          item.specimenOptionId <= 0,
      ) ||
      new Set(selected.map((item) => item.testId)).size !== selected.length)
  )
    throw new LaboratoryDomainError(
      'INVALID_SELECTION',
      'Select distinct tests and one reviewed specimen for each.',
      400,
    );
  const testIds = data.testIds ?? [];
  if (!freeTextProvided && !selected) {
    if (!Array.isArray(testIds) || testIds.length === 0) {
      throw new Error('Enter at least one laboratory investigation.');
    }
    if (testIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error('One or more laboratory test IDs are invalid.');
    }
    if (new Set(testIds).size !== testIds.length) {
      throw new Error('Duplicate tests are not allowed in one submission.');
    }
  } else if (freeTextProvided && investigations.length === 0) {
    throw new Error('Enter at least one laboratory investigation.');
  }

  if (
    !selected &&
    ((freeTextProvided && data.testIds) ||
      (freeTextProvided ? investigations.length : testIds.length) > 1)
  )
    throw new LaboratoryDomainError(
      'INDIVIDUAL_SPECIMEN_REQUIRED',
      'Submit one legacy request per specimen, or select an individually reviewed specimen for each test.',
      400,
    );

  const scope = await resolveQueueOrLabScope(context, {
    encounterId: data.encounterId,
    patientId: data.patientId,
  });

  try {
    return await db.transaction(async (tx) => {
      let batchId: number | null = null;
      if ((selected || data.clinicalException) && data.idempotencyKey) {
        const payloadHash = createHash('sha256')
          .update(
            JSON.stringify({
              scope,
              selections: selected ? [...selected].sort((a, b) => a.testId - b.testId) : null,
              clinicalException: data.clinicalException === true,
              investigations: data.clinicalException ? investigations : null,
              specimenType: data.clinicalException ? data.specimenType?.trim() : null,
              clinicalIndication: data.clinicalIndication.trim(),
              priority,
              clinicalNotes: data.clinicalNotes?.trim() || null,
              orderedBy: data.orderedBy?.trim() || null,
            }),
          )
          .digest('hex');
        const [batch] = await tx
          .insert(schema.labOrderBatches)
          .values({
            ...scope,
            idempotencyKey: data.idempotencyKey,
            payloadHash,
            createdByUserId: context.userId,
          })
          .onConflictDoNothing()
          .returning();
        if (!batch) {
          const [existing] = await tx
            .select()
            .from(schema.labOrderBatches)
            .where(
              and(
                eq(schema.labOrderBatches.tenantId, scope.tenantId),
                eq(schema.labOrderBatches.facilityId, scope.facilityId),
                eq(schema.labOrderBatches.idempotencyKey, data.idempotencyKey),
              ),
            )
            .for('update');
          if (
            !existing ||
            existing.payloadHash !== payloadHash ||
            existing.createdByUserId !== context.userId
          )
            throw new LaboratoryDomainError(
              'IDEMPOTENCY_CONFLICT',
              'This request key was already used for a different request.',
              409,
            );
          const orders = await tx
            .select({ order: schema.labOrders, testCode: schema.labTests.code })
            .from(schema.labOrders)
            .leftJoin(schema.labTests, eq(schema.labOrders.testId, schema.labTests.id))
            .where(
              and(
                eq(schema.labOrders.batchId, existing.id),
                eq(schema.labOrders.tenantId, scope.tenantId),
                eq(schema.labOrders.facilityId, scope.facilityId),
              ),
            );
          const [queue] = existing.queueId
            ? await tx
                .select()
                .from(schema.queues)
                .where(
                  and(
                    eq(schema.queues.id, existing.queueId),
                    eq(schema.queues.tenantId, scope.tenantId),
                    eq(schema.queues.facilityId, scope.facilityId),
                  ),
                )
            : [];
          if (!queue || orders.length !== (selected?.length ?? 1))
            throw new LaboratoryDomainError(
              'BATCH_REVIEW_REQUIRED',
              'The existing batch requires review before retrying.',
              409,
            );
          return {
            orders: orders.map(({ order, testCode }) => ({
              ...order,
              testCode,
              catalogueMatch:
                order.testId && !order.clinicalException
                  ? ('FOUND' as const)
                  : ('REVIEW_REQUIRED' as const),
            })),
            queue,
            unresolved: orders
              .filter(({ order }) => !order.testId || order.clinicalException)
              .map(({ order }) => order.testName),
            ambiguous: [],
            idempotentReplay: true,
          };
        }
        batchId = batch.id;
      }
      const tests: Array<{
        id: number | null;
        name: string;
        code: string | null;
        specimenType?: string;
        reviewedSpecimenOptionId?: number;
        match?: 'FOUND' | 'REVIEW_REQUIRED' | 'AMBIGUOUS';
      }> = [];

      if (selected) {
        for (const choice of selected) {
          const [row] = await tx
            .select({
              test: schema.labTests,
              specimenType: schema.labTestSpecimenOptions.specimenType,
            })
            .from(schema.labTests)
            .innerJoin(
              schema.labTestSpecimenOptions,
              and(
                eq(schema.labTestSpecimenOptions.testId, schema.labTests.id),
                eq(schema.labTestSpecimenOptions.id, choice.specimenOptionId),
                eq(schema.labTestSpecimenOptions.tenantId, scope.tenantId),
                eq(schema.labTestSpecimenOptions.facilityId, scope.facilityId),
                isNull(schema.labTestSpecimenOptions.retiredAt),
              ),
            )
            .where(
              and(
                eq(schema.labTests.id, choice.testId),
                eq(schema.labTests.facilityId, scope.facilityId),
                eq(schema.labTests.isActive, true),
              ),
            )
            .limit(1)
            .for('share');
          if (!row)
            throw new LaboratoryDomainError(
              'SPECIMEN_NOT_REVIEWED',
              'A selected test or specimen is unavailable or has not been reviewed for this facility.',
              400,
            );
          tests.push({
            id: row.test.id,
            name: row.test.name,
            code: row.test.code,
            specimenType: row.specimenType,
            reviewedSpecimenOptionId: choice.specimenOptionId,
            match: 'FOUND',
          });
        }
      } else if (freeTextProvided) {
        // Legacy text remains available for care, but even an exact-looking
        // name is not proof of the selected investigation. It requires a
        // controlled identity review rather than an inferred test ID.
        for (const name of investigations) {
          tests.push({ id: null, name, code: null, match: 'REVIEW_REQUIRED' });
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
          // A legacy test ID does not prove the specimen was reviewed. Keep
          // the clinical request, but queue completed work for explicit review.
          tests.push({
            id: test.id,
            name: test.name,
            code: test.code ?? null,
            match: 'REVIEW_REQUIRED',
          });
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
            specimenType: test.specimenType ?? data.specimenType!.trim(),
            reviewedSpecimenOptionId: test.reviewedSpecimenOptionId ?? null,
            batchId,
            clinicalException: !selected || data.clinicalException === true,
            priority,
            clinicalNotes: data.clinicalNotes?.trim() || null,
          })
          .returning();

        if (!order) {
          throw new Error('A laboratory order could not be created.');
        }
        await tx.insert(schema.auditLogs).values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          userId: String(context.userId),
          action: 'CREATE',
          resource: 'LAB_ORDER_REQUEST',
          resourceId: String(order.id),
          details: JSON.stringify({
            testId: order.testId,
            reviewedSpecimenOptionId: order.reviewedSpecimenOptionId,
            clinicalException: order.clinicalException,
          }),
        });

        orders.push({
          ...order,
          testCode: test.code,
          catalogueMatch: test.match ?? 'FOUND',
        });
      }

      // Legacy requests remain clinically available, but cannot bill without
      // a controlled identity/specimen review workflow.
      const unresolved = tests
        .filter((test) => test.match === 'REVIEW_REQUIRED')
        .map((test) => test.name);

      const ambiguous = tests.filter((test) => test.match === 'AMBIGUOUS').map((test) => test.name);

      if (batchId) {
        await tx
          .update(schema.labOrderBatches)
          .set({ queueId: queue.id })
          .where(eq(schema.labOrderBatches.id, batchId));
        await tx.insert(schema.auditLogs).values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          userId: String(context.userId),
          action: 'CREATE',
          resource: 'LAB_ORDER_BATCH',
          resourceId: String(batchId),
          details: data.clinicalException
            ? 'Created one unmatched clinical exception; specimen requires laboratory review.'
            : `Created ${orders.length} catalogue orders with individually reviewed specimens.`,
        });
      }
      return { orders, queue, unresolved, ambiguous, idempotentReplay: false };
    });
  } catch (error) {
    if (!(error instanceof LaboratoryDomainError)) log.error('lab.batch_transaction_failed');
    throw error;
  }
}
