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

    /*
      The facility where the patient was first registered.

      IMPORTANT:
      This is NOT the patient's permanent facility.
      A patient may receive care at multiple facilities.
    */
    registrationFacilityId: integer(
      'registration_facility_id',
    )
      .references(() => facilities.id)
      .notNull(),

    mrn: text('mrn')
      .notNull()
      .unique(),

    firstName: text('first_name')
      .notNull(),

    lastName: text('last_name')
      .notNull(),

    middleName: text('middle_name'),

    dateOfBirth: date('date_of_birth')
      .notNull(),

    gender: text('gender')
      .notNull(),

    phone: text('phone')
      .notNull(),

    email: text('email'),

    /*
      Keep primary identifiers here only if needed for
      fast lookup.

      Full identifier history is stored in patientIdentifiers.
    */
    nationalId: text('national_id'),

    shaNumber: text('sha_number'),

    bloodGroup: text('blood_group'),

    maritalStatus: text('marital_status'),

    occupation: text('occupation'),

    county: text('county'),

    subCounty: text('sub_county'),

    residentialAddress: text(
      'residential_address',
    ),

    emergencyContactName: text(
      'emergency_contact_name',
    ),

    emergencyContactPhone: text(
      'emergency_contact_phone',
    ),

    emergencyContactRelationship: text(
      'emergency_contact_relationship',
    ),

    /*
      These remain as summary fields.

      Detailed clinical information should eventually
      live in dedicated clinical tables.
    */
    allergies: text('allergies'),

    chronicConditions: text(
      'chronic_conditions',
    ),

    payerType: text('payer_type')
      .default('SELF_PAY')
      .notNull(),

    insuranceProvider: text(
      'insurance_provider',
    ),

    policyNumber: text('policy_number'),

    /*
      ACTIVE
      INACTIVE
      DECEASED
      MERGED
    */
    status: text('status')
      .default('ACTIVE')
      .notNull(),

    deceasedAt: timestamp(
      'deceased_at',
    ),

    /*
      If duplicate patients are merged, retain
      the surviving patient relationship.
    */
    mergedIntoPatientId: integer(
      'merged_into_patient_id',
    ),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdx: index(
      'patients_tenant_idx',
    ).on(table.tenantId),

    registrationFacilityIdx: index(
      'patients_registration_facility_idx',
    ).on(
      table.registrationFacilityId,
    ),

    nationalIdIdx: index(
      'patients_national_id_idx',
    ).on(table.nationalId),

    shaIdx: index(
      'patients_sha_idx',
    ).on(table.shaNumber),

    phoneIdx: index(
      'patients_phone_idx',
    ).on(table.phone),

    statusIdx: index(
      'patients_status_idx',
    ).on(table.status),

    mergedIntoIdx: index(
      'patients_merged_into_idx',
    ).on(table.mergedIntoPatientId),
  }),
);


/* ============================================================
   18. PATIENT FACILITY RELATIONSHIPS
   ============================================================

   Allows one patient to receive care at multiple facilities
   without creating duplicate patient identities.

   Example:

   Patient
      |
      +--- Facility A
      |
      +--- Facility B
      |
      +--- Facility C

   Historical encounters remain owned by their original
   facility.
   ============================================================ */

export const patientFacilities = pgTable(
  'patient_facilities',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    /*
      PRIMARY
      CARE
      REFERRAL
      CONSULTATION
      FOLLOW_UP
      HISTORICAL
    */
    relationshipType: text(
      'relationship_type',
    )
      .default('CARE')
      .notNull(),

    /*
      ACTIVE
      INACTIVE
    */
    status: text('status')
      .default('ACTIVE')
      .notNull(),

    firstSeenAt: timestamp(
      'first_seen_at',
    )
      .defaultNow()
      .notNull(),

    lastSeenAt: timestamp(
      'last_seen_at',
    ),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    patientIdx: index(
      'patient_facilities_patient_idx',
    ).on(table.patientId),

    facilityIdx: index(
      'patient_facilities_facility_idx',
    ).on(table.facilityId),

    tenantIdx: index(
      'patient_facilities_tenant_idx',
    ).on(table.tenantId),

    patientFacilityUnique: uniqueIndex(
      'patient_facilities_unique_idx',
    ).on(
      table.patientId,
      table.facilityId,
    ),
  }),
);


/* ============================================================
   19. PATIENT ACCOUNTS
   ============================================================

   Connects a patient clinical identity to a JaliCare user.

   Authentication credentials remain in users.

   Patient clinical identity remains in patients.

   Patient portal access is separated from staff access.
   ============================================================ */

