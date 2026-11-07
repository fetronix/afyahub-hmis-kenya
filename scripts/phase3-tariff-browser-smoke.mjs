import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// This script only creates synthetic fixtures on a separately provisioned and
// attested local database. It does not migrate, reset, or destroy a database.
const root = fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '';
const host = process.env.SQL_HOST ?? '';
const port = Number(process.env.BROWSER_SMOKE_PORT ?? '4193');
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  !/(?:synthetic.*test|test.*synthetic)/i.test(database) ||
  !process.env.SQL_ADMIN_USER ||
  !process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER ||
  !process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY ||
  !executablePath ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
) {
  throw new Error(
    'An explicitly acknowledged, attested loopback synthetic test database and Chromium are required.',
  );
}
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT ?? 5432),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
});
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const code = `P3B-${suffix.toUpperCase()}`;
const username = `p3_browser_${suffix}`;
const password = randomBytes(32).toString('base64url');
const adminPassword = randomBytes(32).toString('base64url');
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SQL_SSL: 'false',
  TZ: 'Africa/Nairobi',
  DEFAULT_TIMEZONE: 'Africa/Nairobi',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base,
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'silent',
  ADMIN_USERNAME: `p3_platform_${suffix}`,
  ADMIN_EMAIL: `p3_platform_${suffix}@example.test`,
  ADMIN_PASSWORD: adminPassword,
  ADMIN_FULL_NAME: 'Synthetic Platform Admin',
};
let server,
  browser,
  page,
  phase = 'attestation';
