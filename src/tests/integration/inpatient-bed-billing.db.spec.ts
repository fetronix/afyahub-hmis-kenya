import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { finalizeInvoice, getFinalizedInvoice } from '../../billing/finalized-invoice.service.ts';
import { prepareShaClaim } from '../../insurance/eclaims/claims-workflow.service.ts';
import {
  preparePrivateInsuranceClaim,
  validatePrivateInsuranceClaimById,
} from '../../insurance/claims/private-claims.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Bed daily-charge billing at discharge (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number,
    facility: number,
    sameTenantFacility: number,
    otherTenant: number,
    otherFacility: number,
    ward: number,
    secondWard: number,
    actor: number;
  let token: string,
    otherToken: string,
    sameTenantToken: string,
    tenantToken: string,
    limitedToken: string,
    platformToken: string,
    base: string,
    close: () => Promise<void>;
  let serial = 0;
  const grants = [
    'inpatient.read',
    'inpatient.admit',
    'inpatient.discharge',
    'inpatient.wards.create',
    'inpatient.wards.update',
    'inpatient.wards.delete',
    'inpatient.beds.create',
    'inpatient.beds.update',
    'inpatient.beds.delete',
    'billing.read',
    'billing.create',
    'billing.update',
    'clinical.read',
    'clinical.create',
    'billing.payments.record',
  ];
  const call = (method: string, path: string, body?: Record<string, unknown>, auth = token) =>
    httpJson(base, method, path, { token: auth, body });
  async function makePatient(f = facility, t = tenant) {
    return (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Bed','2000-01-01','Other') RETURNING id",
        [t, f, `BED-P-${suffix}-${++serial}`],
      )
    ).rows[0].id as number;
  }
  async function makeEncounter(patient: number, f = facility, t = tenant) {
    return (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'INPATIENT','ACTIVE') RETURNING id",
        [t, f, patient],
      )
    ).rows[0].id as number;
  }
  async function makeBed(w = ward, rate: string | null = '100.00') {
    return (
      await pool.query(
        "INSERT INTO beds(ward_id,bed_number,bed_type,status,daily_charge) VALUES($1,$2,'Standard','Available',$3) RETURNING id",
        [w, `BED-${suffix}-${++serial}`, rate],
      )
    ).rows[0].id as number;
  }
  async function makeSyntheticStay(
    days: number,
    encounter = true,
    rate = '100.00',
    fixedStart?: Date,
  ) {
    const patient = await makePatient(),
      visit = encounter ? await makeEncounter(patient) : null,
      bed = await makeBed(ward, rate);
    const start = fixedStart ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const admission = (
      await pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,'Admitted') RETURNING id",
        [tenant, facility, patient, visit, ward, bed, start.toISOString()],
      )
    ).rows[0].id as number;
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [
      patient,
      bed,
    ]);
    await pool.query(
      "INSERT INTO inpatient_bed_stay_snapshots(admission_id,tenant_id,facility_id,patient_id,timezone_snapshot,cutoff_minutes,grace_minutes,same_day_rule,policy_revision) VALUES($1,$2,$3,$4,'Africa/Nairobi',0,0,'ONE',1)",
      [admission, tenant, facility, patient],
    );
    await pool.query(
      "INSERT INTO inpatient_bed_occupancies(admission_id,tenant_id,facility_id,patient_id,ward_id,bed_id,started_at,daily_rate_snapshot,bed_number_snapshot,bed_type_snapshot,ward_name_snapshot,recorded_by_user_id) SELECT $1,$2,$3,$4,$5,id,$6,$7,bed_number,bed_type,'Synthetic ward',$8 FROM beds WHERE id=$9",
      [admission, tenant, facility, patient, ward, start, rate, actor, bed],
    );
    return { admission, patient, encounter: visit, bed, start };
  }
  async function user(t: number, f: number | null, label: string, grants: string[]) {
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic bed user','test-only','ACTIVE',$3,$4) RETURNING id",
        [`bed-${label}-${suffix}`, `bed-${label}-${suffix}@example.test`, t, f],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [t, `BED_${label}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const grant of grants) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'inpatient') ON CONFLICT(code) DO NOTHING",
        [grant],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, grant],
      );
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }
  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('synthetic') ||
      !(process.env.SQL_DB_NAME ?? '').includes('test')
    )
      throw new Error('A disposable synthetic test database is required.');
    [tenant, otherTenant] = (
      await pool.query(
        'INSERT INTO tenants(name,slug,timezone) VALUES($1,$2,$5),($3,$4,$5) RETURNING id',
        [
          `Synthetic bed ${suffix}`,
          `bed-a-${suffix}`,
          `Synthetic bed other ${suffix}`,
          `bed-b-${suffix}`,
          'Africa/Nairobi',
        ],
      )
    ).rows.map((r) => r.id);
    [facility, otherFacility] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic A','Africa/Nairobi',$5::jsonb),($3,$4,'Synthetic B','Africa/Nairobi',$5::jsonb) RETURNING id",
        [
          tenant,
          `BEDA-${suffix}`,
          otherTenant,
          `BEDB-${suffix}`,
          JSON.stringify(['inpatient', 'finance']),
        ],
      )
    ).rows.map((r) => r.id);
    sameTenantFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic same tenant','Africa/Nairobi',$3::jsonb) RETURNING id",
        [tenant, `BEDC-${suffix}`, JSON.stringify(['inpatient', 'finance'])],
      )
    ).rows[0].id;
    [ward, secondWard] = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic ward',$2),($1,'Synthetic transfer ward',$3) RETURNING id",
        [facility, `BW-${suffix}`, `BX-${suffix}`],
      )
    ).rows.map((r) => r.id);
    const manager = await user(tenant, facility, 'manager', grants);
    actor = manager.id;
    token = manager.token;
    otherToken = (await user(otherTenant, otherFacility, 'other', grants)).token;
    sameTenantToken = (await user(tenant, sameTenantFacility, 'same', grants)).token;
    tenantToken = (await user(tenant, null, 'tenant', grants)).token;
    limitedToken = (
      await user(tenant, facility, 'limited', [
        'inpatient.read',
        'inpatient.beds.update',
        'inpatient.wards.update',
        'clinical.read',
      ])
    ).token;
    const platform = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic platform admin','test-only','ACTIVE',$3,$4) RETURNING id",
        [`bed-platform-${suffix}`, `bed-platform-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id",
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [platform, role]);
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN ('inpatient.read','inpatient.wards.update','inpatient.beds.update','billing.update','clinical.read')",
      [role],
    );
    platformToken = (await createSession({ userId: platform, securityVersion: 1 })).sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    const configured = await call('PUT', '/api/inpatient/bed-billing-policy', {
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      isActive: true,
      effectiveFrom: '2020-01-01',
      reason: 'Synthetic approved policy',
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('requires authorized, audited confirmation of a legacy ward rate without repricing an earlier unpriced stay', async () => {
    const legacyWard = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code,daily_rate) VALUES($1,'Synthetic legacy ward',$2,'1500.00') RETURNING id,daily_rate_configured,daily_rate_revision",
        [facility, `LEG-${suffix}`],
      )
    ).rows[0];
    expect(legacyWard).toMatchObject({ daily_rate_configured: false, daily_rate_revision: 1 });
    const proposed = {
      dailyRate: '1500.00',
      expectedPriceRevision: 1,
      priceReason: 'Synthetic documented ward price confirmation',
    };
    expect((await call('PUT', `/api/wards/${legacyWard.id}`, proposed, limitedToken)).status).toBe(
      403,
    );
    expect((await call('PUT', `/api/wards/${legacyWard.id}`, proposed, platformToken)).status).toBe(
      403,
    );
    expect((await call('PUT', `/api/wards/${legacyWard.id}`, proposed, otherToken)).status).toBe(
      404,
    );
    expect(
      (await call('PUT', `/api/wards/${legacyWard.id}`, proposed, sameTenantToken)).status,
    ).toBe(404);
    expect(
      (
        await call(
          'PUT',
          `/api/wards/${legacyWard.id}?facilityId=${sameTenantFacility}`,
          proposed,
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('PUT', `/api/wards/${legacyWard.id}`, { ...proposed, priceReason: '' })).status,
    ).toBe(400);
    expect(
      (await call('PUT', `/api/wards/${legacyWard.id}`, { ...proposed, dailyRate: '0.00' })).status,
    ).toBe(400);
    expect(
      (await call('PUT', `/api/wards/${legacyWard.id}`, { ...proposed, expectedPriceRevision: 2 }))
        .status,
    ).toBe(409);
    await expect(
      pool.query('UPDATE wards SET daily_rate=1400 WHERE id=$1', [legacyWard.id]),
    ).rejects.toMatchObject({ code: '23514' });

    const patient = await makePatient(),
      bed = await makeBed(legacyWard.id, null);
    expect(
      (
        await call(
          'PUT',
          `/api/beds/${bed}?facilityId=${sameTenantFacility}`,
          {
            dailyCharge: '1300.00',
            expectedPriceRevision: 1,
            priceReason: 'Synthetic cross-facility check',
          },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/beds?facilityId=${sameTenantFacility}`,
          {
            wardId: legacyWard.id,
            bedNumbers: [`NO-${suffix}`],
            bedType: 'Standard',
          },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId: legacyWard.id,
      bedId: bed,
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect(admitted.body.bedBillingReadiness).toMatchObject({
      ready: false,
      issues: [{ code: 'BED_RATE_REVIEW_REQUIRED' }],
    });
    const auditFunction = `reject_ward_rate_${suffix.replaceAll('-', '')}`;
    const auditTrigger = `reject_ward_rate_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION ${auditFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='WardDailyRate' AND NEW.resource_id='${legacyWard.id}' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${auditTrigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${auditFunction}()`,
    );
    try {
      expect((await call('PUT', `/api/wards/${legacyWard.id}`, proposed)).status).toBe(500);
      expect(
        (
          await pool.query(
            'SELECT daily_rate,daily_rate_configured,daily_rate_revision FROM wards WHERE id=$1',
            [legacyWard.id],
          )
        ).rows[0],
      ).toEqual({ daily_rate: '1500.00', daily_rate_configured: false, daily_rate_revision: 1 });
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_logs WHERE resource='Ward' AND resource_id=$1 AND action='UPDATE'",
            [String(legacyWard.id)],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER ${auditTrigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${auditFunction}()`);
    }
    const confirmed = await call(
      'PUT',
      `/api/wards/${legacyWard.id}?facilityId=${facility}`,
      proposed,
      tenantToken,
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body).toMatchObject({
      dailyRate: '1500.00',
      dailyRateConfigured: true,
      dailyRateRevision: 2,
    });
    expect(
      (await call('PUT', `/api/wards/${legacyWard.id}`, { ...proposed, dailyRate: '1600.00' }))
        .status,
    ).toBe(409);
    const audit = (
      await pool.query(
        "SELECT details FROM audit_logs WHERE resource='WardDailyRate' AND resource_id=$1 AND action='UPDATE'",
        [String(legacyWard.id)],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details)).toMatchObject({
      before: '1500.00',
      after: '1500.00',
      previouslyConfigured: false,
      configured: true,
      previousRevision: 1,
      revision: 2,
      reason: proposed.priceReason,
    });
    expect(
      (
        await pool.query(
          'SELECT daily_rate_snapshot,rate_source_snapshot,price_revision_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1',
          [admitted.body.id],
        )
      ).rows[0],
    ).toEqual({
      daily_rate_snapshot: null,
      rate_source_snapshot: null,
      price_revision_snapshot: null,
    });
    const discharged = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(discharged.status, JSON.stringify(discharged.body)).toBe(200);
    expect(discharged.body.billing.review.code).toBe('BED_RATE_REVIEW_REQUIRED');
    expect(
      (
        await pool.query('SELECT id FROM inpatient_bed_nights WHERE admission_id=$1', [
          admitted.body.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [bed])).rows[0].status).toBe(
      'Cleaning',
    );
  });

  it('freezes the confirmed ward default and its provenance through concurrent discharge, invoice and receipt', async () => {
    const created = await call('POST', '/api/wards', {
      name: 'Synthetic priced ward',
      code: `WP-${suffix}`,
      wardType: 'General',
      genderAllocation: 'Mixed',
      dailyRate: '900.00',
      priceReason: 'Synthetic initial ward price',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      dailyRate: '900.00',
      dailyRateConfigured: true,
      dailyRateRevision: 1,
    });
    const wardId = created.body.id as number;
    const patient = await makePatient(),
      bed = await makeBed(wardId, null);
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId,
      bedId: bed,
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect(admitted.body.bedBillingReadiness).toEqual({ ready: true, issues: [] });
    expect(
      (
        await pool.query(
          'SELECT daily_rate_snapshot,rate_source_snapshot,price_revision_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1',
          [admitted.body.id],
        )
      ).rows[0],
    ).toEqual({
      daily_rate_snapshot: '900.00',
      rate_source_snapshot: 'WARD_DEFAULT',
      price_revision_snapshot: 1,
    });
    const changed = await call('PUT', `/api/wards/${wardId}`, {
      dailyRate: '1200.00',
      expectedPriceRevision: 1,
      priceReason: 'Synthetic later ward price',
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.dailyRateRevision).toBe(2);
    const discharges = await Promise.all([
      call('POST', `/api/admissions/${admitted.body.id}/discharge`, {}),
      call('POST', `/api/admissions/${admitted.body.id}/discharge`, {}),
    ]);
    expect(discharges.map((r) => r.status).sort()).toEqual([200, 409]);
    const success = discharges.find((r) => r.status === 200)!;
    expect(success.body.billing).toMatchObject({
      nights: 1,
      bedDays: [{ charged: true, unitPrice: '900.00', totalAmount: '900.00' }],
    });
    const rows = (
      await pool.query(
        `SELECT n.id,n.unit_price_snapshot,n.rate_source_snapshot,n.price_revision_snapshot,
        i.invoice_id,i.unit_price,i.total_amount
      FROM inpatient_bed_nights n JOIN billing_items i ON i.bed_night_id=n.id
      WHERE n.admission_id=$1`,
        [admitted.body.id],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      unit_price_snapshot: '900.00',
      rate_source_snapshot: 'WARD_DEFAULT',
      price_revision_snapshot: 1,
      unit_price: '900.00',
      total_amount: '900.00',
    });
    await expect(
      pool.query(
        "UPDATE inpatient_bed_nights SET rate_source_snapshot='BED_OVERRIDE' WHERE id=$1",
        [rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const receipt = await call('POST', '/api/billing/payments', {
      invoiceId: rows[0].invoice_id,
      facilityId: facility,
      amount: '900.00',
      paymentMethod: 'Cash',
      idempotencyKey: `ward-cash-${suffix}`,
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    expect(receipt.body.invoice).toMatchObject({
      paidAmount: '900.00',
      balanceAmount: '0.00',
      status: 'Paid',
    });
    const replay = await call('POST', '/api/billing/payments', {
      invoiceId: rows[0].invoice_id,
      facilityId: facility,
      amount: '900.00',
      paymentMethod: 'Cash',
      idempotencyKey: `ward-cash-${suffix}`,
    });
    expect([200, 201]).toContain(replay.status);
    expect(
      (
        await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [
          rows[0].invoice_id,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it('snapshots override then ward-default sources at transfer and flags a destination without a confirmed rate', async () => {
    const first = await call('POST', '/api/wards', {
      name: 'Synthetic first ward',
      code: `W1-${suffix}`,
      wardType: 'General',
      genderAllocation: 'Mixed',
      dailyRate: '700.00',
      priceReason: 'Synthetic initial ward default',
    });
    const second = await call('POST', '/api/wards', {
      name: 'Synthetic second ward',
      code: `W2-${suffix}`,
      wardType: 'General',
      genderAllocation: 'Mixed',
      dailyRate: '800.00',
      priceReason: 'Synthetic initial ward default',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const unpriced = await call('POST', '/api/wards', {
      name: 'Synthetic unpriced ward',
      code: `W3-${suffix}`,
      wardType: 'General',
      genderAllocation: 'Mixed',
    });
    expect(unpriced.status, JSON.stringify(unpriced.body)).toBe(201);
    expect(unpriced.body).toMatchObject({
      dailyRate: null,
      dailyRateConfigured: false,
      dailyRateRevision: 1,
    });
    const patient = await makePatient(),
      firstBed = await makeBed(first.body.id, '1100.00'),
      secondBed = await makeBed(second.body.id, null);
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId: first.body.id,
      bedId: firstBed,
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const transferred = await call('POST', `/api/admissions/${admitted.body.id}/transfer`, {
      toWardId: second.body.id,
      toBedId: secondBed,
      reason: 'Synthetic transfer',
    });
    expect(transferred.status, JSON.stringify(transferred.body)).toBe(200);
    expect(transferred.body.bedBillingReadiness).toEqual({ ready: true, issues: [] });
    const periods = (
      await pool.query(
        'SELECT daily_rate_snapshot,rate_source_snapshot,price_revision_snapshot,ended_at FROM inpatient_bed_occupancies WHERE admission_id=$1 ORDER BY started_at,id',
        [admitted.body.id],
      )
    ).rows;
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({
      daily_rate_snapshot: '1100.00',
      rate_source_snapshot: 'BED_OVERRIDE',
      price_revision_snapshot: 1,
    });
    expect(periods[0].ended_at).toBeTruthy();
    expect(periods[1]).toMatchObject({
      daily_rate_snapshot: '800.00',
      rate_source_snapshot: 'WARD_DEFAULT',
      price_revision_snapshot: 1,
      ended_at: null,
    });
    await expect(
      pool.query(
        "UPDATE inpatient_bed_occupancies SET rate_source_snapshot='BED_OVERRIDE' WHERE admission_id=$1 AND ended_at IS NULL",
        [admitted.body.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const view = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
    expect(view.status).toBe(200);
    expect(
      view.body.periods.map((p: { rateSourceSnapshot: string }) => p.rateSourceSnapshot),
    ).toEqual(['BED_OVERRIDE', 'WARD_DEFAULT']);
    const missingBed = await makeBed(unpriced.body.id, null);
    const missing = await call('POST', `/api/admissions/${admitted.body.id}/transfer`, {
      toWardId: unpriced.body.id,
      toBedId: missingBed,
      reason: 'Synthetic missing price transfer',
    });
    expect(missing.status, JSON.stringify(missing.body)).toBe(200);
    expect(missing.body.bedBillingReadiness).toMatchObject({
      ready: false,
      issues: [{ code: 'BED_RATE_REVIEW_REQUIRED' }],
    });
    expect(missing.body.billing.review.code).toBe('BED_RATE_REVIEW_REQUIRED');
    const discharged = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(discharged.status).toBe(200);
    expect(discharged.body.billing.review.code).toBe('BED_RATE_REVIEW_REQUIRED');
    expect(
      (
        await pool.query('SELECT id FROM inpatient_bed_nights WHERE admission_id=$1', [
          admitted.body.id,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('automatically creates an inpatient encounter and captures policy and bed-price evidence through cashier payment', async () => {
    const policy = await call('GET', '/api/inpatient/bed-billing-policy');
    expect(policy.body).toMatchObject({
      facilityId: facility,
      scope: 'FACILITY',
      isActive: true,
      effectiveFrom: '2020-01-01',
      applicability: { code: 'APPLICABLE' },
    });
    const noRateWard = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code,daily_rate) VALUES($1,'Synthetic policy ward',$2,NULL) RETURNING id",
        [facility, `AUTO-${suffix}`],
      )
    ).rows[0].id;
    const patient = await makePatient(),
      bed = await makeBed(noRateWard, '100.00');
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId: noRateWard,
      bedId: bed,
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect(admitted.body.bedBillingReadiness).toEqual({ ready: true, issues: [] });
    const visit = admitted.body.encounterId;
    expect(visit).toBeTypeOf('number');
    const captured = (
      await pool.query(
        `SELECT a.patient_id,a.facility_id,a.encounter_id,e.encounter_type,e.status,e.created_by_user_id,
      s.policy_id,s.policy_revision,s.policy_applicability,s.policy_effective_from::text,s.same_day_rule,s.manual_admission_time,
      o.ward_id,o.bed_id,o.daily_rate_snapshot,o.price_revision_snapshot,o.started_at
      FROM admissions a JOIN encounters e ON e.id=a.encounter_id JOIN inpatient_bed_stay_snapshots s ON s.admission_id=a.id
      JOIN inpatient_bed_occupancies o ON o.admission_id=a.id WHERE a.id=$1`,
        [admitted.body.id],
      )
    ).rows[0];
    expect(captured).toMatchObject({
      patient_id: patient,
      facility_id: facility,
      encounter_id: visit,
      encounter_type: 'INPATIENT',
      status: 'ACTIVE',
      created_by_user_id: actor,
      policy_id: policy.body.id,
      policy_revision: policy.body.revision,
      policy_applicability: 'APPLICABLE',
      policy_effective_from: '2020-01-01',
      same_day_rule: 'ONE',
      manual_admission_time: false,
      ward_id: noRateWard,
      bed_id: bed,
      daily_rate_snapshot: '100.00',
      price_revision_snapshot: 1,
    });
    expect(admitted.body.admissionDate).toBe(captured.started_at.toISOString());
    expect(
      (
        await pool.query(
          "SELECT id FROM audit_logs WHERE resource='Encounter' AND resource_id=$1 AND action='CREATE'",
          [String(visit)],
        )
      ).rows,
    ).toHaveLength(1);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {
      dischargeType: 'Synthetic',
      dischargeSummary: 'Synthetic only',
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing).toMatchObject({
      nights: 1,
      bedDays: [
        {
          charged: true,
          unitPrice: '100.00',
          totalAmount: '100.00',
          matchRule: 'BED_OCCUPANCY_SNAPSHOT',
        },
      ],
    });
    const lines = (
      await pool.query(
        `SELECT bi.invoice_id,bi.quantity,bi.unit_price,bi.total_amount,bi.bed_occupancy_id,bi.bed_night_id,
      inv.encounter_id,inv.patient_id,inv.total_amount AS invoice_total,inv.paid_amount,inv.balance_amount
      FROM billing_items bi JOIN billing_invoices inv ON inv.id=bi.invoice_id WHERE bi.source_type='BED_DAY' AND bi.source_id=$1`,
        [admitted.body.id],
      )
    ).rows;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quantity: 1,
      unit_price: '100.00',
      total_amount: '100.00',
      encounter_id: visit,
      patient_id: patient,
      invoice_total: '100.00',
      paid_amount: '0.00',
      balance_amount: '100.00',
    });
    expect(lines[0].bed_occupancy_id).toBeTruthy();
    expect(lines[0].bed_night_id).toBeTruthy();
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    const receipt = await call('POST', '/api/billing/payments', {
      invoiceId: lines[0].invoice_id,
      facilityId: facility,
      amount: '100.00',
      paymentMethod: 'Cash',
      idempotencyKey: `bed-cash-${suffix}`,
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    expect(receipt.body.invoice).toMatchObject({
      paidAmount: '100.00',
      balanceAmount: '0.00',
      status: 'Paid',
    });
    const savedReceipt = (
      await pool.query(
        'SELECT invoice_id,payment_method,amount,receipt_number FROM billing_payments WHERE id=$1',
        [receipt.body.payment.id],
      )
    ).rows[0];
    expect(savedReceipt).toMatchObject({
      invoice_id: lines[0].invoice_id,
      payment_method: 'Cash',
      amount: '100.00',
    });
    expect(savedReceipt.receipt_number).toBeTruthy();
    const paymentReplay = await call('POST', '/api/billing/payments', {
      invoiceId: lines[0].invoice_id,
      facilityId: facility,
      amount: '100.00',
      paymentMethod: 'Cash',
      idempotencyKey: `bed-cash-${suffix}`,
    });
    expect(paymentReplay.status).toBe(200);
    expect(paymentReplay.body).toMatchObject({
      idempotentReplay: true,
      payment: { id: receipt.body.payment.id },
    });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_payments WHERE invoice_id=$1', [
          lines[0].invoice_id,
        ])
      ).rows[0].n,
    ).toBe(1);
    const retry = await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {});
    expect(retry.body.charges).toMatchObject([{ charged: false, reason: 'DUPLICATE' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows[0].n,
    ).toBe(1);
    const anotherBed = await makeBed(noRateWard, '100.00');
    expect(
      (
        await call('POST', '/api/admissions', {
          patientId: patient,
          wardId: noRateWard,
          bedId: anotherBed,
          encounterId: visit,
        })
      ).status,
    ).toBe(409);
  });

  it('bills a KES 100 bed with no ward rate using database-generated admission and discharge times', async () => {
    const noRateWard = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code,daily_rate) VALUES($1,'Synthetic no-rate ward',$2,NULL) RETURNING id",
        [facility, `NULL-${suffix}`],
      )
    ).rows[0].id;
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed(noRateWard);
    expect(
      (await pool.query('SELECT daily_rate FROM wards WHERE id=$1', [noRateWard])).rows[0]
        .daily_rate,
    ).toBeNull();
    expect(
      (
        await call(
          'PUT',
          `/api/inpatient/bed-billing-policy?facilityId=${facility}`,
          {
            facilityId: sameTenantFacility,
            cutoffMinutes: 0,
            graceMinutes: 0,
            sameDayRule: 'ONE',
            isActive: true,
            effectiveFrom: '2020-01-01',
            reason: 'Synthetic mismatch',
          },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await pool.query('SELECT id FROM inpatient_bed_billing_policies WHERE facility_id=$1', [
          sameTenantFacility,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await call(
          'POST',
          `/api/admissions?facilityId=${sameTenantFacility}`,
          {
            facilityId: facility,
            patientId: patient,
            encounterId: encounter,
            wardId: noRateWard,
            bedId: bed,
          },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await pool.query('SELECT id FROM admissions WHERE patient_id=$1', [patient])).rows,
    ).toHaveLength(0);
    const admitted = await call(
      'POST',
      `/api/admissions?facilityId=${facility}`,
      { patientId: patient, encounterId: encounter, wardId: noRateWard, bedId: bed },
      tenantToken,
    );
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const initial = (
      await pool.query(
        `SELECT s.manual_admission_time,s.manual_discharge_time,o.started_at,o.daily_rate_snapshot
      FROM inpatient_bed_stay_snapshots s JOIN inpatient_bed_occupancies o USING(admission_id) WHERE s.admission_id=$1`,
        [admitted.body.id],
      )
    ).rows[0];
    expect(initial).toMatchObject({
      manual_admission_time: false,
      manual_discharge_time: false,
      daily_rate_snapshot: '100.00',
    });
    expect(admitted.body.admissionDate).toBe(initial.started_at.toISOString());
    expect(
      (await call('GET', `/api/beds?facilityId=${facility}`, undefined, tenantToken)).body.some(
        (row: { id: number }) => row.id === bed,
      ),
    ).toBe(true);
    expect(
      (
        await call(
          'GET',
          `/api/beds?facilityId=${sameTenantFacility}&wardId=${noRateWard}`,
          undefined,
          tenantToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/inpatient/board?facilityId=${facility}`, undefined, tenantToken))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          'GET',
          `/api/admissions/${admitted.body.id}/bed-occupancy`,
          undefined,
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          `/api/admissions/${admitted.body.id}/bed-occupancy?facilityId=${sameTenantFacility}`,
          undefined,
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          `/api/admissions/${admitted.body.id}/bed-occupancy?facilityId=${facility}`,
          undefined,
          tenantToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/accrue-bed-days?facilityId=${sameTenantFacility}`,
          {},
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/accrue-bed-days?facilityId=${facility}`,
          {},
          tenantToken,
        )
      ).body.estimateOnly,
    ).toBe(true);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/discharge?facilityId=${sameTenantFacility}`,
          {},
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/discharge?facilityId=${facility}`,
          { facilityId: sameTenantFacility },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Occupied', current_patient_id: patient });
    const closed = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/discharge`,
      { facilityId: facility },
      tenantToken,
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.bedDays).toHaveLength(1);
    expect(closed.body.billing.bedDays[0]).toMatchObject({
      charged: true,
      unitPrice: '100.00',
      totalAmount: '100.00',
      matchRule: 'BED_OCCUPANCY_SNAPSHOT',
    });
    const end = (
      await pool.query(
        `SELECT s.manual_discharge_time,o.ended_at FROM inpatient_bed_stay_snapshots s
      JOIN inpatient_bed_occupancies o USING(admission_id) WHERE s.admission_id=$1`,
        [admitted.body.id],
      )
    ).rows[0];
    expect(end.manual_discharge_time).toBe(false);
    expect(closed.body.dischargeDate).toBe(end.ended_at.toISOString());
    const view = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
    expect(view.body.staySnapshot).toMatchObject({
      manualAdmissionTime: false,
      manualDischargeTime: false,
      cutoffMinutes: 0,
      sameDayRule: 'ONE',
    });
    expect(view.body.unresolved.attempts).toHaveLength(0);
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    expect((await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {})).status).toBe(
      409,
    );
    const retry = await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {});
    expect(retry.body.charges).toMatchObject([{ charged: false, reason: 'DUPLICATE' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await call(
          'PUT',
          `/api/beds/${bed}/release?facilityId=${sameTenantFacility}`,
          undefined,
          tenantToken,
        )
      ).status,
    ).toBe(403);
    const auditFn = `synthetic_bed_release_audit_fail_${suffix}`,
      auditTrigger = `synthetic_bed_release_audit_trigger_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${auditFn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id = ${Number(facility)} AND NEW.resource = 'Bed' AND NEW.resource_id = '${Number(bed)}' THEN RAISE EXCEPTION 'Synthetic release audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${auditTrigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${auditFn}()`,
    );
    try {
      expect(
        (
          await call(
            'PUT',
            `/api/beds/${bed}/release?facilityId=${facility}`,
            undefined,
            tenantToken,
          )
        ).status,
      ).toBe(500);
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
      ).toEqual({ status: 'Cleaning', current_patient_id: null });
    } finally {
      await pool.query(`DROP TRIGGER ${auditTrigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${auditFn}()`);
    }
    expect(
      (await call('PUT', `/api/beds/${bed}/release?facilityId=${facility}`, undefined, tenantToken))
        .status,
    ).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT tenant_id,facility_id FROM audit_logs WHERE resource='Bed' AND resource_id=$1 AND details='Bed released to Available after terminal cleaning'",
          [String(bed)],
        )
      ).rows,
    ).toEqual([{ tenant_id: tenant, facility_id: facility }]);
    expect(
      (await call('PUT', `/api/beds/${bed}/release?facilityId=${facility}`, undefined, tenantToken))
        .status,
    ).toBe(409);
  });

  it('uses an actual captured KES 100 daily charge for three cutoffs, without any bed tariff', async () => {
    const stay = await makeSyntheticStay(3);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {
      dischargeType: 'Synthetic',
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.status).toBe('Discharged');
    expect(closed.body.billing.nights).toBe(3);
    const lines = (
      await pool.query(
        "SELECT bi.*,i.encounter_id,i.patient_id FROM billing_items bi JOIN billing_invoices i ON i.id=bi.invoice_id WHERE bi.source_type='BED_DAY' AND bi.source_id=$1 ORDER BY bi.service_date",
        [stay.admission],
      )
    ).rows;
    expect(lines).toHaveLength(3);
    expect(
      lines.every(
        (l) =>
          l.unit_price === '100.00' &&
          l.total_amount === '100.00' &&
          l.quantity === 1 &&
          l.tariff_id === null &&
          l.facility_service_id === null &&
          l.bed_occupancy_id &&
          l.bed_night_id &&
          l.encounter_id === stay.encounter &&
          l.patient_id === stay.patient,
      ),
    ).toBe(true);
    expect(lines.reduce((sum, l) => sum + Number(l.total_amount), 0)).toBe(300);
    const invoice = (
      await pool.query('SELECT total_amount FROM billing_invoices WHERE id=$1', [
        lines[0].invoice_id,
      ])
    ).rows[0];
    expect(invoice.total_amount).toBe('300.00');
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [stay.bed]))
        .rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    const again = await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {});
    expect(again.status).toBe(200);
    expect(again.body.bedDays ?? again.body.charges).toHaveLength(3);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [stay.admission],
        )
      ).rows[0].n,
    ).toBe(3);
    expect((await call('POST', `/api/admissions/${stay.admission}/discharge`, {})).status).toBe(
      409,
    );
  });

  it('preserves a failed missing-encounter charge, cleans the bed, and bills once after an authorized link', async () => {
    const stay = await makeSyntheticStay(0, false);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    expect(closed.status).toBe(200);
    expect(closed.body.billing.bedDays[0]).toMatchObject({
      charged: false,
      reason: 'BED_OCCUPANCY_REVIEW',
      diagnosis: { code: 'BED_ENCOUNTER_REQUIRED' },
    });
    expect(
      (await pool.query('SELECT status FROM beds WHERE id=$1', [stay.bed])).rows[0].status,
    ).toBe('Cleaning');
    expect(
      (
        await pool.query(
          'SELECT unit_price_snapshot,total_snapshot FROM inpatient_bed_nights WHERE admission_id=$1',
          [stay.admission],
        )
      ).rows[0],
    ).toEqual({ unit_price_snapshot: '100.00', total_snapshot: '100.00' });
    const pending = (
      await pool.query(
        "SELECT id,status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1",
        [stay.admission],
      )
    ).rows[0];
    expect(pending.status).toBe('PENDING');
    const visit = await makeEncounter(stay.patient);
    const wrongPatient = await makePatient(),
      foreignVisit = await makeEncounter(wrongPatient);
    const outpatient = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id",
        [tenant, facility, stay.patient],
      )
    ).rows[0].id;
    const futureVisit = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at) VALUES($1,$2,$3,'INPATIENT','ACTIVE','2999-01-01') RETURNING id",
        [tenant, facility, stay.patient],
      )
    ).rows[0].id;
    expect(
      (
        await call('POST', `/api/admissions/${stay.admission}/bed-billing-encounter`, {
          encounterId: visit,
          reason: 'Synthetic',
          evidenceReference: 'Synthetic encounter register',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/admissions/${stay.admission}/bed-billing-encounter`, {
          encounterId: visit,
          reason: 'Synthetic',
          affirmRelationship: true,
        })
      ).status,
    ).toBe(400);
    for (const id of [foreignVisit, outpatient, futureVisit]) {
      const denied = await call('POST', `/api/admissions/${stay.admission}/bed-billing-encounter`, {
        encounterId: id,
        reason: 'Synthetic review',
        evidenceReference: 'Synthetic encounter register',
        affirmRelationship: true,
      });
      expect([404, 409]).toContain(denied.status);
    }
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${stay.admission}/bed-billing-encounter`,
          {
            encounterId: visit,
            reason: 'Verified synthetic encounter',
            evidenceReference: 'Synthetic encounter register',
            affirmRelationship: true,
          },
          otherToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${stay.admission}/bed-billing-encounter?facilityId=${sameTenantFacility}`,
          {
            encounterId: visit,
            reason: 'Verified synthetic encounter',
            evidenceReference: 'Synthetic encounter register',
            affirmRelationship: true,
          },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await pool.query('SELECT encounter_id FROM admissions WHERE id=$1', [stay.admission]))
        .rows[0].encounter_id,
    ).toBeNull();
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${stay.admission}/bed-billing-retry?facilityId=${sameTenantFacility}`,
          {},
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${stay.admission}/bed-billing-encounter?facilityId=${facility}`,
          {
            encounterId: visit,
            reason: 'Verified synthetic encounter',
            evidenceReference: 'Synthetic encounter register',
            affirmRelationship: true,
          },
          tenantToken,
        )
      ).status,
    ).toBe(200);
    const linkAudit = (
      await pool.query(
        "SELECT details FROM audit_logs WHERE resource='Admission' AND resource_id=$1 AND details LIKE '%linked_missing_bed_billing_encounter%'",
        [String(stay.admission)],
      )
    ).rows[0];
    expect(JSON.parse(linkAudit.details)).toMatchObject({
      encounterId: visit,
      evidenceReference: 'Synthetic encounter register',
      affirmedIdentityAndDates: true,
    });
    const [a, b] = await Promise.all([
      call(
        'POST',
        `/api/admissions/${stay.admission}/bed-billing-retry?facilityId=${facility}`,
        {},
        tenantToken,
      ),
      call('POST', `/api/billing/charge-attempts/${pending.id}/retry`, {}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(['BILLED', 'DUPLICATE']).toContain(b.body.status);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n, SUM(total_amount)::numeric(10,2) AS total FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [stay.admission],
        )
      ).rows[0],
    ).toEqual({ n: 1, total: '100.00' });
    expect(
      (
        await pool.query(
          "SELECT status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1",
          [stay.admission],
        )
      ).rows[0].status,
    ).toBe('BILLED');
  });

  it('interprets UTC-written encounter timestamps independently of host timezone at the Nairobi date boundary', async () => {
    const stay = await makeSyntheticStay(0, false, '100.00', new Date('2025-01-01T22:30:00Z'));
    await pool.query(
      "UPDATE admissions SET status='Discharged',discharge_date='2025-01-01T23:00:00.000Z' WHERE id=$1",
      [stay.admission],
    );
    await pool.query(
      "UPDATE inpatient_bed_occupancies SET ended_at='2025-01-01T23:00:00Z' WHERE admission_id=$1",
      [stay.admission],
    );
    const visit = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at,ended_at) VALUES($1,$2,$3,'INPATIENT','COMPLETED','2025-01-01 22:30:00','2025-01-01 23:00:00') RETURNING id",
        [tenant, facility, stay.patient],
      )
    ).rows[0].id;
    const linked = await call('POST', `/api/admissions/${stay.admission}/bed-billing-encounter`, {
      encounterId: visit,
      reason: 'Synthetic reviewed relationship',
      evidenceReference: 'Synthetic UTC encounter record',
      affirmRelationship: true,
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    const retried = await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {});
    expect(retried.body.charges).toMatchObject([{ charged: true, totalAmount: '100.00' }]);
    expect(
      (
        await pool.query(
          "SELECT service_date::text FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [stay.admission],
        )
      ).rows[0].service_date,
    ).toBe('2025-01-02');
  });

  it('returns literal null for an unconfigured scoped policy and does not apply a later policy to the stay', async () => {
    const absent = await call(
      'GET',
      '/api/inpatient/bed-billing-policy',
      undefined,
      sameTenantToken,
    );
    expect(absent.status).toBe(200);
    expect(absent.body).toBeNull();
    const raw = await fetch(`${base}/api/inpatient/bed-billing-policy`, {
      headers: { authorization: `Bearer ${sameTenantToken}` },
    });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toMatch(/application\/json/);
    expect(await raw.text()).toBe('null');
    expect(
      (await call('GET', `/api/inpatient/bed-billing-policy?facilityId=${sameTenantFacility}`))
        .status,
    ).toBe(403);
    const selected = await call(
      'GET',
      `/api/inpatient/bed-billing-policy?facilityId=${facility}`,
      undefined,
      tenantToken,
    );
    expect(selected.status).toBe(200);
    expect(selected.body).toMatchObject({
      facilityId: facility,
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
    });
    expect(
      (await call('GET', '/api/inpatient/bed-billing-policy', undefined, tenantToken)).status,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          `/api/inpatient/bed-billing-policy?facilityId=${otherFacility}`,
          undefined,
          tenantToken,
        )
      ).status,
    ).toBe(403);
    const separateWard = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code,daily_rate) VALUES($1,'Synthetic policy ward',$2,NULL) RETURNING id",
        [sameTenantFacility, `POL-${suffix}`],
      )
    ).rows[0].id;
    const patient = await makePatient(sameTenantFacility),
      encounter = await makeEncounter(patient, sameTenantFacility),
      bed = await makeBed(separateWard);
    const admitted = await call(
      'POST',
      '/api/admissions',
      { patientId: patient, encounterId: encounter, wardId: separateWard, bedId: bed },
      sameTenantToken,
    );
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const closed = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/discharge`,
      {},
      sameTenantToken,
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.review.code).toBe('BED_POLICY_REVIEW_REQUIRED');
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    const view = await call(
      'GET',
      `/api/admissions/${admitted.body.id}/bed-occupancy`,
      undefined,
      sameTenantToken,
    );
    expect(view.body.staySnapshot).toMatchObject({
      cutoffMinutes: null,
      graceMinutes: null,
      sameDayRule: null,
      policyRevision: null,
      manualAdmissionTime: false,
      manualDischargeTime: false,
    });
    expect(view.body.periods[0].dailyRateSnapshot).toBe('100.00');
    expect(view.body.unresolved.attempts).toMatchObject([
      { reason: 'BED_OCCUPANCY_REVIEW', diagnosisCode: 'BED_POLICY_REVIEW_REQUIRED' },
    ]);
    const pending = await call(
      'GET',
      `/api/inpatient/bed-billing-unresolved?facilityId=${sameTenantFacility}`,
      undefined,
      sameTenantToken,
    );
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body.admissions).toContainEqual({
      admissionId: admitted.body.id,
      admissionStatus: 'Discharged',
      pendingAttempts: 1,
      stagingPending: false,
    });
    expect(
      (await call('GET', '/api/inpatient/bed-billing-unresolved', undefined, limitedToken)).status,
    ).toBe(403);
    expect(
      (await call('GET', `/api/inpatient/bed-billing-unresolved?facilityId=${sameTenantFacility}`))
        .status,
    ).toBe(403);
    expect((await call('GET', '/api/inpatient/bed-billing-unresolved?offset=-1')).status).toBe(400);
    // A client-supplied time is checked first and can mask a missing policy.
    const secondPatient = await makePatient(sameTenantFacility),
      secondEncounter = await makeEncounter(secondPatient, sameTenantFacility),
      secondBed = await makeBed(separateWard);
    const clientTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const secondAdmission = await call(
      'POST',
      '/api/admissions',
      {
        patientId: secondPatient,
        encounterId: secondEncounter,
        wardId: separateWard,
        bedId: secondBed,
        admissionDate: clientTime,
      },
      sameTenantToken,
    );
    expect(secondAdmission.status).toBe(201);
    const secondClosed = await call(
      'POST',
      `/api/admissions/${secondAdmission.body.id}/discharge`,
      { dischargeDate: clientTime },
      sameTenantToken,
    );
    expect(secondClosed.body.billing.review.code).toBe('BED_MANUAL_TIME_REVIEW_REQUIRED');
    const secondView = await call(
      'GET',
      `/api/admissions/${secondAdmission.body.id}/bed-occupancy`,
      undefined,
      sameTenantToken,
    );
    expect(secondView.body.staySnapshot).toMatchObject({
      cutoffMinutes: null,
      graceMinutes: null,
      sameDayRule: null,
      manualAdmissionTime: true,
      manualDischargeTime: true,
    });
    expect(secondView.body.periods[0].dailyRateSnapshot).toBe('100.00');
    const configured = await call(
      'PUT',
      '/api/inpatient/bed-billing-policy',
      {
        facilityId: sameTenantFacility,
        cutoffMinutes: 0,
        graceMinutes: 0,
        sameDayRule: 'ONE',
        isActive: true,
        effectiveFrom: '2020-01-01',
        reason: 'Synthetic policy for future stays',
      },
      tenantToken,
    );
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    const retry = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/bed-billing-retry`,
      {},
      sameTenantToken,
    );
    expect(retry.body.review.code).toBe('BED_POLICY_REVIEW_REQUIRED');
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await call(
          'GET',
          `/api/admissions/${admitted.body.id}/bed-occupancy`,
          undefined,
          limitedToken,
        )
      ).status,
    ).toBe(403);
  });

  it('captures the rate at real assignment and does not reprice when the bed is edited', async () => {
    const patient = await makePatient(),
      visit = await makeEncounter(patient),
      bed = await makeBed();
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId: ward,
      bedId: bed,
      encounterId: visit,
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const occupancy = (
      await pool.query(
        'SELECT daily_rate_snapshot,started_at FROM inpatient_bed_occupancies WHERE admission_id=$1',
        [admitted.body.id],
      )
    ).rows[0];
    expect(occupancy.daily_rate_snapshot).toBe('100.00');
    expect(occupancy.started_at).toBeTruthy();
    const edit = await call('PUT', `/api/beds/${bed}`, {
      dailyCharge: '200.00',
      expectedPriceRevision: 1,
      priceReason: 'Synthetic rate approval',
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const line = (
      await pool.query(
        "SELECT unit_price,total_amount FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
        [admitted.body.id],
      )
    ).rows;
    expect(line).toEqual([{ unit_price: '100.00', total_amount: '100.00' }]);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM audit_logs WHERE resource='BedDailyCharge' AND resource_id=$1",
          [String(bed)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('captures ward and bed transfers as distinct, contiguous periods at their own rates', async () => {
    const patient = await makePatient(),
      visit = await makeEncounter(patient),
      first = await makeBed(),
      second = await makeBed(ward, '150.00'),
      third = await makeBed(secondWard, '250.00');
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId: ward,
      bedId: first,
      encounterId: visit,
    });
    expect(admitted.status).toBe(201);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/transfer?facilityId=${sameTenantFacility}`,
          { toWardId: ward, toBedId: second },
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [first])).rows[0],
    ).toEqual({ status: 'Occupied', current_patient_id: patient });
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/transfer`,
          { facilityId: facility, toWardId: ward, toBedId: second },
          tenantToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', `/api/admissions/${admitted.body.id}/transfer`, {
          toWardId: secondWard,
          toBedId: third,
        })
      ).status,
    ).toBe(200);
    const rows = (
      await pool.query(
        'SELECT bed_id,ward_id,started_at,ended_at,daily_rate_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1 ORDER BY id',
        [admitted.body.id],
      )
    ).rows;
    expect(rows.map((r) => [r.bed_id, r.ward_id, r.daily_rate_snapshot])).toEqual([
      [first, ward, '100.00'],
      [second, ward, '150.00'],
      [third, secondWard, '250.00'],
    ]);
    expect(rows[0].ended_at.getTime()).toBe(rows[1].started_at.getTime());
    expect(rows[1].ended_at.getTime()).toBe(rows[2].started_at.getTime());
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(closed.status).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT unit_price FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows[0].unit_price,
    ).toBe('250.00');
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [third])).rows[0].status).toBe(
      'Cleaning',
    );
  });

  it('finalizes tariff-free bed invoice evidence and prevents mutation of billed lines', async () => {
    const stay = await makeSyntheticStay(1);
    await pool.query(
      "UPDATE facilities SET mfl_code=$1,address='Synthetic road',county='Nyeri',phone='0000000000' WHERE id=$2",
      [`SYN-BED-MFL-${suffix}`, facility],
    );
    const department = (
      await pool.query(
        "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic ward department',$2) RETURNING id",
        [facility, `BED-DEP-${suffix}`],
      )
    ).rows[0].id;
    const practitioner = (
      await pool.query(
        "INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,'Synthetic clinician') RETURNING id",
        [tenant, facility],
      )
    ).rows[0].id;
    await pool.query('UPDATE encounters SET department_id=$1,practitioner_id=$2 WHERE id=$3', [
      department,
      practitioner,
      stay.encounter,
    ]);
    await pool.query(
      "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic diagnosis')",
      [stay.encounter, stay.patient],
    );
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    expect(closed.status).toBe(200);
    const charge = closed.body.billing.bedDays[0];
    expect(charge).toMatchObject({ charged: true, unitPrice: '100.00', totalAmount: '100.00' });
    const context: AuthorizationContext = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: grants,
      isSuperAdmin: false,
    };
    const finalized = await finalizeInvoice(context, charge.invoiceId, {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic self-pay allocation',
    });
    expect(finalized.idempotentReplay).toBe(false);
    const invoice = await getFinalizedInvoice(context, charge.invoiceId);
    expect(invoice.finalized).toBe(true);
    if (!invoice.finalized) throw new Error('Synthetic bed invoice not finalized');
    expect(invoice.snapshot.items).toHaveLength(1);
    expect(invoice.snapshot.items[0]).toMatchObject({
      tariffId: null,
      priceSource: 'BED_OCCUPANCY_SNAPSHOT',
      admissionId: stay.admission,
      unitPrice: '100.00',
      total: '100.00',
      bedOccupancyId: expect.any(Number),
      bedNightId: expect.any(Number),
    });
    await expect(
      pool.query('UPDATE billing_items SET unit_price=200 WHERE id=$1', [charge.itemId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM billing_items WHERE id=$1', [charge.itemId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        'UPDATE inpatient_bed_nights SET unit_price_snapshot=200,total_snapshot=200 WHERE admission_id=$1',
        [stay.admission],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await pool.query('SELECT total_amount FROM billing_invoices WHERE id=$1', [
          charge.invoiceId,
        ])
      ).rows[0].total_amount,
    ).toBe('100.00');
    const payment = await call('POST', '/api/billing/payments', {
      invoiceId: charge.invoiceId,
      facilityId: facility,
      amount: '100.00',
      paymentMethod: 'Cash',
      payerParty: 'PATIENT',
      idempotencyKey: `bed-final-cash-${suffix}`,
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    expect(
      (
        await pool.query(
          'SELECT invoice_id,payment_id,party,actor_user_id FROM billing_payment_attributions WHERE payment_id=$1',
          [payment.body.payment.id],
        )
      ).rows[0],
    ).toEqual({
      invoice_id: charge.invoiceId,
      payment_id: payment.body.payment.id,
      party: 'PATIENT',
      actor_user_id: actor,
    });
    const paid = await getFinalizedInvoice(context, charge.invoiceId);
    expect(paid.finalized && paid.financial).toMatchObject({
      patientBalance: '0.00',
      reconciled: true,
    });
  });

  it('does not infer SHA or private payer codes from an internal bed number or matching description', async () => {
    const stay = await makeSyntheticStay(1);
    await pool.query(
      "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic diagnosis')",
      [stay.encounter, stay.patient],
    );
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    const itemId = closed.body.billing.bedDays[0].itemId,
      invoiceId = closed.body.billing.bedDays[0].invoiceId;
    const description = (
      await pool.query('SELECT description FROM billing_items WHERE id=$1', [itemId])
    ).rows[0].description;
    const trap = (
      await pool.query(
        "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee) VALUES($1,$2,$3,$4,'inpatient','Night','999.00') RETURNING id",
        [tenant, facility, `BED-TRAP-${suffix}`, description],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,payer_name,payer_type,integration_type,adapter_key,environment) VALUES($1,$2,'SYNBED','Synthetic payer','PRIVATE_INSURER','MANUAL','manual','UNCONFIGURED'),($1,$2,'SHA','Synthetic SHA fixture','PUBLIC_SCHEME','MANUAL','manual','UNCONFIGURED')",
      [tenant, facility],
    );
    await pool.query(
      "INSERT INTO payer_service_code_mappings(tenant_id,facility_id,payer_code,tariff_id,local_code,local_description,service_area,payer_service_code,payer_service_name,reimbursement_tariff) VALUES($1,$2,'SYNBED',$3,$4,'Synthetic unrelated tariff','INPATIENT','SYN-BED-PAYER','Synthetic unrelated code','999.00')",
      [tenant, facility, trap, `BED-TRAP-${suffix}`],
    );
    const policy = (
      await pool.query(
        "INSERT INTO insurance_member_policies(tenant_id,facility_id,patient_id,payer_code,member_number) VALUES($1,$2,$3,'SYNBED',$4) RETURNING id",
        [tenant, facility, stay.patient, `SYN-BED-${suffix}`],
      )
    ).rows[0].id;
    const actorInfo = {
      tenantId: tenant,
      facilityId: facility,
      actorUserId: actor,
      actorUserUid: `bed-manager-${suffix}`,
    };
    const privateClaim = await preparePrivateInsuranceClaim({
      ...actorInfo,
      input: { invoiceId, memberPolicyId: policy, encounterId: stay.encounter! },
    });
    expect(privateClaim.lines[0]).toMatchObject({
      tariffId: null,
      mappingId: null,
      mappingStatus: 'UNMAPPED',
      payerServiceCode: null,
      grossAmount: '100.00',
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
      { tenantId: tenant, facilityId: facility, userId: actor, userUid: actorInfo.actorUserUid },
      { invoiceId, encounterId: stay.encounter!, schemeCode: 'SHIF' },
    );
    expect(sha.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNMAPPED_SERVICE_CODE', severity: 'ERROR' }),
      ]),
    );
    expect(
      (
        await pool.query(
          'SELECT tariff_id,payer_service_code,facility_unit_price FROM sha_eclaim_items WHERE eclaim_id=$1',
          [sha.id],
        )
      ).rows[0],
    ).toEqual({ tariff_id: null, payer_service_code: null, facility_unit_price: '100.00' });
  });

  it('does not charge a legacy admission already linked to a non-inpatient encounter', async () => {
    const stay = await makeSyntheticStay(0, false);
    const wrongType = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id",
        [tenant, facility, stay.patient],
      )
    ).rows[0].id;
    await pool.query('UPDATE admissions SET encounter_id=$1 WHERE id=$2', [
      wrongType,
      stay.admission,
    ]);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    expect(closed.status).toBe(200);
    expect(closed.body.billing.bedDays).toMatchObject([
      {
        charged: false,
        reason: 'BED_OCCUPANCY_REVIEW',
        diagnosis: { code: 'BED_ENCOUNTER_CONFLICT' },
      },
    ]);
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [stay.admission],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await pool.query('SELECT status FROM beds WHERE id=$1', [stay.bed])).rows[0].status,
    ).toBe('Cleaning');
  });

  it('requires the selected facility to own the patient or have an active documented relationship', async () => {
    const patient = await makePatient(sameTenantFacility),
      bed = await makeBed();
    const input = { patientId: patient, wardId: ward, bedId: bed, admissionType: 'Transfer' };
    expect((await call('POST', '/api/admissions', input)).status).toBe(404);
    await pool.query(
      "INSERT INTO patient_facilities(patient_id,tenant_id,facility_id,status,relationship_type) VALUES($1,$2,$3,'ACTIVE','REFERRAL')",
      [patient, tenant, facility],
    );
    const transferred = await call('POST', '/api/admissions', input);
    expect(transferred.status, JSON.stringify(transferred.body)).toBe(201);
    expect(transferred.body).toMatchObject({
      patientId: patient,
      facilityId: facility,
      admissionType: 'Transfer',
      bedBillingReadiness: { ready: true },
    });
  });

  it('rejects an unrelated, non-inpatient or future encounter when creating an admission', async () => {
    const patient = await makePatient(),
      other = await makePatient(),
      bed = await makeBed();
    const otherPatientVisit = await makeEncounter(other);
    const wrongType = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id",
        [tenant, facility, patient],
      )
    ).rows[0].id;
    const future = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at) VALUES($1,$2,$3,'INPATIENT','ACTIVE','2999-01-01') RETURNING id",
        [tenant, facility, patient],
      )
    ).rows[0].id;
    expect(
      (
        await call('POST', '/api/admissions', {
          patientId: patient,
          wardId: ward,
          bedId: bed,
          encounterId: otherPatientVisit,
        })
      ).status,
    ).toBe(404);
    for (const encounterId of [wrongType, future])
      expect(
        (
          await call('POST', '/api/admissions', {
            patientId: patient,
            wardId: ward,
            bedId: bed,
            encounterId,
          })
        ).status,
      ).toBe(409);
    expect(
      (await pool.query('SELECT id FROM admissions WHERE patient_id=$1', [patient])).rows,
    ).toHaveLength(0);
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [bed])).rows[0].status).toBe(
      'Available',
    );
  });

  it('keeps care available without clinical-create permission but clearly marks encounter and billing unready', async () => {
    const admissionOnly = await user(tenant, facility, 'admit-only', [
      'inpatient.read',
      'inpatient.admit',
    ]);
    const patient = await makePatient(),
      bed = await makeBed(),
      existing = await makeEncounter(patient);
    expect(
      (
        await call(
          'POST',
          '/api/admissions',
          { patientId: patient, wardId: ward, bedId: bed, encounterId: existing },
          admissionOnly.token,
        )
      ).status,
    ).toBe(403);
    const result = await call(
      'POST',
      '/api/admissions',
      { patientId: patient, wardId: ward, bedId: bed },
      admissionOnly.token,
    );
    expect(result.status).toBe(201);
    expect(result.body.encounterId).toBeNull();
    expect(result.body.bedBillingReadiness).toMatchObject({
      ready: false,
      issues: [{ code: 'BED_ENCOUNTER_REQUIRED' }],
    });
    expect(
      (await pool.query('SELECT count(*)::int n FROM encounters WHERE patient_id=$1', [patient]))
        .rows[0].n,
    ).toBe(1);
  });

  it('does not fabricate an encounter for a manually timed admission even with clinical-create permission', async () => {
    const patient = await makePatient(),
      bed = await makeBed();
    const result = await call('POST', '/api/admissions', {
      patientId: patient,
      wardId: ward,
      bedId: bed,
      admissionDate: '2020-01-01T08:00:00Z',
    });
    expect(result.status).toBe(201);
    expect(result.body.encounterId).toBeNull();
    expect(result.body.bedBillingReadiness).toMatchObject({
      ready: false,
      issues: expect.arrayContaining([
        {
          code: 'BED_ENCOUNTER_REQUIRED',
          message: expect.stringMatching(/historical inpatient encounter/i),
        },
      ]),
    });
    expect(
      (await pool.query('SELECT id FROM encounters WHERE patient_id=$1', [patient])).rows,
    ).toHaveLength(0);
  });

  it('rolls back the newly created encounter, admission and bed assignment when the admission audit fails', async () => {
    const patient = await makePatient(),
      bed = await makeBed();
    const fn = `synthetic_auto_enc_audit_${suffix}`,
      trigger = `synthetic_auto_enc_trigger_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='Admission' AND NEW.action='CREATE' AND NEW.user_id='${actor}' THEN RAISE EXCEPTION 'synthetic admission audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      expect(
        (await call('POST', '/api/admissions', { patientId: patient, wardId: ward, bedId: bed }))
          .status,
      ).toBe(500);
      expect(
        (await pool.query('SELECT id FROM encounters WHERE patient_id=$1', [patient])).rows,
      ).toHaveLength(0);
      expect(
        (await pool.query('SELECT id FROM admissions WHERE patient_id=$1', [patient])).rows,
      ).toHaveLength(0);
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
      ).toEqual({ status: 'Available', current_patient_id: null });
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
  });

  it('recognizes unconfirmed, inactive, future and expired policies and never applies a later policy to a prior stay', async () => {
    const localFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic effective policy','Africa/Nairobi',$3::jsonb) RETURNING id",
        [tenant, `DATE-${suffix}`, JSON.stringify(['inpatient', 'finance'])],
      )
    ).rows[0].id;
    const w = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code,daily_rate) VALUES($1,'Synthetic date ward',$2,NULL) RETURNING id",
        [localFacility, `D-W-${suffix}`],
      )
    ).rows[0].id;
    expect(
      (
        await call(
          'GET',
          `/api/inpatient/bed-billing-policy?facilityId=${localFacility}`,
          undefined,
          tenantToken,
        )
      ).body,
    ).toBeNull();
    // A row written by the pre-0065 application has unknown applicability.
    await pool.query(
      "INSERT INTO inpatient_bed_billing_policies(tenant_id,facility_id,cutoff_minutes,grace_minutes,same_day_rule,updated_by_user_id) VALUES($1,$2,0,0,'ONE',$3)",
      [tenant, localFacility, actor],
    );
    const legacy = await call(
      'GET',
      `/api/inpatient/bed-billing-policy?facilityId=${localFacility}`,
      undefined,
      tenantToken,
    );
    expect(legacy.body).toMatchObject({
      isActive: null,
      effectiveFrom: null,
      applicability: { code: 'NOT_ACTIVE' },
    });
    const body = {
      facilityId: localFacility,
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      effectiveFrom: '2999-01-01',
      isActive: true,
      expectedRevision: legacy.body.revision,
      reason: 'Synthetic future policy',
    };
    expect(
      (
        await call(
          'PUT',
          '/api/inpatient/bed-billing-policy',
          { ...body, effectiveFrom: '2031-02-30' },
          tenantToken,
        )
      ).status,
    ).toBe(400);
    const future = await call('PUT', '/api/inpatient/bed-billing-policy', body, tenantToken);
    expect(future.body.applicability.code).toBe('NOT_YET_EFFECTIVE');
    const patient = await makePatient(localFacility),
      bed = await makeBed(w);
    const admitted = await call(
      'POST',
      `/api/admissions?facilityId=${localFacility}`,
      { patientId: patient, wardId: w, bedId: bed },
      tenantToken,
    );
    expect(admitted.status).toBe(201);
    expect(admitted.body.bedBillingReadiness).toMatchObject({
      ready: false,
      issues: [{ code: 'NOT_YET_EFFECTIVE' }],
    });
    const snap = (
      await pool.query(
        'SELECT policy_id,policy_revision,policy_applicability,same_day_rule FROM inpatient_bed_stay_snapshots WHERE admission_id=$1',
        [admitted.body.id],
      )
    ).rows[0];
    expect(snap).toEqual({
      policy_id: future.body.id,
      policy_revision: future.body.revision,
      policy_applicability: 'NOT_YET_EFFECTIVE',
      same_day_rule: null,
    });
    const active = await call(
      'PUT',
      '/api/inpatient/bed-billing-policy',
      {
        ...body,
        effectiveFrom: '2020-01-01',
        expectedRevision: future.body.revision,
        reason: 'Synthetic policy active for future admissions',
      },
      tenantToken,
    );
    expect(active.body.applicability.code).toBe('APPLICABLE');
    const closed = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/discharge?facilityId=${localFacility}`,
      {},
      tenantToken,
    );
    expect(closed.status).toBe(200);
    expect(closed.body.billing.review.code).toBe('BED_POLICY_REVIEW_REQUIRED');
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows,
    ).toHaveLength(0);
    const inactive = await call(
      'PUT',
      '/api/inpatient/bed-billing-policy',
      {
        ...body,
        isActive: false,
        effectiveFrom: '2020-01-01',
        expectedRevision: active.body.revision,
      },
      tenantToken,
    );
    expect(inactive.body.applicability.code).toBe('NOT_ACTIVE');
    const expired = await call(
      'PUT',
      '/api/inpatient/bed-billing-policy',
      {
        ...body,
        effectiveFrom: '2020-01-01',
        effectiveUntil: '2020-12-31',
        expectedRevision: inactive.body.revision,
      },
      tenantToken,
    );
    expect(expired.body.applicability.code).toBe('EXPIRED');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='InpatientBedBillingPolicy' AND resource_id=$1",
          [String(future.body.id)],
        )
      ).rows[0].n,
    ).toBe(4);
  });

  it('restricts policy and bed-price changes, audits revisions, and leaves unchanged bed edits alone', async () => {
    const current = await call('GET', '/api/inpatient/bed-billing-policy');
    expect(current.status).toBe(200);
    const proposed = {
      cutoffMinutes: 0,
      graceMinutes: 15,
      sameDayRule: 'ONE',
      isActive: true,
      effectiveFrom: '2020-01-01',
      expectedRevision: current.body.revision,
      reason: 'Synthetic policy change',
    };
    expect(
      (await call('PUT', '/api/inpatient/bed-billing-policy', proposed, limitedToken)).status,
    ).toBe(403);
    expect(
      (await call('PUT', '/api/inpatient/bed-billing-policy', proposed, platformToken)).status,
    ).toBe(403);
    expect(
      (
        await call('PUT', '/api/inpatient/bed-billing-policy', {
          ...proposed,
          expectedRevision: current.body.revision + 9,
        })
      ).status,
    ).toBe(409);
    const changed = await call('PUT', '/api/inpatient/bed-billing-policy', proposed);
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.revision).toBe(current.body.revision + 1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='InpatientBedBillingPolicy' AND resource_id=$1",
          [String(current.body.id)],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (
        await call('PUT', '/api/inpatient/bed-billing-policy', {
          ...proposed,
          graceMinutes: 0,
          expectedRevision: changed.body.revision,
          reason: 'Restore synthetic fixture',
        })
      ).status,
    ).toBe(200);

    const bed = await makeBed();
    const body = {
      dailyCharge: '125.00',
      expectedPriceRevision: 1,
      priceReason: 'Synthetic documented price change',
    };
    expect((await call('PUT', `/api/beds/${bed}`, body, limitedToken)).status).toBe(403);
    expect((await call('PUT', `/api/beds/${bed}`, body, platformToken)).status).toBe(403);
    const ordinary = await call('PUT', `/api/beds/${bed}`, { bedType: 'Private' }, limitedToken);
    expect(ordinary.status, JSON.stringify(ordinary.body)).toBe(200);
    expect(ordinary.body.dailyCharge).toBe('100.00');
    const revised = await call('PUT', `/api/beds/${bed}`, body);
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    expect(revised.body).toMatchObject({ dailyCharge: '125.00', priceRevision: 2 });
    expect((await call('PUT', `/api/beds/${bed}`, { ...body, dailyCharge: '140.00' })).status).toBe(
      409,
    );
    const audit = (
      await pool.query(
        "SELECT details FROM audit_logs WHERE resource='BedDailyCharge' AND resource_id=$1",
        [String(bed)],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details)).toMatchObject({
      before: '100.00',
      after: '125.00',
      revision: 2,
      reason: body.priceReason,
    });
  });

  it('freezes the policy at admission even when facility settings change before discharge', async () => {
    const patient = await makePatient(),
      visit = await makeEncounter(patient),
      bed = await makeBed();
    const current = await call('GET', '/api/inpatient/bed-billing-policy');
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: visit,
      wardId: ward,
      bedId: bed,
    });
    expect(admitted.status).toBe(201);
    const change = await call('PUT', '/api/inpatient/bed-billing-policy', {
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ZERO',
      isActive: true,
      effectiveFrom: '2020-01-01',
      expectedRevision: current.body.revision,
      reason: 'Synthetic new policy',
    });
    expect(change.status).toBe(200);
    try {
      const captured = (
        await pool.query(
          'SELECT same_day_rule,policy_revision FROM inpatient_bed_stay_snapshots WHERE admission_id=$1',
          [admitted.body.id],
        )
      ).rows[0];
      expect(captured).toEqual({ same_day_rule: 'ONE', policy_revision: current.body.revision });
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status).toBe(200);
      expect(closed.body.billing.bedDays).toHaveLength(1);
      expect(closed.body.billing.bedDays[0]).toMatchObject({
        charged: true,
        totalAmount: '100.00',
      });
    } finally {
      expect(
        (
          await call('PUT', '/api/inpatient/bed-billing-policy', {
            cutoffMinutes: 0,
            graceMinutes: 0,
            sameDayRule: 'ONE',
            isActive: true,
            effectiveFrom: '2020-01-01',
            expectedRevision: change.body.revision,
            reason: 'Restore synthetic policy',
          })
        ).status,
      ).toBe(200);
    }
  });

  it('never bills missing, zero or unconfirmed legacy-default bed prices', async () => {
    for (const price of [null, '0.00', '1500.00']) {
      const patient = await makePatient(),
        visit = await makeEncounter(patient),
        bed = await makeBed(ward, price);
      if (price === '1500.00')
        await pool.query(
          'UPDATE beds SET daily_charge_review_required=true,price_revision=price_revision+1 WHERE id=$1',
          [bed],
        );
      const admitted = await call('POST', '/api/admissions', {
        patientId: patient,
        encounterId: visit,
        wardId: ward,
        bedId: bed,
      });
      expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
      expect(admitted.body.bedBillingReadiness).toMatchObject({
        ready: false,
        issues: [{ code: 'BED_RATE_REVIEW_REQUIRED' }],
      });
      expect(
        (
          await pool.query(
            'SELECT daily_rate_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1',
            [admitted.body.id],
          )
        ).rows[0].daily_rate_snapshot,
      ).toBeNull();
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect(closed.body.billing.review.code).toBe('BED_RATE_REVIEW_REQUIRED');
      expect(
        (await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`)).body.review.code,
      ).toBe('BED_RATE_REVIEW_REQUIRED');
      expect((await pool.query('SELECT status FROM beds WHERE id=$1', [bed])).rows[0].status).toBe(
        'Cleaning',
      );
      expect(
        (
          await pool.query(
            "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
            [admitted.body.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool.query(
            "SELECT status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1",
            [admitted.body.id],
          )
        ).rows[0].status,
      ).toBe('PENDING');
    }
  });

  it('keeps discharge and Cleaning when bed billing staging fails, then safely recovers', async () => {
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed();
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: encounter,
      wardId: ward,
      bedId: bed,
    });
    expect(admitted.status).toBe(201);
    const fn = `synthetic_bed_staging_fail_${suffix}`,
      trigger = `synthetic_bed_staging_trigger_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_type = 'BED_DAY' AND NEW.source_id = ${Number(admitted.body.id)} THEN RAISE EXCEPTION 'Synthetic staging failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON billing_charge_attempts FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect(closed.body.status).toBe('Discharged');
      expect(closed.body.billing.review.code).toBe('BED_BILLING_STATUS_UNKNOWN');
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
      ).toEqual({ status: 'Cleaning', current_patient_id: null });
      expect(
        (
          await pool.query(
            'SELECT staged_at FROM inpatient_bed_billing_work WHERE admission_id=$1',
            [admitted.body.id],
          )
        ).rows[0].staged_at,
      ).toBeNull();
      expect(
        (
          await pool.query(
            "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
            [admitted.body.id],
          )
        ).rows,
      ).toHaveLength(0);
      const listing = await call('GET', '/api/inpatient/bed-billing-unresolved');
      expect(listing.body.admissions).toContainEqual({
        admissionId: admitted.body.id,
        admissionStatus: 'Discharged',
        pendingAttempts: 0,
        stagingPending: true,
      });
      const view = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
      expect(view.body.unresolved).toMatchObject({ stagingPending: true, attempts: [] });
      expect(view.body.periods[0].dailyRateSnapshot).toBe('100.00');
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON billing_charge_attempts`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    const recovered = await Promise.all([
      call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {}),
      call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {}),
    ]);
    expect(recovered.map((response) => response.status)).toEqual([200, 200]);
    const outcomes = recovered.map((response) => response.body.charges[0]);
    expect(
      outcomes.filter((charge) => charge.charged && charge.unitPrice === '100.00'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((charge) => !charge.charged && charge.reason === 'DUPLICATE'),
    ).toHaveLength(1);
    expect(
      (
        await pool.query('SELECT staged_at FROM inpatient_bed_billing_work WHERE admission_id=$1', [
          admitted.body.id,
        ])
      ).rows[0].staged_at,
    ).toBeInstanceOf(Date);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n FROM audit_logs WHERE resource='InpatientBedBillingWork' AND resource_id=$1",
          [String(admitted.body.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      pool.query('UPDATE inpatient_bed_billing_work SET staged_at=NULL WHERE admission_id=$1', [
        admitted.body.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM inpatient_bed_billing_work WHERE admission_id=$1', [
        admitted.body.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const listing = await call('GET', '/api/inpatient/bed-billing-unresolved');
    expect(
      listing.body.admissions.some(
        (row: { admissionId: number }) => row.admissionId === admitted.body.id,
      ),
    ).toBe(false);
    const replay = await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {});
    expect(replay.body.charges).toMatchObject([{ charged: false, reason: 'DUPLICATE' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('retains pending work and rolls back staged evidence if its staging audit fails', async () => {
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed();
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: encounter,
      wardId: ward,
      bedId: bed,
    });
    expect(admitted.status).toBe(201);
    const fn = `synthetic_bed_stage_audit_fail_${suffix}`,
      trigger = `synthetic_bed_stage_audit_trigger_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource = 'InpatientBedBillingWork' AND NEW.resource_id = '${Number(admitted.body.id)}' THEN RAISE EXCEPTION 'Synthetic staging audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status).toBe(200);
      expect(closed.body.billing.review.code).toBe('BED_BILLING_STATUS_UNKNOWN');
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
      ).toEqual({ status: 'Cleaning', current_patient_id: null });
      expect(
        (
          await pool.query(
            'SELECT staged_at FROM inpatient_bed_billing_work WHERE admission_id=$1',
            [admitted.body.id],
          )
        ).rows[0].staged_at,
      ).toBeNull();
      expect(
        (
          await pool.query('SELECT id FROM inpatient_bed_nights WHERE admission_id=$1', [
            admitted.body.id,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool.query(
            "SELECT id FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1",
            [admitted.body.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {})).status,
      ).toBe(500);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    const retry = await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {});
    expect(retry.body.charges).toMatchObject([{ charged: true, unitPrice: '100.00' }]);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n FROM audit_logs WHERE resource='InpatientBedBillingWork' AND resource_id=$1",
          [String(admitted.body.id)],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('does not commit a clinical discharge if its durable work marker itself cannot be saved', async () => {
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed();
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: encounter,
      wardId: ward,
      bedId: bed,
    });
    expect(admitted.status).toBe(201);
    const fn = `synthetic_bed_work_fail_${suffix}`,
      trigger = `synthetic_bed_work_trigger_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.admission_id = ${Number(admitted.body.id)} THEN RAISE EXCEPTION 'Synthetic durable marker failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON inpatient_bed_billing_work FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status).toBe(500);
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
      ).toEqual({ status: 'Occupied', current_patient_id: patient });
      expect(
        (await pool.query('SELECT status FROM admissions WHERE id=$1', [admitted.body.id])).rows[0]
          .status,
      ).toBe('Admitted');
      expect(
        (
          await pool.query(
            'SELECT staged_at FROM inpatient_bed_billing_work WHERE admission_id=$1',
            [admitted.body.id],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON inpatient_bed_billing_work`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.bedDays).toMatchObject([{ charged: true, unitPrice: '100.00' }]);
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
  });

  it('keeps a committed discharge, price evidence and retryable queue when invoice insertion fails', async () => {
    const stay = await makeSyntheticStay(1);
    const identifier = `synthetic_bed_failure_${suffix.replace(/[^a-z0-9]/gi, '')}`;
    await pool.query(
      `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_type='BED_DAY' AND NEW.source_id=${stay.admission} THEN RAISE EXCEPTION 'Synthetic invoice failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${identifier} BEFORE INSERT ON billing_items FOR EACH ROW EXECUTE FUNCTION ${identifier}()`,
    );
    try {
      const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect(closed.body.status).toBe('Discharged');
      expect(closed.body.billing.bedDays[0]).toMatchObject({
        charged: false,
        reason: 'INVALID_INPUT',
      });
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [stay.bed]))
          .rows[0],
      ).toEqual({ status: 'Cleaning', current_patient_id: null });
      expect(
        (
          await pool.query(
            'SELECT unit_price_snapshot,total_snapshot FROM inpatient_bed_nights WHERE admission_id=$1',
            [stay.admission],
          )
        ).rows[0],
      ).toEqual({ unit_price_snapshot: '100.00', total_snapshot: '100.00' });
      expect(
        (
          await pool.query(
            "SELECT status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1",
            [stay.admission],
          )
        ).rows[0].status,
      ).toBe('PENDING');
      expect(
        (
          await pool.query(
            "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
            [stay.admission],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER ${identifier} ON billing_items`);
      await pool.query(`DROP FUNCTION ${identifier}()`);
    }
    const retry = await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.charges[0]).toMatchObject({ charged: true, totalAmount: '100.00' });
  });

  it('retains a client-supplied admission-time rejection through retries until evidence is reviewed', async () => {
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed();
    const policyRevision = (await call('GET', '/api/inpatient/bed-billing-policy')).body.revision;
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const start = new Date(`${localDay}T09:00:00.000Z`); // noon in the synthetic facility
    start.setUTCDate(start.getUTCDate() - 2);
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: encounter,
      wardId: ward,
      bedId: bed,
      admissionDate: start.toISOString(),
    });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.review.code).toBe('BED_MANUAL_TIME_REVIEW_REQUIRED');
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    const prior = (
      await pool.query(
        "SELECT id,reason,diagnosis_code,detail,status,attempts,updated_at FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1 AND idempotency_suffix='REVIEW'",
        [admitted.body.id],
      )
    ).rows[0];
    expect(prior).toMatchObject({
      status: 'PENDING',
      reason: 'BED_OCCUPANCY_REVIEW',
      diagnosis_code: 'BED_MANUAL_TIME_REVIEW_REQUIRED',
    });
    const legacy = (
      await pool.query(
        `INSERT INTO billing_charge_attempts(tenant_id,facility_id,patient_id,source_type,source_id,item_type,reason,detail,status)
      VALUES($1,$2,$3,'BED_DAY',$4,'Inpatient','TARIFF_NOT_CONFIGURED','Synthetic legacy rejection','PENDING') RETURNING id,reason,diagnosis_code,detail,status,attempts,updated_at`,
        [tenant, facility, patient, admitted.body.id],
      )
    ).rows[0];
    const legacyDated = (
      await pool.query(
        `INSERT INTO billing_charge_attempts(tenant_id,facility_id,patient_id,source_type,source_id,item_type,idempotency_suffix,reason,detail,status)
      VALUES($1,$2,$3,'BED_DAY',$4,'Inpatient','2020-02-02','TARIFF_NOT_CONFIGURED','Synthetic dated legacy rejection','PENDING') RETURNING id,reason,diagnosis_code,detail,status,attempts,updated_at`,
        [tenant, facility, patient, admitted.body.id],
      )
    ).rows[0];
    for (const original of [prior, legacy, legacyDated]) {
      for (let i = 0; i < 2; i++) {
        const retry = await call('POST', `/api/billing/charge-attempts/${original.id}/retry`, {});
        expect(retry.status, JSON.stringify(retry.body)).toBe(200);
        expect(retry.body).toMatchObject({
          status: 'PENDING',
          result: { charged: false, reason: 'BED_OCCUPANCY_REVIEW' },
        });
        expect(retry.body.result.message).toContain(original.detail);
      }
      expect(
        (
          await pool.query(
            'SELECT id,reason,diagnosis_code,detail,status,attempts,updated_at FROM billing_charge_attempts WHERE id=$1',
            [original.id],
          )
        ).rows[0],
      ).toEqual(original);
    }
    const view = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
    expect(view.body.staySnapshot).toMatchObject({
      manualAdmissionTime: true,
      manualDischargeTime: false,
      cutoffMinutes: 0,
      policyRevision,
    });
    expect(view.body.periods[0].dailyRateSnapshot).toBe('100.00');
    expect(view.body.unresolved.attempts).toHaveLength(3);
    expect(
      (
        await call(
          'GET',
          `/api/admissions/${admitted.body.id}/bed-occupancy`,
          undefined,
          limitedToken,
        )
      ).body.unresolved,
    ).toBeNull();
    const listing = await call('GET', '/api/inpatient/bed-billing-unresolved');
    expect(listing.status, JSON.stringify(listing.body)).toBe(200);
    expect(listing.body.admissions).toContainEqual({
      admissionId: admitted.body.id,
      admissionStatus: 'Discharged',
      pendingAttempts: 3,
      stagingPending: false,
    });
    expect(
      (
        await call('GET', '/api/inpatient/bed-billing-unresolved', undefined, sameTenantToken)
      ).body.admissions.some(
        (row: { admissionId: number }) => row.admissionId === admitted.body.id,
      ),
    ).toBe(false);
    const review = {
      timezone: 'Africa/Nairobi',
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      reason: 'Synthetic verified admission time',
      evidenceReference: 'Synthetic register 100',
      affirmReviewedHistoryAndCharges: true,
      periods: [
        {
          wardId: ward,
          bedId: bed,
          startedAt: start.toISOString(),
          endedAt: closed.body.dischargeDate,
          dailyRate: '100.00',
        },
      ],
    };
    expect(
      (
        await call('POST', `/api/admissions/${admitted.body.id}/bed-history-review`, {
          ...review,
          evidenceReference: '',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/admissions/${admitted.body.id}/bed-history-review`, {
          ...review,
          affirmReviewedHistoryAndCharges: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/bed-history-review`,
          review,
          limitedToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/admissions/${admitted.body.id}/bed-history-review?facilityId=${sameTenantFacility}`,
          review,
          tenantToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await pool.query('SELECT id FROM inpatient_bed_billing_reviews WHERE admission_id=$1', [
          admitted.body.id,
        ])
      ).rows,
    ).toHaveLength(0);
    const auditFn = `synthetic_bed_review_audit_fail_${suffix}`,
      auditTrigger = `synthetic_bed_review_audit_trigger_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${auditFn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id = ${Number(facility)} AND NEW.resource = 'InpatientBedBillingReview' THEN RAISE EXCEPTION 'Synthetic review audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${auditTrigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${auditFn}()`,
    );
    try {
      expect(
        (await call('POST', `/api/admissions/${admitted.body.id}/bed-history-review`, review))
          .status,
      ).toBe(500);
      expect(
        (
          await pool.query('SELECT id FROM inpatient_bed_billing_reviews WHERE admission_id=$1', [
            admitted.body.id,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool.query('SELECT id FROM inpatient_bed_nights WHERE admission_id=$1', [
            admitted.body.id,
          ])
        ).rows,
      ).toHaveLength(0);
      for (const original of [prior, legacy, legacyDated])
        expect(
          (
            await pool.query(
              'SELECT reason,diagnosis_code,detail,status FROM billing_charge_attempts WHERE id=$1',
              [original.id],
            )
          ).rows[0],
        ).toEqual({
          reason: original.reason,
          diagnosis_code: original.diagnosis_code,
          detail: original.detail,
          status: 'PENDING',
        });
    } finally {
      await pool.query(`DROP TRIGGER ${auditTrigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${auditFn}()`);
    }
    const accepted = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/bed-history-review?facilityId=${facility}`,
      review,
      tenantToken,
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.nights).toBe(2);
    for (const original of [prior, legacy, legacyDated]) {
      const retained = (
        await pool.query(
          'SELECT reason,diagnosis_code,detail,status FROM billing_charge_attempts WHERE id=$1',
          [original.id],
        )
      ).rows[0];
      expect(retained).toEqual({
        reason: original.reason,
        diagnosis_code: original.diagnosis_code,
        detail: original.detail,
        status: 'SUPERSEDED',
      });
      expect(
        (await call('POST', `/api/billing/charge-attempts/${original.id}/retry`, {})).body.status,
      ).toBe('SUPERSEDED');
    }
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n FROM audit_logs WHERE resource='InpatientBedBillingReview' AND resource_id=$1",
          [String(accepted.body.reviewId)],
        )
      ).rows[0].n,
    ).toBe(1);
    const retry = await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {});
    expect(retry.body.charges).toHaveLength(2);
    expect(
      retry.body.charges.every(
        (charge: { charged: boolean; unitPrice: string }) =>
          charge.charged && charge.unitPrice === '100.00',
      ),
    ).toBe(true);
    const repeated = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/bed-billing-retry`,
      {},
    );
    expect(
      repeated.body.charges.every((charge: { reason: string }) => charge.reason === 'DUPLICATE'),
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n,SUM(total_amount)::numeric(10,2) total FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows[0],
    ).toEqual({ n: 2, total: '200.00' });
    const after = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
    expect(after.body.staySnapshot.manualAdmissionTime).toBe(true); // original provenance is never rewritten
    expect(after.body.unresolved.attempts).toHaveLength(0);
  });

  it('does not assume an old browser-generated timestamp was unedited', async () => {
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed();
    const oldClientTime = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: encounter,
      wardId: ward,
      bedId: bed,
      admissionDate: oldClientTime(),
    });
    expect(admitted.status).toBe(201);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {
      dischargeDate: oldClientTime(),
    });
    expect(closed.status).toBe(200);
    expect(closed.body.billing.review).toMatchObject({ code: 'BED_MANUAL_TIME_REVIEW_REQUIRED' });
    expect(closed.body.billing.review.message).toMatch(
      /older client may have supplied it automatically/i,
    );
    const view = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
    expect(view.body.staySnapshot).toMatchObject({
      manualAdmissionTime: true,
      manualDischargeTime: true,
    });
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admitted.body.id],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('requires documented review of a corrected discharge time before billing', async () => {
    const patient = await makePatient(),
      encounter = await makeEncounter(patient),
      bed = await makeBed();
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: encounter,
      wardId: ward,
      bedId: bed,
    });
    expect(admitted.status).toBe(201);
    const corrected = new Date().toISOString();
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {
      dischargeDate: corrected,
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.review.code).toBe('BED_MANUAL_TIME_REVIEW_REQUIRED');
    const view = await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`);
    expect(view.body.staySnapshot).toMatchObject({
      manualAdmissionTime: false,
      manualDischargeTime: true,
    });
    const review = {
      timezone: 'Africa/Nairobi',
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      reason: 'Synthetic verified discharge time',
      evidenceReference: 'Synthetic discharge record',
      affirmReviewedHistoryAndCharges: true,
      periods: [
        {
          wardId: ward,
          bedId: bed,
          startedAt: admitted.body.admissionDate,
          endedAt: corrected,
          dailyRate: '100.00',
        },
      ],
    };
    expect(
      (
        await call('POST', `/api/admissions/${admitted.body.id}/bed-history-review`, {
          ...review,
          evidenceReference: null,
        })
      ).status,
    ).toBe(400);
    const accepted = await call(
      'POST',
      `/api/admissions/${admitted.body.id}/bed-history-review`,
      review,
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const retry = await call('POST', `/api/admissions/${admitted.body.id}/bed-billing-retry`, {});
    expect(retry.body.charges).toMatchObject([
      { charged: true, unitPrice: '100.00', totalAmount: '100.00' },
    ]);
    expect(
      (
        await pool.query(
          'SELECT manual_discharge_time FROM inpatient_bed_stay_snapshots WHERE admission_id=$1',
          [admitted.body.id],
        )
      ).rows[0].manual_discharge_time,
    ).toBe(true);
  });

  it('links an encounter after a signed history review when legacy clinical dates were ambiguous', async () => {
    const patient = await makePatient(),
      bed = await makeBed(),
      visit = await makeEncounter(patient);
    const start = new Date(Date.now() - 60_000).toISOString();
    const admission = (
      await pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,'legacy ambiguous time','Admitted') RETURNING id",
        [tenant, facility, patient, ward, bed],
      )
    ).rows[0].id;
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [
      patient,
      bed,
    ]);
    const closed = await call('POST', `/api/admissions/${admission}/discharge`, {});
    expect(closed.status).toBe(200);
    const link = {
      encounterId: visit,
      reason: 'Synthetic verified clinical record',
      evidenceReference: 'Synthetic encounter register',
      affirmRelationship: true,
    };
    expect(
      (await call('POST', `/api/admissions/${admission}/bed-billing-encounter`, link)).status,
    ).toBe(409);
    const review = await call('POST', `/api/admissions/${admission}/bed-history-review`, {
      timezone: 'Africa/Nairobi',
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      reason: 'Synthetic signed review',
      evidenceReference: 'Synthetic ward register',
      affirmReviewedHistoryAndCharges: true,
      periods: [
        {
          wardId: ward,
          bedId: bed,
          startedAt: start,
          endedAt: closed.body.dischargeDate,
          dailyRate: '100.00',
        },
      ],
    });
    expect(review.status, JSON.stringify(review.body)).toBe(201);
    expect(
      (await call('POST', `/api/admissions/${admission}/bed-billing-encounter`, link)).status,
    ).toBe(200);
    const retried = await call('POST', `/api/admissions/${admission}/bed-billing-retry`, {});
    expect(retried.body.charges).toMatchObject([{ charged: true, totalAmount: '100.00' }]);
  });

  it('requires an explicit audited history review for legacy stays and retains the old pending attempt', async () => {
    const patient = await makePatient(),
      visit = await makeEncounter(patient),
      bed = await makeBed();
    const start = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    // Legacy clinical time has no reliable offset and has no price snapshot.
    const admission = (
      await pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,'legacy time needs review','Admitted') RETURNING id",
        [tenant, facility, patient, visit, ward, bed],
      )
    ).rows[0].id as number;
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [
      patient,
      bed,
    ]);
    const closed = await call('POST', `/api/admissions/${admission}/discharge`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.review.code).toBe('BED_HISTORY_REVIEW_REQUIRED');
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [bed])).rows[0].status).toBe(
      'Cleaning',
    );
    const prior = (
      await pool.query(
        "SELECT id,detail,status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1",
        [admission],
      )
    ).rows[0];
    expect(prior.status).toBe('PENDING');
    const payload = {
      timezone: 'Africa/Nairobi',
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      reason: 'Verified synthetic history',
      evidenceReference: 'Synthetic ward register 1',
      affirmReviewedHistoryAndCharges: true,
      periods: [
        {
          wardId: ward,
          bedId: bed,
          startedAt: start.toISOString(),
          endedAt: closed.body.dischargeDate,
          dailyRate: '100.00',
        },
      ],
    };
    expect(
      (await call('POST', `/api/admissions/${admission}/bed-history-review`, payload, otherToken))
        .status,
    ).toBe(403);
    const review = await call('POST', `/api/admissions/${admission}/bed-history-review`, payload);
    expect(review.status, JSON.stringify(review.body)).toBe(201);
    expect(review.body.nights).toBe(3);
    const retained = (
      await pool.query('SELECT detail,status FROM billing_charge_attempts WHERE id=$1', [prior.id])
    ).rows[0];
    expect(retained).toEqual({ detail: prior.detail, status: 'SUPERSEDED' });
    const oldRetry = await call('POST', `/api/billing/charge-attempts/${prior.id}/retry`, {});
    expect(oldRetry.status).toBe(200);
    expect(oldRetry.body.status).toBe('SUPERSEDED');
    expect(
      (
        await pool.query(
          'SELECT evidence_reference,reason FROM inpatient_bed_billing_reviews WHERE admission_id=$1',
          [admission],
        )
      ).rows[0],
    ).toEqual({
      evidence_reference: 'Synthetic ward register 1',
      reason: 'Verified synthetic history',
    });
    const retry = await call('POST', `/api/admissions/${admission}/bed-billing-retry`, {});
    expect(retry.status).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int n,SUM(total_amount)::numeric(10,2) total FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1",
          [admission],
        )
      ).rows[0],
    ).toEqual({ n: 3, total: '300.00' });
    expect(
      (await call('POST', `/api/admissions/${admission}/bed-history-review`, payload)).status,
    ).toBe(409);
  });

  it('serializes concurrent discharge and transfer without overlapping occupancy or duplicate bills', async () => {
    const patient = await makePatient(),
      visit = await makeEncounter(patient),
      firstBed = await makeBed(),
      nextBed = await makeBed(secondWard, '150.00');
    const admitted = await call('POST', '/api/admissions', {
      patientId: patient,
      encounterId: visit,
      wardId: ward,
      bedId: firstBed,
    });
    expect(admitted.status).toBe(201);
    const [discharged, transferred] = await Promise.all([
      call('POST', `/api/admissions/${admitted.body.id}/discharge`, {}),
      call('POST', `/api/admissions/${admitted.body.id}/transfer`, {
        toWardId: secondWard,
        toBedId: nextBed,
        reason: 'Synthetic concurrent transfer',
      }),
    ]);
    expect(discharged.status, JSON.stringify(discharged.body)).toBe(200);
    expect([200, 409]).toContain(transferred.status);
    const periods = (
      await pool.query(
        'SELECT bed_id,started_at,ended_at,daily_rate_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1 ORDER BY started_at,id',
        [admitted.body.id],
      )
    ).rows;
    expect(periods.length).toBe(transferred.status === 200 ? 2 : 1);
    expect(periods.every((p) => p.ended_at !== null)).toBe(true);
    if (periods.length === 2)
      expect(periods[0].ended_at.getTime()).toBe(periods[1].started_at.getTime());
    const finalBed = periods[periods.length - 1].bed_id;
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [finalBed]))
        .rows[0],
    ).toEqual({ status: 'Cleaning', current_patient_id: null });
    const lines = (
      await pool.query(
        "SELECT service_date,count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1 GROUP BY service_date",
        [admitted.body.id],
      )
    ).rows;
    expect(lines.every((line) => line.n === 1)).toBe(true);
    expect((await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {})).status).toBe(
      409,
    );
  });

  it('checks the recorded transfer chain before reviewing historical rates and bills the bed at each cutoff', async () => {
    const patient = await makePatient(),
      visit = await makeEncounter(patient);
    const historyWard = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic former ward',$2) RETURNING id",
        [facility, `HIST-${suffix}-${++serial}`],
      )
    ).rows[0].id as number;
    const firstBed = await makeBed(historyWard),
      lastBed = await makeBed(secondWard, '250.00');
    const start = new Date(Date.now() - 48 * 60 * 60 * 1000),
      transfer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const admission = (
      await pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,'legacy date requires documentation','Admitted') RETURNING id",
        [tenant, facility, patient, visit, secondWard, lastBed],
      )
    ).rows[0].id as number;
    await pool.query(
      "INSERT INTO admission_transfers(tenant_id,facility_id,admission_id,patient_id,from_ward_id,from_bed_id,to_ward_id,to_bed_id,transferred_by,transferred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic',$9::timestamptz AT TIME ZONE 'UTC')",
      [tenant, facility, admission, patient, historyWard, firstBed, secondWard, lastBed, transfer],
    );
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [
      patient,
      lastBed,
    ]);
    const closed = await call('POST', `/api/admissions/${admission}/discharge`, {});
    expect(closed.status).toBe(200);
    const payload = {
      timezone: 'Africa/Nairobi',
      cutoffMinutes: 0,
      graceMinutes: 0,
      sameDayRule: 'ONE',
      reason: 'Verified synthetic transfers',
      evidenceReference: 'Synthetic ward record 2',
      affirmReviewedHistoryAndCharges: true,
      periods: [
        {
          wardId: historyWard,
          bedId: firstBed,
          startedAt: start.toISOString(),
          endedAt: transfer.toISOString(),
          dailyRate: '100.00',
        },
        {
          wardId: secondWard,
          bedId: lastBed,
          startedAt: transfer.toISOString(),
          endedAt: closed.body.dischargeDate,
          dailyRate: '250.00',
        },
      ],
    };
    const conflict = {
      ...payload,
      periods: [
        { ...payload.periods[0], endedAt: new Date(transfer.getTime() + 1000).toISOString() },
        payload.periods[1],
      ],
    };
    expect(
      (await call('POST', `/api/admissions/${admission}/bed-history-review`, conflict)).status,
    ).toBe(409);
    expect(
      (
        await pool.query('SELECT id FROM inpatient_bed_billing_reviews WHERE admission_id=$1', [
          admission,
        ])
      ).rows,
    ).toHaveLength(0);
    const reviewed = await call('POST', `/api/admissions/${admission}/bed-history-review`, payload);
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(201);
    const billed = await call('POST', `/api/admissions/${admission}/bed-billing-retry`, {});
    expect(billed.status, JSON.stringify(billed.body)).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT bi.unit_price,bo.bed_id FROM billing_items bi JOIN inpatient_bed_occupancies bo ON bo.id=bi.bed_occupancy_id WHERE bi.source_type='BED_DAY' AND bi.source_id=$1 ORDER BY bi.service_date",
          [admission],
        )
      ).rows,
    ).toEqual([
      { unit_price: '100.00', bed_id: firstBed },
      { unit_price: '250.00', bed_id: lastBed },
    ]);
    expect((await call('DELETE', `/api/beds/${firstBed}`)).status).toBe(409);
    expect((await call('DELETE', `/api/wards/${historyWard}`)).status).toBe(409);
  });

  it('pages only scoped pending bed admissions without returning patient details', async () => {
    const pageFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic paging facility','Africa/Nairobi',$3::jsonb) RETURNING id",
        [tenant, `BEDP-${suffix}`, JSON.stringify(['inpatient', 'finance'])],
      )
    ).rows[0].id;
    const pageToken = (await user(tenant, pageFacility, 'paging', grants)).token;
    const pageWard = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic paging ward',$2) RETURNING id",
        [pageFacility, `PG-${suffix}`],
      )
    ).rows[0].id;
    const patient = await makePatient(pageFacility),
      encounter = await makeEncounter(patient, pageFacility),
      bed = await makeBed(pageWard);
    const admissions = (
      await pool.query(
        `INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status)
      SELECT $1,$2,$3,$4,$5,$6,'Synthetic historical timestamp','Discharged' FROM generate_series(1,51) RETURNING id`,
        [tenant, pageFacility, patient, encounter, pageWard, bed],
      )
    ).rows.map((row) => row.id);
    await pool.query(
      `INSERT INTO billing_charge_attempts(tenant_id,facility_id,patient_id,source_type,source_id,item_type,reason,diagnosis_code,detail,status)
      SELECT $1,$2,$3,'BED_DAY',a.id,'Inpatient','BED_OCCUPANCY_REVIEW','BED_HISTORY_REVIEW_REQUIRED','Synthetic pending review','PENDING'
      FROM admissions a WHERE a.id=ANY($4::int[])`,
      [tenant, pageFacility, patient, admissions],
    );
    await pool.query(
      `INSERT INTO billing_charge_attempts(tenant_id,facility_id,patient_id,source_type,source_id,item_type,reason,status)
      VALUES($1,$2,$3,'ADMISSION',$4,'Inpatient','TARIFF_NOT_CONFIGURED','PENDING')`,
      [tenant, pageFacility, patient, admissions[0]],
    );
    const first = await call(
      'GET',
      '/api/inpatient/bed-billing-unresolved?offset=0',
      undefined,
      pageToken,
    );
    const next = await call(
      'GET',
      '/api/inpatient/bed-billing-unresolved?offset=50',
      undefined,
      pageToken,
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(first.body).toMatchObject({ hasMore: true, offset: 0, pageSize: 50 });
    expect(next.body).toMatchObject({ hasMore: false, offset: 50, pageSize: 50 });
    expect(first.body.admissions).toHaveLength(50);
    expect(next.body.admissions).toHaveLength(1);
    const all = [...first.body.admissions, ...next.body.admissions];
    expect(new Set(all.map((row) => row.admissionId)).size).toBe(51);
    expect(
      all.every(
        (row) =>
          row.admissionStatus === 'Discharged' &&
          row.pendingAttempts === 1 &&
          row.stagingPending === false &&
          Object.keys(row).sort().join(',') ===
            'admissionId,admissionStatus,pendingAttempts,stagingPending',
      ),
    ).toBe(true);
    expect(
      (
        await call(
          'GET',
          `/api/inpatient/bed-billing-unresolved?facilityId=${pageFacility}`,
          undefined,
          tenantToken,
        )
      ).body.admissions,
    ).toHaveLength(50);
    expect(
      (await call('GET', `/api/inpatient/bed-billing-unresolved?facilityId=${pageFacility}`))
        .status,
    ).toBe(403);
    expect(
      (await call('GET', '/api/inpatient/bed-billing-unresolved', undefined, platformToken)).status,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          '/api/inpatient/bed-billing-unresolved?offset=1000001',
          undefined,
          pageToken,
        )
      ).status,
    ).toBe(400);
  });

  it('isolates policy and occupancy from another tenant or facility', async () => {
    const stay = await makeSyntheticStay(1);
    for (const outsider of [otherToken, sameTenantToken]) {
      expect(
        (await call('GET', `/api/admissions/${stay.admission}/bed-occupancy`, undefined, outsider))
          .status,
      ).toBe(403);
      expect(
        (await call('POST', `/api/admissions/${stay.admission}/discharge`, {}, outsider)).status,
      ).toBe(403);
      expect(
        (await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {}, outsider))
          .status,
      ).toBe(403);
    }
    expect(
      (await pool.query('SELECT status FROM admissions WHERE id=$1', [stay.admission])).rows[0]
        .status,
    ).toBe('Admitted');
  });
});
