import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// Creates additive synthetic fixtures only. No migrations, resets, real providers or real patient records.
const root = fileURLToPath(new URL('..', import.meta.url));
const host = process.env.SQL_HOST ?? '';
const database = process.env.SQL_DB_NAME ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database) ||
  !process.env.SQL_ADMIN_USER ||
  !executablePath
) {
  throw new Error(
    'Use BROWSER_SMOKE_SYNTHETIC=YES with a loopback synthetic test database, SQL_ADMIN_USER and CHROME_EXECUTABLE_PATH.',
  );
}
const port = Number(process.env.DASHBOARD_BROWSER_PORT ?? '4194');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid dashboard browser port.');
const suffix = randomUUID().slice(0, 8);
const username = `dash_browser_${suffix}`;
const password = randomBytes(32).toString('base64url');
const base = `http://127.0.0.1:${port}`;
const screenshotDir = resolve(root, 'docs/dashboard/screenshots');
const env = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  APP_BASE_URL: base,
  SQL_SSL: 'false',
  TZ: 'Africa/Nairobi',
  DEFAULT_TIMEZONE: 'Africa/Nairobi',
  LOG_LEVEL: 'silent',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ADMIN_USERNAME: `platform_dash_${suffix}`,
  ADMIN_EMAIL: `platform_dash_${suffix}@example.test`,
  ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
  ADMIN_FULL_NAME: 'Synthetic Platform Administrator',
};
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT ?? 5432),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
});
let server, browser;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const [year, month, day] = today.split('-').map(Number);
const dateInMonth = (n) =>
  `${year}-${String(month).padStart(2, '0')}-${String(Math.max(1, Math.min(day, n))).padStart(2, '0')}`;
