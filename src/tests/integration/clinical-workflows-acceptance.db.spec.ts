/** Focused synthetic PostgreSQL acceptance, not clinical or facility sign-off. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { verifyLabResult } from '../../db/queries/laboratory.ts';
import { db, pool } from '../../db/index.ts';
import { retryChargeAttempt } from '../../billing/charge-attempts.ts';
import {
  syncMasterCatalogue,
  listMasterCatalogue,
  editMasterTariffs,
  approveMasterTariff,
} from '../../billing/master-catalogue.service.ts';
import { dispenseFefoScoped, receiveBatchScoped } from '../../inventory/inventory.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Clinical workflow boundaries (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, otherFacility: number, patient: number, encounter: number;
  let managerToken: string, limitedToken: string, otherToken: string, actorId: number;
  let base: string, close: () => Promise<void>, ctx: AuthorizationContext;
  let sequence = 0;
  const call = (method: string, path: string, token?: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, {
      token,
      body:
        path === '/api/pharmacy/dispense' && body && !('idempotencyKey' in body)
          ? { ...body, idempotencyKey: randomUUID() }
          : body,
    });
  const prescription = async (quantity: number, name = 'Synthetic medication') =>
    (
      await pool.query(
        "INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,quantity,status) VALUES($1,$2,$3,'synthetic','synthetic','synthetic',$4,'Prescribed') RETURNING id",
        [encounter, patient, name, quantity],
      )
    ).rows[0].id as number;
  const item = async (stock: number) =>
    (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,current_stock) VALUES($1,$2,'Synthetic stock item',$3) RETURNING id",
        [facility, `ITEM-${suffix}-${++sequence}`, stock],
      )
    ).rows[0].id as number;
  const configureProduct = async (id: number, fee: string) => {
    const f = { id: facility, tenantId: tenant, enabledModules: ['finance'] };
    await syncMasterCatalogue(f, actorId);
    const mapped = (
      await pool.query(
        "SELECT master_service_id FROM master_service_sources WHERE facility_id=$1 AND source_type='PHARMACY' AND source_id=$2 AND is_active",
        [facility, id],
      )
    ).rows[0];
    const row = (await listMasterCatalogue(f)).find(
      (r) => r.master.id === mapped.master_service_id,
    )!;
    const t = row.tariff!;
    const [edited] = await editMasterTariffs(f, actorId, [
      {
        tariffId: t.id,
        revision: t.revision,
        fee,
        unit: row.master.unit,
        isActive: true,
        autoBill: true,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ]);
    await approveMasterTariff(f, actorId, t.id, edited.revision, 'Synthetic review');
  };
  const batch = async (id: number, name: string, expiry: string, quantity: number) =>
    pool.query(
      'INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,$2,$3,$4)',
      [id, name, expiry, quantity],
    );
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic clinical ${suffix}`,
        `clinical-${suffix}`,
      ])
    ).rows[0].id;
    const modules = JSON.stringify([
      'registration',
      'opd',
      'pharmacy',
      'inventory',
      'laboratory',
      'finance',
    ]);
    [facility, otherFacility] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$4::jsonb),($1,$3,'Synthetic B',$4::jsonb) RETURNING id",
        [tenant, `CL-A-${suffix}`, `CL-B-${suffix}`, modules],
      )
    ).rows.map((r) => r.id);
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Patient','2000-01-01','Other') RETURNING id",
        [tenant, facility, `CP-${suffix}`],
      )
    ).rows[0].id;
    encounter = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id",
        [tenant, facility, patient],
      )
    ).rows[0].id;
    const permissions = [
      'patients.create',
      'clinical.create',
      'clinical.update',
      'billing.read',
      'billing.payments.record',
      'pharmacy.read',
      'pharmacy.dispense',
      'inventory.read',
      'inventory.manage',
      'laboratory.read',
      'laboratory.orders.create',
      'laboratory.results.enter',
      'laboratory.results.verify',
    ];
    for (const code of permissions)
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'clinical') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const actor = async (name: string, f: number, grants: string[]) => {
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id",
          [
            `clinical-${name}-${suffix}`,
            `clinical-${name}-${suffix}@example.test`,
            `Synthetic ${name}`,
            tenant,
            f,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `CL_${name}_${suffix}`],
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
    const manager = await actor('manager', facility, permissions);
    const limited = await actor('limited', facility, [
      'pharmacy.read',
      'inventory.read',
      'laboratory.read',
    ]);
    const other = await actor('other', otherFacility, permissions);
    actorId = manager.id;
    managerToken = manager.token;
    limitedToken = limited.token;
    otherToken = other.token;
    ctx = {
      userId: actorId,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [],
      isSuperAdmin: false,
    };
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('scopes medication and inventory worklists, creation and status changes to the authorized facility', async () => {
    const id = await prescription(8),
      stockId = await item(8);
    const list = await call('GET', '/api/medications', managerToken);
    expect(list.status).toBe(200);
    expect(list.body.some((r: { id: number }) => r.id === id)).toBe(true);
    const otherList = await call('GET', '/api/medications', otherToken);
    expect(otherList.status).toBe(200);
    expect(otherList.body.some((r: { id: number }) => r.id === id)).toBe(false);
    const inventory = await call('GET', '/api/inventory', otherToken);
    expect(inventory.status).toBe(200);
    expect(inventory.body.some((r: { id: number }) => r.id === stockId)).toBe(false);
    expect((await call('GET', `/api/inventory?facilityId=${facility}`, otherToken)).status).toBe(
      403,
    );
    expect(
      (
        await call('POST', '/api/inventory', otherToken, {
          facilityId: facility,
          itemCode: `DENIED-${suffix}`,
          name: 'Synthetic',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('PUT', `/api/medications/${id}/status`, managerToken, { status: 'Dispensed' }))
        .status,
    ).toBe(409);
    expect(
      (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
    ).toBe('Prescribed');
    const fake = {
      encounterId: encounter,
      patientId: patient,
      drugName: 'Synthetic medication',
      dosage: 'synthetic',
      frequency: 'synthetic',
      duration: 'synthetic',
      quantity: 8,
    };
    expect((await call('POST', '/api/medications', limitedToken, fake)).status).toBe(403);
    expect((await call('POST', '/api/medications', otherToken, fake)).status).not.toBe(201);
  });

  it('dispenses FEFO once, writes an audit, and does not use a caller-supplied price', async () => {
    const id = await prescription(8),
      stockId = await item(25);
    await batch(stockId, `EXPIRED-${suffix}`, '2000-01-01', 5);
    await batch(stockId, `EARLY-${suffix}`, '2040-01-01', 5);
    await batch(stockId, `LATE-${suffix}`, '2050-01-01', 15);
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 8,
      dispensedBy: 'Spoofed',
      drugName: 'Caller label',
      unitPrice: '999.00',
    };
    expect((await call('POST', '/api/pharmacy/dispense', limitedToken, body)).status).toBe(403);
    const response = await call('POST', '/api/pharmacy/dispense', managerToken, body);
    expect(response.status).toBe(201);
    expect(response.body.dispensedBy).toBe('Synthetic manager');
    expect(response.body.stockTracking).toBe('FEFO');
    expect(response.body.allocations.map((a: { quantity: number }) => a.quantity)).toEqual([5, 3]);
    expect(response.body.billing).toMatchObject({
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    expect((await call('POST', '/api/pharmacy/dispense', managerToken, body)).status).toBe(409);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(17);
    const lots = await pool.query(
      'SELECT batch_number,quantity_remaining FROM inventory_batches WHERE item_id=$1 ORDER BY expiry_date',
      [stockId],
    );
    expect(lots.rows.map((r) => r.quantity_remaining)).toEqual([5, 0, 12]);
    expect(
      (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
    ).toBe('Dispensed');
    expect(
      (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM audit_logs WHERE resource='PharmacyDispensation' AND resource_id=$1",
          [String(response.body.id)],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
          [response.body.id],
        )
      ).rows,
    ).toHaveLength(0);
    const pending = await pool.query(
      "SELECT reason,fallback_unit_price,service_name FROM billing_charge_attempts WHERE source_type='PHARMACY' AND source_id=$1",
      [response.body.id],
    );
    expect(pending.rows).toEqual([
      {
        reason: 'TARIFF_NOT_CONFIGURED',
        fallback_unit_price: null,
        service_name: 'Synthetic medication',
      },
    ]);
  });

  it('refuses invalid prescriptions, excess quantities and insufficient untracked stock', async () => {
    const id = await prescription(8),
      stockId = await item(8);
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 8,
    };
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          quantityDispensed: 9,
        })
      ).body.error,
    ).toBe('PRESCRIPTION_QUANTITY_EXCEEDED');
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          prescriptionId: id + 999999,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('POST', '/api/pharmacy/dispense', managerToken, { ...body, itemId: undefined }))
        .status,
    ).toBe(400);
    const insufficient = await item(3);
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          itemId: insufficient,
        })
      ).status,
    ).toBe(409);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [insufficient]))
        .rows[0].current_stock,
    ).toBe(3);
    expect(
      (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
        .rows,
    ).toHaveLength(0);
  });

  it('checks a dispensing retry identity without leaking across facility or permission boundaries', async () => {
    const id = await prescription(4),
      stockId = await item(4);
    const key = `status-${randomUUID()}`;
    const query = { facilityId: facility, idempotencyKey: key };
    expect((await call('POST', '/api/pharmacy/dispense/status', limitedToken, query)).status).toBe(
      403,
    );
    expect((await call('POST', '/api/pharmacy/dispense/status', otherToken, query)).status).toBe(
      403,
    );
    expect((await call('POST', '/api/pharmacy/dispense/status', managerToken, query)).body).toEqual(
      {
        status: 'NOT_FOUND',
      },
    );
    expect(
      (
        await call('POST', '/api/pharmacy/dispense/status', managerToken, {
          ...query,
          idempotencyKey: 'x',
        })
      ).status,
    ).toBe(400);
    const recorded = await call('POST', '/api/pharmacy/dispense', managerToken, {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 2,
      idempotencyKey: key,
    });
    expect(recorded.status).toBe(201);
    expect((await call('POST', '/api/pharmacy/dispense/status', managerToken, query)).body).toEqual(
      {
        status: 'RECORDED',
        prescriptionId: id,
        quantity: 2,
        dispensationId: recorded.body.id,
      },
    );
    expect(
      (
        await call('POST', '/api/pharmacy/dispense/status', otherToken, {
          facilityId: otherFacility,
          idempotencyKey: key,
        })
      ).body,
    ).toEqual({ status: 'NOT_FOUND' });
  });

  it('supports partial dispensing, same-key retry and a separate final fill', async () => {
    const id = await prescription(10),
      stockId = await item(15);
    await batch(stockId, `PART-${suffix}`, '2040-01-01', 15);
    const key = randomUUID();
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 4,
      idempotencyKey: key,
    };
    const [first, retry] = await Promise.all([
      call('POST', '/api/pharmacy/dispense', managerToken, body),
      call('POST', '/api/pharmacy/dispense', managerToken, body),
    ]);
    expect([first.status, retry.status]).toEqual([201, 201]);
    expect(first.body.id).toBe(retry.body.id);
    expect([first.body.replayed, retry.body.replayed].sort()).toEqual([false, true]);
    expect(first.body.allocations).toEqual(retry.body.allocations);
    expect(first.body.prescriptionComplete).toBe(false);
    expect(
      (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
    ).toBe('Partially Dispensed');
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(11);
    expect(
      (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          'SELECT quantity FROM pharmacy_dispense_allocations WHERE dispensation_id=$1',
          [first.body.id],
        )
      ).rows,
    ).toEqual([{ quantity: 4 }]);
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          quantityDispensed: 5,
        })
      ).body.error,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const list = await call('GET', '/api/medications', managerToken);
    expect(list.body.find((m: { id: number }) => m.id === id).quantityDispensed).toBe(4);
    const final = await call('POST', '/api/pharmacy/dispense', managerToken, {
      ...body,
      quantityDispensed: 6,
      idempotencyKey: randomUUID(),
    });
    expect(final.status).toBe(201);
    expect(final.body.prescriptionComplete).toBe(true);
    expect(
      (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
    ).toBe('Dispensed');
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(5);
    expect(
      (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
        .rows,
    ).toHaveLength(2);
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
  });

  it('serializes competing partial fills and refuses missing keys and product changes', async () => {
    const id = await prescription(10),
      stockId = await item(20),
      otherItem = await item(20);
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 6,
    };
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          idempotencyKey: null,
        })
      ).body.error,
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const [first, second] = await Promise.all([
      call('POST', '/api/pharmacy/dispense', managerToken, body),
      call('POST', '/api/pharmacy/dispense', managerToken, body),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(14);
    expect(
      (
        await call('POST', '/api/pharmacy/dispense', managerToken, {
          ...body,
          quantityDispensed: 4,
          itemId: otherItem,
        })
      ).body.error,
    ).toBe('PRESCRIPTION_PRODUCT_REVIEW');
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [otherItem]))
        .rows[0].current_stock,
    ).toBe(20);
  });

  it('allows authorized clinical hold, resume and discontinuation without dispensing or losing partial history', async () => {
    const id = await prescription(8),
      stockId = await item(12);
    const status = (token: string, next: string, reason = 'Synthetic clinical reason') =>
      call('PUT', `/api/medications/${id}/status`, token, { status: next, reason });
    expect((await status(limitedToken, 'On Hold')).status).toBe(403);
    expect((await status(otherToken, 'On Hold')).status).not.toBe(200);
    expect(
      (await call('PUT', `/api/medications/${id}/status`, managerToken, { status: 'On Hold' })).body
        .error,
    ).toBe('MEDICATION_REASON_REQUIRED');
    expect((await status(managerToken, 'On Hold')).body.status).toBe('On Hold');
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 4,
    };
    expect((await call('POST', '/api/pharmacy/dispense', managerToken, body)).status).toBe(409);
    expect((await status(managerToken, 'Resume')).body.status).toBe('Prescribed');
    expect((await call('POST', '/api/pharmacy/dispense', managerToken, body)).status).toBe(201);
    expect((await status(managerToken, 'Cancelled')).body.error).toBe('MEDICATION_STATE_CONFLICT');
    expect((await status(managerToken, 'On Hold')).body.status).toBe('On Hold');
    expect((await status(managerToken, 'Resume')).body.status).toBe('Partially Dispensed');
    expect((await status(managerToken, 'Discontinued')).body.status).toBe('Discontinued');
    expect((await call('POST', '/api/pharmacy/dispense', managerToken, body)).status).toBe(409);
    const events = (
      await pool.query(
        'SELECT from_status,to_status,actor_user_id FROM medication_status_events WHERE medication_id=$1 ORDER BY id',
        [id],
      )
    ).rows;
    expect(events.map((e) => e.to_status)).toEqual([
      'On Hold',
      'Prescribed',
      'On Hold',
      'Partially Dispensed',
      'Discontinued',
    ]);
    expect(events.every((e) => e.actor_user_id === actorId)).toBe(true);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(8);
  });

  it('rolls back a medication status transition when its audit fails', async () => {
    const id = await prescription(3);
    const fn = `test_med_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_med_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'Medication') EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      expect(
        (
          await call('PUT', `/api/medications/${id}/status`, managerToken, {
            status: 'On Hold',
            reason: 'Synthetic reason',
          })
        ).status,
      ).toBe(500);
      expect(
        (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
      ).toBe('Prescribed');
      expect(
        (await pool.query('SELECT id FROM medication_status_events WHERE medication_id=$1', [id]))
          .rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('does not turn an unknown stock balance into zero during receipt', async () => {
    const stockId = await item(3);
    await pool.query('UPDATE inventory_items SET current_stock=NULL WHERE id=$1', [stockId]);
    await expect(
      receiveBatchScoped(ctx, stockId, {
        batchNumber: `UNKNOWN-${suffix}`,
        expiryDate: '2099-01-01',
        quantity: 3,
        costPerUnit: '1.00',
      }),
    ).rejects.toMatchObject({ code: 'STOCK_RECONCILIATION_REQUIRED' });
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBeNull();
    expect(
      (await pool.query('SELECT id FROM inventory_batches WHERE item_id=$1', [stockId])).rows,
    ).toHaveLength(0);
  });

  it('refuses an unlinked dispense for a patient not registered or seen at this facility', async () => {
    const foreignPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other','2000-01-01','Other') RETURNING id",
        [tenant, otherFacility, `OTHER-${suffix}`],
      )
    ).rows[0].id;
    const stockId = await item(3);
    const response = await call('POST', '/api/pharmacy/dispense', managerToken, {
      patientId: foreignPatient,
      facilityId: facility,
      itemId: stockId,
      quantityDispensed: 1,
    });
    expect(response.status).not.toBe(201);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(3);
    expect(
      (
        await pool.query('SELECT id FROM pharmacy_dispensations WHERE patient_id=$1', [
          foreignPatient,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('allows only one concurrent dispensing for one prescription', async () => {
    const id = await prescription(6),
      stockId = await item(10);
    await batch(stockId, `CONCURRENT-${suffix}`, '2040-01-01', 10);
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 6,
    };
    const results = await Promise.all([
      call('POST', '/api/pharmacy/dispense', managerToken, body),
      call('POST', '/api/pharmacy/dispense', managerToken, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(4);
    expect(
      (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
        .rows,
    ).toHaveLength(1);
  });

  it('leaves durable billing work when a dispensing commits before the billing step runs', async () => {
    const id = await prescription(2, `Synthetic outbox ${suffix}`),
      stockId = await item(2);
    // Call the service directly to simulate a process stopping after its
    // clinical transaction commits but before the HTTP route prices it.
    const recorded = await dispenseFefoScoped(ctx, {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 2,
      dispensedBy: 'Synthetic',
      idempotencyKey: `outbox-${suffix}`,
    });
    const [pending] = (
      await pool.query(
        "SELECT id,reason,status,attempts,codes FROM billing_charge_attempts WHERE source_type='PHARMACY' AND source_id=$1",
        [recorded.dispensation.id],
      )
    ).rows;
    expect(pending).toMatchObject({ reason: 'BILLING_PENDING', status: 'PENDING', attempts: 0 });
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
          [recorded.dispensation.id],
        )
      ).rows,
    ).toHaveLength(0);
    await configureProduct(stockId, '2.50');
    // A changed clinical source cannot be silently repriced from the queue.
    await pool.query('UPDATE medications SET drug_name=$1 WHERE id=$2', [
      'Synthetic changed label',
      id,
    ]);
    expect(
      await retryChargeAttempt(db, {
        tenantId: tenant,
        facilityId: facility,
        attemptId: pending.id,
        actorUserId: actorId,
      }),
    ).toMatchObject({ status: 'PENDING', result: { charged: false, reason: 'INVALID_INPUT' } });
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
          [recorded.dispensation.id],
        )
      ).rows,
    ).toHaveLength(0);
    // Restore only this synthetic fixture, then retry the original source.
    await pool.query('UPDATE medications SET drug_name=$1 WHERE id=$2', [
      `Synthetic outbox ${suffix}`,
      id,
    ]);
    const retried = await retryChargeAttempt(db, {
      tenantId: tenant,
      facilityId: facility,
      attemptId: pending.id,
      actorUserId: actorId,
    });
    expect(retried).toMatchObject({
      status: 'BILLED',
      result: { charged: true, totalAmount: '5.00' },
    });
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
          [recorded.dispensation.id],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('rolls back dispensing and stock if durable billing work cannot be recorded', async () => {
    const id = await prescription(2),
      stockId = await item(2);
    const fn = `test_charge_attempt_${suffix.replaceAll('-', '')}`,
      trigger = `test_charge_attempt_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic queue failure'; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON billing_charge_attempts FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.source_type = 'PHARMACY') EXECUTE FUNCTION "${fn}"()`,
      );
      const response = await call('POST', '/api/pharmacy/dispense', managerToken, {
        prescriptionId: id,
        patientId: patient,
        itemId: stockId,
        facilityId: facility,
        quantityDispensed: 2,
      });
      expect(response.status).toBe(500);
      expect(
        (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
          .rows,
      ).toHaveLength(0);
      expect(
        (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
      ).toBe('Prescribed');
      expect(
        (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId]))
          .rows[0].current_stock,
      ).toBe(2);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON billing_charge_attempts`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('rolls back dispensing when its audit fails', async () => {
    const id = await prescription(4),
      stockId = await item(10);
    await batch(stockId, `ROLLBACK-${suffix}`, '2040-01-01', 10);
    const fn = `test_dispense_audit_${suffix.replaceAll('-', '')}`,
      trigger = `test_dispense_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'PharmacyDispensation') EXECUTE FUNCTION "${fn}"()`,
      );
      await expect(
        dispenseFefoScoped(ctx, {
          prescriptionId: id,
          patientId: patient,
          itemId: stockId,
          facilityId: facility,
          quantityDispensed: 4,
          dispensedBy: 'Synthetic',
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow();
      expect(
        (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId]))
          .rows[0].current_stock,
      ).toBe(10);
      expect(
        (
          await pool.query('SELECT quantity_remaining FROM inventory_batches WHERE item_id=$1', [
            stockId,
          ])
        ).rows[0].quantity_remaining,
      ).toBe(10);
      expect(
        (await pool.query('SELECT status FROM medications WHERE id=$1', [id])).rows[0].status,
      ).toBe('Prescribed');
      expect(
        (await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [id]))
          .rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('serializes stock receipt and dispensing with the same item-before-batch lock order', async () => {
    const id = await prescription(4),
      stockId = await item(10);
    await batch(stockId, `RECEIVE-${suffix}`, '2040-01-01', 10);
    const results = await Promise.all([
      dispenseFefoScoped(ctx, {
        prescriptionId: id,
        patientId: patient,
        itemId: stockId,
        facilityId: facility,
        quantityDispensed: 4,
        dispensedBy: 'Synthetic',
        idempotencyKey: randomUUID(),
      }),
      receiveBatchScoped(
        ctx,
        stockId,
        { batchNumber: `RECEIVE-${suffix}`, expiryDate: '2040-01-01', quantity: 3, costPerUnit: 0 },
        facility,
      ),
    ]);
    expect(results).toHaveLength(2);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [stockId])).rows[0]
        .current_stock,
    ).toBe(9);
    expect(
      (
        await pool.query('SELECT quantity_remaining FROM inventory_batches WHERE item_id=$1', [
          stockId,
        ])
      ).rows[0].quantity_remaining,
    ).toBe(9);
  });

  it('charges a configured synthetic pharmacy tariff, not a client price, exactly once', async () => {
    const id = await prescription(4, 'Priced synthetic'),
      stockId = await item(4);
    await configureProduct(stockId, '7.50');
    const body = {
      prescriptionId: id,
      patientId: patient,
      itemId: stockId,
      facilityId: facility,
      quantityDispensed: 4,
      unitPrice: '999.00',
      drugName: 'False name',
    };
    const response = await call('POST', '/api/pharmacy/dispense', managerToken, body);
    expect(response.status).toBe(201);
    expect(response.body.billing).toMatchObject({
      charged: true,
      unitPrice: '7.50',
      totalAmount: '30.00',
    });
    const lines = await pool.query(
      "SELECT total_amount,unit_price,quantity FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
      [response.body.id],
    );
    expect(lines.rows).toEqual([{ total_amount: '30.00', unit_price: '7.50', quantity: 4 }]);
    expect((await call('POST', '/api/pharmacy/dispense', managerToken, body)).status).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
          [response.body.id],
        )
      ).rows,
    ).toHaveLength(1);
    // This price belongs solely to the disposable synthetic fixture, not a real tariff schedule.
  });

  it('requires collection before result entry and prevents regression or re-accessioning', async () => {
    const order = await call('POST', '/api/lab-orders', managerToken, {
      patientId: patient,
      encounterId: encounter,
      testName: 'Synthetic guarded assay',
      specimenType: 'Synthetic',
    });
    expect(order.status).toBe(201);
    const body = {
      orderId: order.body.id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: 'Actual synthetic measurement',
    };
    const early = await call('POST', '/api/lab-results', managerToken, body);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('LAB_SPECIMEN_NOT_COLLECTED');
    expect(
      (await pool.query('SELECT id FROM lab_results WHERE order_id=$1', [order.body.id])).rows,
    ).toHaveLength(0);
    const collect = () =>
      call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
        status: 'Sample Collected',
      });
    const [first, retry] = await Promise.all([collect(), collect()]);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(first.body.sampleAccessionNumber).toMatch(/^JC-/);
    expect(retry.body.sampleAccessionNumber).toBe(first.body.sampleAccessionNumber);
    expect(
      (
        await call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
          status: 'Ordered',
        })
      ).body.error,
    ).toBe('LAB_STATE_CONFLICT');
    expect(
      (
        await call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
          status: 'Sample Collected',
          accessionNumber: 'Different synthetic accession',
        })
      ).body.error,
    ).toBe('LAB_ACCESSION_CHANGE_REQUIRES_REVIEW');
    expect(
      (
        await pool.query("SELECT id FROM audit_logs WHERE resource='LabOrder' AND resource_id=$1", [
          String(order.body.id),
        ])
      ).rows,
    ).toHaveLength(1);
    const entered = await call('POST', '/api/lab-results', managerToken, body);
    expect(entered.status).toBe(201);
    expect(
      (
        await pool.query(
          "SELECT id FROM audit_logs WHERE resource='LabResult' AND resource_id=$1 AND action='CREATE'",
          [String(entered.body.id)],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('prevents concurrent duplicate accessions within a facility', async () => {
    const make = () =>
      call('POST', '/api/lab-orders', managerToken, {
        patientId: patient,
        encounterId: encounter,
        testName: 'Synthetic duplicate accession',
        specimenType: 'Synthetic',
      });
    const [one, two] = await Promise.all([make(), make()]);
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    const accession = `ACC-DUP-${suffix}`;
    const [first, second] = await Promise.all([
      call('PUT', `/api/lab-orders/${one.body.id}/status`, managerToken, {
        status: 'Sample Collected',
        accessionNumber: accession,
      }),
      call('PUT', `/api/lab-orders/${two.body.id}/status`, managerToken, {
        status: 'Sample Collected',
        accessionNumber: ` ${accession.toLowerCase()} `,
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first.body.error, second.body.error]).toContain('LAB_ACCESSION_IN_USE');
    const rows = (
      await pool.query(
        'SELECT status,sample_accession_number FROM lab_orders WHERE id=ANY($1::int[])',
        [[one.body.id, two.body.id]],
      )
    ).rows;
    expect(rows.filter((r) => r.status === 'Sample Collected')).toHaveLength(1);
    expect(
      rows.filter((r) => r.status === 'Ordered' && r.sample_accession_number === null),
    ).toHaveLength(1);
  });

  it('explicitly shares one collected specimen across compatible orders without sharing across patients', async () => {
    const make = (type = 'Synthetic blood') =>
      call('POST', '/api/lab-orders', managerToken, {
        patientId: patient,
        encounterId: encounter,
        testName: 'Synthetic panel',
        specimenType: type,
      });
    const [first, second, incompatible] = await Promise.all([
      make(),
      make(),
      make('Synthetic urine'),
    ]);
    expect([first.status, second.status, incompatible.status]).toEqual([201, 201, 201]);
    const collected = await call('PUT', `/api/lab-orders/${first.body.id}/status`, managerToken, {
      status: 'Sample Collected',
    });
    expect(collected.status).toBe(200);
    const linked = await call('PUT', `/api/lab-orders/${second.body.id}/status`, managerToken, {
      status: 'Sample Collected',
      sharedOrderId: first.body.id,
    });
    expect(linked.status).toBe(200);
    expect(linked.body.sampleAccessionNumber).toBe(collected.body.sampleAccessionNumber);
    expect(linked.body.sampleCollectedAt).toBe(collected.body.sampleCollectedAt);
    expect(
      (
        await call('PUT', `/api/lab-orders/${second.body.id}/status`, managerToken, {
          status: 'Sample Collected',
          sharedOrderId: first.body.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PUT', `/api/lab-orders/${incompatible.body.id}/status`, managerToken, {
          status: 'Sample Collected',
          sharedOrderId: first.body.id,
        })
      ).body.error,
    ).toBe('LAB_SHARED_SPECIMEN_REVIEW');
    const orders = await call('GET', '/api/lab-orders', managerToken);
    const ids = orders.body.filter((r: { id: number }) =>
      [first.body.id, second.body.id].includes(r.id),
    );
    expect(ids).toHaveLength(2);
    expect(ids[0].specimenId).toBe(ids[1].specimenId);
    const patientB = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other','2000-01-01','Other') RETURNING id",
        [tenant, facility, `SHARED-${suffix}`],
      )
    ).rows[0].id;
    const otherOrder = (
      await pool.query(
        "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,specimen_type) VALUES($1,$2,$3,'Synthetic','Ordered','Synthetic blood') RETURNING id",
        [tenant, facility, patientB],
      )
    ).rows[0].id;
    expect(
      (
        await call('PUT', `/api/lab-orders/${otherOrder}/status`, managerToken, {
          status: 'Sample Collected',
          sharedOrderId: first.body.id,
        })
      ).body.error,
    ).toBe('LAB_SHARED_SPECIMEN_REVIEW');
    await expect(
      pool.query('UPDATE lab_orders SET sample_accession_number=$1 WHERE id=$2', [
        collected.body.sampleAccessionNumber,
        otherOrder,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(
      (await pool.query('SELECT sample_accession_number FROM lab_orders WHERE id=$1', [otherOrder]))
        .rows[0].sample_accession_number,
    ).toBeNull();
  });

  it('rolls back collection, result entry and verification if their audit cannot be saved', async () => {
    const order = await call('POST', '/api/lab-orders', managerToken, {
      patientId: patient,
      encounterId: encounter,
      testName: 'Synthetic audit test',
      specimenType: 'Synthetic',
    });
    expect(order.status).toBe(201);
    const fn = `test_lab_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_lab_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    const enable = async (resource: string, action: string) =>
      pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = '${resource}' AND NEW.action = '${action}') EXECUTE FUNCTION "${fn}"()`,
      );
    const disable = async () => pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
    try {
      await enable('LabOrder', 'UPDATE');
      expect(
        (
          await call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
            status: 'Sample Collected',
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await pool.query('SELECT status,sample_accession_number FROM lab_orders WHERE id=$1', [
            order.body.id,
          ])
        ).rows[0],
      ).toEqual({ status: 'Ordered', sample_accession_number: null });
      await disable();
      expect(
        (
          await call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
            status: 'Sample Collected',
          })
        ).status,
      ).toBe(200);
      const body = {
        orderId: order.body.id,
        patientId: patient,
        parameterName: 'Synthetic',
        measuredValue: 'Synthetic',
      };
      await enable('LabResult', 'CREATE');
      expect((await call('POST', '/api/lab-results', managerToken, body)).status).toBe(500);
      expect(
        (await pool.query('SELECT id FROM lab_results WHERE order_id=$1', [order.body.id])).rows,
      ).toHaveLength(0);
      await disable();
      const result = await call('POST', '/api/lab-results', managerToken, body);
      expect(result.status).toBe(201);
      await enable('LabResult', 'UPDATE');
      expect(
        (await call('POST', `/api/lab-results/${result.body.id}/verify`, managerToken, {})).status,
      ).toBe(500);
      expect(
        (
          await pool.query('SELECT status,verified_by,verified_at FROM lab_results WHERE id=$1', [
            result.body.id,
          ])
        ).rows[0],
      ).toEqual({ status: 'Pending Verification', verified_by: null, verified_at: null });
    } finally {
      await disable();
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('scopes the laboratory catalogue to the authorized facility', async () => {
    const codes = [`LAB-A-${suffix}`, `LAB-B-${suffix}`];
    await pool.query(
      "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,$2,'Synthetic A'),($3,$4,'Synthetic B')",
      [facility, codes[0], otherFacility, codes[1]],
    );
    const local = await call('GET', '/api/lab-tests', managerToken);
    expect(local.status).toBe(200);
    expect(local.body.map((r: { code: string }) => r.code)).toContain(codes[0]);
    expect(local.body.map((r: { code: string }) => r.code)).not.toContain(codes[1]);
    expect(
      (await call('GET', `/api/lab-tests?facilityId=${otherFacility}`, managerToken)).status,
    ).toBe(403);
  });

  it('orders, collects, records and verifies a synthetic lab result; concurrent verifiers cannot overwrite it', async () => {
    const order = await call('POST', '/api/lab-orders', managerToken, {
      patientId: patient,
      encounterId: encounter,
      testName: 'Synthetic assay',
      specimenType: 'Synthetic specimen',
      clinicalIndication: 'Synthetic request',
    });
    expect(order.status).toBe(201);
    expect(order.body.status).toBe('Ordered');
    expect(order.body.billing).toBeNull();
    const collected = await call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
      status: 'Sample Collected',
      accessionNumber: `SYN-${suffix}`,
    });
    expect(collected.status).toBe(200);
    expect(collected.body.sampleAccessionNumber).toBe(`SYN-${suffix}`);
    const result = await call('POST', '/api/lab-results', managerToken, {
      orderId: order.body.id,
      patientId: patient,
      parameterName: 'Synthetic parameter',
      measuredValue: 'Synthetic value',
    });
    expect(result.status).toBe(201);
    expect(result.body.status).toBe('Pending Verification');
    expect(
      (await call('POST', `/api/lab-results/${result.body.id}/verify`, limitedToken, {})).status,
    ).toBe(403);
    expect(
      (await call('POST', `/api/lab-results/${result.body.id}/verify`, otherToken, {})).status,
    ).not.toBe(200);
    const checks = await Promise.allSettled([
      verifyLabResult(ctx, result.body.id, 'Synthetic verifier A'),
      verifyLabResult(ctx, result.body.id, 'Synthetic verifier B'),
    ]);
    expect(checks.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(checks.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const stored = (
      await pool.query('SELECT status,verified_by,verified_at FROM lab_results WHERE id=$1', [
        result.body.id,
      ])
    ).rows[0];
    expect(stored.status).toBe('Verified');
    expect(['Synthetic verifier A', 'Synthetic verifier B']).toContain(stored.verified_by);
    expect(stored.verified_at).not.toBeNull();
    const results = await call('GET', `/api/lab-results?orderId=${order.body.id}`, managerToken);
    expect(results.status).toBe(200);
    expect(
      results.body.some(
        (r: { id: number; status: string }) => r.id === result.body.id && r.status === 'Verified',
      ),
    ).toBe(true);
  });

  it('exercises a synthetic API path from registration through OPD, lab, pharmacy and a cash receipt', async () => {
    const createdPatient = await call('POST', '/api/patients', managerToken, {
      registrationFacilityId: facility,
      firstName: 'Synthetic',
      lastName: 'Journey',
      dateOfBirth: '2000-01-01',
      gender: 'Other',
    });
    expect(createdPatient.status).toBe(201);
    const patientId = createdPatient.body.id;
    const visit = await call('POST', '/api/encounters', managerToken, {
      facilityId: facility,
      patientId,
      encounterType: 'OUTPATIENT',
    });
    expect(visit.status).toBe(201);
    expect(visit.body.patientId).toBe(patientId);
    expect(visit.body.billing).toBeNull();
    const encounterId = visit.body.id;

    const order = await call('POST', '/api/lab-orders', managerToken, {
      encounterId,
      patientId,
      testName: 'Synthetic journey assay',
      specimenType: 'Synthetic specimen',
    });
    expect(order.status).toBe(201);
    expect(order.body.billing).toBeNull();
    expect(
      (
        await call('PUT', `/api/lab-orders/${order.body.id}/status`, managerToken, {
          status: 'Sample Collected',
          accessionNumber: `JOURNEY-${suffix}`,
        })
      ).status,
    ).toBe(200);
    const labResult = await call('POST', '/api/lab-results', managerToken, {
      orderId: order.body.id,
      patientId,
      parameterName: 'Synthetic parameter',
      measuredValue: 'Synthetic result',
    });
    expect(labResult.status).toBe(201);
    const verified = await call(
      'POST',
      `/api/lab-results/${labResult.body.id}/verify`,
      managerToken,
      {},
    );
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe('Verified');
    // An explicit completion (not ordering or single-result verification) creates billing work.
    const complete = await call(
      'POST',
      `/api/lab-orders/${order.body.id}/complete`,
      managerToken,
      {},
    );
    expect(complete.status).toBe(200);
    expect(complete.body.billing).toMatchObject({
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      diagnosis: { code: 'CATALOGUE_NOT_FOUND' },
    });
    const visitCompleted = await call('PUT', `/api/encounters/${encounterId}`, managerToken, {
      status: 'Completed',
    });
    expect(visitCompleted.status).toBe(200);
    expect(visitCompleted.body.billing).toMatchObject({
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });

    const medication = await call('POST', '/api/medications', managerToken, {
      encounterId,
      patientId,
      drugName: 'Synthetic journey medication',
      dosage: 'Synthetic',
      frequency: 'Synthetic',
      duration: 'Synthetic',
      quantity: 4,
    });
    expect(medication.status).toBe(201);
    expect(medication.body.status).toBe('Prescribed');
    const itemId = await item(10);
    await batch(itemId, `JOURNEY-${suffix}`, '2099-01-01', 10);
    await configureProduct(itemId, '7.50');
    const dispensed = await call('POST', '/api/pharmacy/dispense', managerToken, {
      facilityId: facility,
      prescriptionId: medication.body.id,
      patientId,
      itemId,
      quantityDispensed: 4,
    });
    expect(dispensed.status).toBe(201);
    expect(dispensed.body.billing).toMatchObject({ charged: true, totalAmount: '30.00' });
    const invoiceId = dispensed.body.billing.invoiceId;
    expect(Number.isSafeInteger(invoiceId)).toBe(true);
    const receipt = await call('POST', '/api/billing/payments', managerToken, {
      facilityId: facility,
      invoiceId,
      amount: '30.00',
      paymentMethod: 'Cash',
    });
    expect(receipt.status).toBe(201);
    expect(receipt.body.invoice).toMatchObject({
      paidAmount: '30.00',
      balanceAmount: '0.00',
      status: 'Paid',
    });
    expect(receipt.body.payment.receiptNumber).toBeTruthy();
    expect(
      (await pool.query('SELECT patient_id FROM billing_invoices WHERE id=$1', [invoiceId])).rows[0]
        .patient_id,
    ).toBe(patientId);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId])).rows[0]
        .current_stock,
    ).toBe(6);
    // This is one synthetic HTTP path, not clinical sign-off or evidence of real tariffs.
  });
});
