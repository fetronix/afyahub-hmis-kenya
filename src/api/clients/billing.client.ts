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
  ClaimSettlementResult,
  ClaimableLinesResponse,
  DraftClaimResult,
  InsuranceClaim,
  LabServiceDiagnostics,
  FacilityTariffValidation,
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

export const billingClient = {
  getInvoiceDetail: (id: number) =>
    fetchJson<{
      invoice: BillingInvoice;
      items: BillingItem[];
      payments: BillingPayment[];
      refunds: BillingRefund[];
    }>(`${API_BASE}/invoices/${id}`),

  recordManualRefund: (input: {
    facilityId: number;
    invoiceId: number;
    paymentId: number;
    amount: string;
    refundMethod: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';
    externalReference?: string;
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

  getServiceTariffs: (facilityId: number) =>
    fetchJson<ServiceTariff[]>(
      `${API_BASE}/service-tariffs?facilityId=${encodeURIComponent(String(facilityId))}`,
    ),

  createServiceTariff: (input: Partial<ServiceTariff> & { facilityId: number }) =>
    fetchJson<ServiceTariff>(`${API_BASE}/service-tariffs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateServiceTariff: (id: number, input: Partial<ServiceTariff> & { facilityId: number }) =>
    fetchJson<ServiceTariff>(`${API_BASE}/service-tariffs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deactivateServiceTariff: (id: number, facilityId: number) =>
    fetchJson<ServiceTariff>(`${API_BASE}/service-tariffs/${id}/deactivate`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId }),
    }),

  getChargeAttempts: (facilityId: number, status?: string) =>
    fetchJson<BillingChargeAttemptList>(
      `${API_BASE}/billing/charge-attempts?facilityId=${encodeURIComponent(
        String(facilityId),
      )}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
    ),

  retryChargeAttempt: (id: number, facilityId: number) =>
    fetchJson<BillingChargeAttemptOutcome>(
      `${API_BASE}/billing/charge-attempts/${encodeURIComponent(String(id))}/retry`,
      { method: 'POST', body: JSON.stringify({ facilityId }) },
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
