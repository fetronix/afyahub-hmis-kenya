/** Budget projections, separate from requisitions, inventory and actual expenditure. See migration 0095 for lifecycle/integrity guards. */
import {
  pgTable,
  serial,
  integer,
  text,
  bigint,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';
import { tenants, facilities } from './tenancy.ts';
import { users } from './auth.ts';
import { facilityLetterheads } from './facility-branding.ts';
const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const scope = () => ({
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  facilityId: integer('facility_id')
    .notNull()
    .references(() => facilities.id),
});
const money = (name: string) => bigint(name, { mode: 'bigint' }).notNull();
export const planningImportBatches = pgTable('planning_import_batches', {
  id: serial('id').primaryKey(),
  ...scope(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  sourceBytes: bytes('source_bytes').notNull(),
  uploadedBy: integer('uploaded_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('UPLOADED'),
  result: jsonb('result'),
  validation: jsonb('validation'),
});
export const planningPlans = pgTable('planning_plans', {
  id: serial('id').primaryKey(),
  ...scope(),
  name: text('name').notNull(),
  planType: text('plan_type').notNull(),
  financialYear: integer('financial_year').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull().default('DRAFT'),
  inflationBp: integer('inflation_bp').notNull().default(0),
  version: integer('version').notNull().default(1),
  sourceImportId: integer('source_import_id').references(() => planningImportBatches.id),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  updatedBy: integer('updated_by')
    .notNull()
    .references(() => users.id),
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const planningCategories = pgTable('planning_categories', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id')
    .notNull()
    .references(() => planningPlans.id),
  ...scope(),
  name: text('name').notNull(),
  code: text('code'),
  isActive: boolean('is_active').notNull().default(true),
});
const source = () => ({
  sourceImportId: integer('source_import_id').references(() => planningImportBatches.id),
  sourceWorksheet: text('source_worksheet'),
  sourceRow: integer('source_row'),
  sourceFormula: text('source_formula'),
});
const child = () => ({
  planId: integer('plan_id')
    .notNull()
    .references(() => planningPlans.id),
  categoryId: integer('category_id')
    .notNull()
    .references(() => planningCategories.id),
  description: text('description').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  updatedBy: integer('updated_by')
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...source(),
});
export const planningItems = pgTable('planning_items', {
  id: serial('id').primaryKey(),
  ...child(),
  unit: text('unit').notNull(),
  basePriceCents: money('base_price_cents'),
  inflationBp: integer('inflation_bp'),
  adjustedPriceCents: money('adjusted_price_cents'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const planningMonths = pgTable('planning_months', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id')
    .notNull()
    .references(() => planningItems.id),
  plannedMonth: date('planned_month').notNull(),
  quantity: numeric('quantity', { precision: 16, scale: 3 }),
  unitPriceCents: money('unit_price_cents'),
  amountCents: bigint('amount_cents', { mode: 'bigint' }),
  status: text('status').notNull().default('PLANNED'),
});
export const planningUniforms = pgTable('planning_uniforms', {
  id: serial('id').primaryKey(),
  ...child(),
  existingBalance: numeric('existing_balance', { precision: 16, scale: 3 }).notNull(),
  balanceLabel: text('balance_label').notNull(),
  buyingCostCents: money('buying_cost_cents'),
  contributionBp: integer('contribution_bp').notNull(),
  staffCount: integer('staff_count').notNull(),
  quantityPerStaff: numeric('quantity_per_staff', { precision: 16, scale: 3 }).notNull(),
  balanceRule: text('balance_rule').notNull(),
  projectedQuantity: numeric('projected_quantity', { precision: 16, scale: 3 }).notNull(),
  purchaseQuantity: numeric('purchase_quantity', { precision: 16, scale: 3 }).notNull(),
  grossCents: money('gross_cents'),
  contributionCents: money('contribution_cents'),
  totalCents: money('total_cents'),
});
export const planningEvents = pgTable('planning_events', {
  id: serial('id').primaryKey(),
  ...scope(),
  planId: integer('plan_id').references(() => planningPlans.id),
  importId: integer('import_id').references(() => planningImportBatches.id),
  actorId: integer('actor_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: integer('entity_id'),
  previousValues: jsonb('previous_values'),
  updatedValues: jsonb('updated_values'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const planningReports = pgTable('planning_reports', {
  id: serial('id').primaryKey(),
  ...scope(),
  planId: integer('plan_id')
    .notNull()
    .references(() => planningPlans.id),
  reportType: text('report_type').notNull(),
  filters: jsonb('filters').notNull(),
  model: jsonb('model').notNull(),
  exportData: jsonb('export_data').notNull(),
  letterheadId: integer('letterhead_id').references(() => facilityLetterheads.id),
  pdfBytes: bytes('pdf_bytes').notNull(),
  generatedBy: integer('generated_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
