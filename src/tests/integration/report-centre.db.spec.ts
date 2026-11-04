/** Real authenticated HTTP + isolated synthetic PostgreSQL tests. No real patients or facilities. */
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import PDFParser from 'pdf2json';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { generateReport } from '../../reporting/report-centre.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Reporting Centre (synthetic PostgreSQL and real HTTP)', () => {
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  const modules = [
    'analytics',
    'inventory',
    'procurement',
    'inpatient',
    'finance',
    'registration',
    'reception',
    'theatre',
    'laboratory',
  ];
  const grants = [
    'reports.read',
    'reports.export',
    'inventory.read',
    'procurement.read',
    'inpatient.read',
    'patients.read',
    'billing.read',
    'clinical.read',
  ];
  let tenant: number,
    otherTenant: number,
    facility: number,
    sibling: number,
    foreignFacility: number;
  let patient: number,
    siblingPatient: number,
    foreignPatient: number,
    ward: number,
    actorId: number;
  let token: string,
    noExport: string,
    reportsOnly: string,
    noPatients: string,
    tenantToken: string,
    superToken: string;
  let base: string, close: () => Promise<void>;
  const call = (path: string, body: Record<string, unknown>, auth = token) =>
    httpJson(base, 'POST', `/api/reporting/centre/${path}`, { token: auth, body });
  const generate = (id: string, body: Record<string, unknown> = {}, auth = token) =>
    call(`${id}/generate`, { facilityId: facility, ...body }, auth);
  const exp = (id: string, format: string, body: Record<string, unknown> = {}, auth = token) =>
    call(`${id}/export`, { facilityId: facility, format, ...body }, auth);

  async function user(
    tag: string,
    tenantId: number | null,
    facilityId: number | null,
    permissions: string[],
    superAdmin = false,
  ) {
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic report actor','test-only','ACTIVE',$3,$4) RETURNING id",
        [`rc-${tag}-${suffix}`, `rc-${tag}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenantId, superAdmin ? 'SUPER_ADMIN' : `RC_${tag}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const permission of permissions) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'reports') ON CONFLICT(code) DO NOTHING",
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, permission],
      );
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }

  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('synthetic') ||
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    ) {
      throw new Error('A new isolated local synthetic test database is required.');
    }
    const tenants = await pool.query(
      'INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$5),($3,$4,$5) RETURNING id',
      [
        `Reporting synthetic ${suffix}`,
        `rc-${suffix}`,
        `Other reporting synthetic ${suffix}`,
        `rc-other-${suffix}`,
        'KES',
      ],
    );
    [tenant, otherTenant] = tenants.rows.map((row) => row.id);
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
      ($1,$3,'Synthetic Reporting Facility',$6::jsonb),($1,$4,'Synthetic Sibling Facility',$6::jsonb),($2,$5,'Synthetic Foreign Facility',$6::jsonb) RETURNING id`,
      [
        tenant,
        otherTenant,
        `RA-${suffix}`,
        `RB-${suffix}`,
        `RC-${suffix}`,
        JSON.stringify(modules),
      ],
    );
    [facility, sibling, foreignFacility] = facilities.rows.map((row) => row.id);
    const people = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES
      ($1,$3,$6,'Synthetic','Gathũri','2000-01-01','Other'),
      ($1,$4,$7,'Synthetic','SiblingPrivate','2000-01-01','Other'),
      ($2,$5,$8,'Synthetic','ForeignPrivate','2000-01-01','Other') RETURNING id`,
      [
        tenant,
        otherTenant,
        facility,
        sibling,
        foreignFacility,
        `RP-${suffix}`,
        `RS-${suffix}`,
        `RF-${suffix}`,
      ],
    );
    patient = people.rows[0].id;
    siblingPatient = people.rows[1].id;
    foreignPatient = people.rows[2].id;
    const wards = await pool.query(
      "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic Ward A',$3),($2,'Synthetic Ward B',$4) RETURNING id",
      [facility, sibling, `W-A-${suffix}`, `W-B-${suffix}`],
    );
    ward = wards.rows[0].id;
    const siblingWard = wards.rows[1].id;
    const beds = await pool.query(
      "INSERT INTO beds(ward_id,bed_number) VALUES($1,'A1'),($1,'A2'),($1,'A3'),($2,'B1') RETURNING id",
      [ward, siblingWard],
    );
    await pool.query(
      `INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status) VALUES
      ($1,$2,$4,$7,$9,'2026-04-01 10:20','Admitted'),
      ($1,$2,$4,$7,$10,'2026-03-01 10:20','Discharged'),
      ($1,$3,$5,$8,$12,'2026-04-01 10:20','Admitted'),
      ($1,$2,$6,$7,$11,'2026-04-02 11:00','Admitted')`,
      [
        tenant,
        facility,
        sibling,
        patient,
        siblingPatient,
        foreignPatient,
        ward,
        siblingWard,
        ...beds.rows.map((row) => row.id),
      ],
    );
    await pool.query(
      `INSERT INTO inventory_items(facility_id,item_code,name,category,store_location,unit,current_stock,reorder_level,is_active) VALUES
      ($1,$3,'Synthetic Missing','Other',NULL,'Pieces',NULL,NULL,NULL),
      ($1,$4,'=HYPERLINK("https://example.test")','Formula','Main','Pieces',5,1,true),
      ($2,$5,'Synthetic SiblingPrivate','Other','Main','Pieces',999,1,true)`,
      [facility, sibling, `MISSING-${suffix}`, `FORMULA-${suffix}`, `OTHER-${suffix}`],
    );
    await pool.query(
      `INSERT INTO inventory_items(facility_id,item_code,name,category,store_location,unit,current_stock,reorder_level,is_active)
      SELECT $1,$2 || n::text,'BulkSynthetic ' || n::text,'Bulk','Store A','Pieces',n,0,true FROM generate_series(1,1002) n`,
      [facility, `BULK-${suffix}-`],
    );
    const suppliers = await pool.query(
      "INSERT INTO suppliers(tenant_id,name) VALUES($1,'Synthetic Supplier'),($2,'ForeignPrivate Supplier') RETURNING id",
      [tenant, otherTenant],
    );
    await pool.query(
      `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status,expected_delivery_date) VALUES
      ($1,$2,$4,$6,120.50,'Approved','2026-04-01'),
      ($1,$2,$4,$7,NULL,'Pending Approval',NULL),
      ($1,$2,$5,$8,250.75,'Approved','2026-04-30'),
      ($1,$3,$4,$9,999.00,'Approved','2026-04-01')`,
      [
        tenant,
        facility,
        sibling,
        suppliers.rows[0].id,
        suppliers.rows[1].id,
        `PO-A-${suffix}`,
        `PO-B-${suffix}`,
        `PO-C-${suffix}`,
        `PO-X-${suffix}`,
      ],
    );
    const full = await user('full', tenant, facility, grants);
    actorId = full.id;
    token = full.token;
    noExport = (
      await user(
        'noexport',
        tenant,
        facility,
        grants.filter((grant) => grant !== 'reports.export'),
      )
    ).token;
    reportsOnly = (await user('reports', tenant, facility, ['reports.read'])).token;
    noPatients = (
      await user('nopatient', tenant, facility, [
        'reports.read',
        'reports.export',
        'inpatient.read',
      ])
    ).token;
    tenantToken = (await user('tenant', tenant, null, grants)).token;
    superToken = (await user('super', null, null, grants, true)).token;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('requires a session, report and domain permissions, export permission, an allowed facility and a non-platform account', async () => {
    expect(
      (
        await httpJson(base, 'POST', '/api/reporting/centre/inventory-category/generate', {
          body: { facilityId: facility },
        })
      ).status,
    ).toBe(401);
    expect((await generate('inventory-category', {}, reportsOnly)).status).toBe(403);
    expect((await generate('current-inpatients', {}, noPatients)).status).toBe(403);
    expect((await exp('inventory-category', 'xlsx', { search: 'Formula' }, noExport)).status).toBe(
      403,
    );
    expect((await generate('inventory-category', { intent: 'print' }, noExport)).status).toBe(403);
    expect((await generate('inventory-category', { facilityId: sibling })).status).toBe(403);
    expect(
      (await generate('inventory-category', { facilityId: foreignFacility }, tenantToken)).status,
    ).toBe(403);
    expect(
      (await generate('inventory-category', { facilityId: sibling }, tenantToken)).status,
    ).toBe(200);
    expect((await generate('inventory-category', {}, superToken)).status).toBe(403);
    expect((await generate('made-up-report')).status).toBe(404);
  });

  it('rejects disabled and hidden source modules and the hidden reporting module', async () => {
    await pool.query('UPDATE facilities SET hidden_modules=\'["inventory"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    expect((await generate('inventory-category')).body.error).toBe('FACILITY_MODULE_DISABLED');
    await pool.query('UPDATE facilities SET hidden_modules=\'["analytics"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    expect((await generate('current-inpatients')).body.error).toBe('FACILITY_MODULE_DISABLED');
    await pool.query(
      "UPDATE facilities SET hidden_modules='[]'::jsonb,enabled_modules=$2::jsonb WHERE id=$1",
      [facility, JSON.stringify(modules.filter((module) => module !== 'procurement'))],
    );
    expect((await generate('purchase-orders')).body.error).toBe('FACILITY_MODULE_DISABLED');
    await pool.query('UPDATE facilities SET enabled_modules=$2::jsonb WHERE id=$1', [
      facility,
      JSON.stringify(modules),
    ]);
  });

  it('reports accurate facility inventory snapshots, literal search and missing values without inventing zeros', async () => {
    const result = await generate('inventory-category', { search: 'Synthetic Missing' });
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.body.total).toBe(1);
    expect(result.body.rows[0]).toMatchObject({
      code: `MISSING-${suffix}`,
      quantity: null,
      reorderLevel: null,
      store: null,
      status: null,
    });
    expect(result.body.notes.join(' ')).toContain('not a stock movement ledger');
    expect((await generate('inventory-store', { status: 'unknown' })).body.total).toBe(1);
    expect((await generate('inventory-category', { search: '%' })).body.total).toBe(0);
    expect((await generate('inventory-category', { search: 'SiblingPrivate' })).body.total).toBe(0);
    expect(
      (
        await generate('inventory-store', {
          search: 'Missing',
          from: '2026-01-01',
          to: '2026-01-02',
        })
      ).status,
    ).toBe(400);
  });

  it('uses server pagination, stable IDs, bounded all-record exports and explicit validation', async () => {
    const first = await generate('inventory-category', { search: 'BulkSynthetic', limit: 100 });
    const second = await generate('inventory-category', {
      search: 'BulkSynthetic',
      limit: 100,
      offset: 100,
    });
    expect(first.body.total).toBe(1002);
    expect(first.body.rows).toHaveLength(100);
    expect(second.body.rows).toHaveLength(100);
    expect(
      new Set([...first.body.rows, ...second.body.rows].map((row: { code: string }) => row.code))
        .size,
    ).toBe(200);
    const tooBig = await exp('inventory-category', 'xlsx', { search: 'BulkSynthetic' });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe('REPORT_EXPORT_TOO_LARGE');
    for (const body of [
      { limit: 101 },
      { offset: -1 },
      { patientId: 1 },
      { status: 'forged' },
      { department: 'OPD' },
      { search: 'x'.repeat(81) },
    ]) {
      expect((await generate('inventory-category', body)).status).toBe(400);
    }
    expect(
      (await generate('inventory-category', { search: 'no-such-synthetic-value' })).body,
    ).toMatchObject({ rows: [], total: 0 });
  });

  it('uses actual purchase orders and inclusive expected-delivery dates, counts undated exclusions and never shows foreign supplier data', async () => {
    const result = await generate('purchase-orders', { from: '2026-04-01', to: '2026-04-30' });
    expect(result.status).toBe(200);
    expect(result.body.total).toBe(2);
    expect(result.body.rows[0]).toMatchObject({
      number: `PO-A-${suffix}`,
      supplier: 'Synthetic Supplier',
      orderAmount: '120.50',
      expectedDelivery: '2026-04-01',
    });
    expect(result.body.rows[1]).toMatchObject({
      number: `PO-C-${suffix}`,
      supplier: null,
      orderAmount: '250.75',
      expectedDelivery: '2026-04-30',
    });
    expect(result.body.currency).toBe('KES');
    expect(result.body.notes.join(' ')).toContain('1 order(s) without an expected delivery date');
    expect(result.body.notes.join(' ')).toContain('missing or out-of-scope');
    expect(JSON.stringify(result.body)).not.toContain('ForeignPrivate');
    const undated = await generate('purchase-orders', { status: 'Pending Approval' });
    expect(undated.body.rows[0]).toMatchObject({ orderAmount: null, expectedDelivery: null });
    for (const range of [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-01-01' },
      { from: '2025-01-01', to: '2026-03-01' },
      { from: '2026-05-01', to: '2026-04-01' },
    ]) {
      expect((await generate('purchase-orders', range)).status).toBe(400);
    }
  });

  it('returns only admitted patients in the selected facility, filters IDs and writes mandatory privacy-preserving audit logs', async () => {
    const result = await generate('current-inpatients');
    expect(result.status).toBe(200);
    expect(result.body.total).toBe(2); // one correctly scoped patient, one inconsistent linked patient
    expect(result.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mrn: `RP-${suffix}`,
          patient: 'Synthetic Gathũri',
          ward: 'Synthetic Ward A',
          bed: 'A1',
          admissionDate: '2026-04-01 10:20',
        }),
      ]),
    );
    expect(JSON.stringify(result.body)).not.toContain('ForeignPrivate');
    expect(JSON.stringify(result.body)).not.toContain('SiblingPrivate');
    expect(result.body.notes.join(' ')).toContain('missing or out-of-scope');
    expect(
      (await generate('current-inpatients', { patientId: patient, wardId: ward })).body.total,
    ).toBe(1);
    expect((await generate('current-inpatients', { patientId: foreignPatient })).body.total).toBe(
      0,
    );
    const searchText = 'Gathũri';
    expect((await generate('current-inpatients', { search: searchText })).body.total).toBe(1);
    const access = await pool.query(
      "SELECT patient_id,action FROM patient_record_access_logs WHERE user_id=$1 AND record_type='REPORT_CENTRE'",
      [actorId],
    );
    expect(access.rows.some((row) => row.patient_id === patient && row.action === 'VIEW')).toBe(
      true,
    );
    expect(access.rows.some((row) => row.patient_id === foreignPatient)).toBe(false);
    const audits = await pool.query(
      "SELECT action,details FROM audit_logs WHERE user_id=$1 AND resource='report_centre'",
      [String(actorId)],
    );
    expect(audits.rows.some((row) => row.action === 'VIEW')).toBe(true);
    expect(JSON.stringify(audits.rows)).not.toContain(searchText);
  });

  it('produces real PDF and Excel output with Unicode, source values, filters and no spreadsheet formulas', async () => {
    const pdf = await exp('current-inpatients', 'pdf', { patientId: patient });
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(pdf.body.base64, 'base64');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const parser = new PDFParser(null, true);
    const text = await new Promise<string>((resolve, reject) => {
      parser.on('pdfParser_dataError', (error) => reject(error));
      parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
      parser.parseBuffer(bytes);
    });
    expect(text).toContain('Synthetic Gathũri');
    expect(text).toContain(`RP-${suffix}`);
    expect(text).toContain('2026-04-01 10:20');
    expect(text).toContain('Synthetic Reporting Facility');
    parser.destroy();
    const sheet = await exp('inventory-category', 'xlsx', { search: 'HYPERLINK' });
    expect(sheet.status).toBe(200);
    const zip = unzipSync(Buffer.from(sheet.body.base64, 'base64'));
    const xml = Object.entries(zip)
      .filter(([name]) => name.endsWith('.xml'))
      .map(([, value]) => strFromU8(value))
      .join('\n');
    expect(xml).toContain('HYPERLINK');
    expect(xml).not.toMatch(/<f[ >]/);
    expect(xml).toContain(`FORMULA-${suffix}`);
    const print = await generate('current-inpatients', { patientId: patient, intent: 'print' });
    expect(print.status).toBe(200);
    const events = await pool.query(
      "SELECT action FROM patient_record_access_logs WHERE user_id=$1 AND patient_id=$2 AND record_type='REPORT_CENTRE'",
      [actorId, patient],
    );
    expect(events.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['VIEW', 'EXPORT', 'PRINT']),
    );
  });

  it('protects legacy analytics and audits its identifiable inpatient details', async () => {
    const revenuePath = `/api/analytics/revenue?facilityId=${facility}`;
    const operationsPath = `/api/reporting/operations?facilityId=${facility}`;
    expect((await httpJson(base, 'GET', revenuePath, { token: reportsOnly })).status).toBe(403);
    expect((await httpJson(base, 'GET', operationsPath, { token: reportsOnly })).status).toBe(403);
    expect((await httpJson(base, 'GET', revenuePath, { token })).status).toBe(200);
    const operations = await httpJson(base, 'GET', operationsPath, { token });
    expect(operations.status).toBe(200);
    expect(JSON.stringify(operations.body)).toContain('Synthetic Gathũri');
    expect(JSON.stringify(operations.body)).not.toContain('ForeignPrivate');
    expect(operations.body.lengthOfStay.unresolvedPatientCount).toBe(1);
    const events = await pool.query(
      "SELECT patient_id FROM patient_record_access_logs WHERE user_id=$1 AND record_type='LEGACY_OPERATIONS_REPORT'",
      [actorId],
    );
    expect(events.rows.map((row) => row.patient_id)).toContain(patient);
    expect(events.rows.map((row) => row.patient_id)).not.toContain(foreignPatient);
    await pool.query('UPDATE facilities SET hidden_modules=\'["finance"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    expect((await httpJson(base, 'GET', revenuePath, { token })).status).toBe(403);
    await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
  });

  it('keeps the reused invoice document scoped to the selected facility and requires report export permission for report printing', async () => {
    const invoice = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,status) VALUES($1,$2,$3,$4,'Pending') RETURNING id",
        [tenant, sibling, siblingPatient, `RINV-${suffix}`],
      )
    ).rows[0].id;
    const url = `/api/invoices/${invoice}/finalization`;
    expect(
      (await httpJson(base, 'GET', `${url}?facilityId=${facility}`, { token: tenantToken })).status,
    ).toBe(404);
    expect(
      (await httpJson(base, 'GET', `${url}?facilityId=${sibling}`, { token: tenantToken })).body,
    ).toEqual({ finalized: false });
    const ownInvoice = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,status) VALUES($1,$2,$3,$4,'Pending') RETURNING id",
        [tenant, facility, patient, `RINV-OWN-${suffix}`],
      )
    ).rows[0].id;
    expect(
      (
        await httpJson(base, 'POST', `/api/invoices/${ownInvoice}/print-access`, {
          token: noExport,
          body: { facilityId: facility },
        })
      ).status,
    ).toBe(403);
  });

  it('fails closed when the report generation audit insert fails', async () => {
    const trigger = `synthetic_rc_${suffix}`;
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.resource = 'report_centre' AND NEW.user_id = '${actorId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    );
    try {
      const before = (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM patient_record_access_logs WHERE user_id=$1 AND record_type='REPORT_CENTRE'",
          [actorId],
        )
      ).rows[0].n;
      const response = await generate('current-inpatients', { patientId: patient });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('Gathũri');
      const after = (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM patient_record_access_logs WHERE user_id=$1 AND record_type='REPORT_CENTRE'",
          [actorId],
        )
      ).rows[0].n;
      expect(after).toBe(before);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${trigger}()`);
    }
  });

  it('refuses unsupported export text instead of silently changing identity and rolls back when patient access audit cannot commit', async () => {
    await pool.query('UPDATE patients SET last_name=$1 WHERE id=$2', [
      `Synthetic${String.fromCharCode(1)}Control`,
      patient,
    ]);
    for (const format of ['pdf', 'xlsx']) {
      const unsupported = await exp('current-inpatients', format, { patientId: patient });
      expect(unsupported.status).toBe(422);
      expect(unsupported.body.error).toBe('REPORT_EXPORT_UNSUPPORTED_TEXT');
    }
    const unicode = await pool.query("UPDATE patients SET last_name='Synthetic漢' WHERE id=$1", [
      patient,
    ]);
    expect(unicode.rowCount).toBe(1);
    const result = await exp('current-inpatients', 'pdf', { patientId: patient });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('REPORT_PDF_UNSUPPORTED_TEXT');
    expect((await exp('current-inpatients', 'xlsx', { patientId: patient })).status).toBe(200);
    await pool.query("UPDATE patients SET last_name='Gathũri' WHERE id=$1", [patient]);
    const before = Number(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM audit_logs WHERE user_id=$1 AND resource='report_centre'",
          ['2147483647'],
        )
      ).rows[0].count,
    );
    await expect(
      generateReport(
        {
          userId: 2147483647,
          tenantId: tenant,
          facilityId: facility,
          roles: [],
          isSuperAdmin: false,
          permissions: grants,
        },
        'current-inpatients',
        { facilityId: facility, patientId: patient },
      ),
    ).rejects.toThrow();
    const after = Number(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM audit_logs WHERE user_id=$1 AND resource='report_centre'",
          ['2147483647'],
        )
      ).rows[0].count,
    );
    expect(after).toBe(before);
  });
});
