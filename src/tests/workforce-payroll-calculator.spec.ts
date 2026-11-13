/**
 * Payroll calculator — pure-function tests.
 *
 * These fixtures are deliberately NOT Kenyan statutory rates. They exist to
 * prove the engine's arithmetic and its refusal behaviour; the application
 * ships no rates of its own and a real facility must record the authority's
 * published figures with effective dates.
 */

import { describe, expect, it } from 'vitest';

import {
  applyRateBp,
  calculatePayroll,
  calculatePayslip,
  computeStatute,
  PayrollCalculationError,
  resolveStatutoryVersions,
  statuteAppliesOn,
  type StatutoryBand,
  type StatutoryVersion,
} from '../workforce/payroll-calculator.ts';

const band = (overrides: Partial<StatutoryBand> = {}): StatutoryBand => ({
  sequence: 1,
  lowerBoundCents: 0n,
  upperBoundCents: null,
  employeeRateBp: 0,
  employerRateBp: 0,
  employeeFixedCents: 0n,
  employerFixedCents: 0n,
  employeeCapCents: null,
  employerCapCents: null,
  reliefCents: 0n,
  ...overrides,
});

const version = (overrides: Partial<StatutoryVersion> = {}): StatutoryVersion => ({
  id: 1,
  statute: 'PAYE',
  label: 'Fixture version',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  authority: 'Test fixture — not an authority',
  sourceReference: 'TEST FIXTURE — NOT A STATUTORY PUBLICATION',
  status: 'ACTIVE',
  bands: [band()],
  ...overrides,
});

const versions = (): Record<'PAYE' | 'NSSF' | 'SHIF' | 'AHL', StatutoryVersion> => ({
  PAYE: version({ id: 11, statute: 'PAYE', bands: [band({ reliefCents: 24_000n })] }),
  NSSF: version({
    id: 12,
    statute: 'NSSF',
    bands: [
      band({
        employeeRateBp: 600,
        employerRateBp: 600,
        employeeCapCents: 21_600n,
        employerCapCents: 21_600n,
      }),
    ],
  }),
  SHIF: version({ id: 13, statute: 'SHIF', bands: [band({ employeeRateBp: 275 })] }),
  AHL: version({
    id: 14,
    statute: 'AHL',
    bands: [band({ employeeRateBp: 150, employerRateBp: 150 })],
  }),
});

describe('applyRateBp', () => {
  it('applies basis points half-up without floating point', () => {
    expect(applyRateBp(100_000n, 275)).toBe(2_750n);
    // 1 cent at 50% is 0.5 cents, rounded half-up to 1.
    expect(applyRateBp(1n, 5_000)).toBe(1n);
    // 3 cents at 50% is 1.5 cents, rounded half-up to 2.
    expect(applyRateBp(3n, 5_000)).toBe(2n);
  });

  it('refuses a negative or out-of-range rate', () => {
    expect(() => applyRateBp(100n, -1)).toThrow(PayrollCalculationError);
    expect(() => applyRateBp(100n, 10_001)).toThrow(PayrollCalculationError);
    expect(() => applyRateBp(100n, 1.5)).toThrow(PayrollCalculationError);
  });
});

