import type { FinalizedInvoiceView, PaymentParty } from '../../billing/finalized-invoice.types.ts';
import type {
  BillingChargeAttemptList,
  BillingChargeAttemptOutcome,
  BillingChargeRetrySummary,
  BillingInvoice,
  BillingItem,
  BillingPayment,
  BillingRefund,
  RecordRefundResult,
  RefundStatusResult,
  RefundRequest,
  RefundRequestPage,
  RefundRequestStatus,
  RefundMethod,
  ClaimSettlementResult,
  ClaimableLinesResponse,
  DraftClaimResult,
  InsuranceClaim,
  LabServiceDiagnostics,
  FacilityTariffValidation,
  FacilityService,
  FinancialTransactionsReport,
  OccupancyTrendResponse,
  OperationsReport,
  PaymentLedgerRow,
  RecordPaymentResult,
  RevenueReport,
  ServiceTariff,
  ServiceTariffLink,
  TariffMatchExplanation,
} from '../../types/index.ts';
import { API_BASE, fetchJson } from './http.ts';

export interface FacilityServiceInput {
  facilityId: number;
  code: string;
  name: string;
  description: string;
  department: string;
  category: string;
  unit: string;
  isActive: boolean;
  autoBill: boolean;
}
export type FacilityServiceExpectedState = Pick<
  FacilityService,
  'name' | 'description' | 'isActive' | 'autoBill'
>;

export interface FacilityTariffInput {
  facilityId: number;
  serviceId: number;
  code: string;
  description: string;
  department: string;
  unit: string;
  fee: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  autoBill: boolean;
}

export interface FacilityCatalogueImportRow {
  code: string;
  name: string;
  description: string;
  department: string;
  category: string;
  unit: string;
  isActive: boolean;
  autoBill: boolean;
  initialPrice: string;
  initialTariffCode: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}
export interface FacilityCatalogueImportIssue {
  row: number;
  reasons: string[];
}
export interface FacilityCataloguePreview {
  valid: boolean;
  rowCount: number;
  rows: FacilityCatalogueImportRow[];
  issues: FacilityCatalogueImportIssue[];
}
export interface FacilityCatalogueImportResult {
  idempotentReplay: boolean;
  batchId: number;
  rowCount: number;
  services: Array<{
    serviceId: number;
    tariffId: number;
    serviceCode: string;
    tariffCode: string;
  }>;
}
export type FacilityCatalogueImportStatus =
  | { status: 'NOT_FOUND' | 'KEY_IN_USE' }
  | { status: 'RECORDED'; batchId: number; rowCount: number; requestMatched: boolean };
export interface FacilityCatalogueExport {
  filename: string;
  contentType: string;
  base64: string;
  rowCount: number;
  coverage: 'FACILITY_SERVICES_AND_LINKED_TARIFFS';
}

export interface FacilityTariffHistorySnapshot {
  code?: string;
  fee?: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  isActive?: boolean;
  autoBill?: boolean;
  revision?: number;
}
export interface FacilityTariffHistoryPage {
  events: Array<{
    id: number;
    action: string;
    recordedTime: string;
    actorUserId: string | null;
    actorKind: 'USER' | 'SYSTEM' | 'UNKNOWN';
    before: FacilityTariffHistorySnapshot | null;
    after: FacilityTariffHistorySnapshot | null;
  }>;
  nextCursor: number | null;
  coverage: 'RECORDED_EVENTS_ONLY';
  timestampTimezone: 'NOT_RECORDED';
}