try {
  const identity = (
    await pool.query(
      `SELECT current_database() AS name, inet_server_addr()::text AS address, current_setting('data_directory') AS directory, (SELECT system_identifier::text FROM pg_control_system()) AS cluster, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations`,
    )
  ).rows[0];
  check(
    identity.name === database &&
      ['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.address) &&
      identity.directory === process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY &&
      identity.cluster === process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER &&
      identity.migrations >= 71,
    'Synthetic database attestation failed.',
  );
  phase = 'synthetic fixture';
  check(
    spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
      cwd: root,
      env,
      stdio: 'ignore',
      timeout: 30000,
    }).status === 0,
    'Synthetic bootstrap failed.',
  );
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      'Synthetic tariff browser tenant',
      `p3browser-${suffix}`,
    ])
  ).rows[0].id;
  const facility = (
    await pool.query(
      "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic tariff browser facility',$3::jsonb) RETURNING id",
      [tenant, `P3B-${suffix}`, JSON.stringify(['registration', 'finance', 'opd'])],
    )
  ).rows[0].id;
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const actor = (
    await pool.query(
      "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic tariff administrator',$3,'ACTIVE',$4,$5) RETURNING id",
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
  for (const permission of ['users.invite', 'tariffs.read', 'tariffs.manage']) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
      [permission],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [role, permission],
    );
  }
  phase = 'server startup';
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Synthetic server startup timeout')), 20000);
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on('data', () => {});
    server.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Synthetic server exited during startup'));
    });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Synthetic readiness failed.');
  phase = 'login';
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args:
      process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside nav', { timeout: 25000 });
  const clickText = async (text, selector = 'button') => {
    const found = await page.evaluate(
      (label, rootSelector) => {
        const button = [...document.querySelectorAll(rootSelector)].find(
          (node) => node.textContent.trim() === label,
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      },
      text,
      selector,
    );
    check(found, `Expected ${text} control not found.`);
  };
  const waitText = (text) =>
    page.waitForFunction(
      (value) => document.body.innerText.includes(value),
      { timeout: 30000 },
      text,
    );
  const field = async (formTitle, labelText) => {
    const handle = await page.evaluateHandle(
      (title, label) => {
        const form = [...document.querySelectorAll('form')].find(
          (item) => item.querySelector('h3')?.textContent.trim() === title,
        );
        return (
          [...(form?.querySelectorAll('label') ?? [])]
            .find((item) => item.textContent.trim().startsWith(label))
            ?.querySelector('input,select') ?? null
        );
      },
      formTitle,
      labelText,
    );
    const element = handle.asElement();
    check(element, `Synthetic form field ${labelText} was not found.`);
    return element;
  };
  const fill = async (formTitle, label, value) => {
    const input = await field(formTitle, label);
    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await input.type(value);
  };
  phase = 'facility tariff creation';
  await waitText('System Configuration');
  await clickText('System Configuration', 'aside button');
  await waitText('Hospital Configuration Engine');
  await clickText('Facility Services & Tariffs');
  await page.waitForSelector('section[aria-label="Facility services and tariffs"]', {
    timeout: 30000,
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Add service' && !b.disabled,
    ),
  );
  await clickText('Add service');
  await fill('Add facility service', 'Service name', 'Synthetic browser service');
  await fill('Add facility service', 'Service code', code);
  await fill('Add facility service', 'Description', 'Synthetic browser service description');
  await (await field('Add facility service', 'Department')).select('opd');
  await (await field('Add facility service', 'Service category')).select('CONSULTATION');
  await fill('Add facility service', 'Billing unit', 'Visit');
  await clickText('Save service');
  await waitText('Service and initial tariff saved.');
  const initial = (
    await pool.query(
      'SELECT id,fee::text,revision FROM facility_service_tariffs WHERE tenant_id=$1 AND facility_id=$2 AND code=$3',
      [tenant, facility, code],
    )
  ).rows[0];
  check(initial?.fee === '0.00', 'The zero-default synthetic tariff was not persisted.');
  phase = 'tariff edit';
  const edited = await page.evaluate((tariffCode) => {
    const table = document.querySelector('table[aria-label="Facility tariffs"]');
    const row = [...(table?.querySelectorAll('tbody tr') ?? [])].find((item) =>
      item.textContent.includes(tariffCode),
    );
    const button = [...(row?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent.trim() === 'Edit',
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, code);
  check(edited, 'Synthetic tariff edit control was not available.');
  await fill('Edit tariff', 'Price (KES)', '456.00');
  await clickText('Save tariff');
  await waitText('Tariff changes saved.');
  const saved = (
    await pool.query(
      'SELECT fee::text,revision FROM facility_service_tariffs WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [initial.id, tenant, facility],
    )
  ).rows[0];
  check(
    saved?.fee === '456.00' && saved.revision === initial.revision + 1,
    'Synthetic tariff edit was not persisted.',
  );
  phase = 'history view';
  const historyButton = `button[aria-label="View price history for ${code}"]`;
  await page.waitForSelector(historyButton);
  await page.click(historyButton);
  await page.waitForFunction(
    (tariffCode) => {
      const region = document.querySelector(
        `section[aria-label="Price history for ${tariffCode}"]`,
      );
      return (
        region?.textContent.includes('KES 0.00') &&
        region.textContent.includes('KES 456.00') &&
        region.textContent.includes('UPDATE') &&
        region.textContent.includes('timezone')
      );
    },
    { timeout: 30000 },
    code,
  );
  const history = (
    await pool.query(
      "SELECT action FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND ((resource='FACILITY_SERVICE_TARIFF' AND resource_id=$3 AND action='UPDATE') OR (resource='FACILITY_SERVICE_TARIFF_HISTORY' AND resource_id=$3 AND action='VIEW'))",
      [tenant, facility, String(initial.id)],
    )
  ).rows;
  check(
    history.some((row) => row.action === 'UPDATE') && history.some((row) => row.action === 'VIEW'),
    'Synthetic tariff and access audit rows were not persisted.',
  );
  check(errors.length === 0, 'A browser runtime error occurred.');
  console.log(
    'Synthetic Chromium: facility service creation, zero price, tariff edit, recorded before/after history and scoped access audit: PASS',
  );
} catch (error) {
  console.error(
    `Synthetic tariff browser smoke failed during ${phase}: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      server.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  }
  await pool.end();
}
