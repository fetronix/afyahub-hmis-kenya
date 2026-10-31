/**
 * JaliCare HMIS — sha claims schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

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
  index,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import {
  billingInvoices,
  billingItems,
  billingPayments,
  facilityServiceTariffs,
} from './billing.ts';
import { encounters } from './clinical.ts';
import {
  insuranceEligibilityVerifications,
  insurancePreauthorizations,
  shaPatientAuthorizations,
} from './insurance-benefits.ts';
import { patients } from './patients.ts';
import { facilities, tenants } from './tenancy.ts';

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
    dispatchRevision: integer('dispatch_revision').default(0).notNull(),
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
