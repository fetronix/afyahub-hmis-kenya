/**
 * JaliCare HMIS — fixed-asset service.
 *
 * SCOPE AND SAFETY RULES
 * ----------------------
 * 1. Every read and write is constrained by the tenant and facility resolved
 *    from the authenticated request. A facility id from the browser is only a
 *    hint; the route resolves it through `requireScopedFacility` first.
 * 2. Capitalisation, depreciation and disposal post a balanced journal in the
 *    same database transaction as the register change. A journal without its
 *    movement, or a movement without its journal, cannot be committed.
 * 3. Idempotency is explicit: capitalisation and disposal keys derive from the
 *    asset id, depreciation from the accounting period. Retrying a request
 *    replays the existing journal instead of posting twice.
 * 4. Depreciation charges are computed once per asset per period and stored.
 *    A missed period is posted on demand; nothing is invented for a period
 *    nobody ran.
 * 5. Accounts are always checked to be active and owned by the same facility.
 */

import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';

import {
  centsToKes,
  parseKesToCents,
  postInsideTransaction,
  type AccountingScope,
  type JournalLine,
} from '../accounting/accounting.service.ts';
import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { monthlyDepreciation, periodOf } from './depreciation.ts';

export type AssetScope = {
  tenantId: number;
  facilityId: number;
  actorId: number;
  actorName: string;
};

type Tx = NodePgDatabase<Record<string, never>> & { $client: PoolClient };

/**
 * One PostgreSQL transaction that can hold both Drizzle register writes and
 * the ledger's own client-based journal post. Splitting them would allow an
 * asset to be capitalised without its journal, or the reverse.
 */
async function withTx<T>(fn: (tx: Tx, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = drizzle(client) as unknown as Tx;
    const result = await fn(tx, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class AssetError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AssetError';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new AssetError(statusCode, code, message);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ASSET_STATUSES = ['ACTIVE', 'DISPOSED'] as const;
const CONDITIONS = ['GOOD', 'FAIR', 'POOR', 'UNDER_REPAIR'] as const;
const MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] as const;
const MAINTENANCE_STATUSES = ['PLANNED', 'COMPLETED', 'CANCELLED'] as const;

// Rejecting control characters keeps printed asset labels and CSV exports intact.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${label} is required.`);
  const text = value.trim();
  if (!text || text.length > max || CONTROL_CHARACTERS.test(text))
    fail(400, 'INVALID_INPUT', `${label} is required and must be at most ${max} characters.`);
  return text;
}

export function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, label, max);
}

export function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value))
    fail(400, 'INVALID_DATE', `${label} must be a date in YYYY-MM-DD format.`);
  return value;
}

export function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'INVALID_ID', `${label} is required.`);
  return id;
}

function money(value: unknown, label: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) fail(400, 'INVALID_AMOUNT', `${label} is invalid.`);
    return BigInt(Math.round(value * 100));
  }
  if (typeof value !== 'string' || !value.trim())
    fail(400, 'INVALID_AMOUNT', `${label} is required.`);
  try {
    return parseKesToCents(value);
  } catch {
    return fail(400, 'INVALID_AMOUNT', `${label} must be a non-negative amount with two decimals.`);
  }
}

function centsAsKes(cents: bigint): string {
  return centsToKes(cents);
}

function accountingScope(scope: AssetScope): AccountingScope {
  return {
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.actorId,
  };
}

async function audit(
  tx: Tx,
  scope: AssetScope,
  resource: string,
  resourceId: number | string,
  action: string,
  details: string,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource,
    resourceId: String(resourceId),
    action,
    details,
  });
}

/**
 * Account ids must be active and belong to this facility. The ledger service
 * repeats this check on post; doing it here produces a precise error before a
 * partially built journal exists.
 */
async function assertAccounts(tx: Tx, scope: AssetScope, ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (unique.length !== ids.length) fail(400, 'INVALID_ACCOUNT', 'An account is missing.');
  const rows = await tx
    .select({ id: schema.chartOfAccounts.id })
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, scope.tenantId),
        eq(schema.chartOfAccounts.facilityId, scope.facilityId),
        eq(schema.chartOfAccounts.isActive, true),
        inArray(schema.chartOfAccounts.id, unique),
      ),
    );
  if (rows.length !== unique.length)
    fail(403, 'ACCOUNT_OUT_OF_SCOPE', 'Every account must be active and belong to this facility.');
}

async function findAsset(tx: Tx, scope: AssetScope, id: number, forUpdate = false) {
  const rows = await tx
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.id, id),
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for(forUpdate ? 'update' : 'share');
  if (!rows.length) fail(404, 'ASSET_NOT_FOUND', 'Asset not found in this facility.');
  return rows[0];
}

/* ============================================================
   CATEGORIES
   ============================================================ */

