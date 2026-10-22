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
 * It is safe to re-run: every statement in 0007 onward is written with
 * IF NOT EXISTS / IF EXISTS guards, and migrations already recorded by
 * hash are skipped.
 *
 * READ ONLY EXCEPT for applying migrations and writing tracking rows.
 * It never drops, truncates or rewrites patient data.
 *
 *   npx tsx scripts/migrate.ts --dry-run
 *   npx tsx scripts/migrate.ts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationPlan {
  tag: string;
  hash: string;
  folderMillis: number;
  statements: string[];
  bomStripped: boolean;
}

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');
const JOURNAL_PATH = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');

const dryRun = process.argv.includes('--dry-run');

function fail(message: string): never {
  console.error('');
  console.error(`\x1b[31m✖ ${message}\x1b[0m`);
  console.error('');
  process.exit(1);
}

function readJournal(): JournalEntry[] {
  if (!existsSync(JOURNAL_PATH)) {
    fail(`No journal found at ${JOURNAL_PATH}`);
  }

  const parsed = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
    entries?: JournalEntry[];
  };

  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    fail('The migration journal has no entries.');
  }

  return parsed.entries;
}

function readPlans(entries: JournalEntry[]): MigrationPlan[] {
  return entries.map((entry) => {
    const file = join(MIGRATIONS_FOLDER, `${entry.tag}.sql`);

    if (!existsSync(file)) {
      fail(`Journal entry ${entry.tag} has no .sql file.`);
    }

    let raw = readFileSync(file, 'utf8');

    /*
     * A UTF-8 BOM at the start of a .sql file makes Postgres read the
     * first statement as "\uFEFFCREATE ..." and fail. 0008 shipped with
     * one once; strip it rather than repeat the incident.
     */
    let bomStripped = false;

    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
      bomStripped = true;
    }

    const statements = raw
      .split('--> statement-breakpoint')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);

    return {
      tag: entry.tag,
      hash: createHash('sha256').update(raw).digest('hex'),
      folderMillis: entry.when,
      statements,
      bomStripped,
    };
  });
}

async function main(): Promise<void> {
  const entries = readJournal();
  const plans = readPlans(entries);

  const { pool } = await import('../src/db/index.ts');
  const { env } = await import('../src/config/env.ts');

  console.log('');
  console.log('JaliCare HMIS — migration runner');
  console.log('==============================================');
  console.log(`Target : ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`);
  console.log(`Folder : ${MIGRATIONS_FOLDER}`);
  console.log('');

  const bomFiles = plans.filter((p) => p.bomStripped).map((p) => p.tag);

  if (bomFiles.length > 0) {
    console.log(`\x1b[33m!\x1b[0m Stripped a UTF-8 BOM from: ${bomFiles.join(', ')}`);
    console.log('');
  }

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    const detail = error as { code?: string; message?: string };
    fail(
      `Cannot reach the database (${detail.code ?? 'unknown'}). ${detail.message ?? ''}`,
    );
  }

  await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`);

  const { rows } = await pool.query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations',
  );

  const appliedHashes = new Set(rows.map((row) => row.hash));
  const appliedMillis = new Set(
    rows.map((row) => Number(row.created_at ?? 0)),
  );

  const newestRecorded = rows.reduce(
    (max, row) => Math.max(max, Number(row.created_at ?? 0)),
    0,
  );

  /*
   * "Applied" means one of two things:
   *
   *   - this exact file has run here (hash match), or
   *   - a migration with this journal timestamp has run here.
   *
   * The second test exists because a migration file that is edited after
   * it was applied — to add a missing USING cast, say — keeps its journal
   * timestamp but changes its hash. Matching only on hash would make this
   * runner try to re-run an already-applied migration that is not
   * idempotent, on the one database that must not see it run again.
   *
   * Matching on the timestamp makes the edit visible only to databases
   * that have not applied the migration yet, which is exactly where a
   * fresh-install fix belongs. The drift is reported below, never hidden.
   */
  const editedAfterApply = plans.filter(
    (plan) =>
      !appliedHashes.has(plan.hash) && appliedMillis.has(plan.folderMillis),
  );

  const pending = plans.filter(
    (plan) =>
      !appliedHashes.has(plan.hash) && !appliedMillis.has(plan.folderMillis),
  );

  console.log(`Recorded : ${rows.length} migration(s)`);
  console.log(`Pending  : ${pending.length}`);

  if (editedAfterApply.length > 0) {
    console.log('');
    console.log(
      `\x1b[33m!\x1b[0m ${editedAfterApply.length} applied migration(s) have changed on disk:`,
    );
    console.log(`  ${editedAfterApply.map((plan) => plan.tag).join(', ')}`);
    console.log(
      '  They keep their recorded timestamp, so they will not run again here.',
    );
    console.log(
      '  The change reaches only databases that have not applied them yet.',
    );
  }

  if (pending.length === 0) {
    console.log('');
    console.log('\x1b[32m✔\x1b[0m Database is up to date. Nothing to apply.');
    console.log('');
    await pool.end();
    return;
  }

  /*
   * Drizzle skips any migration whose timestamp is not newer than the
   * newest recorded one. If the tracking table has drifted ahead of the
   * journal, `drizzle-kit migrate` silently applies nothing — exactly the
   * symptom that brought you here.
   */
  const behind = pending.filter((plan) => plan.folderMillis <= newestRecorded);

  if (behind.length > 0) {
    console.log('');
    console.log(
      `\x1b[33m!\x1b[0m ${behind.length} pending migration(s) are older than the newest recorded timestamp.`,
    );
    console.log(
      '  drizzle-kit migrate would skip these silently. This runner matches on hash or journal timestamp.',
    );
    console.log(`  Affected: ${behind.map((plan) => plan.tag).join(', ')}`);
  }

  console.log('');

  for (const plan of pending) {
    console.log(`  • ${plan.tag}  (${plan.statements.length} statement(s))`);
  }

  console.log('');

  if (dryRun) {
    console.log('\x1b[33mDry run — nothing was executed.\x1b[0m');
    console.log('');
    await pool.end();
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const plan of pending) {
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

          await client.query('ROLLBACK');

          console.error('');
          console.error('\x1b[31m==============================================');
          console.error('MIGRATION FAILED');
          console.error('==============================================\x1b[0m');
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

          /*
           * Release the client before ending the pool. `pool.end()` waits
           * for every checked-out client to come back, and this one never
           * would: the process used to print its failure and then hang
           * instead of exiting.
           */
          client.release(true);
          await pool.end();
          process.exit(1);
        }
      }

      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [plan.hash, plan.folderMillis],
      );

      console.log(`  \x1b[32m✔\x1b[0m ${plan.tag}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);

    const detail = error as { code?: string; message?: string };
    fail(`Migration aborted: ${detail.message ?? String(error)}`);
  } finally {
    client.release();
    await pool.end();
  }

  console.log('');
  console.log('==============================================');
  console.log(`\x1b[32m✔ Applied ${pending.length} migration(s).\x1b[0m`);
  console.log('==============================================');
  console.log('');
  console.log('Next: npx tsx scripts/migration-status.ts --expect-0009');
  console.log('');
}

main().catch((error: unknown) => {
  const detail = error as { message?: string };
  fail(`Unexpected failure: ${detail.message ?? String(error)}`);
});
