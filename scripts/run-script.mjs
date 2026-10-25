/**
 * JaliCare HMIS
 * Script dispatcher: prefer the built JavaScript, fall back to TypeScript
 *
 * WHY THIS EXISTS
 * ---------------
 * One npm script has to work in two places:
 *
 *   - a developer machine, where `dist/` and `build/` may not exist and
 *     `tsx` is installed;
 *   - the production host, where running TypeScript through `tsx` costs
 *     an extra esbuild process and, on a shared account with a low
 *     thread ceiling, can abort with
 *     `pthread_create: Resource temporarily unavailable`.
 *
 * So: if `build/scripts/<name>.js` exists, run that with plain `node`
 * (one process, no compiler). Otherwise run the TypeScript source with
 * the locally installed tsx. The chosen path is printed, never guessed
 * silently.
 *
 *   node scripts/run-script.mjs migrate --dry-run
 *   node scripts/run-script.mjs migration-status --expect-0009
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** name -> TypeScript source, used when no bundle exists yet. */
const SOURCES = {
  'migration-status': 'scripts/migration-status.ts',
  migrate: 'scripts/migrate.ts',
  preflight: 'scripts/preflight.ts',
  'seed-permissions': 'src/seeds/permissions.ts',
  'clean-database': 'src/db/clean-database.ts',
};

const [name, ...args] = process.argv.slice(2);

if (!name || !SOURCES[name]) {
  console.error('');
  console.error(`Unknown script "${name ?? ''}".`);
  console.error(`Known: ${Object.keys(SOURCES).join(', ')}`);
  console.error('');
  process.exit(2);
}

const bundle = resolve(ROOT, 'build', 'scripts', `${name}.js`);
const source = resolve(ROOT, SOURCES[name]);

let command;
let commandArgs;

if (existsSync(bundle)) {
  command = process.execPath;
  commandArgs = [bundle, ...args];
  console.log(`[run-script] ${name}: build/scripts/${name}.js (node)`);
} else {
  const tsxCli = resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  if (!existsSync(tsxCli)) {
    console.error('');
    console.error(`Neither build/scripts/${name}.js nor tsx is available.`);
    console.error('');
    console.error('On a deployment host, build and upload the artifacts:');
    console.error('  npm run build:deploy        (on your machine)');
    console.error('');
    console.error('On a development machine, install dependencies first:');
    console.error('  npm install');
    console.error('');
    process.exit(2);
  }

  command = process.execPath;
  commandArgs = [tsxCli, source, ...args];
  console.log(`[run-script] ${name}: ${SOURCES[name]} (tsx, development)`);
}

const child = spawn(command, commandArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(`[run-script] Could not start ${name}:`, error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-script] ${name} terminated by ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
