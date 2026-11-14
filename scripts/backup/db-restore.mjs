#!/usr/bin/env node
/**
 * JaliCare HMIS — restore an archive into a target database.
 *
 *   node scripts/backup/db-restore.mjs --archive backups/x.jcbak --target jalicare_restore_20261027 --create
 *
 * SAFETY
 * ------
 * A restore is the most destructive thing an operator can run here, so the
 * guards are deliberately annoying:
 *
 *  - The configured application database is refused unless `--force` is passed.
 *    Restoring over the live database while people are using it is not a
 *    recovery step, it is a second outage.
 *  - A target whose name looks like production is refused outright, with no
 *    override, whatever the flags say.
 *  - A target that does not look like a test, drill, staging or restore database
 *    needs `--force`, which is the moment the operator should re-read the name.
 *
 * The restore itself drops and recreates objects inside the target only; it
 * never touches another database, and it never deletes the archive.
 */
import { resolve } from 'node:path';

import {
  describeTarget,
  readArchiveBuffer,
  readManifest,
  resolveBackupDir,
  resolveConfig,
  resolveKey,
} from './backup-lib.mjs';
import {
  createDatabase,
  databaseExists,
  findTools,
  restoreLogical,
  restoreWithPgRestore,
  tableFingerprint,
} from './engines.mjs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PRODUCTION_LIKE = /(^|[^a-z])(prod|production|live)([^a-z]|$)/i;
const RECOGNISED = /(restore|drill|test|sandbox|staging|copy|clone)/i;

function parseArgs(argv) {
  const args = { create: false, force: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--archive') args.archive = next();
    else if (arg === '--target') args.target = next();
    else if (arg === '--create') args.create = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--json') args.json = true;
  }
  return args;
}

async function newestArchive(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.jcbak'));
  if (names.length === 0) throw new Error(`No archives in ${dir}.`);
  const withTimes = await Promise.all(
    names.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return join(dir, withTimes[0].name);
}

class RestoreRefused extends Error {}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = resolveConfig();
  const archivePath = resolve(args.archive ?? (await newestArchive(resolveBackupDir())));

  if (!args.target) throw new RestoreRefused('--target <database> is required.');
  if (PRODUCTION_LIKE.test(args.target))
    throw new RestoreRefused(
      `Refusing to restore into "${args.target}": the name looks like a production database. ` +
        'This refusal has no override. Restore into a new database and promote it deliberately.',
    );
  if (args.target === source.database && !args.force)
    throw new RestoreRefused(
      `Refusing to restore over the configured application database "${args.target}". ` +
        'Pass --force only if you have stopped the application and intend to replace it.',
    );
  if (!RECOGNISED.test(args.target) && !args.force)
    throw new RestoreRefused(
      `Target "${args.target}" does not look like a restore, drill, test or staging database. ` +
        'Pass --force if that is genuinely the database you mean.',
    );

  const manifest = await readManifest(archivePath);
  const key = manifest.encrypted ? await resolveKey() : null;
  if (manifest.encrypted && !key)
    throw new RestoreRefused('The archive is encrypted and no key is configured.');

  const payload = await readArchiveBuffer(archivePath, key);
  const target = { ...source, database: args.target };

  if (!(await databaseExists(target))) {
    if (!args.create)
      throw new RestoreRefused(
        `Database "${args.target}" does not exist. Pass --create to create it.`,
      );
    await createDatabase(target);
  }

  /*
   * The logical engine carries data only. The schema has to exist first, at the
   * version the archive was taken from, or the restore would load rows into a
   * database that disagrees with them.
   */
  if (manifest.engine === 'logical') {
    const fingerprint = await tableFingerprint(target).catch(() => ({}));
    if (Object.keys(fingerprint).length === 0)
      throw new RestoreRefused(
        `"${args.target}" has no schema. This archive is the logical engine (data only). ` +
          `Create the schema first: SQL_DB_NAME=${args.target} npm run db:migrate`,
      );
  }

  const tools = await findTools();
  if (manifest.engine === 'pgdump') await restoreWithPgRestore(target, payload, tools);
  else await restoreLogical(target, payload);

  const counts = await tableFingerprint(target);
  const totalRows = Object.values(counts).reduce((sum, value) => sum + value, 0);

  const report = {
    ok: true,
    archivePath,
    engine: manifest.engine,
    archiveTakenAt: manifest.createdAt,
    sourceDatabase: manifest.database,
    target: describeTarget(target),
    tables: Object.keys(counts).length,
    totalRows,
  };
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`restore OK  ${manifest.database} -> ${args.target}`);
    console.log(`  engine    ${manifest.engine}`);
    console.log(`  taken     ${manifest.createdAt}`);
    console.log(`  contents  ${report.tables} tables, ${totalRows} rows`);
    console.log('  Next      verify the data, then promote deliberately.');
  }
}

main().catch((error) => {
  console.error(
    `restore ${error instanceof RestoreRefused ? 'REFUSED' : 'FAILED'}: ${error.message}`,
  );
  process.exitCode = 1;
});
