/** Synthetic authenticated HTTP requests against a disposable PostgreSQL database. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('purchase orders with existing or newly entered suppliers', () => {
  const suffix = randomUUID().slice(0, 8);
  let base = '';
  let close: () => Promise<void>;
  let tenantA: number;
  let tenantB: number;
  let facilityA: number;
  let facilityB: number;
  let disabledFacility: number;
  let existingA: number;
  let foreignB: number;
  let actorA: { token: string; id: number };
  let actorB: { token: string; id: number };
  let reader: { token: string; id: number };
  let creatorOnly: { token: string; id: number };
  let disabled: { token: string; id: number };

  const post = (token: string | undefined, body: Record<string, unknown>) =>
    httpJson(base, 'POST', '/api/purchase-orders', { token, body });
  const order = (facilityId: number, label: string) => ({
    facilityId,
    poNumber: `PROC-${suffix}-${label}`,
    totalAmount: '123.45',
    status: 'Pending Approval',
    orderedBy: 'Synthetic procurement staff',
  });
  const supplierCount = async (tenantId: number, name: string) =>
    Number(
      (
        await pool.query(
          'SELECT count(*) AS count FROM suppliers WHERE tenant_id=$1 AND lower(name)=lower($2)',
          [tenantId, name],
        )
      ).rows[0].count,
    );

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test')) {
      throw new Error('A disposable test database is required.');
    }
    const tenants = await pool.query(
      'INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id',
      [
        `Procurement A ${suffix}`,
        `proc-a-${suffix}`,
        `Procurement B ${suffix}`,
        `proc-b-${suffix}`,
      ],
    );
    [tenantA, tenantB] = tenants.rows.map((row) => row.id);
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
       VALUES($1,$2,'Synthetic A',$5::jsonb),($3,$4,'Synthetic B',$5::jsonb),($1,$6,'Disabled','[]'::jsonb)
       RETURNING id`,
      [
        tenantA,
        `PA-${suffix}`,
        tenantB,
        `PB-${suffix}`,
        JSON.stringify(['procurement']),
        `PD-${suffix}`,
      ],
    );
    [facilityA, facilityB, disabledFacility] = facilities.rows.map((row) => row.id);

    for (const permission of ['procurement.read', 'procurement.create']) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'procurement') ON CONFLICT(code) DO NOTHING`,
        [permission],
      );
    }
    const createActor = async (tag: string, tenant: number, facility: number, grants: string[]) => {
      const user = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic user','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`proc-${tag}-${suffix}`, `proc-${tag}-${suffix}@example.test`, tenant, facility],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `PROC_${tag}_${suffix}`],
        )
      ).rows[0].id as number;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
      for (const grant of grants) {
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, grant],
        );
      }
      return {
        id: user,
        token: (await createSession({ userId: user, securityVersion: 1 })).sessionToken,
      };
    };
    actorA = await createActor('a', tenantA, facilityA, ['procurement.read', 'procurement.create']);
    actorB = await createActor('b', tenantB, facilityB, ['procurement.read', 'procurement.create']);
    reader = await createActor('read', tenantA, facilityA, ['procurement.read']);
    creatorOnly = await createActor('create-only', tenantA, facilityA, ['procurement.create']);
    disabled = await createActor('disabled', tenantA, disabledFacility, [
      'procurement.read',
      'procurement.create',
    ]);

    existingA = (
      await pool.query('INSERT INTO suppliers(tenant_id,name) VALUES($1,$2) RETURNING id', [
        tenantA,
        `Existing ${suffix}`,
      ])
    ).rows[0].id;
    const { createApp } = await import('../../app.ts');
    const started = await startTestServer(await createApp());
    base = started.baseUrl;
    close = started.close;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('accepts a typed supplier when the tenant has none, and links and audits the real record', async () => {
    const before = await httpJson(
      base,
      'GET',
      `/api/suppliers?tenantId=${tenantB}&facilityId=${facilityB}`,
      {
        token: actorB.token,
      },
    );
    expect(before.status).toBe(200);
    expect(before.body).toEqual([]);

    const name = `New supplier ${suffix}`;
    const result = await post(actorB.token, {
      ...order(facilityB, 'new'),
      tenantId: tenantA, // The facility's tenant, not a client-supplied tenant, is authoritative.
      supplierName: `  ${name}  `,
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      tenantId: tenantB,
      facilityId: facilityB,
      status: 'Pending Approval',
    });
    foreignB = result.body.supplierId;

    const supplier = (await pool.query('SELECT * FROM suppliers WHERE id=$1', [foreignB])).rows[0];
    expect(supplier).toMatchObject({
      tenant_id: tenantB,
      name,
      contact_person: null,
      phone: null,
      email: null,
      kra_pin: null,
      address: null,
    });
    const audit = (
      await pool.query(
        `SELECT tenant_id,facility_id,user_id,action,resource,resource_id,details FROM audit_logs
       WHERE resource='Supplier' AND resource_id=$1`,
        [String(foreignB)],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenant_id: tenantB,
      facility_id: facilityB,
      user_id: String(actorB.id),
      action: 'CREATE',
      details: 'Supplier created with a purchase order.',
    });
    const after = await httpJson(
      base,
      'GET',
      `/api/suppliers?tenantId=${tenantB}&facilityId=${facilityB}`,
      {
        token: actorB.token,
      },
    );
    expect(after.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: foreignB, name })]),
    );
  });

  it('continues to accept existing supplier IDs, but never links a supplier from another tenant', async () => {
    const result = await post(actorA.token, {
      ...order(facilityA, 'existing'),
      supplierId: existingA,
    });
    expect(result.status).toBe(201);
    expect(result.body.supplierId).toBe(existingA);

    const crossTenant = await post(actorA.token, {
      ...order(facilityA, 'foreign'),
      supplierId: foreignB,
    });
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.error).toBe('SUPPLIER_NOT_FOUND');
    const missing = await post(actorA.token, {
      ...order(facilityA, 'missing'),
      supplierId: 99999999,
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(crossTenant.body);
    const count = await pool.query('SELECT count(*) FROM purchase_orders WHERE po_number=$1', [
      order(facilityA, 'foreign').poNumber,
    ]);
    expect(Number(count.rows[0].count)).toBe(0);
  });

  it('rejects unauthenticated, unpermitted, disabled-module and out-of-facility writes', async () => {
    const payload = { ...order(facilityA, 'denied'), supplierName: `Denied ${suffix}` };
    expect((await post(undefined, payload)).status).toBe(401);
    expect((await post(reader.token, payload)).status).toBe(403);
    const moduleDisabled = await post(disabled.token, { ...payload, facilityId: disabledFacility });
    expect(moduleDisabled.status).toBe(403);
    expect(moduleDisabled.body.error).toBe('FACILITY_MODULE_DISABLED');
    expect((await post(actorA.token, { ...payload, facilityId: facilityB })).status).toBe(403);
    expect(await supplierCount(tenantA, `Denied ${suffix}`)).toBe(0);
  });

  it('retains procurement.create as the permission for a new-supplier order', async () => {
    const result = await post(creatorOnly.token, {
      ...order(facilityA, 'create-only'),
      supplierName: `Create permission ${suffix}`,
    });
    expect(result.status).toBe(201);
    const list = await httpJson(
      base,
      'GET',
      `/api/suppliers?tenantId=${tenantA}&facilityId=${facilityA}`,
      {
        token: creatorOnly.token,
      },
    );
    expect(list.status).toBe(403);
  });

  it('does not let the create permission fabricate approval or overwrite server-managed fields', async () => {
    const name = `Unapproved ${suffix}`;
    const approved = await post(actorA.token, {
      ...order(facilityA, 'fake-approval'),
      supplierName: name,
      status: 'Approved',
      approvedBy: 'Synthetic approver',
    });
    expect(approved.status).toBe(400);
    expect(approved.body.error).toBe('INVALID_PURCHASE_ORDER_STATUS');
    const approverOnly = await post(actorA.token, {
      ...order(facilityA, 'fake-approver'),
      supplierName: name,
      approvedBy: 'Synthetic approver',
    });
    expect(approverOnly.status).toBe(400);
    expect(await supplierCount(tenantA, name)).toBe(0);

    const legitimate = await post(actorA.token, {
      ...order(facilityA, 'server-fields'),
      supplierId: existingA,
      id: 99999999,
      createdAt: '2001-01-01T00:00:00.000Z',
      updatedAt: '2001-01-01T00:00:00.000Z',
    });
    expect(legitimate.status).toBe(201);
    expect(legitimate.body.id).not.toBe(99999999);
    expect(legitimate.body.createdAt).not.toMatch(/^2001-01-01/);
    expect(legitimate.body.status).toBe('Pending Approval');
    expect(legitimate.body.approvedBy).toBeNull();
  });

  it('validates exactly one supplier choice and refuses empty, oversized and malformed names', async () => {
    const baseOrder = order(facilityA, 'invalid');
    const invalidChoices: Record<string, unknown>[] = [
      {},
      { supplierName: '' },
      { supplierName: '  ' },
      { supplierName: 'a'.repeat(201) },
      { supplierName: 'bad\u0000name' },
      { supplierName: 123 },
      { supplierId: 0 },
      { supplierId: 'not-a-number' },
      { supplierId: existingA, supplierName: 'Both' },
      { supplierName: 'Valid', confirmDuplicateSupplier: 'yes' },
    ];
    for (const choice of invalidChoices) {
      const result = await post(actorA.token, { ...baseOrder, ...choice });
      expect(result.status, JSON.stringify(choice)).toBe(400);
      expect(result.body.error).toBe('INVALID_SUPPLIER');
    }
    const noNumber = await post(actorA.token, {
      ...baseOrder,
      poNumber: '  ',
      supplierName: 'Valid',
    });
    expect(noNumber.status).toBe(400);
    expect(noNumber.body.error).toBe('INVALID_PURCHASE_ORDER');
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM purchase_orders WHERE po_number=$1', [
            baseOrder.poNumber,
          ])
        ).rows[0].count,
      ),
    ).toBe(0);
  });

  it('warns about matching names without silently linking them, and permits an explicit separate record', async () => {
    const name = `existing ${suffix.toUpperCase()}`;
    const payload = { ...order(facilityA, 'same-name'), supplierName: `  ${name}  ` };
    const warning = await post(actorA.token, payload);
    expect(warning.status).toBe(409);
    expect(warning.body.error).toBe('SUPPLIER_NAME_EXISTS');
    expect(await supplierCount(tenantA, name)).toBe(1);

    const confirmed = await post(actorA.token, { ...payload, confirmDuplicateSupplier: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.supplierId).not.toBe(existingA);
    expect(await supplierCount(tenantA, name)).toBe(2);
    const audit = await pool.query(
      `SELECT details FROM audit_logs WHERE resource='Supplier' AND resource_id=$1`,
      [String(confirmed.body.supplierId)],
    );
    expect(audit.rows[0].details).toMatch(/duplicate name explicitly confirmed/i);

    // A matching name in another tenant is not the same record and must not block creation.
    const otherTenant = await post(actorB.token, {
      ...order(facilityB, 'same-name-other-tenant'),
      supplierName: name,
    });
    expect(otherTenant.status).toBe(201);
    expect(await supplierCount(tenantB, name)).toBe(1);
  });

  it('rolls back a new supplier when the purchase-order insert fails', async () => {
    const name = `Rollback ${suffix}`;
    const result = await post(actorA.token, {
      ...order(facilityA, 'rollback'),
      totalAmount: 'not-a-number',
      supplierName: name,
    });
    expect(result.status).toBe(500);
    expect(await supplierCount(tenantA, name)).toBe(0);
    const orders = await pool.query('SELECT count(*) FROM purchase_orders WHERE po_number=$1', [
      order(facilityA, 'rollback').poNumber,
    ]);
    expect(Number(orders.rows[0].count)).toBe(0);
  });

  it('does not duplicate a supplier or order on a repeated submission with the same PO number', async () => {
    const name = `Retry ${suffix}`;
    const payload = { ...order(facilityA, 'retry'), supplierName: name };
    expect((await post(actorA.token, payload)).status).toBe(201);
    const repeat = await post(actorA.token, payload);
    expect(repeat.status).toBe(409);
    expect(repeat.body.error).toBe('PURCHASE_ORDER_NUMBER_IN_USE');
    expect(await supplierCount(tenantA, name)).toBe(1);
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM purchase_orders WHERE po_number=$1', [
            payload.poNumber,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
  });

  it('serializes simultaneous additions of the same supplier name', async () => {
    const name = `Concurrent supplier ${suffix}`;
    const results = await Promise.all([
      post(actorA.token, { ...order(facilityA, 'concurrent-a'), supplierName: name }),
      post(actorA.token, {
        ...order(facilityA, 'concurrent-b'),
        supplierName: ` ${name.toUpperCase()} `,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.error).toBe(
      'SUPPLIER_NAME_EXISTS',
    );
    expect(await supplierCount(tenantA, name)).toBe(1);
  });

  it('rolls back the losing supplier if concurrent requests use the same PO number', async () => {
    const first = `Concurrent first ${suffix}`;
    const second = `Concurrent second ${suffix}`;
    const payload = order(facilityA, 'same-po-race');
    const results = await Promise.all([
      post(actorA.token, { ...payload, supplierName: first }),
      post(actorA.token, { ...payload, supplierName: second }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.error).toBe(
      'PURCHASE_ORDER_NUMBER_IN_USE',
    );
    expect((await supplierCount(tenantA, first)) + (await supplierCount(tenantA, second))).toBe(1);
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM purchase_orders WHERE po_number=$1', [
            payload.poNumber,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
  });
});
