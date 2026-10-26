/**
 * Schema — identity, roles and invitations
 *
 * Twelve tables covering "who is this and what may they do":
 * accounts, the role and permission catalogue that authorises them,
 * the sessions they hold, the attempt counters that lock them out, and the
 * invitations that create them.
 *
 * DEPENDS ON TENANCY
 *
 * `users` and the invitation tables carry tenant and facility foreign keys,
 * so this module imports from `./tenancy.ts`. Tenancy imports from no other
 * module, which is what keeps the graph acyclic — the extraction order in
 * the commit history follows that order deliberately.
 *
 * WHAT MUST NOT CHANGE
 *
 * Table names, column names, constraints and indexes are unchanged. This is
 * a file move. The migrations in `drizzle/` are untouched, and the exported
 * interface is preserved through the barrel at `src/db/schema.ts`.
 *
 * Extracted from `src/db/schema.ts`, auth domain, second of thirteen.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

import { facilities, tenants } from './tenancy.ts';

export const roles = pgTable(
  'roles',
  {
    id: serial('id').primaryKey(),

    /*
      NULL tenantId means this is a platform/system role.
      Example:
      SUPER_ADMIN
    */

    tenantId: integer('tenant_id').references(() => tenants.id),

    name: text('name').notNull(),

    description: text('description'),

    isSystem: boolean('is_system').default(false).notNull(),

    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantRoleIdx: uniqueIndex('roles_tenant_name_idx').on(table.tenantId, table.name),
  }),
);

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),

  code: text('code').notNull().unique(),

  name: text('name').notNull(),

  module: text('module').notNull(),

  description: text('description'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: serial('id').primaryKey(),

    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),

    permissionId: integer('permission_id')
      .references(() => permissions.id)
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    rolePermissionIdx: uniqueIndex('role_permissions_role_permission_idx').on(
      table.roleId,
      table.permissionId,
    ),
  }),
);

export const facilityRolePermissionOverrides = pgTable(
  'facility_role_permission_overrides',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityRoleIdx: uniqueIndex('facility_role_permission_overrides_facility_role_idx').on(
      table.facilityId,
      table.roleId,
    ),
    tenantFacilityIdx: index('facility_role_permission_overrides_tenant_facility_idx').on(
      table.tenantId,
      table.facilityId,
    ),
  }),
);

