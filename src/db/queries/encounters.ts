/**
 * JaliCare HMIS
 * Queries: Clinical encounters and the references they validate
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, isNull, notInArray, or } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import {
  ScopeAccessError,
  requireTenantScope,
  resolveFacilityScope,
} from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { lockChargeIdentity, recordChargeAttempt } from '../../billing/charge-attempts.ts';
import { consultationChargeRequest } from '../../billing/service-charges.ts';

import { pickEncounterWritableFields, validateEncounterReferences } from './shared.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.encounters');

// Encounters
export async function getEncounters(patientId?: number, facilityId?: number) {
  try {
    const query = db.select().from(schema.encounters);
    const conditions = [];
    if (patientId) conditions.push(eq(schema.encounters.patientId, patientId));
    if (facilityId) conditions.push(eq(schema.encounters.facilityId, facilityId));

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.encounters.startedAt))
        .limit(50);
    }
    return await query.orderBy(desc(schema.encounters.startedAt)).limit(50);
  } catch (error) {
    log.error({ err: error }, 'encounters.fetch_failed');
    throw new Error('Failed to fetch clinical encounters', { cause: error });
  }
}

export async function createEncounter(data: typeof schema.encounters.$inferInsert) {
  try {
    const res = await db.insert(schema.encounters).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'encounter.create_failed');
    throw new Error('Failed to create encounter', { cause: error });
  }
}

export async function updateEncounter(
  id: number,
  data: Partial<typeof schema.encounters.$inferInsert>,
) {
  try {
    const res = await db
      .update(schema.encounters)
      .set(data)
      .where(eq(schema.encounters.id, id))
      .returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'encounter.update_failed');
    throw new Error('Failed to update encounter', { cause: error });
  }
}

export async function requirePatientInTenant(
  context: AuthorizationContext,
  patientId: number,
  tenantId: number,
) {
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error('A valid patient ID is required.');
  }

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, patientId))
    .limit(1);

  if (!patient) return null;

  requireTenantScope(context, patient.tenantId);

  if (patient.tenantId !== tenantId) {
    throw new ScopeAccessError(
      'Patient is outside the authorized tenant.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  return patient;
}

export async function getEncountersScoped(
  context: AuthorizationContext,
  patientId?: number,
  requestedFacilityId?: number,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  const conditions = [
    eq(schema.encounters.tenantId, facility.tenantId),
    eq(schema.encounters.facilityId, facility.id),
  ];

  if (patientId !== undefined) {
    const patient = await requirePatientInTenant(context, patientId, facility.tenantId);

    if (!patient) return [];

    conditions.push(eq(schema.encounters.patientId, patient.id));
  }

  return db
    .select()
    .from(schema.encounters)
    .where(and(...conditions))
    .orderBy(desc(schema.encounters.startedAt))
    .limit(50);
}

export class ConsultationSelectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const CONSULTATION_SOURCES: Record<string, string> = {
  'ENCOUNTER:OUTPATIENT': 'Outpatient',
  'ENCOUNTER:FOLLOW_UP': 'Follow Up',
  'ENCOUNTER:EMERGENCY': 'Emergency',
};

async function consultationInFacility(facility: { id: number; tenantId: number }, id: unknown) {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    throw new ConsultationSelectionError(
      'INVALID_CONSULTATION',
      'Choose a valid consultation service.',
    );
  const [row] = await db
    .select({ id: schema.masterServices.id, clinicalSource: schema.masterServices.clinicalSource })
    .from(schema.masterServices)
    .innerJoin(
      schema.facilityServiceTariffs,
      and(
        eq(schema.facilityServiceTariffs.masterServiceId, schema.masterServices.id),
        eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, facility.id),
      ),
    )
    .where(
      and(
        eq(schema.masterServices.id, id),
        eq(schema.masterServices.billingFamily, 'CONSULTATION'),
        eq(schema.masterServices.isActive, true),
        or(
          isNull(schema.masterServices.tenantId),
          eq(schema.masterServices.tenantId, facility.tenantId),
        ),
        or(
          isNull(schema.masterServices.originFacilityId),
          eq(schema.masterServices.originFacilityId, facility.id),
        ),
      ),
    )
    .limit(1);
  if (!row || !CONSULTATION_SOURCES[row.clinicalSource])
    throw new ConsultationSelectionError(
      'CONSULTATION_UNAVAILABLE',
      'The consultation is not available for this facility.',
    );
  return { id: row.id, encounterType: CONSULTATION_SOURCES[row.clinicalSource] };
}

export async function createEncounterScoped(
  context: AuthorizationContext,
  data: typeof schema.encounters.$inferInsert & { idempotencyKey?: string },
) {
  const facilityId = resolveFacilityScope(context, data.facilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  const patient = await requirePatientInTenant(context, data.patientId, facility.tenantId);

  if (!patient) {
    throw new Error('Patient not found.');
  }

  const safeData = pickEncounterWritableFields(data as Record<string, unknown>);

  await validateEncounterReferences(facility.id, facility.tenantId, safeData);

  const selection =
    data.consultationMasterServiceId == null
      ? null
      : await consultationInFacility(facility, data.consultationMasterServiceId);
  if (selection && data.consultationSelectionReviewRequired)
    throw new ConsultationSelectionError(
      'INVALID_CONSULTATION',
      'Select a consultation or request review, not both.',
    );
  if (
    data.consultationSelectionReviewRequired != null &&
    typeof data.consultationSelectionReviewRequired !== 'boolean'
  )
    throw new ConsultationSelectionError(
      'INVALID_CONSULTATION',
      'Invalid consultation review state.',
    );

  // Older API clients may omit the selection. Keep clinical care available,
  // but never interpret that omission (or an explicit false) as approval.
  const reviewRequired = !selection;

  const key = data.idempotencyKey;
  if (
    key !== undefined &&
    (typeof key !== 'string' || key.trim() !== key || key.length < 16 || key.length > 128)
  )
    throw new ConsultationSelectionError(
      'INVALID_IDEMPOTENCY_KEY',
      'Invalid encounter request key.',
    );
  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        patientId: patient.id,
        safeData,
        consultationMasterServiceId: selection?.id ?? null,
        consultationSelectionReviewRequired: reviewRequired,
      }),
    )
    .digest('hex');
  return db.transaction(async (tx) => {
    let requestId: number | null = null;
    if (key) {
      const [request] = await tx
        .insert(schema.encounterCreationRequests)
        .values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          idempotencyKey: key,
          payloadHash,
          createdByUserId: context.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!request) {
        const [prior] = await tx
          .select()
          .from(schema.encounterCreationRequests)
          .where(
            and(
              eq(schema.encounterCreationRequests.tenantId, facility.tenantId),
              eq(schema.encounterCreationRequests.facilityId, facility.id),
              eq(schema.encounterCreationRequests.idempotencyKey, key),
            ),
          )
          .for('update');
        if (!prior || prior.payloadHash !== payloadHash || prior.createdByUserId !== context.userId)
          throw new ConsultationSelectionError(
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for a different encounter.',
            409,
          );
        const [encounter] = prior.encounterId
          ? await tx
              .select()
              .from(schema.encounters)
              .where(
                and(
                  eq(schema.encounters.id, prior.encounterId),
                  eq(schema.encounters.tenantId, facility.tenantId),
                  eq(schema.encounters.facilityId, facility.id),
                ),
              )
          : [];
        if (!encounter)
          throw new ConsultationSelectionError(
            'REQUEST_REVIEW_REQUIRED',
            'The existing encounter request requires review.',
            409,
          );
        return { ...encounter, idempotentReplay: true };
      }
      requestId = request.id;
    }
    const [created] = await tx
      .insert(schema.encounters)
      .values({
        ...safeData,
        ...(selection ? { encounterType: selection.encounterType } : {}),
        tenantId: facility.tenantId,
        facilityId: facility.id,
        patientId: patient.id,
        consultationMasterServiceId: selection?.id ?? null,
        consultationSelectionReviewRequired: reviewRequired,
      } as typeof schema.encounters.$inferInsert)
      .returning();
    if (selection || reviewRequired) {
      await tx.insert(schema.auditLogs).values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        userId: String(context.userId),
        action: 'CREATE',
        resource: 'CONSULTATION_SELECTION',
        resourceId: String(created.id),
        details: selection
          ? `Selected master service ${selection.id}.`
          : 'Consultation selection requires review.',
      });
    }
    if (requestId)
      await tx
        .update(schema.encounterCreationRequests)
        .set({ encounterId: created.id })
        .where(eq(schema.encounterCreationRequests.id, requestId));
    return { ...created, idempotentReplay: false };
  });
}

/** Select a service for an existing uncharged encounter without rewriting invoices. */
export async function selectEncounterConsultation(
  context: AuthorizationContext,
  encounterId: number,
  masterId: unknown,
  reason: unknown,
) {
  if (!Number.isSafeInteger(encounterId) || encounterId <= 0)
    throw new ConsultationSelectionError('INVALID_ENCOUNTER_ID', 'Invalid encounter ID.');
  const reference = typeof reason === 'string' ? reason.trim() : '';
  if (reference.length < 3 || reference.length > 500)
    throw new ConsultationSelectionError(
      'REVIEW_REASON_REQUIRED',
      'Enter a review reason (3–500 characters).',
    );
  const [current] = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  if (!current)
    throw new ConsultationSelectionError('ENCOUNTER_NOT_FOUND', 'Encounter not found.', 404);
  const facility = await getFacilityByIdScoped(context, current.facilityId);
  if (!facility || facility.tenantId !== current.tenantId)
    throw new ScopeAccessError(
      'Encounter is outside the authorized facility.',
      'FACILITY_ACCESS_DENIED',
    );
  const selection = await consultationInFacility(facility, masterId);
  return db.transaction(async (tx) => {
    await lockChargeIdentity(tx, facility.id, 'CONSULTATION', encounterId);
    const [locked] = await tx
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, encounterId),
          eq(schema.encounters.tenantId, facility.tenantId),
          eq(schema.encounters.facilityId, facility.id),
        ),
      )
      .for('update');
    if (!locked)
      throw new ConsultationSelectionError('ENCOUNTER_NOT_FOUND', 'Encounter not found.', 404);
    if (!['ACTIVE', 'IN PROGRESS', 'COMPLETED'].includes(locked.status.trim().toUpperCase()))
      throw new ConsultationSelectionError(
        'ENCOUNTER_NOT_ELIGIBLE',
        'Only an active or completed encounter can be reviewed.',
        409,
      );
    if (locked.consultationMasterServiceId) {
      if (locked.consultationMasterServiceId === selection.id) return locked;
      throw new ConsultationSelectionError(
        'SELECTION_ALREADY_RECORDED',
        'A consultation selection already exists; use an authorized correction process.',
        409,
      );
    }
    // Any historical consultation item, including one on a voided invoice,
    // needs financial review. An encounter item without complete provenance
    // could also be the consultation (even if its old item type was "OPD");
    // do not guess that it is a different service and create a second charge.
    const [item] = await tx
      .select({ id: schema.billingItems.id })
      .from(schema.billingItems)
      .innerJoin(
        schema.billingInvoices,
        eq(schema.billingInvoices.id, schema.billingItems.invoiceId),
      )
      .where(
        and(
          eq(schema.billingInvoices.tenantId, facility.tenantId),
          eq(schema.billingInvoices.facilityId, facility.id),
          or(
            and(
              eq(schema.billingItems.sourceType, 'CONSULTATION'),
              eq(schema.billingItems.sourceId, encounterId),
            ),
            and(
              eq(schema.billingInvoices.encounterId, encounterId),
              or(
                isNull(schema.billingItems.sourceType),
                isNull(schema.billingItems.sourceId),
                notInArray(schema.billingItems.sourceType, [
                  'LAB_ORDER',
                  'RADIOLOGY',
                  'PHARMACY',
                  'PROCEDURE',
                  'ADMISSION',
                  'BED_DAY',
                  'MATERNITY',
                ]),
              ),
            ),
          ),
        ),
      )
      .limit(1);
    if (item)
      throw new ConsultationSelectionError(
        'CONSULTATION_ALREADY_BILLED',
        'A historical consultation item exists; financial review is required.',
        409,
      );
    const [updated] = await tx
      .update(schema.encounters)
      .set({
        consultationMasterServiceId: selection.id,
        consultationSelectionReviewRequired: false,
        updatedByUserId: context.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.encounters.id, encounterId))
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(context.userId),
      action: 'REVIEW',
      resource: 'CONSULTATION_SELECTION',
      resourceId: String(encounterId),
      details: `Selected master service ${selection.id}; review: ${reference}`,
    });
    return updated;
  });
}

