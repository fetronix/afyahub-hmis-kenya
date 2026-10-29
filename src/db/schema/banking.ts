/**
 * JaliCare HMIS — banking schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { billingPayments } from './billing.ts';
import {
  chartOfAccounts,
  journalEntries,
  journalLines,
  supplierInvoices,
} from './financial-ledger.ts';
import { suppliers } from './inventory.ts';
import { facilities, tenants } from './tenancy.ts';

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    accountName: text('account_name').notNull(),
    bankCode: text('bank_code').notNull(),
    bankName: text('bank_name').notNull(),
    branchName: text('branch_name'),
    accountNumberMasked: text('account_number_masked'),
    currency: text('currency').default('KES').notNull(),
    accountKind: text('account_kind').default('BANK').notNull(),
    glAccountId: integer('gl_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    connectorMode: text('connector_mode').default('STATEMENT_IMPORT_ONLY').notNull(),
    connectorConfig: jsonb('connector_config')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    openingBalanceKes: numeric('opening_balance_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    bookBalanceKes: numeric('book_balance_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    lastStatementBalanceKes: numeric('last_statement_balance_kes', { precision: 14, scale: 2 }),
    lastReconciledAt: timestamp('last_reconciled_at'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNameIdx: uniqueIndex('bank_accounts_facility_name_idx').on(
      table.facilityId,
      table.accountName,
    ),
  }),
);

export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    supplierInvoiceId: integer('supplier_invoice_id')
      .references(() => supplierInvoices.id)
      .notNull(),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    paymentNumber: text('payment_number').notNull(),
    paymentDate: text('payment_date').notNull(),
    paymentMethod: text('payment_method').notNull(),
    bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
    paymentReference: text('payment_reference'),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    postedJournalId: integer('posted_journal_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdempIdx: uniqueIndex('supplier_payments_facility_idemp_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  }),
);

export const bankStatementImports = pgTable(
  'bank_statement_imports',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    bankAccountId: integer('bank_account_id')
      .references(() => bankAccounts.id)
      .notNull(),
    importReference: text('import_reference').notNull(),
    sourceType: text('source_type').default('CSV_IMPORT').notNull(),
    statementStartDate: text('statement_start_date').notNull(),
    statementEndDate: text('statement_end_date').notNull(),
    openingBalanceKes: numeric('opening_balance_kes', { precision: 14, scale: 2 }),
    closingBalanceKes: numeric('closing_balance_kes', { precision: 14, scale: 2 }).notNull(),
    lineCount: integer('line_count').default(0).notNull(),
    fileHash: text('file_hash').notNull(),
    importedByUserId: integer('imported_by_user_id').references(() => users.id),
    importedAt: timestamp('imported_at').defaultNow().notNull(),
  },
  (table) => ({
    accountHashIdx: uniqueIndex('bank_stmt_imports_account_hash_idx').on(
      table.bankAccountId,
      table.fileHash,
    ),
  }),
);

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    bankAccountId: integer('bank_account_id')
      .references(() => bankAccounts.id)
      .notNull(),
    statementImportId: integer('statement_import_id').references(() => bankStatementImports.id),
    transactionDate: text('transaction_date').notNull(),
    valueDate: text('value_date'),
    referenceNumber: text('reference_number'),
    description: text('description').notNull(),
    direction: text('direction').notNull(),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    runningBalanceKes: numeric('running_balance_kes', { precision: 14, scale: 2 }),
    originClassification: text('origin_classification').default('IMPORTED_STATEMENT').notNull(),
    matchStatus: text('match_status').default('UNMATCHED').notNull(),
    dedupeHash: text('dedupe_hash').notNull(),
    matchedJournalLineId: integer('matched_journal_line_id').references(() => journalLines.id),
    matchedJournalEntryId: integer('matched_journal_entry_id').references(() => journalEntries.id),
    matchedBillingPaymentId: integer('matched_billing_payment_id').references(
      () => billingPayments.id,
    ),
    matchedSupplierPaymentId: integer('matched_supplier_payment_id').references(
      () => supplierPayments.id,
    ),
    matchedByUserId: integer('matched_by_user_id').references(() => users.id),
    matchedAt: timestamp('matched_at'),
    externalTxId: text('external_tx_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    accountDateIdx: index('bank_transactions_account_date_idx').on(
      table.bankAccountId,
      table.transactionDate,
    ),
  }),
);

export const bankReconciliations = pgTable('bank_reconciliations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),
  bankAccountId: integer('bank_account_id')
    .references(() => bankAccounts.id)
    .notNull(),
  statementImportId: integer('statement_import_id')
    .references(() => bankStatementImports.id)
    .notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  periodCode: text('period_code').notNull(),
  statementEndingDate: text('statement_ending_date').notNull(),
  statementEndingBalanceKes: numeric('statement_ending_balance_kes', {
    precision: 14,
    scale: 2,
  }).notNull(),
  ledgerBookBalanceKes: numeric('ledger_book_balance_kes', {
    precision: 14,
    scale: 2,
  }).notNull(),
  unmatchedDepositsKes: numeric('unmatched_deposits_kes', { precision: 14, scale: 2 })
    .default('0.00')
    .notNull(),
  unmatchedWithdrawalsKes: numeric('unmatched_withdrawals_kes', { precision: 14, scale: 2 })
    .default('0.00')
    .notNull(),
  adjustedDifferenceKes: numeric('adjusted_difference_kes', { precision: 14, scale: 2 })
    .default('0.00')
    .notNull(),
  status: text('status').default('DRAFT').notNull(),
  reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
  reconciledAt: timestamp('reconciled_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
