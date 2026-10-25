/**
 * Migration integrity, against a real PostgreSQL
 *
 * This is the check that did not exist before: the repository's migration
 * tests read files and compare text, but nothing ever proved that the
 * journal actually applies to an empty PostgreSQL 16, that the tracking
 * table afterwards agrees with the journal, or that a second run is a no-op.
 *
 * The runner is executed as a child process exactly as an operator would run
 * it, so the test covers argument parsing, the environment gate and the exit
 * code, not just the library functions.
 *
 * Safety: this file only ever writes to the database named by SQL_DB_NAME,
 * which in CI is `jalicare_test` on a throwaway service container. It refuses
 * to run against a database whose name does not contain `test`, so a
 * misconfigured local .env cannot point it at a real installation.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { describeDb, testPool } from './support/db.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

function databaseName(): string {
  return process.env.SQL_DB_NAME ?? 'jalicare_test';
}

function run(script: string, args: string[] = []): { code: number; out: string } {
  try {
    const out = execFileSync('node', ['scripts/run-script.mjs', script, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: process.env,
    });

    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };

    return {
      code: failure.status ?? 1,
      out: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

describeDb('migrations against a real PostgreSQL 16', () => {
  beforeAll(() => {
    if (!databaseName().includes('test')) {
      throw new Error(
        `Refusing to run migration specs against "${databaseName()}": the database name must contain "test".`,
      );
    }
  });

  it('applies every journal entry to an empty database', () => {
    const result = run('migrate', ['--yes']);

    expect(result.out, result.out).toMatch(/Applied \d+ migration\(s\)|up to date/i);
    expect(result.code).toBe(0);
  });

  it('records one tracking row per journal entry', async () => {
    const pool = testPool();

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations',
    );

    /* The journal is the source of truth, not a hard-coded 23. */
    const { readJournal } = await import('../../../scripts/migration-journal.ts');
    const { migrationsDirectory } = await import('../../../scripts/migration-journal.ts');

    expect(Number(rows[0]?.count)).toBe(readJournal(migrationsDirectory()).length);
  });

  it('has every table the billing engine needs', async () => {
    const pool = testPool();

    const expected = [
      'patients',
      'encounters',
      'billing_invoices',
      'billing_items',
      'facility_service_tariffs',
      'service_tariff_links',
      'billing_charge_attempts',
      'audit_logs',
    ];

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );

    const present = new Set(rows.map((row) => row.table_name));

    for (const table of expected) {
      expect(present.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it('reports a clean status once applied', () => {
    const result = run('migration-status');

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Pending\s*:\s*0/);
  });

  it('is idempotent: a second run applies nothing', () => {
    const result = run('migrate', ['--yes']);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/up to date|nothing to apply/i);
  });

  it('keeps dry-run read-only on a fully migrated database', () => {
    const result = run('migrate', ['--dry-run']);
    const status = run('migration-status');

    expect(result.code).toBe(0);
    expect(status.out).toMatch(/Pending\s*:\s*0/);
  });
});
