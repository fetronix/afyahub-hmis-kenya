import { describe, expect, it } from 'vitest';
import { calculateBedNights, cutoffInstant, type BedNightPolicy, type OccupancyPeriod } from '../inpatient/bed-night-policy.ts';

const policy: BedNightPolicy = { timezone: 'Africa/Nairobi', cutoffMinutes: 0, graceMinutes: 30, sameDayRule: 'ONE' };
const d = (s: string) => new Date(s);
const period = (id: number, start: string, end: string, rate = '100.00'): OccupancyPeriod => ({ id, startedAt: d(start), endedAt: d(end), dailyRateSnapshot: rate });
const calc = (p: BedNightPolicy, periods: OccupancyPeriod[]) => calculateBedNights(p, periods, periods[periods.length - 1].endedAt!);

describe('facility-configured cutoff bed-night calculations', () => {
  it('counts one and three cutoffs and uses the configured rate', () => {
    expect(calc(policy, [period(1, '2026-10-01T17:00:00Z', '2026-10-02T06:00:00Z')])).toMatchObject([{ date: '2026-10-02', rate: '100.00' }]);
    const nights = calc(policy, [period(1, '2026-10-01T17:00:00Z', '2026-10-04T06:00:00Z')]);
    expect(nights.map((n) => n.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect(nights.reduce((sum, n) => sum + Number(n.rate), 0)).toBe(300);
  });
  it('obeys the explicit same-day rule and discharge grace', () => {
    const same = [period(1, '2026-10-01T05:00:00Z', '2026-10-01T07:00:00Z')];
    expect(calc(policy, same)).toHaveLength(1);
    expect(calc({ ...policy, sameDayRule: 'ZERO' }, same)).toHaveLength(0);
    expect(calc(policy, [period(1, '2026-10-01T17:00:00Z', '2026-10-01T21:20:00Z')])).toHaveLength(0);
    expect(calc(policy, [period(1, '2026-10-01T17:00:00Z', '2026-10-01T21:31:00Z')])).toHaveLength(1);
  });
  it('assigns a cutoff to the bed occupied then, including transfers at the cutoff', () => {
    const nights = calc(policy, [
      period(1, '2026-10-01T17:00:00Z', '2026-10-02T21:00:00Z', '100.00'),
      period(2, '2026-10-02T21:00:00Z', '2026-10-04T06:00:00Z', '250.00'),
    ]);
    expect(nights.map(({ occupancyId, rate }) => [occupancyId, rate])).toEqual([[1, '100.00'], [2, '250.00'], [2, '250.00']]);
  });
  it('only reviews DST cutoffs that intersect the occupancy, not an earlier or later transition', () => {
    const gap = { ...policy, timezone: 'America/New_York', cutoffMinutes: 150, sameDayRule: 'ONE' as const };
    // 03:00–04:00 local: the nonexistent 02:30 was before the stay.
    expect(calc(gap, [period(1, '2026-03-08T07:00:00Z', '2026-03-08T08:00:00Z')])).toHaveLength(1);
    // 00:00–01:30 local: it was after the stay.
    expect(calc(gap, [period(1, '2026-03-08T05:00:00Z', '2026-03-08T06:30:00Z')])).toHaveLength(1);
    expect(() => calc(gap, [period(1, '2026-03-08T06:00:00Z', '2026-03-08T08:00:00Z')])).toThrow(/skipped or repeated/);
    const fold = { ...gap, cutoffMinutes: 90 };
    expect(calc(fold, [period(1, '2026-11-01T08:00:00Z', '2026-11-01T09:00:00Z')])).toHaveLength(1);
    expect(() => calc(fold, [period(1, '2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z')])).toThrow(/skipped or repeated/);
  });
  it('never guesses overlapping/gapped histories or a DST-gap/fold cutoff', () => {
    expect(() => calc(policy, [period(1, '2026-10-01T17:00:00Z', '2026-10-02T05:00:00Z'), period(2, '2026-10-02T04:00:00Z', '2026-10-03T07:00:00Z')])).toThrow(/overlap/);
    expect(() => cutoffInstant('2026-03-08', 150, 'America/New_York')).toThrow(/skipped or repeated/);
    expect(() => cutoffInstant('2026-11-01', 90, 'America/New_York')).toThrow(/skipped or repeated/);
  });
});
