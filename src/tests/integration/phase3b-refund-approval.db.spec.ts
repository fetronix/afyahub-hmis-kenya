/** Synthetic PostgreSQL, authenticated HTTP and manually attested records only; no transfer occurs. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { assertSyntheticRefundTestDb } from './support/refund-approval.ts';

describeDb('Phase 3B independent refund request and approval', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number,
    facility: number,
    sibling: number,
    outsideTenant: number,
    outsideFacility: number,
    patient: number;
  let requester: number, reviewer: number;
  let requesterToken: string,
    reviewerToken: string,
    readerToken: string,
    foreignToken: string,
    outsideToken: string;
  let base: string, close: () => Promise<void>, context: AuthorizationContext;
  let serial = 0;
  const call = (method: string, path: string, token: string, body?: object) =>
    httpJson(base, method, path, { token, body });
  const source = async (amount = '100.00') => {
    const invoiceId = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status)
       VALUES($1,$2,$3,$4,$5,'0.00',$5,'0.00','Pending') RETURNING id`,
        [tenant, facility, patient, `P3BR-${suffix}-${++serial}`, amount],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount)
       VALUES($1,'Synthetic','Synthetic service',1,$2,$2)`,
      [invoiceId, amount],
    );
    const payment = (
      await recordSettledPayment(
        context,
        {
          facilityId: facility,
          invoiceId,
          amount,
          paymentMethod: 'Cash',
          idempotencyKey: randomUUID(),
        },
        'Synthetic cashier',
      )
    ).payment;
    return { invoiceId, paymentId: payment.id };
  };
  const input = (invoiceId: number, paymentId: number, amount = '30.00', key = randomUUID()) => ({
    facilityId: facility,
    invoiceId,
    paymentId,
    amount,
    refundMethod: 'CASH',
    reason: 'Synthetic refund request',
    idempotencyKey: key,
  });
  const submit = (body: object, token = requesterToken) =>
    call('POST', '/api/billing/refund-requests', token, body);
  const list = (invoiceId: number, token = reviewerToken, fac = facility) =>
    call('GET', `/api/billing/refund-requests?facilityId=${fac}&invoiceId=${invoiceId}`, token);
  const decide = (id: number, hash: string, token = reviewerToken, decision = 'APPROVE') =>
    call('POST', `/api/billing/refund-requests/${id}/decision`, token, {
      facilityId: facility,
      decision,
      reviewHash: hash,
      notes: 'Independent synthetic review',
    });
  const record = (body: object, token = requesterToken) =>
    call('POST', '/api/billing/refunds', token, { ...body, manualConfirmation: true });

  beforeAll(async () => {
    await assertSyntheticRefundTestDb();
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic refund approval',
        `p3br-${suffix}`,
      ])
    ).rows[0].id;
    [facility, sibling] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
       ($1,$2,'Synthetic A','["finance","accounting"]'),($1,$3,'Synthetic B','["finance","accounting"]') RETURNING id`,
        [tenant, `P3BRA-${suffix}`, `P3BRB-${suffix}`],
      )
    ).rows.map((r) => r.id);
    outsideTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic separate refund tenant',
        `p3br-outside-${suffix}`,
      ])
    ).rows[0].id;
    outsideFacility = (
      await pool.query(
        'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
        [
          outsideTenant,
          `P3BRO-${suffix}`,
          'Synthetic outside facility',
          JSON.stringify(['finance', 'accounting']),
        ],
      )
    ).rows[0].id;
    patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$3,'Synthetic','Refund','2000-01-01','Other') RETURNING id`,
        [tenant, facility, `P3BRP-${suffix}`],
      )
    ).rows[0].id;
    for (const code of [
      'billing.read',
      'billing.payments.record',
      'billing.refunds.record',
      'billing.refunds.approve',
    ])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'billing') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const actor = async (tag: string, fac: number, grants: string[], actorTenant = tenant) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic financial user','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`p3br-${tag}-${suffix}`, `p3br-${tag}-${suffix}@example.test`, actorTenant, fac],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [actorTenant, `P3BR_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const code of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };
    const req = await actor('requester', facility, [
      'billing.read',
      'billing.payments.record',
      'billing.refunds.record',
      'billing.refunds.approve',
    ]);
    const rev = await actor('reviewer', facility, ['billing.read', 'billing.refunds.approve']);
    const reader = await actor('reader', facility, ['billing.read']);
    const foreign = await actor('foreign', sibling, [
      'billing.read',
      'billing.refunds.record',
      'billing.refunds.approve',
    ]);
    const outside = await actor(
      'outside',
      outsideFacility,
      ['billing.read', 'billing.refunds.record', 'billing.refunds.approve'],
      outsideTenant,
    );
    requester = req.id;
    reviewer = rev.id;
    requesterToken = req.token;
    reviewerToken = rev.token;
    readerToken = reader.token;
    foreignToken = foreign.token;
    outsideToken = outside.token;
    context = {
      userId: requester,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [
        'billing.read',
        'billing.payments.record',
        'billing.refunds.record',
        'billing.refunds.approve',
      ],
      isSuperAdmin: false,
    };
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('does not record a new manual refund without an independent approval', async () => {
    const { invoiceId, paymentId } = await source();
    const result = await record(input(invoiceId, paymentId));
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('REFUND_APPROVAL_REQUIRED');
    expect(
      (
        await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
          invoiceId,
        ])
      ).rows[0].paid,
    ).toBe('100.00');
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE payment_id=$1', [
          paymentId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('requires a separate authorized reviewer before recording a partial manual settlement', async () => {
    const { invoiceId, paymentId } = await source();
    const body = input(invoiceId, paymentId);
    expect((await submit(body, readerToken)).status).toBe(403);
    expect((await submit(body, foreignToken)).status).toBe(403);
    expect((await submit(body, outsideToken)).status).toBe(403);
    expect((await list(invoiceId, outsideToken, facility)).status).toBe(403);
    const created = await submit(body);
    expect(created.status).toBe(201);
    expect(created.body.request.status).toBe('REQUESTED');
    const repeat = await submit(body);
    expect(repeat.status).toBe(200);
    expect(repeat.body.request.id).toBe(created.body.request.id);
    expect(
      (
        await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
          invoiceId,
        ])
      ).rows[0].paid,
    ).toBe('100.00');
    const page = await list(invoiceId);
    expect(page.status).toBe(200);
    const item = page.body.requests.find((x: { id: number }) => x.id === created.body.request.id);
    expect(item.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await decide(item.id, item.reviewHash, requesterToken)).body.error).toBe(
      'SELF_REFUND_APPROVAL_FORBIDDEN',
    );
    expect((await decide(item.id, item.reviewHash, readerToken)).status).toBe(403);
    const approved = await decide(item.id, item.reviewHash);
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
    const settled = await record(body);
    expect(settled.status).toBe(201);
    expect(settled.body.refund).toMatchObject({
      invoiceId,
      paymentId,
      amount: '30.00',
      status: 'MANUALLY_RECORDED',
    });
    expect(settled.body.accounting).toBe('NOT_POSTED');
    expect(
      (
        await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
          invoiceId,
        ])
      ).rows[0].paid,
    ).toBe('70.00');
    const audit = await pool.query(
      "SELECT action,user_id FROM audit_logs WHERE resource='RefundRequest' AND resource_id=$1 ORDER BY id",
      [String(item.id)],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['REQUEST', 'APPROVE', 'SETTLE']);
    expect(audit.rows.map((r) => r.user_id)).toEqual([
      String(requester),
      String(reviewer),
      String(requester),
    ]);
  });

  it('serializes competing approvals for the same remaining receipt', async () => {
    const { invoiceId, paymentId } = await source();
    const [first, second] = await Promise.all([
      submit(input(invoiceId, paymentId, '60.00')),
      submit(input(invoiceId, paymentId, '60.00')),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const page = await list(invoiceId);
    const a = page.body.requests.find((x: { id: number }) => x.id === first.body.request.id);
    const b = page.body.requests.find((x: { id: number }) => x.id === second.body.request.id);
    const results = await Promise.all([decide(a.id, a.reviewHash), decide(b.id, b.reviewHash)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_refund_requests WHERE invoice_id=$1 AND status='APPROVED'",
          [invoiceId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE payment_id=$1', [
          paymentId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('recovers concurrent request and decision retries without duplicating audit or moving money', async () => {
    const { invoiceId, paymentId } = await source();
    const body = input(invoiceId, paymentId, '35.00');
    const requests = await Promise.all(Array.from({ length: 5 }, () => submit(body)));
    expect(requests.map((x) => x.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const requestId = requests[0].body.request.id;
    expect(requests.every((x) => x.body.request.id === requestId)).toBe(true);
    expect((await submit({ ...body, amount: '36.00' })).body.error).toBe(
      'REFUND_REQUEST_IDEMPOTENCY_CONFLICT',
    );
    const status = await call('POST', '/api/billing/refund-requests/status', requesterToken, {
      facilityId: facility,
      idempotencyKey: body.idempotencyKey,
    });
    expect(status.body).toMatchObject({
      status: 'FOUND',
      request: { id: requestId, invoiceId, paymentId },
    });
    const foreignStatus = await call('POST', '/api/billing/refund-requests/status', foreignToken, {
      facilityId: sibling,
      idempotencyKey: body.idempotencyKey,
    });
    expect(foreignStatus.body).toEqual({ status: 'NOT_FOUND' });
    const page = await list(invoiceId);
    const item = page.body.requests[0];
    const decisions = await Promise.all(
      Array.from({ length: 5 }, () => decide(requestId, item.reviewHash)),
    );
    expect(decisions.map((x) => x.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(
      (
        await pool.query(
          "SELECT action,count(*)::int n FROM audit_logs WHERE resource='RefundRequest' AND resource_id=$1 GROUP BY action ORDER BY action",
          [String(requestId)],
        )
      ).rows,
    ).toEqual([
      { action: 'APPROVE', n: 1 },
      { action: 'REQUEST', n: 1 },
    ]);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
          invoiceId,
        ])
      ).rows[0].paid,
    ).toBe('100.00');
  });

  it('rejects stale review, can reject an over-reserved request, and revokes unused approval without losing history', async () => {
    const { invoiceId, paymentId } = await source();
    const first = await submit(input(invoiceId, paymentId, '40.00'));
    const second = await submit(input(invoiceId, paymentId, '70.00'));
    const initial = await list(invoiceId);
    const a = initial.body.requests.find((q: { id: number }) => q.id === first.body.request.id);
    const b = initial.body.requests.find((q: { id: number }) => q.id === second.body.request.id);
    expect((await decide(a.id, a.reviewHash)).status).toBe(201);
    expect((await decide(b.id, b.reviewHash)).body.error).toBe('REFUND_REVIEW_CHANGED');
    const refreshed = await list(invoiceId);
    const current = refreshed.body.requests.find((q: { id: number }) => q.id === b.id);
    expect(current.issue).toBe('REFUND_APPROVAL_EXCEEDS_AVAILABLE');
    expect(current.evidence).toMatchObject({ receiptReserved: '40.00', receiptAvailable: '60.00' });
    expect((await decide(b.id, current.reviewHash)).body.error).toBe(
      'REFUND_APPROVAL_EXCEEDS_AVAILABLE',
    );
    expect((await decide(b.id, current.reviewHash, reviewerToken, 'REJECT')).status).toBe(201);
    const revokeBody = { facilityId: facility, reason: 'Synthetic changed circumstances' };
    expect(
      (
        await call(
          'POST',
          `/api/billing/refund-requests/${a.id}/revoke`,
          requesterToken,
          revokeBody,
        )
      ).body.error,
    ).toBe('SELF_REFUND_APPROVAL_FORBIDDEN');
    expect(
      (await call('POST', `/api/billing/refund-requests/${a.id}/revoke`, reviewerToken, revokeBody))
        .status,
    ).toBe(201);
    expect(
      (await call('POST', `/api/billing/refund-requests/${a.id}/revoke`, reviewerToken, revokeBody))
        .status,
    ).toBe(200);
    const third = await submit(input(invoiceId, paymentId, '70.00'));
    const finalPage = await list(invoiceId);
    const c = finalPage.body.requests.find((q: { id: number }) => q.id === third.body.request.id);
    expect(c.evidence.receiptReserved).toBe('0.00');
    expect((await decide(c.id, c.reviewHash)).status).toBe(201);
    expect(
      (
        await pool.query(
          'SELECT status FROM billing_refund_requests WHERE id=ANY($1::int[]) ORDER BY id',
          [[a.id, b.id, c.id]],
        )
      ).rows.map((r) => r.status),
    ).toEqual(['REVOKED', 'REJECTED', 'APPROVED']);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('rejects changed approved terms and records one refund under concurrent settlement retries', async () => {
    const { invoiceId, paymentId } = await source();
    const body = input(invoiceId, paymentId, '30.00');
    const created = await submit(body);
    const page = await list(invoiceId);
    const q = page.body.requests[0];
    expect((await decide(q.id, q.reviewHash)).status).toBe(201);
    expect((await record({ ...body, amount: '31.00' })).body.error).toBe(
      'REFUND_APPROVAL_REQUIRED',
    );
    expect((await record({ ...body, reason: 'Different synthetic reason' })).body.error).toBe(
      'REFUND_APPROVAL_REQUIRED',
    );
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => record(body)));
    expect(outcomes.map((x) => x.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(outcomes.map((x) => x.body.refund.id)).size).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT status,settled_refund_id FROM billing_refund_requests WHERE id=$1',
          [created.body.request.id],
        )
      ).rows[0],
    ).toEqual({ status: 'SETTLED', settled_refund_id: outcomes[0].body.refund.id });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='RefundRequest' AND resource_id=$1 AND action='SETTLE'",
          [String(q.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
          invoiceId,
        ])
      ).rows[0].paid,
    ).toBe('70.00');
  });

  it('enforces request immutability, independent review, and atomic refund linkage in PostgreSQL', async () => {
    const { invoiceId, paymentId } = await source();
    const body = input(invoiceId, paymentId);
    await expect(
      pool.query(
        `INSERT INTO billing_refunds(tenant_id,facility_id,invoice_id,payment_id,refund_number,amount,refund_method,reason,manual_confirmation,idempotency_key,request_hash,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6,'CASH',$7,true,$8,'synthetic',$9)`,
        [
          tenant,
          facility,
          invoiceId,
          paymentId,
          `RAW-${randomUUID()}`,
          body.amount,
          body.reason,
          body.idempotencyKey,
          requester,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const created = await submit(body);
    const qid = created.body.request.id;
    await expect(
      pool.query('UPDATE billing_refund_requests SET amount=1 WHERE id=$1', [qid]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM billing_refund_requests WHERE id=$1', [qid]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        "UPDATE billing_refund_requests SET status='APPROVED',reviewed_by_user_id=$2,review_notes='Synthetic review',review_hash=$3,reviewed_at=now() WHERE id=$1",
        [qid, requester, 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const page = await list(invoiceId);
    expect((await decide(qid, page.body.requests[0].reviewHash)).status).toBe(201);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO billing_refunds(tenant_id,facility_id,invoice_id,payment_id,refund_number,amount,refund_method,reason,manual_confirmation,idempotency_key,request_hash,actor_user_id)
        VALUES($1,$2,$3,$4,$5,$6,'CASH',$7,true,$8,'synthetic',$9)`,
        [
          tenant,
          facility,
          invoiceId,
          paymentId,
          `RAW-${randomUUID()}`,
          body.amount,
          body.reason,
          body.idempotencyKey,
          requester,
        ],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await pool.query('SELECT status FROM billing_refund_requests WHERE id=$1', [qid])).rows[0]
        .status,
    ).toBe('APPROVED');
  });

  it('rolls back request, approval and settlement if their audit evidence fails, then safely retries', async () => {
    const { invoiceId, paymentId } = await source();
    const body = input(invoiceId, paymentId);
    const name = `p3br_audit_${suffix.replaceAll('-', '')}`;
    const failAudit = async (action: string) => {
      await pool.query(
        `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN IF NEW.facility_id=${facility} AND NEW.resource='RefundRequest' AND NEW.action='${action}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
      );
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
    };
    const clearAudit = async () => {
      await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
    };
    try {
      await failAudit('REQUEST');
      expect((await submit(body)).status).toBe(500);
      await clearAudit();
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM billing_refund_requests WHERE invoice_id=$1',
            [invoiceId],
          )
        ).rows[0].n,
      ).toBe(0);
      const created = await submit(body);
      expect(created.status).toBe(201);
      const qid = created.body.request.id;
      const page = await list(invoiceId);
      const digest = page.body.requests[0].reviewHash;
      await failAudit('APPROVE');
      expect((await decide(qid, digest)).status).toBe(500);
      await clearAudit();
      expect(
        (await pool.query('SELECT status FROM billing_refund_requests WHERE id=$1', [qid])).rows[0]
          .status,
      ).toBe('REQUESTED');
      expect((await decide(qid, digest)).status).toBe(201);
      await failAudit('SETTLE');
      expect((await record(body)).status).toBe(500);
      await clearAudit();
      expect(
        (await pool.query('SELECT status FROM billing_refund_requests WHERE id=$1', [qid])).rows[0]
          .status,
      ).toBe('APPROVED');
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE invoice_id=$1', [
            invoiceId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
            invoiceId,
          ])
        ).rows[0].paid,
      ).toBe('100.00');
      expect((await record(body)).status).toBe(201);
    } finally {
      await clearAudit();
    }
  });

  it('paginates real scoped requests without exposing another facility or tenant', async () => {
    const { invoiceId, paymentId } = await source();
    const created = await Promise.all(
      Array.from({ length: 25 }, () => submit(input(invoiceId, paymentId, '1.00'))),
    );
    expect(created.every((r) => r.status === 201)).toBe(true);
    let cursor: number | null = null;
    const ids: number[] = [];
    let pages = 0;
    do {
      const query = `/api/billing/refund-requests?facilityId=${facility}&invoiceId=${invoiceId}&limit=7${cursor ? `&afterId=${cursor}` : ''}`;
      const result = await call('GET', query, reviewerToken);
      expect(result.status).toBe(200);
      expect(result.body.requests.length).toBeLessThanOrEqual(7);
      ids.push(...result.body.requests.map((q: { id: number }) => q.id));
      cursor = result.body.nextAfterId;
      pages++;
      expect(pages).toBeLessThanOrEqual(4);
    } while (cursor !== null);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(pages).toBe(4);
    expect((await list(invoiceId, foreignToken, sibling)).body.requests).toEqual([]);
    expect((await list(invoiceId, outsideToken, outsideFacility)).body.requests).toEqual([]);
    expect(
      (
        await call('POST', `/api/billing/refund-requests/${ids[0]}/decision`, outsideToken, {
          facilityId: outsideFacility,
          decision: 'APPROVE',
          reviewHash: 'a'.repeat(64),
          notes: 'Synthetic outside review',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/api/billing/refund-requests?facilityId=${facility}&limit=51`,
          reviewerToken,
        )
      ).status,
    ).toBe(400);
  });

  it('rechecks a receipt that becomes payer-linked after request and permits only rejection', async () => {
    const { invoiceId, paymentId } = await source();
    const first = await submit(input(invoiceId, paymentId));
    const initial = await list(invoiceId);
    const q = initial.body.requests[0];
    await pool.query(
      `INSERT INTO sha_eclaims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,billable_start,billable_end,total_billed_amount,total_claimed_amount,settled_payment_id)
      VALUES($1,$2,$3,$4,$5,$6,'2026-01-01','2026-01-01','100.00','100.00',$7)`,
      [tenant, facility, patient, invoiceId, `SYN-SHA-${randomUUID()}`, randomUUID(), paymentId],
    );
    expect((await submit(input(invoiceId, paymentId))).body.error).toBe(
      'PAYER_REFUND_REVIEW_REQUIRED',
    );
    expect((await decide(q.id, q.reviewHash)).body.error).toBe('REFUND_REVIEW_CHANGED');
    const refreshed = (await list(invoiceId)).body.requests.find(
      (x: { id: number }) => x.id === first.body.request.id,
    );
    expect(refreshed.issue).toBe('PAYER_REFUND_REVIEW_REQUIRED');
    expect((await decide(q.id, refreshed.reviewHash)).body.error).toBe('REFUND_REVIEW_UNAVAILABLE');
    expect((await decide(q.id, refreshed.reviewHash, reviewerToken, 'REJECT')).status).toBe(201);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
});
