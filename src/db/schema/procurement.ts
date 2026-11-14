/**
 * JaliCare HMIS — procurement workflow schema (migration 0076).
 *
 * The supplier register, purchase orders and supplier invoices predate this
 * module. This file adds the three gaps in the Phase 5 chain
 * requisite → purchase order → goods received note → invoice → payment:
 *
 *   1. departmental requisitions with an approval trail,
 *   2. goods received notes that record what actually arrived, and
 *   3. the link from a note to the invoice it evidences.
 *
 * Every row is tenant- and facility-owned. The services resolve the facility
 * from the authenticated request; a browser-supplied id is only a hint.
 */

import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import {
  inventoryBatches,
  inventoryItems,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from './inventory.ts';
import { facilities, tenants } from './tenancy.ts';

export const procurementRequisitions = pgTable(
  'procurement_requisitions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    requisitionNumber: text('requisition_number').notNull(),
    requestDate: date('request_date').notNull(),
    neededBy: date('needed_by'),
    department: text('department'),
    justification: text('justification').notNull(),
    status: text('status').default('DRAFT').notNull(),
    estimatedTotalKes: numeric('estimated_total_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id),
    requestedByName: text('requested_by_name').notNull(),
    decidedByUserId: integer('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    purchaseOrderId: integer('purchase_order_id').references(() => purchaseOrders.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    numberIdx: uniqueIndex('procurement_requisitions_facility_number_idx').on(
      table.facilityId,
      table.requisitionNumber,
    ),
    statusIdx: index('procurement_requisitions_facility_status_idx').on(
      table.facilityId,
      table.status,
    ),
  }),
);

export const procurementRequisitionItems = pgTable(
  'procurement_requisition_items',
  {
    id: serial('id').primaryKey(),
    requisitionId: integer('requisition_id')
      .references(() => procurementRequisitions.id, { onDelete: 'cascade' })
      .notNull(),
    lineNumber: integer('line_number').notNull(),
    inventoryItemId: integer('inventory_item_id').references(() => inventoryItems.id),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    estimatedUnitPrice: numeric('estimated_unit_price', { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
  },
  (table) => ({
    requisitionIdx: index('procurement_requisition_items_requisition_idx').on(table.requisitionId),
  }),
);

export const procurementRequisitionEvents = pgTable(
  'procurement_requisition_events',
  {
    id: serial('id').primaryKey(),
    requisitionId: integer('requisition_id')
      .references(() => procurementRequisitions.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorUserId: integer('actor_user_id').references(() => users.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    requisitionIdx: index('procurement_requisition_events_requisition_idx').on(table.requisitionId),
  }),
);

export const goodsReceivedNotes = pgTable(
  'goods_received_notes',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    grnNumber: text('grn_number').notNull(),
    purchaseOrderId: integer('purchase_order_id')
      .references(() => purchaseOrders.id)
      .notNull(),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    receivedDate: date('received_date').notNull(),
    receivedByUserId: integer('received_by_user_id').references(() => users.id),
    receivedByName: text('received_by_name').notNull(),
    status: text('status').default('POSTED').notNull(),
    inventoryValueKes: numeric('inventory_value_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    numberIdx: uniqueIndex('goods_received_notes_facility_number_idx').on(
      table.facilityId,
      table.grnNumber,
    ),
    orderIdx: index('goods_received_notes_order_idx').on(table.purchaseOrderId),
  }),
);

export const goodsReceivedNoteItems = pgTable(
  'goods_received_note_items',
  {
    id: serial('id').primaryKey(),
    goodsReceivedNoteId: integer('goods_received_note_id')
      .references(() => goodsReceivedNotes.id, { onDelete: 'cascade' })
      .notNull(),
    purchaseOrderItemId: integer('purchase_order_item_id')
      .references(() => purchaseOrderItems.id)
      .notNull(),
    inventoryItemId: integer('inventory_item_id').references(() => inventoryItems.id),
    description: text('description').notNull(),
    quantityReceived: numeric('quantity_received', { precision: 12, scale: 3 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
    batchNumber: text('batch_number'),
    expiryDate: date('expiry_date'),
    inventoryBatchId: integer('inventory_batch_id').references(() => inventoryBatches.id),
  },
  (table) => ({
    noteIdx: index('goods_received_note_items_note_idx').on(table.goodsReceivedNoteId),
  }),
);
