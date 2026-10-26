import {
  daysBetween,
  formatDateKey,
  mean,
  median,
  parseLooseDate,
  roundDays,
} from '../utils/dates.ts';
import {
  OVERSTAY_DAYS,
  STAY_BUCKETS,
  bucketIndexFor,
  bucketStays,
  countOverstays,
  occupancyPercent,
  occupiesBedOn,
  summariseStays,
} from '../reporting/reporting-contracts.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Reporting — revenue, occupancy and length of stay', () => {
  it('1. DATE PARSING', async () => {
    const iso = parseLooseDate('2026-10-21');
    expect(iso !== null, 'date-only string parses').toBe(true);
    expect(iso?.getFullYear(), 'date-only year').toBe(2026);
    expect(iso?.getMonth(), 'date-only month is October').toBe(9);
    expect(iso?.getDate(), 'date-only day').toBe(21);

    /* 'YYYY-MM-DD HH:mm' is the format the admission form writes. */
    const withTime = parseLooseDate('2026-10-21 14:35');
    expect(withTime !== null, 'date-time with a space parses').toBe(true);
    expect(withTime?.getHours(), 'space-separated time is preserved').toBe(14);
    expect(withTime?.getMinutes(), 'minutes are preserved').toBe(35);

    const withSlashes = parseLooseDate('2026/10/21');
    expect(withSlashes !== null, 'slash-separated date parses').toBe(true);
    expect(withSlashes?.getDate(), 'slash date day').toBe(21);

    expect(parseLooseDate(''), 'empty string is null').toBe(null);
    expect(parseLooseDate(null), 'null is null').toBe(null);
    expect(parseLooseDate(undefined), 'undefined is null').toBe(null);
    expect(parseLooseDate('not a date'), 'garbage is null').toBe(null);
    expect(parseLooseDate('   '), 'whitespace is null').toBe(null);

    /* A bad date must never surface as an Invalid Date object. */
    const invalid = parseLooseDate('2026-13-45');
    expect(
      invalid === null || !Number.isNaN(invalid.getTime()),
      'never returns an Invalid Date',
    ).toBe(true);

    expect(formatDateKey(new Date(2026, 0, 5)), 'date key pads month and day').toBe('2026-01-05');
  });

  it('2. STAY LENGTH', async () => {
    const start = new Date(2026, 0, 1, 9, 0, 0);

    expect(
      daysBetween(start, new Date(2026, 0, 1, 21, 0, 0)),
      'same-day stay is 0 whole days',
    ).toBe(0);

    expect(daysBetween(start, new Date(2026, 0, 2, 10, 0, 0)), '25 hours is 1 day').toBe(1);

    expect(daysBetween(start, new Date(2026, 0, 8, 9, 0, 0)), 'exactly 7 days is 7').toBe(7);

    /* Clock skew or a future admission date must not produce negative days. */
    expect(daysBetween(start, new Date(2025, 11, 30)), 'a negative interval clamps to 0').toBe(0);

    expect(roundDays(6.449), 'roundDays truncates to one decimal').toBe(6.4);
    expect(roundDays(6.46), 'roundDays rounds up at the second decimal').toBe(6.5);
  });

  it('3. CENTRAL TENDENCY', async () => {
    expect(mean([]), 'mean of nothing is null').toBe(null);
    expect(median([]), 'median of nothing is null').toBe(null);

    expect(mean([0, 2, 4, 9, 12, 21]), 'mean of six stays').toBe(8);
    expect(median([0, 2, 4, 9, 12, 21]), 'even count takes the midpoint').toBe(6.5);
    expect(median([9, 1, 5]), 'odd count sorts before taking the middle').toBe(5);
    expect(median([4, 1, 9, 2]), 'even count averages the middle pair').toBe(3);

    const stats = summariseStays([0, 2, 4, 9, 12, 21]);
    expect(stats.count, 'summary counts the stays').toBe(6);
    expect(stats.averageDays, 'summary average').toBe(8);
    expect(stats.medianDays, 'summary median').toBe(6.5);
    expect(stats.longestDays, 'summary longest').toBe(21);

    const empty = summariseStays([]);
    expect(empty.count, 'empty summary counts zero').toBe(0);
    expect(empty.averageDays, 'empty summary has no average').toBe(null);
    expect(empty.longestDays, 'empty summary has no longest').toBe(null);
  });

  it('4. OCCUPANCY', async () => {
    expect(occupancyPercent(0, 0), 'a ward with no beds is 0%, not NaN').toBe(0);
    expect(occupancyPercent(6, 10), 'six of ten beds').toBe(60);
    expect(occupancyPercent(1, 3), 'thirds round to one decimal').toBe(33.3);
    expect(occupancyPercent(10, 10), 'a full ward is 100%').toBe(100);
    expect(occupancyPercent(12, 10), 'overflow clamps to 100%').toBe(100);
    expect(occupancyPercent(-2, 10), 'negative occupancy clamps to 0%').toBe(0);
    expect(occupancyPercent(3, 0), 'zero capacity is 0%').toBe(0);
  });

  it('5. HISTOGRAM BUCKETS', async () => {
    /* Boundaries are inclusive and must not overlap. */
    expect(bucketIndexFor(0), '0 days is "Under 1 day"').toBe(0);
    expect(bucketIndexFor(1), '1 day is "1–3 days"').toBe(1);
    expect(bucketIndexFor(3), '3 days is still "1–3 days"').toBe(1);
    expect(bucketIndexFor(4), '4 days moves to "4–7 days"').toBe(2);
    expect(bucketIndexFor(7), '7 days is still "4–7 days"').toBe(2);
    expect(bucketIndexFor(8), '8 days moves to "8–14 days"').toBe(3);
    expect(bucketIndexFor(14), '14 days is still "8–14 days"').toBe(3);
    expect(bucketIndexFor(15), '15 days moves to "15+ days"').toBe(4);
    expect(bucketIndexFor(400), '15+ is unbounded').toBe(4);
    expect(bucketIndexFor(-3), 'negative clamps to the first bucket').toBe(0);

    /* Every integer 0..120 lands in exactly one bucket. */
    for (let days = 0; days <= 120; days += 1) {
      const index = bucketIndexFor(days);
      expect(
        index >= 0 && index < STAY_BUCKETS.length,
        `${days} days falls inside the histogram`,
      ).toBe(true);
    }

    const buckets = bucketStays([0, 0, 2, 4, 9, 12, 21]);
    expect(buckets.length, 'five buckets are returned').toBe(5);
    expect(buckets[0].count, 'two same-day stays').toBe(2);
    expect(buckets[1].count, 'one 1–3 day stay').toBe(1);
    expect(buckets[2].count, 'one 4–7 day stay').toBe(1);
    expect(buckets[3].count, 'two 8–14 day stays').toBe(2);
    expect(buckets[4].count, 'one 15+ day stay').toBe(1);

    const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total, 'every stay is counted exactly once').toBe(7);
  });

  it('6. OVERSTAY', async () => {
    expect(OVERSTAY_DAYS, 'a stay is a review item at 7 days').toBe(7);
    expect(countOverstays([0, 6, 7, 8, 21]), '7 and above are overstays').toBe(3);
    expect(countOverstays([]), 'no stays means no overstays').toBe(0);
  });

  it('7. BED-DAY OCCUPANCY', async () => {
    const day = new Date(2026, 9, 21, 0, 0, 0);

    expect(
      occupiesBedOn(new Date(2026, 9, 21, 9, 0), null, day),
      'admitted on the day occupies it',
    ).toBe(true);

    expect(
      !occupiesBedOn(new Date(2026, 9, 22, 9, 0), null, day),
      'admitted tomorrow does not occupy today',
    ).toBe(true);

    expect(
      occupiesBedOn(new Date(2026, 9, 15, 9, 0), new Date(2026, 9, 21, 8, 0), day),
      'discharged on the day still occupies it',
    ).toBe(true);

    expect(
      !occupiesBedOn(new Date(2026, 9, 15, 9, 0), new Date(2026, 9, 20, 18, 0), day),
      'discharged the day before frees the bed',
    ).toBe(true);

    expect(
      occupiesBedOn(new Date(2026, 9, 21, 8, 0), new Date(2026, 9, 21, 12, 0), day),
      'a same-day admission and discharge still occupies one bed-day',
    ).toBe(true);

    /* A stay spanning the whole window occupies every day in it. */
    const admitted = new Date(2026, 9, 1, 8, 0);
    let occupiedDays = 0;

    for (let offset = 0; offset < 21; offset += 1) {
      const probe = new Date(2026, 9, 1 + offset, 0, 0, 0);
      if (occupiesBedOn(admitted, null, probe)) occupiedDays += 1;
    }

    expect(occupiedDays, 'a continuing stay occupies each day in the window').toBe(21);
  });

  it('8. WIRING', async () => {
    const app = readRepoFile('src/app.ts');
    const wiring = readRepoFile('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

    expect(
      wiring.includes("api.use('/reporting', requireFacilityModule('analytics'))"),
      'reporting routes are gated by the analytics facility module',
    ).toBe(true);

    for (const route of [
      '/api/reporting/operations',
      '/api/reporting/occupancy-trend',
      '/api/analytics/revenue',
    ]) {
      const index = app.indexOf(`'${route}'`);
      expect(index > -1, `${route} is registered`).toBe(true);

      const window = app.slice(index, index + 300);
      expect(
        window.includes("requirePermission('reports.read')"),
        `${route} requires reports.read`,
      ).toBe(true);
      expect(window.includes('requireAuthContext'), `${route} resolves the auth context`).toBe(
        true,
      );
    }

    /* The revenue route must reject a malformed or inverted range. */
    const revenueIndex = app.indexOf("'/api/analytics/revenue'");
    const revenueBody = app.slice(revenueIndex, revenueIndex + 3200);

    expect(
      revenueBody.includes('INVALID_DATE_RANGE'),
      'the revenue route rejects a malformed date range',
    ).toBe(true);
    expect(
      revenueBody.includes('from must not be after to'),
      'the revenue route rejects an inverted date range',
    ).toBe(true);
    expect(
      revenueBody.includes('getRevenueTotals'),
      'the revenue route returns cash totals, not only service lines',
    ).toBe(true);
  });

  it('Ui Wiring', async () => {
    const client = readRepoFile('src/api/client.ts');

    expect(client.includes('getOperationsReport'), 'client exposes the operations report').toBe(
      true,
    );
    expect(client.includes('getOccupancyTrend'), 'client exposes the occupancy trend').toBe(true);
    expect(
      client.includes("params.set('from', range.from)"),
      'client sends the revenue period start',
    ).toBe(true);

    const app = readRepoFile('src/App.tsx');
    expect(app.includes("case 'analytics':"), 'App routes the analytics module').toBe(true);
    expect(app.includes('<ReportsModule />'), 'App mounts the reports module').toBe(true);

    const sidebar = readRepoFile('src/components/Sidebar.tsx');
    expect(sidebar.includes("id: 'analytics'"), 'sidebar lists Reports & Revenue').toBe(true);
    expect(
      sidebar.includes("analytics: ['reports.read']"),
      'sidebar gates reports on reports.read',
    ).toBe(true);

    const header = readRepoFile('src/components/Header.tsx');
    expect(
      header.includes("'Reports, Revenue & Bed Utilisation'"),
      'header titles the module',
    ).toBe(true);

    const module = readRepoFile('src/components/modules/ReportsModule.tsx');

    for (const section of [
      'Revenue by Service',
      'Ward Occupancy',
      'Length of Stay Distribution',
      'Longest Current Stays',
    ]) {
      expect(module.includes(section), `reports screen renders "${section}"`).toBe(true);
    }

    expect(module.includes('PERIODS.map'), 'reports screen offers a revenue period selector').toBe(
      true,
    );
    expect(
      !module.includes('parseFloat(') && !module.includes('Number(row.revenue) * 100'),
      'reports screen does not recompute money on the client',
    ).toBe(true);
  });
});
