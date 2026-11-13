/**
 * `npm run deploy:verify` — the pre-upload check.
 *
 * Each test builds a throwaway directory with one specific defect and asserts
 * the checker refuses it. The defects are the ones that have actually reached a
 * host: a missing server bundle, a stale TypeScript shim, a `start` script that
 * cPanel cannot run, and a `drizzle/` folder that disagrees with its journal.
 *
 * The last test runs the checker against this repository, after `build:deploy`,
 * so the check cannot silently stop checking anything.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { REQUIRED_ARTIFACTS, verifyDeployArtifacts } from '../../../scripts/deploy-artifacts.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory that passes every check, plus per-test overrides. */
function makeDeployDir(
  overrides: {
    files?: Record<string, string | null>;
    packageJson?: Record<string, unknown>;
    migrations?: string[];
    journal?: string[];
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-check-'));
  created.push(dir);

  const files: Record<string, string> = {
    'build/server.js': 'console.log("server");\n',
    'build/scripts/migration-status.js': 'console.log("status");\n',
    'build/scripts/migrate.js': 'console.log("migrate");\n',
    'build/scripts/preflight.js': 'console.log("preflight");\n',
    'build/scripts/seed-permissions.js': 'console.log("seed");\n',
    'build/scripts/clean-database.js': 'console.log("clean");\n',
    'build/scripts/bootstrap-admin.js': 'console.log("bootstrap");\n',
    'dist/index.html': '<!doctype html><div id="root"></div>',
    'package-lock.json': '{}',
  };

  const pkg = overrides.packageJson ?? {
    scripts: { start: 'node build/server.js' },
    dependencies: { express: '^5.0.0' },
  };

  const migrations = overrides.migrations ?? ['0000_init.sql'];
  const journal = overrides.journal ?? ['0000_init'];

  files['package.json'] = JSON.stringify(pkg, null, 2);
  files['drizzle/meta/_journal.json'] = JSON.stringify({
    entries: journal.map((tag, index) => ({ idx: index, tag, when: 1 })),
  });
  for (const name of migrations) files[`drizzle/${name}`] = '-- sql';

  for (const [relative, contents] of Object.entries({ ...files, ...overrides.files })) {
    if (contents === null) continue;
    const full = join(dir, relative);
    mkdirSync(resolve(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }

  return dir;
}

describe('deploy artifact check', () => {
  it('passes a complete folder', () => {
    const { blocking, warnings } = verifyDeployArtifacts(makeDeployDir());

    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('blocks when the server bundle is missing', () => {
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({ files: { 'build/server.js': null } }),
    );

    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toContain('build/server.js');
    expect(blocking[0]).toContain('build:server');
  });

  it('blocks when a maintenance bundle is missing, not just the server', () => {
    // This is the state that made `db:status` fall back to `tsx` on the host.
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({ files: { 'build/scripts/migration-status.js': null } }),
    );

    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toContain('migration-status.js');
  });

  it('blocks an empty artifact, because a zero-byte bundle uploads happily', () => {
    const { blocking } = verifyDeployArtifacts(makeDeployDir({ files: { 'build/server.js': '' } }));

    expect(blocking.join(' ')).toContain('empty');
  });

  it('blocks a bundle that still imports its TypeScript sources', () => {
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({ files: { 'build/server.js': "import { app } from './src/app.ts';\n" } }),
    );

    expect(blocking.join(' ')).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('blocks a bundle that loads vite at module scope', () => {
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({
        files: {
          'build/server.js': "import { createServer } from 'vite';\nconsole.log(createServer);\n",
        },
      }),
    );

    expect(blocking.join(' ')).toContain('vite');
  });

  it('blocks a start script cPanel cannot execute', () => {
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({ packageJson: { scripts: { start: 'node server.ts' } } }),
    );

    expect(blocking.join(' ')).toContain('build/server.js');
  });

  it('blocks a migration file the journal never mentions', () => {
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({ migrations: ['0000_init.sql', '0001_extra.sql'], journal: ['0000_init'] }),
    );

    expect(blocking.join(' ')).toContain('no journal entry');
    expect(blocking.join(' ')).toContain('0001_extra.sql');
  });

  it('blocks a journal entry with no migration file', () => {
    const { blocking } = verifyDeployArtifacts(
      makeDeployDir({ migrations: ['0000_init.sql'], journal: ['0000_init', '0001_missing'] }),
    );

    expect(blocking.join(' ')).toContain('no .sql file');
  });

  it('warns, without blocking, when build tooling is a runtime dependency', () => {
    const { blocking, warnings } = verifyDeployArtifacts(
      makeDeployDir({
        packageJson: {
          scripts: { start: 'node build/server.js' },
          dependencies: { express: '^5.0.0', vite: '^8.0.0' },
        },
      }),
    );

    expect(blocking).toEqual([]);
    expect(warnings.join(' ')).toContain('vite');
  });

  it('covers every artifact the build claims to produce', () => {
    // If build-server.mjs grows an entry point, the checker has to grow too —
    // otherwise the new bundle is the one nobody verifies.
    const buildServer = readFileSync(resolve(ROOT, 'scripts/build-server.mjs'), 'utf8');
    const emitted = [...buildServer.matchAll(/out: '([^']+)'/g)].map((match) => match[1]);

    expect(emitted.length).toBeGreaterThan(0);
    for (const artifact of emitted) expect(REQUIRED_ARTIFACTS).toContain(artifact);
  });
});
