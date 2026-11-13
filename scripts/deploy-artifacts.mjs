/**
 * Verify a deployment folder before it is uploaded.
 *
 * The cPanel guide (`docs/deployment/truehost-cpanel.md` §13) has a checklist,
 * and checklists are followed until the deploy happens at 22:40. Every failure
 * this script detects has already happened at least once to this project:
 *
 *   - `build/` uploaded without `build/scripts/`, so `db:status` fell back to
 *     `tsx` and hit the account's thread limit;
 *   - `dist/` uploaded with a stale `index.html` referencing a bundle that was
 *     not uploaded, producing a blank page while `/api/health` stayed 200;
 *   - `drizzle/` uploaded without `drizzle/meta/_journal.json`, which makes
 *     every migration look pending and invites a replay over live data;
 *   - `npm start` pointed at TypeScript, so cPanel's plain `node` could not
 *     run it at all.
 *
 * It reads files and prints findings. It never writes, uploads or connects to
 * anything — a deployment check that can break a deployment is not a check.
 *
 *   node scripts/deploy-artifacts.mjs [--root <dir>]
 *
 * Exit code 0 = every check passed, 1 = blocking finding, 2 = warnings only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Bundle entry points the server and its maintenance commands need. */
export const REQUIRED_ARTIFACTS = [
  'build/server.js',
  'build/scripts/migration-status.js',
  'build/scripts/migrate.js',
  'build/scripts/preflight.js',
  'build/scripts/seed-permissions.js',
  'build/scripts/clean-database.js',
  'build/scripts/bootstrap-admin.js',
  'dist/index.html',
  'drizzle/meta/_journal.json',
  'package.json',
  'package-lock.json',
];

const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

function stat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * @returns {{blocking: string[], warnings: string[], passed: string[]}}
 */
export function verifyDeployArtifacts(root) {
  const blocking = [];
  const warnings = [];
  const passed = [];

  for (const relativePath of REQUIRED_ARTIFACTS) {
    const full = join(root, relativePath);
    const info = stat(full);

    if (!info) {
      blocking.push(
        `Missing ${relativePath}. ${
          relativePath.startsWith('dist/')
            ? 'Run `npm run build` (vite) — without it every page is blank while the API stays healthy.'
            : relativePath.startsWith('build/')
              ? 'Run `npm run build:server`, then upload the whole build/ directory.'
              : 'Upload it; the server cannot start or cannot connect without it.'
        }`,
      );
      continue;
    }

    if (info.size === 0) {
      blocking.push(`${relativePath} is empty (0 bytes).`);
      continue;
    }

    passed.push(`${relativePath} (${kb(info.size)})`);
  }

  /* ---- the server bundle must be JavaScript a plain `node` can run ---- */

  const serverBundle = join(root, 'build/server.js');
  if (existsSync(serverBundle)) {
    const source = readFileSync(serverBundle, 'utf8');

    if (/^\s*(import|export)\s+[^'"(]*from\s+['"]\.\/src\//m.test(source)) {
      blocking.push(
        'build/server.js still imports from ./src/ — it is a TypeScript-era shim, not a bundle. cPanel runs plain `node` and will fail with ERR_MODULE_NOT_FOUND.',
      );
    }

    if (/\bfrom\s+['"]vite['"]/.test(source)) {
      blocking.push(
        'build/server.js imports vite at module scope. Production must load Vite only inside the development branch; otherwise every process pays for the whole bundler and the account runs out of threads.',
      );
    }
  }

  /* ---- package.json: what cPanel will actually run ---- */

  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    let pkg = null;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (error) {
      blocking.push(`package.json is not valid JSON: ${error.message}`);
    }

    if (pkg) {
      const start = pkg.scripts?.start;

      if (typeof start !== 'string') {
        blocking.push('package.json has no `start` script; cPanel falls back to `node server.js`.');
      } else if (!/\bbuild\/server\.js\b/.test(start)) {
        blocking.push(
          `\`npm start\` runs "${start}", not build/server.js. cPanel starts the app with plain \`node\`, which cannot execute TypeScript.`,
        );
      } else {
        passed.push('`npm start` points at build/server.js');
      }

      if (pkg.dependencies?.esbuild || pkg.dependencies?.vite || pkg.dependencies?.typescript) {
        const leaked = ['esbuild', 'vite', 'typescript'].filter((name) => pkg.dependencies?.[name]);
        warnings.push(
          `${leaked.join(', ')} listed in \`dependencies\`. They belong in devDependencies: production installs pull the bundler onto a shared account that cannot afford it.`,
        );
      }
    }
  }

  /* ---- drizzle: every migration file needs a journal row and vice versa ---- */

  const drizzleDir = join(root, 'drizzle');
  const journalPath = join(drizzleDir, 'meta/_journal.json');

  if (existsSync(drizzleDir) && existsSync(journalPath)) {
    let entries = [];
    try {
      entries = JSON.parse(readFileSync(journalPath, 'utf8')).entries ?? [];
    } catch (error) {
      blocking.push(`drizzle/meta/_journal.json is not valid JSON: ${error.message}`);
    }

    const sqlFiles = readdirSync(drizzleDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const journalTags = new Set(entries.map((entry) => `${entry.tag}.sql`));

    const orphanFiles = sqlFiles.filter((name) => !journalTags.has(name));
    const missingFiles = [...journalTags].filter((name) => !sqlFiles.includes(name));

    if (orphanFiles.length > 0) {
      blocking.push(
        `${orphanFiles.length} migration file(s) have no journal entry (${orphanFiles.slice(0, 3).join(', ')}…). The runner ignores them, so their schema changes silently never apply.`,
      );
    }

    if (missingFiles.length > 0) {
      blocking.push(
        `${missingFiles.length} journal entr(ies) have no .sql file (${missingFiles.slice(0, 3).join(', ')}…). The runner treats the database as drift and refuses to migrate.`,
      );
    }

    if (orphanFiles.length === 0 && missingFiles.length === 0) {
      passed.push(`${sqlFiles.length} migrations match the journal exactly`);
    }
  }

  return { blocking, warnings, passed };
}

function main(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = resolve(rootIndex === -1 ? process.cwd() : argv[rootIndex + 1]);

  console.log('');
  console.log(`Deployment artifact check: ${root}`);
  console.log('='.repeat(60));

  const { blocking, warnings, passed } = verifyDeployArtifacts(root);

  for (const line of passed) console.log(`  ok    ${line}`);

  for (const line of warnings) console.warn(`  warn  ${line}`);

  for (const line of blocking) console.error(`  FAIL  ${line}`);

  console.log('='.repeat(60));

  if (blocking.length > 0) {
    console.error(
      `${blocking.length} blocking finding(s). Do not upload this folder; fix it and build again.`,
    );
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`No blocking findings. ${warnings.length} warning(s) above are worth reading.`);
    process.exit(2);
  }

  console.log('Every artifact is present and consistent. Safe to upload.');
  console.log('This proves the folder is complete. It does not prove the host runs it.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2));
}
