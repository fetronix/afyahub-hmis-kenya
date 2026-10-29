/**
 * JaliCare HMIS — dialysis schema.
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
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { billingInvoices } from './billing.ts';
import { appointments, encounters } from './clinical.ts';
import { inventoryItems } from './inventory.ts';
import { patients } from './patients.ts';
import { facilities, tenants } from './tenancy.ts';

export const dialysisMachines = pgTable(
  'dialysis_machines',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    machineCode: text('machine_code').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    bayLabel: text('bay_label').notNull(),
    isolationZone: text('isolation_zone').default('UNSPECIFIED').notNull(),
    status: text('status').default('OUT_OF_SERVICE').notNull(),
    lastDisinfectedAt: timestamp('last_disinfected_at'),
    nextPreventiveMaintenanceDate: text('next_preventive_maintenance_date'),
    notes: text('notes'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('dialysis_machines_facility_code_idx').on(
      table.facilityId,
      table.machineCode,
    ),
  }),
);

export const dialysisPatientAssessments = pgTable('dialysis_patient_assessments', {
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
  primaryIcd11Code: text('primary_icd11_code'),
  primaryDiagnosisDisplay: text('primary_diagnosis_display'),
  renalHistorySummary: text('renal_history_summary').notNull(),
  vascularAccessType: text('vascular_access_type').notNull(),
  vascularAccessSite: text('vascular_access_site'),
  viralSerologyStatus: jsonb('viral_serology_status')
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  baselineDryWeightKg: numeric('baseline_dry_weight_kg', { precision: 5, scale: 2 }),
  allergiesAndPrecautions: text('allergies_and_precautions'),
  clinicalFitnessStatus: text('clinical_fitness_status')
    .default('REQUIRES_NEPHROLOGIST_REVIEW')
    .notNull(),
  customProtocolFields: jsonb('custom_protocol_fields')
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  assessedByUserId: integer('assessed_by_user_id').references(() => users.id),
  assessedByName: text('assessed_by_name').notNull(),
  assessedAt: timestamp('assessed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const dialysisTreatmentPlans = pgTable(
  'dialysis_treatment_plans',
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
    assessmentId: integer('assessment_id').references(() => dialysisPatientAssessments.id),
    planNumber: text('plan_number').notNull(),
    modality: text('modality').notNull(),
    sessionsPerWeek: integer('sessions_per_week'),
    prescribedDurationMinutes: integer('prescribed_duration_minutes'),
    targetDryWeightKg: numeric('target_dry_weight_kg', { precision: 5, scale: 2 }),
    dialyzerSpecification: text('dialyzer_specification'),
    dialysateComposition: text('dialysate_composition'),
    anticoagulationProtocol: text('anticoagulation_protocol'),
    targetBloodFlowMlMin: integer('target_blood_flow_ml_min'),
    maxUfRateMlKgHr: numeric('max_uf_rate_ml_kg_hr', { precision: 5, scale: 2 }),
    protocolParameters: jsonb('protocol_parameters')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text('status').default('DRAFT').notNull(),
    authorizedByUserId: integer('authorized_by_user_id').references(() => users.id),
    authorizedByName: text('authorized_by_name'),
    authorizedAt: timestamp('authorized_at'),
    changeHistory: jsonb('change_history')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNumIdx: uniqueIndex('dialysis_plans_facility_num_idx').on(
      table.facilityId,
      table.planNumber,
    ),
  }),
);

export const dialysisSchedules = pgTable('dialysis_schedules', {
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
  treatmentPlanId: integer('treatment_plan_id').references(() => dialysisTreatmentPlans.id),
  appointmentId: integer('appointment_id').references(() => appointments.id),
  machineId: integer('machine_id').references(() => dialysisMachines.id),
  scheduledDate: date('scheduled_date').notNull(),
  shiftCode: text('shift_code').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  status: text('status').default('SCHEDULED').notNull(),
  cancellationReason: text('cancellation_reason'),
  bookedSource: text('booked_source').default('FACILITY_STAFF').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dialysisSessions = pgTable(
  'dialysis_sessions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    sessionNumber: text('session_number').notNull(),
    scheduleId: integer('schedule_id').references(() => dialysisSchedules.id),
    treatmentPlanId: integer('treatment_plan_id')
      .references(() => dialysisTreatmentPlans.id)
      .notNull(),
    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),
    encounterId: integer('encounter_id').references(() => encounters.id),
    machineId: integer('machine_id')
      .references(() => dialysisMachines.id)
      .notNull(),
    status: text('status').default('PRE_CHECK').notNull(),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    actualDurationMinutes: integer('actual_duration_minutes'),
    preWeightKg: numeric('pre_weight_kg', { precision: 5, scale: 2 }),
    postWeightKg: numeric('post_weight_kg', { precision: 5, scale: 2 }),
    targetUfMl: integer('target_uf_ml'),
    actualUfMl: integer('actual_uf_ml'),
    preBpSystolic: integer('pre_bp_systolic'),
    preBpDiastolic: integer('pre_bp_diastolic'),
    postBpSystolic: integer('post_bp_systolic'),
    postBpDiastolic: integer('post_bp_diastolic'),
    prePulse: integer('pre_pulse'),
    postPulse: integer('post_pulse'),
    preTempC: numeric('pre_temp_c', { precision: 4, scale: 1 }),
    vascularAccessAssessment: text('vascular_access_assessment'),
    anticoagulationAdministered: text('anticoagulation_administered'),
    intradialyticObservations: jsonb('intradialytic_observations')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    nursingSummary: text('nursing_summary'),
    billingInvoiceId: integer('billing_invoice_id').references(() => billingInvoices.id),
    billedChargeStatus: text('billed_charge_status').default('UNBILLED').notNull(),
    initiatedByUserId: integer('initiated_by_user_id').references(() => users.id),
    completedByUserId: integer('completed_by_user_id').references(() => users.id),
    revisionHistory: jsonb('revision_history')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNumIdx: uniqueIndex('dialysis_sessions_facility_num_idx').on(
      table.facilityId,
      table.sessionNumber,
    ),
  }),
);

export const dialysisConsumableUsages = pgTable('dialysis_consumable_usages', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),
  sessionId: integer('session_id')
    .references(() => dialysisSessions.id)
    .notNull(),
  inventoryItemId: integer('inventory_item_id')
    .references(() => inventoryItems.id)
    .notNull(),
  batchNumber: text('batch_number'),
  itemName: text('item_name').notNull(),
  quantityUsed: integer('quantity_used').notNull(),
  unitCostKes: numeric('unit_cost_kes', { precision: 12, scale: 2 }),
  totalCostKes: numeric('total_cost_kes', { precision: 12, scale: 2 }),
  batchAllocations: jsonb('batch_allocations')
    .$type<Array<Record<string, unknown>>>()
    .default([])
    .notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  deductedFromStock: boolean('deducted_from_stock').default(true).notNull(),
  recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});

export const dialysisAdverseEvents = pgTable('dialysis_adverse_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),
  sessionId: integer('session_id')
    .references(() => dialysisSessions.id)
    .notNull(),
  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull(),
  onsetAt: timestamp('onset_at').defaultNow().notNull(),
  clinicalDescription: text('clinical_description').notNull(),
  immediateIntervention: text('immediate_intervention').notNull(),
  sessionOutcome: text('session_outcome').notNull(),
  followUpStatus: text('follow_up_status').default('OPEN').notNull(),
  followUpNotes: text('follow_up_notes'),
  followUpByUserId: integer('follow_up_by_user_id').references(() => users.id),
  followUpAt: timestamp('follow_up_at'),
  reportedByUserId: integer('reported_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
