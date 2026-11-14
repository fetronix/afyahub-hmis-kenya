/** Read-only acceptance audit. Never opens a database or confirms an import. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from '@e965/xlsx';
import { adjusted, decimal, fixed, monthAmount } from '../src/budget-planning/calculations.ts';
import { parseWorkbook, previewWorkbook, type Mapping } from '../src/budget-planning/workbook.ts';

export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"' && value === '') quoted = true;
    else if (c === ',') {
      row.push(value);
      value = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quoted) throw new Error('Unterminated quoted CSV cell.');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
export function cell(raw = '') {
  const text = raw.trim();
  if (!text) return { raw, state: 'BLANK', value: null };
  if (text === '-') return { raw, state: 'DASH_UNRESOLVED', value: null };
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))
    return { raw, state: 'INVALID', value: null };
  const value = text.replace(/,/g, '');
  return { raw, state: /^0+(?:\.0+)?$/.test(value) ? 'EXPLICIT_ZERO' : 'NUMBER', value };
}
type DataRow = { file: string; sheet: string; row: number; category: string; values: string[] };
export async function reconcileSyrona(sourceDir: string) {
  const source = [] as Array<{
    filename: string;
    sha256: string;
    bytes: number;
    rows: number;
    columns: number;
    data: string[][];
  }>;
  for (const filename of ['Syrona_Stationery.csv', 'Syrona_Branding.csv']) {
    const bytes = await readFile(path.join(sourceDir, filename));
    const data = csvRows(bytes.toString('utf8'));
    if (!data.length || data.some((r) => r.length !== data[0].length))
      throw new Error(`Inconsistent CSV columns: ${filename}`);
    source.push({
      filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      rows: data.length,
      columns: data[0].length,
      data,
    });
  }
  const rows: DataRow[] = [],
    uniforms: Array<Record<string, unknown>> = [];
  for (const [index, file] of source.entries()) {
    let category = '',
      branding = false,
      uniformTable = false;
    for (const [i, values] of file.data.entries()) {
      const label = values[1]?.trim() ?? '';
      if (
        index === 0 &&
        ['OPD CONSUMABLES', 'DENTAL CONSUABLES', 'CONSUMABLE ITEMS'].includes(label)
      )
        category = label;
      if (index === 1 && label === 'BRANDING') {
        category = label;
        branding = true;
        continue;
      }
      if (index === 1 && label === 'TOTAL') branding = false;
      if (
        (index === 0 && /^\d+$/.test(values[0].trim()) && label) ||
        (index === 1 && branding && label)
      )
        rows.push({
          file: file.filename,
          sheet: index === 0 ? 'Stationery' : 'Branding',
          row: i + 1,
          category,
          values,
        });
      if (values[2]?.trim() === 'TYPE OF T SHIRTS') {
        uniformTable = true;
        continue;
      }
      if (uniformTable && values[7]?.trim() === 'TOTAL') uniformTable = false;
      if (uniformTable && values[2]?.trim()) {
        const buying = cell(values[4]),
          halfPay = cell(values[5]);
        uniforms.push({
          file: file.filename,
          csvRow: i + 1,
          description: values[2],
          openingBalance: cell(values[3]),
          buyingCost: buying,
          staffHalfPayAmount: halfPay,
          staffCount: cell(values[6]),
          quantityPerStaff: cell(values[7]),
          sourceProjectedQuantity: cell(values[8]),
          sourceTotalCost: cell(values[9]),
          halfPayEqualsHalfBuyingCost:
            buying.value !== null &&
            halfPay.value !== null &&
            fixed(halfPay.value) * 2n === fixed(buying.value),
          status:
            'BLOCKED: blank opening/staff/per-staff inputs; half-pay is a currency amount, not a percentage; source formulas are unavailable in CSV.',
        });
      }
    }
  }
  const problems: Array<Record<string, unknown>> = [];
  const duplicates = new Map<string, DataRow>();
  const auditRows = rows.map((r) => {
    const name = r.values[1].trim(),
      unit = r.values[2].trim(),
      base = cell(r.values[3]),
      sourceAdjusted = cell(r.values[4]);
    const issues: string[] = [];
    const problem = (code: string, detail: Record<string, unknown> = {}) => {
      issues.push(code);
      problems.push({ code, file: r.file, csvRow: r.row, description: name, ...detail });
    };
    if (!unit) problem('MISSING_UNIT');
    if (base.value === null) problem('MISSING_OR_INVALID_BASE_PRICE');
    const expected = base.value === null ? null : adjusted(fixed(base.value), 500);
    if (
      sourceAdjusted.value !== null &&
      expected !== null &&
      fixed(sourceAdjusted.value) !== expected
    )
      problem('ADJUSTED_PRICE_MISMATCH', {
        source: sourceAdjusted.value,
        expected: decimal(expected),
      });
    const key = `${r.sheet}:${r.category}:${name.toLowerCase()}:${unit.toLowerCase()}`;
    const previous = duplicates.get(key);
    if (previous)
      problem('IMPORT_IDENTITY_COLLISION', {
        previousCsvRow: previous.row,
        previousBasePrice: previous.values[3].trim(),
        currentBasePrice: r.values[3].trim(),
      });
    else duplicates.set(key, r);
    const months = Array.from({ length: 12 }, (_, m) => {
      const quantity = cell(r.values[5 + m * 2]),
        cost = cell(r.values[6 + m * 2]);
      const amount =
        expected !== null && quantity.value !== null
          ? monthAmount(expected, fixed(quantity.value, 3))
          : null;
      if (cost.value !== null && fixed(cost.value) > 0n && quantity.value === null)
        problem('SOURCE_COST_WITHOUT_QUANTITY', {
          month: m + 1,
          sourceCost: cost.value,
          quantityState: quantity.state,
        });
      if (cost.value !== null && amount !== null && fixed(cost.value) !== amount)
        problem('MONTHLY_COST_MISMATCH', {
          month: m + 1,
          sourceCost: cost.value,
          recalculatedCost: decimal(amount!),
        });
      if (amount !== null && amount > 0n && cost.value === null)
        problem('RECALCULATED_COST_WITHOUT_SOURCE_NUMERIC_COST', {
          month: m + 1,
          sourceCostState: cost.state,
          recalculatedCost: decimal(amount),
        });
      return {
        month: m + 1,
        date: `2026-${String(m + 1).padStart(2, '0')}-01`,
        quantity,
        sourceCost: cost,
        recalculatedCost: amount === null ? null : decimal(amount),
        comparison:
          amount !== null && cost.value !== null
            ? amount === fixed(cost.value)
              ? 'MATCH'
              : 'MISMATCH'
            : 'NOT_FULLY_COMPARABLE',
      };
    });
    return {
      file: r.file,
      worksheet: r.sheet,
      csvRow: r.row,
      sourceSerial: r.values[0],
      sourceItemName: r.values[1],
      description: name,
      category: r.category,
      sourceUnit: r.values[2],
      basePrice: base,
      sourceAdjustedPrice: sourceAdjusted,
      serverAdjustedPrice: expected === null ? null : decimal(expected),
      inflationPercent: '5.00',
      months,
      annualSourceNumericCostSum: decimal(
        months.reduce(
          (n, m) => n + (m.sourceCost.value === null ? 0n : fixed(m.sourceCost.value)),
          0n,
        ),
      ),
      annualRecalculatedKnownCostSum: decimal(
        months.reduce(
          (n, m) => n + (m.recalculatedCost === null ? 0n : fixed(m.recalculatedCost)),
          0n,
        ),
      ),
      unplannedOrUnresolvedMonths: months.filter((m) => m.quantity.value === null).length,
      issues,
    };
  });
  const categoryCounts: Record<string, number> = {},
    quantityStates: Record<string, number> = {};
  for (const row of auditRows) {
    categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
    for (const month of row.months)
      quantityStates[month.quantity.state] = (quantityStates[month.quantity.state] ?? 0) + 1;
  }
  const totals = source.map((file, index) => {
    const sheet = index === 0 ? 'Stationery' : 'Branding',
      selected = auditRows.filter((r) => r.worksheet === sheet);
    const totalRow = file.data.findIndex((r) => r[1]?.trim() === 'TOTAL');
    const months = Array.from({ length: 12 }, (_, m) => {
      const footer = cell(file.data[totalRow]?.[6 + 2 * m]);
      const numericSourceSum = selected.reduce(
        (n, r) =>
          n + (r.months[m].sourceCost.value === null ? 0n : fixed(r.months[m].sourceCost.value!)),
        0n,
      );
      const recalculatedKnownSum = selected.reduce(
        (n, r) =>
          n + (r.months[m].recalculatedCost === null ? 0n : fixed(r.months[m].recalculatedCost!)),
        0n,
      );
      return {
        month: m + 1,
        sourceTotalRow: totalRow + 1,
        footer,
        numericSourceCostSum: decimal(numericSourceSum),
        recalculatedKnownCostSum: decimal(recalculatedKnownSum),
        knownDifference:
          recalculatedKnownSum < numericSourceSum
            ? '-' + decimal(numericSourceSum - recalculatedKnownSum)
            : decimal(recalculatedKnownSum - numericSourceSum),
        footerMatchesNumericSourceSum:
          footer.value === null ? null : fixed(footer.value) === numericSourceSum,
      };
    });
    return {
      file: file.filename,
      worksheet: sheet,
      months,
      annualSourceNumericCostSum: decimal(
        months.reduce((n, m) => n + fixed(m.numericSourceCostSum), 0n),
      ),
      annualRecalculatedKnownCostSum: decimal(
        months.reduce((n, m) => n + fixed(m.recalculatedKnownCostSum), 0n),
      ),
    };
  });
  // Derivative adapter only: preserve every row and every blank/dash/explicit zero.
  // Normalize numeric formatting, never invent missing prices, quantities or units.
  const book = XLSX.utils.book_new();
  for (const [index, file] of source.entries()) {
    const normalized = file.data.map((values) =>
      values.map((raw) => {
        const c = cell(raw);
        return c.value ?? raw.trim();
      }),
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet(normalized),
      index === 0 ? 'Stationery' : 'Branding',
    );
  }
  const derivative = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = await parseWorkbook(
    derivative,
    'syrona-csv-preview-derivative.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const mappings: Mapping[] = Object.keys(categoryCounts).map((category) => {
    const selected = rows.filter((r) => r.category === category),
      startRow = Math.min(...selected.map((r) => r.row)),
      endRow = Math.max(...selected.map((r) => r.row));
    const included = new Set(selected.map((r) => r.row));
    return {
      sheet: selected[0].sheet,
      kind: 'ITEM',
      startRow,
      endRow,
      skipRows: Array.from({ length: endRow - startRow + 1 }, (_, i) => startRow + i).filter(
        (r) => !included.has(r),
      ),
      category,
      description: 'B',
      unit: 'C',
      price: 'D',
      months: Array.from({ length: 12 }, (_, i) => XLSX.utils.encode_col(5 + 2 * i)),
    };
  });
  const preview = previewWorkbook(parsed, mappings, '5', 'STRICT');
  const formulaLikeCells = source.flatMap((file) =>
    file.data.flatMap((row, i) =>
      row.flatMap((value, j) =>
        /^[=+@]/.test(value.trim())
          ? [{ file: file.filename, row: i + 1, column: j + 1, value }]
          : [],
      ),
    ),
  );
  return {
    acceptance: 'BLOCKED_NOT_IMPORTED',
    sourceKind: 'User-provided CSV exports; original XLS formulas and formatting not available',
    currency:
      'UNCONFIRMED: currency not stated in CSV files; no authenticated facility configuration available',
    files: source.map(({ data, ...metadata }) => ({
      ...metadata,
      observedMonthLabels: Array.from({ length: 12 }, (_, m) => data[5]?.[5 + 2 * m]?.trim() ?? ''),
    })),
    categoryCounts,
    quantityStates,
    mainItemRows: rows.length,
    uniformRows: uniforms.length,
    problems,
    totals,
    uniforms,
    mappings,
    preview: {
      ...preview,
      derivativeDescription:
        'Read-only CSV-to-XLSX validation adapter, not the original XLS and not a confirmed import. Only literal numeric formatting normalized; blank and dash semantics unchanged.',
      uniformMappingsOmittedReason:
        'Four incomplete source rows with currency-amount half-pay semantics cannot be represented faithfully by selecting a percentage and fabricated blank inputs.',
    },
    formulaLikeCells,
    rows: auditRows,
    mutationSummary: {
      confirmedImports: 0,
      replacedPlans: 0,
      archivedPlans: 0,
      productionMigrations: 0,
    },
  };
}
export async function writeReconciliation(sourceDir: string, outputDir: string) {
  const result = await reconcileSyrona(sourceDir);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'source-reconciliation.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  const header = [
    'file',
    'worksheet',
    'csv_row',
    'source_item',
    'category',
    'source_unit',
    'base_price_raw',
    'source_adjusted_raw',
    'server_adjusted',
    'month',
    'quantity_raw',
    'quantity_state',
    'source_cost_raw',
    'source_cost_state',
    'server_recalculated_cost',
    'comparison',
    'source_annual_numeric_sum',
    'server_annual_known_sum',
    'row_issues',
  ];
  const table: unknown[][] = [header];
  for (const r of result.rows)
    for (const m of r.months)
      table.push([
        r.file,
        r.worksheet,
        r.csvRow,
        r.sourceItemName,
        r.category,
        r.sourceUnit,
        r.basePrice.raw,
        r.sourceAdjustedPrice.raw,
        r.serverAdjustedPrice,
        m.date,
        m.quantity.raw,
        m.quantity.state,
        m.sourceCost.raw,
        m.sourceCost.state,
        m.recalculatedCost,
        m.comparison,
        r.annualSourceNumericCostSum,
        r.annualRecalculatedKnownCostSum,
        r.issues.join(';'),
      ]);
  const escaped = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  await writeFile(
    path.join(outputDir, 'row-month-reconciliation.csv'),
    table.map((r) => r.map(escaped).join(',')).join('\r\n') + '\r\n',
  );
  console.log(
    JSON.stringify(
      {
        acceptance: result.acceptance,
        files: result.files,
        categoryCounts: result.categoryCounts,
        quantityStates: result.quantityStates,
        mainItemRows: result.mainItemRows,
        uniformRows: result.uniformRows,
        problems: result.problems,
        totals: result.totals.map(({ months: _months, ...r }) => r),
        previewValidRows: result.preview.rowCount,
        previewErrors: result.preview.errors.length,
        mutationSummary: result.mutationSummary,
      },
      null,
      2,
    ),
  );
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error(
      'Usage: tsx scripts/reconcile-syrona-plan.ts <source-directory> <evidence-directory>',
    );
  await writeReconciliation(process.argv[2], process.argv[3]);
}
