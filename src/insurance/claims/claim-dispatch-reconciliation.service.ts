/**
 * JaliCare HMIS — Claim dispatch reconciliation.
 *
 * WHY THIS EXISTS
 * A claim dispatch reserves a durable guard row *before* the external call. If
 * the transport then loses the response, the guard is marked UNCERTAIN and every
 * later mutation of that claim is blocked. That is the correct default: neither
 * a blind retry (which could double-bill a payer) nor a silent release (which
 * could lose a real claim) is safe.
 *
 * But until this service existed there was no way out of that state at all. The
 * error told the user to "review the payer record" while no route, permission or
 * service could read the guard, let alone resolve it. One lost HTTP response
 * bricked the claim permanently.
 *
 * WHAT THIS DOES — AND DELIBERATELY DOES NOT DO
 * - It lists the claims currently held by a dispatch guard, scoped to one
 *   tenant and facility.
 * - It records a human reviewer's finding about what the payer's own record
 *   shows. The finding is evidence, not a provider response; the wording of
 *   every value is chosen so it cannot be mistaken for payer acceptance.
 * - It releases the guard only in the same transaction that writes the finding
 *   (and it keeps the finding forever, even after the guard is gone).
 * - It never calls a payer, never retries a dispatch, and never treats a
 *   reconciliation as adjudication or payment.
 *
 * A reviewer who can confirm receipt may also confirm *non*-receipt; that is
 * what makes a further attempt safe. A reviewer who cannot resolve the question
 * leaves the block in place and the check is still recorded.
 */

import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { releaseClaimDispatch } from './claim-dispatch-guard.ts';

type Workflow = 'SHA' | 'PRIVATE';

export const DISPATCH_RECONCILIATION_OUTCOMES = [
  'PAYER_CONFIRMED_RECEIVED',
  'PAYER_CONFIRMED_NOT_RECEIVED',
  'STILL_UNRESOLVED',
] as const;

export type DispatchReconciliationOutcome = (typeof DISPATCH_RECONCILIATION_OUTCOMES)[number];

export class DispatchReconciliationError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'DispatchReconciliationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const fail = (code: string, message: string, status = 400, details?: unknown) =>
  new DispatchReconciliationError(code, message, status, details);

/**
 * Statuses a claim can still be dispatched from. Anything else means the payer
 * has already been recorded as holding the claim, so a "not received" finding
 * would contradict local evidence and must not silently revert the claim.
 */
const PRE_DISPATCH_STATUSES: Record<Workflow, string[]> = {
  PRIVATE: ['DRAFT', 'READY', 'REJECTED'],
  SHA: ['DRAFT', 'VALIDATION_FAILED', 'READY_FOR_SUBMISSION', 'REJECTED'],
};

export interface DispatchReviewQueueItem {
  guardId: number;
  workflow: Workflow;
  claimId: number;
  claimNumber: string;
  patientName: string | null;
  payerCode: string | null;
  claimStatus: string;
  amount: string | null;
  state: string;
  attemptNumber: number;
  correlationId: string;
  reservedAt: Date;
  updatedAt: Date;
  ageMinutes: number;
  lastReconciliation: {
    outcome: DispatchReconciliationOutcome;
    evidenceNote: string;
    payerReference: string | null;
    checkedAt: Date;
  } | null;
}

/**
 * List claims currently held by a dispatch guard for this facility.
 *
 * The list is derived only from local reservation rows. It is a work queue, not
 * a statement of what the payer has or has not received.
 */
