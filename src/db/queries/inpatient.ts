/**
 * JaliCare HMIS
 * Queries: Wards, beds, admissions, transfers, nursing notes, theatre, bed-day accrual
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm';
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

import {
  requireTenantScope,
  requireFacilityScope,
  resolveFacilityScope,
} from '../../auth/scope.service.ts';
import { hasAllPermissions } from '../../auth/authorization.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import type { ChargeResult } from '../../billing/billing.service.ts';
import { chargeAndRecord, recordChargeAttempt } from '../../billing/charge-attempts.ts';
import { admissionChargeRequest } from '../../billing/service-charges.ts';
import { databaseNow } from '../../inpatient/bed-evidence.ts';
import { selectBedRate } from '../../inpatient/bed-rate.ts';
import {
  captureBedPeriod,
  captureBedStay,
  closeCurrentBedPeriod,
  getBedBillingView,
  markBedBillingStaged,
  requireSelectedAdmissionFacility,
  stageDischargedBedNights,
} from '../../inpatient/bed-billing.service.ts';

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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Keep the state change and its minimal audit entry in the same transaction.
async function auditAdmission(
  tx: Transaction,
  context: AuthorizationContext,
  admission: { id: number; tenantId: number; facilityId: number },
  action: 'CREATE' | 'UPDATE',
  details: string,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: admission.tenantId,
    facilityId: admission.facilityId,
    userId: String(context.userId),
    action,
    resource: 'Admission',
    resourceId: String(admission.id),
    details,
  });
}

/** Do not hide or overwrite a pre-existing occupancy inconsistency. */
async function lockCurrentAdmissionBed(
  tx: Transaction,
  admission: { bedId: number; wardId: number; patientId: number },
) {
  const [bed] = await tx
    .select()
    .from(schema.beds)
    .where(eq(schema.beds.id, admission.bedId))
    .limit(1)
    .for('update');
  if (
    !bed ||
    bed.wardId !== admission.wardId ||
    bed.status !== 'Occupied' ||
    bed.currentPatientId !== admission.patientId
  ) {
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      'The admission and bed occupancy disagree; authorized reconciliation is required.',
      409,
    );
  }
}

/** Map the additive database guards, including errors wrapped by Drizzle. */
function admissionConstraintError(error: unknown): InpatientDomainError | null {
  let cause = error;
  for (let i = 0; i < 5 && cause && typeof cause === 'object'; i++) {
    const info = cause as { code?: string; constraint?: string; cause?: unknown };
    if (info.code === '23505' && info.constraint === 'admissions_active_bed_uq')
      return new InpatientDomainError(
        'BED_OCCUPIED',
        'That bed already has an active admission.',
        409,
      );
    if (info.code === '23505' && info.constraint === 'admissions_active_facility_patient_uq')
      return new InpatientDomainError(
        'PATIENT_ALREADY_ADMITTED',
        'This patient already has an active admission at this facility.',
        409,
      );
    cause = info.cause;
  }
  return null;
}

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

