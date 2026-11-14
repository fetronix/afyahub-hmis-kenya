import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

if (process.env.BUDGET_BROWSER_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw new Error('Requires explicitly guarded synthetic browser setup and Chromium.');
const base = process.env.BUDGET_BROWSER_BASE_URL ?? 'http://127.0.0.1:4193';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  throw new Error('Disposable loopback application only.');
const config = JSON.parse(await readFile('.tmp-tools/budget/browser-session.json', 'utf8'));
if (config.syntheticOnly !== true || !config.sectionImports || !config.viewer)
  throw new Error('Run guarded planning-sections seed first.');
const output =
  process.env.PLANNING_SECTIONS_EVIDENCE_DIR ?? 'docs/audits/planning-sections-ui-evidence';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  args: JSON.parse(
    process.env.BUDGET_BROWSER_ARGS ??
      '["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]',
  ),
  headless: true,
});
let page = await browser.newPage(),
  phase = 'login';
const checks = [],
  errors = [],
  failures = [],
  mutations = [],
  screenshots = [],
  records = [];
let passed = false;
function monitor(p) {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    const entry = { phase, method: r.request().method(), path: u.pathname, status: r.status() };
    if (r.status() >= 400) failures.push(entry);
    if (
      ['POST', 'PATCH', 'DELETE'].includes(entry.method) &&
      u.pathname.startsWith('/api/budget-planning/')
    )
      mutations.push(entry);
  });
}
monitor(page);
const check = (value, message) => {
  if (!value) throw new Error(message);
  checks.push(message);
  console.log('PASS', message);
};
const waitText = (text) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000 }, text);
const click = async (text) => {
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === t && !b.matches(':disabled'),
      ),
    { timeout: 20000 },
    text,
  );
  await page.evaluate(
    (t) =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === t && !b.matches(':disabled'))
        .click(),
    text,
  );
};
const fill = async (label, value, select = false) => {
  await page.evaluate(
    (label, select) => {
      document.querySelector('[data-section-field]')?.removeAttribute('data-section-field');
      const root = document.querySelector('[role="dialog"]') ?? document;
      const l = [...root.querySelectorAll('label')].find((l) =>
        l.textContent.trim().startsWith(label),
      );
      const el = l?.querySelector(select ? 'select' : 'input');
      if (!el) throw new Error('Field missing: ' + label);
      el.setAttribute('data-section-field', 'yes');
    },
    label,
    select,
  );
  if (select) await page.select('[data-section-field]', String(value));
  else {
    const el = await page.$('[data-section-field]');
    await el.click({ clickCount: 3 });
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value) await el.type(String(value));
  }
};
const category = async (name) => {
  const value = await page.evaluate((name) => {
    const root = document.querySelector('[role="dialog"]') ?? document;
    const l = [...root.querySelectorAll('label')].find((l) =>
      l.textContent.trim().startsWith('Plan category'),
    );
    return [...l.querySelectorAll('option')].find((o) => o.textContent.trim() === name)?.value;
  }, name);
  if (!value) throw new Error('Category unavailable: ' + name);
  await fill('Plan category', value, true);
};
const table = () => page.$(`table[aria-label="${phase} table"]`);
const tableText = () => page.$eval(`table[aria-label="${phase} table"]`, (t) => t.innerText);
const rowAction = async (description, action) => {
  await page.waitForFunction(
    (name, description, action) => {
      const t = document.querySelector(`table[aria-label="${name} table"]`);
      return [...(t?.querySelectorAll('tbody > tr') ?? [])].some(
        (r) =>
          r.innerText.includes(description) &&
          [...r.querySelectorAll('button')].some(
            (b) => b.textContent.trim() === action && !b.matches(':disabled'),
          ),
      );
    },
    { timeout: 20000 },
    phase,
    description,
    action,
  );
  await page.evaluate(
    (name, description, action) => {
      const t = document.querySelector(`table[aria-label="${name} table"]`);
      const r = [...t.querySelectorAll('tbody > tr')].find((r) =>
        r.innerText.includes(description),
      );
      [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === action).click();
    },
    phase,
    description,
    action,
  );
};
const shot = async (name, dialog = false) => {
  if (!dialog)
    await page.evaluate(
      (name) =>
        document
          .querySelector(`section[aria-label="${name} records"]`)
          ?.scrollIntoView({ block: 'start' }),
      phase,
    );
  const filename = name + '.png';
  await page.screenshot({ path: path.join(output, filename), fullPage: true });
  screenshots.push(filename);
};
const query = async (search) =>
  page.evaluate(
    async ({ basePath, search }) => {
      const token = localStorage.getItem('jalicare_session_token');
      const r = await fetch(
        basePath + '?' + new URLSearchParams({ search, all: 'true', year: '2026' }),
        { headers: token ? { Authorization: 'Bearer ' + token } : {} },
      );
      if (!r.ok) throw new Error('Verification read failed: ' + r.status);
      return r.json();
    },
    { basePath: `/api/budget-planning/plans/${config.planId}`, search },
  );
