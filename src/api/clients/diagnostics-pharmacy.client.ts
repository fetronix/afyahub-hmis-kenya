import type {
  DispenseAllocation,
  ExpirySummary,
  InventoryBatchRow,
  InventoryItem,
  LabOrder,
  LabResult,
  LabTest,
  PurchaseOrder,
  QueueItem,
  RadiologyOrder,
  ReceiveBatchResult,
  Supplier,
} from '../../types/index.ts';
import { API_BASE, fetchJson, type ServiceCharge } from './http.ts';

export const diagnosticsPharmacyClient = {
  getLabTests: (facilityId?: number) =>
    fetchJson<LabTest[]>(`${API_BASE}/lab-tests${facilityId ? `?facilityId=${facilityId}` : ''}`),

  getLabOrders: (facilityId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<LabOrder[]>(`${API_BASE}/lab-orders${query ? `?${query}` : ''}`);
  },

  createLabOrderBatch: (data: {
    encounterId: number;
    patientId: number;
    testIds?: number[];
    investigations?: string[];
    clinicalIndication: string;
    specimenType: string;
    priority: string;
    clinicalNotes?: string;
    orderedBy?: string;
  }) =>
    fetchJson<{
      orders: LabOrder[];
      queue: QueueItem;
      billing?: Array<{
        orderId: number;
        testName: string;
        billing: ServiceCharge | null;
      }>;
    }>(`${API_BASE}/lab-orders/batch`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createLabOrder: (order: Partial<LabOrder>) =>
    fetchJson<LabOrder>(`${API_BASE}/lab-orders`, {
      method: 'POST',
      body: JSON.stringify(order),
    }),

  updateLabOrderStatus: (id: number, status: string, accessionNumber?: string) =>
    fetchJson<LabOrder>(`${API_BASE}/lab-orders/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        accessionNumber,
      }),
    }),

  getLabResults: (orderId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (orderId) {
      params.append('orderId', orderId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<LabResult[]>(`${API_BASE}/lab-results${query ? `?${query}` : ''}`);
  },

  addLabResult: (res: Partial<LabResult>) =>
    fetchJson<LabResult>(`${API_BASE}/lab-results`, {
      method: 'POST',
      body: JSON.stringify(res),
    }),

  verifyLabResult: (id: number) =>
    fetchJson<LabResult>(`${API_BASE}/lab-results/${id}/verify`, { method: 'POST' }),

  getRadiologyOrders: (facilityId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<RadiologyOrder[]>(`${API_BASE}/radiology-orders${query ? `?${query}` : ''}`);
  },

  createRadiologyOrder: (order: Partial<RadiologyOrder>) =>
    fetchJson<RadiologyOrder>(`${API_BASE}/radiology-orders`, {
      method: 'POST',
      body: JSON.stringify(order),
    }),

  updateRadiologyReport: (
    id: number,
    data: {
      findings: string;
      impression: string;
      reportedBy: string;
    },
  ) =>
    fetchJson<RadiologyOrder>(`${API_BASE}/radiology-orders/${id}/report`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getInventoryBatches: (
    facilityId?: number,
    options?: {
      itemId?: number;
      status?: 'All' | 'Expired' | 'Expiring' | 'OK';
      horizonDays?: number;
    },
  ) => {
    const params = new URLSearchParams();

    if (facilityId) params.set('facilityId', String(facilityId));
    if (options?.itemId) params.set('itemId', String(options.itemId));
    if (options?.status) params.set('status', options.status);
    if (options?.horizonDays) params.set('horizonDays', String(options.horizonDays));

    const query = params.toString();

    return fetchJson<InventoryBatchRow[]>(
      `${API_BASE}/inventory/batches${query ? `?${query}` : ''}`,
    );
  },

  getExpirySummary: (facilityId?: number, days?: number) => {
    const params = new URLSearchParams();

    if (facilityId) params.set('facilityId', String(facilityId));
    if (days) params.set('days', String(days));

    const query = params.toString();

    return fetchJson<ExpirySummary>(
      `${API_BASE}/inventory/expiry-summary${query ? `?${query}` : ''}`,
    );
  },

  receiveBatch: (
    itemId: number,
    payload: {
      batchNumber: string;
      expiryDate: string;
      quantity: number;
      costPerUnit?: string | number;
      facilityId?: number;
    },
  ) =>
    fetchJson<ReceiveBatchResult>(`${API_BASE}/inventory/${itemId}/batches`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getInventory: (facilityId?: number) =>
    fetchJson<InventoryItem[]>(
      `${API_BASE}/inventory${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  createInventoryItem: (item: Partial<InventoryItem>) =>
    fetchJson<InventoryItem>(`${API_BASE}/inventory`, {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  dispenseMedication: (data: {
    prescriptionId?: number;
    patientId: number;
    itemId?: number;
    quantityDispensed: number;
    batchNumber?: string;
    dispensedBy: string;
    notes?: string;
    facilityId?: number;
    tenantId?: number;
    drugName?: string;
    encounterId?: number;
    unitPrice?: string;
  }) =>
    fetchJson<{
      batchNumber?: string | null;
      stockTracking?: 'FEFO' | 'untracked';
      allocations?: DispenseAllocation[];
      stockAfter?: number | null;
      billing?: {
        charged: boolean;
        invoiceNumber?: string;
        totalAmount?: string;
        message?: string;
      };
    }>(`${API_BASE}/pharmacy/dispense`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSuppliers: (tenantId?: number) =>
    fetchJson<Supplier[]>(`${API_BASE}/suppliers${tenantId ? `?tenantId=${tenantId}` : ''}`),

  getPurchaseOrders: (facilityId?: number) =>
    fetchJson<PurchaseOrder[]>(
      `${API_BASE}/purchase-orders${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  createPurchaseOrder: (po: Partial<PurchaseOrder>) =>
    fetchJson<PurchaseOrder>(`${API_BASE}/purchase-orders`, {
      method: 'POST',
      body: JSON.stringify(po),
    }),
};
