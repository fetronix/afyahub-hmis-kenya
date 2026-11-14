/**
 * JaliCare HMIS — insurance remittances schema.
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
import { billingInvoices, billingPayments } from './billing.ts';
import { shaEclaims } from './sha-claims.ts';
import { facilities, tenants } from './tenancy.ts';

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
