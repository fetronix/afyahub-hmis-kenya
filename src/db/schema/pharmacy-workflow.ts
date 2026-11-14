import {
  check,
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, facilities } from './tenancy.ts';
import { users } from './auth.ts';
import { inventoryBatches, pharmacyDispensations } from './inventory.ts';
import { medications } from './inpatient.ts';

/** New requests only; historical dispensations are not backfilled. */
export const pharmacyDispenseRequests = pgTable(
  'pharmacy_dispense_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    dispensationId: integer('dispensation_id')
      .notNull()
      .references(() => pharmacyDispensations.id),
    stockTracking: text('stock_tracking').notNull(),
    stockAfter: integer('stock_after'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    dispensation: uniqueIndex('pharmacy_dispense_requests_dispensation_idx').on(t.dispensationId),
    key: uniqueIndex('pharmacy_dispense_requests_facility_key_idx').on(
      t.facilityId,
      t.idempotencyKey,
    ),
    tracking: check(
      'pharmacy_dispense_requests_stock_tracking_check',
      sql`${t.stockTracking} IN ('FEFO', 'untracked')`,
    ),
  }),
);

export const pharmacyDispenseAllocations = pgTable(
  'pharmacy_dispense_allocations',
  {
    id: serial('id').primaryKey(),
    dispensationId: integer('dispensation_id')
      .notNull()
      .references(() => pharmacyDispensations.id),
    batchId: integer('batch_id')
      .notNull()
      .references(() => inventoryBatches.id),
    batchNumber: text('batch_number').notNull(),
    expiryDate: date('expiry_date').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => ({
    batch: uniqueIndex('pharmacy_dispense_allocations_batch_idx').on(t.dispensationId, t.batchId),
    positive: check('pharmacy_dispense_allocations_quantity_check', sql`${t.quantity} > 0`),
  }),
);

export const medicationStatusEvents = pgTable('medication_status_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  facilityId: integer('facility_id')
    .notNull()
    .references(() => facilities.id),
  medicationId: integer('medication_id')
    .notNull()
    .references(() => medications.id),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  reason: text('reason').notNull(),
  actorUserId: integer('actor_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
