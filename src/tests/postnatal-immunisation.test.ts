/**
 * JaliCare HMIS
 * Postnatal care, immunisation, the partograph plot and delivery billing
 *
 * The rules this file defends:
 *
 *   - a postnatal contact is the mother's, dated, and hangs off the
 *     pregnancy rather than the delivery;
 *   - the immunisation schedule lives in code, and a second dose of the
 *     same antigen is refused by the database, not by a screen;
 *   - the partograph chart plots the stored readings and the alert and
 *     action lines drawn from them — it extrapolates nothing;
 *   - a delivery raises a charge only through `chargeForService` with a
 *     real facility tariff, and never from a price the code invented;
 *   - every one of those things is reachable on the screen.
 *
 * Run with: npx tsx src/tests/postnatal-immunisation.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ANTIGENS,
  ANTIGEN_BY_CODE,
  SCHEDULE_AGREES_NOTE,
  ageInWeeks,
  immunisationStatus,
  outstandingDoses,
} from '../immunisation/immunisation-contracts.ts';

import { buildPartographPlot, partographGuidance } from '../maternity/maternity-contracts.ts';
import { schemaSource } from './support/schema-source.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) throw new Error(`FAILED: ${label}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const ADMITTED = '2026-10-21T08:00:00.000Z';

function at(hours: number): string {
  return new Date(Date.parse(ADMITTED) + hours * 3_600_000).toISOString();
}

/* ============================================================
   1. THE IMMUNISATION SCHEDULE
   ============================================================ */

function testSchedule(): void {
  assert(ANTIGENS.length >= 15, 'the reference schedule carries the KEPI antigens');

  const codes = new Set(ANTIGENS.map((antigen) => antigen.code));

  assertEqual(codes.size, ANTIGENS.length, 'every antigen code is unique');

  assert(
    ANTIGENS.every((antigen) => antigen.weeks >= 0),
    'no antigen is scheduled at a negative age',
  );

  assert(
    ANTIGENS.every((antigen) =>
      ['Intradermal', 'Subcutaneous', 'Intramuscular', 'Oral'].includes(antigen.route),
    ),
    'every antigen has a route a vaccinator would recognise',
  );

  assert(
    ANTIGENS.every((antigen) => antigen.doses >= 1),
    'every antigen has at least one dose',
  );

  assertEqual(ANTIGEN_BY_CODE.get('BCG')?.weeks, 0, 'BCG is given at birth');

  assertEqual(
    ANTIGEN_BY_CODE.get('PENTA-3')?.weeks,
    14,
    'the third pentavalent dose is scheduled at 14 weeks',
  );

  assertEqual(
    ANTIGEN_BY_CODE.get('MR-1')?.weeks,
    39,
    'measles-rubella 1 is scheduled at nine months',
  );

  assert(
    ANTIGEN_BY_CODE.get('NOT-AN-ANTIGEN') === undefined,
    'an unknown code is not in the schedule',
  );

  assert(
    SCHEDULE_AGREES_NOTE.toLowerCase().includes('kepi'),
    'the note names the chart the ages must be confirmed against',
  );

  assert(
    SCHEDULE_AGREES_NOTE.toLowerCase().includes('confirm'),
    'the note does not present the reference ages as authoritative',
  );
}

/* ============================================================
   2. AGE AND STATUS
   ============================================================ */

