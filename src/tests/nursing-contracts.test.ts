/**
 * JaliCare HMIS
 * Nursing UI — clinical flagging, shift, and wiring tests
 *
 * These tests execute the real nursing rule functions (no database needed)
 * and then assert the UI/route wiring that makes the ward board usable:
 *
 *   1. Vital-sign thresholds flag exactly at the documented boundaries.
 *   2. Critical flags sort ahead of warnings.
 *   3. A blank/absent observation produces no flags.
 *   4. Shift boundaries match the ward handover times.
 *   5. The board route is permission-guarded and module-guarded.
 *   6. The nursing panel is mounted and the dashboard reads the board.
 *
 * Run with: npx tsx src/tests/nursing-contracts.test.ts
 */

import {
  SHIFT_NAMES,
  VITALS_OVERDUE_HOURS,
  VITALS_REFERENCE,
  assessVitals,
  currentShift,
  dateKey,
  shiftForHour,
} from '../nursing/nursing-contracts.ts';

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
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/* ============================================================
   1. NORMAL RANGES PRODUCE NO FLAGS
   ============================================================ */

function testNormalVitalsAreQuiet(): void {
  const flags = assessVitals({
    systolicBp: 120,
    diastolicBp: 80,
    pulseRate: 76,
    temperatureC: '36.8',
    respiratoryRate: 16,
    spo2Percent: 98,
    bloodGlucoseMmol: '5.4',
  });

  assertEqual(flags.length, 0, 'normal adult vitals produce no flags');

  /* Explicit nulls and empty strings must not be treated as zero. */
  const empty = assessVitals({
    systolicBp: null,
    diastolicBp: null,
    pulseRate: null,
    temperatureC: '',
    respiratoryRate: null,
    spo2Percent: null,
    bloodGlucoseMmol: null,
  });

  assertEqual(empty.length, 0, 'missing values produce no flags');

  /* A blank observation object must not blow up. */
  assertEqual(assessVitals({}).length, 0, 'empty observation is safe');
}

/* ============================================================
   2. WARNING BOUNDARIES
   ============================================================ */

function testWarningBoundaries(): void {
  const warning = (payload: Parameters<typeof assessVitals>[0], field: string) => {
    const flags = assessVitals(payload);
    const match = flags.find((flag) => flag.field === field);

    assert(Boolean(match), `expected a flag on ${field}`);
    assertEqual(match?.severity, 'warning', `${field} severity is warning`);

    return match!;
  };

  /* One unit inside the range is normal; one unit outside is a warning. */
  assertEqual(
    assessVitals({ systolicBp: 140 }).length,
    0,
    'systolic 140 (upper bound) is normal',
  );
  const systolic = warning({ systolicBp: 141 }, 'systolicBp');
  assertEqual(systolic.direction, 'high', 'systolic 141 flags high');

  assertEqual(
    assessVitals({ pulseRate: 100 }).length,
    0,
    'pulse 100 (upper bound) is normal',
  );
  warning({ pulseRate: 101 }, 'pulseRate');
  warning({ pulseRate: 59 }, 'pulseRate');

  assertEqual(
    assessVitals({ spo2Percent: 94 }).length,
    0,
    'SpO2 94 (lower bound) is normal',
  );
  warning({ spo2Percent: 93 }, 'spo2Percent');

  /* Strings from Postgres numeric columns are parsed, not compared as text. */
  warning({ temperatureC: '38.2' }, 'temperatureC');
  warning({ bloodGlucoseMmol: '3.2' }, 'bloodGlucoseMmol');

  assertEqual(
    assessVitals({ temperatureC: '37.5' }).length,
    0,
    'temperature 37.5 (upper bound) is normal',
  );
}

/* ============================================================
   3. CRITICAL BOUNDARIES
   ============================================================ */

