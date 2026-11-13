import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { db } from '../db/index.ts';
import { getFacilityByIdScoped } from '../db/queries/tenancy.ts';
import * as schema from '../db/schema.ts';
import type {
  AppointmentCancelInput,
  AppointmentCategoryInput,
  AppointmentCategoryUpdate,
  AppointmentCheckInInput,
  AppointmentListQuery,
  AppointmentRescheduleInput,
  CreateAppointmentInput,
} from '../validation/schemas/appointments.schema.ts';

export class AppointmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AppointmentError';
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope = { tenantId: number; facilityId: number };
type AppointmentRow = typeof schema.appointments.$inferSelect;
const activeStatuses = ['Scheduled', 'Confirmed', 'Checked-in'];
const mutableStatuses = ['Scheduled', 'Confirmed'];
const localTime = (value: string) => value.replace(' ', 'T');
const reference = () => `APT-${randomUUID().toUpperCase()}`;
const hashRequest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function appointmentScope(
  context: AuthorizationContext,
  requestedFacilityId?: number,
): Promise<Scope> {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new AppointmentError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return { tenantId: facility.tenantId, facilityId: facility.id };
}

export function appointmentRequestKey(
  value: string | undefined,
  required = false,
): string | undefined {
  if (!value && !required) return undefined; // Legacy clients remain supported, without retry guarantees.
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new AppointmentError(
      'INVALID_IDEMPOTENCY_KEY',
      'Provide an Idempotency-Key of 8–128 letters, numbers, dots, hyphens, underscores or colons.',
      400,
    );
  }
  return value;
}

