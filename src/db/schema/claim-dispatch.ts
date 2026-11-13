import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
    facilityState: index('insurance_claim_dispatch_guards_facility_state_idx').on(
      table.tenantId,
      table.facilityId,
      table.workflow,
      table.state,
    ),
  }),
);

/**
 * Append-only record of a human checking the payer's own record after an
 * ambiguous dispatch. This is evidence supplied by a reviewer — it is not a
 * provider response and it does not prove adjudication or payment.
 *
 * A row here is written in the same transaction that releases (or retains) the
 * guard, so deleting the guard never deletes the history of what happened.
 */
export const insuranceClaimDispatchReconciliations = pgTable(
  'insurance_claim_dispatch_reconciliations',
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
    guardId: integer('guard_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    guardStateAtCheck: text('guard_state_at_check').notNull(),
    outcome: text('outcome').notNull(),
    payerReference: text('payer_reference'),
    evidenceNote: text('evidence_note').notNull(),
    reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index('insurance_claim_dispatch_reconciliations_claim_idx').on(
      table.tenantId,
      table.facilityId,
      table.workflow,
      table.claimId,
    ),
  }),
);
