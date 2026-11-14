import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pool } from '../db/index.ts';
import * as planning from '../budget-planning/planning.service.ts';
import * as reports from '../budget-planning/reports.service.ts';
import { parseWorkbook, previewWorkbook, type Mapping } from '../budget-planning/workbook.ts';
import routes from '../budget-planning/planning.routes.ts';
import { uploadLetterhead, activateLetterhead } from '../branding/letterhead.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { describeDb } from './vitest/support/db.ts';

describeDb('synthetic budget planning database workflows', () => {
  const suffix = randomUUID().slice(0, 8);
  let s: planning.PlanningScope,
    other: planning.PlanningScope,
    approver: planning.PlanningScope,
    context: AuthorizationContext,
    server: Server,
    base: string;
  const permissions = ['read', 'manage', 'import', 'approve', 'export', 'audit'].map(
    (p) => 'accounting.planning.' + p,
  );
  let p: planning.Plan, categoryId: number, itemId: number, uniformId: number;
  const input = {
    name: 'Synthetic 2026',
    planType: 'MIXED',
    financialYear: 2026,
    currency: 'KES',
    inflationPercent: '5',
  };
  const item = (version: number, q: unknown[] = Array(12).fill('2')) => ({
    version,
    categoryId,
    description: 'Synthetic gloves',
    unit: 'Box',
    basePrice: '10.01',
    quantities: q,
  });
  const mapping: Mapping = {
    sheet: 'Stationery',
    kind: 'ITEM',
    startRow: 1,
    endRow: 1,
    category: 'OPD CONSUMABLES',
    description: 'A',
    unit: 'B',
    price: 'C',
    months: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
  };
  const bytes = (price = 10) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([['Synthetic imported item', 'Box', price, ...Array(12).fill(3)]]),
      'Stationery',
    );
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const current = async () => (p = (await reports.projection(s, p.id)).plan);
  const api = async (path: string, body?: unknown, extra: Record<string, string> = {}) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  beforeAll(async () => {
    if (
      !/test|synthetic/i.test(process.env.SQL_DB_NAME ?? '') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    )
      throw new Error('Use an explicitly disposable local synthetic/test database.');
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic planning tenant',
        `budget-${suffix}`,
      ])
    ).rows[0].id;
    const f = (
      await pool.query(
        'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$4,$5),($1,$3,$6,$5) RETURNING id',
        [
          tenant,
          `BA-${suffix}`,
          `BB-${suffix}`,
          'Synthetic planning facility',
          JSON.stringify(['accounting']),
          'Synthetic other facility',
        ],
      )
    ).rows;
    const users = [];
    for (let n = 0; n < 2; n++)
      users.push(
        (
          await pool.query(
            "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic planner','not-for-login',$3,$4) RETURNING id",
            [`budget-${suffix}-${n}`, `budget-${suffix}-${n}@example.test`, tenant, f[0].id],
          )
        ).rows[0].id,
      );
    s = { tenantId: tenant, facilityId: f[0].id, actorId: users[0] };
    other = { ...s, facilityId: f[1].id };
    approver = { ...s, actorId: users[1] };
    context = {
      userId: s.actorId,
      tenantId: tenant,
      facilityId: s.facilityId,
      roles: ['FACILITY_ADMIN'],
      permissions: [
        'accounting.read',
        ...permissions,
        'facility.branding.read',
        'facility.branding.manage',
      ],
      isSuperAdmin: false,
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      if (req.get('X-Test-Unauth') !== '1') {
        (req as any).user = { id: s.actorId };
        (req as any).authContext = {
          ...context,
          ...(req.get('X-Test-Read') === '1'
            ? { permissions: ['accounting.read', 'accounting.planning.read'] }
            : {}),
          ...(req.get('X-Test-Super') === '1' ? { isSuperAdmin: true } : {}),
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
  it('creates separate scoped draft with configurable inflation', async () => {
    p = await planning.createPlan(s, input);
    expect(p).toMatchObject({ status: 'DRAFT', inflation_bp: 500, version: 1 });
    expect((await planning.listPlans(other, {})).total).toBe(0);
  });
  it('requires explicit additional-plan confirmation without replacing existing', async () => {
    await expect(planning.createPlan(s, { ...input, name: 'Other' })).rejects.toMatchObject({
      code: 'YEAR_PLAN_EXISTS',
    });
  });
  it('creates category and twelve normalized monthly child records', async () => {
    const r = await planning.saveCategory(s, p.id, null, {
      version: p.version,
      name: 'DENTAL CONSUABLES',
    });
    p = r.plan;
    categoryId = r.changedId!;
    const saved = await planning.saveItem(s, p.id, null, item(p.version));
    p = saved.plan;
    itemId = saved.changedId!;
    const d = await reports.projection(s, p.id);
    expect(d.items[0].months).toHaveLength(12);
    expect(d.summary.annualItemCents).toBe('25224');
  });
  it('rejects stale revision and out-of-facility plan and category', async () => {
    await expect(planning.saveItem(s, p.id, itemId, item(1))).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    await expect(planning.saveItem(other, p.id, itemId, item(p.version))).rejects.toMatchObject({
      code: 'PLAN_NOT_FOUND',
    });
    await expect(
      reports.projection({ ...s, tenantId: s.tenantId + 99999 }, p.id),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    await expect(
      planning.saveItem(s, p.id, null, { ...item(p.version), categoryId: 99999999 }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });
  it('updates explicit zero/null distinctly and blocks review with blanks', async () => {
    const r = await planning.saveItem(
      s,
      p.id,
      itemId,
      item(p.version, [null, '0', ...Array(10).fill('2')]),
    );
    p = r.plan;
    const d = await reports.projection(s, p.id);
    expect(d.items[0].months[0].amount_cents).toBeNull();
    expect(d.items[0].months[1].amount_cents).toBe('0');
    await expect(
      planning.transitionPlan(s, p.id, { version: p.version, status: 'REVIEW' }),
    ).rejects.toMatchObject({ code: 'UNPLANNED_MONTHS' });
    p = (await planning.saveItem(s, p.id, itemId, item(p.version))).plan;
  });
  it('recalculates all months when plan assumption changes', async () => {
    p = (
      await planning.updatePlan(s, p.id, {
        version: p.version,
        name: p.name,
        inflationPercent: '10',
      })
    ).plan;
    const d = await reports.projection(s, p.id);
    expect(d.items[0].adjusted_price_cents).toBe('1101');
    expect(d.summary.annualItemCents).toBe('26424');
  });
  it('calculates, updates and separately filters uniforms', async () => {
    const u = {
      version: p.version,
      categoryId,
      description: 'Synthetic uniform',
      existingBalance: '3',
      balanceLabel: 'December 2025',
      buyingCost: '1000',
      staffCount: 10,
      quantityPerStaff: '2',
      contributionPercent: '50',
      balanceRule: 'SUBTRACT',
    };
    const saved = await planning.saveUniform(s, p.id, null, u);
    p = saved.plan;
    uniformId = saved.changedId!;
    expect((await reports.projection(s, p.id)).summary.uniformAnnualCents).toBe('850000');
    p = (
      await planning.saveUniform(s, p.id, uniformId, { ...u, version: p.version, staffCount: 11 })
    ).plan;
    expect((await reports.projection(s, p.id)).summary.uniformAnnualCents).toBe('950000');
  });
  it('filters real monthly dates, names, units and categories', async () => {
    const d = await reports.projection(s, p.id, {
      month: 2,
      from: '2026-02-01',
      to: '2026-02-28',
      search: 'gloves',
      unit: 'box',
      categoryId,
    });
    expect(d.items).toHaveLength(1);
    expect(d.items[0].months).toHaveLength(1);
    expect(d.summary.selectedItemCents).toBe('2202');
    expect(
      (await reports.projection(s, p.id, { from: '2026-02-02', to: '2026-02-28' })).summary
        .selectedItemCents,
    ).toBe('0');
    await expect(reports.projection(s, p.id, { from: '2026-02-30' })).rejects.toMatchObject({
      code: 'INVALID_DATE',
    });
  });
  it('keeps draft removals as audited inactive records', async () => {
    p = (await planning.archiveRecord(s, p.id, 'uniforms', uniformId, p.version)).plan;
    expect((await reports.projection(s, p.id)).uniforms).toHaveLength(0);
    const events = await planning.auditHistory(s, p.id);
    expect(events.find((e) => e.action === 'ARCHIVE_RECORD')).toMatchObject({
      previous_values: { is_active: true },
      updated_values: { is_active: false },
    });
  });
  it('imports only after hash-matched explicit confirmation and is idempotent', async () => {
    const batch = await planning.upload(s, bytes(), 'synthetic.xlsx', mime);
    const preview = await planning.previewImport(s, batch.id, {
      mappings: [mapping],
      inflationPercent: '10',
    });
    const body = {
      ...input,
      mode: 'SKIP',
      planId: p.id,
      version: p.version,
      financialYear: 2026,
      inflationPercent: '10',
      mappings: [mapping],
      previewHash: preview.previewHash,
    };
    await expect(planning.confirmImport(s, batch.id, body)).rejects.toMatchObject({
      code: 'CONFIRM_REQUIRED',
    });
    await expect(
      planning.confirmImport(s, batch.id, { ...body, confirm: true, previewHash: 'invalid' }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    const r = await planning.confirmImport(s, batch.id, { ...body, confirm: true });
    expect(r).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(await planning.confirmImport(s, batch.id, { confirm: true })).toEqual(r);
    await current();
    await expect(planning.upload(s, bytes(), 'again.xlsx', mime)).rejects.toMatchObject({
      code: 'DUPLICATE_UPLOAD',
    });
    await expect(planning.inspectBatch(other, batch.id)).rejects.toMatchObject({
      code: 'IMPORT_NOT_FOUND',
    });
  });
  it('supports skip and explicit update merge modes', async () => {
    for (const [price, mode] of [
      [20, 'SKIP'],
      [30, 'UPDATE'],
    ] as const) {
      const b = await planning.upload(s, bytes(price), `synthetic-${price}.xlsx`, mime);
      const preview = await planning.previewImport(s, b.id, {
        mappings: [mapping],
        inflationPercent: '10',
      });
      const body = {
        ...input,
        financialYear: 2026,
        inflationPercent: '10',
        mode,
        planId: p.id,
        version: p.version,
        confirm: true,
        mappings: [mapping],
        previewHash: preview.previewHash,
      };
      if (mode === 'UPDATE')
        await expect(planning.confirmImport(s, b.id, body)).rejects.toMatchObject({
          code: 'CONFIRM_UPDATE',
        });
      const r = await planning.confirmImport(s, b.id, { ...body, confirmUpdate: true });
      expect(r[mode === 'SKIP' ? 'skipped' : 'updated']).toBe(1);
      if (mode === 'UPDATE') {
        const audit = await pool.query(
          "SELECT updated_values,previous_values FROM planning_events WHERE plan_id=$1 AND action='IMPORT_UPDATE' ORDER BY id DESC LIMIT 1",
          [p.id],
        );
        expect(audit.rows[0].updated_values.source_import_id).toBe(b.id);
        expect(audit.rows[0].previous_values.source_import_id).not.toBe(b.id);
      }
      await current();
    }
    expect(
      (await reports.projection(s, p.id, { search: 'imported' })).items[0].base_price_cents,
    ).toBe('3000');
  });
  it('cancels without importing any plan records', async () => {
    const b = await planning.upload(s, bytes(41), 'cancel.xlsx', mime);
    await planning.cancelImport(s, b.id);
    expect((await planning.importHistory(s)).find((r) => r.id === b.id).status).toBe('CANCELLED');
    await expect(
      planning.previewImport(s, b.id, { mappings: [mapping], inflationPercent: '10' }),
    ).rejects.toMatchObject({ code: 'IMPORT_CLOSED' });
  });
  it('enforces read/manage/export/audit permissions and authenticated facility scoping', async () => {
    expect((await api('/plans', undefined, { 'X-Test-Unauth': '1' })).status).toBe(401);
    expect((await api('/plans', input, { 'X-Test-Read': '1' })).status).toBe(403);
    expect((await api('/audit', undefined, { 'X-Test-Read': '1' })).status).toBe(403);
    expect((await api(`/plans/${p.id}/reports`, {}, { 'X-Test-Read': '1' })).status).toBe(403);
    expect((await api(`/plans?facilityId=${other.facilityId}`)).status).toBe(403);
    expect((await api('/plans', undefined, { 'X-Test-Super': '1' })).status).toBe(403);
    expect((await api('/plans')).headers.get('cache-control')).toContain('no-store');
  });
  it('protects review/approved records and requires independent approval', async () => {
    p = (await planning.transitionPlan(s, p.id, { version: p.version, status: 'REVIEW' })).plan;
    await expect(planning.saveItem(s, p.id, itemId, item(p.version))).rejects.toMatchObject({
      code: 'PLAN_PROTECTED',
    });
    await expect(
      planning.transitionPlan(s, p.id, { version: p.version, status: 'APPROVED' }),
    ).rejects.toMatchObject({ code: 'INDEPENDENT_APPROVAL_REQUIRED' });
    p = (await planning.transitionPlan(approver, p.id, { version: p.version, status: 'APPROVED' }))
      .plan;
    await expect(
      pool.query('UPDATE planning_items SET description=$2 WHERE id=$1', [itemId, 'Tamper']),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(planning.archiveRecord(s, p.id, 'items', itemId, p.version)).rejects.toMatchObject(
      { code: 'PLAN_PROTECTED' },
    );
  });
  it('blocks fabricated actuals and missing facility uploaded letterhead', async () => {
    await expect(reports.createReport(s, p.id, { reportType: 'ACTUAL' })).rejects.toMatchObject({
      code: 'ACTUALS_NOT_AVAILABLE',
    });
    await expect(reports.createReport(s, p.id, {})).rejects.toMatchObject({
      code: 'ACTIVE_LETTERHEAD_REQUIRED',
    });
  });
  it('uploads and activates synthetic facility PDF using existing branding workflow', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('SYNTHETIC PLANNING FACILITY', {
      x: 36,
      y: 800,
      size: 16,
      font,
      color: rgb(0, 0.3, 0.4),
    });
    page.drawText('Synthetic testing only — not a live hospital', { x: 36, y: 25, size: 9, font });
    const uploaded = await uploadLetterhead(context, {
      facilityId: s.facilityId,
      filename: 'synthetic-letterhead.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(await doc.save()),
      body: { bodyTopPt: 85, bodyBottomPt: 60, bodyLeftPt: 36, bodyRightPt: 36 },
    });
    await activateLetterhead(context, uploaded.letterhead.id);
  });
  it('issues filtered branded PDF and Excel; retains exact reprint bytes and history', async () => {
    const r = await reports.createReport(s, p.id, { reportType: 'MONTHLY', month: 2 });
    expect(r.letterheadApplied).toBe(true);
    const pdf = await reports.reportFile(s, r.id, 'pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
    const xlsx = XLSX.read(await reports.reportFile(s, r.id, 'xlsx'), { type: 'buffer' });
    expect(xlsx.SheetNames).toContain('Months');
    const history = await reports.reportHistory(s, p.id);
    expect(history[0].letterhead_id).toBe(r.letterhead_id);
    expect((await reports.reportFile(s, r.id, 'pdf')).equals(pdf)).toBe(true);
    await expect(reports.reportFile(other, r.id, 'pdf')).rejects.toMatchObject({
      code: 'REPORT_NOT_FOUND',
    });
    await expect(
      pool.query('UPDATE planning_reports SET report_type=$2 WHERE id=$1', [r.id, 'TAMPER']),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM planning_events WHERE plan_id=$1', [p.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('paginates and sorts large plans without paginating report totals', async () => {
    let large = await planning.createPlan(s, {
      ...input,
      name: 'Synthetic multipage 2027',
      financialYear: 2027,
    });
    const cat = await planning.saveCategory(s, large.id, null, {
      version: large.version,
      name: 'CONSUMABLE ITEMS',
    });
    large = cat.plan;
    for (let n = 0; n < 62; n++)
      large = (
        await planning.saveItem(s, large.id, null, {
          ...item(large.version),
          categoryId: cat.changedId,
          description: `Synthetic item ${String(n).padStart(3, '0')}`,
        })
      ).plan;
    const first = await reports.projection(s, large.id, { sort: 'description', direction: 'asc' });
    const second = await reports.projection(s, large.id, { page: 2 });
    expect(first.totalItems).toBe(62);
    expect(first.items).toHaveLength(20);
    expect(second.items[0].description).toBe('Synthetic item 020');
    expect(first.summary.annualItemCents).toBe(second.summary.annualItemCents);
    const issued = await reports.createReport(s, large.id, { reportType: 'ANNUAL' });
    expect(issued.pages).toBeGreaterThan(1);
    expect(
      (await PDFDocument.load(await reports.reportFile(s, issued.id, 'pdf'))).getPageCount(),
    ).toBe(issued.pages);
    const model = (await pool.query('SELECT model FROM planning_reports WHERE id=$1', [issued.id]))
      .rows[0].model;
    expect(model.table.rows).toHaveLength(62);
  });
  it('exports YoY issued rows and category/item/branding selections consistently', async () => {
    const prior = await planning.createPlan(s, {
      ...input,
      name: 'Synthetic prior year',
      financialYear: 2025,
    });
    const r = await reports.createReport(s, p.id, { reportType: 'YOY', priorPlanId: prior.id });
    const x = XLSX.read(await reports.reportFile(s, r.id, 'xlsx'), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(x.Sheets['Issued report rows'], { header: 1 });
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).toContain('2025');
    await expect(
      reports.createReport(s, p.id, { reportType: 'YOY', priorPlanId: prior.id, month: 2 }),
    ).rejects.toMatchObject({ code: 'YOY_FULL_YEAR_REQUIRED' });
    for (const reportType of ['CATEGORY', 'ITEM', 'BRANDING']) {
      const r = await reports.createReport(s, p.id, { reportType, categoryId });
      expect(r.letterheadApplied).toBe(true);
    }
    expect((await reports.projection(s, p.id, { itemId })).uniforms).toHaveLength(0);
  });
  it('retains original issued PDF after a new uploaded letterhead is activated', async () => {
    const issued = await reports.createReport(s, p.id, {});
    const original = await reports.reportFile(s, issued.id, 'pdf');
    const doc = await PDFDocument.create();
    doc
      .addPage([595.28, 841.89])
      .drawText('SYNTHETIC REPLACEMENT LETTERHEAD', { x: 36, y: 800, size: 12 });
    const upload = await uploadLetterhead(context, {
      facilityId: s.facilityId,
      filename: 'synthetic-replacement.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(await doc.save()),
      body: { bodyTopPt: 85, bodyBottomPt: 60, bodyLeftPt: 36, bodyRightPt: 36 },
    });
    await activateLetterhead(context, upload.letterhead.id);
    expect((await reports.reportFile(s, issued.id, 'pdf')).equals(original)).toBe(true);
    const next = await reports.createReport(s, p.id, {});
    expect(next.letterhead_id).not.toBe(issued.letterhead_id);
    expect((await reports.historicalBranding(s, issued.id))?.id).toBe(issued.letterhead_id);
  });
  it('soft removes draft items while protecting referenced categories', async () => {
    let draft = await planning.createPlan(s, {
      ...input,
      name: 'Synthetic removal',
      financialYear: 2028,
    });
    const cat = await planning.saveCategory(s, draft.id, null, {
      version: draft.version,
      name: 'OPD CONSUMABLES',
    });
    draft = cat.plan;
    const record = await planning.saveItem(s, draft.id, null, {
      ...item(draft.version),
      categoryId: cat.changedId,
    });
    draft = record.plan;
    await expect(
      planning.saveCategory(s, draft.id, cat.changedId, {
        version: draft.version,
        name: 'OPD CONSUMABLES',
        isActive: false,
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
    draft = (await planning.archiveRecord(s, draft.id, 'items', record.changedId, draft.version))
      .plan;
    expect((await reports.projection(s, draft.id)).totalItems).toBe(0);
    await planning.saveCategory(s, draft.id, cat.changedId, {
      version: draft.version,
      name: 'OPD CONSUMABLES',
      isActive: false,
    });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM planning_months WHERE item_id=$1', [
          record.changedId,
        ])
      ).rows[0].n,
    ).toBe(12);
  });
  it('processes a synthetic 232-item stationery workload plus separate branding and uniform blocks', async () => {
    const book = XLSX.utils.book_new();
    const stationery: unknown[][] = [
      ['Description', 'Unit', 'Base price', ...Array(12).fill('Quantity')],
    ];
    const maps: Mapping[] = [];
    let row = 2;
    for (const [category, count] of [
      ['OPD CONSUMABLES', 133],
      ['DENTAL CONSUABLES', 40],
      ['CONSUMABLE ITEMS', 59],
    ] as const) {
      const start = row;
      for (let n = 0; n < count; n++, row++)
        stationery.push([`Synthetic ${category} ${n + 1}`, 'Pack', 100, ...Array(12).fill(1)]);
      maps.push({ ...mapping, startRow: start, endRow: row - 1, category });
    }
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(stationery), 'Stationery');
    const branding: unknown[][] = Array.from({ length: 26 }, () => []);
    branding[0] = ['Synthetic branding inputs'];
    for (let n = 1; n <= 5; n++)
      branding[n] = [`Synthetic branding ${n}`, 'Each', 500, ...Array(12).fill(2)];
    for (let n = 19; n <= 25; n++)
      branding[n] = [`Synthetic uniform ${n - 18}`, 2, 1000, 50, 10, 2];
    const sheet = XLSX.utils.aoa_to_sheet(branding);
    for (let n = 20; n <= 26; n++) sheet[`G${n}`] = { t: 'n', v: 99999, f: `E${n}*F${n}` };
    XLSX.utils.book_append_sheet(book, sheet, 'Branding');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Sheet3');
    maps.push({ ...mapping, sheet: 'Branding', startRow: 2, endRow: 6, category: 'Branding' });
    maps.push({
      sheet: 'Branding',
      kind: 'UNIFORM',
      startRow: 20,
      endRow: 26,
      category: 'Branding',
      description: 'A',
      existingBalance: 'B',
      price: 'C',
      contributionPercent: 'D',
      staff: 'E',
      perStaff: 'F',
      balanceRule: 'SUBTRACT',
      balanceLabel: 'December 2025',
    });
    const upload = await planning.upload(
      s,
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'synthetic-232-layout.xlsx',
      mime,
    );
    const preview = await planning.previewImport(s, upload.id, {
      mappings: maps,
      inflationPercent: '5',
    });
    expect(preview.errors).toHaveLength(0);
    expect(preview.rowCount).toBe(244);
    const imported = await planning.confirmImport(s, upload.id, {
      ...input,
      name: 'Synthetic source-count workload (NOT original workbook)',
      confirmAdditionalPlan: true,
      mode: 'NEW',
      confirm: true,
      mappings: maps,
      previewHash: preview.previewHash,
    });
    expect(imported.created).toBe(244);
    const data = await reports.projection(s, imported.planId, { all: true });
    expect(data.totalItems).toBe(237);
    expect(data.uniforms).toHaveLength(7);
    expect(
      data.categories
        .filter((c) => c.name !== 'Branding')
        .map((c) => c.name)
        .sort(),
    ).toEqual(['CONSUMABLE ITEMS', 'DENTAL CONSUABLES', 'OPD CONSUMABLES']);
    expect(data.uniforms[0].source_row).toBe(20);
    expect(data.uniforms[0].projected_quantity).toBe('20.000');
    expect(data.uniforms[0].source_formula).toContain('E20*F20');
  });
  it('requires an actually recorded preview, not only a caller-computed hash', async () => {
    const source = bytes(97);
    const b = await planning.upload(s, source, 'unpreviewed.xlsx', mime);
    const calculated = previewWorkbook(
      await parseWorkbook(source, 'unpreviewed.xlsx', mime),
      [mapping],
      '5',
    );
    await expect(
      planning.confirmImport(s, b.id, {
        ...input,
        name: 'Unpreviewed attempt',
        mode: 'NEW',
        confirm: true,
        confirmAdditionalPlan: true,
        mappings: [mapping],
        previewHash: calculated.previewHash,
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    await planning.cancelImport(s, b.id);
  });
  it('imports duplicate CSV source rows, audits defaults and supports year/facility-scoped HTTP CRUD', async () => {
    const raw = Buffer.from(`Duplicate ${suffix},,,0,1\nDuplicate ${suffix},,10,2,0\n`);
    const upload = await fetch(base + '/imports', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-Filename': 'zero-fill.csv' },
      body: raw,
    });
    expect(upload.status).toBe(201);
    const b = await upload.json();
    const m: Mapping = { ...mapping, sheet: 'CSV', startRow: 1, endRow: 2 };
    const preview = await planning.previewImport(s, b.id, { mappings: [m], inflationPercent: '5' });
    expect(preview.rowCount).toBe(2);
    expect(preview.errors).toEqual([]);
    const result = await planning.confirmImport(s, b.id, {
      ...input,
      name: 'Zero fill CSV ' + suffix,
      mode: 'NEW',
      confirm: true,
      confirmAdditionalPlan: true,
      mappings: [m],
      previewHash: preview.previewHash,
    });
    expect(result.created).toBe(2);
    expect(result.defaultedCells).toBeGreaterThan(0);
    let d = await reports.projection(s, result.planId, { all: true, year: 2026, sort: 'category' });
    expect(d.items).toHaveLength(2);
    expect(d.items[0].id).not.toBe(d.items[1].id);
    expect(
      d.items.every(
        (i) =>
          i.months.length === 12 &&
          i.months.every((m: { quantity: unknown }) => m.quantity !== null),
      ),
    ).toBe(true);
    const record = d.items.find((i) => i.base_price_cents === '1000')!;
    const url = `${base}/plans/${d.plan.id}/items/${record.id}`;
    const patch = {
      version: d.plan.version,
      categoryId: record.category_id,
      description: record.description,
      unit: record.unit,
      basePrice: '20',
      quantities: ['3', ...Array(11).fill('0')],
    };
    const readOnly = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Test-Read': '1' },
      body: JSON.stringify(patch),
    });
    expect(readOnly.status).toBe(403);
    const saved = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    expect(saved.status).toBe(200);
    const stale = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    expect(stale.status).toBe(409);
    d = await reports.projection(s, result.planId, { all: true });
    expect(d.summary.annualItemCents).toBe('6300');
    await expect(reports.projection(other, d.plan.id)).rejects.toMatchObject({
      code: 'PLAN_NOT_FOUND',
    });
    await expect(reports.projection(s, d.plan.id, { year: 2027 })).rejects.toMatchObject({
      code: 'YEAR_MISMATCH',
    });
    expect(
      (await planning.listPlans(s, { year: 2026 })).plans.some((plan) => plan.id === d.plan.id),
    ).toBe(true);
    const created = await fetch(`${base}/plans/${d.plan.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, version: d.plan.version, description: 'Manual ' + suffix }),
    });
    expect(created.status).toBe(201);
    const addition = await created.json();
    const deleted = await fetch(`${base}/plans/${d.plan.id}/items/${addition.changedId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: addition.plan.version }),
    });
    expect(deleted.status).toBe(200);
    const audit = await planning.auditHistory(s, d.plan.id);
    expect(audit.some((e) => e.action === 'ARCHIVE_RECORD')).toBe(true);
    expect(audit.some((e) => e.action === 'UPDATE_ITEM')).toBe(true);
    const batchRecord = (await planning.importHistory(s)).find((v) => v.id === b.id)!;
    expect(batchRecord.validation.policy).toBe('ZERO_FILL');
    expect(batchRecord.validation.normalizations.length).toBe(result.defaultedCells);
    const rowEvents = await pool.query(
      "SELECT * FROM planning_events WHERE plan_id=$1 AND action='UPDATE_ITEM'",
      [d.plan.id],
    );
    expect(rowEvents.rows[0].previous_values.base_price_cents).toBe('1000');
    expect(rowEvents.rows[0].updated_values.base_price_cents).toBe('2000');
  });

  it.skipIf(!process.env.SYRONA_SOURCE_DIR)(
    'persists all 241 official source rows only in the disposable test facility and exports reproducible reports',
    async () => {
      const evidence = JSON.parse(
        await readFile(
          'docs/audits/syrona-source-acceptance-evidence/source-reconciliation.json',
          'utf8',
        ),
      );
      for (const [file, count] of [
        ['Syrona_Stationery.csv', 232],
        ['Syrona_Branding.csv', 9],
      ] as const) {
        const sourceBytes = await readFile(path.join(process.env.SYRONA_SOURCE_DIR!, file));
        const b = await planning.upload(s, sourceBytes, file, 'text/csv');
        const mappings: Mapping[] = evidence.mappings
          .filter(
            (m: Mapping) => m.sheet === (file.includes('Stationery') ? 'Stationery' : 'Branding'),
          )
          .map((m: Mapping) => ({ ...m, sheet: 'CSV' }));
        if (count === 9)
          mappings.push({
            sheet: 'CSV',
            kind: 'UNIFORM',
            startRow: 22,
            endRow: 25,
            category: 'Uniforms',
            description: 'C',
            price: 'E',
            existingBalance: 'D',
            staff: 'G',
            perStaff: 'H',
            balanceRule: 'SUBTRACT',
            balanceLabel: 'December 2025 — test zero-fill assumption',
          });
        const preview = await planning.previewImport(s, b.id, { mappings, inflationPercent: '5' });
        expect(preview.errors).toEqual([]);
        expect(preview.rowCount).toBe(count);
        const result = await planning.confirmImport(s, b.id, {
          ...input,
          name: 'Official CSV isolated test ' + file,
          mode: 'NEW',
          confirm: true,
          confirmAdditionalPlan: true,
          mappings,
          previewHash: preview.previewHash,
        });
        expect(result.created).toBe(count);
        const d = await reports.projection(s, result.planId, { all: true, year: 2026 });
        expect(d.items.length + d.uniforms.length).toBe(count);
        if (count === 232) expect(d.summary.annualItemCents).toBe('26304600');
        const report = await reports.createReport(s, result.planId, { reportType: 'ANNUAL' });
        const pdf = await reports.reportFile(s, report.id, 'pdf');
        expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(count === 232 ? 1 : 0);
        expect((await reports.reportFile(s, report.id, 'pdf')).equals(pdf)).toBe(true);
        const excel = XLSX.read(await reports.reportFile(s, report.id, 'xlsx'), { type: 'buffer' });
        expect(excel.SheetNames).toContain('Months');
        const sourceRecord = await pool.query(
          'SELECT source_bytes,validation FROM planning_import_batches WHERE id=$1',
          [b.id],
        );
        expect(sourceRecord.rows[0].source_bytes.equals(sourceBytes)).toBe(true);
      }
    },
  );
});
