/**
 * JaliCare HMIS — financial ledger schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  numeric,
  jsonb,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { billingInvoices } from './billing.ts';
import { purchaseOrders, suppliers } from './inventory.ts';
import { patients } from './patients.ts';
import { departments, facilities, tenants } from './tenancy.ts';

export const financialPeriods = pgTable(
  'financial_periods',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    periodCode: text('period_code').notNull(),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').default('OPEN').notNull(),
    closedByUserId: integer('closed_by_user_id').references(() => users.id),
    closedAt: timestamp('closed_at'),
    closeNotes: text('close_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('financial_periods_facility_code_idx').on(
      table.facilityId,
      table.periodCode,
    ),
  }),
);

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    accountCode: text('account_code').notNull(),
    accountName: text('account_name').notNull(),
    accountType: text('account_type').notNull(),
    subType: text('sub_type').notNull(),
    normalBalance: text('normal_balance').notNull(),
    departmentCode: text('department_code'),
    parentAccountId: integer('parent_account_id'),
    isSystemAccount: boolean('is_system_account').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityAccountCodeIdx: uniqueIndex('coa_facility_account_code_idx').on(
      table.facilityId,
      table.accountCode,
    ),
  }),
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    periodId: integer('period_id').references(() => financialPeriods.id),
    journalNumber: text('journal_number').notNull(),
    entryDate: date('entry_date').notNull(),
    sourceType: text('source_type').default('MANUAL').notNull(),
    sourceId: text('source_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    description: text('description').notNull(),
    status: text('status').default('DRAFT').notNull(),
    totalDebitCents: bigint('total_debit_cents', { mode: 'number' }).notNull(),
    totalCreditCents: bigint('total_credit_cents', { mode: 'number' }).notNull(),
    reversalOfJournalId: integer('reversal_of_journal_id'),
    reversedByJournalId: integer('reversed_by_journal_id'),
    reversalReason: text('reversal_reason'),
    postedByUserId: integer('posted_by_user_id').references(() => users.id),
    postedAt: timestamp('posted_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNumberIdx: uniqueIndex('journal_entries_facility_number_idx').on(
      table.facilityId,
      table.journalNumber,
    ),
    facilityIdempIdx: uniqueIndex('journal_entries_facility_idempotency_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  }),
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: serial('id').primaryKey(),
    journalEntryId: integer('journal_entry_id')
      .references(() => journalEntries.id)
      .notNull(),
    accountId: integer('account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    serviceLine: text('service_line'),
    description: text('description'),
    debitCents: bigint('debit_cents', { mode: 'number' }).default(0).notNull(),
    creditCents: bigint('credit_cents', { mode: 'number' }).default(0).notNull(),
    patientId: integer('patient_id').references(() => patients.id),
    supplierId: integer('supplier_id').references(() => suppliers.id),
    invoiceId: integer('invoice_id').references(() => billingInvoices.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    entryIdx: index('journal_lines_entry_idx').on(table.journalEntryId),
    accountIdx: index('journal_lines_account_idx').on(table.accountId),
  }),
);

export const expenseRequests = pgTable(
  'expense_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    requestNumber: text('request_number').notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    serviceLine: text('service_line'),
    expenseAccountId: integer('expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    paymentAccountId: integer('payment_account_id').references(() => chartOfAccounts.id),
    payeeName: text('payee_name').notNull(),
    category: text('category').notNull(),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').default('KES').notNull(),
    description: text('description').notNull(),
    supportingDocuments: jsonb('supporting_documents')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    status: text('status').default('SUBMITTED').notNull(),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id),
    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNotes: text('review_notes'),
    postedJournalId: integer('posted_journal_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    incurredDate: date('incurred_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNumberIdx: uniqueIndex('expense_requests_facility_number_idx').on(
      table.facilityId,
      table.requestNumber,
    ),
    facilityIdempIdx: uniqueIndex('expense_requests_facility_idemp_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  }),
);

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    assetCode: text('asset_code').notNull(),
    assetName: text('asset_name').notNull(),
    category: text('category').notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    serviceLine: text('service_line'),
    serialNumber: text('serial_number'),
    acquisitionDate: text('acquisition_date').notNull(),
    acquisitionCostKes: numeric('acquisition_cost_kes', { precision: 14, scale: 2 }).notNull(),
    salvageValueKes: numeric('salvage_value_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    depreciationMethod: text('depreciation_method').default('STRAIGHT_LINE').notNull(),
    accumulatedDepreciationKes: numeric('accumulated_depreciation_kes', {
      precision: 14,
      scale: 2,
    })
      .default('0.00')
      .notNull(),
    netBookValueKes: numeric('net_book_value_kes', { precision: 14, scale: 2 }).notNull(),
    assetAccountId: integer('asset_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    accumDepAccountId: integer('accum_dep_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    depExpenseAccountId: integer('dep_expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    status: text('status').default('ACTIVE').notNull(),
    disposedAt: timestamp('disposed_at'),
    disposalProceedsKes: numeric('disposal_proceeds_kes', { precision: 14, scale: 2 }),
    disposalJournalId: integer('disposal_journal_id').references(() => journalEntries.id),
    disposalNotes: text('disposal_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('fixed_assets_facility_code_idx').on(
      table.facilityId,
      table.assetCode,
    ),
  }),
);

export const fixedAssetMovements = pgTable(
  'fixed_asset_movements',
  {
    id: serial('id').primaryKey(),
    assetId: integer('asset_id')
      .references(() => fixedAssets.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    movementType: text('movement_type').notNull(),
    movementDate: text('movement_date').notNull(),
    periodCode: text('period_code').notNull(),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    netBookValueAfterKes: numeric('net_book_value_after_kes', {
      precision: 14,
      scale: 2,
    }).notNull(),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    depPeriodIdx: uniqueIndex('fixed_asset_movements_dep_period_idx').on(
      table.assetId,
      table.movementType,
      table.periodCode,
    ),
  }),
);

export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
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
    purchaseOrderId: integer('purchase_order_id').references(() => purchaseOrders.id),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: text('invoice_date').notNull(),
    dueDate: text('due_date'),
    expenseAccountId: integer('expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    apAccountId: integer('ap_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    serviceLine: text('service_line'),
    subtotalKes: numeric('subtotal_kes', { precision: 14, scale: 2 }).notNull(),
    taxKes: numeric('tax_kes', { precision: 14, scale: 2 }).default('0.00').notNull(),
    totalAmountKes: numeric('total_amount_kes', { precision: 14, scale: 2 }).notNull(),
    paidAmountKes: numeric('paid_amount_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    balanceKes: numeric('balance_kes', { precision: 14, scale: 2 }).notNull(),
    status: text('status').default('POSTED').notNull(),
    postedJournalId: integer('posted_journal_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilitySupNumIdx: uniqueIndex('supplier_invoices_facility_sup_num_idx').on(
      table.facilityId,
      table.supplierId,
      table.invoiceNumber,
    ),
  }),
);
