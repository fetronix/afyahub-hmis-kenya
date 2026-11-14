import { describe, expect, it } from 'vitest';
import { cell, csvRows, reconcileSyrona } from '../../scripts/reconcile-syrona-plan.ts';

describe('Syrona CSV evidence primitives', () => {
  it('preserves quoted commas, escaped quotes, line endings, blanks and BOM', () => {
    expect(csvRows('\uFEFFa,"b,c","d""e"\r\n,"line\nbreak",\r\n')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['', 'line\nbreak', ''],
    ]);
  });
  it('rejects unterminated quoted input', () => {
    expect(() => csvRows('a,"b')).toThrow('Unterminated');
  });
  it('never conflates a blank, a dash or an explicit zero', () => {
    expect(cell(' ').state).toBe('BLANK');
    expect(cell(' - ').state).toBe('DASH_UNRESOLVED');
    expect(cell('0.00')).toEqual({ raw: '0.00', state: 'EXPLICIT_ZERO', value: '0.00' });
    expect(cell(' 1,234.50 ').value).toBe('1234.50');
    expect(cell('12,34').state).toBe('INVALID');
  });
  it('treats formulas as invalid literal input, not executable arithmetic', () => {
    for (const raw of ['=1+2', '+SUM(A1)', '@SUM(A1)', '-1'])
      expect(cell(raw).state).toBe('INVALID');
  });
});

// Opt-in: official uploads are not committed or silently substituted with synthetic data.
describe.skipIf(!process.env.SYRONA_SOURCE_DIR)(
  'official Syrona 2026 source acceptance audit',
  () => {
    it('retains source evidence and blocks incomplete or inconsistent imports', async () => {
      const r = await reconcileSyrona(process.env.SYRONA_SOURCE_DIR!);
      expect(r.acceptance).toBe('BLOCKED_NOT_IMPORTED');
      expect(r.files.map((f) => f.sha256)).toEqual([
        '244f9ba9bdd8f5a28793610cabfa8d931ecc76eff52b0fa553b11702e3f198e1',
        '75f810a0265ad0e6a08d9efc1e43a6705591ae81ae0aa6c109466a605881797e',
      ]);
      expect(r.categoryCounts).toEqual({
        'OPD CONSUMABLES': 133,
        'DENTAL CONSUABLES': 40,
        'CONSUMABLE ITEMS': 59,
        BRANDING: 5,
      });
      expect(r.mainItemRows).toBe(237);
      expect(r.uniformRows).toBe(4);
      expect(r.quantityStates).toEqual({
        DASH_UNRESOLVED: 1190,
        BLANK: 1043,
        NUMBER: 184,
        EXPLICIT_ZERO: 427,
      });
      const priced = r.rows.filter((row) => row.serverAdjustedPrice !== null);
      expect(priced).toHaveLength(232);
      expect(
        priced.every(
          (row) => Number(row.sourceAdjustedPrice.value) === Number(row.serverAdjustedPrice),
        ),
      ).toBe(true);
      expect(
        r.problems.filter((p) => p.code === 'MISSING_OR_INVALID_BASE_PRICE').map((p) => p.csvRow),
      ).toEqual([90, 91, 92, 93, 94]);
      expect(r.problems.filter((p) => p.code === 'MISSING_UNIT').map((p) => p.csvRow)).toEqual([
        172,
      ]);
      expect(
        r.problems.filter((p) => p.code === 'IMPORT_IDENTITY_COLLISION').map((p) => p.csvRow),
      ).toEqual([120, 125, 126]);
      expect(
        r.problems.filter((p) => p.code === 'MONTHLY_COST_MISMATCH').map((p) => p.csvRow),
      ).toEqual([166, 186]);
      expect(r.totals[0].annualSourceNumericCostSum).toBe('260380.50');
      expect(r.totals[0].annualRecalculatedKnownCostSum).toBe('263046.00');
      expect(r.totals[0].months[3].knownDifference).toBe('-210.00');
      expect(r.totals[0].months[10].footer.state).toBe('DASH_UNRESOLVED');
      expect(
        r.totals.every((t) => t.months.every((m) => m.footerMatchesNumericSourceSum !== false)),
      ).toBe(true);
      expect(r.totals[1].annualSourceNumericCostSum).toBe('22365.00');
      expect(r.preview.rowCount).toBe(66);
      expect(r.preview.errors).toHaveLength(171);
      expect(r.uniforms.every((u) => u.halfPayEqualsHalfBuyingCost === true)).toBe(true);
      expect(r.formulaLikeCells).toEqual([]);
      expect(Object.values(r.mutationSummary)).toEqual([0, 0, 0, 0]);
    });
  },
);
