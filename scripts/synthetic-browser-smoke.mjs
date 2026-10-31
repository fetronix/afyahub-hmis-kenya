import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';

// Intentionally write synthetic fixtures only to an explicitly acknowledged,
// local test database. This script never migrates, drops, or resets a database.
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
    'Use BROWSER_SMOKE_SYNTHETIC=YES, a loopback SQL_HOST, a dedicated synthetic/browser test SQL_DB_NAME, SQL_ADMIN_USER and CHROME_EXECUTABLE_PATH.',
  );
}
const sqlPort = Number(process.env.SQL_PORT ?? '5432');
if (!Number.isInteger(sqlPort) || sqlPort < 1 || sqlPort > 65535)
  throw new Error('Invalid SQL_PORT');
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(32).toString('base64url');
const adminPassword = randomBytes(32).toString('base64url');
const username = `browser_${suffix}`;
const port = Number(process.env.BROWSER_SMOKE_PORT ?? '4192');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid BROWSER_SMOKE_PORT');
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SQL_HOST: host,
  SQL_PORT: String(sqlPort),
  SQL_DB_NAME: database,
  SQL_ADMIN_USER: process.env.SQL_ADMIN_USER,
  SQL_ADMIN_PASSWORD: process.env.SQL_ADMIN_PASSWORD ?? '',
  SQL_SSL: 'false',
  TZ: 'Africa/Nairobi',
  DEFAULT_TIMEZONE: 'Africa/Nairobi',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base,
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'silent',
  ADMIN_USERNAME: `platform_browser_${suffix}`,
  ADMIN_EMAIL: `platform_${suffix}@example.test`,
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
let server,
  browser,
  page,
  phase = 'setup',
  serverLog = '',
  bad = [],
  apiTail = [],
  initial401Auth = null;
