/**
 * Three-way matching, supplier returns and supplier credit notes.
 *
 * Added by Phase 5 Batch E (migration 0080). Nothing here changes an existing
 * posting: these tables record a verdict (did the invoice agree with the order
 * and the receipt?), and give stock and money a way back to the supplier.
 */
import { bigint, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { suppliers } from './inventory.ts';
import { inventoryBatches, inventoryItems, purchaseOrders } from './inventory.ts';
import { goodsReceivedNoteItems, goodsReceivedNotes } from './procurement.ts';
import { supplierInvoices } from './financial-ledger.ts';
import { inventoryMovements } from './inventory-control.ts';
import { journalEntries } from './financial-ledger.ts';
import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';

/**
 * The recorded outcome of comparing order, receipt and invoice.
 *
 * One row per invoice, because a payment decision is made against a specific
 * verdict and a re-check must not be able to erase the evidence afterwards.
 */
export const supplierInvoiceMatches = pgTable(
  'supplier_invoice_matches',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    supplierInvoiceId: integer('supplier_invoice_id')
      .notNull()
      .references(() => supplierInvoices.id),
    goodsReceivedNoteId: integer('goods_received_note_id')
      .notNull()
      .references(() => goodsReceivedNotes.id),
    purchaseOrderId: integer('purchase_order_id').references(() => purchaseOrders.id),

    /** MATCHED, VARIANCE or OVERRIDDEN (a named user accepted the difference). */
    status: text('status').notNull(),
    orderedCents: bigint('ordered_cents', { mode: 'number' }).notNull().default(0),
    receivedCents: bigint('received_cents', { mode: 'number' }).notNull().default(0),
    invoicedCents: bigint('invoiced_cents', { mode: 'number' }).notNull().default(0),
    priceVarianceCents: bigint('price_variance_cents', { mode: 'number' }).notNull().default(0),
    amountVarianceCents: bigint('amount_variance_cents', { mode: 'number' }).notNull().default(0),
    toleranceCents: bigint('tolerance_cents', { mode: 'number' }).notNull().default(0),

    findings: jsonb('findings').notNull().default([]),

    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    checkedByUserId: integer('checked_by_user_id').references(() => users.id),
    overrideReason: text('override_reason'),
    overriddenByUserId: integer('overridden_by_user_id').references(() => users.id),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('supplier_invoice_matches_invoice_once_idx').on(table.supplierInvoiceId),
    index('supplier_invoice_matches_facility_idx').on(table.facilityId, table.status),
  ],
);

/** Stock going back to the supplier, traced to the receipt line it came from. */
export const supplierReturns = pgTable(
  'supplier_returns',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    goodsReceivedNoteId: integer('goods_received_note_id')
      .notNull()
      .references(() => goodsReceivedNotes.id),
    returnNumber: text('return_number').notNull(),
    returnDate: date('return_date').notNull(),
    status: text('status').notNull().default('POSTED'),
    reasonCode: text('reason_code').notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    /** CLEARING before invoicing, PAYABLE after, NONE on the expense basis. */
    counterpart: text('counterpart').notNull(),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_returns_number_once_idx').on(table.facilityId, table.returnNumber),
    uniqueIndex('supplier_returns_idempotency_once_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  ],
);

export const supplierReturnItems = pgTable(
  'supplier_return_items',
  {
    id: serial('id').primaryKey(),
    returnId: integer('return_id')
      .notNull()
      .references(() => supplierReturns.id),
    goodsReceivedNoteItemId: integer('goods_received_note_item_id')
      .notNull()
      .references(() => goodsReceivedNoteItems.id),
    inventoryItemId: integer('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id),
    inventoryBatchId: integer('inventory_batch_id').references(() => inventoryBatches.id),
    quantity: integer('quantity').notNull(),
    unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull(),
    lineTotalCents: bigint('line_total_cents', { mode: 'number' }).notNull(),
    inventoryMovementId: integer('inventory_movement_id').references(() => inventoryMovements.id),
  },
  (table) => [
    uniqueIndex('supplier_return_items_line_once_idx').on(
      table.returnId,
      table.goodsReceivedNoteItemId,
    ),
  ],
);

/** The supplier's credit: money the facility no longer owes. */
export const supplierCreditNotes = pgTable(
  'supplier_credit_notes',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    supplierInvoiceId: integer('supplier_invoice_id').references(() => supplierInvoices.id),
    supplierReturnId: integer('supplier_return_id').references(() => supplierReturns.id),
    creditNoteNumber: text('credit_note_number').notNull(),
    creditNoteDate: date('credit_note_date').notNull(),
    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull(),
    taxCents: bigint('tax_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    appliedCents: bigint('applied_cents', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('OPEN'),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_credit_notes_number_once_idx').on(
      table.facilityId,
      table.creditNoteNumber,
    ),
    uniqueIndex('supplier_credit_notes_idempotency_once_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  ],
);

export const supplierCreditNoteItems = pgTable(
  'supplier_credit_note_items',
  {
    id: serial('id').primaryKey(),
    creditNoteId: integer('credit_note_id')
      .notNull()
      .references(() => supplierCreditNotes.id),
    description: text('description').notNull(),
    quantity: integer('quantity'),
    unitCostCents: bigint('unit_cost_cents', { mode: 'number' }),
    lineTotalCents: bigint('line_total_cents', { mode: 'number' }).notNull(),
  },
  (table) => [index('supplier_credit_note_items_note_idx').on(table.creditNoteId)],
);
