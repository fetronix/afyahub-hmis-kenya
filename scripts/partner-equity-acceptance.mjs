/** Functional acceptance against the REAL built SPA, Express, authentication and PostgreSQL.
 * No browser/API adapters. Explicitly disposable local fixtures only; never migrates or resets.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import puppeteer from 'puppeteer-core';
import * as XLSX from '@e965/xlsx';
import { PDFDocument } from 'pdf-lib';
const host = process.env.SQL_HOST,
  database = process.env.SQL_DB_NAME,
  executablePath = process.env.CHROME_EXECUTABLE_PATH;
if (
  process.env.EQUITY_ACCEPTANCE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  database !== 'equity_acceptance_synthetic_test' ||
  !process.env.SQL_ADMIN_USER ||
  !executablePath
)
  throw Error(
    'Requires EQUITY_ACCEPTANCE_SYNTHETIC=YES, loopback SQL_HOST, exact SQL_DB_NAME=equity_acceptance_synthetic_test, SQL_ADMIN_USER and CHROME_EXECUTABLE_PATH. Never use a live database.',
  );
const root = fileURLToPath(new URL('..', import.meta.url)),
  out = root + 'docs/audits/partner-equity-acceptance-evidence/',
  port = Number(process.env.EQUITY_ACCEPTANCE_PORT ?? 4194),
  sqlPort = Number(process.env.SQL_PORT ?? 5432);
if (![port, sqlPort].every((p) => Number.isInteger(p) && p >= 1024 && p <= 65535))
  throw Error('Invalid local port');
const source = JSON.parse(
  await readFile(root + 'scripts/fixtures/partner-equity-source-baseline.json', 'utf8'),
);
const suffix = randomUUID().slice(0, 8),
  password = randomBytes(32).toString('base64url'),
  base = `http://127.0.0.1:${port}`;
const pool = new pg.Pool({
  host,
  port: sqlPort,
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
  ssl: false,
});
const env = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '0.0.0.0',
  PORT: String(port),
  SQL_SSL: 'false',
  LOG_LEVEL: 'silent',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: base,
  ADMIN_USERNAME: `equity_platform_${suffix}`,
  ADMIN_EMAIL: `equity_platform_${suffix}@example.test`,
  ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
  ADMIN_FULL_NAME: 'Disposable acceptance platform admin',
};
let server,
  browser,
  phase = 'setup',
  tenant,
  facility;
const checks = [],
  errors = [],
  requests = [],
  accounts = {};
const check = (value, label, detail = {}) => {
  if (!value) throw Error(label);
  checks.push({ operation: label, status: 'PASS', ...detail });
  console.log('PASS ' + label);
};
const idle = (page) => page.waitForNetworkIdle({ idleTime: 350, timeout: 20000 });
const click = async (page, label, scope = 'button') => {
  const handle = await page.evaluateHandle(
    (text, sel) =>
      Array.from(document.querySelectorAll(sel)).find((x) => x.textContent.trim() === text),
    label,
    scope,
  );
  const element = handle.asElement();
  if (!element) throw Error('Button not found: ' + label);
  await element.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await element.click();
  await handle.dispose();
};
const fill = async (page, label, value, scope = '#equity-presentation') => {
  const marker = 'accept-' + randomUUID();
  const found = await page.evaluate(
    (s, t, m) => {
      const l = Array.from(document.querySelector(s)?.querySelectorAll('label') ?? []).find((e) =>
        e.textContent.trim().startsWith(t),
      );
      const input = l?.querySelector('input,select');
      if (!input) return false;
      input.setAttribute('data-acceptance-field', m);
      return input.tagName;
    },
    scope,
    label,
    marker,
  );
  if (!found) throw Error('Field not found: ' + label);
  if (found === 'SELECT') await page.select(`[data-acceptance-field="${marker}"]`, String(value));
  else if (await page.$eval(`[data-acceptance-field="${marker}"]`, (el) => el.type === 'date')) {
    await page.$eval(
      `[data-acceptance-field="${marker}"]`,
      (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      String(value),
    );
  } else await page.locator(`[data-acceptance-field="${marker}"]`).fill(String(value));
};
const reason = async (page, value) =>
  page.locator('[aria-label="Equity audit reason"]').fill(value);
const act = async (page, label, path, method = 'POST', status = 200, scope = 'button') => {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === method,
  );
  await click(page, label, scope);
  const r = await response;
  if (r.status() !== status)
    throw Error(`${label}: ${r.status()} ${(await r.text()).slice(0, 300)}`);
  await idle(page);
  return r;
};
const row = async (id) =>
  (
    await pool.query(
      'SELECT *,start_date::text,end_date::text FROM equity_statements WHERE id=$1 AND facility_id=$2',
      [id, facility],
    )
  ).rows[0];
const http = async (session, path, method = 'GET', body, raw = false) => {
  const token = await session.page.evaluate(() => localStorage.getItem('syrona_session_token'));
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': raw ? 'application/pdf' : 'application/json' } : {}),
    },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const data = await r.json();
  requests.push({
    phase,
    method,
    path,
    status: r.status,
    ...(data.error ? { error: data.error } : {}),
  });
  return { status: r.status, data };
};
const norm = (v) =>
  v === null || v === '' || v === '—'
    ? null
    : Number(String(v).replaceAll(',', '').replace('KES', '').replace('%', '').trim()).toFixed(2);
const grid = (page) =>
  page.$$eval('table[aria-label="Partner equity statement"] tbody tr', (rows) =>
    rows.map((tr) =>
      Array.from(tr.querySelectorAll('td')).map(
        (td) => td.querySelector('input')?.value ?? td.textContent.trim(),
      ),
    ),
  );
const compare = async (page, file) => {
  const actual = (await grid(page)).map((r) => r.map(norm)),
    expected = Object.values(source.rows);
  const records = Object.keys(source.rows).map((key, i) => ({
    row: key,
    expected: expected[i],
    actual: actual[i],
    passed: JSON.stringify(actual[i]) === JSON.stringify(expected[i]),
  }));
  await writeFile(out + file, JSON.stringify(records, null, 2) + '\n');
  check(
    records.every((x) => x.passed),
    'All 84 supplied baseline cells match the actual grid',
    { evidence: file },
  );
};
const open = async (page) => {
  await click(page, 'Accounting & Finance', 'aside button');
  await click(page, 'Financial Reports');
  await click(page, 'Partners’ Equity Statement');
  await page.waitForSelector('#equity-presentation');
  await idle(page);
};
const login = async (kind) => {
  phase = kind;
  const downloadPath = root + '.tmp-tools/equity-acceptance/downloads/' + suffix + '/' + kind;
  await mkdir(downloadPath, { recursive: true });
  const context = await browser.createBrowserContext({
      downloadBehavior: { policy: 'allow', downloadPath },
    }),
    page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1050 });
  page.on('dialog', (dialog) => void dialog.accept());
  page.on('pageerror', (e) => errors.push({ phase: kind, error: e.name }));
  page.on('response', (r) => {
    if (r.url().startsWith(base + '/api/'))
      requests.push({
        phase: kind,
        method: r.request().method(),
        path: new URL(r.url()).pathname,
        status: r.status(),
      });
  });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', accounts[kind].name);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelector('aside')?.innerText.includes('Accounting & Finance'),
    { timeout: 30000 },
  );
  await open(page);
  return { page, context, downloadPath };
};
const downloaded = async (session, id, format, filename) => {
  const path = session.downloadPath + `/partner-equity-${id}.${format}`;
  for (let i = 0; i < 100; i++) {
    try {
      const bytes = await readFile(path);
      if (bytes.length) {
        await rename(path, out + filename);
        return bytes;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await delay(100);
  }
  throw Error('Actual browser download was not completed: ' + format);
};
const choose = async (session, id, year = 2026) => {
  await session.page.locator('[aria-label="Statement financial year"]').fill(String(year));
  await idle(session.page);
  const selector = '#equity-presentation [aria-label="Statement period controls"] select';
  if ((await session.page.$eval(selector, (el) => el.value)) !== String(id))
    await session.page.select(selector, String(id));
  await idle(session.page);
  await session.page.waitForSelector('table[aria-label="Partner equity statement"]');
};
const shot = async (page, name, selector = '#equity-presentation') => {
  await page.$eval(selector, (e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: out + name, fullPage: true });
};
try {
  await mkdir(out, { recursive: true });
  const objects = (
    await pool.query(
      "SELECT to_regclass('equity_statements') AS statements,to_regclass('equity_partner_register') AS register,to_regclass('equity_events') AS events",
    )
  ).rows[0];
  check(Object.values(objects).every(Boolean), 'Required schema exists in disposable database');
  const boot = spawnSync('./node_modules/.bin/tsx', ['src/bootstrap-admin.ts'], {
    cwd: root,
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  if (boot.status !== 0) throw Error('Disposable secure bootstrap failed');
  tenant = (
    await pool.query("INSERT INTO tenants(name,slug,currency) VALUES($1,$2,'KES') RETURNING id", [
      'Disposable acceptance tenant',
      `equity-acceptance-${suffix}`,
    ])
  ).rows[0].id;
  facility = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,\'Disposable partners equity acceptance facility\',\'["registration","accounting"]\') RETURNING id',
      [tenant, `EA-${suffix}`],
    )
  ).rows[0].id;
  const hash = await argon2.hash(password);
  for (const [kind, permissions] of Object.entries({
    preparer: ['manage', 'partners', 'review', 'approve', 'export', 'audit'],
    reviewer: ['review', 'audit'],
    approver: ['approve', 'export', 'audit'],
    reader: [],
  })) {
    const name = `equity_${kind}_${suffix}`,
      fullName = `Disposable ${kind} acceptance officer`;
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,$4,'ACTIVE',$5,$6) RETURNING id",
        [name, `${name}@example.test`, fullName, hash, tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, kind === 'preparer' ? 'FACILITY_ADMIN' : `EQUITY_ACCEPTANCE_${kind}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    const codes = [
      'accounting.read',
      'accounting.equity.read',
      ...permissions.map((p) => 'accounting.equity.' + p),
      ...(kind === 'preparer' ? ['facility.branding.read', 'facility.branding.manage'] : []),
    ];
    for (const code of codes) {
      await pool.query(
        'INSERT INTO permissions(code,name,module) VALUES($1,$1,$2) ON CONFLICT(code) DO NOTHING',
        [code, code.startsWith('accounting.') ? 'accounting' : 'configuration'],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    accounts[kind] = { id, name, fullName };
  }
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('App startup timeout')), 30000);
    server.stdout.on('data', (b) => {
      log += b;
      if (log.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', () => {});
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error('App exited ' + code));
    });
  });
  check((await fetch(base + '/api/ready')).status === 200, 'Actual Express application is ready');
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args:
      process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((k) => process.env[k] !== undefined)
        .map((k) => [k, process.env[k]]),
    ),
  });
  const prep = await login('preparer'),
    p = prep.page;
  phase = 'create';
  await reason(p, 'Create source-period draft for disposable functional acceptance');
  await click(p, 'Create statement / period');
  await act(p, 'Create saved draft', '/api/partner-equity/statements', 'POST', 201);
  await p.waitForSelector('[aria-label="Lucy Wanjiku opening"]');
  let saved = (
    await pool.query('SELECT id FROM equity_statements WHERE facility_id=$1', [facility])
  ).rows[0];
  const original = saved.id;
  check(Boolean(original), 'Create statement through actual UI persists a draft');
  check(
    JSON.stringify(
      await p.$$eval('table thead th', (els) => els.slice(1, -1).map((x) => x.textContent.trim())),
    ) === JSON.stringify(source.partners),
    'All five original partner names and order',
  );
  await compare(p, 'baseline-comparison.json');
  saved = await row(original);
  check(
    saved.financial_year === 2026 &&
      saved.start_date === source.startDate &&
      saved.end_date === source.endDate,
    'July 2025–June 2026 period and financial year preserved',
  );
  const meta = await http(prep, `/api/partner-equity/statements/${original}`);
  check(
    meta.data.facility_name === 'Disposable partners equity acceptance facility' &&
      meta.data.facility_currency === 'KES' &&
      (await p.$eval('#equity-presentation header', (e) =>
        e.textContent.includes('Facility currency (tenant setting): KES'),
      )),
    'Actual authenticated facility name, ID and configured currency are shown',
  );
  check(
    await p.$eval('#equity-presentation header', (e) => e.textContent.includes('PROVISIONAL')),
    'Provisional formula warning is visible',
  );
  await shot(p, '01-source-period.png');
  phase = 'edit';
  const titles = await p.$$eval('svg title', (els) => els.map((e) => e.textContent));
  await p.locator('[aria-label="Lucy Wanjiku capital"]').fill('1133123.45');
  await p.locator('[aria-label="Statement net result"]').fill('-2353000.00');
  await p.locator('[aria-label="Lucy Wanjiku interest"]').fill('0.00');
  await reason(p, 'Correct test capital and net result using reviewed synthetic bank advice');
  check(
    (await p.$$eval('svg title', (els) => els.map((e) => e.textContent).join('|'))) !==
      titles.join('|'),
    'Monetary edits recalculate live charts',
  );
  check(
    await p.$$eval('button', (els) =>
      els.filter((e) => e.textContent.trim() === 'CSV export').every((e) => e.disabled),
    ),
    'Unsaved edits block saved-statement export',
  );
  await act(p, 'Save draft inputs', `/api/partner-equity/statements/${original}`, 'PUT');
  saved = await row(original);
  check(
    saved.model.inputs['original-1'].capital === '1133123.45' &&
      saved.model.inputs['original-1'].interest === '0.00',
    'Edited inputs and confirmed zero save to PostgreSQL',
  );
  await p.reload({ waitUntil: 'networkidle2' });
  await open(p);
  await p.waitForSelector('[aria-label="Lucy Wanjiku capital"]');
  check(
    (await p.$eval('[aria-label="Lucy Wanjiku capital"]', (e) => e.value)) === '1133123.45',
    'Browser reload retrieves the saved edited draft',
  );
  let payload = (await http(prep, `/api/partner-equity/statements/${original}`)).data;
  check(
    payload.calculation.totals.closing === '2605523.44' &&
      payload.model.inputs['original-2'].interest === null,
    'Edited calculations reconcile while zero and unspecified remain distinct',
  );
  check(
    (await p.$$eval('#equity-presentation svg[role="img"]', (els) => els.length === 5)) &&
      (await p.$eval(
        'svg[aria-label="Partner profit/loss allocation"] g',
        (el, amount) => el.getAttribute('aria-label').includes(amount),
        Number(payload.calculation.cells.allocation['original-1']).toLocaleString('en-KE', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      )),
    'All five charts remain mounted and saved allocation chart matches the recalculated amount',
  );
  const editedDownload = p.waitForResponse((r) =>
    r.url().includes(`/statements/${original}/export?format=csv`),
  );
  await click(p, 'CSV export');
  let download = await editedDownload;
  check(download.status() === 200, 'Generate saved edited CSV');
  await downloaded(prep, original, 'csv', '02-edited-saved-zero.csv');
  await idle(p);
  await p.locator('[aria-label="Lucy Wanjiku capital"]').fill('1133000.00');
  await p.locator('[aria-label="Statement net result"]').fill('-2353704.47');
  await p.focus('[aria-label="Lucy Wanjiku interest"]');
  await p.keyboard.down('Control');
  await p.keyboard.press('KeyA');
  await p.keyboard.up('Control');
  await p.keyboard.press('Backspace');
  await reason(p, 'Restore the unchanged source baseline after isolated recalculation checks');
  await act(p, 'Save draft inputs', `/api/partner-equity/statements/${original}`, 'PUT');
  phase = 'validation';
  saved = await row(original);
  check(
    saved.model.inputs['original-1'].interest === null,
    'Clearing a confirmed zero restores explicit unspecified provenance',
  );
  await p.locator('[aria-label="Lucy Wanjiku opening"]').fill('=1+1');
  check(
    (await p.$eval(
      '[aria-label="Lucy Wanjiku opening"]',
      (e) => e.getAttribute('aria-invalid') === 'true',
    )) &&
      (await p.$$eval(
        'button',
        (els) => els.find((e) => e.textContent.trim() === 'Save draft inputs').disabled,
      )),
    'Invalid formula-like input is rejected by the actual UI',
  );
  await click(p, 'Reload saved statement');
  await idle(p);
  let bad = structuredClone(saved.model);
  bad.inputs['original-1'].opening = '1e4';
  let r = await http(prep, `/api/partner-equity/statements/${original}`, 'PUT', {
    version: saved.version,
    model: bad,
    reason: 'Reject unsafe input during disposable validation acceptance',
  });
  check(
    r.status === 400 && (await row(original)).version === saved.version,
    'Server rejects invalid monetary input without persisting changes',
  );
  r = await http(prep, `/api/partner-equity/statements/${original}`, 'PUT', {
    version: saved.version,
    model: saved.model,
    reason: accounts.preparer.name,
  });
  check(
    r.status === 400 &&
      r.data.error === 'MEANINGFUL_AUDIT_REASON_REQUIRED' &&
      (await row(original)).version === saved.version,
    'Username-only audit explanation is rejected atomically',
  );
  r = await http(prep, '/api/partner-equity/statements', 'POST', {
    financialYear: 2027,
    periodKind: 'ANNUAL',
    periodName: 'Invalid source copy',
    startDate: '2026-07-01',
    endDate: '2027-06-30',
    source: 'SYRONA_SCREENSHOT',
    reason: 'Verify source figures cannot be reused in a different year',
  });
  check(
    r.status === 400,
    'Source-period validation rejects copying the screenshot into another year',
  );
  phase = 'stale-save';
  const stale = await login('preparer');
  await stale.page.waitForSelector('[aria-label="Lucy Wanjiku capital"]');
  await p.locator('[aria-label="Lucy Wanjiku capital"]').fill('1133001.00');
  await reason(p, 'Record one synthetic shilling to exercise concurrent edit protection');
  await act(p, 'Save draft inputs', `/api/partner-equity/statements/${original}`, 'PUT');
  await stale.page.locator('[aria-label="Lucy Wanjiku capital"]').fill('1133002.00');
  await reason(stale.page, 'Attempt stale independent edit without overwriting the newer receipt');
  const conflict = stale.page.waitForResponse(
    (x) =>
      new URL(x.url()).pathname === `/api/partner-equity/statements/${original}` &&
      x.request().method() === 'PUT',
  );
  await click(stale.page, 'Save draft inputs');
  check((await conflict).status() === 409, 'Stale browser save receives a real HTTP conflict');
  await idle(stale.page);
  check(
    (await stale.page.$eval('#equity-presentation', (e) =>
      e.textContent.includes('Unsaved / unverified'),
    )) && (await row(original)).model.inputs['original-1'].capital === '1133001.00',
    'Stale UI fails closed and preserves the winning saved values',
  );
  await stale.context.close();
  await p.locator('[aria-label="Lucy Wanjiku capital"]').fill('1133000.00');
  await reason(p, 'Restore exact source baseline after verified concurrent-save rejection');
  await act(p, 'Save draft inputs', `/api/partner-equity/statements/${original}`, 'PUT');
  await compare(p, 'restored-baseline-comparison.json');
  phase = 'partner-register';
  await click(p, 'Partner register');
  await click(p, 'Add partner');
  let scope = 'section[aria-label="Partner register"] form:last-of-type';
  await fill(p, 'Name', 'Synthetic additional equity partner', scope);
  await fill(p, 'Admission', '2025-08-01', scope);
  await reason(p, 'Register an additional synthetic partner with an explicit admission date');
  await act(
    p,
    'Save partner details',
    '/api/partner-equity/partners',
    'PUT',
    200,
    scope + ' button',
  );
  let directory = (await http(prep, '/api/partner-equity/partners')).data;
  const added = directory.partners.find((x) => x.name === 'Synthetic additional equity partner');
  check(
    Boolean(added) && added.order >= 5 && added.admittedOn === '2025-08-01',
    'Partner creation saves effective dates without changing the original five',
  );
  scope = `section[aria-label="Partner register"] form:has([aria-label="Partner name ${added.id}"])`;
  await fill(p, 'Name', 'Synthetic additional equity partner corrected', scope);
  await reason(p, 'Correct the synthetic partner display name before period inclusion');
  let form = await p.$(scope);
  let buttons = await form.$$('button');
  await buttons[0].click();
  await idle(p);
  directory = (await http(prep, '/api/partner-equity/partners')).data;
  check(
    directory.partners.find((x) => x.id === added.id).name.endsWith('corrected'),
    'Partner editing persists the corrected register name',
  );
  await fill(p, 'Departure', '2026-06-30', scope);
  const active = await p.$(`${scope} input[type="checkbox"]`);
  await active.click();
  await reason(p, 'Archive the synthetic partner at the documented effective departure date');
  form = await p.$(scope);
  buttons = await form.$$('button');
  await buttons[0].click();
  await idle(p);
  directory = (await http(prep, '/api/partner-equity/partners')).data;
  check(
    directory.partners.find((x) => x.id === added.id).active === false &&
      directory.partners.find((x) => x.id === added.id).departedOn === '2026-06-30' &&
      (await row(original)).model.partners.length === 5,
    'Partner archival retains the register and historical five-partner statement',
  );
  await shot(p, '03-partner-register.png', 'section[aria-label="Partner register"]');
  await click(p, 'Partner register');
  phase = 'review-approval';
  await reason(p, 'Submit the reconciled source-period draft for independent provisional review');
  await act(p, 'Submit for review', `/api/partner-equity/statements/${original}/workflow`);
  saved = await row(original);
  r = await http(prep, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'review',
    acceptance: 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
    reason: 'Attempt self review to verify independent financial control',
  });
  check(r.status === 409, 'Preparer cannot review their own financial inputs');
  const reader = await login('reader');
  r = await http(reader, `/api/partner-equity/statements/${original}`, 'PUT', {
    version: saved.version,
    model: saved.model,
    reason: 'Verify read-only account cannot change financial inputs',
  });
  check(r.status === 403, 'Read-only account cannot save financial inputs');
  r = await http(reader, `/api/partner-equity/statements/${original}/export?format=csv`);
  check(r.status === 403, 'Read-only account cannot export without explicit export authority');
  r = await http(reader, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'review',
    acceptance: 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
    reason: 'Attempt read-only review without the required workflow permission',
  });
  check(r.status === 403, 'Read-only account is denied review by the actual server');
  r = await http(reader, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'approve',
    reason: 'Attempt read-only approval without financial approval authority',
  });
  check(r.status === 403, 'Read-only account is denied approval by the actual server');
  const approver = await login('approver');
  r = await http(approver, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'approve',
    reason: 'Verify approval is blocked until independent formula review is recorded',
  });
  check(r.status === 409, 'Approval before explicit formula review is rejected');
  const reviewer = await login('reviewer');
  r = await http(reviewer, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'approve',
    reason: 'Verify review authority does not implicitly grant approval',
  });
  check(r.status === 403, 'Review-only role cannot approve');
  r = await http(approver, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'review',
    acceptance: 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
    reason: 'Verify approval authority does not implicitly grant formula review',
  });
  check(r.status === 403, 'Approval-only role cannot record formula review');
  r = await http(reviewer, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'review',
    acceptance: 'NOT ACCEPTED',
    reason: 'Verify an incorrect provisional-formula acceptance phrase is rejected',
  });
  check(r.status === 400, 'Incorrect formula acceptance phrase is rejected');
  const reviewReason =
    'Independently reconcile screenshot amounts and accept documented provisional proportional rules';
  await reason(reviewer.page, reviewReason);
  await fill(reviewer.page, 'Formula acceptance phrase', 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS');
  await act(
    reviewer.page,
    'Accept provisional definitions',
    `/api/partner-equity/statements/${original}/workflow`,
  );
  saved = await row(original);
  check(
    saved.reviewed_by === accounts.reviewer.id &&
      saved.review_acceptance === reviewReason &&
      Boolean(saved.reviewed_at),
    'Explicit independent provisional acceptance is recorded with actor, reason and date',
  );
  await shot(
    reviewer.page,
    '04-reviewed-formulas.png',
    '[aria-label="Statement approval workflow"]',
  );

  r = await http(prep, `/api/partner-equity/statements/${original}/workflow`, 'POST', {
    version: saved.version,
    action: 'approve',
    reason: 'Verify last financial editor cannot self approve independently reviewed amounts',
  });
  check(r.status === 409, 'Last financial editor cannot approve their own reviewed statement');
  await click(approver.page, 'Reload saved statement');
  await idle(approver.page);
  await reason(
    approver.page,
    'Approve the independently reviewed source-period statement with known rounding disclosures',
  );
  await act(
    approver.page,
    'Approve reviewed statement',
    `/api/partner-equity/statements/${original}/workflow`,
  );
  saved = await row(original);
  check(
    saved.status === 'APPROVED' &&
      saved.approved_by === accounts.approver.id &&
      Boolean(saved.approved_at),
    'Authorized independent approval persists immutable status and approval identity',
  );
  r = await http(prep, `/api/partner-equity/statements/${original}`, 'PUT', {
    version: saved.version,
    model: saved.model,
    reason: 'Verify approved statement cannot be edited without a controlled revision',
  });
  check(
    r.status === 409 && (await row(original)).version === saved.version,
    'Direct edit of an approved statement is refused without changing its version',
  );
  await compare(approver.page, 'approved-baseline-comparison.json');
  phase = 'exports';
  const letter = await PDFDocument.create();
  let letterPage = letter.addPage([595.28, 841.89]);
  letterPage.drawCircle({ x: 48, y: 809, size: 13 });
  letterPage.drawText('DISPOSABLE EQUITY ACCEPTANCE FACILITY', { x: 72, y: 805, size: 13 });
  letterPage.drawText('Synthetic letterhead only - not a live facility asset', {
    x: 36,
    y: 782,
    size: 9,
  });
  const head = Buffer.from(await letter.save());
  r = await http(
    prep,
    `/api/facility-branding/facilities/${facility}/letterheads?filename=acceptance-synthetic.pdf&bodyTopPt=90&bodyBottomPt=55&bodyLeftPt=36&bodyRightPt=36`,
    'POST',
    head,
    true,
  );
  if (r.status !== 201) throw Error('Test letterhead upload failed ' + JSON.stringify(r));
  const headId = r.data.letterhead.id;
  r = await http(
    prep,
    `/api/facility-branding/facilities/${facility}/letterheads/${headId}/activate`,
    'POST',
    { reason: 'Activate disposable letterhead solely for statement export acceptance' },
  );
  check(
    r.status === 200,
    'Activate a synthetic facility-scoped letterhead through authenticated API',
  );
  const exportFiles = [];
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const waiting = approver.page.waitForResponse((x) =>
      x.url().includes(`/statements/${original}/export?format=${format}`),
    );
    await click(approver.page, format.toUpperCase() + ' export');
    const response = await waiting;
    check(
      response.status() === 200,
      `Generate ${format.toUpperCase()} from the actual saved approved statement`,
    );
    const filename = `05-approved-baseline.${format}`;
    const bytes = await downloaded(approver, original, format, filename);
    exportFiles.push({ format, file: filename, bytes: bytes.length });
    await idle(approver.page);
    if (format === 'pdf') {
      check((await PDFDocument.load(bytes)).getPageCount() > 0, 'PDF has readable document pages');
      continue;
    }
    const wb = XLSX.read(format === 'csv' ? bytes.toString() : bytes, {
      type: format === 'csv' ? 'string' : 'buffer',
      raw: true,
      cellNF: true,
    });
    const sheet = wb.Sheets[format === 'csv' ? wb.SheetNames[0] : 'Partners equity'];
    const matrix = XLSX.utils
      .sheet_to_json(sheet, { header: 1, defval: null, raw: true })
      .slice(1, 15)
      .map((row, i) =>
        row
          .slice(1, 7)
          .map((v) =>
            norm(
              format === 'xlsx' && [5, 13].includes(i) && typeof v === 'number'
                ? Math.round(v * 1000000) / 10000
                : v,
            ),
          ),
      );
    check(
      JSON.stringify(matrix) === JSON.stringify(Object.values(source.rows)),
      `${format.toUpperCase()} contains all 84 SAVED baseline values`,
    );
    const text =
      format === 'csv'
        ? bytes.toString()
        : JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets['Formula audit'], { header: 1 }));
    check(
      text.includes('PROVISIONAL') &&
        text.includes(reviewReason) &&
        text.includes('Unspecified inputs'),
      `${format.toUpperCase()} includes formula warning, review acceptance and null provenance`,
    );
  }
  await writeFile(out + 'export-results.json', JSON.stringify(exportFiles, null, 2) + '\n');
  payload = (await http(approver, `/api/partner-equity/statements/${original}`)).data;
  check(
    payload.calculation.exactAllocationDifference === '0.00' &&
      payload.calculation.exactClosingDifference === '0.00' &&
      JSON.stringify(payload.calculation.rounding) ===
        JSON.stringify({
          sharingBasisPoints: '1',
          allocationCents: '-1',
          closingCents: '-1',
          ownershipBasisPoints: '-1',
        }) &&
      payload.calculation.unspecified === 27,
    'Exact reconciliation and all four source rounding differences are preserved',
  );
  phase = 'second-period-carry';
  await click(p, 'Reload saved statement');
  await idle(p);
  await reason(p, 'Create the next annual period without implicitly carrying any prior balances');
  await click(p, 'Create statement / period');
  const createScope = 'form[aria-label="Create financial statement"]';
  await fill(p, 'Ending financial year', '2027', createScope);
  await fill(p, 'Period name', 'July 2026 – June 2027', createScope);
  await fill(p, 'Start date', '2026-07-01', createScope);
  await fill(p, 'End date', '2027-06-30', createScope);
  await fill(p, 'Initial data', 'BLANK', createScope);
  await act(p, 'Create saved draft', '/api/partner-equity/statements', 'POST', 201);
  const next = (
    await pool.query(
      'SELECT id FROM equity_statements WHERE facility_id=$1 AND financial_year=2027',
      [facility],
    )
  ).rows[0].id;
  let target = await row(next);
  check(
    target.model.inputs['original-1'].opening === null &&
      target.model.partners.length === 5 &&
      (await row(original)).status === 'APPROVED',
    'Second annual period persists separately with no automatic opening carry',
  );
  await p.locator('[aria-label="Carry source statement ID"]').fill(String(original));
  await act(
    p,
    'Preview opening balances',
    `/api/partner-equity/statements/${next}/carry-preview`,
    'GET',
  );
  check(
    (await row(next)).version === target.version,
    'Opening-balance preview performs no financial write',
  );
  await fill(p, 'Type CARRY REVIEWED OPENING BALANCES', 'CARRY REVIEWED OPENING BALANCES');
  await reason(
    p,
    'Carry reviewed partner closing balances and acknowledge the disclosed one-cent display difference',
  );
  await act(
    p,
    'Confirm opening-balance carry-forward',
    `/api/partner-equity/statements/${next}/carry`,
  );
  target = await row(next);
  check(
    target.carry_source_id === original &&
      source.partners.every(
        (_, i) => target.model.inputs[`original-${i + 1}`].opening === source.rows.closing[i],
      ),
    'Confirmed carry-forward saves exactly the reviewed per-partner closing amounts',
  );
  const carryEvent = (
    await pool.query(
      "SELECT new_values FROM equity_events WHERE facility_id=$1 AND statement_id=$2 AND action='CARRY_FORWARD'",
      [facility, next],
    )
  ).rows[0];
  check(
    carryEvent.new_values.carryReview.sourceId === original &&
      carryEvent.new_values.carryReview.displayRoundingCents === '-1',
    'Carry audit retains approved source version and explicit rounding acknowledgement',
  );
  await shot(p, '06-reviewed-carry-forward.png');
  await choose(prep, original, 2026);
  check(
    (await p.$('[aria-label="Lucy Wanjiku opening"]')) === null,
    'Approved statement renders non-editable values after period switching',
  );
  await shot(p, '07-approved-desktop.png', 'table[aria-label="Partner equity statement"]');
  await p.setViewport({ width: 390, height: 844 });
  await p.$eval('table[aria-label="Partner equity statement"]', (e) =>
    e.scrollIntoView({ block: 'start' }),
  );
  const widths = await p.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    table: document.querySelector('[aria-label="Scrollable partner equity statement"]').scrollWidth,
  }));
  check(
    widths.document <= widths.viewport + 1 && widths.table > widths.viewport,
    'Mobile statement overflow is contained in its own scrollable grid',
  );
  await p.$eval('[aria-label="Scrollable partner equity statement"]', (el) => {
    el.scrollTop = el.scrollHeight;
    el.scrollLeft = 0;
  });
  await p.screenshot({ path: out + '08a-approved-mobile-labels.png', fullPage: true });
  await p.$eval(
    '[aria-label="Scrollable partner equity statement"]',
    (e) => (e.scrollLeft = e.scrollWidth),
  );
  check(
    await p.$eval(
      '[aria-label="Scrollable partner equity statement"]',
      (el) => el.scrollTop > 0 && el.scrollLeft > 0,
    ),
    'Mobile scroll reaches the closing/ownership rows and rightmost totals',
  );
  await p.screenshot({ path: out + '08-approved-mobile.png', fullPage: true });
  const events = (
    await pool.query(
      'SELECT action,actor_id,reason,created_at FROM equity_events WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id',
      [tenant, facility],
    )
  ).rows;
  check(
    events.every(
      (e) => !Object.values(accounts).some((a) => e.reason === a.name || e.reason === a.fullName),
    ),
    'All persisted financial audit explanations are meaningful operation reasons, not usernames',
  );
  await writeFile(out + 'audit-events.json', JSON.stringify(events, null, 2) + '\n');
  check(errors.length === 0, 'No uncaught runtime errors during real application acceptance');
  checks.push({
    operation: 'Is live facility label fido the intended authorized facility?',
    status: 'BLOCKED',
    detail:
      'No live session or production identity inspection. Requires owner confirmation; no identity changed.',
  });
  await writeFile(
    out + 'results.json',
    JSON.stringify(
      {
        actualApplication: true,
        inMemoryAdapters: false,
        disposableDataOnly: true,
        productionVerified: false,
        checks,
        errors,
        requests,
        facility: {
          id: facility,
          name: 'Disposable partners equity acceptance facility',
          currency: 'KES',
        },
        statementIds: { original, next },
        mobile: widths,
      },
      null,
      2,
    ) + '\n',
  );
  await rm(out + 'failure.json', { force: true });
} catch (e) {
  await mkdir(out, { recursive: true });
  await writeFile(
    out + 'failure.json',
    JSON.stringify({ phase, error: e.message, checks, errors, requests }, null, 2) + '\n',
  );
  throw e;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(timer);
  }
  await pool.end();
}
