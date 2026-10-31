/** Real HTTP + isolated synthetic PostgreSQL coverage for the dashboard. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, hashSessionToken } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { addCalendarDays, kenyaToday } from '../../dashboard/date-range.ts';
import { resolveDashboardFacility } from '../../dashboard/dashboard.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('facility dashboard HTTP and calculations (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  const enabled = ['registration', 'reception', 'opd', 'inpatient', 'finance', 'audit'];
  let tenant: number, facility: number, sibling: number, foreignFacility: number;
  let patient: number, oldPatient: number, siblingPatient: number, manager: number;
  let token: string,
    limited: string,
    foreign: string,
    noAccess: string,
    expired: string,
    base: string,
    close: () => Promise<void>;
  const call = (method: string, path: string, auth?: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, { token: auth, body });
  const overview = (id = facility, start = '2025-04-01', end = '2025-04-30') =>
    `/api/dashboard/overview?facilityId=${id}&start=${start}&end=${end}`;
  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    )
      throw new Error('A disposable local synthetic test database is required.');
    const tenants = await pool.query(
      'INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id',
      [
        `Dashboard synthetic ${suffix}`,
        `dash-${suffix}`,
        `Other synthetic ${suffix}`,
        `other-${suffix}`,
      ],
    );
    tenant = tenants.rows[0].id;
    const otherTenant = tenants.rows[1].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
      ($1,$2,'Synthetic Dashboard Hospital',$6::jsonb),($1,$3,'Synthetic Sibling',$6::jsonb),($4,$5,'Synthetic Foreign',$6::jsonb) RETURNING id`,
      [
        tenant,
        `D-A-${suffix}`,
        `D-B-${suffix}`,
        otherTenant,
        `D-C-${suffix}`,
        JSON.stringify(enabled),
      ],
    );
    [facility, sibling, foreignFacility] = facilities.rows.map((row) => row.id);
    const patients = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,created_at) VALUES
       ($1,$2,$4,'Synthetic','New','2000-01-01','Other','2025-04-05 12:00'),
       ($1,$2,$5,'Synthetic','Returning','2000-01-01','Other','2025-02-01 12:00'),
       ($1,$3,$6,'Synthetic','Sibling','2000-01-01','Other','2025-04-05 12:00') RETURNING id`,
      [tenant, facility, sibling, `DNEW-${suffix}`, `DOLD-${suffix}`, `DSIB-${suffix}`],
    );
    [patient, oldPatient, siblingPatient] = patients.rows.map((row) => row.id);
    const permissions = [
      'patients.read',
      'appointments.read',
      'clinical.read',
      'inpatient.read',
      'billing.read',
      'tariffs.read',
      'audit.read',
    ];
    for (const code of permissions)
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'dashboard') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    async function actor(tag: string, t: number, f: number, grants: string[]) {
      const user = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id",
          [`dash-${tag}-${suffix}`, `dash-${tag}-${suffix}@example.test`, `Synthetic ${tag}`, t, f],
        )
      ).rows[0].id;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, `DASH_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
      for (const code of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return {
        user,
        token: (await createSession({ userId: user, securityVersion: 1 })).sessionToken,
      };
    }
    const full = await actor('full', tenant, facility, permissions);
    manager = full.user;
    token = full.token;
    limited = (await actor('limited', tenant, facility, ['patients.read'])).token;
    foreign = (await actor('foreign', otherTenant, foreignFacility, permissions)).token;
    noAccess = (await actor('none', tenant, facility, [])).token;
    expired = (await actor('expired', tenant, facility, ['patients.read'])).token;
    await pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 day' WHERE session_token_hash=$1",
      [hashSessionToken(expired)],
    );
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,started_at,status) VALUES
      ($1,$2,$3,'2025-04-03 09:00','ACTIVE'),($1,$2,$3,'2025-04-04 10:00','COMPLETED'),
      ($1,$2,$4,'2025-04-05 13:00','ACTIVE'),($1,$2,$3,'2025-04-06 10:00','CANCELLED')`,
      [tenant, facility, oldPatient, patient],
    );
    const ward = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic Ward',$2) RETURNING id",
        [facility, `WARD-${suffix}`],
      )
    ).rows[0].id;
    const bed = (
      await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'1') RETURNING id", [ward])
    ).rows[0].id;
    await pool.query(
      "INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,created_at) VALUES($1,$2,$3,$4,$5,'2025-04-04 10:00','2025-04-04 10:00')",
      [tenant, facility, patient, ward, bed],
    );
    const invoices = await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,voided_at,created_at) VALUES
      ($1,$2,$3,$4,300,100,200,'Partially Paid',NULL,'2025-04-02 08:00'),
      ($1,$2,$3,$5,100,0,100,'Pending',NULL,'2025-04-03 08:00'),
      ($1,$2,$3,$6,1000,0,1000,'Void','2025-04-08 08:00','2025-04-02 08:00'),
      ($1,$7,$8,$9,5000,0,5000,'Pending',NULL,'2025-04-03 08:00') RETURNING id`,
      [
        tenant,
        facility,
        patient,
        `DINV-1-${suffix}`,
        `DINV-2-${suffix}`,
        `DINV-V-${suffix}`,
        sibling,
        siblingPatient,
        `DINV-X-${suffix}`,
      ],
    );
    const [bill, draft, voided] = invoices.rows.map((row) => row.id);
    await pool.query(
      `INSERT INTO billing_items(invoice_id,item_type,description,total_amount,created_at) VALUES
      ($1,'Laboratory','Synthetic lab',200,'2025-04-02'),($1,'Pharmacy','Synthetic medication',100,'2025-04-02'),
      ($2,'Consultation','Synthetic visit',100,'2025-04-03'),($3,'Other','Voided',1000,'2025-04-02')`,
      [bill, draft, voided],
    );
    const payment = await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES
      ($1,$3,'Cash',80,'Synthetic','2025-04-03'),($1,$4,'Cash',30,'Synthetic','2025-04-04'),
      ($1,$5,'Cash',10,'Synthetic','2025-03-15'),($2,$6,'Cash',50,'Synthetic','2025-04-06') RETURNING id`,
      [bill, voided, `DR1-${suffix}`, `DR2-${suffix}`, `DR3-${suffix}`, `DRV-${suffix}`],
    );
    await pool.query(
      `INSERT INTO billing_refunds(tenant_id,facility_id,invoice_id,payment_id,refund_number,amount,refund_method,reason,manual_confirmation,idempotency_key,request_hash,actor_user_id,created_at)
      VALUES($1,$2,$3,$4,$5,20,'CASH','Synthetic refund',true,$6,'synthetic-hash',$7,'2025-04-07')`,
      [tenant, facility, bill, payment.rows[0].id, `DREF-${suffix}`, `refund-${suffix}`, manager],
    );
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,fee) VALUES($1,$2,$3,'Synthetic Consultation','OPD',100)",
      [tenant, facility, `DSVC-${suffix}`],
    );
    await pool.query(
      "INSERT INTO audit_logs(tenant_id,facility_id,action,resource,details,timestamp) VALUES($1,$2,'CREATE','Patient','DO-NOT-EXPOSE-PRIVATE-DETAIL','2025-04-05 11:00')",
      [tenant, facility],
    );
    const tomorrow = addCalendarDays(kenyaToday(), 1);
    await pool.query(
      `INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,appointment_type,status) VALUES
      ($1,$2,$3,$5,'Synthetic Visit','Scheduled'),($1,$2,$4,$6,'Synthetic Visit','Scheduled'),($1,$7,$4,$5,'Other','Scheduled'),($1,$2,$3,$6,'Cancelled','Cancelled')`,
      [
        tenant,
        facility,
        patient,
        siblingPatient,
        `${tomorrow} 09:00`,
        `${tomorrow} 10:00`,
        sibling,
      ],
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('requires a live session and rejects foreign facilities, missing permission, and malformed ranges', async () => {
    expect((await call('GET', overview())).status).toBe(401);
    expect((await call('GET', overview(), expired)).status).toBe(401);
    expect((await call('GET', overview(), noAccess)).status).toBe(403);
    expect((await call('GET', overview(sibling), token)).status).toBe(403);
    expect((await call('GET', overview(facility), foreign)).status).toBe(403);
    expect((await call('GET', overview(facility, '2025-02-29', '2025-03-01'), token)).status).toBe(
      400,
    );
    expect((await call('GET', overview(facility, '2025-04-30', '2025-04-01'), token)).status).toBe(
      400,
    );
    expect((await call('GET', overview(facility, '2024-01-01', '2025-01-01'), token)).status).toBe(
      400,
    );
    await expect(
      resolveDashboardFacility(
        {
          userId: 1,
          tenantId: null,
          facilityId: null,
          roles: ['SUPER_ADMIN'],
          permissions: ['billing.read'],
          isSuperAdmin: true,
        },
        facility,
      ),
    ).rejects.toMatchObject({ code: 'FACILITY_ACCOUNT_REQUIRED' });
  });

  it('uses actual dated registrations, distinct flow, non-void invoice lines, receipts and recorded refunds', async () => {
    const result = await call('GET', overview(), token);
    expect(result.status).toBe(200);
    expect(result.body.registrations).toMatchObject({
      status: 'ok',
      data: { current: 1, previous: 0, totalThroughEnd: 2 },
    });
    expect(result.body.admissions).toMatchObject({
      status: 'ok',
      data: { current: 1, previous: 0 },
    });
    expect(result.body.invoices).toMatchObject({
      status: 'ok',
      data: { current: 2, billed: '400.00', recordedBalance: '300.00', finalized: 0 },
    });
    expect(result.body.invoices.data.categories).toEqual(
      expect.arrayContaining([
        { label: 'Laboratory', amount: '200.00' },
        { label: 'Consultation', amount: '100.00' },
        { label: 'Pharmacy', amount: '100.00' },
      ]),
    );
    expect(result.body.receipts).toMatchObject({
      status: 'ok',
      data: { gross: '160.00', refunds: '20.00', net: '140.00', previousNet: '10.00' },
    });
    const first = result.body.flow.data[0];
    expect(first).toMatchObject({
      start: '2025-04-01',
      end: '2025-04-05',
      registered: 1,
      returning: 1,
    });
    expect(JSON.stringify(result.body.activity)).not.toContain('DO-NOT-EXPOSE');
    expect(result.body.activity.data).toHaveLength(1);
    // Audit times are timestamp-without-time-zone: preserve the stored wall clock, not an invented UTC shift.
    expect(result.body.activity.data[0].at).toBe('2025-04-05T11:00:00');
    const march = await call('GET', overview(facility, '2025-03-01', '2025-03-31'), token);
    expect(march.body.receipts.data.net).toBe('10.00');
    expect(march.body.invoices.data.current).toBe(0);
  });

  it('treats restricted and disabled modules as unavailable, never as zero', async () => {
    const restricted = await call('GET', overview(), limited);
    expect(restricted.status).toBe(200);
    expect(restricted.body.registrations.status).toBe('ok');
    expect(restricted.body.receipts.status).toBe('restricted');
    expect(restricted.body.flow.status).toBe('restricted');
    expect(restricted.body.appointments.status).toBe('restricted');
    await pool.query('UPDATE facilities SET hidden_modules=\'["finance"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    try {
      const disabled = await call('GET', overview(), token);
      expect(disabled.body.receipts.status).toBe('disabled');
      expect(disabled.body.invoices.status).toBe('disabled');
      expect(disabled.body.registrations.status).toBe('ok');
    } finally {
      await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
    }
  });

  it('limits upcoming appointments by facility and masks patients registered elsewhere', async () => {
    const tomorrow = addCalendarDays(kenyaToday(), 1);
    const result = await call('GET', overview(facility, tomorrow, tomorrow), token);
    expect(result.status).toBe(200);
    expect(result.body.appointments.status).toBe('ok');
    expect(result.body.appointments.data).toHaveLength(2);
    expect(result.body.appointments.data[0].patientName).toContain('Synthetic New');
    expect(result.body.appointments.data[1].patientName).toBe('Patient details restricted');
    expect(JSON.stringify(result.body.appointments)).not.toContain('Synthetic Sibling');
  });

  it('reports an invalid displayed appointment date rather than presenting it as a real schedule', async () => {
    const year = Number(kenyaToday().slice(0, 4)) + 1;
    await pool.query(
      "INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,appointment_type,status) VALUES($1,$2,$3,$4,'Synthetic invalid time','Scheduled')",
      [tenant, facility, patient, `${year}-02-30 10:00`],
    );
    const result = await call('GET', overview(facility, `${year}-02-01`, `${year}-03-01`), token);
    expect(result.status).toBe(200);
    expect(result.body.appointments.status).toBe('error');
  });

  it('searches only authorized facility records, audits patient results, and keeps restricted kinds explicit', async () => {
    expect(
      (
        await call('POST', '/api/dashboard/search', token, {
          facilityId: sibling,
          term: 'Synthetic',
        })
      ).status,
    ).toBe(403);
    const result = await call('POST', '/api/dashboard/search', token, {
      facilityId: facility,
      term: 'Synthetic',
    });
    expect(result.status).toBe(200);
    expect(result.body.patients).toHaveLength(2);
    expect(result.body.services).toHaveLength(1);
    expect(JSON.stringify(result.body)).not.toContain('Synthetic Sibling');
    const audit = await pool.query(
      "SELECT count(*)::int AS count FROM patient_record_access_logs WHERE user_id=$1 AND record_type='DIRECTORY_SEARCH'",
      [manager],
    );
    expect(audit.rows[0].count).toBe(2);
    const patientOnly = await call('POST', '/api/dashboard/search', limited, {
      facilityId: facility,
      term: 'Synthetic',
    });
    expect(patientOnly.body.available).toEqual({
      patients: true,
      invoices: false,
      services: false,
    });
    const wildcard = await call('POST', '/api/dashboard/search', token, {
      facilityId: facility,
      term: '%%',
    });
    expect(wildcard.body.patients).toEqual([]);
  });
});
