/**
 * JaliCare HMIS
 * Reporting — revenue, occupancy and length of stay
 *
 * The figures in this module end up in front of management and, on a
 * bad day, an auditor. These tests pin the arithmetic:
 *
 *   1. Loose date parsing (the columns are text, written in several shapes).
 *   2. Whole-day stay lengths, including the same-day-discharge rule.
 *   3. Occupancy percentages, including the empty-ward and overflow cases.
 *   4. Histogram bucket boundaries, which must not overlap or leave gaps.
 *   5. Average/median/longest, including the even-count median.
 *   6. Bed-day occupancy per calendar day.
 *   7. Route, client and navigation wiring.
 *
 * Run with: npx tsx src/tests/reporting.test.ts
 */

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

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/* ============================================================
   1. DATE PARSING
   ============================================================ */

function testDateParsing(): void {
  const iso = parseLooseDate('2026-10-21');
  assert(iso !== null, 'date-only string parses');
  assertEqual(iso?.getFullYear(), 2026, 'date-only year');
  assertEqual(iso?.getMonth(), 9, 'date-only month is October');
  assertEqual(iso?.getDate(), 21, 'date-only day');

  /* 'YYYY-MM-DD HH:mm' is the format the admission form writes. */
  const withTime = parseLooseDate('2026-10-21 14:35');
  assert(withTime !== null, 'date-time with a space parses');
  assertEqual(withTime?.getHours(), 14, 'space-separated time is preserved');
  assertEqual(withTime?.getMinutes(), 35, 'minutes are preserved');

  const withSlashes = parseLooseDate('2026/10/21');
  assert(withSlashes !== null, 'slash-separated date parses');
  assertEqual(withSlashes?.getDate(), 21, 'slash date day');

  assertEqual(parseLooseDate(''), null, 'empty string is null');
  assertEqual(parseLooseDate(null), null, 'null is null');
  assertEqual(parseLooseDate(undefined), null, 'undefined is null');
  assertEqual(parseLooseDate('not a date'), null, 'garbage is null');
  assertEqual(parseLooseDate('   '), null, 'whitespace is null');

  /* A bad date must never surface as an Invalid Date object. */
  const invalid = parseLooseDate('2026-13-45');
  assert(invalid === null || !Number.isNaN(invalid.getTime()), 'never returns an Invalid Date');

  assertEqual(formatDateKey(new Date(2026, 0, 5)), '2026-01-05', 'date key pads month and day');
}

/* ============================================================
   2. STAY LENGTH
   ============================================================ */

function testStayLength(): void {
  const start = new Date(2026, 0, 1, 9, 0, 0);

  assertEqual(
    daysBetween(start, new Date(2026, 0, 1, 21, 0, 0)),
    0,
    'same-day stay is 0 whole days',
  );

  assertEqual(daysBetween(start, new Date(2026, 0, 2, 10, 0, 0)), 1, '25 hours is 1 day');

  assertEqual(daysBetween(start, new Date(2026, 0, 8, 9, 0, 0)), 7, 'exactly 7 days is 7');

  /* Clock skew or a future admission date must not produce negative days. */
  assertEqual(daysBetween(start, new Date(2025, 11, 30)), 0, 'a negative interval clamps to 0');

  assertEqual(roundDays(6.449), 6.4, 'roundDays truncates to one decimal');
  assertEqual(roundDays(6.46), 6.5, 'roundDays rounds up at the second decimal');
}

/* ============================================================
   3. CENTRAL TENDENCY
   ============================================================ */

function testStatistics(): void {
  assertEqual(mean([]), null, 'mean of nothing is null');
  assertEqual(median([]), null, 'median of nothing is null');

  assertEqual(mean([0, 2, 4, 9, 12, 21]), 8, 'mean of six stays');
  assertEqual(median([0, 2, 4, 9, 12, 21]), 6.5, 'even count takes the midpoint');
  assertEqual(median([9, 1, 5]), 5, 'odd count sorts before taking the middle');
  assertEqual(median([4, 1, 9, 2]), 3, 'even count averages the middle pair');

  const stats = summariseStays([0, 2, 4, 9, 12, 21]);
  assertEqual(stats.count, 6, 'summary counts the stays');
  assertEqual(stats.averageDays, 8, 'summary average');
  assertEqual(stats.medianDays, 6.5, 'summary median');
  assertEqual(stats.longestDays, 21, 'summary longest');

  const empty = summariseStays([]);
  assertEqual(empty.count, 0, 'empty summary counts zero');
  assertEqual(empty.averageDays, null, 'empty summary has no average');
  assertEqual(empty.longestDays, null, 'empty summary has no longest');
}

