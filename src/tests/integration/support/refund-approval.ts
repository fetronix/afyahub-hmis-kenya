/** Helpers for isolated synthetic fixtures only; production permissions are not granted. */
import { randomUUID } from 'node:crypto';
import type { AuthorizationContext } from '../../../auth/authorization.types.ts';
import { loadAuthorizationContext } from '../../../auth/authorization.service.ts';
import { pool } from '../../../db/index.ts';
import { recordManualRefund, type RecordRefundInput } from '../../../billing/refunds.service.ts';
import {
  createRefundRequest,
  decideRefundRequest,
  listRefundRequests,
  type RefundRequestInput,
} from '../../../billing/refund-requests.service.ts';
import {
  assertSyntheticDatabaseIdentity,
  assertSyntheticTarget,
} from '../../vitest/support/synthetic-db-identity.ts';

export async function assertSyntheticRefundTestDb() {
  const target = {
    host: process.env.SQL_HOST ?? '',
    name: process.env.SQL_DB_NAME ?? '',
    containerClusterIdentifier: process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER,
  };
  assertSyntheticTarget(target);
  const identity = await pool.query(
    'SELECT current_database() AS name, inet_server_addr()::text AS address, system_identifier::text AS "clusterIdentifier" FROM pg_control_system()',
  );
  assertSyntheticDatabaseIdentity(target, identity.rows[0]);
}
export async function createSyntheticRefundReviewer(
  requester: AuthorizationContext,
): Promise<AuthorizationContext> {
  await assertSyntheticRefundTestDb();
  if (!requester.tenantId || !requester.facilityId) throw new Error('Scoped requester required');
  const uid = `synthetic-refund-reviewer-${randomUUID()}`;
  const result = await pool.query(
    `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
     VALUES($1,$1,$2,'Synthetic independent reviewer','test-only','ACTIVE',$3,$4) RETURNING id`,
    [uid, `${uid}@example.test`, requester.tenantId, requester.facilityId],
  );
  return {
    userId: result.rows[0].id,
    tenantId: requester.tenantId,
    facilityId: requester.facilityId,
    roles: [],
    permissions: ['billing.read', 'billing.refunds.approve'],
    isSuperAdmin: false,
  };
}
export async function approveSyntheticRefund(
  requester: AuthorizationContext,
  reviewer: AuthorizationContext,
  input: RefundRequestInput,
) {
  await assertSyntheticRefundTestDb();
  const created = await createRefundRequest(requester, input);
  const page = await listRefundRequests(reviewer, {
    facilityId: input.facilityId,
    invoiceId: input.invoiceId,
    afterId: created.request.id - 1 || undefined,
    limit: 1,
  });
  const q = page.requests.find((item) => item.id === created.request.id);
  if (!q || !q.reviewHash || q.issue)
    throw new Error('Synthetic refund review evidence is not eligible');
  await decideRefundRequest(reviewer, q.id, {
    facilityId: input.facilityId,
    decision: 'APPROVE',
    reviewHash: q.reviewHash,
    notes: 'Independent synthetic fixture review',
  });
  return q;
}

export async function approvedSyntheticManualRefund(
  requester: AuthorizationContext,
  input: RecordRefundInput,
) {
  const reviewer = await createSyntheticRefundReviewer(requester);
  await approveSyntheticRefund(requester, reviewer, input);
  return recordManualRefund(requester, input);
}

/**
 * Report fixtures use the real request, independent role-backed review and
 * manual recording services. The persisted refund date is returned so tests
 * filter the actual immutable evidence rather than inventing an old approval.
 */
export async function insertSyntheticReportRefund(input: {
  tenant: number;
  facility: number;
  invoice: number;
  payment: number;
  actor: number;
  amount: string;
  reason: string;
  key: string;
}) {
  await assertSyntheticRefundTestDb();
  const requester = await loadAuthorizationContext(input.actor);
  if (
    !requester ||
    requester.tenantId !== input.tenant ||
    requester.facilityId !== input.facility ||
    !requester.permissions.includes('billing.read') ||
    !requester.permissions.includes('billing.refunds.record')
  ) {
    throw new Error('A scoped, authorized synthetic requester is required');
  }
  const uid = `synthetic-report-reviewer-${randomUUID()}`;
  const reviewerId = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
     VALUES($1,$1,$2,'Synthetic report reviewer','test-only','ACTIVE',$3,$4) RETURNING id`,
      [uid, `${uid}@example.test`, input.tenant, input.facility],
    )
  ).rows[0].id as number;
  const roleId = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [input.tenant, `SYNTHETIC_REPORT_REVIEW_${randomUUID()}`],
    )
  ).rows[0].id as number;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [reviewerId, roleId]);
  for (const code of ['billing.read', 'billing.refunds.approve']) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'billing') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [roleId, code],
    );
  }
  const reviewer = await loadAuthorizationContext(reviewerId);
  if (
    !reviewer ||
    reviewer.userId === requester.userId ||
    !reviewer.permissions.includes('billing.refunds.approve')
  )
    throw new Error('An independent, authorized synthetic reviewer is required');
  const request = {
    facilityId: input.facility,
    invoiceId: input.invoice,
    paymentId: input.payment,
    amount: input.amount,
    refundMethod: 'CASH',
    reason: input.reason,
    idempotencyKey: input.key,
  };
  await approveSyntheticRefund(requester, reviewer, request);
  const recorded = await recordManualRefund(requester, { ...request, manualConfirmation: true });
  const date = (
    await pool.query(
      "SELECT to_char(created_at,'YYYY-MM-DD') AS date FROM billing_refunds WHERE id=$1 AND tenant_id=$2 AND facility_id=$3",
      [recorded.refund.id, input.tenant, input.facility],
    )
  ).rows[0]?.date as string | undefined;
  if (!date) throw new Error('Synthetic refund date was not recorded');
  return { id: recorded.refund.id, number: recorded.refund.refundNumber, date };
}
