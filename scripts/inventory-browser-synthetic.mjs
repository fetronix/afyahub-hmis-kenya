/**
 * JaliCare HMIS — inventory stock-control browser acceptance (synthetic).
 *
 * Signs in through the real login form as the synthetic stores officer, opens
 * Inventory → Stock Control and walks the ledger, adjustment, physical count,
 * transfer and replenishment views. It posts a real adjustment, opens a real
 * count and records a real transfer through the UI, so the write paths are
 * proven in the browser and not only through the API.
 *
 *   LD_LIBRARY_PATH=/tmp/al2023-check/lib SQL_DB_NAME=jalicare_synth \
 *   BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
 *   CHROME_EXECUTABLE_PATH=/tmp/chromium \
 *   SYNTH_INVENTORY_PASSWORD=... \
 *     node scripts/inventory-browser-synthetic.mjs
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
const username = process.env.SYNTH_INVENTORY_USERNAME ?? 'synthetic.inventory';
const password = process.env.SYNTH_INVENTORY_PASSWORD;

if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES to confirm synthetic, non-production data.');
if (!/synth/i.test(database))
  throw new Error('Refusing: SQL_DB_NAME must identify a synthetic database.');
if (!executablePath) throw new Error('CHROME_EXECUTABLE_PATH is required.');
if (!password) throw new Error('SYNTH_INVENTORY_PASSWORD is required.');

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
  const dismissed = await clickByText(page, 'button', 'Dismiss').catch(() => false);
  if (dismissed) await sleep(350);
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

/**
 * Set a React-controlled field the way a keyboard would.
 *
 * Assigning `element.value` directly updates React's internal value tracker,
 * so the synthetic event is discarded and the component's state never changes.
 * Calling the native prototype setter first keeps React's tracker stale, which
 * is what makes the dispatched input event behave like real typing.
 */
