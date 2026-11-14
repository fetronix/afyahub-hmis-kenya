import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from '@e965/xlsx';
import { describe, expect, it } from 'vitest';
import { csvRows } from '../budget-planning/csv.mjs';
import {
  parseWorkbook,
  previewWorkbook,
  type Mapping,
  type Workbook,
} from '../budget-planning/workbook.ts';

const mapping: Mapping = {
  sheet: 'CSV',
  kind: 'ITEM',
  startRow: 1,
  endRow: 2,
  category: 'Section',
  description: 'A',
  unit: 'B',
  price: 'C',
  months: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
};
const bytes = (text: string) => parseWorkbook(Buffer.from(text), 'plan.csv', 'text/csv');

describe('zero-fill literal CSV and Excel preview policy', () => {
  it('defaults numbers and units, tracks raw distinctions and keeps duplicate names as source rows', async () => {
    const book = await bytes('Cotton,,,"-",0,\r\nCotton, ,"1,200.50",1,2,3\r\n');
    const p = previewWorkbook(book, [mapping], '5');
    expect(p.errors).toEqual([]);
    expect(p.rowCount).toBe(2);
    expect(p.items[0]).toMatchObject({
      description: 'Cotton',
      unit: 'unit',
      basePrice: '0',
      sourceRow: 1,
      quantities: Array(12).fill('0'),
    });
    expect(p.items[1]).toMatchObject({ basePrice: '1200.50', sourceRow: 2 });
    expect(p.normalizations).toContainEqual({
      sheet: 'CSV',
      row: 1,
      column: 'D',
      raw: '-',
      value: '0',
      reason: 'DASH',
    });
    expect(p.normalizations.some((n) => n.row === 1 && n.column === 'E')).toBe(false);
    expect(p.previewHash).not.toBe(previewWorkbook(book, [mapping], '5', 'STRICT').previewHash);
  });
  it.each(['xls', 'xlsx'] as const)(
    'zero-fills identical duplicate rows in %s too',
    async (ext) => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['Duplicate', '', '', '-'],
          ['Duplicate', '', '', '-'],
        ]),
        'CSV',
      );
      const data = XLSX.write(book, { type: 'buffer', bookType: ext }) as Buffer;
      const parsed = await parseWorkbook(
        data,
        `plan.${ext}`,
        ext === 'xls'
          ? 'application/vnd.ms-excel'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const preview = previewWorkbook(parsed, [mapping], '5');
      expect(preview.errors).toEqual([]);
      expect(preview.rowCount).toBe(2);
      expect(preview.items.map((row) => row.sourceRow)).toEqual([1, 2]);
      expect(preview.items.every((row) => row.basePrice === '0' && row.unit === 'unit')).toBe(true);
    },
  );
  it('binds normalization evidence into the preview hash even if the numerical result is unchanged', async () => {
    const missing = previewWorkbook(await bytes('Item,Box,,0'), [{ ...mapping, endRow: 1 }], '5');
    const explicit = previewWorkbook(await bytes('Item,Box,0,0'), [{ ...mapping, endRow: 1 }], '5');
    expect(missing.items).toEqual(explicit.items);
    expect(missing.previewHash).not.toBe(explicit.previewHash);
  });
  it('still rejects invalid numbers and formula-like mapped inputs', async () => {
    for (const price of ['-1', 'bad', '12,34', '=1+2', '@SUM(A1)', '+1']) {
      const book = await bytes(`Item,Box,"${price}",1\n`);
      expect(previewWorkbook(book, [{ ...mapping, endRow: 1 }], '5').errors).toHaveLength(1);
    }
    const book: Workbook = {
      sheets: [
        {
          name: 'CSV',
          rows: [[{ value: 'Item' }, { value: 'Box' }, { value: 99, formula: '1+2' }]],
        },
      ],
    };
    expect(previewWorkbook(book, [{ ...mapping, endRow: 1 }], '5').errors[0].message).toContain(
      'formula',
    );
  });
  it('rejects overlapping source row mappings, missing mappings and unnamed item rows', async () => {
    const book = await bytes('Cotton,Box,5\n');
    const m = { ...mapping, endRow: 1 };
    expect(previewWorkbook(book, [m, m], '5').errors[0].message).toContain('more than one');
    expect(previewWorkbook(book, [{ ...m, price: '' }], '5').errors[0].message).toContain(
      'mapping',
    );
    const missing = await bytes(',Box,1\n');
    expect(previewWorkbook(missing, [m], '5').errors[0].message).toContain('description');
  });
  it('parses BOM, quotes and embedded newlines without executing or coercing cells', () => {
    expect(csvRows('\uFEFF"a,b","c""d"\r\n"e\nf",0\r\n')).toEqual([
      ['a,b', 'c"d'],
      ['e\nf', '0'],
    ]);
    for (const invalid of ['"unfinished', '"closed"bad,1', 'abc"bad,2', 'a,\0'])
      expect(() => csvRows(invalid)).toThrow();
    expect(() => csvRows(Array(2001).fill('row').join('\n'))).toThrow('2000');
    expect(() => csvRows(Array(81).fill('x').join(','))).toThrow('80');
    expect(() => csvRows('x'.repeat(1001))).toThrow('1000');
  });
  it('requires matching MIME and UTF-8 text for CSV', async () => {
    await expect(
      parseWorkbook(Buffer.from('a,b'), 'a.csv', 'application/octet-stream'),
    ).rejects.toThrow();
    await expect(
      parseWorkbook(Buffer.from([0xff, 0xfe, 0]), 'a.csv', 'text/csv'),
    ).rejects.toThrow();
    await expect(bytes('"malformed')).rejects.toThrow();
  });
  it('zero-fills uniform inputs while still requiring an explicit balance rule', async () => {
    const b = await bytes('Shirt,,900,,,-\n');
    const u: Mapping = {
      sheet: 'CSV',
      kind: 'UNIFORM',
      startRow: 1,
      endRow: 1,
      category: 'Uniforms',
      description: 'A',
      price: 'C',
      existingBalance: 'B',
      staff: 'D',
      perStaff: 'E',
      contributionPercent: 'F',
      balanceRule: 'SUBTRACT',
    };
    const p = previewWorkbook(b, [u], '5');
    expect(p.errors).toEqual([]);
    expect(p.uniforms[0]).toMatchObject({
      staffCount: 0,
      quantityPerStaff: '0',
      existingBalance: '0',
      contributionPercent: '0',
    });
    expect(previewWorkbook(b, [{ ...u, balanceRule: undefined }], '5').errors[0].message).toContain(
      'balance',
    );
    for (const invalidStaff of ['1e3', 'false', '-1', '1.5']) {
      const invalid = await bytes(`Shirt,,900,${invalidStaff},1,0\n`);
      expect(previewWorkbook(invalid, [u], '5').errors).toHaveLength(1);
    }
  });
});

