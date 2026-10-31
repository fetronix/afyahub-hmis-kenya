import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Facility-owned services and clinical billing (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, other: number, actor: number, patient: number, role: number;
  let base: string, token: string, otherToken: string, close: () => Promise<void>;
  const modules = [
    'registration',
    'finance',
    'opd',
    'laboratory',
    'radiology',
    'pharmacy',
    'inpatient',
    'maternity',
    'theatre',
  ];
  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });
  const createService = async (
    code: string,
    category: string,
    department: string,
    price: string,
    unit: string,
    session = token,
    target = facility,
  ) => {
    const result = await call(
      'POST',
      '/api/facility-services',
      {
        facilityId: target,
        code,
        name: `Synthetic ${code}`,
        description: `Synthetic ${code}`,
        department,
        category,
        unit,
        initialPrice: price,
        isActive: true,
        autoBill: true,
      },
      session,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  };
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('A disposable synthetic test database is required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic ${suffix}`,
        `facility-billing-${suffix}`,
      ])
    ).rows[0].id;
    [facility, other] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$4::jsonb),($1,$3,'Synthetic B',$4::jsonb) RETURNING id",
        [tenant, `FA-${suffix}`, `FB-${suffix}`, JSON.stringify(modules)],
      )
    ).rows.map((row) => row.id);
    [actor] = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic clinician','test-only','ACTIVE',$3,$4) RETURNING id",
        [`facility-a-${suffix}`, `facility-a-${suffix}@example.test`, tenant, facility],
      )
    ).rows.map((row) => row.id);
    const otherActor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic clinician B','test-only','ACTIVE',$3,$4) RETURNING id",
        [`facility-b-${suffix}`, `facility-b-${suffix}@example.test`, tenant, other],
      )
    ).rows[0].id;
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Billing','2000-01-01','Other') RETURNING id",
        [tenant, facility, `FS-${suffix}`],
      )
    ).rows[0].id;
    role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$3),($2,$3)', [
      actor,
      otherActor,
      role,
    ]);
    for (const permission of [
      'patients.read',
      'clinical.create',
      'clinical.read',
      'clinical.update',
      'maternity.read',
      'maternity.update',
      'inpatient.read',
      'inpatient.admit',
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
    token = (await createSession({ userId: actor, securityVersion: 1 })).sessionToken;
    otherToken = (await createSession({ userId: otherActor, securityVersion: 1 })).sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('keeps retired master endpoints unavailable without changing historical prices', async () => {
    const master = (
      await pool.query(
        'SELECT id FROM master_services WHERE tenant_id IS NULL AND origin_facility_id IS NULL ORDER BY id LIMIT 1',
      )
    ).rows[0].id;
    const historical = (
      await pool.query(
        `INSERT INTO facility_service_tariffs
          (tenant_id,facility_id,code,description,department,unit,fee,master_service_id,is_active,auto_bill)
         VALUES($1,$2,$3,'Synthetic historical master tariff','finance','Service',12.34,$4,false,false)
         RETURNING id,master_service_id,facility_service_id,fee::text,is_active,auto_bill`,
        [tenant, other, `JC-HISTORY-${suffix}`, master],
      )
    ).rows[0];
    const list = await call(
      'GET',
      `/api/facility-tariffs?facilityId=${other}`,
      undefined,
      otherToken,
    );
    expect(list.status).toBe(200);
    expect(list.body.find((row: { id: number }) => row.id === historical.id)).toMatchObject({
      masterServiceId: master,
      facilityServiceId: null,
      fee: '12.34',
    });
    const paths: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['GET', `/api/master-tariffs?facilityId=${other}`, undefined],
      ['GET', `/api/master-tariff-sources?facilityId=${other}`, undefined],
      ['POST', '/api/master-tariffs/sync', { facilityId: other }],
      ['PUT', '/api/master-tariffs/batch', { facilityId: other, rows: [] }],
      ['POST', `/api/master-tariffs/${historical.id}/approve`, { facilityId: other }],
      ['GET', `/api/master-tariffs/${historical.id}/history?facilityId=${other}`, undefined],
      ['GET', `/api/master-tariffs/${master}/mappings?facilityId=${other}`, undefined],
      ['POST', `/api/master-tariffs/${master}/source-mapping`, { facilityId: other }],
    ];
    for (const [method, path, body] of paths) {
      expect((await call(method, path, body, otherToken)).status, `${method} ${path}`).toBe(404);
    }
    const retained = (
      await pool.query(
        'SELECT id,master_service_id,facility_service_id,fee::text,is_active,auto_bill FROM facility_service_tariffs WHERE id=$1',
        [historical.id],
      )
    ).rows[0];
    expect(retained).toEqual(historical);
  });

  it('persists direct facility services and tariffs, applies isolation and safely archives', async () => {
    const a = await createService('SHARED-CODE', 'OTHER', 'finance', '25.00', 'Service');
    const b = await createService(
      'SHARED-CODE',
      'OTHER',
      'finance',
      '33.00',
      'Service',
      otherToken,
      other,
    );
    expect(a.service.id).not.toBe(b.service.id);
    expect((await call('GET', `/api/facility-services?facilityId=${other}`)).status).toBe(403);
    expect(
      (await call('GET', `/api/facility-services?facilityId=${facility}`, undefined, '')).status,
    ).toBe(401);
    const list = await call('GET', `/api/facility-services?facilityId=${facility}`);
    expect(list.body.some((x: { id: number }) => x.id === a.service.id)).toBe(true);
    expect(list.body.some((x: { id: number }) => x.id === b.service.id)).toBe(false);
    expect(
      (
        await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [
          a.tariff.id,
        ])
      ).rows[0].fee,
    ).toBe('25.00');
    const edit = await call('PUT', `/api/facility-tariffs/${a.tariff.id}`, {
      facilityId: facility,
      serviceId: a.service.id,
      code: 'SHARED-CODE',
      description: 'Synthetic revised',
      department: 'finance',
      unit: 'Service',
      fee: '29.50',
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      autoBill: true,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.fee).toBe('29.50');
    expect(
      (
        await call('PATCH', `/api/facility-tariffs/${a.tariff.id}/status`, {
          facilityId: facility,
          isActive: false,
        })
      ).status,
    ).toBe(200);
    const inactive = await call(
      'GET',
      `/api/facility-services/available?facilityId=${facility}&department=finance`,
    );
    expect(inactive.body.find((x: { id: number }) => x.id === a.service.id)).toMatchObject({
      unitPrice: null,
    });
    expect(
      (
        await call('PATCH', `/api/facility-tariffs/${a.tariff.id}/status`, {
          facilityId: facility,
          isActive: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `/api/facility-services/${a.service.id}/status`, {
          facilityId: facility,
          isActive: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'GET',
          `/api/facility-services/available?facilityId=${facility}&department=finance`,
        )
      ).body.some((x: { id: number }) => x.id === a.service.id),
    ).toBe(false);
    expect(
      (
        await call('PATCH', `/api/facility-services/${a.service.id}/status`, {
          facilityId: facility,
          isActive: true,
        })
      ).status,
    ).toBe(200);
    const extra = await call('POST', '/api/facility-tariffs', {
      facilityId: facility,
      serviceId: a.service.id,
      code: 'EXTRA-SYN',
      description: 'Synthetic spare',
      department: 'finance',
      unit: 'Service',
      fee: '27.00',
      isActive: false,
      autoBill: true,
    });
    expect(extra.status, JSON.stringify(extra.body)).toBe(201);
    expect(
      (await call('DELETE', `/api/facility-tariffs/${extra.body.id}?facilityId=${facility}`))
        .status,
    ).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT is_active, archived_at IS NOT NULL archived FROM facility_service_tariffs WHERE id=$1',
          [extra.body.id],
        )
      ).rows[0],
    ).toEqual({ is_active: false, archived: true });
    expect(
      (
        await call(
          'GET',
          `/api/facility-tariffs/by-service-code/SHARED-CODE?facilityId=${facility}`,
        )
      ).body.tariff.fee,
    ).toBe('29.50');
    expect((await call('GET', `/api/master-tariffs?facilityId=${facility}`)).status).toBe(404);
  });

  it('records consultation, laboratory and imaging only on completion and deduplicates retries', async () => {
    const consult = await createService('CONS-SYN', 'CONSULTATION', 'opd', '150.00', 'Visit');
    const lab = await createService('LAB-SYN', 'LABORATORY', 'laboratory', '80.00', 'Test');
    const image = await createService('RAD-SYN', 'RADIOLOGY', 'radiology', '300.00', 'Examination');
    const payload = {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
      idempotencyKey: randomUUID(),
    };
    const visit = await call('POST', '/api/encounters', payload);
    expect(visit.status, JSON.stringify(visit.body)).toBe(201);
    expect(visit.body.consultationFacilityServiceId).toBe(consult.service.id);
    expect((await call('POST', '/api/encounters', payload)).body.id).toBe(visit.body.id);
    const batch = {
      patientId: patient,
      encounterId: visit.body.id,
      facilityServiceId: lab.service.id,
      specimenType: 'Synthetic blood',
      clinicalIndication: 'Synthetic indication',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    };
    const order = await call('POST', '/api/lab-orders/batch', batch);
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body.orders[0]).toMatchObject({
      facilityServiceId: lab.service.id,
      specimenType: 'Synthetic blood',
      clinicalException: false,
    });
    expect((await call('POST', '/api/lab-orders/batch', batch)).body.orders[0].id).toBe(
      order.body.orders[0].id,
    );
    const radiologyPayload = {
      facilityId: facility,
      patientId: patient,
      encounterId: visit.body.id,
      facilityServiceId: image.service.id,
      modality: 'X-Ray',
      procedureName: 'Synthetic RAD-SYN',
      clinicalIndication: 'Synthetic indication',
      idempotencyKey: randomUUID(),
    };
    const imaging = await call('POST', '/api/radiology-orders', radiologyPayload);
    expect(imaging.status, JSON.stringify(imaging.body)).toBe(201);
    expect((await call('POST', '/api/radiology-orders', radiologyPayload)).body.id).toBe(
      imaging.body.id,
    );
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
          visit.body.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await call('PUT', `/api/lab-orders/${order.body.orders[0].id}/status`, {
          status: 'Sample Collected',
        })
      ).status,
    ).toBe(200);
    const result = await call('POST', '/api/lab-results', {
      orderId: order.body.orders[0].id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(200);
    const completed = await call('POST', `/api/lab-orders/${order.body.orders[0].id}/complete`, {});
    expect(completed.body.billing, JSON.stringify(completed.body)).toMatchObject({
      charged: true,
      totalAmount: '80.00',
    });
    expect(
      (await call('POST', `/api/lab-orders/${order.body.orders[0].id}/complete`, {})).body.billing
        .reason,
    ).toBe('DUPLICATE');
    const report = await call('PUT', `/api/radiology-orders/${imaging.body.id}/report`, {
      findings: 'Synthetic',
      impression: 'Synthetic',
      reportedBy: 'Synthetic clinician',
    });
    expect(report.body.billing, JSON.stringify(report.body)).toMatchObject({
      charged: true,
      totalAmount: '300.00',
    });
    const done = await call('PUT', `/api/encounters/${visit.body.id}`, { status: 'Completed' });
    expect(done.body.billing, JSON.stringify(done.body)).toMatchObject({
      charged: true,
      totalAmount: '150.00',
    });
    const invoices = await pool.query(
      'SELECT id,total_amount::text,paid_amount::text,balance_amount::text FROM billing_invoices WHERE encounter_id=$1',
      [visit.body.id],
    );
    expect(invoices.rows).toHaveLength(1);
    expect(invoices.rows[0]).toMatchObject({
      total_amount: '530.00',
      paid_amount: '0.00',
      balance_amount: '530.00',
    });
    const items = await pool.query(
      'SELECT facility_service_id,tariff_id,service_code,quantity,unit_price::text,total_amount::text,source_type FROM billing_items WHERE invoice_id=$1 ORDER BY id',
      [invoices.rows[0].id],
    );
    expect(items.rows).toHaveLength(3);
    expect(items.rows.map((x) => x.source_type).sort()).toEqual([
      'CONSULTATION',
      'LAB_ORDER',
      'RADIOLOGY',
    ]);
    expect(items.rows.map((x) => Number(x.facility_service_id)).sort()).toEqual(
      [consult.service.id, lab.service.id, image.service.id].sort(),
    );
    expect(
      (await call('DELETE', `/api/facility-tariffs/${lab.tariff.id}?facilityId=${facility}`))
        .status,
    ).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT tariff_id,unit_price::text FROM billing_items WHERE invoice_id=$1 AND source_type=$2',
          [invoices.rows[0].id, 'LAB_ORDER'],
        )
      ).rows[0],
    ).toEqual({ tariff_id: lab.tariff.id, unit_price: '80.00' });
    const paymentPayload = {
      facilityId: facility,
      invoiceId: invoices.rows[0].id,
      amount: '200.00',
      paymentMethod: 'Cash',
      idempotencyKey: randomUUID(),
    };
    const paid = await call('POST', '/api/billing/payments', paymentPayload);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await call('POST', '/api/billing/payments', paymentPayload)).status).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT paid_amount::text,balance_amount::text FROM billing_invoices WHERE id=$1',
          [invoices.rows[0].id],
        )
      ).rows[0],
    ).toEqual({ paid_amount: '200.00', balance_amount: '330.00' });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_payments WHERE invoice_id=$1', [
          invoices.rows[0].id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('keeps an unpriced clinical order and creates unresolved billing work without charging zero', async () => {
    const unpriced = await createService('LAB-ZERO', 'LABORATORY', 'laboratory', '0.00', 'Test');
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
    });
    const order = await call('POST', '/api/lab-orders/batch', {
      patientId: patient,
      encounterId: visit.body.id,
      facilityServiceId: unpriced.service.id,
      specimenType: 'Synthetic urine',
      clinicalIndication: 'Synthetic',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const labOrder = order.body.orders[0];
    expect(
      (await call('PUT', `/api/lab-orders/${labOrder.id}/status`, { status: 'Sample Collected' }))
        .status,
    ).toBe(200);
    const result = await call('POST', '/api/lab-results', {
      orderId: labOrder.id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    await call('POST', `/api/lab-results/${result.body.id}/verify`, {});
    const done = await call('POST', `/api/lab-orders/${labOrder.id}/complete`, {});
    expect(done.body.billing).toMatchObject({ charged: false, diagnosis: { code: 'ZERO_PRICE' } });
    expect(
      (await pool.query('SELECT status FROM lab_orders WHERE id=$1', [labOrder.id])).rows[0].status,
    ).toBe('Completed');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
          [facility, labOrder.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [labOrder.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const attempt = (
      await pool.query(
        "SELECT id FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2",
        [facility, labOrder.id],
      )
    ).rows[0].id;
    const updated = await call('PUT', `/api/facility-tariffs/${unpriced.tariff.id}`, {
      facilityId: facility,
      serviceId: unpriced.service.id,
      code: 'LAB-ZERO',
      description: 'Synthetic priced after completion',
      department: 'laboratory',
      unit: 'Test',
      fee: '45.00',
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      autoBill: true,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const retry = await call('POST', `/api/billing/charge-attempts/${attempt}/retry`, {
      facilityId: facility,
    });
    expect(retry.body, JSON.stringify(retry.body)).toMatchObject({
      status: 'BILLED',
      result: { charged: true, totalAmount: '45.00' },
    });
    const retryAgain = await call('POST', `/api/billing/charge-attempts/${attempt}/retry`, {
      facilityId: facility,
    });
    expect(retryAgain.body.result.reason).toBe('DUPLICATE');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [labOrder.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('creates a manual invoice against a direct service tariff using server-side prices', async () => {
    const service = await createService('MANUAL-SYN', 'OTHER', 'finance', '21.75', 'Service');
    const input = {
      invoice: { facilityId: facility, patientId: patient, invoiceNumber: `SYN-MANUAL-${suffix}` },
      items: [{ tariffId: service.tariff.id, quantity: 2, unitPrice: '1.00' }],
    };
    const invoice = await call('POST', '/api/invoices', input);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect(invoice.body.totalAmount).toBe('43.50');
    const items = (
      await pool.query(
        'SELECT facility_service_id,tariff_id,unit_price::text FROM billing_items WHERE invoice_id=$1',
        [invoice.body.id],
      )
    ).rows;
    expect(items).toEqual([
      {
        facility_service_id: service.service.id,
        tariff_id: service.tariff.id,
        unit_price: '21.75',
      },
    ]);
  });

  it('atomically submits a multi-investigation batch with an explicit specimen for each line', async () => {
    const one = await createService('MULTI-COUNT', 'LABORATORY', 'laboratory', '20.00', 'Test');
    const two = await createService('MULTI-URINE', 'LABORATORY', 'laboratory', '30.00', 'Test');
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
    });
    const body = {
      patientId: patient,
      encounterId: visit.body.id,
      clinicalIndication: 'Synthetic',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
      orderLines: [
        { facilityServiceId: one.service.id, specimenType: 'Synthetic blood' },
        { facilityServiceId: two.service.id, specimenType: 'Synthetic urine' },
        { investigation: 'Synthetic unlisted test', specimenType: 'Synthetic swab' },
      ],
    };
    const result = await call('POST', '/api/lab-orders/batch', body);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body.orders.map((x: { specimenType: string }) => x.specimenType)).toEqual([
      'Synthetic blood',
      'Synthetic urine',
      'Synthetic swab',
    ]);
    expect(
      result.body.orders.map((x: { clinicalException: boolean }) => x.clinicalException),
    ).toEqual([false, false, true]);
    const replay = await call('POST', '/api/lab-orders/batch', body);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.orders.map((x: { id: number }) => x.id).sort()).toEqual(
      result.body.orders.map((x: { id: number }) => x.id).sort(),
    );
    expect(
      (
        await call('POST', '/api/lab-orders/batch', {
          ...body,
          orderLines: [body.orderLines[0], body.orderLines[0]],
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/lab-orders/batch', {
          ...body,
          orderLines: [{ facilityServiceId: one.service.id, specimenType: '' }],
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
  });
  it('persists an explicitly selected delivery, bills once, and keeps missing prices in clinical care', async () => {
    const deliveryService = await createService(
      'DELIVERY-SYN',
      'DELIVERY',
      'maternity',
      '275.00',
      'Delivery',
    );
    const foreignService = await createService(
      'DELIVERY-FOREIGN',
      'DELIVERY',
      'maternity',
      '999.00',
      'Delivery',
      otherToken,
      other,
    );
    const pregnancy = async () =>
      (
        await pool.query(
          "INSERT INTO maternity_pregnancies(tenant_id,facility_id,patient_id,booked_at,edd_date) VALUES($1,$2,$3,'2026-01-01','2026-10-01') RETURNING id",
          [tenant, facility, patient],
        )
      ).rows[0].id;
    const first = await pregnancy();
    const input = {
      pregnancyId: first,
      deliveredAt: new Date().toISOString(),
      deliveryMode: 'Spontaneous Vertex',
      babies: [{ outcome: 'Live Birth' }],
    };
    const bad = await call('POST', '/api/maternity/deliveries', {
      ...input,
      facilityServiceId: foreignService.service.id,
    });
    expect(bad.status).toBe(400);
    expect(
      (await pool.query('SELECT COUNT(*)::int n FROM deliveries WHERE pregnancy_id=$1', [first]))
        .rows[0].n,
    ).toBe(0);
    const submitted = await Promise.all([
      call('POST', '/api/maternity/deliveries', {
        ...input,
        facilityServiceId: deliveryService.service.id,
      }),
      call('POST', '/api/maternity/deliveries', {
        ...input,
        facilityServiceId: deliveryService.service.id,
      }),
    ]);
    expect(submitted.map((entry) => entry.status).sort()).toEqual([201, 409]);
    const created = submitted.find((entry) => entry.status === 201)!;
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.delivery.facilityServiceId).toBe(deliveryService.service.id);
    expect(created.body.billing).toMatchObject({ charged: true, totalAmount: '275.00' });
    const lines = await pool.query(
      "SELECT facility_service_id,tariff_id,unit_price::text FROM billing_items WHERE source_type='MATERNITY' AND source_id=$1",
      [String(created.body.delivery.id)],
    );
    expect(lines.rows).toEqual([
      {
        facility_service_id: deliveryService.service.id,
        tariff_id: deliveryService.tariff.id,
        unit_price: '275.00',
      },
    ]);
    expect(
      (
        await call('POST', '/api/maternity/deliveries', {
          ...input,
          facilityServiceId: deliveryService.service.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n FROM billing_items WHERE source_type='MATERNITY' AND source_id=$1",
          [String(created.body.delivery.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    const second = await pregnancy();
    const unpriced = await createService(
      'DELIVERY-UNPRICED',
      'DELIVERY',
      'maternity',
      '0.00',
      'Delivery',
    );
    const recorded = await call('POST', '/api/maternity/deliveries', {
      ...input,
      pregnancyId: second,
      facilityServiceId: unpriced.service.id,
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    expect(recorded.body.billing).toMatchObject({
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    expect(
      (
        await pool.query('SELECT COUNT(*)::int n FROM delivery_babies WHERE delivery_id=$1', [
          recorded.body.delivery.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n FROM billing_items WHERE source_type='MATERNITY' AND source_id=$1",
          [String(recorded.body.delivery.id)],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n FROM billing_charge_attempts WHERE source_type='MATERNITY' AND source_id=$1 AND status='PENDING'",
          [String(recorded.body.delivery.id)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('replays an imaging request after its service changes, without leaking it across actors or facilities', async () => {
    const image = await createService(
      'RAD-REPLAY',
      'RADIOLOGY',
      'radiology',
      '43.00',
      'Examination',
    );
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
    });
    const body = {
      facilityId: facility,
      patientId: patient,
      encounterId: visit.body.id,
      facilityServiceId: image.service.id,
      procedureName: 'Synthetic RAD-REPLAY',
      modality: 'X-ray',
      clinicalIndication: 'Synthetic replay',
      idempotencyKey: randomUUID(),
    };
    const created = await call('POST', '/api/radiology-orders', body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const deactivated = await call('PATCH', `/api/facility-services/${image.service.id}/status`, {
      facilityId: facility,
      isActive: false,
    });
    expect(deactivated.status).toBe(200);
    const renamed = await call('PUT', `/api/facility-services/${image.service.id}`, {
      facilityId: facility,
      code: 'RAD-REPLAY',
      name: 'Synthetic renamed examination',
      description: 'Synthetic renamed examination',
      department: 'radiology',
      category: 'RADIOLOGY',
      unit: 'Examination',
      isActive: false,
      autoBill: true,
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    const replay = await call('POST', '/api/radiology-orders', body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({ id: created.body.id, idempotentReplay: true });
    const conflict = await call('POST', '/api/radiology-orders', {
      ...body,
      clinicalIndication: 'Changed',
    });
    expect(conflict.status).toBe(409);
    const foreign = await call('POST', '/api/radiology-orders', body, otherToken);
    expect(foreign.status).toBe(403);
    expect(
      (
        await pool.query('SELECT COUNT(*)::int n FROM radiology_orders WHERE id=$1', [
          created.body.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it('replays a keyed encounter after service deactivation and rejects changed payloads', async () => {
    const chosen = await createService('CONS-REPLAY', 'CONSULTATION', 'opd', '35.00', 'Visit');
    const alternative = await createService(
      'CONS-REPLAY-OTHER',
      'CONSULTATION',
      'opd',
      '55.00',
      'Visit',
    );
    const body = {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
      consultationFacilityServiceId: chosen.service.id,
      idempotencyKey: randomUUID(),
    };
    const created = await call('POST', '/api/encounters', body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(
      (
        await call('PATCH', `/api/facility-services/${chosen.service.id}/status`, {
          facilityId: facility,
          isActive: false,
        })
      ).status,
    ).toBe(200);
    const replay = await call('POST', '/api/encounters', body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({ id: created.body.id, idempotentReplay: true });
    expect(
      (
        await call('POST', '/api/encounters', {
          ...body,
          consultationFacilityServiceId: alternative.service.id,
        })
      ).status,
    ).toBe(409);
    expect((await call('POST', '/api/encounters', body, otherToken)).status).toBe(403);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM encounter_creation_requests WHERE idempotency_key=$1',
          [body.idempotencyKey],
        )
      ).rows[0].n,
    ).toBe(1);

    const sole = await createService(
      'CONS-SOLE-REPLAY',
      'CONSULTATION',
      'opd',
      '22.00',
      'Visit',
      otherToken,
      other,
    );
    const implicit = {
      facilityId: other,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
      idempotencyKey: randomUUID(),
    };
    const one = await call('POST', '/api/encounters', implicit, otherToken);
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.body.consultationFacilityServiceId).toBe(sole.service.id);
    expect(
      (
        await call(
          'PATCH',
          `/api/facility-services/${sole.service.id}/status`,
          { facilityId: other, isActive: false },
          otherToken,
        )
      ).status,
    ).toBe(200);
    const second = await call('POST', '/api/encounters', implicit, otherToken);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: one.body.id, idempotentReplay: true });
  });

  it('persists the selected admission identity and bills an exact occupied ward day once', async () => {
    const admissionService = await createService(
      'ADMISSION-SYN',
      'ADMISSION',
      'inpatient',
      '60.00',
      'Admission',
    );
    await createService('ADMISSION-ALT', 'ADMISSION', 'inpatient', '80.00', 'Admission');
    const wardService = await createService('WARD-SYN', 'BED_DAY', 'inpatient', '90.00', 'Day');
    const foreign = await createService(
      'ADMISSION-FOREIGN',
      'ADMISSION',
      'inpatient',
      '99.00',
      'Admission',
      otherToken,
      other,
    );
    const ward = (
      await pool.query(
        "INSERT INTO wards(facility_id,code,name) VALUES($1,'WARD-SYN','Synthetic ward') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    const bed = (
      await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'SYN-1') RETURNING id", [
        ward,
      ])
    ).rows[0].id;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const body = {
      facilityId: facility,
      patientId: patient,
      wardId: ward,
      bedId: bed,
      admissionDate: `${today} 08:00`,
      facilityServiceId: admissionService.service.id,
    };
    expect(
      (await call('POST', '/api/admissions', { ...body, facilityServiceId: foreign.service.id }))
        .status,
    ).toBe(400);
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toMatchObject({ status: 'Available', current_patient_id: null });
    const admitted = await call('POST', '/api/admissions', body);
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect(admitted.body.facilityServiceId).toBe(admissionService.service.id);
    expect(admitted.body.billing).toMatchObject({ charged: true, totalAmount: '60.00' });
    const accrued = await call('POST', `/api/admissions/${admitted.body.id}/accrue-bed-days`, {
      untilDate: today,
    });
    expect(accrued.status, JSON.stringify(accrued.body)).toBe(200);
    expect(accrued.body.charges).toHaveLength(1);
    expect(accrued.body.charges[0]).toMatchObject({ charged: true, totalAmount: '90.00' });
    const replay = await call('POST', `/api/admissions/${admitted.body.id}/accrue-bed-days`, {
      untilDate: today,
    });
    expect(replay.body.charges[0]).toMatchObject({ charged: false, reason: 'DUPLICATE' });
    const lines = (
      await pool.query(
        "SELECT source_type,facility_service_id,unit_price::text FROM billing_items WHERE source_id=$1 AND source_type IN ('ADMISSION','BED_DAY') ORDER BY source_type",
        [admitted.body.id],
      )
    ).rows;
    expect(lines).toEqual([
      {
        source_type: 'ADMISSION',
        facility_service_id: admissionService.service.id,
        unit_price: '60.00',
      },
      { source_type: 'BED_DAY', facility_service_id: wardService.service.id, unit_price: '90.00' },
    ]);
  });

  it('bills a completed exact-code procedure and not an unconfirmed procedure', async () => {
    const service = await createService('PROC-SYN', 'PROCEDURE', 'opd', '75.00', 'Procedure');
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
    });
    const body = {
      encounterId: visit.body.id,
      patientId: patient,
      procedureCode: 'PROC-SYN',
      procedureName: 'Synthetic procedure',
    };
    const pending = await call('POST', '/api/procedures', { ...body, status: 'Pending' });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    expect(pending.body.billing).toBeNull();
    const performed = await call('POST', '/api/procedures', { ...body, status: 'Completed' });
    expect(performed.status, JSON.stringify(performed.body)).toBe(201);
    expect(performed.body.billing).toMatchObject({ charged: true, totalAmount: '75.00' });
    const lines = (
      await pool.query(
        "SELECT facility_service_id,unit_price::text FROM billing_items WHERE source_type='PROCEDURE' AND source_id=$1",
        [performed.body.id],
      )
    ).rows;
    expect(lines).toEqual([{ facility_service_id: service.service.id, unit_price: '75.00' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='PROCEDURE' AND source_id=$1",
          [pending.body.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('permanently deletes an unused service and all its unused tariffs with scoped audit records', async () => {
    const created = await createService('DELETE-SERVICE', 'OTHER', 'finance', '15.00', 'Service');
    const extra = await call('POST', '/api/facility-tariffs', {
      facilityId: facility,
      serviceId: created.service.id,
      code: 'DELETE-SERVICE-ALT',
      description: 'Synthetic spare tariff',
      department: 'finance',
      unit: 'Service',
      fee: '7.00',
      isActive: false,
      autoBill: true,
    });
    expect(extra.status, JSON.stringify(extra.body)).toBe(201);
    const path = `/api/facility-services/${created.service.id}/permanent`;
    expect((await call('DELETE', `${path}?facilityId=${facility}`, undefined, '')).status).toBe(
      401,
    );
    expect(
      (await call('DELETE', `${path}?facilityId=${facility}`, undefined, otherToken)).status,
    ).toBe(403);
    expect(
      (await call('DELETE', `${path}?facilityId=${other}`, undefined, otherToken)).status,
    ).toBe(404);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
          created.service.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    const deleted = await call('DELETE', `${path}?facilityId=${facility}`);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, id: created.service.id, deletedTariffs: 2 });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
          created.service.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE id=ANY($1::int[])',
          [[created.tariff.id, extra.body.id]],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await call('GET', `/api/facility-services?facilityId=${facility}`)).body.some(
        (row: { id: number }) => row.id === created.service.id,
      ),
    ).toBe(false);
    const audits = (
      await pool.query(
        "SELECT resource,resource_id,user_id,details FROM audit_logs WHERE facility_id=$1 AND action='DELETE' AND ((resource='FACILITY_SERVICE' AND resource_id=$2) OR (resource='FACILITY_SERVICE_TARIFF' AND resource_id=ANY($3::text[]))) ORDER BY id",
        [facility, String(created.service.id), [String(created.tariff.id), String(extra.body.id)]],
      )
    ).rows;
    expect(audits).toHaveLength(3);
    expect(audits.every((row: { user_id: string }) => row.user_id === String(actor))).toBe(true);
    expect(
      JSON.parse(
        audits.find((row: { resource: string }) => row.resource === 'FACILITY_SERVICE').details,
      ),
    ).toMatchObject({
      code: 'DELETE-SERVICE',
      deletedTariffIds: [created.tariff.id, extra.body.id],
    });
    const replacement = await createService(
      'DELETE-SERVICE',
      'OTHER',
      'finance',
      '16.00',
      'Service',
    );
    expect(replacement.service.id).not.toBe(created.service.id);
    expect((await call('DELETE', `${path}?facilityId=${facility}`)).status).toBe(404);
  });

  it('permanently deletes an unused tariff without deleting its service, including an archived tariff', async () => {
    const created = await createService('DELETE-TARIFF', 'OTHER', 'finance', '25.00', 'Service');
    const path = `/api/facility-tariffs/${created.tariff.id}/permanent`;
    expect(
      (await call('DELETE', `${path}?facilityId=${facility}`, undefined, otherToken)).status,
    ).toBe(403);
    expect(
      (await call('DELETE', `${path}?facilityId=${other}`, undefined, otherToken)).status,
    ).toBe(404);
    const removed = await call('DELETE', `${path}?facilityId=${facility}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body).toEqual({ deleted: true, id: created.tariff.id });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
          created.tariff.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
          created.service.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    const available = await call(
      'GET',
      `/api/facility-services/available?facilityId=${facility}&department=finance`,
    );
    expect(
      available.body.find((row: { id: number }) => row.id === created.service.id),
    ).toMatchObject({ unitPrice: null });
    const replacement = await call('POST', '/api/facility-tariffs', {
      facilityId: facility,
      serviceId: created.service.id,
      code: 'DELETE-TARIFF',
      description: 'Synthetic replacement',
      department: 'finance',
      unit: 'Service',
      fee: '30.00',
      isActive: true,
      autoBill: true,
    });
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(201);
    const archived = await call(
      'DELETE',
      `/api/facility-tariffs/${replacement.body.id}?facilityId=${facility}`,
    );
    expect(archived.body.archivedAt).toBeTruthy();
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
          replacement.body.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    const removedArchived = await call(
      'DELETE',
      `/api/facility-tariffs/${replacement.body.id}/permanent?facilityId=${facility}`,
    );
    expect(removedArchived.status, JSON.stringify(removedArchived.body)).toBe(200);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
          replacement.body.id,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('never deletes invoice-linked services or tariffs and does not partially delete spare tariffs', async () => {
    const created = await createService('DELETE-BILLED', 'OTHER', 'finance', '21.75', 'Service');
    const spare = await call('POST', '/api/facility-tariffs', {
      facilityId: facility,
      serviceId: created.service.id,
      code: 'DELETE-BILLED-ALT',
      description: 'Synthetic spare',
      department: 'finance',
      unit: 'Service',
      fee: '5.00',
      isActive: false,
      autoBill: true,
    });
    expect(spare.status, JSON.stringify(spare.body)).toBe(201);
    const invoice = await call('POST', '/api/invoices', {
      invoice: { facilityId: facility, patientId: patient, invoiceNumber: `SYN-DELETE-${suffix}` },
      items: [{ tariffId: created.tariff.id, quantity: 2 }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const before = (
      await pool.query(
        'SELECT id,tariff_id,facility_service_id,unit_price::text,total_amount::text FROM billing_items WHERE invoice_id=$1',
        [invoice.body.id],
      )
    ).rows;
    const deleteTariff = await call(
      'DELETE',
      `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
    );
    expect(deleteTariff.status, JSON.stringify(deleteTariff.body)).toBe(409);
    expect(deleteTariff.body.error).toBe('TARIFF_IN_USE');
    const deleteService = await call(
      'DELETE',
      `/api/facility-services/${created.service.id}/permanent?facilityId=${facility}`,
    );
    expect(deleteService.status, JSON.stringify(deleteService.body)).toBe(409);
    expect(deleteService.body.error).toBe('SERVICE_IN_USE');
    expect(
      (
        await pool.query(
          'SELECT id,tariff_id,facility_service_id,unit_price::text,total_amount::text FROM billing_items WHERE invoice_id=$1',
          [invoice.body.id],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE id=ANY($1::int[])',
          [[created.tariff.id, spare.body.id]],
        )
      ).rows[0].n,
    ).toBe(2);
    const archived = await call(
      'DELETE',
      `/api/facility-tariffs/${created.tariff.id}?facilityId=${facility}`,
    );
    expect(archived.status).toBe(200);
    expect(
      (
        await call(
          'DELETE',
          `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await pool.query('SELECT tariff_id FROM billing_items WHERE invoice_id=$1', [
          invoice.body.id,
        ])
      ).rows[0].tariff_id,
    ).toBe(created.tariff.id);
  });

  it('protects payer mappings whose tariff foreign key would otherwise be set to null', async () => {
    const created = await createService('DELETE-PAYER', 'OTHER', 'finance', '18.00', 'Service');
    const spare = await call('POST', '/api/facility-tariffs', {
      facilityId: facility,
      serviceId: created.service.id,
      code: 'DELETE-PAYER-ALT',
      description: 'Synthetic spare',
      department: 'finance',
      unit: 'Service',
      fee: '9.00',
      isActive: false,
      autoBill: true,
    });
    expect(spare.status, JSON.stringify(spare.body)).toBe(201);
    const mapping = (
      await pool.query(
        `INSERT INTO payer_service_code_mappings (tenant_id,facility_id,tariff_id,local_code,local_description,service_area,payer_service_code,payer_service_name) VALUES($1,$2,$3,$4,'Synthetic','outpatient','TEST','Synthetic') RETURNING id`,
        [tenant, facility, created.tariff.id, `DELETE-PAYER-${suffix}`],
      )
    ).rows[0].id;
    const tariffResult = await call(
      'DELETE',
      `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
    );
    expect(tariffResult.status, JSON.stringify(tariffResult.body)).toBe(409);
    const serviceResult = await call(
      'DELETE',
      `/api/facility-services/${created.service.id}/permanent?facilityId=${facility}`,
    );
    expect(serviceResult.status, JSON.stringify(serviceResult.body)).toBe(409);
    expect(
      (await pool.query('SELECT tariff_id FROM payer_service_code_mappings WHERE id=$1', [mapping]))
        .rows[0].tariff_id,
    ).toBe(created.tariff.id);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
          created.service.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE id=ANY($1::int[])',
          [[created.tariff.id, spare.body.id]],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it('protects a service linked to an unbilled clinical order', async () => {
    const lab = await createService('DELETE-CLINICAL', 'LABORATORY', 'laboratory', '10.00', 'Test');
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
    });
    expect(visit.status, JSON.stringify(visit.body)).toBe(201);
    const order = await call('POST', '/api/lab-orders/batch', {
      patientId: patient,
      encounterId: visit.body.id,
      facilityServiceId: lab.service.id,
      specimenType: 'Synthetic swab',
      clinicalIndication: 'Synthetic indication',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const result = await call(
      'DELETE',
      `/api/facility-services/${lab.service.id}/permanent?facilityId=${facility}`,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body.error).toBe('SERVICE_IN_USE');
    expect(
      (
        await pool.query('SELECT facility_service_id FROM lab_orders WHERE id=$1', [
          order.body.orders[0].id,
        ])
      ).rows[0].facility_service_id,
    ).toBe(lab.service.id);
  });

  it('serializes a permanent tariff deletion against a concurrent invoice reference', async () => {
    const created = await createService('DELETE-RACE', 'OTHER', 'finance', '12.00', 'Service');
    const invoiceId = (
      await pool.query(
        'INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number) VALUES($1,$2,$3,$4) RETURNING id',
        [tenant, facility, patient, `SYN-RACE-${suffix}`],
      )
    ).rows[0].id;
    const connection = await pool.connect();
    let committed = false;
    try {
      await connection.query('BEGIN');
      await connection.query(
        "INSERT INTO billing_items(invoice_id,tariff_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,$2,'MANUAL','Synthetic concurrent line',1,12,12)",
        [invoiceId, created.tariff.id],
      );
      let settled = false;
      const deleting = call(
        'DELETE',
        `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
      ).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await connection.query('COMMIT');
      committed = true;
      const result = await deleting;
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(
        (await pool.query('SELECT tariff_id FROM billing_items WHERE invoice_id=$1', [invoiceId]))
          .rows[0].tariff_id,
      ).toBe(created.tariff.id);
    } finally {
      if (!committed) await connection.query('ROLLBACK');
      connection.release();
    }
  });
  it('requires both tariff management permission and facility-administrator role', async () => {
    const created = await createService(
      'DELETE-PERMISSION',
      'OTHER',
      'finance',
      '15.00',
      'Service',
    );
    const users = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic limited user','test-only','ACTIVE',$3,$4),($5,$5,$6,'Synthetic non-admin','test-only','ACTIVE',$3,$4) RETURNING id",
        [
          `limited-${suffix}`,
          `limited-${suffix}@example.test`,
          tenant,
          facility,
          `nonadmin-${suffix}`,
          `nonadmin-${suffix}@example.test`,
        ],
      )
    ).rows.map((row) => row.id);
    const roles = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true),($1,$3,true) RETURNING id',
        [tenant, `LIMITED-${suffix}`, `NONADMIN-${suffix}`],
      )
    ).rows.map((row) => row.id);
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2),($3,$4)', [
      users[0],
      roles[0],
      users[1],
      roles[1],
    ]);
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='tariffs.read'",
      [roles[0]],
    );
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='tariffs.manage'",
      [roles[1]],
    );
    const limited = (await createSession({ userId: users[0], securityVersion: 1 })).sessionToken;
    const nonAdmin = (await createSession({ userId: users[1], securityVersion: 1 })).sessionToken;
    for (const session of [limited, nonAdmin]) {
      expect(
        (
          await call(
            'DELETE',
            `/api/facility-services/${created.service.id}/permanent?facilityId=${facility}`,
            undefined,
            session,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            'DELETE',
            `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
            undefined,
            session,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
          created.tariff.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('retains historical master-linked tariffs rather than deleting their provenance', async () => {
    const created = await createService(
      'DELETE-HISTORICAL',
      'OTHER',
      'finance',
      '11.00',
      'Service',
    );
    const master = (
      await pool.query(
        'SELECT id FROM master_services WHERE tenant_id IS NULL AND origin_facility_id IS NULL ORDER BY id LIMIT 1',
      )
    ).rows[0].id;
    await pool.query('UPDATE facility_service_tariffs SET master_service_id=$1 WHERE id=$2', [
      master,
      created.tariff.id,
    ]);
    const result = await call(
      'DELETE',
      `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('TARIFF_IN_USE');
    const serviceResult = await call(
      'DELETE',
      `/api/facility-services/${created.service.id}/permanent?facilityId=${facility}`,
    );
    expect(serviceResult.status).toBe(409);
    expect(
      (
        await pool.query('SELECT master_service_id FROM facility_service_tariffs WHERE id=$1', [
          created.tariff.id,
        ])
      ).rows[0].master_service_id,
    ).toBe(master);
  });
  it('rolls back service and tariff deletion if its audit record cannot be written', async () => {
    const created = await createService('DELETE-AUDIT', 'OTHER', 'finance', '14.00', 'Service');
    const name = `synthetic_delete_audit_${suffix}`;
    // A trigger affecting only this synthetic service simulates an audit
    // failure; only the synthetic trigger and function created here are dropped.
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.facility_id = ${facility} AND NEW.action = 'DELETE' AND NEW.resource = 'FACILITY_SERVICE' AND NEW.resource_id = '${created.service.id}' THEN
          RAISE EXCEPTION 'synthetic audit failure';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      const result = await call(
        'DELETE',
        `/api/facility-services/${created.service.id}/permanent?facilityId=${facility}`,
      );
      expect(result.status).toBe(500);
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
            created.service.id,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
            created.tariff.id,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND action='DELETE' AND resource='FACILITY_SERVICE_TARIFF' AND resource_id=$2",
            [facility, String(created.tariff.id)],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
  it('preserves clinical history which refers to a facility service by exact code rather than ID', async () => {
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
    });
    expect(visit.status, JSON.stringify(visit.body)).toBe(201);
    const proc = await createService('DELETE-CODE-PROC', 'PROCEDURE', 'opd', '18.00', 'Procedure');
    await pool.query(
      "INSERT INTO procedures(encounter_id,patient_id,procedure_code,procedure_name,status) VALUES($1,$2,'delete-code-proc','Synthetic pending procedure','Pending')",
      [visit.body.id, patient],
    );

    const lab = await createService('DELETE-CODE-LAB', 'LABORATORY', 'laboratory', '19.00', 'Test');
    const testId = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,'delete-code-lab','Synthetic legacy test') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_id,test_name) VALUES($1,$2,$3,$4,$5,'Synthetic legacy order')",
      [tenant, facility, patient, visit.body.id, testId],
    );

    const drug = await createService(
      'DELETE-CODE-DRUG',
      'PHARMACY',
      'pharmacy',
      '20.00',
      'Tablets',
    );
    const itemId = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit) VALUES($1,'delete-code-drug','Synthetic product','Tablets') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO pharmacy_dispensations(tenant_id,facility_id,patient_id,item_id,quantity_dispensed,dispensed_by) VALUES($1,$2,$3,$4,1,'Synthetic')",
      [tenant, facility, patient, itemId],
    );

    const bedDay = await createService('DELETE-CODE-WARD', 'BED_DAY', 'inpatient', '21.00', 'Day');
    const wardId = (
      await pool.query(
        "INSERT INTO wards(facility_id,code,name) VALUES($1,'delete-code-ward','Synthetic ward') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    const bedId = (
      await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'SYN') RETURNING id", [
        wardId,
      ])
    ).rows[0].id;
    await pool.query(
      "INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,'2026-10-20','Discharged')",
      [tenant, facility, patient, wardId, bedId],
    );

    for (const entry of [proc, lab, drug, bedDay]) {
      const result = await call(
        'DELETE',
        `/api/facility-services/${entry.service.id}/permanent?facilityId=${facility}`,
      );
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body.error).toBe('SERVICE_IN_USE');
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
            entry.service.id,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
            entry.tariff.id,
          ])
        ).rows[0].n,
      ).toBe(1);
    }
  });
  it('protects new cascade foreign keys without deleting their dependent records', async () => {
    const created = await createService('DELETE-CASCADE', 'OTHER', 'finance', '13.00', 'Service');
    const table = `synthetic_delete_dependency_${suffix}`;
    // This isolated synthetic table models a future relationship not known to
    // the application. Dropping only this test fixture never touches real data.
    await pool.query(
      `CREATE TABLE ${table} (id serial PRIMARY KEY, tariff_id integer NOT NULL REFERENCES facility_service_tariffs(id) ON DELETE CASCADE)`,
    );
    try {
      await pool.query(`INSERT INTO ${table}(tariff_id) VALUES($1)`, [created.tariff.id]);
      const result = await call(
        'DELETE',
        `/api/facility-tariffs/${created.tariff.id}/permanent?facilityId=${facility}`,
      );
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect((await pool.query(`SELECT tariff_id FROM ${table}`)).rows[0].tariff_id).toBe(
        created.tariff.id,
      );
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM facility_service_tariffs WHERE id=$1', [
            created.tariff.id,
          ])
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await pool.query(`DROP TABLE ${table}`);
    }
  });
  it('does not treat another facility’s same-code clinical history as a local dependency', async () => {
    const local = await createService(
      'DELETE-SCOPE-CODE',
      'PROCEDURE',
      'opd',
      '10.00',
      'Procedure',
    );
    const foreign = await createService(
      'DELETE-SCOPE-CODE',
      'PROCEDURE',
      'opd',
      '20.00',
      'Procedure',
      otherToken,
      other,
    );
    const foreignVisit = await call(
      'POST',
      '/api/encounters',
      { facilityId: other, patientId: patient, encounterType: 'Outpatient', status: 'Active' },
      otherToken,
    );
    expect(foreignVisit.status, JSON.stringify(foreignVisit.body)).toBe(201);
    await pool.query(
      "INSERT INTO procedures(encounter_id,patient_id,procedure_code,procedure_name,status) VALUES($1,$2,'DELETE-SCOPE-CODE','Synthetic other-facility procedure','Pending')",
      [foreignVisit.body.id, patient],
    );
    const removed = await call(
      'DELETE',
      `/api/facility-services/${local.service.id}/permanent?facilityId=${facility}`,
    );
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
          local.service.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE id=$1', [
          foreign.service.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
});
