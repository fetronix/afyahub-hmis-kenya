/**
 * JaliCare HMIS
 * Schema: Service tariffs, invoices, items, payments, and insurance claims
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
  numeric,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';

import { facilities, tenants } from './tenancy.ts';

import { patients } from './patients.ts';

import { encounters } from './clinical.ts';

export const facilityServiceTariffs = pgTable(
  'facility_service_tariffs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    department: text('department').notNull(),
    unit: text('unit').notNull().default('Service'),
    fee: numeric('fee', { precision: 10, scale: 2 }).notNull(),
    shaStatus: text('sha_status').notNull().default('Not Assessed'),
    shaNotes: text('sha_notes'),
    /*
     * Which automatic charge this tariff answers, if any.
     *
     * Facilities number their tariffs (`OPD-001`, `LAB-006`) rather than
     * using the codes the billing engine looks for, so a price list can
     * exist and still bill nothing. This column records the link the
     * facility makes, once, instead of the engine guessing between
     * OPD-001 (150) and OPD-002 (300).
     *
     * NULL means "not linked"; the tariff is still reachable by code.
     * See migration 0019 and `src/billing/tariff-codes.ts` for the
     * vocabulary.
     */
    billingKey: text('billing_key'),

    /*
     * When this price applies. Both nullable: NULL means "always", so
     * every existing row keeps working and no date had to be invented
     * for it. A resolver checks today's date against the pair.
     */
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),

    /*
     * Whether automatic billing may use this tariff. Default true, so
     * behaviour is unchanged; a facility can keep a tariff for manual
     * pricing while excluding it from automatic charging.
     */
    autoBill: boolean('auto_bill').notNull().default(true),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('facility_service_tariffs_facility_code_unique').on(table.facilityId, table.code),
    index('facility_service_tariffs_tenant_facility_idx').on(table.tenantId, table.facilityId),
    index('facility_service_tariffs_active_idx').on(table.facilityId, table.isActive),
  ],
);
export const billingInvoices = pgTable('billing_invoices', {
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

  encounterId: integer('encounter_id').references(() => encounters.id),

  invoiceNumber: text('invoice_number').notNull().unique(),

  totalAmount: numeric('total_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  paidAmount: numeric('paid_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  balanceAmount: numeric('balance_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  status: text('status').default('Pending'),

  /*
   * Money received beyond the invoice total. Kept as its own column
   * instead of letting balance_amount go negative, because a negative
   * balance silently cancels out other patients' debts whenever the
   * facility totals what it is owed.
   */
  creditBalance: numeric('credit_balance', {
    precision: 10,
    scale: 2,
  }).default('0'),

  payerType: text('payer_type').default('Self-Pay'),

  payerName: text('payer_name'),

  memberNumber: text('member_number'),

  voidedAt: timestamp('voided_at'),

  voidReason: text('void_reason'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   40. BILLING ITEMS
   ============================================================ */

export const billingItems = pgTable('billing_items', {
  id: serial('id').primaryKey(),

  invoiceId: integer('invoice_id')
    .references(() => billingInvoices.id)
    .notNull(),

  tariffId: integer('tariff_id').references(() => facilityServiceTariffs.id, {
    onDelete: 'set null',
  }),

  tariffCode: text('tariff_code'),

  /*
   * Provenance: which clinical event produced this line item.
   *
   *   CONSULTATION | LAB_ORDER | PROCEDURE | RADIOLOGY | PHARMACY
   *   ADMISSION | BED_DAY | MANUAL
   */
  sourceType: text('source_type'),

  sourceId: integer('source_id'),

  /*
   * Idempotency key for engine-generated charges, enforced by a UNIQUE
   * partial index in migration 0009. Replaying a clinical event can
   * never create a second charge. Manual items leave this NULL.
   */
  idempotencyKey: text('idempotency_key'),

  itemType: text('item_type').notNull(),

  description: text('description').notNull(),

  quantity: integer('quantity').default(1),

  unitPrice: numeric('unit_price', {
    precision: 10,
    scale: 2,
  }).default('0'),

  totalAmount: numeric('total_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * The link between a catalogue service and the price that answers it.
 *
 * `service_id` is the stable id of the catalogue row — `lab_tests.id`
 * for a laboratory test — not a code someone can rename. `NULL` means
 * the link covers every service of that type.
 *
 * Why a table instead of comparing strings: the engine used to ask for
 * `LAB-BLOOD` when the facility's row was `LAB-001`, and every failure
 * mode (missing, inactive, expired, another facility, ambiguous) looked
 * identical from the outside. A link by id cannot be ambiguous, and a
 * link can be validated field by field.
 *
 * The composite foreign key to `(facility_id, id)` means a link can
 * only reference a tariff of the same facility: isolation is a
 * constraint, not a convention.
 *
 * See migration 0021.
 */
export const serviceTariffLinks = pgTable(
  'service_tariff_links',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    /** LAB_TEST | CONSULTATION | RADIOLOGY | … (see migration 0021). */
    serviceType: text('service_type').notNull(),

    /** Catalogue row id; NULL links the whole family. */
    serviceId: integer('service_id'),

    /** Snapshot of the catalogue code and name at link time. */
    serviceCode: text('service_code'),
    serviceName: text('service_name'),

    tariffId: integer('tariff_id').notNull(),

    autoBill: boolean('auto_bill').notNull().default(true),

    note: text('note'),
    createdBy: text('created_by'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('service_tariff_links_service_unique')
      .on(table.facilityId, table.serviceType, table.serviceId)
      .where(sql`${table.isActive} AND ${table.serviceId} is not null`),
    uniqueIndex('service_tariff_links_family_unique')
      .on(table.facilityId, table.serviceType)
      .where(sql`${table.isActive} AND ${table.serviceId} is null`),
    index('service_tariff_links_facility_idx').on(
      table.tenantId,
      table.facilityId,
      table.serviceType,
    ),
    index('service_tariff_links_tariff_idx').on(table.tariffId),
  ],
);

/**
 * A charge the billing engine could not price.
 *
 * The clinical action succeeded but no invoice line exists, so the
 * money owed is invisible. This row keeps the original request so the
 * charge can be replayed once the facility configures a tariff — and so
 * the configuration screen can say what is waiting.
 *
 * See migration 0020. Status: PENDING | BILLED | DUPLICATE | VOID.
 */
export const billingChargeAttempts = pgTable(
  'billing_charge_attempts',
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

    encounterId: integer('encounter_id'),

    sourceType: text('source_type').notNull(),
    sourceId: integer('source_id'),
    itemType: text('item_type').notNull(),
    description: text('description'),

    /** Candidates the engine tried, in priority order. */
    codes: text('codes').array().notNull().default([]),
    /** Linked keys the facility can set (`CONSULTATION`). */
    serviceKeys: text('service_keys').array().notNull().default([]),

    family: text('family'),
    serviceName: text('service_name'),
    encounterType: text('encounter_type'),
    aliases: text('aliases').array().notNull().default([]),

    /*
     * Which occurrence of the source this is: the bed-night date for a
     * ward charge (`BED_DAY:12:2026-10-20`), null when the source is
     * billed once. Without it, a five-night stay with no tariff would
     * collapse into a single queue row and only one night could ever be
     * reprocessed.
     */
    idempotencySuffix: text('idempotency_suffix'),

    /** Bed category at accrual time, so a replay prices the same bed. */
    wardType: text('ward_type'),
    wardName: text('ward_name'),

    quantity: integer('quantity').notNull().default(1),
    fallbackUnitPrice: numeric('fallback_unit_price', { precision: 10, scale: 2 }),

    reason: text('reason').notNull(),
    detail: text('detail'),
    codesTried: text('codes_tried').array().notNull().default([]),

    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(1),
    lastAttemptAt: timestamp('last_attempt_at').defaultNow().notNull(),

    resolvedItemId: integer('resolved_item_id'),
    resolvedInvoiceId: integer('resolved_invoice_id'),
    resolvedTariffCode: text('resolved_tariff_code'),
    resolvedUnitPrice: numeric('resolved_unit_price', { precision: 10, scale: 2 }),
    resolvedAt: timestamp('resolved_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('billing_charge_attempts_pending_unique')
      .on(
        table.facilityId,
        table.sourceType,
        table.sourceId,
        table.itemType,
        sql`coalesce(${table.idempotencySuffix}, '')`,
      )
      .where(sql`${table.status} = 'PENDING' AND ${table.sourceId} is not null`),
    index('billing_charge_attempts_facility_status_idx').on(
      table.tenantId,
      table.facilityId,
      table.status,
    ),
    index('billing_charge_attempts_patient_idx').on(table.patientId),
  ],
);

/* ============================================================
   41. BILLING PAYMENTS
   ============================================================ */

export const billingPayments = pgTable('billing_payments', {
  id: serial('id').primaryKey(),

  invoiceId: integer('invoice_id')
    .references(() => billingInvoices.id)
    .notNull(),

  receiptNumber: text('receipt_number').notNull().unique(),

  paymentMethod: text('payment_method').default('M-Pesa'),

  amount: numeric('amount', {
    precision: 10,
    scale: 2,
  }).notNull(),

  referenceCode: text('reference_code'),

  /*
   * The code printed on the customer's M-Pesa or Airtel confirmation
   * message. Distinct from reference_code so reconciliation can match
   * against a mobile money statement without parsing free text.
   */
  transactionCode: text('transaction_code'),

  /* FULLY_PAID | BALANCE_REMAINING | OVERPAID at the moment of posting. */
  settlementStatus: text('settlement_status'),

  cashierName: text('cashier_name').notNull(),

  paymentDate: timestamp('payment_date').defaultNow().notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ============================================================
   42. INSURANCE / SHA CLAIMS
   ============================================================ */

export const insuranceClaims = pgTable('insurance_claims', {
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

  invoiceId: integer('invoice_id')
    .references(() => billingInvoices.id)
    .notNull(),

  claimNumber: text('claim_number').notNull().unique(),

  payerName: text('payer_name').default('Social Health Authority (SHA)'),

  payerCode: text('payer_code'),

  manualSubmissionReference: text('manual_submission_reference'),

  policyNumber: text('policy_number'),

  preAuthCode: text('pre_auth_code'),

  claimAmount: numeric('claim_amount', {
    precision: 10,
    scale: 2,
  }).notNull(),

  approvedAmount: numeric('approved_amount', {
    precision: 10,
    scale: 2,
  }).default('0'),

  status: text('status').default('Draft'),

  submittedAt: timestamp('submitted_at'),

  adjudicationNotes: text('adjudication_notes'),

  /*
   * The payment that settled this claim. Set when an approved amount
   * is posted against the invoice; null while the money is outstanding.
   */
  settledPaymentId: integer('settled_payment_id').references(() => billingPayments.id, {
    onDelete: 'set null',
  }),

  settledAt: timestamp('settled_at'),

  createdByUserId: integer('created_by_user_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ============================================================
   42b. INSURANCE CLAIM ITEMS
   ============================================================ */

export const insuranceClaimItems = pgTable('insurance_claim_items', {
  id: serial('id').primaryKey(),

  claimId: integer('claim_id')
    .references(() => insuranceClaims.id, { onDelete: 'cascade' })
    .notNull(),

  billingItemId: integer('billing_item_id').references(() => billingItems.id, {
    onDelete: 'set null',
  }),

  /*
   * Snapshot of the line at claim time. The invoice may be edited or
   * voided later; the claim must still say what it asked for.
   */
  description: text('description').notNull(),

  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});
