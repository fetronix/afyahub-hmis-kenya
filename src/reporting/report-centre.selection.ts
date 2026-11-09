import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import { hasAllPermissions } from '../auth/authorization.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import type { ReportEngineId } from './report-catalogue.ts';
import {
  authorizePermissions,
  authorizeReport,
  authorizeReportFacility,
  ReportCentreError,
} from './report-centre.auth.ts';
import {
  REPORT_ENGINES,
  type ReportFilters,
  type ReportSelectionKind,
  type ReportSelectionOption,
  type ReportSelectionPage,
  type ReportSelectionRequest,
} from './report-centre.types.ts';

/** The invoice document is an existing workflow, not a fabricated report engine. */
export const INVOICE_DOCUMENT_SELECTION = 'invoice-document';
const MAX_PAGE = 25;
const MAX_OFFSET = 1_000_000;
const kinds: readonly ReportSelectionKind[] = [
  'patient',
  'ward',
  'bed',
  'department',
  'staff',
  'item',
  'supplier',
  'purchaseOrder',
  'labTest',
  'service',
  'invoice',
  'receipt',
  'account',
];

type SelectionReport = ReportEngineId | typeof INVOICE_DOCUMENT_SELECTION;
type OptionRow = ReportSelectionOption & { _patientId: number | null };
type Dependencies = Pick<
  ReportSelectionRequest,
  'wardId' | 'departmentId' | 'supplierId' | 'patientId' | 'invoiceStatus'
>;

function positiveInteger(value: unknown, name: string, min = 1, max = 2_147_483_647): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', `${name} must be a valid whole number.`);
  }
  return parsed;
}

function optionalId(value: unknown, name: string): number | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : positiveInteger(value, name);
}

function parseRequest(raw: unknown): ReportSelectionRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Selection parameters are required.');
  }
  const input = raw as Record<string, unknown>;
  const keys = new Set([
    'facilityId',
    'kind',
    'search',
    'offset',
    'limit',
    'wardId',
    'departmentId',
    'supplierId',
    'patientId',
    'invoiceStatus',
  ]);
  if (Object.keys(input).some((key) => !keys.has(key))) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Unsupported selection parameter.');
  }
  if (typeof input.kind !== 'string' || !kinds.includes(input.kind as ReportSelectionKind)) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Unsupported selection type.');
  }
  if (
    input.search !== undefined &&
    (typeof input.search !== 'string' || input.search.length > 80 || /\p{Cc}/u.test(input.search))
  ) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Search is invalid.');
  }
  if (
    input.invoiceStatus !== undefined &&
    input.invoiceStatus !== 'all' &&
    input.invoiceStatus !== 'outstanding'
  ) {
    throw new ReportCentreError('INVALID_REPORT_FILTER', 'Invoice status is invalid.');
  }
  const kind = input.kind as ReportSelectionKind;
  if (
    (input.wardId !== undefined && kind !== 'bed') ||
    (input.departmentId !== undefined && kind !== 'staff') ||
    (input.supplierId !== undefined && kind !== 'purchaseOrder') ||
    (input.patientId !== undefined && kind !== 'invoice') ||
    (input.invoiceStatus !== undefined && kind !== 'invoice')
  ) {
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      'A dependent filter is not supported by this selection.',
    );
  }
  return {
    facilityId: positiveInteger(input.facilityId, 'Facility'),
    kind,
    search: typeof input.search === 'string' ? input.search.trim() || undefined : undefined,
    offset: input.offset === undefined ? 0 : positiveInteger(input.offset, 'Offset', 0, MAX_OFFSET),
    limit: input.limit === undefined ? 20 : positiveInteger(input.limit, 'Page size', 1, MAX_PAGE),
    wardId: optionalId(input.wardId, 'Ward'),
    departmentId: optionalId(input.departmentId, 'Department'),
    supplierId: optionalId(input.supplierId, 'Supplier'),
    patientId: optionalId(input.patientId, 'Patient'),
    invoiceStatus: input.invoiceStatus as ReportSelectionRequest['invoiceStatus'],
  };
}

