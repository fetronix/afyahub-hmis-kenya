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

import { encounters, queues } from './clinical.ts';
import { sql } from 'drizzle-orm';
import { masterServices } from './master-services.ts';
import { facilityServices } from './facility-services.ts';
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

/** Explicit, facility-reviewed choices; the legacy specimen default is not a clinical rule. */
export const labTestSpecimenOptions = pgTable(
  'lab_test_specimen_options',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    testId: integer('test_id')
      .notNull()
      .references(() => labTests.id),
    specimenType: text('specimen_type').notNull(),
    reviewReference: text('review_reference').notNull(),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    retiredByUserId: integer('retired_by_user_id').references(() => users.id),
    retiredAt: timestamp('retired_at'),
    retirementReference: text('retirement_reference'),
  },
  (table) => [
    uniqueIndex('lab_test_specimen_options_active_unique')
      .on(table.tenantId, table.facilityId, table.testId, sql`lower(trim(${table.specimenType}))`)
      .where(sql`${table.retiredAt} IS NULL`),
  ],
);

export const labOrderBatches = pgTable(
  'lab_order_batches',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: integer('patient_id')
      .notNull()
      .references(() => patients.id),
    encounterId: integer('encounter_id').references(() => encounters.id),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    queueId: integer('queue_id').references(() => queues.id),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('lab_order_batches_scope_key_unique').on(
      table.tenantId,
      table.facilityId,
      table.idempotencyKey,
    ),
  ],
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

  facilityServiceId: integer('facility_service_id').references(() => facilityServices.id),

  reviewedSpecimenOptionId: integer('reviewed_specimen_option_id').references(
    () => labTestSpecimenOptions.id,
  ),

  batchId: integer('batch_id').references(() => labOrderBatches.id),

  // Explicit exceptions remain non-billable until a future controlled identity/specimen review.
  clinicalException: boolean('clinical_exception').notNull().default(false),

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
  facilityServiceId: integer('facility_service_id').references(() => facilityServices.id),

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

/** Optional request identity for safely retrying imaging orders. */
export const radiologyOrderRequests = pgTable(
  'radiology_order_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    orderId: integer('order_id').references(() => radiologyOrders.id),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('radiology_order_requests_scope_key_unique').on(
      table.tenantId,
      table.facilityId,
      table.idempotencyKey,
    ),
  ],
);
