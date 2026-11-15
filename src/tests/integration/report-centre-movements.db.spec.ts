import { afterAll, beforeAll, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from '@e965/xlsx';
import PDFParser from 'pdf2json';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { createReportingMovementsFixture } from './support/reporting-movements.fixture.ts';
import { uploadLetterhead, activateLetterhead } from '../../branding/letterhead.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

const engine = 'inventory-movements';
describeDb(
  'Reporting programme batch 1: recorded stock movements, real PostgreSQL and HTTP',
  () => {
    let f: Awaited<ReturnType<typeof createReportingMovementsFixture>>,
      base: string,
      close: (() => Promise<void>) | undefined;
    const call = (action: string, extra: Record<string, unknown> = {}, token = f.full.token) =>
      httpJson(base, 'POST', `/api/reporting/centre/${engine}/${action}`, {
        token,
        body: { ...f.filters, ...extra },
      });
    beforeAll(async () => {
      f = await createReportingMovementsFixture(pool);
      const { createApp } = await import('../../app.ts');
      ({ baseUrl: base, close } = await startTestServer(await createApp()));
    }, 30000);
    afterAll(async () => {
      if (close) await close();
    });
    it('retrieves exact scoped source rows and signed quantities, without mixing units', async () => {
      const r = await call('generate');
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(5);
      const alpha = r.body.rows.filter((x: any) => x.item === 'Synthetic Alpha'),
        beta = r.body.rows.filter((x: any) => x.item === 'Synthetic Beta');
      expect(alpha).toHaveLength(2);
      expect(alpha.map((x: any) => x.quantityDelta).sort((a: number, b: number) => a - b)).toEqual([
        -3, 10,
      ]);
      expect(alpha.every((x: any) => x.itemNetQuantity === '7' && x.unit === 'Pieces')).toBe(true);
      expect(beta.every((x: any) => x.itemNetQuantity === '80' && x.unit === 'mL')).toBe(true);
      expect(r.body.summaries).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toMatch(/Sibling Secret|Foreign Secret/);
      const raw = await pool.query(
        'SELECT item_id,sum(quantity_delta)::text AS net FROM inventory_movements WHERE tenant_id=$1 AND facility_id=$2 AND movement_date BETWEEN $3 AND $4 GROUP BY item_id',
        [f.tenant, f.facility, f.filters.from, f.filters.to],
      );
      expect(raw.rows.find((x) => x.item_id === f.itemA).net).toBe('7');
      expect(raw.rows.find((x) => x.item_id === f.itemB).net).toBe('80');
    });
    it('withholds out-of-facility linked metadata and flags the actual inconsistent record', async () => {
      const r = await call('generate');
      const bad = r.body.rows.find((x: any) => x.movementId === f.mismatched);
      expect(bad).toMatchObject({
        item: null,
        itemCode: null,
        unit: null,
        itemNetQuantity: null,
        quantityDelta: 1,
      });
      expect(r.body.notes.join(' ')).toMatch(/1 movement\(s\).*out-of-scope/);
    });
    it('includes both date boundaries and excludes adjacent days; rejects missing, reversed, impossible and excessive ranges', async () => {
      expect(
        (await call('generate', { from: '2026-01-01', to: '2026-01-01' })).body.rows.map(
          (x: any) => x.quantityDelta,
        ),
      ).toEqual([10]);
      expect(
        (await call('generate', { from: '2026-01-31', to: '2026-01-31' })).body.rows.map(
          (x: any) => x.quantityDelta,
        ),
      ).toEqual([-3]);
      for (const range of [
        { from: undefined, to: undefined },
        { from: '2026-01-31', to: '2026-01-01' },
        { from: '2026-02-30', to: '2026-03-01' },
        { from: '2024-01-01', to: '2026-01-01' },
      ])
        expect((await call('generate', range)).status).toBe(400);
    });
    it('recalculates net within status/item/search filters before pagination and preserves literal wildcard search', async () => {
      const first = await call('generate', { limit: 1 });
      expect(first.body.rows).toHaveLength(1);
      expect(first.body.total).toBe(5);
      expect(first.body.rows[0].itemNetQuantity).toBe('7');
      const receipts = await call('generate', { status: 'RECEIPT', itemIds: [f.itemA] });
      expect(receipts.body.total).toBe(1);
      expect(receipts.body.rows[0].itemNetQuantity).toBe('10');
      expect((await call('generate', { search: '%_' })).body.total).toBe(1);
      expect((await call('generate', { search: 'Alpha' })).body.total).toBe(2);
      expect((await call('generate', { departmentId: 1 })).status).toBe(400);
      expect((await call('generate', { status: 'MADE_UP' })).status).toBe(400);
    });
    it('denies sibling/foreign facility requests, foreign actors and out-of-scope item selection/options', async () => {
      for (const facilityId of [f.sibling, f.foreignFacility])
        expect((await call('generate', { facilityId })).status).toBe(403);
      expect((await call('generate', {}, f.foreign.token)).status).toBe(403);
      expect([400, 404]).toContain((await call('generate', { itemIds: [f.siblingItem] })).status);
      const options = await call('options', { kind: 'item', from: undefined, to: undefined });
      expect(options.status).toBe(200);
      expect(JSON.stringify(options.body)).not.toMatch(/Sibling Secret|Foreign Secret/);
    });
    it('enforces source-domain and export permissions without adding staff grants', async () => {
      expect((await call('generate', {}, f.noDomain.token)).status).toBe(403);
      expect(
        (await call('options', { kind: 'item', from: undefined, to: undefined }, f.noDomain.token))
          .status,
      ).toBe(403);
      expect((await call('generate', {}, f.noExport.token)).status).toBe(200);
      expect((await call('export', { format: 'xlsx' }, f.noExport.token)).status).toBe(403);
    });
    it('respects disabled/hidden source module policy', async () => {
      await pool.query('UPDATE facilities SET hidden_modules=\'["inventory"]\' WHERE id=$1', [
        f.facility,
      ]);
      try {
        expect((await call('generate')).status).toBe(403);
      } finally {
        await pool.query("UPDATE facilities SET hidden_modules='[]' WHERE id=$1", [f.facility]);
      }
    });
    it('returns explicit empty results without invented zero quantity summaries', async () => {
      const r = await call('generate', { from: '2026-04-01', to: '2026-04-02' });
      expect(r.status).toBe(200);
      expect(r.body.rows).toEqual([]);
      expect(r.body.total).toBe(0);
      expect(r.body.summaries).toBeUndefined();
    });
    it('exports all filtered rows with source values and per-item nets, independent of screen pagination', async () => {
      const screen = await call('generate', { limit: 1 });
      const r = await call('export', { format: 'xlsx', limit: 1, offset: 4 });
      expect(r.status).toBe(200);
      const book = XLSX.read(Buffer.from(r.body.base64, 'base64'), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
        header: 1,
        raw: false,
      }) as string[][];
      const h = rows.findIndex((x) => x[0] === 'Movement ID');
      expect(h).toBeGreaterThan(0);
      expect(rows.slice(h + 1)).toHaveLength(5);
      const header = rows[h],
        values = rows.slice(h + 1);
      expect(
        values.find((x) => x[0] === String(screen.body.rows[0].movementId))?.[
          header.indexOf('Recorded quantity change')
        ],
      ).toBe(String(screen.body.rows[0].quantityDelta));
      expect(
        values
          .filter((x) => x[header.indexOf('Current item name')] === 'Synthetic Alpha')
          .every((x) => x[header.indexOf('Item net quantity in selected filters')] === '7'),
      ).toBe(true);
      expect(JSON.stringify(rows)).toContain('Not recorded');
      expect(JSON.stringify(rows)).not.toMatch(/Sibling Secret|Foreign Secret/);
    });
    it('uses explicit plain fallback then the existing active facility PDF letterhead, with actual saved content', async () => {
      async function pdfText() {
        const r = await call('export', { format: 'pdf' });
        expect(r.status).toBe(200);
        const bytes = Buffer.from(r.body.base64, 'base64');
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
        return new Promise<string>((resolve, reject) => {
          const parser = new PDFParser(null, true);
          parser.on('pdfParser_dataError', reject);
          parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
          parser.parseBuffer(bytes);
        });
      }
      expect(await pdfText()).toContain('No active facility letterhead');
      const context: AuthorizationContext = {
        userId: f.full.id,
        tenantId: f.tenant,
        facilityId: f.facility,
        roles: [],
        permissions: ['facility.branding.read', 'facility.branding.manage'],
        isSuperAdmin: false,
      };
      const template = await PDFDocument.create();
      template
        .addPage([595.28, 841.89])
        .drawText('SYNTHETIC REPORTING PROGRAMME MAIN', { x: 36, y: 810, size: 14 });
      const draft = await uploadLetterhead(context, {
        facilityId: f.facility,
        filename: 'synthetic-reporting.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from(await template.save()),
        body: { bodyTopPt: 80, bodyBottomPt: 60, bodyLeftPt: 36, bodyRightPt: 36 },
      });
      await activateLetterhead(
        context,
        draft.letterhead.id,
        'Synthetic batch 1 letterhead acceptance',
      );
      const text = await pdfText();
      expect(text).toContain('SYNTHETIC REPORTING PROGRAMME MAIN');
      expect(text).toContain('Synthetic Alpha');
      expect(text).toContain('Item net quantity in selected filters: 7');
      expect(text).toMatch(/Page 1 of/);
      expect(text).not.toMatch(/Sibling Secret|Foreign Secret/);
    });
    it('persists the filtered report audit without exposing source notes', async () => {
      await call('generate', { status: 'RECEIPT' });
      const rows = (
        await pool.query(
          "SELECT details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='report_centre' AND resource_id=$3 ORDER BY id DESC LIMIT 1",
          [f.tenant, f.facility, engine],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0].details)).toContain('status');
    });
    it('fails closed rather than returning report data when mandatory audit persistence fails', async () => {
      const name = 'rp_audit_' + f.suffix.replaceAll('-', '');
      await pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id=${f.facility} AND NEW.resource='report_centre' THEN RAISE EXCEPTION 'Synthetic mandatory audit rejection'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        const response = await call('generate');
        expect(response.status).toBe(500);
        expect(response.body.rows).toBeUndefined();
      } finally {
        await pool.query(`DROP TRIGGER ${name} ON audit_logs`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
    });
  },
);
