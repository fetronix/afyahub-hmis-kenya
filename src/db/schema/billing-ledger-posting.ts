/** Immutable audit link from a reviewed billing source to its posted GL journal. */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { billingInvoices, billingPayments } from './billing.ts';
import { journalEntries } from './financial-ledger.ts';
import { facilities, tenants } from './tenancy.ts';

export const accountingBillingPostings = pgTable(
  'accounting_billing_postings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    sourceType: text('source_type').notNull(),
    sourceId: integer('source_id').notNull(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => billingInvoices.id),
    paymentId: integer('payment_id').references(() => billingPayments.id),
    journalId: integer('journal_id')
      .notNull()
      .unique()
      .references(() => journalEntries.id),
    party: text('party').$type<'PATIENT' | 'INSURER'>(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    receivableCents: bigint('receivable_cents', { mode: 'number' }).notNull(),
    liabilityCents: bigint('liability_cents', { mode: 'number' }).notNull(),
    classification: jsonb('classification').notNull(),
    requestHash: text('request_hash').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounting_billing_posting_source_unique').on(
      table.facilityId,
      table.sourceType,
      table.sourceId,
    ),
    index('accounting_billing_postings_invoice_idx').on(
      table.tenantId,
      table.facilityId,
      table.invoiceId,
      table.id,
    ),
  ],
);
