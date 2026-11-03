import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

/**
 * Regression for the guarded 0064 upgrade. This is a transaction-scoped,
 * synthetic schema; it never modifies the application's public tables. The
 * separate release audit also documents an upgrade of a populated database
 * migrated through the complete 0063 journal.
 */
describeDb('staff appointment migration 0064 (synthetic PostgreSQL)', () => {
  const pool = testPool();

  async function createLegacySchema(client: PoolClient) {
    const name = `appointment_upgrade_${randomUUID().replaceAll('-', '')}`;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${name}"`);
    await client.query(`SET LOCAL search_path TO "${name}", public`);
    await client.query(`
      CREATE TABLE tenants (id integer PRIMARY KEY);
      CREATE TABLE facilities (id integer PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id));
      CREATE TABLE users (id integer PRIMARY KEY, tenant_id integer REFERENCES tenants(id));
      CREATE TABLE patients (id integer PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id));
      CREATE TABLE queues (id integer PRIMARY KEY, patient_id integer NOT NULL REFERENCES patients(id), status text NOT NULL);
      CREATE TABLE facility_services (
        id integer PRIMARY KEY, facility_id integer NOT NULL REFERENCES facilities(id),
        tenant_id integer NOT NULL REFERENCES tenants(id), UNIQUE(id,facility_id,tenant_id)
      );
      CREATE TABLE appointments (
        id integer PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
        facility_id integer NOT NULL REFERENCES facilities(id), patient_id integer NOT NULL REFERENCES patients(id),
        scheduled_time text NOT NULL, appointment_type text, status text, reason text, notes text
      );
      CREATE TABLE website_bookings (id integer PRIMARY KEY, appointment_id integer REFERENCES appointments(id), status text NOT NULL);
      CREATE TABLE dialysis_schedules (id integer PRIMARY KEY, appointment_id integer REFERENCES appointments(id), status text NOT NULL);
      CREATE TABLE billing_invoices (id integer PRIMARY KEY, patient_id integer REFERENCES patients(id), total_amount numeric(10,2) NOT NULL);
      CREATE TABLE billing_items (id integer PRIMARY KEY, invoice_id integer REFERENCES billing_invoices(id), amount numeric(10,2) NOT NULL);
      CREATE TABLE billing_payments (id integer PRIMARY KEY, invoice_id integer REFERENCES billing_invoices(id), amount numeric(10,2) NOT NULL);
      CREATE TABLE billing_refunds (id integer PRIMARY KEY, payment_id integer REFERENCES billing_payments(id), amount numeric(10,2) NOT NULL);
      CREATE TABLE audit_logs (id integer PRIMARY KEY, action text NOT NULL, resource text NOT NULL);

      INSERT INTO tenants VALUES (1),(2);
      INSERT INTO facilities VALUES (10,1),(20,2);
      INSERT INTO users VALUES (100,1);
      INSERT INTO patients VALUES (1000,1);
      INSERT INTO queues VALUES (1,1000,'Waiting');
      INSERT INTO facility_services VALUES (10000,10,1),(20000,20,2);
      INSERT INTO appointments VALUES
        (1,1,10,1000,'2031-01-01T09:00','Synthetic website','Confirmed','Synthetic','Legacy note'),
        (2,1,10,1000,'2031-01-02T10:00','Synthetic dialysis','Scheduled',NULL,NULL),
        (3,1,10,1000,'2031-01-03T11:00','Synthetic','Cancelled','Retained',NULL);
      INSERT INTO website_bookings VALUES (1,1,'CONFIRMED');
      INSERT INTO dialysis_schedules VALUES (1,2,'SCHEDULED');
      INSERT INTO billing_invoices VALUES (1,1000,100.00);
      INSERT INTO billing_items VALUES (1,1,100.00);
      INSERT INTO billing_payments VALUES (1,1,100.00);
      INSERT INTO billing_refunds VALUES (1,1,10.00);
      INSERT INTO audit_logs VALUES (1,'CREATE','Appointment');
    `);
  }

  it('preserves populated clinical, booking and financial rows and enforces the new scoped history', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    const client = await pool.connect();
    try {
      await createLegacySchema(client);
      const tables = [
        'appointments',
        'queues',
        'website_bookings',
        'dialysis_schedules',
        'billing_invoices',
        'billing_items',
        'billing_payments',
        'billing_refunds',
        'audit_logs',
      ];
      const before = new Map<string, unknown>();
      const columns = new Map<string, string[]>();
      for (const table of tables) {
        const names = (
          await client.query(
            'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position',
            [table],
          )
        ).rows.map((row: { column_name: string }) => row.column_name);
        columns.set(table, names);
        before.set(table, (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
      }
      await client.query(await readFile('drizzle/0064_staff_appointment_lifecycle.sql', 'utf8'));
      for (const table of tables) {
        const names = columns.get(table)!;
        const selection = names.map((name) => `"${name}"`).join(',');
        expect(
          (await client.query(`SELECT ${selection} FROM "${table}" ORDER BY id`)).rows,
          table,
        ).toEqual(before.get(table));
      }
      const legacy = (
        await client.query(`SELECT booking_reference,category_id,facility_service_id,priority,
        created_by_user_id,replacement_of_id,checkin_queue_id FROM appointments ORDER BY id`)
      ).rows;
      expect(legacy).toHaveLength(3);
      expect(legacy.every((row) => Object.values(row).every((value) => value === null))).toBe(true);

      const category = (
        await client.query(`INSERT INTO appointment_categories
        (tenant_id,facility_id,code,name,facility_service_id,created_by_user_id)
        VALUES(1,10,'SYN','Synthetic',10000,100) RETURNING id`)
      ).rows[0].id;
      await client.query('UPDATE appointments SET category_id=$1 WHERE id=1', [category]);
      await client.query('SAVEPOINT wrong_scope');
      await expect(
        client.query(
          `INSERT INTO appointments(id,tenant_id,facility_id,patient_id,scheduled_time,category_id)
        VALUES(4,2,20,1000,'2031-01-04T12:00',$1)`,
          [category],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT wrong_scope');

      const event = (
        await client.query(`INSERT INTO appointment_events
        (tenant_id,facility_id,appointment_id,event_type,actor_type,actor_user_id,to_status)
        VALUES(1,10,1,'CREATED','STAFF',100,'Scheduled') RETURNING id,payment_state`)
      ).rows[0];
      expect(event.payment_state).toBe('NOT_ASSESSED');
      for (const statement of [
        "UPDATE appointment_events SET to_status='Cancelled' WHERE id=$1",
        'DELETE FROM appointment_events WHERE id=$1',
      ]) {
        await client.query('SAVEPOINT immutable_event');
        await expect(client.query(statement, [event.id])).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT immutable_event');
      }
      expect((await client.query('SELECT count(*)::int n FROM appointment_events')).rows[0].n).toBe(
        1,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('refuses partial pre-existing objects without rewriting legacy records', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    const client = await pool.connect();
    try {
      await createLegacySchema(client);
      await client.query('ALTER TABLE appointments ADD COLUMN category_id integer');
      const before = (await client.query('SELECT * FROM appointments ORDER BY id')).rows;
      await client.query('SAVEPOINT before_upgrade');
      await expect(
        client.query(await readFile('drizzle/0064_staff_appointment_lifecycle.sql', 'utf8')),
      ).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringContaining('objects already exist'),
      });
      await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
      expect((await client.query('SELECT * FROM appointments ORDER BY id')).rows).toEqual(before);
      expect(
        (
          await client.query(
            "SELECT to_regclass(current_schema() || '.appointment_events') AS name",
          )
        ).rows[0].name,
      ).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
