import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// This creates only synthetic rows in an explicitly acknowledged LOCAL test DB.
// It never migrates, resets, drops or connects to a production database.
const root = fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '';
const host = process.env.SQL_HOST ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database) ||
  !process.env.SQL_ADMIN_USER ||
  !executablePath
) {
  throw new Error(
    'A dedicated local synthetic test database, explicit acknowledgement, and Chromium are required.',
  );
}
const sqlPort = Number(process.env.SQL_PORT ?? '5432');
const port = Number(process.env.BROWSER_SMOKE_PORT ?? '4193');
if (
  !Number.isInteger(sqlPort) ||
  sqlPort < 1 ||
  sqlPort > 65535 ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error('Invalid port.');
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(32).toString('base64url');
const adminPassword = randomBytes(32).toString('base64url');
const username = `appt_browser_${suffix}`;
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SQL_HOST: host,
  SQL_PORT: String(sqlPort),
  SQL_DB_NAME: database,
  SQL_SSL: 'false',
  TZ: 'Africa/Nairobi',
  DEFAULT_TIMEZONE: 'Africa/Nairobi',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base,
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'silent',
  ADMIN_USERNAME: `appt_platform_${suffix}`,
  ADMIN_EMAIL: `appt_platform_${suffix}@example.test`,
  ADMIN_PASSWORD: adminPassword,
  ADMIN_FULL_NAME: 'Synthetic Platform Administrator',
};
const pool = new pg.Pool({
  host,
  port: sqlPort,
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
});
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
let server,
  browser,
  phase = 'setup';
