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

import { portalReleasedDocumentList } from '../documents/patient-documents.service.ts';

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
          .innerJoin(schema.labOrders, eq(schema.labResults.orderId, schema.labOrders.id))
          .innerJoin(schema.facilities, eq(schema.labOrders.facilityId, schema.facilities.id))
          .where(
            and(
              eq(schema.labResults.patientId, session.patientId),
              eq(schema.labOrders.patientId, session.patientId),
              eq(schema.labOrders.tenantId, session.tenantId),
              eq(schema.facilities.tenantId, session.tenantId),
              inArray(schema.labOrders.facilityId, facilities),
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
  options?: { limit?: number },
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
    .limit(options?.limit ?? 50);

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
  options?: { limit?: number },
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
      facilityName: schema.facilities.name,
    })
    .from(schema.labOrders)
    .innerJoin(schema.facilities, eq(schema.labOrders.facilityId, schema.facilities.id))
    .where(
      and(
        eq(schema.labOrders.patientId, session.patientId),
        eq(schema.labOrders.tenantId, session.tenantId),
        eq(schema.facilities.tenantId, session.tenantId),
        inArray(schema.labOrders.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.labOrders.orderedAt))
    .limit(options?.limit ?? 50);

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
        .where(
          and(
            inArray(schema.labResults.orderId, orderIds),
            eq(schema.labResults.patientId, session.patientId),
            eq(schema.labResults.status, 'Verified'),
          ),
        )
    : [];

  /*
   * How many results on each order are still unverified. The values are never
   * read here — only counted — so the download can honestly say "pending
   * verification" instead of leaving a blank row that looks like a normal
   * result with no number.
   */
  const everyResult = orderIds.length
    ? await db
        .select({ orderId: schema.labResults.orderId, status: schema.labResults.status })
        .from(schema.labResults)
        .where(
          and(
            inArray(schema.labResults.orderId, orderIds),
            eq(schema.labResults.patientId, session.patientId),
          ),
        )
    : [];

  const pendingByOrder = new Map<number, number>();
  for (const row of everyResult) {
    if (row.status === 'Verified') continue;
    pendingByOrder.set(row.orderId, (pendingByOrder.get(row.orderId) ?? 0) + 1);
  }

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
      pendingResultCount: pendingByOrder.get(order.id) ?? 0,
    })),
  };
}

/* ============================================================
   Medications
   ============================================================ */

export async function listPortalMedications(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
  options?: { limit?: number },
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
   *
   * The facility name travels with the row because the medical-record PDF
   * attributes every prescribed medicine to where it was prescribed; a
   * multi-facility patient must not be left guessing.
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
      facilityName: schema.facilities.name,
    })
    .from(schema.medications)
    .innerJoin(schema.encounters, eq(schema.medications.encounterId, schema.encounters.id))
    .innerJoin(schema.facilities, eq(schema.encounters.facilityId, schema.facilities.id))
    .where(
      and(
        eq(schema.medications.patientId, session.patientId),
        inArray(schema.encounters.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.medications.prescribedAt))
    .limit(options?.limit ?? 100);
}

/* ============================================================
   Appointments
   ============================================================ */

