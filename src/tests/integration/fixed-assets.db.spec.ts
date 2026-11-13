/**
 * Fixed assets — authenticated HTTP and PostgreSQL tests.
 *
 * Synthetic facility only. The test proves the whole path an accountant cares
 * about: register → capitalisation journal → depreciation run (idempotent) →
 * disposal journal, plus tenant/facility isolation and permission refusals.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

type Actor = { id: number; token: string };

describeDb('fixed assets', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;
  let tenantA: number;
  let tenantB: number;
  let facilityA: number;
  let facilityB: number;
  let manager: Actor;
  let finance: Actor;
  let reader: Actor;
  let foreign: Actor;
  const accounts: Record<string, number> = {};
  let categoryId: number;
  let assetId: number;
  let costCents: number;

  const call = (method: string, path: string, token: string | undefined, body?: unknown) =>
    httpJson(base, method, path, { token, body: body as Record<string, unknown> });

  async function journalBalanced(journalId: number): Promise<boolean> {
    const row = await pool.query(
      `SELECT coalesce(sum(debit_cents),0)::text AS debit, coalesce(sum(credit_cents),0)::text AS credit
       FROM journal_lines WHERE journal_entry_id=$1`,
      [journalId],
    );
    return row.rows[0].debit === row.rows[0].credit && BigInt(row.rows[0].debit) > 0n;
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required (name must contain "test").');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    [tenantA, tenantB] = (
      await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`, [
        `Synthetic assets A ${suffix}`,
        `fa-a-${suffix}`,
        `Synthetic assets B ${suffix}`,
        `fa-b-${suffix}`,
      ])
    ).rows.map((row) => row.id);
    [facilityA, facilityB] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
          ($1,$2,'Synthetic asset facility','["accounting"]'::jsonb),
          ($3,$4,'Synthetic other facility','["accounting"]'::jsonb) RETURNING id`,
        [tenantA, `FAA-${suffix}`, tenantB, `FAB-${suffix}`],
      )
    ).rows.map((row) => row.id);

    for (const code of ['assets.read', 'assets.manage', 'assets.depreciate', 'assets.dispose'])
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'assets') ON CONFLICT(code) DO NOTHING`,
        [code],
      );

    const actor = async (tag: string, tenant: number, facility: number, grants: string[]) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `fa-${tag}-${suffix}`,
            `fa-${tag}-${suffix}@example.test`,
            `Synthetic asset ${tag}`,
            tenant,
            facility,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `FA_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const grant of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, grant],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };

    manager = await actor('manager', tenantA, facilityA, ['assets.read', 'assets.manage']);
    finance = await actor('finance', tenantA, facilityA, [
      'assets.read',
      'assets.depreciate',
      'assets.dispose',
    ]);
    reader = await actor('reader', tenantA, facilityA, ['assets.read']);
    foreign = await actor('foreign', tenantB, facilityB, [
      'assets.read',
      'assets.manage',
      'assets.depreciate',
      'assets.dispose',
    ]);

    const accountRows: Array<[string, string, string, string]> = [
      ['FA-1500', 'Medical equipment', 'ASSET', 'DEBIT'],
      ['FA-1590', 'Accumulated depreciation', 'ASSET', 'CREDIT'],
      ['FA-5200', 'Depreciation expense', 'EXPENSE', 'DEBIT'],
      ['FA-1100', 'Bank', 'ASSET', 'DEBIT'],
      ['FA-1110', 'Disposal proceeds', 'ASSET', 'DEBIT'],
      ['FA-4300', 'Gain or loss on disposal', 'REVENUE', 'CREDIT'],
    ];
    for (const [code, name, type, normal] of accountRows) {
      const row = await pool.query(
        `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
         VALUES($1,$2,$3,$4,$5,'FIXED_ASSET_TEST',$6) RETURNING id`,
        [tenantA, facilityA, `${code}-${suffix}`, name, type, normal],
      );
      accounts[code] = row.rows[0].id;
    }
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic year','2026-01-01','2026-12-31','OPEN')`,
      [tenantA, facilityA, `FA-${suffix}`],
    );
  }, 60_000);

  afterAll(async () => {
    await close?.();
  });

  it('refuses a reader who tries to create a category or asset', async () => {
    const category = await call('POST', '/api/fixed-assets/categories', reader.token, {
      facilityId: facilityA,
      code: `X${suffix}`,
      name: 'Should not exist',
      defaultUsefulLifeMonths: 60,
      assetAccountId: accounts['FA-1500'],
      accumDepAccountId: accounts['FA-1590'],
      depExpenseAccountId: accounts['FA-5200'],
    });
    expect(category.status).toBe(403);
  });

  it('creates a category and a capitalised asset with a balanced journal', async () => {
    const category = await call('POST', '/api/fixed-assets/categories', manager.token, {
      facilityId: facilityA,
      code: `EQUIP-${suffix}`,
      name: 'Synthetic medical equipment',
      defaultUsefulLifeMonths: 12,
      assetAccountId: accounts['FA-1500'],
      accumDepAccountId: accounts['FA-1590'],
      depExpenseAccountId: accounts['FA-5200'],
    });
    expect(category.status).toBe(201);
    categoryId = category.body.id;

    costCents = 12_000_000;
    const created = await call('POST', '/api/fixed-assets', manager.token, {
      facilityId: facilityA,
      assetCode: `AST-${suffix}`,
      assetName: 'Synthetic ultrasound scanner',
      categoryId,
      acquisitionDate: '2026-01-15',
      acquisitionCostKes: '120000.00',
      salvageValueKes: '12000.00',
      usefulLifeMonths: 12,
      acquisitionCreditAccountId: accounts['FA-1100'],
      location: 'Synthetic imaging room',
    });
    expect(created.status).toBe(201);
    assetId = created.body.id;

    const detail = await call(
      'GET',
      `/api/fixed-assets/${assetId}?facilityId=${facilityA}`,
      manager.token,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.asset.netBookValueKes).toBe('120000.00');
    expect(detail.body.movements).toHaveLength(1);
    const journalId = detail.body.movements[0].journalEntryId as number;
    expect(journalId).toBeTruthy();
    expect(await journalBalanced(journalId)).toBe(true);

    const lines = await pool.query(
      `SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit
       FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id`,
      [journalId],
    );
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows.find((row) => row.account_id === accounts['FA-1500'])?.debit).toBe(
      String(costCents),
    );
    expect(lines.rows.find((row) => row.account_id === accounts['FA-1100'])?.credit).toBe(
      String(costCents),
    );
  });

  it('refuses a second asset with the same code in the facility', async () => {
    const duplicate = await call('POST', '/api/fixed-assets', manager.token, {
      facilityId: facilityA,
      assetCode: `AST-${suffix}`,
      assetName: 'Duplicate',
      categoryId,
      acquisitionDate: '2026-02-01',
      acquisitionCostKes: '1000.00',
      acquisitionCreditAccountId: accounts['FA-1100'],
    });
    expect(duplicate.status).toBe(409);
  });

  it('isolates the register across tenants and facilities', async () => {
    const foreignRead = await call(
      'GET',
      `/api/fixed-assets/${assetId}?facilityId=${facilityB}`,
      foreign.token,
    );
    expect([403, 404]).toContain(foreignRead.status);
    const foreignCreate = await call('POST', '/api/fixed-assets', foreign.token, {
      facilityId: facilityA,
      assetCode: `CROSS-${suffix}`,
      assetName: 'Cross-tenant asset',
      categoryId,
      acquisitionDate: '2026-02-01',
      acquisitionCostKes: '1000.00',
      acquisitionCreditAccountId: accounts['FA-1100'],
    });
    expect([403, 404]).toContain(foreignCreate.status);
    const rows = await pool.query(
      'SELECT count(*)::int AS count FROM fixed_assets WHERE facility_id=$1',
      [facilityA],
    );
    expect(rows.rows[0].count).toBe(1);
  });

  it('previews and posts depreciation once, then refuses to duplicate it', async () => {
    const preview = await call(
      'GET',
      `/api/fixed-assets/depreciation/preview?period=2026-02&facilityId=${facilityA}`,
      finance.token,
    );
    expect(preview.status).toBe(200);
    expect(preview.body[0].chargeCents).toBe('900000');
    expect(preview.body[0].alreadyPosted).toBe(false);

    const managerAttempt = await call('POST', '/api/fixed-assets/depreciation/run', manager.token, {
      facilityId: facilityA,
      period: '2026-02',
      entryDate: '2026-02-28',
    });
    expect(managerAttempt.status).toBe(403);

    const run = await call('POST', '/api/fixed-assets/depreciation/run', finance.token, {
      facilityId: facilityA,
      period: '2026-02',
      entryDate: '2026-02-28',
    });
    expect(run.status).toBe(201);
    expect(run.body.assetsCharged).toBe(1);
    expect(run.body.chargedCents).toBe('900000');
    expect(await journalBalanced(Number(String(run.body.journalId)))).toBe(true);

    const asset = await call(
      'GET',
      `/api/fixed-assets/${assetId}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(asset.body.asset.accumulatedDepreciationKes).toBe('9000.00');
    expect(asset.body.asset.netBookValueKes).toBe('111000.00');

    const repeat = await call('POST', '/api/fixed-assets/depreciation/run', finance.token, {
      facilityId: facilityA,
      period: '2026-02',
      entryDate: '2026-02-28',
    });
    expect(repeat.status).toBe(201);
    expect(repeat.body.assetsCharged).toBe(0);
    expect(repeat.body.alreadyPosted).toBe(true);

    const journals = await pool.query(
      `SELECT count(*)::int AS count FROM journal_entries
       WHERE facility_id=$1 AND source_type='FIXED_ASSET' AND source_id=$2`,
      [facilityA, 'DEP-2026-02'],
    );
    expect(journals.rows[0].count).toBe(1);
  });

  it('does not depreciate an asset before its acquisition month', async () => {
    const preview = await call(
      'GET',
      `/api/fixed-assets/depreciation/preview?period=2025-12&facilityId=${facilityA}`,
      finance.token,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toHaveLength(0);
  });

  it('posts a balanced disposal, records the loss and refuses a second disposal', async () => {
    const disposed = await call('POST', `/api/fixed-assets/${assetId}/dispose`, finance.token, {
      facilityId: facilityA,
      disposalDate: '2026-03-15',
      proceedsKes: '50000.00',
      proceedsAccountId: accounts['FA-1110'],
      gainLossAccountId: accounts['FA-4300'],
      reason: 'Sold after replacement — synthetic evidence',
    });
    expect(disposed.status).toBe(201);
    // Cost 120 000, accumulated 9 000, proceeds 50 000 → loss 61 000.
    expect(disposed.body.gainLossCents).toBe('-6100000');

    const journal = await pool.query(
      `SELECT id FROM journal_entries WHERE facility_id=$1 AND source_type='FIXED_ASSET' AND source_id=$2`,
      [facilityA, `DISP-${assetId}`],
    );
    expect(journal.rows).toHaveLength(1);
    expect(await journalBalanced(journal.rows[0].id)).toBe(true);

    const detail = await call(
      'GET',
      `/api/fixed-assets/${assetId}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(detail.body.asset.status).toBe('DISPOSED');
    expect(detail.body.asset.netBookValueKes).toBe('0.00');

    const again = await call('POST', `/api/fixed-assets/${assetId}/dispose`, finance.token, {
      facilityId: facilityA,
      disposalDate: '2026-03-16',
      proceedsKes: '0',
      gainLossAccountId: accounts['FA-4300'],
      reason: 'Duplicate disposal attempt',
    });
    expect(again.status).toBe(409);
  });

  it('reports the register by category and refuses disposal by a register manager', async () => {
    const report = await call(
      'GET',
      `/api/fixed-assets/report?facilityId=${facilityA}`,
      reader.token,
    );
    expect(report.status).toBe(200);
    expect(Array.isArray(report.body)).toBe(true);

    const refused = await call('POST', `/api/fixed-assets/${assetId}/dispose`, manager.token, {
      facilityId: facilityA,
      disposalDate: '2026-04-01',
      gainLossAccountId: accounts['FA-4300'],
      reason: 'Manager must not dispose',
    });
    expect(refused.status).toBe(403);
  });
});