export const patientAccounts = pgTable(
  'patient_accounts',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .references(() => users.id)
      .notNull()
      .unique(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull()
      .unique(),

    /*
      PENDING
      ACTIVE
      SUSPENDED
      DISABLED
    */
    status: text('status')
      .default('PENDING')
      .notNull(),

    /*
      Indicates that the patient has completed
      portal verification.
    */
    accountVerifiedAt: timestamp(
      'account_verified_at',
    ),

    /*
      Timestamp of first successful portal activation.
    */
    activatedAt: timestamp(
      'activated_at',
    ),

    lastPortalLoginAt: timestamp(
      'last_portal_login_at',
    ),

    lastPortalAccessAt: timestamp(
      'last_portal_access_at',
    ),

    disabledAt: timestamp(
      'disabled_at',
    ),

    disabledReason: text(
      'disabled_reason',
    ),

    /*
      Used for portal preferences without mixing
      clinical information into the authentication table.
    */
    preferences: jsonb('preferences')
      .default({})
      .notNull(),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex(
      'patient_accounts_user_idx',
    ).on(table.userId),

    patientIdx: uniqueIndex(
      'patient_accounts_patient_idx',
    ).on(table.patientId),

    statusIdx: index(
      'patient_accounts_status_idx',
    ).on(table.status),
  }),
);


/* ============================================================
   20. PATIENT IDENTIFIERS
   ============================================================ */

export const patientIdentifiers = pgTable(
  'patient_identifiers',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    /*
      NATIONAL_ID
      PASSPORT
      BIRTH_CERTIFICATE
      SHA
      NHIF_LEGACY
      FACILITY_MRN
      OTHER
    */
    idType: text('id_type')
      .notNull(),

    idValue: text('id_value')
      .notNull(),

    issuingAuthority: text(
      'issuing_authority',
    ),

    isPrimary: boolean('is_primary')
      .default(false)
      .notNull(),

    verified: boolean('verified')
      .default(false)
      .notNull(),

    verifiedAt: timestamp(
      'verified_at',
    ),

    verifiedByUserId: integer(
      'verified_by_user_id',
    )
      .references(() => users.id),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
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

    verifiedIdx: index(
      'patient_identifiers_verified_idx',
    ).on(table.verified),
  }),
);


/* ============================================================
   21. PATIENT CONSENTS
   ============================================================ */

export const patientConsents = pgTable(
  'patient_consents',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    grantedByUserId: integer(
      'granted_by_user_id',
    )
      .references(() => users.id),

    recipientFacilityId: integer(
      'recipient_facility_id',
    )
      .references(() => facilities.id),

    recipientUserId: integer(
      'recipient_user_id',
    )
      .references(() => users.id),

    purpose: text('purpose')
      .notNull(),

    /*
      ACTIVE
      REVOKED
      EXPIRED
      USED
    */
    status: text('status')
      .default('ACTIVE')
      .notNull(),

    /*
      Example:

      {
        "patientProfile": true,
        "encounters": true,
        "laboratory": true,
        "radiology": true,
        "medications": true,
        "diagnoses": true,
        "procedures": false,
        "billing": false
      }
    */
    scope: jsonb('scope')
      .default({})
      .notNull(),

    grantedAt: timestamp(
      'granted_at',
    )
      .defaultNow()
      .notNull(),

    expiresAt: timestamp(
      'expires_at',
    ),

    revokedAt: timestamp(
      'revoked_at',
    ),

    revokedByUserId: integer(
      'revoked_by_user_id',
    )
      .references(() => users.id),

    consentVersion: integer(
      'consent_version',
    )
      .default(1)
      .notNull(),

    /*
      Stores the version of the consent form/
      terms that the patient accepted.
    */
    consentDocumentHash: text(
      'consent_document_hash',
    ),

    /*
      Useful for electronic consent evidence.
    */
    consentMethod: text(
      'consent_method',
    ),

    /*
      PATIENT_PORTAL
      STAFF
      EMERGENCY
      OTHER
    */
    grantedThrough: text(
      'granted_through',
    ),

    metadata: jsonb('metadata')
      .default({})
      .notNull(),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    patientIdx: index(
      'patient_consents_patient_idx',
    ).on(table.patientId),

    recipientFacilityIdx: index(
      'patient_consents_recipient_facility_idx',
    ).on(table.recipientFacilityId),

    recipientUserIdx: index(
      'patient_consents_recipient_user_idx',
    ).on(table.recipientUserId),

    statusIdx: index(
      'patient_consents_status_idx',
    ).on(table.status),

    expiryIdx: index(
      'patient_consents_expiry_idx',
    ).on(table.expiresAt),
  }),
);


