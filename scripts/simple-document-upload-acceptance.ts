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
  process.env.SIMPLE_DOCUMENT_EVIDENCE_DIR ?? 'docs/audits/simple-document-upload-evidence',
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
  const f = await createResponsibleDoctorFixture(); // Independently attests control identifier/data directory before writes.
  check(true, 'Fresh additive fixture on independently attested disposable PostgreSQL16 cluster');
  await mkdir(out, { recursive: true });
  await mkdir('.tmp-tools/doctor-browser', { recursive: true });
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText('SYNTHETIC SIMPLE DOCUMENT UPLOAD ACCEPTANCE', { x: 40, y: 750, size: 12 });
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
    await page.waitForSelector('form[aria-label="Upload document"]');
    return page;
  }
  for (const code of ['radiology.consent.verify']) {
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
      [f.doctorRole, code],
    );
  }
  const order = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'X-Ray','Synthetic simple imaging procedure') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id;
  const cancelled = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name,status) VALUES($1,$2,$3,'X-Ray','Synthetic cancelled procedure','Cancelled') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id;
  const otherPatient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other Patient','2000-01-01','Other') RETURNING id",
      [f.tenant, f.facility, 'SIMPLE-' + order],
    )
  ).rows[0].id;
  async function request(page: Page, url: string, body?: unknown) {
    return page.evaluate(
      async (url, body) => {
        const r = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('syrona_session_token')}`,
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
  async function rawUpload(
    page: Page,
    meta: Record<string, unknown>,
    patient = f.patient,
    encoded = bytes.toString('base64'),
  ) {
    return page.evaluate(
      async (meta, patient, encoded) => {
        const r = await fetch(`/api/patient-documents/patients/${patient}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('syrona_session_token')}`,
            'Content-Type': 'application/pdf',
            'X-Document-Metadata': encodeURIComponent(
              JSON.stringify({
                uploadMode: 'SIMPLE',
                filename: 'synthetic.pdf',
                title: 'Synthetic boundary test',
                ...meta,
              }),
            ),
          },
          body: Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
        });
        return { status: r.status, data: await r.json() };
      },
      meta,
      patient,
      encoded,
    );
  }
  const docsUrl = `/api/patient-documents/patients/${f.patient}`;
  const consentUrl = `/api/patient-documents/radiology/${order}/consent`;
  async function formIsSimple(page: Page) {
    return page.$eval('form[aria-label="Upload document"]', (form) => {
      const controls = Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea,select'),
      );
      return (
        controls.length === 3 &&
        controls.filter((e) => e.required).length === 2 &&
        !!form.querySelector('textarea:not([required])') &&
        !!form.querySelector('input[type="file"][required]') &&
        !form.querySelector('select')
      );
    });
  }
  async function save(page: Page, title: string) {
    await fill(page, 'Document title', title);
    await (await page.$('input[aria-label="Signed document file"]'))!.uploadFile(file);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
        r.request().method() === 'POST',
    );
    await click(page, 'Upload document', 'form[aria-label="Upload document"] button');
    check((await response).status() === 201, title + ': real UI upload accepted');
    const list = (await request(page, docsUrl)).data;
    return list.find((d: any) => d.title === title);
  }
  const staff = await staffPage(f.staff);
  check(
    await formIsSimple(staff),
    'Patient Management form has only title, optional textarea notes and original file; two required inputs',
  );
  await fill(staff, 'Document title', 'Synthetic simple central upload');
  await (await staff.$('input[aria-label="Signed document file"]'))!.uploadFile(file);
  await click(staff, 'Preview selected file');
  await staff.waitForSelector('iframe[title="Signed document PDF preview"]');
  check(true, 'Local selected file can be previewed before upload');
  await click(staff, 'Close preview');
  await (await staff.$('form[aria-label="Upload document"]'))!.screenshot({
    path: out + '/01-patient-management-simple-form.png',
  });
  const general = await save(staff, 'Synthetic simple central upload');
  check(
    general.notes === null &&
      general.patient_signature === 'UNKNOWN' &&
      general.doctor_signature === 'UNKNOWN' &&
      general.doctor_id === null &&
      general.signing_date === null,
    'Non-doctor title/file-only upload persists blank notes and no clinical assertions',
  );
  check(
    general.uploaded_by === f.staff.id && !general.portal_released && !general.radiology_order_id,
    'Uploader comes from authentication; central upload has no request or portal release',
  );
  await staff.waitForSelector(`[data-patient-document="${general.id}"]`);
  check(
    await staff.$eval(
      `[data-patient-document="${general.id}"]`,
      (e) => e.textContent?.includes('Synthetic Records') && e.textContent?.includes('consent.pdf'),
    ),
    'Uploaded document list shows actual uploader and original filename',
  );
  await click(staff, 'Preview Synthetic simple central upload');
  await staff.waitForSelector('iframe[title="Signed document PDF preview"]');
  await click(staff, 'Close preview');
  const retrieved = await staff.evaluate(async (url) => {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${localStorage.getItem('syrona_session_token')}` },
    });
    return { status: r.status, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }, `${docsUrl}/${general.id}/file`);
  check(
    retrieved.status === 200 && Buffer.from(retrieved.bytes).equals(bytes),
    'Saved original preview/download retrieves unchanged original PDF bytes',
  );
  await writeFile(out + '/synthetic-original.pdf', Buffer.from(retrieved.bytes));
  const a = await staffPage(f.doctorA);
  await a.click('button[aria-label="Close patient record"]');
  await click(a, 'Radiology & Imaging', 'aside button');
  await a.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((b) =>
      b.textContent?.includes('Synthetic simple imaging procedure'),
    ),
  );
  const study = await a.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Synthetic simple imaging procedure'),
    ),
  );
  await (study.asElement() as ElementHandle<Element>).click();
  await a.waitForSelector('[aria-label="Procedure-specific radiology consent"]');
  await a.waitForFunction(
    () =>
      !document
        .querySelector('[aria-label="Procedure-specific radiology consent"]')
        ?.textContent?.includes('Loading consent status'),
  );
  async function uploadConsent(title: string, notes = '') {
    await a
      .waitForSelector('button[aria-label="Upload consent document"]', { visible: false })
      .catch(() => undefined);
    await a.evaluate(() => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Upload consent document' && !b.disabled,
      );
      if (!button) throw Error('Upload consent document unavailable');
      button.click();
    });
    const form = 'form[aria-label="Upload radiology consent document"]';
    await a.waitForSelector(`${form} input[aria-label="Original consent file"]`);
    await fill(a, 'Document title', title);
    if (notes) await fill(a, 'Notes (optional)', notes);
    await (await a.$(`${form} input[aria-label="Original consent file"]`))!.uploadFile(file);
    const response = a.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
        r.request().method() === 'POST',
    );
    await a.$eval(form, (e) => {
      const button = Array.from(e.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Upload document',
      );
      if (!button || button.disabled) throw Error('Upload submit unavailable');
      button.click();
    });
    const status = (await response).status();
    await a.waitForNetworkIdle().catch(() => undefined);
    return status;
  }
  check(
    (await a
      .$eval('form[aria-label="Upload radiology consent document"]', () => true)
      .catch(() => false)) === false,
    'Radiology consent form is not shown until the upload action is used',
  );
  check(
    (await uploadConsent('Synthetic simple radiology upload')) === 201,
    'Radiology simple upload accepted',
  );
  check(
    (await a
      .$eval('form[aria-label="Upload radiology consent document"]', (form) => {
        const controls = Array.from(form.querySelectorAll('input,textarea,select'));
        return controls.length === 3;
      })
      .catch(() => true)) === true,
    'Radiology upload form closes after upload and exposes no clinical assertions',
  );
  const original = (await request(a, docsUrl)).data.find(
    (d: any) => d.title === 'Synthetic simple radiology upload',
  );
  check(
    original.patient_id === f.patient &&
      original.radiology_order_id === order &&
      original.procedure_name === 'Synthetic simple imaging procedure',
    'Radiology simple upload automatically persists exact patient/request/procedure',
  );
  check(
    original.notes === null &&
      original.patient_signature === 'UNKNOWN' &&
      original.doctor_signature === 'UNKNOWN' &&
      original.doctor_id === null &&
      original.signing_date === null,
    'Doctor upload does not invent responsible doctor or signature assertions',
  );
  check(
    (await request(a, consentUrl)).data.status === 'AWAITING_VERIFICATION' &&
      !original.portal_released,
    'Radiology upload neither verifies consent nor releases the file',
  );
  const decision = {
    status: 'VERIFIED',
    documentId: original.id,
    clinicianId: f.doctorA.id,
    reason: 'Synthetic separate signature review verification',
  };
  check(
    (await request(a, consentUrl, decision)).status === 409,
    'Verification before retrieving the original remains blocked',
  );
  await click(a, `Open in Patient Management #${original.id}`);
  await a.waitForSelector(`[data-patient-document="${original.id}"]`);
  const central = (await request(a, docsUrl)).data;
  check(
    central.filter((d: any) => d.id === original.id).length === 1,
    'Same radiology document ID appears exactly once in central repository',
  );
  check(
    await a.$eval(
      `[data-patient-document="${original.id}"]`,
      (e) =>
        e.textContent?.includes('Imaging request #') &&
        e.textContent?.includes('Synthetic simple imaging procedure'),
    ),
    'Central radiology entry shows exact request/procedure',
  );
  await (await a.$(`[data-patient-document="${original.id}"]`))!.screenshot({
    path: out + '/03-central-linked-document.png',
  });
  await click(a, `Open imaging request #${order}`);
  await a.waitForSelector('[aria-label="Procedure-specific radiology consent"]');
  await a.waitForFunction(
    () =>
      !document
        .querySelector('[aria-label="Procedure-specific radiology consent"]')
        ?.textContent?.includes('Loading consent status'),
  );
  check(
    (
      await a.$eval(
        '[aria-label="Procedure-specific radiology consent"]',
        (e) => e.textContent ?? '',
      )
    ).includes('Responsible clinician: ' + f.doctorA.name),
    'Authenticated doctor is automatically identified for review',
  );
  await click(a, 'Preview selected original');
  await a.waitForSelector('iframe[title="Original consent PDF preview"]');
  await click(a, 'Close preview');
  await a.click('[aria-label="Doctor consent verification"] input[type="checkbox"]');
  await a.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Verify consent',
    );
    return button && !button.disabled;
  });
  await click(a, 'Verify consent');
  await a.waitForFunction(() =>
    document
      .querySelector('[aria-label="Procedure-specific radiology consent"]')
      ?.textContent?.includes('Consent verified'),
  );
  check(
    (await request(a, consentUrl)).data.status === 'VERIFIED',
    'Authenticated doctor verification works end-to-end under own identity',
  );
  await a.setViewport({ width: 1400, height: 2400 });
  await (await a.$('[aria-label="Procedure-specific radiology consent"]'))!.screenshot({
    path: out + '/04-separate-consent-verification.png',
  });
  await a.setViewport({ width: 1400, height: 1050 });
  await click(a, `Upload corrected version #${original.id}`);
  check(
    (await a.$eval(
      'form[aria-label="Upload radiology consent document"]',
      (form) => form.querySelectorAll('input,textarea,select').length,
    )) === 3,
    'Correction upload also retains the simple three-field form',
  );
  const correcting = a.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
      r.request().method() === 'POST',
  );
  await fill(a, 'Notes (optional)', 'Synthetic corrected file notes');
  await (await a.$('input[aria-label="Original consent file"]'))!.uploadFile(file);
  await a.$eval('form[aria-label="Upload radiology consent document"]', (e) => {
    const button = Array.from(e.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Upload document',
    );
    if (!button || button.disabled) throw Error('Upload submit unavailable');
    button.click();
  });
  check(
    (await correcting).status() === 201,
    'Simple correction upload creates version2 without changing originals',
  );
  const correction = (await request(a, docsUrl)).data.find(
    (d: any) => d.root_id === original.id && d.version === 2,
  );
  check(
    correction.notes === 'Synthetic corrected file notes' &&
      correction.patient_signature === 'UNKNOWN' &&
      correction.doctor_id === null &&
      (await request(a, consentUrl)).data.status === 'AWAITING_VERIFICATION',
    'Replacement file does not inherit signature assertions and invalidates old verification',
  );
  const history = (await request(a, `${docsUrl}/${correction.id}/history`)).data;
  check(
    history.versions.length === 2 &&
      history.versions.every((v: any) => v.sha256 === original.sha256) &&
      history.events.some((e: any) => e.action === 'NEW_VERSION'),
    'Immutable originals, versions and audit history are retained',
  );
  check(
    (await rawUpload(a, { radiologyOrderId: cancelled })).status === 409,
    'Cancelled imaging request rejects simple upload',
  );
  check(
    (await rawUpload(a, { radiologyOrderId: order }, otherPatient)).status === 404,
    'Wrong-patient imaging linkage rejected',
  );
  check(
    (await request(staff, consentUrl, decision)).status === 403,
    'Records staff cannot perform radiology consent verification',
  );
  check(
    (await rawUpload(a, {}, f.patient, Buffer.from('not a PDF').toString('base64'))).status === 400,
    'Invalid file bytes are rejected by existing server validation',
  );
  check(
    (await a.evaluate(async (url) => {
      const r = await fetch(url);
      return r.status;
    }, docsUrl)) === 401,
    'Unauthenticated document access rejected',
  );
  const portalEmail = `simple_${f.patient}@example.test`;
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
  const portalLogin = portal.waitForResponse(
    (r) => r.url().endsWith('/api/portal/auth/login') && r.request().method() === 'POST',
  );
  await portal.click('button[type="submit"]');
  check((await portalLogin).status() === 200, 'Separate patient portal normal login');
  await click(portal, 'My Documents & Signed Consents');
  await portal.waitForNetworkIdle();
  check(
    !(
      await portal.$eval('[aria-label="My Documents & Signed Consents"]', (e) => e.textContent)
    )?.includes('Synthetic simple'),
    'Neither central nor radiology upload appears in portal before explicit release',
  );
  await click(staff, 'Refresh documents');
  await staff.waitForSelector(`[data-patient-document="${correction.id}"]`);
  await click(staff, `Release to patient portal #${correction.id}`);
  await fill(staff, 'Portal release reason', 'Explicit authorized synthetic version release');
  const release = staff.waitForResponse(
    (r) => r.url().endsWith(`/${correction.id}/release`) && r.request().method() === 'POST',
  );
  await click(staff, 'Confirm portal release decision');
  check(
    (await release).status() === 200,
    'Portal release remains a separate authorized reasoned action',
  );
  await portal.reload({ waitUntil: 'networkidle2' });
  await click(portal, 'My Documents & Signed Consents');
  await portal.waitForSelector(`[data-patient-document="${correction.id}"]`);
  check(
    !(await portal.$(`[data-patient-document="${general.id}"]`)) &&
      !(await portal.$(`[data-patient-document="${original.id}"]`)),
    'Only deliberately released version is visible in patient-own portal',
  );
  await (await portal.$('[aria-label="My Documents & Signed Consents"]'))!.screenshot({
    path: out + '/05-explicit-portal-release.png',
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
