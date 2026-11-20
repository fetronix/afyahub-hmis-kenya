/**
 * Syrona Medical Center HMIS — financial periods for the statements.
 *
 * A facility's financial year begins in a month it chooses. July is common in
 * Kenya and is the default, but January, April and October exist too, so no
 * range here is hardcoded to the calendar year. Every date is a plain
 * `YYYY-MM-DD` string in UTC: a statement period is a civil date range, not an
 * instant, and timezone arithmetic around midnight would shift an entry into
 * the wrong month.
 */

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';

export interface DateRange {
  start: string;
  end: string;
}

export interface FinancialYear {
  /** Calendar year the financial year starts in. */
  startYear: number;
  startMonth: number;
  label: string;
  start: string;
  end: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO.test(value)) return false;
  const [, y, m, d] = ISO.exec(value)!;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  if (!isIsoDate(value)) throw new Error(`"${value}" is not a valid date (YYYY-MM-DD).`);
  const [, y, m, d] = ISO.exec(value)!;
  return { year: Number(y), month: Number(m), day: Number(d) };
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthRange(year: number, month: number): DateRange {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) {
    throw new Error('Choose a calendar year between 1900 and 2999.');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Choose a calendar month between 1 and 12.');
  }
  return { start: iso(year, month, 1), end: iso(year, month, daysInMonth(year, month)) };
}

/** Add whole months to a `YYYY-MM-DD` date, clamping the day to the month end. */
export function addMonths(value: string, months: number): string {
  const { year, month, day } = parseIsoDate(value);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  return iso(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** The day before a date, as a date string. */
export function previousDay(value: string): string {
  const { year, month, day } = parseIsoDate(value);
  const stamp = new Date(Date.UTC(year, month - 1, day));
  stamp.setUTCDate(stamp.getUTCDate() - 1);
  return iso(stamp.getUTCFullYear(), stamp.getUTCMonth() + 1, stamp.getUTCDate());
}

/** Days between two dates, `to - from`, using civil-date arithmetic. */
export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function assertStartMonth(startMonth: number): number {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error('The financial year start month must be between 1 and 12.');
  }
  return startMonth;
}

/** The calendar year a financial year starts in, for a date inside it. */
export function financialYearStartYearFor(date: string, startMonth: number): number {
  assertStartMonth(startMonth);
  const { year, month } = parseIsoDate(date);
  return month >= startMonth ? year : year - 1;
}

/**
 * Label a financial year. A January year is written "2026"; any other start
 * month spans two calendar years and is written "2025/2026", which is what a
 * Kenyan balance sheet carries at its head.
 */
export function financialYearLabel(startYear: number, startMonth: number): string {
  assertStartMonth(startMonth);
  return startMonth === 1 ? String(startYear) : `${startYear}/${startYear + 1}`;
}

/** Resolve a start year to the full financial year it denotes. */
export function financialYear(startYear: number, startMonth: number): FinancialYear {
  assertStartMonth(startMonth);
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 2999) {
    throw new Error('Choose a financial year start between 1900 and 2999.');
  }
  const start = iso(startYear, startMonth, 1);
  const end = previousDay(addMonths(start, 12));
  return { startYear, startMonth, label: financialYearLabel(startYear, startMonth), start, end };
}

/** The financial year that contains a date. */
export function financialYearFor(date: string, startMonth: number): FinancialYear {
  return financialYear(financialYearStartYearFor(date, startMonth), startMonth);
}

/** Quarter 1–4 of the financial year, not of the calendar year. */
export function quarterRange(fy: FinancialYear, quarter: number): DateRange {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error('Choose a quarter between 1 and 4.');
  }
  const start = addMonths(fy.start, (quarter - 1) * 3);
  const end = previousDay(addMonths(start, 3));
  return { start, end };
}

export interface PeriodSelection {
  frequency: Frequency;
  /** Financial year start year. Ignored for CUSTOM, which is validated against the year instead. */
  startYear?: number;
  /** Calendar month, 1–12, for MONTHLY. Must fall inside the financial year. */
  month?: number;
  quarter?: number;
  startDate?: string;
  endDate?: string;
}

