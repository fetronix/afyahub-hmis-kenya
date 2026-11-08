import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db, pool } from '../../db/index.ts';
import {
  syncMasterCatalogue,
  listMasterCatalogue,
  attachLegacyTariff,
  editMasterTariffs,
  approveMasterTariff,
  createImagingService,
  approveMasterAlias,
  retireMasterAlias,
  setMasterSourceMapping,
} from '../../billing/master-catalogue.service.ts';
import { chargeAndRecord, retryChargeAttempt } from '../../billing/charge-attempts.ts';
import { addReviewedSpecimen } from '../../billing/lab-specimen-config.service.ts';
import {
  consultationChargeRequest,
  labOrderChargeRequest,
  radiologyChargeRequest,
  admissionChargeRequest,
} from '../../billing/service-charges.ts';
import { createEncounterScoped, updateEncounterScoped } from '../../db/queries/encounters.ts';
import {
  createLabOrder,
  updateLabOrderStatus,
  addLabResult,
  verifyLabResult,
  completeLabInvestigation,
  createRadiologyOrder,
  updateRadiologyReport,
} from '../../db/queries/laboratory.ts';
import {
  createAdmissionScoped,
  transferAdmissionScoped,
  dischargeAdmissionScoped,
  accrueBedDaysScoped,
} from '../../db/queries/inpatient.ts';
import { createInvoice, voidInvoiceScoped } from '../../db/queries/billing.ts';
import { dispenseFefoScoped } from '../../inventory/inventory.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { approvedSyntheticManualRefund } from './support/refund-approval.ts';
import { describeDb } from '../vitest/support/db.ts';

