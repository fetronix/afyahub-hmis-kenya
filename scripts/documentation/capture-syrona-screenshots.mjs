/**
 * Syrona Medical Center HMIS — documentation screenshot capture harness.
 *
 * Drives the running application in Chromium against the synthetic training
 * database and writes each documentation figure to its published path. Every
 * capture is a real browser render of the live interface; nothing is drawn,
 * retouched or generated from a design file.
 *
 * Usage (loopback synthetic instance only):
 *   BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
 *   CHROME_EXECUTABLE_PATH=... node scripts/documentation/capture-syrona-screenshots.mjs
 *
 * DOCS_ONLY=<comma separated path fragments> captures a subset.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

const root = process.cwd();
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
const outputRoot = path.join(root, 'docs/documentation/assets/screenshots');
const only = (process.env.DOCS_ONLY ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES — synthetic data only.');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Loopback application required.');
if (!executablePath) throw new Error('CHROME_EXECUTABLE_PATH is required.');

const ACCOUNTS = {
  admin: { username: 'synthetic.admin', password: process.env.DOCS_ADMIN_PASSWORD ?? '' },
  finance: { username: 'synthetic.finance', password: process.env.DOCS_FINANCE_PASSWORD ?? '' },
  assets: { username: 'synthetic.assets', password: process.env.DOCS_ASSETS_PASSWORD ?? '' },
  inventory: { username: 'synthetic.inventory', password: process.env.DOCS_INVENTORY_PASSWORD ?? '' },
  procurement: {
    username: 'synthetic.procurement',
    password: process.env.DOCS_PROCUREMENT_PASSWORD ?? '',
  },
};

const chromium = (await import('@sparticuz/chromium')).default;
const browsers = new Map();
const sessions = new Map();

const launchBrowser = () =>
  puppeteer.launch({
    args: [...chromium.args, '--no-sandbox'],
    executablePath,
    headless: 'shell',
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

const clickText = async (page, selector, text) => {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    const value = await page.evaluate((node) => node.textContent?.trim() ?? '', handle);
    if (value === text || value.startsWith(text)) {
      await handle.evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await handle.click();
      return true;
    }
  }
  return false;
};

const nav = async (page, label) => {
  const selector = `aside button[title="${label}"]`;
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
  await page.click(selector);
  await sleep(1800);
};

const section = async (page, label) => {
  const clicked = await clickText(page, 'main button', label);
  if (!clicked) throw new Error(`Section button not found: ${label}`);
  await sleep(1600);
};

const tab = async (page, label) => {
  const clicked = await clickText(page, 'main [role="tab"]', label);
  if (!clicked) throw new Error(`Tab not found: ${label}`);
  await sleep(1500);
};

const openFirstRow = async (page) => {
  const opened = await page.evaluate(() => {
    const row = document.querySelector('main tbody tr');
    if (!row) return false;
    const button = row.querySelector('button');
    (button ?? row).click();
    return true;
  });
  if (!opened) throw new Error('No table row to open');
  await sleep(1500);
};

/**
 * Each account gets its own browser process: cookies and local storage are
 * shared between tabs, so one process per role keeps the sessions apart.
 */
