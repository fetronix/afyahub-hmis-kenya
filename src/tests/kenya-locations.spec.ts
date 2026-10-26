import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COUNTY_NAMES,
  KENYA_COUNTIES,
  SUB_COUNTY_COUNT,
  countiesWithSubCounty,
  findCounty,
  findSubCounty,
  isKnownCounty,
  normaliseCounty,
  resolveLocation,
  subCountiesOf,
} from '../constants/kenya-locations.ts';
import {
  MIGRATION_PATH,
  renderLocationMigration,
} from '../../scripts/generate-location-migration.ts';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/* The number of constituencies per county, from the IEBC list the Ministry of
   Health's sub-county teams follow. Written out here rather than derived, so
   a name accidentally deleted from the constants file fails a test that says
   which county lost one, instead of quietly changing a total. */
const SUB_COUNTIES_PER_COUNTY: Record<string, number> = {
  Mombasa: 6,
  Kwale: 4,
  Kilifi: 7,
  'Tana River': 3,
  Lamu: 2,
  'Taita-Taveta': 4,
  Garissa: 6,
  Wajir: 6,
  Mandera: 6,
  Marsabit: 4,
  Isiolo: 2,
  Meru: 9,
  'Tharaka-Nithi': 3,
  Embu: 4,
  Kitui: 8,
  Machakos: 8,
  Makueni: 6,
  Nyandarua: 5,
  Nyeri: 6,
  Kirinyaga: 4,
  "Murang'a": 7,
  Kiambu: 12,
  Turkana: 6,
  'West Pokot': 4,
  Samburu: 3,
  'Trans Nzoia': 5,
  'Uasin Gishu': 6,
  'Elgeyo-Marakwet': 4,
  Nandi: 6,
  Baringo: 6,
  Laikipia: 3,
  Nakuru: 11,
  Narok: 6,
  Kajiado: 5,
  Kericho: 6,
  Bomet: 5,
  Kakamega: 12,
  Bungoma: 9,
  Vihiga: 5,
  Busia: 7,
  Siaya: 6,
  Kisumu: 7,
  'Homa Bay': 8,
  Migori: 8,
  Kisii: 9,
  Nyamira: 4,
  Nairobi: 17,
};

describe('The county list is the whole country, not a selection of it', () => {
  it('counties', async () => {
    expect(KENYA_COUNTIES.length, 'Kenya has 47 counties').toBe(47);

    expect(
      new Set(COUNTY_NAMES).size === 47,
      'no county appears twice - a duplicate would put two identical entries in the dropdown',
    ).toBe(true);

    expect(
      COUNTY_NAMES.every((name) => name.trim() === name && name.length > 0),
      'county names are stored without padding',
    ).toBe(true);
  });

  it('codes', async () => {
    /* The official codes are 001-047 in the constitutional order. They are
       strings because of the leading zeros: storing them as numbers would
       turn 001 Mombasa into 1 and lose the identifier every report uses. */
    const expected = Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(3, '0'));

    expect(
      KENYA_COUNTIES.map((county) => county.code).join(','),
      'county codes run 001 to 047 in order',
    ).toBe(expected.join(','));

    expect(KENYA_COUNTIES[0].name, '001 is Mombasa').toBe('Mombasa');
    expect(KENYA_COUNTIES[46].name, '047 is Nairobi').toBe('Nairobi');
  });

  it('sub-counties', async () => {
    expect(SUB_COUNTY_COUNT, 'Kenya has 290 sub-counties (constituencies)').toBe(290);

    const declared = KENYA_COUNTIES.reduce((total, county) => total + county.subCounties.length, 0);

    expect(declared === SUB_COUNTY_COUNT, 'the exported total matches the lists').toBe(true);

    for (const county of KENYA_COUNTIES) {
      expect(
        county.subCounties.length,
        `${county.name} has ${SUB_COUNTIES_PER_COUNTY[county.name]} sub-counties`,
      ).toBe(SUB_COUNTIES_PER_COUNTY[county.name]);

      expect(
        new Set(county.subCounties).size === county.subCounties.length,
        `${county.name} lists no sub-county twice`,
      ).toBe(true);
    }

    expect(
      Object.keys(SUB_COUNTIES_PER_COUNTY).length,
      'the reference table covers every county, so no county escapes the count check',
    ).toBe(47);
  });

  it('Nairobi', async () => {
    /* The county the seed data and every demo use, so its list is checked by
       name rather than only by length. */
    const nairobi = subCountiesOf('Nairobi');

    expect(nairobi.length, 'Nairobi has 17 sub-counties').toBe(17);
    expect(nairobi.includes('Westlands'), 'Westlands is in Nairobi').toBe(true);
    expect(nairobi.includes('Kasarani'), 'Kasarani is in Nairobi').toBe(true);
    expect(nairobi.includes('Kibra'), 'Kibra is in Nairobi').toBe(true);
    expect(nairobi.includes('Langata'), 'Langata is in Nairobi').toBe(true);
  });
});

