import {
  createFinancialBaseline,
  effectiveFormula,
  type FinancialBudget,
  type BudgetLine,
} from './financial-budget.model.ts';
export type BudgetCell = {
  cents: number | null;
  error?: string;
  formula: string;
  overridden?: boolean;
};
export type BudgetSeries = { months: BudgetCell[]; annual: BudgetCell };
export type BudgetResult = {
  rows: Record<string, BudgetSeries>;
  departments: Record<string, BudgetSeries>;
  income: BudgetSeries;
  cogs: BudgetSeries;
  expenses: BudgetSeries;
  gross: BudgetSeries;
  net: BudgetSeries;
  grossMargin: BudgetSeries;
  netMargin: BudgetSeries;
  expenseRatio: BudgetSeries;
  cogsRatio: BudgetSeries;
  departmentalMargins: Record<string, BudgetSeries>;
  errors: string[];
};
class FormulaError extends Error {}
type Rational = { n: bigint; d: bigint };
const ratio = (n: bigint, d = 1n): Rational => {
  if (d === 0n) throw new FormulaError('#DIV/0!');
  return { n, d };
};
function decimal(value: string): Rational {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(value)) throw new FormulaError('#VALUE!');
  const [whole, fraction = ''] = value.split('.');
  return ratio(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}
function roundedCents(v: Rational): number {
  let n = v.n * 100n,
    d = v.d;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  if (negative) n = -n;
  let q = n / d;
  if ((n % d) * 2n >= d) q++;
  const result = Number(negative ? -q : q);
  if (!Number.isSafeInteger(result) || Math.abs(result) > 900_000_000_000)
    throw new FormulaError('#NUM!');
  return result;
}
export function inputCents(value: string): number {
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      'Enter a number with at most two decimal places, without currency symbols or commas.',
    );
  return roundedCents(
    value.startsWith('-')
      ? ratio(-decimal(value.slice(1)).n, decimal(value.slice(1)).d)
      : decimal(value),
  );
}
/** Arithmetic-only grammar. No eval, JavaScript, spreadsheet caches, functions or network access. */
function expression(
  source: string,
  reference: (code: string, offset: number) => number,
  previous: () => number,
): number {
  if (source.length > 500) throw new FormulaError('#FORMULA!');
  const text = source.replace(/^=/, '');
  let pos = 0,
    operations = 0;
  const space = () => {
    while (/\s/.test(text[pos] ?? '') && pos < text.length) pos++;
  };
  const peek = () => {
    space();
    return text[pos];
  };
  function primary(depth = 0): Rational {
    if (depth > 40 || ++operations > 200) throw new FormulaError('#FORMULA!');
    const next = peek();
    if (next === '+' || next === '-') {
      pos++;
      const v = primary(depth + 1);
      return next === '-' ? ratio(-v.n, v.d) : v;
    }
    if (next === '(') {
      pos++;
      const v = sum(depth + 1);
      if (peek() !== ')') throw new FormulaError('#FORMULA!');
      pos++;
      return v;
    }
    const rest = text.slice(pos);
    const ref = /^\[([A-Z][A-Z0-9-]{0,30})(?:@(-?\d{1,2}))?\]/.exec(rest);
    if (ref) {
      pos += ref[0].length;
      return ratio(BigInt(reference(ref[1], Number(ref[2] ?? 0))), 100n);
    }
    if (rest.startsWith('PREV')) {
      pos += 4;
      return ratio(BigInt(previous()), 100n);
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      pos += number[0].length;
      return decimal(number[0]);
    }
    throw new FormulaError('#FORMULA!');
  }
  function product(depth: number): Rational {
    let value = primary(depth);
    while (peek() === '*' || peek() === '/') {
      const op = text[pos++],
        right = primary(depth);
      value =
        op === '*'
          ? ratio(value.n * right.n, value.d * right.d)
          : ratio(value.n * right.d, value.d * right.n);
      if (value.n.toString().length > 160 || value.d.toString().length > 160)
        throw new FormulaError('#NUM!');
    }
    return value;
  }
  function sum(depth: number): Rational {
    let value = product(depth);
    while (peek() === '+' || peek() === '-') {
      const op = text[pos++],
        r = product(depth);
      value = ratio(value.n * r.d + (op === '+' ? r.n : -r.n) * value.d, value.d * r.d);
    }
    return value;
  }
  const result = sum(0);
  space();
  if (pos !== text.length) throw new FormulaError('#FORMULA!');
  return roundedCents(result);
}
const sumCells = (cells: BudgetCell[], formula: string): BudgetCell =>
  cells.some((c) => c.cents === null)
    ? { cents: null, error: cells.find((c) => c.error)?.error ?? '#VALUE!', formula }
    : { cents: cells.reduce((n, c) => n + c.cents!, 0), formula };
