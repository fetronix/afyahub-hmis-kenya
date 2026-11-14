/**
 * JaliCare HMIS — stock control schema (migration 0077).
 *
 * `inventory_items` and `inventory_batches` keep the running quantity and the
 * batch lots. This file adds the append-only evidence around them:
 *
 *  - `inventory_movements` explains every change to stock on hand,
 *  - `inventory_stock_counts` records a physical count and its variance, and
 *  - `inventory_transfers` records stock moving between store locations.
 *
 * Movements are never updated or deleted; a correction is another movement.
 */

import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { inventoryBatches, inventoryItems } from './inventory.ts';
import { facilities, tenants } from './tenancy.ts';

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    itemId: integer('item_id')
      .references(() => inventoryItems.id)
      .notNull(),
    batchId: integer('batch_id').references(() => inventoryBatches.id),
    movementType: text('movement_type').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    stockAfter: integer('stock_after').notNull(),
    reasonCode: text('reason_code'),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    storeFrom: text('store_from'),
    storeTo: text('store_to'),
    notes: text('notes'),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorName: text('actor_name').notNull(),
    movementDate: date('movement_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    facilityItemIdx: index('inventory_movements_facility_item_idx').on(
      table.facilityId,
      table.itemId,
      table.id,
    ),
    facilityDateIdx: index('inventory_movements_facility_date_idx').on(
      table.facilityId,
      table.movementDate,
    ),
  }),
);

export const inventoryStockCounts = pgTable(
  'inventory_stock_counts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    countNumber: text('count_number').notNull(),
    countDate: date('count_date').notNull(),
    storeLocation: text('store_location'),
    status: text('status').default('OPEN').notNull(),
    notes: text('notes'),
    countedByUserId: integer('counted_by_user_id').references(() => users.id),
    countedByName: text('counted_by_name').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedByUserId: integer('posted_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    numberIdx: uniqueIndex('inventory_stock_counts_facility_number_idx').on(
      table.facilityId,
      table.countNumber,
    ),
  }),
);

export const inventoryStockCountLines = pgTable(
  'inventory_stock_count_lines',
  {
    id: serial('id').primaryKey(),
    countId: integer('count_id')
      .references(() => inventoryStockCounts.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: integer('item_id')
      .references(() => inventoryItems.id)
      .notNull(),
    expectedQuantity: integer('expected_quantity').notNull(),
    countedQuantity: integer('counted_quantity'),
    varianceQuantity: integer('variance_quantity'),
    notes: text('notes'),
  },
  (table) => ({
    countItemIdx: uniqueIndex('inventory_stock_count_lines_item_idx').on(
      table.countId,
      table.itemId,
    ),
  }),
);

export const inventoryTransfers = pgTable(
  'inventory_transfers',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    transferNumber: text('transfer_number').notNull(),
    transferDate: date('transfer_date').notNull(),
    storeFrom: text('store_from').notNull(),
    storeTo: text('store_to').notNull(),
    status: text('status').default('POSTED').notNull(),
    notes: text('notes'),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorName: text('actor_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    numberIdx: uniqueIndex('inventory_transfers_facility_number_idx').on(
      table.facilityId,
      table.transferNumber,
    ),
  }),
);

export const inventoryTransferItems = pgTable(
  'inventory_transfer_items',
  {
    id: serial('id').primaryKey(),
    transferId: integer('transfer_id')
      .references(() => inventoryTransfers.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: integer('item_id')
      .references(() => inventoryItems.id)
      .notNull(),
    batchId: integer('batch_id').references(() => inventoryBatches.id),
    quantity: integer('quantity').notNull(),
  },
  (table) => ({
    transferIdx: index('inventory_transfer_items_transfer_idx').on(table.transferId),
  }),
);
