/**
 * JaliCare HMIS
 * Schema: Patients, their identifiers, consent, and record-access trail
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
  jsonb,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { departments, facilities, tenants } from './tenancy.ts';

import { users } from './auth.ts';

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
