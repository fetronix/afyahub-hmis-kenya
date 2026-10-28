import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
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

    userId: integer('user_id').references(() => users.id),

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

    credentialVerificationStatus: text('credential_verification_status')
      .default('PENDING')
      .notNull(),

    /*
      PENDING
      VERIFIED
      REJECTED
      EXPIRED
    */

    credentialVerifiedAt: timestamp('credential_verified_at'),

    credentialVerifiedBy: text('credential_verified_by'),

    credentialVerificationNotes: text('credential_verification_notes'),

    specialty: text('specialty').default('General Medicine'),

    qualification: text('qualification'),

    departmentId: integer('department_id').references(() => departments.id),

    phone: text('phone'),

    email: text('email'),

    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex('practitioners_user_idx').on(table.userId),

    facilityLicenseIdx: index('practitioners_facility_license_idx').on(
      table.facilityId,
      table.licenseNumber,
    ),

    registrationIdx: index('practitioners_registration_idx').on(
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
    registrationFacilityId: integer('registration_facility_id')
      .references(() => facilities.id)
      .notNull(),

    mrn: text('mrn').notNull().unique(),

    firstName: text('first_name').notNull(),

    lastName: text('last_name').notNull(),

    middleName: text('middle_name'),

    dateOfBirth: date('date_of_birth').notNull(),

    gender: text('gender').notNull(),

    phone: text('phone'),

    email: text('email'),

    /*
      Keep primary identifiers here only if needed for
      fast lookup.

      Full identifier history is stored in patientIdentifiers.
    */
    nationalId: text('national_id'),

    /*
      Blind index for `national_id`.

      An encrypted column cannot be searched with ILIKE, so an exact
      match is found through this HMAC. Set by `sealPatientIdentifiers`
      in src/security/patient-identifiers.ts; null when field
      encryption is not configured.
    */
    nationalIdBlindIndex: text('national_id_bidx'),

    shaNumber: text('sha_number'),

    /* Blind index for `sha_number`; see national_id_bidx above. */
    shaNumberBlindIndex: text('sha_number_bidx'),

    /* Client Registry id used by every DHA eligibility and claim call. */
    dhaClientRegistryId: text('dha_client_registry_id'),

    /* Minimal cache of the last eligibility result (no demographics). */
    dhaEligibilityStatus: text('dha_eligibility_status'),
    dhaEligibilityCheckedAt: timestamp('dha_eligibility_checked_at'),
    dhaEligibilitySchemes: jsonb('dha_eligibility_schemes'),

    guardianName: text('guardian_name'),

    guardianRelationship: text('guardian_relationship'),

    guardianPhone: text('guardian_phone'),

    guardianShaNumber: text('guardian_sha_number'),

    bloodGroup: text('blood_group'),

    maritalStatus: text('marital_status'),

    occupation: text('occupation'),

    county: text('county'),

    subCounty: text('sub_county'),

    residentialAddress: text('residential_address'),

    emergencyContactName: text('emergency_contact_name'),

    emergencyContactPhone: text('emergency_contact_phone'),

    emergencyContactRelationship: text('emergency_contact_relationship'),

    /*
      These remain as summary fields.

      Detailed clinical information should eventually
      live in dedicated clinical tables.
    */
    allergies: text('allergies'),

    chronicConditions: text('chronic_conditions'),

    payerType: text('payer_type').default('SELF_PAY').notNull(),

    insuranceProvider: text('insurance_provider'),

    policyNumber: text('policy_number'),

    /*
      ACTIVE
      INACTIVE
      DECEASED
      MERGED
    */
    status: text('status').default('ACTIVE').notNull(),

    deceasedAt: timestamp('deceased_at'),

    /*
      If duplicate patients are merged, retain
      the surviving patient relationship.
    */
    mergedIntoPatientId: integer('merged_into_patient_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('patients_tenant_idx').on(table.tenantId),

    registrationFacilityIdx: index('patients_registration_facility_idx').on(
      table.registrationFacilityId,
    ),

    nationalIdIdx: index('patients_national_id_idx').on(table.nationalId),

    shaIdx: index('patients_sha_idx').on(table.shaNumber),

    phoneIdx: index('patients_phone_idx').on(table.phone),

    statusIdx: index('patients_status_idx').on(table.status),

    mergedIntoIdx: index('patients_merged_into_idx').on(table.mergedIntoPatientId),
  }),
);
/* ============================================================
   PATIENT ALLERGIES
   ============================================================

   A structured allergy registry, not a free-text summary.

   `patients.allergies` already existed but nothing wrote to it: a
   prescribing system with no allergy record cannot warn anyone. This
   table records what the reaction was, how severe it was, and who
   recorded it, which is what a warning needs in order to be credible
   and auditable.

   A resolved allergy is kept, not deleted: "the patient reacted to
   penicillin in 2019" remains clinically relevant after the episode.
   Entered-in-error is a distinct status so a mistake can be withdrawn
   without erasing the fact that someone recorded it.
   ============================================================ */

export const patientAllergies = pgTable(
  'patient_allergies',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id, { onDelete: 'cascade' })
      .notNull(),

    /* DRUG / FOOD / ENVIRONMENTAL / OTHER */
    allergenType: text('allergen_type').default('DRUG').notNull(),

    allergen: text('allergen').notNull(),

    reaction: text('reaction'),

    /* MILD / MODERATE / SEVERE / LIFE_THREATENING */
    severity: text('severity').default('MODERATE').notNull(),

    /* ACTIVE / RESOLVED / ENTERED_IN_ERROR */
    status: text('status').default('ACTIVE').notNull(),

    notes: text('notes'),

    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),

    recordedAt: timestamp('recorded_at').defaultNow().notNull(),

    resolvedAt: timestamp('resolved_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('patient_allergies_patient_idx').on(table.patientId, table.status),

    tenantIdx: index('patient_allergies_tenant_idx').on(table.tenantId),

    facilityIdx: index('patient_allergies_facility_idx').on(table.facilityId),
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
    relationshipType: text('relationship_type').default('CARE').notNull(),

    /*
      ACTIVE
      INACTIVE
    */
    status: text('status').default('ACTIVE').notNull(),

    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),

    lastSeenAt: timestamp('last_seen_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('patient_facilities_patient_idx').on(table.patientId),

    facilityIdx: index('patient_facilities_facility_idx').on(table.facilityId),

    tenantIdx: index('patient_facilities_tenant_idx').on(table.tenantId),

    patientFacilityUnique: uniqueIndex('patient_facilities_unique_idx').on(
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
    status: text('status').default('PENDING').notNull(),

    /*
      Indicates that the patient has completed
      portal verification.
    */
    accountVerifiedAt: timestamp('account_verified_at'),

    /*
      Timestamp of first successful portal activation.
    */
    activatedAt: timestamp('activated_at'),

    lastPortalLoginAt: timestamp('last_portal_login_at'),

    lastPortalAccessAt: timestamp('last_portal_access_at'),

    disabledAt: timestamp('disabled_at'),

    disabledReason: text('disabled_reason'),

    /*
      Used for portal preferences without mixing
      clinical information into the authentication table.
    */
    preferences: jsonb('preferences').default({}).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex('patient_accounts_user_idx').on(table.userId),

    patientIdx: uniqueIndex('patient_accounts_patient_idx').on(table.patientId),

    statusIdx: index('patient_accounts_status_idx').on(table.status),
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
    idType: text('id_type').notNull(),

    idValue: text('id_value').notNull(),

    issuingAuthority: text('issuing_authority'),

    isPrimary: boolean('is_primary').default(false).notNull(),

    verified: boolean('verified').default(false).notNull(),

    verifiedAt: timestamp('verified_at'),

    verifiedByUserId: integer('verified_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdentifierIdx: index('patient_identifiers_patient_idx').on(table.patientId),

    typeValueIdx: index('patient_identifiers_type_value_idx').on(table.idType, table.idValue),

    verifiedIdx: index('patient_identifiers_verified_idx').on(table.verified),
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

    grantedByUserId: integer('granted_by_user_id').references(() => users.id),

    recipientFacilityId: integer('recipient_facility_id').references(() => facilities.id),

    recipientUserId: integer('recipient_user_id').references(() => users.id),

    purpose: text('purpose').notNull(),

    /*
      ACTIVE
      REVOKED
      EXPIRED
      USED
    */
    status: text('status').default('ACTIVE').notNull(),

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
    scope: jsonb('scope').default({}).notNull(),

    grantedAt: timestamp('granted_at').defaultNow().notNull(),

    expiresAt: timestamp('expires_at'),

    revokedAt: timestamp('revoked_at'),

    revokedByUserId: integer('revoked_by_user_id').references(() => users.id),

    consentVersion: integer('consent_version').default(1).notNull(),

    /*
      Stores the version of the consent form/
      terms that the patient accepted.
    */
    consentDocumentHash: text('consent_document_hash'),

    /*
      Useful for electronic consent evidence.
    */
    consentMethod: text('consent_method'),

    /*
      PATIENT_PORTAL
      STAFF
      EMERGENCY
      OTHER
    */
    grantedThrough: text('granted_through'),

    metadata: jsonb('metadata').default({}).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('patient_consents_patient_idx').on(table.patientId),

    recipientFacilityIdx: index('patient_consents_recipient_facility_idx').on(
      table.recipientFacilityId,
    ),

    recipientUserIdx: index('patient_consents_recipient_user_idx').on(table.recipientUserId),

    statusIdx: index('patient_consents_status_idx').on(table.status),

    expiryIdx: index('patient_consents_expiry_idx').on(table.expiresAt),
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

    userId: integer('user_id').references(() => users.id),

    facilityId: integer('facility_id').references(() => facilities.id),

    tenantId: integer('tenant_id').references(() => tenants.id),

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
    action: text('action').notNull(),

    /*
      PATIENT_PORTAL
      STAFF_PORTAL
      API
      REFERRAL
      FHIR
      EMERGENCY
    */
    accessChannel: text('access_channel'),

    recordType: text('record_type'),

    recordId: integer('record_id'),

    purpose: text('purpose'),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('patient_record_access_patient_idx').on(table.patientId),

    userIdx: index('patient_record_access_user_idx').on(table.userId),

    facilityIdx: index('patient_record_access_facility_idx').on(table.facilityId),

    createdIdx: index('patient_record_access_created_idx').on(table.createdAt),
  }),
);

/* ============================================================
   23. REFERRALS
   ============================================================ */

export const referrals = pgTable(
  'referrals',
  {
    id: serial('id').primaryKey(),

    referralNumber: text('referral_number').notNull().unique(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    sourceTenantId: integer('source_tenant_id')
      .references(() => tenants.id)
      .notNull(),

    sourceFacilityId: integer('source_facility_id')
      .references(() => facilities.id)
      .notNull(),

    destinationTenantId: integer('destination_tenant_id').references(() => tenants.id),

    destinationFacilityId: integer('destination_facility_id').references(() => facilities.id),

    destinationDepartmentId: integer('destination_department_id').references(() => departments.id),

    externalDestinationName: text('external_destination_name'),

    externalDestinationContact: text('external_destination_contact'),

    referringPractitionerId: integer('referring_practitioner_id').references(
      () => practitioners.id,
    ),

    referredByUserId: integer('referred_by_user_id').references(() => users.id),

    receivingPractitionerId: integer('receiving_practitioner_id').references(
      () => practitioners.id,
    ),

    reason: text('reason').notNull(),

    clinicalSummary: text('clinical_summary'),

    /*
      ROUTINE
      URGENT
      EMERGENCY
    */
    urgency: text('urgency').default('ROUTINE').notNull(),

    /*
      DRAFT
      SENT
      ACCEPTED
      DECLINED
      PATIENT_SEEN
      COMPLETED
      CANCELLED
    */
    status: text('status').default('DRAFT').notNull(),

    requestedAt: timestamp('requested_at'),

    sentAt: timestamp('sent_at'),

    acceptedAt: timestamp('accepted_at'),

    patientSeenAt: timestamp('patient_seen_at'),

    completedAt: timestamp('completed_at'),

    cancelledAt: timestamp('cancelled_at'),

    cancellationReason: text('cancellation_reason'),

    /*
      Clinical response from receiving facility.
    */
    receivingClinicalSummary: text('receiving_clinical_summary'),

    receivingNotes: text('receiving_notes'),

    responseAt: timestamp('response_at'),

    metadata: jsonb('metadata').default({}).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('referrals_patient_idx').on(table.patientId),

    sourceFacilityIdx: index('referrals_source_facility_idx').on(table.sourceFacilityId),

    destinationFacilityIdx: index('referrals_destination_facility_idx').on(
      table.destinationFacilityId,
    ),

    destinationDepartmentIdx: index('referrals_destination_department_idx').on(
      table.destinationDepartmentId,
    ),

    statusIdx: index('referrals_status_idx').on(table.status),

    referralNumberIdx: uniqueIndex('referrals_number_idx').on(table.referralNumber),
  }),
);

/* ============================================================
   24. REFERRAL DOCUMENTS
   ============================================================ */

export const referralDocuments = pgTable(
  'referral_documents',
  {
    id: serial('id').primaryKey(),

    referralId: integer('referral_id')
      .references(() => referrals.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    documentType: text('document_type').notNull(),

    documentName: text('document_name').notNull(),

    storageKey: text('storage_key'),

    /*
      Avoid treating this as a permanent public URL.
      Prefer signed/private storage access.
    */
    documentUrl: text('document_url'),

    mimeType: text('mime_type'),

    fileSize: integer('file_size'),

    documentHash: text('document_hash'),

    uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    referralIdx: index('referral_documents_referral_idx').on(table.referralId),

    patientIdx: index('referral_documents_patient_idx').on(table.patientId),
  }),
);

/* ============================================================
   25. REFERRAL ACCESS LOG
   ============================================================ */

export const referralAccessLogs = pgTable(
  'referral_access_logs',
  {
    id: serial('id').primaryKey(),

    referralId: integer('referral_id')
      .references(() => referrals.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    userId: integer('user_id').references(() => users.id),

    facilityId: integer('facility_id').references(() => facilities.id),

    /*
      VIEW
      DOWNLOAD
      ACCEPT
      DECLINE
      UPLOAD
      COMPLETE
    */
    action: text('action').notNull(),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    referralIdx: index('referral_access_logs_referral_idx').on(table.referralId),

    patientIdx: index('referral_access_logs_patient_idx').on(table.patientId),

    userIdx: index('referral_access_logs_user_idx').on(table.userId),
  }),
);

