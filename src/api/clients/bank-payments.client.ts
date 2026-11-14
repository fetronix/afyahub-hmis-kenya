import { fetchJson } from './http.ts';

export interface BankAccount {
  id: number;
  accountName: string;
  bankName: string;
  bankCode: string;
  branchName: string | null;
  currency: string;
  accountNumberMasked: string | null;
  glAccountId: number;
  isActive: boolean;
  provider: string;
}
export interface BankInvoice {
  id: number;
  invoiceNumber: string;
  balanceAmount: string;
}
export interface BankPayment {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  bankAccountId: number;
  amountKes: string;
  bankReference: string;
  paymentDate: string;
  payerParty: 'PATIENT' | 'INSURER';
  status: 'PENDING' | 'VERIFIED' | 'SETTLED' | 'REJECTED';
  submittedByUserId: number;
  verifiedByUserId: number | null;
  approvedByUserId: number | null;
  statementTransactionId: number | null;
  billingPaymentId: number | null;
  receiptNumber: string | null;
  refundedKes: string;
  journalStatus: 'NOT_RECEIPTED' | 'PENDING_REVIEW' | 'POSTED';
}
export interface BankWorkspace {
  configurationHistory: Array<{
    id: number;
    action: string;
    accountId: string;
    actorUserId: string;
    createdAt: string;
  }>;
  accounts: BankAccount[];
  invoices: BankInvoice[];
  payments: BankPayment[];
  events: Array<{
    id: number;
    bankPaymentId: number;
    actorUserId: number;
    action: string;
    createdAt: string;
  }>;
  notice: string;
  limit: number;
}
export interface BankPolicy {
  bankOnly: boolean;
  configured: boolean;
  mode: string;
  apiInitiationAvailable: boolean;
}
export interface StatementWorkspace {
  imports: Array<{
    id: number;
    bankAccountId: number;
    startDate: string;
    endDate: string;
    closingBalanceKes: string;
    lineCount: number;
  }>;
  transactions: Array<{
    id: number;
    bankAccountId: number;
    date: string;
    reference: string | null;
    description: string;
    direction: string;
    amountKes: string;
    matchStatus: string;
    matchedJournalLineId: number | null;
  }>;
  reconciliations: Array<{
    id: number;
    bankAccountId: number;
    statementImportId: number;
    status: string;
    differenceKes: string;
  }>;
  notice: string;
}
export interface BankWorksheet {
  worksheetBalanced: boolean;
  differenceKes: string;
  statementBalanceKes: string;
  ledgerBalanceKes: string;
  unmatchedStatementCount: number;
  bankConfirmed: false;
}
export interface MatchSuggestion {
  journalLineId: number;
  journalEntryId: number;
  entryDate: string;
  reference: string | null;
  amountKes: string;
  confidence: string;
  reasons: string[];
}
const query = (facilityId: number) => `?facilityId=${facilityId}`;
function post<T = unknown>(url: string, body: unknown) {
  return fetchJson<T>(`/api${url}`, { method: 'POST', body: JSON.stringify(body) });
}
export const bankPaymentsApi = {
  policy: (facilityId: number) =>
    fetchJson<BankPolicy>(`/api/bank-payments/policy${query(facilityId)}`),
  workspace: (facilityId: number) =>
    fetchJson<BankWorkspace>(`/api/bank-payments${query(facilityId)}`),
  enable: (facilityId: number) => post('/bank-payments/policy/enable', { facilityId }),
  saveAccount: (body: unknown, id?: number) =>
    fetchJson(`/api/bank-payments/accounts${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    }),
  submit: (body: unknown) =>
    post<{ id: number; idempotentReplay: boolean }>('/bank-payments', body),
  verify: (facilityId: number, id: number, statementTransactionId: number, notes: string) =>
    post(`/bank-payments/${id}/verify`, {
      facilityId,
      statementTransactionId,
      notes,
      attested: true,
    }),
  reject: (facilityId: number, id: number, reason: string) =>
    post(`/bank-payments/${id}/reject`, { facilityId, reason }),
  settle: (facilityId: number, id: number) =>
    post(`/bank-payments/${id}/approve-and-settle`, { facilityId }),
  statements: (facilityId: number) =>
    fetchJson<StatementWorkspace>(`/api/accounting/bank${query(facilityId)}`),
  previewImport: (facilityId: number, id: number, input: unknown) =>
    post<{
      lineCount: number;
      overlappingLines: number;
      duplicatesWithinFile: number;
      canImport: boolean;
      preview: Array<{
        transactionDate: string;
        referenceNumber: string;
        direction: string;
        amountKes: string;
      }>;
    }>(`/accounting/bank/accounts/${id}/statements/preview`, { facilityId, ...(input as object) }),
  importStatement: (facilityId: number, id: number, input: unknown) =>
    post(`/accounting/bank/accounts/${id}/statements`, { facilityId, ...(input as object) }),
  worksheet: (facilityId: number, accountId: number, statementId: number) =>
    fetchJson<{ worksheet: BankWorksheet }>(
      `/api/accounting/bank/accounts/${accountId}/statements/${statementId}/reconciliation${query(facilityId)}`,
    ),
  prepare: (facilityId: number, accountId: number, statementId: number, body: unknown) =>
    post(`/accounting/bank/accounts/${accountId}/statements/${statementId}/reconciliation`, {
      facilityId,
      ...(body as object),
    }),
  approve: (facilityId: number, id: number, approvalNotes: string) =>
    post(`/accounting/bank/reconciliations/${id}/approve`, { facilityId, approvalNotes }),
  suggestions: (facilityId: number, id: number) =>
    fetchJson<{ suggestions: MatchSuggestion[] }>(
      `/api/accounting/bank/transactions/${id}/suggestions${query(facilityId)}`,
    ),
  match: (facilityId: number, id: number, journalLineId: number) =>
    post(`/accounting/bank/transactions/${id}/match`, { facilityId, journalLineId }),
  unmatch: (facilityId: number, id: number, reason: string) =>
    post(`/accounting/bank/transactions/${id}/unmatch`, { facilityId, reason }),
  report: (facilityId: number, accountId: number) =>
    fetchJson<Record<string, unknown>>(
      `/api/accounting/bank/accounts/${accountId}/reconciliation-report${query(facilityId)}`,
    ),
  ledgerAccounts: (facilityId: number) =>
    fetchJson<{
      accounts: Array<{
        id: number;
        accountName: string;
        accountCode: string;
        accountType: string;
        normalBalance: string;
        isActive: boolean;
      }>;
    }>(`/api/accounting/accounts${query(facilityId)}`),
};
