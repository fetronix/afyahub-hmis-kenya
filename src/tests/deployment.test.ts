/**
 * JaliCare HMIS
 * Deployment contracts — Truehost cPanel
 *
 * These assertions exist because every one of them is a failure that
 * only appears on the hosting account, long after the developer's
 * machine said everything was fine:
 *
 *   1. `npm start` runs a built JavaScript file, not TypeScript.
 *   2. The build deterministically produces build/server.js.
 *   3. The production bundle never loads Vite.
 *   4. `--dry-run` performs no writes — no schema, no tracking table.
 *   5. The runner and the status command agree on what "applied" means.
 *   6. A database with tables but no history is refused, because a full
 *      replay would run 0002's DROP COLUMN against patient data.
 *   7. The server reads PORT from the environment and binds 0.0.0.0.
 *   8. Static assets are served from an absolute path, and client routes
 *      fall through to the SPA while /api does not.
 *   9. No secret is printed by any startup or deployment path.
 *
 * No database is required. Source-level behaviour that would need a live
 * PostgreSQL (the destructive-DDL scan, the classification rules) is
 * exercised against the real journal in this repository.
 *
 * Run with: npx tsx src/tests/deployment.test.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyMigrations,
  isLocalDatabaseHost,
  migrationsDirectory,
  readJournal,
  readPlans,
  scanDestructiveStatements,
  stripSqlComments,
} from '../../scripts/migration-journal.ts';
import { containsCode } from './support/source-text.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

const ROOT = resolve(import.meta.dirname, '..', '..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

/**
 * Source with comments and string literals removed.
 *
 * A file that PRINTS "no TRUNCATE, no DROP" is not performing one. Checks
 * for destructive verbs must look at code, not at the words describing
 * the guarantee.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function packageJson(): {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  type?: string;
} {
  return JSON.parse(source('package.json'));
}

/* ============================================================
   1. PACKAGE SCRIPTS
   ============================================================ */

function testScripts(): void {
  console.log('1. The production command runs JavaScript, not TypeScript');

  const pkg = packageJson();
  const scripts = pkg.scripts;

  assertEqual(pkg.type, 'module', 'The package is ESM, so the build must emit ESM');

  /* cPanel runs `npm start` or the file directly, with plain node. */
  assert(
    scripts.start === 'node build/server.js',
    `start must run the built file (got "${scripts.start}")`,
  );
  assert(!/node\s+server\.ts/.test(scripts.start), 'start must never ask node to run TypeScript');

  assert(scripts.dev === 'tsx server.ts', 'Development keeps the TypeScript runner');
  assert(scripts['start:dev'] === 'tsx server.ts', 'A developer can still start the source build');

  /* Every deployment step exists and is a real command. */
  for (const name of [
    'build',
    'build:server',
    'build:deploy',
    'clean',
    'db:status',
    'db:preflight',
    'db:migrate',
    'db:migrate:dry',
    'db:seed:permissions',
    'db:seed:permissions:dry',
    'test',
  ]) {
    assert(typeof scripts[name] === 'string' && scripts[name].length > 0, `Script ${name} exists`);
  }

  assert(
    scripts['build:deploy'].includes('build:server') && scripts['build:deploy'].includes('build'),
    'build:deploy builds the client and the server',
  );

  assert(scripts['db:migrate:dry'].endsWith('--dry-run'), 'The dry-run script passes --dry-run');
  assert(scripts['db:seed:permissions:dry'].endsWith('--dry-run'), 'The seed has a dry run');

  /*
   * Every maintenance command goes through the dispatcher, so it uses
   * the built bundle on the host and tsx only in development. `tsx`
   * starts an extra esbuild process, which is the resource the host ran
   * out of.
   */
  for (const name of ['db:status', 'db:preflight', 'db:migrate', 'db:seed:permissions']) {
    assert(
      scripts[name].startsWith('node scripts/run-script.mjs'),
      `${name} runs through the dispatcher, not tsx`,
    );
  }

  assert(scripts['test'].includes('test:deploy'), 'npm test includes the deployment contracts');

  /* Deps that the bundle imports at runtime must be production deps. */
  for (const dependency of ['express', 'pg', 'drizzle-orm', 'dotenv', 'argon2', 'helmet']) {
    assert(Boolean(pkg.dependencies[dependency]), `${dependency} is a runtime dependency`);
  }
}

