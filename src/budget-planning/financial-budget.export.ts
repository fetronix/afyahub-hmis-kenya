import * as XLSX from '@e965/xlsx';
import type { FinancialBudget } from './financial-budget.model.ts';
import { budgetMonths } from './financial-budget.model.ts';
import {
  calculateFinancialBudget,
  type BudgetSeries,
  type BudgetCell,
} from './financial-budget.engine.ts';
import { importResultsCsv } from './import-outcome.ts';
export function financialExportRows(model: FinancialBudget, audit = false): string[][] {
  const result = calculateFinancialBudget(model);
  const value = (c: BudgetCell, percent = false) =>
    c.error ??
    (audit && c.formula.startsWith('=')
      ? c.overridden
        ? `Manual override: ${((c.cents ?? 0) / 100).toFixed(2)}; baseline ${c.formula}`
        : c.formula
      : percent
        ? `${((c.cents ?? 0) / 100).toFixed(2)}%`
        : ((c.cents ?? 0) / 100).toFixed(2));
  const line = (code: string, name: string, rule: string, s: BudgetSeries, percent = false) => [
    code,
    name,
    rule,
    ...s.months.map((c) => value(c, percent)),
    value(s.annual, percent),
  ];
  const rows = [
    [
      'Item Code / Row Ref',
      'Department / Line Item Name',
      'Rule / Formula Type',
      ...budgetMonths.map((m) => m + ' 2026'),
      'Annual Total',
    ],
  ];
  for (const side of ['INCOME', 'EXPENDITURE']) {
    rows.push([
      side,
      side === 'INCOME' ? 'PROJECTED INCOME' : 'PROJECTED EXPENDITURE',
      ...Array(14).fill(''),
    ]);
    for (const d of model.departments.filter((d) =>
      side === 'INCOME' ? d.kind === 'INCOME' : d.kind !== 'INCOME',
    )) {
      for (const row of model.rows.filter((r) => r.departmentId === d.id))
        rows.push(line(row.code, `${d.name} / ${row.name}`, row.rule, result.rows[row.code]));
      rows.push(line(d.id, `Sub-Total ${d.name}`, 'SUM', result.departments[d.id]));
    }
    rows.push(
      line(
        side === 'INCOME' ? 'TOTAL-INCOME' : 'TOTAL-EXPENSES',
        side === 'INCOME'
          ? 'GRAND TOTAL PROJECTED INCOME'
          : 'TOTAL OPERATIONAL EXPENSES (including COGS)',
        'SUM',
        side === 'INCOME' ? result.income : result.expenses,
      ),
    );
  }
  for (const [code, name, series, percent] of [
    ['GROSS', 'Gross Profit', result.gross, false],
    ['NET', 'Net Profit / (Loss)', result.net, false],
    ['GM', 'Gross Profit Margin (%)', result.grossMargin, true],
    ['NM', 'Net Profit Margin (%)', result.netMargin, true],
    ['OER', 'Operating Expense Ratio (%)', result.expenseRatio, true],
    ['CR', 'COGS Ratio (%)', result.cogsRatio, true],
  ] as const)
    rows.push(line(code, name, percent ? 'Safe division' : 'Calculated', series, percent));
  for (const d of model.departments.filter((d) => d.kind === 'INCOME'))
    rows.push(
      line(
        'MARGIN-' + d.id,
        d.name + ' Margin (%)',
        'Safe division',
        result.departmentalMargins[d.id],
        true,
      ),
    );
  return rows;
}
export function financialCsv(model: FinancialBudget, audit = false) {
  const [headers, ...rows] = financialExportRows(model, audit);
  return importResultsCsv(headers, rows);
}
export function financialXlsx(model: FinancialBudget, audit = false): Buffer {
  // Values are genuine numeric Excel cells; audited rules remain inert strings, never .f formulas.
  const rows = financialExportRows(model, audit);
  const data = rows.map((row, r) =>
    row.map((value, c) => {
      if (r > 0 && c >= 3 && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
      if (r > 0 && c >= 3 && /^-?\d+(?:\.\d+)?%$/.test(value))
        return Number(value.slice(0, -1)) / 100;
      return value;
    }),
  );
  const sheet = XLSX.utils.aoa_to_sheet(data);
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = value.endsWith('%') ? '0.00%' : '#,##0.00';
    }),
  );
  sheet['!cols'] = [
    { wch: 18 },
    { wch: 58 },
    { wch: 20 },
    ...Array.from({ length: 13 }, () => ({ wch: audit ? 45 : 18 })),
  ];
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Annual Budget 2026');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}