export const facilityRolePermissionOverridePermissions = pgTable(
  'facility_role_permission_override_permissions',
  {
    id: serial('id').primaryKey(),
    overrideId: integer('override_id')
      .references(() => facilityRolePermissionOverrides.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: integer('permission_id')
      .references(() => permissions.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    overridePermissionIdx: uniqueIndex(
      'facility_role_permission_override_permissions_override_permission_idx',
    ).on(table.overrideId, table.permissionId),
  }),
);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),

    /*
      Internal immutable JaliCare user identifier.

      Example:
      usr_01HXYZ...
    */

    uid: text('uid').notNull().unique(),

    tenantId: integer('tenant_id').references(() => tenants.id),

    facilityId: integer('facility_id').references(() => facilities.id),

    /*
      Login username.
      Normalized to lowercase by application code.
    */

    username: text('username').notNull().unique(),

    /*
      Email is also normalized by application code.
    */

    email: text('email').notNull().unique(),

    emailVerifiedAt: timestamp('email_verified_at'),

    fullName: text('full_name').notNull(),

    phone: text('phone'),

    phoneVerifiedAt: timestamp('phone_verified_at'),

    designation: text('designation'),

    /*
      Argon2id password hash.

      NEVER store plaintext passwords.
    */

    passwordHash: text('password_hash'),

    passwordChangedAt: timestamp('password_changed_at'),

    mustChangePassword: boolean('must_change_password').default(false).notNull(),

    /*
      Account lifecycle.

      PENDING
      ACTIVE
      LOCKED
      SUSPENDED
      DISABLED
    */

    accountStatus: text('account_status').default('PENDING').notNull(),

    /*
      Brute-force protection.
    */

    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),

    lastFailedLoginAt: timestamp('last_failed_login_at'),

    lockedUntil: timestamp('locked_until'),

    lastLoginAt: timestamp('last_login_at'),

    lastLoginIp: text('last_login_ip'),

    lastLogoutAt: timestamp('last_logout_at'),

    /*
      MFA readiness.
    */

    mfaEnabled: boolean('mfa_enabled').default(false).notNull(),

    mfaRequired: boolean('mfa_required').default(false).notNull(),

    /*
      Store encrypted MFA secret only if/when MFA is implemented.
      NEVER store raw secrets.
    */

    mfaSecretEncrypted: text('mfa_secret_encrypted'),

    /*
      Used to invalidate old authentication credentials/sessions
      after important security changes.
    */

    securityVersion: integer('security_version').default(1).notNull(),

    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),

    deactivatedAt: timestamp('deactivated_at'),

    deactivationReason: text('deactivation_reason'),
  },
  (table) => ({
    usernameIdx: uniqueIndex('users_username_idx').on(table.username),

    emailIdx: uniqueIndex('users_email_idx').on(table.email),

    tenantIdx: index('users_tenant_idx').on(table.tenantId),

    facilityIdx: index('users_facility_idx').on(table.facilityId),

    accountStatusIdx: index('users_account_status_idx').on(table.accountStatus),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),

    assignedBy: text('assigned_by'),

    assignedAt: timestamp('assigned_at').defaultNow().notNull(),

    revokedAt: timestamp('revoked_at'),

    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => ({
    userRoleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),

    userIdx: index('user_roles_user_idx').on(table.userId),

    roleIdx: index('user_roles_role_idx').on(table.roleId),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /*
      Store ONLY a hash of the session token.

      The actual token exists only in the user's browser cookie.
    */

    sessionTokenHash: text('session_token_hash').notNull().unique(),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),

    expiresAt: timestamp('expires_at').notNull(),

    revokedAt: timestamp('revoked_at'),

    revokeReason: text('revoke_reason'),

    /*
      Security version at session creation.
      If user.securityVersion changes, sessions can be rejected.
    */

    securityVersion: integer('security_version').default(1).notNull(),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),

    expiryIdx: index('sessions_expiry_idx').on(table.expiresAt),

    activeSessionIdx: index('sessions_active_idx').on(table.userId, table.revokedAt),
  }),
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: serial('id').primaryKey(),

    /*
      Do not necessarily store the raw login identifier if
      privacy requirements later require hashing it.
    */

    usernameOrEmail: text('username_or_email').notNull(),

    userId: integer('user_id').references(() => users.id),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    successful: boolean('successful').default(false).notNull(),

    failureReason: text('failure_reason'),

    attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
  },
  (table) => ({
    userAttemptIdx: index('login_attempts_user_idx').on(table.userId),

    ipAttemptIdx: index('login_attempts_ip_idx').on(table.ipAddress),

    timeIdx: index('login_attempts_time_idx').on(table.attemptedAt),
  }),
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /*
      Store only a hash of the reset token.
    */

    tokenHash: text('token_hash').notNull().unique(),

    expiresAt: timestamp('expires_at').notNull(),

    usedAt: timestamp('used_at'),

    requestedIp: text('requested_ip'),

    requestedUserAgent: text('requested_user_agent'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('password_resets_user_idx').on(table.userId),

    expiryIdx: index('password_resets_expiry_idx').on(table.expiresAt),
  }),
);

export const facilityAdminInvitations = pgTable(
  'facility_admin_invitations',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    email: text('email').notNull(),

    fullName: text('full_name').notNull(),

    phone: text('phone'),

    designation: text('designation').default('Facility Administrator'),

    /*
      Hash only.
      The actual invitation token is sent to the recipient.
    */

    invitationTokenHash: text('invitation_token_hash').notNull().unique(),

    expiresAt: timestamp('expires_at').notNull(),

    acceptedAt: timestamp('accepted_at'),

    acceptedUserId: integer('accepted_user_id').references(() => users.id),

    invitedBy: text('invited_by').notNull(),

    revokedAt: timestamp('revoked_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: index('facility_admin_invitations_facility_idx').on(table.facilityId),

    emailIdx: index('facility_admin_invitations_email_idx').on(table.email),

    expiryIdx: index('facility_admin_invitations_expiry_idx').on(table.expiresAt),
  }),
);

export const userInvitations = pgTable(
  'user_invitations',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    email: text('email').notNull(),

    fullName: text('full_name').notNull(),

    phone: text('phone'),

    designation: text('designation'),

    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),

    invitationTokenHash: text('invitation_token_hash').notNull().unique(),

    expiresAt: timestamp('expires_at').notNull(),

    acceptedAt: timestamp('accepted_at'),

    acceptedUserId: integer('accepted_user_id').references(() => users.id),

    invitedBy: text('invited_by').notNull(),

    revokedAt: timestamp('revoked_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: index('user_invitations_facility_idx').on(table.facilityId),

    emailIdx: index('user_invitations_email_idx').on(table.email),

    expiryIdx: index('user_invitations_expiry_idx').on(table.expiresAt),
  }),
);
