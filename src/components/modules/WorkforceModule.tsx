import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  UserPlus,
  Clock,
  CalendarDays,
  Briefcase,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  FileText,
  Building2,
  Pencil,
} from 'lucide-react';

import { api, ApiError } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { PrimaryButton, SecondaryButton, SearchBar, Tabs } from '../ui/controls.tsx';
import {
  AlertBanner,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { DataTable, FilterToolbar, PageHeader, StatCard } from '../ui/layout.tsx';
import { formatCents } from '../../billing/settlement.ts';

type Overview = {
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

type Department = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  activeEmployees: number;
};
type Designation = {
  id: number;
  title: string;
  grade: string | null;
  departmentId: number | null;
  departmentName: string | null;
  isActive: boolean;
};
type Employee = {
  id: number;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  departmentId: number | null;
  departmentName: string | null;
  designationId: number | null;
  designationTitle: string | null;
  employmentType: string;
  employmentStatus: string;
  hireDate: string;
  baseSalaryCents: string;
  phone: string | null;
  email: string | null;
  kraPin: string | null;
  nssfNumber: string | null;
  shifNumber: string | null;
};
type AttendanceRow = {
  employeeId: number;
  employeeNumber: string;
  name: string;
  departmentName: string | null;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  hours: string | null;
};
type AttendanceDay = {
  date: string;
  summary: { expected: number; recorded: number; present: number; absent: number };
  rows: AttendanceRow[];
};
type LeaveType = {
  id: number;
  code: string;
  name: string;
  annualEntitlementDays: string;
  isActive: boolean;
};
type LeaveRequest = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  status: string;
  decisionNote: string | null;
};
type Shift = { id: number; name: string; startTime: string; endTime: string; isActive: boolean };
type RosterEntry = {
  id: number;
  employeeId: number;
  employeeName: string;
  workDate: string;
  shiftName: string;
  startTime: string;
  endTime: string;
};

/** Cents arrive from the API as strings; format them without losing precision. */
const kes = (value: unknown): string => {
  const cents = Number(value ?? 0);
  return Number.isFinite(cents) ? formatCents(cents) : '0.00';
};

function EmployeeStatus({ status }: { status: string | null }) {
  const tone =
    status === 'ACTIVE' || status === 'PRESENT' || status === 'APPROVED'
      ? 'success'
      : status === 'PENDING' || status === 'ON_LEAVE' || status === 'LEAVE'
        ? 'warning'
        : status === 'EXITED' ||
            status === 'REJECTED' ||
            status === 'ABSENT' ||
            status === 'SUSPENDED'
          ? 'error'
          : 'neutral';
  return <StatusBadge tone={tone}>{status ? status.replace(/_/g, ' ') : 'Not set'}</StatusBadge>;
}

const today = () => new Date().toISOString().slice(0, 10);
const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED'];

type TabId = 'employees' | 'organisation' | 'attendance' | 'leave';

