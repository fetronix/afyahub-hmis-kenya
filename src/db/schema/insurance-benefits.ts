/**
 * JaliCare HMIS — insurance benefits schema.
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
import { billingInvoices, facilityServiceTariffs } from './billing.ts';
import { encounters } from './clinical.ts';
import {
  insuranceMemberPolicies,
  payerBenefitRules,
  payerServiceCodeMappings,
} from './insurance-payers.ts';
import { patients } from './patients.ts';
import { facilities, tenants } from './tenancy.ts';

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
