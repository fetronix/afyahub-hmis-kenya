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
import {
  apiClientSource,
  maternityModuleSource,
  schemaModule,
  schemaSource,
} from './support/schema-source.ts';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const ADMITTED = '2026-10-21T08:00:00.000Z';

function at(hours: number): string {
  return new Date(Date.parse(ADMITTED) + hours * 3_600_000).toISOString();
}

describe('Postnatal care, immunisation, the partograph plot and delivery billing', () => {
  it('1. THE IMMUNISATION SCHEDULE', async () => {
    expect(ANTIGENS.length >= 15, 'the reference schedule carries the KEPI antigens').toBe(true);

    const codes = new Set(ANTIGENS.map((antigen) => antigen.code));

    expect(codes.size, 'every antigen code is unique').toBe(ANTIGENS.length);

    expect(
      ANTIGENS.every((antigen) => antigen.weeks >= 0),
      'no antigen is scheduled at a negative age',
    ).toBe(true);

    expect(
      ANTIGENS.every((antigen) =>
        ['Intradermal', 'Subcutaneous', 'Intramuscular', 'Oral'].includes(antigen.route),
      ),
      'every antigen has a route a vaccinator would recognise',
    ).toBe(true);

    expect(
      ANTIGENS.every((antigen) => antigen.doses >= 1),
      'every antigen has at least one dose',
    ).toBe(true);

    expect(ANTIGEN_BY_CODE.get('BCG')?.weeks, 'BCG is given at birth').toBe(0);

    expect(
      ANTIGEN_BY_CODE.get('PENTA-3')?.weeks,
      'the third pentavalent dose is scheduled at 14 weeks',
    ).toBe(14);

    expect(
      ANTIGEN_BY_CODE.get('MR-1')?.weeks,
      'measles-rubella 1 is scheduled at nine months',
    ).toBe(39);

    expect(
      ANTIGEN_BY_CODE.get('NOT-AN-ANTIGEN') === undefined,
      'an unknown code is not in the schedule',
    ).toBe(true);

    expect(
      SCHEDULE_AGREES_NOTE.toLowerCase().includes('kepi'),
      'the note names the chart the ages must be confirmed against',
    ).toBe(true);

    expect(
      SCHEDULE_AGREES_NOTE.toLowerCase().includes('confirm'),
      'the note does not present the reference ages as authoritative',
    ).toBe(true);
  });

  it('2. AGE AND STATUS', async () => {
    expect(ageInWeeks('2026-01-01', '2026-01-01'), 'a newborn is zero weeks').toBe(0);
    expect(ageInWeeks('2026-01-01', '2026-02-12'), '42 days is six weeks').toBe(6);
    expect(ageInWeeks('2026-01-01', '2026-02-11'), '41 days is still five').toBe(5);
    expect(ageInWeeks('2026-01-01', '2027-01-01'), 'a year is 52 weeks').toBe(52);
    expect(
      Number.isNaN(ageInWeeks('not-a-date', '2026-01-01')),
      'an unparseable date of birth yields no age rather than zero',
    ).toBe(true);

    const newborn = immunisationStatus('2026-01-01', '2026-01-01', []);
    const bcg = newborn.find((dose) => dose.antigenCode === 'BCG');

    expect(bcg?.status, 'BCG is due on the day of birth').toBe('Due');
    expect(bcg?.givenOn, 'an ungiven dose has no date').toBe(null);
    expect(
      newborn.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
      'a dose scheduled for six weeks is not due at birth',
    ).toBe('Not yet due');

    const atSix = immunisationStatus('2026-01-01', '2026-02-12', []);

    expect(
      atSix.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
      'pentavalent 1 is due at six weeks',
    ).toBe('Due');

    const atNine = immunisationStatus('2026-01-01', '2026-03-05', []);

    expect(
      atNine.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
      'three weeks late is late, not overdue',
    ).toBe('Due');

    const atTen = immunisationStatus('2026-01-01', '2026-03-12', []);

    expect(
      atTen.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
      'four weeks past the scheduled age is overdue',
    ).toBe('Overdue');

    const given = immunisationStatus('2026-01-01', '2026-02-12', [
      { antigenCode: 'BCG', administeredOn: '2026-01-01' },
    ]);

    expect(
      given.find((dose) => dose.antigenCode === 'BCG')?.status,
      'a recorded dose is Given regardless of the schedule',
    ).toBe('Given');
    expect(
      given.find((dose) => dose.antigenCode === 'BCG')?.givenOn,
      'and carries the date it was given',
    ).toBe('2026-01-01');

    /*
     * A dose recorded before its scheduled age is still a dose that was
     * given. The schedule is a recommendation; the record is a fact.
     */
    const early = immunisationStatus('2026-01-01', '2026-01-15', [
      { antigenCode: 'PENTA-1', administeredOn: '2026-01-15' },
    ]);

    expect(
      early.find((dose) => dose.antigenCode === 'PENTA-1')?.status,
      'an early dose is recorded, not hidden',
    ).toBe('Given');

    const unknown = immunisationStatus('2026-01-01', '2026-02-12', [
      { antigenCode: 'SMALLPOX', administeredOn: '2026-01-02' },
    ]);

    expect(
      unknown.length,
      'a record for an antigen outside the schedule does not crash the card',
    ).toBe(ANTIGENS.length);

    const outstanding = outstandingDoses(atTen);

    expect(outstanding.length > 0, 'a child at ten weeks has doses outstanding').toBe(true);

    expect(
      outstanding.every((dose) => dose.status === 'Due' || dose.status === 'Overdue'),
      'only due and overdue doses are outstanding',
    ).toBe(true);

    expect(
      !outstanding.some((dose) => dose.antigenCode === 'MR-2'),
      'a dose scheduled for eighteen months is not outstanding at ten weeks',
    ).toBe(true);
  });

  it('3. THE PARTOGRAPH PLOT', async () => {
    const plot = buildPartographPlot(ADMITTED, [
      { recordedAt: at(0), cervicalDilatationCm: 3, fetalHeartRateBpm: 140 },
      { recordedAt: at(2), cervicalDilatationCm: 4, fetalHeartRateBpm: 138 },
      { recordedAt: at(4), cervicalDilatationCm: 6, fetalHeartRateBpm: 136 },
    ]);

    expect(plot.readings.length, 'every reading is plotted').toBe(3);
    expect(plot.readings[0].hoursSinceAdmission, 'the first reading is hour zero').toBe(0);
    expect(plot.readings[1].hoursSinceAdmission, 'the second is two hours in').toBe(2);
    expect(plot.readings[2].hoursSinceAdmission, 'the third is four hours in').toBe(4);

    expect(plot.alertLine !== null, 'an alert line exists once 4 cm is reached').toBe(true);
    expect(plot.alertLine?.startHour, 'it starts at the reading that reached 4 cm').toBe(2);
    expect(plot.alertLine?.startCm, 'at 4 cm').toBe(4);
    expect(plot.alertLine?.endHour, 'and climbs one centimetre an hour to 10 cm').toBe(8);
    expect(plot.alertLine?.endCm, 'reaching 10 cm').toBe(10);

    expect(plot.actionLine !== null, 'an action line exists with the alert line').toBe(true);
    expect(plot.actionLine?.startHour, 'it is the alert line four hours later').toBe(6);
    expect(plot.actionLine?.endHour, 'and ends four hours after the alert line').toBe(12);
    expect(plot.actionLine?.startCm, 'at the same height').toBe(4);
    expect(plot.actionLine?.endCm, 'and the same gradient').toBe(10);

    /*
     * The x axis must reach the end of the action line. A chart that crops
     * its own action line makes the line look as though it stopped.
     */
    expect(
      plot.maxHour >= (plot.actionLine?.endHour ?? 0),
      'the axis reaches the end of the action line',
    ).toBe(true);
    expect(plot.maxHour, 'which is 12 plus one spare hour').toBe(13);

    const late = buildPartographPlot(ADMITTED, [{ recordedAt: at(5), cervicalDilatationCm: 4 }]);

    expect(late.alertLine?.startHour, 'a late start moves the alert line right').toBe(5);
    expect(late.actionLine?.endHour, 'and the action line with it').toBe(15);
    expect(late.maxHour, 'the axis still covers the whole action line').toBe(16);

    const empty = buildPartographPlot(ADMITTED, []);

    expect(empty.readings.length, 'no readings plot no points').toBe(0);
    expect(empty.alertLine, 'and there is no alert line').toBe(null);
    expect(empty.actionLine, 'and no action line').toBe(null);
    expect(empty.maxHour, 'the sheet still has a twelve-hour axis').toBe(12);
    expect(empty.zone, 'and the zone says there is not enough to judge').toBe('Too few readings');

    const noDilatation = buildPartographPlot(ADMITTED, [
      { recordedAt: at(1), cervicalDilatationCm: null, fetalHeartRateBpm: 150 },
    ]);

    expect(noDilatation.readings.length, 'a reading with no dilatation is still a reading').toBe(1);
    expect(noDilatation.alertLine, 'but it does not start an alert line').toBe(null);
    expect(noDilatation.readings[0].fetalHeartRateBpm, 'its other measurements survive').toBe(150);
    expect(noDilatation.readings[0].dilatationCm, 'and the missing one stays missing').toBe(null);

    const unsorted = buildPartographPlot(ADMITTED, [
      { recordedAt: at(5), cervicalDilatationCm: 7 },
      { recordedAt: at(1), cervicalDilatationCm: 5 },
      { recordedAt: at(3), cervicalDilatationCm: 6 },
    ]);

    expect(unsorted.readings[0].hoursSinceAdmission, 'readings are ordered by time').toBe(1);
    expect(unsorted.readings[2].hoursSinceAdmission, 'even when they arrive out of order').toBe(5);

    const stringy = buildPartographPlot(ADMITTED, [
      { recordedAt: at(0), cervicalDilatationCm: '4' },
      { recordedAt: at(1), cervicalDilatationCm: '5' },
    ]);

    expect(
      stringy.readings[0].dilatationCm,
      'a numeric column returned as text is plotted as a number',
    ).toBe(4);

    const guidance = partographGuidance([
      { recordedAt: at(0), cervicalDilatationCm: 3 },
      { recordedAt: at(2), cervicalDilatationCm: 4 },
      { recordedAt: at(4), cervicalDilatationCm: 6 },
    ]);

    expect(
      plot.zone,
      'the plot reports the same zone the table reports — there is one calculation',
    ).toBe(guidance.zone);
    expect(plot.note, 'and the same note').toBe(guidance.note);

    expect(
      plot.note.toLowerCase().includes('plotting aid'),
      'the note does not recommend an intervention',
    ).toBe(true);

    /* Nothing is extrapolated past the last reading. */
    const stalled = buildPartographPlot(ADMITTED, [{ recordedAt: at(2), cervicalDilatationCm: 4 }]);

    expect(
      stalled.readings.length,
      'a single reading produces a single point, not a projected line',
    ).toBe(1);
  });

  it('4. THE TABLES AND THE MIGRATION', async () => {
    const schema = schemaSource();

    expect(
      schema.includes("postnatalVisits = pgTable(\n  'postnatal_visits'"),
      'postnatal_visits is declared',
    ).toBe(true);
    expect(
      schema.includes("immunisationRecords = pgTable(\n  'immunisation_records'"),
      'immunisation_records is declared',
    ).toBe(true);
    expect(
      schema.includes("uniqueIndex('immunisation_records_dose_idx')"),
      'the double-administration guard is a unique index',
    ).toBe(true);

    const postnatalStart = schema.indexOf('export const postnatalVisits');
    const postnatalEnd = schema.indexOf('export const immunisationRecords');
    const postnatalBlock = schema.slice(postnatalStart, postnatalEnd);

    expect(postnatalBlock.length > 1000, 'the postnatal table block was located').toBe(true);

    expect(
      !postnatalBlock.includes('.default('),
      'no postnatal clinical column carries a default',
    ).toBe(true);

    expect(
      postnatalBlock.includes('.references(() => maternityPregnancies.id)'),
      'a postnatal visit hangs off the pregnancy',
    ).toBe(true);

    expect(
      postnatalBlock.includes('dayPostpartum: integer'),
      'the day postpartum is stored, not recomputed on read',
    ).toBe(true);

    expect(
      postnatalBlock.includes('babyWeightGrams: integer'),
      'the baby weight sits on the mother’s contact',
    ).toBe(true);

    /*
     * Slice inside the maternity module: both ends have to come from the
     * same file. `45. RELATIONS` is a marker in the barrel, which is
     * concatenated first, so it resolved before the table it follows.
     */
    const immunisationBlock = schemaModule('maternity').slice(
      schemaModule('maternity').indexOf('export const immunisationRecords'),
    );

    expect(
      immunisationBlock.includes('default(1)'),
      'the dose number defaults to 1 — it is an index, not a measurement',
    ).toBe(true);

    expect(immunisationBlock.includes('antigenCode: text'), 'the antigen is stored by code').toBe(
      true,
    );

    expect(
      immunisationBlock.includes('administeredOn: text'),
      'the date the dose was given is stored',
    ).toBe(true);

    /*
     * The schedule must not be a table. If a row in a table decided which
     * dose is due, last year's card would be re-read against this year's
     * schedule and change.
     */
    expect(
      !schema.includes("pgTable(\n  'immunisation_schedule'"),
      'the schedule is not a database table',
    ).toBe(true);

    const sql = read('drizzle/0016_postnatal_immunisation.sql');

    expect(
      sql.includes('CREATE TABLE IF NOT EXISTS "postnatal_visits"'),
      'the migration creates postnatal_visits',
    ).toBe(true);
    expect(
      sql.includes('CREATE TABLE IF NOT EXISTS "immunisation_records"'),
      'the migration creates immunisation_records',
    ).toBe(true);
    expect(
      sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "immunisation_records_dose_idx"'),
      'the migration creates the unique dose index',
    ).toBe(true);

    for (const destructive of ['DROP TABLE', 'DROP INDEX', 'TRUNCATE', 'ALTER TABLE', 'UPDATE ']) {
      expect(
        !sql.toUpperCase().includes(destructive),
        `the migration does not contain ${destructive.trim()}`,
      ).toBe(true);
    }

    expect(
      !sql.toUpperCase().includes('INSERT INTO'),
      'the migration seeds no clinical records',
    ).toBe(true);

    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
      entries: Array<{ tag: string }>;
    };

    const tags = journal.entries.map((entry) => entry.tag);

    expect(tags.includes('0016_postnatal_immunisation'), 'the journal lists the migration').toBe(
      true,
    );
    expect(new Set(tags).size, 'no migration tag appears twice in the journal').toBe(tags.length);
  });

  it('5. THE SERVICES REFUSE WHAT THEY SHOULD', async () => {
    const postnatal = read('src/maternity/postnatal.service.ts');
    const immunisation = read('src/immunisation/immunisation.service.ts');

    expect(
      postnatal.includes('resolvePregnancy('),
      'a postnatal contact must resolve the pregnancy first',
    ).toBe(true);

    expect(
      postnatal.includes('facilityId: pregnancy.facilityId'),
      'the visit is attributed to the pregnancy’s facility, not the request body',
    ).toBe(true);

    expect(
      postnatal.includes('patientId: pregnancy.patientId'),
      'and to the pregnancy’s patient',
    ).toBe(true);

    expect(
      postnatal.includes('DELIVERY_PREGNANCY_MISMATCH'),
      'a delivery from another pregnancy is refused',
    ).toBe(true);

    expect(
      postnatal.includes('daysBetween('),
      'the day postpartum is counted from the recorded delivery date',
    ).toBe(true);

    expect(!postnatal.includes('?? 0'), 'no postpartum measurement is defaulted to zero').toBe(
      true,
    );

    expect(
      immunisation.includes("pgErrorCode(error) === '23505'"),
      'a duplicate dose is recognised from the unique violation',
    ).toBe(true);

    expect(
      immunisation.includes("'DOSE_ALREADY_RECORDED'"),
      'and reported as a conflict rather than a 500',
    ).toBe(true);

    expect(
      immunisation.includes('(error as { cause?: { code?: string } })?.cause?.code'),
      'the SQLSTATE is read from the wrapped driver error',
    ).toBe(true);

    expect(immunisation.includes("'FUTURE_DATE'"), 'a dose cannot be dated in the future').toBe(
      true,
    );

    expect(
      immunisation.includes("'BEFORE_BIRTH'"),
      'a dose cannot be dated before the child was born',
    ).toBe(true);

    expect(
      immunisation.includes("'UNKNOWN_ANTIGEN'"),
      'an antigen outside the schedule is refused',
    ).toBe(true);

    expect(
      immunisation.includes('statusCode = 400') || immunisation.includes('statusCode = 400'),
      'the domain error carries an HTTP status',
    ).toBe(true);

    expect(
      !immunisation.includes('?? 0'),
      'the immunisation service invents no count or measurement',
    ).toBe(true);

    expect(
      immunisation.includes('.catch(() => null)'),
      'a facility outside scope answers as not found rather than forbidden',
    ).toBe(true);

    expect(
      !immunisation.includes('INSERT INTO') && !immunisation.includes('db.execute'),
      'the service writes through the schema, not raw SQL',
    ).toBe(true);
  });

  it('6. THE ROUTES', async () => {
    const app = read('src/app.ts');
    const wiring = read('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

    expect(
      wiring.includes("api.use('/immunisation', requireFacilityModule('maternity'))"),
      'immunisation is gated on the MCH module like maternity',
    ).toBe(true);

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

      expect(index > -1, `GET ${route} exists`).toBe(true);

      expect(
        routesSource.slice(index, index + 300).includes(`requirePermission('${permission}')`),
        `GET ${route} is guarded by ${permission}`,
      ).toBe(true);
    }

    const postnatalPost = routesSource.indexOf("router.post(\n  '/maternity/postnatal'");
    const immunisationPost = routesSource.indexOf("router.post(\n  '/immunisation/records'");

    expect(postnatalPost > -1, 'a postnatal contact can be written').toBe(true);
    expect(immunisationPost > -1, 'a dose can be written').toBe(true);

    expect(
      routesSource
        .slice(postnatalPost, postnatalPost + 200)
        .includes("requirePermission('maternity.create')"),
      'writing a postnatal contact needs maternity.create',
    ).toBe(true);

    expect(
      routesSource
        .slice(immunisationPost, immunisationPost + 200)
        .includes("requirePermission('maternity.create')"),
      'writing a dose needs maternity.create',
    ).toBe(true);

    /* ---- the delivery charge ---- */
    /* The delivery charge block moved with its route; the pricing claims
       below are checked against it in its new home. */
    const deliveryCharge = routesSource.slice(
      routesSource.indexOf('const created = await maternity.recordDelivery'),
      routesSource.indexOf('res.status(201).json({ ...created, billing: charge });'),
    );

    expect(deliveryCharge.length > 100, 'the delivery route has a billing block').toBe(true);

    expect(deliveryCharge).toContain('chargeSafely(deliveryChargeRequest(created.delivery))');
    const requestSource = read('src/billing/service-charges.ts');
    const request = requestSource.slice(
      requestSource.indexOf('export function deliveryChargeRequest'),
    );
    expect(request).toContain("sourceType: 'MATERNITY'");
    expect(request).toContain('sourceId: delivery.id');
    expect(request).not.toContain('babies');
    const service = read('src/maternity/services/delivery.service.ts');
    expect(service).toContain('recordChargeAttempt(tx, deliveryChargeRequest(delivery)');
    expect(service).toContain('deliveryChargeRequest(delivery)');

    expect(
      !deliveryCharge.includes('fallbackUnitPrice'),
      'no price is invented when the facility has no delivery tariff',
    ).toBe(true);

    expect(
      !/\d+\.\d{2}/.test(deliveryCharge),
      'no money literal appears in the delivery charge',
    ).toBe(true);
  });

  it('7. THE SCREEN', async () => {
    const module = maternityModuleSource();
    const chart = read('src/components/maternity/PartographChart.tsx');
    const client = apiClientSource();

    expect(module.includes("'postnatal'"), 'the postnatal tab exists').toBe(true);
    expect(module.includes("'immunisation'"), 'the immunisation tab exists').toBe(true);
    expect(
      module.includes('api.recordPostnatalVisit('),
      'the screen writes a postnatal contact',
    ).toBe(true);
    expect(module.includes('api.recordImmunisation('), 'the screen writes a dose').toBe(true);
    expect(module.includes('api.getImmunisationDueList('), 'the screen shows who is due').toBe(
      true,
    );
    expect(
      module.includes('TARIFF_NOT_CONFIGURED'),
      'the screen says when nothing was billed',
    ).toBe(true);
    expect(module.includes('Recorded, not billed.'), 'in words a receptionist can act on').toBe(
      true,
    );
    expect(module.includes('Delivery register'), 'the delivery register is still there').toBe(true);

    expect(
      module.includes('<PartographChart plot={selectedLabour.plot} />'),
      'the chart is rendered from the stored plot',
    ).toBe(true);

    /*
     * The table stayed. The chart is an addition, not a replacement: a
     * clinician reading six hours of observations wants the numbers.
     */
    expect(
      module.includes('<th className="px-2 py-2 font-medium">Dilat.</th>'),
      'the partograph table is still rendered',
    ).toBe(true);

    expect(chart.includes('<svg'), 'the chart is inline SVG').toBe(true);
    expect(
      chart.includes('role="img"'),
      'the chart is exposed as an image to assistive technology',
    ).toBe(true);
    expect(
      chart.includes('aria-label={description}'),
      'and has a description built from the data',
    ).toBe(true);
    expect(
      chart.includes('plot.alertLine'),
      'the alert line is drawn from the computed geometry',
    ).toBe(true);
    expect(
      chart.includes('plot.actionLine'),
      'the action line is drawn from the computed geometry',
    ).toBe(true);
    expect(!chart.includes('<canvas'), 'no canvas').toBe(true);
    expect(!chart.includes('recharts'), 'and no charting dependency').toBe(true);
    expect(!/https?:\/\//.test(chart), 'the chart loads nothing from the network').toBe(true);

    expect(
      !module.includes('Sample patient') && !module.includes('John Doe'),
      'the screen ships no sample patient',
    ).toBe(true);

    for (const method of [
      'getPostnatalVisits:',
      'getPostnatalRegister:',
      'recordPostnatalVisit:',
      'getImmunisationSchedule:',
      'getImmunisationCard:',
      'recordImmunisation:',
      'getImmunisationDueList:',
    ]) {
      expect(client.includes(method), `the API client exposes ${method}`).toBe(true);
    }
  });
});
