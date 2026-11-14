import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { describeDb } from './vitest/support/db.ts';
import { pool } from '../db/index.ts';
import * as planning from '../budget-planning/planning.service.ts';
import {
  resetInventory,
  previewReset,
  executeReset,
} from '../budget-planning/planning-reset.service.ts';
import type { ResetSelection } from '../budget-planning/reset-contract.ts';
import { projection } from '../budget-planning/reports.service.ts';
import routes from '../budget-planning/planning.routes.ts';

describeDb('controlled planning reset — disposable synthetic database only', () => {
  let s: planning.PlanningScope, other: planning.PlanningScope, foreign: planning.PlanningScope;
  let server: Server, base: string;
  beforeAll(async () => {
    if (
      process.env.PLANNING_RESET_SYNTHETIC !== 'YES' ||
      process.env.SQL_DB_NAME !== 'planning_reset_synthetic_test' ||
      process.env.SQL_HOST !== '127.0.0.1'
    )
      throw Error(
        'This suite requires a new disposable planning_reset_synthetic_test database. Never run against live data.',
      );
    const uid = randomUUID();
    async function scope(label: string, tenant?: number) {
      const tenantId =
        tenant ??
        (
          await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
            'Synthetic reset ' + label,
            uid + label,
          ])
        ).rows[0].id;
      const facilityId = (
        await pool.query(
          'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,\'["accounting"]\') RETURNING id',
          [tenantId, uid + label, 'Synthetic reset facility ' + label],
        )
      ).rows[0].id;
      const actorId = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic reset administrator','not-for-login',$3,$4) RETURNING id",
          [uid + label, uid + label + '@example.test', tenantId, facilityId],
        )
      ).rows[0].id;
      return { tenantId, facilityId, actorId };
    }
    s = await scope('A');
    other = await scope('B', s.tenantId);
    foreign = await scope('C');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.get('X-Test-User') !== 'unauthenticated') {
        const mode = req.get('X-Test-User');
        (req as any).user = { id: s.actorId };
        (req as any).authContext = {
          userId: s.actorId,
          tenantId: s.tenantId,
          facilityId: mode === 'tenant' ? null : s.facilityId,
          roles: [
            mode === 'staff' ? 'ACCOUNTANT' : mode === 'super' ? 'SUPER_ADMIN' : 'FACILITY_ADMIN',
          ],
          isSuperAdmin: mode === 'super',
          permissions: [
            'accounting.read',
            'accounting.planning.read',
            ...(mode === 'reader' ? [] : ['accounting.planning.manage']),
            ...(mode === 'no-reset' ? [] : ['accounting.planning.reset']),
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
  const send = (path: string, body?: unknown, mode = 'admin', facilityId = s.facilityId) =>
    fetch(`${base}${path}?facilityId=${facilityId}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': mode },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function fixture(scope = s, imported = false) {
    let plan = await planning.createPlan(scope, {
      name: 'Synthetic reset plan ' + randomUUID(),
      financialYear: 2026,
      planType: 'MIXED',
      currency: 'KES',
      inflationPercent: '0',
      confirmAdditionalPlan: true,
    });
    const ids: number[] = [];
    for (const name of ['OPD CONSUMABLES', 'BRANDING', 'Staff Uniforms']) {
      const r = await planning.saveCategory(scope, plan.id, null, { name, version: plan.version });
      plan = r.plan;
      ids.push(r.changedId!);
    }
    for (const [n, description] of ['Paper', 'Signage'].entries()) {
      const r = await planning.saveItem(scope, plan.id, null, {
        version: plan.version,
        categoryId: ids[n],
        description,
        unit: 'Unit',
        basePrice: '10',
        quantities: Array(12).fill('2'),
      });
      plan = r.plan;
    }
    const uniform = await planning.saveUniform(scope, plan.id, null, {
      version: plan.version,
      categoryId: ids[2],
      description: 'Coat',
      existingBalance: '0',
      balanceLabel: 'Synthetic opening',
      buyingCost: '100',
      contributionPercent: '0',
      staffCount: 2,
      quantityPerStaff: '1',
      balanceRule: 'IGNORE',
    });
    plan = uniform.plan;
    if (imported) {
      const batch = await planning.upload(
        scope,
        Buffer.from('Synthetic source ' + randomUUID() + ',1\n'),
        randomUUID() + '.csv',
        'text/csv',
      );
      await pool.query('UPDATE planning_items SET source_import_id=$2 WHERE plan_id=$1', [
        plan.id,
        batch.id,
      ]);
    }
    const selection: ResetSelection = {
      planIds: [plan.id],
      stationery: true,
      branding: true,
      uniforms: true,
      deleteEmptyPlans: false,
      provenance: 'ALL',
    };
    return { plan, ids, selection, reason: 'Clear disposable synthetic planning exercise' };
  }
  const confirmed = (p: { token: string }) => ({
    token: p.token,
    confirmation: 'RESET PLANNING DATA',
  });
  const itemCount = async (planId: number) =>
    (await pool.query('SELECT count(*)::int n FROM planning_items WHERE plan_id=$1', [planId]))
      .rows[0].n;

  it('reads actual scoped inventory, import status, provenance and preview without changing records', async () => {
    const f = await fixture(s, true),
      inventory = await resetInventory(s);
    expect(inventory.plans.find((p) => p.id === f.plan.id)).toMatchObject({
      stationery: 1,
      branding: 1,
      uniforms: 1,
      months: 24,
      imported: 2,
      manual: 1,
      eligible: true,
      disposable: false,
    });
    expect(inventory.batches.some((b) => b.status === 'UPLOADED')).toBe(true);
    const p = await previewReset(s, f);
    expect(p.counts).toEqual({
      stationery: 1,
      branding: 1,
      uniforms: 1,
      months: 24,
      categories: 0,
      plans: 0,
      imported: 2,
      manual: 1,
    });
    expect(await itemCount(f.plan.id)).toBe(2);
  });
  it('requires exact phrase and signed preview, rejects modified or cross-actor/facility tokens', async () => {
    const f = await fixture(),
      p = await previewReset(s, f);
    await expect(
      executeReset(s, { token: p.token, confirmation: 'reset planning data' }),
    ).rejects.toMatchObject({ code: 'RESET_CONFIRMATION_REQUIRED' });
    await expect(executeReset(s, confirmed({ token: p.token + 'x' }))).rejects.toMatchObject({
      code: 'INVALID_RESET_PREVIEW',
    });
    await expect(executeReset(other, confirmed(p))).rejects.toMatchObject({
      code: 'RESET_SCOPE_MISMATCH',
    });
    await expect(
      executeReset({ ...s, actorId: other.actorId }, confirmed(p)),
    ).rejects.toMatchObject({ code: 'RESET_SCOPE_MISMATCH' });
    expect(await itemCount(f.plan.id)).toBe(2);
  });
  it('authorizes administrator reset, returns actual committed counts, preserves immutable audit and import batches', async () => {
    const f = await fixture(s, true);
    const previousEvents = (
      await pool.query('SELECT * FROM planning_events WHERE plan_id=$1 ORDER BY id', [f.plan.id])
    ).rows;
    const batches = (
      await pool.query(
        'SELECT * FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id',
        [s.tenantId, s.facilityId],
      )
    ).rows;
    const response = await send('/reset/preview', f);
    expect(response.status).toBe(200);
    const preview = await response.json();
    const result = await send('/reset/execute', confirmed(preview));
    expect(result.status).toBe(200);
    const receipt = await result.json();
    expect(receipt.counts).toEqual(preview.counts);
    expect(receipt.actorId).toBe(s.actorId);
    expect(await itemCount(f.plan.id)).toBe(0);
    expect(
      (await pool.query('SELECT * FROM planning_events WHERE plan_id=$1 ORDER BY id', [f.plan.id]))
        .rows,
    ).toEqual(previousEvents);
    expect(
      (
        await pool.query(
          'SELECT * FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id',
          [s.tenantId, s.facilityId],
        )
      ).rows,
    ).toEqual(batches);
    const audit = (await pool.query('SELECT * FROM planning_events WHERE id=$1', [receipt.eventId]))
      .rows[0];
    expect(audit.action).toBe('PLANNING_RESET_COMPLETED');
    expect(audit.updated_values.reason).toBe(f.reason);
    expect(audit.updated_values.counts).toEqual(receipt.counts);
    const auth = (
      await pool.query('SELECT previous_values FROM planning_events WHERE id=$1', [
        audit.updated_values.authorizationEventId,
      ])
    ).rows[0].previous_values;
    expect(auth.planning_items).toHaveLength(2);
    expect(auth.planning_months).toHaveLength(24);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND action='PLANNING_RESET_COMPLETED'",
          [s.tenantId, s.facilityId],
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
    await expect(executeReset(s, confirmed(preview))).rejects.toMatchObject({
      code: 'RESET_PREVIEW_CHANGED',
    });
  });
  it('rejects unauthenticated, read-only, non-admin, missing-reset, tenant-wide and super-admin requests on all reset routes', async () => {
    const f = await fixture();
    for (const mode of ['unauthenticated', 'reader', 'staff', 'no-reset', 'tenant', 'super']) {
      for (const [path, body] of [
        ['/reset', undefined],
        ['/reset/preview', f],
        ['/reset/execute', { confirmation: 'RESET PLANNING DATA' }],
      ] as const) {
        const r = await send(path, body, mode);
        expect([401, 403]).toContain(r.status);
      }
    }
    expect(await itemCount(f.plan.id)).toBe(2);
  });
  it('rejects client-selected foreign facilities and cross-tenant or same-tenant foreign plan IDs', async () => {
    const f = await fixture(other),
      g = await fixture(foreign);
    expect((await send('/reset', undefined, 'admin', other.facilityId)).status).toBe(403);
    for (const foreignPlan of [f, g])
      expect((await send('/reset/preview', foreignPlan)).status).toBe(404);
    const own = await fixture(),
      p = await previewReset(s, own);
    await executeReset(s, confirmed(p));
    expect(await itemCount(f.plan.id)).toBe(2);
    expect(await itemCount(g.plan.id)).toBe(2);
    expect((await resetInventory(s)).plans.some((p) => [f.plan.id, g.plan.id].includes(p.id))).toBe(
      false,
    );
  });
  it('refuses stale preview even when counts are unchanged', async () => {
    const f = await fixture(),
      p = await previewReset(s, f);
    await planning.updatePlan(s, f.plan.id, {
      version: f.plan.version,
      name: f.plan.name + ' changed',
      inflationPercent: '0',
    });
    await expect(executeReset(s, confirmed(p))).rejects.toMatchObject({
      code: 'RESET_PREVIEW_CHANGED',
    });
    expect(await itemCount(f.plan.id)).toBe(2);
  });
  it('honors selected sections and provenance, deleting only their dependent monthly rows', async () => {
    const f = await fixture(s, true);
    f.selection.branding = false;
    f.selection.uniforms = true;
    f.selection.provenance = 'IMPORTED';
    const p = await previewReset(s, f);
    expect(p.counts).toMatchObject({
      stationery: 1,
      branding: 0,
      uniforms: 0,
      months: 12,
      imported: 1,
      manual: 0,
    });
    await executeReset(s, confirmed(p));
    const r = await projection(s, f.plan.id, { all: true });
    expect(r.items).toHaveLength(1);
    expect(r.uniforms).toHaveLength(1);
    expect(r.items[0].description).toBe('Signage');
    expect(r.items[0].months).toHaveLength(12);
  });
  it('rolls back child deletions, plan versions and new audit events when a later deletion fails', async () => {
    const f = await fixture(),
      p = await previewReset(s, f);
    await pool.query(
      `CREATE FUNCTION synthetic_reset_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic reset failure'; END $$`,
    );
    await pool.query(
      'CREATE TRIGGER synthetic_reset_failure BEFORE DELETE ON planning_uniforms FOR EACH ROW EXECUTE FUNCTION synthetic_reset_failure()',
    );
    const events = (await pool.query('SELECT count(*)::int n FROM planning_events')).rows[0].n;
    try {
      await expect(executeReset(s, confirmed(p))).rejects.toThrow('synthetic reset failure');
      expect(await itemCount(f.plan.id)).toBe(2);
      expect((await pool.query('SELECT count(*)::int n FROM planning_events')).rows[0].n).toBe(
        events,
      );
      expect(
        (await projection(s, f.plan.id, { all: true })).items.every((i) => i.months.length === 12),
      ).toBe(true);
    } finally {
      await pool.query('DROP TRIGGER synthetic_reset_failure ON planning_uniforms');
      await pool.query('DROP FUNCTION synthetic_reset_failure()');
    }
    expect((await executeReset(s, confirmed(p))).counts.months).toBe(24);
  });
  it('produces empty tables and zero totals; new manual item/uniform and annual plan creation still work', async () => {
    const f = await fixture();
    await executeReset(s, confirmed(await previewReset(s, f)));
    const empty = await projection(s, f.plan.id, { all: true });
    expect(empty.items).toHaveLength(0);
    expect(empty.uniforms).toHaveLength(0);
    expect(BigInt(empty.summary.annualCombinedCents)).toBe(0n);
    const r = await planning.saveItem(s, f.plan.id, null, {
      version: empty.plan.version,
      categoryId: f.ids[0],
      description: 'New manual paper',
      unit: 'Box',
      basePrice: '3',
      quantities: Array(12).fill('1'),
    });
    await planning.saveUniform(s, f.plan.id, null, {
      version: r.plan.version,
      categoryId: f.ids[2],
      description: 'New coat',
      existingBalance: '0',
      balanceLabel: 'Synthetic',
      buyingCost: '10',
      contributionPercent: '0',
      staffCount: 1,
      quantityPerStaff: '1',
      balanceRule: 'IGNORE',
    });
    const fresh = await projection(s, f.plan.id, { all: true });
    expect(fresh.items).toHaveLength(1);
    expect(fresh.items[0].source_import_id).toBeNull();
    expect(fresh.uniforms).toHaveLength(1);
    expect(
      (
        await planning.createPlan(s, {
          name: randomUUID(),
          financialYear: 2027,
          planType: 'ANNUAL',
          currency: 'KES',
          inflationPercent: '0',
          confirmAdditionalPlan: true,
        })
      ).status,
    ).toBe('DRAFT');
  });
  it('expires previews and rejects empty/implicit choices without mutation', async () => {
    const f = await fixture(),
      p = await previewReset(s, f);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    try {
      await expect(executeReset(s, confirmed(p))).rejects.toMatchObject({
        code: 'RESET_PREVIEW_EXPIRED',
      });
    } finally {
      clock.mockRestore();
    }
    await expect(
      previewReset(s, { ...f, selection: { ...f.selection, planIds: [] } }),
    ).rejects.toMatchObject({ code: 'RESET_SELECTION_REQUIRED' });
    await expect(
      previewReset(s, { ...f, selection: { ...f.selection, stationery: undefined } }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_SELECTION' });
    expect(await itemCount(f.plan.id)).toBe(2);
  });
  it('allows only one of two concurrent confirmations and preserves committed evidence', async () => {
    const f = await fixture(),
      p = await previewReset(s, f);
    const results = await Promise.allSettled([
      executeReset(s, confirmed(p)),
      executeReset(s, confirmed(p)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await itemCount(f.plan.id)).toBe(0);
  });
  it('rolls back on a deferred COMMIT failure without returning a success receipt', async () => {
    const f = await fixture(),
      p = await previewReset(s, f);
    await pool.query(
      `CREATE FUNCTION synthetic_reset_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PLANNING_RESET_COMPLETED' THEN RAISE EXCEPTION 'synthetic reset commit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      'CREATE CONSTRAINT TRIGGER synthetic_reset_commit_failure AFTER INSERT ON planning_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_reset_commit_failure()',
    );
    const before = (await pool.query('SELECT count(*)::int n FROM planning_events')).rows[0].n;
    try {
      await expect(executeReset(s, confirmed(p))).rejects.toThrow('synthetic reset commit failure');
      expect(await itemCount(f.plan.id)).toBe(2);
      expect((await pool.query('SELECT count(*)::int n FROM planning_events')).rows[0].n).toBe(
        before,
      );
    } finally {
      await pool.query('DROP TRIGGER synthetic_reset_commit_failure ON planning_events');
      await pool.query('DROP FUNCTION synthetic_reset_commit_failure()');
    }
  });
  it('preserves issued reports, facility letterheads, facility settings and non-planning users byte-for-byte', async () => {
    const f = await fixture();
    const head = (
      await pool.query(
        "INSERT INTO facility_letterheads(tenant_id,facility_id,version,header_text,checksum,created_by) SELECT $1,$2,COALESCE(max(version),0)+1,'Synthetic letterhead','synthetic-reset-checksum',$3 FROM facility_letterheads WHERE facility_id=$2 RETURNING id",
        [s.tenantId, s.facilityId, s.actorId],
      )
    ).rows[0].id;
    const report = (
      await pool.query(
        "INSERT INTO planning_reports(tenant_id,facility_id,plan_id,report_type,filters,model,export_data,letterhead_id,pdf_bytes,generated_by) VALUES($1,$2,$3,'ANNUAL','{}','{}','{}',$4,$5,$6) RETURNING id",
        [
          s.tenantId,
          s.facilityId,
          f.plan.id,
          head,
          Buffer.from('Synthetic issued report bytes'),
          s.actorId,
        ],
      )
    ).rows[0].id;
    async function preserved() {
      return [
        (await pool.query('SELECT * FROM facilities WHERE id=$1', [s.facilityId])).rows,
        (await pool.query('SELECT * FROM users WHERE id=$1', [s.actorId])).rows,
        (await pool.query('SELECT * FROM planning_reports WHERE id=$1', [report])).rows,
        (await pool.query('SELECT * FROM facility_letterheads WHERE id=$1', [head])).rows,
      ];
    }
    const before = await preserved();
    await executeReset(s, confirmed(await previewReset(s, f)));
    expect(await preserved()).toEqual(before);
    await expect(
      pool.query('DELETE FROM planning_reports WHERE id=$1', [report]),
    ).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM planning_events WHERE plan_id=$1', [f.plan.id]),
    ).rejects.toThrow();
  });
  it('protects REVIEW, APPROVED and ARCHIVED plans and retains ordinary deletion guards', async () => {
    const f = await fixture();
    await pool.query("UPDATE planning_plans SET status='REVIEW',version=version+1 WHERE id=$1", [
      f.plan.id,
    ]);
    await expect(previewReset(s, f)).rejects.toMatchObject({ code: 'RESET_DRAFT_ONLY' });
    await pool.query("UPDATE planning_plans SET status='APPROVED',version=version+1 WHERE id=$1", [
      f.plan.id,
    ]);
    await expect(previewReset(s, f)).rejects.toMatchObject({ code: 'RESET_DRAFT_ONLY' });
    await pool.query("UPDATE planning_plans SET status='ARCHIVED',version=version+1 WHERE id=$1", [
      f.plan.id,
    ]);
    await expect(previewReset(s, f)).rejects.toMatchObject({ code: 'RESET_DRAFT_ONLY' });
    const draft = await fixture();
    await expect(
      pool.query('DELETE FROM planning_items WHERE plan_id=$1', [draft.plan.id]),
    ).rejects.toThrow('reset row evidence');
    await expect(
      pool.query('DELETE FROM planning_plans WHERE id=$1', [draft.plan.id]),
    ).rejects.toThrow('reset row evidence');
  });
  it('retains plans with history even when deleting plans is selected; deletes only truly disposable drafts', async () => {
    const f = await fixture();
    f.selection.deleteEmptyPlans = true;
    const p = await previewReset(s, f);
    expect(p.counts.plans).toBe(0);
    expect(p.retainedPlans[0].reason).toContain('history');
    await executeReset(s, confirmed(p));
    expect((await projection(s, f.plan.id)).plan.id).toBe(f.plan.id);
    const legacy = (
      await pool.query(
        "INSERT INTO planning_plans(tenant_id,facility_id,name,plan_type,financial_year,currency,created_by,updated_by) VALUES($1,$2,$3,'ANNUAL',2026,'KES',$4,$4) RETURNING id",
        [s.tenantId, s.facilityId, randomUUID(), s.actorId],
      )
    ).rows[0].id;
    const disposable = await previewReset(s, {
      ...f,
      selection: { ...f.selection, planIds: [legacy] },
    });
    expect(disposable.counts.plans).toBe(1);
    expect((await executeReset(s, confirmed(disposable))).counts.plans).toBe(1);
    expect((await pool.query('SELECT id FROM planning_plans WHERE id=$1', [legacy])).rowCount).toBe(
      0,
    );
  });
});
