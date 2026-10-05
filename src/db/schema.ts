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

import { relations } from 'drizzle-orm';

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

export const tenants = pgTable(
  'tenants',
  {
    id: serial('id').primaryKey(),

    name: text('name').notNull(),

    slug: text('slug').notNull().unique(),

    domain: text('domain'),

    logoUrl: text('logo_url'),

    brandColor: text('brand_color').default('#0f766e'),

    contactEmail: text('contact_email'),

    contactPhone: text('contact_phone'),

    currency: text('currency').default('KES'),

    timezone: text('timezone').default('Africa/Nairobi'),

    settings: jsonb('settings').default({}),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('tenants_slug_idx').on(table.slug),
  }),
);


/* ============================================================
   2. HEALTHCARE FACILITIES
   ============================================================ */

export const facilities = pgTable(
  'facilities',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    code: text('code').notNull(),

    name: text('name').notNull(),

    level: text('level').default('Level 4'),

    county: text('county').default('Nairobi'),

    subCounty: text('sub_county').default('Westlands'),

    mflCode: text('mfl_code'),

    address: text('address'),

    phone: text('phone'),

    email: text('email'),

    enabledModules: jsonb('enabled_modules').default([
      'registration',
      'reception',
      'opd',
      'inpatient',
      'theatre',
      'specialty',
      'laboratory',
      'radiology',
      'pharmacy',
      'inventory',
      'procurement',
      'finance',
      'insurance',
      'public_health',
      'analytics',
      'interoperability',
      'configuration',
      'audit',
    ]),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantCodeIdx: uniqueIndex('facilities_tenant_code_idx').on(
      table.tenantId,
      table.code,
    ),

    mflCodeIdx: uniqueIndex('facilities_mfl_code_idx').on(
      table.mflCode,
    ),
  }),
);


/* ============================================================
   3. FACILITY ONBOARDING
   Platform Administrator controls this process.
   ============================================================ */

export const facilityOnboarding = pgTable(
  'facility_onboarding',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    status: text('status')
      .default('PROSPECT')
      .notNull(),

    /*
      PROSPECT
      PENDING_VERIFICATION
      VERIFIED
      INVITED
      ACTIVATING
      ACTIVE
      SUSPENDED
      DEACTIVATED
    */

    submittedBy: text('submitted_by'),

    verifiedBy: text('verified_by'),

    approvedBy: text('approved_by'),

    submittedAt: timestamp('submitted_at'),

    verifiedAt: timestamp('verified_at'),

    approvedAt: timestamp('approved_at'),

    activatedAt: timestamp('activated_at'),

    suspendedAt: timestamp('suspended_at'),

    deactivatedAt: timestamp('deactivated_at'),

    suspensionReason: text('suspension_reason'),

    rejectionReason: text('rejection_reason'),

    notes: text('notes'),

    metadata: jsonb('metadata').default({}),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: uniqueIndex(
      'facility_onboarding_facility_idx',
    ).on(table.facilityId),

    tenantStatusIdx: index(
      'facility_onboarding_tenant_status_idx',
    ).on(table.tenantId, table.status),
  }),
);


/* ============================================================
   4. FACILITY ONBOARDING DOCUMENTS
   ============================================================ */

export const facilityDocuments = pgTable(
  'facility_documents',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    documentType: text('document_type').notNull(),

    /*
      Examples:
      - LICENSE
      - REGISTRATION_CERTIFICATE
      - MFL_DOCUMENT
      - KRA_DOCUMENT
      - OWNERSHIP_DOCUMENT
      - FACILITY_ADMIN_ID
      - OTHER
    */

    documentName: text('document_name').notNull(),

    documentUrl: text('document_url'),

    storageKey: text('storage_key'),

    mimeType: text('mime_type'),

    fileSize: integer('file_size'),

    documentHash: text('document_hash'),

    verificationStatus: text('verification_status')
      .default('PENDING')
      .notNull(),

    /*
      PENDING
      VERIFIED
      REJECTED
    */

    uploadedBy: text('uploaded_by'),

    verifiedBy: text('verified_by'),

    uploadedAt: timestamp('uploaded_at')
      .defaultNow()
      .notNull(),

    verifiedAt: timestamp('verified_at'),

    rejectionReason: text('rejection_reason'),

    metadata: jsonb('metadata').default({}),
  },
  (table) => ({
    facilityIdx: index(
      'facility_documents_facility_idx',
    ).on(table.facilityId),

    verificationIdx: index(
      'facility_documents_verification_idx',
    ).on(table.verificationStatus),
  }),
);


/* ============================================================
   5. DEPARTMENTS
   ============================================================ */

export const departments = pgTable(
  'departments',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    name: text('name').notNull(),

    code: text('code').notNull(),

    type: text('type').default('clinical'),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex(
      'departments_facility_code_idx',
    ).on(table.facilityId, table.code),
  }),
);


/* ============================================================
   6. ROLES
   ============================================================ */

export const roles = pgTable(
  'roles',
  {
    id: serial('id').primaryKey(),

    /*
      NULL tenantId means this is a platform/system role.
      Example:
      SUPER_ADMIN
    */

    tenantId: integer('tenant_id')
      .references(() => tenants.id),

    name: text('name').notNull(),

    description: text('description'),

    isSystem: boolean('is_system')
      .default(false)
      .notNull(),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantRoleIdx: uniqueIndex(
      'roles_tenant_name_idx',
    ).on(table.tenantId, table.name),
  }),
);


/* ============================================================
   7. PERMISSIONS
   ============================================================ */

export const permissions = pgTable(
  'permissions',
  {
    id: serial('id').primaryKey(),

    code: text('code').notNull().unique(),

    name: text('name').notNull(),

    module: text('module').notNull(),

    description: text('description'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
);


/* ============================================================
   8. ROLE PERMISSIONS
   ============================================================ */

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

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    rolePermissionIdx: uniqueIndex(
      'role_permissions_role_permission_idx',
    ).on(table.roleId, table.permissionId),
  }),
);


