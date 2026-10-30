/**
 * JaliCare HMIS — relations clinical schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import { relations } from 'drizzle-orm';
import { users } from './auth.ts';
import { billingInvoices } from './billing.ts';
import { appointments, diagnoses, encounters, observations } from './clinical.ts';
import { admissions, beds, medications, theatreCases, wards } from './inpatient.ts';
import { pharmacyDispensations } from './inventory.ts';
import { labOrders, labResults, labTests, radiologyOrders } from './laboratory.ts';
import { patientIdentifiers, patients, practitioners } from './patients.ts';
import { departments, facilities, tenants } from './tenancy.ts';

export const practitionersRelations = relations(practitioners, ({ one }) => ({
  tenant: one(tenants, {
    fields: [practitioners.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [practitioners.facilityId],
    references: [facilities.id],
  }),

  user: one(users, {
    fields: [practitioners.userId],
    references: [users.id],
  }),

  department: one(departments, {
    fields: [practitioners.departmentId],
    references: [departments.id],
  }),
}));

export const patientsRelations = relations(patients, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [patients.tenantId],
    references: [tenants.id],
  }),

  registrationFacility: one(facilities, {
    fields: [patients.registrationFacilityId],
    references: [facilities.id],
  }),

  encounters: many(encounters),

  appointments: many(appointments),

  invoices: many(billingInvoices),

  admissions: many(admissions),

  identifiers: many(patientIdentifiers),
}));

export const patientIdentifiersRelations = relations(patientIdentifiers, ({ one }) => ({
  patient: one(patients, {
    fields: [patientIdentifiers.patientId],
    references: [patients.id],
  }),
}));

export const encountersRelations = relations(encounters, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [encounters.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [encounters.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [encounters.patientId],
    references: [patients.id],
  }),

  practitioner: one(practitioners, {
    fields: [encounters.practitionerId],
    references: [practitioners.id],
  }),

  department: one(departments, {
    fields: [encounters.departmentId],
    references: [departments.id],
  }),

  observations: many(observations),

  diagnoses: many(diagnoses),

  medications: many(medications),

  labOrders: many(labOrders),
}));

export const observationsRelations = relations(observations, ({ one }) => ({
  encounter: one(encounters, {
    fields: [observations.encounterId],
    references: [encounters.id],
  }),

  patient: one(patients, {
    fields: [observations.patientId],
    references: [patients.id],
  }),
}));

export const diagnosesRelations = relations(diagnoses, ({ one }) => ({
  encounter: one(encounters, {
    fields: [diagnoses.encounterId],
    references: [encounters.id],
  }),

  patient: one(patients, {
    fields: [diagnoses.patientId],
    references: [patients.id],
  }),
}));

export const medicationsRelations = relations(medications, ({ one, many }) => ({
  encounter: one(encounters, {
    fields: [medications.encounterId],
    references: [encounters.id],
  }),

  patient: one(patients, {
    fields: [medications.patientId],
    references: [patients.id],
  }),

  dispensations: many(pharmacyDispensations),
}));

export const wardsRelations = relations(wards, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [wards.facilityId],
    references: [facilities.id],
  }),

  beds: many(beds),

  admissions: many(admissions),
}));

export const bedsRelations = relations(beds, ({ one }) => ({
  ward: one(wards, {
    fields: [beds.wardId],
    references: [wards.id],
  }),

  currentPatient: one(patients, {
    fields: [beds.currentPatientId],
    references: [patients.id],
  }),
}));

export const admissionsRelations = relations(admissions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [admissions.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [admissions.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [admissions.patientId],
    references: [patients.id],
  }),

  encounter: one(encounters, {
    fields: [admissions.encounterId],
    references: [encounters.id],
  }),

  ward: one(wards, {
    fields: [admissions.wardId],
    references: [wards.id],
  }),

  bed: one(beds, {
    fields: [admissions.bedId],
    references: [beds.id],
  }),
}));

export const theatreCasesRelations = relations(theatreCases, ({ one }) => ({
  tenant: one(tenants, {
    fields: [theatreCases.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [theatreCases.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [theatreCases.patientId],
    references: [patients.id],
  }),
}));

export const labTestsRelations = relations(labTests, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [labTests.facilityId],
    references: [facilities.id],
  }),

  orders: many(labOrders),
}));

export const labOrdersRelations = relations(labOrders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [labOrders.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [labOrders.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [labOrders.patientId],
    references: [patients.id],
  }),

  encounter: one(encounters, {
    fields: [labOrders.encounterId],
    references: [encounters.id],
  }),

  test: one(labTests, {
    fields: [labOrders.testId],
    references: [labTests.id],
  }),

  results: many(labResults),
}));

export const labResultsRelations = relations(labResults, ({ one }) => ({
  order: one(labOrders, {
    fields: [labResults.orderId],
    references: [labOrders.id],
  }),

  patient: one(patients, {
    fields: [labResults.patientId],
    references: [patients.id],
  }),
}));

export const radiologyOrdersRelations = relations(radiologyOrders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [radiologyOrders.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [radiologyOrders.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [radiologyOrders.patientId],
    references: [patients.id],
  }),

  encounter: one(encounters, {
    fields: [radiologyOrders.encounterId],
    references: [encounters.id],
  }),
}));