export async function updateEncounterScoped(
  context: AuthorizationContext,
  encounterId: number,
  data: Partial<typeof schema.encounters.$inferInsert>,
) {
  if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
    throw new Error('Invalid encounter ID.');
  }

  const [current] = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);

  if (!current) return null;

  const facility = await getFacilityByIdScoped(context, current.facilityId);

  if (!facility || facility.tenantId !== current.tenantId) {
    throw new ScopeAccessError(
      'Encounter is outside the authorized facility.',
      'FACILITY_ACCESS_DENIED',
    );
  }

  if (data.patientId !== undefined && data.patientId !== current.patientId) {
    throw new Error(
      'Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.',
    );
  }

  const safeData = pickEncounterWritableFields(data as Record<string, unknown>);

  /*
   * Completing a visit ends it. The screen sends `status` only; a
   * browser-supplied `endedAt` arrived as a string and Drizzle's
   * timestamp mapping cannot take one, so the server stamps it.
   */
  if (typeof safeData.status === 'string') {
    const status = safeData.status.trim().toUpperCase();
    if (status === 'COMPLETED') safeData.status = 'Completed';
    if (status === 'CANCELLED') safeData.status = 'Cancelled';
  }

  await validateEncounterReferences(facility.id, facility.tenantId, safeData);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, encounterId),
          eq(schema.encounters.tenantId, facility.tenantId),
          eq(schema.encounters.facilityId, facility.id),
        ),
      )
      .for('update');
    if (!locked) return null;
    if (safeData.status === 'Completed' || safeData.status === 'Cancelled') {
      // A replay must not silently change the source date used for pricing.
      safeData.endedAt = locked.endedAt ?? new Date();
    }
    const [updated] = await tx
      .update(schema.encounters)
      .set({ ...safeData, updatedAt: new Date() } as Partial<typeof schema.encounters.$inferInsert>)
      .where(eq(schema.encounters.id, encounterId))
      .returning();
    if (
      updated &&
      locked.status.trim().toUpperCase() !== 'COMPLETED' &&
      updated.status === 'Completed' &&
      updated.encounterType.trim().toUpperCase() !== 'INPATIENT'
    ) {
      const attempt = await recordChargeAttempt(tx, consultationChargeRequest(updated), {
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED',
        message: 'Consultation completed; billing evaluation pending.',
      });
      if (attempt === null) throw new Error('CONSULTATION_BILLING_QUEUE_UNAVAILABLE');
    }
    return updated ?? null;
  });
}
