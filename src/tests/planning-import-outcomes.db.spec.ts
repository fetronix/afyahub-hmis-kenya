import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { describeDb } from './vitest/support/db.ts';
import { pool } from '../db/index.ts';
import * as planning from '../budget-planning/planning.service.ts';
import {
  importResults,
  importSummary,
  resultsCsv,
} from '../budget-planning/import-results.service.ts';
import routes from '../budget-planning/planning.routes.ts';
import { csvRows } from '../budget-planning/csv.mjs';

describeDb('disposable import outcomes — committed evidence only', () => {
  let s: planning.PlanningScope, other: planning.PlanningScope, server: Server, base: string;
  beforeAll(async () => {
    if (
      process.env.IMPORT_OUTCOMES_SYNTHETIC !== 'YES' ||
      process.env.SQL_DB_NAME !== 'import_outcomes_synthetic_test' ||
      process.env.SQL_HOST !== '127.0.0.1'
    )
      throw Error(
        'New disposable outcomes database required; never run this fixture on production.',
      );
    const suffix = randomUUID();
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic outcomes tenant',
        suffix,
      ])
    ).rows[0].id;
    const facilities = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic outcomes facility','[\"accounting\"]'),($1,$3,'Other synthetic facility','[\"accounting\"]') RETURNING id",
        [tenant, 'A-' + suffix, 'B-' + suffix],
      )
    ).rows;
    const actorId = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic reviewer','not-for-login',$3,$4) RETURNING id",
        [suffix, suffix + '@example.test', tenant, facilities[0].id],
      )
    ).rows[0].id;
    s = { tenantId: tenant, facilityId: facilities[0].id, actorId };
    other = { ...s, facilityId: facilities[1].id };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.get('X-Unauth') !== '1') {
        (req as any).user = { id: actorId };
        (req as any).authContext = {
          userId: actorId,
          tenantId: tenant,
          facilityId: s.facilityId,
          roles: ['FACILITY_ADMIN'],
          isSuperAdmin: false,
          permissions: [
            'accounting.read',
            'accounting.planning.read',
            ...(req.get('X-ReadOnly') === '1'
              ? []
              : [
                  'accounting.planning.import',
                  'accounting.planning.manage',
                  'accounting.planning.export',
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
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  });
  const api = (path: string, options: RequestInit = {}) => fetch(base + path, options);
  async function fixture(lines?: string[]) {
    const uid = randomUUID();
    const p = await planning.createPlan(s, {
      name: 'Synthetic outcome ' + uid,
      financialYear: 2026,
      planType: 'MIXED',
      currency: 'KES',
      inflationPercent: '5',
      confirmAdditionalPlan: true,
    });
    const csv = lines ?? [`Synthetic ${uid},Box,10,1,${Array(11).fill('0').join(',')}`];
    const batch = await planning.upload(s, Buffer.from(csv.join('\n')), uid + '.csv', 'text/csv');
    const input = {
      destination: 'EXISTING',
      mode: 'SKIP',
      planId: p.id,
      version: p.version,
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
          endRow: csv.length,
          category: 'OPD CONSUMABLES',
          description: 'A',
          unit: 'B',
          price: 'C',
          months: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
        },
      ],
    };
    return { p, batch, input };
  }
  it('upload and successful preview have zero imported counts and zero plan records', async () => {
    const f = await fixture();
    expect((await importResults(s, f.batch.id)).state).toBe('Uploaded');
    await planning.previewImport(s, f.batch.id, f.input);
    const r = await importResults(s, f.batch.id);
    expect(r.state).toBe('Awaiting confirmation');
    expect(r.counts.imported).toBe(0);
    expect(r.rows[0].outcome).toBe('VALID');
    expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(0);
    expect(r.lifecycle.map((e) => e.action)).toEqual(['UPLOAD_WORKBOOK', 'PREVIEW_IMPORT']);
  });
  it('confirmation returns only after COMMIT; reopened counts and IDs match actual database records and audit', async () => {
    const f = await fixture();
    const preview = await planning.previewImport(s, f.batch.id, f.input);
    const confirmed = await planning.confirmImport(s, f.batch.id, {
      ...f.input,
      confirm: true,
      previewHash: preview.previewHash,
    });
    const fromOtherConnection = (
      await pool.query(
        'SELECT id,description,source_worksheet,source_row,base_price_cents,adjusted_price_cents FROM planning_items WHERE plan_id=$1',
        [f.p.id],
      )
    ).rows;
    const r = await importResults(s, f.batch.id);
    expect(r.state).toBe('Successfully imported');
    expect(confirmed.created).toBe(fromOtherConnection.length);
    expect(r.counts.imported).toBe(1);
    expect(r.rows[0]).toMatchObject({
      outcome: 'CREATED',
      recordId: fromOtherConnection[0].id,
      sheet: 'CSV',
      row: 1,
    });
    expect(r.rows[0].values.at(-1)?.value).toMatchObject({ adjusted_price_cents: '1050' });
    expect(r.lifecycle.at(-1)?.action).toBe('CONFIRM_IMPORT');
    expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(1);
    const again = await planning.confirmImport(s, f.batch.id, {
      ...f.input,
      confirm: true,
      previewHash: preview.previewHash,
    });
    expect(again).toEqual(confirmed);
    expect(
      (await pool.query('SELECT count(*)::int n FROM planning_items WHERE plan_id=$1', [f.p.id]))
        .rows[0].n,
    ).toBe(1);
  });
  it('retains missing, dash, explicit zero, duplicate names and recalculated values without conflating them', async () => {
    const name = 'Duplicate ' + randomUUID();
    const f = await fixture([
      `${name},,10,-,0,${Array(10).fill('').join(',')}`,
      `${name},Box,10,1,${Array(11).fill('0').join(',')}`,
    ]);
    const preview = await planning.previewImport(s, f.batch.id, f.input);
    await planning.confirmImport(s, f.batch.id, {
      ...f.input,
      confirm: true,
      previewHash: preview.previewHash,
    });
    const r = await importResults(s, f.batch.id);
    expect(r.counts.created).toBe(2);
    expect(r.warningCount).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.duplicateName)).toBe(true);
    expect(r.rows[0].values.find((v) => v.field === 'Unit')).toMatchObject({
      raw: '',
      value: 'unit',
      origin: 'DEFAULTED',
    });
    expect(r.rows[0].values.find((v) => v.field === 'Month 1 quantity')).toMatchObject({
      raw: '-',
      value: '0',
      origin: 'DEFAULTED',
      reason: 'DASH',
    });
    expect(r.rows[0].values.find((v) => v.field === 'Month 2 quantity')).toMatchObject({
      raw: '0',
      value: '0',
      origin: 'SUPPLIED',
    });
    const csv = csvRows(resultsCsv(r));
    expect(csv.every((row) => row.length === csv[0].length)).toBe(true);
    expect(resultsCsv(r)).toContain('DEFAULTED');
    expect(resultsCsv(r, true)).toContain('Duplicate name');
  });
  it('rejected rows remain preview evidence; no partial import is allowed', async () => {
    const f = await fixture([
      `Invalid ${randomUUID()},Box,not-a-price,${Array(12).fill('1').join(',')}`,
    ]);
    const preview = await planning.previewImport(s, f.batch.id, f.input);
    expect(preview.errors).toHaveLength(1);
    const r = await importResults(s, f.batch.id);
    expect(r.state).toBe('Preview needs correction');
    expect(r.rows[0].outcome).toBe('FAILED');
    expect(r.rows[0].message).toBe(preview.errors[0].message);
    expect(r.counts.imported).toBe(0);
    await expect(
      planning.confirmImport(s, f.batch.id, {
        ...f.input,
        confirm: true,
        previewHash: preview.previewHash,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(0);
  });
  it('rolls back earlier row writes on a later SQL failure; records a failure attempt and permits safe retry once', async () => {
    const marker = 'Force rollback ' + randomUUID();
    const f = await fixture([
      `First ${randomUUID()},Box,10,${Array(12).fill('1').join(',')}`,
      `${marker},Box,10,${Array(12).fill('1').join(',')}`,
    ]);
    await pool.query(
      `CREATE OR REPLACE FUNCTION synthetic_outcomes_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.description LIKE 'Force rollback %' THEN RAISE EXCEPTION 'synthetic rollback sentinel'; END IF; RETURN NEW; END; $$`,
    );
    await pool.query(
      'CREATE TRIGGER synthetic_outcomes_reject BEFORE INSERT ON planning_items FOR EACH ROW EXECUTE FUNCTION synthetic_outcomes_reject()',
    );
    try {
      const preview = await planning.previewImport(s, f.batch.id, f.input);
      await expect(
        planning.confirmImport(s, f.batch.id, {
          ...f.input,
          confirm: true,
          previewHash: preview.previewHash,
        }),
      ).rejects.toThrow('synthetic rollback sentinel');
      const r = await importResults(s, f.batch.id);
      expect(r.state).toBe('Failed');
      expect(r.counts.imported).toBe(0);
      expect(r.lastFailure.phase).toBe('CONFIRMATION');
      expect(r.rows.every((row) => row.outcome === 'ROLLED_BACK')).toBe(true);
      expect(JSON.stringify(r.lastFailure)).not.toContain('synthetic rollback sentinel');
      expect(
        (await pool.query('SELECT count(*)::int n FROM planning_items WHERE plan_id=$1', [f.p.id]))
          .rows[0].n,
      ).toBe(0);
      expect(
        r.lifecycle.filter((e) => ['IMPORT_CREATE', 'CONFIRM_IMPORT'].includes(e.action)),
      ).toHaveLength(0);
      await pool.query('DROP TRIGGER synthetic_outcomes_reject ON planning_items');
      const review = await planning.previewImport(s, f.batch.id, f.input);
      const committed = await planning.confirmImport(s, f.batch.id, {
        ...f.input,
        confirm: true,
        previewHash: review.previewHash,
      });
      expect(committed.created).toBe(2);
      expect((await importResults(s, f.batch.id)).lastFailure).toBeNull();
      await planning.confirmImport(s, f.batch.id, {
        ...f.input,
        confirm: true,
        previewHash: review.previewHash,
      });
      expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(2);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS synthetic_outcomes_reject ON planning_items');
      await pool.query('DROP FUNCTION synthetic_outcomes_reject()');
    }
  });
  it('a deferred COMMIT failure never publishes a successful result or counts', async () => {
    const f = await fixture([
      `Commit failure ${randomUUID()},Box,10,${Array(12).fill('1').join(',')}`,
    ]);
    await pool.query(
      `CREATE FUNCTION synthetic_outcomes_commit_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.description LIKE 'Commit failure %' THEN RAISE EXCEPTION 'synthetic commit rejection'; END IF; RETURN NEW; END; $$`,
    );
    await pool.query(
      'CREATE CONSTRAINT TRIGGER synthetic_outcomes_commit_reject AFTER INSERT ON planning_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_outcomes_commit_reject()',
    );
    try {
      const v = await planning.previewImport(s, f.batch.id, f.input);
      await expect(
        planning.confirmImport(s, f.batch.id, {
          ...f.input,
          confirm: true,
          previewHash: v.previewHash,
        }),
      ).rejects.toThrow('synthetic commit rejection');
      const r = await importResults(s, f.batch.id);
      expect(r.batch.status).toBe('UPLOADED');
      expect(r.batch.result).toBeNull();
      expect(r.counts.imported).toBe(0);
      expect(r.state).toBe('Failed');
      expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(0);
      expect(r.lifecycle.some((e) => e.action === 'CONFIRM_IMPORT')).toBe(false);
    } finally {
      await pool.query('DROP TRIGGER synthetic_outcomes_commit_reject ON planning_items');
      await pool.query('DROP FUNCTION synthetic_outcomes_commit_reject()');
    }
  });
  it('preserves SKIP reasons and counts only actual writes, not skipped imported or manual rows', async () => {
    const name = 'Preserve ' + randomUUID();
    const line = `${name},Box,10,${Array(12).fill('1').join(',')}`;
    const f = await fixture([line]);
    const v = await planning.previewImport(s, f.batch.id, f.input);
    const first = await planning.confirmImport(s, f.batch.id, {
      ...f.input,
      confirm: true,
      previewHash: v.previewHash,
    });
    const second = await planning.upload(
      s,
      Buffer.from(line + '\n'),
      'same-row-new-bytes.csv',
      'text/csv',
    );
    const input = { ...f.input, version: first.version };
    const review = await planning.previewImport(s, second.id, input);
    expect(review.counts.skippedItems).toBe(1);
    await planning.confirmImport(s, second.id, {
      ...input,
      confirm: true,
      previewHash: review.previewHash,
    });
    const r = await importResults(s, second.id);
    expect(r.counts).toMatchObject({ created: 0, updated: 0, skipped: 1, imported: 0 });
    expect(r.rows[0].outcome).toBe('SKIPPED');
    expect(r.rows[0].message).toContain('no record written');
    expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(1);
  });
  it('retains cancellation/retry lifecycle on the same batch without duplicate uploads', async () => {
    const f = await fixture();
    await planning.cancelImport(s, f.batch.id);
    expect((await importResults(s, f.batch.id)).state).toBe('Cancelled');
    await planning.retryImportReview(s, f.batch.id, { confirmRetry: true });
    const r = await importResults(s, f.batch.id);
    expect(r.state).toBe('Uploaded');
    expect(r.batch.sha256).toBe(f.batch.sha256);
    expect(r.counts.imported).toBe(0);
    expect(r.lifecycle.some((e) => e.action === 'RETRY_IMPORT_REVIEW')).toBe(true);
  });
  it('isolates batch results and selected-plan summary by facility and tenant', async () => {
    const f = await fixture();
    await expect(importResults(other, f.batch.id)).rejects.toMatchObject({
      code: 'IMPORT_NOT_FOUND',
    });
    await expect(importSummary(other, f.p.id)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    await expect(
      importResults({ ...s, tenantId: s.tenantId + 9999 }, f.batch.id),
    ).rejects.toMatchObject({ code: 'IMPORT_NOT_FOUND' });
  });
  it('reports actual UPDATE writes and record IDs separately from SKIP and CREATE', async () => {
    const name = 'Update ' + randomUUID(),
      line = `${name},Box,10,${Array(12).fill('1').join(',')}`;
    const f = await fixture([line]);
    const initial = await planning.previewImport(s, f.batch.id, f.input);
    const first = await planning.confirmImport(s, f.batch.id, {
      ...f.input,
      confirm: true,
      previewHash: initial.previewHash,
    });
    const originalId = first.rows[0].recordId;
    const next = await planning.upload(
      s,
      Buffer.from(line.replace(',10,', ',12,')),
      'updated-source.csv',
      'text/csv',
    );
    const request = { ...f.input, mode: 'UPDATE', version: first.version, confirmUpdate: true };
    const review = await planning.previewImport(s, next.id, request);
    const confirmed = await planning.confirmImport(s, next.id, {
      ...request,
      confirm: true,
      previewHash: review.previewHash,
    });
    const r = await importResults(s, next.id);
    expect(confirmed).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(r.rows[0]).toMatchObject({ outcome: 'UPDATED', recordId: originalId });
    expect(
      (await pool.query('SELECT base_price_cents FROM planning_items WHERE id=$1', [originalId]))
        .rows[0].base_price_cents,
    ).toBe('1200');
    expect((await importSummary(s, f.p.id)).selectedPlanRecords).toBe(1);
  });
  it('shows available legacy audit evidence without inventing field origins or warning counts', async () => {
    const f = await fixture();
    const v = await planning.previewImport(s, f.batch.id, f.input);
    await planning.confirmImport(s, f.batch.id, {
      ...f.input,
      confirm: true,
      previewHash: v.previewHash,
    });
    await pool.query(
      "UPDATE planning_import_batches SET result=result - 'rows' - 'warnings' - 'warningCount' - 'normalizations' WHERE id=$1",
      [f.batch.id],
    );
    const r = await importResults(s, f.batch.id);
    expect(r.legacyDetails).toBe(true);
    expect(r.counts.created).toBe(1);
    expect(r.warningCountKnown).toBe(false);
    expect(r.rows[0].values[0].origin).toBe('UNAVAILABLE');
    expect(r.rows[0].outcome).toBe('CREATED');
  });
  it('paginates scoped history but totals all facility batches; invalid pages are rejected', async () => {
    const prior = await importSummary(s);
    const suffix = randomUUID();
    await pool.query(
      "INSERT INTO planning_import_batches(tenant_id,facility_id,filename,mime,sha256,byte_size,source_bytes,uploaded_by) SELECT $1,$2,'synthetic-page-'||n||'.csv','text/csv',$3||n,1,convert_to('x','UTF8'),$4 FROM generate_series(1,101) n",
      [s.tenantId, s.facilityId, suffix, s.actorId],
    );
    const first = await planning.importHistory(s, 1),
      second = await planning.importHistory(s, 2);
    expect(first).toHaveLength(100);
    expect(second.length).toBeGreaterThan(0);
    expect(new Set([...first, ...second].map((b) => b.id)).size).toBe(first.length + second.length);
    expect((await importSummary(s)).total).toBe(prior.total + 101);
    await expect(planning.importHistory(s, 0)).rejects.toMatchObject({ code: 'INVALID_PAGE' });
    expect(await planning.importHistory(other, 1)).toEqual([]);
  });
  it('allows read-only history/results/indicators, restricts import and CSV export, and denies unauthenticated access', async () => {
    const f = await fixture();
    const read = { 'X-ReadOnly': '1' };
    for (const path of ['/imports', '/imports/summary', `/imports/${f.batch.id}/results`])
      expect((await api(`${path}?facilityId=${s.facilityId}`, { headers: read })).status).toBe(200);
    expect(
      (
        await api(`/imports/${f.batch.id}/preview?facilityId=${s.facilityId}`, {
          method: 'POST',
          headers: { ...read, 'Content-Type': 'application/json' },
          body: JSON.stringify(f.input),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/imports/${f.batch.id}/confirm?facilityId=${s.facilityId}`, {
          method: 'POST',
          headers: { ...read, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/imports/${f.batch.id}/results.csv?facilityId=${s.facilityId}`, {
          headers: read,
        })
      ).status,
    ).toBe(403);
    const csv = await api(`/imports/${f.batch.id}/results.csv?facilityId=${s.facilityId}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(
      (
        await api(`/imports/${f.batch.id}/results?facilityId=${s.facilityId}`, {
          headers: { 'X-Unauth': '1' },
        })
      ).status,
    ).toBe(401);
    expect(
      (await api(`/imports/${f.batch.id}/results?facilityId=${other.facilityId}`)).status,
    ).toBe(403);
  });
});
