/**
 * JaliCare HMIS
 * Maternity / MCH tests
 *
 * The rules that matter here are the ones a clinician would notice if
 * they broke:
 *
 *   - a date that does not exist is not a date;
 *   - the EDD is arithmetic from the LMP, and the gestation on a given
 *     day is measured from the EDD;
 *   - an absent measurement is absent, not zero;
 *   - the partograph reports where the plot sits, and nothing more;
 *   - the migration creates tables and seeds nothing;
 *   - the screen does not ship a sample patient.
 *
 * Run with: npx tsx src/tests/maternity.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GESTATION_DAYS,
  addDays,
  daysBetween,
  deriveEdd,
  gestationAt,
  isIsoDate,
  numberInRange,
  oneOf,
  partographGuidance,
  BABY_OUTCOMES,
  DELIVERY_MODES,
  LIQUORS,
  PREGNANCY_STATUSES,
} from '../maternity/maternity-contracts.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) throw new Error(`FAILED: ${label}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/* ============================================================
   1. DATES
   ============================================================ */

function testDates(): void {
  assert(isIsoDate('2026-10-08'), 'a real date is accepted');
  assert(!isIsoDate('2026-02-30'), '30 February is refused');
  assert(!isIsoDate('2026-13-01'), 'month 13 is refused');
  assert(!isIsoDate('08/10/2026'), 'a local date format is refused');
  assert(!isIsoDate(20261008), 'a number is not a date');
  assert(!isIsoDate('2026-1-8'), 'unpadded parts are refused');

  assertEqual(addDays('2026-01-01', 280), '2026-10-08', 'LMP + 280 days');
  assertEqual(addDays('2026-03-01', -1), '2026-02-28', 'the day before 1 March');
  assertEqual(addDays('2024-02-28', 1), '2024-02-29', '29 February exists in a leap year');
  assertEqual(daysBetween('2026-01-01', '2026-10-08'), 280, '280 days elapse');
  assertEqual(daysBetween('2026-10-08', '2026-01-01'), -280, 'and the reverse is negative');

  assertEqual(deriveEdd('2026-01-01'), '2026-10-08', 'Naegele: LMP + 280 days');
  assertEqual(GESTATION_DAYS, 280, 'the convention is 40 weeks');

  const atEdd = gestationAt('2026-10-08', '2026-10-08');
  assertEqual(atEdd?.weeks, 40, 'the EDD is 40 weeks');
  assertEqual(atEdd?.days, 0, 'and zero days');

  const early = gestationAt('2026-10-08', '2026-04-01');
  assertEqual(early?.totalDays, 90, 'ninety days before term is 90 days of gestation');
  assertEqual(early?.weeks, 12, 'which is 12 weeks');
  assertEqual(early?.days, 6, 'and six days');

  assertEqual(
    gestationAt('2026-10-08', '2024-01-01'),
    null,
    'a date two years early is refused rather than reported as negative',
  );
  assertEqual(
    gestationAt('not-a-date', '2026-04-01'),
    null,
    'an invalid EDD produces nothing',
  );
}

/* ============================================================
   2. VALIDATION
   ============================================================ */

function testValidation(): void {
  assertEqual(numberInRange(undefined, 'x', 0, 10).value, null, 'absent stays absent');
  assertEqual(numberInRange('', 'x', 0, 10).value, null, 'an empty string stays absent');
  assertEqual(numberInRange(0, 'x', 0, 10).value, 0, 'zero is a value, not an absence');
  assertEqual(numberInRange('7', 'x', 0, 10).value, 7, 'a numeric string parses');
  assert(numberInRange(11, 'x', 0, 10).error !== undefined, 'out of range is refused');
  assert(numberInRange('abc', 'x', 0, 10).error !== undefined, 'text is refused');
  assertEqual(numberInRange(-4, 'station', -3, 3).value, null, 'below the range');
  assertEqual(numberInRange(-3, 'station', -3, 3).value, -3, 'a negative value is allowed where the range allows it');

  assertEqual(oneOf('Intact', 'membranes', ['Intact', 'Ruptured'] as const).value, 'Intact', 'a listed value passes');
  assertEqual(oneOf('', 'membranes', ['Intact', 'Ruptured'] as const).value, null, 'an empty choice is absent');
  assert(oneOf('Torn', 'membranes', ['Intact', 'Ruptured'] as const).error !== undefined, 'an unlisted value is refused');
  assert(oneOf(5, 'membranes', ['Intact'] as const).error !== undefined, 'a non-string is refused');
}

/* ============================================================
   3. PARTOGRAPH
   ============================================================ */

