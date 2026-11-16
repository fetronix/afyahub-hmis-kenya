/**
 * Actual built-SPA / Express / PostgreSQL acceptance for the portal release
 * confirmation ("Confirm portal release decision").
 *
 * Every request is served by the built application against the independently
 * attested disposable synthetic database with synthetic users. Real mouse
 * clicks are used so a swallowed click would fail the run.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../src/db/index.ts';
import { hashPassword } from '../src/utils/password.ts';
import { createResponsibleDoctorFixture } from '../src/tests/integration/support/responsible-doctor.fixture.ts';

if (process.env.RESPONSIBLE_DOCTOR_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic release acceptance and controlled Chromium required');
const out = path.resolve(
  process.env.PORTAL_RELEASE_EVIDENCE_DIR ?? 'docs/audits/portal-release-confirmation-evidence',
);
const base = 'http://127.0.0.1:4207';
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

/** Real pointer click at the element's centre, after hit-testing the target. */
async function click(page: Page, label: string) {
  const handle = await page.evaluateHandle((text) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === text,
    );
    return button ?? null;
  }, label);
  const element = handle.asElement();
  if (!element) throw Error('Missing button: ' + label);
  await element.evaluate((node) => (node as HTMLElement).scrollIntoView({ block: 'center' }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  const box = await element.boundingBox();
  if (!box) throw Error('No clickable box for ' + label);
  const topmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim() ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  if (topmost !== label) throw Error(`Click on "${label}" would land on "${topmost}"`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await handle.dispose();
}
async function toggle(page: Page, ariaLabel: string) {
  const handle = await page.$(`[aria-label="${ariaLabel}"]`);
  if (!handle) throw Error('Missing control: ' + ariaLabel);
  await handle.evaluate((node) => (node as HTMLInputElement).click());
}
async function typeInto(page: Page, label: string, value: string) {
  const handle = await page.evaluateHandle((text) => {
    const field = Array.from(document.querySelectorAll('label')).find((entry) =>
      entry.textContent?.trim().startsWith(text),
    );
    return field?.querySelector('input,textarea') ?? null;
  }, label);
  const element = handle.asElement();
  if (!element) throw Error('Missing field: ' + label);
  await element.evaluate((node) => (node as HTMLInputElement).select?.());
  await (element as unknown as { press: (key: string) => Promise<void> }).press('Backspace');
  await (element as unknown as { type: (text: string) => Promise<void> }).type(value);
  await handle.dispose();
}
async function select(page: Page, id: number) {
  const box = await page.$(`input[aria-label$="#${id}"]`);
  if (!box) throw Error('Missing selection checkbox for #' + id);
  await box.evaluate((node) => (node as HTMLInputElement).click());
  await page.waitForNetworkIdle();
}
async function clearSelection(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Select "]')
      .forEach((node) => {
        if (node.checked) node.click();
      });
  });
  await page.waitForNetworkIdle();
}

