/**
 * Regression: a physical stock count with more than one variance line.
 *
 * Posting a count writes one ledger movement per item whose counted quantity
 * differs from the expected quantity. Every one of those movements used to be
 * written with `reference_id = String(countId)`, which collided with
 *
 *   inventory_movements_reference_once_idx
 *     (facility_id, reference_type, reference_id, movement_type)
 *
 * on the second variance line, so the whole transaction rolled back and a
 * two-item count could never be posted. The synthetic journey only ever
 * counted one item with a variance, which is why the defect survived it.
 *
 * These tests post a count with two variance lines (plus one unchanged line)
 * through the real HTTP surface, and check the ledger, the stock balances, and
 * that a replay is still refused.
 *
 * Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { describeDb } from '../vitest/support/db.ts';

describeDb('Stock count posting with multiple variance lines (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number;
  let facility: number;
  let peerFacility: number;
  let outsiderTenant: number;
  let outsiderFacility: number;
  let token: string;
  let peerToken: string;
  let outsiderToken: string;
  let base: string;
  let close: () => Promise<void>;
  let sequence = 0;

  const createItem = async (facilityId: number, label: string, stock: number) =>
    (
      await pool.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,category,unit,current_stock,store_location,is_active)
         VALUES($1,$2,$3,'Surgical','piece',$4,'Main Store',true) RETURNING id`,
        [facilityId, `SC-${label}-${suffix}-${++sequence}`, `Synthetic count ${label}`, stock],
      )
    ).rows[0].id as number;

  const stockOf = async (itemId: number) =>
    Number(
      (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId])).rows[0]
        .current_stock,
    );

  const openCount = (auth: string, facilityId: number, countNumber: string) =>
    httpJson(base, 'POST', '/api/inventory/stock-counts', {
      token: auth,
      body: {
        facilityId,
        countNumber,
        countDate: '2026-11-10',
        storeLocation: 'Main Store',
        notes: 'Synthetic multi-line count regression.',
      },
    });

  const countLine = (
    auth: string,
    facilityId: number,
    countId: number,
    itemId: number,
    countedQuantity: number,
  ) =>
    httpJson(base, 'POST', `/api/inventory/stock-counts/${countId}/lines`, {
      token: auth,
      body: { facilityId, itemId, countedQuantity },
    });

  const postCount = (auth: string, facilityId: number, countId: number) =>
    httpJson(base, 'POST', `/api/inventory/stock-counts/${countId}/post`, {
      token: auth,
      body: { facilityId },
    });

  const varianceMovements = async (facilityId: number, referenceIdPrefix: string) =>
    (
      await pool.query(
        `SELECT item_id, quantity_delta, stock_after, reference_type, reference_id
           FROM inventory_movements
          WHERE facility_id = $1
            AND movement_type = 'COUNT_VARIANCE'
            AND reference_id LIKE $2
          ORDER BY item_id`,
        [facilityId, `${referenceIdPrefix}%`],
      )
    ).rows;

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic DB required.');

    [tenant, outsiderTenant] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic count tenant ${suffix}`,
        `stock-count-${suffix}`,
        `Synthetic count outsider ${suffix}`,
        `stock-count-other-${suffix}`,
      ])
    ).rows.map((row) => row.id);

    [facility, peerFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic count facility','Africa/Nairobi','["inventory"]'),
               ($1,$3,'Synthetic count peer','Africa/Nairobi','["inventory"]') RETURNING id`,
        [tenant, `SC-A-${suffix}`, `SC-B-${suffix}`],
      )
    ).rows.map((row) => row.id);

    outsiderFacility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic count outsider facility','Africa/Nairobi','["inventory"]') RETURNING id`,
        [outsiderTenant, `SC-X-${suffix}`],
      )
    ).rows[0].id;

    for (const code of ['inventory.read', 'inventory.manage'])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'inventory') ON CONFLICT(code) DO NOTHING",
        [code],
      );

    const makeActor = async (name: string, t: number, f: number) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic count user','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`stock-count-${name}-${suffix}`, `sc-${name}-${suffix}@example.test`, t, f],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, `STOCK_COUNT_${name}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const code of ['inventory.read', 'inventory.manage'])
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return (await createSession({ userId: id, securityVersion: 1 })).sessionToken as string;
    };

    token = await makeActor('manager', tenant, facility);
    peerToken = await makeActor('peer', tenant, peerFacility);
    outsiderToken = await makeActor('outsider', outsiderTenant, outsiderFacility);

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('posts every variance line in a multi-line count and explains each in the ledger', async () => {
    const counted = await createItem(facility, 'counted', 100);
    const increased = await createItem(facility, 'increased', 50);
    const unchanged = await createItem(facility, 'unchanged', 20);

    const countNumber = `SC-${suffix}-MULTI`;
    const opened = await openCount(token, facility, countNumber);
    expect(opened.status).toBe(201);
    const countId = opened.body.count.id as number;
    expect((opened.body.count.lines as unknown[]).length).toBeGreaterThanOrEqual(3);

    // Two real variances and one unchanged line, so the skip path still works.
    expect((await countLine(token, facility, countId, counted, 96)).status).toBe(200);
    expect((await countLine(token, facility, countId, increased, 55)).status).toBe(200);
    expect((await countLine(token, facility, countId, unchanged, 20)).status).toBe(200);

    const posted = await postCount(token, facility, countId);

    /*
     * This is the regression assertion. Before the fix the second variance
     * line violated inventory_movements_reference_once_idx and the request
     * returned a 500 with the count still OPEN and no stock changed.
     */
    expect(posted.status).toBe(200);
    expect(posted.body.count.status).toBe('POSTED');
    expect(posted.body.adjusted).toBe(2);
    expect(posted.body.netVariance).toBe(-4 + 5);

    expect(await stockOf(counted)).toBe(96);
    expect(await stockOf(increased)).toBe(55);
    expect(await stockOf(unchanged)).toBe(20);

    const movements = await varianceMovements(facility, `${countId}:`);
    expect(movements).toHaveLength(2);
    expect(movements.map((row) => row.item_id).sort()).toEqual([counted, increased].sort());
    expect(movements.map((row) => row.quantity_delta).sort()).toEqual([-4, 5]);
    expect(movements.every((row) => row.reference_type === 'STOCK_COUNT')).toBe(true);

    // One reference per item, not one per count: this is what makes them unique.
    const references = movements.map((row) => row.reference_id);
    expect(new Set(references).size).toBe(2);
    expect(references.sort()).toEqual([`${countId}:${counted}`, `${countId}:${increased}`].sort());
    expect(movements.map((row) => row.stock_after).sort()).toEqual([55, 96]);
  });

  it('refuses to post the same count twice and leaves stock untouched', async () => {
    const item = await createItem(facility, 'replay', 40);
    const opened = await openCount(token, facility, `SC-${suffix}-REPLAY`);
    const countId = opened.body.count.id as number;
    expect((await countLine(token, facility, countId, item, 37)).status).toBe(200);

    const first = await postCount(token, facility, countId);
    expect(first.status).toBe(200);
    expect(await stockOf(item)).toBe(37);

    const second = await postCount(token, facility, countId);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('COUNT_CLOSED');

    // The replay must not have written a second movement or moved stock again.
    expect(await stockOf(item)).toBe(37);
    expect(await varianceMovements(facility, `${countId}:`)).toHaveLength(1);
  });

  it('keeps counts inside their facility', async () => {
    const item = await createItem(facility, 'scoped', 10);
    const opened = await openCount(token, facility, `SC-${suffix}-SCOPE`);
    const countId = opened.body.count.id as number;
    expect((await countLine(token, facility, countId, item, 8)).status).toBe(200);

    // A manager of a sibling facility in the same tenant cannot post it …
    const peer = await postCount(peerToken, peerFacility, countId);
    expect(peer.status).toBe(404);
    expect(peer.body.error).toBe('STOCK_COUNT_NOT_FOUND');

    // … and neither can a manager from another tenant.
    const outsider = await postCount(outsiderToken, outsiderFacility, countId);
    expect(outsider.status).toBe(404);

    // The count is still open and stock never moved.
    expect(await stockOf(item)).toBe(10);
    const stillOpen = await httpJson(
      base,
      'GET',
      `/api/inventory/stock-counts/${countId}?facilityId=${facility}`,
      { token },
    );
    expect(stillOpen.status).toBe(200);
    expect(stillOpen.body.count.status).toBe('OPEN');
  });
});
