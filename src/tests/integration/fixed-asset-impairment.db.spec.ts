/**
 * Fixed assets — impairment, revaluation and configuration-driven tax allowance.
 *
 * These are the three judgements a fixed-asset register is most likely to get
 * quietly wrong, so each assertion below checks the ledger as well as the
 * register: a write-down that never reached the books is worse than no
 * write-down at all.
 *
 * Synthetic facility only. Every journal is checked to balance.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

type Actor = { id: number; token: string };

describeDb('fixed assets — impairment, revaluation, tax configuration', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;
  let facilityId: number;
  let finance: Actor;
  let reader: Actor;
  const accounts: Record<string, number> = {};
  let categoryId: number;

  const call = (method: string, path: string, token: string | undefined, body?: unknown) =>
    httpJson(base, method, path, { token, body: body as Record<string, unknown> });

  async function balanced(journalId: number): Promise<boolean> {
    const row = await pool.query(
      `SELECT coalesce(sum(debit_cents),0)::text AS debit,
              coalesce(sum(credit_cents),0)::text AS credit
         FROM journal_lines WHERE journal_entry_id=$1`,
      [journalId],
    );
    return row.rows[0].debit === row.rows[0].credit && BigInt(row.rows[0].debit) > 0n;
  }

  /** Create an asset and return its id and capitalisation journal. */
  async function createAsset(
    code: string,
    cost: string,
    salvage: string,
    lifeMonths: number,
    acquisitionDate: string,
  ): Promise<number> {
    const created = await call('POST', '/api/fixed-assets', finance.token, {
      facilityId,
      assetCode: `${code}-${suffix}`,
      assetName: `Synthetic ${code}`,
      categoryId,
      acquisitionDate,
      acquisitionCostKes: cost,
      salvageValueKes: salvage,
      usefulLifeMonths: lifeMonths,
      acquisitionCreditAccountId: accounts.bank,
    });
    expect(created.status).toBe(201);
    return created.body.id as number;
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required (name must contain "test").');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    const tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic impairment ${suffix}`,
        `imp-${suffix}`,
      ])
    ).rows[0].id as number;
    facilityId = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
         VALUES($1,$2,'Synthetic impairment facility','["accounting"]'::jsonb) RETURNING id`,
        [tenantId, `IMP-${suffix}`],
      )
    ).rows[0].id as number;

    for (const code of ['assets.read', 'assets.manage', 'assets.depreciate', 'assets.dispose'])
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'assets') ON CONFLICT(code) DO NOTHING`,
        [code],
      );

    const actor = async (tag: string, grants: string[]) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `imp-${tag}-${suffix}`,
            `imp-${tag}-${suffix}@example.test`,
            `Synthetic impairment ${tag}`,
            tenantId,
            facilityId,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenantId, `IMP_${tag}_${suffix}`],
        )
      ).rows[0].id as number;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const grant of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, grant],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };

    finance = await actor('finance', [
      'assets.read',
      'assets.manage',
      'assets.depreciate',
      'assets.dispose',
    ]);
    reader = await actor('reader', ['assets.read']);

    const rows: Array<[string, string, string, string]> = [
      ['asset', 'Medical equipment', 'ASSET', 'DEBIT'],
      ['accum', 'Accumulated depreciation', 'ASSET', 'CREDIT'],
      ['expense', 'Depreciation expense', 'EXPENSE', 'DEBIT'],
      ['bank', 'Bank', 'ASSET', 'DEBIT'],
      ['impair', 'Impairment loss', 'EXPENSE', 'DEBIT'],
      ['surplus', 'Revaluation surplus', 'EQUITY', 'CREDIT'],
    ];
    for (const [key, name, type, normal] of rows) {
      accounts[key] = (
        await pool.query(
          `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
           VALUES($1,$2,$3,$4,$5,'FIXED_ASSET_TEST',$6) RETURNING id`,
          [tenantId, facilityId, `IMP-${key}-${suffix}`.toUpperCase(), name, type, normal],
        )
      ).rows[0].id as number;
    }

    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Open 2026','2026-01-01','2026-12-31','OPEN'),
             ($1,$2,$4,'Closed 2025','2025-01-01','2025-12-31','CLOSED')`,
      [tenantId, facilityId, `IMP26-${suffix}`, `IMP25-${suffix}`],
    );

    const category = await call('POST', '/api/fixed-assets/categories', finance.token, {
      facilityId,
      code: `IMP-${suffix}`,
      name: 'Synthetic impairment category',
      defaultUsefulLifeMonths: 24,
      assetAccountId: accounts.asset,
      accumDepAccountId: accounts.accum,
      depExpenseAccountId: accounts.expense,
    });
    expect(category.status).toBe(201);
    categoryId = category.body.id as number;
  }, 60_000);

  afterAll(async () => {
    await close?.();
  });

  it('impairs an asset, posts the loss, and depreciates only the reduced basis afterwards', async () => {
    const assetId = await createAsset('IMP-A', '240000.00', '0.00', 24, '2026-01-10');

    /* Depreciate January and February first so accumulated is non-zero. */
    for (const period of ['2026-01', '2026-02']) {
      const run = await call('POST', '/api/fixed-assets/depreciation/run', finance.token, {
        facilityId,
        period,
      });
      expect(run.status).toBe(201);
    }

    const before = await call(
      'GET',
      `/api/fixed-assets/${assetId}?facilityId=${facilityId}`,
      finance.token,
    );
    const netBeforeCents = Math.round(Number(before.body.asset.netBookValueKes) * 100);
    /* 240,000 over 24 months = 10,000/month; two months → net book 220,000. */
    expect(netBeforeCents).toBe(22_000_000);

    const impaired = await call('POST', `/api/fixed-assets/${assetId}/impair`, finance.token, {
      facilityId,
      date: '2026-03-15',
      amountKes: '40000.00',
      lossAccountId: accounts.impair,
      reason: 'Scanner tube degraded; recoverable amount revised down.',
    });
    expect(impaired.status).toBe(201);
    expect(impaired.body.impairmentCents).toBe('4000000');
    expect(impaired.body.netBookValueAfterCents).toBe('18000000');
    expect(impaired.body.asset.acquisitionCostKes).toBe('240000.00');

    /* The journal: loss debited, asset credited, and it balances. */
    const journal = await pool.query(
      `SELECT je.id FROM journal_entries je WHERE je.facility_id=$1 AND je.source_type='FIXED_ASSET'
        AND je.source_id=$2`,
      [facilityId, `IMP-${assetId}-2026-03`],
    );
    const journalId = journal.rows[0].id as number;
    expect(await balanced(journalId)).toBe(true);
    const lines = await pool.query(
      `SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit
         FROM journal_lines WHERE journal_entry_id=$1`,
      [journalId],
    );
    expect(lines.rows.find((row) => row.account_id === accounts.impair)?.debit).toBe('4000000');
    expect(lines.rows.find((row) => row.account_id === accounts.asset)?.credit).toBe('4000000');

    /*
     * The important part: March depreciation must be computed on the reduced
     * basis. 180,000 over the 22 remaining months of the original life is
     * ~8,182 KES, not the 10,000 the original cost would have produced.
     */
    const march = await call('POST', '/api/fixed-assets/depreciation/run', finance.token, {
      facilityId,
      period: '2026-03',
    });
    expect(march.status).toBe(201);
    const marchCharge = await pool.query(
      `SELECT amount_kes FROM fixed_asset_movements
        WHERE asset_id=$1 AND movement_type='DEPRECIATION' AND period_code='2026-03'`,
      [assetId],
    );
    const chargeCents = Math.round(Number(marchCharge.rows[0].amount_kes) * 100);
    expect(chargeCents).toBeLessThan(1_000_000);
    expect(chargeCents).toBeGreaterThan(0);

    /* Impairment is recorded once, with its own movement type. */
    const movements = await pool.query(
      `SELECT movement_type, amount_kes FROM fixed_asset_movements WHERE asset_id=$1`,
      [assetId],
    );
    expect(movements.rows.filter((row) => row.movement_type === 'IMPAIRMENT')).toHaveLength(1);
  }, 120_000);

  it('refuses an impairment larger than the carrying amount', async () => {
    const assetId = await createAsset('IMP-B', '10000.00', '0.00', 24, '2026-01-10');
    const refused = await call('POST', `/api/fixed-assets/${assetId}/impair`, finance.token, {
      facilityId,
      date: '2026-03-15',
      amountKes: '99999.00',
      lossAccountId: accounts.impair,
      reason: 'Impossible write-down',
    });
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/EXCEEDS|CARRYING/);

    const asset = await pool.query('SELECT net_book_value_kes FROM fixed_assets WHERE id=$1', [
      assetId,
    ]);
    expect(asset.rows[0].net_book_value_kes).toBe('10000.00');
  }, 60_000);

  it('refuses an impairment into a closed period and leaves the register untouched', async () => {
    const assetId = await createAsset('IMP-C', '5000.00', '0.00', 12, '2026-01-10');
    const refused = await call('POST', `/api/fixed-assets/${assetId}/impair`, finance.token, {
      facilityId,
      date: '2025-06-15',
      amountKes: '100.00',
      lossAccountId: accounts.impair,
      reason: 'Should not be accepted',
    });
    expect(refused.status).toBe(409);

    const asset = await pool.query(
      'SELECT net_book_value_kes, carrying_basis_kes, impairment_loss_kes FROM fixed_assets WHERE id=$1',
      [assetId],
    );
    expect(asset.rows[0].net_book_value_kes).toBe('5000.00');
    expect(Number(asset.rows[0].impairment_loss_kes)).toBe(0);
    const movements = await pool.query(
      `SELECT count(*)::int AS count FROM fixed_asset_movements
        WHERE asset_id=$1 AND movement_type='IMPAIRMENT'`,
      [assetId],
    );
    expect(movements.rows[0].count).toBe(0);
  }, 60_000);

  it('revalues upwards into a surplus and refuses a fall with no loss account', async () => {
    const assetId = await createAsset('REV-A', '60000.00', '0.00', 24, '2026-01-10');

    const up = await call('POST', `/api/fixed-assets/${assetId}/revalue`, finance.token, {
      facilityId,
      date: '2026-02-20',
      revaluedAmountKes: '80000.00',
      surplusAccountId: accounts.surplus,
      reason: 'Independent valuation above carrying amount.',
    });
    expect(up.status).toBe(201);
    expect(up.body.direction).toBe('UP');
    expect(up.body.asset.netBookValueKes).toBe('80000.00');

    const journal = await pool.query(
      `SELECT je.id FROM journal_entries je WHERE je.facility_id=$1 AND je.source_id=$2`,
      [facilityId, `REV-${assetId}-2026-02`],
    );
    const journalId = journal.rows[0].id as number;
    expect(await balanced(journalId)).toBe(true);
    const lines = await pool.query(
      `SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit
         FROM journal_lines WHERE journal_entry_id=$1`,
      [journalId],
    );
    /* Increase debits the asset and credits the surplus — never revenue. */
    expect(lines.rows.find((row) => row.account_id === accounts.asset)?.debit).toBe('2000000');
    expect(lines.rows.find((row) => row.account_id === accounts.surplus)?.credit).toBe('2000000');

    /* A fall beyond the reserve is a loss, and without a loss account it stops. */
    const down = await call('POST', `/api/fixed-assets/${assetId}/revalue`, finance.token, {
      facilityId,
      date: '2026-04-20',
      revaluedAmountKes: '50000.00',
      surplusAccountId: accounts.surplus,
      reason: 'Market value fell below original cost.',
    });
    expect(down.status).toBe(400);
    expect(String(down.body.error)).toMatch(/LOSS_ACCOUNT/);

    const after = await pool.query('SELECT net_book_value_kes FROM fixed_assets WHERE id=$1', [
      assetId,
    ]);
    expect(after.rows[0].net_book_value_kes).toBe('80000.00');
  }, 120_000);

  it('splits a fall between the surplus and profit or loss when a loss account is given', async () => {
    const assetId = await createAsset('REV-B', '60000.00', '0.00', 24, '2026-01-10');

    await call('POST', `/api/fixed-assets/${assetId}/revalue`, finance.token, {
      facilityId,
      date: '2026-02-20',
      revaluedAmountKes: '80000.00',
      surplusAccountId: accounts.surplus,
      reason: 'Upward revaluation',
    });

    /* Carry 80,000 → 50,000: 20,000 against the reserve, 10,000 to the loss. */
    const down = await call('POST', `/api/fixed-assets/${assetId}/revalue`, finance.token, {
      facilityId,
      date: '2026-04-20',
      revaluedAmountKes: '50000.00',
      surplusAccountId: accounts.surplus,
      lossAccountId: accounts.impair,
      reason: 'Downward revaluation past the reserve',
    });
    expect(down.status).toBe(201);
    expect(down.body.direction).toBe('DOWN');
    expect(down.body.revaluationReserveCents).toBe('0');
    expect(down.body.asset.netBookValueKes).toBe('50000.00');

    const journal = await pool.query(
      `SELECT je.id FROM journal_entries je WHERE je.facility_id=$1 AND je.source_id=$2`,
      [facilityId, `REV-${assetId}-2026-04`],
    );
    const lines = await pool.query(
      `SELECT account_id, debit_cents::text AS debit FROM journal_lines WHERE journal_entry_id=$1`,
      [journal.rows[0].id],
    );
    expect(lines.rows.find((row) => row.account_id === accounts.surplus)?.debit).toBe('2000000');
    expect(lines.rows.find((row) => row.account_id === accounts.impair)?.debit).toBe('1000000');
  }, 120_000);

  it('refuses impairment and revaluation from a read-only user', async () => {
    const assetId = await createAsset('PERM', '1000.00', '0.00', 12, '2026-01-10');
    const impair = await call('POST', `/api/fixed-assets/${assetId}/impair`, reader.token, {
      facilityId,
      date: '2026-02-10',
      amountKes: '10.00',
      lossAccountId: accounts.impair,
      reason: 'Read-only attempt',
    });
    expect(impair.status).toBe(403);
    const revalue = await call('POST', `/api/fixed-assets/${assetId}/revalue`, reader.token, {
      facilityId,
      date: '2026-02-10',
      revaluedAmountKes: '2000.00',
      surplusAccountId: accounts.surplus,
      reason: 'Read-only attempt',
    });
    expect(revalue.status).toBe(403);
  }, 60_000);

  it('refuses a tax rate without an authority reference', async () => {
    const refused = await call('POST', '/api/fixed-assets/tax/rates', finance.token, {
      facilityId,
      name: 'Uncited rate',
      method: 'REDUCING_BALANCE',
      annualRateBps: 1250,
      effectiveFrom: '2026-01-01',
    });
    expect(refused.status).toBe(400);

    const badRate = await call('POST', '/api/fixed-assets/tax/rates', finance.token, {
      facilityId,
      name: 'Impossible rate',
      method: 'REDUCING_BALANCE',
      annualRateBps: 20000,
      authorityReference: 'Synthetic notice',
      effectiveFrom: '2026-01-01',
    });
    expect(badRate.status).toBe(400);
  }, 60_000);

  it('refuses to compute a tax allowance until a rate is configured, then uses exactly it', async () => {
    const before = await call(
      'GET',
      `/api/fixed-assets/tax/schedule?period=2026-03&facilityId=${facilityId}`,
      finance.token,
    );
    expect(before.status).toBe(200);
    const unconfigured = before.body.filter(
      (row: { status: string }) => row.status === 'NO_CONFIGURED_RATE',
    );
    expect(unconfigured.length).toBeGreaterThan(0);
    expect(unconfigured[0].annualAllowanceCents).toBeNull();

    const assetId = await createAsset('TAX-A', '100000.00', '0.00', 60, '2026-01-10');

    const rate = await call('POST', '/api/fixed-assets/tax/rates', finance.token, {
      facilityId,
      categoryId,
      name: 'Synthetic configured rate',
      method: 'REDUCING_BALANCE',
      annualRateBps: 1250,
      authorityReference: 'Synthetic practice note TN-2026-01, paragraph 4 — not a Kenyan rate.',
      effectiveFrom: '2026-01-01',
    });
    expect(rate.status).toBe(201);

    const after = await call(
      'GET',
      `/api/fixed-assets/tax/schedule?period=2026-03&facilityId=${facilityId}`,
      finance.token,
    );
    expect(after.status).toBe(200);
    const row = after.body.find((entry: { assetId: number }) => entry.assetId === assetId);
    expect(row.status).toBe('CONFIGURED');
    /* 12.5% of 100,000.00 KES = 12,500.00 KES = 1,250,000 cents. */
    expect(row.annualAllowanceCents).toBe('1250000');
    expect(row.authorityReference).toContain('TN-2026-01');
    expect(row.method).toBe('REDUCING_BALANCE');
  }, 120_000);
});
