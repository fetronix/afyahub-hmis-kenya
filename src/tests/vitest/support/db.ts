/**
 * PostgreSQL-backed integration specs
 *
 * A *.db.spec.ts file calls `describeDb()` instead of `describe()`. The
 * availability decision happens once in global-setup.ts, which probes the
 * server before any file is collected; this module only reads the result.
 *
 * Without a database the suite is skipped with a message naming the
 * address it tried, so a laptop without PostgreSQL still gets a meaningful
 * result. CI provides the postgres:16 service and sets
 * JALICARE_REQUIRE_DB=1, which turns a skip into a failure — in CI a skip
 * means the service did not come up, and that must not pass silently.
 */

import { afterAll, describe } from 'vitest';
import { Pool } from 'pg';

export const dbIsAvailable = (): boolean => process.env.JALICARE_DB_AVAILABLE === '1';

export const dbIsRequired = (): boolean => process.env.JALICARE_REQUIRE_DB === '1';

function connectionConfig() {
  return {
    host: process.env.SQL_HOST ?? '127.0.0.1',
    port: Number(process.env.SQL_PORT ?? 5432),
    database: process.env.SQL_DB_NAME ?? 'jalicare_test',
    user: process.env.SQL_ADMIN_USER ?? 'jalicare_test',
    password: process.env.SQL_ADMIN_PASSWORD ?? 'jalicare_test',
    ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5_000,
    max: 4,
  };
}

/** A pool scoped to the suite, closed automatically. */
export function testPool(): Pool {
  const pool = new Pool(connectionConfig());

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  return pool;
}

/**
 * `describe` for suites that need PostgreSQL.
 *
 * When a database is required but absent, the suite contains one failing
 * assertion rather than being silently skipped: a green run that tested
 * nothing is worse than a red one that says why.
 */
export function describeDb(name: string, fn: () => void): void {
  if (dbIsAvailable()) {
    describe(name, fn);
    return;
  }

  const address = `${process.env.SQL_HOST ?? '127.0.0.1'}:${process.env.SQL_PORT ?? '5432'}`;

  if (dbIsRequired()) {
    describe(name, () => {
      throw new Error(
        `JALICARE_REQUIRE_DB=1, but no PostgreSQL answered on ${address}. ` +
          'The postgres service must be healthy before these specs run.',
      );
    });

    return;
  }

  describe.skip(`${name} [skipped: no PostgreSQL on ${address}]`, fn);
}
