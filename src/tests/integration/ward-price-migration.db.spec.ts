import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

/** Isolated 0065-shaped synthetic rows; no public application tables are changed. */
describeDb('ward price migration 0066 (synthetic PostgreSQL)', () => {
  const pool = testPool();

  it('preserves old prices and financial evidence without inferring their source', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    const client = await pool.connect();
    try {
      const name = `ward_upgrade_${randomUUID().replaceAll('-', '')}`;
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${name}"`);
      await client.query(`SET LOCAL search_path TO "${name}", public`);
      await client.query(`
        CREATE TABLE wards (id integer PRIMARY KEY, daily_rate numeric(10,2) DEFAULT 1500.00);
        CREATE TABLE inpatient_bed_occupancies (
          id integer PRIMARY KEY, daily_rate_snapshot numeric(10,2), price_revision_snapshot integer
        );
        CREATE TABLE inpatient_bed_nights (id integer PRIMARY KEY, unit_price_snapshot numeric(10,2));
        CREATE TABLE admissions (id integer PRIMARY KEY, ward_id integer REFERENCES wards(id));
        CREATE TABLE billing_invoices (id integer PRIMARY KEY, total_amount numeric(10,2));
        CREATE TABLE billing_items (id integer PRIMARY KEY, invoice_id integer REFERENCES billing_invoices(id), amount numeric(10,2));
        CREATE TABLE billing_payments (id integer PRIMARY KEY, invoice_id integer REFERENCES billing_invoices(id), amount numeric(10,2));
        CREATE TABLE billing_refunds (id integer PRIMARY KEY, payment_id integer REFERENCES billing_payments(id), amount numeric(10,2));
        CREATE TABLE audit_logs (id integer PRIMARY KEY, resource text);
        CREATE TABLE journal_entries (id integer PRIMARY KEY, source text);
        CREATE TABLE journal_lines (id integer PRIMARY KEY, journal_id integer REFERENCES journal_entries(id), amount numeric(10,2));
        INSERT INTO wards(id) VALUES(1);
        INSERT INTO wards VALUES(2,3200.00),(3,NULL);
        INSERT INTO inpatient_bed_occupancies VALUES(1,100.00,1),(2,NULL,NULL);
        INSERT INTO inpatient_bed_nights VALUES(1,100.00);
        INSERT INTO admissions VALUES(1,1);
        INSERT INTO billing_invoices VALUES(1,100.00);
        INSERT INTO billing_items VALUES(1,1,100.00);
        INSERT INTO billing_payments VALUES(1,1,100.00);
        INSERT INTO billing_refunds VALUES(1,1,10.00);
        INSERT INTO audit_logs VALUES(1,'Synthetic evidence');
        INSERT INTO journal_entries VALUES(1,'Synthetic invoice');
        INSERT INTO journal_lines VALUES(1,1,100.00);
      `);
      const tables = [
        'wards',
        'inpatient_bed_occupancies',
        'inpatient_bed_nights',
        'admissions',
        'billing_invoices',
        'billing_items',
        'billing_payments',
        'billing_refunds',
        'audit_logs',
        'journal_entries',
        'journal_lines',
      ];
      const before = new Map<string, unknown>();
      const columns = new Map<string, string[]>();
      for (const table of tables) {
        columns.set(
          table,
          (
            await client.query(
              'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position',
              [table],
            )
          ).rows.map((row: { column_name: string }) => row.column_name),
        );
        before.set(table, (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
      }
      await client.query(
        await readFile('drizzle/0066_ward_default_bed_price_evidence.sql', 'utf8'),
      );
      for (const table of tables) {
        const selection = columns
          .get(table)!
          .map((column) => `"${column}"`)
          .join(',');
        expect(
          (await client.query(`SELECT ${selection} FROM "${table}" ORDER BY id`)).rows,
          table,
        ).toEqual(before.get(table));
      }
      expect(
        (
          await client.query(
            'SELECT daily_rate_configured,daily_rate_revision FROM wards ORDER BY id',
          )
        ).rows,
      ).toEqual([
        { daily_rate_configured: false, daily_rate_revision: 1 },
        { daily_rate_configured: false, daily_rate_revision: 1 },
        { daily_rate_configured: false, daily_rate_revision: 1 },
      ]);
      expect(
        (
          await client.query(
            'SELECT rate_source_snapshot FROM inpatient_bed_occupancies ORDER BY id',
          )
        ).rows,
      ).toEqual([{ rate_source_snapshot: null }, { rate_source_snapshot: null }]);
      expect(
        (
          await client.query(
            'SELECT rate_source_snapshot,price_revision_snapshot FROM inpatient_bed_nights',
          )
        ).rows[0],
      ).toEqual({ rate_source_snapshot: null, price_revision_snapshot: null });
      expect(
        (
          await client.query(
            'INSERT INTO wards(id) VALUES(4) RETURNING daily_rate,daily_rate_configured',
          )
        ).rows[0],
      ).toEqual({ daily_rate: null, daily_rate_configured: false });
      await client.query('SAVEPOINT no_revision');
      await expect(
        client.query('UPDATE wards SET daily_rate=2000 WHERE id=1'),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT no_revision');
      await client.query('SAVEPOINT no_price');
      await expect(
        client.query(
          'UPDATE wards SET daily_rate_configured=true,daily_rate_revision=2 WHERE id=3',
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT no_price');
      expect(
        (
          await client.query(
            'UPDATE wards SET daily_rate_configured=true,daily_rate_revision=2 WHERE id=1 RETURNING daily_rate,daily_rate_configured,daily_rate_revision',
          )
        ).rows[0],
      ).toEqual({ daily_rate: '1500.00', daily_rate_configured: true, daily_rate_revision: 2 });
      await client.query('SAVEPOINT no_source_revision');
      await expect(
        client.query(
          "INSERT INTO inpatient_bed_occupancies(id,daily_rate_snapshot,rate_source_snapshot) VALUES(3,700,'WARD_DEFAULT')",
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT no_source_revision');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
