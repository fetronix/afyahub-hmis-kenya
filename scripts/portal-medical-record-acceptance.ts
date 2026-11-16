/**
 * Browser acceptance for the patient portal's medical-record PDF.
 *
 * Everything below is served by the built SPA, the built Express server and the
 * independently attested disposable synthetic PostgreSQL. A real Chromium logs
 * in as synthetic patients, presses the real "Download Medical Record (PDF)"
 * button, and the PDF the browser receives is parsed back and read. Nothing is
 * intercepted or mocked.
 *
 * Ten scenarios, the ones the request names: outpatient visits, an inpatient
 * admission, laboratory results, radiology reports, prescriptions, a patient
 * with no history, a patient treated at two facilities, released and unreleased
 * documents, a history long enough to force page breaks, and an attempt to open
 * somebody else's record.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PDFParser from 'pdf2json';

import type { AuthorizationContext } from '../src/auth/authorization.types.ts';
import { activateLetterhead, uploadLetterhead } from '../src/branding/letterhead.service.ts';
import { pool } from '../src/db/index.ts';
import { hashPassword } from '../src/utils/password.ts';
import { createResponsibleDoctorFixture } from '../src/tests/integration/support/responsible-doctor.fixture.ts';

if (process.env.RESPONSIBLE_DOCTOR_SYNTHETIC !== 'YES' || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic acceptance and a controlled Chromium are required');

const out = path.resolve(
  process.env.PORTAL_MEDICAL_RECORD_EVIDENCE_DIR ??
    'docs/audits/portal-medical-record-evidence',
);
const downloads = path.resolve('.tmp-tools/portal-medical-record-downloads');
const base = 'http://127.0.0.1:4204';
const A4_W = 595.28;
const A4_H = 841.89;

const checks: string[] = [];
const errors: string[] = [];
const failedRequests: string[] = [];
const screenshots: string[] = [];

function check(ok: unknown, label: string) {
  if (!ok) throw Error(label);
  checks.push(label);
  console.log('PASS', label);
}

function expectText(text: string, needle: string, label: string) {
  check(text.includes(needle), `${label} (found ${JSON.stringify(needle)})`);
}

function expectMissing(text: string, needle: string, label: string) {
  check(!text.includes(needle), `${label} (absent ${JSON.stringify(needle)})`);
}

async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParser(null, true);
  const text = await new Promise<string>((resolve, reject) => {
    parser.on('pdfParser_dataError', reject);
    parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
    parser.parseBuffer(bytes);
  });
  parser.destroy();
  return text.replace(/\s+/g, ' ').trim();
}

async function letterheadPdf(label: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([A4_W, A4_H]);
  page.drawRectangle({
    x: 0,
    y: A4_H - 100,
    width: A4_W,
    height: 100,
    color: rgb(0.05, 0.15, 0.35),
  });
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: 70, color: rgb(0.05, 0.15, 0.35) });
  page.drawText(label, { x: 40, y: A4_H - 60, size: 16, font, color: rgb(1, 1, 1) });
  page.drawText('Synthetic letterhead footer', {
    x: 40,
    y: 30,
    size: 9,
    font,
    color: rgb(1, 1, 1),
  });
  return Buffer.from(await pdf.save());
}

let browser: Browser | undefined;
let server: ReturnType<typeof spawn> | undefined;

/* ------------------------------------------------------------------ fixtures */

const suffix = randomUUID().slice(0, 8);
const password = 'Synthetic-record-browser-only!9';
const mflA = `9931${suffix}`;
const mflB = `9932${suffix}`;
const marker = (name: string) => `${name}_${suffix}`;

type Patient = { id: number; email: string; name: string; mrn: string };

async function newPatient(labels: {
  facility: number;
  /** Where the portal account lives; defaults to the registration facility. */
  accountFacility?: number;
  first: string;
  last: string;
  dob: string;
  mrnTag: string;
  portalTag: string;
}): Promise<Patient> {
  const mrn = marker(labels.mrnTag);
  const row = await pool.query(
    `INSERT INTO patients
      (tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,blood_group,county,sub_county,phone)
     VALUES($1,$2,$3,$4,$5,$6,'Female','O+','Nyeri','Nyeri Central','+254700000301') RETURNING id`,
    [tenant, labels.facility, mrn, labels.first, labels.last, labels.dob],
  );
  const id = row.rows[0].id as number;
  const email = `record-${labels.portalTag}-${suffix}@example.test`;
  await pool.query(
    `INSERT INTO patient_portal_accounts
      (tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at)
     VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())`,
    [tenant, labels.accountFacility ?? labels.facility, id, email, await hashPassword(password)],
  );
  return { id, email, name: `${labels.first} ${labels.last}`, mrn };
}

async function encounter(input: {
  facility: number;
  patient?: number;
  type: string;
  startedAt: string;
  endedAt?: string | null;
  complaint: string;
  notes: string;
}): Promise<number> {
  const row = await pool.query(
    `INSERT INTO encounters
      (tenant_id,facility_id,patient_id,encounter_type,status,started_at,ended_at,chief_complaint,clinical_notes)
     VALUES($1,$2,$3,$4,'COMPLETED',$5,$6,$7,$8) RETURNING id`,
    [
      tenant,
      input.facility,
      input.patient ?? main.id,
      input.type,
      input.startedAt,
      input.endedAt ?? null,
      input.complaint,
      input.notes,
    ],
  );
  return row.rows[0].id as number;
}