const prior = new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 10);
try {
  const bootstrap = spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
    cwd: root,
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  check(bootstrap.status === 0, 'Synthetic platform bootstrap failed.');
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      `Synthetic Dashboard Tenant ${suffix}`,
      `synthetic-dashboard-${suffix}`,
    ])
  ).rows[0].id;
  const modules = [
    'registration',
    'reception',
    'opd',
    'inpatient',
    'maternity',
    'theatre',
    'specialty',
    'laboratory',
    'radiology',
    'pharmacy',
    'inventory',
    'procurement',
    'finance',
    'insurance',
    'analytics',
    'public_health',
    'audit',
    'configuration',
  ];
  const facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
      [tenant, `SYN-DASH-${suffix}`, 'Synthetic Hospital — Test Facility', JSON.stringify(modules)],
    )
  ).rows[0].id;
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const user = (
    await pool.query(
      "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id,designation) VALUES($1,$1,$2,'Synthetic Clinician',$3,'ACTIVE',$4,$5,'Facility Administrator') RETURNING id",
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [tenant, `SYNTHETIC_DASH_${suffix}`],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  const permissions = [
    'patients.read',
    'appointments.read',
    'clinical.read',
    'inpatient.read',
    'maternity.read',
    'laboratory.read',
    'pharmacy.read',
    'inventory.read',
    'procurement.read',
    'billing.read',
    'tariffs.read',
    'insurance.read',
    'reports.read',
    'audit.read',
    'users.invite',
  ];
  for (const code of permissions) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [role, code],
    );
  }
  const patientIds = [];
  for (let i = 0; i < 60; i++) {
    const created = i < 15 ? prior : dateInMonth(1 + ((i * 7) % day));
    const id = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,created_at) VALUES($1,$2,$3,'Synthetic',$4,'2000-01-01','Other',$5::timestamp) RETURNING id",
        [
          tenant,
          facility,
          `SYN-MRN-${suffix}-${i}`,
          `Patient ${String(i + 1).padStart(2, '0')}`,
          `${created} 08:00`,
        ],
      )
    ).rows[0].id;
    patientIds.push(id);
    const encounterDay = dateInMonth(1 + ((i * 5) % day));
    if (i < 15 || encounterDay >= created)
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,started_at,status) VALUES($1,$2,$3,$4::timestamp,'COMPLETED')",
        [tenant, facility, id, `${encounterDay} 10:00`],
      );
  }
  const ward = (
    await pool.query(
      "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic Ward',$2) RETURNING id",
      [facility, `SYN-WARD-${suffix}`],
    )
  ).rows[0].id;
  for (let i = 0; i < 5; i++) {
    const bed = (
      await pool.query('INSERT INTO beds(ward_id,bed_number) VALUES($1,$2) RETURNING id', [
        ward,
        `S-${i}`,
      ])
    ).rows[0].id;
    const when = `${dateInMonth(1 + i * 5)} 11:00`;
    await pool.query(
      'INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,created_at) VALUES($1,$2,$3,$4,$5,$6::text,($6::text)::timestamp)',
      [tenant, facility, patientIds[i], ward, bed, when],
    );
  }
  const kinds = ['Consultation', 'Laboratory', 'Pharmacy', 'Radiology', 'Inpatient Care'];
  let refundSource;
  for (let i = 0; i < 28; i++) {
    const total = 1000 + i * 125,
      paid = i % 4 === 0 ? 0 : total - 200,
      when = `${dateInMonth(1 + i * 3)} 10:00`;
    const invoice = (
      await pool.query(
        'INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamp) RETURNING id',
        [
          tenant,
          facility,
          patientIds[i],
          `SYN-INV-${suffix}-${i}`,
          total,
          paid,
          total - paid,
          paid ? 'Partially Paid' : 'Pending',
          when,
        ],
      )
    ).rows[0].id;
    await pool.query(
      'INSERT INTO billing_items(invoice_id,item_type,description,total_amount,created_at) VALUES($1,$2,$3,$4,$5::timestamp)',
      [invoice, kinds[i % kinds.length], 'Synthetic service', total, when],
    );
    if (paid) {
      const payment = (
        await pool.query(
          "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES($1,$2,'Cash',$3,'Synthetic cashier',$4::timestamp) RETURNING id",
          [invoice, `SYN-RCP-${suffix}-${i}`, paid, when],
        )
      ).rows[0].id;
      if (!refundSource) refundSource = { invoice, payment, paid };
    }
  }
  if (refundSource) {
    await pool.query(
      "INSERT INTO billing_refunds(tenant_id,facility_id,invoice_id,payment_id,refund_number,amount,refund_method,reason,manual_confirmation,idempotency_key,request_hash,actor_user_id,created_at) VALUES($1,$2,$3,$4,$5,100,'CASH','Synthetic refund',true,$6,'synthetic',$7,$8::timestamp)",
      [
        tenant,
        facility,
        refundSource.invoice,
        refundSource.payment,
        `SYN-REF-${suffix}`,
        `synthetic-${suffix}`,
        user,
        `${dateInMonth(day)} 10:00`,
      ],
    );
    await pool.query(
      'UPDATE billing_invoices SET paid_amount=paid_amount-100,balance_amount=balance_amount+100 WHERE id=$1',
      [refundSource.invoice],
    );
  }
  for (let i = 0; i < 7; i++)
    await pool.query(
      'INSERT INTO audit_logs(tenant_id,facility_id,action,resource,timestamp) VALUES($1,$2,$3,$4,$5::timestamp)',
      [
        tenant,
        facility,
        ['PATIENT_REGISTERED', 'PAYMENT_RECORDED', 'ADMISSION_RECORDED'][i % 3],
        ['Patient', 'Invoice', 'Admission'][i % 3],
        `${dateInMonth(Math.max(1, day - i))} 11:00`,
      ],
    );
  for (let i = 0; i < 4; i++)
    await pool.query(
      "INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,appointment_type,status) VALUES($1,$2,$3,$4,'Synthetic consultation','Scheduled')",
      [tenant, facility, patientIds[i + 15], `${today} 23:${String(10 + i * 10).padStart(2, '0')}`],
    );
  await pool.query(
    "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,fee) VALUES($1,$2,$3,'Synthetic Consultation','OPD',1000)",
    [tenant, facility, `SYN-CONSULT-${suffix}`],
  );
  console.log('Isolated synthetic dashboard fixture and secure bootstrap: PASS');

  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveStarted, reject) => {
    let log = '';
    const timer = setTimeout(
      () => reject(new Error('Production server startup timed out.')),
      20000,
    );
    server.stdout.on('data', (chunk) => {
      log += chunk;
      if (log.includes('listening on')) {
        clearTimeout(timer);
        resolveStarted();
      }
    });
    server.stderr.on('data', (chunk) => {
      log += chunk;
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Production server exited (${code}).`));
    });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Synthetic server readiness failed.');
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args:
      process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    ),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  const dashboardResponses = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/dashboard/overview'))
      dashboardResponses.push({
        status: response.status(),
        url: response.url(),
        type: response.headers()['content-type'],
      });
  });
  await page.setViewport({ width: 1568, height: 882, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelector('main')?.innerText.includes('Synthetic Hospital — Test Facility'),
    { timeout: 25000 },
  );
  await page.waitForFunction(
    () => document.querySelector('main')?.innerText.includes('Synthetic consultation'),
    { timeout: 25000 },
  );
  check(
    dashboardResponses.some(
      (item) => item.status === 200 && item.type?.includes('application/json'),
    ),
    'Dashboard JSON API did not succeed.',
  );
  check(
    await page.evaluate(() => document.body.innerText.includes('Synthetic Clinician')),
    'Authenticated identity not displayed.',
  );
  check(
    await page.evaluate(() => document.body.innerText.includes('Collection rate')),
    'Billing limitation not displayed.',
  );
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, 'desktop-synthetic.png') });
  await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Tablet has horizontal page overflow.',
  );
  await page.screenshot({ path: resolve(screenshotDir, 'tablet-synthetic.png') });
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  // Changing Chromium's mobile emulation can reload the page and re-check the real session.
  await page.waitForFunction(
    () => document.querySelector('main')?.innerText.includes('Synthetic Hospital — Test Facility'),
    { timeout: 25000 },
  );
  await page.waitForFunction(
    () => document.querySelector('main')?.innerText.includes('Synthetic consultation'),
    { timeout: 25000 },
  );
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile has horizontal page overflow.',
  );
  await page.screenshot({ path: resolve(screenshotDir, 'mobile-synthetic.png') });
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight;
  });
  await page.screenshot({ path: resolve(screenshotDir, 'mobile-lower-synthetic.png') });
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.click('button[aria-label="Toggle navigation"]');
  await page.waitForFunction(
    () => document.querySelector('aside')?.getBoundingClientRect().left >= 0,
    { timeout: 5000 },
  );
  await page.click('button[aria-label="Close menu"]');
  await page.setViewport({ width: 1568, height: 882, deviceScaleFactor: 1 });
  await page.waitForFunction(
    () => document.querySelector('main')?.innerText.includes('Synthetic Hospital — Test Facility'),
    { timeout: 25000 },
  );
  await page.click('button[aria-label="Collapse navigation"]');
  await page.waitForFunction(
    () => document.querySelector('aside')?.getBoundingClientRect().width < 100,
    { timeout: 5000 },
  );
  await page.click('button[aria-label="Expand navigation"]');
  await page.waitForFunction(
    () => document.querySelector('aside')?.getBoundingClientRect().width > 200,
    { timeout: 5000 },
  );
  await page.click('button[aria-label="Select dashboard date range"]');
  const before = dashboardResponses.length;
  const changed = page.waitForResponse(
    (response) => response.url().includes('/api/dashboard/overview') && response.status() === 200,
    { timeout: 10000 },
  );
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === 'Yesterday')
      ?.click(),
  );
  const changedResponse = await changed;
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const params = new URL(changedResponse.url()).searchParams;
  check(
    dashboardResponses.length > before &&
      params.get('start') === yesterday &&
      params.get('end') === yesterday,
    'Yesterday did not request the selected date range.',
  );
  await page.click('button[aria-label="Notifications"]');
  check(
    await page.evaluate(() =>
      document.body.innerText.includes('persistent notification inbox is not configured'),
    ),
    'Notification limitation not shown.',
  );
  await page.keyboard.press('Escape');
  const searchResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/dashboard/search') && response.request().method() === 'POST',
    { timeout: 10000 },
  );
  const mrn = `SYN-MRN-${suffix}-1`;
  await page.type('input[aria-label="Search patients, invoices, or services"]', mrn);
  check((await searchResponse).status() === 200, 'Authenticated dashboard search failed.');
  await page.waitForFunction(
    (record) =>
      Array.from(document.querySelectorAll('button')).some(
        (button) =>
          button.textContent.includes(record) && button.textContent.includes('Open directory'),
      ),
    { timeout: 10000 },
    mrn,
  );
  await page.evaluate(
    (record) =>
      Array.from(document.querySelectorAll('button'))
        .find(
          (button) =>
            button.textContent.includes(record) && button.textContent.includes('Open directory'),
        )
        .click(),
    mrn,
  );
  await page.waitForFunction(
    (record) =>
      document.querySelector('input[placeholder^="Search patient name"]')?.value === record,
    { timeout: 10000 },
    mrn,
  );
  check(errors.length === 0, `Browser page errors: ${errors.join(', ')}`);
  console.log(
    'Production Chromium dashboard, date filter, scoped search, JSON, desktop/tablet/mobile and navigation: PASS',
  );
  console.log(
    'Screenshots: docs/dashboard/screenshots/{desktop,tablet,mobile,mobile-lower}-synthetic.png',
  );
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise((done) => server.once('exit', done));
  }
  await pool.end();
}
