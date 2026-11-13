import { describe, it, expect } from 'vitest';
import {
  assessPayrollAccounts,
  assessPayrollRules,
  payrollRuleIssues,
  PAYROLL_ACCOUNT_PURPOSES,
  type VerifiedPayrollVersion,
} from '../../workforce/payroll-readiness.ts';
// Arbitrary arithmetic only. No test data here is a deployable statutory-rate configuration.
const period = { startDate: '2026-06-01', endDate: '2026-06-30', payDate: '2026-06-30' };
const today = '2026-10-27';
const version = (
  statute: 'PAYE' | 'NSSF' | 'SHIF' | 'AHL',
  extra: Partial<VerifiedPayrollVersion> = {},
): VerifiedPayrollVersion => ({
  id: 1,
  statute,
  label: 'Synthetic policy',
  effectiveFrom: '2026-06-01',
  effectiveTo: '2026-06-30',
  authority: 'Synthetic test source',
  sourceReference: 'Synthetic evidence only',
  status: 'ACTIVE',
  verifiedOn: '2026-10-27',
  verifiedBy: 4,
  verificationPurpose: 'SYNTHETIC_TEST',
  verificationReference: 'Reviewed arithmetic fixture',
  calculationConfig: {
    deductNssf: true,
    deductShif: true,
    deductAhl: true,
    employeeMinimumCents: '0',
    employerMinimumCents: '0',
  },
  bands: [
    {
      sequence: 1,
      lowerBoundCents: 0n,
      upperBoundCents: null,
      employeeRateBp: 1000,
      employerRateBp: 0,
      employeeFixedCents: 0n,
      employerFixedCents: 0n,
      employeeCapCents: null,
      employerCapCents: null,
      reliefCents: 0n,
    },
  ],
  ...extra,
});
const rules = () =>
  ['PAYE', 'NSSF', 'SHIF', 'AHL'].map((s, i) =>
    version(s as VerifiedPayrollVersion['statute'], { id: i + 1 }),
  );
describe('payroll configuration checks, not production certification', () => {
  it('lists all required purposes without choosing account codes or creating accounts', () => {
    const r = assessPayrollAccounts(null, []);
    expect(r.ready).toBe(false);
    expect(r.mappings.filter((m) => m.required)).toHaveLength(7);
    expect(r.mappings.every((m) => m.account === null)).toBe(true);
    expect(r.mappings.at(-1)?.status).toBe('OPTIONAL');
  });
  it('identifies unavailable, inactive and wrong-type mappings even when IDs exist', () => {
    const r = assessPayrollAccounts(
      { salaryExpenseAccountId: 1, netPayPayableAccountId: 2, payePayableAccountId: 99 },
      [
        {
          id: 1,
          accountCode: 'LOCAL-X',
          accountName: 'Local expense',
          accountType: 'EXPENSE',
          isActive: false,
        },
        {
          id: 2,
          accountCode: 'LOCAL-Y',
          accountName: 'Wrong type',
          accountType: 'EXPENSE',
          isActive: true,
        },
      ],
    );
    expect(r.mappings.find((m) => m.key === 'salaryExpenseAccountId')?.status).toBe('INACTIVE');
    expect(r.mappings.find((m) => m.key === 'netPayPayableAccountId')?.status).toBe('WRONG_TYPE');
    expect(r.mappings.find((m) => m.key === 'payePayableAccountId')?.status).toBe('UNAVAILABLE');
  });
  it('allows a facility-approved shared liability while requiring other deductions only when used', () => {
    const accounts = [
      {
        id: 1,
        accountCode: 'FAC-EXP',
        accountName: 'Approved expenses',
        accountType: 'EXPENSE',
        isActive: true,
      },
      {
        id: 2,
        accountCode: 'FAC-LIAB',
        accountName: 'Approved liabilities',
        accountType: 'LIABILITY',
        isActive: true,
      },
    ];
    const settings = Object.fromEntries(
      PAYROLL_ACCOUNT_PURPOSES.filter((p) => p.required).map((p) => [
        p.key,
        p.type === 'EXPENSE' ? 1 : 2,
      ]),
    );
    expect(assessPayrollAccounts(settings, accounts).ready).toBe(true);
    expect(assessPayrollAccounts(settings, accounts, true).ready).toBe(false);
  });
  it('accepts inclusive period endpoints and labels synthetic verification explicitly', () => {
    const rows = assessPayrollRules(rules(), period, today);
    expect(rows.every((r) => r.ready && r.status === 'TEST_ONLY')).toBe(true);
  });
  it('rejects either effective boundary outside the full period, even when pay date matches', () => {
    for (const extra of [{ effectiveFrom: '2026-06-02' }, { effectiveTo: '2026-06-29' }]) {
      const rows = assessPayrollRules([version('PAYE', extra)], period, today);
      expect(rows[0].status).toBe('DATE_GAP');
      expect(rows[0].ready).toBe(false);
    }
  });
  it('does not substitute a current version for a historical period', () => {
    const rows = assessPayrollRules(
      rules().map((v) => ({ ...v, effectiveFrom: '2026-07-01', effectiveTo: null })),
      period,
      today,
    );
    expect(rows.every((r) => r.status === 'MISSING')).toBe(true);
  });
  it('requires full-period AND pay-date coverage, refusing an invented rule split', () => {
    expect(assessPayrollRules(rules(), { ...period, payDate: '2026-07-01' }, today)[0].status).toBe(
      'DATE_GAP',
    );
  });
  it('can use finite verified retired historical versions but not draft or open-ended retired policy', () => {
    expect(
      assessPayrollRules(
        rules().map((v) => ({ ...v, status: 'RETIRED' })),
        period,
        today,
      ).every((r) => r.ready),
    ).toBe(true);
    for (const change of [
      { status: 'DRAFT' as const },
      { status: 'RETIRED' as const, effectiveTo: null },
    ])
      expect(
        assessPayrollRules(
          rules().map((v) => ({ ...v, ...change })),
          period,
          today,
        ).some((r) => r.ready),
      ).toBe(false);
  });
  it('refuses ambiguous effective policies instead of choosing the newest', () => {
    expect(
      assessPayrollRules(
        [version('PAYE'), version('PAYE', { id: 99, effectiveFrom: '2026-05-01' })],
        period,
        today,
      )[0].status,
    ).toBe('AMBIGUOUS');
  });
  it('rejects legacy unverified versions and incomplete explicit calculation policy', () => {
    expect(
      assessPayrollRules(
        [version('PAYE', { verifiedOn: null, verifiedBy: null })],
        period,
        today,
      )[0].status,
    ).toBe('UNVERIFIED');
    expect(
      assessPayrollRules([version('PAYE', { calculationConfig: null })], period, today)[0].status,
    ).toBe('INCOMPLETE');
  });
  it('detects ignored contribution-bound/relief inputs and gapped PAYE bands', () => {
    const shif = version('SHIF');
    shif.bands[0].upperBoundCents = 100n;
    expect(payrollRuleIssues(shif)).toContain(
      'Contribution bands use zero/open bounds and no tax relief; use contribution caps/minima.',
    );
    const paye = version('PAYE');
    paye.bands[0].lowerBoundCents = 100n;
    expect(payrollRuleIssues(paye).join(' ')).toMatch(/without gaps/);
  });
});
