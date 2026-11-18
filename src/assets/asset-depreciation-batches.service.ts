/**
 * Fixed-asset depreciation policy and the prepare → approve → post → reverse
 * batch lifecycle.
 *
 * WHY A BATCH RATHER THAN A BUTTON
 * -------------------------------
 * Depreciation is an accounting estimate. Someone prepares it, someone
 * accountable approves it, and only then does it reach the ledger. The batch
 * freezes every asset's basis, life, convention and charge at preparation
 * time, so the number the approver saw is exactly the number that posts —
 * posting does not recompute and cannot drift from the approval.
 *
 * A period can hold at most one live batch (enforced by a partial unique index).
 * Reversing a batch frees the period for a corrected batch, while the reversed
 * batch, its journal and its items stay on file as the audit trail.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  centsToKes,
  postInsideTransaction,
  type JournalLine,
} from '../accounting/accounting.service.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  accumulatedCentsOf,
  accountingScope,
  assertAccounts,
  audit,
  basisCentsOf,
  centsAsKes,
  fail,
  findAsset,
  isoDate,
  money,
  positiveId,
  requiredText,
  withTx,
  type AssetScope,
} from './fixed-assets.service.ts';
import {
  addPeriods,
  annualRateBpsForLife,
  daysInPeriod,
  depreciationBaseDate,
  financialYearOf,
  periodDepreciation,
  type CommencementConvention,
} from './depreciation.ts';
import {
  conventionForAsset,
  resolveDepreciationPolicy,
  type DepreciationPolicy,
} from './depreciation-policy.ts';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertPeriod(period: string): string {
  if (!PERIOD.test(period)) fail(400, 'INVALID_PERIOD', 'Period must be YYYY-MM.');
  return period;
}

/** Last day of the accounting month, used as the default journal date. */
export function periodEndDate(period: string): string {
  assertPeriod(period);
  return `${period}-${String(daysInPeriod(period)).padStart(2, '0')}`;
}

/** A KES column, converted to integer cents. */
function centsOf(value: string | number | null | undefined): bigint {
  return BigInt(Math.round(Number(value ?? 0) * 100));
}

/**
 * A column that already stores integer cents (batch items, settings, estimated
 * costs). Multiplying these by 100 is the classic 100x depreciation bug, so the
 * distinction is a named function rather than a comment.
 */
function rawCents(value: string | number | null | undefined): bigint {
  return BigInt(Math.round(Number(value ?? 0)));
}

/* ============================================================
   POLICY
   ============================================================ */