describe('Looking a county up tolerates how it was typed, not what it says', () => {
  it('findCounty', async () => {
    expect(findCounty('Nairobi')?.name, 'exact name').toBe('Nairobi');
    expect(findCounty('nairobi')?.name, 'lower case').toBe('Nairobi');
    expect(findCounty('  NAIROBI  ')?.name, 'padded and shouted').toBe('Nairobi');
    expect(findCounty('Trans   Nzoia')?.name, 'repeated inner space').toBe('Trans Nzoia');
    expect(findCounty('Atlantis'), 'an invented county is not guessed at').toBeUndefined();
    expect(findCounty(''), 'empty is not a county').toBeUndefined();
    expect(findCounty(null), 'null is not a county').toBeUndefined();
    expect(findCounty(undefined), 'undefined is not a county').toBeUndefined();
  });

  it('isKnownCounty', async () => {
    expect(isKnownCounty('Kisumu'), 'a real county').toBe(true);
    expect(isKnownCounty('Kisumu County'), 'the county suffix is not in the list').toBe(false);
    expect(isKnownCounty(''), 'blank is not a county').toBe(false);
  });

  it('subCountiesOf', async () => {
    expect(subCountiesOf('Nyeri').length, 'Nyeri offers its own six').toBe(6);
    expect(subCountiesOf('Nyeri').includes('Kieni'), 'Kieni is in Nyeri').toBe(true);
    expect(
      subCountiesOf('Nyeri').includes('Westlands'),
      'Nairobi sub-counties are not offered under Nyeri',
    ).toBe(false);
    expect(subCountiesOf('Atlantis').length, 'an unknown county offers nothing').toBe(0);
    expect(subCountiesOf('').length, 'no county, no choices').toBe(0);
    expect(subCountiesOf(null).length, 'null county, no choices').toBe(0);
  });

  it('findSubCounty', async () => {
    expect(findSubCounty('Nairobi', 'westlands'), 'case-insensitive match').toBe('Westlands');
    expect(
      findSubCounty('Nairobi', 'Westlands'),
      'a real pair answers the canonical spelling',
    ).toBe('Westlands');
    expect(
      findSubCounty('Nyeri', 'Westlands'),
      'a sub-county of another county is refused',
    ).toBeUndefined();
    expect(findSubCounty('Atlantis', 'Westlands'), 'unknown county, no match').toBeUndefined();
    expect(findSubCounty('Nairobi', ''), 'empty sub-county, no match').toBeUndefined();
  });

  it('countiesWithSubCounty', async () => {
    expect(countiesWithSubCounty('Westlands').join(','), 'Westlands names one county').toBe(
      'Nairobi',
    );
    expect(
      countiesWithSubCounty('westlands').join(','),
      'the same answer however it is spelled',
    ).toBe('Nairobi');
    expect(countiesWithSubCounty('Nowhere').length, 'an unknown name has no owner').toBe(0);
    expect(countiesWithSubCounty(null).length, 'null has no owner').toBe(0);
  });

  it('normaliseCounty', async () => {
    expect(normaliseCounty('nairobi'), 'canonical list first').toBe('Nairobi');
    expect(normaliseCounty('Nairobi City'), 'the city suffix is an alias').toBe('Nairobi');
    expect(normaliseCounty('muranga'), "Murang'a without the apostrophe").toBe("Murang'a");
    expect(normaliseCounty("Murang'a"), 'already canonical').toBe("Murang'a");
    expect(normaliseCounty('taita taveta'), 'hyphen restored').toBe('Taita-Taveta');
    expect(normaliseCounty('homabay'), 'run-together spelling').toBe('Homa Bay');
    expect(
      normaliseCounty('Atlantis'),
      'an unknown name is not forced onto a county',
    ).toBeUndefined();
    expect(normaliseCounty(''), 'blank normalises to nothing').toBeUndefined();
    expect(normaliseCounty(null), 'null normalises to nothing').toBeUndefined();
  });
});