/* ============================================================
   9. USERS
   PostgreSQL-backed authentication
   ============================================================ */

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),

    /*
      Internal immutable JaliCare user identifier.

      Example:
      usr_01HXYZ...
    */

    uid: text('uid')
      .notNull()
      .unique(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id),

    facilityId: integer('facility_id')
      .references(() => facilities.id),

    /*
      Login username.
      Normalized to lowercase by application code.
    */

    username: text('username')
      .notNull()
      .unique(),

    /*
      Email is also normalized by application code.
    */

    email: text('email')
      .notNull()
      .unique(),

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

    mustChangePassword: boolean('must_change_password')
      .default(false)
      .notNull(),

    /*
      Account lifecycle.

      PENDING
      ACTIVE
      LOCKED
      SUSPENDED
      DISABLED
    */

    accountStatus: text('account_status')
      .default('PENDING')
      .notNull(),

    /*
      Brute-force protection.
    */

    failedLoginAttempts: integer('failed_login_attempts')
      .default(0)
      .notNull(),

    lastFailedLoginAt: timestamp('last_failed_login_at'),

    lockedUntil: timestamp('locked_until'),

    lastLoginAt: timestamp('last_login_at'),

    lastLoginIp: text('last_login_ip'),

    lastLogoutAt: timestamp('last_logout_at'),

    /*
      MFA readiness.
    */

    mfaEnabled: boolean('mfa_enabled')
      .default(false)
      .notNull(),

    mfaRequired: boolean('mfa_required')
      .default(false)
      .notNull(),

    /*
      Store encrypted MFA secret only if/when MFA is implemented.
      NEVER store raw secrets.
    */

    mfaSecretEncrypted: text('mfa_secret_encrypted'),

    /*
      Used to invalidate old authentication credentials/sessions
      after important security changes.
    */

    securityVersion: integer('security_version')
      .default(1)
      .notNull(),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),

    deactivatedAt: timestamp('deactivated_at'),

    deactivationReason: text('deactivation_reason'),
  },
  (table) => ({
    usernameIdx: uniqueIndex(
      'users_username_idx',
    ).on(table.username),

    emailIdx: uniqueIndex(
      'users_email_idx',
    ).on(table.email),

    tenantIdx: index(
      'users_tenant_idx',
    ).on(table.tenantId),

    facilityIdx: index(
      'users_facility_idx',
    ).on(table.facilityId),

    accountStatusIdx: index(
      'users_account_status_idx',
    ).on(table.accountStatus),
  }),
);


/* ============================================================
   10. USER ROLES
   ============================================================ */

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

    assignedAt: timestamp('assigned_at')
      .defaultNow()
      .notNull(),

    revokedAt: timestamp('revoked_at'),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),
  },
  (table) => ({
    userRoleIdx: uniqueIndex(
      'user_roles_user_role_idx',
    ).on(table.userId, table.roleId),

    userIdx: index(
      'user_roles_user_idx',
    ).on(table.userId),

    roleIdx: index(
      'user_roles_role_idx',
    ).on(table.roleId),
  }),
);


/* ============================================================
   11. SECURE USER SESSIONS
   ============================================================ */

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

    sessionTokenHash: text('session_token_hash')
      .notNull()
      .unique(),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    lastActivityAt: timestamp('last_activity_at')
      .defaultNow()
      .notNull(),

    expiresAt: timestamp('expires_at')
      .notNull(),

    revokedAt: timestamp('revoked_at'),

    revokeReason: text('revoke_reason'),

    /*
      Security version at session creation.
      If user.securityVersion changes, sessions can be rejected.
    */

    securityVersion: integer('security_version')
      .default(1)
      .notNull(),
  },
  (table) => ({
    userIdx: index(
      'sessions_user_idx',
    ).on(table.userId),

    expiryIdx: index(
      'sessions_expiry_idx',
    ).on(table.expiresAt),

    activeSessionIdx: index(
      'sessions_active_idx',
    ).on(table.userId, table.revokedAt),
  }),
);


/* ============================================================
   12. LOGIN ATTEMPTS
   ============================================================ */

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: serial('id').primaryKey(),

    /*
      Do not necessarily store the raw login identifier if
      privacy requirements later require hashing it.
    */

    usernameOrEmail: text('username_or_email')
      .notNull(),

    userId: integer('user_id')
      .references(() => users.id),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    successful: boolean('successful')
      .default(false)
      .notNull(),

    failureReason: text('failure_reason'),

    attemptedAt: timestamp('attempted_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userAttemptIdx: index(
      'login_attempts_user_idx',
    ).on(table.userId),

    ipAttemptIdx: index(
      'login_attempts_ip_idx',
    ).on(table.ipAddress),

    timeIdx: index(
      'login_attempts_time_idx',
    ).on(table.attemptedAt),
  }),
);


/* ============================================================
   13. PASSWORD RESET TOKENS
   ============================================================ */

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

    tokenHash: text('token_hash')
      .notNull()
      .unique(),

    expiresAt: timestamp('expires_at')
      .notNull(),

    usedAt: timestamp('used_at'),

    requestedIp: text('requested_ip'),

    requestedUserAgent: text('requested_user_agent'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index(
      'password_resets_user_idx',
    ).on(table.userId),

    expiryIdx: index(
      'password_resets_expiry_idx',
    ).on(table.expiresAt),
  }),
);


/* ============================================================
   14. FACILITY ADMIN INVITATIONS
   ============================================================ */

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

    designation: text('designation')
      .default('Facility Administrator'),

    /*
      Hash only.
      The actual invitation token is sent to the recipient.
    */

    invitationTokenHash: text('invitation_token_hash')
      .notNull()
      .unique(),

    expiresAt: timestamp('expires_at')
      .notNull(),

    acceptedAt: timestamp('accepted_at'),

    acceptedUserId: integer('accepted_user_id')
      .references(() => users.id),

    invitedBy: text('invited_by')
      .notNull(),

    revokedAt: timestamp('revoked_at'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    facilityIdx: index(
      'facility_admin_invitations_facility_idx',
    ).on(table.facilityId),

    emailIdx: index(
      'facility_admin_invitations_email_idx',
    ).on(table.email),

    expiryIdx: index(
      'facility_admin_invitations_expiry_idx',
    ).on(table.expiresAt),
  }),
);


