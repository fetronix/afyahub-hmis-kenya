import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { FormField, PrimaryButton, SecondaryButton, SearchBar, Tabs } from '../ui/controls.tsx';
import { SearchableSelect } from '../ui/searchable-select.tsx';
import {
  AlertBanner,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { DataTable, FilterToolbar, PageHeader, StatCard } from '../ui/layout.tsx';
import { AttendanceRosterTab } from './hr/AttendanceRoster.tsx';
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
  description?: string | null;
  isActive: boolean;
  activeEmployees: number;
  designations?: number;
  activeDesignations?: number;
};
type Designation = {
  id: number;
  title: string;
  description?: string | null;
  grade: string | null;
  departmentId: number | null;
  departmentName: string | null;
  departmentIsActive?: boolean | null;
  isActive: boolean;
  activeEmployees?: number;
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

/** Cents arrive from the API as strings; format them without losing precision. */
const kes = (value: unknown): string => {
  if (value === null) return 'Restricted';
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
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [designationDepartmentFilter, setDesignationDepartmentFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [employeeModal, setEmployeeModal] = useState<Employee | 'new' | null>(null);
  const [departmentModal, setDepartmentModal] = useState<Department | 'new' | null>(null);
  const [designationModal, setDesignationModal] = useState<Designation | 'new' | null>(null);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveTypeModal, setLeaveTypeModal] = useState(false);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const loadDepartments = useCallback(async () => {
    setDepartmentsLoading(true);
    try {
      const rows = await api.getHrDepartments(facilityId);
      setDepartments(rows as unknown as Department[]);
      setDepartmentsError(null);
    } catch (err) {
      setDepartments([]);
      setDepartmentsError(
        err instanceof ApiError ? err.message : 'Departments could not be loaded.',
      );
    } finally {
      setDepartmentsLoading(false);
    }
  }, [facilityId]);

  const loadCore = useCallback(async () => {
    setError(null);
    try {
      const [overviewData, employeesData, designationsData] = await Promise.all([
        api.getWorkforceOverview(facilityId),
        api.getHrEmployees(facilityId),
        api.getHrDesignations(facilityId),
      ]);
      setOverview(overviewData as Overview);
      setEmployees(employeesData as unknown as Employee[]);
      setDesignations(designationsData as unknown as Designation[]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Human resources records could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
    /* Loaded on its own so a department failure does not hide the rest of the module. */
    await loadDepartments();
  }, [facilityId, loadDepartments]);

  const loadLeave = useCallback(async () => {
    try {
      const [types, requests] = await Promise.all([
        api.getHrLeaveTypes(facilityId),
        api.getHrLeaveRequests(facilityId),
      ]);
      setLeaveTypes(types as unknown as LeaveType[]);
      setLeaveRequests(requests as unknown as LeaveRequest[]);
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
    if (tab === 'leave') void loadLeave();
  }, [tab, loadLeave, refreshKey]);

  const visibleDesignations = useMemo(() => {
    if (!designationDepartmentFilter) return designations;
    if (designationDepartmentFilter === 'UNASSIGNED')
      return designations.filter((designation) => designation.departmentId === null);
    return designations.filter(
      (designation) => String(designation.departmentId ?? '') === designationDepartmentFilter,
    );
  }, [designations, designationDepartmentFilter]);

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
            <DataTable className="table-quiet">
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
            {departmentsError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
                <p className="font-semibold">Departments could not be loaded.</p>
                <p className="mt-1">{departmentsError}</p>
                <SecondaryButton className="mt-2" onClick={() => void loadDepartments()}>
                  Try again
                </SecondaryButton>
              </div>
            ) : departmentsLoading && departments.length === 0 ? (
              <LoadingSkeleton />
            ) : departments.length === 0 ? (
              <EmptyState
                title="No departments"
                description="Create departments before registering staff or designations."
              />
            ) : (
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th className="text-right">Designations</th>
                    <th className="text-right">Active staff</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {departments.map((department) => (
                    <tr key={department.id}>
                      <td className="font-mono text-xs">{department.code}</td>
                      <td>
                        <div className="min-w-0">
                          <p className="truncate">{department.name}</p>
                          {department.description ? (
                            <p className="truncate text-xs text-muted">{department.description}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">
                        {department.designations ?? 0}
                        {department.designations && department.activeDesignations !== undefined && department.activeDesignations !== department.designations ? (
                          <span className="text-xs text-muted"> ({department.activeDesignations} active)</span>
                        ) : null}
                      </td>
                      <td className="text-right tabular-nums">{department.activeEmployees}</td>
                      <td>
                        <EmployeeStatus status={department.isActive ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="text-right">
                        {canManage && (
                          <SecondaryButton
                            aria-label={`Edit ${department.name}`}
                            onClick={() => setDepartmentModal(department)}
                          >
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Designations</h2>
              {canManage && (
                <PrimaryButton onClick={() => setDesignationModal('new')}>
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
              <>
                <FilterToolbar>
                  <label className="text-xs font-medium text-muted" htmlFor="designation-department-filter">
                    Department
                  </label>
                  <select
                    id="designation-department-filter"
                    className="ui-select max-w-56"
                    value={designationDepartmentFilter}
                    onChange={(event) => setDesignationDepartmentFilter(event.target.value)}
                  >
                    <option value="">All departments</option>
                    <option value="UNASSIGNED">No department recorded</option>
                    {departments.map((department) => (
                      <option key={department.id} value={String(department.id)}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">
                    {visibleDesignations.length} of {designations.length} shown
                  </span>
                </FilterToolbar>
                {visibleDesignations.length === 0 ? (
                  <EmptyState
                    title="No designations in this department"
                    description="Choose another department, or add a designation to this one."
                  />
                ) : (
                  <DataTable className="table-quiet">
                    <thead>
                      <tr>
                        <th>Designation</th>
                        <th>Department</th>
                        <th className="text-right">Staff</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDesignations.map((designation) => (
                        <tr key={designation.id}>
                          <td>
                            <div className="min-w-0">
                              <p className="truncate">{designation.title}</p>
                              {designation.description ? (
                                <p className="truncate text-xs text-muted">
                                  {designation.description}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {designation.departmentName ?? (
                              <span className="text-amber-700">No department</span>
                            )}
                            {designation.grade ? (
                              <span className="ml-1 text-xs text-muted">· {designation.grade}</span>
                            ) : null}
                          </td>
                          <td className="text-right tabular-nums">
                            {designation.activeEmployees ?? 0}
                          </td>
                          <td>
                            <EmployeeStatus status={designation.isActive ? 'ACTIVE' : 'INACTIVE'} />
                          </td>
                          <td className="text-right">
                            {canManage && (
                              <SecondaryButton
                                aria-label={`Edit ${designation.title}`}
                                onClick={() => setDesignationModal(designation)}
                              >
                                <Pencil size={14} />
                              </SecondaryButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'attendance' && (
        <AttendanceRosterTab
          facilityId={facilityId}
          canManage={canManage}
          employees={employees}
          departments={departments}
        />
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
            <DataTable className="table-quiet">
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
        <DesignationDialog
          designation={designationModal === 'new' ? null : designationModal}
          departments={departments}
          departmentsLoading={departmentsLoading}
          departmentsError={departmentsError}
          saving={saving}
          onReloadDepartments={() => void loadDepartments()}
          onCreateDepartment={() => {
            setDesignationModal(null);
            setDepartmentModal('new');
          }}
          onClose={() => setDesignationModal(null)}
          onSubmit={(payload) =>
            run(async () => {
              const editing = designationModal === 'new' ? null : designationModal;
              if (editing) {
                await api.updateHrDesignation(facilityId, editing.id, payload);
                showToast('Designation updated.', { tone: 'success' });
              } else {
                await api.createHrDesignation(facilityId, payload);
                showToast('Designation created.', { tone: 'success' });
              }
              setDesignationModal(null);
              await loadCore();
            })
          }
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
  const { authenticatedUser } = useHmis();
  const canSetSalary = authenticatedUser?.permissions?.includes('payroll.manage');
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

  /*
   * A designation only makes sense inside the department that owns it, so the
   * list is scoped to the chosen department. An inactive designation already on
   * this employee stays visible (marked) so an unrelated edit does not silently
   * clear it; choosing a different one still has to be active.
   */
  const eligibleDesignations = useMemo(
    () =>
      form.departmentId
        ? designations.filter(
            (designation) =>
              String(designation.departmentId ?? '') === form.departmentId &&
              (designation.isActive || String(designation.id) === form.designationId),
          )
        : [],
    [designations, form.departmentId, form.designationId],
  );

  const onDepartmentChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const departmentId = event.target.value;
    setForm((current) => {
      const keepsDesignation =
        current.designationId !== '' &&
        designations.some(
          (designation) =>
            String(designation.id) === current.designationId &&
            String(designation.departmentId ?? '') === departmentId,
        );
      return {
        ...current,
        departmentId,
        designationId: keepsDesignation ? current.designationId : '',
      };
    });
  };

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
            ...(canSetSalary ? { baseSalaryCents: salaryCents } : {}),
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
            <select
              className="ui-select"
              value={form.departmentId}
              onChange={onDepartmentChange}
              aria-describedby="employee-designation-hint"
            >
              <option value="">Unassigned</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.isActive ? department.name : `${department.name} (inactive)`}
                </option>
              ))}
            </select>
          </label>
          <div className="ui-field">
            {/* The hint sits beside the label, not inside it, so the select's
                accessible name stays "Designation". */}
            <label htmlFor="employee-designation">Designation</label>
            <select
              id="employee-designation"
              className="ui-select"
              value={form.designationId}
              onChange={set('designationId')}
              disabled={!form.departmentId}
              aria-describedby="employee-designation-hint"
            >
              <option value="">
                {form.departmentId ? 'Unassigned' : 'Choose a department first'}
              </option>
              {eligibleDesignations.map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.isActive ? designation.title : `${designation.title} (inactive)`}
                </option>
              ))}
            </select>
            <small id="employee-designation-hint" className="ui-field-hint">
              {!form.departmentId
                ? 'The designation list is limited to the employee’s department.'
                : eligibleDesignations.length === 0
                  ? 'No designations are recorded for this department yet.'
                  : 'Only designations belonging to this department are listed.'}
            </small>
          </div>
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
          {canSetSalary && (
            <FormInput
              label="Monthly basic salary (KES)"
              type="number"
              step="0.01"
              value={form.baseSalary}
              onChange={set('baseSalary')}
            />
          )}
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
  const [description, setDescription] = useState(department?.description ?? '');
  const [isActive, setIsActive] = useState(department?.isActive ?? true);
  const idPrefix = useId().replace(/[:]/g, '');

  return (
    <Modal open onClose={onClose} title={department ? 'Edit department' : 'New department'}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            code: code.toUpperCase(),
            name: name.trim(),
            description: description.trim() || null,
            /*
             * The previous form hard-coded isActive: true, so saving an edit
             * silently reactivated a department that had been switched off.
             */
            isActive,
          });
        }}
      >
        <FormField label="Code" htmlFor={`dept-code-${idPrefix}`} hint="2–24 characters: A–Z, 0–9, dash or underscore. Fixed once created.">
          <input
            id={`dept-code-${idPrefix}`}
            className="ui-input"
            required
            value={code}
            disabled={Boolean(department)}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <FormField label="Name" htmlFor={`dept-name-${idPrefix}`}>
          <input
            id={`dept-name-${idPrefix}`}
            className="ui-input"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField
          label="Description"
          htmlFor={`dept-description-${idPrefix}`}
          hint="Optional. Shown beside the department in the HR module."
        >
          <textarea
            id={`dept-description-${idPrefix}`}
            className="ui-input"
            rows={3}
            maxLength={500}
            value={description ?? ''}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          Active — offered when recording staff and designations
        </label>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || !name.trim() || !code.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Create or edit a designation. The department is a required, searchable list of
 * departments that already exist for this facility; the value stored is the
 * department's database id. When there are no departments, when they are still
 * loading and when they fail to load, the field says which of those it is and
 * offers the next step, rather than showing an empty box.
 */
function DesignationDialog({
  designation,
  departments,
  departmentsLoading,
  departmentsError,
  saving,
  onReloadDepartments,
  onCreateDepartment,
  onClose,
  onSubmit,
}: {
  designation: Designation | null;
  departments: Department[];
  departmentsLoading: boolean;
  departmentsError: string | null;
  saving: boolean;
  onReloadDepartments: () => void;
  onCreateDepartment: () => void;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(designation?.title ?? '');
  const [departmentId, setDepartmentId] = useState(
    designation?.departmentId ? String(designation.departmentId) : '',
  );
  const [description, setDescription] = useState(designation?.description ?? '');
  const [grade, setGrade] = useState(designation?.grade ?? '');
  const [isActive, setIsActive] = useState(designation?.isActive ?? true);
  const [touched, setTouched] = useState(false);
  const idPrefix = useId().replace(/[:]/g, '');

  /*
   * Only active departments are offered, plus the one already recorded on this
   * designation so an edit never has to change it just to save.
   */
  const departmentOptions = useMemo(
    () =>
      departments
        .filter((department) => department.isActive || String(department.id) === departmentId)
        .map((department) => ({
          value: String(department.id),
          label: department.name,
          description: [
            department.code,
            department.isActive ? null : 'inactive',
            department.designations === undefined ? null : `${department.designations} designation${department.designations === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
    [departments, departmentId],
  );

  const departmentMissing = !departmentsLoading && !departmentsError && departments.length === 0;
  const activeCount = departments.filter((department) => department.isActive).length;
  const titleMissing = title.trim().length === 0;
  const departmentUnset = departmentId === '';
  const blocked = departmentMissing || activeCount === 0;

  return (
    <Modal open onClose={onClose} title={designation ? 'Edit designation' : 'New designation'}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (titleMissing || departmentUnset || blocked) return;
          onSubmit({
            title: title.trim(),
            departmentId: Number(departmentId),
            description: description.trim() || null,
            grade: grade.trim() || null,
            isActive,
          });
        }}
      >
        <FormField
          label="Designation name"
          htmlFor={`desig-title-${idPrefix}`}
          error={touched && titleMissing ? 'Enter the designation name.' : undefined}
        >
          <input
            id={`desig-title-${idPrefix}`}
            className="ui-input"
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </FormField>

        <FormField
          label="Department"
          htmlFor={`desig-department-${idPrefix}`}
          error={
            !departmentsError && touched && departmentUnset && !blocked
              ? 'Choose the department this designation belongs to.'
              : undefined
          }
          hint={
            departmentsError || blocked
              ? undefined
              : 'Only active departments are listed. The department’s database id is saved, not its name.'
          }
        >
          <SearchableSelect
            id={`desig-department-${idPrefix}`}
            value={departmentId}
            onChange={setDepartmentId}
            options={departmentOptions}
            required
            disabled={blocked}
            loading={departmentsLoading}
            error={null}
            describedBy={departmentsError ? `${idPrefix}-department-error` : undefined}
            placeholder={blocked ? 'No active departments' : 'Select a department…'}
            searchPlaceholder="Search departments…"
            emptyMessage="No active departments"
          />
        </FormField>

        {/*
         * One error surface, not two: the message lives in this alert and the
         * combobox points at it, so a screen reader reads the reason once.
         */}
        {departmentsError ? (
          <div
            id={`${idPrefix}-department-error`}
            className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
            role="alert"
          >
            <p className="font-semibold">Departments could not be loaded.</p>
            {departmentsError !== 'Departments could not be loaded.' ? (
              <p className="mt-1">{departmentsError}</p>
            ) : null}
            <SecondaryButton className="mt-2" onClick={onReloadDepartments}>
              Try again
            </SecondaryButton>
          </div>
        ) : null}

        {departmentMissing ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">No departments recorded yet.</p>
            <p className="mt-1">
              A designation belongs to a department, so create the department first — for example
              Nursing, Finance, Laboratory, Pharmacy or Administration.
            </p>
            <PrimaryButton className="mt-2" onClick={onCreateDepartment}>
              Create a department
            </PrimaryButton>
          </div>
        ) : null}

        {!departmentMissing && !departmentsError && activeCount === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">Every department is inactive.</p>
            <p className="mt-1">
              Reactivate a department under Departments before adding a designation to it.
            </p>
          </div>
        ) : null}

        <FormField
          label="Description"
          htmlFor={`desig-description-${idPrefix}`}
          hint="Optional. What the role covers, in one or two sentences."
        >
          <textarea
            id={`desig-description-${idPrefix}`}
            className="ui-input"
            rows={3}
            maxLength={500}
            value={description ?? ''}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        <FormField label="Grade" htmlFor={`desig-grade-${idPrefix}`} hint="Optional, e.g. JG-6.">
          <input
            id={`desig-grade-${idPrefix}`}
            className="ui-input"
            maxLength={40}
            value={grade ?? ''}
            onChange={(event) => setGrade(event.target.value)}
          />
        </FormField>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          Active — offered when recording staff
        </label>

        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || blocked}>
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
  /* Label for the empty choice of a select; without it the empty choice reads "Select…". */
  placeholder?: string;
  /* Optional helper line under the control, e.g. what to do when a select has no options. */
  hint?: string;
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
  /* React's useId keeps control ids unique when a dialog is mounted more than once. */
  const idPrefix = `simple-field-${useId().replace(/:/g, '')}`;
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
        {fields.map((field) => {
          const controlId = `${idPrefix}-${field.name}`;
          const hintId = `${controlId}-hint`;
          const describedBy = field.hint ? hintId : undefined;
          const set = (event: { target: { value: string } }) =>
            setValues((current) => ({ ...current, [field.name]: event.target.value }));
          return (
            <div className="ui-form-field" key={field.name}>
              <label htmlFor={controlId}>
                {field.label}
                {field.required ? ' *' : ''}
              </label>
              {field.type === 'select' ? (
                <select
                  id={controlId}
                  className="ui-select"
                  required={field.required}
                  aria-describedby={describedBy}
                  value={values[field.name] ?? ''}
                  onChange={set}
                >
                  <option value="">{field.placeholder ?? 'Select…'}</option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  id={controlId}
                  className="ui-input"
                  rows={3}
                  aria-describedby={describedBy}
                  value={values[field.name] ?? ''}
                  onChange={set}
                />
              ) : (
                <input
                  id={controlId}
                  className="ui-input"
                  type={field.type ?? 'text'}
                  step={field.step}
                  required={field.required}
                  aria-describedby={describedBy}
                  value={values[field.name] ?? ''}
                  onChange={set}
                />
              )}
              {field.hint ? (
                <p id={hintId} className="ui-field-hint">
                  {field.hint}
                </p>
              ) : null}
            </div>
          );
        })}
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
