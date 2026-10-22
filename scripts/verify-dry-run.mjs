#!/usr/bin/env node
/**
 * JaliCare HMIS
 * Prove that `--dry-run` writes nothing, without a database.
 *
 * This runs the BUILT migration runner against a fake `pg` driver that
 * records every statement it is asked to execute. If the runner issues
 * anything other than SELECT, the command fails.
 *
 * It is the executable form of the requirement, and it catches the exact
 * regression that was reported on the host: the runner used to create
 * `drizzle.__drizzle_migrations` before it looked at `--dry-run`, so a
 * read-only status command left a table behind in production.
 *
 *   npm run build:server
 *   node scripts/verify-dry-run.mjs
 *
 * Exits 0 when the dry run is clean, 1 otherwise.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = resolve(ROOT, 'build/scripts/migrate.js');
const PROXY = resolve(ROOT, '.verify-dry-run-pg.mjs');
const JOURNAL = resolve(ROOT, '.verify-dry-run-statements.json');

if (!existsSync(BUNDLE)) {
  console.error('build/scripts/migrate.js is missing. Run `npm run build:server` first.');
  process.exit(1);
}

/**
 * A pg driver that answers the runner's introspection queries and records
 * everything else. `empty` controls whether the tracking table is present;
 * both paths must be write-free.
 */
const FAKE_PG = `
const log = () => globalThis.__JALICARE_SQL__;
const mode = globalThis.__JALICARE_MODE__;

function handle(text) {
  const sql = typeof text === 'string' ? text : text?.text ?? '';
  log().push(sql);

  if (/^\\s*SELECT\\s+1/i.test(sql)) return { rows: [{}] };

  if (/pg_class/i.test(sql)) {
    return { rows: mode === 'empty' ? [] : [{ schema: 'drizzle', table: '__drizzle_migrations' }] };
  }

  if (/information_schema\\.columns/i.test(sql)) {
    return { rows: mode === 'empty' ? [] : [{ column_name: 'hash' }, { column_name: 'created_at' }] };
  }

  if (/COUNT\\(\\*\\)/i.test(sql)) {
    return { rows: [{ count: mode === 'empty' ? '0' : '84' }] };
  }

  if (/created_at/i.test(sql)) {
    return { rows: mode === 'empty' ? [] : [{ hash: 'recorded', created_at: 1 }] };
  }

  return { rows: [] };
}

class FakeClient {
  async query(text) { return handle(text); }
  release() {}
}

export class Pool {
  async query(text) { return handle(text); }
  async connect() { return new FakeClient(); }
  async end() {}
}

export default { Pool };
`;

const MODES = ['empty', 'populated'];

function isWrite(sql) {
  const text = String(sql).trim();

  return /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|SET\s)/i.test(
    text,
  );
}

let failures = 0;

for (const mode of MODES) {
  globalThis.__JALICARE_SQL__ = [];
  globalThis.__JALICARE_MODE__ = mode;

  /* First run: install the module hook that swaps `pg` for the fake. */
  if (!existsSync(PROXY)) {
    await import('node:fs').then(({ writeFileSync }) => writeFileSync(PROXY, FAKE_PG));
  } else {
    const { writeFileSync } = await import('node:fs');

    writeFileSync(PROXY, FAKE_PG);
  }

  if (!globalThis.__JALICARE_HOOKED__) {
    register(
      'data:text/javascript,' +
        encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'pg') {
    return { url: ${JSON.stringify(pathToFileURL(PROXY).href)}, shortCircuit: true };
  }
  return next(specifier, context);
}
`),
    );

    globalThis.__JALICARE_HOOKED__ = true;
  }

  process.argv.push('--dry-run');

  try {
    /* The runner starts main() without awaiting it; give it time to finish. */
    await import(`${pathToFileURL(BUNDLE).href}?mode=${mode}`);
    await new Promise((done) => setTimeout(done, 4_000));
  } catch (error) {
    console.error(`\n${mode}: the runner threw.`);
    console.error(error);
    failures += 1;
    continue;
  }

  const statements = globalThis.__JALICARE_SQL__;
  const writes = statements.filter(isWrite);

  console.log('');
  console.log(`[${mode}] ${statements.length} statement(s) sent, ${writes.length} write(s)`);

  for (const write of writes) {
    console.error(`  WRITE: ${String(write).replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  if (writes.length > 0) {
    failures += 1;
  }
}

for (const file of [PROXY, JOURNAL]) {
  rmSync(file, { force: true });
}

if (failures > 0) {
  console.error('');
  console.error('FAILED: --dry-run wrote to the database.');
  process.exit(1);
}

console.log('');
console.log('PASSED: --dry-run issued no write statement against either database shape.');
