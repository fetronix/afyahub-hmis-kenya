/**
 * Cross-tenant and cross-facility access sweep, over real HTTP.
 *
 * Batch 10 asks for a project-wide tenancy pass. Reading `tenantId` in a query
 * proves a column was named; it does not prove the endpoint refuses a foreign
 * identifier. This suite signs two real sessions, gives each user **every**
 * permission in the database (so a refusal can only be about tenancy, never
 * about RBAC), creates synthetic rows for tenant A, and then asks for them as
 * tenant B — and also as a second facility inside tenant A, which catches
 * tenant-only checks that forgot the facility boundary.
 *
 * Every fixture is synthetic. No real patient, staff or financial record.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { describeDb, testPool } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('cross-tenant and cross-facility access sweep (synthetic PostgreSQL)', () => {
  const pool = testPool();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);

  let tenantA: number;
  let tenantB: number;
  let facilityA: number;
  let facilityA2: number;
  let facilityB: number;
  let userA: number;
  let userA2: number;
  let userB: number;
  let tokenA: string;
  let tokenA2: string;
  let tokenB: string;
  let base: string;
  let close: () => Promise<void>;

  let patientA: number;
  let encounterA: number;
  let employeeA: number;
  let claimA: number;
  let paymentA: number;
  let invoiceA: number;

  const get = (path: string, token: string) => httpJson(base, 'GET', path, { token });
  const send = (method: string, path: string, token: string, body?: unknown) =>
    httpJson(base, method, path, { token, body });

  beforeAll(async () => {
    const tenants = await pool.query(
      `INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`,
      [
        'Synthetic tenancy tenant A',
        `tenancy-a-${suffix}`,
        'Synthetic tenancy tenant B',
        `tenancy-b-${suffix}`,
      ],
    );
    tenantA = tenants.rows[0].id;
    tenantB = tenants.rows[1].id;

    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,enabled_modules)
       VALUES($1,$2,'Synthetic A','Level 4',$5,'["registration","insurance","hr","billing","clinical","audit"]'::jsonb),
             ($1,$3,'Synthetic A second site','Level 4',$6,'["registration","insurance","hr","billing","clinical","audit"]'::jsonb),
             ($4,$7,'Synthetic B','Level 4',$8,'["registration","insurance","hr","billing","clinical"]'::jsonb)
       RETURNING id`,
      [
        tenantA,
        `TEN-A-${suffix}`,
        `TEN-A2-${suffix}`,
        tenantB,
        `MFL-TENA-${suffix}`,
        `MFL-TENA2-${suffix}`,
        `TEN-B-${suffix}`,
        `MFL-TENB-${suffix}`,
      ],
    );
    facilityA = facilities.rows[0].id;
    facilityA2 = facilities.rows[1].id;
    facilityB = facilities.rows[2].id;

    const makeUser = async (label: string, tenantId: number, facilityId: number) =>
      (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic staff','test-only','ACTIVE',$3,$4) RETURNING id`,
          [
            `tenancy-${label}-${suffix}`,
            `tenancy-${label}-${suffix}@example.test`,
            tenantId,
            facilityId,
          ],
        )
      ).rows[0].id as number;

    userA = await makeUser('a', tenantA, facilityA);
    userA2 = await makeUser('a2', tenantA, facilityA2);
    userB = await makeUser('b', tenantB, facilityB);

    /*
     * Every permission the product defines, taken from the seed itself rather
     * than from whatever a previous run happened to leave in the table. The
     * probes below must fail on scope, never on RBAC: a role that quietly lacks
     * a permission would make this suite pass for the wrong reason, and reading
     * the catalogue keeps the grant in step with the product.
     */
    const seedSource = readFileSync(
      resolve(import.meta.dirname, '..', '..', 'seeds', 'permissions.ts'),
      'utf8',
    );
    const allPermissions = [
      ...new Set([...seedSource.matchAll(/code: '([^']+)'/g)].map((m) => m[1])),
    ];
    expect(allPermissions.length).toBeGreaterThan(50);
    await pool.query(
      `INSERT INTO permissions(code,name,module)
       SELECT code, code, 'tenancy-sweep' FROM unnest($1::text[]) AS code
       ON CONFLICT (code) DO NOTHING`,
      [allPermissions],
    );

    for (const [tenantId, userId, label] of [
      [tenantA, userA, 'A'],
      [tenantA, userA2, 'A2'],
      [tenantB, userB, 'B'],
    ] as const) {
      const roleId = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenantId, `TENANCY-ALL-${label}-${suffix}`],
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO role_permissions(role_id,permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [roleId, allPermissions],
      );
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, roleId]);
    }

    [tokenA, tokenA2, tokenB] = await Promise.all(
      [userA, userA2, userB].map(
        async (userId) => (await createSession({ userId, securityVersion: 1 })).sessionToken,
      ),
    );

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    patientA = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Tenant A patient','1985-02-03','Female') RETURNING id`,
        [tenantA, facilityA, `TEN-PAT-A-${suffix}`],
      )
    ).rows[0].id;

    encounterA = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
         VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id`,
        [tenantA, facilityA, patientA],
      )
    ).rows[0].id;

    employeeA = (
      await pool.query(
        `INSERT INTO hr_employees(tenant_id,facility_id,employee_number,first_name,last_name,hire_date)
         VALUES($1,$2,$3,'Synthetic','Worker A','2024-01-15') RETURNING id`,
        [tenantA, facilityA, `TEN-EMP-A-${suffix}`],
      )
    ).rows[0].id;

    invoiceA = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status)
         VALUES($1,$2,$3,$4,'2500.00','0.00','2500.00','Pending') RETURNING id`,
        [tenantA, facilityA, patientA, `TEN-INV-A-${suffix}`],
      )
    ).rows[0].id;

    claimA = (
      await pool.query(
        `INSERT INTO insurance_claims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_amount,status)
         VALUES($1,$2,$3,$4,$5,'2500.00','Draft') RETURNING id`,
        [tenantA, facilityA, patientA, invoiceA, `TEN-CLM-A-${suffix}`],
      )
    ).rows[0].id;

    await pool.query(
      `INSERT INTO insurance_claim_items(claim_id,description,amount)
       VALUES($1,'Synthetic consultation','2500.00')`,
      [claimA],
    );

    paymentA = (
      await pool.query(
        `INSERT INTO billing_payments(invoice_id,receipt_number,amount,payment_method,cashier_name,payment_date)
         VALUES($1,$2,'500.00','CASH','Synthetic cashier','2026-10-01') RETURNING id`,
        [invoiceA, `TEN-RCPT-A-${suffix}`],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await close?.();
  });

  it('lets the owning facility read its own records (positive control)', async () => {
    const patient = await get(`/api/patients/${patientA}`, tokenA);
    expect(patient.status).toBe(200);
    expect(patient.body.mrn).toBe(`TEN-PAT-A-${suffix}`);

    const employee = await get(`/api/hr/employees/${employeeA}`, tokenA);
    expect(employee.status).toBe(200);
    expect(employee.body.employeeNumber).toBe(`TEN-EMP-A-${suffix}`);

    const claimItems = await get(`/api/claims/${claimA}/items`, tokenA);
    expect(claimItems.status).toBe(200);
  });

  it('refuses a patient record across tenants and across facilities in the same tenant', async () => {
    for (const token of [tokenB, tokenA2]) {
      const read = await get(`/api/patients/${patientA}`, token);
      expect([403, 404]).toContain(read.status);
      expect(JSON.stringify(read.body)).not.toContain('Tenant A patient');

      const write = await send('PUT', `/api/patients/${patientA}`, token, {
        firstName: 'CrossTenantOverwrite',
      });
      expect([403, 404]).toContain(write.status);
    }

    const row = await pool.query('SELECT first_name FROM patients WHERE id=$1', [patientA]);
    expect(row.rows[0].first_name).toBe('Synthetic');
  });

  it('never returns another facility row from a list endpoint', async () => {
    const listA2 = await get('/api/patients', tokenA2);
    expect(listA2.status).toBe(200);
    expect(JSON.stringify(listA2.body)).not.toContain(`TEN-PAT-A-${suffix}`);

    // Asking for another facility by query parameter must be refused, not
    // silently ignored in a way that returns the other facility's rows.
    const forced = await get(`/api/patients?facilityId=${facilityA}`, tokenA2);
    expect([200, 403]).toContain(forced.status);
    if (forced.status === 200)
      expect(JSON.stringify(forced.body)).not.toContain(`TEN-PAT-A-${suffix}`);

    const encounters = await get(`/api/encounters?patientId=${patientA}`, tokenB);
    expect([200, 403]).toContain(encounters.status);
    expect(JSON.stringify(encounters.body)).not.toContain(`TEN-PAT-A-${suffix}`);
  });

  it('refuses an encounter update across tenants or facilities', async () => {
    for (const token of [tokenB, tokenA2]) {
      const res = await send('PUT', `/api/encounters/${encounterA}`, token, {
        notes: 'cross-tenant write',
      });
      expect([403, 404]).toContain(res.status);
    }
    const row = await pool.query('SELECT status FROM encounters WHERE id=$1', [encounterA]);
    expect(row.rows[0].status).toBe('ACTIVE');
  });

  it('refuses HR employee reads and status changes across tenants or facilities', async () => {
    for (const token of [tokenB, tokenA2]) {
      const read = await get(`/api/hr/employees/${employeeA}`, token);
      expect(read.status).toBe(404);
      expect(JSON.stringify(read.body)).not.toContain(`TEN-EMP-A-${suffix}`);

      const change = await send('POST', `/api/hr/employees/${employeeA}/status`, token, {
        status: 'SUSPENDED',
      });
      expect([403, 404]).toContain(change.status);
    }
    const row = await pool.query('SELECT employment_status FROM hr_employees WHERE id=$1', [
      employeeA,
    ]);
    expect(row.rows[0].employment_status).toBe('ACTIVE');
  });

  it('refuses insurance claim reads and submissions across tenants or facilities', async () => {
    for (const token of [tokenB, tokenA2]) {
      const items = await get(`/api/claims/${claimA}/items`, token);
      expect(items.status).toBe(404);
      expect(JSON.stringify(items.body)).not.toContain('Synthetic consultation');

      const submit = await send('POST', `/api/claims/${claimA}/submit`, token, {});
      expect([400, 403, 404]).toContain(submit.status);
    }
    const row = await pool.query('SELECT status FROM insurance_claims WHERE id=$1', [claimA]);
    expect(row.rows[0].status).toBe('Draft');
  });

  it('refuses to list another facility payment ledger, even with a facilityId parameter', async () => {
    const forcedList = await get(`/api/billing/payments?facilityId=${facilityA}`, tokenB);
    expect([200, 403]).toContain(forcedList.status);
    expect(JSON.stringify(forcedList.body)).not.toContain(`TEN-RCPT-A-${suffix}`);

    const byInvoice = await get(`/api/billing/payments?invoiceId=${invoiceA}`, tokenB);
    expect([200, 403, 404]).toContain(byInvoice.status);
    expect(JSON.stringify(byInvoice.body)).not.toContain(String(paymentA));

    // Owning facility still sees its own ledger row.
    const own = await get(`/api/billing/payments?facilityId=${facilityA}`, tokenA);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain(`TEN-RCPT-A-${suffix}`);
  });

  it('never returns another facility audit trail, and refuses to ask for one', async () => {
    // A distinctive action only tenant A can have produced.
    const marker = `TEN-${suffix}-AUDIT`;
    await pool.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
       VALUES($1,$2,'tenancy-synthetic','SYNTHETIC_TENANCY_MARKER','synthetic',$4,$3)`,
      [tenantA, facilityA, marker, suffix],
    );

    // Same tenant, other facility: the explicit parameter is refused.
    const crossFacility = await get(`/api/audit-logs?facilityId=${facilityA}`, tokenA2);
    expect(crossFacility.status).toBe(403);
    expect(JSON.stringify(crossFacility.body)).not.toContain(marker);

    // Other tenant: refused, and the marker never appears.
    const crossTenant = await get(`/api/audit-logs?facilityId=${facilityA}`, tokenB);
    expect([403, 404]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toContain(marker);

    // Tenant B's facility does not have the audit module enabled at all, so it is
    // refused before tenancy is even consulted: permissions alone are not enough.
    const crossTenantUnscoped = await get('/api/audit-logs', tokenB);
    expect(crossTenantUnscoped.status).toBe(403);
    expect(crossTenantUnscoped.body.error).toBe('FACILITY_MODULE_DISABLED');
    expect(JSON.stringify(crossTenantUnscoped.body)).not.toContain(marker);

    // Owning facility sees its own trail.
    const own = await get('/api/audit-logs', tokenA);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain(marker);
  });

  it('refuses a facility-scoped request that names another facility explicitly', async () => {
    const res = await get(`/api/hr/employees/${employeeA}?facilityId=${facilityA}`, tokenA2);
    expect([403, 404]).toContain(res.status);

    const crossTenant = await get(`/api/hr/employees/${employeeA}?facilityId=${facilityA}`, tokenB);
    expect([403, 404]).toContain(crossTenant.status);
  });
});