const check = (v, msg) => {
  if (!v) throw new Error(msg);
};
try {
  const bootstrap = spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
    cwd: root,
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  check(bootstrap.status === 0, 'Synthetic secure platform bootstrap failed');
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      `Synthetic Browser Tenant ${suffix}`,
      `browser-${suffix}`,
    ])
  ).rows[0].id;
  const modules = [
    'registration',
    'reception',
    'opd',
    'inpatient',
    'laboratory',
    'pharmacy',
    'inventory',
    'finance',
    'accounting',
    'patient_portal',
  ];
  const facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
      [tenant, `BR-${suffix}`, 'Synthetic Browser Facility', JSON.stringify(modules)],
    )
  ).rows[0].id;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const user = (
    await pool.query(
      "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Browser User',$3,'ACTIVE',$4,$5) RETURNING id",
      [username, `${username}@example.test`, passwordHash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [tenant, `BROWSER_${suffix}`],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  const permissions = [
    'patients.read',
    'patients.create',
    'appointments.read',
    'appointments.create',
    'clinical.read',
    'clinical.create',
    'clinical.update',
    'inpatient.read',
    'inpatient.admit',
    'laboratory.read',
    'laboratory.orders.create',
    'laboratory.results.enter',
    'laboratory.results.verify',
    'pharmacy.read',
    'pharmacy.dispense',
    'inventory.read',
    'billing.read',
    'billing.update',
    'billing.payments.record',
    'billing.refunds.record',
    'accounting.read',
    'accounting.journals.post',
    'portal.accounts.manage',
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
  const patient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Browser Patient','2000-01-01','Other') RETURNING id",
      [tenant, facility, `BRP-${suffix}`],
    )
  ).rows[0].id;
  const portalIdentifier = `synthetic-${suffix}@example.test`;
  await pool.query(
    "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE')",
    [tenant, facility, patient, portalIdentifier, passwordHash],
  );
  const ward = (
    await pool.query(
      "INSERT INTO wards(facility_id,name,code,ward_type,total_beds,daily_rate,is_active) VALUES($1,'Synthetic browser ward',$2,'General',1,NULL,true) RETURNING id",
      [facility, `W-${suffix}`],
    )
  ).rows[0].id;
  const bed = (
    await pool.query(
      "INSERT INTO beds(ward_id,bed_number,status,daily_charge) VALUES($1,'SYN-01','Available',NULL) RETURNING id",
      [ward],
    )
  ).rows[0].id;
  const encounter = (
    await pool.query(
      "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id",
      [tenant, facility, patient],
    )
  ).rows[0].id;
  const prescription = (
    await pool.query(
      "INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,quantity,status) VALUES($1,$2,'Synthetic browser medicine','test','test','test',10,'Prescribed') RETURNING id",
      [encounter, patient],
    )
  ).rows[0].id;
  const item = (
    await pool.query(
      "INSERT INTO inventory_items(facility_id,item_code,name,current_stock) VALUES($1,$2,'Synthetic browser stock',20) RETURNING id",
      [facility, `BRS-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,$2,'2040-01-01',20)",
    [item, `BATCH-${suffix}`],
  );
  const invoice = (
    await pool.query(
      "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status) VALUES($1,$2,$3,$4,'100.00','100.00','0.00','0.00','Paid') RETURNING id",
      [tenant, facility, patient, `INV-BROWSER-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,'Synthetic','Synthetic browser service',1,'100.00','100.00')",
    [invoice],
  );
  const payment = (
    await pool.query(
      "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name) VALUES($1,$2,'Cash','100.00','Synthetic browser cashier') RETURNING id",
      [invoice, `RCP-BROWSER-${suffix}`],
    )
  ).rows[0].id;
  const test = (
    await pool.query(
      "INSERT INTO lab_tests(facility_id,code,name,specimen_type) VALUES($1,$2,'Synthetic browser lab','Blood') RETURNING id",
      [facility, `LAB-${suffix}`],
    )
  ).rows[0].id;
  const labOrder = (
    await pool.query(
      "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_id,test_name,status,specimen_type) VALUES($1,$2,$3,$4,$5,'Synthetic browser lab','Ordered','Blood') RETURNING id",
      [tenant, facility, patient, encounter, test],
    )
  ).rows[0].id;
  console.log('Synthetic isolated fixture and platform bootstrap: PASS');
  phase = 'server';
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Server startup timeout')), 20000);
    server.stdout.on('data', (chunk) => {
      serverLog += chunk;
      if (serverLog.includes('listening on')) {
        clearTimeout(t);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => (serverLog += chunk));
    server.once('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`Server exited during startup (${code})`));
    });
  });
  const health = await fetch(`${base}/api/ready`);
  check(health.status === 200, 'Readiness failed');
  console.log('Production build/server.js started with security enabled: PASS');
  phase = 'browser login';
  browser = await puppeteer.launch({
    args:
      process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    executablePath,
    headless: true,
    // Do not pass database or bootstrap credentials to the browser process.
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    ),
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.name));
  page.on('response', (r) => {
    if (r.url().startsWith(base + '/api')) {
      const row = `${phase}: ${r.status()} ${new URL(r.url()).pathname}`;
      apiTail.push(row);
      if (r.status() >= 400) bad.push(row);
      if (
        r.status() === 401 &&
        new URL(r.url()).pathname === '/api/auth/session' &&
        phase === 'browser login'
      )
        initial401Auth = Boolean(r.request().headers().authorization);
    }
  });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => Boolean(document.querySelector('aside nav')), {
    timeout: 25000,
  });
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Pharmacy & Dispense'),
    { timeout: 20000 },
  );
  check(
    await page.evaluate(() =>
      document.querySelector('main')?.innerText.includes('Synthetic Browser Facility'),
    ),
    'Facility context not displayed',
  );
  console.log('Real Chromium login, dashboard mount and facility-scoped navigation: PASS');
  const clickText = async (text, rootSelector = 'button') => {
    const ok = await page.evaluate(
      (label, sel) => {
        const b = Array.from(document.querySelectorAll(sel)).find(
          (x) => x.textContent.trim() === label,
        );
        if (!b || b.disabled) return false;
        b.click();
        return true;
      },
      text,
      rootSelector,
    );
    check(ok, `Button not found: ${text}`);
  };
  const waitText = async (text) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 45000 }, text);
  const cdp = await page.createCDPSession();
  phase = 'worklist request failure';
  let worklistFailure = false;
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/medications*', requestStage: 'Request' }],
  });
  const failWorklist = async (e) => {
    if (!worklistFailure) {
      worklistFailure = true;
      await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' });
    } else await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
  };
  cdp.on('Fetch.requestPaused', failWorklist);
  await clickText('Pharmacy & Dispense', 'aside button');
  await waitText('Pharmacy data could not be loaded. Do not assume the worklist is empty.');
  check(worklistFailure, 'Failure injection did not intercept the request');
  check(
    !(await page.evaluate(() => document.body.innerText.includes('No prescriptions in'))),
    'Failed worklist looked empty',
  );
  await cdp.send('Fetch.disable');
  cdp.off('Fetch.requestPaused', failWorklist);
  await clickText('Retry loading pharmacy data');
  await waitText('Synthetic browser medicine');
  console.log('Pharmacy API failure warning and retry in real browser: PASS');
  phase = 'partial dispense and dropped response';
  await clickText('Dispense Item');
  await page.waitForSelector('select');
  await page.select('main select', String(item));
  await page.click('main input[type=number]');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('main input[type=number]', '4');
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.textContent.trim() === 'Authorize & Dispense',
    );
    return b && !b.disabled;
  });
  let dropped = false,
    responseCode = null;
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/pharmacy/dispense', requestStage: 'Response' }],
  });
  const dropResponse = async (e) => {
    responseCode = e.responseStatusCode;
    dropped = true;
    await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' });
  };
  cdp.on('Fetch.requestPaused', dropResponse);
  await clickText('Authorize & Dispense');
  await waitText('Unconfirmed dispensing needs review');
  await page.waitForFunction(
    () => document.body.innerText.includes('Dispensing could not be confirmed'),
    { timeout: 18000 },
  );
  check(
    dropped && responseCode === 201,
    `Server response was not interrupted after commit (status ${responseCode})`,
  );
  await cdp.send('Fetch.disable');
  cdp.off('Fetch.requestPaused', dropResponse);
  const local = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('jalicare:pharmacy:pending:'));
    if (!key) return null;
    const p = JSON.parse(localStorage.getItem(key));
    return { fields: Object.keys(p).sort(), prescriptionId: p.prescriptionId };
  });
  check(
    JSON.stringify(local?.fields) === '["key","prescriptionId"]' &&
      local.prescriptionId === prescription,
    'Pending record was not minimal/scoped',
  );
  let db = (
    await pool.query(
      "SELECT m.status,i.current_stock,(SELECT count(*)::int FROM pharmacy_dispensations d WHERE d.prescription_id=m.id) AS dispensations,(SELECT coalesce(sum(a.quantity),0)::int FROM pharmacy_dispense_allocations a JOIN pharmacy_dispensations d ON d.id=a.dispensation_id WHERE d.prescription_id=m.id) AS allocated,(SELECT count(*)::int FROM billing_charge_attempts b WHERE b.facility_id=$3 AND b.status='PENDING') AS pending FROM medications m CROSS JOIN inventory_items i WHERE m.id=$1 AND i.id=$2",
      [prescription, item, facility],
    )
  ).rows[0];
  check(
    db.status === 'Partially Dispensed' &&
      db.current_stock === 16 &&
      db.dispensations === 1 &&
      db.allocated === 4 &&
      db.pending === 1,
    'Committed dispense/stock/billing queue values are incorrect',
  );
  console.log('Partial FEFO dispense, pending unpriced charge and dropped response: PASS');
  phase = 'browser recovery';
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Pharmacy & Dispense'),
    { timeout: 18000 },
  );
  await clickText('Pharmacy & Dispense', 'aside button');
  await waitText('Unconfirmed dispensing needs review');
  await clickText('Check recorded result');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Unconfirmed dispensing needs review'),
    { timeout: 18000 },
  );
  const after = (
    await pool.query(
      'SELECT count(*)::int AS n FROM pharmacy_dispensations WHERE prescription_id=$1',
      [prescription],
    )
  ).rows[0].n;
  check(after === 1, 'Duplicate dispense recorded during recovery');
  check(
    await page.evaluate(
      () => !Object.keys(localStorage).some((k) => k.startsWith('jalicare:pharmacy:pending:')),
    ),
    'Pending identity was not cleared after recorded result',
  );
  console.log('Real-browser reload and recorded-result recovery without duplicate: PASS');
  phase = 'registration';
  await clickText('Patient Management', 'aside button');
  await waitText('Patient Identification & Registration');
  await clickText('New Patient Registration');
  await page.type('input[placeholder="e.g. Juma"]', 'Synthetic');
  await page.type(
    'input[placeholder="e.g. Otieno"]',
    `BrowserRegister${suffix.replaceAll('-', '')}`,
  );
  const dob = await page.$('input[placeholder="YYYY-MM-DD"]');
  check(dob, 'Date of birth input not found');
  await dob.type('1985-03-14');
  await page.select('main form select', 'Other');
  await clickText('Complete Registration & Route to Triage');
  await waitText('registered (MRN:');
  const registered = (
    await pool.query(
      'SELECT id FROM patients WHERE tenant_id=$1 AND first_name=$2 AND last_name=$3',
      [tenant, 'Synthetic', `BrowserRegister${suffix.replaceAll('-', '')}`],
    )
  ).rows;
  check(registered.length === 1, 'Synthetic registration was not persisted exactly once');
  const queued = (
    await pool.query(
      "SELECT count(*)::int n FROM queues WHERE patient_id=$1 AND facility_id=$2 AND queue_type='Triage'",
      [registered[0].id, facility],
    )
  ).rows[0].n;
  check(queued === 1, 'Synthetic triage route was not persisted exactly once');
  console.log('Patient registration, DOB and triage persistence: PASS');

  phase = 'laboratory';
  await clickText('Laboratory & Pathology', 'aside button');
  await waitText('Clinical Pathology & Diagnostic Laboratory');
  await waitText('Synthetic browser lab');
  await clickText('Record Collection & Assign Accession');
  await page.waitForFunction(() => document.body.innerText.includes('Status: Sample Collected'), {
    timeout: 15000,
  });
  await page.waitForSelector('input[placeholder="e.g. Haemoglobin / Creatinine"]', {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === 'Save Result' && !button.disabled,
      ),
    { timeout: 20000 },
  );
  await page.type('input[placeholder="e.g. Haemoglobin / Creatinine"]', 'Synthetic analyte');
  await page.type('input[placeholder="e.g. 14.2"]', '42');
  await clickText('Save Result');
  await waitText('Synthetic analyte');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).some(
        (x) => x.textContent.trim() === 'Verify Result',
      ),
    { timeout: 20000 },
  );
  await clickText('Verify Result');
  await page.waitForFunction(() => document.body.innerText.includes('Verified'), {
    timeout: 15000,
  });
  const lab = (
    await pool.query(
      "SELECT o.status,o.sample_accession_number,(SELECT count(*)::int FROM lab_results r WHERE r.order_id=o.id AND r.parameter_name='Synthetic analyte' AND r.status='Verified') AS verified FROM lab_orders o WHERE o.id=$1",
      [labOrder],
    )
  ).rows[0];
  check(
    lab.status === 'Sample Collected' &&
      lab.sample_accession_number?.startsWith('JC-') &&
      lab.verified === 1,
    'Laboratory collection/result was not persisted and verified',
  );
  console.log('Laboratory specimen collection, result entry and verification: PASS');

  phase = 'billing and lost refund response';
  await clickText('Billing & Invoicing', 'aside button');
  await waitText('Patient Billing, Cashier POS & Receipts');
  await waitText(`RCP-BROWSER-${suffix}`);
  await clickText('Record manual refund');
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((x) =>
      x.innerText.trim().startsWith('Amount (KES)'),
    );
    label.querySelector('input').focus();
  });
  await page.keyboard.type('25.00');
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(
      (x) => x.innerText.trim() === 'Reason',
    );
    label.querySelector('input').focus();
  });
  await page.keyboard.type('Synthetic manually performed refund');
  await page.evaluate(() =>
    document
      .querySelector('section[aria-label="Receipt and refund history"] input[type="checkbox"]')
      .click(),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(
        'section[aria-label="Receipt and refund history"] input[type="checkbox"]',
      )?.checked,
    { timeout: 5000 },
  );
  let refundDropped = false,
    refundStatus = null;
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/billing/refunds', requestStage: 'Response' }],
  });
  const dropRefund = async (e) => {
    refundStatus = e.responseStatusCode;
    refundDropped = true;
    await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' });
  };
  cdp.on('Fetch.requestPaused', dropRefund);
  console.log(
    'Refund form ready:',
    JSON.stringify(
      await page.evaluate(() => {
        const e = document.querySelector('section[aria-label="Receipt and refund history"]');
        return {
          inputs: [...e.querySelectorAll('input')].map((x) => ({
            type: x.type,
            length: x.value.length,
            checked: x.checked,
          })),
          button: [...e.querySelectorAll('button')].find(
            (x) => x.textContent.trim() === 'Record refund receipt',
          )?.disabled,
        };
      }),
    ),
  );
  await clickText('Record refund receipt');
  phase = 'refund pending';
  await waitText('Unconfirmed refund needs review');
  phase = 'refund failure notification';
  await page.waitForFunction(
    () => document.body.innerText.includes('Refund could not be confirmed'),
    { timeout: 18000 },
  );
  check(
    refundDropped && refundStatus === 201,
    `Refund response interruption failed (${refundStatus})`,
  );
  await cdp.send('Fetch.disable');
  cdp.off('Fetch.requestPaused', dropRefund);
  const refundPending = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('jalicare:refund:pending:'));
    if (!k) return null;
    const p = JSON.parse(localStorage.getItem(k));
    return { fields: Object.keys(p).sort(), invoiceId: p.invoiceId, paymentId: p.paymentId };
  });
  check(
    JSON.stringify(refundPending?.fields) === '["invoiceId","key","paymentId"]' &&
      refundPending.invoiceId === invoice &&
      refundPending.paymentId === payment,
    'Refund retry identity incorrect',
  );
  let refundDb = (
    await pool.query(
      'SELECT (SELECT count(*)::int FROM billing_refunds WHERE payment_id=$2) AS refunds,paid_amount::text AS paid,balance_amount::text AS balance FROM billing_invoices WHERE id=$1',
      [invoice, payment],
    )
  ).rows[0];
  check(
    refundDb.refunds === 1 && refundDb.paid === '75.00' && refundDb.balance === '25.00',
    'Refund or net invoice totals incorrect',
  );
  phase = 'refund reload';
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Billing & Invoicing'),
    { timeout: 18000 },
  );
  phase = 'refund recovery page';
  await clickText('Billing & Invoicing', 'aside button');
  await waitText('Unconfirmed refund needs review');
  console.log('Refund pending displayed after reload');
  phase = 'refund recovery status';
  await clickText('Check recorded refund');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Unconfirmed refund needs review'),
    { timeout: 30000 },
  );
  refundDb = (
    await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE payment_id=$1', [
      payment,
    ])
  ).rows[0];
  check(refundDb.n === 1, 'Duplicate refund recorded');
  console.log('Manual refund lost-response recovery and net receipt balance: PASS');

  // Explicitly synthetic, facility-recorded invoice facts and tariffs; this is not
  // evidence that any real facility price, payer benefit or provider is approved.
  phase = 'synthetic finalized invoice fixture';
  await pool.query(
    "UPDATE facilities SET mfl_code=$1,address='Synthetic Road',county='Nyeri',phone='0000000000' WHERE id=$2",
    [`SYN-MFL-${suffix}`, facility],
  );
  const department = (
    await pool.query(
      "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic OPD',$2) RETURNING id",
      [facility, `SYN-OPD-${suffix}`],
    )
  ).rows[0].id;
  const practitioner = (
    await pool.query(
      "INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,'Synthetic Browser Clinician') RETURNING id",
      [tenant, facility],
    )
  ).rows[0].id;
  await pool.query('UPDATE encounters SET department_id=$1,practitioner_id=$2 WHERE id=$3', [
    department,
    practitioner,
    encounter,
  ]);
  await pool.query(
    "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description,diagnosis_type) VALUES($1,$2,'ICD-10','Z00.0','Synthetic browser diagnosis','Primary')",
    [encounter, patient],
  );
  const tariff = (
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee) VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','50.00') RETURNING id",
      [tenant, facility, `SYN-TEST-${suffix}`],
    )
  ).rows[0].id;
  const splitInvoice = (
    await pool.query(
      "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status,payer_type,payer_name,member_number) VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Pending','Insurance','Synthetic payer','SYN-MEMBER') RETURNING id",
      [tenant, facility, patient, encounter, `INV-SPLIT-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount) VALUES($1,$2,$3,'Consultation','Synthetic consultation',2,'50.00','100.00')",
    [splitInvoice, tariff, `SYN-TEST-${suffix}`],
  );
  await clickText('Inventory & Batches', 'aside button');
  await waitText('Hospital Inventory, Batches & Stores');
  await clickText('Billing & Invoicing', 'aside button');
  await waitText(`INV-SPLIT-${suffix}`);
  await page.evaluate(
    (number) =>
      [...document.querySelectorAll('main span')]
        .find((x) => x.textContent.trim() === number)
        ?.closest('div.cursor-pointer')
        ?.click(),
    `INV-SPLIT-${suffix}`,
  );
  await waitText('Allocation basis or evidence reference');
  await page.evaluate(() => {
    for (const [prefix, value] of [
      ['Insurer responsibility', '60.00'],
      ['Copayment within', '10.00'],
      ['Allocation basis', 'Synthetic documented estimate'],
    ]) {
      const input = [...document.querySelectorAll('label')]
        .find((x) => x.innerText.trim().startsWith(prefix))
        ?.querySelector('input');
      if (!input) throw new Error('Missing finalization input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    [...document.querySelectorAll('label')]
      .find((x) => x.innerText.includes('I reviewed the recorded allocation'))
      ?.querySelector('input')
      ?.click();
  });
  await clickText('Finalize invoice');
  await waitText(`Invoice INV-SPLIT-${suffix}`);
  await waitText('Patient balance: KES 40.00');
  await waitText('Insurer balance: KES 60.00');
  const finalized = (
    await pool.query(
      'SELECT snapshot,patient_responsibility::text,insurer_responsibility::text FROM billing_invoice_finalizations WHERE invoice_id=$1',
      [splitInvoice],
    )
  ).rows[0];
  check(
    finalized?.snapshot.facility.registryCode === `SYN-MFL-${suffix}` &&
      finalized.patient_responsibility === '40.00' &&
      finalized.insurer_responsibility === '60.00',
    'Finalized invoice snapshot or split was not persisted',
  );
  await page.evaluate(() => {
    window.__syntheticPrintCount = 0;
    window.print = () => {
      window.__syntheticPrintCount++;
    };
  });
  await clickText('Print finalized invoice');
  await page.waitForFunction(() => window.__syntheticPrintCount === 1, { timeout: 15000 });
  const prints = (
    await pool.query(
      "SELECT count(*)::int n FROM patient_record_access_logs WHERE record_type='FinalizedInvoice' AND record_id=$1 AND action='PRINT'",
      [splitInvoice],
    )
  ).rows[0].n;
  check(prints === 1, 'Finalized invoice print was not audited');
  console.log('Finalized snapshot, facility identity, split and audited print: PASS');

  phase = 'split payment lost response';
  await clickText('Receive Payment');
  await clickText('Cash');
  await page.evaluate(() => {
    const amount = [...document.querySelectorAll('label')]
      .find((x) => x.innerText.includes('Amount Paid (KES)'))
      ?.parentElement.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(amount, '40.00');
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const payerSelect = await page.$('div.fixed label select');
  check(payerSelect, 'Payer selector not found');
  await payerSelect.select('PATIENT');
  let paymentDropped = false,
    paymentStatus = null;
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/billing/payments', requestStage: 'Response' }],
  });
  const dropPayment = async (e) => {
    paymentDropped = true;
    paymentStatus = e.responseStatusCode;
    await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' });
  };
  cdp.on('Fetch.requestPaused', dropPayment);
  await clickText('Confirm Payment & Issue Receipt');
  await waitText('Payment could not be confirmed');
  check(
    paymentDropped && paymentStatus === 201,
    `Receipt response interruption failed (${paymentStatus})`,
  );
  await cdp.send('Fetch.disable');
  cdp.off('Fetch.requestPaused', dropPayment);
  const pending = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((x) => x.startsWith('jalicare:payment:pending:'));
    if (!key) return null;
    const value = JSON.parse(localStorage.getItem(key));
    return { fields: Object.keys(value).sort(), invoiceId: value.invoiceId };
  });
  check(
    JSON.stringify(pending?.fields) === '["invoiceId","key"]' && pending.invoiceId === splitInvoice,
    'Receipt retry identity stored extra data or wrong invoice',
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Billing & Invoicing'),
    { timeout: 18000 },
  );
  await clickText('Billing & Invoicing', 'aside button');
  await waitText('Unconfirmed receipt request');
  await clickText('Check receipt status');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Unconfirmed receipt request'),
    { timeout: 30000 },
  );
  const receipt = (
    await pool.query(
      'SELECT p.id,p.amount::text,a.party FROM billing_payments p JOIN billing_payment_attributions a ON a.payment_id=p.id WHERE p.invoice_id=$1',
      [splitInvoice],
    )
  ).rows;
  check(
    receipt.length === 1 && receipt[0].amount === '40.00' && receipt[0].party === 'PATIENT',
    'Receipt was duplicated or misattributed',
  );
  console.log('Patient split payment and dropped-response recovery without duplicate: PASS');

  phase = 'navigation';
  await clickText('Inventory & Batches', 'aside button');
  await waitText('Hospital Inventory, Batches & Stores');
  console.log('Navigation: Inventory & Batches: PASS');
  phase = 'outpatient';
  await clickText('Outpatient Services', 'aside button');
  await waitText('OUTPATIENT TRIAGE & CLINICAL CONSULTATION DESK');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('main button')].some((x) =>
        x.textContent.includes('Synthetic Browser Patient'),
      ),
    { timeout: 20000 },
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('main button')]
      .find((x) => x.textContent.includes('Synthetic Browser Patient'))
      .click(),
  );
  await waitText('TRIAGE VITAL SIGNS');
  await waitText('Not recorded');
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(
      (x) => x.innerText.trim() === 'Pulse (bpm)',
    );
    label.parentElement.querySelector('input').focus();
  });
  await page.keyboard.type('72');
  await clickText('Save Triage Observations');
  await waitText('Recorded vital signs saved successfully');
  const observations = (
    await pool.query(
      'SELECT count(*)::int n FROM observations WHERE encounter_id=$1 AND patient_id=$2 AND pulse_rate=72',
      [encounter, patient],
    )
  ).rows[0].n;
  check(observations === 1, 'OPD observation was not persisted');
  console.log('Outpatient patient selection and measured observation persistence: PASS');
  phase = 'inpatient';
  await clickText('Inpatient Management', 'aside button');
  await waitText('Inpatient Care, Wards & Bed Board');
  await waitText('Synthetic browser ward');
  await clickText('Admit Patient to Ward');
  await waitText('Inpatient Admission Workflow');
  await page.select('div.fixed form select', String(registered[0].id));
  await page.type('input[placeholder="Enter the working diagnosis"]', 'Synthetic test diagnosis');
  await clickText('Confirm Admission');
  await waitText('Patient admitted successfully and bed marked Occupied');
  const admission = (
    await pool.query(
      "SELECT a.patient_id,b.status FROM admissions a JOIN beds b ON b.id=a.bed_id WHERE a.facility_id=$1 AND a.bed_id=$2 AND a.status='Admitted'",
      [facility, bed],
    )
  ).rows;
  check(
    admission.length === 1 &&
      admission[0].patient_id === registered[0].id &&
      admission[0].status === 'Occupied',
    'Synthetic admission/bed state not persisted',
  );
  console.log('Inpatient admission and occupied bed persistence: PASS');
  phase = 'reviewed billing journals';
  const postingDate = (await pool.query('SELECT current_date::text AS value')).rows[0].value;
  await pool.query(
    `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
    VALUES($1,$2,'BROWSER','Synthetic browser accounting period','2000-01-01','2099-12-31','OPEN')`,
    [tenant, facility],
  );
  const glAccounts = (
    await pool.query(
      `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
    VALUES($1,$2,'AR-PATIENT','Synthetic patient AR','ASSET','RECEIVABLE','DEBIT'),
      ($1,$2,'AR-INSURER','Synthetic insurer AR','ASSET','RECEIVABLE','DEBIT'),
      ($1,$2,'CASH','Synthetic settlement','ASSET','CASH','DEBIT'),
      ($1,$2,'REVENUE','Synthetic revenue','REVENUE','REVENUE','CREDIT') RETURNING id,account_code`,
      [tenant, facility],
    )
  ).rows;
  const account = (code) => glAccounts.find((row) => row.account_code === code).id;
  await clickText('Accounting & General Ledger', 'aside button');
  await waitText('Reviewed billing journal');
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="Revenue account"]')?.options.length > 1,
    { timeout: 15000 },
  );
  await page.type('input[aria-label="Billing source ID"]', String(splitInvoice));
  await page.evaluate((date) => {
    const input = document.querySelector('input[aria-label="Billing journal date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, date);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, postingDate);
  await page.type(
    'input[aria-label="Billing journal description"]',
    'Synthetic reviewed invoice recognition',
  );
  await page.select(
    'select[aria-label="Patient receivable (if applicable)"]',
    String(account('AR-PATIENT')),
  );
  await page.select(
    'select[aria-label="Insurer receivable (if applicable)"]',
    String(account('AR-INSURER')),
  );
  await page.select('select[aria-label="Revenue account"]', String(account('REVENUE')));
  let ledgerDropped = false,
    ledgerStatus = null;
  await cdp.send('Fetch.enable', {
    patterns: [
      {
        urlPattern: '*/api/accounting/billing-postings/BILLING_INVOICE/*',
        requestStage: 'Response',
      },
    ],
  });
  const dropLedger = async (event) => {
    ledgerDropped = true;
    ledgerStatus = event.responseStatusCode;
    await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
  };
  cdp.on('Fetch.requestPaused', dropLedger);
  await clickText('Post reviewed source');
  await waitText('Posting was not confirmed');
  check(
    ledgerDropped && ledgerStatus === 201,
    `Journal response interruption failed (${ledgerStatus})`,
  );
  await cdp.send('Fetch.disable');
  cdp.off('Fetch.requestPaused', dropLedger);
  const ledgerPending = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((x) =>
      x.startsWith('jalicare:billing-journal:pending:'),
    );
    if (!key) return null;
    const value = JSON.parse(localStorage.getItem(key));
    return {
      fields: Object.keys(value).sort(),
      sourceId: value.sourceId,
      sourceType: value.sourceType,
    };
  });
  check(
    JSON.stringify(ledgerPending?.fields) === '["key","sourceId","sourceType"]' &&
      ledgerPending.sourceId === splitInvoice,
    'Journal recovery identity contained unexpected data',
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Accounting & General Ledger'),
    { timeout: 18000 },
  );
  await clickText('Accounting & General Ledger', 'aside button');
  await waitText('Unconfirmed BILLING_INVOICE');
  await clickText('Check recorded journal');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Unconfirmed BILLING_INVOICE'),
    { timeout: 30000 },
  );
  const invoicePostings = (
    await pool.query(
      `SELECT p.journal_id,j.total_debit_cents::text AS debit,j.total_credit_cents::text AS credit
    FROM accounting_billing_postings p JOIN journal_entries j ON j.id=p.journal_id
    WHERE p.facility_id=$1 AND p.source_type='BILLING_INVOICE' AND p.source_id=$2`,
      [facility, splitInvoice],
    )
  ).rows;
  check(
    invoicePostings.length === 1 &&
      invoicePostings[0].debit === '10000' &&
      invoicePostings[0].credit === '10000',
    'Invoice journal was duplicated or unbalanced',
  );
  await page.select('select[aria-label="Billing source type"]', 'BILLING_PAYMENT');
  await page.evaluate(
    (id, date) => {
      for (const [label, value] of [
        ['Billing source ID', String(id)],
        ['Billing journal date', date],
        ['Billing journal description', 'Synthetic reviewed receipt'],
      ]) {
        const input = document.querySelector(`input[aria-label="${label}"]`);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    receipt[0].id,
    postingDate,
  );
  await page.select('select[aria-label="Settlement or clearing account"]', String(account('CASH')));
  await clickText('Post reviewed source');
  await waitText('Receivable KES 40.00');
  const receiptPostings = (
    await pool.query(
      `SELECT amount_cents::text,receivable_cents::text,liability_cents::text,party
    FROM accounting_billing_postings WHERE facility_id=$1 AND source_type='BILLING_PAYMENT' AND source_id=$2`,
      [facility, receipt[0].id],
    )
  ).rows;
  check(
    receiptPostings.length === 1 &&
      receiptPostings[0].party === 'PATIENT' &&
      receiptPostings[0].receivable_cents === '4000',
    'Receipt journal was not posted correctly',
  );
  console.log('Reviewed invoice/receipt journals and lost-response recovery: PASS');
  await waitText('Billing and ledger exception review');
  await clickText('Review first page');
  await waitText('Source-linked journal checks');
  await waitText('UNPOSTED');
  console.log('Accounting ledger exception review: PASS');
  phase = 'staff portal';
  await clickText('Patient Portal Management', 'aside button');
  await waitText('PATIENTS AT THIS FACILITY');
  await clickText('Accounts');
  await waitText('Search');
  console.log('Staff portal overview and accounts: PASS');
  await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {});
  phase = 'logout';
  await page.click('button[aria-haspopup="menu"]');
  await clickText('Sign out');
  await page.waitForSelector('input[placeholder="Username or Email"]');
  console.log('Browser sign-out: PASS');
  phase = 'patient portal';
  await page.goto(base + '/portal', { waitUntil: 'networkidle2' });
  await waitText('Sign in to your record');
  await page.type('input[autocomplete="username"]', portalIdentifier);
  await page.type('input[autocomplete="current-password"]', password);
  await clickText('Sign in');
  await waitText('Account active');
  await clickText('Records');
  await waitText('Visits and diagnoses');
  await waitText('Prescriptions');
  console.log('Separate patient portal login and records navigation: PASS');
  console.log(`Uncaught browser runtime errors: ${errors.length}`);
  console.log(
    `HTTP errors observed (count): ${bad.length}; ${JSON.stringify([...new Set(bad)].slice(0, 15))}`,
  );
  console.log(`Initial unauthenticated session probe sent authorization header: ${initial401Auth}`);
  check(initial401Auth === false, 'Initial session 401 was not confirmed unauthenticated');
  check(
    bad.every((row) => row === 'browser login: 401 /api/auth/session'),
    'Unexpected HTTP errors occurred during the smoke test',
  );
  check(errors.length === 0, 'Uncaught browser runtime error(s) occurred');
} catch (e) {
  console.error(`Browser smoke failed at ${phase}: ${e.message}`);
  console.error('Recent API status paths:', JSON.stringify(apiTail.slice(-25)));
  console.error(
    'Safe pending storage fields:',
    JSON.stringify(
      await page
        ?.evaluate(() =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith('jalicare:refund:pending:'))
            .map((k) => Object.keys(JSON.parse(localStorage.getItem(k))).sort()),
        )
        .catch(() => []),
    ),
  );
  if (page)
    console.error(
      'Visible headings:',
      JSON.stringify(
        await page
          .evaluate(() =>
            Array.from(document.querySelectorAll('h1,h2,h3,[role=alert]'))
              .map((x) => x.innerText)
              .slice(0, 12),
          )
          .catch(() => []),
      ),
    );
  console.error(
    'Safe page state:',
    JSON.stringify(
      await page
        .evaluate(() => ({
          main: document.querySelector('main')?.innerText.slice(0, 150),
          login: !!document.querySelector('input[placeholder="Username or Email"]'),
          alerts: [...document.querySelectorAll('[role=alert],[role=status]')].map((x) =>
            x.textContent.slice(0, 100),
          ),
        }))
        .catch(() => null),
    ),
  );
  console.error(
    'Safe modal state:',
    JSON.stringify(
      await page
        .evaluate(() => ({
          selects: Array.from(document.querySelectorAll('main select')).map((x) => ({
            value: x.value,
            options: [...x.options].map((o) => o.value),
          })),
          numbers: Array.from(document.querySelectorAll('main input[type=number]')).map((x) => ({
            value: x.value,
            min: x.min,
            max: x.max,
          })),
          buttons: Array.from(document.querySelectorAll('main button'))
            .filter((x) => x.textContent.includes('Authorize'))
            .map((x) => ({ text: x.textContent, disabled: x.disabled })),
        }))
        .catch(() => null),
    ),
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([
      once(server, 'exit').catch(() => {}),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await pool.end();
}
