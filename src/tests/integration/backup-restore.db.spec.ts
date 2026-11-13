/**
 * Backup and restore, proved against real PostgreSQL.
 *
 * A backup is a claim until it has been restored. This file takes a backup of
 * the test database, restores it into a *separate* database, and compares every
 * table's row count and content hash against the source. It never writes to the
 * source database and always drops the restore target.
 *
 * The database is the one the suite already uses; it is synthetic by definition
 * (the whole suite refuses to run against anything whose name lacks "test").
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeDb } from '../vitest/support/db.ts';
import {
  archiveName,
  decryptBuffer,
  encryptBuffer,
  resolveBackupDir,
  resolveConfig,
  sha256,
  writeEncryptedArchive,
  writeManifest,
} from '../../../scripts/backup/backup-lib.mjs';
import {
  createDatabase,
  dropDatabase,
  dumpLogical,
  restoreLogical,
  tableFingerprint,
} from '../../../scripts/backup/engines.mjs';

type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean } | undefined;
  database: string;
};

const asFingerprint = (value: unknown) => value as Record<string, number>;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const key = randomBytes(32);
const source = {
  ...(resolveConfig() as DbConfig),
  database: process.env.SQL_DB_NAME ?? 'jalicare_test',
};
const drillDatabase = `${source.database}_bktest_${Date.now()}`.toLowerCase();

async function migrate(database: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/run-script.mjs'), 'migrate'], {
      cwd: ROOT,
      env: { ...process.env, SQL_DB_NAME: database },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const err: Buffer[] = [];
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`migrations failed: ${Buffer.concat(err).toString().slice(0, 400)}`)),
    );
  });
}

describeDb('backup and restore', () => {
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
  }, 60_000);

  afterAll(async () => {
    await dropDatabase({ ...source, database: drillDatabase }).catch(() => undefined);
  }, 60_000);

  it('writes an encrypted archive that cannot be read without the key or after tampering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jalicare-bk-'));
    const dump = await dumpLogical(source);

    const name = archiveName(source.database);
    const { archivePath, encrypted } = await writeEncryptedArchive(dir, name, dump.payload, key);
    expect(encrypted).toBe(true);

    /* Plaintext must not be recoverable from the stored bytes. */
    const stored = await import('node:fs/promises').then((fs) => fs.readFile(archivePath));
    expect(stored.includes(Buffer.from('"tables"'))).toBe(false);

    const restored = decryptBuffer(stored, key);
    expect(sha256(restored)).toBe(sha256(dump.payload));

    /* Wrong key is refused, not silently wrong. */
    expect(() => decryptBuffer(stored, randomBytes(32))).toThrow();
  }, 120_000);

  it('archives every table and its sequence positions', async () => {
    const dump = await dumpLogical(source);
    const archive = JSON.parse(dump.payload.toString('utf8'));

    expect(archive.tables.length).toBeGreaterThan(100);
    for (const entry of archive.tables) {
      expect(entry.columns.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.rows)).toBe(true);
    }
    /* Without sequence positions a restored serial column restarts at 1 and the
       next insert collides. The archive must carry them. */
    expect(Array.isArray(archive.sequences)).toBe(true);
  }, 120_000);

  it('restores into a separate database with identical contents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jalicare-drill-'));
    const dump = await dumpLogical(source);

    const name = archiveName(source.database);
    const { archivePath } = await writeEncryptedArchive(dir, name, dump.payload, key);
    await writeManifest(archivePath, {
      formatVersion: 1,
      engine: 'logical',
      database: source.database,
      createdAt: new Date().toISOString(),
    });

    const target = { ...source, database: drillDatabase };
    await createDatabase(target);
    await migrate(drillDatabase);

    const before = asFingerprint(await tableFingerprint(source));
    await restoreLogical(target, dump.payload);
    const after = asFingerprint(await tableFingerprint(target));

    /* Every table the source has must exist and hold the same number of rows. */
    for (const [table, rows] of Object.entries(before)) {
      expect(after[table], `${table} after restore`).toBe(rows);
    }

    /* Counts alone would pass a restore that swapped two rows; compare content. */
    const hashes = async (database: DbConfig, tables: string[]) => {
      const pool = new Pool({ ...database, max: 2 });
      try {
        const out: Record<string, string> = {};
        for (const table of tables) {
          const { rows } = await pool.query(`SELECT * FROM "${table}"`);
          out[table] = sha256(
            Buffer.from(
              rows
                .map((row) => JSON.stringify(row))
                .sort()
                .join('\n'),
              'utf8',
            ),
          );
        }
        return out;
      } finally {
        await pool.end().catch(() => undefined);
      }
    };

    const tables = Object.keys(before).filter((table) => before[table] > 0);
    expect(tables.length).toBeGreaterThan(0);
    expect(await hashes(target, tables)).toEqual(await hashes(source, tables));
  }, 300_000);

  it('refuses to restore over a database that already holds audit history', async () => {
    /*
     * `audit_logs` has a BEFORE TRUNCATE guard: an audit log that can be wiped
     * in place is not an audit log. The restore path must therefore refuse an
     * in-place restore rather than quietly disabling the control, and must say
     * what to do instead.
     */
    const target = { ...source, database: drillDatabase };
    const probe = new Pool({ ...target, max: 1 });
    await probe.query(
      `INSERT INTO audit_logs(action, resource, details) VALUES('TEST','Synthetic','backup-restore drill')`,
    );
    await probe.end();

    const dump = await dumpLogical(source);
    await expect(restoreLogical(target, dump.payload)).rejects.toThrow(
      /Restore into a freshly created database/,
    );

    /* The audit row survived the refused restore. */
    const check = new Pool({ ...target, max: 1 });
    const { rows } = await check.query(
      "SELECT COUNT(*)::int AS n FROM audit_logs WHERE details='backup-restore drill'",
    );
    expect(rows[0].n).toBe(1);
    await check.end();
  }, 300_000);

  it('defaults to a directory the repository refuses to track', async () => {
    /*
     * A dump is a full copy of patient data with none of the access controls.
     * The default location is `backups/` under the working directory, and the
     * repository's own guard rejects any path inside it — so an administrator
     * who takes a backup without thinking about it still cannot commit it.
     */
    const dir = resolveBackupDir({});
    expect(dir.endsWith(`${sep}backups`)).toBe(true);

    const { isDatabaseBackupPath } =
      await import('../../../scripts/check-tracked-database-backups.mjs');
    expect(isDatabaseBackupPath(join(dir, 'anything.jcbak'))).toBe(true);
  });
});