export async function listCategories(scope: AssetScope) {
  return db
    .select({
      id: schema.fixedAssetCategories.id,
      code: schema.fixedAssetCategories.code,
      name: schema.fixedAssetCategories.name,
      defaultUsefulLifeMonths: schema.fixedAssetCategories.defaultUsefulLifeMonths,
      assetAccountId: schema.fixedAssetCategories.assetAccountId,
      accumDepAccountId: schema.fixedAssetCategories.accumDepAccountId,
      depExpenseAccountId: schema.fixedAssetCategories.depExpenseAccountId,
      isActive: schema.fixedAssetCategories.isActive,
      assetCount: sql<number>`(
        SELECT count(*)::int FROM ${schema.fixedAssets}
        WHERE ${schema.fixedAssets.categoryId} = ${schema.fixedAssetCategories.id}
      )`,
    })
    .from(schema.fixedAssetCategories)
    .where(
      and(
        eq(schema.fixedAssetCategories.tenantId, scope.tenantId),
        eq(schema.fixedAssetCategories.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.fixedAssetCategories.name));
}

export async function createCategory(scope: AssetScope, input: Record<string, unknown>) {
  const code = requiredText(input.code, 'Category code', 24).toUpperCase();
  const name = requiredText(input.name, 'Category name', 120);
  const life = Number(input.defaultUsefulLifeMonths);
  if (!Number.isInteger(life) || life < 1 || life > 600)
    fail(400, 'INVALID_LIFE', 'Useful life must be between 1 and 600 months.');
  const accounts = {
    assetAccountId: positiveId(input.assetAccountId, 'Asset account'),
    accumDepAccountId: positiveId(input.accumDepAccountId, 'Accumulated depreciation account'),
    depExpenseAccountId: positiveId(input.depExpenseAccountId, 'Depreciation expense account'),
  };

  return withTx(async (tx, client) => {
    await assertAccounts(tx, scope, Object.values(accounts));
    const existing = await tx
      .select({ id: schema.fixedAssetCategories.id })
      .from(schema.fixedAssetCategories)
      .where(
        and(
          eq(schema.fixedAssetCategories.facilityId, scope.facilityId),
          eq(schema.fixedAssetCategories.code, code),
        ),
      )
      .limit(1);
    if (existing.length)
      fail(409, 'CATEGORY_EXISTS', 'A category with that code already exists in this facility.');
    const [created] = await tx
      .insert(schema.fixedAssetCategories)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        code,
        name,
        defaultUsefulLifeMonths: life,
        ...accounts,
        createdByUserId: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_categories',
      created.id,
      'CREATE',
      `Created category ${code}.`,
    );
    return created;
  });
}

/* ============================================================
   FORM OPTIONS
   ============================================================ */

/**
 * Selectors for the register form. Deliberately limited to the fields a
 * selector needs: the assets module must not become a second staff
 * directory or chart of accounts.
 */
export async function assetOptions(scope: AssetScope) {
  const [accounts, departments, employees] = await Promise.all([
    db
      .select({
        id: schema.chartOfAccounts.id,
        code: schema.chartOfAccounts.accountCode,
        name: schema.chartOfAccounts.accountName,
        accountType: schema.chartOfAccounts.accountType,
      })
      .from(schema.chartOfAccounts)
      .where(
        and(
          eq(schema.chartOfAccounts.tenantId, scope.tenantId),
          eq(schema.chartOfAccounts.facilityId, scope.facilityId),
          eq(schema.chartOfAccounts.isActive, true),
        ),
      )
      .orderBy(asc(schema.chartOfAccounts.accountCode)),
    db
      .select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departments)
      .where(eq(schema.departments.facilityId, scope.facilityId))
      .orderBy(asc(schema.departments.name)),
    db
      .select({
        id: schema.hrEmployees.id,
        employeeNumber: schema.hrEmployees.employeeNumber,
        firstName: schema.hrEmployees.firstName,
        lastName: schema.hrEmployees.lastName,
        employmentStatus: schema.hrEmployees.employmentStatus,
      })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .orderBy(asc(schema.hrEmployees.firstName))
      .limit(500),
  ]);
  return { accounts, departments, employees };
}

/* ============================================================
   REGISTER
   ============================================================ */

export type AssetListFilter = {
  search?: string;
  status?: string;
  categoryId?: number;
  page?: number;
  pageSize?: number;
};

export async function listAssets(scope: AssetScope, filter: AssetListFilter = {}) {
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize ?? 25)));
  const conditions = [
    eq(schema.fixedAssets.tenantId, scope.tenantId),
    eq(schema.fixedAssets.facilityId, scope.facilityId),
  ];
  if (filter.status && ASSET_STATUSES.includes(filter.status as (typeof ASSET_STATUSES)[number]))
    conditions.push(eq(schema.fixedAssets.status, filter.status));
  if (filter.categoryId) conditions.push(eq(schema.fixedAssets.categoryId, filter.categoryId));
  const search = filter.search?.trim();
  if (search) {
    const term = `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    conditions.push(
      or(
        ilike(schema.fixedAssets.assetName, term),
        ilike(schema.fixedAssets.assetCode, term),
        ilike(schema.fixedAssets.serialNumber, term),
      )!,
    );
  }

  const where = and(...conditions);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.fixedAssets)
    .where(where);
  const rows = await db
    .select({
      id: schema.fixedAssets.id,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      category: schema.fixedAssets.category,
      categoryId: schema.fixedAssets.categoryId,
      departmentId: schema.fixedAssets.departmentId,
      departmentName: schema.departments.name,
      location: schema.fixedAssets.location,
      custodianEmployeeId: schema.fixedAssets.custodianEmployeeId,
      custodianName: sql<string | null>`(
        SELECT concat_ws(' ', e.first_name, e.last_name)
        FROM ${schema.hrEmployees} e WHERE e.id = ${schema.fixedAssets.custodianEmployeeId}
      )`,
      serialNumber: schema.fixedAssets.serialNumber,
      acquisitionDate: schema.fixedAssets.acquisitionDate,
      acquisitionCostKes: schema.fixedAssets.acquisitionCostKes,
      accumulatedDepreciationKes: schema.fixedAssets.accumulatedDepreciationKes,
      netBookValueKes: schema.fixedAssets.netBookValueKes,
      usefulLifeMonths: schema.fixedAssets.usefulLifeMonths,
      status: schema.fixedAssets.status,
      condition: schema.fixedAssets.condition,
    })
    .from(schema.fixedAssets)
    .leftJoin(schema.departments, eq(schema.departments.id, schema.fixedAssets.departmentId))
    .where(where)
    .orderBy(asc(schema.fixedAssets.assetCode))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, page, pageSize, total };
}

export async function assetOverview(scope: AssetScope) {
  const [totals] = await db
    .select({
      assetCount: sql<number>`count(*)::int`,
      activeCount: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'ACTIVE')::int`,
      disposedCount: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'DISPOSED')::int`,
      costCents: sql<string>`coalesce(sum(${schema.fixedAssets.acquisitionCostKes}), 0)::numeric(20,2) * 100`,
      accumulatedCents: sql<string>`coalesce(sum(${schema.fixedAssets.accumulatedDepreciationKes}), 0)::numeric(20,2) * 100`,
      netBookCents: sql<string>`coalesce(sum(${schema.fixedAssets.netBookValueKes}), 0)::numeric(20,2) * 100`,
    })
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
      ),
    );

  const categories = await db
    .select({
      category: schema.fixedAssets.category,
      count: sql<number>`count(*)::int`,
      netBookCents: sql<string>`coalesce(sum(${schema.fixedAssets.netBookValueKes}), 0)::numeric(20,2) * 100`,
    })
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
        eq(schema.fixedAssets.status, 'ACTIVE'),
      ),
    )
    .groupBy(schema.fixedAssets.category)
    .orderBy(desc(sql`coalesce(sum(${schema.fixedAssets.netBookValueKes}), 0)`));

  const [due] = await db
    .select({
      planned: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssetMaintenance.status} = 'PLANNED')::int`,
    })
    .from(schema.fixedAssetMaintenance)
    .where(
      and(
        eq(schema.fixedAssetMaintenance.tenantId, scope.tenantId),
        eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
      ),
    );

  return {
    assetCount: totals.assetCount,
    activeCount: totals.activeCount,
    disposedCount: totals.disposedCount,
    costCents: String(Math.round(Number(totals.costCents))),
    accumulatedCents: String(Math.round(Number(totals.accumulatedCents))),
    netBookCents: String(Math.round(Number(totals.netBookCents))),
    plannedMaintenance: due?.planned ?? 0,
    categories,
  };
}

