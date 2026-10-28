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
  accountingOverview: (facilityId: number, startDate: string, endDate: string) =>
    fetchJson<AccountingOverview>(
      `/api/accounting/overview?${new URLSearchParams({ facilityId: String(facilityId), startDate, endDate })}`,
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
