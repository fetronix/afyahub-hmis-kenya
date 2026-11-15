/** Focused actual built-SPA/Express/PostgreSQL acceptance; no HTTP interception or production. */
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import puppeteer, { type Page, type ElementHandle } from 'puppeteer-core';
import {
  pdfCompatibilityFixtures,
  legacyPdfRejection,
} from '../src/tests/fixtures/pdf-compatibility.ts';
import { pool } from '../src/db/index.ts';
import { createResponsibleDoctorFixture } from '../src/tests/integration/support/responsible-doctor.fixture.ts';

if (process.env.RESPONSIBLE_DOCTOR_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic doctor acceptance and controlled Chromium required');
const out = path.resolve(
  process.env.PDF_COMPATIBILITY_EVIDENCE_DIR ?? 'docs/audits/pdf-compatibility-evidence',
);
const base = 'http://127.0.0.1:4197',
  checks: string[] = [],
  errors: string[] = [],
  failedRequests: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) throw Error(label);
  checks.push(label);
  console.log('PASS', label);
};
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined,
  server: ReturnType<typeof spawn> | undefined;
async function click(page: Page, label: string, selector = 'button') {
  // Locators re-resolve after async attachment refreshes and wait for a stable,
  // visible target; a cached ElementHandle can become detached during preview.
  const scope = selector === 'button' ? '' : selector.replace(/button$/, '');
  await page.locator(`${scope}::-p-aria([name=${JSON.stringify(label)}][role="button"])`).click();
}
async function fill(page: Page, label: string, value: string) {
  const h = await page.evaluateHandle(
    (txt) =>
      Array.from(document.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(txt))
        ?.querySelector('input,select,textarea'),
    label,
  );
  const el = h.asElement() as ElementHandle<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >;
  if (!el) throw Error('Missing input ' + label);
  const tag = await el.evaluate((e) => e.tagName);
  if (await el.evaluate((e) => e instanceof HTMLInputElement && e.type === 'date')) {
    await el.evaluate((e, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(e, value);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  } else if (tag === 'SELECT') await (el as ElementHandle<HTMLSelectElement>).select(value);
  else {
    await el.click();
    await el.evaluate((e) => {
      if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) e.select();
    });
    await el.press('Backspace');
    await el.type(value);
  }
  await h.dispose();
}
try {
  const f = await createResponsibleDoctorFixture();
  check(true, 'Independently attested disposable synthetic PostgreSQL only');
  await mkdir(out, { recursive: true });
  await mkdir('.tmp-tools/pdf-browser', { recursive: true });
  // Dedicated synthetic records persona: only existing patient read/upload/release,
  // branding read/manage and facility-profile UI entry permission, never admin wildcard.
  for (const code of ['facility.branding.read', 'facility.branding.manage', 'facilities.update']) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'configuration') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT ur.role_id,p.id FROM user_roles ur CROSS JOIN permissions p WHERE ur.user_id=$1 AND p.code=$2 ON CONFLICT DO NOTHING',
      [f.staff.id, code],
    );
  }
  const fixtures = await pdfCompatibilityFixtures();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4197',
    SQL_SSL: 'false',
    LOG_LEVEL: 'silent',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: base,
  };
  server = spawn('node', ['build/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Built app startup timeout')), 30000);
    let log = '';
    server!.stdout!.on('data', (b) => {
      log += b;
      if (log.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server!.stderr!.on('data', () => {});
    server!.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Built app startup failed'));
    });
  });
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  async function staffPage(actor: typeof f.doctorA) {
    const context = await browser!.createBrowserContext(),
      page = await context.newPage();
    await page.setViewport({ width: 1400, height: 1050 });
    // Observe actual app-created preview blobs, without intercepting HTTP or weakening CSP.
    await page.evaluateOnNewDocument(() => {
      const create = URL.createObjectURL.bind(URL);
      const blobs = new Map<string, Blob>();
      (window as any).__previewBlobs = blobs;
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = create(blob);
        if (blob instanceof Blob) blobs.set(url, blob);
        return url;
      };
    });
    page.on('pageerror', () => errors.push('Uncaught browser error'));
    page.on('response', (r) => {
      if (r.status() >= 500 && r.url().startsWith(base))
        failedRequests.push(new URL(r.url()).pathname + ':' + r.status());
    });
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.type('input[placeholder="Username or Email"]', actor.username);
    await page.type('input[placeholder="Password"]', f.password);
    const login = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
    );
    await page.click('button[type="submit"]');
    check((await login).status() === 200, actor.name + ': normal password login');
    await page.waitForSelector('aside');
    await click(page, 'Patient Management', 'aside button');
    await page.waitForSelector('button[title="View Patient Record"]');
    const row = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('tr'))
        .find((r) => r.textContent?.includes('Doctor Assignment'))
        ?.querySelector('button[title="View Patient Record"]'),
    );
    if (!row.asElement()) throw Error('Synthetic patient row unavailable');
    await (row.asElement() as ElementHandle<Element>).click();
    await row.dispose();
    await click(page, 'Consent & Signed Documents');
    await page.waitForSelector('form[aria-label="Upload document"]');
    return page;
  }

  const page = await staffPage(f.staff);
  const hashes: Record<string, string> = {};
  const diagnostics: Record<string, string | null> = {};
  const visuals = new Set([
    'scanned-letterhead',
    'scanned-signature',
    'type3-glyph-A',
    'static-annotations',
  ]);
  for (const fixture of fixtures) {
    const filename = path.resolve('.tmp-tools/pdf-browser/' + fixture.name + '.pdf');
    await writeFile(filename, fixture.bytes);
    await fill(page, 'Document title', 'Synthetic ' + fixture.name);
    await (await page.$('input[aria-label="Signed document file"]'))!.uploadFile(filename);
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
        r.request().method() === 'POST',
    );
    await click(page, 'Upload document', 'form[aria-label="Upload document"] button');
    const response = await pending;
    check(
      response.status() === (fixture.supported ? 201 : 400),
      'Patient UI ' +
        fixture.name +
        ': ' +
        (fixture.supported ? 'accepted' : 'rejected with ' + fixture.message),
    );
    if (!fixture.supported) {
      await page.waitForFunction(
        (message) => document.body.innerText.includes(message),
        {},
        fixture.message!,
      );
      check(true, 'Feature-specific rejection visible in UI: ' + fixture.name);
      continue;
    }
    const list = await page.evaluate(
      async (url) =>
        (
          await fetch(url, {
            headers: { Authorization: `Bearer ${localStorage.getItem('jalicare_session_token')}` },
          })
        ).json(),
      `/api/patient-documents/patients/${f.patient}`,
    );
    const data = list.find((d: { title: string }) => d.title === 'Synthetic ' + fixture.name);
    check(!!data, 'Saved patient ' + fixture.name + ' is listed');
    await page.waitForSelector(`[data-patient-document="${data.id}"]`);
    await click(page, 'Preview Synthetic ' + fixture.name);
    await page.waitForSelector('iframe[title="Signed document PDF preview"]');
    const original = await page.$eval('iframe[title="Signed document PDF preview"]', async (e) =>
      Array.from(
        new Uint8Array(
          await (window as any).__previewBlobs.get((e as HTMLIFrameElement).src).arrayBuffer(),
        ),
      ),
    );
    check(
      Buffer.from(original).equals(fixture.bytes),
      'Patient UI ' + fixture.name + ': preview blob is unchanged original',
    );
    hashes[fixture.name] = createHash('sha256').update(Buffer.from(original)).digest('hex');
    diagnostics[fixture.name] = await legacyPdfRejection(fixture.bytes);
    if (visuals.has(fixture.name)) {
      await page.waitForNetworkIdle();
      const frame = await page.$('iframe[title="Signed document PDF preview"]');
      await frame!.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: out + '/patient-' + fixture.name + '.png', fullPage: true });
      await writeFile(out + '/' + fixture.name + '.pdf', Buffer.from(original));
    }
    await click(page, 'Close preview');
  }
  await page.click('button[aria-label="Close patient record"]');
  await click(page, 'System Configuration', 'aside button');
  await click(page, 'Branding & Documents');
  await page.waitForSelector('input[aria-label="Letterhead PDF"]');
  for (const fixture of fixtures) {
    await page.bringToFront();
    const filename = path.resolve('.tmp-tools/pdf-browser/' + fixture.name + '.pdf');
    await (await page.$('input[aria-label="Letterhead PDF"]'))!.uploadFile(filename);
    const pending = page.waitForResponse(
      (r) => r.url().includes('/letterheads?filename=') && r.request().method() === 'POST',
    );
    // Dispatch the actual enabled UI button's click. Headless blob-popup focus
    // can swallow CDP pointer events; no requests or application handlers are mocked.
    const [response] = await Promise.all([
      pending,
      page.$eval('input[aria-label="Letterhead PDF"]', (e) => {
        const button = e.parentElement?.querySelector('button');
        if (!button || button.disabled) throw Error('Upload draft is not enabled');
        button.click();
      }),
    ]);
    check(
      response.status() === (fixture.supported ? 201 : 400),
      'Branding UI ' +
        fixture.name +
        ': ' +
        (fixture.supported ? 'draft accepted' : 'rejected with ' + fixture.message),
    );
    if (!fixture.supported) {
      await page.waitForFunction(
        (message) => document.body.innerText.includes(message),
        {},
        fixture.message!,
      );
      check(true, 'Feature-specific rejection visible in UI: ' + fixture.name);
      continue;
    }
    await page.waitForNetworkIdle();
    // Version table is newest first. The first preview is the just-created draft.
    const previous = await page.evaluate(() => (window as any).__previewBlobs.size);
    await page.$eval('table tbody tr:first-child', (row) => {
      const button = Array.from(row.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Preview file',
      );
      if (!button || button.disabled) throw Error('Preview file unavailable');
      button.click();
    });
    await page.waitForFunction((n) => (window as any).__previewBlobs.size > n, {}, previous);
    const original = await page.evaluate(async () => {
      const blobs = (window as any).__previewBlobs as Map<string, Blob>;
      return Array.from(new Uint8Array(await [...blobs.values()].at(-1)!.arrayBuffer()));
    });
    check(
      Buffer.from(original).equals(fixture.bytes),
      'Branding UI ' + fixture.name + ': Preview file opens unchanged original',
    );
    if (fixture.name === 'scanned-letterhead')
      await page.screenshot({ path: out + '/branding-scanned-letterhead.png', fullPage: true });
    // Headless Chromium may download rather than render blob popups. Close any
    // surviving popup; no rendering support is inferred from its existence.
    for (const popup of await browser!.pages()) if (popup !== page) await popup.close();
  }
  check(
    errors.length === 0 && failedRequests.length === 0,
    'No uncaught browser errors or same-origin 500 responses',
  );
  await writeFile(
    out + '/results.json',
    JSON.stringify(
      {
        syntheticOnly: true,
        productionAccess: false,
        checks,
        hashes,
        legacyRejectionPaths: diagnostics,
        errors,
        failedRequests,
      },
      null,
      2,
    ) + '\n',
  );
  await rm(out + '/failure.json', { force: true });
  await rm(out + '/failure.png', { force: true });
} catch (e) {
  await mkdir(out, { recursive: true });
  for (const p of (await browser?.pages()) ?? []) {
    if (p.url().startsWith(base))
      await p.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
  }
  await writeFile(
    out + '/failure.json',
    JSON.stringify(
      { error: e instanceof Error ? e.message : 'Acceptance failed', checks },
      null,
      2,
    ) + '\n',
  );
  throw e;
} finally {
  await browser?.close();
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => {});
  }
  await pool.end();
}
