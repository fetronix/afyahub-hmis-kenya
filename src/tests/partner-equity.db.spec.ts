import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describeDb } from './vitest/support/db.ts';
import { pool } from '../db/index.ts';
import * as svc from '../partner-equity/service.ts';
import { baselineEquity, emptyInputs } from '../partner-equity/model.ts';
import routes from '../partner-equity/routes.ts';
import { uploadLetterhead, activateLetterhead } from '../branding/letterhead.service.ts';
const why = 'Synthetic reviewed statement operation';
describeDb('partner equity — disposable synthetic PostgreSQL only', () => {
  let s: svc.Scope,
    other: svc.Scope,
    foreign: svc.Scope,
    reviewer: svc.Scope,
    server: Server,
    base: string;
  async function scope(tenant?: number) {
    const uid = randomUUID();
    const tenantId =
      tenant ??
      (
        await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
          'Synthetic equity tenant',
          uid,
        ])
      ).rows[0].id;
    const facilityId = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic equity facility','[\"accounting\"]') RETURNING id",
        [tenantId, uid],
      )
    ).rows[0].id;
    const actorId = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic preparer','not-for-login',$3,$4) RETURNING id",
        [uid, uid + '@example.test', tenantId, facilityId],
      )
    ).rows[0].id;
    return { tenantId, facilityId, actorId };
  }
  beforeAll(async () => {
    if (
      process.env.EQUITY_SYNTHETIC !== 'YES' ||
      process.env.SQL_DB_NAME !== 'equity_synthetic_test' ||
      process.env.SQL_HOST !== '127.0.0.1'
    )
      throw Error('Only explicit loopback disposable equity_synthetic_test is permitted.');
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((req, _res, next) => {
      const mode = req.get('X-Test-Mode') ?? 'editor';
      if (mode !== 'unauth') {
        (req as any).user = { id: s.actorId };
        (req as any).authContext = {
          userId: mode === 'reviewer' ? reviewer.actorId : s.actorId,
          tenantId: s.tenantId,
          facilityId: s.facilityId,
          isSuperAdmin: mode === 'super',
          roles: [mode === 'super' ? 'SUPER_ADMIN' : 'FACILITY_ADMIN'],
          permissions: [
            'accounting.read',
            ...(mode === 'no-read' ? [] : ['accounting.equity.read']),
            ...(mode === 'reader'
              ? []
              : [
                  'accounting.equity.manage',
                  'accounting.equity.partners',
                  'accounting.equity.review',
                  'accounting.equity.approve',
                  'accounting.equity.export',
                  'accounting.equity.audit',
                ]),
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
  beforeEach(async () => {
    s = await scope();
    other = await scope(s.tenantId);
    foreign = await scope();
    const uid = randomUUID();
    const actorId = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic independent reviewer','not-for-login',$3,$4) RETURNING id",
        [uid, uid + '@example.test', s.tenantId, s.facilityId],
      )
    ).rows[0].id;
    reviewer = { ...s, actorId };
  });
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  });
  const api = (path: string, method = 'GET', body?: unknown, mode = 'editor') =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': mode },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const create = (scope = s, extra: Record<string, unknown> = {}) =>
    svc.createStatement(scope, {
      financialYear: 2026,
      periodKind: 'ANNUAL',
      periodName: 'July 2025–June 2026',
      startDate: '2025-07-01',
      endDate: '2026-06-30',
      source: 'SYRONA_SCREENSHOT',
      reason: why,
      ...extra,
    });
  async function approved() {
    const { id } = await create();
    let row = await svc.getStatement(s, id);
    row = await svc.transition(s, id, { version: row.version, action: 'submit', reason: why });
    row = await svc.transition(reviewer, id, {
      version: row.version,
      action: 'review',
      reason: why,
      acceptance: 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
    });
    return svc.transition(reviewer, id, { version: row.version, action: 'approve', reason: why });
  }
  it('opening selectors/register never writes or seeds source statements', async () => {
    expect(await svc.register(s)).toMatchObject({ version: 0 });
    expect(await svc.listStatements(s, 2026)).toEqual([]);
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM equity_events WHERE tenant_id=$1', [
          s.tenantId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  it('persists the exact screenshot only after explicit creation; prevents source leakage to another period', async () => {
    const r = await api('/statements', 'POST', {
      financialYear: 2026,
      periodKind: 'ANNUAL',
      periodName: 'Baseline',
      startDate: '2025-07-01',
      endDate: '2026-06-30',
      source: 'SYRONA_SCREENSHOT',
      reason: why,
    });
    expect(r.status).toBe(201);
    const row = await svc.getStatement(s, (await r.json()).id);
    expect(row.model).toEqual(baselineEquity());
    expect(row.calculation.totals.closing).toBe('2604695.52');
    await expect(
      create(s, { financialYear: 2027, startDate: '2026-07-01', endDate: '2027-06-30' }),
    ).rejects.toMatchObject({ code: 'SOURCE_PERIOD' });
    expect(
      (
        await api('/statements', 'POST', {
          financialYear: 2026,
          periodKind: 'ANNUAL',
          periodName: 'Duplicate',
          startDate: '2025-07-01',
          endDate: '2026-06-30',
          source: 'SYRONA_SCREENSHOT',
          reason: why,
        })
      ).status,
    ).toBe(409);
  });
  it('isolates years/periods and retains explicit other reporting periods', async () => {
    await create();
    await create(s, {
      financialYear: 2027,
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      source: 'BLANK',
    });
    const q = await create(s, {
      periodKind: 'OTHER',
      periodName: 'Quarter 1',
      startDate: '2025-07-01',
      endDate: '2025-09-30',
      financialYear: 2025,
      source: 'BLANK',
    });
    expect(await svc.listStatements(s, 2026)).toHaveLength(1);
    expect(await svc.listStatements(s, 2027)).toHaveLength(1);
    expect((await svc.getStatement(s, q.id)).model.inputs['original-1'].opening).toBeNull();
  });
  it('enforces same-tenant cross-facility, cross-tenant and client scope isolation', async () => {
    for (const target of [other, foreign]) {
      const r = await create(target);
      for (const path of [
        `/statements/${r.id}`,
        `/statements/${r.id}/export?format=csv`,
        `/statements/${r.id}/audit`,
      ])
        expect((await api(path)).status).toBe(404);
      expect(
        (
          await api(`/statements/${r.id}`, 'PUT', {
            version: 1,
            model: baselineEquity(),
            reason: why,
          })
        ).status,
      ).toBe(404);
    }
    expect((await api(`/statements?year=2026&facilityId=${other.facilityId}`)).status).toBe(403);
  });
  it('preserves RBAC for read, write, export, partners, review and approval; rejects platform accounts', async () => {
    const r = await create();
    for (const mode of ['unauth', 'no-read', 'super'])
      expect([401, 403]).toContain(
        (await api('/statements?year=2026', 'GET', undefined, mode)).status,
      );
    for (const [path, method, body] of [
      [`/statements/${r.id}`, 'PUT', { version: 1, model: baselineEquity(), reason: why }],
      ['/partners', 'PUT', { version: 0, partner: baselineEquity().partners[0], reason: why }],
      [`/statements/${r.id}/workflow`, 'POST', { version: 1, action: 'approve', reason: why }],
      [`/statements/${r.id}/export?format=csv`, 'GET', null],
    ] as const)
      expect((await api(path, method, body, 'reader')).status).toBe(403);
  });
  it('audits every persisted edit with previous/new values and rejects stale concurrent writes', async () => {
    const r = await create(),
      m = baselineEquity();
    m.netResult = '-100.00';
    const writes = await Promise.allSettled([
      svc.saveStatement(s, r.id, { version: 1, model: m, reason: why }),
      svc.saveStatement(s, r.id, { version: 1, model: m, reason: why }),
    ]);
    expect(writes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((writes.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.code).toBe(
      'VERSION_CONFLICT',
    );
    const history = await svc.history(s, r.id);
    expect(history[0]).toMatchObject({
      action: 'EDIT_STATEMENT',
      actor_id: s.actorId,
      previous_values: { model: { netResult: '-2353704.47' } },
      new_values: { model: { netResult: '-100.00' } },
    });
    expect((await svc.getStatement(s, r.id)).version).toBe(2);
  });
  it('requires independent provisional-formula acceptance and freezes approvals; corrections create a retained revision', async () => {
    const { id } = await create();
    let row = await svc.getStatement(s, id);
    row = await svc.transition(s, id, { version: 1, action: 'submit', reason: why });
    await expect(
      svc.saveStatement(s, id, { version: row.version, model: baselineEquity(), reason: why }),
    ).rejects.toMatchObject({ code: 'STATEMENT_PROTECTED' });
    await expect(
      svc.transition(s, id, {
        version: row.version,
        action: 'review',
        reason: why,
        acceptance: 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
      }),
    ).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_REQUIRED' });
    await expect(
      svc.transition(reviewer, id, { version: row.version, action: 'approve', reason: why }),
    ).rejects.toMatchObject({ code: 'APPROVAL_RESTRICTED' });
    row = await svc.transition(reviewer, id, {
      version: row.version,
      action: 'review',
      reason: why,
      acceptance: 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
    });
    row = await svc.transition(reviewer, id, {
      version: row.version,
      action: 'approve',
      reason: why,
    });
    await expect(
      pool.query("UPDATE equity_statements SET model='{}',version=version+1 WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    const revision = await svc.revise(s, id, { version: row.version, reason: why });
    expect(await svc.getStatement(s, revision.id)).toMatchObject({
      status: 'DRAFT',
      revision: 2,
      parent_id: id,
      model: row.model,
    });
    expect((await svc.getStatement(s, id)).status).toBe('APPROVED');
    await expect(svc.revise(s, id, { version: row.version, reason: why })).rejects.toMatchObject({
      code: 'REVISION_EXISTS',
    });
  });
  it('supports additions, effective departure and archive without rewriting historical snapshots or deleting partners', async () => {
    const { id } = await create();
    const p = {
      id: 'partner-' + randomUUID(),
      name: 'New admitted partner',
      admittedOn: '2026-01-01',
      departedOn: null,
      active: true,
      order: 5,
      original: false,
    };
    let dir = await svc.savePartner(s, { version: 0, partner: p, reason: why });
    const next = await svc.includePartner(s, id, { version: 1, partnerId: p.id, reason: why });
    expect(next.model.inputs[p.id]).toEqual(emptyInputs());
    expect(next.model.partners.slice(0, 5)).toEqual(baselineEquity().partners);
    dir = await svc.savePartner(s, {
      version: dir.version,
      partner: { ...p, active: false, departedOn: '2026-06-01' },
      reason: why,
    });
    expect(dir.partners.find((x) => x.id === p.id)?.active).toBe(false);
    expect((await svc.getStatement(s, id)).model.partners.find((x) => x.id === p.id)?.active).toBe(
      true,
    );
    expect((await api('/partners/' + p.id, 'DELETE')).status).toBe(404);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM equity_events WHERE tenant_id=$1 AND statement_id IS NULL',
          [s.tenantId],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it('previews and confirms carry-forward from an earlier approved statement including explicit rounding acknowledgement', async () => {
    const source = await approved();
    const target = await create(s, {
      source: 'BLANK',
      financialYear: 2027,
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    });
    const preview = await svc.carryPreview(s, target.id, source.id);
    expect(preview.displayRoundingCents).toBe('-1');
    expect((await svc.getStatement(s, target.id)).model.inputs['original-1'].opening).toBeNull();
    await expect(
      svc.carryForward(s, target.id, {
        version: 1,
        sourceId: source.id,
        sourceVersion: source.version,
        reason: why,
        confirmation: 'wrong',
        roundingCents: '-1',
      }),
    ).rejects.toMatchObject({ code: 'CARRY_CONFIRMATION_REQUIRED' });
    const row = await svc.carryForward(s, target.id, {
      version: 1,
      sourceId: source.id,
      sourceVersion: source.version,
      reason: why,
      confirmation: 'CARRY REVIEWED OPENING BALANCES',
      roundingCents: '-1',
    });
    expect(row.model.inputs['original-1'].opening).toBe('1016394.15');
    expect(row.carry_source_id).toBe(source.id);
    expect((await svc.history(s, target.id))[0].new_values.carryReview.displayRoundingCents).toBe(
      '-1',
    );
    await expect(svc.carryPreview(other, target.id, source.id)).rejects.toMatchObject({
      code: 'STATEMENT_NOT_FOUND',
    });
  });
  it('rolls back writes when audit persistence fails', async () => {
    const r = await create(),
      originalConnect = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const c = await originalConnect();
      const q = c.query.bind(c);
      c.query = ((...args: unknown[]) => {
        if (String(args[0]).startsWith('INSERT INTO equity_events'))
          throw new Error('Synthetic audit failure');
        return (q as any)(...args);
      }) as any;
      const release = c.release.bind(c);
      c.release = (...args: any[]) => {
        c.query = q as any;
        release(...args);
      };
      return c;
    });
    try {
      await expect(
        svc.saveStatement(s, r.id, { version: 1, model: baselineEquity(), reason: why }),
      ).rejects.toThrow('Synthetic audit failure');
    } finally {
      spy.mockRestore();
    }
    expect((await svc.getStatement(s, r.id)).version).toBe(1);
  });
  it('exports CSV/numeric Excel and facility-branded PDF with authorized export audit', async () => {
    const { id } = await create();
    for (const f of ['csv', 'xlsx']) {
      const r = await api(`/statements/${id}/export?format=${f}`);
      expect(r.status).toBe(200);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (f === 'csv') expect(bytes.toString()).toContain('2604695.52');
      else expect(bytes.subarray(0, 2).toString()).toBe('PK');
    }
    expect((await api(`/statements/${id}/export?format=pdf`)).status).toBe(409);
    const context = {
      userId: s.actorId,
      tenantId: s.tenantId,
      facilityId: s.facilityId,
      isSuperAdmin: false,
      roles: ['FACILITY_ADMIN'],
      permissions: ['facility.branding.manage', 'facility.branding.read'],
    } as any;
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]).drawText('Synthetic facility letterhead', { x: 35, y: 810 });
    const uploaded = await uploadLetterhead(context, {
      facilityId: s.facilityId,
      filename: 'synthetic-equity.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(await doc.save()),
      body: { bodyTopPt: 85, bodyBottomPt: 60, bodyLeftPt: 36, bodyRightPt: 36 },
    });
    await activateLetterhead(context, uploaded.letterhead.id);
    const pdf = await api(`/statements/${id}/export?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    expect((await svc.history(s, id)).filter((e) => e.action === 'EXPORT_STATEMENT')).toHaveLength(
      3,
    );
  });
});
