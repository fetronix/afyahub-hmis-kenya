/**
 * JaliCare HMIS — facility operations status.
 *
 * WHY THIS EXISTS
 * Batch 9 found that a claim whose dispatch outcome was unknown had no way out.
 * Batch 11 asks a different question: when something *is* stuck, how would an
 * operator find out? Before this file the answer was "read a module screen one
 * claim at a time, or open psql". `/api/health` says the process is alive and
 * `/api/ready` says the database answers; neither says that eleven unbilled
 * charges have been waiting three days.
 *
 * WHAT THIS REPORTS
 * Counts and ages of work that is genuinely waiting on a human:
 *   - claim dispatch reservations (the Batch 9 stranded-claim queue),
 *   - charges the billing engine could not price,
 *   - refund requests awaiting a decision,
 *   - integration diagnostics recorded in the last 24 hours, grouped, with an
 *     explicit failure flag,
 *   - whether the database has every migration the packaged journal contains.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - It returns no patient name, identifier, amount or free-text summary. These
 *     are operational counters, not a clinical or financial report. A monitoring
 *     endpoint that leaks one patient's name into a log aggregator is a breach
 *     with a dashboard.
 *   - It does not invent thresholds. Nothing is marked "critical" or "degraded"
 *     by a number this file made up; it reports what it measured and how old it
 *     is.
 *   - It does not claim anything about Docker, alerting or backup scheduling.
 *     Those are deployment facts that live outside this process, and this
 *     endpoint says so in its own payload.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { readJournal } from '../../scripts/migration-journal.ts';

/** Size of the packaged journal, or null when it cannot be read. */
function expectedMigrations(): number | null {
  try {
    return readJournal().length;
  } catch {
    return null;
  }
}

/**
 * Outcomes that are never a success, in the words the adapters actually use.
 * Anything outside this list is reported as an unclassified outcome rather than
 * being counted either way — guessing would make the flag meaningless.
 */
export const DIAGNOSTIC_FAILURE_OUTCOMES = [
  'FAILED_TRANSPORT',
  'AWAITING_DOCUMENTATION',
  'UNAVAILABLE',
  'NOT_CONFIGURED',
  'PAYER_TRANSMISSION_NOT_VERIFIED',
  'REJECTED',
] as const;

export interface WorkQueueSummary {
  count: number;
  oldestAgeMinutes: number | null;
  /** How to clear it, in one sentence. Never a suggestion to retry blindly. */
  nextAction: string;
}

export interface OperationsStatus {
  facilityId: number;
  generatedAt: string;
  workQueues: {
    claimDispatchReviews: WorkQueueSummary & { byState: Record<string, number> };
    unbilledCharges: WorkQueueSummary;
    refundRequestsAwaitingDecision: WorkQueueSummary;
  };
  integration: {
    windowHours: number;
    observed: number;
    flaggedFailures: number;
    failureOutcomes: readonly string[];
    byOperation: Array<{ operation: string; outcome: string; count: number; lastAt: string }>;
    note: string;
  };
  schema: {
    expectedMigrations: number | null;
    appliedMigrations: number | null;
    upToDate: boolean | null;
    note: string;
  };
  limitations: string[];
}

/** Age of the oldest dispatch reservation, in whole minutes. */
const dispatchOldestSql = sql<
  number | null
>`round(extract(epoch from (now() - min(${schema.insuranceClaimDispatchGuards.createdAt}))) / 60)`;