export async function assetDetail(scope: AssetScope, id: number) {
  const [asset] = await db
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.id, id),
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!asset) fail(404, 'ASSET_NOT_FOUND', 'Asset not found in this facility.');
  const [movements, maintenance, transfers, journal] = await Promise.all([
    db
      .select()
      .from(schema.fixedAssetMovements)
      .where(eq(schema.fixedAssetMovements.assetId, id))
      .orderBy(desc(schema.fixedAssetMovements.movementDate), desc(schema.fixedAssetMovements.id)),
    db
      .select()
      .from(schema.fixedAssetMaintenance)
      .where(eq(schema.fixedAssetMaintenance.assetId, id))
      .orderBy(desc(schema.fixedAssetMaintenance.maintenanceDate)),
    db
      .select({
        id: schema.fixedAssetTransfers.id,
        transferDate: schema.fixedAssetTransfers.transferDate,
        fromLocation: schema.fixedAssetTransfers.fromLocation,
        toLocation: schema.fixedAssetTransfers.toLocation,
        fromDepartmentId: schema.fixedAssetTransfers.fromDepartmentId,
        toDepartmentId: schema.fixedAssetTransfers.toDepartmentId,
        reason: schema.fixedAssetTransfers.reason,
        createdAt: schema.fixedAssetTransfers.createdAt,
      })
      .from(schema.fixedAssetTransfers)
      .where(eq(schema.fixedAssetTransfers.assetId, id))
      .orderBy(desc(schema.fixedAssetTransfers.transferDate)),
    asset.disposalJournalId
      ? db
          .select({
            id: schema.journalEntries.id,
            journalNumber: schema.journalEntries.journalNumber,
            entryDate: schema.journalEntries.entryDate,
            description: schema.journalEntries.description,
            totalDebitCents: schema.journalEntries.totalDebitCents,
          })
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, asset.disposalJournalId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { asset, movements, maintenance, transfers, disposalJournal: journal[0] ?? null };
}

export async function createAsset(scope: AssetScope, input: Record<string, unknown>) {
  const assetCode = requiredText(input.assetCode, 'Asset code', 40).toUpperCase();
  const assetName = requiredText(input.assetName, 'Asset name', 200);
  const acquisitionDate = isoDate(input.acquisitionDate, 'Acquisition date');
  const costCents = money(input.acquisitionCostKes, 'Acquisition cost');
  if (costCents <= 0n) fail(400, 'INVALID_COST', 'Acquisition cost must be greater than zero.');
  const salvageCents =
    input.salvageValueKes === undefined ? 0n : money(input.salvageValueKes, 'Salvage value');
  if (salvageCents >= costCents)
    fail(400, 'INVALID_SALVAGE', 'Salvage value must be less than the acquisition cost.');

  const categoryId = input.categoryId ? positiveId(input.categoryId, 'Category') : null;
  const departmentId = input.departmentId ? positiveId(input.departmentId, 'Department') : null;
  const custodianEmployeeId = input.custodianEmployeeId
    ? positiveId(input.custodianEmployeeId, 'Custodian')
    : null;
  const condition = typeof input.condition === 'string' ? input.condition : 'GOOD';
  if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number]))
    fail(400, 'INVALID_CONDITION', 'Condition must be GOOD, FAIR, POOR or UNDER_REPAIR.');

  const acquisitionCreditAccountId = positiveId(
    input.acquisitionCreditAccountId,
    'Funding account',
  );

  return withTx(async (tx, client) => {
    let category: typeof schema.fixedAssetCategories.$inferSelect | undefined;
    if (categoryId) {
      const [found] = await tx
        .select()
        .from(schema.fixedAssetCategories)
        .where(
          and(
            eq(schema.fixedAssetCategories.id, categoryId),
            eq(schema.fixedAssetCategories.tenantId, scope.tenantId),
            eq(schema.fixedAssetCategories.facilityId, scope.facilityId),
            eq(schema.fixedAssetCategories.isActive, true),
          ),
        )
        .limit(1);
      if (!found) fail(404, 'CATEGORY_NOT_FOUND', 'Asset category not found in this facility.');
      category = found;
    }
    if (departmentId) {
      const [department] = await tx
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(
          and(
            eq(schema.departments.id, departmentId),
            eq(schema.departments.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', 'Department not found in this facility.');
    }
    if (custodianEmployeeId) {
      const [employee] = await tx
        .select({ id: schema.hrEmployees.id })
        .from(schema.hrEmployees)
        .where(
          and(
            eq(schema.hrEmployees.id, custodianEmployeeId),
            eq(schema.hrEmployees.tenantId, scope.tenantId),
            eq(schema.hrEmployees.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Custodian not found in this facility.');
    }

    const life = input.usefulLifeMonths
      ? Number(input.usefulLifeMonths)
      : (category?.defaultUsefulLifeMonths ?? 0);
    if (!Number.isInteger(life) || life < 1 || life > 600)
      fail(400, 'INVALID_LIFE', 'Useful life must be between 1 and 600 months.');

    const accounts = {
      assetAccountId: positiveId(input.assetAccountId ?? category?.assetAccountId, 'Asset account'),
      accumDepAccountId: positiveId(
        input.accumDepAccountId ?? category?.accumDepAccountId,
        'Accumulated depreciation account',
      ),
      depExpenseAccountId: positiveId(
        input.depExpenseAccountId ?? category?.depExpenseAccountId,
        'Depreciation expense account',
      ),
      acquisitionCreditAccountId,
    };
    await assertAccounts(tx, scope, Object.values(accounts));

    const existing = await tx
      .select({ id: schema.fixedAssets.id })
      .from(schema.fixedAssets)
      .where(
        and(
          eq(schema.fixedAssets.facilityId, scope.facilityId),
          eq(schema.fixedAssets.assetCode, assetCode),
        ),
      )
      .limit(1);
    if (existing.length)
      fail(409, 'ASSET_CODE_EXISTS', 'An asset with that code already exists in this facility.');

    const [created] = await tx
      .insert(schema.fixedAssets)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetCode,
        assetName,
        category: category?.name ?? requiredText(input.category, 'Category', 80),
        categoryId: categoryId ?? undefined,
        departmentId: departmentId ?? undefined,
        location: optionalText(input.location, 'Location', 160) ?? undefined,
        custodianEmployeeId: custodianEmployeeId ?? undefined,
        condition,
        serviceLine: optionalText(input.serviceLine, 'Service line', 80) ?? undefined,
        serialNumber: optionalText(input.serialNumber, 'Serial number', 120) ?? undefined,
        acquisitionDate,
        acquisitionCostKes: centsAsKes(costCents),
        salvageValueKes: centsAsKes(salvageCents),
        usefulLifeMonths: life,
        depreciationMethod: 'STRAIGHT_LINE',
        accumulatedDepreciationKes: '0.00',
        netBookValueKes: centsAsKes(costCents),
        ...accounts,
        notes: optionalText(input.notes, 'Notes', 1000) ?? undefined,
        createdByUserId: scope.actorId,
      })
      .returning();

    const request = {
      entryDate: acquisitionDate,
      description: `Asset capitalisation — ${assetCode} ${assetName}`.slice(0, 500),
      idempotencyKey: `fixed-asset-capitalise:${created.id}`,
      lines: [
        {
          accountId: accounts.assetAccountId,
          debitCents: costCents,
          creditCents: 0n,
          description: assetName,
          serviceLine: null,
        },
        {
          accountId: accounts.acquisitionCreditAccountId,
          debitCents: 0n,
          creditCents: costCents,
          description: assetName,
          serviceLine: null,
        },
      ] satisfies JournalLine[],
      totalCents: costCents,
      sourceType: 'FIXED_ASSET' as const,
      sourceId: `CAP-${created.id}`,
    };
    const posted = await postInsideTransaction(client, accountingScope(scope), request);

    await tx.insert(schema.fixedAssetMovements).values({
      assetId: created.id,
      facilityId: scope.facilityId,
      movementType: 'CAPITALISATION',
      movementDate: acquisitionDate,
      periodCode: periodOf(acquisitionDate),
      amountKes: centsAsKes(costCents),
      netBookValueAfterKes: centsAsKes(costCents),
      journalEntryId: Number(posted.journal.id),
      notes: 'Acquisition cost capitalised.',
      recordedByUserId: scope.actorId,
    });
    await audit(
      tx,
      scope,
      'fixed_assets',
      created.id,
      'CAPITALISE',
      `Capitalised ${assetCode} at ${centsAsKes(costCents)} KES.`,
    );
    return { ...created, journalNumber: posted.journal.journalNumber };
  });
}

export async function updateAsset(scope: AssetScope, id: number, input: Record<string, unknown>) {
  return withTx(async (tx, client) => {
    const asset = await findAsset(tx, scope, id, true);
    if (asset.status !== 'ACTIVE')
      fail(409, 'ASSET_DISPOSED', 'A disposed asset cannot be edited.');
    const condition = input.condition ? String(input.condition) : asset.condition;
    if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number]))
      fail(400, 'INVALID_CONDITION', 'Condition must be GOOD, FAIR, POOR or UNDER_REPAIR.');
    const [updated] = await tx
      .update(schema.fixedAssets)
      .set({
        assetName: input.assetName
          ? requiredText(input.assetName, 'Asset name', 200)
          : asset.assetName,
        location: optionalText(input.location, 'Location', 160) ?? null,
        condition,
        serialNumber: optionalText(input.serialNumber, 'Serial number', 120) ?? null,
        notes: optionalText(input.notes, 'Notes', 1000) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssets.id, id))
      .returning();
    await audit(tx, scope, 'fixed_assets', id, 'UPDATE', 'Updated asset register details.');
    return updated;
  });
}

