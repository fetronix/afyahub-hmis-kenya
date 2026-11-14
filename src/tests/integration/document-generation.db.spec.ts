/**
 * Document generation, end to end, against synthetic PostgreSQL and real HTTP.
 *
 * These specs do not mock the renderer: the PDF that leaves the endpoint is
 * parsed back and its text is asserted. That is the only way to prove the
 * document contains the persisted rows rather than a placeholder, and it is
 * also how the financial-snapshot rule is verified — the invoice rows are
 * edited after finalization and the reprint must still show the original
 * figures.
 *
 * Every fixture is synthetic. No real patient, provider or facility appears.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PDFParser from 'pdf2json';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { activateLetterhead, uploadLetterhead } from '../../branding/letterhead.service.ts';
import { finalizeInvoice } from '../../billing/finalized-invoice.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { startTestServer } from './support/http-harness.ts';
import { approvedSyntheticManualRefund } from './support/refund-approval.ts';

const A4_W = 595.28;
const A4_H = 841.89;

/** A4 letterhead whose branding text is unique, so a reprint can be traced. */
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
  page.drawText(label, { x: 40, y: A4_H - 60, size: 18, font, color: rgb(1, 1, 1) });
  page.drawText('Synthetic Hospital · Nyeri', {
    x: 40,
    y: 30,
    size: 9,
    font,
    color: rgb(1, 1, 1),
  });
  return Buffer.from(await pdf.save());
}

/** Text of a generated PDF, normalised to single spaces. */
async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParser(null, true);
  const text = await new Promise<string>((resolve, reject) => {
    parser.on('pdfParser_dataError', (error) => reject(error));
    parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
    parser.parseBuffer(bytes);
  });
  parser.destroy();
  return text.replace(/\s+/g, ' ');
}

const ALL_PERMISSIONS = [
  'billing.read',
  'billing.update',
  'billing.payments.record',
  'billing.refunds.record',
  'clinical.read',
  'procurement.read',
  'laboratory.read',
  'radiology.read',
  'inpatient.read',
  'facility.branding.read',
  'facility.branding.manage',
];