const months = [
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
];
const closeDialog = async () => {
  await click('Close');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
};
const save = async (kind) => {
  await click('Save ' + kind);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 20000 });
};
const search = async (value) => fill('Search description', value);
const nav = async (label) => {
  phase = label;
  await click(label);
  await page.waitForSelector(`table[aria-label="${label} table"]`);
};
const login = async (credentials) => {
  await page.setViewport({ width: 1600, height: 1250 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="Username or Email"]', credentials.username);
  await page.type('input[placeholder="Password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside nav');
  await click('Accounting & Finance');
  await click('Accounting Setup');
  await click('Budget & Procurement Planning');
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll('[aria-label="Active planning plan"] option')].some(
        (o) => o.value === String(id),
      ),
    {},
    config.planId,
  );
  await page.select('[aria-label="Active planning plan"]', String(config.planId));
  await waitText('Official CSV section verification');
};
try {
  await login(config);
  check(true, 'Real authenticated facility planner navigates to Budget & Procurement Planning');
  await nav('Stationery & Consumables');
  await waitText('232 matching records');
  check(
    !(await tableText()).includes('Syrona Staff'),
    'Stationery excludes imported monthly branding items',
  );
  check(
    await page.$eval(
      'table[aria-label="Stationery & Consumables table"] tbody',
      (t) => t.children.length <= 20,
    ),
    'Stationery paginates after section classification, not before it',
  );
  for (const [group, count] of [
    ['OPD', 133],
    ['DENTAL', 40],
    ['OTHER', 59],
  ]) {
    await fill('Consumable group', group, true);
    await waitText(count + ' matching records');
    check(true, `Stationery ${group} filter displays ${count} imported records`);
  }
  await fill('Consumable group', '', true);
  await search('Cotton Wool');
  await waitText('2 matching records');
  check(true, 'Case-insensitive search preserves both imported cotton-wool source rows');
  await search('');
  await waitText('232 matching records');
  const firstPage = await tableText();
  await click('Next items');
  await waitText('Page 2 · 232');
  check(
    (await tableText()) !== firstPage,
    'Stationery next page displays a different source-record page',
  );
  await click('Previous items');
  await waitText('Page 1 · 232');
  await shot('01-stationery-consumables');
  await search('Toner - 217-A');
  await waitText('1 matching records');
  await rowAction('Toner - 217-A', 'View');
  await waitText('Saved January–December calculations');
  check(
    await page.$eval('[role="dialog"] input', (e) => e.matches(':disabled')),
    'Stationery View opens a genuinely read-only record',
  );
  await shot('04-stationery-view', true);
  await closeDialog();
  await search('');
  await waitText('232 matching records');
  await fill('Financial year', '2027', true);
  await waitText('Year filter verification');
  check(
    await page.$eval('[aria-label="Active planning plan"]', (s) =>
      [...s.options].filter((o) => o.value).every((o) => o.textContent.startsWith('2027')),
    ),
    'Year filter selects only 2027 plans',
  );
  await fill('Financial year', '2026', true);
  await waitText('Official CSV section verification');
  await page.select('[aria-label="Active planning plan"]', String(config.planId));
  await waitText('232 matching records');
  const runId = Date.now();
  for (const section of ['Stationery & Consumables', 'Branding']) {
    await nav(section);
    await waitText(section === 'Branding' ? '5 matching records' : '232 matching records');
    if (section === 'Branding') {
      check(
        !(await tableText()).includes('Toner -'),
        'Dedicated Branding table excludes stationery without requiring a manual category selection',
      );
      await page.$eval('table[aria-label="Branding table"] details', (d) => {
        d.open = true;
      });
      await shot('02-branding');
      await rowAction('Syrona Staff Blouses', 'View');
      await waitText('Saved January–December calculations');
      check(
        await page.$$eval(
          '[role="dialog"] input',
          (fields) =>
            fields.filter((e) => e.closest('label')?.textContent.includes('quantity')).length ===
            12,
        ),
        'Branding View exposes all twelve saved monthly quantities',
      );
      await shot('05-branding-view', true);
      await closeDialog();
    }
    const name = `UI ${section === 'Branding' ? 'Branding' : 'Stationery'} record ${runId}`;
    await search(name);
    await waitText('0 matching records');
    await click(section === 'Branding' ? 'Add branding item' : 'Add item');
    await waitText('January quantity');
    await fill('Item description', name);
    await fill('Unit', 'Box');
    await fill('Base unit price', '100');
    await category(section === 'Branding' ? 'BRANDING' : 'OPD CONSUMABLES');
    for (const [n, month] of months.entries()) await fill(month + ' quantity', String(n + 1));
    await save('item');
    await waitText('1 matching records');
    await waitText('8190.00');
    let d = await query(name),
      item = d.items[0];
    check(
      item && item.months.length === 12 && item.annual_total_cents === '819000',
      `${section}: browser Create saves twelve quantities and server-calculated annual cost`,
    );
    records.push({ section, id: item.id, name });
    await rowAction(name, 'View');
    await waitText('Saved January–December calculations');
    check(
      await page.$$eval(
        '[role="dialog"] button',
        (bs) => !bs.some((b) => b.textContent.startsWith('Save ')),
      ),
      `${section}: View has no save action`,
    );
    await closeDialog();
    await rowAction(name, 'Edit');
    await waitText('January quantity');
    await fill('Base unit price', '120');
    await fill('January quantity', '3');
    await fill('December quantity', '4');
    await save('item');
    await waitText('9072.00');
    d = await query(name);
    item = d.items[0];
    check(
      item.base_price_cents === '12000' &&
        item.months[0].quantity === '3.000' &&
        item.months[1].quantity === '2.000' &&
        item.months[11].quantity === '4.000' &&
        item.annual_total_cents === '907200',
      `${section}: browser Edit and Save persist prices, January/December changes and untouched months`,
    );
    if (section === 'Branding') {
      await fill('Monthly date', '2', true);
      await waitText('1 months');
      await rowAction(name, 'Inline edit');
      await page.waitForSelector('form[aria-label="Inline item editor"] fieldset:not([disabled])');
      await fill('Inline base price', '130');
      await fill('January quantity', '5');
      await waitText('Live annual preview: 10101.00');
      await click('Save inline changes');
      await page.waitForFunction(
        () => !document.querySelector('form[aria-label="Inline item editor"]'),
      );
      await waitText('10101.00');
      d = await query(name);
      check(
        d.items[0].months.length === 12 &&
          d.items[0].months[1].quantity === '2.000' &&
          d.items[0].months[11].quantity === '4.000',
        'Branding inline edit under February filter retains January–December data',
      );
      await fill('Monthly date', '', true);
      await waitText('12 months');
    }
    await shot(section === 'Branding' ? '08-branding-saved' : '07-stationery-saved');
    page.once('dialog', (dialog) => dialog.accept());
    await rowAction(name, 'Delete');
    await waitText('0 matching records');
    d = await query(name);
    check(
      d.items.length === 0,
      `${section}: browser Delete soft-removes the eligible draft and refreshes the table`,
    );
    await search('');
  }
  await nav('Staff Uniform Projections');
  await waitText('4 matching records');
  check(
    !(await tableText()).includes('Syrona Staff Blouses'),
    'Uniform table is separate from monthly Branding',
  );
  await shot('03-staff-uniform-projections');
  await search('POLO');
  await waitText('1 matching records');
  check(
    (await tableText()).includes('POLO T SHIRTS'),
    'Uniform search locates the imported polo projection',
  );
  await rowAction('POLO T SHIRTS', 'View');
  await waitText('Existing balance');
  const uniformLabels = [
    'Existing balance',
    'Buying cost',
    'Projected staff',
    'Uniform quantity per staff',
    'Staff contribution',
  ];
  check(
    await page.evaluate(
      (labels) =>
        labels.every((text) =>
          [...document.querySelectorAll('[role="dialog"] label')].some(
            (l) =>
              l.textContent.trim().startsWith(text) &&
              l.querySelector('input')?.matches(':disabled'),
          ),
        ),
      uniformLabels,
    ),
    'Uniform View shows balances, buying costs, staff, per-staff quantities and contribution assumptions read-only',
  );
  await shot('06-uniform-view', true);
  await closeDialog();
  const uniformCategory = await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find((l) =>
      l.textContent.trim().startsWith('Category'),
    );
    return [...l.querySelectorAll('option')].find((o) => o.textContent.trim() === 'Staff Uniforms')
      .value;
  });
  await fill('Category', uniformCategory, true);
  await waitText('1 matching records');
  check(
    (await tableText()).includes('POLO T SHIRTS'),
    'Uniform category filter retains the searched imported projection',
  );
  await fill('Category', '', true);
  await search('');
  await waitText('4 matching records');
  const uniformName = 'UI Uniform record ' + runId;
  await search(uniformName);
  await waitText('0 matching records');
  await click('Add uniform projection');
  await waitText('Uniform type');
  await fill('Uniform type', uniformName);
  await category('Staff Uniforms');
  await fill('Existing balance', '2');
  await fill('Balance reference period', 'December 2025 — UI verification');
  await fill('Buying cost', '1000');
  await fill('Projected staff count', '10');
  await fill('Uniform quantity per staff', '2');
  await fill('Staff contribution percentage', '50');
  await fill('Opening balance treatment', 'SUBTRACT', true);
  await save('uniform');
  await waitText('9000.00');
  let u = (await query(uniformName)).uniforms[0];
  check(
    u.staff_count === 10 && u.total_cents === '900000',
    'Uniform browser Create applies the configured opening-balance and contribution calculation',
  );
  records.push({ section: phase, id: u.id, name: uniformName });
  await rowAction(uniformName, 'Edit');
  await waitText('Uniform type');
  await fill('Existing balance', '4');
  await fill('Buying cost', '1200');
  await fill('Projected staff count', '12');
  await fill('Uniform quantity per staff', '3');
  await fill('Staff contribution percentage', '25');
  await save('uniform');
  await waitText('28800.00');
  u = (await query(uniformName)).uniforms[0];
  check(
    u.staff_count === 12 &&
      u.existing_balance === '4.000' &&
      u.quantity_per_staff === '3.000' &&
      u.contribution_bp === 2500 &&
      u.total_cents === '2880000',
    'Uniform browser Edit and Save persist all five requested inputs and recalculate net budget',
  );
  await shot('09-uniform-saved');
  page.once('dialog', (dialog) => dialog.accept());
  await rowAction(uniformName, 'Delete');
  await waitText('0 matching records');
  check(
    (await query(uniformName)).uniforms.length === 0,
    'Uniform browser Delete removes the draft from active results',
  );
  await search('');
  const audit = await page.evaluate(async (planId) => {
    const token = localStorage.getItem('jalicare_session_token');
    const r = await fetch('/api/budget-planning/audit?planId=' + planId, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!r.ok) throw new Error('Audit read failed');
    return r.json();
  }, config.planId);
  check(
    records.every((record) =>
      audit.some(
        (e) =>
          e.action === 'ARCHIVE_RECORD' &&
          e.entity === (record.section === 'Staff Uniform Projections' ? 'uniforms' : 'items') &&
          e.entity_id === record.id &&
          e.updated_values?.is_active === false,
      ),
    ),
    'All three browser deletions are retained as audited inactive records',
  );
  for (const section of ['Stationery & Consumables', 'Branding', 'Staff Uniform Projections']) {
    check(
      mutations.some((m) => m.phase === section && m.method === 'POST' && m.status === 201) &&
        mutations.some((m) => m.phase === section && m.method === 'PATCH' && m.status === 200) &&
        mutations.some((m) => m.phase === section && m.method === 'DELETE' && m.status === 200),
      `${section}: captured actual browser POST, PATCH and DELETE success responses`,
    );
  }
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const client = await page.createCDPSession();
  await client.send('Network.clearBrowserCookies');
  await client.detach();
  phase = 'read-only login';
  await login(config.viewer);
  for (const section of ['Stationery & Consumables', 'Branding', 'Staff Uniform Projections']) {
    await nav(section);
    await waitText(
      section === 'Branding'
        ? '5 matching records'
        : section === 'Stationery & Consumables'
          ? '232 matching records'
          : '4 matching records',
    );
    const labels = await (
      await table()
    ).$$eval('button', (bs) => bs.map((b) => b.textContent.trim()));
    check(
      labels.includes('View') && !labels.some((l) => ['Edit', 'Delete', 'Inline edit'].includes(l)),
      `Read-only user can view ${section} without edit/delete actions`,
    );
    check(
      await page.$$eval(
        'button',
        (bs) =>
          !bs.some((b) =>
            ['Add item', 'Add branding item', 'Add uniform projection'].includes(
              b.textContent.trim(),
            ),
          ),
      ),
      `Read-only user cannot create in ${section}`,
    );
  }
  await page.setViewport({ width: 390, height: 844 });
  await nav('Branding');
  await waitText('5 matching records');
  await shot('10-branding-mobile');
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile Branding has no document-level horizontal overflow',
  );
  check(errors.length === 0, 'No browser runtime errors');
  check(
    failures.every(
      (f) =>
        (f.status === 401 && f.path === '/api/auth/session') ||
        (f.status === 403 && f.path === '/api/dashboard/overview' && f.phase === 'read-only login'),
    ),
    'Only expected pre-login session 401 and read-only dashboard RBAC 403 responses; no planning API errors',
  );
  passed = true;
} catch (error) {
  console.error('BROWSER FAIL', error);
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(await page.$eval('body', (b) => b.innerText).catch(() => ''));
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, 'browser-results.json'),
    JSON.stringify(
      {
        passed,
        scope:
          'Authenticated production build on disposable synthetic facility, official CSV imports with zero-fill test assumptions; no production actions',
        checks,
        errors,
        failures,
        mutations,
        records,
        screenshots,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('CHECKS', checks.length, 'PASSED', passed, 'ERRORS', errors.length);
  await browser.close();
}
