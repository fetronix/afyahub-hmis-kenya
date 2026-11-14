/**
 * JaliCare HMIS — database backup, verification and restore primitives.
 *
 * WHY THIS IS A LIBRARY AND NOT FOUR SCRIPTS
 * ------------------------------------------
 * Backup, verify, restore and the drill must agree exactly on the archive
 * format, the checksum, the manifest and the retention rule. If each script
 * re-implemented any of that, a backup written by one could silently fail to
 * restore through another — which is the failure mode that makes people stop
 * trusting backups. One implementation, four entry points.
 *
 * TWO ENGINES, AND WHY
 * --------------------
 * `pg_dump` (engine `pgdump`) is the production path: a self-contained archive
 * that restores structure and data without needing the application repo.
 *
 * `logical` is a driver-based fallback for hosts where the PostgreSQL client
 * tools are not on PATH. It archives **data and sequence positions only**; the
 * schema it loads into must already exist at the recorded migration count. That
 * is a real limitation and it is written into every manifest the engine
 * produces, so nobody discovers it during an incident.
 *
 * A NOTE ON WHAT "VERIFIED" MEANS HERE
 * ------------------------------------
 * `verify` answers "is this file intact and is it the file we wrote?" — the
 * checksum matches, the cipher authenticates, the manifest agrees, and the
 * archive opens. It does NOT answer "will this restore into a working
 * database?" Only the restore drill answers that, by actually doing it.
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

export const FORMAT_VERSION = 1;
export const ALGORITHM = 'aes-256-gcm';

/* ------------------------------------------------------------------ config */

/**
 * Connection settings, read from the same `SQL_*` variables the migration
 * runner and the test suite use, so an operator has one set of names to learn.
 *
 * The password is read here and never written to a manifest, a log line or an
 * error message. `describeTarget` exists so that reporting can name the
 * database without ever being able to leak the credential.
 */
export function resolveConfig(env = process.env) {
  const config = {
    host: env.SQL_HOST ?? '127.0.0.1',
    port: Number(env.SQL_PORT ?? 5432),
    database: env.SQL_DB_NAME ?? env.SQL_DB ?? 'jalicare',
    user: env.SQL_ADMIN_USER ?? env.SQL_USER ?? 'postgres',
    password: env.SQL_ADMIN_PASSWORD ?? env.SQL_PASSWORD ?? '',
    ssl: env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
  return config;
}

/** "user@host:port/database" — safe to print. Never includes the password. */
export function describeTarget(config) {
  return `${config.user}@${config.host}:${config.port}/${config.database}`;
}

export function resolveBackupDir(env = process.env) {
  return resolve(env.BACKUP_DIR ?? join(process.cwd(), 'backups'));
}

/* -------------------------------------------------------------- encryption */

/**
 * The key comes from `BACKUP_ENCRYPTION_KEY` (base64, 32 bytes) or from a file
 * named by `BACKUP_ENCRYPTION_KEY_FILE` (raw text, trimmed). The same key must
 * be available at restore time; losing it loses the backup, which is stated in
 * the runbook because it is the one operational rule people get wrong.
 */
export async function resolveKey(env = process.env) {
  const inline = env.BACKUP_ENCRYPTION_KEY;
  if (inline && inline.trim() !== '') {
    const key = Buffer.from(inline.trim(), 'base64');
    if (key.length !== 32)
      throw new Error(
        'BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32).',
      );
    return key;
  }
  const file = env.BACKUP_ENCRYPTION_KEY_FILE;
  if (file && file.trim() !== '') {
    const key = Buffer.from((await readFile(file, 'utf8')).trim(), 'base64');
    if (key.length !== 32) throw new Error(`${file} must contain 32 bytes encoded as base64.`);
    return key;
  }
  return null;
}

/** AES-256-GCM: authenticated, so a corrupted or tampered file fails loudly. */
export function encryptBuffer(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    /* Layout: magic | iv | authTag | ciphertext. The magic lets verify reject
       a non-archive file before spending time deriving anything. */
    buffer: Buffer.concat([Buffer.from('JCBAK1\n', 'utf8'), iv, cipher.getAuthTag(), body]),
    iv: iv.toString('base64'),
  };
}

export function decryptBuffer(payload, key) {
  const magic = payload.subarray(0, 7).toString('utf8');
  if (magic !== 'JCBAK1\n') throw new Error('Not a JaliCare backup archive (bad magic bytes).');
  const iv = payload.subarray(7, 19);
  const tag = payload.subarray(19, 35);
  const body = payload.subarray(35);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/* ---------------------------------------------------------------- manifest */

export function archiveName(database, when = new Date()) {
  const stamp = when.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `${database}-${stamp}.jcbak`;
}

export function manifestPathFor(archivePath) {
  return `${archivePath}.manifest.json`;
}

export async function writeManifest(archivePath, manifest) {
  const path = manifestPathFor(archivePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

export async function readManifest(archivePath) {
  const raw = await readFile(manifestPathFor(archivePath), 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.formatVersion !== FORMAT_VERSION)
    throw new Error(
      `Archive format ${manifest.formatVersion} cannot be read by this build (expects ${FORMAT_VERSION}).`,
    );
  return manifest;
}

/* --------------------------------------------------------------- retention */

/**
 * Keep the newest `keepCount` archives, and everything younger than `keepDays`
 * days. An archive is pruned only when it fails BOTH tests, so a quiet fortnight
 * cannot leave an operator with a single backup.
 *
 * Returns what was deleted and what was kept, because a retention run that
 * silently removes more than intended is its own incident.
 */
export async function applyRetention(
  dir,
  { keepCount = 14, keepDays = 30, now = Date.now() } = {},
) {
  const entries = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.jcbak'));
  const archives = [];
  for (const name of entries) {
    const full = join(dir, name);
    const info = await stat(full);
    archives.push({ name, path: full, mtime: info.mtimeMs, size: info.size });
  }
  archives.sort((a, b) => b.mtime - a.mtime);

  const deleted = [];
  const kept = [];
  archives.forEach((archive, index) => {
    const withinCount = index < keepCount;
    const withinDays = now - archive.mtime < keepDays * 86_400_000;
    if (withinCount || withinDays) {
      kept.push(archive.name);
      return;
    }
    deleted.push(archive.name);
  });

  for (const name of deleted) {
    await unlink(join(dir, name)).catch(() => undefined);
    await unlink(`${join(dir, name)}.manifest.json`).catch(() => undefined);
  }
  return { deleted, kept };
}

/* ------------------------------------------------------------- in/out files */

export async function writeEncryptedArchive(dir, name, payload, key) {
  await mkdir(dir, { recursive: true });
  const archivePath = join(dir, name);
  if (key) {
    const { buffer } = encryptBuffer(payload, key);
    await writeFile(archivePath, buffer);
    return { archivePath, encrypted: true };
  }
  await writeFile(archivePath, payload);
  return { archivePath, encrypted: false };
}

export async function readArchiveBuffer(archivePath, key) {
  const payload = await readFile(archivePath);
  return key ? decryptBuffer(payload, key) : payload;
}

export { createWriteStream };
