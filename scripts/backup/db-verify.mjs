#!/usr/bin/env node
/**
 * JaliCare HMIS — verify a backup archive.
 *
 *   npm run db:backup:verify                       (newest archive in BACKUP_DIR)
 *   node scripts/backup/db-verify.mjs <archive>    (a specific archive)
 *
 * What this proves: the file on disk is the file that was written, it decrypts,
 * and the archive's own contents agree with its manifest.
 *
 * What this does NOT prove: that the archive restores into a working database.
 * Only `npm run db:restore:drill` proves that, because only it actually does it.
 */
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  readArchiveBuffer,
  readManifest,
  resolveBackupDir,
  resolveKey,
  sha256File,
} from './backup-lib.mjs';
import { findTools } from './engines.mjs';
import { spawn } from 'node:child_process';

async function newestArchive(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.jcbak'));
  if (names.length === 0) throw new Error(`No archives in ${dir}.`);
  const withTimes = await Promise.all(
    names.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return join(dir, withTimes[0].name);
}

/** `pg_restore --list` on a custom-format archive: does the archive open at all? */
function listCustomArchive(tool, payload) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(tool, ['--list'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pg_restore --list exited ${code}: ${Buffer.concat(err).toString()}`));
        return;
      }
      const lines = Buffer.concat(out).toString('utf8').split('\n').filter(Boolean);
      resolvePromise(lines.length);
    });
    child.stdin.end(payload);
  });
}

async function main() {
  const archivePath = resolve(process.argv[2] ?? (await newestArchive(resolveBackupDir())));
  const key = await resolveKey();
  const checks = [];
  const fail = (check, detail) => checks.push({ check, ok: false, detail });
  const pass = (check, detail) => checks.push({ check, ok: true, detail });

  const manifest = await readManifest(archivePath).catch((error) => {
    fail('manifest readable', error.message);
    return null;
  });
  if (manifest)
    pass('manifest readable', `format ${manifest.formatVersion}, engine ${manifest.engine}`);

  const actual = await sha256File(archivePath);
  if (manifest && actual === manifest.sha256) pass('checksum matches manifest', actual);
  else
    fail('checksum matches manifest', `on disk ${actual}, manifest ${manifest?.sha256 ?? 'n/a'}`);

  if (manifest?.encrypted && !key) fail('decrypt', 'archive is encrypted but no key is configured');
  let payload = null;
  try {
    payload = await readArchiveBuffer(archivePath, key);
    pass('decrypts', manifest?.encrypted ? 'aes-256-gcm authenticated' : 'plaintext archive');
  } catch (error) {
    fail('decrypts', error.message);
  }

  if (payload && manifest?.engine === 'logical') {
    try {
      const archive = JSON.parse(payload.toString('utf8'));
      const rows = archive.tables.reduce((total, entry) => total + entry.rows.length, 0);
      if (archive.tables.length === manifest.tableCount)
        pass('table count matches manifest', `${archive.tables.length} tables`);
      else
        fail(
          'table count matches manifest',
          `${archive.tables.length} found, ${manifest.tableCount} recorded`,
        );
      if (rows === manifest.rowCount) pass('row count matches manifest', `${rows} rows`);
      else fail('row count matches manifest', `${rows} found, ${manifest.rowCount} recorded`);
    } catch (error) {
      fail('archive parses', error.message);
    }
  }

  if (payload && manifest?.engine === 'pgdump') {
    const tools = await findTools();
    if (!tools.pg_restore) fail('archive opens', 'pg_restore not available to inspect it');
    else {
      try {
        const entries = await listCustomArchive(tools.pg_restore, payload);
        pass('archive opens', `${entries} entries listed by pg_restore`);
      } catch (error) {
        fail('archive opens', error.message);
      }
    }
  }

  const ok = checks.every((check) => check.ok);
  console.log(
    JSON.stringify(
      { ok, archivePath, database: manifest?.database, target: manifest?.target, checks },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
  else
    console.log(
      `\nverify OK — archive is intact.\nThis does not prove it restores. Run: npm run db:restore:drill`,
    );
}

main().catch((error) => {
  console.error(`verify FAILED: ${error.message}`);
  process.exitCode = 1;
});
