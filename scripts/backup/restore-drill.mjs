#!/usr/bin/env node
/**
 * JaliCare HMIS — restore drill.
 *
 *   npm run db:restore:drill
 *
 * A backup nobody has restored is a file, not a backup. This script takes a real
 * backup of the configured database, restores it into a **separate** database,
 * and then compares every table row-for-row against the source. It never writes
 * to the source and never touches another database; the drill database is
 * dropped afterwards unless `--keep` is passed so the operator can look inside.
 *
 * The comparison is the point. A restore that "completed without errors" and
 * silently dropped an hour of encounters looks identical to a good one until
 * someone queries it. Comparing counts per table catches truncation, and
 * comparing content hashes catches rows landing in the wrong table.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  archiveName,
  describeTarget,
  resolveBackupDir,
  resolveConfig,
  resolveKey,
  sha256,
  writeEncryptedArchive,
  writeManifest,
  applyRetention,
} from './backup-lib.mjs';
import {
  createDatabase,
  dropDatabase,
  dumpLogical,
  dumpWithPgDump,
  findTools,
  restoreLogical,
  restoreWithPgRestore,
} from './engines.mjs';
import { Pool } from 'pg';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function parseArgs(argv) {
  const args = { keep: false, json: false, engine: 'auto' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--keep') args.keep = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--engine') args.engine = next();
  }
  return args;
}

/**
 * Content hash per table, independent of row order.
 *
 * Row counts alone would pass a restore that duplicated one row and lost
 * another. Hashing the ordered serialisation catches that.
 */
async function contentHashes(config) {
  const pool = new Pool({ ...config, max: 2 });
  try {
    const client = await pool.connect();
    try {
      const { rows: tables } = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
      );
      const hashes = {};
      for (const { table_name: table } of tables) {
        const { rows } = await client.query(`SELECT * FROM "${table}"`);
        /* Stable key order: the column order the driver returns is already
           the table's own, which is identical on both sides. */
        const serialised = rows
          .map((row) => JSON.stringify(row))
          .sort()
          .join('\n');
        hashes[table] = { rows: rows.length, sha256: sha256(Buffer.from(serialised, 'utf8')) };
      }
      return hashes;
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Build the drill database's schema by running the repository's migrations. */
function migrate(targetDatabase) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/run-script.mjs'), 'migrate'], {
      cwd: ROOT,
      env: { ...process.env, SQL_DB_NAME: targetDatabase },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const err = [];
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`migrations failed: ${Buffer.concat(err).toString().slice(0, 800)}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = resolveConfig();
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const drillDatabase = `${source.database}_drill_${stamp}`.toLowerCase();
  const dir = resolveBackupDir();

  const tools = await findTools();
  const engine = args.engine === 'auto' ? (tools.pg_dump ? 'pgdump' : 'logical') : args.engine;

  console.log(`drill source   ${describeTarget(source)}`);
  console.log(`drill target   ${drillDatabase}`);
  console.log(`engine         ${engine}`);

  const startedAt = Date.now();
  const before = await contentHashes(source);

  const dump =
    engine === 'pgdump' ? await dumpWithPgDump(source, tools) : await dumpLogical(source);
  const key = await resolveKey();
  const name = archiveName(source.database);
  const { archivePath } = await writeEncryptedArchive(dir, name, dump.payload, key);
  const manifest = {
    formatVersion: 1,
    engine: dump.engine,
    schemaIncluded: dump.schemaIncluded,
    restoreRequires:
      dump.engine === 'logical'
        ? 'Target database must already carry the schema at migrationCount (run npm run db:migrate).'
        : 'Self-contained: restores structure and data.',
    createdAt: new Date().toISOString(),
    database: source.database,
    target: describeTarget(source),
    archive: name,
    storedBytes: 0,
    payloadBytes: dump.payload.length,
    sha256: sha256(dump.payload),
    encrypted: Boolean(key),
    encryption: key ? 'aes-256-gcm' : null,
    tableCount: null,
    rowCount: null,
    migrationCount: null,
    drill: true,
  };
  await writeManifest(archivePath, manifest);
  await applyRetention(dir, { keepCount: 14, keepDays: 30 });

  const target = { ...source, database: drillDatabase };
  let outcome;
  try {
    await createDatabase(target);
    if (engine === 'logical') await migrate(drillDatabase);

    if (engine === 'pgdump') await restoreWithPgRestore(target, dump.payload, tools);
    else await restoreLogical(target, dump.payload);

    const after = await contentHashes(target);

    /* Compare only the tables the source actually has: a restore may create
       fewer objects, never extra ones with different names. */
    const mismatches = [];
    for (const [table, expected] of Object.entries(before)) {
      const actual = after[table];
      if (!actual) {
        mismatches.push({ table, problem: 'missing after restore', expected, actual: null });
      } else if (actual.sha256 !== expected.sha256 || actual.rows !== expected.rows) {
        mismatches.push({ table, problem: 'content differs', expected, actual });
      }
    }

    const sourceRows = Object.values(before).reduce((sum, entry) => sum + entry.rows, 0);
    const restoredRows = Object.values(after).reduce((sum, entry) => sum + entry.rows, 0);

    outcome = {
      ok: mismatches.length === 0,
      engine,
      archivePath,
      sourceDatabase: source.database,
      drillDatabase,
      tablesCompared: Object.keys(before).length,
      sourceRows,
      restoredRows,
      mismatches: mismatches.slice(0, 20),
      mismatchCount: mismatches.length,
      durationMs: Date.now() - startedAt,
      kept: args.keep,
    };
  } finally {
    if (!args.keep) await dropDatabase(target).catch(() => undefined);
  }

  if (args.json) console.log(JSON.stringify(outcome, null, 2));
  else {
    console.log(`\ndrill ${outcome.ok ? 'PASSED' : 'FAILED'}`);
    console.log(`  tables compared  ${outcome.tablesCompared}`);
    console.log(`  rows (source)    ${outcome.sourceRows}`);
    console.log(`  rows (restored)  ${outcome.restoredRows}`);
    console.log(`  duration         ${outcome.durationMs}ms`);
    if (!outcome.ok) {
      console.log(`  mismatches       ${outcome.mismatchCount}`);
      for (const mismatch of outcome.mismatches.slice(0, 10))
        console.log(`    - ${mismatch.table}: ${mismatch.problem}`);
    }
    console.log(`  drill database   ${args.keep ? drillDatabase : 'dropped'}`);
    console.log(`  archive kept     ${archivePath}`);
  }

  if (!outcome.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`drill FAILED: ${error.message}`);
  process.exitCode = 1;
});