/* ============================================================
   22. PATIENT RECORD ACCESS LOG
   ============================================================

   Records every important access to patient information.

   This is separate from the general audit log because
   patient-data access is security-sensitive.
   ============================================================ */

export const patientRecordAccessLogs = pgTable(
  'patient_record_access_logs',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    userId: integer('user_id')
      .references(() => users.id),

    facilityId: integer(
      'facility_id',
    )
      .references(() => facilities.id),

    tenantId: integer(
      'tenant_id',
    )
      .references(() => tenants.id),

    /*
      VIEW
      DOWNLOAD
      EXPORT
      SHARE
      UPDATE
      CREATE
      PRINT
      IMPORT
    */
    action: text('action')
      .notNull(),

    /*
      PATIENT_PORTAL
      STAFF_PORTAL
      API
      REFERRAL
      FHIR
      EMERGENCY
    */
    accessChannel: text(
      'access_channel',
    ),

    recordType: text(
      'record_type',
    ),

    recordId: integer(
      'record_id',
    ),

    purpose: text('purpose'),

    ipAddress: text(
      'ip_address',
    ),

    userAgent: text(
      'user_agent',
    ),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    patientIdx: index(
      'patient_record_access_patient_idx',
    ).on(table.patientId),

    userIdx: index(
      'patient_record_access_user_idx',
    ).on(table.userId),

    facilityIdx: index(
      'patient_record_access_facility_idx',
    ).on(table.facilityId),

    createdIdx: index(
      'patient_record_access_created_idx',
    ).on(table.createdAt),
  }),
);


/* ============================================================
   23. REFERRALS
   ============================================================ */

export const referrals = pgTable(
  'referrals',
  {
    id: serial('id').primaryKey(),

    referralNumber: text(
      'referral_number',
    )
      .notNull()
      .unique(),

    patientId: integer(
      'patient_id',
    )
      .references(() => patients.id)
      .notNull(),

    sourceTenantId: integer(
      'source_tenant_id',
    )
      .references(() => tenants.id)
      .notNull(),

    sourceFacilityId: integer(
      'source_facility_id',
    )
      .references(() => facilities.id)
      .notNull(),

    destinationTenantId: integer(
      'destination_tenant_id',
    )
      .references(() => tenants.id),

    destinationFacilityId: integer(
      'destination_facility_id',
    )
      .references(() => facilities.id),

    destinationDepartmentId: integer(
      'destination_department_id',
    )
      .references(() => departments.id),

    externalDestinationName: text(
      'external_destination_name',
    ),

    externalDestinationContact: text(
      'external_destination_contact',
    ),

    referringPractitionerId: integer(
      'referring_practitioner_id',
    )
      .references(() => practitioners.id),

    referredByUserId: integer(
      'referred_by_user_id',
    )
      .references(() => users.id),

    receivingPractitionerId: integer(
      'receiving_practitioner_id',
    )
      .references(() => practitioners.id),

    reason: text('reason')
      .notNull(),

    clinicalSummary: text(
      'clinical_summary',
    ),

    /*
      ROUTINE
      URGENT
      EMERGENCY
    */
    urgency: text('urgency')
      .default('ROUTINE')
      .notNull(),

    /*
      DRAFT
      SENT
      ACCEPTED
      DECLINED
      PATIENT_SEEN
      COMPLETED
      CANCELLED
    */
    status: text('status')
      .default('DRAFT')
      .notNull(),

    requestedAt: timestamp(
      'requested_at',
    ),

    sentAt: timestamp(
      'sent_at',
    ),

    acceptedAt: timestamp(
      'accepted_at',
    ),

    patientSeenAt: timestamp(
      'patient_seen_at',
    ),

    completedAt: timestamp(
      'completed_at',
    ),

    cancelledAt: timestamp(
      'cancelled_at',
    ),

    cancellationReason: text(
      'cancellation_reason',
    ),

    /*
      Clinical response from receiving facility.
    */
    receivingClinicalSummary: text(
      'receiving_clinical_summary',
    ),

    receivingNotes: text(
      'receiving_notes',
    ),

    responseAt: timestamp(
      'response_at',
    ),

    metadata: jsonb('metadata')
      .default({})
      .notNull(),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    patientIdx: index(
      'referrals_patient_idx',
    ).on(table.patientId),

    sourceFacilityIdx: index(
      'referrals_source_facility_idx',
    ).on(table.sourceFacilityId),

    destinationFacilityIdx: index(
      'referrals_destination_facility_idx',
    ).on(table.destinationFacilityId),

    destinationDepartmentIdx: index(
      'referrals_destination_department_idx',
    ).on(table.destinationDepartmentId),

    statusIdx: index(
      'referrals_status_idx',
    ).on(table.status),

    referralNumberIdx: uniqueIndex(
      'referrals_number_idx',
    ).on(table.referralNumber),
  }),
);


