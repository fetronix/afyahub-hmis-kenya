/**
 * Syrona Medical Center HMIS — fixed-asset schema.
 *
 * `fixed_assets` and `fixed_asset_movements` predate this module and live in
 * financial-ledger.ts. Migration 0075 added category defaults, maintenance
 * history and transfers; migration 0103 added the facility depreciation
 * policy, the depreciation batch that an approver signs, preventive schedules,
 * inspections, lifecycle events and supporting documents.
 *
 * Every row is tenant- and facility-owned; the service never trusts a
 * browser-supplied facility id without a membership check.
 */

import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
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
import { suppliers } from './inventory.ts';
import { hrEmployees } from './workforce.ts';

/**
 * `bytea` has no first-class Drizzle type; documents are written and read as
 * Buffers, so a small custom type keeps the column honest without a cast at
 * every call site.
 */
export const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

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
    /* Added by 0103: the corrective-maintenance detail an auditor asks for. */
    scheduleId: integer('schedule_id').references(() => fixedAssetMaintenanceSchedules.id),
    priority: text('priority'),
    reportedDate: text('reported_date'),
    problemDescription: text('problem_description'),
    assignedTechnician: text('assigned_technician'),
    repairActions: text('repair_actions'),
    partsUsed: text('parts_used'),
    downtimeHours: numeric('downtime_hours', { precision: 8, scale: 2 }),
    verifiedAt: timestamp('verified_at'),
    verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
    verificationNotes: text('verification_notes'),
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

/* ============================================================
   DEPRECIATION POLICY, BATCHES, SCHEDULES, INSPECTIONS
   (migration 0103)
   ============================================================ */

/**
 * One row per facility. The convention lives here rather than in code because
 * "does the month of acquisition count?" is a policy decision an accountant
 * signs off, not a constant a developer picks.
 */
export const fixedAssetSettings = pgTable(
  'fixed_asset_settings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    defaultUsefulLifeMonths: integer('default_useful_life_months').default(120).notNull(),
    defaultAnnualRateBps: integer('default_annual_rate_bps').default(1000).notNull(),
    depreciationCommencement: text('depreciation_commencement').default('FULL_MONTH').notNull(),
    depreciationApprovalRequired: boolean('depreciation_approval_required').default(true).notNull(),
    financialYearStartMonth: integer('financial_year_start_month').default(7).notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityUnique: uniqueIndex('fixed_asset_settings_facility_unique').on(table.facilityId),
  }),
);

/**
 * A depreciation batch is the unit an accountant reviews and signs: the
 * charges are frozen in `fixed_asset_depreciation_batch_items` at review time
 * and posted from there, so approval and posting cannot disagree.
 */
export const fixedAssetDepreciationBatches = pgTable(
  'fixed_asset_depreciation_batches',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    periodCode: text('period_code').notNull(),
    entryDate: text('entry_date').notNull(),
    status: text('status').default('DRAFT').notNull(),
    totalCents: numeric('total_cents', { precision: 18, scale: 0 }).default('0').notNull(),
    assetCount: integer('asset_count').default(0).notNull(),
    preparedByUserId: integer('prepared_by_user_id').references(() => users.id),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    postedAt: timestamp('posted_at'),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    reversedAt: timestamp('reversed_at'),
    reversedByUserId: integer('reversed_by_user_id').references(() => users.id),
    reversalJournalEntryId: integer('reversal_journal_entry_id').references(
      () => journalEntries.id,
    ),
    reversalReason: text('reversal_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityPeriodIdx: index('fixed_asset_batches_facility_idx').on(
      table.facilityId,
      table.periodCode,
    ),
  }),
);