export async function facilityOperationsStatus(params: {
  tenantId: number;
  facilityId: number;
  now?: Date;
}): Promise<OperationsStatus> {
  const { tenantId, facilityId } = params;
  const now = params.now ?? new Date();

  const [dispatchRows, chargeRows, refundRows, diagnosticRows, appliedMigrations] =
    await Promise.all([
      db
        .select({
          state: schema.insuranceClaimDispatchGuards.state,
          count: sql<number>`count(*)::int`,
          oldestAgeMinutes: dispatchOldestSql,
        })
        .from(schema.insuranceClaimDispatchGuards)
        .where(
          and(
            eq(schema.insuranceClaimDispatchGuards.tenantId, tenantId),
            eq(schema.insuranceClaimDispatchGuards.facilityId, facilityId),
          ),
        )
        .groupBy(schema.insuranceClaimDispatchGuards.state),

      db
        .select({
          count: sql<number>`count(*)::int`,
          oldestAgeMinutes: sql<
            number | null
          >`round(extract(epoch from (now() - min(${schema.billingChargeAttempts.createdAt}))) / 60)`,
        })
        .from(schema.billingChargeAttempts)
        .where(
          and(
            eq(schema.billingChargeAttempts.tenantId, tenantId),
            eq(schema.billingChargeAttempts.facilityId, facilityId),
            eq(schema.billingChargeAttempts.status, 'PENDING'),
          ),
        ),

      db
        .select({
          count: sql<number>`count(*)::int`,
          oldestAgeMinutes: sql<
            number | null
          >`round(extract(epoch from (now() - min(${schema.billingRefundRequests.createdAt}))) / 60)`,
        })
        .from(schema.billingRefundRequests)
        .where(
          and(
            eq(schema.billingRefundRequests.tenantId, tenantId),
            eq(schema.billingRefundRequests.facilityId, facilityId),
            eq(schema.billingRefundRequests.status, 'REQUESTED'),
          ),
        ),

      db
        .select({
          operation: schema.insuranceIntegrationDiagnostics.operation,
          outcome: schema.insuranceIntegrationDiagnostics.outcome,
          count: sql<number>`count(*)::int`,
          lastAt: sql<string>`max(${schema.insuranceIntegrationDiagnostics.createdAt})::text`,
        })
        .from(schema.insuranceIntegrationDiagnostics)
        .where(
          and(
            eq(schema.insuranceIntegrationDiagnostics.tenantId, tenantId),
            eq(schema.insuranceIntegrationDiagnostics.facilityId, facilityId),
            sql`${schema.insuranceIntegrationDiagnostics.createdAt} > now() - interval '24 hours'`,
          ),
        )
        .groupBy(
          schema.insuranceIntegrationDiagnostics.operation,
          schema.insuranceIntegrationDiagnostics.outcome,
        ),

      db
        .execute<{ count: string }>(
          sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
        )
        .then((result) => Number(result.rows[0]?.count ?? 0))
        .catch(() => null),
    ]);

  const expected = expectedMigrations();

  const byState: Record<string, number> = {};
  let dispatchCount = 0;
  let dispatchOldest: number | null = null;
  for (const row of dispatchRows) {
    byState[row.state] = Number(row.count);
    dispatchCount += Number(row.count);
    const age = row.oldestAgeMinutes === null ? null : Number(row.oldestAgeMinutes);
    if (age !== null && (dispatchOldest === null || age > dispatchOldest)) dispatchOldest = age;
  }

  const inFailureSet = new Set<string>(DIAGNOSTIC_FAILURE_OUTCOMES);
  const observed = diagnosticRows.reduce((total, row) => total + Number(row.count), 0);
  const flaggedFailures = diagnosticRows
    .filter((row) => inFailureSet.has(row.outcome))
    .reduce((total, row) => total + Number(row.count), 0);

  return {
    facilityId,
    generatedAt: now.toISOString(),
    workQueues: {
      claimDispatchReviews: {
        count: dispatchCount,
        oldestAgeMinutes: dispatchOldest,
        byState,
        nextAction:
          'Review each claim in the dispatch review queue and record what the payer record shows. Never re-dispatch blindly.',
      },
      unbilledCharges: {
        count: Number(chargeRows[0]?.count ?? 0),
        oldestAgeMinutes:
          chargeRows[0]?.oldestAgeMinutes === null || chargeRows[0]?.oldestAgeMinutes === undefined
            ? null
            : Number(chargeRows[0].oldestAgeMinutes),
        nextAction:
          'Price the missing tariff, then retry the charge from the billing review queue; void with a reason if it must not be billed.',
      },
      refundRequestsAwaitingDecision: {
        count: Number(refundRows[0]?.count ?? 0),
        oldestAgeMinutes:
          refundRows[0]?.oldestAgeMinutes === null || refundRows[0]?.oldestAgeMinutes === undefined
            ? null
            : Number(refundRows[0].oldestAgeMinutes),
        nextAction:
          'A second approver decides the refund request. The requester cannot approve their own.',
      },
    },
    integration: {
      windowHours: 24,
      observed,
      flaggedFailures,
      failureOutcomes: DIAGNOSTIC_FAILURE_OUTCOMES,
      byOperation: diagnosticRows
        .map((row) => ({
          operation: row.operation,
          outcome: row.outcome,
          count: Number(row.count),
          lastAt: row.lastAt,
        }))
        .sort((a, b) => b.count - a.count),
      note: 'Counts what this facility recorded in the last 24 hours. Outcomes outside failureOutcomes are neither counted as success nor as failure.',
    },
    schema: {
      expectedMigrations: expected,
      appliedMigrations,
      upToDate:
        expected === null || appliedMigrations === null ? null : expected === appliedMigrations,
      note: 'Journal count versus applied count only. It does not prove each migration did what it says.',
    },
    limitations: [
      'Aggregate counters only: no patient, staff, amount or free-text field is returned.',
      'Nothing here reads a provider system. Integration counters describe this installation, not a payer.',
      'Alerting, log shipping, container healthchecks and backup scheduling are deployment concerns and are not claimed by this endpoint.',
      'A queue age is not a service level. No threshold is invented here.',
    ],
  };
}