/* ============================================================
   15. STAFF INVITATIONS
   ============================================================ */

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

    invitationTokenHash: text('invitation_token_hash')
      .notNull()
      .unique(),

    expiresAt: timestamp('expires_at')
      .notNull(),

    acceptedAt: timestamp('accepted_at'),

    acceptedUserId: integer('accepted_user_id')
      .references(() => users.id),

    invitedBy: text('invited_by')
      .notNull(),

    revokedAt: timestamp('revoked_at'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    facilityIdx: index(
      'user_invitations_facility_idx',
    ).on(table.facilityId),

    emailIdx: index(
      'user_invitations_email_idx',
    ).on(table.email),

    expiryIdx: index(
      'user_invitations_expiry_idx',
    ).on(table.expiresAt),
  }),
);


/* ============================================================
   16. PRACTITIONERS
   ============================================================ */

export const practitioners = pgTable(
  'practitioners',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    userId: integer('user_id')
      .references(() => users.id),

    fullName: text('full_name').notNull(),

    profession: text('profession'),

    /*
      Examples:
      KMPDC
      NCK
      KMLTTB
      KRA / other professional bodies where applicable
    */

    registrationBody: text('registration_body'),

    registrationNumber: text('registration_number'),

    licenseNumber: text('license_number'),

    licenseExpiryDate: text('license_expiry_date'),

    credentialVerificationStatus: text(
      'credential_verification_status',
    )
      .default('PENDING')
      .notNull(),

    /*
      PENDING
      VERIFIED
      REJECTED
      EXPIRED
    */

    credentialVerifiedAt: timestamp(
      'credential_verified_at',
    ),

    credentialVerifiedBy: text(
      'credential_verified_by',
    ),

    credentialVerificationNotes: text(
      'credential_verification_notes',
    ),

    specialty: text('specialty')
      .default('General Medicine'),

    qualification: text('qualification'),

    departmentId: integer('department_id')
      .references(() => departments.id),

    phone: text('phone'),

    email: text('email'),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex(
      'practitioners_user_idx',
    ).on(table.userId),

    facilityLicenseIdx: index(
      'practitioners_facility_license_idx',
    ).on(
      table.facilityId,
      table.licenseNumber,
    ),

    registrationIdx: index(
      'practitioners_registration_idx',
    ).on(
      table.registrationBody,
      table.registrationNumber,
    ),
  }),
);


/* ============================================================
   17. PATIENTS
   ============================================================ */

export const patients = pgTable(
  'patients',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    mrn: text('mrn')
      .notNull()
      .unique(),

    firstName: text('first_name').notNull(),

    lastName: text('last_name').notNull(),

    middleName: text('middle_name'),

    dateOfBirth: text('date_of_birth').notNull(),

    gender: text('gender').notNull(),

    phone: text('phone').notNull(),

    email: text('email'),

    nationalId: text('national_id'),

    shaNumber: text('sha_number'),

    bloodGroup: text('blood_group'),

    maritalStatus: text('marital_status'),

    occupation: text('occupation'),

    county: text('county').default('Nairobi'),

    subCounty: text('sub_county').default('Westlands'),

    residentialAddress: text('residential_address'),

    emergencyContactName: text('emergency_contact_name'),

    emergencyContactPhone: text('emergency_contact_phone'),

    emergencyContactRelationship: text(
      'emergency_contact_relationship',
    ),

    allergies: text('allergies')
      .default('None known'),

    chronicConditions: text('chronic_conditions')
      .default('None known'),

    payerType: text('payer_type')
      .default('Self-Pay'),

    insuranceProvider: text('insurance_provider'),

    policyNumber: text('policy_number'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantFacilityIdx: index(
      'patients_tenant_facility_idx',
    ).on(
      table.tenantId,
      table.facilityId,
    ),

    nationalIdIdx: index(
      'patients_national_id_idx',
    ).on(table.nationalId),

    shaIdx: index(
      'patients_sha_idx',
    ).on(table.shaNumber),
  }),
);


/* ============================================================
   18. PATIENT IDENTIFIERS
   ============================================================ */

export const patientIdentifiers = pgTable(
  'patient_identifiers',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    idType: text('id_type').notNull(),

    idValue: text('id_value').notNull(),

    issuingAuthority: text('issuing_authority')
      .default('Government of Kenya'),

    isPrimary: boolean('is_primary')
      .default(false)
      .notNull(),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    patientIdentifierIdx: index(
      'patient_identifiers_patient_idx',
    ).on(table.patientId),

    typeValueIdx: index(
      'patient_identifiers_type_value_idx',
    ).on(
      table.idType,
      table.idValue,
    ),
  }),
);


/* ============================================================
   19. CLINICAL ENCOUNTERS
   ============================================================ */

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

    practitionerId: integer('practitioner_id')
      .references(() => practitioners.id),

    encounterType: text('encounter_type')
      .default('Outpatient'),

    departmentId: integer('department_id')
      .references(() => departments.id),

    status: text('status')
      .default('Active'),

    triageCategory: text('triage_category')
      .default('Category 3 - Urgent'),

    chiefComplaint: text('chief_complaint'),

    historyOfPresentIllness: text(
      'history_of_present_illness',
    ),

    physicalExamination: text(
      'physical_examination',
    ),

    clinicalNotes: text('clinical_notes'),

    followUpDate: text('follow_up_date'),

    referralFacility: text('referral_facility'),

    startedAt: timestamp('started_at')
      .defaultNow()
      .notNull(),

    endedAt: timestamp('ended_at'),
  },
  (table) => ({
    patientIdx: index(
      'encounters_patient_idx',
    ).on(table.patientId),

    facilityIdx: index(
      'encounters_facility_idx',
    ).on(table.facilityId),

    practitionerIdx: index(
      'encounters_practitioner_idx',
    ).on(table.practitionerId),
  }),
);


/* ============================================================
   20. APPOINTMENTS
   ============================================================ */

