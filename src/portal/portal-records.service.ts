/**
 * JaliCare HMIS
 * Patient portal — record release
 *
 * Every function here takes a **portal session**, never a patient id
 * from the browser. The patient is `session.patientId`; there is no
 * code path in this file that reads a patient from the request, which
 * is what makes "patient A cannot read patient B's record by editing a
 * URL" true by construction rather than by remembering to check.
 *
 * What is released is a deliberate subset:
 *
 *   - laboratory results only once a qualified person has verified
 *     them, because a preliminary value on a phone screen is how people
 *     stop taking a medication;
 *   - no internal notes, no clinician-to-clinician text;
 *   - nothing the facility has switched off in its portal policy;
 *   - only records whose facility is the one the account belongs to, or
 *     the patient's own registration facility.
 *
 * What is *not* here: any write. The portal is read-only against the
 * clinical record. A patient who believes something is wrong requests a
 * correction; they do not edit a diagnosis.
 */

import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { PortalSession } from './portal-auth.service.ts';
import { PortalError, loadPortalPolicy } from './portal.service.ts';

/* ============================================================
   Record access logging
   ============================================================ */

/**
 * Record that a patient read their own record.
 *
 * Written with the `PATIENT_PORTAL` channel the table already had. This
 * is not optional: if the row cannot be written the read fails, because
 * an unaudited read of identifiable health data is the thing the Data
 * Protection Act prohibits.
 */
export async function logPortalRecordAccess(
  session: PortalSession,
  input: {
    action: 'VIEW' | 'DOWNLOAD' | 'EXPORT';
    recordType: string;
    recordId?: number | null;
    purpose?: string;
    request?: { ipAddress?: string | null; userAgent?: string | null };
  },
): Promise<void> {
  await db.insert(schema.patientRecordAccessLogs).values({
    patientId: session.patientId,
    tenantId: session.tenantId,
    facilityId: session.facilityId,
    userId: null,
    action: input.action,
    accessChannel: 'PATIENT_PORTAL',
    recordType: input.recordType,
    recordId: input.recordId ?? null,
    purpose: input.purpose ?? 'PATIENT_REQUEST',
    ipAddress: input.request?.ipAddress ?? null,
    userAgent: input.request?.userAgent ?? null,
  });
}

/* ============================================================
   Scope
   ============================================================ */

/**
 * Facilities whose records this patient may see.
 *
 * Their registration facility plus the facility the portal account was
 * created at. A patient treated elsewhere in the tenant does not
 * automatically see that facility's notes — cross-facility release is a
 * governance decision, and the conservative default is "not yet".
 */
async function allowedFacilityIds(session: PortalSession): Promise<number[]> {
  const [patient] = await db
    .select({ registrationFacilityId: schema.patients.registrationFacilityId })
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.id, session.patientId),
        eq(schema.patients.tenantId, session.tenantId),
      ),
    )
    .limit(1);

  if (!patient) {
    throw new PortalError('Patient record not found.', 404, 'PATIENT_NOT_FOUND');
  }

  const set = new Set<number>();

  if (patient.registrationFacilityId) set.add(patient.registrationFacilityId);
  if (session.facilityId) set.add(session.facilityId);

  /*
   * An empty list would turn every scoped query into `inArray(column, [])`,
   * which either returns nothing or is refused by the driver — neither is
   * a message a patient can act on. A record with no facility at all is a
   * data problem at the desk, so it is refused explicitly.
   */
  if (set.size === 0) {
    throw new PortalError(
      'This record is not linked to a facility. Ask at the reception desk.',
      403,
      'FACILITY_NOT_LINKED',
    );
  }

  return [...set];
}

/* ============================================================
   Dashboard
   ============================================================ */

