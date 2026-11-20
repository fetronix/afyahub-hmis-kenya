/**
 * Duty roster, shift assignment and clock-in/clock-out against a real
 * synthetic PostgreSQL.
 *
 * The distinction under test is the reason this feature exists:
 *
 *   shift      — a reusable template of working hours
 *   roster     — an employee assigned to that shift on one date
 *   attendance — the clock instants that actually happened
 *
 * Each test names the acceptance scenario it covers. Times are Africa/Nairobi
 * wall-clock, and "today" is the facility's today, never the UTC date.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';

import { describeDb } from './support/db.ts';
import { db, pool } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  assignRoster,
  attendanceForDate,
  cancelRosterEntry,
  clockIn,
  clockOut,
  correctAttendance,
  createHoliday,
  createShift,
  deleteHoliday,
  getAttendancePolicy,
  listRoster,
  listShifts,
  localClock,
  lateMinutesFor,
  recordAttendance,
  saveAttendancePolicy,
  shiftTiming,
  updateShift,
  WorkforceError,
  type WorkforceScope,
} from '../../workforce/workforce.service.ts';

const suffix = randomUUID().slice(0, 8).toUpperCase();
const ZONE = 'Africa/Nairobi';

type Fixture = {
  scope: WorkforceScope;
  foreignScope: WorkforceScope;
  nursing: number;
  finance: number;
  nurseId: number;
  accountantId: number;
  today: string;
  nowMinutes: number;
};

const fixture = {} as Fixture;

async function expectRefusal(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkforceError);
    expect((error as WorkforceError).code).toBe(code);
    return error as WorkforceError;
  }
  throw new Error(`Expected the operation to be refused with ${code}, but it succeeded.`);
}

function timeFromMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, '0');
  return `${hours}:${String(wrapped % 60).padStart(2, '0')}`;
}


async function makeEmployee(label: string) {
  const [row] = await db
    .insert(schema.hrEmployees)
    .values({
      tenantId: fixture.scope.tenantId,
      facilityId: fixture.scope.facilityId,
      employeeNumber: `ROS-${suffix}-${label}`,
      firstName: 'Synthetic',
      lastName: label,
      departmentId: fixture.nursing,
      employmentType: 'PERMANENT',
      employmentStatus: 'ACTIVE',
      hireDate: '2020-01-01',
    })
    .returning();
  return row;
}

describeDb('HR duty roster, shifts and attendance', () => {
  beforeAll(async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: `Synthetic roster ${suffix}`, slug: `roster-${suffix.toLowerCase()}` })
      .returning();
    const [outsider] = await db
      .insert(schema.tenants)
      .values({ name: `Synthetic roster outsider ${suffix}`, slug: `roster-out-${suffix.toLowerCase()}` })
      .returning();
    const [facility] = await db
      .insert(schema.facilities)
      .values({
        tenantId: tenant.id,
        code: `ROS-${suffix}`,
        name: 'Synthetic roster facility',
        enabledModules: ['hr'],
      })
      .returning();
    const [foreignFacility] = await db
      .insert(schema.facilities)
      .values({
        tenantId: outsider.id,
        code: `ROO-${suffix}`,
        name: 'Synthetic roster outsider facility',
        enabledModules: ['hr'],
      })
      .returning();
    const [actor] = await db
      .insert(schema.users)
      .values({
        uid: `usr_${randomUUID()}`,
        tenantId: tenant.id,
        facilityId: facility.id,
        username: `roster.${suffix.toLowerCase()}`,
        email: `roster.${suffix.toLowerCase()}@example.test`,
        fullName: 'Synthetic roster actor',
        passwordHash: 'x',
        accountStatus: 'ACTIVE',
        isActive: true,
      })
      .returning();
    const [outsiderActor] = await db
      .insert(schema.users)
      .values({
        uid: `usr_${randomUUID()}`,
        tenantId: outsider.id,
        facilityId: foreignFacility.id,
        username: `roo.${suffix.toLowerCase()}`,
        email: `roo.${suffix.toLowerCase()}@example.test`,
        fullName: 'Synthetic outsider actor',
        passwordHash: 'x',
        accountStatus: 'ACTIVE',
        isActive: true,
      })
      .returning();

    const [nursing] = await db
      .insert(schema.hrDepartments)
      .values({ tenantId: tenant.id, facilityId: facility.id, code: `N${suffix.slice(0, 4)}`, name: 'Nursing' })
      .returning();
    const [finance] = await db
      .insert(schema.hrDepartments)
      .values({ tenantId: tenant.id, facilityId: facility.id, code: `F${suffix.slice(0, 4)}`, name: 'Finance' })
      .returning();

    const [nurse] = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: tenant.id,
        facilityId: facility.id,
        employeeNumber: `ROS-${suffix}-01`,
        firstName: 'Synthetic',
        lastName: 'Nurse',
        departmentId: nursing.id,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();
    const [accountant] = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: tenant.id,
        facilityId: facility.id,
        employeeNumber: `ROS-${suffix}-02`,
        firstName: 'Synthetic',
        lastName: 'Accountant',
        departmentId: finance.id,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();

    fixture.scope = {
      tenantId: tenant.id,
      facilityId: facility.id,
      actorId: actor.id,
      actorName: 'Synthetic roster actor',
    };
    fixture.foreignScope = {
      tenantId: outsider.id,
      facilityId: foreignFacility.id,
      actorId: outsiderActor.id,
      actorName: 'Synthetic outsider actor',
    };
    fixture.nursing = nursing.id;
    fixture.finance = finance.id;
    fixture.nurseId = nurse.id;
    fixture.accountantId = accountant.id;
    const clock = localClock(new Date(), ZONE);
    fixture.today = clock.date;
    fixture.nowMinutes = clock.minutes;

    await saveAttendancePolicy(fixture.scope, {
      graceMinutes: 10,
      absenceCutoffMinutes: 240,
      timeZone: ZONE,
    });
  });

  /* ---------------- 1 & 9: a shift is a template ---------------- */

  it('1. creates a shift as a template, with no roster entry and no attendance', async () => {
    const before = await db.select().from(schema.hrAttendance);
    const shift = await createShift(fixture.scope, {
      name: `Day ${suffix}`,
      description: 'Standard day cover',
      startTime: '07:00',
      endTime: '18:00',
      breakMinutes: 60,
    });
    expect(shift.startTime).toBe('07:00');
    expect(shift.endTime).toBe('18:00');
    expect(shift.breakMinutes).toBe(60);
    expect(shift.overnight).toBe(false);
    expect(shift.scheduledMinutes).toBe(600);
    expect(shift.expectedHours).toBe(10);

    const roster = await listRoster(fixture.scope, { from: fixture.today, to: fixture.today });
    expect(roster.some((entry) => entry.shiftId === shift.id)).toBe(false);
    const after = await db.select().from(schema.hrAttendance);
    expect(after.length).toBe(before.length);
  });

  it('marks a shift whose end precedes its start as overnight and subtracts the break', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Night ${suffix}`,
      description: 'Overnight cover',
      startTime: '19:00',
      endTime: '07:00',
      breakMinutes: 45,
    });
    expect(shift.overnight).toBe(true);
    /* 12 hours on the clock minus 45 minutes of break. */
    expect(shift.scheduledMinutes).toBe(675);
    expect(shift.expectedHours).toBe(11.25);
    const listed = (await listShifts(fixture.scope)).find((row) => row.id === shift.id);
    expect(listed?.overnight).toBe(true);
  });

  it('refuses a duplicate shift name and a shift with identical start and end', async () => {
    const name = `Duplicate ${suffix}`;
    await createShift(fixture.scope, { name, startTime: '08:00', endTime: '16:00' });
    await expectRefusal(
      createShift(fixture.scope, { name, startTime: '09:00', endTime: '17:00' }),
      'SHIFT_EXISTS',
    );
    await expectRefusal(
      createShift(fixture.scope, { name: `Same ${suffix}`, startTime: '08:00', endTime: '08:00' }),
      'INVALID_TIME',
    );
  });

  it('keeps shifts tenant-scoped: another facility cannot see or assign them', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Scoped ${suffix}`,
      startTime: '06:00',
      endTime: '14:00',
    });
    const foreign = await listShifts(fixture.foreignScope);
    expect(foreign.some((row) => row.id === shift.id)).toBe(false);
    await expectRefusal(
      assignRoster(fixture.foreignScope, {
        employeeId: fixture.nurseId,
        shiftId: shift.id,
        workDate: fixture.today,
      }),
      'SHIFT_NOT_FOUND',
    );
  });

  /* ---------------- 2 & 3: assignment and the roster ---------------- */

  it('2–3. assigns an employee to a shift for today and lists them as rostered', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Roster ${suffix}`,
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
    });
    const result = await assignRoster(fixture.scope, {
      employeeId: fixture.nurseId,
      shiftId: shift.id,
      workDate: fixture.today,
    });
    expect(result.saved).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const roster = await listRoster(fixture.scope, { from: fixture.today, to: fixture.today });
    const entry = roster.find((row) => row.employeeId === fixture.nurseId);
    expect(entry?.shiftId).toBe(shift.id);
    expect(entry?.status).toBe('ASSIGNED');
    expect(entry?.employeeNumber).toBe(`ROS-${suffix}-01`);
    expect(entry?.departmentName).toBe('Nursing');
    expect(entry?.scheduledMinutes).toBe(480);

    const day = await attendanceForDate(fixture.scope, fixture.today);
    const row = day.rows.find((item) => item.employeeId === fixture.nurseId);
    expect(row?.shiftName).toBe(`Roster ${suffix}`);
    expect(row?.rosterEntryId).toBe(entry?.id);
    expect(row?.clockInAt).toBeNull();
  });

  it('refuses a duplicate assignment and a conflicting second shift', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Conflict ${suffix}`,
      startTime: '09:00',
      endTime: '17:00',
    });
    await assignRoster(fixture.scope, {
      employeeId: fixture.accountantId,
      shiftId: shift.id,
      workDate: fixture.today,
    });
    await expectRefusal(
      assignRoster(fixture.scope, {
        employeeId: fixture.accountantId,
        shiftId: shift.id,
        workDate: fixture.today,
      }),
      'ROSTER_DUPLICATE',
    );
    const other = await createShift(fixture.scope, {
      name: `Other ${suffix}`,
      startTime: '18:00',
      endTime: '22:00',
    });
    await expectRefusal(
      assignRoster(fixture.scope, {
        employeeId: fixture.accountantId,
        shiftId: other.id,
        workDate: fixture.today,
      }),
      'ROSTER_CONFLICT',
    );
  });

  it('replaces a conflicting assignment only when the facility policy allows it', async () => {
    const first = await createShift(fixture.scope, {
      name: `Policy A ${suffix}`,
      startTime: '07:00',
      endTime: '15:00',
    });
    const second = await createShift(fixture.scope, {
      name: `Policy B ${suffix}`,
      startTime: '15:00',
      endTime: '23:00',
    });
    const date = fixture.today;
    const employee = await makeEmployee('Policy');
    await assignRoster(fixture.scope, {
      employeeId: employee.id,
      shiftId: first.id,
      workDate: date,
    });
    await saveAttendancePolicy(fixture.scope, {
      graceMinutes: 10,
      absenceCutoffMinutes: 240,
      timeZone: ZONE,
      allowRosterConflicts: true,
    });
    const replaced = await assignRoster(fixture.scope, {
      employeeId: employee.id,
      shiftId: second.id,
      workDate: date,
    });
    expect(replaced.saved).toHaveLength(1);
    const roster = await listRoster(fixture.scope, { from: date, to: date });
    expect(roster.find((row) => row.employeeId === employee.id)?.shiftId).toBe(second.id);
    await saveAttendancePolicy(fixture.scope, {
      graceMinutes: 10,
      absenceCutoffMinutes: 240,
      timeZone: ZONE,
      allowRosterConflicts: false,
    });
  });

  it('refuses a department-scoped shift for an employee from another department', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Nursing only ${suffix}`,
      startTime: '08:00',
      endTime: '16:00',
      departmentId: fixture.nursing,
    });
    await expectRefusal(
      assignRoster(fixture.scope, {
        employeeId: fixture.accountantId,
        shiftId: shift.id,
        workDate: fixture.today,
      }),
      'SHIFT_DEPARTMENT_MISMATCH',
    );
    const nursingEmployee = await makeEmployee('Nursing');
    const ok = await assignRoster(fixture.scope, {
      employeeId: nursingEmployee.id,
      shiftId: shift.id,
      workDate: fixture.today,
    });
    expect(ok.saved).toHaveLength(1);
  });

  it('refuses an inactive shift', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Retired ${suffix}`,
      startTime: '10:00',
      endTime: '18:00',
    });
    await updateShift(fixture.scope, shift.id, {
      name: `Retired ${suffix}`,
      startTime: '10:00',
      endTime: '18:00',
      isActive: false,
    });
    await expectRefusal(
      assignRoster(fixture.scope, {
        employeeId: fixture.accountantId,
        shiftId: shift.id,
        workDate: fixture.today,
      }),
      'SHIFT_INACTIVE',
    );
  });

  it('cancels an assignment while keeping it for the audit trail', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Cancelled ${suffix}`,
      startTime: '11:00',
      endTime: '19:00',
    });
    const employee = await makeEmployee('Cancelled');
    const result = await assignRoster(fixture.scope, {
      employeeId: employee.id,
      shiftId: shift.id,
      workDate: fixture.today,
    });
    const id = result.saved[0].id;
    await cancelRosterEntry(fixture.scope, id, { reason: 'Synthetic cancellation' });
    const active = await listRoster(fixture.scope, { from: fixture.today, to: fixture.today });
    expect(active.some((row) => row.id === id)).toBe(false);
    const all = await listRoster(fixture.scope, {
      from: fixture.today,
      to: fixture.today,
      includeCancelled: true,
    });
    const cancelled = all.find((row) => row.id === id);
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.cancelReason).toBe('Synthetic cancellation');
    await expectRefusal(
      cancelRosterEntry(fixture.scope, id, { reason: 'Again' }),
      'ROSTER_ALREADY_CANCELLED',
    );
  });

  /* ---------------- 4–8: clock-in and clock-out ---------------- */

  it('4–6. records a server clock-in, then a clock-out, and survives a re-read', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Clock ${suffix}`,
      startTime: timeFromMinutes(fixture.nowMinutes - 60),
      endTime: timeFromMinutes(fixture.nowMinutes + 300),
      breakMinutes: 30,
    });
    const employee = await makeEmployee('Clock');
    await assignRoster(fixture.scope, {
      employeeId: employee.id,
      shiftId: shift.id,
      workDate: fixture.today,
    });

    const before = await attendanceForDate(fixture.scope, fixture.today);
    const beforeRow = before.rows.find((row) => row.employeeId === employee.id);
    expect(beforeRow?.canClockIn).toBe(true);
    expect(beforeRow?.canClockOut).toBe(false);
    expect(beforeRow?.clockInAt).toBeNull();

    const started = await clockIn(fixture.scope, { employeeId: employee.id });
    expect(started.status).toBe('LATE');
    expect(started.lateMinutes).toBeGreaterThan(0);
    expect(started.lateMinutes).toBeLessThanOrEqual(70);
    expect(started.attendance.clockInAt).toBeInstanceOf(Date);

    const afterIn = await attendanceForDate(fixture.scope, fixture.today);
    const inRow = afterIn.rows.find((row) => row.employeeId === employee.id);
    expect(inRow?.attendanceState).toBe('CLOCKED_IN');
    expect(inRow?.canClockIn).toBe(false);
    expect(inRow?.canClockOut).toBe(true);
    expect(inRow?.clockInAt).toBe(started.attendance.clockInAt?.toISOString());

    const out = await clockOut(fixture.scope, { employeeId: employee.id });
    /* Actual time on site, not the scheduled window minus its break: a short
       attendance must not be reported as zero minutes worked. */
    const elapsedMinutes = Math.max(
      0,
      Math.round(
        ((out.attendance.clockOutAt as Date).getTime() -
          (started.attendance.clockInAt as Date).getTime()) /
          60_000,
      ),
    );
    expect(out.workedMinutes).toBe(elapsedMinutes);
    expect(out.attendance.clockOutAt).toBeInstanceOf(Date);

    const done = await attendanceForDate(fixture.scope, fixture.today);
    const doneRow = done.rows.find((row) => row.employeeId === employee.id);
    expect(doneRow?.attendanceState).toBe('CLOCKED_OUT');
    expect(doneRow?.clockOutAt).toBe(out.attendance.clockOutAt?.toISOString());
    expect(doneRow?.status).toBe('LATE');
  });

  it('5. late arrival is measured against the shift start and the configured grace', () => {
    /* Start 07:00, arrive 07:05 → inside 10 minutes of grace. */
    expect(lateMinutesFor(7 * 60 + 5, 7 * 60, 0, 10)).toBe(0);
    /* Arrive 07:25 → 15 minutes late after the grace period. */
    expect(lateMinutesFor(7 * 60 + 25, 7 * 60, 0, 10)).toBe(15);
    /* A night shift starting 19:00, clocked at 00:30 the next day → 5h20m late. */
    expect(lateMinutesFor(30, 19 * 60, 1, 10)).toBe(320);
    expect(shiftTiming({ startTime: '19:00', endTime: '07:00', breakMinutes: 0 }).overnight).toBe(
      true,
    );
  });

  it('7. refuses a clock-in for an employee with no roster assignment', async () => {
    const [stranger] = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: fixture.scope.tenantId,
        facilityId: fixture.scope.facilityId,
        employeeNumber: `ROS-${suffix}-03`,
        firstName: 'Synthetic',
        lastName: 'Unrostered',
        departmentId: fixture.nursing,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();
    await expectRefusal(clockIn(fixture.scope, { employeeId: stranger.id }), 'NO_ROSTER_ASSIGNMENT');
  });

  it('11. refuses a duplicate clock-in and a clock-out with nothing open', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Duplicate clock ${suffix}`,
      startTime: timeFromMinutes(fixture.nowMinutes - 30),
      endTime: timeFromMinutes(fixture.nowMinutes + 240),
    });
    const [worker] = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: fixture.scope.tenantId,
        facilityId: fixture.scope.facilityId,
        employeeNumber: `ROS-${suffix}-04`,
        firstName: 'Synthetic',
        lastName: 'Duplicate',
        departmentId: fixture.nursing,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();
    await assignRoster(fixture.scope, {
      employeeId: worker.id,
      shiftId: shift.id,
      workDate: fixture.today,
    });
    await clockIn(fixture.scope, { employeeId: worker.id });
    await expectRefusal(clockIn(fixture.scope, { employeeId: worker.id }), 'ALREADY_CLOCKED_IN');
    await clockOut(fixture.scope, { employeeId: worker.id });
    await expectRefusal(clockOut(fixture.scope, { employeeId: worker.id }), 'NOT_CLOCKED_IN');
  });

  it('8. works out hours and overtime from actual clock instants', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Overtime ${suffix}`,
      startTime: '08:00',
      endTime: '18:00',
      breakMinutes: 60,
    });
    const [worker] = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: fixture.scope.tenantId,
        facilityId: fixture.scope.facilityId,
        employeeNumber: `ROS-${suffix}-05`,
        firstName: 'Synthetic',
        lastName: 'Overtime',
        departmentId: fixture.nursing,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();
    await assignRoster(fixture.scope, {
      employeeId: worker.id,
      shiftId: shift.id,
      workDate: fixture.today,
    });
    await clockIn(fixture.scope, { employeeId: worker.id });
    const corrected = await correctAttendance(fixture.scope, {
      employeeId: worker.id,
      workDate: fixture.today,
      clockInAt: `${fixture.today}T08:00:00+03:00`,
      clockOutAt: `${fixture.today}T19:30:00+03:00`,
      reason: 'Synthetic overtime verification',
    });
    expect(corrected.workedMinutes).toBe(690);
    expect(corrected.scheduledMinutes).toBe(540);
    expect(corrected.overtimeMinutes).toBe(150);
  });

  /* ---------------- 10: excused states ---------------- */

  it('10. reports approved leave, holiday and off duty instead of absence', async () => {
    const [leaveType] = await db
      .insert(schema.hrLeaveTypes)
      .values({
        tenantId: fixture.scope.tenantId,
        facilityId: fixture.scope.facilityId,
        code: `AN${suffix.slice(0, 3)}`,
        name: 'Annual leave',
        annualEntitlementDays: '21.00',
        paid: true,
        requiresApproval: true,
      })
      .returning();
    const [leaveRequest] = await db.insert(schema.hrLeaveRequests).values({
      tenantId: fixture.scope.tenantId,
      facilityId: fixture.scope.facilityId,
      employeeId: fixture.nurseId,
      leaveTypeId: leaveType.id,
      startDate: fixture.today,
      endDate: fixture.today,
      days: '1.00',
      status: 'APPROVED',
      decidedBy: fixture.scope.actorId,
      decidedAt: new Date(),
      reason: 'Synthetic approved leave',
    }).returning();

    const offDuty = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: fixture.scope.tenantId,
        facilityId: fixture.scope.facilityId,
        employeeNumber: `ROS-${suffix}-06`,
        firstName: 'Synthetic',
        lastName: 'Offduty',
        departmentId: fixture.nursing,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();
    await recordAttendance(fixture.scope, {
      employeeId: offDuty[0].id,
      workDate: fixture.today,
      status: 'OFF_DUTY',
      notes: 'Synthetic off-duty day',
    });

    const day = await attendanceForDate(fixture.scope, fixture.today);
    const leaveRow = day.rows.find((row) => row.employeeId === fixture.nurseId);
    const offRow = day.rows.find((row) => row.employeeId === offDuty[0].id);
    expect(leaveRow?.status).toBe('LEAVE');
    expect(leaveRow?.attendanceState).toBe('EXCUSED');
    expect(offRow?.status).toBe('OFF_DUTY');
    expect(day.summary.onLeave).toBeGreaterThanOrEqual(1);
    expect(day.summary.offDuty).toBeGreaterThanOrEqual(1);

    const holiday = await createHoliday(fixture.scope, {
      holidayDate: fixture.today,
      name: `Synthetic holiday ${suffix}`,
    });
    const holidayDay = await attendanceForDate(fixture.scope, fixture.today);
    const holidayRow = holidayDay.rows.find((row) => row.employeeId === offDuty[0].id);
    expect(holidayRow?.status).toBe('HOLIDAY');
    expect(holidayDay.summary.absent).toBe(0);

    /* Leave the day exactly as it was found, so later scenarios are not excused. */
    await deleteHoliday(fixture.scope, holiday.id);
    await db
      .update(schema.hrLeaveRequests)
      .set({ status: 'CANCELLED', decidedBy: null, decidedAt: null })
      .where(eq(schema.hrLeaveRequests.id, leaveRequest.id));
  });

  it('10. refuses a hand-recorded PRESENT: only the clock may say present', async () => {
    await expectRefusal(
      recordAttendance(fixture.scope, {
        employeeId: fixture.accountantId,
        workDate: fixture.today,
        status: 'PRESENT',
      }),
      'INVALID_STATUS',
    );
  });

  /* ---------------- absence and cutoff ---------------- */

  it('12. calls a past rostered day absent, but not today before the cutoff', async () => {
    const shift = await createShift(fixture.scope, {
      name: `Absence ${suffix}`,
      startTime: '08:00',
      endTime: '17:00',
    });
    const [worker] = await db
      .insert(schema.hrEmployees)
      .values({
        tenantId: fixture.scope.tenantId,
        facilityId: fixture.scope.facilityId,
        employeeNumber: `ROS-${suffix}-07`,
        firstName: 'Synthetic',
        lastName: 'Absent',
        departmentId: fixture.nursing,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        hireDate: '2020-01-01',
      })
      .returning();
    const yesterday = new Date(Date.parse(`${fixture.today}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await assignRoster(fixture.scope, {
      employeeId: worker.id,
      shiftId: shift.id,
      workDate: yesterday,
    });
    const past = await attendanceForDate(fixture.scope, yesterday);
    expect(past.rows.find((row) => row.employeeId === worker.id)?.status).toBe('ABSENT');

    /* Today: a shift that has not reached its cutoff yet is "not clocked in". */
    const later = await createShift(fixture.scope, {
      name: `Later ${suffix}`,
      startTime: timeFromMinutes(fixture.nowMinutes + 60),
      endTime: timeFromMinutes(fixture.nowMinutes + 480),
    });
    await assignRoster(fixture.scope, {
      employeeId: worker.id,
      shiftId: later.id,
      workDate: fixture.today,
    });
    const today = await attendanceForDate(fixture.scope, fixture.today);
    const row = today.rows.find((item) => item.employeeId === worker.id);
    expect(row?.status).toBeNull();
    expect(row?.attendanceState).toBe('NOT_STARTED');
    expect(today.summary.notClockedIn).toBeGreaterThanOrEqual(1);
  });

  it('13. records a correction with a reason, the actor and the previous values', async () => {
    await expectRefusal(
      correctAttendance(fixture.scope, {
        employeeId: fixture.nurseId,
        workDate: fixture.today,
        reason: 'no',
        status: 'TRAINING',
      }),
      'INVALID_INPUT',
    );
    const before = await db
      .select()
      .from(schema.hrAttendance)
      .where(
        eq(schema.hrAttendance.employeeId, fixture.nurseId),
      )
      .limit(1);
    const previousStatus = before[0]?.status ?? null;

    const corrected = await correctAttendance(fixture.scope, {
      employeeId: fixture.nurseId,
      workDate: fixture.today,
      status: 'TRAINING',
      reason: 'Synthetic training day approved by the facility manager',
    });
    expect(corrected.status).toBe('TRAINING');
    expect(corrected.correctedAt).toBeInstanceOf(Date);

    const corrections = await db
      .select()
      .from(schema.hrAttendanceCorrections)
      .where(eq(schema.hrAttendanceCorrections.attendanceId, corrected.id));
    expect(corrections.length).toBeGreaterThanOrEqual(1);
    const latest = corrections[0];
    expect(latest.reason).toBe('Synthetic training day approved by the facility manager');
    expect(latest.correctedBy).toBe(fixture.scope.actorId);
    expect(latest.correctedByName).toBe('Synthetic roster actor');
    expect(latest.previousStatus).toBe(previousStatus);
    expect(latest.newStatus).toBe('TRAINING');
  });

  /* ---------------- 14: facility-local dates ---------------- */

  it('14. derives the work date from the facility time zone, not from UTC', () => {
    /* 22:30 UTC is already the next day in Nairobi (UTC+3). */
    const instant = new Date('2026-11-20T22:30:00Z');
    expect(localClock(instant, ZONE).date).toBe('2026-11-21');
    expect(localClock(instant, ZONE).minutes).toBe(90);
    expect(localClock(instant, 'UTC').date).toBe('2026-11-20');
  });

  it('15. exposes the attendance policy that drives grace and cutoff', async () => {
    const policy = await getAttendancePolicy(fixture.scope);
    expect(policy.timeZone).toBe(ZONE);
    expect(policy.graceMinutes).toBe(10);
    expect(policy.absenceCutoffMinutes).toBe(240);
  });
});