async function replay(
  tx: Tx,
  scope: Scope,
  actor: number,
  operation: 'CREATE' | 'RESCHEDULE',
  key: string | undefined,
  requestHash: string,
) {
  if (!key) return null;
  // Serialize concurrent retries before looking up the unique request identity.
  const lock = `appointment:${scope.tenantId}:${scope.facilityId}:${actor}:${operation}:${key}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
  const [request] = await tx
    .select()
    .from(schema.appointmentRequests)
    .where(
      and(
        eq(schema.appointmentRequests.tenantId, scope.tenantId),
        eq(schema.appointmentRequests.facilityId, scope.facilityId),
        eq(schema.appointmentRequests.actorUserId, actor),
        eq(schema.appointmentRequests.operation, operation),
        eq(schema.appointmentRequests.requestKey, key),
      ),
    )
    .limit(1);
  if (!request) return null;
  if (request.requestHash !== requestHash)
    throw new AppointmentError(
      'IDEMPOTENCY_CONFLICT',
      'This request key was already used for different booking details.',
      409,
    );
  const [appointment] = await tx
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.id, request.resultAppointmentId),
        eq(schema.appointments.tenantId, scope.tenantId),
        eq(schema.appointments.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!appointment)
    throw new AppointmentError(
      'IDEMPOTENCY_RESULT_MISSING',
      'The original booking could not be retrieved.',
      409,
    );
  return appointment;
}
async function saveRequest(
  tx: Tx,
  scope: Scope,
  actor: number,
  operation: 'CREATE' | 'RESCHEDULE',
  key: string | undefined,
  requestHash: string,
  appointmentId: number,
) {
  if (!key) return;
  await tx.insert(schema.appointmentRequests).values({
    ...scope,
    actorUserId: actor,
    operation,
    requestKey: key,
    requestHash,
    resultAppointmentId: appointmentId,
  });
}
async function audit(
  tx: Tx,
  scope: Scope,
  actor: number,
  action: string,
  resource: string,
  id: number,
  details: Record<string, unknown>,
) {
  await tx.insert(schema.auditLogs).values({
    ...scope,
    userId: String(actor),
    action,
    resource,
    resourceId: String(id),
    details: JSON.stringify(details),
  });
}
async function event(
  tx: Tx,
  scope: Scope,
  actor: number,
  data: Omit<
    typeof schema.appointmentEvents.$inferInsert,
    'tenantId' | 'facilityId' | 'actorUserId' | 'actorType'
  >,
) {
  await tx
    .insert(schema.appointmentEvents)
    .values({ ...scope, actorUserId: actor, actorType: 'STAFF', ...data });
}

/** Existing writers (including dialysis and the website) remain visible, but only within scope. */
export async function listAppointmentsScoped(
  context: AuthorizationContext,
  query: AppointmentListQuery,
) {
  const scope = await appointmentScope(context, query.facilityId);
  const conditions: SQL[] = [
    eq(schema.appointments.tenantId, scope.tenantId),
    eq(schema.appointments.facilityId, scope.facilityId),
  ];
  if (query.from && query.to) {
    conditions.push(sql`left(${schema.appointments.scheduledTime}, 10) >= ${query.from}`);
    conditions.push(sql`left(${schema.appointments.scheduledTime}, 10) <= ${query.to}`);
  }
  if (query.patientId) conditions.push(eq(schema.appointments.patientId, query.patientId));
  if (query.practitionerId)
    conditions.push(eq(schema.appointments.practitionerId, query.practitionerId));
  if (query.categoryId) conditions.push(eq(schema.appointments.categoryId, query.categoryId));
  if (query.status) conditions.push(eq(schema.appointments.status, query.status));
  if (query.active === 'true') conditions.push(inArray(schema.appointments.status, activeStatuses));
  return db
    .select()
    .from(schema.appointments)
    .where(and(...conditions))
    .orderBy(
      ...(query.from
        ? [
            asc(sql`replace(${schema.appointments.scheduledTime}, ' ', 'T')`),
            asc(schema.appointments.id),
          ]
        : [desc(schema.appointments.createdAt), desc(schema.appointments.id)]),
    )
    .limit(query.limit)
    .offset(query.offset);
}

async function assertPatient(tx: Tx, scope: Scope, patientId: number) {
  // Existing patient-access policy: registration, an active facility relationship,
  // or a prior encounter at the selected facility. Never infer identity by name.
  const [patient] = await tx
    .select({ id: schema.patients.id })
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.id, patientId),
        eq(schema.patients.tenantId, scope.tenantId),
        or(
          eq(schema.patients.registrationFacilityId, scope.facilityId),
          exists(
            tx
              .select({ id: schema.patientFacilities.id })
              .from(schema.patientFacilities)
              .where(
                and(
                  eq(schema.patientFacilities.patientId, schema.patients.id),
                  eq(schema.patientFacilities.tenantId, scope.tenantId),
                  eq(schema.patientFacilities.facilityId, scope.facilityId),
                  eq(schema.patientFacilities.status, 'ACTIVE'),
                ),
              ),
          ),
          exists(
            tx
              .select({ id: schema.encounters.id })
              .from(schema.encounters)
              .where(
                and(
                  eq(schema.encounters.patientId, schema.patients.id),
                  eq(schema.encounters.tenantId, scope.tenantId),
                  eq(schema.encounters.facilityId, scope.facilityId),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  if (!patient)
    throw new AppointmentError('PATIENT_NOT_FOUND', 'Patient not found in this facility.', 404);
}
async function assertReferences(
  tx: Tx,
  scope: Scope,
  input: { practitionerId?: number | null; departmentId?: number | null },
) {
  if (input.departmentId != null) {
    const [department] = await tx
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(
        and(
          eq(schema.departments.id, input.departmentId),
          eq(schema.departments.facilityId, scope.facilityId),
          eq(schema.departments.isActive, true),
        ),
      )
      .limit(1);
    if (!department)
      throw new AppointmentError(
        'DEPARTMENT_NOT_FOUND',
        'Active department not found in this facility.',
        404,
      );
  }
  if (input.practitionerId != null) {
    const [practitioner] = await tx
      .select({ id: schema.practitioners.id })
      .from(schema.practitioners)
      .where(
        and(
          eq(schema.practitioners.id, input.practitionerId),
          eq(schema.practitioners.tenantId, scope.tenantId),
          eq(schema.practitioners.facilityId, scope.facilityId),
          eq(schema.practitioners.isActive, true),
        ),
      )
      .limit(1);
    if (!practitioner)
      throw new AppointmentError(
        'PRACTITIONER_NOT_FOUND',
        'Active practitioner not found in this facility.',
        404,
      );
  }
}
async function assertService(tx: Tx, scope: Scope, id: number | null | undefined) {
  if (id == null) return;
  const [service] = await tx
    .select({ id: schema.facilityServices.id })
    .from(schema.facilityServices)
    .where(
      and(
        eq(schema.facilityServices.id, id),
        eq(schema.facilityServices.tenantId, scope.tenantId),
        eq(schema.facilityServices.facilityId, scope.facilityId),
        eq(schema.facilityServices.isActive, true),
      ),
    )
    .limit(1);
  if (!service)
    throw new AppointmentError(
      'SERVICE_NOT_FOUND',
      'Active service not found in this facility.',
      404,
    );
}
async function activeCategory(tx: Tx, scope: Scope, categoryId: number) {
  const [category] = await tx
    .select()
    .from(schema.appointmentCategories)
    .where(
      and(
        eq(schema.appointmentCategories.id, categoryId),
        eq(schema.appointmentCategories.tenantId, scope.tenantId),
        eq(schema.appointmentCategories.facilityId, scope.facilityId),
        eq(schema.appointmentCategories.isActive, true),
      ),
    )
    .limit(1);
  if (!category)
    throw new AppointmentError(
      'CATEGORY_NOT_FOUND',
      'Active category not found in this facility.',
      404,
    );
  await assertService(tx, scope, category.facilityServiceId);
  return category;
}

/** Booking is not care, a charge, confirmation of payment, a reserved resource or SMS delivery. */
export async function createAppointmentScoped(
  context: AuthorizationContext,
  input: CreateAppointmentInput,
  key?: string,
) {
  const scope = await appointmentScope(context, input.facilityId);
  if (input.tenantId !== undefined && input.tenantId !== scope.tenantId) {
    throw new AppointmentError(
      'TENANT_SCOPE_MISMATCH',
      'The supplied tenant does not match the selected facility.',
      403,
    );
  }
  if (input.status != null && input.status !== 'Scheduled')
    throw new AppointmentError(
      'INVALID_INITIAL_STATUS',
      'New staff appointments must be scheduled.',
      400,
    );
  const requestHash = hashRequest({
    scope,
    patientId: input.patientId,
    practitionerId: input.practitionerId ?? null,
    departmentId: input.departmentId ?? null,
    categoryId: input.categoryId ?? null,
    scheduledTime: localTime(input.scheduledTime),
    durationMinutes: input.durationMinutes ?? 30,
    appointmentType: input.appointmentType || null,
    priority: input.priority ?? null,
    reason: input.reason || null,
    notes: input.notes || null,
  });
  return db.transaction(async (tx) => {
    const prior = await replay(tx, scope, context.userId, 'CREATE', key, requestHash);
    if (prior) return { appointment: prior, idempotentReplay: true };
    await assertPatient(tx, scope, input.patientId);
    await assertReferences(tx, scope, input);
    const category =
      input.categoryId == null ? null : await activeCategory(tx, scope, input.categoryId);
    const [appointment] = await tx
      .insert(schema.appointments)
      .values({
        ...scope,
        patientId: input.patientId,
        practitionerId: input.practitionerId ?? null,
        departmentId: input.departmentId ?? null,
        categoryId: category?.id ?? null,
        facilityServiceId: category?.facilityServiceId ?? null,
        scheduledTime: localTime(input.scheduledTime),
        durationMinutes: input.durationMinutes ?? 30,
        appointmentType: category?.name ?? (input.appointmentType || null),
        status: 'Scheduled',
        priority: input.priority ?? null,
        reason: input.reason || null,
        notes: input.notes || null,
        bookingReference: reference(),
        createdByUserId: context.userId,
      })
      .returning();
    await event(tx, scope, context.userId, {
      appointmentId: appointment.id,
      eventType: 'CREATED',
      toStatus: 'Scheduled',
      scheduledTimeAfter: appointment.scheduledTime,
    });
    await audit(tx, scope, context.userId, 'CREATE', 'Appointment', appointment.id, {
      status: 'Scheduled',
    });
    await saveRequest(tx, scope, context.userId, 'CREATE', key, requestHash, appointment.id);
    return { appointment, idempotentReplay: false };
  });
}

export async function listAppointmentResourcesScoped(
  context: AuthorizationContext,
  facilityId?: number,
) {
  const scope = await appointmentScope(context, facilityId);
  const [departments, practitioners] = await Promise.all([
    db
      .select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departments)
      .where(
        and(
          eq(schema.departments.facilityId, scope.facilityId),
          eq(schema.departments.isActive, true),
        ),
      )
      .orderBy(asc(schema.departments.name)),
    db
      .select({
        id: schema.practitioners.id,
        name: schema.practitioners.fullName,
        departmentId: schema.practitioners.departmentId,
      })
      .from(schema.practitioners)
      .where(
        and(
          eq(schema.practitioners.tenantId, scope.tenantId),
          eq(schema.practitioners.facilityId, scope.facilityId),
          eq(schema.practitioners.isActive, true),
        ),
      )
      .orderBy(asc(schema.practitioners.fullName)),
  ]);
  // Active is an operational flag; it is not proof of professional credentials.
  return { departments, practitioners };
}

export async function listAppointmentCategoriesScoped(
  context: AuthorizationContext,
  facilityId?: number,
) {
  const scope = await appointmentScope(context, facilityId);
  return db
    .select()
    .from(schema.appointmentCategories)
    .where(
      and(
        eq(schema.appointmentCategories.tenantId, scope.tenantId),
        eq(schema.appointmentCategories.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.appointmentCategories.name), asc(schema.appointmentCategories.id));
}
export async function createAppointmentCategoryScoped(
  context: AuthorizationContext,
  input: AppointmentCategoryInput,
) {
  const scope = await appointmentScope(context, input.facilityId);
  return db.transaction(async (tx) => {
    await assertService(tx, scope, input.facilityServiceId);
    const [category] = await tx
      .insert(schema.appointmentCategories)
      .values({
        ...scope,
        code: input.code,
        name: input.name,
        facilityServiceId: input.facilityServiceId ?? null,
        createdByUserId: context.userId,
      })
      .onConflictDoNothing({
        target: [schema.appointmentCategories.facilityId, schema.appointmentCategories.code],
      })
      .returning();
    if (!category)
      throw new AppointmentError(
        'CATEGORY_CODE_EXISTS',
        'This category code is already used in the facility.',
        409,
      );
    await audit(tx, scope, context.userId, 'CREATE', 'AppointmentCategory', category.id, {
      code: category.code,
      facilityServiceId: category.facilityServiceId,
    });
    return category;
  });
}
export async function updateAppointmentCategoryScoped(
  context: AuthorizationContext,
  id: number,
  input: AppointmentCategoryUpdate,
) {
  const scope = await appointmentScope(context, input.facilityId);
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(schema.appointmentCategories)
      .where(
        and(
          eq(schema.appointmentCategories.id, id),
          eq(schema.appointmentCategories.tenantId, scope.tenantId),
          eq(schema.appointmentCategories.facilityId, scope.facilityId),
        ),
      )
      .for('update');
    if (!old)
      throw new AppointmentError('CATEGORY_NOT_FOUND', 'Category not found in this facility.', 404);
    if (input.facilityServiceId !== undefined)
      await assertService(tx, scope, input.facilityServiceId);
    const [updated] = await tx
      .update(schema.appointmentCategories)
      .set({
        name: input.name ?? old.name,
        facilityServiceId:
          input.facilityServiceId === undefined ? old.facilityServiceId : input.facilityServiceId,
        isActive: input.isActive ?? old.isActive,
        updatedAt: new Date(),
      })
      .where(eq(schema.appointmentCategories.id, id))
      .returning();
    await audit(tx, scope, context.userId, 'UPDATE', 'AppointmentCategory', id, {
      previous: {
        name: old.name,
        facilityServiceId: old.facilityServiceId,
        isActive: old.isActive,
      },
      next: {
        name: updated.name,
        facilityServiceId: updated.facilityServiceId,
        isActive: updated.isActive,
      },
    });
    return updated;
  });
}

async function lockedAppointment(tx: Tx, scope: Scope, id: number): Promise<AppointmentRow> {
  const [appointment] = await tx
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.id, id),
        eq(schema.appointments.tenantId, scope.tenantId),
        eq(schema.appointments.facilityId, scope.facilityId),
      ),
    )
    .for('update');
  if (!appointment)
    throw new AppointmentError(
      'APPOINTMENT_NOT_FOUND',
      'Appointment not found in this facility.',
      404,
    );
  return appointment;
}
async function assertStandalone(tx: Tx, id: number) {
  const [dialysis] = await tx
    .select({ id: schema.dialysisSchedules.id })
    .from(schema.dialysisSchedules)
    .where(eq(schema.dialysisSchedules.appointmentId, id))
    .limit(1);
  const [website] = await tx
    .select({ id: schema.externalBookings.id })
    .from(schema.externalBookings)
    .where(eq(schema.externalBookings.linkedAppointmentId, id))
    .limit(1);
  if (dialysis || website)
    throw new AppointmentError(
      'SOURCE_WORKFLOW_REQUIRED',
      'This appointment is linked to another workflow; coordinated changes are not yet supported here.',
      409,
    );
}
function assertMutable(appointment: AppointmentRow) {
  if (
    !appointment.status ||
    !mutableStatuses.includes(appointment.status) ||
    appointment.checkinQueueId
  ) {
    throw new AppointmentError(
      'APPOINTMENT_STATE_CONFLICT',
      'Only scheduled or confirmed appointments that have not checked in can be changed.',
      409,
    );
  }
}
export async function getAppointmentHistoryScoped(
  context: AuthorizationContext,
  id: number,
  facilityId?: number,
) {
  const scope = await appointmentScope(context, facilityId);
  const [appointment] = await db
    .select({ id: schema.appointments.id })
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.id, id),
        eq(schema.appointments.tenantId, scope.tenantId),
        eq(schema.appointments.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!appointment)
    throw new AppointmentError(
      'APPOINTMENT_NOT_FOUND',
      'Appointment not found in this facility.',
      404,
    );
  return db
    .select()
    .from(schema.appointmentEvents)
    .where(
      and(
        eq(schema.appointmentEvents.appointmentId, id),
        eq(schema.appointmentEvents.tenantId, scope.tenantId),
        eq(schema.appointmentEvents.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.appointmentEvents.id));
}
export async function cancelAppointmentScoped(
  context: AuthorizationContext,
  id: number,
  input: AppointmentCancelInput,
) {
  const scope = await appointmentScope(context, input.facilityId);
  return db.transaction(async (tx) => {
    const old = await lockedAppointment(tx, scope, id);
    await assertStandalone(tx, id);
    assertMutable(old);
    const [updated] = await tx
      .update(schema.appointments)
      .set({ status: 'Cancelled', updatedAt: new Date() })
      .where(eq(schema.appointments.id, id))
      .returning();
    await event(tx, scope, context.userId, {
      appointmentId: id,
      eventType: 'CANCELLED',
      fromStatus: old.status,
      toStatus: 'Cancelled',
      reason: input.reason,
      scheduledTimeBefore: old.scheduledTime,
    });
    await audit(tx, scope, context.userId, 'CANCEL', 'Appointment', id, {
      fromStatus: old.status,
      toStatus: 'Cancelled',
      paymentState: 'NOT_ASSESSED',
    });
    return updated;
  });
}
export async function rescheduleAppointmentScoped(
  context: AuthorizationContext,
  id: number,
  input: AppointmentRescheduleInput,
  key: string,
) {
  const scope = await appointmentScope(context, input.facilityId);
  const scheduledTime = localTime(input.scheduledTime);
  const requestHash = hashRequest({ id, scope, scheduledTime, reason: input.reason });
  return db.transaction(async (tx) => {
    const prior = await replay(tx, scope, context.userId, 'RESCHEDULE', key, requestHash);
    if (prior) return { appointment: prior, idempotentReplay: true };
    const old = await lockedAppointment(tx, scope, id);
    await assertStandalone(tx, id);
    assertMutable(old);
    if (localTime(old.scheduledTime) === scheduledTime)
      throw new AppointmentError('UNCHANGED_TIME', 'Choose a different date or time.', 400);
    await assertPatient(tx, scope, old.patientId);
    await assertReferences(tx, scope, old);
    if (old.categoryId !== null) await activeCategory(tx, scope, old.categoryId);
    // The replacement carries snapshots, not any new category's current service or a price.
    await assertService(tx, scope, old.facilityServiceId);
    const [replacement] = await tx
      .insert(schema.appointments)
      .values({
        ...scope,
        patientId: old.patientId,
        practitionerId: old.practitionerId,
        departmentId: old.departmentId,
        categoryId: old.categoryId,
        facilityServiceId: old.facilityServiceId,
        scheduledTime,
        durationMinutes: old.durationMinutes,
        appointmentType: old.appointmentType,
        priority: old.priority,
        reason: old.reason,
        notes: old.notes,
        status: 'Scheduled',
        bookingReference: reference(),
        replacementOfId: old.id,
        createdByUserId: context.userId,
      })
      .returning();
    await tx
      .update(schema.appointments)
      .set({ status: 'Rescheduled', updatedAt: new Date() })
      .where(eq(schema.appointments.id, id));
    await event(tx, scope, context.userId, {
      appointmentId: old.id,
      eventType: 'RESCHEDULED_FROM',
      fromStatus: old.status,
      toStatus: 'Rescheduled',
      reason: input.reason,
      scheduledTimeBefore: old.scheduledTime,
      scheduledTimeAfter: scheduledTime,
      relatedAppointmentId: replacement.id,
    });
    await event(tx, scope, context.userId, {
      appointmentId: replacement.id,
      eventType: 'RESCHEDULED_TO',
      fromStatus: null,
      toStatus: 'Scheduled',
      reason: input.reason,
      scheduledTimeBefore: old.scheduledTime,
      scheduledTimeAfter: scheduledTime,
      relatedAppointmentId: old.id,
    });
    await audit(tx, scope, context.userId, 'RESCHEDULE', 'Appointment', old.id, {
      replacementId: replacement.id,
      fromStatus: old.status,
      paymentState: 'NOT_ASSESSED',
    });
    await saveRequest(tx, scope, context.userId, 'RESCHEDULE', key, requestHash, replacement.id);
    return { appointment: replacement, idempotentReplay: false };
  });
}
export async function checkInAppointmentScoped(
  context: AuthorizationContext,
  id: number,
  input: AppointmentCheckInInput,
) {
  const scope = await appointmentScope(context, input.facilityId);
  return db.transaction(async (tx) => {
    const old = await lockedAppointment(tx, scope, id);
    await assertStandalone(tx, id);
    assertMutable(old);
    await assertPatient(tx, scope, old.patientId);
    // This serializes check-ins for the same patient and station through this
    // workflow. Other legacy queue writers do not yet share this lock.
    const patientStation = `appointment-checkin:${scope.facilityId}:${old.patientId}:${input.queueType}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${patientStation}, 0))`);
    const [existing] = await tx
      .select({ id: schema.queues.id })
      .from(schema.queues)
      .where(
        and(
          eq(schema.queues.tenantId, scope.tenantId),
          eq(schema.queues.facilityId, scope.facilityId),
          eq(schema.queues.patientId, old.patientId),
          eq(schema.queues.queueType, input.queueType),
          inArray(schema.queues.status, ['Waiting', 'Called', 'In-Progress']),
        ),
      )
      .limit(1);
    if (existing)
      throw new AppointmentError(
        'ACTIVE_QUEUE_EXISTS',
        'The patient already has an active token at this station; review the queue first.',
        409,
      );
    const tokenNumber = `BK-${id}`;
    const [collision] = await tx
      .select({ id: schema.queues.id })
      .from(schema.queues)
      .where(
        and(
          eq(schema.queues.facilityId, scope.facilityId),
          eq(schema.queues.tokenNumber, tokenNumber),
        ),
      )
      .limit(1);
    if (collision)
      throw new AppointmentError(
        'QUEUE_TOKEN_CONFLICT',
        'The queue token is already in use; review the queue first.',
        409,
      );
    const [queue] = await tx
      .insert(schema.queues)
      .values({
        ...scope,
        patientId: old.patientId,
        queueType: input.queueType,
        tokenNumber,
        priority: old.priority,
        status: 'Waiting',
        waitingTimeMinutes: 0,
      })
      .returning();
    const [updated] = await tx
      .update(schema.appointments)
      .set({ status: 'Checked-in', checkinQueueId: queue.id, updatedAt: new Date() })
      .where(eq(schema.appointments.id, id))
      .returning();
    await event(tx, scope, context.userId, {
      appointmentId: id,
      eventType: 'CHECKED_IN',
      fromStatus: old.status,
      toStatus: 'Checked-in',
      queueId: queue.id,
    });
    await audit(tx, scope, context.userId, 'CHECK_IN', 'Appointment', id, {
      fromStatus: old.status,
      queueId: queue.id,
    });
    return { appointment: updated, queue };
  });
}
