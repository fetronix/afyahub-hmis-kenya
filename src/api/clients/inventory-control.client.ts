/**
 * Stock-control API client: movements ledger, adjustments, physical counts,
 * store transfers, reorder alerts and valuation.
 *
 * The facility id is a hint; the server re-resolves it from the session and
 * refuses a facility the caller is not a member of.
 */

import { API_BASE, fetchJson } from './http.ts';

function withFacility(path: string, facilityId: number): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${separator}facilityId=${facilityId}`;
}

export type StockMovementRow = {
  id: number;
  itemId: number;
  batchId: number | null;
  movementType:
    | 'RECEIPT'
    | 'DISPENSE'
    | 'ADJUSTMENT'
    | 'COUNT_VARIANCE'
    | 'TRANSFER_OUT'
    | 'TRANSFER_IN'
    | 'WRITE_OFF';
  quantityDelta: number;
  stockAfter: number;
  reasonCode: string | null;
  referenceType: string | null;
  referenceId: string | null;
  storeFrom: string | null;
  storeTo: string | null;
  notes: string | null;
  actorName: string;
  movementDate: string;
  createdAt: string;
  itemName: string | null;
  itemCode: string | null;
};

export type StockCountLine = {
  id: number;
  itemId: number;
  expectedQuantity: number;
  countedQuantity: number | null;
  varianceQuantity: number | null;
  notes: string | null;
  itemName: string | null;
  itemCode: string | null;
  unit: string | null;
  unitCost: string | null;
};

export type StockCountRow = {
  id: number;
  countNumber: string;
  countDate: string;
  storeLocation: string | null;
  status: 'OPEN' | 'POSTED' | 'CANCELLED';
  notes: string | null;
  countedByName: string;
  postedAt: string | null;
  lines?: StockCountLine[];
};

export type TransferRow = {
  id: number;
  transferNumber: string;
  transferDate: string;
  storeFrom: string;
  storeTo: string;
  status: 'POSTED' | 'REVERSED';
  notes: string | null;
  actorName: string;
  itemCount?: number;
  totalQuantity?: number;
  items?: Array<{
    id: number;
    itemId: number;
    quantity: number;
    itemName: string | null;
    itemCode: string | null;
    unit: string | null;
  }>;
};

export type ReorderAlertRow = {
  id: number;
  itemCode: string;
  name: string;
  unit: string | null;
  currentStock: number | null;
  reorderLevel: number | null;
  storeLocation: string | null;
};

export type StockValuation = {
  batches: Array<{
    batchId: number;
    itemId: number;
    itemCode: string;
    itemName: string;
    category: string | null;
    batchNumber: string;
    expiryDate: string | null;
    quantity: number;
    unitCost: string | null;
    valueCents: string | null;
  }>;
  categories: Array<{ category: string; quantity: number; valueKes: string }>;
  totalKes: string;
  unvaluedBatches: number;
  unvaluedQuantity: number;
  batchReconciliation: Array<{
    itemId: number;
    itemCode: string;
    itemName: string;
    currentStock: number;
    batchQuantity: number;
    difference: number;
  }>;
  note: string;
};

export const ADJUSTMENT_REASON_OPTIONS = [
  { code: 'DAMAGE', label: 'Damaged stock' },
  { code: 'EXPIRY', label: 'Expired stock' },
  { code: 'SUPPLIER_RETURN', label: 'Returned to supplier' },
  { code: 'COUNT_CORRECTION', label: 'Count correction' },
  { code: 'DATA_ENTRY', label: 'Data-entry correction' },
  { code: 'DONATION', label: 'Donation received' },
] as const;

export const inventoryControlClient = {
  listMovements: (
    facilityId: number,
    filters: { itemId?: number; from?: string; to?: string; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (filters.itemId) query.set('itemId', String(filters.itemId));
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
    if (filters.limit) query.set('limit', String(filters.limit));
    const suffix = query.toString() ? `&${query.toString()}` : '';
    return fetchJson<{ success: true; movements: StockMovementRow[] }>(
      withFacility(`/inventory/movements?limit=${filters.limit ?? 200}${suffix}`, facilityId),
    );
  },
  adjust: (
    facilityId: number,
    body: {
      itemId: number;
      direction: 'INCREASE' | 'DECREASE';
      quantity: number;
      reasonCode: string;
      movementDate: string;
      notes?: string;
      batchId?: number | null;
    },
  ) =>
    fetchJson<{
      success: true;
      adjustment: { itemId: number; stockAfter: number; delta: number };
    }>(`${API_BASE}/inventory/adjustments`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  listCounts: (facilityId: number) =>
    fetchJson<{ success: true; counts: StockCountRow[] }>(
      withFacility('/inventory/stock-counts', facilityId),
    ),
  getCount: (facilityId: number, id: number) =>
    fetchJson<{ success: true; count: StockCountRow }>(
      withFacility(`/inventory/stock-counts/${id}`, facilityId),
    ),
  createCount: (
    facilityId: number,
    body: { countNumber: string; countDate: string; storeLocation?: string; notes?: string },
  ) =>
    fetchJson<{ success: true; count: StockCountRow }>(`${API_BASE}/inventory/stock-counts`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  recordCountLine: (
    facilityId: number,
    countId: number,
    body: { itemId: number; countedQuantity: number; notes?: string },
  ) =>
    fetchJson<{ success: true; count: StockCountRow }>(
      `${API_BASE}/inventory/stock-counts/${countId}/lines`,
      { method: 'POST', body: JSON.stringify({ ...body, facilityId }) },
    ),
  postCount: (facilityId: number, countId: number) =>
    fetchJson<{
      success: true;
      adjusted: number;
      netVariance: number;
      count: StockCountRow;
    }>(`${API_BASE}/inventory/stock-counts/${countId}/post`, {
      method: 'POST',
      body: JSON.stringify({ facilityId }),
    }),
  listTransfers: (facilityId: number) =>
    fetchJson<{ success: true; transfers: TransferRow[] }>(
      withFacility('/inventory/transfers', facilityId),
    ),
  createTransfer: (
    facilityId: number,
    body: {
      transferNumber: string;
      transferDate: string;
      storeFrom: string;
      storeTo: string;
      notes?: string;
      items: Array<{ itemId: number; quantity: number }>;
    },
  ) =>
    fetchJson<{ success: true; transfer: TransferRow }>(`${API_BASE}/inventory/transfers`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  reorderAlerts: (facilityId: number) =>
    fetchJson<{ success: true; items: ReorderAlertRow[] }>(
      withFacility('/inventory/reorder-alerts', facilityId),
    ),
  updateReorderLevel: (facilityId: number, itemId: number, reorderLevel: number) =>
    fetchJson<{ success: true; item: { itemId: number; reorderLevel: number } }>(
      `${API_BASE}/inventory/items/${itemId}/reorder-level`,
      { method: 'PUT', body: JSON.stringify({ facilityId, reorderLevel }) },
    ),
  valuation: (facilityId: number) =>
    fetchJson<{ success: true; valuation: StockValuation }>(
      withFacility('/inventory/valuation', facilityId),
    ),
};
