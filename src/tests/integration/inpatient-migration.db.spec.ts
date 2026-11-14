import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

describeDb('additive inpatient admission guards', () => {
  it('refuses pre-existing conflicts without changing them, then enforces both unique indexes', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const client = await testPool().connect();
    const name = `ip_guard_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${name}"`);
      await client.query(`SET LOCAL search_path TO "${name}"`);
      await client.query(
        'CREATE TABLE admissions(id integer PRIMARY KEY,facility_id integer NOT NULL,patient_id integer NOT NULL,bed_id integer NOT NULL,status text NOT NULL)',
      );
      await client.query("INSERT INTO admissions VALUES (1,1,1,1,'Admitted'),(2,1,2,1,'Admitted')");
      const migration = await readFile(
        'drizzle/0032_inpatient_active_admission_guards.sql',
        'utf8',
      );
      await client.query('SAVEPOINT before_guard');
      await expect(client.query(migration)).rejects.toMatchObject({ code: 'P0001' });
      await client.query('ROLLBACK TO SAVEPOINT before_guard');
      expect(
        (await client.query('SELECT COUNT(*)::int AS count FROM admissions')).rows[0].count,
      ).toBe(2);
      // Repair applies only to the temporary synthetic schema in this transaction.
      await client.query("UPDATE admissions SET status='Discharged' WHERE id=2");
      await client.query(migration);
      const indexes = (
        await client.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='admissions'",
          [name],
        )
      ).rows.map((r) => r.indexname);
      expect(indexes).toEqual(
        expect.arrayContaining([
          'admissions_active_bed_uq',
          'admissions_active_facility_patient_uq',
        ]),
      );
      await client.query('SAVEPOINT duplicate_bed');
      await expect(
        client.query("INSERT INTO admissions VALUES (3,1,2,1,'Admitted')"),
      ).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_bed');
      await client.query('SAVEPOINT duplicate_patient');
      await expect(
        client.query("INSERT INTO admissions VALUES (4,1,1,2,'Admitted')"),
      ).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_patient');
      // Closed admissions remain historical and do not reserve a bed.
      await client.query("INSERT INTO admissions VALUES (5,1,1,1,'Discharged')");
      expect(
        (await client.query('SELECT COUNT(*)::int AS count FROM admissions')).rows[0].count,
      ).toBe(3);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
