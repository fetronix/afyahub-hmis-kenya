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
import {
  maternityModuleSource,
  maternityServiceSource,
  schemaModule,
  schemaSource,
} from './support/schema-source.ts';
import { containsCode } from './support/source-text.ts';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Maternity / MCH tests', () => {
  it('1. DATES', async () => {
    expect(isIsoDate('2026-10-08'), 'a real date is accepted').toBe(true);
    expect(!isIsoDate('2026-02-30'), '30 February is refused').toBe(true);
    expect(!isIsoDate('2026-13-01'), 'month 13 is refused').toBe(true);
    expect(!isIsoDate('08/10/2026'), 'a local date format is refused').toBe(true);
    expect(!isIsoDate(20261008), 'a number is not a date').toBe(true);
    expect(!isIsoDate('2026-1-8'), 'unpadded parts are refused').toBe(true);

    expect(addDays('2026-01-01', 280), 'LMP + 280 days').toBe('2026-10-08');
    expect(addDays('2026-03-01', -1), 'the day before 1 March').toBe('2026-02-28');
    expect(addDays('2024-02-28', 1), '29 February exists in a leap year').toBe('2024-02-29');
    expect(daysBetween('2026-01-01', '2026-10-08'), '280 days elapse').toBe(280);
    expect(daysBetween('2026-10-08', '2026-01-01'), 'and the reverse is negative').toBe(-280);

    expect(deriveEdd('2026-01-01'), 'Naegele: LMP + 280 days').toBe('2026-10-08');
    expect(GESTATION_DAYS, 'the convention is 40 weeks').toBe(280);

    const atEdd = gestationAt('2026-10-08', '2026-10-08');
    expect(atEdd?.weeks, 'the EDD is 40 weeks').toBe(40);
    expect(atEdd?.days, 'and zero days').toBe(0);

    const early = gestationAt('2026-10-08', '2026-04-01');
    expect(early?.totalDays, 'ninety days before term is 90 days of gestation').toBe(90);
    expect(early?.weeks, 'which is 12 weeks').toBe(12);
    expect(early?.days, 'and six days').toBe(6);

    expect(
      gestationAt('2026-10-08', '2024-01-01'),
      'a date two years early is refused rather than reported as negative',
    ).toBe(null);
    expect(gestationAt('not-a-date', '2026-04-01'), 'an invalid EDD produces nothing').toBe(null);
  });

  it('2. VALIDATION', async () => {
    expect(numberInRange(undefined, 'x', 0, 10).value, 'absent stays absent').toBe(null);
    expect(numberInRange('', 'x', 0, 10).value, 'an empty string stays absent').toBe(null);
    expect(numberInRange(0, 'x', 0, 10).value, 'zero is a value, not an absence').toBe(0);
    expect(numberInRange('7', 'x', 0, 10).value, 'a numeric string parses').toBe(7);
    expect(numberInRange(11, 'x', 0, 10).error !== undefined, 'out of range is refused').toBe(true);
    expect(numberInRange('abc', 'x', 0, 10).error !== undefined, 'text is refused').toBe(true);
    expect(numberInRange(-4, 'station', -3, 3).value, 'below the range').toBe(null);
    expect(
      numberInRange(-3, 'station', -3, 3).value,
      'a negative value is allowed where the range allows it',
    ).toBe(-3);

    expect(
      oneOf('Intact', 'membranes', ['Intact', 'Ruptured'] as const).value,
      'a listed value passes',
    ).toBe('Intact');
    expect(
      oneOf('', 'membranes', ['Intact', 'Ruptured'] as const).value,
      'an empty choice is absent',
    ).toBe(null);
    expect(
      oneOf('Torn', 'membranes', ['Intact', 'Ruptured'] as const).error !== undefined,
      'an unlisted value is refused',
    ).toBe(true);
    expect(
      oneOf(5, 'membranes', ['Intact'] as const).error !== undefined,
      'a non-string is refused',
    ).toBe(true);
  });

  it('3. PARTOGRAPH', async () => {
    const tooFew = partographGuidance([
      { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 5 },
    ]);
    expect(tooFew.zone, 'one point is not a curve').toBe('Too few readings');
    expect(tooFew.dilatationCm, 'the latest value is still reported').toBe(5);

    const onLine = partographGuidance([
      { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
      { recordedAt: '2026-10-08T12:00:00Z', cervicalDilatationCm: 8 },
    ]);
    expect(onLine.zone, '1 cm/hour is on the line').toBe('On or left of the alert line');
    expect(onLine.hoursSinceFourCm, 'four hours since 4 cm').toBe(4);
    expect(onLine.hoursBeyondAlert, 'and no hours beyond it').toBe(0);

    const behind = partographGuidance([
      { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
      { recordedAt: '2026-10-08T12:00:00Z', cervicalDilatationCm: 6 },
    ]);
    expect(behind.zone, 'two hours behind is between the lines').toBe(
      'Between the alert and action lines',
    );
    expect(behind.hoursBeyondAlert, 'two hours beyond the alert line').toBe(2);

    const farBehind = partographGuidance([
      { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
      { recordedAt: '2026-10-08T14:00:00Z', cervicalDilatationCm: 5 },
    ]);
    expect(farBehind.zone, 'five hours behind is past the action line').toBe(
      'Right of the action line',
    );
    expect(farBehind.hoursBeyondAlert, 'five hours beyond the alert line').toBe(5);

    const unsorted = partographGuidance([
      { recordedAt: '2026-10-08T12:00:00Z', cervicalDilatationCm: 8 },
      { recordedAt: '2026-10-08T08:00:00Z', cervicalDilatationCm: 4 },
    ]);
    expect(unsorted.zone, 'readings are sorted before plotting').toBe(
      'On or left of the alert line',
    );

    expect(tooFew.note.includes('plotting aid'), 'the guidance says what it is and is not').toBe(
      true,
    );
    expect(
      !partographGuidance([]).zone.includes('emergency'),
      'the module never raises an emergency of its own',
    ).toBe(true);
  });

  it('4. MIGRATION', async () => {
    const sql = read('drizzle/0015_maternity_mch.sql');

    for (const table of [
      'maternity_pregnancies',
      'anc_visits',
      'labour_records',
      'partograph_entries',
      'deliveries',
      'delivery_babies',
    ]) {
      expect(
        sql.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
        `${table} is created with IF NOT EXISTS`,
      ).toBe(true);
    }

    expect(!/\bDROP\b/i.test(sql), 'the migration drops nothing').toBe(true);
    expect(!/\bTRUNCATE\b/i.test(sql), 'the migration truncates nothing').toBe(true);
    expect(!/\bDELETE\b/i.test(sql), 'the migration deletes nothing').toBe(true);
    expect(!/\bINSERT\b/i.test(sql), 'the migration seeds no rows').toBe(true);
    expect(!/\bALTER TABLE\b/i.test(sql), 'the migration alters no existing table').toBe(true);
    expect(
      sql.includes('maternity_pregnancies_one_active_idx'),
      'one active pregnancy per patient is enforced by the database',
    ).toBe(true);
    expect(
      sql.includes('partograph_entries_labour_time_idx'),
      'duplicate partograph timestamps are refused by the database',
    ).toBe(true);
    expect(
      sql.includes('WHERE "status" = \'Active\''),
      'the partial index only constrains active pregnancies',
    ).toBe(true);

    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    /*
     * Do not pin the last tag: later migrations are allowed, and a test
     * that fails when the next one lands teaches people to edit the test
     * instead of reading it.
     */
    const tags = journal.entries.map((entry) => entry.tag);
    const indexes = journal.entries.map((entry) => entry.idx);

    expect(tags.includes('0015_maternity_mch'), 'the maternity migration is in the journal').toBe(
      true,
    );
    expect(indexes.at(-1), 'the journal indexes are contiguous').toBe(journal.entries.length - 1);
    expect(new Set(indexes).size, 'no migration index repeats').toBe(indexes.length);
  });

  it('5. NO INVENTED CLINICAL VALUES', async () => {
    /*
     * Read the maternity module itself, not the concatenated schema. The
     * tables were extracted from the barrel into `schema/maternity.ts`; the
     * rule below is unchanged, it is only the file that moved.
     */
    const block = schemaModule('maternity');
    const schema = schemaSource();

    expect(
      block.indexOf('export const maternityPregnancies') > -1 &&
        block.indexOf('export const immunisationRecords') > -1,
      'the maternity tables can be isolated',
    ).toBe(true);

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

      expect(literal > -1, `${column} exists in the schema`).toBe(true);

      /* Look ahead two lines for a default; a measurement must not have one. */
      const nearby = block.slice(
        Math.max(0, block.indexOf(`'${column}'`) - 80),
        block.indexOf(`'${column}'`) + 200,
      );

      expect(
        !new RegExp(`'${column}'[^\\n]*\\.default\\(`).test(nearby),
        `${column} carries no default value`,
      ).toBe(true);
    }
  });

  it('6. WIRING', async () => {
    const app = read('src/app.ts');
    const wiring = read('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

    expect(
      wiring.includes("api.use('/maternity', requireFacilityModule('maternity'))"),
      'the module gate is mounted',
    ).toBe(true);

    /*
     * The maternity and immunisation routes moved out of createApp into
     * src/routes/maternal-health.routes.ts, mounted at '/api'. The module
     * gate above stayed in app.ts, because it is a mount rather than a
     * route. These assertions follow the routes to their new home instead of
     * being relaxed: the route path is still named, and the permission is
     * still required within 400 characters of it.
     */
    const routesSource = read('src/routes/maternal-health.routes.ts');

    const routes = [
      ['/maternity/summary', 'maternity.read'],
      ['/maternity/pregnancies', 'maternity.read'],
      ['/maternity/anc-visits', 'maternity.create'],
      ['/maternity/labours', 'maternity.read'],
      ['/maternity/partograph', 'maternity.create'],
      ['/maternity/deliveries', 'maternity.read'],
    ] as const;

    for (const [route, permission] of routes) {
      const index = routesSource.indexOf(`'${route}'`);

      expect(index > -1, `GET ${route} exists`).toBe(true);

      const nearby = routesSource.slice(index, index + 400);

      expect(
        nearby.includes(`requirePermission('${permission}')`),
        `GET ${route} is guarded by ${permission}`,
      ).toBe(true);
    }

    expect(
      routesSource.indexOf("router.post(\n  '/maternity/deliveries'") >
        routesSource.indexOf("router.get(\n  '/maternity/deliveries'"),
      'the delivery POST is registered separately from the GET',
    ).toBe(true);

    expect(
      wiring.includes('api.use(maternalHealthRoutes)'),
      'the extracted router is mounted at /api',
    ).toBe(true);

    const server = maternityServiceSource();

    expect(
      server.includes('maternity.read') === false && server.includes('requirePermission') === false,
      'the service does not make permission decisions',
    ).toBe(true);

    expect(
      server.includes("notFound('The pregnancy record')"),
      'a pregnancy outside scope answers as not found',
    ).toBe(true);

    expect(
      server.includes('ONE ACTIVE') === false,
      'nothing claims a constraint it does not have',
    ).toBe(true);

    /*
     * Drizzle wraps driver errors, so the SQLSTATE lives on `cause`. A
     * check of `error.code` alone turned every unique violation into a 500
     * — caught by the live test against PostgreSQL, asserted here so it
     * cannot come back.
     */
    expect(
      server.includes('function pgErrorCode'),
      'Postgres error codes are read through the wrapper',
    ).toBe(true);

    expect(server.includes('.cause?.code'), 'the wrapped cause is inspected').toBe(true);

    expect(
      (server.match(/\.catch\(\(\) => null\)/g) ?? []).length >= 3,
      'every facility lookup converts a scope denial into not-found',
    ).toBe(true);
  });

  it('7. PERMISSIONS', async () => {
    const seed = read('src/seeds/permissions.ts');

    for (const code of ['maternity.read', 'maternity.create', 'maternity.update']) {
      expect(seed.includes(`code: '${code}'`), `${code} is in the permission seed`).toBe(true);
    }

    const catalogue = read('src/auth/staff-role-catalogue.ts');

    expect(
      (catalogue.match(/'maternity\.read'/g) ?? []).length >= 3,
      'at least three staff roles can read maternity records',
    ).toBe(true);

    expect(
      containsCode(catalogue, "'maternity.create', 'maternity.update'"),
      'the roles that record care hold the write permissions',
    ).toBe(true);
  });

  it('8. THE SCREEN', async () => {
    const ui = maternityModuleSource();

    expect(!ui.includes('142 bpm'), 'no sample fetal heart rate is shipped').toBe(true);
    expect(!ui.includes('G2 P1'), 'no sample obstetric history is shipped').toBe(true);
    expect(!/value=\{\d+\}/.test(ui), 'no input is pre-filled with a literal number').toBe(true);

    expect(/placeholder="Cephalic"/.test(ui), 'a placeholder is a hint, not a stored value').toBe(
      true,
    );

    expect(
      ui.includes('Number.isFinite(parsed) ? parsed : undefined'),
      'an empty field is sent as absent',
    ).toBe(true);

    expect(ui.includes('gestation'), 'the register shows gestation computed by the server').toBe(
      true,
    );

    const specialty = read('src/components/modules/SpecialtyModule.tsx');

    expect(
      !specialty.includes("activeSpecialty === 'MCH'"),
      'the mock antenatal form is gone',
    ).toBe(true);

    expect(!specialty.includes('142 bpm'), 'and its invented observations are gone with it').toBe(
      true,
    );

    expect(DELIVERY_MODES.length === 6, 'six delivery modes are offered').toBe(true);
    expect(BABY_OUTCOMES.length === 4, 'four baby outcomes are offered').toBe(true);
    expect(LIQUORS.length === 6, 'six liquor grades are offered').toBe(true);
    expect(PREGNANCY_STATUSES.includes('Active'), 'a pregnancy starts active').toBe(true);
  });
});
