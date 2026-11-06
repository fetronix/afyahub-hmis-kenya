import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import pg from 'pg';
import puppeteer from 'puppeteer-core';

// Additive synthetic fixtures only. No reset, migrations, actual provider call or real patients.
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
  throw new Error('Use BROWSER_SMOKE_SYNTHETIC=YES and a loopback synthetic test database.');
const proxyPort = Number(process.env.MPESA_BROWSER_PORT ?? '4337');
const backendPort = proxyPort + 1;
if (!Number.isInteger(proxyPort) || proxyPort < 1024 || backendPort > 65535)
  throw new Error('Invalid browser port.');
const origin = `https://127.0.0.1:${proxyPort}`;
const suffix = randomUUID().slice(0, 8);
const username = `synthetic_mpesa_${suffix}`;
const password = randomBytes(32).toString('base64url');
const credentials = {
  consumerKey: `synthetic-key-${suffix}`,
  consumerSecret: `synthetic-secret-${suffix}`,
  passkey: `synthetic-passkey-${suffix}`,
  shortcode: '654321',
  transactionType: 'CustomerPayBillOnline',
};
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
let tempDir, proxy, server, browser;
try {
  const identity = await pool.query('SELECT current_database() AS db, current_user AS db_user');
  check(
    identity.rows[0].db === database && identity.rows[0].db_user === process.env.SQL_ADMIN_USER,
    'Synthetic database identity mismatch.',
  );
  const provider = await pool.query(
    `SELECT p.id FROM payment_provider_definitions p JOIN payment_provider_environments e ON e.provider_id=p.id AND e.environment='SANDBOX' AND e.is_available WHERE p.code='MPESA_DARAJA' AND p.status='ACTIVE'`,
  );
  check(provider.rowCount === 1, 'Synthetic sandbox provider definition is unavailable.');
  const policies = await pool.query(
    `SELECT capability FROM payment_provider_capability_policies WHERE provider_id=$1 AND is_allowed`,
    [provider.rows[0].id],
  );
  check(
    ['HEALTH', 'PAYMENT_COLLECTION', 'PAYMENT_STATUS'].every((c) =>
      policies.rows.some((r) => r.capability === c),
    ),
    'Synthetic provider capabilities are unavailable.',
  );
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      `Synthetic M-Pesa Tenant ${suffix}`,
      `synthetic-mpesa-${suffix}`,
    ])
  ).rows[0].id;
  const facilities = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic M-Pesa Facility',$4::jsonb),($1,$3,'Synthetic M-Pesa Sibling',$4::jsonb) RETURNING id`,
      [
        tenant,
        `MP-A-${suffix}`,
        `MP-B-${suffix}`,
        JSON.stringify(['finance', 'configuration', 'registration']),
      ],
    )
  ).rows;
  const facility = facilities[0].id,
    sibling = facilities[1].id;
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const user = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Cashier',$3,'ACTIVE',$4,$5) RETURNING id`,
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      `INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id`,
      [tenant],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  for (const code of [
    'billing.read',
    'patients.read',
    'clinical.read',
    'payment_hub.catalogue.read',
    'payment_hub.facility.manage',
    'payment_hub.credentials.manage',
    'payment_hub.accounts.read',
    'payment_hub.transactions.read',
    'payment_hub.collection.initiate',
    'payment_hub.payments.verify',
  ]) {
    await pool.query(
      `INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING`,
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [role, code],
    );
  }
  await pool.query(
    `INSERT INTO payment_provider_assignments(provider_id,tenant_id,facility_id,is_allowed,updated_by_user_id) VALUES($1,$2,$3,true,$4)`,
    [provider.rows[0].id, tenant, facility, user],
  );
  const patient = (
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Browser','2000-01-01','Unknown') RETURNING id`,
      [tenant, facility, `MP-BROWSER-${suffix}`],
    )
  ).rows[0].id;
  const invoiceNumber = `SYN-MPESA-${suffix}`;
  const invoice = (
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Unpaid') RETURNING id`,
      [tenant, facility, patient, invoiceNumber],
    )
  ).rows[0].id;

  tempDir = await mkdtemp(path.join(os.tmpdir(), 'jalicare-mpesa-synthetic-tls-'));
  const keyFile = path.join(tempDir, 'key.pem'),
    certFile = path.join(tempDir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  server = spawn(
    'node',
    [
      '--import',
      path.join(root, 'scripts/synthetic-mpesa-browser-transport.mjs'),
      'build/server.js',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(backendPort),
        APP_BASE_URL: origin,
        TRUST_PROXY: 'true',
        SQL_SSL: 'false',
        LOG_LEVEL: 'silent',
        FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        PAYMENT_HUB_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        PAYMENT_HUB_ACTIVE_VAULT_KEY_ID: 'BROWSER01',
        PAYMENT_HUB_VAULT_KEY_BROWSER01: randomBytes(32).toString('base64'),
        PAYMENT_HUB_CALLBACK_BASE_URL: origin,
        MPESA_BROWSER_MOCK_RUN_ID: suffix,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('Synthetic backend startup timed out.')),
      25000,
    );
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => {
      output += chunk;
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Synthetic backend exited (${code}).`));
    });
  });
  proxy = https.createServer(
    { key: await readFile(keyFile), cert: await readFile(certFile) },
    (req, res) => {
      const headers = {
        ...req.headers,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': req.headers.host,
      };
      const upstream = http.request(
        { hostname: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(proxyPort, '127.0.0.1', resolve);
  });
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      ...(process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : []),
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
    ],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const failedResponses = [];
  let auth = '';
  page.on('pageerror', (error) => pageErrors.push(error.name));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(origin))
      failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/payment-hub/facility/') && request.headers().authorization)
      auth = request.headers().authorization;
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside button[title="System Configuration"]', { timeout: 30000 });
  const clickText = async (selector, text) => {
    const ok = await page.evaluate(
      (sel, value) => {
        const e = [...document.querySelectorAll(sel)].find(
          (item) => item.textContent.trim() === value,
        );
        if (!e || ('disabled' in e && e.disabled)) return false;
        e.click();
        return true;
      },
      selector,
      text,
    );
    check(ok, `Missing or disabled synthetic control: ${text}`);
  };
  const waitButton = (text) =>
    page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === value && !b.disabled,
        ),
      {},
      text,
    );
  const labelControl = async (label, selector = 'input') => {
    const handle = await page.evaluateHandle(
      (name, sel) =>
        [...document.querySelectorAll('label')]
          .find((item) => item.textContent.trim().startsWith(name))
          ?.querySelector(sel),
      label,
      selector,
    );
    check(Boolean(handle.asElement()), `Missing synthetic field: ${label}`);
    return handle.asElement();
  };
  await page.click('aside button[title="System Configuration"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (e) => e.textContent.trim() === 'Integration Hub',
    ),
  );
  await clickText('button', 'Integration Hub');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Facility Integration Hub"]')
        ?.textContent?.includes('Safaricom M-Pesa'),
    { timeout: 20000 },
  );
  await clickText('button', 'Mobile money');
  await clickText('summary', 'Configure an environment and capabilities');
  for (const capability of ['PAYMENT_COLLECTION', 'PAYMENT_STATUS', 'HEALTH']) {
    const ok = await page.evaluate((name) => {
      const e = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.trim() === name)
        ?.querySelector('input[type="checkbox"]');
      if (!e) return false;
      e.click();
      return true;
    }, capability);
    check(ok, `Missing synthetic capability ${capability}`);
  }
  await clickText('button', 'Save environment');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('summary')].some((s) =>
        s.textContent.includes('Add or replace Daraja sandbox credentials'),
      ),
    { timeout: 15000 },
  );
  await clickText('summary', 'Add or replace Daraja sandbox credentials');
  for (const [label, value] of [
    ['Consumer key', credentials.consumerKey],
    ['Consumer secret', credentials.consumerSecret],
    ['STK passkey', credentials.passkey],
    ['Sandbox shortcode', credentials.shortcode],
  ]) {
    const field = await labelControl(label);
    await field.type(value);
    await field.dispose();
  }
  const type = await labelControl('Authorized transaction type', 'select');
  await type.select(credentials.transactionType);
  await type.dispose();
  const credentialResponse = page.waitForResponse(
    (r) => r.url().endsWith('/credentials') && r.request().method() === 'PUT',
  );
  await clickText('button', 'Save encrypted sandbox credentials');
  check((await credentialResponse).status() === 200, 'Synthetic vault save failed.');
  await page.waitForFunction(() =>
    document.body.textContent.includes('Credentials saved encrypted.'),
  );
  await clickText('summary', 'Add masked account alias');
  await page.type('input[placeholder="Alias (e.g. Main operating)"]', 'Synthetic till');
  await page.type('input[placeholder="Last 4 digits only"]', '4321');
  await waitButton('Add alias');
  const aliasResponse = page.waitForResponse(
    (r) => r.url().endsWith('/accounts') && r.request().method() === 'POST',
  );
  await clickText('button', 'Add alias');
  check((await aliasResponse).status() === 201, 'Synthetic masked alias was not saved.');
  await waitButton('Test OAuth connection');
  const healthResponse = page.waitForResponse(
    (r) => r.url().endsWith('/health') && r.request().method() === 'POST',
  );
  await clickText('button', 'Test OAuth connection');
  check((await healthResponse).status() === 200, 'Mock OAuth health check failed.');
  await page.waitForFunction(() =>
    document.body.textContent.includes('OAuth connection check succeeded'),
  );
  await waitButton('Enable integration');
  const enableResponse = page.waitForResponse(
    (r) => r.url().endsWith('/enabled') && r.request().method() === 'PUT',
  );
  await clickText('button', 'Enable integration');
  check((await enableResponse).status() === 200, 'Synthetic integration activation failed.');
  await page.waitForFunction(() =>
    document.body.textContent.includes('Integration enabled for sandbox only.'),
  );

  await page.click('aside button[title="Billing & Invoicing"]');
  try {
    await page.waitForFunction(
      (number) =>
        document.body.textContent.includes(number) &&
        document.body.textContent.includes('Request M-Pesa sandbox prompt'),
      { timeout: 20000 },
      invoiceNumber,
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .map((e) => e.textContent.trim())
        .slice(0, 12),
      alerts: [...document.querySelectorAll('[role="alert"]')]
        .map((e) => e.textContent.trim())
        .slice(0, 5),
      text: document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 1500),
    }));
    throw new Error(
      `Synthetic cashier did not load: ${JSON.stringify({ ...state, failedResponses })}`,
      { cause: error },
    );
  }
  await clickText('summary', 'Request M-Pesa sandbox prompt');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('select')].some((s) =>
      [...s.options].some((o) => o.text.includes('sandbox #')),
    ),
  );
  const integration = (
    await pool.query(
      `SELECT id FROM facility_payment_integrations WHERE tenant_id=$1 AND facility_id=$2 AND environment='SANDBOX'`,
      [tenant, facility],
    )
  ).rows[0].id;
  const integrationSelect = await labelControl('Sandbox integration', 'select');
  await integrationSelect.select(String(integration));
  await integrationSelect.dispose();
  const amount = await labelControl('Amount (whole KES)');
  await amount.type('20');
  await amount.dispose();
  const phone = await labelControl('Payment phone (254 format)');
  await phone.type('254700000001');
  await phone.dispose();
  const firstResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/payment-hub/facility/collections' &&
      r.request().method() === 'POST',
  );
  await clickText('button', 'Request sandbox STK');
  check((await firstResponse).status() === 201, 'Mock STK initiation failed.');
  try {
    await page.waitForFunction(
      () =>
        document.body.textContent.includes(': PENDING') &&
        document.body.textContent.includes('not proof of payment'),
      { timeout: 15000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()),
      text: document.body.textContent.replace(/\s+/g, ' ').trim().slice(-1800),
    }));
    throw new Error(
      `Synthetic request did not render: ${JSON.stringify({ ...state, failedResponses })}`,
      { cause: error },
    );
  }
  const storageName = `jalicare:mpesa:pending:${user}:${facility}`;
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageName);
  check(
    saved &&
      saved.invoiceId === invoice &&
      saved.integrationId === integration &&
      typeof saved.key === 'string',
    'Opaque retry identity was not stored.',
  );
  check(
    !('phone' in saved) &&
      !('amountKes' in saved) &&
      !JSON.stringify(saved).includes('254700000001'),
    'Sensitive payment input was persisted.',
  );
  let transactions = (
    await pool.query(
      `SELECT id,status,result_code FROM payment_hub_transactions WHERE tenant_id=$1 AND facility_id=$2 AND invoice_id=$3 ORDER BY id`,
      [tenant, facility, invoice],
    )
  ).rows;
  check(
    transactions.length === 1 && transactions[0].status === 'PENDING',
    'Mock acceptance was not persisted as pending.',
  );
  const initialFinancial = (
    await pool.query(`SELECT paid_amount,balance_amount,status FROM billing_invoices WHERE id=$1`, [
      invoice,
    ])
  ).rows[0];
  check(
    initialFinancial.paid_amount === '0.00' && initialFinancial.balance_amount === '100.00',
    'Mock acceptance changed the invoice.',
  );

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('aside button[title="Billing & Invoicing"]', { timeout: 30000 });
  await page.click('aside button[title="Billing & Invoicing"]');
  await page.waitForFunction(() =>
    document.body.textContent.includes('Request M-Pesa sandbox prompt'),
  );
  await clickText('summary', 'Request M-Pesa sandbox prompt');
  await page.waitForFunction(() => document.body.textContent.includes('Saved request for invoice'));
  await clickText('button', 'Check earlier request');
  await page.waitForFunction(() => document.body.textContent.includes(': PENDING'));
  await waitButton('Query provider status');
  await clickText('button', 'Query provider status');
  await page.waitForFunction(
    () =>
      document.body.textContent.includes('PROVIDER REPORTED SUCCESS') &&
      document.body.textContent.includes('NOT SETTLED'),
  );
  transactions = (
    await pool.query(
      `SELECT id,status,result_code FROM payment_hub_transactions WHERE tenant_id=$1 AND facility_id=$2 AND invoice_id=$3 ORDER BY id`,
      [tenant, facility, invoice],
    )
  ).rows;
  check(
    transactions.length === 1 && transactions[0].status === 'PROVIDER_CONFIRMED',
    'Mock status query was not recorded conservatively.',
  );

  const callbackStatuses = await page.evaluate(async () => {
    const payloads = [
      {},
      {
        Body: {
          stkCallback: {
            CheckoutRequestID: 'unknown_synthetic',
            ResultCode: 0,
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 999 },
                { Name: 'Currency', Value: 'USD' },
              ],
            },
          },
        },
      },
    ];
    return Promise.all(
      payloads.map(
        async (body) =>
          (
            await fetch('/api/payment-hub/webhooks/mpesa', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status,
      ),
    );
  });
  check(
    callbackStatuses.every((status) => status === 503),
    'Unauthenticated mock callback was not refused.',
  );
  check(auth.startsWith('Bearer '), 'Authenticated synthetic browser session was not observed.');
  const denied = await page.evaluate(
    async ({ token, other }) =>
      (
        await fetch(`/api/payment-hub/facility/collections/invoices?facilityId=${other}`, {
          headers: { Authorization: token },
        })
      ).status,
    { token: auth, other: sibling },
  );
  check(denied === 403, 'Cross-facility invoice browsing was not denied.');

  const reviewed = await labelControl('I reviewed this request');
  await reviewed.click();
  await reviewed.dispose();
  await clickText('button', 'Start a separate request');
  const selectAgain = await labelControl('Sandbox integration', 'select');
  await selectAgain.select(String(integration));
  await selectAgain.dispose();
  const amountAgain = await labelControl('Amount (whole KES)');
  await amountAgain.type('20');
  await amountAgain.dispose();
  const phoneAgain = await labelControl('Payment phone (254 format)');
  await phoneAgain.type('254700000001');
  await phoneAgain.dispose();
  const secondResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/payment-hub/facility/collections' &&
      r.request().method() === 'POST',
  );
  await clickText('button', 'Request sandbox STK');
  check((await secondResponse).status() === 201, 'Explicit second mock request failed.');
  await page.waitForFunction(() => document.body.textContent.includes(': PENDING'));
  await waitButton('Query provider status');
  await clickText('button', 'Query provider status');
  await page.waitForFunction(() => document.body.textContent.includes('CANCELLED BY CUSTOMER'));
  transactions = (
    await pool.query(
      `SELECT id,status,result_code FROM payment_hub_transactions WHERE tenant_id=$1 AND facility_id=$2 AND invoice_id=$3 ORDER BY id`,
      [tenant, facility, invoice],
    )
  ).rows;
  check(
    transactions.length === 2 &&
      transactions[1].status === 'FAILED' &&
      transactions[1].result_code === '1032',
    'Mock cancellation was not recorded safely.',
  );
  const finalFinancial = (
    await pool.query(`SELECT paid_amount,balance_amount,status FROM billing_invoices WHERE id=$1`, [
      invoice,
    ])
  ).rows[0];
  const payments = (
    await pool.query(`SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1`, [
      invoice,
    ])
  ).rows[0].n;
  const journals = (
    await pool.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id=$1 AND facility_id=$2`,
      [tenant, facility],
    )
  ).rows[0].n;
  const events = (
    await pool.query(
      `SELECT count(*)::int AS n FROM payment_hub_webhook_events WHERE tenant_id=$1 AND facility_id=$2`,
      [tenant, facility],
    )
  ).rows[0].n;
  check(
    JSON.stringify(finalFinancial) === JSON.stringify(initialFinancial) &&
      payments === 0 &&
      journals === 0 &&
      events === 0,
    'Mock provider or rejected callbacks changed financial records.',
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Synthetic cashier page overflows on mobile.',
  );
  check(pageErrors.length === 0, `Browser reported ${pageErrors.length} uncaught page error(s).`);
  console.log(
    'Synthetic browser + PostgreSQL PASS: scoped setup, cashier selection, mock STK acceptance, refresh recovery, mock success query, explicit separate request, mock cancellation, callback refusal, facility denial and unchanged invoice/receipts/journals.',
  );
  console.log(
    'All provider responses were intercepted mocks. No Safaricom endpoint was contacted; authenticated callbacks and settlement remain unverified.',
  );
} finally {
  if (browser) await browser.close();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (server) server.kill('SIGTERM');
  await pool.end();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}