export const billingClient = {
  previewFacilityCatalogueImport: (facilityId: number, rows: unknown[]) =>
    fetchJson<FacilityCataloguePreview>(`${API_BASE}/facility-services/import/validate`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, rows }),
    }),
  importFacilityCatalogue: (input: {
    facilityId: number;
    rows: FacilityCatalogueImportRow[];
    idempotencyKey: string;
    approvalReference: string;
    confirmed: true;
  }) =>
    fetchJson<FacilityCatalogueImportResult>(`${API_BASE}/facility-services/import`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getFacilityCatalogueImportStatus: (
    facilityId: number,
    idempotencyKey: string,
    expected?: { rows: unknown[]; approvalReference: string },
  ) =>
    fetchJson<FacilityCatalogueImportStatus>(`${API_BASE}/facility-services/import/status`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, idempotencyKey, ...expected }),
    }),
  exportFacilityCatalogue: (facilityId: number) =>
    fetchJson<FacilityCatalogueExport>(
      `${API_BASE}/facility-services/export?facilityId=${encodeURIComponent(facilityId)}`,
    ),
  getFacilityServices: (facilityId: number) =>
    fetchJson<FacilityService[]>(
      `${API_BASE}/facility-services?facilityId=${encodeURIComponent(facilityId)}`,
    ),
  getAvailableFacilityServices: (
    facilityId: number,
    filter: { department?: string; category?: string },
  ) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (filter.department) query.set('department', filter.department);
    if (filter.category) query.set('category', filter.category);
    return fetchJson<FacilityService[]>(`${API_BASE}/facility-services/available?${query}`);
  },
  createFacilityService: (
    input: FacilityServiceInput & { initialPrice?: string; initialTariffCode?: string },
  ) =>
    fetchJson<{ service: FacilityService; tariff: ServiceTariff }>(
      `${API_BASE}/facility-services`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  updateFacilityService: (
    id: number,
    input: FacilityServiceInput & { expectedState: FacilityServiceExpectedState },
  ) =>
    fetchJson<FacilityService>(`${API_BASE}/facility-services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  setFacilityServiceStatus: (id: number, facilityId: number, isActive: boolean) =>
    fetchJson<FacilityService>(`${API_BASE}/facility-services/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId, isActive }),
    }),
  deleteFacilityService: (id: number, facilityId: number) =>
    fetchJson<{ deleted: true; id: number; deletedTariffs: number }>(
      `${API_BASE}/facility-services/${id}/permanent?facilityId=${encodeURIComponent(facilityId)}`,
      { method: 'DELETE' },
    ),
  getFacilityTariffs: (facilityId: number) =>
    fetchJson<ServiceTariff[]>(
      `${API_BASE}/facility-tariffs?facilityId=${encodeURIComponent(facilityId)}`,
    ),
  getFacilityTariffHistory: (facilityId: number, tariffId: number, beforeId?: number) => {
    const query = new URLSearchParams({ facilityId: String(facilityId) });
    if (beforeId !== undefined) query.set('beforeId', String(beforeId));
    return fetchJson<FacilityTariffHistoryPage>(
      `${API_BASE}/facility-tariffs/${tariffId}/history?${query}`,
    );
  },
  createFacilityTariff: (input: FacilityTariffInput) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateFacilityTariff: (id: number, input: FacilityTariffInput & { expectedRevision: number }) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  setFacilityTariffStatus: (id: number, facilityId: number, isActive: boolean) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId, isActive }),
    }),
  deleteFacilityTariff: (id: number, facilityId: number) =>
    fetchJson<{ deleted: true; id: number }>(
      `${API_BASE}/facility-tariffs/${id}/permanent?facilityId=${encodeURIComponent(facilityId)}`,
      { method: 'DELETE' },
    ),
  archiveFacilityTariff: (id: number, facilityId: number) =>
    fetchJson<ServiceTariff>(
      `${API_BASE}/facility-tariffs/${id}?facilityId=${encodeURIComponent(facilityId)}`,
      { method: 'DELETE' },
    ),
  getFacilityTariffByServiceCode: (facilityId: number, code: string) =>
    fetchJson<{ service: FacilityService; tariff: ServiceTariff }>(
      `${API_BASE}/facility-tariffs/by-service-code/${encodeURIComponent(code)}?facilityId=${encodeURIComponent(facilityId)}`,
    ),
  getReviewedLabSpecimens: (facilityId: number) =>
    fetchJson<
      Array<{
        id: number;
        testId: number;
        specimenType: string;
        reviewReference: string;
        retiredAt: string | null;
        retirementReference: string | null;
      }>
    >(`${API_BASE}/master-lab-specimens?facilityId=${encodeURIComponent(facilityId)}`),
  addReviewedLabSpecimen: (
    facilityId: number,
    testId: number,
    specimenType: string,
    reviewReference: string,
  ) =>
    fetchJson(`${API_BASE}/master-lab-specimens`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, testId, specimenType, reviewReference }),
    }),
  retireReviewedLabSpecimen: (facilityId: number, id: number, reviewReference: string) =>
    fetchJson(`${API_BASE}/master-lab-specimens/${id}/retire`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, reviewReference }),
    }),

  getInvoiceDetail: (id: number) =>
    fetchJson<{
      invoice: BillingInvoice;
      items: BillingItem[];
      payments: BillingPayment[];
      refunds: BillingRefund[];
    }>(`${API_BASE}/invoices/${id}`),

  getInvoiceFinalization: (id: number, facilityId?: number) =>
    fetchJson<FinalizedInvoiceView | { finalized: false }>(
      `${API_BASE}/invoices/${id}/finalization${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),
  finalizeInvoice: (
    id: number,
    input: { insurerResponsibility: string; copayment: string; allocationBasis: string },
  ) =>
    fetchJson<{ invoiceId: number; finalizedAt: string; idempotentReplay: boolean }>(
      `${API_BASE}/invoices/${id}/finalize`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  recordInvoicePrintAccess: (id: number, facilityId?: number) =>
    fetchJson<{ authorized: true }>(`${API_BASE}/invoices/${id}/print-access`, {
      method: 'POST',
      ...(facilityId ? { body: JSON.stringify({ facilityId }) } : {}),
    }),
  attributeInvoicePayment: (
    invoiceId: number,
    paymentId: number,
    input: { party: PaymentParty; reason: string },
  ) =>
    fetchJson<{ id: number; idempotentReplay: boolean }>(
      `${API_BASE}/invoices/${invoiceId}/payments/${paymentId}/attribution`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  checkPaymentRequestStatus: (input: { facilityId: number; idempotencyKey: string }) =>
    fetchJson<
      | { status: 'NOT_FOUND' }
      | { status: 'CANCELLED'; invoiceId: number }
      | { status: 'RECORDED'; invoiceId: number; paymentId: number; receiptNumber: string }
    >(`${API_BASE}/billing/payments/status`, { method: 'POST', body: JSON.stringify(input) }),

  cancelPendingPaymentRequest: (input: {
    facilityId: number;
    invoiceId: number;
    idempotencyKey: string;
    reason: string;
  }) =>
    fetchJson<
      | { status: 'CANCELLED'; invoiceId: number; idempotentReplay: boolean }
      | { status: 'RECORDED'; invoiceId: number; paymentId: number; receiptNumber: string }
    >(`${API_BASE}/billing/payments/cancel-pending`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createRefundRequest: (input: {
    facilityId: number;
    invoiceId: number;
    paymentId: number;
    amount: string;
    refundMethod: RefundMethod;
    reason: string;
    idempotencyKey: string;
  }) =>
    fetchJson<{ request: RefundRequest; replayed: boolean }>(
      `${API_BASE}/billing/refund-requests`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  checkRefundRequestStatus: (input: { facilityId: number; idempotencyKey: string }) =>
    fetchJson<RefundRequestStatus>(`${API_BASE}/billing/refund-requests/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listRefundRequests: (input: {
    facilityId: number;
    invoiceId?: number;
    afterId?: number;
    limit?: number;
  }) => {
    const params = new URLSearchParams({ facilityId: String(input.facilityId) });
    if (input.invoiceId) params.set('invoiceId', String(input.invoiceId));
    if (input.afterId) params.set('afterId', String(input.afterId));
    if (input.limit) params.set('limit', String(input.limit));
    return fetchJson<RefundRequestPage>(`${API_BASE}/billing/refund-requests?${params}`);
  },

  decideRefundRequest: (
    id: number,
    input: {
      facilityId: number;
      decision: 'APPROVE' | 'REJECT';
      reviewHash: string;
      notes: string;
    },
  ) =>
    fetchJson<{ requestId: number; status: string; replayed: boolean }>(
      `${API_BASE}/billing/refund-requests/${id}/decision`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  revokeRefundApproval: (id: number, input: { facilityId: number; reason: string }) =>
    fetchJson<{ requestId: number; status: string; replayed: boolean }>(
      `${API_BASE}/billing/refund-requests/${id}/revoke`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  recordManualRefund: (input: {
    facilityId: number;
    invoiceId: number;
    paymentId: number;
    amount: string;
    refundMethod: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';
    externalReference?: string;
    bankStatementTransactionId?: number;
    reason: string;
    manualConfirmation: true;
    idempotencyKey: string;
  }) =>
    fetchJson<RecordRefundResult>(`${API_BASE}/billing/refunds`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  checkRefundStatus: (input: { facilityId: number; idempotencyKey: string }) =>
    fetchJson<RefundStatusResult>(`${API_BASE}/billing/refunds/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  voidInvoice: (id: number, reason: string) =>
    fetchJson<BillingInvoice>(`${API_BASE}/invoices/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  getRevenueReport: (facilityId?: number, range?: { from?: string; to?: string }) => {
    const params = new URLSearchParams();

    if (facilityId) params.set('facilityId', String(facilityId));
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);

    const query = params.toString();

    return fetchJson<RevenueReport>(`${API_BASE}/analytics/revenue${query ? `?${query}` : ''}`);
  },

  getFinancialTransactionsReport: (
    facilityId: number,
    range: { from: string; to: string },
    offset = 0,
  ) => {
    const params = new URLSearchParams({
      facilityId: String(facilityId),
      from: range.from,
      to: range.to,
      offset: String(offset),
    });
    return fetchJson<FinancialTransactionsReport>(
      `${API_BASE}/reporting/financial-transactions?${params}`,
    );
  },

  getOperationsReport: (facilityId?: number) =>
    fetchJson<OperationsReport>(
      `${API_BASE}/reporting/operations${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getOccupancyTrend: (facilityId?: number, days?: number) => {
    const params = new URLSearchParams();

    if (facilityId) params.set('facilityId', String(facilityId));
    if (days) params.set('days', String(days));

    const query = params.toString();

    return fetchJson<OccupancyTrendResponse>(
      `${API_BASE}/reporting/occupancy-trend${query ? `?${query}` : ''}`,
    );
  },

  getInvoices: (facilityId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<BillingInvoice[]>(`${API_BASE}/invoices${query ? `?${query}` : ''}`);
  },

  getInvoiceItems: (invoiceId: number) =>
    fetchJson<BillingItem[]>(`${API_BASE}/invoices/${invoiceId}/items`),

  createInvoice: (invoice: Partial<BillingInvoice>, items: Partial<BillingItem>[]) =>
    fetchJson<BillingInvoice>(`${API_BASE}/invoices`, {
      method: 'POST',
      body: JSON.stringify({
        invoice,
        items,
      }),
    }),

  /*
   * `/api/service-tariffs` is retired: a price is owned by the facility's own
   * service catalogue (`facility_services` + `facility_service_tariffs`), and
   * the server refuses the old family with 404 on purpose. These four methods
   * keep their names because screens and specs already call them, but they
   * must not keep pointing at a dead URL — an endpoint that only ever answers
   * 404 is worse than a missing one, because the screen looks wired.
   */
  getServiceTariffs: (facilityId: number) =>
    fetchJson<ServiceTariff[]>(
      `${API_BASE}/facility-tariffs?facilityId=${encodeURIComponent(String(facilityId))}`,
    ),

  createServiceTariff: (input: Partial<ServiceTariff> & { facilityId: number }) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateServiceTariff: (id: number, input: Partial<ServiceTariff> & { facilityId: number }) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /* Deactivation is a status change, not a delete: the row and its history stay. */
  deactivateServiceTariff: (id: number, facilityId: number) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId, isActive: false }),
    }),

  getChargeAttempts: (facilityId: number, status?: string) =>
    fetchJson<BillingChargeAttemptList>(
      `${API_BASE}/billing/charge-attempts?facilityId=${encodeURIComponent(
        String(facilityId),
      )}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
    ),

  retryChargeAttempt: (
    id: number,
    facilityId: number,
    priceReview?: { tariffId: number; revision: number; unitPrice: string; reason: string },
  ) =>
    fetchJson<BillingChargeAttemptOutcome>(
      `${API_BASE}/billing/charge-attempts/${encodeURIComponent(String(id))}/retry`,
      {
        method: 'POST',
        body: JSON.stringify({ facilityId, ...(priceReview ? { priceReview } : {}) }),
      },
    ),

  retryChargeAttempts: (facilityId: number) =>
    fetchJson<BillingChargeRetrySummary>(`${API_BASE}/billing/charge-attempts/retry`, {
      method: 'POST',
      body: JSON.stringify({ facilityId }),
    }),

  voidChargeAttempt: (id: number, facilityId: number, reason?: string) =>
    fetchJson<{ success: boolean; id: number; status: string }>(
      `${API_BASE}/billing/charge-attempts/${encodeURIComponent(String(id))}/void`,
      { method: 'POST', body: JSON.stringify({ facilityId, reason }) },
    ),

  explainTariffMatch: (input: {
    family: string;
    code?: string;
    name?: string;
    wardCode?: string;
    encounterType?: string;
    facilityId?: number;
  }) =>
    fetchJson<TariffMatchExplanation>(`${API_BASE}/billing/tariff-match`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getServiceTariffLinks: (facilityId: number) =>
    fetchJson<ServiceTariffLink[]>(
      `${API_BASE}/service-tariff-links?facilityId=${encodeURIComponent(String(facilityId))}`,
    ),

  createServiceTariffLink: (input: {
    facilityId: number;
    serviceType: string;
    serviceId?: number | null;
    tariffId: number;
    autoBill?: boolean;
    note?: string;
  }) =>
    fetchJson<ServiceTariffLink & { replacedLinks: number[] }>(`${API_BASE}/service-tariff-links`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deactivateServiceTariffLink: (id: number, facilityId: number) =>
    fetchJson<ServiceTariffLink>(
      `${API_BASE}/service-tariff-links/${encodeURIComponent(String(id))}/deactivate`,
      { method: 'PATCH', body: JSON.stringify({ facilityId }) },
    ),

  getFacilityTariffValidation: (facilityId: number, offset = 0) =>
    fetchJson<FacilityTariffValidation>(
      `${API_BASE}/billing/tariff-validation?facilityId=${encodeURIComponent(String(facilityId))}&offset=${encodeURIComponent(String(offset))}&limit=100`,
    ),

  getLabServiceDiagnostics: (facilityId: number) =>
    fetchJson<LabServiceDiagnostics>(
      `${API_BASE}/billing/lab-service-diagnostics?facilityId=${encodeURIComponent(
        String(facilityId),
      )}`,
    ),

  recordPayment: (
    payment: Partial<BillingPayment> & {
      transactionCode?: string;
      allowOverpayment?: boolean;
      allowPartyOverpayment?: boolean;
      payerParty?: PaymentParty;
      idempotencyKey?: string;
    },
  ) =>
    fetchJson<RecordPaymentResult>(`${API_BASE}/billing/payments`, {
      method: 'POST',
      body: JSON.stringify(payment),
    }),

  getPayments: (
    facilityId?: number,
    options?: { invoiceId?: number; method?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();

    if (facilityId !== undefined) params.set('facilityId', String(facilityId));
    if (options?.invoiceId !== undefined) params.set('invoiceId', String(options.invoiceId));
    if (options?.method) params.set('method', options.method);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));

    const suffix = params.toString();

    return fetchJson<PaymentLedgerRow[]>(
      `${API_BASE}/billing/payments${suffix ? `?${suffix}` : ''}`,
    );
  },

  getClaims: (facilityId?: number) =>
    fetchJson<InsuranceClaim[]>(
      `${API_BASE}/claims${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getClaimableLines: (invoiceId: number, facilityId?: number) =>
    fetchJson<ClaimableLinesResponse>(
      `${API_BASE}/invoices/${invoiceId}/claimable-lines${
        facilityId ? `?facilityId=${facilityId}` : ''
      }`,
    ),

  getClaimItems: (claimId: number, facilityId?: number) =>
    fetchJson<Array<{ id: number; description: string; amount: string }>>(
      `${API_BASE}/claims/${claimId}/items${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  draftClaim: (claim: {
    invoiceId: number;
    lineItemIds?: number[];
    payerName?: string;
    payerCode?: string;
    policyNumber?: string;
    preAuthCode?: string;
    notes?: string;
    facilityId?: number;
  }) =>
    fetchJson<DraftClaimResult>(`${API_BASE}/claims`, {
      method: 'POST',
      body: JSON.stringify(claim),
    }),

  submitClaim: (id: number, facilityId?: number, manualReference?: string) =>
    fetchJson<InsuranceClaim>(`${API_BASE}/claims/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, manualReference }),
    }),

  adjudicateClaim: (id: number, approvedAmount: string, notes?: string, facilityId?: number) =>
    fetchJson<InsuranceClaim>(`${API_BASE}/claims/${id}/adjudicate`, {
      method: 'POST',
      body: JSON.stringify({
        approvedAmount,
        notes,
        facilityId,
      }),
    }),

  settleClaim: (
    id: number,
    facilityId?: number,
    billingPaymentId?: number,
    remittanceReference?: string,
  ) =>
    fetchJson<ClaimSettlementResult>(`${API_BASE}/claims/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, billingPaymentId, remittanceReference }),
    }),

  updateClaimStatus: (id: number, status: string, approvedAmount?: string, notes?: string) =>
    fetchJson<InsuranceClaim>(`${API_BASE}/claims/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        approvedAmount,
        notes,
      }),
    }),
};