export async function listPortalAppointments(
  session: PortalSession,
  request?: { ipAddress?: string | null; userAgent?: string | null },
  options?: { limit?: number },
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
    .limit(options?.limit ?? 50);

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
 * This replaces the old JSON summary. What is assembled here is exactly what
 * the PDF may print — nothing more — so the renderer has no route to a table
 * and cannot invent, widen or re-scope a query. Every list is built from the
 * same helper the portal screens use, or from a query scoped by the session's
 * allowed facilities; no function here accepts a patient id from a caller.
 *
 * Generated on demand and streamed as an attachment. There is no stored file
 * and no public URL, so a link emailed to the wrong person opens nothing: they
 * still need a live portal session.
 */
export interface PortalMedicalRecordMedication {
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string | null;
  instructions: string | null;
  status: string;
  prescribedAt: string | null;
  facilityName: string | null;
  dispensedAt: string | null;
  dispensedQuantity: number | null;
}

export interface PortalMedicalRecordLabResult {
  parameterName: string;
  measuredValue: string;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
  verifiedAt: string | null;
}

export interface PortalMedicalRecordLabOrder {
  testName: string;
  status: string;
  orderedAt: string | null;
  facilityName: string | null;
  results: PortalMedicalRecordLabResult[];
  pendingResultCount: number;
}

export interface PortalMedicalRecordRadiologyOrder {
  procedureName: string;
  modality: string;
  status: string;
  requestedAt: string | null;
  reportedAt: string | null;
  findings: string | null;
  impression: string | null;
  facilityName: string | null;
}

export interface PortalMedicalRecordAdmission {
  encounterId: number | null;
  facilityName: string | null;
  admissionDate: string;
  admissionType: string | null;
  wardName: string | null;
  status: string;
  dischargeDate: string | null;
  dischargeType: string | null;
  dischargeDisposition: string | null;
  dischargeSummary: string | null;
}

export interface PortalMedicalRecord {
  generatedAt: string;
  timezone: string;
  facility: {
    id: number;
    name: string;
    code: string;
    registryCode: string | null;
    address: string | null;
    county: string | null;
    subCounty: string | null;
    phone: string | null;
    email: string | null;
  };
  facilitiesIncluded: string[];
  patient: {
    mrn: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    bloodGroup: string | null;
    county: string | null;
    subCounty: string | null;
    phone: string | null;
    allergySummaryText: string | null;
  };
  policy: {
    laboratory: boolean;
    medications: boolean;
    allergies: boolean;
    appointments: boolean;
    dischargeSummaries: boolean;
  };
  visits: Array<{
    encounterId: number;
    encounterType: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    followUpDate: string | null;
    chiefComplaint: string | null;
    clinicalNotes: string | null;
    facilityName: string | null;
    diagnoses: Array<{
      code: string | null;
      description: string;
      codingSystem: string | null;
      diagnosisType: string | null;
      status: string | null;
    }>;
  }>;
  admissions: PortalMedicalRecordAdmission[];
  allergies: Array<{
    allergen: string;
    allergenType: string;
    severity: string;
    reaction: string | null;
    status: string;
  }>;
  medications: PortalMedicalRecordMedication[];
  labOrders: PortalMedicalRecordLabOrder[];
  radiology: PortalMedicalRecordRadiologyOrder[];
  appointments: Array<{
    scheduledTime: string;
    durationMinutes: number | null;
    appointmentType: string | null;
    status: string;
    reason: string | null;
    facilityName: string | null;
  }>;
  documents: Array<{
    title: string;
    groupLabel: string;
    kind: string;
    version: number;
    signedAt: string | null;
    uploadedAt: string | null;
  }>;
}

/**
 * A database timestamp as the wall clock it records.
 *
 * `timestamp without time zone` has no offset: 09:15 in the column means nine
 * fifteen at the facility. Drizzle's mapper turns that reading into a Date
 * tagged UTC (it appends `+0000`), so the wall clock is the UTC reading of that
 * Date, not the browser's or the server process's local reading. Serialising it
 * *without* a `Z` keeps that distinction intact for the renderer instead of
 * silently re-interpreting it as an instant.
 */
function wallClock(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    return iso.endsWith('Z') ? iso.slice(0, 19) : iso;
  }
  return String(value);
}

/** Every prescription's latest dispensing, scoped to the same facilities. */
async function dispensationsFor(
  session: PortalSession,
  facilityIds: number[],
  prescriptionIds: number[],
): Promise<Map<number, { dispensedAt: string | null; quantity: number | null }>> {
  if (prescriptionIds.length === 0) return new Map();

  const rows = await db
    .select({
      prescriptionId: schema.pharmacyDispensations.prescriptionId,
      dispensedAt: schema.pharmacyDispensations.dispensedAt,
      quantityDispensed: schema.pharmacyDispensations.quantityDispensed,
    })
    .from(schema.pharmacyDispensations)
    .where(
      and(
        inArray(schema.pharmacyDispensations.prescriptionId, prescriptionIds),
        eq(schema.pharmacyDispensations.patientId, session.patientId),
        inArray(schema.pharmacyDispensations.facilityId, facilityIds),
      ),
    )
    .orderBy(desc(schema.pharmacyDispensations.dispensedAt))
    .limit(1000);

  const latest = new Map<number, { dispensedAt: string | null; quantity: number | null }>();
  for (const row of rows) {
    if (row.prescriptionId === null) continue;
    if (latest.has(row.prescriptionId)) continue;
    latest.set(row.prescriptionId, {
      dispensedAt: wallClock(row.dispensedAt),
      quantity: row.quantityDispensed === null ? null : Number(row.quantityDispensed),
    });
  }
  return latest;
}

