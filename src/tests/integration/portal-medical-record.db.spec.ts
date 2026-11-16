/**
 * The patient portal's medical-record PDF, end to end.
 *
 * Real Express app, real PostgreSQL, real rendering: the response is parsed back
 * with a PDF text extractor, so every assertion below is about what a patient
 * would see on the page rather than about the shape of a JSON object.
 *
 * The fixtures are synthetic and live only in the disposable
 * `clinical_documents_synthetic_test` database. They deliberately include the
 * awkward cases: an inpatient stay at a second facility, a result still pending
 * verification, a radiology request with no report, an unreleased document, and
 * a patient whose record is empty.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PDFParser from 'pdf2json';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { activateLetterhead, uploadLetterhead } from '../../branding/letterhead.service.ts';
import { pool } from '../../db/index.ts';
import { portalLogin } from '../../portal/portal-auth.service.ts';
import { hashPassword } from '../../utils/password.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpBytes, startTestServer } from './support/http-harness.ts';

const A4_W = 595.28;
const A4_H = 841.89;

/** A letterhead whose text identifies it, so branding can be traced. */
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

async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParser(null, true);
  const text = await new Promise<string>((resolve, reject) => {
    parser.on('pdfParser_dataError', reject);
    parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
    parser.parseBuffer(bytes);
  });
  parser.destroy();
  return text.replace(/\s+/g, ' ');
}

