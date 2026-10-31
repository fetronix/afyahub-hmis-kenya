import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';

/** Canonical JaliCare identities. Codes are internal, not payer codes. */
export const masterServices = pgTable(
  'master_services',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    code: text('code').notNull().unique(),
    description: text('description').notNull(),
    department: text('department').notNull(),
    billingFamily: text('billing_family').notNull(),
    unit: text('unit').notNull(),
    clinicalSource: text('clinical_source').notNull(),
    originFacilityId: integer('origin_facility_id').references(() => facilities.id),
    originSourceId: integer('origin_source_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('master_services_origin_unique')
      .on(table.originFacilityId, table.clinicalSource, table.originSourceId)
      .where(sql`${table.originSourceId} is not null`),
  ],
);

/** Facility-scoped, explicit clinical catalogue record -> master identity. */
export const masterServiceSources = pgTable(
  'master_service_sources',
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
    masterServiceId: integer('master_service_id')
      .notNull()
      .references(() => masterServices.id),
    isActive: boolean('is_active').notNull().default(true),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('master_service_sources_active_unique')
      .on(table.facilityId, table.sourceType, table.sourceId)
      .where(sql`${table.isActive}`),
    index('master_service_sources_scope_idx').on(table.tenantId, table.facilityId),
  ],
);

/** Explicitly approved source-code aliases. Free text is never an alias input. */
export const masterServiceAliases = pgTable('master_service_aliases', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  facilityId: integer('facility_id')
    .notNull()
    .references(() => facilities.id),
  sourceType: text('source_type').notNull(),
  alias: text('alias').notNull(),
  masterServiceId: integer('master_service_id')
    .notNull()
    .references(() => masterServices.id),
  approvalReference: text('approval_reference').notNull(),
  approvedByUserId: integer('approved_by_user_id')
    .notNull()
    .references(() => users.id),
  approvedAt: timestamp('approved_at').notNull().defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
});