export async function transferAsset(scope: AssetScope, id: number, input: Record<string, unknown>) {
  const transferDate = isoDate(input.transferDate, 'Transfer date');
  const reason = requiredText(input.reason, 'Reason', 500);
  const toDepartmentId = input.toDepartmentId
    ? positiveId(input.toDepartmentId, 'Destination department')
    : null;
  const toEmployeeId = input.toEmployeeId ? positiveId(input.toEmployeeId, 'New custodian') : null;
  const toLocation = optionalText(input.toLocation, 'Destination location', 160);

  if (!toDepartmentId && !toEmployeeId && !toLocation)
    fail(400, 'INVALID_TRANSFER', 'A transfer must change the department, custodian or location.');

  return withTx(async (tx, client) => {
    const asset = await findAsset(tx, scope, id, true);
    if (asset.status !== 'ACTIVE') fail(409, 'ASSET_DISPOSED', 'A disposed asset cannot be moved.');

    if (toDepartmentId) {
      const [department] = await tx
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(
          and(
            eq(schema.departments.id, toDepartmentId),
            eq(schema.departments.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', 'Department not found in this facility.');
    }
    if (toEmployeeId) {
      const [employee] = await tx
        .select({ id: schema.hrEmployees.id })
        .from(schema.hrEmployees)
        .where(
          and(
            eq(schema.hrEmployees.id, toEmployeeId),
            eq(schema.hrEmployees.tenantId, scope.tenantId),
            eq(schema.hrEmployees.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Custodian not found in this facility.');
    }

    const [transfer] = await tx
      .insert(schema.fixedAssetTransfers)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetId: id,
        transferDate,
        fromDepartmentId: asset.departmentId ?? undefined,
        toDepartmentId: toDepartmentId ?? undefined,
        fromEmployeeId: asset.custodianEmployeeId ?? undefined,
        toEmployeeId: toEmployeeId ?? undefined,
        fromLocation: asset.location ?? undefined,
        toLocation: toLocation ?? undefined,
        reason,
        recordedByUserId: scope.actorId,
      })
      .returning();

    await tx
      .update(schema.fixedAssets)
      .set({
        departmentId: toDepartmentId ?? asset.departmentId,
        custodianEmployeeId: toEmployeeId ?? asset.custodianEmployeeId,
        location: toLocation ?? asset.location,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssets.id, id));
    await audit(
      tx,
      scope,
      'fixed_assets',
      id,
      'TRANSFER',
      `Transferred on ${transferDate}: ${reason}`,
    );
    return transfer;
  });
}

/* ============================================================
   DEPRECIATION
   ============================================================ */

export async function depreciationPreview(scope: AssetScope, period: string) {
  if (!PERIOD.test(period)) fail(400, 'INVALID_PERIOD', 'Period must be YYYY-MM.');
  const assets = await db
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
        eq(schema.fixedAssets.status, 'ACTIVE'),
      ),
    )
    .orderBy(asc(schema.fixedAssets.assetCode));
  const existing = await db
    .select({ assetId: schema.fixedAssetMovements.assetId })
    .from(schema.fixedAssetMovements)
    .where(
      and(
        eq(schema.fixedAssetMovements.facilityId, scope.facilityId),
        eq(schema.fixedAssetMovements.movementType, 'DEPRECIATION'),
        eq(schema.fixedAssetMovements.periodCode, period),
      ),
    );
  const done = new Set(existing.map((row) => row.assetId));

  return assets
    .filter((asset) => asset.acquisitionDate.slice(0, 7) <= period)
    .map((asset) => {
      const result = monthlyDepreciation({
        acquisitionCostCents: BigInt(Math.round(Number(asset.acquisitionCostKes) * 100)),
        salvageValueCents: BigInt(Math.round(Number(asset.salvageValueKes) * 100)),
        usefulLifeMonths: asset.usefulLifeMonths,
        accumulatedDepreciationCents: BigInt(
          Math.round(Number(asset.accumulatedDepreciationKes) * 100),
        ),
      });
      return {
        assetId: asset.id,
        assetCode: asset.assetCode,
        assetName: asset.assetName,
        category: asset.category,
        alreadyPosted: done.has(asset.id),
        chargeCents: result.chargeCents.toString(),
        netBookValueAfterCents: result.netBookValueAfterCents.toString(),
        fullyDepreciated: result.fullyDepreciated,
      };
    });
}

export async function runDepreciation(
  scope: AssetScope,
  input: { period: string; entryDate?: string },
) {
  const period = String(input.period ?? '');
  if (!PERIOD.test(period)) fail(400, 'INVALID_PERIOD', 'Period must be YYYY-MM.');
  const entryDate = input.entryDate ? isoDate(input.entryDate, 'Entry date') : `${period}-28`;
  if (periodOf(entryDate) !== period)
    fail(400, 'PERIOD_MISMATCH', 'The entry date must fall inside the depreciation period.');

  return withTx(async (tx, client) => {
    // Serialise concurrent runs for this facility and period.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      `fixed-asset-dep:${period}`,
      scope.facilityId,
    ]);
    const assets = await tx
      .select()
      .from(schema.fixedAssets)
      .where(
        and(
          eq(schema.fixedAssets.tenantId, scope.tenantId),
          eq(schema.fixedAssets.facilityId, scope.facilityId),
          eq(schema.fixedAssets.status, 'ACTIVE'),
        ),
      )
      .for('update');

    const posted = await tx
      .select({ assetId: schema.fixedAssetMovements.assetId })
      .from(schema.fixedAssetMovements)
      .where(
        and(
          eq(schema.fixedAssetMovements.facilityId, scope.facilityId),
          eq(schema.fixedAssetMovements.movementType, 'DEPRECIATION'),
          eq(schema.fixedAssetMovements.periodCode, period),
        ),
      );
    const done = new Set(posted.map((row) => row.assetId));

    const charges: Array<{
      asset: typeof schema.fixedAssets.$inferSelect;
      chargeCents: bigint;
      netBookAfterCents: bigint;
    }> = [];
    for (const asset of assets) {
      if (done.has(asset.id)) continue;
      if (asset.acquisitionDate.slice(0, 7) > period) continue;
      const result = monthlyDepreciation({
        acquisitionCostCents: BigInt(Math.round(Number(asset.acquisitionCostKes) * 100)),
        salvageValueCents: BigInt(Math.round(Number(asset.salvageValueKes) * 100)),
        usefulLifeMonths: asset.usefulLifeMonths,
        accumulatedDepreciationCents: BigInt(
          Math.round(Number(asset.accumulatedDepreciationKes) * 100),
        ),
      });
      if (result.chargeCents === 0n) continue;
      charges.push({
        asset,
        chargeCents: result.chargeCents,
        netBookAfterCents: result.netBookValueAfterCents,
      });
    }

    if (!charges.length)
      return { period, journals: [], chargedCents: '0', assetsCharged: 0, alreadyPosted: true };

    const byPair = new Map<
      string,
      { debitAccountId: number; creditAccountId: number; amount: bigint }
    >();
    for (const entry of charges) {
      const key = `${entry.asset.depExpenseAccountId}:${entry.asset.accumDepAccountId}`;
      const current = byPair.get(key);
      if (current) current.amount += entry.chargeCents;
      else
        byPair.set(key, {
          debitAccountId: entry.asset.depExpenseAccountId,
          creditAccountId: entry.asset.accumDepAccountId,
          amount: entry.chargeCents,
        });
    }
    const accountIds = [...byPair.values()].flatMap((pair) => [
      pair.debitAccountId,
      pair.creditAccountId,
    ]);
    await assertAccounts(tx, scope, accountIds);

    const lines: JournalLine[] = [...byPair.values()].flatMap((pair) => [
      {
        accountId: pair.debitAccountId,
        debitCents: pair.amount,
        creditCents: 0n,
        description: `Depreciation ${period}`,
        serviceLine: null,
      },
      {
        accountId: pair.creditAccountId,
        debitCents: 0n,
        creditCents: pair.amount,
        description: `Depreciation ${period}`,
        serviceLine: null,
      },
    ]);
    const totalCents = charges.reduce((sum, entry) => sum + entry.chargeCents, 0n);

    const journal = await postInsideTransaction(client, accountingScope(scope), {
      entryDate,
      description: `Fixed-asset depreciation — ${period}`.slice(0, 500),
      idempotencyKey: `fixed-asset-depreciation:${period}`,
      lines,
      totalCents,
      sourceType: 'FIXED_ASSET',
      sourceId: `DEP-${period}`,
    });

    for (const entry of charges) {
      await tx.insert(schema.fixedAssetMovements).values({
        assetId: entry.asset.id,
        facilityId: scope.facilityId,
        movementType: 'DEPRECIATION',
        movementDate: entryDate,
        periodCode: period,
        amountKes: centsAsKes(entry.chargeCents),
        netBookValueAfterKes: centsAsKes(entry.netBookAfterCents),
        journalEntryId: Number(journal.journal.id),
        notes: `Monthly depreciation for ${period}.`,
        recordedByUserId: scope.actorId,
      });
      await tx
        .update(schema.fixedAssets)
        .set({
          accumulatedDepreciationKes: centsAsKes(
            BigInt(Math.round(Number(entry.asset.accumulatedDepreciationKes) * 100)) +
              entry.chargeCents,
          ),
          netBookValueKes: centsAsKes(entry.netBookAfterCents),
          updatedAt: new Date(),
        })
        .where(eq(schema.fixedAssets.id, entry.asset.id));
    }

    await audit(
      tx,
      scope,
      'fixed_assets',
      journal.journal.id,
      'DEPRECIATION',
      `Posted ${period} depreciation for ${charges.length} asset(s), ${centsAsKes(totalCents)} KES.`,
    );
    return {
      period,
      journalId: journal.journal.id,
      journalNumber: journal.journal.journalNumber,
      chargedCents: totalCents.toString(),
      assetsCharged: charges.length,
      alreadyPosted: journal.idempotentReplay,
    };
  });
}