describe.skipIf(!process.env.SYRONA_SOURCE_DIR)(
  'official CSV zero-fill readiness (not production import)',
  () => {
    it('accepts all 232 stationery and 5 monthly branding rows plus 4 zero-staff uniforms', async () => {
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
        const book = await parseWorkbook(
          await readFile(path.join(process.env.SYRONA_SOURCE_DIR!, file)),
          file,
          'text/csv',
        );
        const mappings: Mapping[] = evidence.mappings
          .filter(
            (m: Mapping) => m.sheet === (file.includes('Stationery') ? 'Stationery' : 'Branding'),
          )
          .map((m: Mapping) => ({ ...m, sheet: 'CSV' }));
        if (file.includes('Branding'))
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
            balanceLabel: 'December 2025 — zero-filled planning assumption',
          });
        const p = previewWorkbook(book, mappings, '5');
        expect(p.errors).toEqual([]);
        expect(p.rowCount).toBe(count);
        expect(p.items.every((i) => (i.quantities as unknown[]).every((q) => q !== null))).toBe(
          true,
        );
        if (count === 232) {
          expect(
            p.items.filter((i) => String(i.description).toLowerCase() === 'cotton wool 400g'),
          ).toHaveLength(2);
          expect(p.items.find((i) => i.sourceRow === 172)?.unit).toBe('unit');
        }
        // Contribution amount is NOT inferred as a percentage. Missing staff inputs mean no purchase.
        if (count === 9) expect(p.uniforms.every((u) => u.staffCount === 0)).toBe(true);
      }
    });
  },
);