describe('What gets stored is decided in one place', () => {
  it('empty', async () => {
    expect(resolveLocation('', ''), 'nothing supplied stays nothing').toEqual({
      ok: true,
      county: null,
      subCounty: null,
    });

    expect(resolveLocation(null, undefined), 'absent is the same as blank').toEqual({
      ok: true,
      county: null,
      subCounty: null,
    });

    expect(resolveLocation('Kisumu', ''), 'a county without a sub-county is allowed').toEqual({
      ok: true,
      county: 'Kisumu',
      subCounty: null,
    });

    expect(resolveLocation('', '   '), 'whitespace is not a value').toEqual({
      ok: true,
      county: null,
      subCounty: null,
    });
  });

  it('valid pair', async () => {
    expect(resolveLocation('Kisumu', 'Nyando'), 'an exact pair is stored as given').toEqual({
      ok: true,
      county: 'Kisumu',
      subCounty: 'Nyando',
    });

    expect(resolveLocation('kisumu', '  nyando '), 'case and padding are corrected').toEqual({
      ok: true,
      county: 'Kisumu',
      subCounty: 'Nyando',
    });

    expect(resolveLocation('Nairobi City', 'kasarani'), 'the alias is corrected too').toEqual({
      ok: true,
      county: 'Nairobi',
      subCounty: 'Kasarani',
    });
  });

  it('refusals', async () => {
    const orphan = resolveLocation('', 'Westlands');

    expect(orphan.ok, 'a sub-county with no county is refused').toBe(false);

    if (!orphan.ok) {
      expect(orphan.message.includes('needs a county'), 'the refusal says what is missing').toBe(
        true,
      );
    }

    const mismatch = resolveLocation('Nyeri', 'Westlands');

    expect(mismatch.ok, 'a sub-county of another county is refused').toBe(false);

    if (!mismatch.ok) {
      expect(
        mismatch.message.includes('"Westlands" is not a sub-county of Nyeri'),
        'the refusal names both values',
      ).toBe(true);
      expect(
        mismatch.message.includes('Kieni'),
        'the refusal lists what would have been accepted, so the caller can fix it',
      ).toBe(true);
    }
  });

  it('legacy passthrough', async () => {
    /* An unknown county is stored as supplied rather than rejected. An old
       client or a spreadsheet import must not lose a patient record over a
       spelling the server has never seen; the migration reports those rows
       instead. The forms cannot produce one - they only offer the 47. */
    expect(resolveLocation('Unknownville', 'Somewhere'), 'unknown county is not rejected').toEqual({
      ok: true,
      county: 'Unknownville',
      subCounty: 'Somewhere',
    });
  });
});

