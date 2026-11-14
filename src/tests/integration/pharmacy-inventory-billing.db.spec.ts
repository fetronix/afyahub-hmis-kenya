/** Synthetic-only HTTP/PostgreSQL evidence; not clinical or facility sign-off. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
} from '../../accounting/accounting.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
import { chargeAndRecord, retryChargeAttempt } from '../../billing/charge-attempts.ts';
import { finalizeInvoice, getFinalizedInvoice } from '../../billing/finalized-invoice.service.ts';
import { getRevenueByServiceType } from '../../billing/billing.service.ts';
import { db, pool } from '../../db/index.ts';
import { calendarDateInZone } from '../../dashboard/timezone.ts';
import { dispenseFefoScoped } from '../../inventory/inventory.service.ts';
import { prepareShaClaim } from '../../insurance/eclaims/claims-workflow.service.ts';
import {
  preparePrivateInsuranceClaim,
  validatePrivateInsuranceClaimById,
} from '../../insurance/claims/private-claims.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Inventory-priced pharmacy billing (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, otherFacility: number, actor: number;
  let token: string, otherToken: string, limitedToken: string;
  let ctx: AuthorizationContext, base: string, close: () => Promise<void>;
  let sequence = 0;
  const departments = new Map<number, number>();
  const practitioners = new Map<number, number>();
  const grants = [
    'clinical.create',
    'clinical.read',
    'pharmacy.read',
    'pharmacy.dispense',
    'inventory.read',
    'inventory.manage',
    'billing.read',
    'billing.update',
    'billing.payments.record',
  ];
  const call = (method: string, path: string, body?: Record<string, unknown>, auth = token) =>
    httpJson(base, method, path, { token: auth, body });

  async function makeCase(f = facility, price = '7.50', stock = 10, quantity = 5, tracked = true) {
    const n = ++sequence;
    const patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Pharmacy','2000-01-01','Other') RETURNING id",
        [tenant, f, `PH-${suffix}-${n}`],
      )
    ).rows[0].id as number;
    const encounter = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,department_id,practitioner_id) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE',$4,$5) RETURNING id",
        [tenant, f, patient, departments.get(f), practitioners.get(f)],
      )
    ).rows[0].id as number;
    await pool.query(
      "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic diagnosis')",
      [encounter, patient],
    );
    const item = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock,selling_price,is_active) VALUES($1,$2,'Synthetic actual product','Tablet',$3,$4,true) RETURNING id",
        [f, `MED-${suffix}-${n}`, stock, price],
      )
    ).rows[0].id as number;
    if (tracked)
      await pool.query(
        "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,$2,'2099-12-31',$3)",
        [item, `VERIFIED-${n}`, stock],
      );
    const auth = f === facility ? token : otherToken;
    const prescribed = await call(
      'POST',
      '/api/medications',
      {
        encounterId: encounter,
        patientId: patient,
        drugName: 'Synthetic prescribed medicine',
        dosage: 'Synthetic',
        frequency: 'Synthetic',
        duration: 'Synthetic',
        quantity,
      },
      auth,
    );
    expect(prescribed.status, JSON.stringify(prescribed.body)).toBe(201);
    return {
      patient,
      encounter,
      item,
      prescription: prescribed.body.id as number,
      facility: f,
      auth,
    };
  }
  const dispense = (
    c: Awaited<ReturnType<typeof makeCase>>,
    quantity: number,
    key = randomUUID(),
  ) =>
    call(
      'POST',
      '/api/pharmacy/dispense',
      {
        facilityId: c.facility,
        patientId: c.patient,
        prescriptionId: c.prescription,
        itemId: c.item,
        quantityDispensed: quantity,
        idempotencyKey: key,
        unitPrice: '999.00',
        drugName: 'Caller-supplied false product',
      },
      c.auth,
    );
  async function freshItem(c: Awaited<ReturnType<typeof makeCase>>) {
    const list = await call('GET', `/api/inventory?facilityId=${c.facility}`, undefined, c.auth);
    expect(list.status).toBe(200);
    return list.body.find((i: { id: number }) => i.id === c.item);
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic pharmacy ${suffix}`,
        `pharmacy-${suffix}`,
      ])
    ).rows[0].id;
    [facility, otherFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
       VALUES($1,$2,'Synthetic A',$3,'Synthetic Road','Nyeri','0000000000','["finance","opd","pharmacy","inventory"]'),
             ($1,$4,'Synthetic B',$5,'Synthetic Road','Nyeri','0000000001','["finance","opd","pharmacy","inventory"]') RETURNING id`,
        [tenant, `PA-${suffix}`, `MFL-PA-${suffix}`, `PB-${suffix}`, `MFL-PB-${suffix}`],
      )
    ).rows.map((r) => r.id);
    for (const f of [facility, otherFacility]) {
      departments.set(
        f,
        (
          await pool.query(
            'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
            [f, 'Synthetic OPD', `P-OPD-${suffix}`],
          )
        ).rows[0].id,
      );
      practitioners.set(
        f,
        (
          await pool.query(
            'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
            [tenant, f, 'Synthetic clinician'],
          )
        ).rows[0].id,
      );
    }
    for (const code of grants)
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const makeActor = async (name: string, f: number, permissions: string[]) => {
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic pharmacist','test-only','ACTIVE',$3,$4) RETURNING id",
          [`pharm-${name}-${suffix}`, `pharm-${name}-${suffix}@example.test`, tenant, f],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `P_${name}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const code of permissions)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };
    const a = await makeActor('a', facility, grants);
    const b = await makeActor('b', otherFacility, grants);
    const limited = await makeActor('limited', facility, ['inventory.manage', 'inventory.read']);
    actor = a.id;
    token = a.token;
    otherToken = b.token;
    limitedToken = limited.token;
    ctx = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: grants,
      isSuperAdmin: false,
    };
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('records a prescription without charging or changing stock', async () => {
    const c = await makeCase();
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .current_stock,
    ).toBe(10);
    expect(
      (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [c.patient])).rows,
    ).toHaveLength(0);
    expect(
      (
        await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [
          c.prescription,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('bills the actual product and FEFO quantities at the inventory price with no tariff or automatic journal', async () => {
    const c = await makeCase(facility, '7.50', 25, 8, false);
    await pool.query(
      "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,'EXPIRED','2000-01-01',5),($1,'EARLY','2040-01-01',5),($1,'LATE','2050-01-01',15)",
      [c.item],
    );
    const before = (
      await pool.query('SELECT count(*)::int n FROM journal_entries WHERE facility_id=$1', [
        facility,
      ])
    ).rows[0].n;
    const res = await dispense(c, 8);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.billing).toMatchObject({
      charged: true,
      quantity: 8,
      unitPrice: '7.50',
      totalAmount: '60.00',
      matchRule: 'INVENTORY_SNAPSHOT',
    });
    expect(res.body.allocations.map((r: { quantity: number }) => r.quantity)).toEqual([5, 3]);
    const [line] = (
      await pool.query('SELECT * FROM billing_items WHERE source_type=$1 AND source_id=$2', [
        'PHARMACY',
        res.body.id,
      ])
    ).rows;
    expect(line).toMatchObject({
      description: 'Synthetic actual product',
      inventory_item_id: c.item,
      prescription_id: c.prescription,
      source_id: res.body.id,
      quantity: 8,
      unit_price: '7.50',
      total_amount: '60.00',
      tariff_id: null,
      tariff_code: null,
      facility_service_id: null,
      pharmacy_stock_tracking: 'FEFO',
    });
    expect(
      line.pharmacy_batch_allocations.map((b: { batchNumber: string; quantity: number }) => [
        b.batchNumber,
        b.quantity,
      ]),
    ).toEqual([
      ['EARLY', 5],
      ['LATE', 3],
    ]);
    expect(
      (
        await pool.query(
          'SELECT total_amount,balance_amount,tenant_id,facility_id,patient_id FROM billing_invoices WHERE id=$1',
          [line.invoice_id],
        )
      ).rows[0],
    ).toEqual({
      total_amount: '60.00',
      balance_amount: '60.00',
      tenant_id: tenant,
      facility_id: facility,
      patient_id: c.patient,
    });
    expect(
      (
        await pool.query(
          'SELECT quantity_remaining FROM inventory_batches WHERE item_id=$1 ORDER BY expiry_date',
          [c.item],
        )
      ).rows.map((r) => r.quantity_remaining),
    ).toEqual([5, 0, 12]);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM journal_entries WHERE facility_id=$1', [
          facility,
        ])
      ).rows[0].n,
    ).toBe(before);
  });

  it('charges partial fills at their own locked prices and permits an audited future price change', async () => {
    const c = await makeCase(facility, '7.50', 10, 5);
    const first = await dispense(c, 2);
    expect(first.body.billing).toMatchObject({ charged: true, totalAmount: '15.00' });
    const original = await freshItem(c);
    const change = await call('PUT', `/api/inventory/${c.item}/selling-price`, {
      facilityId: facility,
      sellingPrice: '12.50',
      expectedPriceRevision: original.priceRevision,
      reason: 'Synthetic approved price update',
    });
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect(
      (
        await call('PUT', `/api/inventory/${c.item}/selling-price`, {
          facilityId: facility,
          sellingPrice: '13.00',
          expectedPriceRevision: original.priceRevision,
          reason: 'Synthetic stale change',
        })
      ).body.error,
    ).toBe('INVENTORY_PRICE_CONFLICT');
    const second = await dispense(c, 3);
    expect(second.body.billing).toMatchObject({
      charged: true,
      totalAmount: '37.50',
      invoiceId: first.body.billing.invoiceId,
    });
    const lines = (
      await pool.query(
        'SELECT quantity,unit_price,total_amount FROM billing_items WHERE invoice_id=$1 ORDER BY id',
        [first.body.billing.invoiceId],
      )
    ).rows;
    expect(lines).toEqual([
      { quantity: 2, unit_price: '7.50', total_amount: '15.00' },
      { quantity: 3, unit_price: '12.50', total_amount: '37.50' },
    ]);
    expect(
      (
        await pool.query('SELECT total_amount FROM billing_invoices WHERE id=$1', [
          first.body.billing.invoiceId,
        ])
      ).rows[0].total_amount,
    ).toBe('52.50');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='InventorySellingPrice' AND resource_id=$2 AND action='UPDATE'",
          [facility, String(c.item)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('does not dispense excess, unavailable, inactive, or expired stock and never charges those attempts', async () => {
    const c = await makeCase(facility, '7.50', 5, 5, false);
    const tooMany = await dispense(c, 6);
    expect((await dispense(c, 1)).body.error).toBe('BATCH_EXPIRY_EVIDENCE_REQUIRED');
    expect(tooMany.status).toBe(409);
    await pool.query(
      "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,'ONLY-EXPIRED','2000-01-01',5)",
      [c.item],
    );
    const expired = await dispense(c, 1);
    expect(expired.body.error).toBe('INSUFFICIENT_STOCK');
    await pool.query('UPDATE inventory_items SET is_active=false WHERE id=$1', [c.item]);
    expect((await dispense(c, 1)).body.error).toBe('ITEM_NOT_FOUND');
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .current_stock,
    ).toBe(5);
    expect(
      (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [c.patient])).rows,
    ).toHaveLength(0);
    expect(
      (
        await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [
          c.prescription,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('uses the configured local expiry day and replays recorded evidence after timezone configuration changes', async () => {
    const prior = (await pool.query('SELECT timezone FROM facilities WHERE id=$1', [facility]))
      .rows[0].timezone;
    try {
      await pool.query("UPDATE facilities SET timezone='Pacific/Kiritimati' WHERE id=$1", [
        facility,
      ]);
      const c = await makeCase(facility, '7.50', 4, 2);
      const key = randomUUID();
      const first = await dispense(c, 2, key);
      expect(first.status).toBe(201);
      const recorded = (
        await pool.query(
          // The new dispense path writes a UTC instant into this legacy
          // timestamp-without-time-zone column. Read that instant explicitly
          // as UTC; node-postgres otherwise parses the wall time in process.TZ.
          // This does not reinterpret or rewrite historical dispensations.
          `SELECT dispensing_timezone_snapshot,dispensing_date_snapshot::text,
             dispensed_at AT TIME ZONE 'UTC' AS dispensed_at
           FROM pharmacy_dispensations WHERE id=$1`,
          [first.body.id],
        )
      ).rows[0];
      expect(recorded.dispensing_timezone_snapshot).toBe('Pacific/Kiritimati');
      expect(recorded.dispensing_date_snapshot).toBe(
        calendarDateInZone('Pacific/Kiritimati', recorded.dispensed_at),
      );
      await pool.query("UPDATE facilities SET timezone='Invalid/Synthetic' WHERE id=$1", [
        facility,
      ]);
      const replay = await dispense(c, 2, key);
      expect(replay.status).toBe(201);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.id).toBe(first.body.id);
      const newCase = await makeCase(facility, '7.50', 1, 1);
      expect((await dispense(newCase, 1)).body.error).toBe('FACILITY_TIMEZONE_REQUIRED');
      expect(
        (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [newCase.item]))
          .rows[0].current_stock,
      ).toBe(1);
    } finally {
      await pool.query('UPDATE facilities SET timezone=$1 WHERE id=$2', [prior, facility]);
    }
  });

  it('refuses a conflicting expiry for an existing lot without adding stock', async () => {
    const c = await makeCase(facility, '7.50', 4, 2);
    const batch = (
      await pool.query('SELECT batch_number FROM inventory_batches WHERE item_id=$1', [c.item])
    ).rows[0].batch_number;
    const res = await call('POST', `/api/inventory/${c.item}/batches`, {
      facilityId: facility,
      batchNumber: batch,
      expiryDate: '2098-12-31',
      quantity: 3,
      costPerUnit: '2.00',
      idempotencyKey: randomUUID(),
    });
    expect(res.body.error).toBe('BATCH_EXPIRY_MISMATCH');
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .current_stock,
    ).toBe(4);
    expect(
      (
        await pool.query(
          'SELECT quantity_remaining,expiry_date::text FROM inventory_batches WHERE item_id=$1',
          [c.item],
        )
      ).rows[0],
    ).toEqual({ quantity_remaining: 4, expiry_date: '2099-12-31' });
  });

  it('serializes identical HTTP retries and records one stock deduction and one invoice line', async () => {
    const c = await makeCase(facility, '9.00', 10, 4);
    const key = randomUUID();
    const results = await Promise.all([dispense(c, 4, key), dispense(c, 4, key)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(results.filter((r) => r.body.replayed)).toHaveLength(1);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .current_stock,
    ).toBe(6);
    expect(
      (
        await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [
          c.prescription,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1",
          [results[0].body.id],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('isolates facility stock and prices, including a different facility price for the same local code', async () => {
    const a = await makeCase(facility, '7.50', 4, 2);
    const b = await makeCase(otherFacility, '11.00', 4, 2);
    const code = (await pool.query('SELECT item_code FROM inventory_items WHERE id=$1', [a.item]))
      .rows[0].item_code;
    await pool.query('UPDATE inventory_items SET item_code=$1 WHERE id=$2', [code, b.item]);
    const denied = await call('POST', '/api/pharmacy/dispense', {
      facilityId: facility,
      patientId: a.patient,
      prescriptionId: a.prescription,
      itemId: b.item,
      quantityDispensed: 1,
      idempotencyKey: randomUUID(),
    });
    expect(denied.status).not.toBe(201);
    const [first, second] = await Promise.all([dispense(a, 2), dispense(b, 2)]);
    expect(first.body.billing).toMatchObject({ charged: true, totalAmount: '15.00' });
    expect(second.body.billing).toMatchObject({ charged: true, totalAmount: '22.00' });
    const foreign = await call('PUT', `/api/inventory/${b.item}/selling-price`, {
      facilityId: otherFacility,
      sellingPrice: '99.00',
      expectedPriceRevision: (await freshItem(b)).priceRevision,
      reason: 'Synthetic cross-facility attempt',
    });
    expect(foreign.status).toBe(403);
  });

  it('does not allow dispensing or price changes against an item in another tenant', async () => {
    const foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic foreign ${suffix}`,
        `foreign-ph-${suffix}`,
      ])
    ).rows[0].id;
    const foreignFacility = (
      await pool.query(
        'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,\'Synthetic foreign\',\'["inventory","pharmacy"]\') RETURNING id',
        [foreignTenant, `FOREIGN-${suffix}`],
      )
    ).rows[0].id;
    const foreignItem = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,current_stock,selling_price,is_active) VALUES($1,$2,'Synthetic foreign item',3,'5.00',true) RETURNING id",
        [foreignFacility, `FOR-${suffix}`],
      )
    ).rows[0].id;
    const c = await makeCase(facility, '7.50', 4, 2);
    const attempted = await call('POST', '/api/pharmacy/dispense', {
      facilityId: facility,
      patientId: c.patient,
      prescriptionId: c.prescription,
      itemId: foreignItem,
      quantityDispensed: 1,
      idempotencyKey: randomUUID(),
    });
    expect(attempted.status).not.toBe(201);
    const priceEdit = await call('PUT', `/api/inventory/${foreignItem}/selling-price`, {
      facilityId: facility,
      sellingPrice: '6.00',
      expectedPriceRevision: 1,
      reason: 'Synthetic out of scope',
    });
    expect(priceEdit.status).not.toBe(200);
    expect(
      (
        await pool.query('SELECT current_stock,selling_price FROM inventory_items WHERE id=$1', [
          foreignItem,
        ])
      ).rows[0],
    ).toEqual({ current_stock: 3, selling_price: '5.00' });
    expect(
      (
        await pool.query('SELECT id FROM pharmacy_dispensations WHERE prescription_id=$1', [
          c.prescription,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('never treats zero as free or reprices an unresolved dispensing when inventory changes', async () => {
    const c = await makeCase(facility, '0.00', 4, 2);
    const recorded = await dispense(c, 2);
    expect(recorded.body.billing).toMatchObject({
      charged: false,
      reason: 'INVENTORY_PRICE_REVIEW',
      diagnosis: { code: 'INVENTORY_PRICE_NOT_CONFIGURED' },
    });
    const attempt = (
      await pool.query(
        "SELECT id,status FROM billing_charge_attempts WHERE source_type='PHARMACY' AND source_id=$1",
        [recorded.body.id],
      )
    ).rows[0];
    const old = await freshItem(c);
    expect(
      (
        await call('PUT', `/api/inventory/${c.item}/selling-price`, {
          facilityId: facility,
          sellingPrice: '3.00',
          expectedPriceRevision: old.priceRevision,
          reason: 'Synthetic later configuration',
        })
      ).status,
    ).toBe(200);
    const retried = await retryChargeAttempt(db, {
      tenantId: tenant,
      facilityId: facility,
      attemptId: attempt.id,
      actorUserId: actor,
    });
    expect(retried).toMatchObject({
      status: 'PENDING',
      result: {
        charged: false,
        reason: 'INVENTORY_PRICE_REVIEW',
        diagnosis: { code: 'INVENTORY_PRICE_NOT_CONFIGURED' },
      },
    });
    expect(
      (
        await pool.query('SELECT selling_price_snapshot FROM pharmacy_dispensations WHERE id=$1', [
          recorded.body.id,
        ])
      ).rows[0].selling_price_snapshot,
    ).toBeNull();
    expect(
      (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [c.patient])).rows,
    ).toHaveLength(0);
  });

  it('recovers after stock commits without repricing from current inventory', async () => {
    const c = await makeCase(facility, '4.25', 5, 2);
    const recorded = await dispenseFefoScoped(ctx, {
      facilityId: facility,
      patientId: c.patient,
      prescriptionId: c.prescription,
      itemId: c.item,
      quantityDispensed: 2,
      dispensedBy: 'Synthetic',
      idempotencyKey: randomUUID(),
    });
    const attempt = (
      await pool.query(
        "SELECT id FROM billing_charge_attempts WHERE source_type='PHARMACY' AND source_id=$1",
        [recorded.dispensation.id],
      )
    ).rows[0];
    const old = await freshItem(c);
    expect(
      (
        await call('PUT', `/api/inventory/${c.item}/selling-price`, {
          facilityId: facility,
          sellingPrice: '19.00',
          expectedPriceRevision: old.priceRevision,
          reason: 'Synthetic later price',
        })
      ).status,
    ).toBe(200);
    const result = await retryChargeAttempt(db, {
      tenantId: tenant,
      facilityId: facility,
      attemptId: attempt.id,
      actorUserId: actor,
    });
    expect(result).toMatchObject({
      status: 'BILLED',
      result: { charged: true, unitPrice: '4.25', totalAmount: '8.50' },
    });
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .current_stock,
    ).toBe(3);
  });

  it('requires financial authority and a positive, current price change with an audit', async () => {
    const c = await makeCase();
    const current = await freshItem(c);
    const body = {
      facilityId: facility,
      sellingPrice: '5.00',
      expectedPriceRevision: current.priceRevision,
      reason: 'Synthetic price correction',
    };
    expect(
      (await call('PUT', `/api/inventory/${c.item}/selling-price`, body, limitedToken)).status,
    ).toBe(403);
    expect(
      (await call('PUT', `/api/inventory/${c.item}/selling-price`, { ...body, sellingPrice: '0' }))
        .status,
    ).toBe(400);
    expect(
      (await call('PUT', `/api/inventory/${c.item}/selling-price`, { ...body, reason: '' })).status,
    ).toBe(400);
    expect(
      (await pool.query('SELECT selling_price FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .selling_price,
    ).toBe('7.50');
    const create = {
      facilityId: facility,
      itemCode: `NEW-${suffix}`,
      name: 'Synthetic new stock',
      currentStock: 0,
    };
    expect(
      (await call('POST', '/api/inventory', { ...create, sellingPrice: '8.00' }, limitedToken))
        .status,
    ).toBe(403);
    const unpriced = await call('POST', '/api/inventory', create, limitedToken);
    expect(unpriced.status).toBe(201);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='InventorySellingPrice' AND resource_id=$2 AND action='CREATE'",
          [facility, String(unpriced.body.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    const priced = await call('POST', '/api/inventory', {
      ...create,
      itemCode: `PRICED-${suffix}`,
      sellingPrice: '8.00',
    });
    expect(priced.status, JSON.stringify(priced.body)).toBe(201);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='InventorySellingPrice' AND resource_id=$2 AND action='CREATE'",
          [facility, String(priced.body.id)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('allows only one concurrent price edit and rejects an old revision even after the price returns to its old value', async () => {
    const c = await makeCase(facility, '7.50', 5, 2);
    const initial = await freshItem(c);
    const edit = (price: string, revision: number) =>
      call('PUT', `/api/inventory/${c.item}/selling-price`, {
        facilityId: facility,
        sellingPrice: price,
        expectedPriceRevision: revision,
        reason: 'Synthetic reviewed change',
      });
    const responses = await Promise.all([
      edit('9.00', initial.priceRevision),
      edit('10.00', initial.priceRevision),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await freshItem(c);
    expect(current.priceRevision).toBe(initial.priceRevision + 1);
    expect((await edit('7.50', current.priceRevision)).status).toBe(200);
    expect((await edit('11.00', initial.priceRevision)).status).toBe(409);
    await expect(
      pool.query('UPDATE inventory_items SET selling_price=$1 WHERE id=$2', ['12.00', c.item]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='InventorySellingPrice' AND resource_id=$1 AND action='UPDATE'",
          [String(c.item)],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it('does not give a global SUPER_ADMIN facility finance permission for pricing', async () => {
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic platform','test-only','ACTIVE',NULL,NULL) RETURNING id",
        [`price-platform-${suffix}`, `price-platform-${suffix}@example.test`],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id",
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN ('inventory.manage','billing.update')",
      [role],
    );
    const platformToken = (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
    const c = await makeCase(facility, '7.50', 3, 1);
    expect(
      (
        await call(
          'PUT',
          `/api/inventory/${c.item}/selling-price`,
          {
            facilityId: facility,
            sellingPrice: '9.00',
            expectedPriceRevision: 1,
            reason: 'Synthetic unauthorized',
          },
          platformToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/api/inventory',
          {
            facilityId: facility,
            itemCode: `SUPER-${suffix}`,
            name: 'Synthetic unauthorized',
            currentStock: 0,
            sellingPrice: '9.00',
          },
          platformToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await pool.query('SELECT selling_price FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .selling_price,
    ).toBe('7.50');
  });

  it('serializes an inventory price edit with dispensing without applying a mixed price', async () => {
    const c = await makeCase(facility, '7.50', 5, 2);
    const before = await freshItem(c);
    const [change, dispensed] = await Promise.all([
      call('PUT', `/api/inventory/${c.item}/selling-price`, {
        facilityId: facility,
        sellingPrice: '11.00',
        expectedPriceRevision: before.priceRevision,
        reason: 'Synthetic concurrent price change',
      }),
      dispense(c, 2),
    ]);
    expect(dispensed.status).toBe(201);
    expect([200, 409]).toContain(change.status);
    const snapshot = (
      await pool.query('SELECT selling_price_snapshot FROM pharmacy_dispensations WHERE id=$1', [
        dispensed.body.id,
      ])
    ).rows[0].selling_price_snapshot;
    expect(['7.50', '11.00']).toContain(snapshot);
    expect(dispensed.body.billing.unitPrice).toBe(snapshot);
    expect(
      (
        await pool.query(
          'SELECT unit_price FROM billing_items WHERE source_type=$1 AND source_id=$2',
          ['PHARMACY', dispensed.body.id],
        )
      ).rows[0].unit_price,
    ).toBe(snapshot);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [c.item])).rows[0]
        .current_stock,
    ).toBe(3);
  });

  it('finalizes a verified inventory line, records a receipt, and reports pharmacy revenue without fabricating a tariff', async () => {
    const c = await makeCase(facility, '8.00', 4, 2);
    const before = await getRevenueByServiceType(db, facility);
    const dispensed = await dispense(c, 2);
    expect(dispensed.body.billing).toMatchObject({ charged: true, totalAmount: '16.00' });
    const invoiceId = dispensed.body.billing.invoiceId;
    const finalized = await finalizeInvoice(ctx, invoiceId, {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic self-pay allocation',
    });
    expect(finalized.idempotentReplay).toBe(false);
    const view = await getFinalizedInvoice(ctx, invoiceId);
    expect(view.finalized).toBe(true);
    if (!view.finalized) throw new Error('Synthetic invoice was not finalized');
    expect(view.snapshot.items[0]).toMatchObject({
      tariffId: null,
      priceSource: 'INVENTORY_SNAPSHOT',
      inventoryItemId: c.item,
      prescriptionId: c.prescription,
      dispensationId: dispensed.body.id,
      unitPrice: '8.00',
      total: '16.00',
      stockTracking: 'FEFO',
      batchAllocations: [expect.objectContaining({ expiryDate: '2099-12-31', quantity: 2 })],
    });
    const paid = await call('POST', '/api/billing/payments', {
      facilityId: facility,
      invoiceId,
      amount: '16.00',
      paymentMethod: 'Cash',
      payerParty: 'PATIENT',
      idempotencyKey: randomUUID(),
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.payment.receiptNumber).toBeTruthy();
    expect(paid.body.invoice).toMatchObject({ paidAmount: '16.00', balanceAmount: '0.00' });
    const after = await getRevenueByServiceType(db, facility);
    const revenue = (rows: typeof before) =>
      Number(
        rows.find((r) => r.sourceType === 'PHARMACY' && r.itemType === 'Pharmacy')?.revenue ?? 0,
      );
    expect(revenue(after) - revenue(before)).toBe(16);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM accounting_billing_postings WHERE facility_id=$1 AND source_id=$2',
          [facility, invoiceId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('posts a finalized medicine invoice only through the separately reviewed, balanced ledger bridge', async () => {
    const c = await makeCase(facility, '10.00', 4, 2);
    const dispensed = await dispense(c, 2);
    const invoiceId = dispensed.body.billing.invoiceId;
    await finalizeInvoice(ctx, invoiceId, {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic self-pay allocation',
    });
    const scope = { tenantId: tenant, facilityId: facility, actorUserId: actor };
    const ar = await createAccountScoped(scope, {
      accountCode: 'SYN_AR',
      accountName: 'Synthetic receivable',
      accountType: 'ASSET',
      subType: 'PATIENT_AR',
      normalBalance: 'DEBIT',
    });
    const revenue = await createAccountScoped(scope, {
      accountCode: 'SYN_MED_REVENUE',
      accountName: 'Synthetic medicine revenue',
      accountType: 'REVENUE',
      subType: 'REVENUE',
      normalBalance: 'CREDIT',
    });
    await createFinancialPeriodScoped(scope, {
      periodCode: 'SYN_MED',
      name: 'Synthetic open',
      startDate: '2000-01-01',
      endDate: '2099-12-31',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM accounting_billing_postings WHERE facility_id=$1 AND source_type='BILLING_INVOICE' AND source_id=$2",
          [facility, invoiceId],
        )
      ).rows[0].n,
    ).toBe(0);
    const input = {
      entryDate: (await pool.query('SELECT current_date::text AS date')).rows[0].date,
      description: 'Synthetic reviewed medicine invoice',
      idempotencyKey: randomUUID(),
      patientReceivableAccountId: ar.id,
      revenueAccountId: revenue.id,
    };
    const first = await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoiceId, input);
    const replay = await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoiceId, input);
    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journal.id).toBe(first.journal.id);
    const totals = (
      await pool.query(
        'SELECT sum(debit_cents)::text debit,sum(credit_cents)::text credit FROM journal_lines WHERE journal_entry_id=$1',
        [first.journal.id],
      )
    ).rows[0];
    expect(totals).toEqual({ debit: '2000', credit: '2000' });
  });

  it('keeps SHA and private payer lines unmapped rather than guessing a tariff by medicine name', async () => {
    const c = await makeCase(facility, '7.50', 4, 2);
    const dispensed = await dispense(c, 2);
    expect(dispensed.body.billing.charged).toBe(true);
    const invoiceId = dispensed.body.billing.invoiceId;
    /*
     * A claim may only be prepared from a finalized invoice (migration 0088).
     * Finalizing is the real billing workflow: somebody has to state the
     * insurer/patient split before the payer is asked anything. It does not
     * affect what this case asserts — that no payer code is invented from a
     * medicine name.
     */
    await finalizeInvoice(ctx, invoiceId, {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic pharmacy claim allocation',
    });
    // This unrelated synthetic tariff deliberately has the same description.
    const trap = (
      await pool.query(
        "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee) VALUES($1,$2,$3,'Synthetic actual product','pharmacy','Tablet','999.00') RETURNING id",
        [tenant, facility, `TRAP-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,payer_name,payer_type,integration_type,adapter_key,environment) VALUES($1,$2,'SYNTHETIC','Synthetic payer','PRIVATE_INSURER','MANUAL','manual','UNCONFIGURED'),($1,$2,'SHA','Synthetic SHA fixture','PUBLIC_SCHEME','MANUAL','manual','UNCONFIGURED') ON CONFLICT(facility_id,payer_code) DO NOTHING",
      [tenant, facility],
    );
    await pool.query(
      "INSERT INTO payer_service_code_mappings(tenant_id,facility_id,payer_code,tariff_id,local_code,local_description,service_area,payer_service_code,payer_service_name,reimbursement_tariff) VALUES($1,$2,'SYNTHETIC',$3,$4,'Synthetic unrelated tariff','PHARMACY','SYN-PAYER-CODE','Synthetic unrelated code','999.00')",
      [tenant, facility, trap, `TRAP-${suffix}`],
    );
    const policy = (
      await pool.query(
        "INSERT INTO insurance_member_policies(tenant_id,facility_id,patient_id,payer_code,member_number) VALUES($1,$2,$3,'SYNTHETIC',$4) RETURNING id",
        [tenant, facility, c.patient, `SYN-MEMBER-${suffix}`],
      )
    ).rows[0].id;
    const actorInfo = {
      tenantId: tenant,
      facilityId: facility,
      actorUserId: actor,
      actorUserUid: `pharm-a-${suffix}`,
    };
    const privateClaim = await preparePrivateInsuranceClaim({
      ...actorInfo,
      input: { invoiceId, memberPolicyId: policy, encounterId: c.encounter },
    });
    expect(privateClaim.lines[0]).toMatchObject({
      tariffId: null,
      mappingId: null,
      mappingStatus: 'UNMAPPED',
      payerServiceCode: null,
      grossAmount: '15.00',
    });
    const checked = await validatePrivateInsuranceClaimById({
      ...actorInfo,
      claimId: privateClaim.id,
    });
    expect(checked.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNMAPPED_SERVICE_LINE', severity: 'ERROR' }),
      ]),
    );
    const sha = await prepareShaClaim(
      { tenantId: tenant, facilityId: facility, userId: actor, userUid: `pharm-a-${suffix}` },
      { invoiceId, encounterId: c.encounter, schemeCode: 'SHIF' },
    );
    expect(sha.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNMAPPED_SERVICE_CODE', severity: 'ERROR' }),
      ]),
    );
    const shaLine = (
      await pool.query(
        'SELECT tariff_id,payer_service_code,facility_unit_price FROM sha_eclaim_items WHERE eclaim_id=$1',
        [sha.id],
      )
    ).rows[0];
    expect(shaLine).toEqual({
      tariff_id: null,
      payer_service_code: null,
      facility_unit_price: '7.50',
    });
  });

  it('does not invent a price for an old unlinked dispensing, and immutable new evidence resists edits', async () => {
    const c = await makeCase(facility, '15.00', 5, 2);
    const legacy = (
      await pool.query(
        "INSERT INTO pharmacy_dispensations(tenant_id,facility_id,patient_id,prescription_id,item_id,quantity_dispensed,dispensed_by) VALUES($1,$2,$3,$4,$5,1,'Synthetic legacy') RETURNING id",
        [tenant, facility, c.patient, c.prescription, c.item],
      )
    ).rows[0].id;
    const old = await chargeAndRecord(db, {
      tenantId: tenant,
      facilityId: facility,
      patientId: c.patient,
      encounterId: c.encounter,
      codes: [],
      family: 'PHARMACY',
      serviceName: 'Synthetic prescribed medicine',
      quantity: 1,
      sourceType: 'PHARMACY',
      sourceId: legacy,
      itemType: 'Pharmacy',
    });
    expect(old).toMatchObject({
      charged: false,
      reason: 'INVENTORY_PRICE_REVIEW',
      diagnosis: { code: 'DISPENSATION_EVIDENCE_MISSING' },
    });
    // Use an unrelated prescription because this deliberately inserted legacy row has no reconciled status.
    const fresh = await makeCase();
    const actual = await dispense(fresh, 1);
    await expect(
      pool.query('UPDATE pharmacy_dispensations SET selling_price_snapshot=99 WHERE id=$1', [
        actual.body.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE billing_items SET unit_price=99 WHERE source_type=$1 AND source_id=$2', [
        'PHARMACY',
        actual.body.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [c.patient])).rows,
    ).toHaveLength(0);
  });
});
