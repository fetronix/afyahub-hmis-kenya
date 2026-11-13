/** Calendar dates are presented in Kenya time; database timestamps are stored without a zone. */
export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'previousMonth' | 'custom';
export interface DashboardRange {
  start: string;
  end: string;
}

const DAY = 86_400_000;

export function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9998) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  if (!date) throw new Error('Invalid calendar date');
  return isoDate(new Date(date.getTime() + days * DAY));
}

export function kenyaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validateRange(start: unknown, end: unknown): DashboardRange | null {
  const first = parseCalendarDate(start);
  const last = parseCalendarDate(end);
  if (!first || !last) return null;
  const days = (last.getTime() - first.getTime()) / DAY + 1;
  if (days < 1 || days > 366) return null;
  return { start: start as string, end: end as string };
}

export function previousRange(range: DashboardRange): DashboardRange {
  const start = parseCalendarDate(range.start);
  const end = parseCalendarDate(range.end);
  if (!start || !end) throw new Error('Invalid calendar range');
  const days = (end.getTime() - start.getTime()) / DAY + 1;
  return { start: addCalendarDays(range.start, -days), end: addCalendarDays(range.start, -1) };
}

export function rangeForPreset(
  preset: Exclude<DatePreset, 'custom'>,
  today = kenyaToday(),
): DashboardRange {
  const date = parseCalendarDate(today);
  if (!date) throw new Error('Invalid calendar date');
  switch (preset) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const yesterday = addCalendarDays(today, -1);
      return { start: yesterday, end: yesterday };
    }
    case 'week': {
      const dayOfWeek = (date.getUTCDay() + 6) % 7;
      return {
        start: addCalendarDays(today, -dayOfWeek),
        end: addCalendarDays(today, 6 - dayOfWeek),
      };
    }
    case 'month': {
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
      return { start: `${today.slice(0, 7)}-01`, end: isoDate(last) };
    }
    case 'previousMonth': {
      const firstThisMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
      const lastPreviousMonth = new Date(firstThisMonth.getTime() - DAY);
      const firstPreviousMonth = new Date(
        Date.UTC(lastPreviousMonth.getUTCFullYear(), lastPreviousMonth.getUTCMonth(), 1),
      );
      return { start: isoDate(firstPreviousMonth), end: isoDate(lastPreviousMonth) };
    }
  }
}

/** At most six contiguous buckets; each selected day belongs to exactly one. */
export function makeBuckets(range: DashboardRange): Array<DashboardRange> {
  const start = parseCalendarDate(range.start);
  const end = parseCalendarDate(range.end);
  if (!start || !end || !validateRange(range.start, range.end))
    throw new Error('Invalid calendar range');
  const count = (end.getTime() - start.getTime()) / DAY + 1;
  const width = Math.ceil(count / 6);
  const buckets: DashboardRange[] = [];
  for (let offset = 0; offset < count; offset += width) {
    buckets.push({
      start: addCalendarDays(range.start, offset),
      end: addCalendarDays(range.start, Math.min(offset + width - 1, count - 1)),
    });
  }
  return buckets;
}
