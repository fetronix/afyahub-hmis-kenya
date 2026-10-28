/**
 * JaliCare HMIS
 * Schema: Inventory items and batches, dispensing, suppliers, purchase orders
 *
 * Extracted from `../schema.ts`, which re-exports every table defined here so
 * that `import * as schema from '../schema.ts'` and drizzle.config.ts keep
 * working untouched. Tables are grouped by the domain that owns them; the
 * relations that join two domains stay in the barrel, because a relation is a
 * statement about both and belongs to neither.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  numeric,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { facilities, tenants } from './tenancy.ts';

import { patients } from './patients.ts';

import { medications } from './inpatient.ts';

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    itemCode: text('item_code').notNull(),

    name: text('name').notNull(),

    genericName: text('generic_name'),

    category: text('category').default('Pharmaceuticals'),

    unit: text('unit').default('Tablets'),

    strength: text('strength'),

    dosageForm: text('dosage_form'),

    currentStock: integer('current_stock').default(0),

    reorderLevel: integer('reorder_level').default(50),

    unitCost: numeric('unit_cost', {
      precision: 10,
      scale: 2,
    }).default('0'),

    sellingPrice: numeric('selling_price', {
      precision: 10,
      scale: 2,
    }).default('0'),

    storeLocation: text('store_location').default('Main Pharmacy Store'),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityItemCodeIdx: uniqueIndex('inventory_items_facility_code_idx').on(
      table.facilityId,
      table.itemCode,
    ),
  }),
);

/* ============================================================
   35. INVENTORY BATCHES
   ============================================================ */

export const inventoryBatches = pgTable(
  'inventory_batches',
  {
    id: serial('id').primaryKey(),

    itemId: integer('item_id')
      .references(() => inventoryItems.id)
      .notNull(),

    batchNumber: text('batch_number').notNull(),

    expiryDate: text('expiry_date').notNull(),

    quantityRemaining: integer('quantity_remaining').notNull(),

    costPerUnit: numeric('cost_per_unit', {
      precision: 10,
      scale: 2,
    }).default('0'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    itemBatchIdx: uniqueIndex('inventory_batches_item_batch_idx').on(
      table.itemId,
      table.batchNumber,
    ),
  }),
);

/* ============================================================
   36. PHARMACY DISPENSATIONS
   ============================================================ */

export const pharmacyDispensations = pgTable('pharmacy_dispensations', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  prescriptionId: integer('prescription_id').references(() => medications.id),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  itemId: integer('item_id').references(() => inventoryItems.id),

  batchNumber: text('batch_number'),

  quantityDispensed: integer('quantity_dispensed').notNull(),

  dispensedBy: text('dispensed_by').notNull(),

  dispensedAt: timestamp('dispensed_at').defaultNow().notNull(),

  notes: text('notes'),
});

/* ============================================================
   37. SUPPLIERS
   ============================================================ */

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),

  name: text('name').notNull(),

  contactPerson: text('contact_person'),

  phone: text('phone'),

  email: text('email'),

  kraPin: text('kra_pin'),

  address: text('address'),

  isActive: boolean('is_active').default(true),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   38. PURCHASE ORDERS
   ============================================================ */

export const purchaseOrders = pgTable('purchase_orders', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  supplierId: integer('supplier_id')
    .references(() => suppliers.id)
    .notNull(),

  poNumber: text('po_number').notNull().unique(),

  totalAmount: numeric('total_amount', {
    precision: 12,
    scale: 2,
  }).default('0'),

  status: text('status').default('Pending Approval'),

  orderedBy: text('ordered_by'),

  approvedBy: text('approved_by'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
