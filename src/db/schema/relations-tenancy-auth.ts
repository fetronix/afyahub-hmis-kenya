/**
 * JaliCare HMIS — relations tenancy auth schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import { relations } from 'drizzle-orm';
import {
  facilityAdminInvitations,
  loginAttempts,
  passwordResets,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userInvitations,
  userRoles,
  users,
} from './auth.ts';
import { encounters } from './clinical.ts';
import { wards } from './inpatient.ts';
import { inventoryItems } from './inventory.ts';
import { labTests } from './laboratory.ts';
import { patients, practitioners } from './patients.ts';
import {
  departments,
  facilities,
  facilityDocuments,
  facilityOnboarding,
  tenants,
} from './tenancy.ts';

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