/* ============================================================
   DISPOSAL
   ============================================================ */

export async function disposeAsset(scope: AssetScope, id: number, input: Record<string, unknown>) {
  const disposalDate = isoDate(input.disposalDate, 'Disposal date');
  const proceeds = input.proceedsKes === undefined ? 0n : money(input.proceedsKes, 'Proceeds');
  const proceedsAccountId =
    proceeds > 0n ? positiveId(input.proceedsAccountId, 'Proceeds account') : null;
  const gainLossAccountId = positiveId(input.gainLossAccountId, 'Gain/loss account');
  const reason = requiredText(input.reason, 'Disposal reason', 500);

  return withTx(async (tx, client) => {
    const asset = await findAsset(tx, scope, id, true);
    if (asset.status !== 'ACTIVE')
      fail(409, 'ASSET_DISPOSED', 'This asset has already been disposed.');

    const costCents = BigInt(Math.round(Number(asset.acquisitionCostKes) * 100));
    const accumulatedCents = BigInt(Math.round(Number(asset.accumulatedDepreciationKes) * 100));
    const netBookCents = BigInt(Math.round(Number(asset.netBookValueKes) * 100));
    const gainLossCents = proceeds - netBookCents;
    const accounts = proceedsAccountId
      ? [proceedsAccountId, gainLossAccountId]
      : [gainLossAccountId];
    await assertAccounts(tx, scope, accounts);

    const lines: JournalLine[] = [];
    if (proceedsAccountId && proceeds > 0n)
      lines.push({
        accountId: proceedsAccountId,
        debitCents: proceeds,
        creditCents: 0n,
        description: `Proceeds — ${asset.assetCode}`,
        serviceLine: null,
      });
    if (accumulatedCents > 0n)
      lines.push({
        accountId: asset.accumDepAccountId,
        debitCents: accumulatedCents,
        creditCents: 0n,
        description: `Accumulated depreciation — ${asset.assetCode}`,
        serviceLine: null,
      });
    lines.push({
      accountId: asset.assetAccountId,
      debitCents: 0n,
      creditCents: costCents,
      description: `Cost removed — ${asset.assetCode}`,
      serviceLine: null,
    });
    if (gainLossCents > 0n)
      lines.push({
        accountId: gainLossAccountId,
        debitCents: 0n,
        creditCents: gainLossCents,
        description: `Gain on disposal — ${asset.assetCode}`,
        serviceLine: null,
      });
    if (gainLossCents < 0n)
      lines.push({
        accountId: gainLossAccountId,
        debitCents: -gainLossCents,
        creditCents: 0n,
        description: `Loss on disposal — ${asset.assetCode}`,
        serviceLine: null,
      });

    const journal = await postInsideTransaction(client, accountingScope(scope), {
      entryDate: disposalDate,
      description: `Asset disposal — ${asset.assetCode} ${asset.assetName}`.slice(0, 500),
      idempotencyKey: `fixed-asset-disposal:${asset.id}`,
      lines,
      totalCents: costCents > accumulatedCents + proceeds ? costCents : accumulatedCents + proceeds,
      sourceType: 'FIXED_ASSET',
      sourceId: `DISP-${asset.id}`,
    });

    const [updated] = await tx
      .update(schema.fixedAssets)
      .set({
        status: 'DISPOSED',
        disposedAt: new Date(),
        disposalProceedsKes: centsAsKes(proceeds),
        disposalProceedsAccountId: proceedsAccountId ?? undefined,
        disposalGainLossAccountId: gainLossAccountId,
        disposalJournalId: Number(journal.journal.id),
        disposalNotes: reason,
        netBookValueKes: '0.00',
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssets.id, asset.id))
      .returning();

    await tx.insert(schema.fixedAssetMovements).values({
      assetId: asset.id,
      facilityId: scope.facilityId,
      movementType: 'DISPOSAL',
      movementDate: disposalDate,
      periodCode: periodOf(disposalDate),
      amountKes: centsAsKes(proceeds),
      netBookValueAfterKes: '0.00',
      journalEntryId: Number(journal.journal.id),
      notes: reason,
      recordedByUserId: scope.actorId,
    });
    await audit(
      tx,
      scope,
      'fixed_assets',
      asset.id,
      'DISPOSE',
      `Disposed ${asset.assetCode} for ${centsAsKes(proceeds)} KES (net book ${centsAsKes(netBookCents)} KES).`,
    );
    return {
      asset: updated,
      journalNumber: journal.journal.journalNumber,
      gainLossCents: gainLossCents.toString(),
    };
  });
}

