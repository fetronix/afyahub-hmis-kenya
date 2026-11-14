/** Actual built SPA + Express + PostgreSQL login/navigation proof. No API/browser adapters.
 * Test-only writes: requires an explicit opt-in and exact loopback disposable database.
 * Prepare schema separately. This script never migrates or cleans an existing database.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

const database = process.env.SQL_DB_NAME;
const host = process.env.SQL_HOST;
const executablePath = process.env.CHROME_EXECUTABLE_PATH;
if (
  process.env.EQUITY_VISIBILITY_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  database !== 'equity_visibility_synthetic_test' ||
  !process.env.SQL_ADMIN_USER ||
  !executablePath
) {
  throw new Error(
    'Requires EQUITY_VISIBILITY_SYNTHETIC=YES, loopback SQL_HOST, exact SQL_DB_NAME=equity_visibility_synthetic_test, SQL_ADMIN_USER and CHROME_EXECUTABLE_PATH. Never use a live facility database.',
  );
}
const port = Number(process.env.EQUITY_VISIBILITY_PORT ?? 4193);
const sqlPort = Number(process.env.SQL_PORT ?? 5432);
if (![port, sqlPort].every((n) => Number.isInteger(n) && n >= 1024 && n <= 65535))
  throw new Error('Invalid test port');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = root + 'docs/audits/partner-equity-visibility-evidence/';
const base = `http://127.0.0.1:${port}`;
const password = randomBytes(32).toString('base64url');
const suffix = randomUUID().slice(0, 8);
const pool = new pg.Pool({
  host,
  port: sqlPort,
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
  ssl: false,
});
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SQL_SSL: 'false',
  HOST: '0.0.0.0',
  PORT: String(port),
  LOG_LEVEL: 'silent',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base,
  ADMIN_USERNAME: `visibility_platform_${suffix}`,
  ADMIN_EMAIL: `visibility_platform_${suffix}@example.test`,
  ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
  ADMIN_FULL_NAME: 'Disposable visibility platform admin',
};
let server, browser;
const checks = [],
  errors = [],
  api = [];
let phase = 'setup';
const check = (ok, label) => {
  if (!ok) throw Error(label);
  checks.push(label);
  console.log('PASS ' + label);
};
try {
  await mkdir(out, { recursive: true });
  const schema = (
    await pool.query(
      "SELECT to_regclass('equity_statements') AS statements,to_regclass('equity_partner_register') AS register,to_regclass('equity_events') AS events",
    )
  ).rows[0];
  check(Object.values(schema).every(Boolean), 'Disposable database has all three equity tables');
  const boot = spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
    cwd: root,
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  check(boot.status === 0, 'Secure platform bootstrap in disposable database only');
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      'Disposable equity visibility tenant',
      `equity-visibility-${suffix}`,
    ])
  ).rows[0].id;
  const facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
      [
        tenant,
        `EV-${suffix}`,
        'Disposable equity visibility facility',
        JSON.stringify(['registration', 'accounting']),
      ],
    )
  ).rows[0].id;
  const hash = await argon2.hash(password);
  const users = {};
  for (const [kind, codes] of Object.entries({
    unentitled: ['accounting.read'],
    reader: ['accounting.read', 'accounting.equity.read'],
    preparer: [
      'accounting.read',
      'accounting.equity.read',
      'accounting.equity.manage',
      'accounting.equity.export',
    ],
  })) {
    const name = `equity_${kind}_${suffix}`;
    const user = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,$4,'ACTIVE',$5,$6) RETURNING id",
        [name, `${name}@example.test`, `Disposable ${kind}`, hash, tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `EQUITY_VISIBILITY_${kind}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    for (const code of codes) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'accounting') ON CONFLICT(code) DO NOTHING",
        [code],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    users[kind] = name;
  }
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Real app startup timeout')), 30000);
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', () => {});
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error(`Real app exited (${code})`));
    });
  });
  check(
    (await fetch(base + '/api/ready')).status === 200,
    'Actual production Express server is ready with PostgreSQL',
  );
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args:
      process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((k) => process.env[k] !== undefined)
        .map((k) => [k, process.env[k]]),
    ),
  });
  const click = async (page, label, selector = 'button') => {
    const ok = await page.evaluate(
      (text, sel) => {
        const el = Array.from(document.querySelectorAll(sel)).find(
          (x) => x.textContent.trim() === text,
        );
        if (!el || el.disabled) return false;
        el.click();
        return true;
      },
      label,
      selector,
    );
    if (!ok) throw Error('Button not found: ' + label);
  };
  const text = async (page, value) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, value);
  const login = async (kind) => {
    phase = kind;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (e) => errors.push({ phase: kind, error: e.name }));
    page.on('response', (r) => {
      if (r.url().startsWith(base + '/api/'))
        api.push({
          phase: kind,
          status: r.status(),
          path: new URL(r.url()).pathname,
          method: r.request().method(),
        });
    });
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[placeholder="Username or Email"]');
    await page.type('input[placeholder="Username or Email"]', users[kind]);
    await page.type('input[placeholder="Password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => document.querySelector('aside')?.innerText.includes('Accounting & Finance'),
      { timeout: 30000 },
    );
    await click(page, 'Accounting & Finance', 'aside button');
    await click(page, 'Financial Reports');
    return { page, context };
  };
  let session = await login('unentitled');
  await text(session.page, 'Partners’ Equity Statement — access required');
  check(
    !(await session.page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(
        (x) => x.textContent.trim() === 'Partners’ Equity Statement',
      ),
    )),
    'Accounting-only login shows diagnostic, not an unauthorized equity entry',
  );
  check(
    !api.some((x) => x.phase === 'unentitled' && x.path.startsWith('/api/partner-equity')),
    'Unauthorized screen makes no equity data requests',
  );
  await session.page.screenshot({ path: out + '01-access-required.png', fullPage: true });
  await session.context.close();
  session = await login('preparer');
  await click(session.page, 'Partners’ Equity Statement');
  await text(session.page, 'Statement of Changes in Partners’ Equity');
  await session.page.waitForFunction(() =>
    document
      .querySelector('#equity-presentation select')
      ?.textContent.includes('Select a saved statement'),
  );
  await session.page.waitForNetworkIdle({ idleTime: 500 });
  check(
    api.some(
      (x) =>
        x.phase === 'preparer' && x.path === '/api/partner-equity/statements' && x.status === 200,
    ),
    'Authenticated real workspace retrieves scoped statements over HTTP',
  );
  const before = (
    await pool.query('SELECT count(*)::int AS n FROM equity_statements WHERE facility_id=$1', [
      facility,
    ])
  ).rows[0].n;
  check(before === 0, 'Opening the actual screen does not create source statements');
  await session.page
    .locator('[aria-label="Equity audit reason"]')
    .fill('Explicit disposable visibility acceptance test');
  await click(session.page, 'Create statement / period');
  await click(session.page, 'Create saved draft');
  await session.page.waitForSelector('[aria-label="Lucy Wanjiku opening"]');
  check(
    await session.page.$$eval(
      'table[aria-label="Partner equity statement"] tbody tr',
      (x) => x.length === 14,
    ),
    'Actual SPA renders all fourteen persisted statement rows',
  );
  const saved = (
    await pool.query('SELECT id,status,model FROM equity_statements WHERE facility_id=$1', [
      facility,
    ])
  ).rows[0];
  check(
    saved.status === 'DRAFT' && saved.model.netResult === '-2353704.47',
    'Explicit browser creation persists the exact screenshot result in PostgreSQL',
  );
  await session.page.screenshot({ path: out + '02-authenticated-statement.png', fullPage: true });
  await session.page.$eval('table[aria-label="Partner equity statement"]', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await session.page.screenshot({ path: out + '02b-authenticated-grid.png', fullPage: true });
  await session.context.close();
  session = await login('reader');
  await click(session.page, 'Partners’ Equity Statement');
  await session.page.waitForSelector('table[aria-label="Partner equity statement"]');
  check(
    !(await session.page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(
        (x) =>
          ['Create statement / period', 'CSV export'].includes(x.textContent.trim()) ||
          (x.textContent.trim() === 'Save draft inputs' && !x.disabled),
      ),
    )),
    'Read-only real login cannot prepare or export',
  );
  check(
    (await session.page.$('[aria-label="Lucy Wanjiku opening"]')) === null,
    'Read-only real screen renders values rather than editable inputs',
  );
  await session.page.setViewport({ width: 390, height: 844 });
  await session.page.$eval('table[aria-label="Partner equity statement"]', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await session.page.screenshot({
    path: out + '03-authenticated-reader-mobile.png',
    fullPage: true,
  });
  await session.page.setViewport({ width: 1440, height: 1000 });
  await session.page.reload({ waitUntil: 'networkidle2' });
  await click(session.page, 'Accounting & Finance', 'aside button');
  await click(session.page, 'Financial Reports');
  await click(session.page, 'Partners’ Equity Statement');
  await session.page.waitForSelector('table[aria-label="Partner equity statement"]');
  check(true, 'Fresh real session state after page reload retrieves the saved statement');
  check(
    errors.length === 0,
    'No uncaught frontend runtime errors in actual authenticated workflows',
  );
  check(
    !api.some((x) => x.path.startsWith('/api/partner-equity') && x.status >= 400),
    'All real equity HTTP requests succeeded',
  );
  await session.context.close();
  await writeFile(
    out + 'browser-results.json',
    JSON.stringify(
      {
        passed: true,
        actualApplication: true,
        inMemoryAdapters: false,
        disposablePostgresOnly: true,
        productionEnvironmentVerified: false,
        checks,
        errors,
        api,
      },
      null,
      2,
    ) + '\n',
  );
} catch (e) {
  await mkdir(out, { recursive: true });
  await writeFile(
    out + 'browser-failure.json',
    JSON.stringify({ phase, error: e.message, checks, errors, api }, null, 2) + '\n',
  );
  throw e;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(timer);
  }
  await pool.end();
}
