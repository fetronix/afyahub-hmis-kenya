/** Real HTTP + isolated synthetic PostgreSQL: do not invent surveillance counts. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('public-health explicit report facts and scope', () => {
  const suffix = randomUUID().slice(0, 8);
  let facility: number, sibling: number, actor: number;
  let token: string, noPermission: string, base: string, close: () => Promise<void>;
  const valid = () => ({
    facilityId: facility,
    diseaseCode: 'SYN',
    diseaseName: 'Synthetic condition',
    casesCount: 2,
    mortalityCount: 0,
    ageGroup: 'Under 5 Years',
    epiWeek: '2026-W44',
  });
  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    ) {
      throw new Error('A disposable local synthetic test database is required.');
    }
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic public health ${suffix}`,
        `health-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
      ($1,$2,'Synthetic report facility',$4::jsonb),($1,$3,'Synthetic sibling facility',$4::jsonb) RETURNING id`,
      [tenant, `HEALTH-A-${suffix}`, `HEALTH-B-${suffix}`, JSON.stringify(['public_health'])],
    );
    [facility, sibling] = facilities.rows.map((row) => row.id);
    for (const code of ['public_health.reports.create', 'reports.read']) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'public_health') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    }
    async function makeActor(tag: string, grants: string[]) {
      const user = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic user','test-only','ACTIVE',$3,$4) RETURNING id",
          [`health-${tag}-${suffix}`, `health-${tag}-${suffix}@example.test`, tenant, facility],
        )
      ).rows[0].id;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `HEALTH_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
      for (const grant of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, grant],
        );
      return {
        user,
        token: (await createSession({ userId: user, securityVersion: 1 })).sessionToken,
      };
    }
    const writer = await makeActor('writer', ['public_health.reports.create', 'reports.read']);
    actor = writer.user;
    token = writer.token;
    noPermission = (await makeActor('limited', ['reports.read'])).token;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('rejects each missing fact and invalid counts without inserting a report', async () => {
    for (const field of ['casesCount', 'mortalityCount', 'ageGroup'] as const) {
      const body: Record<string, unknown> = valid();
      delete body[field];
      const response = await httpJson(base, 'POST', '/api/public-health/reports', { token, body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_REPORT_COUNTS');
    }
    for (const body of [
      { ...valid(), mortalityCount: null },
      { ...valid(), mortalityCount: 3 },
      { ...valid(), ageGroup: '' },
    ]) {
      expect(
        (await httpJson(base, 'POST', '/api/public-health/reports', { token, body })).status,
      ).toBe(400);
    }
    const rows = await pool.query(
      'SELECT count(*)::int AS count FROM public_health_reports WHERE facility_id=$1',
      [facility],
    );
    expect(rows.rows[0].count).toBe(0);
  });
  it('persists an explicitly entered zero without claiming a national submission', async () => {
    const response = await httpJson(base, 'POST', '/api/public-health/reports', {
      token,
      body: valid(),
    });
    expect(response.status).toBe(201);
    const rows = await pool.query(
      'SELECT cases_count,mortality_count,age_group,reported_by,status,submitted_at FROM public_health_reports WHERE id=$1 AND facility_id=$2',
      [response.body.id, facility],
    );
    expect(rows.rows[0]).toMatchObject({
      cases_count: 2,
      mortality_count: 0,
      age_group: 'Under 5 Years',
      reported_by: String(actor),
      status: 'DRAFT',
      submitted_at: null,
    });
  });
  it('keeps authorization and facility isolation on writes', async () => {
    expect(
      (await httpJson(base, 'POST', '/api/public-health/reports', { body: valid() })).status,
    ).toBe(401);
    expect(
      (
        await httpJson(base, 'POST', '/api/public-health/reports', {
          token: noPermission,
          body: valid(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await httpJson(base, 'POST', '/api/public-health/reports', {
          token,
          body: { ...valid(), facilityId: sibling },
        })
      ).status,
    ).toBe(403);
    const rows = await pool.query(
      'SELECT count(*)::int AS count FROM public_health_reports WHERE facility_id=$1',
      [sibling],
    );
    expect(rows.rows[0].count).toBe(0);
  });
});
