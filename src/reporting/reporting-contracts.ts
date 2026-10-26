/**
 * JaliCare HMIS
 * Reporting contracts: stay statistics and occupancy arithmetic.
 *
 * Deliberately free of database imports so the numbers a facility is
 * judged on can be unit-tested without PostgreSQL. The service layer
 * gathers rows; everything that decides what those rows mean lives here.
 */

import { mean, median, roundDays } from '../utils/dates.ts';

export interface StayBucket {
  label: string;
  /** Inclusive lower bound, in days. */
  min: number;
  /** Inclusive upper bound, in days; null means unbounded. */
  max: number | null;
  count: number;
}

export interface StayStats {
  count: number;
  averageDays: number | null;
  medianDays: number | null;
  longestDays: number | null;
}

/**
 * Histogram buckets for a stay distribution.
 *
 * Boundaries are inclusive on both ends and do not overlap: a 3-day
 * stay is in "1–3 days", a 4-day stay is in "4–7 days".
 */
export const STAY_BUCKETS: ReadonlyArray<{
  label: string;
  min: number;
  max: number | null;
}> = [
  { label: 'Under 1 day', min: 0, max: 0 },
  { label: '1–3 days', min: 1, max: 3 },
  { label: '4–7 days', min: 4, max: 7 },
  { label: '8–14 days', min: 8, max: 14 },
  { label: '15+ days', min: 15, max: null },
];

/** Days at which a stay becomes a discharge-review item. */
export const OVERSTAY_DAYS = 7;

/** Bucket a single stay length. Negative values clamp to "Under 1 day". */
export function bucketIndexFor(days: number): number {
  const safe = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;

  for (let index = 0; index < STAY_BUCKETS.length; index += 1) {
    const bucket = STAY_BUCKETS[index];

    if (safe < bucket.min) continue;
    if (bucket.max === null || safe <= bucket.max) return index;
  }

  return STAY_BUCKETS.length - 1;
}

/** Bucket counts for a list of stay lengths. */
export function bucketStays(days: number[]): StayBucket[] {
  const buckets = STAY_BUCKETS.map((bucket) => ({ ...bucket, count: 0 }));

  for (const value of days) {
    buckets[bucketIndexFor(value)].count += 1;
  }

  return buckets;
}

/** Average, median and longest for a list of stay lengths. */
export function summariseStays(days: number[]): StayStats {
  if (days.length === 0) {
    return { count: 0, averageDays: null, medianDays: null, longestDays: null };
  }

  const average = mean(days);
  const middle = median(days);

  return {
    count: days.length,
    averageDays: average === null ? null : roundDays(average),
    medianDays: middle === null ? null : roundDays(middle),
    longestDays: Math.max(...days),
  };
}

/** Stays at or beyond the review threshold. */
export function countOverstays(days: number[]): number {
  return days.filter((value) => value >= OVERSTAY_DAYS).length;
}

/**
 * Occupancy as a percentage with one decimal.
 *
 * A ward with no beds is 0%, not NaN and not 100%. Occupied can never
 * exceed capacity in a well-formed bed board, but the calculation is
 * clamped so a stale bed row cannot report 120% occupancy.
 */
export function occupancyPercent(occupied: number, total: number): number {
  if (!Number.isFinite(occupied) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const clamped = Math.min(Math.max(occupied, 0), total);

  return Math.round((clamped / total) * 1000) / 10;
}

/**
 * Bed-day contribution of one admission for one calendar day.
 *
 * A patient occupies a bed from their admission date until the day
 * before discharge. A same-day admission and discharge still counts as
 * one bed-day, matching the billing rule in billing.service.ts, so the
 * trend and the bed-day revenue agree.
 */
export function occupiesBedOn(admission: Date, discharge: Date | null, day: Date): boolean {
  const dayStart = new Date(day.getTime());
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);

  if (admission.getTime() > dayEnd.getTime()) return false;

  if (discharge) {
    /* Discharged before this day began: bed is free. */
    if (discharge.getTime() < dayStart.getTime()) return false;
  }

  return true;
}