/* ============================================================
   2. BUILD DETERMINISM
   ============================================================ */

function testBuildConfiguration(): void {
  console.log('2. The build produces build/server.js deterministically');

  const build = source('scripts/build-server.mjs');

  assert(
    build.includes('outfile: resolve(ROOT, entry.out)'),
    'Each bundle is written to an explicit outfile',
  );
  assert(build.includes("out: 'build/server.js'"), 'The server bundle is named build/server.js');
  assert(build.includes("format: 'esm'"), 'The output is ESM, matching package.json type=module');
  assert(
    build.includes("packages: 'external'"),
    'npm packages stay external; native modules are not re-bundled',
  );
  assert(
    build.includes('await rm(OUT_DIR'),
    'A failed build cannot leave a stale server.js behind',
  );
  assert(
    build.includes('target: TARGET') && build.includes("'node22'"),
    'The bundle targets a Node version the host actually runs',
  );

  /*
   * The banner must not declare __filename/__dirname: app.ts declares
   * its own, esbuild flattens both into one scope, and the result was
   * "Identifier '__filename' has already been declared" at startup.
   */
  const banner = build.slice(
    build.indexOf('banner:'),
    build.indexOf('},', build.indexOf('banner:')),
  );

  assert(
    !/const __filename =/.test(banner),
    'The banner does not declare __filename (it collides with app.ts)',
  );
  assert(!/const __dirname =/.test(banner), 'The banner does not declare __dirname');
  assert(
    banner.includes('createRequire(import.meta.url)'),
    'The banner provides require() for bundled CommonJS interop',
  );

  /* The dispatcher prefers the bundle and says which it chose. */
  const dispatcher = source('scripts/run-script.mjs');

  assert(
    dispatcher.includes('existsSync(bundle)'),
    'The dispatcher checks for the built bundle first',
  );
  assert(dispatcher.includes('build/scripts/'), 'The dispatcher looks in build/scripts');
  assert(
    dispatcher.includes("'tsx', 'dist', 'cli.mjs'"),
    'It falls back to the locally installed tsx in development',
  );

  /*
   * A committed artifact is not required (build/ is ignored), but if it
   * is present it must be the entry point the scripts name.
   */
  if (existsSync(resolve(ROOT, 'build/server.js'))) {
    const bundle = source('build/server.js');

    assert(
      bundle.includes('createRequire(import.meta.url)'),
      'The built server has the require shim',
    );
    assert(
      /import\("vite"\)/.test(bundle) && !/from "vite"/.test(bundle),
      'The built server imports vite dynamically, never statically',
    );
  }
}

/* ============================================================
   3. THE PRODUCTION SERVER NEVER LOADS VITE
   ============================================================ */

function testNoViteInProduction(): void {
  console.log('3. Production does not load Vite');

  const app = source('src/app.ts');

  assert(!/^\s*import .*from 'vite';/m.test(app), 'app.ts has no static vite import');
  assert(
    app.includes("await import('vite')"),
    'vite is imported lazily, inside the development branch',
  );

  const viteImport = app.indexOf("await import('vite')");
  const devBranch = app.indexOf('if (!isProduction) {');

  assert(
    devBranch > 0 && viteImport > devBranch,
    'The lazy import sits inside the development branch',
  );

  const productionBranch = app.indexOf('} else {', devBranch);

  assert(
    productionBranch > devBranch && viteImport < productionBranch,
    'Nothing in the production branch imports vite',
  );
}

/* ============================================================
   4. DRY RUN WRITES NOTHING
   ============================================================ */

