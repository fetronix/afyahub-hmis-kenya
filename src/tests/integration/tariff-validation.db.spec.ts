/** Scoped tariff validation against synthetic PostgreSQL and HTTP. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import type { FacilityTariffValidation } from '../../types/index.ts';
import { createSession } from '../../auth/session.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Facility tariff validation', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number,
    facility: number,
    other: number,
    token: string,
    noPermission: string,
    foreign: string,
    base: string,
    close: () => Promise<void>;
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic tariffs ${suffix}`,
        `tariffs-${suffix}`,
      ])
    ).rows[0].id;
    [facility, other] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic tariff A',$4::jsonb),($1,$3,'Synthetic tariff B',$4::jsonb) RETURNING id`,
        [
          tenant,
          `TA-${suffix}`,
          `TB-${suffix}`,
          JSON.stringify(['finance', 'laboratory', 'inpatient', 'pharmacy']),
        ],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES('tariffs.read','tariffs.read','finance') ON CONFLICT(code) DO NOTHING",
    );
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='tariffs.read'",
      [role],
    );
    const actor = async (tag: string, fac: number, addRole: boolean) => {
      const uid = `tariff-${tag}-${suffix}`;
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic tariff user','test-only','ACTIVE',$3,$4) RETURNING id",
          [uid, `${uid}@example.test`, tenant, fac],
        )
      ).rows[0].id;
      if (addRole)
        await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      return (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
    };
    token = await actor('a', facility, true);
    foreign = await actor('b', other, true);
    noPermission = await actor('none', facility, false);
    await pool.query(
      "INSERT INTO lab_tests(facility_id,code,name,is_active) VALUES($1,'SYN-A','Synthetic A test',true),($2,'SYN-B','Other facility secret test',true),($1,'SYN-U','Unknown activity',NULL)",
      [facility, other],
    );
    await pool.query(
      "INSERT INTO wards(facility_id,code,name,ward_type,is_active) VALUES($1,'ICU','Synthetic ICU','ICU',true)",
      [facility],
    );
    await pool.query(
      "INSERT INTO inventory_items(facility_id,item_code,name,is_active) VALUES($1,'MED-A','Synthetic medication',true)",
      [facility],
    );
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee,is_active,auto_bill) VALUES($1,$2,'SYN-BAD','Synthetic invalid price','laboratory','Test','0.00',true,true)",
      [tenant, facility],
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });
  it('requires facility administration, permission and scope', async () => {
    const path = `/api/billing/tariff-validation?facilityId=${facility}`;
    expect((await httpJson(base, 'GET', path, { token: noPermission })).status).toBe(403);
    expect((await httpJson(base, 'GET', path, { token: foreign })).status).toBe(403);
    expect((await httpJson(base, 'GET', `${path}&limit=201`, { token })).status).toBe(400);
  });
  it('reports all pages of own catalogue and invalid configuration without leaking another facility', async () => {
    const checks: FacilityTariffValidation['checks'] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const response: { status: number; headers: Headers; body: FacilityTariffValidation } =
        await httpJson<FacilityTariffValidation>(
          base,
          'GET',
          `/api/billing/tariff-validation?facilityId=${facility}&limit=3&offset=${offset}`,
          { token },
        );
      expect(response.status).toBe(200);
      expect(response.body.limitations.join(' ')).toMatch(/not facility approval/i);
      checks.push(...response.body.checks);
      offset = response.body.nextOffset;
      pages++;
      expect(pages).toBeLessThan(20);
    }
    expect(checks.some((c) => c.name === 'Synthetic A test' && c.result === 'REVIEW')).toBe(true);
    expect(
      checks.some((c) => c.name === 'Unknown activity' && c.reasons.includes('UNKNOWN_ACTIVITY')),
    ).toBe(true);
    expect(checks.some((c) => c.name === 'Synthetic ICU')).toBe(true);
    expect(checks.some((c) => c.name === 'Synthetic medication')).toBe(true);
    expect(checks.some((c) => c.code === 'SYN-BAD' && c.result === 'INVALID')).toBe(true);
    expect(JSON.stringify(checks)).not.toContain('Other facility secret test');
  });
});
