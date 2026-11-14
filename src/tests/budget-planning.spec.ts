import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { zipSync, strToU8 } from 'fflate';
import {
  adjusted,
  fixed,
  monthAmount,
  quantities,
  uniformCalculation,
} from '../budget-planning/calculations.ts';
import {
  parseWorkbook,
  previewWorkbook,
  type Mapping,
  type Workbook,
} from '../budget-planning/workbook.ts';
export const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const mapping: Mapping = {
  sheet: 'Stationery',
  kind: 'ITEM',
  startRow: 2,
  endRow: 2,
  category: 'DENTAL CONSUABLES',
  description: 'A',
  unit: 'B',
  price: 'C',
  months: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
};
export function workbookBytes(price = 10, bookType: 'xlsx' | 'xls' = 'xlsx', formula = false) {
  const b = XLSX.utils.book_new(),
    s = XLSX.utils.aoa_to_sheet([
      ['Description', 'Unit', 'Price', ...Array(12).fill('Quantity')],
      ['Synthetic gloves', 'Box', price, ...Array(12).fill(2)],
    ]);
  if (formula) s.D2 = { t: 'n', v: 999, f: '1+1' };
  XLSX.utils.book_append_sheet(b, s, 'Stationery');
  XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([]), 'Sheet3');
  return XLSX.write(b, { type: 'buffer', bookType }) as Buffer;
}
describe('budget fixed-point calculations', () => {
  it('rounds adjusted price before monthly multiplication', () => {
    expect(adjusted(101n, 500)).toBe(106n);
    expect(monthAmount(106n, 1500n)).toBe(159n);
  });
  it('distinguishes blank from zero', () => {
    expect(quantities([null, '', 0, ...Array(9).fill(1)]).slice(0, 3)).toEqual([null, null, 0n]);
    expect(monthAmount(100n, null)).toBeNull();
    expect(monthAmount(100n, 0n)).toBe(0n);
  });
  it.each(['-1', 'NaN', 'Infinity', '1e9', '1.2345', '', true])('rejects unsafe quantity %s', (v) =>
    expect(() => fixed(v, 3)).toThrow(),
  );
  it('requires twelve monthly entries', () => expect(() => quantities([1])).toThrow());
  it('retains separate balance and staff contribution arithmetic', () => {
    const r = uniformCalculation({
      description: 'Uniform',
      categoryId: 9,
      existingBalance: '3',
      buyingCost: '1000',
      staffCount: 10,
      quantityPerStaff: '2',
      contributionPercent: '50',
      balanceRule: 'SUBTRACT',
    });
    expect(r).toMatchObject({
      projectedQuantity: '20.000',
      purchaseQuantity: '17.000',
      grossCents: '1700000',
      contributionCents: '850000',
      totalCents: '850000',
    });
  });
});
describe('bounded workbook parsing and reviewed mappings', () => {
  it.each(['xlsx', 'xls'] as const)(
    'parses synthetic %s without losing empty sheet',
    async (ext) => {
      const b = await parseWorkbook(
        workbookBytes(10, ext),
        `synthetic.${ext}`,
        ext === 'xls' ? 'application/vnd.ms-excel' : mime,
      );
      expect(b.sheets.map((s) => s.name)).toEqual(['Stationery', 'Sheet3']);
      const p = previewWorkbook(b, [mapping], '5');
      expect(p.rowCount).toBe(1);
      expect(p.errors).toHaveLength(0);
      expect(p.items[0]).toMatchObject({
        category: 'DENTAL CONSUABLES',
        sourceWorksheet: 'Stationery',
        sourceRow: 2,
        description: 'Synthetic gloves',
      });
    },
  );
  it('rejects cached formula inputs instead of trusting their values', async () => {
    const b = await parseWorkbook(workbookBytes(10, 'xlsx', true), 'formula.xlsx', mime);
    const p = previewWorkbook(b, [mapping], '0');
    expect(p.rowCount).toBe(0);
    expect(p.errors[0].message).toContain('formula');
  });
  it('retains derived formula trace without execution', () => {
    const b: Workbook = {
      sheets: [
        {
          name: 'Stationery',
          rows: [
            [],
            [
              { value: 'Item' },
              { value: 'Box' },
              { value: 1 },
              ...Array(12).fill({ value: 0 }),
              { value: 900, formula: 'WEBSERVICE("https://example.test")' },
            ],
          ],
        },
      ],
    };
    expect(previewWorkbook(b, [mapping], '0').items[0].sourceFormula).toContain('WEBSERVICE');
  });
  it('reports missing unit, negative price and duplicate rows', async () => {
    const b = await parseWorkbook(workbookBytes(), 'synthetic.xlsx', mime);
    b.sheets[0].rows.push([...b.sheets[0].rows[1]]);
    expect(previewWorkbook(b, [{ ...mapping, endRow: 3 }], '0').errors[0].message).toContain(
      'Duplicate',
    );
    b.sheets[0].rows[1][1] = null;
    expect(previewWorkbook(b, [mapping], '0').errors[0].message).toContain('Unit');
    b.sheets[0].rows[1][1] = { value: 'Box' };
    b.sheets[0].rows[1][2] = { value: -1 };
    expect(previewWorkbook(b, [mapping], '0').errors[0].message).toContain('non-negative');
  });
  it('invalidates preview hash when reviewed inputs change', async () => {
    const b = await parseWorkbook(workbookBytes(), 'synthetic.xlsx', mime);
    expect(previewWorkbook(b, [mapping], '0').previewHash).not.toBe(
      previewWorkbook(b, [mapping], '5').previewHash,
    );
  });
  it('rejects mismatched extension, MIME, magic bytes and oversized inputs', async () => {
    await expect(parseWorkbook(workbookBytes(), 'x.xls', mime)).rejects.toThrow();
    await expect(parseWorkbook(Buffer.from('not excel'), 'x.xlsx', mime)).rejects.toThrow();
    await expect(parseWorkbook(Buffer.alloc(4194305), 'x.xlsx', mime)).rejects.toThrow();
  });
  it('rejects macro/external-link ZIP members before parsing', async () => {
    const bytes = Buffer.from(zipSync({ 'xl/externalLinks/externalLink1.xml': strToU8('<x/>') }));
    await expect(parseWorkbook(bytes, 'unsafe.xlsx', mime)).rejects.toThrow(/macros\/external/);
  });
  it('rejects worksheet row limit', async () => {
    const b = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      b,
      XLSX.utils.aoa_to_sheet(Array.from({ length: 2002 }, () => ['item'])),
      'Large',
    );
    await expect(
      parseWorkbook(XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }), 'large.xlsx', mime),
    ).rejects.toThrow(/2000 rows/);
  });
});