const series = (months: BudgetCell[]): BudgetSeries => ({
  months,
  annual: sumCells(months, '=SUM(Jan:Dec)'),
});
const aggregate = (values: BudgetSeries[], formula: string) =>
  series(
    Array.from({ length: 12 }, (_, m) =>
      sumCells(
        values.map((v) => v.months[m]),
        formula,
      ),
    ),
  );
function subtract(a: BudgetSeries, b: BudgetSeries, formula: string) {
  return series(
    a.months.map((c, m) =>
      sumCells(
        [c, { ...b.months[m], cents: b.months[m].cents === null ? null : -b.months[m].cents! }],
        formula,
      ),
    ),
  );
}
function percentages(a: BudgetSeries, b: BudgetSeries, formula: string): BudgetSeries {
  const divide = (x: BudgetCell, y: BudgetCell): BudgetCell =>
    x.cents === null || y.cents === null
      ? { cents: null, error: x.error ?? y.error, formula }
      : { cents: y.cents > 0 ? Math.round((x.cents / y.cents) * 10000) : 0, formula };
  return {
    months: a.months.map((c, m) => divide(c, b.months[m])),
    annual: divide(a.annual, b.annual),
  };
}
export function calculateFinancialBudget(model: FinancialBudget): BudgetResult {
  const cache = new Map<string, BudgetCell>(),
    visiting = new Set<string>();
  const rowsByCode = new Map(model.rows.map((r) => [r.code, r]));
  function cell(code: string, month: number): BudgetCell {
    const key = `${code}:${month}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const row = rowsByCode.get(code);
    if (!row || month < 0 || month > 11) return { cents: null, error: '#REF!', formula: '' };
    const formula = effectiveFormula(model, row, month),
      override = row.overrides[String(month)];
    if (visiting.has(key)) return { cents: null, error: '#CYCLE!', formula };
    visiting.add(key);
    let result: BudgetCell;
    try {
      const get = (other: string, m: number) => {
        const c = cell(other, m);
        if (c.cents === null) throw new FormulaError(c.error ?? '#VALUE!');
        return c.cents;
      };
      const cents =
        override !== undefined
          ? inputCents(override)
          : formula.startsWith('=')
            ? expression(
                formula,
                (ref, offset) => get(ref, month + offset),
                () => get(code, month - 1),
              )
            : inputCents(formula);
      result = { cents, formula, overridden: override !== undefined };
    } catch (e) {
      result = { cents: null, error: e instanceof FormulaError ? e.message : '#VALUE!', formula };
    }
    visiting.delete(key);
    cache.set(key, result);
    return result;
  }
  const rows = Object.fromEntries(
    model.rows.map((r) => [r.code, series(Array.from({ length: 12 }, (_, m) => cell(r.code, m)))]),
  );
  const departments = Object.fromEntries(
    model.departments.map((d) => [
      d.id,
      aggregate(
        model.rows.filter((r) => r.departmentId === d.id).map((r) => rows[r.code]),
        `=SUM(${d.name} line items)`,
      ),
    ]),
  );
  const forKind = (kinds: string[]) =>
    aggregate(
      model.departments.filter((d) => kinds.includes(d.kind)).map((d) => departments[d.id]),
      `=SUM(${kinds.join(' + ')} department subtotals)`,
    );
  const income = forKind(['INCOME']),
    cogs = forKind(['COGS']),
    expenses = forKind(['COGS', 'OPEX']);
  const gross = subtract(income, cogs, '=Total Income - COGS'),
    net = subtract(income, expenses, '=Total Income - Total Expenses');
  const departmentalMargins = Object.fromEntries(
    model.departments
      .filter((d) => d.kind === 'INCOME')
      .map((d) => {
        const cost = aggregate(
          model.rows.filter((r) => r.marginDepartmentId === d.id).map((r) => rows[r.code]),
          '=SUM(Linked COGS)',
        );
        return [
          d.id,
          percentages(
            subtract(departments[d.id], cost, '=Department Revenue - Linked COGS'),
            departments[d.id],
            '=IF(Revenue > 0, (Revenue - Linked COGS) / Revenue * 100, 0)',
          ),
        ];
      }),
  );
  const errors = model.rows.flatMap((r) =>
    rows[r.code].months.flatMap((c, m) =>
      c.error ? [`${r.code} month ${m + 1}: ${c.error}`] : [],
    ),
  );
  return {
    rows,
    departments,
    income,
    cogs,
    expenses,
    gross,
    net,
    departmentalMargins,
    errors,
    grossMargin: percentages(gross, income, '=IF(Income > 0, Gross Profit / Income * 100, 0)'),
    netMargin: percentages(net, income, '=IF(Income > 0, Net Profit / Income * 100, 0)'),
    expenseRatio: percentages(
      expenses,
      income,
      '=IF(Income > 0, Total Expenses / Income * 100, 0)',
    ),
    cogsRatio: percentages(cogs, income, '=IF(Income > 0, COGS / Income * 100, 0)'),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function validateFinancialBudget(raw: unknown): FinancialBudget {
  const reject = (message: string): never => {
    throw new Error(message);
  };
  if (!raw || typeof raw !== 'object') return reject('Budget model is required.');
  const model = raw as FinancialBudget;
  if (
    model.schemaVersion !== 1 ||
    model.year !== 2026 ||
    typeof model.dialysisFeesAprDec !== 'boolean' ||
    !Array.isArray(model.rows) ||
    model.rows.length > 200 ||
    !Array.isArray(model.departments) ||
    model.departments.length > 40
  )
    return reject('Unsupported budget model or size.');
  const ids = new Set<string>(),
    codes = new Set<string>();
  for (const d of model.departments) {
    if (
      !d ||
      typeof d.name !== 'string' ||
      !d.name.trim() ||
      d.name.length > 100 ||
      !/^[-a-zA-Z0-9]{1,40}$/.test(d.id) ||
      ids.has(d.id) ||
      !['INCOME', 'COGS', 'OPEX'].includes(d.kind)
    )
      return reject('Invalid or duplicate department.');
    ids.add(d.id);
  }
  for (const r of model.rows) {
    if (
      !r ||
      typeof r.name !== 'string' ||
      !r.name.trim() ||
      r.name.length > 160 ||
      !ids.has(r.departmentId) ||
      !/^([A-Z][A-Z0-9-]{0,30})$/.test(r.code) ||
      codes.has(r.code) ||
      !['Manual', '50% MoM', 'Volume-Linked', 'Linear +Step', 'Revenue %'].includes(r.rule) ||
      !Array.isArray(r.cells) ||
      r.cells.length !== 12 ||
      r.cells.some((c) => typeof c !== 'string' || c.length > 500) ||
      !r.overrides ||
      typeof r.overrides !== 'object' ||
      Array.isArray(r.overrides)
    )
      return reject('Invalid or duplicate budget line.');
    if (
      Object.entries(r.overrides).some(
        ([m, v]) => !/^(?:[0-9]|10|11)$/.test(m) || typeof v !== 'string' || v.length > 30,
      )
    )
      return reject('Invalid cell override.');
    if (
      r.marginDepartmentId &&
      (model.departments.find((d) => d.id === r.departmentId)?.kind !== 'COGS' ||
        !model.departments.some((d) => d.id === r.marginDepartmentId && d.kind === 'INCOME'))
    )
      return reject('Cost attribution requires a valid income department and COGS line.');
    codes.add(r.code);
  }
  const baseline = createFinancialBaseline();
  for (const d of baseline.departments) {
    const saved = model.departments.find((v) => v.id === d.id);
    if (canonical(saved) !== canonical(d))
      return reject('Baseline departments are protected. Create custom departments instead.');
  }
  for (const r of baseline.rows) {
    const saved = model.rows.find((v) => v.code === r.code);
    if (!saved || canonical({ ...saved, overrides: {} }) !== canonical(r))
      return reject('Baseline rules are protected. Edit values through explicit overrides.');
  }
  for (const d of model.departments)
    if (!baseline.departments.some((v) => v.id === d.id) && d.custom !== true)
      return reject('New departments must be marked custom.');
  for (const r of model.rows)
    if (!baseline.rows.some((v) => v.code === r.code) && r.custom !== true)
      return reject('New rows must be marked custom.');
  const result = calculateFinancialBudget(model);
  if (result.errors.length) return reject(result.errors.slice(0, 4).join('; '));
  return model;
}
export function replaceBudgetLine(model: FinancialBudget, line: BudgetLine): FinancialBudget {
  return { ...model, rows: model.rows.map((r) => (r.code === line.code ? line : r)) };
}
