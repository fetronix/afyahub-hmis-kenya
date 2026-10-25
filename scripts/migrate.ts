/**
 * JaliCare HMIS
 * Deterministic migration runner
 *
 * WHY THIS EXISTS
 * ---------------
 * `drizzle-kit migrate` renders a spinner and calls `process.exit()` from
 * inside its error handler, so when a migration fails the Postgres error
 * is never printed. On Windows the spinner is not even visible: the
 * command appears to succeed and do nothing, and the next status check
 * still says PENDING.
 *
 * This runner applies the same journal entries, writes the same tracking
 * rows, and prints:
 *
 *   - the plan, before touching anything (`--dry-run`)
 *   - which migration and which statement failed
 *   - the Postgres error code, detail and hint
 *
 * SAFETY RULES
 * ------------
 * 1. `--dry-run` performs NO writes at all — no schema, no tracking
 *    table, not even a temp object. It can be run against production
 *    without changing it.
 * 2. The tracking table is created only when a migration is actually
 *    about to be applied.
 * 3. A database with application tables but no tracking table is
 *    refused: replaying 0000–0022 there would run destructive SQL
 *    (0002 drops patients.facility_id). Nothing is baselined
 *    automatically; use `--force-replay` only on a scratch database.
 * 4. Applying to a non-local host requires `--yes`.
 *
 *   npm run db:migrate:dry            read-only plan
 *   npm run db:migrate -- --yes       apply (non-local host)
 */

import type { Pool, PoolClient } from 'pg';

import {
  classifyMigrations,
  isLocalDatabaseHost,
  journalPath,
  migrationsDirectory,
  readJournal,
  readPlans,
  scanDestructiveStatements,
  type AppliedMigration,
  type MigrationPlan,
} from './migration-journal.ts';

interface TrackingTable {
  /** Schema-qualified and quoted, safe to interpolate. */
  qualified: string;
  schema: string;
  table: string;
  hasHash: boolean;
  hasCreatedAt: boolean;
}

const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--yes') || process.argv.includes('-y');
const forceReplay = process.argv.includes('--force-replay');

function fail(message: string): never {
  console.error('');
  console.error(`${RED}✖ ${message}${RESET}`);
  console.error('');
  process.exit(1);
}

function heading(text: string): void {
  console.log('');
  console.log('==============================================');
  console.log(text);
  console.log('==============================================');
}

/**
 * Locate a tracking table without creating one.
 *
 * `pg_class` rather than `information_schema.tables`: the latter hides
 * tables the current role has no privilege on, and a status run that
 * cannot see the table would wrongly conclude the database is unmanaged.
 */
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

async function readApplied(
  pool: Pool,
  table: TrackingTable,
): Promise<AppliedMigration[]> {
  const select = [
    table.hasHash ? 'hash' : 'NULL::text AS hash',
    table.hasCreatedAt ? 'created_at' : 'NULL::bigint AS created_at',
  ].join(', ');

  const { rows } = await pool.query<{
    hash: string | null;
    created_at: string | number | null;
  }>(`SELECT ${select} FROM ${table.qualified}`);

  return rows.map((row) => ({
    hash: row.hash,
    createdAt:
      row.created_at === null || row.created_at === undefined
        ? null
        : Number(row.created_at),
  }));
}

async function publicTableCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '__drizzle_migrations'`,
  );

  return Number(rows[0]?.count ?? 0);
}

function printPlan(plans: readonly MigrationPlan[]): void {
  for (const plan of plans) {
    console.log(`  • ${plan.tag}  (${plan.statements.length} statement(s))`);
  }
}

function printDestructive(plans: readonly MigrationPlan[]): void {
  const findings = scanDestructiveStatements(plans);

  if (findings.length === 0) return;

  console.log('');
  console.log(`${YELLOW}!${RESET} Destructive statements in this set:`);

  for (const finding of findings) {
    console.log(
      `  - ${finding.tag} #${finding.statementIndex}  ${finding.label}` +
        (finding.conditional ? `${DIM} (IF EXISTS — a no-op when absent)${RESET}` : ''),
    );
    console.log(`    ${DIM}${finding.preview}${RESET}`);
  }
}

