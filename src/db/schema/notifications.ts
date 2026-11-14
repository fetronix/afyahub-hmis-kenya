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

/** Current alert episode per real source. It never modifies the underlying stock or clinical record. */
export const notificationAlertStates = pgTable(
  'notification_alert_states',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    sourceKey: text('source_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    revision: integer('revision').notNull().default(1),
    active: boolean('active').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_alert_states_scope_key').on(t.tenantId, t.facilityId, t.sourceKey),
    index('notification_alert_states_active_idx').on(t.tenantId, t.facilityId, t.active),
  ],
);

/** Read state belongs to one authenticated user in one facility; no patient data is persisted here. */
export const notificationReadReceipts = pgTable(
  'notification_read_receipts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    notificationKey: text('notification_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_read_receipts_user_key').on(
      t.tenantId,
      t.facilityId,
      t.userId,
      t.notificationKey,
    ),
    index('notification_read_receipts_lookup_idx').on(t.tenantId, t.facilityId, t.userId),
  ],
);
