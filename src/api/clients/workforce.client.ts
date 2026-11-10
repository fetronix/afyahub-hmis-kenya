/**
 * Workforce API client — HR and payroll.
 *
 * The facility id is passed explicitly (as elsewhere in the client) but the
 * server re-resolves it against the caller's scope; it is a hint, not an
 * authority.
 */

import { API_BASE, fetchJson } from './http.ts';

export type WorkforceOverview = {
  headcount: number;
  activeEmployees: number;
  onLeave: number;
  monthlyBasicCents: string;
  departments: number;
  pendingLeave: number;
  payrollPeriods: number;
  activeStatutoryVersions: number;
  payrollReady: boolean;
};

export type HrDepartmentRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  activeEmployees: number;
};

export type HrDesignationRow = {
  id: number;
  departmentId: number | null;
  departmentName: string | null;
  title: string;
  grade: string | null;
  isActive: boolean;
};

export type HrEmployeeRow = {
  id: number;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string | null;
  phone: string | null;
  email: string | null;
  departmentId: number | null;
  departmentName: string | null;
  designationId: number | null;
  designationTitle: string | null;
  employmentType: string;
  employmentStatus: string;
  hireDate: string;
  exitDate: string | null;
  baseSalaryCents: string;
  kraPin: string | null;
  nssfNumber: string | null;
  shifNumber: string | null;
};

export type HrAttendanceDay = {
  date: string;
  summary: { expected: number; recorded: number; present: number; absent: number };
  rows: Array<{
    employeeId: number;
    employeeNumber: string;
    name: string;
    departmentName: string | null;
    status: string | null;
    checkIn: string | null;
    checkOut: string | null;
    hours: string | null;
  }>;
};

export type HrLeaveType = {
  id: number;
  code: string;
  name: string;
  annualEntitlementDays: string;
  paid: boolean;
  requiresApproval: boolean;
  isActive: boolean;
};

export type HrLeaveRequest = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
  leaveTypeId: number;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type HrShift = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

export type HrRosterEntry = {
  id: number;
  employeeId: number;
  employeeName: string;
  workDate: string;
  shiftId: number;
  shiftName: string;
  startTime: string;
  endTime: string;
  notes: string | null;
};

export type PayrollBand = {
  sequence: number;
  lowerBoundCents: string;
  upperBoundCents: string | null;
  employeeRateBp: number;
  employerRateBp: number;
  employeeFixedCents: string;
  employerFixedCents: string;
  employeeCapCents: string | null;
  employerCapCents: string | null;
  reliefCents: string;
};

export type PayrollStatutoryVersion = {
  id: number;
  statute: 'PAYE' | 'NSSF' | 'SHIF' | 'AHL';
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  authority: string;
  sourceReference: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  notes: string | null;
  bands: PayrollBand[];
};

export type PayrollRunSummary = {
  id: number;
  status: string;
  employeeCount: number;
  grossCents: string;
  taxableCents: string;
  netCents: string;
  payeCents: string;
  nssfEmployeeCents: string;
  nssfEmployerCents: string;
  shifCents: string;
  ahlEmployeeCents: string;
  ahlEmployerCents: string;
  otherDeductionsCents: string;
  calculatedAt: string | null;
  calculatedBy: number | null;
  approvedAt: string | null;
  approvedBy: number | null;
  journalEntryId: number | null;
};

export type PayrollPeriod = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  payDate: string;
  status: string;
  run: PayrollRunSummary | null;
};

export type PayrollPayslipRow = {
  id: number;
  employeeId: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  grossCents: string;
  taxableCents: string;
  payeCents: string;
  nssfEmployeeCents: string;
  shifCents: string;
  ahlEmployeeCents: string;
  otherDeductionsCents: string;
  netCents: string;
  breakdown: {
    lines: Array<{ code: string; name: string; kind: string; amountCents: string }>;
    statutes: Array<{
      statute: string;
      versionId: number;
      label: string;
      employeeCents: string;
      employerCents: string;
    }>;
  };
};

export type PayrollRunDetail = {
  run: PayrollRunSummary & {
    periodId: number;
    periodName: string;
    periodStart: string;
    periodEnd: string;
    payDate: string;
    periodStatus: string;
    statutoryVersionIds: number[];
  };
  payslips: PayrollPayslipRow[];
};

export type PayrollPayslipDetail = {
  id: number;
  runId: number;
  employeeId: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  designationTitle: string | null;
  kraPin: string | null;
  nssfNumber: string | null;
  shifNumber: string | null;
  grossCents: string;
  netCents: string;
  payeCents: string;
  nssfEmployeeCents: string;
  shifCents: string;
  ahlEmployeeCents: string;
  otherDeductionsCents: string;
  periodName: string;
  payDate: string;
  runStatus: string;
  facilityName: string;
  breakdown: PayrollPayslipRow['breakdown'];
};

export type PayrollAccountSettings = {
  id: number;
  salaryExpenseAccountId: number;
  employerCostAccountId: number;
  netPayPayableAccountId: number;
  payePayableAccountId: number;
  nssfPayableAccountId: number;
  shifPayableAccountId: number;
  ahlPayableAccountId: number;
  otherDeductionsPayableAccountId: number | null;
};

const withFacility = (path: string, facilityId: number) =>
  `${API_BASE}${path}${path.includes('?') ? '&' : '?'}facilityId=${facilityId}`;

