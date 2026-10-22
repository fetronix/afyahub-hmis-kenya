/**
 * JaliCare HMIS
 * Database preflight — read-only, safe against production
 *
 * Run this before any migration on a live database. It answers, without
 * writing anything (no CREATE, no INSERT, no temp table):
 *
 *   1. Which database is this really? (host, port, database, role,
 *      server address, server version)
 *   2. What is already in it? (public tables, approximate row counts)
 *   3. Is migration history recorded, and where?
 *   4. What does the journal still owe, and which of those are
 *      destructive?
 *   5. Does a backup exist that you can name?
 *   6. Verdict: safe to plan, or stop.
 *
 * It never creates the tracking table. That is the difference between a
 * check and an act: `migrate.ts --dry-run` must leave a database exactly
 * as it found it, including on a first run where the table is absent.
 *
 *   npm run db:preflight
 *   npm run db:preflight -- --backup=C:\backups\jalicare-2026-10-22.dump
 *
 * Exit codes: 0 = no blocking issue, 1 = blocking issue, 2 = config.
 */

import type { Pool } from 'pg';

import {
  classifyMigrations,
  isLocalDatabaseHost,
  migrationsDirectory,
  readJournal,
  readPlans,
  scanDestructiveStatements,
  type MigrationPlan,
} from './migration-journal.ts';

const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

const backupArg = process.argv
  .slice(2)
  .find((argument) => argument.startsWith('--backup='));

const backupPath = backupArg ? backupArg.slice('--backup='.length) : null;

const blocking: string[] = [];
const warnings: string[] = [];

function line(): void {
  console.log('==============================================');
}

function section(title: string): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function block(reason: string): void {
  blocking.push(reason);
  console.log(`  ${RED}✖ ${reason}${RESET}`);
}

function warn(reason: string): void {
  warnings.push(reason);
  console.log(`  ${YELLOW}! ${reason}${RESET}`);
}

function ok(message: string): void {
  console.log(`  ${GREEN}✓${RESET} ${message}`);
}

interface TrackingTable {
  qualified: string;
  schema: string;
  table: string;
  hasHash: boolean;
  hasCreatedAt: boolean;
}

