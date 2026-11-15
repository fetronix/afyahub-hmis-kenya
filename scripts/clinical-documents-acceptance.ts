/** Real SPA/Express/login/browser acceptance. Unique synthetic fixtures only; never migrate/reset. */
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import pg from 'pg';
import argon2 from 'argon2';
import sharp from 'sharp';
import puppeteer, { type Page, type ElementHandle } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from '@e965/xlsx';
import { REPORT_ENGINES } from '../src/reporting/report-centre.types.ts';
import { REPORT_CATEGORIES } from '../src/reporting/report-catalogue.ts';
import { FACILITY_MODULES } from '../src/config/facility-modules.ts';

if (
  process.env.CLINICAL_DOCUMENTS_SYNTHETIC !== 'YES' ||
  process.env.SQL_HOST !== '127.0.0.1' ||
  process.env.SQL_DB_NAME !== 'clinical_documents_synthetic_test' ||
  !/^\d{1,20}$/.test(process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER ?? '') ||
  !process.env.CLINICAL_TEST_PG_DATA_DIRECTORY ||
  !process.env.CHROME_EXECUTABLE_PATH
)
  throw Error(
    'Explicit loopback clinical_documents_synthetic_test and Chromium required. Never use production.',
  );
const root = process.cwd(),
  // Keep a new verification run separate from retained historical evidence.
  out =
    root +
    '/' +
    (
      process.env.CLINICAL_DOCUMENTS_EVIDENCE_DIR ?? 'docs/audits/clinical-documents-evidence'
    ).replace(/\/$/, '') +
    '/',
  suffix = randomUUID().slice(0, 8),
  base = 'http://127.0.0.1:4195';
const pool = new pg.Pool({
  host: process.env.SQL_HOST,
  port: Number(process.env.SQL_PORT),
  database: process.env.SQL_DB_NAME,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  ssl: false,
});
const password = randomBytes(32).toString('base64url'),
  checks: Array<{ operation: string; status: string }> = [],
  errors: string[] = [];
let server: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const check = (value: unknown, operation: string) => {
  if (!value) throw Error(operation);
  checks.push({ operation, status: 'PASS' });
  console.log('PASS', operation);
};
async function click(page: Page, text: string, selector = 'button') {
  await page.waitForFunction(
    (sel, txt) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(sel)).some(
        (e) => e.textContent?.trim() === txt && !e.disabled,
      ),
    {},
    selector,
    text,
  );
  const handle = await page.evaluateHandle(
    (sel, txt) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(sel)).find(
        (e) => e.textContent?.trim() === txt && !e.disabled,
      ),
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw Error('Button missing: ' + text);
  await (el as ElementHandle<Element>).click();
  await handle.dispose();
}
async function fill(page: Page, label: string, value: string) {
  const h = await page.evaluateHandle(
    (txt) =>
      Array.from(document.querySelectorAll('label'))
        .find(
          (e) =>
            Array.from(e.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent)
              .join('')
              .trim() === txt,
        )
        ?.querySelector('input,select,textarea'),
    label,
  );
  const el = h.asElement();
  if (!el) throw Error('Input missing: ' + label);
  await el.evaluate((node, v) => {
    const input = node as HTMLInputElement;
    const proto =
      input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await h.dispose();
}
const idle = async (page: Page) =>
  page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});
