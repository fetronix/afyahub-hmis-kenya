import { describe, it, expect } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { PDFDocument } from 'pdf-lib';
import {
  baselineEquity,
  equityRows,
  originalNames,
  inputKeys,
  emptyInputs,
  formulaNotice,
} from '../partner-equity/model.ts';
import {
  calculateEquity,
  validateEquity,
  validatePartner,
  cents,
} from '../partner-equity/calculations.ts';
import { statementCsv, statementXlsx, equityDocument } from '../partner-equity/export.ts';
import { renderDocument } from '../documents/render.ts';
import type { Statement } from '../partner-equity/service.ts';
const statement = () =>
  ({
    id: 1,
    model: baselineEquity(),
    financial_year: 2026,
    period_name: 'July 2025–June 2026',
    period_kind: 'ANNUAL',
    start_date: '2025-07-01',
    end_date: '2026-06-30',
    status: 'DRAFT',
    revision: 1,
    version: 1,
    prepared_by: 1,
    prepared_name: 'Synthetic preparer',
    prepared_at: '2026-10-27T00:00:00Z',
    review_acceptance: null,
    approved_at: null,
  }) as Statement;
describe('screenshot-matching partner equity arithmetic — provisional', () => {
  it('preserves exact five names/order, twelve monetary and two percentage rows, source net loss and unspecified admission dates', () => {
    const m = baselineEquity();
    expect(m.partners.map((p) => p.name)).toEqual([...originalNames]);
    expect(m.partners.map((p) => p.admittedOn)).toEqual(Array(5).fill(null));
    expect(equityRows).toHaveLength(14);
    expect(equityRows.filter((r) => !['sharing', 'ownership'].includes(r.id))).toHaveLength(12);
    expect(m.netResult).toBe('-2353704.47');
    expect(formulaNotice).toContain('PROVISIONAL');
  });
  it('matches every screenshot row for all partners and Total without rounded-ratio substitution', () => {
    const r = calculateEquity(baselineEquity());
    const expected: Record<string, (string | null)[]> = {
      opening: ['799999.99', '200000.00', '900000.00', '350000.00', '500000.00', '2749999.99'],
      capital: ['1133000.00', '98000.00', '250000.00', '50000.00', '197400.00', '1728400.00'],
      interest: [null, null, null, null, null, null],
      salary: [null, null, null, '540000.00', null, '540000.00'],
      before: ['1932999.99', '298000.00', '1150000.00', '940000.00', '697400.00', '5018399.99'],
      sharing: ['38.52', '5.94', '22.92', '18.73', '13.90', '100.00'],
      allocation: [
        '-906605.84',
        '-139766.45',
        '-539367.16',
        '-440874.02',
        '-327091.01',
        '-2353704.47',
      ],
      after: ['1026394.15', '158233.55', '610632.84', '499125.98', '370308.99', '2664695.52'],
      drawings: ['-10000.00', null, null, '-50000.00', null, '-60000.00'],
      tax: [null, null, null, null, null, null],
      revaluation: [null, null, null, null, null, null],
      adjustments: [null, null, null, null, null, null],
      closing: ['1016394.15', '158233.55', '610632.84', '449125.98', '370308.99', '2604695.52'],
      ownership: ['39.02', '6.07', '23.44', '17.24', '14.22', '100.00'],
    };
    for (const row of equityRows)
      expect(
        [...baselineEquity().partners.map((p) => r.cells[row.id][p.id]), r.totals[row.id]],
        row.id,
      ).toEqual(expected[row.id]);
  });
  it('explains the one-cent allocation/closing difference and ratio display rounding without assigning a balancing cent', () => {
    const r = calculateEquity(baselineEquity());
    expect(r.exactAllocationDifference).toBe('0.00');
    expect(r.exactClosingDifference).toBe('0.00');
    expect(r.rounding).toEqual({
      allocationCents: '-1',
      closingCents: '-1',
      sharingBasisPoints: '1',
      ownershipBasisPoints: '-1',
    });
    expect(r.unspecified).toBe(27);
  });
  it.each(inputKeys)('recalculates permitted input %s with signed safe arithmetic', (key) => {
    const m = baselineEquity(),
      old = calculateEquity(m);
    m.inputs['original-1'][key] = '123.45';
    const r = calculateEquity(m);
    expect(r.cells[key]['original-1']).toBe('123.45');
    expect(r.totals.closing).not.toBe(old.totals.closing);
    expect(r.exactClosingDifference).toBe('0.00');
  });
  it('recalculates loss/profit changes without using rounded displayed shares', () => {
    const m = baselineEquity();
    m.netResult = '100.00';
    const r = calculateEquity(m);
    expect(r.totals.allocation).toBe('100.00');
    expect(r.cells.allocation['original-1']).toBe('38.52');
    expect(r.totals.closing).toBe('4958499.99');
  });
  it('reports undefined denominators safely rather than inventing ownership or allocations', () => {
    const m = baselineEquity();
    for (const p of m.partners) m.inputs[p.id] = emptyInputs();
    const r = calculateEquity(m);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.cells.allocation['original-1']).toBeNull();
    expect(r.totals.ownership).toBeNull();
  });
  it('supports zero result, negative equity and zero closing denominator', () => {
    const m = baselineEquity();
    m.netResult = '-10000000.00';
    expect(Number(calculateEquity(m).totals.closing)).toBeLessThan(0);
    m.netResult = '-4958399.99';
    const r = calculateEquity(m);
    expect(r.totals.closing).toBe('0.00');
    expect(r.issues.join(' ')).toContain('Ownership denominator');
  });
  it('keeps source names and identities protected but permits extra effective-dated partners', () => {
    const m = baselineEquity(),
      p = {
        id: 'partner-abcdefgh',
        name: 'Additional partner',
        admittedOn: '2026-01-01',
        departedOn: null,
        active: true,
        order: 5,
        original: false,
      };
    m.partners.push(p);
    m.inputs[p.id] = emptyInputs();
    expect(validateEquity(m).partners).toHaveLength(6);
    expect(() => validatePartner({ ...p, active: false })).toThrow('departure');
    expect(() => validatePartner({ ...p, admittedOn: null })).toThrow();
    expect(() => validatePartner({ ...m.partners[0], name: 'Changed source name' })).toThrow(
      'immutable',
    );
    m.partners.shift();
    expect(() => validateEquity(m)).toThrow();
  });
  it.each(['=SUM(A1:A5)', 'NaN', 'Infinity', '1,000', '0.001', '1e5', '(()=>process.exit())()'])(
    'rejects unsafe or unsupported input %s',
    (v) => expect(() => cents(v)).toThrow(),
  );
  it('exports full numeric Excel cells/formats, protects CSV and never creates executable formulas', () => {
    const s = statement(),
      bytes = statementXlsx(s),
      wb = XLSX.read(bytes, { type: 'buffer', cellNF: true }),
      ws = wb.Sheets['Partners equity'];
    expect(ws.B2.t).toBe('n');
    expect(ws.B2.v).toBe(799999.99);
    expect(ws.B7.v).toBe(0.3852);
    expect(ws.B7.z).toBe('0.00%');
    expect(ws.G14.v).toBe(2604695.52);
    for (const name of wb.SheetNames)
      for (const [k, v] of Object.entries(wb.Sheets[name]))
        if (!k.startsWith('!')) expect((v as XLSX.CellObject).f).toBeUndefined();
    expect(statementCsv(s)).toContain('-2353704.47');
    s.model.partners.push({
      id: 'partner-abcdefgh',
      name: '=UNTRUSTED()',
      admittedOn: '2026-01-01',
      departedOn: null,
      active: true,
      order: 5,
      original: false,
    });
    s.model.inputs['partner-abcdefgh'] = emptyInputs();
    expect(statementCsv(s)).toContain("'=UNTRUSTED()");
  });
  it('renders complete PDF statements with facility branding, period, approval fields and pagination', async () => {
    const doc = equityDocument(statement(), {
      name: 'Synthetic facility',
      code: 'SYN',
      registryCode: null,
      address: null,
      county: null,
      phone: null,
      email: null,
    });
    expect(doc.table!.rows).toHaveLength(14);
    expect(doc.rightFields.map((f) => f.label)).toContain('Approved by');
    const head = await PDFDocument.create();
    head.addPage([595.28, 841.89]).drawText('Synthetic letterhead', { x: 35, y: 810 });
    const result = await renderDocument(doc, {
      id: 1,
      version: 1,
      bytes: Buffer.from(await head.save()),
      bodyTopPt: 100,
      pageWidthPt: 595.28,
      pageHeightPt: 841.89,
      label: 'Synthetic facility letterhead',
      bodyBottomPt: 55,
      bodyLeftPt: 35,
      bodyRightPt: 35,
    } as any);
    expect(result.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(result.letterheadApplied).toBe(true);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(0);
  });
  it('retains all partner rows in large-roster exports and includes dated review evidence', async () => {
    const s = statement();
    s.reviewed_name = 'Synthetic reviewer';
    s.reviewed_at = '2026-10-27T12:00:00Z';
    for (let i = 5; i < 15; i++) {
      const id = 'partner-synthetic-' + i;
      s.model.partners.push({
        id,
        name: 'Synthetic additional partner ' + i,
        admittedOn: '2025-07-01',
        departedOn: null,
        active: true,
        order: i,
        original: false,
      });
      s.model.inputs[id] = emptyInputs();
    }
    const doc = equityDocument(s, {
      name: 'Synthetic facility',
      code: 'SYN',
      registryCode: null,
      address: null,
      county: null,
      phone: null,
      email: null,
    });
    expect(doc.table!.columns).toHaveLength(2);
    expect(
      doc.sections!.filter((x) => x.heading.startsWith('Synthetic additional partner')),
    ).toHaveLength(10);
    expect(doc.rightFields.find((x) => x.label === 'Review date')?.value).toBe(s.reviewed_at);
    expect(statementCsv(s)).toContain(s.reviewed_at);
    const wb = XLSX.read(statementXlsx(s), { type: 'buffer' });
    expect(wb.Sheets['Partners equity'].Q1.v).toBe('Total');
    const result = await renderDocument(doc, null);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(1);
  });
  it('protects source order and prevents additional partners preceding the original five', () => {
    expect(() => validatePartner({ ...baselineEquity().partners[0], order: 4 })).toThrow(
      'order are immutable',
    );
    expect(() =>
      validatePartner({
        id: 'partner-order-test',
        name: 'Synthetic partner',
        admittedOn: '2026-01-01',
        departedOn: null,
        active: true,
        original: false,
        order: 0,
      }),
    ).toThrow('follow the original five');
  });
  it('handles a zero result and negative sharing denominator without losing unspecified versus zero provenance', () => {
    const m = baselineEquity();
    m.netResult = '0.00';
    for (const p of m.partners) m.inputs[p.id] = emptyInputs();
    m.inputs['original-1'].opening = '-100.00';
    m.inputs['original-2'].opening = '-100.00';
    m.inputs['original-1'].capital = '0.00';
    const r = calculateEquity(m);
    expect(r.totals.before).toBe('-200.00');
    expect(r.cells.sharing['original-1']).toBe('50.00');
    expect(r.totals.allocation).toBe('0.00');
    expect(r.totals.closing).toBe('-200.00');
    expect(r.cells.ownership['original-1']).toBe('50.00');
    expect(r.cells.capital['original-1']).toBe('0.00');
    expect(r.cells.capital['original-2']).toBeNull();
    expect(r.issues).toEqual([]);
  });
});
