/**
 * JaliCare HMIS
 * Schema: Referrals, referral documents, and health-record exchange
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
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { departments, facilities, tenants } from './tenancy.ts';

import { users } from './auth.ts';

import { patients, practitioners } from './patients.ts';

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
