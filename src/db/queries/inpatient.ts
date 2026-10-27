/**
 * JaliCare HMIS
 * Queries: Wards, beds, admissions, transfers, nursing notes, theatre, bed-day accrual
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import {
  ACTIVE_ADMISSION_STATUS,
  ADMISSION_STATUS_SET,
  ADMISSION_STATUSES,
  BED_STATUS_SET,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  CLOSED_ADMISSION_STATUS,
  InpatientDomainError,
} from '../inpatient-contracts.ts';

import { requireTenantScope, requireFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import {
  bedDaySegments,
  bedDayTariffCodes,
  type ChargeResult,
} from '../../billing/billing.service.ts';
import { chargeAndRecord } from '../../billing/charge-attempts.ts';
import { billingServiceKeys } from '../../billing/tariff-codes.ts';

import {
  NURSING_NOTE_TYPES,
  normaliseTimestamp,
  optionalText,
  requireBedInScope,
  requireInpatientFacility,
  requirePositiveId,
} from './shared.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

import { requirePatientInTenant } from './encounters.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.inpatient');

/* ------------------------------------------------------------
   WARDS
   ------------------------------------------------------------ */

export async function getWardsScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
) {
  const facility = await requireInpatientFacility(context, requestedFacilityId);

  return db
    .select()
    .from(schema.wards)
    .where(eq(schema.wards.facilityId, facility.id))
    .orderBy(schema.wards.name);
}

/* ------------------------------------------------------------
   BEDS
   ------------------------------------------------------------ */

export async function getBedsScoped(context: AuthorizationContext, wardId?: number | null) {
  if (wardId !== undefined && wardId !== null) {
    const id = requirePositiveId(wardId, 'ward ID');

    const [ward] = await db.select().from(schema.wards).where(eq(schema.wards.id, id)).limit(1);

    if (!ward) {
      throw new InpatientDomainError('WARD_NOT_FOUND', 'Ward not found.', 404);
    }

    const facility = await getFacilityByIdScoped(context, ward.facilityId);

    if (!facility) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Ward not found in the authorised facility.',
        404,
      );
    }

    return db
      .select()
      .from(schema.beds)
      .where(eq(schema.beds.wardId, ward.id))
      .orderBy(schema.beds.bedNumber);
  }

  const facility = await requireInpatientFacility(context);

  const wardRows = await db
    .select({ id: schema.wards.id })
    .from(schema.wards)
    .where(eq(schema.wards.facilityId, facility.id));

  if (wardRows.length === 0) return [];

  return db
    .select()
    .from(schema.beds)
    .where(
      inArray(
        schema.beds.wardId,
        wardRows.map((row) => row.id),
      ),
    )
    .orderBy(schema.beds.bedNumber);
}

/* ------------------------------------------------------------
   ADMISSIONS — READ
   ------------------------------------------------------------ */

export async function getAdmissionsScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
  status?: string | null,
) {
  const facility = await requireInpatientFacility(context, requestedFacilityId);

  const conditions = [eq(schema.admissions.facilityId, facility.id)];

  if (typeof status === 'string' && status.trim()) {
    const normalised = status.trim();

    if (!ADMISSION_STATUS_SET.has(normalised)) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        `Admission status must be one of: ${ADMISSION_STATUSES.join(', ')}.`,
        400,
      );
    }

    conditions.push(eq(schema.admissions.status, normalised));
  }

  return db
    .select()
    .from(schema.admissions)
    .where(and(...conditions))
    .orderBy(desc(schema.admissions.createdAt));
}

export async function getAdmissionByIdScoped(context: AuthorizationContext, admissionId: number) {
  const id = requirePositiveId(admissionId, 'admission ID');

  const [admission] = await db
    .select()
    .from(schema.admissions)
    .where(eq(schema.admissions.id, id))
    .limit(1);

  if (!admission) return null;

  requireTenantScope(context, admission.tenantId);
  requireFacilityScope(context, admission.tenantId, admission.facilityId);

  return admission;
}

/* ------------------------------------------------------------
   ADMISSIONS — CREATE
   ------------------------------------------------------------ */

export interface CreateAdmissionInput {
  facilityId?: number | null;
  patientId: number;
  wardId: number;
  bedId: number;
  encounterId?: number | null;
  admissionDate?: string;
  admissionType?: string;
  admittingDoctor?: string | null;
  provisionalDiagnosis?: string | null;
  nursingNotes?: string | null;
}

