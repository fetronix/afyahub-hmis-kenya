/**
 * Schema — tenancy and facility settings
 *
 * The root of the domain graph. Every other schema module may import from
 * here; this module imports from none of them, which is what keeps the split
 * acyclic.
 *
 * WHY THESE TABLES TOGETHER
 *
 * They answer one question: "whose data is this and which site does it
 * belong to". `tenants` isolates customers, `facilities` scopes staff to a
 * site, and the subscription tables describe what a facility has paid for.
 * Everything clinical eventually references one of them.
 *
 * WHAT MUST NOT CHANGE
 *
 * Table names, column names, constraints and indexes are byte-for-byte the
 * ones that were in `src/db/schema.ts`. This is a file move, not a schema
 * change: the migrations in `drizzle/` are untouched and the tables they
 * create are unaffected. The single exported interface is preserved through
 * the barrel at `src/db/schema.ts`, so `import * as schema from
 * './db/schema.ts'` and `schema.tenants` behave exactly as before.
 *
 * Extracted from `src/db/schema.ts`, tenancy domain, first of thirteen.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
      'maternity',
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
    tenantCodeIdx: uniqueIndex('facilities_tenant_code_idx').on(table.tenantId, table.code),

    mflCodeIdx: uniqueIndex('facilities_mfl_code_idx').on(table.mflCode),
  }),
);

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

    status: text('status').default('PROSPECT').notNull(),

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
    facilityIdx: uniqueIndex('facility_onboarding_facility_idx').on(table.facilityId),

    tenantStatusIdx: index('facility_onboarding_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);

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

    verificationStatus: text('verification_status').default('PENDING').notNull(),

    /*
      PENDING
      VERIFIED
      REJECTED
    */

    uploadedBy: text('uploaded_by'),

    verifiedBy: text('verified_by'),

    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),

    verifiedAt: timestamp('verified_at'),

    rejectionReason: text('rejection_reason'),

    metadata: jsonb('metadata').default({}),
  },
  (table) => ({
    facilityIdx: index('facility_documents_facility_idx').on(table.facilityId),

    verificationIdx: index('facility_documents_verification_idx').on(table.verificationStatus),
  }),
);

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
    facilityCodeIdx: uniqueIndex('departments_facility_code_idx').on(table.facilityId, table.code),
  }),
);

export const facilitySubscriptionAccess = pgTable(
  'facility_subscription_access',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    accessStatus: text('access_status').default('ACTIVE').notNull(),
    suspendedAt: timestamp('suspended_at'),
    suspendedBy: text('suspended_by'),
    suspensionReason: text('suspension_reason'),
    reactivatedAt: timestamp('reactivated_at'),
    reactivatedBy: text('reactivated_by'),

    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityUnique: uniqueIndex('facility_subscription_access_facility_uidx').on(table.facilityId),
    tenantIdx: index('facility_subscription_access_tenant_idx').on(table.tenantId),
    statusIdx: index('facility_subscription_access_status_idx').on(table.accessStatus),
  }),
);

export const facilitySubscriptionPeriods = pgTable(
  'facility_subscription_periods',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    subscriptionName: text('subscription_name').notNull(),
    amountDue: numeric('amount_due', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').default('KES').notNull(),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    dueDate: date('due_date').notNull(),
    gracePeriodEnd: date('grace_period_end'),

    status: text('status').default('PENDING').notNull(),
    notes: text('notes'),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    facilityIdx: index('facility_subscription_periods_facility_idx').on(table.facilityId),
    tenantIdx: index('facility_subscription_periods_tenant_idx').on(table.tenantId),
    statusIdx: index('facility_subscription_periods_status_idx').on(table.status),
    periodStartIdx: index('facility_subscription_periods_start_idx').on(table.periodStart),
  }),
);

export const facilitySubscriptionPayments = pgTable(
  'facility_subscription_payments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    subscriptionPeriodId: integer('subscription_period_id')
      .references(() => facilitySubscriptionPeriods.id)
      .notNull(),

    transactionCode: text('transaction_code').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: text('payment_method').default('MPESA').notNull(),
    paymentDate: timestamp('payment_date').defaultNow().notNull(),

    verificationStatus: text('verification_status').default('PENDING').notNull(),
    verifiedBy: text('verified_by'),
    verifiedAt: timestamp('verified_at'),
    verificationNotes: text('verification_notes'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    transactionCodeUnique: uniqueIndex('facility_subscription_payments_transaction_code_uidx').on(
      table.transactionCode,
    ),
    periodIdx: index('facility_subscription_payments_period_idx').on(table.subscriptionPeriodId),
    facilityIdx: index('facility_subscription_payments_facility_idx').on(table.facilityId),
    verificationIdx: index('facility_subscription_payments_verification_idx').on(
      table.verificationStatus,
    ),
  }),
);

export const facilitySubscriptionPriceChanges = pgTable(
  'facility_subscription_price_changes',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    subscriptionPeriodId: integer('subscription_period_id')
      .references(() => facilitySubscriptionPeriods.id)
      .notNull(),

    previousAmount: numeric('previous_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),
    newAmount: numeric('new_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),

    effectiveTiming: text('effective_timing').notNull(),
    reason: text('reason').notNull(),
    changedBy: text('changed_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    periodIdx: index('facility_subscription_price_changes_period_idx').on(
      table.subscriptionPeriodId,
    ),
    facilityIdx: index('facility_subscription_price_changes_facility_idx').on(table.facilityId),
  }),
);
