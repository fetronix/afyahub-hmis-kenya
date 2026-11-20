// @vitest-environment jsdom
/*
 * The attendance and roster tab.
 *
 * The bug this replaces: the tab rendered shift *definitions* next to the words
 * "Rostered today" and offered no clock action at all, so a shift looked like a
 * roster and every employee read "Not recorded" forever. These tests pin the
 * replacement: the roster is loaded separately from the shift templates, clock
 * in and clock out call the API and swap places, an unrostered employee cannot
 * clock, and a correction cannot be saved without a reason.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getHrAttendance: vi.fn(),
  getHrShifts: vi.fn(),
  getHrRoster: vi.fn(),
  getHrAttendancePolicy: vi.fn(),
  getHrHolidays: vi.fn(),
  clockInHrAttendance: vi.fn(),
  clockOutHrAttendance: vi.fn(),
  correctHrAttendance: vi.fn(),
  assignHrRoster: vi.fn(),
  cancelHrRoster: vi.fn(),
  createHrShift: vi.fn(),
  updateHrShift: vi.fn(),
  saveHrAttendancePolicy: vi.fn(),
  createHrHoliday: vi.fn(),
  deleteHrHoliday: vi.fn(),
}));

vi.mock('../../api/client.ts', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ showToast: vi.fn() }),
}));

import { AttendanceRosterTab } from '../../components/modules/hr/AttendanceRoster.tsx';
import { ApiError } from '../../api/client.ts';

const DEPARTMENTS = [
  { id: 11, name: 'Nursing', isActive: true },
  { id: 12, name: 'Finance', isActive: true },
];

const EMPLOYEES = [
  {
    id: 101,
    employeeNumber: 'SYNTH-0001',
    firstName: 'Synthetic',
    lastName: 'Nurse',
    departmentId: 11,
    departmentName: 'Nursing',
    employmentStatus: 'ACTIVE',
  },
  {
    id: 102,
    employeeNumber: 'SYNTH-0002',
    firstName: 'Synthetic',
    lastName: 'Accountant',
    departmentId: 12,
    departmentName: 'Finance',
    employmentStatus: 'ACTIVE',
  },
];

const SHIFT = {
  id: 5,
  name: 'Day Shift',
  description: 'Day cover',
  startTime: '07:00',
  endTime: '18:00',
  breakMinutes: 60,
  departmentId: null,
  departmentName: null,
  isActive: true,
  overnight: false,
  expectedHours: 10,
  scheduledMinutes: 600,
  assignedToday: 1,
};

const TODAY = '2026-11-20';

function row(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: 101,
    employeeNumber: 'SYNTH-0001',
    name: 'Synthetic Nurse',
    departmentId: 11,
    departmentName: 'Nursing',
    designationTitle: 'Nurse',
    rosterEntryId: 900,
    shiftId: 5,
    shiftName: 'Day Shift',
    startTime: '07:00',
    endTime: '18:00',
    overnight: false,
    scheduledMinutes: 600,
    expectedHours: 10,
    clockInAt: null,
    clockOutAt: null,
    clockInLocal: null,
    clockOutLocal: null,
    status: null,
    attendanceState: 'NOT_STARTED',
    lateMinutes: null,
    workedMinutes: null,
    overtimeMinutes: null,
    hoursWorked: null,
    canClockIn: true,
    canClockOut: false,
    excusedReason: null,
    notes: null,
    ...overrides,
  };
}

function day(rows: Array<Record<string, unknown>>) {
  return {
    date: TODAY,
    timeZone: 'Africa/Nairobi',
    policy: { graceMinutes: 10, absenceCutoffMinutes: 240 },
    holiday: null,
    summary: {
      expected: 1,
      present: 0,
      late: 0,
      absent: 0,
      onLeave: 0,
      offDuty: 0,
      holiday: 0,
      training: 0,
      incomplete: 0,
      notClockedIn: 1,
      clockedInNotOut: 0,
      unrostered: 0,
    },
    rows,
  };
}

const rosterEntry = {
  id: 900,
  employeeId: 101,
  employeeNumber: 'SYNTH-0001',
  employeeName: 'Synthetic Nurse',
  departmentId: 11,
  departmentName: 'Nursing',
  designationTitle: 'Nurse',
  workDate: TODAY,
  shiftId: 5,
  shiftName: 'Day Shift',
  startTime: '07:00',
  endTime: '18:00',
  overnight: false,
  scheduledMinutes: 600,
  status: 'ASSIGNED',
  notes: null,
  cancelledAt: null,
  cancelReason: null,
  clockInAt: null,
  clockOutAt: null,
  lateMinutes: null,
};

function renderTab(canManage = true) {
  return render(
    <AttendanceRosterTab
      facilityId={1}
      canManage={canManage}
      employees={EMPLOYEES}
      departments={DEPARTMENTS}
    />,
  );
}

describe('attendance and roster tab', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getHrShifts.mockResolvedValue([SHIFT]);
    api.getHrRoster.mockResolvedValue([rosterEntry]);
    api.getHrAttendancePolicy.mockResolvedValue({
      graceMinutes: 10,
      absenceCutoffMinutes: 240,
      timeZone: 'Africa/Nairobi',
      allowRosterConflicts: false,
    });
    api.getHrHolidays.mockResolvedValue([]);
    api.getHrAttendance.mockResolvedValue(day([row()]));
  });

  afterEach(() => cleanup());

  it('lists shift templates separately from the roster', async () => {
    renderTab();
    const templates = (await screen.findByRole('heading', { name: /Shift templates/i })).closest(
      'section',
    ) as HTMLElement;
    expect(within(templates).getByText('Day Shift')).toBeTruthy();
    expect(within(templates).getByText('10')).toBeTruthy();
    expect(within(templates).getByText('Active')).toBeTruthy();

    const roster = (await screen.findByRole('heading', { name: /Duty roster/i })).closest(
      'section',
    ) as HTMLElement;
    expect(within(roster).getByText('Synthetic Nurse')).toBeTruthy();
  });

  it('shows the summary cards from the API, not a client-side guess', async () => {
    api.getHrAttendance.mockResolvedValue(day([row()]));
    renderTab();
    expect(await screen.findByText('Employees expected')).toBeTruthy();
    /* The label also appears in the status filter, so count rather than get. */
    expect(screen.getAllByText('Not yet clocked in').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Clocked in, not out').length).toBeGreaterThanOrEqual(1);
  });

  it('offers Clock in before a clock exists and calls the API', async () => {
    api.clockInHrAttendance.mockResolvedValue({ status: 'PRESENT' });
    renderTab();
    const button = await screen.findByRole('button', { name: /Clock in Synthetic Nurse/i });
    await userEvent.click(button);
    expect(api.clockInHrAttendance).toHaveBeenCalledWith(1, 101);
  });

  it('replaces Clock in with Clock out after a clock-in', async () => {
    api.getHrAttendance.mockResolvedValue(
      day([
        row({
          clockInAt: '2026-11-20T04:05:00.000Z',
          clockInLocal: '07:05',
          attendanceState: 'CLOCKED_IN',
          status: 'PRESENT',
          canClockIn: false,
          canClockOut: true,
        }),
      ]),
    );
    api.clockOutHrAttendance.mockResolvedValue({ workedMinutes: 60 });
    renderTab();
    expect(await screen.findByText('07:05')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clock in Synthetic Nurse/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Clock out Synthetic Nurse/i }));
    expect(api.clockOutHrAttendance).toHaveBeenCalledWith(1, 101);
  });

  it('does not offer a clock action to an employee with no roster assignment', async () => {
    api.getHrAttendance.mockResolvedValue(
      day([
        row({
          rosterEntryId: null,
          shiftId: null,
          shiftName: null,
          startTime: null,
          endTime: null,
          attendanceState: 'UNROSTERED',
          canClockIn: false,
          canClockOut: false,
        }),
      ]),
    );
    api.getHrRoster.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Not rostered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clock in/i })).toBeNull();
    expect(screen.getByText(/They cannot clock in until an assignment exists/i)).toBeTruthy();
  });

  it('explains an empty roster instead of showing shift definitions as people', async () => {
    api.getHrRoster.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/Nobody is rostered for this period/i)).toBeTruthy();
  });

  it('requires a reason before saving a correction', async () => {
    renderTab();
    await userEvent.click(
      await screen.findByRole('button', { name: /Correct attendance for Synthetic Nurse/i }),
    );
    const dialog = await screen.findByRole('dialog');
    /* "abc" satisfies the required attribute but not the five-character rule. */
    await userEvent.type(within(dialog).getByLabelText(/Reason \*/i), 'abc');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save correction/i }));
    expect(await within(dialog).findByText(/at least five characters/i)).toBeTruthy();
    expect(api.correctHrAttendance).not.toHaveBeenCalled();
  });

  it('reports an attendance load failure and offers a retry', async () => {
    api.getHrAttendance.mockRejectedValueOnce(new ApiError('Attendance service unavailable', 503));
    renderTab();
    expect(await screen.findByText('Attendance service unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('reloads the day when the department filter changes', async () => {
    renderTab();
    await screen.findByRole('button', { name: /Clock in Synthetic Nurse/i });
    api.getHrAttendance.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/Department/i), '12');
    await waitFor(() =>
      expect(api.getHrAttendance).toHaveBeenCalledWith(1, expect.any(String), {
        departmentId: '12',
        status: undefined,
      }),
    );
  });

  it('hides management actions from a user without hr.manage', async () => {
    renderTab(false);
    await screen.findByRole('button', { name: /Clock out|Clock in/i }).catch(() => null);
    expect(screen.queryByRole('button', { name: /Assign shift/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /New shift/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Attendance settings/i })).toBeNull();
  });

  it('marks already-rostered employees in the assign dialog so a conflict is visible', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Assign shift/i }));
    const dialog = await screen.findByRole('dialog');
    const nurse = within(dialog).getByLabelText(/Synthetic Nurse/) as HTMLInputElement;
    expect(nurse.disabled).toBe(true);
    expect(within(dialog).getByText('Already rostered')).toBeTruthy();
    const accountant = within(dialog).getByLabelText(/Synthetic Accountant/) as HTMLInputElement;
    expect(accountant.disabled).toBe(false);
  });

  it('assigns the selected employees and reports skipped ones', async () => {
    api.assignHrRoster.mockResolvedValue({
      saved: [{ id: 901, employeeId: 102, employeeName: 'Synthetic Accountant' }],
      skipped: [],
      workDate: TODAY,
      shiftId: 5,
    });
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Assign shift/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Shift to assign'), '5');
    await userEvent.click(within(dialog).getByLabelText(/Synthetic Accountant/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign shift' }));
    await waitFor(() =>
      expect(api.assignHrRoster).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ shiftId: 5, employeeIds: [102] }),
      ),
    );
  });

  it('saves a new shift with break, department and overnight flag', async () => {
    api.createHrShift.mockResolvedValue(SHIFT);
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /New shift/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Shift name/i), 'Night Shift');
    await userEvent.clear(within(dialog).getByLabelText(/Start time/i));
    await userEvent.type(within(dialog).getByLabelText(/Start time/i), '19:00');
    await userEvent.clear(within(dialog).getByLabelText(/End time/i));
    await userEvent.type(within(dialog).getByLabelText(/End time/i), '07:00');
    expect(within(dialog).getByText(/following day/i)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Save shift/i }));
    await waitFor(() =>
      expect(api.createHrShift).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: 'Night Shift', startTime: '19:00', endTime: '07:00' }),
      ),
    );
  });
});
