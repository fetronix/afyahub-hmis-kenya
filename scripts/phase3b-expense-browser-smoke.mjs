import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// Synthetic local records only. No provider, bank or payment is contacted.
// This smoke does not migrate, reset, delete or destroy any database.
const root = process.env.BROWSER_SMOKE_BUILD_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '';
const host = process.env.SQL_HOST ?? '';
const port = Number(process.env.BROWSER_SMOKE_PORT ?? '4196');
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
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
    'An explicitly acknowledged and attested loopback synthetic test database and Chromium are required.',
  );
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
});
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const requesterName = `p3b_request_${suffix}`;
const reviewerName = `p3b_review_${suffix}`;
const requesterPassword = randomBytes(32).toString('base64url');
const reviewerPassword = randomBytes(32).toString('base64url');
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
    await pool.query(`SELECT current_database() name,inet_server_addr()::text address,
    current_setting('data_directory') directory,current_setting('TimeZone') timezone,
    current_setting('server_version') version,(SELECT system_identifier::text FROM pg_control_system()) cluster,
    (SELECT count(*)::int FROM drizzle.__drizzle_migrations) migrations`)
  ).rows[0];
  check(
    identity.name === database &&
      ['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.address) &&
      identity.directory === process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY &&
      identity.timezone === 'UTC' &&
      identity.cluster === process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER &&
      identity.version.startsWith('16.15') &&
      identity.migrations === 72,
    'Synthetic database identity mismatch.',
  );
  phase = 'synthetic fixture';
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      'Synthetic expense browser tenant',
      `p3b-exp-${suffix}`,
    ])
  ).rows[0].id;
  const facility = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,enabled_modules)
     VALUES($1,$2,'Synthetic expense browser facility','Level 4',$3,$4::jsonb) RETURNING id`,
      [
        tenant,
        `P3B-EXP-${suffix}`,
        `P3B-MFL-${suffix}`,
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
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
        [id, permission],
      );
    }
    return id;
  };
  const requesterRole = await role('SYNTHETIC_REQUESTER', [
    'accounting.read',
    'accounting.expenses.request',
  ]);
  const reviewerRole = await role('SYNTHETIC_REVIEWER', [
    'patients.read',
    'accounting.read',
    'accounting.expenses.approve',
    'accounting.journals.post',
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
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic financial user',$3,'ACTIVE',$4,$5) RETURNING id`,
        [username, `${username}@example.test`, hash, tenant, facility],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, roleId]);
    return id;
  };
  const requester = await createUser(requesterName, requesterPassword, requesterRole);
  const reviewer = await createUser(reviewerName, reviewerPassword, reviewerRole);
  const accounts = await pool.query(
    `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
     VALUES($1,$2,$3,'Synthetic expense account','EXPENSE','GENERAL','DEBIT'),
           ($1,$2,$4,'Synthetic payable account','LIABILITY','PAYABLE','CREDIT') RETURNING id`,
    [tenant, facility, `SYN-EXP-${suffix}`, `SYN-AP-${suffix}`],
  );
  const [expenseAccount, payableAccount] = accounts.rows.map((r) => r.id);
  const date = (await pool.query('SELECT current_date::text date')).rows[0].date;
  await pool.query(
    'INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6)',
    [
      tenant,
      facility,
      `SYN-${suffix}`,
      'Synthetic period',
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
  phase = 'authenticated source creation';
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: requesterName, password: requesterPassword }),
  });
  check(login.status === 200, 'Synthetic requester login failed.');
  const loginBody = await login.json();
  check(typeof loginBody.sessionToken === 'string', 'Synthetic requester session unavailable.');
  const create = await fetch(`${base}/api/accounting/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginBody.sessionToken}`,
    },
    body: JSON.stringify({
      facilityId: facility,
      expenseAccountId: expenseAccount,
      payableAccountId: payableAccount,
      amountKes: '75.00',
      incurredDate: date,
      idempotencyKey: randomUUID(),
      payeeName: 'Synthetic browser supplier',
      category: 'Synthetic category',
      description: 'Synthetic expense browser source',
      supportingDocuments: [
        { name: 'Synthetic evidence', storageReference: 'private/synthetic-evidence' },
      ],
    }),
  });
  check(create.status === 201, 'Synthetic expense source was not created.');
  const expenseId = (await create.json()).expenseId;
  const source = (
    await pool.query(
      'SELECT request_number FROM expense_requests WHERE id=$1 AND requested_by_user_id=$2',
      [expenseId, requester],
    )
  ).rows[0];
  check(source, 'Synthetic expense requester or source is inconsistent.');
  phase = 'reviewer browser login';
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
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', reviewerName);
  await page.type('input[placeholder="Password"]', reviewerPassword);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside nav', { timeout: 30000 });
  const waitText = (text) =>
    page.waitForFunction(
      (value) => document.body.innerText.includes(value),
      { timeout: 30000 },
      text,
    );
  const clickText = async (text, selector = 'button') => {
    const found = await page.evaluate(
      (label, sel) => {
        const button = [...document.querySelectorAll(sel)].find(
          (el) => el.textContent.trim() === label,
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      },
      text,
      selector,
    );
    check(found, `Synthetic UI control unavailable: ${text}`);
  };
  await waitText('Accounting & General Ledger');
  await clickText('Accounting & General Ledger', 'aside button');
  await waitText(source.request_number);
  await clickText(`Review ${source.request_number}`);
  await waitText('Synthetic expense account');
  await waitText('Synthetic payable account');
  await waitText('Synthetic evidence');
  const panel = '[aria-label="Selected expense review"]';
  await page.type(`${panel} textarea`, 'Independent synthetic browser review');
  await page.click(`${panel} input[type="checkbox"]`);
  phase = 'browser approval and ledger';
  const approvalResponse = page.waitForResponse(
    (res) =>
      res.url().includes(`/expenses/${expenseId}/approve-and-post`) &&
      res.request().method() === 'POST',
    { timeout: 30000 },
  );
  const reportResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/api/accounting/overview?') &&
      res.request().method() === 'GET' &&
      res.status() === 200,
    { timeout: 30000 },
  );
  await clickText('Approve and post payable');
  const approval = await approvalResponse;
  check(approval.status() === 201, 'Synthetic approval and posting failed.');
  const posted = await approval.json();
  check(
    posted.status === 'POSTED' &&
      posted.paymentRecorded === false &&
      posted.idempotentReplay === false,
    'Unexpected synthetic approval result.',
  );
  await waitText(`journal #${posted.journalId}. No payment was recorded.`);
  const report = await (await reportResponse).json();
  check(
    report.trialBalance.balanced === true &&
      report.trialBalance.debitKes === '75.00' &&
      report.trialBalance.creditKes === '75.00' &&
      report.profitAndLoss.postedExpensesKes === '75.00' &&
      report.balanceSheet.liabilitiesKes === '75.00',
    'Synthetic statement does not reconcile to the journal.',
  );
  const state = (
    await pool.query(
      `SELECT e.status,e.requested_by_user_id,e.reviewed_by_user_id,e.posted_journal_id,j.source_type,j.source_id,j.status AS journal_status,
       j.total_debit_cents::text debit,j.total_credit_cents::text credit,
       (SELECT count(*)::int FROM journal_lines l WHERE l.journal_entry_id=j.id) line_count,
       (SELECT count(*)::int FROM audit_logs a WHERE a.facility_id=e.facility_id AND a.resource='expense_request'
          AND a.resource_id=e.id::text AND a.action IN ('REQUEST','APPROVE','POST')) expense_audits
     FROM expense_requests e JOIN journal_entries j ON j.id=e.posted_journal_id
     WHERE e.id=$1 AND e.tenant_id=$2 AND e.facility_id=$3`,
      [expenseId, tenant, facility],
    )
  ).rows[0];
  check(
    state?.status === 'POSTED' &&
      state.requested_by_user_id === requester &&
      state.reviewed_by_user_id === reviewer &&
      state.posted_journal_id === posted.journalId &&
      state.source_type === 'EXPENSE_REQUEST' &&
      state.source_id === String(expenseId) &&
      state.journal_status === 'POSTED' &&
      state.debit === '7500' &&
      state.credit === '7500' &&
      state.line_count === 2 &&
      state.expense_audits === 3,
    'Synthetic source, journal or audit state did not match.',
  );
  check(errors.length === 0, 'A browser runtime error occurred.');
  console.log(
    'Synthetic Chromium: request API, independent approval UI, payable journal, statement, PostgreSQL and audit: PASS',
  );
  console.log('Synthetic local fixture only; no payment, bank transfer or provider evidence.');
} catch (error) {
  console.error(
    `Synthetic expense browser failed during ${phase}: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await pool.end();
}
