/** Additive synthetic Chromium acceptance of the existing Accounting workspace. No providers or real records. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import {
  assertSyntheticTarget,
  assertSyntheticDatabaseIdentity,
} from '../src/tests/vitest/support/synthetic-db-identity.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  process.env.NODE_ENV === 'production' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)
)
  throw new Error(
    'Explicit disposable synthetic authorization and loopback development server required.',
  );
const target = {
  host: process.env.SQL_HOST ?? '',
  name: process.env.SQL_DB_NAME ?? '',
  containerClusterIdentifier: process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER,
};
assertSyntheticTarget(target);
const sql = new pg.Client({
  host: target.host,
  port: Number(process.env.SQL_PORT),
  database: target.name,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
});
await sql.connect();
assertSyntheticDatabaseIdentity(
  target,
  (
    await sql.query(
      'SELECT current_database() AS name,inet_server_addr()::text AS address,(pg_control_system()).system_identifier::text AS "clusterIdentifier"',
    )
  ).rows[0],
);
const fixture = (
  await sql.query(
    "SELECT u.facility_id FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.username='synthetic.finance' AND t.slug='jalicare-synthetic-training'",
  )
).rows[0];
if (!fixture)
  throw new Error(
    'Run the isolated synthetic workforce fixture with accounting/billing/export/bank read permissions first.',
  );
const facilityId = fixture.facility_id;
const dir = process.env.ACCOUNTING_EVIDENCE_DIR ?? 'docs/audits/accounting-workspace-evidence';
await mkdir(dir, { recursive: true });
const results = [],
  errors = [];
const check = (name, ok) => {
  results.push({ name, passed: Boolean(ok) });
  if (!ok) throw new Error(name);
  console.log('PASS ' + name);
};
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
});
const mainNav = 'nav[aria-label="Accounting & Finance navigation"]';
async function click(page, text, scope = 'body') {
  await page.waitForFunction(
    (text, scope) =>
      [...document.querySelectorAll(`${scope} button`)].some(
        (e) => e.offsetParent !== null && !e.disabled && e.textContent.trim() === text,
      ),
    {},
    text,
    scope,
  );
  await page.evaluate(
    (text, scope) =>
      [...document.querySelectorAll(`${scope} button`)]
        .find((e) => e.offsetParent !== null && !e.disabled && e.textContent.trim() === text)
        .click(),
    text,
    scope,
  );
}
async function text(page, value) {
  await page.waitForFunction((value) => document.body.innerText.includes(value), {}, value);
}
async function fill(page, label, value) {
  const element = await page.waitForFunction(
    (label) =>
      document.querySelector(`[aria-label="${label}"]`) ??
      [...document.querySelectorAll('label')]
        .find((e) => e.textContent.trim().startsWith(label))
        ?.querySelector('input,select,textarea'),
    {},
    label,
  );
  const el = element.asElement();
  const type = await el.evaluate((e) => (e.tagName === 'SELECT' ? 'select' : e.type));
  if (type === 'select') await el.select(value);
  else if (type === 'date')
    await el.evaluate((e, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  else {
    await el.focus();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await el.type(value);
  }
  await element.dispose();
}
async function shot(page, name) {
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((e) => e.textContent.trim() === 'Dismiss')
      ?.click();
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo(0, 0);
  });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}
async function login(username, password) {
  if (!password) throw new Error('Synthetic test password required');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1600, height: 1050 });
  page.on('pageerror', (e) => {
    if (e.message !== 'WebSocket closed without opened.') errors.push(e.message);
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.type('input[name="identifier"]', username);
  await page.type('input[name="password"]', password);
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
  );
  await page.click('button[type="submit"]');
  const response = await pending;
  check(username + ' real login', response.ok());
  const data = await response.json();
  await page.waitForFunction(() => !document.querySelector('input[name="identifier"]'));
  return { page, token: data.sessionToken };
}
function response(page, suffix, method = 'POST') {
  return page.waitForResponse(
    (r) => r.url().split('?')[0].endsWith(suffix) && r.request().method() === method,
  );
}
async function absent(page, content) {
  return page.evaluate((content) => !document.body.innerText.includes(content), content);
}
let stage = 'login';
try {
  const { page, token } = await login('synthetic.finance', process.env.SYNTH_FINANCE_PASSWORD);
  await click(page, 'Accounting & Finance', 'nav');
  await text(page, 'Accounting Dashboard');
  await text(page, 'Posted revenue');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading posted accounting overview'),
  );
  check(
    'Dashboard has eight distinct workspace destinations',
    await page.$$eval(`${mainNav} button`, (buttons) => buttons.length === 8),
  );
  check(
    'Dashboard does not mount billing review or setup forms',
    (await absent(page, 'Review first page')) &&
      (await page.$('[aria-label="Account code"]')) === null,
  );
  const suffix = randomUUID().slice(0, 8);
  const ids = [];
  const nextYear =
    Number(
      (
        await sql.query(
          'SELECT extract(year from max(end_date)) AS year FROM financial_periods WHERE facility_id=$1',
          [facilityId],
        )
      ).rows[0].year,
    ) + 1;
  const existing = await (
    await fetch(
      `${base}/api/accounting/overview?facilityId=${facilityId}&startDate=${new Date().getUTCFullYear()}-01-01&endDate=${new Date().toISOString().slice(0, 10)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json();
  const cents = (value) => BigInt(value.replace('.', ''));
  const money = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  const expectedRevenue = money(cents(existing.profitAndLoss.postedRevenueKes) + 1425n);
  const expectedAssets = money(cents(existing.balanceSheet.assetsKes) + 1425n);
  stage = 'chart';
  await click(page, 'Accounting Setup', mainNav);
  await text(page, 'Chart of Accounts');
  for (const [code, name, type] of [
    [`AS${suffix}`, 'Synthetic workspace cash', 'ASSET'],
    [`RV${suffix}`, 'Synthetic workspace revenue', 'REVENUE'],
  ]) {
    await fill(page, 'Account code', code);
    await fill(page, 'Account name', name);
    await fill(page, 'Account subtype', 'SYNTHETIC');
    await fill(page, 'Account type', type);
    await fill(page, 'Normal balance', type === 'ASSET' ? 'DEBIT' : 'CREDIT');
    const pending = response(page, '/api/accounting/accounts');
    await click(page, 'Create account');
    const res = await pending;
    check(`Existing create-account workflow: ${type}`, res.status() === 201);
    ids.push((await res.json()).account.id);
    await text(page, code);
  }
  await shot(page, '02-chart-of-accounts.png');
  stage = 'period';
  await click(page, 'Financial Periods');
  await fill(page, 'Period code', `WS${suffix}`);
  await fill(page, 'Period name', 'Synthetic future workspace period');
  await fill(page, 'Start date', `${nextYear}-01-01`);
  await fill(page, 'End date', `${nextYear}-12-31`);
  let pending = response(page, '/api/accounting/periods');
  await click(page, 'Open period');
  let res = await pending;
  check('Existing open-period workflow', res.status() === 201);
  await text(page, `WS${suffix}`);
  await shot(page, '03-financial-periods.png');
  stage = 'journal';
  await click(page, 'General Ledger', mainNav);
  await fill(page, 'Entry date', '2026-10-27');
  await fill(page, 'Journal description', `Synthetic workspace journal ${suffix}`);
  await fill(page, 'Debit account', String(ids[0]));
  await fill(page, 'Credit account', String(ids[1]));
  await fill(page, 'Amount in KES', '14.25');
  pending = response(page, '/api/accounting/journals');
  await click(page, 'Post journal');
  res = await pending;
  check('Existing balanced manual journal posted through UI', res.status() === 201);
  const posted = await res.json();
  const journalId = posted.journal.id;
  await text(page, `Synthetic workspace journal ${suffix}`);
  await shot(page, '04-journal-entries.png');
  stage = 'reports';
  await click(page, 'Accounting Dashboard', mainNav);
  await text(page, `KES ${expectedRevenue}`);
  await shot(page, '01-accounting-dashboard.png');
  await click(page, 'Financial Reports', mainNav);
  await text(page, 'Debits KES');
  check(
    'Trial balance uses the posted journal',
    await page.evaluate(() => document.body.innerText.includes('14.25')),
  );
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob)
        void blob.text().then((text) => {
          window.__syntheticExportText = text;
        });
      return create(blob);
    };
  });
  const exported = response(page, '/api/accounting/trial-balance.csv', 'GET');
  await click(page, 'Export trial balance');
  res = await exported;
  await page.waitForFunction(() => typeof window.__syntheticExportText === 'string');
  const csv = await page.evaluate(() => window.__syntheticExportText);
  check('Existing trial-balance CSV export', res.ok() && csv.includes('14.25'));
  await click(page, 'Income Statement');
  await text(page, `Revenue KES ${expectedRevenue}`);
  check(
    'Posted income statement renders real journal-backed revenue',
    await absent(page, 'Add account'),
  );
  await shot(page, '05-income-statement.png');
  await click(page, 'Balance Sheet');
  await text(page, `Assets KES ${expectedAssets}`);
  check('Existing balance sheet reflects posted journal', true);
  stage = 'billing';
  await click(page, 'Billing & Revenue Accounting', mainNav);
  for (const [tab, button, endpoint] of [
    ['Billing Exceptions', 'Review first page', 'billing-ledger-review'],
    ['Source-to-Ledger Coverage', 'Check coverage', 'source-ledger-coverage'],
    ['Subledger Tie-out', 'Tie out as of end date', 'billing-gl-reconciliation'],
    ['Journal-Side Exceptions', 'Review journal sources', 'billing-journal-exceptions'],
  ]) {
    await click(page, tab);
    pending = response(page, `/api/accounting/${endpoint}`, 'GET');
    await click(page, button);
    res = await pending;
    check(`Existing billing diagnostic API: ${endpoint}`, res.ok());
  }
  await click(page, 'Receipt & Refund Settlement');
  await text(page, 'Receipt');
  check(
    'Settlement view retains recorded-receipt/provider evidence warning',
    await page.evaluate(() =>
      /not provider verification|not.*settlement|not.*bank/i.test(document.body.innerText),
    ),
  );
  await shot(page, '06-billing-settlement.png');
  await click(page, 'Reviewed Billing Posting');
  await text(page, 'Post reviewed');
  check('Reviewed billing posting controls remain available', true);
  stage = 'expenses';
  await click(page, 'Expenses & Payables', mainNav);
  await text(page, 'Expense review & payable posting');
  await text(page, 'No expense requests found on this page.');
  check('Existing expense review loads honest empty state', true);
  await shot(page, '07-expenses-payables.png');
  await click(page, 'Outstanding Payables');
  await text(page, 'not a verified unpaid balance');
  check('Outstanding payables limitation is explicit', true);
  stage = 'payroll';
  await click(page, 'Accounting Setup', mainNav);
  await click(page, 'Payroll Account Mapping');
  await text(page, 'BLOCKED');
  await text(page, 'Select an approved');
  check('Setup shows actual missing payroll mappings and statutory blockers', true);
  await shot(page, '08-payroll-mapping-blockers.png');
  await click(page, 'Open payroll account mappings');
  await text(page, 'Save mapping');
  check('Setup mapping link opens existing Payroll Ledger accounts tab', true);
  await text(page, 'Production sign-off not certified');
  await click(page, 'Accounting & Finance', 'nav');
  await click(page, 'Payroll Accounting', mainNav);
  const destinations = [
    ['Employee payroll', 'Salary employee'],
    ['Payroll periods', 'Payroll runs'],
    ['Statutory rules', 'Record version'],
    ['Payroll account mappings', 'Save mapping'],
    ['Payroll calculations', 'Payroll runs'],
    ['Payslips', 'Payroll runs'],
    ['Payroll accounting postings', 'Payroll runs'],
  ];
  for (const [label, expected] of destinations) {
    if (!(await page.$(mainNav))) {
      await click(page, 'Accounting & Finance', 'nav');
      await click(page, 'Payroll Accounting', mainNav);
    }
    await page.evaluate(
      (label) =>
        [...document.querySelectorAll('button')]
          .find((e) => e.textContent.trim().startsWith(label) && !e.disabled)
          .click(),
      label,
    );
    await text(page, expected);
    check(`Payroll destination: ${label}`, true);
  }
  stage = 'banking';
  await click(page, 'Accounting & Finance', 'nav');
  await click(page, 'Banking & Reconciliation', mainNav);
  await click(page, 'Open Bank Payments & Reconciliation');
  await page.waitForSelector('nav[aria-label="Bank workspace"]');
  await text(page, 'Controlled manual bank transfers only');
  check('Banking links to existing controlled manual reconciliation workspace', true);
  await shot(page, '09-existing-banking-workspace.png');
  stage = 'reversal';
  await click(page, 'Accounting & Finance', 'nav');
  await click(page, 'General Ledger', mainNav);
  await click(page, 'Controlled Reversals');
  await fill(page, 'Journal to reverse', String(journalId));
  await fill(page, 'Reversal date in an open period', '2026-10-28');
  await fill(page, 'Reversal reason', `Synthetic navigation correction ${suffix}`);
  pending = response(page, `/api/accounting/journals/${journalId}/reverse`);
  await click(page, 'Post reversal');
  res = await pending;
  check(
    'Existing controlled reversal posts without editing original journal',
    res.status() === 201 || res.status() === 200,
  );
  const journalCheck = await sql.query(
    'SELECT id,status,reversal_of_journal_id,total_debit_cents::text,total_credit_cents::text FROM journal_entries WHERE id=$1 OR reversal_of_journal_id=$1',
    [journalId],
  );
  check(
    'Database contains one original and one balanced reversal',
    journalCheck.rows.length === 2 &&
      journalCheck.rows.every(
        (j) => j.status === 'POSTED' && j.total_debit_cents === j.total_credit_cents,
      ),
  );
  stage = 'mobile';
  await page.setViewport({ width: 390, height: 844 });
  await page.select('select[aria-label="Accounting workspace"]', 'dashboard');
  await shot(page, '10-mobile-dashboard.png');
  await page.select('select[aria-label="Accounting workspace"]', 'setup');
  await shot(page, '11-mobile-accounting-setup.png');
  check(
    'Mobile navigation exposes all eight modules without horizontal document overflow',
    (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) &&
      (await page.$$eval(`${mainNav} select option`, (options) => options.length === 8)),
  );
  stage = 'readonly';
  const reader = await login('synthetic.hr', process.env.SYNTH_HR_PASSWORD);
  await click(reader.page, 'Accounting & Finance', 'nav');
  await text(reader.page, 'Accounting Dashboard');
  check(
    'Read-only role cannot see Billing & Revenue Accounting navigation',
    await reader.page.$$eval(
      `${mainNav} button`,
      (buttons) => !buttons.some((b) => b.textContent.includes('Billing & Revenue')),
    ),
  );
  await click(reader.page, 'Accounting Setup', mainNav);
  check(
    'Read-only role cannot create chart accounts',
    (await reader.page.$('[aria-label="Account code"]')) === null,
  );
  await click(reader.page, 'General Ledger', mainNav);
  check('Read-only role cannot post journals', await absent(reader.page, 'Post journal'));
  await click(reader.page, 'Controlled Reversals');
  check('Read-only role cannot reverse journals', await absent(reader.page, 'Post reversal'));
  await shot(reader.page, '12-read-only-permissions.png');
  const denied = await fetch(`${base}/api/accounting/journals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${reader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ facilityId, entryDate: '2026-10-27' }),
  });
  check('Read-only journal mutation rejected by existing API', denied.status === 403);
  check('No uncaught browser rendering errors', errors.length === 0);
  await writeFile(
    path.join(dir, 'browser-results.json'),
    JSON.stringify(
      {
        syntheticOnly: true,
        facilityId,
        journalId,
        results,
        errors,
        notice:
          'No live payments, provider calls, statutory filing or production-readiness claims.',
      },
      null,
      2,
    ),
  );
  console.log(`Accounting browser acceptance: ${results.length} assertions passed.`);
} catch (error) {
  console.error('Accounting browser failure at ' + stage + ': ' + error.message);
  await writeFile(path.join(dir, 'browser-failure.txt'), stage + ': ' + error.message);
  throw error;
} finally {
  await browser.close();
  await sql.end();
}