function testStatus(): void {
  assertEqual(ageInWeeks('2026-01-01', '2026-01-01'), 0, 'a newborn is zero weeks');
  assertEqual(ageInWeeks('2026-01-01', '2026-02-12'), 6, '42 days is six weeks');
  assertEqual(ageInWeeks('2026-01-01', '2026-02-11'), 5, '41 days is still five');
  assertEqual(ageInWeeks('2026-01-01', '2027-01-01'), 52, 'a year is 52 weeks');
  assert(
    Number.isNaN(ageInWeeks('not-a-date', '2026-01-01')),
    'an unparseable date of birth yields no age rather than zero',
  );

  const newborn = immunisationStatus('2026-01-01', '2026-01-01', []);
  const bcg = newborn.find((dose) => dose.antigenCode === 'BCG');

  assertEqual(bcg?.status, 'Due', 'BCG is due on the day of birth');
  assertEqual(bcg?.givenOn, null, 'an ungiven dose has no date');
  assertEqual(
    newborn.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
    'Not yet due',
    'a dose scheduled for six weeks is not due at birth',
  );

  const atSix = immunisationStatus('2026-01-01', '2026-02-12', []);

  assertEqual(
    atSix.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
    'Due',
    'pentavalent 1 is due at six weeks',
  );

  const atNine = immunisationStatus('2026-01-01', '2026-03-05', []);

  assertEqual(
    atNine.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
    'Due',
    'three weeks late is late, not overdue',
  );

  const atTen = immunisationStatus('2026-01-01', '2026-03-12', []);

  assertEqual(
    atTen.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
    'Overdue',
    'four weeks past the scheduled age is overdue',
  );

  const given = immunisationStatus('2026-01-01', '2026-02-12', [
    { antigenCode: 'BCG', administeredOn: '2026-01-01' },
  ]);

  assertEqual(
    given.find((dose) => dose.antigenCode === 'BCG')?.status,
    'Given',
    'a recorded dose is Given regardless of the schedule',
  );
  assertEqual(
    given.find((dose) => dose.antigenCode === 'BCG')?.givenOn,
    '2026-01-01',
    'and carries the date it was given',
  );

  /*
   * A dose recorded before its scheduled age is still a dose that was
   * given. The schedule is a recommendation; the record is a fact.
   */
  const early = immunisationStatus('2026-01-01', '2026-01-15', [
    { antigenCode: 'PENTA-1', administeredOn: '2026-01-15' },
  ]);

  assertEqual(
    early.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
    'Given',
    'an early dose is recorded, not hidden',
  );

  const unknown = immunisationStatus('2026-01-01', '2026-02-12', [
    { antigenCode: 'SMALLPOX', administeredOn: '2026-01-02' },
  ]);

  assertEqual(
    unknown.length,
    ANTIGENS.length,
    'a record for an antigen outside the schedule does not crash the card',
  );

  const outstanding = outstandingDoses(atTen);

  assert(outstanding.length > 0, 'a child at ten weeks has doses outstanding');

  assert(
    outstanding.every((dose) => dose.status === 'Due' || dose.status === 'Overdue'),
    'only due and overdue doses are outstanding',
  );

  assert(
    !outstanding.some((dose) => dose.antigenCode === 'MR-2'),
    'a dose scheduled for eighteen months is not outstanding at ten weeks',
  );
}

/* ============================================================
   3. THE PARTOGRAPH PLOT
   ============================================================ */