export async function listBlockedClaimDispatches(params: {
  tenantId: number;
  facilityId: number;
  workflow?: Workflow;
  limit?: number;
}): Promise<{
  reviews: DispatchReviewQueueItem[];
  limitations: { source: 'LOCAL_RESERVATION_ONLY'; notice: string };
}> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
  const where: SQL[] = [
    eq(schema.insuranceClaimDispatchGuards.tenantId, params.tenantId),
    eq(schema.insuranceClaimDispatchGuards.facilityId, params.facilityId),
  ];
  if (params.workflow)
    where.push(eq(schema.insuranceClaimDispatchGuards.workflow, params.workflow));

  const guards = await db
    .select()
    .from(schema.insuranceClaimDispatchGuards)
    .where(and(...where))
    .orderBy(desc(schema.insuranceClaimDispatchGuards.updatedAt))
    .limit(limit);

  if (guards.length === 0)
    return {
      reviews: [],
      limitations: {
        source: 'LOCAL_RESERVATION_ONLY',
        notice:
          'No claim is currently held by a dispatch reservation. This list only reflects local reservations; it is not payer data.',
      },
    };

  const shaIds = guards.filter((g) => g.workflow === 'SHA').map((g) => g.claimId);
  const privateIds = guards.filter((g) => g.workflow === 'PRIVATE').map((g) => g.claimId);

  const [shaClaims, privateClaims, reconciliations] = await Promise.all([
    shaIds.length
      ? db
          .select({
            id: schema.shaEclaims.id,
            claimNumber: schema.shaEclaims.claimNumber,
            status: schema.shaEclaims.status,
            payerCode: schema.shaEclaims.payerCode,
            amount: schema.shaEclaims.totalClaimedAmount,
            patientFirst: schema.patients.firstName,
            patientLast: schema.patients.lastName,
          })
          .from(schema.shaEclaims)
          .leftJoin(schema.patients, eq(schema.patients.id, schema.shaEclaims.patientId))
          .where(
            and(
              inArray(schema.shaEclaims.id, shaIds),
              eq(schema.shaEclaims.tenantId, params.tenantId),
              eq(schema.shaEclaims.facilityId, params.facilityId),
            ),
          )
      : Promise.resolve([]),
    privateIds.length
      ? db
          .select({
            id: schema.privateInsuranceClaims.id,
            claimNumber: schema.privateInsuranceClaims.claimNumber,
            status: schema.privateInsuranceClaims.status,
            payerCode: schema.privateInsuranceClaims.payerCode,
            amount: schema.privateInsuranceClaims.proposedClaimAmount,
            patientFirst: schema.patients.firstName,
            patientLast: schema.patients.lastName,
          })
          .from(schema.privateInsuranceClaims)
          .leftJoin(
            schema.patients,
            eq(schema.patients.id, schema.privateInsuranceClaims.patientId),
          )
          .where(
            and(
              inArray(schema.privateInsuranceClaims.id, privateIds),
              eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
              eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
            ),
          )
      : Promise.resolve([]),
    db
      .select({
        claimId: schema.insuranceClaimDispatchReconciliations.claimId,
        workflow: schema.insuranceClaimDispatchReconciliations.workflow,
        outcome: schema.insuranceClaimDispatchReconciliations.outcome,
        evidenceNote: schema.insuranceClaimDispatchReconciliations.evidenceNote,
        payerReference: schema.insuranceClaimDispatchReconciliations.payerReference,
        createdAt: schema.insuranceClaimDispatchReconciliations.createdAt,
      })
      .from(schema.insuranceClaimDispatchReconciliations)
      .where(
        and(
          eq(schema.insuranceClaimDispatchReconciliations.tenantId, params.tenantId),
          eq(schema.insuranceClaimDispatchReconciliations.facilityId, params.facilityId),
          inArray(
            schema.insuranceClaimDispatchReconciliations.claimId,
            guards.map((g) => g.claimId),
          ),
        ),
      )
      .orderBy(desc(schema.insuranceClaimDispatchReconciliations.createdAt)),
  ]);

  const claimLookup = new Map<
    string,
    {
      claimNumber: string;
      status: string;
      payerCode: string;
      amount: string | null;
      patientName: string | null;
    }
  >();
  for (const row of shaClaims)
    claimLookup.set(`SHA:${row.id}`, {
      claimNumber: row.claimNumber,
      status: row.status,
      payerCode: row.payerCode,
      amount: row.amount ?? null,
      patientName: `${row.patientFirst ?? ''} ${row.patientLast ?? ''}`.trim() || null,
    });
  for (const row of privateClaims)
    claimLookup.set(`PRIVATE:${row.id}`, {
      claimNumber: row.claimNumber,
      status: row.status,
      payerCode: row.payerCode,
      amount: row.amount ?? null,
      patientName: `${row.patientFirst ?? ''} ${row.patientLast ?? ''}`.trim() || null,
    });

  const lastCheck = new Map<string, DispatchReviewQueueItem['lastReconciliation']>();
  for (const row of reconciliations) {
    const key = `${row.workflow}:${row.claimId}`;
    if (lastCheck.has(key)) continue;
    lastCheck.set(key, {
      outcome: row.outcome as DispatchReconciliationOutcome,
      evidenceNote: row.evidenceNote,
      payerReference: row.payerReference,
      checkedAt: row.createdAt,
    });
  }

  const now = Date.now();
  const reviews: DispatchReviewQueueItem[] = [];
  for (const guard of guards) {
    const claim = claimLookup.get(`${guard.workflow}:${guard.claimId}`);
    // A guard whose claim no longer exists in this facility must not be exposed
    // with another facility's data; surface it as an orphan instead.
    reviews.push({
      guardId: guard.id,
      workflow: guard.workflow as Workflow,
      claimId: guard.claimId,
      claimNumber: claim?.claimNumber ?? `UNRESOLVED-${guard.claimId}`,
      patientName: claim?.patientName ?? null,
      payerCode: claim?.payerCode ?? null,
      claimStatus: claim?.status ?? 'UNKNOWN',
      amount: claim?.amount ?? null,
      state: guard.state,
      attemptNumber: guard.attemptNumber,
      correlationId: guard.correlationId,
      reservedAt: guard.createdAt,
      updatedAt: guard.updatedAt,
      ageMinutes: Math.max(0, Math.round((now - guard.updatedAt.getTime()) / 60_000)),
      lastReconciliation: lastCheck.get(`${guard.workflow}:${guard.claimId}`) ?? null,
    });
  }

  return {
    reviews,
    limitations: {
      source: 'LOCAL_RESERVATION_ONLY',
      notice:
        'This queue lists local dispatch reservations only. It does not prove that a payer received, accepted, adjudicated or paid any claim.',
    },
  };
}