let tenant = 0;
let facilityA = 0;
let facilityB = 0;
/*
 * Assigned by `buildFixtures()` before any of them is read. The definite
 * assignment assertions describe that contract without inventing placeholder
 * patients that a mistake could silently use.
 */
let main!: Patient;
let emptyPatient!: Patient;
let otherPatient!: Patient;
let multiPatient!: Patient;
let letterheadLabel = '';
let longHistory = 0;

async function buildFixtures() {
  /* A disposable, deterministic cluster identity check; unrelated to the PDF. */
  const doctor = await createResponsibleDoctorFixture();
  check(true, 'Independently attested disposable synthetic PostgreSQL only');

  /*
   * The portal fixture reads the tenant/facility it created so that the record
   * also exercises an account created the way staff create one.
   */
  tenant = doctor.tenant;
  facilityA = doctor.facility;

  facilityB = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,county,sub_county,address,phone,email,enabled_modules)
       VALUES($1,$2,$3,'Level 3',$4,'Nyeri','Karatina','Karatina Main Street','+254700000302','records-b@example.test',
              '["registration","opd","inpatient"]') RETURNING id`,
      [tenant, `REC-B-${suffix}`, `Synthetic Karatina Health Centre ${suffix}`, mflB],
    )
  ).rows[0].id as number;

  await pool.query(
    `UPDATE facilities SET name=$3,mfl_code=$4,county='Nyeri',sub_county='Nyeri Central',
       address='Kenyatta Road',phone='+254700000301',email='records-a@example.test'
     WHERE id=$1 AND tenant_id=$2`,
    [facilityA, tenant, `Synthetic Nyeri Referral ${suffix}`, mflA],
  );
  const facilityARow = (
    await pool.query('SELECT name,code FROM facilities WHERE id=$1', [facilityA])
  ).rows[0] as { name: string; code: string };

  main = {
    id: doctor.patient,
    email: `record-main-${suffix}@example.test`,
    name: '',
    mrn: '',
  };
  const mainRow = (
    await pool.query(
      `UPDATE patients SET first_name='Wanjiku',middle_name='Nyambura',last_name='Kamau',
         date_of_birth='1990-03-14',gender='Female',blood_group='O+',county='Nyeri',
         sub_county='Nyeri Central',phone='+254712345678',mrn=$2
       WHERE id=$1 RETURNING first_name,middle_name,last_name,mrn`,
      [main.id, marker('MRN-MAIN')],
    )
  ).rows[0] as { first_name: string; middle_name: string; last_name: string; mrn: string };
  main.name = `${mainRow.first_name} ${mainRow.middle_name} ${mainRow.last_name}`;
  main.mrn = mainRow.mrn;
  await pool.query(
    `INSERT INTO patient_portal_accounts
      (tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at)
     VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())`,
    [tenant, facilityA, main.id, main.email, await hashPassword(password)],
  );

  emptyPatient = await newPatient({
    facility: facilityA,
    first: 'Amina',
    last: 'Hassan',
    dob: '1992-07-01',
    mrnTag: 'MRN-EMPTY',
    portalTag: 'empty',
  });
  await pool.query("UPDATE patients SET allergies='No known allergies' WHERE id=$1", [
    emptyPatient.id,
  ]);

  otherPatient = await newPatient({
    facility: facilityA,
    first: 'Peter',
    last: 'Otieno',
    dob: '1988-01-09',
    mrnTag: 'MRN-OTHER',
    portalTag: 'other',
  });

  /*
   * Registered at the health centre, portal account at the referral hospital -
   * the arrangement that makes the portal's scope a union of two facilities.
   */
  multiPatient = await newPatient({
    facility: facilityB,
    accountFacility: facilityA,
    first: 'Grace',
    last: 'Wairimu',
    dob: '1979-11-30',
    mrnTag: 'MRN-MULTI',
    portalTag: 'multi',
  });

  /* --- scenario 1: outpatient visit with a diagnosis and a note --- */
  const opd = await encounter({
    facility: facilityA,
    type: 'OUTPATIENT',
    startedAt: '2026-03-12T09:15:00',
    endedAt: '2026-03-12T10:00:00',
    complaint: 'Lower back pain for two weeks',
    notes: marker('OPD_NOTE'),
  });
  await pool.query(
    `INSERT INTO diagnoses(encounter_id,patient_id,icd10_code,icd10_description,coding_system,diagnosis_type,status)
     VALUES($1,$2,'M54.5','Low back pain','ICD-10','Primary','Confirmed')`,
    [opd, main.id],
  );

  /* --- scenario 2: an inpatient stay with an admission and a discharge --- */
  const inpatient = await encounter({
    facility: facilityA,
    type: 'INPATIENT',
    startedAt: '2026-05-01T08:00:00',
    endedAt: '2026-05-04T11:00:00',
    complaint: 'Fever and vomiting',
    notes: marker('INPATIENT_NOTE'),
  });
  await pool.query(
    `INSERT INTO diagnoses(encounter_id,patient_id,icd10_code,icd10_description,coding_system,diagnosis_type,status)
     VALUES($1,$2,'A09','Infectious gastroenteritis','ICD-10','Primary','Confirmed')`,
    [inpatient, main.id],
  );
  const ward = (
    await pool.query('INSERT INTO wards(facility_id,name,code) VALUES($1,$2,$3) RETURNING id', [
      facilityA,
      `Synthetic Ward ${suffix}`,
      `W-${suffix}`,
    ])
  ).rows[0].id as number;
  const bed = (
    await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'1') RETURNING id", [ward])
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO admissions
      (tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,admission_type,
       status,discharge_date,discharge_type,discharge_disposition,discharge_summary)
     VALUES($1,$2,$3,$4,$5,$6,'2026-05-01','Emergency','Discharged','2026-05-04','Normal','Recovered',$7)`,
    [tenant, facilityA, main.id, inpatient, ward, bed, marker('DISCHARGE_SUMMARY')],
  );

  /* --- scenario 9: a history long enough that one page cannot hold it --- */
  for (let index = 0; index < 34; index += 1) {
    const id = await encounter({
      facility: facilityA,
      type: 'OUTPATIENT',
      startedAt: `2025-${String((index % 12) + 1).padStart(2, '0')}-${String(
        (index % 27) + 1,
      ).padStart(2, '0')}T09:00:00`,
      complaint: `Synthetic review ${index + 1}`,
      notes: `Long history note ${index + 1} ${suffix}. `.repeat(3),
    });
    longHistory += 1;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,icd10_code,icd10_description,diagnosis_type,status)
       VALUES($1,$2,'Z00.0','General examination','Primary','Confirmed')`,
      [id, main.id],
    );
  }

  /* --- scenario 5: prescriptions, one dispensed, one cancelled --- */
  const dispensed = (
    await pool.query(
      `INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,route,status,prescribed_at)
       VALUES($1,$2,'Paracetamol','500 mg','Three times a day','5 days','Oral','Prescribed','2026-03-12T09:30:00') RETURNING id`,
      [opd, main.id],
    )
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO pharmacy_dispensations
      (tenant_id,facility_id,prescription_id,patient_id,quantity_dispensed,dispensed_by,dispensed_at)
     VALUES($1,$2,$3,$4,15,'Synthetic Pharmacist','2026-03-12T09:45:00')`,
    [tenant, facilityA, dispensed, main.id],
  );
  await pool.query(
    `INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,route,status,prescribed_at)
     VALUES($1,$2,'Amoxicillin','250 mg','Twice a day','7 days','Oral','Prescribed','2026-05-01T10:00:00'),
            ($1,$2,'Synthetic cancelled medicine','1 tablet','Once','1 day','Oral','Cancelled','2026-03-12T09:40:00')`,
    [inpatient, main.id],
  );

  /* --- scenario 3: a verified result, an unverified one and a cancelled order --- */
  const verified = (
    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
       VALUES($1,$2,$3,'Full haemogram','Completed','2026-03-12T09:20:00') RETURNING id`,
      [tenant, facilityA, main.id],
    )
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,unit,reference_range,flag,status,verified_at)
     VALUES($1,$2,'Haemoglobin','12.4','g/dL','12-16','Normal','Verified','2026-03-12T12:10:00')`,
    [verified, main.id],
  );
  await pool.query(
    `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status)
     VALUES($1,$2,$3,'13.9','Pending Verification')`,
    [verified, main.id, marker('PENDING_RESULT')],
  );
  const pendingOnly = (
    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
       VALUES($1,$2,$3,'Malaria slide','Ordered','2026-03-12T09:21:00') RETURNING id`,
      [tenant, facilityA, main.id],
    )
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status)
     VALUES($1,$2,'Parasites','Not seen','Pending Verification')`,
    [pendingOnly, main.id],
  );
  await pool.query(
    `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
     VALUES($1,$2,$3,'Urinalysis','Cancelled','2026-03-12T09:22:00'),
            ($1,$2,$3,'Sputum AFB','Ordered','2026-03-12T09:23:00')`,
    [tenant, facilityA, main.id],
  );

  /* --- scenario 4: a reported radiograph and a request with no report --- */
  const consentOperator = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic Consent Operator',$3,'ACTIVE',$4,$5) RETURNING id`,
      [
        `record-consent-${suffix}`,
        `record-consent-${suffix}@example.test`,
        randomBytes(24).toString('hex'),
        tenant,
        facilityA,
      ],
    )
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO radiology_consent_policies(tenant_id,facility_id,required,updated_by)
     VALUES($1,$2,false,$3)
     ON CONFLICT(facility_id) DO UPDATE SET required=false,updated_by=excluded.updated_by`,
    [tenant, facilityA, consentOperator],
  );
  await pool.query(
    `INSERT INTO radiology_orders
      (tenant_id,facility_id,patient_id,modality,procedure_name,status,radiologist_findings,impression,reported_at)
     VALUES($1,$2,$3,'X-ray','Chest X-ray PA view','Reported','Clear lung fields. No pleural effusion.',
            'Normal chest radiograph.','2026-05-02T12:00:00')`,
    [tenant, facilityA, main.id],
  );
  await pool.query(
    `INSERT INTO radiology_orders
      (tenant_id,facility_id,patient_id,modality,procedure_name,status,radiologist_findings,impression)
     VALUES($1,$2,$3,'Ultrasound','Abdominal ultrasound','Requested',$4,$4)`,
    [tenant, facilityA, main.id, marker('MUST_NOT_APPEAR_UNREPORTED_RADIOLOGY')],
  );

  /* --- appointments, both directions --- */
  await pool.query(
    `INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,appointment_type,status,reason)
     VALUES($1,$2,$3,'2027-01-15T09:30:00','Routine Follow-up','Scheduled','Synthetic upcoming appointment'),
            ($1,$2,$3,'2026-02-01T09:30:00','Routine Follow-up','Completed','Synthetic past appointment')`,
    [tenant, facilityA, main.id],
  );

  /* --- scenario 8: one document released, one not released --- */
  const uploader = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic Document Uploader',$3,'ACTIVE',$4,$5) RETURNING id`,
      [
        `record-uploader-${suffix}`,
        `record-uploader-${suffix}@example.test`,
        randomBytes(24).toString('hex'),
        tenant,
        facilityA,
      ],
    )
  ).rows[0].id as number;
  const docPage = await PDFDocument.create();
  docPage.addPage([A4_W, A4_H]).drawText('Synthetic released document', { x: 40, y: 760, size: 12 });
  const docBytes = Buffer.from(await docPage.save());
  const released = (
    await pool.query(
      `INSERT INTO patient_signed_documents
        (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason)
       VALUES($1,$2,$3,1,$4,'Consent','Treatment consent','UNKNOWN','UNKNOWN','released.pdf','application/pdf',$5,$6,$7,'Synthetic record fixture')
       RETURNING id`,
      [tenant, facilityA, main.id, marker('RELEASED_DOC'), 'a'.repeat(64), docBytes, uploader],
    )
  ).rows[0].id as number;
  await pool.query(
    `INSERT INTO patient_document_releases(document_id,released,actor_id,reason,released_at)
     VALUES($1,true,$2,'Synthetic release for the medical record',now())`,
    [released, uploader],
  );
  const unreleased = (
    await pool.query(
      `INSERT INTO patient_signed_documents
        (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason)
       VALUES($1,$2,$3,1,$4,'Document','Patient document','UNKNOWN','UNKNOWN','unreleased.pdf','application/pdf',$5,$6,$7,'Internal working paper')
       RETURNING id`,
      [
        tenant,
        facilityA,
        main.id,
        marker('MUST_NOT_APPEAR_UNRELEASED_DOC'),
        'b'.repeat(64),
        docBytes,
        uploader,
      ],
    )
  ).rows[0].id as number;

  /* --- scenario 7: the same patient treated at two facilities --- */
  await encounter({
    facility: facilityA,
    patient: multiPatient.id,
    type: 'OUTPATIENT',
    startedAt: '2026-01-09T08:30:00',
    complaint: 'MARKER_VISIT_AT_NYERI',
    notes: 'Synthetic multi-facility visit at the referral hospital.',
  });
  await encounter({
    facility: facilityB,
    patient: multiPatient.id,
    type: 'OUTPATIENT',
    startedAt: '2026-02-20T08:30:00',
    complaint: 'MARKER_VISIT_AT_KARATINA',
    notes: 'Synthetic multi-facility visit at the health centre.',
  });

  /* --- the facility's own letterhead, uploaded through the real service --- */
  const actor = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic Branding Officer',$3,'ACTIVE',$4,$5) RETURNING id`,
      [
        `record-brand-${suffix}`,
        `record-brand-${suffix}@example.test`,
        randomBytes(24).toString('hex'),
        tenant,
        facilityA,
      ],
    )
  ).rows[0].id as number;
  const context: AuthorizationContext = {
    userId: actor,
    tenantId: tenant,
    facilityId: facilityA,
    roles: [],
    permissions: ['facility.branding.read', 'facility.branding.manage'],
    isSuperAdmin: false,
  };
  letterheadLabel = `SYNTHETIC LETTERHEAD ${suffix}`;
  const uploaded = await uploadLetterhead(context, {
    facilityId: facilityA,
    filename: 'record-letterhead.pdf',
    mimeType: 'application/pdf',
    bytes: await letterheadPdf(letterheadLabel),
    body: { bodyTopPt: 110, bodyBottomPt: 80 },
  });
  await activateLetterhead(context, uploaded.letterhead.id, 'Synthetic record acceptance');

  return { facilityARow, releasedId: released, unreleasedId: unreleased };
}