const newPage = async (account) => {
  if (!browsers.has(account)) browsers.set(account, await launchBrowser());
  const page = await browsers.get(account).newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${base}/`, { waitUntil: 'networkidle2' });
  if (account === 'anonymous') {
    await page.waitForSelector('input[name="identifier"]', { timeout: 30000 });
    return page;
  }
  const credentials = ACCOUNTS[account];
  if (!credentials?.password) throw new Error(`Missing password for ${account}`);
  await page.waitForSelector('input[name="identifier"]', { timeout: 30000 });
  await page.type('input[name="identifier"]', credentials.username);
  await page.type('input[name="password"]', credentials.password);
  await Promise.all([
    page.waitForSelector('aside', { timeout: 45000 }),
    page.evaluate(() => document.querySelector('form button[type="submit"]')?.click()),
  ]);
  await sleep(2000);
  return page;
};

const session = async (account) => {
  if (!sessions.has(account)) sessions.set(account, await newPage(account));
  return sessions.get(account);
};

const olBrand = async (page) =>
  page.evaluate(() => (document.body.innerText.match(/jali\s*care/gi) ?? []).length);

const capture = async (target) => {
  if (only.length && !only.some((fragment) => target.path.includes(fragment))) return;
  let page;
  try {
    page = await session(target.account);
    await page.setViewport({ width: target.width, height: target.height, deviceScaleFactor: 1 });
    if (target.account !== 'anonymous') await page.goto(`${base}/`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    if (target.recipe) await target.recipe(page);
    const stale = await olBrand(page);
    if (stale) throw new Error(`Old brand text present: ${stale} match(es)`);
    if (target.fullPage) await page.evaluate(() => window.scrollTo(0, 0));
    const file = path.join(outputRoot, target.path);
    await mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: Boolean(target.fullPage) });
    results.push({ path: target.path, status: 'captured' });
    console.log(`CAPTURED  ${target.path}`);
  } catch (error) {
    results.push({ path: target.path, status: 'failed', message: String(error).slice(0, 200) });
    console.log(`FAILED    ${target.path} — ${String(error).slice(0, 160)}`);
  }
};

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

const openAccounting = async (page, label) => {
  await nav(page, 'Accounting & Finance');
  await section(page, label);
};

const TARGETS = [
  {
    path: '01-platform/01-login-screen.png',
    account: 'anonymous',
    width: 1440,
    height: 1016,
    recipe: async () => {},
  },
  {
    path: '01-platform/02-mobile-shell.png',
    account: 'admin',
    width: 390,
    height: 844,
    recipe: async () => {},
  },
  {
    path: '16-payroll/01-salary-components.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Payroll');
      await tab(page, 'Staff pay');
    },
  },
  {
    path: '16-payroll/02-calculated-review.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Payroll');
      await tab(page, 'Payroll runs');
      await clickText(page, 'main button', 'View');
      await sleep(1500);
    },
  },
  {
    path: '16-payroll/03-finalised-run.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Payroll');
      await tab(page, 'Payroll runs');
      await openFirstRow(page);
    },
  },
  {
    path: '16-payroll/05-ledger-mapping.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Payroll');
      await tab(page, 'Ledger accounts');
    },
  },
  {
    path: '18-accounting/01-accounting-dashboard.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Accounting Dashboard'),
  },
  {
    path: '18-accounting/02-chart-of-accounts.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Accounting Setup'),
  },
  {
    path: '18-accounting/03-financial-periods.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await openAccounting(page, 'Accounting Setup');
      await clickText(page, 'main button, main [role="tab"]', 'Periods');
      await sleep(1400);
    },
  },
  {
    path: '18-accounting/04-journal-entries.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'General Ledger'),
  },
  {
    path: '18-accounting/05-income-statement.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Financial Reports'),
  },
  {
    path: '18-accounting/06-billing-settlement.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Billing & Revenue Accounting'),
  },
  {
    path: '18-accounting/07-expenses-payables.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Expenses & Payables'),
  },
  {
    path: '18-accounting/08-payroll-mapping.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Payroll Accounting'),
  },
  {
    path: '18-accounting/09-banking-workspace.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => openAccounting(page, 'Banking & Reconciliation'),
  },
  {
    path: '20-fixed-assets/01-register.png',
    account: 'assets',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Fixed Assets');
      await tab(page, 'Asset register');
    },
  },
  {
    path: '20-fixed-assets/02-asset-detail.png',
    account: 'assets',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Fixed Assets');
      await tab(page, 'Asset register');
      await openFirstRow(page);
    },
  },
  {
    path: '20-fixed-assets/03-categories.png',
    account: 'assets',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Fixed Assets');
      await tab(page, 'Categories & accounts');
    },
  },
  {
    path: '20-fixed-assets/04-maintenance.png',
    account: 'assets',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Fixed Assets');
      await tab(page, 'Maintenance');
    },
  },
  {
    path: '20-fixed-assets/05-depreciation-preview.png',
    account: 'assets',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Fixed Assets');
      await tab(page, 'Depreciation runs');
    },
  },
  {
    path: '22-procurement/01-overview.png',
    account: 'procurement',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Procurement & POs');
      await tab(page, 'Suppliers & purchase orders');
    },
  },
  {
    path: '22-procurement/02-requisition-form.png',
    account: 'procurement',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Procurement & POs');
      await tab(page, 'Requisitions');
      await clickText(page, 'main button', 'New requisition');
      await sleep(1600);
    },
  },
  {
    path: '21-inventory/01-inventory-workspace.png',
    account: 'inventory',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Inventory & Batches');
      await tab(page, 'Stock Items');
    },
  },
  {
    path: '21-inventory/03-transfer.png',
    account: 'inventory',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Inventory & Batches');
      await tab(page, 'Stock Control');
    },
  },
  {
    path: '25-reporting/01-catalogue.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => nav(page, 'Reporting Centre'),
  },
  {
    path: '25-reporting/02-report-results.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Reporting Centre');
      const opened = await clickText(page, 'main button', 'Patient visits');
      if (!opened) await clickText(page, 'main button', 'Revenue');
      await sleep(2600);
    },
  },
  {
    path: '25-reporting/03-movement-workbench.png',
    account: 'admin',
    width: 1600,
    height: 1050,
    recipe: async (page) => {
      await nav(page, 'Reporting Centre');
      const opened = await clickText(page, 'main button', 'Stock movements');
      if (!opened) await clickText(page, 'main button', 'Inventory');
      await sleep(2600);
    },
  },
  {
    path: '25-reporting/04-movement-rows.png',
    account: 'admin',
    width: 1359,
    height: 420,
    fullPage: true,
    recipe: async (page) => {
      await nav(page, 'Reporting Centre');
      await clickText(page, 'main button', 'Stock movements');
      await sleep(2600);
    },
  },
  {
    path: '25-reporting/05-empty-result.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Reporting Centre');
      await clickText(page, 'main button', 'Stock movements');
      await sleep(2000);
      await page.evaluate(() => {
        const input = [...document.querySelectorAll('main input')].find((node) => node.type === 'date');
        if (input) input.value = '1999-01-01';
      });
      await sleep(1500);
    },
  },
  {
    path: '28-planning/01-planning-dashboard.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Accounting & Finance');
      await section(page, 'Budgeting & Financial Planning');
    },
  },
  {
    path: '28-planning/02-import-preview.png',
    account: 'finance',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Accounting & Finance');
      await section(page, 'Budgeting & Financial Planning');
      await clickText(page, 'main button', 'New annual plan');
      await sleep(2000);
    },
  },
  {
    path: '28-planning/03-issued-report.png',
    account: 'finance',
    width: 1600,
    height: 1050,
    recipe: async (page) => {
      await nav(page, 'Accounting & Finance');
      await section(page, 'Budgeting & Financial Planning');
      await clickText(page, 'main button', 'Annual Financial Budget');
      await sleep(2200);
    },
  },
  {
    path: '05-outpatient/02-encounter-doctor-a.png',
    account: 'admin',
    width: 974,
    height: 886,
    recipe: async (page) => {
      await nav(page, 'Outpatient Services');
      const opened = await clickText(page, 'main button', 'Margaret Njoroge');
      if (!opened) await clickText(page, 'main button', 'Joseph Mwangi');
      await sleep(2000);
      await clickText(page, 'main button', 'Start outpatient visit');
      await sleep(2600);
    },
  },
  {
    path: '05-outpatient/03-records-search.png',
    account: 'admin',
    width: 974,
    height: 1252,
    fullPage: true,
    recipe: async (page) => {
      await nav(page, 'Outpatient Services');
      await clickText(page, 'main button', 'Find another facility patient');
      await sleep(2200);
    },
  },
  {
    path: '27-audit/02-audit-events.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'Audit Trail & Security');
      await clickText(page, 'main button', 'Audit');
      await sleep(1400);
    },
  },
  {
    path: '26-configuration/03-letterhead-version.png',
    account: 'admin',
    width: 1440,
    height: 1000,
    recipe: async (page) => {
      await nav(page, 'System Configuration');
      await clickText(page, 'main button', 'Branding & Documents');
      await sleep(1600);
    },
  },
];

for (const target of TARGETS) await capture(target);

const summary = {
  when: new Date().toISOString(),
  base,
  captured: results.filter((row) => row.status === 'captured').length,
  failed: results.filter((row) => row.status === 'failed'),
  results,
};
await mkdir('docs/documentation', { recursive: true });
await writeFile('docs/documentation/screenshot-capture-run.json', JSON.stringify(summary, null, 1));
console.log(`\ncaptured ${summary.captured}/${results.length}`);
for (const openBrowser of browsers.values()) await openBrowser.close();
