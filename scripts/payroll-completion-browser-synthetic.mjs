/** Real Chromium + HTTP acceptance; synthetic loopback database only. No rates here are authority publications. */
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
  throw new Error('Explicit synthetic browser authorization and loopback application required.');
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
const identity = (
  await sql.query(
    'SELECT current_database() AS name,inet_server_addr()::text AS address,(pg_control_system()).system_identifier::text AS "clusterIdentifier"',
  )
).rows[0];
assertSyntheticDatabaseIdentity(target, identity);
const fixture = (
  await sql.query(
    `SELECT u.facility_id FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.username='synthetic.admin' AND t.slug='jalicare-synthetic-training'`,
  )
).rows[0];
if (!fixture) throw new Error('Run the isolated synthetic workforce fixture first.');
const facilityId = fixture.facility_id;
const dir = process.env.PAYROLL_EVIDENCE_DIR ?? 'docs/audits/payroll-evidence';
await mkdir(dir, { recursive: true });
const results = [],
  errors = [];
const check = (name, passed) => {
  results.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(name);
  console.log(`PASS ${name}`);
};
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
});
async function pageFor(username, password) {
  if (!password) throw new Error('Synthetic password environment is required.');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.setDefaultTimeout(25000);
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
  check(`${username} real login`, response.ok());
  const data = await response.json();
  await page.waitForFunction(() => !document.querySelector('input[name="identifier"]'));
  return { page, token: data.sessionToken };
}
async function api(token, method, url, body) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `${method} ${url.split('?')[0]} returned ${response.status} (${data.error ?? 'unknown'})`,
    );
  return data;
}
async function click(page, text, scope = 'body') {
  await page.waitForFunction(
    (text, scope) =>
      [...document.querySelectorAll(`${scope} button`)].some(
        (e) => e.offsetParent !== null && e.textContent.trim() === text,
      ),
    {},
    text,
    scope,
  );
  await page.evaluate(
    (text, scope) => {
      const e = [...document.querySelectorAll(`${scope} button`)].find(
        (e) => e.offsetParent !== null && e.textContent.trim() === text,
      );
      e.click();
    },
    text,
    scope,
  );
}
async function fill(page, label, value, scope = 'body') {
  const handle = await page.waitForFunction(
    (label, scope) =>
      [...document.querySelectorAll(`${scope} label`)]
        .find((e) => e.textContent.trim().startsWith(label))
        ?.querySelector('input,select,textarea'),
    {},
    label,
    scope,
  );
  const element = handle.asElement();
  const type = await element.evaluate((e) => (e.tagName === 'SELECT' ? 'select' : e.type));
  if (type === 'select') {
    await element.select(value);
  } else if (type === 'date') {
    await element.evaluate((e, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, value);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  } else {
    await element.focus();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await element.type(value);
  }
  await handle.dispose();
}
async function text(page, value) {
  await page.waitForFunction((value) => document.body.innerText.includes(value), {}, value);
}
async function shot(page, name) {
  await page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
  await page.screenshot({ path: path.join(dir, name), fullPage: false });
}
try {
  const admin = await pageFor('synthetic.admin', process.env.SYNTH_FACILITY_ADMIN_PASSWORD);
  const finance = await pageFor('synthetic.finance', process.env.SYNTH_FINANCE_PASSWORD);
  const stamp = randomUUID().slice(0, 8);
  const employeeNumber = `SYN-BROWSER-${stamp}`;
  await click(admin.page, 'Human Resources', 'nav');
  await click(admin.page, 'Register employee');
  await fill(admin.page, 'Employee number', employeeNumber);
  await fill(admin.page, 'First name', 'Synthetic');
  await fill(admin.page, 'Last name', `Payroll ${stamp}`);
  await fill(admin.page, 'Hire date', '2026-01-01');
  await fill(admin.page, 'Monthly basic salary (KES)', '50000.00');
  const employeeResponse = admin.page.waitForResponse(
    (r) => r.url().endsWith('/api/hr/employees') && r.request().method() === 'POST',
  );
  await click(admin.page, 'Register employee', '[role="dialog"]');
  check('Employee created through HR form', (await employeeResponse).status() === 201);
  await admin.page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await shot(admin.page, '01-hr-employee.png');
  const employee = (
    await api(admin.token, 'GET', `/api/payroll/employees?facilityId=${facilityId}`)
  ).find((e) => e.employeeNumber === employeeNumber);
  check('Created staff visible through scoped payroll API', !!employee);
  await click(admin.page, 'Payroll', 'nav');
  await text(admin.page, 'Payroll runs');
  const existingPeriods = await api(
    admin.token,
    'GET',
    `/api/payroll/periods?facilityId=${facilityId}`,
  );
  const year = Math.max(2025, ...existingPeriods.map((p) => Number(p.payDate.slice(0, 4)))) + 1;
  await shot(admin.page, '02-payroll-navigation.png');
  await click(admin.page, 'Staff pay');
  await admin.page.waitForSelector(`option[value="${employee.id}"]`);
  await fill(admin.page, 'Salary employee', String(employee.id));
  await text(admin.page, 'Current basic salary: KES 50000.00');
  await fill(admin.page, 'Component code', `BONUS_${stamp.toUpperCase()}`);
  await fill(admin.page, 'Component name', 'Synthetic one-off bonus');
  await fill(admin.page, 'Component amount (KES)', '1000.00');
  await fill(admin.page, 'Component effective from', `${year}-10-01`);
  await fill(admin.page, 'Component effective to', `${year}-10-31`);
  const componentResponse = admin.page.waitForResponse(
    (r) => r.url().endsWith('/api/payroll/components') && r.request().method() === 'POST',
  );
  await click(admin.page, 'Add pay component');
  check('Dated earning created through Staff pay UI', (await componentResponse).status() === 201);
  await text(admin.page, 'Saved. Recalculate');
  await shot(admin.page, '03-salary-components.png');
  // API preconditions use arbitrary synthetic numbers, never a claimed current statutory rate sheet.
  const existingRules = await api(
    finance.token,
    'GET',
    `/api/payroll/statutory-versions?facilityId=${facilityId}`,
  );
  for (const statute of ['PAYE', 'NSSF', 'SHIF', 'AHL']) {
    if (
      existingRules.some(
        (v) =>
          v.statute === statute && v.status === 'ACTIVE' && v.authority === 'SYNTHETIC TEST ONLY',
      )
    )
      continue;
    const version = await api(finance.token, 'POST', '/api/payroll/statutory-versions', {
      facilityId,
      statute,
      label: `Synthetic arithmetic ${statute}`,
      effectiveFrom: '2026-01-01',
      authority: 'SYNTHETIC TEST ONLY',
      sourceReference: 'Synthetic arithmetic test, NOT an authority publication',
      calculationConfig: {
        deductNssf: true,
        deductShif: true,
        deductAhl: true,
        employeeMinimumCents: statute === 'SHIF' ? '100' : '0',
        employerMinimumCents: '0',
      },
      bands: [
        {
          lowerBoundCents: '0',
          upperBoundCents: null,
          employeeRateBp: statute === 'PAYE' ? 1000 : 100,
          employerRateBp: ['NSSF', 'AHL'].includes(statute) ? 100 : 0,
          reliefCents: '0',
        },
      ],
    });
    await api(finance.token, 'POST', `/api/payroll/statutory-versions/${version.id}/status`, {
      facilityId,
      status: 'ACTIVE',
    });
  }
  check('Four cited effective-dated synthetic statutory policies recorded through APIs', true);
  const fields = [
    'salaryExpenseAccountId',
    'employerCostAccountId',
    'netPayPayableAccountId',
    'payePayableAccountId',
    'nssfPayableAccountId',
    'shifPayableAccountId',
    'ahlPayableAccountId',
    'otherDeductionsPayableAccountId',
  ];
  const settings = { facilityId };
  for (let i = 0; i < fields.length; i++) {
    const created = await api(finance.token, 'POST', '/api/accounting/accounts', {
      facilityId,
      accountCode: `PR${i}-${stamp}`,
      accountName: `Synthetic payroll ${fields[i]}`,
      accountType: i < 2 ? 'EXPENSE' : 'LIABILITY',
      normalBalance: i < 2 ? 'DEBIT' : 'CREDIT',
      subType: 'PAYROLL',
    });
    settings[fields[i]] = created.account.id;
  }
  await api(finance.token, 'PUT', '/api/payroll/account-settings', settings);
  check('Facility payroll liability/expense mapping configured via API', true);
  const covered = (
    await sql.query(
      `SELECT 1 FROM financial_periods WHERE facility_id=$1 AND start_date<=$2::date AND end_date>=$2::date AND status='OPEN'`,
      [facilityId, `${year}-10-31`],
    )
  ).rowCount;
  if (!covered)
    await api(finance.token, 'POST', '/api/accounting/periods', {
      facilityId,
      periodCode: `SYN-${year}-${stamp}`,
      name: `Synthetic payroll ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
  await click(admin.page, 'Payroll runs');
  await click(admin.page, 'Refresh');
  await click(admin.page, 'New period');
  await fill(admin.page, 'Period name', `Synthetic October ${stamp}`);
  await fill(admin.page, 'Start', `${year}-10-01`, '[role="dialog"]');
  await fill(admin.page, 'End', `${year}-10-31`, '[role="dialog"]');
  await fill(admin.page, 'Pay date', `${year}-10-31`, '[role="dialog"]');
  const periodResponse = admin.page.waitForResponse(
    (r) => r.url().endsWith('/api/payroll/periods') && r.request().method() === 'POST',
  );
  await click(admin.page, 'Create period');
  check('Payroll period created through browser', (await periodResponse).status() === 201);
  await admin.page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const calculated = admin.page.waitForResponse(
    (r) => r.url().includes('/calculate') && r.request().method() === 'POST',
  );
  await click(admin.page, 'Calculate');
  const calcResponse = await calculated;
  check('Payroll calculated through browser', calcResponse.ok());
  const calc = await calcResponse.json();
  const runId = calc.runId;
  await text(admin.page, 'Payroll run —');
  await shot(admin.page, '04-calculated-review.png');
  const noApproval = await fetch(`${base}/api/payroll/runs/${runId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ facilityId }),
  });
  check('Preparer cannot approve via API', noApproval.status === 403);
  await click(finance.page, 'Payroll', 'nav');
  await text(finance.page, `Synthetic October ${stamp}`);
  const approved = finance.page.waitForResponse(
    (r) => r.url().endsWith(`/runs/${runId}/approve`) && r.request().method() === 'POST',
  );
  await click(finance.page, 'Approve');
  check('Independent authorized approval through browser', (await approved).ok());
  await finance.page.waitForSelector('[role="dialog"]');
  await click(finance.page, 'Close', '[role="dialog"]');
  const posted = finance.page.waitForResponse(
    (r) => r.url().endsWith(`/runs/${runId}/post`) && r.request().method() === 'POST',
  );
  await click(finance.page, 'Post to ledger');
  check('Authorized payroll finalization through browser', (await posted).ok());
  await text(finance.page, 'POSTED');
  await shot(finance.page, '05-finalized-payroll.png');
  await click(finance.page, 'Generate finalized reports & bulk payslips');
  await text(finance.page, 'NOT FILED · PAYMENT NOT EVIDENCED');
  await shot(finance.page, '06-review-schedules.png');
  await click(finance.page, 'View bulk payslips');
  await text(finance.page, 'Print all payslips');
  const reports = await api(
    finance.token,
    'GET',
    `/api/payroll/runs/${runId}/reports?facilityId=${facilityId}`,
  );
  check(
    'Bulk payslips and four remittance schedules reconcile',
    reports.payslips.length > 0 &&
      reports.remittances.length === 4 &&
      reports.bankSchedule.every((r) => r.paymentStatus === 'NOT_EVIDENCED' && !r.instructionReady),
  );
  await click(finance.page, 'Print all payslips');
  check(
    'Bulk print clones only individual payslips without application navigation',
    await finance.page.evaluate((count) => {
      const doc = document.querySelector('iframe[title="Payroll print preview"]')?.contentDocument;
      return (
        doc?.querySelectorAll('.payroll-page').length === count &&
        !doc.querySelector('nav') &&
        !doc.body.innerText.includes('Staff salary structures')
      );
    }, reports.payslips.length),
  );
  await finance.page.evaluate(() =>
    document.querySelectorAll('iframe[title="Payroll print preview"]').forEach((f) => f.remove()),
  );
  await click(finance.page, 'Payslip', '[role="dialog"]');
  await text(finance.page, 'Print payslip');
  await shot(finance.page, '07-individual-payslip.png');
  await click(finance.page, 'Print payslip');
  check(
    'Individual print contains the selected payslip, not the run or employee register',
    await finance.page.evaluate(() => {
      const doc = document.querySelector('iframe[title="Payroll print preview"]')?.contentDocument;
      return (
        !!doc?.querySelector('[id^="payslip-print-"]') &&
        !doc.querySelector('nav') &&
        !doc.body.innerText.includes('Staff salary structures') &&
        !doc.body.innerText.includes('Bank review schedule')
      );
    }),
  );
  await finance.page.evaluate(() =>
    document.querySelectorAll('iframe[title="Payroll print preview"]').forEach((f) => f.remove()),
  );
  await api(finance.token, 'POST', '/api/payroll/form-profiles', {
    facilityId,
    formCode: 'P9',
    formVersion: 'SYNTHETIC REVIEW ONLY',
    authorityReference: 'Synthetic internal extract fixture; not a real authority form',
    effectiveFrom: `${year}-01-01`,
    effectiveTo: `${year}-12-31`,
  });
  for (let i = 0; i < 2; i++)
    await finance.page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].at(-1);
      [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click();
    });
  await click(finance.page, 'History & annual reports');
  await text(finance.page, 'Payroll audit history & annual extracts');
  await fill(finance.page, 'Tax year', String(year));
  const extracted = finance.page.waitForResponse((r) =>
    r.url().includes('/api/payroll/statutory-extract?'),
  );
  await click(finance.page, 'Download annual extract');
  const extractResponse = await extracted;
  const extract = await extractResponse.json();
  check(
    'Annual review downloaded through browser with pay-date scope and no filing/payment claims',
    extractResponse.ok() &&
      extract.periodBasis === 'PAY_DATE' &&
      extract.filingStatus === 'NOT_FILED' &&
      extract.monthlyRows.every((r) => r.payDate.startsWith(String(year))),
  );
  await shot(finance.page, '08-history-annual-extract.png');
  const journals = (
    await sql.query(
      `SELECT count(*)::int AS n, max(total_debit_cents)::text AS debit,max(total_credit_cents)::text AS credit FROM journal_entries WHERE facility_id=$1 AND source_type='PAYROLL' AND source_id=$2`,
      [facilityId, String(runId)],
    )
  ).rows[0];
  check(
    'Exactly one balanced source-linked payroll journal',
    journals.n === 1 && journals.debit === journals.credit,
  );
  check('No uncaught browser rendering errors', errors.length === 0);
  await writeFile(
    path.join(dir, 'browser-results.json'),
    JSON.stringify({ syntheticOnly: true, runId, results, browserErrors: errors }, null, 2),
  );
  console.log(
    `Browser acceptance: ${results.length} assertions passed; no salaries paid or statutory returns filed.`,
  );
} catch (e) {
  await writeFile(
    path.join(dir, 'browser-results.json'),
    JSON.stringify(
      { syntheticOnly: true, results, browserErrors: errors, failure: e.message },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
  await sql.end();
}
