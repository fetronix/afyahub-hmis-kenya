import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type {
  TheatreBookingCreate,
  TheatreCancel,
  TheatreLegacyReview,
  TheatreReschedule,
  TheatreRoomCreate,
  TheatreRoomState,
} from '../validation/schemas/theatre-scheduling.schema.ts';

export interface TheatreScope {
  tenantId: number;
  facilityId: number;
  actorId: number;
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class TheatreError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const missingCase = () =>
  new TheatreError(
    404,
    'THEATRE_CASE_NOT_FOUND',
    'The theatre case was not found in this facility.',
  );
const roomMissing = () =>
  new TheatreError(
    404,
    'THEATRE_ROOM_NOT_FOUND',
    'The theatre room was not found in this facility.',
  );

/** PG/Drizzle can wrap the useful code in one or more causes. */
function databaseError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    const item = current as { code?: string; constraint?: string; cause?: unknown };
    if (item.code) return item;
    current = item.cause;
  }
  return {};
}
function translate(error: unknown): never {
  const pg = databaseError(error);
  if (pg.code === '23P01') {
    const resource = pg.constraint?.includes('patient')
      ? 'PATIENT'
      : pg.constraint?.includes('practitioner')
        ? 'PRACTITIONER'
        : 'ROOM';
    throw new TheatreError(
      409,
      `${resource}_SCHEDULE_CONFLICT`,
      `The ${resource.toLowerCase()} already has a booking in this time slot.`,
    );
  }
  if (pg.code === '23505' && pg.constraint === 'theatre_rooms_facility_name_uq') {
    throw new TheatreError(
      409,
      'THEATRE_ROOM_EXISTS',
      'A room with that name already exists in this facility.',
    );
  }
  throw error;
}

async function audit(
  tx: Tx,
  scope: TheatreScope,
  resource: string,
  id: number,
  action: string,
  details?: string,
) {
  await tx.insert(s.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource,
    resourceId: String(id),
    action,
    details,
  });
}

function publicCase(record: typeof s.theatreCases.$inferSelect) {
  return {
    id: record.id,
    patientId: record.patientId,
    procedureName: record.procedureName,
    theatreRoom: record.theatreRoom,
    leadSurgeon: record.leadSurgeon,
    scheduledStart: record.scheduledStart,
    scheduledEnd: record.scheduledEnd,
    status: record.status,
  };
}

function publicBooking(booking: typeof s.theatreBookings.$inferSelect | null) {
  if (!booking) return null;
  const { requestKey: _key, requestHash: _hash, ...publicFields } = booking;
  return publicFields;
}

