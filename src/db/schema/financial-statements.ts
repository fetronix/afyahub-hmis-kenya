/**
 * JaliCare HMIS — financial statements schema.
 *
 * Statements are derived from the ledger, never typed. These tables hold the
 * three things a derivation cannot invent for itself: how long the facility's
 * financial year is, where each account is presented, and the frozen record of
 * what was approved.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  date,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { chartOfAccounts } from './financial-ledger.ts';
import { facilities, tenants } from './tenancy.ts';

export const financialStatementSettings = pgTable(
  'financial_statement_settings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    /** 1–12. July is the Kenyan public-sector default, but it is a default, not a rule. */
    financialYearStartMonth: integer('financial_year_start_month').notNull().default(7),
    /** Equity account that absorbs a year-end close. Null means "not configured yet". */
    retainedEarningsAccountId: integer('retained_earnings_account_id').references(
      () => chartOfAccounts.id,
    ),
    preparedByName: text('prepared_by_name'),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('financial_statement_settings_facility_idx').on(table.facilityId)],
);

export const financialStatementAccountGroups = pgTable(
  'financial_statement_account_groups',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    accountId: integer('account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    presentationGroup: text('presentation_group').notNull(),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('financial_statement_account_groups_facility_account_idx').on(
      table.facilityId,
      table.accountId,
    ),
  ],
);

export const financialStatementRuns = pgTable(
  'financial_statement_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    frequency: text('frequency').notNull(),
    financialYear: text('financial_year').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    comparativeStart: date('comparative_start'),
    comparativeEnd: date('comparative_end'),
    comparativeMode: text('comparative_mode').notNull().default('PRIOR_PERIOD'),
    accountingBasis: text('accounting_basis').notNull().default('ACCRUAL'),
    version: integer('version').notNull().default(1),
    supersedesId: integer('supersedes_id').references((): AnyPgColumn => financialStatementRuns.id),
    status: text('status').notNull().default('DRAFT'),
    generatedBy: integer('generated_by').references(() => users.id),
    generatedAt: timestamp('generated_at').notNull().defaultNow(),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    sourcePeriodIds: integer('source_period_ids').array().notNull().default([]),
    /** Latest posted_at included in the derivation: the watermark the figures rest on. */
    ledgerThrough: text('ledger_through'),
    journalCount: integer('journal_count').notNull().default(0),
    /** The whole statement set, as approved. Immutable from approval onwards. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    payloadHash: text('payload_hash').notNull(),
    checks: jsonb('checks').$type<Array<Record<string, unknown>>>().notNull().default([]),
    notes: jsonb('notes').$type<Array<Record<string, unknown>>>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('financial_statement_runs_version_idx').on(
      table.facilityId,
      table.frequency,
      table.financialYear,
      table.periodStart,
      table.periodEnd,
      table.version,
    ),
    index('financial_statement_runs_archive_idx').on(
      table.facilityId,
      table.financialYear,
      table.periodEnd,
    ),
  ],
);

export const financialStatementExports = pgTable(
  'financial_statement_exports',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    runId: integer('run_id')
      .references(() => financialStatementRuns.id)
      .notNull(),
    format: text('format').notNull(),
    statement: text('statement').notNull().default('ALL'),
    filename: text('filename').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentHash: text('content_hash').notNull(),
    exportedBy: integer('exported_by').references(() => users.id),
    exportedAt: timestamp('exported_at').notNull().defaultNow(),
  },
  (table) => [index('financial_statement_exports_run_idx').on(table.runId, table.exportedAt)],
);
