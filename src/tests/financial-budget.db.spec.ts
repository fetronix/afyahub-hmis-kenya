import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { describeDb } from './vitest/support/db.ts';
import { pool } from '../db/index.ts';
import * as planning from '../budget-planning/planning.service.ts';
import {
  financialBudget,
  saveFinancialBudget,
} from '../budget-planning/financial-budget.service.ts';
import { createFinancialBaseline } from '../budget-planning/financial-budget.model.ts';
import routes from '../budget-planning/planning.routes.ts';
describeDb('annual financial budgets — disposable synthetic PostgreSQL only', () => {
  let s: planning.PlanningScope,
    other: planning.PlanningScope,
    foreign: planning.PlanningScope,
    server: Server,
    base: string;
  beforeAll(async () => {
    if (
      process.env.FINANCIAL_BUDGET_SYNTHETIC !== 'YES' ||
      process.env.SQL_DB_NAME !== 'financial_budget_synthetic_test' ||
      process.env.SQL_HOST !== '127.0.0.1'
    )
      throw Error(
        'Requires a new loopback disposable financial_budget_synthetic_test database. Never run these fixtures on production.',
      );
    async function scope(tenant?: number) {
      const uid = randomUUID(),
        tenantId =
          tenant ??
          (
            await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
              'Synthetic financial tenant',
              uid,
            ])
          ).rows[0].id;
      const facilityId = (
        await pool.query(
          "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic budget facility','[\"accounting\"]') RETURNING id",
          [tenantId, uid],
        )
      ).rows[0].id;
      const actorId = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic budget officer','not-for-login',$3,$4) RETURNING id",
          [uid, uid + '@example.test', tenantId, facilityId],
        )
      ).rows[0].id;
      return { tenantId, facilityId, actorId };
    }
    s = await scope();
    other = await scope(s.tenantId);
    foreign = await scope();
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      const mode = req.get('X-Test-Mode');
      if (mode !== 'unauth') {
        (req as any).user = { id: s.actorId };
        (req as any).authContext = {
          userId: s.actorId,
          tenantId: s.tenantId,
          facilityId: s.facilityId,
          isSuperAdmin: mode === 'super',
          roles: [
            mode === 'super' ? 'SUPER_ADMIN' : mode === 'planner' ? 'ACCOUNTANT' : 'FACILITY_ADMIN',
          ],
          permissions: [
            'accounting.read',
            'accounting.planning.read',
            ...(mode === 'reader' ? [] : ['accounting.planning.manage']),
            ...(mode === 'reader' || mode === 'no-export' ? [] : ['accounting.planning.export']),
          ],
        };
      }
      next();
    });
    app.use(routes);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  });
  const fixture = (scope = s, extra: Record<string, unknown> = {}) =>
    planning.createPlan(scope, {
      name: 'Synthetic financial ' + randomUUID(),
      planType: 'ANNUAL',
      financialYear: 2026,
      currency: 'KES',
      inflationPercent: '0',
      confirmAdditionalPlan: true,
      ...extra,
    });
  const api = (
    plan: number,
    suffix = '',
    method = 'GET',
    body?: unknown,
    mode = 'admin',
    facility = s.facilityId,
  ) =>
    fetch(`${base}/plans/${plan}/financial-budget${suffix}?facilityId=${facility}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': mode },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  it('GET is a read-only preview lookup, never silently seeds the baseline', async () => {
    const p = await fixture();
    const before = (
      await pool.query('SELECT count(*)::int n FROM planning_events WHERE plan_id=$1', [p.id])
    ).rows[0].n;
    expect((await financialBudget(s, p.id)).model).toBeNull();
    expect((await api(p.id)).status).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM planning_financial_budgets WHERE plan_id=$1',
          [p.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::int n FROM planning_events WHERE plan_id=$1', [p.id]))
        .rows[0].n,
    ).toBe(before);
  });
  it('persists an explicit baseline after commit, then supports JSONB roundtrip edits with previous/new audit', async () => {
    const p = await fixture(),
      m = createFinancialBaseline();
    const response = await api(p.id, '', 'PUT', { version: p.version, model: m });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.plan.version).toBe(p.version + 1);
    const loaded = await financialBudget(s, p.id);
    expect(loaded.model).toEqual(m);
    loaded.model.rows[0].overrides['0'] = '20000';
    const next = await saveFinancialBudget(s, p.id, {
      version: loaded.plan.version,
      model: loaded.model,
    });
    expect(next.plan.version).toBe(p.version + 2);
    const audit = (
      await pool.query(
        "SELECT * FROM planning_events WHERE plan_id=$1 AND action='UPDATE_FINANCIAL_BUDGET'",
        [p.id],
      )
    ).rows[0];
    expect(audit.previous_values.rows[0].overrides).toEqual({});
    expect(audit.updated_values.rows[0].overrides).toEqual({ '0': '20000' });
    expect(audit.actor_id).toBe(s.actorId);
  });
  it('rejects unauthorized writes, unauthenticated requests, global administrators and unauthorized exports', async () => {
    const p = await fixture();
    for (const mode of ['reader', 'unauth', 'super'])
      expect([401, 403]).toContain(
        (await api(p.id, '', 'PUT', { version: p.version, model: createFinancialBaseline() }, mode))
          .status,
      );
    await saveFinancialBudget(s, p.id, { version: p.version, model: createFinancialBaseline() });
    expect((await api(p.id, '/export&bad', 'GET')).status).toBe(404);
    expect((await api(p.id, '/export', 'GET', undefined, 'no-export')).status).toBe(403);
  });
  it('enforces selected facility and tenant isolation for read/write/export/reset', async () => {
    for (const target of [other, foreign]) {
      const p = await fixture(target);
      expect((await api(p.id)).status).toBe(404);
      expect(
        (await api(p.id, '', 'PUT', { version: p.version, model: createFinancialBaseline() }))
          .status,
      ).toBe(404);
      expect(
        (
          await api(p.id, '/reset', 'POST', {
            version: p.version,
            confirmation: 'RESET FINANCIAL BASELINE',
            reason: 'Verify cross-facility isolation',
          })
        ).status,
      ).toBe(404);
    }
    const own = await fixture();
    expect([403, 404]).toContain(
      (await api(own.id, '', 'GET', undefined, 'admin', other.facilityId)).status,
    );
  });
  it('rejects stale versions and protects review/approved/archived plans and non-2026/KES scenarios', async () => {
    const p = await fixture(),
      m = createFinancialBaseline();
    await saveFinancialBudget(s, p.id, { version: p.version, model: m });
    await expect(
      saveFinancialBudget(s, p.id, { version: p.version, model: m }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await pool.query("UPDATE planning_plans SET status='REVIEW',version=version+1 WHERE id=$1", [
      p.id,
    ]);
    const read = await financialBudget(s, p.id);
    await expect(
      saveFinancialBudget(s, p.id, { version: read.plan.version, model: m }),
    ).rejects.toMatchObject({ code: 'PLAN_PROTECTED' });
    for (const extra of [{ financialYear: 2027 }, { currency: 'USD' }]) {
      const wrong = await fixture(s, extra);
      await expect(
        saveFinancialBudget(s, wrong.id, { version: wrong.version, model: m }),
      ).rejects.toMatchObject({ code: 'BUDGET_SCOPE_MISMATCH' });
    }
  });
  it('rejects malformed and executable formulas without any stored model or plan bump', async () => {
    const p = await fixture(),
      m = createFinancialBaseline();
    m.rows.push({
      code: 'INC-X001',
      name: 'Unsafe',
      departmentId: 'consult',
      rule: 'Volume-Linked',
      cells: Array(12).fill('=process.exit()'),
      custom: true,
      overrides: {},
    });
    expect((await api(p.id, '', 'PUT', { version: p.version, model: m })).status).toBe(400);
    expect((await financialBudget(s, p.id)).model).toBeNull();
    expect((await financialBudget(s, p.id)).plan.version).toBe(p.version);
  });
  it('restricts financial reset to the authenticated facility administrator', async () => {
    const p = await fixture();
    const saved = await saveFinancialBudget(s, p.id, {
      version: p.version,
      model: createFinancialBaseline(),
    });
    const body = {
      version: saved.plan.version,
      confirmation: 'RESET FINANCIAL BASELINE',
      reason: 'Restore reviewed baseline',
    };
    const denied = await api(p.id, '/reset', 'POST', body, 'planner');
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('FACILITY_ADMIN_REQUIRED');
    expect((await financialBudget(s, p.id)).plan.version).toBe(saved.plan.version);
    expect((await api(p.id, '/reset', 'POST', { ...body, reason: 'short' })).status).toBe(400);
    const accepted = await api(p.id, '/reset', 'POST', body);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).resetAudit.reason).toBe('Restore reviewed baseline');
  });
  it('resets only the financial scenario after exact confirmation and preserves procurement records', async () => {
    let p = await fixture();
    const category = await planning.saveCategory(s, p.id, null, {
      version: p.version,
      name: 'OPD CONSUMABLES',
    });
    p = category.plan;
    const item = await planning.saveItem(s, p.id, null, {
      version: p.version,
      categoryId: category.changedId,
      description: 'Synthetic stationery retained',
      unit: 'Box',
      basePrice: '2',
      quantities: Array(12).fill('1'),
    });
    p = item.plan;
    const model = createFinancialBaseline();
    model.rows[0].overrides['0'] = '9';
    model.rows.push({
      code: 'INC-X001',
      name: 'Custom budget',
      departmentId: 'consult',
      rule: 'Manual',
      cells: Array(12).fill('10'),
      custom: true,
      overrides: {},
    });
    const saved = await saveFinancialBudget(s, p.id, { version: p.version, model });
    await expect(
      saveFinancialBudget(s, p.id, { version: saved.plan.version, confirmation: 'wrong' }, true),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    for (const reason of [undefined, '', 'short', 123, ' '.repeat(12), 'x'.repeat(501)]) {
      await expect(
        saveFinancialBudget(
          s,
          p.id,
          { version: saved.plan.version, confirmation: 'RESET FINANCIAL BASELINE', reason },
          true,
        ),
      ).rejects.toMatchObject({ code: 'RESET_REASON_REQUIRED' });
    }
    expect((await financialBudget(s, p.id)).plan.version).toBe(saved.plan.version);
    const reset = await saveFinancialBudget(
      s,
      p.id,
      {
        version: saved.plan.version,
        confirmation: 'RESET FINANCIAL BASELINE',
        reason: 'Restore reviewed financial assumptions',
      },
      true,
    );
    expect(reset.model).toEqual(createFinancialBaseline());
    expect(reset.resetAudit).toEqual({
      reason: 'Restore reviewed financial assumptions',
      removed: { customRows: 1, customDepartments: 0, monthlyOverrides: 1, dialysisOption: false },
    });
    const audit = (
      await pool.query(
        "SELECT previous_values,updated_values FROM planning_events WHERE plan_id=$1 AND action='RESET_FINANCIAL_BASELINE'",
        [p.id],
      )
    ).rows[0];
    expect(audit.previous_values).toEqual(model);
    expect(audit.updated_values.resetAudit).toEqual(reset.resetAudit);
    expect(
      (await pool.query('SELECT count(*)::int n FROM planning_items WHERE plan_id=$1', [p.id]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM planning_events WHERE plan_id=$1 AND action='RESET_FINANCIAL_BASELINE'",
          [p.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('rolls back model, version and audit on deferred COMMIT failure', async () => {
    const p = await fixture();
    await pool.query(
      `CREATE FUNCTION synthetic_financial_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CREATE_FINANCIAL_BUDGET' THEN RAISE EXCEPTION 'synthetic financial commit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      'CREATE CONSTRAINT TRIGGER synthetic_financial_fail AFTER INSERT ON planning_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_financial_fail()',
    );
    try {
      await expect(
        saveFinancialBudget(s, p.id, { version: p.version, model: createFinancialBaseline() }),
      ).rejects.toThrow('synthetic financial commit failure');
      const loaded = await financialBudget(s, p.id);
      expect(loaded.model).toBeNull();
      expect(loaded.plan.version).toBe(p.version);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM planning_events WHERE plan_id=$1 AND action='CREATE_FINANCIAL_BUDGET'",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER synthetic_financial_fail ON planning_events');
      await pool.query('DROP FUNCTION synthetic_financial_fail()');
    }
  });
  it('serializes concurrent updates so one acknowledged revision wins', async () => {
    const p = await fixture(),
      a = createFinancialBaseline(),
      b = createFinancialBaseline();
    a.rows[0].overrides['0'] = '1';
    b.rows[0].overrides['0'] = '2';
    const results = await Promise.allSettled([
      saveFinancialBudget(s, p.id, { version: p.version, model: a }),
      saveFinancialBudget(s, p.id, { version: p.version, model: b }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await financialBudget(s, p.id)).plan.version).toBe(p.version + 1);
  });
  it('exports authenticated stored values/formula audit as CSV and genuine Excel', async () => {
    const p = await fixture();
    await saveFinancialBudget(s, p.id, { version: p.version, model: createFinancialBaseline() });
    for (const format of ['csv', 'xlsx']) {
      const response = await fetch(
        `${base}/plans/${p.id}/financial-budget/export?facilityId=${s.facilityId}&format=${format}&mode=formulas`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('.' + format);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(1000);
      if (format === 'xlsx') expect(bytes.subarray(0, 2).toString()).toBe('PK');
      else expect(bytes.toString()).toContain("'=PREV");
    }
  });
});