export const appointments = pgTable(
  'appointments',
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

    practitionerId: integer('practitioner_id')
      .references(() => practitioners.id),

    departmentId: integer('department_id')
      .references(() => departments.id),

    scheduledTime: text('scheduled_time')
      .notNull(),

    durationMinutes: integer('duration_minutes')
      .default(30),

    appointmentType: text('appointment_type')
      .default('Routine Follow-up'),

    status: text('status')
      .default('Scheduled'),

    reason: text('reason'),

    notes: text('notes'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   21. PATIENT QUEUES
   ============================================================ */

export const queues = pgTable(
  'queues',
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

    encounterId: integer('encounter_id')
      .references(() => encounters.id),

    queueType: text('queue_type').notNull(),

    tokenNumber: text('token_number').notNull(),

    priority: text('priority')
      .default('Normal'),

    status: text('status')
      .default('Waiting'),

    waitingTimeMinutes: integer(
      'waiting_time_minutes',
    ).default(0),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   22. VITAL SIGNS & OBSERVATIONS
   ============================================================ */

export const observations = pgTable(
  'observations',
  {
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

    temperatureC: numeric(
      'temperature_c',
      {
        precision: 4,
        scale: 1,
      },
    ),

    respiratoryRate: integer(
      'respiratory_rate',
    ),

    spo2Percent: integer('spo2_percent'),

    weightKg: numeric(
      'weight_kg',
      {
        precision: 5,
        scale: 1,
      },
    ),

    heightCm: numeric(
      'height_cm',
      {
        precision: 5,
        scale: 1,
      },
    ),

    bmi: numeric(
      'bmi',
      {
        precision: 4,
        scale: 1,
      },
    ),

    bloodGlucoseMmol: numeric(
      'blood_glucose_mmol',
      {
        precision: 4,
        scale: 1,
      },
    ),

    recordedBy: text('recorded_by'),

    recordedAt: timestamp('recorded_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   23. DIAGNOSES
   ============================================================ */

export const diagnoses = pgTable(
  'diagnoses',
  {
    id: serial('id').primaryKey(),

    encounterId: integer('encounter_id')
      .references(() => encounters.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    icd10Code: text('icd10_code').notNull(),

    icd10Description: text(
      'icd10_description',
    ).notNull(),

    diagnosisType: text('diagnosis_type')
      .default('Primary'),

    status: text('status')
      .default('Confirmed'),

    notes: text('notes'),

    diagnosedBy: text('diagnosed_by'),

    diagnosedAt: timestamp('diagnosed_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   24. CLINICAL PROCEDURES
   ============================================================ */

export const clinicalProcedures = pgTable(
  'procedures',
  {
    id: serial('id').primaryKey(),

    encounterId: integer('encounter_id')
      .references(() => encounters.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    procedureCode: text('procedure_code')
      .notNull(),

    procedureName: text('procedure_name')
      .notNull(),

    departmentId: integer('department_id')
      .references(() => departments.id),

    category: text('category')
      .default('Minor OPD'),

    cost: numeric(
      'cost',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    status: text('status')
      .default('Completed'),

    performedBy: text('performed_by'),

    notes: text('notes'),

    performedAt: timestamp('performed_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   25. MEDICATIONS & PRESCRIPTIONS
   ============================================================ */

export const medications = pgTable(
  'medications',
  {
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

    route: text('route')
      .default('Oral'),

    instructions: text('instructions'),

    quantity: integer('quantity')
      .default(1),

    unitPrice: numeric(
      'unit_price',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    status: text('status')
      .default('Prescribed'),

    prescribedBy: text('prescribed_by'),

    prescribedAt: timestamp('prescribed_at')
      .defaultNow()
      .notNull(),
  },
);


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

    wardType: text('ward_type')
      .default('General'),

    genderAllocation: text(
      'gender_allocation',
    ).default('Mixed'),

    totalBeds: integer('total_beds')
      .default(20),

    dailyRate: numeric(
      'daily_rate',
      {
        precision: 10,
        scale: 2,
      },
    ).default('1500.00'),

    isActive: boolean('is_active')
      .default(true),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex(
      'wards_facility_code_idx',
    ).on(
      table.facilityId,
      table.code,
    ),
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

    bedNumber: text('bed_number')
      .notNull(),

    bedType: text('bed_type')
      .default('Standard'),

    status: text('status')
      .default('Available'),

    dailyCharge: numeric(
      'daily_charge',
      {
        precision: 10,
        scale: 2,
      },
    ).default('1500.00'),

    currentPatientId: integer(
      'current_patient_id',
    ).references(() => patients.id),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    wardBedIdx: uniqueIndex(
      'beds_ward_bed_number_idx',
    ).on(
      table.wardId,
      table.bedNumber,
    ),
  }),
);


/* ============================================================
   28. INPATIENT ADMISSIONS
   ============================================================ */

export const admissions = pgTable(
  'admissions',
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

    encounterId: integer('encounter_id')
      .references(() => encounters.id),

    wardId: integer('ward_id')
      .references(() => wards.id)
      .notNull(),

    bedId: integer('bed_id')
      .references(() => beds.id)
      .notNull(),

    admissionDate: text('admission_date')
      .notNull(),

    admissionType: text('admission_type')
      .default('Emergency'),

    admittingDoctor: text('admitting_doctor'),

    provisionalDiagnosis: text(
      'provisional_diagnosis',
    ),

    nursingNotes: text('nursing_notes'),

    status: text('status')
      .default('Admitted'),

    dischargeDate: text('discharge_date'),

    dischargeType: text('discharge_type'),

    dischargeSummary: text(
      'discharge_summary',
    ),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   29. OPERATING THEATRE
   ============================================================ */

export const theatreCases = pgTable(
  'theatre_cases',
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

    procedureName: text('procedure_name')
      .notNull(),

    theatreRoom: text('theatre_room')
      .default('Main Theatre 1'),

    theatreType: text('theatre_type')
      .default('Major'),

    leadSurgeon: text('lead_surgeon')
      .notNull(),

    anaesthetist: text('anaesthetist'),

    scrubNurse: text('scrub_nurse'),

    scheduledStart: text('scheduled_start')
      .notNull(),

    scheduledEnd: text('scheduled_end'),

    preOpChecklist: jsonb(
      'pre_op_checklist',
    ).default({}),

    postOpNotes: text('post_op_notes'),

    status: text('status')
      .default('Scheduled'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   30. LABORATORY TEST CATALOGUE
   ============================================================ */

export const labTests = pgTable(
  'lab_tests',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    code: text('code').notNull(),

    name: text('name').notNull(),

    category: text('category')
      .default('Haematology'),

    specimenType: text('specimen_type')
      .default('Whole Blood'),

    referenceRanges: text(
      'reference_ranges',
    ),

    turnaroundHours: integer(
      'turnaround_hours',
    ).default(2),

    price: numeric(
      'price',
      {
        precision: 10,
        scale: 2,
      },
    ).default('500.00'),

    isActive: boolean('is_active')
      .default(true),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex(
      'lab_tests_facility_code_idx',
    ).on(
      table.facilityId,
      table.code,
    ),
  }),
);


/* ============================================================
   31. LABORATORY ORDERS
   ============================================================ */

export const labOrders = pgTable(
  'lab_orders',
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

    encounterId: integer('encounter_id')
      .references(() => encounters.id),

    testId: integer('test_id')
      .references(() => labTests.id),

    testName: text('test_name')
      .notNull(),

    status: text('status')
      .default('Ordered'),

    sampleCollectedAt: timestamp(
      'sample_collected_at',
    ),

    sampleAccessionNumber: text(
      'sample_accession_number',
    ),

    orderedBy: text('ordered_by'),

    orderedAt: timestamp('ordered_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   32. LABORATORY RESULTS
   ============================================================ */

export const labResults = pgTable(
  'lab_results',
  {
    id: serial('id').primaryKey(),

    orderId: integer('order_id')
      .references(() => labOrders.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    parameterName: text('parameter_name')
      .notNull(),

    measuredValue: text('measured_value')
      .notNull(),

    unit: text('unit'),

    referenceRange: text('reference_range'),

    flag: text('flag')
      .default('Normal'),

    notes: text('notes'),

    verifiedBy: text('verified_by'),

    verifiedAt: timestamp('verified_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   33. RADIOLOGY ORDERS
   ============================================================ */

export const radiologyOrders = pgTable(
  'radiology_orders',
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

    encounterId: integer('encounter_id')
      .references(() => encounters.id),

    modality: text('modality')
      .notNull(),

    procedureName: text('procedure_name')
      .notNull(),

    clinicalIndication: text(
      'clinical_indication',
    ),

    status: text('status')
      .default('Requested'),

    radiologistFindings: text(
      'radiologist_findings',
    ),

    impression: text('impression'),

    attachmentUrl: text('attachment_url'),

    orderedBy: text('ordered_by'),

    reportedBy: text('reported_by'),

    reportedAt: timestamp('reported_at'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   34. INVENTORY ITEMS
   ============================================================ */

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    itemCode: text('item_code').notNull(),

    name: text('name').notNull(),

    genericName: text('generic_name'),

    category: text('category')
      .default('Pharmaceuticals'),

    unit: text('unit')
      .default('Tablets'),

    strength: text('strength'),

    dosageForm: text('dosage_form'),

    currentStock: integer('current_stock')
      .default(0),

    reorderLevel: integer('reorder_level')
      .default(50),

    unitCost: numeric(
      'unit_cost',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    sellingPrice: numeric(
      'selling_price',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    storeLocation: text('store_location')
      .default('Main Pharmacy Store'),

    isActive: boolean('is_active')
      .default(true),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    facilityItemCodeIdx: uniqueIndex(
      'inventory_items_facility_code_idx',
    ).on(
      table.facilityId,
      table.itemCode,
    ),
  }),
);


/* ============================================================
   35. INVENTORY BATCHES
   ============================================================ */

export const inventoryBatches = pgTable(
  'inventory_batches',
  {
    id: serial('id').primaryKey(),

    itemId: integer('item_id')
      .references(() => inventoryItems.id)
      .notNull(),

    batchNumber: text('batch_number')
      .notNull(),

    expiryDate: text('expiry_date')
      .notNull(),

    quantityRemaining: integer(
      'quantity_remaining',
    ).notNull(),

    costPerUnit: numeric(
      'cost_per_unit',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    itemBatchIdx: uniqueIndex(
      'inventory_batches_item_batch_idx',
    ).on(
      table.itemId,
      table.batchNumber,
    ),
  }),
);


/* ============================================================
   36. PHARMACY DISPENSATIONS
   ============================================================ */

export const pharmacyDispensations = pgTable(
  'pharmacy_dispensations',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    prescriptionId: integer(
      'prescription_id',
    ).references(() => medications.id),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    itemId: integer('item_id')
      .references(() => inventoryItems.id),

    batchNumber: text('batch_number'),

    quantityDispensed: integer(
      'quantity_dispensed',
    ).notNull(),

    dispensedBy: text('dispensed_by')
      .notNull(),

    dispensedAt: timestamp(
      'dispensed_at',
    ).defaultNow().notNull(),

    notes: text('notes'),
  },
);


/* ============================================================
   37. SUPPLIERS
   ============================================================ */

export const suppliers = pgTable(
  'suppliers',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    name: text('name').notNull(),

    contactPerson: text('contact_person'),

    phone: text('phone'),

    email: text('email'),

    kraPin: text('kra_pin'),

    address: text('address'),

    isActive: boolean('is_active')
      .default(true),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   38. PURCHASE ORDERS
   ============================================================ */

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),

    poNumber: text('po_number')
      .notNull()
      .unique(),

    totalAmount: numeric(
      'total_amount',
      {
        precision: 12,
        scale: 2,
      },
    ).default('0'),

    status: text('status')
      .default('Pending Approval'),

    orderedBy: text('ordered_by'),

    approvedBy: text('approved_by'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   39. BILLING INVOICES
   ============================================================ */

export const billingInvoices = pgTable(
  'billing_invoices',
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

    encounterId: integer('encounter_id')
      .references(() => encounters.id),

    invoiceNumber: text('invoice_number')
      .notNull()
      .unique(),

    totalAmount: numeric(
      'total_amount',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    paidAmount: numeric(
      'paid_amount',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    balanceAmount: numeric(
      'balance_amount',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    status: text('status')
      .default('Pending'),

    payerType: text('payer_type')
      .default('Self-Pay'),

    payerName: text('payer_name'),

    memberNumber: text('member_number'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   40. BILLING ITEMS
   ============================================================ */

export const billingItems = pgTable(
  'billing_items',
  {
    id: serial('id').primaryKey(),

    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),

    itemType: text('item_type')
      .notNull(),

    description: text('description')
      .notNull(),

    quantity: integer('quantity')
      .default(1),

    unitPrice: numeric(
      'unit_price',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    totalAmount: numeric(
      'total_amount',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   41. BILLING PAYMENTS
   ============================================================ */

export const billingPayments = pgTable(
  'billing_payments',
  {
    id: serial('id').primaryKey(),

    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),

    receiptNumber: text('receipt_number')
      .notNull()
      .unique(),

    paymentMethod: text('payment_method')
      .default('M-Pesa'),

    amount: numeric(
      'amount',
      {
        precision: 10,
        scale: 2,
      },
    ).notNull(),

    referenceCode: text('reference_code'),

    cashierName: text('cashier_name')
      .notNull(),

    paymentDate: timestamp(
      'payment_date',
    ).defaultNow().notNull(),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   42. INSURANCE / SHA CLAIMS
   ============================================================ */

export const insuranceClaims = pgTable(
  'insurance_claims',
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

    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),

    claimNumber: text('claim_number')
      .notNull()
      .unique(),

    payerName: text('payer_name')
      .default('Social Health Authority (SHA)'),

    policyNumber: text('policy_number'),

    preAuthCode: text('pre_auth_code'),

    claimAmount: numeric(
      'claim_amount',
      {
        precision: 10,
        scale: 2,
      },
    ).notNull(),

    approvedAmount: numeric(
      'approved_amount',
      {
        precision: 10,
        scale: 2,
      },
    ).default('0'),

    status: text('status')
      .default('Draft'),

    submittedAt: timestamp('submitted_at'),

    adjudicationNotes: text(
      'adjudication_notes',
    ),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
);


/* ============================================================
   43. PUBLIC HEALTH REPORTS
   ============================================================ */

export const publicHealthReports = pgTable(
  'public_health_reports',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    diseaseCode: text('disease_code')
      .notNull(),

    diseaseName: text('disease_name')
      .notNull(),

    casesCount: integer('cases_count')
      .default(1),

    mortalityCount: integer(
      'mortality_count',
    ).default(0),

    ageGroup: text('age_group')
      .default('Over 5 Years'),

    epiWeek: text('epi_week')
      .notNull(),

    reportedAt: timestamp('reported_at')
      .defaultNow()
      .notNull(),

    reportedBy: text('reported_by'),

    status: text('status')
      .default('DRAFT'),

    submittedAt: timestamp('submitted_at'),

    submissionReference: text(
      'submission_reference',
    ),
  },
);


/* ============================================================
   44. AUDIT TRAIL & SECURITY LOGS
   ============================================================ */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id'),

    facilityId: integer('facility_id'),

    /*
      JaliCare UID rather than Firebase UID.
    */

    userId: text('user_id'),

    action: text('action')
      .notNull(),

    resource: text('resource')
      .notNull(),

    resourceId: text('resource_id'),

    details: text('details'),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    requestId: text('request_id'),

    severity: text('severity')
      .default('INFO'),

    /*
      Examples:
      INFO
      WARNING
      HIGH
      CRITICAL
    */

    timestamp: timestamp('timestamp')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdx: index(
      'audit_logs_tenant_idx',
    ).on(table.tenantId),

    facilityIdx: index(
      'audit_logs_facility_idx',
    ).on(table.facilityId),

    userIdx: index(
      'audit_logs_user_idx',
    ).on(table.userId),

    actionIdx: index(
      'audit_logs_action_idx',
    ).on(table.action),

    timestampIdx: index(
      'audit_logs_timestamp_idx',
    ).on(table.timestamp),
  }),
);


/* ============================================================
   45. RELATIONS
   ============================================================ */

export const tenantsRelations = relations(
  tenants,
  ({ many }) => ({
    facilities: many(facilities),

    users: many(users),

    roles: many(roles),

    patients: many(patients),

    onboardingRecords: many(
      facilityOnboarding,
    ),
  }),
);


export const facilitiesRelations = relations(
  facilities,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [facilities.tenantId],
      references: [tenants.id],
    }),

    departments: many(departments),

    users: many(users),

    patients: many(patients),

    wards: many(wards),

    practitioners: many(practitioners),

    onboarding: many(
      facilityOnboarding,
    ),

    documents: many(
      facilityDocuments,
    ),

    adminInvitations: many(
      facilityAdminInvitations,
    ),

    userInvitations: many(
      userInvitations,
    ),

    labTests: many(labTests),

    inventoryItems: many(
      inventoryItems,
    ),
  }),
);


export const departmentsRelations = relations(
  departments,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [departments.facilityId],
      references: [facilities.id],
    }),

    practitioners: many(
      practitioners,
    ),

    encounters: many(encounters),
  }),
);


export const rolesRelations = relations(
  roles,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [roles.tenantId],
      references: [tenants.id],
    }),

    permissions: many(
      rolePermissions,
    ),

    users: many(userRoles),
  }),
);


export const permissionsRelations = relations(
  permissions,
  ({ many }) => ({
    roles: many(rolePermissions),
  }),
);


export const rolePermissionsRelations =
  relations(
    rolePermissions,
    ({ one }) => ({
      role: one(roles, {
        fields: [
          rolePermissions.roleId,
        ],
        references: [roles.id],
      }),

      permission: one(permissions, {
        fields: [
          rolePermissions.permissionId,
        ],
        references: [permissions.id],
      }),
    }),
  );


export const usersRelations = relations(
  users,
  ({ one, many }) => ({
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

    loginAttempts: many(
      loginAttempts,
    ),

    passwordResets: many(
      passwordResets,
    ),

    practitioners: many(
      practitioners,
    ),

    facilityAdminInvitations: many(
      facilityAdminInvitations,
    ),

    userInvitations: many(
      userInvitations,
    ),
  }),
);


export const userRolesRelations = relations(
  userRoles,
  ({ one }) => ({
    user: one(users, {
      fields: [userRoles.userId],
      references: [users.id],
    }),

    role: one(roles, {
      fields: [userRoles.roleId],
      references: [roles.id],
    }),
  }),
);


export const sessionsRelations = relations(
  sessions,
  ({ one }) => ({
    user: one(users, {
      fields: [sessions.userId],
      references: [users.id],
    }),
  }),
);


export const loginAttemptsRelations =
  relations(
    loginAttempts,
    ({ one }) => ({
      user: one(users, {
        fields: [
          loginAttempts.userId,
        ],
        references: [users.id],
      }),
    }),
  );


export const passwordResetsRelations =
  relations(
    passwordResets,
    ({ one }) => ({
      user: one(users, {
        fields: [
          passwordResets.userId,
        ],
        references: [users.id],
      }),
    }),
  );


export const facilityOnboardingRelations =
  relations(
    facilityOnboarding,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          facilityOnboarding.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          facilityOnboarding.facilityId,
        ],
        references: [facilities.id],
      }),
    }),
  );


export const facilityDocumentsRelations =
  relations(
    facilityDocuments,
    ({ one }) => ({
      facility: one(facilities, {
        fields: [
          facilityDocuments.facilityId,
        ],
        references: [facilities.id],
      }),
    }),
  );


export const facilityAdminInvitationsRelations =
  relations(
    facilityAdminInvitations,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          facilityAdminInvitations.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          facilityAdminInvitations.facilityId,
        ],
        references: [facilities.id],
      }),

      acceptedUser: one(users, {
        fields: [
          facilityAdminInvitations.acceptedUserId,
        ],
        references: [users.id],
      }),
    }),
  );


export const userInvitationsRelations =
  relations(
    userInvitations,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          userInvitations.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          userInvitations.facilityId,
        ],
        references: [facilities.id],
      }),

      role: one(roles, {
        fields: [
          userInvitations.roleId,
        ],
        references: [roles.id],
      }),

      acceptedUser: one(users, {
        fields: [
          userInvitations.acceptedUserId,
        ],
        references: [users.id],
      }),
    }),
  );


