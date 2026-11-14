import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import {
  createFinancialBaseline,
  type BudgetLine,
} from '../budget-planning/financial-budget.model.ts';
import {
  calculateFinancialBudget,
  validateFinancialBudget,
  inputCents,
} from '../budget-planning/financial-budget.engine.ts';
import {
  financialCsv,
  financialXlsx,
  financialExportRows,
} from '../budget-planning/financial-budget.export.ts';
import { csvRows } from '../budget-planning/csv.mjs';
const values = (name: string) => {
  const m = createFinancialBaseline();
  return calculateFinancialBudget(m).rows[m.rows.find((r) => r.name === name)!.code].months.map(
    (c) => c.cents! / 100,
  );
};
const custom = (extra: Partial<BudgetLine> = {}): BudgetLine => ({
  code: 'INC-X001',
  name: 'Custom',
  departmentId: 'consult',
  rule: 'Volume-Linked',
  cells: Array(12).fill('=[INC-01]*0.1'),
  overrides: {},
  custom: true,
  ...extra,
});
describe('Syrona 2026 financial scenario and safe dependency engine', () => {
  it('has all 75 specified rows, 13 departments and 12 months, with a fresh untouched baseline', () => {
    const a = createFinancialBaseline();
    expect(a.rows).toHaveLength(75);
    expect(a.departments.filter((d) => d.kind === 'INCOME')).toHaveLength(8);
    expect(a.departments).toHaveLength(13);
    expect(a.rows.every((r) => r.cells.length === 12)).toBe(true);
    expect(validateFinancialBudget(a)).toEqual(a);
    a.rows[0].overrides['0'] = '0';
    expect(createFinancialBaseline().rows[0].overrides).toEqual({});
  });
  it('implements growth, the April anchor and monthly linear steps', () => {
    expect(values('General Consultation')).toEqual([
      18200, 27300, 40950, 91000, 109200, 127400, 145600, 163800, 182000, 200200, 218400, 236600,
    ]);
    expect(values('Dialysis Sessions')).toEqual([
      0, 0, 168000, 252000, 336000, 420000, 504000, 588000, 672000, 756000, 840000, 924000,
    ]);
    expect(values('Laboratory Fees Dialysis')[11]).toBe(57200);
  });
  it('uses exact specialist and follow-up volume links', () => {
    expect(values('Specialist Consultation').slice(3, 6)).toEqual([65000, 78000, 91000]);
    expect(values('Follow Up Consultation Fees').slice(3, 6)).toEqual([45500, 54600, 63700]);
  });
  it('preserves the explicit April/May prescription formula change', () => {
    expect(values('Sale of Prescription Medication').slice(0, 6)).toEqual([
      53000, 79500, 119250, 93900, 282000, 328800,
    ]);
    expect(values('Sale of OTC Medication').slice(3, 6)).toEqual([39000, 40500, 42000]);
    expect(values('Sale of Medical Supplies').slice(3)).toEqual(Array(9).fill(9000));
  });
  it('preserves the Haematology 700-to-1000 denominator and lagged dental link', () => {
    expect(values('Haematology Analyzer').slice(3, 7)).toEqual([71000, 111000, 97700, 107800]);
    expect(values('Rapid Kits').slice(3, 6)).toEqual([53800, 64500, 74900]);
  });
  it('preserves dental and antenatal rows including flat services', () => {
    expect(values('Dental Check-ups & Consultation').slice(0, 6)).toEqual([
      19600, 29400, 44100, 48000, 49500, 51000,
    ]);
    expect(values('Root Canal Treatment').slice(3)).toEqual(Array(9).fill(120000));
    expect(values('Baby Growth Monitoring & Vaccinations')).toEqual(Array(12).fill(500));
    expect(values('Antenatal Care Visits').slice(3)).toEqual(Array(9).fill(28800));
  });
  it('includes OGD in every minor surgery subtotal and in annual income', () => {
    const m = createFinancialBaseline(),
      r = calculateFinancialBudget(m);
    expect(r.departments.surgery.months[0].cents).toBe(6850000);
    expect(r.departments.surgery.months[3].cents).toBe(7150000);
    expect(r.rows['INC-26'].annual.cents).toBe(80400000);
  });
  it('retains exact sparse decimal expenditure inputs and separate zero statutory assumptions', () => {
    expect(values('Medical Consultation Consumables')).toEqual([
      0, 16965, 19184, 8877.75, 2205, 0, 12143.25, 0, 0, 2808.75, 0, 9042.6,
    ]);
    expect(values('Dental Supplies')[11]).toBe(22207.5);
    expect(values('Printing & Stationery')).toEqual([
      8996, 420, 919, 84, 283, 766.5, 582.75, 168, 3737.5, 0, 0, 0,
    ]);
    for (const name of [
      'House Allowance',
      'Medical Allowance',
      'Staff Bonus',
      'Pension',
      'NSSF Employer',
      'Housing Levy Employer',
      'SHIF Employer',
      'NITA Levy',
      'Staff Training/Welfare',
    ])
      expect(values(name)).toEqual(Array(12).fill(0));
  });
  it('uses the specified professional-fee rule for Jan/Feb, March and April onward, with optional dialysis', () => {
    const m = createFinancialBaseline(),
      r = calculateFinancialBudget(m);
    expect(values('Professional Fees & Expenses').slice(0, 4)).toEqual([
      86650, 106525, 253937.5, 111500,
    ]);
    m.dialysisFeesAprDec = true;
    const toggled = calculateFinancialBudget(m);
    expect(toggled.rows['EXP-38'].months[3].cents! - r.rows['EXP-38'].months[3].cents!).toBe(
      252000 * 0.7 * 100,
    );
    expect(toggled.rows['EXP-38'].months[2]).toEqual(r.rows['EXP-38'].months[2]);
  });
  it('includes depreciation in total expenditure and does not manufacture a January loss', () => {
    const r = calculateFinancialBudget(createFinancialBaseline());
    expect(r.departments.depreciation.annual.cents).toBe(21009516);
    expect(r.income.months[0].cents).toBe(37345000);
    expect(r.expenses.months[0].cents).toBe(36527393);
    expect(r.net.months[0].cents).toBe(817607);
    expect(r.income.annual.cents).toBe(2183671250);
    expect(r.cogs.annual.cents).toBe(41037785);
    expect(r.expenses.annual.cents).toBe(518210726);
    expect(r.net.annual.cents).toBe(1665460524);
  });
  it('propagates overrides through previous-month and cross-row dependencies without erasing formulas', () => {
    const m = createFinancialBaseline();
    m.rows[0].overrides['0'] = '20000';
    let r = calculateFinancialBudget(m);
    expect(r.rows['INC-01'].months.slice(0, 4).map((c) => c.cents)).toEqual([
      2000000, 3000000, 4500000, 9100000,
    ]);
    m.rows[0].overrides['3'] = '140000';
    r = calculateFinancialBudget(m);
    expect(r.rows['INC-03'].months[3].cents).toBe(7000000);
    expect(r.rows['INC-01'].months[4].cents).toBe(15820000);
    expect(r.rows['INC-02'].months[4].cents).toBe(11300000);
    delete m.rows[0].overrides['3'];
    expect(calculateFinancialBudget(m).rows['INC-01'].months[3].cents).toBe(9100000);
  });
  it('uses weighted annual ratios, safe zero-revenue fallback and departmental COGS attribution', () => {
    const m = createFinancialBaseline(),
      r = calculateFinancialBudget(m);
    expect(r.netMargin.annual.cents).toBe(
      Math.round((r.net.annual.cents! / r.income.annual.cents!) * 10000),
    );
    expect(r.netMargin.annual.cents).not.toBe(r.netMargin.months.reduce((n, c) => n + c.cents!, 0));
    expect(r.departmentalMargins.pharmacy.months[0].cents).toBe(
      Math.round(((63500 - 14400) / 63500) * 10000),
    );
    for (const row of m.rows.filter((r) => r.code.startsWith('INC-')))
      row.overrides = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, '0']));
    const zero = calculateFinancialBudget(m);
    expect(zero.netMargin.months.every((c) => c.cents === 0)).toBe(true);
    expect(Object.values(zero.departmentalMargins).every((s) => s.annual.cents === 0)).toBe(true);
    expect(zero.net.months[0].cents).toBeLessThan(0);
  });
  it('allows safe custom formulas and includes them in subtotals/KPIs', () => {
    const m = createFinancialBaseline();
    m.rows.push(custom());
    expect(validateFinancialBudget(m)).toBe(m);
    const r = calculateFinancialBudget(m);
    expect(r.rows['INC-X001'].months[0].cents).toBe(182000);
    expect(r.income.months[0].cents).toBe(37527000);
  });
  it('rejects executable code, cycles, invalid references and divide by zero instead of silently treating errors as zero', () => {
    for (const formula of [
      '=globalThis.process.exit()',
      '=fetch("https://example.test")',
      '=1/0',
      '=[DOES-NOT-EXIST]',
      '=[INC-X001]',
    ]) {
      const m = createFinancialBaseline();
      m.rows.push(custom({ cells: Array(12).fill(formula) }));
      expect(() => validateFinancialBudget(m)).toThrow();
      expect(calculateFinancialBudget(m).income.annual.cents).toBeNull();
    }
  });
  it('blocks deletion of referenced custom lines and protects baseline structure', () => {
    const m = createFinancialBaseline();
    m.rows.push(custom(), custom({ code: 'INC-X002', cells: Array(12).fill('=[INC-X001]*2') }));
    validateFinancialBudget(m);
    m.rows = m.rows.filter((r) => r.code !== 'INC-X001');
    expect(() => validateFinancialBudget(m)).toThrow('#REF!');
    const baseline = createFinancialBaseline();
    baseline.rows.pop();
    expect(() => validateFinancialBudget(baseline)).toThrow('protected');
  });
  it('handles JSONB key ordering and rejects invalid schema and precision', () => {
    const reverse = (v: any): any =>
      Array.isArray(v)
        ? v.map(reverse)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverse(x)]),
            )
          : v;
    expect(() => validateFinancialBudget(reverse(createFinancialBaseline()))).not.toThrow();
    expect(() => inputCents('1,000')).toThrow();
    expect(() => inputCents('1.234')).toThrow();
    expect(inputCents('-0.01')).toBe(-1);
    const m = createFinancialBaseline();
    m.rows.push(custom({ cells: Array(12).fill('=0.105') }));
    expect(calculateFinancialBudget(m).rows['INC-X001'].months[0].cents).toBe(11);
  });
  it('exports all 16 columns including collapsed/hidden data and non-summed annual percentages', () => {
    const m = createFinancialBaseline(),
      rows = financialExportRows(m);
    expect(rows.every((r) => r.length === 16)).toBe(true);
    expect(rows.some((r) => r[1].includes('OGD Colonoscopy'))).toBe(true);
    expect(rows.find((r) => r[0] === 'NM')?.[15]).toBe('76.27%');
    expect(csvRows(financialCsv(m)).every((r) => r.length === 16)).toBe(true);
  });
  it('writes numeric Excel amounts and percentage cells for downstream analysis', () => {
    const sheet = XLSX.read(financialXlsx(createFinancialBaseline()), {
      type: 'buffer',
      cellNF: true,
    }).Sheets['Annual Budget 2026'];
    expect(sheet.D3.t).toBe('n');
    expect(sheet.D3.v).toBe(18200);
    expect(Object.values(sheet).some((cell: any) => cell?.z === '0.00%')).toBe(true);
  });
  it('exports formula audit as inert text in CSV and Excel, never executable formulas', () => {
    const m = createFinancialBaseline();
    m.departments.push({
      id: 'custom-export',
      name: '=HYPERLINK("bad")',
      kind: 'INCOME',
      custom: true,
    });
    m.rows.push(custom({ departmentId: 'custom-export' }));
    expect(financialCsv(m, true)).toContain("'=HYPERLINK");
    const book = XLSX.read(financialXlsx(m, true), { type: 'buffer' }),
      sheet = book.Sheets[book.SheetNames[0]];
    expect(Object.values(sheet).filter((c) => c && typeof c === 'object' && 'f' in c)).toHaveLength(
      0,
    );
    expect(JSON.stringify(sheet)).toContain('PREV');
  });
});
