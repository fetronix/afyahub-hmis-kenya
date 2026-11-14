import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkbook, type Workbook } from '../budget-planning/workbook.ts';
import { csvRows } from '../budget-planning/csv.mjs';
import {
  STATIONERY_SOURCE_SHA256,
  verifiedStationeryMapping,
} from '../budget-planning/stationery-mapping.ts';

it('does not suggest mappings for an unverified source', () => {
  expect(verifiedStationeryMapping({ sheets: [] }, 'unknown')).toBeNull();
  expect(verifiedStationeryMapping({ sheets: [] }, STATIONERY_SOURCE_SHA256)).toBeNull();
});
it('preserves logical CSV record positions including blank records and quoted newlines', () => {
  expect(csvRows('title\r\n\r\n1,"two\nlines"\r\nTOTAL\r\n')).toEqual([
    ['title'],
    [''],
    ['1', 'two\nlines'],
    ['TOTAL'],
  ]);
});

// External originals are never committed or silently replaced by synthetic source data.
describe.skipIf(!process.env.SYRONA_SOURCE_DIR)(
  'exact supplied stationery CSV (inspection only)',
  () => {
    const source = async () => {
      const bytes = await readFile(
        path.join(process.env.SYRONA_SOURCE_DIR!, 'Syrona_Stationery.csv'),
      );
      const hash = createHash('sha256').update(bytes).digest('hex');
      const book = await parseWorkbook(bytes, 'Syrona_Stationery.csv', 'text/csv');
      return { bytes, hash, book };
    };
    it('matches the supplied fingerprint and 296 records with no line/record offset', async () => {
      const { bytes, hash, book } = await source();
      expect(hash).toBe(STATIONERY_SOURCE_SHA256);
      expect(bytes.length).toBe(39236);
      const physicalLines = bytes.toString('utf8').split(/\r\n|\n|\r/);
      if (physicalLines.at(-1) === '') physicalLines.pop();
      expect(physicalLines).toHaveLength(296);
      expect(book.sheets[0].rows).toHaveLength(296);
      const records = csvRows(bytes.toString('utf8'));
      expect(book.sheets[0].rows.map((row) => row.map((cell) => cell?.value))).toEqual(records);
    });
    it('suggests only the 232 numbered source rows, without changing the workbook', async () => {
      const { hash, book } = await source();
      const before = JSON.stringify(book);
      const suggestion = verifiedStationeryMapping(book, hash)!;
      expect(suggestion).not.toBeNull();
      expect(suggestion.mappings.map((m) => [m.category, m.startRow, m.endRow])).toEqual([
        ['OPD CONSUMABLES', 9, 141],
        ['DENTAL CONSUABLES', 145, 184],
        ['CONSUMABLE ITEMS', 186, 244],
      ]);
      const positions = suggestion.mappings.flatMap((m) =>
        Array.from({ length: m.endRow - m.startRow + 1 }, (_, i) => m.startRow + i),
      );
      expect(positions).toHaveLength(232);
      expect(new Set(positions).size).toBe(232);
      const rows = book.sheets[0].rows;
      expect(
        positions.every(
          (n) =>
            /^\d+$/.test(String(rows[n - 1][0]?.value).trim()) &&
            String(rows[n - 1][1]?.value).trim(),
        ),
      ).toBe(true);
      for (const excluded of [1, 6, 7, 8, 142, 143, 144, 185, 245, 248, 296])
        expect(positions).not.toContain(excluded);
      expect(rows[8][1]?.value).toBe('Biotec SODIUM(Biochemistry Reagent)');
      expect(String(rows[140][1]?.value).trim()).toBe('Bin liner 30*36 (RED)');
      expect(String(rows[144][1]?.value).trim()).toBe('Upper posterior forcep');
      expect(String(rows[183][1]?.value).trim()).toBe('Bib Holder');
      expect(String(rows[185][1]?.value).trim()).toBe('Toner - 217-A');
      expect(String(rows[243][1]?.value).trim()).toBe('Stapler big');
      expect(JSON.stringify(book)).toBe(before);
    });
    it('uses base price and quantity columns only, never inflated price or projected costs', async () => {
      const { hash, book } = await source();
      const suggestion = verifiedStationeryMapping(book, hash)!;
      for (const m of suggestion.mappings) {
        expect(m).toMatchObject({
          description: 'B',
          unit: 'C',
          price: 'D',
          kind: 'ITEM',
          sheet: 'CSV',
        });
        expect(m.months).toEqual(['F', 'H', 'J', 'L', 'N', 'P', 'R', 'T', 'V', 'X', 'Z', 'AB']);
        expect(
          [m.description, m.unit, m.price, ...m.months!].some((col) =>
            ['E', 'G', 'I', 'K', 'M', 'O', 'Q', 'S', 'U', 'W', 'Y', 'AA', 'AC'].includes(col!),
          ),
        ).toBe(false);
      }
      expect(book.sheets[0].rows[185][5]?.value?.toString().trim()).toBe('1.00');
      expect(book.sheets[0].rows[185][6]?.value?.toString().trim()).toBe('5,000.00');
    });
    it.each([
      [
        'heading',
        (b: Workbook) => {
          b.sheets[0].rows[143][1] = { value: 'DENTAL CONSUMABLES' };
        },
      ],
      [
        'total inside item range',
        (b: Workbook) => {
          b.sheets[0].rows[20][1] = { value: 'TOTAL' };
        },
      ],
      [
        'blank item row',
        (b: Workbook) => {
          b.sheets[0].rows[20] = [];
        },
      ],
      [
        'cost in quantity header',
        (b: Workbook) => {
          b.sheets[0].rows[6][5] = { value: 'Projected cost' };
        },
      ],
      [
        'row shift',
        (b: Workbook) => {
          b.sheets[0].rows.unshift([]);
        },
      ],
      [
        'wrong sheet',
        (b: Workbook) => {
          b.sheets[0].name = 'Other';
        },
      ],
      [
        'formula header',
        (b: Workbook) => {
          b.sheets[0].rows[5][1]!.formula = 'anything';
        },
      ],
    ] as const)('fails closed on changed parsed structure: %s', async (_label, mutate) => {
      const { book } = await source();
      mutate(book);
      expect(verifiedStationeryMapping(book, STATIONERY_SOURCE_SHA256)).toBeNull();
    });
    it('rejects changed bytes even if the recognizable layout is unchanged', async () => {
      const { bytes, book } = await source();
      const changedHash = createHash('sha256')
        .update(Buffer.concat([bytes, Buffer.from('\n')]))
        .digest('hex');
      expect(verifiedStationeryMapping(book, changedHash)).toBeNull();
    });
  },
);