export async function createAdmissionScoped(
  context: AuthorizationContext,
  input: CreateAdmissionInput,
) {
  const patientId = requirePositiveId(input?.patientId, 'patient ID');
  const wardId = requirePositiveId(input?.wardId, 'ward ID');
  const bedId = requirePositiveId(input?.bedId, 'bed ID');

  const facility = await requireInpatientFacility(context, input?.facilityId);

  const patient = await requirePatientInTenant(context, patientId, facility.tenantId);

  if (!patient) {
    throw new InpatientDomainError(
      'PATIENT_NOT_FOUND',
      'Patient not found in the authorised facility.',
      404,
    );
  }

  let encounterId: number | null = null;

  if (
    input?.encounterId !== undefined &&
    input?.encounterId !== null &&
    String(input.encounterId) !== ''
  ) {
    encounterId = requirePositiveId(input.encounterId, 'encounter ID');
  }

  const admissionDate = normaliseTimestamp(input?.admissionDate);
  const admissionType = optionalText(input?.admissionType, 60) ?? 'Emergency';

  return await db.transaction(async (tx) => {
    const [ward] = await tx
      .select()
      .from(schema.wards)
      .where(and(eq(schema.wards.id, wardId), eq(schema.wards.facilityId, facility.id)))
      .limit(1);

    if (!ward) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Ward not found in the authorised facility.',
        404,
      );
    }

    const [bed] = await tx
      .select()
      .from(schema.beds)
      .where(and(eq(schema.beds.id, bedId), eq(schema.beds.wardId, ward.id)))
      .limit(1);

    if (!bed) {
      throw new InpatientDomainError('BED_NOT_FOUND', 'Bed not found in the selected ward.', 404);
    }

    if (encounterId !== null) {
      const [encounter] = await tx
        .select({ id: schema.encounters.id })
        .from(schema.encounters)
        .where(
          and(
            eq(schema.encounters.id, encounterId),
            eq(schema.encounters.patientId, patient.id),
            eq(schema.encounters.facilityId, facility.id),
          ),
        )
        .limit(1);

      if (!encounter) {
        throw new InpatientDomainError(
          'ENCOUNTER_NOT_FOUND',
          'Encounter not found for this patient at this facility.',
          404,
        );
      }
    }

    /* ---- Bed availability ---------------------------------- */

    const [activeOnBed] = await tx
      .select({ id: schema.admissions.id })
      .from(schema.admissions)
      .where(
        and(
          eq(schema.admissions.bedId, bed.id),
          eq(schema.admissions.status, ACTIVE_ADMISSION_STATUS),
        ),
      )
      .limit(1);

    if (activeOnBed) {
      throw new InpatientDomainError(
        'BED_OCCUPIED',
        'That bed already has an active admission.',
        409,
      );
    }

    if (bed.status === 'Occupied') {
      throw new InpatientDomainError(
        'BED_OCCUPIED',
        'That bed is already marked as occupied.',
        409,
      );
    }

    if (bed.status !== 'Available' && bed.status !== 'Cleaning') {
      throw new InpatientDomainError(
        'BED_NOT_AVAILABLE',
        `That bed is not available (current status: ${bed.status ?? 'unknown'}).`,
        409,
      );
    }

    /* ---- One active admission per patient per facility ------ */

    const [existingAdmission] = await tx
      .select({ id: schema.admissions.id })
      .from(schema.admissions)
      .where(
        and(
          eq(schema.admissions.patientId, patient.id),
          eq(schema.admissions.facilityId, facility.id),
          eq(schema.admissions.status, ACTIVE_ADMISSION_STATUS),
        ),
      )
      .limit(1);

    if (existingAdmission) {
      throw new InpatientDomainError(
        'PATIENT_ALREADY_ADMITTED',
        'This patient already has an active admission at this facility.',
        409,
      );
    }

    /* ---- Insert admission ---------------------------------- */

    const [created] = await tx
      .insert(schema.admissions)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        patientId: patient.id,
        encounterId,
        wardId: ward.id,
        bedId: bed.id,
        admissionDate,
        admissionType,
        admittingDoctor: optionalText(input?.admittingDoctor, 120),
        provisionalDiagnosis: optionalText(input?.provisionalDiagnosis, 2000),
        nursingNotes: optionalText(input?.nursingNotes, 4000),
        status: ACTIVE_ADMISSION_STATUS,
      })
      .returning();

    /* ---- Occupy the bed in the same transaction ------------ */

    await tx
      .update(schema.beds)
      .set({
        status: 'Occupied',
        currentPatientId: patient.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.beds.id, bed.id));

    return created;
  });
}