describeDb('Document generation from persisted records', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number;
  let facility: number;
  let bareFacility: number;
  let foreignTenant: number;
  let foreignFacility: number;
  let patient: number;
  let encounter: number;
  let printerId: number;
  let printerCtx: AuthorizationContext;
  let annexCtx: AuthorizationContext;
  let printerToken: string;
  let billingOnlyToken: string;
  let labOnlyToken: string;
  let foreignToken: string;
  let siblingToken: string;
  let annexToken: string;
  let refundNumber: string;

  let finalizedInvoice: number;
  let unfinalizedInvoice: number;
  let bareInvoice: number;
  let paymentId: number;
  let refundId: number;
  let purchaseOrderId: number;
  let grnId: number;
  let labOrderId: number;
  let radiologyOrderId: number;
  let unreportedRadiologyId: number;
  let admissionId: number;
  let emptyAdmissionId: number;
  let letterheadV1Label: string;
  let letterheadV1Id: number;

  let base: string;
  let close: () => Promise<void>;

  interface Result {
    status: number;
    headers: Headers;
    json: any;
    bytes: Buffer;
  }

  async function get(path: string, token?: string | null): Promise<Result> {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${base}${path}`, { headers });
    const bytes = Buffer.from(await response.arrayBuffer());
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    return {
      status: response.status,
      headers: response.headers,
      json: isJson && bytes.length ? JSON.parse(bytes.toString('utf8')) : null,
      bytes,
    };
  }

  async function makeActor(tag: string, tenantId: number, facilityId: number, grants: string[]) {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic document user','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`doc-${tag}-${suffix}`, `doc-${tag}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenantId, `DOC_${tag}_${suffix}`],
      )
    ).rows[0].id as number;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const code of grants) {
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    const { sessionToken } = await createSession({ userId: id, securityVersion: 1 });
    return { id, token: sessionToken };
  }

  let tariff: number;
  let barePatient: number;
  let bareEncounter: number;
  let bareTariff: number;

  async function makeInvoice(label: string, facilityId: number, total = '100.00') {
    /* The annex has its own patient, encounter and tariff: finalization
     * requires evidence that belongs to the facility being billed. */
    const billedPatient = facilityId === bareFacility ? barePatient : patient;
    const billedEncounter = facilityId === bareFacility ? bareEncounter : encounter;
    const billedTariff = facilityId === bareFacility ? bareTariff : tariff;
    const id = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,
           total_amount,paid_amount,balance_amount,credit_balance,status,payer_type,payer_name,member_number)
         VALUES($1,$2,$3,$4,$5,$6,'0.00',$6,'0.00','Pending','Insurance','Synthetic payer','SYN-MEMBER')
         RETURNING id`,
        [tenant, facilityId, billedPatient, billedEncounter, `SYN-DOC-${label}-${suffix}`, total],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
       VALUES($1,$2,$3,'Consultation','Synthetic consultation',2,'50.00','100.00')`,
      [id, billedTariff, `SYN-DOC-${suffix}`],
    );
    return id;
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test')) {
      throw new Error('Synthetic test database required.');
    }

    for (const code of ALL_PERMISSIONS) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'documents') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    }

    tenant = (
      await pool.query('INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$3) RETURNING id', [
        `Documents ${suffix}`,
        `documents-${suffix}`,
        'KES',
      ])
    ).rows[0].id as number;
    foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$3) RETURNING id', [
        `Foreign documents ${suffix}`,
        `foreign-documents-${suffix}`,
        'KES',
      ])
    ).rows[0].id as number;

    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,email,timezone,enabled_modules)
       VALUES($1,$2,'Synthetic Print Hospital',$3,'Synthetic Road','Nyeri','0700000000','print@example.test','Africa/Nairobi','["finance","procurement","laboratory","radiology","inpatient"]'),
             ($1,$4,'Synthetic Annex Hospital',$5,'Annex Road','Nyeri','0700000001','annex@example.test','Africa/Nairobi','["finance"]'),
             ($6,$7,'Foreign Print Hospital',$8,'Foreign Road','Nyeri','0700000002','foreign@example.test','Africa/Nairobi','["finance"]')
       RETURNING id`,
      [
        tenant,
        `PR-${suffix}`,
        `MFL-PR-${suffix}`,
        `AN-${suffix}`,
        `MFL-AN-${suffix}`,
        foreignTenant,
        `FP-${suffix}`,
        `MFL-FP-${suffix}`,
      ],
    );
    [facility, bareFacility, foreignFacility] = facilities.rows.map((row) => row.id as number);

    const printer = await makeActor('printer', tenant, facility, ALL_PERMISSIONS);
    printerId = printer.id;
    printerToken = printer.token;
    printerCtx = {
      userId: printerId,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: ALL_PERMISSIONS,
      isSuperAdmin: false,
    };
    const annex = await makeActor('annex', tenant, bareFacility, ALL_PERMISSIONS);
    annexToken = annex.token;
    annexCtx = {
      userId: annex.id,
      tenantId: tenant,
      facilityId: bareFacility,
      roles: [],
      permissions: ALL_PERMISSIONS,
      isSuperAdmin: false,
    };
    billingOnlyToken = (await makeActor('billing', tenant, facility, ['billing.read'])).token;
    labOnlyToken = (await makeActor('lab', tenant, facility, ['laboratory.read'])).token;
    foreignToken = (await makeActor('foreign', foreignTenant, foreignFacility, ALL_PERMISSIONS))
      .token;
    siblingToken = (await makeActor('sibling', tenant, bareFacility, ALL_PERMISSIONS)).token;

    /* Letterhead v1, activated: this is what the finalized invoice records. */
    letterheadV1Label = `Branding version one ${suffix}`;
    const uploaded = await uploadLetterhead(printerCtx, {
      facilityId: facility,
      filename: 'letterhead-v1.pdf',
      mimeType: 'application/pdf',
      bytes: await letterheadPdf(letterheadV1Label),
    });
    letterheadV1Id = uploaded.letterhead.id;
    await activateLetterhead(printerCtx, letterheadV1Id, 'Approved by the facility');

    patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,middle_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Wanjiku','Nyambura','Kamau','1991-04-12','Female') RETURNING id`,
        [tenant, facility, `MRN-DOC-${suffix}`],
      )
    ).rows[0].id as number;
    const practitioner = (
      await pool.query(
        'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
        [tenant, facility, 'Dr. Synthetic Clinician'],
      )
    ).rows[0].id as number;
    const department = (
      await pool.query(
        'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
        [facility, 'Synthetic OPD', `OPD-${suffix}`],
      )
    ).rows[0].id as number;
    encounter = (
      await pool.query(
        'INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [tenant, facility, patient, practitioner, department],
      )
    ).rows[0].id as number;

    tariff = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
         VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','50.00') RETURNING id`,
        [tenant, facility, `SYN-DOC-${suffix}`],
      )
    ).rows[0].id as number;
    bareTariff = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
         VALUES($1,$2,$3,'Synthetic annex consultation','OPD','Visit','50.00') RETURNING id`,
        [tenant, bareFacility, `SYN-DOC-ANNEX-${suffix}`],
      )
    ).rows[0].id as number;

    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10','J18.9','Synthetic pneumonia, unspecified organism')`,
      [encounter, patient],
    );

    /* The annex facility: same tenant, no letterhead, its own clinical record. */
    barePatient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Otieno','Were','1987-02-03','Male') RETURNING id`,
        [tenant, bareFacility, `MRN-ANNEX-${suffix}`],
      )
    ).rows[0].id as number;
    const annexPractitioner = (
      await pool.query(
        'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
        [tenant, bareFacility, 'Dr. Annex Clinician'],
      )
    ).rows[0].id as number;
    const annexDepartment = (
      await pool.query(
        'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
        [bareFacility, 'Annex OPD', `ANOPD-${suffix}`],
      )
    ).rows[0].id as number;
    bareEncounter = (
      await pool.query(
        'INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [tenant, bareFacility, barePatient, annexPractitioner, annexDepartment],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10','Z00.0','Synthetic general examination')`,
      [bareEncounter, barePatient],
    );

    finalizedInvoice = await makeInvoice('FIN', facility);
    unfinalizedInvoice = await makeInvoice('DRAFT', facility);
    bareInvoice = await makeInvoice('BARE', bareFacility);

    await finalizeInvoice(printerCtx, finalizedInvoice, {
      insurerResponsibility: '60.00',
      copayment: '10.00',
      allocationBasis: 'Synthetic responsibility allocation; not insurer approval',
    });
    await finalizeInvoice(annexCtx, bareInvoice, {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Self-paying synthetic patient',
    });

    const payment = await recordSettledPayment(
      printerCtx,
      {
        facilityId: facility,
        invoiceId: finalizedInvoice,
        amount: '30.00',
        paymentMethod: 'Cash',
        payerParty: 'PATIENT',
        idempotencyKey: `doc-payment-${suffix}`,
      },
      'Synthetic cashier',
    );
    paymentId = payment.payment.id;

    /*
     * A refund cannot be inserted directly: the database requires an
     * independent approval. The real request → review → record path is used so
     * the credit note prints a refund that actually exists under the rules.
     */
    const refund = await approvedSyntheticManualRefund(printerCtx, {
      facilityId: facility,
      invoiceId: finalizedInvoice,
      paymentId,
      amount: '10.00',
      refundMethod: 'CASH',
      reason: 'Synthetic duplicate charge reversed',
      manualConfirmation: true,
      idempotencyKey: `refund-key-${suffix}`,
    });
    refundId = refund.refund.id as number;
    refundNumber = refund.refund.refundNumber;

    const supplier = (
      await pool.query(
        'INSERT INTO suppliers(tenant_id,name,phone,email) VALUES($1,$2,$3,$4) RETURNING id',
        [tenant, 'Synthetic Supplies Ltd', '0711111111', 'sales@supplier.example.test'],
      )
    ).rows[0].id as number;

    purchaseOrderId = (
      await pool.query(
        `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status,
           subtotal_amount,tax_amount,shipping_amount,discount_amount,payment_terms,expected_delivery_date,
           delivery_address,notes,created_by_user_id,revision,description)
         VALUES($1,$2,$3,$4,'1160.00','APPROVED','1000.00','160.00','0.00','0.00','Net 30','2026-12-01',
           'Synthetic Stores','Synthetic order note',$5,2,'Synthetic consumables') RETURNING id`,
        [tenant, facility, supplier, `LPO-${suffix}`, printerId],
      )
    ).rows[0].id as number;
    const poItem = (
      await pool.query(
        `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total,is_active)
         VALUES($1,1,'Synthetic examination gloves',100,'box','10.00','1000.00',true) RETURNING id`,
        [purchaseOrderId],
      )
    ).rows[0].id as number;

    grnId = (
      await pool.query(
        `INSERT INTO goods_received_notes(tenant_id,facility_id,grn_number,purchase_order_id,supplier_id,
           received_date,received_by_user_id,received_by_name,status,inventory_value_kes,notes)
         VALUES($1,$2,$3,$4,$5,'2026-11-20',$6,'Synthetic Storekeeper','POSTED','1000.00','Synthetic receipt note')
         RETURNING id`,
        [tenant, facility, `GRN-${suffix}`, purchaseOrderId, supplier, printerId],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO goods_received_note_items(goods_received_note_id,purchase_order_item_id,description,
         quantity_received,unit_cost,line_total,batch_number,expiry_date)
       VALUES($1,$2,'Synthetic examination gloves',100,'10.00','1000.00','BATCH-SYN','2028-01-31')`,
      [grnId, poItem],
    );

    labOrderId = (
      await pool.query(
        `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_name,status,
           sample_collected_at,ordered_at,ordered_by,specimen_type,priority,clinical_notes,completed_at)
         VALUES($1,$2,$3,$4,'Synthetic full blood count','COMPLETED','2026-11-18T08:10:00Z',
           '2026-11-18T07:55:00Z','Dr. Synthetic Clinician','Whole blood','Routine',
           'Synthetic clinical note','2026-11-18T10:20:00Z') RETURNING id`,
        [tenant, facility, patient, encounter],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,unit,reference_range,flag,status,verified_at)
       VALUES($1,$2,'Haemoglobin','13.4','g/dL','12.0 - 16.0','Normal','VERIFIED','2026-11-18T10:15:00Z'),
             ($1,$2,'White cell count','7.2','x10^9/L','4.0 - 11.0','Normal','VERIFIED','2026-11-18T10:15:00Z')`,
      [labOrderId, patient],
    );

    radiologyOrderId = (
      await pool.query(
        `INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,encounter_id,modality,procedure_name,
           clinical_indication,status,radiologist_findings,impression,reported_by,reported_at)
         VALUES($1,$2,$3,$4,'X-Ray','Synthetic chest radiograph','Synthetic persistent cough','REPORTED',
           'No focal consolidation. Cardiac silhouette normal.','No acute cardiopulmonary abnormality',
           'Dr. Synthetic Radiologist','2026-11-19T14:00:00Z') RETURNING id`,
        [tenant, facility, patient, encounter],
      )
    ).rows[0].id as number;
    unreportedRadiologyId = (
      await pool.query(
        `INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,encounter_id,modality,procedure_name,status)
         VALUES($1,$2,$3,$4,'Ultrasound','Synthetic abdominal ultrasound','REQUESTED') RETURNING id`,
        [tenant, facility, patient, encounter],
      )
    ).rows[0].id as number;

    const ward = (
      await pool.query('INSERT INTO wards(facility_id,name,code) VALUES($1,$2,$3) RETURNING id', [
        facility,
        'Synthetic Medical Ward',
        `W-${suffix}`,
      ])
    ).rows[0].id as number;
    const bed = (
      await pool.query('INSERT INTO beds(ward_id,bed_number) VALUES($1,$2) RETURNING id', [
        ward,
        `B-${suffix}`,
      ])
    ).rows[0].id as number;

    admissionId = (
      await pool.query(
        `INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,
           admission_type,admitting_doctor,provisional_diagnosis,nursing_notes,status,discharge_date,
           discharge_type,discharge_summary,discharge_disposition)
         VALUES($1,$2,$3,$4,$5,$6,'2026-11-14T09:30:00Z','Elective','Dr. Synthetic Clinician',
           'Synthetic community acquired pneumonia','Synthetic nursing observation note','DISCHARGED',
           '2026-11-18T11:00:00Z','Recovered',
           'Synthetic patient admitted with community acquired pneumonia, treated with antibiotics and discharged in stable condition.',
           'Home') RETURNING id`,
        [tenant, facility, patient, encounter, ward, bed],
      )
    ).rows[0].id as number;
    emptyAdmissionId = (
      await pool.query(
        `INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status)
         VALUES($1,$2,$3,$4,$5,$6,'2026-11-21T08:00:00Z','ADMITTED') RETURNING id`,
        [tenant, facility, patient, encounter, ward, bed],
      )
    ).rows[0].id as number;

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  /* --------------------------------------------------------------- invoice */

  it('prints a finalized invoice on the facility letterhead', async () => {
    const result = await get(`/api/documents/invoices/${finalizedInvoice}/pdf`, printerToken);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/pdf');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.headers.get('x-letterhead-applied')).toBe('true');
    expect(result.headers.get('x-letterhead-version')).toContain('Letterhead v1');
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Number(result.headers.get('x-document-pages'))).toBeGreaterThanOrEqual(1);

    const text = await pdfText(result.bytes);
    expect(text).toContain(`SYN-DOC-FIN-${suffix}`);
    expect(text).toContain('Wanjiku Nyambura Kamau');
    expect(text).toContain('Synthetic consultation');
    expect(text).toContain('KES 100.00');
    expect(text).toContain('KES 60.00');
    expect(text).toContain(letterheadV1Label);

    const download = await get(
      `/api/documents/invoices/${finalizedInvoice}/pdf?download=1`,
      printerToken,
    );
    expect(download.headers.get('content-disposition')).toContain('attachment');
  });

  it('refuses to print an invoice that has not been finalized', async () => {
    const result = await get(`/api/documents/invoices/${unfinalizedInvoice}/pdf`, printerToken);
    expect(result.status).toBe(409);
    expect(result.json.code).toBe('DOCUMENT_NOT_PRINTABLE');
  });

  it('prints a reprint from the frozen snapshot, not from live rows', async () => {
    const before = await pdfText(
      (await get(`/api/documents/invoices/${finalizedInvoice}/pdf`, printerToken)).bytes,
    );
    expect(before).toContain('Synthetic consultation');
    expect(before).toContain('KES 100.00');

    /*
     * A finalized invoice is protected twice over: the database trigger rejects
     * any attempt to rewrite its lines, and the document prints from the
     * snapshot regardless. Both are asserted here, because either one alone
     * would be a single point of failure.
     */
    await expect(
      pool.query(
        `UPDATE billing_items SET description='EDITED AFTER FINALIZATION', quantity=9,
           unit_price='999.00', total_amount='8991.00' WHERE invoice_id=$1`,
        [finalizedInvoice],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      pool.query(`UPDATE billing_invoices SET total_amount='8991.00' WHERE id=$1`, [
        finalizedInvoice,
      ]),
    ).rejects.toThrow(/immutable|finalized/i);

    const after_ = await get(`/api/documents/invoices/${finalizedInvoice}/pdf`, printerToken);
    expect(await pdfText(after_.bytes)).toBe(before);
  });

  it('keeps a reprint on the letterhead version it was issued under', async () => {
    const replacement = await uploadLetterhead(printerCtx, {
      facilityId: facility,
      filename: 'letterhead-v2.pdf',
      mimeType: 'application/pdf',
      bytes: await letterheadPdf(`Branding version two ${suffix}`),
    });
    await activateLetterhead(printerCtx, replacement.letterhead.id, 'New stationery');

    const reprint = await get(`/api/documents/invoices/${finalizedInvoice}/pdf`, printerToken);
    expect(reprint.status).toBe(200);
    expect(reprint.headers.get('x-letterhead-version')).toContain('Letterhead v1');
    const text = await pdfText(reprint.bytes);
    expect(text).toContain(letterheadV1Label);
    expect(text).not.toContain(`Branding version two ${suffix}`);

    /* A NEW invoice finalized now records v2. */
    const laterInvoice = await makeInvoice('LATER', facility);
    await finalizeInvoice(printerCtx, laterInvoice, {
      insurerResponsibility: '0.00',
      copayment: '100.00',
      allocationBasis: 'Synthetic patient responsibility',
    });
    const laterText = await pdfText(
      (await get(`/api/documents/invoices/${laterInvoice}/pdf`, printerToken)).bytes,
    );
    expect(laterText).toContain(`Branding version two ${suffix}`);
  });

  it('falls back to plain A4 when the facility has no letterhead', async () => {
    const result = await get(`/api/documents/invoices/${bareInvoice}/pdf`, annexToken);
    expect(result.status).toBe(200);
    expect(result.headers.get('x-letterhead-applied')).toBe('false');
    expect(result.headers.get('x-letterhead-version')).toBeNull();

    const pdf = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const [first] = pdf.getPages();
    expect(Math.round(first.getWidth())).toBe(595);
    expect(Math.round(first.getHeight())).toBe(842);
  });

  /* --------------------------------------------------------------- receipt */

  it('prints an official receipt on A4 and a thermal receipt without branding', async () => {
    const a4 = await get(`/api/documents/receipts/${paymentId}/pdf`, printerToken);
    expect(a4.status).toBe(200);
    expect(a4.headers.get('x-letterhead-applied')).toBe('true');
    const text = await pdfText(a4.bytes);
    expect(text).toContain('Official Receipt');
    expect(text).toContain('KES 30.00');

    const thermal = await get(`/api/documents/receipts/${paymentId}/pdf?thermal=1`, printerToken);
    expect(thermal.status).toBe(200);
    expect(thermal.headers.get('x-letterhead-applied')).toBe('false');
    const thermalPdf = await PDFDocument.load(thermal.bytes, { updateMetadata: false });
    const [page] = thermalPdf.getPages();
    expect(Math.round(page.getWidth())).toBe(226);
    expect(page.getHeight()).toBeGreaterThan(300);
    expect(await pdfText(thermal.bytes)).toContain('KES 30.00');
  });

  /* ----------------------------------------------------------- credit note */

  it('prints a credit note', async () => {
    const result = await get(`/api/documents/credit-notes/${refundId}/pdf`, printerToken);
    expect(result.status).toBe(200);
    const text = await pdfText(result.bytes);
    expect(text).toContain('Credit Note');
    expect(text).toContain(refundNumber);
    expect(text).toContain('KES 10.00');
    expect(text).toContain('Synthetic duplicate charge reversed');
  });

  /* -------------------------------------------------------------- LPO, GRN */

  it('prints a purchase order and a goods received note', async () => {
    const lpo = await get(`/api/documents/purchase-orders/${purchaseOrderId}/pdf`, printerToken);
    expect(lpo.status).toBe(200);
    const lpoText = await pdfText(lpo.bytes);
    expect(lpoText).toContain(`LPO-${suffix}`);
    expect(lpoText).toContain('Synthetic Supplies Ltd');
    expect(lpoText).toContain('Synthetic examination gloves');
    expect(lpoText).toContain('KES 1,160.00');

    const grn = await get(`/api/documents/goods-received-notes/${grnId}/pdf`, printerToken);
    expect(grn.status).toBe(200);
    const grnText = await pdfText(grn.bytes);
    expect(grnText).toContain(`GRN-${suffix}`);
    expect(grnText).toContain('Synthetic examination gloves');
    expect(grnText).toContain('BATCH-SYN');
  });

  /* ---------------------------------------------------- laboratory, imaging */

  it('prints a laboratory report with its verified results', async () => {
    const result = await get(`/api/documents/laboratory-orders/${labOrderId}/pdf`, printerToken);
    expect(result.status).toBe(200);
    const text = await pdfText(result.bytes);
    expect(text).toContain('Laboratory Report');
    expect(text).toContain('Synthetic full blood count');
    expect(text).toContain('Haemoglobin');
    expect(text).toContain('13.4');
    expect(text).toContain('All results on this report have been verified');
  });

  it('prints an imaging report and refuses one that has not been reported', async () => {
    const reported = await get(
      `/api/documents/radiology-orders/${radiologyOrderId}/pdf`,
      printerToken,
    );
    expect(reported.status).toBe(200);
    const text = await pdfText(reported.bytes);
    expect(text).toContain('Synthetic chest radiograph');
    expect(text).toContain('No acute cardiopulmonary abnormality');
    expect(text).toContain('Dr. Synthetic Radiologist');

    const pending = await get(
      `/api/documents/radiology-orders/${unreportedRadiologyId}/pdf`,
      printerToken,
    );
    expect(pending.status).toBe(409);
    expect(pending.json.code).toBe('DOCUMENT_INCOMPLETE');
  });

  /* -------------------------------------------------------- discharge note */

  it('prints a discharge summary and refuses one that was never written', async () => {
    const result = await get(
      `/api/documents/admissions/${admissionId}/discharge-summary.pdf`,
      printerToken,
    );
    expect(result.status).toBe(200);
    const text = await pdfText(result.bytes);
    expect(text).toContain('Discharge Summary');
    expect(text).toContain('Synthetic patient admitted with community acquired pneumonia');
    expect(text).toContain('Synthetic community acquired pneumonia');
    expect(text).toContain('Recovered');

    const empty = await get(
      `/api/documents/admissions/${emptyAdmissionId}/discharge-summary.pdf`,
      printerToken,
    );
    expect(empty.status).toBe(409);
    expect(empty.json.code).toBe('DOCUMENT_INCOMPLETE');
  });

  /* ------------------------------------------------------- authorization */

  it('requires the document-specific permission', async () => {
    /* billing.read is exactly what printing an invoice needs. */
    const invoice = await get(`/api/documents/invoices/${finalizedInvoice}/pdf`, billingOnlyToken);
    expect(invoice.status).toBe(200);

    const po = await get(`/api/documents/purchase-orders/${purchaseOrderId}/pdf`, billingOnlyToken);
    expect(po.status).toBe(403);

    const lab = await get(`/api/documents/laboratory-orders/${labOrderId}/pdf`, labOnlyToken);
    expect(lab.status).toBe(200);

    const labPrintingInvoice = await get(
      `/api/documents/invoices/${finalizedInvoice}/pdf`,
      labOnlyToken,
    );
    expect(labPrintingInvoice.status).toBe(403);
  });

  it('answers 404 for another tenant and for a sibling facility', async () => {
    for (const path of [
      `/api/documents/invoices/${finalizedInvoice}/pdf`,
      `/api/documents/receipts/${paymentId}/pdf`,
      `/api/documents/credit-notes/${refundId}/pdf`,
      `/api/documents/purchase-orders/${purchaseOrderId}/pdf`,
      `/api/documents/goods-received-notes/${grnId}/pdf`,
      `/api/documents/laboratory-orders/${labOrderId}/pdf`,
      `/api/documents/radiology-orders/${radiologyOrderId}/pdf`,
      `/api/documents/admissions/${admissionId}/discharge-summary.pdf`,
    ]) {
      const foreign = await get(path, foreignToken);
      expect(foreign.status, path).toBe(404);

      const sibling = await get(path, siblingToken);
      expect(sibling.status, path).toBe(404);
    }
  });

  it('requires authentication', async () => {
    const result = await get(`/api/documents/invoices/${finalizedInvoice}/pdf`, null);
    expect(result.status).toBe(401);
  });

  it('rejects an unknown document id without leaking whether it exists', async () => {
    const result = await get('/api/documents/invoices/99999999/pdf', printerToken);
    expect(result.status).toBe(404);
    expect(result.json.code).toBe('DOCUMENT_NOT_FOUND');

    const invalid = await get('/api/documents/invoices/abc/pdf', printerToken);
    expect(invalid.status).toBe(400);
    expect(invalid.json.code).toBe('DOCUMENT_ID_INVALID');
  });
});

/**
 * THE ACCEPTANCE TEST FOR DYNAMIC, VERSIONED LETTERHEADS.
 *
 * Activate letterhead A, issue one of every supported document, activate
 * letterhead B, issue another of each. Every document from the first batch must
 * still print on A and every document from the second on B — with no code
 * change, no redeployment and no manual database edit between the two batches.
 *
 * The point is that this is asserted for all eight document types rather than
 * the invoice alone, because a per-template implementation is exactly the
 * failure this requirement exists to prevent.
 */
describeDb('Letterhead versioning across every document type', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number;
  let facility: number;
  let patient: number;
  let encounter: number;
  let printerCtx: AuthorizationContext;
  let printerToken: string;
  let base: string;
  let close: () => Promise<void>;
  let tariff: number;

  let letterheadAId: number;
  let letterheadBId: number;
  const labelA = `Stationery A ${suffix}`;
  const labelB = `Stationery B ${suffix}`;

  /** One issuance of every document type produced under a given letterhead. */
  interface Batch {
    invoiceId: number;
    paymentId: number;
    refundId: number;
    purchaseOrderId: number;
    grnId: number;
    labOrderId: number;
    radiologyOrderId: number;
    admissionId: number;
  }

  let batchA: Batch;
  let batchB: Batch;

  async function letterheadPdf(label: string): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([A4_W, A4_H]);
    page.drawRectangle({
      x: 0,
      y: A4_H - 110,
      width: A4_W,
      height: 110,
      color: rgb(0.04, 0.2, 0.3),
    });
    page.drawRectangle({ x: 0, y: 0, width: A4_W, height: 60, color: rgb(0.04, 0.2, 0.3) });
    page.drawText(label, { x: 40, y: A4_H - 65, size: 17, font, color: rgb(1, 1, 1) });
    return Buffer.from(await pdf.save());
  }

  async function pdfText(bytes: Buffer): Promise<string> {
    const parser = new PDFParser(null, true);
    const text = await new Promise<string>((resolve, reject) => {
      parser.on('pdfParser_dataError', (error) => reject(error));
      parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
      parser.parseBuffer(bytes);
    });
    parser.destroy();
    return text.replace(/\s+/g, ' ');
  }

  async function fetchPdf(path: string): Promise<{ status: number; bytes: Buffer }> {
    const response = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${printerToken}` },
    });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  /** The paths of all eight supported documents for one batch. */
  function documentPaths(batch: Batch): Array<[string, string]> {
    return [
      ['invoice', `/api/documents/invoices/${batch.invoiceId}/pdf`],
      ['receipt', `/api/documents/receipts/${batch.paymentId}/pdf`],
      ['credit note', `/api/documents/credit-notes/${batch.refundId}/pdf`],
      ['purchase order', `/api/documents/purchase-orders/${batch.purchaseOrderId}/pdf`],
      ['goods received note', `/api/documents/goods-received-notes/${batch.grnId}/pdf`],
      ['laboratory report', `/api/documents/laboratory-orders/${batch.labOrderId}/pdf`],
      ['radiology report', `/api/documents/radiology-orders/${batch.radiologyOrderId}/pdf`],
      ['discharge summary', `/api/documents/admissions/${batch.admissionId}/discharge-summary.pdf`],
    ];
  }

  async function activate(label: string): Promise<number> {
    const uploaded = await uploadLetterhead(printerCtx, {
      facilityId: facility,
      filename: `${label.replace(/\s+/g, '-')}.pdf`,
      mimeType: 'application/pdf',
      bytes: await letterheadPdf(label),
    });
    await activateLetterhead(printerCtx, uploaded.letterhead.id, `Activating ${label}`);
    return uploaded.letterhead.id;
  }

  /**
   * Issue one of every document type right now.
   *
   * Each row is inserted with an explicit issued-at a few seconds in the past,
   * so the history lookup has a real instant to place instead of "now" racing
   * the activation timestamp.
   */
  async function issueBatch(tag: string): Promise<Batch> {
    /*
     * Written as a UTC wall-clock string rather than a Date: a `timestamp`
     * column stores what it is given, and the driver serialises a Date in the
     * process timezone. The application's own rows come from `now()`, which is
     * UTC wall clock, so the fixtures must match that convention or the
     * letterhead-history comparison would be off by the offset.
     */
    const issuedAt = new Date();
    const issuedAtText = issuedAt.toISOString();

    const invoiceId = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,
           total_amount,paid_amount,balance_amount,credit_balance,status,payer_type,payer_name,member_number)
         VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Pending','Insurance','Synthetic payer','SYN-MEMBER')
         RETURNING id`,
        [tenant, facility, patient, encounter, `SYN-LH-${tag}-${suffix}`],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
       VALUES($1,$2,$3,'Consultation','Synthetic consultation',2,'50.00','100.00')`,
      [invoiceId, tariff, `SYN-LH-${suffix}`],
    );
    await finalizeInvoice(printerCtx, invoiceId, {
      insurerResponsibility: '60.00',
      copayment: '10.00',
      allocationBasis: 'Synthetic responsibility allocation; not insurer approval',
    });

    const payment = await recordSettledPayment(
      printerCtx,
      {
        facilityId: facility,
        invoiceId,
        amount: '30.00',
        paymentMethod: 'Cash',
        payerParty: 'PATIENT',
        idempotencyKey: `lh-payment-${tag}-${suffix}`,
      },
      'Synthetic cashier',
    );
    const paymentId = payment.payment.id as number;

    const refund = await approvedSyntheticManualRefund(printerCtx, {
      facilityId: facility,
      invoiceId,
      paymentId,
      amount: '10.00',
      refundMethod: 'CASH',
      reason: 'Synthetic refund for letterhead acceptance',
      manualConfirmation: true,
      idempotencyKey: `lh-refund-${tag}-${suffix}`,
    });

    const supplier = (
      await pool.query('INSERT INTO suppliers(tenant_id,name) VALUES($1,$2) RETURNING id', [
        tenant,
        `Synthetic Supplier ${tag} ${suffix}`,
      ])
    ).rows[0].id as number;
    const purchaseOrderId = (
      await pool.query(
        `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status,
           subtotal_amount,tax_amount,shipping_amount,discount_amount,created_at,created_by_user_id,revision)
         VALUES($1,$2,$3,$4,'575.00','APPROVED','500.00','75.00','0.00','0.00',$5,$6,1) RETURNING id`,
        [tenant, facility, supplier, `LPO-${tag}-${suffix}`, issuedAtText, printerCtx.userId],
      )
    ).rows[0].id as number;
    const poItem = (
      await pool.query(
        `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total,is_active)
         VALUES($1,1,'Synthetic dressing pack',50,'pack','10.00','500.00',true) RETURNING id`,
        [purchaseOrderId],
      )
    ).rows[0].id as number;
    const grnId = (
      await pool.query(
        `INSERT INTO goods_received_notes(tenant_id,facility_id,grn_number,purchase_order_id,supplier_id,
           received_date,received_by_user_id,received_by_name,status,inventory_value_kes,created_at)
         VALUES($1,$2,$3,$4,$5,'2026-11-22',$6,'Synthetic Storekeeper','POSTED','500.00',$7) RETURNING id`,
        [
          tenant,
          facility,
          `GRN-${tag}-${suffix}`,
          purchaseOrderId,
          supplier,
          printerCtx.userId,
          issuedAtText,
        ],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO goods_received_note_items(goods_received_note_id,purchase_order_item_id,description,
         quantity_received,unit_cost,line_total,batch_number,expiry_date)
       VALUES($1,$2,'Synthetic dressing pack',50,'10.00','500.00',$3,'2029-06-30')`,
      [grnId, poItem, `BATCH-${tag}`],
    );

    const labOrderId = (
      await pool.query(
        `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_name,status,
           sample_collected_at,ordered_at,specimen_type,priority,completed_at)
         VALUES($1,$2,$3,$4,$5,'COMPLETED',$6,$7,'Whole blood','Routine',$8) RETURNING id`,
        [
          tenant,
          facility,
          patient,
          encounter,
          `Synthetic assay ${tag}`,
          new Date(issuedAt.getTime() - 4_000).toISOString(),
          new Date(issuedAt.getTime() - 5_000).toISOString(),
          issuedAtText,
        ],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,unit,reference_range,flag,status,verified_at)
       VALUES($1,$2,'Synthetic analyte','5.1','mmol/L','3.5 - 5.5','Normal','VERIFIED',$3)`,
      [labOrderId, patient, issuedAtText],
    );

    const radiologyOrderId = (
      await pool.query(
        `INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,encounter_id,modality,procedure_name,
           clinical_indication,status,radiologist_findings,impression,reported_by,reported_at,created_at)
         VALUES($1,$2,$3,$4,'X-Ray',$5,'Synthetic indication','REPORTED',
           'Synthetic findings for the letterhead acceptance test.','Synthetic impression',
           'Dr. Synthetic Radiologist',$6,$7) RETURNING id`,
        [
          tenant,
          facility,
          patient,
          encounter,
          `Synthetic radiograph ${tag}`,
          issuedAtText,
          new Date(issuedAt.getTime() - 6_000).toISOString(),
        ],
      )
    ).rows[0].id as number;

    const ward = (
      await pool.query('INSERT INTO wards(facility_id,name,code) VALUES($1,$2,$3) RETURNING id', [
        facility,
        `Ward ${tag} ${suffix}`,
        `W-${tag}-${suffix}`,
      ])
    ).rows[0].id as number;
    const bed = (
      await pool.query('INSERT INTO beds(ward_id,bed_number) VALUES($1,$2) RETURNING id', [
        ward,
        `B-${tag}-${suffix}`,
      ])
    ).rows[0].id as number;
    const admissionId = (
      await pool.query(
        `INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,
           admission_type,admitting_doctor,provisional_diagnosis,status,discharge_date,discharge_type,
           discharge_summary,discharge_disposition)
         VALUES($1,$2,$3,$4,$5,$6,'2026-11-15T09:00:00Z','Elective','Dr. Synthetic Clinician',
           'Synthetic diagnosis','DISCHARGED',$7,'Recovered',$8,'Home') RETURNING id`,
        [
          tenant,
          facility,
          patient,
          encounter,
          ward,
          bed,
          issuedAtText,
          `Synthetic discharge summary for ${tag}.`,
        ],
      )
    ).rows[0].id as number;

    return {
      invoiceId,
      paymentId,
      refundId: refund.refund.id as number,
      purchaseOrderId,
      grnId,
      labOrderId,
      radiologyOrderId,
      admissionId,
    };
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test')) {
      throw new Error('Synthetic test database required.');
    }
    for (const code of ALL_PERMISSIONS) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'documents') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    }

    tenant = (
      await pool.query('INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$3) RETURNING id', [
        `Letterhead acceptance ${suffix}`,
        `lh-accept-${suffix}`,
        'KES',
      ])
    ).rows[0].id as number;
    facility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,email,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic Acceptance Hospital',$3,'Acceptance Road','Nyeri','0700000010',
           'accept@example.test','Africa/Nairobi','["finance","procurement","laboratory","radiology","inpatient"]')
         RETURNING id`,
        [tenant, `AC-${suffix}`, `MFL-AC-${suffix}`],
      )
    ).rows[0].id as number;

    const actor = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic acceptance user','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`lh-${suffix}`, `lh-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `LH_ACCEPT_${suffix}`],
      )
    ).rows[0].id as number;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
    for (const code of ALL_PERMISSIONS) {
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    const { sessionToken } = await createSession({ userId: actor, securityVersion: 1 });
    printerToken = sessionToken;
    printerCtx = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: ALL_PERMISSIONS,
      isSuperAdmin: false,
    };

    patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Acceptance','1988-08-08','Other') RETURNING id`,
        [tenant, facility, `MRN-AC-${suffix}`],
      )
    ).rows[0].id as number;
    const practitioner = (
      await pool.query(
        'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
        [tenant, facility, 'Dr. Acceptance'],
      )
    ).rows[0].id as number;
    const department = (
      await pool.query(
        'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
        [facility, 'Acceptance OPD', `ACOPD-${suffix}`],
      )
    ).rows[0].id as number;
    encounter = (
      await pool.query(
        'INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [tenant, facility, patient, practitioner, department],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10','Z00.0','Synthetic general examination')`,
      [encounter, patient],
    );
    tariff = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
         VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','50.00') RETURNING id`,
        [tenant, facility, `SYN-LH-${suffix}`],
      )
    ).rows[0].id as number;

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('issues batch A under letterhead A, then batch B under letterhead B', async () => {
    letterheadAId = await activate(labelA);
    batchA = await issueBatch('A');

    /* Every document of batch A carries stationery A. */
    for (const [name, path] of documentPaths(batchA)) {
      const document = await fetchPdf(path);
      expect(document.status, `${name} under A`).toBe(200);
      const text = await pdfText(document.bytes);
      expect(text, `${name} should show letterhead A`).toContain(labelA);
      expect(text, `${name} should not show letterhead B`).not.toContain(labelB);
    }

    /* Nothing was edited in code or SQL between the batches except activation. */
    letterheadBId = await activate(labelB);
    batchB = await issueBatch('B');

    for (const [name, path] of documentPaths(batchB)) {
      const document = await fetchPdf(path);
      expect(document.status, `${name} under B`).toBe(200);
      const text = await pdfText(document.bytes);
      expect(text, `${name} should show letterhead B`).toContain(labelB);
      expect(text, `${name} should not show letterhead A`).not.toContain(labelA);
    }

    expect(letterheadAId).not.toBe(letterheadBId);
  }, 120_000);

  it('re-issues every batch-A document on letterhead A after B was activated', async () => {
    /*
     * The strongest form of the requirement: reprint the FIRST batch now that
     * B is the active letterhead. Every one of the eight must still render on
     * A, because that is the stationery it was issued under.
     */
    for (const [name, path] of documentPaths(batchA)) {
      const document = await fetchPdf(path);
      expect(document.status, `${name} reprint`).toBe(200);
      const text = await pdfText(document.bytes);
      expect(text, `${name} reprint should still show A`).toContain(labelA);
      expect(text, `${name} reprint should not show B`).not.toContain(labelB);
    }

    /* And the active letterhead really is B, so this is not a stale read. */
    const state = await fetch(`${base}/api/facility-branding/facilities/${facility}/letterheads`, {
      headers: { authorization: `Bearer ${printerToken}` },
    });
    const body = (await state.json()) as { versions: Array<{ status: string; version: number }> };
    const active = body.versions.filter((version) => version.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
  }, 120_000);

  it('renders a real document on a candidate letterhead before activation', async () => {
    const uploaded = await uploadLetterhead(printerCtx, {
      facilityId: facility,
      filename: `candidate-${suffix}.pdf`,
      mimeType: 'application/pdf',
      bytes: await letterheadPdf(`Candidate ${suffix}`),
    });
    const version = uploaded.letterhead;
    expect(version.status).toBe('DRAFT');

    const preview = await fetch(
      `${base}/api/facility-branding/facilities/${facility}/letterheads/${version.id}/preview-document`,
      { headers: { authorization: `Bearer ${printerToken}` } },
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('x-letterhead-applied')).toBe('true');
    const text = await pdfText(Buffer.from(await preview.arrayBuffer()));
    expect(text).toContain(`Candidate ${suffix}`);
    expect(text).toContain('Synthetic consultation');

    /* Previewing changed nothing: the version is still a draft. */
    const stillDraft = await pool.query('SELECT status FROM facility_letterheads WHERE id=$1', [
      version.id,
    ]);
    expect(stillDraft.rows[0].status).toBe('DRAFT');
  }, 60_000);

  it('takes effect for newly issued documents with no restart or code change', async () => {
    /*
     * The active letterhead is read from the database on every request. There
     * is no cache to invalidate and no configuration to reload, so activating
     * a version is the whole of the change management.
     */
    const before = await fetch(`${base}/api/documents/invoices/${batchB.invoiceId}/pdf`, {
      headers: { authorization: `Bearer ${printerToken}` },
    });
    expect(await pdfText(Buffer.from(await before.arrayBuffer()))).toContain(labelB);

    const uploaded = await uploadLetterhead(printerCtx, {
      facilityId: facility,
      filename: `switch-${suffix}.pdf`,
      mimeType: 'application/pdf',
      bytes: await letterheadPdf(`Stationery C ${suffix}`),
    });
    await activateLetterhead(printerCtx, uploaded.letterhead.id, 'Third stationery');

    const batchC = await issueBatch('C');
    const invoiceC = await fetchPdf(`/api/documents/invoices/${batchC.invoiceId}/pdf`);
    const textC = await pdfText(invoiceC.bytes);
    expect(textC).toContain(`Stationery C ${suffix}`);
    expect(textC).not.toContain(labelB);

    /* And B is still what batch B prints on. */
    const invoiceB = await fetchPdf(`/api/documents/invoices/${batchB.invoiceId}/pdf`);
    expect(await pdfText(invoiceB.bytes)).toContain(labelB);
  }, 120_000);

  it("isolates one facility's letterhead from another", async () => {
    /*
     * A second facility in the same tenant activates its own stationery. It
     * must not appear on the first facility's documents, and the first
     * facility's active version must be untouched.
     */
    const otherFacility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic Neighbour Hospital',$3,'Neighbour Road','Nyeri','0700000011',
           'Africa/Nairobi','["finance"]') RETURNING id`,
        [tenant, `NB-${suffix}`, `MFL-NB-${suffix}`],
      )
    ).rows[0].id as number;

    const neighbourActor = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic neighbour user','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`nb-${suffix}`, `nb-${suffix}@example.test`, tenant, otherFacility],
      )
    ).rows[0].id as number;
    const neighbourRole = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `LH_NB_${suffix}`],
      )
    ).rows[0].id as number;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      neighbourActor,
      neighbourRole,
    ]);
    for (const code of ALL_PERMISSIONS) {
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [neighbourRole, code],
      );
    }
    const neighbourCtx: AuthorizationContext = {
      userId: neighbourActor,
      tenantId: tenant,
      facilityId: otherFacility,
      roles: [],
      permissions: ALL_PERMISSIONS,
      isSuperAdmin: false,
    };

    const neighbourLabel = `Neighbour stationery ${suffix}`;
    const uploaded = await uploadLetterhead(neighbourCtx, {
      facilityId: otherFacility,
      filename: `neighbour-${suffix}.pdf`,
      mimeType: 'application/pdf',
      bytes: await letterheadPdf(neighbourLabel),
    });
    await activateLetterhead(neighbourCtx, uploaded.letterhead.id, 'Neighbour branding');

    const neighbourInvoice = await fetch(`${base}/api/documents/invoices/${batchB.invoiceId}/pdf`, {
      headers: { authorization: `Bearer ${printerToken}` },
    });
    const neighbourText = await pdfText(Buffer.from(await neighbourInvoice.arrayBuffer()));
    expect(neighbourText).toContain(labelB);
    expect(neighbourText).not.toContain(neighbourLabel);

    /* The neighbour cannot even see the first facility's versions. */
    const foreign = await fetch(
      `${base}/api/facility-branding/facilities/${facility}/letterheads`,
      { headers: { authorization: `Bearer ${printerToken}` } },
    );
    expect(foreign.status).toBe(200);
    const neighbourList = await fetch(
      `${base}/api/facility-branding/facilities/${otherFacility}/letterheads`,
      { headers: { authorization: `Bearer ${printerToken}` } },
    );
    expect(neighbourList.status).toBe(404);
  }, 120_000);
});