export const practitionersRelations =
  relations(
    practitioners,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          practitioners.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          practitioners.facilityId,
        ],
        references: [facilities.id],
      }),

      user: one(users, {
        fields: [
          practitioners.userId,
        ],
        references: [users.id],
      }),

      department: one(departments, {
        fields: [
          practitioners.departmentId,
        ],
        references: [departments.id],
      }),
    }),
  );


export const patientsRelations = relations(
  patients,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [patients.tenantId],
      references: [tenants.id],
    }),

    facility: one(facilities, {
      fields: [patients.facilityId],
      references: [facilities.id],
    }),

    encounters: many(encounters),

    appointments: many(appointments),

    invoices: many(
      billingInvoices,
    ),

    admissions: many(admissions),

    identifiers: many(
      patientIdentifiers,
    ),
  }),
);


export const patientIdentifiersRelations =
  relations(
    patientIdentifiers,
    ({ one }) => ({
      patient: one(patients, {
        fields: [
          patientIdentifiers.patientId,
        ],
        references: [patients.id],
      }),
    }),
  );


export const encountersRelations =
  relations(
    encounters,
    ({ one, many }) => ({
      tenant: one(tenants, {
        fields: [
          encounters.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          encounters.facilityId,
        ],
        references: [facilities.id],
      }),

      patient: one(patients, {
        fields: [
          encounters.patientId,
        ],
        references: [patients.id],
      }),

      practitioner: one(
        practitioners,
        {
          fields: [
            encounters.practitionerId,
          ],
          references: [
            practitioners.id,
          ],
        },
      ),

      department: one(
        departments,
        {
          fields: [
            encounters.departmentId,
          ],
          references: [
            departments.id,
          ],
        },
      ),

      observations: many(
        observations,
      ),

      diagnoses: many(
        diagnoses,
      ),

      medications: many(
        medications,
      ),

      labOrders: many(
        labOrders,
      ),
    }),
  );


