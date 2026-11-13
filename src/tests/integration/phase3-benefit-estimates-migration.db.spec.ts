import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';

describeDb('Phase 3 nullable benefit estimates migration (synthetic PostgreSQL)', () => {
  it('preserves old amounts, records unknown as null and refuses unsafe rollback', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A private temp table shadows only this connection's table; no application
      // rows or migration tracking records are changed by this regression.
      await client.query(`CREATE TEMP TABLE insurance_benefit_validations (
        id integer PRIMARY KEY,
        deductible_estimate numeric(12,2) NOT NULL DEFAULT '0.00',
        estimated_copay_amount numeric(12,2) NOT NULL DEFAULT '0.00'
      ) ON COMMIT DROP`);
      await client.query(`INSERT INTO insurance_benefit_validations VALUES
        (1, '12.34', '0.00'), (2, '0.00', '56.78')`);
      const migration = await readFile('drizzle/0071_nullable_benefit_estimates.sql', 'utf8');
      await client.query(migration);
      const old = await client.query('SELECT * FROM insurance_benefit_validations ORDER BY id');
      expect(old.rows).toEqual([
        { id: 1, deductible_estimate: '12.34', estimated_copay_amount: '0.00' },
        { id: 2, deductible_estimate: '0.00', estimated_copay_amount: '56.78' },
      ]);
      await client.query('SAVEPOINT unknown_estimate');
      const unknown = await client.query(
        'INSERT INTO insurance_benefit_validations(id) VALUES(3) RETURNING *',
      );
      expect(unknown.rows[0]).toEqual({
        id: 3,
        deductible_estimate: null,
        estimated_copay_amount: null,
      });
      await expect(
        client.query(
          'ALTER TABLE insurance_benefit_validations ALTER COLUMN deductible_estimate SET NOT NULL',
        ),
      ).rejects.toMatchObject({ code: '23502' });
      await client.query('ROLLBACK TO SAVEPOINT unknown_estimate');
      // A downgrade is structurally possible only after nulls are resolved;
      // this test does not fill or rewrite them with invented values.
      await client.query(`ALTER TABLE insurance_benefit_validations
        ALTER COLUMN deductible_estimate SET NOT NULL,
        ALTER COLUMN deductible_estimate SET DEFAULT '0.00',
        ALTER COLUMN estimated_copay_amount SET NOT NULL,
        ALTER COLUMN estimated_copay_amount SET DEFAULT '0.00'`);
      const restored = await client.query(
        'SELECT * FROM insurance_benefit_validations ORDER BY id',
      );
      expect(restored.rows).toEqual(old.rows);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
