/** Focused actual built-SPA/Express/PostgreSQL acceptance; no HTTP interception or production. */
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import puppeteer, { type Page, type ElementHandle } from 'puppeteer-core';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import {
  pdfCompatibilityFixtures,
  legacyPdfRejection,
} from '../src/tests/fixtures/pdf-compatibility.ts';
import { pool } from '../src/db/index.ts';
import { staticPdfPreview } from '../src/security/pdf-preview.ts';

async function navigationPresent(bytes: Uint8Array): Promise<boolean> {
  const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  if (pdf.catalog.has(PDFName.of('OpenAction'))) return true;
  for (const page of pdf.getPages()) {
    const annots = pdf.context.lookup(page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (const raw of annots.asArray()) {
      const ref = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw;
      if (ref instanceof PDFDict && (ref.has(PDFName.of('A')) || ref.has(PDFName.of('Dest'))))
        return true;
    }
  }
  for (const [, obj] of pdf.context.enumerateIndirectObjects())
    if (obj instanceof PDFDict && String(obj.get(PDFName.of('S'))) === '/URI') return true;
  return false;
}
const actualSha = '7650930b5229cd57f58bda9788162b2f56967ba9a72e0aa1cdfa0256adb00ce0';
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
  const actual = await readFile('src/tests/fixtures/letterhead-sample-a4.pdf');
  check(
    createHash('sha256').update(actual).digest('hex') === actualSha,
    'Exact supplied LETTER HEAD.pdf SHA-256 fixture',
  );
  fixtures.push({
    name: 'supplied-syrona-letterhead',
    bytes: actual,
    supported: true,
    feature: 'Actual supplied Syrona one-page letterhead with one HTTP URI Link',
  });
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
  const previewHashes: Record<string, string> = {};
  const originalHashes: Record<string, string> = {};
  const diagnostics: Record<string, string | null> = {};
  diagnostics['supplied-syrona-letterhead'] = await legacyPdfRejection(actual);
  check(
    diagnostics['supplied-syrona-letterhead'] === '40 0 R/A',
    'Old generic blacklist exact trigger: 40 0 R/A',
  );
  const visuals = new Set([
    'scanned-letterhead',
    'scanned-signature',
    'type3-glyph-A',
    'static-annotations',
    'supplied-syrona-letterhead',
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
            headers: { Authorization: `Bearer ${localStorage.getItem('syrona_session_token')}` },
          })
        ).json(),
      `/api/patient-documents/patients/${f.patient}`,
    );
    const data = list.find((d: { title: string }) => d.title === 'Synthetic ' + fixture.name);
    check(!!data, 'Saved patient ' + fixture.name + ' is listed');
    const fileUrl = `/api/patient-documents/patients/${f.patient}/${data.id}/file`;
    const untouched = await page.evaluate(async (url) => {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem('syrona_session_token')}` },
      });
      return {
        status: r.status,
        marker: r.headers.get('X-Document-Preview'),
        bytes: Array.from(new Uint8Array(await r.arrayBuffer())),
      };
    }, fileUrl + '?download=1&preview=1');
    check(
      untouched.status === 200 &&
        untouched.marker === 'original' &&
        Buffer.from(untouched.bytes).equals(fixture.bytes),
      'Patient UI ' + fixture.name + ': authorized download returns unchanged original bytes',
    );
    originalHashes[fixture.name] = createHash('sha256')
      .update(Buffer.from(untouched.bytes))
      .digest('hex');
    const expectedPreview = await staticPdfPreview(fixture.bytes);
    await page.waitForSelector(`[data-patient-document="${data.id}"]`);
    await click(page, 'Preview Synthetic ' + fixture.name);
    await page.waitForSelector('iframe[title="Signed document PDF preview"]');
    const preview = await page.$eval('iframe[title="Signed document PDF preview"]', async (e) => {
      const blob = (window as any).__previewBlobs.get((e as HTMLIFrameElement).src) as Blob & {
        derivedPreview?: boolean;
      };
      return {
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        derivedPreview: blob.derivedPreview === true,
      };
    });
    check(
      Buffer.from(preview.bytes).equals(Buffer.from(expectedPreview.bytes)),
      'Patient UI ' +
        fixture.name +
        (expectedPreview.derived
          ? ': preview blob is clearly derived static copy'
          : ': preview blob is unchanged original'),
    );
    check(
      preview.derivedPreview === expectedPreview.derived &&
        !(await navigationPresent(new Uint8Array(preview.bytes))),
      'Patient UI ' + fixture.name + ': preview has no navigation actions',
    );
    await page.waitForFunction(
      (derived) =>
        document.body.innerText.includes(
          derived ? 'Derived static preview' : 'Preview of the unchanged uploaded original',
        ),
      {},
      expectedPreview.derived,
    );
    check(true, 'Patient UI ' + fixture.name + ': preview label is explicit');
    previewHashes[fixture.name] = createHash('sha256')
      .update(Buffer.from(preview.bytes))
      .digest('hex');
    diagnostics[fixture.name] = await legacyPdfRejection(fixture.bytes);
    if (visuals.has(fixture.name)) {
      await page.waitForNetworkIdle();
      const frame = await page.$('iframe[title="Signed document PDF preview"]');
      await frame!.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: out + '/patient-' + fixture.name + '.png', fullPage: true });
      await writeFile(out + '/' + fixture.name + '.pdf', Buffer.from(untouched.bytes));
      if (fixture.name === 'supplied-syrona-letterhead') {
        check(
          Buffer.from(untouched.bytes).equals(actual),
          'Evidence original PDF is byte-identical to supplied LETTER HEAD.pdf',
        );
        await writeFile(out + '/syrona-derived-static-preview.pdf', Buffer.from(preview.bytes));
        check(
          expectedPreview.derived && !Buffer.from(preview.bytes).equals(actual),
          'Syrona derived static preview is clearly named and distinct from the original',
        );
      }
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
    const expectedPreview = await staticPdfPreview(fixture.bytes);
    await page.$eval('table tbody tr:first-child', (row) => {
      const button = Array.from(row.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Preview file',
      );
      if (!button || button.disabled) throw Error('Preview file unavailable');
      button.click();
    });
    await page.waitForFunction((n) => (window as any).__previewBlobs.size > n, {}, previous);
    const preview = await page.evaluate(async () => {
      const blobs = (window as any).__previewBlobs as Map<
        string,
        Blob & { derivedPreview?: boolean }
      >;
      const blob = [...blobs.values()].at(-1)!;
      return {
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        derivedPreview: blob.derivedPreview === true,
      };
    });
    check(
      Buffer.from(preview.bytes).equals(Buffer.from(expectedPreview.bytes)),
      'Branding UI ' +
        fixture.name +
        (expectedPreview.derived
          ? ': Preview file opens clearly derived static copy'
          : ': Preview file opens unchanged original'),
    );
    check(
      preview.derivedPreview === expectedPreview.derived &&
        !(await navigationPresent(new Uint8Array(preview.bytes))),
      'Branding UI ' + fixture.name + ': preview has no navigation actions',
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
        previewHashes,
        originalHashes,
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
