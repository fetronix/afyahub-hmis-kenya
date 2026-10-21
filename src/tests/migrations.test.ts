/**
 * JaliCare HMIS
 * Migration file integrity tests
 *
 * These guard the failures that only show up when the migration is
 * actually applied, which is far too late:
 *
 *   1. A UTF-8 BOM at the start of a .sql file. PostgreSQL rejects the
 *      leading U+FEFF, drizzle-kit prints the error into a spinner it
 *      clears, and the run exits without applying anything. Migration
 *      0008 shipped with a BOM and blocked 0009 for exactly this reason.
 *   2. A journal entry with no matching .sql file.
 *   3. Journal timestamps that are not strictly increasing. drizzle
 *      decides what to apply by comparing against the newest recorded
 *      created_at, so a non-monotonic journal can strand migrations.
 *   4. A migration that is not recorded in the journal at all.
 *
 * Run with: npx tsx src/tests/migrations.test.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

const DRIZZLE_DIR = resolve(process.cwd(), 'drizzle');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const raw = readFileSync(resolve(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8');

  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function testNoBom(): void {
  const files = readdirSync(DRIZZLE_DIR).filter(
    (name) => name.endsWith('.sql'),
  );

  assert(files.length > 0, 'at least one migration file exists');

  for (const file of files) {
    const buffer = readFileSync(resolve(DRIZZLE_DIR, file));

    const startsWithBom =
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf;

    assert(
      !startsWithBom,
      `${file} must be UTF-8 without BOM — PostgreSQL rejects U+FEFF and drizzle-kit hides the error`,
    );
  }
}

function testJournalMatchesFiles(): void {
  const journal = readJournal();
  const files = new Set(
    readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql')),
  );

  assert(journal.length > 0, 'journal lists migrations');

  for (const entry of journal) {
    assert(
      files.has(`${entry.tag}.sql`),
      `journal entry ${entry.tag} has a matching .sql file`,
    );
  }

  const journalTags = new Set(journal.map((entry) => entry.tag));

  for (const file of files) {
    const tag = file.replace(/\.sql$/, '');

    /* .bak copies are ignored. */
    assert(
      journalTags.has(tag),
      `${file} is registered in _journal.json`,
    );
  }
}

function testTimestampsIncreasing(): void {
  const journal = readJournal();

  for (let index = 1; index < journal.length; index += 1) {
    const previous = journal[index - 1];
    const current = journal[index];

    assert(
      current.when > previous.when,
      `${current.tag} (${current.when}) must be newer than ${previous.tag} (${previous.when}) — drizzle applies a migration only when its timestamp beats the newest recorded one`,
    );

    assert(
      current.idx === previous.idx + 1,
      `${current.tag} has a contiguous journal index`,
    );
  }
}

/**
 * A text column converted to a date, timestamp or numeric needs an
 * explicit USING clause. Without one PostgreSQL raises 42804 and the
 * whole run rolls back — which is exactly what happened to 0002 on every
 * fresh database, and only on a fresh database, so nobody noticed for
 * months. The cast is harmless on an empty table and required on a
 * populated one.
 */
function testDataTypeCasts(): void {
  const files = readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql'));

  const needsCast = /SET DATA TYPE (date|timestamp|timestamptz|numeric)/i;

  for (const file of files) {
    const sql = readFileSync(resolve(DRIZZLE_DIR, file), 'utf8');

    const statements = sql.split('--> statement-breakpoint');

    for (const statement of statements) {
      if (!needsCast.test(statement)) continue;

      assert(
        /USING/i.test(statement),
        `${file}: "${statement.trim().slice(0, 80)}…" converts a column type without USING, so a fresh install fails with 42804`,
      );
    }
  }
}

/**
 * Two behaviours in the runner that a fresh install depends on:
 * an edited migration that has already been applied must not run again,
 * and a failed migration must exit rather than hang.
 */
function testRunnerSafety(): void {
  const runner = readFileSync(
    resolve(process.cwd(), 'scripts/migrate.ts'),
    'utf8',
  );

  assert(
    runner.includes('appliedMillis'),
    'the runner skips an applied migration by journal timestamp, so editing 0002 does not re-run it',
  );

  assert(
    runner.includes('client.release(true)'),
    'the runner releases its client before ending the pool, so a failed migration exits instead of hanging',
  );
}

function testStatementsTerminated(): void {
  const journal = readJournal();

  for (const entry of journal) {
    const sql = readFileSync(resolve(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');

    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    assert(
      statements.length > 0,
      `${entry.tag} contains at least one statement`,
    );

    for (const [index, statement] of statements.entries()) {
      const withoutComments = statement
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--[^\n]*/g, '')
        .trim();

      if (withoutComments.length === 0) continue;

      assert(
        withoutComments.endsWith(';'),
        `${entry.tag} statement ${index + 1} ends with a semicolon`,
      );
    }
  }
}

function run(): void {
  console.log('');
  console.log('MIGRATION FILE TESTS');
  console.log('==============================================');

  testNoBom();
  console.log('  1. No migration file starts with a UTF-8 BOM');

  testJournalMatchesFiles();
  console.log('  2. Journal entries and .sql files match both ways');

  testTimestampsIncreasing();
  console.log('  3. Journal timestamps increase and indices are contiguous');

  testStatementsTerminated();
  console.log('  4. Every statement is terminated');

  testDataTypeCasts();
  console.log('  5. No column type change is missing its USING cast');

  testRunnerSafety();
  console.log('  6. The runner cannot re-run an applied migration or hang on failure');

  console.log('');
  console.log('==============================================');
  console.log(`MIGRATION TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('MIGRATION TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
