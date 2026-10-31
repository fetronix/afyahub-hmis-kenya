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
const username = `facility_browser_${suffix}`;
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
      `Synthetic Browser Facility Billing ${suffix}`,
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
      [tenant, `SEL-${suffix}`, 'Synthetic Browser Facility', JSON.stringify(modules)],
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

  const typeLabel = async (labelText, value, replace = false) => {
    const handle = await page.evaluateHandle((text) => {
      const label = [...document.querySelectorAll('label')].find(
        (node) => node.textContent.trim().startsWith(text) && node.querySelector('input'),
      );
      return label?.querySelector('input') ?? null;
    }, labelText);
    const input = handle.asElement();
    check(input, `Input not found: ${labelText}`);
    if (replace) {
      await input.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await input.press('Backspace');
    }
    await input.type(value);
    await handle.dispose();
  };
  const clickTariffRow = async (code, action) => {
    const clicked = await page.evaluate(
      (key, name) => {
        const section = [...document.querySelectorAll('h3')].find(
          (el) => el.textContent.trim() === 'Tariffs',
        )?.parentElement;
        const row = [...(section?.querySelectorAll('b') ?? [])].find(
          (el) => el.textContent.trim() === key,
        )?.parentElement?.parentElement;
        const button = [...(row?.querySelectorAll('button') ?? [])].find(
          (el) => el.textContent.trim() === name && !el.disabled,
        );
        if (!button) return false;
        button.click();
        return true;
      },
      code,
      action,
    );
    check(clicked, `Tariff ${action} control unavailable`);
  };
  const makeService = async (code, name, department, category, unit, price) =>
    api('POST', '/api/facility-services', {
      facilityId: facility,
      code,
      name,
      description: name,
      department,
      category,
      unit,
      initialPrice: price,
      isActive: true,
      autoBill: true,
    });

  phase = 'facility service admin';
  await click('System Configuration', 'aside button');
  await click('Facility Services & Tariffs');
  await waitText('No facility services have been created.');
  await click('Add service');
  await typeLabel('Service name', 'Synthetic browser consultation');
  await typeLabel('Service code', 'BROWSER-CONS');
  await typeLabel('Description', 'Synthetic browser consultation');
  await typeLabel('Initial price (KES)', '100.00');
  let pending = responseFor('POST', '/api/facility-services');
  await click('Save service');
  const serviceResponse = await pending;
  check(serviceResponse.status() === 201, 'Service UI did not persist');
  const consultation = await serviceResponse.json();
  await waitText('Synthetic browser consultation');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading facility services and tariffs…'),
  );
  await clickTariffRow('BROWSER-CONS', 'Edit');
  await typeLabel('Price (KES)', '150.00', true);
  pending = responseFor('PUT', `/api/facility-tariffs/${consultation.tariff.id}`);
  await click('Save tariff');
  const tariffEditResponse = await pending;
  check(
    tariffEditResponse.status() === 200,
    `Tariff edit failed ${tariffEditResponse.status()}: ${JSON.stringify(await tariffEditResponse.json())}`,
  );
  await waitText('KES 150.00');
  const tariffDb = (
    await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [
      consultation.tariff.id,
    ])
  ).rows[0];
  check(tariffDb.fee === '150.00', 'Tariff UI value differs from persisted value');
  console.log(
    'Browser created service and edited its facility tariff, with PostgreSQL verification: PASS',
  );

  const labA = await makeService(
    'BROWSER-COUNT-FAC',
    'Synthetic browser count',
    'laboratory',
    'LABORATORY',
    'Test',
    '80.00',
  );
  const labB = await makeService(
    'BROWSER-URINE-FAC',
    'Synthetic browser urine',
    'laboratory',
    'LABORATORY',
    'Test',
    '45.00',
  );
  const imaging = await makeService(
    'BROWSER-IMAGE',
    'Synthetic browser examination',
    'radiology',
    'RADIOLOGY',
    'Examination',
    '300.00',
  );

  phase = 'outpatient start, triage and lab orders';
  await click('Outpatient Services', 'aside button');
  await waitText('Synthetic Selection Browser');
  await selectPatient();
  await waitText('Start outpatient visit');
  pending = responseFor('POST', '/api/encounters');
  await click('Start outpatient visit');
  const visitResponse = await pending;
  check(visitResponse.status() === 201, 'Outpatient visit failed');
  const visit = await visitResponse.json();
  check(
    visit.patientId === patient &&
      visit.facilityId === facility &&
      visit.consultationFacilityServiceId === consultation.service.id,
    'Consultation or encounter scope not persisted',
  );
  await waitText('TRIAGE VITAL SIGNS');
  const triageInput = await page.evaluateHandle(() => {
    const label = [...document.querySelectorAll('label')].find(
      (node) => node.textContent.trim() === 'Pulse (bpm)',
    );
    return label?.parentElement?.querySelector('input') ?? null;
  });
  check(triageInput.asElement(), 'Triage pulse input unavailable');
  await triageInput.asElement().type('72');
  pending = responseFor('POST', '/api/observations');
  await click('Save Triage Observations');
  check((await pending).status() === 201, 'Triage observation was not recorded');
  check(
    (
      await pool.query(
        'SELECT count(*)::int n FROM observations WHERE encounter_id=$1 AND pulse_rate=72',
        [visit.id],
      )
    ).rows[0].n === 1,
    'Triage observation not persisted',
  );
  await chooseLabelInput('Synthetic browser count', 'checkbox');
  await chooseLabelInput('Synthetic browser urine', 'checkbox');
  await page.type('input[aria-label="Specimen for Synthetic browser count"]', 'Synthetic blood');
  await page.type('input[aria-label="Specimen for Synthetic browser urine"]', 'Synthetic urine');
  await page.type(
    'textarea[aria-label="Laboratory investigations, one per line"]',
    'Synthetic unlisted',
  );
  await page.type('input[aria-label="Specimen for Synthetic unlisted"]', 'Synthetic swab');
  await page.type(
    'textarea[placeholder="Why are these investigations required?"]',
    'Synthetic browser reason',
  );
  pending = responseFor('POST', '/api/lab-orders/batch');
  await click('Submit Orders to Laboratory');
  const labResponse = await pending;
  check(labResponse.status() === 201, 'Laboratory batch failed');
  const batch = await labResponse.json();
  check(
    batch.orders.length === 3 &&
      new Set(batch.orders.map((order) => order.specimenType)).size === 3,
    'Individual specimens not persisted',
  );
  check(
    batch.orders.find((order) => order.testName === 'Synthetic unlisted')?.clinicalException,
    'Free text was not kept as a clinical exception',
  );
  check(
    (
      await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
        visit.id,
      ])
    ).rows[0].n === 0,
    'Uncompleted orders produced a charge',
  );
  console.log(
    'Browser started OPD, saved triage, and submitted mixed lab batch with separate specimens and no order-time bill: PASS',
  );

  phase = 'radiology request';
  await click('Radiology & Imaging', 'aside button');
  await click('New Imaging Request');
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('#radiology-patient').options].some(
        (option) => option.value === String(id),
      ),
    { timeout: 20000 },
    patient,
  );
  await page.select('#radiology-patient', String(patient));
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('#radiology-encounter').options].some(
        (option) => option.value === String(id),
      ),
    { timeout: 20000 },
    visit.id,
  );
  await page.select('#radiology-encounter', String(visit.id));
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('#radiology-facility-exam').options].some(
        (option) => option.value === String(id) && option.textContent.includes('300.00'),
      ),
    { timeout: 20000 },
    imaging.service.id,
  );
  await page.select('#radiology-facility-exam', String(imaging.service.id));
  await page.type('#radiology-indication', 'Synthetic browser reason');
  pending = responseFor('POST', '/api/radiology-orders');
  await click('Send Imaging Request');
  const imageResponse = await pending;
  check(imageResponse.status() === 201, 'Imaging request failed');
  const image = await imageResponse.json();
  check(
    image.encounterId === visit.id && image.facilityServiceId === imaging.service.id,
    'Imaging source selection not persisted',
  );
  check(
    (
      await pool.query('SELECT count(*)::int n FROM billing_invoices WHERE encounter_id=$1', [
        visit.id,
      ])
    ).rows[0].n === 0,
    'Unreported imaging generated a charge',
  );
  console.log(
    'Browser selected facility imaging with encounter and price; request remained unbilled: PASS',
  );
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

  phase = 'imaging report and encounter completion';
  await click('Radiology & Imaging', 'aside button');
  await waitText('Synthetic browser examination');
  await page.waitForSelector('#radiology-findings');
  await page.type('#radiology-findings', 'Synthetic findings');
  await page.type('#radiology-impression', 'Synthetic impression');
  pending = responseFor('PUT', `/api/radiology-orders/${image.id}/report`);
  await click('Save Imaging Report');
  const report = await pending;
  check(
    report.status() === 200 && (await report.json()).billing.charged,
    'Imaging report did not bill',
  );
  const replayLab = await api('POST', `/api/lab-orders/${batch.orders[0].id}/complete`, {});
  const replayImage = await api('PUT', `/api/radiology-orders/${image.id}/report`, {
    findings: 'Synthetic findings',
    impression: 'Synthetic impression',
    reportedBy: 'Synthetic Selection Clinician',
  });
  check(
    replayLab.billing.reason === 'DUPLICATE' && replayImage.billing.reason === 'DUPLICATE',
    'Completion retry duplicated a charge',
  );
  await click('Outpatient Services', 'aside button');
  await waitText('Synthetic Selection Browser');
  await selectPatient();
  await waitText('Encounter billing and receipts');
  await click('Encounter billing and receipts', 'summary');
  await waitText('Item subtotal');
  page.once('dialog', (dialog) => dialog.accept());
  pending = responseFor('PUT', `/api/encounters/${visit.id}`);
  await click('Complete visit');
  const done = await pending;
  check(
    done.status() === 200 && (await done.json()).billing.charged,
    'Consultation completion did not bill',
  );
  const invoices = (
    await pool.query(
      'SELECT id,total_amount::text,balance_amount::text FROM billing_invoices WHERE encounter_id=$1',
      [visit.id],
    )
  ).rows;
  check(
    invoices.length === 1 &&
      invoices[0].total_amount === '575.00' &&
      invoices[0].balance_amount === '575.00',
    'Combined invoice total incorrect',
  );
  const lines = (
    await pool.query('SELECT source_type FROM billing_items WHERE invoice_id=$1', [invoices[0].id])
  ).rows;
  check(
    lines
      .map((line) => line.source_type)
      .sort()
      .join(',') === 'CONSULTATION,LAB_ORDER,LAB_ORDER,RADIOLOGY',
    'Invoice sources were missing or duplicated',
  );
  check(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join(',')}`);
  console.log(
    'Browser completed lab, imaging and consultation: one unpaid KES 575 invoice with four lines; retries protected: PASS',
  );
} catch (error) {
  console.error(`Synthetic facility billing browser failed during ${phase}: ${error.message}`);
  if (page && phase !== 'login') {
    console.error('Browser error names:', runtimeErrors.join(','));
    console.error(
      'Synthetic UI state:',
      (await page.evaluate(() => document.body.innerText)).slice(0, 2500),
    );
  }
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