/* ============================================================
   MAINTENANCE
   ============================================================ */

export async function listMaintenance(scope: AssetScope, status?: string) {
  const conditions = [
    eq(schema.fixedAssetMaintenance.tenantId, scope.tenantId),
    eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
  ];
  if (status && MAINTENANCE_STATUSES.includes(status as (typeof MAINTENANCE_STATUSES)[number]))
    conditions.push(eq(schema.fixedAssetMaintenance.status, status));
  return db
    .select({
      id: schema.fixedAssetMaintenance.id,
      assetId: schema.fixedAssetMaintenance.assetId,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      maintenanceDate: schema.fixedAssetMaintenance.maintenanceDate,
      maintenanceType: schema.fixedAssetMaintenance.maintenanceType,
      vendor: schema.fixedAssetMaintenance.vendor,
      description: schema.fixedAssetMaintenance.description,
      costKes: schema.fixedAssetMaintenance.costKes,
      status: schema.fixedAssetMaintenance.status,
      completedDate: schema.fixedAssetMaintenance.completedDate,
      journalEntryId: schema.fixedAssetMaintenance.journalEntryId,
    })
    .from(schema.fixedAssetMaintenance)
    .innerJoin(schema.fixedAssets, eq(schema.fixedAssets.id, schema.fixedAssetMaintenance.assetId))
    .where(and(...conditions))
    .orderBy(
      desc(schema.fixedAssetMaintenance.maintenanceDate),
      desc(schema.fixedAssetMaintenance.id),
    )
    .limit(200);
}

