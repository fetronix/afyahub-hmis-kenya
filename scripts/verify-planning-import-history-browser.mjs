import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
if (process.env.BUDGET_BROWSER_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Requires an explicitly guarded disposable browser fixture.');
const base = process.env.BUDGET_BROWSER_BASE_URL ?? 'http://127.0.0.1:4193';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  throw Error('Loopback synthetic verification only.');
const config = JSON.parse(await readFile('.tmp-tools/budget/browser-session.json', 'utf8'));
if (config.syntheticOnly !== true || config.importHistoryIncidentSyntheticOnly !== true)
  throw Error(
    'Requires the synthetic cancelled-batch incident fixture, never the actual incident database.',
  );
const output =
  process.env.IMPORT_HISTORY_EVIDENCE_DIR ?? 'docs/audits/planning-import-history-evidence';
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
await page.setViewport({ width: 1500, height: 1200 });
const checks = [],
  errors = [],
  requests = [],
  failures = [];
let passed = false;
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/budget-planning/') && r.method() !== 'GET')
    requests.push({ method: r.method(), path: u.pathname });
});
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/') && r.status() >= 400)
    failures.push({ path: u.pathname, status: r.status() });
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
const read = async (endpoint) =>
  page.evaluate(
    async ({ endpoint, facilityId }) => {
      const r = await fetch(
        '/api/budget-planning' +
          endpoint +
          (endpoint.includes('?') ? '&' : '?') +
          'facilityId=' +
          facilityId,
        { headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token') } },
      );
      if (!r.ok) throw Error('Verification read failed ' + r.status);
      return r.json();
    },
    { endpoint, facilityId: config.facilityId },
  );
const select = async (label, value) => {
  await page.evaluate((label) => {
    document.querySelector('[data-history-field]')?.removeAttribute('data-history-field');
    const l = [...document.querySelectorAll('label')].find((l) =>
      l.textContent.trim().startsWith(label),
    );
    const el = l?.querySelector('select');
    if (!el) throw Error('Missing select ' + label);
    el.setAttribute('data-history-field', 'yes');
  }, label);
  await page.select('[data-history-field]', String(value));
};
const shot = async (name) => {
  await page.evaluate((name) => {
    const section = name.startsWith('01-')
      ? [...document.querySelectorAll('section')].find(
          (s) => s.querySelector('h3')?.textContent === 'Import history (latest 100)',
        )
      : name.startsWith('02-')
        ? document.querySelector('[aria-label="Cancelled batch inspection"]')
        : [...document.querySelectorAll('label')].find((l) =>
            l.textContent.trim().startsWith('Target draft'),
          );
    section?.scrollIntoView({ block: name.startsWith('03-') ? 'center' : 'start' });
  }, name);
  return page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
};
const unchangedPlan = (p) =>
  JSON.stringify({ plan: p.plan, categories: p.categories, items: p.items, uniforms: p.uniforms });
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
  await page.select('[aria-label="Active planning plan"]', String(config.planId));
  await click('CSV / Excel Import & History');
  await wait('Syrona_Stationery.csv');
  const before = await read('/imports');
  check(
    before.length === 2 &&
      before.every((b) => b.status === 'CANCELLED' && !b.validation && !b.result),
    'Reproduced both cancelled, not-previewed source batches without confirming imports',
  );
  const planBefore = await read(`/plans/${config.planId}?all=true&year=2026`);
  check(
    planBefore.plan.version === 1 &&
      planBefore.plan.status === 'DRAFT' &&
      planBefore.plan.currency === 'KES' &&
      planBefore.plan.inflation_bp === 500,
    'Synthetic 2026 annual target is DRAFT / KES / revision 1 / 5%',
  );
  await shot('01-cancelled-history-actions');
  for (const [id, name] of [
    [1, 'Syrona_Branding.csv'],
    [2, 'Syrona_Stationery.csv'],
  ]) {
    const file = await page.$('input[aria-label="Planning workbook"]');
    await file.uploadFile(
      path.join(process.env.SYRONA_SOURCE_DIR ?? '/tmp/arena-coding-uploads', name),
    );
    await wait(`cancelled batch ${id}. In Import history`);
    const after = await read('/imports');
    check(
      JSON.stringify(after) === JSON.stringify(before),
      `Re-upload of cancelled batch ${id} reports the safe action without changing history or creating a batch`,
    );
    await click(`Inspect cancelled batch ${id}`);
    await wait(`Cancelled batch #${id} — read-only source inspection`);
    check(
      await page.evaluate(
        () =>
          !document.querySelector('[aria-label="Cancelled batch inspection"] input') &&
          ![...document.querySelectorAll('button')].some(
            (b) => b.textContent.trim() === 'Confirm import',
          ),
      ),
      `Batch ${id} is inspectable read-only, without import controls`,
    );
    await shot(`02-inspect-cancelled-${id}`);
    await click('Close inspection');
  }
  page.once('dialog', (d) => d.dismiss());
  await click('Retry review of batch 2');
  check(
    (await read('/imports')).every((b) => b.status === 'CANCELLED'),
    'Dismissing retry confirmation leaves both batches cancelled',
  );
  page.once('dialog', (d) => d.accept());
  await click('Retry review of batch 2');
  await wait('Preview and field mappings — batch #2');
  let after = await read('/imports');
  check(
    after.find((b) => b.id === 2).status === 'UPLOADED' &&
      after.find((b) => b.id === 1).status === 'CANCELLED',
    'Only explicitly confirmed batch 2 reopens for review; batch 1 stays cancelled',
  );
  check(
    after.length === 2 &&
      after.every((b) => {
        const old = before.find((v) => v.id === b.id);
        return (
          b.sha256 === old.sha256 &&
          b.byte_size === old.byte_size &&
          b.created_at === old.created_at &&
          b.uploaded_by === old.uploaded_by
        );
      }),
    'Retry preserves batch identity, source hash, size, upload actor/time and creates no duplicate',
  );
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(
      (l) => l.textContent.trim() === 'Import financial year',
    );
    l.querySelector('input').setAttribute('data-year-input', 'yes');
  });
  const year = await page.$('[data-year-input]');
  await year.click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await year.type('2026');
  await select('Import action', 'SKIP');
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll('option')].some(
        (o) => o.value === String(id) && o.textContent.includes('SYNTHETIC INCIDENT REPRODUCTION'),
      ),
    {},
    config.planId,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('label')]
        .find((l) => l.textContent.trim().startsWith('Target draft'))
        .querySelector('select').disabled === false,
  );
  await select('Target draft', config.planId);
  check(
    await page.evaluate(
      (id) =>
        [...document.querySelectorAll('label')]
          .find((l) => l.textContent.trim().startsWith('Target draft'))
          .querySelector('select').value === String(id),
      config.planId,
    ),
    'The existing 2026 DRAFT/KES/revision-1/5% annual plan can be selected as merge target',
  );
  await shot('03-selected-existing-draft');
  check(
    unchangedPlan(await read(`/plans/${config.planId}?all=true&year=2026`)) ===
      unchangedPlan(planBefore),
    'Target plan and its categories/items/uniforms remain byte-for-byte unchanged',
  );
  const audit = await read('/audit');
  check(
    audit.filter((e) => e.action === 'CANCEL_IMPORT' && [1, 2].includes(e.import_id)).length ===
      2 &&
      audit.filter((e) => e.action === 'RETRY_IMPORT_REVIEW' && e.import_id === 2).length === 1,
    'Both cancellation events remain and the explicit retry has its own actor/time audit',
  );
  check(
    !requests.some((r) => r.path.endsWith('/confirm') || r.path.endsWith('/preview')),
    'Browser never previews or confirms an import during this investigation',
  );
  check(
    requests.filter((r) => r.path.endsWith('/retry-review')).length === 1,
    'Exactly one browser retry POST was explicitly authorized',
  );
  check(errors.length === 0, 'No browser runtime errors');
  check(
    failures.every(
      (f) =>
        (f.path === '/api/auth/session' && f.status === 401) ||
        (f.path === '/api/budget-planning/imports' && f.status === 409),
    ),
    'Only expected pre-login 401 and duplicate-upload 409 responses',
  );
  passed = true;
} catch (e) {
  console.error(e);
  await shot('failure').catch(() => {});
  console.error(await page.$eval('body', (b) => b.innerText).catch(() => ''));
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, 'browser-results.json'),
    JSON.stringify(
      { syntheticOnly: true, notActualIncident: true, passed, checks, errors, failures, requests },
      null,
      2,
    ) + '\n',
  );
  console.log('CHECKS', checks.length, 'PASSED', passed);
  await browser.close();
}
