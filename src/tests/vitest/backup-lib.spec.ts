/**
 * Backup archive format, encryption and retention.
 *
 * These are the parts of backup handling that must never be "approximately
 * right": if the cipher silently accepted a tampered file, or retention quietly
 * deleted the only good archive, the failure would surface during an incident
 * rather than during a test. No database is needed here — the restore path is
 * proved in `backup-restore.db.spec.ts`.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyRetention,
  decryptBuffer,
  encryptBuffer,
  readManifest,
  resolveKey,
  sha256,
  writeManifest,
} from '../../../scripts/backup/backup-lib.mjs';

const key = () => randomBytes(32);

describe('backup encryption', () => {
  it('round-trips an archive byte-for-byte', () => {
    const secret = key();
    const payload = Buffer.from('synthetic archive contents', 'utf8');
    const { buffer } = encryptBuffer(payload, secret);

    expect(buffer.includes(payload)).toBe(false); // actually enciphered
    expect(decryptBuffer(buffer, secret).equals(payload)).toBe(true);
  });

  it('round-trips a large binary payload', () => {
    const secret = key();
    const payload = randomBytes(200_000);
    expect(decryptBuffer(encryptBuffer(payload, secret).buffer, secret).equals(payload)).toBe(true);
  });

  it('refuses a tampered archive instead of returning corrupt data', () => {
    const secret = key();
    const { buffer } = encryptBuffer(Buffer.from('original'), secret);
    /* Flip one bit in the ciphertext: authenticated encryption must notice. */
    const tampered = Buffer.from(buffer);
    tampered[tampered.length - 1] ^= 0x01;

    expect(() => decryptBuffer(tampered, secret)).toThrow();
  });

  it('refuses the wrong key', () => {
    const { buffer } = encryptBuffer(Buffer.from('original'), key());
    expect(() => decryptBuffer(buffer, key())).toThrow();
  });

  it('rejects a file that is not an archive', () => {
    expect(() => decryptBuffer(Buffer.from('PK\u0003\u0004 not a backup'), key())).toThrow(
      /Not a JaliCare backup archive/,
    );
  });

  it('uses a fresh IV per archive, so identical payloads differ on disk', () => {
    const secret = key();
    const a = encryptBuffer(Buffer.from('same'), secret).buffer;
    const b = encryptBuffer(Buffer.from('same'), secret).buffer;
    expect(a.equals(b)).toBe(false);
  });
});

describe('encryption key resolution', () => {
  it('reads a base64 key from the environment', async () => {
    const secret = key();
    const resolved = await resolveKey({ BACKUP_ENCRYPTION_KEY: secret.toString('base64') });
    expect(resolved?.equals(secret)).toBe(true);
  });

  it('refuses a key of the wrong length rather than truncating it', async () => {
    await expect(
      resolveKey({ BACKUP_ENCRYPTION_KEY: Buffer.from('short').toString('base64') }),
    ).rejects.toThrow(/32 bytes/);
  });

  it('returns null when no key is configured, so the caller can decide', async () => {
    expect(await resolveKey({})).toBeNull();
  });
});

describe('manifest', () => {
  it('round-trips and records the format version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jalicare-manifest-'));
    const archive = join(dir, 'example.jcbak');
    await writeFile(archive, 'x');
    await writeManifest(archive, { formatVersion: 1, engine: 'logical', database: 'db' });

    const manifest = await readManifest(archive);
    expect(manifest.engine).toBe('logical');
  });

  it('refuses an archive written by a newer format', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jalicare-manifest-'));
    const archive = join(dir, 'future.jcbak');
    await writeFile(archive, 'x');
    await writeManifest(archive, { formatVersion: 99, engine: 'logical' });

    await expect(readManifest(archive)).rejects.toThrow(/cannot be read by this build/);
  });
});

describe('retention', () => {
  async function makeArchives(count: number) {
    const dir = await mkdtemp(join(tmpdir(), 'jalicare-retention-'));
    const now = Date.now();
    const names = [];
    for (let index = 0; index < count; index += 1) {
      const name = `db-${String(index).padStart(2, '0')}.jcbak`;
      await writeFile(join(dir, name), 'x');
      await writeManifest(join(dir, name), { formatVersion: 1, engine: 'logical' });
      /* Older index = older file, so index 0 is the newest. */
      const when = (now - index * 86_400_000) / 1000;
      await utimes(join(dir, name), when, when);
      names.push(name);
    }
    return dir;
  }

  it('keeps the newest N and deletes the rest with their manifests', async () => {
    const dir = await makeArchives(6);
    const result = await applyRetention(dir, { keepCount: 2, keepDays: 0 });

    expect(result.deleted).toHaveLength(4);
    expect(await readdir(dir)).toEqual(
      expect.arrayContaining(['db-00.jcbak', 'db-01.jcbak', 'db-00.jcbak.manifest.json']),
    );
    expect(await readdir(dir)).not.toContain('db-05.jcbak');
    expect(await readdir(dir)).not.toContain('db-05.jcbak.manifest.json');
  });

  it('never prunes an archive inside the age window, even beyond the count', async () => {
    const dir = await makeArchives(6);
    /* keepCount 1 would drop two, but everything is younger than 30 days. */
    const result = await applyRetention(dir, { keepCount: 1, keepDays: 30 });
    expect(result.deleted).toHaveLength(0);
    expect(await readdir(dir)).toHaveLength(12);
  });

  it('keeps every archive when there are fewer than the limit', async () => {
    const dir = await makeArchives(2);
    const result = await applyRetention(dir, { keepCount: 14, keepDays: 30 });
    expect(result.deleted).toHaveLength(0);
  });

  it('does nothing when the directory does not exist', async () => {
    const result = await applyRetention(join(tmpdir(), 'jalicare-does-not-exist-dir'), {});
    expect(result).toEqual({ deleted: [], kept: [] });
  });
});

describe('checksums', () => {
  it('is stable and distinguishes different payloads', () => {
    expect(sha256(Buffer.from('a'))).toBe(sha256(Buffer.from('a')));
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });
});
