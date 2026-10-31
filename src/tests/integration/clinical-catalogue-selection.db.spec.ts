import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import {
  approveMasterTariff,
  createImagingService,
  editMasterTariffs,
  listMasterCatalogue,
  syncMasterCatalogue,
} from '../../billing/master-catalogue.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

// Synthetic identities, specimen choices and prices in an isolated local test database only.
describeDb('Clinical catalogue, selection and unified billing (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, other: number, actor: number, patient: number, role: number;
  let testA: number,
    testB: number,
    optionA: number,
    optionB: number,
    followUp: number,
    opd: number,
    imaging: number;
  let base: string, token: string, close: () => Promise<void>;
  let facilityRow: { id: number; tenantId: number; enabledModules: unknown };
  const modules = ['registration', 'finance', 'opd', 'laboratory', 'radiology'];
  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });

  async function configure(masterId: number, fee: string, target = facilityRow, reviewer = actor) {
    const row = (await listMasterCatalogue(target)).find((value) => value.master.id === masterId)!;
    const [edited] = await editMasterTariffs(target, reviewer, [
      {
        tariffId: row.tariff!.id,
        revision: row.tariff!.revision,
        fee,
        unit: row.master.unit,
        isActive: true,
        autoBill: true,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ]);
    await approveMasterTariff(
      target,
      reviewer,
      edited.id,
      edited.revision,
      'synthetic price review',
    );
  }
  async function sourceMaster(testId: number) {
    return Number(
      (
        await pool.query(
          "SELECT master_service_id FROM master_service_sources WHERE facility_id=$1 AND source_type='LAB_TEST' AND source_id=$2 AND is_active",
          [facility, testId],
        )
      ).rows[0].master_service_id,
    );
  }
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('A disposable synthetic test database is required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic ${suffix}`,
        `selection-${suffix}`,
      ])
    ).rows[0].id;
    [facility, other] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$4::jsonb),($1,$3,'Synthetic B',$4::jsonb) RETURNING id",
        [tenant, `SA-${suffix}`, `SB-${suffix}`, JSON.stringify(modules)],
      )
    ).rows.map((row) => row.id);
    facilityRow = { id: facility, tenantId: tenant, enabledModules: modules };
    actor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic clinician','test-only','ACTIVE',$3,$4) RETURNING id",
        [`select-${suffix}`, `select-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Selection','2000-01-01','Other') RETURNING id",
        [tenant, facility, `S-${suffix}`],
      )
    ).rows[0].id;
    [testA, testB] = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name,specimen_type) VALUES($1,'SYN-COUNT','Synthetic count','Whole Blood'),($1,'SYN-URINE','Synthetic urine','Whole Blood') RETURNING id",
        [facility],
      )
    ).rows.map((row) => row.id);
    role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
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
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    await syncMasterCatalogue(facilityRow, actor);
    const catalogue = await listMasterCatalogue(facilityRow);
    opd = catalogue.find((row) => row.master.code === 'JC-OPD-CONSULT')!.master.id;
    followUp = catalogue.find((row) => row.master.code === 'JC-OPD-FOLLOWUP')!.master.id;
    await configure(opd, '100.00');
    await configure(followUp, '150.00');
    await configure(await sourceMaster(testA), '80.00');
    await configure(await sourceMaster(testB), '45.00');
    imaging = (
      await createImagingService(facilityRow, actor, {
        description: 'Synthetic specific imaging exam',
      })
    ).master.id;
    await configure(imaging, '300.00');
    const a = await call('POST', '/api/master-lab-specimens', {
      facilityId: facility,
      testId: testA,
      specimenType: 'Synthetic blood',
      reviewReference: 'synthetic clinical review A',
    });
    const b = await call('POST', '/api/master-lab-specimens', {
      facilityId: facility,
      testId: testB,
      specimenType: 'Synthetic urine',
      reviewReference: 'synthetic clinical review B',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    optionA = a.body.id;
    optionB = b.body.id;
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('exposes exact approved scoped prices and reviewed individual specimens, not legacy defaults', async () => {
    expect(
      (
        await call(
          'GET',
          `/api/master-services?facilityId=${facility}&family=LABORATORY`,
          undefined,
          '',
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('GET', `/api/master-services?facilityId=${other}&family=LABORATORY`)).status,
    ).toBe(403);
    const labs = await call('GET', `/api/master-services?facilityId=${facility}&family=LABORATORY`);
    expect(labs.status).toBe(200);
    expect(labs.body.find((row: { id: number }) => row.id === testA)).toMatchObject({
      unitPrice: '80.00',
      priceStatus: 'AVAILABLE',
      specimenOptions: [{ id: optionA, specimenType: 'Synthetic blood' }],
    });
    expect(labs.body.find((row: { id: number }) => row.id === testB)).toMatchObject({
      unitPrice: '45.00',
      specimenOptions: [{ id: optionB, specimenType: 'Synthetic urine' }],
    });
    const consultations = await call(
      'GET',
      `/api/master-services?facilityId=${facility}&family=CONSULTATION`,
    );
    expect(consultations.body.find((row: { id: number }) => row.id === followUp)).toMatchObject({
      unitPrice: '150.00',
      clinicalSource: 'ENCOUNTER:FOLLOW_UP',
    });
    const images = await call(
      'GET',
      `/api/master-services?facilityId=${facility}&family=RADIOLOGY`,
    );
    expect(images.body.find((row: { id: number }) => row.id === imaging)).toMatchObject({
      unitPrice: '300.00',
    });
    expect(
      (
        await call('POST', '/api/master-lab-specimens', {
          facilityId: facility,
          testId: testA,
          specimenType: 'blood, urine',
          reviewReference: 'synthetic',
        })
      ).status,
    ).toBe(400);
  });

  it('isolates tenants and applies different approved prices to the same service in two facilities', async () => {
    const otherActor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic second clinician','test-only','ACTIVE',$3,$4) RETURNING id",
        [`second-${suffix}`, `second-${suffix}@example.test`, tenant, other],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [otherActor, role]);
    const otherToken = (await createSession({ userId: otherActor, securityVersion: 1 }))
      .sessionToken;
    const otherPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other Facility','2000-01-01','Other') RETURNING id",
        [tenant, other, `OTHER-${suffix}`],
      )
    ).rows[0].id;
    const otherRow = { id: other, tenantId: tenant, enabledModules: modules };
    await syncMasterCatalogue(otherRow, otherActor);
    await configure(followUp, '333.00', otherRow, otherActor);
    const a = await call('GET', `/api/master-services?facilityId=${facility}&family=CONSULTATION`);
    const b = await call(
      'GET',
      `/api/master-services?facilityId=${other}&family=CONSULTATION`,
      undefined,
      otherToken,
    );
    expect(a.body.find((row: { id: number }) => row.id === followUp).unitPrice).toBe('150.00');
    expect(b.body.find((row: { id: number }) => row.id === followUp).unitPrice).toBe('333.00');
    expect(
      (
        await call(
          'GET',
          `/api/master-services?facilityId=${facility}&family=CONSULTATION`,
          undefined,
          otherToken,
        )
      ).status,
    ).toBe(403);
    const visit = await call(
      'POST',
      '/api/encounters',
      {
        facilityId: other,
        patientId: otherPatient,
        encounterType: 'Outpatient',
        consultationMasterServiceId: followUp,
        idempotencyKey: randomUUID(),
      },
      otherToken,
    );
    expect(visit.status).toBe(201);
    const billed = await call(
      'PUT',
      `/api/encounters/${visit.body.id}`,
      { status: 'Completed' },
      otherToken,
    );
    expect(billed.body.billing).toMatchObject({ charged: true, totalAmount: '333.00' });
    expect((await call('GET', `/api/invoices/${billed.body.billing.invoiceId}`)).status).toBe(403);

    const foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic foreign ${suffix}`,
        `foreign-${suffix}`,
      ])
    ).rows[0].id;
    const foreignFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic foreign',$3::jsonb) RETURNING id",
        [foreignTenant, `FOREIGN-${suffix}`, JSON.stringify(modules)],
      )
    ).rows[0].id;
    const foreignPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Foreign Tenant','2000-01-01','Other') RETURNING id",
        [foreignTenant, foreignFacility, `FOREIGN-${suffix}`],
      )
    ).rows[0].id;
    expect(
      (await call('GET', `/api/master-services?facilityId=${foreignFacility}&family=CONSULTATION`))
        .status,
    ).toBe(403);
    const crossPatient = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: foreignPatient,
      encounterType: 'Outpatient',
      consultationMasterServiceId: followUp,
      idempotencyKey: randomUUID(),
    });
    expect([400, 403, 404]).toContain(crossPatient.status);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM encounters WHERE facility_id=$1 AND patient_id=$2',
          [facility, foreignPatient],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('bills the selected consultation, two differently collected tests and one linked imaging report exactly once on one invoice', async () => {
    const visitPayload = {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      consultationMasterServiceId: followUp,
      status: 'Active',
      idempotencyKey: randomUUID(),
    };
    const [visit, replayVisit] = await Promise.all([
      call('POST', '/api/encounters', visitPayload),
      call('POST', '/api/encounters', visitPayload),
    ]);
    expect([visit.status, replayVisit.status].sort()).toEqual([200, 201]);
    expect(visit.body.id).toBe(replayVisit.body.id);
    expect(visit.body.consultationMasterServiceId).toBe(followUp);
    expect(visit.body.encounterType).toBe('Follow Up');
    expect(
      (await call('POST', '/api/encounters', { ...visitPayload, consultationMasterServiceId: opd }))
        .status,
    ).toBe(409);
    const eid = visit.body.id;
    const labPayload = {
      patientId: patient,
      encounterId: eid,
      testSelections: [
        { testId: testA, specimenOptionId: optionA },
        { testId: testB, specimenOptionId: optionB },
      ],
      clinicalIndication: 'synthetic indication',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    };
    const invalid = await call('POST', '/api/lab-orders/batch', {
      ...labPayload,
      testSelections: [{ testId: testA, specimenOptionId: optionB }],
      idempotencyKey: randomUUID(),
    });
    expect(invalid.status).toBe(400);
    const [batch, replayBatch] = await Promise.all([
      call('POST', '/api/lab-orders/batch', labPayload),
      call('POST', '/api/lab-orders/batch', labPayload),
    ]);
    expect(batch.status).toBe(201);
    expect(replayBatch.status).toBe(201);
    expect(batch.body.orders.map((order: { id: number }) => order.id).sort()).toEqual(
      replayBatch.body.orders.map((order: { id: number }) => order.id).sort(),
    );
    expect(
      batch.body.orders.map((order: { specimenType: string }) => order.specimenType).sort(),
    ).toEqual(['Synthetic blood', 'Synthetic urine']);
    expect(
      batch.body.orders
        .map((order: { reviewedSpecimenOptionId: number }) => order.reviewedSpecimenOptionId)
        .sort(),
    ).toEqual([optionA, optionB].sort());
    expect(
      (
        await call('POST', '/api/lab-orders/batch', {
          ...labPayload,
          clinicalIndication: 'different synthetic reason',
        })
      ).status,
    ).toBe(409);
    const imagePayload = {
      facilityId: facility,
      patientId: patient,
      encounterId: eid,
      masterServiceId: imaging,
      modality: 'Synthetic',
      procedureName: 'Ignored caller title',
      clinicalIndication: 'synthetic reason',
      idempotencyKey: randomUUID(),
    };
    const [image, replayImage] = await Promise.all([
      call('POST', '/api/radiology-orders', imagePayload),
      call('POST', '/api/radiology-orders', imagePayload),
    ]);
    expect([image.status, replayImage.status].sort()).toEqual([200, 201]);
    expect(image.body.id).toBe(replayImage.body.id);
    expect(image.body.encounterId).toBe(eid);
    expect(image.body.procedureName).toBe('Synthetic specific imaging exam');
    expect(
      (await call('POST', '/api/radiology-orders', { ...imagePayload, modality: 'Different' }))
        .status,
    ).toBe(409);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
          eid,
        ])
      ).rows[0].n,
    ).toBe(0);
    const complete = await call('PUT', `/api/encounters/${eid}`, { status: 'Completed' });
    expect(complete.body.billing).toMatchObject({ charged: true, totalAmount: '150.00' });
    const invoice = complete.body.billing.invoiceId;
    for (const order of batch.body.orders) {
      expect(
        (await call('PUT', `/api/lab-orders/${order.id}/status`, { status: 'Sample Collected' }))
          .status,
      ).toBe(200);
      const result = await call('POST', '/api/lab-results', {
        orderId: order.id,
        patientId: patient,
        parameterName: 'Synthetic',
        measuredValue: '1',
      });
      expect(result.status).toBe(201);
      expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(
        200,
      );
      const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      expect(completed.body.billing).toMatchObject({ charged: true, invoiceId: invoice });
      expect(
        (await call('POST', `/api/lab-orders/${order.id}/complete`, {})).body.billing.reason,
      ).toBe('DUPLICATE');
    }
    const reportPayload = { findings: 'Synthetic findings', reportedBy: 'Synthetic clinician' };
    const report = await call(
      'PUT',
      `/api/radiology-orders/${image.body.id}/report`,
      reportPayload,
    );
    expect(report.body.billing).toMatchObject({
      charged: true,
      totalAmount: '300.00',
      invoiceId: invoice,
    });
    expect(
      (await call('PUT', `/api/radiology-orders/${image.body.id}/report`, reportPayload)).body
        .billing.reason,
    ).toBe('DUPLICATE');
    expect(
      (await call('PUT', `/api/encounters/${eid}`, { status: 'Completed' })).body.billing.reason,
    ).toBe('DUPLICATE');
    const detail = await call('GET', `/api/invoices/${invoice}`);
    expect(detail.status).toBe(200);
    expect(detail.body.invoice).toMatchObject({
      encounterId: eid,
      totalAmount: '575.00',
      balanceAmount: '575.00',
      paidAmount: '0.00',
    });
    expect(detail.body.items.map((item: { sourceType: string }) => item.sourceType).sort()).toEqual(
      ['CONSULTATION', 'LAB_ORDER', 'LAB_ORDER', 'RADIOLOGY'],
    );
    expect(detail.body.items.map((item: { unitPrice: string }) => item.unitPrice).sort()).toEqual([
      '150.00',
      '300.00',
      '45.00',
      '80.00',
    ]);
  });

  it('keeps a newly unselected completed visit unresolved until a reviewed identity is chosen', async () => {
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      idempotencyKey: randomUUID(),
    });
    expect(visit.status).toBe(201);
    expect(visit.body.consultationSelectionReviewRequired).toBe(true);
    const complete = await call('PUT', `/api/encounters/${visit.body.id}`, { status: 'Completed' });
    expect(complete.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'CONSULTATION_SELECTION_REQUIRED' },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_charge_attempts WHERE source_type='CONSULTATION' AND source_id=$1 AND status='PENDING'",
          [visit.body.id],
        )
      ).rows[0].n,
    ).toBe(1);
    const selected = await call('POST', `/api/encounters/${visit.body.id}/consultation-selection`, {
      masterServiceId: opd,
      reviewReason: 'synthetic identity review',
    });
    expect(selected.body.billing).toMatchObject({ charged: true, totalAmount: '100.00' });
    const replay = await call('POST', `/api/encounters/${visit.body.id}/consultation-selection`, {
      masterServiceId: opd,
      reviewReason: 'synthetic identity review',
    });
    expect(replay.body.billing.reason).toBe('DUPLICATE');
    expect(
      (
        await call('POST', `/api/encounters/${visit.body.id}/consultation-selection`, {
          masterServiceId: followUp,
          reviewReason: 'synthetic correction review',
        })
      ).status,
    ).toBe(409);
  });
  it('requires individual reviewed specimens for billable single and batch orders', async () => {
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      consultationSelectionReviewRequired: true,
      idempotencyKey: randomUUID(),
    });
    const baseOrder = {
      facilityId: facility,
      patientId: patient,
      encounterId: visit.body.id,
      testId: testA,
      testName: 'Synthetic count',
    };
    const mismatched = await call('POST', '/api/lab-orders', {
      ...baseOrder,
      specimenOptionId: optionB,
    });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error).toBe('SPECIMEN_NOT_REVIEWED');
    const conflicting = await call('POST', '/api/lab-orders', {
      ...baseOrder,
      specimenOptionId: optionA,
      specimenType: 'Wrong synthetic specimen',
    });
    expect(conflicting.status).toBe(400);
    const legacy = await call('POST', '/api/lab-orders', {
      ...baseOrder,
      specimenType: 'Unreviewed synthetic specimen',
    });
    expect(legacy.status).toBe(201);
    expect(legacy.body).toMatchObject({
      testId: testA,
      reviewedSpecimenOptionId: null,
      clinicalException: true,
      catalogueMatch: 'REVIEW_REQUIRED',
    });
    const historical = await call('POST', '/api/lab-orders', {
      ...baseOrder,
      specimenType: 'Synthetic historical specimen',
    });
    // Synthetic pre-migration shape: an old false flag is not specimen review.
    await pool.query('UPDATE lab_orders SET clinical_exception=false WHERE id=$1', [
      historical.body.id,
    ]);
    const reviewed = await call('POST', '/api/lab-orders', {
      ...baseOrder,
      specimenOptionId: optionA,
    });
    expect(reviewed.body).toMatchObject({
      testId: testA,
      reviewedSpecimenOptionId: optionA,
      specimenType: 'Synthetic blood',
      clinicalException: false,
      catalogueMatch: 'FOUND',
    });
    const batchBase = {
      encounterId: visit.body.id,
      patientId: patient,
      clinicalIndication: 'synthetic indication',
      specimenType: 'Unreviewed synthetic specimen',
      priority: 'Routine',
    };
    expect(
      (
        await call('POST', '/api/lab-orders/batch', {
          ...batchBase,
          testIds: [testA, testB],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/lab-orders/batch', {
          ...batchBase,
          investigations: ['Synthetic count', 'Synthetic urine'],
        })
      ).status,
    ).toBe(400);
    const legacyBatch = await call('POST', '/api/lab-orders/batch', {
      ...batchBase,
      testIds: [testA],
    });
    expect(legacyBatch.status).toBe(201);
    expect(legacyBatch.body.unresolved).toEqual(['Synthetic count']);
    expect(legacyBatch.body.orders[0]).toMatchObject({
      clinicalException: true,
      reviewedSpecimenOptionId: null,
      catalogueMatch: 'REVIEW_REQUIRED',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='LAB_ORDER_REQUEST' AND resource_id = ANY($1::text[])",
          [
            [
              String(legacy.body.id),
              String(legacyBatch.body.orders[0].id),
              String(reviewed.body.id),
            ],
          ],
        )
      ).rows[0].n,
    ).toBe(3);
    for (const [id, shouldCharge] of [
      [legacy.body.id, false],
      [legacyBatch.body.orders[0].id, false],
      [historical.body.id, false],
      [reviewed.body.id, true],
    ] as const) {
      expect(
        (await call('PUT', `/api/lab-orders/${id}/status`, { status: 'Sample Collected' })).status,
      ).toBe(200);
      const result = await call('POST', '/api/lab-results', {
        orderId: id,
        patientId: patient,
        parameterName: 'Synthetic',
        measuredValue: '1',
      });
      expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(
        200,
      );
      const completed = await call('POST', `/api/lab-orders/${id}/complete`, {});
      expect(completed.body.billing.charged).toBe(shouldCharge);
      if (!shouldCharge)
        expect(completed.body.billing.diagnosis.code).toBe('SOURCE_REVIEW_REQUIRED');
    }
  });

  it('keeps an unapproved investigation in clinical care and queues it until its price is reviewed', async () => {
    const masterId = await sourceMaster(testB);
    const row = (await listMasterCatalogue(facilityRow)).find(
      (value) => value.master.id === masterId,
    )!;
    const [edited] = await editMasterTariffs(facilityRow, actor, [
      {
        tariffId: row.tariff!.id,
        revision: row.tariff!.revision,
        fee: '46.00',
        unit: row.master.unit,
        isActive: true,
        autoBill: true,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ]);
    const preview = await call(
      'GET',
      `/api/master-services?facilityId=${facility}&family=LABORATORY`,
    );
    expect(preview.body.find((value: { id: number }) => value.id === testB)).toMatchObject({
      unitPrice: null,
      priceStatus: 'TARIFF_UNAPPROVED',
    });
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      consultationSelectionReviewRequired: true,
      idempotencyKey: randomUUID(),
    });
    const batch = await call('POST', '/api/lab-orders/batch', {
      encounterId: visit.body.id,
      patientId: patient,
      testSelections: [{ testId: testB, specimenOptionId: optionB }],
      clinicalIndication: 'synthetic indication',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    });
    expect(batch.status).toBe(201);
    const order = batch.body.orders[0];
    expect(
      (await call('PUT', `/api/lab-orders/${order.id}/status`, { status: 'Sample Collected' }))
        .status,
    ).toBe(200);
    const result = await call('POST', '/api/lab-results', {
      orderId: order.id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '2',
    });
    expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(200);
    const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
    expect(completed.status).toBe(200);
    expect(completed.body.billing).toMatchObject({
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      diagnosis: { code: 'TARIFF_UNAPPROVED' },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const pending = (
      await pool.query(
        "SELECT id FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1 AND status='PENDING'",
        [order.id],
      )
    ).rows[0];
    expect(pending).toBeTruthy();
    await approveMasterTariff(
      facilityRow,
      actor,
      edited.id,
      edited.revision,
      'synthetic approval after review',
    );
    const retry = await call('POST', `/api/billing/charge-attempts/${pending.id}/retry`, {
      facilityId: facility,
    });
    expect(retry.status).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT unit_price::text FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].unit_price,
    ).toBe('46.00');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('refuses disabled, future and retired specimen options and foreign test IDs', async () => {
    const masterId = await sourceMaster(testB);
    let row = (await listMasterCatalogue(facilityRow)).find(
      (value) => value.master.id === masterId,
    )!;
    let [edited] = await editMasterTariffs(facilityRow, actor, [
      {
        tariffId: row.tariff!.id,
        revision: row.tariff!.revision,
        fee: '46.00',
        unit: row.master.unit,
        isActive: true,
        autoBill: true,
        effectiveFrom: '2099-01-01',
        effectiveTo: null,
      },
    ]);
    await approveMasterTariff(
      facilityRow,
      actor,
      edited.id,
      edited.revision,
      'synthetic future review',
    );
    let preview = await call(
      'GET',
      `/api/master-services?facilityId=${facility}&family=LABORATORY`,
    );
    expect(preview.body.find((value: { id: number }) => value.id === testB)).toMatchObject({
      unitPrice: null,
      priceStatus: 'NOT_YET_EFFECTIVE',
    });
    row = (await listMasterCatalogue(facilityRow)).find((value) => value.master.id === masterId)!;
    [edited] = await editMasterTariffs(facilityRow, actor, [
      {
        tariffId: row.tariff!.id,
        revision: row.tariff!.revision,
        fee: '46.00',
        unit: row.master.unit,
        isActive: false,
        autoBill: false,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ]);
    // The administration service must refuse to approve an inactive tariff.
    await expect(
      approveMasterTariff(
        facilityRow,
        actor,
        edited.id,
        edited.revision,
        'synthetic disabled review',
      ),
    ).rejects.toThrow('Enable the service');
    preview = await call('GET', `/api/master-services?facilityId=${facility}&family=LABORATORY`);
    expect(preview.body.find((value: { id: number }) => value.id === testB)).toMatchObject({
      unitPrice: null,
      priceStatus: 'TARIFF_INACTIVE',
    });
    const foreign = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,'OTHER','Synthetic foreign') RETURNING id",
        [other],
      )
    ).rows[0].id;
    expect(
      (
        await call('POST', '/api/master-lab-specimens', {
          facilityId: facility,
          testId: foreign,
          specimenType: 'Synthetic',
          reviewReference: 'synthetic review',
        })
      ).status,
    ).toBe(404);
    const single = await call('POST', '/api/lab-orders', {
      facilityId: facility,
      patientId: patient,
      testId: foreign,
      testName: 'Synthetic foreign',
    });
    expect(single.status).toBe(400);
    const beforeRetirement = await call('POST', '/api/lab-orders', {
      facilityId: facility,
      patientId: patient,
      testId: testB,
      testName: 'Synthetic urine',
      specimenOptionId: optionB,
    });
    expect(beforeRetirement.status).toBe(201);
    expect(
      (
        await call('POST', `/api/master-lab-specimens/${optionB}/retire`, {
          facilityId: facility,
          reviewReference: 'synthetic retirement',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PUT', `/api/lab-orders/${beforeRetirement.body.id}/status`, {
          status: 'Sample Collected',
        })
      ).status,
    ).toBe(200);
    const retiredResult = await call('POST', '/api/lab-results', {
      orderId: beforeRetirement.body.id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    expect(
      (await call('POST', `/api/lab-results/${retiredResult.body.id}/verify`, {})).status,
    ).toBe(200);
    const retiredCompletion = await call(
      'POST',
      `/api/lab-orders/${beforeRetirement.body.id}/complete`,
      {},
    );
    expect(retiredCompletion.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'SOURCE_REVIEW_REQUIRED' },
    });
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      consultationSelectionReviewRequired: true,
      idempotencyKey: randomUUID(),
    });
    const batch = await call('POST', '/api/lab-orders/batch', {
      encounterId: visit.body.id,
      patientId: patient,
      testSelections: [{ testId: testB, specimenOptionId: optionB }],
      clinicalIndication: 'synthetic indication',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    });
    expect(batch.status).toBe(400);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='LAB_SPECIMEN_OPTION' AND facility_id=$1",
          [facility],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(3);
  });
  it('keeps legacy free-text single and batch orders unbilled even for an exact catalogue name', async () => {
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      consultationSelectionReviewRequired: true,
      idempotencyKey: randomUUID(),
    });
    const single = await call('POST', '/api/lab-orders', {
      facilityId: facility,
      patientId: patient,
      encounterId: visit.body.id,
      testName: 'Synthetic count',
      specimenType: 'Synthetic blood',
    });
    const batch = await call('POST', '/api/lab-orders/batch', {
      patientId: patient,
      encounterId: visit.body.id,
      investigations: ['Synthetic count'],
      specimenType: 'Synthetic blood',
      clinicalIndication: 'Synthetic legacy request',
      priority: 'Routine',
    });
    expect(single.status).toBe(201);
    expect(batch.status).toBe(201);
    expect(batch.body.unresolved).toEqual(['Synthetic count']);
    for (const order of [single.body, batch.body.orders[0]]) {
      expect(order).toMatchObject({
        testId: null,
        clinicalException: true,
        catalogueMatch: 'REVIEW_REQUIRED',
      });
      expect(
        (await call('PUT', `/api/lab-orders/${order.id}/status`, { status: 'Sample Collected' }))
          .status,
      ).toBe(200);
      const result = await call('POST', '/api/lab-results', {
        orderId: order.id,
        patientId: patient,
        parameterName: 'Synthetic',
        measuredValue: '1',
      });
      expect(result.status).toBe(201);
      expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(
        200,
      );
      const completed = await call('POST', `/api/lab-orders/${order.id}/complete`, {});
      expect(completed.body.billing).toMatchObject({
        charged: false,
        diagnosis: { code: 'CATALOGUE_NOT_FOUND' },
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
            [order.id],
          )
        ).rows[0].n,
      ).toBe(0);
    }
  });

  it('keeps a clinical exception unmatched even when its name equals a configured test and protects retries', async () => {
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      consultationSelectionReviewRequired: true,
      idempotencyKey: randomUUID(),
    });
    const payload = {
      encounterId: visit.body.id,
      patientId: patient,
      investigations: ['Synthetic count'],
      clinicalException: true,
      specimenType: 'Explicit clinician specimen',
      clinicalIndication: 'synthetic exception',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all([
      call('POST', '/api/lab-orders/batch', payload),
      call('POST', '/api/lab-orders/batch', payload),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const first = results.find((result) => result.body.idempotentReplay === false)!;
    const retry = results.find((result) => result.body.idempotentReplay === true)!;
    expect(first).toBeTruthy();
    expect(retry).toBeTruthy();
    expect(first.body.orders[0]).toMatchObject({
      testId: null,
      clinicalException: true,
      specimenType: 'Explicit clinician specimen',
    });
    expect(retry.body.orders[0].id).toBe(first.body.orders[0].id);
    expect(retry.body.idempotentReplay).toBe(true);
    expect(first.body.unresolved).toEqual(['Synthetic count']);
    const orderId = first.body.orders[0].id;
    expect(
      (await call('PUT', `/api/lab-orders/${orderId}/status`, { status: 'Sample Collected' }))
        .status,
    ).toBe(200);
    const result = await call('POST', '/api/lab-results', {
      orderId,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    expect(result.status).toBe(201);
    expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(200);
    const completed = await call('POST', `/api/lab-orders/${orderId}/complete`, {});
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      testId: null,
      clinicalException: true,
      status: 'Completed',
    });
    expect(completed.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'CATALOGUE_NOT_FOUND' },
    });
    const pending = (
      await pool.query(
        "SELECT id FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1 AND status='PENDING'",
        [orderId],
      )
    ).rows[0];
    expect(pending).toBeTruthy();
    // Synthetic corruption simulation only: an accidental ID assignment must
    // not override the explicit exception marker or bill on an unresolved retry.
    await pool.query('UPDATE lab_orders SET test_id=$1 WHERE id=$2', [testA, orderId]);
    expect(
      (
        await call('POST', `/api/billing/charge-attempts/${pending.id}/retry`, {
          facilityId: facility,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [orderId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await pool.query('SELECT status FROM billing_charge_attempts WHERE id=$1', [pending.id]))
        .rows[0].status,
    ).toBe('PENDING');
    expect(
      (
        await call('POST', '/api/lab-orders/batch', {
          ...payload,
          investigations: ['Synthetic count', 'Synthetic urine'],
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
  });

  it('requires review for an old unselected encounter even when its old review flag is false', async () => {
    const [legacy] = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,consultation_selection_review_required) VALUES($1,$2,$3,'OUTPATIENT','Active',false) RETURNING id",
        [tenant, facility, patient],
      )
    ).rows;
    const completed = await call('PUT', `/api/encounters/${legacy.id}`, { status: 'Completed' });
    expect(completed.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'CONSULTATION_SELECTION_REQUIRED' },
    });
    const selection = await call('POST', `/api/encounters/${legacy.id}/consultation-selection`, {
      masterServiceId: opd,
      reviewReason: 'synthetic old uncharged visit review',
    });
    expect(selection.body.billing).toMatchObject({ charged: true, totalAmount: '100.00' });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='CONSULTATION' AND source_id=$1",
          [legacy.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('refuses to select or charge an ambiguous historical OPD line without provenance', async () => {
    const [legacy] = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,consultation_selection_review_required) VALUES($1,$2,$3,'OUTPATIENT','Active',false) RETURNING id",
        [tenant, facility, patient],
      )
    ).rows;
    const [invoice] = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','Pending') RETURNING id",
        [tenant, facility, patient, legacy.id, `SYN-LEGACY-${suffix}`],
      )
    ).rows;
    await pool.query(
      "INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,'OPD','Synthetic historical line',1,'100.00','100.00')",
      [invoice.id],
    );
    const completed = await call('PUT', `/api/encounters/${legacy.id}`, { status: 'Completed' });
    expect(completed.body.billing).toMatchObject({
      charged: false,
      diagnosis: { code: 'CONSULTATION_SELECTION_REQUIRED' },
    });
    const selection = await call('POST', `/api/encounters/${legacy.id}/consultation-selection`, {
      masterServiceId: followUp,
      reviewReason: 'synthetic billed record review',
    });
    expect(selection.status).toBe(409);
    expect(selection.body.error).toBe('CONSULTATION_ALREADY_BILLED');
    const rows = (
      await pool.query(
        'SELECT item_type,description,unit_price::text,total_amount::text FROM billing_items WHERE invoice_id=$1',
        [invoice.id],
      )
    ).rows;
    expect(rows).toEqual([
      {
        item_type: 'OPD',
        description: 'Synthetic historical line',
        unit_price: '100.00',
        total_amount: '100.00',
      },
    ]);
  });
});