/* ============================================================
   26. HEALTH RECORD EXPORTS
   ============================================================ */

export const healthRecordExports = pgTable(
  'health_record_exports',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    requestedByUserId: integer('requested_by_user_id')
      .references(() => users.id)
      .notNull(),

    /*
      PDF
      JSON
      FHIR_JSON
    */
    format: text('format').notNull(),

    /*
      REQUESTED
      PROCESSING
      READY
      EXPIRED
      FAILED
    */
    status: text('status').default('REQUESTED').notNull(),

    scope: jsonb('scope').default({}).notNull(),

    storageKey: text('storage_key'),

    documentHash: text('document_hash'),

    expiresAt: timestamp('expires_at'),

    downloadedAt: timestamp('downloaded_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    completedAt: timestamp('completed_at'),

    failureReason: text('failure_reason'),
  },
  (table) => ({
    patientIdx: index('health_record_exports_patient_idx').on(table.patientId),

    requesterIdx: index('health_record_exports_requester_idx').on(table.requestedByUserId),

    statusIdx: index('health_record_exports_status_idx').on(table.status),

    expiryIdx: index('health_record_exports_expiry_idx').on(table.expiresAt),
  }),
);

/* ============================================================
   27. HEALTH RECORD IMPORTS
   ============================================================ */

export const healthRecordImports = pgTable(
  'health_record_imports',
  {
    id: serial('id').primaryKey(),

    patientId: integer('patient_id').references(() => patients.id),

    targetTenantId: integer('target_tenant_id')
      .references(() => tenants.id)
      .notNull(),

    targetFacilityId: integer('target_facility_id')
      .references(() => facilities.id)
      .notNull(),

    uploadedByUserId: integer('uploaded_by_user_id')
      .references(() => users.id)
      .notNull(),

    sourceFacilityName: text('source_facility_name'),

    sourceFacilityId: integer('source_facility_id').references(() => facilities.id),

    /*
      External source system identifier.
      Useful for interoperability.
    */
    sourceSystem: text('source_system'),

    sourceRecordId: text('source_record_id'),

    format: text('format').notNull(),

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
    status: text('status').default('UPLOADED').notNull(),

    storageKey: text('storage_key'),

    documentHash: text('document_hash'),

    validationErrors: jsonb('validation_errors').default([]).notNull(),

    importSummary: jsonb('import_summary').default({}).notNull(),

    matchedPatientId: integer('matched_patient_id').references(() => patients.id),

    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),

    reviewedAt: timestamp('reviewed_at'),

    importedAt: timestamp('imported_at'),

    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    targetFacilityIdx: index('health_record_imports_target_facility_idx').on(
      table.targetFacilityId,
    ),

    patientIdx: index('health_record_imports_patient_idx').on(table.patientId),

    matchedPatientIdx: index('health_record_imports_matched_patient_idx').on(
      table.matchedPatientId,
    ),

    statusIdx: index('health_record_imports_status_idx').on(table.status),
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

/* ============================================================
   25. MEDICATIONS & PRESCRIPTIONS
   ============================================================ */

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

  testName: text('test_name').notNull(),

  status: text('status').default('Ordered'),
  clinicalIndication: text('clinical_indication'),

  specimenType: text('specimen_type'),

  priority: text('priority').default('Routine'),

  clinicalNotes: text('clinical_notes'),

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

    category: text('category').default('Pharmaceuticals'),

    unit: text('unit').default('Tablets'),

    strength: text('strength'),

    dosageForm: text('dosage_form'),

    currentStock: integer('current_stock').default(0),

    reorderLevel: integer('reorder_level').default(50),

    unitCost: numeric('unit_cost', {
      precision: 10,
      scale: 2,
    }).default('0'),

    sellingPrice: numeric('selling_price', {
      precision: 10,
      scale: 2,
    }).default('0'),

    storeLocation: text('store_location').default('Main Pharmacy Store'),

    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityItemCodeIdx: uniqueIndex('inventory_items_facility_code_idx').on(
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

    batchNumber: text('batch_number').notNull(),

    expiryDate: text('expiry_date').notNull(),

    quantityRemaining: integer('quantity_remaining').notNull(),

    costPerUnit: numeric('cost_per_unit', {
      precision: 10,
      scale: 2,
    }).default('0'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    itemBatchIdx: uniqueIndex('inventory_batches_item_batch_idx').on(
      table.itemId,
      table.batchNumber,
    ),
  }),
);

/* ============================================================
   36. PHARMACY DISPENSATIONS
   ============================================================ */

export const pharmacyDispensations = pgTable('pharmacy_dispensations', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  prescriptionId: integer('prescription_id').references(() => medications.id),

  patientId: integer('patient_id')
    .references(() => patients.id)
    .notNull(),

  itemId: integer('item_id').references(() => inventoryItems.id),

  batchNumber: text('batch_number'),

  quantityDispensed: integer('quantity_dispensed').notNull(),

  dispensedBy: text('dispensed_by').notNull(),

  dispensedAt: timestamp('dispensed_at').defaultNow().notNull(),

  notes: text('notes'),
});

/* ============================================================
   37. SUPPLIERS
   ============================================================ */

