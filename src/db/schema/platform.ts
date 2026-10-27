/**
 * JaliCare HMIS
 * Schema: Professional credentials, DHA bookkeeping, and patient portal
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

import { facilities, tenants } from './tenancy.ts';

import { users } from './auth.ts';

import { patients } from './patients.ts';

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