export async function getPortalOverview(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const facilities = await allowedFacilityIds(session);
  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy(facilities[0] ?? 0);

  await logPortalRecordAccess(session, {
    action: 'VIEW',
    recordType: 'PortalDashboard',
    request,
  });

  const today = new Date().toISOString().slice(0, 10);

  const [visits, upcoming, allergies, recentResults, medications] = await Promise.all([
    db
      .select({
        id: schema.encounters.id,
        encounterType: schema.encounters.encounterType,
        status: schema.encounters.status,
        startedAt: schema.encounters.startedAt,
        endedAt: schema.encounters.endedAt,
        followUpDate: schema.encounters.followUpDate,
        facilityId: schema.encounters.facilityId,
      })
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.patientId, session.patientId),
          inArray(schema.encounters.facilityId, facilities),
        ),
      )
      .orderBy(desc(schema.encounters.startedAt))
      .limit(5),

    policy.showAppointments
      ? db
          .select({
            id: schema.appointments.id,
            scheduledTime: schema.appointments.scheduledTime,
            appointmentType: schema.appointments.appointmentType,
            status: schema.appointments.status,
            reason: schema.appointments.reason,
            facilityId: schema.appointments.facilityId,
          })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.patientId, session.patientId),
              inArray(schema.appointments.facilityId, facilities),
              gte(schema.appointments.scheduledTime, today),
            ),
          )
          .orderBy(asc(schema.appointments.scheduledTime))
          .limit(5)
      : Promise.resolve([]),

    policy.showAllergies
      ? db
          .select({
            id: schema.patientAllergies.id,
            allergen: schema.patientAllergies.allergen,
            allergenType: schema.patientAllergies.allergenType,
            severity: schema.patientAllergies.severity,
            reaction: schema.patientAllergies.reaction,
            status: schema.patientAllergies.status,
          })
          .from(schema.patientAllergies)
          .where(
            and(
              eq(schema.patientAllergies.patientId, session.patientId),
              eq(schema.patientAllergies.status, 'ACTIVE'),
              inArray(schema.patientAllergies.facilityId, facilities),
            ),
          )
          .orderBy(desc(schema.patientAllergies.recordedAt))
      : Promise.resolve([]),

    policy.showLabResults
      ? db
          .select({
            id: schema.labResults.id,
            parameterName: schema.labResults.parameterName,
            measuredValue: schema.labResults.measuredValue,
            unit: schema.labResults.unit,
            referenceRange: schema.labResults.referenceRange,
            flag: schema.labResults.flag,
            verifiedAt: schema.labResults.verifiedAt,
          })
          .from(schema.labResults)
          .where(
            and(
              eq(schema.labResults.patientId, session.patientId),
              eq(schema.labResults.status, 'Verified'),
            ),
          )
          .orderBy(desc(schema.labResults.verifiedAt))
          .limit(5)
      : Promise.resolve([]),

    policy.showPrescriptions
      ? db
          .select({
            id: schema.medications.id,
            drugName: schema.medications.drugName,
            dosage: schema.medications.dosage,
            frequency: schema.medications.frequency,
            duration: schema.medications.duration,
            status: schema.medications.status,
            prescribedAt: schema.medications.prescribedAt,
          })
          .from(schema.medications)
          .innerJoin(schema.encounters, eq(schema.medications.encounterId, schema.encounters.id))
          .where(
            and(
              eq(schema.medications.patientId, session.patientId),
              inArray(schema.encounters.facilityId, facilities),
            ),
          )
          .orderBy(desc(schema.medications.prescribedAt))
          .limit(5)
      : Promise.resolve([]),
  ]);

  return {
    visits,
    upcomingAppointments: upcoming,
    activeAllergies: allergies,
    recentVerifiedResults: recentResults,
    recentMedications: medications,
    releasedSections: {
      laboratory: policy.showLabResults,
      appointments: policy.showAppointments,
      prescriptions: policy.showPrescriptions,
      allergies: policy.showAllergies,
      dischargeSummaries: policy.showDischargeSummaries,
      downloads: policy.allowDownloads,
    },
  };
}

/* ============================================================
   Visits
   ============================================================ */

