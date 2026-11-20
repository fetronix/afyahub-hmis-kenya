/** Focused actual built-SPA/Express/PostgreSQL acceptance; no HTTP interception or production. */
import { randomBytes } from 'node:crypto';
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
  process.env.RESPONSIBLE_DOCTOR_EVIDENCE_DIR ?? 'docs/audits/responsible-doctor-evidence',
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
  if (tag === 'SELECT') await (el as ElementHandle<HTMLSelectElement>).select(value);
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
  pdf.addPage().drawText('SYNTHETIC CONSENT - RESPONSIBLE DOCTOR ACCEPTANCE');
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
            Authorization: `Bearer ${localStorage.getItem('syrona_session_token')}`,
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
  const a = await staffPage(f.doctorA);
  check(
    (await doctorValue(a)) === String(f.doctorA.id),
    'Doctor A opens form: own identity selected before upload',
  );
  check(
    await a.$eval(
      select,
      (e) => (e as HTMLSelectElement).disabled && e.textContent?.includes('Synthetic Doctor A'),
    ),
    'Doctor A sees name with override locked without patients.update',
  );
  check(
    await a.$eval(
      'form[aria-label="Upload signed document"]',
      (e) => !e.textContent?.includes('Responsible doctor user ID'),
    ),
    'Manual responsible doctor ID input removed',
  );
  await (await a.$('[aria-label="Consent & Signed Documents"]'))!.screenshot({
    path: out + '/01-doctor-a-default.png',
  });
  const original = await save(a, 'Synthetic Doctor A consent');
  check(original.doctor_id === f.doctorA.id, 'Doctor A upload persists authenticated own ID');
  check(
    (await doctorValue(a)) === String(f.doctorA.id),
    'Next upload restores Doctor A default without carrying signature assertions',
  );
  const b = await staffPage(f.doctorB);
  check(
    (await doctorValue(b)) === String(f.doctorB.id),
    'Doctor B opens form: Doctor B selected, not Doctor A',
  );
  await (await b.$('[aria-label="Consent & Signed Documents"]'))!.screenshot({
    path: out + '/02-doctor-b-default.png',
  });
  check(
    (await save(b, 'Synthetic Doctor B consent')).doctor_id === f.doctorB.id,
    'Doctor B saves own assignment',
  );
  const denied = await api(a, '', { doctorId: f.doctorB.id });
  check(
    denied.status === 403 && denied.data.error === 'DOCTOR_ASSIGNMENT_FORBIDDEN',
    'Tampered Doctor A request cannot assign Doctor B without delegation permission',
  );
  const staff = await staffPage(f.staff);
  check((await doctorValue(staff)) === '', 'Non-doctor records staff is not silently assigned');
  check(
    await staff.$eval(
      'form[aria-label="Upload signed document"] button[type="submit"]',
      (e) => (e as HTMLButtonElement).disabled,
    ),
    'Non-doctor cannot submit without selecting an eligible doctor',
  );
  const searched = staff.waitForResponse((r) => r.url().includes('/doctors?search=Doctor+B'));
  await fill(staff, 'Search doctors', 'Doctor B');
  check(
    (await searched).status() === 200,
    'Searchable selector queries authenticated facility users by name',
  );
  await staff.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll('form[aria-label="Upload signed document"] select option'),
      ).some((o) => o.textContent?.includes('Synthetic Doctor B')) &&
      !document
        .querySelector('form[aria-label="Upload signed document"]')
        ?.textContent?.includes('Loading responsible doctors'),
  );
  await fill(staff, 'Responsible doctor', String(f.doctorB.id));
  await (await staff.$('[aria-label="Consent & Signed Documents"]'))!.screenshot({
    path: out + '/03-records-search-selection.png',
  });
  await click(staff, `Create correction of #${original.id}`);
  const correction = await save(staff, 'Synthetic correction assigned B');
  check(
    correction.doctor_id === f.doctorB.id && correction.version === 2,
    'Authorized staff selects Doctor B for a new immutable correction version',
  );
  await click(staff, 'Refresh documents');
  await staff.waitForFunction(() =>
    Array.from(document.querySelectorAll('li')).some(
      (li) =>
        li.textContent?.includes('Synthetic correction assigned B') &&
        li.textContent.includes('Synthetic Doctor B'),
    ),
  );
  check(true, 'Saved correction displays Doctor B name after actual refresh');
  await click(staff, `Version & audit history #${original.id}`);
  await staff.waitForSelector('[aria-label="Document version and audit history"]');
  const history = await staff.$eval(
    '[aria-label="Document version and audit history"]',
    (e) => e.textContent ?? '',
  );
  check(
    history.includes('Synthetic Doctor A') && history.includes('Synthetic Doctor B'),
    'Version history keeps original Doctor A and correction Doctor B',
  );
  await (await staff.$('[aria-label="Consent & Signed Documents"]'))!.screenshot({
    path: out + '/04-refreshed-history.png',
  });
  await click(staff, 'Close history');
  for (const key of [
    'inactive',
    'suspended',
    'cross',
    'revoked',
    'deactivated',
    'locked',
    'staff',
  ] as const) {
    const result = await api(staff, '', { doctorId: f[key].id });
    check(
      result.status === 400 && result.data.error === 'INVALID_RESPONSIBLE_DOCTOR',
      `Actual API rejects ${key} as responsible doctor`,
    );
  }
  const options = await api(staff, '/doctors');
  check(
    options.data.doctors
      .map((d: { id: number }) => d.id)
      .sort()
      .join() === [f.doctorA.id, f.doctorB.id].sort().join(),
    'Server doctor options exclude inactive, non-doctor, revoked and other-facility users',
  );
  const unauthorized = await staffPage(f.unauthorized);
  check(
    (await doctorValue(unauthorized)) === '' &&
      (await unauthorized.$eval(select, (e) => (e as HTMLSelectElement).disabled)),
    'Unauthorized non-doctor has no override control or default',
  );
  check(
    (await api(unauthorized, '', { doctorId: f.doctorA.id })).status === 403,
    'Unauthorized staff direct override denied by server',
  );
  // Portal regression uses only a new disposable account and deliberate release of the correction.
  await fill(
    staff,
    'Document audit reason',
    'Deliberately release synthetic correction for portal regression',
  );
  const release = staff.waitForResponse(
    (r) => r.url().endsWith(`/${correction.id}/release`) && r.request().method() === 'POST',
  );
  await click(staff, `Release to patient portal #${correction.id}`);
  check(
    (await release).status() === 200,
    'Existing deliberate portal release works after assignment change',
  );
  const portalEmail = `doctor_portal_${f.patient}@example.test`;
  await pool.query(
    "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
    [f.tenant, f.facility, f.patient, portalEmail, await hashPassword(f.password)],
  );
  const portalContext = await browser.createBrowserContext(),
    portal = await portalContext.newPage();
  await portal.setViewport({ width: 1200, height: 900 });
  portal.on('pageerror', () => errors.push('Uncaught portal browser error'));
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
  check((await portalLogin).status() === 200, 'Separate patient portal normal password login');
  await click(portal, 'My Documents & Signed Consents');
  await portal.waitForFunction(() =>
    document.body.innerText.includes('Synthetic correction assigned B'),
  );
  const portalText = await portal.$eval(
    '[aria-label="My Documents & Signed Consents"]',
    (e) => e.textContent ?? '',
  );
  check(
    !portalText.includes('Synthetic Doctor A consent') &&
      !portalText.includes('Synthetic Doctor B consent') &&
      !portalText.includes('Responsible doctor') &&
      !portalText.includes('Search doctors'),
    'Portal still shows only deliberately released version, without staff assignment controls',
  );
  await (await portal.$('[aria-label="My Documents & Signed Consents"]'))!.screenshot({
    path: out + '/05-portal-release-regression.png',
  });
  const stored = await api(staff, `/${original.id}/history`);
  check(
    stored.data.versions[0].doctor_id === f.doctorA.id &&
      stored.data.versions[1].doctor_id === f.doctorB.id &&
      stored.data.versions[0].sha256 === stored.data.versions[1].sha256,
    'Database-backed history preserves doctor identity and immutable original byte hash',
  );
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
        fixture: {
          tenant: f.tenant,
          facility: f.facility,
          patient: f.patient,
          doctorA: f.doctorA.id,
          doctorB: f.doctorB.id,
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