export async function getDepreciationSettings(scope: AssetScope) {
  const [policy, counts] = await Promise.all([
    resolveDepreciationPolicy(db, scope),
    db
      .select({
        posted: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssetDepreciationBatches.status} = 'POSTED')::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssetDepreciationBatches.status} IN ('DRAFT','APPROVED'))::int`,
      })
      .from(schema.fixedAssetDepreciationBatches)
      .where(eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId)),
  ]);
  const annual = annualRateBpsForLife(policy.defaultUsefulLifeMonths);
  return {
    ...policy,
    postedBatchCount: counts[0]?.posted ?? 0,
    pendingBatchCount: counts[0]?.pending ?? 0,
    annualRateBpsForDefaultLife: annual,
    monthlyRateBpsForDefaultLife: Math.round(annual / 12),
  };
}

export async function updateDepreciationSettings(
  scope: AssetScope,
  input: Record<string, unknown>,
) {
  const life = Number(input.defaultUsefulLifeMonths ?? 120);
  if (!Number.isInteger(life) || life < 1 || life > 600)
    fail(400, 'INVALID_LIFE', 'Default useful life must be between 1 and 600 months.');
  const rate = input.defaultAnnualRateBps
    ? Number(input.defaultAnnualRateBps)
    : annualRateBpsForLife(life);
  if (!Number.isInteger(rate) || rate < 1 || rate > 10_000)
    fail(400, 'INVALID_RATE', 'Default annual rate must be between 0.01% and 100%.');
  const convention = String(input.depreciationCommencement ?? '');
  if (!['FULL_MONTH', 'FOLLOWING_MONTH', 'DAILY_PRORATA'].includes(convention))
    fail(
      400,
      'INVALID_COMMENCEMENT',
      'Depreciation must start under FULL_MONTH, FOLLOWING_MONTH or DAILY_PRORATA.',
    );
  const approvalRequired =
    input.depreciationApprovalRequired === undefined
      ? true
      : Boolean(input.depreciationApprovalRequired);
  const fyStart = Number(input.financialYearStartMonth ?? 7);
  if (!Number.isInteger(fyStart) || fyStart < 1 || fyStart > 12)
    fail(400, 'INVALID_FY_START', 'Financial year start month must be 1–12.');

  return withTx(async (tx) => {
    const [saved] = await tx
      .insert(schema.fixedAssetSettings)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        defaultUsefulLifeMonths: life,
        defaultAnnualRateBps: rate,
        depreciationCommencement: convention,
        depreciationApprovalRequired: approvalRequired,
        financialYearStartMonth: fyStart,
        createdByUserId: scope.actorId,
        updatedByUserId: scope.actorId,
      })
      .onConflictDoUpdate({
        target: schema.fixedAssetSettings.facilityId,
        set: {
          defaultUsefulLifeMonths: life,
          defaultAnnualRateBps: rate,
          depreciationCommencement: convention,
          depreciationApprovalRequired: approvalRequired,
          financialYearStartMonth: fyStart,
          updatedByUserId: scope.actorId,
          updatedAt: new Date(),
        },
      })
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_settings',
      saved.id,
      'UPDATE_POLICY',
      `Depreciation policy: ${life} months, ${(rate / 100).toFixed(2)}% a year, ${convention}, approval ${approvalRequired ? 'required' : 'not required'}, FY starts month ${fyStart}.`,
    );
    return saved;
  });
}

/* ============================================================
   BATCHES
   ============================================================ */

export type BatchFilters = { status?: string; period?: string; limit?: number };

export async function listDepreciationBatches(scope: AssetScope, filter: BatchFilters = {}) {
  const conditions = [
    eq(schema.fixedAssetDepreciationBatches.tenantId, scope.tenantId),
    eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
  ];
  if (filter.status)
    conditions.push(eq(schema.fixedAssetDepreciationBatches.status, filter.status));
  if (filter.period)
    conditions.push(eq(schema.fixedAssetDepreciationBatches.periodCode, filter.period));
  const limit = Math.min(200, Math.max(1, filter.limit ?? 60));
  const rows = await db
    .select({
      id: schema.fixedAssetDepreciationBatches.id,
      periodCode: schema.fixedAssetDepreciationBatches.periodCode,
      entryDate: schema.fixedAssetDepreciationBatches.entryDate,
      status: schema.fixedAssetDepreciationBatches.status,
      totalCents: schema.fixedAssetDepreciationBatches.totalCents,
      assetCount: schema.fixedAssetDepreciationBatches.assetCount,
      preparedByUserId: schema.fixedAssetDepreciationBatches.preparedByUserId,
      approvedByUserId: schema.fixedAssetDepreciationBatches.approvedByUserId,
      approvedAt: schema.fixedAssetDepreciationBatches.approvedAt,
      postedAt: schema.fixedAssetDepreciationBatches.postedAt,
      journalEntryId: schema.fixedAssetDepreciationBatches.journalEntryId,
      reversalJournalEntryId: schema.fixedAssetDepreciationBatches.reversalJournalEntryId,
      reversalReason: schema.fixedAssetDepreciationBatches.reversalReason,
      notes: schema.fixedAssetDepreciationBatches.notes,
      createdAt: schema.fixedAssetDepreciationBatches.createdAt,
    })
    .from(schema.fixedAssetDepreciationBatches)
    .where(and(...conditions))
    .orderBy(
      desc(schema.fixedAssetDepreciationBatches.periodCode),
      desc(schema.fixedAssetDepreciationBatches.id),
    )
    .limit(limit);
  return rows;
}

export async function getDepreciationBatch(scope: AssetScope, id: number) {
  return withTx(async (tx) => {
    const [batch] = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.id, id),
          eq(schema.fixedAssetDepreciationBatches.tenantId, scope.tenantId),
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!batch) fail(404, 'BATCH_NOT_FOUND', 'Depreciation batch not found in this facility.');
    const items = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatchItems)
      .where(eq(schema.fixedAssetDepreciationBatchItems.batchId, batch.id))
      .orderBy(asc(schema.fixedAssetDepreciationBatchItems.assetCode));
    return { batch, items };
  });
}

type ChargeRow = {
  asset: typeof schema.fixedAssets.$inferSelect;
  convention: CommencementConvention;
  inServiceDate: string;
  opening: bigint;
  charge: bigint;
  closing: bigint;
  daysInService: number;
  periodDays: number;
};

/**
 * Compute the period's charges without writing anything. Preview and batch
 * preparation share this function so the approver cannot be shown one number
 * and asked to approve another.
 */
async function computeCharges(
  tx: Parameters<typeof findAsset>[0],
  scope: AssetScope,
  period: string,
): Promise<{ policy: DepreciationPolicy; rows: ChargeRow[] }> {
  const policy = await resolveDepreciationPolicy(tx, scope);
  const assets = await tx
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
        sql`${schema.fixedAssets.status} <> ALL(ARRAY['DISPOSED','RETIRED'])`,
      ),
    )
    .orderBy(asc(schema.fixedAssets.assetCode));

  const rows: ChargeRow[] = [];
  for (const asset of assets) {
    const convention = conventionForAsset(asset, policy);
    const inServiceDate = depreciationBaseDate(
      asset.acquisitionDate,
      asset.placedInServiceDate,
    ).date;
    const result = periodDepreciation({
      acquisitionCostCents: basisCentsOf(asset),
      salvageValueCents: centsOf(asset.salvageValueKes),
      usefulLifeMonths: asset.usefulLifeMonths,
      accumulatedDepreciationCents: accumulatedCentsOf(asset),
      period,
      inServiceDate,
      convention,
    });
    if (result.chargeCents <= 0n) continue;
    rows.push({
      asset,
      convention,
      inServiceDate,
      opening: accumulatedCentsOf(asset),
      charge: result.chargeCents,
      closing: result.accumulatedAfterCents,
      daysInService: result.daysInService,
      periodDays: result.periodDays,
    });
  }
  return { policy, rows };
}

export async function previewDepreciationBatch(scope: AssetScope, periodInput: string) {
  const period = assertPeriod(periodInput);
  return withTx(async (tx) => {
    const { policy, rows } = await computeCharges(tx, scope, period);
    const [existing] = await tx
      .select({
        id: schema.fixedAssetDepreciationBatches.id,
        status: schema.fixedAssetDepreciationBatches.status,
        totalCents: schema.fixedAssetDepreciationBatches.totalCents,
        assetCount: schema.fixedAssetDepreciationBatches.assetCount,
      })
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
          eq(schema.fixedAssetDepreciationBatches.periodCode, period),
          inArray(schema.fixedAssetDepreciationBatches.status, ['DRAFT', 'APPROVED', 'POSTED']),
        ),
      )
      .limit(1);
    return {
      period,
      convention: policy.depreciationCommencement,
      policyConfigured: policy.configured,
      existingBatch: existing ?? null,
      rows: rows.map((row) => ({
        assetId: row.asset.id,
        assetCode: row.asset.assetCode,
        assetName: row.asset.assetName,
        category: row.asset.category,
        departmentId: row.asset.departmentId,
        costCents: basisCentsOf(row.asset).toString(),
        salvageCents: centsOf(row.asset.salvageValueKes).toString(),
        basisCents: (basisCentsOf(row.asset) - centsOf(row.asset.salvageValueKes)).toString(),
        usefulLifeMonths: row.asset.usefulLifeMonths,
        annualRateBps: row.asset.annualRateBps ?? annualRateBpsForLife(row.asset.usefulLifeMonths),
        convention: row.convention,
        inServiceDate: row.inServiceDate,
        daysInService: row.daysInService,
        periodDays: row.periodDays,
        openingAccumulatedCents: row.opening.toString(),
        chargeCents: row.charge.toString(),
        closingAccumulatedCents: row.closing.toString(),
        openingBookValueCents: (basisCentsOf(row.asset) - row.opening).toString(),
        closingBookValueCents: (basisCentsOf(row.asset) - row.closing).toString(),
      })),
      totalCents: rows.reduce((sum, row) => sum + row.charge, 0n).toString(),
    };
  });
}

export async function prepareDepreciationBatch(scope: AssetScope, input: Record<string, unknown>) {
  const period = assertPeriod(String(input.period ?? ''));
  const entryDate = input.entryDate
    ? isoDate(input.entryDate, 'Entry date')
    : periodEndDate(period);
  if (entryDate.slice(0, 7) !== period)
    fail(400, 'PERIOD_MISMATCH', 'The entry date must fall inside the depreciation period.');
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 1000) : null;

  return withTx(async (tx, client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      `fixed-asset-batch:${period}`,
      scope.facilityId,
    ]);

    /*
     * A *live* legacy run would double-charge the period. Charges that came from
     * a batch that has since been reversed are already offset in the ledger and
     * must not block the corrected batch the accountant is preparing.
     */
    const legacy = await tx.execute(sql`
      SELECT 1 FROM fixed_asset_movements m
      WHERE m.facility_id = ${scope.facilityId}
        AND m.movement_type = 'DEPRECIATION'
        AND m.period_code = ${period}
        AND NOT EXISTS (
          SELECT 1 FROM fixed_asset_depreciation_batches b
          WHERE b.facility_id = ${scope.facilityId}
            AND b.status = 'REVERSED'
            AND b.journal_entry_id = m.journal_entry_id
        )
      LIMIT 1
    `);
    if (legacy.rows.length)
      fail(
        409,
        'PERIOD_ALREADY_POSTED',
        `Depreciation for ${period} was already posted through the direct run. Reverse it before preparing a batch.`,
      );

    const [live] = await tx
      .select({
        id: schema.fixedAssetDepreciationBatches.id,
        status: schema.fixedAssetDepreciationBatches.status,
      })
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
          eq(schema.fixedAssetDepreciationBatches.periodCode, period),
          inArray(schema.fixedAssetDepreciationBatches.status, ['DRAFT', 'APPROVED', 'POSTED']),
        ),
      )
      .limit(1);
    if (live)
      fail(
        409,
        'BATCH_EXISTS',
        `A ${live.status.toLowerCase()} depreciation batch already exists for ${period}.`,
      );

    const { policy, rows } = await computeCharges(tx, scope, period);
    if (!rows.length)
      fail(400, 'NO_DEPRECIATION_DUE', `No asset has a depreciation charge due for ${period}.`);

    const totalCents = rows.reduce((sum, row) => sum + row.charge, 0n);
    const [batch] = await tx
      .insert(schema.fixedAssetDepreciationBatches)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        periodCode: period,
        entryDate,
        status: 'DRAFT',
        totalCents: totalCents.toString(),
        assetCount: rows.length,
        preparedByUserId: scope.actorId,
        notes,
      })
      .returning();

    await tx.insert(schema.fixedAssetDepreciationBatchItems).values(
      rows.map((row) => ({
        batchId: batch.id,
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetId: row.asset.id,
        assetCode: row.asset.assetCode,
        assetName: row.asset.assetName,
        category: row.asset.category,
        departmentId: row.asset.departmentId ?? undefined,
        basisCents: basisCentsOf(row.asset).toString(),
        salvageCents: centsOf(row.asset.salvageValueKes).toString(),
        usefulLifeMonths: row.asset.usefulLifeMonths,
        annualRateBps: row.asset.annualRateBps ?? annualRateBpsForLife(row.asset.usefulLifeMonths),
        commencement: row.convention,
        openingAccumulatedCents: row.opening.toString(),
        chargeCents: row.charge.toString(),
        closingAccumulatedCents: row.closing.toString(),
        openingNbvCents: (basisCentsOf(row.asset) - row.opening).toString(),
        closingNbvCents: (basisCentsOf(row.asset) - row.closing).toString(),
        daysInService: row.daysInService,
        periodDays: row.periodDays,
      })),
    );

    await audit(
      tx,
      scope,
      'fixed_asset_depreciation_batches',
      batch.id,
      'PREPARE',
      `Prepared ${period} depreciation for ${rows.length} asset(s), ${centsToKes(totalCents)} KES under ${policy.depreciationCommencement}.`,
    );
    return { ...batch, items: rows.length, policyConfigured: policy.configured };
  });
}

export async function approveDepreciationBatch(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown> = {},
) {
  return withTx(async (tx) => {
    const [batch] = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.id, id),
          eq(schema.fixedAssetDepreciationBatches.tenantId, scope.tenantId),
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!batch) fail(404, 'BATCH_NOT_FOUND', 'Depreciation batch not found in this facility.');
    if (batch.status !== 'DRAFT')
      fail(
        409,
        'BATCH_NOT_DRAFT',
        `Only a draft batch can be approved; this one is ${batch.status}.`,
      );
    const [count] = await tx
      .select({ items: sql<number>`count(*)::int` })
      .from(schema.fixedAssetDepreciationBatchItems)
      .where(eq(schema.fixedAssetDepreciationBatchItems.batchId, batch.id));
    if (!count?.items) fail(400, 'BATCH_EMPTY', 'A batch with no charges cannot be approved.');

    const selfApproved = batch.preparedByUserId === scope.actorId;
    const [approved] = await tx
      .update(schema.fixedAssetDepreciationBatches)
      .set({
        status: 'APPROVED',
        approvedByUserId: scope.actorId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssetDepreciationBatches.id, batch.id))
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_depreciation_batches',
      batch.id,
      'APPROVE',
      `Approved ${batch.periodCode} depreciation of ${batch.totalCents} cents${selfApproved ? ' (preparer approved their own batch)' : ''}.${typeof input.notes === 'string' ? ` Note: ${input.notes.slice(0, 500)}` : ''}`,
    );
    return { ...approved, selfApproved };
  });
}

export async function postDepreciationBatch(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown> = {},
) {
  return withTx(async (tx, client) => {
    const [batch] = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.id, id),
          eq(schema.fixedAssetDepreciationBatches.tenantId, scope.tenantId),
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!batch) fail(404, 'BATCH_NOT_FOUND', 'Depreciation batch not found in this facility.');
    if (batch.status === 'POSTED') fail(409, 'BATCH_POSTED', 'This batch has already been posted.');
    if (batch.status === 'REVERSED')
      fail(409, 'BATCH_REVERSED', 'A reversed batch cannot be posted again; prepare a new one.');

    const policy = await resolveDepreciationPolicy(tx, scope);
    if (batch.status === 'DRAFT' && policy.depreciationApprovalRequired)
      fail(
        409,
        'APPROVAL_REQUIRED',
        'This facility requires depreciation to be approved before it is posted.',
      );

    const items = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatchItems)
      .where(eq(schema.fixedAssetDepreciationBatchItems.batchId, batch.id))
      .orderBy(asc(schema.fixedAssetDepreciationBatchItems.assetId));
    if (!items.length) fail(400, 'BATCH_EMPTY', 'A batch with no charges cannot be posted.');

    const entryDate = input.entryDate ? isoDate(input.entryDate, 'Posting date') : batch.entryDate;
    if (entryDate.slice(0, 7) !== batch.periodCode)
      fail(400, 'PERIOD_MISMATCH', 'The posting date must fall inside the batch period.');

    const assets = await tx
      .select()
      .from(schema.fixedAssets)
      .where(
        and(
          eq(schema.fixedAssets.tenantId, scope.tenantId),
          eq(schema.fixedAssets.facilityId, scope.facilityId),
          inArray(
            schema.fixedAssets.id,
            items.map((item) => item.assetId),
          ),
        ),
      )
      .for('update');
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    /* Nothing may have moved since approval: if an earlier period posted in
       between, the frozen opening balances are stale and posting would double
       count. Refuse and let the accountant rebuild the batch. */
    for (const item of items) {
      const asset = byId.get(item.assetId);
      if (!asset)
        fail(409, 'ASSET_MISSING', `Asset ${item.assetCode} is no longer in this facility.`);
      if (accumulatedCentsOf(asset) !== rawCents(item.openingAccumulatedCents))
        fail(
          409,
          'BATCH_STALE',
          `Asset ${item.assetCode} changed since this batch was prepared. Discard it and prepare ${batch.periodCode} again.`,
        );
      if (
        ![
          'ACTIVE',
          'UNDER_MAINTENANCE',
          'TEMPORARILY_UNAVAILABLE',
          'IMPAIRED',
          'REGISTERED',
        ].includes(asset.status)
      )
        fail(
          409,
          'ASSET_NOT_DEPRECIABLE',
          `Asset ${item.assetCode} is ${asset.status.toLowerCase()} and cannot be depreciated.`,
        );
    }

    const pairs = new Map<string, { debit: number; credit: number; amount: bigint }>();
    for (const item of items) {
      const asset = byId.get(item.assetId)!;
      const key = `${asset.depExpenseAccountId}:${asset.accumDepAccountId}`;
      const pair = pairs.get(key);
      if (pair) pair.amount += rawCents(item.chargeCents);
      else
        pairs.set(key, {
          debit: asset.depExpenseAccountId,
          credit: asset.accumDepAccountId,
          amount: rawCents(item.chargeCents),
        });
    }
    await assertAccounts(
      tx,
      scope,
      [...pairs.values()].flatMap((pair) => [pair.debit, pair.credit]),
    );

    const totalCents = [...pairs.values()].reduce((sum, pair) => sum + pair.amount, 0n);
    const lines: JournalLine[] = [...pairs.values()].flatMap((pair) => [
      {
        accountId: pair.debit,
        debitCents: pair.amount,
        creditCents: 0n,
        description: `Depreciation ${batch.periodCode}`,
        serviceLine: null,
      },
      {
        accountId: pair.credit,
        debitCents: 0n,
        creditCents: pair.amount,
        description: `Depreciation ${batch.periodCode}`,
        serviceLine: null,
      },
    ]);

    const journal = await postInsideTransaction(client, accountingScope(scope), {
      entryDate,
      description: `Fixed-asset depreciation — ${batch.periodCode} (batch ${batch.id})`.slice(
        0,
        500,
      ),
      idempotencyKey: `fixed-asset-depreciation-batch:${batch.id}`,
      lines,
      totalCents,
      sourceType: 'FIXED_ASSET',
      sourceId: `DEP-${batch.periodCode}`,
    });

    for (const item of items) {
      const asset = byId.get(item.assetId)!;
      await tx.insert(schema.fixedAssetMovements).values({
        assetId: asset.id,
        facilityId: scope.facilityId,
        movementType: 'DEPRECIATION',
        movementDate: entryDate,
        periodCode: batch.periodCode,
        amountKes: centsAsKes(rawCents(item.chargeCents)),
        netBookValueAfterKes: centsAsKes(rawCents(item.closingNbvCents)),
        journalEntryId: Number(journal.journal.id),
        notes: `Depreciation ${batch.periodCode} under ${item.commencement} (batch ${batch.id}).`,
        recordedByUserId: scope.actorId,
      });
      await tx
        .update(schema.fixedAssets)
        .set({
          accumulatedDepreciationKes: centsAsKes(rawCents(item.closingAccumulatedCents)),
          netBookValueKes: centsAsKes(rawCents(item.closingNbvCents)),
          updatedAt: new Date(),
        })
        .where(eq(schema.fixedAssets.id, asset.id));
    }

    const [posted] = await tx
      .update(schema.fixedAssetDepreciationBatches)
      .set({
        status: 'POSTED',
        journalEntryId: Number(journal.journal.id),
        postedAt: new Date(),
        entryDate,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssetDepreciationBatches.id, batch.id))
      .returning();

    await audit(
      tx,
      scope,
      'fixed_asset_depreciation_batches',
      batch.id,
      'POST',
      `Posted ${batch.periodCode} depreciation for ${items.length} asset(s), ${centsToKes(totalCents)} KES.`,
    );
    return {
      ...posted,
      journalNumber: journal.journal.journalNumber,
      totalCents: totalCents.toString(),
      alreadyPosted: journal.idempotentReplay,
    };
  });
}

export async function reverseDepreciationBatch(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  const reason = requiredText(input.reason, 'Reversal reason', 500);
  return withTx(async (tx, client) => {
    const [batch] = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.id, id),
          eq(schema.fixedAssetDepreciationBatches.tenantId, scope.tenantId),
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!batch) fail(404, 'BATCH_NOT_FOUND', 'Depreciation batch not found in this facility.');
    if (batch.status !== 'POSTED')
      fail(409, 'BATCH_NOT_POSTED', 'Only a posted batch can be reversed.');
    if (!batch.journalEntryId) fail(409, 'BATCH_NO_JOURNAL', 'The batch has no posted journal.');
    const reversalDate = input.reversalDate
      ? isoDate(input.reversalDate, 'Reversal date')
      : new Date().toISOString().slice(0, 10);

    const items = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatchItems)
      .where(eq(schema.fixedAssetDepreciationBatchItems.batchId, batch.id));
    const assets = await tx
      .select()
      .from(schema.fixedAssets)
      .where(
        and(
          eq(schema.fixedAssets.tenantId, scope.tenantId),
          eq(schema.fixedAssets.facilityId, scope.facilityId),
          inArray(
            schema.fixedAssets.id,
            items.map((item) => item.assetId),
          ),
        ),
      )
      .for('update');
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    /*
     * The reversal copies the original journal's lines rather than recomputing
     * them. Accounts cannot have been edited between posting and reversal in a
     * way that leaves the reversal unbalanced against the entry it reverses.
     */
    const originalLines = await tx
      .select({
        accountId: schema.journalLines.accountId,
        debitCents: schema.journalLines.debitCents,
        creditCents: schema.journalLines.creditCents,
        description: schema.journalLines.description,
        serviceLine: schema.journalLines.serviceLine,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.journalEntryId, batch.journalEntryId));
    if (!originalLines.length)
      fail(409, 'BATCH_NO_JOURNAL', 'The original journal has no lines to reverse.');
    const reversedTotal = originalLines.reduce((sum, line) => sum + BigInt(line.debitCents), 0n);
    const reversalLines: JournalLine[] = originalLines.map((line) => ({
      accountId: line.accountId,
      debitCents: BigInt(line.creditCents),
      creditCents: BigInt(line.debitCents),
      description: `Reversal: ${line.description ?? `Depreciation ${batch.periodCode}`}`.slice(
        0,
        500,
      ),
      serviceLine: line.serviceLine,
    }));
    const reversal = await postInsideTransaction(client, accountingScope(scope), {
      entryDate: reversalDate,
      description: `Reversal of fixed-asset depreciation ${batch.periodCode} — ${reason}`.slice(
        0,
        500,
      ),
      idempotencyKey: `fixed-asset-depreciation-reversal:${batch.id}`,
      lines: reversalLines,
      totalCents: reversedTotal,
      sourceType: 'FIXED_ASSET',
      sourceId: `DEP-REV-${batch.periodCode}`,
      reversalOf: batch.journalEntryId,
      reversalReason: reason,
    });

    for (const item of items) {
      const asset = byId.get(item.assetId);
      if (!asset) continue; // history survives a later removal from the register
      const charge = rawCents(item.chargeCents);
      const accumulated = accumulatedCentsOf(asset);
      const restored = accumulated > charge ? accumulated - charge : 0n;
      await tx.insert(schema.fixedAssetMovements).values({
        assetId: asset.id,
        facilityId: scope.facilityId,
        movementType: 'DEPRECIATION_REVERSAL',
        movementDate: reversalDate,
        periodCode: reversalDate.slice(0, 7),
        amountKes: centsAsKes(-charge),
        netBookValueAfterKes: centsAsKes(basisCentsOf(asset) - restored),
        journalEntryId: Number(reversal.journal.id),
        notes: `Reversal of ${batch.periodCode} depreciation (batch ${batch.id}): ${reason}`.slice(
          0,
          1000,
        ),
        recordedByUserId: scope.actorId,
      });
      await tx
        .update(schema.fixedAssets)
        .set({
          accumulatedDepreciationKes: centsAsKes(restored),
          netBookValueKes: centsAsKes(basisCentsOf(asset) - restored),
          updatedAt: new Date(),
        })
        .where(eq(schema.fixedAssets.id, asset.id));
    }

    const [reversed] = await tx
      .update(schema.fixedAssetDepreciationBatches)
      .set({
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedByUserId: scope.actorId,
        reversalJournalEntryId: Number(reversal.journal.id),
        reversalReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssetDepreciationBatches.id, batch.id))
      .returning();

    await audit(
      tx,
      scope,
      'fixed_asset_depreciation_batches',
      batch.id,
      'REVERSE',
      `Reversed ${batch.periodCode} depreciation (${batch.totalCents} cents): ${reason}`,
    );
    return {
      ...reversed,
      reversalJournalNumber: reversal.journal.journalNumber,
      reversalTotalCents: reversedTotal.toString(),
    };
  });
}

/** Discard a batch that never reached the ledger. Posted batches are reversed, never deleted. */
export async function discardDepreciationBatch(scope: AssetScope, id: number) {
  return withTx(async (tx) => {
    const [batch] = await tx
      .select()
      .from(schema.fixedAssetDepreciationBatches)
      .where(
        and(
          eq(schema.fixedAssetDepreciationBatches.id, id),
          eq(schema.fixedAssetDepreciationBatches.tenantId, scope.tenantId),
          eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!batch) fail(404, 'BATCH_NOT_FOUND', 'Depreciation batch not found in this facility.');
    if (batch.status !== 'DRAFT')
      fail(409, 'BATCH_NOT_DRAFT', 'Only a draft batch can be discarded.');
    await tx
      .delete(schema.fixedAssetDepreciationBatchItems)
      .where(eq(schema.fixedAssetDepreciationBatchItems.batchId, batch.id));
    await tx
      .delete(schema.fixedAssetDepreciationBatches)
      .where(eq(schema.fixedAssetDepreciationBatches.id, batch.id));
    await audit(
      tx,
      scope,
      'fixed_asset_depreciation_batches',
      batch.id,
      'DISCARD',
      `Discarded unposted ${batch.periodCode} draft batch.`,
    );
    return { id: batch.id, discarded: true };
  });
}

/* ============================================================
   SCHEDULES FOR REPORTS AND THE UI
   ============================================================ */

/**
 * The 10-year schedule for one asset, with the facility's current convention.
 * Used by the asset detail tab and the depreciation policy examples.
 */
export async function assetDepreciationSchedule(
  scope: AssetScope,
  assetId: number,
  options: { months?: number; fromPeriod?: string } = {},
) {
  return withTx(async (tx) => {
    const asset = await findAsset(tx, scope, assetId);
    const policy = await resolveDepreciationPolicy(tx, scope);
    const convention = conventionForAsset(asset, policy);
    const inServiceDate = depreciationBaseDate(
      asset.acquisitionDate,
      asset.placedInServiceDate,
    ).date;
    const fromPeriod = options.fromPeriod ?? inServiceDate.slice(0, 7);
    const months = Math.min(600, Math.max(1, options.months ?? 12));
    const cost = basisCentsOf(asset);
    const salvage = centsOf(asset.salvageValueKes);
    const accumulated = accumulatedCentsOf(asset);

    let running = accumulated;
    const rows = [];
    for (let index = 0; index < months; index += 1) {
      const period = addPeriods(fromPeriod, index);
      const result = periodDepreciation({
        acquisitionCostCents: cost,
        salvageValueCents: salvage,
        usefulLifeMonths: asset.usefulLifeMonths,
        accumulatedDepreciationCents: running,
        period,
        inServiceDate,
        convention,
      });
      rows.push({
        period,
        openingAccumulatedCents: running.toString(),
        chargeCents: result.chargeCents.toString(),
        closingAccumulatedCents: result.accumulatedAfterCents.toString(),
        openingBookValueCents: (cost - running).toString(),
        closingBookValueCents: result.netBookValueAfterCents.toString(),
        daysInService: result.daysInService,
        periodDays: result.periodDays,
      });
      running = result.accumulatedAfterCents;
    }

    return {
      asset: {
        id: asset.id,
        assetCode: asset.assetCode,
        assetName: asset.assetName,
        costCents: cost.toString(),
        salvageCents: salvage.toString(),
        basisCents: (cost - salvage).toString(),
        usefulLifeMonths: asset.usefulLifeMonths,
        annualRateBps: asset.annualRateBps ?? annualRateBpsForLife(asset.usefulLifeMonths),
        monthlyRateBps: Math.round(
          (asset.annualRateBps ?? annualRateBpsForLife(asset.usefulLifeMonths)) / 12,
        ),
        method: asset.depreciationMethod,
        convention,
        conventionSource: asset.depreciationCommencement ? 'ASSET_OVERRIDE' : 'FACILITY_POLICY',
        inServiceDate,
        depreciationStartDate: asset.depreciationStartDate ?? inServiceDate,
        annualChargeCents: (
          (cost - salvage) /
          BigInt(Math.ceil(asset.usefulLifeMonths / 12))
        ).toString(),
        monthlyChargeCents: ((cost - salvage) / BigInt(asset.usefulLifeMonths)).toString(),
      },
      financialYear: financialYearOf(fromPeriod, policy.financialYearStartMonth),
      rows,
    };
  });
}

/** Convenience for the UI: KES strings from stored cents. */
export function kesFromCents(value: string | bigint): string {
  return centsToKes(BigInt(value));
}

/** Validates a positive money input, used by lifecycle endpoints. */
export { money, positiveId };
