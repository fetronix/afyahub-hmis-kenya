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
  index,
} from 'drizzle-orm/pg-core';

/*
 * Domain modules
 * --------------
 * Tables are extracted one domain at a time. They are imported here so the
 * relations below can reference them, and re-exported so that every existing
 * `import * as schema from './db/schema.ts'` keeps working untouched.
 *
 * The re-export is deliberate and load-bearing: 27 files do `schema.tenants`,
 * `schema.patients` and so on, and `drizzle.config.ts` points at this file.
 * Moving the barrel would silently give drizzle-kit an empty schema.
 */
import {
  departments,
  facilityDocuments,
  facilityOnboarding,
  facilitySubscriptionAccess,
  facilitySubscriptionPayments,
  facilitySubscriptionPeriods,
  facilitySubscriptionPriceChanges,
  facilities,
  tenants,
} from './schema/tenancy.ts';

export {
  departments,
  facilityDocuments,
  facilityOnboarding,
  facilitySubscriptionAccess,
  facilitySubscriptionPayments,
  facilitySubscriptionPeriods,
  facilitySubscriptionPriceChanges,
  facilities,
  tenants,
} from './schema/tenancy.ts';

import {
  facilityAdminInvitations,
  facilityRolePermissionOverridePermissions,
  facilityRolePermissionOverrides,
  loginAttempts,
  passwordResets,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userInvitations,
  userRoles,
  users,
} from './schema/auth.ts';

export {
  facilityAdminInvitations,
  facilityRolePermissionOverridePermissions,
  facilityRolePermissionOverrides,
  loginAttempts,
  passwordResets,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userInvitations,
  userRoles,
  users,
} from './schema/auth.ts';

import { relations, sql } from 'drizzle-orm';

/* ============================================================
   JALICARE HMIS
   Database Schema
   Multi-Tenant Healthcare Management Platform
   ============================================================

   Authentication architecture:
   - PostgreSQL-backed authentication
   - Argon2id password hashes
   - Secure database sessions
   - Login attempt tracking
   - Account lockout
   - Password reset tokens
   - Facility onboarding
   - Facility administrator invitations
   - Staff invitations
   - RBAC / permissions
   - Professional credential verification
   - Audit logging

   IMPORTANT:
   Passwords, session tokens and reset tokens must NEVER be
   stored in plaintext.
   ============================================================ */

/* ============================================================
   1. TENANTS
   ============================================================ */

/* ============================================================
   2. HEALTHCARE FACILITIES
   ============================================================ */

/* ============================================================
   3. FACILITY ONBOARDING
   Platform Administrator controls this process.
   ============================================================ */

/* ============================================================
   4. FACILITY ONBOARDING DOCUMENTS
   ============================================================ */

/* ============================================================
   5. DEPARTMENTS
   ============================================================ */

/* ============================================================
   6. ROLES
   ============================================================ */

/* ============================================================
   7. PERMISSIONS
   ============================================================ */

/* ============================================================
   8. ROLE PERMISSIONS
   ============================================================ */

/* ============================================================
   9. USERS
   PostgreSQL-backed authentication
   ============================================================ */

/* ============================================================
   10. USER ROLES
   ============================================================ */

/* ============================================================
   11. SECURE USER SESSIONS
   ============================================================ */

/* ============================================================
   12. LOGIN ATTEMPTS
   ============================================================ */

/* ============================================================
   13. PASSWORD RESET TOKENS
   ============================================================ */

/* ============================================================
   14. FACILITY ADMIN INVITATIONS
   ============================================================ */

/* ============================================================
   15. STAFF INVITATIONS
   ============================================================ */

/* ============================================================
   16. PRACTITIONERS
   ============================================================ */

/* ============================================================
   TABLE DOMAINS
   ============================================================

/* Re-exported so the barrel keeps its promise: 27 files do `schema.tenants`,
   `schema.patients` and so on, and drizzle.config.ts points at this file.
   Moving the barrel, or dropping a re-export here, silently gives drizzle-kit
   an empty or partial schema. */

import {
  practitioners,
  patients,
  patientAllergies,
  patientFacilities,
  patientAccounts,
  patientIdentifiers,
  patientConsents,
  patientRecordAccessLogs,
} from './schema/patients.ts';

export {
  practitioners,
  patients,
  patientAllergies,
  patientFacilities,
  patientAccounts,
  patientIdentifiers,
  patientConsents,
  patientRecordAccessLogs,
} from './schema/patients.ts';

import {
  referrals,
  referralDocuments,
  referralAccessLogs,
  healthRecordExports,
  healthRecordImports,
} from './schema/referrals.ts';

export {
  referrals,
  referralDocuments,
  referralAccessLogs,
  healthRecordExports,
  healthRecordImports,
} from './schema/referrals.ts';