/* -------------------------------------------------------------------- browser */

async function portalLogin(email: string): Promise<Page> {
  const context = await browser!.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1100 });

  /*
   * A download from a fresh browser context needs its own permission: the
   * browser-wide setting does not reach an isolated profile.
   */
  const session = await page.createCDPSession();
  await session.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
  });
  page.on('pageerror', () => errors.push('Uncaught browser error'));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('API error'))
      errors.push('Console API error');
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 500 && url.startsWith(base))
      failedRequests.push(new URL(url).pathname + ':' + response.status());
  });
  await page.goto(base + '/portal', { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[autocomplete="username"]');
  await page.type('input[autocomplete="username"]', email);
  await page.type('input[autocomplete="current-password"]', password);
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/portal/auth/login') && response.request().method() === 'POST',
  );
  await page.click('button[type="submit"]');
  check((await pending).status() === 200, 'Synthetic patient signs in through the real portal form');
  /* The record panel lives on the Account tab. */
  await openAccount(page);
  return page;
}

async function openAccountTab(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === 'Account',
    ),
  );
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Account',
    );
    (tab as HTMLButtonElement).click();
  });
}

async function openAccount(page: Page) {
  await openAccountTab(page);
  await page.waitForSelector('[aria-label="My Medical Record"]');
  await page.waitForFunction(
    () => !document.body.textContent?.includes('Preparing your record'),
  );
}