export const suppliers = pgTable('suppliers', {
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

  isActive: boolean('is_active').default(true),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   38. PURCHASE ORDERS
   ============================================================ */

export const purchaseOrders = pgTable('purchase_orders', {
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

  poNumber: text('po_number').notNull().unique(),

  totalAmount: numeric('total_amount', {
    precision: 12,
    scale: 2,
  }).default('0'),

  status: text('status').default('Pending Approval'),

  orderedBy: text('ordered_by'),

  approvedBy: text('approved_by'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   39. BILLING INVOICES
   ============================================================ */

export const facilityServiceTariffs = pgTable(
  'facility_service_tariffs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    department: text('department').notNull(),
    unit: text('unit').notNull().default('Service'),
    fee: numeric('fee', { precision: 10, scale: 2 }).notNull(),
    shaStatus: text('sha_status').notNull().default('Not Assessed'),
    shaNotes: text('sha_notes'),
    /*
     * Which automatic charge this tariff answers, if any.
     *
     * Facilities number their tariffs (`OPD-001`, `LAB-006`) rather than
     * using the codes the billing engine looks for, so a price list can
     * exist and still bill nothing. This column records the link the
     * facility makes, once, instead of the engine guessing between
     * OPD-001 (150) and OPD-002 (300).
     *
     * NULL means "not linked"; the tariff is still reachable by code.
     * See migration 0019 and `src/billing/tariff-codes.ts` for the
     * vocabulary.
     */
    billingKey: text('billing_key'),

    /*
     * When this price applies. Both nullable: NULL means "always", so
     * every existing row keeps working and no date had to be invented
     * for it. A resolver checks today's date against the pair.
     */
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),

    /*
     * Whether automatic billing may use this tariff. Default true, so
     * behaviour is unchanged; a facility can keep a tariff for manual
     * pricing while excluding it from automatic charging.
     */
    autoBill: boolean('auto_bill').notNull().default(true),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('facility_service_tariffs_facility_code_unique').on(table.facilityId, table.code),
    index('facility_service_tariffs_tenant_facility_idx').on(table.tenantId, table.facilityId),
    index('facility_service_tariffs_active_idx').on(table.facilityId, table.isActive),
  ],
);
export const billingInvoices = pgTable('billing_invoices', {
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

  invoiceNumber: text('invoice_number').notNull().unique(),

  totalAmount: numeric('total_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  paidAmount: numeric('paid_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  balanceAmount: numeric('balance_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  status: text('status').default('Pending'),

  /*
   * Money received beyond the invoice total. Kept as its own column
   * instead of letting balance_amount go negative, because a negative
   * balance silently cancels out other patients' debts whenever the
   * facility totals what it is owed.
   */
  creditBalance: numeric('credit_balance', {
    precision: 10,
    scale: 2,
  }).default('0'),

  payerType: text('payer_type').default('Self-Pay'),

  payerName: text('payer_name'),

  memberNumber: text('member_number'),

  voidedAt: timestamp('voided_at'),

  voidReason: text('void_reason'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   40. BILLING ITEMS
   ============================================================ */

export const billingItems = pgTable('billing_items', {
  id: serial('id').primaryKey(),

  invoiceId: integer('invoice_id')
    .references(() => billingInvoices.id)
    .notNull(),

  tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
    onDelete: 'set null',
  }),

  tariffCode: text('tariff_code'),

  /*
   * Provenance: which clinical event produced this line item.
   *
   *   CONSULTATION | LAB_ORDER | PROCEDURE | RADIOLOGY | PHARMACY
   *   ADMISSION | BED_DAY | MANUAL
   */
  sourceType: text('source_type'),

  sourceId: integer('source_id'),

  /*
   * Idempotency key for engine-generated charges, enforced by a UNIQUE
   * partial index in migration 0009. Replaying a clinical event can
   * never create a second charge. Manual items leave this NULL.
   */
  idempotencyKey: text('idempotency_key'),

  itemType: text('item_type').notNull(),

  description: text('description').notNull(),

  quantity: integer('quantity').default(1),

  unitPrice: numeric('unit_price', {
    precision: 10,
    scale: 2,
  }).default('0'),

  totalAmount: numeric('total_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * The link between a catalogue service and the price that answers it.
 *
 * `service_id` is the stable id of the catalogue row — `lab_tests.id`
 * for a laboratory test — not a code someone can rename. `NULL` means
 * the link covers every service of that type.
 *
 * Why a table instead of comparing strings: the engine used to ask for
 * `LAB-BLOOD` when the facility's row was `LAB-001`, and every failure
 * mode (missing, inactive, expired, another facility, ambiguous) looked
 * identical from the outside. A link by id cannot be ambiguous, and a
 * link can be validated field by field.
 *
 * The composite foreign key to `(facility_id, id)` means a link can
 * only reference a tariff of the same facility: isolation is a
 * constraint, not a convention.
 *
 * See migration 0021.
 */
export const serviceTariffLinks = pgTable(
  'service_tariff_links',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    /** LAB_TEST | CONSULTATION | RADIOLOGY | … (see migration 0021). */
    serviceType: text('service_type').notNull(),

    /** Catalogue row id; NULL links the whole family. */
    serviceId: integer('service_id'),

    /** Snapshot of the catalogue code and name at link time. */
    serviceCode: text('service_code'),
    serviceName: text('service_name'),

    tariffId: integer('tariff_id').notNull(),

    autoBill: boolean('auto_bill').notNull().default(true),

    note: text('note'),
    createdBy: text('created_by'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('service_tariff_links_service_unique')
      .on(table.facilityId, table.serviceType, table.serviceId)
      .where(sql`${table.isActive} AND ${table.serviceId} is not null`),
    uniqueIndex('service_tariff_links_family_unique')
      .on(table.facilityId, table.serviceType)
      .where(sql`${table.isActive} AND ${table.serviceId} is null`),
    index('service_tariff_links_facility_idx').on(
      table.tenantId,
      table.facilityId,
      table.serviceType,
    ),
    index('service_tariff_links_tariff_idx').on(table.tariffId),
  ],
);

/**
 * A charge the billing engine could not price.
 *
 * The clinical action succeeded but no invoice line exists, so the
 * money owed is invisible. This row keeps the original request so the
 * charge can be replayed once the facility configures a tariff — and so
 * the configuration screen can say what is waiting.
 *
 * See migration 0020. Status: PENDING | BILLED | DUPLICATE | VOID.
 */
export const billingChargeAttempts = pgTable(
  'billing_charge_attempts',
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

    encounterId: integer('encounter_id'),

    sourceType: text('source_type').notNull(),
    sourceId: integer('source_id'),
    itemType: text('item_type').notNull(),
    description: text('description'),

    /** Candidates the engine tried, in priority order. */
    codes: text('codes').array().notNull().default([]),
    /** Linked keys the facility can set (`CONSULTATION`). */
    serviceKeys: text('service_keys').array().notNull().default([]),

    family: text('family'),
    serviceName: text('service_name'),
    encounterType: text('encounter_type'),
    aliases: text('aliases').array().notNull().default([]),

    /*
     * Which occurrence of the source this is: the bed-night date for a
     * ward charge (`BED_DAY:12:2026-10-20`), null when the source is
     * billed once. Without it, a five-night stay with no tariff would
     * collapse into a single queue row and only one night could ever be
     * reprocessed.
     */
    idempotencySuffix: text('idempotency_suffix'),

    /** Bed category at accrual time, so a replay prices the same bed. */
    wardType: text('ward_type'),
    wardName: text('ward_name'),

    quantity: integer('quantity').notNull().default(1),
    fallbackUnitPrice: numeric('fallback_unit_price', { precision: 10, scale: 2 }),

    reason: text('reason').notNull(),
    detail: text('detail'),
    codesTried: text('codes_tried').array().notNull().default([]),

    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(1),
    lastAttemptAt: timestamp('last_attempt_at').defaultNow().notNull(),

    resolvedItemId: integer('resolved_item_id'),
    resolvedInvoiceId: integer('resolved_invoice_id'),
    resolvedTariffCode: text('resolved_tariff_code'),
    resolvedUnitPrice: numeric('resolved_unit_price', { precision: 10, scale: 2 }),
    resolvedAt: timestamp('resolved_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('billing_charge_attempts_pending_unique')
      .on(
        table.facilityId,
        table.sourceType,
        table.sourceId,
        table.itemType,
        sql`coalesce(${table.idempotencySuffix}, '')`,
      )
      .where(sql`${table.status} = 'PENDING' AND ${table.sourceId} is not null`),
    index('billing_charge_attempts_facility_status_idx').on(
      table.tenantId,
      table.facilityId,
      table.status,
    ),
    index('billing_charge_attempts_patient_idx').on(table.patientId),
  ],
);

/* ============================================================
   41. BILLING PAYMENTS
   ============================================================ */

export const billingPayments = pgTable('billing_payments', {
  id: serial('id').primaryKey(),

  invoiceId: integer('invoice_id')
    .references(() => billingInvoices.id)
    .notNull(),

  receiptNumber: text('receipt_number').notNull().unique(),

  paymentMethod: text('payment_method').default('M-Pesa'),

  amount: numeric('amount', {
    precision: 10,
    scale: 2,
  }).notNull(),

  referenceCode: text('reference_code'),

  /*
   * The code printed on the customer's M-Pesa or Airtel confirmation
   * message. Distinct from reference_code so reconciliation can match
   * against a mobile money statement without parsing free text.
   */
  transactionCode: text('transaction_code'),

  /* FULLY_PAID | BALANCE_REMAINING | OVERPAID at the moment of posting. */
  settlementStatus: text('settlement_status'),

  cashierName: text('cashier_name').notNull(),

  paymentDate: timestamp('payment_date').defaultNow().notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ============================================================
   42. INSURANCE / SHA CLAIMS
   ============================================================ */

export const insuranceClaims = pgTable('insurance_claims', {
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

  claimNumber: text('claim_number').notNull().unique(),

  payerName: text('payer_name').default('Social Health Authority (SHA)'),

  policyNumber: text('policy_number'),

  preAuthCode: text('pre_auth_code'),

  claimAmount: numeric('claim_amount', {
    precision: 10,
    scale: 2,
  }).notNull(),

  approvedAmount: numeric('approved_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  status: text('status').default('Draft'),

  submittedAt: timestamp('submitted_at'),

  adjudicationNotes: text('adjudication_notes'),

  /*
   * The payment that settled this claim. Set when an approved amount
   * is posted against the invoice; null while the money is outstanding.
   */
  settledPaymentId: integer('settled_payment_id').references(() => billingPayments.id, {
    onDelete: 'set null',
  }),

  settledAt: timestamp('settled_at'),

  createdByUserId: integer('created_by_user_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   42b. INSURANCE CLAIM ITEMS
   ============================================================ */

export const insuranceClaimItems = pgTable('insurance_claim_items', {
  id: serial('id').primaryKey(),

  claimId: integer('claim_id')
    .references(() => insuranceClaims.id, { onDelete: 'cascade' })
    .notNull(),

  billingItemId: integer('billing_item_id').references(() => billingItems.id, {
    onDelete: 'set null',
  }),

  /*
   * Snapshot of the line at claim time. The invoice may be edited or
   * voided later; the claim must still say what it asked for.
   */
  description: text('description').notNull(),

  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ============================================================
   43. PUBLIC HEALTH REPORTS
   ============================================================ */

export const publicHealthReports = pgTable('public_health_reports', {
  id: serial('id').primaryKey(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  diseaseCode: text('disease_code').notNull(),

  diseaseName: text('disease_name').notNull(),

  casesCount: integer('cases_count').default(1),

  mortalityCount: integer('mortality_count').default(0),

  ageGroup: text('age_group').default('Over 5 Years'),

  epiWeek: text('epi_week').notNull(),

  reportedAt: timestamp('reported_at').defaultNow().notNull(),

  reportedBy: text('reported_by'),

  status: text('status').default('DRAFT'),

  submittedAt: timestamp('submitted_at'),

  submissionReference: text('submission_reference'),
});

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

    action: text('action').notNull(),

    resource: text('resource').notNull(),

    resourceId: text('resource_id'),

    details: text('details'),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    requestId: text('request_id'),

    severity: text('severity').default('INFO'),

    /*
      Examples:
      INFO
      WARNING
      HIGH
      CRITICAL
    */

    timestamp: timestamp('timestamp').defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('audit_logs_tenant_idx').on(table.tenantId),

    facilityIdx: index('audit_logs_facility_idx').on(table.facilityId),

    userIdx: index('audit_logs_user_idx').on(table.userId),

    actionIdx: index('audit_logs_action_idx').on(table.action),

    timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
  }),
);

/* ============================================================
   FACILITY SUBSCRIPTIONS
   Separate from patient billing and facilities.is_active.
   ============================================================ */

/* ============================================================
   44b. MATERNITY / MCH
   ============================================================

   One pregnancy, many antenatal visits. If the patient labours with us,
   the pregnancy gets one labour record, which carries the partograph
   rows, and one delivery, which carries one row per baby.

   Why the split:

   - ANC happens months before labour and must survive a labour that is
     never recorded here (a referral, a home birth, a caesarean booked
     elsewhere).
   - A partograph is a time series, not a form. Six hours of labour is
     twelve observations at half-hourly intervals, and each has to keep
     its own timestamp.
   - Twins are one delivery and two babies. A single delivery row with
     `baby1_*`/`baby2_*` columns cannot express a third baby, and cannot
     be aggregated.

   Every table carries tenant and facility, because every one of these
   rows is a clinical record that must be scoped on read.

   No clinical values are seeded. Fields are nullable where a real
   encounter may genuinely not have the measurement, and the service
   refuses to invent one.
   ============================================================ */

export const maternityPregnancies = pgTable(
  'maternity_pregnancies',
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

    /* Booking date and the dating that everything else is measured from. */
    bookedAt: text('booked_at').notNull(),

    lmpDate: text('lmp_date'),

    eddDate: text('edd_date').notNull(),

    /*
     * LMP | Ultrasound | Other. An EDD from the last menstrual period and
     * an EDD from a scan legitimately disagree; recording which one is in
     * use stops the next clinician silently "correcting" it.
     */
    eddBasis: text('edd_basis').default('LMP').notNull(),

    /* Obstetric history at booking. */
    gravida: integer('gravida'),
    para: integer('para'),
    abortions: integer('abortions'),
    livingChildren: integer('living_children'),

    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    bloodGroup: text('blood_group'),
    rhesus: text('rhesus'),
    haemoglobinGdl: numeric('haemoglobin_gdl', { precision: 4, scale: 1 }),

    /* Free text on purpose: risk is a clinical judgement, not a checkbox. */
    riskFactors: text('risk_factors'),

    /* Active | Delivered | Closed | Transferred */
    status: text('status').default('Active').notNull(),

    closedAt: text('closed_at'),
    closedReason: text('closed_reason'),

    createdBy: integer('created_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('maternity_pregnancies_patient_idx').on(
      table.tenantId,
      table.patientId,
      table.status,
    ),

    facilityIdx: index('maternity_pregnancies_facility_idx').on(table.facilityId, table.status),

    /*
     * A patient cannot be booked twice for the same pregnancy. Two active
     * records would split the ANC history and make the EDD ambiguous, so
     * the database refuses the second one rather than the screen.
     */
    oneActiveIdx: uniqueIndex('maternity_pregnancies_one_active_idx')
      .on(table.tenantId, table.patientId)
      .where(sql`status = 'Active'`),
  }),
);

export const ancVisits = pgTable(
  'anc_visits',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    visitDate: text('visit_date').notNull(),

    /*
     * Recorded by hand rather than derived from the count of rows: the
     * MOH 405 card numbers visits in order and a woman may arrive having
     * attended elsewhere.
     */
    visitNumber: integer('visit_number'),

    gestationWeeks: integer('gestation_weeks'),
    gestationDays: integer('gestation_days'),

    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    pulseBpm: integer('pulse_bpm'),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),

    fundalHeightCm: numeric('fundal_height_cm', { precision: 4, scale: 1 }),
    fetalHeartRateBpm: integer('fetal_heart_rate_bpm'),
    presentation: text('presentation'),
    fetalMovements: text('fetal_movements'),

    /* Negative | Trace | + | ++ | +++ */
    urineProtein: text('urine_protein'),
    urineGlucose: text('urine_glucose'),

    haemoglobinGdl: numeric('haemoglobin_gdl', { precision: 4, scale: 1 }),

    /* Tetanus-toxoid dose number: 1 to 5. */
    ttDose: integer('tt_dose'),
    ifasDispensed: boolean('ifas_dispensed').default(false).notNull(),

    /* Danger signs seen today, in the words of whoever saw them. */
    dangerSigns: text('danger_signs'),
    notes: text('notes'),
    nextVisitDate: text('next_visit_date'),

    recordedBy: integer('recorded_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('anc_visits_pregnancy_idx').on(table.pregnancyId, table.visitDate),

    facilityIdx: index('anc_visits_facility_idx').on(table.facilityId, table.visitDate),
  }),
);

export const labourRecords = pgTable(
  'labour_records',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    encounterId: integer('encounter_id').references(() => encounters.id),

    admittedAt: text('admitted_at').notNull(),

    labourOnsetAt: text('labour_onset_at'),
    membranesRupturedAt: text('membranes_ruptured_at'),

    gestationWeeksAtAdmission: integer('gestation_weeks_at_admission'),

    /* In Labour | Delivered | Referred | Closed */
    status: text('status').default('In Labour').notNull(),

    notes: text('notes'),

    createdBy: integer('created_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('labour_records_pregnancy_idx').on(table.pregnancyId, table.admittedAt),

    facilityStatusIdx: index('labour_records_facility_status_idx').on(
      table.facilityId,
      table.status,
    ),
  }),
);

export const partographEntries = pgTable(
  'partograph_entries',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    labourRecordId: integer('labour_record_id')
      .references(() => labourRecords.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    /*
     * Minutes matter on a partograph: the alert and action lines are read
     * against time since admission, so this is a timestamp, not a date.
     */
    recordedAt: text('recorded_at').notNull(),

    cervicalDilatationCm: numeric('cervical_dilatation_cm', {
      precision: 4,
      scale: 1,
    }),

    /*
     * Station of the presenting part, -3 to +3. Zero is at the ischial
     * spines; negative is above them.
     */
    descentStation: integer('descent_station'),

    contractionsPer10Min: integer('contractions_per_10_min'),

    /* Seconds. Recorded separately: 3 in 10 of 40 s is not 4 in 10 of 20 s. */
    contractionDurationSec: integer('contraction_duration_sec'),

    fetalHeartRateBpm: integer('fetal_heart_rate_bpm'),

    /* Intact | Ruptured */
    membranes: text('membranes'),

    /* Clear | Meconium I | Meconium II | Meconium III | Bloody | Absent */
    liquor: text('liquor'),

    maternalPulseBpm: integer('maternal_pulse_bpm'),
    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),

    oxytocin: text('oxytocin'),
    drugsGiven: text('drugs_given'),
    notes: text('notes'),

    recordedBy: integer('recorded_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    labourIdx: index('partograph_entries_labour_idx').on(table.labourRecordId, table.recordedAt),

    /*
     * Two observations claiming the same moment is a double entry, and on
     * a partograph it moves the plotted line. Refuse it.
     */
    uniqueReadingIdx: uniqueIndex('partograph_entries_labour_time_idx').on(
      table.labourRecordId,
      table.recordedAt,
    ),
  }),
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    labourRecordId: integer('labour_record_id').references(() => labourRecords.id),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    deliveredAt: text('delivered_at').notNull(),

    /*
     * Spontaneous Vertex | Assisted Vaginal | Breech | Vacuum |
     * Forceps | Caesarean Section
     */
    deliveryMode: text('delivery_mode').notNull(),

    bloodLossMl: integer('blood_loss_ml'),

    /* Intact | 1st Degree | 2nd Degree | 3rd Degree | 4th Degree | Episiotomy */
    perineum: text('perineum'),

    placentaComplete: boolean('placenta_complete'),
    placentaDeliveredAt: text('placenta_delivered_at'),
    oxytocinGiven: boolean('oxytocin_given').default(false).notNull(),

    complications: text('complications'),
    notes: text('notes'),

    deliveredBy: integer('delivered_by'),
    conductedByCadre: text('conducted_by_cadre'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('deliveries_pregnancy_idx').on(table.pregnancyId, table.deliveredAt),

    facilityIdx: index('deliveries_facility_idx').on(table.facilityId, table.deliveredAt),
  }),
);

export const deliveryBabies = pgTable(
  'delivery_babies',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    deliveryId: integer('delivery_id')
      .references(() => deliveries.id)
      .notNull(),

    /* 1 for a singleton, 1 and 2 for twins. */
    babyNumber: integer('baby_number').notNull(),

    /* Male | Female | Ambiguous | Not recorded */
    sex: text('sex'),

    birthWeightGrams: integer('birth_weight_grams'),

    /*
     * Apgar is nullable at each minute because a resuscitation may mean
     * the score was never taken. A zero is a real score; null is not.
     */
    apgar1: integer('apgar1'),
    apgar5: integer('apgar5'),
    apgar10: integer('apgar10'),

    /* Live Birth | Stillbirth Fresh | Stillbirth Macerated | Neonatal Death */
    outcome: text('outcome').notNull(),

    resuscitation: text('resuscitation'),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    deliveryIdx: uniqueIndex('delivery_babies_delivery_number_idx').on(
      table.deliveryId,
      table.babyNumber,
    ),
  }),
);

/* ============================================================
   44c. POSTNATAL CARE
   ============================================================

   One row per postnatal contact. The mother is the subject; the baby is
   noted on the same row because at this stage the two are seen together
   and a separate baby record would be empty for most visits.

   Postnatal visits hang off the pregnancy, not the delivery: a woman who
   delivered elsewhere still attends here for her six-week check.
   ============================================================ */

export const postnatalVisits = pgTable(
  'postnatal_visits',
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

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    deliveryId: integer('delivery_id').references(() => deliveries.id),

    visitDate: text('visit_date').notNull(),

    /* 1..n within this pregnancy, and the day counted from delivery. */
    visitNumber: integer('visit_number'),
    dayPostpartum: integer('day_postpartum'),

    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    pulseBpm: integer('pulse_bpm'),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),

    /* Involution: how far the fundus has descended, in cm. */
    fundalHeightCm: numeric('fundal_height_cm', { precision: 4, scale: 1 }),

    /* Normal | Subinvolution | Not examined */
    involution: text('involution'),

    /* Rubra | Serosa | Alba | Abnormal | Not examined */
    lochia: text('lochia'),

    /* Intact | Healing | Infected | Dehisced | Episiotomy healing */
    perineum: text('perineum'),

    /* Normal | Engorged | Cracked nipples | Mastitis */
    breasts: text('breasts'),

    /* Exclusive | Mixed | Formula | Not breastfeeding */
    breastfeeding: text('breastfeeding'),

    /*
     * Not a diagnosis. A recorded screening outcome, so the next
     * clinician knows whether anyone asked.
     */
    moodScreening: text('mood_screening'),

    haemoglobinGdl: numeric('haemoglobin_gdl', { precision: 4, scale: 1 }),

    dangerSigns: text('danger_signs'),
    notes: text('notes'),
    nextVisitDate: text('next_visit_date'),

    babyWeightGrams: integer('baby_weight_grams'),
    babyNotes: text('baby_notes'),

    recordedBy: integer('recorded_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('postnatal_visits_pregnancy_idx').on(table.pregnancyId, table.visitDate),

    facilityIdx: index('postnatal_visits_facility_idx').on(table.facilityId, table.visitDate),
  }),
);

/* ============================================================
   44d. IMMUNISATION
   ============================================================

   The antigen and dose are stored as administered. The schedule lives in
   code (`immunisation-contracts.ts`), not in this table: a schedule
   changes, a record of what was given does not.

   The unique index is the safety property that matters most here. Two
   doses of the same antigen on the same child at the same dose number is
   a double administration, and it is refused by the database rather than
   by a screen that someone may not be looking at.
   ============================================================ */

export const immunisationRecords = pgTable(
  'immunisation_records',
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

    /* Set when the child was born here and the link is known. */
    deliveryId: integer('delivery_id').references(() => deliveries.id),

    deliveryBabyId: integer('delivery_baby_id').references(() => deliveryBabies.id),

    pregnancyId: integer('pregnancy_id').references(() => maternityPregnancies.id),

    /* BCG | OPV | PENTA | PCV | ROTA | IPV | MR | YF | HPV | Td */
    antigenCode: text('antigen_code').notNull(),

    doseNumber: integer('dose_number').default(1).notNull(),

    administeredOn: text('administered_on').notNull(),

    batchNumber: text('batch_number'),
    site: text('site'),

    /* Intradermal | Subcutaneous | Intramuscular | Oral */
    route: text('route'),

    administeredBy: integer('administered_by'),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('immunisation_records_patient_idx').on(
      table.tenantId,
      table.patientId,
      table.administeredOn,
    ),

    facilityIdx: index('immunisation_records_facility_idx').on(
      table.facilityId,
      table.administeredOn,
    ),

    /*
     * A child cannot receive the same dose twice. This is the one
     * constraint a paper card cannot enforce.
     */
    uniqueDoseIdx: uniqueIndex('immunisation_records_dose_idx').on(
      table.tenantId,
      table.patientId,
      table.antigenCode,
      table.doseNumber,
    ),
  }),
);

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
export const staffProfessionalCredentials = pgTable('staff_professional_credentials', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),

  /** Set once the person accepts an invitation and has a user row. */
  userId: integer('user_id'),
  invitationId: integer('invitation_id'),

  regulator: text('regulator').notNull(),
  registrationNumber: text('registration_number').notNull(),

  licenceNumber: text('licence_number'),
  professionalCategory: text('professional_category'),
  specialty: text('specialty'),

  status: text('status').default('NOT_VERIFIED').notNull(),

  /** Raw regulator wording, kept separate from the licence fields. */
  registrationStatus: text('registration_status'),
  licenceStatus: text('licence_status'),

  licenceExpiry: date('licence_expiry'),
  lastVerifiedAt: timestamp('last_verified_at'),

  verificationSource: text('verification_source'),
  externalReference: text('external_reference'),
  responseReference: text('response_reference'),
  mode: text('mode'),

  verifiedBy: integer('verified_by'),

  manualReviewReason: text('manual_review_reason'),
  manualSource: text('manual_source'),
  manualCheckedAt: timestamp('manual_checked_at'),

  /** Concerns raised by the normaliser, in plain language. */
  warnings: jsonb('warnings'),
  /** Candidate keys that matched; no values are stored here. */
  matchedFields: jsonb('matched_fields'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Append-only history. Every verification attempt, manual check and
 * administrative decision is recorded here, including the failures, so a
 * gap in the audit trail cannot be mistaken for a clean record.
 */
export const professionalVerificationEvents = pgTable('professional_verification_events', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),

  credentialId: integer('credential_id'),
  userId: integer('user_id'),
  invitationId: integer('invitation_id'),

  action: text('action').notNull(),
  statusBefore: text('status_before'),
  statusAfter: text('status_after'),

  source: text('source'),
  mode: text('mode'),
  httpStatus: integer('http_status'),
  errorCode: text('error_code'),

  performedBy: integer('performed_by'),
  notes: text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ============================================================
   DHA SERVICE-AREA MAPPINGS
   ============================================================ */

/**
 * Which DHA intervention code covers each service area at this facility.
 *
 * The code is entered by an administrator from the DHA portal. It is
 * never seeded, generated or inferred: an invented intervention code
 * produces a rejected claim, and a wrong one tells the authority
 * something untrue about the care that was delivered.
 *
 * A unique index on (facility_id, service_area) lives in migration 0013,
 * so a claim line can never resolve to two codes.
 */
export const dhaServiceMappings = pgTable('dha_service_mappings', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),

  /* One of DhaServiceAreaId, validated in dha.service-areas.ts. */
  serviceArea: text('service_area').notNull(),

  interventionCode: text('intervention_code').notNull(),

  /* Documented DHA enums. Null until the administrator records them. */
  accessPoint: text('access_point'),
  paymentMechanism: text('payment_mechanism'),
  fund: text('fund'),
  needsPreauth: boolean('needs_preauth'),

  notes: text('notes'),
  createdBy: integer('created_by'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dhaApiCalls = pgTable('dha_api_calls', {
  id: serial('id').primaryKey(),

  tenantId: integer('tenant_id'),
  facilityId: integer('facility_id'),
  userId: integer('user_id'),

  mode: text('mode').notNull(),
  operation: text('operation').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),

  status: integer('status'),
  durationMs: integer('duration_ms').default(0).notNull(),
  outcome: text('outcome').notNull(),
  errorCode: text('error_code'),
  requestId: text('request_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ============================================================
   PATIENT DIGITAL HEALTH RECORD PORTAL
   ============================================================
 *
 * These tables hold a *patient-facing identity*, deliberately separate
 * from `users`. A portal account has no role, no permission and no
 * reach into the staff API surface; it can only read the record of the
 * one patient it is linked to.
 *
 * The companion migration is `drizzle/0018_patient_portal.sql`.
 */

export const patientPortalAccounts = pgTable(
  'patient_portal_accounts',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id').references(() => facilities.id),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    loginIdentifier: text('login_identifier').notNull(),

    loginType: text('login_type').default('PHONE').notNull(),

    passwordHash: text('password_hash').notNull(),

    /*
      PENDING_VERIFICATION | ACTIVE | SUSPENDED | REVOKED
    */
    status: text('status').default('ACTIVE').notNull(),

    mustChangePassword: boolean('must_change_password').default(false).notNull(),

    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),

    lockedUntil: timestamp('locked_until'),

    activatedAt: timestamp('activated_at'),

    lastLoginAt: timestamp('last_login_at'),

    suspendedAt: timestamp('suspended_at'),

    suspendedByUserId: integer('suspended_by_user_id').references(() => users.id),

    suspendedReason: text('suspended_reason'),

    revokedAt: timestamp('revoked_at'),

    revokedByUserId: integer('revoked_by_user_id').references(() => users.id),

    revokedReason: text('revoked_reason'),

    qrTokenHash: text('qr_token_hash'),

    qrTokenSealed: text('qr_token_sealed'),

    qrIssuedAt: timestamp('qr_issued_at'),

    securityVersion: integer('security_version').default(1).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: uniqueIndex('patient_portal_accounts_patient_idx').on(table.patientId),

    loginIdx: uniqueIndex('patient_portal_accounts_login_idx').on(table.loginIdentifier),

    scopeIdx: index('patient_portal_accounts_scope_idx').on(
      table.tenantId,
      table.facilityId,
      table.status,
    ),
  }),
);

export const patientPortalInvitations = pgTable(
  'patient_portal_invitations',
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

    tokenHash: text('token_hash').notNull(),

    deliveryChannel: text('delivery_channel').default('MANUAL').notNull(),

    deliveryStatus: text('delivery_status').default('PENDING').notNull(),

    status: text('status').default('PENDING').notNull(),

    purpose: text('purpose').default('ACTIVATION').notNull(),

    contactHint: text('contact_hint'),

    deliveryAttempts: integer('delivery_attempts').default(0).notNull(),

    lastDeliveryError: text('last_delivery_error'),

    expiresAt: timestamp('expires_at').notNull(),

    createdByUserId: integer('created_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    sentAt: timestamp('sent_at'),

    handedOverAt: timestamp('handed_over_at'),

    activatedAt: timestamp('activated_at'),

    revokedAt: timestamp('revoked_at'),

    revokedByUserId: integer('revoked_by_user_id').references(() => users.id),

    revokedReason: text('revoked_reason'),

    supersededBy: integer('superseded_by'),
  },
  (table) => ({
    tokenIdx: uniqueIndex('patient_portal_invitations_token_idx').on(table.tokenHash),

    patientIdx: index('patient_portal_invitations_patient_idx').on(
      table.patientId,
      table.createdAt,
    ),

    scopeIdx: index('patient_portal_invitations_scope_idx').on(
      table.tenantId,
      table.facilityId,
      table.status,
    ),
  }),
);

export const patientPortalInvitationEvents = pgTable(
  'patient_portal_invitation_events',
  {
    id: serial('id').primaryKey(),

    invitationId: integer('invitation_id')
      .references(() => patientPortalInvitations.id)
      .notNull(),

    eventType: text('event_type').notNull(),

    detail: text('detail'),

    actorUserId: integer('actor_user_id').references(() => users.id),

    ipAddress: text('ip_address'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    invitationIdx: index('patient_portal_events_invitation_idx').on(
      table.invitationId,
      table.createdAt,
    ),
  }),
);

export const patientPortalSessions = pgTable(
  'patient_portal_sessions',
  {
    id: serial('id').primaryKey(),

    accountId: integer('account_id')
      .references(() => patientPortalAccounts.id)
      .notNull(),

    sessionTokenHash: text('session_token_hash').notNull(),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),

    expiresAt: timestamp('expires_at').notNull(),

    revokedAt: timestamp('revoked_at'),

    revokeReason: text('revoke_reason'),
  },
  (table) => ({
    tokenIdx: uniqueIndex('patient_portal_sessions_token_idx').on(table.sessionTokenHash),

    accountIdx: index('patient_portal_sessions_account_idx').on(table.accountId, table.expiresAt),
  }),
);

export const patientPortalSettings = pgTable(
  'patient_portal_settings',
  {
    id: serial('id').primaryKey(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    invitationExpiryHours: integer('invitation_expiry_hours').default(72).notNull(),

    maxResends: integer('max_resends').default(3).notNull(),

    allowManualDelivery: boolean('allow_manual_delivery').default(true).notNull(),

    allowSms: boolean('allow_sms').default(false).notNull(),

    allowEmail: boolean('allow_email').default(false).notNull(),

    showLabResults: boolean('show_lab_results').default(true).notNull(),

    showAppointments: boolean('show_appointments').default(true).notNull(),

    showPrescriptions: boolean('show_prescriptions').default(true).notNull(),

    showAllergies: boolean('show_allergies').default(true).notNull(),

    showDischargeSummaries: boolean('show_discharge_summaries').default(true).notNull(),

    allowDownloads: boolean('allow_downloads').default(true).notNull(),

    updatedByUserId: integer('updated_by_user_id').references(() => users.id),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: uniqueIndex('patient_portal_settings_facility_idx').on(table.facilityId),
  }),
);

export const patientRecordSharingGrants = pgTable(
  'patient_record_sharing_grants',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    createdByAccountId: integer('created_by_account_id')
      .references(() => patientPortalAccounts.id)
      .notNull(),

    codeHash: text('code_hash').notNull(),

    recipientName: text('recipient_name').notNull(),

    purpose: text('purpose').notNull(),

    categories: jsonb('categories').default([]).notNull(),

    expiresAt: timestamp('expires_at').notNull(),

    revokedAt: timestamp('revoked_at'),

    redeemedAt: timestamp('redeemed_at'),

    redeemedByUserId: integer('redeemed_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex('patient_record_sharing_grants_code_idx').on(table.codeHash),

    patientIdx: index('patient_record_sharing_grants_patient_idx').on(
      table.patientId,
      table.createdAt,
    ),
  }),
);

/* ============================================================
   50. SHA eCLAIMS, ELIGIBILITY, BENEFITS, PREAUTH & REMITTANCE
   ============================================================ */

export const insurancePayerConfigs = pgTable(
  'insurance_payer_configs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    payerCode: text('payer_code').default('SHA').notNull(),
    payerName: text('payer_name').default('Social Health Authority (SHA)').notNull(),
    payerType: text('payer_type').default('PUBLIC_SCHEME').notNull(),
    integrationType: text('integration_type').default('MANUAL').notNull(),
    adapterKey: text('adapter_key').default('manual').notNull(),
    gatewayProvider: text('gateway_provider'),
    environment: text('environment').default('UNCONFIGURED').notNull(),
    connectionStatus: text('connection_status').default('NOT_CONFIGURED').notNull(),
    apiBaseUrl: text('api_base_url'),
    authMethod: text('auth_method').default('NONE').notNull(),
    secretEnvPrefix: text('secret_env_prefix'),
    providerIdentifier: text('provider_identifier'),
    supportedOperations: jsonb('supported_operations').$type<string[]>().default([]).notNull(),
    claimRequirements: jsonb('claim_requirements')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    preauthRequirements: jsonb('preauth_requirements')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    missingRequirements: jsonb('missing_requirements').$type<string[]>().default([]).notNull(),
    lastConnectionCheckAt: timestamp('last_connection_check_at'),
    lastConnectionSummary: text('last_connection_summary'),
    facilityRegistryCode: text('facility_registry_code'),
    accreditationLevel: text('accreditation_level'),
    contractedSchemes: jsonb('contracted_schemes')
      .$type<string[]>()
      .default(['SHIF', 'ECCIF'])
      .notNull(),
    defaultCodingSystem: text('default_coding_system').default('ICD-11').notNull(),
    requireVerifiedEligibility: boolean('require_verified_eligibility').default(true).notNull(),
    eligibilityMaxAgeHours: integer('eligibility_max_age_hours').default(24).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityPayerIdx: uniqueIndex('insurance_payer_configs_facility_payer_idx').on(
      table.facilityId,
      table.payerCode,
    ),
    tenantIdx: index('insurance_payer_configs_tenant_idx').on(table.tenantId),
  }),
);