import {
  encounters,
  appointments,
  queues,
  observations,
  diagnoses,
  clinicalProcedures,
} from './schema/clinical.ts';

export {
  encounters,
  appointments,
  queues,
  observations,
  diagnoses,
  clinicalProcedures,
} from './schema/clinical.ts';

import {
  medications,
  wards,
  beds,
  admissions,
  admissionTransfers,
  nursingNotes,
  theatreCases,
} from './schema/inpatient.ts';

export {
  medications,
  wards,
  beds,
  admissions,
  admissionTransfers,
  nursingNotes,
  theatreCases,
} from './schema/inpatient.ts';

import { labTests, labOrders, labResults, radiologyOrders } from './schema/laboratory.ts';

export { labTests, labOrders, labResults, radiologyOrders } from './schema/laboratory.ts';

import {
  inventoryItems,
  inventoryBatches,
  pharmacyDispensations,
  suppliers,
  purchaseOrders,
} from './schema/inventory.ts';

export {
  inventoryItems,
  inventoryBatches,
  pharmacyDispensations,
  suppliers,
  purchaseOrders,
} from './schema/inventory.ts';

import {
  facilityServiceTariffs,
  billingInvoices,
  billingItems,
  serviceTariffLinks,
  billingChargeAttempts,
  billingPayments,
  insuranceClaims,
  insuranceClaimItems,
} from './schema/billing.ts';

export {
  facilityServiceTariffs,
  billingInvoices,
  billingItems,
  serviceTariffLinks,
  billingChargeAttempts,
  billingPayments,
  insuranceClaims,
  insuranceClaimItems,
} from './schema/billing.ts';

import { publicHealthReports, auditLogs } from './schema/public-health.ts';

export { publicHealthReports, auditLogs } from './schema/public-health.ts';

import {
  maternityPregnancies,
  ancVisits,
  labourRecords,
  partographEntries,
  deliveries,
  deliveryBabies,
  postnatalVisits,
  immunisationRecords,
} from './schema/maternity.ts';

export {
  maternityPregnancies,
  ancVisits,
  labourRecords,
  partographEntries,
  deliveries,
  deliveryBabies,
  postnatalVisits,
  immunisationRecords,
} from './schema/maternity.ts';

import {
  staffProfessionalCredentials,
  professionalVerificationEvents,
  dhaServiceMappings,
  dhaApiCalls,
  patientPortalAccounts,
  patientPortalInvitations,
  patientPortalInvitationEvents,
  patientPortalSessions,
  patientPortalSettings,
  patientRecordSharingGrants,
} from './schema/platform.ts';

export {
  staffProfessionalCredentials,
  professionalVerificationEvents,
  dhaServiceMappings,
  dhaApiCalls,
  patientPortalAccounts,
  patientPortalInvitations,
  patientPortalInvitationEvents,
  patientPortalSessions,
  patientPortalSettings,
  patientRecordSharingGrants,
} from './schema/platform.ts';

/* ============================================================
   45. RELATIONS
   ============================================================ */

export const tenantsRelations = relations(tenants, ({ many }) => ({
  facilities: many(facilities),

  users: many(users),

  roles: many(roles),

  patients: many(patients),

  onboardingRecords: many(facilityOnboarding),
}));

export const facilitiesRelations = relations(facilities, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [facilities.tenantId],
    references: [tenants.id],
  }),

  departments: many(departments),

  users: many(users),

  patients: many(patients),

  wards: many(wards),

  practitioners: many(practitioners),

  onboarding: many(facilityOnboarding),

  documents: many(facilityDocuments),

  adminInvitations: many(facilityAdminInvitations),

  userInvitations: many(userInvitations),

  labTests: many(labTests),

  inventoryItems: many(inventoryItems),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [departments.facilityId],
    references: [facilities.id],
  }),

  practitioners: many(practitioners),

  encounters: many(encounters),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [roles.tenantId],
    references: [tenants.id],
  }),

  permissions: many(rolePermissions),

  users: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),

  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [users.facilityId],
    references: [facilities.id],
  }),

  roles: many(userRoles),

  sessions: many(sessions),

  loginAttempts: many(loginAttempts),

  passwordResets: many(passwordResets),

  practitioners: many(practitioners),

  facilityAdminInvitations: many(facilityAdminInvitations),

  userInvitations: many(userInvitations),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),

  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const loginAttemptsRelations = relations(loginAttempts, ({ one }) => ({
  user: one(users, {
    fields: [loginAttempts.userId],
    references: [users.id],
  }),
}));

export const passwordResetsRelations = relations(passwordResets, ({ one }) => ({
  user: one(users, {
    fields: [passwordResets.userId],
    references: [users.id],
  }),
}));

