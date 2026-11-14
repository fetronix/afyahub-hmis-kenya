#!/usr/bin/env node
/**
 * JaliCare HMIS — take a database backup.
 *
 *   npm run db:backup
 *   node scripts/backup/db-backup.mjs --engine logical --out /srv/jalicare/backups
 *
 * Exits non-zero on any failure, so a scheduler that only checks the exit status
 * will not record a failed backup as a success. A backup that wrote no file, or
 * wrote a file whose checksum cannot be re-read, is a failure — not a warning.
 */
import { stat } from 'node:fs/promises';

import {
  applyRetention,
  archiveName,
  describeTarget,
  manifestPathFor,
  resolveBackupDir,
  resolveConfig,
  resolveKey,
  sha256,
  sha256File,
  writeEncryptedArchive,
  writeManifest,
} from './backup-lib.mjs';
import { dumpLogical, dumpWithPgDump, findTools } from './engines.mjs';

function parseArgs(argv) {
  const args = { engine: 'auto', encrypt: true, keepCount: 14, keepDays: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--engine') args.engine = next();
    else if (arg === '--out') args.out = next();
    else if (arg === '--no-encrypt') args.encrypt = false;
    else if (arg === '--keep') args.keepCount = Number(next());
    else if (arg === '--days') args.keepDays = Number(next());
    else if (arg === '--json') args.json = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConfig();
  const dir = resolveBackupDir(args.out ? { BACKUP_DIR: args.out } : process.env);
  const key = args.encrypt ? await resolveKey() : null;

  if (args.encrypt && !key)
    throw new Error(
      'No backup encryption key. Set BACKUP_ENCRYPTION_KEY (base64, 32 bytes) or ' +
        'BACKUP_ENCRYPTION_KEY_FILE, or pass --no-encrypt to store a plaintext archive deliberately.',
    );

  const tools = await findTools();
  const engine = args.engine === 'auto' ? (tools.pg_dump ? 'pgdump' : 'logical') : args.engine;

  const startedAt = Date.now();
  const dump =
    engine === 'pgdump' ? await dumpWithPgDump(config, tools) : await dumpLogical(config);

  const name = archiveName(config.database);
  const { archivePath, encrypted } = await writeEncryptedArchive(dir, name, dump.payload, key);
  const checksum = await sha256File(archivePath);
  const info = await stat(archivePath);

  /* Read the file back through the same decrypt path a restore would use. A
     backup that cannot be read is not a backup, and finding that out now is
     cheap. */
  const roundTrip = await import('./backup-lib.mjs').then((module) =>
    module.readArchiveBuffer(archivePath, key),
  );
  if (sha256(roundTrip) !== sha256(dump.payload))
    throw new Error('Read-back check failed: the stored archive does not match what was written.');

  let tableCount = null;
  let rowCount = null;
  let migrationCount = null;
  if (dump.engine === 'logical') {
    const archive = JSON.parse(roundTrip.toString('utf8'));
    tableCount = archive.tables.length;
    rowCount = archive.tables.reduce((total, entry) => total + entry.rows.length, 0);
    migrationCount = archive.migrationCount;
  }

  const manifest = {
    formatVersion: 1,
    engine: dump.engine,
    schemaIncluded: dump.schemaIncluded,
    /** Restating the engine's contract in the manifest keeps it visible at 3am. */
    restoreRequires:
      dump.engine === 'logical'
        ? 'Target database must already carry the schema at migrationCount (run npm run db:migrate).'
        : 'Self-contained: restores structure and data.',
    createdAt: new Date().toISOString(),
    database: config.database,
    target: describeTarget(config),
    archive: name,
    storedBytes: info.size,
    payloadBytes: dump.payload.length,
    sha256: checksum,
    encrypted: Boolean(encrypted),
    encryption: encrypted ? 'aes-256-gcm' : null,
    tableCount,
    rowCount,
    migrationCount,
    durationMs: Date.now() - startedAt,
  };
  await writeManifest(archivePath, manifest);

  const retention = await applyRetention(dir, {
    keepCount: args.keepCount,
    keepDays: args.keepDays,
    now: Date.now(),
  });

  const report = {
    ok: true,
    archivePath,
    manifestPath: manifestPathFor(archivePath),
    ...manifest,
    retention,
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`backup OK  ${archivePath}`);
    console.log(
      `  engine    ${manifest.engine}${manifest.encrypted ? ' (encrypted)' : ' (PLAINTEXT)'}`,
    );
    console.log(`  database  ${manifest.database}`);
    console.log(`  size      ${info.size} bytes stored, ${dump.payload.length} bytes payload`);
    console.log(`  sha256    ${checksum}`);
    if (tableCount !== null) console.log(`  contents  ${tableCount} tables, ${rowCount} rows`);
    console.log(`  manifest  ${manifestPathFor(archivePath)}`);
    if (retention.deleted.length) console.log(`  pruned    ${retention.deleted.join(', ')}`);
  }
  return report;
}

main().catch((error) => {
  console.error(`backup FAILED: ${error.message}`);
  process.exitCode = 1;
});
