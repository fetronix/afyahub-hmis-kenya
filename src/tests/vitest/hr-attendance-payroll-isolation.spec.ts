/**
 * Attendance must never leak into payroll on its own.
 *
 * The brief allows payroll to consume *approved* attendance where a facility has
 * configured that. This application has no such configuration, so the rule is
 * stricter: the payroll engine receives salary and registered components only.
 * Clocked hours, late minutes and computed overtime are recorded for the
 * attendance dashboard and are not paid automatically.
 *
 * These are source-shape assertions on purpose. They fail the moment someone
 * wires `hrAttendance` into the payroll input builder, which is exactly the
 * change that would silently turn an unapproved overtime minute into money.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('attendance and payroll stay separate', () => {
  it.each(['workforce/payroll-calculator.ts', 'workforce/payroll-readiness.ts'])(
    '%s has no attendance input',
    (path) => {
      const source = read(path);
      for (const token of [
        'hrAttendance',
        'clockInAt',
        'clockOutAt',
        'workedMinutes',
        'overtimeMinutes',
        'lateMinutes',
      ]) {
        expect(source.includes(token), `${path} must not reference ${token}`).toBe(false);
      }
    },
  );

  it('the payroll run builds each employee from salary and components only', () => {
    const source = read('workforce/workforce.service.ts');
    const marker = source.indexOf('employees: employees.map<PayrollEmployeeInput>');
    expect(marker, 'the payroll input mapping exists').toBeGreaterThan(-1);
    const block = source.slice(marker, marker + 1800);
    for (const token of ['hrAttendance', 'clockInAt', 'workedMinutes', 'overtimeMinutes']) {
      expect(block.includes(token), `the payroll mapping must not read ${token}`).toBe(false);
    }
    expect(block).toContain('baseSalaryCents');
    expect(block).toContain('components');
  });

  it('records overtime on the attendance record rather than a payslip component', () => {
    const source = read('workforce/workforce.service.ts');
    /* Overtime is written to hr_attendance and nowhere else. */
    const writes = source.match(/overtimeMinutes,/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    const payslipWrites = source.match(/payrollPayslips\)[\s\S]{0,400}overtime/);
    expect(payslipWrites).toBeNull();
  });
});