/* ------------------------------------------------------------
   ADMISSIONS — DISCHARGE
   ------------------------------------------------------------ */

export interface DischargeAdmissionInput {
  dischargeDate?: string;
  dischargeType?: string | null;
  dischargeSummary?: string | null;
}

export async function dischargeAdmissionScoped(
  context: AuthorizationContext,
  admissionId: number,
  input: DischargeAdmissionInput,
) {
  const id = requirePositiveId(admissionId, 'admission ID');

  return await db.transaction(async (tx) => {
    const [admission] = await tx
      .select()
      .from(schema.admissions)
      .where(eq(schema.admissions.id, id))
      .limit(1);

    if (!admission) {
      throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
    }

    requireTenantScope(context, admission.tenantId);
    requireFacilityScope(context, admission.tenantId, admission.facilityId);

    if (admission.status !== ACTIVE_ADMISSION_STATUS) {
      throw new InpatientDomainError(
        'ADMISSION_ALREADY_CLOSED',
        `This admission is already closed (status: ${admission.status ?? 'unknown'}).`,
        409,
      );
    }

    const [updated] = await tx
      .update(schema.admissions)
      .set({
        status: CLOSED_ADMISSION_STATUS,
        dischargeDate: normaliseTimestamp(input?.dischargeDate),
        dischargeType: optionalText(input?.dischargeType, 120),
        dischargeSummary: optionalText(input?.dischargeSummary, 8000),
        updatedAt: new Date(),
      })
      .where(eq(schema.admissions.id, admission.id))
      .returning();

    /*
     * Release the bed recorded ON THE ADMISSION.
     *
     * A client-supplied bedId is never used here: doing so allowed one
     * patient's discharge to free another patient's bed. The patient
     * condition additionally prevents clobbering a bed that has since
     * been reassigned.
     */
    if (admission.bedId) {
      await tx
        .update(schema.beds)
        .set({
          status: 'Cleaning',
          currentPatientId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.beds.id, admission.bedId),
            eq(schema.beds.currentPatientId, admission.patientId),
          ),
        );
    }

    return updated;
  });
}

/* ------------------------------------------------------------
   BEDS — STATUS AND RELEASE
   ------------------------------------------------------------ */

export async function setBedStatusScoped(
  context: AuthorizationContext,
  bedId: number,
  nextStatus: unknown,
) {
  const id = requirePositiveId(bedId, 'bed ID');

  if (typeof nextStatus !== 'string' || !BED_STATUS_SET.has(nextStatus)) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `Bed status must be one of: ${BED_STATUSES.join(', ')}.`,
      400,
    );
  }

  if (!BED_STATUS_SETTABLE.has(nextStatus)) {
    throw new InpatientDomainError(
      'BED_STATUS_NOT_ALLOWED',
      'Bed occupancy is created by admitting a patient, not by changing bed status.',
      400,
    );
  }

  const { bed } = await requireBedInScope(context, id);

  if (
    bed.status === 'Occupied' ||
    (bed.currentPatientId !== null && bed.currentPatientId !== undefined)
  ) {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      'This bed is occupied. Discharge or transfer the patient first.',
      409,
    );
  }

  const [updated] = await db
    .update(schema.beds)
    .set({
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(schema.beds.id, bed.id))
    .returning();

  return updated;
}

/**
 * Release a cleaned bed back into service (Cleaning → Available).
 *
 * Without this, every discharge removes a bed from the usable board
 * permanently, because nothing else ever restores 'Available'.
 */
export async function releaseBedScoped(context: AuthorizationContext, bedId: number) {
  const id = requirePositiveId(bedId, 'bed ID');

  const { bed } = await requireBedInScope(context, id);

  if (bed.currentPatientId !== null && bed.currentPatientId !== undefined) {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      'This bed still has a patient assigned. Discharge or transfer the patient first.',
      409,
    );
  }

  if (bed.status !== 'Cleaning') {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      `Only beds in Cleaning can be released to Available (current status: ${bed.status ?? 'unknown'}).`,
      409,
    );
  }

  const [updated] = await db
    .update(schema.beds)
    .set({
      status: 'Available',
      currentPatientId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.beds.id, bed.id))
    .returning();

  return updated;
}

