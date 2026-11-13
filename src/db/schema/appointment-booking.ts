import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { appointments, queues } from './clinical.ts';
import { facilityServices } from './facility-services.ts';
import { facilities, tenants } from './tenancy.ts';

/** Facility-defined labels; mapping a service here does not create a charge. */
export const appointmentCategories = pgTable(
  'appointment_categories',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    facilityServiceId: integer('facility_service_id').references(() => facilityServices.id),
    isActive: boolean('is_active').notNull().default(true),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('appointment_categories_scope_code_idx').on(table.facilityId, table.code),
  ],
);

/** Append-only staff history. The migration enforces composite scope and immutability. */
export const appointmentEvents = pgTable(
  'appointment_events',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    facilityId: integer('facility_id').notNull(),
    appointmentId: integer('appointment_id')
      .notNull()
      .references(() => appointments.id),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    scheduledTimeBefore: text('scheduled_time_before'),
    scheduledTimeAfter: text('scheduled_time_after'),
    relatedAppointmentId: integer('related_appointment_id').references(() => appointments.id),
    queueId: integer('queue_id').references(() => queues.id),
    paymentState: text('payment_state').notNull().default('NOT_ASSESSED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('appointment_events_scope_idx').on(
      table.tenantId,
      table.facilityId,
      table.appointmentId,
      table.id,
    ),
  ],
);

/** Internal idempotency evidence, never returned in API payloads. */
export const appointmentRequests = pgTable(
  'appointment_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    facilityId: integer('facility_id').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id),
    operation: text('operation').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    resultAppointmentId: integer('result_appointment_id')
      .notNull()
      .references(() => appointments.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('appointment_requests_scope_key_idx').on(
      table.tenantId,
      table.facilityId,
      table.actorUserId,
      table.operation,
      table.requestKey,
    ),
  ],
);
