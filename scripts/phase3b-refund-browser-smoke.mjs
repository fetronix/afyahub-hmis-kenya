import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// Only an attested private synthetic database and a disposable build; no transfer/provider is contacted.
const root = process.env.BROWSER_SMOKE_BUILD_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '',
  host = process.env.SQL_HOST ?? '',
  executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
const port = Number(process.env.BROWSER_SMOKE_PORT ?? 4197);
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
)
  throw new Error(
    'An explicitly acknowledged and attested synthetic database and Chromium are required.',
  );
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
});
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const suffix = randomUUID().replaceAll('-', '').slice(0, 10),
  requesterName = `p3br_request_${suffix}`,
  reviewerName = `p3br_review_${suffix}`;
const requesterPassword = randomBytes(32).toString('base64url'),
  reviewerPassword = randomBytes(32).toString('base64url');
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SQL_SSL: 'false',
  TZ: 'UTC',
  APP_BASE_URL: base,
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'silent',
};
let server,
  browser,
  phase = 'database attestation';
try {
  const identity = (
    await pool.query(
      `SELECT current_database() name,inet_server_addr()::text address,current_setting('data_directory') directory,current_setting('TimeZone') timezone,current_setting('server_version') version,(SELECT system_identifier::text FROM pg_control_system()) cluster,(SELECT count(*)::int FROM drizzle.__drizzle_migrations) migrations`,
    )
  ).rows[0];
  check(
    identity.name === database &&
      ['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.address) &&
      identity.directory === process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY &&
      identity.timezone === 'UTC' &&
      identity.cluster === process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER &&
      identity.version.startsWith('16.15') &&
      identity.migrations === 73,
    'Synthetic database identity mismatch.',
  );
  phase = 'synthetic fixture';
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      'Synthetic refund browser tenant',
      `p3br-browser-${suffix}`,
    ])
  ).rows[0].id;
  const facility = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,address,county,phone,enabled_modules) VALUES($1,$2,'Synthetic refund browser facility','Level 4',$3,'Synthetic address','Nairobi','0000000000',$4::jsonb) RETURNING id`,
      [
        tenant,
        `P3BR-${suffix}`,
        `P3BR-MFL-${suffix}`,
        JSON.stringify(['registration', 'finance', 'accounting']),
      ],
    )
  ).rows[0].id;
  const role = async (name, grants) => {
    const id = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `${name}_${suffix}`],
      )
    ).rows[0].id;
    for (const permission of grants) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [id, permission],
      );
    }
    return id;
  };
  const requesterRole = await role('SYNTHETIC_REQUESTER', [
    'patients.read',
    'clinical.read',
    'billing.read',
    'billing.update',
    'billing.payments.record',
    'billing.refunds.record',
    'accounting.read',
    'accounting.journals.post',
  ]);
  const reviewerRole = await role('SYNTHETIC_REVIEWER', [
    'patients.read',
    'billing.read',
    'billing.refunds.approve',
  ]);
  const createUser = async (username, password, roleId) => {
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic refund user',$3,'ACTIVE',$4,$5) RETURNING id`,
        [username, `${username}@example.test`, hash, tenant, facility],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, roleId]);
    return id;
  };
  const requester = await createUser(requesterName, requesterPassword, requesterRole),
    reviewer = await createUser(reviewerName, reviewerPassword, reviewerRole);
  const patient = (
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Refund Browser','2000-01-01','Other') RETURNING id`,
      [tenant, facility, `P3BR-P-${suffix}`],
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
    "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination')",
    [encounter, patient],
  );
  const tariff = (
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee) VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','100.00') RETURNING id",
      [tenant, facility, `SYN-${suffix}`],
    )
  ).rows[0].id;
  const invoice = (
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status,payer_type) VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Pending','Cash') RETURNING id`,
      [tenant, facility, patient, encounter, `P3BR-INV-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount) VALUES($1,$2,$3,'Consultation','Synthetic consultation',1,'100.00','100.00')`,
    [invoice, tariff, `SYN-${suffix}`],
  );
  const accounts = (
    await pool.query(
      `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance) VALUES($1,$2,$3,'Synthetic receivable','ASSET','RECEIVABLE','DEBIT'),($1,$2,$4,'Synthetic cash','ASSET','CASH','DEBIT'),($1,$2,$5,'Synthetic revenue','REVENUE','GENERAL','CREDIT') RETURNING id`,
      [tenant, facility, `AR-${suffix}`, `CASH-${suffix}`, `REV-${suffix}`],
    )
  ).rows.map((r) => r.id);
  const [ar, cash, revenue] = accounts,
    date = (await pool.query('SELECT current_date::text date')).rows[0].date;
  await pool.query(
    'INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6)',
    [
      tenant,
      facility,
      `SYN-${suffix}`,
      'Synthetic open period',
      `${date.slice(0, 4)}-01-01`,
      `${date.slice(0, 4)}-12-31`,
    ],
  );
  phase = 'server startup';
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic server startup timeout')), 20000);
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', () => {});
    server.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Synthetic server exited during startup'));
    });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Synthetic readiness failed.');
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: username, password }),
    });
    check(res.status === 200, 'Synthetic login failed.');
    const value = await res.json();
    check(typeof value.sessionToken === 'string', 'Synthetic session unavailable.');
    return value.sessionToken;
  };
  const token = await login(requesterName, requesterPassword);
  const request = async (path, body, expected = 201) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.status !== expected) {
      const value = await res.json().catch(() => ({}));
      throw new Error(`Synthetic API ${path} returned ${res.status}: ${value.error ?? 'unknown'}`);
    }
    return res.json();
  };
  phase = 'reviewed invoice and original receipt';
  await request(`/api/invoices/${invoice}/finalize`, {
    insurerResponsibility: '0.00',
    copayment: '0.00',
    allocationBasis: 'Synthetic reviewed self-pay',
  });
  await request(`/api/accounting/billing-postings/BILLING_INVOICE/${invoice}`, {
    facilityId: facility,
    entryDate: date,
    description: 'Synthetic invoice posting',
    idempotencyKey: randomUUID(),
    patientReceivableAccountId: ar,
    revenueAccountId: revenue,
  });
  const payment = (
    await request('/api/billing/payments', {
      facilityId: facility,
      invoiceId: invoice,
      amount: '100.00',
      paymentMethod: 'Cash',
      payerParty: 'PATIENT',
      idempotencyKey: randomUUID(),
    })
  ).payment;
  await request(`/api/accounting/billing-postings/BILLING_PAYMENT/${payment.id}`, {
    facilityId: facility,
    entryDate: date,
    description: 'Synthetic receipt posting',
    idempotencyKey: randomUUID(),
    settlementAccountId: cash,
  });
  phase = 'requester and reviewer browsers';
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
  const errors = [];
  const startPage = async (username, password) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => errors.push(e.name));
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[placeholder="Username or Email"]');
    await page.type('input[placeholder="Username or Email"]', username);
    await page.type('input[placeholder="Password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside nav', { timeout: 30000 });
    return page;
  };
  const waitText = (page, text) =>
    page.waitForFunction(
      (value) => document.body.innerText.includes(value),
      { timeout: 30000 },
      text,
    );
  const clickText = async (page, text, selector = 'button') => {
    const found = await page.evaluate(
      (label, sel) => {
        const el = [...document.querySelectorAll(sel)].find(
          (node) => node.textContent.trim() === label,
        );
        if (!el || el.disabled) return false;
        el.click();
        return true;
      },
      text,
      selector,
    );
    check(found, `Synthetic UI control unavailable: ${text}`);
  };
  const requesterPage = await startPage(requesterName, requesterPassword);
  await waitText(requesterPage, 'Billing & Invoicing');
  await clickText(requesterPage, 'Billing & Invoicing', 'aside button');
  await waitText(requesterPage, payment.receiptNumber);
  const panel = 'section[aria-label="Refund requests and independent review"]';
  await requesterPage.waitForSelector(panel);
  await requesterPage.select(`${panel} select`, String(payment.id));
  const typeLabel = async (page, label, value) => {
    const handle = await page.evaluateHandle((name) => {
      const el = [...document.querySelectorAll('label')].find((x) =>
        x.textContent.trim().startsWith(name),
      );
      return el?.querySelector('input,textarea') ?? null;
    }, label);
    const element = handle.asElement();
    check(element, `Synthetic field unavailable: ${label}`);
    await element.type(value);
    await handle.dispose();
  };
  await typeLabel(requesterPage, 'Requested amount (KES)', '30.00');
  await typeLabel(requesterPage, 'Request reason', 'Synthetic browser refund');
  const requestResponse = requesterPage.waitForResponse(
    (res) =>
      res.url().endsWith('/api/billing/refund-requests') && res.request().method() === 'POST',
    { timeout: 30000 },
  );
  await clickText(requesterPage, 'Submit refund request');
  const created = await requestResponse;
  check(created.status() === 201, 'Browser request was not saved.');
  const q = (await created.json()).request;
  check(
    q.invoiceId === invoice &&
      q.paymentId === payment.id &&
      q.amount === '30.00' &&
      q.status === 'REQUESTED',
    'Browser request source mismatch.',
  );
  const reviewerPage = await startPage(reviewerName, reviewerPassword);
  await waitText(reviewerPage, 'Billing & Invoicing');
  await clickText(reviewerPage, 'Billing & Invoicing', 'aside button');
  await waitText(reviewerPage, q.requestNumber);
  await typeLabel(
    reviewerPage,
    `Review notes for ${q.requestNumber}`,
    'Independent synthetic browser review',
  );
  const decisionResponse = reviewerPage.waitForResponse(
    (res) =>
      res.url().includes(`/refund-requests/${q.id}/decision`) && res.request().method() === 'POST',
    { timeout: 30000 },
  );
  await clickText(reviewerPage, `Approve ${q.requestNumber}`);
  const decision = await decisionResponse;
  check(
    decision.status() === 201 && (await decision.json()).status === 'APPROVED',
    'Browser independent review failed.',
  );
  phase = 'manual settlement browser';
  await requesterPage.bringToFront();
  await clickText(requesterPage, 'Refresh requests');
  await waitText(requesterPage, `Record external refund for ${q.requestNumber}`);
  await clickText(requesterPage, `Record external refund for ${q.requestNumber}`);
  phase = 'manual confirmation label';
  await requesterPage.waitForFunction(() =>
    [...document.querySelectorAll('label')].some((el) =>
      /I\s+confirm\s+the\s+refund\s+was\s+actually\s+performed/.test(el.textContent ?? ''),
    ),
  );
  const manualCheckbox = await requesterPage.evaluateHandle(
    () =>
      [...document.querySelectorAll('label')]
        .find((el) =>
          /I\s+confirm\s+the\s+refund\s+was\s+actually\s+performed/.test(el.textContent ?? ''),
        )
        ?.querySelector('input[type="checkbox"]') ?? null,
  );
  const checkbox = manualCheckbox.asElement();
  check(checkbox, 'Synthetic manual confirmation unavailable.');
  // Exercise the native keyboard-accessible manual confirmation.
  await checkbox.focus();
  await requesterPage.keyboard.press('Space');
  await manualCheckbox.dispose();
  phase = 'manual confirmation enabled';
  await requesterPage.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (el) => el.textContent.trim() === 'Record refund receipt' && !el.disabled,
    ),
  );
  phase = 'manual settlement response';
  const settlementResponse = requesterPage.waitForResponse(
    (res) => res.url().endsWith('/api/billing/refunds') && res.request().method() === 'POST',
    { timeout: 30000 },
  );
  await clickText(requesterPage, 'Record refund receipt');
  const settlement = await settlementResponse;
  check(settlement.status() === 201, 'Browser manual settlement failed.');
  const refund = (await settlement.json()).refund;
  check(
    refund.invoiceId === invoice &&
      refund.paymentId === payment.id &&
      refund.amount === '30.00' &&
      refund.status === 'MANUALLY_RECORDED',
    'Browser refund source mismatch.',
  );
  phase = 'reviewed accounting reversal and statements';
  const posted = await request(`/api/accounting/billing-postings/BILLING_REFUND/${refund.id}`, {
    facilityId: facility,
    entryDate: date,
    description: 'Synthetic reviewed refund posting',
    idempotencyKey: randomUUID(),
    settlementAccountId: cash,
    receivableRefundKes: '30.00',
  });
  const overview = await fetch(
    `${base}/api/accounting/overview?facilityId=${facility}&startDate=${date}&endDate=${date}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  check(overview.status === 200, 'Synthetic statements unavailable.');
  const statement = await overview.json();
  check(
    statement.trialBalance.balanced === true &&
      statement.trialBalance.debitKes === '230.00' &&
      statement.trialBalance.creditKes === '230.00' &&
      statement.profitAndLoss.postedRevenueKes === '100.00' &&
      statement.balanceSheet.assetsKes === '100.00' &&
      statement.balanceSheet.balanced === true,
    'Synthetic statements do not reconcile to the posted refund.',
  );
  const persisted = (
    await pool.query(
      `SELECT q.status,q.requested_by_user_id,q.reviewed_by_user_id,q.settled_refund_id,i.paid_amount::text paid,j.source_type,j.source_id,j.status journal_status,j.total_debit_cents::text debit,j.total_credit_cents::text credit,(SELECT count(*)::int FROM journal_lines l WHERE l.journal_entry_id=j.id) lines,(SELECT count(*)::int FROM audit_logs a WHERE a.resource='RefundRequest' AND a.resource_id=q.id::text AND a.action IN ('REQUEST','APPROVE','SETTLE')) audits FROM billing_refund_requests q JOIN billing_invoices i ON i.id=q.invoice_id JOIN accounting_billing_postings p ON p.source_type='BILLING_REFUND' AND p.source_id=q.settled_refund_id JOIN journal_entries j ON j.id=p.journal_id WHERE q.id=$1 AND q.tenant_id=$2 AND q.facility_id=$3`,
      [q.id, tenant, facility],
    )
  ).rows[0];
  check(
    persisted?.status === 'SETTLED' &&
      persisted.requested_by_user_id === requester &&
      persisted.reviewed_by_user_id === reviewer &&
      persisted.settled_refund_id === refund.id &&
      persisted.paid === '70.00' &&
      persisted.source_type === 'BILLING_REFUND' &&
      persisted.source_id === String(refund.id) &&
      persisted.journal_status === 'POSTED' &&
      persisted.debit === '3000' &&
      persisted.credit === '3000' &&
      persisted.lines === 2 &&
      persisted.audits === 3 &&
      posted.journal.id > 0,
    'Synthetic request, receipt, journal or audit mismatch.',
  );
  const reversed = await request(`/api/accounting/journals/${posted.journal.id}/reverse`, {
    facilityId: facility,
    entryDate: date,
    reason: 'Synthetic controlled journal correction',
    idempotencyKey: randomUUID(),
  });
  const chain = (
    await pool.query(
      `SELECT j.status,j.total_debit_cents::text debit,j.total_credit_cents::text credit,r.status reversal_status,r.total_debit_cents::text reversal_debit,r.total_credit_cents::text reversal_credit FROM journal_entries j JOIN journal_entries r ON r.reversal_of_journal_id=j.id WHERE j.id=$1`,
      [posted.journal.id],
    )
  ).rows[0];
  check(
    reversed &&
      chain?.status === 'POSTED' &&
      chain.reversal_status === 'POSTED' &&
      chain.debit === '3000' &&
      chain.credit === '3000' &&
      chain.reversal_debit === '3000' &&
      chain.reversal_credit === '3000',
    'Controlled reversal did not preserve a balanced source journal.',
  );
  check(errors.length === 0, 'A browser runtime error occurred.');
  console.log(
    'Synthetic Chromium: request UI, independent reviewer UI, manual settlement UI, source-linked balanced refund journal, statements, controlled reversal, PostgreSQL and audit: PASS',
  );
  console.log(
    'Synthetic fixture only; external transfer, provider confirmation and facility policies are not evidenced.',
  );
} catch (error) {
  console.error(
    `Synthetic refund browser failed during ${phase}: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await pool.end();
}