export interface RecordReconciliationResult {
  claimId: number;
  workflow: Workflow;
  outcome: DispatchReconciliationOutcome;
  claimStatus: string;
  guardReleased: boolean;
  payerReference: string | null;
  reconciledAt: Date;
}

/**
 * Record what the payer's record shows for an ambiguous dispatch.
 *
 * This is the only sanctioned way to clear a dispatch guard. It requires an
 * authenticated actor, an explicit outcome and a written evidence note, and it
 * writes a permanent reconciliation row plus an audit event.
 */
export async function recordClaimDispatchReconciliation(params: {
  tenantId: number;
  facilityId: number;
  workflow: Workflow;
  claimId: number;
  guardId?: number;
  outcome: DispatchReconciliationOutcome;
  payerReference?: string | null;
  evidenceNote: string;
  actorUserId: number;
  actorUserUid: string;
}): Promise<RecordReconciliationResult> {
  const note = String(params.evidenceNote ?? '').trim();
  if (note.length < 10)
    throw fail(
      'RECONCILIATION_EVIDENCE_REQUIRED',
      'Record at least 10 characters describing what was checked (for example the payer portal, call reference or batch report).',
      400,
    );

  const payerReference = String(params.payerReference ?? '').trim();
  if (params.outcome === 'PAYER_CONFIRMED_RECEIVED' && payerReference.length < 3)
    throw fail(
      'PAYER_REFERENCE_REQUIRED',
      'Confirming that the payer received the claim requires the payer-side reference from their record.',
      400,
    );
  if (!DISPATCH_RECONCILIATION_OUTCOMES.includes(params.outcome))
    throw fail('INVALID_RECONCILIATION_OUTCOME', 'Unsupported reconciliation outcome.', 400);

  return db.transaction(async (tx) => {
    const claimRow =
      params.workflow === 'SHA'
        ? await tx
            .select({
              status: schema.shaEclaims.status,
              revision: schema.shaEclaims.dispatchRevision,
              submissionCount: schema.shaEclaims.submissionCount,
            })
            .from(schema.shaEclaims)
            .where(
              and(
                eq(schema.shaEclaims.id, params.claimId),
                eq(schema.shaEclaims.tenantId, params.tenantId),
                eq(schema.shaEclaims.facilityId, params.facilityId),
              ),
            )
            .for('update')
        : await tx
            .select({
              status: schema.privateInsuranceClaims.status,
              revision: schema.privateInsuranceClaims.dispatchRevision,
              submissionCount: schema.privateInsuranceClaims.submissionCount,
            })
            .from(schema.privateInsuranceClaims)
            .where(
              and(
                eq(schema.privateInsuranceClaims.id, params.claimId),
                eq(schema.privateInsuranceClaims.tenantId, params.tenantId),
                eq(schema.privateInsuranceClaims.facilityId, params.facilityId),
              ),
            )
            .for('update');

    const claim = claimRow[0];
    if (!claim) throw fail('CLAIM_NOT_FOUND', 'Claim was not found in this facility.', 404);

    const [guard] = await tx
      .select()
      .from(schema.insuranceClaimDispatchGuards)
      .where(
        and(
          eq(schema.insuranceClaimDispatchGuards.workflow, params.workflow),
          eq(schema.insuranceClaimDispatchGuards.claimId, params.claimId),
          eq(schema.insuranceClaimDispatchGuards.tenantId, params.tenantId),
          eq(schema.insuranceClaimDispatchGuards.facilityId, params.facilityId),
        ),
      )
      .for('update');

    if (!guard)
      throw fail(
        'DISPATCH_REVIEW_NOT_FOUND',
        'This claim has no dispatch reservation to review. It may already have been reconciled; reload the claim.',
        404,
      );
    if (params.guardId !== undefined && params.guardId !== guard.id)
      throw fail(
        'CLAIM_CHANGED',
        'The dispatch reservation changed while this review was open. Reload and review it again.',
        409,
      );

    const now = new Date();
    const reconciledAt = now;

    await tx.insert(schema.insuranceClaimDispatchReconciliations).values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      workflow: params.workflow,
      claimId: params.claimId,
      guardId: guard.id,
      correlationId: guard.correlationId,
      attemptNumber: guard.attemptNumber,
      guardStateAtCheck: guard.state,
      outcome: params.outcome,
      payerReference:
        params.outcome === 'PAYER_CONFIRMED_RECEIVED' ? payerReference : payerReference || null,
      evidenceNote: note,
      reconciledByUserId: params.actorUserId,
      createdAt: now,
    });

    await tx.insert(schema.auditLogs).values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      userId: params.actorUserUid,
      action: 'CLAIM_DISPATCH_RECONCILED',
      resource: 'insurance_claim_dispatch',
      resourceId: String(params.claimId),
      details: JSON.stringify({
        workflow: params.workflow,
        guardId: guard.id,
        correlationId: guard.correlationId,
        attemptNumber: guard.attemptNumber,
        outcome: params.outcome,
        guardReleased: params.outcome !== 'STILL_UNRESOLVED',
      }),
    });

    let claimStatus = claim.status;
    let guardReleased = false;

    if (params.outcome === 'STILL_UNRESOLVED') {
      // Record the check, keep the block. An unresolved review must not become a
      // back door to a blind retry.
      await tx
        .update(schema.insuranceClaimDispatchGuards)
        .set({ updatedAt: now })
        .where(eq(schema.insuranceClaimDispatchGuards.id, guard.id));
    } else {
      const preDispatch = PRE_DISPATCH_STATUSES[params.workflow].includes(claim.status);

      if (params.outcome === 'PAYER_CONFIRMED_NOT_RECEIVED' && !preDispatch)
        throw fail(
          'DISPATCH_STATE_CONFLICT',
          `Claim is recorded locally as ${claim.status}. A "not received" finding would contradict a completed submission; review the claim instead of recording it.`,
          409,
          { claimStatus: claim.status },
        );

      if (params.outcome === 'PAYER_CONFIRMED_RECEIVED' && preDispatch) {
        claimStatus = 'ACKNOWLEDGED';
        if (params.workflow === 'SHA')
          await tx
            .update(schema.shaEclaims)
            .set({
              status: 'ACKNOWLEDGED',
              payerClaimReference: payerReference,
              acknowledgedAt: now,
              submittedAt: now,
              submissionCount: Math.max(claim.submissionCount, guard.attemptNumber),
              dispatchRevision: claim.revision + 1,
              updatedAt: now,
            })
            .where(eq(schema.shaEclaims.id, params.claimId));
        else
          await tx
            .update(schema.privateInsuranceClaims)
            .set({
              status: 'ACKNOWLEDGED',
              externalClaimReference: payerReference,
              submissionCount: Math.max(claim.submissionCount, guard.attemptNumber),
              acknowledgedAt: now,
              dispatchRevision: claim.revision + 1,
              updatedAt: now,
            })
            .where(eq(schema.privateInsuranceClaims.id, params.claimId));

        if (params.workflow === 'SHA')
          await tx.insert(schema.shaEclaimStatusHistory).values({
            eclaimId: params.claimId,
            fromStatus: claim.status,
            toStatus: 'ACKNOWLEDGED',
            source: 'RECONCILIATION',
            actorUserId: params.actorUserId,
            reason: note,
            metadata: {
              correlationId: guard.correlationId,
              attemptNumber: guard.attemptNumber,
              payerReference,
              evidenceSource: 'HUMAN_PAYER_RECORD_CHECK',
            },
          });
        else
          await tx.insert(schema.privateInsuranceClaimStatusHistory).values({
            claimId: params.claimId,
            fromStatus: claim.status,
            toStatus: 'ACKNOWLEDGED',
            source: 'RECONCILIATION',
            actorUserId: params.actorUserId,
            reason: note,
            metadata: {
              correlationId: guard.correlationId,
              attemptNumber: guard.attemptNumber,
              payerReference,
              evidenceSource: 'HUMAN_PAYER_RECORD_CHECK',
            },
          });
      } else {
        // The claim already progressed (received) or never left the pre-dispatch
        // state (not received). Only the revision guard and attempt counter move,
        // so a later action cannot act on a stale snapshot.
        if (params.workflow === 'SHA')
          await tx
            .update(schema.shaEclaims)
            .set({
              dispatchRevision: claim.revision + 1,
              submissionCount: Math.max(claim.submissionCount, guard.attemptNumber),
              ...(params.outcome === 'PAYER_CONFIRMED_RECEIVED' && payerReference
                ? { payerClaimReference: payerReference }
                : {}),
              updatedAt: now,
            })
            .where(eq(schema.shaEclaims.id, params.claimId));
        else
          await tx
            .update(schema.privateInsuranceClaims)
            .set({
              dispatchRevision: claim.revision + 1,
              submissionCount: Math.max(claim.submissionCount, guard.attemptNumber),
              ...(params.outcome === 'PAYER_CONFIRMED_RECEIVED' && payerReference
                ? { externalClaimReference: payerReference }
                : {}),
              updatedAt: now,
            })
            .where(eq(schema.privateInsuranceClaims.id, params.claimId));
        claimStatus = claim.status;
      }

      await releaseClaimDispatch(
        tx,
        guard.id,
        {
          workflow: params.workflow,
          tenantId: params.tenantId,
          facilityId: params.facilityId,
          claimId: params.claimId,
          revision: claim.revision,
          status: claim.status,
          actorUserId: params.actorUserId,
          actorUserUid: params.actorUserUid,
        },
        params.outcome === 'PAYER_CONFIRMED_RECEIVED' ? 'OUTCOME_RECORDED' : 'NOT_SENT',
      );
      guardReleased = true;
    }

    return {
      claimId: params.claimId,
      workflow: params.workflow,
      outcome: params.outcome,
      claimStatus,
      guardReleased,
      payerReference: params.outcome === 'PAYER_CONFIRMED_RECEIVED' ? payerReference : null,
      reconciledAt,
    };
  });
}

