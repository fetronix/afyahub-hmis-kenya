import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { finalizeInvoice, getFinalizedInvoice } from '../../billing/finalized-invoice.service.ts';
import { prepareShaClaim } from '../../insurance/eclaims/claims-workflow.service.ts';
import { preparePrivateInsuranceClaim, validatePrivateInsuranceClaimById } from '../../insurance/claims/private-claims.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Bed daily-charge billing at discharge (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, sameTenantFacility: number, otherTenant: number, otherFacility: number, ward: number, secondWard: number, actor: number;
  let token: string, otherToken: string, sameTenantToken: string, limitedToken: string, platformToken: string, base: string, close: () => Promise<void>;
  let serial = 0;
  const grants = ['inpatient.read','inpatient.admit','inpatient.discharge','inpatient.wards.update','inpatient.wards.delete','inpatient.beds.create','inpatient.beds.update','inpatient.beds.delete','billing.read','billing.create','billing.update','clinical.read'];
  const call = (method: string, path: string, body?: Record<string, unknown>, auth = token) => httpJson(base, method, path, { token: auth, body });
  async function makePatient(f = facility, t = tenant) {
    return (await pool.query("INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Bed','2000-01-01','Other') RETURNING id", [t, f, `BED-P-${suffix}-${++serial}`])).rows[0].id as number;
  }
  async function makeEncounter(patient: number, f = facility, t = tenant) {
    return (await pool.query("INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'INPATIENT','ACTIVE') RETURNING id", [t, f, patient])).rows[0].id as number;
  }
  async function makeBed(w = ward, rate: string | null = '100.00') {
    return (await pool.query("INSERT INTO beds(ward_id,bed_number,bed_type,status,daily_charge) VALUES($1,$2,'Standard','Available',$3) RETURNING id", [w, `BED-${suffix}-${++serial}`, rate])).rows[0].id as number;
  }
  async function makeSyntheticStay(days: number, encounter = true, rate = '100.00') {
    const patient = await makePatient(), visit = encounter ? await makeEncounter(patient) : null, bed = await makeBed(ward, rate);
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const admission = (await pool.query("INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,$7,'Admitted') RETURNING id", [tenant, facility, patient, visit, ward, bed, start.toISOString()])).rows[0].id as number;
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [patient, bed]);
    await pool.query("INSERT INTO inpatient_bed_stay_snapshots(admission_id,tenant_id,facility_id,patient_id,timezone_snapshot,cutoff_minutes,grace_minutes,same_day_rule,policy_revision) VALUES($1,$2,$3,$4,'Africa/Nairobi',0,0,'ONE',1)", [admission, tenant, facility, patient]);
    await pool.query("INSERT INTO inpatient_bed_occupancies(admission_id,tenant_id,facility_id,patient_id,ward_id,bed_id,started_at,daily_rate_snapshot,bed_number_snapshot,bed_type_snapshot,ward_name_snapshot,recorded_by_user_id) SELECT $1,$2,$3,$4,$5,id,$6,$7,bed_number,bed_type,'Synthetic ward',$8 FROM beds WHERE id=$9", [admission, tenant, facility, patient, ward, start, rate, actor, bed]);
    return { admission, patient, encounter: visit, bed, start };
  }
  async function user(t: number, f: number, label: string, grants: string[]) {
    const id = (await pool.query("INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic bed user','test-only','ACTIVE',$3,$4) RETURNING id", [`bed-${label}-${suffix}`, `bed-${label}-${suffix}@example.test`, t, f])).rows[0].id as number;
    const role = (await pool.query('INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id', [t, `BED_${label}_${suffix}`])).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const grant of grants) {
      await pool.query("INSERT INTO permissions(code,name,module) VALUES($1,$1,'inpatient') ON CONFLICT(code) DO NOTHING", [grant]);
      await pool.query('INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2', [role, grant]);
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('synthetic') || !(process.env.SQL_DB_NAME ?? '').includes('test')) throw new Error('A disposable synthetic test database is required.');
    [tenant, otherTenant] = (await pool.query('INSERT INTO tenants(name,slug,timezone) VALUES($1,$2,$5),($3,$4,$5) RETURNING id', [`Synthetic bed ${suffix}`, `bed-a-${suffix}`, `Synthetic bed other ${suffix}`, `bed-b-${suffix}`, 'Africa/Nairobi'])).rows.map((r) => r.id);
    [facility, otherFacility] = (await pool.query("INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic A','Africa/Nairobi',$5::jsonb),($3,$4,'Synthetic B','Africa/Nairobi',$5::jsonb) RETURNING id", [tenant, `BEDA-${suffix}`, otherTenant, `BEDB-${suffix}`, JSON.stringify(['inpatient','finance'])])).rows.map((r) => r.id);
    sameTenantFacility = (await pool.query("INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic same tenant','Africa/Nairobi',$3::jsonb) RETURNING id", [tenant, `BEDC-${suffix}`, JSON.stringify(['inpatient','finance'])])).rows[0].id;
    [ward, secondWard] = (await pool.query("INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic ward',$2),($1,'Synthetic transfer ward',$3) RETURNING id", [facility, `BW-${suffix}`, `BX-${suffix}`])).rows.map((r) => r.id);
    const manager = await user(tenant, facility, 'manager', grants); actor = manager.id; token = manager.token;
    otherToken = (await user(otherTenant, otherFacility, 'other', grants)).token;
    sameTenantToken = (await user(tenant, sameTenantFacility, 'same', grants)).token;
    limitedToken = (await user(tenant, facility, 'limited', ['inpatient.read','inpatient.beds.update','inpatient.wards.update','clinical.read'])).token;
    const platform = (await pool.query("INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic platform admin','test-only','ACTIVE',$3,$4) RETURNING id", [`bed-platform-${suffix}`, `bed-platform-${suffix}@example.test`, tenant, facility])).rows[0].id;
    const role = (await pool.query("INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id")).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [platform, role]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN ('inpatient.read','inpatient.wards.update','inpatient.beds.update','billing.update','clinical.read')", [role]);
    platformToken = (await createSession({ userId: platform, securityVersion: 1 })).sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    const configured = await call('PUT', '/api/inpatient/bed-billing-policy', { cutoffMinutes: 0, graceMinutes: 0, sameDayRule: 'ONE', reason: 'Synthetic approved policy' });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
  });
  afterAll(async () => { if (close) await close(); });

  it('uses an actual captured KES 100 daily charge for three cutoffs, without any bed tariff', async () => {
    const stay = await makeSyntheticStay(3);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, { dischargeType: 'Synthetic' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.status).toBe('Discharged');
    expect(closed.body.billing.nights).toBe(3);
    const lines = (await pool.query("SELECT bi.*,i.encounter_id,i.patient_id FROM billing_items bi JOIN billing_invoices i ON i.id=bi.invoice_id WHERE bi.source_type='BED_DAY' AND bi.source_id=$1 ORDER BY bi.service_date", [stay.admission])).rows;
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.unit_price === '100.00' && l.total_amount === '100.00' && l.quantity === 1 && l.tariff_id === null && l.facility_service_id === null && l.bed_occupancy_id && l.bed_night_id && l.encounter_id === stay.encounter && l.patient_id === stay.patient)).toBe(true);
    expect(lines.reduce((sum, l) => sum + Number(l.total_amount), 0)).toBe(300);
    const invoice = (await pool.query('SELECT total_amount FROM billing_invoices WHERE id=$1', [lines[0].invoice_id])).rows[0];
    expect(invoice.total_amount).toBe('300.00');
    expect((await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [stay.bed])).rows[0]).toEqual({ status: 'Cleaning', current_patient_id: null });
    const again = await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {});
    expect(again.status).toBe(200);
    expect(again.body.bedDays ?? again.body.charges).toHaveLength(3);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [stay.admission])).rows[0].n).toBe(3);
    expect((await call('POST', `/api/admissions/${stay.admission}/discharge`, {})).status).toBe(409);
  });

  it('preserves a failed missing-encounter charge, cleans the bed, and bills once after an authorized link', async () => {
    const stay = await makeSyntheticStay(0, false);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    expect(closed.status).toBe(200);
    expect(closed.body.billing.bedDays[0]).toMatchObject({ charged: false, reason: 'BED_OCCUPANCY_REVIEW', diagnosis: { code: 'BED_ENCOUNTER_REQUIRED' } });
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [stay.bed])).rows[0].status).toBe('Cleaning');
    expect((await pool.query("SELECT unit_price_snapshot,total_snapshot FROM inpatient_bed_nights WHERE admission_id=$1", [stay.admission])).rows[0]).toEqual({ unit_price_snapshot: '100.00', total_snapshot: '100.00' });
    const pending = (await pool.query("SELECT id,status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1", [stay.admission])).rows[0];
    expect(pending.status).toBe('PENDING');
    const visit = await makeEncounter(stay.patient);
    expect((await call('POST', `/api/admissions/${stay.admission}/bed-billing-encounter`, { encounterId: visit, reason: 'Verified synthetic encounter' }, otherToken)).status).toBe(403);
    expect((await call('POST', `/api/admissions/${stay.admission}/bed-billing-encounter`, { encounterId: visit, reason: 'Verified synthetic encounter' })).status).toBe(200);
    const [a, b] = await Promise.all([call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {}), call('POST', `/api/billing/charge-attempts/${pending.id}/retry`, {})]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(['BILLED', 'DUPLICATE']).toContain(b.body.status);
    expect((await pool.query("SELECT COUNT(*)::int AS n, SUM(total_amount)::numeric(10,2) AS total FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [stay.admission])).rows[0]).toEqual({ n: 1, total: '100.00' });
    expect((await pool.query("SELECT status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1", [stay.admission])).rows[0].status).toBe('BILLED');
  });

  it('captures the rate at real assignment and does not reprice when the bed is edited', async () => {
    const patient = await makePatient(), visit = await makeEncounter(patient), bed = await makeBed();
    const admitted = await call('POST', '/api/admissions', { patientId: patient, wardId: ward, bedId: bed, encounterId: visit });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    const occupancy = (await pool.query('SELECT daily_rate_snapshot,started_at FROM inpatient_bed_occupancies WHERE admission_id=$1', [admitted.body.id])).rows[0];
    expect(occupancy.daily_rate_snapshot).toBe('100.00');
    expect(occupancy.started_at).toBeTruthy();
    const edit = await call('PUT', `/api/beds/${bed}`, { dailyCharge: '200.00', expectedPriceRevision: 1, priceReason: 'Synthetic rate approval' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const line = (await pool.query("SELECT unit_price,total_amount FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [admitted.body.id])).rows;
    expect(line).toEqual([{ unit_price: '100.00', total_amount: '100.00' }]);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE resource='BedDailyCharge' AND resource_id=$1", [String(bed)])).rows[0].n).toBe(1);
  });

  it('captures ward and bed transfers as distinct, contiguous periods at their own rates', async () => {
    const patient = await makePatient(), visit = await makeEncounter(patient), first = await makeBed(), second = await makeBed(ward, '150.00'), third = await makeBed(secondWard, '250.00');
    const admitted = await call('POST', '/api/admissions', { patientId: patient, wardId: ward, bedId: first, encounterId: visit });
    expect(admitted.status).toBe(201);
    expect((await call('POST', `/api/admissions/${admitted.body.id}/transfer`, { toWardId: ward, toBedId: second })).status).toBe(200);
    expect((await call('POST', `/api/admissions/${admitted.body.id}/transfer`, { toWardId: secondWard, toBedId: third })).status).toBe(200);
    const rows = (await pool.query('SELECT bed_id,ward_id,started_at,ended_at,daily_rate_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1 ORDER BY id', [admitted.body.id])).rows;
    expect(rows.map((r) => [r.bed_id, r.ward_id, r.daily_rate_snapshot])).toEqual([[first, ward, '100.00'], [second, ward, '150.00'], [third, secondWard, '250.00']]);
    expect(rows[0].ended_at.getTime()).toBe(rows[1].started_at.getTime());
    expect(rows[1].ended_at.getTime()).toBe(rows[2].started_at.getTime());
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [admitted.body.id])).rows[0].n).toBe(0);
    const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
    expect(closed.status).toBe(200);
    expect((await pool.query("SELECT unit_price FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [admitted.body.id])).rows[0].unit_price).toBe('250.00');
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [third])).rows[0].status).toBe('Cleaning');
  });

  it('finalizes tariff-free bed invoice evidence and prevents mutation of billed lines', async () => {
    const stay = await makeSyntheticStay(1);
    await pool.query("UPDATE facilities SET mfl_code=$1,address='Synthetic road',county='Nyeri',phone='0000000000' WHERE id=$2", [`SYN-BED-MFL-${suffix}`, facility]);
    const department = (await pool.query("INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic ward department',$2) RETURNING id", [facility, `BED-DEP-${suffix}`])).rows[0].id;
    const practitioner = (await pool.query("INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,'Synthetic clinician') RETURNING id", [tenant, facility])).rows[0].id;
    await pool.query('UPDATE encounters SET department_id=$1,practitioner_id=$2 WHERE id=$3', [department, practitioner, stay.encounter]);
    await pool.query("INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic diagnosis')", [stay.encounter, stay.patient]);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    expect(closed.status).toBe(200);
    const charge = closed.body.billing.bedDays[0];
    expect(charge).toMatchObject({ charged: true, unitPrice: '100.00', totalAmount: '100.00' });
    const context: AuthorizationContext = { userId: actor, tenantId: tenant, facilityId: facility, roles: [], permissions: grants, isSuperAdmin: false };
    const finalized = await finalizeInvoice(context, charge.invoiceId, { insurerResponsibility: '0.00', copayment: '0.00', allocationBasis: 'Synthetic self-pay allocation' });
    expect(finalized.idempotentReplay).toBe(false);
    const invoice = await getFinalizedInvoice(context, charge.invoiceId);
    expect(invoice.finalized).toBe(true);
    if (!invoice.finalized) throw new Error('Synthetic bed invoice not finalized');
    expect(invoice.snapshot.items).toHaveLength(1);
    expect(invoice.snapshot.items[0]).toMatchObject({ tariffId: null, priceSource: 'BED_OCCUPANCY_SNAPSHOT', admissionId: stay.admission, unitPrice: '100.00', total: '100.00', bedOccupancyId: expect.any(Number), bedNightId: expect.any(Number) });
    await expect(pool.query('UPDATE billing_items SET unit_price=200 WHERE id=$1', [charge.itemId])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('DELETE FROM billing_items WHERE id=$1', [charge.itemId])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('UPDATE inpatient_bed_nights SET unit_price_snapshot=200,total_snapshot=200 WHERE admission_id=$1', [stay.admission])).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('SELECT total_amount FROM billing_invoices WHERE id=$1', [charge.invoiceId])).rows[0].total_amount).toBe('100.00');
  });

  it('does not infer SHA or private payer codes from an internal bed number or matching description', async () => {
    const stay = await makeSyntheticStay(1);
    await pool.query("INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic diagnosis')", [stay.encounter, stay.patient]);
    const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
    const itemId = closed.body.billing.bedDays[0].itemId, invoiceId = closed.body.billing.bedDays[0].invoiceId;
    const description = (await pool.query('SELECT description FROM billing_items WHERE id=$1', [itemId])).rows[0].description;
    const trap = (await pool.query("INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee) VALUES($1,$2,$3,$4,'inpatient','Night','999.00') RETURNING id", [tenant, facility, `BED-TRAP-${suffix}`, description])).rows[0].id;
    await pool.query("INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,payer_name,payer_type,integration_type,adapter_key,environment) VALUES($1,$2,'SYNBED','Synthetic payer','PRIVATE_INSURER','MANUAL','manual','UNCONFIGURED'),($1,$2,'SHA','Synthetic SHA fixture','PUBLIC_SCHEME','MANUAL','manual','UNCONFIGURED')", [tenant, facility]);
    await pool.query("INSERT INTO payer_service_code_mappings(tenant_id,facility_id,payer_code,tariff_id,local_code,local_description,service_area,payer_service_code,payer_service_name,reimbursement_tariff) VALUES($1,$2,'SYNBED',$3,$4,'Synthetic unrelated tariff','INPATIENT','SYN-BED-PAYER','Synthetic unrelated code','999.00')", [tenant, facility, trap, `BED-TRAP-${suffix}`]);
    const policy = (await pool.query("INSERT INTO insurance_member_policies(tenant_id,facility_id,patient_id,payer_code,member_number) VALUES($1,$2,$3,'SYNBED',$4) RETURNING id", [tenant, facility, stay.patient, `SYN-BED-${suffix}`])).rows[0].id;
    const actorInfo = { tenantId: tenant, facilityId: facility, actorUserId: actor, actorUserUid: `bed-manager-${suffix}` };
    const privateClaim = await preparePrivateInsuranceClaim({ ...actorInfo, input: { invoiceId, memberPolicyId: policy, encounterId: stay.encounter! } });
    expect(privateClaim.lines[0]).toMatchObject({ tariffId: null, mappingId: null, mappingStatus: 'UNMAPPED', payerServiceCode: null, grossAmount: '100.00' });
    const checked = await validatePrivateInsuranceClaimById({ ...actorInfo, claimId: privateClaim.id });
    expect(checked.validationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNMAPPED_SERVICE_LINE', severity: 'ERROR' })]));
    const sha = await prepareShaClaim({ tenantId: tenant, facilityId: facility, userId: actor, userUid: actorInfo.actorUserUid }, { invoiceId, encounterId: stay.encounter!, schemeCode: 'SHIF' });
    expect(sha.validationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNMAPPED_SERVICE_CODE', severity: 'ERROR' })]));
    expect((await pool.query('SELECT tariff_id,payer_service_code,facility_unit_price FROM sha_eclaim_items WHERE eclaim_id=$1', [sha.id])).rows[0]).toEqual({ tariff_id: null, payer_service_code: null, facility_unit_price: '100.00' });
  });

  it('restricts policy and bed-price changes, audits revisions, and leaves unchanged bed edits alone', async () => {
    const current = await call('GET', '/api/inpatient/bed-billing-policy');
    expect(current.status).toBe(200);
    const proposed = { cutoffMinutes: 0, graceMinutes: 15, sameDayRule: 'ONE', expectedRevision: current.body.revision, reason: 'Synthetic policy change' };
    expect((await call('PUT', '/api/inpatient/bed-billing-policy', proposed, limitedToken)).status).toBe(403);
    expect((await call('PUT', '/api/inpatient/bed-billing-policy', proposed, platformToken)).status).toBe(403);
    expect((await call('PUT', '/api/inpatient/bed-billing-policy', { ...proposed, expectedRevision: current.body.revision + 9 })).status).toBe(409);
    const changed = await call('PUT', '/api/inpatient/bed-billing-policy', proposed);
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.revision).toBe(current.body.revision + 1);
    expect((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE resource='InpatientBedBillingPolicy' AND resource_id=$1", [String(current.body.id)])).rows[0].n).toBeGreaterThanOrEqual(2);
    expect((await call('PUT', '/api/inpatient/bed-billing-policy', { ...proposed, graceMinutes: 0, expectedRevision: changed.body.revision, reason: 'Restore synthetic fixture' })).status).toBe(200);

    const bed = await makeBed();
    const body = { dailyCharge: '125.00', expectedPriceRevision: 1, priceReason: 'Synthetic documented price change' };
    expect((await call('PUT', `/api/beds/${bed}`, body, limitedToken)).status).toBe(403);
    expect((await call('PUT', `/api/beds/${bed}`, body, platformToken)).status).toBe(403);
    const ordinary = await call('PUT', `/api/beds/${bed}`, { bedType: 'Private' }, limitedToken);
    expect(ordinary.status, JSON.stringify(ordinary.body)).toBe(200);
    expect(ordinary.body.dailyCharge).toBe('100.00');
    const revised = await call('PUT', `/api/beds/${bed}`, body);
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    expect(revised.body).toMatchObject({ dailyCharge: '125.00', priceRevision: 2 });
    expect((await call('PUT', `/api/beds/${bed}`, { ...body, dailyCharge: '140.00' })).status).toBe(409);
    const audit = (await pool.query("SELECT details FROM audit_logs WHERE resource='BedDailyCharge' AND resource_id=$1", [String(bed)])).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details)).toMatchObject({ before: '100.00', after: '125.00', revision: 2, reason: body.priceReason });
  });

  it('freezes the policy at admission even when facility settings change before discharge', async () => {
    const patient = await makePatient(), visit = await makeEncounter(patient), bed = await makeBed();
    const current = await call('GET', '/api/inpatient/bed-billing-policy');
    const admitted = await call('POST', '/api/admissions', { patientId: patient, encounterId: visit, wardId: ward, bedId: bed });
    expect(admitted.status).toBe(201);
    const change = await call('PUT', '/api/inpatient/bed-billing-policy', { cutoffMinutes: 0, graceMinutes: 0, sameDayRule: 'ZERO', expectedRevision: current.body.revision, reason: 'Synthetic new policy' });
    expect(change.status).toBe(200);
    try {
      const captured = (await pool.query('SELECT same_day_rule,policy_revision FROM inpatient_bed_stay_snapshots WHERE admission_id=$1', [admitted.body.id])).rows[0];
      expect(captured).toEqual({ same_day_rule: 'ONE', policy_revision: current.body.revision });
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status).toBe(200);
      expect(closed.body.billing.bedDays).toHaveLength(1);
      expect(closed.body.billing.bedDays[0]).toMatchObject({ charged: true, totalAmount: '100.00' });
    } finally {
      expect((await call('PUT', '/api/inpatient/bed-billing-policy', { cutoffMinutes: 0, graceMinutes: 0, sameDayRule: 'ONE', expectedRevision: change.body.revision, reason: 'Restore synthetic policy' })).status).toBe(200);
    }
  });

  it('never bills missing, zero or unconfirmed legacy-default bed prices', async () => {
    for (const price of [null, '0.00', '1500.00']) {
      const patient = await makePatient(), visit = await makeEncounter(patient), bed = await makeBed(ward, price);
      if (price === '1500.00') await pool.query('UPDATE beds SET daily_charge_review_required=true,price_revision=price_revision+1 WHERE id=$1', [bed]);
      const admitted = await call('POST', '/api/admissions', { patientId: patient, encounterId: visit, wardId: ward, bedId: bed });
      expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
      expect((await pool.query('SELECT daily_rate_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1', [admitted.body.id])).rows[0].daily_rate_snapshot).toBeNull();
      const closed = await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {});
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect(closed.body.billing.review.code).toBe('BED_RATE_REVIEW_REQUIRED');
      expect((await call('GET', `/api/admissions/${admitted.body.id}/bed-occupancy`)).body.review.code).toBe('BED_RATE_REVIEW_REQUIRED');
      expect((await pool.query('SELECT status FROM beds WHERE id=$1', [bed])).rows[0].status).toBe('Cleaning');
      expect((await pool.query("SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [admitted.body.id])).rows).toHaveLength(0);
      expect((await pool.query("SELECT status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1", [admitted.body.id])).rows[0].status).toBe('PENDING');
    }
  });

  it('keeps a committed discharge, price evidence and retryable queue when invoice insertion fails', async () => {
    const stay = await makeSyntheticStay(1);
    const identifier = `synthetic_bed_failure_${suffix.replace(/[^a-z0-9]/gi, '')}`;
    await pool.query(`CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_type='BED_DAY' AND NEW.source_id=${stay.admission} THEN RAISE EXCEPTION 'Synthetic invoice failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${identifier} BEFORE INSERT ON billing_items FOR EACH ROW EXECUTE FUNCTION ${identifier}()`);
    try {
      const closed = await call('POST', `/api/admissions/${stay.admission}/discharge`, {});
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      expect(closed.body.status).toBe('Discharged');
      expect(closed.body.billing.bedDays[0]).toMatchObject({ charged: false, reason: 'INVALID_INPUT' });
      expect((await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [stay.bed])).rows[0]).toEqual({ status: 'Cleaning', current_patient_id: null });
      expect((await pool.query('SELECT unit_price_snapshot,total_snapshot FROM inpatient_bed_nights WHERE admission_id=$1', [stay.admission])).rows[0]).toEqual({ unit_price_snapshot: '100.00', total_snapshot: '100.00' });
      expect((await pool.query("SELECT status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1", [stay.admission])).rows[0].status).toBe('PENDING');
      expect((await pool.query("SELECT id FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [stay.admission])).rows).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER ${identifier} ON billing_items`);
      await pool.query(`DROP FUNCTION ${identifier}()`);
    }
    const retry = await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.charges[0]).toMatchObject({ charged: true, totalAmount: '100.00' });
  });

  it('requires an explicit audited history review for legacy stays and retains the old pending attempt', async () => {
    const patient = await makePatient(), visit = await makeEncounter(patient), bed = await makeBed();
    const start = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    // Legacy clinical time has no reliable offset and has no price snapshot.
    const admission = (await pool.query("INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,'legacy time needs review','Admitted') RETURNING id", [tenant, facility, patient, visit, ward, bed])).rows[0].id as number;
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [patient, bed]);
    const closed = await call('POST', `/api/admissions/${admission}/discharge`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.billing.review.code).toBe('BED_HISTORY_REVIEW_REQUIRED');
    expect((await pool.query('SELECT status FROM beds WHERE id=$1', [bed])).rows[0].status).toBe('Cleaning');
    const prior = (await pool.query("SELECT id,detail,status FROM billing_charge_attempts WHERE source_type='BED_DAY' AND source_id=$1", [admission])).rows[0];
    expect(prior.status).toBe('PENDING');
    const payload = { timezone: 'Africa/Nairobi', cutoffMinutes: 0, graceMinutes: 0, sameDayRule: 'ONE', reason: 'Verified synthetic history', evidenceReference: 'Synthetic ward register 1', affirmReviewedHistoryAndCharges: true,
      periods: [{ wardId: ward, bedId: bed, startedAt: start.toISOString(), endedAt: closed.body.dischargeDate, dailyRate: '100.00' }] };
    expect((await call('POST', `/api/admissions/${admission}/bed-history-review`, payload, otherToken)).status).toBe(403);
    const review = await call('POST', `/api/admissions/${admission}/bed-history-review`, payload);
    expect(review.status, JSON.stringify(review.body)).toBe(201);
    expect(review.body.nights).toBe(3);
    const retained = (await pool.query('SELECT detail,status FROM billing_charge_attempts WHERE id=$1', [prior.id])).rows[0];
    expect(retained).toEqual({ detail: prior.detail, status: 'SUPERSEDED' });
    const oldRetry = await call('POST', `/api/billing/charge-attempts/${prior.id}/retry`, {});
    expect(oldRetry.status).toBe(200);
    expect(oldRetry.body.status).toBe('SUPERSEDED');
    expect((await pool.query('SELECT evidence_reference,reason FROM inpatient_bed_billing_reviews WHERE admission_id=$1', [admission])).rows[0]).toEqual({ evidence_reference: 'Synthetic ward register 1', reason: 'Verified synthetic history' });
    const retry = await call('POST', `/api/admissions/${admission}/bed-billing-retry`, {});
    expect(retry.status).toBe(200);
    expect((await pool.query("SELECT COUNT(*)::int n,SUM(total_amount)::numeric(10,2) total FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1", [admission])).rows[0]).toEqual({ n: 3, total: '300.00' });
    expect((await call('POST', `/api/admissions/${admission}/bed-history-review`, payload)).status).toBe(409);
  });

  it('serializes concurrent discharge and transfer without overlapping occupancy or duplicate bills', async () => {
    const patient = await makePatient(), visit = await makeEncounter(patient), firstBed = await makeBed(), nextBed = await makeBed(secondWard, '150.00');
    const admitted = await call('POST', '/api/admissions', { patientId: patient, encounterId: visit, wardId: ward, bedId: firstBed });
    expect(admitted.status).toBe(201);
    const [discharged, transferred] = await Promise.all([
      call('POST', `/api/admissions/${admitted.body.id}/discharge`, {}),
      call('POST', `/api/admissions/${admitted.body.id}/transfer`, { toWardId: secondWard, toBedId: nextBed, reason: 'Synthetic concurrent transfer' }),
    ]);
    expect(discharged.status, JSON.stringify(discharged.body)).toBe(200);
    expect([200, 409]).toContain(transferred.status);
    const periods = (await pool.query('SELECT bed_id,started_at,ended_at,daily_rate_snapshot FROM inpatient_bed_occupancies WHERE admission_id=$1 ORDER BY started_at,id', [admitted.body.id])).rows;
    expect(periods.length).toBe(transferred.status === 200 ? 2 : 1);
    expect(periods.every((p) => p.ended_at !== null)).toBe(true);
    if (periods.length === 2) expect(periods[0].ended_at.getTime()).toBe(periods[1].started_at.getTime());
    const finalBed = periods[periods.length - 1].bed_id;
    expect((await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [finalBed])).rows[0]).toEqual({ status: 'Cleaning', current_patient_id: null });
    const lines = (await pool.query("SELECT service_date,count(*)::int n FROM billing_items WHERE source_type='BED_DAY' AND source_id=$1 GROUP BY service_date", [admitted.body.id])).rows;
    expect(lines.every((line) => line.n === 1)).toBe(true);
    expect((await call('POST', `/api/admissions/${admitted.body.id}/discharge`, {})).status).toBe(409);
  });

  it('checks the recorded transfer chain before reviewing historical rates and bills the bed at each cutoff', async () => {
    const patient = await makePatient(), visit = await makeEncounter(patient);
    const historyWard = (await pool.query("INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic former ward',$2) RETURNING id", [facility, `HIST-${suffix}-${++serial}`])).rows[0].id as number;
    const firstBed = await makeBed(historyWard), lastBed = await makeBed(secondWard, '250.00');
    const start = new Date(Date.now() - 48 * 60 * 60 * 1000), transfer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const admission = (await pool.query("INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,'legacy date requires documentation','Admitted') RETURNING id", [tenant, facility, patient, visit, secondWard, lastBed])).rows[0].id as number;
    await pool.query("INSERT INTO admission_transfers(tenant_id,facility_id,admission_id,patient_id,from_ward_id,from_bed_id,to_ward_id,to_bed_id,transferred_by,transferred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic',$9::timestamptz AT TIME ZONE 'UTC')", [tenant, facility, admission, patient, historyWard, firstBed, secondWard, lastBed, transfer]);
    await pool.query("UPDATE beds SET status='Occupied',current_patient_id=$1 WHERE id=$2", [patient, lastBed]);
    const closed = await call('POST', `/api/admissions/${admission}/discharge`, {});
    expect(closed.status).toBe(200);
    const payload = { timezone: 'Africa/Nairobi', cutoffMinutes: 0, graceMinutes: 0, sameDayRule: 'ONE', reason: 'Verified synthetic transfers', evidenceReference: 'Synthetic ward record 2', affirmReviewedHistoryAndCharges: true,
      periods: [{ wardId: historyWard, bedId: firstBed, startedAt: start.toISOString(), endedAt: transfer.toISOString(), dailyRate: '100.00' }, { wardId: secondWard, bedId: lastBed, startedAt: transfer.toISOString(), endedAt: closed.body.dischargeDate, dailyRate: '250.00' }] };
    const conflict = { ...payload, periods: [{ ...payload.periods[0], endedAt: new Date(transfer.getTime() + 1000).toISOString() }, payload.periods[1]] };
    expect((await call('POST', `/api/admissions/${admission}/bed-history-review`, conflict)).status).toBe(409);
    expect((await pool.query('SELECT id FROM inpatient_bed_billing_reviews WHERE admission_id=$1', [admission])).rows).toHaveLength(0);
    const reviewed = await call('POST', `/api/admissions/${admission}/bed-history-review`, payload);
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(201);
    const billed = await call('POST', `/api/admissions/${admission}/bed-billing-retry`, {});
    expect(billed.status, JSON.stringify(billed.body)).toBe(200);
    expect((await pool.query("SELECT bi.unit_price,bo.bed_id FROM billing_items bi JOIN inpatient_bed_occupancies bo ON bo.id=bi.bed_occupancy_id WHERE bi.source_type='BED_DAY' AND bi.source_id=$1 ORDER BY bi.service_date", [admission])).rows).toEqual([{ unit_price: '100.00', bed_id: firstBed }, { unit_price: '250.00', bed_id: lastBed }]);
    expect((await call('DELETE', `/api/beds/${firstBed}`)).status).toBe(409);
    expect((await call('DELETE', `/api/wards/${historyWard}`)).status).toBe(409);
  });

  it('isolates policy and occupancy from another tenant or facility', async () => {
    const stay = await makeSyntheticStay(1);
    for (const outsider of [otherToken, sameTenantToken]) {
      expect((await call('GET', `/api/admissions/${stay.admission}/bed-occupancy`, undefined, outsider)).status).toBe(403);
      expect((await call('POST', `/api/admissions/${stay.admission}/discharge`, {}, outsider)).status).toBe(403);
      expect((await call('POST', `/api/admissions/${stay.admission}/bed-billing-retry`, {}, outsider)).status).toBe(403);
    }
    expect((await pool.query('SELECT status FROM admissions WHERE id=$1', [stay.admission])).rows[0].status).toBe('Admitted');
  });
});
