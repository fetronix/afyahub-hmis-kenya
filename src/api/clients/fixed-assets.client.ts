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

export type AssetRegisterRow = {
  category: string;
  assetCount: number;
  costCents: string;
  accumulatedCents: string;
  netBookCents: string;
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
};
