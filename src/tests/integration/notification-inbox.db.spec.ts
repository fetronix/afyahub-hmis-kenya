/** Authenticated HTTP tests against an isolated synthetic database, never production. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { addCalendarDays } from '../../dashboard/date-range.ts';
import { calendarDateInZone } from '../../dashboard/timezone.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import type { InboxResponse } from '../../notifications/inbox.types.ts';

describeDb('notification centre: synthetic scoped PostgreSQL + HTTP', () => {
  const suffix = randomUUID().slice(0, 8),
    zone = 'Pacific/Kiritimati';
  const today = calendarDateInZone(zone);
  let tenant: number, facility: number, sibling: number, otherFacility: number, firstUser: number;
  let primaryItem: number, lowItem: number, thirtyBatch: number, outItem: number;
  let first: string,
    second: string,
    limited: string,
    theatreOnly: string,
    foreign: string,
    none: string;
  let base: string, close: () => Promise<void>;
  const call = (method: string, path: string, token?: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, { token, body });
  const inbox = (token: string, params = '') =>
    call('GET', `/api/notifications?facilityId=${facility}${params}`, token);
  beforeAll(async () => {
    if (
      !(process.env.SQL_DB_NAME ?? '').includes('test') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    )
      throw new Error('A disposable local synthetic test database is required.');
    const tenants = await pool.query(
      `INSERT INTO tenants(name,slug,timezone) VALUES($1,$2,'America/Adak'),($3,$4,'Africa/Nairobi') RETURNING id`,
      [
        `Inbox synthetic ${suffix}`,
        `inbox-${suffix}`,
        `Inbox foreign ${suffix}`,
        `inbox-foreign-${suffix}`,
      ],
    );
    tenant = tenants.rows[0].id;
    const modules = JSON.stringify([
      'registration',
      'reception',
      'inpatient',
      'theatre',
      'laboratory',
      'inventory',
      'finance',
      'audit',
    ]);
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES
      ($1,$3,'Synthetic Inbox Hospital',$6,$7::jsonb),($1,$4,'Synthetic Sibling',NULL,$7::jsonb),($2,$5,'Synthetic Foreign',NULL,$7::jsonb) RETURNING id`,
      [
        tenant,
        tenants.rows[1].id,
        `I-A-${suffix}`,
        `I-B-${suffix}`,
        `I-C-${suffix}`,
        zone,
        modules,
      ],
    );
    [facility, sibling, otherFacility] = facilities.rows.map((row) => row.id);
    const grants = [
      'inventory.read',
      'patients.read',
      'appointments.read',
      'theatre.read',
      'laboratory.read',
      'billing.read',
    ];
    for (const code of grants)
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    async function actor(tag: string, t: number, f: number, perms: string[]) {
      const user = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
        VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `inbox-${tag}-${suffix}`,
            `inbox-${tag}-${suffix}@example.test`,
            `Synthetic ${tag}`,
            t,
            f,
          ],
        )
      ).rows[0].id;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, `INBOX_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
      for (const code of perms)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return {
        user,
        token: (await createSession({ userId: user, securityVersion: 1 })).sessionToken,
      };
    }
    const a = await actor('first', tenant, facility, grants);
    first = a.token;
    firstUser = a.user;
    second = (await actor('second', tenant, facility, grants)).token;
    limited = (await actor('limited', tenant, facility, ['patients.read'])).token;
    theatreOnly = (await actor('theatre', tenant, facility, ['theatre.read'])).token;
    foreign = (await actor('foreign', tenants.rows[1].id, otherFacility, grants)).token;
    none = (await actor('none', tenant, facility, [])).token;
    const stock = await pool.query(
      `INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock,reorder_level) VALUES
      ($1,$3,'Synthetic medicine','tablets',100,10),($1,$4,'Synthetic low','vials',5,10),($1,$5,'Synthetic out','units',0,10),
      ($2,$6,'SYNTHETIC SIBLING SECRET','units',0,10) RETURNING id`,
      [facility, sibling, `I-M-${suffix}`, `I-L-${suffix}`, `I-O-${suffix}`, `I-S-${suffix}`],
    );
    [primaryItem, lowItem, outItem] = stock.rows.map((row) => row.id);
    for (const [name, date, qty] of [
      ['expired', addCalendarDays(today, -1), 2],
      ['today', today, 3],
      ['seven', addCalendarDays(today, 7), 4],
      ['eight', addCalendarDays(today, 8), 5],
      ['thirty', addCalendarDays(today, 30), 6],
      ['later', addCalendarDays(today, 31), 7],
      ['empty', today, 0],
      ['invalid', '2026-02-31', 8],
    ] as Array<[string, string, number]>) {
      const row = await pool.query(
        'INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,$2,$3,$4) RETURNING id',
        [primaryItem, `SYN-${name}`, date, qty],
      );
      if (name === 'thirty') thirtyBatch = row.rows[0].id;
    }
    const patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,created_at)
      VALUES($1,$2,$3,'Synthetic','Private Patient','2000-01-01','Other',$4::timestamp) RETURNING id`,
        [tenant, facility, `I-P-${suffix}`, `${today} 10:00`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,created_at)
      SELECT $1,$2,$3,$4,$5::timestamp FROM generate_series(1,60)`,
      [tenant, facility, patient, `${today} 11:00`, `${today} 10:10`],
    );
    await pool.query(
      `INSERT INTO theatre_cases(tenant_id,facility_id,patient_id,procedure_name,lead_surgeon,scheduled_start,status,created_at)
      VALUES($1,$2,$3,'Synthetic procedure','Synthetic surgeon',$4,'Scheduled',$5::timestamp)`,
      [tenant, facility, patient, `${today} 12:00`, `${today} 10:15`],
    );
    const order = (
      await pool.query(
        `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at) VALUES($1,$2,$3,'Synthetic Test','Ordered',$4::timestamp) RETURNING id`,
        [tenant, facility, patient, `${today} 10:20`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,flag,status) VALUES($1,$2,'Synthetic','123','Critical','Pending Verification')`,
      [order, patient],
    );
    const invoice = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,created_at)
      VALUES($1,$2,$3,$4,100,100,0,'Paid',$5::timestamp) RETURNING id`,
        [tenant, facility, patient, `I-INV-${suffix}`, `${today} 10:30`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES($1,$2,'Cash',100,'Synthetic',$3::timestamp)`,
      [invoice, `I-RECEIPT-${suffix}`, `${today} 10:31`],
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('authenticates, enforces tenant and facility scope and rejects arbitrary reads', async () => {
    expect((await call('GET', `/api/notifications?facilityId=${facility}`)).status).toBe(401);
    expect((await inbox(none)).status).toBe(403);
    expect((await inbox(foreign)).status).toBe(403);
    expect((await call('GET', `/api/notifications?facilityId=${sibling}`, first)).status).toBe(403);
    expect((await call('GET', `/api/queues?facilityId=${sibling}`, first)).status).toBe(403);
    expect((await call('GET', `/api/queues?facilityId=wat`, first)).status).toBe(400);
    expect(
      (
        await call('POST', '/api/notifications/read', limited, {
          facilityId: facility,
          key: 'alert:999999:1',
        })
      ).status,
    ).toBe(404);
  });
  it('filters active queues before limiting recent rows, consistent with the overview', async () => {
    const patient = (
      await pool.query(
        'SELECT id FROM patients WHERE tenant_id=$1 AND registration_facility_id=$2 LIMIT 1',
        [tenant, facility],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO queues(tenant_id,facility_id,patient_id,queue_type,token_number,status,created_at)
      SELECT $1,$2,$3,'Triage','SYN-DONE-' || n,'Completed',now() FROM generate_series(1,105) n`,
      [tenant, facility, patient],
    );
    await pool.query(
      `INSERT INTO queues(tenant_id,facility_id,patient_id,queue_type,token_number,status,created_at)
      VALUES($1,$2,$3,'Triage','SYN-WAITING','Waiting',now()-interval '2 days')`,
      [tenant, facility, patient],
    );
    const defaultRows = await call('GET', `/api/queues?facilityId=${facility}`, first);
    expect(defaultRows.status).toBe(200);
    expect(defaultRows.body).toHaveLength(100);
    expect(
      defaultRows.body.some((q: { tokenNumber: string }) => q.tokenNumber === 'SYN-WAITING'),
    ).toBe(false);
    const active = await call('GET', `/api/queues?facilityId=${facility}&active=true`, first);
    expect(active.status).toBe(200);
    expect(active.body).toHaveLength(1);
    expect(active.body[0].tokenNumber).toBe('SYN-WAITING');
    const overview = await call(
      'GET',
      `/api/dashboard/overview?facilityId=${facility}&start=${today}&end=${today}`,
      first,
    );
    expect(overview.body.operations.queues.data.active).toBe(1);
    expect((await call('GET', `/api/queues?facilityId=${facility}&active=yes`, first)).status).toBe(
      400,
    );
  });
  it('classifies actual batches in the facility timezone, filters permission scope and leaves stock unchanged', async () => {
    const before = (
      await pool.query(
        'SELECT id,current_stock FROM inventory_items WHERE facility_id=$1 ORDER BY id',
        [facility],
      )
    ).rows;
    const result = await inbox(first, '&limit=100');
    expect(result.status).toBe(200);
    const data = result.body as InboxResponse;
    expect(data.timezone).toBe(zone);
    const group = (name: string) => data.alertGroups.find((g) => g.group === name)?.count;
    expect(group('expired')).toBe(1);
    expect(group('expiry7')).toBe(2);
    expect(group('expiry30')).toBe(2);
    expect(group('stockout')).toBe(1);
    expect(group('lowStock')).toBe(1);
    expect(group('inventoryReview')).toBe(1);
    expect(group('criticalLab')).toBe(1);
    expect(data.items.find((item) => item.details.includes('SYN-today'))?.details).toContain(
      'Expires today',
    );
    expect(data.items.find((item) => item.details.includes('SYN-invalid'))?.details).toContain(
      'Invalid expiry date',
    );
    expect(JSON.stringify(data)).not.toContain('SYNTHETIC SIBLING SECRET');
    expect(JSON.stringify(data)).not.toContain('Private Patient');
    expect(
      data.items.some(
        (item) =>
          item.title === 'Receipt recorded' && item.details.includes('not verified settlement'),
      ),
    ).toBe(true);
    const theatreFeed = (await inbox(theatreOnly, '&limit=100')).body as InboxResponse;
    expect(theatreFeed.items).toHaveLength(1);
    expect(theatreFeed.items[0].destination).toBe('theatre');
    expect(theatreFeed.items[0].title).toBe('Theatre case scheduled');
    expect(JSON.stringify(theatreFeed)).not.toContain('Private Patient');
    expect(data.unreadCount).toBeGreaterThan(50);
    expect((await inbox(first)).body.unreadCount).toBe(data.unreadCount); // exact across pages
    const again = (await inbox(first, '&limit=100')).body as InboxResponse;
    expect(again.items.map((item) => item.key)).toEqual(data.items.map((item) => item.key));
    expect(
      (
        await pool.query(
          'SELECT id,current_stock FROM inventory_items WHERE facility_id=$1 ORDER BY id',
          [facility],
        )
      ).rows,
    ).toEqual(before);
    const restricted = (await inbox(limited, '&limit=100')).body as InboxResponse;
    expect(restricted.alertGroups).toEqual([]);
    expect(restricted.items.every((item) => item.destination === 'registration')).toBe(true);
    expect(
      (await call('GET', `/api/notifications?facilityId=${facility}&severity=NOPE`, first)).status,
    ).toBe(400);
    const warnings = (await inbox(first, '&severity=WARNING&limit=100')).body as InboxResponse;
    expect(warnings.items.every((item) => item.severity === 'WARNING')).toBe(true);
    expect(warnings.unreadCount).toBe(data.unreadCount);
  });
  it('persists individual and all-read independently per user, logs read actions and avoids duplicates under concurrency', async () => {
    const initial = (await inbox(first, '&limit=100')).body as InboxResponse;
    const key = initial.items.find((item) => item.group === 'stockout')!.key;
    const reads = await Promise.all([
      call('POST', '/api/notifications/read', first, { facilityId: facility, key }),
      call('POST', '/api/notifications/read', first, { facilityId: facility, key }),
    ]);
    expect(reads.every((result) => result.status === 200)).toBe(true);
    const after = (await inbox(first, '&limit=100')).body as InboxResponse;
    expect(after.items.find((item) => item.key === key)?.read).toBe(true);
    expect(after.unreadCount).toBe(initial.unreadCount - 1);
    expect(
      ((await inbox(second, '&limit=100')).body as InboxResponse).items.find(
        (item) => item.key === key,
      )?.read,
    ).toBe(false);
    const receipt = (
      await pool.query(
        'SELECT count(*)::int AS n FROM notification_read_receipts WHERE user_id=$1 AND notification_key=$2',
        [firstUser, key],
      )
    ).rows[0];
    expect(receipt.n).toBe(1);
    const marked = await call('POST', '/api/notifications/read-all', first, {
      facilityId: facility,
    });
    expect(marked.status).toBe(200);
    expect(((await inbox(first)).body as InboxResponse).unreadCount).toBe(0);
    expect(((await inbox(second)).body as InboxResponse).unreadCount).toBe(initial.unreadCount);
    const audits = await pool.query(
      "SELECT details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND user_id=$3 AND action='MARK_READ' AND resource='NotificationInbox'",
      [tenant, facility, String(firstUser)],
    );
    expect(audits.rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits.rows)).not.toContain('Private Patient');
  });
  it('creates a new unread revision on urgency escalation and on an observed resolution and recurrence', async () => {
    const old = (await inbox(first, '&limit=100')).body as InboxResponse;
    const before = old.items.find((item) => item.details.includes('SYN-thirty'))!;
    expect(before.read).toBe(true);
    await pool.query('UPDATE inventory_batches SET expiry_date=$2 WHERE id=$1', [
      thirtyBatch,
      addCalendarDays(today, 7),
    ]);
    const escalated = (await inbox(first, '&limit=100')).body as InboxResponse;
    const next = escalated.items.find((item) => item.details.includes('SYN-thirty'))!;
    expect(next.key).not.toBe(before.key);
    expect(next.severity).toBe('CRITICAL');
    expect(next.read).toBe(false);
    const outBefore = old.items.find((item) => item.group === 'stockout')!.key;
    await pool.query('UPDATE inventory_items SET current_stock=20 WHERE id=$1', [outItem]);
    await inbox(first);
    await pool.query('UPDATE inventory_items SET current_stock=0 WHERE id=$1', [outItem]);
    const recurrence = (await inbox(first, '&limit=100')).body as InboxResponse;
    const outAgain = recurrence.items.find((item) => item.group === 'stockout')!;
    expect(outAgain.key).not.toBe(outBefore);
    expect(outAgain.read).toBe(false);
  });
  it('fails visibly on invalid zone; hidden inventory is not exposed and tenant-zone inheritance works', async () => {
    await pool.query("UPDATE facilities SET timezone='Not/AZone' WHERE id=$1", [facility]);
    const invalid = await inbox(first);
    expect(invalid.status).toBe(503);
    expect(invalid.body.error).toBe('TIMEZONE_NOT_CONFIGURED');
    await pool.query('UPDATE facilities SET timezone=$2 WHERE id=$1', [facility, zone]);
    const inventoryKey = ((await inbox(first, '&limit=100')).body as InboxResponse).items.find(
      (item) => item.destination === 'inventory',
    )!.key;
    await pool.query(
      'UPDATE facilities SET timezone=NULL,hidden_modules=\'["inventory"]\'::jsonb WHERE id=$1',
      [facility],
    );
    const inherited = await inbox(first, '&limit=100');
    expect(inherited.status).toBe(200);
    expect(inherited.body.timezone).toBe('America/Adak');
    expect(
      inherited.body.items.every(
        (item: { destination: string }) => item.destination !== 'inventory',
      ),
    ).toBe(true);
    expect(
      (
        await call('POST', '/api/notifications/read', first, {
          facilityId: facility,
          key: inventoryKey,
        })
      ).status,
    ).toBe(404);
    await pool.query("UPDATE facilities SET timezone=$2,hidden_modules='[]'::jsonb WHERE id=$1", [
      facility,
      zone,
    ]);
    // Metadata checks never updated stock or batch quantity.
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [lowItem])).rows[0]
        .current_stock,
    ).toBe(5);
    expect(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [primaryItem]))
        .rows[0].current_stock,
    ).toBe(100);
  });
});