async function findTrackingTable(pool: Pool): Promise<TrackingTable | null> {
  const { rows } = await pool.query<{ schema: string; table: string }>(
    `SELECT n.nspname AS schema, c.relname AS "table"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = '__drizzle_migrations'
        AND c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY CASE WHEN n.nspname = 'drizzle' THEN 0
                    WHEN n.nspname = 'public' THEN 1
                    ELSE 2 END`,
  );

  const found = rows[0];
  if (!found) return null;

  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2`,
    [found.schema, found.table],
  );

  const names = new Set(columns.rows.map((row) => row.column_name));

  return {
    qualified: `"${found.schema}"."${found.table}"`,
    schema: found.schema,
    table: found.table,
    hasHash: names.has('hash'),
    hasCreatedAt: names.has('created_at'),
  };
}

/**
 * Tables a pending migration is about to create.
 *
 * If one of them already exists, the database is ahead of its recorded
 * history and the migration will fail on "relation already exists" — or,
 * worse, succeed halfway. That is a conflict worth naming before it runs.
 */
function createdTables(plan: MigrationPlan): string[] {
  const tables: string[] = [];

  for (const statement of plan.statements) {
    const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(statement)) !== null) {
      tables.push(match[1]);
    }
  }

  return tables;
}

async function main(): Promise<void> {
  console.log('');
  line();
  console.log('JaliCare HMIS — database preflight (read-only)');
  line();

  let pool: Pool;
  let env: {
    database: { host: string; port: number; name: string; user: string };
  };

  try {
    const dbModule = await import('../src/db/index.ts');
    const envModule = await import('../src/config/env.ts');

    pool = dbModule.pool;
    env = envModule.env;
  } catch (error) {
    console.error('');
    console.error(`${RED}Cannot read the database configuration.${RESET}`);
    console.error('  SQL_HOST  SQL_PORT  SQL_DB_NAME  SQL_ADMIN_USER  SQL_ADMIN_PASSWORD');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  /* ---------------- 1. Which database is this? ---------------- */

  section('1. Target');

  console.log(`  Configured : ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`);

  try {
    const { rows } = await pool.query<{
      database: string;
      role: string;
      address: string | null;
      version: string;
      connections: string;
    }>(
      `SELECT current_database() AS database,
              current_user AS role,
              COALESCE(inet_server_addr()::text, 'local socket') AS address,
              version() AS version,
              (SELECT COUNT(*)::text FROM pg_stat_activity) AS connections`,
    );

    const row = rows[0];

    /*
     * The identity query always returns a row on a real PostgreSQL, but
     * a pooler or a proxy in front of it can answer with none. Saying so
     * is better than a TypeError on `row.version` that looks like a bug
     * in this script.
     */
    if (!row) {
      block('The server answered the identity query with no rows. Check SQL_HOST and any connection pooler in front of PostgreSQL.');

      return;
    }

    console.log(`  Actually   : ${row.role}@${row.address}/${row.database}`);
    console.log(`  Version    : ${String(row.version ?? 'unknown').split(',')[0]}`);
    console.log(`  Sessions   : ${row.connections} connection(s) on this server`);

    if (row.database !== env.database.name) {
      block(`Connected database "${row.database}" is not SQL_DB_NAME "${env.database.name}".`);
    } else {
      ok('The connected database is the one configured.');
    }
  } catch (error) {
    const detail = error as { code?: string; message?: string };
    block(`Cannot query the database (${detail.code ?? 'unknown'}): ${detail.message ?? ''}`);
    await pool.end();
    process.exit(1);
  }

  /* ---------------- 2. What is already here? ---------------- */

  section('2. Existing objects (read-only)');

  const tables = await pool.query<{ table_name: string; rows: string }>(
    `SELECT c.relname AS table_name,
            GREATEST(c.reltuples, 0)::bigint::text AS rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> '__drizzle_migrations'
      ORDER BY c.reltuples DESC, c.relname`,
  );

  console.log(`  Public tables: ${tables.rows.length}`);

  for (const table of tables.rows.slice(0, 12)) {
    console.log(`    ${table.table_name.padEnd(32)} ~${TableRows(table.rows)} row(s)`);
  }

  if (tables.rows.length > 12) {
    console.log(`    … ${tables.rows.length - 12} more`);
  }

  /* ---------------- 3. Migration history ---------------- */

  section('3. Migration history');

  const tracking = await findTrackingTable(pool);

  if (tracking) {
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${tracking.qualified}`,
    );

    ok(`${tracking.qualified} exists (${count.rows[0]?.count ?? 0} row(s))`);
    console.log(`    hash column: ${tracking.hasHash}; created_at column: ${tracking.hasCreatedAt}`);

    if (!tracking.hasHash) {
      warn('The tracking table has no hash column; matching falls back to timestamps only.');
    }
  } else {
    console.log(`  ${YELLOW}no tracking table${RESET}`);

    if (tables.rows.length > 0) {
      block(
        `Unmanaged database: ${tables.rows.length} public table(s) but no history. A full replay would run destructive SQL (0002 drops patients.facility_id).`,
      );
    } else {
      ok('No tables and no history — a fresh database. A full migration is appropriate.');
    }
  }

  /* ---------------- 4. Pending plan ---------------- */

  section('4. Pending migrations');

  const dir = migrationsDirectory();
  let plans: MigrationPlan[] = [];

  try {
    plans = readPlans(readJournal(dir), dir);
  } catch (error) {
    block(`Cannot read the journal: ${error instanceof Error ? error.message : String(error)}`);
  }

  const appliedRows = tracking
    ? await pool.query<{ hash: string | null; created_at: string | null }>(
        `SELECT ${tracking.hasHash ? 'hash' : 'NULL::text AS hash'}, ${
          tracking.hasCreatedAt ? 'created_at' : 'NULL::bigint AS created_at'
        } FROM ${tracking.qualified}`,
      )
    : { rows: [] as Array<{ hash: string | null; created_at: string | null }> };

  const classification = classifyMigrations(
    plans,
    appliedRows.rows.map((row) => ({
      hash: row.hash,
      createdAt: row.created_at === null ? null : Number(row.created_at),
    })),
  );

  console.log(`  Journal: ${plans.length} migration(s)`);
  console.log(`  Applied: ${classification.applied.length}`);
  console.log(`  Pending: ${classification.pending.length}`);

  /*
   * History that matches nothing in this journal. The runner refuses in
   * this state (see scripts/migrate.ts); preflight must say the same
   * thing, or the operator reads "PENDING: 23" here and assumes the
   * runner will simply apply them.
   */
  if (tracking && appliedRows.rows.length > 0 && classification.applied.length === 0) {
    block(
      `${appliedRows.rows.length} recorded migration(s) match nothing in this journal. Applying would replay the whole journal, including 0002's DROP COLUMN on patients. Reconcile the journal before migrating.`,
    );
  }

  for (const plan of classification.pending) {
    console.log(`    • ${plan.tag} (${plan.statements.length} statement(s))`);
  }

  if (classification.editedAfterApply.length > 0) {
    warn(
      `${classification.editedAfterApply.length} applied migration(s) changed on disk: ${classification.editedAfterApply
        .map((plan) => plan.tag)
        .join(', ')}`,
    );
  }

  if (classification.behindNewest.length > 0) {
    warn(
      `${classification.behindNewest.length} pending migration(s) are older than the newest recorded row: ${classification.behindNewest
        .map((plan) => plan.tag)
        .join(', ')}`,
    );
  }

  /* ---------------- 5. Conflicts ---------------- */

  section('5. Conflicts');

  const existing = new Set(tables.rows.map((table) => table.table_name));
  const conflicts: string[] = [];

  for (const plan of classification.pending) {
    for (const table of createdTables(plan)) {
      if (existing.has(table)) {
        conflicts.push(`${plan.tag} creates "${table}", which already exists`);
      }
    }
  }

  if (conflicts.length === 0) {
    ok('No pending migration creates a table that already exists.');
  } else {
    for (const conflict of conflicts) {
      warn(conflict);
    }
  }

  /* ---------------- 6. Destructive SQL ---------------- */

  section('6. Destructive statements');

  const destructive = scanDestructiveStatements(classification.pending);

  if (destructive.length === 0) {
    ok('No destructive statement in the pending set.');
  } else {
    for (const finding of destructive) {
      console.log(
        `  ${YELLOW}!${RESET} ${finding.tag} #${finding.statementIndex}  ${finding.label}` +
          (finding.conditional ? `${DIM} (IF EXISTS)${RESET}` : ''),
      );
      console.log(`    ${DIM}${finding.preview}${RESET}`);
    }
  }

  /* ---------------- 7. Backup ---------------- */

  section('7. Backup');

  if (backupPath) {
    const { existsSync, statSync } = await import('node:fs');

    if (!existsSync(backupPath)) {
      block(`No file at --backup=${backupPath}`);
    } else {
      const size = statSync(backupPath).size;

      if (size === 0) {
        block(`The backup file is empty: ${backupPath}`);
      } else {
        ok(`Backup present: ${backupPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      }
    }
  } else if (isLocalDatabaseHost(env.database.host)) {
    warn('No --backup given. Acceptable on a local database; not on production.');
  } else {
    console.log(`  ${YELLOW}No --backup given.${RESET}`);
    console.log('');
    console.log('  Take a verified dump before migrating, and name it next run:');
    console.log('    pg_dump -Fc -f jalicare-2026-10-22.dump "$SQL_DB_NAME"');
    console.log('    npm run db:preflight -- --backup=jalicare-2026-10-22.dump');
    console.log('');
    console.log('  Without a backup this preflight will not call the target ready.');
    blocking.push('No verified backup was named.');
  }

  /* ---------------- Verdict ---------------- */

  console.log('');
  line();

  if (blocking.length > 0) {
    console.log(`${RED}NOT READY — ${blocking.length} blocking issue(s):${RESET}`);
    for (const reason of blocking) {
      console.log(`  - ${reason}`);
    }
    line();
    console.log('');
    await pool.end();
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`${YELLOW}READY WITH WARNINGS — ${warnings.length}:${RESET}`);
    for (const reason of warnings) {
      console.log(`  - ${reason}`);
    }
  } else {
    console.log(`${GREEN}READY — no blocking issue found.${RESET}`);
  }

  line();
  console.log('');
  console.log('Nothing was changed. Next step, only after reading this:');
  console.log('  npm run db:migrate:dry        plan again, still read-only');
  console.log('  npm run db:migrate -- --yes   apply');
  console.log('');

  await pool.end();
}

function TableRows(value: string): string {
  const number = Number(value);

  if (!Number.isFinite(number)) return '?';
  if (number >= 1000) return `${Math.round(number / 1000)}k`;

  return String(Math.round(number));
}

main().catch(async (error) => {
  console.error('');
  console.error(`${RED}Preflight failed.${RESET}`);
  console.error(error);
  process.exit(1);
});
