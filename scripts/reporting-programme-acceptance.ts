/** Real built SPA, real PostgreSQL/HTTP, normal staff login and native browser downloads. */
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Page, type ElementHandle } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../src/db/index.ts';
import {
  createReportingMovementsFixture,
  assertReportingScratch,
} from '../src/tests/integration/support/reporting-movements.fixture.ts';

if (process.env.REPORTING_PROGRAMME_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic reporting acceptance and Chromium required');
await assertReportingScratch(pool);
const out = path.resolve(
    process.env.REPORTING_PROGRAMME_EVIDENCE_DIR ??
      'docs/audits/reporting-programme-batch-1-evidence',
  ),
  downloads = path.resolve('.tmp-tools/reporting-native-downloads'),
  base = 'http://127.0.0.1:4196';
const checks: string[] = [],
  errors: string[] = [];
const check = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
  checks.push(message);
  console.log('PASS', message);
};
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined,
  server: ReturnType<typeof spawn> | undefined;
async function click(page: Page, text: string, selector = 'button') {
  const handle = await page.evaluateHandle(
    (sel, txt) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(sel)).find(
        (e) => e.textContent?.trim() === txt && !e.disabled,
      ),
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw Error('Missing button: ' + text);
  await (el as ElementHandle<Element>).click();
  await handle.dispose();
}
async function containsClick(page: Page, text: string) {
  const handle = await page.evaluateHandle(
    (txt) =>
      Array.from(document.querySelectorAll('button')).find((e) => e.textContent?.includes(txt)),
    text,
  );
  if (!handle.asElement()) throw Error('Missing navigation: ' + text);
  await (handle.asElement() as ElementHandle<Element>).click();
  await handle.dispose();
}
async function fill(page: Page, label: string, value: string) {
  const handle = await page.evaluateHandle(
    (txt) =>
      Array.from(document.querySelectorAll('label'))
        .find((e) => e.textContent?.trim().startsWith(txt))
        ?.querySelector('input'),
    label,
  );
  if (!handle.asElement()) throw Error('Missing field: ' + label);
  await handle.asElement()!.evaluate((e, v) => {
    const input = e as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await handle.dispose();
}
try {
  await mkdir(out, { recursive: true });
  await mkdir(downloads, { recursive: true });
  const f = await createReportingMovementsFixture(pool);
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4196',
    APP_BASE_URL: base,
    SQL_SSL: 'false',
    LOG_LEVEL: 'silent',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ADMIN_USERNAME: 'reporting_platform_' + f.suffix,
    ADMIN_EMAIL: `reporting_platform_${f.suffix}@example.test`,
    ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
    ADMIN_FULL_NAME: 'Synthetic reporting platform administrator',
  };
  check(
    spawnSync('node', ['build/scripts/bootstrap-admin.js'], {
      env,
      stdio: 'ignore',
      timeout: 30000,
    }).status === 0,
    'Disposable secure platform bootstrap',
  );
  server = spawn('node', ['build/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('Built app startup timeout')), 30000);
    server!.stdout!.on('data', (b) => {
      text += b;
      if (text.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server!.stderr!.on('data', () => {});
    server!.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Built app failed to start'));
    });
  });
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH']
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]!]),
    ),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1660, height: 1100 });
  page.on('pageerror', (e) => errors.push(e instanceof Error ? e.name : 'Unknown browser error'));
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
    eventsEnabled: true,
  });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[name="identifier"]', f.full.username);
  await page.type('input[name="password"]', f.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside');
  const token = await page.evaluate(() => localStorage.getItem('syrona_session_token'));
  check(Boolean(token), 'Real normal staff username/password login');
  async function api(
    url: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const raw = Buffer.isBuffer(body);
    const response = await fetch(base + url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw ? new Uint8Array(body as Buffer) : body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  await click(page, 'Reporting Centre', 'aside button');
  await containsClick(page, 'STOCK / GOODS');
  await containsClick(page, 'Stock movements');
  await page.waitForSelector('input[type="date"]');
  check(
    await page.$eval('body', (e) =>
      e.textContent?.includes('Item net quantity sums signed deltas'),
    ),
    'Existing catalogue opens real stock movement workbench',
  );
  await fill(page, 'Recorded movement date from', f.filters.from);
  await fill(page, 'Recorded movement date to', f.filters.to);
  async function generate(expected: number) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/reporting/centre/inventory-movements/generate') &&
        r.request().method() === 'POST',
    );
    await click(page, 'Generate report');
    const r = await response;
    const result = await r.json();
    check(
      r.status() === 200 && result.total === expected,
      `Actual browser query returns ${expected} scoped movement rows`,
    );
    await page.waitForNetworkIdle({ idleTime: 150 });
    return result;
  }
  const result = await generate(5);
  check(
    await page.$eval(
      'table',
      (e) =>
        e.textContent?.includes('Synthetic Alpha') &&
        e.textContent.includes('Synthetic Beta') &&
        !e.textContent.includes('Secret'),
    ),
    'Actual returned source rows displayed without other-facility item metadata',
  );
  check(
    result.rows
      .filter((r: any) => r.item === 'Synthetic Alpha')
      .every((r: any) => r.itemNetQuantity === '7') &&
      result.rows
        .filter((r: any) => r.item === 'Synthetic Beta')
        .every((r: any) => r.itemNetQuantity === '80'),
    'Screen query computes separate per-item signed nets 7 Pieces and 80 mL, never mixed-unit 87',
  );
  await page.screenshot({ path: path.join(out, '01-movement-workbench.png'), fullPage: true });
  await (await page.$('table'))!.screenshot({
    path: path.join(out, '02-actual-movement-rows.png'),
  });
  await page.select('select', 'RECEIPT');
  await generate(2);
  check(
    await page.$eval(
      'table',
      (e) => !e.textContent?.includes('DISPENSE') && !e.textContent?.includes('WRITE_OFF'),
    ),
    'Movement-type filter changes actual displayed rows',
  );
  await page.select('select', '');
  await fill(page, 'Search current item name/code or recorded reference', 'Alpha');
  await generate(2);
  await fill(page, 'Search current item name/code or recorded reference', '');
  await generate(5);
  // The existing scoped item selector must work for the new engine, not just its backend filter.
  const alphaOption = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('label'))
      .find(
        (e) =>
          e.querySelector('input[type="checkbox"]') && e.textContent?.includes('Synthetic Alpha'),
      )
      ?.querySelector('input'),
  );
  if (!alphaOption.asElement()) throw Error('Scoped Alpha item option missing');
  await (alphaOption.asElement() as ElementHandle<Element>).click();
  await generate(2);
  check(
    await page.$eval('table', (e) => !e.textContent?.includes('Synthetic Beta')),
    'Real scoped item selector narrows source records',
  );
  await (alphaOption.asElement() as ElementHandle<Element>).click();
  await generate(5);
  const evidenceDownloads: Array<{
    format: string;
    file: string;
    bytes: number;
    nativeBrowserDownload: boolean;
  }> = [];
  async function download(format: 'pdf' | 'xlsx', label: string) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/reporting/centre/inventory-movements/export') &&
        r.request().method() === 'POST',
    );
    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cdp.off('Browser.downloadProgress', listener);
        reject(Error('Native browser download timeout'));
      }, 30000);
      const listener = (event: { state: string }) => {
        if (event.state === 'completed') {
          clearTimeout(timer);
          cdp.off('Browser.downloadProgress', listener);
          resolve();
        } else if (event.state === 'canceled') {
          clearTimeout(timer);
          cdp.off('Browser.downloadProgress', listener);
          reject(Error('Native download canceled'));
        }
      };
      cdp.on('Browser.downloadProgress', listener);
    });
    await click(page, format === 'xlsx' ? 'Excel' : 'PDF');
    const r = await response;
    const data = await r.json();
    check(r.status() === 200, `Actual ${format} export API succeeds: ${label}`);
    await completed;
    const bytes = await readFile(path.join(downloads, data.filename));
    check(
      bytes.equals(Buffer.from(data.base64, 'base64')),
      `Native ${format} download bytes match authenticated export: ${label}`,
    );
    await writeFile(path.join(out, label + '.' + format), bytes);
    evidenceDownloads.push({
      format,
      file: label + '.' + format,
      bytes: bytes.length,
      nativeBrowserDownload: true,
    });
  }
  await download('pdf', 'movements-before-activation');
  const template = await PDFDocument.create();
  const p = template.addPage([595.28, 841.89]);
  p.drawText('SYNTHETIC REPORTING PROGRAMME MAIN', { x: 36, y: 809, size: 13 });
  p.drawText('Disposable test stationery only', { x: 36, y: 791, size: 9 });
  const branding = `/api/facility-branding/facilities/${f.facility}/letterheads`;
  const uploaded = await api(
    branding +
      '?filename=synthetic-reporting.pdf&bodyTopPt=80&bodyBottomPt=60&bodyLeftPt=36&bodyRightPt=36',
    'POST',
    Buffer.from(await template.save()),
    { 'Content-Type': 'application/pdf', 'X-Filename': 'synthetic-reporting.pdf' },
  );
  check(
    uploaded.status === 201 && uploaded.data.letterhead.status === 'DRAFT',
    'Existing facility letterhead upload stays draft',
  );
  check(
    (
      await api(branding + `/${uploaded.data.letterhead.id}/activate`, 'POST', {
        reason: 'Synthetic batch 1 explicit activation',
      })
    ).status === 200,
    'Existing facility letterhead explicitly activated',
  );
  await download('pdf', 'movements');
  await download('xlsx', 'movements');
  await writeFile(path.join(out, 'report-result.json'), JSON.stringify(result, null, 2) + '\n');
  await fill(page, 'Recorded movement date from', '2026-04-01');
  await fill(page, 'Recorded movement date to', '2026-04-02');
  await generate(0);
  check(
    await page.$eval('body', (e) => e.textContent?.includes('No records match')),
    'Actual browser displays clear empty state',
  );
  await page.screenshot({ path: path.join(out, '03-empty-result.png'), fullPage: true });
  await download('pdf', 'movements-empty');
  await download('xlsx', 'movements-empty');
  await fill(page, 'Recorded movement date from', '2026-01-31');
  await fill(page, 'Recorded movement date to', '2026-01-01');
  const rejected = page.waitForResponse((r) =>
    r.url().endsWith('/api/reporting/centre/inventory-movements/generate'),
  );
  await click(page, 'Generate report');
  check((await rejected).status() === 400, 'Actual browser request rejects reversed dates');
  await page.waitForSelector('[role="alert"]');
  await page.screenshot({ path: path.join(out, '04-date-error.png'), fullPage: true });
  check(
    (
      await api('/api/reporting/centre/inventory-movements/generate', 'POST', {
        ...f.filters,
        facilityId: f.sibling,
      })
    ).status === 403,
    'Normal browser-authenticated session denied sibling-facility report',
  );
  check(
    (
      await api('/api/reporting/centre/inventory-movements/generate', 'POST', {
        ...f.filters,
        facilityId: f.foreignFacility,
      })
    ).status === 403,
    'Normal browser-authenticated session denied foreign-facility report',
  );
  const audit = (
    await pool.query(
      "SELECT action,resource,resource_id,details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='report_centre' AND resource_id='inventory-movements' ORDER BY id",
      [f.tenant, f.facility],
    )
  ).rows;
  check(
    audit.some((r) => r.action === 'EXPORT_REQUEST') && audit.some((r) => r.action === 'VIEW'),
    'Database persists browser report and export audit',
  );
  check(errors.length === 0, 'No uncaught errors during actual browser workflow');
  await writeFile(path.join(out, 'audit-events.json'), JSON.stringify(audit, null, 2) + '\n');
  await writeFile(
    path.join(out, 'results.json'),
    JSON.stringify(
      {
        syntheticOnly: true,
        productionAccess: false,
        actualBuiltApplication: true,
        adapters: false,
        checks,
        errors,
        downloads: evidenceDownloads,
        facility: f.facility,
        engine: 'inventory-movements',
      },
      null,
      2,
    ) + '\n',
  );
  await rm(path.join(out, 'failure.json'), { force: true });
} catch (error) {
  await mkdir(out, { recursive: true });
  if (browser)
    for (const [index, page] of (await browser.pages()).entries())
      await page
        .screenshot({
          path: path.resolve(`.tmp-tools/reporting-failure-${index}.png`),
          fullPage: true,
        })
        .catch(() => {});
  await writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify(
      { error: error instanceof Error ? error.message : 'Unknown', checks, errors },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const exit = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server!.kill('SIGKILL'), 10000);
    await exit;
    clearTimeout(timer);
  }
  await pool.end();
}