export const insuranceMemberPolicies = pgTable(
  'insurance_member_policies',
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
    payerCode: text('payer_code').notNull(),
    memberNumber: text('member_number').notNull(),
    policyNumber: text('policy_number'),
    schemeName: text('scheme_name'),
    planName: text('plan_name'),
    memberRole: text('member_role').default('PRINCIPAL').notNull(),
    principalMemberName: text('principal_member_name'),
    principalMemberNumber: text('principal_member_number'),
    relationshipToPrincipal: text('relationship_to_principal'),
    externalMemberId: text('external_member_id'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    facilityRestrictions: jsonb('facility_restrictions').$type<string[]>().default([]).notNull(),
    schemeRestrictions: jsonb('scheme_restrictions').$type<string[]>().default([]).notNull(),
    evidenceSource: text('evidence_source').default('UNVERIFIED_ENTRY').notNull(),
    verificationStatus: text('verification_status').default('UNVERIFIED_LOCAL').notNull(),
    manualReviewStatus: text('manual_review_status').default('PENDING_REVIEW').notNull(),
    manualReviewNotes: text('manual_review_notes'),
    lastVerifiedAt: timestamp('last_verified_at'),
    verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
    status: text('status').default('ACTIVE').notNull(),
    correctionCount: integer('correction_count').default(0).notNull(),
    lastCorrectionReason: text('last_correction_reason'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityPayerMemberIdx: uniqueIndex('ins_member_policies_facility_payer_member_idx').on(
      table.facilityId,
      table.payerCode,
      table.patientId,
      table.memberNumber,
    ),
    patientIdx: index('ins_member_policies_patient_idx').on(
      table.facilityId,
      table.patientId,
      table.status,
    ),
    tenantIdx: index('ins_member_policies_tenant_idx').on(table.tenantId, table.payerCode),
  }),
);

