import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as XLSX from '@e965/xlsx';
if (process.env.BUDGET_BROWSER_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw new Error(
    'Requires BUDGET_BROWSER_SYNTHETIC=YES and CHROME_EXECUTABLE_PATH. Seed only a disposable database using seed-budget-planning-browser.ts.',
  );
const base = process.env.BUDGET_BROWSER_BASE_URL ?? 'http://127.0.0.1:4193';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  throw new Error('Synthetic browser verification requires a loopback server.');
const config = JSON.parse(await readFile('.tmp-tools/budget/browser-session.json', 'utf8'));
if (config.syntheticOnly !== true) throw new Error('Synthetic-only fixture required.');
const evidenceDir =
  process.env.BUDGET_BROWSER_EVIDENCE_DIR ?? 'docs/audits/budget-planning-evidence';
await mkdir(evidenceDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  args: JSON.parse(
    process.env.BUDGET_BROWSER_ARGS ??
      '["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]',
  ),
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
const errors = [],
  failures = [],
  checks = [];
let phase = 'login';
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400)
    failures.push({ phase, status: r.status(), path: new URL(r.url()).pathname });
});
const check = (v, msg) => {
  if (!v) throw new Error(msg);
  checks.push(msg);
  console.log('PASS', msg);
};
const click = async (text) => {
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === t && !b.disabled,
      ),
    {},
    text,
  );
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === t && !b.disabled,
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error('Button not found: ' + text);
};
const wait = async (text) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000 }, text);
const fill = async (label, value, select = false) => {
  await page.evaluate(
    (text, isSelect) => {
      document.querySelector('[data-browser-field]')?.removeAttribute('data-browser-field');
      const root = document.querySelector('[role="dialog"]') ?? document;
      const l = [...root.querySelectorAll('label')].find((l) =>
        l.textContent.trim().startsWith(text),
      );
      const el = l?.querySelector(isSelect ? 'select' : 'input');
      if (!el) throw new Error('Field not found: ' + text);
      el.setAttribute('data-browser-field', 'yes');
    },
    label,
    select,
  );
  if (select) await page.select('[data-browser-field]', String(value));
  else {
    await page.click('[data-browser-field]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (String(value)) await page.type('[data-browser-field]', String(value));
  }
};
const query = async (path) =>
  page.evaluate(async (path) => {
    const r = await fetch(path, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token') },
    });
    return { status: r.status, body: await r.json() };
  }, path);
const screenshot = async (name) =>
  page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
