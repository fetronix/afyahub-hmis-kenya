/**
 * JaliCare HMIS — private insurance schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  numeric,
  jsonb,
  date,
  uniqueIndex,
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
import { admissions } from './inpatient.ts';
import {
  insuranceEligibilityVerifications,
  insurancePreauthorizations,
} from './insurance-benefits.ts';
import { insuranceMemberPolicies, payerServiceCodeMappings } from './insurance-payers.ts';
import { insuranceRemittances } from './insurance-remittances.ts';
import { patients } from './patients.ts';
import { facilities, tenants } from './tenancy.ts';

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
    dispatchRevision: integer('dispatch_revision').default(0).notNull(),
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