/* ============================================================
   24. REFERRAL DOCUMENTS
   ============================================================ */

export const referralDocuments = pgTable(
  'referral_documents',
  {
    id: serial('id').primaryKey(),

    referralId: integer(
      'referral_id',
    )
      .references(() => referrals.id)
      .notNull(),

    patientId: integer(
      'patient_id',
    )
      .references(() => patients.id)
      .notNull(),

    documentType: text(
      'document_type',
    ).notNull(),

    documentName: text(
      'document_name',
    ).notNull(),

    storageKey: text(
      'storage_key',
    ),

    /*
      Avoid treating this as a permanent public URL.
      Prefer signed/private storage access.
    */
    documentUrl: text(
      'document_url',
    ),

    mimeType: text(
      'mime_type',
    ),

    fileSize: integer(
      'file_size',
    ),

    documentHash: text(
      'document_hash',
    ),

    uploadedByUserId: integer(
      'uploaded_by_user_id',
    )
      .references(() => users.id),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    referralIdx: index(
      'referral_documents_referral_idx',
    ).on(table.referralId),

    patientIdx: index(
      'referral_documents_patient_idx',
    ).on(table.patientId),
  }),
);


/* ============================================================
   25. REFERRAL ACCESS LOG
   ============================================================ */

export const referralAccessLogs = pgTable(
  'referral_access_logs',
  {
    id: serial('id').primaryKey(),

    referralId: integer(
      'referral_id',
    )
      .references(() => referrals.id)
      .notNull(),

    patientId: integer(
      'patient_id',
    )
      .references(() => patients.id)
      .notNull(),

    userId: integer(
      'user_id',
    )
      .references(() => users.id),

    facilityId: integer(
      'facility_id',
    )
      .references(() => facilities.id),

    /*
      VIEW
      DOWNLOAD
      ACCEPT
      DECLINE
      UPLOAD
      COMPLETE
    */
    action: text('action')
      .notNull(),

    ipAddress: text(
      'ip_address',
    ),

    userAgent: text(
      'user_agent',
    ),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    referralIdx: index(
      'referral_access_logs_referral_idx',
    ).on(table.referralId),

    patientIdx: index(
      'referral_access_logs_patient_idx',
    ).on(table.patientId),

    userIdx: index(
      'referral_access_logs_user_idx',
    ).on(table.userId),
  }),
);


/* ============================================================
   26. HEALTH RECORD EXPORTS
   ============================================================ */

export const healthRecordExports = pgTable(
  'health_record_exports',
  {
    id: serial('id').primaryKey(),

    patientId: integer(
      'patient_id',
    )
      .references(() => patients.id)
      .notNull(),

    requestedByUserId: integer(
      'requested_by_user_id',
    )
      .references(() => users.id)
      .notNull(),

    /*
      PDF
      JSON
      FHIR_JSON
    */
    format: text('format')
      .notNull(),

    /*
      REQUESTED
      PROCESSING
      READY
      EXPIRED
      FAILED
    */
    status: text('status')
      .default('REQUESTED')
      .notNull(),

    scope: jsonb('scope')
      .default({})
      .notNull(),

    storageKey: text(
      'storage_key',
    ),

    documentHash: text(
      'document_hash',
    ),

    expiresAt: timestamp(
      'expires_at',
    ),

    downloadedAt: timestamp(
      'downloaded_at',
    ),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    completedAt: timestamp(
      'completed_at',
    ),

    failureReason: text(
      'failure_reason',
    ),
  },
  (table) => ({
    patientIdx: index(
      'health_record_exports_patient_idx',
    ).on(table.patientId),

    requesterIdx: index(
      'health_record_exports_requester_idx',
    ).on(table.requestedByUserId),

    statusIdx: index(
      'health_record_exports_status_idx',
    ).on(table.status),

    expiryIdx: index(
      'health_record_exports_expiry_idx',
    ).on(table.expiresAt),
  }),
);


/* ============================================================
   27. HEALTH RECORD IMPORTS
   ============================================================ */