type Download = {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
  text: string;
  pages: number;
  fileOnDisk: boolean;
};

/**
 * Press the real button and keep the document the browser was given.
 *
 * The app fetches the PDF, wraps it in a Blob and clicks a download link. A
 * devtools response body cannot be read back once the page has consumed it, so
 * the Blob handed to the download link is captured instead. That is the same
 * object the browser saves: nothing here intercepts or substitutes the request,
 * and the saved file is checked on disk as well.
 */
async function pressDownload(page: Page): Promise<Download> {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/portal/records/download') &&
      response.request().method() === 'GET',
    { timeout: 60_000 },
  );
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === 'Download Medical Record (PDF)' && !button.disabled,
    ),
  );
  const before = new Set(await readdir(downloads).catch(() => [] as string[]));
  await page.evaluate(() => {
    /* Observe the object URL the page creates; never replace its contents. */
    const scope = window as unknown as { __recordBlobs?: Blob[] };
    scope.__recordBlobs = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) scope.__recordBlobs!.push(object);
      return original(object);
    };

    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Download Medical Record (PDF)',
    );
    if (!button) throw Error('Download button missing');
    (button as HTMLButtonElement).click();
  });
  const response = await pending;
  const headers = response.headers();

  /* The notice is rendered only after the blob exists and the click happened. */
  await page.waitForFunction(
    () =>
      document.body.textContent?.includes('downloaded to this device') ||
      document.body.textContent?.includes('could not be generated'),
    { timeout: 30_000 },
  );

  const captured = await page.evaluate(async () => {
    const scope = window as unknown as { __recordBlobs?: Blob[] };
    const blob = scope.__recordBlobs?.at(-1);
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192)
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return { base64: btoa(binary), size: blob.size, type: blob.type };
  });
  const bytes = captured?.base64
    ? Buffer.from(captured.base64, 'base64')
    : Buffer.from(await response.buffer().catch(() => Buffer.alloc(0)));

  let fileOnDisk = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await readdir(downloads).catch(() => [] as string[]);
    const fresh = now.filter((entry) => !before.has(entry) && !entry.endsWith('.crdownload'));
    if (fresh.length > 0) {
      const saved = await readFile(path.join(downloads, fresh[0]!));
      fileOnDisk = saved.subarray(0, 5).toString() === '%PDF-';
      if (fileOnDisk) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const text = response.status() === 200 ? await pdfText(bytes) : '';
  const pages =
    response.status() === 200 ? (await PDFDocument.load(bytes)).getPageCount() : 0;

  return { status: response.status(), headers, bytes, text, pages, fileOnDisk };
}