function testCriticalBoundaries(): void {
  const severityOf = (
    payload: Parameters<typeof assessVitals>[0],
    field: string,
  ) => assessVitals(payload).find((flag) => flag.field === field)?.severity;

  /*
   * Boundaries are inclusive: SpO2 <= 90, systolic <= 80 or >= 180,
   * pulse <= 45 or >= 130, temperature >= 39.5, RR >= 30,
   * glucose >= 20 or <= 2.8.
   */
  assertEqual(severityOf({ spo2Percent: 90 }, 'spo2Percent'), 'critical', 'SpO2 90 is critical');
  assertEqual(severityOf({ spo2Percent: 91 }, 'spo2Percent'), 'warning', 'SpO2 91 is warning');

  assertEqual(severityOf({ systolicBp: 80 }, 'systolicBp'), 'critical', 'systolic 80 is critical');
  assertEqual(severityOf({ systolicBp: 81 }, 'systolicBp'), 'warning', 'systolic 81 is warning');
  assertEqual(severityOf({ systolicBp: 180 }, 'systolicBp'), 'critical', 'systolic 180 is critical');
  assertEqual(severityOf({ systolicBp: 179 }, 'systolicBp'), 'warning', 'systolic 179 is warning');

  assertEqual(severityOf({ pulseRate: 45 }, 'pulseRate'), 'critical', 'pulse 45 is critical');
  assertEqual(severityOf({ pulseRate: 130 }, 'pulseRate'), 'critical', 'pulse 130 is critical');
  assertEqual(severityOf({ pulseRate: 46 }, 'pulseRate'), 'warning', 'pulse 46 is warning');
  assertEqual(severityOf({ pulseRate: 129 }, 'pulseRate'), 'warning', 'pulse 129 is warning');

  assertEqual(
    severityOf({ temperatureC: '39.5' }, 'temperatureC'),
    'critical',
    'temperature 39.5 is critical',
  );
  assertEqual(
    severityOf({ respiratoryRate: 30 }, 'respiratoryRate'),
    'critical',
    'respiratory rate 30 is critical',
  );
  assertEqual(
    severityOf({ bloodGlucoseMmol: '20' }, 'bloodGlucoseMmol'),
    'critical',
    'glucose 20 is critical',
  );
  assertEqual(
    severityOf({ bloodGlucoseMmol: '2.8' }, 'bloodGlucoseMmol'),
    'critical',
    'glucose 2.8 is critical',
  );

  /* Critical flags must come first so the ward badge shows the worst finding. */
  const ordered = assessVitals({
    pulseRate: 105, // warning
    spo2Percent: 88, // critical
    temperatureC: '38.5', // warning
  });

  assertEqual(ordered[0].severity, 'critical', 'critical flag sorts first');
  assertEqual(ordered[0].field, 'spo2Percent', 'most severe finding leads');
}

/* ============================================================
   4. SHIFT CONTRACT
   ============================================================ */

function testShiftContract(): void {
  assertEqual(SHIFT_NAMES.length, 3, 'three ward shifts are defined');
  assertEqual(SHIFT_NAMES[0], 'Morning', 'morning shift name');
  assertEqual(SHIFT_NAMES[1], 'Afternoon', 'afternoon shift name');
  assertEqual(SHIFT_NAMES[2], 'Night', 'night shift name');

  /* Morning 07:00–14:59 */
  assertEqual(shiftForHour(7), 'Morning', '07:00 is Morning');
  assertEqual(shiftForHour(14), 'Morning', '14:00 is Morning');

  /* Afternoon 15:00–19:59 */
  assertEqual(shiftForHour(15), 'Afternoon', '15:00 is Afternoon');
  assertEqual(shiftForHour(19), 'Afternoon', '19:00 is Afternoon');

  /* Night 20:00–06:59 */
  assertEqual(shiftForHour(20), 'Night', '20:00 is Night');
  assertEqual(shiftForHour(0), 'Night', '00:00 is Night');
  assertEqual(shiftForHour(6), 'Night', '06:00 is Night');

  /* currentShift must agree with the explicit hour mapping. */
  const probe = new Date(2026, 9, 21, 9, 30, 0);
  assertEqual(currentShift(probe), 'Morning', 'currentShift reads the clock hour');
  assertEqual(currentShift(new Date(2026, 9, 21, 23, 0, 0)), 'Night', 'currentShift at night');

  /* Overdue threshold is a single source of truth. */
  assertEqual(VITALS_OVERDUE_HOURS, 8, 'vitals become overdue after 8 hours');
}

/* ============================================================
   5. DATE KEY
   ============================================================ */

function testDateKey(): void {
  assertEqual(dateKey(new Date(2026, 0, 5, 13, 0, 0)), '2026-01-05', 'date key pads month and day');
  assertEqual(dateKey(new Date(2026, 11, 31, 23, 59, 0)), '2026-12-31', 'date key at year end');
  assertEqual(dateKey('not-a-date'), '', 'invalid date yields an empty key');

  /* Two notes in the same local day must land in the same handover date. */
  assertEqual(
    dateKey(new Date(2026, 9, 21, 0, 5, 0)),
    dateKey(new Date(2026, 9, 21, 23, 55, 0)),
    'same local day shares a handover date',
  );
}