export const healthRecordImports = pgTable(
  'health_record_imports',
  {
    id: serial('id').primaryKey(),

    patientId: integer(
      'patient_id',
    )
      .references(() => patients.id),

    targetTenantId: integer(
      'target_tenant_id',
    )
      .references(() => tenants.id)
      .notNull(),

    targetFacilityId: integer(
      'target_facility_id',
    )
      .references(() => facilities.id)
      .notNull(),

    uploadedByUserId: integer(
      'uploaded_by_user_id',
    )
      .references(() => users.id)
      .notNull(),

    sourceFacilityName: text(
      'source_facility_name',
    ),

    sourceFacilityId: integer(
      'source_facility_id',
    )
      .references(() => facilities.id),

    /*
      External source system identifier.
      Useful for interoperability.
    */
    sourceSystem: text(
      'source_system',
    ),

    sourceRecordId: text(
      'source_record_id',
    ),

    format: text('format')
      .notNull(),

    /*
      UPLOADED
      VALIDATING
      VALIDATED
      REVIEW_REQUIRED
      APPROVED
      IMPORTED
      REJECTED
      FAILED
    */
    status: text('status')
      .default('UPLOADED')
      .notNull(),

    storageKey: text(
      'storage_key',
    ),

    documentHash: text(
      'document_hash',
    ),

    validationErrors: jsonb(
      'validation_errors',
    )
      .default([])
      .notNull(),

    importSummary: jsonb(
      'import_summary',
    )
      .default({})
      .notNull(),

    matchedPatientId: integer(
      'matched_patient_id',
    )
      .references(() => patients.id),

    reviewedByUserId: integer(
      'reviewed_by_user_id',
    )
      .references(() => users.id),

    reviewedAt: timestamp(
      'reviewed_at',
    ),

    importedAt: timestamp(
      'imported_at',
    ),

    rejectionReason: text(
      'rejection_reason',
    ),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    targetFacilityIdx: index(
      'health_record_imports_target_facility_idx',
    ).on(table.targetFacilityId),

    patientIdx: index(
      'health_record_imports_patient_idx',
    ).on(table.patientId),

    matchedPatientIdx: index(
      'health_record_imports_matched_patient_idx',
    ).on(table.matchedPatientId),

    statusIdx: index(
      'health_record_imports_status_idx',
    ).on(table.status),
  }),
);


/* ============================================================
   28. CLINICAL ENCOUNTERS
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

    practitionerId: integer(
      'practitioner_id',
    )
      .references(() => practitioners.id),

    departmentId: integer(
      'department_id',
    )
      .references(() => departments.id),

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
    encounterType: text(
      'encounter_type',
    )
      .default('OUTPATIENT')
      .notNull(),

    /*
      PLANNED
      ACTIVE
      ON_HOLD
      COMPLETED
      CANCELLED
    */
    status: text('status')
      .default('ACTIVE')
      .notNull(),

    triageCategory: text(
      'triage_category',
    ),

    chiefComplaint: text(
      'chief_complaint',
    ),

    historyOfPresentIllness: text(
      'history_of_present_illness',
    ),

    physicalExamination: text(
      'physical_examination',
    ),

    clinicalNotes: text(
      'clinical_notes',
    ),

    followUpDate: date(
      'follow_up_date',
    ),

    /*
      Keep legacy/simple referral text only as
      a summary. The real referral relationship
      belongs in referrals.
    */
    referralFacility: text(
      'referral_facility',
    ),

    startedAt: timestamp(
      'started_at',
    )
      .defaultNow()
      .notNull(),

    endedAt: timestamp(
      'ended_at',
    ),

    createdByUserId: integer(
      'created_by_user_id',
    )
      .references(() => users.id),

    updatedByUserId: integer(
      'updated_by_user_id',
    )
      .references(() => users.id),

    createdAt: timestamp(
      'created_at',
    )
      .defaultNow()
      .notNull(),

    updatedAt: timestamp(
      'updated_at',
    )
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdx: index(
      'encounters_tenant_idx',
    ).on(table.tenantId),

    patientIdx: index(
      'encounters_patient_idx',
    ).on(table.patientId),

    facilityIdx: index(
      'encounters_facility_idx',
    ).on(table.facilityId),

    practitionerIdx: index(
      'encounters_practitioner_idx',
    ).on(table.practitionerId),

    departmentIdx: index(
      'encounters_department_idx',
    ).on(table.departmentId),

    statusIdx: index(
      'encounters_status_idx',
    ).on(table.status),

    startedAtIdx: index(
      'encounters_started_at_idx',
    ).on(table.startedAt),
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

    registrationFacility: one(facilities, {
      fields: [patients.registrationFacilityId],
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