let token = '';
async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  otherToken = token,
  headers: Record<string, string> = {},
) {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${otherToken}`,
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ? new Uint8Array(body as Buffer) : body ? JSON.stringify(body) : undefined,
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  let data: any = null;
  try {
    data = JSON.parse(bytes.toString());
  } catch {}
  return { status: r.status, data, bytes, headers: r.headers };
}
try {
  const identity = (
    await pool.query(
      "SELECT current_database() AS name,inet_server_addr()::text AS address,system_identifier::text AS cluster,current_setting('data_directory') AS directory FROM pg_control_system()",
    )
  ).rows[0];
  check(
    identity.name === 'clinical_documents_synthetic_test' &&
      ['127.0.0.1', '127.0.0.1/32'].includes(identity.address) &&
      identity.cluster === process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER &&
      identity.directory === process.env.CLINICAL_TEST_PG_DATA_DIRECTORY,
    'Independently attested disposable cluster, database and data directory match before fixtures',
  );
  await mkdir(out, { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4195',
    SQL_SSL: 'false',
    LOG_LEVEL: 'silent',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: base,
    ADMIN_USERNAME: `clinical_platform_${suffix}`,
    ADMIN_EMAIL: `clinical_platform_${suffix}@example.test`,
    ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
    ADMIN_FULL_NAME: 'Disposable clinical platform admin',
  };
  const boot = spawnSync('node', ['build/scripts/bootstrap-admin.js'], {
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  check(boot.status === 0, 'Disposable secure bootstrap');
  const seed = spawnSync('node', ['build/scripts/seed-permissions.js'], {
    env,
    stdio: 'ignore',
    timeout: 30000,
  });
  check(seed.status === 0, 'Permission catalogue seeded only in disposable database');
  const tenant = (
    await pool.query(
      "INSERT INTO tenants(name,slug,currency) VALUES('Synthetic clinical presentation tenant',$1,'KES') RETURNING id",
      ['clinical-' + suffix],
    )
  ).rows[0].id;
  const modules = JSON.stringify(FACILITY_MODULES.map((m) => m.id));
  const facilities = (
    await pool.query(
      "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic clinical presentation facility',$4::jsonb),($1,$3,'Synthetic isolated second facility',$4::jsonb) RETURNING id",
      [tenant, 'CA-' + suffix, 'CB-' + suffix, modules],
    )
  ).rows;
  const facility = facilities[0].id,
    otherFacility = facilities[1].id;
  const hash = await argon2.hash(password);
  const accounts: Record<string, { id: number; name: string }> = {};
  for (const [roleName, fac, codes] of [
    ['admin', facility, null],
    ['restricted', facility, ['patients.read']],
    ['other', otherFacility, null],
  ] as const) {
    const name = `clinical_${roleName}_${suffix}`;
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id,account_status) VALUES($1,$1,$2,'Synthetic clinical acceptance staff',$3,$4,$5,'ACTIVE') RETURNING id",
        [name, name + '@example.test', hash, tenant, fac],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, roleName === 'admin' ? 'FACILITY_ADMIN' : `CLINICAL_${roleName}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    // Broad role is solely a synthetic test persona, never a default application grant.
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions' +
        (codes ? ' WHERE code=ANY($2::text[])' : ''),
      codes ? [role, codes] : [role],
    );
    accounts[roleName] = { id, name };
  }
  // A facility administrator is not implicitly a doctor. This synthetic persona holds both roles.
  const doctorRole = (
    await pool.query("INSERT INTO roles(tenant_id,name) VALUES($1,'DOCTOR') RETURNING id", [tenant])
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
    accounts.admin.id,
    doctorRole,
  ]);
  const patient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Consent Patient','2000-01-01','Other') RETURNING id",
      [tenant, facility, 'CL-' + suffix],
    )
  ).rows[0].id;
  const otherPatient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other Patient','2000-01-01','Other') RETURNING id",
      [tenant, facility, 'CL2-' + suffix],
    )
  ).rows[0].id;
  const orders = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'CT','Synthetic procedure-specific imaging'),($1,$2,$3,'X-Ray','Synthetic exception procedure') RETURNING id",
      [tenant, facility, patient],
    )
  ).rows;
  const order = orders[0].id,
    exceptionOrder = orders[1].id;
  for (let i = 0; i < 35; i++)
    await pool.query(
      "INSERT INTO inventory_items(facility_id,item_code,name,category,unit,current_stock,reorder_level,store_location) VALUES($1,$2,$3,'Synthetic supplies','Pieces',$4,NULL,'Synthetic Main Store')",
      [
        facility,
        `CL-${suffix}-${i}`,
        `Synthetic presentation item ${String(i).padStart(2, '0')}`,
        i + 1,
      ],
    );
  const portalLogins = [];
  for (const p of [patient, otherPatient]) {
    const email = `clinical_patient_${p}_${suffix}@example.test`;
    await pool.query(
      "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
      [tenant, facility, p, email, hash],
    );
    portalLogins.push(email);
  }
  server = spawn('node', ['build/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('App startup timeout')), 30000);
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
      reject(Error('App startup failed'));
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
  await page.setViewport({ width: 1440, height: 1050 });
  page.on('pageerror', (e) => errors.push(e instanceof Error ? e.name : 'Unknown page error'));
  page.on('dialog', (d) => void d.accept());
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="Username or Email"]', accounts.admin.name);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside');
  await idle(page);
  token = (await page.evaluate(() => localStorage.getItem('jalicare_session_token')))!;
  check(Boolean(token), 'Real staff username/password login');
  const login = async (name: string) => {
    const r = await api(
      '/api/auth/login',
      'POST',
      { identifier: accounts[name].name, password },
      '',
    );
    if (r.status !== 200) throw Error('Secondary login failed ' + JSON.stringify(r.data));
    return r.data.sessionToken ?? r.data.token;
  };
  // Capture actual unbranded Reporting Centre output before configuring a template.
  const r = await api('/api/reporting/centre/inventory-category/generate', 'POST', {
    facilityId: facility,
  });
  check(
    r.status === 200 && r.data.total === 35,
    'Reporting Centre retrieves all 35 synthetic inventory rows before branding',
  );
  const before = await api('/api/reporting/centre/inventory-category/export', 'POST', {
    facilityId: facility,
    format: 'pdf',
  });
  check(before.status === 200, 'Generate actual plain-fallback report before activation');
  await writeFile(out + 'report-before-activation.pdf', Buffer.from(before.data.base64, 'base64'));
  // Actual patient-record UI upload.
  await click(page, 'Patient Management', 'aside button');
  await page.waitForSelector('button[title="View Patient Record"]');
  const row = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('tr'))
      .find((r) => r.textContent?.includes('Consent Patient'))
      ?.querySelector('button[title="View Patient Record"]'),
  );
  await (row.asElement() as ElementHandle<Element>).click();
  await idle(page);
  await click(page, 'Consent & Signed Documents');
  await page.waitForSelector('form[aria-label="Upload signed document"]');
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('SYNTHETIC SIGNED CONSENT - NOT A REAL PATIENT RECORD');
  const original = Buffer.from(await pdf.save());
  const fixture = root + '/.tmp-tools/clinical-audit/consent.pdf';
  await writeFile(fixture, original);
  await fill(page, 'Document title', 'Synthetic general signed consent');
  await fill(
    page,
    'Document audit reason',
    'Record synthetic scanned consent without inferring signatures',
  );
  const fileInput = await page.$('input[aria-label="Signed document file"]');
  await fileInput!.uploadFile(fixture);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes(`/patient-documents/patients/${patient}`) && r.request().method() === 'POST',
  );
  await click(page, 'Upload document version');
  const uploaded = await response;
  check(uploaded.status() === 201, 'Actual patient UI uploads original PDF');
  const d = (await api(`/api/patient-documents/patients/${patient}`)).data.find(
    (entry: any) => entry.title === 'Synthetic general signed consent',
  );
  await idle(page);
  check(
    d.patient_signature === 'UNKNOWN' && d.doctor_signature === 'UNKNOWN',
    'Upload does not infer either signature',
  );
  await click(page, 'Preview Synthetic general signed consent');
  await page.waitForSelector('iframe[title="Signed document PDF preview"]');
  await page.screenshot({ path: out + '01-patient-consent-preview.png', fullPage: true });
  await click(page, 'Close preview');
  check(
    (await api(`/api/patient-documents/patients/${patient}/${d.id}/file`)).bytes.equals(original),
    'Authorized original preview/download bytes equal the signed upload',
  );
  await click(page, `Create correction of #${d.id}`);
  await fill(page, 'Document title', 'Synthetic corrected signed consent');
  await fill(page, 'Signing date', '2026-10-01');
  await fill(page, 'Patient signature status', 'PRESENT');
  await fill(page, 'Doctor signature status', 'ABSENT');
  await fill(
    page,
    'Document audit reason',
    'Correct synthetic consent title while preserving the signed original',
  );
  await (await page.$('input[aria-label="Signed document file"]'))!.uploadFile(fixture);
  const versionResponse = page.waitForResponse(
    (r) =>
      r.url().includes(`/patient-documents/patients/${patient}`) && r.request().method() === 'POST',
  );
  await click(page, 'Upload document version');
  check(
    (await versionResponse).status() === 201,
    'Actual patient UI creates a correction as a new version',
  );
  await idle(page);
  const versionHistory = (await api(`/api/patient-documents/patients/${patient}/${d.id}/history`))
    .data;
  check(
    versionHistory.versions.length === 2 && versionHistory.versions[1].version === 2,
    'Original and correction remain in the version history',
  );
  const releasedDocument = versionHistory.versions[1];
  check(
    releasedDocument.patient_signature === 'PRESENT' &&
      releasedDocument.doctor_signature === 'ABSENT' &&
      releasedDocument.signing_date.startsWith('2026-10-01'),
    'Independent signature assertions and signing date survive save and database reload',
  );
  await click(page, `Version & audit history #${d.id}`);
  await page.waitForSelector('[aria-label="Document version and audit history"]');
  await page.screenshot({ path: out + '02-patient-document-audit.png', fullPage: true });
  await click(page, 'Close history');
  await fill(
    page,
    'Document audit reason',
    'Explicitly release synthetic document to its own patient',
  );
  await click(page, `Release to patient portal #${releasedDocument.id}`);
  await idle(page);
  // Image preview is rendered directly by the browser (headless Chromium has no native PDF viewer).
  const imageFixture = root + '/.tmp-tools/clinical-audit/consent-image.png';
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="200"><rect width="700" height="200" fill="white"/><text x="20" y="55" font-size="20">SYNTHETIC CONSENT IMAGE — NOT A REAL PATIENT</text><text x="20" y="100" font-size="17">No signatures inferred. Disposable browser preview test.</text></svg>',
    ),
  )
    .png()
    .toFile(imageFixture);
  await fill(page, 'Document title', 'Synthetic scanned PNG consent');
  await fill(page, 'Document audit reason', 'Synthetic image preview acceptance only');
  await (await page.$('input[aria-label="Signed document file"]'))!.uploadFile(imageFixture);
  const imageResponse = page.waitForResponse(
    (r) =>
      r.url().includes(`/patient-documents/patients/${patient}`) && r.request().method() === 'POST',
  );
  await click(page, 'Upload document version');
  check((await imageResponse).status() === 201, 'Actual patient UI uploads validated PNG original');
  await idle(page);
  await click(page, 'Preview Synthetic scanned PNG consent');
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(
      'img[alt="Synthetic scanned PNG consent"]',
    );
    return img?.complete && img.naturalWidth === 700;
  });
  check(
    await page.$eval(
      'img[alt="Synthetic scanned PNG consent"]',
      (e) => (e as HTMLImageElement).naturalHeight === 200,
    ),
    'Authenticated original image preview is decoded by the real browser',
  );
  await page.$eval('img[alt="Synthetic scanned PNG consent"]', (e) =>
    e.scrollIntoView({ block: 'center' }),
  );
  await page.screenshot({ path: out + '01b-patient-image-preview.png', fullPage: true });
  await click(page, 'Close preview');
  const restricted = await login('restricted'),
    other = await login('other');
  check(
    (
      await api(
        `/api/patient-documents/patients/${patient}/${d.id}/file`,
        'GET',
        undefined,
        restricted,
      )
    ).status === 403,
    'Restricted staff denied original download',
  );
  check(
    (await api(`/api/patient-documents/patients/${patient}/${d.id}/file`, 'GET', undefined, other))
      .status === 404,
    'Cross-facility original download denied',
  );
  check(
    (await api(`/api/patient-documents/patients/${otherPatient}/${d.id}/file`)).status === 404,
    'Wrong patient/document association denied',
  );
  const invalidMeta = {
    filename: 'bad.exe',
    title: 'Synthetic invalid file',
    category: 'Consent',
    documentType: 'Synthetic',
    patientSignature: 'UNKNOWN',
    doctorSignature: 'UNKNOWN',
    reason: 'Synthetic invalid upload refusal test',
  };
  const uploadHeaders = {
    'Content-Type': 'application/pdf',
    'X-Document-Metadata': encodeURIComponent(JSON.stringify(invalidMeta)),
  };
  check(
    (
      await api(
        `/api/patient-documents/patients/${patient}`,
        'POST',
        original,
        token,
        uploadHeaders,
      )
    ).status === 400,
    'Actual upload endpoint rejects unsupported executable extension',
  );
  check(
    (
      await api(
        `/api/patient-documents/patients/${patient}`,
        'POST',
        original,
        restricted,
        uploadHeaders,
      )
    ).status === 403,
    'Actual upload endpoint denies staff without upload permission',
  );
  const large = await api(
    `/api/patient-documents/patients/${patient}`,
    'POST',
    Buffer.alloc(8 * 1024 * 1024 + 1),
    token,
    uploadHeaders,
  );
  check(large.status === 413, 'Actual raw-body upload rejects oversized content');
  // Patient portal: separate normal login and actual own-document UI.
  const portalPage = await browser.newPage();
  await portalPage.setViewport({ width: 1100, height: 900 });
  await portalPage.goto(base + '/portal', { waitUntil: 'networkidle2' });
  await writeFile(
    out + 'portal-login-fields.json',
    JSON.stringify(
      await portalPage.$$eval('input', (els) =>
        els.map((e) => ({ type: e.type, placeholder: e.placeholder, name: e.name })),
      ),
      null,
      2,
    ),
  );
  const portalInputs = await portalPage.$$('input');
  for (const input of portalInputs) {
    const type = await input.evaluate((e) => e.type);
    if (type === 'password') await input.type(password);
    else if (type !== 'checkbox' && type !== 'hidden') await input.type(portalLogins[0]);
  }
  const portalLoginResponse = portalPage.waitForResponse(
    (r) => r.url().endsWith('/api/portal/auth/login') && r.request().method() === 'POST',
  );
  await portalPage.click('button[type="submit"]');
  check(
    (await portalLoginResponse).status() === 200,
    'Real patient portal username/password login',
  );
  await portalPage.waitForFunction(() =>
    document.body.innerText.includes('My Documents & Signed Consents'),
  );
  await click(portalPage, 'My Documents & Signed Consents');
  await portalPage.waitForFunction(() =>
    document.body.innerText.includes('Synthetic corrected signed consent'),
  );
  check(
    await portalPage.$eval('[aria-label="My Documents & Signed Consents"]', (e) =>
      e.textContent?.includes('2026-10-01'),
    ),
    'Portal displays the released document signing date',
  );
  await click(portalPage, 'Preview Synthetic corrected signed consent');
  await portalPage.waitForSelector('iframe[title="Signed document PDF preview"]');
  await click(portalPage, 'Close preview');
  await portalPage.screenshot({
    path: out + '03-patient-portal-own-documents.png',
    fullPage: true,
  });
  const portalToken = (await portalPage.evaluate(() =>
    localStorage.getItem('jalicare_portal_token'),
  ))!;
  const portalList = await api('/api/portal/documents', 'GET', undefined, portalToken);
  check(
    portalList.status === 200 &&
      portalList.data.length === 1 &&
      !('notes' in portalList.data[0]) &&
      !('uploaded_by' in portalList.data[0]),
    'Portal lists only explicitly released own document without internal notes or staff audit',
  );
  check(
    (
      await api(`/api/portal/documents/${releasedDocument.id}/file`, 'GET', undefined, portalToken)
    ).bytes.equals(original),
    'Own released portal PDF preserves original uploaded bytes',
  );
  check(
    (await api(`/api/portal/documents/${d.id}/file`, 'GET', undefined, portalToken)).status === 404,
    'Unreleased original version is not accessible through the portal API',
  );
  const portalOtherLogin = await api(
    '/api/portal/auth/login',
    'POST',
    { identifier: portalLogins[1], password },
    '',
  );
  check(portalOtherLogin.status === 200, 'Second synthetic patient normal login');
  const otherPatientToken = portalOtherLogin.data.sessionToken ?? portalOtherLogin.data.token;
  check(
    (
      await api(
        `/api/portal/documents/${releasedDocument.id}/file`,
        'GET',
        undefined,
        otherPatientToken,
      )
    ).status === 404,
    'Real portal session for another patient cannot access released original',
  );
  // Procedure-specific consent is distinct from the general document.
  const reportBody = {
    facilityId: facility,
    findings: 'Synthetic findings only',
    impression: 'Synthetic impression only',
    reportedBy: 'Synthetic clinician',
  };
  check(
    (await api(`/api/radiology-orders/${order}/report?facilityId=${facility}`, 'PUT', reportBody))
      .status === 409,
    'Actual reporting/performance boundary blocks absent procedure consent',
  );
  check(
    (
      await api(`/api/patient-documents/radiology/${order}/consent`, 'POST', {
        status: 'VERIFIED',
        documentId: d.id,
        clinicianId: accounts.admin.id,
        reason: 'Attempt generic treatment consent for procedure test',
      })
    ).status === 400,
    'Generic signed document does not satisfy procedure consent',
  );
  await page.locator('button[aria-label="Close patient record"]').click(); // close patient journey modal
  await click(page, 'Radiology & Imaging', 'aside button');
  await idle(page);
  // The first selected request is the synthetic procedure request; explicitly select matching worklist item if needed.
  const orderButton = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((e) =>
      e.textContent?.includes('Synthetic procedure-specific imaging'),
    ),
  );
  if (orderButton.asElement()) await (orderButton.asElement() as ElementHandle<Element>).click();
  await page.waitForSelector('[aria-label="Procedure-specific radiology consent"]');
  await fill(page, 'Document title', 'Synthetic procedure signed consent');
  await fill(page, 'Signing date', '2026-10-01');
  await fill(page, 'Responsible doctor', String(accounts.admin.id));
  await fill(page, 'Patient signature status', 'PRESENT');
  await fill(page, 'Doctor signature status', 'PRESENT');
  await fill(
    page,
    'Document audit reason',
    'Upload synthetic patient and responsible doctor signed procedure consent',
  );
  await (await page.$('input[aria-label="Signed document file"]'))!.uploadFile(fixture);
  const specificResponse = page.waitForResponse(
    (r) =>
      r.url().includes(`/patient-documents/patients/${patient}`) && r.request().method() === 'POST',
  );
  await click(page, 'Upload document version');
  const specific = await specificResponse;
  check(specific.status() === 201, 'Actual radiology UI uploads procedure-linked consent');
  const sd = (await api(`/api/patient-documents/patients/${patient}`)).data.find(
    (entry: any) => entry.title === 'Synthetic procedure signed consent',
  );
  await idle(page);
  await fill(page, 'Radiology consent document ID', String(sd.id));
  await fill(page, 'Consent responsible clinician user ID', String(accounts.admin.id));
  await fill(
    page,
    'Consent decision / policy audit reason',
    'Independently inspect synthetic signatures for this exact procedure',
  );
  await click(page, 'Verify this procedure consent');
  await idle(page);
  check(
    (await api(`/api/patient-documents/radiology/${order}/consent`)).data.status === 'VERIFIED',
    'Actual UI verifies this procedure-specific consent',
  );
  await page.$eval('[aria-label="Procedure-specific radiology consent"]', (e) =>
    e.scrollIntoView({ block: 'start' }),
  );
  await page.screenshot({ path: out + '04-radiology-verified-consent.png', fullPage: true });
  check(
    (await api(`/api/radiology-orders/${order}/report?facilityId=${facility}`, 'PUT', reportBody))
      .status === 200,
    'Verified procedure can be reported through existing workflow',
  );
  check(
    (await api(`/api/patient-documents/patients/${patient}`)).data.some(
      (x: any) => x.id === sd.id && x.radiology_order_id === order,
    ),
    'Procedure consent remains in patient document history',
  );
  check(
    (
      await api(`/api/patient-documents/radiology/${exceptionOrder}/consent`, 'POST', {
        status: 'EXCEPTION',
        clinicianId: accounts.admin.id,
        reason: 'Synthetic authorized clinical exception before policy',
      })
    ).status === 403,
    'Exception denied when facility policy prohibits it',
  );
  check(
    (
      await api('/api/patient-documents/radiology-policy', 'POST', {
        required: true,
        allowException: true,
        reason: 'Synthetic facility authorizes documented clinician exceptions',
      })
    ).status === 200,
    'Explicit facility policy change recorded',
  );
  check(
    (
      await api(`/api/patient-documents/radiology/${exceptionOrder}/consent`, 'POST', {
        status: 'EXCEPTION',
        clinicianId: accounts.admin.id,
        reason: 'Synthetic urgent procedure with documented authorized exception',
      })
    ).status === 200,
    'Authorized clinician exception recorded under permitted policy',
  );
  check(
    (
      await api(
        `/api/radiology-orders/${exceptionOrder}/report?facilityId=${facility}`,
        'PUT',
        reportBody,
      )
    ).status === 200,
    'Documented policy-authorized exception permits completion',
  );
  const cancelled = (
    await pool.query(
      "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'CT','Synthetic cancelled request') RETURNING id",
      [tenant, facility, patient],
    )
  ).rows[0].id;
  await api(`/api/patient-documents/radiology/${cancelled}/consent`, 'POST', {
    status: 'EXCEPTION',
    clinicianId: accounts.admin.id,
    reason: 'Synthetic cancellation regression fixture before cancellation',
  });
  await pool.query("UPDATE radiology_orders SET status='Cancelled' WHERE id=$1", [cancelled]);
  check(
    (
      await api(`/api/patient-documents/radiology/${cancelled}/consent`, 'POST', {
        status: 'EXCEPTION',
        clinicianId: accounts.admin.id,
        reason: 'Attempt to authorize a cancelled synthetic procedure',
      })
    ).status === 409,
    'Cancelled request refuses a new consent authorization through actual API',
  );
  check(
    (
      await api(
        `/api/radiology-orders/${cancelled}/report?facilityId=${facility}`,
        'PUT',
        reportBody,
      )
    ).status === 409,
    'Cancelled request with previous consent cannot be reported through actual API',
  );
  // Existing single letterhead system: upload remains draft, then explicit activation.
  const letterhead = await PDFDocument.create();
  const lp = letterhead.addPage([595.28, 841.89]);
  lp.drawText('SYNTHETIC CLINICAL PRESENTATION FACILITY', { x: 35, y: 807, size: 13 });
  lp.drawText('Disposable template only - not official facility stationery', {
    x: 35,
    y: 790,
    size: 9,
  });
  const template = Buffer.from(await letterhead.save());
  const branding = `/api/facility-branding/facilities/${facility}/letterheads`;
  const created = await api(
    branding +
      '?filename=synthetic-template.pdf&bodyTopPt=80&bodyBottomPt=60&bodyLeftPt=36&bodyRightPt=36',
    'POST',
    template,
    token,
    { 'Content-Type': 'application/pdf', 'X-Filename': 'synthetic-template.pdf' },
  );
  check(created.status === 201, 'Existing letterhead upload API creates a draft version');
  const lh = created.data.letterhead;
  check(lh.status === 'DRAFT', 'Upload is not activation');
  const preview = await api(branding + `/${lh.id}/file`);
  check(
    preview.status === 200 && preview.bytes.equals(template),
    'Authorized letterhead preview retains original template',
  );
  check(
    (
      await api(branding + `/${lh.id}/activate`, 'POST', {
        reason: 'Activate synthetic presentation letterhead after preview',
      })
    ).status === 200,
    'Existing explicit letterhead activation succeeds',
  );
  await writeFile(out + 'letterhead-template.pdf', template);
  const historical = await api(`/api/documents/radiology-orders/${order}/pdf`);
  check(
    historical.status === 200 && historical.headers.get('x-letterhead-applied') === 'false',
    'Historical pre-activation radiology report does not acquire a later template',
  );
  const newRequest = await api('/api/radiology-orders', 'POST', {
    facilityId: facility,
    patientId: patient,
    modality: 'X-Ray',
    procedureName: 'Synthetic post-activation imaging',
    clinicalIndication: 'Synthetic presentation only',
  });
  check(newRequest.status === 201, 'Create post-activation imaging request through existing API');
  const newOrder = newRequest.data.id;
  check(
    (
      await api(`/api/patient-documents/radiology/${newOrder}/consent`, 'POST', {
        status: 'EXCEPTION',
        clinicianId: accounts.admin.id,
        reason: 'Synthetic authorized exception for multi-module rendering verification',
      })
    ).status === 200,
    'Record policy-authorized exception for new rendering fixture',
  );
  check(
    (
      await api(
        `/api/radiology-orders/${newOrder}/report?facilityId=${facility}`,
        'PUT',
        reportBody,
      )
    ).status === 200,
    'Complete post-activation imaging fixture',
  );
  const imaging = await api(`/api/documents/radiology-orders/${newOrder}/pdf`);
  check(
    imaging.status === 200 && imaging.headers.get('x-letterhead-applied') === 'true',
    'Radiology and Reporting Centre share the activated facility renderer',
  );
  await writeFile(out + 'radiology-after-activation.pdf', imaging.bytes);
  const labOrder = (
    await pool.query(
      "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,completed_at) VALUES($1,$2,$3,'Synthetic presentation verified assay','Completed',now()) RETURNING id",
      [tenant, facility, patient],
    )
  ).rows[0].id;
  const labResult = (
    await pool.query(
      "INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status,verified_at) VALUES($1,$2,'Synthetic analyte','5.1','Pending Verification',NULL) RETURNING id",
      [labOrder, patient],
    )
  ).rows[0].id;
  check(
    (await api(`/api/documents/laboratory-orders/${labOrder}/pdf`)).status === 409,
    'Actual official lab PDF endpoint rejects unverified persisted results',
  );
  await pool.query("UPDATE lab_results SET status='Verified',verified_at=now() WHERE id=$1", [
    labResult,
  ]);
  const labPdf = await api(`/api/documents/laboratory-orders/${labOrder}/pdf`);
  check(
    labPdf.status === 200 && labPdf.headers.get('x-letterhead-applied') === 'true',
    'Verified lab report uses the same explicitly activated facility letterhead',
  );
  await writeFile(out + 'laboratory-after-activation.pdf', labPdf.bytes);

  // Capture existing administrator UI and active version.
  await click(page, 'System Configuration', 'aside button');
  await idle(page);
  const buttons = await page.$$eval('button', (els) =>
    els.map((e) => e.textContent?.trim()).filter(Boolean),
  );
  await writeFile(out + 'configuration-actions.json', JSON.stringify(buttons, null, 2));
  const brandingButton = buttons.find((t) => /letterhead|branding/i.test(t ?? ''));
  if (brandingButton) await click(page, brandingButton);
  await idle(page);
  await page.screenshot({ path: out + '05-letterhead-active-version.png', fullPage: true });
  const reportResults = [];
  for (const [id, def] of Object.entries(REPORT_ENGINES)) {
    const filters = {
      facilityId: facility,
      ...(def.dateMode === 'asOf'
        ? { to: '2026-12-31' }
        : def.dateLabel
          ? { from: '2026-01-01', to: '2026-12-31' }
          : {}),
    };
    const generated = await api(`/api/reporting/centre/${id}/generate`, 'POST', filters);
    check(generated.status === 200, `Actual report query: ${id}`);
    const filtered = await api(`/api/reporting/centre/${id}/generate`, 'POST', {
      ...filters,
      search: 'no-such-synthetic-row',
    });
    check(
      filtered.status === 200 && filtered.data.total === 0,
      `Actual changed filter/empty query: ${id}`,
    );
    const outputs: Record<string, unknown> = {};
    for (const format of ['pdf', 'xlsx', 'csv']) {
      const exported = await api(`/api/reporting/centre/${id}/export`, 'POST', {
        ...filters,
        format,
      });
      check(exported.status === 200, `Actual ${format} export: ${id}`);
      const bytes = Buffer.from(exported.data.base64, 'base64');
      await writeFile(out + `${id}.${format}`, bytes);
      if (format === 'pdf')
        check((await PDFDocument.load(bytes)).getPageCount() > 0, `PDF parses: ${id}`);
      if (format === 'xlsx') {
        const book = XLSX.read(bytes, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
          header: 1,
        }) as unknown[][];
        check(
          rows.some((row) => row.includes(generated.data.title)),
          `XLSX contains saved report title: ${id}`,
        );
        outputs.xlsxRows = rows.length;
      }
      outputs[format + 'Bytes'] = bytes.length;
    }
    reportResults.push({
      id,
      records: generated.data.total,
      columns: generated.data.columns,
      rows: generated.data.rows,
      filters,
      ...outputs,
    });
  }
  const inventory = reportResults.find((r) => r.id === 'inventory-category')!;
  check(
    inventory.records === 35 && inventory.rows.length === 25,
    'Screen pagination does not truncate the full exported dataset',
  );
  const workbook = XLSX.read(await readFile(out + 'inventory-category.xlsx'), { type: 'buffer' });
  const exportedRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
  }) as unknown[][];
  check(
    exportedRows.some((row) => row.includes('Synthetic presentation item 34')),
    'XLSX includes the last row beyond the visible page',
  );
  await click(page, 'Reporting Centre', 'aside button');
  await idle(page);
  await page.screenshot({ path: out + '06-reporting-centre-catalogue.png', fullPage: true });
  const inventoryCategory = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((e) =>
      e.textContent?.includes('STOCK / GOODS'),
    ),
  );
  if (inventoryCategory.asElement())
    await (inventoryCategory.asElement() as ElementHandle<Element>).click();
  await idle(page);
  const inventoryButton = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((e) =>
      e.textContent?.includes('Inventory by category'),
    ),
  );
  await (inventoryButton.asElement() as ElementHandle<Element>).click();
  await click(page, 'Generate report');
  await idle(page);
  check(
    await page.$eval('table', (e) => e.textContent?.includes('Synthetic presentation item 00')),
    'Actual report workbench displays returned database rows',
  );
  await page.screenshot({ path: out + '07-reporting-centre-after.png', fullPage: true });
  await (await page.$('table'))!.screenshot({
    path: out + '07b-reporting-centre-returned-rows.png',
  });
  const downloadClient = await browser.target().createCDPSession();
  const nativeDirectory = root + '/.tmp-tools/presentation-native-downloads';
  await mkdir(nativeDirectory, { recursive: true });
  await downloadClient.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: nativeDirectory,
    eventsEnabled: true,
  });
  for (const [label, extension] of [
    ['PDF', 'pdf'],
    ['Excel', 'xlsx'],
  ] as const) {
    const complete = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        downloadClient.off('Browser.downloadProgress', handler);
        reject(Error('Native download timed out'));
      }, 30000);
      const handler = (e: { state: string; guid: string }) => {
        if (e.state === 'completed') {
          clearTimeout(timer);
          downloadClient.off('Browser.downloadProgress', handler);
          resolve(e.guid);
        }
      };
      downloadClient.on('Browser.downloadProgress', handler);
    });
    await click(page, label);
    const guid = await complete;
    const bytes = await readFile(nativeDirectory + '/' + guid);
    check(bytes.length > 100, 'Actual native browser ' + extension + ' download saved');
    await writeFile(out + 'native-inventory.' + extension, bytes);
  }
  await click(page, 'Next', '#report-centre-print button');
  await idle(page);
  check(
    await page.$eval('table', (e) => e.textContent?.includes('Synthetic presentation item 34')),
    'Inventory next page retains generated filters and displays final persisted row',
  );
  await downloadClient.detach();
  const printables = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((e) =>
      e.textContent?.includes('PRINTABLES'),
    ),
  );
  await (printables.asElement() as ElementHandle<Element>).click();
  const imagingEntry = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((e) =>
      e.textContent?.includes('Radiology reports'),
    ),
  );
  await (imagingEntry.asElement() as ElementHandle<Element>).click();
  await page.waitForSelector('[aria-label="Existing clinical report document"]');
  await fill(page, 'Request / admission reference', String(newOrder));
  // Headless Chromium can hand PDF blobs to its download manager instead of creating a tab.
  // Observe the real browser opener without replacing its behavior or the authenticated service.
  await page.evaluate(() => {
    const original = window.open.bind(window);
    (window as unknown as { clinicalOpenedUrl?: string }).clinicalOpenedUrl = '';
    window.open = (...args: Parameters<typeof window.open>) => {
      (window as unknown as { clinicalOpenedUrl?: string }).clinicalOpenedUrl = String(args[0]);
      return original(...args);
    };
  });
  const clinicalPdfResponse = page.waitForResponse((r) =>
    r.url().endsWith(`/api/documents/radiology-orders/${newOrder}/pdf`),
  );
  await click(page, 'Preview / Print PDF');
  const clinicalPdf = await clinicalPdfResponse;
  await page.waitForFunction(() =>
    (window as unknown as { clinicalOpenedUrl?: string }).clinicalOpenedUrl?.startsWith('blob:'),
  );
  check(
    clinicalPdf.status() === 200 &&
      clinicalPdf.headers()['content-type'].includes('application/pdf'),
    'Reporting Centre clinical entry retrieves authorized PDF and invokes browser PDF opener',
  );
  await page.screenshot({
    path: out + '08-reporting-centre-clinical-document.png',
    fullPage: true,
  });
  const entryScreens: Array<{
    id: string;
    screenOpened: boolean;
    disclosed: boolean;
    engine?: string;
    workflow?: string;
  }> = [];
  const searchInput = 'input[placeholder="Search reports or departments"]';
  for (const category of REPORT_CATEGORIES) {
    for (const entry of category.reports) {
      // Use the real search box to expand catalogue groups, then the actual catalogue button.
      const input = await page.$(searchInput);
      if (!input) throw Error('Catalogue search control not found');
      await input.evaluate((node, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }, entry.name);
      await page.waitForFunction(
        (name) =>
          Array.from(document.querySelectorAll('main[aria-label="Selected report"] h2')).some(
            (e) => e.textContent === name,
          ) ||
          Array.from(document.querySelectorAll('button span')).some((e) => e.textContent === name),
        {},
        entry.name,
      );
      const handle = await page.evaluateHandle(
        (name, categoryId) =>
          Array.from(
            document
              .querySelector(`[data-testid="report-category-${categoryId}"]`)!
              .querySelectorAll('button'),
          ).find((b) => Array.from(b.querySelectorAll('span')).some((s) => s.textContent === name)),
        entry.name,
        category.id,
      );
      if (!handle.asElement()) throw Error('Catalogue entry not found: ' + entry.id);
      await (handle.asElement() as ElementHandle<Element>).click();
      await handle.dispose();
      await page.waitForFunction(
        (name) =>
          document.querySelector('main[aria-label="Selected report"] h2')?.textContent === name,
        {},
        entry.name,
      );
      const body = await page.$eval(
        'main[aria-label="Selected report"]',
        (e) => e.textContent ?? '',
      );
      entryScreens.push({
        id: entry.id,
        screenOpened: true,
        disclosed: !!entry.engine || !!entry.workflow || /unavailable|not implemented/i.test(body),
        engine: entry.engine ?? undefined,
        workflow: entry.workflow ?? undefined,
      });
    }
  }
  check(
    entryScreens.length === 144 && entryScreens.every((e) => e.screenOpened && e.disclosed),
    'All 144 actual catalogue detail screens open and unavailable entries disclose their state',
  );
  await writeFile(
    out + 'catalogue-screen-results.json',
    JSON.stringify(entryScreens, null, 2) + '\n',
  );
  const events = (
    await pool.query(
      'SELECT action,document_id,reason,facts FROM patient_document_events WHERE facility_id=$1 ORDER BY id',
      [facility],
    )
  ).rows;
  check(
    events.some((e) => e.action === 'RADIOLOGY_EXCEPTION') &&
      events.some((e) => e.action === 'PORTAL_VIEW'),
    'Persisted document, exception and patient access audit evidence',
  );
  await writeFile(out + 'audit-events.json', JSON.stringify(events, null, 2) + '\n');
  await writeFile(out + 'report-results.json', JSON.stringify(reportResults, null, 2) + '\n');
  check(errors.length === 0, 'No uncaught errors during real browser workflows');
  await writeFile(
    out + 'results.json',
    JSON.stringify(
      {
        syntheticOnly: true,
        actualApplication: true,
        adapters: false,
        productionAccess: false,
        checks,
        errors,
        facility,
        patient,
        order,
        exceptionOrder,
        demoFixture: {
          tenant,
          facility,
          patient,
          otherPatient,
          doctorUserId: accounts.admin.id,
          mrn: 'CL-' + suffix,
          reportedRadiologyOrder: newOrder,
          verifiedLabOrder: labOrder,
          letterheadId: lh.id,
          releasedDocumentId: releasedDocument.id,
          unreleasedDocumentId: d.id,
        },
      },
      null,
      2,
    ) + '\n',
  );
  if (process.env.CLINICAL_DOCUMENTS_KEEP_DEMO_ACCESS === 'YES') {
    // Synthetic demo credentials only. Never write this private handover file to audit evidence/Git.
    await writeFile(
      root + '/.tmp-tools/presentation-demo-access.json',
      JSON.stringify(
        {
          syntheticOnly: true,
          base,
          staffUsername: accounts.admin.name,
          portalIdentifier: portalLogins[0],
          otherPortalIdentifier: portalLogins[1],
          password,
          facility,
          patient,
          clinicianId: accounts.admin.id,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
  }
  await rm(out + 'failure.json', { force: true });
} catch (e) {
  await mkdir(out, { recursive: true });
  if (browser) {
    for (const [index, page] of (await browser.pages()).entries()) {
      await page
        .screenshot({
          path: root + '/.tmp-tools/clinical-audit/failure-page-' + index + '.png',
          fullPage: true,
        })
        .catch(() => {});
    }
  }
  await writeFile(
    out + 'failure.json',
    JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown', checks, errors }, null, 2) +
      '\n',
  );
  throw e;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server!.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(timer);
  }
  await pool.end();
}
