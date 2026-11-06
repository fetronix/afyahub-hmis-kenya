import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { validateRange } from '../dashboard/date-range.ts';
import type { ReportEngineId } from './report-catalogue.ts';
import { operationalQueryPlan } from './report-centre.operational-queries.ts';
import { ledgerQueryPlan } from './report-centre.ledger-queries.ts';
import {
  authorizeReport,
  authorizeReportFacility,
  ReportCentreError,
  type ReportIntent,
} from './report-centre.auth.ts';
import { validateSelectedFilters } from './report-centre.selection.ts';
export { ReportCentreError } from './report-centre.auth.ts';
import {
  REPORT_ENGINES,
  type ReportFilters,
  type ReportResult,
  type ReportRow,
} from './report-centre.types.ts';

export const MAX_REPORT_PAGE = 100;
export const MAX_REPORT_EXPORT = 1000;
const MAX_OFFSET = 1_000_000;
function integer(value: unknown, name: string, min: number, max: number): number {
  const validString = typeof value === 'string' && /^\d+$/.test(value);
  const parsed = validString ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', `${name} must be a valid whole number.`);
  }
  return parsed;
}

function optionalId(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return integer(value, name, 1, 2_147_483_647);
}

function optionalIds(value: unknown, name: string): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      `${name} must contain at most 20 selections.`,
    );
  }
  const ids = value.map((item) => integer(item, name, 1, 2_147_483_647));
  if (new Set(ids).size !== ids.length) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', `${name} contains duplicate selections.`);
  }
  return ids.length ? ids : undefined;
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max || /\p{Cc}/u.test(value)) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', `${name} is invalid.`);
  }
  return value.trim() || undefined;
}

function validateFilters(id: ReportEngineId, raw: unknown): ReportFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Report filters are required.');
  }
  const input = raw as Record<string, unknown>;
  const allowed = new Set([
    'facilityId',
    'search',
    'status',
    'from',
    'to',
    'patientId',
    'wardId',
    'departmentId',
    'staffId',
    'bedId',
    'itemIds',
    'supplierId',
    'purchaseOrderId',
    'labTestId',
    'serviceIds',
    'invoiceId',
    'receiptId',
    'accountIds',
    'offset',
    'limit',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      'The report contains an unsupported filter.',
    );
  }
  const definition = REPORT_ENGINES[id];
  const facilityId = integer(input.facilityId, 'Facility', 1, 2_147_483_647);
  const search = optionalText(input.search, 'Search', 80);
  const status = optionalText(input.status, 'Status', 40);
  if (status && !definition.statuses?.some((option) => option.value === status)) {
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      'This status is not supported by the report.',
    );
  }
  const from = optionalText(input.from, 'Start date', 10);
  const to = optionalText(input.to, 'End date', 10);
  if (definition.dateMode === 'asOf') {
    if (from || !to || !validateRange(to, to)) {
      throw new ReportCentreError(
        'INVALID_DATE_RANGE',
        'Select a valid as-of date for this report.',
      );
    }
  } else if ((from || to) && (!definition.dateLabel || !from || !to || !validateRange(from, to))) {
    throw new ReportCentreError(
      'INVALID_DATE_RANGE',
      'Select a valid inclusive date range of at most 366 days for this report.',
    );
  }
  const patientId = optionalId(input.patientId, 'Patient');
  const wardId = optionalId(input.wardId, 'Ward');
  const departmentId = optionalId(input.departmentId, 'Department');
  const staffId = optionalId(input.staffId, 'Staff user');
  const bedId = optionalId(input.bedId, 'Bed');
  const itemIds = optionalIds(input.itemIds, 'Items');
  const supplierId = optionalId(input.supplierId, 'Supplier');
  const purchaseOrderId = optionalId(input.purchaseOrderId, 'Purchase order');
  const labTestId = optionalId(input.labTestId, 'Laboratory test');
  const serviceIds = optionalIds(input.serviceIds, 'Services');
  const invoiceId = optionalId(input.invoiceId, 'Invoice');
  const receiptId = optionalId(input.receiptId, 'Receipt');
  const accountIds = optionalIds(input.accountIds, 'Accounts');
  if (
    (patientId && !definition.patientFilter) ||
    (wardId && !definition.wardFilter) ||
    (departmentId && !definition.departmentFilter) ||
    (staffId && !definition.staffFilter) ||
    (bedId && !definition.bedFilter) ||
    (itemIds && !definition.inventoryItemFilter) ||
    (supplierId && !definition.supplierFilter) ||
    (purchaseOrderId && !definition.purchaseOrderFilter) ||
    (labTestId && !definition.labTestFilter) ||
    (serviceIds && !definition.serviceFilter) ||
    (invoiceId && !definition.invoiceFilter) ||
    (receiptId && !definition.receiptFilter) ||
    (accountIds && !definition.accountFilter)
  ) {
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      'This filter is not supported by the report.',
    );
  }
  const offset = input.offset === undefined ? 0 : integer(input.offset, 'Offset', 0, MAX_OFFSET);
  const limit =
    input.limit === undefined ? 25 : integer(input.limit, 'Page size', 1, MAX_REPORT_PAGE);
  return {
    facilityId,
    search,
    status,
    from,
    to,
    patientId,
    wardId,
    departmentId,
    staffId,
    bedId,
    itemIds,
    supplierId,
    purchaseOrderId,
    labTestId,
    serviceIds,
    invoiceId,
    receiptId,
    accountIds,
    offset,
    limit,
  };
}