export const payerServiceCodeMappings = pgTable(
  'payer_service_code_mappings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    payerCode: text('payer_code').default('SHA').notNull(),
    tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
      onDelete: 'set null',
    }),
    localCode: text('local_code').notNull(),
    localDescription: text('local_description').notNull(),
    serviceArea: text('service_area').notNull(),
    payerServiceCode: text('payer_service_code').notNull(),
    payerServiceName: text('payer_service_name').notNull(),
    fund: text('fund').default('SHIF').notNull(),
    accessPoint: text('access_point').default('OP').notNull(),
    paymentMechanism: text('payment_mechanism').default('FEE_FOR_SERVICE').notNull(),
    reimbursementTariff: numeric('reimbursement_tariff', { precision: 12, scale: 2 }),
    isPhcZeroTariff: boolean('is_phc_zero_tariff').default(false).notNull(),
    requiresPreauth: boolean('requires_preauth').default(false).notNull(),
    preauthCategory: text('preauth_category'),
    requiresReferral: boolean('requires_referral').default(false).notNull(),
    requiresClinicalNotes: boolean('requires_clinical_notes').default(true).notNull(),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityPayerCodeIdx: uniqueIndex('payer_service_mappings_facility_payer_code_idx').on(
      table.facilityId,
      table.payerCode,
      table.localCode,
    ),
    tariffIdx: index('payer_service_mappings_tariff_idx').on(table.facilityId, table.tariffId),
    tenantIdx: index('payer_service_mappings_tenant_idx').on(table.tenantId),
  }),
);

export const payerBenefitRules = pgTable(
  'payer_benefit_rules',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    payerCode: text('payer_code').default('SHA').notNull(),
    ruleCode: text('rule_code').notNull(),
    version: integer('version').default(1).notNull(),
    benefitPackage: text('benefit_package').notNull(),
    serviceCategory: text('service_category').notNull(),
    payerServiceCode: text('payer_service_code'),
    minFacilityLevel: text('min_facility_level'),
    requiresPreauth: boolean('requires_preauth').default(false).notNull(),
    requiresReferral: boolean('requires_referral').default(false).notNull(),
    requiredEvidence: jsonb('required_evidence').$type<string[]>().default([]).notNull(),
    copayType: text('copay_type').default('NONE').notNull(),
    copayValue: numeric('copay_value', { precision: 12, scale: 2 }).default('0.00').notNull(),
    deductibleAmount: numeric('deductible_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    coinsurancePercent: numeric('coinsurance_percent', { precision: 5, scale: 2 })
      .default('0.00')
      .notNull(),
    waitingPeriodDays: integer('waiting_period_days').default(0).notNull(),
    panelRestrictionNotes: text('panel_restriction_notes'),
    annualLimit: numeric('annual_limit', { precision: 12, scale: 2 }),
    perVisitLimit: numeric('per_visit_limit', { precision: 12, scale: 2 }),
    exclusionNotes: text('exclusion_notes'),
    sourceReference: text('source_reference').notNull(),
    status: text('status').default('DRAFT').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityRuleVerIdx: uniqueIndex('payer_benefit_rules_facility_code_ver_idx').on(
      table.facilityId,
      table.payerCode,
      table.ruleCode,
      table.version,
    ),
    lookupIdx: index('payer_benefit_rules_lookup_idx').on(
      table.facilityId,
      table.payerCode,
      table.status,
    ),
  }),
);

export const insuranceEligibilityVerifications = pgTable(
  'insurance_eligibility_verifications',
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
    memberPolicyId: integer('member_policy_id').references(() => insuranceMemberPolicies.id, {
      onDelete: 'set null',
    }),
    encounterId: integer('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
    payerCode: text('payer_code').default('SHA').notNull(),
    identificationType: text('identification_type').notNull(),
    identificationHint: text('identification_hint').notNull(),
    intendedServiceArea: text('intended_service_area'),
    outcome: text('outcome').notNull(),
    source: text('source').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    payerReference: text('payer_reference'),
    manualReference: text('manual_reference'),
    evidenceDocumentRef: text('evidence_document_ref'),
    visitSessionRef: text('visit_session_ref'),
    memberCrNumber: text('member_cr_number'),
    memberStatus: text('member_status'),
    isAlive: boolean('is_alive'),
    facilityBiometricsEnforced: boolean('facility_biometrics_enforced'),
    whitelistedForOtp: boolean('whitelisted_for_otp'),
    schemes: jsonb('schemes').$type<string[]>().default([]).notNull(),
    schemeDetails: jsonb('scheme_details')
      .$type<
        Array<{
          schemeCode: string;
          schemeName: string;
          memberType?: string | null;
          eligible: boolean;
          isPomsf?: boolean;
          statusCode?: string | null;
          statusDesc?: string | null;
          coverageStartDate?: string | null;
          coverageEndDate?: string | null;
        }>
      >()
      .default([])
      .notNull(),
    coverageStartDate: date('coverage_start_date'),
    coverageEndDate: date('coverage_end_date'),
    restrictions: jsonb('restrictions').$type<string[]>().default([]).notNull(),
    reason: text('reason'),
    possibleSolution: text('possible_solution'),
    responseClassification: text('response_classification').notNull(),
    correlationId: text('correlation_id'),
    checkedByUserId: integer('checked_by_user_id').references(() => users.id),
    checkedAt: timestamp('checked_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('ins_elig_verifications_patient_idx').on(
      table.facilityId,
      table.patientId,
      table.checkedAt,
    ),
    tenantIdx: index('ins_elig_verifications_tenant_idx').on(table.tenantId, table.checkedAt),
  }),
);

export const insuranceBenefitValidations = pgTable(
  'insurance_benefit_validations',
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
    memberPolicyId: integer('member_policy_id').references(() => insuranceMemberPolicies.id, {
      onDelete: 'set null',
    }),
    encounterId: integer('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
    eligibilityVerificationId: integer('eligibility_verification_id').references(
      () => insuranceEligibilityVerifications.id,
      { onDelete: 'set null' },
    ),
    payerCode: text('payer_code').default('SHA').notNull(),
    tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
      onDelete: 'set null',
    }),
    mappingId: integer('mapping_id').references(() => payerServiceCodeMappings.id, {
      onDelete: 'set null',
    }),
    benefitRuleId: integer('benefit_rule_id').references(() => payerBenefitRules.id, {
      onDelete: 'set null',
    }),
    ruleVersion: integer('rule_version'),
    serviceDescription: text('service_description').notNull(),
    serviceCategory: text('service_category').notNull(),
    payerServiceCode: text('payer_service_code'),
    benefitPackage: text('benefit_package'),
    serviceDate: date('service_date').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    facilityTariffAmount: numeric('facility_tariff_amount', { precision: 12, scale: 2 }).notNull(),
    payerTariffAmount: numeric('payer_tariff_amount', { precision: 12, scale: 2 }),
    deductibleEstimate: numeric('deductible_estimate', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    estimatedCopayAmount: numeric('estimated_copay_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    estimatedCoveredAmount: numeric('estimated_covered_amount', { precision: 12, scale: 2 }),
    decision: text('decision').notNull(),
    verificationSource: text('verification_source').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    requiresPreauth: boolean('requires_preauth').default(false).notNull(),
    preauthReference: text('preauth_reference'),
    hasReferral: boolean('has_referral').default(false).notNull(),
    hasClinicalNotes: boolean('has_clinical_notes').default(false).notNull(),
    missingRequirements: jsonb('missing_requirements').$type<string[]>().default([]).notNull(),
    reason: text('reason').notNull(),
    validatedByUserId: integer('validated_by_user_id').references(() => users.id),
    validatedAt: timestamp('validated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('ins_benefit_validations_patient_idx').on(
      table.facilityId,
      table.patientId,
      table.validatedAt,
    ),
  }),
);

export const shaPatientAuthorizations = pgTable(
  'sha_patient_authorizations',
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
    encounterId: integer('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
    payerCode: text('payer_code').default('SHA').notNull(),
    memberCrNumber: text('member_cr_number'),
    serviceType: text('service_type').default('OUTPATIENT').notNull(),
    consentMethod: text('consent_method').default('OTP').notNull(),
    authorizationGuid: text('authorization_guid'),
    consentToken: text('consent_token'),
    authCode: text('auth_code'),
    authStatus: text('auth_status').default('PENDING').notNull(),
    isElective: boolean('is_elective').default(false).notNull(),
    interventions: jsonb('interventions').$type<string[]>().default([]).notNull(),
    selectedPomsfScheme: text('selected_pomsf_scheme'),
    virtualClaimId: text('virtual_claim_id'),
    practitionerRegNumber: text('practitioner_reg_number'),
    practitionerRegulator: text('practitioner_regulator'),
    expiresAt: timestamp('expires_at'),
    source: text('source').default('UNAVAILABLE').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    correlationId: text('correlation_id'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityPatientIdx: index('sha_patient_auth_facility_patient_idx').on(
      table.facilityId,
      table.patientId,
      table.createdAt,
    ),
    tokenIdx: index('sha_patient_auth_token_idx').on(table.facilityId, table.consentToken),
  }),
);

export const shaBenefitUtilizationSnapshots = pgTable(
  'sha_benefit_utilization_snapshots',
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
    payerCode: text('payer_code').default('SHA').notNull(),
    memberCrNumber: text('member_cr_number'),
    interventionCode: text('intervention_code'),
    subBenefitCode: text('sub_benefit_code'),
    benefitPackage: text('benefit_package'),
    limitScope: text('limit_scope'),
    individualMaxLimit: numeric('individual_max_limit', { precision: 12, scale: 2 }),
    individualUtilisedLimit: numeric('individual_utilised_limit', { precision: 12, scale: 2 }),
    individualRemainingLimit: numeric('individual_remaining_limit', { precision: 12, scale: 2 }),
    householdMaxLimit: numeric('household_max_limit', { precision: 12, scale: 2 }),
    householdUtilisedLimit: numeric('household_utilised_limit', { precision: 12, scale: 2 }),
    householdRemainingLimit: numeric('household_remaining_limit', { precision: 12, scale: 2 }),
    pomsfBalance: numeric('pomsf_balance', { precision: 12, scale: 2 }),
    overallTariff: numeric('overall_tariff', { precision: 12, scale: 2 }),
    needsPreauth: boolean('needs_preauth'),
    needsManualPreauthApproval: boolean('needs_manual_preauth_approval'),
    needsDoctorAuthorization: boolean('needs_doctor_authorization'),
    specialistPreauthFlags: jsonb('specialist_preauth_flags')
      .$type<Record<string, boolean>>()
      .default({})
      .notNull(),
    utilizationDays: integer('utilization_days'),
    nextAvailability: text('next_availability'),
    source: text('source').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    correlationId: text('correlation_id'),
    checkedByUserId: integer('checked_by_user_id').references(() => users.id),
    checkedAt: timestamp('checked_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('sha_util_snapshots_patient_idx').on(
      table.facilityId,
      table.patientId,
      table.checkedAt,
    ),
  }),
);

export const insurancePreauthorizations = pgTable(
  'insurance_preauthorizations',
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
    memberPolicyId: integer('member_policy_id').references(() => insuranceMemberPolicies.id, {
      onDelete: 'set null',
    }),
    encounterId: integer('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
    invoiceId: integer('invoice_id').references(() => billingInvoices.id, { onDelete: 'set null' }),
    eligibilityVerificationId: integer('eligibility_verification_id').references(
      () => insuranceEligibilityVerifications.id,
      { onDelete: 'set null' },
    ),
    authorizationId: integer('authorization_id').references(() => shaPatientAuthorizations.id, {
      onDelete: 'set null',
    }),
    tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
      onDelete: 'set null',
    }),
    payerCode: text('payer_code').default('SHA').notNull(),
    preauthNumber: text('preauth_number').notNull().unique(),
    externalBundleId: text('external_bundle_id').notNull().unique(),
    consentToken: text('consent_token'),
    hiePreauthGuid: text('hie_preauth_guid'),
    payerAuthReference: text('payer_auth_reference'),
    mediatorId: text('mediator_id'),
    category: text('category').default('GENERAL').notNull(),
    isElective: boolean('is_elective').default(false).notNull(),
    needsDoctorAuthorization: boolean('needs_doctor_authorization').default(false).notNull(),
    doctorApproved: boolean('doctor_approved'),
    practitionerRegNumber: text('practitioner_reg_number'),
    practitionerRegulator: text('practitioner_regulator'),
    status: text('status').default('DRAFT').notNull(),
    source: text('source').default('LOCAL_DRAFT').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    clinicalIndication: text('clinical_indication').notNull(),
    primaryDiagnosisCode: text('primary_diagnosis_code').notNull(),
    primaryDiagnosisDisplay: text('primary_diagnosis_display').notNull(),
    codingSystem: text('coding_system').default('ICD-11').notNull(),
    requestedServiceCode: text('requested_service_code').notNull(),
    requestedServiceName: text('requested_service_name').notNull(),
    requestedItems: jsonb('requested_items')
      .$type<
        Array<{
          serviceCode: string;
          serviceName: string;
          quantity: number;
          unitPrice: string;
          estimatedTotal: string;
          tariffId?: number | null;
        }>
      >()
      .default([])
      .notNull(),
    quantity: integer('quantity').default(1).notNull(),
    estimatedAmount: numeric('estimated_amount', { precision: 12, scale: 2 }).notNull(),
    interimApprovedAmount: numeric('interim_approved_amount', { precision: 12, scale: 2 }),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    requiredDocuments: jsonb('required_documents').$type<string[]>().default([]).notNull(),
    conditions: text('conditions'),
    validFrom: date('valid_from'),
    validUntil: date('valid_until'),
    supportingNotes: text('supporting_notes'),
    rejectionReason: text('rejection_reason'),
    fhirBundle: jsonb('fhir_bundle').$type<Record<string, unknown>>(),
    amendmentCount: integer('amendment_count').default(0).notNull(),
    lastAmendmentReason: text('last_amendment_reason'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    submittedByUserId: integer('submitted_by_user_id').references(() => users.id),
    decidedByUserId: integer('decided_by_user_id').references(() => users.id),
    submittedAt: timestamp('submitted_at'),
    decidedAt: timestamp('decided_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityStatusIdx: index('ins_preauth_facility_status_idx').on(
      table.facilityId,
      table.status,
      table.createdAt,
    ),
    patientIdx: index('ins_preauth_patient_idx').on(table.facilityId, table.patientId),
  }),
);