/**
 * Admitted/discharged stays, scoped to the facilities the portal may read.
 *
 * The narrative discharge summary is withheld unless the facility releases
 * discharge summaries in its portal policy. The admission and discharge dates
 * are part of the encounter itself and stay, so an inpatient encounter is never
 * presented as an unexplained outpatient note.
 */
async function admissionsFor(
  session: PortalSession,
  facilities: number[],
  includeSummary: boolean,
): Promise<PortalMedicalRecordAdmission[]> {
  const rows = await db
    .select({
      encounterId: schema.admissions.encounterId,
      facilityName: schema.facilities.name,
      admissionDate: schema.admissions.admissionDate,
      admissionType: schema.admissions.admissionType,
      wardName: schema.wards.name,
      status: schema.admissions.status,
      dischargeDate: schema.admissions.dischargeDate,
      dischargeType: schema.admissions.dischargeType,
      dischargeDisposition: schema.admissions.dischargeDisposition,
      dischargeSummary: schema.admissions.dischargeSummary,
    })
    .from(schema.admissions)
    .leftJoin(schema.wards, eq(schema.admissions.wardId, schema.wards.id))
    .leftJoin(schema.facilities, eq(schema.admissions.facilityId, schema.facilities.id))
    .where(
      and(
        eq(schema.admissions.patientId, session.patientId),
        eq(schema.admissions.tenantId, session.tenantId),
        inArray(schema.admissions.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.admissions.admissionDate))
    .limit(200);

  return rows.map((row) => ({
    encounterId: row.encounterId,
    facilityName: row.facilityName,
    admissionDate: row.admissionDate,
    admissionType: row.admissionType,
    wardName: row.wardName,
    status: row.status ?? 'Admitted',
    dischargeDate: row.dischargeDate,
    dischargeType: row.dischargeType,
    dischargeDisposition: row.dischargeDisposition,
    dischargeSummary: includeSummary ? row.dischargeSummary : null,
  }));
}

/**
 * Imaging requests and reports the patient may read.
 *
 * The portal has no separate radiology switch, and the policy the facility
 * configured is applied where it exists: a report is only printed when its
 * status is `Reported`, and a request that has no report says so. Images are
 * never mentioned as included because none ever are.
 */
async function radiologyFor(
  session: PortalSession,
  facilities: number[],
): Promise<PortalMedicalRecordRadiologyOrder[]> {
  const rows = await db
    .select({
      procedureName: schema.radiologyOrders.procedureName,
      modality: schema.radiologyOrders.modality,
      status: schema.radiologyOrders.status,
      createdAt: schema.radiologyOrders.createdAt,
      reportedAt: schema.radiologyOrders.reportedAt,
      findings: schema.radiologyOrders.radiologistFindings,
      impression: schema.radiologyOrders.impression,
      facilityName: schema.facilities.name,
    })
    .from(schema.radiologyOrders)
    .leftJoin(schema.facilities, eq(schema.radiologyOrders.facilityId, schema.facilities.id))
    .where(
      and(
        eq(schema.radiologyOrders.patientId, session.patientId),
        eq(schema.radiologyOrders.tenantId, session.tenantId),
        inArray(schema.radiologyOrders.facilityId, facilities),
      ),
    )
    .orderBy(desc(schema.radiologyOrders.createdAt))
    .limit(200);

  return rows.map((row) => {
    const reported = row.status === 'Reported';
    return {
      procedureName: row.procedureName,
      modality: row.modality,
      status: row.status ?? 'Requested',
      requestedAt: wallClock(row.createdAt),
      reportedAt: wallClock(row.reportedAt),
      findings: reported ? row.findings : null,
      impression: reported ? row.impression : null,
      facilityName: row.facilityName,
    };
  });
}

export async function buildPortalMedicalRecord(session: PortalSession): Promise<PortalMedicalRecord> {
  const facilities = await allowedFacilityIds(session);

  const policy = session.facilityId
    ? await loadPortalPolicy(session.facilityId)
    : await loadPortalPolicy(facilities[0] ?? 0);

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
      bloodGroup: schema.patients.bloodGroup,
      county: schema.patients.county,
      subCounty: schema.patients.subCounty,
      phone: schema.patients.phone,
      allergySummaryText: schema.patients.allergies,
    })
    .from(schema.patients)
    .where(
      and(eq(schema.patients.id, session.patientId), eq(schema.patients.tenantId, session.tenantId)),
    )
    .limit(1);

  if (!patient) {
    throw new PortalError('Patient record not found.', 404, 'PATIENT_NOT_FOUND');
  }

  /*
   * The header and letterhead belong to the facility this portal account
   * belongs to. It is read from the facility table, never from the request, so
   * a patient cannot ask for another facility's stationery.
   */
  const mainFacilityId = session.facilityId ?? facilities[0];

  if (!mainFacilityId) {
    throw new PortalError('This record is not linked to a facility.', 403, 'FACILITY_NOT_LINKED');
  }

  const [facilityRow] = await db
    .select({
      id: schema.facilities.id,
      name: schema.facilities.name,
      code: schema.facilities.code,
      registryCode: schema.facilities.mflCode,
      address: schema.facilities.address,
      county: schema.facilities.county,
      subCounty: schema.facilities.subCounty,
      phone: schema.facilities.phone,
      email: schema.facilities.email,
      timezone: schema.facilities.timezone,
    })
    .from(schema.facilities)
    .where(
      and(
        eq(schema.facilities.id, mainFacilityId),
        eq(schema.facilities.tenantId, session.tenantId),
      ),
    )
    .limit(1);

  if (!facilityRow) {
    throw new PortalError('This record is not linked to a facility.', 403, 'FACILITY_NOT_LINKED');
  }

  const facilityNames = await db
    .select({ name: schema.facilities.name })
    .from(schema.facilities)
    .where(
      and(
        eq(schema.facilities.tenantId, session.tenantId),
        inArray(schema.facilities.id, facilities),
      ),
    );

  const [visits, allergies, medications, labs, appointments, admissions, radiology, documents] =
    await Promise.all([
      listPortalVisits(session, undefined, { limit: 500 }),
      policy.showAllergies
        ? db
            .select({
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
                eq(schema.patientAllergies.tenantId, session.tenantId),
                inArray(schema.patientAllergies.facilityId, facilities),
              ),
            )
            .orderBy(desc(schema.patientAllergies.recordedAt))
        : Promise.resolve([]),
      policy.showPrescriptions
        ? listPortalMedications(session, undefined, { limit: 500 })
        : Promise.resolve([]),
      policy.showLabResults
        ? listPortalLabResults(session, undefined, { limit: 300 })
        : Promise.resolve({ orders: [] }),
      policy.showAppointments
        ? listPortalAppointments(session, undefined, { limit: 500 })
        : Promise.resolve([]),
      admissionsFor(session, facilities, policy.showDischargeSummaries),
      radiologyFor(session, facilities),
      session.facilityId
        ? portalReleasedDocumentList(session)
        : Promise.resolve([]),
    ]);

  /* Dispensing is a fact about the prescription, not a second prescription. */
  const dispensed = await dispensationsFor(
    session,
    facilities,
    medications.map((row) => row.id),
  );

  const medicationRows: PortalMedicalRecordMedication[] = medications.map((row) => {
    const fill = dispensed.get(row.id);
    return {
      drugName: row.drugName,
      dosage: row.dosage,
      frequency: row.frequency,
      duration: row.duration,
      route: row.route ?? null,
      instructions: row.instructions ?? null,
      status: row.status ?? 'Prescribed',
      prescribedAt: wallClock(row.prescribedAt),
      facilityName: row.facilityName ?? null,
      dispensedAt: fill?.dispensedAt ?? null,
      dispensedQuantity: fill?.quantity ?? null,
    };
  });

  const labOrders: PortalMedicalRecordLabOrder[] = labs.orders.map((order) => ({
    testName: order.testName,
    status: order.status ?? 'Ordered',
    orderedAt: wallClock(order.orderedAt),
    facilityName: order.facilityName ?? null,
    results: order.results.map((result) => ({
      parameterName: result.parameterName,
      measuredValue: result.measuredValue,
      unit: result.unit ?? null,
      referenceRange: result.referenceRange ?? null,
      flag: result.flag ?? null,
      verifiedAt: wallClock(result.verifiedAt),
    })),
    pendingResultCount: order.pendingResultCount ?? 0,
  }));

  await logPortalRecordAccess(session, {
    action: 'DOWNLOAD',
    recordType: 'MedicalRecord',
    purpose: 'PATIENT_REQUEST',
  });

  return {
    generatedAt: new Date().toISOString(),
    timezone: facilityRow.timezone || 'Africa/Nairobi',
    facility: {
      id: facilityRow.id,
      name: facilityRow.name,
      code: facilityRow.code,
      registryCode: facilityRow.registryCode ?? null,
      address: facilityRow.address ?? null,
      county: facilityRow.county ?? null,
      subCounty: facilityRow.subCounty ?? null,
      phone: facilityRow.phone ?? null,
      email: facilityRow.email ?? null,
    },
    facilitiesIncluded: facilityNames.map((row) => row.name),
    patient: {
      mrn: patient.mrn,
      firstName: patient.firstName,
      middleName: patient.middleName ?? null,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      bloodGroup: patient.bloodGroup ?? null,
      county: patient.county ?? null,
      subCounty: patient.subCounty ?? null,
      phone: patient.phone ?? null,
      allergySummaryText: patient.allergySummaryText ?? null,
    },
    policy: {
      laboratory: policy.showLabResults,
      medications: policy.showPrescriptions,
      allergies: policy.showAllergies,
      appointments: policy.showAppointments,
      dischargeSummaries: policy.showDischargeSummaries,
    },
    visits: visits.map((visit) => ({
      encounterId: visit.id,
      encounterType: visit.encounterType,
      status: visit.status,
      startedAt: wallClock(visit.startedAt),
      endedAt: wallClock(visit.endedAt),
      followUpDate: visit.followUpDate ?? null,
      chiefComplaint: visit.chiefComplaint ?? null,
      clinicalNotes: visit.clinicalNotes ?? null,
      facilityName: visit.facilityName ?? null,
      diagnoses: visit.diagnoses.map((diagnosis) => ({
        code: diagnosis.icd10Code ?? diagnosis.icd11Code ?? null,
        description:
          diagnosis.icd10Description ??
          diagnosis.icd11Title ??
          (diagnosis.icd10Code ?? diagnosis.icd11Code ?? 'No description recorded'),
        codingSystem:
          diagnosis.codingSystem ?? (diagnosis.icd11Code ? 'ICD-11' : diagnosis.icd10Code ? 'ICD-10' : null),
        diagnosisType: diagnosis.diagnosisType ?? null,
        status: diagnosis.status ?? null,
      })),
    })),
    admissions,
    /*
     * Entered-in-error rows stay out of the patient's copy: they record a
     * mistake at data entry, not an allergy the patient has.
     */
    allergies: allergies
      .filter((row) => row.status !== 'ENTERED_IN_ERROR')
      .map((row) => ({
        allergen: row.allergen,
        allergenType: row.allergenType,
        severity: row.severity,
        reaction: row.reaction ?? null,
        status: row.status,
      })),
    medications: medicationRows,
    labOrders,
    radiology,
    appointments: appointments.map((row) => ({
      scheduledTime: row.scheduledTime,
      durationMinutes: row.durationMinutes ?? null,
      appointmentType: row.appointmentType ?? null,
      status: row.status ?? 'Scheduled',
      reason: row.reason ?? null,
      facilityName: row.facilityName ?? null,
    })),
    documents: documents.map((row) => ({
      title: row.title,
      groupLabel: row.group_label,
      kind: row.kind,
      version: row.version,
      signedAt: row.signed_at,
      uploadedAt: row.uploaded_at,
    })),
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