async function shot(page: Page, name: string) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(name);
}

async function portalApi(page: Page, pathname: string) {
  return page.evaluate(async (target) => {
    const response = await fetch('/api/portal' + target, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_portal_token') },
    });
    const type = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      type,
      disposition: response.headers.get('content-disposition'),
      body: type.includes('json') ? await response.json() : null,
      bytes: type.includes('json') ? 0 : (await response.arrayBuffer()).byteLength,
    };
  }, pathname);
}

/** The same endpoint, but the bytes are kept so the document can be read. */
async function apiPdf(page: Page, pathname: string) {
  const result = await page.evaluate(async (target) => {
    const response = await fetch('/api/portal' + target, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('jalicare_portal_token') },
    });
    const type = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      type,
      disposition: response.headers.get('content-disposition') ?? '',
      bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  }, pathname);
  const buffer = Buffer.from(result.bytes);
  const isPdf = result.type.includes('application/pdf');
  return { ...result, buffer, isPdf, text: isPdf ? await pdfText(buffer) : '' };
}

/* ---------------------------------------------------------------------- main */

try {
  await mkdir(out, { recursive: true });
  await mkdir(downloads, { recursive: true });
  const fixture = await buildFixtures();

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4204',
    SQL_SSL: 'false',
    LOG_LEVEL: 'silent',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: base,
  };
  server = spawn('node', ['build/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Built app startup timeout')), 40_000);
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
  check(true, 'The built server (build/server.js) is serving the built SPA');

  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
    eventsEnabled: true,
  });

  const patientPage = await portalLogin(main.email);
  await openAccount(patientPage);

  /* The section itself, before any file is generated. */
  const sectionText =
    (await patientPage.$eval('[aria-label="My Medical Record"]', (element) => element.textContent)) ??
    '';
  check(
    sectionText.includes('Download Medical Record (PDF)') &&
      !sectionText.toLowerCase().includes('text copy'),
    'Account tab offers the PDF download, not a text export',
  );
  check(
    (await patientPage.$eval('[aria-label="My Medical Record"] button', (button) =>
      button.getAttribute('aria-busy'),
    )) === 'false',
    'The download control is not stuck in a busy state',
  );
  check(
    sectionText.includes('No copy has been generated from this account yet.'),
    'A first-time account is told no copy exists yet',
  );
  await shot(patientPage, '01-portal-medical-record-section.png');

  /* ---------------- the download itself ---------------- */
  const pdf = await pressDownload(patientPage);
  check(pdf.status === 200, 'The download responds 200');
  check(pdf.bytes.subarray(0, 5).toString() === '%PDF-', 'The response is a real PDF');
  check(pdf.headers['content-type'] === 'application/pdf', 'The response is typed application/pdf');
  check(
    (pdf.headers['content-disposition'] ?? '').startsWith('attachment;') &&
      (pdf.headers['content-disposition'] ?? '').includes(main.mrn),
    'The response is an attachment named after this patient',
  );
  check(
    (pdf.headers['cache-control'] ?? '').includes('no-store'),
    'The document is never cacheable or shareable by URL',
  );
  check(pdf.fileOnDisk, 'Chromium saved the generated file to disk');
  check(pdf.pages > 1, `The record paginates (${pdf.pages} pages)`);
  check(
    (await patientPage.evaluate(() => document.body.textContent ?? '')).includes(
      'Your medical record PDF was downloaded to this device.',
    ),
    'Success is reported only after the file exists',
  );

  /* The letterhead, from the facility's own uploaded artwork. */
  expectText(pdf.text, fixture.facilityARow.name, 'The facility name heads the document');
  expectText(pdf.text, letterheadLabel, 'The facility letterhead is applied');
  expectText(pdf.text, 'Kenyatta Road', 'The facility address is printed');
  expectText(pdf.text, '+254700000301', 'The facility phone is printed');
  expectText(pdf.text, `MFL ${mflA}`, 'The facility MFL code is printed');
  expectText(pdf.text, `Facility code ${fixture.facilityARow.code}`, 'The facility code is printed');
  expectText(pdf.text, 'PATIENT MEDICAL RECORD', 'The document is titled');
  expectText(pdf.text, main.name, 'The patient name is printed');
  expectText(pdf.text, main.mrn, 'The patient number is printed');
  expectText(pdf.text, '14 March 1990', 'The date of birth is printed in local form');
  expectText(pdf.text, 'O+', 'The blood group is printed');
  expectText(pdf.text, '+254712345678', 'The patient phone is printed');
  expectMissing(pdf.text, 'patient_id', 'No database column names reach the patient');
  expectMissing(pdf.text, 'sha256', 'No internal document hashes reach the patient');
  expectMissing(pdf.text, '"labOrders"', 'No JSON payload reaches the patient');

  /* Page furniture on every page. */
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.pages, 3); pageNumber += 1)
    expectText(pdf.text, `Page ${pageNumber} of ${pdf.pages}`, 'Every page is numbered');
  expectText(pdf.text, 'Page 1 of', 'The footer carries the page count');

  /* ---------------- scenario 1: outpatient ---------------- */
  expectText(pdf.text, '12 March 2026 at 09:15', 'The outpatient visit keeps its recorded time');
  expectText(pdf.text, 'Outpatient (OPD)', 'The outpatient visit is labelled');
  expectText(pdf.text, marker('OPD_NOTE'), 'The outpatient clinical note is printed');
  expectText(pdf.text, 'ICD-10 M54.5', 'The coded diagnosis is printed');
  expectText(pdf.text, 'Low back pain', 'The diagnosis description is printed');

  /* ---------------- scenario 2: inpatient ---------------- */
  expectText(pdf.text, 'Inpatient', 'The inpatient stay is labelled');
  expectText(pdf.text, marker('INPATIENT_NOTE'), 'The inpatient note is printed');
  expectText(pdf.text, 'Admitted 1 May 2026', 'The admission date is printed');
  expectText(pdf.text, 'Discharged 4 May 2026', 'The discharge date is printed');
  expectText(pdf.text, 'Recovered', 'The discharge outcome is printed');
  expectText(pdf.text, marker('DISCHARGE_SUMMARY'), 'The discharge summary is printed');

  /* ---------------- scenario 5: prescriptions ---------------- */
  expectText(pdf.text, 'Paracetamol', 'A prescribed medicine is listed');
  expectText(pdf.text, '500 mg', 'The dose is printed');
  expectText(pdf.text, 'Three times a day', 'The frequency is printed');
  expectText(pdf.text, 'Dispensed 12 March 2026', 'Dispensing that happened is printed');
  expectText(pdf.text, 'Amoxicillin', 'The inpatient medicine is listed');
  expectText(pdf.text, 'Synthetic cancelled medicine', 'A cancelled medicine is still listed');
  expectText(pdf.text, 'Cancelled', 'The cancelled status is labelled');

  /* ---------------- scenario 3: laboratory ---------------- */
  expectText(pdf.text, 'Full haemogram', 'The laboratory order is listed');
  expectText(pdf.text, 'Haemoglobin', 'The result parameter is printed');
  expectText(pdf.text, '12.4', 'The verified value is printed');
  expectText(pdf.text, 'Verified', 'The verified status is labelled');
  expectText(pdf.text, 'pending verification', 'The unverified result is labelled as pending');
  expectMissing(pdf.text, marker('PENDING_RESULT'), 'An unverified value is never printed');
  expectText(pdf.text, 'Malaria slide', 'An order whose only result is unverified is listed');
  expectText(pdf.text, 'Result pending verification', 'A pending order says so in words');
  expectText(pdf.text, 'Sputum AFB', 'An order with nothing recorded is listed');
  expectText(
    pdf.text,
    'No result has been recorded for this test yet',
    'An order with no result is never presented as a normal result',
  );
  expectText(pdf.text, 'Order cancelled. No result was issued', 'A cancelled order is not mistaken for a result');

  /* ---------------- scenario 4: radiology ---------------- */
  expectText(pdf.text, 'Chest X-ray PA view', 'The imaging procedure is printed');
  expectText(pdf.text, 'Clear lung fields', 'The reported findings are printed');
  expectText(pdf.text, 'Normal chest radiograph', 'The impression is printed');
  expectText(pdf.text, 'Abdominal ultrasound', 'An unreported request is still listed');
  expectText(pdf.text, 'No report has been issued yet', 'A request without a report says so');
  expectMissing(
    pdf.text,
    marker('MUST_NOT_APPEAR_UNREPORTED_RADIOLOGY'),
    'No findings are invented for an unreported request',
  );
  expectMissing(pdf.text, 'DICOM', 'The document never implies imaging files are attached');

  /* ---------------- appointments ---------------- */
  expectText(pdf.text, '15 January 2027', 'An upcoming appointment is listed');
  expectText(pdf.text, 'Upcoming', 'The upcoming appointment is labelled');
  expectText(pdf.text, '1 February 2026', 'A past appointment is listed');
  expectText(pdf.text, 'Past', 'The past appointment is labelled');

  /* ---------------- scenario 8: documents ---------------- */
  expectText(pdf.text, marker('RELEASED_DOC'), 'A released document is listed');
  expectMissing(
    pdf.text,
    marker('MUST_NOT_APPEAR_UNRELEASED_DOC'),
    'An unreleased document is never listed',
  );
  check(
    (await portalApi(patientPage, `/documents/${fixture.unreleasedId}/file?download=1`)).status ===
      404,
    'The unreleased document cannot be fetched by its id either',
  );

  /* ---------------- scenario 9: long history, page breaks ---------------- */
  check(
    pdf.pages >= 4,
    `A ${longHistory}-visit history produces ${pdf.pages} pages rather than clipping`,
  );
  const perPage = pdf.text.split(/Page \d+ of \d+/).filter((part) => part.trim().length > 0);
  check(
    perPage.length >= pdf.pages,
    'The text is spread over every page, not truncated at the first',
  );
  expectText(pdf.text, `Synthetic review ${longHistory}`, 'The last long-history visit is present');
  expectText(pdf.text, 'Synthetic review 1', 'The first long-history visit is present');

  /* The last generated date appears once the record exists. */
  await openAccount(patientPage);
  const afterDownload =
    (await patientPage.$eval('[aria-label="My Medical Record"]', (element) => element.textContent)) ??
    '';
  check(
    /Last generated \d{1,2} \w+ \d{4}/.test(afterDownload),
    'The account now shows when the copy was last generated',
  );
  await shot(patientPage, '02-portal-after-download.png');

  /* ---------------- scenario 6: a patient with no history ---------------- */
  const emptyPage = await portalLogin(emptyPatient.email);
  await openAccount(emptyPage);
  const empty = await pressDownload(emptyPage);
  check(empty.status === 200, 'A patient with no history still receives a PDF');
  check(empty.bytes.subarray(0, 5).toString() === '%PDF-', 'The empty record is a real PDF');
  expectText(empty.text, emptyPatient.name, 'The empty record still identifies the patient');
  expectText(empty.text, 'PATIENT MEDICAL RECORD', 'The empty record is still titled');
  expectText(empty.text, 'No known allergies', 'A recorded absence of allergies is stated as such');
  expectText(
    empty.text,
    'No encounters have been recorded at the facilities covered by this copy.',
    'An empty record explains what is missing instead of looking broken',
  );
  expectMissing(empty.text, 'Full haemogram', 'An empty record invents no results');
  expectMissing(empty.text, 'Paracetamol', 'An empty record invents no prescriptions');
  check(empty.pages >= 1, 'The empty record is a complete single document');
  await shot(emptyPage, '03-portal-empty-record.png');

  /* ---------------- scenario 7: two facilities ---------------- */
  const multiPage = await portalLogin(multiPatient.email);
  await openAccount(multiPage);
  const multi = await pressDownload(multiPage);
  check(multi.status === 200, 'A multi-facility patient downloads their record');
  expectText(multi.text, multiPatient.name, 'The multi-facility patient is identified');
  expectText(multi.text, 'This copy covers records held at', 'The copy lists the facilities it covers');
  expectText(multi.text, fixture.facilityARow.name, 'The referring facility is named');
  expectText(multi.text, `Synthetic Karatina Health Centre ${suffix}`, 'The second facility is named');
  const nyeriAt = multi.text.indexOf('9 January 2026');
  const karatinaAt = multi.text.indexOf('20 February 2026');
  check(nyeriAt > -1 && karatinaAt > -1, 'Both facilities contribute an encounter');
  check(
    multi.text.slice(nyeriAt, nyeriAt + 320).includes(fixture.facilityARow.name),
    'The Nyeri visit is attributed to Nyeri',
  );
  check(
    multi.text.slice(karatinaAt, karatinaAt + 320).includes(
      `Synthetic Karatina Health Centre ${suffix}`,
    ),
    'The Karatina visit is attributed to Karatina',
  );
  await shot(multiPage, '04-portal-multi-facility.png');

  /* ---------------- scenario 10: somebody else's record ---------------- */
  const otherPage = await portalLogin(otherPatient.email);
  await openAccount(otherPage);
  const stranger = await pressDownload(otherPage);
  check(stranger.status === 200, 'Another patient can download their own record');
  expectText(stranger.text, otherPatient.name, 'The other patient sees their own name');
  expectMissing(stranger.text, main.name, "Another patient's record never contains this patient");
  expectMissing(stranger.text, marker('OPD_NOTE'), "Another patient cannot read this patient's notes");
  expectMissing(stranger.text, marker('RELEASED_DOC'), "Another patient cannot read this patient's documents");

  /*
   * A patient id supplied by the browser must change nothing. The route builds
   * the record from the session, so a forged id is not a rejected variation of
   * the call: it is ignored, and the caller still gets their own record.
   */
  const tampered = await apiPdf(
    otherPage,
    `/records/download?patientId=${main.id}&tenantId=${tenant}`,
  );
  check(tampered.status === 200, 'A tampered request still succeeds for its own patient');
  check(tampered.isPdf, 'The tampered request returns a PDF');
  expectText(tampered.text, otherPatient.name, 'A forged patient id still returns the caller');
  expectMissing(tampered.text, main.name, 'A forged patient id never returns the other patient');
  expectMissing(tampered.text, marker('OPD_NOTE'), 'A forged patient id never leaks a note');

  const forged = await apiPdf(otherPage, '/records/download?patientId=999999');
  check(forged.status === 200 && forged.isPdf, 'A nonsense patient id is ignored, not honoured');
  expectText(forged.text, otherPatient.name, 'A nonsense patient id returns the caller, not an error');
  expectMissing(forged.text, main.name, 'A nonsense patient id does not widen the record');
  await shot(otherPage, '05-portal-other-patient.png');

  /* An unauthenticated request gets no document at all. */
  const anonymous = await patientPage.evaluate(async () => {
    const response = await fetch('/api/portal/records/download');
    return { status: response.status, type: response.headers.get('content-type') ?? '' };
  });
  check(
    anonymous.status === 401 || anonymous.status === 403,
    'A request with no portal session is refused',
  );
  check(!anonymous.type.includes('pdf'), 'The refusal carries no document');

  /* The audit row exists for the downloads above. */
  const audit = await pool.query(
    `SELECT action,access_channel,record_type FROM patient_record_access_logs
     WHERE patient_id=$1 AND record_type='MedicalRecord' ORDER BY id DESC LIMIT 1`,
    [main.id],
  );
  check((audit.rowCount ?? 0) > 0, 'The download is written to the patient access log');
  check(
    audit.rows[0].access_channel === 'PATIENT_PORTAL',
    'The audit row records that the patient did it themselves',
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
        screenshots,
        scenarios: {
          outpatient: marker('OPD_NOTE'),
          inpatient: marker('DISCHARGE_SUMMARY'),
          laboratory: 'Full haemogram / Malaria slide / Urinalysis',
          radiology: 'Chest X-ray PA view / Abdominal ultrasound',
          prescriptions: 'Paracetamol / Amoxicillin / Synthetic cancelled medicine',
          emptyRecord: emptyPatient.mrn,
          multipleFacilities: [fixture.facilityARow.name, `Synthetic Karatina Health Centre ${suffix}`],
          documents: {
            released: marker('RELEASED_DOC'),
            unreleased: marker('MUST_NOT_APPEAR_UNRELEASED_DOC'),
          },
          longHistoryVisits: longHistory,
          pdfPages: pdf.pages,
          anotherPatient: 'own record only; forged patientId ignored',
        },
        fixture: {
          tenant,
          facilityA,
          facilityB,
          patient: main.id,
          mrn: main.mrn,
        },
      },
      null,
      2,
    ) + '\n',
  );
  await rm(path.join(out, 'failure.json'), { force: true });
  console.log(`DONE ${checks.length} checks`);
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
  await pool.end().catch(() => {});
}
