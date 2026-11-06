/** Only synthetic data, real authenticated HTTP and a brand-new isolated local PostgreSQL. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Report selection and filtered exports (synthetic PostgreSQL and real HTTP)', () => {
  const suffix = randomUUID().slice(0, 8);
  const modules = [
    'analytics',
    'inventory',
    'procurement',
    'opd',
    'inpatient',
    'laboratory',
    'radiology',
    'pharmacy',
    'finance',
    'registration',
    'accounting',
  ];
  const grants = [
    'reports.read',
    'reports.export',
    'inventory.read',
    'procurement.read',
    'clinical.read',
    'patients.read',
    'inpatient.read',
    'laboratory.read',
    'pharmacy.read',
    'billing.read',
    'users.read',
    'accounting.read',
    'accounting.reports.export',
  ];
  let tenant: number,
    otherTenant: number,
    facility: number,
    sibling: number,
    foreignFacility: number;
  let patient: number, patient2: number, siblingPatient: number, foreignPatient: number;
  let department: number, otherDepartment: number, siblingDepartment: number, actor: number;
  let ward: number,
    otherWard: number,
    siblingWard: number,
    bed: number,
    otherBed: number,
    siblingBed: number;
  let item: number,
    item2: number,
    siblingItem: number,
    supplier: number,
    supplier2: number,
    order: number,
    order2: number;
  let labTest: number, labService: number, radService: number, siblingService: number;
  let invoice: number, paidInvoice: number, siblingInvoice: number, receipt: number;
  let cashAccount: number, revenueAccount: number, siblingAccount: number;
  let full: string,
    reportsOnly: string,
    noUsers: string,
    noStock: string,
    noPatients: string,
    noExport: string,
    tenantAccount: string,
    superAccount: string;
  let base: string, close: () => Promise<void>;

  async function user(
    tag: string,
    permissions: string[],
    tenantId: number | null = tenant,
    facilityId: number | null = facility,
    superAdmin = false,
  ) {
    const [row] = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id,designation)
       VALUES($1,$1,$2,$3,'synthetic-only','ACTIVE',$4,$5,'Synthetic role') RETURNING id`,
        [
          `select-${tag}-${suffix}`,
          `select-${tag}-${suffix}@example.test`,
          `Synthetic ${tag} Staff`,
          tenantId,
          facilityId,
        ],
      )
    ).rows;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenantId, superAdmin ? 'SUPER_ADMIN' : `SELECT_${tag}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [row.id, role]);
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
    return {
      id: row.id as number,
      token: (await createSession({ userId: row.id, securityVersion: 1 })).sessionToken,
    };
  }
  const call = (id: string, path: string, body: Record<string, unknown> = {}, token = full) =>
    httpJson(base, 'POST', `/api/reporting/centre/${id}/${path}`, {
      token,
      body: { facilityId: facility, ...body },
    });
  const options = (id: string, kind: string, extra: Record<string, unknown> = {}, token = full) =>
    call(id, 'options', { kind, ...extra }, token);
  const generate = (id: string, extra: Record<string, unknown> = {}, token = full) =>
    call(id, 'generate', extra, token);
  const exp = (
    id: string,
    format: 'pdf' | 'xlsx' | 'csv',
    extra: Record<string, unknown> = {},
    token = full,
  ) => call(id, 'export', { ...extra, format }, token);

  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('synthetic') ||
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    )
      throw new Error('An isolated loopback synthetic test database is required.');
    [tenant, otherTenant] = (
      await pool.query(
        'INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$5),($3,$4,$5) RETURNING id',
        [
          `Synthetic selection ${suffix}`,
          `selection-${suffix}`,
          `Synthetic other ${suffix}`,
          `selection-other-${suffix}`,
          'KES',
        ],
      )
    ).rows.map((r) => r.id);
    [facility, sibling, foreignFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
       ($1,$3,'Synthetic Selector Facility',$6::jsonb),($1,$4,'Synthetic Selector Sibling',$6::jsonb),($2,$5,'Synthetic Selector Foreign',$6::jsonb) RETURNING id`,
        [
          tenant,
          otherTenant,
          `SA-${suffix}`,
          `SB-${suffix}`,
          `SC-${suffix}`,
          JSON.stringify(modules),
        ],
      )
    ).rows.map((r) => r.id);
    [patient, patient2, siblingPatient, foreignPatient] = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,phone,created_at) VALUES
       ($1,$3,$6,'Synthetic','Alice','2000-01-01','Other','0700000001','2026-04-01'),
       ($1,$3,$7,'Synthetic','Betty','2000-01-01','Other',NULL,'2026-04-02'),
       ($1,$4,$8,'Synthetic','SiblingPrivate','2000-01-01','Other',NULL,'2026-04-01'),
       ($2,$5,$9,'Synthetic','ForeignPrivate','2000-01-01','Other',NULL,'2026-04-01') RETURNING id`,
        [
          tenant,
          otherTenant,
          facility,
          sibling,
          foreignFacility,
          `MRNA-${suffix}`,
          `MRNB-${suffix}`,
          `MRNS-${suffix}`,
          `MRNF-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       SELECT $1,$2,$3 || n::text,'Synthetic','PagePatient','2000-01-01','Other' FROM generate_series(1,23) n`,
      [tenant, facility, `PAGE-${suffix}-`],
    );
    const admin = await user('full', grants);
    actor = admin.id;
    full = admin.token;
    reportsOnly = (await user('reports', ['reports.read'])).token;
    noUsers = (
      await user(
        'nousers',
        grants.filter((code) => code !== 'users.read'),
      )
    ).token;
    noStock = (
      await user(
        'nostock',
        grants.filter((code) => code !== 'inventory.read'),
      )
    ).token;
    noPatients = (
      await user(
        'nopatients',
        grants.filter((code) => code !== 'patients.read'),
      )
    ).token;
    noExport = (
      await user(
        'noexport',
        grants.filter((code) => code !== 'reports.export'),
      )
    ).token;
    tenantAccount = (await user('tenant', grants, tenant, null)).token;
    superAccount = (await user('super', grants, null, null, true)).token;
    [department, otherDepartment, siblingDepartment] = (
      await pool.query(
        `INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic OPD',$3),($1,'Synthetic Clinic Two',$4),($2,'SiblingPrivate Department',$5) RETURNING id`,
        [facility, sibling, `D1-${suffix}`, `D2-${suffix}`, `DS-${suffix}`],
      )
    ).rows.map((r) => r.id);
    const practitioner = (
      await pool.query(
        `INSERT INTO practitioners(tenant_id,facility_id,user_id,full_name,profession,registration_number,department_id)
       VALUES($1,$2,$3,'Synthetic Clinician','Clinician','SYN-REG',$4) RETURNING id`,
        [tenant, facility, actor, department],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id,encounter_type,status,started_at) VALUES
       ($1,$2,$3,$5,$6,'OUTPATIENT','COMPLETED','2026-04-01 08:00'),
       ($1,$2,$4,$5,$7,'OUTPATIENT','ACTIVE','2026-04-02 08:00')`,
      [tenant, facility, patient, patient2, practitioner, department, otherDepartment],
    );
    [ward, otherWard, siblingWard] = (
      await pool.query(
        `INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic Ward One',$3),($1,'Synthetic Ward Two',$4),($2,'SiblingPrivate Ward',$5) RETURNING id`,
        [facility, sibling, `W1-${suffix}`, `W2-${suffix}`, `WS-${suffix}`],
      )
    ).rows.map((r) => r.id);
    [bed, otherBed, siblingBed] = (
      await pool.query(
        `INSERT INTO beds(ward_id,bed_number,status) VALUES($1,'A1','Occupied'),($2,'B1','Reserved'),($3,'C1','Available') RETURNING id`,
        [ward, otherWard, siblingWard],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status,discharge_date) VALUES
       ($1,$2,$3,$5,$6,'2026-04-01 09:00','Admitted',NULL),
       ($1,$2,$4,$7,$8,'2026-04-02 09:00','Discharged','2026-04-03 09:00')`,
      [tenant, facility, patient, patient2, ward, bed, otherWard, otherBed],
    );
    [item, item2, siblingItem] = (
      await pool.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,category,unit,current_stock,reorder_level) VALUES
       ($1,$3,'Synthetic Medicine Alpha','Medicine','Tablets',7,2),($1,$4,'=SYNTHETICFORMULA','Supplies','Pieces',4,1),($2,$5,'SiblingPrivate Item','Medicine','Tablets',999,1) RETURNING id`,
        [facility, sibling, `IT1-${suffix}`, `IT2-${suffix}`, `ITS-${suffix}`],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,'BATCH-A','2026-04-30',7),($2,'BATCH-B','2026-04-30',4),($3,'BATCH-S','2026-04-30',999)`,
      [item, item2, siblingItem],
    );
    [supplier, supplier2] = (
      await pool.query(
        `INSERT INTO suppliers(tenant_id,name) VALUES($1,'Synthetic Supplier Alpha'),($1,'Synthetic Supplier Beta') RETURNING id`,
        [tenant],
      )
    ).rows.map((r) => r.id);
    [order, order2] = (
      await pool.query(
        `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status,expected_delivery_date) VALUES
       ($1,$2,$4,$6,120.50,'Approved','2026-04-20'),($1,$2,$5,$7,85.00,'Pending Approval','2026-04-21'),($1,$3,$4,$8,999.00,'Approved','2026-04-20') RETURNING id`,
        [
          tenant,
          facility,
          sibling,
          supplier,
          supplier2,
          `POA-${suffix}`,
          `POB-${suffix}`,
          `POS-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    labTest = (
      await pool.query(
        `INSERT INTO lab_tests(facility_id,code,name,category,specimen_type) VALUES($1,$2,'Synthetic Lab Test','Chemistry','LEGACY-UNREVIEWED') RETURNING id`,
        [facility, `LT-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO lab_test_specimen_options(tenant_id,facility_id,test_id,specimen_type,review_reference,created_by_user_id) VALUES($1,$2,$3,'Reviewed serum','SYNTHETIC-REVIEW',$4)`,
      [tenant, facility, labTest, actor],
    );
    [labService, radService, siblingService] = (
      await pool.query(
        `INSERT INTO facility_services(tenant_id,facility_id,code,name,description,department,category,unit,is_active) VALUES
       ($1,$2,$4,'Synthetic Lab Service','Synthetic','Laboratory','LABORATORY','Test',true),
       ($1,$2,$5,'Synthetic Radiology Service','Synthetic','Radiology','RADIOLOGY','Scan',true),
       ($1,$3,$6,'SiblingPrivate Service','Synthetic','Laboratory','LABORATORY','Test',true) RETURNING id`,
        [
          tenant,
          facility,
          sibling,
          `LAB-${suffix}`.toUpperCase(),
          `RAD-${suffix}`.toUpperCase(),
          `LABS-${suffix}`.toUpperCase(),
        ],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_id,facility_service_id,test_name,specimen_type,status,ordered_at) VALUES
       ($1,$2,$3,$5,$6,'Synthetic Lab Order','Reviewed serum','Ordered','2026-04-01 10:00'),
       ($1,$2,$4,NULL,NULL,'Unlinked historical lab',NULL,'Ordered','2026-04-02 10:00')`,
      [tenant, facility, patient, patient2, labTest, labService],
    );
    await pool.query(
      `INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,facility_service_id,modality,procedure_name,status,created_at) VALUES
       ($1,$2,$3,$5,'X-ray','Synthetic Radiology Procedure','Requested','2026-04-01 11:00'),
       ($1,$2,$4,NULL,'X-ray','Unlinked historical imaging','Requested','2026-04-02 11:00')`,
      [tenant, facility, patient, patient2, radService],
    );
    await pool.query(
      `INSERT INTO pharmacy_dispensations(tenant_id,facility_id,patient_id,item_id,item_code_snapshot,item_name_snapshot,item_unit_snapshot,quantity_dispensed,dispensed_by,dispensed_at) VALUES
       ($1,$2,$3,$5,$7,'Synthetic Medicine Alpha','Tablets',3,'Synthetic Staff','2026-04-01 12:00'),
       ($1,$2,$4,$6,$8,'Synthetic Supply','Pieces',2,'Synthetic Staff','2026-04-02 12:00')`,
      [tenant, facility, patient, patient2, item, item2, `IT1-${suffix}`, `IT2-${suffix}`],
    );
    [invoice, paidInvoice, siblingInvoice] = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,created_at) VALUES
       ($1,$2,$4,$7,120.50,20.00,100.50,'Partial','2026-04-01 08:00'),
       ($1,$2,$5,$8,50.00,50.00,0.00,'Paid','2026-04-02 08:00'),
       ($1,$3,$6,$9,999.00,0,999.00,'Pending','2026-04-01 08:00') RETURNING id`,
        [
          tenant,
          facility,
          sibling,
          patient,
          patient2,
          siblingPatient,
          `INVA-${suffix}`,
          `INVB-${suffix}`,
          `INVS-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    receipt = (
      await pool.query(
        `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES($1,$2,'Cash',20.00,'Synthetic Cashier','2026-04-01 13:00') RETURNING id`,
        [invoice, `REC-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO billing_refunds(tenant_id,facility_id,invoice_id,payment_id,refund_number,amount,refund_method,reason,manual_confirmation,idempotency_key,request_hash,actor_user_id,created_at)
       VALUES($1,$2,$3,$4,$5,5.00,'CASH','Synthetic',true,$6,'synthetic',$7,'2026-04-01 14:00')`,
      [tenant, facility, invoice, receipt, `REF-${suffix}`, `KEY-${suffix}`, actor],
    );
    const period = (
      await pool.query(
        `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,'2026','Synthetic period','2026-01-01','2026-12-31','OPEN') RETURNING id`,
        [tenant, facility],
      )
    ).rows[0].id;
    [cashAccount, revenueAccount, siblingAccount] = (
      await pool.query(
        `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance) VALUES
       ($1,$2,'1100','Synthetic Selector Cash','ASSET','SYNTHETIC','DEBIT'),
       ($1,$2,'4000','Synthetic Selector Revenue','REVENUE','SYNTHETIC','CREDIT'),
       ($1,$3,'9999','SiblingPrivate Account','ASSET','SYNTHETIC','DEBIT') RETURNING id`,
        [tenant, facility, sibling],
      )
    ).rows.map((r) => r.id);
    const ledger = await pool.connect();
    try {
      await ledger.query('BEGIN');
      const journal = (
        await ledger.query(
          `INSERT INTO journal_entries(tenant_id,facility_id,period_id,journal_number,entry_date,source_type,idempotency_key,request_hash,description,status,total_debit_cents,total_credit_cents,posted_by_user_id)
         VALUES($1,$2,$3,$4,'2026-04-01','MANUAL',$5,'synthetic','Synthetic journal','DRAFT',12010,12010,$6) RETURNING id`,
          [tenant, facility, period, `SEL-J-${suffix}`, `sel-ledger-${suffix}`, actor],
        )
      ).rows[0].id;
      await ledger.query(
        `INSERT INTO journal_lines(journal_entry_id,account_id,debit_cents,credit_cents) VALUES($1,$2,12010,0),($1,$3,0,12010)`,
        [journal, cashAccount, revenueAccount],
      );
      await ledger.query("UPDATE journal_entries SET status='POSTED' WHERE id=$1", [journal]);
      await ledger.query('COMMIT');
    } catch (error) {
      await ledger.query('ROLLBACK');
      throw error;
    } finally {
      ledger.release();
    }
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('browses real scoped patients on the first page, searches literally, paginates and audits only visible patients', async () => {
    const first = await options('patient-registrations', 'patient');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('no-store');
    expect(first.body.options).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain('SiblingPrivate');
    const second = await options('patient-registrations', 'patient', { offset: 20 });
    expect(second.body.options).toHaveLength(5);
    expect(second.body.hasMore).toBe(false);
    expect(
      new Set([...first.body.options, ...second.body.options].map((o: { id: number }) => o.id))
        .size,
    ).toBe(25);
    const found = await options('patient-registrations', 'patient', { search: 'Alice' });
    expect(found.body.options[0]).toMatchObject({
      id: patient,
      label: expect.stringContaining('Synthetic Alice'),
      detail: expect.stringContaining('0700000001'),
    });
    expect(
      (await options('patient-registrations', 'patient', { search: '%' })).body.options,
    ).toEqual([]);
    const log = await pool.query(
      "SELECT patient_id FROM patient_record_access_logs WHERE user_id=$1 AND record_type='REPORT_SELECTION'",
      [actor],
    );
    expect(log.rows.some((r) => r.patient_id === patient)).toBe(true);
    expect(
      log.rows.some((r) => r.patient_id === siblingPatient || r.patient_id === foreignPatient),
    ).toBe(false);
    const audit = await pool.query(
      "SELECT details FROM audit_logs WHERE user_id=$1 AND resource='report_selection'",
      [String(actor)],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('Alice');
    expect(JSON.stringify(audit.rows)).not.toContain('0700000001');
  });

  it('enforces report, extra directory/inventory, facility and tenant permissions and rejects malformed dependencies', async () => {
    expect((await options('patient-registrations', 'patient', {}, reportsOnly)).status).toBe(403);
    expect((await options('patient-registrations', 'patient', {}, noPatients)).status).toBe(403);
    expect((await options('cashier-receipts', 'receipt', {}, noPatients)).status).toBe(403);
    expect((await generate('cashier-receipts', { receiptId: receipt }, noPatients)).status).toBe(
      403,
    );
    expect((await options('outpatient-encounters', 'staff', {}, noUsers)).status).toBe(403);
    expect((await generate('outpatient-encounters', { staffId: actor }, noUsers)).status).toBe(403);
    expect((await options('pharmacy-dispensations', 'item', {}, noStock)).status).toBe(403);
    expect((await options('invoice-document', 'invoice', {}, noExport)).status).toBe(403);
    expect((await options('invoice-document', 'invoice', {}, superAccount)).status).toBe(403);
    expect((await options('inventory-category', 'item', { facilityId: sibling })).status).toBe(403);
    expect(
      (await options('inventory-category', 'item', { facilityId: foreignFacility }, tenantAccount))
        .status,
    ).toBe(403);
    expect(
      (await options('inventory-category', 'item', { facilityId: sibling }, tenantAccount)).status,
    ).toBe(200);
    expect((await options('unknown-report', 'patient')).status).toBe(404);
    expect((await options('ledger-income', 'patient')).status).toBe(400);
    expect((await options('current-inpatients', 'bed', { wardId: siblingWard })).status).toBe(400);
    expect(
      (await options('outpatient-encounters', 'staff', { departmentId: siblingDepartment })).status,
    ).toBe(400);
    expect((await options('inventory-category', 'item', { limit: 26 })).status).toBe(400);
    expect((await options('inventory-category', 'item', { search: 'x'.repeat(81) })).status).toBe(
      400,
    );
    expect((await options('inventory-category', 'item', { unexpected: 'x' })).status).toBe(400);
    expect((await generate('inventory-category', { itemIds: [item, item] })).status).toBe(400);
    expect((await generate('inventory-category', { itemIds: Array(21).fill(item) })).status).toBe(
      400,
    );
    expect((await generate('inventory-category', { itemIds: [siblingItem] })).status).toBe(400);
    expect((await generate('current-inpatients', { patientId: siblingPatient })).status).toBe(400);
    expect((await generate('current-inpatients', { wardId: ward, bedId: otherBed })).status).toBe(
      400,
    );
    expect(
      (await generate('purchase-orders', { supplierId: supplier, purchaseOrderId: order2 })).status,
    ).toBe(400);
    expect((await generate('laboratory-orders', { serviceIds: [siblingService] })).status).toBe(
      400,
    );
    expect((await generate('invoice-balances', { invoiceId: siblingInvoice })).status).toBe(400);
    expect((await generate('ledger-income', { accountIds: [cashAccount] })).status).toBe(400);
    expect(
      (await generate('ledger-trial-movements', { accountIds: [siblingAccount] })).status,
    ).toBe(400);
    await pool.query('UPDATE facilities SET hidden_modules=\'["inventory"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    try {
      expect((await options('inventory-category', 'item')).status).toBe(403);
    } finally {
      await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
    }
  });

  it('offers actual ward/bed, staff/department, item, supplier/order and reviewed lab/service choices with dependent refresh', async () => {
    const beds = await options('current-inpatients', 'bed', { wardId: ward });
    expect(beds.body.options).toEqual([
      expect.objectContaining({
        id: bed,
        label: expect.stringContaining('A1'),
        detail: expect.stringContaining('Occupied'),
      }),
    ]);
    expect(
      (await options('current-inpatients', 'bed', { wardId: otherWard })).body.options[0],
    ).toMatchObject({ id: otherBed, detail: expect.stringContaining('Reserved') });
    const staff = await options('outpatient-encounters', 'staff', { departmentId: department });
    expect(staff.body.options).toEqual([
      expect.objectContaining({
        id: actor,
        label: 'Synthetic Clinician',
        detail: expect.stringContaining('SYN-REG'),
      }),
    ]);
    // Historical encounters in another department remain discoverable after staff move.
    expect(
      (await options('outpatient-encounters', 'staff', { departmentId: otherDepartment })).body
        .options[0].id,
    ).toBe(actor);
    const items = await options('inventory-category', 'item');
    expect(items.body.options.find((o: { id: number }) => o.id === item)).toMatchObject({
      detail: expect.stringMatching(/Stock: 7 Tablets.*Reorder: 2/),
    });
    expect(items.body.options.some((o: { id: number }) => o.id === siblingItem)).toBe(false);
    expect(
      (await options('purchase-orders', 'purchaseOrder', { supplierId: supplier })).body.options,
    ).toEqual([
      expect.objectContaining({
        id: order,
        label: expect.stringContaining('Synthetic Supplier Alpha'),
      }),
    ]);
    const lab = await options('laboratory-orders', 'labTest');
    expect(lab.body.options[0]).toMatchObject({
      id: labTest,
      detail: expect.stringContaining('Reviewed serum'),
    });
    expect(lab.body.options[0].detail).not.toContain('LEGACY-UNREVIEWED');
    expect((await options('laboratory-orders', 'service')).body.options).toEqual([
      expect.objectContaining({ id: labService }),
    ]);
    expect((await options('radiology-requests', 'service')).body.options).toEqual([
      expect.objectContaining({ id: radService }),
    ]);
    expect((await options('cashier-receipts', 'receipt')).body.options).toEqual([
      expect.objectContaining({
        id: receipt,
        label: expect.stringContaining('Synthetic Alice'),
        detail: expect.stringContaining('20.00'),
      }),
    ]);
    expect((await options('ledger-income', 'account')).body.options).toEqual([
      expect.objectContaining({
        id: revenueAccount,
        label: expect.stringContaining('Synthetic Selector Revenue'),
      }),
    ]);
    expect(
      (await options('ledger-trial-movements', 'account')).body.options.map(
        (o: { id: number }) => o.id,
      ),
    ).not.toContain(siblingAccount);
  });

  it('browses invoices with actual amounts, defaults to outstanding when requested and permits all statuses', async () => {
    const open = await options('invoice-balances', 'invoice', { invoiceStatus: 'outstanding' });
    expect(open.body.options).toEqual([
      expect.objectContaining({
        id: invoice,
        label: expect.stringContaining('Synthetic Alice'),
        detail: expect.stringMatching(/Total: 120.50.*Paid: 20.00.*Balance: 100.50.*Partial/),
      }),
    ]);
    const all = await options('invoice-balances', 'invoice', { invoiceStatus: 'all' });
    expect(all.body.options.map((o: { id: number }) => o.id)).toContain(paidInvoice);
    expect(all.body.options.map((o: { id: number }) => o.id)).not.toContain(siblingInvoice);
    expect(
      (await options('invoice-balances', 'invoice', { patientId: patient, invoiceStatus: 'all' }))
        .body.options,
    ).toHaveLength(1);
    expect(
      (await options('invoice-balances', 'invoice', { patientId: siblingPatient })).status,
    ).toBe(400);
    expect(
      (await options('invoice-document', 'invoice', { invoiceStatus: 'all' })).body.options,
    ).toHaveLength(2);
  });

  const cases = () => [
    {
      id: 'inventory-category',
      filter: { itemIds: [item, item2], status: 'active' },
      total: 2,
      label: 'Synthetic Medicine Alpha',
    },
    {
      id: 'inventory-store',
      filter: { itemIds: [item] },
      total: 1,
      label: 'Synthetic Medicine Alpha',
    },
    {
      id: 'inventory-expiry',
      filter: { itemIds: [item, item2], from: '2026-04-30', to: '2026-04-30' },
      total: 2,
      label: 'Synthetic Medicine Alpha',
    },
    {
      id: 'purchase-orders',
      filter: {
        supplierId: supplier,
        purchaseOrderId: order,
        from: '2026-04-01',
        to: '2026-04-30',
        status: 'Approved',
      },
      total: 1,
      label: 'Synthetic Supplier Alpha',
    },
    {
      id: 'current-inpatients',
      filter: { patientId: patient, wardId: ward, bedId: bed },
      total: 1,
      label: 'Synthetic Alice',
    },
    {
      id: 'patient-registrations',
      filter: { patientId: patient, from: '2026-04-01', to: '2026-04-01' },
      total: 1,
      label: 'Synthetic Alice',
    },
    {
      id: 'outpatient-encounters',
      filter: {
        patientId: patient,
        departmentId: department,
        staffId: actor,
        status: 'COMPLETED',
        from: '2026-04-01',
        to: '2026-04-01',
      },
      total: 1,
      label: 'Synthetic Clinician',
    },
    {
      id: 'inpatient-admissions',
      filter: {
        patientId: patient,
        wardId: ward,
        bedId: bed,
        from: '2026-04-01',
        to: '2026-04-01',
      },
      total: 1,
      label: 'Synthetic Alice',
    },
    {
      id: 'inpatient-discharges',
      filter: {
        patientId: patient2,
        wardId: otherWard,
        bedId: otherBed,
        from: '2026-04-03',
        to: '2026-04-03',
      },
      total: 1,
      label: 'Synthetic Betty',
    },
    {
      id: 'laboratory-orders',
      filter: {
        patientId: patient,
        labTestId: labTest,
        serviceIds: [labService],
        status: 'Ordered',
        from: '2026-04-01',
        to: '2026-04-01',
      },
      total: 1,
      label: 'Synthetic Lab Service',
    },
    {
      id: 'radiology-requests',
      filter: {
        patientId: patient,
        serviceIds: [radService],
        status: 'Requested',
        from: '2026-04-01',
        to: '2026-04-01',
      },
      total: 1,
      label: 'Synthetic Radiology Service',
    },
    {
      id: 'pharmacy-dispensations',
      filter: { patientId: patient, itemIds: [item], from: '2026-04-01', to: '2026-04-01' },
      total: 1,
      label: 'Synthetic Medicine Alpha',
    },
    {
      id: 'cashier-receipts',
      filter: {
        receiptId: receipt,
        search: 'Synthetic Cashier',
        from: '2026-04-01',
        to: '2026-04-01',
      },
      total: 1,
      label: `REC-${suffix}`,
    },
    {
      id: 'ledger-trial-movements',
      filter: { accountIds: [cashAccount], from: '2026-04-01', to: '2026-04-30' },
      total: 1,
      label: 'Synthetic Selector Cash',
    },
    {
      id: 'ledger-income',
      filter: { accountIds: [revenueAccount], from: '2026-04-01', to: '2026-04-30' },
      total: 1,
      label: 'Synthetic Selector Revenue',
    },
    {
      id: 'ledger-balance-sheet',
      filter: { accountIds: [cashAccount, revenueAccount], to: '2026-04-30' },
      total: 2,
      label: 'Synthetic Selector Cash',
    },
    {
      id: 'recorded-refunds',
      filter: { staffId: actor, from: '2026-04-01', to: '2026-04-01' },
      total: 1,
      label: 'Synthetic full Staff',
    },
    {
      id: 'invoice-balances',
      filter: { patientId: patient, invoiceId: invoice, from: '2026-04-01', to: '2026-04-01' },
      total: 1,
      label: `INVA-${suffix}`,
    },
  ];
  it('runs every upgraded engine with combined scoped selections, all/clear, print and PDF/Excel/CSV exports', async () => {
    for (const test of cases()) {
      const view = await generate(test.id, test.filter);
      expect(view.status, test.id).toBe(200);
      expect(view.body.total, test.id).toBe(test.total);
      expect(JSON.stringify(view.body.filterLabels), test.id).toContain(test.label);
      expect(JSON.stringify(view.body), test.id).not.toContain('SiblingPrivate');
      const printed = await generate(test.id, { ...test.filter, intent: 'print' });
      expect(printed.status, test.id).toBe(200);
      expect(printed.body.total, test.id).toBe(test.total);
      const all = await generate(
        test.id,
        test.id === 'ledger-balance-sheet' ? { to: '2026-04-30' } : {},
      );
      expect(all.status, test.id).toBe(200);
      expect(all.body.total, test.id).toBeGreaterThanOrEqual(test.total);
      for (const format of ['pdf', 'xlsx', 'csv'] as const) {
        const file = await exp(test.id, format, test.filter);
        expect(file.status, `${test.id} ${format}`).toBe(200);
        const bytes = Buffer.from(file.body.base64, 'base64');
        if (format === 'pdf') expect(bytes.subarray(0, 5).toString(), test.id).toBe('%PDF-');
        if (format === 'xlsx') {
          expect(bytes.subarray(0, 2).toString(), test.id).toBe('PK');
          const archive = unzipSync(bytes);
          const xml = Object.entries(archive)
            .filter(([name]) => name.endsWith('.xml'))
            .map(([, data]) => strFromU8(data))
            .join('\n');
          expect(xml, test.id).toContain(test.label);
          expect(xml, test.id).not.toMatch(/<f[ >]/);
        }
        if (format === 'csv') expect(bytes.toString('utf8'), test.id).toContain(test.label);
      }
    }
  }, 120000);

  it('preserves exact filtered financial subtotals and makes CSV spreadsheet-formula-safe', async () => {
    const balance = await generate('invoice-balances', { patientId: patient, invoiceId: invoice });
    expect(balance.body.summaries).toEqual([expect.objectContaining({ value: '100.50' })]);
    const receipts = await generate('cashier-receipts', { receiptId: receipt });
    expect(receipts.body.summaries).toEqual([expect.objectContaining({ value: '20.00' })]);
    const ledger = await generate('ledger-trial-movements', {
      accountIds: [cashAccount],
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(ledger.body.summaries.map((summary: { value: string }) => summary.value)).toEqual([
      '120.10',
      '0.00',
    ]);
    const refunds = await generate('recorded-refunds', { staffId: actor });
    expect(refunds.body.summaries).toEqual([expect.objectContaining({ value: '5.00' })]);
    const all = await generate('inventory-category', { itemIds: [item, item2] });
    const one = await generate('inventory-category', { itemIds: [item] });
    expect(all.body.total).toBe(2);
    expect(one.body.total).toBe(1);
    const csv = await exp('inventory-category', 'csv', { itemIds: [item2] });
    expect(Buffer.from(csv.body.base64, 'base64').toString('utf8')).toContain("'=SYNTHETICFORMULA");
    expect(csv.body.contentType).toContain('text/csv');
    expect((await exp('inventory-category', 'csv', {}, noExport)).status).toBe(403);
    for (const [id, filter] of [
      ['cashier-receipts', {}],
      ['ledger-trial-movements', {}],
      ['ledger-income', {}],
      ['ledger-balance-sheet', { to: '2026-04-30' }],
    ] as const) {
      expect((await exp(id, 'csv', filter)).status, id).toBe(200);
    }
  });

  it('fails closed if the patient option audit cannot be written', async () => {
    const func = `synthetic_selector_audit_${suffix.replace(/-/g, '')}`;
    const trigger = `${func}_trg`;
    await pool.query(
      `CREATE FUNCTION ${func}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.record_type='REPORT_SELECTION' AND NEW.user_id=${actor} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON patient_record_access_logs FOR EACH ROW EXECUTE FUNCTION ${func}()`,
    );
    try {
      expect((await options('patient-registrations', 'patient', { search: 'Alice' })).status).toBe(
        500,
      );
      expect((await generate('patient-registrations', { patientId: patient })).status).toBe(500);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON patient_record_access_logs`);
      await pool.query(`DROP FUNCTION ${func}()`);
    }
  });
});
