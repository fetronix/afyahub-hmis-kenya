import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock,
  History,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  XCircle,
} from 'lucide-react';

import { api, ApiError } from '../../../api/client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';
import { PrimaryButton, SecondaryButton } from '../../ui/controls.tsx';
import {
  AlertBanner,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '../../ui/feedback.tsx';
import { Modal } from '../../ui/overlays.tsx';
import { DataTable, FilterToolbar, StatCard } from '../../ui/layout.tsx';
import type {
  HrAttendanceDay,
  HrAttendancePolicy,
  HrAttendanceRow,
  HrHoliday,
  HrRosterEntry,
  HrShift,
} from '../../../api/clients/workforce.client.ts';

/* ------------------------------------------------------------------
   Local time. The facility's calendar decides the work date; the UTC date
   is never used, because at 21:30 in Nairobi the UTC date is still today.
   ------------------------------------------------------------------ */

const FALLBACK_ZONE = 'Africa/Nairobi';

function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function todayInZone(timeZone = FALLBACK_ZONE): string {
  return dateInZone(new Date(), timeZone);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function shiftDate(value: string, days: number): string {
  const parsed = parseDate(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Start of the week (Monday) and end (Sunday) for the date, in UTC date-only maths. */
function weekRange(value: string): { from: string; to: string } {
  const parsed = parseDate(value);
  const weekday = parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
  return { from: shiftDate(value, 1 - weekday), to: shiftDate(value, 7 - weekday) };
}

function monthRange(value: string): { from: string; to: string } {
  const [year, month] = value.split('-').map(Number);
  const first = `${value.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}

/** Wall-clock value in the facility zone → ISO instant. */
function zonedInputToIso(value: string, timeZone: string): string | null {
  if (!value) return null;
  const asUtc = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(asUtc);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const displayed = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return new Date(asUtc.getTime() - (displayed - asUtc.getTime())).toISOString();
}

/** ISO instant → value accepted by <input type="datetime-local"> in the facility zone. */
function isoToZonedInput(value: string | null, timeZone: string): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  OFF_DUTY: 'Off duty',
  TRAINING: 'Training',
  INCOMPLETE: 'Incomplete',
};

const STATUS_TONES: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'error',
  LEAVE: 'info',
  HOLIDAY: 'info',
  OFF_DUTY: 'neutral',
  TRAINING: 'info',
  INCOMPLETE: 'warning',
};

const MANUAL_STATUSES = ['ABSENT', 'LEAVE', 'HOLIDAY', 'OFF_DUTY', 'TRAINING'] as const;

/** Hours alone round a short shift to "0", which reads as no work at all. */
function workedLabel(row: { workedMinutes: number | null }): string | number {
  if (row.workedMinutes === null) return '—';
  const minutes = Math.max(0, row.workedMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

type EmployeeOption = {
  id: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentId: number | null;
  departmentName: string | null;
  employmentStatus: string;
};

type DepartmentOption = { id: number; name: string; isActive: boolean };

export const AttendanceRosterTab: React.FC<{
  facilityId: number;
  canManage: boolean;
  employees: EmployeeOption[];
  departments: DepartmentOption[];
}> = ({ facilityId, canManage, employees, departments }) => {
  const { showToast } = useHmis();
  const [timeZone, setTimeZone] = useState(FALLBACK_ZONE);
  const [date, setDate] = useState(() => todayInZone());
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');

  const [day, setDay] = useState<HrAttendanceDay | null>(null);
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [roster, setRoster] = useState<HrRosterEntry[]>([]);
  const [policy, setPolicy] = useState<HrAttendancePolicy | null>(null);
  const [holidays, setHolidays] = useState<HrHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [shiftDialog, setShiftDialog] = useState<HrShift | 'new' | null>(null);
  const [correctionRow, setCorrectionRow] = useState<HrAttendanceRow | null>(null);
  const [historyRow, setHistoryRow] = useState<HrAttendanceRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<HrRosterEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busyEmployee, setBusyEmployee] = useState<number | null>(null);

  const range = useMemo(() => {
    if (view === 'week') return weekRange(date);
    if (view === 'month') return monthRange(date);
    return { from: date, to: date };
  }, [date, view]);

  const loadDay = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.getHrAttendance(facilityId, date, {
        departmentId: departmentFilter || undefined,
        status: statusFilter || undefined,
      });
      setDay(payload as HrAttendanceDay);
      if (payload.timeZone) setTimeZone(payload.timeZone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Attendance could not be loaded.');
      setDay(null);
    } finally {
      setLoading(false);
    }
  }, [facilityId, date, departmentFilter, statusFilter]);

  const loadShifts = useCallback(async () => {
    try {
      setShifts((await api.getHrShifts(facilityId, date)) as HrShift[]);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Shifts could not be loaded.', {
        tone: 'error',
      });
    }
  }, [facilityId, date, showToast]);

  const loadRoster = useCallback(async () => {
    setRosterLoading(true);
    setRosterError(null);
    try {
      setRoster(
        (await api.getHrRoster(facilityId, range.from, range.to, {
          departmentId: departmentFilter || undefined,
        })) as HrRosterEntry[],
      );
    } catch (err) {
      setRosterError(err instanceof ApiError ? err.message : 'The roster could not be loaded.');
    } finally {
      setRosterLoading(false);
    }
  }, [facilityId, range.from, range.to, departmentFilter]);

  const loadPolicy = useCallback(async () => {
    try {
      const payload = (await api.getHrAttendancePolicy(facilityId)) as HrAttendancePolicy;
      setPolicy(payload);
      if (payload.timeZone) setTimeZone(payload.timeZone);
      const year = new Date().getUTCFullYear();
      setHolidays(
        (await api.getHrHolidays(facilityId, `${year - 1}-01-01`, `${year + 1}-12-31`)) as HrHoliday[],
      );
    } catch {
      /* Settings are optional for the daily view; the day endpoint carries the policy. */
    }
  }, [facilityId]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);
  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);
  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);
  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const refreshAll = async () => {
    await Promise.all([loadDay(), loadRoster(), loadShifts()]);
  };

  const runAction = async (employeeId: number, action: () => Promise<unknown>) => {
    setBusyEmployee(employeeId);
    try {
      await action();
      await refreshAll();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'The action did not complete.', {
        tone: 'error',
      });
    } finally {
      setBusyEmployee(null);
    }
  };

  const summary = day?.summary;
  const notRostered = (day?.rows ?? []).filter(
    (row) => !row.rosterEntryId && !row.clockInAt && row.attendanceState === 'UNROSTERED',
  );

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <FilterToolbar>
          <label className="text-xs font-medium text-muted" htmlFor="attendance-date">
            Work date
          </label>
          <input
            id="attendance-date"
            type="date"
            className="ui-input"
            value={date}
            onChange={(event) => setDate(event.target.value || todayInZone(timeZone))}
          />
          <label className="text-xs font-medium text-muted" htmlFor="attendance-department-filter">
            Department
          </label>
          <select
            id="attendance-department-filter"
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
          <label className="text-xs font-medium text-muted" htmlFor="attendance-status-filter">
            Status
          </label>
          <select
            id="attendance-status-filter"
            className="ui-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="NOT_CLOCKED_IN">Not yet clocked in</option>
            <option value="UNROSTERED">Not rostered</option>
          </select>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => void refreshAll()}>
              <RefreshCw size={15} /> Refresh
            </SecondaryButton>
            {canManage && (
              <>
                <SecondaryButton onClick={() => setSettingsOpen(true)} id="attendance-settings">
                  <Settings2 size={15} /> Attendance settings
                </SecondaryButton>
                <SecondaryButton onClick={() => setShiftDialog('new')} id="new-shift">
                  <Clock size={15} /> New shift
                </SecondaryButton>
                <PrimaryButton onClick={() => setAssignOpen(true)} id="assign-shift">
                  <CalendarDays size={15} /> Assign shift
                </PrimaryButton>
              </>
            )}
          </div>
        </FilterToolbar>
        <p className="text-xs text-muted">
          Times are facility-local ({timeZone}). Grace period{' '}
          {day?.policy.graceMinutes ?? policy?.graceMinutes ?? 10} minutes; an unclocked roster
          assignment becomes an absence{' '}
          {day?.policy.absenceCutoffMinutes ?? policy?.absenceCutoffMinutes ?? 240} minutes after
          the shift starts.
          {day?.holiday ? ` ${day.holiday} is a holiday.` : ''}
        </p>
      </section>

      {error && <ErrorState message={error} onRetry={() => void loadDay()} />}

      {loading && !day ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="attendance-summary">
            <StatCard label="Employees expected" value={summary?.expected ?? 0} detail="roster assignments for this date" />
            <StatCard label="Present" value={summary?.present ?? 0} detail="clocked in, late included" />
            <StatCard label="Late" value={summary?.late ?? 0} detail="beyond the grace period" />
            <StatCard label="Absent" value={summary?.absent ?? 0} detail="past the cutoff, no clock-in" />
            <StatCard label="On approved leave" value={summary?.onLeave ?? 0} detail="approved leave requests" />
            <StatCard label="Off duty" value={summary?.offDuty ?? 0} detail="recorded as off duty" />
            <StatCard label="Not yet clocked in" value={summary?.notClockedIn ?? 0} detail="rostered, before the cutoff" />
            <StatCard label="Clocked in, not out" value={summary?.clockedInNotOut ?? 0} detail="still on shift" />
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Attendance — {day?.date ?? date}</h2>
              {(summary?.holiday ?? 0) > 0 && (
                <StatusBadge tone="info">{summary?.holiday} on holiday</StatusBadge>
              )}
            </div>
            {!day?.rows.length ? (
              <EmptyState
                title="No employees to show"
                description="Register staff, or clear the department and status filters."
              />
            ) : (
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Employee no.</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Shift</th>
                    <th>Scheduled start</th>
                    <th>Scheduled end</th>
                    <th>Clock-in</th>
                    <th>Clock-out</th>
                    <th>Status</th>
                    <th>Hours</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {day.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>{row.name}</td>
                      <td className="tabular-nums text-muted">{row.employeeNumber}</td>
                      <td>{row.departmentName ?? '—'}</td>
                      <td>{row.designationTitle ?? '—'}</td>
                      <td>
                        {row.shiftName ?? <span className="text-xs text-muted">Not rostered</span>}
                        {row.shiftName && row.overnight && (
                          <span className="ml-1 text-xs text-muted">(overnight)</span>
                        )}
                      </td>
                      <td className="tabular-nums">{row.startTime ?? '—'}</td>
                      <td className="tabular-nums">
                        {row.endTime ? `${row.endTime}${row.overnight ? ' +1' : ''}` : '—'}
                      </td>
                      <td className="tabular-nums">{row.clockInLocal ?? '—'}</td>
                      <td className="tabular-nums">{row.clockOutLocal ?? '—'}</td>
                      <td>
                        {row.status ? (
                          <StatusBadge tone={STATUS_TONES[row.status] ?? 'neutral'}>
                            {STATUS_LABELS[row.status] ?? row.status}
                          </StatusBadge>
                        ) : (
                          <span className="text-xs text-muted">
                            {row.attendanceState === 'NOT_STARTED'
                              ? 'Not clocked in'
                              : row.attendanceState === 'UNROSTERED'
                                ? 'Not rostered'
                                : '—'}
                          </span>
                        )}
                      </td>
                      <td className="tabular-nums" title={row.hoursWorked === null ? undefined : `${row.hoursWorked} h`}>
                        {workedLabel(row)}
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1">
                          {row.canClockIn && (
                            <PrimaryButton
                              aria-label={`Clock in ${row.name}`}
                              disabled={busyEmployee === row.employeeId}
                              onClick={() =>
                                void runAction(row.employeeId, () =>
                                  api.clockInHrAttendance(facilityId, row.employeeId),
                                )
                              }
                            >
                              <LogIn size={14} /> Clock in
                            </PrimaryButton>
                          )}
                          {row.canClockOut && (
                            <PrimaryButton
                              aria-label={`Clock out ${row.name}`}
                              disabled={busyEmployee === row.employeeId}
                              onClick={() =>
                                void runAction(row.employeeId, () =>
                                  api.clockOutHrAttendance(facilityId, row.employeeId),
                                )
                              }
                            >
                              <LogOut size={14} /> Clock out
                            </PrimaryButton>
                          )}
                          {canManage && (
                            <>
                              <SecondaryButton
                                aria-label={`Correct attendance for ${row.name}`}
                                onClick={() => setCorrectionRow(row)}
                              >
                                <Pencil size={14} /> Correct
                              </SecondaryButton>
                              {row.attendanceId && (
                                <SecondaryButton
                                  aria-label={`Attendance history for ${row.name}`}
                                  onClick={() => setHistoryRow(row)}
                                >
                                  <History size={14} /> History
                                </SecondaryButton>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Shift templates</h2>
              <span className="text-xs text-muted">
                A shift is a reusable definition; assigning it is a separate step.
              </span>
            </div>
            {shifts.length === 0 ? (
              <EmptyState
                title="No shifts defined"
                description="Define the working hours employees can be rostered on."
                action={
                  canManage ? (
                    <PrimaryButton onClick={() => setShiftDialog('new')}>
                      <Plus size={15} /> New shift
                    </PrimaryButton>
                  ) : undefined
                }
              />
            ) : (
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Times</th>
                    <th>Break</th>
                    <th>Expected hours</th>
                    <th>Department</th>
                    <th>Rostered today</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <tr key={shift.id}>
                      <td>
                        {shift.name}
                        {shift.description && (
                          <div className="text-xs text-muted">{shift.description}</div>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {shift.startTime}–{shift.endTime}
                        {shift.overnight ? ' +1' : ''}
                      </td>
                      <td className="tabular-nums">{shift.breakMinutes} min</td>
                      <td className="tabular-nums">{shift.expectedHours}</td>
                      <td>{shift.departmentName ?? 'All departments'}</td>
                      <td className="tabular-nums">{shift.assignedToday}</td>
                      <td>
                        <StatusBadge tone={shift.isActive ? 'success' : 'neutral'}>
                          {shift.isActive ? 'Active' : 'Inactive'}
                        </StatusBadge>
                      </td>
                      <td className="text-right">
                        {canManage && (
                          <SecondaryButton
                            aria-label={`Edit ${shift.name}`}
                            onClick={() => setShiftDialog(shift)}
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

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Duty roster</h2>
              <div className="flex items-center gap-2" role="group" aria-label="Roster period">
                {(['day', 'week', 'month'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`ui-chip ${view === option ? 'ui-chip-active' : ''}`}
                    aria-pressed={view === option}
                    id={`roster-view-${option}`}
                    onClick={() => setView(option)}
                  >
                    {option === 'day' ? 'Daily' : option === 'week' ? 'Weekly' : 'Monthly'}
                  </button>
                ))}
                <span className="text-xs text-muted">
                  {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
                </span>
              </div>
            </div>
            {rosterError && <ErrorState message={rosterError} onRetry={() => void loadRoster()} />}
            {rosterLoading ? (
              <LoadingSkeleton rows={3} />
            ) : roster.length === 0 ? (
              <EmptyState
                title="Nobody is rostered for this period"
                description="A shift is only a template. Assign it to employees to build the roster."
                action={
                  canManage ? (
                    <PrimaryButton onClick={() => setAssignOpen(true)}>
                      <CalendarDays size={15} /> Assign shift
                    </PrimaryButton>
                  ) : undefined
                }
              />
            ) : (
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Shift</th>
                    <th>Times</th>
                    <th>Status</th>
                    <th>Clock-in</th>
                    <th>Clock-out</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((entry) => (
                    <tr key={entry.id}>
                      <td className="tabular-nums">{entry.workDate}</td>
                      <td>
                        {entry.employeeName}
                        <div className="text-xs text-muted">{entry.employeeNumber}</div>
                      </td>
                      <td>{entry.departmentName ?? '—'}</td>
                      <td>
                        {entry.shiftName}
                        {entry.overnight && <span className="ml-1 text-xs text-muted">(overnight)</span>}
                      </td>
                      <td className="tabular-nums">
                        {entry.startTime}–{entry.endTime}
                        {entry.overnight ? ' +1' : ''}
                      </td>
                      <td>
                        <StatusBadge tone={entry.status === 'ASSIGNED' ? 'success' : 'neutral'}>
                          {entry.status === 'ASSIGNED' ? 'Assigned' : 'Cancelled'}
                        </StatusBadge>
                      </td>
                      <td className="tabular-nums">
                        {entry.clockInAt
                          ? isoToZonedInput(entry.clockInAt, timeZone).slice(11)
                          : '—'}
                      </td>
                      <td className="tabular-nums">
                        {entry.clockOutAt
                          ? isoToZonedInput(entry.clockOutAt, timeZone).slice(11)
                          : '—'}
                      </td>
                      <td className="text-right">
                        {canManage && entry.status === 'ASSIGNED' && (
                          <SecondaryButton
                            aria-label={`Cancel ${entry.employeeName} on ${entry.workDate}`}
                            onClick={() => setCancelTarget(entry)}
                          >
                            <XCircle size={14} /> Cancel
                          </SecondaryButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}

            {view === 'day' && notRostered.length > 0 && (
              <AlertBanner tone="info">
                <p className="text-sm font-medium">Not rostered on {date}</p>
                <p className="text-xs">
                  {notRostered.map((row) => row.name).join(', ')}. They cannot clock in until an
                  assignment exists — create one above.
                </p>
              </AlertBanner>
            )}
          </section>
        </>
      )}

      {assignOpen && (
        <AssignShiftDialog
          facilityId={facilityId}
          date={date}
          employees={employees}
          departments={departments}
          shifts={shifts}
          existing={roster.filter((entry) => entry.workDate === date && entry.status === 'ASSIGNED')}
          onClose={() => setAssignOpen(false)}
          onAssigned={async (result) => {
            setAssignOpen(false);
            await refreshAll();
            if (result.skipped.length) {
              showToast(
                `${result.saved.length} assigned, ${result.skipped.length} skipped: ${result.skipped
                  .map((item) => `${item.employeeName} — ${item.reason}`)
                  .join('; ')}`,
                { tone: 'warning' },
              );
            } else {
              showToast(`${result.saved.length} employee(s) rostered.`, { tone: 'success' });
            }
          }}
          onError={(message) => showToast(message, { tone: 'error' })}
        />
      )}

      {shiftDialog && (
        <ShiftDialog
          shift={shiftDialog === 'new' ? null : shiftDialog}
          departments={departments}
          onClose={() => setShiftDialog(null)}
          onSaved={async () => {
            setShiftDialog(null);
            await loadShifts();
            showToast('Shift saved.', { tone: 'success' });
          }}
          onError={(message) => showToast(message, { tone: 'error' })}
          facilityId={facilityId}
        />
      )}

      {correctionRow && (
        <CorrectionDialog
          facilityId={facilityId}
          row={correctionRow}
          date={date}
          timeZone={timeZone}
          onClose={() => setCorrectionRow(null)}
          onSaved={async () => {
            setCorrectionRow(null);
            await refreshAll();
            showToast('Attendance corrected.', { tone: 'success' });
          }}
          onError={(message) => showToast(message, { tone: 'error' })}
        />
      )}

      {historyRow && (
        <HistoryDialog
          facilityId={facilityId}
          row={historyRow}
          onClose={() => setHistoryRow(null)}
        />
      )}

      {cancelTarget && (
        <CancelRosterDialog
          facilityId={facilityId}
          entry={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={async () => {
            setCancelTarget(null);
            await refreshAll();
            showToast('Assignment cancelled.', { tone: 'success' });
          }}
          onError={(message) => showToast(message, { tone: 'error' })}
        />
      )}

      {settingsOpen && (
        <AttendanceSettingsDialog
          facilityId={facilityId}
          policy={policy}
          holidays={holidays}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => {
            setSettingsOpen(false);
            await Promise.all([loadPolicy(), loadDay()]);
            showToast('Attendance settings saved.', { tone: 'success' });
          }}
          onError={(message) => showToast(message, { tone: 'error' })}
        />
      )}
    </div>
  );
};

/* ============================================================
   DIALOGS
   ============================================================ */

function useSaving() {
  const [saving, setSaving] = useState(false);
  return { saving, setSaving };
}

function AssignShiftDialog({
  facilityId,
  date,
  employees,
  departments,
  shifts,
  existing,
  onClose,
  onAssigned,
  onError,
}: {
  facilityId: number;
  date: string;
  employees: EmployeeOption[];
  departments: DepartmentOption[];
  shifts: HrShift[];
  existing: HrRosterEntry[];
  onClose: () => void;
  onAssigned: (result: {
    saved: Array<{ id: number; employeeId: number; employeeName: string }>;
    skipped: Array<{ employeeId: number; employeeName: string; reason: string }>;
  }) => void;
  onError: (message: string) => void;
}) {
  const { saving, setSaving } = useSaving();
  const [form, setForm] = useState({ workDate: date, departmentId: '', shiftId: '', notes: '' });
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeShifts = shifts.filter((shift) => shift.isActive);
  const chosenShift = activeShifts.find((shift) => String(shift.id) === form.shiftId) ?? null;
  const rostered = new Set(existing.map((entry) => entry.employeeId));

  const candidates = employees
    .filter((employee) => employee.employmentStatus !== 'EXITED')
    .filter((employee) => (form.departmentId ? String(employee.departmentId) === form.departmentId : true))
    .filter((employee) => {
      if (!chosenShift?.departmentId) return true;
      return employee.departmentId === chosenShift.departmentId;
    })
    .filter((employee) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return `${employee.firstName} ${employee.lastName} ${employee.employeeNumber}`
        .toLowerCase()
        .includes(needle);
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.shiftId) return setError('Choose a shift.');
    if (!form.workDate) return setError('Choose a work date.');
    if (!selected.length) return setError('Select at least one employee.');
    setSaving(true);
    try {
      const result = await api.assignHrRoster(facilityId, {
        shiftId: Number(form.shiftId),
        workDate: form.workDate,
        employeeIds: selected,
        notes: form.notes || undefined,
      });
      onAssigned(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The roster was not saved.';
      setError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Assign shift">
      <form className="space-y-4" onSubmit={submit}>
        {error && (
          <AlertBanner tone="error">
            <p role="alert">{error}</p>
          </AlertBanner>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="ui-field">
            <label htmlFor="assign-date">Work date *</label>
            <input
              id="assign-date"
              type="date"
              className="ui-input"
              required
              value={form.workDate}
              onChange={(event) => setForm({ ...form, workDate: event.target.value })}
            />
          </div>
          <div className="ui-field">
            <label htmlFor="assign-department">Department</label>
            <select
              id="assign-department"
              className="ui-select"
              value={form.departmentId}
              onChange={(event) =>
                setForm({ ...form, departmentId: event.target.value, shiftId: '' })
              }
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label htmlFor="assign-shift-select">Shift *</label>
            <select
              id="assign-shift-select"
              aria-label="Shift to assign"
              className="ui-select"
              required
              value={form.shiftId}
              onChange={(event) => setForm({ ...form, shiftId: event.target.value })}
            >
              <option value="">Select a shift…</option>
              {activeShifts
                .filter((shift) =>
                  form.departmentId
                    ? !shift.departmentId || String(shift.departmentId) === form.departmentId
                    : true,
                )
                .map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name} ({shift.startTime}–{shift.endTime}
                    {shift.overnight ? ' +1' : ''})
                  </option>
                ))}
            </select>
            {!activeShifts.length && (
              <p className="text-xs text-muted">No active shifts. Create one first.</p>
            )}
          </div>
        </div>

        <div className="ui-field">
          <label htmlFor="assign-employee-search">Employees *</label>
          <input
            id="assign-employee-search"
            className="ui-input"
            placeholder="Search name or employee number"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-hair p-2">
          {candidates.length === 0 ? (
            <p className="p-2 text-sm text-muted">No employees match.</p>
          ) : (
            candidates.map((employee) => {
              const already = rostered.has(employee.id);
              const checked = selected.includes(employee.id);
              return (
                <label
                  key={employee.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={checked}
                    disabled={already}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, employee.id]
                          : current.filter((id) => id !== employee.id),
                      )
                    }
                  />
                  <span className="font-medium">
                    {employee.firstName} {employee.lastName}
                  </span>
                  <span className="text-xs text-muted">{employee.employeeNumber}</span>
                  <span className="ml-auto text-xs text-muted">
                    {already ? 'Already rostered' : (employee.departmentName ?? 'No department')}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="ui-field">
          <label htmlFor="assign-notes">Notes</label>
          <input
            id="assign-notes"
            className="ui-input"
            maxLength={300}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>

        <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Assigning…' : 'Assign shift'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ShiftDialog({
  facilityId,
  shift,
  departments,
  onClose,
  onSaved,
  onError,
}: {
  facilityId: number;
  shift: HrShift | null;
  departments: DepartmentOption[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { saving, setSaving } = useSaving();
  const [form, setForm] = useState({
    name: shift?.name ?? '',
    description: shift?.description ?? '',
    startTime: shift?.startTime ?? '07:00',
    endTime: shift?.endTime ?? '18:00',
    breakMinutes: String(shift?.breakMinutes ?? 0),
    departmentId: shift?.departmentId ? String(shift.departmentId) : '',
    isActive: shift?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const overnight = form.startTime >= form.endTime && form.startTime !== form.endTime;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        startTime: form.startTime,
        endTime: form.endTime,
        breakMinutes: Number(form.breakMinutes || 0),
        departmentId: form.departmentId ? Number(form.departmentId) : undefined,
        isActive: form.isActive,
      };
      if (shift) await api.updateHrShift(facilityId, shift.id, payload);
      else await api.createHrShift(facilityId, payload);
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The shift was not saved.';
      setError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={shift ? `Edit ${shift.name}` : 'New shift'}>
      <form className="space-y-3" onSubmit={submit}>
        {error && (
          <AlertBanner tone="error">
            <p role="alert">{error}</p>
          </AlertBanner>
        )}
        <div className="ui-field">
          <label htmlFor="shift-name">Shift name *</label>
          <input
            id="shift-name"
            className="ui-input"
            required
            maxLength={60}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div className="ui-field">
          <label htmlFor="shift-description">Description</label>
          <input
            id="shift-description"
            className="ui-input"
            maxLength={200}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="ui-field">
            <label htmlFor="shift-start">Start time *</label>
            <input
              id="shift-start"
              type="time"
              className="ui-input"
              required
              value={form.startTime}
              onChange={(event) => setForm({ ...form, startTime: event.target.value })}
            />
          </div>
          <div className="ui-field">
            <label htmlFor="shift-end">End time *</label>
            <input
              id="shift-end"
              type="time"
              className="ui-input"
              required
              value={form.endTime}
              onChange={(event) => setForm({ ...form, endTime: event.target.value })}
            />
          </div>
          <div className="ui-field">
            <label htmlFor="shift-break">Break (minutes)</label>
            <input
              id="shift-break"
              type="number"
              min={0}
              max={480}
              className="ui-input"
              value={form.breakMinutes}
              onChange={(event) => setForm({ ...form, breakMinutes: event.target.value })}
            />
          </div>
        </div>
        {overnight && (
          <AlertBanner tone="info">
            This shift ends on the following day — it is recorded as an overnight shift.
          </AlertBanner>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="ui-field">
            <label htmlFor="shift-department">Department</label>
            <select
              id="shift-department"
              className="ui-select"
              value={form.departmentId}
              onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              Leave empty when any department may work this shift.
            </p>
          </div>
          <label className="flex items-center gap-2 self-end text-sm" htmlFor="shift-active">
            <input
              id="shift-active"
              type="checkbox"
              className="ui-checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            Active — offered when building a roster
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save shift'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function CorrectionDialog({
  facilityId,
  row,
  date,
  timeZone,
  onClose,
  onSaved,
  onError,
}: {
  facilityId: number;
  row: HrAttendanceRow;
  date: string;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { saving, setSaving } = useSaving();
  const [form, setForm] = useState({
    status: row.status && MANUAL_STATUSES.includes(row.status as (typeof MANUAL_STATUSES)[number])
      ? row.status
      : '',
    clockIn: isoToZonedInput(row.clockInAt, timeZone),
    clockOut: isoToZonedInput(row.clockOutAt, timeZone),
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.reason.trim().length < 5) {
      setError('Give a reason of at least five characters.');
      return;
    }
    setSaving(true);
    try {
      await api.correctHrAttendance(facilityId, {
        employeeId: row.employeeId,
        workDate: date,
        status: form.status || undefined,
        clockInAt: form.clockIn ? zonedInputToIso(form.clockIn, timeZone) : undefined,
        clockOutAt: form.clockOut ? zonedInputToIso(form.clockOut, timeZone) : undefined,
        reason: form.reason,
      });
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The correction was not saved.';
      setError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Correct attendance — ${row.name}`}>
      <form className="space-y-3" onSubmit={submit}>
        {error && (
          <AlertBanner tone="error">
            <p role="alert">{error}</p>
          </AlertBanner>
        )}
        <p className="text-xs text-muted">
          Times are {timeZone}. The correction stores your identity, the reason, and the values it
          replaced.
        </p>
        <div className="ui-field">
          <label htmlFor="correction-status">Status</label>
          <select
            id="correction-status"
            className="ui-select"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            <option value="">Leave unchanged</option>
            {MANUAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="ui-field">
            <label htmlFor="correction-in">Clock-in</label>
            <input
              id="correction-in"
              type="datetime-local"
              className="ui-input"
              value={form.clockIn}
              onChange={(event) => setForm({ ...form, clockIn: event.target.value })}
            />
          </div>
          <div className="ui-field">
            <label htmlFor="correction-out">Clock-out</label>
            <input
              id="correction-out"
              type="datetime-local"
              className="ui-input"
              value={form.clockOut}
              onChange={(event) => setForm({ ...form, clockOut: event.target.value })}
            />
          </div>
        </div>
        <div className="ui-field">
          <label htmlFor="correction-reason">Reason *</label>
          <textarea
            id="correction-reason"
            className="ui-input"
            rows={3}
            maxLength={500}
            required
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </div>
        <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save correction'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function HistoryDialog({
  facilityId,
  row,
  onClose,
}: {
  facilityId: number;
  row: HrAttendanceRow;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!row.attendanceId) return;
    api
      .getHrAttendanceHistory(facilityId, row.attendanceId)
      .then((rows) => {
        if (!cancelled) setEntries(rows as Array<Record<string, unknown>>);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'History could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [facilityId, row.attendanceId]);

  return (
    <Modal open onClose={onClose} title={`Attendance history — ${row.name}`}>
      <div className="space-y-3">
        {error && (
          <AlertBanner tone="error">
            <p role="alert">{error}</p>
          </AlertBanner>
        )}
        {entries === null && !error ? (
          <LoadingSkeleton rows={2} />
        ) : !entries?.length ? (
          <p className="text-sm text-muted">
            No corrections. The recorded clock times are exactly what the employee clocked.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {entries.map((entry) => (
              <li key={String(entry.id)} className="rounded-lg border border-hair p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {String(entry.previousStatus ?? '—')} → {String(entry.newStatus ?? '—')}
                  </span>
                  <span className="text-xs text-muted">
                    {String(entry.correctedByName ?? 'Unknown user')} ·{' '}
                    {new Date(String(entry.createdAt)).toLocaleString('en-GB', {
                      timeZone: 'Africa/Nairobi',
                    })}
                  </span>
                </div>
                <p className="mt-1 text-xs">{String(entry.reason ?? '')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function CancelRosterDialog({
  facilityId,
  entry,
  onClose,
  onDone,
  onError,
}: {
  facilityId: number;
  entry: HrRosterEntry;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { saving, setSaving } = useSaving();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title="Cancel roster assignment">
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSaving(true);
          try {
            await api.cancelHrRoster(facilityId, entry.id, reason);
            onDone();
          } catch (err) {
            const message = err instanceof ApiError ? err.message : 'The assignment was not cancelled.';
            setError(message);
            onError(message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {error && (
          <AlertBanner tone="error">
            <p role="alert">{error}</p>
          </AlertBanner>
        )}
        <p className="text-sm">
          {entry.employeeName} — {entry.shiftName}, {entry.workDate}. The row stays in the roster
          history with the reason below.
        </p>
        <div className="ui-field">
          <label htmlFor="cancel-reason">Reason</label>
          <input
            id="cancel-reason"
            className="ui-input"
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose}>
            Keep assignment
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Cancelling…' : 'Cancel assignment'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AttendanceSettingsDialog({
  facilityId,
  policy,
  holidays,
  onClose,
  onSaved,
  onError,
}: {
  facilityId: number;
  policy: HrAttendancePolicy | null;
  holidays: HrHoliday[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { saving, setSaving } = useSaving();
  const [form, setForm] = useState({
    graceMinutes: String(policy?.graceMinutes ?? 10),
    absenceCutoffMinutes: String(policy?.absenceCutoffMinutes ?? 240),
    timeZone: policy?.timeZone ?? FALLBACK_ZONE,
    allowRosterConflicts: policy?.allowRosterConflicts ?? false,
  });
  const [holiday, setHoliday] = useState({ holidayDate: '', name: '' });
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title="Attendance settings">
      <div className="space-y-5">
        {error && (
          <AlertBanner tone="error">
            <p role="alert">{error}</p>
          </AlertBanner>
        )}
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await api.saveHrAttendancePolicy(facilityId, {
                graceMinutes: Number(form.graceMinutes),
                absenceCutoffMinutes: Number(form.absenceCutoffMinutes),
                timeZone: form.timeZone,
                allowRosterConflicts: form.allowRosterConflicts,
              });
              onSaved();
            } catch (err) {
              const message = err instanceof ApiError ? err.message : 'Settings were not saved.';
              setError(message);
              onError(message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="ui-field">
              <label htmlFor="policy-grace">Grace (minutes)</label>
              <input
                id="policy-grace"
                type="number"
                min={0}
                max={240}
                className="ui-input"
                value={form.graceMinutes}
                onChange={(event) => setForm({ ...form, graceMinutes: event.target.value })}
              />
            </div>
            <div className="ui-field">
              <label htmlFor="policy-cutoff">Absence cutoff (minutes)</label>
              <input
                id="policy-cutoff"
                type="number"
                min={0}
                max={1440}
                className="ui-input"
                value={form.absenceCutoffMinutes}
                onChange={(event) =>
                  setForm({ ...form, absenceCutoffMinutes: event.target.value })
                }
              />
            </div>
            <div className="ui-field">
              <label htmlFor="policy-timezone">Time zone</label>
              <input
                id="policy-timezone"
                className="ui-input"
                value={form.timeZone}
                onChange={(event) => setForm({ ...form, timeZone: event.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" htmlFor="policy-conflicts">
            <input
              id="policy-conflicts"
              type="checkbox"
              className="ui-checkbox"
              checked={form.allowRosterConflicts}
              onChange={(event) =>
                setForm({ ...form, allowRosterConflicts: event.target.checked })
              }
            />
            Allow a second shift to replace an existing assignment on the same date
          </label>
          <div className="flex justify-end">
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </PrimaryButton>
          </div>
        </form>

        <div className="space-y-2 border-t border-hair pt-4">
          <h3 className="text-sm font-semibold">Holidays</h3>
          {holidays.length === 0 ? (
            <p className="text-xs text-muted">No holidays recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {holidays.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="tabular-nums">{item.holidayDate}</span> — {item.name}
                  </span>
                  <SecondaryButton
                    aria-label={`Remove holiday ${item.name}`}
                    onClick={async () => {
                      try {
                        await api.deleteHrHoliday(facilityId, item.id);
                        onSaved();
                      } catch (err) {
                        onError(
                          err instanceof ApiError ? err.message : 'Holiday was not removed.',
                        );
                      }
                    }}
                  >
                    Remove
                  </SecondaryButton>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              aria-label="Holiday date"
              type="date"
              className="ui-input"
              value={holiday.holidayDate}
              onChange={(event) => setHoliday({ ...holiday, holidayDate: event.target.value })}
            />
            <input
              aria-label="Holiday name"
              className="ui-input"
              placeholder="e.g. Madaraka Day"
              value={holiday.name}
              onChange={(event) => setHoliday({ ...holiday, name: event.target.value })}
            />
            <SecondaryButton
              id="add-holiday"
              onClick={async () => {
                try {
                  await api.createHrHoliday(facilityId, holiday);
                  setHoliday({ holidayDate: '', name: '' });
                  onSaved();
                } catch (err) {
                  onError(err instanceof ApiError ? err.message : 'Holiday was not added.');
                }
              }}
            >
              <Plus size={14} /> Add holiday
            </SecondaryButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
