import { beforeEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import express from 'express';
import type { Server } from 'node:http';
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  facility: vi.fn(),
}));
vi.mock('../db/index.ts', () => ({ pool: { connect: mock.connect, query: mock.query }, db: {} }));
vi.mock('../db/queries.ts', () => ({ getFacilityByIdScoped: mock.facility }));
vi.mock('../budget-planning/workbook.ts', async (original) => ({
  ...(await original<typeof import('../budget-planning/workbook.ts')>()),
  parseWorkbook: vi.fn(async () => ({
    sheets: [
      {
        name: 'CSV',
        rows: [
          [
            { value: 'Gloves' },
            { value: 'Box' },
            { value: 100 },
            ...Array.from({ length: 12 }, () => ({ value: 1 })),
          ],
        ],
      },
    ],
  })),
}));
import * as planning from '../budget-planning/planning.service.ts';
import { resolveImportDestination } from '../budget-planning/import-destination.ts';
import routes from '../budget-planning/planning.routes.ts';
const scope = { tenantId: 7, facilityId: 9, actorId: 12 };
const input = {
  destination: 'EXISTING',
  mode: 'SKIP',
  planId: 41,
  version: 1,
  financialYear: 2026,
  planType: 'MIXED',
  currency: 'KES',
  inflationPercent: '5',
  policy: 'ZERO_FILL',
  mappings: [
    {
      sheet: 'CSV',
      kind: 'ITEM',
      startRow: 1,
      endRow: 1,
      category: 'OPD CONSUMABLES',
      description: 'A',
      unit: 'B',
      price: 'C',
      months: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
    },
  ],
};
let plan: any, batch: any, priorPlans: any[], matches: any[], active: boolean;
const client = { query: mock.query, release: mock.release } as unknown as PoolClient;
const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
beforeEach(() => {
  vi.clearAllMocks();
  plan = {
    id: 41,
    tenant_id: 7,
    facility_id: 9,
    name: 'Syrona Medical Center Annual Plan 2026',
    financial_year: 2026,
    plan_type: 'MIXED',
    currency: 'KES',
    inflation_bp: 500,
    version: 1,
    status: 'DRAFT',
  };
  batch = {
    id: 88,
    tenant_id: 7,
    facility_id: 9,
    status: 'UPLOADED',
    filename: 'synthetic.csv',
    mime: 'text/csv',
    source_bytes: Buffer.from('mocked source'),
    sha256: 'retained-original-source-hash',
    validation: null,
  };
  priorPlans = [];
  matches = [];
  active = true;
  mock.connect.mockResolvedValue(client);
  mock.facility.mockImplementation(async (ctx, id) =>
    ctx.tenantId === 7 && id === 9 ? { id: 9, tenantId: 7 } : undefined,
  );
  mock.query.mockImplementation(async (sql: string, params: any[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock'))
      return result();
    if (sql.startsWith('SELECT * FROM planning_import_batches'))
      return result(params[0] === 88 && params[1] === 7 && params[2] === 9 ? [batch] : []);
    if (sql.startsWith('SELECT id,name FROM facilities'))
      return result(
        params[0] === 9 && params[1] === 7 ? [{ id: 9, name: 'Synthetic facility' }] : [],
      );
    if (sql.startsWith('SELECT * FROM planning_plans'))
      return result(
        params[0] === plan.id && params[1] === plan.tenant_id && params[2] === plan.facility_id
          ? [{ ...plan }]
          : [],
      );
    if (
      sql.startsWith('SELECT id,name,status FROM planning_plans') ||
      sql.startsWith('SELECT id FROM planning_plans')
    )
      return result(priorPlans);
    if (sql.startsWith('UPDATE planning_import_batches SET validation')) {
      batch.validation = JSON.parse(params[1]);
      return result();
    }
    if (sql.startsWith('SELECT id,name,is_active FROM planning_categories'))
      return result([{ id: 61, name: 'OPD CONSUMABLES', is_active: active }]);
    if (sql.startsWith('SELECT * FROM planning_categories'))
      return result([{ id: 61, plan_id: plan.id, name: 'OPD CONSUMABLES', is_active: active }]);
    if (sql.startsWith('SELECT id FROM planning_items')) return result(matches);
    if (sql.startsWith('INSERT INTO planning_plans'))
      return result([{ ...plan, id: 91, name: params[2] }]);
    if (sql.startsWith('INSERT INTO planning_items'))
      return result([{ id: 301, plan_id: params[0], source_import_id: 88 }]);
    if (
      sql.startsWith('INSERT INTO planning_months') ||
      sql.startsWith('INSERT INTO planning_events') ||
      sql.startsWith('INSERT INTO audit_logs')
    )
      return result();
    if (sql.startsWith('UPDATE planning_plans SET version'))
      return result([{ ...plan, id: params[0], version: 2 }]);
    if (sql.startsWith("UPDATE planning_import_batches SET status='IMPORTED'")) {
      batch.status = 'IMPORTED';
      batch.result = JSON.parse(params[1]);
      return result();
    }
    throw Error('Unexpected mocked SQL: ' + sql);
  });
});
const writeCalls = () =>
  mock.query.mock.calls.filter(([sql]) =>
    /^(INSERT INTO planning_(plans|items|uniforms|months|categories)|UPDATE planning_(plans|items|uniforms))/.test(
      sql,
    ),
  );

describe('destination validation and durable preview binding (all SQL mocked; no database imports)', () => {
  it('previews a scoped existing plan and records destination, assumptions and reconciliation counts', async () => {
    const p = await planning.previewImport(scope, 88, input);
    expect(p.destination).toMatchObject({
      kind: 'EXISTING',
      planId: 41,
      name: plan.name,
      facilityId: 9,
      financialYear: 2026,
      planType: 'MIXED',
      currency: 'KES',
      inflationBp: 500,
      version: 1,
    });
    expect(p.counts).toEqual({
      newItems: 1,
      matchingItems: 0,
      skippedItems: 0,
      conflictingItems: 0,
      updates: 0,
    });
    expect(batch.validation.destination).toEqual(p.destination);
    expect(writeCalls()).toEqual([]);
  });
  it('routes an existing-plan confirmation through the existing writer without ever creating another plan (mock only)', async () => {
    const p = await planning.previewImport(scope, 88, input);
    mock.query.mockClear();
    expect(
      await planning.confirmImport(scope, 88, {
        ...input,
        confirm: true,
        previewHash: p.previewHash,
      }),
    ).toMatchObject({ planId: 41, created: 1 });
    expect(
      mock.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO planning_plans')),
    ).toBe(false);
    const insert = mock.query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO planning_items'),
    )!;
    expect(insert[1]?.slice(8, 11)).toEqual([88, 'CSV', 1]);
    expect(mock.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE planning_items'))).toBe(
      false,
    );
  });
  it('allows deliberate new-draft creation only after a bound preview (mock only)', async () => {
    const n = {
      ...input,
      destination: 'NEW',
      mode: 'NEW',
      planId: '',
      version: 0,
      name: 'Separate reviewed projection',
    };
    const p = await planning.previewImport(scope, 88, n);
    expect(p.destination).toMatchObject({ kind: 'NEW', planId: null, name: n.name });
    mock.query.mockClear();
    expect(
      await planning.confirmImport(scope, 88, { ...n, confirm: true, previewHash: p.previewHash }),
    ).toMatchObject({ planId: 91, created: 1 });
    expect(
      mock.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO planning_plans')),
    ).toHaveLength(1);
  });
  it('requires explicit authorization when another active facility/year plan exists', async () => {
    priorPlans = [{ id: 41, name: plan.name, status: 'DRAFT' }];
    const n = {
      ...input,
      destination: 'NEW',
      mode: 'NEW',
      planId: '',
      name: 'Another reviewed draft',
    };
    await expect(planning.previewImport(scope, 88, n)).rejects.toMatchObject({
      code: 'YEAR_PLAN_EXISTS',
    });
    const p = await planning.previewImport(scope, 88, { ...n, confirmAdditionalPlan: true });
    expect(p.destination.existingPlans).toEqual(priorPlans);
    expect(writeCalls()).toEqual([]);
    await expect(
      planning.previewImport(scope, 88, { ...n, name: plan.name, confirmAdditionalPlan: true }),
    ).rejects.toMatchObject({ code: 'PLAN_NAME_EXISTS' });
  });
  it.each([
    ['planId', 99, 'PLAN_NOT_FOUND'],
    ['financialYear', 2027, 'YEAR_MISMATCH'],
    ['currency', 'USD', 'CURRENCY_MISMATCH'],
    ['planType', 'BRANDING', 'PLAN_TYPE_MISMATCH'],
    ['inflationPercent', '10', 'ASSUMPTION_MISMATCH'],
    ['version', 2, 'PLAN_VERSION_CONFLICT'],
    ['destination', undefined, 'DESTINATION_REQUIRED'],
  ])('rejects incompatible %s on the server', async (key, value, code) => {
    await expect(
      planning.previewImport(scope, 88, { ...input, [String(key)]: value }),
    ).rejects.toMatchObject({ code });
    expect(writeCalls()).toEqual([]);
  });
  it.each(['REVIEW', 'APPROVED', 'ARCHIVED'])(
    'rejects %s targets even with an explicit plan ID',
    async (status) => {
      plan.status = status;
      await expect(planning.previewImport(scope, 88, input)).rejects.toMatchObject({
        code: 'PLAN_PROTECTED',
      });
      expect(writeCalls()).toEqual([]);
    },
  );
  it('rejects a cross-tenant/facility target via scoped SQL, independently of browser IDs', async () => {
    plan.facility_id = 10;
    await expect(planning.previewImport(scope, 88, input)).rejects.toMatchObject({
      code: 'PLAN_NOT_FOUND',
    });
    plan.facility_id = 9;
    plan.tenant_id = 8;
    await expect(planning.previewImport(scope, 88, input)).rejects.toMatchObject({
      code: 'PLAN_NOT_FOUND',
    });
    await expect(
      resolveImportDestination(client, { ...scope, facilityId: 10 }, input),
    ).rejects.toMatchObject({ code: 'FACILITY_NOT_FOUND' });
  });
  it.each([
    { planId: 99 },
    { destination: 'NEW', mode: 'NEW', planId: '', name: 'Substitution' },
    { mode: 'UPDATE' },
    { currency: 'USD' },
    { financialYear: 2027 },
    { planType: 'BRANDING' },
    { version: 2 },
  ])('rejects destination substitution %j before writes', async (change) => {
    const p = await planning.previewImport(scope, 88, input);
    mock.query.mockClear();
    await expect(
      planning.confirmImport(scope, 88, {
        ...input,
        ...change,
        confirm: true,
        confirmUpdate: true,
        previewHash: p.previewHash,
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' });
    expect(writeCalls()).toEqual([]);
  });
  it('rejects changed source, mappings, policy, assumptions and stale legacy previews', async () => {
    const p = await planning.previewImport(scope, 88, input);
    await expect(
      planning.confirmImport(scope, 88, {
        ...input,
        confirm: true,
        policy: 'STRICT',
        previewHash: p.previewHash,
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    batch.sha256 = 'changed-source-hash';
    await expect(
      planning.confirmImport(scope, 88, { ...input, confirm: true, previewHash: p.previewHash }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    batch.validation = { previewHash: p.previewHash };
    await expect(
      planning.confirmImport(scope, 88, { ...input, confirm: true, previewHash: p.previewHash }),
    ).rejects.toMatchObject({ code: 'DESTINATION_PREVIEW_REQUIRED' });
    expect(writeCalls()).toEqual([]);
  });
  it('revalidates the current target version and closed status at confirmation', async () => {
    const p = await planning.previewImport(scope, 88, input);
    plan.version = 2;
    await expect(
      planning.confirmImport(scope, 88, { ...input, confirm: true, previewHash: p.previewHash }),
    ).rejects.toMatchObject({ code: 'PLAN_VERSION_CONFLICT' });
    plan.version = 1;
    plan.status = 'ARCHIVED';
    await expect(
      planning.confirmImport(scope, 88, { ...input, confirm: true, previewHash: p.previewHash }),
    ).rejects.toMatchObject({ code: 'PLAN_PROTECTED' });
    expect(writeCalls()).toEqual([]);
  });
  it('retains duplicate-import idempotency only for the same reviewed destination', async () => {
    const p = await planning.previewImport(scope, 88, input);
    const result = await planning.confirmImport(scope, 88, {
      ...input,
      confirm: true,
      previewHash: p.previewHash,
    });
    mock.query.mockClear();
    expect(
      await planning.confirmImport(scope, 88, {
        ...input,
        confirm: true,
        previewHash: p.previewHash,
      }),
    ).toEqual(result);
    expect(writeCalls()).toEqual([]);
    await expect(
      planning.confirmImport(scope, 88, {
        ...input,
        planId: 99,
        confirm: true,
        previewHash: p.previewHash,
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' });
  });
  it('skips imported matches without altering manual entries or imported data (mock only)', async () => {
    matches = [{ id: 302 }];
    const p = await planning.previewImport(scope, 88, input);
    expect(p.counts).toMatchObject({ newItems: 0, matchingItems: 1, skippedItems: 1, updates: 0 });
    mock.query.mockClear();
    expect(
      await planning.confirmImport(scope, 88, {
        ...input,
        confirm: true,
        previewHash: p.previewHash,
      }),
    ).toMatchObject({ skipped: 1, created: 0, updated: 0 });
    expect(
      mock.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT INTO) planning_items/.test(sql)),
    ).toBe(false);
    expect(
      mock.query.mock.calls.find(([sql]) => sql.startsWith('SELECT id FROM planning_items'))?.[0],
    ).toContain('source_import_id IS NOT NULL');
  });
  it('shows explicit-update counts but refuses update confirmation without the independent update acknowledgement', async () => {
    matches = [{ id: 302 }];
    const p = await planning.previewImport(scope, 88, { ...input, mode: 'UPDATE' });
    expect(p.counts.updates).toBe(1);
    mock.query.mockClear();
    await expect(
      planning.confirmImport(scope, 88, {
        ...input,
        mode: 'UPDATE',
        confirm: true,
        previewHash: p.previewHash,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRM_UPDATE' });
    expect(writeCalls()).toEqual([]);
  });
  it('rejects changed match counts and reports ambiguous/inactive conflicts without overwriting anything', async () => {
    const p = await planning.previewImport(scope, 88, input);
    matches = [{ id: 302 }];
    await expect(
      planning.confirmImport(scope, 88, { ...input, confirm: true, previewHash: p.previewHash }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    matches = [{ id: 302 }, { id: 303 }];
    expect((await planning.previewImport(scope, 88, input)).counts.conflictingItems).toBe(1);
    active = false;
    expect((await planning.previewImport(scope, 88, input)).counts.conflictingItems).toBe(1);
    expect(writeCalls()).toEqual([]);
  });
});

describe('real permission middleware on destination-preview routes, mocked data access', () => {
  let server: Server, base: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      if (req.get('X-Test-Unauth') !== '1') {
        (req as any).user = { id: 12 };
        (req as any).authContext = {
          userId: 12,
          tenantId: 7,
          facilityId: 9,
          roles: ['FACILITY_ADMIN'],
          isSuperAdmin: false,
          permissions: [
            'accounting.read',
            'accounting.planning.read',
            ...(req.get('X-Test-Read') === '1'
              ? []
              : ['accounting.planning.manage', 'accounting.planning.import']),
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
  });
  const request = (headers: Record<string, string> = {}, facilityId = 9) =>
    fetch(`${base}/imports/88/preview?facilityId=${facilityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(input),
    });
  it('rejects unauthenticated and read-only callers without preview writes', async () => {
    expect((await request({ 'X-Test-Unauth': '1' })).status).toBe(401);
    expect((await request({ 'X-Test-Read': '1' })).status).toBe(403);
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it('rejects a browser-supplied out-of-scope facility', async () => {
    expect((await request({}, 10)).status).toBe(403);
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it('permits an authorized destination preview only', async () => {
    const r = await request();
    expect(r.status).toBe(200);
    expect((await r.json()).destination.planId).toBe(41);
    expect(writeCalls()).toEqual([]);
  });
});
