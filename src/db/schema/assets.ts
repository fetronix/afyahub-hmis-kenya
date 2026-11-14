/**
 * JaliCare HMIS — fixed-asset schema.
 *
 * `fixed_assets` and `fixed_asset_movements` predate this module and live in
 * financial-ledger.ts. This file adds the operational tables introduced by
 * migration 0075: category defaults, maintenance history and transfers.
 *
 * Every row is tenant- and facility-owned; the service never trusts a
 * browser-supplied facility id without a membership check.
 */

import {
  boolean,
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
import { departments, facilities, tenants } from './tenancy.ts';
import { chartOfAccounts, fixedAssets, journalEntries } from './financial-ledger.ts';
import { hrEmployees } from './workforce.ts';

export const fixedAssetCategories = pgTable(
  'fixed_asset_categories',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    defaultUsefulLifeMonths: integer('default_useful_life_months').notNull(),
    assetAccountId: integer('asset_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    accumDepAccountId: integer('accum_dep_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    depExpenseAccountId: integer('dep_expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('fixed_asset_categories_facility_code_idx').on(
      table.facilityId,
      table.code,
    ),
  }),
);

export const fixedAssetMaintenance = pgTable(
  'fixed_asset_maintenance',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    assetId: integer('asset_id')
      .references(() => fixedAssets.id)
      .notNull(),
    maintenanceDate: text('maintenance_date').notNull(),
    maintenanceType: text('maintenance_type').notNull(),
    vendor: text('vendor'),
    description: text('description').notNull(),
    costKes: numeric('cost_kes', { precision: 14, scale: 2 }).default('0.00').notNull(),
    status: text('status').default('PLANNED').notNull(),
    completedDate: text('completed_date'),
    expenseAccountId: integer('expense_account_id').references(() => chartOfAccounts.id),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: index('fixed_asset_maintenance_facility_idx').on(
      table.facilityId,
      table.status,
      table.maintenanceDate,
    ),
    assetIdx: index('fixed_asset_maintenance_asset_idx').on(table.assetId, table.maintenanceDate),
  }),
);

export const fixedAssetTransfers = pgTable(
  'fixed_asset_transfers',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    assetId: integer('asset_id')
      .references(() => fixedAssets.id)
      .notNull(),
    transferDate: text('transfer_date').notNull(),
    fromDepartmentId: integer('from_department_id').references(() => departments.id),
    toDepartmentId: integer('to_department_id').references(() => departments.id),
    fromEmployeeId: integer('from_employee_id').references(() => hrEmployees.id),
    toEmployeeId: integer('to_employee_id').references(() => hrEmployees.id),
    fromLocation: text('from_location'),
    toLocation: text('to_location'),
    reason: text('reason').notNull(),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    assetIdx: index('fixed_asset_transfers_asset_idx').on(table.assetId, table.transferDate),
    facilityIdx: index('fixed_asset_transfers_facility_idx').on(
      table.facilityId,
      table.transferDate,
    ),
  }),
);

/**
 * Tax depreciation rates, as configured by the facility.
 *
 * Deliberately contains no Kenyan rates. A rate is a fact about a tax regime at
 * a point in time, and encoding one here would silently apply it to every
 * facility forever. Each row carries `authorityReference` — the notice or
 * practice note the rate came from — so an auditor can trace it, and the
 * service refuses to compute a tax allowance when no row covers the asset.
 */
export const fixedAssetTaxRates = pgTable(
  'fixed_asset_tax_rates',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    /* Null applies the rate to every category that has no more specific row. */
    categoryId: integer('category_id').references(() => fixedAssetCategories.id),
    name: text('name').notNull(),
    method: text('method').notNull(),
    annualRateBps: integer('annual_rate_bps').notNull(),
    authorityReference: text('authority_reference').notNull(),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    isActive: boolean('is_active').default(true).notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    scopeIdx: index('fixed_asset_tax_rates_lookup_idx').on(
      table.tenantId,
      table.facilityId,
      table.isActive,
    ),
  }),
);
