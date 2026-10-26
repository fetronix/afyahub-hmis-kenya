/**
 * The county/sub-county migration, executed against a real PostgreSQL
 *
 * The generated SQL in `drizzle/0023_normalise_county_subcounty.sql` is the
 * part of this change that can lose data, and a source-text assertion cannot
 * tell you whether twelve UPDATE statements do what their comments say. So
 * this suite runs them.
 *
 * It runs them against TEMP tables that shadow the real ones. PostgreSQL
 * resolves an unqualified - or double-quoted, schema-less - name through
 * search_path, and pg_temp comes first, so `UPDATE "patients"` in this
 * session hits the scratch table and never a real patient. The scratch
 * `audit_logs` shadows the audit table for the same reason: this suite must
 * not write audit entries about a database it did not touch.
 *
 * Everything therefore runs on ONE client borrowed from the pool. A TEMP
 * table belongs to a session, and a pooled query is free to pick another
 * connection - where "patients" would mean the real table again.
 *
 * Skipped when no PostgreSQL is reachable, like every `.db.spec.ts`, and
 * required in CI where the service is provided.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';
import type { PoolClient } from 'pg';

import { describeDb, testPool } from './vitest/support/db.ts';

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'drizzle/0023_normalise_county_subcounty.sql'),
  'utf8',
);

const STATEMENTS = MIGRATION.split('--> statement-breakpoint')
  .map((statement) =>
    statement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim(),
  )
  .filter((statement) => statement.length > 0);

/**
 * Each fixture is a shape the old screens could produce: an exact pair, a
 * case-only difference, an alias, stray spacing, an apostrophe dropped, a
 * sub-county belonging to another county, a county recoverable from the
 * sub-county, one that is not recoverable at all, a county with no
 * sub-county, and the free-text boxes' idea of empty.
 */
const PATIENT_FIXTURES: Array<[string | null, string | null]> = [
  ['Nairobi', 'Westlands'],
  ['nairobi', 'westlands'],
  ['Nairobi City', 'Kasarani'],
  ['  Trans   Nzoia ', '  kiminini'],
  ['Muranga', 'kiharu'],
  ['Nyeri', 'Westlands'],
  [null, 'Kisumu Central'],
  ['Atlantis', 'Nowhere'],
  ['Kisumu', null],
  ['', ''],
];

const EXPECTED_PATIENTS: Array<[string | null, string | null]> = [
  ['Nairobi', 'Westlands'],
  ['Nairobi', 'Westlands'],
  ['Nairobi', 'Kasarani'],
  ['Trans Nzoia', 'Kiminini'],
  ["Murang'a", 'Kiharu'],
  ['Nyeri', null],
  ['Kisumu', 'Kisumu Central'],
  ['Atlantis', null],
  ['Kisumu', null],
  [null, null],
];

type LocationRow = { county: string | null; sub_county: string | null };

async function createScratchTables(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE patients (
      id serial PRIMARY KEY,
      tenant_id integer,
      registration_facility_id integer,
      county text,
      sub_county text
    );
    CREATE TEMP TABLE facilities (
      id serial PRIMARY KEY,
      tenant_id integer,
      county text,
      sub_county text
    );
    CREATE TEMP TABLE audit_logs (
      id serial PRIMARY KEY,
      tenant_id integer,
      facility_id integer,
      action text NOT NULL,
      resource text NOT NULL,
      resource_id text,
      details text,
      timestamp timestamptz DEFAULT now()
    );
  `);
}

async function readLocations(client: PoolClient, table: string) {
  const result = await client.query<LocationRow>(
    `SELECT county, sub_county FROM ${table} ORDER BY id`,
  );

  return result.rows.map((row) => [row.county, row.sub_county]);
}

async function applyMigration(client: PoolClient): Promise<void> {
  for (const statement of STATEMENTS) await client.query(statement);
}

describeDb('County normalisation migration, against a real PostgreSQL', () => {
  it('normalises what it can prove and audits what it clears', async () => {
    const pool = testPool();
    const client = await pool.connect();

    try {
      await createScratchTables(client);

      for (const [county, subCounty] of PATIENT_FIXTURES) {
        await client.query(
          'INSERT INTO patients (tenant_id, registration_facility_id, county, sub_county) VALUES (1, 1, $1, $2)',
          [county, subCounty],
        );
      }

      await client.query(
        "INSERT INTO facilities (tenant_id, county, sub_county) VALUES (1, 'nairobi', 'westlands'), (1, 'Kisumu', 'Westlands'), (1, null, null)",
      );

      await applyMigration(client);

      expect(
        await readLocations(client, 'patients'),
        'each fixture lands on the canonical name, a recovered county, or a cleared sub-county',
      ).toEqual(EXPECTED_PATIENTS);

      expect(
        await readLocations(client, 'facilities'),
        'a facility keeps its county and loses a sub-county from somewhere else',
      ).toEqual([
        ['Nairobi', 'Westlands'],
        ['Kisumu', null],
        [null, null],
      ]);

      const audit = await client.query<{ resource: string; resource_id: string; details: string }>(
        'SELECT resource, resource_id, details FROM audit_logs ORDER BY id',
      );

      expect(
        audit.rows.map((row) => `${row.resource}:${row.resource_id}`).sort(),
        'the three records that lost a sub-county each have one audit entry, nothing more',
      ).toEqual(['Facility:2', 'Patient:6', 'Patient:8']);

      /* Named, not "the first Patient row": an INSERT ... SELECT returns
         rows in whatever order the planner produces, so picking by position
         would make this assertion depend on the query plan. */
      const cleared = audit.rows.find(
        (row) => row.resource === 'Patient' && row.resource_id === '6',
      );

      expect(
        cleared?.details.includes('"Westlands"') === true &&
          cleared.details.includes('"Nyeri"') === true,
        'the entry carries the value that was cleared and the county it did not belong to',
      ).toBe(true);

      /* Second run: nothing matches, nothing is written. A migration that is
         not idempotent would be replayed by hand after a failed deploy. */
      await applyMigration(client);

      expect(await readLocations(client, 'patients'), 'running it twice changes nothing').toEqual(
        EXPECTED_PATIENTS,
      );

      const auditAgain = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM audit_logs',
      );

      expect(auditAgain.rows[0].count, 'and does not write a second audit entry').toBe('3');
    } finally {
      await client.query('DROP TABLE IF EXISTS patients');
      await client.query('DROP TABLE IF EXISTS facilities');
      await client.query('DROP TABLE IF EXISTS audit_logs');
      client.release();
    }
  });
});