// Operating Theatres
export async function getTheatreCases(facilityId?: number) {
  try {
    if (facilityId) {
      return await db
        .select()
        .from(schema.theatreCases)
        .where(eq(schema.theatreCases.facilityId, facilityId))
        .orderBy(desc(schema.theatreCases.createdAt));
    }
    return await db.select().from(schema.theatreCases).orderBy(desc(schema.theatreCases.createdAt));
  } catch (error) {
    log.error({ err: error }, 'theatre_cases.fetch_failed');
    throw new Error('Failed to fetch theatre cases', { cause: error });
  }
}

/**
 * Read one theatre case inside a facility.
 *
 * `updateTheatreCase` takes only an id. Without this check, any caller
 * who reached the route could rewrite a case belonging to another
 * facility by guessing its number.
 */
export async function getTheatreCaseScoped(id: number, facilityId: number) {
  const [row] = await db
    .select()
    .from(schema.theatreCases)
    .where(and(eq(schema.theatreCases.id, id), eq(schema.theatreCases.facilityId, facilityId)))
    .limit(1);

  return row ?? null;
}

export async function createTheatreCase(data: typeof schema.theatreCases.$inferInsert) {
  try {
    const res = await db.insert(schema.theatreCases).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'theatre_case.create_failed');
    throw new Error('Failed to schedule theatre case', { cause: error });
  }
}

export async function updateTheatreCase(
  id: number,
  data: Partial<typeof schema.theatreCases.$inferInsert>,
) {
  try {
    const res = await db
      .update(schema.theatreCases)
      .set(data)
      .where(eq(schema.theatreCases.id, id))
      .returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'theatre_case.update_failed');
    throw new Error('Failed to update theatre case', { cause: error });
  }
}
// ============================================================
// INPATIENT: TRANSFERS, BED-DAY ACCRUAL AND NURSING NOTES
// ============================================================

/**
 * Accrue one bed-day charge per calendar night of a stay.
 *
 * The stay is split into one segment per occupied ward, using the
 * admission ward and the transfer history (`bedDaySegments`). Each night
 * is priced by the ward the patient actually slept in, so:
 *
 *   - a General night is never quietly billed at the ICU rate, or the
 *     other way round;
 *   - two wards never compete for the same date;
 *   - the total is still one charge per night of the stay.
 *
 * Charge keys stay ``BED_DAY:<admissionId>:<date>``. Segments are
 * disjoint by construction, so the key that has always meant "this
 * night, once" keeps meaning that — re-running discharge, a transfer or
 * a nightly job cannot re-bill a night that is already on the invoice.
 *
 * A night no tariff can price is recorded as an unpriced charge (the
 * invoice line is skipped, the night is reported) rather than throwing:
 * a discharge must never be lost because the price list is incomplete.
 */
export async function accrueBedDaysScoped(
  context: AuthorizationContext,
  admissionId: number,
  untilDate?: string | null,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) {
    throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
  }

  /*
   * Wards of this facility, once. The ward the patient is in today is
   * not enough: each segment is priced from the ward occupied then.
   */
  const wardRows = await db
    .select({
      id: schema.wards.id,
      code: schema.wards.code,
      name: schema.wards.name,
      wardType: schema.wards.wardType,
      facilityId: schema.wards.facilityId,
    })
    .from(schema.wards)
    .where(eq(schema.wards.facilityId, admission.facilityId));

  const wardsById = new Map(wardRows.map((ward) => [ward.id, ward]));

  const transfers = await db
    .select({
      fromWardId: schema.admissionTransfers.fromWardId,
      toWardId: schema.admissionTransfers.toWardId,
      transferredAt: schema.admissionTransfers.transferredAt,
    })
    .from(schema.admissionTransfers)
    .where(eq(schema.admissionTransfers.admissionId, admission.id))
    .orderBy(schema.admissionTransfers.transferredAt);

  const segments = bedDaySegments({
    admissionDate: admission.admissionDate,
    dischargeDate: admission.dischargeDate ?? null,
    untilDate: untilDate ?? null,
    homeWard: wardsById.get(admission.wardId) ?? null,
    transfers: transfers.map((transfer) => ({
      fromWardId: transfer.fromWardId,
      toWardId: transfer.toWardId,
      transferredAt: transfer.transferredAt,
      ward: wardsById.get(transfer.toWardId) ?? null,
      fromWard: transfer.fromWardId ? (wardsById.get(transfer.fromWardId) ?? null) : null,
    })),
  });

  const charges: Array<ChargeResult | null> = [];
  let nights = 0;

  for (const segment of segments) {
    const ward = segment.ward;

    for (const date of segment.dates) {
      nights += 1;

      charges.push(
        await chargeAndRecord(db, {
          tenantId: admission.tenantId,
          facilityId: admission.facilityId,
          patientId: admission.patientId,
          encounterId: admission.encounterId ?? null,
          /*
           * Ward-specific link keys only: an explicit link to *this*
           * ward's bed day, never a blanket "any bed" link that would
           * let a general rate price an ICU night.
           */
          serviceKeys: billingServiceKeys('BED_DAY', [ward?.code, ward?.name]),
          codes: bedDayTariffCodes(ward?.code),
          family: 'BED_DAY',
          serviceName: 'bed day',
          wardType: ward?.wardType ?? null,
          wardName: ward?.name ?? null,
          /* A ward-level link, when the facility made one, wins. */
          ...(ward
            ? {
                serviceRef: {
                  type: 'BED_DAY' as const,
                  id: ward.id,
                  code: ward.code,
                },
              }
            : {}),
          sourceType: 'BED_DAY',
          sourceId: admission.id,
          idempotencySuffix: date,
          itemType: 'Inpatient',
          description: `${ward?.name ?? 'Ward'} bed — ${date}`,
        }),
      );
    }
  }

  return { nights, charges, segments };
}

