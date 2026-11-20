/**
 * Actual built-SPA / Express / PostgreSQL acceptance for the patient portal's
 * "My Documents & Signed Consents" and the staff release workflow.
 *
 * No HTTP interception, no mocked data and no production access: every request
 * below is served by the built application against the independently attested
 * disposable synthetic database, using synthetic users only.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Page, type ElementHandle } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../src/db/index.ts';
import { hashPassword } from '../src/utils/password.ts';
import { createResponsibleDoctorFixture } from '../src/tests/integration/support/responsible-doctor.fixture.ts';

if (process.env.RESPONSIBLE_DOCTOR_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic portal acceptance and controlled Chromium required');
const out = path.resolve(
  process.env.PORTAL_DOCUMENTS_EVIDENCE_DIR ?? 'docs/audits/portal-documents-evidence',
);
const base = 'http://127.0.0.1:4203';
const checks: string[] = [],
  errors: string[] = [],
  failedRequests: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) throw Error(label);
  checks.push(label);
  console.log('PASS', label);
};
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined,
  server: ReturnType<typeof spawn> | undefined;

async function clickDom(page: Page, label: string) {
  await page.waitForFunction(
    (text) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(
        (button) => button.textContent?.trim() === text && !button.disabled,
      ),
    {},
    label,
  );
  await page.evaluate((text) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => entry.textContent?.trim() === text && !entry.disabled,
    );
    if (!button) throw Error('Missing enabled button ' + text);
    button.click();
  }, label);
}
async function fill(page: Page, label: string, value: string) {
  const handle = await page.evaluateHandle(
    (text) =>
      Array.from(document.querySelectorAll('label'))
        .find((entry) => entry.textContent?.trim().startsWith(text))
        ?.querySelector('input,select,textarea'),
    label,
  );
  const element = handle.asElement() as ElementHandle<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >;
  if (!element) throw Error('Missing input ' + label);
  await element.click();
  await element.evaluate((input) => {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.select();
  });
  await element.press('Backspace');
  await element.type(value);
  await handle.dispose();
}
/** Close real toast notifications without touching the journey modal. */
async function dismissToasts(page: Page) {
  await page.evaluate(() => {
    const dismiss = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Dismiss',
    );
    if (dismiss) (dismiss as HTMLButtonElement).click();
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Dismiss',
      ),
  );
}

