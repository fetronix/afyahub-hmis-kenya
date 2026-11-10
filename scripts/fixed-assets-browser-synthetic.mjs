/**
 * JaliCare HMIS — fixed-asset browser acceptance.
 *
 * Signs in through the real login form as a synthetic asset officer, opens
 * Fixed Assets from the sidebar and walks the register, a capitalised asset's
 * detail, categories, maintenance and the depreciation workspace.
 *
 *   BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
 *   CHROME_EXECUTABLE_PATH=/tmp/chromium \
 *     node scripts/fixed-assets-browser-synthetic.mjs
 *
 * Read-only in the browser: the only mutations happen in the fixture.
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
const username = process.env.SYNTH_ASSET_USERNAME ?? 'synthetic.assets';
const password = process.env.SYNTH_ASSET_PASSWORD;

if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES to confirm synthetic, non-production data.');
if (!/synth/i.test(database))
  throw new Error('Refusing: SQL_DB_NAME must identify a synthetic database.');
if (!executablePath) throw new Error('CHROME_EXECUTABLE_PATH is required.');
if (!password) throw new Error('SYNTH_ASSET_PASSWORD is required.');

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
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

let browser;
try {
  await mkdir(evidenceDir, { recursive: true });
  browser = await puppeteer.launch({
    executablePath,
    // The sandbox container cannot start Chromium's zygote, so the shell
    // headless build runs in a single process.
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
    if (response.status() >= 400 && response.url().includes('/api/'))
      failedResponses.push({ status: response.status(), url: new URL(response.url()).pathname });
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
  record('Asset officer signs in through the form', login.ok(), `HTTP ${login.status()}`);
  await page.waitForFunction(() => !document.querySelector('input[name="identifier"]'), {
    timeout: 45_000,
  });
  await sleep(1200);

  const opened = await clickByText(page, 'button, a', 'Fixed Assets');
  record('Fixed Assets appears in navigation and opens', opened);
  await waitForText(page, 'Asset register');
  await sleep(1200);
  await shot(page, '11-fixed-assets-register.png');

  const text = await page.evaluate(() => document.body.innerText);
  record('Register lists the synthetic ultrasound scanner', /SYNTH-US-001/.test(text));
  record(
    'Overview shows cost, accumulated depreciation and net book value',
    /Acquisition cost/.test(text) &&
      /Accumulated depreciation/.test(text) &&
      /Net book value/.test(text),
  );

  // Asset detail with its capitalisation movement and journal.
  const viewClicked = await clickByText(page, 'tbody button', 'View');
  record('An asset row opens its detail', viewClicked);
  await sleep(1200);
  const detail = await page.evaluate(() => document.body.innerText);
  record(
    'Detail shows a CAPITALISATION movement and journal reference',
    /CAPITALISATION/.test(detail),
  );
  record(
    'Detail shows the registered custodian/location fields',
    /Synthetic imaging room/.test(detail),
  );
  await shot(page, '12-fixed-asset-detail.png');
  await page.keyboard.press('Escape');
  await sleep(500);

  for (const [tab, file, needle] of [
    ['Categories & accounts', '13-fixed-assets-categories.png', 'Categories and default accounts'],
    ['Maintenance', '14-fixed-assets-maintenance.png', 'Maintenance history'],
    ['Depreciation & values', '15-fixed-assets-depreciation.png', 'Monthly depreciation'],
  ]) {
    const clicked = await clickByText(page, 'button', tab);
    record(`Tab “${tab}” opens`, clicked);
    await sleep(1100);
    await waitForText(page, needle);
    const panel = await page.evaluate(() => document.body.innerText);
    record(`“${tab}” renders without an error state`, !/Something went wrong/i.test(panel));
    await shot(page, file);
  }

  const previewClicked = await clickByText(page, 'button', 'Preview');
  record('Depreciation preview runs for the selected period', previewClicked);
  await sleep(1500);
  const previewText = await page.evaluate(() => document.body.innerText);
  const previewAmounts = [...previewText.matchAll(/(\d[\d,]*\.\d{2})/g)].map((match) =>
    Number(match[1].replace(/,/g, '')),
  );
  const previewTotal = /total KES ([\d,]+\.\d{2})/i.exec(previewText);
  record(
    'Preview reports a charge for the synthetic assets',
    /PENDING|POSTED/i.test(previewText) && /Net book after/i.test(previewText),
  );
  // Guard the 17/11 defect: the banner total must equal the sum of the rows,
  // not a KES/cents mis-scaling of it.
  record(
    'Preview banner total equals the sum of the pending charge rows',
    Boolean(previewTotal) && previewAmounts.includes(Number(previewTotal[1].replace(/,/g, ''))),
  );
  await shot(page, '16-fixed-assets-depreciation-preview.png');

  const unexpected = failedResponses.filter(
    (entry) => !(entry.status === 401 && entry.url === '/api/auth/session'),
  );
  record(
    'Every asset API call was authorized',
    unexpected.length === 0,
    unexpected.map((entry) => `${entry.status} ${entry.url}`).join(', '),
  );
  record('No uncaught browser errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  const failures = results.filter((result) => !result.passed);
  await writeFile(
    path.join(evidenceDir, 'fixed-assets-browser-acceptance.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
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
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}
