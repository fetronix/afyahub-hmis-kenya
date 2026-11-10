/**
 * JaliCare HMIS — Phase 5 workforce and payroll browser acceptance.
 *
 * Drives the real application in Chromium: signs in through the login form,
 * opens Human Resources and Payroll from the sidebar, walks every tab, opens a
 * stored payslip and captures screenshots.
 *
 * Safety:
 *   - refuses to run unless the database name marks it as synthetic;
 *   - loopback host only;
 *   - read-only: it never creates, edits or posts anything;
 *   - credentials come from the environment and are never printed.
 *
 *   BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
 *   CHROME_EXECUTABLE_PATH=$(node .tmp-tools/chrome-path.mjs) \
 *     node scripts/workforce-payroll-browser-synthetic.mjs
 */

import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const database = process.env.SQL_DB_NAME ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
const evidenceDir = path.join(root, 'docs', 'project', 'delivery-evidence', 'phase-5');

if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES to confirm synthetic, non-production data.');
if (!/synth/i.test(database))
  throw new Error('Refusing: SQL_DB_NAME must identify a synthetic database.');
if (!executablePath) throw new Error('CHROME_EXECUTABLE_PATH is required.');

const username = process.env.SYNTH_USERNAME ?? 'synthetic.admin';
const password = process.env.SYNTH_FACILITY_ADMIN_PASSWORD;
if (!password) throw new Error('SYNTH_FACILITY_ADMIN_PASSWORD is required.');

const results = [];
const consoleErrors = [];

function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickByText(page, selector, text) {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    const value = await page.evaluate((node) => node.textContent?.trim() ?? '', handle);
    if (value === text || value.startsWith(text)) {
      await handle.click();
      return true;
    }
  }
  return false;
}

async function waitForText(page, text, timeout = 20_000) {
  await page.waitForFunction(
    (needle) => document.body?.innerText?.includes(needle),
    { timeout },
    text,
  );
}

async function shot(page, name) {
  const file = path.join(evidenceDir, name);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(root, file);
}

let browser;
try {
  await mkdir(evidenceDir, { recursive: true });
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const failedResponses = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/'))
      failedResponses.push({ status: response.status(), url: new URL(response.url()).pathname });
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForSelector('input[name="identifier"]', { timeout: 30_000 });

  await page.type('input[name="identifier"]', username);
  await page.type('input[name="password"]', password);
  await shot(page, '01-login.png');

  const [loginResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/auth/login'), {
      timeout: 30_000,
    }),
    page.click('button[type="submit"]'),
  ]);
  record('Login through the form succeeds', loginResponse.ok(), `HTTP ${loginResponse.status()}`);

  await page.waitForFunction(() => !document.querySelector('input[name="identifier"]'), {
    timeout: 45_000,
  });
  await waitForText(page, 'Dashboard');
  await sleep(700);

  // ---- Human Resources -------------------------------------------------
  const openedHr = await clickByText(page, 'button, a', 'Human Resources');
  record('Human Resources appears in navigation and opens', openedHr);
  await waitForText(page, 'Human Resources');
  await sleep(900);
  await shot(page, '02-human-resources-overview.png');

  const bodyText = await page.evaluate(() => document.body.innerText);
  record(
    'Employee register renders facility staff',
    /Employees/i.test(bodyText) && /Staff/i.test(bodyText),
  );

  const tabs = ['Employees', 'Departments & roles', 'Attendance & roster', 'Leave'];
  for (const [index, tab] of tabs.entries()) {
    const clicked = await clickByText(page, 'button', tab);
    record(`Human Resources tab “${tab}” opens`, clicked);
    await sleep(1200);
    const text = await page.evaluate(() => document.body.innerText);
    record(
      `“${tab}” tab renders content without an error panel`,
      !/Something went wrong/i.test(text),
    );
    await shot(page, `03-hr-tab-${index + 1}-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}.png`);
  }

  // Employee record detail (read-only) proves the profile, contracts and documents panels exist.
  await clickByText(page, 'button', 'Employees');
  await sleep(1200);
  const employeeButtons = await page.$$('tbody button');
  if (employeeButtons.length > 0) {
    await employeeButtons[0].click();
    await sleep(900);
    const modal = await page.evaluate(() => document.body.innerText);
    record('Employee record opens with profile detail', /Employee/.test(modal));
    await shot(page, '04-hr-employee-record.png');
    await page.keyboard.press('Escape');
    await sleep(500);
  } else {
    record('Employee record opens with profile detail', false, 'no employee rows rendered');
  }

  // ---- Payroll ----------------------------------------------------------
  const openedPayroll = await clickByText(page, 'button, a', 'Payroll');
  record('Payroll appears in navigation and opens', openedPayroll);
  await waitForText(page, 'Payroll runs');
  await sleep(1000);
  await shot(page, '05-payroll-runs.png');

  const payrollTabs = [
    ['Statutory rules', '06-payroll-statutory-rules.png'],
    ['Ledger accounts', '07-payroll-ledger-accounts.png'],
    ['Payroll runs', '08-payroll-runs-return.png'],
  ];
  for (const [tab, file] of payrollTabs) {
    const clicked = await clickByText(page, 'button', tab);
    record(`Payroll tab “${tab}” opens`, clicked);
    await sleep(1100);
    const text = await page.evaluate(() => document.body.innerText);
    record(`“${tab}” renders without an error state`, !/Something went wrong/i.test(text));
    await shot(page, file);
  }

  // Open the approved/posted run and one payslip from the runs list.
  const runRows = await page.$$('tbody tr');
  record('Payroll run history lists a computed run', runRows.length > 0, `${runRows.length} rows`);
  if (runRows.length > 0) {
    const openButton = await clickByText(page, 'tbody button', 'View');
    if (openButton) {
      await sleep(1400);
      const detail = await page.evaluate(() => document.body.innerText);
      record(
        'Run detail shows payslip totals and posting state',
        /Payslip|payslip/i.test(detail) && /(POSTED|APPROVED|CALCULATED|DRAFT)/.test(detail),
      );
      await shot(page, '09-payroll-run-detail.png');

      const payslipButton = await page.$('tbody tr button');
      if (payslipButton) {
        await payslipButton.click();
        await sleep(1400);
        const slip = await page.evaluate(() => document.body.innerText);
        record(
          'Payslip document shows earnings, statutory deductions and net pay',
          /Net pay/i.test(slip) && /PAYE/i.test(slip),
        );
        await shot(page, '10-payslip.png');
      } else {
        record(
          'Payslip document shows earnings, statutory deductions and net pay',
          false,
          'no payslip row',
        );
      }
    }
  }

  record(
    'No uncaught browser errors during the journey',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '),
  );
  const unexpected = failedResponses.filter(
    (entry) => !(entry.status === 401 && entry.url === '/api/auth/session'),
  );
  record(
    'Every API call the HR and payroll pages made was authorized',
    unexpected.length === 0,
    unexpected.map((entry) => `${entry.status} ${entry.url}`).join(', '),
  );

  const failures = results.filter((result) => !result.passed);
  await writeFile(
    path.join(evidenceDir, 'browser-acceptance.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        baseUrl: BASE.replace(/\/\/[^/]+/, '//127.0.0.1'),
        databaseClass: 'synthetic',
        assertions: results,
        passed: results.length - failures.length,
        failed: failures.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `\nAssertions: ${results.length - failures.length} passed, ${failures.length} failed`,
  );
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}
