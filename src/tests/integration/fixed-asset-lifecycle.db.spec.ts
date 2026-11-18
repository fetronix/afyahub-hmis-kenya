/**
 * Fixed-asset lifecycle — authenticated HTTP and PostgreSQL tests.
 *
 * Synthetic facility only. Covers registration with the new identification and
 * acquisition detail, all three depreciation conventions, the approval batch
 * lifecycle (prepare → approve → post → reverse), duplicate prevention,
 * preventive and corrective maintenance, inspections, lifecycle transitions,
 * documents, reports and cross-facility isolation.
 *
 * Every expected amount is written from the requirement's arithmetic:
 * KES 1,200,000 over 120 months is KES 10,000 a month, and the convention
 * decides which months receive it.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

type Actor = { id: number; token: string };

describeDb('fixed asset lifecycle', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;
  let tenantA: number;
  let tenantB: number;
  let facilityA: number;
  let facilityB: number;
  let manager: Actor;
  let accountant: Actor;
  let approver: Actor;
  let inspector: Actor;
  let reader: Actor;
  let foreign: Actor;
  const accounts: Record<string, number> = {};
  let categoryId: number;
  const assets: Record<string, number> = {};
  let novBatchId = 0;

  const call = (method: string, path: string, token: string | undefined, body?: unknown) =>
    httpJson(base, method, path, { token, body: body as Record<string, unknown> });

  const assetBody = (overrides: Record<string, unknown>) => ({
    facilityId: facilityA,
    categoryId,
    acquisitionCreditAccountId: accounts['FA-1100'],
    acquisitionDate: '2026-11-01',
    ...overrides,
  });

  async function balanced(journalId: number): Promise<boolean> {
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
        `Synthetic lifecycle A ${suffix}`,
        `fal-a-${suffix}`,
        `Synthetic lifecycle B ${suffix}`,
        `fal-b-${suffix}`,
      ])
    ).rows.map((row) => row.id);
    [facilityA, facilityB] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
          ($1,$2,'Synthetic lifecycle facility','["accounting"]'::jsonb),
          ($3,$4,'Synthetic other lifecycle facility','["accounting"]'::jsonb) RETURNING id`,
        [tenantA, `FALA-${suffix}`, tenantB, `FALB-${suffix}`],
      )
    ).rows.map((row) => row.id);

    const permissionCodes = [
      'assets.read',
      'assets.manage',
      'assets.depreciate',
      'assets.dispose',
      'assets.depreciation.approve',
      'assets.depreciation.configure',
      'assets.maintenance.manage',
      'assets.inspections.perform',
      'assets.transfer',
      'assets.reports.financial',
    ];
    for (const code of permissionCodes)
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
            `fal-${tag}-${suffix}`,
            `fal-${tag}-${suffix}@example.test`,
            `Synthetic lifecycle ${tag}`,
            tenant,
            facility,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `FAL_${tag}_${suffix}`],
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

    manager = await actor('manager', tenantA, facilityA, [
      'assets.read',
      'assets.manage',
      'assets.transfer',
    ]);
    accountant = await actor('accountant', tenantA, facilityA, [
      'assets.read',
      'assets.depreciate',
    ]);
    approver = await actor('approver', tenantA, facilityA, [
      'assets.read',
      'assets.depreciate',
      'assets.depreciation.approve',
      'assets.depreciation.configure',
      'assets.reports.financial',
    ]);
    inspector = await actor('inspector', tenantA, facilityA, [
      'assets.read',
      'assets.maintenance.manage',
      'assets.inspections.perform',
    ]);
    reader = await actor('reader', tenantA, facilityA, ['assets.read']);
    foreign = await actor('foreign', tenantB, facilityB, [
      'assets.read',
      'assets.manage',
      'assets.depreciate',
      'assets.depreciation.approve',
      'assets.reports.financial',
    ]);

    const accountRows: Array<[string, string, string, string]> = [
      ['FA-1500', 'Medical equipment', 'ASSET', 'DEBIT'],
      ['FA-1590', 'Accumulated depreciation', 'ASSET', 'CREDIT'],
      ['FA-5200', 'Depreciation expense', 'EXPENSE', 'DEBIT'],
      ['FA-1100', 'Bank', 'ASSET', 'DEBIT'],
      ['FA-6100', 'Repairs and maintenance', 'EXPENSE', 'DEBIT'],
    ];
    for (const [code, name, type, normal] of accountRows) {
      const row = await pool.query(
        `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
         VALUES($1,$2,$3,$4,$5,'FIXED_ASSET_LIFECYCLE',$6) RETURNING id`,
        [tenantA, facilityA, `${code}-${suffix}`, name, type, normal],
      );
      accounts[code] = row.rows[0].id;
    }
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic year','2026-01-01','2026-12-31','OPEN')`,
      [tenantA, facilityA, `FAL-${suffix}`],
    );
  }, 60_000);

  afterAll(async () => {
    await close?.();
  });

  it('registers an asset with the full identification and acquisition record', async () => {
    const category = await call('POST', '/api/fixed-assets/categories', manager.token, {
      facilityId: facilityA,
      code: `MED-${suffix}`,
      name: 'Synthetic medical equipment',
      defaultUsefulLifeMonths: 120,
      assetAccountId: accounts['FA-1500'],
      accumDepAccountId: accounts['FA-1590'],
      depExpenseAccountId: accounts['FA-5200'],
    });
    expect(category.status).toBe(201);
    categoryId = category.body.id;

    const created = await call(
      'POST',
      '/api/fixed-assets',
      manager.token,
      assetBody({
        assetCode: `SCAN-${suffix}`,
        assetName: 'Synthetic ultrasound scanner',
        description: 'Synthetic diagnostic scanner used only by tests.',
        manufacturer: 'Synthetic Medical',
        model: 'US-10',
        serialNumber: `SN-${suffix}`,
        barcode: `QR-${suffix}`,
        location: 'Imaging room 1',
        placedInServiceDate: '2026-11-01',
        acquisitionMethod: 'PURCHASE',
        purchaseReference: `PO-${suffix}`,
        fundingSource: 'Facility capital budget',
        currency: 'KES',
        acquisitionCostKes: '1200000.00',
        salvageValueKes: '0.00',
        usefulLifeMonths: 120,
        depreciationCommencement: 'FULL_MONTH',
      }),
    );
    expect(created.status).toBe(201);
    assets.scanner = created.body.id;
    expect(created.body.purchaseReference).toBe(`PO-${suffix}`);
    expect(created.body.placementStatus ?? created.body.placedInServiceDate).toBeTruthy();

    const detail = await call(
      'GET',
      `/api/fixed-assets/${assets.scanner}?facilityId=${facilityA}`,
      manager.token,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.asset.barcode).toBe(`QR-${suffix}`);
    expect(detail.body.asset.depreciationCommencement).toBe('FULL_MONTH');
    expect(detail.body.asset.annualRateBps).toBe(1000);
    // Capitalisation debits the asset account and credits the funding account.
    const journalId = detail.body.movements[0].journalEntryId as number;
    expect(await balanced(journalId)).toBe(true);
    const lines = await pool.query(
      `SELECT account_id, debit_cents::text AS debit, credit_cents::text AS credit
       FROM journal_lines WHERE journal_entry_id=$1`,
      [journalId],
    );
    expect(lines.rows.find((row) => row.account_id === accounts['FA-1500'])?.debit).toBe(
      '120000000',
    );
    expect(lines.rows.find((row) => row.account_id === accounts['FA-1100'])?.credit).toBe(
      '120000000',
    );
  });

  it('refuses a duplicate asset code and a duplicate barcode in the facility', async () => {
    const duplicateCode = await call(
      'POST',
      '/api/fixed-assets',
      manager.token,
      assetBody({
        assetCode: `SCAN-${suffix}`,
        assetName: 'Duplicate code',
        acquisitionCostKes: '1000.00',
      }),
    );
    expect(duplicateCode.status).toBe(409);
    expect(duplicateCode.body.error).toBe('ASSET_CODE_EXISTS');

    const duplicateBarcode = await call(
      'POST',
      '/api/fixed-assets',
      manager.token,
      assetBody({
        assetCode: `OTHER-${suffix}`,
        assetName: 'Duplicate barcode',
        barcode: `QR-${suffix}`,
        acquisitionCostKes: '1000.00',
      }),
    );
    expect(duplicateBarcode.status).toBe(409);
    expect(duplicateBarcode.body.error).toBe('BARCODE_EXISTS');
  });

  it('shows KES 1,200,000 over 10 years as KES 10,000 a month', async () => {
    const preview = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches/preview',
      reader.token,
      {
        facilityId: facilityA,
        period: '2026-11',
      },
    );
    expect(preview.status).toBe(200);
    const row = preview.body.rows.find(
      (entry: { assetId: number }) => entry.assetId === assets.scanner,
    );
    expect(row.chargeCents).toBe('1000000');
    expect(row.basisCents).toBe('120000000');
    expect(row.annualRateBps).toBe(1000);
    expect(row.convention).toBe('FULL_MONTH');
  });

  it('charges November under the full-month convention', async () => {
    const november = await call(
      'GET',
      `/api/fixed-assets/depreciation/preview?period=2026-11&facilityId=${facilityA}`,
      accountant.token,
    );
    expect(november.status).toBe(200);
    const row = november.body.find(
      (entry: { assetId: number }) => entry.assetId === assets.scanner,
    );
    expect(row.chargeCents).toBe('1000000');
    expect(row.netBookValueAfterCents).toBe('119000000');
  });

  it('charges nothing in November but KES 10,000 in December under the following-month convention', async () => {
    const created = await call(
      'POST',
      '/api/fixed-assets',
      manager.token,
      assetBody({
        assetCode: `NEXT-${suffix}`,
        assetName: 'Synthetic next-month asset',
        acquisitionCostKes: '1200000.00',
        usefulLifeMonths: 120,
        depreciationCommencement: 'FOLLOWING_MONTH',
      }),
    );
    expect(created.status).toBe(201);
    assets.followingMonth = created.body.id;

    const november = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches/preview',
      reader.token,
      {
        facilityId: facilityA,
        period: '2026-11',
      },
    );
    const novRow = november.body.rows.find(
      (entry: { assetId: number }) => entry.assetId === assets.followingMonth,
    );
    expect(novRow ?? null).toBeNull();

    const december = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches/preview',
      reader.token,
      {
        facilityId: facilityA,
        period: '2026-12',
      },
    );
    const decRow = december.body.rows.find(
      (entry: { assetId: number }) => entry.assetId === assets.followingMonth,
    );
    expect(decRow.chargeCents).toBe('1000000');
  });

  it('pro-rates the first month for an asset placed in service mid-month', async () => {
    const created = await call(
      'POST',
      '/api/fixed-assets',
      manager.token,
      assetBody({
        assetCode: `PRORATA-${suffix}`,
        assetName: 'Synthetic pro-rata asset',
        acquisitionDate: '2026-11-10',
        placedInServiceDate: '2026-11-10',
        acquisitionCostKes: '120000.00',
        usefulLifeMonths: 12,
        depreciationCommencement: 'DAILY_PRORATA',
      }),
    );
    expect(created.status).toBe(201);
    assets.prorata = created.body.id;

    const preview = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches/preview',
      reader.token,
      {
        facilityId: facilityA,
        period: '2026-11',
      },
    );
    const row = preview.body.rows.find(
      (entry: { assetId: number }) => entry.assetId === assets.prorata,
    );
    // 10,000 × 21/30 = 7,000
    expect(row.chargeCents).toBe('700000');
    expect(row.daysInService).toBe(21);
    expect(row.periodDays).toBe(30);
  });

  it('spreads a residual value over the depreciable base only', async () => {
    const created = await call(
      'POST',
      '/api/fixed-assets',
      manager.token,
      assetBody({
        assetCode: `RESID-${suffix}`,
        assetName: 'Synthetic residual asset',
        acquisitionCostKes: '1200000.00',
        salvageValueKes: '200000.00',
        usefulLifeMonths: 120,
        depreciationCommencement: 'FULL_MONTH',
      }),
    );
    expect(created.status).toBe(201);
    assets.residual = created.body.id;

    const preview = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches/preview',
      reader.token,
      {
        facilityId: facilityA,
        period: '2026-11',
      },
    );
    const row = preview.body.rows.find(
      (entry: { assetId: number }) => entry.assetId === assets.residual,
    );
    // 1,000,000 / 120 = 8,333.33
    expect(row.chargeCents).toBe('833333');
    expect(row.salvageCents).toBe('20000000');
    expect(row.basisCents).toBe('100000000');
  });

  it('clears the asset exactly by the end of its useful life and never below residual', async () => {
    const schedule = await call(
      'GET',
      `/api/fixed-assets/depreciation/schedule/${assets.scanner}?months=120&facilityId=${facilityA}`,
      reader.token,
    );
    expect(schedule.status).toBe(200);
    expect(schedule.body.rows).toHaveLength(120);
    const total = schedule.body.rows.reduce(
      (sum: bigint, row: { chargeCents: string }) => sum + BigInt(row.chargeCents),
      0n,
    );
    expect(total).toBe(120_000_000n);
    expect(schedule.body.rows.at(-1).closingBookValueCents).toBe('0');
    expect(schedule.body.asset.convention).toBe('FULL_MONTH');
    expect(schedule.body.asset.conventionSource).toBe('ASSET_OVERRIDE');
  });

  it('requires approval before a prepared batch reaches the ledger', async () => {
    const prepared = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches',
      accountant.token,
      {
        facilityId: facilityA,
        period: '2026-11',
        notes: 'November 2026 depreciation',
      },
    );
    expect(prepared.status).toBe(201);
    expect(prepared.body.status).toBe('DRAFT');
    expect(prepared.body.assetCount).toBeGreaterThan(0);
    novBatchId = prepared.body.id;

    const journalsBefore = await pool.query(
      `SELECT count(*)::int AS total FROM journal_entries WHERE facility_id=$1 AND source_id=$2`,
      [facilityA, 'DEP-2026-11'],
    );
    expect(journalsBefore.rows[0].total).toBe(0);

    const postDraft = await call(
      'POST',
      `/api/fixed-assets/depreciation/batches/${novBatchId}/post`,
      approver.token,
      { facilityId: facilityA },
    );
    expect(postDraft.status).toBe(409);
    expect(postDraft.body.error).toBe('APPROVAL_REQUIRED');
  });

  it('prevents a duplicate batch for the same facility and period', async () => {
    const duplicate = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches',
      accountant.token,
      {
        facilityId: facilityA,
        period: '2026-11',
      },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('BATCH_EXISTS');
  });

  it('posts an approved batch as one balanced journal linked to the period', async () => {
    const approved = await call(
      'POST',
      `/api/fixed-assets/depreciation/batches/${novBatchId}/approve`,
      approver.token,
      { facilityId: facilityA },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');

    const posted = await call(
      'POST',
      `/api/fixed-assets/depreciation/batches/${novBatchId}/post`,
      approver.token,
      { facilityId: facilityA },
    );
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.journalNumber).toBeTruthy();
    expect(await balanced(posted.body.journalEntryId)).toBe(true);

    const journal = await pool.query(
      `SELECT source_type, source_id, entry_date::text AS entry_date, total_debit_cents::text AS debit
       FROM journal_entries WHERE id=$1`,
      [posted.body.journalEntryId],
    );
    expect(journal.rows[0].source_type).toBe('FIXED_ASSET');
    expect(journal.rows[0].source_id).toBe('DEP-2026-11');
    expect(journal.rows[0].entry_date).toBe('2026-11-30');

    const batch = await call(
      'GET',
      `/api/fixed-assets/depreciation/batches/${novBatchId}?facilityId=${facilityA}`,
      accountant.token,
    );
    expect(batch.body.items.length).toBeGreaterThan(0);
    const scannerItem = batch.body.items.find(
      (item: { assetId: number }) => item.assetId === assets.scanner,
    );
    expect(scannerItem.chargeCents).toBe('1000000');
    expect(scannerItem.closingAccumulatedCents).toBe('1000000');
    expect(scannerItem.closingNbvCents).toBe('119000000');

    const detail = await call(
      'GET',
      `/api/fixed-assets/${assets.scanner}?facilityId=${facilityA}`,
      manager.token,
    );
    expect(detail.body.asset.accumulatedDepreciationKes).toBe('10000.00');
    expect(detail.body.asset.netBookValueKes).toBe('1190000.00');
  });

  it('refuses to post the same batch twice', async () => {
    const again = await call(
      'POST',
      `/api/fixed-assets/depreciation/batches/${novBatchId}/post`,
      approver.token,
      { facilityId: facilityA },
    );
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('BATCH_POSTED');
  });

  it('reverses a posted batch with a balancing journal and allows a corrected batch', async () => {
    const withoutReason = await call(
      'POST',
      `/api/fixed-assets/depreciation/batches/${novBatchId}/reverse`,
      approver.token,
      { facilityId: facilityA },
    );
    expect(withoutReason.status).toBe(400);

    const reversed = await call(
      'POST',
      `/api/fixed-assets/depreciation/batches/${novBatchId}/reverse`,
      approver.token,
      { facilityId: facilityA, reason: 'Synthetic correction test', reversalDate: '2026-12-15' },
    );
    expect(reversed.status).toBe(200);
    expect(reversed.body.status).toBe('REVERSED');
    expect(await balanced(reversed.body.reversalJournalEntryId)).toBe(true);

    const reversalJournal = await pool.query(
      `SELECT reversal_of_journal_id, reversal_reason FROM journal_entries WHERE id=$1`,
      [reversed.body.reversalJournalEntryId],
    );
    expect(reversalJournal.rows[0].reversal_of_journal_id).toBe(reversed.body.journalEntryId);
    expect(reversalJournal.rows[0].reversal_reason).toBe('Synthetic correction test');

    const detail = await call(
      'GET',
      `/api/fixed-assets/${assets.scanner}?facilityId=${facilityA}`,
      manager.token,
    );
    expect(detail.body.asset.accumulatedDepreciationKes).toBe('0.00');

    const corrected = await call(
      'POST',
      '/api/fixed-assets/depreciation/batches',
      accountant.token,
      {
        facilityId: facilityA,
        period: '2026-11',
      },
    );
    expect(corrected.status).toBe(201);
    expect(corrected.body.status).toBe('DRAFT');
    const discarded = await call(
      'DELETE',
      `/api/fixed-assets/depreciation/batches/${corrected.body.id}?facilityId=${facilityA}`,
      accountant.token,
    );
    expect(discarded.status).toBe(200);
  });

  it('schedules preventive maintenance and advances the next due date on completion', async () => {
    const schedule = await call(
      'POST',
      '/api/fixed-assets/maintenance/schedules',
      inspector.token,
      {
        facilityId: facilityA,
        assetId: assets.scanner,
        name: 'Quarterly scanner service',
        frequency: 'QUARTERLY',
        nextDueDate: '2026-11-15',
        instructions: 'Clean transducer, verify calibration.',
        estimatedCostKes: '5000.00',
        responsibleDepartmentId: null,
      },
    );
    expect(schedule.status).toBe(201);

    const due = await call(
      'GET',
      `/api/fixed-assets/maintenance/schedules?facilityId=${facilityA}&dueOnly=true`,
      reader.token,
    );
    expect(due.status).toBe(200);
    expect(due.body.some((row: { id: number }) => row.id === schedule.body.id)).toBe(true);

    const completed = await call(
      'POST',
      `/api/fixed-assets/maintenance/schedules/${schedule.body.id}/complete`,
      inspector.token,
      {
        facilityId: facilityA,
        completedDate: '2026-11-15',
        description: 'Quarterly scanner service',
        costKes: '0.00',
        actionsTaken: 'Transducer cleaned and calibration verified.',
      },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    // Quarterly from 15 November is 15 February.
    expect(completed.body.nextDueDate).toBe('2027-02-15');

    const after = await call(
      'GET',
      `/api/fixed-assets/maintenance/schedules?facilityId=${facilityA}`,
      reader.token,
    );
    const row = after.body.find((entry: { id: number }) => entry.id === schedule.body.id);
    expect(row.nextDueDate).toBe('2027-02-15');
    expect(row.lastCompletedDate).toBe('2026-11-15');
  });

  it('records a corrective repair, posts its cost and requires verification', async () => {
    const fault = await call('POST', '/api/fixed-assets/maintenance/corrective', inspector.token, {
      facilityId: facilityA,
      assetId: assets.scanner,
      reportedDate: '2026-11-20',
      problemDescription: 'Synthetic fault: image artefact on probe B.',
      priority: 'HIGH',
      assignedTechnician: 'Synthetic technician',
    });
    expect(fault.status).toBe(201);
    expect(fault.body.priority).toBe('HIGH');

    const invalidPriority = await call(
      'POST',
      '/api/fixed-assets/maintenance/corrective',
      inspector.token,
      {
        facilityId: facilityA,
        assetId: assets.scanner,
        problemDescription: 'Synthetic fault',
        priority: 'URGENT',
      },
    );
    expect(invalidPriority.status).toBe(400);

    const completed = await call(
      'POST',
      `/api/fixed-assets/maintenance/${fault.body.id}/complete-corrective`,
      inspector.token,
      {
        facilityId: facilityA,
        completedDate: '2026-11-21',
        repairActions: 'Replaced synthetic probe cable.',
        partsUsed: 'Probe cable x1',
        downtimeHours: 4.5,
        costKes: '5000.00',
        expenseAccountId: accounts['FA-6100'],
        creditAccountId: accounts['FA-1100'],
      },
    );
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(await balanced(completed.body.journalEntryId)).toBe(true);

    const verify = await call(
      'POST',
      `/api/fixed-assets/maintenance/${fault.body.id}/verify`,
      manager.token,
      { facilityId: facilityA, verificationNotes: 'Image quality confirmed by the supervisor.' },
    );
    // The manager lacks assets.maintenance.manage, so verification is refused.
    expect(verify.status).toBe(403);

    const verified = await call(
      'POST',
      `/api/fixed-assets/maintenance/${fault.body.id}/verify`,
      inspector.token,
      { facilityId: facilityA, verificationNotes: 'Image quality confirmed by the supervisor.' },
    );
    expect(verified.status).toBe(200);
    expect(verified.body.verifiedAt).toBeTruthy();
  });

  it('keeps inspection history when a planned inspection is completed', async () => {
    const planned = await call('POST', '/api/fixed-assets/inspections', inspector.token, {
      facilityId: facilityA,
      assetId: assets.scanner,
      inspectionDate: '2026-12-01',
      inspectorName: 'Synthetic inspector',
      status: 'PLANNED',
      checklist: [{ item: 'Electrical safety', result: 'PASS' }],
    });
    expect(planned.status).toBe(201);
    expect(planned.body.status).toBe('PLANNED');

    const completed = await call(
      'POST',
      `/api/fixed-assets/inspections/${planned.body.id}/complete`,
      inspector.token,
      {
        facilityId: facilityA,
        inspectorName: 'Synthetic inspector',
        conditionAssessment: 'GOOD',
        findings: 'No visible damage; earth continuity within tolerance.',
        recommendations: 'Continue quarterly inspections.',
        followUpActions: 'None',
        nextInspectionDate: '2027-03-01',
      },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');

    const history = await call(
      'GET',
      `/api/fixed-assets/inspections?facilityId=${facilityA}&assetId=${assets.scanner}`,
      reader.token,
    );
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].findings).toContain('earth continuity');
    expect(history.body[0].nextInspectionDate).toBe('2027-03-01');
  });

  it('records a lifecycle transition with a reason and rejects an impossible one', async () => {
    const toMaintenance = await call(
      'POST',
      `/api/fixed-assets/${assets.scanner}/status`,
      manager.token,
      {
        facilityId: facilityA,
        status: 'UNDER_MAINTENANCE',
        effectiveDate: '2026-11-22',
        reason: 'Synthetic repair window',
      },
    );
    expect(toMaintenance.status).toBe(200);
    expect(toMaintenance.body.asset.status).toBe('UNDER_MAINTENANCE');
    expect(toMaintenance.body.event.eventType).toBe('STATUS_CHANGE');

    const backToService = await call(
      'POST',
      `/api/fixed-assets/${assets.scanner}/status`,
      manager.token,
      {
        facilityId: facilityA,
        status: 'ACTIVE',
        effectiveDate: '2026-11-23',
        reason: 'Repair completed and verified',
      },
    );
    expect(backToService.status).toBe(200);

    const skipped = await call(
      'POST',
      `/api/fixed-assets/${assets.scanner}/status`,
      manager.token,
      {
        facilityId: facilityA,
        status: 'DISPOSED',
        reason: 'Skip states',
      },
    );
    expect(skipped.status).toBe(409);
    expect(skipped.body.error).toBe('USE_DISPOSAL_WORKFLOW');

    const events = await call(
      'GET',
      `/api/fixed-assets/lifecycle?facilityId=${facilityA}&assetId=${assets.scanner}`,
      reader.token,
    );
    expect(events.status).toBe(200);
    expect(events.body.length).toBeGreaterThanOrEqual(3);
    expect(events.body.map((event: { toStatus: string }) => event.toStatus)).toContain(
      'UNDER_MAINTENANCE',
    );
  });

  it('stores a document with its checksum and refuses a corrupt read', async () => {
    const content = Buffer.from(`%PDF-1.4 synthetic asset document ${suffix}`);
    const upload = await call(
      'POST',
      `/api/fixed-assets/${assets.scanner}/documents`,
      manager.token,
      {
        facilityId: facilityA,
        title: 'Manufacturer calibration certificate',
        documentType: 'CERTIFICATE',
        filename: 'calibration.pdf',
        mimeType: 'application/pdf',
        contentBase64: content.toString('base64'),
      },
    );
    expect(upload.status).toBe(201);
    expect(upload.body.byteSize).toBe(content.length);
    expect(upload.body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const download = await call(
      'GET',
      `/api/fixed-assets/documents/${upload.body.id}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body.base64, 'base64').equals(content)).toBe(true);

    await pool.query(`UPDATE fixed_asset_documents SET content = $2 WHERE id = $1`, [
      upload.body.id,
      Buffer.from('%PDF-1.4 tampered'),
    ]);
    const corrupt = await call(
      'GET',
      `/api/fixed-assets/documents/${upload.body.id}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(corrupt.status).toBe(409);
    expect(corrupt.body.error).toBe('DOCUMENT_CORRUPT');
  });

  it('produces screen, spreadsheet and PDF output from the same report rows', async () => {
    const report = await call('POST', '/api/fixed-assets/reports/register', approver.token, {
      facilityId: facilityA,
    });
    expect(report.status).toBe(200);
    expect(report.body.key).toBe('register');
    expect(report.body.rows.length).toBeGreaterThan(0);
    expect(report.body.facilityName).toContain('Synthetic lifecycle facility');

    const denied = await call('POST', '/api/fixed-assets/reports/register', reader.token, {
      facilityId: facilityA,
    });
    expect(denied.status).toBe(403);

    const xlsx = await call('POST', '/api/fixed-assets/reports/register/export', approver.token, {
      facilityId: facilityA,
      format: 'xlsx',
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.contentType).toContain('spreadsheetml');

    const pdf = await call('POST', '/api/fixed-assets/reports/register/export', approver.token, {
      facilityId: facilityA,
      format: 'pdf',
    });
    expect(pdf.status).toBe(200);
    expect(pdf.body.contentType).toBe('application/pdf');
    const pdfBytes = Buffer.from(pdf.body.base64, 'base64');
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');

    /*
     * Read the spreadsheet back and compare it with the rows the screen
     * received. This is the consistency check: if the export were built from a
     * second query it could drift, and this assertion would fail.
     */
    const XLSX = await import('@e965/xlsx');
    const workbook = XLSX.read(xlsx.body.base64, { type: 'base64' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
    const headerRow = grid.findIndex((row) => row[0] === report.body.columns[0].label);
    expect(headerRow).toBeGreaterThan(-1);
    const exportedRows = grid.slice(headerRow + 1).filter((row) => row[0]);
    expect(exportedRows.length).toBe(report.body.rows.length);
    expect(String(exportedRows[0][0])).toBe(String(report.body.rows[0].assetCode));
    expect(String(exportedRows[0][7])).toBe(String(report.body.rows[0].costCents));
  });

  it('reconciles the register against the posted accumulated depreciation', async () => {
    const report = await call('POST', '/api/fixed-assets/reports/reconciliation', approver.token, {
      facilityId: facilityA,
    });
    expect(report.status).toBe(200);
    // The November batch was reversed, so the register and the ledger both
    // carry zero accumulated depreciation and must reconcile.
    expect(report.body.rows.every((row: { status: string }) => row.status === 'RECONCILED')).toBe(
      true,
    );
  });

  it('isolates batches, documents and reports across facilities', async () => {
    const foreignBatch = await call(
      'GET',
      `/api/fixed-assets/depreciation/batches/${novBatchId}?facilityId=${facilityB}`,
      foreign.token,
    );
    expect(foreignBatch.status).toBe(404);

    const foreignReport = await call('POST', '/api/fixed-assets/reports/register', foreign.token, {
      facilityId: facilityB,
    });
    expect(foreignReport.status).toBe(200);
    expect(
      foreignReport.body.rows.some(
        (row: { assetCode: string }) => row.assetCode === `SCAN-${suffix}`,
      ),
    ).toBe(false);

    const foreignSchedule = await call(
      'GET',
      `/api/fixed-assets/maintenance/schedules?facilityId=${facilityB}`,
      foreign.token,
    );
    expect(foreignSchedule.status).toBe(200);
    expect(foreignSchedule.body).toHaveLength(0);
  });
});
