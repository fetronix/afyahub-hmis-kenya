import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  computeStatute,
  type StatutoryVersion,
  type CalculationConfig,
} from '../../workforce/payroll-calculator.ts';
// Arbitrary arithmetic fixtures, not statutory rate configuration or an authority claim.
const config: CalculationConfig = {
  deductNssf: true,
  deductShif: true,
  deductAhl: true,
  employeeMinimumCents: '0',
  employerMinimumCents: '0',
};
const version = (
  statute: StatutoryVersion['statute'],
  rate: number,
  employer = 0,
): StatutoryVersion => ({
  id: 1,
  statute,
  label: 'Synthetic policy fixture',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  authority: 'TEST ONLY',
  sourceReference: 'SYNTHETIC ARITHMETIC, NOT AUTHORITY',
  status: 'ACTIVE',
  calculationConfig: { ...config },
  bands: [
    {
      sequence: 1,
      lowerBoundCents: 0n,
      upperBoundCents: null,
      employeeRateBp: rate,
      employerRateBp: employer,
      employeeFixedCents: 0n,
      employerFixedCents: 0n,
      employeeCapCents: null,
      employerCapCents: null,
      reliefCents: 0n,
    },
  ],
});
const versions = () => ({
  PAYE: version('PAYE', 1000),
  NSSF: version('NSSF', 600, 600),
  SHIF: {
    ...version('SHIF', 275),
    calculationConfig: { ...config, employeeMinimumCents: '30000' },
  },
  AHL: version('AHL', 150, 150),
});
const employee = {
  employeeId: 1,
  employeeNumber: 'SYN',
  fullName: 'Synthetic',
  baseSalaryCents: 100000n,
  components: [],
};
describe('effective-dated contribution policy extension', () => {
  it('applies a contribution minimum as a floor, not a fixed additional charge', () => {
    const rule = versions().SHIF;
    expect(computeStatute('SHIF', 100000n, rule).employeeCents).toBe('30000');
    expect(computeStatute('SHIF', 2000000n, rule).employeeCents).toBe('55000');
  });
  it('deducts configured employee AHL before PAYE without deducting the employer share', () => {
    const result = calculatePayslip({ employee, versions: versions(), payDate: '2026-10-27' });
    expect(result.taxableCents).toBe(62500n);
    expect(result.payeCents).toBe(6250n);
    expect(result.netCents).toBe(56250n);
    expect(result.statutes.find((s) => s.statute === 'PAYE')?.calculationConfig?.deductAhl).toBe(
      true,
    );
  });
  it('preserves historical policy when no new config is present rather than rewriting old figures', () => {
    const rules = versions();
    rules.PAYE.calculationConfig = null;
    expect(
      calculatePayslip({ employee, versions: rules, payDate: '2026-01-01' }).taxableCents,
    ).toBe(64000n);
  });
  it('records an explicit irregular earning exclusion for its contribution base only', () => {
    const result = calculatePayslip({
      employee: {
        ...employee,
        components: [
          {
            code: 'BONUS',
            name: 'Synthetic irregular earning',
            kind: 'EARNING',
            taxable: true,
            amountCents: 100000n,
            statutoryExclusions: ['AHL'],
          },
        ],
      },
      versions: versions(),
      payDate: '2026-10-27',
    });
    expect(result.grossCents).toBe(200000n);
    expect(result.ahlEmployeeCents).toBe(1500n);
    expect(result.nssfEmployeeCents).toBe(12000n);
    expect(result.netCents).toBe(140850n);
  });
});
