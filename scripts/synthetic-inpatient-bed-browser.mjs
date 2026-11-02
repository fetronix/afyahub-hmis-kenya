import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';

// Explicitly synthetic, local-only fixtures. This script never migrates,
// resets, drops or connects to a production database. Credentials are random,
// held in memory and never printed.
const root = fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '';
const host = process.env.SQL_HOST ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' || !['127.0.0.1', 'localhost', '::1'].includes(host) ||
    !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database) || !process.env.SQL_ADMIN_USER || !executablePath) {
  throw new Error('A dedicated local synthetic test database, explicit acknowledgement, and Chromium are required.');
}
const sqlPort = Number(process.env.SQL_PORT ?? '5432');
const port = Number(process.env.BROWSER_SMOKE_PORT ?? '4194');
if (!Number.isInteger(sqlPort) || sqlPort < 1 || sqlPort > 65535 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.');
const fixturePrice = process.env.SYNTHETIC_BED_DAILY_CHARGE ?? '100.00';
if (!/^[1-9]\d{0,6}\.\d{2}$/.test(fixturePrice)) throw new Error('A positive synthetic fixture price with two decimals is required.');
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(32).toString('base64url');
const adminPassword = randomBytes(32).toString('base64url');
const username = `inpatient_browser_${suffix}`;
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', SQL_HOST: host, SQL_PORT: String(sqlPort), SQL_DB_NAME: database,
  SQL_SSL: 'false', TZ: 'Africa/Nairobi', DEFAULT_TIMEZONE: 'Africa/Nairobi', FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'silent',
  ADMIN_USERNAME: `inpatient_platform_${suffix}`, ADMIN_EMAIL: `inpatient_platform_${suffix}@example.test`, ADMIN_PASSWORD: adminPassword, ADMIN_FULL_NAME: 'Synthetic Platform Administrator' };
