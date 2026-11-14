/** Synthetic-only receipt validation, isolation, rollback and valuation evidence. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { receiveBatchScoped } from '../../inventory/inventory.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Inventory receipt cost integrity (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, peer: number, outsiderTenant: number, outsider: number;
  let actor: number, limitedActor: number;
  let token: string, limitedToken: string, peerToken: string, outsiderToken: string;
  let base: string, close: () => Promise<void>;
  let sequence = 0;

  const request = (itemId: number, body: Record<string, unknown>, auth = token) =>
    httpJson(base, 'POST', `/api/inventory/${itemId}/batches`, { token: auth, body });
  const valid = (costPerUnit: unknown, batchNumber = `LOT-${suffix}`) => ({
    facilityId: facility,
    batchNumber,
    expiryDate: '2099-12-31',
    quantity: 3,
    costPerUnit,
    idempotencyKey: randomUUID(),
  });
  const item = async (initialStock = 0) =>
    (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock,is_active) VALUES($1,$2,'Synthetic receipt stock','Unit',$3,true) RETURNING id",
        [facility, `RC-${suffix}-${++sequence}`, initialStock],
      )
    ).rows[0].id as number;
  const state = async (itemId: number) => ({
    stock: (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId]))
      .rows[0].current_stock as number,
    batches: (
      await pool.query(
        'SELECT id,batch_number,expiry_date,quantity_remaining,cost_per_unit FROM inventory_batches WHERE item_id=$1 ORDER BY id',
        [itemId],
      )
    ).rows,
  });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic DB required.');
    [tenant, outsiderTenant] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic receipt tenant ${suffix}`,
        `receipt-${suffix}`,
        `Synthetic other tenant ${suffix}`,
        `receipt-other-${suffix}`,
      ])
    ).rows.map((row) => row.id);
    [facility, peer] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic receipt facility','Africa/Nairobi','["inventory"]'),
               ($1,$3,'Synthetic peer facility','Africa/Nairobi','["inventory"]') RETURNING id`,
        [tenant, `RC-A-${suffix}`, `RC-B-${suffix}`],
      )
    ).rows.map((row) => row.id);
    outsider = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic other-tenant facility','Africa/Nairobi','["inventory"]') RETURNING id`,
        [outsiderTenant, `RC-X-${suffix}`],
      )
    ).rows[0].id;
    for (const code of ['inventory.read', 'inventory.manage'])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'inventory') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const makeActor = async (name: string, t: number, f: number, grants: string[]) => {
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic stock user','test-only','ACTIVE',$3,$4) RETURNING id",
          [`receipt-${name}-${suffix}`, `receipt-${name}-${suffix}@example.test`, t, f],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, `RECEIPT_${name}_${suffix}`],
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
    const manager = await makeActor('manager', tenant, facility, [
      'inventory.read',
      'inventory.manage',
    ]);
    const limited = await makeActor('limited', tenant, facility, ['inventory.read']);
    const peerManager = await makeActor('peer', tenant, peer, [
      'inventory.read',
      'inventory.manage',
    ]);
    const outsiderManager = await makeActor('outsider', outsiderTenant, outsider, [
      'inventory.read',
      'inventory.manage',
    ]);
    actor = manager.id;
    limitedActor = limited.id;
    token = manager.token;
    limitedToken = limited.token;
    peerToken = peerManager.token;
    outsiderToken = outsiderManager.token;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('rejects omitted, null, malformed, negative, over-precision and out-of-range costs without writes', async () => {
    const id = await item();
    for (const value of [
      undefined,
      null,
      '',
      '  ',
      -1,
      '-0.00',
      '1.001',
      '1e2',
      true,
      '100000000.00',
    ]) {
      const response = await request(id, valid(value));
      expect(response.status, `cost ${String(value)}`).toBe(400);
      expect(response.body.error).toBe('INVALID_INPUT');
    }
    expect(await state(id)).toEqual({ stock: 0, batches: [] });
  });

  it('requires permission and database-backed facility and tenant scope', async () => {
    const id = await item();
    expect((await request(id, valid('4.25'), limitedToken)).status).toBe(403);
    expect((await request(id, valid('4.25'), peerToken)).status).toBe(403);
    expect((await request(id, valid('4.25'), outsiderToken)).status).toBe(403);
    const invalidFacility = await request(id, { ...valid('4.25'), facilityId: String(facility) });
    expect(invalidFacility.status).toBe(400);
    expect(invalidFacility.body.error).toBe('INVALID_FACILITY_ID');
    const limitedContext: AuthorizationContext = {
      userId: limitedActor,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: ['inventory.read'],
      isSuperAdmin: false,
    };
    await expect(
      receiveBatchScoped(limitedContext, id, valid('4.25'), facility),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    await expect(
      receiveBatchScoped(
        {
          ...limitedContext,
          tenantId: null,
          facilityId: null,
          permissions: ['inventory.manage'],
          isSuperAdmin: true,
        },
        id,
        valid('4.25'),
        facility,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(await state(id)).toEqual({ stock: 0, batches: [] });
  });

  it('preserves the original lot cost, rejects conflicting top-ups, and audits accepted receipts', async () => {
    const id = await item();
    const first = await request(id, valid('7.50'));
    expect(first.status).toBe(201);
    expect(first.body.batch.costPerUnit).toBe('7.50');
    const conflict = await request(id, valid('8.75'));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('BATCH_COST_MISMATCH');
    let stored = await state(id);
    expect(stored.stock).toBe(3);
    expect(stored.batches).toMatchObject([{ quantity_remaining: 3, cost_per_unit: '7.50' }]);
    const topUp = await request(id, { ...valid('7.5'), quantity: 2 });
    expect(topUp.status).toBe(201);
    stored = await state(id);
    expect(stored.stock).toBe(5);
    expect(stored.batches).toMatchObject([{ quantity_remaining: 5, cost_per_unit: '7.50' }]);
    const audit = (
      await pool.query(
        "SELECT tenant_id,facility_id,user_id,resource_id,details FROM audit_logs WHERE resource='InventoryBatchReceipt' AND resource_id=ANY($1::text[]) ORDER BY id",
        [[String(first.body.receiptId), String(topUp.body.receiptId)]],
      )
    ).rows;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      tenant_id: tenant,
      facility_id: facility,
      user_id: String(actor),
      resource_id: String(first.body.receiptId),
    });
    expect(audit.map((entry) => JSON.parse(entry.details))).toMatchObject([
      { itemId: id, quantity: 3, costPerUnit: '7.50' },
      { itemId: id, quantity: 2, costPerUnit: '7.50' },
    ]);
  });

  it('allows an explicitly supplied zero but keeps its valuation unconfirmed', async () => {
    const id = await item();
    const result = await request(id, valid('0.00'));
    expect(result.status).toBe(201);
    expect(result.body.batch.costPerUnit).toBe('0.00');
    expect((await state(id)).batches[0].cost_per_unit).toBe('0.00');
  });

  it('does not overwrite a lot with unknown cost or turn unknown valuation into zero', async () => {
    const id = await item(3);
    await pool.query(
      "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit) VALUES($1,$2,'2099-12-31',3,NULL)",
      [id, `UNKNOWN-${suffix}`],
    );
    const result = await request(id, valid('2.00', `UNKNOWN-${suffix}`));
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('BATCH_COST_EVIDENCE_REQUIRED');
    expect((await state(id)).stock).toBe(3);
    expect((await state(id)).batches[0]).toMatchObject({
      quantity_remaining: 3,
      cost_per_unit: null,
    });
    const list = await httpJson(
      base,
      'GET',
      `/api/inventory/batches?facilityId=${facility}&itemId=${id}`,
      {
        token,
      },
    );
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject([{ itemId: id, costPerUnit: null }]);

    const expired = await item(1);
    await pool.query(
      "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit) VALUES($1,$2,'2000-01-01',1,NULL)",
      [expired, `EXPIRED-UNKNOWN-${suffix}`],
    );
    const summary = await httpJson(
      base,
      'GET',
      `/api/inventory/expiry-summary?facilityId=${facility}`,
      {
        token,
      },
    );
    expect(summary.status).toBe(200);
    expect(summary.body.expiredValueCents).toBeNull();
    expect(summary.body.expiredUnits).toBeGreaterThanOrEqual(1);
  });

  it('serializes competing costs for the same lot and rolls back the rejected stock update', async () => {
    const id = await item();
    const results = await Promise.all([request(id, valid('1.00')), request(id, valid('2.00'))]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.error).toBe('BATCH_COST_MISMATCH');
    const stored = await state(id);
    expect(stored.stock).toBe(3);
    expect(stored.batches).toHaveLength(1);
    expect(stored.batches[0].quantity_remaining).toBe(3);
    expect(['1.00', '2.00']).toContain(stored.batches[0].cost_per_unit);
  });

  it('fails closed on an overflowing item or an invalid existing lot quantity', async () => {
    const full = await item(2_147_483_647);
    const overflow = await request(full, valid('3.25'));
    expect(overflow.status).toBe(409);
    expect(overflow.body.error).toBe('STOCK_RECONCILIATION_REQUIRED');
    expect(await state(full)).toEqual({ stock: 2_147_483_647, batches: [] });

    const invalid = await item();
    await pool.query(
      "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit) VALUES($1,$2,'2099-12-31',-1,'3.25')",
      [invalid, `INVALID-${suffix}`],
    );
    const rejected = await request(invalid, valid('3.25', `INVALID-${suffix}`));
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toBe('STOCK_RECONCILIATION_REQUIRED');
    const stored = await state(invalid);
    expect(stored.stock).toBe(0);
    expect(stored.batches[0].quantity_remaining).toBe(-1);
  });

  it('requires a valid receipt retry identity', async () => {
    const id = await item();
    for (const value of [undefined, null, '', 'bad', 'invalid key!', 'x'.repeat(129)]) {
      const result = await request(id, { ...valid('2.50'), idempotencyKey: value });
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
    expect(await state(id)).toEqual({ stock: 0, batches: [] });
  });

  it('replays concurrent and later retries exactly once and rejects changed details', async () => {
    const id = await item();
    const body = valid('7.50');
    const [a, b] = await Promise.all([request(id, body), request(id, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.receiptId).toBe(b.body.receiptId);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    expect((await state(id)).stock).toBe(3);
    const changed = await request(id, { ...body, quantity: 4 });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toBe('IDEMPOTENCY_CONFLICT');
    const otherItem = await item();
    expect((await request(otherItem, body)).body.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(await state(otherItem)).toEqual({ stock: 0, batches: [] });

    const topUp = await request(id, { ...valid('7.5'), quantity: 2 });
    expect(topUp.status).toBe(201);
    const replay = await request(id, body);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      receiptId: a.body.receiptId,
      replayed: true,
      received: 3,
      batch: { quantityRemaining: 3, costPerUnit: '7.50' },
      item: { currentStock: 3 },
    });
    expect((await state(id)).stock).toBe(5);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE resource='InventoryBatchReceipt' AND resource_id=$1",
          [String(a.body.receiptId)],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      pool.query('UPDATE inventory_receipt_requests SET state=state WHERE id=$1', [
        a.body.receiptId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM inventory_receipt_requests WHERE id=$1', [a.body.receiptId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('checks and fences uncertain requests with authorized, durable cancellation', async () => {
    const id = await item();
    const body = valid('4.25');
    const status = (auth = token, f: unknown = facility) =>
      httpJson(base, 'POST', '/api/inventory/receipt-status', {
        token: auth,
        body: { facilityId: f, idempotencyKey: body.idempotencyKey },
      });
    const cancel = (auth = token) =>
      httpJson(base, 'POST', '/api/inventory/receipt-retry-cancellation', {
        token: auth,
        body: {
          facilityId: facility,
          idempotencyKey: body.idempotencyKey,
          reason: 'Synthetic duplicate review',
        },
      });
    expect((await status()).body.status).toBe('NOT_FOUND');
    expect((await status(limitedToken)).status).toBe(403);
    expect((await status(peerToken)).status).toBe(403);
    expect((await status(outsiderToken)).status).toBe(403);
    expect((await cancel(limitedToken)).status).toBe(403);
    const cancelled = await cancel();
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await status()).body).toEqual(cancelled.body);
    const delayed = await request(id, body);
    expect(delayed.status).toBe(409);
    expect(delayed.body.error).toBe('IDEMPOTENCY_CANCELLED');
    expect(await state(id)).toEqual({ stock: 0, batches: [] });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE resource='InventoryReceiptRetry' AND resource_id=$1 AND action='CANCEL'",
          [String(cancelled.body.receiptId)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('serializes a receipt against cancellation and never cancels recorded stock', async () => {
    const id = await item();
    const body = valid('5.00');
    const [received, closed] = await Promise.all([
      request(id, body),
      httpJson(base, 'POST', '/api/inventory/receipt-retry-cancellation', {
        token,
        body: {
          facilityId: facility,
          idempotencyKey: body.idempotencyKey,
          reason: 'Synthetic cancellation race',
        },
      }),
    ]);
    expect(closed.status).toBe(200);
    if (closed.body.status === 'RECORDED') {
      expect(received.status).toBe(201);
      expect(closed.body.receiptId).toBe(received.body.receiptId);
      expect((await state(id)).stock).toBe(3);
    } else {
      expect(closed.body.status).toBe('CANCELLED');
      expect(received.status).toBe(409);
      expect(received.body.error).toBe('IDEMPOTENCY_CANCELLED');
      expect(await state(id)).toEqual({ stock: 0, batches: [] });
    }
  });

  it('rolls back both item and lot if the receipt audit write fails', async () => {
    const id = await item();
    const fn = `synthetic_receipt_audit_reject_${suffix}`;
    const trigger = `synthetic_receipt_audit_reject_${suffix}`;
    const batchNumber = `AUDIT-ROLLBACK-${suffix}`;
    await pool.query(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.resource = 'InventoryBatchReceipt' AND NEW.details LIKE '%${batchNumber}%'
          THEN RAISE EXCEPTION 'synthetic audit write rejection'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      const body = valid('3.25', batchNumber);
      const response = await request(id, body);
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('BATCH_RECEIVE_FAILED');
      expect(await state(id)).toEqual({ stock: 0, batches: [] });
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM inventory_receipt_requests WHERE facility_id=$1 AND idempotency_key=$2',
            [facility, body.idempotencyKey],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });
});
