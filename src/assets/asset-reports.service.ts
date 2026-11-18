/**
 * Fixed-asset reports.
 *
 * Every report is built once, as columns plus rows, and the screen, the PDF and
 * the spreadsheet all render that same structure. There is no second query for
 * exports, so an exported report cannot disagree with the screen it came from.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import * as schema from '../db/schema.ts';
import { db } from '../db/index.ts';
import { centsToKes } from '../accounting/accounting.service.ts';
import { fail, type AssetScope } from './fixed-assets.service.ts';
import { addPeriods, financialYearOf } from './depreciation.ts';
import { resolveDepreciationPolicy } from './depreciation-policy.ts';

export type AssetReportKey =
  | 'register'
  | 'acquisitions'
  | 'category-summary'
  | 'location-custodian'
  | 'depreciation-monthly'
  | 'depreciation-annual'
  | 'accumulated-depreciation'
  | 'net-book-value'
  | 'maintenance-history'
  | 'preventive-due'
  | 'corrective-cost'
  | 'inspections'
  | 'disposals'
  | 'movements-transfers'
  | 'reconciliation';

export type AssetReportColumn = {
  key: string;
  label: string;
  kind?: 'money' | 'number' | 'date';
};

export type AssetReportRow = Record<string, string | number | null>;

export interface AssetReportResult {
  key: AssetReportKey;
  title: string;
  description: string;
  facilityId: number;
  facilityName: string;
  currency: 'KES';
  generatedAt: string;
  filters: Record<string, string | number | null>;
  filterSummary: string;
  columns: readonly AssetReportColumn[];
  rows: AssetReportRow[];
  totals: AssetReportRow | null;
  notes: string[];
}

export const ASSET_REPORTS: ReadonlyArray<{
  key: AssetReportKey;
  title: string;
  description: string;
  needsPeriod: boolean;
  needsRange: boolean;
  columns: readonly AssetReportColumn[];
}> = Object.freeze([
  {
    key: 'register',
    title: 'Fixed Asset Register',
    description: 'Every registered asset with cost, accumulated depreciation and net book value.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'category', label: 'Category' },
      { key: 'department', label: 'Department' },
      { key: 'location', label: 'Location' },
      { key: 'serialNumber', label: 'Serial number' },
      { key: 'acquisitionDate', label: 'Acquired', kind: 'date' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
      { key: 'salvageCents', label: 'Residual', kind: 'money' },
      { key: 'usefulLifeMonths', label: 'Life (months)', kind: 'number' },
      { key: 'annualRatePct', label: 'Rate p.a. (%)' },
      { key: 'accumulatedCents', label: 'Accumulated', kind: 'money' },
      { key: 'netBookCents', label: 'Net book value', kind: 'money' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    key: 'acquisitions',
    title: 'Asset Acquisition Report',
    description: 'Assets acquired in a period, with method, supplier and funding source.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'category', label: 'Category' },
      { key: 'acquisitionDate', label: 'Acquired', kind: 'date' },
      { key: 'method', label: 'Method' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'purchaseReference', label: 'Purchase reference' },
      { key: 'fundingSource', label: 'Funding source' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
    ],
  },
  {
    key: 'category-summary',
    title: 'Asset Category Summary',
    description: 'Asset count and values by category.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'assetCount', label: 'Assets', kind: 'number' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
      { key: 'accumulatedCents', label: 'Accumulated', kind: 'money' },
      { key: 'netBookCents', label: 'Net book value', kind: 'money' },
    ],
  },
  {
    key: 'location-custodian',
    title: 'Asset Location and Custodian Report',
    description: 'Where each asset is held and who is accountable for it.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'location', label: 'Location' },
      { key: 'department', label: 'Department' },
      { key: 'custodian', label: 'Custodian' },
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'condition', label: 'Condition' },
      { key: 'netBookCents', label: 'Net book value', kind: 'money' },
    ],
  },
  {
    key: 'depreciation-monthly',
    title: 'Monthly Depreciation Schedule',
    description:
      'The posted charge for every asset in an accounting month, with opening and closing balances.',
    needsPeriod: true,
    needsRange: false,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
      { key: 'salvageCents', label: 'Residual', kind: 'money' },
      { key: 'basisCents', label: 'Depreciable base', kind: 'money' },
      { key: 'usefulLifeMonths', label: 'Life (months)', kind: 'number' },
      { key: 'annualRatePct', label: 'Rate p.a. (%)' },
      { key: 'convention', label: 'Convention' },
      { key: 'openingAccumulatedCents', label: 'Opening accumulated', kind: 'money' },
      { key: 'chargeCents', label: 'Charge for month', kind: 'money' },
      { key: 'closingAccumulatedCents', label: 'Closing accumulated', kind: 'money' },
      { key: 'openingNbvCents', label: 'Opening book value', kind: 'money' },
      { key: 'closingNbvCents', label: 'Closing book value', kind: 'money' },
    ],
  },
  {
    key: 'depreciation-annual',
    title: 'Annual Depreciation Schedule',
    description: 'Charges posted across a financial year, by asset, with the financial-year total.',
    needsPeriod: true,
    needsRange: false,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'monthsCharged', label: 'Months charged', kind: 'number' },
      { key: 'chargeCents', label: 'Depreciation for year', kind: 'money' },
      { key: 'closingAccumulatedCents', label: 'Accumulated at year end', kind: 'money' },
      { key: 'closingNbvCents', label: 'Book value at year end', kind: 'money' },
    ],
  },
  {
    key: 'accumulated-depreciation',
    title: 'Accumulated Depreciation Report',
    description: 'Depreciation charged to date against each asset.',
    needsPeriod: false,
    needsRange: false,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'category', label: 'Category' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
      { key: 'accumulatedCents', label: 'Accumulated depreciation', kind: 'money' },
      { key: 'remainingCents', label: 'Still to depreciate', kind: 'money' },
    ],
  },
  {
    key: 'net-book-value',
    title: 'Net Book Value Report',
    description: 'Carrying value of every asset after accumulated depreciation and impairment.',
    needsPeriod: false,
    needsRange: false,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
      { key: 'accumulatedCents', label: 'Accumulated', kind: 'money' },
      { key: 'impairmentCents', label: 'Impairment', kind: 'money' },
      { key: 'netBookCents', label: 'Net book value', kind: 'money' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    key: 'maintenance-history',
    title: 'Maintenance History',
    description: 'Preventive and corrective work recorded against each asset.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'maintenanceDate', label: 'Date', kind: 'date' },
      { key: 'maintenanceType', label: 'Type' },
      { key: 'priority', label: 'Priority' },
      { key: 'description', label: 'Work' },
      { key: 'technician', label: 'Technician / vendor' },
      { key: 'status', label: 'Status' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
      { key: 'downtimeHours', label: 'Downtime (hours)' },
    ],
  },
  {
    key: 'preventive-due',
    title: 'Preventive Maintenance Due',
    description: 'Scheduled preventive work that is due or overdue, with the responsible team.',
    needsPeriod: false,
    needsRange: false,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'schedule', label: 'Schedule' },
      { key: 'frequency', label: 'Frequency' },
      { key: 'nextDueDate', label: 'Next due', kind: 'date' },
      { key: 'daysUntilDue', label: 'Days', kind: 'number' },
      { key: 'status', label: 'Status' },
      { key: 'department', label: 'Responsible department' },
      { key: 'technician', label: 'Technician / vendor' },
    ],
  },
  {
    key: 'corrective-cost',
    title: 'Corrective Maintenance and Repair Cost',
    description: 'Repair spend by asset, with downtime and the job count.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'jobs', label: 'Repairs', kind: 'number' },
      { key: 'downtimeHours', label: 'Downtime (hours)' },
      { key: 'costCents', label: 'Repair cost', kind: 'money' },
    ],
  },
  {
    key: 'inspections',
    title: 'Inspection Report',
    description: 'Inspection findings, condition assessed and follow-up actions.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'inspectionDate', label: 'Date', kind: 'date' },
      { key: 'inspector', label: 'Inspector' },
      { key: 'condition', label: 'Condition' },
      { key: 'findings', label: 'Findings' },
      { key: 'recommendations', label: 'Recommendations' },
      { key: 'followUpActions', label: 'Follow-up' },
      { key: 'nextInspectionDate', label: 'Next inspection', kind: 'date' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    key: 'disposals',
    title: 'Disposal and Retirement Report',
    description: 'Assets disposed or retired, with proceeds and the resulting gain or loss.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'status', label: 'Outcome' },
      { key: 'disposalDate', label: 'Date', kind: 'date' },
      { key: 'costCents', label: 'Original cost', kind: 'money' },
      { key: 'accumulatedCents', label: 'Accumulated at disposal', kind: 'money' },
      { key: 'proceedsCents', label: 'Proceeds', kind: 'money' },
      { key: 'gainLossCents', label: 'Gain / (loss)', kind: 'money' },
      { key: 'journalNumber', label: 'Journal' },
    ],
  },
  {
    key: 'movements-transfers',
    title: 'Asset Movement and Transfer Report',
    description: 'Departmental, location and custodian moves recorded for each asset.',
    needsPeriod: false,
    needsRange: true,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'transferDate', label: 'Date', kind: 'date' },
      { key: 'fromLocation', label: 'From location' },
      { key: 'toLocation', label: 'To location' },
      { key: 'fromDepartment', label: 'From department' },
      { key: 'toDepartment', label: 'To department' },
      { key: 'reason', label: 'Reason' },
    ],
  },
  {
    key: 'reconciliation',
    title: 'Fixed Asset Reconciliation',
    description:
      'Register balances against the depreciation posted to the asset accumulated-depreciation accounts.',
    needsPeriod: false,
    needsRange: false,
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'assetName', label: 'Asset name' },
      { key: 'registerAccumulatedCents', label: 'Register accumulated', kind: 'money' },
      { key: 'ledgerAccumulatedCents', label: 'Ledger accumulated', kind: 'money' },
      { key: 'differenceCents', label: 'Difference', kind: 'money' },
      { key: 'status', label: 'Status' },
    ],
  },
]);

function money(value: string | number | null | undefined): string {
  return centsToKes(BigInt(Math.round(Number(value ?? 0) * 100)));
}

/** Columns that already hold integer cents. */
function storedCents(value: string | number | null | undefined): string {
  return centsToKes(BigInt(Math.round(Number(value ?? 0))));
}

