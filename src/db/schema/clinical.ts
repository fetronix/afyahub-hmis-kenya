/**
 * JaliCare HMIS
 * Schema: Encounters, appointments, queues, vitals, diagnoses, procedures
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
  numeric,
  jsonb,
  date,
  index,
} from 'drizzle-orm/pg-core';

import { departments, facilities, tenants } from './tenancy.ts';

import { users } from './auth.ts';

import { patients, practitioners } from './patients.ts';

export const encounters = pgTable(
  'encounters',
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

    practitionerId: integer('practitioner_id').references(() => practitioners.id),

    departmentId: integer('department_id').references(() => departments.id),

    /*
      OUTPATIENT
      INPATIENT
      EMERGENCY
      ANC
      MATERNITY
      SPECIALIST
      TELEMEDICINE
      FOLLOW_UP
    */
    encounterType: text('encounter_type').default('OUTPATIENT').notNull(),

    /*
      PLANNED
      ACTIVE
      ON_HOLD
      COMPLETED
      CANCELLED
    */
    status: text('status').default('ACTIVE').notNull(),

    triageCategory: text('triage_category'),

    chiefComplaint: text('chief_complaint'),

    historyOfPresentIllness: text('history_of_present_illness'),

    physicalExamination: text('physical_examination'),

    clinicalNotes: text('clinical_notes'),

    followUpDate: date('follow_up_date'),

    /*
      Keep legacy/simple referral text only as
      a summary. The real referral relationship
      belongs in referrals.
    */
    referralFacility: text('referral_facility'),

    startedAt: timestamp('started_at').defaultNow().notNull(),

    endedAt: timestamp('ended_at'),

    createdByUserId: integer('created_by_user_id').references(() => users.id),

    updatedByUserId: integer('updated_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('encounters_tenant_idx').on(table.tenantId),

    patientIdx: index('encounters_patient_idx').on(table.patientId),

    facilityIdx: index('encounters_facility_idx').on(table.facilityId),

    practitionerIdx: index('encounters_practitioner_idx').on(table.practitionerId),

    departmentIdx: index('encounters_department_idx').on(table.departmentId),

    statusIdx: index('encounters_status_idx').on(table.status),

    startedAtIdx: index('encounters_started_at_idx').on(table.startedAt),
  }),
);

/* ============================================================
   20. APPOINTMENTS
   ============================================================ */

export const appointments = pgTable('appointments', {
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

  practitionerId: integer('practitioner_id').references(() => practitioners.id),

  departmentId: integer('department_id').references(() => departments.id),

  scheduledTime: text('scheduled_time').notNull(),

  durationMinutes: integer('duration_minutes').default(30),

  appointmentType: text('appointment_type').default('Routine Follow-up'),

  status: text('status').default('Scheduled'),

  reason: text('reason'),

  notes: text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   21. PATIENT QUEUES
   ============================================================ */

export const queues = pgTable('queues', {
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

  queueType: text('queue_type').notNull(),

  tokenNumber: text('token_number').notNull(),

  priority: text('priority').default('Normal'),

  status: text('status').default('Waiting'),

  waitingTimeMinutes: integer('waiting_time_minutes').default(0),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ============================================================
   22. VITAL SIGNS & OBSERVATIONS
   ============================================================ */

export const observations = pgTable('observations', {
  id: serial('id').primaryKey(),

  encounterId: integer('encounter_id')
    .references(() => encounters.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  systolicBp: integer('systolic_bp'),

  diastolicBp: integer('diastolic_bp'),

  pulseRate: integer('pulse_rate'),

  temperatureC: numeric('temperature_c', {
    precision: 4,
    scale: 1,
  }),

  respiratoryRate: integer('respiratory_rate'),

  spo2Percent: integer('spo2_percent'),

  weightKg: numeric('weight_kg', {
    precision: 5,
    scale: 1,
  }),

  heightCm: numeric('height_cm', {
    precision: 5,
    scale: 1,
  }),

  bmi: numeric('bmi', {
    precision: 4,
    scale: 1,
  }),

  bloodGlucoseMmol: numeric('blood_glucose_mmol', {
    precision: 4,
    scale: 1,
  }),

  recordedBy: text('recorded_by'),

  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});

/* ============================================================
   23. DIAGNOSES
   ============================================================ */

export const diagnoses = pgTable('diagnoses', {
  id: serial('id').primaryKey(),

  encounterId: integer('encounter_id')
    .references(() => encounters.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  // Nullable only for new native ICD-11 diagnoses; existing values are preserved.
  icd10Code: text('icd10_code'),

  icd10Description: text('icd10_description'),

  codingSystem: text('coding_system').default('ICD-10').notNull(),

  diagnosisCode: text('diagnosis_code'),

  diagnosisDisplay: text('diagnosis_display'),

  icd11Code: text('icd11_code'),

  icd11Title: text('icd11_title'),

  icd11Release: text('icd11_release'),

  icd11FoundationUri: text('icd11_foundation_uri'),

  icd11LinearizationUri: text('icd11_linearization_uri'),

  codingMetadata: jsonb('coding_metadata').$type<Record<string, unknown>>().default({}).notNull(),

  diagnosisType: text('diagnosis_type').default('Primary'),

  status: text('status').default('Confirmed'),

  notes: text('notes'),

  diagnosedBy: text('diagnosed_by'),

  diagnosedAt: timestamp('diagnosed_at').defaultNow().notNull(),
});

/* ============================================================
   24. CLINICAL PROCEDURES
   ============================================================ */

export const clinicalProcedures = pgTable('procedures', {
  id: serial('id').primaryKey(),

  encounterId: integer('encounter_id')
    .references(() => encounters.id)
    .notNull(),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  procedureCode: text('procedure_code').notNull(),

  procedureName: text('procedure_name').notNull(),

  departmentId: integer('department_id').references(() => departments.id),

  category: text('category').default('Minor OPD'),

  cost: numeric('cost', {
    precision: 10,
    scale: 2,
  }).default('0'),

  status: text('status').default('Completed'),

  performedBy: text('performed_by'),

  notes: text('notes'),

  performedAt: timestamp('performed_at').defaultNow().notNull(),
});
