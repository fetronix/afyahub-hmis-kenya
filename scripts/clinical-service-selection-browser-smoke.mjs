import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// This journey writes only fresh synthetic rows. It never migrates, drops,
// resets, imports real data, or prints credentials or clinical response bodies.
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
)
  throw new Error(
    'A dedicated loopback synthetic test database and Chromium executable are required.',
  );
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(32).toString('base64url');
const username = `selection_browser_${suffix}`;
const port = Number(process.env.SELECTION_BROWSER_PORT ?? 4194);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid browser test port');
const base = `http://127.0.0.1:${port}`;
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT ?? 5432),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
});
const check = (value, message) => {
  if (!value) throw new Error(message);
};
let server,
  browser,
  page,
  phase = 'fixture';
const runtimeErrors = [];
try {
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      `Synthetic Browser Selection ${suffix}`,
      `browser-selection-${suffix}`,
    ])
  ).rows[0].id;
  const modules = [
    'registration',
    'reception',
    'opd',
    'laboratory',
    'radiology',
    'pharmacy',
    'finance',
  ];
  const facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
      [tenant, `SEL-${suffix}`, 'Synthetic Selection Facility', JSON.stringify(modules)],
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
      "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Selection Clinician',$3,'ACTIVE',$4,$5) RETURNING id",
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
    'patients.read',
    'appointments.read',
    'appointments.create',
    'pharmacy.read',
    'clinical.read',
    'clinical.create',
    'clinical.update',
    'laboratory.read',
    'laboratory.orders.create',
    'laboratory.results.enter',
    'laboratory.results.verify',
    'billing.read',
    'billing.update',
    'tariffs.read',
    'tariffs.manage',
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
  const patient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Selection Browser','2000-01-01','Other') RETURNING id",
      [tenant, facility, `SEL-${suffix}`],
    )
  ).rows[0].id;
  const tests = (
    await pool.query(
      "INSERT INTO lab_tests(facility_id,code,name,specimen_type) VALUES($1,'BROWSER-COUNT','Synthetic browser count','Whole Blood'),($1,'BROWSER-URINE','Synthetic browser urine','Whole Blood') RETURNING id",
      [facility],
    )
  ).rows.map((row) => row.id);
  phase = 'server';
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env: {
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
    },
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
      reject(new Error(`Server exited ${code}`));
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
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    ),
  });
  page = await browser.newPage();
  page.on('pageerror', (error) => runtimeErrors.push(error.name));
  await page.setViewport({ width: 1440, height: 900 });
  phase = 'login';
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Outpatient Services'),
    { timeout: 25000 },
  );
  const click = async (text, selector = 'button') => {
    await page.waitForFunction(
      (label, sel) => {
        const el = [...document.querySelectorAll(sel)].find(
          (item) => item.textContent.trim() === label && !item.disabled,
        );
        if (!el) return false;
        el.click();
        return true;
      },
      { timeout: 20000 },
      text,
      selector,
    );
  };
  const waitText = (text) =>
    page.waitForFunction(
      (value) => document.body.innerText.includes(value),
      { timeout: 20000 },
      text,
    );
  const api = async (method, path, body) => {
    const result = await page.evaluate(
      async (m, p, data) => {
        const token = localStorage.getItem('jalicare_session_token');
        const response = await fetch(p, {
          method: m,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return { status: response.status, body: await response.json() };
      },
      method,
      path,
      body,
    );
    check(
      result.status >= 200 && result.status < 300,
      `Synthetic configuration request failed: ${method} ${path.split('?')[0]} (${result.status})`,
    );
    return result.body;
  };
  const selectPatient = async () => {
    const found = await page.evaluate(() => {
      const button = [...document.querySelectorAll('main button')].find((item) =>
        item.textContent.includes('Synthetic Selection Browser'),
      );
      if (!button) return false;
      button.click();
      return true;
    });
    check(found, 'Synthetic patient button unavailable');
  };
  const responseFor = (method, path) => {
    const response = page.waitForResponse(
      (item) => item.request().method() === method && new URL(item.url()).pathname === path,
      { timeout: 20000 },
    );
    // If an earlier UI step fails, closing Chromium must not create an
    // unhandled rejection that interrupts the server cleanup in finally.
    void response.catch(() => {});
    return response;
  };
  const chooseLabelInput = async (text, type) => {
    const found = await page.evaluate(
      (name, kind) => {
        const label = [...document.querySelectorAll('label')].find(
          (entry) => entry.innerText.includes(name) && entry.querySelector(`input[type="${kind}"]`),
        );
        const input = label?.querySelector(`input[type="${kind}"]`);
        if (!input || input.disabled) return false;
        input.click();
        return true;
      },
      text,
      type,
    );
    check(found, `Synthetic ${type} selection unavailable`);
  };

  phase = 'synthetic configuration';
  await api('POST', '/api/master-tariffs/sync', { facilityId: facility });
  const imaging = await api('POST', '/api/master-tariffs/imaging-services', {
    facilityId: facility,
    description: 'Synthetic browser examination',
  });
  const sourceRows = (
    await pool.query(
      "SELECT source_id,master_service_id FROM master_service_sources WHERE facility_id=$1 AND source_type='LAB_TEST' AND is_active",
      [facility],
    )
  ).rows;
  const catalogue = await api('GET', `/api/master-tariffs?facilityId=${facility}`);
  const followUp = catalogue.find((row) => row.master.code === 'JC-OPD-FOLLOWUP').master.id;
  const labMasters = tests.map(
    (test) => sourceRows.find((row) => row.source_id === test)?.master_service_id,
  );
  check(labMasters.every(Boolean), 'Synthetic test mappings unavailable');
  const prices = [
    [followUp, '150.00'],
    [labMasters[0], '80.00'],
    [labMasters[1], '45.00'],
    [imaging.master.id, '300.00'],
  ];
  const edits = prices.map(([id, fee]) => {
    const row = catalogue.find((entry) => entry.master.id === id) ?? imaging;
    check(row?.tariff, 'Synthetic tariff not available');
    return {
      tariffId: row.tariff.id,
      revision: row.tariff.revision,
      fee,
      unit: row.master.unit,
      isActive: true,
      autoBill: true,
      effectiveFrom: null,
      effectiveTo: null,
    };
  });
  const edited = await api('PUT', '/api/master-tariffs/batch', {
    facilityId: facility,
    rows: edits,
  });
  for (const tariff of edited)
    await api('POST', `/api/master-tariffs/${tariff.id}/approve`, {
      facilityId: facility,
      revision: tariff.revision,
      approvalReference: 'Synthetic browser price review',
    });
  const blood = await api('POST', '/api/master-lab-specimens', {
    facilityId: facility,
    testId: tests[0],
    specimenType: 'Synthetic blood',
    reviewReference: 'Synthetic browser clinical review',
  });
  const urine = await api('POST', '/api/master-lab-specimens', {
    facilityId: facility,
    testId: tests[1],
    specimenType: 'Synthetic urine',
    reviewReference: 'Synthetic browser clinical review',
  });
  console.log(
    'Synthetic facility catalogue, distinct reviewed specimen options and approvals: PASS',
  );

  phase = 'OPD consultation and laboratory selection';
  await click('Outpatient Services', 'aside button');
  await waitText('Synthetic Selection Browser');
  await selectPatient();
  await page.waitForSelector('#opd-consultation');
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('#opd-consultation').options].some(
        (option) => option.value === String(id) && option.textContent.includes('150.00'),
      ),
    { timeout: 20000 },
    followUp,
  );
  await page.select('#opd-consultation', String(followUp));
  let pending = responseFor('POST', '/api/encounters');
  await click('Start outpatient visit');
  const visitResponse = await pending;
  check(visitResponse.status() === 201, 'Synthetic visit was not created');
  const visit = await visitResponse.json();
  check(
    visit.patientId === patient &&
      visit.facilityId === facility &&
      visit.consultationMasterServiceId === followUp,
    'Consultation selection or patient/facility scope not persisted',
  );
  await page.waitForSelector('#lab-catalogue-search', { timeout: 20000 });
  await chooseLabelInput('Synthetic browser count', 'checkbox');
  await chooseLabelInput('Synthetic browser urine', 'checkbox');
  await page.select('select[aria-label="Specimen for Synthetic browser count"]', String(blood.id));
  await page.select('select[aria-label="Specimen for Synthetic browser urine"]', String(urine.id));
  await waitText('Indicative total KES 125.00');
  await page.type(
    'textarea[placeholder="Why are these investigations required?"]',
    'Synthetic browser investigation reason',
  );
  pending = responseFor('POST', '/api/lab-orders/batch');
  await click('Submit Orders to Laboratory');
  const labResponse = await pending;
  check(labResponse.status() === 201, 'Synthetic laboratory selection failed');
  const batch = await labResponse.json();
  check(
    batch.orders.length === 2 &&
      new Set(batch.orders.map((order) => order.specimenType)).size === 2,
    'Distinct specimens not persisted',
  );
  check(
    (
      await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
        visit.id,
      ])
    ).rows[0].n === 0,
    'Uncompleted lab orders created a charge',
  );
  console.log(
    'Browser selected consultation, two investigations and individual specimens; no order-time billing: PASS',
  );

  phase = 'OPD Add Service imaging';
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('summary')].some(
        (entry) => entry.textContent.trim() === 'Add Service — clinical orders',
      ),
    { timeout: 20000 },
  );
  await click('Add Service — clinical orders', 'summary');
  await page.select('select[aria-label="Add service department"]', 'RADIOLOGY');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('label')].some(
        (label) =>
          label.innerText.includes('Synthetic browser examination') &&
          label.querySelector('input[type=radio]'),
      ),
    { timeout: 20000 },
  );
  await chooseLabelInput('Synthetic browser examination', 'radio');
  await page.select('select[aria-label="Add service imaging modality"]', 'Ultrasound');
  await page.type(
    'input[aria-label="Add service clinical indication"]',
    'Synthetic browser imaging reason',
  );
  await waitText('Indicative total KES 300.00');
  pending = responseFor('POST', '/api/radiology-orders');
  await click('Create clinical order');
  const imageResponse = await pending;
  check(imageResponse.status() === 201, 'Synthetic imaging order failed');
  const image = await imageResponse.json();
  check(
    image.encounterId === visit.id && image.masterServiceId === imaging.master.id,
    'Imaging encounter or examination not persisted',
  );
  check(
    (
      await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
        visit.id,
      ])
    ).rows[0].n === 0,
    'Unreported imaging created a charge',
  );
  console.log('Browser Add Service created a linked specific imaging order without a charge: PASS');

  phase = 'laboratory execution';
  await click('Laboratory & Pathology', 'aside button');
  await waitText('Clinical Pathology & Diagnostic Laboratory');
  for (const name of ['Synthetic browser count', 'Synthetic browser urine']) {
    await page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('span')].some((span) => span.textContent.trim() === text),
      { timeout: 20000 },
      name,
    );
    const selected = await page.evaluate((text) => {
      const title = [...document.querySelectorAll('span')].find(
        (span) => span.textContent.trim() === text,
      );
      const row = title?.closest('div.p-3.rounded-lg.border');
      if (!row) return false;
      row.click();
      return true;
    }, name);
    check(selected, 'Synthetic laboratory order not selectable');
    const order = batch.orders.find((item) => item.testName === name);
    pending = responseFor('PUT', `/api/lab-orders/${order.id}/status`);
    const collected = await page.evaluate((text) => {
      const title = [...document.querySelectorAll('span')].find(
        (span) => span.textContent.trim() === text,
      );
      const button = title?.closest('div.p-3.rounded-lg.border')?.querySelector('button');
      if (!button) return false;
      button.click();
      return true;
    }, name);
    check(collected && (await pending).status() === 200, 'Synthetic specimen collection failed');
    await waitText('Status: Sample Collected');
    await page.waitForSelector('input[placeholder="e.g. Haemoglobin / Creatinine"]');
    await page.type('input[placeholder="e.g. Haemoglobin / Creatinine"]', 'Synthetic analyte');
    await page.type('input[placeholder="e.g. 14.2"]', '1');
    pending = responseFor('POST', '/api/lab-results');
    await click('Save Result');
    const resultResponse = await pending;
    check(resultResponse.status() === 201, 'Synthetic result entry failed');
    const result = await resultResponse.json();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent.trim() === 'Verify Result' && !button.disabled,
        ),
      { timeout: 20000 },
    );
    pending = responseFor('POST', `/api/lab-results/${result.id}/verify`);
    await click('Verify Result');
    check((await pending).status() === 200, 'Synthetic result verification failed');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) =>
            button.textContent.trim() === 'Confirm investigation complete' && !button.disabled,
        ),
      { timeout: 20000 },
    );
    page.once('dialog', (dialog) => dialog.accept());
    pending = responseFor('POST', `/api/lab-orders/${order.id}/complete`);
    await click('Confirm investigation complete');
    const complete = await pending;
    check(
      complete.status() === 200 && (await complete.json()).billing.charged,
      'Synthetic completed laboratory work did not bill',
    );
  }
  console.log(
    'Browser collected, entered, verified and explicitly completed both investigations: PASS',
  );

  phase = 'radiology report';
  await click('Radiology & Imaging', 'aside button');
  await waitText('Synthetic browser examination');
  await page.waitForSelector('#radiology-findings');
  await page.type('#radiology-findings', 'Synthetic browser findings');
  await page.type('#radiology-impression', 'Synthetic browser impression');
  pending = responseFor('PUT', `/api/radiology-orders/${image.id}/report`);
  await click('Save Imaging Report');
  const report = await pending;
  check(
    report.status() === 200 && (await report.json()).billing.charged,
    'Synthetic reported imaging did not bill',
  );
  const replayLab = await api('POST', `/api/lab-orders/${batch.orders[0].id}/complete`, {});
  const replayImage = await api('PUT', `/api/radiology-orders/${image.id}/report`, {
    findings: 'Synthetic browser findings',
    impression: 'Synthetic browser impression',
    reportedBy: 'Synthetic Selection Clinician',
  });
  check(
    replayLab.billing.reason === 'DUPLICATE' && replayImage.billing.reason === 'DUPLICATE',
    'Completed-service replays were not protected',
  );
  console.log(
    'Browser saved a linked imaging report; completed lab and imaging replay protection: PASS',
  );

  phase = 'encounter billing and consultation completion';
  await click('Outpatient Services', 'aside button');
  await waitText('Synthetic Selection Browser');
  await selectPatient();
  await waitText('Encounter billing and receipts');
  await click('Encounter billing and receipts', 'summary');
  await waitText('Item subtotal');
  check(
    await page.evaluate(
      () =>
        document.body.innerText.includes('425.00') &&
        document.body.innerText.includes('Item adjustments/reversals'),
    ),
    'Encounter billing summary missing recorded subtotal or limitation',
  );
  page.once('dialog', (dialog) => dialog.accept());
  pending = responseFor('PUT', `/api/encounters/${visit.id}`);
  await click('Complete visit');
  const completedVisit = await pending;
  check(
    completedVisit.status() === 200 && (await completedVisit.json()).billing.charged,
    'Selected consultation did not bill',
  );
  const invoiceRows = (
    await pool.query(
      'SELECT id,total_amount::text,balance_amount::text,paid_amount::text FROM billing_invoices WHERE encounter_id=$1',
      [visit.id],
    )
  ).rows;
  check(
    invoiceRows.length === 1 &&
      invoiceRows[0].total_amount === '575.00' &&
      invoiceRows[0].balance_amount === '575.00' &&
      invoiceRows[0].paid_amount === '0.00',
    'Combined encounter totals are incorrect',
  );
  const lines = (
    await pool.query('SELECT source_type,unit_price::text FROM billing_items WHERE invoice_id=$1', [
      invoiceRows[0].id,
    ])
  ).rows;
  check(
    lines.length === 4 &&
      lines
        .map((line) => line.source_type)
        .sort()
        .join(',') === 'CONSULTATION,LAB_ORDER,LAB_ORDER,RADIOLOGY',
    'Combined source lines are incorrect or duplicated',
  );
  console.log(
    'Browser encounter billing and completion: one unpaid KES 575.00 invoice, four source lines: PASS',
  );

  phase = 'cashier view and Add Service';
  await click('Billing & Invoicing', 'aside button');
  await waitText('Patient Billing, Cashier POS & Receipts');
  await waitText('Synthetic browser count');
  await waitText('Synthetic browser urine');
  await waitText('Synthetic browser examination');
  await waitText('575.00');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('summary')].some(
        (entry) => entry.textContent.trim() === 'Add Service — clinical orders',
      ),
    { timeout: 20000 },
  );
  await click('Add Service — clinical orders', 'summary');
  await page.select('select[aria-label="Add service department"]', 'RADIOLOGY');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('label')].some(
        (label) =>
          label.innerText.includes('Synthetic browser examination') &&
          label.querySelector('input[type=radio]'),
      ),
    { timeout: 20000 },
  );
  await chooseLabelInput('Synthetic browser examination', 'radio');
  await page.select('select[aria-label="Add service imaging modality"]', 'Ultrasound');
  await page.type(
    'input[aria-label="Add service clinical indication"]',
    'Synthetic additional cashier order',
  );
  pending = responseFor('POST', '/api/radiology-orders');
  await click('Create clinical order');
  const cashierOrder = await pending;
  check(cashierOrder.status() === 201, 'Cashier clinical Add Service failed');
  check(
    (await cashierOrder.json()).encounterId === visit.id,
    'Cashier order is not encounter linked',
  );
  const after = (
    await pool.query('SELECT total_amount::text FROM billing_invoices WHERE id=$1', [
      invoiceRows[0].id,
    ])
  ).rows[0];
  check(after.total_amount === '575.00', 'Unreported cashier order changed the invoice');
  check(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join(',')}`);
  console.log(
    'Cashier itemization and encounter-linked Add Service; unreported order left invoice unchanged: PASS',
  );
} catch (error) {
  console.error(`Synthetic selection browser failed during ${phase}: ${error.message}`);
  throw error;
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