/* ============================================================
   6. ROUTE & UI WIRING
   ============================================================ */

function testRouteWiring(): void {
  const app = readRepoFile('src/app.ts');

  /* Facility-module guards for ward care. */
  assert(
    app.includes("app.use('/api/inpatient', requireFacilityModule('inpatient'))"),
    'inpatient routes are module-guarded',
  );
  assert(
    app.includes("app.use('/api/nursing-notes', requireFacilityModule('inpatient'))"),
    'nursing note routes are module-guarded',
  );

  /* The three nursing endpoints the UI calls must exist and be permission-guarded. */
  for (const route of [
    '/api/inpatient/board',
    '/api/admissions/:id/vitals',
    '/api/nursing-notes/handover',
  ]) {
    const index = app.indexOf(route);
    assert(index > -1, `${route} is registered`);

    const window = app.slice(index, index + 400);
    assert(
      window.includes('requirePermission('),
      `${route} declares a permission guard`,
    );
    assert(
      window.includes('requireAuthContext'),
      `${route} resolves the auth context`,
    );
  }

  /* Unscoped observation writes are the hole this work closed. */
  const postIndex = app.indexOf("app.post(\n    '/api/observations'");
  assert(postIndex > -1, 'POST /api/observations still exists for OPD triage');

  const postBody = app.slice(postIndex, postIndex + 1600);
  assert(
    postBody.includes('admissionId') && postBody.includes('encounterId'),
    'observation writes require an admission or encounter',
  );
  assert(
    postBody.includes('recordObservationForEncounterScoped'),
    'OPD triage observations route through the scoped encounter path',
  );
}

function testUiWiring(): void {
  const inpatient = readRepoFile('src/components/modules/InpatientModule.tsx');
  assert(
    inpatient.includes("from './NursingPanel.tsx'"),
    'inpatient module imports the nursing panel',
  );
  assert(
    inpatient.includes('<NursingPanel'),
    'nursing panel is mounted on the ward screen',
  );
  assert(
    inpatient.includes('getInpatientBoard'),
    'ward screen loads the nursing board',
  );

  const dashboard = readRepoFile('src/components/modules/DashboardModule.tsx');
  assert(
    dashboard.includes('getInpatientBoard'),
    'dashboard reads the inpatient board',
  );
  /*
   * The redesign renamed the panel "Ward round"; the nursing columns
   * must still be rendered, so assert the table itself, not the old
   * heading alone.
   */
  assert(
    dashboard.includes('Ward round'),
    'dashboard renders the ward nursing section',
  );
  for (const column of ['Last vitals', 'Notes today', 'Ward / bed']) {
    assert(
      dashboard.includes(column),
      `dashboard ward table keeps the "${column}" column`,
    );
  }
  assert(
    dashboard.includes('vitalsOverdueCount'),
    'dashboard surfaces the vitals-overdue KPI',
  );

  const panel = readRepoFile('src/components/modules/NursingPanel.tsx');
  for (const tab of ['Vitals', 'Notes', 'Handover']) {
    assert(panel.includes(tab), `nursing panel has a ${tab} tab`);
  }
  assert(
    panel.includes('getShiftHandover'),
    'nursing panel reads the shift handover',
  );
  assert(
    panel.includes('recordWardVitals'),
    'nursing panel records ward vitals',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('NURSING CONTRACT TESTS');
  console.log('==============================================');

  testNormalVitalsAreQuiet();
  console.log('  1. Normal and missing vitals produce no flags');

  testWarningBoundaries();
  console.log('  2. Warning thresholds hold at their boundaries');

  testCriticalBoundaries();
  console.log('  3. Critical thresholds and ordering are correct');

  testShiftContract();
  console.log('  4. Shift handover times match 07-15 / 15-20 / 20-07');

  testDateKey();
  console.log('  5. Handover date keys group by local day');

  testRouteWiring();
  console.log('  6. Nursing routes are module- and permission-guarded');

  testUiWiring();
  console.log('  7. Ward screen and dashboard are wired to the board');

  /* Reference table must stay consistent with the boundaries above. */
  assertEqual(VITALS_REFERENCE.spo2Percent.min, 94, 'SpO2 reference minimum');

  console.log('');
  console.log('==============================================');
  console.log(`NURSING TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('NURSING TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
