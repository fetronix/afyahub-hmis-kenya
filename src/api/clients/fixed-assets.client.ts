/**
 * Fixed-asset API client.
 *
 * The facility id is a hint: the server re-resolves it from the session and
 * refuses a facility the caller is not a member of. Amounts are integer-cent
 * strings throughout, matching the payroll and billing clients.
 */

import { API_BASE, fetchJson } from './http.ts';

function withFacility(path: string, facilityId: number): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${separator}facilityId=${facilityId}`;
}

export type AssetOverview = {
  assetCount: number;
  activeCount: number;
  disposedCount: number;
  costCents: string;
  accumulatedCents: string;
  netBookCents: string;
  impairmentCents: string;
  revaluationReserveCents: string;
  plannedMaintenance: number;
  categories: Array<{ category: string; count: number; netBookCents: string }>;
};

export type AssetCategory = {
  id: number;
  code: string;
  name: string;
  defaultUsefulLifeMonths: number;
  assetAccountId: number;
  accumDepAccountId: number;
  depExpenseAccountId: number;
  isActive: boolean;
  assetCount: number;
};

export type AssetRow = {
  id: number;
  assetCode: string;
  assetName: string;
  category: string;
  categoryId: number | null;
  departmentId: number | null;
  departmentName: string | null;
  location: string | null;
  custodianEmployeeId: number | null;
  custodianName: string | null;
  serialNumber: string | null;
  acquisitionDate: string;
  acquisitionCostKes: string;
  accumulatedDepreciationKes: string;
  netBookValueKes: string;
  usefulLifeMonths: number;
  status: 'ACTIVE' | 'DISPOSED';
  condition: string;
};

export type AssetList = { rows: AssetRow[]; page: number; pageSize: number; total: number };

export type AssetMovement = {
  id: number;
  movementType: string;
  movementDate: string;
  periodCode: string;
  amountKes: string;
  netBookValueAfterKes: string;
  journalEntryId: number | null;
  notes: string | null;
};

export type AssetMaintenanceRow = {
  id: number;
  assetId: number;
  assetCode: string;
  assetName: string;
  maintenanceDate: string;
  maintenanceType: string;
  vendor: string | null;
  description: string;
  costKes: string;
  status: string;
  completedDate: string | null;
  journalEntryId: number | null;
};

export type AssetDetail = {
  asset: AssetRow & {
    acquisitionCostKes: string;
    salvageValueKes: string;
    acquiredAt?: string;
    assetAccountId: number;
    accumDepAccountId: number;
    depExpenseAccountId: number;
    acquisitionCreditAccountId: number | null;
    disposalProceedsKes: string | null;
    disposalNotes: string | null;
    notes: string | null;
  };
  movements: AssetMovement[];
  maintenance: AssetMaintenanceRow[];
  transfers: Array<{
    id: number;
    transferDate: string;
    fromLocation: string | null;
    toLocation: string | null;
    reason: string;
  }>;
  disposalJournal: { id: number; journalNumber: string; entryDate: string } | null;
};

export type TaxRate = {
  id: number;
  name: string;
  method: 'REDUCING_BALANCE' | 'STRAIGHT_LINE';
  annualRateBps: number;
  authorityReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  categoryId: number | null;
};

export type TaxScheduleRow = {
  assetId: number;
  assetCode: string;
  assetName: string;
  status: 'CONFIGURED' | 'NO_CONFIGURED_RATE';
  annualAllowanceCents: string | null;
  rateName?: string;
  method?: string;
  annualRateBps?: number;
  authorityReference?: string;
  baseCents?: string;
  note: string;
};

export type AssetRegisterRow = {
  category: string;
  assetCount: number;
  costCents: string;
  accumulatedCents: string;
  netBookCents: string;
  impairmentCents: string;
  revaluationReserveCents: string;
};

export type DepreciationPreviewRow = {
  assetId: number;
  assetCode: string;
  assetName: string;
  category: string;
  alreadyPosted: boolean;
  chargeCents: string;
  netBookValueAfterCents: string;
  fullyDepreciated: boolean;
};

export type AssetOptions = {
  accounts: Array<{ id: number; code: string; name: string; accountType: string }>;
  departments: Array<{ id: number; name: string }>;
  employees: Array<{
    id: number;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    employmentStatus: string;
  }>;
};

/* ------------------------------------------------------------------ *
 * Depreciation policy, batches, maintenance, inspections, lifecycle
 * ------------------------------------------------------------------ */

export type DepreciationSettings = {
  defaultUsefulLifeMonths: number;
  defaultAnnualRateBps: number;
  depreciationCommencement: 'FULL_MONTH' | 'FOLLOWING_MONTH' | 'DAILY_PRORATA';
  depreciationApprovalRequired: boolean;
  financialYearStartMonth: number;
  configured: boolean;
  updatedAt: string | null;
  postedBatchCount: number;
  pendingBatchCount: number;
  annualRateBpsForDefaultLife: number;
  monthlyRateBpsForDefaultLife: number;
};

export type DepreciationBatch = {
  id: number;
  periodCode: string;
  entryDate: string;
  status: 'DRAFT' | 'APPROVED' | 'POSTED' | 'REVERSED';
  totalCents: string;
  assetCount: number;
  preparedByUserId: number | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
  postedAt: string | null;
  journalEntryId: number | null;
  reversalJournalEntryId: number | null;
  reversalReason: string | null;
  notes: string | null;
  createdAt: string;
};

export type DepreciationBatchItem = {
  id: number;
  assetId: number;
  assetCode: string;
  assetName: string;
  category: string;
  basisCents: string;
  salvageCents: string;
  usefulLifeMonths: number;
  annualRateBps: number;
  commencement: string;
  openingAccumulatedCents: string;
  chargeCents: string;
  closingAccumulatedCents: string;
  openingNbvCents: string;
  closingNbvCents: string;
  daysInService: number;
  periodDays: number;
};

export type DepreciationPreview = {
  period: string;
  convention: string;
  policyConfigured: boolean;
  existingBatch: { id: number; status: string; totalCents: string; assetCount: number } | null;
  totalCents: string;
  rows: Array<{
    assetId: number;
    assetCode: string;
    assetName: string;
    category: string;
    costCents: string;
    salvageCents: string;
    basisCents: string;
    usefulLifeMonths: number;
    annualRateBps: number;
    convention: string;
    inServiceDate: string;
    daysInService: number;
    periodDays: number;
    openingAccumulatedCents: string;
    chargeCents: string;
    closingAccumulatedCents: string;
    openingBookValueCents: string;
    closingBookValueCents: string;
  }>;
};

export type MaintenanceSchedule = {
  id: number;
  assetId: number;
  assetCode: string;
  assetName: string;
  name: string;
  frequency: string;
  intervalDays: number | null;
  nextDueDate: string;
  lastCompletedDate: string | null;
  instructions: string | null;
  responsibleDepartmentId: number | null;
  departmentName: string | null;
  assignedTechnician: string | null;
  vendor: string | null;
  estimatedCostCents: string;
  isActive: boolean;
  status: 'OVERDUE' | 'DUE' | 'SCHEDULED' | 'INACTIVE';
  daysUntilDue: number;
};

export type MaintenanceJob = {
  id: number;
  assetId: number;
  assetCode: string;
  assetName: string;
  maintenanceDate: string;
  reportedDate: string | null;
  maintenanceType: string;
  priority: string | null;
  description: string;
  problemDescription: string | null;
  assignedTechnician: string | null;
  vendor: string | null;
  repairActions: string | null;
  partsUsed: string | null;
  downtimeHours: string | null;
  costKes: string;
  status: string;
  completedDate: string | null;
  journalEntryId: number | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
};

export type Inspection = {
  id: number;
  assetId: number;
  assetCode: string;
  assetName: string;
  inspectionDate: string;
  inspectorName: string | null;
  conditionAssessment: string | null;
  findings: string | null;
  recommendations: string | null;
  followUpActions: string | null;
  nextInspectionDate: string | null;
  status: 'PLANNED' | 'COMPLETED';
  checklist: Array<{ item: string; result: string; notes?: string | null }> | null;
  attachmentReference: string | null;
  completedAt: string | null;
};

export type LifecycleEvent = {
  id: number;
  assetId: number;
  assetCode: string;
  assetName: string;
  eventType: string;
  effectiveDate: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string;
  details: string | null;
  journalEntryId: number | null;
  createdAt: string;
};

export type AssetDocument = {
  id: number;
  assetId: number;
  maintenanceId: number | null;
  inspectionId: number | null;
  title: string;
  documentType: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

export type AssetOperations = {
  schedules: MaintenanceSchedule[];
  jobs: MaintenanceJob[];
  inspections: Inspection[];
  lifecycle: LifecycleEvent[];
  documents: AssetDocument[];
  summary: {
    activeSchedules: number;
    overdueSchedules: number;
    dueSchedules: number;
    openCorrectiveJobs: number;
    completedMaintenance: number;
    totalMaintenanceCostCents: string;
    lastInspectionDate: string | null;
  };
};

export type AssetReportResult = {
  key: string;
  title: string;
  description: string;
  facilityName: string;
  generatedAt: string;
  filterSummary: string;
  columns: Array<{ key: string; label: string; kind?: 'money' | 'number' | 'date' }>;
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, string | number | null> | null;
  notes: string[];
};

export type AssetReportCatalogueEntry = {
  key: string;
  title: string;
  description: string;
  needsPeriod: boolean;
  needsRange: boolean;
  columns: Array<{ key: string; label: string; kind?: 'money' | 'number' | 'date' }>;
};

export const fixedAssetsClient = {
  getAssetOptions: (facilityId: number) =>
    fetchJson<AssetOptions>(withFacility('/fixed-assets/options', facilityId)),
  getAssetOverview: (facilityId: number) =>
    fetchJson<AssetOverview>(withFacility('/fixed-assets/overview', facilityId)),
  getAssetCategories: (facilityId: number) =>
    fetchJson<AssetCategory[]>(withFacility('/fixed-assets/categories', facilityId)),
  createAssetCategory: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<AssetCategory>(`${API_BASE}/fixed-assets/categories`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getAssets: (
    facilityId: number,
    params: { search?: string; status?: string; categoryId?: number; page?: number } = {},
  ) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.categoryId) query.set('categoryId', String(params.categoryId));
    if (params.page) query.set('page', String(params.page));
    return fetchJson<AssetList>(`${API_BASE}/fixed-assets?${query.toString()}`);
  },
  getAssetDetail: (facilityId: number, id: number) =>
    fetchJson<AssetDetail>(withFacility(`/fixed-assets/${id}`, facilityId)),
  createAsset: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<{ id: number; journalNumber: string }>(`${API_BASE}/fixed-assets`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  updateAsset: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<AssetRow>(`${API_BASE}/fixed-assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  transferAsset: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<unknown>(`${API_BASE}/fixed-assets/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  disposeAsset: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<{ journalNumber: string; gainLossCents: string }>(
      `${API_BASE}/fixed-assets/${id}/dispose`,
      { method: 'POST', body: JSON.stringify({ ...body, facilityId }) },
    ),
  previewDepreciation: (facilityId: number, period: string) =>
    fetchJson<DepreciationPreviewRow[]>(
      withFacility(
        `/fixed-assets/depreciation/preview?period=${encodeURIComponent(period)}`,
        facilityId,
      ),
    ),
  runDepreciation: (facilityId: number, body: { period: string; entryDate?: string }) =>
    fetchJson<{
      period: string;
      journalNumber?: string;
      chargedCents: string;
      assetsCharged: number;
      alreadyPosted: boolean;
    }>(`${API_BASE}/fixed-assets/depreciation/run`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getMaintenance: (facilityId: number, status?: string) =>
    fetchJson<AssetMaintenanceRow[]>(
      withFacility(`/fixed-assets/maintenance${status ? `?status=${status}` : ''}`, facilityId),
    ),
  createMaintenance: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<AssetMaintenanceRow>(`${API_BASE}/fixed-assets/maintenance`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  completeMaintenance: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<AssetMaintenanceRow>(`${API_BASE}/fixed-assets/maintenance/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getAssetTransfers: (facilityId: number) =>
    fetchJson<
      Array<{
        id: number;
        assetId: number;
        assetCode: string;
        assetName: string;
        transferDate: string;
        fromLocation: string | null;
        toLocation: string | null;
        reason: string;
      }>
    >(withFacility('/fixed-assets/transfers', facilityId)),
  getAssetRegisterReport: (facilityId: number) =>
    fetchJson<AssetRegisterRow[]>(withFacility('/fixed-assets/report', facilityId)),
  /*
   * Impairment and revaluation change the amount still to be depreciated. The
   * server never edits historical cost, so the UI shows the basis separately.
   */
  impairAsset: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<{ journalNumber: string; impairmentCents: string; netBookValueAfterCents: string }>(
      `${API_BASE}/fixed-assets/${id}/impair`,
      { method: 'POST', body: JSON.stringify({ ...body, facilityId }) },
    ),
  revalueAsset: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<{
      journalNumber: string;
      direction: 'UP' | 'DOWN';
      movementCents: string;
      revaluationReserveCents: string;
    }>(`${API_BASE}/fixed-assets/${id}/revalue`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getTaxRates: (facilityId: number) =>
    fetchJson<TaxRate[]>(withFacility('/fixed-assets/tax/rates', facilityId)),
  createTaxRate: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<TaxRate>(`${API_BASE}/fixed-assets/tax/rates`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getTaxSchedule: (facilityId: number, period: string) =>
    fetchJson<TaxScheduleRow[]>(
      withFacility(`/fixed-assets/tax/schedule?period=${encodeURIComponent(period)}`, facilityId),
    ),

  /* Policy */
  getDepreciationSettings: (facilityId: number) =>
    fetchJson<DepreciationSettings>(withFacility('/fixed-assets/settings', facilityId)),
  updateDepreciationSettings: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<DepreciationSettings>(`${API_BASE}/fixed-assets/settings`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  /* Batches */
  getDepreciationBatches: (facilityId: number, status?: string) =>
    fetchJson<DepreciationBatch[]>(
      withFacility(
        `/fixed-assets/depreciation/batches${status ? `?status=${status}` : ''}`,
        facilityId,
      ),
    ),
  getDepreciationBatch: (facilityId: number, batchId: number) =>
    fetchJson<{ batch: DepreciationBatch; items: DepreciationBatchItem[] }>(
      withFacility(`/fixed-assets/depreciation/batches/${batchId}`, facilityId),
    ),
  previewDepreciationBatch: (facilityId: number, period: string) =>
    fetchJson<DepreciationPreview>(`${API_BASE}/fixed-assets/depreciation/batches/preview`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, period }),
    }),
  prepareDepreciationBatch: (facilityId: number, body: { period: string; notes?: string }) =>
    fetchJson<DepreciationBatch>(`${API_BASE}/fixed-assets/depreciation/batches`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  approveDepreciationBatch: (facilityId: number, batchId: number) =>
    fetchJson<DepreciationBatch>(
      `${API_BASE}/fixed-assets/depreciation/batches/${batchId}/approve`,
      { method: 'POST', body: JSON.stringify({ facilityId }) },
    ),
  postDepreciationBatch: (facilityId: number, batchId: number) =>
    fetchJson<DepreciationBatch & { journalNumber: string }>(
      `${API_BASE}/fixed-assets/depreciation/batches/${batchId}/post`,
      { method: 'POST', body: JSON.stringify({ facilityId }) },
    ),
  reverseDepreciationBatch: (
    facilityId: number,
    batchId: number,
    reason: string,
    reversalDate?: string,
  ) =>
    fetchJson<DepreciationBatch & { reversalJournalNumber: string }>(
      `${API_BASE}/fixed-assets/depreciation/batches/${batchId}/reverse`,
      { method: 'POST', body: JSON.stringify({ facilityId, reason, reversalDate }) },
    ),
  discardDepreciationBatch: (facilityId: number, batchId: number) =>
    fetchJson<{ id: number; discarded: boolean }>(
      withFacility(`/fixed-assets/depreciation/batches/${batchId}`, facilityId),
      { method: 'DELETE' },
    ),
  getAssetSchedule: (facilityId: number, assetId: number, months = 12) =>
    fetchJson<{
      asset: Record<string, string | number>;
      rows: Array<{
        period: string;
        openingAccumulatedCents: string;
        chargeCents: string;
        closingAccumulatedCents: string;
        openingBookValueCents: string;
        closingBookValueCents: string;
        daysInService: number;
        periodDays: number;
      }>;
    }>(withFacility(`/fixed-assets/depreciation/schedule/${assetId}?months=${months}`, facilityId)),

  /* Maintenance */
  getMaintenanceSchedules: (
    facilityId: number,
    params: { dueOnly?: boolean; includeInactive?: boolean } = {},
  ) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (params.dueOnly) query.set('dueOnly', 'true');
    if (params.includeInactive) query.set('includeInactive', 'true');
    return fetchJson<MaintenanceSchedule[]>(
      `${API_BASE}/fixed-assets/maintenance/schedules?${query.toString()}`,
    );
  },
  createMaintenanceSchedule: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<MaintenanceSchedule>(`${API_BASE}/fixed-assets/maintenance/schedules`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  updateMaintenanceSchedule: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<MaintenanceSchedule>(`${API_BASE}/fixed-assets/maintenance/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  retireMaintenanceSchedule: (facilityId: number, id: number, reason?: string) =>
    fetchJson<MaintenanceSchedule>(`${API_BASE}/fixed-assets/maintenance/schedules/${id}/retire`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, reason }),
    }),
  completeMaintenanceSchedule: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<MaintenanceJob & { nextDueDate: string }>(
      `${API_BASE}/fixed-assets/maintenance/schedules/${id}/complete`,
      { method: 'POST', body: JSON.stringify({ ...body, facilityId }) },
    ),
  getMaintenanceJobs: (facilityId: number, params: { type?: string; status?: string } = {}) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (params.type) query.set('type', params.type);
    if (params.status) query.set('status', params.status);
    return fetchJson<MaintenanceJob[]>(
      `${API_BASE}/fixed-assets/maintenance/jobs?${query.toString()}`,
    );
  },
  createCorrectiveMaintenance: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<MaintenanceJob>(`${API_BASE}/fixed-assets/maintenance/corrective`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  completeCorrectiveMaintenance: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<MaintenanceJob>(`${API_BASE}/fixed-assets/maintenance/${id}/complete-corrective`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  verifyMaintenance: (facilityId: number, id: number, notes: string) =>
    fetchJson<MaintenanceJob>(`${API_BASE}/fixed-assets/maintenance/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, verificationNotes: notes }),
    }),
  getMaintenanceDashboard: (facilityId: number) =>
    fetchJson<{
      dueToday: MaintenanceSchedule[];
      overdue: MaintenanceSchedule[];
      upcoming: MaintenanceSchedule[];
      openCorrective: MaintenanceJob[];
      openPreventive: MaintenanceJob[];
      plannedInspections: Inspection[];
    }>(withFacility('/fixed-assets/maintenance/dashboard', facilityId)),

  /* Inspections */
  getInspections: (facilityId: number, params: { status?: string; assetId?: number } = {}) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (params.status) query.set('status', params.status);
    if (params.assetId) query.set('assetId', String(params.assetId));
    return fetchJson<Inspection[]>(`${API_BASE}/fixed-assets/inspections?${query.toString()}`);
  },
  createInspection: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<Inspection>(`${API_BASE}/fixed-assets/inspections`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  completeInspection: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<Inspection>(`${API_BASE}/fixed-assets/inspections/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  /* Lifecycle and documents */
  getLifecycleEvents: (facilityId: number, assetId?: number) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (assetId) query.set('assetId', String(assetId));
    return fetchJson<LifecycleEvent[]>(`${API_BASE}/fixed-assets/lifecycle?${query.toString()}`);
  },
  changeAssetStatus: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<{ asset: AssetRow; event: LifecycleEvent }>(`${API_BASE}/fixed-assets/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getAssetOperations: (facilityId: number, id: number) =>
    fetchJson<AssetOperations>(withFacility(`/fixed-assets/${id}/operations`, facilityId)),
  getAssetDocuments: (facilityId: number, id: number) =>
    fetchJson<AssetDocument[]>(withFacility(`/fixed-assets/${id}/documents`, facilityId)),
  uploadAssetDocument: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<AssetDocument>(`${API_BASE}/fixed-assets/${id}/documents`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getAssetDocument: (facilityId: number, documentId: number) =>
    fetchJson<{
      id: number;
      assetId: number;
      title: string;
      filename: string;
      mimeType: string;
      sha256: string;
      base64: string;
    }>(withFacility(`/fixed-assets/documents/${documentId}`, facilityId)),

  /* Reports and dashboard */
  getAssetDashboard: (facilityId: number) =>
    fetchJson<{
      counters: {
        total: number;
        inService: number;
        underMaintenance: number;
        impaired: number;
        retired: number;
        disposed: number;
        costCents: string;
        netBookCents: string;
      };
      maintenance: {
        dueToday: MaintenanceSchedule[];
        overdue: MaintenanceSchedule[];
        upcoming: MaintenanceSchedule[];
        openCorrective: MaintenanceJob[];
        openPreventive: MaintenanceJob[];
        plannedInspections: Inspection[];
      };
      latestBatches: DepreciationBatch[];
    }>(withFacility('/fixed-assets/dashboard', facilityId)),
  getAssetReports: (facilityId: number) =>
    fetchJson<{ reports: AssetReportCatalogueEntry[] }>(
      withFacility('/fixed-assets/reports', facilityId),
    ),
  runAssetReport: (facilityId: number, key: string, filters: Record<string, unknown> = {}) =>
    fetchJson<AssetReportResult>(`${API_BASE}/fixed-assets/reports/${key}`, {
      method: 'POST',
      body: JSON.stringify({ ...filters, facilityId }),
    }),
  exportAssetReport: (
    facilityId: number,
    key: string,
    format: 'pdf' | 'xlsx',
    filters: Record<string, unknown> = {},
  ) =>
    fetchJson<{ filename: string; contentType: string; base64: string }>(
      `${API_BASE}/fixed-assets/reports/${key}/export`,
      { method: 'POST', body: JSON.stringify({ ...filters, facilityId, format }) },
    ),
};