/* ============================================================
   4. OCCUPANCY
   ============================================================ */

function testOccupancy(): void {
  assertEqual(occupancyPercent(0, 0), 0, 'a ward with no beds is 0%, not NaN');
  assertEqual(occupancyPercent(6, 10), 60, 'six of ten beds');
  assertEqual(occupancyPercent(1, 3), 33.3, 'thirds round to one decimal');
  assertEqual(occupancyPercent(10, 10), 100, 'a full ward is 100%');
  assertEqual(occupancyPercent(12, 10), 100, 'overflow clamps to 100%');
  assertEqual(occupancyPercent(-2, 10), 0, 'negative occupancy clamps to 0%');
  assertEqual(occupancyPercent(3, 0), 0, 'zero capacity is 0%');
}

/* ============================================================
   5. HISTOGRAM BUCKETS
   ============================================================ */

function testBuckets(): void {
  /* Boundaries are inclusive and must not overlap. */
  assertEqual(bucketIndexFor(0), 0, '0 days is "Under 1 day"');
  assertEqual(bucketIndexFor(1), 1, '1 day is "1–3 days"');
  assertEqual(bucketIndexFor(3), 1, '3 days is still "1–3 days"');
  assertEqual(bucketIndexFor(4), 2, '4 days moves to "4–7 days"');
  assertEqual(bucketIndexFor(7), 2, '7 days is still "4–7 days"');
  assertEqual(bucketIndexFor(8), 3, '8 days moves to "8–14 days"');
  assertEqual(bucketIndexFor(14), 3, '14 days is still "8–14 days"');
  assertEqual(bucketIndexFor(15), 4, '15 days moves to "15+ days"');
  assertEqual(bucketIndexFor(400), 4, '15+ is unbounded');
  assertEqual(bucketIndexFor(-3), 0, 'negative clamps to the first bucket');

  /* Every integer 0..120 lands in exactly one bucket. */
  for (let days = 0; days <= 120; days += 1) {
    const index = bucketIndexFor(days);
    assert(index >= 0 && index < STAY_BUCKETS.length, `${days} days falls inside the histogram`);
  }

  const buckets = bucketStays([0, 0, 2, 4, 9, 12, 21]);
  assertEqual(buckets.length, 5, 'five buckets are returned');
  assertEqual(buckets[0].count, 2, 'two same-day stays');
  assertEqual(buckets[1].count, 1, 'one 1–3 day stay');
  assertEqual(buckets[2].count, 1, 'one 4–7 day stay');
  assertEqual(buckets[3].count, 2, 'two 8–14 day stays');
  assertEqual(buckets[4].count, 1, 'one 15+ day stay');

  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  assertEqual(total, 7, 'every stay is counted exactly once');
}

/* ============================================================
   6. OVERSTAY
   ============================================================ */

function testOverstay(): void {
  assertEqual(OVERSTAY_DAYS, 7, 'a stay is a review item at 7 days');
  assertEqual(countOverstays([0, 6, 7, 8, 21]), 3, '7 and above are overstays');
  assertEqual(countOverstays([]), 0, 'no stays means no overstays');
}

/* ============================================================
   7. BED-DAY OCCUPANCY
   ============================================================ */

function testBedDay(): void {
  const day = new Date(2026, 9, 21, 0, 0, 0);

  assert(occupiesBedOn(new Date(2026, 9, 21, 9, 0), null, day), 'admitted on the day occupies it');

  assert(
    !occupiesBedOn(new Date(2026, 9, 22, 9, 0), null, day),
    'admitted tomorrow does not occupy today',
  );

  assert(
    occupiesBedOn(new Date(2026, 9, 15, 9, 0), new Date(2026, 9, 21, 8, 0), day),
    'discharged on the day still occupies it',
  );

  assert(
    !occupiesBedOn(new Date(2026, 9, 15, 9, 0), new Date(2026, 9, 20, 18, 0), day),
    'discharged the day before frees the bed',
  );

  assert(
    occupiesBedOn(new Date(2026, 9, 21, 8, 0), new Date(2026, 9, 21, 12, 0), day),
    'a same-day admission and discharge still occupies one bed-day',
  );

  /* A stay spanning the whole window occupies every day in it. */
  const admitted = new Date(2026, 9, 1, 8, 0);
  let occupiedDays = 0;

  for (let offset = 0; offset < 21; offset += 1) {
    const probe = new Date(2026, 9, 1 + offset, 0, 0, 0);
    if (occupiesBedOn(admitted, null, probe)) occupiedDays += 1;
  }

  assertEqual(occupiedDays, 21, 'a continuing stay occupies each day in the window');
}

