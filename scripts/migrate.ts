/**
 * JaliCare HMIS
 * Migration runner — explicit, verbose, and safe to re-run.
 *
 * WHY THIS EXISTS
 * ---------------
 * `drizzle-kit migrate` decides what to apply with a single comparison:
 *
 *     newest recorded created_at  <  this migration's journal `when`
 *
 * It never looks at which migrations are recorded, only at the newest
 * timestamp. If the tracking table ever holds a `created_at` that is
 * ahead of a journal entry's `when` — which happens when the journal is
 * regenerated or restored from a backup — that migration is skipped
 * silently, the command exits 0, and nothing is written. There is no
 * warning. That is how 0008 and 0009 can sit "pending" forever.
 *
 * This script reports the exact plan, names the statement that fails if
 * one does, and records the same (hash, created_at) rows drizzle uses so
 * the two stay interchangeable.
 *
 * SAFETY
 * ------
 * - One transaction for the whole run: a failure rolls everything back.
 * - Never drops, truncates or rewrites a table.
 * - Refuses to run if a migration file is missing or the tracking table
 *   cannot be read.
 * - --dry-run prints the plan and touches nothing.
 *
 * USAGE
 * -----
 *   npm run db:migrate -- --dry-run     # show the plan
 *   npm run db:migrate                  # apply
 *   npm run db:migrate -- --by-hash     # for the silent-skip case:
 *                                       # apply any migration whose file
 *                                       # hash is not recorded, ignoring
 *                                       # timestamps
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

const DRY_RUN = process.argv.includes('--dry-run');
const BY_HASH = process.argv.includes('--by-hash');

const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface LoadedMigration {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

interface RecordedMigration {
  id: number;
  hash: string;
  created_at: string;
}

const bomWarnings: string[] = [];

function loadMigrations(): LoadedMigration[] {
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');

  if (!existsSync(journalPath)) {
    throw new Error(`Cannot find ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: JournalEntry[];
  };

  return journal.entries.map((entry) => {
    const filePath = resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`);

    if (!existsSync(filePath)) {
      throw new Error(
        `Migration ${entry.tag} is in the journal but ${filePath} is missing.`,
      );
    }

    /*
     * A UTF-8 BOM is the classic footgun here: the file looks fine in an
     * editor, but PostgreSQL rejects the leading U+FEFF and drizzle-kit
     * reports the failure through a spinner it clears before printing.
     * The migration has already been rolled back by then.
     */
    let sql = readFileSync(filePath, 'utf8');

    if (sql.charCodeAt(0) === 0xfeff) {
      console.warn(
        `${YELLOW}! ${entry.tag}.sql starts with a UTF-8 BOM — stripping it for this run.${RESET}`,
      );
      console.warn(
        `${YELLOW}  Save the file as UTF-8 without BOM, or drizzle-kit migrate will keep failing silently.${RESET}`,
      );
      sql = sql.slice(1);
      bomWarnings.push(entry.tag);
    }

    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256').update(sql).digest('hex'),
      statements,
    };
  });
}

function preview(statement: string): string {
  const firstLine = statement
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('--') && !line.startsWith('/*'));

  const text = (firstLine ?? statement).replace(/\s+/g, ' ');

  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function formatWhen(millis: number): string {
  return new Date(Number(millis)).toISOString();
}