async function main(): Promise<void> {
  const dir = migrationsDirectory();

  let plans: MigrationPlan[];
  let bomFiles: string[];

  try {
    const entries = readJournal(dir);
    plans = readPlans(entries, dir);
    bomFiles = plans.filter((plan) => plan.bomStripped).map((plan) => plan.tag);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  heading('JaliCare HMIS — migration runner');

  let pool: Pool;
  let env: { database: { host: string; port: number; name: string; user: string } };

  try {
    const dbModule = await import('../src/db/index.ts');
    const envModule = await import('../src/config/env.ts');

    pool = dbModule.pool;
    env = envModule.env;
  } catch (error) {
    console.error('');
    console.error(`${RED}Cannot read the database configuration.${RESET}`);
    console.error('');
    console.error('Required .env keys:');
    console.error('  SQL_HOST  SQL_PORT  SQL_DB_NAME  SQL_ADMIN_USER  SQL_ADMIN_PASSWORD');
    console.error('');
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    process.exit(1);
  }

  console.log(`Target   : ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`);
  console.log(`Folder   : ${dir}`);
  console.log(`Journal  : ${journalPath(dir)}`);
  console.log(`Mode     : ${dryRun ? 'DRY RUN (read-only)' : 'APPLY'}`);

  if (bomFiles.length > 0) {
    console.log(`${YELLOW}!${RESET} Stripped a UTF-8 BOM from: ${bomFiles.join(', ')}`);
  }

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    const detail = error as { code?: string; message?: string };
    fail(`Cannot reach the database (${detail.code ?? 'unknown'}). ${detail.message ?? ''}`);
  }

  const table = await findTrackingTable(pool);
  const tableCount = await publicTableCount(pool);

  console.log(
    `Tracking : ${table ? `${table.qualified} · hash=${table.hasHash} created_at=${table.hasCreatedAt}` : 'absent'}`,
  );
  console.log(`Public   : ${tableCount} table(s)`);

  const applied = table ? await readApplied(pool, table) : [];
  const classification = classifyMigrations(plans, applied);

  console.log(`Recorded : ${applied.length} migration(s)`);
  console.log(`Pending  : ${classification.pending.length}`);

  if (classification.editedAfterApply.length > 0) {
    console.log('');
    console.log(
      `${YELLOW}!${RESET} ${classification.editedAfterApply.length} applied migration(s) changed on disk:`,
    );
    console.log(`  ${classification.editedAfterApply.map((plan) => plan.tag).join(', ')}`);
    console.log('  They keep their recorded timestamp and will not run here again.');
  }

  /*
   * The dangerous state: a live database that has tables but no
   * tracking table. Applying "everything from 0000" would recreate
   * tables, alter columns and run 0002's DROP COLUMN against patient
   * data. Refuse, and say what to do instead.
   */
  const unmanaged = !table && tableCount > 0;

  if (unmanaged) {
    console.log('');
    console.log(`${RED}BLOCKED — this database has ${tableCount} table(s) but no tracking table.${RESET}`);
    console.log('');
    console.log('Apply would run every migration from 0000, including:');
    console.log('  0002  ALTER TABLE "patients" DROP COLUMN "facility_id"');
    console.log('');
    console.log('That is destructive and almost certainly not what you want.');
    console.log('');
    console.log('What to do instead, in order:');
    console.log('  1. npm run db:preflight        read-only inventory of this database');
    console.log('  2. Verify, migration by migration, which effects already exist.');
    console.log('  3. Record only verified migrations (see docs/deployment/truehost-cpanel.md).');
    console.log('  4. Never drop or recreate patient tables to make the tracker agree.');
    console.log('');
    console.log('On an empty SCRATCH database only: --force-replay --yes');
    console.log('');

    if (!forceReplay) {
      await pool.end();
      process.exit(1);
    }

    console.log(`${YELLOW}--force-replay given: continuing against ${tableCount} table(s).${RESET}`);
  }

  /*
   * The other dangerous state: the tracking table exists and has rows,
   * but not one of them corresponds to a file in this journal.
   *
   * That happens when the table was written by a different journal (a
   * branch, an older checkout, a hand-made table) — or when the hashes
   * were produced by a different algorithm. "Nothing matched, so
   * everything is pending" is technically true and catastrophic in
   * practice: it replays 0002's DROP COLUMN over live patient data.
   *
   * A genuinely fresh database has an empty table or no table, and is
   * handled above. This branch is never the innocent case.
   */
  const orphanedHistory =
    Boolean(table) && applied.length > 0 && classification.applied.length === 0;

  if (orphanedHistory) {
    console.log('');
    console.log(`${RED}BLOCKED — this database has ${applied.length} recorded migration(s), none of which match this journal.${RESET}`);
    console.log('');
    console.log('Applying now would replay the whole journal, including:');
    console.log('  0002  ALTER TABLE "patients" DROP COLUMN "facility_id"');
    console.log('');
    console.log('Recorded hashes/timestamps (first 5):');
    for (const row of applied.slice(0, 5)) {
      console.log(`  ${String(row.createdAt ?? 'null').padEnd(16)} ${String(row.hash ?? '').slice(0, 16)}…`);
    }
    console.log('');
    console.log('The usual cause is migrating from a different checkout, branch or');
    console.log('journal than the one that recorded these rows. Reconcile the journal');
    console.log('with the database (npm run db:preflight, then compare hashes with');
    console.log('drizzle/meta/_journal.json) before touching anything.');
    console.log('');
    console.log('Never delete the tracking table or the patient tables to make this go away.');
    console.log('');
    console.log('On a scratch database only: --force-replay --yes');
    console.log('');

    if (!forceReplay) {
      await pool.end();
      process.exit(1);
    }

    console.log(`${YELLOW}--force-replay given: replaying ${classification.pending.length} migration(s) anyway.${RESET}`);
  }

  if (classification.pending.length === 0) {
    console.log('');
    console.log(`${GREEN}✔ Database is up to date. Nothing to apply.${RESET}`);
    await pool.end();
    return;
  }

  if (classification.behindNewest.length > 0) {
    console.log('');
    console.log(
      `${YELLOW}!${RESET} ${classification.behindNewest.length} pending migration(s) are older than the newest recorded timestamp.`,
    );
    console.log('  drizzle-kit migrate would skip these silently; this runner matches on hash or timestamp.');
    console.log(`  Affected: ${classification.behindNewest.map((plan) => plan.tag).join(', ')}`);
  }

  console.log('');
  console.log('Plan:');
  printPlan(classification.pending);
  printDestructive(classification.pending);

  if (dryRun) {
    console.log('');
    console.log(`${YELLOW}Dry run — nothing was executed and nothing was created.${RESET}`);
    console.log('');

    const allDestructive = scanDestructiveStatements(plans);
    if (allDestructive.length > 0) {
      console.log(
        `${DIM}Whole journal: ${allDestructive.length} destructive statement(s) across ${plans.length} migration(s).${RESET}`,
      );
      console.log('');
    }

    await pool.end();
    return;
  }

  if (!isLocalDatabaseHost(env.database.host) && !confirmed) {
    console.log('');
    console.log(`${RED}Refusing to apply to ${env.database.host} without confirmation.${RESET}`);
    console.log('');
    console.log('Take a verified backup first:');
    console.log('  pg_dump -Fc -f jalicare-$(date +%F-%H%M).dump "$SQL_DB_NAME"');
    console.log('');
    console.log('Then run:');
    console.log('  npm run db:migrate -- --yes');
    console.log('');
    await pool.end();
    process.exit(1);
  }

  let client: PoolClient;

  try {
    client = await pool.connect();
  } catch (error) {
    fail(`Could not open a connection: ${(error as Error).message}`);
  }

  try {
    await client.query('BEGIN');

    /*
     * Created here, inside the transaction that applies migrations, and
     * never during a dry run. A read-only check must not leave an empty
     * schema behind for the next reader to mistake for migration state.
     */
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`);

    for (const plan of classification.pending) {
      await applyPlan(client, plan);
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [plan.hash, plan.folderMillis],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);

    const detail = error as { code?: string; message?: string };
    fail(`Migration aborted: ${detail.message ?? String(error)} (nothing committed)`);
  } finally {
    /*
     * release(true) DESTROYS the connection instead of returning it to
     * the pool. On the failure path the transaction was rolled back but
     * the session may still hold a lock or an aborted transaction; a
     * pooled client that is handed back in that state makes
     * pool.end() wait for a connection nothing will ever release, and
     * the command hangs on the host instead of exiting with an error.
     */
    client.release(true);
    await pool.end();
  }

  console.log('');
  console.log('==============================================');
  console.log(`${GREEN}✔ Applied ${classification.pending.length} migration(s).${RESET}`);
  console.log('==============================================');
  console.log('');
  console.log('Next: npm run db:status');
  console.log('');
}

async function applyPlan(client: PoolClient, plan: MigrationPlan): Promise<void> {
  for (let index = 0; index < plan.statements.length; index += 1) {
    const statement = plan.statements[index];

    try {
      await client.query(statement);
    } catch (error) {
      const detail = error as {
        code?: string;
        message?: string;
        detail?: string;
        hint?: string;
        position?: string;
      };

      console.error('');
      console.error(`${RED}==============================================`);
      console.error('MIGRATION FAILED');
      console.error(`==============================================${RESET}`);
      console.error(`Migration : ${plan.tag}`);
      console.error(`Statement : ${index + 1} of ${plan.statements.length}`);
      console.error('');
      console.error('SQL:');
      console.error(
        statement.length > 1200 ? `${statement.slice(0, 1200)}\n… (truncated)` : statement,
      );
      console.error('');
      console.error(`Postgres  : ${detail.code ?? 'unknown'} — ${detail.message ?? ''}`);

      if (detail.detail) console.error(`Detail    : ${detail.detail}`);
      if (detail.hint) console.error(`Hint      : ${detail.hint}`);
      if (detail.position) console.error(`Position  : ${detail.position}`);

      console.error('');
      console.error('Nothing was committed. The database is unchanged.');
      console.error('');

      throw new Error(`${plan.tag} failed at statement ${index + 1}`);
    }
  }

  console.log(`  ${GREEN}✔${RESET} ${plan.tag}`);
}

main().catch((error: unknown) => {
  fail(`Unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
});
