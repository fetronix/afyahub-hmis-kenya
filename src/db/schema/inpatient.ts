/**
 * JaliCare HMIS
 * Schema: Medications, wards, beds, admissions, transfers, nursing, theatre
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
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { facilities, tenants } from './tenancy.ts';

import { users } from './auth.ts';

import { patients } from './patients.ts';

import { encounters } from './clinical.ts';
import { facilityServices } from './facility-services.ts';

export const medications = pgTable('medications', {
  id: serial('id').primaryKey(),

  encounterId: integer('encounter_id')
    .references(() => encounters.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  drugId: integer('drug_id'),

  drugName: text('drug_name').notNull(),

  dosage: text('dosage').notNull(),

  frequency: text('frequency').notNull(),

  duration: text('duration').notNull(),

  route: text('route').default('Oral'),

  instructions: text('instructions'),

  quantity: integer('quantity').default(1),

  unitPrice: numeric('unit_price', {
    precision: 10,
    scale: 2,
  }).default('0'),

  status: text('status').default('Prescribed'),

  prescribedBy: text('prescribed_by'),

  prescribedAt: timestamp('prescribed_at').defaultNow().notNull(),
});

/* ============================================================
   26. INPATIENT WARDS
   ============================================================ */

export const wards = pgTable(
  'wards',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    name: text('name').notNull(),

    code: text('code').notNull(),

    wardType: text('ward_type').default('General'),

    genderAllocation: text('gender_allocation').default('Mixed'),

    totalBeds: integer('total_beds').default(20),

    dailyRate: numeric('daily_rate', {
      precision: 10,
      scale: 2,
    }).default('1500.00'),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('wards_facility_code_idx').on(table.facilityId, table.code),
  }),
);

/* ============================================================
   27. WARD BEDS
   ============================================================ */

export const beds = pgTable(
  'beds',
  {
    id: serial('id').primaryKey(),

    wardId: integer('ward_id')
      .references(() => wards.id)
      .notNull(),

    bedNumber: text('bed_number').notNull(),

    bedType: text('bed_type').default('Standard'),

    status: text('status').default('Available'),

    dailyCharge: numeric('daily_charge', {
      precision: 10,
      scale: 2,
    }).default('1500.00'),

    currentPatientId: integer('current_patient_id').references(() => patients.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    wardBedIdx: uniqueIndex('beds_ward_bed_number_idx').on(table.wardId, table.bedNumber),
  }),
);

/* ============================================================
   28. INPATIENT ADMISSIONS
   ============================================================ */

export const admissions = pgTable('admissions', {
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

  facilityServiceId: integer('facility_service_id').references(() => facilityServices.id),

  wardId: integer('ward_id')
    .references(() => wards.id)
    .notNull(),

  bedId: integer('bed_id')
    .references(() => beds.id)
    .notNull(),

  admissionDate: text('admission_date').notNull(),

  admissionType: text('admission_type').default('Emergency'),

  admittingDoctor: text('admitting_doctor'),

  provisionalDiagnosis: text('provisional_diagnosis'),

  nursingNotes: text('nursing_notes'),

  status: text('status').default('Admitted'),

  dischargeDate: text('discharge_date'),

  dischargeType: text('discharge_type'),

  dischargeSummary: text('discharge_summary'),

  dischargedBy: text('discharged_by'),

  /*
   * Recovered | Improved | Referred | Absconded | Deceased |
   * Against Medical Advice
   */
  dischargeDisposition: text('discharge_disposition'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   28b. INPATIENT TRANSFERS
   ============================================================ */

export const admissionTransfers = pgTable(
  'admission_transfers',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    admissionId: integer('admission_id')
      .references(() => admissions.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    fromWardId: integer('from_ward_id').references(() => wards.id),

    fromBedId: integer('from_bed_id').references(() => beds.id),

    toWardId: integer('to_ward_id')
      .references(() => wards.id)
      .notNull(),

    toBedId: integer('to_bed_id')
      .references(() => beds.id)
      .notNull(),

    reason: text('reason'),

    transferredBy: text('transferred_by').notNull(),

    transferredByUserId: integer('transferred_by_user_id').references(() => users.id),

    transferredAt: timestamp('transferred_at').defaultNow().notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('admission_transfers_admission_idx').on(table.admissionId, table.transferredAt),
  ],
);

/* ============================================================
   28c. NURSING NOTES
   ============================================================ */

export const nursingNotes = pgTable(
  'nursing_notes',
  {
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

    admissionId: integer('admission_id').references(() => admissions.id),

    encounterId: integer('encounter_id').references(() => encounters.id),

    /* Progress | Observation | Handover | Medication | Incident */
    noteType: text('note_type').default('Progress').notNull(),

    /* Morning | Afternoon | Night */
    shift: text('shift'),

    note: text('note').notNull(),

    recordedBy: text('recorded_by').notNull(),

    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),

    recordedAt: timestamp('recorded_at').defaultNow().notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('nursing_notes_admission_idx').on(table.admissionId, table.recordedAt),
    index('nursing_notes_patient_idx').on(table.patientId, table.recordedAt),
  ],
);

/* ============================================================
   29. OPERATING THEATRE
   ============================================================ */

export const theatreCases = pgTable('theatre_cases', {
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

  procedureName: text('procedure_name').notNull(),

  theatreRoom: text('theatre_room').default('Main Theatre 1'),

  theatreType: text('theatre_type').default('Major'),

  leadSurgeon: text('lead_surgeon').notNull(),

  anaesthetist: text('anaesthetist'),

  scrubNurse: text('scrub_nurse'),

  scheduledStart: text('scheduled_start').notNull(),

  scheduledEnd: text('scheduled_end'),

  preOpChecklist: jsonb('pre_op_checklist').default({}),

  postOpNotes: text('post_op_notes'),

  status: text('status').default('Scheduled'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
