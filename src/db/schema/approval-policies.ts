/**
 * JaliCare HMIS — delegated approval authority (migration 0078).
 *
 * A policy is a threshold, not a range: it applies to amounts at or above
 * `min_amount_cents`. Evaluation picks the highest matching threshold, so a
 * facility cannot accidentally approve a large purchase under a small-value
 * rule. With no policies, the existing permission gate is unchanged.
 */

import { bigint, boolean, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { facilities, tenants } from './tenancy.ts';

export const approvalPolicies = pgTable(
  'approval_policies',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    policyScope: text('policy_scope').notNull(),
    policyName: text('policy_name').notNull(),
    minAmountCents: bigint('min_amount_cents', { mode: 'number' }).notNull(),
    requiredPermission: text('required_permission').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdByName: text('created_by_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    scopeMinIdx: uniqueIndex('approval_policies_facility_scope_min_idx').on(
      table.facilityId,
      table.policyScope,
      table.minAmountCents,
    ),
    scopeIdx: index('approval_policies_facility_scope_idx').on(
      table.facilityId,
      table.policyScope,
      table.isActive,
    ),
  }),
);