export async function listRooms(scope: TheatreScope) {
  return db
    .select()
    .from(s.theatreRooms)
    .where(
      and(
        eq(s.theatreRooms.tenantId, scope.tenantId),
        eq(s.theatreRooms.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(s.theatreRooms.name));
}
export async function listPractitioners(scope: TheatreScope) {
  return db
    .select({
      id: s.practitioners.id,
      fullName: s.practitioners.fullName,
      profession: s.practitioners.profession,
      specialty: s.practitioners.specialty,
      credentialVerificationStatus: s.practitioners.credentialVerificationStatus,
      licenseExpiryDate: s.practitioners.licenseExpiryDate,
    })
    .from(s.practitioners)
    .where(
      and(
        eq(s.practitioners.tenantId, scope.tenantId),
        eq(s.practitioners.facilityId, scope.facilityId),
        eq(s.practitioners.isActive, true),
      ),
    )
    .orderBy(asc(s.practitioners.fullName));
}
export async function listCases(scope: TheatreScope) {
  const rows = await db
    .select({
      record: {
        id: s.theatreCases.id,
        patientId: s.theatreCases.patientId,
        procedureName: s.theatreCases.procedureName,
        theatreRoom: s.theatreCases.theatreRoom,
        leadSurgeon: s.theatreCases.leadSurgeon,
        scheduledStart: s.theatreCases.scheduledStart,
        scheduledEnd: s.theatreCases.scheduledEnd,
        status: s.theatreCases.status,
      },
      booking: s.theatreBookings,
      roomName: s.theatreRooms.name,
      patient: {
        id: s.patients.id,
        firstName: s.patients.firstName,
        lastName: s.patients.lastName,
        mrn: s.patients.mrn,
      },
    })
    .from(s.theatreCases)
    .leftJoin(
      s.theatreBookings,
      and(
        eq(s.theatreBookings.caseId, s.theatreCases.id),
        eq(s.theatreBookings.tenantId, scope.tenantId),
        eq(s.theatreBookings.facilityId, scope.facilityId),
      ),
    )
    .leftJoin(
      s.theatreRooms,
      and(
        eq(s.theatreRooms.id, s.theatreBookings.roomId),
        eq(s.theatreRooms.tenantId, scope.tenantId),
        eq(s.theatreRooms.facilityId, scope.facilityId),
      ),
    )
    .leftJoin(
      s.patients,
      and(
        eq(s.patients.id, s.theatreCases.patientId),
        eq(s.patients.tenantId, scope.tenantId),
        eq(s.patients.registrationFacilityId, scope.facilityId),
      ),
    )
    .where(
      and(
        eq(s.theatreCases.tenantId, scope.tenantId),
        eq(s.theatreCases.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(s.theatreCases.id));
  const reviews = await db
    .select()
    .from(s.theatreLegacyReviewEvents)
    .where(
      and(
        eq(s.theatreLegacyReviewEvents.tenantId, scope.tenantId),
        eq(s.theatreLegacyReviewEvents.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(s.theatreLegacyReviewEvents.id));
  const latest = new Map<number, typeof s.theatreLegacyReviewEvents.$inferSelect>();
  for (const review of reviews) if (!latest.has(review.caseId)) latest.set(review.caseId, review);
  return rows.map(({ record, booking, roomName, patient }) => ({
    ...record,
    booking: publicBooking(booking),
    roomName,
    patient,
    legacyReview: booking ? null : (latest.get(record.id) ?? null),
  }));
}

export async function createRoom(scope: TheatreScope, body: TheatreRoomCreate) {
  try {
    return await db.transaction(async (tx) => {
      const [room] = await tx
        .insert(s.theatreRooms)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          name: body.name,
          createdBy: scope.actorId,
        })
        .returning();
      await audit(tx, scope, 'theatre_room', room.id, 'THEATRE_ROOM_CREATED');
      return room;
    });
  } catch (error) {
    return translate(error);
  }
}

export async function setRoomState(scope: TheatreScope, roomId: number, body: TheatreRoomState) {
  return db.transaction(async (tx) => {
    const [room] = await tx
      .select()
      .from(s.theatreRooms)
      .where(
        and(
          eq(s.theatreRooms.id, roomId),
          eq(s.theatreRooms.tenantId, scope.tenantId),
          eq(s.theatreRooms.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!room) throw roomMissing();
    if (room.state === body.state) return room;
    const [updated] = await tx
      .update(s.theatreRooms)
      .set({ state: body.state, updatedAt: new Date() })
      .where(eq(s.theatreRooms.id, roomId))
      .returning();
    await audit(
      tx,
      scope,
      'theatre_room',
      room.id,
      'THEATRE_ROOM_STATE_CHANGED',
      JSON.stringify({ from: room.state, to: body.state }),
    );
    return updated;
  });
}

async function lockOpenRoom(tx: Tx, scope: TheatreScope, roomId: number) {
  const [room] = await tx
    .select()
    .from(s.theatreRooms)
    .where(
      and(
        eq(s.theatreRooms.id, roomId),
        eq(s.theatreRooms.tenantId, scope.tenantId),
        eq(s.theatreRooms.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for('update');
  if (!room) throw roomMissing();
  if (room.state !== 'OPEN')
    throw new TheatreError(409, 'THEATRE_ROOM_NOT_OPEN', 'This room is not open for new bookings.');
  return room;
}

/** Serialize review/revocation with new or moved reservations within a facility. */
async function lockFacilitySchedule(tx: Tx, scope: TheatreScope) {
  // The zero namespace is separate from createBooking's positive facility/key namespace.
  await tx.execute(sql`select pg_advisory_xact_lock(0, ${scope.facilityId}::integer)`);
}

/** Legacy statuses are not proof that an old reservation has ceased. */
async function rejectUnreconciledLegacy(tx: Tx, scope: TheatreScope) {
  const [legacy] = await tx
    .select({ id: s.theatreCases.id })
    .from(s.theatreCases)
    .leftJoin(s.theatreBookings, eq(s.theatreBookings.caseId, s.theatreCases.id))
    .where(
      and(
        eq(s.theatreCases.tenantId, scope.tenantId),
        eq(s.theatreCases.facilityId, scope.facilityId),
        isNull(s.theatreBookings.caseId),
        sql`coalesce((select action from theatre_legacy_review_events e
        where e.case_id = ${s.theatreCases.id} and e.tenant_id = ${scope.tenantId} and e.facility_id = ${scope.facilityId}
        order by e.id desc limit 1), '') <> 'NO_ACTIVE_RESERVATION'`,
      ),
    )
    .limit(1);
  if (legacy)
    throw new TheatreError(
      409,
      'LEGACY_SCHEDULE_REVIEW_REQUIRED',
      'Historical cases need an explicit reservation review before scheduling in this facility.',
    );
}

async function lockCase(tx: Tx, scope: TheatreScope, id: number) {
  const [record] = await tx
    .select()
    .from(s.theatreCases)
    .where(
      and(
        eq(s.theatreCases.id, id),
        eq(s.theatreCases.tenantId, scope.tenantId),
        eq(s.theatreCases.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for('update');
  if (!record) throw missingCase();
  const [booking] = await tx
    .select()
    .from(s.theatreBookings)
    .where(
      and(
        eq(s.theatreBookings.caseId, id),
        eq(s.theatreBookings.tenantId, scope.tenantId),
        eq(s.theatreBookings.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for('update');
  if (!booking)
    throw new TheatreError(
      409,
      'LEGACY_CASE_READ_ONLY',
      'This legacy case requires a reviewed migration before it can be changed.',
    );
  return { record, booking };
}
function requireScheduled(
  record: typeof s.theatreCases.$inferSelect,
  booking: typeof s.theatreBookings.$inferSelect,
  revision: number,
) {
  if (booking.revision !== revision)
    throw new TheatreError(
      409,
      'STALE_THEATRE_BOOKING',
      'The booking changed. Refresh before trying again.',
    );
  if (record.status !== 'Scheduled' || !booking.reserved)
    throw new TheatreError(
      409,
      'INVALID_THEATRE_TRANSITION',
      'Only a scheduled, reserved case can be changed here.',
    );
}

function normalizedRequest(body: TheatreBookingCreate) {
  return {
    patientId: body.patientId,
    procedureName: body.procedureName,
    leadPractitionerId: body.leadPractitionerId,
    urgency: body.urgency,
    encounterId: body.encounterId ?? null,
    admissionId: body.admissionId ?? null,
    roomId: body.roomId,
    startsAt: new Date(body.startsAt).toISOString(),
    endsAt: new Date(body.endsAt).toISOString(),
  };
}

export async function createBooking(scope: TheatreScope, body: TheatreBookingCreate) {
  const input = normalizedRequest(body);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  try {
    return await db.transaction(async (tx) => {
      await lockFacilitySchedule(tx, scope);
      // Serialize retries for the same facility/key, even across different rooms.
      await tx.execute(
        sql`select pg_advisory_xact_lock(${scope.facilityId}, hashtext(${body.requestKey}))`,
      );
      const [existing] = await tx
        .select()
        .from(s.theatreBookings)
        .where(
          and(
            eq(s.theatreBookings.facilityId, scope.facilityId),
            eq(s.theatreBookings.requestKey, body.requestKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.tenantId !== scope.tenantId || existing.requestHash !== hash)
          throw new TheatreError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'The request key was already used for a different booking.',
          );
        const [record] = await tx
          .select()
          .from(s.theatreCases)
          .where(
            and(
              eq(s.theatreCases.id, existing.caseId),
              eq(s.theatreCases.tenantId, scope.tenantId),
              eq(s.theatreCases.facilityId, scope.facilityId),
            ),
          )
          .limit(1);
        if (!record) throw missingCase();
        return { record: publicCase(record), booking: publicBooking(existing), replayed: true };
      }
      const room = await lockOpenRoom(tx, scope, input.roomId);
      await rejectUnreconciledLegacy(tx, scope);
      // Match the existing facility-scoped patient policy. A cross-facility care
      // relationship alone is not assumed to be consent for sharing records.
      const [patient] = await tx
        .select({ id: s.patients.id })
        .from(s.patients)
        .where(
          and(
            eq(s.patients.id, input.patientId),
            eq(s.patients.tenantId, scope.tenantId),
            eq(s.patients.registrationFacilityId, scope.facilityId),
          ),
        )
        .limit(1)
        .for('share');
      if (!patient)
        throw new TheatreError(404, 'PATIENT_NOT_FOUND', 'Patient not found in this facility.');
      const [clinician] = await tx
        .select({ id: s.practitioners.id, fullName: s.practitioners.fullName })
        .from(s.practitioners)
        .where(
          and(
            eq(s.practitioners.id, input.leadPractitionerId),
            eq(s.practitioners.tenantId, scope.tenantId),
            eq(s.practitioners.facilityId, scope.facilityId),
            eq(s.practitioners.isActive, true),
          ),
        )
        .limit(1)
        .for('share');
      if (!clinician)
        throw new TheatreError(
          404,
          'PRACTITIONER_NOT_FOUND',
          'Active practitioner not found in this facility.',
        );
      if (input.encounterId) {
        const [encounter] = await tx
          .select({ id: s.encounters.id })
          .from(s.encounters)
          .where(
            and(
              eq(s.encounters.id, input.encounterId),
              eq(s.encounters.patientId, patient.id),
              eq(s.encounters.tenantId, scope.tenantId),
              eq(s.encounters.facilityId, scope.facilityId),
            ),
          )
          .limit(1)
          .for('share');
        if (!encounter)
          throw new TheatreError(
            404,
            'ENCOUNTER_NOT_FOUND',
            'Encounter not found for this patient in this facility.',
          );
      }
      if (input.admissionId) {
        const [admission] = await tx
          .select({
            id: s.admissions.id,
            encounterId: s.admissions.encounterId,
            status: s.admissions.status,
          })
          .from(s.admissions)
          .where(
            and(
              eq(s.admissions.id, input.admissionId),
              eq(s.admissions.patientId, patient.id),
              eq(s.admissions.tenantId, scope.tenantId),
              eq(s.admissions.facilityId, scope.facilityId),
            ),
          )
          .limit(1)
          .for('share');
        if (
          !admission ||
          admission.status !== 'Admitted' ||
          (input.encounterId &&
            admission.encounterId &&
            admission.encounterId !== input.encounterId)
        )
          throw new TheatreError(
            404,
            'ADMISSION_NOT_FOUND',
            'Active admission not found for this patient and encounter in this facility.',
          );
      }
      const [record] = await tx
        .insert(s.theatreCases)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          patientId: patient.id,
          procedureName: input.procedureName,
          theatreRoom: room.name,
          theatreType: null,
          leadSurgeon: clinician.fullName,
          scheduledStart: input.startsAt,
          scheduledEnd: input.endsAt,
          preOpChecklist: {},
          status: 'Scheduled',
        })
        .returning();
      const [booking] = await tx
        .insert(s.theatreBookings)
        .values({
          caseId: record.id,
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          roomId: room.id,
          patientId: patient.id,
          leadPractitionerId: clinician.id,
          urgency: input.urgency,
          encounterId: input.encounterId,
          admissionId: input.admissionId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          requestKey: body.requestKey,
          requestHash: hash,
          createdBy: scope.actorId,
        })
        .returning();
      await tx.insert(s.theatreScheduleEvents).values({
        caseId: record.id,
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        action: 'SCHEDULED',
        newRoomId: room.id,
        newStartsAt: booking.startsAt,
        newEndsAt: booking.endsAt,
        actorId: scope.actorId,
      });
      await audit(tx, scope, 'theatre_case', record.id, 'THEATRE_CASE_SCHEDULED');
      return { record: publicCase(record), booking: publicBooking(booking), replayed: false };
    });
  } catch (error) {
    return translate(error);
  }
}

export async function rescheduleBooking(scope: TheatreScope, id: number, body: TheatreReschedule) {
  try {
    return await db.transaction(async (tx) => {
      await lockFacilitySchedule(tx, scope);
      const { record, booking } = await lockCase(tx, scope, id);
      requireScheduled(record, booking, body.expectedRevision);
      const room = await lockOpenRoom(tx, scope, body.roomId);
      await rejectUnreconciledLegacy(tx, scope);
      const startsAt = new Date(body.startsAt),
        endsAt = new Date(body.endsAt);
      const [updated] = await tx
        .update(s.theatreBookings)
        .set({
          roomId: room.id,
          startsAt,
          endsAt,
          revision: booking.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.theatreBookings.caseId, id))
        .returning();
      await tx
        .update(s.theatreCases)
        .set({
          theatreRoom: room.name,
          scheduledStart: startsAt.toISOString(),
          scheduledEnd: endsAt.toISOString(),
          updatedAt: new Date(),
        })
        .where(eq(s.theatreCases.id, id));
      await tx.insert(s.theatreScheduleEvents).values({
        caseId: id,
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        action: 'RESCHEDULED',
        reason: body.reason,
        previousRoomId: booking.roomId,
        previousStartsAt: booking.startsAt,
        previousEndsAt: booking.endsAt,
        newRoomId: room.id,
        newStartsAt: startsAt,
        newEndsAt: endsAt,
        actorId: scope.actorId,
      });
      await audit(tx, scope, 'theatre_case', id, 'THEATRE_CASE_RESCHEDULED');
      return { booking: publicBooking(updated) };
    });
  } catch (error) {
    return translate(error);
  }
}

export async function cancelBooking(scope: TheatreScope, id: number, body: TheatreCancel) {
  return db.transaction(async (tx) => {
    const { record, booking } = await lockCase(tx, scope, id);
    requireScheduled(record, booking, body.expectedRevision);
    const [updated] = await tx
      .update(s.theatreBookings)
      .set({ reserved: false, revision: booking.revision + 1, updatedAt: new Date() })
      .where(eq(s.theatreBookings.caseId, id))
      .returning();
    await tx
      .update(s.theatreCases)
      .set({ status: 'Cancelled', updatedAt: new Date() })
      .where(eq(s.theatreCases.id, id));
    await tx.insert(s.theatreScheduleEvents).values({
      caseId: id,
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      action: 'CANCELLED',
      reason: body.reason,
      previousRoomId: booking.roomId,
      previousStartsAt: booking.startsAt,
      previousEndsAt: booking.endsAt,
      actorId: scope.actorId,
    });
    await audit(tx, scope, 'theatre_case', id, 'THEATRE_CASE_CANCELLED');
    return { booking: publicBooking(updated) };
  });
}

/** Explicit, reversible scheduling attestation; the old case remains untouched. */
export async function reviewLegacyReservation(
  scope: TheatreScope,
  id: number,
  body: TheatreLegacyReview,
) {
  return db.transaction(async (tx) => {
    await lockFacilitySchedule(tx, scope);
    const [record] = await tx
      .select({ id: s.theatreCases.id })
      .from(s.theatreCases)
      .where(
        and(
          eq(s.theatreCases.id, id),
          eq(s.theatreCases.tenantId, scope.tenantId),
          eq(s.theatreCases.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!record) throw missingCase();
    const [booking] = await tx
      .select({ caseId: s.theatreBookings.caseId })
      .from(s.theatreBookings)
      .where(eq(s.theatreBookings.caseId, id))
      .limit(1);
    if (booking)
      throw new TheatreError(
        409,
        'NOT_A_LEGACY_CASE',
        'This case has a structured booking; use its scheduling controls.',
      );
    const [previous] = await tx
      .select()
      .from(s.theatreLegacyReviewEvents)
      .where(
        and(
          eq(s.theatreLegacyReviewEvents.caseId, id),
          eq(s.theatreLegacyReviewEvents.tenantId, scope.tenantId),
          eq(s.theatreLegacyReviewEvents.facilityId, scope.facilityId),
        ),
      )
      .orderBy(desc(s.theatreLegacyReviewEvents.id))
      .limit(1);
    if (body.action === 'NO_ACTIVE_RESERVATION' && previous?.action === 'NO_ACTIVE_RESERVATION')
      throw new TheatreError(
        409,
        'LEGACY_REVIEW_UNCHANGED',
        'This reservation is already reviewed.',
      );
    if (body.action === 'REVOKED' && previous?.action !== 'NO_ACTIVE_RESERVATION')
      throw new TheatreError(
        409,
        'LEGACY_REVIEW_UNCHANGED',
        'There is no active review to revoke.',
      );
    const [event] = await tx
      .insert(s.theatreLegacyReviewEvents)
      .values({
        caseId: id,
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        action: body.action,
        reason: body.reason,
        actorId: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'theatre_case',
      id,
      body.action === 'REVOKED'
        ? 'THEATRE_LEGACY_REVIEW_REVOKED'
        : 'THEATRE_LEGACY_RESERVATION_REVIEWED',
    );
    return event;
  });
}

export async function legacyReviewHistory(scope: TheatreScope, id: number) {
  const [record] = await db
    .select({ id: s.theatreCases.id })
    .from(s.theatreCases)
    .where(
      and(
        eq(s.theatreCases.id, id),
        eq(s.theatreCases.tenantId, scope.tenantId),
        eq(s.theatreCases.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!record) throw missingCase();
  return db
    .select()
    .from(s.theatreLegacyReviewEvents)
    .where(
      and(
        eq(s.theatreLegacyReviewEvents.caseId, id),
        eq(s.theatreLegacyReviewEvents.tenantId, scope.tenantId),
        eq(s.theatreLegacyReviewEvents.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(s.theatreLegacyReviewEvents.id));
}

export async function schedulingHistory(scope: TheatreScope, id: number) {
  const [record] = await db
    .select({ id: s.theatreCases.id })
    .from(s.theatreCases)
    .where(
      and(
        eq(s.theatreCases.id, id),
        eq(s.theatreCases.tenantId, scope.tenantId),
        eq(s.theatreCases.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!record) throw missingCase();
  return db
    .select()
    .from(s.theatreScheduleEvents)
    .where(
      and(
        eq(s.theatreScheduleEvents.caseId, id),
        eq(s.theatreScheduleEvents.tenantId, scope.tenantId),
        eq(s.theatreScheduleEvents.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(s.theatreScheduleEvents.id));
}

/** Current structured bookings whose current start falls in [from, to).
 * This is a plan, not evidence of operations performed or actual utilisation.
 */
export async function scheduleReport(scope: TheatreScope, from: string, to: string) {
  const rows = await db
    .select({
      roomId: s.theatreRooms.id,
      roomName: s.theatreRooms.name,
      urgency: s.theatreBookings.urgency,
      status: s.theatreCases.status,
      reserved: s.theatreBookings.reserved,
      count: sql<number>`count(*)::integer`,
      plannedMinutes: sql<number>`coalesce(sum(extract(epoch from (${s.theatreBookings.endsAt} - ${s.theatreBookings.startsAt})) / 60), 0)::float8`,
    })
    .from(s.theatreBookings)
    .innerJoin(
      s.theatreCases,
      and(
        eq(s.theatreCases.id, s.theatreBookings.caseId),
        eq(s.theatreCases.tenantId, scope.tenantId),
        eq(s.theatreCases.facilityId, scope.facilityId),
      ),
    )
    .innerJoin(
      s.theatreRooms,
      and(
        eq(s.theatreRooms.id, s.theatreBookings.roomId),
        eq(s.theatreRooms.tenantId, scope.tenantId),
        eq(s.theatreRooms.facilityId, scope.facilityId),
      ),
    )
    .where(
      and(
        eq(s.theatreBookings.tenantId, scope.tenantId),
        eq(s.theatreBookings.facilityId, scope.facilityId),
        gte(s.theatreBookings.startsAt, new Date(from)),
        lt(s.theatreBookings.startsAt, new Date(to)),
      ),
    )
    .groupBy(
      s.theatreRooms.id,
      s.theatreRooms.name,
      s.theatreBookings.urgency,
      s.theatreCases.status,
      s.theatreBookings.reserved,
    )
    .orderBy(asc(s.theatreRooms.name));
  const totals = { bookings: 0, reserved: 0, cancelled: 0, otherUnreserved: 0, reservedMinutes: 0 };
  for (const row of rows) {
    totals.bookings += row.count;
    if (row.reserved) {
      totals.reserved += row.count;
      totals.reservedMinutes += row.plannedMinutes;
    } else if (row.status === 'Cancelled') totals.cancelled += row.count;
    else totals.otherUnreserved += row.count;
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), totals, rows };
}
