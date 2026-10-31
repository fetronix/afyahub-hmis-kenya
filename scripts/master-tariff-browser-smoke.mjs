import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// This script only creates synthetic fixtures in an explicitly named local test DB.
const root = fileURLToPath(new URL('..', import.meta.url));
const host = process.env.SQL_HOST ?? '';
const database = process.env.SQL_DB_NAME ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database) ||
  !executablePath ||
  !process.env.SQL_ADMIN_USER
)
  throw new Error(
    'A dedicated local synthetic test database and Chromium executable are required.',
  );
const suffix = randomUUID().slice(0, 8),
  password = randomBytes(32).toString('base64url');
const port = Number(process.env.MASTER_BROWSER_PORT ?? 4193),
  base = `http://127.0.0.1:${port}`;
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT ?? 5432),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
});
let server, browser;
const check = (value, message) => {
  if (!value) throw new Error(message);
};
try {
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      `Synthetic Master Browser ${suffix}`,
      `master-browser-${suffix}`,
    ])
  ).rows[0].id;
  const modules = [
    'registration',
    'opd',
    'laboratory',
    'pharmacy',
    'inventory',
    'inpatient',
    'finance',
  ];
  const facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
      [tenant, `MB-${suffix}`, 'Synthetic Master Browser Facility', JSON.stringify(modules)],
    )
  ).rows[0].id;
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const username = `master_browser_${suffix}`;
  const user = (
    await pool.query(
      "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Master Admin',$3,'ACTIVE',$4,$5) RETURNING id",
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  for (const permission of [
    'system.settings.manage',
    'tariffs.read',
    'tariffs.manage',
    'billing.read',
    'billing.update',
  ]) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
      [permission],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [role, permission],
    );
  }
  const legacy = (
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee,is_active,auto_bill) VALUES($1,$2,'OLD-SYNTHETIC','Synthetic legacy price','opd','Visit',123,true,true) RETURNING id",
      [tenant, facility],
    )
  ).rows[0].id;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SQL_SSL: 'false',
    HOST: '127.0.0.1',
    PORT: String(port),
    APP_BASE_URL: base,
    TZ: 'Africa/Nairobi',
    DEFAULT_TIMEZONE: 'Africa/Nairobi',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    LOG_LEVEL: 'silent',
  };
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 20000);
    server.stdout.on('data', (data) => {
      log += data;
      if (log.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
  });
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
  const page = await browser.newPage(),
    runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.name));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  const waitText = async (text) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000 }, text);
  const click = async (text, selector = 'button') => {
    const ok = await page.evaluate(
      (label, sel) => {
        const button = [...document.querySelectorAll(sel)].find(
          (x) => x.textContent.trim() === label,
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      },
      text,
      selector,
    );
    check(ok, `Button unavailable: ${text}`);
  };
  await waitText('System Configuration');
  await click('System Configuration', 'aside button');
  await waitText('Service Pricing & Tariffs');
  await click('Service Pricing & Tariffs');
  await waitText('Master Tariff Price List');
  await click('Synchronise actual services');
  await waitText('Catalogue synchronised. Existing prices were not changed.');
  check(
    (await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [legacy]))
      .rows[0].fee === '123.00',
    'Existing synthetic price changed',
  );
  await page.type('input[aria-label="Search master tariffs"]', 'JC-OPD-CONSULT');
  await page.waitForSelector('input[aria-label="Price JC-OPD-CONSULT"]');
  const row = await page.$('input[aria-label="Price JC-OPD-CONSULT"]');
  await row.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await row.type('45.00');
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Price JC-OPD-CONSULT"]');
    const tr = input.closest('tr');
    for (const checkbox of [...tr.querySelectorAll('input[type=checkbox]')].slice(1))
      if (!checkbox.checked) checkbox.click();
  });
  const save = await page.$('input[aria-label="Price JC-OPD-CONSULT"]');
  await save.evaluate((input) =>
    [...input.closest('tr').querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Save')
      .click(),
  );
  try {
    await waitText('Changes saved as draft; review and approve before billing.');
  } catch (error) {
    console.error(
      'Synthetic tariff UI alerts:',
      await page.evaluate(() =>
        [...document.querySelectorAll('[role=alert],[role=status]')].map((x) => x.textContent),
      ),
    );
    throw error;
  }
  await page.waitForSelector('input[aria-label="Price JC-OPD-CONSULT"]');
  await page.waitForFunction(() => {
    const row = document.querySelector('input[aria-label="Price JC-OPD-CONSULT"]')?.closest('tr');
    const button =
      row && [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
    return button && !button.disabled;
  });
  page.once('dialog', (dialog) => dialog.accept('synthetic browser approval'));
  await page.evaluate(() => {
    const tr = document.querySelector('input[aria-label="Price JC-OPD-CONSULT"]').closest('tr');
    [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve').click();
  });
  await waitText('Tariff approved.');
  const saved = (
    await pool.query(
      "SELECT t.fee::text,t.approval_status,t.is_active,t.auto_bill FROM facility_service_tariffs t JOIN master_services m ON m.id=t.master_service_id WHERE t.facility_id=$1 AND m.code='JC-OPD-CONSULT'",
      [facility],
    )
  ).rows[0];
  check(
    saved.fee === '45.00' &&
      saved.approval_status === 'APPROVED' &&
      saved.is_active &&
      saved.auto_bill,
    'Approved tariff did not persist correctly',
  );
  check(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join(',')}`);
  console.log(
    'Synthetic browser: facility admin login, master list, sync, legacy price preservation, edit and approval: PASS',
  );
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
  }
  await pool.end();
}
