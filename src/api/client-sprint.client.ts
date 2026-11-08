import { fetchJson } from './client.ts';

export interface AccountingOverview {
  filters: { startDate: string | null; endDate: string };
  accounts: Array<{
    accountId: number;
    accountCode: string;
    accountName: string;
    accountType: string;
    debitKes: string;
    creditKes: string;
  }>;
  periods: Array<{
    id: number;
    periodCode: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
  journals: Array<{
    id: number;
    journalNumber: string;
    entryDate: string;
    description: string;
    status: string;
    reversalOfJournalId: number | null;
  }>;
  trialBalance: { debitKes: string; creditKes: string; balanced: boolean };
  profitAndLoss: { postedRevenueKes: string; postedExpensesKes: string; ledgerResultKes: string };
  balanceSheet: {
    asOf: string;
    assetsKes: string;
    liabilitiesKes: string;
    equityIncludingAccumulatedResultKes: string;
    balanced: boolean;
  };
  limitations: { notice: string; billingReconciliation: string; serviceLineProfitability: string };
}
export interface ExpenseReviewItem {
  id: number;
  requestNumber: string;
  incurredDate: string;
  payeeName: string;
  category: string;
  amountKes: string;
  currency: string;
  description: string;
  serviceLine: string | null;
  status: string;
  requestedByUserId: number | null;
  reviewedByUserId: number | null;
  journalId: number | null;
  reversalJournalId: number | null;
  accountingStatus: 'NOT_POSTED' | 'POSTED' | 'REVERSED' | 'REVIEW_REQUIRED';
  expenseAccount: { id: number | null; code: string | null; name: string | null };
  payableAccount: { id: number | null; code: string | null; name: string | null };
  supportingDocuments: Array<{ name: string; storageReference: string }>;
  reviewHash: string | null;
  reviewIssue: 'SOURCE_CHANGED' | 'ACCOUNT_REVIEW_REQUIRED' | null;
}
export interface ExpenseReviewPage {
  expenses: ExpenseReviewItem[];
  nextAfterId: number | null;
  notice: string;
}
export interface PaymentSettlementSource {
  sourceType: 'BILLING_PAYMENT' | 'BILLING_REFUND';
  sourceId: number;
  paymentId: number;
  invoiceId: number;
  amountKes: string;
  recordNumber: string;
  method: string | null;
  createdAt: string;
  party: string | null;
  status: string;
  reviewCode: string | null;
  journalId: number | null;
  journalNumber: string | null;
  reversalJournalId: number | null;
}
export interface SettlementAccount {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY';
}
export interface PaymentSettlementPage {
  sources: PaymentSettlementSource[];
  next: { afterType: PaymentSettlementSource['sourceType']; afterId: number } | null;
  notice: string;
}
export interface BillingConsistencyReport {
  invoices: Array<{
    id: number;
    invoiceNumber: string;
    status: string | null;
    total: string | null;
    paid: string | null;
    lineTotal: string | null;
    paymentTotal: string | null;
    issues: string[];
  }>;
  pageSummary: { examined: number; requiringReview: number };
  nextAfterId: number | null;
  limitations: { ledgerReconciliation: string; notice: string };
}
export interface BillingLedgerReview extends BillingConsistencyReport {
  sourceEvents: Array<{
    sourceType: string;
    sourceId: number;
    invoiceId: number;
    amount: string | null;
    payerLinked: boolean;
    journalIds: number[];
    issues: string[];
    assessment: string;
  }>;
  ledgerPageSummary: { examined: number; unposted: number; requiringReview: number };
}
export interface DialysisWorkspace {
  protocol: {
    version: string;
    approvalReference: string;
    planFields: Array<{ key: string; type: 'text' | 'number' | 'boolean'; required: boolean }>;
    completionFields: Array<{
      key: string;
      type: 'text' | 'number' | 'boolean';
      required: boolean;
    }>;
  } | null;
  machines: Array<{
    id: number;
    machineCode: string;
    bayLabel: string;
    isolationZone: string;
    status: string;
  }>;
  schedules: Array<{
    id: number;
    patientId: number;
    treatmentPlanId: number;
    machineId: number;
    scheduledDate: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
  sessions: Array<{
    id: number;
    sessionNumber: string;
    scheduleId: number;
    patientId: number;
    status: string;
    billedChargeStatus: string;
    completionFields: Array<{
      key: string;
      type: 'text' | 'number' | 'boolean';
      required: boolean;
    }> | null;
  }>;
  adverseEvents: Array<{ id: number; sessionId: number; followUpStatus: string }>;
  notice: string;
}
function post<T>(url: string, body: unknown, idempotencyKey?: string) {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    body: JSON.stringify(body),
  });
}
function patch<T>(url: string, body: unknown) {
  return fetchJson<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
}
export const sprintApi = {
  expenseReviewPage: (facilityId: number, search = '', afterId = 0) =>
    fetchJson<ExpenseReviewPage>(
      `/api/accounting/expenses?${new URLSearchParams({
        facilityId: String(facilityId),
        search,
        afterId: String(afterId),
      })}`,
    ),
  approveAndPostExpense: (
    id: number,
    body: { facilityId: number; reviewHash: string; notes: string },
  ) =>
    post<{
      expenseId: number;
      status: 'POSTED';
      journalId: number;
      idempotentReplay: boolean;
      paymentRecorded: false;
    }>(`/api/accounting/expenses/${id}/approve-and-post`, body),
  paymentSettlements: (
    facilityId: number,
    state: 'UNRESOLVED' | 'ALL',
    cursor?: { afterType: string; afterId: number } | null,
  ) =>
    fetchJson<PaymentSettlementPage>(
      `/api/accounting/payment-settlements?${new URLSearchParams({
        facilityId: String(facilityId),
        state,
        ...(cursor ? { afterType: cursor.afterType, afterId: String(cursor.afterId) } : {}),
      })}`,
    ),
  settlementAccounts: (facilityId: number, search = '', afterId = 0) =>
    fetchJson<{ accounts: SettlementAccount[]; nextAfterId: number | null }>(
      `/api/accounting/payment-settlement-accounts?${new URLSearchParams({
        facilityId: String(facilityId),
        search,
        afterId: String(afterId),
      })}`,
    ),
  retryPaymentSettlement: (sourceType: string, sourceId: number, body: unknown) =>
    post<{
      journal: { id: number; journalNumber: string };
      idempotentReplay: boolean;
      reversed: boolean;
      allocation: {
        party: string | null;
        amountKes: string;
        receivableKes: string;
        liabilityKes: string;
      };
    }>(
      `/api/accounting/payment-settlements/${encodeURIComponent(sourceType)}/${sourceId}/retry`,
      body,
    ),
  accountingOverview: (facilityId: number, startDate: string, endDate: string) =>
    fetchJson<AccountingOverview>(
      `/api/accounting/overview?${new URLSearchParams({ facilityId: String(facilityId), startDate, endDate })}`,
    ),
  billingConsistency: (facilityId: number, startDate: string, endDate: string, afterId = 0) =>
    fetchJson<BillingConsistencyReport>(
      `/api/accounting/billing-consistency?${new URLSearchParams({ facilityId: String(facilityId), startDate, endDate, afterId: String(afterId) })}`,
    ),
  billingLedgerReview: (facilityId: number, startDate: string, endDate: string, afterId = 0) =>
    fetchJson<BillingLedgerReview>(
      `/api/accounting/billing-ledger-review?${new URLSearchParams({ facilityId: String(facilityId), startDate, endDate, afterId: String(afterId) })}`,
    ),
  billingJournalExceptions: (
    facilityId: number,
    startDate: string,
    endDate: string,
    afterJournalId = 0,
  ) =>
    fetchJson<{
      journals: Array<{
        id: number;
        sourceType: string;
        sourceId: string | null;
        entryDate: string;
        issues: string[];
      }>;
      pageSummary: { examined: number; requiringReview: number };
      nextAfterJournalId: number | null;
      limitations: string;
    }>(
      `/api/accounting/billing-journal-exceptions?${new URLSearchParams({ facilityId: String(facilityId), startDate, endDate, afterJournalId: String(afterJournalId) })}`,
    ),
  postBillingSource: (sourceType: string, sourceId: number, body: unknown, key: string) =>
    post<{
      journal: { id: number; journalNumber: string };
      idempotentReplay: boolean;
      reversed: boolean;
      allocation: {
        party: string | null;
        amountKes: string;
        receivableKes: string;
        liabilityKes: string;
      };
    }>(`/api/accounting/billing-postings/${encodeURIComponent(sourceType)}/${sourceId}`, body, key),
  billingSourceStatus: (facilityId: number, sourceType: string, sourceId: number) =>
    fetchJson<
      | { status: 'NOT_FOUND' }
      | {
          status: 'RECORDED';
          journalId: number;
          journalNumber: string;
          entryDate: string;
          reversed: boolean;
          amountKes: string;
          receivableKes: string;
          liabilityKes: string;
        }
    >(
      `/api/accounting/billing-postings/${encodeURIComponent(sourceType)}/${sourceId}?${new URLSearchParams({ facilityId: String(facilityId) })}`,
    ),
  createAccount: (body: unknown) =>
    post<{ account: { id: number } }>('/api/accounting/accounts', body),
  createPeriod: (body: unknown) =>
    post<{ period: { id: number } }>('/api/accounting/periods', body),
  closePeriod: (id: number, body: unknown) => post(`/api/accounting/periods/${id}/close`, body),
  postJournal: (body: unknown, key: string) => post('/api/accounting/journals', body, key),
  reverseJournal: (id: number, body: unknown, key: string) =>
    post(`/api/accounting/journals/${id}/reverse`, body, key),
  dialysisWorkspace: (facilityId: number) =>
    fetchJson<DialysisWorkspace>(`/api/dialysis/workspace?facilityId=${facilityId}`),
  approveProtocol: (body: unknown) => post<{ protocol: unknown }>('/api/dialysis/protocols', body),
  createMachine: (body: unknown) =>
    post<{ machine: { id: number } }>('/api/dialysis/machines', body),
  setMachineStatus: (id: number, body: unknown) =>
    patch(`/api/dialysis/machines/${id}/status`, body),
  createAssessment: (body: unknown) =>
    post<{ assessment: { id: number } }>('/api/dialysis/assessments', body),
  createPlan: (body: unknown) =>
    post<{ treatmentPlan: { id: number } }>('/api/dialysis/treatment-plans', body),
  authorizePlan: (id: number, body: unknown) =>
    post(`/api/dialysis/treatment-plans/${id}/authorize`, body),
  scheduleDialysis: (body: unknown, key: string) =>
    post<{ scheduleId: number }>('/api/dialysis/schedules', body, key),
  cancelDialysisSchedule: (id: number, body: unknown) =>
    post(`/api/dialysis/schedules/${id}/cancel`, body),
  startDialysis: (id: number, body: unknown) => post(`/api/dialysis/schedules/${id}/start`, body),
  addObservation: (id: number, body: unknown) =>
    post(`/api/dialysis/sessions/${id}/observations`, body),
  useConsumable: (id: number, body: unknown, key: string) =>
    post(`/api/dialysis/sessions/${id}/consumables`, body, key),
  completeDialysis: (id: number, body: unknown) =>
    post(`/api/dialysis/sessions/${id}/complete`, body),
  adverseEvent: (id: number, body: unknown) =>
    post(`/api/dialysis/sessions/${id}/adverse-events`, body),
  followUp: (id: number, body: unknown) =>
    post(`/api/dialysis/adverse-events/${id}/follow-up`, body),
};
