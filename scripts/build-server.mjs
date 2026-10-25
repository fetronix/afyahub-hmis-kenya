/**
 * JaliCare HMIS
 * Deployment build — server and command-line bundles
 *
 * WHY THIS EXISTS
 * ---------------
 * cPanel's "Setup Node.js App" runs a JavaScript file with `node`, not
 * TypeScript. `npm start` used to be `node server.ts`, which only works
 * where Node is started through a TypeScript loader. On the production
 * host it fails before the port is opened.
 *
 * The same applies to the maintenance scripts. Running them through
 * `tsx` starts an extra esbuild service next to Node, and on a shared
 * account with a low thread/process ceiling that is enough to abort the
 * process with `pthread_create: Resource temporarily unavailable`
 * (exit 134). A plain `node build/scripts/*.js` starts one process and
 * no compiler service.
 *
 * OUTPUT
 * ------
 *   build/server.js                  the Express + static site server
 *   build/scripts/migration-status.js
 *   build/scripts/migrate.js
 *   build/scripts/seed-permissions.js
 *   build/scripts/clean-database.js
 *
 * Third-party packages stay external: `node_modules` is installed on
 * the host by cPanel, so bundling them again would duplicate native
 * modules (argon2, pg) and make the artifact fragile. Relative imports
 * of this project are bundled, so the output is self-contained apart
 * from npm dependencies.
 *
 * Run: node scripts/build-server.mjs
 */

import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'build');

/*
 * Node 22 is the oldest runtime this project supports, and a bundle
 * targeting it runs unchanged on the host's Node 24. Targeting a newer
 * version than the runtime would emit syntax it cannot parse.
 */
const TARGET = process.env.BUILD_TARGET ?? 'node22';

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: TARGET,
  sourcemap: false,
  minify: false,
  /*
   * Keep npm packages as imports. Native add-ons (argon2) and packages
   * with dynamic requires (express, pg) must not be inlined.
   */
  packages: 'external',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  /*
   * An ES module has no `require`, and a bundled CommonJS dependency can
   * still reach for one. This shim provides it.
   *
   * `__filename` and `__dirname` are deliberately NOT shimmed: app.ts
   * declares its own at module scope, and because esbuild flattens every
   * module into one scope, a banner copy collided with it —
   * "Identifier '__filename' has already been declared" at startup. The
   * bundle therefore ships only the name nothing else defines.
   */
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
};

const ENTRY_POINTS = [
  { in: 'server.ts', out: 'build/server.js' },
  { in: 'scripts/migration-status.ts', out: 'build/scripts/migration-status.js' },
  { in: 'scripts/migrate.ts', out: 'build/scripts/migrate.js' },
  { in: 'scripts/preflight.ts', out: 'build/scripts/preflight.js' },
  { in: 'src/seeds/permissions.ts', out: 'build/scripts/seed-permissions.js' },
  { in: 'src/db/clean-database.ts', out: 'build/scripts/clean-database.js' },
];

async function main() {
  /*
   * A stale artifact is worse than a missing one: cPanel would quietly
   * keep serving the previous bundle after a failed build. Clear it
   * first, and let a failure leave no server.js behind.
   */
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(resolve(OUT_DIR, 'scripts'), { recursive: true });

  const started = Date.now();

  /*
   * One build per entry with an explicit `outfile`. A shared `outdir`
   * with per-entry `out` names produced `server.js.js`: esbuild appends
   * the extension to whatever it is given, and a doubled name is exactly
   * the kind of silent mismatch that leaves cPanel starting a file the
   * build never wrote.
   */
  for (const entry of ENTRY_POINTS) {
    await build({
      ...common,
      entryPoints: [resolve(ROOT, entry.in)],
      outfile: resolve(ROOT, entry.out),
      write: true,
      logLevel: 'warning',
    });
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log('');
  console.log(`Built ${ENTRY_POINTS.length} bundles for ${TARGET} in ${seconds}s:`);
  for (const entry of ENTRY_POINTS) {
    console.log(`  ${entry.out}  <- ${entry.in}`);
  }
  console.log('');
  console.log('The client build is separate: npm run build (vite build -> dist/).');
  console.log('');
}

main().catch((error) => {
  console.error('');
  console.error('SERVER BUILD FAILED');
  console.error(error);
  process.exit(1);
});