export const workforceClient = {
  /* ---------------- HR ---------------- */
  getWorkforceOverview: (facilityId: number) =>
    fetchJson<WorkforceOverview>(withFacility('/hr/overview', facilityId)),

  getHrDepartments: (facilityId: number) =>
    fetchJson<HrDepartmentRow[]>(withFacility('/hr/departments', facilityId)),
  createHrDepartment: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrDepartmentRow>(`${API_BASE}/hr/departments`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  updateHrDepartment: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<HrDepartmentRow>(`${API_BASE}/hr/departments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  getHrDesignations: (facilityId: number) =>
    fetchJson<HrDesignationRow[]>(withFacility('/hr/designations', facilityId)),
  createHrDesignation: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrDesignationRow>(`${API_BASE}/hr/designations`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  getHrEmployees: (
    facilityId: number,
    options: { search?: string; status?: string; departmentId?: number } = {},
  ) => {
    const params = new URLSearchParams({ facilityId: String(facilityId) });
    if (options.search) params.set('search', options.search);
    if (options.status) params.set('status', options.status);
    if (options.departmentId) params.set('departmentId', String(options.departmentId));
    return fetchJson<HrEmployeeRow[]>(`${API_BASE}/hr/employees?${params}`);
  },
  getHrEmployee: (facilityId: number, id: number) =>
    fetchJson<Record<string, unknown>>(withFacility(`/hr/employees/${id}`, facilityId)),
  createHrEmployee: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrEmployeeRow>(`${API_BASE}/hr/employees`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  updateHrEmployee: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<HrEmployeeRow>(`${API_BASE}/hr/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  changeHrEmployeeStatus: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<HrEmployeeRow>(`${API_BASE}/hr/employees/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  addHrEmployeeDocument: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${API_BASE}/hr/employees/${id}/documents`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  getHrShifts: (facilityId: number) => fetchJson<HrShift[]>(withFacility('/hr/shifts', facilityId)),
  createHrShift: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrShift>(`${API_BASE}/hr/shifts`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getHrAttendance: (facilityId: number, date: string) =>
    fetchJson<HrAttendanceDay>(
      withFacility(`/hr/attendance?date=${encodeURIComponent(date)}`, facilityId),
    ),
  recordHrAttendance: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${API_BASE}/hr/attendance`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getHrRoster: (facilityId: number, from: string, to: string) =>
    fetchJson<HrRosterEntry[]>(
      withFacility(
        `/hr/roster?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        facilityId,
      ),
    ),
  saveHrRoster: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrRosterEntry>(`${API_BASE}/hr/roster`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  getHrLeaveTypes: (facilityId: number) =>
    fetchJson<HrLeaveType[]>(withFacility('/hr/leave-types', facilityId)),
  createHrLeaveType: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrLeaveType>(`${API_BASE}/hr/leave-types`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  getHrLeaveRequests: (facilityId: number, status?: string) =>
    fetchJson<HrLeaveRequest[]>(
      withFacility(
        `/hr/leave-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`,
        facilityId,
      ),
    ),
  createHrLeaveRequest: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<HrLeaveRequest>(`${API_BASE}/hr/leave-requests`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  decideHrLeaveRequest: (facilityId: number, id: number, body: Record<string, unknown>) =>
    fetchJson<HrLeaveRequest>(`${API_BASE}/hr/leave-requests/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  /* ---------------- PAYROLL ---------------- */
  getPayrollStatutoryVersions: (facilityId: number) =>
    fetchJson<PayrollStatutoryVersion[]>(withFacility('/payroll/statutory-versions', facilityId)),
  createPayrollStatutoryVersion: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<PayrollStatutoryVersion>(`${API_BASE}/payroll/statutory-versions`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  setPayrollStatutoryVersionStatus: (facilityId: number, id: number, status: string) =>
    fetchJson<PayrollStatutoryVersion>(`${API_BASE}/payroll/statutory-versions/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, facilityId }),
    }),

  getPayrollAccountSettings: (facilityId: number) =>
    fetchJson<PayrollAccountSettings | null>(withFacility('/payroll/account-settings', facilityId)),
  savePayrollAccountSettings: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<PayrollAccountSettings>(`${API_BASE}/payroll/account-settings`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  getPayrollPeriods: (facilityId: number) =>
    fetchJson<PayrollPeriod[]>(withFacility('/payroll/periods', facilityId)),
  createPayrollPeriod: (facilityId: number, body: Record<string, unknown>) =>
    fetchJson<PayrollPeriod>(`${API_BASE}/payroll/periods`, {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),
  calculatePayrollPeriod: (facilityId: number, periodId: number) =>
    fetchJson<{
      runId: number;
      status: string;
      employeeCount: number;
      totals: Record<string, string | number>;
      versions: Record<
        string,
        { id: number; label: string; effectiveFrom: string; authority: string }
      >;
    }>(`${API_BASE}/payroll/periods/${periodId}/calculate`, {
      method: 'POST',
      body: JSON.stringify({ facilityId }),
    }),
  getPayrollRun: (facilityId: number, runId: number) =>
    fetchJson<PayrollRunDetail>(withFacility(`/payroll/runs/${runId}`, facilityId)),
  approvePayrollRun: (facilityId: number, runId: number) =>
    fetchJson<PayrollRunSummary>(`${API_BASE}/payroll/runs/${runId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ facilityId }),
    }),
  postPayrollRun: (facilityId: number, runId: number) =>
    fetchJson<{
      runId: number;
      status: string;
      journalEntryId: number;
      journalNumber: string;
      idempotentReplay: boolean;
      debitTotalCents: string;
      creditTotalCents: string;
    }>(`${API_BASE}/payroll/runs/${runId}/post`, {
      method: 'POST',
      body: JSON.stringify({ facilityId }),
    }),
  getPayrollPayslip: (facilityId: number, payslipId: number) =>
    fetchJson<PayrollPayslipDetail>(withFacility(`/payroll/payslips/${payslipId}`, facilityId)),
};