describe('The two screens that write a county offer the same list', () => {
  it('registration', async () => {
    const registration = source('src/components/modules/PatientRegistrationModule.tsx');

    expect(
      registration.includes("from '../../constants/kenya-locations.ts'"),
      'registration reads the shared list rather than carrying its own',
    ).toBe(true);

    expect(
      registration.includes('KENYA_COUNTIES.map('),
      'every county is rendered from the constants',
    ).toBe(true);

    expect(
      registration.includes('<option value="">Select county</option>'),
      'the county dropdown starts empty instead of defaulting to Nairobi',
    ).toBe(true);

    expect(
      registration.includes('subCountiesOf(formData.county)'),
      'the sub-county options come from the chosen county',
    ).toBe(true);

    expect(
      registration.includes('disabled={!formData.county}'),
      'the sub-county cannot be chosen before the county',
    ).toBe(true);

    expect(
      registration.includes("subCounty: ''"),
      'changing the county clears a sub-county that belonged to the old one',
    ).toBe(true);

    expect(
      registration.includes('<option value="Nairobi">Nairobi</option>'),
      'the old ten-option list is gone',
    ).toBe(false);
  });

  it('facilities', async () => {
    const platform = source('src/components/modules/PlatformAdministrationModule.tsx');

    expect(
      platform.includes("from '../../constants/kenya-locations.ts'"),
      'the facility forms read the shared list',
    ).toBe(true);

    expect(
      (platform.match(/KENYA_COUNTIES\.map\(/g) ?? []).length,
      'both the create and the edit form offer all 47 counties',
    ).toBe(2);

    expect(
      (platform.match(/subCountiesOf\(/g) ?? []).length,
      'both facility forms pair the sub-county with the county',
    ).toBe(2);

    expect(
      (platform.match(/county: e\.target\.value,\s*subCounty: ''/g) ?? []).length,
      'changing the county clears the old sub-county on both forms',
    ).toBe(2);
  });
});

describe('The API refuses a pair the forms could not produce', () => {
  it('patients', async () => {
    const app = source('src/app.ts');

    expect(
      app.includes("import { resolveLocation } from './constants/kenya-locations.ts'"),
      'the route uses the same rules as the screens',
    ).toBe(true);

    expect(
      (app.match(/resolveLocation\(body\.county, body\.subCounty\)/g) ?? []).length,
      'both the create and the update route check the pair',
    ).toBe(2);

    expect(
      app.includes("error: 'INVALID_SUB_COUNTY'"),
      'a mismatched pair is a 400 with a named code',
    ).toBe(true);

    expect(
      app.includes('let locationPatch'),
      'a partial update that does not touch the location leaves it alone',
    ).toBe(true);
  });

  it('facilities', async () => {
    const platform = source('src/routes/platform.routes.ts');

    expect(
      platform.includes('resolveLocation(textValue(body.county), textValue(body.subCounty))'),
      'facility creation checks the pair it was given',
    ).toBe(true);

    expect(
      platform.includes('{ county: location.county, subCounty: location.subCounty }'),
      'a facility county is written with its sub-county, so the Westlands default cannot follow a Kisumu county',
    ).toBe(true);
  });
});

describe('Existing records are brought into line by a generated migration', () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8');

  it('generated', async () => {
    /* The file is generated from the constants. If this fails, the .sql is
       stale: run `npm run locations:migration`. */
    expect(
      sql === renderLocationMigration(),
      'the committed migration is exactly what the current constants generate',
    ).toBe(true);
  });

  it('registered', async () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };

    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0023_normalise_county_subcounty',
    );

    expect(entry !== undefined, '0023 is listed in the journal, so the runner will apply it').toBe(
      true,
    );

    if (entry) {
      expect(MIGRATION_PATH.endsWith(`${entry.tag}.sql`), 'the journal tag names this file').toBe(
        true,
      );
      expect(entry.idx, 'the journal index follows 0022').toBe(23);
      expect(
        entry.when > (journal.entries.at(-2)?.when ?? 0),
        'the timestamp is newer than the previous migration, or drizzle would skip it',
      ).toBe(true);
    }
  });

  it('data', async () => {
    /* A SQL literal, spelled the way the generator spells one. Doing this
       here rather than in the template keeps names with an apostrophe -
       Murang'a, Chuka/Igambang'ombe - from needing a special case. */
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

    for (const county of KENYA_COUNTIES) {
      expect(
        sql.includes(`(${literal(county.name.toLowerCase())}, ${literal(county.name)})`),
        `${county.name} is in the county mapping`,
      ).toBe(true);

      for (const subCounty of county.subCounties) {
        expect(
          sql.includes(
            `(${literal(county.name.toLowerCase())}, ${literal(subCounty.toLowerCase())}, ${literal(subCounty)})`,
          ),
          `${subCounty} is mapped to ${county.name}`,
        ).toBe(true);
      }
    }
  });

  it('shape', async () => {
    expect(
      (sql.match(/--> statement-breakpoint/g) ?? []).length,
      'twelve statements: blank handling, spelling and cleanup, for patients and facilities, on both fields',
    ).toBe(11);

    expect(sql.includes('UPDATE "patients"'), 'it updates the patients table').toBe(true);
    expect(sql.includes('UPDATE "facilities"'), 'and the facilities table').toBe(true);
    expect(
      sql.includes('INSERT INTO "audit_logs"'),
      'a cleared sub-county is recorded against the record it came from',
    ).toBe(true);
    expect(
      sql.includes('SET sub_county = NULL'),
      'only the unusable half of the pair is cleared',
    ).toBe(true);
  });

  it('idempotent', async () => {
    /* Every statement matches on a value that the statement itself changes
       to something the WHERE will no longer match. This asserts the shape
       that makes that true, since a live PostgreSQL is not available to this
       suite: no unconditional UPDATE anywhere. */
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) =>
        statement
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/--[^\n]*/g, '')
          .trim(),
      )
      .filter((statement) => statement.length > 0);

    expect(statements.length, 'twelve statements, one per kind of fix').toBe(12);

    for (const [index, statement] of statements.entries()) {
      expect(/WHERE/i.test(statement), `statement ${index + 1} is scoped by a WHERE`).toBe(true);
      expect(
        !/DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN)/i.test(statement),
        `statement ${index + 1} deletes nothing`,
      ).toBe(true);
    }
  });
});
