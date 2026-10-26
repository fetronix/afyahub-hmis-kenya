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

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

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

describe('Deployment contracts — Truehost cPanel', () => {
  it('1. PACKAGE SCRIPTS', async () => {
    const pkg = packageJson();
    const scripts = pkg.scripts;

    expect(JSON.stringify(pkg.type), 'The package is ESM, so the build must emit ESM').toBe(
      JSON.stringify('module'),
    );

    /* cPanel runs `npm start` or the file directly, with plain node. */
    expect(
      scripts.start === 'node build/server.js',
      `start must run the built file (got "${scripts.start}")`,
    ).toBe(true);
    expect(
      !/node\s+server\.ts/.test(scripts.start),
      'start must never ask node to run TypeScript',
    ).toBe(true);

    expect(scripts.dev === 'tsx server.ts', 'Development keeps the TypeScript runner').toBe(true);
    expect(
      scripts['start:dev'] === 'tsx server.ts',
      'A developer can still start the source build',
    ).toBe(true);

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
      expect(
        typeof scripts[name] === 'string' && scripts[name].length > 0,
        `Script ${name} exists`,
      ).toBe(true);
    }

    expect(
      scripts['build:deploy'].includes('build:server') && scripts['build:deploy'].includes('build'),
      'build:deploy builds the client and the server',
    ).toBe(true);

    expect(
      scripts['db:migrate:dry'].endsWith('--dry-run'),
      'The dry-run script passes --dry-run',
    ).toBe(true);
    expect(scripts['db:seed:permissions:dry'].endsWith('--dry-run'), 'The seed has a dry run').toBe(
      true,
    );

    /*
     * Every maintenance command goes through the dispatcher, so it uses
     * the built bundle on the host and tsx only in development. `tsx`
     * starts an extra esbuild process, which is the resource the host ran
     * out of.
     */
    for (const name of ['db:status', 'db:preflight', 'db:migrate', 'db:seed:permissions']) {
      expect(
        scripts[name].startsWith('node scripts/run-script.mjs'),
        `${name} runs through the dispatcher, not tsx`,
      ).toBe(true);
    }

    /*
     * This file used to be a `tsx` script that `npm test` chained by name.
     * It is a spec now, so the contract is expressed the other way round:
     * the deployment contracts must be a file the runner collects, and the
     * runner must be the one `npm test` invokes. Asserting on the script
     * name would have kept passing while testing nothing once the name was
     * removed from the chain.
     */
    const config = source('vitest.config.ts');

    expect(config.includes("'src/tests/*.spec.ts'"), 'the runner collects the migrated specs').toBe(
      true,
    );
    expect(
      existsSync(resolve(process.cwd(), 'src/tests/deployment.spec.ts')),
      'the deployment contracts are a spec the runner collects',
    ).toBe(true);
    expect(scripts['test:unit'].includes('vitest'), 'npm test runs through the vitest runner').toBe(
      true,
    );

    /* Deps that the bundle imports at runtime must be production deps. */
    for (const dependency of ['express', 'pg', 'drizzle-orm', 'dotenv', 'argon2', 'helmet']) {
      expect(Boolean(pkg.dependencies[dependency]), `${dependency} is a runtime dependency`).toBe(
        true,
      );
    }
  });

  it('2. BUILD DETERMINISM', async () => {
    const build = source('scripts/build-server.mjs');

    expect(
      build.includes('outfile: resolve(ROOT, entry.out)'),
      'Each bundle is written to an explicit outfile',
    ).toBe(true);
    expect(
      build.includes("out: 'build/server.js'"),
      'The server bundle is named build/server.js',
    ).toBe(true);
    expect(
      build.includes("format: 'esm'"),
      'The output is ESM, matching package.json type=module',
    ).toBe(true);
    expect(
      build.includes("packages: 'external'"),
      'npm packages stay external; native modules are not re-bundled',
    ).toBe(true);
    expect(
      build.includes('await rm(OUT_DIR'),
      'A failed build cannot leave a stale server.js behind',
    ).toBe(true);
    expect(
      build.includes('target: TARGET') && build.includes("'node22'"),
      'The bundle targets a Node version the host actually runs',
    ).toBe(true);

    /*
     * The banner must not declare __filename/__dirname: app.ts declares
     * its own, esbuild flattens both into one scope, and the result was
     * "Identifier '__filename' has already been declared" at startup.
     */
    const banner = build.slice(
      build.indexOf('banner:'),
      build.indexOf('},', build.indexOf('banner:')),
    );

    expect(
      !/const __filename =/.test(banner),
      'The banner does not declare __filename (it collides with app.ts)',
    ).toBe(true);
    expect(!/const __dirname =/.test(banner), 'The banner does not declare __dirname').toBe(true);
    expect(
      banner.includes('createRequire(import.meta.url)'),
      'The banner provides require() for bundled CommonJS interop',
    ).toBe(true);

    /* The dispatcher prefers the bundle and says which it chose. */
    const dispatcher = source('scripts/run-script.mjs');

    expect(
      dispatcher.includes('existsSync(bundle)'),
      'The dispatcher checks for the built bundle first',
    ).toBe(true);
    expect(dispatcher.includes('build/scripts/'), 'The dispatcher looks in build/scripts').toBe(
      true,
    );
    expect(
      dispatcher.includes("'tsx', 'dist', 'cli.mjs'"),
      'It falls back to the locally installed tsx in development',
    ).toBe(true);

    /*
     * A committed artifact is not required (build/ is ignored), but if it
     * is present it must be the entry point the scripts name.
     */
    if (existsSync(resolve(ROOT, 'build/server.js'))) {
      const bundle = source('build/server.js');

      expect(
        bundle.includes('createRequire(import.meta.url)'),
        'The built server has the require shim',
      ).toBe(true);
      expect(
        /import\("vite"\)/.test(bundle) && !/from "vite"/.test(bundle),
        'The built server imports vite dynamically, never statically',
      ).toBe(true);
    }
  });

  it('3. THE PRODUCTION SERVER NEVER LOADS VITE', async () => {
    const app = source('src/app.ts');

    expect(!/^\s*import .*from 'vite';/m.test(app), 'app.ts has no static vite import').toBe(true);
    expect(
      app.includes("await import('vite')"),
      'vite is imported lazily, inside the development branch',
    ).toBe(true);

    const viteImport = app.indexOf("await import('vite')");
    const devBranch = app.indexOf('if (!isProduction) {');

    expect(
      devBranch > 0 && viteImport > devBranch,
      'The lazy import sits inside the development branch',
    ).toBe(true);

    const productionBranch = app.indexOf('} else {', devBranch);

    expect(
      productionBranch > devBranch && viteImport < productionBranch,
      'Nothing in the production branch imports vite',
    ).toBe(true);
  });

  it('4. DRY RUN WRITES NOTHING', async () => {
    const migrate = source('scripts/migrate.ts');

    /*
     * The exact defect reported: the runner created the schema and the
     * tracking table before it looked at --dry-run.
     */
    const createSchema = migrate.indexOf('CREATE SCHEMA IF NOT EXISTS drizzle');
    const dryRunReturn = migrate.indexOf('if (dryRun) {');

    expect(createSchema > 0, 'The runner does create the schema when it applies').toBe(true);
    expect(dryRunReturn > 0, 'The runner has a dry-run exit').toBe(true);
    expect(dryRunReturn < createSchema, 'The dry-run exit comes BEFORE the schema is created').toBe(
      true,
    );

    /* No DDL or DML may appear between the plan print and the dry-run exit. */
    const beforeExit = migrate.slice(0, dryRunReturn);
    const tail = beforeExit.slice(beforeExit.lastIndexOf('printDestructive'));

    expect(
      !/client\.query\(/.test(tail),
      'No statement runs on a client before the dry-run exits',
    ).toBe(true);
    expect(!/INSERT INTO/.test(tail), 'No tracking row is written on a dry run').toBe(true);

    /* And the read path must not create anything. */
    const status = source('scripts/migration-status.ts');

    expect(
      !/CREATE\s+(SCHEMA|TABLE)/i.test(stripSqlComments(status)),
      'The status command contains no CREATE statement at all',
    ).toBe(true);
    expect(
      !/\b(INSERT|UPDATE|DELETE)\s/i.test(stripSqlComments(status).replace(/--[^\n]*/g, ' ')),
      'The status command contains no write statement',
    ).toBe(true);

    const preflight = source('scripts/preflight.ts');

    expect(
      !/CREATE\s+(SCHEMA|TABLE)/i.test(stripSqlComments(preflight)),
      'Preflight never creates the tracking table',
    ).toBe(true);

    /*
     * The executable proof: `npm run verify:dry-run` runs the BUILT runner
     * against a fake pg driver and fails if any statement it sends is a
     * write. It is not run from here because it needs build/server.js (or
     * specifically build/scripts/migrate.js) to exist.
     */
    expect(
      existsSync(resolve(ROOT, 'scripts/verify-dry-run.mjs')),
      'The executable dry-run proof exists',
    ).toBe(true);

    const verification = source('scripts/verify-dry-run.mjs');

    expect(
      verification.includes("['empty', 'populated']"),
      'It checks a database with and without the tracking table',
    ).toBe(true);
    expect(verification.includes('isWrite'), 'It classifies statements as writes').toBe(true);
    expect(
      packageJson().scripts['verify:dry-run'] === 'node scripts/verify-dry-run.mjs',
      'npm run verify:dry-run runs it',
    ).toBe(true);

    /* The tracking table is created once, where migrations are applied. */
    const migrateCreates =
      migrate.split('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations').length - 1;

    expect(
      JSON.stringify(migrateCreates),
      'The tracking table is created in exactly one place',
    ).toBe(JSON.stringify(1));

    expect(
      migrate.indexOf('if (!isLocalDatabaseHost(env.database.host) && !confirmed)') <
        migrate.indexOf('CREATE SCHEMA IF NOT EXISTS drizzle'),
      'A non-local host is refused before anything is written',
    ).toBe(true);
  });

  it('5. RUNNER AND STATUS AGREE', async () => {
    const migrate = source('scripts/migrate.ts');
    const status = source('scripts/migration-status.ts');

    expect(
      migrate.includes('classifyMigrations(') && status.includes('classifyMigrations('),
      'Both import the shared classifier',
    ).toBe(true);
    expect(
      migrate.includes("from './migration-journal.ts'") &&
        status.includes("from './migration-journal.ts'"),
      'Both import from the same module',
    ).toBe(true);

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

    expect(
      JSON.stringify(result.pending.map((plan) => plan.tag)),
      'Only the unrecorded migration is pending',
    ).toBe(JSON.stringify(['0003_c']));
    expect(
      JSON.stringify(result.editedAfterApply.map((plan) => plan.tag)),
      'An edited applied migration is reported as drift, not as pending',
    ).toBe(JSON.stringify(['0002_b']));
    expect(JSON.stringify(result.applied.length), 'Both recorded migrations count as applied').toBe(
      JSON.stringify(2),
    );

    /* Newer timestamp recorded than the journal knows: the rest is behind. */
    const behind = classifyMigrations([plans[2]], [{ hash: 'unknown', createdAt: 9000 }]);

    expect(
      JSON.stringify(behind.pending.length),
      'The older pending migration is still listed',
    ).toBe(JSON.stringify(1));
    expect(
      JSON.stringify(behind.behindNewest.length),
      'It is flagged as behind the newest row',
    ).toBe(JSON.stringify(1));
    expect(behind.newestRecorded === 9000, 'The newest recorded timestamp is reported').toBe(true);

    /* No history: everything is pending, nothing is silently applied. */
    const empty = classifyMigrations(plans, []);

    expect(JSON.stringify(empty.pending.length), 'Without history every migration is pending').toBe(
      JSON.stringify(3),
    );
    expect(JSON.stringify(empty.applied.length), 'Nothing is assumed applied').toBe(
      JSON.stringify(0),
    );
  });

  it('6. THE REAL JOURNAL', async () => {
    const dir = migrationsDirectory();
    const entries = readJournal(dir);
    const plans = readPlans(entries, dir);

    expect(plans.length >= 23, `The journal has ${plans.length} migrations`).toBe(true);
    expect(JSON.stringify(plans.length), 'Every journal entry has a .sql file').toBe(
      JSON.stringify(entries.length),
    );

    for (const plan of plans) {
      expect(plan.statements.length > 0, `${plan.tag} contains statements`).toBe(true);
      expect(/^[0-9a-f]{64}$/.test(plan.hash), `${plan.tag} has a sha256 hash`).toBe(true);
      expect(Number.isFinite(plan.folderMillis), `${plan.tag} has a journal timestamp`).toBe(true);
    }

    /* Journal timestamps are unique; two entries at one millisecond
       would make timestamp matching ambiguous. */
    const stamps = new Set(plans.map((plan) => plan.folderMillis));
    expect(JSON.stringify(stamps.size), 'Journal timestamps are unique').toBe(
      JSON.stringify(plans.length),
    );

    /* The tracker format both scripts write. */
    const migrate = source('scripts/migrate.ts');

    expect(
      migrate.includes(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      ),
      'The tracking row records hash and journal timestamp',
    ).toBe(true);
    expect(
      migrate.includes('[plan.hash, plan.folderMillis]'),
      'The values written are the file hash and the journal timestamp',
    ).toBe(true);

    /* Drizzle's own table shape, so `drizzle-kit migrate` stays compatible. */
    expect(
      migrate.includes('hash text NOT NULL') && migrate.includes('created_at bigint'),
      "The tracking table matches drizzle-kit's schema",
    ).toBe(true);
  });

  it('7. DESTRUCTIVE SQL AND UNMANAGED DATABASES', async () => {
    const dir = migrationsDirectory();
    const plans = readPlans(readJournal(dir), dir);
    const findings = scanDestructiveStatements(plans);

    const dropColumn = findings.find(
      (finding) => finding.tag.startsWith('0002') && finding.label === 'DROP COLUMN',
    );

    expect(
      Boolean(dropColumn),
      "The scan finds 0002's DROP COLUMN, which is why a full replay is refused",
    ).toBe(true);
    expect(
      Boolean(dropColumn?.preview.toLowerCase().includes('patients')),
      'The finding names the patients table',
    ).toBe(true);
    expect(
      dropColumn?.conditional === false,
      'A DROP COLUMN without IF EXISTS is marked unconditional',
    ).toBe(true);

    /*
     * 0017 mentions TRUNCATE twice, both times to PREVENT it: a trigger
     * that fires before TRUNCATE and a REVOKE on the audit table. A
     * scanner that only greps for the word reports the audit trail's own
     * protection as a risk — and trains the operator to ignore the real
     * warning.
     */
    expect(
      !findings.some((finding) => finding.tag.startsWith('0017')),
      'Protective statements about TRUNCATE are not reported as destructive',
    ).toBe(true);

    expect(
      stripSqlComments('-- TRUNCATE patients\nSELECT 1').trim() === 'SELECT 1',
      'Comments are stripped before scanning',
    ).toBe(true);

    const scanOne = (sql: string) =>
      scanDestructiveStatements([
        { tag: 'test', hash: 'h', folderMillis: 1, statements: [sql], bomStripped: false },
      ]);

    expect(scanOne('TRUNCATE audit_logs;').length === 1, 'A real TRUNCATE is reported').toBe(true);
    expect(
      scanOne('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;').length === 0,
      'A REVOKE is not a destructive statement',
    ).toBe(true);
    expect(
      scanOne(
        'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION f();',
      ).length === 0,
      'A trigger that blocks TRUNCATE is not destructive',
    ).toBe(true);
    expect(scanOne('DELETE FROM patients;').length === 1, 'A real DELETE is reported').toBe(true);
    expect(
      scanOne('GRANT SELECT, DELETE ON patients TO app;').length === 0,
      'A GRANT is not a destructive statement',
    ).toBe(true);

    const migrate = source('scripts/migrate.ts');

    expect(
      migrate.includes('const unmanaged = !table && tableCount > 0'),
      'The runner detects a database with tables and no tracking table',
    ).toBe(true);
    expect(
      migrate.includes('BLOCKED — this database has'),
      'It refuses rather than replaying every migration',
    ).toBe(true);
    expect(
      migrate.includes('--force-replay'),
      'An explicit escape hatch exists for a scratch database',
    ).toBe(true);
    expect(
      migrate.includes('Never drop or recreate patient tables'),
      'The refusal tells the operator not to rebuild patient tables',
    ).toBe(true);

    /*
     * The second dangerous state: a tracking table with rows that match
     * nothing in this journal. "Nothing matched, so everything is
     * pending" would replay 0002 over live data.
     */
    expect(
      migrate.includes('const orphanedHistory ='),
      'The runner detects history that matches no journal entry',
    ).toBe(true);
    expect(
      migrate.includes('none of which match this journal'),
      'It refuses instead of replaying',
    ).toBe(true);
    const orphanGuard = migrate.indexOf('const orphanedHistory =');

    expect(
      migrate.indexOf('if (!forceReplay)', orphanGuard) > orphanGuard,
      'The orphan guard can still be overridden only by --force-replay',
    ).toBe(true);

    /*
     * The classifier itself is what makes an orphan detectable: rows that
     * match nothing leave `applied` empty while `applied.length` (the raw
     * count) is not.
     */
    const orphan = classifyMigrations(
      [{ tag: '0002_x', hash: 'h2', folderMillis: 2000, statements: [], bomStripped: false }],
      [{ hash: 'different', createdAt: 999_999 }],
    );

    expect(JSON.stringify(orphan.applied.length), 'A foreign row matches no migration').toBe(
      JSON.stringify(0),
    );
    expect(JSON.stringify(orphan.pending.length), 'The migration counts as pending').toBe(
      JSON.stringify(1),
    );
    expect(
      orphan.behindNewest.length === 1,
      'and is flagged as older than the newest recorded row',
    ).toBe(true);

    const preflight = source('scripts/preflight.ts');

    expect(preflight.includes('Unmanaged database'), 'Preflight names the same condition').toBe(
      true,
    );
    expect(
      preflight.includes('match nothing in this journal'),
      'Preflight reports orphaned history rather than a plain pending count',
    ).toBe(true);
    expect(
      preflight.includes('createdTables'),
      'Preflight reports table-creation conflicts with what already exists',
    ).toBe(true);
    expect(preflight.includes('--backup='), 'Preflight can verify a named backup').toBe(true);

    /* Host classification for the confirmation gate. */
    expect(isLocalDatabaseHost('localhost'), 'localhost is local').toBe(true);
    expect(isLocalDatabaseHost('127.0.0.1'), '127.0.0.1 is local').toBe(true);
    expect(!isLocalDatabaseHost('db.truehost.co.ke'), 'A remote host is not local').toBe(true);
  });

  it('8. SERVER STARTUP', async () => {
    const server = source('server.ts');

    expect(server.includes('process.env.PORT'), 'The port comes from the environment').toBe(true);
    expect(server.includes('DEFAULT_PORT = 3000'), 'There is a documented local fallback').toBe(
      true,
    );
    expect(server.includes("'0.0.0.0'"), 'The server binds every interface').toBe(true);
    expect(
      server.includes('app.listen(port, HOST'),
      'The resolved port and host are used together',
    ).toBe(true);

    expect(server.includes("httpServer.on('error'"), 'A late listen error is handled').toBe(true);
    expect(server.includes('EADDRINUSE'), 'A second instance is reported clearly').toBe(true);
    expect(
      server.includes("process.on('uncaughtException'"),
      'An uncaught exception shuts down cleanly instead of hanging',
    ).toBe(true);
    expect(
      server.includes("process.on('unhandledRejection'"),
      'An unhandled rejection shuts down cleanly',
    ).toBe(true);
    expect(
      server.includes("process.on('SIGTERM'") && server.includes("process.on('SIGINT'"),
      'Both stop signals are handled',
    ).toBe(true);
    expect(server.includes('await pool.end()'), 'The database pool is closed on shutdown').toBe(
      true,
    );
    expect(
      server.includes('Graceful shutdown timed out'),
      "A stuck shutdown cannot outlive the supervisor's patience",
    ).toBe(true);

    /* Nothing in the startup path may print a credential. */
    for (const file of ['server.ts', 'src/app.ts', 'src/config/env.ts', 'src/db/index.ts']) {
      const text = source(file);

      expect(
        !/console\.(log|info|warn|error)\([^)]*password/i.test(text),
        `${file} never logs a password`,
      ).toBe(true);
    }
  });

  it('9. STATIC ASSETS AND CLIENT ROUTES', async () => {
    const app = source('src/app.ts');

    expect(
      app.includes('const STATIC_DIR = process.env.STATIC_DIR'),
      'The static root can be overridden per deployment',
    ).toBe(true);
    expect(
      app.includes("path.resolve(__dirname, 'dist')"),
      'It defaults to dist/ beside the bundle',
    ).toBe(true);
    expect(
      app.includes("path.join(STATIC_DIR, 'index.html')"),
      'The SPA shell is resolved from the same absolute root',
    ).toBe(true);
    expect(
      app.includes('const hasClientBuild = existsSync(indexHtml)'),
      'A missing client build is detected, not ignored',
    ).toBe(true);
    expect(
      app.includes('No client build found.'),
      'A missing build is reported with the path and the command',
    ).toBe(true);
    expect(
      app.includes("maxAge: '1y'") && app.includes('immutable: true'),
      'Hashed assets are cached for a year',
    ).toBe(true);
    expect(
      app.includes("res.setHeader('Cache-Control', 'no-store, must-revalidate')"),
      'The shell is never cached',
    ).toBe(true);
    expect(
      app.includes("if (req.path.startsWith('/api/'))"),
      'An unknown /api path is not answered with the SPA shell',
    ).toBe(true);
    expect(
      containsCode(app, "res.status(503).type('text/plain')"),
      'A missing build answers 503 rather than a blank 200',
    ).toBe(true);
  });

  it('10. THE PERMISSION SEED', async () => {
    const seed = source('src/seeds/permissions.ts');

    expect(!/db\s*\.\s*delete\(/.test(codeOnly(seed)), 'The seed never issues a DELETE').toBe(true);
    expect(
      !/\bTRUNCATE\b|\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i.test(codeOnly(seed)),
      'The seed executes no truncate or drop',
    ).toBe(true);
    expect(
      !/facilityRolePermissionOverrides/.test(seed),
      'The seed never touches facility overrides',
    ).toBe(true);
    expect(seed.includes('--dry-run'), 'The seed supports a dry run').toBe(true);
    expect(seed.includes('if (!dryRun)'), 'Writes happen only when the dry run is off').toBe(true);
    expect(seed.includes('--yes'), 'A non-local database requires confirmation').toBe(true);
    expect(
      seed.includes('await pool.end()'),
      'The seed closes its pool instead of exiting mid-connection',
    ).toBe(true);
    expect(
      seed.includes('no DELETE, no TRUNCATE, no DROP'),
      'The seed states its guarantees in its own output',
    ).toBe(true);

    /* The seed must not run as part of a startup path. */
    for (const file of ['server.ts', 'src/app.ts', 'scripts/migrate.ts']) {
      expect(
        !/seedPermissions|seeds\/permissions/.test(source(file)),
        `${file} never invokes the permission seed`,
      ).toBe(true);
    }
  });

  it('11. DEPLOYMENT DOCUMENT', async () => {
    const docPath = 'docs/deployment/truehost-cpanel.md';

    expect(existsSync(resolve(ROOT, docPath)), 'The deployment guide exists').toBe(true);

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
      expect(doc.includes(needle), `The guide mentions ${needle}`).toBe(true);
    }

    /* No secret may be pasted into the guide. */
    expect(
      !/SQL_ADMIN_PASSWORD\s*=\s*\S+/.test(doc),
      'The guide contains no database password value',
    ).toBe(true);
    expect(
      !/ADMIN_PASSWORD\s*=\s*\S+/.test(doc),
      'The guide contains no administrator password value',
    ).toBe(true);
    expect(
      doc.toLowerCase().includes('never commit'),
      'The guide says not to commit the .env',
    ).toBe(true);
  });
});
