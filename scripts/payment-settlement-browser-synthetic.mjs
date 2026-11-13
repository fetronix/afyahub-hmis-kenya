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

// Isolated, additive synthetic fixture only. Never reset a database or call a provider.
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
const proxyPort = Number(process.env.SETTLEMENT_BROWSER_PORT ?? '4357');
const backendPort = proxyPort + 1;
if (!Number.isInteger(proxyPort) || proxyPort < 1024 || backendPort > 65535)
  throw new Error('Invalid browser port.');
const origin = `https://127.0.0.1:${proxyPort}`;
const suffix = randomUUID().slice(0, 8);
const username = `synthetic_settlement_${suffix}`;
const password = randomBytes(32).toString('base64url');
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
  const identity = (await pool.query('SELECT current_database() AS db,current_user AS db_user'))
    .rows[0];
  check(
    identity.db === database && identity.db_user === process.env.SQL_ADMIN_USER,
    'Synthetic database identity mismatch.',
  );
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      `Synthetic settlement tenant ${suffix}`,
      `settlement-${suffix}`,
    ])
  ).rows[0].id;
  const facilities = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
     VALUES($1,$2,'Synthetic Settlement Facility',$3,'Synthetic Road','Nyeri','0000000000',$6::jsonb),
           ($1,$4,'Synthetic Sibling',$5,'Synthetic Road','Nyeri','0000000001',$6::jsonb) RETURNING id`,
      [
        tenant,
        `SA-${suffix}`,
        `SYN-A-${suffix}`,
        `SB-${suffix}`,
        `SYN-B-${suffix}`,
        JSON.stringify(['finance', 'accounting', 'registration']),
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
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
     VALUES($1,$1,$2,'Synthetic Finance User',$3,'ACTIVE',$4,$5) RETURNING id`,
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
  for (const code of [
    'billing.read',
    'billing.update',
    'billing.payments.record',
    'patients.read',
    'clinical.read',
    'accounting.read',
    'accounting.journals.post',
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
  const patient = (
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
     VALUES($1,$2,$3,'Synthetic','Settlement','2000-01-01','Other') RETURNING id`,
      [tenant, facility, `SYN-SETTLEMENT-${suffix}`],
    )
  ).rows[0].id;
  const department = (
    await pool.query(
      'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
      [facility, 'Synthetic OPD', `OPD-${suffix}`],
    )
  ).rows[0].id;
  const practitioner = (
    await pool.query(
      'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
      [tenant, facility, 'Synthetic clinician'],
    )
  ).rows[0].id;
  const encounter = (
    await pool.query(
      'INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [tenant, facility, patient, practitioner, department],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
    VALUES($1,$2,'ICD-10','Z00.0','Synthetic test')`,
    [encounter, patient],
  );
  const tariff = (
    await pool.query(
      `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
     VALUES($1,$2,$3,'Synthetic service','OPD','Visit','100.00') RETURNING id`,
      [tenant, facility, `SYN-${suffix}`],
    )
  ).rows[0].id;
  const invoice = (
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status)
     VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Unpaid') RETURNING id`,
      [tenant, facility, patient, encounter, `SYN-SETTLEMENT-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
    VALUES($1,$2,$3,'Consultation','Synthetic service',1,'100.00','100.00')`,
    [invoice, tariff, `SYN-${suffix}`],
  );
  const accounts = (
    await pool.query(
      `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
     VALUES($1,$2,'SYN_AR','Synthetic receivable','ASSET','RECEIVABLE','DEBIT'),
           ($1,$2,'SYN_CASH','Synthetic clearing','ASSET','CASH','DEBIT'),
           ($1,$2,'SYN_REV','Synthetic revenue','REVENUE','REVENUE','CREDIT') RETURNING id,account_code`,
      [tenant, facility],
    )
  ).rows;
  const account = (code) => accounts.find((row) => row.account_code === code).id;
  await pool.query(
    `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date)
    VALUES($1,$2,'SYN-PERIOD','Synthetic open period','2000-01-01','2099-12-31')`,
    [tenant, facility],
  );
  const date = (await pool.query('SELECT current_date::text AS today')).rows[0].today;

  tempDir = await mkdtemp(path.join(os.tmpdir(), 'jalicare-settlement-synthetic-tls-'));
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
  server = spawn('node', ['build/server.js'], {
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  let auth = '';
  page.on('pageerror', (error) => pageErrors.push(error.name));
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.headers().authorization?.startsWith('Bearer '))
      auth = request.headers().authorization;
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside button[title="Accounting & General Ledger"]', {
    timeout: 30000,
  });
  await page.click('aside button[title="Accounting & General Ledger"]');
  await page.waitForSelector('[aria-label="Payment settlement work"]', { timeout: 30000 });
  check(auth.startsWith('Bearer '), 'Authenticated browser session was not observed.');

  // These are local, manually recorded synthetic accounting inputs. They are
  // intentionally independent of the sandbox/provider workflow.
  const receiptCode = `ST${suffix.toUpperCase()}`;
  const prepared = await page.evaluate(
    async ({ token, facilityId, invoiceId, date, ar, rev, receiptCode, key }) => {
      const post = async (url, body, idempotencyKey) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify(body),
        });
        return { status: response.status, data: await response.json() };
      };
      const finalized = await post(`/api/invoices/${invoiceId}/finalize`, {
        insurerResponsibility: '0.00',
        copayment: '0.00',
        allocationBasis: 'Synthetic self-pay review',
      });
      if (finalized.status !== 201)
        return { step: 'finalize', status: finalized.status, error: finalized.data.error };
      const invoicePost = await post(
        `/api/accounting/billing-postings/BILLING_INVOICE/${invoiceId}`,
        {
          facilityId,
          entryDate: date,
          description: 'Synthetic invoice review',
          patientReceivableAccountId: ar,
          revenueAccountId: rev,
        },
        key,
      );
      if (invoicePost.status !== 201)
        return {
          step: 'invoice journal',
          status: invoicePost.status,
          error: invoicePost.data.error,
        };
      const receipt = await post('/api/billing/payments', {
        facilityId,
        invoiceId,
        amount: '25.00',
        paymentMethod: 'M-Pesa',
        transactionCode: receiptCode,
        payerParty: 'PATIENT',
        idempotencyKey: `${key}-receipt`,
      });
      if (receipt.status !== 201)
        return { step: 'manual receipt', status: receipt.status, error: receipt.data.error };
      return { step: 'ready', paymentId: receipt.data.payment.id };
    },
    {
      token: auth,
      facilityId: facility,
      invoiceId: invoice,
      date,
      ar: account('SYN_AR'),
      rev: account('SYN_REV'),
      receiptCode,
      key: randomUUID(),
    },
  );
  check(prepared.step === 'ready', `Synthetic preparation failed: ${JSON.stringify(prepared)}`);
  const payment = prepared.paymentId;
  const before = (
    await pool.query(
      `SELECT status,journal_id FROM accounting_payment_settlement_status WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3`,
      [tenant, facility, payment],
    )
  ).rows[0];
  check(
    before?.status === 'SUCCESS_AWAITING_SETTLEMENT' && before.journal_id === null,
    'Committed receipt was not visible as unresolved.',
  );
  await page.click('[aria-label="Payment settlement work"] button');
  await page.waitForSelector(`[aria-label="Review posting BILLING_PAYMENT ${payment}"]`, {
    timeout: 20000,
  });
  await page.click(`[aria-label="Review posting BILLING_PAYMENT ${payment}"]`);
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll('[aria-label="Settlement asset account"] option')].some(
        (o) => o.value === String(id),
      ),
    {},
    account('SYN_CASH'),
  );
  await page.select('[aria-label="Settlement asset account"]', String(account('SYN_CASH')));
  const setInput = (selector, value) =>
    page.$eval(
      selector,
      (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      },
      value,
    );
  await setInput('[aria-label="Settlement entry date"]', '1999-01-01');
  await page.type('[aria-label="Settlement description"]', 'Synthetic browser review');
  const postSelector = '[aria-label="Payment settlement work"] form button[type="submit"]';
  const failedResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/payment-settlements/BILLING_PAYMENT/') && r.request().method() === 'POST',
  );
  await page.click(postSelector);
  check(
    (await failedResponse).status() === 409,
    'Synthetic invalid-date failure was not enforced.',
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Payment settlement work"] [role="alert"]')
      ?.textContent.includes('not confirmed'),
  );
  const failed = (
    await pool.query(
      `SELECT status,journal_id FROM accounting_payment_settlement_status WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3`,
      [tenant, facility, payment],
    )
  ).rows[0];
  check(
    failed.status === 'SUCCESS_AWAITING_SETTLEMENT' && failed.journal_id === null,
    'Failed journal posting lost or falsely settled the receipt.',
  );
  await page.click('[aria-label="Payment settlement work"] button');
  await setInput('[aria-label="Settlement entry date"]', date);
  const successResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/payment-settlements/BILLING_PAYMENT/') && r.request().method() === 'POST',
  );
  await page.click(postSelector);
  check((await successResponse).status() === 201, 'Reviewed settlement journal was not posted.');
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Payment settlement work"] [role="status"]')
      ?.textContent.includes('posted'),
  );
  const settled = (
    await pool.query(
      `SELECT status,journal_id FROM accounting_payment_settlement_status WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3`,
      [tenant, facility, payment],
    )
  ).rows[0];
  check(
    settled.status === 'SETTLED' && settled.journal_id,
    'Journal and settlement status did not commit together.',
  );
  const totals = (
    await pool.query(
      'SELECT count(*)::int AS lines,sum(debit_cents)::text AS debit,sum(credit_cents)::text AS credit FROM journal_lines WHERE journal_entry_id=$1',
      [settled.journal_id],
    )
  ).rows[0];
  check(
    totals.lines === 2 && totals.debit === '2500' && totals.credit === '2500',
    'Synthetic journal is not balanced.',
  );
  const repeatAndScope = await page.evaluate(
    async ({ token, facilityId, other, paymentId, date, cash }) => {
      const response = await fetch(
        `/api/accounting/payment-settlements/BILLING_PAYMENT/${paymentId}/retry`,
        {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facilityId,
            entryDate: date,
            description: 'Synthetic browser review',
            settlementAccountId: cash,
          }),
        },
      );
      const body = await response.json();
      const denied = await fetch(`/api/accounting/payment-settlements?facilityId=${other}`, {
        headers: { Authorization: token },
      });
      return {
        status: response.status,
        replay: body.idempotentReplay,
        journalId: body.journal?.id,
        denied: denied.status,
      };
    },
    {
      token: auth,
      facilityId: facility,
      other: sibling,
      paymentId: payment,
      date,
      cash: account('SYN_CASH'),
    },
  );
  check(
    repeatAndScope.status === 200 &&
      repeatAndScope.replay &&
      repeatAndScope.journalId === settled.journal_id,
    'Browser retry duplicated a journal.',
  );
  check(repeatAndScope.denied === 403, 'Cross-facility settlement browsing was not denied.');
  const counts = (
    await pool.query(
      `SELECT
    (SELECT count(*)::int FROM billing_payments WHERE invoice_id=$1) AS receipts,
    (SELECT count(*)::int FROM accounting_billing_postings WHERE facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3) AS journals,
    (SELECT count(*)::int FROM payment_hub_reconciliations WHERE billing_payment_id=$3) AS provider_links,
    (SELECT count(*)::int FROM audit_logs WHERE facility_id=$2 AND resource='accounting_payment_settlement' AND resource_id=$3::text AND action='FAILED') AS failures`,
      [invoice, facility, payment],
    )
  ).rows[0];
  check(
    counts.receipts === 1 &&
      counts.journals === 1 &&
      counts.provider_links === 0 &&
      counts.failures === 1,
    'Synthetic evidence counts are inconsistent.',
  );
  const invoiceState = (
    await pool.query('SELECT paid_amount,balance_amount FROM billing_invoices WHERE id=$1', [
      invoice,
    ])
  ).rows[0];
  check(
    invoiceState.paid_amount === '25.00' && invoiceState.balance_amount === '75.00',
    'Synthetic receipt did not update the invoice correctly.',
  );
  await page.select('[aria-label="Settlement source filter"]', 'ALL');
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('[aria-label="Payment settlement work"]')
        ?.textContent.includes(`Receipt #${id}`) &&
      document
        .querySelector('[aria-label="Payment settlement work"]')
        ?.textContent.includes('Status: SETTLED'),
    {},
    payment,
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => {
      const section = document.querySelector('[aria-label="Payment settlement work"]');
      return section && section.scrollWidth <= section.clientWidth;
    }),
    'Settlement work overflows its mobile container.',
  );
  check(pageErrors.length === 0, `Browser reported ${pageErrors.length} uncaught page error(s).`);
  console.log(
    'Synthetic browser + server + PostgreSQL PASS: finalized invoice, reviewed invoice journal, independent manual receipt, failed posting, visible recovery, retry, one balanced receipt journal, replay and facility denial.',
  );
  console.log(
    'No provider endpoint or authenticated callback was exercised. This manual synthetic receipt is not a Safaricom sandbox payment or proof of transfer.',
  );
} finally {
  if (browser) await browser.close();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (server) server.kill('SIGTERM');
  await pool.end();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}