/* Bed-night tariff code precedence lives in the billing module. */

export interface TransferAdmissionInput {
  toWardId: number;
  toBedId: number;
  reason?: string | null;
  transferredBy: string;
}

/**
 * Move an admitted patient to another ward/bed inside the facility.
 *
 * The old bed is released to Cleaning and the new bed occupied in the
 * same transaction, so the board can never show a patient in two beds.
 */
export async function transferAdmissionScoped(
  context: AuthorizationContext,
  admissionId: number,
  input: TransferAdmissionInput,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) {
    throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
  }

  if (admission.status !== 'Admitted') {
    throw new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'Only an active admission can be transferred.',
      409,
    );
  }

  const toWardId = Number(input?.toWardId);
  const toBedId = Number(input?.toBedId);

  if (!Number.isSafeInteger(toWardId) || toWardId <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid destination ward is required.', 400);
  }

  if (!Number.isSafeInteger(toBedId) || toBedId <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid destination bed is required.', 400);
  }

  return await db.transaction(async (tx) => {
    const [ward] = await tx
      .select()
      .from(schema.wards)
      .where(and(eq(schema.wards.id, toWardId), eq(schema.wards.facilityId, admission.facilityId)))
      .limit(1);

    if (!ward) {
      throw new InpatientDomainError(
        'WARD_NOT_FOUND',
        'Destination ward not found in this facility.',
        404,
      );
    }

    const [bed] = await tx
      .select()
      .from(schema.beds)
      .where(and(eq(schema.beds.id, toBedId), eq(schema.beds.wardId, ward.id)))
      .limit(1);

    if (!bed) {
      throw new InpatientDomainError(
        'BED_NOT_FOUND',
        'Destination bed not found in that ward.',
        404,
      );
    }

    const [activeOnBed] = await tx
      .select({ id: schema.admissions.id })
      .from(schema.admissions)
      .where(and(eq(schema.admissions.bedId, bed.id), eq(schema.admissions.status, 'Admitted')))
      .limit(1);

    if (activeOnBed) {
      throw new InpatientDomainError(
        'BED_OCCUPIED',
        'The destination bed already has an active admission.',
        409,
      );
    }

    if (bed.status !== 'Available' && bed.status !== 'Cleaning') {
      throw new InpatientDomainError(
        'BED_NOT_AVAILABLE',
        `The destination bed is not available (current status: ${bed.status ?? 'unknown'}).`,
        409,
      );
    }

    if (bed.id === admission.bedId) {
      throw new InpatientDomainError('INVALID_INPUT', 'The patient is already in that bed.', 400);
    }

    const [transfer] = await tx
      .insert(schema.admissionTransfers)
      .values({
        tenantId: admission.tenantId,
        facilityId: admission.facilityId,
        admissionId: admission.id,
        patientId: admission.patientId,
        fromWardId: admission.wardId,
        fromBedId: admission.bedId,
        toWardId: ward.id,
        toBedId: bed.id,
        reason: typeof input.reason === 'string' ? input.reason.trim() : null,
        transferredBy: input.transferredBy,
        transferredByUserId: context.userId,
      })
      .returning();

    const [updated] = await tx
      .update(schema.admissions)
      .set({
        wardId: ward.id,
        bedId: bed.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.admissions.id, admission.id))
      .returning();

    /* Release the old bed only if it still holds this patient. */
    if (admission.bedId) {
      await tx
        .update(schema.beds)
        .set({
          status: 'Cleaning',
          currentPatientId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.beds.id, admission.bedId),
            eq(schema.beds.currentPatientId, admission.patientId),
          ),
        );
    }

    await tx
      .update(schema.beds)
      .set({
        status: 'Occupied',
        currentPatientId: admission.patientId,
        updatedAt: new Date(),
      })
      .where(eq(schema.beds.id, bed.id));

    return { transfer, admission: updated };
  });
}