function testPlot(): void {
  const plot = buildPartographPlot(ADMITTED, [
    { recordedAt: at(0), cervicalDilatationCm: 3, fetalHeartRateBpm: 140 },
    { recordedAt: at(2), cervicalDilatationCm: 4, fetalHeartRateBpm: 138 },
    { recordedAt: at(4), cervicalDilatationCm: 6, fetalHeartRateBpm: 136 },
  ]);

  assertEqual(plot.readings.length, 3, 'every reading is plotted');
  assertEqual(plot.readings[0].hoursSinceAdmission, 0, 'the first reading is hour zero');
  assertEqual(plot.readings[1].hoursSinceAdmission, 2, 'the second is two hours in');
  assertEqual(plot.readings[2].hoursSinceAdmission, 4, 'the third is four hours in');

  assert(plot.alertLine !== null, 'an alert line exists once 4 cm is reached');
  assertEqual(plot.alertLine?.startHour, 2, 'it starts at the reading that reached 4 cm');
  assertEqual(plot.alertLine?.startCm, 4, 'at 4 cm');
  assertEqual(plot.alertLine?.endHour, 8, 'and climbs one centimetre an hour to 10 cm');
  assertEqual(plot.alertLine?.endCm, 10, 'reaching 10 cm');

  assert(plot.actionLine !== null, 'an action line exists with the alert line');
  assertEqual(plot.actionLine?.startHour, 6, 'it is the alert line four hours later');
  assertEqual(plot.actionLine?.endHour, 12, 'and ends four hours after the alert line');
  assertEqual(plot.actionLine?.startCm, 4, 'at the same height');
  assertEqual(plot.actionLine?.endCm, 10, 'and the same gradient');

  /*
   * The x axis must reach the end of the action line. A chart that crops
   * its own action line makes the line look as though it stopped.
   */
  assert(
    plot.maxHour >= (plot.actionLine?.endHour ?? 0),
    'the axis reaches the end of the action line',
  );
  assertEqual(plot.maxHour, 13, 'which is 12 plus one spare hour');

  const late = buildPartographPlot(ADMITTED, [{ recordedAt: at(5), cervicalDilatationCm: 4 }]);

  assertEqual(late.alertLine?.startHour, 5, 'a late start moves the alert line right');
  assertEqual(late.actionLine?.endHour, 15, 'and the action line with it');
  assertEqual(late.maxHour, 16, 'the axis still covers the whole action line');

  const empty = buildPartographPlot(ADMITTED, []);

  assertEqual(empty.readings.length, 0, 'no readings plot no points');
  assertEqual(empty.alertLine, null, 'and there is no alert line');
  assertEqual(empty.actionLine, null, 'and no action line');
  assertEqual(empty.maxHour, 12, 'the sheet still has a twelve-hour axis');
  assertEqual(empty.zone, 'Too few readings', 'and the zone says there is not enough to judge');

  const noDilatation = buildPartographPlot(ADMITTED, [
    { recordedAt: at(1), cervicalDilatationCm: null, fetalHeartRateBpm: 150 },
  ]);

  assertEqual(noDilatation.readings.length, 1, 'a reading with no dilatation is still a reading');
  assertEqual(noDilatation.alertLine, null, 'but it does not start an alert line');
  assertEqual(noDilatation.readings[0].fetalHeartRateBpm, 150, 'its other measurements survive');
  assertEqual(noDilatation.readings[0].dilatationCm, null, 'and the missing one stays missing');

  const unsorted = buildPartographPlot(ADMITTED, [
    { recordedAt: at(5), cervicalDilatationCm: 7 },
    { recordedAt: at(1), cervicalDilatationCm: 5 },
    { recordedAt: at(3), cervicalDilatationCm: 6 },
  ]);

  assertEqual(unsorted.readings[0].hoursSinceAdmission, 1, 'readings are ordered by time');
  assertEqual(unsorted.readings[2].hoursSinceAdmission, 5, 'even when they arrive out of order');

  const stringy = buildPartographPlot(ADMITTED, [
    { recordedAt: at(0), cervicalDilatationCm: '4' },
    { recordedAt: at(1), cervicalDilatationCm: '5' },
  ]);

  assertEqual(
    stringy.readings[0].dilatationCm,
    4,
    'a numeric column returned as text is plotted as a number',
  );

  const guidance = partographGuidance([
    { recordedAt: at(0), cervicalDilatationCm: 3 },
    { recordedAt: at(2), cervicalDilatationCm: 4 },
    { recordedAt: at(4), cervicalDilatationCm: 6 },
  ]);

  assertEqual(
    plot.zone,
    guidance.zone,
    'the plot reports the same zone the table reports — there is one calculation',
  );
  assertEqual(plot.note, guidance.note, 'and the same note');

  assert(
    plot.note.toLowerCase().includes('plotting aid'),
    'the note does not recommend an intervention',
  );

  /* Nothing is extrapolated past the last reading. */
  const stalled = buildPartographPlot(ADMITTED, [{ recordedAt: at(2), cervicalDilatationCm: 4 }]);

  assertEqual(
    stalled.readings.length,
    1,
    'a single reading produces a single point, not a projected line',
  );
}

/* ============================================================
   4. THE TABLES AND THE MIGRATION
   ============================================================ */