export async function createMaintenance(scope: AssetScope, input: Record<string, unknown>) {
  const assetId = positiveId(input.assetId, 'Asset');
  const maintenanceDate = isoDate(input.maintenanceDate, 'Maintenance date');
  const maintenanceType = String(input.maintenanceType ?? 'PREVENTIVE');
  if (!MAINTENANCE_TYPES.includes(maintenanceType as (typeof MAINTENANCE_TYPES)[number]))
    fail(400, 'INVALID_TYPE', 'Maintenance type must be PREVENTIVE, CORRECTIVE or INSPECTION.');
  const costCents = input.costKes === undefined ? 0n : money(input.costKes, 'Maintenance cost');
  const expenseAccountId = input.expenseAccountId
    ? positiveId(input.expenseAccountId, 'Expense account')
    : null;
  const creditAccountId = input.creditAccountId
    ? positiveId(input.creditAccountId, 'Credit account')
    : null;
  if (costCents > 0n && (!expenseAccountId || !creditAccountId))
    fail(
      400,
      'ACCOUNTS_REQUIRED',
      'A costed maintenance job needs an expense account and a payment/credit account.',
    );

  return withTx(async (tx, client) => {
    const asset = await findAsset(tx, scope, assetId, true);
    if (asset.status !== 'ACTIVE')
      fail(409, 'ASSET_DISPOSED', 'A disposed asset cannot be maintained.');
    if (expenseAccountId && creditAccountId)
      await assertAccounts(tx, scope, [expenseAccountId, creditAccountId]);

    const [created] = await tx
      .insert(schema.fixedAssetMaintenance)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetId,
        maintenanceDate,
        maintenanceType,
        vendor: optionalText(input.vendor, 'Vendor', 160) ?? undefined,
        description: requiredText(input.description, 'Description', 500),
        costKes: centsAsKes(costCents),
        status: 'PLANNED',
        expenseAccountId: expenseAccountId ?? undefined,
        recordedByUserId: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance',
      created.id,
      'CREATE',
      `Planned ${maintenanceType} maintenance.`,
    );
    return created;
  });
}

