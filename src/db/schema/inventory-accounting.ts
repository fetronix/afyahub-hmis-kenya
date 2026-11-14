/**
 * Facility inventory accounting policy, lot-cost allocations and movement links.
 *
 * Added by Phase 3 Batch B (migration 0079). A facility with no ACTIVE policy
 * row is on the `EXPENSE_ON_PURCHASE` basis and posts nothing new, so the
 * presence of these tables changes no existing behaviour.
 */
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { chartOfAccounts, journalEntries } from './financial-ledger.ts';
import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';
import { inventoryBatches } from './inventory.ts';
import { inventoryMovements } from './inventory-control.ts';

export const facilityInventoryAccounting = pgTable(
  'facility_inventory_accounting',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    version: integer('version').notNull().default(1),
    /** DRAFT is configurable; ACTIVE is in force; SUPERSEDED is history. */
    status: text('status').notNull().default('DRAFT'),
    basis: text('basis').notNull(),

    openingBalanceAccountId: integer('opening_balance_account_id').references(
      () => chartOfAccounts.id,
    ),
    openingJournalId: integer('opening_journal_id').references(() => journalEntries.id),
    openingValueCents: bigint('opening_value_cents', { mode: 'number' }).notNull().default(0),

    stockAssetAccountId: integer('stock_asset_account_id').references(() => chartOfAccounts.id),
    clearingAccountId: integer('clearing_account_id').references(() => chartOfAccounts.id),
    consumptionAccountId: integer('consumption_account_id').references(() => chartOfAccounts.id),
    adjustmentAccountId: integer('adjustment_account_id').references(() => chartOfAccounts.id),
    writeOffAccountId: integer('write_off_account_id').references(() => chartOfAccounts.id),

    inputVatAccountId: integer('input_vat_account_id').references(() => chartOfAccounts.id),
    nonRecoverableTaxAccountId: integer('non_recoverable_tax_account_id').references(
      () => chartOfAccounts.id,
    ),

    effectiveFrom: date('effective_from'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedByUserId: integer('activated_by_user_id').references(() => users.id),
    financeApprovedByUserId: integer('finance_approved_by_user_id').references(() => users.id),
    approvalNote: text('approval_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_inventory_accounting_version_key').on(table.facilityId, table.version),
    index('facility_inventory_accounting_tenant_idx').on(table.tenantId, table.facilityId),
  ],
);

/**
 * Which lots a stock movement actually consumed, and at what cost.
 *
 * `inventory_movements` records a quantity delta but not its value. Dispensing
 * already preserved its lots in `pharmacy_dispense_allocations`; adjustments,
 * count variances and write-offs did not, which made their cost unrecoverable
 * after the fact. This table closes that gap for every movement type.
 */
export const inventoryMovementAllocations = pgTable(
  'inventory_movement_allocations',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    movementId: integer('movement_id')
      .notNull()
      .references(() => inventoryMovements.id),
    batchId: integer('batch_id')
      .notNull()
      .references(() => inventoryBatches.id),
    quantity: integer('quantity').notNull(),
    unitCostCents: bigint('unit_cost_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_movement_allocations_once').on(table.movementId, table.batchId),
    index('inventory_movement_allocations_batch_idx').on(table.batchId),
  ],
);

/** The journal a stock movement produced, so reconciliation can prove coverage. */
export const inventoryMovementJournals = pgTable(
  'inventory_movement_journals',
  {
    movementId: integer('movement_id')
      .primaryKey()
      .references(() => inventoryMovements.id),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    journalEntryId: integer('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('inventory_movement_journals_journal_idx').on(table.journalEntryId)],
);