try {
  const f = await createResponsibleDoctorFixture();
  check(true, 'Independently attested disposable synthetic PostgreSQL only');
  await mkdir(out, { recursive: true });
  await mkdir('.tmp-tools/portal-browser', { recursive: true });

  const patientRow = (
    await pool.query('SELECT mrn,first_name,last_name FROM patients WHERE id=$1', [f.patient])
  ).rows[0] as { mrn: string; first_name: string; last_name: string };
  const patientName = `${patientRow.first_name} ${patientRow.last_name}`;

  const portalEmail = `portal_${f.tenant}@example.test`,
    otherEmail = `portal_other_${f.tenant}@example.test`,
    awaitingEmail = `portal_awaiting_${f.tenant}@example.test`;
  const portalPassword = 'Synthetic-portal-browser-only!9';
  const portalHash = await hashPassword(portalPassword);
  const otherPatient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,phone,email) VALUES($1,$2,$3,'Synthetic','Other Portal','1991-04-04','Male','+254700000111',$4) RETURNING id",
      [f.tenant, f.facility, 'PORTB-' + f.tenant, `other_${f.tenant}@example.test`],
    )
  ).rows[0].id as number;
  const awaitingPatient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,phone,email) VALUES($1,$2,$3,'Synthetic','Awaiting Portal','1992-05-05','Female','+254700000112',$4) RETURNING id",
      [f.tenant, f.facility, 'PORTW-' + f.tenant, `awaiting_${f.tenant}@example.test`],
    )
  ).rows[0].id as number;
  for (const [patientId, login] of [
    [f.patient, portalEmail],
    [otherPatient, otherEmail],
    [awaitingPatient, awaitingEmail],
  ])
    await pool.query(
      "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
      [f.tenant, f.facility, patientId, login, portalHash],
    );
  const order = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'XR','Synthetic browser chest X-ray') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id as number;

  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic portal document', { x: 40, y: 760, size: 12 });
  const bytes = Buffer.from(await pdf.save());
  const file = path.resolve('.tmp-tools/portal-browser/document.pdf');
  await writeFile(file, bytes);

  // A realistic long history, far beyond the old 200-row window.
  for (let index = 0; index < 210; index += 1) {
    const title =
      index === 0 ? 'ARCHIVE oldest released document' : `Synthetic archive document ${index}`;
    const inserted = await pool.query(
      `INSERT INTO patient_signed_documents
        (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,uploaded_at,reason)
       VALUES($1,$2,$3,1,$4,'Document','Patient document','UNKNOWN','UNKNOWN',$5,'application/pdf',$6,$7,$8,now() - ($9 || ' days')::interval,'Synthetic archive history') RETURNING id`,
      [
        f.tenant,
        f.facility,
        f.patient,
        title,
        `archive-${index}.pdf`,
        'a'.repeat(64),
        bytes,
        f.staff.id,
        String(500 - index),
      ],
    );
    await pool.query(
      "INSERT INTO patient_document_releases(document_id,released,actor_id,reason,released_at) VALUES($1,true,$2,'Synthetic archive release',now())",
      [inserted.rows[0].id, f.staff.id],
    );
  }
  await pool.query(
    "INSERT INTO patient_signed_documents(tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason) VALUES($1,$2,$3,1,'Unreleased awaiting document','Document','Patient document','UNKNOWN','UNKNOWN','awaiting.pdf','application/pdf',$4,$5,$6,'Synthetic awaiting release')",
    [f.tenant, f.facility, awaitingPatient, 'b'.repeat(64), bytes, f.staff.id],
  );

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4203',
    SQL_SSL: 'false',
    LOG_LEVEL: 'silent',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: base,
  };
  server = spawn('node', ['build/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Built app startup timeout')), 30000);
    let log = '';
    server!.stdout!.on('data', (chunk) => {
      log += chunk;
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
  async function newPage() {
    const context = await browser!.createBrowserContext(),
      page = await context.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    page.on('pageerror', () => errors.push('Uncaught browser error'));
    page.on('response', (response) => {
      if (response.status() >= 500 && response.url().startsWith(base))
        failedRequests.push(new URL(response.url()).pathname + ':' + response.status());
    });
    return page;
  }
  async function staffLogin(username: string) {
    const page = await newPage();
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.type('input[name="identifier"]', username);
    await page.type('input[name="password"]', f.password);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
    );
    await page.click('button[type="submit"]');
    check((await pending).status() === 200, username + ': normal staff password login');
    await page.waitForSelector('aside');
    return page;
  }
  async function openDocuments(page: Page) {
    await clickDom(page, 'Patient Management');
    await page.waitForSelector('input[aria-label="Search patient directory"]');
    const search = (await page.$('input[aria-label="Search patient directory"]'))!;
    await search.click();
    await search.type(patientRow.mrn);
    await page.waitForFunction(
      (name) =>
        Array.from(document.querySelectorAll('button')).some((button) =>
          button.textContent?.includes(name),
        ),
      {},
      patientName,
    );
    await page.evaluate((name) => {
      const entry = Array.from(document.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(name),
      );
      (entry as HTMLButtonElement).click();
    }, patientName);
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Consent & Signed Documents',
      ),
    );
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Consent & Signed Documents',
      );
      (tab as HTMLButtonElement).click();
    });
    await page.waitForSelector('[aria-label="Consent & Signed Documents"]');
    await page.waitForFunction(
      () => !document.body.textContent?.includes('Loading authorized document versions'),
    );
  }
  async function uploadFromPanel(page: Page, title: string, notes = '') {
    const form = 'form[aria-label="Upload document"]';
    await page.waitForSelector(`${form} input[aria-label="Signed document file"]`);
    await (await page.$(`${form} input[aria-label="Signed document file"]`))!.uploadFile(file);
    await fill(page, 'Document title', title);
    if (notes) await fill(page, 'Notes (optional)', notes);
    const pending = page.waitForResponse(
      (response) =>
        /\/api\/patient-documents\/patients\/\d+$/.test(response.url()) &&
        response.request().method() === 'POST',
    );
    await page.evaluate((selector) => {
      const button = Array.from(document.querySelectorAll(`${selector} button`)).find(
        (entry) => entry.textContent?.trim() === 'Upload document' && !(entry as HTMLButtonElement).disabled,
      );
      if (!button) throw Error('Upload submit unavailable');
      (button as HTMLButtonElement).click();
    }, form);
    const response = await pending;
    check(response.status() === 201, title + ': real UI upload accepted');
    await page.waitForNetworkIdle();
    const uploadedId = await page.evaluate(
      async (target) => {
        const list = await fetch(
          `/api/patient-documents/patients/${target.patient}?search=${encodeURIComponent(target.title)}`,
          { headers: { Authorization: 'Bearer ' + localStorage.getItem('syrona_session_token') } },
        );
        const rows = (await list.json()) as { id: number; title: string }[];
        return rows.find((row) => row.title === target.title)?.id ?? null;
      },
      { patient: f.patient, title },
    );
    if (!uploadedId) throw Error('Uploaded document is not readable through the staff list');
    await page.waitForSelector(`[data-patient-document="${uploadedId}"]`);
    return uploadedId;
  }
  async function releaseFromPanel(page: Page, id: number, reason: string, review = false) {
    await clickDom(page, `Release to patient portal #${id}`);
    const dialog = 'form[aria-label="Portal release decision"]';
    await page.waitForSelector(dialog);
    if (review) {
      const checkbox = await page.$(
        `${dialog} input[aria-label="Reviewed original consent document"]`,
      );
      check(Boolean(checkbox), 'Consent release requires an explicit original review');
      await (checkbox as ElementHandle<HTMLInputElement>).evaluate((input) => input.click());
    }
    await fill(page, 'Portal release reason', reason);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/${id}/release`) && response.request().method() === 'POST',
    );
    await clickDom(page, 'Confirm portal release decision');
    check((await pending).status() === 200, `Release #${id} recorded as an authorized action`);
    await page.waitForNetworkIdle();
    await dismissToasts(page);
  }
  async function portalLogin(email: string) {
    const page = await newPage();
    await page.goto(base + '/portal', { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[autocomplete="username"]');
    await page.type('input[autocomplete="username"]', email);
    await page.type('input[autocomplete="current-password"]', portalPassword);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/portal/auth/login') && response.request().method() === 'POST',
    );
    await page.click('button[type="submit"]');
    check((await pending).status() === 200, 'Separate patient portal normal login');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('My Documents'),
      ),
    );
    await openPortalDocuments(page);
    return page;
  }
  async function openPortalDocuments(page: Page) {
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('My Documents'),
      );
      (tab as HTMLButtonElement).click();
    });
    await page.waitForSelector('[aria-label="My Documents & Signed Consents"]');
    await page.waitForFunction(
      () => !document.body.textContent?.includes('Loading your released documents'),
    );
    await page.waitForNetworkIdle();
  }
  async function portalRefresh(page: Page) {
    await page.reload({ waitUntil: 'networkidle2' });
    await openPortalDocuments(page);
  }
  async function portalSection(page: Page) {
    return (
      (await page.$eval(
        '[aria-label="My Documents & Signed Consents"]',
        (element) => element.textContent,
      )) ?? ''
    );
  }
  async function portalApi(page: Page, suffix: string) {
    return page.evaluate(async (target) => {
      const response = await fetch('/api/portal/documents' + target, {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('syrona_portal_token') },
      });
      const type = response.headers.get('content-type') ?? '';
      return {
        status: response.status,
        type,
        disposition: response.headers.get('content-disposition'),
        body: type.includes('json') ? await response.json() : null,
        bytes: type.includes('json') ? 0 : (await response.arrayBuffer()).byteLength,
      };
    }, suffix);
  }

  /* Staff: uploads, consent review, release, revocation and permission notice. */
  const staff = await staffLogin(f.staff.username);
  const staffToken = await staff.evaluate(() => localStorage.getItem('syrona_session_token'));
  const api = async (pathname: string, init: RequestInit = {}) => {
    const response = await fetch(base + pathname, {
      ...init,
      headers: { Authorization: `Bearer ${staffToken}`, ...(init.headers ?? {}) },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const uploadApi = (title: string, extra: Record<string, unknown> = {}) =>
    api(`/api/patient-documents/patients/${f.patient}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Document-Metadata': encodeURIComponent(
          JSON.stringify({
            // A simple upload carries no clinical assertion; the historical
            // radiology attachment below is the documented exception path.
            ...(extra.documentType ? {} : { uploadMode: 'SIMPLE' }),
            title,
            filename: `${title.replaceAll(' ', '-').toLowerCase()}.pdf`,
            ...extra,
          }),
        ),
      },
      body: new Uint8Array(bytes),
    });
  await openDocuments(staff);
  const formControls = await staff.$$eval(
    'form[aria-label="Upload document"] input, form[aria-label="Upload document"] textarea',
    (elements) => elements.length,
  );
  check(
    formControls === 3,
    'Upload form asks only for title, optional notes and the original file',
  );
  const generalId = await uploadFromPanel(
    staff,
    'Portal general letter',
    'PRIVATE STAFF NOTE do not publish',
  );
  const consentId = await uploadFromPanel(staff, 'Treatment consent form');
  const radiology = await uploadApi('Radiology consent form', { radiologyOrderId: order });
  check(
    radiology.status === 201,
    'Radiology consent is recorded through the same document store',
  );
  const radiologyId = (radiology.body as { id: number }).id;
  await clickDom(staff, 'Refresh documents');
  await staff.waitForSelector(`[data-patient-document="${radiologyId}"]`);

  const patientPortal = await portalLogin(portalEmail);
  const beforeRelease = await portalSection(patientPortal);
  check(
    !beforeRelease.includes('Portal general letter'),
    'Unreleased documents never appear in the portal',
  );
  check(
    !beforeRelease.includes('PRIVATE STAFF NOTE'),
    'Internal staff notes never appear in the portal',
  );
  check(
    (await portalApi(patientPortal, `/${generalId}/file?download=1`)).status === 404,
    'Guessing an unreleased document id returns 404',
  );
  check(
    (await patientPortal.$('[aria-label="Consent forms"]')) === null,
    'Consent forms are omitted until they are explicitly released',
  );

  await dismissToasts(staff);
  await releaseFromPanel(staff, generalId, 'Explicit synthetic general release');
  await portalRefresh(patientPortal);
  const afterGeneral = await portalSection(patientPortal);
  check(
    afterGeneral.includes('Portal general letter'),
    'A released general document is visible to its own patient',
  );
  check(
    (await patientPortal.$('[aria-label="Other documents"]')) !== null,
    'A general document is grouped under Other documents',
  );
  await patientPortal.screenshot({
    path: path.join(out, '02-portal-other-documents.png'),
    fullPage: true,
  });

  // Consent documents cannot be released without the explicit review step.
  await clickDom(staff, `Release to patient portal #${consentId}`);
  await staff.waitForSelector('form[aria-label="Portal release decision"]');
  const requiredReview = await staff.$eval(
    'form[aria-label="Portal release decision"] input[aria-label="Reviewed original consent document"]',
    (input) => (input as HTMLInputElement).required,
  );
  check(requiredReview, 'Consent release cannot be confirmed without reviewing the original');
  await clickDom(staff, 'Cancel release decision');
  await releaseFromPanel(staff, consentId, 'Explicit synthetic consent release', true);
  await releaseFromPanel(staff, radiologyId, 'Explicit synthetic radiology consent release', true);
  await portalRefresh(patientPortal);
  const portalText = await portalSection(patientPortal);
  check(
    (await patientPortal.$('[aria-label="Consent forms"]')) !== null,
    'Released consent forms appear under Consent forms',
  );
  check(
    portalText.includes('Radiology / procedure consent') &&
      portalText.includes('Imaging procedure: Synthetic browser chest X-ray'),
    'A radiology consent keeps its imaging procedure context in the portal',
  );
  await patientPortal.screenshot({
    path: path.join(out, '01-portal-consent-forms.png'),
    fullPage: true,
  });

  // Clinical documents: a laboratory summary and a radiology-origin report.
  const lab = await uploadApi('Laboratory result summary');
  check(lab.status === 201, 'A laboratory summary is stored as a clinical document');
  const labId = (lab.body as { id: number }).id;
  await pool.query("UPDATE radiology_orders SET status='reported',reported_at=now() WHERE id=$1", [
    order,
  ]);
  // A historical attachment is deliberately recorded without clinical
  // assertions: no category, signature or signing date may be claimed for it.
  const report = await uploadApi('Radiology report addendum', {
    radiologyOrderId: order,
    radiologyAttachmentMode: 'HISTORICAL',
    reason: 'Synthetic historical report attached after reporting',
  });
  check(
    report.status === 201,
    'A radiologist report is attached through the documented historical path',
  );
  const reportId = (report.body as { id: number }).id;
  await dismissToasts(staff);
  await clickDom(staff, 'Refresh documents');
  await staff.waitForSelector(`[data-patient-document="${labId}"]`);
  const reportRow = await staff.$eval(
    `[data-patient-document="${reportId}"]`,
    (element) => element.textContent,
  );
  check(
    Boolean(
      reportRow?.includes('Radiology document') &&
        reportRow?.includes('Imaging request #' + order) &&
        !reportRow?.includes('Yes'),
    ),
    'A post-reporting attachment is recorded without claiming prior consent or verification',
  );
  await releaseFromPanel(staff, labId, 'Explicit synthetic laboratory release');
  await releaseFromPanel(staff, reportId, 'Explicit synthetic report release');
  await portalRefresh(patientPortal);
  const clinical = await patientPortal.$eval('[aria-label="Clinical documents"]', (element) => element.textContent);
  check(
    Boolean(clinical?.includes('Laboratory result summary') && clinical?.includes('Laboratory document')),
    'A released laboratory summary appears under Clinical documents',
  );
  check(
    Boolean(
      clinical?.includes('Radiology report addendum') &&
        clinical?.includes('Radiology supporting document') &&
        clinical?.includes('Radiology & Imaging') &&
        clinical?.includes('Imaging procedure: Synthetic browser chest X-ray'),
    ),
    'A radiology-origin report appears under Clinical documents, never under consent',
  );
  const portalHidden = await portalSection(patientPortal);
  check(
    !portalHidden.includes('Recorded patient signature') &&
      !portalHidden.includes('Recorded doctor signature') &&
      !portalHidden.includes('Synthetic historical report attached after reporting'),
    'Recorded signature state and staff release reasons stay out of the portal',
  );
  await patientPortal.screenshot({
    path: path.join(out, '01b-portal-clinical-documents.png'),
    fullPage: true,
  });

  // Preview and download of the original.
  const previewPending = patientPortal.waitForResponse(
    (response) => response.url().includes(`/${generalId}/file?preview=1`),
  );
  await clickDom(patientPortal, `View document ${generalId}`);
  check((await previewPending).status() === 200, 'View document serves the released original');
  check(
    (await patientPortal.$('iframe[title="Released document preview"]')) !== null,
    'Preview renders in a sandboxed frame',
  );
  const downloadPending = patientPortal.waitForResponse(
    (response) => response.url().includes(`/${generalId}/file?download=1`),
  );
  await clickDom(patientPortal, `Download original ${generalId}`);
  const download = await downloadPending;
  check(
    download.status() === 200 &&
      (download.headers()['content-disposition'] ?? '').includes('attachment'),
    'Download original serves the unchanged attachment',
  );
  await patientPortal.screenshot({ path: path.join(out, '03-portal-preview.png'), fullPage: true });

  // Version history: a released correction becomes a second released version.
  const correction = await uploadApi('Portal general letter', { previousId: generalId });
  const correctionId = (correction.body as { id: number }).id;
  await clickDom(staff, 'Refresh documents');
  await staff.waitForSelector(`[data-patient-document="${correctionId}"]`);
  await releaseFromPanel(staff, correctionId, 'Explicit synthetic version release');
  await portalRefresh(patientPortal);
  await clickDom(patientPortal, `Version history ${generalId}`);
  await patientPortal.waitForSelector('[aria-label="Document version history"]');
  const versions =
    (await patientPortal.$eval(
      '[aria-label="Document version history"]',
      (element) => element.textContent,
    )) ?? '';
  check(
    versions.includes('Version 1') && versions.includes('Version 2'),
    'Released versions are listed without staff audit events',
  );

  // Pagination far beyond the old 200-row limit.
  for (let guard = 0; guard < 12; guard += 1) {
    const hasMore = await patientPortal.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Load more documents' && !button.disabled,
      ),
    );
    if (!hasMore) break;
    const pending = patientPortal.waitForResponse(
      (response) => response.url().includes('/api/portal/documents?') && response.status() === 200,
    );
    await clickDom(patientPortal, 'Load more documents');
    await pending;
    await patientPortal.waitForNetworkIdle();
  }
  check(
    (await portalSection(patientPortal)).includes('All released documents loaded'),
    'Load more walks the whole authorized history',
  );
  check(
    (await portalSection(patientPortal)).includes('ARCHIVE oldest released document'),
    'A document older than the former 200-row window is reachable',
  );
  await patientPortal.screenshot({
    path: path.join(out, '04-portal-pagination.png'),
    fullPage: true,
  });

  // Revocation removes it from the portal and states why in staff view.
  await dismissToasts(staff);
  await clickDom(staff, `Withdraw portal release #${generalId}`);
  await staff.waitForSelector('form[aria-label="Portal release decision"]');
  await fill(staff, 'Portal release reason', 'Explicit synthetic withdrawal reason');
  const withdrawal = staff.waitForResponse(
    (response) =>
      response.url().endsWith(`/${generalId}/release`) && response.request().method() === 'POST',
  );
  await clickDom(staff, 'Confirm portal release decision');
  check((await withdrawal).status() === 200, 'Withdrawal is a separate reasoned action');
  await staff.waitForNetworkIdle();
  await dismissToasts(staff);
  await staff.waitForFunction(
    (id) => {
      const entry = document.querySelector('[data-patient-document="' + id + '"]');
      return Boolean(entry?.textContent?.includes('Release revoked'));
    },
    {},
    generalId,
  );
  check(true, 'Staff list shows the revoked release state');
  await staff.screenshot({ path: path.join(out, '05-staff-release-states.png'), fullPage: true });
  await portalRefresh(patientPortal);
  check(
    (await patientPortal.$(`[data-patient-document="${generalId}"]`)) === null,
    'The revoked version is gone from the portal while the released correction remains',
  );
  check(
    (await portalApi(patientPortal, `/${generalId}/file?download=1`)).status === 404,
    'A revoked document id cannot be retrieved directly',
  );

  // Another patient cannot reach this patient's documents.
  const otherPortal = await portalLogin(otherEmail);
  const otherText = await portalSection(otherPortal);
  check(
    !otherText.includes('Portal general letter') && !otherText.includes('Treatment consent form'),
    'Another patient sees none of these documents',
  );
  check(
    (await portalApi(otherPortal, `/${consentId}/file?download=1`)).status === 404,
    'Another patient cannot fetch a document by id',
  );
  check(
    otherText.includes('No documents have been released to your portal yet.'),
    'A patient with nothing released gets the contextual empty state',
  );

  // Awaiting-release empty state and a filtered empty state.
  const awaitingPortal = await portalLogin(awaitingEmail);
  check(
    (await portalSection(awaitingPortal)).includes('Your facility has documents awaiting release.'),
    'A patient with unreleased documents is told they are awaiting release',
  );
  await awaitingPortal.screenshot({
    path: path.join(out, '06-portal-empty-state.png'),
    fullPage: true,
  });
  await fill(patientPortal, 'Search my documents', 'nothing matches this synthetic search');
  const searchPending = patientPortal.waitForResponse(
    (response) => response.url().includes('search=nothing') && response.status() === 200,
  );
  await clickDom(patientPortal, 'Search documents');
  await searchPending;
  await patientPortal.waitForNetworkIdle();
  check(
    (await portalSection(patientPortal)).includes('No documents match your current filters.'),
    'An empty filtered result explains the filters instead of the repository',
  );

  // A staff member without the release permission is told why the action is absent.
  const uploader = await staffLogin(f.unauthorized.username);
  await openDocuments(uploader);
  const uploaderText =
    (await uploader.$eval(
      '[aria-label="Consent & Signed Documents"]',
      (element) => element.textContent,
    )) ?? '';
  check(
    uploaderText.includes('Portal release needs the') &&
      !uploaderText.includes('Select for portal release'),
    'A read/upload-only account sees an explanation, not a silently missing control',
  );
  await uploader.screenshot({
    path: path.join(out, '07-staff-release-permission.png'),
    fullPage: true,
  });

  check(
    errors.length === 0 && failedRequests.length === 0,
    'No uncaught browser errors and no same-origin 500 responses',
  );
  await writeFile(
    path.join(out, 'results.json'),
    JSON.stringify(
      {
        syntheticOnly: true,
        productionAccess: false,
        checks,
        errors,
        failedRequests,
        archiveDocuments: 210,
        fixture: { tenant: f.tenant, facility: f.facility, patient: f.patient, order },
        documents: {
          general: generalId,
          consent: consentId,
          radiologyConsent: radiologyId,
          radiologyReport: reportId,
          laboratory: labId,
          correction: correctionId,
        },
      },
      null,
      2,
    ) + '\n',
  );
  await rm(path.join(out, 'failure.json'), { force: true });
} catch (error) {
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify(
      { syntheticOnly: true, checks, errors, failedRequests, error: (error as Error).message },
      null,
      2,
    ) + '\n',
  );
  console.error('ACCEPTANCE FAILED:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server?.kill('SIGTERM');
}
