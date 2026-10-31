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
  if (process.env.ENTERPRISE_UI_SMOKE === 'YES') {
    modules.push('accounting', 'dialysis', 'patient_portal');
  }
  const facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules,mfl_code,timezone) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id',
      [
        tenant,
        `SYN-DASH-${suffix}`,
        'Synthetic Hospital — Test Facility',
        JSON.stringify(modules),
        `SYN-${suffix}`,
        'Africa/Nairobi',
      ],
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
    'theatre.read',
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
  if (process.env.ENTERPRISE_UI_SMOKE === 'YES') {
    permissions.push(
      'dialysis.read',
      'accounting.read',
      'payment_hub.transactions.read',
      'insurance.sha.read',
      'insurance.sha.claims.read',
      'insurance.payers.read',
      'insurance.members.read',
      'portal.accounts.manage',
      'system.settings.manage',
      'facilities.update',
      'audit.security.read',
    );
  }
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
  if (process.env.ENTERPRISE_UI_SMOKE === 'YES') {
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name,clinical_indication,ordered_by) VALUES($1,$2,$3,'X-Ray','Synthetic imaging request','Synthetic clinical reason','Synthetic Clinician')",
      [tenant, facility, patientIds[0]],
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
      await pool.query(
        "INSERT INTO beds(ward_id,bed_number,status,current_patient_id) VALUES($1,$2,'Occupied',$3) RETURNING id",
        [ward, `S-${i}`, patientIds[i]],
      )
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
    "INSERT INTO queues(tenant_id,facility_id,patient_id,queue_type,token_number,status) VALUES($1,$2,$3,'Triage','SYN-TRG-1','Waiting')",
    [tenant, facility, patientIds[15]],
  );
  await pool.query(
    "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,fee) VALUES($1,$2,$3,'Synthetic Consultation','OPD',1000)",
    [tenant, facility, `SYN-CONSULT-${suffix}`],
  );
  // All names and quantities are synthetic. Alerts are derived from these persisted rows.
  const addDays = (n) => new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
  const inventory = await pool.query(
    `INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock,reorder_level,unit_cost,selling_price) VALUES
    ($1,$2,'Synthetic Amoxicillin 500mg','capsules',100,20,50,75),
    ($1,$3,'Synthetic Saline','bags',5,15,10,15),
    ($1,$4,'Synthetic Glucose Strips','packs',0,10,1,5) RETURNING id`,
    [facility, `SYN-MED-${suffix}`, `SYN-LOW-${suffix}`, `SYN-OUT-${suffix}`],
  );
  const medicine = inventory.rows[0].id;
  await pool.query(
    `INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES
    ($1,'SYN-EXPIRED',$2,12),($1,'SYN-SOON',$3,18),($1,'SYN-30',$4,20)`,
    [medicine, addDays(-1), addDays(7), addDays(30)],
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
  const rateLimited = [];
  page.on('response', (response) => {
    if (response.status() === 429) rateLimited.push(new URL(response.url()).pathname);
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
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Active operational alerts"]')
        ?.innerText.includes('expired batch'),
    { timeout: 25000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('button[aria-controls="notification-centre"]')
        ?.getAttribute('aria-label')
        ?.includes('unread'),
    { timeout: 25000 },
  );
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, 'refinement-desktop-synthetic.png') });
  await page.click('button[aria-controls="notification-centre"]');
  await page.waitForFunction(
    () => document.querySelector('#notification-centre')?.innerText.includes('SYN-EXPIRED'),
    { timeout: 10000 },
  );
  await page.screenshot({
    path: resolve(screenshotDir, 'refinement-desktop-notifications-synthetic.png'),
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('h2'))
      .find((el) => el.textContent.trim() === 'Operational overview')
      ?.scrollIntoView(),
  );
  await page.screenshot({
    path: resolve(screenshotDir, 'refinement-desktop-operations-synthetic.png'),
  });
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Tablet has horizontal page overflow.',
  );
  await page.screenshot({ path: resolve(screenshotDir, 'refinement-tablet-synthetic.png') });
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
  await page.screenshot({ path: resolve(screenshotDir, 'refinement-mobile-synthetic.png') });
  await page.click('button[aria-controls="notification-centre"]');
  await page.waitForFunction(
    () => document.querySelector('#notification-centre')?.innerText.includes('SYN-EXPIRED'),
    { timeout: 10000 },
  );
  check(
    await page.evaluate(() => {
      const box = document.querySelector('#notification-centre').getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    }),
    'Mobile notification panel is outside the viewport.',
  );
  await page.screenshot({
    path: resolve(screenshotDir, 'refinement-mobile-notifications-synthetic.png'),
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight;
  });
  await page.screenshot({ path: resolve(screenshotDir, 'refinement-mobile-lower-synthetic.png') });
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.click('button[aria-label="Toggle navigation"]');
  await page.waitForFunction(
    () => document.querySelector('aside')?.getBoundingClientRect().left >= 0,
    { timeout: 5000 },
  );
  await page.click('button[aria-label="Close menu"]');
  await page.setViewport({
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await page.waitForFunction(
    () => document.querySelector('main')?.innerText.includes('Synthetic Hospital — Test Facility'),
    { timeout: 25000 },
  );
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Small mobile has horizontal page overflow.',
  );
  await page.click('button[aria-controls="notification-centre"]');
  await page.waitForSelector('#notification-centre');
  check(
    await page.evaluate(() => {
      const box = document.querySelector('#notification-centre').getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    }),
    'Small mobile notification panel extends outside the viewport.',
  );
  check(
    await page.evaluate(() => {
      const row = document.querySelector('[aria-label="Notification severity filters"]');
      const r = row.getBoundingClientRect();
      return Array.from(row.querySelectorAll('button')).every((button) => {
        const b = button.getBoundingClientRect();
        return b.top >= r.top && b.bottom <= r.bottom;
      });
    }),
    'Small mobile severity filters are vertically clipped.',
  );
  await page.screenshot({
    path: resolve(screenshotDir, 'refinement-small-mobile-notifications-synthetic.png'),
  });
  await page.keyboard.press('Escape');
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
  await page.click('button[aria-controls="notification-centre"]');
  await page.waitForSelector('button[aria-label="Mark Expired stock read"]');
  const individual = page.waitForResponse(
    (response) =>
      response.url().includes('/api/notifications/read') && response.request().method() === 'POST',
  );
  await page.click('button[aria-label="Mark Expired stock read"]');
  check((await individual).status() === 200, 'Mark individual read failed.');
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Mark Expired stock read"]'),
    { timeout: 10000 },
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () =>
      document
        .querySelector('button[aria-controls="notification-centre"]')
        ?.getAttribute('aria-label')
        ?.includes('unread'),
    { timeout: 25000 },
  );
  await page.click('button[aria-controls="notification-centre"]');
  await page.waitForFunction(
    () => document.querySelector('#notification-centre')?.innerText.includes('SYN-EXPIRED'),
    { timeout: 10000 },
  );
  check(
    !(await page.$('button[aria-label="Mark Expired stock read"]')),
    'Read state did not survive reload.',
  );
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('#notification-centre button'))
      .find((button) => button.textContent.trim() === 'Warning')
      .click(),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#notification-centre')?.innerText.includes('Low stock') &&
      !document.querySelector('#notification-centre')?.innerText.includes('Expired stock'),
    { timeout: 10000 },
  );
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('#notification-centre button'))
      .find((button) => button.textContent.trim() === 'All')
      .click(),
  );
  const allRead = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/notifications/read-all') &&
      response.request().method() === 'POST',
  );
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('#notification-centre button'))
      .find((button) => button.textContent.trim() === 'Mark all read')
      .click(),
  );
  check((await allRead).status() === 200, 'Mark all read failed.');
  await page.waitForFunction(
    () =>
      document
        .querySelector('button[aria-controls="notification-centre"]')
        ?.getAttribute('aria-label')
        ?.includes('0 unread'),
    { timeout: 10000 },
  );
  check(
    await page.evaluate(() =>
      document
        .querySelector('button[aria-controls="notification-centre"]')
        ?.getAttribute('aria-label')
        ?.includes('critical alerts active'),
    ),
    'Critical active indicator disappeared after marking read.',
  );
  check(
    await page.evaluate(() =>
      document
        .querySelector('[aria-label="Active operational alerts"]')
        ?.innerText.includes('expired batch'),
    ),
    'Read action incorrectly cleared the active alert.',
  );
  const audit = await pool.query(
    "SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND user_id=$3 AND action='MARK_READ'",
    [tenant, facility, String(user)],
  );
  check(audit.rows[0].count >= 2, 'Notification read actions were not audited.');
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
  if (process.env.ENTERPRISE_UI_SMOKE === 'YES') {
    const uiDir = resolve(root, 'docs/ui/screenshots');
    await mkdir(uiDir, { recursive: true });
    // Separate browser context and bootstrap account: platform administration must
    // not acquire facility-financial access merely by being a super administrator.
    const platformContext = await browser.createBrowserContext();
    try {
      const platform = await platformContext.newPage();
      platform.on('pageerror', (error) => errors.push(error.name));
      const platformAuthStatuses = [];
      platform.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith('/api/auth/')) platformAuthStatuses.push([path, response.status()]);
        if (response.status() === 429) rateLimited.push(path);
      });
      await platform.setViewport({ width: 1568, height: 882, deviceScaleFactor: 1 });
      await platform.goto(base, { waitUntil: 'networkidle2' });
      await platform.type('input[placeholder="Username or Email"]', env.ADMIN_USERNAME);
      await platform.type('input[placeholder="Password"]', env.ADMIN_PASSWORD);
      await platform.click('button[type="submit"]');
      try {
        await platform.waitForFunction(
          () =>
            ['Platform Management', 'Tenant & Facility Administration'].some((title) =>
              document.querySelector('main h1')?.textContent.includes(title),
            ),
          { timeout: 25000 },
        );
      } catch (cause) {
        const state = await platform.evaluate(() => ({
          login: Boolean(document.querySelector('input[placeholder="Username or Email"]')),
          headings: [...document.querySelectorAll('h1')].map((element) =>
            element.textContent.trim(),
          ),
          alerts: [...document.querySelectorAll('[role="alert"]')].map((element) =>
            element.textContent.trim().slice(0, 120),
          ),
        }));
        throw new Error(
          `Synthetic platform login did not reach the dashboard: ${JSON.stringify(state)}, auth statuses: ${JSON.stringify(platformAuthStatuses)}`,
          { cause },
        );
      }
      await platform.click('aside button[title="Platform Management"]');
      await platform.waitForFunction(
        () => document.querySelector('main h1')?.textContent.includes('Platform Management'),
        { timeout: 25000 },
      );
      check(
        !(await platform.$('aside button[title="Billing & Invoicing"]')),
        'Platform account was offered facility-financial navigation.',
      );
      const financeStatus = await platform.evaluate(async (facilityId) => {
        const token = localStorage.getItem('jalicare_session_token');
        const response = await fetch(`/api/invoices?facilityId=${facilityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return response.status;
      }, facility);
      check(
        financeStatus === 403,
        `Platform account unexpectedly accessed facility invoices (HTTP ${financeStatus}).`,
      );
      await platform.click('aside button[title="Tenant & Facility Management"]');
      await platform.waitForFunction(
        () =>
          document
            .querySelector('main h1')
            ?.textContent.includes('Tenant & Facility Administration'),
        { timeout: 25000 },
      );
      await platform.waitForNetworkIdle({ idleTime: 300, timeout: 15000 });
      for (const width of [1568, 768, 320]) {
        await platform.setViewport({
          width,
          height: width === 1568 ? 882 : width === 768 ? 1024 : 568,
          deviceScaleFactor: 1,
        });
        const state = await platform.evaluate(() => ({
          shells: document.querySelectorAll('.app-shell').length,
          headers: document.querySelectorAll('.dashboard-header').length,
          breadcrumbs: document.querySelectorAll('nav[aria-label="Breadcrumb"]').length,
          viewport: innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          mainWidth: document.querySelector('main').clientWidth,
          contentWidth: document.querySelector('main').scrollWidth,
        }));
        check(
          state.shells === 1 &&
            state.headers === 1 &&
            state.breadcrumbs === 1 &&
            state.pageWidth <= state.viewport &&
            state.contentWidth <= state.mainWidth + 1,
          `Platform layout at ${width}px: ${JSON.stringify(state)}`,
        );
        if (width === 1568 || width === 320)
          await platform.screenshot({
            path: resolve(
              uiDir,
              `platform-administration-${width === 1568 ? 'desktop' : 'small-mobile'}-synthetic.png`,
            ),
          });
      }
      console.log(
        'Platform administration shell, desktop/tablet/mobile and facility-financial denial: PASS',
      );
    } finally {
      await platformContext.close();
    }

    const screens = [
      ['Patient Management', 'Patient Identification & Registration', 'registration'],
      ['Appointments & Queue', 'Reception, Queues & Appointment Navigation', 'reception'],
      ['Outpatient Services', 'Outpatient Triage & Clinical Consultation Desk', 'outpatient'],
      ['Inpatient Management', 'Inpatient Care, Wards & Bed Board', 'inpatient'],
      ['Maternity & MCH', 'Maternity & MCH', 'maternity'],
      ['Operating Theatre', 'Theatre scheduling', 'theatre'],
      ['Dialysis Unit', 'Dialysis unit', 'dialysis'],
      ['Specialty Clinics', 'Specialized Clinical Framework', 'specialty'],
      ['Laboratory & Pathology', 'Clinical Pathology & Diagnostic Laboratory', 'laboratory'],
      ['Radiology & Imaging', 'Diagnostic Radiology & Medical Imaging', 'radiology'],
      ['Pharmacy & Dispense', 'Outpatient Pharmacy & Drug Dispensing POS', 'pharmacy'],
      ['Inventory & Batches', 'Hospital Inventory, Batches & Stores', 'inventory'],
      ['Procurement & POs', 'Hospital Procurement & Purchase Orders', 'procurement'],
      ['Billing & Invoicing', 'Patient Billing, Cashier POS & Receipts', 'billing'],
      ['Payment Transactions', 'Payment Transactions & Reconciliation', 'payments'],
      ['Accounting & General Ledger', 'Accounting & general ledger', 'accounting'],
      ['Insurance & SHA eClaims', 'Insurance & SHA eClaims', 'sha-eclaims'],
      ['Private Insurance', 'Private Insurance & Multi-Payer Claims Engine', 'private-insurance'],
      ['Reports & Analytics', 'Reports & Analytics', 'reports'],
      ['MOH 705 Surveillance', 'Surveillance & MOH 705', 'surveillance'],
      ['System Configuration', 'Hospital Configuration Engine', 'settings'],
      ['Patient Portal Management', 'Patient Portal Management', 'portal-administration'],
      ['Audit Trail & Security', 'Security Audit Trail', 'audit'],
    ];
    const navigate = async ([label, title, slug], mobile = false) => {
      if (mobile) {
        const open = await page.$(
          'button[aria-label="Toggle navigation"], button[aria-label="Expand navigation"]',
        );
        check(open, `Navigation toggle missing before ${label}`);
        await open.click();
        await page.waitForFunction(
          () => document.querySelector('aside')?.getBoundingClientRect().left >= 0,
        );
      }
      const selector = `aside button[title="${label}"]`;
      await page.waitForSelector(selector, { timeout: 10000 });
      await page.$eval(selector, (button) => button.scrollIntoView({ block: 'center' }));
      await page.click(selector);
      try {
        await page.waitForFunction(
          (name) =>
            Array.from(document.querySelectorAll('main h1')).some((node) =>
              node.textContent.includes(name),
            ),
          { timeout: 25000 },
          title,
        );
      } catch {
        const state = await page.evaluate(() => ({
          headings: [...document.querySelectorAll('main h1')].map((node) =>
            node.textContent.trim(),
          ),
          alerts: [...document.querySelectorAll('main [role="alert"]')].map((node) =>
            node.textContent.trim().slice(0, 120),
          ),
          active: document.querySelector('aside [aria-current="page"]')?.getAttribute('title'),
        }));
        throw new Error(
          `Could not open ${label} at ${page.viewport().width}px: ${JSON.stringify(state)}; rate-limited requests: ${rateLimited.length}`,
        );
      }
      if (slug === 'radiology') {
        await page.waitForFunction(
          () =>
            document
              .querySelector('main')
              ?.textContent.includes('Imaging connection not verified.'),
          { timeout: 25000 },
        );
        await page.waitForFunction(
          () => document.querySelector('main')?.textContent.includes('Synthetic Patient 01'),
          { timeout: 25000 },
        );
      }
      if (slug === 'private-insurance') {
        await page.waitForFunction(
          () =>
            !document
              .querySelector('main')
              ?.textContent.includes('Loading Private Insurance multi-payer workspace'),
          { timeout: 25000 },
        );
      }
      await page.evaluate(() => {
        document.querySelector('main').scrollTop = 0;
      });
      const layout = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          shells: document.querySelectorAll('.app-shell').length,
          headers: document.querySelectorAll('.dashboard-header').length,
          navigation: document.querySelectorAll('nav[aria-label="Main navigation"]').length,
          breadcrumbs: document.querySelectorAll('nav[aria-label="Breadcrumb"]').length,
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          contentWidth: main.scrollWidth,
          visibleWidth: main.clientWidth,
          outside: [...main.querySelectorAll('*')]
            .filter((element) => {
              const style = getComputedStyle(element),
                box = element.getBoundingClientRect();
              return (
                style.position !== 'fixed' &&
                style.display !== 'none' &&
                box.right > main.getBoundingClientRect().right + 1 &&
                !element.closest('.ui-table-scroll, [class*="overflow-x-auto"]')
              );
            })
            .slice(0, 8)
            .map((element) => {
              const box = element.getBoundingClientRect();
              return `${element.tagName}.${String(element.className).slice(0, 100)} x=${Math.round(box.x)} right=${Math.round(box.right)} width=${Math.round(box.width)}`;
            }),
        };
      });
      check(
        layout.shells === 1 &&
          layout.headers === 1 &&
          layout.navigation === 1 &&
          layout.breadcrumbs === 1,
        `Duplicated or missing shell on ${label}: ${JSON.stringify(layout)}`,
      );
      check(
        layout.pageWidth <= layout.viewport && layout.contentWidth <= layout.visibleWidth + 1,
        `Overflow on ${label}: ${JSON.stringify(layout)}`,
      );
      if (mobile)
        check(
          await page.evaluate(
            () => document.querySelector('aside').getBoundingClientRect().right <= 1,
          ),
          `Mobile drawer did not close on ${label}`,
        );
    };
    check(
      !(await page.$('aside button[title="Tenant & Facility Management"]')),
      'Facility user received platform-only navigation.',
    );
    for (const screen of screens) {
      await navigate(screen);
      if (
        [
          'registration',
          'reception',
          'maternity',
          'specialty',
          'laboratory',
          'radiology',
          'inventory',
          'billing',
          'sha-eclaims',
          'private-insurance',
          'settings',
          'audit',
        ].includes(screen[2])
      ) {
        await page.screenshot({ path: resolve(uiDir, `${screen[2]}-desktop-synthetic.png`) });
      }
    }
    console.log(
      `Enterprise desktop navigation and single-shell checks: ${screens.length} modules PASS`,
    );

    for (const width of [768, 390, 320]) {
      if (width === 390) {
        // Respect the production 300 requests/minute limiter during this unusually
        // rapid platform + multi-module audit; do not weaken it for the browser run.
        await new Promise((resolveWait) => setTimeout(resolveWait, 61_000));
      }
      await page.setViewport({
        width,
        height: width === 768 ? 1024 : width === 390 ? 844 : 568,
        deviceScaleFactor: 1,
      });
      await page.waitForSelector('aside nav', { timeout: 25000 });
      const mobile = width < 768;
      for (const screen of screens) {
        await navigate(screen, mobile);
        if (
          width === 320 &&
          [
            'registration',
            'reception',
            'radiology',
            'inventory',
            'billing',
            'sha-eclaims',
            'settings',
          ].includes(screen[2])
        ) {
          await page.screenshot({
            path: resolve(uiDir, `${screen[2]}-small-mobile-synthetic.png`),
          });
        }
        if (width === 768 && ['laboratory', 'private-insurance'].includes(screen[2])) {
          await page.screenshot({ path: resolve(uiDir, `${screen[2]}-tablet-synthetic.png`) });
        }
      }
      console.log(
        `Enterprise ${width}px navigation, breadcrumbs and overflow: ${screens.length} modules PASS`,
      );
    }
    const registration = screens.find((screen) => screen[2] === 'registration');
    await navigate(registration, true);
    await page.waitForSelector('main .ui-table-scroll');
    check(
      await page.$eval(
        'main .ui-table-scroll',
        (region) => region.scrollWidth > region.clientWidth,
      ),
      'Registration table did not provide horizontal scrolling at 320px.',
    );
    await page.focus('main .ui-table-scroll');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      () => document.querySelector('main .ui-table-scroll').scrollLeft > 0,
      { timeout: 5000 },
    );
    const sha = screens.find((screen) => screen[2] === 'sha-eclaims');
    await navigate(sha, true);
    check(
      await page.$eval(
        'main .ui-page-header',
        (header) => header.getBoundingClientRect().height < 300,
      ),
      'Mobile page header contains excessive empty space.',
    );
    const specialty = screens.find((screen) => screen[2] === 'specialty');
    await navigate(specialty, true);
    check(
      await page.evaluate(() =>
        document
          .querySelector('main')
          .textContent.includes('former example forms did not persist records'),
      ),
      'Specialty limitations were not shown.',
    );
    check(
      !(await page.evaluate(() =>
        [...document.querySelectorAll('main button')].some((button) =>
          /Save Dental|Save Optical|Save ENT/.test(button.textContent),
        ),
      )),
      'Specialty exposed a non-persistent save action.',
    );
    await page.click('#specialty-tab-Renal');
    check(
      await page.evaluate(() =>
        [...document.querySelectorAll('main button')].some(
          (button) => button.textContent.trim() === 'Open dialysis',
        ),
      ),
      'Authorized dialysis navigation is missing from specialty care.',
    );
    const radiology = screens.find((screen) => screen[2] === 'radiology');
    await navigate(radiology, true);
    check(
      !(await page.evaluate(() =>
        /DICOM 3\.0 Connected|128 Slices/.test(document.querySelector('main').textContent),
      )),
      'Radiology displayed invented PACS metadata.',
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')]
        .find((button) => button.textContent.includes('New Imaging Request'))
        .click(),
    );
    await page.waitForSelector('[role="dialog"]');
    const imaging = await page.$eval('[role="dialog"]', (dialog) => {
      const box = dialog.getBoundingClientRect(),
        action = dialog
          .querySelector('button[form="radiology-request-form"]')
          .getBoundingClientRect();
      return {
        bounded:
          box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
        actionVisible: action.top >= 0 && action.bottom <= innerHeight,
        patient: dialog.querySelector('#radiology-patient').value,
        procedure: dialog.querySelector('#radiology-procedure').value,
        indication: dialog.querySelector('#radiology-indication').value,
      };
    });
    check(
      imaging.bounded &&
        imaging.actionVisible &&
        !imaging.patient &&
        !imaging.procedure &&
        !imaging.indication,
      `Imaging dialog unsafe at 320px: ${JSON.stringify(imaging)}`,
    );
    await page.screenshot({ path: resolve(uiDir, 'radiology-modal-small-mobile-synthetic.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const reception = screens.find((screen) => screen[2] === 'reception');
    await navigate(reception, true);
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')]
        .find((button) => button.textContent.trim() === 'Book Appointment')
        .click(),
    );
    await page.waitForSelector('[role="dialog"][aria-modal="true"]');
    let modal = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const box = dialog.getBoundingClientRect();
      return {
        bounded:
          box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
        focused: dialog.contains(document.activeElement),
        actionVisible: (() => {
          const action = dialog
            .querySelector('button[form="appointment-form"]')
            .getBoundingClientRect();
          return action.top >= 0 && action.bottom <= innerHeight;
        })(),
        patient: dialog.querySelector('#appointment-patient')?.value,
        time: dialog.querySelector('#appointment-time')?.value,
        reason: dialog.querySelector('#appointment-reason')?.value,
      };
    });
    check(
      modal.bounded &&
        modal.focused &&
        modal.actionVisible &&
        !modal.patient &&
        !modal.time &&
        !modal.reason,
      `Appointment modal bounds, focus or blank inputs failed: ${JSON.stringify(modal)}`,
    );
    await page.screenshot({ path: resolve(uiDir, 'appointment-modal-small-mobile-synthetic.png') });
    await page.keyboard.press('Escape');
    check(
      !(await page.$('[role="dialog"][aria-modal="true"]')),
      'Appointment dialog did not close on Escape.',
    );
    const inventory = screens.find((screen) => screen[2] === 'inventory');
    await navigate(inventory, true);
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')]
        .find((button) => button.textContent.trim() === 'Add Stock Item')
        .click(),
    );
    await page.waitForSelector('[role="dialog"][aria-modal="true"]');
    modal = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const box = dialog.getBoundingClientRect();
      return {
        bounded:
          box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
        focused: dialog.contains(document.activeElement),
        actionVisible: (() => {
          const action = dialog
            .querySelector('button[form="inventory-item-form"]')
            .getBoundingClientRect();
          return action.top >= 0 && action.bottom <= innerHeight;
        })(),
        item: dialog.querySelector('#inventory-field-1')?.value,
      };
    });
    check(
      modal.bounded && modal.focused && modal.actionVisible && !modal.item,
      `Inventory modal bounds, focus or blank inputs failed: ${JSON.stringify(modal)}`,
    );
    await page.screenshot({ path: resolve(uiDir, 'inventory-modal-small-mobile-synthetic.png') });
    await page.keyboard.press('Escape');
    check(
      rateLimited.length === 0,
      `Synthetic layout run hit the production rate limiter ${rateLimited.length} times: ${JSON.stringify(rateLimited)}.`,
    );
    console.log(
      'Mobile appointment, imaging and inventory modal bounds, visible actions, Escape and blank data: PASS',
    );
    console.log('Synthetic screenshots: docs/ui/screenshots/*-synthetic.png');
  }

  check(errors.length === 0, `Browser page errors: ${errors.join(', ')}`);
  console.log(
    'Production Chromium dashboard, notification filters/read persistence/audit, date filter, scoped search and responsive navigation: PASS',
  );
  console.log('Screenshots: docs/dashboard/screenshots/refinement-*-synthetic.png');
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise((done) => server.once('exit', done));
  }
  await pool.end();
}