export async function completeMaintenance(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  const completedDate = isoDate(input.completedDate, 'Completion date');
  return withTx(async (tx, client) => {
    const [job] = await tx
      .select()
      .from(schema.fixedAssetMaintenance)
      .where(
        and(
          eq(schema.fixedAssetMaintenance.id, id),
          eq(schema.fixedAssetMaintenance.tenantId, scope.tenantId),
          eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!job) fail(404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found.');
    if (job.status !== 'PLANNED')
      fail(409, 'INVALID_STATUS', 'Only a planned maintenance job can be completed.');

    const costCents = BigInt(Math.round(Number(job.costKes) * 100));
    let journalId: number | null = job.journalEntryId ?? null;
    if (costCents > 0n) {
      const expenseAccountId = positiveId(job.expenseAccountId, 'Expense account');
      const creditAccountId = positiveId(input.creditAccountId, 'Payment/credit account');
      await assertAccounts(tx, scope, [expenseAccountId, creditAccountId]);
      const journal = await postInsideTransaction(client, accountingScope(scope), {
        entryDate: completedDate,
        description: `Asset maintenance — ${job.description}`.slice(0, 500),
        idempotencyKey: `fixed-asset-maintenance:${id}`,
        lines: [
          {
            accountId: expenseAccountId,
            debitCents: costCents,
            creditCents: 0n,
            description: job.description,
            serviceLine: null,
          },
          {
            accountId: creditAccountId,
            debitCents: 0n,
            creditCents: costCents,
            description: job.description,
            serviceLine: null,
          },
        ],
        totalCents: costCents,
        sourceType: 'FIXED_ASSET',
        sourceId: `MAINT-${id}`,
      });
      journalId = Number(journal.journal.id);
    }

    const [updated] = await tx
      .update(schema.fixedAssetMaintenance)
      .set({
        status: 'COMPLETED',
        completedDate,
        journalEntryId: journalId,
      })
      .where(eq(schema.fixedAssetMaintenance.id, id))
      .returning();

    await tx.insert(schema.fixedAssetMovements).values({
      assetId: job.assetId,
      facilityId: scope.facilityId,
      movementType: 'MAINTENANCE',
      movementDate: completedDate,
      periodCode: periodOf(completedDate),
      amountKes: job.costKes,
      netBookValueAfterKes: (
        await tx
          .select({ netBookValueKes: schema.fixedAssets.netBookValueKes })
          .from(schema.fixedAssets)
          .where(eq(schema.fixedAssets.id, job.assetId))
          .limit(1)
      )[0].netBookValueKes,
      journalEntryId: journalId,
      notes: job.description,
      recordedByUserId: scope.actorId,
    });
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance',
      id,
      'COMPLETE',
      `Completed maintenance on ${completedDate}.`,
    );
    return updated;
  });
}

export async function listTransfers(scope: AssetScope) {
  return db
    .select({
      id: schema.fixedAssetTransfers.id,
      assetId: schema.fixedAssetTransfers.assetId,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      transferDate: schema.fixedAssetTransfers.transferDate,
      fromLocation: schema.fixedAssetTransfers.fromLocation,
      toLocation: schema.fixedAssetTransfers.toLocation,
      reason: schema.fixedAssetTransfers.reason,
    })
    .from(schema.fixedAssetTransfers)
    .innerJoin(schema.fixedAssets, eq(schema.fixedAssets.id, schema.fixedAssetTransfers.assetId))
    .where(eq(schema.fixedAssetTransfers.facilityId, scope.facilityId))
    .orderBy(desc(schema.fixedAssetTransfers.transferDate))
    .limit(200);
}

/** Register totals by category, used by the report tab and print view. */
export async function assetRegisterReport(scope: AssetScope) {
  const rows = await db
    .select({
      category: schema.fixedAssets.category,
      assetCount: sql<number>`count(*)::int`,
      costCents: sql<string>`coalesce(sum(${schema.fixedAssets.acquisitionCostKes}), 0)::numeric(20,2) * 100`,
      accumulatedCents: sql<string>`coalesce(sum(${schema.fixedAssets.accumulatedDepreciationKes}), 0)::numeric(20,2) * 100`,
      netBookCents: sql<string>`coalesce(sum(${schema.fixedAssets.netBookValueKes}), 0)::numeric(20,2) * 100`,
    })
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
        eq(schema.fixedAssets.status, 'ACTIVE'),
      ),
    )
    .groupBy(schema.fixedAssets.category)
    .orderBy(asc(schema.fixedAssets.category));
  return rows.map((row) => ({
    category: row.category,
    assetCount: row.assetCount,
    costCents: String(Math.round(Number(row.costCents))),
    accumulatedCents: String(Math.round(Number(row.accumulatedCents))),
    netBookCents: String(Math.round(Number(row.netBookCents))),
  }));
}

/** Depreciation history for an asset, newest first. */
export async function assetDepreciationHistory(scope: AssetScope, id: number) {
  const [asset] = await db
    .select({ id: schema.fixedAssets.id })
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.id, id),
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!asset) fail(404, 'ASSET_NOT_FOUND', 'Asset not found in this facility.');
  return db
    .select()
    .from(schema.fixedAssetMovements)
    .where(
      and(
        eq(schema.fixedAssetMovements.assetId, id),
        eq(schema.fixedAssetMovements.movementType, 'DEPRECIATION'),
      ),
    )
    .orderBy(desc(schema.fixedAssetMovements.periodCode));
}