async function setValue(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 10_000 });
  await page.$eval(
    selector,
    (element, next) => {
      const prototype =
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, next);
      else element.value = next;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

let browser;
try {
  await mkdir(evidenceDir, { recursive: true });
  browser = await puppeteer.launch({
    executablePath,
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
    'The stores officer signs in through the form',
    login.status() === 200,
    `HTTP ${login.status()}`,
  );
  await page.waitForFunction(() => !document.querySelector('input[name="identifier"]'), {
    timeout: 45_000,
  });
  await sleep(1200);

  const openedInventory = await clickByText(page, 'button, a', 'Inventory');
  record('Inventory appears in navigation and opens', openedInventory);
  await sleep(1500);

  const inventoryBody = await page.evaluate(() => document.body.innerText);
  record(
    'The inventory register renders with its existing tabs',
    /Stock Items/i.test(inventoryBody) && /Batches & Expiry/i.test(inventoryBody),
  );
  record('The stock control tab is present', /Stock Control/i.test(inventoryBody));

  const openedControl = await clickByText(page, 'button[role="tab"]', 'Stock Control');
  record('Stock Control tab opens', openedControl);
  await sleep(1800);

  const controlBody = await page.evaluate(() => document.body.innerText);
  record(
    'Stock value, reorder alerts and the ledger render',
    /Stock value at batch cost/i.test(controlBody) &&
      /Reorder alerts/i.test(controlBody) &&
      /Ledger entries loaded/i.test(controlBody) &&
      !/Something went wrong/i.test(controlBody),
  );
  record(
    'The ledger shows receipt, adjustment or dispensing evidence',
    /RECEIPT|ADJUSTMENT|DISPENSE|COUNT VARIANCE/i.test(controlBody),
  );
  await shot(page, '22-inventory-stock-control.png');

  // ---- Adjustment through the UI ---------------------------------------
  const openedAdjustments = await clickByText(page, 'button[role="tab"]', 'Adjustments');
  record('Adjustments view opens', openedAdjustments);
  await sleep(900);
  await setValue(
    page,
    '#stock-adjust-item',
    await page.$eval('#stock-adjust-item', (el) => {
      const option = [...el.options].find((entry) =>
        entry.textContent?.includes('SYNTH-CTRL-SYRINGE'),
      );
      return option ? option.value : '';
    }),
  );
  await setValue(page, '#stock-adjust-direction', 'DECREASE');
  await setValue(page, '#stock-adjust-quantity', '1');
  await setValue(page, '#stock-adjust-reason', 'DATA_ENTRY');
  await setValue(page, '#stock-adjust-notes', 'Synthetic browser acceptance adjustment.');
  await shot(page, '23-inventory-adjustment-form.png');
  const postedAdjustment = await clickByText(page, 'button', 'Post adjustment');
  await sleep(1800);
  const afterAdjustment = await page.evaluate(() => document.body.innerText);
  record(
    'An adjustment can be posted from the UI and explains the new balance',
    postedAdjustment && /Stock adjusted/i.test(afterAdjustment),
    postedAdjustment ? '' : 'submit button not found',
  );
  await shot(page, '24-inventory-adjustment-posted.png');

  // ---- Physical count through the UI ------------------------------------
  const openedCounts = await clickByText(page, 'button[role="tab"]', 'Physical counts');
  record('Physical counts view opens', openedCounts);
  await sleep(900);
  const countNumber = `COUNT-BROWSER-${Date.now().toString(36).toUpperCase()}`;
  await setValue(page, '#stock-count-number', countNumber);
  const openedCount = await clickByText(page, 'button', 'Open count');
  await sleep(1800);
  const afterCount = await page.evaluate(() => document.body.innerText);
  record(
    'A physical count can be opened from the UI',
    openedCount && afterCount.includes(countNumber) && /OPEN/.test(afterCount),
    openedCount ? countNumber : 'open button not found',
  );
  await shot(page, '25-inventory-count.png');

  // ---- Transfer through the UI ------------------------------------------
  const openedTransfers = await clickByText(page, 'button[role="tab"]', 'Store transfers');
  record('Store transfers view opens', openedTransfers);
  await sleep(900);
  const transferNumber = `TRF-BROWSER-${Date.now().toString(36).toUpperCase()}`;
  await setValue(page, '#stock-transfer-number', transferNumber);
  await setValue(
    page,
    '#stock-transfer-item',
    await page.$eval('#stock-transfer-item', (el) => {
      const option = [...el.options].find((entry) =>
        entry.textContent?.includes('SYNTH-CTRL-SYRINGE'),
      );
      return option ? option.value : '';
    }),
  );
  await setValue(page, '#stock-transfer-quantity', '2');
  const postedTransfer = await clickByText(page, 'button', 'Record transfer');
  await sleep(1800);
  const afterTransfer = await page.evaluate(() => document.body.innerText);
  record(
    'A store transfer can be recorded from the UI',
    postedTransfer &&
      /Transfer recorded/i.test(afterTransfer) &&
      afterTransfer.includes(transferNumber),
    postedTransfer ? transferNumber : 'record button not found',
  );
  await shot(page, '26-inventory-transfer.png');

  // ---- Reorder and valuation -------------------------------------------
  const openedReplenishment = await clickByText(page, 'button[role="tab"]', 'Reorder & valuation');
  record('Reorder and valuation view opens', openedReplenishment);
  await sleep(1200);
  const replenishmentText = await page.evaluate(() => document.body.innerText);
  record(
    'Reorder alerts and stock valuation render',
    /Reorder alerts/i.test(replenishmentText) &&
      /Total valued at batch cost/i.test(replenishmentText) &&
      /KES/.test(replenishmentText),
  );
  await shot(page, '27-inventory-reorder-valuation.png');

  record(
    'No uncaught browser errors during the journey',
    pageErrors.length === 0,
    pageErrors[0] ?? '',
  );

  // Expected refusals, not defects: the signed-out session probe, and the
  // dashboard aggregate which this role holds no read scope for.
  const expected = (entry) =>
    (entry.status === 401 && entry.path === '/api/auth/session') ||
    (entry.status === 403 && entry.path === '/api/dashboard/overview');
  const unexpected = failedResponses.filter((entry) => !expected(entry));
  record(
    'Every inventory API call the page made was authorized',
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
const reportPath = path.join(evidenceDir, 'inventory-browser-acceptance.json');
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