function supports(report: SelectionReport, kind: ReportSelectionKind): boolean {
  if (report === INVOICE_DOCUMENT_SELECTION) return kind === 'invoice';
  const def = REPORT_ENGINES[report];
  const allowed: Record<ReportSelectionKind, boolean | undefined> = {
    patient: def.patientFilter,
    ward: def.wardFilter,
    bed: def.bedFilter,
    department: def.departmentFilter,
    staff: def.staffFilter,
    item: def.inventoryItemFilter,
    supplier: def.supplierFilter,
    purchaseOrder: def.purchaseOrderFilter,
    labTest: def.labTestFilter,
    service: def.serviceFilter,
    invoice: def.invoiceFilter,
    receipt: def.receiptFilter,
    account: def.accountFilter,
  };
  return Boolean(allowed[kind]);
}

function requireSelectionPermission(
  context: AuthorizationContext,
  report: SelectionReport,
  kind: ReportSelectionKind,
) {
  if (!supports(report, kind)) {
    throw new ReportCentreError(
      'INVALID_REPORT_FILTER',
      'This selection is not supported by the report.',
    );
  }
  // Report access alone is not a staff-directory or stock-balance permission.
  if (
    (kind === 'staff' && !hasAllPermissions(context, ['users.read'])) ||
    (kind === 'item' &&
      report === 'pharmacy-dispensations' &&
      !hasAllPermissions(context, ['inventory.read'])) ||
    (kind === 'receipt' && !hasAllPermissions(context, ['patients.read']))
  ) {
    throw new ReportCentreError(
      'FORBIDDEN',
      'Additional staff, patient or inventory read permission is required for this selection.',
      403,
    );
  }
}

const literalPattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const patientName = "concat_ws(' ', p.first_name, p.middle_name, p.last_name)";