function testPartograph(): void {
  const tooFew = partographGuidance([
    { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 5 },
  ]);
  assertEqual(tooFew.zone, 'Too few readings', 'one point is not a curve');
  assertEqual(tooFew.dilatationCm, 5, 'the latest value is still reported');

  const onLine = partographGuidance([
    { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
    { recordedAt: '2026-10-08T12:00:00Z', cervicalDilatationCm: 8 },
  ]);
  assertEqual(onLine.zone, 'On or left of the alert line', '1 cm/hour is on the line');
  assertEqual(onLine.hoursSinceFourCm, 4, 'four hours since 4 cm');
  assertEqual(onLine.hoursBeyondAlert, 0, 'and no hours beyond it');

  const behind = partographGuidance([
    { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
    { recordedAt: '2026-10-08T12:00:00Z', cervicalDilatationCm: 6 },
  ]);
  assertEqual(behind.zone, 'Between the alert and action lines', 'two hours behind is between the lines');
  assertEqual(behind.hoursBeyondAlert, 2, 'two hours beyond the alert line');

  const farBehind = partographGuidance([
    { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
    { recordedAt: '2026-10-08T14:00:00Z', cervicalDilatationCm: 5 },
  ]);
  assertEqual(farBehind.zone, 'Right of the action line', 'five hours behind is past the action line');
  assertEqual(farBehind.hoursBeyondAlert, 5, 'five hours beyond the alert line');

  const unsorted = partographGuidance([
    { recordedAt: '2026-10-08T12:00:00Z', cervicalDilatationCm: 8 },
    { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
  ]);
  assertEqual(unsorted.zone, 'On or left of the alert line', 'readings are sorted before plotting');

  assert(
    tooFew.note.includes('plotting aid'),
    'the guidance says what it is and is not',
  );
  assert(
    !partographGuidance([]).zone.includes('emergency'),
    'the module never raises an emergency of its own',
  );
}

/* ============================================================
   4. MIGRATION
   ============================================================ */

function testMigration(): void {
  const sql = read('drizzle/0015_maternity_mch.sql');

  for (const table of [
    'maternity_pregnancies',
    'anc_visits',
    'labour_records',
    'partograph_entries',
    'deliveries',
    'delivery_babies',
  ]) {
    assert(
      sql.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      `${table} is created with IF NOT EXISTS`,
    );
  }

  assert(!/\bDROP\b/i.test(sql), 'the migration drops nothing');
  assert(!/\bTRUNCATE\b/i.test(sql), 'the migration truncates nothing');
  assert(!/\bDELETE\b/i.test(sql), 'the migration deletes nothing');
  assert(!/\bINSERT\b/i.test(sql), 'the migration seeds no rows');
  assert(!/\bALTER TABLE\b/i.test(sql), 'the migration alters no existing table');
  assert(
    sql.includes('maternity_pregnancies_one_active_idx'),
    'one active pregnancy per patient is enforced by the database',
  );
  assert(
    sql.includes('partograph_entries_labour_time_idx'),
    'duplicate partograph timestamps are refused by the database',
  );
  assert(
    sql.includes("WHERE \"status\" = 'Active'"),
    'the partial index only constrains active pregnancies',
  );

  const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  const last = journal.entries.at(-1);
  assertEqual(last?.tag, '0015_maternity_mch', 'the journal ends with this migration');
  assertEqual(last?.idx, 15, 'and its index follows 0014');
}

/* ============================================================
   5. NO INVENTED CLINICAL VALUES
   ============================================================ */

function testSchemaHonesty(): void {
  const schema = read('src/db/schema.ts');

  const start = schema.indexOf("export const maternityPregnancies");
  const end = schema.indexOf('/* ============================================================\n   45. RELATIONS');
  const block = schema.slice(start, end);

  assert(start > -1 && end > start, 'the maternity tables can be isolated');

  /*
   * A default on a measurement is a fabricated reading: every row would
   * carry a number nobody took. Status and the IFAS/oxytocin booleans are
   * allowed defaults because they are workflow flags, not measurements.
   */
  for (const column of [
    'bp_systolic',
    'bp_diastolic',
    'pulse_bpm',
    'temperature_c',
    'fundal_height_cm',
    'fetal_heart_rate_bpm',
    'cervical_dilatation_cm',
    'descent_station',
    'contractions_per_10_min',
    'contraction_duration_sec',
    'birth_weight_grams',
    'apgar1',
    'apgar5',
    'apgar10',
    'blood_loss_ml',
    'haemoglobin_gdl',
  ]) {
    const literal = schema.indexOf(`'${column}'`);

    assert(literal > -1, `${column} exists in the schema`);

    const lineEnd = block.indexOf('\n', block.indexOf(`'${column}'`, start - start));

    void lineEnd;

    /* Look ahead two lines for a default; a measurement must not have one. */
    const nearby = block.slice(
      Math.max(0, block.indexOf(`'${column}'`) - 80),
      block.indexOf(`'${column}'`) + 200,
    );

    assert(
      !new RegExp(`'${column}'[^\\n]*\\.default\\(`).test(nearby),
      `${column} carries no default value`,
    );
  }
}

/* ============================================================
   6. WIRING
   ============================================================ */

function testWiring(): void {
  const app = read('src/app.ts');

  assert(
    app.includes("app.use('/api/maternity', requireFacilityModule('maternity'))"),
    'the module gate is mounted',
  );

  const routes = [
    ['/api/maternity/summary', 'maternity.read'],
    ['/api/maternity/pregnancies', 'maternity.read'],
    ['/api/maternity/anc-visits', 'maternity.create'],
    ['/api/maternity/labours', 'maternity.read'],
    ['/api/maternity/partograph', 'maternity.create'],
    ['/api/maternity/deliveries', 'maternity.read'],
  ] as const;

  for (const [route, permission] of routes) {
    const index = app.indexOf(route);

    assert(index > -1, `${route} exists`);

    const nearby = app.slice(index, index + 400);

    assert(
      nearby.includes(`requirePermission('${permission}')`),
      `${route} is guarded by ${permission}`,
    );
  }

  assert(
    app.indexOf("app.post(\n    '/api/maternity/deliveries'") >
      app.indexOf("app.get(\n    '/api/maternity/deliveries'"),
    'the delivery POST is registered separately from the GET',
  );

  const deliveryIndex = app.indexOf("'/api/maternity/deliveries',", app.indexOf('app.post('));
  void deliveryIndex;

  const server = read('src/maternity/maternity.service.ts');

  assert(
    server.includes('maternity.read') === false &&
      server.includes('requirePermission') === false,
    'the service does not make permission decisions',
  );

  assert(
    server.includes('notFound(\'The pregnancy record\')'),
    'a pregnancy outside scope answers as not found',
  );

  assert(
    server.includes('ONE ACTIVE') === false,
    'nothing claims a constraint it does not have',
  );

  /*
   * Drizzle wraps driver errors, so the SQLSTATE lives on `cause`. A
   * check of `error.code` alone turned every unique violation into a 500
   * — caught by the live test against PostgreSQL, asserted here so it
   * cannot come back.
   */
  assert(
    server.includes('function pgErrorCode'),
    'Postgres error codes are read through the wrapper',
  );

  assert(
    server.includes('.cause?.code'),
    'the wrapped cause is inspected',
  );

  assert(
    (server.match(/\.catch\(\(\) => null\)/g) ?? []).length >= 3,
    'every facility lookup converts a scope denial into not-found',
  );
}

/* ============================================================
   7. PERMISSIONS
   ============================================================ */

function testPermissions(): void {
  const seed = read('src/seeds/permissions.ts');

  for (const code of ['maternity.read', 'maternity.create', 'maternity.update']) {
    assert(seed.includes(`code: '${code}'`), `${code} is in the permission seed`);
  }

  const catalogue = read('src/auth/staff-role-catalogue.ts');

  assert(
    (catalogue.match(/'maternity\.read'/g) ?? []).length >= 3,
    'at least three staff roles can read maternity records',
  );

  assert(
    catalogue.includes("'maternity.create', 'maternity.update'"),
    'the roles that record care hold the write permissions',
  );
}

/* ============================================================
   8. THE SCREEN
   ============================================================ */

function testScreen(): void {
  const ui = read('src/components/modules/MaternityModule.tsx');

  assert(!ui.includes('142 bpm'), 'no sample fetal heart rate is shipped');
  assert(!ui.includes('G2 P1'), 'no sample obstetric history is shipped');
  assert(
    !/value=\{\d+\}/.test(ui),
    'no input is pre-filled with a literal number',
  );

  assert(
    /placeholder="Cephalic"/.test(ui),
    'a placeholder is a hint, not a stored value',
  );

  assert(
    ui.includes('Number.isFinite(parsed) ? parsed : undefined'),
    'an empty field is sent as absent',
  );

  assert(
    ui.includes('gestation'),
    'the register shows gestation computed by the server',
  );

  const specialty = read('src/components/modules/SpecialtyModule.tsx');

  assert(
    !specialty.includes("activeSpecialty === 'MCH'"),
    'the mock antenatal form is gone',
  );

  assert(
    !specialty.includes('142 bpm'),
    'and its invented observations are gone with it',
  );

  assert(DELIVERY_MODES.length === 6, 'six delivery modes are offered');
  assert(BABY_OUTCOMES.length === 4, 'four baby outcomes are offered');
  assert(LIQUORS.length === 6, 'six liquor grades are offered');
  assert(PREGNANCY_STATUSES.includes('Active'), 'a pregnancy starts active');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('MATERNITY TESTS');
  console.log('==============================================');

  testDates();
  console.log('  1. Dates and gestation are arithmetic, not guesses');

  testValidation();
  console.log('  2. Absent is not zero, and out-of-range is refused');

  testPartograph();
  console.log('  3. The partograph reports the plot and nothing more');

  testMigration();
  console.log('  4. The migration creates tables and seeds nothing');

  testSchemaHonesty();
  console.log('  5. No clinical measurement carries a default');

  testWiring();
  console.log('  6. Routes are gated and scoped');

  testPermissions();
  console.log('  7. The permission codes exist and reach the right roles');

  testScreen();
  console.log('  8. The screen ships no sample patient');

  console.log('');
  console.log('==============================================');
  console.log(`MATERNITY TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('MATERNITY TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
