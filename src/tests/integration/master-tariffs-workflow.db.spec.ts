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
import { chargeAndRecord } from '../../billing/charge-attempts.ts';
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
import { recordManualRefund } from '../../billing/refunds.service.ts';
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
  let base: string, close: () => Promise<void>, token: string;
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
        "INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock) VALUES($1,'MED-A','Synthetic actual product','Tablets',20) RETURNING id",
        [facility],
      )
    ).rows[0].id;
    wardId = (
      await pool.query(
        "INSERT INTO wards(facility_id,code,name) VALUES($1,'WARD-A','Synthetic ward') RETURNING id",
        [facility],
      )
    ).rows[0].id;
    bedId = (
      await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'A-1') RETURNING id", [
        wardId,
      ])
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
    ctx = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: ['FACILITY_ADMIN'],
      permissions: ['billing.read', 'billing.payments.record', 'billing.refunds.record'],
      isSuperAdmin: false,
    };
  });

  afterAll(async () => {
    if (close) await close();
  });
  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });

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
    const opd = (await listMasterCatalogue(facilityRow)).find(
      (row) => row.master.code === 'JC-OPD-CONSULT',
    )!.master;
    const encounter = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'OUTPATIENT',
      consultationMasterServiceId: opd.id,
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
    const results = await Promise.all([chargeAndRecord(db, request), chargeAndRecord(db, request)]);
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
      tariff_code: 'OPD-CONSULT',
      service_code: 'JC-OPD-CONSULT',
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
    await recordManualRefund(ctx, {
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
    const billed = await chargeAndRecord(db, labOrderChargeRequest(completed));
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
    expect(outcome).toMatchObject({ charged: false, diagnosis: { code: 'CATALOGUE_NOT_FOUND' } });
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
      masterServiceId: imagingId,
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
    const billed = await chargeAndRecord(db, radiologyChargeRequest(reported!));
    expect(billed).toMatchObject({ charged: true, totalAmount: '300.00', invoiceId });
  });

  it('bills the actual dispensed inventory item and its actual quantity', async () => {
    const result = await dispenseFefoScoped(ctx, {
      facilityId: facility,
      patientId: patient,
      itemId,
      quantityDispensed: 2,
      dispensedBy: 'Synthetic',
      idempotencyKey: randomUUID(),
    });
    const billed = await chargeAndRecord(db, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      codes: ['MISLEADING-DRUG-NAME'],
      family: 'PHARMACY',
      sourceType: 'PHARMACY',
      sourceId: result.dispensation.id,
      itemType: 'Pharmacy',
      quantity: 2,
      serviceName: result.billingContext.drugName,
    });
    expect(billed).toMatchObject({
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
      encounterId,
      wardId,
      bedId,
    });
    admissionId = admission.id;
    const billed = await chargeAndRecord(db, admissionChargeRequest(admission));
    expect(billed).toMatchObject({ charged: true, totalAmount: '60.00' });
    const row = (await listMasterCatalogue(facilityRow)).find(
      (x) => x.master.code === 'JC-EMERGENCY-CONSULT',
    )!;
    expect(row.tariff?.fee).toBe('0.00');
    const emergency = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'EMERGENCY',
      consultationMasterServiceId: row.master.id,
    });
    const done = await updateEncounterScoped(ctx, emergency.id, { status: 'Completed' });
    const blocked = await chargeAndRecord(db, consultationChargeRequest(done!));
    expect(blocked).toMatchObject({ charged: false, diagnosis: { code: 'ZERO_PRICE' } });
  });

  it('atomically queues ward-specific bed-day work on transfer and avoids requeueing on discharge', async () => {
    const [nextWard] = (
      await pool.query(
        "INSERT INTO wards(facility_id,code,name) VALUES($1,$2,'Synthetic transfer ward') RETURNING id",
        [facility, `WARD-B-${suffix}`],
      )
    ).rows;
    const [nextBed] = (
      await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'B-1') RETURNING id", [
        nextWard.id,
      ])
    ).rows;
    await syncMasterCatalogue(facilityRow, actor);
    await configure(facilityRow, await sourceMaster('BED_DAY', nextWard.id), '120.00');
    await transferAdmissionScoped(ctx, admissionId, {
      toWardId: nextWard.id,
      toBedId: nextBed.id,
      transferredBy: 'Synthetic',
    });
    // Simulates a crash before the route's post-commit billing call: the work is already durable.
    const queued = (
      await pool.query(
        "SELECT id,service_ref_id,service_date,idempotency_suffix FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1 AND status='PENDING'",
        [admissionId],
      )
    ).rows;
    expect(queued).toHaveLength(1);
    expect(queued[0].service_ref_id).toBe(nextWard.id);
    expect(queued[0].service_date).toBeTruthy();
    const result = await accrueBedDaysScoped(ctx, admissionId);
    expect(result.charges).toHaveLength(1);
    expect(result.charges[0]).toMatchObject({ charged: true, totalAmount: '120.00' });
    const replay = await accrueBedDaysScoped(ctx, admissionId);
    expect(replay.charges[0]).toMatchObject({ charged: false, reason: 'DUPLICATE' });
    await dischargeAdmissionScoped(ctx, admissionId, {});
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1 AND status='PENDING'",
          [admissionId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admissionId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('prioritizes an exact source mapping, then uses and auditably retires a reviewed alias', async () => {
    const ids = (
      await pool.query(
        "INSERT INTO lab_tests(facility_id,code,name) VALUES($1,$2,'Synthetic X'),($1,$3,'Synthetic Y') RETURNING id",
        [facility, `X-${suffix}`, `Y-${suffix}`],
      )
    ).rows.map((row) => Number(row.id));
    await syncMasterCatalogue(facilityRow, actor);
    const x = await sourceMaster('LAB_TEST', ids[0]),
      y = await sourceMaster('LAB_TEST', ids[1]);
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
    expect(await chargeAndRecord(db, labOrderChargeRequest(first))).toMatchObject({
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
    expect(await chargeAndRecord(db, labOrderChargeRequest(second))).toMatchObject({
      charged: true,
      totalAmount: '22.00',
    });
    await expect(
      retireMasterAlias(otherRow, actor, alias.id, 'synthetic reason'),
    ).rejects.toMatchObject({ code: 'ALIAS_NOT_FOUND' });
    await retireMasterAlias(facilityRow, actor, alias.id, 'synthetic reason');
    const third = await complete();
    expect(await chargeAndRecord(db, labOrderChargeRequest(third))).toMatchObject({
      charged: false,
      diagnosis: { code: 'MASTER_MAPPING_MISSING' },
    });
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

  it('requires a reviewed mapping even when source and master codes are identical', async () => {
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
    expect(preview.body.find((entry: { id: number }) => entry.id === source.id)).toMatchObject({
      unitPrice: null,
      priceStatus: 'MASTER_MAPPING_MISSING',
    });
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
      diagnosis: { code: 'MASTER_MAPPING_MISSING' },
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
    expect(await chargeAndRecord(db, labOrderChargeRequest(completed))).toMatchObject({
      charged: true,
      totalAmount: '44.00',
    });
    expect(await chargeAndRecord(db, labOrderChargeRequest(completed))).toMatchObject({
      charged: false,
      reason: 'DUPLICATE',
    });
    expect(
      (
        await pool.query(
          "SELECT master_service_id,service_date,service_performed_at FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [order!.id],
        )
      ).rows[0],
    ).toMatchObject({ master_service_id: master.id, service_performed_at: expect.any(Date) });
    // Synthetic retirement simulation: matching codes must not resurrect a retired link.
    await pool.query('UPDATE master_service_sources SET is_active=false WHERE id=$1', [mapping.id]);
    const retired = await call(
      'GET',
      `/api/master-services?facilityId=${facility}&family=LABORATORY`,
    );
    expect(retired.body.find((entry: { id: number }) => entry.id === source.id)).toMatchObject({
      unitPrice: null,
      priceStatus: 'MASTER_MAPPING_MISSING',
    });
  });

  it('blocks future, expired and subsequently edited unapproved tariffs', async () => {
    const row = (await listMasterCatalogue(facilityRow)).find(
      (x) => x.master.code === 'JC-OPD-FOLLOWUP',
    )!;
    const edit = async (from: string | null, to: string | null) => {
      const current = (await listMasterCatalogue(facilityRow)).find(
        (x) => x.master.id === row.master.id,
      )!.tariff!;
      const [saved] = await editMasterTariffs(facilityRow, actor, [
        {
          tariffId: current.id,
          revision: current.revision,
          fee: '42.00',
          unit: 'Visit',
          isActive: true,
          autoBill: true,
          effectiveFrom: from,
          effectiveTo: to,
        },
      ]);
      await approveMasterTariff(facilityRow, actor, saved.id, saved.revision, 'synthetic review');
    };
    const encounter = await createEncounterScoped(ctx, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterType: 'FOLLOW_UP',
      consultationMasterServiceId: row.master.id,
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
    await pool.query('UPDATE facility_service_tariffs SET fee=43 WHERE id=$1', [row.tariff!.id]);
    expect((await chargeAndRecord(db, consultationChargeRequest(done!))).diagnosis?.code).toBe(
      'TARIFF_UNAPPROVED',
    );
  });

  it('rechecks manual tariff snapshots under transaction and retains an audited whole-invoice void', async () => {
    const row = (await listMasterCatalogue(facilityRow)).find(
      (x) => x.master.code === 'JC-OPD-CONSULT',
    )!;
    const tariff = row.tariff!,
      master = row.master;
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
      description: master.description,
      quantity: 1,
      unitPrice: '99.00',
      totalAmount: '99.00',
      tariffId: tariff.id,
      tariffCode: tariff.code,
      masterServiceId: master.id,
      serviceCode: master.code,
      serviceDepartment: master.department,
      serviceUnit: tariff.unit,
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
    const opd = (await listMasterCatalogue(facilityRow)).find(
      (row) => row.master.code === 'JC-OPD-CONSULT',
    )!.master;
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: pid,
      encounterType: 'OUTPATIENT',
      consultationMasterServiceId: opd.id,
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
      masterServiceId: imagingId,
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
      encounterId: eid,
      wardId,
      bedId: bed,
    });
    expect(admitted.status).toBe(201);
    expect(admitted.body.billing).toMatchObject({
      charged: true,
      totalAmount: '60.00',
      invoiceId: invoice,
    });
    const detail = await call('GET', `/api/invoices/${invoice}`);
    expect(detail.status).toBe(200);
    expect(detail.body.invoice).toMatchObject({
      totalAmount: '1285.00',
      balanceAmount: '1285.00',
      patientId: pid,
    });
    expect(detail.body.items.map((line: { sourceType: string }) => line.sourceType).sort()).toEqual(
      ['ADMISSION', 'CONSULTATION', 'LAB_ORDER', 'PHARMACY', 'RADIOLOGY'],
    );
  });

  it('restricts master tariff HTTP access and records reviewed price changes', async () => {
    expect(
      (await call('GET', `/api/master-tariffs?facilityId=${facility}`, undefined, '')).status,
    ).toBe(401);
    expect((await call('GET', `/api/master-tariffs?facilityId=${other}`)).status).toBe(403);
    const listed = await call('GET', `/api/master-tariffs?facilityId=${facility}`);
    expect(listed.status).toBe(200);
    const row = listed.body.find(
      (r: { master: { code: string } }) => r.master.code === 'JC-EMERGENCY-CONSULT',
    );
    const edited = await call('PUT', '/api/master-tariffs/batch', {
      facilityId: facility,
      rows: [
        {
          tariffId: row.tariff.id,
          revision: row.tariff.revision,
          fee: '35.00',
          unit: 'Visit',
          isActive: true,
          autoBill: true,
          effectiveFrom: null,
          effectiveTo: null,
        },
      ],
    });
    expect(edited.status).toBe(200);
    expect(edited.body[0]).toMatchObject({ fee: '35.00', approvalStatus: 'DRAFT' });
    const approved = await call('POST', `/api/master-tariffs/${row.tariff.id}/approve`, {
      facilityId: facility,
      revision: edited.body[0].revision,
      approvalReference: 'synthetic approval',
    });
    expect(approved.status).toBe(200);
    expect(approved.body.approvalStatus).toBe('APPROVED');
    const history = await call(
      'GET',
      `/api/master-tariffs/${row.tariff.id}/history?facilityId=${facility}`,
    );
    expect(history.status).toBe(200);
    expect(history.body.some((x: { action: string }) => x.action === 'APPROVE')).toBe(true);
    const preserved = (
      await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [legacyId])
    ).rows[0].fee;
    expect(preserved).toBe('100.00');
  });

  it('uses facility-specific prices and blocks cross-facility mappings and null approvals', async () => {
    const otherCtx = { ...ctx, facilityId: other };
    const opd = (await listMasterCatalogue(otherRow)).find(
      (row) => row.master.code === 'JC-OPD-CONSULT',
    )!.master;
    const enc = await createEncounterScoped(otherCtx, {
      tenantId: tenant,
      facilityId: other,
      patientId: patient,
      encounterType: 'OUTPATIENT',
      consultationMasterServiceId: opd.id,
    });
    const done = await updateEncounterScoped(otherCtx, enc.id, { status: 'Completed' });
    const billed = await chargeAndRecord(db, consultationChargeRequest(done!));
    expect(billed).toMatchObject({ charged: true, totalAmount: '999.00' });
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
