import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

describeDb('additive laboratory accession guard', () => {
  it('refuses historical duplicates without repair and enforces facility-scoped normalized uniqueness', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const client = await testPool().connect();
    const name = `lab_guard_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${name}"`);
      await client.query(`SET LOCAL search_path TO "${name}"`);
      await client.query(
        'CREATE TABLE lab_orders(id integer PRIMARY KEY,facility_id integer NOT NULL,sample_accession_number text)',
      );
      await client.query("INSERT INTO lab_orders VALUES (1,1,' A-1 '),(2,1,'a-1')");
      const migration = await readFile('drizzle/0033_lab_accession_safety.sql', 'utf8');
      await client.query('SAVEPOINT before_guard');
      await expect(client.query(migration)).rejects.toMatchObject({ code: 'P0001' });
      await client.query('ROLLBACK TO SAVEPOINT before_guard');
      expect((await client.query('SELECT count(*)::int AS n FROM lab_orders')).rows[0].n).toBe(2);
      // This correction is confined to the temporary synthetic schema and transaction.
      await client.query("UPDATE lab_orders SET sample_accession_number='B-2' WHERE id=2");
      await client.query(migration);
      await client.query('SAVEPOINT duplicate');
      await expect(client.query("INSERT INTO lab_orders VALUES (3,1,'a-1')")).rejects.toMatchObject(
        { code: '23505' },
      );
      await client.query('ROLLBACK TO SAVEPOINT duplicate');
      await client.query("INSERT INTO lab_orders VALUES (4,2,'a-1'),(5,1,NULL)");
      expect((await client.query('SELECT count(*)::int AS n FROM lab_orders')).rows[0].n).toBe(4);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
