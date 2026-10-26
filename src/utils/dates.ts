/**
 * JaliCare HMIS
 * Date parsing shared by billing and reporting.
 *
 * admission_date and discharge_date are stored as text, written by
 * different code paths over time as 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm'
 * and occasionally with slashes. Everything that measures a stay has to
 * read them the same way, or the bed-day charge and the length-of-stay
 * report disagree about how long a patient was in the ward.
 */

/**
 * Parse a loose clinical date string.
 *
 * Returns null rather than an Invalid Date so callers can skip a bad
 * row instead of crashing a ward list.
 */
export function parseLooseDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  /* 'YYYY-MM-DD HH:mm' is not consistently parsed across engines. */
  const normalised = value.trim().replace(' ', 'T').replace(/\//g, '-');

  const parsed = new Date(normalised);

  if (!Number.isNaN(parsed.getTime())) return parsed;

  const dateOnly = new Date(normalised.slice(0, 10));

  if (!Number.isNaN(dateOnly.getTime())) return dateOnly;

  return null;
}

/** Local calendar date as YYYY-MM-DD. */
export function formatDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

/**
 * Whole days between two instants, floored at zero.
 *
 * A stay of 30 hours is 1 day here, matching how a nurse reads a bed
 * board ("day 2"), not how a lawyer reads a tenancy.
 */
export function daysBetween(start: Date, end: Date): number {
  const millis = end.getTime() - start.getTime();

  if (!Number.isFinite(millis) || millis <= 0) return 0;

  return Math.floor(millis / 86_400_000);
}

/** Days with one decimal, for averages. */
export function roundDays(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Median of a numeric list; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle];

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Mean of a numeric list; null when empty. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