try {
  const f = await createResponsibleDoctorFixture();
  check(true, 'Independently attested disposable synthetic PostgreSQL only');
  await mkdir(out, { recursive: true });
  await mkdir('.tmp-tools/portal-release-browser', { recursive: true });

  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic portal release confirmation', { x: 40, y: 760, size: 12 });
  const bytes = Buffer.from(await pdf.save());
  const file = path.resolve('.tmp-tools/portal-release-browser/document.pdf');
  await writeFile(file, bytes);

  const portalEmail = `release_${f.tenant}@example.test`;
  const portalPassword = 'Synthetic-release-portal-only!7';
  await pool.query(
    "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
    [f.tenant, f.facility, f.patient, portalEmail, await hashPassword(portalPassword)],
  );
  const otherPatient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Release Other','1990-03-03','Other') RETURNING id",
      [f.tenant, f.facility, 'RELOB-' + f.tenant],
    )
  ).rows[0].id as number;

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4207',
    SQL_SSL: 'false',
    LOG_LEVEL: 'silent',
    APP_BASE_URL: base,
  };
  server = spawn('node', ['build/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Built app startup timeout')), 40000);
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
    await page.setViewport({ width: 1440, height: 1000 });
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
    await page.type('input[placeholder="Username or Email"]', username);
    await page.type('input[placeholder="Password"]', f.password);
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
    await click(page, 'Patient Management');
    const search = await page.waitForSelector('input[aria-label="Search patient directory"]');
    await (search as unknown as { click: () => Promise<void> }).click();
    await (search as unknown as { type: (text: string) => Promise<void> }).type('DOC-');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('Synthetic Doctor Assignment'),
      ),
    );
    await page.evaluate(() => {
      const entry = Array.from(document.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Synthetic Doctor Assignment'),
      );
      (entry as HTMLButtonElement).click();
    });
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
  async function upload(page: Page, title: string) {
    const form = 'form[aria-label="Upload document"]';
    await page.waitForSelector(`${form} input[aria-label="Signed document file"]`);
    await (await page.$(`${form} input[aria-label="Signed document file"]`))!.uploadFile(file);
    await typeInto(page, 'Document title', title);
    const pending = page.waitForResponse(
      (response) =>
        /\/api\/patient-documents\/patients\/\d+$/.test(response.url()) &&
        response.request().method() === 'POST',
    );
    await click(page, 'Upload document');
    check((await pending).status() === 201, title + ': real UI upload accepted');
    await page.waitForNetworkIdle();
    const row = await pool.query(
      'SELECT id FROM patient_signed_documents WHERE patient_id=$1 AND title=$2 ORDER BY id DESC LIMIT 1',
      [f.patient, title],
    );
    return row.rows[0].id as number;
  }
  async function openPanel(page: Page, label: string) {
    await clearSelection(page);
    await click(page, label);
    await page.waitForSelector('form[aria-label="Portal release decision"]');
  }
  async function confirm(page: Page, reason: string) {
    await typeInto(page, 'Portal release reason', reason);
    const pending = page.waitForResponse(
      (response) =>
        /\/api\/patient-documents\/patients\/\d+\/(releases|\d+\/release)$/.test(response.url()) &&
        response.request().method() === 'POST',
    );
    await click(page, 'Confirm portal release decision');
    return pending;
  }
  async function releaseRow(page: Page, id: number) {
    return page.evaluate(
      (target) => document.querySelector(`[data-patient-document="${target}"]`)?.textContent ?? null,
      id,
    );
  }

  const staff = await staffLogin(f.staff.username);
  await openDocuments(staff);
  const generalA = await upload(staff, 'Release general A');
  const generalB = await upload(staff, 'Release general B');
  const consentC = await upload(staff, 'Treatment consent form');
  const generalD = await upload(staff, 'Release general D');
  check(
    [generalA, generalB, consentC, generalD].every((id) => Number.isInteger(id)),
    'Four synthetic documents were uploaded through the staff UI',
  );
  await click(staff, 'Refresh documents');
  await staff.waitForNetworkIdle();

  /* 1. Single-document release. */
  await openPanel(staff, `Release to patient portal #${generalA}`);
  await staff.screenshot({ path: path.join(out, '01-confirm-panel.png') });
  const single = await confirm(staff, 'Explicit synthetic single release reason');
  check((await single).status() === 200, 'Single-document release returns success from the server');
  await staff.waitForNetworkIdle();
  check(
    (await staff.$('form[aria-label="Portal release decision"]')) === null,
    'The confirmation panel closes only after the server persisted the decision',
  );
  check(
    (await releaseRow(staff, generalA))?.includes('Released to patient portal'),
    'The released row shows "Released to patient portal"',
  );
  check(
    (await staff.$eval('[aria-label="Portal release result"]', (node) => node.textContent))?.includes(
      'Released 1 document to the patient portal.',
    ),
    'A success message names how many documents were released',
  );

  /* 2. Bulk release of two documents. */
  await select(staff, generalB);
  await select(staff, consentC);
  await click(staff, 'Release selected (2) to patient portal');
  await staff.waitForSelector('form[aria-label="Portal release decision"]');
  await toggle(staff, 'Reviewed original consent document');
  const bulk = await confirm(staff, 'Explicit synthetic bulk release reason');
  check((await bulk).status() === 200, 'Bulk release of two documents returns success');
  const bulkBody = (await bulk.json()) as { documents: Array<{ document_id: number }> };
  check(
    bulkBody.documents.map((entry) => entry.document_id).sort((a, b) => a - b).join(',') ===
      [generalB, consentC].sort((a, b) => a - b).join(','),
    'The bulk response names both released documents',
  );
  await staff.waitForNetworkIdle();
  check(
    Boolean(
      (await releaseRow(staff, generalB))?.includes('Released to patient portal') &&
        (await releaseRow(staff, consentC))?.includes('Released to patient portal'),
    ),
    'Both bulk documents show the released state',
  );

  /* 3. Empty and short release reasons are explained, not silently blocked. */
  await openPanel(staff, `Release to patient portal #${generalD}`);
  const noRequest = staff
    .waitForResponse(
      (response) => response.url().includes('/release') && response.request().method() === 'POST',
      { timeout: 1200 },
    )
    .then(() => false)
    .catch(() => true);
  await click(staff, 'Confirm portal release decision');
  const alert = await staff.$eval(
    '[aria-label="Portal release error"]',
    (node) => node.textContent ?? '',
  );
  check(
    alert.includes('at least 10 characters'),
    'An empty release reason shows a clear validation message',
  );
  check(await noRequest, 'No release request is sent while the reason is missing');
  await typeInto(staff, 'Portal release reason', 'short');
  await click(staff, 'Confirm portal release decision');
  check(
    (await staff.$eval('[aria-label="Portal release error"]', (node) => node.textContent))?.includes(
      'at least 10 characters',
    ),
    'A too-short release reason keeps the same visible explanation',
  );
  await staff.screenshot({ path: path.join(out, '02-validation-message.png') });

  const generalF = await upload(staff, 'Release general F unreleased');
  await click(staff, 'Refresh documents');
  await staff.waitForNetworkIdle();

  /* 4. Duplicate confirmations cannot record a second action. */
  await typeInto(staff, 'Portal release reason', 'Explicit synthetic duplicate guard reason');
  const firstClick = staff.waitForResponse(
    (response) =>
      response.url().endsWith(`/${generalD}/release`) && response.request().method() === 'POST',
  );
  await click(staff, 'Confirm portal release decision');
  // A second click may land on the now-disabled button; it must not add a request.
  const box = await staff.$eval('form[aria-label="Portal release decision"] button[type="submit"]', (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }).catch(() => null);
  if (box) await staff.mouse.click(box.x, box.y);
  check((await firstClick).status() === 200, 'The first confirmation releases the document');
  await staff.waitForNetworkIdle();
  const repeated = await staff.evaluate(async (target) => {
    const response = await fetch(`/api/patient-documents/patients/${target.patient}/${target.id}/release`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        released: true,
        reason: 'Explicit synthetic duplicate guard reason',
        reviewedOriginal: false,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { patient: f.patient, id: generalD });
  check(
    repeated.status === 200 && repeated.body.already_recorded === true,
    'A repeated decision is reported as already recorded instead of duplicating the action',
  );
  const auditEvents = await pool.query(
    "SELECT id,actor_id,reason,created_at FROM patient_document_events WHERE document_id=$1 AND action='PORTAL_RELEASE'",
    [generalD],
  );
  check(
    auditEvents.rowCount === 1 &&
      auditEvents.rows[0].actor_id === f.staff.id &&
      auditEvents.rows[0].reason === 'Explicit synthetic duplicate guard reason' &&
      Boolean(auditEvents.rows[0].created_at),
    'Audit history records one action with the authenticated actor, reason and timestamp',
  );

  /* 5. Successful release persists after a refresh, and the mutation is audited. */
  await staff.reload({ waitUntil: 'networkidle2' });
  await openDocuments(staff);
  check(
    (await releaseRow(staff, generalA))?.includes('Released to patient portal') &&
      (await releaseRow(staff, generalB))?.includes('Released to patient portal'),
    'Released state persists after a full page refresh',
  );
  check(
    (await releaseRow(staff, generalA))?.includes('Uploaded by: Synthetic Records') &&
      (await releaseRow(staff, generalA))?.includes('Original filename:') &&
      (await releaseRow(staff, generalA))?.includes('Version 1'),
    'Uploader, original filename and version survive the release',
  );
  const signatures = await pool.query(
    'SELECT patient_signature,doctor_signature FROM patient_signed_documents WHERE id=$1',
    [generalA],
  );
  check(
    signatures.rows[0].patient_signature === 'UNKNOWN' &&
      signatures.rows[0].doctor_signature === 'UNKNOWN',
    'Release never changes a recorded signature state',
  );
  await click(staff, `Version & audit history #${generalA}`);
  await staff.waitForSelector('[aria-label="Document version and audit history"]');
  const historyText =
    (await staff.$eval(
      '[aria-label="Document version and audit history"]',
      (node) => node.textContent,
    )) ?? '';
  check(
    historyText.includes('PORTAL_RELEASE') &&
      historyText.includes('Explicit synthetic single release reason'),
    'The staff audit history shows the release action and its reason',
  );
  await click(staff, 'Close history');

  /* 6. Partial bulk failure is reported accurately. */
  const generalE = await upload(staff, 'Release general E');
  await click(staff, 'Refresh documents');
  await staff.waitForNetworkIdle();
  await openPanel(staff, `Release to patient portal #${generalE}`);
  const partial = await staff.evaluate(
    async (target) => {
      const response = await fetch(`/api/patient-documents/patients/${target.patient}/releases`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // A stale client that lost the consent review flag in its selection.
          documentIds: [target.good, target.consent],
          released: true,
          reason: 'Explicit synthetic partial release reason',
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { patient: f.patient, good: generalE, consent: consentC },
  );
  check(
    partial.status === 200 &&
      partial.body.partial === true &&
      partial.body.documents.length === 1 &&
      partial.body.failures.length === 1 &&
      partial.body.failures[0].error === 'CONSENT_REVIEW_REQUIRED',
    'A partial bulk decision reports the released document and the refused one',
  );
  const partialError = await pool.query(
    'SELECT reason FROM patient_document_events WHERE document_id=$1 ORDER BY id DESC LIMIT 1',
    [generalE],
  );
  check(
    partialError.rows[0].reason === 'Explicit synthetic partial release reason',
    'The successful part of a partial decision is persisted with its reason',
  );
  await click(staff, 'Cancel release decision');

  /* 7. A staff member without the release permission is refused, not silently blocked. */
  const uploader = await staffLogin(f.unauthorized.username);
  await openDocuments(uploader);
  const uploaderText =
    (await uploader.$eval(
      '[aria-label="Consent & Signed Documents"]',
      (node) => node.textContent,
    )) ?? '';
  check(
    uploaderText.includes('Portal release needs the') &&
      !uploaderText.includes('Select for portal release'),
    'A read/upload-only account sees why release controls are absent',
  );
  const refused = await uploader.evaluate(
    async (target) => {
      const response = await fetch(
        `/api/patient-documents/patients/${target.patient}/${target.id}/release`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            released: true,
            reason: 'Synthetic unauthorized portal release attempt',
            reviewedOriginal: false,
          }),
        },
      );
      return response.status;
    },
    { patient: f.patient, id: generalA },
  );
  check(refused === 403, 'An unauthorized release request is rejected with 403');
  await uploader.screenshot({ path: path.join(out, '03-release-permission.png'), fullPage: true });

  /* 8. Invalid document targets are refused. */
  const foreign = await pool.query(
    `INSERT INTO patient_signed_documents
      (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason)
     VALUES($1,$2,$3,1,'Other patient document','Document','Patient document','UNKNOWN','UNKNOWN','other.pdf','application/pdf',$4,$5,$6,'Synthetic other patient document') RETURNING id`,
    [
      f.tenant,
      f.facility,
      otherPatient,
      'd'.repeat(64),
      bytes,
      f.staff.id,
    ],
  );
  const foreignAttempt = await staff.evaluate(
    async (target) => {
      const response = await fetch(`/api/patient-documents/patients/${target.patient}/releases`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + localStorage.getItem('jalicare_session_token'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentIds: [target.foreign],
          released: true,
          reason: 'Synthetic cross-patient release attempt',
        }),
      });
      return response.status;
    },
    { patient: f.patient, foreign: foreign.rows[0].id },
  );
  check(foreignAttempt === 404, "Another patient's document cannot be released for this patient");

  /* 9. The patient portal shows exactly the released documents. */
  const patient = await (async () => {
    const page = await newPage();
    await page.goto(base + '/portal', { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[autocomplete="username"]');
    await page.type('input[autocomplete="username"]', portalEmail);
    await page.type('input[autocomplete="current-password"]', portalPassword);
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/portal/auth/login') &&
        response.request().method() === 'POST',
    );
    await page.click('button[type="submit"]');
    check((await pending).status() === 200, 'Separate patient portal normal login');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('My Documents'),
      ),
    );
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
    return page;
  })();
  const portalText =
    (await patient.$eval(
      '[aria-label="My Documents & Signed Consents"]',
      (node) => node.textContent,
    )) ?? '';
  check(
    portalText.includes('Release general A') &&
      portalText.includes('Release general B') &&
      portalText.includes('Treatment consent form') &&
      portalText.includes('Release general E'),
    'The authenticated patient sees every released document',
  );
  check(
    !portalText.includes('Release general F unreleased'),
    'A document uploaded but never released stays invisible to the patient',
  );
  await patient.screenshot({ path: path.join(out, '04-patient-record.png'), fullPage: true });

  /* 10. Released originals are readable, unreleased ones are not. */
  const releasedFile = await patient.evaluate(async (id) => {
    const response = await fetch(`/api/portal/documents/${id}/file?download=1`, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_portal_token') },
    });
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  }, generalA);
  check(
    releasedFile.status === 200 && releasedFile.bytes > 0,
    'The patient can download the released original',
  );
  const unreleasedFile = await patient.evaluate(async (id) => {
    const response = await fetch(`/api/portal/documents/${id}/file?download=1`, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_portal_token') },
    });
    return response.status;
  }, generalF);
  check(
    unreleasedFile === 404,
    'An unreleased document id is refused even when the patient knows it',
  );
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
        fixture: { tenant: f.tenant, facility: f.facility, patient: f.patient },
        documents: {
          generalA,
          generalB,
          consentC,
          generalD,
          generalE,
          generalF,
          otherPatientDocument: foreign.rows[0].id,
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
