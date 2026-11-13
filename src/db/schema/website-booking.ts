/**
 * JaliCare HMIS — website booking schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { appointments } from './clinical.ts';
import { dialysisSchedules } from './dialysis.ts';
import { patients } from './patients.ts';
import { departments, facilities, tenants } from './tenancy.ts';

export const websiteBookingClients = pgTable(
  'website_booking_clients',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    clientName: text('client_name').notNull(),
    apiKeyPrefix: text('api_key_prefix').notNull(),
    apiKeyHash: text('api_key_hash').notNull(),
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().default([]).notNull(),
    allowedServices: jsonb('allowed_services').$type<string[]>().default([]).notNull(),
    slotDurationMinutes: integer('slot_duration_minutes').default(0).notNull(),
    dailyCapacityPerService: integer('daily_capacity_per_service').default(0).notNull(),
    operatingHours: jsonb('operating_hours').$type<Record<string, unknown>>().default({}).notNull(),
    rateLimitPerMinute: integer('rate_limit_per_minute').default(30).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastUsedAt: timestamp('last_used_at'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    hashIdx: uniqueIndex('website_booking_clients_hash_idx').on(table.apiKeyHash),
  }),
);

export const websiteBookingSlots = pgTable('website_booking_slots', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),
  serviceCode: text('service_code').notNull(),
  slotDate: date('slot_date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  capacity: integer('capacity').notNull(),
  status: text('status').default('OPEN').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const externalBookings = pgTable(
  'external_bookings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    bookingReference: text('booking_reference').notNull(),
    bookingClientId: integer('booking_client_id')
      .references(() => websiteBookingClients.id)
      .notNull(),
    slotId: integer('slot_id')
      .references(() => websiteBookingSlots.id)
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    duplicateHash: text('duplicate_hash').notNull(),
    serviceCode: text('service_code').notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    requestedDate: text('requested_date').notNull(),
    slotStartTime: text('slot_start_time').notNull(),
    slotEndTime: text('slot_end_time').notNull(),
    status: text('status').default('PENDING').notNull(),
    patientId: integer('patient_id').references(() => patients.id),
    patientFullName: text('patient_full_name').notNull(),
    patientPhoneEncrypted: text('patient_phone_encrypted').notNull(),
    patientPhoneHash: text('patient_phone_hash').notNull(),
    patientEmail: text('patient_email'),
    visitReason: text('visit_reason'),
    linkedAppointmentId: integer('linked_appointment_id').references(() => appointments.id),
    linkedDialysisScheduleId: integer('linked_dialysis_schedule_id').references(
      () => dialysisSchedules.id,
    ),
    cancellationReason: text('cancellation_reason'),
    rescheduleCount: integer('reschedule_count').default(0).notNull(),
    notificationLog: jsonb('notification_log')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    sourceChannel: text('source_channel').default('WEBSITE_API').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    refIdx: uniqueIndex('external_bookings_ref_idx').on(table.bookingReference),
    facilityIdempIdx: uniqueIndex('external_bookings_facility_idemp_idx').on(
      table.bookingClientId,
      table.idempotencyKey,
    ),
  }),
);

export const websiteBookingEvents = pgTable('website_booking_events', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id')
    .references(() => externalBookings.id)
    .notNull(),
  clientId: integer('client_id').references(() => websiteBookingClients.id),
  actorUserId: integer('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  previousSlotId: integer('previous_slot_id').references(() => websiteBookingSlots.id),
  newSlotId: integer('new_slot_id').references(() => websiteBookingSlots.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const websiteBookingMutations = pgTable('website_booking_mutations', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id')
    .references(() => websiteBookingClients.id)
    .notNull(),
  bookingId: integer('booking_id')
    .references(() => externalBookings.id)
    .notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
