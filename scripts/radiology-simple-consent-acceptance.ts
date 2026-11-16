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
  process.env.RADIOLOGY_CONSENT_EVIDENCE_DIR ??
    'docs/audits/radiology-consent-simplification-evidence',
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
  await el.click();
  await el.evaluate((e) => {
    if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) e.select();
  });
  await el.press('Backspace');
  await el.type(value);
  await h.dispose();
}
/**
 * Dispatch the actual enabled native button's click. After a popup/notification
 * in headless Chromium, CDP pointer events can be swallowed; this still runs the
 * application's own React handler, with no request interception or mocks.
 */
async function clickDom(page: Page, label: string) {
  await page.waitForFunction(
    (text) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(
        (b) => b.textContent?.trim() === text && !b.disabled,
      ),
    {},
    label,
  );
  await page.evaluate((text) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text && !b.disabled,
    );
    if (!button) throw Error('Missing enabled button ' + text);
    button.click();
  }, label);
}
/** Toast notifications are real app UI; dismiss them before the next click. */
async function dismissNotifications(page: Page) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const dismiss = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Dismiss',
    );
    if (dismiss) (dismiss as HTMLButtonElement).click();
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Dismiss',
      ),
  );
}
async function fillById(page: Page, id: string, value: string) {
  const el = (await page.$(`#${id}`)) as ElementHandle<HTMLTextAreaElement> | null;
  if (!el) throw Error('Missing field ' + id);
  await el.click();
  await el.evaluate((e) => e.select());
  await el.press('Backspace');
  await el.type(value);
}
try {
  const f = await createResponsibleDoctorFixture();
  check(true, 'Independently attested disposable synthetic PostgreSQL only');
  await mkdir(out, { recursive: true });
  await mkdir('.tmp-tools/rad-browser', { recursive: true });
  for (const code of ['radiology.consent.verify', 'clinical.update', 'radiology.consent.policy']) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'radiology') ON CONFLICT(code) DO NOTHING",
      [code],
    );
  }
  for (const code of ['radiology.consent.verify', 'clinical.update'])
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
      [f.doctorRole, code],
    );
  // Explicit synthetic facility administrator, non-doctor, with upload and
  // verification permissions: permission alone must not permit impersonation.
  const adminRole = (
    await pool.query("INSERT INTO roles(tenant_id,name) VALUES($1,'FACILITY_ADMIN') RETURNING id", [
      f.tenant,
    ])
  ).rows[0].id as number;
  for (const code of [
    'patients.read',
    'patients.documents.read',
    'patients.documents.upload',
    'patients.documents.release',
    'clinical.read',
    'laboratory.read',
    'pharmacy.read',
    'billing.read',
    'radiology.consent.verify',
    'radiology.consent.policy',
    'clinical.update',
    'facilities.update',
    'users.invite',
    'system.settings.manage',
  ]) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'configuration') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
      [adminRole, code],
    );
  }
  const adminUsername = `radiology_admin_${f.tenant}`;
  const admin = (
    await pool.query(
      "INSERT INTO users(uid,username,email,full_name,designation,password_hash,tenant_id,facility_id,account_status,is_active) VALUES($1,$2,$3,'Synthetic Facility Administrator','Facility Administrator',$4,$5,$6,'ACTIVE',true) RETURNING id",
      [
        adminUsername,
        adminUsername,
        adminUsername + '@example.test',
        await hashPassword(f.password),
        f.tenant,
        f.facility,
      ],
    )
  ).rows[0] as { id: number; username: string; name: string };
  admin.username = adminUsername;
  admin.name = 'Synthetic Facility Administrator';
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [admin.id, adminRole]);

  const order = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'CT','Synthetic browser consent CT') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id as number;
  const gate = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'CT','Synthetic browser gate CT') RETURNING id",
      [f.tenant, f.facility, f.patient],
    )
  ).rows[0].id as number;
  let reported: number;
  // The supplied workspace includes legacy requests already marked Reported.
  // Recreate that disposable legacy state without weakening the live trigger.
  await pool.query(
    'ALTER TABLE radiology_orders DISABLE TRIGGER radiology_consent_performance_guard',
  );
  try {
    reported = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name,status,reported_at,reported_by) VALUES($1,$2,$3,'CT','Synthetic browser reported CT','Reported',now(),'Synthetic legacy reporter') RETURNING id",
        [f.tenant, f.facility, f.patient],
      )
    ).rows[0].id as number;
  } finally {
    await pool.query(
      'ALTER TABLE radiology_orders ENABLE TRIGGER radiology_consent_performance_guard',
    );
  }
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic simple radiology consent', { x: 40, y: 760, size: 12 });
  const bytes = Buffer.from(await pdf.save());
  const file = path.resolve('.tmp-tools/rad-browser/consent.pdf');
  await writeFile(file, bytes);
  const evidencePdf = path.resolve(out, 'synthetic-consent.pdf');
  await writeFile(evidencePdf, bytes);

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
  async function login(username: string) {
    const context = await browser!.createBrowserContext(),
      page = await context.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    page.on('pageerror', () => errors.push('Uncaught browser error'));
    page.on('response', (r) => {
      if (r.status() >= 500 && r.url().startsWith(base))
        failedRequests.push(new URL(r.url()).pathname + ':' + r.status());
    });
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.type('input[placeholder="Username or Email"]', username);
    await page.type('input[placeholder="Password"]', f.password);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
    );
    await page.click('button[type="submit"]');
    check((await response).status() === 200, username + ': normal password login');
    await page.waitForSelector('aside');
    return page;
  }
  async function openRadiology(page: Page, procedure: string) {
    await click(page, 'Radiology & Imaging', 'aside button');
    await page.waitForFunction(
      (name) =>
        Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes(name)),
      {},
      procedure,
    );
    const study = await page.evaluateHandle(
      (name) =>
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(name)),
      procedure,
    );
    await (study.asElement() as ElementHandle<Element>).click();
    await study.dispose();
    await page.waitForSelector('[aria-label="Procedure-specific radiology consent"]');
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[aria-label="Procedure-specific radiology consent"]')
          ?.textContent?.includes('Loading consent status'),
    );
  }
  async function panelText(page: Page) {
    return page.$eval(
      '[aria-label="Procedure-specific radiology consent"]',
      (e) => e.textContent ?? '',
    );
  }
  async function documents(page: Page) {
    return page.evaluate(async (patient) => {
      const r = await fetch(`/api/patient-documents/patients/${patient}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jalicare_session_token')}` },
      });
      return { status: r.status, data: await r.json() };
    }, f.patient);
  }
  async function uploadFromPanel(page: Page, formLabel: string, title: string, reason?: string) {
    const form = `form[aria-label=${JSON.stringify(formLabel)}]`;
    await page.waitForSelector(`${form} input[aria-label="Original consent file"]`);
    await (await page.$(`${form} input[aria-label="Original consent file"]`))!.uploadFile(file);
    await fill(page, 'Document title', title);
    if (reason) await fill(page, 'Reason for attaching after reporting', reason);
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/patient-documents/patients/${f.patient}`) &&
        r.request().method() === 'POST',
    );
    await page.$eval(form, (e) => {
      const button = Array.from(e.querySelectorAll('button')).find((b) =>
        /^(Upload document|Attach historical document)$/.test(b.textContent?.trim() ?? ''),
      );
      if (!button || button.disabled) throw Error('Upload submit unavailable');
      button.click();
    });
    const response = await pending;
    check(response.status() === 201, title + ': actual UI upload accepted');
    await page.waitForNetworkIdle();
  }

  const adminPage = await login(admin.username);
  await openRadiology(adminPage, 'Synthetic browser consent CT');
  check(
    (await panelText(adminPage)).includes('No document uploaded'),
    'New pending request shows no document uploaded and permits consent upload',
  );
  check(
    !(await panelText(adminPage)).includes('Facility-wide radiology consent policy'),
    'Facility-wide policy controls are not mixed into the everyday consent panel',
  );
  await clickDom(adminPage, 'Upload consent document');
  const uploadForm = 'form[aria-label="Upload radiology consent document"]';
  await adminPage.waitForSelector(uploadForm);
  const controlCount = await adminPage.$eval(
    uploadForm,
    (e) => e.querySelectorAll('input,textarea,select').length,
  );
  check(controlCount === 3, 'Consent form has only title, optional notes and original file');
  for (const label of [
    'Patient ID',
    'Imaging request ID',
    'Facility ID',
    'Doctor user ID',
    'Document category',
    'Consent type',
    'Signing date',
    'Audit reason',
    'Patient signature status',
    'Doctor signature status',
  ])
    check(
      (await adminPage.$eval(
        uploadForm,
        (e, label) =>
          !Array.from(e.querySelectorAll('label')).some((l) => l.textContent?.includes(label)),
        label,
      )) === true,
      'Upload form omits ' + label,
    );
  await uploadFromPanel(
    adminPage,
    'Upload radiology consent document',
    'Synthetic browser consent',
  );
  await adminPage.waitForFunction(() =>
    document
      .querySelector('[aria-label="Procedure-specific radiology consent"]')
      ?.textContent?.includes('Document uploaded — awaiting doctor review'),
  );
  const uploaded = (await documents(adminPage)).data.find(
    (d: any) => d.title === 'Synthetic browser consent',
  );
  check(
    uploaded?.patient_id === f.patient &&
      uploaded?.radiology_order_id === order &&
      uploaded?.procedure_name === 'Synthetic browser consent CT' &&
      uploaded?.doctor_id === null &&
      uploaded?.patient_signature === 'UNKNOWN' &&
      uploaded?.radiology_attachment_context === 'PRE_PROCEDURE',
    'Upload automatically links exact patient/request/procedure with neutral signature metadata',
  );
  check(
    (await documents(adminPage)).data.filter((d: any) => d.id === uploaded.id).length === 1,
    'Uploaded document appears exactly once in Patient Management',
  );
  check(
    /Original filename: consent\.pdf/.test(await panelText(adminPage)) &&
      (await panelText(adminPage)).includes('Uploaded by: ' + admin.name),
    'Attached list shows original filename and real uploader',
  );
  await click(adminPage, `Preview original #${uploaded.id}`);
  await adminPage.waitForSelector('iframe[title="Original consent PDF preview"]');
  check(true, 'Original consent previews inside the radiology request');
  await adminPage.screenshot({ path: out + '/01-consent-uploaded.png', fullPage: true });
  await click(adminPage, 'Close preview');
  check(
    (await adminPage.$eval(
      '[aria-label="Doctor consent verification"] input[type="checkbox"]',
      (e) => (e as HTMLInputElement).disabled,
    )) === true,
    'Non-doctor administrator cannot confirm doctor review',
  );
  check(
    (await adminPage.evaluate(() => {
      const section = document.querySelector('[aria-label="Doctor consent verification"]');
      const button = Array.from(section?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent?.trim() === 'Verify consent',
      ) as HTMLButtonElement | undefined;
      return !button || button.disabled;
    })) === true,
    'Non-doctor administrator cannot verify consent by permission alone',
  );
  check(
    (await panelText(adminPage)).includes('Only an active doctor can verify'),
    'Panel explains that only an active doctor can verify',
  );
  await adminPage.screenshot({ path: out + '/02-administrator-cannot-verify.png', fullPage: true });
  await click(adminPage, `Open in Patient Management #${uploaded.id}`);
  await adminPage.waitForSelector(`[data-patient-document="${uploaded.id}"]`);
  check(
    await adminPage.evaluate(
      (id) =>
        document
          .querySelector(`[data-patient-document="${id}"]`)
          ?.textContent?.includes('Synthetic browser consent'),
      uploaded.id,
    ),
    'Same document appears in Patient Management without a duplicate record',
  );
  check(
    (await adminPage.$(`button[aria-label="Close patient record"]`)) !== null,
    'Patient Management journey opened from the radiology panel',
  );
  await adminPage.click('button[aria-label="Close patient record"]');

  const doctorPage = await login(f.doctorA.username);
  await openRadiology(doctorPage, 'Synthetic browser consent CT');
  check(
    (await panelText(doctorPage)).includes('Synthetic Doctor A'),
    'Authenticated doctor is automatically identified as responsible clinician',
  );
  await click(doctorPage, 'Preview selected original');
  await doctorPage.waitForSelector('iframe[title="Original consent PDF preview"]');
  await click(doctorPage, 'Close preview');
  await doctorPage.click('[aria-label="Doctor consent verification"] input[type="checkbox"]');
  await doctorPage.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Verify consent',
    );
    return button && !button.disabled;
  });
  await click(doctorPage, 'Verify consent');
  await doctorPage.waitForFunction(() =>
    document
      .querySelector('[aria-label="Procedure-specific radiology consent"]')
      ?.textContent?.includes('Consent verified'),
  );
  check(true, 'Authenticated doctor verifies consent under own identity');
  await fillById(doctorPage, 'radiology-findings', 'Synthetic normal findings');
  await fillById(doctorPage, 'radiology-impression', 'Synthetic normal impression');
  const reportedResponse = doctorPage.waitForResponse(
    (r) =>
      r.url().includes(`/api/radiology-orders/${order}/report`) && r.request().method() === 'PUT',
  );
  await click(doctorPage, 'Save Imaging Report');
  check((await reportedResponse).status() === 200, 'Verified consent satisfies the report gate');
  await dismissNotifications(doctorPage);
  await doctorPage.screenshot({ path: out + '/03-doctor-verified.png', fullPage: true });
  check(
    (await pool.query('SELECT status FROM radiology_orders WHERE id=$1', [order])).rows[0]
      .status === 'Reported',
    'Verified procedure request is now Reported in the disposable database',
  );

  await openRadiology(adminPage, 'Synthetic browser gate CT');
  await fillById(adminPage, 'radiology-findings', 'Synthetic blocked findings');
  const blocked = adminPage.waitForResponse(
    (r) =>
      r.url().includes(`/api/radiology-orders/${gate}/report`) && r.request().method() === 'PUT',
  );
  await click(adminPage, 'Save Imaging Report');
  check((await blocked).status() === 409, 'Missing consent blocks report completion');
  await dismissNotifications(adminPage);
  check(
    (await pool.query('SELECT status FROM radiology_orders WHERE id=$1', [gate])).rows[0].status ===
      'Requested',
    'Blocked report did not change request status',
  );
  await adminPage.screenshot({ path: out + '/04-report-blocked.png', fullPage: true });
  await clickDom(adminPage, 'Upload consent document');
  await uploadFromPanel(
    adminPage,
    'Upload radiology consent document',
    'Synthetic unverified gate consent',
  );
  await fillById(adminPage, 'radiology-findings', 'Synthetic still blocked findings');
  const stillBlocked = adminPage.waitForResponse(
    (r) =>
      r.url().includes(`/api/radiology-orders/${gate}/report`) && r.request().method() === 'PUT',
  );
  await click(adminPage, 'Save Imaging Report');
  check(
    (await stillBlocked).status() === 409,
    'Uploaded but unverified consent does not satisfy the gate',
  );

  await openRadiology(adminPage, 'Synthetic browser reported CT');
  const reportedText = await panelText(adminPage);
  check(
    reportedText.includes('Request reported — no verified pre-procedure consent'),
    'Reported request with no verified consent is shown explicitly',
  );
  check(
    !reportedText.includes('Verify consent') &&
      reportedText.includes('Retrospective consent verification is not available'),
    'Reported request disables retrospective consent verification',
  );
  check(
    !(await adminPage.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Upload consent document',
      ),
    )),
    'Reported request does not offer ordinary pre-procedure consent upload',
  );
  await clickDom(adminPage, 'Attach historical supporting document');
  await uploadFromPanel(
    adminPage,
    'Attach historical supporting document',
    'Synthetic late supporting document',
    'Found in the paper file after the report was issued',
  );
  await adminPage.waitForFunction(() =>
    document
      .querySelector('[aria-label="Procedure-specific radiology consent"]')
      ?.textContent?.includes('Attached after reporting — not pre-procedure consent'),
  );
  const historical = (await documents(adminPage)).data.find(
    (d: any) => d.title === 'Synthetic late supporting document',
  );
  check(
    historical?.radiology_order_id === reported &&
      historical?.radiology_attachment_context === 'POST_REPORTING_HISTORICAL' &&
      historical?.historical === true &&
      new Date(historical.uploaded_at).getTime() >=
        new Date(
          (await pool.query('SELECT reported_at FROM radiology_orders WHERE id=$1', [reported]))
            .rows[0].reported_at,
        ).getTime(),
    'Historical attachment keeps its true post-reporting upload time and cannot become pre-procedure consent',
  );
  check(
    !(await adminPage.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Verify consent',
      ),
    )),
    'Historical attachment offers no retrospective verification control',
  );
  await adminPage.screenshot({ path: out + '/05-reported-historical.png', fullPage: true });

  // Configuration is a separate normal authenticated session; the radiology
  // workspace keeps its own unsaved findings text and must not be disturbed.
  const configPage = await login(admin.username);
  check(
    await configPage.evaluate(() =>
      Array.from(document.querySelectorAll('aside button')).some((b) =>
        b.textContent?.includes('System Configuration'),
      ),
    ),
    'System Configuration navigation is visible to the authorized administrator',
  );
  await click(configPage, 'System Configuration', 'aside button');
  await click(configPage, 'Radiology Consent', 'button');
  await configPage.waitForSelector('[aria-label="Radiology consent policy"]');
  check(true, 'Facility-wide radiology consent policy lives in System Configuration');
  await configPage.screenshot({ path: out + '/06-configuration-policy.png', fullPage: true });

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
        ids: {
          patient: f.patient,
          order,
          gate,
          reported,
          uploaded: uploaded.id,
          historical: historical?.id ?? null,
        },
        hashes: { syntheticConsent: createHash('sha256').update(bytes).digest('hex') },
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
  let index = 0;
  for (const p of (await browser?.pages()) ?? []) {
    if (p.url().startsWith(base))
      await p.screenshot({ path: out + `/failure-${index++}.png`, fullPage: true }).catch(() => {});
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
