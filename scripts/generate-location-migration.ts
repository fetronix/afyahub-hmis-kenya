/**
 * JaliCare HMIS
 * Generate the county/sub-county normalisation migration from the constants
 *
 * WHY THIS EXISTS
 * ---------------
 * `drizzle/0023_normalise_county_subcounty.sql` has to know all 47 county
 * names and all 290 sub-county names, in SQL. Typing those by hand would
 * guarantee a typo somewhere in eight hundred VALUES rows, and a typo in a
 * data migration is silent: the row it fails to match simply keeps the value
 * it had, and nobody finds out until a report is wrong.
 *
 * So the list is not typed by hand. It is emitted from
 * `src/constants/kenya-locations.ts`, which is also what the two forms and
 * the write-path validation read. `src/tests/kenya-locations.spec.ts`
 * re-runs the renderer and asserts the file on disk is identical, so the
 * migration cannot drift from the dropdowns.
 *
 *   npm run locations:migration        # rewrite the .sql file
 *
 * The output is committed. Run this after editing the constants; the test
 * fails until you do.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { COUNTY_ALIASES, KENYA_COUNTIES } from '../src/constants/kenya-locations.ts';

export const MIGRATION_PATH = 'drizzle/0023_normalise_county_subcounty.sql';

/** How both sides of a comparison are spelled: case- and space-insensitive. */
function normalise(column: string): string {
  return `lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`;
}

/** A single-quoted SQL string literal. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A `VALUES` list of rows, ready to sit inside `FROM (VALUES …) AS v(…)`. */
function values(rows: string[][]): string {
  return rows.map((row) => `    (${row.map(literal).join(', ')})`).join(',\n');
}

/** county comparison key -> canonical county name. */
function countyRows(): string[][] {
  const rows = new Map<string, string>();

  for (const county of KENYA_COUNTIES) rows.set(county.name.toLowerCase(), county.name);

  for (const [alias, canonical] of Object.entries(COUNTY_ALIASES)) {
    rows.set(alias.toLowerCase(), canonical);
  }

  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** (county, sub-county, canonical sub-county); the first two are lowercased. */
function pairRows(): string[][] {
  return KENYA_COUNTIES.flatMap((county) =>
    county.subCounties.map((subCounty) => [
      county.name.toLowerCase(),
      subCounty.toLowerCase(),
      subCounty,
    ]),
  );
}

/**
 * Sub-counties that belong to exactly one county.
 *
 * Only these can repair a blank or unrecognised county: a name two counties
 * share says nothing about which one the record meant.
 */
function uniqueSubCountyRows(): string[][] {
  const owners = new Map<string, string[]>();

  for (const county of KENYA_COUNTIES) {
    for (const subCounty of county.subCounties) {
      const key = subCounty.toLowerCase();

      owners.set(key, [...(owners.get(key) ?? []), county.name]);
    }
  }

  return [...owners.entries()]
    .filter(([, counties]) => counties.length === 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subCounty, counties]) => [subCounty, counties[0]]);
}

const COUNTY_VALUES = (alias: string): string => `(
  VALUES
${values(countyRows())}
) AS ${alias}(alias, canonical)`;

const PAIR_VALUES = (alias: string): string => `(
  VALUES
${values(pairRows())}
) AS ${alias}(county, sub_county, canonical)`;

const UNIQUE_VALUES = `(
  VALUES
${values(uniqueSubCountyRows())}
) AS v(sub_county, county)`;

/**
 * Statements 1-2: an empty string is not a place.
 *
 * The free-text boxes sent '' when they were left alone, and the column
 * accepts it, so some rows carry a blank where they mean "not recorded".
 * Sameness matters here: a report that counts "no county" has to ask one
 * question, not two. Done first, so a blank sub-county is nulled rather than
 * audited as a mismatch.
 */
function blankToNull(table: string): string {
  return `UPDATE "${table}" AS target
SET county = NULL
WHERE target.county IS NOT NULL
  AND btrim(target.county) = '';`;
}

function blankSubCountyToNull(table: string): string {
  return `UPDATE "${table}" AS target
SET sub_county = NULL
WHERE target.sub_county IS NOT NULL
  AND btrim(target.sub_county) = '';`;
}

/** Statements 3-4: county spelling. */
function countySpelling(table: string): string {
  return `UPDATE "${table}" AS target
SET county = v.canonical
FROM ${COUNTY_VALUES('v')}
WHERE target.county IS NOT NULL
  AND ${normalise('target.county')} = v.alias;`;
}

/** Statements 3-4: sub-county spelling, inside its own county only. */
function subCountySpelling(table: string): string {
  return `UPDATE "${table}" AS target
SET sub_county = v.canonical
FROM ${PAIR_VALUES('v')}
WHERE target.sub_county IS NOT NULL
  AND target.county IS NOT NULL
  AND ${normalise('target.county')} = v.county
  AND ${normalise('target.sub_county')} = v.sub_county;`;
}

/** Statements 5-6: recover a county from an unambiguous sub-county. */
function countyRecovery(table: string): string {
  return `UPDATE "${table}" AS target
SET county = v.county
FROM ${UNIQUE_VALUES}
WHERE target.sub_county IS NOT NULL
  AND ${normalise('target.sub_county')} = v.sub_county
  AND NOT EXISTS (
    SELECT 1
    FROM ${COUNTY_VALUES('known')}
    WHERE ${normalise('target.county')} = known.alias
  );`;
}