// Only synthetic IDs and amounts in a fresh test database; no facility data.
describeDb('Master tariff workflow (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number,
    facility: number,
    other: number,
    actor: number,
    patient: number,
    testId: number,
    testOption: number,
    itemId: number,
    wardId: number,
    bedId: number,
    legacyId: number;
  let ctx: AuthorizationContext;
  let facilityRow: { id: number; tenantId: number; enabledModules: unknown };
  let otherRow: { id: number; tenantId: number; enabledModules: unknown };
  let encounterId: number, invoiceId: number, imagingId: number, admissionId: number;
  let base: string, close: () => Promise<void>, token: string, otherToken: string;
  type DirectService = {
    service: { id: number; code: string; name: string };
    tariff: { id: number; revision: number };
  };
  let directOpd: DirectService,
    directLab: DirectService,
    directImaging: DirectService,
    directAdmission: DirectService,
    directZero: DirectService,
    directFollowUp: DirectService,
    otherOpd: DirectService;
  const modules = [
    'registration',
    'finance',
    'opd',
    'laboratory',
    'radiology',
    'pharmacy',
    'inventory',
    'inpatient',
  ];
  async function configure(
    fac: { id: number; tenantId: number; enabledModules: unknown },
    masterId: number,
    fee: string,
  ) {
    const row = (await listMasterCatalogue(fac)).find((r) => r.master.id === masterId)!;
    expect(row.tariff).toBeTruthy();
    const t = row.tariff!;
    const [edited] = await editMasterTariffs(fac, actor, [
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
    return approveMasterTariff(fac, actor, t.id, edited.revision, 'synthetic review');
  }
  async function sourceMaster(kind: string, id: number) {
    return Number(
      (
        await pool.query(
          'SELECT master_service_id FROM master_service_sources WHERE facility_id=$1 AND source_type=$2 AND source_id=$3 AND is_active',
          [facility, kind, id],
        )
      ).rows[0].master_service_id,
    );
  }
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('A disposable test database is required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic ${suffix}`,
        `master-${suffix}`,
      ])
    ).rows[0].id;
    [facility, other] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$4::jsonb),($1,$3,'Synthetic B',$4::jsonb) RETURNING id",
        [tenant, `A-${suffix}`, `B-${suffix}`, JSON.stringify(modules)],
      )
    ).rows.map((r) => r.id);
    facilityRow = { id: facility, tenantId: tenant, enabledModules: modules };
    otherRow = { id: other, tenantId: tenant, enabledModules: modules };
    actor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic','test-only','ACTIVE',$3,$4) RETURNING id",
        [`master-${suffix}`, `master-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Patient','2000-01-01','Other') RETURNING id",
        [tenant, facility, `M-${suffix}`],
      )
    ).rows[0].id;
    testId = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,'CBC','Synthetic exact count') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    testOption = (
      await addReviewedSpecimen(facilityRow, actor, {
        testId,
        specimenType: 'Synthetic reviewed specimen',
        reviewReference: 'synthetic clinical review',
      })
    ).id;
    itemId = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock,selling_price) VALUES($1,'MED-A','Synthetic actual product','Tablets',20,'25.00') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,'SYNTHETIC','2099-12-31',20)",
      [itemId],
    );
    wardId = (
      await pool.query(
        "INSERT INTO wards(facility_id,code,name) VALUES($1,'WARD-A','Synthetic ward') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    bedId = (
      await pool.query(
        "INSERT INTO beds(ward_id,bed_number,daily_charge) VALUES($1,'A-1','90.00') RETURNING id",
        [wardId],
      )
    ).rows[0].id;
    legacyId = (
      await pool.query(
        "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee,is_active,auto_bill) VALUES($1,$2,'OPD-CONSULT','Synthetic old consultation','opd','Visit','100.00',true,true) RETURNING id",
        [tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
    for (const permission of [
      'patients.create',
      'patients.read',
      'clinical.create',
      'clinical.read',
      'clinical.update',
      'laboratory.read',
      'laboratory.orders.create',
      'laboratory.results.enter',
      'laboratory.results.verify',
      'pharmacy.read',
      'pharmacy.dispense',
      'inventory.read',
      'inpatient.read',
      'inpatient.admit',
      'inpatient.discharge',
      'inpatient.wards.update',
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
    const otherActor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic other facility','test-only','ACTIVE',$3,$4) RETURNING id",
        [`master-other-${suffix}`, `master-other-${suffix}@example.test`, tenant, other],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [otherActor, role]);
    token = (await createSession({ userId: actor, securityVersion: 1 })).sessionToken;
    otherToken = (await createSession({ userId: otherActor, securityVersion: 1 })).sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    ctx = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: ['FACILITY_ADMIN'],
      permissions: [
        'billing.read',
        'billing.payments.record',
        'billing.refunds.record',
        'clinical.read',
        'clinical.create',
      ],
      isSuperAdmin: false,
    };
    await pool.query("UPDATE facilities SET timezone='Africa/Nairobi' WHERE id=$1", [facility]);
    const policy = await call('PUT', '/api/inpatient/bed-billing-policy', {
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      isActive: true,
      effectiveFrom: '2020-01-01',
      reason: 'Synthetic reviewed policy',
    });
    expect(policy.status, JSON.stringify(policy.body)).toBe(200);
    directOpd = await createDirectService(
      'DIRECT-OPD',
      'Synthetic consultation',
      'CONSULTATION',
      'opd',
      'Visit',
      '100.00',
    );
    directLab = await createDirectService(
      'CBC',
      'Synthetic exact count',
      'LABORATORY',
      'laboratory',
      'Test',
      '800.00',
    );
    directImaging = await createDirectService(
      'DIRECT-IMAGING',
      'Synthetic specific examination',
      'RADIOLOGY',
      'radiology',
      'Examination',
      '300.00',
    );
    directAdmission = await createDirectService(
      'DIRECT-ADMISSION',
      'Synthetic admission',
      'ADMISSION',
      'inpatient',
      'Admission',
      '60.00',
    );
    directZero = await createDirectService(
      'DIRECT-ZERO',
      'Synthetic zero price consultation',
      'CONSULTATION',
      'opd',
      'Visit',
      '0.00',
    );
    directFollowUp = await createDirectService(
      'DIRECT-FOLLOW',
      'Synthetic follow up',
      'CONSULTATION',
      'opd',
      'Visit',
      '42.00',
    );
    otherOpd = await createDirectService(
      'DIRECT-OPD',
      'Synthetic consultation',
      'CONSULTATION',
      'opd',
      'Visit',
      '999.00',
      otherToken,
      other,
    );
  });

  afterAll(async () => {
    if (close) await close();
  });
  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });
  async function createDirectService(
    code: string,
    name: string,
    category: string,
    department: string,
    unit: string,
    initialPrice: string,
    session = token,
    target = facility,
  ): Promise<DirectService> {
    const result = await call(
      'POST',
      '/api/facility-services',
      {
        facilityId: target,
        code,
        name,
        description: name,
        category,
        department,
        unit,
        initialPrice,
        isActive: true,
        autoBill: true,
      },
      session,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  it('synchronises exact sources without changing existing prices and requires review', async () => {
    const before = (
      await pool.query(
        'SELECT code,description,department,unit,fee::text,is_active,auto_bill FROM facility_service_tariffs WHERE id=$1',
        [legacyId],
      )
    ).rows[0];
    await syncMasterCatalogue(facilityRow, actor);
    await syncMasterCatalogue(facilityRow, actor);
    expect(
      (
        await pool.query(
          'SELECT code,description,department,unit,fee::text,is_active,auto_bill FROM facility_service_tariffs WHERE id=$1',
          [legacyId],
        )
      ).rows[0],
    ).toEqual(before);
    const rows = await listMasterCatalogue(facilityRow);
    const opd = rows.find((r) => r.master.code === 'JC-OPD-CONSULT')!;
    expect(opd.tariff).toMatchObject({ fee: '0.00', isActive: false, approvalStatus: 'DRAFT' });
    const legacy = (
      await pool.query('SELECT revision FROM facility_service_tariffs WHERE id=$1', [legacyId])
    ).rows[0];
    const attached = await attachLegacyTariff(
      facilityRow,
      actor,
      opd.master.id,
      legacyId,
      legacy.revision,
    );
    expect(attached.fee).toBe('100.00');
    await approveMasterTariff(
      facilityRow,
      actor,
      legacyId,
      attached.revision,
      'synthetic approved',
    );
    await configure(facilityRow, await sourceMaster('LAB_TEST', testId), '800.00');
    await configure(facilityRow, await sourceMaster('PHARMACY', itemId), '25.00');
    await configure(facilityRow, await sourceMaster('BED_DAY', wardId), '90.00');
    const admission = rows.find((r) => r.master.code === 'JC-ADMISSION')!;
    await configure(facilityRow, admission.master.id, '60.00');
    const imaging = await createImagingService(facilityRow, actor, {
      description: 'Synthetic specific examination',
    });
    imagingId = imaging.master.id;
    await configure(facilityRow, imagingId, '300.00');
    await syncMasterCatalogue(otherRow, actor);
    await configure(otherRow, opd.master.id, '999.00');
  });

  it('bills exactly one completed consultation, with immutable source and tariff snapshots', async () => {
    const encounter = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'OUTPATIENT',
      consultationFacilityServiceId: directOpd.service.id,
    });
    encounterId = encounter.id;
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='CONSULTATION' AND source_id=$1",
          [encounterId],
        )
      ).rows[0].n,
    ).toBe(0);
    const done = await updateEncounterScoped(ctx, encounter.id, { status: 'Completed' });
    expect(done).toBeTruthy();
    const request = consultationChargeRequest(done!);
    const results = await Promise.all([
      chargeAndRecord(db, request, done!.billingOutboxAttemptId),
      chargeAndRecord(db, request, done!.billingOutboxAttemptId),
    ]);
    expect(results.filter((x) => x.charged)).toHaveLength(1);
    expect(results.some((x) => x.reason === 'DUPLICATE')).toBe(true);
    invoiceId = results.find((x) => x.charged)!.invoiceId!;
    const line = (
      await pool.query(
        'SELECT tariff_code,service_code,service_department,service_unit,source_type,source_id,quantity,unit_price::text FROM billing_items WHERE invoice_id=$1',
        [invoiceId],
      )
    ).rows[0];
    expect(line).toMatchObject({
      tariff_code: 'DIRECT-OPD',
      service_code: 'DIRECT-OPD',
      service_department: 'opd',
      service_unit: 'Visit',
      source_type: 'CONSULTATION',
      source_id: encounterId,
      quantity: 1,
      unit_price: '100.00',
    });
  });

  it('uses net receipts after refunds when another completed service is billed', async () => {
    const paid = await recordSettledPayment(
      ctx,
      { facilityId: facility, invoiceId, amount: '50.00', paymentMethod: 'Cash' },
      'Synthetic cashier',
    );
    await approvedSyntheticManualRefund(ctx, {
      facilityId: facility,
      invoiceId,
      paymentId: paid.payment.id,
      amount: '20.00',
      refundMethod: 'CASH',
      reason: 'Synthetic test refund',
      manualConfirmation: true,
      idempotencyKey: randomUUID(),
    });
    const order = await createLabOrder(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId,
      testId,
      specimenOptionId: testOption,
      testName: 'Synthetic exact count',
    });
    expect(order).toBeTruthy();
    const initial = await chargeAndRecord(db, labOrderChargeRequest(order!));
    expect(initial).toMatchObject({
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      diagnosis: { code: 'SOURCE_NOT_COMPLETED' },
    });
    await updateLabOrderStatus(ctx, order!.id, 'Sample Collected');
    const first = await addLabResult(ctx, {
      orderId: order!.id,
      patientId: patient,
      parameterName: 'Synthetic A',
      measuredValue: '1',
    });
    const second = await addLabResult(ctx, {
      orderId: order!.id,
      patientId: patient,
      parameterName: 'Synthetic B',
      measuredValue: '2',
    });
    await verifyLabResult(ctx, first.id, 'Synthetic verifier');
    await expect(completeLabInvestigation(ctx, order!.id)).rejects.toThrow(/all recorded results/i);
    await verifyLabResult(ctx, second.id, 'Synthetic verifier');
    const completed = await completeLabInvestigation(ctx, order!.id);
    const billed = await chargeAndRecord(
      db,
      labOrderChargeRequest(completed),
      completed.billingOutboxAttemptId,
    );
    expect(billed).toMatchObject({ charged: true, totalAmount: '800.00', invoiceId });
    const state = (
      await pool.query(
        'SELECT total_amount::text,paid_amount::text,balance_amount::text FROM billing_invoices WHERE id=$1',
        [invoiceId],
      )
    ).rows[0];
    expect(state).toEqual({
      total_amount: '900.00',
      paid_amount: '30.00',
      balance_amount: '870.00',
    });
  });

  it('does not infer an unknown investigation from specimen, description or a legacy code', async () => {
    const order = await createLabOrder(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId,
      testId: null,
      testName: 'Sput check',
      specimenType: 'Sputum',
    });
    await updateLabOrderStatus(ctx, order!.id, 'Sample Collected');
    const result = await addLabResult(ctx, {
      orderId: order!.id,
      patientId: patient,
      parameterName: 'Synthetic parameter',
      measuredValue: '1',
    });
    await verifyLabResult(ctx, result.id, 'Synthetic');
    const completed = await completeLabInvestigation(ctx, order!.id);
    const outcome = await chargeAndRecord(db, {
      ...labOrderChargeRequest(completed),
      codes: ['LAB-SPUT'],
    });
    expect(outcome).toMatchObject({ charged: false, diagnosis: { code: 'SERVICE_NOT_SELECTED' } });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order!.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_charge_attempts WHERE source_type='LAB_ORDER' AND source_id=$1 AND status='PENDING'",
          [order!.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('bills a selected imaging examination only after the report', async () => {
    const order = await createRadiologyOrder({
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId,
      facilityServiceId: directImaging.service.id,
      modality: 'Ultrasound',
      procedureName: 'Synthetic specific examination',
      status: 'Requested',
    });
    expect((await chargeAndRecord(db, radiologyChargeRequest(order))).diagnosis?.code).toBe(
      'SOURCE_NOT_COMPLETED',
    );
    const reported = await updateRadiologyReport(
      order.id,
      'Synthetic findings',
      undefined,
      'Synthetic reporter',
      actor,
    );
    const billed = await chargeAndRecord(
      db,
      radiologyChargeRequest(reported!),
      reported!.billingOutboxAttemptId,
    );
    expect(billed).toMatchObject({ charged: true, totalAmount: '300.00', invoiceId });
  });

  it('bills the actual dispensed inventory item and its actual quantity', async () => {
    const visit = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'OUTPATIENT',
      consultationFacilityServiceId: directOpd.service.id,
    });
    const prescribed = await call('POST', '/api/medications', {
      encounterId: visit.id,
      patientId: patient,
      drugName: 'Synthetic prescribed product',
      dosage: 'Synthetic',
      frequency: 'Synthetic',
      duration: 'Synthetic',
      quantity: 2,
    });
    expect(prescribed.status, JSON.stringify(prescribed.body)).toBe(201);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId])).rows[0]
        .current_stock,
    ).toBe(20);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
          visit.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    const result = await dispenseFefoScoped(ctx, {
      facilityId: facility,
      patientId: patient,
      prescriptionId: prescribed.body.id,
      itemId,
      quantityDispensed: 2,
      dispensedBy: 'Synthetic',
      idempotencyKey: randomUUID(),
    });
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId])).rows[0]
        .current_stock,
    ).toBe(18);
    const billed = await chargeAndRecord(db, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId: visit.id,
      codes: ['MISLEADING-DRUG-NAME'],
      family: 'PHARMACY',
      sourceType: 'PHARMACY',
      sourceId: result.dispensation.id,
      itemType: 'Pharmacy',
      quantity: 2,
      serviceName: result.billingContext.drugName,
    });
    expect(billed, JSON.stringify(billed)).toMatchObject({
      charged: true,
      description: 'Synthetic actual product',
      quantity: 2,
      totalAmount: '50.00',
    });
  });

  it('bills admission independently from bed nights and rejects zero-price services', async () => {
    const admission = await createAdmissionScoped(ctx, {
      facilityId: facility,
      patientId: patient,
      wardId,
      bedId,
      facilityServiceId: directAdmission.service.id,
    });
    admissionId = admission.id;
    const billed = await chargeAndRecord(
      db,
      admissionChargeRequest(admission),
      admission.billingOutboxAttemptId,
    );
    expect(billed).toMatchObject({ charged: true, totalAmount: '60.00' });
    const emergency = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'EMERGENCY',
      consultationFacilityServiceId: directZero.service.id,
    });
    const done = await updateEncounterScoped(ctx, emergency.id, { status: 'Completed' });
    const blocked = await chargeAndRecord(db, consultationChargeRequest(done!));
    expect(blocked).toMatchObject({ charged: false, diagnosis: { code: 'ZERO_PRICE' } });
  });

  it('records a transfer and durable discharge work, then bills the occupied bed snapshot only once', async () => {
    const [nextWard] = (
      await pool.query(
        "INSERT INTO wards(facility_id,code,name) VALUES($1,$2,'Synthetic transfer ward') RETURNING id",
        [facility, `WARD-B-${suffix}`],
      )
    ).rows;
    const [nextBed] = (
      await pool.query(
        "INSERT INTO beds(ward_id,bed_number,daily_charge) VALUES($1,'B-1','120.00') RETURNING id",
        [nextWard.id],
      )
    ).rows;
    await transferAdmissionScoped(ctx, admissionId, {
      toWardId: nextWard.id,
      toBedId: nextBed.id,
      transferredBy: 'Synthetic',
    });
    const beforeDischarge = await accrueBedDaysScoped(ctx, admissionId);
    expect(beforeDischarge).toMatchObject({ estimateOnly: true, charges: [] });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admissionId],
        )
      ).rows[0].n,
    ).toBe(0);
    const occupancy = (
      await pool.query(
        'SELECT bed_id,daily_rate_snapshot::text FROM inpatient_bed_occupancies WHERE admission_id=$1 ORDER BY started_at,id',
        [admissionId],
      )
    ).rows;
    expect(occupancy).toEqual([
      { bed_id: bedId, daily_rate_snapshot: '90.00' },
      { bed_id: nextBed.id, daily_rate_snapshot: '120.00' },
    ]);
    await dischargeAdmissionScoped(ctx, admissionId, {});
    // Simulate a crash before staging: clinical discharge must already have
    // left a durable work identity and released the bed to Cleaning.
    expect(
      (
        await pool.query('SELECT staged_at FROM inpatient_bed_billing_work WHERE admission_id=$1', [
          admissionId,
        ])
      ).rows[0].staged_at,
    ).toBeNull();
    expect(
      (await pool.query('SELECT status FROM beds WHERE id=$1', [nextBed.id])).rows[0].status,
    ).toBe('Cleaning');
    const result = await accrueBedDaysScoped(ctx, admissionId);
    expect(result.charges).toHaveLength(1);
    expect(result.charges[0]).toMatchObject({ charged: true, matchRule: 'BED_OCCUPANCY_SNAPSHOT' });
    const line = (
      await pool.query(
        `SELECT bi.unit_price::text, o.daily_rate_snapshot::text, o.bed_id
      FROM billing_items bi JOIN inpatient_bed_occupancies o ON o.id=bi.bed_occupancy_id
      WHERE bi.source_type='BED_DAY' AND bi.source_id=$1`,
        [admissionId],
      )
    ).rows;
    expect(line).toHaveLength(1);
    expect(line[0].unit_price).toBe(line[0].daily_rate_snapshot);
    expect([bedId, nextBed.id]).toContain(line[0].bed_id);
    const replay = await accrueBedDaysScoped(ctx, admissionId);
    expect(replay.charges[0]).toMatchObject({ charged: false, reason: 'DUPLICATE' });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admissionId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('ignores retired master aliases when billing an exact facility service and retains their audit', async () => {
    const ids = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,$2,'Synthetic X'),($1,$3,'Synthetic Y') RETURNING id",
        [facility, `X-${suffix}`, `Y-${suffix}`],
      )
    ).rows.map((row) => Number(row.id));
    await syncMasterCatalogue(facilityRow, actor);
    const x = await sourceMaster('LAB_TEST', ids[0]),
      y = await sourceMaster('LAB_TEST', ids[1]);
    const directX = await createDirectService(
      `X-${suffix}`,
      'Synthetic X',
      'LABORATORY',
      'laboratory',
      'Test',
      '11.00',
    );
    await createDirectService(
      `Y-${suffix}`,
      'Synthetic Y',
      'LABORATORY',
      'laboratory',
      'Test',
      '22.00',
    );
    const option = await addReviewedSpecimen(facilityRow, actor, {
      testId: ids[0],
      specimenType: 'Synthetic reviewed specimen X',
      reviewReference: 'synthetic clinical review',
    });
    await configure(facilityRow, x, '11.00');
    await configure(facilityRow, y, '22.00');
    const alias = await approveMasterAlias(facilityRow, actor, y, {
      sourceType: 'LAB_TEST',
      sourceId: ids[0],
      reviewReference: 'synthetic review',
    });
    const complete = async () => {
      const order = await createLabOrder(ctx, {
        tenantId: tenant,
        facilityId: facility,
        patientId: patient,
        encounterId,
        testId: ids[0],
        specimenOptionId: option.id,
        testName: 'Synthetic X',
      });
      await updateLabOrderStatus(ctx, order!.id, 'Sample Collected');
      const result = await addLabResult(ctx, {
        orderId: order!.id,
        patientId: patient,
        parameterName: 'Synthetic',
        measuredValue: '1',
      });
      await verifyLabResult(ctx, result.id, 'Synthetic verifier');
      return completeLabInvestigation(ctx, order!.id);
    };
    const first = await complete();
    expect(
      await chargeAndRecord(db, labOrderChargeRequest(first), first.billingOutboxAttemptId),
    ).toMatchObject({
      charged: true,
      totalAmount: '11.00',
    });
    // Simulate an intentionally retired mapping without editing any invoice.
    await pool.query(
      "UPDATE master_service_sources SET is_active=false WHERE facility_id=$1 AND source_type='LAB_TEST' AND source_id=$2 AND is_active",
      [facility, ids[0]],
    );
    await syncMasterCatalogue(facilityRow, actor);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM master_service_sources WHERE facility_id=$1 AND source_type='LAB_TEST' AND source_id=$2 AND is_active",
          [facility, ids[0]],
        )
      ).rows[0].n,
    ).toBe(0);
    const second = await complete();
    expect(
      await chargeAndRecord(db, labOrderChargeRequest(second), second.billingOutboxAttemptId),
    ).toMatchObject({
      charged: true,
      totalAmount: '11.00',
    });
    await expect(
      retireMasterAlias(otherRow, actor, alias.id, 'synthetic reason'),
    ).rejects.toMatchObject({ code: 'ALIAS_NOT_FOUND' });
    await retireMasterAlias(facilityRow, actor, alias.id, 'synthetic reason');
    const third = await complete();
    expect(
      await chargeAndRecord(db, labOrderChargeRequest(third), third.billingOutboxAttemptId),
    ).toMatchObject({
      charged: true,
      totalAmount: '11.00',
    });
    const billedIdentities = (
      await pool.query(
        "SELECT facility_service_id,master_service_id FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=ANY($1::int[])",
        [[first.id, second.id, third.id]],
      )
    ).rows;
    expect(billedIdentities).toHaveLength(3);
    expect(
      billedIdentities.every(
        (row) => row.facility_service_id === directX.service.id && row.master_service_id === null,
      ),
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='MASTER_SERVICE_ALIAS' AND resource_id=$1",
          [String(alias.id)],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await pool.query(
          "SELECT unit_price::text FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [first.id],
        )
      ).rows[0].unit_price,
    ).toBe('11.00');
  });

  it('does not bill a legacy master mapping until a facility-owned service is configured', async () => {
    const code = `EXACT-${suffix.toUpperCase()}`;
    const [source] = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,$2,'Synthetic exact match') RETURNING id",
        [facility, code],
      )
    ).rows;
    const [master] = (
      await pool.query(
        "INSERT INTO master_services(code,description,department,billing_family,unit,clinical_source) VALUES($1,'Synthetic exact master','laboratory','LABORATORY','Test','SYNTHETIC') RETURNING id",
        [code],
      )
    ).rows;
    const [tariff] = (
      await pool.query(
        "INSERT INTO facility_service_tariffs(tenant_id,facility_id,master_service_id,code,description,department,unit,fee,is_active,auto_bill) VALUES($1,$2,$3,$4,'Synthetic exact master','laboratory','Test',44,true,true) RETURNING id,revision",
        [tenant, facility, master.id, code],
      )
    ).rows;
    await approveMasterTariff(facilityRow, actor, tariff.id, tariff.revision, 'synthetic review');
    const preview = await call(
      'GET',
      `/api/master-services?facilityId=${facility}&family=LABORATORY`,
    );
    expect(preview.status).toBe(404);
    const option = await addReviewedSpecimen(facilityRow, actor, {
      testId: source.id,
      specimenType: 'Synthetic reviewed exact specimen',
      reviewReference: 'synthetic clinical review',
    });
    const order = await createLabOrder(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId,
      testId: source.id,
      specimenOptionId: option.id,
      testName: 'Synthetic exact match',
    });
    await updateLabOrderStatus(ctx, order!.id, 'Sample Collected');
    const result = await addLabResult(ctx, {
      orderId: order!.id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    await verifyLabResult(ctx, result.id, 'Synthetic verifier');
    const completed = await completeLabInvestigation(ctx, order!.id);
    expect(await chargeAndRecord(db, labOrderChargeRequest(completed))).toMatchObject({
      charged: false,
      diagnosis: { code: 'SERVICE_NOT_CONFIGURED' },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order!.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const mapping = await setMasterSourceMapping(facilityRow, actor, master.id, {
      sourceType: 'LAB_TEST',
      sourceId: source.id,
      reviewReference: 'synthetic explicit source review',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='MASTER_SERVICE_SOURCE' AND resource_id=$1",
          [String(mapping.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    // A historical mapping alone must not reactivate master-based charging.
    expect(await chargeAndRecord(db, labOrderChargeRequest(completed))).toMatchObject({
      charged: false,
      diagnosis: { code: 'SERVICE_NOT_CONFIGURED' },
    });
    const configured = await call('POST', '/api/facility-services', {
      facilityId: facility,
      code,
      initialTariffCode: `DIRECT-${code}`,
      name: 'Synthetic exact match',
      description: 'Synthetic exact match',
      category: 'LABORATORY',
      department: 'laboratory',
      unit: 'Test',
      initialPrice: '44.00',
      isActive: true,
      autoBill: true,
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(201);
    // Configuring a tariff later does not establish what the older event cost.
    expect(await chargeAndRecord(db, labOrderChargeRequest(completed))).toMatchObject({
      charged: false,
      diagnosis: { code: 'HISTORICAL_PRICE_REVIEW_REQUIRED' },
    });
    const attempt = (
      await pool.query(
        "SELECT id FROM billing_charge_attempts WHERE facility_id=$1 AND source_type='LAB_ORDER' AND source_id=$2 AND status='PENDING'",
        [facility, order!.id],
      )
    ).rows[0].id;
    expect(
      await retryChargeAttempt(db, {
        tenantId: tenant,
        facilityId: facility,
        attemptId: attempt,
        actorUserId: actor,
        priceReview: {
          tariffId: configured.body.tariff.id,
          revision: configured.body.tariff.revision,
          unitPrice: '44.00',
          reason: 'Reviewed documented synthetic price',
        },
      }),
    ).toMatchObject({ status: 'BILLED', result: { charged: true, totalAmount: '44.00' } });
    expect(await chargeAndRecord(db, labOrderChargeRequest(completed))).toMatchObject({
      charged: false,
      reason: 'DUPLICATE',
    });
    expect(
      (
        await pool.query(
          "SELECT master_service_id,facility_service_id,service_date,service_performed_at FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order!.id],
        )
      ).rows[0],
    ).toMatchObject({
      master_service_id: null,
      facility_service_id: configured.body.service.id,
      service_performed_at: expect.any(Date),
    });
    // Retiring the legacy link cannot alter the current facility service or
    // rewrite the historical invoice snapshot.
    await pool.query('UPDATE master_service_sources SET is_active=false WHERE id=$1', [mapping.id]);
    const available = await call(
      'GET',
      `/api/facility-services/available?facilityId=${facility}&category=LABORATORY`,
    );
    expect(
      available.body.find((entry: { id: number }) => entry.id === configured.body.service.id),
    ).toMatchObject({
      unitPrice: '44.00',
      priceStatus: 'AVAILABLE',
    });
  });

  it('blocks future, expired and inactive facility tariffs on the clinical event date', async () => {
    const edit = async (from: string | null, to: string | null, active = true) => {
      const saved = await call('PUT', `/api/facility-tariffs/${directFollowUp.tariff.id}`, {
        facilityId: facility,
        serviceId: directFollowUp.service.id,
        expectedRevision: directFollowUp.tariff.revision,
        code: directFollowUp.service.code,
        description: 'Synthetic follow up',
        department: 'opd',
        unit: 'Visit',
        fee: '42.00',
        isActive: active,
        autoBill: true,
        effectiveFrom: from,
        effectiveTo: to,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      directFollowUp.tariff.revision = saved.body.revision;
    };
    const encounter = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'FOLLOW_UP',
      consultationFacilityServiceId: directFollowUp.service.id,
    });
    const done = await updateEncounterScoped(ctx, encounter.id, { status: 'Completed' });
    await edit('2099-01-01', null);
    expect((await chargeAndRecord(db, consultationChargeRequest(done!))).diagnosis?.code).toBe(
      'NOT_YET_EFFECTIVE',
    );
    await edit(null, '2000-01-01');
    expect((await chargeAndRecord(db, consultationChargeRequest(done!))).diagnosis?.code).toBe(
      'EXPIRED',
    );
    await edit(null, null, false);
    expect((await chargeAndRecord(db, consultationChargeRequest(done!))).diagnosis?.code).toBe(
      'TARIFF_NOT_CONFIGURED',
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='CONSULTATION' AND source_id=$1",
          [encounter.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('rechecks manual tariff snapshots under transaction and retains an audited whole-invoice void', async () => {
    const tariff = directOpd.tariff,
      service = directOpd.service;
    const data = {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      invoiceNumber: `MAN-${suffix}`,
      totalAmount: '100.00',
      balanceAmount: '100.00',
    };
    const line = {
      itemType: 'Consultation',
      description: service.name,
      quantity: 1,
      unitPrice: '99.00',
      totalAmount: '99.00',
      tariffId: tariff.id,
      tariffCode: service.code,
      facilityServiceId: service.id,
      serviceCode: service.code,
      serviceDepartment: 'opd',
      serviceUnit: 'Visit',
    };
    await expect(createInvoice(data, [line])).rejects.toThrow();
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE invoice_number=$1', [
          data.invoiceNumber,
        ])
      ).rows[0].n,
    ).toBe(0);
    const created = await createInvoice(data, [
      { ...line, unitPrice: '100.00', totalAmount: '100.00' },
    ]);
    const voided = await voidInvoiceScoped(ctx, created.id, 'synthetic correction review');
    expect(voided.status).toBe('Void');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='Invoice' AND resource_id=$1",
          [String(created.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_items WHERE invoice_id=$1', [
          created.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('bills completed OPD, laboratory, imaging, pharmacy and admission through authenticated HTTP', async () => {
    const created = await call('POST', '/api/patients', {
      registrationFacilityId: facility,
      firstName: 'Synthetic',
      lastName: 'Priced HTTP',
      dateOfBirth: '2000-01-01',
      gender: 'Other',
    });
    expect(created.status).toBe(201);
    const pid = created.body.id;
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: pid,
      encounterType: 'OUTPATIENT',
      consultationFacilityServiceId: directOpd.service.id,
    });
    expect(visit.status).toBe(201);
    expect(visit.body.billing).toBeNull();
    const eid = visit.body.id;
    const complete = await call('PUT', `/api/encounters/${eid}`, { status: 'Completed' });
    expect(complete.status).toBe(200);
    expect(complete.body.billing).toMatchObject({ charged: true, totalAmount: '100.00' });
    const invoice = complete.body.billing.invoiceId;
    const lab = await call('POST', '/api/lab-orders', {
      facilityId: facility,
      patientId: pid,
      encounterId: eid,
      testId,
      specimenOptionId: testOption,
      testName: 'Synthetic exact count',
    });
    expect(lab.status).toBe(201);
    expect(lab.body.billing).toBeNull();
    expect(
      (await call('PUT', `/api/lab-orders/${lab.body.id}/status`, { status: 'Sample Collected' }))
        .status,
    ).toBe(200);
    const result = await call('POST', '/api/lab-results', {
      orderId: lab.body.id,
      patientId: pid,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    expect(result.status).toBe(201);
    expect((await call('POST', `/api/lab-results/${result.body.id}/verify`, {})).status).toBe(200);
    const labComplete = await call('POST', `/api/lab-orders/${lab.body.id}/complete`, {});
    expect(labComplete.body.billing).toMatchObject({
      charged: true,
      totalAmount: '800.00',
      invoiceId: invoice,
    });
    const image = await call('POST', '/api/radiology-orders', {
      facilityId: facility,
      patientId: pid,
      encounterId: eid,
      facilityServiceId: directImaging.service.id,
      modality: 'Synthetic',
      procedureName: 'Caller text',
    });
    expect(image.status).toBe(201);
    expect(image.body.billing).toBeNull();
    const report = await call('PUT', `/api/radiology-orders/${image.body.id}/report`, {
      findings: 'Synthetic findings',
      reportedBy: 'Synthetic reporter',
    });
    expect(report.body.billing).toMatchObject({
      charged: true,
      totalAmount: '300.00',
      invoiceId: invoice,
    });
    const med = await call('POST', '/api/medications', {
      encounterId: eid,
      patientId: pid,
      drugName: 'Synthetic product',
      dosage: 'synthetic',
      frequency: 'synthetic',
      duration: 'synthetic',
      quantity: 1,
    });
    expect(med.status).toBe(201);
    const dispensed = await call('POST', '/api/pharmacy/dispense', {
      facilityId: facility,
      patientId: pid,
      prescriptionId: med.body.id,
      itemId,
      quantityDispensed: 1,
      idempotencyKey: randomUUID(),
    });
    expect(dispensed.body.billing).toMatchObject({
      charged: true,
      totalAmount: '25.00',
      invoiceId: invoice,
    });
    const bed = (
      await pool.query('INSERT INTO beds(ward_id,bed_number) VALUES($1,$2) RETURNING id', [
        wardId,
        `H-${suffix}`,
      ])
    ).rows[0].id;
    const admitted = await call('POST', '/api/admissions', {
      facilityId: facility,
      patientId: pid,
      wardId,
      bedId: bed,
      facilityServiceId: directAdmission.service.id,
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect(admitted.body.billing).toMatchObject({ charged: true, totalAmount: '60.00' });
    expect(admitted.body.encounterId).not.toBe(eid);
    expect(admitted.body.billing.invoiceId).not.toBe(invoice);
    const detail = await call('GET', `/api/invoices/${invoice}`);
    expect(detail.status).toBe(200);
    expect(detail.body.invoice).toMatchObject({
      totalAmount: '1225.00',
      balanceAmount: '1225.00',
      patientId: pid,
    });
    expect(detail.body.items.map((line: { sourceType: string }) => line.sourceType).sort()).toEqual(
      ['CONSULTATION', 'LAB_ORDER', 'PHARMACY', 'RADIOLOGY'],
    );
    const inpatientInvoice = await call('GET', `/api/invoices/${admitted.body.billing.invoiceId}`);
    expect(inpatientInvoice.status).toBe(200);
    expect(inpatientInvoice.body.invoice).toMatchObject({
      totalAmount: '60.00',
      patientId: pid,
      encounterId: admitted.body.encounterId,
    });
    expect(
      inpatientInvoice.body.items.map((line: { sourceType: string }) => line.sourceType),
    ).toEqual(['ADMISSION']);
  });

  it('keeps master HTTP endpoints retired, scopes direct changes and records their audit', async () => {
    expect(
      (await call('GET', `/api/master-tariffs?facilityId=${facility}`, undefined, '')).status,
    ).toBe(401);
    expect((await call('GET', `/api/master-tariffs?facilityId=${facility}`)).status).toBe(404);
    expect((await call('GET', `/api/facility-tariffs?facilityId=${other}`)).status).toBe(403);
    const listed = await call('GET', `/api/facility-tariffs?facilityId=${facility}`);
    expect(listed.status).toBe(200);
    expect(listed.body.some((row: { id: number }) => row.id === directZero.tariff.id)).toBe(true);
    const edited = await call('PUT', `/api/facility-tariffs/${directZero.tariff.id}`, {
      facilityId: facility,
      serviceId: directZero.service.id,
      expectedRevision: directZero.tariff.revision,
      code: directZero.service.code,
      description: 'Synthetic emergency price',
      department: 'opd',
      unit: 'Visit',
      fee: '35.00',
      isActive: true,
      autoBill: true,
      effectiveFrom: null,
      effectiveTo: null,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.fee).toBe('35.00');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='FACILITY_SERVICE_TARIFF' AND resource_id=$1 AND action='UPDATE'",
          [String(directZero.tariff.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    const preserved = (
      await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [legacyId])
    ).rows[0].fee;
    expect(preserved).toBe('100.00');
  });

  it('uses facility-specific prices and blocks cross-facility mappings and null approvals', async () => {
    const otherCtx = { ...ctx, facilityId: other };
    const enc = await createEncounterScoped(otherCtx, {
      tenantId: tenant,
      facilityId: other,
      patientId: patient,
      encounterType: 'OUTPATIENT',
      consultationFacilityServiceId: otherOpd.service.id,
    });
    const done = await updateEncounterScoped(otherCtx, enc.id, { status: 'Completed' });
    const billed = await chargeAndRecord(
      db,
      consultationChargeRequest(done!),
      done!.billingOutboxAttemptId,
    );
    expect(billed).toMatchObject({ charged: true, totalAmount: '999.00' });
    await expect(
      createEncounterScoped(otherCtx, {
        tenantId: tenant,
        facilityId: other,
        patientId: patient,
        encounterType: 'OUTPATIENT',
        consultationFacilityServiceId: directOpd.service.id,
      }),
    ).rejects.toMatchObject({ code: 'CONSULTATION_UNAVAILABLE' });
    const masterId = await sourceMaster('LAB_TEST', testId);
    await expect(
      pool.query(
        "INSERT INTO master_service_sources(tenant_id,facility_id,source_type,source_id,master_service_id) VALUES($1,$2,'LAB_TEST',$3,$4)",
        [tenant, other, testId, masterId],
      ),
    ).rejects.toThrow();
    const row = (await listMasterCatalogue(facilityRow)).find(
      (x) => x.master.code === 'JC-OPD-FOLLOWUP',
    )!;
    await pool.query('UPDATE facility_service_tariffs SET fee=1 WHERE id=$1', [row.tariff!.id]);
    await expect(
      pool.query(
        "UPDATE facility_service_tariffs SET approval_status='APPROVED',approved_by_user_id=$1,approved_at=now(),approval_reference=NULL WHERE id=$2",
        [actor, row.tariff!.id],
      ),
    ).rejects.toThrow();
  });
});
