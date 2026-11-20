/**
 * Vitest global setup — decides, once, whether PostgreSQL is available.
 *
 * `describe` has to make its skip decision synchronously at collection
 * time, and a TCP connect cannot be synchronous. Probing here runs before
 * any spec is collected, so every file reads a plain flag instead of each
 * one racing its own connection attempt.
 *
 * The result is exported through the environment because setup and spec
 * files are separate module graphs.
 */

import { Pool } from 'pg';

export default async function setup(): Promise<void> {
  const host = process.env.SQL_HOST ?? '127.0.0.1';
  const port = Number(process.env.SQL_PORT ?? 5432);

  const pool = new Pool({
    host,
    port,
    database: process.env.SQL_DB_NAME ?? 'syrona_test',
    user: process.env.SQL_ADMIN_USER ?? 'syrona_test',
    password: process.env.SQL_ADMIN_PASSWORD ?? 'syrona_test',
    connectionTimeoutMillis: 3_000,
    max: 2,
  });

  let available = false;

  try {
    await pool.query('SELECT 1');
    available = true;
  } catch {
    available = false;
  } finally {
    await pool.end().catch(() => undefined);
  }

  process.env.SYRONA_DB_AVAILABLE = available ? '1' : '0';

  if (!available) {
    const required = process.env.SYRONA_REQUIRE_DB === '1';

    console.info(
      required
        ? `[vitest] PostgreSQL NOT reachable at ${host}:${port} — SYRONA_REQUIRE_DB=1, database specs will FAIL.`
        : `[vitest] PostgreSQL not reachable at ${host}:${port} — database specs will be skipped.`,
    );
  }
}