try {
  const identity = (
    await pool.query('SELECT current_database() AS name, inet_server_addr()::text AS address')
  ).rows[0];
  check(
    identity.name === database &&
      ['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.address),
    'Unexpected database identity.',
  );
  const bootstrap = spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
    cwd: root,
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  check(bootstrap.status === 0, 'Synthetic secure bootstrap failed.');
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug,timezone) VALUES($1,$2,$3) RETURNING id', [
      `Synthetic booking browser ${suffix}`,
      `appointment-browser-${suffix}`,
      'Africa/Nairobi',
    ])
  ).rows[0].id;
  const facility = (
    await pool.query(
      "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic Appointment Facility','Africa/Nairobi',$3::jsonb) RETURNING id",
      [tenant, `BR-AP-${suffix}`, JSON.stringify(['registration', 'reception'])],
    )
  ).rows[0].id;
  const passHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const user = (
    await pool.query(
      "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic appointment staff',$3,'ACTIVE',$4,$5) RETURNING id",
      [username, `${username}@example.test`, passHash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [tenant, `APPT_BROWSER_${suffix}`],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  for (const code of [
    'patients.read',
    'clinical.read',
    'appointments.read',
    'appointments.create',
    'appointments.update',
    'appointments.cancel',
    'appointments.categories.manage',
  ]) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'appointments') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [role, code],
    );
  }
  const patient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Booking Patient','2000-01-01','Other') RETURNING id",
      [tenant, facility, `APPT-BR-${suffix}`],
    )
  ).rows[0].id;
  phase = 'server';
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic server startup timed out.')), 20000);
    server.stdout.on('data', (part) => {
      output += part;
      if (output.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', () => {});
    server.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Synthetic server exited during startup.'));
    });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Readiness failed.');
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
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  const click = async (text, selector = 'button') => {
    const result = await page.evaluate(
      (label, rootSelector) => {
        const element = [...document.querySelectorAll(rootSelector)].find(
          (item) => item.textContent?.trim() === label,
        );
        if (!element || element.disabled) return false;
        element.click();
        return true;
      },
      text,
      selector,
    );
    check(result, `Could not click ${text}.`);
  };
  const wait = (text) =>
    page.waitForFunction(
      (value) => document.body.innerText.includes(value),
      { timeout: 25000 },
      text,
    );
  const setDate = (value) =>
    page.$eval(
      '#diary-date',
      (element, next) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          element,
          next,
        );
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      },
      value,
    );
  phase = 'login';
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => Boolean(document.querySelector('aside nav')), {
    timeout: 25000,
  });
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Appointments & Queue'),
    { timeout: 25000 },
  );
  await click('Appointments & Queue', 'aside button');
  await wait('Appointment diary');
  phase = 'category';
  await wait('Manage appointment categories');
  await click('Manage appointment categories', 'summary');
  await page.type('#category-code', 'SYNTHETIC_FOLLOWUP');
  await page.type('#category-name', 'Synthetic follow-up');
  await click('Add category');
  await wait('Category saved. No charge or price was created.');
  const category = (
    await pool.query('SELECT id FROM appointment_categories WHERE facility_id=$1 AND code=$2', [
      facility,
      'SYNTHETIC_FOLLOWUP',
    ])
  ).rows[0]?.id;
  check(category, 'Category did not persist.');
  phase = 'booking';
  await click('Book Appointment');
  await page.waitForSelector('#appointment-patient');
  // Search explicitly so this does not race reception's initial patient load.
  await page.type('#appointment-patient-search', `APPT-BR-${suffix}`);
  await click('Search', '[role="dialog"] button');
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('#appointment-patient').options].some(
        (option) => option.value === id,
      ),
    { timeout: 25000 },
    String(patient),
  );
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('#appointment-category').options].some(
        (option) => option.value === id,
      ),
    { timeout: 25000 },
    String(category),
  );
  await page.select('#appointment-patient', String(patient));
  await page.select('#appointment-category', String(category));
  await page.type('#appointment-time', '2031-10-15 10:00');
  await page.type('#appointment-reason', 'Synthetic booking reason');
  await click('Confirm Booking');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 25000 });
  const created = (
    await pool.query(
      "SELECT id,status,created_by_user_id,category_id,booking_reference FROM appointments WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 AND scheduled_time='2031-10-15T10:00'",
      [tenant, facility, patient],
    )
  ).rows;
  check(
    created.length === 1 &&
      created[0].status === 'Scheduled' &&
      created[0].created_by_user_id === user &&
      created[0].category_id === category &&
      created[0].booking_reference,
    'Booking did not persist correctly.',
  );
  await setDate('2031-10-15');
  await wait(created[0].booking_reference);
  phase = 'reschedule';
  await click('Reschedule');
  await page.type('#reschedule-time', '2031-10-16 11:00');
  await page.type('#appointment-action-reason', 'Synthetic reschedule');
  await click('Save', '[role="dialog"] button');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 25000 });
  const replacement = (
    await pool.query(
      'SELECT id,status,booking_reference FROM appointments WHERE replacement_of_id=$1',
      [created[0].id],
    )
  ).rows;
  check(
    replacement.length === 1 && replacement[0].status === 'Scheduled',
    'Replacement did not persist.',
  );
  check(
    (await pool.query('SELECT status FROM appointments WHERE id=$1', [created[0].id])).rows[0]
      .status === 'Rescheduled',
    'Original was not retained as rescheduled.',
  );
  await setDate('2031-10-16');
  await wait(replacement[0].booking_reference);
  phase = 'cancellation';
  await click('Cancel');
  await page.type('#appointment-action-reason', 'Synthetic cancellation');
  await click('Save', '[role="dialog"] button');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 25000 });
  const events = (
    await pool.query(
      'SELECT event_type,actor_user_id,reason,payment_state FROM appointment_events WHERE appointment_id=$1 ORDER BY id',
      [replacement[0].id],
    )
  ).rows;
  check(
    events.length === 2 &&
      events[0].event_type === 'RESCHEDULED_TO' &&
      events[1].event_type === 'CANCELLED' &&
      events[1].actor_user_id === user &&
      events[1].reason === 'Synthetic cancellation' &&
      events[1].payment_state === 'NOT_ASSESSED',
    'Cancellation history was not retained.',
  );
  check(
    (
      await pool.query(
        'SELECT count(*)::int n FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2',
        [tenant, facility],
      )
    ).rows[0].n === 0,
    'A booking unexpectedly created an invoice.',
  );
  check(pageErrors.length === 0, 'Browser encountered a JavaScript error.');
  console.log(
    'Synthetic Chromium login, category, booking, reschedule, cancellation and database history: PASS',
  );
  console.log('No invoice, payment, refund, SMS or clinical treatment was claimed.');
} catch (error) {
  console.error(
    `Synthetic appointment browser failed during ${phase}: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  await pool.end();
}