export const fixedAssetDepreciationBatchItems = pgTable(
  'fixed_asset_depreciation_batch_items',
  {
    id: serial('id').primaryKey(),
    batchId: integer('batch_id')
      .references(() => fixedAssetDepreciationBatches.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    assetId: integer('asset_id')
      .references(() => fixedAssets.id)
      .notNull(),
    assetCode: text('asset_code').notNull(),
    assetName: text('asset_name').notNull(),
    category: text('category').notNull(),
    departmentId: integer('department_id'),
    basisCents: numeric('basis_cents', { precision: 18, scale: 0 }).notNull(),
    salvageCents: numeric('salvage_cents', { precision: 18, scale: 0 }).notNull(),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    annualRateBps: integer('annual_rate_bps').notNull(),
    commencement: text('commencement').notNull(),
    openingAccumulatedCents: numeric('opening_accumulated_cents', {
      precision: 18,
      scale: 0,
    }).notNull(),
    chargeCents: numeric('charge_cents', { precision: 18, scale: 0 }).notNull(),
    closingAccumulatedCents: numeric('closing_accumulated_cents', {
      precision: 18,
      scale: 0,
    }).notNull(),
    openingNbvCents: numeric('opening_nbv_cents', { precision: 18, scale: 0 }).notNull(),
    closingNbvCents: numeric('closing_nbv_cents', { precision: 18, scale: 0 }).notNull(),
    daysInService: integer('days_in_service').default(0).notNull(),
    periodDays: integer('period_days').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    batchAssetUnique: uniqueIndex('fixed_asset_batch_items_unique').on(
      table.batchId,
      table.assetId,
    ),
    assetIdx: index('fixed_asset_batch_items_asset_idx').on(table.assetId, table.batchId),
  }),
);

export const fixedAssetMaintenanceSchedules = pgTable(
  'fixed_asset_maintenance_schedules',
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
    name: text('name').notNull(),
    frequency: text('frequency').notNull(),
    intervalDays: integer('interval_days'),
    nextDueDate: text('next_due_date').notNull(),
    lastCompletedDate: text('last_completed_date'),
    instructions: text('instructions'),
    responsibleDepartmentId: integer('responsible_department_id').references(() => departments.id),
    assignedTechnician: text('assigned_technician'),
    vendor: text('vendor'),
    estimatedCostCents: numeric('estimated_cost_cents', { precision: 18, scale: 0 })
      .default('0')
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    dueIdx: index('fixed_asset_schedules_due_idx').on(
      table.facilityId,
      table.isActive,
      table.nextDueDate,
    ),
    assetIdx: index('fixed_asset_schedules_asset_idx').on(table.assetId, table.nextDueDate),
  }),
);

export const fixedAssetInspections = pgTable(
  'fixed_asset_inspections',
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
    scheduleId: integer('schedule_id').references(() => fixedAssetMaintenanceSchedules.id),
    inspectionDate: text('inspection_date').notNull(),
    inspectorName: text('inspector_name'),
    inspectorEmployeeId: integer('inspector_employee_id').references(() => hrEmployees.id),
    conditionAssessment: text('condition_assessment'),
    findings: text('findings'),
    recommendations: text('recommendations'),
    followUpActions: text('follow_up_actions'),
    nextInspectionDate: text('next_inspection_date'),
    checklist: jsonb('checklist'),
    attachmentReference: text('attachment_reference'),
    status: text('status').default('PLANNED').notNull(),
    completedAt: timestamp('completed_at'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: index('fixed_asset_inspections_facility_idx').on(
      table.facilityId,
      table.status,
      table.inspectionDate,
    ),
    assetIdx: index('fixed_asset_inspections_asset_idx').on(table.assetId, table.inspectionDate),
  }),
);

export const fixedAssetLifecycleEvents = pgTable(
  'fixed_asset_lifecycle_events',
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
    eventType: text('event_type').notNull(),
    effectiveDate: text('effective_date').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    reason: text('reason').notNull(),
    details: text('details'),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    assetIdx: index('fixed_asset_lifecycle_asset_idx').on(table.assetId, table.effectiveDate),
    facilityIdx: index('fixed_asset_lifecycle_facility_idx').on(
      table.facilityId,
      table.eventType,
      table.effectiveDate,
    ),
  }),
);

/** Supporting evidence for an asset, a maintenance job or an inspection. */
export const fixedAssetDocuments = pgTable(
  'fixed_asset_documents',
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
    maintenanceId: integer('maintenance_id').references(() => fixedAssetMaintenance.id),
    inspectionId: integer('inspection_id').references(() => fixedAssetInspections.id),
    title: text('title').notNull(),
    documentType: text('document_type').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    content: customBytea('content').notNull(),
    uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    assetIdx: index('fixed_asset_documents_asset_idx').on(table.assetId, table.createdAt),
  }),
);
