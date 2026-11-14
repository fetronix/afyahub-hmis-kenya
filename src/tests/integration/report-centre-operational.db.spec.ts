/** Synthetic records only: authenticated HTTP through PostgreSQL, never a production database. */
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import PDFParser from 'pdf2json';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { addCalendarDays } from '../../dashboard/date-range.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { insertSyntheticReportRefund } from './support/refund-approval.ts';

describeDb('Reporting Centre operational registers (synthetic PostgreSQL and HTTP)', () => {
  const suffix = randomUUID().slice(0, 8);
  const modules = [
    'analytics',
    'inventory',
    'opd',
    'inpatient',
    'laboratory',
    'radiology',
    'pharmacy',
    'finance',
    'registration',
  ];
  const grants = [
    'reports.read',
    'reports.export',
    'inventory.read',
    'clinical.read',
    'patients.read',
    'inpatient.read',
    'laboratory.read',
    'pharmacy.read',
    'billing.read',
    'billing.refunds.record',
    'users.read',
  ];
  let tenant: number,
    facility: number,
    sibling: number,
    otherTenant: number,
    foreignFacility: number;
  let patient: number,
    siblingPatient: number,
    foreignPatient: number,
    department: number,
    actor: number;
  let full: string, onlyReports: string, noExport: string, base: string, close: () => Promise<void>;
  let refundNumber: string, refundDate: string, lastRefundDate: string;

  async function user(label: string, permissions: string[]) {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic reporting user','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`ops-${label}-${suffix}`, `ops-${label}-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `OPS_${label}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const code of permissions) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'reports') ON CONFLICT(code) DO NOTHING",
        [code],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }
  const generate = (id: string, filters: Record<string, unknown> = {}, token = full) =>
    httpJson(base, 'POST', `/api/reporting/centre/${id}/generate`, {
      token,
      body: { facilityId: facility, ...filters },
    });
  const exp = (
    id: string,
    format: 'pdf' | 'xlsx',
    filters: Record<string, unknown> = {},
    token = full,
  ) =>
    httpJson(base, 'POST', `/api/reporting/centre/${id}/export`, {
      token,
      body: { facilityId: facility, format, ...filters },
    });

  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('synthetic') ||
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    ) {
      throw new Error('An isolated loopback synthetic test database is required.');
    }
    [tenant, otherTenant] = (
      await pool.query(
        'INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$5),($3,$4,$5) RETURNING id',
        [
          `Synthetic ops ${suffix}`,
          `ops-${suffix}`,
          `Synthetic other ${suffix}`,
          `other-${suffix}`,
          'KES',
        ],
      )
    ).rows.map((r) => r.id);
    [facility, sibling, foreignFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
       ($1,$3,'Synthetic Operations Facility',$6::jsonb),($1,$4,'Synthetic Sibling Facility',$6::jsonb),($2,$5,'Synthetic Foreign Facility',$6::jsonb) RETURNING id`,
        [
          tenant,
          otherTenant,
          `OA-${suffix}`,
          `OB-${suffix}`,
          `OC-${suffix}`,
          JSON.stringify(modules),
        ],
      )
    ).rows.map((r) => r.id);
    [patient, siblingPatient, foreignPatient] = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES
       ($1,$3,$6,'Synthetic','OwnPerson','2000-01-01','Other'),
       ($1,$4,$7,'Synthetic','SiblingPrivate','2000-01-01','Other'),
       ($2,$5,$8,'Synthetic','ForeignPrivate','2000-01-01','Other') RETURNING id`,
        [
          tenant,
          otherTenant,
          facility,
          sibling,
          foreignFacility,
          `OP-${suffix}`,
          `OS-${suffix}`,
          `OF-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    await pool.query("UPDATE patients SET created_at='2026-04-01 08:00' WHERE id=$1", [patient]);
    const administrator = await user('full', grants);
    actor = administrator.id;
    full = administrator.token;
    onlyReports = (await user('reports', ['reports.read'])).token;
    noExport = (
      await user(
        'noexport',
        grants.filter((g) => g !== 'reports.export'),
      )
    ).token;
    department = (
      await pool.query(
        "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic OPD',$2) RETURNING id",
        [facility, `D-${suffix}`],
      )
    ).rows[0].id;
    const practitioner = (
      await pool.query(
        "INSERT INTO practitioners(tenant_id,facility_id,user_id,full_name) VALUES($1,$2,$3,'Synthetic clinician') RETURNING id",
        [tenant, facility, actor],
      )
    ).rows[0].id;
    const encounterIds = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id,encounter_type,status,started_at) VALUES
       ($1,$2,$4,$7,$8,'OUTPATIENT','COMPLETED','2026-04-01 08:00'),
       ($1,$2,$4,$7,$8,'OUTPATIENT','ACTIVE','2026-04-03 08:00'),
       ($1,$3,$5,NULL,NULL,'OUTPATIENT','COMPLETED','2026-04-01 08:00'),
       ($1,$2,$6,NULL,NULL,'OUTPATIENT','ACTIVE','2026-04-02 08:00') RETURNING id`,
        [
          tenant,
          facility,
          sibling,
          patient,
          siblingPatient,
          foreignPatient,
          practitioner,
          department,
        ],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_name,status,specimen_type,ordered_at) VALUES
       ($1,$2,$4,$7,'Synthetic Full Blood Count','Ordered','Whole Blood','2026-04-01 09:00'),
       ($1,$2,$4,$8,'Synthetic Test Later','Completed',NULL,'2026-04-03 09:00'),
       ($1,$3,$5,$9,'Synthetic Sibling Test','Ordered',NULL,'2026-04-01 09:00'),
       ($1,$2,$6,$10,'Synthetic Missing Link','Ordered',NULL,'2026-04-02 09:00')`,
      [tenant, facility, sibling, patient, siblingPatient, foreignPatient, ...encounterIds],
    );
    await pool.query(
      `INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name,status,created_at) VALUES
       ($1,$2,$4,'X-ray','Synthetic Imaging','Requested','2026-04-01 10:00'),
       ($1,$2,$4,'Ultrasound','Synthetic Later Imaging','Reported','2026-04-03 10:00'),
       ($1,$3,$5,'X-ray','Synthetic Sibling Imaging','Requested','2026-04-01 10:00'),
       ($1,$2,$6,'X-ray','Synthetic Missing Link Imaging','Requested','2026-04-02 10:00')`,
      [tenant, facility, sibling, patient, siblingPatient, foreignPatient],
    );
    await pool.query(
      `INSERT INTO pharmacy_dispensations(tenant_id,facility_id,patient_id,item_code_snapshot,item_name_snapshot,item_unit_snapshot,batch_number,quantity_dispensed,dispensed_by,dispensed_at) VALUES
       ($1,$2,$4,'SYN-A','Synthetic Medicine','Tablets','B-A',3,'Synthetic staff','2026-04-01 11:00'),
       ($1,$2,$4,'SYN-B','Synthetic Later Medicine','Bottles','B-B',2,'Synthetic staff','2026-04-03 11:00'),
       ($1,$3,$5,'SYN-S','Synthetic Sibling Medicine','Tablets','B-S',999,'Synthetic staff','2026-04-01 11:00'),
       ($1,$2,$6,NULL,NULL,NULL,NULL,1,'Synthetic staff','2026-04-02 11:00')`,
      [tenant, facility, sibling, patient, siblingPatient, foreignPatient],
    );
    const wardIds = (
      await pool.query(
        "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic Ward',$3),($2,'Synthetic Sibling Ward',$4) RETURNING id",
        [facility, sibling, `WA-${suffix}`, `WB-${suffix}`],
      )
    ).rows.map((r) => r.id);
    const bedIds = (
      await pool.query(
        "INSERT INTO beds(ward_id,bed_number) VALUES($1,'1'),($1,'2'),($1,'3'),($2,'1') RETURNING id",
        wardIds,
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status,discharge_date,discharge_type) VALUES
       ($1,$2,$4,$7,$9,'2026-04-01 12:00','Discharged','2026-04-03 12:00','Home'),
       ($1,$2,$4,$7,$10,'2026-04-04 12:00','Admitted',NULL,NULL),
       ($1,$2,$6,$7,$11,'not-an-iso-date','Discharged','2026-02-30 12:00','Unknown'),
       ($1,$3,$5,$8,$12,'2026-04-01 12:00','Discharged','2026-04-03 12:00','Home')`,
      [tenant, facility, sibling, patient, siblingPatient, foreignPatient, ...wardIds, ...bedIds],
    );
    const inventoryIds = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit) VALUES($1,$3,'Synthetic Test Item','Tablets'),($2,$4,'Synthetic Sibling Item','Bottles') RETURNING id",
        [facility, sibling, `IT-${suffix}`, `IS-${suffix}`],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES
       ($1,'LOT-APR','2026-04-30',7),($1,'LOT-BAD','not-a-date',3),($1,'LOT-IMPOSSIBLE','2026-02-30',2),($2,'LOT-SIB','2026-04-30',999)`,
      inventoryIds,
    );
    const invoiceIds = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,created_at) VALUES
       ($1,$2,$4,$7,280.50,210.00,70.50,'Partially Paid','2026-04-01 08:00'),
       ($1,$2,$4,$8,0,0,NULL,'Pending','2026-04-02 08:00'),
       ($1,$2,$6,$9,0,0,20.00,'Pending','2026-04-03 08:00'),
       ($1,$3,$5,$10,0,0,999.00,'Pending','2026-04-01 08:00') RETURNING id`,
        [
          tenant,
          facility,
          sibling,
          patient,
          siblingPatient,
          foreignPatient,
          `INV-A-${suffix}`,
          `INV-B-${suffix}`,
          `INV-C-${suffix}`,
          `INV-S-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    const payments = (
      await pool.query(
        `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES
       ($1,$3,'Cash',120.10,'Synthetic Cashier A','2026-04-01 13:00'),
       ($1,$4,'Cash',79.90,'Synthetic Cashier A','2026-04-01 14:00'),
       ($1,$5,'Card',10.00,'Synthetic Cashier B','2026-04-03 13:00'),
       ($2,$6,'Cash',999.00,'Synthetic Sibling','2026-04-01 13:00') RETURNING id`,
        [
          invoiceIds[0],
          invoiceIds[3],
          `REC-A-${suffix}`,
          `REC-B-${suffix}`,
          `REC-C-${suffix}`,
          `REC-S-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    const firstRefund = await insertSyntheticReportRefund({
      tenant,
      facility,
      invoice: invoiceIds[0],
      payment: payments[0],
      actor,
      amount: '25.00',
      reason: 'Synthetic test',
      key: `key-a-${suffix}`,
    });
    refundNumber = firstRefund.number;
    refundDate = firstRefund.date;
    const secondRefund = await insertSyntheticReportRefund({
      tenant,
      facility,
      invoice: invoiceIds[0],
      payment: payments[1],
      actor,
      amount: '5.00',
      reason: 'Synthetic test',
      key: `key-b-${suffix}`,
    });
    lastRefundDate = secondRefund.date;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  const cases = [
    {
      id: 'patient-registrations',
      search: 'OwnPerson',
      expected: 'Synthetic OwnPerson',
      field: 'patient',
      title: 'Recorded facility registrations',
      date: '2026-04-01',
    },
    {
      id: 'inventory-expiry',
      search: 'LOT-APR',
      expected: 'LOT-APR',
      field: 'batch',
      title: 'Inventory batch expiry register',
      date: '2026-04-30',
    },
    {
      id: 'outpatient-encounters',
      search: 'OwnPerson',
      expected: 'Synthetic OwnPerson',
      field: 'patient',
      title: 'Recorded outpatient encounters',
      date: '2026-04-01',
    },
    {
      id: 'inpatient-admissions',
      search: 'OwnPerson',
      expected: 'Synthetic OwnPerson',
      field: 'patient',
      title: 'Inpatient admission register',
      date: '2026-04-01',
    },
    {
      id: 'inpatient-discharges',
      search: 'OwnPerson',
      expected: 'Synthetic OwnPerson',
      field: 'patient',
      title: 'Recorded inpatient discharges',
      date: '2026-04-03',
    },
    {
      id: 'laboratory-orders',
      search: 'Full Blood Count',
      expected: 'Synthetic Full Blood Count',
      field: 'test',
      title: 'Laboratory order register',
      date: '2026-04-01',
    },
    {
      id: 'radiology-requests',
      search: 'Synthetic Imaging',
      expected: 'Synthetic Imaging',
      field: 'procedure',
      title: 'Radiology request register',
      date: '2026-04-01',
    },
    {
      id: 'pharmacy-dispensations',
      search: 'Synthetic Medicine',
      expected: 'Synthetic Medicine',
      field: 'item',
      title: 'Recorded pharmacy dispensations',
      date: '2026-04-01',
    },
    {
      id: 'cashier-receipts',
      search: 'Cashier A',
      expected: 'Synthetic Cashier A',
      field: 'cashier',
      title: 'Recorded receipts by cashier and date',
      date: '2026-04-01',
    },
    {
      id: 'recorded-refunds',
      search: 'REF-A-',
      expected: 'REF-A-',
      field: 'number',
      title: 'Recorded manual refunds',
      date: '2026-04-01',
    },
    {
      id: 'invoice-balances',
      search: 'INV-A-',
      expected: 'INV-A-',
      field: 'invoice',
      title: 'Recorded invoice balance snapshot',
      date: '2026-04-01',
    },
  ] as const;

  it.each(cases)(
    '$id returns scoped actual rows and generates real PDF/XLSX',
    async ({ id, search, expected, field, title, date }) => {
      const selectedDate = id === 'recorded-refunds' ? refundDate : date;
      const selectedSearch = id === 'recorded-refunds' ? refundNumber : search;
      const expectedText = id === 'recorded-refunds' ? refundNumber : expected;
      const filters = { search: selectedSearch, from: selectedDate, to: selectedDate, limit: 1 };
      const response = await generate(id, filters);
      expect(response.status).toBe(200);
      expect(response.body.title).toBe(title);
      expect(response.body.total).toBe(1);
      expect(String(response.body.rows[0][field])).toContain(expectedText);
      expect(JSON.stringify(response.body)).not.toContain('SiblingPrivate');
      expect(JSON.stringify(response.body)).not.toContain('ForeignPrivate');
      expect((await generate(id, { facilityId: sibling })).status).toBe(403);
      expect((await generate(id, { facilityId: foreignFacility })).status).toBe(403);
      expect((await generate(id, {}, onlyReports)).status).toBe(403);
      expect((await exp(id, 'xlsx', filters, noExport)).status).toBe(403);
      expect((await generate(id, { from: '2026-02-30', to: '2026-03-01' })).status).toBe(400);
      const empty = await generate(id, { search: 'not-present-synthetic' });
      expect(empty.status).toBe(200);
      expect(empty.body.total).toBe(0);
      expect(empty.body.rows).toEqual([]);
      const pdf = await exp(id, 'pdf', filters);
      expect(pdf.status).toBe(200);
      const bytes = Buffer.from(pdf.body.base64, 'base64');
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const parser = new PDFParser(null, true);
      const text = await new Promise<string>((resolve, reject) => {
        parser.on('pdfParser_dataError', reject);
        parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
        parser.parseBuffer(bytes);
      });
      expect(text).toContain(title);
      expect(text).toContain(expectedText);
      parser.destroy();
      const xlsx = await exp(id, 'xlsx', filters);
      expect(xlsx.status).toBe(200);
      const xml = Object.entries(unzipSync(Buffer.from(xlsx.body.base64, 'base64')))
        .filter(([name]) => name.endsWith('.xml'))
        .map(([, data]) => strFromU8(data))
        .join('\n');
      expect(xml).toContain(expectedText);
      expect(xml).not.toMatch(/<f[ >]/);
    },
    20000,
  );

  it('applies patient, status, department and linked staff filters, with audited patient access', async () => {
    const report = await generate('outpatient-encounters', {
      from: '2026-04-01',
      to: '2026-04-03',
      patientId: patient,
      status: 'COMPLETED',
      departmentId: department,
      staffId: actor,
    });
    expect(report.status).toBe(200);
    expect(report.body.total).toBe(1);
    expect(report.body.rows[0].status).toBe('COMPLETED');
    expect(
      (await generate('outpatient-encounters', { departmentId: department + 999 })).status,
    ).toBe(400);
    expect((await generate('outpatient-encounters', { staffId: actor + 999 })).status).toBe(400);
    expect(
      (await generate('laboratory-orders', { patientId: patient, status: 'Completed' })).body.total,
    ).toBe(1);
    expect(
      (await generate('radiology-requests', { patientId: patient, status: 'Reported' })).body.total,
    ).toBe(1);
    expect((await generate('pharmacy-dispensations', { patientId: siblingPatient })).status).toBe(
      400,
    );
    const access = await pool.query(
      "SELECT DISTINCT patient_id FROM patient_record_access_logs WHERE user_id=$1 AND record_type='REPORT_CENTRE'",
      [actor],
    );
    expect(access.rows.map((r) => r.patient_id)).toContain(patient);
    expect(access.rows.map((r) => r.patient_id)).not.toContain(foreignPatient);
  });

  it('flags malformed dates and excluded out-of-scope patient links without fabricating data', async () => {
    const batches = await generate('inventory-expiry', { from: '2026-04-01', to: '2026-04-30' });
    expect(batches.status).toBe(200);
    expect(batches.body.total).toBe(1);
    expect(batches.body.notes.join(' ')).toContain(
      '2 batch(es) with missing or invalid recorded expiry dates',
    );
    const admissions = await generate('inpatient-admissions', {
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(admissions.status).toBe(200);
    expect(admissions.body.total).toBe(2);
    expect(admissions.body.notes.join(' ')).toContain(
      '1 admission(s) with missing or invalid recorded dates',
    );
    const lab = await generate('laboratory-orders', { search: 'Missing Link' });
    expect(lab.status).toBe(200);
    expect(lab.body.rows[0].patient).toBeNull();
    expect(JSON.stringify(lab.body)).not.toContain('ForeignPrivate');
    expect(lab.body.notes.join(' ')).toContain('missing or out-of-scope');
  });

  it('uses exact numeric totals for recorded receipts, refunds and known invoice balances across the full filtered result', async () => {
    const receipts = await generate('cashier-receipts', {
      from: '2026-04-01',
      to: '2026-04-03',
      limit: 1,
    });
    expect(receipts.body.total).toBe(2);
    expect(receipts.body.rows.length).toBe(1);
    expect(receipts.body.summaries[0].value).toBe('210.00');
    const fullSheet = await exp('cashier-receipts', 'xlsx', {
      from: '2026-04-01',
      to: '2026-04-03',
      limit: 1,
    });
    expect(fullSheet.status).toBe(200);
    const sheetXml = Object.entries(unzipSync(Buffer.from(fullSheet.body.base64, 'base64')))
      .filter(([name]) => name.endsWith('.xml'))
      .map(([, bytes]) => strFromU8(bytes))
      .join('\n');
    expect(sheetXml).toContain('Known recorded receipts (refunds not deducted): KES 210.00');
    const cashier = await generate('cashier-receipts', {
      search: 'Cashier A',
      from: '2026-04-01',
      to: '2026-04-01',
    });
    expect(cashier.body.rows[0].receiptCount).toBe(2);
    expect(cashier.body.rows[0].amount).toBe('200.00');
    const refunds = await generate('recorded-refunds', {
      from: refundDate,
      to: lastRefundDate,
      staffId: actor,
      limit: 1,
    });
    expect(refunds.body.total).toBe(2);
    expect(refunds.body.summaries[0].value).toBe('30.00');
    const priorDate = addCalendarDays(refundDate, -1);
    const excluded = await generate('recorded-refunds', {
      from: priorDate,
      to: priorDate,
      staffId: actor,
    });
    expect(excluded.body.total).toBe(0);
    const balances = await generate('invoice-balances');
    expect(balances.body.total).toBe(3);
    expect(balances.body.summaries[0].value).toBe('120.50');
    expect(balances.body.rows.some((row: { balance: string | null }) => row.balance === null)).toBe(
      true,
    );
    expect(balances.body.notes.join(' ')).toContain('invalid/unknown balance');
    expect(JSON.stringify(balances.body)).not.toContain('ForeignPrivate');
  });

  it('never treats a non-finite recorded payment as a zero receipt', async () => {
    const invoiceId = (
      await pool.query(
        'SELECT id FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2 AND invoice_number=$3',
        [tenant, facility, `INV-A-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date)
      VALUES($1,$2,'Cash','NaN','Synthetic Invalid Amount','2026-04-04 08:00')`,
      [invoiceId, `REC-INVALID-${suffix}`],
    );
    const response = await generate('cashier-receipts', { search: 'Invalid Amount' });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.rows[0].amount).toBeNull();
    expect(response.body.rows[0].unknownAmounts).toBe(1);
    expect(response.body.summaries[0].value).toBeNull();
    expect(response.body.notes.join(' ')).toContain('invalid or unknown payment amounts');
    await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date)
      VALUES($1,$2,'Cash',-10,'Synthetic Invalid Amount','2026-04-04 08:00')`,
      [invoiceId, `REC-NEGATIVE-${suffix}`],
    );
    const negative = await generate('cashier-receipts', { search: 'Invalid Amount' });
    expect(negative.body.rows[0].amount).toBeNull();
    expect(negative.body.rows[0].unknownAmounts).toBe(2);
    const invalidInvoice = `INV-NEGATIVE-${suffix}`;
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,balance_amount)
      VALUES($1,$2,$3,$4,-5)`,
      [tenant, facility, patient, invalidInvoice],
    );
    const invalidBalance = await generate('invoice-balances', { search: invalidInvoice });
    expect(invalidBalance.body.total).toBe(1);
    expect(invalidBalance.body.rows[0].balance).toBeNull();
    expect(invalidBalance.body.summaries[0].value).toBeNull();
    expect(invalidBalance.body.notes.join(' ')).toContain('invalid/unknown balance');
    expect((await generate('laboratory-orders', { search: '%' })).body.total).toBe(0);
  });

  it('enforces modules and filter validation server-side', async () => {
    expect((await generate('laboratory-orders', { staffId: actor })).status).toBe(400);
    expect((await generate('outpatient-encounters', { departmentId: '1 OR 1=1' })).status).toBe(
      400,
    );
    expect((await generate('laboratory-orders', { status: 'made-up' })).status).toBe(400);
    await pool.query('UPDATE facilities SET hidden_modules=\'["laboratory"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    try {
      expect((await generate('laboratory-orders')).status).toBe(403);
    } finally {
      await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
    }
  });

  it('paginates a larger result without duplicate or cross-facility orders', async () => {
    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
      SELECT $1,$2,$3,'Synthetic Bulk ' || n,'Ordered','2026-05-01 10:00' FROM generate_series(1,103) n`,
      [tenant, facility, patient],
    );
    const first = await generate('laboratory-orders', {
      search: 'Synthetic Bulk',
      limit: 100,
      offset: 0,
    });
    const second = await generate('laboratory-orders', {
      search: 'Synthetic Bulk',
      limit: 100,
      offset: 100,
    });
    expect(first.body.total).toBe(103);
    expect(first.body.rows.length).toBe(100);
    expect(second.body.rows.length).toBe(3);
    const ids = [...first.body.rows, ...second.body.rows].map(
      (r: { orderId: number }) => r.orderId,
    );
    expect(new Set(ids).size).toBe(103);
  });
});