export async function getBedsScoped(
  context: AuthorizationContext,
  wardId?: number | null,
  requestedFacilityId?: number | null,
) {
  if (wardId !== undefined && wardId !== null) {
    const id = requirePositiveId(wardId, 'ward ID');

    const [ward] = await db.select().from(schema.wards).where(eq(schema.wards.id, id)).limit(1);

    if (!ward) {
      throw new InpatientDomainError('WARD_NOT_FOUND', 'Ward not found.', 404);
    }

    const facility = await getFacilityByIdScoped(context, ward.facilityId);

    if (!facility || resolveFacilityScope(context, requestedFacilityId) !== ward.facilityId) {
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

  const facility = await requireInpatientFacility(context, requestedFacilityId);

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
  facilityServiceId?: number | null;
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

  const manualAdmissionTime =
    typeof input?.admissionDate === 'string' && input.admissionDate.trim().length > 0;
  const admissionType = optionalText(input?.admissionType, 60) ?? 'Emergency';

  try {
    return await db.transaction(async (tx) => {
      // Serialize admissions of the same patient, including attempts at different beds.
      const [lockedPatient] = await tx
        .select({
          id: schema.patients.id,
          registrationFacilityId: schema.patients.registrationFacilityId,
        })
        .from(schema.patients)
        .where(
          and(eq(schema.patients.id, patient.id), eq(schema.patients.tenantId, facility.tenantId)),
        )
        .limit(1)
        .for('update');
      if (!lockedPatient)
        throw new InpatientDomainError(
          'PATIENT_NOT_FOUND',
          'Patient not found in the authorised facility.',
          404,
        );
      // Preserve documented referrals without allowing an arbitrary same-tenant
      // patient ID to cross facility boundaries. Existing patient-list access
      // policies remain unchanged; this does not invent a referral or consent.
      if (lockedPatient.registrationFacilityId !== facility.id) {
        const [relationship] = await tx
          .select({ id: schema.patientFacilities.id })
          .from(schema.patientFacilities)
          .where(
            and(
              eq(schema.patientFacilities.patientId, patient.id),
              eq(schema.patientFacilities.tenantId, facility.tenantId),
              eq(schema.patientFacilities.facilityId, facility.id),
              eq(schema.patientFacilities.status, 'ACTIVE'),
            ),
          )
          .limit(1)
          .for('share');
        if (!relationship)
          throw new InpatientDomainError(
            'PATIENT_NOT_FOUND',
            'Patient not found in the authorised facility.',
            404,
          );
      }
      const [ward] = await tx
        .select()
        .from(schema.wards)
        .where(and(eq(schema.wards.id, wardId), eq(schema.wards.facilityId, facility.id)))
        .limit(1)
        .for('share');

      if (!ward) {
        throw new InpatientDomainError(
          'WARD_NOT_FOUND',
          'Ward not found in the authorised facility.',
          404,
        );
      }
      if (ward.isActive === false) {
        throw new InpatientDomainError(
          'WARD_RETIRED',
          'A retired ward cannot accept new admissions.',
          409,
        );
      }

      const [bed] = await tx
        .select()
        .from(schema.beds)
        .where(and(eq(schema.beds.id, bedId), eq(schema.beds.wardId, ward.id)))
        .limit(1)
        .for('update');

      if (!bed) {
        throw new InpatientDomainError('BED_NOT_FOUND', 'Bed not found in the selected ward.', 404);
      }

      /* Database assignment time is authoritative for policy and occupancy. */
      const assignedAt = await databaseNow(tx);
      if (encounterId !== null) {
        if (!hasAllPermissions(context, ['clinical.read']))
          throw new InpatientDomainError(
            'ENCOUNTER_PERMISSION_REQUIRED',
            'Clinical read permission is required to link an existing encounter.',
            403,
          );
        // Encounter timestamps are stored without a timezone. JaliCare writes
        // new timestamps as UTC; interpret them explicitly rather than using
        // the Node host timezone. Historical origin still requires review.
        const [encounter] = await tx
          .select({
            id: schema.encounters.id,
            encounterType: schema.encounters.encounterType,
            status: schema.encounters.status,
            startedAt: sql<Date>`${schema.encounters.startedAt} AT TIME ZONE 'UTC'`.mapWith(
              (value: string) => new Date(value),
            ),
            endedAt: sql<Date | null>`${schema.encounters.endedAt} AT TIME ZONE 'UTC'`.mapWith(
              (value: string) => new Date(value),
            ),
          })
          .from(schema.encounters)
          .where(
            and(
              eq(schema.encounters.id, encounterId),
              eq(schema.encounters.tenantId, facility.tenantId),
              eq(schema.encounters.patientId, patient.id),
              eq(schema.encounters.facilityId, facility.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!encounter)
          throw new InpatientDomainError(
            'ENCOUNTER_NOT_FOUND',
            'Encounter not found for this patient at this facility.',
            404,
          );
        if (
          encounter.encounterType.trim().toUpperCase() !== 'INPATIENT' ||
          encounter.status.trim().toUpperCase() !== 'ACTIVE' ||
          encounter.endedAt ||
          encounter.startedAt > assignedAt
        )
          throw new InpatientDomainError(
            'ENCOUNTER_NOT_ELIGIBLE',
            'Choose an active inpatient encounter that has started for this admission.',
            409,
          );
        const [alreadyLinked] = await tx
          .select({ id: schema.admissions.id })
          .from(schema.admissions)
          .where(eq(schema.admissions.encounterId, encounterId))
          .limit(1);
        if (alreadyLinked)
          throw new InpatientDomainError(
            'ENCOUNTER_ALREADY_LINKED',
            'This encounter is already linked to an admission.',
            409,
          );
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

      if (bed.status !== 'Available' || bed.currentPatientId != null) {
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

      /* ---- Persist the admission service identity at creation ------- */
      let admissionServiceId: number | null = null;
      if (input.facilityServiceId !== undefined && input.facilityServiceId !== null) {
        const selectedId = requirePositiveId(input.facilityServiceId, 'admission service ID');
        const [selected] = await tx
          .select({ id: schema.facilityServices.id })
          .from(schema.facilityServices)
          .where(
            and(
              eq(schema.facilityServices.id, selectedId),
              eq(schema.facilityServices.tenantId, facility.tenantId),
              eq(schema.facilityServices.facilityId, facility.id),
              eq(schema.facilityServices.category, 'ADMISSION'),
              eq(schema.facilityServices.isActive, true),
            ),
          )
          .limit(1)
          .for('share');
        if (!selected)
          throw new InpatientDomainError(
            'INVALID_ADMISSION_SERVICE',
            'The selected admission service is unavailable in this facility.',
            400,
          );
        admissionServiceId = selected.id;
      } else {
        const choices = await tx
          .select({ id: schema.facilityServices.id })
          .from(schema.facilityServices)
          .where(
            and(
              eq(schema.facilityServices.tenantId, facility.tenantId),
              eq(schema.facilityServices.facilityId, facility.id),
              eq(schema.facilityServices.category, 'ADMISSION'),
              eq(schema.facilityServices.isActive, true),
            ),
          )
          .limit(2)
          .for('share');
        if (choices.length === 1) admissionServiceId = choices[0].id;
      }
      const admissionDate = manualAdmissionTime
        ? normaliseTimestamp(input.admissionDate)
        : assignedAt.toISOString();

      // Admission-only staff can still provide care, but must not gain the
      // separate clinical.create capability. Record the limitation below.
      if (
        encounterId === null &&
        !manualAdmissionTime &&
        hasAllPermissions(context, ['clinical.create'])
      ) {
        const [encounter] = await tx
          .insert(schema.encounters)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            patientId: patient.id,
            encounterType: 'INPATIENT',
            status: 'ACTIVE',
            startedAt: assignedAt,
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          })
          .returning();
        encounterId = encounter.id;
        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(context.userId),
          action: 'CREATE',
          resource: 'Encounter',
          resourceId: String(encounter.id),
          details:
            'Inpatient encounter created transactionally for admission; no care or consultation was recorded.',
        });
      }

      /* ---- Insert admission ---------------------------------- */

      const [created] = await tx
        .insert(schema.admissions)
        .values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          patientId: patient.id,
          encounterId,
          facilityServiceId: admissionServiceId,
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

      /* Freeze the policy, bed identity and daily rate under the bed lock. */
      const bedBillingIssues = await captureBedStay(
        tx,
        context,
        created,
        bed,
        ward,
        assignedAt,
        manualAdmissionTime,
      );
      if (encounterId === null)
        bedBillingIssues.push({
          code: 'BED_ENCOUNTER_REQUIRED',
          message: manualAdmissionTime
            ? 'A manually timed admission requires a verified historical inpatient encounter; none was created automatically.'
            : 'An inpatient encounter could not be created without clinical.create permission; authorized linking and billing review are required.',
        });

      /* ---- Occupy the bed in the same transaction ------------ */

      await tx
        .update(schema.beds)
        .set({
          status: 'Occupied',
          currentPatientId: patient.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.beds.id, bed.id));

      const attempt = await recordChargeAttempt(tx, admissionChargeRequest(created), {
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED',
        message: 'Admission recorded; billing evaluation pending.',
      });
      if (attempt === null) throw new Error('ADMISSION_BILLING_QUEUE_UNAVAILABLE');
      await auditAdmission(tx, context, created, 'CREATE', 'Admission created.');
      return {
        ...created,
        bedBillingReadiness: { ready: bedBillingIssues.length === 0, issues: bedBillingIssues },
      };
    });
  } catch (error) {
    throw admissionConstraintError(error) ?? error;
  }
}

/* ------------------------------------------------------------
   ADMISSIONS — DISCHARGE
   ------------------------------------------------------------ */

export interface DischargeAdmissionInput {
  facilityId?: number;
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
      .limit(1)
      .for('update');

    if (!admission) {
      throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
    }

    requireSelectedAdmissionFacility(context, admission, input?.facilityId);

    if (admission.status !== ACTIVE_ADMISSION_STATUS) {
      throw new InpatientDomainError(
        'ADMISSION_ALREADY_CLOSED',
        `This admission is already closed (status: ${admission.status ?? 'unknown'}).`,
        409,
      );
    }

    await lockCurrentAdmissionBed(tx, admission);
    const dischargedAt = await databaseNow(tx);
    const manualDischargeTime =
      typeof input?.dischargeDate === 'string' && input.dischargeDate.trim().length > 0;
    await closeCurrentBedPeriod(tx, admission, dischargedAt);
    if (manualDischargeTime) {
      await tx
        .update(schema.inpatientBedStaySnapshots)
        .set({ manualDischargeTime: true })
        .where(eq(schema.inpatientBedStaySnapshots.admissionId, admission.id));
    }

    const [updated] = await tx
      .update(schema.admissions)
      .set({
        status: CLOSED_ADMISSION_STATUS,
        dischargeDate: manualDischargeTime
          ? normaliseTimestamp(input.dischargeDate)
          : dischargedAt.toISOString(),
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

    // Commit a durable, scoped work identity with the clinical discharge.
    // Bed-night calculation and invoice/queue writes occur after this commits,
    // so their failure cannot leave a discharged patient occupying the bed.
    await tx.insert(schema.inpatientBedBillingWork).values({
      admissionId: updated.id,
      tenantId: updated.tenantId,
      facilityId: updated.facilityId,
      patientId: updated.patientId,
      recordedByUserId: context.userId,
    });
    await auditAdmission(
      tx,
      context,
      updated,
      'UPDATE',
      'Admission discharged; bed billing work recorded.',
    );
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
    .where(
      and(
        eq(schema.beds.id, bed.id),
        isNull(schema.beds.currentPatientId),
        ne(schema.beds.status, 'Occupied'),
        notExists(
          db
            .select({ id: schema.admissions.id })
            .from(schema.admissions)
            .where(
              and(
                eq(schema.admissions.bedId, schema.beds.id),
                eq(schema.admissions.status, ACTIVE_ADMISSION_STATUS),
              ),
            ),
        ),
      ),
    )
    .returning();

  if (!updated)
    throw new InpatientDomainError(
      'BED_STATUS_CONFLICT',
      'Bed occupancy or status changed; refresh and try again.',
      409,
    );
  return updated;
}

/**
 * Release a cleaned bed back into service (Cleaning → Available).
 *
 * Without this, every discharge removes a bed from the usable board
 * permanently, because nothing else ever restores 'Available'.
 */
export async function releaseBedScoped(
  context: AuthorizationContext,
  bedId: number,
  requestedFacilityId?: number,
) {
  const id = requirePositiveId(bedId, 'bed ID');

  const { bed, ward, facility } = await requireBedInScope(context, id);
  requireSelectedAdmissionFacility(
    context,
    { tenantId: facility.tenantId, facilityId: ward.facilityId },
    requestedFacilityId,
  );

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

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.beds)
      .set({
        status: 'Available',
        currentPatientId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.beds.id, bed.id),
          eq(schema.beds.status, 'Cleaning'),
          isNull(schema.beds.currentPatientId),
          notExists(
            tx
              .select({ id: schema.admissions.id })
              .from(schema.admissions)
              .where(
                and(
                  eq(schema.admissions.bedId, schema.beds.id),
                  eq(schema.admissions.status, ACTIVE_ADMISSION_STATUS),
                ),
              ),
          ),
        ),
      )
      .returning();

    if (!updated)
      throw new InpatientDomainError(
        'BED_STATUS_CONFLICT',
        'Bed occupancy or status changed; refresh and try again.',
        409,
      );
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(context.userId),
      action: 'UPDATE',
      resource: 'Bed',
      resourceId: String(updated.id),
      details: 'Bed released to Available after terminal cleaning',
    });
    return updated;
  });
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
 * Bed billing is calculated only after discharge: before then a later
 * transfer, same-day rule or grace period could change the final answer.
 * Clinical discharge commits a durable work marker before staging the nights.
 */