export const facilityOnboardingRelations = relations(facilityOnboarding, ({ one }) => ({
  tenant: one(tenants, {
    fields: [facilityOnboarding.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [facilityOnboarding.facilityId],
    references: [facilities.id],
  }),
}));

export const facilityDocumentsRelations = relations(facilityDocuments, ({ one }) => ({
  facility: one(facilities, {
    fields: [facilityDocuments.facilityId],
    references: [facilities.id],
  }),
}));

export const facilityAdminInvitationsRelations = relations(facilityAdminInvitations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [facilityAdminInvitations.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [facilityAdminInvitations.facilityId],
    references: [facilities.id],
  }),

  acceptedUser: one(users, {
    fields: [facilityAdminInvitations.acceptedUserId],
    references: [users.id],
  }),
}));

export const userInvitationsRelations = relations(userInvitations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [userInvitations.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [userInvitations.facilityId],
    references: [facilities.id],
  }),

  role: one(roles, {
    fields: [userInvitations.roleId],
    references: [roles.id],
  }),

  acceptedUser: one(users, {
    fields: [userInvitations.acceptedUserId],
    references: [users.id],
  }),
}));

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

export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [inventoryItems.facilityId],
    references: [facilities.id],
  }),

  batches: many(inventoryBatches),

  dispensations: many(pharmacyDispensations),
}));

export const inventoryBatchesRelations = relations(inventoryBatches, ({ one }) => ({
  item: one(inventoryItems, {
    fields: [inventoryBatches.itemId],
    references: [inventoryItems.id],
  }),
}));

export const pharmacyDispensationsRelations = relations(pharmacyDispensations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [pharmacyDispensations.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [pharmacyDispensations.facilityId],
    references: [facilities.id],
  }),

  prescription: one(medications, {
    fields: [pharmacyDispensations.prescriptionId],
    references: [medications.id],
  }),

  patient: one(patients, {
    fields: [pharmacyDispensations.patientId],
    references: [patients.id],
  }),

  item: one(inventoryItems, {
    fields: [pharmacyDispensations.itemId],
    references: [inventoryItems.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [suppliers.tenantId],
    references: [tenants.id],
  }),

  purchaseOrders: many(purchaseOrders),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [purchaseOrders.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [purchaseOrders.facilityId],
    references: [facilities.id],
  }),

  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
}));

export const billingInvoicesRelations = relations(billingInvoices, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [billingInvoices.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [billingInvoices.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [billingInvoices.patientId],
    references: [patients.id],
  }),

  encounter: one(encounters, {
    fields: [billingInvoices.encounterId],
    references: [encounters.id],
  }),

  items: many(billingItems),

  payments: many(billingPayments),

  claims: many(insuranceClaims),
}));

export const billingItemsRelations = relations(billingItems, ({ one }) => ({
  invoice: one(billingInvoices, {
    fields: [billingItems.invoiceId],
    references: [billingInvoices.id],
  }),
}));

export const billingPaymentsRelations = relations(billingPayments, ({ one }) => ({
  invoice: one(billingInvoices, {
    fields: [billingPayments.invoiceId],
    references: [billingInvoices.id],
  }),
}));

export const insuranceClaimsRelations = relations(insuranceClaims, ({ one }) => ({
  tenant: one(tenants, {
    fields: [insuranceClaims.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [insuranceClaims.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [insuranceClaims.patientId],
    references: [patients.id],
  }),

  invoice: one(billingInvoices, {
    fields: [insuranceClaims.invoiceId],
    references: [billingInvoices.id],
  }),
}));

export const publicHealthReportsRelations = relations(publicHealthReports, ({ one }) => ({
  facility: one(facilities, {
    fields: [publicHealthReports.facilityId],
    references: [facilities.id],
  }),
}));

/* ============================================================
   END OF JALICARE SCHEMA
   ============================================================ */

/* ============================================================
   DHA / AFYACONNECT INTEGRATION AUDIT
   ============================================================ */

/**
 * One row per outbound call to the national health exchange.
 *
 * No request body, response body, token or patient identifier is stored
 * here. The path is templated at the call site.
 */
/* ============================================================
   PROFESSIONAL CREDENTIAL VERIFICATION
   ============================================================ */

/**
 * A professional registration, as verified against a regulator source.
 *
 * Independent of `users`, `userInvitations` and role assignment: losing a
 * licence does not delete an account, and a verified licence does not
 * grant a privilege. The status here is one of the values in
 * practitioner.contracts.ts.
 *
 * Data minimisation: no national ID, no date of birth, no contact
 * details. The registration number is retained because the whole point is
 * to be able to show, later, what was checked.
 */
