/**
 * Surveillance corrections and weekly totals, exercised over HTTP against
 * isolated synthetic PostgreSQL. No figure here is a national submission.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

type Summary = {
  epiWeek: string;
  tallies: Array<{
    diseaseCode: string;
    ageGroup: string;
    casesCount: number;
    mortalityCount: number;
    caseFatalityRatio: string | null;
    recordCount: number;
    reportIds: number[];
    disputed: boolean;
  }>;
  superseded: Array<{ id: number; replacedBy: number | null }>;
  totals: {
    diseases: number;
    records: number;
    casesCount: number;
    mortalityCount: number;
    disputedGroups: number;
  };
  submission: { ready: boolean; blockedBy: string | null; transmitted: boolean };
  limitations: { format: string; notice: string };
};

describeDb('public-health surveillance corrections and weekly totals', () => {
  const suffix = randomUUID().slice(0, 8);
  let facility: number;
  let sibling: number;
  let actor: number;
  let viewer: number;
  let token: string;
  let viewerToken: string;
  let noPermission: string;
  let base: string;
  let close: () => Promise<void>;

  const report = (overrides: Record<string, unknown> = {}) => ({
    facilityId: facility,
    diseaseCode: 'A00',
    diseaseName: 'Cholera (suspected)',
    casesCount: 40,
    mortalityCount: 2,
    ageGroup: 'Under 5 Years',
    epiWeek: '2026-W44',
    ...overrides,
  });

  async function create(body: Record<string, unknown> = report()) {
    const response = await httpJson<{ id: number }>(base, 'POST', '/api/public-health/reports', {
      token,
      body,
    });
    expect(response.status).toBe(201);
    return response.body.id as number;
  }

  const summary = async (epiWeek = '2026-W44', query = `facilityId=${facility}`) => {
    const response = await httpJson<Summary & { success: boolean }>(
      base,
      'GET',
      `/api/public-health/reports/summary?${query}&epiWeek=${epiWeek}`,
      { token },
    );
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    return response.body;
  };

  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    ) {
      throw new Error('A disposable local synthetic test database is required.');
    }
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic surveillance ${suffix}`,
        `surveillance-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
       ($1,$2,'Synthetic surveillance facility',$4::jsonb),
       ($1,$3,'Synthetic sibling facility',$4::jsonb) RETURNING id`,
      [tenant, `SURV-A-${suffix}`, `SURV-B-${suffix}`, JSON.stringify(['public_health'])],
    );
    [facility, sibling] = facilities.rows.map((row) => row.id);
    for (const code of ['public_health.reports.create', 'reports.read'])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'public_health') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    async function makeActor(tag: string, grants: string[]) {
      const user = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic user','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`surv-${tag}-${suffix}`, `surv-${tag}-${suffix}@example.test`, tenant, facility],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `SURV_${tag}_${suffix}`],
        )
      ).rows[0].id;
      for (const code of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
      return user;
    }
    actor = await makeActor('RECORDER', ['public_health.reports.create', 'reports.read']);
    viewer = await makeActor('VIEWER', ['reports.read']);
    noPermission = (await makeActor('NONE', [])).toString();
    token = (await createSession({ userId: actor, securityVersion: 1 })).sessionToken;
    viewerToken = (await createSession({ userId: viewer, securityVersion: 1 })).sessionToken;
    const noneId = Number(noPermission);
    noPermission = (await createSession({ userId: noneId, securityVersion: 1 })).sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('warns at entry time when a second active record competes for the same week', async () => {
    const first = await httpJson<{ warning: string | null }>(
      base,
      'POST',
      '/api/public-health/reports',
      { token, body: report() },
    );
    expect(first.status).toBe(201);
    expect(first.body.warning).toBeNull();

    const second = await httpJson<{ warning: string | null; id: number }>(
      base,
      'POST',
      '/api/public-health/reports',
      { token, body: report({ casesCount: 4, mortalityCount: 0 }) },
    );
    expect(second.status).toBe(201);
    expect(second.body.warning).toMatch(/already exist/);

    const tally = await summary();
    expect(tally.tallies).toHaveLength(1);
    expect(tally.tallies[0]).toMatchObject({
      diseaseCode: 'A00',
      ageGroup: 'Under 5 Years',
      casesCount: 44,
      recordCount: 2,
      disputed: true,
    });
    expect(tally.totals.disputedGroups).toBe(1);
    // A disputed figure is never presented as submit-ready.
    expect(tally.submission.ready).toBe(false);
    expect(tally.submission.transmitted).toBe(false);
    expect(tally.limitations.format).toBe('FACILITY_TALLY_ONLY');

    // Clean up so later assertions start from one record.
    await pool.query('DELETE FROM public_health_reports WHERE facility_id=$1', [facility]);
  });

  it('corrects a wrong count by superseding it, keeping the original row and its audit trail', async () => {
    const original = await create();

    const correction = await httpJson<{
      id: number;
      supersedesReportId: number;
      casesCount: number;
      previous: { casesCount: number };
      reason: string;
      transmitted: boolean;
    }>(base, 'POST', `/api/public-health/reports/${original}/correction`, {
      token,
      body: {
        facilityId: facility,
        casesCount: 4,
        mortalityCount: 0,
        reason: 'Cholera cases were keyed as 40 instead of 4 on the paper register.',
      },
    });
    expect(correction.status).toBe(201);
    expect(correction.body.supersedesReportId).toBe(original);
    expect(correction.body.casesCount).toBe(4);
    expect(correction.body.previous.casesCount).toBe(40);
    expect(correction.body.transmitted).toBe(false);

    // The original is retained, not deleted, and no longer counts.
    const rows = await pool.query(
      'SELECT id,status,cases_count,supersedes_report_id FROM public_health_reports WHERE facility_id=$1 ORDER BY id',
      [facility],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0]).toMatchObject({ id: original, status: 'SUPERSEDED', cases_count: 40 });
    expect(rows.rows[1]).toMatchObject({
      id: correction.body.id,
      status: 'DRAFT',
      cases_count: 4,
      supersedes_report_id: original,
    });

    const tally = await summary();
    expect(tally.tallies).toHaveLength(1);
    expect(tally.tallies[0]).toMatchObject({
      casesCount: 4,
      mortalityCount: 0,
      recordCount: 1,
      disputed: false,
    });
    expect(tally.superseded).toEqual([
      expect.objectContaining({ id: original, replacedBy: correction.body.id }),
    ]);
    expect(tally.submission.ready).toBe(true);

    // The correction is audited with both figures and the stated reason.
    const audit = await pool.query(
      `SELECT action,details FROM audit_logs
       WHERE facility_id=$1 AND resource='public_health_reports' AND action='CORRECT'
       ORDER BY id DESC LIMIT 1`,
      [facility],
    );
    expect(audit.rowCount).toBe(1);
    expect(JSON.parse(audit.rows[0].details)).toMatchObject({
      supersedesReportId: original,
      previous: { casesCount: 40, mortalityCount: 2 },
      corrected: { casesCount: 4, mortalityCount: 0 },
      transmitted: false,
    });
  });

  it('refuses a correction that changes nothing, repeats, moves the week, or comes from a reader', async () => {
    const rows = await pool.query<{ id: number }>(
      "SELECT id FROM public_health_reports WHERE facility_id=$1 AND status='DRAFT' ORDER BY id DESC LIMIT 1",
      [facility],
    );
    const current = rows.rows[0].id;

    const unchanged = await httpJson<{ error: string }>(
      base,
      'POST',
      `/api/public-health/reports/${current}/correction`,
      {
        token,
        body: {
          facilityId: facility,
          casesCount: 4,
          mortalityCount: 0,
          reason: 'Attempting to record an identical correction.',
        },
      },
    );
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error).toBe('NO_CHANGE');

    const moved = await httpJson<{ error: string }>(
      base,
      'POST',
      `/api/public-health/reports/${current}/correction`,
      {
        token,
        body: {
          facilityId: facility,
          casesCount: 6,
          mortalityCount: 0,
          epiWeek: '2026-W45',
          reason: 'Trying to move the record to another week.',
        },
      },
    );
    expect(moved.status).toBe(400);
    expect(moved.body.error).toBe('IMMUTABLE_FIELD');

    const readerAttempt = await httpJson(
      base,
      'POST',
      `/api/public-health/reports/${current}/correction`,
      {
        token: viewerToken,
        body: {
          facilityId: facility,
          casesCount: 6,
          mortalityCount: 0,
          reason: 'Read-only user attempting a correction.',
        },
      },
    );
    expect(readerAttempt.status).toBe(403);

    const anonymous = await httpJson(
      base,
      'POST',
      `/api/public-health/reports/${current}/correction`,
      {
        body: { casesCount: 6, mortalityCount: 0, reason: 'Anonymous correction attempt.' },
      },
    );
    expect(anonymous.status).toBe(401);

    // Supersede it, then prove the superseded row cannot be corrected again.
    const replacement = await httpJson<{ id: number }>(
      base,
      'POST',
      `/api/public-health/reports/${current}/correction`,
      {
        token,
        body: {
          facilityId: facility,
          casesCount: 6,
          mortalityCount: 0,
          reason: 'A sixth suspected case was confirmed on the ward round.',
        },
      },
    );
    expect(replacement.status).toBe(201);
    const again = await httpJson<{ error: string }>(
      base,
      'POST',
      `/api/public-health/reports/${current}/correction`,
      {
        token,
        body: {
          facilityId: facility,
          casesCount: 7,
          mortalityCount: 0,
          reason: 'Correcting the record that has already been replaced.',
        },
      },
    );
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('ALREADY_SUPERSEDED');

    const tally = await summary();
    expect(tally.tallies[0].casesCount).toBe(6);
    expect(tally.tallies[0].disputed).toBe(false);
  });

  it('never totals another facility and requires a well-formed epidemiological week', async () => {
    const siblingReport = await httpJson(base, 'POST', '/api/public-health/reports', {
      token,
      body: report({ facilityId: sibling, casesCount: 99 }),
    });
    // The recorder is scoped to its own facility, so this must be refused.
    expect([403, 404]).toContain(siblingReport.status);

    const tally = await summary();
    expect(tally.totals.casesCount).toBe(6);

    for (const week of ['2026-44', '2026-W54', 'W44', '2026-W00', '']) {
      const response = await httpJson<{ error: string }>(
        base,
        'GET',
        `/api/public-health/reports/summary?facilityId=${facility}&epiWeek=${week}`,
        { token },
      );
      expect(response.status).toBe(400);
    }
    const missing = await httpJson<{ error: string }>(
      base,
      'GET',
      `/api/public-health/reports/summary?facilityId=${facility}`,
      { token },
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('INVALID_EPI_WEEK');

    const forbidden = await httpJson(
      base,
      'GET',
      `/api/public-health/reports/summary?facilityId=${facility}&epiWeek=2026-W44`,
      {
        token: noPermission,
      },
    );
    expect(forbidden.status).toBe(403);
  });

  it('reports an empty week as not ready rather than as zero cases', async () => {
    const empty = await summary('2027-W01');
    expect(empty.tallies).toEqual([]);
    expect(empty.totals).toMatchObject({ diseases: 0, records: 0, casesCount: 0 });
    expect(empty.submission.ready).toBe(false);
    expect(empty.submission.blockedBy).toMatch(/No active records/);
  });
});