export async function accrueBedDaysScoped(
  context: AuthorizationContext,
  admissionId: number,
  untilDate?: string | null,
  requestedFacilityId?: number,
) {
  const admission = await getAdmissionByIdScoped(context, admissionId);
  if (!admission)
    throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
  requireSelectedAdmissionFacility(context, admission, requestedFacilityId);
  if (untilDate && !/^\d{4}-\d{2}-\d{2}$/.test(untilDate))
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Enter an ISO date for the accrual limit.',
      400,
    );
  if (admission.status === ACTIVE_ADMISSION_STATUS) {
    const view = await getBedBillingView(context, admission.id, requestedFacilityId);
    return {
      nights: view.nights,
      charges: [] as ChargeResult[],
      segments: [],
      review: view.review,
      estimateOnly: true,
    };
  }
  const staged = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.admissions)
      .where(eq(schema.admissions.id, admission.id))
      .for('update');
    if (
      !locked ||
      locked.tenantId !== admission.tenantId ||
      locked.facilityId !== admission.facilityId
    )
      throw new Error('BED_ADMISSION_SCOPE_CHANGED');
    const result = await stageDischargedBedNights(tx, locked, await databaseNow(tx));
    await markBedBillingStaged(tx, locked, context.userId);
    return result;
  });
  if (staged.review)
    return {
      nights: null,
      segments: [],
      review: staged.review,
      estimateOnly: false,
      charges: [
        { charged: false, reason: 'BED_OCCUPANCY_REVIEW' as const, message: staged.review.message },
      ],
    };
  const requests = untilDate
    ? staged.requests.filter((r) => r.serviceDate && r.serviceDate <= untilDate)
    : staged.requests;
  const charges: Array<ChargeResult | null> = [];
  for (const request of requests) charges.push(await chargeAndRecord(db, request));
  return { nights: requests.length, charges, segments: [], review: null, estimateOnly: false };
}