export interface ResolvedPeriod {
  frequency: Frequency;
  financialYear: string;
  start: string;
  end: string;
  label: string;
  /** True when the range is exactly one financial year. */
  isFullFinancialYear: boolean;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function assertWithinFinancialYear(range: DateRange, fy: FinancialYear): void {
  if (compareDates(range.start, fy.start) < 0 || compareDates(range.end, fy.end) > 0) {
    throw new Error(
      `The period ${range.start} to ${range.end} falls outside the financial year ${fy.label} ` +
        `(${fy.start} to ${fy.end}). Choose a date inside the configured financial year.`,
    );
  }
}

/**
 * Resolve a selection to concrete dates. Nothing is guessed: a monthly period
 * that does not lie inside the selected financial year is rejected rather than
 * silently moved, and a custom range that spans two financial years is rejected
 * because a statement cannot belong to two years at once.
 */
export function resolvePeriod(selection: PeriodSelection, startMonth: number): ResolvedPeriod {
  assertStartMonth(startMonth);
  const { frequency } = selection;

  if (frequency === 'CUSTOM') {
    if (!isIsoDate(selection.startDate) || !isIsoDate(selection.endDate)) {
      throw new Error('A custom period needs a valid start and end date.');
    }
    const start = selection.startDate;
    const end = selection.endDate;
    if (compareDates(end, start) < 0) throw new Error('The period end cannot precede its start.');
    const fyStart = financialYearStartYearFor(start, startMonth);
    const fy = financialYear(fyStart, startMonth);
    assertWithinFinancialYear({ start, end }, fy);
    return {
      frequency,
      financialYear: fy.label,
      start,
      end,
      label: periodLabel(start, end),
      isFullFinancialYear: start === fy.start && end === fy.end,
    };
  }

  const startYear = Number(selection.startYear);
  const fy = financialYear(startYear, startMonth);

  if (frequency === 'ANNUAL') {
    return {
      frequency,
      financialYear: fy.label,
      start: fy.start,
      end: fy.end,
      label: `Financial year ${fy.label}`,
      isFullFinancialYear: true,
    };
  }

  if (frequency === 'QUARTERLY') {
    const range = quarterRange(fy, Number(selection.quarter));
    return {
      frequency,
      financialYear: fy.label,
      start: range.start,
      end: range.end,
      label: `Q${Number(selection.quarter)} ${fy.label} (${periodLabel(range.start, range.end)})`,
      isFullFinancialYear: false,
    };
  }

  if (frequency === 'MONTHLY') {
    const month = Number(selection.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('Choose a calendar month between 1 and 12.');
    }
    const { year } = parseIsoDate(fy.start);
    // A monthly period is a calendar month. Pick the calendar year in which
    // that month falls inside the financial year (a July year spans two).
    const candidates = [year, year + 1];
    const matching = candidates
      .map((candidate) => monthRange(candidate, month))
      .filter(
        (range) => compareDates(range.start, fy.start) >= 0 && compareDates(range.end, fy.end) <= 0,
      );
    if (matching.length !== 1) {
      throw new Error(
        `${MONTHS[month - 1]} is not a month of the financial year ${fy.label}. ` +
          `Its months run from ${MONTHS[startMonth - 1]} to ${MONTHS[(startMonth + 10) % 12]}.`,
      );
    }
    const range = matching[0];
    return {
      frequency,
      financialYear: fy.label,
      start: range.start,
      end: range.end,
      label: `${MONTHS[month - 1]} ${parseIsoDate(range.start).year}`,
      isFullFinancialYear: false,
    };
  }

  throw new Error(`Unknown frequency "${String(frequency)}".`);
}

/** "1 July 2025 to 31 July 2025" — the way a statement heading reads. */
export function periodLabel(start: string, end: string): string {
  if (start === end) return formatLongDate(start);
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (a.year === b.year && a.month === b.month) {
    return `${a.day} to ${b.day} ${MONTHS[a.month - 1]} ${a.year}`;
  }
  if (a.year === b.year) {
    return `${a.day} ${MONTHS[a.month - 1]} to ${b.day} ${MONTHS[b.month - 1]} ${a.year}`;
  }
  return `${formatLongDate(start)} to ${formatLongDate(end)}`;
}

export function formatLongDate(value: string): string {
  const { year, month, day } = parseIsoDate(value);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The same span one year earlier. Used when a facility wants prior-year comparatives. */
export function priorYearRange(range: DateRange): DateRange {
  return { start: addMonths(range.start, -12), end: addMonths(range.end, -12) };
}

/**
 * The immediately preceding period of the same length and frequency. A monthly
 * statement compares with the previous month; an annual one with nothing unless
 * asked, because a "previous financial year" that has no ledger behind it must
 * not be invented.
 */
export function priorPeriodRange(period: ResolvedPeriod): DateRange {
  if (period.frequency === 'MONTHLY') {
    const { year, month } = parseIsoDate(period.start);
    const { year: py, month: pm } = parseIsoDate(addMonths(iso(year, month, 1), -1));
    return monthRange(py, pm);
  }
  if (period.frequency === 'QUARTERLY') {
    return { start: addMonths(period.start, -3), end: previousDay(period.start) };
  }
  return { start: addMonths(period.start, -12), end: previousDay(period.start) };
}

export type ComparativeMode = 'PRIOR_PERIOD' | 'PRIOR_YEAR' | 'NONE';

export interface ResolvedComparative {
  mode: ComparativeMode;
  range: DateRange | null;
  label: string | null;
}

/**
 * Resolve the comparative columns. The caller decides whether the prior range
 * actually has ledger behind it; this function only computes the dates.
 */
export function resolveComparative(
  period: ResolvedPeriod,
  mode: ComparativeMode,
): ResolvedComparative {
  if (mode === 'NONE') return { mode, range: null, label: null };
  const range =
    mode === 'PRIOR_YEAR'
      ? priorYearRange({ start: period.start, end: period.end })
      : priorPeriodRange(period);
  return { mode, range, label: periodLabel(range.start, range.end) };
}
