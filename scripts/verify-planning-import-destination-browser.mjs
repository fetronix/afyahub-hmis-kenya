import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
if (process.env.BUDGET_BROWSER_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Guarded synthetic preview-only fixture and Chromium required.');
const base = process.env.BUDGET_BROWSER_BASE_URL ?? 'http://127.0.0.1:4193';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  throw Error('Loopback synthetic preview only.');
const config = JSON.parse(await readFile('.tmp-tools/import-destination/session.json', 'utf8'));
if (config.syntheticOnly !== true || config.previewOnly !== true)
  throw Error('Synthetic preview-only fixture required.');
const output =
  process.env.IMPORT_DESTINATION_EVIDENCE_DIR ?? 'docs/audits/planning-import-destination-evidence';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  args: JSON.parse(
    process.env.BUDGET_BROWSER_ARGS ??
      '["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]',
  ),
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1250 });
const checks = [],
  errors = [],
  failures = [],
  mutations = [],
  blocked = [];
let passed = false,
  review;
await page.setRequestInterception(true);
page.on('request', (r) => {
  const p = new URL(r.url()).pathname;
  if (
    r.method() === 'POST' &&
    (/^\/api\/budget-planning\/imports\/\d+\/confirm$/.test(p) ||
      p === '/api/budget-planning/plans')
  ) {
    blocked.push(p);
    void r.abort();
    return;
  }
  if (p.startsWith('/api/budget-planning/') && r.method() !== 'GET')
    mutations.push({ method: r.method(), path: p });
  void r.continue();
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  const p = new URL(r.url()).pathname;
  if (p.startsWith('/api/') && r.status() >= 400) failures.push({ path: p, status: r.status() });
});
const check = (v, text) => {
  if (!v) throw Error(text);
  checks.push(text);
  console.log('PASS', text);
};
const wait = (text) =>
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
const field = async (label, value, select = false) => {
  await page.evaluate(
    (label, select) => {
      document.querySelector('[data-destination-field]')?.removeAttribute('data-destination-field');
      const l = [
        ...[...document.querySelectorAll('section')]
          .find((s) => s.querySelector('h3')?.textContent.startsWith('Preview and field mappings'))
          .querySelectorAll('label'),
      ].find((l) => l.textContent.trim().startsWith(label));
      const el = l?.querySelector(select ? 'select' : 'input');
      if (!el) throw Error('Missing field: ' + label);
      el.setAttribute('data-destination-field', 'yes');
    },
    label,
    select,
  );
  if (select) await page.select('[data-destination-field]', String(value));
  else {
    const e = await page.$('[data-destination-field]');
    await e.focus();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value) await e.type(String(value));
  }
};
const shot = async (name, selector) => {
  await page.$eval(selector, (e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
};
const read = (endpoint) =>
  page.evaluate(
    async ({ endpoint, facility }) => {
      const r = await fetch(
        '/api/budget-planning' +
          endpoint +
          (endpoint.includes('?') ? '&' : '?') +
          'facilityId=' +
          facility,
        { headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token') } },
      );
      if (!r.ok) throw Error('Read failed ' + r.status);
      return r.json();
    },
    { endpoint, facility: config.facilityId },
  );
try {
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="Username or Email"]', config.username);
  await page.type('input[placeholder="Password"]', config.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside nav');
  await click('Accounting & Finance');
  await click('Accounting Setup');
  await click('Budget & Procurement Planning');
  await page.waitForSelector('[aria-label="Active planning plan"]');
  await click('CSV / Excel Import & History');
  await page.waitForSelector('input[aria-label="Planning workbook"]');
  check(
    (await read('/plans?year=2026')).total === 1,
    'Disposable facility starts with exactly one 2026 plan, not duplicates',
  );
  const pending = await read('/imports');
  if (!pending.length)
    await (
      await page.$('input[aria-label="Planning workbook"]')
    ).uploadFile(
      path.join(
        process.env.SYRONA_SOURCE_DIR ?? '/tmp/arena-coding-uploads',
        'Syrona_Branding.csv',
      ),
    );
  else {
    if (pending.length !== 1 || pending[0].status !== 'UPLOADED')
      throw Error('Unexpected disposable fixture state; do not alter existing batches.');
    await click('Review batch ' + pending[0].id);
  }
  await wait('Preview and field mappings');
  const batch = (await read('/imports'))[0];
  check(
    batch.status === 'UPLOADED' && !batch.result,
    'Original CSV is staged only; no import has been executed',
  );
  check(
    await page.evaluate(
      () =>
        [
          ...[...document.querySelectorAll('section')]
            .find((s) =>
              s.querySelector('h3')?.textContent.startsWith('Preview and field mappings'),
            )
            .querySelectorAll('label'),
        ]
          .find((l) => l.textContent.trim().startsWith('Import destination'))
          .querySelector('select').value === 'EXISTING',
    ),
    'Existing-plan import is the default destination',
  );
  await page.waitForFunction(
    (id) =>
      [
        ...[...document.querySelectorAll('label')]
          .find((l) => l.textContent.trim().startsWith('Existing destination plan'))
          .querySelectorAll('option'),
      ].some(
        (o) =>
          o.value === String(id) &&
          o.textContent.includes('Syrona Medical Center Annual Plan 2026') &&
          o.textContent.includes('MIXED'),
      ),
    {},
    config.planId,
  );
  await field('Existing destination plan', config.planId, true);
  const assumptions = await page.evaluate(() =>
    Object.fromEntries(
      ['Import financial year', 'Import inflation percentage', 'Plan type', 'Currency'].map(
        (label) => {
          const l = [
            ...[...document.querySelectorAll('section')]
              .find((s) =>
                s.querySelector('h3')?.textContent.startsWith('Preview and field mappings'),
              )
              .querySelectorAll('label'),
          ].find((l) => l.textContent.trim().startsWith(label));
          const el = l.querySelector('input,select');
          return [label, { value: el.value, locked: el.readOnly || el.disabled }];
        },
      ),
    ),
  );
  check(
    assumptions['Import financial year'].value === '2026' &&
      assumptions['Import inflation percentage'].value === '5' &&
      assumptions['Plan type'].value === 'MIXED' &&
      assumptions.Currency.value === 'KES' &&
      Object.values(assumptions).every((v) => v.locked),
    'Selecting Syrona 2026 automatically fills and locks year, MIXED type, KES and 5% inflation',
  );
  check(
    await page.evaluate(
      () =>
        ![
          ...[...document.querySelectorAll('section')]
            .find((s) =>
              s.querySelector('h3')?.textContent.startsWith('Preview and field mappings'),
            )
            .querySelectorAll('label'),
        ].some((l) => l.textContent.trim().startsWith('Draft plan name')),
    ),
    'No manually editable draft name is displayed for the existing destination',
  );
  await shot('01-existing-plan-assumptions', '[aria-label="Destination assumptions"]');
  await click('Add source/category mapping block');
  for (const [label, value] of [
    ['First source row', '8'],
    ['Last source row', '12'],
    ['Source category', 'BRANDING'],
    ['Description column', 'B'],
    ['Base price column', 'D'],
    ['Unit column', 'C'],
  ])
    await field(label, value);
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
  const cols = ['F', 'H', 'J', 'L', 'N', 'P', 'R', 'T', 'V', 'X', 'Z', 'AB'];
  for (let i = 0; i < 12; i++) await field(months[i] + ' qty column', cols[i]);
  const response = page.waitForResponse(
    (r) => r.url().includes(`/imports/${batch.id}/preview`) && r.request().method() === 'POST',
  );
  await click('Validate and preview import');
  const r = await response;
  review = await r.json();
  check(r.status() === 200, 'Server validates an existing-plan destination during preview');
  await wait('Imports into the EXISTING plan — no new plan');
  check(
    review.destination.planId === config.planId &&
      review.destination.facilityId === config.facilityId &&
      review.destination.kind === 'EXISTING' &&
      review.destination.mode === 'SKIP' &&
      review.destination.planType === 'MIXED' &&
      review.destination.currency === 'KES',
    'Server preview names the actual authenticated facility and chosen plan ID/assumptions',
  );
  check(
    review.counts.newItems === 5 &&
      review.counts.matchingItems === 0 &&
      review.counts.skippedItems === 0 &&
      review.counts.conflictingItems === 0,
    'Preview displays reconciliation counts without writing plan records',
  );
  check(
    review.items.length === 5 &&
      review.items[0].sourceWorksheet === 'CSV' &&
      review.items[0].sourceRow === 8 &&
      review.items[4].sourceRow === 12,
    'Source worksheet and original CSV row identities are preserved',
  );
  check(
    review.normalizations.length > 0 && review.warnings.length > 0,
    'Normalization defaults and source warnings remain available in preview',
  );
  await shot('02-existing-plan-preview', '[aria-label="Validated import destination"]');
  const invalid = await page.evaluate(
    async ({ batchId, input, facility }) => {
      const r = await fetch(
        `/api/budget-planning/imports/${batchId}/preview?facilityId=${facility}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token'),
          },
          body: JSON.stringify(input),
        },
      );
      return { status: r.status, body: await r.json() };
    },
    {
      batchId: batch.id,
      facility: config.facilityId,
      input: {
        destination: 'EXISTING',
        mode: 'SKIP',
        planId: config.planId,
        version: config.version,
        financialYear: 2026,
        planType: 'MIXED',
        currency: 'USD',
        inflationPercent: '5',
        mappings: [
          {
            sheet: 'CSV',
            kind: 'ITEM',
            startRow: 8,
            endRow: 12,
            category: 'BRANDING',
            description: 'B',
            unit: 'C',
            price: 'D',
            months: cols,
          },
        ],
        policy: 'ZERO_FILL',
      },
    },
  );
  check(
    invalid.status === 400 && invalid.body.error === 'CURRENCY_MISMATCH',
    'Direct API preview rejects an incompatible currency independently of locked UI controls',
  );
  await field('Import destination', 'NEW', true);
  await wait('A NEW, separate draft plan will be created');
  check(
    (await page.evaluate(() =>
      [
        ...[...document.querySelectorAll('section')]
          .find((s) => s.querySelector('h3')?.textContent.startsWith('Preview and field mappings'))
          .querySelectorAll('label'),
      ].some((l) => l.textContent.trim().startsWith('Draft plan name')),
    )) && !(await page.$('[aria-label="Validated import destination"]')),
    'Switching to new-draft mode reveals creation fields and invalidates the old destination preview',
  );
  await field('Draft plan name', 'Separate reviewed draft — NOT CREATED');
  await shot('03-new-draft-fields', '[aria-label="Destination assumptions"]');
  await wait('I explicitly authorize an additional separate draft for this facility/year');
  check(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Validate and preview import',
        ).disabled,
    ),
    'Existing facility/year plan requires explicit additional-plan authorization before new-draft preview',
  );
  check(
    (await read('/plans?year=2026')).total === 1,
    'Switching destination modes did not create another plan',
  );
  const history = await read('/imports');
  check(
    history.length === 1 &&
      history[0].id === batch.id &&
      history[0].sha256 === batch.sha256 &&
      history[0].status === 'UPLOADED' &&
      !history[0].result,
    'Same original batch/hash remains UPLOADED with no import result',
  );
  const audit = await read('/audit');
  check(
    !audit.some((e) => ['CONFIRM_IMPORT', 'IMPORT_CREATE', 'IMPORT_UPDATE'].includes(e.action)),
    'No import execution event exists in the disposable fixture',
  );
  check(
    !mutations.some(
      (m) => m.path.endsWith('/confirm') || m.path === '/api/budget-planning/plans',
    ) && blocked.length === 0,
    'Browser sent no confirmation or plan-creation request; protective interception was not triggered',
  );
  check(errors.length === 0, 'No browser runtime errors');
  check(
    failures.every(
      (f) =>
        (f.path === '/api/auth/session' && f.status === 401) ||
        (f.path.endsWith('/preview') && f.status === 400),
    ),
    'Only expected pre-login 401 and intentional currency-validation 400 occurred',
  );
  passed = true;
} catch (e) {
  console.error(e);
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(await page.$eval('body', (b) => b.innerText).catch(() => ''));
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, 'browser-results.json'),
    JSON.stringify(
      {
        syntheticOnly: true,
        previewOnly: true,
        passed,
        checks,
        errors,
        failures,
        mutations,
        blocked,
        destination: review?.destination,
        counts: review?.counts,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('CHECKS', checks.length, 'PASSED', passed);
  await browser.close();
}
