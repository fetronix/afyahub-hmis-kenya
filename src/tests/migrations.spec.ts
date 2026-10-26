import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyMigrations } from '../../scripts/migration-journal.ts';

import { describe, expect, it } from 'vitest';

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

describe('Migration file integrity tests', () => {
  it('No Bom', async () => {
    const files = readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql'));

    expect(files.length > 0, 'at least one migration file exists').toBe(true);

    for (const file of files) {
      const buffer = readFileSync(resolve(DRIZZLE_DIR, file));

      const startsWithBom =
        buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;

      expect(
        !startsWithBom,
        `${file} must be UTF-8 without BOM — PostgreSQL rejects U+FEFF and drizzle-kit hides the error`,
      ).toBe(true);
    }
  });

  it('Journal Matches Files', async () => {
    const journal = readJournal();
    const files = new Set(readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql')));

    expect(journal.length > 0, 'journal lists migrations').toBe(true);

    for (const entry of journal) {
      expect(
        files.has(`${entry.tag}.sql`),
        `journal entry ${entry.tag} has a matching .sql file`,
      ).toBe(true);
    }

    const journalTags = new Set(journal.map((entry) => entry.tag));

    for (const file of files) {
      const tag = file.replace(/\.sql$/, '');

      /* .bak copies are ignored. */
      expect(journalTags.has(tag), `${file} is registered in _journal.json`).toBe(true);
    }
  });

  it('Timestamps Increasing', async () => {
    const journal = readJournal();

    for (let index = 1; index < journal.length; index += 1) {
      const previous = journal[index - 1];
      const current = journal[index];

      expect(
        current.when > previous.when,
        `${current.tag} (${current.when}) must be newer than ${previous.tag} (${previous.when}) — drizzle applies a migration only when its timestamp beats the newest recorded one`,
      ).toBe(true);

      expect(
        current.idx === previous.idx + 1,
        `${current.tag} has a contiguous journal index`,
      ).toBe(true);
    }
  });

  it('Statements Terminated', async () => {
    const journal = readJournal();

    for (const entry of journal) {
      const sql = readFileSync(resolve(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');

      const statements = sql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      expect(statements.length > 0, `${entry.tag} contains at least one statement`).toBe(true);

      for (const [index, statement] of statements.entries()) {
        const withoutComments = statement
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/--[^\n]*/g, '')
          .trim();

        if (withoutComments.length === 0) continue;

        expect(
          withoutComments.endsWith(';'),
          `${entry.tag} statement ${index + 1} ends with a semicolon`,
        ).toBe(true);
      }
    }
  });

  it('Data Type Casts', async () => {
    const files = readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql'));

    const needsCast = /SET DATA TYPE (date|timestamp|timestamptz|numeric)/i;

    for (const file of files) {
      const sql = readFileSync(resolve(DRIZZLE_DIR, file), 'utf8');

      const statements = sql.split('--> statement-breakpoint');

      for (const statement of statements) {
        if (!needsCast.test(statement)) continue;

        expect(
          /USING/i.test(statement),
          `${file}: "${statement.trim().slice(0, 80)}…" converts a column type without USING, so a fresh install fails with 42804`,
        ).toBe(true);
      }
    }
  });

  it('Runner Safety', async () => {
    const runner = readFileSync(resolve(process.cwd(), 'scripts/migrate.ts'), 'utf8');

    /*
     * The rule used to be asserted as the literal string `appliedMillis`
     * inside this file. It now lives in the shared classifier, so assert
     * the BEHAVIOUR instead: an edited migration that is already recorded
     * must not be queued again.
     */
    const editedButRecorded = classifyMigrations(
      [
        {
          tag: '0002_x',
          hash: 'hash-after-edit',
          folderMillis: 2_000,
          statements: [],
          bomStripped: false,
        },
      ],
      [{ hash: 'hash-before-edit', createdAt: 2_000 }],
    );

    expect(
      editedButRecorded.pending.length === 0,
      'the runner skips an applied migration by journal timestamp, so editing 0002 does not re-run it',
    ).toBe(true);

    expect(
      editedButRecorded.editedAfterApply.length === 1,
      'editing an applied migration is reported as drift rather than replayed',
    ).toBe(true);

    expect(
      runner.includes('classifyMigrations('),
      'the runner uses the shared classifier rather than its own copy of the rule',
    ).toBe(true);

    expect(
      runner.includes('client.release(true)'),
      'the runner releases its client before ending the pool, so a failed migration exits instead of hanging',
    ).toBe(true);
  });

  it('Guarded Ddl', async () => {
    const files = readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql'));

    let checked = 0;

    for (const file of files) {
      const order = Number(file.slice(0, 4));

      if (!Number.isFinite(order) || order < 7) continue;

      checked += 1;

      const sql = readFileSync(resolve(DRIZZLE_DIR, file), 'utf8').toUpperCase();

      const rules: Array<[RegExp, string]> = [
        [/ADD COLUMN(?! IF NOT EXISTS)/, 'ADD COLUMN must say IF NOT EXISTS'],
        [/CREATE TABLE(?! IF NOT EXISTS)/, 'CREATE TABLE must say IF NOT EXISTS'],
        [/CREATE (?:UNIQUE )?INDEX(?! IF NOT EXISTS)/, 'CREATE INDEX must say IF NOT EXISTS'],
        [/CREATE SEQUENCE(?! IF NOT EXISTS)/, 'CREATE SEQUENCE must say IF NOT EXISTS'],
        // eslint-disable-next-line no-control-regex -- ESLint reads the \b word boundary as the backspace control character
        [/(DROP TABLE|TRUNCATE|DELETE FROM|DROP COLUMN)/, 'the migration is not destructive'],
      ];

      for (const [pattern, label] of rules) {
        expect(!pattern.test(sql), `${file}: ${label}`).toBe(true);
      }
    }

    expect(checked >= 8, `the guarded-DDL rule covered ${checked} migration(s)`).toBe(true);
  });
});