export interface QueryPlan {
  from: string;
  where: string[];
  params: unknown[];
  select: string;
  order: string;
  missingExpression?: string;
  missingLabel?: string;
  undatedWhere?: string[];
  undatedParams?: unknown[];
  undatedLabel?: string;
  summaryExpression?: string;
  summaryLabel?: string;
  summaries?: readonly { expression: string; label: string }[];
}

function pattern(value: string): string {
  // PostgreSQL's LIKE escape protects literal percent, underscore and backslash.
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function queryPlan(id: ReportEngineId, tenantId: number, filters: ReportFilters): QueryPlan {
  const operational = operationalQueryPlan(id, tenantId, filters);
  if (operational) return operational;
  const ledger = ledgerQueryPlan(id, tenantId, filters);
  if (ledger) return ledger;
  const params: unknown[] = [tenantId, filters.facilityId];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where: string[] = [];
  if (id === 'inventory-category' || id === 'inventory-store') {
    where.push('f.tenant_id=$1', 'i.facility_id=$2');
    if (filters.search) {
      const p = param(pattern(filters.search));
      where.push(
        `(i.item_code ILIKE ${p} OR i.name ILIKE ${p} OR i.category ILIKE ${p} OR i.store_location ILIKE ${p})`,
      );
    }
    if (filters.itemIds) where.push(`i.id=ANY(${param(filters.itemIds)}::integer[])`);
    if (filters.status === 'active') where.push('i.is_active IS TRUE');
    if (filters.status === 'inactive') where.push('i.is_active IS FALSE');
    if (filters.status === 'unknown') where.push('i.is_active IS NULL');
    return {
      from: 'inventory_items i JOIN facilities f ON f.id=i.facility_id',
      where,
      params,
      select: `i.item_code AS code, i.name AS item, i.category, i.store_location AS store,
        i.unit, i.current_stock AS quantity, i.reorder_level AS "reorderLevel",
        CASE WHEN i.is_active IS TRUE THEN 'Active' WHEN i.is_active IS FALSE THEN 'Inactive' ELSE NULL END AS status`,
      order:
        id === 'inventory-category'
          ? 'i.category ASC NULLS LAST, i.name ASC, i.id ASC'
          : 'i.store_location ASC NULLS LAST, i.name ASC, i.id ASC',
    };
  }
  if (id === 'purchase-orders') {
    where.push('o.tenant_id=$1', 'o.facility_id=$2');
    if (filters.search) {
      const p = param(pattern(filters.search));
      where.push(`(o.po_number ILIKE ${p} OR s.name ILIKE ${p})`);
    }
    if (filters.supplierId) where.push(`s.id=${param(filters.supplierId)}`);
    if (filters.purchaseOrderId) where.push(`o.id=${param(filters.purchaseOrderId)}`);
    if (filters.status === '__unknown__') where.push('o.status IS NULL');
    else if (filters.status) where.push(`o.status=${param(filters.status)}`);
    const undatedWhere = [...where, 'o.expected_delivery_date IS NULL'];
    const undatedParams = [...params];
    if (filters.from && filters.to) {
      where.push(`o.expected_delivery_date >= ${param(filters.from)}::date`);
      where.push(`o.expected_delivery_date <= ${param(filters.to)}::date`);
    }
    return {
      from: 'purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id AND s.tenant_id=o.tenant_id',
      where,
      params,
      undatedWhere,
      undatedParams,
      select: `o.po_number AS number, s.name AS supplier, o.status,
        o.expected_delivery_date::text AS "expectedDelivery", o.total_amount::text AS "orderAmount"`,
      order: 'o.expected_delivery_date ASC NULLS LAST, o.id ASC',
      missingExpression: 's.id IS NULL',
    };
  }
  if (id !== 'current-inpatients') throw new Error('REPORT_QUERY_PLAN_MISSING');
  where.push('a.tenant_id=$1', 'a.facility_id=$2', "a.status='Admitted'");
  if (filters.search) {
    const p = param(pattern(filters.search));
    where.push(
      `(p.mrn ILIKE ${p} OR concat_ws(' ',p.first_name,p.middle_name,p.last_name) ILIKE ${p})`,
    );
  }
  if (filters.patientId) where.push(`p.id=${param(filters.patientId)}`);
  if (filters.wardId) where.push(`w.id=${param(filters.wardId)}`);
  if (filters.bedId) where.push(`b.id=${param(filters.bedId)}`);
  return {
    from: `admissions a
      LEFT JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id
      LEFT JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id
      LEFT JOIN beds b ON b.id=a.bed_id AND b.ward_id=w.id`,
    where,
    params,
    select: `a.id AS "admissionId", p.id AS "_patientId", p.mrn,
      CASE WHEN p.id IS NULL THEN NULL ELSE concat_ws(' ',p.first_name,p.middle_name,p.last_name) END AS patient,
      w.name AS ward, b.bed_number AS bed, a.admission_date AS "admissionDate",
      a.admission_type AS "admissionType"`,
    order: 'a.id DESC',
    missingExpression: 'p.id IS NULL OR w.id IS NULL OR b.id IS NULL',
  };
}

async function audit(
  client: PoolClient,
  context: AuthorizationContext,
  tenantId: number,
  facilityId: number,
  id: ReportEngineId,
  intent: ReportIntent,
  rows: Array<ReportRow & { _patientId?: number | null }>,
  total: number,
  filters: ReportFilters,
) {
  // Audit describes the request, not proof that a physical print/download happened.
  await client.query(
    `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
     VALUES($1,$2,$3,$4,'report_centre',$5,$6)`,
    [
      tenantId,
      facilityId,
      String(context.userId),
      intent,
      id,
      JSON.stringify({
        rowCount: rows.length,
        total,
        offset: filters.offset,
        limit: filters.limit,
        filterFields: [
          'search',
          'status',
          'from',
          'to',
          'patientId',
          'wardId',
          'departmentId',
          'staffId',
          'bedId',
          'itemIds',
          'supplierId',
          'purchaseOrderId',
          'labTestId',
          'serviceIds',
          'invoiceId',
          'receiptId',
          'accountIds',
        ].filter((key) => Boolean(filters[key as keyof ReportFilters])),
        // Search text and patient identifiers stay out of the general audit log.
        from: filters.from,
        to: filters.to,
        status: filters.status,
      }),
    ],
  );
  const patientIds = [
    ...new Set(
      rows.map((row) => row._patientId).filter((id): id is number => typeof id === 'number'),
    ),
  ];
  if (patientIds.length) {
    await client.query(
      `INSERT INTO patient_record_access_logs(patient_id,user_id,facility_id,tenant_id,action,access_channel,record_type,purpose)
       SELECT patient_id,$2,$3,$4,$5,'STAFF_PORTAL','REPORT_CENTRE',$6
       FROM unnest($1::integer[]) AS patient_id`,
      [
        patientIds,
        context.userId,
        facilityId,
        tenantId,
        intent === 'VIEW' ? 'VIEW' : intent === 'PRINT_REQUEST' ? 'PRINT' : 'EXPORT',
        id,
      ],
    );
  }
}

/** A read-only report plus mandatory, transactional audit. No source clinical/financial rows are changed. */
export async function generateReport(
  context: AuthorizationContext,
  rawId: string,
  rawFilters: unknown,
  intent: ReportIntent = 'VIEW',
): Promise<ReportResult> {
  const { id, definition } = authorizeReport(context, rawId, intent);
  const filters = validateFilters(id, rawFilters);
  const facility = await authorizeReportFacility(context, filters.facilityId, definition.module);
  const facilityId = facility.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const filterLabels = await validateSelectedFilters(
      client,
      context,
      id,
      facility.tenantId,
      filters,
    );
    const currencyRows = await client.query<{ currency: string | null }>(
      'SELECT currency FROM tenants WHERE id=$1',
      [facility.tenantId],
    );
    const currency = definition.fixedCurrency ?? (currencyRows.rows[0]?.currency?.trim() || null);
    const plan = queryPlan(id, facility.tenantId, filters);
    const clauses = plan.where.join(' AND ');
    const summaries =
      plan.summaries ??
      (plan.summaryLabel && plan.summaryExpression
        ? [{ label: plan.summaryLabel, expression: plan.summaryExpression }]
        : []);
    // Expressions are static internal plans, never user-provided SQL.
    const summaryColumns = summaries.map(
      (summary, index) => `(${summary.expression})::text AS "summary${index}"`,
    );
    const count = await client.query<
      { total: string; missing: string } & Record<string, string | null>
    >(
      `SELECT COUNT(*)::text AS total, ${plan.missingExpression ? `COUNT(*) FILTER (WHERE ${plan.missingExpression})` : '0'}::text AS missing${summaryColumns.length ? `, ${summaryColumns.join(', ')}` : ''}
       FROM ${plan.from} WHERE ${clauses}`,
      plan.params,
    );
    const total = Number(count.rows[0].total);
    if (!Number.isSafeInteger(total)) throw new Error('REPORT_COUNT_OUT_OF_RANGE');
    if (intent === 'EXPORT_REQUEST' && total > MAX_REPORT_EXPORT) {
      throw new ReportCentreError(
        'REPORT_EXPORT_TOO_LARGE',
        `Narrow the filters to ${MAX_REPORT_EXPORT} records or fewer before exporting.`,
        413,
      );
    }
    const offset = intent === 'EXPORT_REQUEST' ? 0 : (filters.offset ?? 0);
    const limit = intent === 'EXPORT_REQUEST' ? MAX_REPORT_EXPORT : (filters.limit ?? 25);
    const data = await client.query<ReportRow & { _patientId?: number | null }>(
      `SELECT ${plan.select} FROM ${plan.from} WHERE ${clauses} ORDER BY ${plan.order} LIMIT $${plan.params.length + 1} OFFSET $${plan.params.length + 2}`,
      [...plan.params, limit, offset],
    );
    const notes = [
      ...definition.notes,
      'Data is a live snapshot and may change between pages or when regenerated.',
    ];
    const missing = Number(count.rows[0].missing);
    if (missing > 0)
      notes.push(
        plan.missingLabel
          ? `${missing} ${plan.missingLabel}; review the source records.`
          : `${missing} record(s) have missing or out-of-scope linked details and need review.`,
      );
    if (filters.from && plan.undatedWhere && plan.undatedParams) {
      const undated = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${plan.from} WHERE ${plan.undatedWhere.join(' AND ')}`,
        plan.undatedParams,
      );
      const excluded = Number(undated.rows[0].count);
      if (excluded > 0)
        notes.push(
          `${excluded} ${plan.undatedLabel ?? 'order(s) without an expected delivery date'} are excluded from this date range.`,
        );
    }
    await audit(client, context, facility.tenantId, facilityId, id, intent, data.rows, total, {
      ...filters,
      offset,
      limit,
    });
    await client.query('COMMIT');
    const rows = data.rows.map(({ _patientId: _ignored, ...row }) => row);
    return {
      reportId: id,
      title: definition.title,
      facilityId,
      facilityName: facility.name,
      currency,
      generatedAt: new Date().toISOString(),
      filters: { ...filters, offset, limit },
      filterLabels,
      columns: definition.columns,
      rows,
      ...(summaries.length
        ? {
            summaries: summaries.map((summary, index) => ({
              label: summary.label,
              value: total === 0 ? '0.00' : count.rows[0][`summary${index}`],
              kind: 'money' as const,
            })),
          }
        : {}),
      total,
      offset,
      limit,
      notes,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
