/**
 * JaliCare HMIS — insurance payers schema.
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
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { facilityServiceTariffs } from './billing.ts';
import { patients } from './patients.ts';
import { facilities, tenants } from './tenancy.ts';

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

// Platform-owned payer metadata and facility assignment are distinct from
// insurancePayerConfigs, which retains facility-owned workflow settings.
export const insurancePayerDefinitions = pgTable('insurance_payer_definitions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  displayName: text('display_name').notNull(),
  payerType: text('payer_type').notNull(),
  adapterKey: text('adapter_key').notNull(),
  informationUrl: text('information_url').notNull(),
  status: text('status').notNull().default('DISABLED'),
  requestable: boolean('requestable').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const insurancePayerCapabilityPolicies = pgTable('insurance_payer_capability_policies', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id')
    .notNull()
    .references(() => insurancePayerDefinitions.id),
  capability: text('capability').notNull(),
  isAllowed: boolean('is_allowed').notNull().default(false),
});

export const insurancePayerAssignments = pgTable('insurance_payer_assignments', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id')
    .notNull()
    .references(() => insurancePayerDefinitions.id),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  facilityId: integer('facility_id')
    .notNull()
    .references(() => facilities.id),
  isAllowed: boolean('is_allowed').notNull().default(false),
  assignmentSource: text('assignment_source').notNull().default('PLATFORM'),
  sandboxStatus: text('sandbox_status').notNull().default('NOT_TESTED'),
  productionApproval: text('production_approval').notNull().default('NOT_REQUESTED'),
  productionRequestedByUserId: integer('production_requested_by_user_id').references(
    () => users.id,
  ),
  productionDecidedByUserId: integer('production_decided_by_user_id').references(() => users.id),
  approvalReference: text('approval_reference'),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const insurancePayerEnvironmentConfigs = pgTable('insurance_payer_environment_configs', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id')
    .notNull()
    .references(() => insurancePayerDefinitions.id),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  facilityId: integer('facility_id')
    .notNull()
    .references(() => facilities.id),
  environment: text('environment').notNull(),
  secretEnvPrefix: text('secret_env_prefix').notNull(),
  providerIdentifier: text('provider_identifier'),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const insurancePayerAccessRequests = pgTable('insurance_payer_access_requests', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id')
    .notNull()
    .references(() => insurancePayerDefinitions.id),
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
});

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
