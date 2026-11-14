import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Phase 1 FHIR facility-module gate (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, foreignTenant: number, enabled: number, disabled: number, foreign: number;
  let patient: number, otherPatient: number, foreignPatient: number;
  let allowedToken: string,
    disabledToken: string,
    noPermissionToken: string,
    tenantToken: string,
    platformToken: string;
  let base: string, close: () => Promise<void>;

  async function user(facility: number | null, label: string, permissions: string[]) {
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `SYN-P1-${label}-${suffix}`],
      )
    ).rows[0].id;
    for (const permission of permissions) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING`,
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, permission],
      );
    }
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic staff',$3,'ACTIVE',$4,$5) RETURNING id`,
        [
          `syn-p1-${label}-${suffix}`,
          `syn-p1-${label}-${suffix}@example.test`,
          randomBytes(24).toString('hex'),
          tenant,
          facility,
        ],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    return (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
  }

  async function platformUser() {
    const existing = await pool.query(
      "SELECT id FROM roles WHERE tenant_id IS NULL AND name='SUPER_ADMIN' AND is_active=true LIMIT 1",
    );
    const platformRole =
      existing.rows[0]?.id ??
      (
        await pool.query(
          "INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id",
        )
      ).rows[0].id;
    const permissionRole = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,$1,true) RETURNING id',
        [`SYN-P1-PLATFORM-FHIR-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='interop.fhir.patient.read'",
      [permissionRole],
    );
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic platform staff',$3,'ACTIVE',NULL,NULL) RETURNING id`,
        [
          `syn-p1-platform-${suffix}`,
          `syn-p1-platform-${suffix}@example.test`,
          randomBytes(24).toString('hex'),
        ],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2),($1,$3)', [
      id,
      platformRole,
      permissionRole,
    ]);
    return (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
  }

  async function newPatient(tenantId: number, facilityId: number, label: string) {
    return (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic',$4,'2000-01-01','Other') RETURNING id`,
        [tenantId, facilityId, `SYN-FHIR-${label}-${suffix}`, label],
      )
    ).rows[0].id as number;
  }
  const call = (path: string, token?: string) =>
    httpJson(base, 'GET', path, token ? { token } : {});

  beforeAll(async () => {
    [tenant, foreignTenant] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic FHIR ${suffix}`,
        `syn-fhir-${suffix}`,
        `Synthetic foreign FHIR ${suffix}`,
        `syn-fhir-x-${suffix}`,
      ])
    ).rows.map((row) => row.id as number);
    enabled = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic enabled',$3::jsonb) RETURNING id`,
        [tenant, `FHIR-E-${suffix}`, JSON.stringify(['interoperability'])],
      )
    ).rows[0].id;
    disabled = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic disabled',$3::jsonb) RETURNING id`,
        [tenant, `FHIR-D-${suffix}`, JSON.stringify(['public_health'])],
      )
    ).rows[0].id;
    foreign = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic foreign',$3::jsonb) RETURNING id`,
        [foreignTenant, `FHIR-X-${suffix}`, JSON.stringify(['interoperability'])],
      )
    ).rows[0].id;
    patient = await newPatient(tenant, enabled, 'A');
    otherPatient = await newPatient(tenant, disabled, 'B');
    foreignPatient = await newPatient(foreignTenant, foreign, 'C');
    allowedToken = await user(enabled, 'allowed', ['interop.fhir.patient.read', 'reports.read']);
    disabledToken = await user(disabled, 'disabled', ['interop.fhir.patient.read', 'reports.read']);
    noPermissionToken = await user(enabled, 'limited', ['reports.read']);
    tenantToken = await user(null, 'tenant', ['interop.fhir.patient.read']);
    platformToken = await platformUser();
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('permits a scoped patient only for a permitted session and enabled module', async () => {
    const path = `/api/interop/fhir/patient/${patient}`;
    expect((await call(path)).status).toBe(401);
    expect((await call(path, noPermissionToken)).status).toBe(403);
    const allowed = await call(path, allowedToken);
    expect(allowed.status).toBe(200);
    expect(allowed.body.id).toBe(`ke-hmis-${patient}`);
    const blocked = await call(`/api/interop/fhir/patient/${otherPatient}`, disabledToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('FACILITY_MODULE_DISABLED');
  });

  it('denies cross-facility and cross-tenant patient IDs and facility overrides', async () => {
    // Existing scoped-patient lookup reports scope violations as 403.
    expect((await call(`/api/interop/fhir/patient/${otherPatient}`, allowedToken)).status).toBe(
      403,
    );
    expect((await call(`/api/interop/fhir/patient/${foreignPatient}`, allowedToken)).status).toBe(
      403,
    );
    expect(
      (await call(`/api/interop/fhir/patient/${patient}?facilityId=${disabled}`, allowedToken))
        .status,
    ).toBe(403);
  });

  it('binds tenant-wide users to the same facility used by the module gate', async () => {
    expect((await call(`/api/interop/fhir/patient/${patient}`, tenantToken)).status).toBe(403);
    expect(
      (await call(`/api/interop/fhir/patient/${patient}?facilityId=${enabled}`, tenantToken))
        .status,
    ).toBe(200);
    // A disabled facility's patient cannot be reached by selecting an enabled one.
    expect(
      (await call(`/api/interop/fhir/patient/${otherPatient}?facilityId=${enabled}`, tenantToken))
        .status,
    ).toBe(404);
    const disabledFacility = await call(
      `/api/interop/fhir/patient/${otherPatient}?facilityId=${disabled}`,
      tenantToken,
    );
    expect(disabledFacility.status).toBe(403);
    expect(disabledFacility.body.error).toBe('FACILITY_MODULE_DISABLED');
    expect(
      (await call(`/api/interop/fhir/patient/${foreignPatient}?facilityId=${enabled}`, tenantToken))
        .status,
    ).toBe(403);
  });

  it('requires a target facility for platform users and binds each patient to it', async () => {
    expect((await call(`/api/interop/fhir/patient/${patient}`, platformToken)).status).toBe(403);
    expect(
      (await call(`/api/interop/fhir/patient/${patient}?facilityId=${enabled}`, platformToken))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/interop/fhir/patient/${foreignPatient}?facilityId=${enabled}`,
          platformToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          `/api/interop/fhir/patient/${foreignPatient}?facilityId=${foreign}`,
          platformToken,
        )
      ).status,
    ).toBe(200);
    const disabledFacility = await call(
      `/api/interop/fhir/patient/${otherPatient}?facilityId=${disabled}`,
      platformToken,
    );
    expect(disabledFacility.status).toBe(403);
    expect(disabledFacility.body.error).toBe('FACILITY_MODULE_DISABLED');
  });

  it('does not apply the FHIR module switch to the separate MOH route', async () => {
    const response = await call('/api/interop/dha/moh-705', disabledToken);
    expect(response.status).toBe(501);
    expect(response.body.error).toBe('MOH705_REPORT_NOT_IMPLEMENTED');
  });
});
