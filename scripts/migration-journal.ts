/**
 * JaliCare HMIS
 * Migration journal: one reading of drizzle/, shared by every script
 *
 * WHY THIS EXISTS
 * ---------------
 * `migrate.ts` and `migration-status.ts` each decided for themselves
 * what "applied" meant. The runner matched a recorded row on either the
 * file hash or the journal timestamp; the status script matched only on
 * the timestamp. A migration whose file was edited after it was applied
 * therefore showed as PENDING in the status output while the runner
 * correctly refused to replay it — two answers to the same question,
 * which is how an operator ends up "fixing" a database that was fine.
 *
 * This module is the single definition. It reads files only: no
 * database import, so a test can exercise it without SQL_* variables.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationPlan {
  tag: string;
  hash: string;
  folderMillis: number;
  statements: string[];
  bomStripped: boolean;
}

/** A row of the tracking table, however this database spells it. */
export interface AppliedMigration {
  hash: string | null;
  createdAt: number | null;
}

export interface MigrationClassification {
  /** Recorded here, by hash or by journal timestamp. */
  applied: MigrationPlan[];
  /** Never recorded. These are the ones a runner would execute. */
  pending: MigrationPlan[];
  /**
   * The journal timestamp is recorded but the file on disk has changed.
   * They will not run again here; the edit only reaches databases that
   * have not applied them yet.
   */
  editedAfterApply: MigrationPlan[];
  /** Pending, but older than the newest recorded row. */
  behindNewest: MigrationPlan[];
  /** Highest recorded timestamp, 0 when nothing is recorded. */
  newestRecorded: number;
}

export function migrationsDirectory(): string {
  return process.env.MIGRATIONS_DIR
    ? resolve(process.env.MIGRATIONS_DIR)
    : resolve(process.cwd(), 'drizzle');
}

export function journalPath(dir = migrationsDirectory()): string {
  return join(dir, 'meta', '_journal.json');
}

export function readJournal(dir = migrationsDirectory()): JournalEntry[] {
  const path = journalPath(dir);

  if (!existsSync(path)) {
    throw new Error(`No migration journal found at ${path}`);
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    entries?: JournalEntry[];
  };

  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    throw new Error('The migration journal has no entries.');
  }

  return parsed.entries;
}

export function readPlans(
  entries: JournalEntry[],
  dir = migrationsDirectory(),
): MigrationPlan[] {
  return entries.map((entry) => {
    const file = join(dir, `${entry.tag}.sql`);

    if (!existsSync(file)) {
      throw new Error(`Journal entry ${entry.tag} has no .sql file.`);
    }

    let raw = readFileSync(file, 'utf8');
    let bomStripped = false;

    /*
     * A UTF-8 BOM makes Postgres read the first statement as
     * "\uFEFFCREATE ..." and fail. 0008 shipped with one once; strip it
     * rather than repeat the incident.
     */
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

/**
 * Decide which migrations a database owes.
 *
 * A migration counts as applied when either of these is true:
 *
 *   - the exact file hash is recorded — this file ran here;
 *   - the journal timestamp is recorded — a migration at this point in
 *     the journal ran here, even if its text was edited afterwards.
 *
 * The second rule is what stops a corrected migration from being
 * replayed against the one database that must not see it run twice.
 */
export function classifyMigrations(
  plans: readonly MigrationPlan[],
  applied: readonly AppliedMigration[],
): MigrationClassification {
  const hashes = new Set(
    applied.map((row) => row.hash).filter((hash): hash is string => Boolean(hash)),
  );

  const millis = new Set(
    applied
      .map((row) => row.createdAt)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  );

  const newestRecorded = Array.from(millis).reduce(
    (max, value) => Math.max(max, value),
    0,
  );

  const appliedPlans: MigrationPlan[] = [];
  const pending: MigrationPlan[] = [];
  const editedAfterApply: MigrationPlan[] = [];

  for (const plan of plans) {
    const byHash = hashes.has(plan.hash);
    const byTimestamp = millis.has(plan.folderMillis);

    if (byHash || byTimestamp) {
      appliedPlans.push(plan);

      if (!byHash && byTimestamp) {
        editedAfterApply.push(plan);
      }
    } else {
      pending.push(plan);
    }
  }

  return {
    applied: appliedPlans,
    pending,
    editedAfterApply,
    behindNewest: pending.filter((plan) => plan.folderMillis <= newestRecorded),
    newestRecorded,
  };
}

/* ============================================================
   DESTRUCTIVE STATEMENTS
   ============================================================ */

/** SQL comments removed so a sentence about TRUNCATE is not a finding. */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

const DESTRUCTIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { label: 'DROP SCHEMA', pattern: /\bDROP\s+SCHEMA\b/i },
  { label: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { label: 'DROP CONSTRAINT', pattern: /\bDROP\s+CONSTRAINT\b/i },
  { label: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
  { label: 'DELETE FROM', pattern: /\bDELETE\s+FROM\b/i },
];

/**
 * Statements that mention a destructive verb in order to PREVENT it.
 *
 * Migration 0017 revokes TRUNCATE on audit_logs and installs a trigger
 * that fires before it. A scanner that only greps for the word would
 * report the audit trail's protection as a risk, and an operator who
 * learns to ignore that warning ignores the real one too.
 */
const PROTECTIVE_PREFIXES = [
  /^REVOKE\b/i,
  /^GRANT\b/i,
  /^CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
  /^CREATE\s+(OR\s+REPLACE\s+)?POLICY\b/i,
  /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
  /^ALTER\s+TABLE\b[^;]*\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
];

function isProtective(statement: string): boolean {
  const clean = stripSqlComments(statement).trim();

  return PROTECTIVE_PREFIXES.some((pattern) => pattern.test(clean));
}

export interface DestructiveFinding {
  tag: string;
  statementIndex: number;
  label: string;
  /** First line of the statement, trimmed for the console. */
  preview: string;
  /** True when the statement is written with IF EXISTS. */
  conditional: boolean;
}

/**
 * Every statement that removes data or schema, across a set of plans.
 *
 * Reported, never blocked here: migration 0002 legitimately drops a
 * column that a later design restored, and 0017 revokes TRUNCATE on the
 * audit table. The caller decides what to do; the operator needs to see
 * it before pressing enter.
 */
export function scanDestructiveStatements(
  plans: readonly MigrationPlan[],
): DestructiveFinding[] {
  const findings: DestructiveFinding[] = [];

  for (const plan of plans) {
    plan.statements.forEach((statement, statementIndex) => {
      if (isProtective(statement)) return;

      const clean = stripSqlComments(statement);

      for (const { label, pattern } of DESTRUCTIVE_PATTERNS) {
        if (!pattern.test(clean)) continue;

        findings.push({
          tag: plan.tag,
          statementIndex: statementIndex + 1,
          label,
          preview: clean.trim().split('\n')[0].slice(0, 160),
          conditional: /\bIF\s+EXISTS\b/i.test(clean),
        });
      }
    });
  }

  return findings;
}

/** True when the host resolves to this machine. */
export function isLocalDatabaseHost(host: string): boolean {
  const value = host.trim().toLowerCase();

  return (
    value === 'localhost' ||
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '0.0.0.0' ||
    value === ''
  );
}
