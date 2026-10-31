/**
 * JaliCare HMIS
 * Schema: Laboratory catalogue, orders, results, and radiology orders
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

import { encounters } from './clinical.ts';
import { masterServices } from './master-services.ts';
import { users } from './auth.ts';

export const labTests = pgTable(
  'lab_tests',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    code: text('code').notNull(),

    name: text('name').notNull(),

    category: text('category').default('Haematology'),

    specimenType: text('specimen_type').default('Whole Blood'),

    referenceRanges: text('reference_ranges'),

    turnaroundHours: integer('turnaround_hours').default(2),

    price: numeric('price', {
      precision: 10,
      scale: 2,
    }).default('500.00'),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('lab_tests_facility_code_idx').on(table.facilityId, table.code),
  }),
);

/* ============================================================
   31. LABORATORY ORDERS
   ============================================================ */

export const labOrders = pgTable('lab_orders', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  encounterId: integer('encounter_id').references(() => encounters.id),

  testId: integer('test_id').references(() => labTests.id),

  testName: text('test_name').notNull(),

  status: text('status').default('Ordered'),
  clinicalIndication: text('clinical_indication'),

  specimenType: text('specimen_type'),

  priority: text('priority').default('Routine'),

  clinicalNotes: text('clinical_notes'),

  completedAt: timestamp('completed_at'),
  completedByUserId: integer('completed_by_user_id').references(() => users.id),

  sampleCollectedAt: timestamp('sample_collected_at'),

  sampleAccessionNumber: text('sample_accession_number'),

  orderedBy: text('ordered_by'),

  orderedAt: timestamp('ordered_at').defaultNow().notNull(),
});

/* ============================================================
   32. LABORATORY RESULTS
   ============================================================ */

export const labResults = pgTable('lab_results', {
  id: serial('id').primaryKey(),

  orderId: integer('order_id')
    .references(() => labOrders.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  parameterName: text('parameter_name').notNull(),

  measuredValue: text('measured_value').notNull(),

  unit: text('unit'),

  referenceRange: text('reference_range'),

  flag: text('flag').default('Normal'),

  notes: text('notes'),

  status: text('status').notNull().default('Pending Verification'),
  verifiedBy: text('verified_by'),

  verifiedAt: timestamp('verified_at'),
});

/* ============================================================
   33. RADIOLOGY ORDERS
   ============================================================ */

export const radiologyOrders = pgTable('radiology_orders', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  encounterId: integer('encounter_id').references(() => encounters.id),

  modality: text('modality').notNull(),

  masterServiceId: integer('master_service_id').references(() => masterServices.id),

  procedureName: text('procedure_name').notNull(),

  clinicalIndication: text('clinical_indication'),

  status: text('status').default('Requested'),

  radiologistFindings: text('radiologist_findings'),

  impression: text('impression'),

  attachmentUrl: text('attachment_url'),

  orderedBy: text('ordered_by'),

  reportedBy: text('reported_by'),

  reportedAt: timestamp('reported_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
