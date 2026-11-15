/** Focused actual built-SPA/Express/PostgreSQL acceptance; no HTTP interception or production. */
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import puppeteer, { type Page, type ElementHandle } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../src/db/index.ts';
import { hashPassword } from '../src/utils/password.ts';
import { createResponsibleDoctorFixture } from '../src/tests/integration/support/responsible-doctor.fixture.ts';

if (process.env.RESPONSIBLE_DOCTOR_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic doctor acceptance and controlled Chromium required');
const out = path.resolve(
  process.env.RESPONSIBLE_DOCTOR_EVIDENCE_DIR ?? 'docs/audits/radiology-consent-evidence',
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
  await page.waitForFunction(
    (sel, txt) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(sel)).some(
        (b) => b.textContent?.trim() === txt && !b.disabled,
      ),
    {},
    selector,
    label,
  );
  const h = await page.evaluateHandle(
    (sel, txt) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(sel)).find(
        (b) => b.textContent?.trim() === txt && !b.disabled,
      ),
    selector,
    label,
  );
  await (h.asElement() as ElementHandle<Element>).click();
  await h.dispose();
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
  const f = await createResponsibleDoctorFixture(); // Independently attests control identifier/data directory before writes.
  check(true, 'Fresh additive fixture on independently attested disposable PostgreSQL16 cluster');
  await mkdir(out, { recursive: true });
  await mkdir('.tmp-tools/doctor-browser', { recursive: true });
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText('SYNTHETIC RADIOLOGY SIGNED ORIGINAL - ACCEPTANCE', { x: 40, y: 750, size: 12 });
  const bytes = Buffer.from(await pdf.save());
  const file = path.resolve('.tmp-tools/doctor-browser/consent.pdf');
  await writeFile(file, bytes);
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
    await page.waitForSelector('form[aria-label="Upload signed document"]');
    await page.waitForFunction(
      () =>
        !document
          .querySelector('form[aria-label="Upload signed document"]')
          ?.textContent?.includes('Loading responsible doctors'),
    );
    return page;
  }
  const select = 'form[aria-label="Upload signed document"] select';
  async function doctorValue(page: Page) {
    return page.$eval(select, (e) => (e as HTMLSelectElement).value);
  }
  async function save(page: Page, title: string) {
    await fill(page, 'Document title', title);
    await fill(page, 'Document audit reason', 'Synthetic responsible doctor browser verification');
    await (await page.$('input[aria-label="Signed document file"]'))!.uploadFile(file);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
        r.request().method() === 'POST',
    );
    await click(page, 'Upload document version');
    const r = await response;
    check(r.status() === 201, title + ': actual UI upload saved');
    // no-store upload bodies may be evicted from the headless inspector cache.
    // Read the committed metadata back through the same authenticated real API instead.
    const persisted = await api(page, '');
    const document = persisted.data.find((row: { title: string }) => row.title === title);
    if (persisted.status !== 200 || !document)
      throw Error('Saved upload not found on authenticated reload');
    return document;
  }
  async function api(page: Page, suffix: string, meta?: Record<string, unknown>) {
    return page.evaluate(
      async (suffix, meta, p, encoded) => {
        const r = await fetch(`/api/patient-documents/patients/${p}${suffix}`, {
          method: meta ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('jalicare_session_token')}`,
            ...(meta
              ? {
                  'Content-Type': 'application/pdf',
                  'X-Document-Metadata': encodeURIComponent(
                    JSON.stringify({
                      filename: 'synthetic.pdf',
                      title: 'Synthetic forged assignment',
                      category: 'Consent',
                      documentType: 'Treatment',
                      patientSignature: 'UNKNOWN',
                      doctorSignature: 'UNKNOWN',
                      reason: 'Synthetic invalid assignment browser negative',
                      ...meta,
                    }),
                  ),
                }
              : {}),
          },
          body: meta ? Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)) : undefined,
        });
        return { status: r.status, data: await r.json() };
      },
      suffix,
      meta,
      f.patient,
      bytes.toString('base64'),
    );
  }
  // Scoped test-role grants only on this additive synthetic tenant.
  for (const code of ['radiology.consent.verify', 'clinical.update']) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'radiology') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
      [f.doctorRole, code],
    );
  }
  const order = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'X-Ray','Synthetic exact radiology procedure') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id;
  const other = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'X-Ray','Synthetic separate radiology request') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id;
  const anotherPatient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Different Patient','2000-01-01','Other') RETURNING id",
      [f.tenant, f.facility, 'RAD-' + order],
    )
  ).rows[0].id;
  async function request(page: Page, url: string, body?: unknown) {
    return page.evaluate(
      async (url, body) => {
        const r = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('jalicare_session_token')}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, data: await r.json() };
      },
      url,
      body,
    );
  }
  const consentUrl = (id: number) => `/api/patient-documents/radiology/${id}/consent`;
  const a = await staffPage(f.doctorA);
  const general = await save(a, 'Synthetic general central document');
  check(
    !general.radiology_order_id,
    'Central general upload retains no silent radiology association',
  );
  // Close the existing patient journey using its close control, then follow the worklist.
  await a.keyboard.press('Escape');
  // Sidebar remains outside the journey overlay; open Radiology by a normal UI click after closing.
  const close = await a.$('button[aria-label="Close patient record"]');
  if (close) await close.click();
  await click(a, 'Radiology & Imaging', 'aside button');
  await a.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((b) =>
      b.textContent?.includes('Synthetic exact radiology procedure'),
    ),
  );
  const study = await a.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Synthetic exact radiology procedure'),
    ),
  );
  await (study.asElement() as ElementHandle<Element>).click();
  await a.waitForSelector('[aria-label="Procedure-specific radiology consent"]');
  await a.waitForFunction(
    () =>
      !document
        .querySelector('[aria-label="Procedure-specific radiology consent"]')
        ?.textContent?.includes('Loading —'),
  );
  check(
    await a.$eval(
      '[aria-label="Procedure-specific radiology consent"]',
      (e) =>
        !e.textContent?.includes('document ID') && !e.textContent?.includes('clinician user ID'),
    ),
    'No raw document/clinician ID entry or second generic upload form',
  );
  check(
    await a.$eval('[aria-label="Procedure-specific radiology consent"]', (e) => {
      const next = e.nextElementSibling;
      return !!next?.querySelector('textarea');
    }),
    'Consent workflow is above Findings/Impression',
  );
  await click(a, 'Upload signed consent');
  await fill(a, 'Document title', 'Synthetic radiology signed consent');
  await fill(a, 'Signing date', '2026-10-01');
  await fill(a, 'Patient signature status', 'PRESENT');
  await fill(a, 'Doctor signature status', 'PRESENT');
  await fill(a, 'Document audit reason', 'Signed synthetic procedure consent upload acceptance');
  await (await a.$('input[aria-label="Signed document file"]'))!.uploadFile(file);
  await click(a, 'Preview selected file');
  await a.waitForSelector('iframe[title="Signed document PDF preview"]');
  check(true, 'Selected local original can be previewed before upload');
  await click(a, 'Close preview');
  const upload = a.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
      r.request().method() === 'POST',
  );
  await click(a, 'Save signed consent');
  const uploadedResponse = await upload;
  if (uploadedResponse.status() !== 201) {
    await a.waitForNetworkIdle();
    throw Error(
      `Upload ${uploadedResponse.status()}: ${await a.$$eval('[role="alert"]', (es) => es.map((e) => e.textContent).join(';'))}`,
    );
  }
  check(
    uploadedResponse.status() === 201,
    'Radiology upload saves through existing central document endpoint',
  );
  const original = (await api(a, '')).data.find(
    (d: any) => d.title === 'Synthetic radiology signed consent',
  );
  check(
    original.radiology_order_id === order &&
      original.procedure_name === 'Synthetic exact radiology procedure' &&
      original.doctor_id === f.doctorA.id,
    'Single persisted document has exact patient/request/procedure and named doctor',
  );
  const decision = {
    status: 'VERIFIED',
    documentId: original.id,
    clinicianId: f.doctorA.id,
    reason: 'Inspect signed synthetic exact procedure consent',
  };
  check(
    (await request(a, consentUrl(order))).data.status === 'AWAITING_VERIFICATION',
    'Upload never auto-verifies',
  );
  check(
    (await request(a, consentUrl(order), decision)).data.error === 'CONSENT_REVIEW_REQUIRED',
    'Direct verification before original retrieval is denied',
  );
  check(
    (await request(a, consentUrl(other), decision)).status >= 400,
    'Another request cannot silently reuse the document',
  );
  check(
    (await api(a, `?radiologyOrderId=${other}`)).data.length === 0,
    'Separate request attachment list excludes this consent',
  );
  check(
    (
      await request(
        a,
        `/api/patient-documents/patients/${anotherPatient}?radiologyOrderId=${order}`,
      )
    ).status >= 400,
    'Wrong patient/request listing denied',
  );
  check(
    (await a.evaluate(
      async (p, id) => {
        const r = await fetch(`/api/patient-documents/patients/${p}/${id}/file`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('jalicare_session_token')}` },
        });
        return r.status;
      },
      anotherPatient,
      original.id,
    )) === 404,
    'Other patient cannot retrieve this signed original',
  );
  const fileResult = await a.evaluate(
    async (p, id) => {
      const r = await fetch(`/api/patient-documents/patients/${p}/${id}/file`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jalicare_session_token')}` },
      });
      return { status: r.status, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
    },
    f.patient,
    original.id,
  );
  check(
    fileResult.status === 200 && Buffer.from(fileResult.bytes).equals(bytes),
    'Actual retrieved PDF is byte-identical original',
  );
  await writeFile(out + '/synthetic-original.pdf', Buffer.from(fileResult.bytes));
  const inspected = await PDFDocument.load(Buffer.from(fileResult.bytes));
  check(inspected.getPageCount() === 1, 'Downloaded original PDF parses with expected single page');
  await click(a, `Preview original #${original.id}`);
  await a.waitForSelector('iframe[title="Signed document PDF preview"]');
  await click(a, 'Close preview');
  await a.waitForFunction(() => {
    const c = document.querySelector<HTMLInputElement>(
      '[aria-label="Review and verify consent"] input[type="checkbox"]',
    );
    return c && !c.disabled;
  });
  await a.click('[aria-label="Review and verify consent"] input[type="checkbox"]');
  await fill(
    a,
    'Consent decision / policy audit reason',
    'Independently reviewed synthetic patient and doctor signatures',
  );
  await click(a, 'Verify this procedure consent');
  await a.waitForFunction(() =>
    document
      .querySelector('[aria-label="Procedure-specific radiology consent"]')
      ?.textContent?.includes('Consent status: VERIFIED'),
  );
  check(
    (await request(a, consentUrl(order))).data.status === 'VERIFIED',
    'Authorized UI verification succeeds only after original review and confirmation',
  );
  await a.setViewport({ width: 1400, height: 2400 });
  await (await a.$('[aria-label="Procedure-specific radiology consent"]'))!.screenshot({
    path: out + '/01-radiology-verified.png',
  });
  await a.setViewport({ width: 390, height: 1800 });
  check(
    await a.$eval(
      '[aria-label="Procedure-specific radiology consent"]',
      (e) => e.scrollWidth <= e.clientWidth,
    ),
    'Consent panel fits narrow mobile width without internal horizontal overflow',
  );
  await (await a.$('[aria-label="Procedure-specific radiology consent"]'))!.screenshot({
    path: out + '/04-mobile-consent.png',
  });
  await a.setViewport({ width: 1400, height: 1050 });
  await click(a, `Open in Patient Management #${original.id}`);
  await a.waitForSelector(`[data-patient-document="${original.id}"]`);
  check(
    await a.$eval(
      `[data-patient-document="${original.id}"]`,
      (e) =>
        e.textContent?.includes('Radiology consent') &&
        e.textContent?.includes('Synthetic exact radiology procedure'),
    ),
    'Radiology-to-central navigation focuses same document with source/context',
  );
  check(
    (await api(a, '')).data.filter((d: any) => d.id === original.id).length === 1,
    'Central list contains exactly one identical document ID',
  );
  await (await a.$(`[data-patient-document="${original.id}"]`))!.screenshot({
    path: out + '/02-central-source.png',
  });
  await click(a, `Open imaging request #${order}`);
  await a.waitForSelector('[aria-label="Procedure-specific radiology consent"]');
  check(
    await a.$eval('[aria-label="Procedure-specific radiology consent"]', (e) =>
      e.textContent?.includes('Synthetic exact radiology procedure'),
    ),
    'Central-to-radiology navigation opens originating request',
  );
  await a.reload({ waitUntil: 'networkidle2' });
  await click(a, 'Radiology & Imaging', 'aside button');
  await a.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((b) =>
      b.textContent?.includes('Synthetic exact radiology procedure'),
    ),
  );
  const again = await a.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Synthetic exact radiology procedure'),
    ),
  );
  await (again.asElement() as ElementHandle<Element>).click();
  await a.waitForSelector(`[data-patient-document="${original.id}"]`);
  check(
    await a.$eval(
      `[data-patient-document="${original.id}"]`,
      (e) => e.textContent?.includes('Synthetic Doctor A') && e.textContent?.includes('2026-10-01'),
    ),
    'Doctor and signing metadata persist after actual browser refresh',
  );
  const unauthorized = await staffPage(f.staff);
  check(
    (await request(unauthorized, consentUrl(order), decision)).status === 403,
    'Authenticated records staff direct verification rejected',
  );
  await click(a, `Correct consent version #${original.id}`);
  await fill(
    a,
    'Document audit reason',
    'Synthetic correction creates immutable version with audit',
  );
  await fill(a, 'Signing date', '2026-10-02');
  await fill(a, 'Patient signature status', 'PRESENT');
  await fill(a, 'Doctor signature status', 'PRESENT');
  await (await a.$('input[aria-label="Signed document file"]'))!.uploadFile(file);
  const correcting = a.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
      r.request().method() === 'POST',
  );
  await click(a, 'Save signed consent');
  check((await correcting).status() === 201, 'UI correction creates a new immutable version');
  const versions = (await api(a, '')).data.filter(
    (d: any) => d.root_id === original.id || d.id === original.id,
  );
  const correction = versions.find((d: any) => d.version === 2);
  check(
    versions.length === 2 && correction.sha256 === original.sha256 && correction.id !== original.id,
    'History preserves original bytes with distinct correction/version ID',
  );
  check(
    (await request(a, consentUrl(order))).data.status === 'AWAITING_VERIFICATION',
    'New version invalidates old verification',
  );
  await pool.query("UPDATE radiology_orders SET status='Cancelled' WHERE id=$1", [other]);
  check(
    (await api(a, '', { radiologyOrderId: other, doctorId: f.doctorA.id })).data.error ===
      'PROCEDURE_NOT_ACTIVE',
    'Cancelled request rejects new upload at backend',
  );
  check(
    (await request(a, consentUrl(other), decision)).status >= 400,
    'Cancelled request rejects verification',
  );
  // Portal is a separate normal authenticated browser session, no injected tokens.
  const portalEmail = `radiology_${f.patient}@example.test`;
  await pool.query(
    "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
    [f.tenant, f.facility, f.patient, portalEmail, await hashPassword(f.password)],
  );
  const portal = await (await browser.createBrowserContext()).newPage();
  await portal.goto(base + '/portal', { waitUntil: 'networkidle2' });
  for (const input of await portal.$$('input')) {
    const type = await input.evaluate((e) => e.type);
    if (type === 'password') await input.type(f.password);
    else if (!['checkbox', 'hidden'].includes(type)) await input.type(portalEmail);
  }
  const logged = portal.waitForResponse(
    (r) => r.url().endsWith('/api/portal/auth/login') && r.request().method() === 'POST',
  );
  await portal.click('button[type="submit"]');
  check((await logged).status() === 200, 'Separate patient portal normal login');
  await click(portal, 'My Documents & Signed Consents');
  await portal.waitForNetworkIdle();
  check(
    !(
      await portal.$eval('[aria-label="My Documents & Signed Consents"]', (e) => e.textContent)
    )?.includes('Synthetic radiology signed consent'),
    'Unreleased radiology uploads are absent from portal',
  );
  await fill(
    unauthorized,
    'Document audit reason',
    'Explicit authorized release of synthetic radiology correction',
  );
  await click(unauthorized, 'Refresh documents');
  await unauthorized.waitForSelector(`[data-patient-document="${correction.id}"]`);
  const released = unauthorized.waitForResponse(
    (r) => r.url().endsWith(`/${correction.id}/release`) && r.request().method() === 'POST',
  );
  await click(unauthorized, `Release to patient portal #${correction.id}`);
  check(
    (await released).status() === 200,
    'Authorized deliberate per-version portal release succeeds',
  );
  await portal.reload({ waitUntil: 'networkidle2' });
  await click(portal, 'My Documents & Signed Consents');
  await portal.waitForSelector(`[data-patient-document="${correction.id}"]`);
  check(
    !(await portal.$(`[data-patient-document="${original.id}"]`)) &&
      !(await portal.$(`[data-patient-document="${general.id}"]`)),
    'Portal exposes only explicitly released version, not original or general upload',
  );
  await (await portal.$('[aria-label="My Documents & Signed Consents"]'))!.screenshot({
    path: out + '/03-portal-release.png',
  });
  check(
    errors.length === 0 && failedRequests.length === 0,
    'No uncaught staff browser errors or same-origin500 responses',
  );
  await writeFile(
    out + '/results.json',
    JSON.stringify(
      {
        syntheticOnly: true,
        productionAccess: false,
        checks,
        errors,
        failedRequests,
        originalSha256: createHash('sha256').update(bytes).digest('hex'),
        fixture: {
          tenant: f.tenant,
          facility: f.facility,
          patient: f.patient,
          order,
          other,
          original: original.id,
          correction: correction.id,
        },
      },
      null,
      2,
    ) + '\n',
  );
  await rm(out + '/failure.json', { force: true });
} catch (e) {
  await mkdir(out, { recursive: true });
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