export const shaEclaims = pgTable(
  'sha_eclaims',
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
    encounterId: integer('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),
    eligibilityVerificationId: integer('eligibility_verification_id').references(
      () => insuranceEligibilityVerifications.id,
      { onDelete: 'set null' },
    ),
    preauthorizationId: integer('preauthorization_id').references(
      () => insurancePreauthorizations.id,
      { onDelete: 'set null' },
    ),
    authorizationId: integer('authorization_id').references(() => shaPatientAuthorizations.id, {
      onDelete: 'set null',
    }),
    consentToken: text('consent_token'),
    submissionProtocol: text('submission_protocol').default('FHIR_BUNDLE').notNull(),
    hieVirtualClaimId: text('hie_virtual_claim_id'),
    dischargeReason: text('discharge_reason'),
    practitionerRegNumber: text('practitioner_reg_number'),
    practitionerRegulator: text('practitioner_regulator'),
    payerCode: text('payer_code').default('SHA').notNull(),
    schemeCode: text('scheme_code').default('SHIF').notNull(),
    claimNumber: text('claim_number').notNull().unique(),
    claimUuid: text('claim_uuid').notNull().unique(),
    claimType: text('claim_type').default('institutional').notNull(),
    subType: text('sub_type').default('op').notNull(),
    status: text('status').default('DRAFT').notNull(),
    environmentMode: text('environment_mode').default('mock').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    billableStart: date('billable_start').notNull(),
    billableEnd: date('billable_end').notNull(),
    totalBilledAmount: numeric('total_billed_amount', { precision: 12, scale: 2 }).notNull(),
    totalClaimedAmount: numeric('total_claimed_amount', { precision: 12, scale: 2 }).notNull(),
    totalApprovedAmount: numeric('total_approved_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    totalPaidAmount: numeric('total_paid_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    patientCopayAmount: numeric('patient_copay_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    isPhcClaim: boolean('is_phc_claim').default(false).notNull(),
    diagnosesSnapshot: jsonb('diagnoses_snapshot')
      .$type<Array<{ code: string; display: string; system: string; type: string }>>()
      .default([])
      .notNull(),
    supportingSummary: jsonb('supporting_summary')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    validationIssues: jsonb('validation_issues')
      .$type<
        Array<{ code: string; severity: 'ERROR' | 'WARNING'; field?: string; message: string }>
      >()
      .default([])
      .notNull(),
    payerClaimReference: text('payer_claim_reference'),
    mediatorId: text('mediator_id'),
    rejectionReason: text('rejection_reason'),
    adjudicationSummary: jsonb('adjudication_summary').$type<Record<string, unknown>>(),
    submissionCount: integer('submission_count').default(0).notNull(),
    previousSubmissionRef: text('previous_submission_ref'),
    fhirBundle: jsonb('fhir_bundle').$type<Record<string, unknown>>(),
    settledPaymentId: integer('settled_payment_id').references(() => billingPayments.id, {
      onDelete: 'set null',
    }),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    submittedByUserId: integer('submitted_by_user_id').references(() => users.id),
    submittedAt: timestamp('submitted_at'),
    acknowledgedAt: timestamp('acknowledged_at'),
    adjudicatedAt: timestamp('adjudicated_at'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityStatusIdx: index('sha_eclaims_facility_status_idx').on(
      table.facilityId,
      table.status,
      table.createdAt,
    ),
    invoiceIdx: index('sha_eclaims_invoice_idx').on(table.invoiceId, table.status),
    patientIdx: index('sha_eclaims_patient_idx').on(table.facilityId, table.patientId),
  }),
);

export const shaEclaimItems = pgTable(
  'sha_eclaim_items',
  {
    id: serial('id').primaryKey(),
    eclaimId: integer('eclaim_id')
      .references(() => shaEclaims.id, { onDelete: 'cascade' })
      .notNull(),
    billingItemId: integer('billing_item_id').references(() => billingItems.id, {
      onDelete: 'set null',
    }),
    tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
      onDelete: 'set null',
    }),
    sequence: integer('sequence').notNull(),
    sourceType: text('source_type'),
    sourceId: integer('source_id'),
    localCode: text('local_code'),
    description: text('description').notNull(),
    serviceArea: text('service_area'),
    payerServiceCode: text('payer_service_code'),
    payerServiceName: text('payer_service_name'),
    fund: text('fund').default('SHIF').notNull(),
    paymentMechanism: text('payment_mechanism').default('FEE_FOR_SERVICE').notNull(),
    servicedStart: date('serviced_start').notNull(),
    servicedEnd: date('serviced_end').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    facilityUnitPrice: numeric('facility_unit_price', { precision: 12, scale: 2 }).notNull(),
    claimedUnitPrice: numeric('claimed_unit_price', { precision: 12, scale: 2 }).notNull(),
    claimedNetAmount: numeric('claimed_net_amount', { precision: 12, scale: 2 }).notNull(),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    rejectionReason: text('rejection_reason'),
    preauthReference: text('preauth_reference'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index('sha_eclaim_items_claim_idx').on(table.eclaimId, table.sequence),
  }),
);

export const shaEclaimSubmissions = pgTable(
  'sha_eclaim_submissions',
  {
    id: serial('id').primaryKey(),
    eclaimId: integer('eclaim_id')
      .references(() => shaEclaims.id, { onDelete: 'cascade' })
      .notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    operation: text('operation').notNull(),
    bundleUuid: text('bundle_uuid').notNull(),
    environmentMode: text('environment_mode').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    requestCorrelationId: text('request_correlation_id').notNull(),
    httpStatus: integer('http_status'),
    outcome: text('outcome').notNull(),
    mediatorId: text('mediator_id'),
    payerClaimId: text('payer_claim_id'),
    upstreamState: text('upstream_state'),
    rejectionReason: text('rejection_reason'),
    errors: jsonb('errors').$type<string[]>().default([]).notNull(),
    submittedByUserId: integer('submitted_by_user_id').references(() => users.id),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
    acknowledgedAt: timestamp('acknowledged_at'),
  },
  (table) => ({
    claimIdx: index('sha_eclaim_submissions_claim_idx').on(table.eclaimId, table.attemptNumber),
  }),
);

export const shaEclaimStatusHistory = pgTable(
  'sha_eclaim_status_history',
  {
    id: serial('id').primaryKey(),
    eclaimId: integer('eclaim_id')
      .references(() => shaEclaims.id, { onDelete: 'cascade' })
      .notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    source: text('source').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index('sha_eclaim_status_history_claim_idx').on(table.eclaimId, table.createdAt),
  }),
);

export const insuranceRemittances = pgTable(
  'insurance_remittances',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    payerCode: text('payer_code').default('SHA').notNull(),
    remittanceNumber: text('remittance_number').notNull().unique(),
    payerRemittanceRef: text('payer_remittance_ref').notNull(),
    bankReference: text('bank_reference'),
    facilityIdType: text('facility_id_type').default('fr-code').notNull(),
    paymentDate: date('payment_date').notNull(),
    paymentChannel: text('payment_channel').default('EFT').notNull(),
    totalRemittedAmount: numeric('total_remitted_amount', { precision: 12, scale: 2 }).notNull(),
    allocatedAmount: numeric('allocated_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    unallocatedAmount: numeric('unallocated_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    status: text('status').default('RECEIVED').notNull(),
    source: text('source').default('MANUAL_ADVICE').notNull(),
    isSimulated: boolean('is_simulated').default(false).notNull(),
    fhirPaymentNotice: jsonb('fhir_payment_notice').$type<Record<string, unknown>>(),
    notes: text('notes'),
    receivedByUserId: integer('received_by_user_id').references(() => users.id),
    reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
    reconciledAt: timestamp('reconciled_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityPayerRefIdx: uniqueIndex('insurance_remittances_facility_payer_ref_idx').on(
      table.facilityId,
      table.payerCode,
      table.payerRemittanceRef,
    ),
    facilityStatusIdx: index('insurance_remittances_facility_status_idx').on(
      table.facilityId,
      table.status,
      table.paymentDate,
    ),
  }),
);

export const insuranceReconciliationEntries = pgTable(
  'insurance_reconciliation_entries',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    remittanceId: integer('remittance_id')
      .references(() => insuranceRemittances.id, { onDelete: 'cascade' })
      .notNull(),
    eclaimId: integer('eclaim_id')
      .references(() => shaEclaims.id)
      .notNull(),
    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),
    claimedAmount: numeric('claimed_amount', { precision: 12, scale: 2 }).notNull(),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }).notNull(),
    remittedAmount: numeric('remitted_amount', { precision: 12, scale: 2 }).notNull(),
    appliedToInvoiceAmount: numeric('applied_to_invoice_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    varianceAmount: numeric('variance_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    varianceReason: text('variance_reason'),
    reconciliationStatus: text('reconciliation_status').default('MATCHED').notNull(),
    postedPaymentId: integer('posted_payment_id').references(() => billingPayments.id, {
      onDelete: 'set null',
    }),
    reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
    reconciledAt: timestamp('reconciled_at').defaultNow().notNull(),
  },
  (table) => ({
    remittanceClaimIdx: uniqueIndex('ins_recon_entries_remittance_claim_idx').on(
      table.remittanceId,
      table.eclaimId,
    ),
    facilityIdx: index('ins_recon_entries_facility_idx').on(table.facilityId, table.reconciledAt),
  }),
);

export const shaCallbackEvents = pgTable(
  'sha_callback_events',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    facilityId: integer('facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    facilityFrCode: text('facility_fr_code'),
    entityType: text('entity_type').notNull(),
    externalReference: text('external_reference').notNull(),
    upstreamStatus: text('upstream_status').notNull(),
    mappedLocalStatus: text('mapped_local_status'),
    signatureVerified: boolean('signature_verified').default(false).notNull(),
    processingOutcome: text('processing_outcome').notNull(),
    payloadSummary: jsonb('payload_summary').$type<Record<string, unknown>>().default({}).notNull(),
    correlationId: text('correlation_id'),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
  },
  (table) => ({
    refIdx: index('sha_callback_events_ref_idx').on(
      table.entityType,
      table.externalReference,
      table.receivedAt,
    ),
  }),
);

/* ============================================================
   51. PRIVATE INSURANCE MULTI-PAYER ENGINE (BRITAM, PACIS, GATEWAYS)
   ============================================================ */

export const insurancePreauthorizationAttachments = pgTable(
  'insurance_preauthorization_attachments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    preauthorizationId: integer('preauthorization_id')
      .references(() => insurancePreauthorizations.id, { onDelete: 'cascade' })
      .notNull(),
    documentType: text('document_type').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').default('application/pdf').notNull(),
    fileSizeBytes: integer('file_size_bytes').default(0).notNull(),
    storageReference: text('storage_reference').notNull(),
    checksumSha256: text('checksum_sha256'),
    notes: text('notes'),
    uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  },
  (table) => ({
    preauthIdx: index('ins_preauth_attachments_preauth_idx').on(
      table.preauthorizationId,
      table.uploadedAt,
    ),
  }),
);

