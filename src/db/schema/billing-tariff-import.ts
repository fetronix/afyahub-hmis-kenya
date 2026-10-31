/** Immutable request identity for a facility-approved tariff import batch. */
import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { facilities, tenants } from './tenancy.ts';

export const facilityTariffImportBatches = pgTable(
  'facility_tariff_import_batches',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    approvalReference: text('approval_reference').notNull(),
    result: jsonb('result').notNull(),
    rowCount: integer('row_count').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_tariff_import_facility_key_unique').on(
      table.facilityId,
      table.idempotencyKey,
    ),
  ],
);