function testSchema(): void {
  const schema = schemaSource();

  assert(
    schema.includes("postnatalVisits = pgTable(\n  'postnatal_visits'"),
    'postnatal_visits is declared',
  );
  assert(
    schema.includes("immunisationRecords = pgTable(\n  'immunisation_records'"),
    'immunisation_records is declared',
  );
  assert(
    schema.includes("uniqueIndex('immunisation_records_dose_idx')"),
    'the double-administration guard is a unique index',
  );

  const postnatalStart = schema.indexOf('export const postnatalVisits');
  const postnatalEnd = schema.indexOf('export const immunisationRecords');
  const postnatalBlock = schema.slice(postnatalStart, postnatalEnd);

  assert(postnatalBlock.length > 1000, 'the postnatal table block was located');

  assert(!postnatalBlock.includes('.default('), 'no postnatal clinical column carries a default');

  assert(
    postnatalBlock.includes('.references(() => maternityPregnancies.id)'),
    'a postnatal visit hangs off the pregnancy',
  );

  assert(
    postnatalBlock.includes('dayPostpartum: integer'),
    'the day postpartum is stored, not recomputed on read',
  );

  assert(
    postnatalBlock.includes('babyWeightGrams: integer'),
    'the baby weight sits on the mother’s contact',
  );

  const immunisationBlock = schema.slice(
    schema.indexOf('export const immunisationRecords'),
    schema.indexOf('45. RELATIONS'),
  );

  assert(
    immunisationBlock.includes('default(1)'),
    'the dose number defaults to 1 — it is an index, not a measurement',
  );

  assert(immunisationBlock.includes('antigenCode: text'), 'the antigen is stored by code');

  assert(
    immunisationBlock.includes('administeredOn: text'),
    'the date the dose was given is stored',
  );

  /*
   * The schedule must not be a table. If a row in a table decided which
   * dose is due, last year's card would be re-read against this year's
   * schedule and change.
   */
  assert(
    !schema.includes("pgTable(\n  'immunisation_schedule'"),
    'the schedule is not a database table',
  );

  const sql = read('drizzle/0016_postnatal_immunisation.sql');

  assert(
    sql.includes('CREATE TABLE IF NOT EXISTS "postnatal_visits"'),
    'the migration creates postnatal_visits',
  );
  assert(
    sql.includes('CREATE TABLE IF NOT EXISTS "immunisation_records"'),
    'the migration creates immunisation_records',
  );
  assert(
    sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "immunisation_records_dose_idx"'),
    'the migration creates the unique dose index',
  );

  for (const destructive of ['DROP TABLE', 'DROP INDEX', 'TRUNCATE', 'ALTER TABLE', 'UPDATE ']) {
    assert(
      !sql.toUpperCase().includes(destructive),
      `the migration does not contain ${destructive.trim()}`,
    );
  }

  assert(!sql.toUpperCase().includes('INSERT INTO'), 'the migration seeds no clinical records');

  const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
    entries: Array<{ tag: string }>;
  };

  const tags = journal.entries.map((entry) => entry.tag);

  assert(tags.includes('0016_postnatal_immunisation'), 'the journal lists the migration');
  assertEqual(new Set(tags).size, tags.length, 'no migration tag appears twice in the journal');
}

/* ============================================================
   5. THE SERVICES REFUSE WHAT THEY SHOULD
   ============================================================ */

