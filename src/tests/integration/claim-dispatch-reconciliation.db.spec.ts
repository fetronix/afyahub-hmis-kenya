/**
 * Dispatch reconciliation — the only sanctioned way out of an UNCERTAIN claim
 * dispatch.
 *
 * Before this feature a single lost HTTP response permanently blocked a claim:
 * the guard row stayed behind and every submit, resubmit, status refresh,
 * adjudication and remittance action threw CLAIM_DISPATCH_REVIEW_REQUIRED. No
 * route could read or resolve the guard.
 *
 * These tests use synthetic rows and the real Express stack (session, module,
 * RBAC, scope) plus the real PostgreSQL constraints. The guard fixtures stand in
 * for a lost provider response; no payer is contacted at any point.
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { db } from '../../db/index.ts';
import { lockMutableClaim } from '../../insurance/claims/claim-dispatch-guard.ts';
import { describeDb, testPool } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Claim dispatch reconciliation (synthetic PostgreSQL)', () => {
  const pool = testPool();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);

  let tenant: number;
  let facilityA: number;
  let facilityB: number;
  let reviewer: number;
  let deniedUser: number;
  let patient: number;
  let invoice: number;
  let shaClaimReady: number;
  let shaClaimNotReceived: number;
  let shaClaimOtherFacility: number;
  let shaClaimAlreadyAcked: number;
  let privateClaimReady: number;

  let reviewerToken: string;
  let deniedToken: string;
  let base: string;
  let close: () => Promise<void>;

  const shaPost = (claimId: number, body: Record<string, unknown>, token = reviewerToken) =>
    httpJson(base, 'POST', `/api/insurance/sha/claims/${claimId}/dispatch-review`, { token, body });
  const shaQueue = (token = reviewerToken) =>
    httpJson(base, 'GET', '/api/insurance/sha/claims/dispatch-reviews', { token });
  const shaHistory = (claimId: number, token = reviewerToken) =>
    httpJson(base, 'GET', `/api/insurance/sha/claims/${claimId}/dispatch-reviews`, { token });
  const privatePost = (claimId: number, body: Record<string, unknown>, token = reviewerToken) =>
    httpJson(base, 'POST', `/api/insurance/claims/${claimId}/dispatch-review`, { token, body });
  const privateQueue = (token = reviewerToken) =>
    httpJson(base, 'GET', '/api/insurance/claims/dispatch-reviews', { token });

  const guardFail = (code: string, message: string, status: number) =>
    Object.assign(new Error(message), { code, status });

  const lockClaim = (claimId: number, revision: number) =>
    db.transaction((tx) =>
      lockMutableClaim(
        tx,
        {
          workflow: 'SHA',
          tenantId: tenant,
          facilityId: facilityA,
          claimId,
          revision,
          status: 'READY_FOR_SUBMISSION',
        },
        guardFail,
      ),
    );

  const guardRow = async (workflow: 'SHA' | 'PRIVATE', claimId: number) =>
    (
      await pool.query(
        `SELECT id, state, attempt_number, correlation_id FROM insurance_claim_dispatch_guards
         WHERE workflow=$1 AND claim_id=$2`,
        [workflow, claimId],
      )
    ).rows;

  beforeAll(async () => {
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic dispatch reconciliation tenant',
        `dispatch-recon-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,enabled_modules)
       VALUES($1,$2,'Synthetic dispatch A','Level 4',$4,'["registration","insurance"]'::jsonb),
             ($1,$3,'Synthetic dispatch B','Level 4',$5,'["registration","insurance"]'::jsonb)
       RETURNING id`,
      [tenant, `DR-A-${suffix}`, `DR-B-${suffix}`, `MFL-DRA-${suffix}`, `MFL-DRB-${suffix}`],
    );
    facilityA = facilities.rows[0].id;
    facilityB = facilities.rows[1].id;

    const makeUser = async (label: string, facilityId: number) =>
      (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic reviewer','test-only','ACTIVE',$3,$4) RETURNING id`,
          [
            `dispatch-recon-${label}-${suffix}`,
            `dispatch-recon-${label}-${suffix}@example.test`,
            tenant,
            facilityId,
          ],
        )
      ).rows[0].id as number;

    reviewer = await makeUser('reviewer', facilityA);
    deniedUser = await makeUser('denied', facilityA);

    const makeRole = async (name: string, permissions: string[]) => {
      const roleId = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `${name}-${suffix}`],
        )
      ).rows[0].id;
      for (const permission of permissions) {
        await pool.query(
          "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
          [permission],
        );
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
          [roleId, permission],
        );
      }
      return roleId;
    };

    const reviewerRole = await makeRole('DISPATCH-REVIEWER', [
      'patients.read',
      'insurance.sha.claims.read',
      'insurance.sha.reconciliation.manage',
      'insurance.private.claims.submit',
      'insurance.private.claims.prepare',
    ]);
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      reviewer,
      reviewerRole,
    ]);
    const deniedRole = await makeRole('DISPATCH-DENIED', ['insurance.sha.claims.read']);
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      deniedUser,
      deniedRole,
    ]);

    reviewerToken = (await createSession({ userId: reviewer, securityVersion: 1 })).sessionToken;
    deniedToken = (await createSession({ userId: deniedUser, securityVersion: 1 })).sessionToken;

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Dispatch','1990-01-01','Other') RETURNING id`,
        [tenant, facilityA, `DR-PAT-${suffix}`],
      )
    ).rows[0].id;

    invoice = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status)
         VALUES($1,$2,$3,$4,'1000.00','0.00','1000.00','Pending') RETURNING id`,
        [tenant, facilityA, patient, `DR-INV-${suffix}`],
      )
    ).rows[0].id;

    const makeShaClaim = async (
      facilityId: number,
      status: string,
      submissionCount: number,
      dispatchRevision = 0,
    ) =>
      (
        await pool.query(
          `INSERT INTO sha_eclaims(
             tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,
             billable_start,billable_end,total_billed_amount,total_claimed_amount,
             status,submission_count,dispatch_revision
           ) VALUES($1,$2,$3,$4,$5,$6,'2026-10-01','2026-10-01','1000.00','1000.00',$7,$8,$9)
           RETURNING id`,
          [
            tenant,
            facilityId,
            patient,
            invoice,
            `DR-SHA-${randomUUID()}`,
            randomUUID(),
            status,
            submissionCount,
            dispatchRevision,
          ],
        )
      ).rows[0].id as number;

    shaClaimReady = await makeShaClaim(facilityA, 'READY_FOR_SUBMISSION', 1);
    shaClaimNotReceived = await makeShaClaim(facilityA, 'READY_FOR_SUBMISSION', 1);
    shaClaimOtherFacility = await makeShaClaim(facilityB, 'READY_FOR_SUBMISSION', 1);
    shaClaimAlreadyAcked = await makeShaClaim(facilityA, 'ACKNOWLEDGED', 2);

    const memberPolicy = (
      await pool.query(
        `INSERT INTO insurance_member_policies(tenant_id,facility_id,patient_id,payer_code,member_number)
         VALUES($1,$2,$3,'BRITAM',$4) RETURNING id`,
        [tenant, facilityA, patient, `DR-MEM-${suffix}`],
      )
    ).rows[0].id;

    privateClaimReady = (
      await pool.query(
        `INSERT INTO private_insurance_claims(
           tenant_id,facility_id,patient_id,member_policy_id,invoice_id,payer_code,
           claim_number,idempotency_key,service_date_start,service_date_end,
           gross_invoice_amount,proposed_claim_amount,status,submission_count,dispatch_revision
         ) VALUES($1,$2,$3,$4,$5,'BRITAM',$6,$7,'2026-10-01','2026-10-01','1000.00','1000.00','READY',1,0)
         RETURNING id`,
        [
          tenant,
          facilityA,
          patient,
          memberPolicy,
          invoice,
          `DR-PRIV-${randomUUID()}`,
          randomUUID(),
        ],
      )
    ).rows[0].id;

    // Synthetic stand-ins for a dispatch whose response was lost.
    for (const [workflow, claimId, attempt, state] of [
      ['SHA', shaClaimReady, 1, 'UNCERTAIN'],
      ['SHA', shaClaimNotReceived, 1, 'UNCERTAIN'],
      ['SHA', shaClaimOtherFacility, 1, 'UNCERTAIN'],
      ['SHA', shaClaimAlreadyAcked, 2, 'UNCERTAIN'],
      ['PRIVATE', privateClaimReady, 1, 'UNCERTAIN'],
    ] as const)
      await pool.query(
        `INSERT INTO insurance_claim_dispatch_guards(
           tenant_id,facility_id,workflow,claim_id,claim_revision,attempt_number,correlation_id,state,actor_user_id
         ) VALUES($1,$2,$3,$4,0,$5,$6,$7,$8)`,
        [
          tenant,
          workflow === 'SHA' && claimId === shaClaimOtherFacility ? facilityB : facilityA,
          workflow,
          claimId,
          attempt,
          randomUUID(),
          state,
          reviewer,
        ],
      );
  });

  afterAll(async () => {
    await close?.();
  });

  it('lists blocked dispatches for this facility only', async () => {
    const res = await shaQueue();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.limitations.source).toBe('LOCAL_RESERVATION_ONLY');
    const claimNumbers = res.body.reviews.map((r: { claimId: number }) => r.claimId);
    expect(claimNumbers).toContain(shaClaimReady);
    expect(claimNumbers).toContain(shaClaimAlreadyAcked);
    // Another facility's blocked claim is not visible.
    expect(claimNumbers).not.toContain(shaClaimOtherFacility);
    const listed = res.body.reviews.find((r: { claimId: number }) => r.claimId === shaClaimReady);
    expect(listed).toMatchObject({ state: 'UNCERTAIN', attemptNumber: 1, workflow: 'SHA' });
    expect(listed.correlationId).toBeTruthy();

    const privateRes = await privateQueue();
    expect(privateRes.status).toBe(200);
    expect(privateRes.body.reviews.map((r: { claimId: number }) => r.claimId)).toEqual([
      privateClaimReady,
    ]);
  });

  it('refuses a review with no evidence note', async () => {
    const res = await shaPost(shaClaimReady, {
      outcome: 'PAYER_CONFIRMED_NOT_RECEIVED',
      evidenceNote: 'too short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('RECONCILIATION_EVIDENCE_REQUIRED');
    expect(await guardRow('SHA', shaClaimReady)).toHaveLength(1);
  });

  it('refuses to confirm receipt without the payer-side reference', async () => {
    const res = await shaPost(shaClaimReady, {
      outcome: 'PAYER_CONFIRMED_RECEIVED',
      evidenceNote: 'Checked the SHA portal and the claim is listed under the facility batch.',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYER_REFERENCE_REQUIRED');
    expect((await guardRow('SHA', shaClaimReady))[0].state).toBe('UNCERTAIN');
  });

  it('keeps the claim blocked when the review is still unresolved', async () => {
    const res = await shaPost(shaClaimReady, {
      outcome: 'STILL_UNRESOLVED',
      evidenceNote: 'Payer portal is unreachable; batch report not yet published.',
    });
    expect(res.status).toBe(200);
    expect(res.body.guardReleased).toBe(false);
    expect(res.body.claimStatus).toBe('READY_FOR_SUBMISSION');
    const guards = await guardRow('SHA', shaClaimReady);
    expect(guards).toHaveLength(1);
    expect(guards[0].state).toBe('UNCERTAIN');

    const history = await shaHistory(shaClaimReady);
    expect(history.status).toBe(200);
    expect(history.body.reconciliations).toHaveLength(1);
    expect(history.body.reconciliations[0]).toMatchObject({
      outcome: 'STILL_UNRESOLVED',
      guardStateAtCheck: 'UNCERTAIN',
    });

    // The claim is still blocked at the single gate every mutation passes
    // through, so no service can reach a transport.
    await expect(lockClaim(shaClaimReady, 0)).rejects.toMatchObject({
      code: 'CLAIM_DISPATCH_REVIEW_REQUIRED',
    });
  });

  it('refuses a stale guard reference', async () => {
    const res = await shaPost(shaClaimReady, {
      outcome: 'STILL_UNRESOLVED',
      guardId: 999_999,
      evidenceNote: 'Attempted review from a stale screen reference.',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CLAIM_CHANGED');
  });

  it('releases the guard when the payer confirms it holds the claim', async () => {
    const payerReference = `SHA-BATCH-${randomUUID()}`;
    const res = await shaPost(shaClaimReady, {
      outcome: 'PAYER_CONFIRMED_RECEIVED',
      payerReference,
      evidenceNote: 'Payer portal shows the claim in the received batch; reference recorded above.',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      guardReleased: true,
      claimStatus: 'ACKNOWLEDGED',
      payerReference,
    });

    // Guard gone, claim marked acknowledged with the payer's own reference.
    expect(await guardRow('SHA', shaClaimReady)).toHaveLength(0);
    const claim = (
      await pool.query(
        'SELECT status, payer_claim_reference, dispatch_revision, submission_count FROM sha_eclaims WHERE id=$1',
        [shaClaimReady],
      )
    ).rows[0];
    expect(claim.status).toBe('ACKNOWLEDGED');
    expect(claim.payer_claim_reference).toBe(payerReference);
    expect(claim.dispatch_revision).toBe(1);

    // The evidence survives the deleted guard.
    const history = await shaHistory(shaClaimReady);
    expect(history.body.reconciliations.map((r: { outcome: string }) => r.outcome)).toEqual([
      'PAYER_CONFIRMED_RECEIVED',
      'STILL_UNRESOLVED',
    ]);

    const audit = await pool.query(
      `SELECT action FROM audit_logs
       WHERE resource='insurance_claim_dispatch' AND resource_id=$1
       ORDER BY id`,
      [String(shaClaimReady)],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain('CLAIM_DISPATCH_RECONCILED');
    expect(actions).toContain('CLAIM_DISPATCH_RELEASED');

    // A second review of the same claim cannot invent a new guard.
    const again = await shaPost(shaClaimReady, {
      outcome: 'PAYER_CONFIRMED_RECEIVED',
      payerReference,
      evidenceNote: 'Duplicate review submitted from a second screen.',
    });
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('DISPATCH_REVIEW_NOT_FOUND');
    expect(await guardRow('SHA', shaClaimReady)).toHaveLength(0);
  });

  it('releases a pre-dispatch claim after confirmed non-receipt without changing its status', async () => {
    const res = await shaPost(shaClaimNotReceived, {
      outcome: 'PAYER_CONFIRMED_NOT_RECEIVED',
      evidenceNote: 'Payer batch report for the day contains no entry for this claim number.',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      guardReleased: true,
      claimStatus: 'READY_FOR_SUBMISSION',
    });
    expect(await guardRow('SHA', shaClaimNotReceived)).toHaveLength(0);

    const claim = (
      await pool.query(
        'SELECT status, dispatch_revision, submission_count FROM sha_eclaims WHERE id=$1',
        [shaClaimNotReceived],
      )
    ).rows[0];
    expect(claim.status).toBe('READY_FOR_SUBMISSION');
    // The revision moves so a stale screen cannot act on the pre-review snapshot,
    // but the claim itself is still ready to be dispatched again by a human.
    expect(claim.dispatch_revision).toBe(1);
    expect(claim.submission_count).toBe(1);

    // The same gate now passes: the claim can be dispatched again by a human.
    await expect(lockClaim(shaClaimNotReceived, 1)).resolves.toBeUndefined();
  });

  it('never reverts a claim the local record already shows as submitted', async () => {
    const res = await shaPost(shaClaimAlreadyAcked, {
      outcome: 'PAYER_CONFIRMED_NOT_RECEIVED',
      evidenceNote: 'Payer says they never received this batch, but local record shows submission.',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DISPATCH_STATE_CONFLICT');
    expect((await guardRow('SHA', shaClaimAlreadyAcked))[0].state).toBe('UNCERTAIN');
  });

  it('denies a reviewer without the reconciliation permission', async () => {
    const res = await shaPost(
      shaClaimOtherFacility,
      {
        outcome: 'STILL_UNRESOLVED',
        evidenceNote: 'Unauthorised attempt that must not be recorded.',
      },
      deniedToken,
    );
    expect(res.status).toBe(403);
    const queue = await shaQueue(deniedToken);
    expect(queue.status).toBe(403);
  });

  it('scopes a review to the actor facility', async () => {
    const res = await shaPost(shaClaimOtherFacility, {
      outcome: 'STILL_UNRESOLVED',
      evidenceNote: 'Reviewer at facility A targeting a facility B claim.',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLAIM_NOT_FOUND');
    expect(await guardRow('SHA', shaClaimOtherFacility)).toHaveLength(1);
  });

  it('releases a private claim without changing a valid pre-dispatch status', async () => {
    const res = await privatePost(privateClaimReady, {
      outcome: 'PAYER_CONFIRMED_NOT_RECEIVED',
      evidenceNote: 'Britam confirmed by email that no claim was received for this member.',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      guardReleased: true,
      claimStatus: 'READY',
      workflow: 'PRIVATE',
    });
    expect(await guardRow('PRIVATE', privateClaimReady)).toHaveLength(0);
    const claim = (
      await pool.query(
        'SELECT status, dispatch_revision, submission_count FROM private_insurance_claims WHERE id=$1',
        [privateClaimReady],
      )
    ).rows[0];
    expect(claim.status).toBe('READY');
    expect(claim.dispatch_revision).toBe(1);
    expect(claim.submission_count).toBeGreaterThanOrEqual(1);
  });
});