const pool = new pg.Pool({ host, port: sqlPort, database, user: process.env.SQL_ADMIN_USER, password: process.env.SQL_ADMIN_PASSWORD ?? '' });
const check = (condition, message) => { if (!condition) throw new Error(message); };
let server, browser, phase = 'setup';
try {
  const identity = (await pool.query('SELECT current_database() AS name, inet_server_addr()::text AS address')).rows[0];
  check(identity.name === database && ['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.address), 'Unexpected database identity.');
  const bootstrap = spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], { cwd: root, env, stdio: 'ignore', timeout: 30000 });
  check(bootstrap.status === 0, 'Synthetic secure bootstrap failed.');
  const tenant = (await pool.query("INSERT INTO tenants(name,slug,timezone) VALUES($1,$2,'Africa/Nairobi') RETURNING id", [`Synthetic inpatient browser ${suffix}`, `inpatient-browser-${suffix}`])).rows[0].id;
  const facility = (await pool.query("INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic Inpatient Facility','Africa/Nairobi',$3::jsonb) RETURNING id", [tenant, `BR-IP-${suffix}`, JSON.stringify(['registration', 'inpatient', 'finance'])])).rows[0].id;
  const passHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  const user = (await pool.query("INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic inpatient staff',$3,'ACTIVE',$4,$5) RETURNING id", [username, `${username}@example.test`, passHash, tenant, facility])).rows[0].id;
  const role = (await pool.query('INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id', [tenant, `IP_BROWSER_${suffix}`])).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  for (const code of ['patients.read', 'clinical.read', 'clinical.create', 'inpatient.read', 'inpatient.admit', 'inpatient.discharge', 'inpatient.wards.update', 'billing.read', 'billing.create', 'billing.update', 'billing.payments.record']) {
    await pool.query("INSERT INTO permissions(code,name,module) VALUES($1,$1,'inpatient') ON CONFLICT(code) DO NOTHING", [code]);
    await pool.query('INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2', [role, code]);
  }
  const patient = (await pool.query("INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Inpatient','2000-01-01','Other') RETURNING id", [tenant, facility, `IP-BR-${suffix}`])).rows[0].id;
  const ward = (await pool.query("INSERT INTO wards(facility_id,name,code,daily_rate) VALUES($1,'Synthetic inpatient ward',$2,NULL) RETURNING id", [facility, `IP-W-${suffix}`])).rows[0].id;
  const bed = (await pool.query("INSERT INTO beds(ward_id,bed_number,bed_type,status,daily_charge) VALUES($1,$2,'Standard','Available',$3) RETURNING id", [ward, `IP-B-${suffix}`, fixturePrice])).rows[0].id;
  const configuredPrice = (await pool.query('SELECT daily_charge,price_revision FROM beds WHERE id=$1', [bed])).rows[0];
  check(configuredPrice.daily_charge === fixturePrice && configuredPrice.price_revision > 0, 'Synthetic bed price was not persisted.');

  phase = 'server';
  server = spawn('node', ['build/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic server startup timed out.')), 20000);
    server.stdout.on('data', (part) => { output += part; if (output.includes('listening on')) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', () => {});
    server.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic server exited during startup.')); });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Readiness failed.');
  browser = await puppeteer.launch({ executablePath, headless: true,
    args: process.env.BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : ['--disable-dev-shm-usage'],
    env: Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])) });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  const click = async (text, selector = 'button') => {
    const result = await page.evaluate((label, rootSelector) => {
      const element = [...document.querySelectorAll(rootSelector)].find((item) => item.textContent?.trim() === label);
      if (!element || element.disabled) return false;
      element.click(); return true;
    }, text, selector);
    check(result, `Could not click ${text}.`);
  };
  const wait = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 25000 }, text);
  const setInput = (selector, value) => page.$eval(selector, (element, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

  phase = 'login';
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('aside')?.innerText.includes('Inpatient Management'), { timeout: 25000 });
  await click('Inpatient Management', 'aside button');
  await wait('Synthetic inpatient ward');

  phase = 'policy';
  await click('Bed-night billing policy — not configured', 'summary');
  await setInput('input[aria-label="Facility-local cutoff"]', '00:00');
  await setInput('input[aria-label="Discharge grace minutes"]', '0');
  await page.select('select[aria-label="Same-day stay rule"]', 'ONE');
  await page.select('select[aria-label="Policy active status"]', 'true');
  await setInput('input[aria-label="Policy effective from"]', '2020-01-01');
  await page.type('input[aria-label="Policy change reason"]', 'Synthetic approved policy');
  await click('Save policy');
  await wait('Bed policy saved for future admissions.');
  const policy = (await pool.query('SELECT id,revision,is_active,effective_from::text,same_day_rule FROM inpatient_bed_billing_policies WHERE tenant_id=$1 AND facility_id=$2', [tenant, facility])).rows[0];
  check(policy?.is_active === true && policy.effective_from === '2020-01-01' && policy.same_day_rule === 'ONE', 'Synthetic policy was not persisted.');

  phase = 'admission';
  await click('Admit Patient to Ward');
  await wait('Inpatient Admission Workflow');
  await wait('An active facility-wide policy applies');
  await page.select('#inpatient-patient', String(patient));
  await page.select('#inpatient-admission-type', 'Elective');
  await page.type('input[placeholder="Enter the working diagnosis"]', 'Synthetic diagnosis');
  await click('Confirm Admission');
  await wait('Bed billing evidence was captured');
  const admission = (await pool.query(`SELECT a.id,a.encounter_id,e.encounter_type,s.policy_id,s.policy_revision,s.policy_applicability,
    o.daily_rate_snapshot,o.price_revision_snapshot FROM admissions a JOIN encounters e ON e.id=a.encounter_id
    JOIN inpatient_bed_stay_snapshots s ON s.admission_id=a.id JOIN inpatient_bed_occupancies o ON o.admission_id=a.id
    WHERE a.tenant_id=$1 AND a.facility_id=$2 AND a.patient_id=$3 AND a.bed_id=$4 AND a.status='Admitted'`, [tenant, facility, patient, bed])).rows;
  check(admission.length === 1 && admission[0].encounter_type === 'INPATIENT' && admission[0].policy_id === policy.id && admission[0].policy_revision === policy.revision && admission[0].policy_applicability === 'APPLICABLE' && admission[0].daily_rate_snapshot === configuredPrice.daily_charge && admission[0].price_revision_snapshot === configuredPrice.price_revision, 'Admission policy, encounter or price evidence did not persist.');

  phase = 'discharge';
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Discharge'), { timeout: 25000 });
  await click('Discharge');
  await wait('Inpatient Clinical Discharge & Clearance');
  await page.select('div.fixed select', 'Routine Discharge (Recovered / Improved)');
  await page.type('textarea[placeholder="Clinical course during stay, discharge medications, follow-up dates..."]', 'Synthetic discharge summary');
  await click('Authorize Discharge & Free Bed');
  await wait('1 night(s) added to the invoice');
  const lines = (await pool.query(`SELECT bi.invoice_id,bi.quantity,bi.unit_price,bi.total_amount,bi.bed_occupancy_id,bi.bed_night_id,i.invoice_number,i.patient_id,i.encounter_id
    FROM billing_items bi JOIN billing_invoices i ON i.id=bi.invoice_id WHERE bi.source_type='BED_DAY' AND bi.source_id=$1`, [admission[0].id])).rows;
  check(lines.length === 1 && lines[0].quantity === 1 && lines[0].unit_price === configuredPrice.daily_charge && lines[0].total_amount === configuredPrice.daily_charge && lines[0].patient_id === patient && lines[0].encounter_id === admission[0].encounter_id && lines[0].bed_occupancy_id && lines[0].bed_night_id, 'Expected one traceable bed-price invoice line.');
  const bedState = (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [bed])).rows[0];
  check(bedState.status === 'Cleaning' && bedState.current_patient_id === null, 'Bed was not placed in Cleaning.');

  phase = 'cashier';
  await click('Billing & Invoicing', 'aside button');
  await wait('Patient Billing, Cashier POS & Receipts');
  await wait(lines[0].invoice_number);
  await click('Accept Payment (M-Pesa / Cash)');
  await wait('Hospital Cashier Payment Processing');
  await click('Cash', 'div.fixed button');
  await page.select('div.fixed select', 'PATIENT');
  await click('Confirm Payment & Issue Receipt', 'div.fixed button');
  await page.waitForFunction(() => !document.querySelector('div.fixed'), { timeout: 25000 });
  const payments = (await pool.query(`SELECT p.invoice_id,p.amount,p.receipt_number,p.payment_method,a.party FROM billing_payments p
    JOIN billing_payment_attributions a ON a.payment_id=p.id WHERE p.invoice_id=$1`, [lines[0].invoice_id])).rows;
  check(payments.length === 1 && payments[0].amount === configuredPrice.daily_charge && payments[0].payment_method === 'Cash' && payments[0].party === 'PATIENT' && payments[0].receipt_number, 'Synthetic cashier receipt and attribution did not persist.');
  check((await pool.query('SELECT paid_amount,balance_amount,status FROM billing_invoices WHERE id=$1', [lines[0].invoice_id])).rows[0].status === 'Paid', 'Synthetic invoice did not settle.');
  check(pageErrors.length === 0, 'Browser encountered a JavaScript error.');
  console.log('Synthetic Chromium policy, inpatient admission, configured bed price, discharge, invoice, cash attribution and receipt: PASS');
  console.log('Synthetic configured bed charge: KES ' + configuredPrice.daily_charge + '; no real facility or patient was accessed.');
} catch (error) {
  console.error(`Synthetic inpatient browser failed during ${phase}: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise((resolve) => server.once('exit', resolve)); }
  await pool.end();
}
