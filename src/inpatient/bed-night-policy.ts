import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { parseMoneyToCents } from '../billing/settlement.ts';

export interface BedNightPolicy {
  timezone: string;
  cutoffMinutes: number;
  graceMinutes: number;
  sameDayRule: 'ONE' | 'ZERO';
}

export interface OccupancyPeriod {
  id: number;
  startedAt: Date;
  endedAt: Date | null;
  dailyRateSnapshot: string | null;
}

export interface CalculatedBedNight {
  date: string;
  cutoffAt: Date | null;
  occupancyId: number;
  rate: string | null;
}

export class BedPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'BedPolicyError';
  }
}

export function validBedPolicy(policy: BedNightPolicy | null): policy is BedNightPolicy {
  return !!policy && validTimezone(policy.timezone) &&
    Number.isInteger(policy.cutoffMinutes) && policy.cutoffMinutes >= 0 && policy.cutoffMinutes < 1440 &&
    Number.isInteger(policy.graceMinutes) && policy.graceMinutes >= 0 && policy.graceMinutes < 1440 &&
    (policy.sameDayRule === 'ONE' || policy.sameDayRule === 'ZERO');
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const wallFormatters = new Map<string, Intl.DateTimeFormat>();
const cutoffCache = new Map<string, { nominal: number; instants: number[] }>();
function wall(timezone: string, instant: Date): Wall {
  let formatter = wallFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    wallFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const value = (key: string) => Number(parts.find((part) => part.type === key)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}
function utcWall(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * Map a facility-local wall cutoff to an instant. Around a DST gap or fold
 * a local time can have zero or two instants: refuse to guess which one.
 */
function cutoffCandidates(date: string, minutes: number, timezone: string): { nominal: number; instants: number[] } {
  const key = `${timezone}:${date}:${minutes}`;
  const cached = cutoffCache.get(key);
  if (cached) return cached;
  const [year, month, day] = date.split('-').map(Number);
  const target: Wall = { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 };
  const nominal = utcWall(target);
  const offsets = new Set<number>();
  // Sampling over three days finds both offsets around a transition, including
  // non-hour offsets. Round to seconds to match Intl's displayed precision.
  for (let h = -36; h <= 36; h += 3) {
    const at = nominal + h * 3_600_000;
    offsets.add(utcWall(wall(timezone, new Date(at))) - at);
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((at) => utcWall(wall(timezone, new Date(at))) === nominal);
  const result = { nominal, instants: [...new Set(candidates)].sort((a, b) => a - b) };
  // Historical calculation can be replayed once per night; cache the
  // timezone conversion without permitting unbounded process memory.
  if (cutoffCache.size >= 10_000) cutoffCache.delete(cutoffCache.keys().next().value!);
  cutoffCache.set(key, result);
  return result;
}

export function cutoffInstant(date: string, minutes: number, timezone: string): Date {
  const { instants } = cutoffCandidates(date, minutes, timezone);
  if (instants.length !== 1)
    throw new BedPolicyError('BED_CUTOFF_AMBIGUOUS', 'The local billing cutoff is skipped or repeated by a timezone transition; review is required.');
  return new Date(instants[0]);
}

function datePlusOne(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * One night per local cutoff occupied. Each cutoff belongs to the half-open
 * occupancy period [start,end); a transfer at the cutoff belongs to the new
 * bed. A final discharge at or before cutoff + grace removes that cutoff.
 * Same-day ZERO suppresses the entire charge; ONE makes it exactly one, using
 * the cutoff bed if present, otherwise the last occupied bed. The same rules
 * run with an explicit as-of timestamp for an estimate; no browser clock is
 * part of the billing decision. No date cap silently truncates a stay.
 */
export function calculateBedNights(
  policy: BedNightPolicy,
  periods: readonly OccupancyPeriod[],
  asOf: Date,
): CalculatedBedNight[] {
  if (!validBedPolicy(policy)) throw new BedPolicyError('BED_POLICY_REQUIRED', 'The facility bed-night policy is missing or invalid.');
  if (!Number.isFinite(asOf.getTime()) || periods.length === 0)
    throw new BedPolicyError('BED_OCCUPANCY_REQUIRED', 'Bed occupancy history is missing or invalid.');
  const sorted = [...periods].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id - b.id);
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const start = row.startedAt.getTime();
    const end = row.endedAt?.getTime() ?? asOf.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > asOf.getTime() ||
      (i < sorted.length - 1 && (row.endedAt === null || end !== sorted[i + 1].startedAt.getTime())) ||
      (row.dailyRateSnapshot !== null && (parseMoneyToCents(row.dailyRateSnapshot) ?? 0) <= 0))
      throw new BedPolicyError('BED_OCCUPANCY_CONFLICT', 'Bed periods overlap, have a gap, or contain invalid evidence; review is required.');
  }
  const first = sorted[0].startedAt;
  const last = sorted[sorted.length - 1];
  const end = last.endedAt ?? asOf;
  if (end.getTime() > asOf.getTime() || end.getTime() < first.getTime())
    throw new BedPolicyError('BED_OCCUPANCY_CONFLICT', 'The occupancy end is invalid.');
  const startDay = calendarDateInZone(policy.timezone, first);
  const endDay = calendarDateInZone(policy.timezone, end);
  if (startDay === endDay && policy.sameDayRule === 'ZERO') return [];
  const events: CalculatedBedNight[] = [];
  let date = startDay;
  let count = 0;
  while (date <= endDay) {
    if (++count > 3660)
      throw new BedPolicyError('BED_STAY_TOO_LONG', 'The recorded stay exceeds the safe calculation limit; review is required.');
    const candidates = cutoffCandidates(date, policy.cutoffMinutes, policy.timezone);
    if (candidates.instants.length !== 1) {
      // A fold matters if either real occurrence falls inside the stay. For a
      // skipped wall time, review only if the recorded local wall interval
      // spans it. A transition earlier/later on the same day is irrelevant.
      const intersects = candidates.instants.length > 1
        ? candidates.instants.some((instant) => instant >= first.getTime() && instant < end.getTime())
        : utcWall(wall(policy.timezone, first)) <= candidates.nominal && candidates.nominal < utcWall(wall(policy.timezone, end));
      if (intersects) throw new BedPolicyError('BED_CUTOFF_AMBIGUOUS', 'The occupied local billing cutoff is skipped or repeated by a timezone transition; review is required.');
      date = datePlusOne(date);
      continue;
    }
    const cutoff = new Date(candidates.instants[0]);
    if (cutoff.getTime() >= first.getTime() && cutoff.getTime() < end.getTime()) {
      const row = sorted.find((p) => p.startedAt.getTime() <= cutoff.getTime() && (p.endedAt ?? end).getTime() > cutoff.getTime());
      if (!row) throw new BedPolicyError('BED_OCCUPANCY_CONFLICT', 'No bed occupied the recorded cutoff.');
      if (end.getTime() - cutoff.getTime() > policy.graceMinutes * 60_000) {
        events.push({ date, cutoffAt: cutoff, occupancyId: row.id, rate: row.dailyRateSnapshot });
      }
    }
    date = datePlusOne(date);
  }
  if (startDay === endDay && policy.sameDayRule === 'ONE' && events.length === 0) {
    return [{ date: startDay, cutoffAt: null, occupancyId: last.id, rate: last.dailyRateSnapshot }];
  }
  return events;
}
