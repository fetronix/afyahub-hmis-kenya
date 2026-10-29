/**
 * JaliCare HMIS — payment hub schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { bankAccounts } from './banking.ts';
import { billingInvoices, billingPayments } from './billing.ts';
import { facilities, tenants } from './tenancy.ts';

/* Global payment catalogue, facility-scoped configuration and review. */
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
