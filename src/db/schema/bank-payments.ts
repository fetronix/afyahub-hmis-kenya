/** Controlled manual bank evidence. SQL migration 0091 owns composite FKs and transition guards. */
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  numeric,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { bankAccounts, bankTransactions } from './banking.ts';
import { billingInvoices, billingPayments } from './billing.ts';

export const facilityBankPaymentPolicies = pgTable('facility_bank_payment_policies', {
  facilityId: integer('facility_id').primaryKey(),
  tenantId: integer('tenant_id').notNull(),
  bankOnly: boolean('bank_only').notNull().default(true),
  enabledByUserId: integer('enabled_by_user_id')
    .notNull()
    .references(() => users.id),
  enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
});
export const bankAccountIdentifiers = pgTable('bank_account_identifiers', {
  bankAccountId: integer('bank_account_id')
    .primaryKey()
    .references(() => bankAccounts.id),
  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),
  encryptedIdentifier: text('encrypted_identifier').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const bankPaymentRecords = pgTable(
  'bank_payment_records',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    facilityId: integer('facility_id').notNull(),
    bankAccountId: integer('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => billingInvoices.id),
    amountKes: numeric('amount_kes', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('KES'),
    bankReference: text('bank_reference').notNull(),
    paymentDate: date('payment_date').notNull(),
    payerParty: text('payer_party').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('PENDING'),
    submittedByUserId: integer('submitted_by_user_id')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    statementTransactionId: integer('statement_transaction_id')
      .unique()
      .references(() => bankTransactions.id),
    verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationNotes: text('verification_notes'),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    billingPaymentId: integer('billing_payment_id')
      .unique()
      .references(() => billingPayments.id),
    rejectedByUserId: integer('rejected_by_user_id').references(() => users.id),
    rejectionReason: text('rejection_reason'),
  },
  (t) => [
    uniqueIndex('bank_payment_records_facility_id_idempotency_key_key').on(
      t.facilityId,
      t.idempotencyKey,
    ),
  ],
);
export const bankPaymentEvents = pgTable('bank_payment_events', {
  id: serial('id').primaryKey(),
  bankPaymentId: integer('bank_payment_id')
    .notNull()
    .references(() => bankPaymentRecords.id),
  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),
  actorUserId: integer('actor_user_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