export const privateInsuranceClaims = pgTable(
  'private_insurance_claims',
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
    memberPolicyId: integer('member_policy_id')
      .references(() => insuranceMemberPolicies.id)
      .notNull(),
    encounterId: integer('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
    admissionId: integer('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),
    eligibilityVerificationId: integer('eligibility_verification_id').references(
      () => insuranceEligibilityVerifications.id,
      { onDelete: 'set null' },
    ),
    preauthorizationId: integer('preauthorization_id').references(
      () => insurancePreauthorizations.id,
      { onDelete: 'set null' },
    ),
    payerCode: text('payer_code').notNull(),
    adapterKey: text('adapter_key').default('manual').notNull(),
    integrationType: text('integration_type').default('MANUAL').notNull(),
    claimNumber: text('claim_number').notNull().unique(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    encounterType: text('encounter_type').default('OPD').notNull(),
    currency: text('currency').default('KES').notNull(),
    serviceDateStart: date('service_date_start').notNull(),
    serviceDateEnd: date('service_date_end').notNull(),
    grossInvoiceAmount: numeric('gross_invoice_amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    confirmedCopayAmount: numeric('confirmed_copay_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    patientPaidAmount: numeric('patient_paid_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    proposedClaimAmount: numeric('proposed_claim_amount', { precision: 12, scale: 2 }).notNull(),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
    status: text('status').default('DRAFT').notNull(),
    submissionChannel: text('submission_channel').default('NONE').notNull(),
    diagnosesSnapshot: jsonb('diagnoses_snapshot')
      .$type<Array<{ code: string; display: string; system: string; type: string }>>()
      .default([])
      .notNull(),
    clinicalSummary: jsonb('clinical_summary')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    attachmentsManifest: jsonb('attachments_manifest')
      .$type<Array<{ documentType: string; fileName: string; storageReference: string }>>()
      .default([])
      .notNull(),
    validationIssues: jsonb('validation_issues')
      .$type<
        Array<{ code: string; severity: 'ERROR' | 'WARNING'; field?: string; message: string }>
      >()
      .default([])
      .notNull(),
    externalClaimReference: text('external_claim_reference'),
    visitSessionRef: text('visit_session_ref'),
    rejectionCode: text('rejection_code'),
    rejectionReason: text('rejection_reason'),
    adjudicationNotes: text('adjudication_notes'),
    submissionCount: integer('submission_count').default(0).notNull(),
    revisionNumber: integer('revision_number').default(1).notNull(),
    settledPaymentId: integer('settled_payment_id').references(() => billingPayments.id, {
      onDelete: 'set null',
    }),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    submittedByUserId: integer('submitted_by_user_id').references(() => users.id),
    submittedAt: timestamp('submitted_at'),
    acknowledgedAt: timestamp('acknowledged_at'),
    adjudicatedAt: timestamp('adjudicated_at'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityStatusIdx: index('priv_ins_claims_facility_status_idx').on(
      table.facilityId,
      table.payerCode,
      table.status,
      table.createdAt,
    ),
    invoiceIdx: index('priv_ins_claims_invoice_idx').on(
      table.invoiceId,
      table.payerCode,
      table.status,
    ),
    patientIdx: index('priv_ins_claims_patient_idx').on(table.facilityId, table.patientId),
  }),
);

export const privateInsuranceClaimLines = pgTable(
  'private_insurance_claim_lines',
  {
    id: serial('id').primaryKey(),
    claimId: integer('claim_id')
      .references(() => privateInsuranceClaims.id, { onDelete: 'cascade' })
      .notNull(),
    billingItemId: integer('billing_item_id').references(() => billingItems.id, {
      onDelete: 'set null',
    }),
    tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
      onDelete: 'set null',
    }),
    mappingId: integer('mapping_id').references(() => payerServiceCodeMappings.id, {
      onDelete: 'set null',
    }),
    lineNumber: integer('line_number').notNull(),
    serviceCategory: text('service_category').notNull(),
    itemCode: text('item_code'),
    itemDescription: text('item_description').notNull(),
    payerServiceCode: text('payer_service_code'),
    payerServiceName: text('payer_service_name'),
    mappingStatus: text('mapping_status').default('UNMAPPED').notNull(),
    serviceDate: date('service_date').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    copayAmount: numeric('copay_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
    proposedClaimAmount: numeric('proposed_claim_amount', { precision: 12, scale: 2 }).notNull(),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    rejectionReason: text('rejection_reason'),
    preauthReference: text('preauth_reference'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index('priv_ins_claim_lines_claim_idx').on(table.claimId, table.lineNumber),
  }),
);

export const privateInsuranceClaimSubmissions = pgTable(
  'private_insurance_claim_submissions',
  {
    id: serial('id').primaryKey(),
    claimId: integer('claim_id')
      .references(() => privateInsuranceClaims.id, { onDelete: 'cascade' })
      .notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    adapterKey: text('adapter_key').notNull(),
    submissionChannel: text('submission_channel').notNull(),
    operation: text('operation').notNull(),
    correlationId: text('correlation_id').notNull(),
    httpStatus: integer('http_status'),
    outcome: text('outcome').notNull(),
    externalReference: text('external_reference'),
    errorCode: text('error_code'),
    responseSummary: text('response_summary'),
    submittedByUserId: integer('submitted_by_user_id').references(() => users.id),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index('priv_ins_claim_submissions_claim_idx').on(table.claimId, table.attemptNumber),
  }),
);

export const privateInsuranceClaimStatusHistory = pgTable(
  'private_insurance_claim_status_history',
  {
    id: serial('id').primaryKey(),
    claimId: integer('claim_id')
      .references(() => privateInsuranceClaims.id, { onDelete: 'cascade' })
      .notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    source: text('source').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index('priv_ins_claim_history_claim_idx').on(table.claimId, table.createdAt),
  }),
);

export const privateInsuranceRemittanceAllocations = pgTable(
  'private_insurance_remittance_allocations',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    remittanceId: integer('remittance_id')
      .references(() => insuranceRemittances.id, { onDelete: 'cascade' })
      .notNull(),
    claimId: integer('claim_id')
      .references(() => privateInsuranceClaims.id)
      .notNull(),
    invoiceId: integer('invoice_id')
      .references(() => billingInvoices.id)
      .notNull(),
    payerCode: text('payer_code').notNull(),
    claimedAmount: numeric('claimed_amount', { precision: 12, scale: 2 }).notNull(),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }).notNull(),
    remittedAmount: numeric('remitted_amount', { precision: 12, scale: 2 }).notNull(),
    appliedToInvoiceAmount: numeric('applied_to_invoice_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    varianceAmount: numeric('variance_amount', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    varianceReason: text('variance_reason'),
    reconciliationStatus: text('reconciliation_status').default('MATCHED').notNull(),
    postedPaymentId: integer('posted_payment_id').references(() => billingPayments.id, {
      onDelete: 'set null',
    }),
    reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
    reconciledAt: timestamp('reconciled_at').defaultNow().notNull(),
  },
  (table) => ({
    remittanceClaimIdx: uniqueIndex('priv_ins_remit_alloc_remittance_claim_idx').on(
      table.remittanceId,
      table.claimId,
    ),
    facilityIdx: index('priv_ins_remit_alloc_facility_idx').on(
      table.facilityId,
      table.payerCode,
      table.reconciledAt,
    ),
  }),
);

export const insuranceIntegrationDiagnostics = pgTable(
  'insurance_integration_diagnostics',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    payerCode: text('payer_code').notNull(),
    adapterKey: text('adapter_key').notNull(),
    environment: text('environment').notNull(),
    operation: text('operation').notNull(),
    direction: text('direction').default('OUTBOUND').notNull(),
    outcome: text('outcome').notNull(),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms').default(0).notNull(),
    correlationId: text('correlation_id').notNull(),
    errorCode: text('error_code'),
    summary: text('summary').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: index('ins_integration_diag_facility_idx').on(
      table.facilityId,
      table.payerCode,
      table.createdAt,
    ),
  }),
);

/* ============================================================
   CLIENT SPRINT & ICD-11 UPGRADE (MIGRATION 0027)
   - Authoritative WHO ICD-11 Catalogue & ICD-10->ICD-11 Mappings
   - Financial Management, Double-Entry GL, AP, Fixed Assets & Bank Reconciliation
   - Dedicated Configurable Dialysis Service Module
   - Secure Website Booking Integration
   ============================================================ */

export const icd11CatalogueEntries = pgTable(
  'icd11_catalogue_entries',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    chapterCode: text('chapter_code'),
    chapterTitle: text('chapter_title'),
    classKind: text('class_kind').default('category').notNull(),
    foundationUri: text('foundation_uri'),
    linearizationUri: text('linearization_uri'),
    releaseId: text('release_id').default('2025-01').notNull(),
    sourceName: text('source_name').default('WHO ICD-11 MMS Official Release').notNull(),
    sourceUrl: text('source_url'),
    keywords: jsonb('keywords').$type<string[]>().default([]).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isNotifiable: boolean('is_notifiable').default(false).notNull(),
    cachedFromWhoApi: boolean('cached_from_who_api').default(false).notNull(),
    fetchedAt: timestamp('fetched_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    codeReleaseIdx: uniqueIndex('icd11_catalogue_code_release_idx').on(table.code, table.releaseId),
  }),
);

export const icd10ToIcd11Mappings = pgTable(
  'icd10_to_icd11_mappings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    icd10Code: text('icd10_code').notNull(),
    icd10Title: text('icd10_title').notNull(),
    icd11Code: text('icd11_code'),
    icd11Title: text('icd11_title'),
    icd11Chapter: text('icd11_chapter'),
    foundationUri: text('foundation_uri'),
    linearizationUri: text('linearization_uri'),
    releaseId: text('release_id').default('2025-01').notNull(),
    mappingType: text('mapping_type').default('ONE_TO_ONE').notNull(),
    reviewStatus: text('review_status').default('REQUIRES_CLINICAL_REVIEW').notNull(),
    mappingSource: text('mapping_source').notNull(),
    alternatives: jsonb('alternatives')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    notes: text('notes'),
    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    codeReleaseIdx: uniqueIndex('icd10_to_icd11_code_release_idx').on(
      table.facilityId,
      table.icd10Code,
      table.releaseId,
    ),
  }),
);

export const financialPeriods = pgTable(
  'financial_periods',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    periodCode: text('period_code').notNull(),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').default('OPEN').notNull(),
    closedByUserId: integer('closed_by_user_id').references(() => users.id),
    closedAt: timestamp('closed_at'),
    closeNotes: text('close_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('financial_periods_facility_code_idx').on(
      table.facilityId,
      table.periodCode,
    ),
  }),
);

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    accountCode: text('account_code').notNull(),
    accountName: text('account_name').notNull(),
    accountType: text('account_type').notNull(),
    subType: text('sub_type').notNull(),
    normalBalance: text('normal_balance').notNull(),
    departmentCode: text('department_code'),
    parentAccountId: integer('parent_account_id'),
    isSystemAccount: boolean('is_system_account').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityAccountCodeIdx: uniqueIndex('coa_facility_account_code_idx').on(
      table.facilityId,
      table.accountCode,
    ),
  }),
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    periodId: integer('period_id').references(() => financialPeriods.id),
    journalNumber: text('journal_number').notNull(),
    entryDate: date('entry_date').notNull(),
    sourceType: text('source_type').default('MANUAL').notNull(),
    sourceId: text('source_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    description: text('description').notNull(),
    status: text('status').default('DRAFT').notNull(),
    totalDebitCents: bigint('total_debit_cents', { mode: 'number' }).notNull(),
    totalCreditCents: bigint('total_credit_cents', { mode: 'number' }).notNull(),
    reversalOfJournalId: integer('reversal_of_journal_id'),
    reversedByJournalId: integer('reversed_by_journal_id'),
    reversalReason: text('reversal_reason'),
    postedByUserId: integer('posted_by_user_id').references(() => users.id),
    postedAt: timestamp('posted_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNumberIdx: uniqueIndex('journal_entries_facility_number_idx').on(
      table.facilityId,
      table.journalNumber,
    ),
    facilityIdempIdx: uniqueIndex('journal_entries_facility_idempotency_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  }),
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: serial('id').primaryKey(),
    journalEntryId: integer('journal_entry_id')
      .references(() => journalEntries.id)
      .notNull(),
    accountId: integer('account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    serviceLine: text('service_line'),
    description: text('description'),
    debitCents: bigint('debit_cents', { mode: 'number' }).default(0).notNull(),
    creditCents: bigint('credit_cents', { mode: 'number' }).default(0).notNull(),
    patientId: integer('patient_id').references(() => patients.id),
    supplierId: integer('supplier_id').references(() => suppliers.id),
    invoiceId: integer('invoice_id').references(() => billingInvoices.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    entryIdx: index('journal_lines_entry_idx').on(table.journalEntryId),
    accountIdx: index('journal_lines_account_idx').on(table.accountId),
  }),
);

export const expenseRequests = pgTable(
  'expense_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    requestNumber: text('request_number').notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    serviceLine: text('service_line'),
    expenseAccountId: integer('expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    paymentAccountId: integer('payment_account_id').references(() => chartOfAccounts.id),
    payeeName: text('payee_name').notNull(),
    category: text('category').notNull(),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').default('KES').notNull(),
    description: text('description').notNull(),
    supportingDocuments: jsonb('supporting_documents')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    status: text('status').default('SUBMITTED').notNull(),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id),
    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNotes: text('review_notes'),
    postedJournalId: integer('posted_journal_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    incurredDate: date('incurred_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNumberIdx: uniqueIndex('expense_requests_facility_number_idx').on(
      table.facilityId,
      table.requestNumber,
    ),
    facilityIdempIdx: uniqueIndex('expense_requests_facility_idemp_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  }),
);

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    assetCode: text('asset_code').notNull(),
    assetName: text('asset_name').notNull(),
    category: text('category').notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    serviceLine: text('service_line'),
    serialNumber: text('serial_number'),
    acquisitionDate: text('acquisition_date').notNull(),
    acquisitionCostKes: numeric('acquisition_cost_kes', { precision: 14, scale: 2 }).notNull(),
    salvageValueKes: numeric('salvage_value_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    depreciationMethod: text('depreciation_method').default('STRAIGHT_LINE').notNull(),
    accumulatedDepreciationKes: numeric('accumulated_depreciation_kes', {
      precision: 14,
      scale: 2,
    })
      .default('0.00')
      .notNull(),
    netBookValueKes: numeric('net_book_value_kes', { precision: 14, scale: 2 }).notNull(),
    assetAccountId: integer('asset_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    accumDepAccountId: integer('accum_dep_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    depExpenseAccountId: integer('dep_expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    status: text('status').default('ACTIVE').notNull(),
    disposedAt: timestamp('disposed_at'),
    disposalProceedsKes: numeric('disposal_proceeds_kes', { precision: 14, scale: 2 }),
    disposalJournalId: integer('disposal_journal_id').references(() => journalEntries.id),
    disposalNotes: text('disposal_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityCodeIdx: uniqueIndex('fixed_assets_facility_code_idx').on(
      table.facilityId,
      table.assetCode,
    ),
  }),
);

export const fixedAssetMovements = pgTable(
  'fixed_asset_movements',
  {
    id: serial('id').primaryKey(),
    assetId: integer('asset_id')
      .references(() => fixedAssets.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    movementType: text('movement_type').notNull(),
    movementDate: text('movement_date').notNull(),
    periodCode: text('period_code').notNull(),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    netBookValueAfterKes: numeric('net_book_value_after_kes', {
      precision: 14,
      scale: 2,
    }).notNull(),
    journalEntryId: integer('journal_entry_id').references(() => journalEntries.id),
    notes: text('notes'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    depPeriodIdx: uniqueIndex('fixed_asset_movements_dep_period_idx').on(
      table.assetId,
      table.movementType,
      table.periodCode,
    ),
  }),
);

export const supplierInvoices = pgTable(
  'supplier_invoices',
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
    purchaseOrderId: integer('purchase_order_id').references(() => purchaseOrders.id),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: text('invoice_date').notNull(),
    dueDate: text('due_date'),
    expenseAccountId: integer('expense_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    apAccountId: integer('ap_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    serviceLine: text('service_line'),
    subtotalKes: numeric('subtotal_kes', { precision: 14, scale: 2 }).notNull(),
    taxKes: numeric('tax_kes', { precision: 14, scale: 2 }).default('0.00').notNull(),
    totalAmountKes: numeric('total_amount_kes', { precision: 14, scale: 2 }).notNull(),
    paidAmountKes: numeric('paid_amount_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    balanceKes: numeric('balance_kes', { precision: 14, scale: 2 }).notNull(),
    status: text('status').default('POSTED').notNull(),
    postedJournalId: integer('posted_journal_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilitySupNumIdx: uniqueIndex('supplier_invoices_facility_sup_num_idx').on(
      table.facilityId,
      table.supplierId,
      table.invoiceNumber,
    ),
  }),
);

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    accountName: text('account_name').notNull(),
    bankCode: text('bank_code').notNull(),
    bankName: text('bank_name').notNull(),
    branchName: text('branch_name'),
    accountNumberMasked: text('account_number_masked'),
    currency: text('currency').default('KES').notNull(),
    accountKind: text('account_kind').default('BANK').notNull(),
    glAccountId: integer('gl_account_id')
      .references(() => chartOfAccounts.id)
      .notNull(),
    connectorMode: text('connector_mode').default('STATEMENT_IMPORT_ONLY').notNull(),
    connectorConfig: jsonb('connector_config')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    openingBalanceKes: numeric('opening_balance_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    bookBalanceKes: numeric('book_balance_kes', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    lastStatementBalanceKes: numeric('last_statement_balance_kes', { precision: 14, scale: 2 }),
    lastReconciledAt: timestamp('last_reconciled_at'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityNameIdx: uniqueIndex('bank_accounts_facility_name_idx').on(
      table.facilityId,
      table.accountName,
    ),
  }),
);

export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    supplierInvoiceId: integer('supplier_invoice_id')
      .references(() => supplierInvoices.id)
      .notNull(),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    paymentNumber: text('payment_number').notNull(),
    paymentDate: text('payment_date').notNull(),
    paymentMethod: text('payment_method').notNull(),
    bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
    paymentReference: text('payment_reference'),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    postedJournalId: integer('posted_journal_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdempIdx: uniqueIndex('supplier_payments_facility_idemp_idx').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  }),
);

export const bankStatementImports = pgTable(
  'bank_statement_imports',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    bankAccountId: integer('bank_account_id')
      .references(() => bankAccounts.id)
      .notNull(),
    importReference: text('import_reference').notNull(),
    sourceType: text('source_type').default('CSV_IMPORT').notNull(),
    statementStartDate: text('statement_start_date').notNull(),
    statementEndDate: text('statement_end_date').notNull(),
    openingBalanceKes: numeric('opening_balance_kes', { precision: 14, scale: 2 }),
    closingBalanceKes: numeric('closing_balance_kes', { precision: 14, scale: 2 }).notNull(),
    lineCount: integer('line_count').default(0).notNull(),
    fileHash: text('file_hash').notNull(),
    importedByUserId: integer('imported_by_user_id').references(() => users.id),
    importedAt: timestamp('imported_at').defaultNow().notNull(),
  },
  (table) => ({
    accountHashIdx: uniqueIndex('bank_stmt_imports_account_hash_idx').on(
      table.bankAccountId,
      table.fileHash,
    ),
  }),
);

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    bankAccountId: integer('bank_account_id')
      .references(() => bankAccounts.id)
      .notNull(),
    statementImportId: integer('statement_import_id').references(() => bankStatementImports.id),
    transactionDate: text('transaction_date').notNull(),
    valueDate: text('value_date'),
    referenceNumber: text('reference_number'),
    description: text('description').notNull(),
    direction: text('direction').notNull(),
    amountKes: numeric('amount_kes', { precision: 14, scale: 2 }).notNull(),
    runningBalanceKes: numeric('running_balance_kes', { precision: 14, scale: 2 }),
    originClassification: text('origin_classification').default('IMPORTED_STATEMENT').notNull(),
    matchStatus: text('match_status').default('UNMATCHED').notNull(),
    dedupeHash: text('dedupe_hash').notNull(),
    matchedJournalLineId: integer('matched_journal_line_id').references(() => journalLines.id),
    matchedJournalEntryId: integer('matched_journal_entry_id').references(() => journalEntries.id),
    matchedBillingPaymentId: integer('matched_billing_payment_id').references(
      () => billingPayments.id,
    ),
    matchedSupplierPaymentId: integer('matched_supplier_payment_id').references(
      () => supplierPayments.id,
    ),
    matchedByUserId: integer('matched_by_user_id').references(() => users.id),
    matchedAt: timestamp('matched_at'),
    externalTxId: text('external_tx_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    accountDateIdx: index('bank_transactions_account_date_idx').on(
      table.bankAccountId,
      table.transactionDate,
    ),
  }),
);

