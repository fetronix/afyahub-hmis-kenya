import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

describeDb('inventory receipt retry migration preflight', () => {
  const pool = testPool();
  const migration = () => readFile('drizzle/0073_inventory_receipt_retry_identity.sql', 'utf8');

  async function fixture(client: PoolClient, name: string): Promise<void> {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${name}"`);
    await client.query(`SET LOCAL search_path TO "${name}"`);
    for (const table of ['tenants', 'facilities', 'users', 'inventory_items', 'inventory_batches'])
      await client.query(`CREATE TABLE "${table}"(id integer PRIMARY KEY)`);
  }

  it.each([
    ['table', 'P0001'],
    ['function', 'P0001'],
    ['index', '42P07'],
  ])(
    'rejects a pre-existing %s without adopting or leaving partial objects',
    async (collision, code) => {
      const client = await pool.connect();
      const name = `receipt_migration_${randomUUID().replaceAll('-', '')}`;
      try {
        await fixture(client, name);
        if (collision === 'table') {
          await client.query(
            'CREATE TABLE inventory_receipt_requests(id integer PRIMARY KEY, marker text)',
          );
          await client.query(
            "INSERT INTO inventory_receipt_requests VALUES(1,'synthetic sentinel')",
          );
        } else if (collision === 'function') {
          await client.query(
            'CREATE FUNCTION jcare_inventory_receipt_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',
          );
        } else {
          await client.query('CREATE TABLE unrelated(id integer)');
          await client.query(
            'CREATE INDEX inventory_receipt_requests_facility_key_idx ON unrelated(id)',
          );
        }
        await client.query('SAVEPOINT before_receipt_migration');
        await expect(client.query(await migration())).rejects.toMatchObject({ code });
        await client.query('ROLLBACK TO SAVEPOINT before_receipt_migration');
        const receipt = (
          await client.query("SELECT to_regclass('inventory_receipt_requests') AS name")
        ).rows[0].name;
        if (collision === 'table') {
          expect(receipt).not.toBe(null);
          expect(
            (await client.query('SELECT marker FROM inventory_receipt_requests WHERE id=1')).rows[0]
              .marker,
          ).toBe('synthetic sentinel');
        } else {
          expect(receipt).toBe(null);
        }
        const index = (
          await client.query(
            "SELECT to_regclass('inventory_receipt_requests_facility_key_idx') AS name",
          )
        ).rows[0].name;
        expect(index === null).toBe(collision !== 'index');
        const triggers = (
          await client.query(
            "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname='inventory_receipt_request_guard'",
            [name],
          )
        ).rows[0].n;
        expect(triggers).toBe(0);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    },
  );

  it('creates its complete objects in a transaction that can be rolled back', async () => {
    const client = await pool.connect();
    const name = `receipt_migration_${randomUUID().replaceAll('-', '')}`;
    try {
      await fixture(client, name);
      await client.query(await migration());
      expect(
        (await client.query("SELECT to_regclass('inventory_receipt_requests') AS name")).rows[0]
          .name,
      ).not.toBe(null);
      expect(
        (
          await client.query(
            "SELECT to_regclass('inventory_receipt_requests_facility_key_idx') AS name",
          )
        ).rows[0].name,
      ).not.toBe(null);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname='inventory_receipt_request_guard' AND NOT t.tgisinternal",
            [name],
          )
        ).rows[0].n,
      ).toBe(1);
      await client.query('ROLLBACK');
      expect((await client.query('SELECT to_regnamespace($1) AS name', [name])).rows[0].name).toBe(
        null,
      );
    } finally {
      // ROLLBACK is harmless if the successful branch already rolled back.
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
