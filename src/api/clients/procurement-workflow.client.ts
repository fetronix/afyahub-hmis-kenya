/**
 * Procurement chain API client: requisitions, goods received notes, supplier
 * invoices and payments.
 *
 * The facility id is a hint; the server re-resolves it from the session and
 * refuses a facility the caller is not a member of.
 */

import { API_BASE, fetchJson } from './http.ts';

function withFacility(path: string, facilityId: number): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${separator}facilityId=${facilityId}`;
}

export type RequisitionLine = {
  id?: number;
  lineNumber?: number;
  inventoryItemId: number | null;
  description: string;
  quantity: string;
  unit: string;
  estimatedUnitPrice: string;
  lineTotal: string;
};

export type RequisitionRow = {
  id: number;
  requisitionNumber: string;
  requestDate: string;
  neededBy: string | null;
  department: string | null;
  justification: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'CANCELLED';
  estimatedTotalKes: string;
  requestedByUserId: number | null;
  requestedByName: string;
  decidedByUserId: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  purchaseOrderId: number | null;
  items: RequisitionLine[];
};

export type RequisitionDetail = RequisitionRow & {
  events: Array<{
    id: number;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    createdAt: string;
  }>;
};

export type RequisitionList = {
  total: number;
  page: number;
  pageSize: number;
  rows: RequisitionRow[];
};

export type GoodsReceivedNoteRow = {
  id: number;
  grnNumber: string;
  purchaseOrderId: number;
  supplierId: number;
  receivedDate: string;
  receivedByName: string;
  status: 'POSTED' | 'REVERSED';
  inventoryValueKes: string;
  notes: string | null;
  items: Array<{
    id: number;
    purchaseOrderItemId: number;
    inventoryItemId: number | null;
    description: string;
    quantityReceived: string;
    unitCost: string;
    lineTotal: string;
    batchNumber: string | null;
    expiryDate: string | null;
  }>;
  invoice: { id: number; invoiceNumber: string; status: string } | null;
};

export type OutstandingOrderLine = {
  id: number;
  lineNumber: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  receivedQuantity: number;
  outstandingQuantity: number;
};

export type SupplierInvoiceRow = {
  id: number;
  supplierId: number;
  supplierName: string | null;
  purchaseOrderId: number | null;
  goodsReceivedNoteId: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  subtotalKes: string;
  taxKes: string;
  totalAmountKes: string;
  paidAmountKes: string;
  balanceKes: string;
  status: string;
  postedJournalId: number | null;
  payments?: Array<{
    id: number;
    paymentNumber: string;
    paymentDate: string;
    paymentMethod: string;
    amountKes: string;
    paymentReference: string | null;
  }>;
};

export const procurementWorkflowClient = {
  listRequisitions: (
    facilityId: number,
    filters: { status?: string; search?: string; page?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (filters.status) query.set('status', filters.status);
    if (filters.search) query.set('search', filters.search);
    if (filters.page) query.set('page', String(filters.page));
    const suffix = query.toString() ? `&${query.toString()}` : '';
    return fetchJson<RequisitionList>(
      withFacility(`/procurement/requisitions?page=1${suffix}`, facilityId),
    );
  },
  getRequisition: (facilityId: number, id: number) =>
    fetchJson<RequisitionDetail>(withFacility(`/procurement/requisitions/${id}`, facilityId)),
  createRequisition: (
    facilityId: number,
    body: {
      requisitionNumber: string;
      requestDate: string;
      neededBy?: string | null;
      department?: string | null;
      justification: string;
      items: Array<{
        description: string;
        quantity: string;
        unit: string;
        estimatedUnitPrice: string;
      }>;
    },
  ) =>
    fetchJson<RequisitionDetail>(withFacility('/procurement/requisitions', facilityId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitRequisition: (facilityId: number, id: number) =>
    fetchJson<RequisitionDetail>(
      withFacility(`/procurement/requisitions/${id}/submit`, facilityId),
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    ),
  decideRequisition: (
    facilityId: number,
    id: number,
    decision: 'approve' | 'reject',
    note?: string,
  ) =>
    fetchJson<RequisitionDetail>(
      withFacility(`/procurement/requisitions/${id}/${decision}`, facilityId),
      { method: 'POST', body: JSON.stringify({ note: note ?? null }) },
    ),
  convertRequisition: (facilityId: number, id: number, supplierId: number) =>
    fetchJson<{ purchaseOrderId: number; idempotentReplay: boolean }>(
      withFacility(`/procurement/requisitions/${id}/convert`, facilityId),
      { method: 'POST', body: JSON.stringify({ supplierId }) },
    ),
  listGoodsReceivedNotes: (facilityId: number, purchaseOrderId?: number) =>
    fetchJson<GoodsReceivedNoteRow[]>(
      withFacility(
        purchaseOrderId
          ? `/procurement/goods-received?purchaseOrderId=${purchaseOrderId}`
          : '/procurement/goods-received',
        facilityId,
      ),
    ),
  outstandingOrderLines: (facilityId: number, orderId: number) =>
    fetchJson<{ order: Record<string, unknown>; lines: OutstandingOrderLine[] }>(
      withFacility(`/procurement/purchase-orders/${orderId}/outstanding`, facilityId),
    ),
  postGoodsReceived: (
    facilityId: number,
    body: {
      purchaseOrderId: number;
      grnNumber: string;
      receivedDate: string;
      idempotencyKey: string;
      notes?: string | null;
      lines: Array<{
        purchaseOrderItemId: number;
        inventoryItemId?: number | null;
        quantityReceived: string;
        unitCost: string;
        batchNumber?: string | null;
        expiryDate?: string | null;
      }>;
    },
  ) =>
    fetchJson<{ id: number; replayed: boolean; status: string; note: GoodsReceivedNoteRow }>(
      withFacility('/procurement/goods-received', facilityId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  listSupplierInvoices: (facilityId: number, status?: string) =>
    fetchJson<SupplierInvoiceRow[]>(
      withFacility(
        status
          ? `/procurement/supplier-invoices?status=${encodeURIComponent(status)}`
          : '/procurement/supplier-invoices',
        facilityId,
      ),
    ),
  createSupplierInvoice: (
    facilityId: number,
    body: {
      goodsReceivedNoteId: number;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate?: string | null;
      expenseAccountId: number;
      apAccountId: number;
      taxAmount?: string;
      entryDate?: string;
      idempotencyKey: string;
      notes?: string | null;
    },
  ) =>
    fetchJson<{ invoiceId: number; replayed: boolean; invoice: SupplierInvoiceRow }>(
      withFacility('/procurement/supplier-invoices', facilityId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  paySupplierInvoice: (
    facilityId: number,
    id: number,
    body: {
      amount: string;
      paymentDate: string;
      bankAccountId: number;
      paymentMethod?: string;
      paymentReference?: string;
      idempotencyKey: string;
    },
  ) =>
    fetchJson<{ paymentId: number; invoice: SupplierInvoiceRow }>(
      withFacility(`/procurement/supplier-invoices/${id}/payments`, facilityId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

export type PostingAccount = {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  subType: string;
  normalBalance: string;
  isSystemAccount: boolean;
};

/** Bank/cash accounts registered for this facility, from the accounting workspace. */
export async function listFacilityBankAccounts(facilityId: number) {
  const response = await fetchJson<{
    success: boolean;
    accounts: Array<{
      id: number;
      accountName: string;
      bankName: string;
      accountNumberMasked: string | null;
      glAccountId: number;
      connectorMode: string;
    }>;
  }>(withFacility('/accounting/bank', facilityId));
  return response.accounts;
}

/** Active chart of accounts, used to choose expense and payable accounts. */
export async function listPostingAccounts(facilityId: number) {
  const response = await fetchJson<{ success: boolean; accounts: PostingAccount[] }>(
    withFacility('/accounting/accounts', facilityId),
  );
  return response.accounts;
}
