/**
 * The Reporting Centre landing figures, against a real synthetic PostgreSQL.
 *
 * Every claim on the landing page is checked against the transactions that
 * produced it: visits are recounted from `encounters`, revenue is recomputed
 * from `billing_payments` minus `billing_refunds`, balances from invoice
 * headers, and pharmacy alerts from `inventory_items`. The negative tests are
 * just as important as the totals: a figure the account may not see, a module
 * the facility switched off and a source that cannot be totalled must never
 * arrive as `0`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { centsToMoney, moneyToCents } from '../../dashboard/money.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

interface Kpi {
  id: string;
  status: string;
  value?: number;
  amount?: string;
  currency?: string | null;
  asOf?: string;
  periodScoped: boolean;
  series?: Array<{ day: string; value: number }>;
  message?: string;
}

describeDb('Reporting Centre overview (synthetic PostgreSQL and real HTTP)', () => {
  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');
  const modules = ['analytics', 'opd', 'finance', 'inventory', 'inpatient'];
  const grants = ['reports.read', 'clinical.read', 'billing.read', 'inventory.read'];
  let tenant: number;
  let otherTenant: number;
  let facility: number;
  let sibling: number;
  let foreignFacility: number;
  let reviewFacility: number;
  let patient: number;
  let siblingPatient: number;
  let foreignPatient: number;
  let token: string;
  let limited: string;
  let tenantToken: string;
  let superToken: string;
  let base: string;
  let close: () => Promise<void>;
  let invoiceA: number;
  let siblingInvoice: number;

  async function user(
    tag: string,
    tenantId: number | null,
    facilityId: number | null,
    permissions: string[],
    superAdmin = false,
  ) {
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic overview actor','test-only','ACTIVE',$3,$4) RETURNING id",
        [`ov-${tag}-${suffix}`, `ov-${tag}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenantId, superAdmin ? 'SUPER_ADMIN' : `OV_${tag}_${suffix}`],
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

  const overview = (body: Record<string, unknown>, auth = token) =>
    httpJson<Record<string, any>>(base, 'POST', '/api/reporting/centre/overview', {
      token: auth,
      body: { facilityId: facility, from: '2026-04-01', to: '2026-04-30', ...body },
    });
  const kpi = (body: Record<string, any>, id: string) =>
    (body.kpis as Kpi[]).find((entry) => entry.id === id) as Kpi;

  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('synthetic') ||
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    ) {
      throw new Error('A new isolated local synthetic test database is required.');
    }
    const tenants = await pool.query(
      'INSERT INTO tenants(name,slug,currency) VALUES($1,$2,$5),($3,$4,$6) RETURNING id',
      [
        `Overview synthetic ${suffix}`,
        `ov-${suffix}`,
        `Other overview synthetic ${suffix}`,
        `ov-other-${suffix}`,
        'KES',
        'UGX',
      ],
    );
    [tenant, otherTenant] = tenants.rows.map((row) => row.id);
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
      ($1,$3,'Synthetic Overview Facility',$7::jsonb),
      ($1,$4,'Synthetic Overview Sibling',$7::jsonb),
      ($2,$5,'Synthetic Overview Foreign',$7::jsonb),
      ($1,$6,'Synthetic Overview Review',$7::jsonb) RETURNING id`,
      [
        tenant,
        otherTenant,
        `OV-${suffix}`,
        `OVS-${suffix}`,
        `OVF-${suffix}`,
        `OVR-${suffix}`,
        JSON.stringify(modules),
      ],
    );
    [facility, sibling, foreignFacility, reviewFacility] = facilities.rows.map((row) => row.id);
    const people = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES
      ($1,$3,$7,'Synthetic','Overview','2000-01-01','Other'),
      ($1,$4,$8,'Synthetic','Sibling','2000-01-01','Other'),
      ($2,$5,$9,'Synthetic','Foreign','2000-01-01','Other'),
      ($1,$6,$10,'Synthetic','Review','2000-01-01','Other') RETURNING id`,
      [
        tenant,
        otherTenant,
        facility,
        sibling,
        foreignFacility,
        reviewFacility,
        `OVP-${suffix}`,
        `OVS-${suffix}`,
        `OVF-${suffix}`,
        `OVR-${suffix}`,
      ],
    );
    [patient, siblingPatient, foreignPatient] = people.rows.map((row) => row.id);

    // Three visits inside April, two outside it, one at each other facility.
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,started_at,status) VALUES
      ($1,$2,$3,'2026-04-01 09:00','COMPLETED'),
      ($1,$2,$3,'2026-04-02 10:00','COMPLETED'),
      ($1,$2,$3,'2026-04-02 11:00','COMPLETED'),
      ($1,$2,$3,'2026-03-31 23:59','COMPLETED'),
      ($1,$2,$3,'2026-05-01 00:01','COMPLETED'),
      ($1,$4,$5,'2026-04-03 09:00','COMPLETED'),
      ($6,$7,$8,'2026-04-04 09:00','COMPLETED')`,
      [
        tenant,
        facility,
        patient,
        sibling,
        siblingPatient,
        otherTenant,
        foreignFacility,
        foreignPatient,
      ],
    );

    const invoices = await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,status,total_amount,balance_amount,voided_at) VALUES
      ($1,$2,$3,$9,'Pending',500.00,500.00,NULL),
      ($1,$2,$3,$10,'Paid',300.00,0,NULL),
      ($1,$2,$3,$11,'Pending',250.00,250.00,'2026-04-10'),
      ($1,$4,$5,$12,'Pending',9999.00,9999.00,NULL),
      ($6,$7,$8,$13,'Pending',7777.00,7777.00,NULL) RETURNING id`,
      [
        tenant,
        facility,
        patient,
        sibling,
        siblingPatient,
        otherTenant,
        foreignFacility,
        foreignPatient,
        `OVI-A-${suffix}`,
        `OVI-B-${suffix}`,
        `OVI-V-${suffix}`,
        `OVI-S-${suffix}`,
        `OVI-F-${suffix}`,
      ],
    );
    [invoiceA, , , siblingInvoice] = invoices.rows.map((row) => row.id);

    const payments = await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES
      ($1,$4,'M-Pesa',1000.00,'Synthetic Cashier','2026-04-01 10:00'),
      ($1,$5,'Cash',500.50,'Synthetic Cashier','2026-04-02 12:00'),
      ($2,$6,'M-Pesa',300.00,'Synthetic Cashier','2025-01-31 12:00'),
      ($3,$7,'M-Pesa',8888.00,'Synthetic Cashier','2026-04-05 12:00') RETURNING id`,
      [
        invoiceA,
        invoices.rows[1].id,
        siblingInvoice,
        `OVR-1-${suffix}`,
        `OVR-2-${suffix}`,
        `OVR-3-${suffix}`,
        `OVR-4-${suffix}`,
      ],
    );
    await pool.query(
      `INSERT INTO inventory_items(facility_id,item_code,name,category,store_location,unit,current_stock,reorder_level,is_active) VALUES
      ($1,$3,'Synthetic Paracetamol','Pharmaceuticals','Main','Tablets',5,10,true),
      ($1,$4,'Synthetic Amoxicillin','Pharmaceuticals','Main','Capsules',10,10,true),
      ($1,$5,'Synthetic Ibuprofen','Pharmaceuticals','Main','Tablets',20,10,true),
      ($1,$6,'Synthetic Gauze','Surgical','Main','Pieces',1,5,true),
      ($1,$7,'Synthetic No reorder','Pharmaceuticals','Main','Tablets',3,NULL,true),
      ($1,$8,'Synthetic Inactive','Pharmaceuticals','Main','Tablets',1,10,false),
      ($2,$9,'Synthetic Sibling stock','Pharmaceuticals','Main','Tablets',1,10,true)`,
      [
        facility,
        sibling,
        `OV-ITEM-1-${suffix}`,
        `OV-ITEM-2-${suffix}`,
        `OV-ITEM-3-${suffix}`,
        `OV-ITEM-4-${suffix}`,
        `OV-ITEM-5-${suffix}`,
        `OV-ITEM-6-${suffix}`,
        `OV-ITEM-7-${suffix}`,
      ],
    );

    /*
     * A second facility whose source rows genuinely need review: the receipt
     * table is immutable, so this is seeded once and never cleaned up.
     */
    const reviewInvoice = await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,status,total_amount,balance_amount)
       VALUES($1,$2,$3,$4,'Pending',10.00,-10.00),($1,$2,$3,$5,'Pending',0.00,0.00) RETURNING id`,
      [tenant, reviewFacility, people.rows[3].id, `OVI-RN-${suffix}`, `OVI-RZ-${suffix}`],
    );
    await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date)
       VALUES($1,$2,'Cash',0.00,'Synthetic Cashier','2026-04-06 09:00')`,
      [reviewInvoice.rows[1].id, `OVR-ZERO-${suffix}`],
    );

    token = (await user('full', tenant, facility, grants)).token;
    limited = (await user('limited', tenant, facility, ['reports.read', 'clinical.read'])).token;
    tenantToken = (await user('tenant', tenant, null, grants)).token;
    superToken = (await user('super', null, null, grants, true)).token;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('requires a session, report permission, an authorised facility and a non-platform account', async () => {
    expect(
      (
        await httpJson(base, 'POST', '/api/reporting/centre/overview', {
          body: { facilityId: facility, from: '2026-04-01', to: '2026-04-30' },
        })
      ).status,
    ).toBe(401);

    const noReports = await user('noread', tenant, facility, ['clinical.read']);
    expect((await overview({}, noReports.token)).status).toBe(403);

    expect((await overview({ facilityId: sibling })).status).toBe(403);
    expect((await overview({ facilityId: foreignFacility })).status).toBe(403);
    expect((await overview({ facilityId: 0 })).status).toBe(400);
    expect((await overview({}, superToken)).status).toBe(403);
    expect((await overview({ facilityId: 999_999_999 }, tenantToken)).status).toBe(404);
  });

  it('recomputes every figure from the period transactions and audits nothing patient-identifying', async () => {
    const response = await overview({});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.body.facilityId).toBe(facility);
    expect(response.body.facilityName).toBe('Synthetic Overview Facility');
    expect(response.body.currency).toBe('KES');
    expect(response.body.kpis.map((entry: Kpi) => entry.id)).toEqual([
      'patient-visits',
      'revenue',
      'outstanding-balances',
      'pharmacy-stock-alerts',
    ]);

    const visits = kpi(response.body, 'patient-visits');
    expect(visits.status).toBe('ok');
    expect(visits.value).toBe(3);
    expect(visits.periodScoped).toBe(true);
    expect(visits.series).toHaveLength(30);
    expect(visits.series?.filter((point) => point.value > 0)).toEqual([
      { day: '2026-04-01', value: 1 },
      { day: '2026-04-02', value: 2 },
    ]);

    const revenue = kpi(response.body, 'revenue');
    expect(revenue.status).toBe('ok');
    // Recomputed from the two April receipts; the 2025 receipt is outside the period.
    const receipts = await pool.query<{ total: string; count: number }>(
      `SELECT sum(p.amount)::text AS total, count(*)::int AS count
       FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
       WHERE i.facility_id=$1 AND p.payment_date::date BETWEEN '2026-04-01' AND '2026-04-30'`,
      [facility],
    );
    expect(receipts.rows[0]).toEqual({ total: '1500.50', count: 2 });
    expect(revenue.amount).toBe(centsToMoney(moneyToCents(receipts.rows[0].total)));
    expect(revenue.amount).toBe('1500.50');
    expect(revenue.currency).toBe('KES');
    expect(revenue.series?.find((point) => point.day === '2026-04-01')?.value).toBe(1000);
    expect(revenue.series?.find((point) => point.day === '2026-04-02')?.value).toBe(500.5);

    const balances = kpi(response.body, 'outstanding-balances');
    expect(balances.status).toBe('ok');
    const openBalances = await pool.query<{ total: string }>(
      `SELECT coalesce(sum(balance_amount),0)::text AS total FROM billing_invoices
       WHERE facility_id=$1 AND voided_at IS NULL AND balance_amount > 0`,
      [facility],
    );
    expect(balances.amount).toBe(centsToMoney(moneyToCents(openBalances.rows[0].total)));
    expect(balances.amount).toBe('500.00');
    // The voided invoice and the settled invoice are not counted.
    expect(balances.value).toBe(1);
    expect(balances.periodScoped).toBe(false);
    expect(balances.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const stock = kpi(response.body, 'pharmacy-stock-alerts');
    expect(stock.status).toBe('ok');
    // At-or-below reorder level, pharmacy category only, active, reorder level recorded.
    expect(stock.value).toBe(2);
    expect(stock.periodScoped).toBe(false);

    // Aggregates only: no patient name, MRN or invoice number may travel to the browser.
    const serialised = JSON.stringify(response.body);
    // The facility's own name is expected; a patient name, MRN or invoice number is not.
    for (const secret of [`OVP-${suffix}`, `OVI-A-${suffix}`, 'Gathũri'])
      expect(serialised).not.toContain(secret);
  });

  it('shows each facility only its own records, including for a tenant-wide account', async () => {
    const own = await overview({}, token);
    const other = await overview({ facilityId: sibling }, tenantToken);
    expect(other.status).toBe(200);
    expect(other.body.facilityId).toBe(sibling);
    expect(kpi(other.body, 'patient-visits').value).toBe(1);
    expect(kpi(other.body, 'revenue').amount).toBe('8888.00');
    expect(kpi(other.body, 'outstanding-balances').amount).toBe('9999.00');
    expect(kpi(other.body, 'pharmacy-stock-alerts').value).toBe(1);
    expect(kpi(own.body, 'revenue').amount).not.toBe(kpi(other.body, 'revenue').amount);
  });

  it('returns a labelled restriction instead of a zero when a permission is missing', async () => {
    const response = await overview({}, limited);
    expect(response.status).toBe(200);
    expect(kpi(response.body, 'patient-visits').status).toBe('ok');
    expect(kpi(response.body, 'patient-visits').value).toBe(3);
    for (const id of ['revenue', 'outstanding-balances', 'pharmacy-stock-alerts']) {
      const card = kpi(response.body, id);
      expect(card.status).toBe('restricted');
      expect(card.value).toBeUndefined();
      expect(card.amount).toBeUndefined();
      expect(card.message).toMatch(/permission/i);
    }
  });

  it('labels a disabled module instead of returning an invented zero', async () => {
    await pool.query('UPDATE facilities SET hidden_modules=\'["inventory"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    try {
      const response = await overview({});
      expect(response.status).toBe(200);
      const stock = kpi(response.body, 'pharmacy-stock-alerts');
      expect(stock.status).toBe('disabled');
      expect(stock.value).toBeUndefined();
      expect(stock.message).toContain('inventory');
      // The other figures are unaffected.
      expect(kpi(response.body, 'patient-visits').value).toBe(3);
    } finally {
      await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
    }
  });

  it('refuses the reporting module, not the report, when analytics is hidden', async () => {
    await pool.query('UPDATE facilities SET hidden_modules=\'["analytics"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    try {
      const response = await overview({});
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FACILITY_MODULE_DISABLED');
    } finally {
      await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
    }
  });

  it('marks receipts and balances that need review as errors, never as totals', async () => {
    const response = await overview({ facilityId: reviewFacility }, tenantToken);
    expect(response.status).toBe(200);

    const revenue = kpi(response.body, 'revenue');
    expect(revenue.status).toBe('error');
    expect(revenue.amount).toBeUndefined();
    expect(revenue.message).toMatch(/cannot be totalled/i);

    const balances = kpi(response.body, 'outstanding-balances');
    expect(balances.status).toBe('error');
    expect(balances.amount).toBeUndefined();
    expect(balances.message).toMatch(/negative or non-numeric balance/i);

    // The facility's other, verifiable figures are still shown.
    expect(kpi(response.body, 'patient-visits').status).toBe('ok');
    expect(kpi(response.body, 'patient-visits').value).toBe(0);

    // And the healthy facility keeps its verified totals.
    const healthy = await overview({});
    expect(kpi(healthy.body, 'revenue').amount).toBe('1500.50');
    expect(kpi(healthy.body, 'outstanding-balances').amount).toBe('500.00');
  });

  it('reports a real zero for an empty period and keeps the period-independent snapshot', async () => {
    const response = await overview({ from: '2025-01-01', to: '2025-01-03' });
    expect(response.status).toBe(200);
    const visits = kpi(response.body, 'patient-visits');
    expect(visits.status).toBe('ok');
    expect(visits.value).toBe(0);
    expect(visits.series).toEqual([
      { day: '2025-01-01', value: 0 },
      { day: '2025-01-02', value: 0 },
      { day: '2025-01-03', value: 0 },
    ]);
    expect(kpi(response.body, 'revenue').amount).toBe('0.00');
    expect(kpi(response.body, 'revenue').status).toBe('ok');
    // A snapshot taken today is not period-scoped, so it stays visible.
    expect(kpi(response.body, 'outstanding-balances').amount).toBe('500.00');
    expect(kpi(response.body, 'pharmacy-stock-alerts').value).toBe(2);
  });

  it('validates the requested period before reading anything', async () => {
    for (const body of [
      { from: undefined, to: '2026-04-30' },
      { from: '2026-02-30', to: '2026-04-30' },
      { from: '2026-04-30', to: '2026-04-01' },
      { from: '2025-01-01', to: '2026-04-30' },
      { from: '01/04/2026', to: '2026-04-30' },
    ]) {
      const response = await overview(body as Record<string, unknown>);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_REPORT_FILTER');
    }
  });
});
