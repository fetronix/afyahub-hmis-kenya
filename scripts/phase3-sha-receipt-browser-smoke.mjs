import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// Synthetic staff-attested records only: no provider response or bank transfer.
// This smoke never migrates, resets, or destroys a database.
const root = process.env.BROWSER_SMOKE_BUILD_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '';
const host = process.env.SQL_HOST ?? '';
const port = Number(process.env.BROWSER_SMOKE_PORT ?? '4195');
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
const username = `p3_sha_browser_${suffix}`;
const password = randomBytes(32).toString('base64url');
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SQL_SSL: 'false',
  TZ: 'UTC',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base,
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'silent',
  ADMIN_USERNAME: `p3_sha_platform_${suffix}`,
  ADMIN_EMAIL: `p3_sha_platform_${suffix}@example.test`,
  ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
  ADMIN_FULL_NAME: 'Synthetic Platform Admin',
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
      identity.migrations >= 72,
    'Synthetic database attestation failed.',
  );
  phase = 'synthetic fixture';
  check(
    spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
      cwd: root,
      env,
      stdio: 'ignore',
      timeout: 30000,
    }).status === 0,
    'Synthetic bootstrap failed.',
  );
  const tenant = (
    await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
      'Synthetic SHA browser tenant',
      `p3-sha-browser-${suffix}`,
    ])
  ).rows[0].id;
  const facility = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,enabled_modules)
    VALUES($1,$2,'Synthetic SHA browser facility','Level 4',$3,$4::jsonb) RETURNING id`,
      [
        tenant,
        `P3-SHA-B-${suffix}`,
        `SYN-MFL-${suffix}`,
        JSON.stringify(['registration', 'insurance', 'finance', 'accounting']),
      ],
    )
  ).rows[0].id;
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const actor = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
    VALUES($1,$1,$2,'Synthetic insurance clerk',$3,'ACTIVE',$4,$5) RETURNING id`,
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'SYNTHETIC_INSURANCE',true) RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
  for (const permission of [
    'patients.read',
    'insurance.sha.read',
    'insurance.sha.claims.read',
    'insurance.sha.reconciliation.manage',
  ]) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
      [permission],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
      [role, permission],
    );
  }
  const provider = (
    await pool.query(
      "SELECT id FROM insurance_payer_definitions WHERE code='SHA' AND status='ACTIVE'",
    )
  ).rows[0]?.id;
  check(provider, 'Synthetic SHA payer definition is not active.');
  await pool.query(
    `INSERT INTO insurance_payer_assignments(provider_id,tenant_id,facility_id,is_allowed,assignment_source,updated_by_user_id)
    VALUES($1,$2,$3,true,'PLATFORM',$4)`,
    [provider, tenant, facility, actor],
  );
  await pool.query(
    "INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,is_active) VALUES($1,$2,'SHA',true)",
    [tenant, facility],
  );
  const patient = (
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
    VALUES($1,$2,$3,'Synthetic','Browser Patient','2000-01-01','Other') RETURNING id`,
      [tenant, facility, `P3-SHA-MRN-${suffix}`],
    )
  ).rows[0].id;
  const invoice = (
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,payer_type)
    VALUES($1,$2,$3,$4,'75.00','75.00','0.00','Paid','SHA') RETURNING id`,
      [tenant, facility, patient, `SYN-INV-${suffix}`],
    )
  ).rows[0].id;
  const claim = (
    await pool.query(
      `INSERT INTO sha_eclaims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,environment_mode,is_simulated,status,billable_start,billable_end,total_billed_amount,total_claimed_amount,total_approved_amount)
    VALUES($1,$2,$3,$4,$5,$6,'SYNTHETIC_TEST_FIXTURE',false,'ADJUDICATED','2026-10-28','2026-10-28','75.00','75.00','75.00') RETURNING id`,
      [tenant, facility, patient, invoice, `SYN-CLAIM-${suffix}`, randomUUID()],
    )
  ).rows[0].id;
  const reference = `SYN-ADVICE-REF-${suffix}`;
  const receipt = (
    await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,reference_code,cashier_name)
    VALUES($1,$2,'SHA','75.00',$3,'Synthetic cashier') RETURNING id`,
      [invoice, `SYN-RECEIPT-${suffix}`, reference],
    )
  ).rows[0].id;
  const advice = (
    await pool.query(
      `INSERT INTO insurance_remittances(tenant_id,facility_id,payer_code,remittance_number,payer_remittance_ref,payment_date,payment_channel,total_remitted_amount,allocated_amount,unallocated_amount,status,source,is_simulated)
    VALUES($1,$2,'SHA',$3,$4,'2026-10-28','EFT','75.00','75.00','0.00','AWAITING_RECEIPT','SYNTHETIC_TEST_FIXTURE',false) RETURNING id`,
      [tenant, facility, `SYN-ADVICE-${suffix}`, reference],
    )
  ).rows[0].id;
  const entry = (
    await pool.query(
      `INSERT INTO insurance_reconciliation_entries(tenant_id,facility_id,remittance_id,eclaim_id,invoice_id,claimed_amount,approved_amount,remitted_amount)
    VALUES($1,$2,$3,$4,$5,'75.00','75.00','75.00') RETURNING id`,
      [tenant, facility, advice, claim, invoice],
    )
  ).rows[0].id;

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
  phase = 'browser login and SHA navigation';
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
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
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
        const b = [...document.querySelectorAll(sel)].find((el) => el.textContent.trim() === label);
        if (!b || b.disabled) return false;
        b.click();
        return true;
      },
      text,
      selector,
    );
    check(found, `Synthetic UI control not found: ${text}`);
  };
  await waitText('Insurance & SHA eClaims');
  await clickText('Insurance & SHA eClaims', 'aside button');
  await waitText('Remittances & Reconciliation');
  await clickText('Remittances & Reconciliation');
  await waitText('AWAITING_RECEIPT · receipt pending');
  const field = `input[aria-label="Existing billing receipt ID for allocation ${entry}"]`;
  await page.waitForSelector(field, { timeout: 30000 });
  await page.type(field, String(receipt));
  phase = 'browser receipt match';
  const response = page.waitForResponse(
    (res) =>
      res.url().includes(`/remittances/${advice}/entries/${entry}/match-receipt`) &&
      res.request().method() === 'POST',
    { timeout: 30000 },
  );
  await clickText('Match receipt');
  const res = await response;
  check(res.status() === 200, 'Receipt-match API did not succeed.');
  const body = await res.json();
  check(
    body.idempotentReplay === false &&
      body.entry.postedPaymentId === receipt &&
      body.remittance.status === 'RECONCILED',
    'Unexpected receipt-match response.',
  );
  await waitText(`Matched receipt #${receipt}`);
  const state = (
    await pool.query(
      `SELECT c.status,c.total_paid_amount,i.paid_amount,r.status AS advice_status,e.posted_payment_id,e.applied_to_invoice_amount,
    (SELECT count(*)::int FROM billing_payments WHERE invoice_id=i.id) receipts,
    (SELECT count(*)::int FROM audit_logs WHERE facility_id=$2 AND action='SHA_REMITTANCE_RECEIPT_MATCHED' AND resource_id=$3) audits
    FROM sha_eclaims c JOIN billing_invoices i ON i.id=c.invoice_id
    JOIN insurance_reconciliation_entries e ON e.eclaim_id=c.id JOIN insurance_remittances r ON r.id=e.remittance_id
    WHERE c.id=$1 AND e.id=$3::int`,
      [claim, facility, String(entry)],
    )
  ).rows[0];
  check(
    state?.status === 'PAID' &&
      state.total_paid_amount === '75.00' &&
      state.paid_amount === '75.00' &&
      state.advice_status === 'RECONCILED' &&
      state.posted_payment_id === receipt &&
      state.applied_to_invoice_amount === '75.00' &&
      state.receipts === 1 &&
      state.audits === 1,
    'Synthetic database/audit state did not match.',
  );
  check(errors.length === 0, 'A browser runtime error occurred.');
  console.log(
    'Synthetic Chromium: login, SHA advice pending, existing receipt match, API, PostgreSQL and audit: PASS',
  );
  console.log(
    'The seeded local claim/advice/receipt are synthetic staff-attested fixtures, not provider results or real money.',
  );
} catch (error) {
  console.error(
    `Synthetic SHA browser failed during ${phase}: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill('SIGTERM');
  await pool.end();
}
