#!/usr/bin/env node
/**
 * Reject database archives in the current Git index without opening them.
 * This prevents accidental reintroduction; it does NOT scan or clean history,
 * remote caches, forks, deployment artifacts, or copies already obtained.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const compressed = '(?:gz|bz2|xz|zst|lz4|br|zip)';
const postgresArchive = /\.(?:dump|pgdump|psql)(?:\..+)?$/i;
const databaseFile = new RegExp(`\\.(?:sqlite|sqlite3|db)(?:\\.${compressed}(?:\\..+)?)?$`, 'i');
const compressedSql = new RegExp(`\\.sql\\.${compressed}(?:\\..+)?$`, 'i');

export function isDatabaseBackupPath(path) {
  const normalized = String(path).replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  return (
    parts.slice(0, -1).some((part) => /^(?:backups|local-backups|dumps)$/i.test(part)) ||
    postgresArchive.test(name) ||
    databaseFile.test(name) ||
    compressedSql.test(name)
  );
}

export function findTrackedDatabaseBackups(gitOutput) {
  return gitOutput.split('\0').filter((path) => path && isDatabaseBackupPath(path));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tracked = execFileSync('git', ['ls-files', '--cached', '-z'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const findings = findTrackedDatabaseBackups(tracked);
    if (findings.length) {
      // Do not copy potentially sensitive names or contents into CI logs.
      console.error(
        `Tracked database backup guard: ${findings.length} prohibited path(s). Investigate privately; Git history is not checked.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        'Tracked database backup guard: no prohibited current paths. Git history and external copies are NOT checked.',
      );
    }
  } catch {
    console.error('Tracked database backup guard could not inspect the Git index.');
    process.exitCode = 1;
  }
}