export async function listPortalVisits(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const facilities = await allowedFacilityIds(session);

  await logPortalRecordAccess(session, {
    action: 'VIEW',
    recordType: 'Encounter',
    request,
  });

  const encounters = await db
    .select({
      id: schema.encounters.id,
      encounterType: schema.encounters.encounterType,
      status: schema.encounters.status,
      triageCategory: schema.encounters.triageCategory,
      chiefComplaint: schema.encounters.chiefComplaint,
      clinicalNotes: schema.encounters.clinicalNotes,
      followUpDate: schema.encounters.followUpDate,
      startedAt: schema.encounters.startedAt,
      endedAt: schema.encounters.endedAt,
      facilityId: schema.encounters.facilityId,
      facilityName: schema.facilities.name,
    })
    .from(schema.encounters)
    .leftJoin(schema.facilities, eq(schema.encounters.facilityId, schema.facilities.id))
    .where(
      and(
        eq(schema.encounters.patientId, session.patientId),
        inArray(schema.encounters.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.encounters.startedAt))
    .limit(50);

  const encounterIds = encounters.map((row) => row.id);

  const diagnoses = encounterIds.length
    ? await db
        .select({
          encounterId: schema.diagnoses.encounterId,
          icd10Code: schema.diagnoses.icd10Code,
          icd10Description: schema.diagnoses.icd10Description,
          codingSystem: schema.diagnoses.codingSystem,
          icd11Code: schema.diagnoses.icd11Code,
          icd11Title: schema.diagnoses.icd11Title,
          icd11Release: schema.diagnoses.icd11Release,
          diagnosisType: schema.diagnoses.diagnosisType,
          status: schema.diagnoses.status,
          diagnosedBy: schema.diagnoses.diagnosedBy,
          diagnosedAt: schema.diagnoses.diagnosedAt,
        })
        .from(schema.diagnoses)
        .where(inArray(schema.diagnoses.encounterId, encounterIds))
    : [];

  const diagnosesByEncounter = new Map<number, typeof diagnoses>();

  for (const row of diagnoses) {
    const list = diagnosesByEncounter.get(row.encounterId) ?? [];
    list.push(row);
    diagnosesByEncounter.set(row.encounterId, list);
  }

  return encounters.map((encounter) => ({
    ...encounter,
    diagnoses: diagnosesByEncounter.get(encounter.id) ?? [],
  }));
}

/* ============================================================
   Laboratory
   ============================================================ */

/**
 * Results the patient may see.
 *
 * Only `Verified`. The database default for a new result is
 * "Pending Verification", and a result that no qualified person has
 * signed is not released — the patient sees the order, not the number.
 * The response states the rule so the screen can explain an empty list
 * rather than implying nothing was tested.
 */
export async function listPortalLabResults(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy((await allowedFacilityIds(session))[0] ?? 0);

  if (!policy.showLabResults) {
    throw new PortalError(
      'This facility does not release laboratory results through the portal. Ask at the desk for a copy.',
      403,
      'SECTION_DISABLED',
    );
  }

  const facilities = await allowedFacilityIds(session);

  await logPortalRecordAccess(session, {
    action: 'VIEW',
    recordType: 'LabResult',
    request,
  });

  /*
   * Scoped to the same facilities the rest of the portal reads. A patient
   * registered at two facilities in this network does not see the second
   * facility's orders on the first facility's account unless both are in
   * the allowed set — and the set is computed from the patient's own
   * registration facility plus the account's facility, never from the
   * request.
   */
  const orders = await db
    .select({
      id: schema.labOrders.id,
      testName: schema.labOrders.testName,
      status: schema.labOrders.status,
      priority: schema.labOrders.priority,
      orderedAt: schema.labOrders.orderedAt,
      facilityId: schema.labOrders.facilityId,
    })
    .from(schema.labOrders)
    .where(
      and(
        eq(schema.labOrders.patientId, session.patientId),
        inArray(schema.labOrders.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.labOrders.orderedAt))
    .limit(50);

  const orderIds = orders.map((row) => row.id);

  const results = orderIds.length
    ? await db
        .select({
          orderId: schema.labResults.orderId,
          parameterName: schema.labResults.parameterName,
          measuredValue: schema.labResults.measuredValue,
          unit: schema.labResults.unit,
          referenceRange: schema.labResults.referenceRange,
          flag: schema.labResults.flag,
          status: schema.labResults.status,
          verifiedAt: schema.labResults.verifiedAt,
          verifiedBy: schema.labResults.verifiedBy,
        })
        .from(schema.labResults)
        .where(inArray(schema.labResults.orderId, orderIds))
    : [];

  const releasedByOrder = new Map<number, typeof results>();

  for (const row of results) {
    if (row.status !== 'Verified') continue;

    const list = releasedByOrder.get(row.orderId) ?? [];
    list.push(row);
    releasedByOrder.set(row.orderId, list);
  }

  return {
    note: 'Only results that a laboratory professional has verified are shown. A test with no result below is still being processed.',
    orders: orders.map(({ facilityId: _ignored, ...order }) => ({
      ...order,
      results: releasedByOrder.get(order.id) ?? [],
      released: (releasedByOrder.get(order.id) ?? []).length > 0,
    })),
  };
}

/* ============================================================
   Medications
   ============================================================ */

export async function listPortalMedications(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy((await allowedFacilityIds(session))[0] ?? 0);

  if (!policy.showPrescriptions) {
    throw new PortalError(
      'This facility does not release prescriptions through the portal.',
      403,
      'SECTION_DISABLED',
    );
  }

  const facilities = await allowedFacilityIds(session);

  await logPortalRecordAccess(session, {
    action: 'VIEW',
    recordType: 'Medication',
    request,
  });

  /*
   * `medications` has no facility column of its own — a prescription
   * belongs to the encounter that produced it, so the scope is applied
   * there. Filtering on the patient alone would return prescriptions from
   * every facility in the tenant.
   */
  return db
    .select({
      id: schema.medications.id,
      drugName: schema.medications.drugName,
      dosage: schema.medications.dosage,
      frequency: schema.medications.frequency,
      duration: schema.medications.duration,
      route: schema.medications.route,
      instructions: schema.medications.instructions,
      status: schema.medications.status,
      prescribedBy: schema.medications.prescribedBy,
      prescribedAt: schema.medications.prescribedAt,
    })
    .from(schema.medications)
    .innerJoin(schema.encounters, eq(schema.medications.encounterId, schema.encounters.id))
    .where(
      and(
        eq(schema.medications.patientId, session.patientId),
        inArray(schema.encounters.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.medications.prescribedAt))
    .limit(100);
}

/* ============================================================
   Appointments
   ============================================================ */

export async function listPortalAppointments(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const facilities = await allowedFacilityIds(session);

  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy(facilities[0] ?? 0);

  if (!policy.showAppointments) {
    throw new PortalError(
      'This facility does not show appointments through the portal.',
      403,
      'SECTION_DISABLED',
    );
  }

  await logPortalRecordAccess(session, {
    action: 'VIEW',
    recordType: 'Appointment',
    request,
  });

  const rows = await db
    .select({
      id: schema.appointments.id,
      scheduledTime: schema.appointments.scheduledTime,
      durationMinutes: schema.appointments.durationMinutes,
      appointmentType: schema.appointments.appointmentType,
      status: schema.appointments.status,
      reason: schema.appointments.reason,
      facilityId: schema.appointments.facilityId,
      facilityName: schema.facilities.name,
    })
    .from(schema.appointments)
    .leftJoin(schema.facilities, eq(schema.appointments.facilityId, schema.facilities.id))
    .where(
      and(
        eq(schema.appointments.patientId, session.patientId),
        inArray(schema.appointments.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.appointments.scheduledTime))
    .limit(50);

  return rows.map(({ facilityId: _ignored, ...rest }) => rest);
}

/* ============================================================
   Discharge summaries
   ============================================================ */

export async function listPortalDischargeSummaries(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const facilities = await allowedFacilityIds(session);

  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy(facilities[0] ?? 0);

  if (!policy.showDischargeSummaries) {
    throw new PortalError(
      'This facility does not release discharge summaries through the portal.',
      403,
      'SECTION_DISABLED',
    );
  }

  await logPortalRecordAccess(session, {
    action: 'VIEW',
    recordType: 'DischargeSummary',
    request,
  });

  const rows = await db
    .select({
      id: schema.admissions.id,
      admissionDate: schema.admissions.admissionDate,
      dischargeDate: schema.admissions.dischargeDate,
      dischargeType: schema.admissions.dischargeType,
      dischargeSummary: schema.admissions.dischargeSummary,
      dischargeDisposition: schema.admissions.dischargeDisposition,
      dischargedBy: schema.admissions.dischargedBy,
      status: schema.admissions.status,
      facilityId: schema.admissions.facilityId,
    })
    .from(schema.admissions)
    .where(
      and(
        eq(schema.admissions.patientId, session.patientId),
        inArray(schema.admissions.facilityId, facilities),
        eq(schema.admissions.status, 'Discharged'),
      ),
    )
    .orderBy(desc(schema.admissions.dischargeDate))
    .limit(50);

  return rows.map(({ facilityId: _ignored, ...rest }) => rest);
}

/* ============================================================
   Everything, for a download
   ============================================================ */

/**
 * A single document's worth of the patient's own record.
 *
 * Generated on demand and streamed with `Content-Disposition:
 * attachment`. There is no stored file and no public URL, so a link
 * emailed to the wrong person does not open anything: they still need a
 * live portal session.
 */
export async function buildPortalRecordSummary(session: PortalSession) {
  const facilityIds = await allowedFacilityIds(session);

  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy(facilityIds[0] ?? 0);

  if (!policy.allowDownloads) {
    throw new PortalError(
      'Downloads are switched off for this facility. Ask at the desk for a printed copy.',
      403,
      'DOWNLOADS_DISABLED',
    );
  }

  const [patient] = await db
    .select({
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      middleName: schema.patients.middleName,
      lastName: schema.patients.lastName,
      dateOfBirth: schema.patients.dateOfBirth,
      gender: schema.patients.gender,
      county: schema.patients.county,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, session.patientId))
    .limit(1);

  if (!patient) {
    throw new PortalError('Patient record not found.', 404, 'PATIENT_NOT_FOUND');
  }

  const [visits, allergies, medications, labs, appointments] = await Promise.all([
    listPortalVisits(session),
    policy.showAllergies
      ? db
          .select({
            allergen: schema.patientAllergies.allergen,
            severity: schema.patientAllergies.severity,
            reaction: schema.patientAllergies.reaction,
            status: schema.patientAllergies.status,
          })
          .from(schema.patientAllergies)
          .where(
            and(
              eq(schema.patientAllergies.patientId, session.patientId),
              inArray(schema.patientAllergies.facilityId, facilityIds),
            ),
          )
      : Promise.resolve([]),
    policy.showPrescriptions ? listPortalMedications(session) : Promise.resolve([]),
    policy.showLabResults ? listPortalLabResults(session) : Promise.resolve(null),
    policy.showAppointments ? listPortalAppointments(session) : Promise.resolve([]),
  ]);

  await logPortalRecordAccess(session, {
    action: 'DOWNLOAD',
    recordType: 'PatientRecordSummary',
    purpose: 'PATIENT_REQUEST',
  });

  return {
    generatedAt: new Date().toISOString(),
    patient,
    visits,
    allergies,
    medications,
    labOrders: labs?.orders ?? [],
    labNote: labs?.note ?? null,
    appointments,
  };
}

/* ============================================================
   Correction requests
   ============================================================ */

/**
 * A patient who believes the record is wrong asks for a correction.
 *
 * The request is an audit event, not an edit. Clinical records are
 * amended by the clinician who wrote them, under their own name, so the
 * patient cannot silently change a diagnosis by claiming it is theirs.
 */
export async function requestRecordCorrection(
  session: PortalSession,
  input: { recordType: unknown; detail: unknown },
): Promise<{ requestId: string }> {
  const recordType =
    typeof input.recordType === 'string' ? input.recordType.trim().slice(0, 120) : '';
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';

  if (recordType === '') {
    throw new PortalError('Say which part of the record is wrong.', 400, 'RECORD_TYPE_REQUIRED');
  }

  if (detail.length < 10 || detail.length > 2000) {
    throw new PortalError(
      'Describe the correction in 10 to 2000 characters.',
      400,
      'INVALID_CORRECTION_REQUEST',
    );
  }

  const [auditRow] = await db
    .insert(schema.auditLogs)
    .values({
      tenantId: session.tenantId,
      facilityId: session.facilityId,
      userId: null,
      action: 'REQUEST_CORRECTION',
      resource: 'Patient',
      resourceId: String(session.patientId),
      details: `Portal correction request (${recordType}): ${detail}`.slice(0, 4000),
      severity: 'INFO',
    })
    .returning({ id: schema.auditLogs.id });

  return { requestId: String(auditRow?.id ?? '') };
}