export interface TransferAdmissionInput {
  facilityId?: number;
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
  const id = requirePositiveId(admissionId, 'admission ID');
  const toWardId = Number(input?.toWardId);
  const toBedId = Number(input?.toBedId);

  if (!Number.isSafeInteger(toWardId) || toWardId <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid destination ward is required.', 400);
  }

  if (!Number.isSafeInteger(toBedId) || toBedId <= 0) {
    throw new InpatientDomainError('INVALID_INPUT', 'A valid destination bed is required.', 400);
  }

  try {
    return await db.transaction(async (tx) => {
      // The admission must be re-read under lock, not from a stale pre-transaction snapshot.
      const [admission] = await tx
        .select()
        .from(schema.admissions)
        .where(eq(schema.admissions.id, id))
        .limit(1)
        .for('update');
      if (!admission)
        throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
      requireSelectedAdmissionFacility(context, admission, input?.facilityId);
      if (admission.status !== ACTIVE_ADMISSION_STATUS)
        throw new InpatientDomainError(
          'ADMISSION_ALREADY_CLOSED',
          'Only an active admission can be transferred.',
          409,
        );
      const [ward] = await tx
        .select()
        .from(schema.wards)
        .where(
          and(eq(schema.wards.id, toWardId), eq(schema.wards.facilityId, admission.facilityId)),
        )
        .limit(1)
        .for('share');

      if (!ward) {
        throw new InpatientDomainError(
          'WARD_NOT_FOUND',
          'Destination ward not found in this facility.',
          404,
        );
      }
      if (ward.isActive === false) {
        throw new InpatientDomainError(
          'WARD_RETIRED',
          'A retired ward cannot accept a transfer.',
          409,
        );
      }

      const [bed] = await tx
        .select()
        .from(schema.beds)
        .where(and(eq(schema.beds.id, toBedId), eq(schema.beds.wardId, ward.id)))
        .limit(1)
        .for('update');

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

      if (bed.status !== 'Available' || bed.currentPatientId != null) {
        throw new InpatientDomainError(
          'BED_NOT_AVAILABLE',
          `The destination bed is not available (current status: ${bed.status ?? 'unknown'}).`,
          409,
        );
      }

      if (bed.id === admission.bedId) {
        throw new InpatientDomainError('INVALID_INPUT', 'The patient is already in that bed.', 400);
      }

      await lockCurrentAdmissionBed(tx, admission);
      const transferredAt = await databaseNow(tx);
      await closeCurrentBedPeriod(tx, admission, transferredAt);
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
          transferredAt,
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

      await captureBedPeriod(tx, context, updated, bed, ward, transferredAt);
      const rate = selectBedRate(bed, ward);
      await auditAdmission(tx, context, updated, 'UPDATE', 'Admission transferred.');
      return {
        transfer,
        admission: updated,
        bedBillingReadiness: { ready: !rate.issue, issues: rate.issue ? [rate.issue] : [] },
      };
    });
  } catch (error) {
    throw admissionConstraintError(error) ?? error;
  }
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