/* ============================================================
   8. WIRING
   ============================================================ */

function testRouteWiring(): void {
  const app = readRepoFile('src/app.ts');

  assert(
    app.includes("app.use('/api/reporting', requireFacilityModule('analytics'))"),
    'reporting routes are gated by the analytics facility module',
  );

  for (const route of [
    '/api/reporting/operations',
    '/api/reporting/occupancy-trend',
    '/api/analytics/revenue',
  ]) {
    const index = app.indexOf(`'${route}'`);
    assert(index > -1, `${route} is registered`);

    const window = app.slice(index, index + 300);
    assert(window.includes("requirePermission('reports.read')"), `${route} requires reports.read`);
    assert(window.includes('requireAuthContext'), `${route} resolves the auth context`);
  }

  /* The revenue route must reject a malformed or inverted range. */
  const revenueIndex = app.indexOf("'/api/analytics/revenue'");
  const revenueBody = app.slice(revenueIndex, revenueIndex + 3200);

  assert(
    revenueBody.includes('INVALID_DATE_RANGE'),
    'the revenue route rejects a malformed date range',
  );
  assert(
    revenueBody.includes('from must not be after to'),
    'the revenue route rejects an inverted date range',
  );
  assert(
    revenueBody.includes('getRevenueTotals'),
    'the revenue route returns cash totals, not only service lines',
  );
}

function testUiWiring(): void {
  const client = readRepoFile('src/api/client.ts');

  assert(client.includes('getOperationsReport'), 'client exposes the operations report');
  assert(client.includes('getOccupancyTrend'), 'client exposes the occupancy trend');
  assert(
    client.includes("params.set('from', range.from)"),
    'client sends the revenue period start',
  );

  const app = readRepoFile('src/App.tsx');
  assert(app.includes("case 'analytics':"), 'App routes the analytics module');
  assert(app.includes('<ReportsModule />'), 'App mounts the reports module');

  const sidebar = readRepoFile('src/components/Sidebar.tsx');
  assert(sidebar.includes("id: 'analytics'"), 'sidebar lists Reports & Revenue');
  assert(sidebar.includes("analytics: ['reports.read']"), 'sidebar gates reports on reports.read');

  const header = readRepoFile('src/components/Header.tsx');
  assert(header.includes("'Reports, Revenue & Bed Utilisation'"), 'header titles the module');

  const module = readRepoFile('src/components/modules/ReportsModule.tsx');

  for (const section of [
    'Revenue by Service',
    'Ward Occupancy',
    'Length of Stay Distribution',
    'Longest Current Stays',
  ]) {
    assert(module.includes(section), `reports screen renders "${section}"`);
  }

  assert(module.includes('PERIODS.map'), 'reports screen offers a revenue period selector');
  assert(
    !module.includes('parseFloat(') && !module.includes('Number(row.revenue) * 100'),
    'reports screen does not recompute money on the client',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('REPORTING TESTS');
  console.log('==============================================');

  testDateParsing();
  console.log('  1. Loose admission and discharge dates parse safely');

  testStayLength();
  console.log('  2. Stay lengths are whole days and never negative');

  testStatistics();
  console.log('  3. Mean, median and longest are correct');

  testOccupancy();
  console.log('  4. Occupancy is clamped and never NaN');

  testBuckets();
  console.log('  5. Histogram buckets are contiguous and exhaustive');

  testOverstay();
  console.log('  6. Overstay threshold is 7 days');

  testBedDay();
  console.log('  7. Bed-day occupancy matches the billing rule');

  testRouteWiring();
  console.log('  8. Reporting routes are guarded and range-validated');

  testUiWiring();
  console.log('  9. Reports screen, client and navigation are wired');

  console.log('');
  console.log('==============================================');
  console.log(`REPORTING TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('REPORTING TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