function testServices(): void {
  const postnatal = read('src/maternity/postnatal.service.ts');
  const immunisation = read('src/immunisation/immunisation.service.ts');

  assert(
    postnatal.includes('resolvePregnancy('),
    'a postnatal contact must resolve the pregnancy first',
  );

  assert(
    postnatal.includes('facilityId: pregnancy.facilityId'),
    'the visit is attributed to the pregnancy’s facility, not the request body',
  );

  assert(postnatal.includes('patientId: pregnancy.patientId'), 'and to the pregnancy’s patient');

  assert(
    postnatal.includes('DELIVERY_PREGNANCY_MISMATCH'),
    'a delivery from another pregnancy is refused',
  );

  assert(
    postnatal.includes('daysBetween('),
    'the day postpartum is counted from the recorded delivery date',
  );

  assert(!postnatal.includes('?? 0'), 'no postpartum measurement is defaulted to zero');

  assert(
    immunisation.includes("pgErrorCode(error) === '23505'"),
    'a duplicate dose is recognised from the unique violation',
  );

  assert(
    immunisation.includes("'DOSE_ALREADY_RECORDED'"),
    'and reported as a conflict rather than a 500',
  );

  assert(
    immunisation.includes('(error as { cause?: { code?: string } })?.cause?.code'),
    'the SQLSTATE is read from the wrapped driver error',
  );

  assert(immunisation.includes("'FUTURE_DATE'"), 'a dose cannot be dated in the future');

  assert(
    immunisation.includes("'BEFORE_BIRTH'"),
    'a dose cannot be dated before the child was born',
  );

  assert(immunisation.includes("'UNKNOWN_ANTIGEN'"), 'an antigen outside the schedule is refused');

  assert(
    immunisation.includes('statusCode = 400') || immunisation.includes('statusCode = 400'),
    'the domain error carries an HTTP status',
  );

  assert(
    !immunisation.includes('?? 0'),
    'the immunisation service invents no count or measurement',
  );

  assert(
    immunisation.includes('.catch(() => null)'),
    'a facility outside scope answers as not found rather than forbidden',
  );

  assert(
    !immunisation.includes('INSERT INTO') && !immunisation.includes('db.execute'),
    'the service writes through the schema, not raw SQL',
  );
}

/* ============================================================
   6. THE ROUTES
   ============================================================ */

function testRoutes(): void {
  const app = read('src/app.ts');

  assert(
    app.includes("app.use('/api/immunisation', requireFacilityModule('maternity'))"),
    'immunisation is gated on the MCH module like maternity',
  );

  /*
   * The routes moved out of createApp into src/routes/maternal-health.routes.ts,
   * mounted at '/api', so the paths below are relative and the handler is a
   * router rather than the app. Nothing else about these checks changed: the
   * route is still named, and the permission must still appear immediately
   * after it. The module gates above stay in app.ts because they are mounts,
   * not routes.
   */
  const routesSource = read('src/routes/maternal-health.routes.ts');

  const routes = [
    ["'/maternity/postnatal'", 'maternity.read'],
    ["'/maternity/pregnancies/:id/postnatal'", 'maternity.read'],
    ["'/immunisation/schedule'", 'maternity.read'],
    ["'/immunisation/card'", 'maternity.read'],
    ["'/immunisation/due'", 'maternity.read'],
  ] as const;

  for (const [route, permission] of routes) {
    const index = routesSource.indexOf(route);

    assert(index > -1, `GET ${route} exists`);

    assert(
      routesSource.slice(index, index + 300).includes(`requirePermission('${permission}')`),
      `GET ${route} is guarded by ${permission}`,
    );
  }

  const postnatalPost = routesSource.indexOf("router.post(\n  '/maternity/postnatal'");
  const immunisationPost = routesSource.indexOf("router.post(\n  '/immunisation/records'");

  assert(postnatalPost > -1, 'a postnatal contact can be written');
  assert(immunisationPost > -1, 'a dose can be written');

  assert(
    routesSource
      .slice(postnatalPost, postnatalPost + 200)
      .includes("requirePermission('maternity.create')"),
    'writing a postnatal contact needs maternity.create',
  );

  assert(
    routesSource
      .slice(immunisationPost, immunisationPost + 200)
      .includes("requirePermission('maternity.create')"),
    'writing a dose needs maternity.create',
  );

  /* ---- the delivery charge ---- */
  /* The delivery charge block moved with its route; the pricing claims
     below are checked against it in its new home. */
  const deliveryCharge = routesSource.slice(
    routesSource.indexOf('const created = await maternity.recordDelivery'),
    routesSource.indexOf('res.status(201).json({ ...created, billing: charge });'),
  );

  assert(deliveryCharge.length > 100, 'the delivery route has a billing block');

  assert(
    deliveryCharge.includes('chargeSafely({'),
    'the delivery is billed through the billing engine',
  );

  assert(
    deliveryCharge.includes("sourceType: 'MATERNITY'"),
    'and attributed to maternity, not to a generic manual line',
  );

  assert(
    deliveryCharge.includes('sourceId: created.delivery.id'),
    'with the delivery as the source, so a repeat cannot double-charge',
  );

  assert(
    deliveringIsOneChargePerDelivery(deliveryCharge),
    'twins do not multiply the delivery charge',
  );

  assert(
    !deliveryCharge.includes('fallbackUnitPrice'),
    'no price is invented when the facility has no delivery tariff',
  );

  assert(!/\d+\.\d{2}/.test(deliveryCharge), 'no money literal appears in the delivery charge');
}