describe('statuteAppliesOn', () => {
  const v = version({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' });

  it('includes the first and last day', () => {
    expect(statuteAppliesOn(v, '2026-01-01')).toBe(true);
    expect(statuteAppliesOn(v, '2026-06-30')).toBe(true);
  });

  it('excludes the day before and after', () => {
    expect(statuteAppliesOn(v, '2025-12-31')).toBe(false);
    expect(statuteAppliesOn(v, '2026-07-01')).toBe(false);
  });

  it('ignores a version that is not ACTIVE', () => {
    expect(statuteAppliesOn({ ...v, status: 'DRAFT' }, '2026-03-01')).toBe(false);
    expect(statuteAppliesOn({ ...v, status: 'RETIRED' }, '2026-03-01')).toBe(false);
  });
});

describe('resolveStatutoryVersions', () => {
  it('resolves exactly one active version per statute', () => {
    const resolved = resolveStatutoryVersions(Object.values(versions()), '2026-05-01');
    expect(resolved.PAYE.id).toBe(11);
    expect(resolved.AHL.id).toBe(14);
  });

  it('refuses a pay date no version covers', () => {
    expect(() => resolveStatutoryVersions(Object.values(versions()), '2020-01-01')).toThrowError(
      /No active (PAYE|NSSF|SHIF|AHL) version covers 2020-01-01/,
    );
  });

  it('refuses two active versions covering the same date', () => {
    const duplicated = [...Object.values(versions()), version({ id: 99, statute: 'SHIF' })];
    expect(() => resolveStatutoryVersions(duplicated, '2026-05-01')).toThrowError(
      /More than one active SHIF version/,
    );
  });

  it('refuses an active version with no bands', () => {
    const empty = [
      ...Object.values(versions()).filter((v) => v.statute !== 'AHL'),
      version({ id: 15, statute: 'AHL', bands: [] }),
    ];
    expect(() => resolveStatutoryVersions(empty, '2026-05-01')).toThrowError(/has no bands/);
  });
});

describe('computeStatute', () => {
  it('taxes each PAYE band progressively', () => {
    const paye = version({
      bands: [
        band({
          sequence: 1,
          lowerBoundCents: 0n,
          upperBoundCents: 2_400_000n,
          employeeRateBp: 1_000,
        }),
        band({
          sequence: 2,
          lowerBoundCents: 2_400_000n,
          upperBoundCents: 3_233_333n,
          employeeRateBp: 2_500,
        }),
        band({
          sequence: 3,
          lowerBoundCents: 3_233_333n,
          upperBoundCents: null,
          employeeRateBp: 3_000,
        }),
      ],
    });
    const result = computeStatute('PAYE', 4_000_000n, paye);
    // 2,400,000 @10% = 240,000; 833,333 @25% = 208,333.25 → 208,333;
    // 766,667 @30% = 230,000.1 → 230,000.
    expect(result.employeeCents).toBe('678333');
  });

  it('caps relief at the tax due and never refunds', () => {
    const paye = version({ bands: [band({ employeeRateBp: 1_000, reliefCents: 1_000_000n })] });
    const result = computeStatute('PAYE', 1_000_000n, paye);
    expect(result.employeeCents).toBe('0');
    expect(result.reliefCents).toBe('100000');
  });

  it('applies a ceiling to the amount charged, not the base', () => {
    const nssf = version({
      statute: 'NSSF',
      bands: [band({ employeeRateBp: 600, employeeCapCents: 21_600n })],
    });
    const result = computeStatute('NSSF', 10_000_000n, nssf);
    expect(result.employeeCents).toBe('21600');
  });

  it('requires SHIF to be a single band', () => {
    const shif = version({ statute: 'SHIF', bands: [band(), band({ sequence: 2 })] });
    expect(() => computeStatute('SHIF', 100_000n, shif)).toThrowError(/exactly one band/);
  });

  it('refuses a negative base', () => {
    expect(() => computeStatute('NSSF', -1n, version())).toThrow(PayrollCalculationError);
  });
});

describe('calculatePayslip', () => {
  it('deducts statutory amounts and employer contributions separately', () => {
    const slip = calculatePayslip({
      employee: {
        employeeId: 1,
        employeeNumber: 'SYN-1',
        fullName: 'Synthetic Worker',
        baseSalaryCents: 6_500_000n,
        components: [
          {
            code: 'HOUSE',
            name: 'House allowance',
            kind: 'EARNING',
            amountCents: 500_000n,
            taxable: true,
          },
          {
            code: 'SACCO',
            name: 'SACCO',
            kind: 'DEDUCTION',
            amountCents: 200_000n,
            taxable: false,
          },
        ],
      },
      versions: versions(),
      payDate: '2026-05-01',
    });

    expect(slip.grossCents).toBe(7_000_000n);
    // NSSF capped at 21,600; SHIF 2.75% of gross; levy 1.5% of gross.
    expect(slip.nssfEmployeeCents).toBe(21_600n);
    expect(slip.shifCents).toBe(192_500n);
    expect(slip.ahlEmployeeCents).toBe(105_000n);
    expect(slip.otherDeductionsCents).toBe(200_000n);
    expect(slip.netCents).toBe(
      slip.grossCents -
        slip.nssfEmployeeCents -
        slip.shifCents -
        slip.ahlEmployeeCents -
        slip.payeCents -
        slip.otherDeductionsCents,
    );
    // The payslip carries the version ids, so it can be explained later.
    expect(slip.statutes.map((s) => s.versionId)).toEqual([11, 12, 13, 14]);
  });

  it('refuses a payslip whose deductions exceed gross pay', () => {
    expect(() =>
      calculatePayslip({
        employee: {
          employeeId: 2,
          employeeNumber: 'SYN-2',
          fullName: 'Synthetic Worker',
          baseSalaryCents: 10_000n,
          components: [
            {
              code: 'LOAN',
              name: 'Loan',
              kind: 'DEDUCTION',
              amountCents: 100_000n,
              taxable: false,
            },
          ],
        },
        versions: versions(),
        payDate: '2026-05-01',
      }),
    ).toThrowError(/Deductions exceed gross pay/);
  });

  it('is reproducible: the same input produces the same payslip', () => {
    const input = {
      employee: {
        employeeId: 3,
        employeeNumber: 'SYN-3',
        fullName: 'Synthetic Worker',
        baseSalaryCents: 3_200_000n,
        components: [],
      },
      versions: versions(),
      payDate: '2026-05-01',
    };
    const first = calculatePayslip(input);
    const second = calculatePayslip(input);
    expect(first.netCents).toBe(second.netCents);
    expect(first.statutes).toEqual(second.statutes);
  });

  it('excludes a non-taxable earning from the PAYE base only', () => {
    const withAllowance = calculatePayslip({
      employee: {
        employeeId: 4,
        employeeNumber: 'SYN-4',
        fullName: 'Synthetic Worker',
        baseSalaryCents: 4_000_000n,
        components: [
          { code: 'MEAL', name: 'Meal', kind: 'EARNING', amountCents: 100_000n, taxable: false },
        ],
      },
      versions: versions(),
      payDate: '2026-05-01',
    });
    expect(withAllowance.grossCents).toBe(4_100_000n);
    expect(withAllowance.taxableCents).toBe(
      withAllowance.grossCents -
        withAllowance.nssfEmployeeCents -
        withAllowance.shifCents -
        100_000n,
    );
  });
});

describe('calculatePayroll', () => {
  it('refuses an empty employee list', () => {
    expect(() =>
      calculatePayroll({
        employees: [],
        versions: Object.values(versions()),
        payDate: '2026-05-01',
      }),
    ).toThrowError(/no active employees/i);
  });

  it('totals every payslip and reports the versions used', () => {
    const result = calculatePayroll({
      employees: [
        {
          employeeId: 1,
          employeeNumber: 'SYN-1',
          fullName: 'One',
          baseSalaryCents: 6_500_000n,
          components: [],
        },
        {
          employeeId: 2,
          employeeNumber: 'SYN-2',
          fullName: 'Two',
          baseSalaryCents: 3_200_000n,
          components: [],
        },
      ],
      versions: Object.values(versions()),
      payDate: '2026-05-01',
    });
    expect(result.payslips).toHaveLength(2);
    expect(result.totals.employeeCount).toBe(2);
    expect(result.totals.grossCents).toBe(
      result.payslips.reduce((sum, slip) => sum + slip.grossCents, 0n),
    );
    expect(result.totals.netCents).toBe(
      result.payslips.reduce((sum, slip) => sum + slip.netCents, 0n),
    );
    expect(result.versions.PAYE.id).toBe(11);
  });

  it('stops the whole run when one statute has no applicable version', () => {
    const missing = Object.values(versions()).filter((v) => v.statute !== 'SHIF');
    expect(() =>
      calculatePayroll({
        employees: [
          {
            employeeId: 1,
            employeeNumber: 'SYN-1',
            fullName: 'One',
            baseSalaryCents: 1_000_000n,
            components: [],
          },
        ],
        versions: missing,
        payDate: '2026-05-01',
      }),
    ).toThrowError(/No active SHIF version/);
  });
});
