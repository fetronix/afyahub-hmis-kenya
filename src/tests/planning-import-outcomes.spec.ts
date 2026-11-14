import { describe, expect, it } from 'vitest';
import {
  committedCounts,
  importState,
  importIndicators,
  importResultsCsv,
  type ImportBatchView,
} from '../budget-planning/import-outcome.ts';
import {
  destinationPreviewHash,
  type ImportDestination,
} from '../budget-planning/import-destination.ts';
import { importReviewRows } from '../budget-planning/import-review.ts';
import { parseWorkbook, previewWorkbook, type Mapping } from '../budget-planning/workbook.ts';

const result = { created: 3, updated: 2, skipped: 4, failed: 0, warningCount: 2 };
describe('import status and committed-only indicators', () => {
  it.each(['UPLOADED', 'CANCELLED'])(
    'never uses preview or stale result counts as successful writes in %s',
    (status) => {
      expect(
        committedCounts({ status, result, validation: { rows: 232, counts: { newItems: 232 } } }),
      ).toEqual({ created: 0, updated: 0, skipped: 0, failed: 0, imported: 0 });
    },
  );
  it('requires both an IMPORTED database status and a stored result', () => {
    expect(importState({ status: 'IMPORTED' })).toBe('Outcome unavailable');
    expect(committedCounts({ status: 'IMPORTED' }).imported).toBe(0);
    expect(committedCounts({ status: 'IMPORTED', result })).toEqual({
      created: 3,
      updated: 2,
      skipped: 4,
      failed: 0,
      imported: 5,
    });
  });
  it.each([
    [{ status: 'UPLOADED' }, 'Uploaded'],
    [
      { status: 'UPLOADED', validation: { previewHash: 'review', rows: 232, errors: [] } },
      'Awaiting confirmation',
    ],
    [
      { status: 'UPLOADED', validation: { previewHash: 'review', rows: 232, errors: ['invalid'] } },
      'Preview needs correction',
    ],
    [{ status: 'UPLOADED', validation: { lastFailure: { message: 'rollback' } } }, 'Failed'],
    [{ status: 'CANCELLED', validation: { lastFailure: {} } }, 'Cancelled'],
    [{ status: 'IMPORTED', result }, 'Successfully imported'],
    [{ status: 'IMPORTED', result: { ...result, failed: 1 } }, 'Partially imported'],
    [{ status: 'IMPORTED', result: { created: 0, updated: 0, failed: 1 } }, 'Failed'],
  ] as Array<[ImportBatchView, string]>)('derives honest status %#', (batch, expected) =>
    expect(importState(batch)).toBe(expected),
  );
  it('separates warnings and pending previews from successful imports and failed attempts', () => {
    expect(
      importIndicators([
        { status: 'UPLOADED', validation: { previewHash: 'p', rows: 50 } },
        { status: 'IMPORTED', result },
        { status: 'UPLOADED', validation: { lastFailure: {} } },
      ]),
    ).toEqual({ total: 3, successful: 1, warnings: 1, failed: 1, awaiting: 1, attention: 2 });
  });
  it('escapes CSV cells and neutralizes spreadsheet formula prefixes without changing source records', () => {
    const output = importResultsCsv(
      ['Heading'],
      [
        [' =HYPERLINK("https://example.test")'],
        ['+SUM(A1)'],
        ['@cmd'],
        ['-3'],
        ['Comma,quote"\nnewline'],
        [0],
        [''],
      ],
    );
    expect(output).toContain('"\' =HYPERLINK(""https://example.test"")"');
    expect(output).toContain('"\'+SUM(A1)"');
    expect(output).toContain('"\'@cmd"');
    expect(output).toContain('"\'-3"');
    expect(output).toContain('"Comma,quote""\nnewline"');
    expect(output).toContain('"0"');
  });
});
describe('row-level value evidence (reporting only)', () => {
  const mapping: Mapping = {
    sheet: 'CSV',
    kind: 'ITEM',
    startRow: 1,
    endRow: 2,
    category: 'SOURCE CATEGORY',
    description: 'A',
    unit: 'B',
    price: 'C',
    months: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
  };
  it('distinguishes supplied explicit zero, blank/dash defaults and normalized thousands/whitespace', async () => {
    const book = await parseWorkbook(
      Buffer.from(
        `Same name, Box ,"1,200.00",0,-,${Array(10).fill('').join(',')}\nSame name,Box,10,${Array(12).fill('0').join(',')}`,
      ),
      'source.csv',
      'text/csv',
    );
    const preview = previewWorkbook(book, [mapping], '5');
    const before = JSON.stringify({ book, preview, mapping });
    const rows = importReviewRows(book, [mapping], preview);
    expect(rows).toHaveLength(2);
    expect(rows[0].outcome).toBe('VALID');
    expect(rows.every((r) => r.duplicateName)).toBe(true);
    expect(rows[0].values.find((v) => v.field === 'Month 1 quantity')).toMatchObject({
      raw: '0',
      value: '0',
      origin: 'SUPPLIED',
    });
    expect(rows[0].values.find((v) => v.field === 'Month 2 quantity')).toMatchObject({
      raw: '-',
      value: '0',
      origin: 'DEFAULTED',
      reason: 'DASH',
    });
    expect(rows[0].values.find((v) => v.field === 'Month 3 quantity')).toMatchObject({
      raw: '',
      value: '0',
      origin: 'DEFAULTED',
      reason: 'MISSING',
    });
    expect(rows[0].values.find((v) => v.field === 'Base/buying price')).toMatchObject({
      raw: '1,200.00',
      value: '1200.00',
      origin: 'NORMALIZED',
    });
    expect(JSON.stringify({ book, preview, mapping })).toBe(before);
  });
  it('retains exact rejection messages and explicit exclusions without marking them successful', async () => {
    const book = await parseWorkbook(
      Buffer.from('Bad,Box,invalid,1\nExcluded,Box,1,0'),
      'source.csv',
      'text/csv',
    );
    const m = { ...mapping, skipRows: [2] };
    const preview = previewWorkbook(book, [m], '5');
    const rows = importReviewRows(book, [m], preview);
    expect(rows.map((r) => r.outcome)).toEqual(['FAILED', 'EXCLUDED']);
    expect(rows[0].message).toBe(preview.errors[0].message);
    expect(rows[1].message).toContain('Explicitly excluded');
  });
});

it('destination binding survives JSONB key ordering without accepting changed destination content', () => {
  const d: ImportDestination = {
    kind: 'EXISTING',
    mode: 'SKIP',
    facilityId: 7,
    facilityName: 'Synthetic facility',
    planId: 11,
    name: 'Synthetic plan',
    financialYear: 2026,
    planType: 'MIXED',
    currency: 'KES',
    inflationBp: 500,
    version: 1,
    confirmAdditionalPlan: false,
    existingPlans: [],
  };
  const counts = {
    newItems: 2,
    matchingItems: 0,
    skippedItems: 0,
    conflictingItems: 0,
    updates: 0,
  };
  const reordered = Object.fromEntries(Object.entries(d).reverse()) as ImportDestination;
  expect(destinationPreviewHash('workbook', 'source', d, counts)).toBe(
    destinationPreviewHash(
      'workbook',
      'source',
      reordered,
      Object.fromEntries(Object.entries(counts).reverse()),
    ),
  );
  expect(destinationPreviewHash('workbook', 'source', d, counts)).not.toBe(
    destinationPreviewHash('workbook', 'source', { ...d, planId: 12 }, counts),
  );
});