/** History of dispatch reviews recorded for one claim, newest first. */
export async function listClaimDispatchReconciliations(params: {
  tenantId: number;
  facilityId: number;
  workflow: Workflow;
  claimId: number;
  limit?: number;
}) {
  return db
    .select({
      id: schema.insuranceClaimDispatchReconciliations.id,
      outcome: schema.insuranceClaimDispatchReconciliations.outcome,
      payerReference: schema.insuranceClaimDispatchReconciliations.payerReference,
      evidenceNote: schema.insuranceClaimDispatchReconciliations.evidenceNote,
      attemptNumber: schema.insuranceClaimDispatchReconciliations.attemptNumber,
      correlationId: schema.insuranceClaimDispatchReconciliations.correlationId,
      guardStateAtCheck: schema.insuranceClaimDispatchReconciliations.guardStateAtCheck,
      reconciledByUserId: schema.insuranceClaimDispatchReconciliations.reconciledByUserId,
      createdAt: schema.insuranceClaimDispatchReconciliations.createdAt,
    })
    .from(schema.insuranceClaimDispatchReconciliations)
    .where(
      and(
        eq(schema.insuranceClaimDispatchReconciliations.tenantId, params.tenantId),
        eq(schema.insuranceClaimDispatchReconciliations.facilityId, params.facilityId),
        eq(schema.insuranceClaimDispatchReconciliations.workflow, params.workflow),
        eq(schema.insuranceClaimDispatchReconciliations.claimId, params.claimId),
      ),
    )
    .orderBy(desc(schema.insuranceClaimDispatchReconciliations.createdAt))
    .limit(Math.min(Math.max(params.limit ?? 20, 1), 100));
}
