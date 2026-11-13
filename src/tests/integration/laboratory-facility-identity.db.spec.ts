import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { chargeAndRecord, recordChargeAttempt } from '../../billing/charge-attempts.ts';
import { chargeForService } from '../../billing/billing.service.ts';
import * as facilityResolver from '../../billing/facility-charge-resolver.ts';
import { labOrderChargeRequest } from '../../billing/service-charges.ts';
import { createSession } from '../../auth/session.service.ts';
import { db, pool } from '../../db/index.ts';
import * as sharedCharges from '../../routes/shared/charges.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Laboratory facility identity and invoice (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, other: number, patient: number, otherPatient: number;
  let foreignTenant: number, foreignFacility: number, foreignPatient: number;
  let base: string,
    token: string,
    otherToken: string,
    foreignToken: string,
    close: () => Promise<void>;
  let blood: {
    service: { id: number; code: string };
    tariff: { id: number; code: string; revision: number };
  };

  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });
  const makeEncounter = async (facilityId = facility, patientId = patient, session = token) => {
    const response = await call(
      'POST',
      '/api/encounters',
      {
        facilityId,
        patientId,
        encounterType: 'Outpatient',
        status: 'Active',
        idempotencyKey: randomUUID(),
      },
      session,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  };
  const createService = async (code: string, tariffCode: string, fee: string) => {
    const response = await call('POST', '/api/facility-services', {
      facilityId: facility,
      code,
      name: code === 'BLOOD01' ? 'blood test' : `Synthetic ${code}`,
      description: code === 'BLOOD01' ? 'blood test' : `Synthetic ${code}`,
      department: 'laboratory',
      category: 'LABORATORY',
      unit: 'Service',
      initialPrice: fee,
      initialTariffCode: tariffCode,
      isActive: true,
      autoBill: true,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  };
  const collectAndVerify = async (orderId: number, patientId = patient, session = token) => {
    const collected = await call(
      'PUT',
      `/api/lab-orders/${orderId}/status`,
      {
        status: 'Sample Collected',
        accessionNumber: `SYN-LAB-${randomUUID()}`,
      },
      session,
    );
    expect(collected.status, JSON.stringify(collected.body)).toBe(200);
    expect(collected.body.sampleAccessionNumber).toMatch(/^SYN-LAB-/);
    const result = await call(
      'POST',
      '/api/lab-results',
      {
        orderId,
        patientId,
        parameterName: 'Synthetic parameter',
        measuredValue: '1',
      },
      session,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const verified = await call('POST', `/api/lab-results/${result.body.id}/verify`, {}, session);
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  };
  const batch = (
    encounterId: number,
    orderLines: Array<Record<string, unknown>>,
    patientId = patient,
  ) => ({
    patientId,
    encounterId,
    orderLines,
    clinicalIndication: 'Synthetic clinical indication',
    priority: 'Routine',
    idempotencyKey: randomUUID(),
  });

  const makeVerifiedOrder = async () => {
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);
    return { visit, order };
  };

  // Pause only the original HTTP request between its committed clinical
  // transaction and real billing call. Every request and database operation
  // still executes the production path; no billing result is mocked.
  const withPausedFirstEvaluation = async <T>(
    orderId: number,
    whilePaused: (
      request: Parameters<typeof sharedCharges.chargeSafely>[0],
      attemptId: number,
    ) => Promise<T>,
  ) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notify = () => {};
    const arrived = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const captured: { request: Parameters<typeof sharedCharges.chargeSafely>[0]; id: number }[] =
      [];
    const realCharge = sharedCharges.chargeSafely;
    const spy = vi
      .spyOn(sharedCharges, 'chargeSafely')
      .mockImplementation(async (request, id, initialTariff) => {
        if (request.sourceType === 'LAB_ORDER' && request.sourceId === orderId && id != null) {
          captured.push({ request, id });
          notify();
          await gate;
        }
        return realCharge(request, id, initialTariff);
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observation!: T;
    let first!: Awaited<ReturnType<typeof call>>;
    try {
      const firstRequest = call('POST', `/api/lab-orders/${orderId}/complete`, {});
      try {
        await Promise.race([
          arrived,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Initial billing evaluator did not arrive')),
              5000,
            );
          }),
        ]);
        if (captured.length !== 1) throw new Error('Expected one initial billing evaluator');
        observation = await whilePaused(captured[0].request, captured[0].id);
      } finally {
        if (timer) clearTimeout(timer);
        release();
        first = await firstRequest;
      }
    } finally {
      spy.mockRestore();
    }
    return { first, observation };
  };

  beforeAll(async () => {
    if (
      !/synthetic.*test|test.*synthetic/i.test(process.env.SQL_DB_NAME ?? '') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    )
      throw new Error('An isolated loopback synthetic test database is required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic Laboratory ${suffix}`,
        `synthetic-lab-${suffix}`,
      ])
    ).rows[0].id;
    const modules = JSON.stringify(['registration', 'opd', 'laboratory', 'finance']);
    [facility, other] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic Lab A',$4::jsonb),($1,$3,'Synthetic Lab B',$4::jsonb) RETURNING id",
        [tenant, `SYN-A-${suffix}`, `SYN-B-${suffix}`, modules],
      )
    ).rows.map((row) => row.id);
    [patient, otherPatient] = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$4,'Synthetic','Lab A','2000-01-01','Other'),($1,$3,$5,'Synthetic','Lab B','2000-01-01','Other') RETURNING id",
        [tenant, facility, other, `SYN-LA-${suffix}`, `SYN-LB-${suffix}`],
      )
    ).rows.map((row) => row.id);
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    for (const permission of [
      'patients.read',
      'clinical.create',
      'clinical.read',
      'clinical.update',
      'laboratory.read',
      'laboratory.orders.create',
      'laboratory.results.enter',
      'laboratory.results.verify',
      'billing.read',
      'billing.create',
      'billing.update',
      'billing.payments.record',
      'tariffs.read',
      'tariffs.manage',
    ]) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, permission],
      );
    }
    foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic Other Tenant ${suffix}`,
        `synthetic-other-${suffix}`,
      ])
    ).rows[0].id;
    foreignFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic Other Tenant Lab',$3::jsonb) RETURNING id",
        [foreignTenant, `SYN-FOREIGN-${suffix}`, modules],
      )
    ).rows[0].id;
    foreignPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other Tenant','2000-01-01','Other') RETURNING id",
        [foreignTenant, foreignFacility, `SYN-FOREIGN-${suffix}`],
      )
    ).rows[0].id;
    const foreignRole = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [foreignTenant],
      )
    ).rows[0].id;
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,permission_id FROM role_permissions WHERE role_id=$2',
      [foreignRole, role],
    );
    const createActor = async (
      facilityId: number,
      name: string,
      tenantId = tenant,
      roleId = role,
    ) => {
      const user = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic clinician','test-only','ACTIVE',$3,$4) RETURNING id",
          [
            `synthetic-${name}-${suffix}`,
            `synthetic-${name}-${suffix}@example.test`,
            tenantId,
            facilityId,
          ],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, roleId]);
      return (await createSession({ userId: user, securityVersion: 1 })).sessionToken;
    };
    token = await createActor(facility, 'lab-a');
    otherToken = await createActor(other, 'lab-b');
    foreignToken = await createActor(foreignFacility, 'other-tenant', foreignTenant, foreignRole);
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    blood = await createService('BLOOD01', 'LB-BLD01', '456.00');
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('reproduces the reported refusal for a name-only investigation without guessing a link', async () => {
    const visit = await makeEncounter();
    const input = batch(visit.id, [
      { investigation: 'blood test', specimenType: 'Synthetic blood' },
    ]);
    const created = await call('POST', '/api/lab-orders/batch', input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = created.body.orders[0];
    expect(order).toMatchObject({
      facilityServiceId: null,
      testId: null,
      testName: 'blood test',
      clinicalException: true,
    });
    await collectAndVerify(order.id);
    const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(completed.status).toBe(200);
    expect(completed.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'SERVICE_NOT_SELECTED' },
    });
    expect(completed.body.billing.message).toContain(
      'The investigation has no selected facility identity',
    );
    const pending = await pool.query(
      "SELECT status,diagnosis_code,detail FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
      [facility, order.id],
    );
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]).toMatchObject({
      status: 'PENDING',
      diagnosis_code: 'SERVICE_NOT_SELECTED',
    });
    expect(pending.rows[0].detail).toContain('no selected facility identity');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('persists the selected service, retrieves its identity, and bills the linked differently coded tariff exactly once', async () => {
    const linkage = (
      await pool.query(
        'SELECT s.code AS service_code,t.code AS tariff_code,t.facility_service_id,t.fee::text FROM facility_services s JOIN facility_service_tariffs t ON t.facility_service_id=s.id AND t.facility_id=s.facility_id AND t.tenant_id=s.tenant_id WHERE s.id=$1 AND t.id=$2',
        [blood.service.id, blood.tariff.id],
      )
    ).rows[0];
    expect(linkage).toEqual({
      service_code: 'BLOOD01',
      tariff_code: 'LB-BLD01',
      facility_service_id: blood.service.id,
      fee: '456.00',
    });
    const available = await call(
      'GET',
      `/api/facility-services/available?facilityId=${facility}&category=LABORATORY`,
    );
    expect(available.status).toBe(200);
    expect(available.body.find((row: { id: number }) => row.id === blood.service.id)).toMatchObject(
      {
        id: blood.service.id,
        code: 'BLOOD01',
        tariffId: blood.tariff.id,
        tariffCode: 'LB-BLD01',
        unitPrice: '456.00',
      },
    );

    const historical = await call('POST', '/api/invoices', {
      invoice: { facilityId: facility, patientId: patient, invoiceNumber: `SYN-HIST-${suffix}` },
      items: [{ tariffId: blood.tariff.id, quantity: 1 }],
    });
    expect(historical.status, JSON.stringify(historical.body)).toBe(201);
    const payment = await call('POST', '/api/billing/payments', {
      facilityId: facility,
      invoiceId: historical.body.id,
      amount: '456.00',
      paymentMethod: 'Cash',
      idempotencyKey: randomUUID(),
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    const historicalSnapshot = async () => ({
      invoice: (
        await pool.query('SELECT row_to_json(i) AS row FROM billing_invoices i WHERE id=$1', [
          historical.body.id,
        ])
      ).rows[0].row,
      items: (
        await pool.query(
          'SELECT row_to_json(i) AS row FROM billing_items i WHERE invoice_id=$1 ORDER BY id',
          [historical.body.id],
        )
      ).rows,
      payments: (
        await pool.query(
          'SELECT row_to_json(p) AS row FROM billing_payments p WHERE invoice_id=$1 ORDER BY id',
          [historical.body.id],
        )
      ).rows,
    });
    const before = await historicalSnapshot();

    const visit = await makeEncounter();
    const input = batch(visit.id, [
      { facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' },
    ]);
    const created = await call('POST', '/api/lab-orders/batch', input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = created.body.orders[0];
    expect(order).toMatchObject({
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId: visit.id,
      facilityServiceId: blood.service.id,
      testName: 'blood test',
      serviceCode: 'BLOOD01',
      specimenType: 'Synthetic blood',
      clinicalException: false,
    });
    const replay = await call('POST', '/api/lab-orders/batch', input);
    expect(replay.status).toBe(201);
    expect(replay.body.orders[0]).toMatchObject({
      id: order.id,
      facilityServiceId: blood.service.id,
      serviceCode: 'BLOOD01',
    });
    const audit = (
      await pool.query(
        "SELECT details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='LAB_ORDER_REQUEST' AND resource_id=$3",
        [tenant, facility, String(order.id)],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details)).toMatchObject({
      facilityServiceId: blood.service.id,
      serviceCode: 'BLOOD01',
    });
    const orders = await call('GET', `/api/lab-orders?facilityId=${facility}&patientId=${patient}`);
    expect(orders.status).toBe(200);
    expect(orders.body.find((row: { id: number }) => row.id === order.id)).toMatchObject({
      facilityServiceId: blood.service.id,
      serviceCode: 'BLOOD01',
      testName: 'blood test',
      specimenType: 'Synthetic blood',
      encounterId: visit.id,
    });
    expect(
      (
        await pool.query(
          'SELECT facility_service_id,service_code,test_id,test_name,specimen_type,tenant_id,facility_id,patient_id,encounter_id FROM lab_orders WHERE id=$1',
          [order.id],
        )
      ).rows[0],
    ).toEqual({
      facility_service_id: blood.service.id,
      service_code: 'BLOOD01',
      test_id: null,
      test_name: 'blood test',
      specimen_type: 'Synthetic blood',
      tenant_id: tenant,
      facility_id: facility,
      patient_id: patient,
      encounter_id: visit.id,
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const premature = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(premature.status).toBe(409);
    expect(premature.body.error).toBe('LAB_SPECIMEN_NOT_COLLECTED');
    await collectAndVerify(order.id);
    const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.billing).toMatchObject({
      charged: true,
      tariffCode: 'LB-BLD01',
      unitPrice: '456.00',
      totalAmount: '456.00',
    });
    const repeated = await Promise.all(
      Array.from({ length: 3 }, () => call('POST', `/api/lab-orders/${order.id}/complete`, {})),
    );
    expect(
      repeated.every(
        (response) => response.status === 200 && response.body.billing.reason === 'DUPLICATE',
      ),
    ).toBe(true);
    const items = (
      await pool.query(
        "SELECT bi.facility_service_id,bi.tariff_id,bi.service_code,bi.tariff_code,bi.unit_price::text,bi.total_amount::text,bi.source_type,bi.source_id,inv.tenant_id,inv.facility_id,inv.patient_id,inv.encounter_id FROM billing_items bi JOIN billing_invoices inv ON inv.id=bi.invoice_id WHERE bi.source_type='LAB_ORDER' AND bi.source_id=$1",
        [order.id],
      )
    ).rows;
    expect(items).toEqual([
      {
        facility_service_id: blood.service.id,
        tariff_id: blood.tariff.id,
        service_code: 'BLOOD01',
        tariff_code: 'LB-BLD01',
        unit_price: '456.00',
        total_amount: '456.00',
        source_type: 'LAB_ORDER',
        source_id: order.id,
        tenant_id: tenant,
        facility_id: facility,
        patient_id: patient,
        encounter_id: visit.id,
      },
    ]);
    expect(await historicalSnapshot()).toEqual(before);
  });

  it('creates a single scoped request with a server-derived service identity and no order-time charge', async () => {
    const visit = await makeEncounter();
    const created = await call('POST', '/api/lab-orders', {
      patientId: patient,
      encounterId: visit.id,
      facilityServiceId: blood.service.id,
      testName: 'Untrusted browser name',
      specimenType: 'Synthetic blood',
      priority: 'Routine',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId: visit.id,
      facilityServiceId: blood.service.id,
      serviceCode: 'BLOOD01',
      testName: 'blood test',
      specimenType: 'Synthetic blood',
      billing: null,
    });
    const read = await call('GET', `/api/lab-orders?facilityId=${facility}&patientId=${patient}`);
    expect(read.body.find((row: { id: number }) => row.id === created.body.id)).toMatchObject({
      facilityServiceId: blood.service.id,
      serviceCode: 'BLOOD01',
      currentServiceCode: 'BLOOD01',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [created.body.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const mismatch = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(
        visit.id,
        [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }],
        otherPatient,
      ),
    );
    expect(mismatch.status).toBe(403);
    expect(
      (await pool.query('SELECT count(*)::int n FROM lab_orders WHERE encounter_id=$1', [visit.id]))
        .rows[0].n,
    ).toBe(1);
  });

  it('keeps the order-time service code snapshot distinct from the current linked code on replay', async () => {
    const service = await createService('SYN-SNAPSHOT', 'SYN-SNAPSHOT-T', '10.00');
    const visit = await makeEncounter();
    const input = batch(visit.id, [
      { facilityServiceId: service.service.id, specimenType: 'Synthetic' },
    ]);
    const created = await call('POST', '/api/lab-orders/batch', input);
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    // Deliberate synthetic direct edit tests the difference between a snapshot
    // and the live code. Normal service editing treats the code as immutable.
    await pool.query(
      "UPDATE facility_services SET code='SYN-SNAPSHOT-CHANGED' WHERE id=$1 AND facility_id=$2",
      [service.service.id, facility],
    );
    const read = await call('GET', `/api/lab-orders?facilityId=${facility}&patientId=${patient}`);
    expect(read.body.find((row: { id: number }) => row.id === order.id)).toMatchObject({
      facilityServiceId: service.service.id,
      serviceCode: 'SYN-SNAPSHOT',
      currentServiceCode: 'SYN-SNAPSHOT-CHANGED',
    });
    const replay = await call('POST', '/api/lab-orders/batch', input);
    expect(replay.status).toBe(201);
    expect(replay.body.orders[0]).toMatchObject({
      id: order.id,
      facilityServiceId: service.service.id,
      serviceCode: 'SYN-SNAPSHOT',
      testCode: 'SYN-SNAPSHOT',
      currentServiceCode: 'SYN-SNAPSHOT-CHANGED',
    });
  });

  it('rejects another facility selecting or billing the service or tariff', async () => {
    const visit = await makeEncounter(other, otherPatient, otherToken);
    const available = await call(
      'GET',
      `/api/facility-services/available?facilityId=${other}&category=LABORATORY`,
      undefined,
      otherToken,
    );
    expect(available.status).toBe(200);
    expect(available.body.some((row: { id: number }) => row.id === blood.service.id)).toBe(false);
    expect(
      (
        await call(
          'GET',
          `/api/facility-services/available?facilityId=${facility}&category=LABORATORY`,
          undefined,
          otherToken,
        )
      ).status,
    ).toBe(403);
    const input = batch(
      visit.id,
      [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }],
      otherPatient,
    );
    const rejected = await call('POST', '/api/lab-orders/batch', input, otherToken);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('TEST_NOT_AVAILABLE');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM lab_orders WHERE facility_id=$1 AND encounter_id=$2',
          [other, visit.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const invoice = await call(
      'POST',
      '/api/invoices',
      {
        invoice: {
          facilityId: other,
          patientId: otherPatient,
          invoiceNumber: `SYN-FOREIGN-${suffix}`,
        },
        items: [{ tariffId: blood.tariff.id, quantity: 1 }],
      },
      otherToken,
    );
    expect(invoice.status).not.toBe(201);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE invoice_number=$1', [
          `SYN-FOREIGN-${suffix}`,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('rejects cross-tenant service, tariff, patient and encounter references', async () => {
    const visit = await makeEncounter(foreignFacility, foreignPatient, foreignToken);
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(
        visit.id,
        [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }],
        foreignPatient,
      ),
      foreignToken,
    );
    expect(created.status).toBe(400);
    expect(created.body.error).toBe('TEST_NOT_AVAILABLE');
    const wrongPatient = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(
        visit.id,
        [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }],
        patient,
      ),
      foreignToken,
    );
    expect(wrongPatient.status).not.toBe(201);
    const invoice = await call(
      'POST',
      '/api/invoices',
      {
        invoice: {
          facilityId: foreignFacility,
          patientId: foreignPatient,
          invoiceNumber: `SYN-FOREIGN-TENANT-${suffix}`,
        },
        items: [{ tariffId: blood.tariff.id, quantity: 1 }],
      },
      foreignToken,
    );
    expect(invoice.status).not.toBe(201);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM lab_orders WHERE facility_id=$1 AND encounter_id=$2',
          [foreignFacility, visit.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(
      pool.query(
        "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,facility_service_id,test_name,specimen_type) VALUES($1,$2,$3,$4,$5,'Synthetic cross-tenant','Synthetic')",
        [foreignTenant, foreignFacility, foreignPatient, visit.id, blood.service.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('preserves the initial evaluator when concurrent completion replays reach billing first', async () => {
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);

    const { first, observation } = await withPausedFirstEvaluation(order.id, async () => {
      const replays = await Promise.all(
        Array.from({ length: 3 }, () => call('POST', `/api/lab-orders/${order.id}/complete`, {})),
      );
      const attempts = (
        await pool.query(
          "SELECT status,diagnosis_code,attempts FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
          [facility, order.id],
        )
      ).rows;
      const lineCount = (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n;
      return { replays, attempts, lineCount };
    });
    expect(first.status).toBe(200);
    expect(first.body.billing).toMatchObject({
      charged: true,
      tariffCode: 'LB-BLD01',
      unitPrice: '456.00',
    });
    expect(observation.replays.map((response) => response.status)).toEqual([200, 200, 200]);
    for (const replay of observation.replays) {
      expect(replay.body.billing).toMatchObject({
        charged: false,
        reason: 'BILLING_EVALUATION_PENDING',
        diagnosis: { code: 'BILLING_EVALUATION_PENDING' },
      });
    }
    expect(observation.attempts).toEqual([
      { status: 'PENDING', diagnosis_code: 'BILLING_EVALUATION_PENDING', attempts: 4 },
    ]);
    expect(observation.lineCount).toBe(0);

    const attempts = (
      await pool.query(
        "SELECT id,tenant_id,facility_id,patient_id,encounter_id,status,diagnosis_code,attempts,resolved_item_id,resolved_invoice_id,detail FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
        [order.id],
      )
    ).rows;
    const lines = (
      await pool.query(
        "SELECT bi.id,bi.invoice_id,bi.facility_service_id,bi.tariff_id,bi.unit_price::text,bi.idempotency_key,inv.tenant_id,inv.facility_id,inv.patient_id,inv.encounter_id FROM billing_items bi JOIN billing_invoices inv ON inv.id=bi.invoice_id WHERE bi.source_type='LAB_ORDER' AND bi.source_id=$1",
        [order.id],
      )
    ).rows;
    expect(attempts).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      tenant_id: tenant,
      facility_id: facility,
      patient_id: patient,
      encounter_id: visit.id,
      status: 'BILLED',
      diagnosis_code: 'BILLING_EVALUATION_PENDING',
      attempts: 5,
      resolved_item_id: lines[0].id,
      resolved_invoice_id: lines[0].invoice_id,
      detail: 'Billed during the initial clinical billing evaluation.',
    });
    expect(lines[0]).toMatchObject({
      facility_service_id: blood.service.id,
      tariff_id: blood.tariff.id,
      unit_price: '456.00',
      idempotency_key: `LAB_ORDER:${order.id}`,
      tenant_id: tenant,
      facility_id: facility,
      patient_id: patient,
      encounter_id: visit.id,
    });
    const audits = (
      await pool.query(
        `SELECT resource,action,resource_id,details FROM audit_logs
         WHERE tenant_id=$1 AND facility_id=$2 AND (
           (resource='LabOrder' AND resource_id=$3 AND action='UPDATE' AND details LIKE 'Investigation explicitly confirmed complete%') OR
           (resource='BillingChargeAttempt' AND resource_id=$4 AND action='UPDATE') OR
           (resource='BillingItem' AND resource_id=$5 AND action='CREATE') OR
           (resource='BILLING_TARIFF_PRICE_REVIEW' AND resource_id=$4)
         )`,
        [tenant, facility, String(order.id), String(attempts[0].id), String(lines[0].id)],
      )
    ).rows;
    expect(audits.filter((row) => row.resource === 'LabOrder')).toHaveLength(1);
    expect(audits.filter((row) => row.resource === 'BillingItem')).toHaveLength(1);
    expect(audits.filter((row) => row.resource === 'BILLING_TARIFF_PRICE_REVIEW')).toHaveLength(0);
    expect(audits.filter((row) => row.resource === 'BillingChargeAttempt')).toMatchObject([
      { details: 'Charge attempt resolved during the initial clinical billing evaluation.' },
    ]);
  });

  it('charges exactly once when initial completion requests arrive concurrently', async () => {
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [{ facilityServiceId: blood.service.id, specimenType: 'Synthetic blood' }]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => call('POST', `/api/lab-orders/${order.id}/complete`, {})),
    );
    expect(replies.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const winners = replies.filter((response) => response.body.billing.charged);
    const others = replies.filter((response) => !response.body.billing.charged);
    expect(winners).toHaveLength(1);
    expect(others).toHaveLength(3);
    for (const response of others) {
      // A replay that finishes before the original evaluator cannot truthfully
      // claim a duplicate line exists; a later replay must identify that line.
      if (response.body.billing.reason === 'DUPLICATE') {
        expect(response.body.billing).toMatchObject({
          itemId: winners[0].body.billing.itemId,
          invoiceId: winners[0].body.billing.invoiceId,
        });
      } else {
        expect(response.body.billing).toMatchObject({
          charged: false,
          reason: 'BILLING_EVALUATION_PENDING',
          diagnosis: { code: 'BILLING_EVALUATION_PENDING' },
        });
        expect(response.body.billing.itemId).toBeUndefined();
      }
    }
    const items = (
      await pool.query(
        "SELECT id,invoice_id,tariff_id,tariff_code,unit_price::text FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
        [order.id],
      )
    ).rows;
    expect(items).toEqual([
      {
        id: winners[0].body.billing.itemId,
        invoice_id: winners[0].body.billing.invoiceId,
        tariff_id: blood.tariff.id,
        tariff_code: 'LB-BLD01',
        unit_price: '456.00',
      },
    ]);
    expect(
      (
        await pool.query(
          "SELECT status,resolved_item_id,resolved_invoice_id FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
          [facility, order.id],
        )
      ).rows,
    ).toEqual([
      {
        status: 'BILLED',
        resolved_item_id: items[0].id,
        resolved_invoice_id: items[0].invoice_id,
      },
    ]);
  });

  it('does not let a mismatched patient, encounter, facility or tenant disturb the staged charge', async () => {
    const { visit, order } = await makeVerifiedOrder();
    const wrongVisit = await makeEncounter();
    const { first, observation } = await withPausedFirstEvaluation(order.id, async (request) => {
      const wrongPatient = await chargeAndRecord(db, { ...request, patientId: otherPatient });
      const wrongEncounter = await chargeAndRecord(db, { ...request, encounterId: wrongVisit.id });
      const wrongFacility = await call(
        'POST',
        `/api/lab-orders/${order.id}/complete`,
        {},
        otherToken,
      );
      const wrongTenant = await call(
        'POST',
        `/api/lab-orders/${order.id}/complete`,
        {},
        foreignToken,
      );
      const attempts = (
        await pool.query(
          "SELECT tenant_id,facility_id,patient_id,encounter_id,status,diagnosis_code,attempts FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows;
      return { wrongPatient, wrongEncounter, wrongFacility, wrongTenant, attempts };
    });
    expect(observation.wrongPatient).toMatchObject({ charged: false, reason: 'INVALID_INPUT' });
    expect(observation.wrongEncounter).toMatchObject({ charged: false, reason: 'INVALID_INPUT' });
    expect([403, 404]).toContain(observation.wrongFacility.status);
    expect([403, 404]).toContain(observation.wrongTenant.status);
    expect(observation.attempts).toEqual([
      {
        tenant_id: tenant,
        facility_id: facility,
        patient_id: patient,
        encounter_id: visit.id,
        status: 'PENDING',
        diagnosis_code: 'BILLING_EVALUATION_PENDING',
        attempts: 1,
      },
    ]);
    expect(first.body.billing.charged).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT inv.tenant_id,inv.facility_id,inv.patient_id,inv.encounter_id FROM billing_items bi JOIN billing_invoices inv ON inv.id=bi.invoice_id WHERE bi.source_type='LAB_ORDER' AND bi.source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([
      { tenant_id: tenant, facility_id: facility, patient_id: patient, encounter_id: visit.id },
    ]);
  });

  it('preserves a pre-completion source marker when a replay races the first valid completion', async () => {
    const { order } = await makeVerifiedOrder();
    const premature = await chargeAndRecord(db, labOrderChargeRequest(order));
    expect(premature).toMatchObject({
      charged: false,
      diagnosis: { code: 'SOURCE_NOT_COMPLETED' },
    });
    const before = (
      await pool.query(
        "SELECT id FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
        [facility, order.id],
      )
    ).rows;
    expect(before).toHaveLength(1);
    const { first, observation } = await withPausedFirstEvaluation(order.id, async () => {
      const replays = await Promise.all(
        Array.from({ length: 2 }, () => call('POST', `/api/lab-orders/${order.id}/complete`, {})),
      );
      const pending = (
        await pool.query(
          'SELECT status,diagnosis_code,attempts FROM billing_charge_attempts WHERE id=$1',
          [before[0].id],
        )
      ).rows;
      return { replays, pending };
    });
    expect(observation.replays.every((response) => response.status === 200)).toBe(true);
    expect(observation.replays.map((response) => response.body.billing.reason)).toEqual([
      'BILLING_EVALUATION_PENDING',
      'BILLING_EVALUATION_PENDING',
    ]);
    expect(observation.pending).toEqual([
      { status: 'PENDING', diagnosis_code: 'SOURCE_NOT_COMPLETED', attempts: 3 },
    ]);
    expect(first.body.billing).toMatchObject({ charged: true, unitPrice: '456.00' });
    expect(
      (
        await pool.query(
          "SELECT id,status,resolved_item_id FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([
      { id: before[0].id, status: 'BILLED', resolved_item_id: first.body.billing.itemId },
    ]);
  });

  it('does not charge a changed tariff while the original evaluator is delayed', async () => {
    const service = await createService('LAB-RACE-PRICE', 'LAB-RACE-PRICE-T', '18.00');
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [{ facilityServiceId: service.service.id, specimenType: 'Synthetic blood' }]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);
    const { first, observation } = await withPausedFirstEvaluation(order.id, async () => {
      const replay = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      const changed = await call('PUT', `/api/facility-tariffs/${service.tariff.id}`, {
        facilityId: facility,
        serviceId: service.service.id,
        expectedRevision: service.tariff.revision,
        code: service.tariff.code,
        description: 'Synthetic later price',
        department: 'laboratory',
        unit: 'Service',
        fee: '99.00',
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        autoBill: true,
      });
      return { replay, changed };
    });
    expect(observation.replay.body.billing).toMatchObject({
      charged: false,
      reason: 'BILLING_EVALUATION_PENDING',
    });
    expect(observation.changed.status).toBe(200);
    expect(observation.changed.body.revision).toBe(service.tariff.revision + 1);
    expect(first.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    expect(first.body).not.toHaveProperty('billingInitialTariff');
    expect(first.body).not.toHaveProperty('billingOutboxAttemptId');
    expect(
      (
        await pool.query(
          "SELECT status,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'PENDING', diagnosis_code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT al.user_id,al.details FROM audit_logs al JOIN billing_charge_attempts a ON al.resource_id=a.id::text
           WHERE al.tenant_id=$1 AND al.facility_id=$2 AND al.resource='BillingChargeAttempt' AND al.action='UPDATE'
             AND a.source_type='LAB_ORDER' AND a.source_id=$3`,
          [tenant, facility, order.id],
        )
      ).rows,
    ).toEqual([
      {
        user_id: 'SYSTEM',
        details:
          'Initial laboratory tariff changed or was unavailable; authorized price review required.',
      },
    ]);
  });

  it('does not turn a tariff configured after completion into an automatic historical price', async () => {
    const service = await createService('LAB-RACE-UNPRICED', 'LAB-RACE-UNPRICED-T', '0.00');
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [{ facilityServiceId: service.service.id, specimenType: 'Synthetic blood' }]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);
    const { first, observation } = await withPausedFirstEvaluation(order.id, async () => {
      const configured = await call('PUT', `/api/facility-tariffs/${service.tariff.id}`, {
        facilityId: facility,
        serviceId: service.service.id,
        expectedRevision: service.tariff.revision,
        code: service.tariff.code,
        description: 'Synthetic price configured after completion',
        department: 'laboratory',
        unit: 'Service',
        fee: '99.00',
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        autoBill: true,
      });
      const replay = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      return { configured, replay };
    });
    expect(observation.configured.status).toBe(200);
    expect(observation.replay.body.billing).toMatchObject({
      charged: false,
      reason: 'BILLING_EVALUATION_PENDING',
    });
    expect(first.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    expect(
      (
        await pool.query(
          "SELECT status,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'PENDING', diagnosis_code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('preserves clinical completion and requires review if the tariff snapshot savepoint fails', async () => {
    const { order } = await makeVerifiedOrder();
    // Inject an actual PostgreSQL error into the snapshot savepoint, not a
    // fabricated successful billing result. The clinical/outbox transaction
    // must survive, while an unknown initial price cannot be charged.
    const fault = vi
      .spyOn(facilityResolver, 'resolveFacilityCharge')
      .mockImplementationOnce(async (tx) => {
        await tx.execute(sql`SELECT 1 / 0`);
        throw new Error('Synthetic snapshot fault did not fire');
      });
    let completed: Awaited<ReturnType<typeof call>>;
    try {
      completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    } finally {
      fault.mockRestore();
    }
    expect(completed.status).toBe(200);
    expect(completed.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    expect(
      (
        await pool.query(
          'SELECT status,completed_at IS NOT NULL AS completed FROM lab_orders WHERE id=$1',
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'Completed', completed: true }]);
    expect(
      (
        await pool.query(
          "SELECT status,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'PENDING', diagnosis_code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='LabOrder' AND resource_id=$2 AND action='UPDATE' AND details LIKE 'Investigation explicitly confirmed complete%'",
          [facility, String(order.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_logs al JOIN billing_charge_attempts a ON al.resource_id=a.id::text
           WHERE al.tenant_id=$1 AND al.facility_id=$2 AND al.resource='BillingChargeAttempt' AND al.action='UPDATE'
             AND a.source_type='LAB_ORDER' AND a.source_id=$3
             AND al.details='Initial laboratory tariff changed or was unavailable; authorized price review required.'`,
          [tenant, facility, order.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('does not treat an initial attempt ID without its tariff snapshot as permission to charge', async () => {
    const { order } = await makeVerifiedOrder();
    const { first, observation } = await withPausedFirstEvaluation(
      order.id,
      async (request, id) => {
        const withoutSnapshot = await chargeAndRecord(db, request, id);
        return { withoutSnapshot };
      },
    );
    expect(observation.withoutSnapshot).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    expect(first.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    expect(
      (
        await pool.query(
          "SELECT status,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'PENDING', diagnosis_code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('does not resolve a lab replay to an existing line on a different encounter', async () => {
    const { order } = await makeVerifiedOrder();
    const otherVisit = await makeEncounter();
    const { first, observation } = await withPausedFirstEvaluation(order.id, async () => {
      // An intentionally inconsistent synthetic legacy line belongs to the
      // same patient/facility but to a different encounter. Do not move it,
      // add a second line, or claim it is a verified duplicate of this order.
      const invoice = (
        await pool.query(
          `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [tenant, facility, patient, otherVisit.id, `SYNTHETIC-WRONG-ENCOUNTER-${randomUUID()}`],
        )
      ).rows[0];
      const line = (
        await pool.query(
          `INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount,source_type,source_id,idempotency_key)
           VALUES($1,'LAB','Synthetic inconsistent legacy line',1,456,456,'LAB_ORDER',$2,$3) RETURNING id`,
          [invoice.id, order.id, `LAB_ORDER:${order.id}`],
        )
      ).rows[0];
      const pendingReplay = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      const pending = (
        await pool.query(
          "SELECT id,status FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows;
      expect(pendingReplay.body.billing).toMatchObject({ charged: false, reason: 'INVALID_INPUT' });
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('PENDING');
      const retryPath = `/api/billing/charge-attempts/${pending[0].id}/retry`;
      expect((await call('POST', retryPath, { facilityId: facility })).body).toMatchObject({
        status: 'PENDING',
        result: { charged: false, reason: 'INVALID_INPUT' },
      });
      // Also exercise the old resolved-attempt shortcut with inconsistent
      // synthetic evidence. Historical rows remain untouched by the replay.
      await pool.query(
        "UPDATE billing_charge_attempts SET status='BILLED',resolved_item_id=$2,resolved_invoice_id=$3 WHERE id=$1",
        [pending[0].id, line.id, invoice.id],
      );
      const resolvedReplay = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      const resolvedRetry = await call('POST', retryPath, { facilityId: facility });
      return { resolvedReplay, resolvedRetry, line, invoice };
    });
    expect(observation.resolvedReplay.body.billing).toMatchObject({
      charged: false,
      reason: 'INVALID_INPUT',
    });
    expect(observation.resolvedRetry.status).toBe(409);
    expect(observation.resolvedRetry.body).toMatchObject({
      error: 'CHARGE_ATTEMPT_REVIEW_REQUIRED',
      message: expect.stringContaining('manual reconciliation is required'),
    });
    expect(first.body.billing).toMatchObject({ charged: false, reason: 'INVALID_INPUT' });
    expect(
      (
        await pool.query(
          "SELECT status,resolved_item_id,resolved_invoice_id FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([
      {
        status: 'BILLED',
        resolved_item_id: observation.line.id,
        resolved_invoice_id: observation.invoice.id,
      },
    ]);
    expect(
      (
        await pool.query(
          "SELECT id,invoice_id FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ id: observation.line.id, invoice_id: observation.invoice.id }]);
  });

  it('does not trust a lab idempotency key attached to a different source order', async () => {
    const { visit, order } = await makeVerifiedOrder();
    const other = await makeVerifiedOrder();
    const { first, observation } = await withPausedFirstEvaluation(order.id, async () => {
      const invoice = (
        await pool.query(
          `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [tenant, facility, patient, visit.id, `SYNTHETIC-WRONG-SOURCE-${randomUUID()}`],
        )
      ).rows[0];
      await pool.query(
        `INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount,source_type,source_id,idempotency_key)
         VALUES($1,'LAB','Synthetic inconsistent source',1,456,456,'LAB_ORDER',$2,$3)`,
        [invoice.id, other.order.id, `LAB_ORDER:${order.id}`],
      );
      const replay = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      return { replay };
    });
    expect(observation.replay.body.billing).toMatchObject({
      charged: false,
      reason: 'INVALID_INPUT',
    });
    expect(first.body.billing).toMatchObject({ charged: false, reason: 'INVALID_INPUT' });
    expect(
      (
        await pool.query(
          "SELECT status,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'PENDING', diagnosis_code: 'BILLING_EVALUATION_PENDING' }]);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_items WHERE idempotency_key=$1', [
          `LAB_ORDER:${order.id}`,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('recognizes an existing scoped invoice line before reporting a staged replay as pending', async () => {
    const { order } = await makeVerifiedOrder();
    const { first, observation } = await withPausedFirstEvaluation(order.id, async (request) => {
      // Model a pre-existing, valid source-linked line independently of the
      // outbox, as can occur in legacy data. This is real transactional billing.
      const existing = await chargeForService(db, request);
      const replay = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      return { existing, replay };
    });
    expect(observation.existing.charged).toBe(true);
    expect(observation.replay.body.billing).toMatchObject({
      charged: false,
      reason: 'DUPLICATE',
      itemId: observation.existing.itemId,
      invoiceId: observation.existing.invoiceId,
    });
    expect(first.body.billing).toMatchObject({
      charged: false,
      reason: 'DUPLICATE',
      itemId: observation.existing.itemId,
    });
    expect(
      (
        await pool.query(
          "SELECT status,resolved_item_id,resolved_invoice_id FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([
      {
        status: 'DUPLICATE',
        resolved_item_id: observation.existing.itemId,
        resolved_invoice_id: observation.existing.invoiceId,
      },
    ]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('respects a concurrent authorized price review and bills only the reviewed tariff once', async () => {
    const { order } = await makeVerifiedOrder();
    const review = {
      tariffId: blood.tariff.id,
      revision: blood.tariff.revision,
      unitPrice: '456.00',
      reason: 'Reviewed the documented synthetic fixture price',
    };
    const { first, observation } = await withPausedFirstEvaluation(
      order.id,
      async (_request, id) => {
        const path = `/api/billing/charge-attempts/${id}/retry`;
        const unreviewed = await call('POST', path, { facilityId: facility });
        const wrongFacility = await call(
          'POST',
          path,
          { facilityId: facility, priceReview: review },
          otherToken,
        );
        const stale = await call('POST', path, {
          facilityId: facility,
          priceReview: { ...review, revision: review.revision + 1 },
        });
        const pending = (
          await pool.query(
            'SELECT status,diagnosis_code FROM billing_charge_attempts WHERE id=$1',
            [id],
          )
        ).rows;
        return { id, path, unreviewed, wrongFacility, stale, pending };
      },
    );
    expect(observation.unreviewed.body).toMatchObject({
      status: 'PENDING',
      result: { charged: false, diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' } },
    });
    expect([403, 404]).toContain(observation.wrongFacility.status);
    expect(observation.stale.body).toMatchObject({
      status: 'PENDING',
      result: { charged: false, diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' } },
    });
    expect(observation.pending).toEqual([
      { status: 'PENDING', diagnosis_code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    ]);
    expect(first.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);

    const outcomes = await Promise.all(
      Array.from({ length: 2 }, () =>
        call('POST', observation.path, { facilityId: facility, priceReview: review }),
      ),
    );
    expect(outcomes.every((response) => response.status === 200)).toBe(true);
    expect(outcomes.filter((response) => response.body.result.charged)).toHaveLength(1);
    expect(outcomes.filter((response) => response.body.result.reason === 'DUPLICATE')).toHaveLength(
      1,
    );
    const lines = (
      await pool.query(
        "SELECT id,tariff_id,unit_price::text FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
        [order.id],
      )
    ).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tariff_id: blood.tariff.id, unit_price: '456.00' });
    const reviews = (
      await pool.query(
        "SELECT user_id,details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='BILLING_TARIFF_PRICE_REVIEW' AND resource_id=$3",
        [tenant, facility, String(observation.id)],
      )
    ).rows;
    const actor = (
      await pool.query('SELECT id FROM users WHERE uid=$1', [`synthetic-lab-a-${suffix}`])
    ).rows[0].id;
    expect(reviews).toHaveLength(1);
    expect(reviews[0].user_id).toBe(String(actor));
    expect(JSON.parse(reviews[0].details)).toMatchObject({
      tariffId: review.tariffId,
      tariffRevision: review.revision,
      reviewedUnitPrice: review.unitPrice,
      reason: review.reason,
      itemId: lines[0].id,
    });
    expect(
      (await call('POST', `/api/lab-orders/${order.id}/complete`, {})).body.billing,
    ).toMatchObject({
      charged: false,
      reason: 'DUPLICATE',
      itemId: lines[0].id,
    });
  });

  it('rolls back clinical completion if its outbox cannot be staged, then retries once safely', async () => {
    const { order } = await makeVerifiedOrder();
    const trigger = `synthetic_lab_outbox_${suffix.replaceAll('-', '')}_${order.id}`;
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.facility_id=${facility} AND NEW.source_type='LAB_ORDER' AND NEW.source_id=${order.id} THEN
        RAISE EXCEPTION 'Synthetic laboratory outbox failure';
      END IF;
      RETURN NEW; END $$`);
    try {
      await pool.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON billing_charge_attempts FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
      );
      const failed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      expect(failed.status).toBe(500);
      expect(
        (
          await pool.query(
            'SELECT status,completed_at,completed_by_user_id FROM lab_orders WHERE id=$1',
            [order.id],
          )
        ).rows,
      ).toEqual([{ status: 'Sample Collected', completed_at: null, completed_by_user_id: null }]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
            [order.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
            [order.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='LabOrder' AND resource_id=$2 AND action='UPDATE' AND details LIKE 'Investigation explicitly confirmed complete%'",
            [facility, String(order.id)],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON billing_charge_attempts`);
      await pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    const retried = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(retried.status).toBe(200);
    expect(retried.body.billing).toMatchObject({ charged: true, unitPrice: '456.00' });
    expect(
      (
        await pool.query(
          "SELECT status,resolved_item_id FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ status: 'BILLED', resolved_item_id: retried.body.billing.itemId }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='LabOrder' AND resource_id=$2 AND action='UPDATE' AND details LIKE 'Investigation explicitly confirmed complete%'",
          [facility, String(order.id)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('rejects inactive and wrongly classified investigations without creating an order', async () => {
    const inactive = await createService('INACTIVE-LAB', 'INACTIVE-LAB-T', '30.00');
    const disabled = await call('PATCH', `/api/facility-services/${inactive.service.id}/status`, {
      facilityId: facility,
      isActive: false,
    });
    expect(disabled.status).toBe(200);
    const wrong = await createService('WRONG-DEPT', 'WRONG-DEPT-T', '30.00');
    // Synthetic corruption: the category says LABORATORY but the department is not a laboratory.
    await pool.query(
      "UPDATE facility_services SET department='opd' WHERE id=$1 AND facility_id=$2",
      [wrong.service.id, facility],
    );
    const available = await call(
      'GET',
      `/api/facility-services/available?facilityId=${facility}&category=LABORATORY`,
    );
    expect(available.status).toBe(200);
    expect(
      available.body.some((row: { id: number }) =>
        [inactive.service.id, wrong.service.id].includes(row.id),
      ),
    ).toBe(false);
    const visit = await makeEncounter();
    for (const serviceId of [inactive.service.id, wrong.service.id]) {
      const result = await call(
        'POST',
        '/api/lab-orders/batch',
        batch(visit.id, [{ facilityServiceId: serviceId, specimenType: 'Synthetic' }]),
      );
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('TEST_NOT_AVAILABLE');
    }
    const mixed = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [
        { facilityServiceId: inactive.service.id, specimenType: 'Synthetic blood' },
        { investigation: 'Synthetic unlisted', specimenType: 'Synthetic swab' },
      ]),
    );
    expect(mixed.status).toBe(400);
    expect(mixed.body.error).toBe('TEST_NOT_AVAILABLE');
    expect(
      (await pool.query('SELECT count(*)::int n FROM lab_orders WHERE encounter_id=$1', [visit.id]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM queues WHERE encounter_id=$1 AND queue_type='Laboratory'",
          [visit.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('completes a selected investigation with no tariff and records a precise pending reason', async () => {
    const unpriced = await createService('NO-PRICE', 'NO-PRICE-TARIFF', '0.00');
    // The synthetic initial tariff has no clinical or financial references;
    // remove it before ordering to exercise an actually absent tariff row.
    const removed = await call(
      'DELETE',
      `/api/facility-tariffs/${unpriced.tariff.id}/permanent?facilityId=${facility}`,
    );
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE facility_service_id=$1',
          [unpriced.service.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [
        { facilityServiceId: unpriced.service.id, specimenType: 'Synthetic urine' },
      ]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);
    const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      status: 'Completed',
      facilityServiceId: unpriced.service.id,
      billing: { charged: false, diagnosis: { code: 'TARIFF_NOT_CONFIGURED' } },
    });
    const pending = (
      await pool.query(
        "SELECT id,status,reason,diagnosis_code,detail FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
        [facility, order.id],
      )
    ).rows;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      status: 'PENDING',
      reason: 'TARIFF_NOT_CONFIGURED',
      diagnosis_code: 'TARIFF_NOT_CONFIGURED',
    });
    expect(pending[0].detail).toContain('No active facility tariff is configured for this service');
    const queue = await call(
      'GET',
      `/api/billing/charge-attempts?facilityId=${facility}&status=PENDING`,
    );
    expect(queue.status).toBe(200);
    expect(
      queue.body.attempts.find((row: { id: number }) => row.id === pending[0].id),
    ).toMatchObject({
      sourceId: order.id,
      status: 'PENDING',
      reason: 'TARIFF_NOT_CONFIGURED',
      diagnosisCode: 'TARIFF_NOT_CONFIGURED',
    });
    expect(
      (
        await call(
          'GET',
          `/api/billing/charge-attempts?facilityId=${facility}`,
          undefined,
          otherToken,
        )
      ).status,
    ).toBe(403);
    const otherQueue = await call(
      'GET',
      `/api/billing/charge-attempts?facilityId=${other}`,
      undefined,
      otherToken,
    );
    expect(otherQueue.body.attempts.some((row: { id: number }) => row.id === pending[0].id)).toBe(
      false,
    );
    expect(
      (
        await call(
          'POST',
          `/api/billing/charge-attempts/${pending[0].id}/retry`,
          { facilityId: other },
          otherToken,
        )
      ).status,
    ).toBe(404);
    const retry = await call('POST', `/api/billing/charge-attempts/${pending[0].id}/retry`, {
      facilityId: facility,
    });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      status: 'PENDING',
      result: { charged: false, diagnosis: { code: 'TARIFF_NOT_CONFIGURED' } },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1 AND status='PENDING'",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it.each([
    { code: 'FUTURE-LAB', from: '2999-01-01', to: null, reason: 'NOT_YET_EFFECTIVE' },
    { code: 'EXPIRED-LAB', from: null, to: '2000-01-01', reason: 'EXPIRED' },
    { code: 'ZERO-LAB', from: null, to: null, reason: 'ZERO_PRICE' },
  ])(
    'completes but does not charge an ineligible $reason tariff',
    async ({ code, from, to, reason }) => {
      const service = await createService(
        code,
        `${code}-T`,
        reason === 'ZERO_PRICE' ? '0.00' : '456.00',
      );
      const tariff = await call('PUT', `/api/facility-tariffs/${service.tariff.id}`, {
        facilityId: facility,
        serviceId: service.service.id,
        code: service.tariff.code,
        description: `Synthetic ${code}`,
        department: 'laboratory',
        unit: 'Service',
        fee: reason === 'ZERO_PRICE' ? '0.00' : '456.00',
        effectiveFrom: from,
        effectiveTo: to,
        isActive: true,
        autoBill: true,
        expectedRevision: service.tariff.revision,
      });
      expect(tariff.status, JSON.stringify(tariff.body)).toBe(200);
      const visit = await makeEncounter();
      const created = await call(
        'POST',
        '/api/lab-orders/batch',
        batch(visit.id, [
          { facilityServiceId: service.service.id, specimenType: 'Synthetic blood' },
        ]),
      );
      expect(created.status).toBe(201);
      const order = created.body.orders[0];
      await collectAndVerify(order.id);
      const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      expect(completed.status).toBe(200);
      expect(completed.body).toMatchObject({
        status: 'Completed',
        billing: { charged: false, diagnosis: { code: reason } },
      });
      expect(
        (
          await pool.query(
            "SELECT reason,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
            [order.id],
          )
        ).rows,
      ).toEqual([{ reason: 'TARIFF_NOT_CONFIGURED', diagnosis_code: reason }]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
            [order.id],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );

  it('updates the pending diagnosis on retry and bills once only after an explicit valid tariff', async () => {
    const service = await createService('SYN-RETRY', 'SYN-RETRY-T', '456.00');
    const future = await call('PUT', `/api/facility-tariffs/${service.tariff.id}`, {
      facilityId: facility,
      serviceId: service.service.id,
      code: service.tariff.code,
      description: 'Synthetic retry tariff',
      department: 'laboratory',
      unit: 'Service',
      fee: '456.00',
      effectiveFrom: '2999-01-01',
      effectiveTo: null,
      isActive: true,
      autoBill: true,
      expectedRevision: service.tariff.revision,
    });
    expect(future.status).toBe(200);
    const visit = await makeEncounter();
    const created = await call(
      'POST',
      '/api/lab-orders/batch',
      batch(visit.id, [{ facilityServiceId: service.service.id, specimenType: 'Synthetic blood' }]),
    );
    expect(created.status).toBe(201);
    const order = created.body.orders[0];
    await collectAndVerify(order.id);
    const complete = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(complete.body.billing.diagnosis.code).toBe('NOT_YET_EFFECTIVE');
    const attempt = (
      await pool.query(
        "SELECT id,diagnosis_code FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1",
        [order.id],
      )
    ).rows[0];
    expect(attempt.diagnosis_code).toBe('NOT_YET_EFFECTIVE');
    const disabled = await call('PATCH', `/api/facility-tariffs/${service.tariff.id}/status`, {
      facilityId: facility,
      isActive: false,
    });
    expect(disabled.status).toBe(200);
    const pending = await call('POST', `/api/billing/charge-attempts/${attempt.id}/retry`, {
      facilityId: facility,
    });
    expect(pending.body).toMatchObject({
      status: 'PENDING',
      result: { charged: false, diagnosis: { code: 'TARIFF_NOT_CONFIGURED' } },
    });
    expect(
      (
        await pool.query('SELECT diagnosis_code FROM billing_charge_attempts WHERE id=$1', [
          attempt.id,
        ])
      ).rows[0].diagnosis_code,
    ).toBe('TARIFF_NOT_CONFIGURED');
    const configured = await call('PUT', `/api/facility-tariffs/${service.tariff.id}`, {
      facilityId: facility,
      serviceId: service.service.id,
      code: service.tariff.code,
      description: 'Synthetic retry tariff',
      department: 'laboratory',
      unit: 'Service',
      fee: '456.00',
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      autoBill: true,
      expectedRevision: disabled.body.revision,
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    const unreviewed = await call('POST', `/api/billing/charge-attempts/${attempt.id}/retry`, {
      facilityId: facility,
    });
    expect(unreviewed.body).toMatchObject({
      status: 'PENDING',
      result: { charged: false, diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' } },
    });
    const billed = await call('POST', `/api/billing/charge-attempts/${attempt.id}/retry`, {
      facilityId: facility,
      priceReview: {
        tariffId: service.tariff.id,
        revision: configured.body.revision,
        unitPrice: '456.00',
        reason: 'Synthetic reviewed applicable laboratory price',
      },
    });
    expect(billed.body).toMatchObject({
      status: 'BILLED',
      result: { charged: true, tariffCode: service.tariff.code, totalAmount: '456.00' },
    });
    const repeated = await call('POST', `/api/billing/charge-attempts/${attempt.id}/retry`, {
      facilityId: facility,
    });
    expect(repeated.body.result.reason).toBe('DUPLICATE');
    expect(
      (
        await pool.query(
          "SELECT tariff_id,unit_price::text FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([{ tariff_id: service.tariff.id, unit_price: '456.00' }]);
  });

  it('does not disable bed-night identity when a newer queue column is missing', async () => {
    const client = await pool.connect();
    try {
      await client.query(
        'CREATE TEMP TABLE billing_charge_attempts (LIKE public.billing_charge_attempts INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS',
      );
      await client.query('ALTER TABLE billing_charge_attempts ALTER COLUMN id SET DEFAULT 1');
      await client.query('ALTER TABLE billing_charge_attempts DROP COLUMN diagnosis_code');
      const tempDb = drizzle(client);
      const request = {
        tenantId: tenant,
        facilityId: facility,
        patientId: patient,
        sourceType: 'BED_DAY' as const,
        sourceId: 900001,
        itemType: 'Bed',
        codes: [],
        idempotencySuffix: '2026-10-01',
        wardType: 'Synthetic ward',
      };
      const result = {
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED' as const,
        message: 'Synthetic missing price',
      };
      expect(await recordChargeAttempt(tempDb, request, result)).toBeNull();
      await client.query('ALTER TABLE billing_charge_attempts ADD COLUMN diagnosis_code text');
      expect(await recordChargeAttempt(tempDb, request, result)).toBe(1);
      expect(
        (await client.query('SELECT idempotency_suffix,ward_type FROM billing_charge_attempts'))
          .rows,
      ).toEqual([{ idempotency_suffix: '2026-10-01', ward_type: 'Synthetic ward' }]);
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.billing_charge_attempts');
      client.release();
    }
  });

  it('adds diagnostic and code snapshots without rewriting historical queue or laboratory rows', async () => {
    const client = await pool.connect();
    try {
      await client.query(
        'CREATE TEMP TABLE billing_charge_attempts (id integer PRIMARY KEY, reason text NOT NULL, detail text) ON COMMIT PRESERVE ROWS',
      );
      await client.query(
        'CREATE TEMP TABLE lab_orders (id integer PRIMARY KEY, facility_service_id integer, test_name text) ON COMMIT PRESERVE ROWS',
      );
      await client.query(
        "INSERT INTO billing_charge_attempts VALUES (1, 'TARIFF_NOT_CONFIGURED', 'Synthetic pending'), (2, 'OLD_REASON', 'Synthetic resolved')",
      );
      await client.query(
        "INSERT INTO lab_orders VALUES (1, 50, 'Synthetic historic order'), (2, NULL, 'Synthetic historic exception')",
      );
      const queueBefore = (
        await client.query('SELECT to_jsonb(t) AS row FROM billing_charge_attempts t ORDER BY id')
      ).rows;
      const ordersBefore = (
        await client.query('SELECT to_jsonb(t) AS row FROM lab_orders t ORDER BY id')
      ).rows;
      await client.query(
        await readFile(
          new URL('../../../drizzle/0058_charge_attempt_diagnosis.sql', import.meta.url),
          'utf8',
        ),
      );
      await client.query(
        await readFile(
          new URL('../../../drizzle/0059_lab_service_code_snapshot.sql', import.meta.url),
          'utf8',
        ),
      );
      expect(
        (
          await client.query(
            "SELECT to_jsonb(t)-'diagnosis_code' AS row FROM billing_charge_attempts t ORDER BY id",
          )
        ).rows,
      ).toEqual(queueBefore);
      expect(
        (
          await client.query(
            "SELECT to_jsonb(t)-'service_code' AS row FROM lab_orders t ORDER BY id",
          )
        ).rows,
      ).toEqual(ordersBefore);
      expect(
        (await client.query('SELECT diagnosis_code FROM billing_charge_attempts ORDER BY id')).rows,
      ).toEqual([{ diagnosis_code: null }, { diagnosis_code: null }]);
      expect((await client.query('SELECT service_code FROM lab_orders ORDER BY id')).rows).toEqual([
        { service_code: null },
        { service_code: null },
      ]);
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.billing_charge_attempts');
      await client.query('DROP TABLE IF EXISTS pg_temp.lab_orders');
      client.release();
    }
  });

  it('applies the scope migration to pre-existing mismatches without rewriting them', async () => {
    const client = await pool.connect();
    try {
      // Temporary shadow tables let this test execute the real migration SQL
      // without altering application tables or trusting any historical data.
      await client.query(
        'CREATE TEMP TABLE facility_services (id integer, facility_id integer, tenant_id integer, UNIQUE (id, facility_id, tenant_id)) ON COMMIT PRESERVE ROWS',
      );
      await client.query(
        'CREATE TEMP TABLE lab_orders (id integer PRIMARY KEY, facility_service_id integer, facility_id integer NOT NULL, tenant_id integer NOT NULL, status text) ON COMMIT PRESERVE ROWS',
      );
      await client.query('INSERT INTO facility_services VALUES (1, 10, 100)');
      await client.query(
        "INSERT INTO lab_orders VALUES (1, 1, 11, 100, 'Ordered'), (2, NULL, 11, 100, 'Ordered')",
      );
      const before = (await client.query('SELECT * FROM lab_orders ORDER BY id')).rows;
      const migration = await readFile(
        new URL('../../../drizzle/0057_lab_service_scope.sql', import.meta.url),
        'utf8',
      );
      await client.query(migration);
      expect((await client.query('SELECT * FROM lab_orders ORDER BY id')).rows).toEqual(before);
      await client.query('BEGIN');
      const status = (
        await client.query(
          "SELECT convalidated FROM pg_constraint WHERE conrelid='pg_temp.lab_orders'::regclass AND conname='lab_orders_facility_service_scope_fk'",
        )
      ).rows[0];
      expect(status.convalidated).toBe(false);
      await client.query('SAVEPOINT invalid_scope');
      await expect(
        client.query("INSERT INTO lab_orders VALUES (3, 1, 11, 100, 'Ordered')"),
      ).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_scope');
      await client.query(
        "INSERT INTO lab_orders VALUES (4, 1, 10, 100, 'Ordered'), (5, NULL, 11, 100, 'Ordered')",
      );
      await client.query("UPDATE lab_orders SET status='Completed' WHERE id=1");
      expect((await client.query('SELECT status FROM lab_orders WHERE id=1')).rows[0].status).toBe(
        'Completed',
      );
    } finally {
      await client.query('ROLLBACK');
      await client.query('DROP TABLE IF EXISTS pg_temp.lab_orders');
      await client.query('DROP TABLE IF EXISTS pg_temp.facility_services');
      client.release();
    }
  });

  it('enforces facility and tenant identity on new laboratory order writes in PostgreSQL', async () => {
    const constraint = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid='lab_orders'::regclass AND conname='lab_orders_facility_service_scope_fk'",
    );
    expect(constraint.rows).toHaveLength(1);
    const visit = await makeEncounter(other, otherPatient, otherToken);
    await expect(
      pool.query(
        "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,facility_service_id,test_name,specimen_type) VALUES($1,$2,$3,$4,$5,'Synthetic cross-scope','Synthetic')",
        [tenant, other, otherPatient, visit.id, blood.service.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
