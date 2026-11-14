import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import {
  assert,
  fixed,
  inflation,
  quantities,
  text,
  uniformCalculation,
  PlanningError,
} from './calculations.ts';
export type ImportPolicy = 'ZERO_FILL' | 'STRICT';
export type Cell = { value: string | number | boolean | null; formula?: string } | null;
export type Workbook = { sheets: Array<{ name: string; rows: Cell[][] }> };
export type Mapping = {
  sheet: string;
  kind: 'ITEM' | 'UNIFORM';
  startRow: number;
  endRow: number;
  category: string;
  description: string;
  unit?: string;
  price: string;
  months?: string[];
  existingBalance?: string;
  staff?: string;
  perStaff?: string;
  contributionPercent?: string;
  balanceRule?: 'SUBTRACT' | 'IGNORE';
  balanceLabel?: string;
  skipRows?: number[];
};
export function column(value: string): number {
  assert(
    /^[A-Z]{1,2}$/i.test(value),
    'INVALID_COLUMN',
    'Columns must be Excel letters, e.g. A, B or AA.',
  );
  return [...value.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}
let activeParsers = 0;
export async function parseWorkbook(
  bytes: Buffer,
  filename: string,
  mime: string,
): Promise<Workbook> {
  assert(
    bytes.length > 0 && bytes.length <= 4194304,
    'FILE_SIZE',
    'Workbook must be between 1 byte and 4 MiB.',
  );
  const xls = /\.xls$/i.test(filename),
    xlsx = /\.xlsx$/i.test(filename),
    csv = /\.csv$/i.test(filename);
  assert(
    (csv && ['text/csv', 'application/csv'].includes(mime)) ||
      (xls && mime === 'application/vnd.ms-excel') ||
      (xlsx && mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'FILE_TYPE',
    'Use .csv, .xls or .xlsx with its matching MIME type.',
  );
  assert(
    csv ||
      (xls
        ? bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))
        : bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))),
    'FILE_SIGNATURE',
    'File signature does not match the Excel extension.',
  );
  assert(activeParsers < 2, 'IMPORT_BUSY', 'Workbook parser is busy. Retry shortly.', 429);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workbook-worker.mjs', import.meta.url), {
      workerData: { bytes, csv },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    activeParsers++;
    let settled = false;
    const finish = (err: Error | null, result?: Workbook) => {
      if (settled) return;
      settled = true;
      activeParsers--;
      clearTimeout(timer);
      void worker.terminate();
      if (err) reject(new PlanningError('WORKBOOK_INVALID', err.message));
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('Workbook parsing timed out.')), 5000);
    worker.once('message', (result) =>
      result.error ? finish(new Error(result.error)) : finish(null, result),
    );
    worker.once('error', (e) => finish(e));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`Workbook parser stopped (${code}).`));
    });
  });
}
export function previewWorkbook(
  book: Workbook,
  mappings: Mapping[],
  inflationPercent: unknown,
  policy: ImportPolicy = 'ZERO_FILL',
) {
  assert(['ZERO_FILL', 'STRICT'].includes(policy), 'IMPORT_POLICY', 'Choose ZERO_FILL or STRICT.');
  const normalizations: Array<{
    sheet: string;
    row: number;
    column: string;
    raw: unknown;
    value: string;
    reason: string;
  }> = [];
  const zeroFill = policy === 'ZERO_FILL';
  const bp = inflation(inflationPercent),
    items: Array<Record<string, unknown>> = [],
    uniforms: Array<Record<string, unknown>> = [],
    errors: Array<{ sheet: string; row: number; message: string }> = [],
    warnings: string[] = [],
    matches = new Set<string>(),
    covered = new Set<string>();
  assert(
    Array.isArray(mappings) && mappings.length > 0 && mappings.length <= 40,
    'MAPPINGS_REQUIRED',
    'Provide one or more explicit worksheet/category row mappings.',
  );
  for (const mapping of mappings) {
    const sheet = book.sheets.find((s) => s.name === mapping.sheet);
    assert(sheet, 'WORKSHEET_MISSING', `Worksheet ${mapping.sheet} not found.`);
    assert(['ITEM', 'UNIFORM'].includes(mapping.kind), 'INVALID_KIND', 'Choose ITEM or UNIFORM.');
    assert(
      Number.isInteger(mapping.startRow) &&
        Number.isInteger(mapping.endRow) &&
        mapping.startRow >= 1 &&
        mapping.endRow >= mapping.startRow &&
        mapping.endRow <= sheet.rows.length,
      'INVALID_ROWS',
      'Choose a valid inclusive worksheet row range.',
    );
    const category = text(mapping.category, 'Source category');
    if (mapping.kind === 'ITEM')
      assert(
        mapping.months?.length === 12,
        'MONTH_MAPPING_REQUIRED',
        'Map twelve quantity columns, January through December. Do not map cost columns.',
      );
    const read = (row: Cell[], name: string | undefined) => {
      assert(name, 'COLUMN_REQUIRED', 'Required field mapping is missing.');
      const cell = row[column(name)];
      assert(
        !cell?.formula && !(typeof cell?.value === 'string' && /^[=+@]/.test(cell.value.trim())),
        'FORMULA_INPUT',
        'Mapped input is a formula; provide an explicit reviewed input value or exclude the row. Derived cost formulas are not imported.',
      );
      return cell?.value ?? null;
    };
    for (let n = mapping.startRow; n <= mapping.endRow; n++) {
      if (mapping.skipRows?.includes(n)) continue;
      try {
        const key = `${sheet.name}:${n}`;
        assert(
          !covered.has(key),
          'ROW_MAPPED_TWICE',
          'Source row is included in more than one mapping.',
        );
        covered.add(key);
        const row = sheet.rows[n - 1] ?? [];
        if (row.every((c) => !c || c.value === null || c.value === '')) continue;
        const description = text(read(row, mapping.description), 'Item description');
        const normalize = (col: string | undefined, fallback: string) => {
          const raw = read(row, col);
          const trimmed = typeof raw === 'string' ? raw.trim() : raw;
          if (zeroFill && (trimmed === null || trimmed === '' || trimmed === '-')) {
            normalizations.push({
              sheet: sheet.name,
              row: n,
              column: col!,
              raw,
              value: fallback,
              reason: trimmed === '-' ? 'DASH' : 'MISSING',
            });
            return fallback;
          }
          if (typeof trimmed === 'string' && /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed))
            return trimmed.replace(/,/g, '');
          return trimmed;
        };
        const price = normalize(mapping.price, '0');
        fixed(price, 2, 'Base/buying price');
        const source = {
          sourceWorksheet: sheet.name,
          sourceRow: n,
          sourceFormula: row
            .filter((c) => c?.formula)
            .map((c) => c!.formula)
            .join('; ')
            .slice(0, 4000),
        };
        if (mapping.kind === 'ITEM') {
          const unit = text(normalize(mapping.unit, 'unit'), 'Unit', 60);
          const q = mapping.months!.map((col) => normalize(col, '0'));
          quantities(q);
          const match = `ITEM:${category.toLowerCase()}:${description.toLowerCase()}:${unit.toLowerCase()}`;
          assert(
            !matches.has(match) || zeroFill,
            'DUPLICATE_ITEM',
            'Duplicate matching item in this preview. Exclude duplicates explicitly using skipRows.',
          );
          matches.add(match);
          items.push({
            description,
            unit,
            basePrice: String(price),
            inflationPercent: null,
            quantities: q.map((v) => (v === null || v === '' ? null : String(v))),
            category,
            ...source,
          });
        } else {
          assert(
            mapping.balanceRule,
            'BALANCE_RULE_REQUIRED',
            'Explicit uniform balance treatment is required.',
          );
          const staff = normalize(mapping.staff, '0');
          fixed(staff, 3, 'Staff count');
          const input = {
            description,
            categoryId: 1,
            existingBalance: String(normalize(mapping.existingBalance, '0') ?? ''),
            buyingCost: String(price),
            staffCount: Number(staff),
            quantityPerStaff: String(normalize(mapping.perStaff, '0') ?? ''),
            contributionPercent: mapping.contributionPercent
              ? String(normalize(mapping.contributionPercent, '0') ?? '')
              : '0',
            balanceRule: mapping.balanceRule,
            ...source,
          };
          assert(
            zeroFill || read(row, mapping.staff) !== null,
            'STAFF_REQUIRED',
            'Staff count must be explicit.',
          );
          uniformCalculation(input);
          const match = `UNIFORM:${category.toLowerCase()}:${description.toLowerCase()}`;
          assert(
            !matches.has(match) || zeroFill,
            'DUPLICATE_ITEM',
            'Duplicate uniform projection in preview.',
          );
          matches.add(match);
          uniforms.push({
            ...input,
            category,
            balanceLabel: mapping.balanceLabel ?? 'Opening balance — source date not specified',
          });
        }
      } catch (error) {
        errors.push({
          sheet: sheet.name,
          row: n,
          message: error instanceof Error ? error.message : 'Invalid row',
        });
      }
    }
  }
  if (items.some((item) => (item.quantities as unknown[]).includes(null)))
    warnings.push(
      'Blank monthly quantities stay null/unplanned, not zero. Totals are partial until blanks are reviewed.',
    );
  if (zeroFill)
    warnings.push(
      `ZERO_FILL: ${normalizations.length} missing/dash cells defaulted; missing units use “unit”. These are planning assumptions, not verified source figures. Duplicate labels retain distinct source-row identities.`,
    );
  warnings.push(
    'Source formula text is retained for traceability only; derived costs are recalculated. No formulas are executed. Uniform contribution is an explicitly selected percentage of gross projected purchase cost; verify that this matches the source workbook.',
  );
  const result = {
    items,
    uniforms,
    errors,
    warnings,
    inflationBp: bp,
    policy,
    normalizations,
    rowCount: items.length + uniforms.length,
  };
  return {
    ...result,
    previewHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
  };
}
