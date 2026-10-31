import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

describeDb('clinical workflow migration preflights', () => {
  it.each([
    [
      'drizzle/0034_pharmacy_workflow_safety.sql',
      'pharmacy_dispense_requests',
      'medication_status_events',
    ],
    ['drizzle/0035_shared_lab_specimens.sql', 'lab_specimens', 'lab_specimen_orders'],
    ['drizzle/0036_refund_receipt_safety.sql', 'billing_refunds', 'billing_refund_receipt_seq'],
  ])('refuses to adopt an unjournaled %s object', async (file, existing, absent) => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const client = await testPool().connect();
    const name = `workflow_guard_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${name}"`);
      await client.query(`SET LOCAL search_path TO "${name}"`);
      await client.query('CREATE TABLE lab_orders(id integer PRIMARY KEY)');
      await client.query(`CREATE TABLE "${existing}"(id integer PRIMARY KEY)`);
      await client.query('SAVEPOINT before_migration');
      await expect(client.query(await readFile(file, 'utf8'))).rejects.toMatchObject({
        code: 'P0001',
      });
      await client.query('ROLLBACK TO SAVEPOINT before_migration');
      expect(
        (await client.query('SELECT to_regclass($1) AS object', [absent])).rows[0].object,
      ).toBe(null);
      expect((await client.query(`SELECT count(*)::int AS n FROM "${existing}"`)).rows[0].n).toBe(
        0,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