function pct(bps: number | null | undefined): string {
  return ((bps ?? 0) / 100).toFixed(2);
}

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  categoryId?: number;
  departmentId?: number;
  assetId?: number;
  period?: string;
  status?: string;
}

async function facilityName(scope: AssetScope): Promise<string> {
  const [row] = await db
    .select({ name: schema.facilities.name })
    .from(schema.facilities)
    .where(eq(schema.facilities.id, scope.facilityId))
    .limit(1);
  return row?.name ?? `Facility ${scope.facilityId}`;
}

function assetConditions(scope: AssetScope, filters: ReportFilters) {
  const conditions = [
    eq(schema.fixedAssets.tenantId, scope.tenantId),
    eq(schema.fixedAssets.facilityId, scope.facilityId),
  ];
  if (filters.categoryId) conditions.push(eq(schema.fixedAssets.categoryId, filters.categoryId));
  if (filters.departmentId)
    conditions.push(eq(schema.fixedAssets.departmentId, filters.departmentId));
  if (filters.assetId) conditions.push(eq(schema.fixedAssets.id, filters.assetId));
  if (filters.status) conditions.push(eq(schema.fixedAssets.status, filters.status));
  if (filters.dateFrom) conditions.push(gte(schema.fixedAssets.acquisitionDate, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(schema.fixedAssets.acquisitionDate, filters.dateTo));
  return conditions;
}

export async function buildAssetReport(
  scope: AssetScope,
  key: AssetReportKey,
  filters: ReportFilters = {},
): Promise<AssetReportResult> {
  const definition = ASSET_REPORTS.find((report) => report.key === key);
  if (!definition) fail(404, 'REPORT_NOT_FOUND', 'Unknown fixed-asset report.');
  const [name, policy] = await Promise.all([
    facilityName(scope),
    resolveDepreciationPolicy(db, scope),
  ]);
  const period = filters.period ?? new Date().toISOString().slice(0, 7);
  if (definition.needsPeriod && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    fail(400, 'INVALID_PERIOD', 'This report needs an accounting month (YYYY-MM).');

  const base = {
    key,
    title: definition.title,
    description: definition.description,
    facilityId: scope.facilityId,
    facilityName: name,
    currency: 'KES' as const,
    generatedAt: new Date().toISOString(),
    filters: { ...filters, period: definition.needsPeriod ? period : null },
    notes: [] as string[],
  };

  const where = and(...assetConditions(scope, filters));

  /* The register-shaped reports share one ordered query. */
  const assetRows = async () =>
    db
      .select({
        id: schema.fixedAssets.id,
        assetCode: schema.fixedAssets.assetCode,
        assetName: schema.fixedAssets.assetName,
        category: schema.fixedAssets.category,
        department: schema.departments.name,
        location: schema.fixedAssets.location,
        custodian: sql<string | null>`(
          SELECT concat_ws(' ', e.first_name, e.last_name) FROM ${schema.hrEmployees} e
          WHERE e.id = ${schema.fixedAssets.custodianEmployeeId}
        )`,
        serialNumber: schema.fixedAssets.serialNumber,
        acquisitionDate: schema.fixedAssets.acquisitionDate,
        acquisitionMethod: schema.fixedAssets.acquisitionMethod,
        purchaseReference: schema.fixedAssets.purchaseReference,
        fundingSource: schema.fixedAssets.fundingSource,
        supplier: schema.suppliers.name,
        costKes: schema.fixedAssets.acquisitionCostKes,
        salvageKes: schema.fixedAssets.salvageValueKes,
        usefulLifeMonths: schema.fixedAssets.usefulLifeMonths,
        annualRateBps: schema.fixedAssets.annualRateBps,
        accumulatedKes: schema.fixedAssets.accumulatedDepreciationKes,
        netBookKes: schema.fixedAssets.netBookValueKes,
        impairmentKes: schema.fixedAssets.impairmentLossKes,
        condition: schema.fixedAssets.condition,
        status: schema.fixedAssets.status,
        disposedAt: schema.fixedAssets.disposedAt,
        disposalProceedsKes: schema.fixedAssets.disposalProceedsKes,
        disposalJournalId: schema.fixedAssets.disposalJournalId,
        journalNumber: schema.journalEntries.journalNumber,
      })
      .from(schema.fixedAssets)
      .leftJoin(schema.departments, eq(schema.departments.id, schema.fixedAssets.departmentId))
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.fixedAssets.supplierId))
      .leftJoin(
        schema.journalEntries,
        eq(schema.journalEntries.id, schema.fixedAssets.disposalJournalId),
      )
      .where(where)
      .orderBy(asc(schema.fixedAssets.assetCode));

  const withSummary = (
    rows: AssetReportRow[],
    totals: AssetReportRow | null,
    filterSummary: string,
    notes: string[] = [],
  ): AssetReportResult => ({
    ...base,
    columns: definition.columns,
    rows,
    totals,
    filterSummary,
    notes: [...notes],
  });

  const rangeText =
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom ?? 'start'} to ${filters.dateTo ?? 'today'}`
      : 'all recorded dates';

  switch (key) {
    case 'register': {
      const rows = await assetRows();
      const mapped = rows.map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        category: row.category,
        department: row.department,
        location: row.location,
        serialNumber: row.serialNumber,
        acquisitionDate: row.acquisitionDate,
        costCents: money(row.costKes),
        salvageCents: money(row.salvageKes),
        usefulLifeMonths: row.usefulLifeMonths,
        annualRatePct: pct(row.annualRateBps ?? Math.round(120000 / row.usefulLifeMonths)),
        accumulatedCents: money(row.accumulatedKes),
        netBookCents: money(row.netBookKes),
        status: row.status,
      }));
      return withSummary(
        mapped,
        {
          assetCount: mapped.length,
          costCents: money(rows.reduce((sum, row) => sum + Number(row.costKes), 0)),
          accumulatedCents: money(rows.reduce((sum, row) => sum + Number(row.accumulatedKes), 0)),
          netBookCents: money(rows.reduce((sum, row) => sum + Number(row.netBookKes), 0)),
        },
        `Acquired ${rangeText}`,
        [
          'Cost and accumulated depreciation are as recorded in the register at the time of this report.',
        ],
      );
    }
    case 'acquisitions': {
      const rows = (await assetRows()).filter(
        (row) =>
          (!filters.dateFrom || row.acquisitionDate >= filters.dateFrom) &&
          (!filters.dateTo || row.acquisitionDate <= filters.dateTo),
      );
      const mapped = rows.map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        category: row.category,
        acquisitionDate: row.acquisitionDate,
        method: row.acquisitionMethod,
        supplier: row.supplier,
        purchaseReference: row.purchaseReference,
        fundingSource: row.fundingSource,
        costCents: money(row.costKes),
      }));
      return withSummary(
        mapped,
        {
          assetCount: mapped.length,
          costCents: money(rows.reduce((sum, row) => sum + Number(row.costKes), 0)),
        },
        `Acquired ${rangeText}`,
      );
    }
    case 'category-summary': {
      const rows = await assetRows();
      const groups = new Map<
        string,
        { count: number; cost: number; accumulated: number; net: number }
      >();
      for (const row of rows) {
        const group = groups.get(row.category) ?? { count: 0, cost: 0, accumulated: 0, net: 0 };
        group.count += 1;
        group.cost += Number(row.costKes);
        group.accumulated += Number(row.accumulatedKes);
        group.net += Number(row.netBookKes);
        groups.set(row.category, group);
      }
      const mapped = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, group]) => ({
          category,
          assetCount: group.count,
          costCents: money(group.cost),
          accumulatedCents: money(group.accumulated),
          netBookCents: money(group.net),
        }));
      return withSummary(
        mapped,
        {
          assetCount: rows.length,
          costCents: money(rows.reduce((sum, row) => sum + Number(row.costKes), 0)),
          accumulatedCents: money(rows.reduce((sum, row) => sum + Number(row.accumulatedKes), 0)),
          netBookCents: money(rows.reduce((sum, row) => sum + Number(row.netBookKes), 0)),
        },
        `Assets acquired ${rangeText}`,
      );
    }
    case 'location-custodian': {
      const rows = (await assetRows()).map((row) => ({
        location: row.location ?? 'Not recorded',
        department: row.department ?? 'Not recorded',
        custodian: row.custodian ?? 'Not recorded',
        assetCode: row.assetCode,
        assetName: row.assetName,
        condition: row.condition,
        netBookCents: money(row.netBookKes),
      }));
      return withSummary(
        rows,
        {
          assetCount: rows.length,
          netBookCents: money(rows.reduce((sum, row) => sum + Number(row.netBookCents), 0)),
        },
        `Assets acquired ${rangeText}`,
        ['“Not recorded” means the register has no value. It is not an inferred location.'],
      );
    }
    case 'depreciation-monthly': {
      const batches = await db
        .select({
          id: schema.fixedAssetDepreciationBatches.id,
          status: schema.fixedAssetDepreciationBatches.status,
          journalEntryId: schema.fixedAssetDepreciationBatches.journalEntryId,
          totalCents: schema.fixedAssetDepreciationBatches.totalCents,
        })
        .from(schema.fixedAssetDepreciationBatches)
        .where(
          and(
            eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
            eq(schema.fixedAssetDepreciationBatches.periodCode, period),
          ),
        )
        .orderBy(asc(schema.fixedAssetDepreciationBatches.id));
      const posted = batches.filter((batch) => batch.status === 'POSTED').at(-1);
      if (!posted) {
        return withSummary([], null, `Period ${period}`, [
          batches.length
            ? `Depreciation for ${period} has not been posted (latest batch is ${batches.at(-1)!.status.toLowerCase()}).`
            : `No depreciation batch has been prepared for ${period}.`,
        ]);
      }
      const items = await db
        .select()
        .from(schema.fixedAssetDepreciationBatchItems)
        .where(eq(schema.fixedAssetDepreciationBatchItems.batchId, posted.id))
        .orderBy(asc(schema.fixedAssetDepreciationBatchItems.assetCode));
      const mapped = items.map((item) => ({
        assetCode: item.assetCode,
        assetName: item.assetName,
        costCents: storedCents(item.basisCents),
        salvageCents: storedCents(item.salvageCents),
        basisCents: storedCents(Number(item.basisCents) - Number(item.salvageCents)),
        usefulLifeMonths: item.usefulLifeMonths,
        annualRatePct: pct(item.annualRateBps),
        convention: item.commencement,
        openingAccumulatedCents: storedCents(item.openingAccumulatedCents),
        chargeCents: storedCents(item.chargeCents),
        closingAccumulatedCents: storedCents(item.closingAccumulatedCents),
        openingNbvCents: storedCents(item.openingNbvCents),
        closingNbvCents: storedCents(item.closingNbvCents),
      }));
      return withSummary(
        mapped,
        {
          assetCount: mapped.length,
          chargeCents: storedCents(posted.totalCents),
          closingNbvCents: storedCents(
            items.reduce((sum, item) => sum + Number(item.closingNbvCents), 0),
          ),
        },
        `Period ${period}, batch ${posted.id}`,
        [`Basis: ${policy.depreciationCommencement} convention, as recorded per asset above.`],
      );
    }
    case 'depreciation-annual': {
      const fy = financialYearOf(period, policy.financialYearStartMonth);
      const periods: string[] = [];
      for (let index = 0; index < 12; index += 1) periods.push(addPeriods(fy.startPeriod, index));
      const items = await db
        .select({
          assetCode: schema.fixedAssetDepreciationBatchItems.assetCode,
          assetName: schema.fixedAssetDepreciationBatchItems.assetName,
          periodCode: schema.fixedAssetDepreciationBatches.periodCode,
          chargeCents: schema.fixedAssetDepreciationBatchItems.chargeCents,
          closingAccumulatedCents: schema.fixedAssetDepreciationBatchItems.closingAccumulatedCents,
          closingNbvCents: schema.fixedAssetDepreciationBatchItems.closingNbvCents,
        })
        .from(schema.fixedAssetDepreciationBatchItems)
        .innerJoin(
          schema.fixedAssetDepreciationBatches,
          eq(
            schema.fixedAssetDepreciationBatches.id,
            schema.fixedAssetDepreciationBatchItems.batchId,
          ),
        )
        .where(
          and(
            eq(schema.fixedAssetDepreciationBatches.facilityId, scope.facilityId),
            eq(schema.fixedAssetDepreciationBatches.status, 'POSTED'),
            sql`${schema.fixedAssetDepreciationBatches.periodCode} = ANY(${periods})`,
          ),
        )
        .orderBy(
          asc(schema.fixedAssetDepreciationBatchItems.assetCode),
          asc(schema.fixedAssetDepreciationBatches.periodCode),
        );
      const groups = new Map<
        string,
        {
          assetName: string;
          months: number;
          charge: number;
          closingAccumulated: number;
          closingNbv: number;
        }
      >();
      for (const item of items) {
        const group = groups.get(item.assetCode) ?? {
          assetName: item.assetName,
          months: 0,
          charge: 0,
          closingAccumulated: 0,
          closingNbv: 0,
        };
        group.months += 1;
        group.charge += Number(item.chargeCents);
        group.closingAccumulated = Number(item.closingAccumulatedCents);
        group.closingNbv = Number(item.closingNbvCents);
        groups.set(item.assetCode, group);
      }
      const mapped = [...groups.entries()].map(([assetCode, group]) => ({
        assetCode,
        assetName: group.assetName,
        monthsCharged: group.months,
        chargeCents: money(group.charge),
        closingAccumulatedCents: money(group.closingAccumulated),
        closingNbvCents: money(group.closingNbv),
      }));
      return withSummary(
        mapped,
        {
          assetCount: mapped.length,
          chargeCents: money(items.reduce((sum, item) => sum + Number(item.chargeCents), 0)),
        },
        `${fy.label} (${fy.startPeriod} to ${fy.endPeriod})`,
        ['Only posted batches are included; a month with no posted batch contributes nothing.'],
      );
    }
    case 'accumulated-depreciation': {
      const rows = await assetRows();
      const mapped = rows.map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        category: row.category,
        costCents: money(row.costKes),
        accumulatedCents: money(row.accumulatedKes),
        remainingCents: money(
          Math.max(0, Number(row.costKes) - Number(row.salvageKes) - Number(row.accumulatedKes)),
        ),
      }));
      return withSummary(
        mapped,
        {
          costCents: money(rows.reduce((sum, row) => sum + Number(row.costKes), 0)),
          accumulatedCents: money(rows.reduce((sum, row) => sum + Number(row.accumulatedKes), 0)),
        },
        `Assets acquired ${rangeText}`,
      );
    }
    case 'net-book-value': {
      const rows = await assetRows();
      const mapped = rows.map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        costCents: money(row.costKes),
        accumulatedCents: money(row.accumulatedKes),
        impairmentCents: money(row.impairmentKes),
        netBookCents: money(row.netBookKes),
        status: row.status,
      }));
      return withSummary(
        mapped,
        {
          costCents: money(rows.reduce((sum, row) => sum + Number(row.costKes), 0)),
          netBookCents: money(rows.reduce((sum, row) => sum + Number(row.netBookKes), 0)),
        },
        `Assets acquired ${rangeText}`,
      );
    }
    case 'maintenance-history': {
      const conditions = [
        eq(schema.fixedAssetMaintenance.tenantId, scope.tenantId),
        eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
      ];
      if (filters.dateFrom)
        conditions.push(gte(schema.fixedAssetMaintenance.maintenanceDate, filters.dateFrom));
      if (filters.dateTo)
        conditions.push(lte(schema.fixedAssetMaintenance.maintenanceDate, filters.dateTo));
      if (filters.assetId)
        conditions.push(eq(schema.fixedAssetMaintenance.assetId, filters.assetId));
      const jobs = await db
        .select({
          assetCode: schema.fixedAssets.assetCode,
          assetName: schema.fixedAssets.assetName,
          maintenanceDate: schema.fixedAssetMaintenance.maintenanceDate,
          maintenanceType: schema.fixedAssetMaintenance.maintenanceType,
          priority: schema.fixedAssetMaintenance.priority,
          description: schema.fixedAssetMaintenance.description,
          technician: schema.fixedAssetMaintenance.assignedTechnician,
          vendor: schema.fixedAssetMaintenance.vendor,
          status: schema.fixedAssetMaintenance.status,
          costKes: schema.fixedAssetMaintenance.costKes,
          downtimeHours: schema.fixedAssetMaintenance.downtimeHours,
        })
        .from(schema.fixedAssetMaintenance)
        .innerJoin(
          schema.fixedAssets,
          eq(schema.fixedAssets.id, schema.fixedAssetMaintenance.assetId),
        )
        .where(and(...conditions))
        .orderBy(asc(schema.fixedAssetMaintenance.maintenanceDate));
      const mapped = jobs.map((job) => ({
        assetCode: job.assetCode,
        assetName: job.assetName,
        maintenanceDate: job.maintenanceDate,
        maintenanceType: job.maintenanceType,
        priority: job.priority,
        description: job.description,
        technician: job.technician ?? job.vendor,
        status: job.status,
        costCents: money(job.costKes),
        downtimeHours: job.downtimeHours,
      }));
      return withSummary(
        mapped,
        {
          jobs: mapped.length,
          costCents: money(jobs.reduce((sum, job) => sum + Number(job.costKes), 0)),
        },
        rangeText,
      );
    }
    case 'preventive-due': {
      const now = new Date().toISOString().slice(0, 10);
      const rows = await db
        .select({
          assetCode: schema.fixedAssets.assetCode,
          assetName: schema.fixedAssets.assetName,
          schedule: schema.fixedAssetMaintenanceSchedules.name,
          frequency: schema.fixedAssetMaintenanceSchedules.frequency,
          nextDueDate: schema.fixedAssetMaintenanceSchedules.nextDueDate,
          department: schema.departments.name,
          technician: schema.fixedAssetMaintenanceSchedules.assignedTechnician,
          vendor: schema.fixedAssetMaintenanceSchedules.vendor,
          isActive: schema.fixedAssetMaintenanceSchedules.isActive,
        })
        .from(schema.fixedAssetMaintenanceSchedules)
        .innerJoin(
          schema.fixedAssets,
          eq(schema.fixedAssets.id, schema.fixedAssetMaintenanceSchedules.assetId),
        )
        .leftJoin(
          schema.departments,
          eq(schema.departments.id, schema.fixedAssetMaintenanceSchedules.responsibleDepartmentId),
        )
        .where(
          and(
            eq(schema.fixedAssetMaintenanceSchedules.facilityId, scope.facilityId),
            eq(schema.fixedAssetMaintenanceSchedules.isActive, true),
            lte(
              schema.fixedAssetMaintenanceSchedules.nextDueDate,
              addPeriods(now.slice(0, 7), 1) + '-31',
            ),
          ),
        )
        .orderBy(asc(schema.fixedAssetMaintenanceSchedules.nextDueDate));
      const mapped = rows
        .map((row) => ({
          assetCode: row.assetCode,
          assetName: row.assetName,
          schedule: row.schedule,
          frequency: row.frequency,
          nextDueDate: row.nextDueDate,
          daysUntilDue: Math.round(
            (Date.parse(`${row.nextDueDate}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) /
              86_400_000,
          ),
          status: row.nextDueDate < now ? 'OVERDUE' : row.nextDueDate === now ? 'DUE' : 'SCHEDULED',
          department: row.department,
          technician: row.technician ?? row.vendor,
        }))
        .filter((row) => row.daysUntilDue <= 31);
      return withSummary(
        mapped,
        {
          schedules: mapped.length,
          overdue: mapped.filter((row) => row.status === 'OVERDUE').length,
        },
        `Schedules due by ${addPeriods(now.slice(0, 7), 1)}-01`,
      );
    }
    case 'corrective-cost': {
      const conditions = [
        eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
        eq(schema.fixedAssetMaintenance.maintenanceType, 'CORRECTIVE'),
        eq(schema.fixedAssetMaintenance.status, 'COMPLETED'),
      ];
      if (filters.dateFrom)
        conditions.push(gte(schema.fixedAssetMaintenance.maintenanceDate, filters.dateFrom));
      if (filters.dateTo)
        conditions.push(lte(schema.fixedAssetMaintenance.maintenanceDate, filters.dateTo));
      if (filters.assetId)
        conditions.push(eq(schema.fixedAssetMaintenance.assetId, filters.assetId));
      const jobs = await db
        .select({
          assetCode: schema.fixedAssets.assetCode,
          assetName: schema.fixedAssets.assetName,
          costKes: schema.fixedAssetMaintenance.costKes,
          downtimeHours: schema.fixedAssetMaintenance.downtimeHours,
        })
        .from(schema.fixedAssetMaintenance)
        .innerJoin(
          schema.fixedAssets,
          eq(schema.fixedAssets.id, schema.fixedAssetMaintenance.assetId),
        )
        .where(and(...conditions));
      const groups = new Map<
        string,
        { assetName: string; jobs: number; downtime: number; cost: number }
      >();
      for (const job of jobs) {
        const group = groups.get(job.assetCode) ?? {
          assetName: job.assetName,
          jobs: 0,
          downtime: 0,
          cost: 0,
        };
        group.jobs += 1;
        group.downtime += Number(job.downtimeHours ?? 0);
        group.cost += Number(job.costKes);
        groups.set(job.assetCode, group);
      }
      const mapped = [...groups.entries()].map(([assetCode, group]) => ({
        assetCode,
        assetName: group.assetName,
        jobs: group.jobs,
        downtimeHours: group.downtime.toFixed(2),
        costCents: money(group.cost),
      }));
      return withSummary(
        mapped,
        {
          jobs: jobs.length,
          costCents: money(jobs.reduce((sum, job) => sum + Number(job.costKes), 0)),
        },
        rangeText,
      );
    }
    case 'inspections': {
      const conditions = [eq(schema.fixedAssetInspections.facilityId, scope.facilityId)];
      if (filters.dateFrom)
        conditions.push(gte(schema.fixedAssetInspections.inspectionDate, filters.dateFrom));
      if (filters.dateTo)
        conditions.push(lte(schema.fixedAssetInspections.inspectionDate, filters.dateTo));
      if (filters.assetId)
        conditions.push(eq(schema.fixedAssetInspections.assetId, filters.assetId));
      const rows = await db
        .select({
          assetCode: schema.fixedAssets.assetCode,
          assetName: schema.fixedAssets.assetName,
          inspectionDate: schema.fixedAssetInspections.inspectionDate,
          inspector: schema.fixedAssetInspections.inspectorName,
          condition: schema.fixedAssetInspections.conditionAssessment,
          findings: schema.fixedAssetInspections.findings,
          recommendations: schema.fixedAssetInspections.recommendations,
          followUpActions: schema.fixedAssetInspections.followUpActions,
          nextInspectionDate: schema.fixedAssetInspections.nextInspectionDate,
          status: schema.fixedAssetInspections.status,
        })
        .from(schema.fixedAssetInspections)
        .innerJoin(
          schema.fixedAssets,
          eq(schema.fixedAssets.id, schema.fixedAssetInspections.assetId),
        )
        .where(and(...conditions))
        .orderBy(asc(schema.fixedAssetInspections.inspectionDate));
      const mapped = rows.map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        inspectionDate: row.inspectionDate,
        inspector: row.inspector,
        condition: row.condition,
        findings: row.findings,
        recommendations: row.recommendations,
        followUpActions: row.followUpActions,
        nextInspectionDate: row.nextInspectionDate,
        status: row.status,
      }));
      return withSummary(mapped, { inspections: mapped.length }, rangeText);
    }
    case 'disposals': {
      const rows = (await assetRows()).filter(
        (row) =>
          ['DISPOSED', 'RETIRED'].includes(row.status) &&
          (!filters.dateFrom ||
            (row.disposedAt
              ? row.disposedAt.toISOString().slice(0, 10) >= filters.dateFrom
              : true)) &&
          (!filters.dateTo ||
            (row.disposedAt ? row.disposedAt.toISOString().slice(0, 10) <= filters.dateTo : true)),
      );
      const mapped = rows.map((row) => {
        const proceeds = Number(row.disposalProceedsKes ?? 0);
        const netBook = Number(row.netBookKes);
        return {
          assetCode: row.assetCode,
          assetName: row.assetName,
          status: row.status,
          disposalDate: row.disposedAt ? row.disposedAt.toISOString().slice(0, 10) : null,
          costCents: money(row.costKes),
          accumulatedCents: money(row.accumulatedKes),
          proceedsCents: money(proceeds),
          gainLossCents: row.status === 'DISPOSED' ? money(proceeds - netBook) : money(0),
          journalNumber: row.journalNumber,
        };
      });
      return withSummary(
        mapped,
        {
          disposals: mapped.length,
          proceedsCents: money(
            rows.reduce((sum, row) => sum + Number(row.disposalProceedsKes ?? 0), 0),
          ),
        },
        rangeText,
        [
          'Retired assets have no disposal journal; their gain or loss is not recognised until disposal.',
        ],
      );
    }
    case 'movements-transfers': {
      const conditions = [eq(schema.fixedAssetTransfers.facilityId, scope.facilityId)];
      if (filters.dateFrom)
        conditions.push(gte(schema.fixedAssetTransfers.transferDate, filters.dateFrom));
      if (filters.dateTo)
        conditions.push(lte(schema.fixedAssetTransfers.transferDate, filters.dateTo));
      if (filters.assetId) conditions.push(eq(schema.fixedAssetTransfers.assetId, filters.assetId));
      const rows = await db
        .select({
          assetCode: schema.fixedAssets.assetCode,
          assetName: schema.fixedAssets.assetName,
          transferDate: schema.fixedAssetTransfers.transferDate,
          fromLocation: schema.fixedAssetTransfers.fromLocation,
          toLocation: schema.fixedAssetTransfers.toLocation,
          fromDepartment: sql<string | null>`(
            SELECT name FROM ${schema.departments} d WHERE d.id = ${schema.fixedAssetTransfers.fromDepartmentId}
          )`,
          toDepartment: sql<string | null>`(
            SELECT name FROM ${schema.departments} d WHERE d.id = ${schema.fixedAssetTransfers.toDepartmentId}
          )`,
          reason: schema.fixedAssetTransfers.reason,
        })
        .from(schema.fixedAssetTransfers)
        .innerJoin(
          schema.fixedAssets,
          eq(schema.fixedAssets.id, schema.fixedAssetTransfers.assetId),
        )
        .where(and(...conditions))
        .orderBy(asc(schema.fixedAssetTransfers.transferDate));
      return withSummary(rows, { transfers: rows.length }, rangeText);
    }
    case 'reconciliation': {
      const rows = await assetRows();
      const ledger = await db
        .select({
          accountId: schema.chartOfAccounts.id,
          accountCode: schema.chartOfAccounts.accountCode,
          accountName: schema.chartOfAccounts.accountName,
          creditCents: sql<string>`coalesce((
            SELECT sum(l.credit_cents - l.debit_cents) FROM journal_lines l
            JOIN journal_entries j ON j.id = l.journal_entry_id
            WHERE l.account_id = chart_of_accounts.id AND j.status = 'POSTED'
          ), 0)`,
        })
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.facilityId, scope.facilityId),
            sql`chart_of_accounts.id IN (
              SELECT accum_dep_account_id FROM fixed_assets WHERE facility_id = ${scope.facilityId}
            )`,
          ),
        );
      const ledgerByAccount = new Map(
        ledger.map((row) => [row.accountId, Number(row.creditCents)]),
      );
      /*
       * Register accumulated per asset is compared with the ledger balance of
       * the account that asset credits. Assets sharing an account are compared
       * as a group, because a per-asset split of a pooled ledger balance would
       * be an invented allocation.
       */
      const byAccount = new Map<number, { register: number; ledger: number }>();
      const accountRows = await db
        .select({
          id: schema.fixedAssets.id,
          code: schema.fixedAssets.assetCode,
          name: schema.fixedAssets.assetName,
          accumDepAccountId: schema.fixedAssets.accumDepAccountId,
          accumulatedKes: schema.fixedAssets.accumulatedDepreciationKes,
          status: schema.fixedAssets.status,
        })
        .from(schema.fixedAssets)
        .where(
          and(
            eq(schema.fixedAssets.tenantId, scope.tenantId),
            eq(schema.fixedAssets.facilityId, scope.facilityId),
          ),
        );
      for (const row of accountRows) {
        if (row.status === 'DISPOSED') continue; // cost and accumulated removed on disposal
        const group = byAccount.get(row.accumDepAccountId) ?? { register: 0, ledger: 0 };
        group.register += Number(row.accumulatedKes);
        group.ledger = ledgerByAccount.get(row.accumDepAccountId) ?? 0;
        byAccount.set(row.accumDepAccountId, group);
      }
      const accounts = await db
        .select({
          id: schema.chartOfAccounts.id,
          code: schema.chartOfAccounts.accountCode,
          name: schema.chartOfAccounts.accountName,
        })
        .from(schema.chartOfAccounts)
        .where(eq(schema.chartOfAccounts.facilityId, scope.facilityId));
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const mapped = [...byAccount.entries()].map(([accountId, group]) => {
        const account = accountById.get(accountId);
        const difference = group.register - group.ledger;
        return {
          assetCode: account?.code ?? `#${accountId}`,
          assetName: account?.name ?? 'Accumulated depreciation account',
          registerAccumulatedCents: money(group.register),
          ledgerAccumulatedCents: money(group.ledger),
          differenceCents: money(difference),
          status: Math.abs(difference) < 1 ? 'RECONCILED' : 'DIFFERENCE',
        };
      });
      return withSummary(
        mapped,
        {
          accounts: mapped.length,
          differences: mapped.filter((row) => row.status === 'DIFFERENCE').length,
        },
        `As at ${base.generatedAt.slice(0, 10)}`,
        [
          'The ledger balance is the posted credit balance of each accumulated depreciation account, including charges posted outside this module.',
          'A difference is a finding to investigate, not something this report adjusts.',
        ],
      );
    }
    default:
      return fail(404, 'REPORT_NOT_FOUND', 'Unknown fixed-asset report.');
  }
}