/**
 * Statements 7-8: clear a sub-county that is not in its county, auditing the
 * old value in the same statement.
 *
 * Both CTEs read the same snapshot and the INSERT runs to completion whether
 * or not the final UPDATE mentions it, so the audit entry carries the value
 * that was overwritten rather than the NULL that replaced it - and the entry
 * and the cleared row cannot disagree.
 */
function clearOrphans(
  table: string,
  resource: string,
  facilityId: 'registration_facility_id' | 'id',
): string {
  const selected =
    facilityId === 'id'
      ? 'record.tenant_id,\n         record.county,'
      : 'record.tenant_id,\n         record.registration_facility_id,\n         record.county,';

  return `WITH doomed AS (
  SELECT record.id,
         ${selected}
         record.sub_county
  FROM "${table}" AS record
  WHERE record.sub_county IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ${PAIR_VALUES('v')}
      WHERE ${normalise('record.county')} = v.county
        AND ${normalise('record.sub_county')} = v.sub_county
    )
), audited AS (
  INSERT INTO "audit_logs" (tenant_id, facility_id, action, resource, resource_id, details)
  SELECT doomed.tenant_id,
         doomed.${facilityId},
         'UPDATE',
         '${resource}',
         doomed.id::text,
         'Location cleanup (0023): sub-county "'
           || doomed.sub_county
           || '" does not belong to county '
           || coalesce('"' || doomed.county || '"', '(none)')
           || '; sub-county cleared. The previous value is in this entry.'
  FROM doomed
  RETURNING 1
)
UPDATE "${table}" AS target
SET sub_county = NULL
FROM doomed
WHERE target.id = doomed.id;`;
}

/**
 * The migration.
 *
 * Statements, in this order, and the order is the point:
 *
 *   1-4. an empty string becomes NULL, so "not recorded" is asked once;
 *   5-6. spelling of county, patients then facilities;
 *   7-8. spelling of sub-county, where it belongs to the county it is stored
 *        with - a sub-county of another county is never "corrected" here,
 *        because guessing which of the two fields is wrong is not this
 *        migration's job;
 *   9-10. county recovered from a sub-county only one county owns, for rows
 *        whose county was blank or never a county name;
 *   11-12. sub-counties still not in their county are cleared, with the old
 *        value written to audit_logs first.
 *
 * Every statement is idempotent: after the first run nothing matches. No
 * table, column or row is deleted.
 */
export function renderLocationMigration(): string {
  return `/*
 * 0023_normalise_county_subcounty.sql
 *
 * GENERATED FILE - do not edit by hand.
 *   npm run locations:migration
 * Source of truth: src/constants/kenya-locations.ts
 *
 * WHY
 * ---
 * County was a ten-item dropdown and sub-county was a free-text box, so the
 * same county could be stored as "Nairobi", "nairobi" or "Nairobi City", and
 * a sub-county could name a county the patient does not live in. The forms
 * now offer one list; this brings the rows already stored into line with it.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It does not invent a county it cannot prove, and it does not guess which
 * side of a contradictory pair is wrong. Where a sub-county cannot belong to
 * the county stored with it, the sub-county is cleared and the old value is
 * written to audit_logs against the patient or facility, so the change is
 * visible and recoverable rather than silent.
 *
 * Statements are idempotent and none are destructive to the schema.
 */

/* 1-2. An empty string is not a place: blank becomes NULL. Patients. */
${blankToNull('patients')}--> statement-breakpoint

${blankSubCountyToNull('patients')}--> statement-breakpoint

/* 3-4. The same for facilities. */
${blankToNull('facilities')}--> statement-breakpoint

${blankSubCountyToNull('facilities')}--> statement-breakpoint

/* 5. County: same name, canonical spelling. Patients. */
${countySpelling('patients')}--> statement-breakpoint

/* 6. County: same name, canonical spelling. Facilities. */
${countySpelling('facilities')}--> statement-breakpoint

/* 7. Sub-county: canonical spelling, but only inside its own county.
      Patients. */
${subCountySpelling('patients')}--> statement-breakpoint

/* 8. Sub-county: canonical spelling, but only inside its own county.
      Facilities. */
${subCountySpelling('facilities')}--> statement-breakpoint

/* 9. County missing or unrecognised, but the sub-county belongs to exactly
      one county: adopt it. Ambiguous sub-county names are left alone.
      Patients. */
${countyRecovery('patients')}--> statement-breakpoint

/* 10. Same recovery for facilities. */
${countyRecovery('facilities')}--> statement-breakpoint

/* 11. Sub-county that is not in its county: audit the old value, then clear
       it. Patients. */
${clearOrphans('patients', 'Patient', 'registration_facility_id')}--> statement-breakpoint

/* 12. Same cleanup for facilities. */
${clearOrphans('facilities', 'Facility', 'id')}
`;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const target = resolve(process.cwd(), MIGRATION_PATH);

  writeFileSync(target, renderLocationMigration(), 'utf8');

  console.log(`Wrote ${MIGRATION_PATH}`);
}
