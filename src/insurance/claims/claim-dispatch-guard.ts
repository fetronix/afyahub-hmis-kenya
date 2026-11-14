import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Workflow = 'SHA' | 'PRIVATE';
type ErrorFactory = (code: string, message: string, status: number) => Error;
export interface ClaimGuardScope {
  workflow: Workflow;
  tenantId: number;
  facilityId: number;
  claimId: number;
  revision: number;
  status: string;
}
interface ClaimGuardActor {
  actorUserId: number;
  actorUserUid: string;
}

/** Lock the claim row before checking its exact revision and dispatch reservation. */
export async function lockMutableClaim(
  tx: Transaction,
  scope: ClaimGuardScope,
  fail: ErrorFactory,
) {
  const [row] =
    scope.workflow === 'SHA'
      ? await tx
          .select({
            status: schema.shaEclaims.status,
            revision: schema.shaEclaims.dispatchRevision,
          })
          .from(schema.shaEclaims)
          .where(
            and(
              eq(schema.shaEclaims.id, scope.claimId),
              eq(schema.shaEclaims.tenantId, scope.tenantId),
              eq(schema.shaEclaims.facilityId, scope.facilityId),
            ),
          )
          .for('update')
      : await tx
          .select({
            status: schema.privateInsuranceClaims.status,
            revision: schema.privateInsuranceClaims.dispatchRevision,
          })
          .from(schema.privateInsuranceClaims)
          .where(
            and(
              eq(schema.privateInsuranceClaims.id, scope.claimId),
              eq(schema.privateInsuranceClaims.tenantId, scope.tenantId),
              eq(schema.privateInsuranceClaims.facilityId, scope.facilityId),
            ),
          )
          .for('update');
  if (!row) throw fail('CLAIM_NOT_FOUND', 'Claim was not found in this facility.', 404);
  const [guard] = await tx
    .select({ id: schema.insuranceClaimDispatchGuards.id })
    .from(schema.insuranceClaimDispatchGuards)
    .where(
      and(
        eq(schema.insuranceClaimDispatchGuards.workflow, scope.workflow),
        eq(schema.insuranceClaimDispatchGuards.claimId, scope.claimId),
      ),
    )
    .limit(1);
  if (guard)
    throw fail(
      'CLAIM_DISPATCH_REVIEW_REQUIRED',
      'A claim dispatch is in progress or its outcome is uncertain. Review the payer record before any further dispatch or change.',
      409,
    );
  if (row.status !== scope.status || row.revision !== scope.revision)
    throw fail(
      'CLAIM_CHANGED',
      'The claim changed during this operation. Reload and review it.',
      409,
    );
}

/** Commit a reservation BEFORE any external call. A crash must not permit a blind retry. */
export async function reserveClaimDispatch(
  scope: ClaimGuardScope & ClaimGuardActor & { attemptNumber: number; correlationId: string },
  fail: ErrorFactory,
) {
  return db.transaction(async (tx) => {
    await lockMutableClaim(tx, scope, fail);
    const [guard] = await tx
      .insert(schema.insuranceClaimDispatchGuards)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        workflow: scope.workflow,
        claimId: scope.claimId,
        claimRevision: scope.revision,
        attemptNumber: scope.attemptNumber,
        correlationId: scope.correlationId,
        actorUserId: scope.actorUserId,
      })
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: scope.actorUserUid,
      action: 'CLAIM_DISPATCH_RESERVED',
      resource: 'insurance_claim_dispatch',
      resourceId: String(scope.claimId),
      details: JSON.stringify({
        workflow: scope.workflow,
        attemptNumber: scope.attemptNumber,
        correlationId: scope.correlationId,
      }),
    });
    return guard.id;
  });
}

/** Release only inside the transaction recording a known outcome or proven no-send. */
export async function releaseClaimDispatch(
  tx: Transaction,
  guardId: number,
  scope: ClaimGuardScope & ClaimGuardActor,
  reason: 'OUTCOME_RECORDED' | 'NOT_SENT',
) {
  const [deleted] = await tx
    .delete(schema.insuranceClaimDispatchGuards)
    .where(
      and(
        eq(schema.insuranceClaimDispatchGuards.id, guardId),
        eq(schema.insuranceClaimDispatchGuards.tenantId, scope.tenantId),
        eq(schema.insuranceClaimDispatchGuards.facilityId, scope.facilityId),
        eq(schema.insuranceClaimDispatchGuards.workflow, scope.workflow),
        eq(schema.insuranceClaimDispatchGuards.claimId, scope.claimId),
      ),
    )
    .returning({
      id: schema.insuranceClaimDispatchGuards.id,
      correlationId: schema.insuranceClaimDispatchGuards.correlationId,
    });
  if (!deleted) throw new Error('Claim dispatch reservation is missing; reconciliation required.');
  await tx.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: scope.actorUserUid,
    action: 'CLAIM_DISPATCH_RELEASED',
    resource: 'insurance_claim_dispatch',
    resourceId: String(scope.claimId),
    details: JSON.stringify({
      workflow: scope.workflow,
      correlationId: deleted.correlationId,
      reason,
    }),
  });
}

/** Ambiguous transport failures remain blocked until an authorized reconciliation process exists. */
export async function markClaimDispatchUncertain(
  tx: Transaction,
  guardId: number,
  scope: ClaimGuardScope & ClaimGuardActor,
) {
  const [guard] = await tx
    .update(schema.insuranceClaimDispatchGuards)
    .set({ state: 'UNCERTAIN', updatedAt: new Date() })
    .where(
      and(
        eq(schema.insuranceClaimDispatchGuards.id, guardId),
        eq(schema.insuranceClaimDispatchGuards.workflow, scope.workflow),
        eq(schema.insuranceClaimDispatchGuards.claimId, scope.claimId),
        eq(schema.insuranceClaimDispatchGuards.facilityId, scope.facilityId),
        eq(schema.insuranceClaimDispatchGuards.tenantId, scope.tenantId),
      ),
    )
    .returning({ correlationId: schema.insuranceClaimDispatchGuards.correlationId });
  if (!guard) throw new Error('Claim dispatch reservation is missing; reconciliation required.');
  await tx.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: scope.actorUserUid,
    action: 'CLAIM_DISPATCH_UNCERTAIN',
    resource: 'insurance_claim_dispatch',
    resourceId: String(scope.claimId),
    details: JSON.stringify({ workflow: scope.workflow, correlationId: guard.correlationId }),
  });
}