/** Every fragment is static. Values, dependencies, page and IDs are parameters. */
async function queryOptions(
  client: PoolClient,
  report: SelectionReport,
  tenantId: number,
  facilityId: number,
  kind: ReportSelectionKind,
  deps: Dependencies = {},
  query: { search?: string; ids?: number[]; offset?: number; limit?: number } = {},
): Promise<OptionRow[]> {
  const params: unknown[] = [tenantId, facilityId];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  let from = '',
    identity = '',
    label = '',
    detail = '',
    patient = 'NULL::integer';
  let where: string[] = [];
  let searchable: string[] = [];
  if (kind === 'patient') {
    from = 'patients p';
    identity = 'p.id';
    label = `concat_ws(' — ', NULLIF(p.mrn,''), NULLIF(${patientName},''))`;
    detail =
      "concat_ws(' · ', CASE WHEN NULLIF(p.phone,'') IS NOT NULL THEN 'Phone ' || p.phone END, 'Record created ' || p.created_at::date::text)";
    patient = 'p.id';
    where =
      report === 'outpatient-diagnoses'
        ? [
            'p.tenant_id=$1',
            "EXISTS (SELECT 1 FROM encounters e WHERE e.tenant_id=$1 AND e.facility_id=$2 AND e.encounter_type='OUTPATIENT' AND e.patient_id=p.id)",
          ]
        : ['p.tenant_id=$1', 'p.registration_facility_id=$2'];
    searchable = ['p.mrn', 'p.first_name', 'p.middle_name', 'p.last_name', patientName, 'p.phone'];
  } else if (kind === 'ward') {
    from = 'wards w JOIN facilities f ON f.id=w.facility_id';
    identity = 'w.id';
    label = "concat_ws(' — ', w.code, w.name)";
    detail =
      "concat_ws(' · ', w.ward_type, CASE WHEN w.is_active IS TRUE THEN 'Active' WHEN w.is_active IS FALSE THEN 'Inactive' ELSE 'Status not recorded' END)";
    where = ['f.tenant_id=$1', 'w.facility_id=$2'];
    searchable = ['w.name', 'w.code'];
  } else if (kind === 'bed') {
    from = 'beds b JOIN wards w ON w.id=b.ward_id JOIN facilities f ON f.id=w.facility_id';
    identity = 'b.id';
    label = "concat_ws(' — ', w.name, 'Bed ' || b.bed_number)";
    detail = "concat_ws(' · ', b.bed_type, 'Status: ' || coalesce(b.status,'Not recorded'))";
    where = ['f.tenant_id=$1', 'w.facility_id=$2'];
    searchable = ['b.bed_number', 'w.name', 'w.code'];
    if (deps.wardId) where.push(`w.id=${p(deps.wardId)}`);
  } else if (kind === 'department') {
    from = 'departments d JOIN facilities f ON f.id=d.facility_id';
    identity = 'd.id';
    label = "concat_ws(' — ', d.code, d.name)";
    detail =
      "concat_ws(' · ', d.type, CASE WHEN d.is_active IS TRUE THEN 'Active' WHEN d.is_active IS FALSE THEN 'Inactive' ELSE 'Status not recorded' END)";
    where = ['f.tenant_id=$1', 'd.facility_id=$2'];
    searchable = ['d.name', 'd.code'];
  } else if (kind === 'staff' && report === 'outpatient-encounters') {
    from = `practitioners pr JOIN users u ON u.id=pr.user_id AND u.tenant_id=pr.tenant_id
      LEFT JOIN departments d ON d.id=pr.department_id AND d.facility_id=pr.facility_id`;
    identity = 'u.id';
    label = 'pr.full_name';
    detail =
      "concat_ws(' · ', NULLIF(pr.registration_number,''), d.name, pr.profession, 'Account: ' || u.account_status)";
    where = ['pr.tenant_id=$1', 'pr.facility_id=$2'];
    searchable = ['pr.full_name', 'pr.registration_number', 'd.name'];
    if (deps.departmentId) {
      const dep = p(deps.departmentId);
      // Include historical department encounters as well as the current assignment.
      where.push(
        `(pr.department_id=${dep} OR EXISTS (SELECT 1 FROM encounters e WHERE e.tenant_id=$1 AND e.facility_id=$2 AND e.practitioner_id=pr.id AND e.department_id=${dep} AND e.encounter_type='OUTPATIENT'))`,
      );
    }
  } else if (kind === 'staff') {
    from = 'users u';
    identity = 'u.id';
    label = 'u.full_name';
    detail = "concat_ws(' · ', u.designation, 'Account: ' || u.account_status)";
    where = [
      'u.tenant_id=$1',
      'EXISTS (SELECT 1 FROM billing_refunds r WHERE r.tenant_id=$1 AND r.facility_id=$2 AND r.actor_user_id=u.id)',
    ];
    searchable = ['u.full_name', 'u.designation'];
  } else if (kind === 'item') {
    from = 'inventory_items i JOIN facilities f ON f.id=i.facility_id';
    identity = 'i.id';
    label = "concat_ws(' — ', i.item_code, i.name)";
    detail =
      "concat_ws(' · ', i.category, 'Stock: ' || coalesce(i.current_stock::text,'Not recorded') || coalesce(' ' || i.unit,''), 'Reorder: ' || coalesce(i.reorder_level::text,'Not recorded'), CASE WHEN i.is_active IS TRUE THEN 'Active' WHEN i.is_active IS FALSE THEN 'Inactive' ELSE 'Status not recorded' END)";
    where = ['f.tenant_id=$1', 'i.facility_id=$2'];
    searchable = ['i.item_code', 'i.name', 'i.generic_name', 'i.category'];
  } else if (kind === 'supplier') {
    from = 'suppliers s';
    identity = 's.id';
    label = 's.name';
    detail =
      "CASE WHEN s.is_active IS TRUE THEN 'Active' WHEN s.is_active IS FALSE THEN 'Inactive' ELSE 'Status not recorded' END";
    where = [
      's.tenant_id=$1',
      'EXISTS (SELECT 1 FROM purchase_orders o WHERE o.tenant_id=$1 AND o.facility_id=$2 AND o.supplier_id=s.id)',
    ];
    searchable = ['s.name'];
  } else if (kind === 'purchaseOrder') {
    from =
      'purchase_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id AND s.tenant_id=o.tenant_id';
    identity = 'o.id';
    label = "concat_ws(' — ', o.po_number, coalesce(s.name,'Supplier unavailable'))";
    detail =
      "concat_ws(' · ', 'Status: ' || coalesce(o.status,'Not recorded'), 'Expected: ' || coalesce(o.expected_delivery_date::text,'Not recorded'), 'Recorded value: ' || coalesce(o.total_amount::text,'Not recorded'))";
    where = ['o.tenant_id=$1', 'o.facility_id=$2'];
    searchable = ['o.po_number', 's.name'];
    if (deps.supplierId) where.push(`s.id=${p(deps.supplierId)}`);
  } else if (kind === 'labTest') {
    from = 'lab_tests t JOIN facilities f ON f.id=t.facility_id';
    identity = 't.id';
    label = "concat_ws(' — ', t.code, t.name)";
    // Only explicitly reviewed choices are specimen evidence; never use the legacy default.
    detail =
      "concat_ws(' · ', t.category, 'Reviewed specimens: ' || coalesce((SELECT string_agg(DISTINCT x.specimen_type, ', ' ORDER BY x.specimen_type) FROM lab_test_specimen_options x WHERE x.tenant_id=$1 AND x.facility_id=$2 AND x.test_id=t.id AND x.retired_at IS NULL), 'None recorded'), CASE WHEN t.is_active IS TRUE THEN 'Active' WHEN t.is_active IS FALSE THEN 'Inactive' ELSE 'Status not recorded' END)";
    where = ['f.tenant_id=$1', 't.facility_id=$2'];
    searchable = ['t.code', 't.name', 't.category'];
  } else if (kind === 'service') {
    from = 'facility_services s';
    identity = 's.id';
    label = "concat_ws(' — ', s.code, s.name)";
    detail =
      "concat_ws(' · ', s.category, s.department, CASE WHEN s.is_active THEN 'Active' ELSE 'Inactive' END)";
    where = [
      's.tenant_id=$1',
      's.facility_id=$2',
      `s.category=${p(report === 'laboratory-orders' ? 'LABORATORY' : 'RADIOLOGY')}`,
    ];
    searchable = ['s.code', 's.name', 's.department', 's.category'];
  } else if (kind === 'account') {
    from = 'chart_of_accounts a';
    identity = 'a.id';
    label = "concat_ws(' — ', a.account_code, a.account_name)";
    detail =
      "concat_ws(' · ', a.account_type, a.sub_type, CASE WHEN a.is_active THEN 'Active' ELSE 'Inactive' END)";
    where = ['a.tenant_id=$1', 'a.facility_id=$2'];
    searchable = ['a.account_code', 'a.account_name', 'a.account_type'];
    if (report === 'ledger-income') where.push("a.account_type IN ('REVENUE','EXPENSE')");
    if (report === 'ledger-balance-sheet')
      where.push("a.account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')");
  } else if (kind === 'receipt') {
    from = `billing_payments bp JOIN billing_invoices i ON i.id=bp.invoice_id
      LEFT JOIN patients p ON p.id=i.patient_id AND p.tenant_id=i.tenant_id AND p.registration_facility_id=i.facility_id`;
    identity = 'bp.id';
    label = `concat_ws(' — ', bp.receipt_number, i.invoice_number, CASE WHEN p.id IS NULL THEN 'Patient unavailable' ELSE ${patientName} END)`;
    detail =
      "concat_ws(' · ', 'Date: ' || bp.payment_date::date::text, 'Amount: ' || coalesce(bp.amount::text,'Not recorded'), 'Method: ' || coalesce(bp.payment_method,'Not recorded'))";
    patient = 'p.id';
    where = ['i.tenant_id=$1', 'i.facility_id=$2'];
    searchable = ['bp.receipt_number', 'i.invoice_number', 'p.mrn', patientName];
  } else {
    from = `billing_invoices i LEFT JOIN patients p ON p.id=i.patient_id AND p.tenant_id=i.tenant_id AND p.registration_facility_id=i.facility_id`;
    identity = 'i.id';
    label = `concat_ws(' — ', i.invoice_number, CASE WHEN p.id IS NULL THEN 'Patient unavailable' ELSE ${patientName} END)`;
    detail =
      "concat_ws(' · ', 'Created: ' || i.created_at::date::text, 'Total: ' || coalesce(i.total_amount::text,'Not recorded'), 'Paid: ' || coalesce(i.paid_amount::text,'Not recorded'), 'Balance: ' || coalesce(i.balance_amount::text,'Not recorded'), 'Status: ' || coalesce(i.status,'Not recorded'), CASE WHEN i.voided_at IS NOT NULL THEN 'Voided' END)";
    patient = 'p.id';
    where = ['i.tenant_id=$1', 'i.facility_id=$2'];
    searchable = ['i.invoice_number', 'p.mrn', patientName];
    if (deps.patientId) where.push(`p.id=${p(deps.patientId)}`);
    if (deps.invoiceStatus === 'outstanding')
      where.push(
        "i.voided_at IS NULL AND (i.balance_amount <> 0 OR i.balance_amount IS NULL OR i.balance_amount::text IN ('NaN','Infinity','-Infinity'))",
      );
  }
  if (query.search) {
    const q = p(literalPattern(query.search));
    where.push(`(${searchable.map((expression) => `${expression} ILIKE ${q}`).join(' OR ')})`);
  }
  if (query.ids) where.push(`${identity}=ANY(${p(query.ids)}::integer[])`);
  const limit = p(query.limit ?? 21);
  const offset = p(query.offset ?? 0);
  const result = await client.query<OptionRow>(
    `SELECT ${identity} AS id, ${label} AS label, ${detail} AS detail, ${patient} AS "_patientId"
     FROM ${from} WHERE ${where.join(' AND ')} ORDER BY label ASC, id ASC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return result.rows;
}

async function auditPatientOptions(
  client: PoolClient,
  context: AuthorizationContext,
  tenantId: number,
  facilityId: number,
  report: SelectionReport,
  rows: OptionRow[],
) {
  const ids = [
    ...new Set(
      rows.map((row) => row._patientId).filter((id): id is number => typeof id === 'number'),
    ),
  ];
  if (!ids.length) return;
  await client.query(
    `INSERT INTO patient_record_access_logs(patient_id,user_id,facility_id,tenant_id,action,access_channel,record_type,purpose)
     SELECT patient_id,$2,$3,$4,'VIEW','STAFF_PORTAL','REPORT_SELECTION',$5 FROM unnest($1::integer[]) AS patient_id`,
    [ids, context.userId, facilityId, tenantId, report],
  );
}

async function requiredOptions(
  client: PoolClient,
  context: AuthorizationContext,
  report: SelectionReport,
  tenantId: number,
  facilityId: number,
  kind: ReportSelectionKind,
  ids: number[],
  deps: Dependencies = {},
): Promise<OptionRow[]> {
  requireSelectionPermission(context, report, kind);
  const rows = await queryOptions(client, report, tenantId, facilityId, kind, deps, {
    ids,
    limit: ids.length,
  });
  if (rows.length !== ids.length || new Set(rows.map((row) => row.id)).size !== ids.length) {
    // The same response covers nonexistent, cross-facility and conflicting dependencies.
    throw new ReportCentreError(
      'INVALID_REPORT_SELECTION',
      'A selected record is unavailable in this facility or does not match the selected filters.',
    );
  }
  return rows;
}

/** Validate ownership again at generation/export time, within the report snapshot. */
export async function validateSelectedFilters(
  client: PoolClient,
  context: AuthorizationContext,
  report: ReportEngineId,
  tenantId: number,
  filters: ReportFilters,
): Promise<Partial<Record<ReportSelectionKind, string>>> {
  const selected: Array<[ReportSelectionKind, number[] | undefined, Dependencies?]> = [
    ['patient', filters.patientId ? [filters.patientId] : undefined],
    ['ward', filters.wardId ? [filters.wardId] : undefined],
    ['bed', filters.bedId ? [filters.bedId] : undefined, { wardId: filters.wardId }],
    ['department', filters.departmentId ? [filters.departmentId] : undefined],
    [
      'staff',
      filters.staffId ? [filters.staffId] : undefined,
      { departmentId: filters.departmentId },
    ],
    ['item', filters.itemIds],
    ['supplier', filters.supplierId ? [filters.supplierId] : undefined],
    [
      'purchaseOrder',
      filters.purchaseOrderId ? [filters.purchaseOrderId] : undefined,
      { supplierId: filters.supplierId },
    ],
    ['labTest', filters.labTestId ? [filters.labTestId] : undefined],
    ['service', filters.serviceIds],
    [
      'invoice',
      filters.invoiceId ? [filters.invoiceId] : undefined,
      { patientId: filters.patientId, invoiceStatus: 'all' },
    ],
    ['receipt', filters.receiptId ? [filters.receiptId] : undefined],
    ['account', filters.accountIds],
  ];
  const labels: Partial<Record<ReportSelectionKind, string>> = {};
  const visiblePatientRows: OptionRow[] = [];
  for (const [kind, ids, deps] of selected) {
    if (!ids?.length) continue;
    const rows = await requiredOptions(
      client,
      context,
      report,
      tenantId,
      filters.facilityId,
      kind,
      ids,
      deps,
    );
    labels[kind] = rows.map((row) => row.label).join(', ');
    visiblePatientRows.push(...rows);
  }
  await auditPatientOptions(
    client,
    context,
    tenantId,
    filters.facilityId,
    report,
    visiblePatientRows,
  );
  return labels;
}

/** Browse options without a search. Pages are bounded and all protected patient reads are audited atomically. */
export async function listReportOptions(
  context: AuthorizationContext,
  rawId: string,
  raw: unknown,
): Promise<ReportSelectionPage> {
  const request = parseRequest(raw);
  let report: SelectionReport;
  let sourceModule: 'finance' | (typeof REPORT_ENGINES)[ReportEngineId]['module'];
  if (rawId === INVOICE_DOCUMENT_SELECTION) {
    authorizePermissions(context, [
      'reports.read',
      'reports.export',
      'billing.read',
      'clinical.read',
      'patients.read',
    ]);
    report = INVOICE_DOCUMENT_SELECTION;
    sourceModule = 'finance';
  } else {
    const authorized = authorizeReport(context, rawId, 'VIEW');
    report = authorized.id;
    sourceModule = authorized.definition.module;
  }
  requireSelectionPermission(context, report, request.kind);
  const facility = await authorizeReportFacility(context, request.facilityId, sourceModule);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    // Reject forged or mismatched dependencies rather than treating them as an empty result.
    const dependencies: Array<[ReportSelectionKind, number | undefined]> = [
      ['ward', request.wardId],
      ['department', request.departmentId],
      ['supplier', request.supplierId],
      ['patient', request.patientId],
    ];
    const dependencyRows: OptionRow[] = [];
    for (const [kind, id] of dependencies) {
      if (id)
        dependencyRows.push(
          ...(await requiredOptions(client, context, report, facility.tenantId, facility.id, kind, [
            id,
          ])),
        );
    }
    const offset = request.offset ?? 0,
      limit = request.limit ?? 20;
    const rows = await queryOptions(
      client,
      report,
      facility.tenantId,
      facility.id,
      request.kind,
      request,
      { search: request.search, offset, limit: limit + 1 },
    );
    const visible = rows.slice(0, limit);
    await auditPatientOptions(client, context, facility.tenantId, facility.id, report, [
      ...dependencyRows,
      ...visible,
    ]);
    await client.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
       VALUES($1,$2,$3,'VIEW','report_selection',$4,$5)`,
      [
        facility.tenantId,
        facility.id,
        String(context.userId),
        report,
        JSON.stringify({
          kind: request.kind,
          rowCount: visible.length,
          offset,
          searched: Boolean(request.search),
        }),
      ],
    );
    await client.query('COMMIT');
    return {
      options: visible.map(({ _patientId: _ignored, ...option }) => option),
      offset,
      limit,
      hasMore: rows.length > limit,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
