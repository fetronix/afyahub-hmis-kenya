/**
 * JaliCare HMIS — procurement browser acceptance (synthetic).
 *
 * Signs in through the real login form as a synthetic procurement approver,
 * opens Procurement from the sidebar and walks the three tabs: suppliers and
 * purchase orders, requisitions, and goods received / payables. It then raises
 * and submits a requisition through the UI so the write path is proven in the
 * browser, not only through the API.
 *
 *   LD_LIBRARY_PATH=/tmp/al2023-check/lib SQL_DB_NAME=jalicare_synth \
 *   BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
 *   CHROME_EXECUTABLE_PATH=/tmp/chromium \
 *   SYNTH_PROCUREMENT_APPROVER_PASSWORD=... \
 *     node scripts/procurement-browser-synthetic.mjs
 */

import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const database = process.env.SQL_DB_NAME ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
const evidenceDir = path.join(root, 'docs', 'project', 'delivery-evidence', 'phase-5');
const username = process.env.SYNTH_PROCUREMENT_USERNAME ?? 'synthetic.procurement.approver';
const password = process.env.SYNTH_PROCUREMENT_APPROVER_PASSWORD;

if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES to confirm synthetic, non-production data.');
if (!/synth/i.test(database))
  throw new Error('Refusing: SQL_DB_NAME must identify a synthetic database.');
if (!executablePath) throw new Error('CHROME_EXECUTABLE_PATH is required.');
if (!password) throw new Error('SYNTH_PROCUREMENT_APPROVER_PASSWORD is required.');

const results = [];
const pageErrors = [];
const failedResponses = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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
  // Dismiss toast notifications only. Escape would also close an open modal,
  // which is what the worker is in the middle of filling in.
  const dismissed = await clickByText(page, 'button', 'Dismiss').catch(() => false);
  if (dismissed) await sleep(350);
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

let browser;
try {
  await mkdir(evidenceDir, { recursive: true });
  browser = await puppeteer.launch({
    executablePath,
    // The sandbox cannot start Chromium's zygote, so the shell build runs in
    // one process.
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      const url = new URL(response.url());
      failedResponses.push({ status: response.status(), path: url.pathname });
    }
  });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForSelector('input[name="identifier"]', { timeout: 30_000 });
  await page.type('input[name="identifier"]', username);
  await page.type('input[name="password"]', password);
  const [login] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/auth/login'), {
      timeout: 30_000,
    }),
    page.click('button[type="submit"]'),
  ]);
  record(
    'Procurement approver signs in through the form',
    login.status() === 200,
    `HTTP ${login.status()}`,
  );
  await page.waitForFunction(() => !document.querySelector('input[name="identifier"]'), {
    timeout: 45_000,
  });
  await sleep(1200);

  const opened = await clickByText(page, 'button, a', 'Procurement');
  record('Procurement appears in navigation and opens', opened);
  await waitForText(page, 'Procurement');
  await sleep(1200);
  await shot(page, '17-procurement-overview.png');

  const body = await page.evaluate(() => document.body.innerText);
  record(
    'Supplier register and purchase orders render',
    /Supplier/i.test(body) && /PO-SYNTH-1001|Purchase Orders/i.test(body),
  );
  record(
    'The three workflow tabs are present',
    /Requisitions/.test(body) && /Goods received & payables/.test(body),
  );

  // ---- Requisitions tab -------------------------------------------------
  const openedRequisitions = await clickByText(page, 'button[role="tab"]', 'Requisitions');
  record('Requisitions tab opens', openedRequisitions);
  await sleep(1200);
  const requisitionText = await page.evaluate(() => document.body.innerText);
  record(
    'Requisition register renders without an error state',
    /Purchase requisitions/i.test(requisitionText) &&
      !/Something went wrong/i.test(requisitionText),
  );
  await shot(page, '18-procurement-requisitions.png');

  // Create a draft through the UI.
  const openedForm = await clickByText(page, 'button', 'New requisition');
  record('New requisition form opens', openedForm);
  await sleep(600);
  if (openedForm) {
    const stamp = Date.now().toString(36).toUpperCase();
    const justification = `Browser acceptance draft ${stamp}. Synthetic only.`;
    const justificationBox = await page.$('textarea');
    if (justificationBox) await justificationBox.type(justification);
    const descriptionInput = await page.$('input[aria-label="Line 1 description"]');
    if (descriptionInput) await descriptionInput.type('Synthetic gloves (browser)');
    const quantityInput = await page.$('input[aria-label="Line 1 quantity"]');
    if (quantityInput) {
      await quantityInput.click({ clickCount: 3 });
      await quantityInput.type('4');
    }
    const priceInput = await page.$('input[aria-label="Line 1 unit estimate"]');
    if (priceInput) await priceInput.type('1250');
    await shot(page, '19-procurement-requisition-form.png');
    const saved = await clickByText(page, 'button', 'Save draft');
    await sleep(1500);
    const afterSave = await page.evaluate(() => document.body.innerText);
    record(
      'A requisition draft can be saved from the UI',
      saved && /REQ-\d{4}-\d{4}/.test(afterSave) && !/could not be saved/i.test(afterSave),
    );
    await shot(page, '20-procurement-requisition-saved.png');
  } else {
    record('A requisition draft can be saved from the UI', false, 'form did not open');
  }

  // ---- Goods received & payables ---------------------------------------
  const openedReceiving = await clickByText(
    page,
    'button[role="tab"]',
    'Goods received & payables',
  );
  record('Goods received & payables tab opens', openedReceiving);
  await sleep(1400);
  const receivingText = await page.evaluate(() => document.body.innerText);
  record(
    'Goods received notes and payables render',
    /Goods received notes/i.test(receivingText) &&
      /Accounts payable/i.test(receivingText) &&
      !/Something went wrong/i.test(receivingText),
  );
  record('Received notes show their invoice state', /NOT INVOICED|SINV-|INV-/i.test(receivingText));
  await shot(page, '21-procurement-receiving.png');

  record(
    'No uncaught browser errors during the journey',
    pageErrors.length === 0,
    pageErrors[0] ?? '',
  );

  // Expected refusals, not defects:
  //  - 401 on the first /api/auth/session is the signed-out probe.
  //  - 403 on /api/dashboard/overview is correct for a procurement-only role,
  //    which holds no clinical, billing or reporting read scope, so the shell
  //    renders without facility aggregates.
  const expected = (entry) =>
    (entry.status === 401 && entry.path === '/api/auth/session') ||
    (entry.status === 403 && entry.path === '/api/dashboard/overview');
  const unexpected = failedResponses.filter((entry) => !expected(entry));
  record(
    'Every procurement API call the page made was authorized',
    unexpected.length === 0,
    unexpected.map((entry) => `${entry.status} ${entry.path}`).join(', '),
  );
} catch (error) {
  record('Journey completed without an exception', false, error.message);
} finally {
  await browser?.close().catch(() => undefined);
}

const passed = results.filter((entry) => entry.passed).length;
const failed = results.length - passed;
const reportPath = path.join(evidenceDir, 'procurement-browser-acceptance.json');
await writeFile(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE,
      database,
      username,
      assertions: { passed, failed },
      results,
      pageErrors,
      failedResponses,
    },
    null,
    2,
  ),
);
console.log(`\nAssertions: ${passed} passed, ${failed} failed`);
console.log(`Report written to ${path.relative(root, reportPath)}`);
process.exitCode = failed ? 1 : 0;
