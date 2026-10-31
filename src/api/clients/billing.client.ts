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
  ClaimSettlementResult,
  ClaimableLinesResponse,
  DraftClaimResult,
  InsuranceClaim,
  LabServiceDiagnostics,
  FacilityTariffValidation,
  FacilityService,
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

export interface MasterTariffRow {
  master: {
    id: number;
    code: string;
    description: string;
    department: string;
    billingFamily: string;
    unit: string;
    clinicalSource: string;
    originSourceId: number | null;
  };
  tariff: {
    id: number;
    code: string;
    fee: string;
    unit: string;
    department: string;
    isActive: boolean;
    autoBill: boolean;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    approvalStatus: 'DRAFT' | 'APPROVED';
    approvalReference: string | null;
    revision: number;
  } | null;
}
export interface MasterTariffEdit {
  tariffId: number;
  revision: number;
  fee: string;
  unit: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  autoBill: boolean;
}

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

export const billingClient = {
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
    input: FacilityServiceInput & { initialPrice: string; initialTariffCode?: string },
  ) =>
    fetchJson<{ service: FacilityService; tariff: ServiceTariff }>(
      `${API_BASE}/facility-services`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  updateFacilityService: (id: number, input: FacilityServiceInput) =>
    fetchJson<FacilityService>(`${API_BASE}/facility-services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  setFacilityServiceStatus: (id: number, facilityId: number, isActive: boolean) =>
    fetchJson<FacilityService>(`${API_BASE}/facility-services/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId, isActive }),
    }),
  getFacilityTariffs: (facilityId: number) =>
    fetchJson<ServiceTariff[]>(
      `${API_BASE}/facility-tariffs?facilityId=${encodeURIComponent(facilityId)}`,
    ),
  createFacilityTariff: (input: FacilityTariffInput) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateFacilityTariff: (id: number, input: FacilityTariffInput) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  setFacilityTariffStatus: (id: number, facilityId: number, isActive: boolean) =>
    fetchJson<ServiceTariff>(`${API_BASE}/facility-tariffs/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId, isActive }),
    }),
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

  getInvoiceFinalization: (id: number) =>
    fetchJson<FinalizedInvoiceView | { finalized: false }>(
      `${API_BASE}/invoices/${id}/finalization`,
    ),
  finalizeInvoice: (
    id: number,
    input: { insurerResponsibility: string; copayment: string; allocationBasis: string },
  ) =>
    fetchJson<{ invoiceId: number; finalizedAt: string; idempotentReplay: boolean }>(
      `${API_BASE}/invoices/${id}/finalize`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  recordInvoicePrintAccess: (id: number) =>
    fetchJson<{ authorized: true }>(`${API_BASE}/invoices/${id}/print-access`, { method: 'POST' }),
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

  getMasterTariffs: (facilityId: number) =>
    fetchJson<MasterTariffRow[]>(`${API_BASE}/master-tariffs?facilityId=${facilityId}`),
  syncMasterTariffs: (facilityId: number) =>
    fetchJson<{
      servicesCreated: number;
      mappingsCreated: number;
      tariffsCreated: number;
      skippedMissingUnit: number;
      note: string;
    }>(`${API_BASE}/master-tariffs/sync`, { method: 'POST', body: JSON.stringify({ facilityId }) }),
  createImagingMaster: (facilityId: number, description: string) =>
    fetchJson<unknown>(`${API_BASE}/master-tariffs/imaging-services`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, description }),
    }),
  saveMasterTariffs: (facilityId: number, rows: MasterTariffEdit[]) =>
    fetchJson<unknown>(`${API_BASE}/master-tariffs/batch`, {
      method: 'PUT',
      body: JSON.stringify({ facilityId, rows }),
    }),
  approveMasterTariff: (
    facilityId: number,
    id: number,
    revision: number,
    approvalReference: string,
  ) =>
    fetchJson<unknown>(`${API_BASE}/master-tariffs/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, revision, approvalReference }),
    }),
  linkLegacyMasterTariff: (
    facilityId: number,
    masterId: number,
    tariffId: number,
    revision: number,
  ) =>
    fetchJson<unknown>(`${API_BASE}/master-tariffs/${masterId}/link-existing`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, tariffId, revision }),
    }),
  getMasterTariffHistory: (facilityId: number, id: number) =>
    fetchJson<
      Array<{ id: number; action: string; userId: string; details: string; createdAt: string }>
    >(`${API_BASE}/master-tariffs/${id}/history?facilityId=${facilityId}`),
  getMasterSources: (facilityId: number) =>
    fetchJson<Record<string, Array<{ id: number; code: string; name: string }>>>(
      `${API_BASE}/master-tariff-sources?facilityId=${facilityId}`,
    ),
  getMasterMappings: (facilityId: number, masterId: number) =>
    fetchJson<{
      sources: Array<{ id: number; sourceType: string; sourceId: number; isActive: boolean }>;
      aliases: Array<{ id: number; sourceType: string; alias: string; isActive: boolean }>;
    }>(`${API_BASE}/master-tariffs/${masterId}/mappings?facilityId=${facilityId}`),
  setMasterSourceMapping: (
    facilityId: number,
    masterId: number,
    sourceType: string,
    sourceId: number,
    reviewReference: string,
  ) =>
    fetchJson<unknown>(`${API_BASE}/master-tariffs/${masterId}/source-mapping`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, sourceType, sourceId, reviewReference }),
    }),
  approveMasterAlias: (
    facilityId: number,
    masterId: number,
    sourceType: string,
    sourceId: number,
    reviewReference: string,
  ) =>
    fetchJson<unknown>(`${API_BASE}/master-tariffs/${masterId}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, sourceType, sourceId, reviewReference }),
    }),

  retireMasterAlias: (facilityId: number, aliasId: number, reviewReference: string) =>
    fetchJson<unknown>(`${API_BASE}/master-tariff-aliases/${aliasId}/retire`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, reviewReference }),
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
