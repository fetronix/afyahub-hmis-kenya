import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { sealPatientIdentifiers } from '../../security/patient-identifiers.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Phase 2 patient directory (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, foreignTenant: number, facility: number, other: number, foreign: number;
  let actor: number, allowed: string, otherToken: string, foreignToken: string;
  let tenantToken: string, noPermission: string, platformToken: string;
  let originalIds: number[];
  const syntheticNationalId = `synthetic-national-${suffix}`;
  const legacyNationalId = `synthetic-legacy-${suffix}`;
  const syntheticPhone = `synthetic-phone-${suffix}`;
  let base: string, close: () => Promise<void>;
  const call = (body: Record<string, unknown>, token?: string) =>
    httpJson(base, 'POST', '/api/patients/directory-page', token ? { token, body } : { body });
  const page = (token = allowed, extra: Record<string, unknown> = {}) =>
    call({ tenantId: tenant, facilityId: facility, search: `P2-A-${suffix}-`, ...extra }, token);

  async function user(t: number, f: number | null, label: string, permission: boolean) {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic directory staff',$3,'ACTIVE',$4,$5) RETURNING id`,
        [
          `p2-directory-${label}-${suffix}`,
          `p2-directory-${label}-${suffix}@example.test`,
          randomBytes(24).toString('hex'),
          t,
          f,
        ],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [t, `P2_DIRECTORY_${label}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    if (permission)
      await pool.query(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='patients.read'`,
        [role],
      );
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }

  async function platformUser() {
    const found = await pool.query(
      "SELECT id FROM roles WHERE tenant_id IS NULL AND name='SUPER_ADMIN' AND is_active=true LIMIT 1",
    );
    const superRole =
      found.rows[0]?.id ??
      (
        await pool.query(
          "INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id",
        )
      ).rows[0].id;
    const permissionRole = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,$1,true) RETURNING id',
        [`P2_DIRECTORY_PLATFORM_${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='patients.read'",
      [permissionRole],
    );
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic platform staff',$3,'ACTIVE',NULL,NULL) RETURNING id`,
        [
          `p2-directory-platform-${suffix}`,
          `p2-directory-platform-${suffix}@example.test`,
          randomBytes(24).toString('hex'),
        ],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2),($1,$3)', [
      id,
      superRole,
      permissionRole,
    ]);
    return (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
  }

  beforeAll(async () => {
    [tenant, foreignTenant] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic directory ${suffix}`,
        `p2-dir-${suffix}`,
        `Synthetic foreign directory ${suffix}`,
        `p2-dir-x-${suffix}`,
      ])
    ).rows.map((row) => row.id as number);
    [facility, other] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
       VALUES($1,$2,'Synthetic directory A',$4::jsonb),($1,$3,'Synthetic directory B',$4::jsonb) RETURNING id`,
        [tenant, `P2-DA-${suffix}`, `P2-DB-${suffix}`, JSON.stringify(['registration'])],
      )
    ).rows.map((row) => row.id as number);
    foreign = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic directory X',$3::jsonb) RETURNING id`,
        [foreignTenant, `P2-DX-${suffix}`, JSON.stringify(['registration'])],
      )
    ).rows[0].id;
    originalIds = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       SELECT $1,$2,$3 || n::text,'Synthetic','Directory','2000-01-01','Other' FROM generate_series(1,63) AS n RETURNING id`,
        [tenant, facility, `P2-A-${suffix}-`],
      )
    ).rows.map((row) => row.id as number);
    const sealed = sealPatientIdentifiers({ nationalId: syntheticNationalId });
    await pool.query(
      'UPDATE patients SET national_id=$1,national_id_bidx=$2,phone=$3 WHERE id=$4',
      [sealed.nationalId, sealed.nationalIdBlindIndex, syntheticPhone, originalIds[0]],
    );
    await pool.query('UPDATE patients SET national_id=$1,national_id_bidx=NULL WHERE id=$2', [
      legacyNationalId,
      originalIds[1],
    ]);
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$3,'Synthetic','Other facility','2000-01-01','Other'),
             ($4,$5,$6,'Synthetic','Other tenant','2000-01-01','Other')`,
      [tenant, other, `P2-B-${suffix}`, foreignTenant, foreign, `P2-X-${suffix}`],
    );
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES('patients.read','patients.read','synthetic') ON CONFLICT(code) DO NOTHING",
    );
    const main = await user(tenant, facility, 'main', true);
    actor = main.id;
    allowed = main.token;
    otherToken = (await user(tenant, other, 'other', true)).token;
    foreignToken = (await user(foreignTenant, foreign, 'foreign', true)).token;
    tenantToken = (await user(tenant, null, 'tenant', true)).token;
    noPermission = (await user(tenant, facility, 'limited', false)).token;
    platformToken = await platformUser();
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('browses more than fifty real scoped records without duplicate or missing IDs', async () => {
    const first = await page();
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(25);
    expect(typeof first.body.nextCursor).toBe('number');
    const second = await page(allowed, { beforeId: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(25);
    const third = await page(allowed, { beforeId: second.body.nextCursor });
    expect(third.status).toBe(200);
    expect(third.body.items).toHaveLength(13);
    expect(third.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map(
      (p: { id: number }) => p.id,
    );
    expect(new Set(ids).size).toBe(63);
    expect(originalIds.every((id) => ids.includes(id))).toBe(true);
    const oldId = originalIds[0];
    const selected = await httpJson(base, 'GET', `/api/patients/${oldId}`, { token: allowed });
    expect(selected.status).toBe(200);
    expect(selected.body.id === oldId).toBe(true);
  });

  it('searches by an identifier beyond the first page without returning other scopes', async () => {
    const response = await page(allowed, { search: `P2-A-${suffix}-1` });
    expect(response.status).toBe(200);
    expect(response.body.items.some((p: { id: number }) => p.id === originalIds[0])).toBe(true);
    expect(
      response.body.items.every(
        (p: { tenantId: number; registrationFacilityId: number }) =>
          p.tenantId === tenant && p.registrationFacilityId === facility,
      ),
    ).toBe(true);
  });

  it('finds exact national ID and phone matches beyond the first page without inferring duplicates', async () => {
    for (const [exactMatch, search] of [
      ['nationalId', syntheticNationalId],
      ['phone', syntheticPhone],
    ] as const) {
      const match = await page(allowed, { exactMatch, search });
      expect(match.status).toBe(200);
      expect(match.body.items).toHaveLength(1);
      expect(match.body.items[0].id === originalIds[0]).toBe(true);
      const foreignResult = await call(
        { tenantId: tenant, facilityId: other, exactMatch, search },
        otherToken,
      );
      expect(foreignResult.status).toBe(200);
      expect(foreignResult.body.items).toHaveLength(0);
    }
    const legacy = await page(allowed, { exactMatch: 'nationalId', search: legacyNationalId });
    expect(legacy.status).toBe(200);
    expect(legacy.body.items).toHaveLength(1);
    expect(legacy.body.items[0].id === originalIds[1]).toBe(true);
    const legacySearch = await page(allowed, { search: legacyNationalId });
    expect(legacySearch.status).toBe(200);
    expect(legacySearch.body.items.some((p: { id: number }) => p.id === originalIds[1])).toBe(true);
    const byId = await page(allowed, { patientId: originalIds[0] });
    expect(byId.status).toBe(200);
    expect(byId.body.items).toHaveLength(1);
    expect(byId.body.items[0].id === originalIds[0]).toBe(true);
    const outsideFacility = await call(
      { tenantId: tenant, facilityId: other, patientId: originalIds[0] },
      otherToken,
    );
    expect(outsideFacility.status).toBe(200);
    expect(outsideFacility.body.items).toHaveLength(0);
    expect((await page(allowed, { patientId: -1 })).status).toBe(400);
    expect((await page(allowed, { exactMatch: 'phone', search: '' })).status).toBe(400);
    expect(
      (await page(allowed, { exactMatch: 'unsupported', search: syntheticPhone })).status,
    ).toBe(400);
  });

  it('enforces authentication, permission, tenant and facility boundaries for every page', async () => {
    expect((await call({ tenantId: tenant, facilityId: facility })).status).toBe(401);
    expect((await page(noPermission)).status).toBe(403);
    expect((await page(otherToken)).status).toBe(403);
    expect((await page(foreignToken)).status).toBe(403);
    expect((await page(tenantToken)).status).toBe(200);
    expect((await page(platformToken)).status).toBe(200);
    expect((await page(platformToken, { tenantId: foreignTenant })).status).toBe(403);
    const otherList = await call(
      { tenantId: tenant, facilityId: other, search: `P2-A-${suffix}-` },
      otherToken,
    );
    expect(otherList.status).toBe(200);
    expect(otherList.body.items).toHaveLength(0);
    expect((await page(allowed, { beforeId: -1 })).status).toBe(400);
    expect((await page(allowed, { beforeId: 'not-a-cursor' })).status).toBe(400);
  });

  it('writes a scoped, patient-specific access record for every returned patient', async () => {
    const before = Number(
      (
        await pool.query(
          "SELECT count(*) FROM patient_record_access_logs WHERE user_id=$1 AND record_type='PatientDirectory'",
          [actor],
        )
      ).rows[0].count,
    );
    const response = await page();
    const rows = (
      await pool.query(
        "SELECT patient_id,tenant_id,facility_id,purpose FROM patient_record_access_logs WHERE user_id=$1 AND record_type='PatientDirectory' ORDER BY id DESC LIMIT 25",
        [actor],
      )
    ).rows;
    const after = Number(
      (
        await pool.query(
          "SELECT count(*) FROM patient_record_access_logs WHERE user_id=$1 AND record_type='PatientDirectory'",
          [actor],
        )
      ).rows[0].count,
    );
    expect(response.status).toBe(200);
    expect(after - before).toBe(25);
    expect(
      rows.every(
        (r) => r.tenant_id === tenant && r.facility_id === facility && r.purpose === 'DIRECT_CARE',
      ),
    ).toBe(true);
    expect(
      response.body.items.every((p: { id: number }) => rows.some((r) => r.patient_id === p.id)),
    ).toBe(true);
  });

  it('fails closed without exposing a page if access auditing fails', async () => {
    const fn = `p2_dir_audit_fail_${suffix}`;
    const trigger = `p2_dir_audit_trigger_${suffix}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.user_id=${actor} AND NEW.record_type='PatientDirectory' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON patient_record_access_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const response = await page();
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('PATIENT_DIRECTORY_FAILED');
      expect(response.body.items).toBeUndefined();
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON patient_record_access_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
  });
});
