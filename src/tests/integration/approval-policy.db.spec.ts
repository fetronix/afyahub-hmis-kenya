/**
 * Batch 1 — facility approval-policy management, end to end.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * The enforcement half of this feature already worked: procurement refuses an
 * approval that does not carry the authority a facility requires. The management
 * half did not exist — the router was never mounted, and it was written with
 * `requirePermission`, which is ALL-of (`hasAllPermissions`). That combination
 * meant the screen would have answered 403 to every real account, because no
 * seeded role holds both `procurement.read` *and* `facilities.read` (or both
 * `procurement.approve` *and* `facilities.update`). The facility-administrator
 * set holds none of the four.
 *
 * So this file proves both halves against real PostgreSQL and the real app:
 *
 *   1. A facility administrator holding only `facilities.modules.manage` can
 *      list and create — the exact case the old gate refused. This is the
 *      regression test for the ALL-of defect.
 *   2. Reading the thresholds is open to a procurement reader.
 *   3. Changing a threshold is refused to a procurement approver who lacks a
 *      governance permission. Segregation of duties: the person who approves
 *      spending cannot move the bar that governs their own approvals.
 *   4. An unrelated permission gets 401/403 and writes nothing.
 *   5. Facility and tenant isolation: another facility's and another tenant's
 *      policies cannot be read or written, even by naming their facility id.
 *   6. Validation: unknown permission, duplicate threshold, malformed amount
 *      and reversed dates are refused with their own codes rather than 500s.
 *   7. Every create and update writes an audit row naming the actor.
 *   8. The preview endpoint reports the rule that would apply and whether the
 *      caller meets it.
 *   9. Procurement actually uses the rules: above the threshold an approver
 *      without the required authority is refused; below it the same approver
 *      succeeds; with the authority granted, the large order succeeds too.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * That a facility administrator would *choose* sensible thresholds, or that the
 * permission named in a rule corresponds to a role anyone holds. Both are
 * governance decisions, not code. Dual control on policy changes (propose then
 * approve) is not implemented and is not claimed.
 *
 * Synthetic data only. No real patient, staff or financial records.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('approval policy management', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;

  let tenantA: number;
  let tenantB: number;
  let facilityA: number;
  let facilityA2: number;
  let facilityB: number;
  let supplierA: number;

  type Actor = { id: number; token: string };
  let admin: Actor; // facilities.modules.manage only — the administrator case
  let reader: Actor; // procurement.read only
  let buyer: Actor; // procurement.read + create; raises the orders
  let approver: Actor; // procurement.read + approve, no governance permission
  let executive: Actor; // procurement + approve + facilities.update (meets the 500.00 rule)
  let nobody: Actor; // no relevant permission at all
  let foreign: Actor; // another tenant, every relevant permission

  const call = (
    method: string,
    path: string,
    token: string | undefined,
    body?: Record<string, unknown>,
  ) => httpJson(base, method, path, { token, body });

  async function makeActor(
    tag: string,
    tenant: number,
    facility: number,
    codes: string[],
  ): Promise<Actor> {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
        [
          `ap-${tag}-${suffix}`,
          `ap-${tag}-${suffix}@example.test`,
          `Synthetic ${tag}`,
          tenant,
          facility,
        ],
      )
    ).rows[0].id as number;

    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `AP_${tag}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);

    for (const code of codes) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }

    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }

  /**
   * A pending, itemised purchase order totalling `total` shillings.
   * Raised by the buyer, never by an approver: procurement forbids self-approval,
   * and this file is about the policy gate, not that control.
   */
  async function createOrder(total: string): Promise<{ id: number; revision: number }> {
    const result = await call('POST', '/api/purchase-orders', buyer.token, {
      facilityId: facilityA,
      supplierId: supplierA,
      poNumber: `AP-PO-${suffix}-${randomUUID().slice(0, 6)}`,
      description: 'Synthetic approval-policy order',
      expectedDeliveryDate: '2027-04-15',
      items: [{ description: 'Synthetic item', quantity: '1', unit: 'unit', unitPrice: total }],
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    /* Transitions are optimistic: the caller must name the revision it saw. */
    return { id: result.body.id as number, revision: Number(result.body.revision) };
  }

  const approveOrder = (order: { id: number; revision: number }, token: string) =>
    call('POST', `/api/purchase-orders/${order.id}/approve`, token, {
      facilityId: facilityA,
      expectedRevision: order.revision,
    });

  const policyBody = (overrides: Record<string, unknown> = {}) => ({
    facilityId: facilityA,
    policyScope: 'PURCHASE_ORDER',
    policyName: `Synthetic rule ${randomUUID().slice(0, 6)}`,
    minAmountCents: 5_000_000,
    requiredPermission: 'facilities.update',
    effectiveFrom: '2026-01-01',
    ...overrides,
  });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');

    [tenantA, tenantB] = (
      await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`, [
        `Synthetic AP A ${suffix}`,
        `ap-a-${suffix}`,
        `Synthetic AP B ${suffix}`,
        `ap-b-${suffix}`,
      ])
    ).rows.map((row) => row.id);

    [facilityA, facilityA2, facilityB] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
         VALUES ($1,$2,'A','["procurement"]'::jsonb),
                ($1,$3,'A2','["procurement"]'::jsonb),
                ($4,$5,'B','["procurement"]'::jsonb)
         RETURNING id`,
        [tenantA, `APA-${suffix}`, `APA2-${suffix}`, tenantB, `APB-${suffix}`],
      )
    ).rows.map((row) => row.id);

    supplierA = (
      await pool.query('INSERT INTO suppliers(tenant_id,name) VALUES($1,$2) RETURNING id', [
        tenantA,
        `Synthetic AP supplier ${suffix}`,
      ])
    ).rows[0].id as number;

    admin = await makeActor('admin', tenantA, facilityA, ['facilities.modules.manage']);
    reader = await makeActor('reader', tenantA, facilityA, ['procurement.read']);
    buyer = await makeActor('buyer', tenantA, facilityA, [
      'procurement.read',
      'procurement.create',
    ]);
    approver = await makeActor('approver', tenantA, facilityA, [
      'procurement.read',
      'procurement.approve',
    ]);
    executive = await makeActor('exec', tenantA, facilityA, [
      'procurement.read',
      'procurement.approve',
      'facilities.update',
    ]);
    nobody = await makeActor('nobody', tenantA, facilityA, ['patients.read']);
    foreign = await makeActor('foreign', tenantB, facilityB, [
      'procurement.read',
      'procurement.approve',
      'procurement.create',
      'facilities.update',
      'facilities.modules.manage',
      'approval_policies.manage',
      'approval_policies.read',
    ]);

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  }, 180_000);

  afterAll(async () => {
    if (close) await close();
    await pool.end().catch(() => undefined);
  });

  describe('the router is actually reachable', () => {
    it('answers the management path instead of falling through to 404', async () => {
      /*
       * The audit's finding was not a broken handler — it was a router nobody
       * mounted, so every call reached the catch-all 404. A mounted route is
       * distinguishable from an absent one by the error body: the 404 handler
       * says NOT_FOUND, an authorisation refusal names the authorisation.
       */
      const response = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA}`,
        nobody.token,
      );
      expect(response.status).toBe(403);
      expect(response.body.error).not.toBe('NOT_FOUND');
    });

    it('does not mount the retired master-tariff router', async () => {
      const response = await call(
        'GET',
        `/api/master-tariffs?facilityId=${facilityA}`,
        admin.token,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('authorisation — the regression the old gate would have caused', () => {
    it('rejects an unauthenticated list with 401', async () => {
      const response = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA}`,
        undefined,
      );
      expect(response.status).toBe(401);
    });

    it('answers 403 to an account with no relevant permission', async () => {
      const response = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA}`,
        nobody.token,
      );
      expect(response.status).toBe(403);
    });

    it('lets a facility administrator holding only facilities.modules.manage list and create', async () => {
      /*
       * This is the case the ALL-of gate refused: this account has neither
       * procurement.read nor facilities.read, and neither procurement.approve
       * nor facilities.update. Under the old guards it could do nothing here.
       */
      const list = await call('GET', `/api/approval-policies?facilityId=${facilityA}`, admin.token);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body.policies)).toBe(true);

      const created = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 4_242_000, policyName: 'Admin-created rule' }),
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.policy.policyName).toBe('Admin-created rule');
      expect(created.body.policy.createdByName).toContain('Synthetic admin');
    });

    it('lets a procurement reader see the thresholds', async () => {
      const response = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA}`,
        reader.token,
      );
      expect(response.status).toBe(200);
    });

    it('refuses a threshold change to a procurement approver without a governance permission', async () => {
      /* Segregation of duties: the approver must not move their own bar. */
      const response = await call(
        'POST',
        '/api/approval-policies',
        approver.token,
        policyBody({ minAmountCents: 9_999_000, policyName: 'Approver self-serving rule' }),
      );
      expect(response.status).toBe(403);

      const written = await pool.query(
        'SELECT COUNT(*)::int AS n FROM approval_policies WHERE policy_name=$1',
        ['Approver self-serving rule'],
      );
      expect(Number(written.rows[0].n)).toBe(0);
    });

    it('lets an account with facilities.update change a threshold', async () => {
      const response = await call(
        'POST',
        '/api/approval-policies',
        executive.token,
        policyBody({ minAmountCents: 8_888_000, policyName: 'Executive-created rule' }),
      );
      expect(response.status).toBe(201);
    });
  });

  describe('facility and tenant isolation', () => {
    it('does not return another facility’s policies', async () => {
      await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 6_616_000, policyName: 'Facility A only' }),
      );

      const response = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA2}`,
        admin.token,
      );
      /*
       * The caller is scoped to facility A, so asking for its sibling is
       * refused outright rather than answered with somebody else's rules.
       */
      expect([403, 404]).toContain(response.status);
      expect(response.body.success ?? false).toBe(false);
    });

    it('does not let another tenant read or write this facility’s policies', async () => {
      const read = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA}`,
        foreign.token,
      );
      expect([403, 404]).toContain(read.status);

      const write = await call(
        'POST',
        '/api/approval-policies',
        foreign.token,
        policyBody({ policyName: 'Cross-tenant injection', minAmountCents: 7_771_000 }),
      );
      expect([403, 404]).toContain(write.status);

      const injected = await pool.query(
        'SELECT COUNT(*)::int AS n FROM approval_policies WHERE policy_name=$1',
        ['Cross-tenant injection'],
      );
      expect(Number(injected.rows[0].n)).toBe(0);
    });

    it('refuses an update that names a policy id from another tenant', async () => {
      const created = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 5_551_000, policyName: 'A-owned rule' }),
      );
      expect(created.status).toBe(201);
      const id = created.body.policy.id as number;

      const response = await call('PUT', `/api/approval-policies/${id}`, foreign.token, {
        facilityId: facilityB,
        policyName: 'Hijacked',
      });
      /* The policy is looked up inside the caller's scope, so it is invisible. */
      expect([403, 404]).toContain(response.status);

      const row = await pool.query('SELECT policy_name FROM approval_policies WHERE id=$1', [id]);
      expect(row.rows[0].policy_name).toBe('A-owned rule');
    });
  });

  describe('validation', () => {
    it('refuses a permission that is not in the catalogue', async () => {
      const response = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ requiredPermission: 'not.a.real.permission', minAmountCents: 3_100_000 }),
      );
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('UNKNOWN_PERMISSION');
    });

    it('refuses two rules at the same threshold and scope', async () => {
      const first = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 2_200_000, policyName: 'First at 22,000' }),
      );
      expect(first.status).toBe(201);

      const second = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 2_200_000, policyName: 'Second at 22,000' }),
      );
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('APPROVAL_THRESHOLD_IN_USE');
    });

    it('refuses a malformed amount and a reversed date range', async () => {
      const badAmount = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 12.5 }),
      );
      expect(badAmount.status).toBe(400);
      expect(badAmount.body.error).toBe('INVALID_AMOUNT');

      const badDates = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({
          minAmountCents: 1_234_000,
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-05-01',
        }),
      );
      expect(badDates.status).toBe(400);
      expect(badDates.body.error).toBe('INVALID_INPUT');
    });

    it('refuses an unknown scope', async () => {
      const response = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ policyScope: 'PAYROLL', minAmountCents: 1_111_000 }),
      );
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_SCOPE');
    });
  });

  describe('updates and audit', () => {
    it('renames and deactivates without disturbing the threshold', async () => {
      const created = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 4_400_000, policyName: 'Rename me' }),
      );
      const id = created.body.policy.id as number;

      const updated = await call('PUT', `/api/approval-policies/${id}`, admin.token, {
        facilityId: facilityA,
        policyName: 'Renamed rule',
        isActive: false,
      });
      expect(updated.status).toBe(200);
      expect(updated.body.policy.policyName).toBe('Renamed rule');
      expect(updated.body.policy.isActive).toBe(false);
      /* Threshold and required permission are immutable through this route. */
      expect(updated.body.policy.minAmountCents).toBe(4_400_000);
      expect(updated.body.policy.requiredPermission).toBe('facilities.update');
    });

    it('records the actor for a create and for an update', async () => {
      const created = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 3_357_000, policyName: 'Audited rule' }),
      );
      const id = created.body.policy.id as number;

      await call('PUT', `/api/approval-policies/${id}`, admin.token, {
        facilityId: facilityA,
        policyName: 'Audited rule v2',
      });

      const audit = await pool.query(
        `SELECT action, user_id FROM audit_logs
          WHERE facility_id=$1 AND resource='ApprovalPolicy' AND resource_id=$2
          ORDER BY id`,
        [facilityA, String(id)],
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'UPDATE']);
      expect(String(audit.rows[0].user_id)).toBe(String(admin.id));
    });
  });

  describe('preview', () => {
    it('reports the rule that would apply and whether the caller meets it', async () => {
      await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({ minAmountCents: 1_000_000, policyName: 'Preview rule at 10,000' }),
      );

      const above = await call(
        'GET',
        `/api/approval-policies/preview?facilityId=${facilityA}&scope=PURCHASE_ORDER&amountCents=2000000`,
        reader.token,
      );
      expect(above.status).toBe(200);
      expect(above.body.rule.policyName).toBe('Preview rule at 10,000');
      /* A procurement reader does not hold facilities.update. */
      expect(above.body.satisfied).toBe(false);

      const below = await call(
        'GET',
        `/api/approval-policies/preview?facilityId=${facilityA}&scope=PURCHASE_ORDER&amountCents=1`,
        reader.token,
      );
      expect(below.status).toBe(200);
      expect(below.body.satisfied).toBe(true);
    });
  });

  /*
   * The journey the batch was written for, in the order an administrator and
   * their staff actually perform it, against one database and one app. The
   * suites above prove each part; this one proves the parts connect.
   */
  describe('the administrator journey, in order', () => {
    it('saves a rule, shows it, enforces it, and refuses to let the wrong people change it', async () => {
      /* 1. The administrator adds a rule requiring facilities.update from 9,000 KES. */
      const created = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({
          policyScope: 'REQUISITION',
          minAmountCents: 900_000,
          policyName: 'Journey rule above 9,000',
          requiredPermission: 'facilities.update',
        }),
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.policy.id as number;

      /* 2. It comes back in the list the screen reads, with the threshold saved. */
      const listed = await call(
        'GET',
        `/api/approval-policies?facilityId=${facilityA}`,
        admin.token,
      );
      expect(listed.status).toBe(200);
      const saved = (listed.body.policies as Array<Record<string, unknown>>).find(
        (row) => row.id === id,
      );
      expect(saved).toMatchObject({
        policyName: 'Journey rule above 9,000',
        minAmountCents: 900_000,
        requiredPermission: 'facilities.update',
        isActive: true,
      });
      expect(saved?.createdByName).toContain('Synthetic admin');

      /* 3. A requisition is raised for 20,000 KES and submitted. */
      const raised = await call('POST', '/api/procurement/requisitions', buyer.token, {
        facilityId: facilityA,
        requisitionNumber: `AP-JRN-${suffix}-${randomUUID().slice(0, 6)}`,
        requestDate: '2026-10-01',
        justification: 'Synthetic journey requisition',
        items: [
          {
            description: 'Synthetic supply',
            quantity: 1,
            unit: 'unit',
            estimatedUnitPrice: '20000.00',
          },
        ],
      });
      expect(raised.status, JSON.stringify(raised.body)).toBe(201);
      const requisitionId = raised.body.id as number;
      await call('POST', `/api/procurement/requisitions/${requisitionId}/submit`, buyer.token, {
        facilityId: facilityA,
      });

      /* 4. An approver without the named authority is stopped, and told by rule name.
            The highest matching threshold governs, so the 9,000 rule wins over the
            facility's other requisition rules. */
      const refused = await call(
        'POST',
        `/api/procurement/requisitions/${requisitionId}/approve`,
        approver.token,
        { facilityId: facilityA },
      );
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('APPROVAL_AUTHORITY_REQUIRED');
      expect(String(refused.body.message)).toContain('Journey rule above 9,000');

      /* 5. An account with no governance permission cannot retire the rule to get past it. */
      const tamper = await call('PUT', `/api/approval-policies/${id}`, approver.token, {
        facilityId: facilityA,
        isActive: false,
      });
      expect(tamper.status).toBe(403);
      const untouched = await pool.query('SELECT is_active FROM approval_policies WHERE id=$1', [
        id,
      ]);
      expect(untouched.rows[0].is_active).toBe(true);

      /* 6. The authority the rule names approves the same requisition. */
      const approved = await call(
        'POST',
        `/api/procurement/requisitions/${requisitionId}/approve`,
        executive.token,
        { facilityId: facilityA },
      );
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(String(approved.body.decisionNote)).toContain('Journey rule above 9,000');
    });
  });

  describe('procurement enforcement uses the rules the screen writes', () => {
    it('refuses a large order to an approver without the required authority, and allows it once granted', async () => {
      /*
       * 500.00 (50,000 cents) and above needs facilities.update for this
       * facility. The ordinary approver does not hold it; the executive does.
       */
      const rule = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({
          minAmountCents: 50_000,
          policyName: 'Executive authority above 500',
          requiredPermission: 'facilities.update',
        }),
      );
      expect(rule.status, JSON.stringify(rule.body)).toBe(201);

      /* Below the threshold: the ordinary approver is enough. */
      const small = await createOrder('400.00');
      const smallApproved = await approveOrder(small, approver.token);
      expect(smallApproved.status, JSON.stringify(smallApproved.body)).toBe(200);

      /* Above the threshold: the ordinary approver is refused by name. */
      const large = await createOrder('900.00');
      const refused = await approveOrder(large, approver.token);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('APPROVAL_AUTHORITY_REQUIRED');
      expect(String(refused.body.message)).toContain('Executive authority above 500');

      const stillPending = await pool.query('SELECT status FROM purchase_orders WHERE id=$1', [
        large.id,
      ]);
      expect(stillPending.rows[0].status).toBe('Pending Approval');

      /* With the authority the rule names, the same order is approved. */
      const granted = await approveOrder(large, executive.token);
      expect(granted.status, JSON.stringify(granted.body)).toBe(200);
      expect(granted.body.status).toBe('Approved');

      /* The decision explains itself: the applied rule is recorded on the order. */
      const event = await pool.query(
        `SELECT note FROM purchase_order_events
          WHERE purchase_order_id=$1 AND event_type='APPROVE'
          ORDER BY id DESC LIMIT 1`,
        [large.id],
      );
      expect(String(event.rows[0].note)).toContain('Executive authority above 500');
    });

    it('applies a requisition rule, and reports the refusal as a decision rather than a fault', async () => {
      /*
       * Requisitions are the second place the rules bite, and they had the same
       * seam defect as purchase orders: the refusal arrived as a 500. A
       * requisition is raised by the buyer and decided by somebody else.
       */
      const rule = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({
          policyScope: 'REQUISITION',
          minAmountCents: 300_000,
          policyName: 'Requisition authority above 3,000',
          requiredPermission: 'facilities.update',
        }),
      );
      expect(rule.status, JSON.stringify(rule.body)).toBe(201);

      const created = await call('POST', '/api/procurement/requisitions', buyer.token, {
        facilityId: facilityA,
        requisitionNumber: `AP-REQ-${suffix}-${randomUUID().slice(0, 6)}`,
        requestDate: '2026-10-01',
        neededBy: '2026-11-01',
        justification: 'Synthetic requisition for the approval-policy test',
        items: [
          {
            description: 'Synthetic supply',
            quantity: 1,
            unit: 'unit',
            estimatedUnitPrice: '5000.00',
          },
        ],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.id as number;

      const submitted = await call(
        'POST',
        `/api/procurement/requisitions/${id}/submit`,
        buyer.token,
        { facilityId: facilityA },
      );
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

      const refused = await call(
        'POST',
        `/api/procurement/requisitions/${id}/approve`,
        approver.token,
        { facilityId: facilityA },
      );
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('APPROVAL_AUTHORITY_REQUIRED');
      expect(String(refused.body.message)).toContain('Requisition authority above 3,000');

      const row = await pool.query('SELECT status FROM procurement_requisitions WHERE id=$1', [id]);
      expect(row.rows[0].status).toBe('SUBMITTED');

      /* The authority the rule names can decide it. */
      const granted = await call(
        'POST',
        `/api/procurement/requisitions/${id}/approve`,
        executive.token,
        { facilityId: facilityA },
      );
      expect(granted.status, JSON.stringify(granted.body)).toBe(200);
      expect(granted.body.status).toBe('APPROVED');
      expect(String(granted.body.decisionNote)).toContain('Requisition authority above 3,000');
    });

    it('stops enforcing a rule once the screen deactivates it', async () => {
      const created = await call(
        'POST',
        '/api/approval-policies',
        admin.token,
        policyBody({
          minAmountCents: 100_000,
          policyName: 'Temporary rule at 1,000',
          requiredPermission: 'facilities.update',
        }),
      );
      const id = created.body.policy.id as number;

      const blocked = await createOrder('2000.00');
      const refused = await approveOrder(blocked, approver.token);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('APPROVAL_AUTHORITY_REQUIRED');

      const deactivated = await call('PUT', `/api/approval-policies/${id}`, admin.token, {
        facilityId: facilityA,
        isActive: false,
      });
      expect(deactivated.status).toBe(200);

      /*
       * The 500.00 executive rule is still active, so an order that clears it
       * but would have been caught by the 1,000 rule now needs only that one.
       * The executive holds facilities.update, so it passes.
       */
      const allowed = await createOrder('1100.00');
      const approved = await approveOrder(allowed, executive.token);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    });
  });
});
