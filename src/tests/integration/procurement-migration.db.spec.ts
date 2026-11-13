import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { describeDb, testPool } from '../vitest/support/db.ts';

describeDb('additive procurement migration', () => {
  it('upgrades and preserves a synthetic legacy order and supplier; can be re-run safely', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const pool = testPool();
    const client = await pool.connect();
    const name = `proc_migration_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE SCHEMA "${name}"`);
      await client.query(`SET search_path TO "${name}"`);
      await client.query(`CREATE TABLE users (id serial PRIMARY KEY);
        CREATE TABLE suppliers (id serial PRIMARY KEY, name text NOT NULL);
        CREATE TABLE purchase_orders (id serial PRIMARY KEY, supplier_id integer NOT NULL REFERENCES suppliers(id), po_number text NOT NULL, total_amount numeric(12,2), status text);
        CREATE TABLE supplier_invoices (id serial PRIMARY KEY, purchase_order_id integer REFERENCES purchase_orders(id));
        INSERT INTO suppliers(name) VALUES ('Legacy supplier');
        INSERT INTO purchase_orders(supplier_id,po_number,total_amount,status) VALUES (1,'LEGACY-1','123.45','Approved');
        INSERT INTO supplier_invoices(purchase_order_id) VALUES (1);`);
      const sql = await readFile('drizzle/0030_procurement_workflow.sql', 'utf8');
      await client.query(sql);
      await client.query(sql);
      const order = (
        await client.query(
          'SELECT supplier_id,po_number,total_amount,status,revision,subtotal_amount,created_by_user_id FROM purchase_orders WHERE id=1',
        )
      ).rows[0];
      expect(order).toEqual({
        supplier_id: 1,
        po_number: 'LEGACY-1',
        total_amount: '123.45',
        status: 'Approved',
        revision: 1,
        subtotal_amount: null,
        created_by_user_id: null,
      });
      expect(
        (await client.query('SELECT purchase_order_id FROM supplier_invoices WHERE id=1')).rows[0]
          .purchase_order_id,
      ).toBe(1);
      expect(
        (await client.query('SELECT revision FROM suppliers WHERE id=1')).rows[0].revision,
      ).toBe(1);
      await client.query(
        `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total) VALUES (1,1,'Synthetic',1,'unit',1,1)`,
      );
      await expect(
        client.query(
          `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total) VALUES (1,2,'Invalid',0,'unit',1,0)`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      client.release();
    }
  });
});