export const bankReconciliations = pgTable('bank_reconciliations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),
  bankAccountId: integer('bank_account_id')
    .references(() => bankAccounts.id)
    .notNull(),
  statementImportId: integer('statement_import_id')
    .references(() => bankStatementImports.id)
    .notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  periodCode: text('period_code').notNull(),
  statementEndingDate: text('statement_ending_date').notNull(),
  statementEndingBalanceKes: numeric('statement_ending_balance_kes', {
    precision: 14,
    scale: 2,
  }).notNull(),
  ledgerBookBalanceKes: numeric('ledger_book_balance_kes', {
    precision: 14,
    scale: 2,
  }).notNull(),
  unmatchedDepositsKes: numeric('unmatched_deposits_kes', { precision: 14, scale: 2 })
    .default('0.00')
    .notNull(),
  unmatchedWithdrawalsKes: numeric('unmatched_withdrawals_kes', { precision: 14, scale: 2 })
    .default('0.00')
    .notNull(),
  adjustedDifferenceKes: numeric('adjusted_difference_kes', { precision: 14, scale: 2 })
    .default('0.00')
    .notNull(),
  status: text('status').default('DRAFT').notNull(),
  reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
  reconciledAt: timestamp('reconciled_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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

export const websiteBookingClients = pgTable(
  'website_booking_clients',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    clientName: text('client_name').notNull(),
    apiKeyPrefix: text('api_key_prefix').notNull(),
    apiKeyHash: text('api_key_hash').notNull(),
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().default([]).notNull(),
    allowedServices: jsonb('allowed_services').$type<string[]>().default([]).notNull(),
    slotDurationMinutes: integer('slot_duration_minutes').default(0).notNull(),
    dailyCapacityPerService: integer('daily_capacity_per_service').default(0).notNull(),
    operatingHours: jsonb('operating_hours').$type<Record<string, unknown>>().default({}).notNull(),
    rateLimitPerMinute: integer('rate_limit_per_minute').default(30).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastUsedAt: timestamp('last_used_at'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    hashIdx: uniqueIndex('website_booking_clients_hash_idx').on(table.apiKeyHash),
  }),
);

export const websiteBookingSlots = pgTable('website_booking_slots', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),
  serviceCode: text('service_code').notNull(),
  slotDate: date('slot_date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  capacity: integer('capacity').notNull(),
  status: text('status').default('OPEN').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const externalBookings = pgTable(
  'external_bookings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    bookingReference: text('booking_reference').notNull(),
    bookingClientId: integer('booking_client_id')
      .references(() => websiteBookingClients.id)
      .notNull(),
    slotId: integer('slot_id')
      .references(() => websiteBookingSlots.id)
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    duplicateHash: text('duplicate_hash').notNull(),
    serviceCode: text('service_code').notNull(),
    departmentId: integer('department_id').references(() => departments.id),
    requestedDate: text('requested_date').notNull(),
    slotStartTime: text('slot_start_time').notNull(),
    slotEndTime: text('slot_end_time').notNull(),
    status: text('status').default('PENDING').notNull(),
    patientId: integer('patient_id').references(() => patients.id),
    patientFullName: text('patient_full_name').notNull(),
    patientPhoneEncrypted: text('patient_phone_encrypted').notNull(),
    patientPhoneHash: text('patient_phone_hash').notNull(),
    patientEmail: text('patient_email'),
    visitReason: text('visit_reason'),
    linkedAppointmentId: integer('linked_appointment_id').references(() => appointments.id),
    linkedDialysisScheduleId: integer('linked_dialysis_schedule_id').references(
      () => dialysisSchedules.id,
    ),
    cancellationReason: text('cancellation_reason'),
    rescheduleCount: integer('reschedule_count').default(0).notNull(),
    notificationLog: jsonb('notification_log')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    sourceChannel: text('source_channel').default('WEBSITE_API').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    refIdx: uniqueIndex('external_bookings_ref_idx').on(table.bookingReference),
    facilityIdempIdx: uniqueIndex('external_bookings_facility_idemp_idx').on(
      table.bookingClientId,
      table.idempotencyKey,
    ),
  }),
);

export const websiteBookingEvents = pgTable('website_booking_events', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id')
    .references(() => externalBookings.id)
    .notNull(),
  clientId: integer('client_id').references(() => websiteBookingClients.id),
  actorUserId: integer('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  previousSlotId: integer('previous_slot_id').references(() => websiteBookingSlots.id),
  newSlotId: integer('new_slot_id').references(() => websiteBookingSlots.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const websiteBookingMutations = pgTable('website_booking_mutations', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id')
    .references(() => websiteBookingClients.id)
    .notNull(),
  bookingId: integer('booking_id')
    .references(() => externalBookings.id)
    .notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* Payment hub — global catalogue, facility-scoped configuration and review. */
export const paymentProviderDefinitions = pgTable('payment_provider_definitions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  displayName: text('display_name').notNull(),
  adapterKey: text('adapter_key').notNull(),
  documentationUrl: text('documentation_url').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  requestable: boolean('requestable').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const paymentProviderEnvironments = pgTable(
  'payment_provider_environments',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => paymentProviderDefinitions.id),
    environment: text('environment').notNull(),
    isAvailable: boolean('is_available').notNull().default(false),
    sharedSecretReference: text('shared_secret_reference'),
    sharedContractReference: text('shared_contract_reference'),
  },
  (t) => [uniqueIndex('payment_provider_env_schema_idx').on(t.providerId, t.environment)],
);
export const paymentProviderAssignments = pgTable(
  'payment_provider_assignments',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => paymentProviderDefinitions.id),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    isAllowed: boolean('is_allowed').notNull().default(false),
    sharedCredentialsAllowed: boolean('shared_credentials_allowed').notNull().default(false),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_provider_assignments_schema_idx').on(t.providerId, t.facilityId)],
);
export const paymentProviderCapabilityPolicies = pgTable(
  'payment_provider_capability_policies',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => paymentProviderDefinitions.id),
    capability: text('capability').notNull(),
    isAllowed: boolean('is_allowed').notNull().default(false),
  },
  (t) => [
    uniqueIndex('payment_provider_capability_policy_schema_idx').on(t.providerId, t.capability),
  ],
);
export const paymentProviderAccessRequests = pgTable(
  'payment_provider_access_requests',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => paymentProviderDefinitions.id),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    status: text('status').notNull().default('PENDING'),
    requestedByUserId: integer('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_provider_requests_schema_idx').on(t.providerId, t.facilityId)],
);
export const facilityPaymentIntegrations = pgTable(
  'facility_payment_integrations',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => paymentProviderDefinitions.id),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    environment: text('environment').notNull(),
    enabledCapabilities: text('enabled_capabilities').array().notNull().default([]),
    isEnabled: boolean('is_enabled').notNull().default(false),
    connectionStatus: text('connection_status').notNull().default('NOT_TESTED'),
    lastHealthAt: timestamp('last_health_at'),
    lastErrorCode: text('last_error_code'),
    productionApproval: text('production_approval').notNull().default('NOT_REQUESTED'),
    approvalReference: text('approval_reference'),
    productionRequestedByUserId: integer('production_requested_by_user_id').references(
      () => users.id,
    ),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('facility_payment_integrations_schema_idx').on(
      t.providerId,
      t.facilityId,
      t.environment,
    ),
  ],
);
export const facilityPaymentSecrets = pgTable('facility_payment_secrets', {
  integrationId: integer('integration_id')
    .primaryKey()
    .references(() => facilityPaymentIntegrations.id),
  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  credentialIdentityHash: text('credential_identity_hash').unique(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const facilityPaymentAccounts = pgTable(
  'facility_payment_accounts',
  {
    id: serial('id').primaryKey(),
    integrationId: integer('integration_id')
      .notNull()
      .references(() => facilityPaymentIntegrations.id),
    tenantId: integer('tenant_id').notNull(),
    facilityId: integer('facility_id').notNull(),
    alias: text('alias').notNull(),
    accountType: text('account_type').notNull(),
    maskedIdentifier: text('masked_identifier').notNull(),
    bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
    authorizationState: text('authorization_state').notNull().default('PENDING'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('facility_payment_accounts_schema_idx').on(t.integrationId, t.alias)],
);
export const paymentHubTransactions = pgTable(
  'payment_hub_transactions',
  {
    id: serial('id').primaryKey(),
    integrationId: integer('integration_id')
      .notNull()
      .references(() => facilityPaymentIntegrations.id),
    tenantId: integer('tenant_id').notNull(),
    facilityId: integer('facility_id').notNull(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => billingInvoices.id),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    providerRequestId: text('provider_request_id').unique(),
    status: text('status').notNull().default('INITIATING'),
    resultCode: text('result_code'),
    lastQueryAt: timestamp('last_query_at'),
    initiatedByUserId: integer('initiated_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_hub_transactions_schema_idx').on(t.facilityId, t.idempotencyKey)],
);
export const paymentHubWebhookEvents = pgTable(
  'payment_hub_webhook_events',
  {
    id: serial('id').primaryKey(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => paymentHubTransactions.id),
    tenantId: integer('tenant_id').notNull(),
    facilityId: integer('facility_id').notNull(),
    eventHash: text('event_hash').notNull(),
    resultCode: text('result_code'),
    verificationState: text('verification_state').notNull().default('UNVERIFIED'),
    receivedAt: timestamp('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_hub_webhook_events_schema_idx').on(t.transactionId, t.eventHash)],
);
export const paymentHubReconciliations = pgTable('payment_hub_reconciliations', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id')
    .notNull()
    .references(() => paymentHubTransactions.id),
  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),
  billingPaymentId: integer('billing_payment_id')
    .notNull()
    .references(() => billingPayments.id),
  status: text('status').notNull().default('MATCHED'),
  evidenceReference: text('evidence_reference').notNull(),
  matchedByUserId: integer('matched_by_user_id')
    .notNull()
    .references(() => users.id),
  matchedAt: timestamp('matched_at').notNull().defaultNow(),
  voidedByUserId: integer('voided_by_user_id').references(() => users.id),
  voidedAt: timestamp('voided_at'),
});