export const observationsRelations =
  relations(
    observations,
    ({ one }) => ({
      encounter: one(encounters, {
        fields: [
          observations.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          observations.patientId,
        ],
        references: [
          patients.id,
        ],
      }),
    }),
  );


export const diagnosesRelations =
  relations(
    diagnoses,
    ({ one }) => ({
      encounter: one(encounters, {
        fields: [
          diagnoses.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          diagnoses.patientId,
        ],
        references: [
          patients.id,
        ],
      }),
    }),
  );


export const medicationsRelations =
  relations(
    medications,
    ({ one, many }) => ({
      encounter: one(encounters, {
        fields: [
          medications.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          medications.patientId,
        ],
        references: [
          patients.id,
        ],
      }),

      dispensations: many(
        pharmacyDispensations,
      ),
    }),
  );


export const wardsRelations = relations(
  wards,
  ({ one, many }) => ({
    facility: one(facilities, {
      fields: [wards.facilityId],
      references: [facilities.id],
    }),

    beds: many(beds),

    admissions: many(
      admissions,
    ),
  }),
);


export const bedsRelations = relations(
  beds,
  ({ one }) => ({
    ward: one(wards, {
      fields: [beds.wardId],
      references: [wards.id],
    }),

    currentPatient: one(
      patients,
      {
        fields: [
          beds.currentPatientId,
        ],
        references: [
          patients.id,
        ],
      },
    ),
  }),
);