export const WorkforceModule: React.FC = () => {
  const { authenticatedUser, currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const facilityId = currentFacility?.id ?? 0;
  const permissions = authenticatedUser?.permissions ?? [];
  const canManage = permissions.includes('hr.manage');
  const canApprove = permissions.includes('hr.approve');

  const [tab, setTab] = useState<TabId>('employees');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [attendance, setAttendance] = useState<AttendanceDay | null>(null);
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [employeeModal, setEmployeeModal] = useState<Employee | 'new' | null>(null);
  const [departmentModal, setDepartmentModal] = useState<Department | 'new' | null>(null);
  const [designationModal, setDesignationModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveTypeModal, setLeaveTypeModal] = useState(false);
  const [shiftModal, setShiftModal] = useState(false);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const loadCore = useCallback(async () => {
    setError(null);
    try {
      const [overviewData, employeesData, departmentsData, designationsData] = await Promise.all([
        api.getWorkforceOverview(facilityId),
        api.getHrEmployees(facilityId),
        api.getHrDepartments(facilityId),
        api.getHrDesignations(facilityId),
      ]);
      setOverview(overviewData as Overview);
      setEmployees(employeesData as unknown as Employee[]);
      setDepartments(departmentsData as unknown as Department[]);
      setDesignations(designationsData as unknown as Designation[]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Human resources records could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  const loadAttendance = useCallback(
    async (date: string) => {
      try {
        setAttendance((await api.getHrAttendance(facilityId, date)) as AttendanceDay);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Attendance could not be loaded.');
      }
    },
    [facilityId],
  );

  const loadLeave = useCallback(async () => {
    try {
      const [types, requests, shiftRows, rosterRows] = await Promise.all([
        api.getHrLeaveTypes(facilityId),
        api.getHrLeaveRequests(facilityId),
        api.getHrShifts(facilityId),
        api.getHrRoster(facilityId, today(), today()),
      ]);
      setLeaveTypes(types as unknown as LeaveType[]);
      setLeaveRequests(requests as unknown as LeaveRequest[]);
      setShifts(shiftRows as unknown as Shift[]);
      setRoster(rosterRows as unknown as RosterEntry[]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Leave and roster records could not be loaded.',
      );
    }
  }, [facilityId]);

  useEffect(() => {
    void loadCore();
  }, [loadCore, refreshKey]);

  useEffect(() => {
    if (tab === 'attendance') void loadAttendance(attendanceDate);
  }, [tab, attendanceDate, loadAttendance, refreshKey]);

  useEffect(() => {
    if (tab === 'leave') void loadLeave();
  }, [tab, loadLeave, refreshKey]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (statusFilter && employee.employmentStatus !== statusFilter) return false;
      if (departmentFilter && String(employee.departmentId ?? '') !== departmentFilter)
        return false;
      if (!term) return true;
      return [
        employee.firstName,
        employee.lastName,
        employee.employeeNumber,
        employee.phone ?? '',
        employee.designationTitle ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [employees, search, statusFilter, departmentFilter]);

  async function run(action: () => Promise<void>) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await action();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'The action could not be completed.', {
        tone: 'error',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function openDetail(employeeId: number) {
    try {
      setDetail(await api.getHrEmployee(facilityId, employeeId));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Employee record could not be loaded.', {
        tone: 'error',
      });
    }
  }

  if (loading) return <LoadingSkeleton />;
  if (error && employees.length === 0)
    return <ErrorState message={error} onRetry={() => void loadCore()} />;

  return (
    <div className="space-y-5">
      <PageHeader>
        <div>
          <h1 className="text-xl font-semibold text-ink">Human Resources</h1>
          <p className="mt-1 text-sm text-muted">
            Staff records, attendance, rosters and leave for{' '}
            {currentFacility?.name ?? 'this facility'}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <PrimaryButton onClick={() => setEmployeeModal('new')}>
              <UserPlus size={16} /> Register employee
            </PrimaryButton>
          )}
          <SecondaryButton onClick={() => void loadCore()}>
            <RefreshCw size={16} /> Refresh
          </SecondaryButton>
        </div>
      </PageHeader>

      {error && <AlertBanner tone="warning">{error}</AlertBanner>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active staff"
          value={
            overview?.activeEmployees ??
            employees.filter((e) => e.employmentStatus === 'ACTIVE').length
          }
          detail={`${overview?.headcount ?? employees.length} employee records`}
          icon={<Users size={18} />}
        />
        <StatCard
          label="On leave"
          value={overview?.onLeave ?? 0}
          detail={`${overview?.pendingLeave ?? 0} leave request(s) awaiting a decision`}
          icon={<CalendarDays size={18} />}
        />
        <StatCard
          label="Monthly basic payroll"
          value={`KES ${kes(overview?.monthlyBasicCents)}`}
          detail="Contracted basic salary of active staff"
          icon={<Briefcase size={18} />}
        />
        <StatCard
          label="Departments"
          value={overview?.departments ?? departments.length}
          detail={`${departments.filter((d) => d.isActive).length} active`}
          icon={<Building2 size={18} />}
        />
      </div>

      <Tabs
        label="Workforce sections"
        value={tab}
        onChange={(value) => setTab(value as TabId)}
        items={[
          { id: 'employees', label: 'Employees' },
          { id: 'organisation', label: 'Departments & roles' },
          { id: 'attendance', label: 'Attendance & roster' },
          { id: 'leave', label: 'Leave' },
        ]}
      />

      {tab === 'employees' && (
        <section className="space-y-3">
          <FilterToolbar>
            <SearchBar
              aria-label="Search employees"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, number or phone"
            />
            <select
              aria-label="Filter by status"
              className="ui-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              {EMPLOYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace('_', ' ')}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by department"
              className="ui-select"
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              {filteredEmployees.length} of {employees.length} shown
            </span>
          </FilterToolbar>

          {filteredEmployees.length === 0 ? (
            <EmptyState
              title="No employees match"
              description={
                employees.length === 0
                  ? 'Register the first employee to start attendance, leave and payroll.'
                  : 'Adjust the filters or search term.'
              }
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Number</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="text-right">Basic salary</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline"
                        onClick={() => void openDetail(employee.id)}
                      >
                        {employee.firstName} {employee.lastName}
                      </button>
                      <div className="text-xs text-muted">{employee.phone ?? '—'}</div>
                    </td>
                    <td className="font-mono text-xs">{employee.employeeNumber}</td>
                    <td>{employee.departmentName ?? '—'}</td>
                    <td>{employee.designationTitle ?? '—'}</td>
                    <td className="text-xs">{employee.employmentType}</td>
                    <td>
                      <EmployeeStatus status={employee.employmentStatus} />
                    </td>
                    <td className="text-right tabular-nums">KES {kes(employee.baseSalaryCents)}</td>
                    <td className="text-right">
                      {canManage && (
                        <SecondaryButton
                          aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                          onClick={() => setEmployeeModal(employee)}
                        >
                          <Pencil size={14} /> Edit
                        </SecondaryButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      )}

      {tab === 'organisation' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Departments</h2>
              {canManage && (
                <PrimaryButton onClick={() => setDepartmentModal('new')}>
                  <Building2 size={15} /> Add department
                </PrimaryButton>
              )}
            </div>
            {departments.length === 0 ? (
              <EmptyState
                title="No departments"
                description="Create departments before registering staff."
              />
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th className="text-right">Active staff</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {departments.map((department) => (
                    <tr key={department.id}>
                      <td className="font-mono text-xs">{department.code}</td>
                      <td>{department.name}</td>
                      <td className="text-right tabular-nums">{department.activeEmployees}</td>
                      <td>
                        <EmployeeStatus status={department.isActive ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="text-right">
                        {canManage && (
                          <SecondaryButton onClick={() => setDepartmentModal(department)}>
                            <Pencil size={14} />
                          </SecondaryButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Designations</h2>
              {canManage && (
                <PrimaryButton onClick={() => setDesignationModal(true)}>
                  <Briefcase size={15} /> Add designation
                </PrimaryButton>
              )}
            </div>
            {designations.length === 0 ? (
              <EmptyState
                title="No designations"
                description="Add job titles and grades for this facility."
              />
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Department</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {designations.map((designation) => (
                    <tr key={designation.id}>
                      <td>{designation.title}</td>
                      <td>{designation.departmentName ?? '—'}</td>
                      <td>{designation.grade ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <section className="space-y-3">
            <FilterToolbar>
              <label className="text-xs font-medium text-muted" htmlFor="attendance-date">
                Work date
              </label>
              <input
                id="attendance-date"
                type="date"
                className="ui-input"
                value={attendanceDate}
                onChange={(event) => setAttendanceDate(event.target.value)}
              />
              <span className="text-xs text-muted">
                {attendance?.summary.present ?? 0} present · {attendance?.summary.absent ?? 0}{' '}
                absent · {attendance?.summary.recorded ?? 0}/{attendance?.summary.expected ?? 0}{' '}
                recorded
              </span>
            </FilterToolbar>
            {!attendance?.rows.length ? (
              <EmptyState
                title="No employees to show"
                description="Register staff to record attendance."
              />
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>In</th>
                    <th>Out</th>
                    {canManage && <th aria-label="Record" />}
                  </tr>
                </thead>
                <tbody>
                  {attendance.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        {row.name}
                        <div className="text-xs text-muted">{row.employeeNumber}</div>
                      </td>
                      <td>{row.departmentName ?? '—'}</td>
                      <td>
                        {row.status ? (
                          <EmployeeStatus status={row.status} />
                        ) : (
                          <span className="text-xs text-muted">Not recorded</span>
                        )}
                      </td>
                      <td className="tabular-nums">{row.checkIn ?? '—'}</td>
                      <td className="tabular-nums">{row.checkOut ?? '—'}</td>
                      {canManage && (
                        <td className="text-right">
                          <AttendanceEditor
                            facilityId={facilityId}
                            employeeId={row.employeeId}
                            date={attendanceDate}
                            onSaved={() => {
                              void loadAttendance(attendanceDate);
                              triggerRefresh();
                            }}
                            onError={(message) => showToast(message, { tone: 'error' })}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Shifts & today&apos;s roster</h2>
              {canManage && (
                <SecondaryButton onClick={() => setShiftModal(true)}>
                  <Clock size={15} /> New shift
                </SecondaryButton>
              )}
            </div>
            {shifts.length === 0 ? (
              <EmptyState
                title="No shifts defined"
                description="Define shift times before building a roster."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {shifts.map((shift) => (
                  <li
                    key={shift.id}
                    className="flex items-center justify-between rounded-lg border border-hair px-3 py-2"
                  >
                    <span className="font-medium">{shift.name}</span>
                    <span className="tabular-nums text-muted">
                      {shift.startTime}–{shift.endTime}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="rounded-lg border border-hair p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Rostered today
              </p>
              {roster.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nobody is rostered for today.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {roster.map((entry) => (
                    <li key={entry.id} className="flex justify-between">
                      <span>{entry.employeeName}</span>
                      <span className="text-muted">{entry.shiftName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'leave' && (
        <div className="space-y-5">
          <FilterToolbar>
            <h2 className="text-sm font-semibold">Leave requests</h2>
            <div className="ml-auto flex gap-2">
              {canManage && (
                <PrimaryButton onClick={() => setLeaveModal(true)}>
                  <CalendarDays size={15} /> Request leave
                </PrimaryButton>
              )}
              {canManage && (
                <SecondaryButton onClick={() => setLeaveTypeModal(true)}>
                  <FileText size={15} /> Leave type
                </SecondaryButton>
              )}
            </div>
          </FilterToolbar>

          {leaveRequests.length === 0 ? (
            <EmptyState
              title="No leave requests"
              description={
                leaveTypes.length === 0
                  ? 'Create a leave type first, then record a request.'
                  : 'Recorded requests will appear here for approval.'
              }
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th className="text-right">Days</th>
                  <th>Status</th>
                  <th>Decision</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {leaveRequests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      {request.employeeName}
                      <div className="text-xs text-muted">{request.employeeNumber}</div>
                    </td>
                    <td>{request.leaveTypeName}</td>
                    <td className="text-xs tabular-nums">
                      {request.startDate} → {request.endDate}
                    </td>
                    <td className="text-right tabular-nums">{Number(request.days).toFixed(2)}</td>
                    <td>
                      <EmployeeStatus status={request.status} />
                    </td>
                    <td className="max-w-[14rem] truncate text-xs text-muted">
                      {request.decisionNote ?? '—'}
                    </td>
                    <td className="text-right">
                      {canApprove && request.status === 'PENDING' && (
                        <div className="flex justify-end gap-1">
                          <SecondaryButton
                            disabled={saving}
                            onClick={() =>
                              void run(async () => {
                                await api.decideHrLeaveRequest(facilityId, request.id, {
                                  decision: 'APPROVED',
                                });
                                showToast('Leave approved.', { tone: 'success' });
                                await loadLeave();
                                await loadCore();
                              })
                            }
                          >
                            <CheckCircle2 size={14} /> Approve
                          </SecondaryButton>
                          <SecondaryButton
                            disabled={saving}
                            onClick={() =>
                              void run(async () => {
                                await api.decideHrLeaveRequest(facilityId, request.id, {
                                  decision: 'REJECTED',
                                });
                                showToast('Leave rejected.', { tone: 'success' });
                                await loadLeave();
                              })
                            }
                          >
                            <XCircle size={14} /> Reject
                          </SecondaryButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}

          {leaveTypes.length > 0 && (
            <p className="text-xs text-muted">
              Leave types:{' '}
              {leaveTypes
                .map((type) => `${type.code} (${Number(type.annualEntitlementDays)}d)`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}

      {employeeModal && (
        <EmployeeDialog
          employee={employeeModal === 'new' ? null : employeeModal}
          departments={departments}
          designations={designations}
          saving={saving}
          onClose={() => setEmployeeModal(null)}
          onSubmit={(payload) =>
            run(async () => {
              if (employeeModal === 'new') {
                await api.createHrEmployee(facilityId, payload);
                showToast('Employee registered.', { tone: 'success' });
              } else {
                await api.updateHrEmployee(facilityId, employeeModal.id, payload);
                showToast('Employee updated.', { tone: 'success' });
              }
              setEmployeeModal(null);
              await loadCore();
              triggerRefresh();
            })
          }
        />
      )}

      {departmentModal && (
        <DepartmentDialog
          department={departmentModal === 'new' ? null : departmentModal}
          saving={saving}
          onClose={() => setDepartmentModal(null)}
          onSubmit={(payload) =>
            run(async () => {
              if (departmentModal === 'new') {
                await api.createHrDepartment(facilityId, payload);
                showToast('Department created.', { tone: 'success' });
              } else {
                await api.updateHrDepartment(facilityId, departmentModal.id, payload);
                showToast('Department updated.', { tone: 'success' });
              }
              setDepartmentModal(null);
              await loadCore();
            })
          }
        />
      )}

      {designationModal && (
        <SimpleFormDialog
          title="New designation"
          saving={saving}
          onClose={() => setDesignationModal(false)}
          onSubmit={(payload) =>
            run(async () => {
              await api.createHrDesignation(facilityId, payload);
              showToast('Designation created.', { tone: 'success' });
              setDesignationModal(false);
              await loadCore();
            })
          }
          fields={[
            { name: 'title', label: 'Job title', required: true },
            {
              name: 'departmentId',
              label: 'Department',
              options: departments.map((department) => ({
                value: String(department.id),
                label: department.name,
              })),
            },
            { name: 'grade', label: 'Grade' },
          ]}
        />
      )}

      {leaveModal && (
        <SimpleFormDialog
          title="Request leave"
          saving={saving}
          onClose={() => setLeaveModal(false)}
          onSubmit={(payload) =>
            run(async () => {
              await api.createHrLeaveRequest(facilityId, payload);
              showToast('Leave request recorded.', { tone: 'success' });
              setLeaveModal(false);
              await loadLeave();
            })
          }
          fields={[
            {
              name: 'employeeId',
              label: 'Employee',
              type: 'select',
              required: true,
              options: employees.map((employee) => ({
                value: String(employee.id),
                label: `${employee.firstName} ${employee.lastName} (${employee.employeeNumber})`,
              })),
            },
            {
              name: 'leaveTypeId',
              label: 'Leave type',
              type: 'select',
              required: true,
              options: leaveTypes.map((type) => ({ value: String(type.id), label: type.name })),
            },
            { name: 'startDate', label: 'Start date', type: 'date', required: true },
            { name: 'endDate', label: 'End date', type: 'date', required: true },
            { name: 'days', label: 'Days', type: 'number', required: true, step: '0.5' },
            { name: 'reason', label: 'Reason', type: 'textarea' },
          ]}
        />
      )}

      {leaveTypeModal && (
        <SimpleFormDialog
          title="New leave type"
          saving={saving}
          onClose={() => setLeaveTypeModal(false)}
          onSubmit={(payload) =>
            run(async () => {
              await api.createHrLeaveType(facilityId, payload);
              showToast('Leave type created.', { tone: 'success' });
              setLeaveTypeModal(false);
              await loadLeave();
            })
          }
          fields={[
            { name: 'code', label: 'Code (e.g. ANNUAL)', required: true },
            { name: 'name', label: 'Name', required: true },
            {
              name: 'annualEntitlementDays',
              label: 'Annual entitlement (days)',
              type: 'number',
              step: '0.5',
            },
          ]}
        />
      )}

      {shiftModal && (
        <SimpleFormDialog
          title="New shift"
          saving={saving}
          onClose={() => setShiftModal(false)}
          onSubmit={(payload) =>
            run(async () => {
              await api.createHrShift(facilityId, payload);
              showToast('Shift created.', { tone: 'success' });
              setShiftModal(false);
              await loadLeave();
            })
          }
          fields={[
            { name: 'name', label: 'Shift name', required: true },
            { name: 'startTime', label: 'Start time', type: 'time', required: true },
            { name: 'endTime', label: 'End time', type: 'time', required: true },
          ]}
        />
      )}

      {detail && (
        <Modal open onClose={() => setDetail(null)} title="Employee record">
          <EmployeeDetail detail={detail} onClose={() => setDetail(null)} />
        </Modal>
      )}
    </div>
  );
};

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

function AttendanceEditor({
  facilityId,
  employeeId,
  date,
  onSaved,
  onError,
}: {
  facilityId: number;
  employeeId: number;
  date: string;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState('PRESENT');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-end gap-1">
      <select
        aria-label="Attendance status"
        className="ui-select text-xs"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        {['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'OFF_DUTY', 'TRAINING'].map((value) => (
          <option key={value} value={value}>
            {value.replace('_', ' ')}
          </option>
        ))}
      </select>
      <SecondaryButton
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.recordHrAttendance(facilityId, { employeeId, workDate: date, status });
            onSaved();
          } catch (err) {
            onError(err instanceof ApiError ? err.message : 'Attendance could not be recorded.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </SecondaryButton>
    </div>
  );
}

function EmployeeDialog({
  employee,
  departments,
  designations,
  saving,
  onClose,
  onSubmit,
}: {
  employee: Employee | null;
  departments: Department[];
  designations: Designation[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    employeeNumber: employee?.employeeNumber ?? '',
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    departmentId: employee?.departmentId ? String(employee.departmentId) : '',
    designationId: employee?.designationId ? String(employee.designationId) : '',
    employmentType: employee?.employmentType ?? 'PERMANENT',
    hireDate: employee?.hireDate ?? today(),
    baseSalary: employee ? (Number(employee.baseSalaryCents) / 100).toFixed(2) : '',
    kraPin: employee?.kraPin ?? '',
    nssfNumber: employee?.nssfNumber ?? '',
    shifNumber: employee?.shifNumber ?? '',
  });

  const set =
    (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const salaryCents = useMemo(() => {
    const value = Number(form.baseSalary);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }, [form.baseSalary]);

  return (
    <Modal open onClose={onClose} title={employee ? 'Edit employee' : 'Register employee'}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (salaryCents === null) return;
          onSubmit({
            ...form,
            departmentId: form.departmentId || null,
            designationId: form.designationId || null,
            baseSalaryCents: salaryCents,
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormInput
            label="Employee number"
            required
            value={form.employeeNumber}
            onChange={set('employeeNumber')}
          />
          <FormInput
            label="Hire date"
            type="date"
            required
            value={form.hireDate}
            onChange={set('hireDate')}
          />
          <FormInput
            label="First name"
            required
            value={form.firstName}
            onChange={set('firstName')}
          />
          <FormInput label="Last name" required value={form.lastName} onChange={set('lastName')} />
          <FormInput label="Phone" value={form.phone} onChange={set('phone')} />
          <FormInput label="Email" type="email" value={form.email} onChange={set('email')} />
          <label className="ui-field">
            <span>Department</span>
            <select className="ui-select" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">Unassigned</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span>Designation</span>
            <select
              className="ui-select"
              value={form.designationId}
              onChange={set('designationId')}
            >
              <option value="">Unassigned</option>
              {designations.map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.title}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span>Employment type</span>
            <select
              className="ui-select"
              value={form.employmentType}
              onChange={set('employmentType')}
            >
              {['PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN', 'LOCUM'].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <FormInput
            label="Monthly basic salary (KES)"
            type="number"
            step="0.01"
            value={form.baseSalary}
            onChange={set('baseSalary')}
          />
          <FormInput label="KRA PIN" value={form.kraPin} onChange={set('kraPin')} />
          <FormInput label="NSSF number" value={form.nssfNumber} onChange={set('nssfNumber')} />
          <FormInput label="SHIF number" value={form.shifNumber} onChange={set('shifNumber')} />
        </div>
        <p className="text-xs text-muted">
          Salary is recorded as contracted basic pay. Statutory deductions are calculated from the
          facility&apos;s effective-dated rules, not from this form.
        </p>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || salaryCents === null}>
            {saving ? 'Saving…' : employee ? 'Save changes' : 'Register employee'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function DepartmentDialog({
  department,
  saving,
  onClose,
  onSubmit,
}: {
  department: Department | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState(department?.code ?? '');
  const [name, setName] = useState(department?.name ?? '');
  return (
    <Modal open onClose={onClose} title={department ? 'Edit department' : 'New department'}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ code: code.toUpperCase(), name, isActive: true });
        }}
      >
        <FormInput
          label="Code"
          required
          value={code}
          disabled={Boolean(department)}
          onChange={(event) => setCode(event.target.value)}
        />
        <FormInput
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

type FieldSpec = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'time' | 'textarea' | 'select';
  required?: boolean;
  step?: string;
  options?: Array<{ value: string; label: string }>;
};

function SimpleFormDialog({
  title,
  fields,
  saving,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: FieldSpec[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const initial = useMemo(
    () =>
      Object.fromEntries(fields.map((field) => [field.name, field.type === 'date' ? today() : ''])),
    [fields],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  return (
    <Modal open onClose={onClose} title={title}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const payload: Record<string, unknown> = {};
          for (const field of fields) {
            const value = values[field.name] ?? '';
            if (value !== '') payload[field.name] = field.type === 'number' ? Number(value) : value;
          }
          onSubmit(payload);
        }}
      >
        {fields.map((field) => (
          <label className="ui-field" key={field.name}>
            <span>
              {field.label}
              {field.required ? ' *' : ''}
            </span>
            {field.type === 'select' ? (
              <select
                className="ui-select"
                required={field.required}
                value={values[field.name] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              >
                <option value="">Select…</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                className="ui-input"
                rows={3}
                value={values[field.name] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
            ) : (
              <input
                className="ui-input"
                type={field.type ?? 'text'}
                step={field.step}
                required={field.required}
                value={values[field.name] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
            )}
          </label>
        ))}
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function FormInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="ui-field">
      <span>
        {label}
        {props.required ? ' *' : ''}
      </span>
      <input className="ui-input" {...props} />
    </label>
  );
}

function EmployeeDetail({
  detail,
  onClose,
}: {
  detail: Record<string, unknown>;
  onClose: () => void;
}) {
  const documents = (detail.documents as Array<Record<string, unknown>>) ?? [];
  const components = (detail.components as Array<Record<string, unknown>>) ?? [];
  const payslips = (detail.payslips as Array<Record<string, unknown>>) ?? [];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-base font-semibold">
          {String(detail.firstName)} {String(detail.lastName)}
        </p>
        <p className="text-xs text-muted">
          {String(detail.employeeNumber)} · {String(detail.departmentName ?? 'Unassigned')} ·{' '}
          {String(detail.designationTitle ?? 'No designation')}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">Status</dt>
          <dd>{String(detail.employmentStatus)}</dd>
        </div>
        <div>
          <dt className="text-muted">Hired</dt>
          <dd>{String(detail.hireDate)}</dd>
        </div>
        <div>
          <dt className="text-muted">Monthly basic</dt>
          <dd>KES {kes(detail.baseSalaryCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">KRA PIN</dt>
          <dd>{String(detail.kraPin ?? '—')}</dd>
        </div>
      </dl>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Pay components</h3>
        {components.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No recurring allowance or deduction recorded.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {components.map((component) => (
              <li key={String(component.id)} className="flex justify-between">
                <span>
                  {String(component.name)} ({String(component.kind)})
                </span>
                <span>KES {kes(component.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Documents</h3>
        {documents.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No document reference recorded.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {documents.map((document) => (
              <li key={String(document.id)} className="flex justify-between">
                <span>{String(document.title)}</span>
                <span className="text-muted">{String(document.documentType)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Recent payslips
        </h3>
        {payslips.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            No payslip has been calculated for this employee.
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {payslips.map((slip) => (
              <li key={String(slip.id)} className="flex justify-between">
                <span>
                  {String(slip.periodName)} ({String(slip.runStatus)})
                </span>
                <span>KES {kes(slip.netCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex justify-end">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </div>
  );
}