/** The charge is raised once for the delivery, outside the babies loop. */
function deliveringIsOneChargePerDelivery(block: string): boolean {
  return (
    block.includes('sourceId: created.delivery.id') &&
    !block.includes('created.babies.map') &&
    !block.includes('created.babies.forEach')
  );
}

/* ============================================================
   7. THE SCREEN
   ============================================================ */

function testScreen(): void {
  const module = read('src/components/modules/MaternityModule.tsx');
  const chart = read('src/components/maternity/PartographChart.tsx');
  const client = read('src/api/client.ts');

  assert(module.includes("'postnatal'"), 'the postnatal tab exists');
  assert(module.includes("'immunisation'"), 'the immunisation tab exists');
  assert(module.includes('api.recordPostnatalVisit('), 'the screen writes a postnatal contact');
  assert(module.includes('api.recordImmunisation('), 'the screen writes a dose');
  assert(module.includes('api.getImmunisationDueList('), 'the screen shows who is due');
  assert(module.includes('TARIFF_NOT_CONFIGURED'), 'the screen says when nothing was billed');
  assert(module.includes('Recorded, not billed.'), 'in words a receptionist can act on');
  assert(module.includes('Delivery register'), 'the delivery register is still there');

  assert(
    module.includes('<PartographChart plot={selectedLabour.plot} />'),
    'the chart is rendered from the stored plot',
  );

  /*
   * The table stayed. The chart is an addition, not a replacement: a
   * clinician reading six hours of observations wants the numbers.
   */
  assert(
    module.includes('<th className="px-2 py-2 font-medium">Dilat.</th>'),
    'the partograph table is still rendered',
  );

  assert(chart.includes('<svg'), 'the chart is inline SVG');
  assert(chart.includes('role="img"'), 'the chart is exposed as an image to assistive technology');
  assert(chart.includes('aria-label={description}'), 'and has a description built from the data');
  assert(chart.includes('plot.alertLine'), 'the alert line is drawn from the computed geometry');
  assert(chart.includes('plot.actionLine'), 'the action line is drawn from the computed geometry');
  assert(!chart.includes('<canvas'), 'no canvas');
  assert(!chart.includes('recharts'), 'and no charting dependency');
  assert(!/https?:\/\//.test(chart), 'the chart loads nothing from the network');

  assert(
    !module.includes('Sample patient') && !module.includes('John Doe'),
    'the screen ships no sample patient',
  );

  for (const method of [
    'getPostnatalVisits:',
    'getPostnatalRegister:',
    'recordPostnatalVisit:',
    'getImmunisationSchedule:',
    'getImmunisationCard:',
    'recordImmunisation:',
    'getImmunisationDueList:',
  ]) {
    assert(client.includes(method), `the API client exposes ${method}`);
  }
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');

  testSchedule();
  console.log('  1. The KEPI reference schedule lives in code');

  testStatus();
  console.log('  2. Due, overdue and given are computed from the date of birth');

  testPlot();
  console.log('  3. The partograph plot is geometry, not extrapolation');

  testSchema();
  console.log('  4. The tables, the unique index and an additive migration');

  testServices();
  console.log('  5. The services refuse duplicates, future dates and out-of-scope records');

  testRoutes();
  console.log('  6. The delivery charge uses a real tariff — or says it has none');

  testScreen();
  console.log('  7. Every capability is on the screen');

  console.log('');
  console.log('==============================================');
  console.log(`POSTNATAL & IMMUNISATION TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('POSTNATAL & IMMUNISATION TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
