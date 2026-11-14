import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

describeDb('additive Theatre scheduling migration', () => {
  it('preserves a synthetic legacy case and installs conflict constraints', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const client = await testPool().connect();
    const name = `theatre_migration_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${name}"`);
      await client.query(`SET LOCAL search_path TO "${name}"`);
      await client.query(`CREATE TABLE tenants (id integer PRIMARY KEY);
        CREATE TABLE facilities (id integer PRIMARY KEY);
        CREATE TABLE users (id integer PRIMARY KEY);
        CREATE TABLE patients (id integer PRIMARY KEY);
        CREATE TABLE practitioners (id integer PRIMARY KEY);
        CREATE TABLE encounters (id integer PRIMARY KEY);
        CREATE TABLE admissions (id integer PRIMARY KEY);
        CREATE TABLE theatre_cases (id integer PRIMARY KEY, patient_id integer NOT NULL REFERENCES patients(id), procedure_name text, status text);
        INSERT INTO tenants VALUES (1); INSERT INTO facilities VALUES (2); INSERT INTO users VALUES (3);
        INSERT INTO patients VALUES (4); INSERT INTO practitioners VALUES (5);
        INSERT INTO theatre_cases VALUES (6,4,'Synthetic legacy procedure','Scheduled');`);
      const migration = await readFile('drizzle/0031_theatre_scheduling.sql', 'utf8');
      await client.query(migration);
      expect(
        (await client.query('SELECT id,patient_id,procedure_name,status FROM theatre_cases')).rows,
      ).toEqual([
        { id: 6, patient_id: 4, procedure_name: 'Synthetic legacy procedure', status: 'Scheduled' },
      ]);
      expect(
        (await client.query('SELECT count(*)::int AS count FROM theatre_bookings')).rows[0].count,
      ).toBe(0);
      const constraints = await client.query(
        "SELECT conname,contype FROM pg_constraint WHERE conrelid='theatre_bookings'::regclass",
      );
      const exclusion = constraints.rows
        .filter((row) => row.contype === 'x')
        .map((row) => row.conname)
        .sort();
      expect(exclusion).toEqual([
        'theatre_booking_no_patient_overlap',
        'theatre_booking_no_practitioner_overlap',
        'theatre_booking_no_room_overlap',
      ]);
      expect(
        constraints.rows.some(
          (row) => row.conname === 'theatre_booking_case_patient_fk' && row.contype === 'f',
        ),
      ).toBe(true);
      // A duplicate execution is refused rather than silently accepting unverified objects.
      await expect(client.query(migration)).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
