/** Authenticated HTTP tests against a disposable database with synthetic procurement data only. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('procurement workflow and supplier permissions', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;
  let tenantA: number,
    tenantB: number,
    facilityA: number,
    facilityA2: number,
    facilityB: number,
    disabledFacility: number,
    supplierA: number,
    supplierB: number;
  let creator: { id: number; token: string },
    reviewer: { id: number; token: string },
    editor: { id: number; token: string },
    reader: { id: number; token: string },
    foreign: { id: number; token: string },
    sibling: { id: number; token: string },
    disabled: { id: number; token: string },
    editorReviewer: { id: number; token: string },
    approverOnly: { id: number; token: string },
    overridden: { id: number; token: string },
    platform: { id: number; token: string };
  const call = (
    method: string,
    path: string,
    token: string | undefined,
    body?: Record<string, unknown>,
  ) => httpJson(base, method, path, { token, body });
  const fields = (label: string) => ({
    facilityId: facilityA,
    supplierId: supplierA,
    poNumber: `WF-${suffix}-${label}`,
    description: 'Synthetic purpose',
    expectedDeliveryDate: '2027-04-15',
    deliveryAddress: 'Synthetic address',
    paymentTerms: 'As quoted',
    notes: 'Synthetic note',
    taxAmount: '2.00',
    shippingAmount: '1.25',
    discountAmount: '0.50',
    totalAmount: '999.99',
    items: [
      { description: 'Boxes', quantity: '1.500', unit: 'box', unitPrice: '10.01' },
      { description: 'Tape', quantity: '2', unit: 'roll', unitPrice: '2.25' },
    ],
  });
  const create = (label: string, extra: Record<string, unknown> = {}) =>
    call('POST', '/api/purchase-orders', creator.token, { ...fields(label), ...extra });
  const detail = (id: number, token = reader.token, facilityId = facilityA) =>
    call('GET', `/api/purchase-orders/${id}?facilityId=${facilityId}`, token);
  const act = (
    id: number,
    action: 'approve' | 'reject' | 'complete' | 'cancel',
    token: string,
    revision: number,
    extra: Record<string, unknown> = {},
  ) =>
    call(
      action === 'cancel' ? 'DELETE' : 'POST',
      `/api/purchase-orders/${id}${action === 'cancel' ? '' : `/${action}`}`,
      token,
      { facilityId: facilityA, expectedRevision: revision, ...extra },
    );

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    [tenantA, tenantB] = (
      await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`, [
        `Synthetic A ${suffix}`,
        `wf-a-${suffix}`,
        `Synthetic B ${suffix}`,
        `wf-b-${suffix}`,
      ])
    ).rows.map((r) => r.id);
    [facilityA, facilityA2, facilityB, disabledFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES ($1,$2,'A',$6::jsonb),($1,$3,'A2',$6::jsonb),($4,$5,'B',$6::jsonb),($1,$7,'Disabled','[]'::jsonb) RETURNING id`,
        [
          tenantA,
          `WFA-${suffix}`,
          `WFA2-${suffix}`,
          tenantB,
          `WFB-${suffix}`,
          JSON.stringify(['procurement']),
          `WFD-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    [supplierA, supplierB] = (
      await pool.query(`INSERT INTO suppliers(tenant_id,name) VALUES($1,$2),($3,$4) RETURNING id`, [
        tenantA,
        `Supplier A ${suffix}`,
        tenantB,
        `Supplier B ${suffix}`,
      ])
    ).rows.map((r) => r.id);
    const perms = ['read', 'create', 'update', 'delete', 'approve', 'reject', 'complete'].map(
      (v) => `procurement.${v}`,
    );
    for (const code of perms)
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'procurement') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    const actor = async (tag: string, tenant: number, facility: number, grants: string[]) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `wf-${tag}-${suffix}`,
            `wf-${tag}-${suffix}@example.test`,
            `Synthetic ${tag}`,
            tenant,
            facility,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `WF_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const grant of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, `procurement.${grant}`],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };
    creator = await actor('creator', tenantA, facilityA, ['read', 'create', 'approve']);
    reviewer = await actor('reviewer', tenantA, facilityA, [
      'read',
      'approve',
      'reject',
      'complete',
      'delete',
    ]);
    editor = await actor('editor', tenantA, facilityA, ['read', 'update']);
    reader = await actor('reader', tenantA, facilityA, ['read']);
    foreign = await actor('foreign', tenantB, facilityB, [
      'read',
      'create',
      'update',
      'delete',
      'approve',
      'reject',
      'complete',
    ]);
    sibling = await actor('sibling', tenantA, facilityA2, [
      'read',
      'create',
      'update',
      'delete',
      'approve',
      'reject',
      'complete',
    ]);
    disabled = await actor('disabled', tenantA, disabledFacility, ['read', 'create']);
    editorReviewer = await actor('editreview', tenantA, facilityA, ['read', 'update', 'approve']);
    approverOnly = await actor('approveonly', tenantA, facilityA, ['approve']);
    overridden = await actor('override', tenantA, facilityA, ['read', 'approve']);
    const overrideRole = (
      await pool.query('SELECT role_id FROM user_roles WHERE user_id=$1', [overridden.id])
    ).rows[0].role_id;
    const override = (
      await pool.query(
        'INSERT INTO facility_role_permission_overrides(tenant_id,facility_id,role_id) VALUES($1,$2,$3) RETURNING id',
        [tenantA, facilityA, overrideRole],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO facility_role_permission_override_permissions(override_id,permission_id) SELECT $1,id FROM permissions WHERE code='procurement.read'`,
      [override],
    );
    const globalUser = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status) VALUES($1,$1,$2,'Synthetic platform','test-only','ACTIVE') RETURNING id`,
        [`wf-platform-${suffix}`, `wf-platform-${suffix}@example.test`],
      )
    ).rows[0].id;
    const globalRole = (
      await pool.query(
        `INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id`,
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      globalUser,
      globalRole,
    ]);
    for (const code of ['procurement.read', 'procurement.create', 'procurement.approve'])
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [globalRole, code],
      );
    platform = {
      id: globalUser,
      token: (await createSession({ userId: globalUser, securityVersion: 1 })).sessionToken,
    };

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('persists all details and computes exact totals on the server, not from a client total', async () => {
    const result = await create('complete-form', {
      orderedBy: 'Forged',
      createdByUserId: reviewer.id,
      subtotalAmount: '900.00',
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      description: 'Synthetic purpose',
      expectedDeliveryDate: '2027-04-15',
      deliveryAddress: 'Synthetic address',
      paymentTerms: 'As quoted',
      notes: 'Synthetic note',
      subtotalAmount: '19.52',
      taxAmount: '2.00',
      shippingAmount: '1.25',
      discountAmount: '0.50',
      totalAmount: '22.27',
      orderedBy: 'Synthetic creator',
      createdByUserId: creator.id,
      revision: 1,
      status: 'Pending Approval',
    });
    const stored = await detail(result.body.id);
    expect(stored.status).toBe(200);
    expect(stored.body.items).toMatchObject([
      { quantity: '1.500', unitPrice: '10.01', lineTotal: '15.02' },
      { quantity: '2.000', unitPrice: '2.25', lineTotal: '4.50' },
    ]);
    expect(stored.body.events).toMatchObject([{ eventType: 'CREATED', actorUserId: creator.id }]);
    expect(
      (
        await pool.query(
          `SELECT action FROM audit_logs WHERE resource='PurchaseOrder' AND resource_id=$1`,
          [String(result.body.id)],
        )
      ).rows,
    ).toContainEqual({ action: 'CREATE' });
  });

  it('validates lines, quantities, money, adjustments, dates and status server-side', async () => {
    const invalids: Record<string, unknown>[] = [
      { items: [] },
      { items: [{ description: 'x', unit: 'box', quantity: '-1', unitPrice: '1' }] },
      { items: [{ description: 'x', unit: 'box', quantity: '1.0001', unitPrice: '1' }] },
      { items: [{ description: 'x', unit: 'box', quantity: '1', unitPrice: '1.001' }] },
      { items: [{ description: 'x', unit: 'box', quantity: '1', unitPrice: 'NaN' }] },
      {
        items: [
          { description: 'x', unit: 'box', quantity: '999999999.999', unitPrice: '9999999999.99' },
        ],
      },
      { discountAmount: '1000.00' },
      { taxAmount: '-1' },
      { expectedDeliveryDate: '2027-02-30' },
      { status: 'Approved' },
      { approvedBy: 'Forged' },
    ];
    for (const [index, invalid] of invalids.entries())
      expect((await create(`bad-${index}`, invalid)).status, JSON.stringify(invalid)).toBe(400);
  });

  it('enforces each action permission, facility module and tenant/facility boundaries', async () => {
    const id = (await create('permissions')).body.id;
    expect((await call('POST', '/api/purchase-orders', undefined, fields('unauth'))).status).toBe(
      401,
    );
    expect(
      (await call('POST', '/api/purchase-orders', reader.token, fields('reader-create'))).status,
    ).toBe(403);
    expect(
      (
        await call('PUT', `/api/purchase-orders/${id}`, reader.token, {
          ...fields('edit'),
          expectedRevision: 1,
        })
      ).status,
    ).toBe(403);
    for (const action of ['approve', 'reject', 'complete', 'cancel'] as const)
      expect((await act(id, action, reader.token, 1, { note: 'test' })).status, action).toBe(403);
    expect(
      (
        await call('POST', '/api/suppliers', reader.token, {
          facilityId: facilityA,
          name: 'forbidden',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('PUT', `/api/suppliers/${supplierA}`, reader.token, {
          facilityId: facilityA,
          name: 'forbidden',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('DELETE', `/api/suppliers/${supplierA}`, reader.token, {
          facilityId: facilityA,
          note: 'test',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', '/api/purchase-orders', disabled.token, {
          ...fields('disabled'),
          facilityId: disabledFacility,
        })
      ).body.error,
    ).toBe('FACILITY_MODULE_DISABLED');
    expect((await detail(id, foreign.token, facilityB)).status).toBe(404);
    expect((await detail(id, sibling.token, facilityA2)).status).toBe(404);
    expect((await detail(id, creator.token, facilityB)).status).toBe(403);
    // Individual foreign keys do not prevent mismatched legacy tenant/facility pairs.
    // Neither the list nor the detail endpoint may disclose such an inconsistent row.
    const inconsistent = (
      await pool.query(
        `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount) VALUES($1,$2,$3,$4,'1.00') RETURNING id`,
        [tenantB, facilityA, supplierB, `WF-${suffix}-inconsistent`],
      )
    ).rows[0].id;
    const list = await call('GET', `/api/purchase-orders?facilityId=${facilityA}`, reader.token);
    expect(list.status).toBe(200);
    expect(list.body.some((order: { id: number }) => order.id === inconsistent)).toBe(false);
    expect((await detail(inconsistent)).status).toBe(404);
    expect((await create('foreign-supplier', { supplierId: supplierB })).status).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/api/suppliers?facilityId=${facilityB}&tenantId=${tenantA}`,
          foreign.token,
        )
      ).status,
    ).toBe(403);
    expect((await act(id, 'approve', approverOnly.token, 1)).status).toBe(403);
    expect((await act(id, 'approve', overridden.token, 1)).status).toBe(403);
    expect(
      (await call('GET', `/api/purchase-orders?facilityId=${facilityA}`, platform.token)).body
        .error,
    ).toBe('FACILITY_PROCUREMENT_USER_REQUIRED');
    expect(
      (await call('POST', '/api/purchase-orders', platform.token, fields('platform'))).body.error,
    ).toBe('FACILITY_PROCUREMENT_USER_REQUIRED');
  });

  it('retains old lines and field values on pending edits, rejecting stale revisions', async () => {
    const id = (await create('edit')).body.id;
    const updated = await call('PUT', `/api/purchase-orders/${id}`, editor.token, {
      ...fields('edited-number'),
      expectedRevision: 1,
      description: 'Changed purpose',
      items: [{ description: 'Changed item', quantity: '3', unit: 'piece', unitPrice: '4.00' }],
      status: 'Approved',
      approvedBy: 'Forged',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      status: 'Pending Approval',
      approvedBy: null,
      totalAmount: '14.75',
      revision: 2,
    });
    const view = await detail(id);
    expect(view.body.items).toMatchObject([{ description: 'Changed item', lineTotal: '12.00' }]);
    expect(view.body.events[1]).toMatchObject({
      eventType: 'UPDATED',
      actorUserId: editor.id,
      details: {
        before: {
          description: 'Synthetic purpose',
          items: [{ description: 'Boxes' }, { description: 'Tape' }],
        },
      },
    });
    expect(
      (
        await pool.query(
          'SELECT is_active FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id',
          [id],
        )
      ).rows,
    ).toEqual([{ is_active: false }, { is_active: false }, { is_active: true }]);
    expect(
      (
        await call('PUT', `/api/purchase-orders/${id}`, editor.token, {
          ...fields('stale'),
          expectedRevision: 1,
        })
      ).body.error,
    ).toBe('STALE_PURCHASE_ORDER');
  });

  it('requires a different approver, serializes racing transitions and restricts completion', async () => {
    const stockId = (
      await pool.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,current_stock) VALUES($1,$2,'Synthetic unrelated stock',37) RETURNING id`,
        [facilityA, `STOCK-${suffix}`],
      )
    ).rows[0].id;
    const id = (await create('race')).body.id;
    expect((await act(id, 'approve', creator.token, 1)).body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    const race = await Promise.all([
      act(id, 'approve', reviewer.token, 1),
      act(id, 'approve', reviewer.token, 1),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await detail(id)).body.events.filter(
        (e: { eventType: string }) => e.eventType === 'APPROVE',
      ),
    ).toHaveLength(1);
    expect(
      (
        await call('PUT', `/api/purchase-orders/${id}`, editor.token, {
          ...fields('too-late'),
          expectedRevision: 2,
        })
      ).body.error,
    ).toBe('INVALID_ORDER_TRANSITION');
    expect((await act(id, 'complete', reviewer.token, 2, { note: 'Close' })).status).toBe(400);
    expect(
      (await act(id, 'complete', reviewer.token, 2, { confirmAdministrativeCompletion: true }))
        .status,
    ).toBe(400);
    const completed = await act(id, 'complete', reviewer.token, 2, {
      note: 'Administrative closure only',
      confirmAdministrativeCompletion: true,
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      status: 'Completed',
      approvedBy: 'Synthetic reviewer',
      revision: 3,
    });
    expect(
      (
        await act(id, 'complete', reviewer.token, 3, {
          note: 'Again',
          confirmAdministrativeCompletion: true,
        })
      ).status,
    ).toBe(409);
    const view = await detail(id);
    expect(view.body.events).toMatchObject([
      { eventType: 'CREATED' },
      { eventType: 'APPROVE' },
      { eventType: 'COMPLETE', note: 'Administrative closure only' },
    ]);
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM supplier_invoices WHERE purchase_order_id=$1', [
            id,
          ])
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(37);
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM supplier_payments WHERE facility_id=$1', [
            facilityA,
          ])
        ).rows[0].count,
      ),
    ).toBe(0);
  });

  it('does not let an editor approve their own changes', async () => {
    const id = (await create('editor-sod')).body.id;
    const changed = await call('PUT', `/api/purchase-orders/${id}`, editorReviewer.token, {
      ...fields('editor-sod-changed'),
      expectedRevision: 1,
    });
    expect(changed.status).toBe(200);
    expect((await act(id, 'approve', editorReviewer.token, 2)).body.error).toBe(
      'SELF_APPROVAL_FORBIDDEN',
    );
    expect((await act(id, 'approve', reviewer.token, 2)).status).toBe(200);
  });

  it('prevents approval with an inactive supplier while retaining the order', async () => {
    const newSupplier = await call('POST', '/api/suppliers', creator.token, {
      facilityId: facilityA,
      name: `Inactive review ${suffix}`,
    });
    const id = (await create('inactive-review', { supplierId: newSupplier.body.id })).body.id;
    const removed = await call('DELETE', `/api/suppliers/${newSupplier.body.id}`, reviewer.token, {
      facilityId: facilityA,
      expectedRevision: 1,
      note: 'Not in use',
    });
    expect(removed.status).toBe(200);
    expect((await act(id, 'approve', reviewer.token, 1)).body.error).toBe('SUPPLIER_INACTIVE');
    expect((await detail(id)).body.status).toBe('Pending Approval');
  });

  it('requires itemization before approving a legacy amount-only order', async () => {
    const legacy = await call('POST', '/api/purchase-orders', creator.token, {
      facilityId: facilityA,
      supplierId: supplierA,
      poNumber: `WF-${suffix}-legacy`,
      totalAmount: '42.00',
    });
    expect(legacy.status).toBe(201);
    expect((await detail(legacy.body.id)).body.items).toEqual([]);
    expect((await act(legacy.body.id, 'approve', reviewer.token, 1)).body.error).toBe(
      'ORDER_ITEMIZATION_REQUIRED',
    );
    const itemized = await call('PUT', `/api/purchase-orders/${legacy.body.id}`, editor.token, {
      ...fields('legacy-revised'),
      expectedRevision: 1,
      items: [{ description: 'Actual item', quantity: '1', unit: 'box', unitPrice: '42' }],
      taxAmount: '0',
      shippingAmount: '0',
      discountAmount: '0',
    });
    expect(itemized.status).toBe(200);
    expect((await act(legacy.body.id, 'approve', reviewer.token, 2)).status).toBe(200);
  });

  it('records rejections and cancellations without deleting orders', async () => {
    const rejectedId = (await create('reject')).body.id;
    expect((await act(rejectedId, 'reject', reviewer.token, 1)).status).toBe(400);
    expect(
      (await act(rejectedId, 'reject', reviewer.token, 1, { note: 'Needs clarification' })).body
        .status,
    ).toBe('Rejected');
    expect((await act(rejectedId, 'approve', reviewer.token, 2)).status).toBe(409);
    const cancelledId = (await create('cancel')).body.id;
    expect((await act(cancelledId, 'cancel', reviewer.token, 1)).status).toBe(400);
    expect(
      (await act(cancelledId, 'cancel', reviewer.token, 1, { note: 'Duplicate request' })).body
        .status,
    ).toBe('Cancelled');
    const view = await detail(cancelledId);
    expect(view.body.events).toMatchObject([
      { eventType: 'CREATED' },
      { eventType: 'CANCEL', note: 'Duplicate request' },
    ]);
    expect(view.body.items).toHaveLength(2);
  });

  it('refuses edits, rejection or cancellation when a supplier invoice already references the order', async () => {
    const id = (await create('linked')).body.id;
    const account = (
      await pool.query(
        `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance) VALUES($1,$2,$3,'Synthetic','EXPENSE','OTHER','DEBIT') RETURNING id`,
        [tenantA, facilityA, `A-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO supplier_invoices(tenant_id,facility_id,supplier_id,purchase_order_id,invoice_number,invoice_date,expense_account_id,ap_account_id,subtotal_kes,total_amount_kes,balance_kes,idempotency_key) VALUES($1,$2,$3,$4,$5,'2027-01-01',$6,$6,'1','1','1',$7)`,
      [tenantA, facilityA, supplierA, id, `INV-${suffix}`, account, `key-${suffix}`],
    );
    expect(
      (
        await call('PUT', `/api/purchase-orders/${id}`, editor.token, {
          ...fields('linked-edit'),
          expectedRevision: 1,
        })
      ).body.error,
    ).toBe('PURCHASE_ORDER_LINKED');
    expect((await act(id, 'reject', reviewer.token, 1, { note: 'No' })).body.error).toBe(
      'PURCHASE_ORDER_LINKED',
    );
    expect((await act(id, 'cancel', reviewer.token, 1, { note: 'No' })).body.error).toBe(
      'PURCHASE_ORDER_LINKED',
    );
  });

  it('supports supplier CRUD with tenant scope, duplicates, revisions and non-destructive deactivation', async () => {
    const payload = {
      facilityId: facilityA,
      name: `Managed ${suffix}`,
      contactPerson: 'Contact',
      phone: '123',
      email: 'synthetic@example.test',
      kraPin: 'entered by user',
      address: 'Synthetic address',
    };
    const created = await call('POST', '/api/suppliers', creator.token, payload);
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call('POST', '/api/suppliers', creator.token, payload)).body.error).toBe(
      'SUPPLIER_NAME_EXISTS',
    );
    const duplicate = await call('POST', '/api/suppliers', creator.token, {
      ...payload,
      confirmDuplicateSupplier: true,
    });
    expect(duplicate.status).toBe(201);
    const duplicateAudit = await pool.query(
      `SELECT details FROM audit_logs WHERE resource='Supplier' AND resource_id=$1 AND action='CREATE'`,
      [String(duplicate.body.id)],
    );
    expect(duplicateAudit.rows[0].details).toMatch(/duplicate name explicitly confirmed/);
    expect(
      (
        await call('PUT', `/api/suppliers/${id}`, foreign.token, {
          ...payload,
          facilityId: facilityB,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(404);
    const updated = await call('PUT', `/api/suppliers/${id}`, editor.token, {
      ...payload,
      name: `Changed ${suffix}`,
      expectedRevision: 1,
    });
    expect(updated.body).toMatchObject({ name: `Changed ${suffix}`, revision: 2 });
    expect(
      (await call('PUT', `/api/suppliers/${id}`, editor.token, { ...payload, expectedRevision: 1 }))
        .body.error,
    ).toBe('STALE_SUPPLIER');
    const deactivated = await call('DELETE', `/api/suppliers/${id}`, reviewer.token, {
      facilityId: facilityA,
      expectedRevision: 2,
      note: 'Not currently in use',
    });
    expect(deactivated.body).toMatchObject({ isActive: false, revision: 3 });
    expect((await create('inactive', { supplierId: id })).status).toBe(404);
    const reactivated = await call('PUT', `/api/suppliers/${id}`, editor.token, {
      ...payload,
      name: `Changed ${suffix}`,
      isActive: true,
      expectedRevision: 3,
    });
    expect(reactivated.body).toMatchObject({ isActive: true, revision: 4 });
    expect(
      (
        await pool.query(
          `SELECT action FROM audit_logs WHERE resource='Supplier' AND resource_id=$1 ORDER BY id`,
          [String(id)],
        )
      ).rows.map((r) => r.action),
    ).toEqual(['CREATE', 'UPDATE', 'DEACTIVATE', 'UPDATE']);
  });
});
