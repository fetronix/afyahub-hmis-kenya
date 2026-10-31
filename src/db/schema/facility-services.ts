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
import { facilities, tenants } from './tenancy.ts';

/** Identities and settings belong to one facility, never a global catalogue. */
export const facilityServices = pgTable(
  'facility_services',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    department: text('department').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    autoBill: boolean('auto_bill').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_services_code_unique').on(table.facilityId, table.code),
    uniqueIndex('facility_services_identity_scope_unique').on(
      table.id,
      table.facilityId,
      table.tenantId,
    ),
    index('facility_services_scope_department_idx').on(
      table.tenantId,
      table.facilityId,
      table.department,
      table.isActive,
    ),
  ],
);
