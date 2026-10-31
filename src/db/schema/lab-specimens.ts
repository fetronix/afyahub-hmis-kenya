import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, facilities } from './tenancy.ts';
import { patients } from './patients.ts';
import { users } from './auth.ts';
import { labOrders } from './laboratory.ts';

/** Explicit identity for newly recorded specimens; historical rows are not guessed. */
export const labSpecimens = pgTable(
  'lab_specimens',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    patientId: integer('patient_id')
      .notNull()
      .references(() => patients.id),
    accessionNumber: text('accession_number').notNull(),
    collectedAt: timestamp('collected_at').notNull(),
    collectedByUserId: integer('collected_by_user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => ({
    accession: uniqueIndex('lab_specimens_facility_accession_uq').on(
      t.facilityId,
      sql`lower(btrim(${t.accessionNumber}))`,
    ),
  }),
);

export const labSpecimenOrders = pgTable(
  'lab_specimen_orders',
  {
    id: serial('id').primaryKey(),
    specimenId: integer('specimen_id')
      .notNull()
      .references(() => labSpecimens.id),
    orderId: integer('order_id')
      .notNull()
      .references(() => labOrders.id),
  },
  (t) => ({ order: uniqueIndex('lab_specimen_orders_order_uq').on(t.orderId) }),
);
