import { sql } from 'drizzle-orm';
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
import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';
import { patients, practitioners } from './patients.ts';
import { encounters } from './clinical.ts';
import { admissions, theatreCases } from './inpatient.ts';

/** Complementary scheduling metadata. The original theatre case stays authoritative. */
export const theatreRooms = pgTable(
  'theatre_rooms',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    name: text('name').notNull(),
    state: text('state').notNull().default('OPEN'),
    createdBy: integer('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('theatre_rooms_facility_name_uq').on(t.facilityId, sql`lower(${t.name})`)],
);

export const theatreBookings = pgTable(
  'theatre_bookings',
  {
    caseId: integer('case_id')
      .primaryKey()
      .references(() => theatreCases.id),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    roomId: integer('room_id')
      .references(() => theatreRooms.id)
      .notNull(),
    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),
    leadPractitionerId: integer('lead_practitioner_id')
      .references(() => practitioners.id)
      .notNull(),
    encounterId: integer('encounter_id').references(() => encounters.id),
    admissionId: integer('admission_id').references(() => admissions.id),
    urgency: text('urgency').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reserved: boolean('reserved').notNull().default(true),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    revision: integer('revision').notNull().default(1),
    createdBy: integer('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('theatre_bookings_facility_request_uq').on(t.facilityId, t.requestKey),
    index('theatre_bookings_facility_start_idx').on(t.facilityId, t.startsAt),
  ],
);

/** Append-only scheduling history, separate from the general non-clinical audit log. */
export const theatreScheduleEvents = pgTable(
  'theatre_schedule_events',
  {
    id: serial('id').primaryKey(),
    caseId: integer('case_id')
      .references(() => theatreCases.id)
      .notNull(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    action: text('action').notNull(),
    reason: text('reason'),
    previousRoomId: integer('previous_room_id').references(() => theatreRooms.id),
    previousStartsAt: timestamp('previous_starts_at', { withTimezone: true }),
    previousEndsAt: timestamp('previous_ends_at', { withTimezone: true }),
    newRoomId: integer('new_room_id').references(() => theatreRooms.id),
    newStartsAt: timestamp('new_starts_at', { withTimezone: true }),
    newEndsAt: timestamp('new_ends_at', { withTimezone: true }),
    actorId: integer('actor_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('theatre_schedule_events_case_idx').on(t.caseId, t.id)],
);

/** Append-only attestations about historical reservations; never clinical clearance. */
export const theatreLegacyReviewEvents = pgTable(
  'theatre_legacy_review_events',
  {
    id: serial('id').primaryKey(),
    caseId: integer('case_id')
      .references(() => theatreCases.id)
      .notNull(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    actorId: integer('actor_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('theatre_legacy_review_events_case_idx').on(t.caseId, t.id)],
);