describeDb('Portal medical record PDF (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  const password = randomBytes(24).toString('base64url');
  /* MFL codes are unique on this database, so a rerun must not reuse one. */
  const mflA = `9911${suffix}`;
  const mflB = `9922${suffix}`;

  let tenant: number;
  let foreignTenant: number;
  let facilityA: number;
  let facilityB: number;
  let foreignFacility: number;

  let patientA: number;
  let patientEmpty: number;
  let patientOther: number;
  let patientMulti: number;

  let tokenA: string;
  let tokenEmpty: string;
  let tokenOther: string;
  let tokenMulti: string;
  let otherTenantToken: string;

  let letterheadLabel: string;
  let base: string;
  let close: () => Promise<void>;

  const marker = (name: string) => `${name}_${suffix}`;

  async function download(token: string, path = '/api/portal/records/download') {
    const response = await httpBytes(base, 'GET', path, { token });
    let text = '';
    if (response.status === 200) text = await pdfText(response.bytes);
    return {
      status: response.status,
      headers: response.headers,
      bytes: response.bytes,
      text,
    };
  }

  async function newPortalAccount(
    tenantId: number,
    facilityId: number,
    patientId: number,
    label: string,
  ) {
    const identifier = `record-${label}-${suffix}@example.test`;

    await pool.query(
      `INSERT INTO patient_portal_accounts
        (tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at)
       VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())`,
      [tenantId, facilityId, patientId, identifier, await hashPassword(password)],
    );

    return (await portalLogin({ identifier, password })).sessionToken;
  }

  async function encounter(input: {
    tenantId?: number;
    facilityId: number;
    patientId?: number;
    type: string;
    status?: string;
    startedAt: string;
    endedAt?: string | null;
    chiefComplaint: string;
    notes: string;
  }): Promise<number> {
    const row = await pool.query(
      `INSERT INTO encounters
        (tenant_id,facility_id,patient_id,encounter_type,status,started_at,ended_at,chief_complaint,clinical_notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        input.tenantId ?? tenant,
        input.facilityId,
        input.patientId ?? patientA,
        input.type,
        input.status ?? 'COMPLETED',
        input.startedAt,
        input.endedAt ?? null,
        input.chiefComplaint,
        input.notes,
      ],
    );
    return row.rows[0].id as number;
  }

  let opdEncounter: number;
  let inpatientEncounter: number;
  let longHistoryCount = 0;

  beforeAll(async () => {
    [tenant, foreignTenant] = (
      await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`, [
        `Synthetic medical record ${suffix}`,
        `record-${suffix}`,
        `Synthetic medical record foreign ${suffix}`,
        `record-x-${suffix}`,
      ])
    ).rows.map((row) => row.id as number);

    [facilityA, facilityB] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,county,sub_county,address,phone,email,enabled_modules)
         VALUES($1,$2,$3,'Level 4',$6,'Nyeri','Nyeri Central','Kenyatta Road','+254700000201','records-a@example.test','["registration","opd","inpatient","laboratory","radiology","pharmacy"]'),
               ($1,$4,$5,'Level 3',$7,'Nyeri','Karatina','Karatina Main Street','+254700000202','records-b@example.test','["registration","opd","inpatient"]')
         RETURNING id`,
        [
          tenant,
          `REC-A-${suffix}`,
          `Synthetic Nyeri Referral ${suffix}`,
          `REC-B-${suffix}`,
          `Synthetic Karatina Health Centre ${suffix}`,
          mflA,
          mflB,
        ],
      )
    ).rows.map((row) => row.id as number);

    foreignFacility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
         VALUES($1,$2,'Synthetic foreign facility','[]') RETURNING id`,
        [foreignTenant, `REC-X-${suffix}`],
      )
    ).rows[0].id as number;

    patientA = (
      await pool.query(
        `INSERT INTO patients
          (tenant_id,registration_facility_id,mrn,first_name,middle_name,last_name,date_of_birth,gender,blood_group,county,sub_county,phone)
         VALUES($1,$2,$3,'Wanjiku','Nyambura','Kamau','1990-03-14','Female','O+','Nyeri','Nyeri Central','+254712345678')
         RETURNING id`,
        [tenant, facilityA, marker('MRN')],
      )
    ).rows[0].id as number;

    patientEmpty = (
      await pool.query(
        `INSERT INTO patients
          (tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,allergies)
         VALUES($1,$2,$3,'Amina','Hassan','1992-07-01','Female','No known allergies') RETURNING id`,
        [tenant, facilityA, marker('MRN-EMPTY')],
      )
    ).rows[0].id as number;

    patientOther = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Peter','Otieno','1988-01-09','Male') RETURNING id`,
        [tenant, facilityA, marker('MRN-OTHER')],
      )
    ).rows[0].id as number;

    tokenA = await newPortalAccount(tenant, facilityA, patientA, 'main');
    tokenEmpty = await newPortalAccount(tenant, facilityA, patientEmpty, 'empty');
    tokenOther = await newPortalAccount(tenant, facilityA, patientOther, 'other');

    otherTenantToken = await newPortalAccount(
      foreignTenant,
      foreignFacility,
      (
        await pool.query(
          `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
           VALUES($1,$2,$3,'Foreign','Patient','1985-02-02','Other') RETURNING id`,
          [foreignTenant, foreignFacility, marker('MRN-FOREIGN')],
        )
      ).rows[0].id as number,
      'foreign',
    );

    /* ---------------- clinical history, spread over two facilities ---------------- */

    opdEncounter = await encounter({
      facilityId: facilityA,
      type: 'OUTPATIENT',
      startedAt: '2026-03-12T09:15:00',
      endedAt: '2026-03-12T10:00:00',
      chiefComplaint: 'Lower back pain for two weeks',
      notes: marker('OPD_NOTE'),
    });

    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,icd10_code,icd10_description,coding_system,diagnosis_type,status)
       VALUES($1,$2,'M54.5','Low back pain','ICD-10','Primary','Confirmed')`,
      [opdEncounter, patientA],
    );

    /*
     * The admission stays at the patient's registration facility: 0100 only
     * permits a signed document at the registration facility, so a record that
     * must contain released documents also has to be a single-facility record.
     * Multi-facility attribution is exercised separately below.
     */
    inpatientEncounter = await encounter({
      facilityId: facilityA,
      type: 'INPATIENT',
      startedAt: '2026-05-01T08:00:00',
      endedAt: '2026-05-04T11:00:00',
      chiefComplaint: 'Fever and vomiting',
      notes: marker('INPATIENT_NOTE'),
    });

    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,icd10_code,icd10_description,coding_system,diagnosis_type,status)
       VALUES($1,$2,'A09','Infectious gastroenteritis','ICD-10','Primary','Confirmed')`,
      [inpatientEncounter, patientA],
    );

    const ward = (
      await pool.query(`INSERT INTO wards(facility_id,name,code) VALUES($1,$2,$3) RETURNING id`, [
        facilityA,
        `Synthetic Ward ${suffix}`,
        `W-${suffix}`,
      ])
    ).rows[0].id as number;
    const bed = (
      await pool.query(`INSERT INTO beds(ward_id,bed_number) VALUES($1,'1') RETURNING id`, [ward])
    ).rows[0].id as number;

    await pool.query(
      `INSERT INTO admissions
        (tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,admission_type,
         status,discharge_date,discharge_type,discharge_disposition,discharge_summary)
       VALUES($1,$2,$3,$4,$5,$6,'2026-05-01','Emergency','Discharged','2026-05-04','Normal','Recovered',$7)`,
      [tenant, facilityA, patientA, inpatientEncounter, ward, bed, marker('DISCHARGE_SUMMARY')],
    );

    /* A long history: enough encounters that the document cannot be one page. */
    for (let index = 0; index < 32; index += 1) {
      const id = await encounter({
        facilityId: facilityA,
        type: 'OUTPATIENT',
        startedAt: `2025-${String((index % 12) + 1).padStart(2, '0')}-${String(
          (index % 27) + 1,
        ).padStart(2, '0')}T09:00:00`,
        endedAt: null,
        chiefComplaint: `Synthetic review ${index + 1}`,
        notes: `Long history note ${index + 1} ${suffix}. `.repeat(3),
      });
      await pool.query(
        `INSERT INTO diagnoses(encounter_id,patient_id,icd10_code,icd10_description,diagnosis_type,status)
         VALUES($1,$2,'Z00.0','General examination','Primary','Confirmed')`,
        [id, patientA],
      );
      longHistoryCount += 1;
    }

    /*
     * A genuinely multi-facility patient: registered at B, portal account at A,
     * treated at both. The portal's scope is the union of those two, so this is
     * the case where every encounter has to carry its own facility or the
     * document misattributes care.
     */
    patientMulti = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Grace','Wairimu','1979-11-30','Female') RETURNING id`,
        [tenant, facilityB, marker('MRN-MULTI')],
      )
    ).rows[0].id as number;

    tokenMulti = await newPortalAccount(tenant, facilityA, patientMulti, 'multi');

    await encounter({
      facilityId: facilityA,
      patientId: patientMulti,
      type: 'OUTPATIENT',
      startedAt: '2026-01-09T08:30:00',
      chiefComplaint: 'MARKER_VISIT_AT_NYERI',
      notes: 'Synthetic multi-facility visit at the referral hospital.',
    });
    await encounter({
      facilityId: facilityB,
      patientId: patientMulti,
      type: 'OUTPATIENT',
      startedAt: '2026-02-20T08:30:00',
      chiefComplaint: 'MARKER_VISIT_AT_KARATINA',
      notes: 'Synthetic multi-facility visit at the health centre.',
    });

    /* ---------------- allergies ---------------- */

    await pool.query(
      `INSERT INTO patient_allergies(tenant_id,facility_id,patient_id,allergen_type,allergen,reaction,severity,status)
       VALUES($1,$2,$3,'DRUG','Penicillin','Rash','SEVERE','ACTIVE'),
             ($1,$2,$3,'FOOD','Peanuts','Swelling','MODERATE','RESOLVED')`,
      [tenant, facilityA, patientA],
    );

    /* ---------------- prescriptions and dispensing ---------------- */

    const dispensed = (
      await pool.query(
        `INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,route,status,prescribed_at)
         VALUES($1,$2,'Paracetamol','500 mg','Three times a day','5 days','Oral','Prescribed','2026-03-12T09:30:00')
         RETURNING id`,
        [opdEncounter, patientA],
      )
    ).rows[0].id as number;

    await pool.query(
      `INSERT INTO pharmacy_dispensations(tenant_id,facility_id,prescription_id,patient_id,quantity_dispensed,dispensed_by,dispensed_at)
       VALUES($1,$2,$3,$4,15,'Synthetic Pharmacist','2026-03-12T09:45:00')`,
      [tenant, facilityA, dispensed, patientA],
    );

    await pool.query(
      `INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,route,status,prescribed_at)
       VALUES($1,$2,'Amoxicillin','250 mg','Twice a day','7 days','Oral','Prescribed','2026-05-01T10:00:00')`,
      [inpatientEncounter, patientA],
    );

    await pool.query(
      `INSERT INTO medications(encounter_id,patient_id,drug_name,dosage,frequency,duration,status,prescribed_at)
       VALUES($1,$2,'Synthetic cancelled medicine','1 tablet','Once','1 day','Cancelled','2026-03-12T09:40:00')`,
      [opdEncounter, patientA],
    );

    /* ---------------- laboratory: verified, pending, cancelled ---------------- */

    const verifiedOrder = (
      await pool.query(
        `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
         VALUES($1,$2,$3,'Full haemogram','Completed','2026-03-12T09:20:00') RETURNING id`,
        [tenant, facilityA, patientA],
      )
    ).rows[0].id as number;

    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,unit,reference_range,flag,status,verified_at)
       VALUES($1,$2,'Haemoglobin','12.4','g/dL','12-16','Normal','Verified','2026-03-12T12:10:00')`,
      [verifiedOrder, patientA],
    );
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status)
       VALUES($1,$2,$3,'13.9','Pending Verification')`,
      [verifiedOrder, patientA, marker('PENDING_RESULT')],
    );

    const pendingOnly = (
      await pool.query(
        `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
         VALUES($1,$2,$3,'Malaria slide','Ordered','2026-03-12T09:21:00') RETURNING id`,
        [tenant, facilityA, patientA],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status)
       VALUES($1,$2,'Parasites','Not seen','Pending Verification')`,
      [pendingOnly, patientA],
    );

    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
       VALUES($1,$2,$3,'Urinalysis','Cancelled','2026-03-12T09:22:00'),
             ($1,$2,$3,'Sputum AFB','Ordered','2026-03-12T09:23:00')`,
      [tenant, facilityA, patientA],
    );

    /* ---------------- radiology: reported and merely requested ---------------- */

    /*
     * This facility has configured radiology consent as not required, which is
     * a real setting the guard reads. Without it a synthetic `Reported` order
     * cannot exist at all (0101 refuses it), and the fixture would be testing a
     * document that could never be produced.
     */
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
       VALUES($1,$2,$3,'X-ray','Chest X-ray PA view','Reported','Clear lung fields. No pleural effusion.','Normal chest radiograph.','2026-05-02T12:00:00')`,
      [tenant, facilityA, patientA],
    );

    await pool.query(
      `INSERT INTO radiology_orders
        (tenant_id,facility_id,patient_id,modality,procedure_name,status,radiologist_findings,impression)
       VALUES($1,$2,$3,'Ultrasound','Abdominal ultrasound','Requested',$4,$4)`,
      [tenant, facilityA, patientA, marker('MUST_NOT_APPEAR_UNREPORTED_RADIOLOGY')],
    );

    /* ---------------- appointments ---------------- */

    await pool.query(
      `INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,appointment_type,status,reason)
       VALUES($1,$2,$3,'2027-01-15T09:30:00','Routine Follow-up','Scheduled','MARKER_APPOINTMENT_REASON'),
             ($1,$2,$3,'2026-02-01T09:30:00','Routine Follow-up','Completed','MARKER_PAST_APPOINTMENT_REASON')`,
      [tenant, facilityA, patientA],
    );

    /* ---------------- documents: one released, one not ---------------- */

    const documentUploader = (
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

    const documentPage = await PDFDocument.create();
    documentPage.addPage([A4_W, A4_H]).drawText('Synthetic released document', {
      x: 40,
      y: 760,
      size: 12,
    });
    const documentBytes = Buffer.from(await documentPage.save());

    const released = (
      await pool.query(
        `INSERT INTO patient_signed_documents
          (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason)
         VALUES($1,$2,$3,1,$4,'Consent','Treatment consent','UNKNOWN','UNKNOWN','released.pdf','application/pdf',$5,$6,$7,'Synthetic record fixture')
         RETURNING id`,
        [
          tenant,
          facilityA,
          patientA,
          marker('RELEASED_DOC'),
          'a'.repeat(64),
          documentBytes,
          documentUploader,
        ],
      )
    ).rows[0].id as number;

    await pool.query(
      `INSERT INTO patient_document_releases(document_id,released,actor_id,reason,released_at)
       VALUES($1,true,$2,'Synthetic release for the medical record',now())`,
      [released, documentUploader],
    );

    await pool.query(
      `INSERT INTO patient_signed_documents
        (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason)
       VALUES($1,$2,$3,1,$4,'Document','Patient document','UNKNOWN','UNKNOWN','unreleased.pdf','application/pdf',$5,$6,$7,'Internal working paper')`,
      [
        tenant,
        facilityA,
        patientA,
        marker('MUST_NOT_APPEAR_UNRELEASED_DOC'),
        'b'.repeat(64),
        documentBytes,
        documentUploader,
      ],
    );

    /* ---------------- branding ---------------- */

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

    const permissions = ['facility.branding.read', 'facility.branding.manage'];
    const context: AuthorizationContext = {
      userId: actor,
      tenantId: tenant,
      facilityId: facilityA,
      roles: [],
      permissions,
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
    await activateLetterhead(context, uploaded.letterhead.id, 'Synthetic record test');

    /* The server under test. */
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('renders a multi-page PDF with history, allergies, medicines, results, imaging, appointments and released documents', async () => {
    const result = await download(tokenA);

    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('application/pdf');
    expect(result.headers.get('content-disposition')).toContain('attachment');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');

    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);

    /* A. Branding: the facility's own identity and its active letterhead. */
    expect(result.text).toContain(`Synthetic Nyeri Referral ${suffix}`);
    expect(result.text).toContain(letterheadLabel);
    expect(result.text).toContain('Kenyatta Road');
    expect(result.text).toContain('+254700000201');
    expect(result.text).toContain(`MFL ${mflA}`);
    expect(result.text).toContain(`Facility code REC-A-${suffix}`);
    expect(result.text).toContain('PATIENT MEDICAL RECORD');

    /* B. The patient's profile, from their own row. */
    expect(result.text).toContain('Wanjiku Nyambura Kamau');
    expect(result.text).toContain(marker('MRN'));
    expect(result.text).toContain('14 March 1990');
    expect(result.text).toContain('Female');
    expect(result.text).toContain('O+');
    expect(result.text).toContain('+254712345678');

    /* C. Encounters, diagnoses, notes, admission and discharge. */
    expect(result.text).toContain('12 March 2026 at 09:15');
    expect(result.text).toContain('Outpatient (OPD)');
    expect(result.text).toContain(marker('OPD_NOTE'));
    expect(result.text).toContain('ICD-10 M54.5');
    expect(result.text).toContain('Low back pain');
    expect(result.text).toContain('Inpatient');
    expect(result.text).toContain(marker('INPATIENT_NOTE'));
    expect(result.text).toContain('Admitted 1 May 2026');
    expect(result.text).toContain('Discharged 4 May 2026');
    expect(result.text).toContain('Recovered');
    expect(result.text).toContain(marker('DISCHARGE_SUMMARY'));

    /* D. Prescriptions, including dispensing that really happened. */
    expect(result.text).toContain('Paracetamol');
    expect(result.text).toContain('500 mg');
    expect(result.text).toContain('Three times a day');
    expect(result.text).toContain('Dispensed 12 March 2026');
    expect(result.text).toContain('Amoxicillin');
    expect(result.text).toContain('Synthetic cancelled medicine');
    expect(result.text).toContain('Cancelled');

    /* E. Laboratory: verified values shown, pending values never printed. */
    expect(result.text).toContain('Full haemogram');
    expect(result.text).toContain('Haemoglobin');
    expect(result.text).toContain('12.4');
    expect(result.text).toContain('Verified');
    expect(result.text).toContain('pending verification');
    expect(result.text).not.toContain(marker('PENDING_RESULT'));
    expect(result.text).toContain('Malaria slide');
    expect(result.text).toContain('Result pending verification');
    expect(result.text).toContain('Sputum AFB');
    expect(result.text).toContain('No result has been recorded for this test yet');
    expect(result.text).toContain('Order cancelled. No result was issued');

    /* F. Radiology: the report, but never inventing one for a request. */
    expect(result.text).toContain('Chest X-ray PA view');
    expect(result.text).toContain('Clear lung fields');
    expect(result.text).toContain('Normal chest radiograph');
    expect(result.text).toContain('Abdominal ultrasound');
    expect(result.text).toContain('No report has been issued yet');
    expect(result.text).not.toContain(marker('MUST_NOT_APPEAR_UNREPORTED_RADIOLOGY'));

    /* G. Appointments, upcoming and historical. */
    expect(result.text).toContain('15 January 2027');
    expect(result.text).toContain('Upcoming');
    expect(result.text).toContain('1 February 2026');
    expect(result.text).toContain('Past');

    /* H. Documents: released only. */
    expect(result.text).toContain(marker('RELEASED_DOC'));
    expect(result.text).not.toContain(marker('MUST_NOT_APPEAR_UNRELEASED_DOC'));

    /* Page furniture, not raw data. */
    expect(result.text).toContain('Page 1 of');
    expect(result.text).toMatch(/Page 1 of \d+/);
    expect(result.text).not.toContain('"labOrders"');
    expect(result.text).not.toContain('patient_id');
    expect(result.text).not.toContain('sha256');
  });

  it('attributes each encounter to the facility that treated the patient, across facilities', async () => {
    const result = await download(tokenMulti);
    expect(result.status).toBe(200);

    expect(result.text).toContain('Grace Wairimu');
    expect(result.text).toContain('This copy covers records held at');
    expect(result.text).toContain(`Synthetic Nyeri Referral ${suffix}`);
    expect(result.text).toContain(`Synthetic Karatina Health Centre ${suffix}`);

    const nyeriHeading = result.text.indexOf('9 January 2026');
    const karatinaHeading = result.text.indexOf('20 February 2026');
    expect(nyeriHeading).toBeGreaterThan(-1);
    expect(karatinaHeading).toBeGreaterThan(-1);

    /*
     * The facility line sits directly under its own encounter heading, before
     * the visit's reason. Reading the block after each heading is what proves
     * attribution: the document could contain both names and still attach every
     * visit to the wrong one.
     */
    const nyeriBlock = result.text.slice(nyeriHeading, nyeriHeading + 300);
    const karatinaBlock = result.text.slice(karatinaHeading, karatinaHeading + 300);
    expect(nyeriBlock).toContain(`Synthetic Nyeri Referral ${suffix}`);
    expect(nyeriBlock).not.toContain(`Synthetic Karatina Health Centre ${suffix}`);
    expect(nyeriBlock).toContain('MARKER_VISIT_AT_NYERI');
    expect(karatinaBlock).toContain(`Synthetic Karatina Health Centre ${suffix}`);
    expect(karatinaBlock).not.toContain(`Synthetic Nyeri Referral ${suffix}`);
    expect(karatinaBlock).toContain('MARKER_VISIT_AT_KARATINA');

    /* Chronological order, oldest first: 9 January before 20 February. */
    expect(nyeriHeading).toBeLessThan(karatinaHeading);
  });

  it('repeats the facility header and page numbers on every page of a long history', async () => {
    const result = await download(tokenA);
    expect(result.status).toBe(200);

    const pdf = await PDFDocument.load(result.bytes);
    const pages = pdf.getPageCount();
    expect(pages, 'A long history must paginate').toBeGreaterThanOrEqual(4);

    const facilityMentions = (
      result.text.match(new RegExp(`Synthetic Nyeri Referral ${suffix}`, 'g')) ?? []
    ).length;
    expect(facilityMentions).toBeGreaterThanOrEqual(pages);

    for (let page = 1; page <= pages; page += 1) {
      expect(result.text).toContain(`Page ${page} of ${pages}`);
    }

    /* The last generated long-history encounter is present, so pagination did
     * not silently cut the record short. */
    expect(result.text).toContain(`Long history note ${longHistoryCount}`);
  });

  it('says what is missing instead of inventing it for a patient with no history', async () => {
    const result = await download(tokenEmpty);
    expect(result.status).toBe(200);

    expect(result.text).toContain('Amina Hassan');
    expect(result.text).toContain('No encounters have been recorded');
    /* The registration summary says there are no known allergies — that is a
     * different fact from "no allergy information recorded", and the copy must
     * preserve the difference. */
    expect(result.text).toContain('No known allergies');
    expect(result.text).not.toContain('No allergy information recorded');
    expect(result.text).toContain('No prescriptions have been recorded');
    expect(result.text).toContain('No laboratory tests have been recorded');
    expect(result.text).toContain('No radiology requests have been recorded');
    expect(result.text).toContain('No appointments have been recorded');
    expect(result.text).toContain('No documents have been released');

    /* No borrowed content from the other patient. */
    expect(result.text).not.toContain('Wanjiku');
    expect(result.text).not.toContain(marker('OPD_NOTE'));
  });

  it('distinguishes missing allergy information from a recorded absence of allergies', async () => {
    await pool.query('UPDATE patients SET allergies=NULL WHERE id=$1', [patientEmpty]);

    try {
      const result = await download(tokenEmpty);
      expect(result.status).toBe(200);
      expect(result.text).toContain('No allergy information recorded');
      expect(result.text).not.toContain('No known allergies');
    } finally {
      await pool.query("UPDATE patients SET allergies='No known allergies' WHERE id=$1", [
        patientEmpty,
      ]);
    }
  });

  it('never serves another patient’s record, even when a patient id is supplied in the URL', async () => {
    const other = await download(tokenOther);
    expect(other.status).toBe(200);
    expect(other.text).toContain('Peter Otieno');
    expect(other.text).not.toContain('Wanjiku');
    expect(other.text).not.toContain(marker('OPD_NOTE'));
    expect(other.text).not.toContain(marker('MRN'));

    const tampered = await download(tokenOther, `/api/portal/records/download?patientId=${patientA}`);
    expect(tampered.status, 'The query parameter is ignored, not interpreted').toBe(200);
    expect(tampered.text).toContain('Peter Otieno');
    expect(tampered.text).not.toContain('Wanjiku');

    const foreign = await download(otherTenantToken);
    expect(foreign.status).toBe(200);
    expect(foreign.text).toContain('Foreign Patient');
    expect(foreign.text).not.toContain('Wanjiku');
    expect(foreign.text).not.toContain(`Synthetic Nyeri Referral ${suffix}`);
  });

  it('honours each portal policy switch and explains the omission in the PDF', async () => {
    await pool.query(
      `INSERT INTO patient_portal_settings
        (tenant_id,facility_id,show_lab_results,show_prescriptions,show_allergies,show_appointments,show_discharge_summaries)
       VALUES($1,$2,false,false,false,false,false)
       ON CONFLICT(facility_id) DO UPDATE SET
         show_lab_results=false,show_prescriptions=false,show_allergies=false,
         show_appointments=false,show_discharge_summaries=false`,
      [tenant, facilityA],
    );

    try {
      const result = await download(tokenA);
      expect(result.status).toBe(200);

      expect(result.text).toContain('Laboratory results are not released through your portal');
      expect(result.text).toContain('Prescription information is not released through your portal');
      expect(result.text).toContain('Allergy information is not released through your portal');
      expect(result.text).toContain('Appointments are not shown through your portal');
      expect(result.text).toContain('Discharge summary: not released through your portal');

      expect(result.text).not.toContain('Haemoglobin');
      expect(result.text).not.toContain('Paracetamol');
      expect(result.text).not.toContain('Penicillin');
      expect(result.text).not.toContain(marker('DISCHARGE_SUMMARY'));
      expect(result.text).not.toContain('MARKER_APPOINTMENT_REASON');
      expect(result.text).not.toContain('15 January 2027');
    } finally {
      await pool.query(
        `UPDATE patient_portal_settings SET
           show_lab_results=true,show_prescriptions=true,show_allergies=true,
           show_appointments=true,show_discharge_summaries=true
         WHERE facility_id=$1`,
        [facilityA],
      );
    }
  });

  it('refuses the download when the facility has switched downloads off', async () => {
    await pool.query(
      `INSERT INTO patient_portal_settings(tenant_id,facility_id,allow_downloads)
       VALUES($1,$2,false) ON CONFLICT(facility_id) DO UPDATE SET allow_downloads=false`,
      [tenant, facilityA],
    );

    try {
      const result = await download(tokenA);
      expect(result.status).toBe(403);
      expect(result.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(result.bytes.toString())).toMatchObject({
        success: false,
        error: 'DOWNLOADS_DISABLED',
      });
    } finally {
      await pool.query('UPDATE patient_portal_settings SET allow_downloads=true WHERE facility_id=$1', [
        facilityA,
      ]);
    }
  });

  it('audits the download as a patient-portal access and stores no file', async () => {
    const before = Number(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM patient_record_access_logs
           WHERE patient_id=$1 AND record_type='MedicalRecord' AND action='DOWNLOAD'`,
          [patientA],
        )
      ).rows[0].n,
    );

    const result = await download(tokenA);
    expect(result.status).toBe(200);

    const after = Number(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM patient_record_access_logs
           WHERE patient_id=$1 AND record_type='MedicalRecord' AND action='DOWNLOAD'`,
          [patientA],
        )
      ).rows[0].n,
    );
    expect(after).toBe(before + 1);

    const channels = await pool.query(
      `SELECT DISTINCT access_channel FROM patient_record_access_logs
       WHERE patient_id=$1 AND record_type='MedicalRecord'`,
      [patientA],
    );
    expect(channels.rows.map((row) => row.access_channel)).toEqual(['PATIENT_PORTAL']);

    /* Nothing that could be fetched later: the response is produced inline, not
       redirected to a stored copy with a URL of its own. */
    expect(result.headers.get('location')).toBeNull();
  });
});