function testDryRunIsReadOnly(): void {
  console.log('4. --dry-run performs no writes');

  const migrate = source('scripts/migrate.ts');

  /*
   * The exact defect reported: the runner created the schema and the
   * tracking table before it looked at --dry-run.
   */
  const createSchema = migrate.indexOf('CREATE SCHEMA IF NOT EXISTS drizzle');
  const dryRunReturn = migrate.indexOf('if (dryRun) {');

  assert(createSchema > 0, 'The runner does create the schema when it applies');
  assert(dryRunReturn > 0, 'The runner has a dry-run exit');
  assert(dryRunReturn < createSchema, 'The dry-run exit comes BEFORE the schema is created');

  /* No DDL or DML may appear between the plan print and the dry-run exit. */
  const beforeExit = migrate.slice(0, dryRunReturn);
  const tail = beforeExit.slice(beforeExit.lastIndexOf('printDestructive'));

  assert(!/client\.query\(/.test(tail), 'No statement runs on a client before the dry-run exits');
  assert(!/INSERT INTO/.test(tail), 'No tracking row is written on a dry run');

  /* And the read path must not create anything. */
  const status = source('scripts/migration-status.ts');

  assert(
    !/CREATE\s+(SCHEMA|TABLE)/i.test(stripSqlComments(status)),
    'The status command contains no CREATE statement at all',
  );
  assert(
    !/\b(INSERT|UPDATE|DELETE)\s/i.test(stripSqlComments(status).replace(/--[^\n]*/g, ' ')),
    'The status command contains no write statement',
  );

  const preflight = source('scripts/preflight.ts');

  assert(
    !/CREATE\s+(SCHEMA|TABLE)/i.test(stripSqlComments(preflight)),
    'Preflight never creates the tracking table',
  );

  /*
   * The executable proof: `npm run verify:dry-run` runs the BUILT runner
   * against a fake pg driver and fails if any statement it sends is a
   * write. It is not run from here because it needs build/server.js (or
   * specifically build/scripts/migrate.js) to exist.
   */
  assert(
    existsSync(resolve(ROOT, 'scripts/verify-dry-run.mjs')),
    'The executable dry-run proof exists',
  );

  const verification = source('scripts/verify-dry-run.mjs');

  assert(
    verification.includes("['empty', 'populated']"),
    'It checks a database with and without the tracking table',
  );
  assert(verification.includes('isWrite'), 'It classifies statements as writes');
  assert(
    packageJson().scripts['verify:dry-run'] === 'node scripts/verify-dry-run.mjs',
    'npm run verify:dry-run runs it',
  );

  /* The tracking table is created once, where migrations are applied. */
  const migrateCreates =
    migrate.split('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations').length - 1;

  assertEqual(migrateCreates, 1, 'The tracking table is created in exactly one place');

  assert(
    migrate.indexOf('if (!isLocalDatabaseHost(env.database.host) && !confirmed)') <
      migrate.indexOf('CREATE SCHEMA IF NOT EXISTS drizzle'),
    'A non-local host is refused before anything is written',
  );
}

/* ============================================================
   5. RUNNER AND STATUS AGREE
   ============================================================ */

function testClassificationConsistency(): void {
  console.log('5. The runner and the status command share one definition');

  const migrate = source('scripts/migrate.ts');
  const status = source('scripts/migration-status.ts');

  assert(
    migrate.includes('classifyMigrations(') && status.includes('classifyMigrations('),
    'Both import the shared classifier',
  );
  assert(
    migrate.includes("from './migration-journal.ts'") &&
      status.includes("from './migration-journal.ts'"),
    'Both import from the same module',
  );

  /* The behaviour the two used to disagree about. */
  const plans = [
    { tag: '0001_a', hash: 'hash-a', folderMillis: 1000, statements: [], bomStripped: false },
    {
      tag: '0002_b',
      hash: 'hash-b-edited',
      folderMillis: 2000,
      statements: [],
      bomStripped: false,
    },
    { tag: '0003_c', hash: 'hash-c', folderMillis: 3000, statements: [], bomStripped: false },
  ];

  const applied = [
    { hash: 'hash-a', createdAt: 1000 },
    /* 0002 ran, then its file was edited: the timestamp is recorded. */
    { hash: 'hash-b-original', createdAt: 2000 },
  ];

  const result = classifyMigrations(plans, applied);

  assertEqual(
    result.pending.map((plan) => plan.tag),
    ['0003_c'],
    'Only the unrecorded migration is pending',
  );
  assertEqual(
    result.editedAfterApply.map((plan) => plan.tag),
    ['0002_b'],
    'An edited applied migration is reported as drift, not as pending',
  );
  assertEqual(result.applied.length, 2, 'Both recorded migrations count as applied');

  /* Newer timestamp recorded than the journal knows: the rest is behind. */
  const behind = classifyMigrations([plans[2]], [{ hash: 'unknown', createdAt: 9000 }]);

  assertEqual(behind.pending.length, 1, 'The older pending migration is still listed');
  assertEqual(behind.behindNewest.length, 1, 'It is flagged as behind the newest row');
  assert(behind.newestRecorded === 9000, 'The newest recorded timestamp is reported');

  /* No history: everything is pending, nothing is silently applied. */
  const empty = classifyMigrations(plans, []);

  assertEqual(empty.pending.length, 3, 'Without history every migration is pending');
  assertEqual(empty.applied.length, 0, 'Nothing is assumed applied');
}

/* ============================================================
   6. THE REAL JOURNAL
   ============================================================ */

function testRealJournal(): void {
  console.log('6. The repository journal is intact');

  const dir = migrationsDirectory();
  const entries = readJournal(dir);
  const plans = readPlans(entries, dir);

  assert(plans.length >= 23, `The journal has ${plans.length} migrations`);
  assertEqual(plans.length, entries.length, 'Every journal entry has a .sql file');

  for (const plan of plans) {
    assert(plan.statements.length > 0, `${plan.tag} contains statements`);
    assert(/^[0-9a-f]{64}$/.test(plan.hash), `${plan.tag} has a sha256 hash`);
    assert(Number.isFinite(plan.folderMillis), `${plan.tag} has a journal timestamp`);
  }

  /* Journal timestamps are unique; two entries at one millisecond
     would make timestamp matching ambiguous. */
  const stamps = new Set(plans.map((plan) => plan.folderMillis));
  assertEqual(stamps.size, plans.length, 'Journal timestamps are unique');

  /* The tracker format both scripts write. */
  const migrate = source('scripts/migrate.ts');

  assert(
    migrate.includes('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)'),
    'The tracking row records hash and journal timestamp',
  );
  assert(
    migrate.includes('[plan.hash, plan.folderMillis]'),
    'The values written are the file hash and the journal timestamp',
  );

  /* Drizzle's own table shape, so `drizzle-kit migrate` stays compatible. */
  assert(
    migrate.includes('hash text NOT NULL') && migrate.includes('created_at bigint'),
    "The tracking table matches drizzle-kit's schema",
  );
}

/* ============================================================
   7. DESTRUCTIVE SQL AND UNMANAGED DATABASES
   ============================================================ */

function testDestructiveGuard(): void {
  console.log('7. Destructive SQL is reported and unmanaged databases are refused');

  const dir = migrationsDirectory();
  const plans = readPlans(readJournal(dir), dir);
  const findings = scanDestructiveStatements(plans);

  const dropColumn = findings.find(
    (finding) => finding.tag.startsWith('0002') && finding.label === 'DROP COLUMN',
  );

  assert(
    Boolean(dropColumn),
    "The scan finds 0002's DROP COLUMN, which is why a full replay is refused",
  );
  assert(
    Boolean(dropColumn?.preview.toLowerCase().includes('patients')),
    'The finding names the patients table',
  );
  assert(
    dropColumn?.conditional === false,
    'A DROP COLUMN without IF EXISTS is marked unconditional',
  );

  /*
   * 0017 mentions TRUNCATE twice, both times to PREVENT it: a trigger
   * that fires before TRUNCATE and a REVOKE on the audit table. A
   * scanner that only greps for the word reports the audit trail's own
   * protection as a risk — and trains the operator to ignore the real
   * warning.
   */
  assert(
    !findings.some((finding) => finding.tag.startsWith('0017')),
    'Protective statements about TRUNCATE are not reported as destructive',
  );

  assert(
    stripSqlComments('-- TRUNCATE patients\nSELECT 1').trim() === 'SELECT 1',
    'Comments are stripped before scanning',
  );

  const scanOne = (sql: string) =>
    scanDestructiveStatements([
      { tag: 'test', hash: 'h', folderMillis: 1, statements: [sql], bomStripped: false },
    ]);

  assert(scanOne('TRUNCATE audit_logs;').length === 1, 'A real TRUNCATE is reported');
  assert(
    scanOne('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;').length === 0,
    'A REVOKE is not a destructive statement',
  );
  assert(
    scanOne(
      'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION f();',
    ).length === 0,
    'A trigger that blocks TRUNCATE is not destructive',
  );
  assert(scanOne('DELETE FROM patients;').length === 1, 'A real DELETE is reported');
  assert(
    scanOne('GRANT SELECT, DELETE ON patients TO app;').length === 0,
    'A GRANT is not a destructive statement',
  );

  const migrate = source('scripts/migrate.ts');

  assert(
    migrate.includes('const unmanaged = !table && tableCount > 0'),
    'The runner detects a database with tables and no tracking table',
  );
  assert(
    migrate.includes('BLOCKED — this database has'),
    'It refuses rather than replaying every migration',
  );
  assert(
    migrate.includes('--force-replay'),
    'An explicit escape hatch exists for a scratch database',
  );
  assert(
    migrate.includes('Never drop or recreate patient tables'),
    'The refusal tells the operator not to rebuild patient tables',
  );

  /*
   * The second dangerous state: a tracking table with rows that match
   * nothing in this journal. "Nothing matched, so everything is
   * pending" would replay 0002 over live data.
   */
  assert(
    migrate.includes('const orphanedHistory ='),
    'The runner detects history that matches no journal entry',
  );
  assert(migrate.includes('none of which match this journal'), 'It refuses instead of replaying');
  const orphanGuard = migrate.indexOf('const orphanedHistory =');

  assert(
    migrate.indexOf('if (!forceReplay)', orphanGuard) > orphanGuard,
    'The orphan guard can still be overridden only by --force-replay',
  );

  /*
   * The classifier itself is what makes an orphan detectable: rows that
   * match nothing leave `applied` empty while `applied.length` (the raw
   * count) is not.
   */
  const orphan = classifyMigrations(
    [{ tag: '0002_x', hash: 'h2', folderMillis: 2000, statements: [], bomStripped: false }],
    [{ hash: 'different', createdAt: 999_999 }],
  );

  assertEqual(orphan.applied.length, 0, 'A foreign row matches no migration');
  assertEqual(orphan.pending.length, 1, 'The migration counts as pending');
  assert(orphan.behindNewest.length === 1, 'and is flagged as older than the newest recorded row');

  const preflight = source('scripts/preflight.ts');

  assert(preflight.includes('Unmanaged database'), 'Preflight names the same condition');
  assert(
    preflight.includes('match nothing in this journal'),
    'Preflight reports orphaned history rather than a plain pending count',
  );
  assert(
    preflight.includes('createdTables'),
    'Preflight reports table-creation conflicts with what already exists',
  );
  assert(preflight.includes('--backup='), 'Preflight can verify a named backup');

  /* Host classification for the confirmation gate. */
  assert(isLocalDatabaseHost('localhost'), 'localhost is local');
  assert(isLocalDatabaseHost('127.0.0.1'), '127.0.0.1 is local');
  assert(!isLocalDatabaseHost('db.truehost.co.ke'), 'A remote host is not local');
}

/* ============================================================
   8. SERVER STARTUP
   ============================================================ */

function testServerStartup(): void {
  console.log('8. The server listens where cPanel expects it');

  const server = source('server.ts');

  assert(server.includes('process.env.PORT'), 'The port comes from the environment');
  assert(server.includes('DEFAULT_PORT = 3000'), 'There is a documented local fallback');
  assert(server.includes("'0.0.0.0'"), 'The server binds every interface');
  assert(server.includes('app.listen(port, HOST'), 'The resolved port and host are used together');

  assert(server.includes("httpServer.on('error'"), 'A late listen error is handled');
  assert(server.includes('EADDRINUSE'), 'A second instance is reported clearly');
  assert(
    server.includes("process.on('uncaughtException'"),
    'An uncaught exception shuts down cleanly instead of hanging',
  );
  assert(
    server.includes("process.on('unhandledRejection'"),
    'An unhandled rejection shuts down cleanly',
  );
  assert(
    server.includes("process.on('SIGTERM'") && server.includes("process.on('SIGINT'"),
    'Both stop signals are handled',
  );
  assert(server.includes('await pool.end()'), 'The database pool is closed on shutdown');
  assert(
    server.includes('Graceful shutdown timed out'),
    "A stuck shutdown cannot outlive the supervisor's patience",
  );

  /* Nothing in the startup path may print a credential. */
  for (const file of ['server.ts', 'src/app.ts', 'src/config/env.ts', 'src/db/index.ts']) {
    const text = source(file);

    assert(
      !/console\.(log|info|warn|error)\([^)]*password/i.test(text),
      `${file} never logs a password`,
    );
  }
}

/* ============================================================
   9. STATIC ASSETS AND CLIENT ROUTES
   ============================================================ */

function testStaticServing(): void {
  console.log('9. The built client is served from an absolute path');

  const app = source('src/app.ts');

  assert(
    app.includes('const STATIC_DIR = process.env.STATIC_DIR'),
    'The static root can be overridden per deployment',
  );
  assert(app.includes("path.resolve(__dirname, 'dist')"), 'It defaults to dist/ beside the bundle');
  assert(
    app.includes("path.join(STATIC_DIR, 'index.html')"),
    'The SPA shell is resolved from the same absolute root',
  );
  assert(
    app.includes('const hasClientBuild = existsSync(indexHtml)'),
    'A missing client build is detected, not ignored',
  );
  assert(
    app.includes('No client build found.'),
    'A missing build is reported with the path and the command',
  );
  assert(
    app.includes("maxAge: '1y'") && app.includes('immutable: true'),
    'Hashed assets are cached for a year',
  );
  assert(
    app.includes("res.setHeader('Cache-Control', 'no-store, must-revalidate')"),
    'The shell is never cached',
  );
  assert(
    app.includes("if (req.path.startsWith('/api/'))"),
    'An unknown /api path is not answered with the SPA shell',
  );
  assert(
    containsCode(app, "res.status(503).type('text/plain')"),
    'A missing build answers 503 rather than a blank 200',
  );
}

/* ============================================================
  10. THE PERMISSION SEED
   ============================================================ */

function testSeedSafety(): void {
  console.log('10. The permission seed is additive and can be previewed');

  const seed = source('src/seeds/permissions.ts');

  assert(!/db\s*\.\s*delete\(/.test(codeOnly(seed)), 'The seed never issues a DELETE');
  assert(
    !/\bTRUNCATE\b|\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i.test(codeOnly(seed)),
    'The seed executes no truncate or drop',
  );
  assert(
    !/facilityRolePermissionOverrides/.test(seed),
    'The seed never touches facility overrides',
  );
  assert(seed.includes('--dry-run'), 'The seed supports a dry run');
  assert(seed.includes('if (!dryRun)'), 'Writes happen only when the dry run is off');
  assert(seed.includes('--yes'), 'A non-local database requires confirmation');
  assert(
    seed.includes('await pool.end()'),
    'The seed closes its pool instead of exiting mid-connection',
  );
  assert(
    seed.includes('no DELETE, no TRUNCATE, no DROP'),
    'The seed states its guarantees in its own output',
  );

  /* The seed must not run as part of a startup path. */
  for (const file of ['server.ts', 'src/app.ts', 'scripts/migrate.ts']) {
    assert(
      !/seedPermissions|seeds\/permissions/.test(source(file)),
      `${file} never invokes the permission seed`,
    );
  }
}

/* ============================================================
   11. DEPLOYMENT DOCUMENT
   ============================================================ */

function testDeploymentDoc(): void {
  console.log('11. The deployment guide matches the scripts');

  const docPath = 'docs/deployment/truehost-cpanel.md';

  assert(existsSync(resolve(ROOT, docPath)), 'The deployment guide exists');

  const doc = source(docPath);

  for (const needle of [
    'build/server.js',
    'npm run build:deploy',
    'Application startup file',
    'npm run db:preflight',
    'npm run db:migrate:dry',
    'pg_dump',
    'Restart',
    '9707039',
  ]) {
    assert(doc.includes(needle), `The guide mentions ${needle}`);
  }

  /* No secret may be pasted into the guide. */
  assert(
    !/SQL_ADMIN_PASSWORD\s*=\s*\S+/.test(doc),
    'The guide contains no database password value',
  );
  assert(
    !/ADMIN_PASSWORD\s*=\s*\S+/.test(doc),
    'The guide contains no administrator password value',
  );
  assert(doc.toLowerCase().includes('never commit'), 'The guide says not to commit the .env');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('DEPLOYMENT TESTS (Truehost cPanel)');
  console.log('==============================================');
  console.log('');

  testScripts();
  testBuildConfiguration();
  testNoViteInProduction();
  testDryRunIsReadOnly();
  testClassificationConsistency();
  testRealJournal();
  testDestructiveGuard();
  testServerStartup();
  testStaticServing();
  testSeedSafety();
  testDeploymentDoc();

  console.log('');
  console.log('==============================================');
  console.log(`DEPLOYMENT TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('DEPLOYMENT TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
