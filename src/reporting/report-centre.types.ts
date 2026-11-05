import type { ReportEngineId } from './report-catalogue.ts';
import { OPERATIONAL_REPORT_ENGINES } from './report-centre.operational-definitions.ts';
import { LEDGER_REPORT_ENGINES } from './report-centre.ledger-definitions.ts';

export interface ReportColumn {
  key: string;
  label: string;
  /** Values are rendered as recorded; null always means unknown/not recorded. */
  kind?: 'money';
}

export interface ReportEngineDefinition {
  id: ReportEngineId;
  title: string;
  description: string;
  module:
    | 'inventory'
    | 'procurement'
    | 'inpatient'
    | 'opd'
    | 'laboratory'
    | 'radiology'
    | 'pharmacy'
    | 'finance'
    | 'registration'
    | 'accounting';
  permissions: readonly string[];
  /** Some domains impose an additional permission for printed/exported copies. */
  exportPermissions?: readonly string[];
  /** Ledger journals are denominated in KES, independent of tenant display currency. */
  fixedCurrency?: 'KES';
  columns: readonly ReportColumn[];
  searchLabel: string;
  dateLabel?: string;
  dateMode?: 'asOf';
  statuses?: readonly { value: string; label: string }[];
  patientFilter?: boolean;
  wardFilter?: boolean;
  departmentFilter?: boolean;
  staffFilter?: boolean;
  notes: readonly string[];
}

const inventoryColumns: readonly ReportColumn[] = [
  { key: 'code', label: 'Item code' },
  { key: 'item', label: 'Item' },
  { key: 'category', label: 'Category' },
  { key: 'store', label: 'Recorded location' },
  { key: 'unit', label: 'Unit' },
  { key: 'quantity', label: 'Current stock' },
  { key: 'reorderLevel', label: 'Reorder level' },
  { key: 'status', label: 'Status' },
];
const inventoryStatuses = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'unknown', label: 'Not recorded' },
] as const;

export const REPORT_ENGINES: Record<ReportEngineId, ReportEngineDefinition> = {
  ...OPERATIONAL_REPORT_ENGINES,
  ...LEDGER_REPORT_ENGINES,
  'inventory-category': {
    id: 'inventory-category',
    title: 'Inventory by category',
    description: 'Current item balances ordered by the recorded item category.',
    module: 'inventory',
    permissions: ['reports.read', 'inventory.read'],
    columns: inventoryColumns,
    searchLabel: 'Search item, code, category or location',
    statuses: inventoryStatuses,
    notes: [
      'This is a current item snapshot, not a stock movement ledger or historical valuation.',
      'Blank values are not treated as zero. Quantities in different units are not added together.',
    ],
  },
  'inventory-store': {
    id: 'inventory-store',
    title: 'Inventory by store',
    description: 'Current item balances ordered by the recorded store-location text.',
    module: 'inventory',
    permissions: ['reports.read', 'inventory.read'],
    columns: inventoryColumns,
    searchLabel: 'Search item, code, category or location',
    statuses: inventoryStatuses,
    notes: [
      'Store location is free text on the inventory item, not a verified store master or transfer ledger.',
      'This is a current snapshot; quantities in different units are not added together.',
    ],
  },
  'purchase-orders': {
    id: 'purchase-orders',
    title: 'LPO summaries',
    description: 'Purchase orders and suppliers recorded for this facility.',
    module: 'procurement',
    permissions: ['reports.read', 'procurement.read'],
    columns: [
      { key: 'number', label: 'Purchase order' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'status', label: 'Status' },
      { key: 'expectedDelivery', label: 'Expected delivery' },
      { key: 'orderAmount', label: 'Order value', kind: 'money' },
    ],
    searchLabel: 'Search order number or supplier',
    dateLabel: 'Expected delivery date',
    statuses: [
      { value: 'Pending Approval', label: 'Pending approval' },
      { value: 'Approved', label: 'Approved' },
      { value: 'Rejected', label: 'Rejected' },
      { value: 'Completed', label: 'Completed' },
      { value: 'Cancelled', label: 'Cancelled' },
      { value: '__unknown__', label: 'Not recorded' },
    ],
    notes: [
      'Order values are recorded purchase-order amounts, not supplier invoices, payments or reconciled expenditure.',
      'When a delivery-date range is applied, orders without an expected delivery date are excluded and counted.',
    ],
  },
  'current-inpatients': {
    id: 'current-inpatients',
    title: 'Current inpatient list',
    description: 'Admissions whose recorded status is Admitted, with their current ward and bed.',
    module: 'inpatient',
    permissions: ['reports.read', 'inpatient.read', 'patients.read'],
    columns: [
      { key: 'admissionId', label: 'Admission ID' },
      { key: 'mrn', label: 'MRN' },
      { key: 'patient', label: 'Patient' },
      { key: 'ward', label: 'Ward' },
      { key: 'bed', label: 'Bed' },
      { key: 'admissionDate', label: 'Recorded admission time' },
      { key: 'admissionType', label: 'Admission type' },
    ],
    searchLabel: 'Search patient name or MRN',
    patientFilter: true,
    wardFilter: true,
    notes: [
      'A live snapshot of records marked Admitted; it is not a historical admission or discharge register.',
      'Admission times are shown as recorded; historical timezone and manually corrected times require review.',
    ],
  },
};

export interface ReportFilters {
  facilityId: number;
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  patientId?: number;
  wardId?: number;
  departmentId?: number;
  staffId?: number;
  offset?: number;
  limit?: number;
}

export type ReportValue = string | number | null;
export type ReportRow = Record<string, ReportValue>;

export interface ReportSummary {
  label: string;
  value: ReportValue;
  kind?: 'money';
}

export interface ReportResult {
  reportId: ReportEngineId;
  title: string;
  facilityId: number;
  facilityName: string;
  /** Tenant currency as configured; null is explicitly unknown. */
  currency: string | null;
  generatedAt: string;
  filters: ReportFilters;
  columns: readonly ReportColumn[];
  rows: ReportRow[];
  /** Aggregate of the entire filtered snapshot, never just the visible page. */
  summaries?: ReportSummary[];
  total: number;
  offset: number;
  limit: number;
  notes: string[];
}

export interface ReportExport {
  filename: string;
  contentType: string;
  /** Binary bytes encoded for the existing authenticated JSON client. */
  base64: string;
}