export const admissionsRelations =
  relations(
    admissions,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          admissions.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          admissions.facilityId,
        ],
        references: [facilities.id],
      }),

      patient: one(patients, {
        fields: [
          admissions.patientId,
        ],
        references: [patients.id],
      }),

      encounter: one(encounters, {
        fields: [
          admissions.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),

      ward: one(wards, {
        fields: [
          admissions.wardId,
        ],
        references: [wards.id],
      }),

      bed: one(beds, {
        fields: [
          admissions.bedId,
        ],
        references: [beds.id],
      }),
    }),
  );


export const theatreCasesRelations =
  relations(
    theatreCases,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          theatreCases.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          theatreCases.facilityId,
        ],
        references: [facilities.id],
      }),

      patient: one(patients, {
        fields: [
          theatreCases.patientId,
        ],
        references: [patients.id],
      }),
    }),
  );


export const labTestsRelations =
  relations(
    labTests,
    ({ one, many }) => ({
      facility: one(facilities, {
        fields: [
          labTests.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      orders: many(labOrders),
    }),
  );


export const labOrdersRelations =
  relations(
    labOrders,
    ({ one, many }) => ({
      tenant: one(tenants, {
        fields: [
          labOrders.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          labOrders.facilityId,
        ],
        references: [facilities.id],
      }),

      patient: one(patients, {
        fields: [
          labOrders.patientId,
        ],
        references: [
          patients.id,
        ],
      }),

      encounter: one(encounters, {
        fields: [
          labOrders.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),

      test: one(labTests, {
        fields: [
          labOrders.testId,
        ],
        references: [
          labTests.id,
        ],
      }),

      results: many(
        labResults,
      ),
    }),
  );


export const labResultsRelations =
  relations(
    labResults,
    ({ one }) => ({
      order: one(labOrders, {
        fields: [
          labResults.orderId,
        ],
        references: [
          labOrders.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          labResults.patientId,
        ],
        references: [
          patients.id,
        ],
      }),
    }),
  );


export const radiologyOrdersRelations =
  relations(
    radiologyOrders,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          radiologyOrders.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          radiologyOrders.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          radiologyOrders.patientId,
        ],
        references: [
          patients.id,
        ],
      }),

      encounter: one(encounters, {
        fields: [
          radiologyOrders.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),
    }),
  );


export const inventoryItemsRelations =
  relations(
    inventoryItems,
    ({ one, many }) => ({
      facility: one(facilities, {
        fields: [
          inventoryItems.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      batches: many(
        inventoryBatches,
      ),

      dispensations: many(
        pharmacyDispensations,
      ),
    }),
  );


export const inventoryBatchesRelations =
  relations(
    inventoryBatches,
    ({ one }) => ({
      item: one(
        inventoryItems,
        {
          fields: [
            inventoryBatches.itemId,
          ],
          references: [
            inventoryItems.id,
          ],
        },
      ),
    }),
  );


export const pharmacyDispensationsRelations =
  relations(
    pharmacyDispensations,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          pharmacyDispensations.tenantId,
        ],
        references: [tenants.id],
      }),

      facility: one(facilities, {
        fields: [
          pharmacyDispensations.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      prescription: one(
        medications,
        {
          fields: [
            pharmacyDispensations.prescriptionId,
          ],
          references: [
            medications.id,
          ],
        },
      ),

      patient: one(patients, {
        fields: [
          pharmacyDispensations.patientId,
        ],
        references: [
          patients.id,
        ],
      }),

      item: one(
        inventoryItems,
        {
          fields: [
            pharmacyDispensations.itemId,
          ],
          references: [
            inventoryItems.id,
          ],
        },
      ),
    }),
  );


export const suppliersRelations =
  relations(
    suppliers,
    ({ one, many }) => ({
      tenant: one(tenants, {
        fields: [
          suppliers.tenantId,
        ],
        references: [
          tenants.id,
        ],
      }),

      purchaseOrders: many(
        purchaseOrders,
      ),
    }),
  );


export const purchaseOrdersRelations =
  relations(
    purchaseOrders,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          purchaseOrders.tenantId,
        ],
        references: [
          tenants.id,
        ],
      }),

      facility: one(facilities, {
        fields: [
          purchaseOrders.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      supplier: one(suppliers, {
        fields: [
          purchaseOrders.supplierId,
        ],
        references: [
          suppliers.id,
        ],
      }),
    }),
  );


export const billingInvoicesRelations =
  relations(
    billingInvoices,
    ({ one, many }) => ({
      tenant: one(tenants, {
        fields: [
          billingInvoices.tenantId,
        ],
        references: [
          tenants.id,
        ],
      }),

      facility: one(facilities, {
        fields: [
          billingInvoices.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          billingInvoices.patientId,
        ],
        references: [
          patients.id,
        ],
      }),

      encounter: one(encounters, {
        fields: [
          billingInvoices.encounterId,
        ],
        references: [
          encounters.id,
        ],
      }),

      items: many(
        billingItems,
      ),

      payments: many(
        billingPayments,
      ),

      claims: many(
        insuranceClaims,
      ),
    }),
  );


export const billingItemsRelations =
  relations(
    billingItems,
    ({ one }) => ({
      invoice: one(
        billingInvoices,
        {
          fields: [
            billingItems.invoiceId,
          ],
          references: [
            billingInvoices.id,
          ],
        },
      ),
    }),
  );


export const billingPaymentsRelations =
  relations(
    billingPayments,
    ({ one }) => ({
      invoice: one(
        billingInvoices,
        {
          fields: [
            billingPayments.invoiceId,
          ],
          references: [
            billingInvoices.id,
          ],
        },
      ),
    }),
  );


export const insuranceClaimsRelations =
  relations(
    insuranceClaims,
    ({ one }) => ({
      tenant: one(tenants, {
        fields: [
          insuranceClaims.tenantId,
        ],
        references: [
          tenants.id,
        ],
      }),

      facility: one(facilities, {
        fields: [
          insuranceClaims.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),

      patient: one(patients, {
        fields: [
          insuranceClaims.patientId,
        ],
        references: [
          patients.id,
        ],
      }),

      invoice: one(
        billingInvoices,
        {
          fields: [
            insuranceClaims.invoiceId,
          ],
          references: [
            billingInvoices.id,
          ],
        },
      ),
    }),
  );


export const publicHealthReportsRelations =
  relations(
    publicHealthReports,
    ({ one }) => ({
      facility: one(facilities, {
        fields: [
          publicHealthReports.facilityId,
        ],
        references: [
          facilities.id,
        ],
      }),
    }),
  );


/* ============================================================
   END OF JALICARE SCHEMA
   ============================================================ */