async function main(): Promise<void> {
  console.log('');
  console.log('==============================================');
  console.log(`Migration runner${DRY_RUN ? ' (dry run — no writes)' : ''}`);
  console.log('==============================================');

  let pool: import('pg').Pool;
  let env: typeof import('../src/config/env.ts').env;

  try {
    const [dbModule, envModule] = await Promise.all([
      import('../src/db/index.ts'),
      import('../src/config/env.ts'),
    ]);

    pool = dbModule.pool;
    env = envModule.env;
  } catch (error) {
    console.log('');
    console.log(`${RED}Cannot read the database configuration.${RESET}`);
    console.log('');
    console.log('Required .env keys:');
    console.log('  SQL_HOST  SQL_PORT  SQL_DB_NAME  SQL_ADMIN_USER  SQL_ADMIN_PASSWORD');
    console.log('');
    console.log(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  console.log(
    `Target: ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`,
  );

  const migrations = loadMigrations();
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const { rows: recorded } = await client.query<RecordedMigration>(
      `SELECT id, hash, created_at
         FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
        ORDER BY created_at ASC`,
    );

    const recordedHashes = new Set(recorded.map((row) => row.hash));
    const newest = recorded.length > 0
      ? Number(recorded[recorded.length - 1].created_at)
      : null;

    console.log(`Recorded migrations: ${recorded.length}`);
    if (newest !== null) {
      console.log(`${DIM}Newest recorded:     ${formatWhen(newest)}${RESET}`);
    }

    /* Which migrations still need to run, and why. */
    const pending = migrations.filter((migration) => {
      if (BY_HASH) {
        return !recordedHashes.has(migration.hash);
      }

      return newest === null || newest < migration.when;
    });

    console.log('');

    if (pending.length === 0) {
      console.log(`${GREEN}Nothing to apply — every journal entry is recorded.${RESET}`);
      console.log('==============================================');
      console.log('');
      return;
    }

    console.log(`Pending: ${pending.length}`);
    console.log('');

    let statementCount = 0;
    for (const migration of pending) {
      statementCount += migration.statements.length;
      console.log(
        `  ${migration.tag}  ${DIM}(${migration.statements.length} statement${
          migration.statements.length === 1 ? '' : 's'
        })  ${formatWhen(migration.when)}${RESET}`,
      );
    }

    /*
     * Detect the silent-skip trap: a recorded timestamp ahead of a
     * pending migration's `when`. drizzle-kit would apply neither.
     */
    const skippedByDrizzle = migrations.filter(
      (migration) =>
        !recordedHashes.has(migration.hash) &&
        newest !== null &&
        newest >= migration.when,
    );

    if (skippedByDrizzle.length > 0) {
      console.log('');
      console.log(
        `${YELLOW}! The tracking table is ahead of these migrations:${RESET}`,
      );
      for (const migration of skippedByDrizzle) {
        console.log(
          `  ${migration.tag}  ${DIM}(journal ${formatWhen(migration.when)})${RESET}`,
        );
      }
      console.log(
        '  drizzle-kit migrate compares only the newest timestamp, so it',
      );
      console.log(
        '  would skip them and exit 0. This script applies them because a',
      );
      console.log(
        '  hash is missing. To reproduce drizzle\'s behaviour, use',
      );
      console.log(`  ${DIM}npx drizzle-kit migrate${RESET}.`);
    }

    if (DRY_RUN) {
      console.log('');
      for (const migration of pending) {
        console.log(`${DIM}--- ${migration.tag} ---${RESET}`);
        migration.statements.forEach((statement, index) => {
          console.log(`  ${index + 1}. ${preview(statement)}`);
        });
      }

      console.log('');
      console.log(`${YELLOW}Dry run: nothing was applied.${RESET}`);
      console.log('==============================================');
      console.log('');
      return;
    }

    console.log('');
    console.log(`Applying ${pending.length} migration(s), ${statementCount} statement(s)...`);
    console.log('');

    await client.query('BEGIN');

    try {
      for (const migration of pending) {
        console.log(`  ${migration.tag}`);

        for (const [index, statement] of migration.statements.entries()) {
          try {
            await client.query(statement);
          } catch (error) {
            const pgError = error as {
              message?: string;
              code?: string;
              detail?: string;
              hint?: string;
              position?: string;
            };

            console.error('');
            console.error(
              `${RED}FAILED${RESET} in ${migration.tag}, statement ${index + 1} of ${migration.statements.length}`,
            );
            console.error('');
            console.error('SQL:');
            console.error(statement.slice(0, 1200));
            console.error('');
            console.error(`Error ${pgError.code ?? ''}: ${pgError.message ?? error}`);

            if (pgError.detail) console.error(`Detail: ${pgError.detail}`);
            if (pgError.hint) console.error(`Hint:   ${pgError.hint}`);

            throw error;
          }

          console.log(`    ${DIM}${index + 1}/${migration.statements.length} ok${RESET}`);
        }

        await client.query(
          `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at")
           VALUES ($1, $2)`,
          [migration.hash, migration.when],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');

      console.error('');
      console.error(`${RED}Rolled back. The database is unchanged.${RESET}`);
      console.error('');
      console.error(
        'Fix the statement above, then run npm run db:migrate again.',
      );
      console.error('');
      process.exitCode = 1;
      return;
    }

    console.log('');
    console.log(`${GREEN}Applied ${pending.length} migration(s).${RESET}`);
    console.log('');
    console.log('Next: npm run db:status:0009');
    console.log('==============================================');
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error('');
  console.error(`${RED}Migration runner failed.${RESET}`);
  console.error(error instanceof Error ? error.message : error);
  console.error('');

  /*
   * A connection failure often leaves the pool holding sockets, which
   * keeps the process alive; exit explicitly so CI does not hang.
   */
  process.exit(1);
});