const removeRow = async (description) => {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('tr')].some((r) => r.innerText.includes(t)),
    {},
    description,
  );
  page.once('dialog', (d) => d.accept());
  await page.evaluate((t) => {
    const row = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(t));
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete').click();
  }, description);
};
try {
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="Username or Email"]', config.username);
  await page.type('input[placeholder="Password"]', config.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside nav');
  check(true, 'Real authenticated browser login');
  await click('Accounting & Finance');
  await wait('Accounting Dashboard');
  await click('Accounting Setup');
  await click('Budget & Procurement Planning');
  await wait('Annual known budget');
  await page.select('[aria-label="Active planning plan"]', String(config.planId));
  await wait('2026 Facility Procurement Projections');
  for (const [label, name, text] of [
    ['Planning Dashboard', '01-dashboard', 'Annual known budget'],
    ['Annual Plans', '02-annual-plans', 'Controlled plan lifecycle'],
    ['Stationery & Consumables', '03-items', 'Add item'],
    ['Staff Uniform Projections', '04-uniforms', 'Nursing uniforms'],
    ['Planning Periods', '05-periods', 'Controlled plan lifecycle'],
    ['CSV / Excel Import & History', '06-import', 'Planning workbook'],
    ['Reports', '07-reports', 'Issue a filtered planning report'],
    ['Audit History', '08-audit', 'Immutable planning audit trail'],
  ]) {
    await click(label);
    await wait(text);
    await screenshot(name);
    check(true, 'Section ' + label);
  }
  phase = 'item CRUD';
  await click('Stationery & Consumables');
  if (
    await page.evaluate(() =>
      [...document.querySelectorAll('tr')].some((r) =>
        r.innerText.includes('Browser reviewed item'),
      ),
    )
  ) {
    await removeRow('Browser reviewed item');
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('tr')].some((r) =>
          r.innerText.includes('Browser reviewed item'),
        ),
    );
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add item'),
  );
  await click('Add item');
  await wait('January quantity');
  await fill('Item description', 'Browser reviewed item');
  await fill('Unit', 'Box');
  await fill('Base unit price', '-1');
  for (const month of [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ])
    await fill(month + ' quantity', '2');
  await click('Save item');
  await wait('non-negative');
  check(true, 'Negative price rejected in browser without committing');
  await fill('Base unit price', '10.01');
  await click('Save item');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await wait('Browser reviewed item');
  check(true, 'Draft item created with twelve quantities');
  await fill('Monthly date', '2', true);
  await wait('1 months');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) =>
      r.innerText.includes('Browser reviewed item'),
    );
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
  });
  await wait('January quantity');
  check(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('[role="dialog"] label')]
          .find((l) => l.innerText.includes('December quantity'))
          .querySelector('input').value === '2.000',
    ),
    'Filtered edit loads all twelve months',
  );
  await fill('January quantity', '3');
  await click('Save item');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const saved = await query(
    `/api/budget-planning/plans/${config.planId}?facilityId=${config.facilityId}&search=Browser%20reviewed`,
  );
  check(
    saved.body.items[0].months.length === 12 &&
      saved.body.items[0].months[0].quantity === '3.000' &&
      saved.body.items[0].months[11].quantity === '2.000',
    'Filtered update preserves unselected months',
  );
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) =>
      r.innerText.includes('Browser reviewed item'),
    );
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Inline edit').click();
  });
  await wait('Inline base price');
  await page.waitForSelector('form[aria-label="Inline item editor"] fieldset:not([disabled])');
  await fill('Inline base price', '20');
  await wait('Live annual preview: 525.00');
  await screenshot('15-inline-live-preview');
  await click('Save inline changes');
  await page.waitForFunction(
    () => !document.querySelector('form[aria-label="Inline item editor"]'),
  );
  const inlineSaved = await query(
    `/api/budget-planning/plans/${config.planId}?facilityId=${config.facilityId}&search=Browser%20reviewed`,
  );
  check(
    inlineSaved.body.items[0].base_price_cents === '2000' &&
      inlineSaved.body.items[0].months.length === 12 &&
      inlineSaved.body.items[0].months[0].quantity === '3.000' &&
      inlineSaved.body.items[0].months[11].quantity === '2.000',
    'Inline price edit preserves all months under a month filter and refreshes totals',
  );
  await fill('Monthly date', '', true);
  await removeRow('Browser reviewed item');
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('tr')].some((r) =>
        r.innerText.includes('Browser reviewed item'),
      ),
  );
  check(true, 'Draft item soft removal');
  phase = 'uniform CRUD';
  await click('Staff Uniform Projections');
  await click('Add uniform projection');
  await fill('Uniform type', 'Browser reviewed uniform');
  await fill('Existing balance', '2');
  await fill('Balance reference period', 'December 2025');
  await fill('Buying cost', '1000');
  await fill('Projected staff count', '10');
  await fill('Uniform quantity per staff', '2');
  await fill('Staff contribution percentage', '50');
  await fill('Opening balance treatment', 'SUBTRACT', true);
  await click('Save uniform');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await wait('Browser reviewed uniform');
  const uniformData = await query(
    `/api/budget-planning/plans/${config.planId}?facilityId=${config.facilityId}&search=Browser%20reviewed%20uniform`,
  );
  check(
    uniformData.body.uniforms[0].total_cents === '900000',
    'Uniform authoritative opening balance and half-contribution calculation',
  );
  await removeRow('Browser reviewed uniform');
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('tr')].some((r) =>
        r.innerText.includes('Browser reviewed uniform'),
      ),
  );
  check(true, 'Draft uniform soft removal');
  phase = 'reports';
  await click('Reports');
  await click('Generate PDF and Excel report');
  await wait('letterhead v');
  check(true, 'Branded report generation');
  const reportRows = await query(
    `/api/budget-planning/plans/${config.planId}/reports?facilityId=${config.facilityId}`,
  );
  const reportId = reportRows.body[0].id;
  const download = await page.evaluate(
    async ({ id, facility }) => {
      const token = localStorage.getItem('jalicare_session_token');
      return await Promise.all(
        ['pdf', 'xlsx'].map(async (f) => {
          const r = await fetch(`/api/budget-planning/reports/${id}/${f}?facilityId=${facility}`, {
            headers: { Authorization: 'Bearer ' + token },
          });
          const b = new Uint8Array(await r.arrayBuffer());
          return {
            status: r.status,
            type: r.headers.get('content-type'),
            signature: [...b.slice(0, 5)],
          };
        }),
      );
    },
    { id: reportId, facility: config.facilityId },
  );
  check(
    download.every((r) => r.status === 200) &&
      download[0].signature[0] === 37 &&
      download[1].signature[0] === 80,
    'Authorized PDF and Excel downloads',
  );
  await screenshot('09-issued-report');
  phase = 'Excel production worker';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Description', 'Unit', 'Price', ...Array(12).fill('Quantity')],
      ['Browser imported workbook item ' + Date.now(), 'Box', 12, ...Array(12).fill(3)],
    ]),
    'Stationery',
  );
  const filename = `.tmp-tools/budget/browser-source-${Date.now()}.xls`;
  await writeFile(filename, XLSX.write(wb, { bookType: 'xls', type: 'buffer' }));
  await click('CSV / Excel Import & History');
  await (await page.$('input[type="file"]')).uploadFile(filename);
  await wait('Preview and field mappings');
  await fill('Draft plan name', 'Browser imported draft ' + Date.now());
  await fill('Import financial year', '2026');
  await click('Add source/category mapping block');
  await fill('Source category', 'OPD CONSUMABLES');
  await fill('First source row', '2');
  await fill('Last source row', '2');
  await fill('Description column', 'A');
  await fill('Base price column', 'C');
  await fill('Unit column', 'B');
  for (const [n, month] of [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ].entries())
    await fill(month + ' qty column', String.fromCharCode(68 + n));
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find((l) =>
      l.innerText.includes('Allow an additional separate draft'),
    );
    l.querySelector('input').click();
  });
  await click('Validate and preview import');
  await wait('1 valid rows; 0 errors');
  check(true, 'Production-bundled .xls worker and editable source mapping preview');
  await screenshot('10-import-preview');
  check(
    await page.$eval('button', () => {
      const b = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Confirm import',
      );
      return b.disabled;
    }),
    'Confirmation stays disabled until explicit review',
  );
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find((l) =>
      l.innerText.includes('I reviewed categories'),
    );
    l.querySelector('input').click();
  });
  await click('Confirm import');
  await wait('Import complete: 1 created');
  check(true, 'Explicit preview-confirm import through browser');
  await screenshot('11-import-complete');
  phase = 'CSV zero-fill duplicate import';
  const csvFile = `.tmp-tools/budget/browser-zero-fill-${Date.now()}.csv`;
  const duplicateLabel = `Browser CSV duplicate ${Date.now()}`;
  await writeFile(csvFile, `${duplicateLabel},,,-,0\r\n${duplicateLabel},,,0,-\r\n`);
  await (await page.$('input[type="file"]')).uploadFile(csvFile);
  await wait('Preview and field mappings');
  await fill('Draft plan name', 'Browser zero-fill draft ' + Date.now());
  await fill('Missing-value policy', 'ZERO_FILL', true);
  await click('Add source/category mapping block');
  await fill('Source category', 'Zero-fill section');
  await fill('First source row', '1');
  await fill('Last source row', '2');
  await fill('Description column', 'A');
  await fill('Base price column', 'C');
  await fill('Unit column', 'B');
  for (const [n, month] of [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ].entries())
    await fill(month + ' qty column', String.fromCharCode(68 + n));
  await click('Validate and preview import');
  await wait('2 valid rows; 0 errors');
  await wait('ZERO_FILL:');
  check(
    true,
    'CSV duplicate names and missing/dash inputs preview as two distinct zero-filled source rows',
  );
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('p')].find((p) =>
      p.textContent.includes('2 valid rows; 0 errors'),
    );
    target?.scrollIntoView({ block: 'start' });
  });
  await screenshot('14-zero-fill-preview');
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find((l) =>
      l.innerText.includes('I reviewed categories'),
    );
    l.querySelector('input').click();
  });
  await click('Confirm import');
  await wait('Import complete: 2 created');
  check(true, 'CSV zero-fill duplicate import explicitly confirmed through browser');
  phase = 'responsive';
  await page.setViewport({ width: 390, height: 844 });
  await click('Stationery & Consumables');
  await wait('Browser CSV duplicate');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((entry) =>
      entry.textContent.includes('Browser CSV duplicate'),
    );
    row?.scrollIntoView({ block: 'center' });
  });
  await screenshot('12-mobile-items');
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile layout has no document-level horizontal overflow',
  );
  check(errors.length === 0, 'No browser runtime errors');
  check(
    failures.every(
      (f) =>
        (f.phase === 'login' && f.status === 401 && f.path === '/api/auth/session') ||
        (f.phase === 'item CRUD' && f.status === 400 && f.path.endsWith('/items')),
    ),
    'Only expected unauthenticated-session and negative-input HTTP errors',
  );
} catch (e) {
  console.error('BROWSER FAIL', e);
  await page.screenshot({ path: '.tmp-tools/budget/browser-failed.png', fullPage: true });
  console.log(await page.$eval('body', (e) => e.innerText));
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(evidenceDir, 'browser-results.json'),
    JSON.stringify({ checks, errors, failures }, null, 2),
  );
  console.log(
    'CHECKS',
    checks.length,
    'ERRORS',
    JSON.stringify(errors),
    'HTTP FAILURES',
    JSON.stringify(failures),
  );
  await browser.close();
}