export async function getAdmissionTransfersScoped(
  context: AuthorizationContext,
  admissionId: number,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);

  if (!admission) return [];

  return db
    .select()
    .from(schema.admissionTransfers)
    .where(eq(schema.admissionTransfers.admissionId, admission.id))
    .orderBy(desc(schema.admissionTransfers.transferredAt));
}

export interface CreateNursingNoteInput {
  admissionId?: number | null;
  patientId: number;
  encounterId?: number | null;
  noteType?: string;
  shift?: string | null;
  note: string;
  recordedBy: string;
}

export async function createNursingNoteScoped(
  context: AuthorizationContext,
  input: CreateNursingNoteInput,
) {
  const patientId = Number(input?.patientId);

  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid patient is required.', 400);
  }

  const note = typeof input?.note === 'string' ? input.note.trim() : '';

  if (!note) {
    throw new InpatientDomainError('INVALID_INPUT', 'A nursing note cannot be empty.', 400);
  }

  if (note.length > 8000) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A nursing note must be 8000 characters or fewer.',
      400,
    );
  }

  const noteType = NURSING_NOTE_TYPES.has(String(input.noteType))
    ? String(input.noteType)
    : 'Progress';

  let admissionId: number | null = null;
  let tenantId: number;
  let facilityId: number;

  if (input.admissionId !== undefined && input.admissionId !== null) {
    const admission = await getAdmissionByIdScoped(context, Number(input.admissionId));

    if (!admission) {
      throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
    }

    if (admission.patientId !== patientId) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        'The patient does not match that admission.',
        400,
      );
    }

    admissionId = admission.id;
    tenantId = admission.tenantId;
    facilityId = admission.facilityId;
  } else {
    const patient = await requirePatientInTenant(context, patientId, context.tenantId ?? 0);

    if (!patient) {
      throw new InpatientDomainError(
        'PATIENT_NOT_FOUND',
        'Patient not found in the authorised tenant.',
        404,
      );
    }

    const facility = await requireInpatientFacility(context);

    tenantId = facility.tenantId;
    facilityId = facility.id;
  }

  const [created] = await db
    .insert(schema.nursingNotes)
    .values({
      tenantId,
      facilityId,
      patientId,
      admissionId,
      encounterId:
        input.encounterId === undefined || input.encounterId === null
          ? null
          : Number(input.encounterId),
      noteType,
      shift:
        typeof input.shift === 'string' && input.shift.trim()
          ? input.shift.trim().slice(0, 20)
          : null,
      note,
      recordedBy:
        typeof input.recordedBy === 'string' && input.recordedBy.trim()
          ? input.recordedBy.trim().slice(0, 120)
          : 'Unknown',
      recordedByUserId: context.userId,
    })
    .returning();

  return created;
}

export async function getNursingNotesScoped(
  context: AuthorizationContext,
  filters: { admissionId?: number; patientId?: number },
) {
  const conditions = [];

  if (filters.admissionId !== undefined) {
    const admission = await getAdmissionByIdScoped(context, Number(filters.admissionId));

    if (!admission) return [];

    conditions.push(eq(schema.nursingNotes.admissionId, admission.id));
  }

  if (filters.patientId !== undefined) {
    const patientId = Number(filters.patientId);

    if (!Number.isSafeInteger(patientId) || patientId <= 0) {
      throw new InpatientDomainError('INVALID_INPUT', 'A valid patient ID is required.', 400);
    }

    await requirePatientInTenant(context, patientId, context.tenantId ?? 0);

    conditions.push(eq(schema.nursingNotes.patientId, patientId));
  }

  if (conditions.length === 0) {
    const facility = await requireInpatientFacility(context);

    conditions.push(eq(schema.nursingNotes.facilityId, facility.id));
  }

  return db
    .select()
    .from(schema.nursingNotes)
    .where(and(...conditions))
    .orderBy(desc(schema.nursingNotes.recordedAt))
    .limit(200);
}
