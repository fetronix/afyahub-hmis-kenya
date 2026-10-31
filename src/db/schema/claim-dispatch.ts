import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';

/** Durable reservation; not an acknowledgement, adjudication or payment. */
export const insuranceClaimDispatchGuards = pgTable(
  'insurance_claim_dispatch_guards',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    workflow: text('workflow').notNull(),
    claimId: integer('claim_id').notNull(),
    claimRevision: integer('claim_revision').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    correlationId: text('correlation_id').notNull().unique(),
    state: text('state').default('IN_FLIGHT').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    claimWorkflow: uniqueIndex('insurance_claim_dispatch_guards_workflow_claim_id_key').on(
      table.workflow,
      table.claimId,
    ),
  }),
);
