/** Runs only against the isolated, in-memory demo, never an authenticated application. */
import puppeteer from 'puppeteer-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base = process.env.FINANCIAL_BUDGET_DEMO_URL ?? 'http://127.0.0.1:5180';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Loopback demo URL and explicit Chromium executable required.');
const output = 'docs/audits/financial-budget-evidence';
await mkdir(output, { recursive: true });
const downloads = path.resolve('.tmp-tools/financial-budget/downloads');
await mkdir(downloads, { recursive: true });
const checks: string[] = [],
  errors: string[] = [],
  blocked: string[] = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-zygote',
    '--single-process',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
let passed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1550, height: 1100 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (
      url.origin !== base ||
      ![
        '/',
        '/demo.js',
        '/style.css',
        '/fonts/inter-latin-wght-normal.woff2',
        '/favicon.ico',
      ].includes(url.pathname)
    ) {
      blocked.push(req.url());
      void req.abort();
    } else void req.continue();
  });
  const check = (value: boolean, label: string) => {
    if (!value) throw Error(label);
    checks.push(label);
    console.log('PASS', label);
  };
  const clickText = async (text: string) => {
    const clicked = await page.evaluate((value) => {
      const el = [...document.querySelectorAll('button')].find(
        (e) => e.textContent?.trim() === value,
      );
      if (!el) return false;
      el.click();
      return true;
    }, text);
    if (!clicked) throw Error('Button not found: ' + text);
  };
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="INC-01 Jan 2026: KES 18,200.00"]');
  check(
    (await page.$eval('thead tr', (el) => el.children.length)) === 16,
    'All 16 specified columns rendered',
  );
  check(
    (await page.$$eval('article', (els) => els.length)) === 5,
    'All five summary KPI cards rendered',
  );
  await page.screenshot({
    path: path.join(output, '01-annual-budget-desktop.png'),
    fullPage: true,
  });
  await page.click('[aria-label="INC-01 Jan 2026: KES 18,200.00"]');
  await page.locator('input[aria-label="INC-01 Jan 2026"]').fill('20000');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[aria-label="INC-01 Feb 2026: KES 30,000.00"]');
  check(
    !!(await page.$('[aria-label="INC-01 Jan 2026: KES 20,000.00 (manual override)"]')),
    'Inline Enter edit recalculates dependent month and marks override',
  );
  await page.click('[aria-label="Restore baseline INC-01 Jan 2026"]');
  await page.waitForSelector('[aria-label="INC-01 Jan 2026: KES 18,200.00"]');
  check(true, 'Override restoration recovers the baseline rule/value');
  const before = await page.$eval('thead tr', (el) => ({
    left: el.children[0].getBoundingClientRect().left,
    name: el.children[1].getBoundingClientRect().left,
    right: el.children[15].getBoundingClientRect().right,
  }));
  await page.$eval('[aria-label="Scrollable 12-month budget grid"]', (el) => {
    el.scrollLeft = 1000;
    el.scrollTop = 150;
  });
  const after = await page.$eval('thead tr', (el) => ({
    left: el.children[0].getBoundingClientRect().left,
    name: el.children[1].getBoundingClientRect().left,
    right: el.children[15].getBoundingClientRect().right,
  }));
  check(
    Math.abs(before.left - after.left) < 2 &&
      Math.abs(before.name - after.name) < 2 &&
      Math.abs(before.right - after.right) < 2,
    'Row code, name and annual total stay sticky during horizontal scrolling',
  );
  await page.$eval('[aria-label="Scrollable 12-month budget grid"]', (el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((e) =>
      e.textContent?.includes('Calculated Values View'),
    );
    label?.querySelector('input')?.click();
  });
  check(
    await page.$eval('table', (el) => el.textContent?.includes('=PREV+18200') ?? false),
    'Formula audit displays inert underlying rules',
  );
  await page.screenshot({ path: path.join(output, '02-formula-audit.png'), fullPage: true });
  await clickText('Add line item');
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] input[maxlength="160"]').fill('Browser custom service');
  await clickText('Save budget line');
  await page.waitForSelector('[aria-label="INC-X001 Jan 2026: KES 0.00"]');
  check(true, 'Custom line created through modal');
  await page.click('[aria-label="Delete INC-X001"]');
  await clickText('Delete custom line');
  await page.waitForSelector('[aria-label="Delete INC-X001"]', { hidden: true });
  check(true, 'Custom line deleted only after explicit confirmation');
  await clickText('Reset baseline');
  const disabled = await page.$$eval(
    '[role="dialog"] button',
    (els) =>
      (els.find((el) => el.textContent?.trim() === 'Confirm baseline reset') as HTMLButtonElement)
        ?.disabled,
  );
  check(disabled, 'Baseline reset is disabled until exact phrase and audit reason are supplied');
  await page.locator('[role="dialog"] input').fill('RESET FINANCIAL BASELINE');
  check(
    await page.$$eval(
      '[role="dialog"] button',
      (els) =>
        (els.find((el) => el.textContent?.trim() === 'Confirm baseline reset') as HTMLButtonElement)
          ?.disabled,
    ),
    'Exact phrase alone cannot bypass the reset audit reason',
  );
  await page
    .locator('[role="dialog"] textarea')
    .fill('Restore reviewed browser demonstration baseline');
  check(
    await page.$$eval(
      '[role="dialog"] button',
      (els) =>
        !(
          els.find((el) => el.textContent?.trim() === 'Confirm baseline reset') as HTMLButtonElement
        )?.disabled,
    ),
    'Reset enables only after complete confirmation',
  );
  await page.screenshot({
    path: path.join(output, '04-financial-reset-preview.png'),
    fullPage: true,
  });
  await clickText('Confirm baseline reset');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.waitForSelector('[aria-label="INC-01 Jan 2026: KES 18,200.00"]');
  check(true, 'Confirmed reset returns the in-memory demonstration to the baseline');
  const client = await browser.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
    eventsEnabled: true,
  });
  const download = async (name: string) => {
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Download timeout')), 10000);
      const listen = (e: { state: string }) => {
        if (e.state === 'completed') {
          clearTimeout(timer);
          client.off('Browser.downloadProgress', listen);
          resolve();
        }
      };
      client.on('Browser.downloadProgress', listen);
    });
    await clickText(name);
    await done;
  };
  await download('CSV');
  await download('Excel');
  const csv = await readFile(path.join(downloads, 'syrona-2026-demo.csv'), 'utf8'),
    xlsx = await readFile(path.join(downloads, 'syrona-2026-demo.xlsx'));
  check(
    csv.includes('OGD Colonoscopy') && csv.includes("'=PREV"),
    'CSV download contains the entire live audit table with formula protection',
  );
  check(xlsx.subarray(0, 2).toString() === 'PK', 'Excel download is a genuine XLSX workbook');
  await page.setViewport({ width: 390, height: 844 });
  await page.$eval('[aria-label="Scrollable 12-month budget grid"]', (el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({ path: path.join(output, '03-mobile-grid.png'), fullPage: true });
  check(
    await page.$eval('body', (el) => el.scrollWidth <= window.innerWidth + 2),
    'Mobile layout contains horizontal overflow inside the financial grid',
  );
  check(
    errors.length === 0 && blocked.length === 0,
    'No browser runtime errors or application/network API requests',
  );
  passed = true;
} finally {
  await browser.close();
  await writeFile(
    path.join(output, 'browser-results.json'),
    JSON.stringify(
      { syntheticDemoOnly: true, noApplicationApi: true, passed, checks, errors, blocked },
      null,
      2,
    ) + '\n',
  );
}
