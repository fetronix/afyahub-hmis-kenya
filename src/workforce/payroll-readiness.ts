import type { StatutoryVersion } from './payroll-calculator.ts';

/** Account purposes, not account codes. Facilities choose their own chart and may share liabilities. */
export const PAYROLL_ACCOUNT_PURPOSES = [
  { key: 'salaryExpenseAccountId', label: 'Gross salary expense', type: 'EXPENSE', required: true },
  {
    key: 'employerCostAccountId',
    label: 'Employer statutory expense',
    type: 'EXPENSE',
    required: true,
  },
  { key: 'netPayPayableAccountId', label: 'Net salary payable', type: 'LIABILITY', required: true },
  { key: 'payePayableAccountId', label: 'PAYE payable', type: 'LIABILITY', required: true },
  {
    key: 'nssfPayableAccountId',
    label: 'NSSF payable (employee + employer)',
    type: 'LIABILITY',
    required: true,
  },
  { key: 'shifPayableAccountId', label: 'SHIF payable', type: 'LIABILITY', required: true },
  {
    key: 'ahlPayableAccountId',
    label: 'AHL payable (employee + employer)',
    type: 'LIABILITY',
    required: true,
  },
  {
    key: 'otherDeductionsPayableAccountId',
    label: 'Other deductions payable',
    type: 'LIABILITY',
    required: false,
  },
] as const;
export type PayrollAccountKey = (typeof PAYROLL_ACCOUNT_PURPOSES)[number]['key'];
export type PayrollAccount = {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  isActive: boolean;
};
export function assessPayrollAccounts(
  settings: Partial<Record<PayrollAccountKey, number | null>> | null,
  accounts: PayrollAccount[],
  otherDeductionsRequired = false,
) {
  const mappings = PAYROLL_ACCOUNT_PURPOSES.map((p) => {
    const id = settings?.[p.key] ?? null,
      account = accounts.find((a) => a.id === id);
    const required = p.required || otherDeductionsRequired;
    const status = !id
      ? required
        ? 'MISSING'
        : 'OPTIONAL'
      : !account
        ? 'UNAVAILABLE'
        : !account.isActive
          ? 'INACTIVE'
          : account.accountType !== p.type
            ? 'WRONG_TYPE'
            : 'READY';
    return {
      ...p,
      required,
      accountId: id,
      account: account ?? null,
      status,
      nextAction:
        status === 'MISSING'
          ? `Select an approved ${p.type.toLowerCase()} account for ${p.label}.`
          : status === 'UNAVAILABLE'
            ? `Replace ${p.label}: its account is missing or outside this facility.`
            : status === 'INACTIVE'
              ? `Choose an active account for ${p.label}; review reactivation with Accounting.`
              : status === 'WRONG_TYPE'
                ? `Select a ${p.type.toLowerCase()} account for ${p.label}.`
                : null,
    };
  });
  return {
    activeAccountCount: accounts.filter((a) => a.isActive).length,
    totalAccountCount: accounts.length,
    mappings,
    ready: mappings.every((m) => ['READY', 'OPTIONAL'].includes(m.status)),
  };
}
export type VerifiedPayrollVersion = StatutoryVersion & {
  verifiedOn?: string | null;
  verifiedBy?: number | null;
  verificationReference?: string | null;
  verificationPurpose?: string | null;
};
export type PayrollReadinessPeriod = { startDate: string; endDate: string; payDate: string };
export function payrollRuleIssues(v: StatutoryVersion): string[] {
  const issues: string[] = [];
  if (!v.authority?.trim() || v.sourceReference?.trim().length < 8)
    issues.push('Authority and official source reference are required.');
  if (!v.calculationConfig)
    issues.push(
      'Record an explicit contribution deduction/minimum policy; legacy null policy is not ready.',
    );
  if (!v.bands.length) issues.push('Record calculation bands.');
  if (v.statute !== 'PAYE' && v.bands.length !== 1)
    issues.push('Contributions require exactly one band.');
  for (const b of v.bands) {
    if (
      b.lowerBoundCents < 0n ||
      (b.upperBoundCents !== null && b.upperBoundCents <= b.lowerBoundCents)
    )
      issues.push('Invalid band bounds.');
    if (
      [b.employeeRateBp, b.employerRateBp].some((r) => !Number.isInteger(r) || r < 0 || r > 10000)
    )
      issues.push('Invalid rate basis points.');
    if ([b.employeeFixedCents, b.employerFixedCents, b.reliefCents].some((n) => n < 0n))
      issues.push('Negative calculation amounts are not supported.');
    if (
      v.statute !== 'PAYE' &&
      (b.lowerBoundCents !== 0n || b.upperBoundCents !== null || b.reliefCents !== 0n)
    )
      issues.push(
        'Contribution bands use zero/open bounds and no tax relief; use contribution caps/minima.',
      );
    if (
      ['PAYE', 'SHIF'].includes(v.statute) &&
      (b.employerRateBp !== 0 || b.employerFixedCents !== 0n)
    )
      issues.push('Employer PAYE/SHIF amounts have no supported payroll posting representation.');
  }
  if (v.statute === 'PAYE' && v.bands.length) {
    const sorted = [...v.bands].sort((a, b) => (a.lowerBoundCents < b.lowerBoundCents ? -1 : 1));
    if (
      sorted[0].lowerBoundCents !== 0n ||
      sorted.at(-1)!.upperBoundCents !== null ||
      sorted.some((b, i) => i > 0 && sorted[i - 1].upperBoundCents !== b.lowerBoundCents)
    )
      issues.push('PAYE bands must cover zero through an open final band without gaps/overlap.');
  }
  const c = v.calculationConfig;
  if (c) {
    if (
      ['deductNssf', 'deductShif', 'deductAhl'].some(
        (k) => typeof c[k as 'deductNssf'] !== 'boolean',
      )
    )
      issues.push('Explicit boolean deduction policy is required.');
    for (const side of ['employee', 'employer'] as const) {
      const value = c[`${side}MinimumCents`];
      if (!/^\d+$/.test(value)) issues.push('Minima must be non-negative integer cents.');
      else {
        if (
          v.bands.some(
            (b) => b[`${side}CapCents`] !== null && BigInt(value) > b[`${side}CapCents`]!,
          )
        )
          issues.push('A minimum exceeds its contribution cap.');
        if (
          ((side === 'employer' && ['PAYE', 'SHIF'].includes(v.statute)) || v.statute === 'PAYE') &&
          BigInt(value) > 0n
        )
          issues.push('Unsupported contribution minimum.');
      }
    }
  }
  return [...new Set(issues)];
}
/** Conservative period policy: a single verified version must cover the entire period AND pay date.
 * A change inside a period is a blocker, not a guessed split calculation. */
export function assessPayrollRules(
  versions: VerifiedPayrollVersion[],
  period: PayrollReadinessPeriod,
  today: string,
) {
  const from = [period.startDate, period.payDate].sort()[0],
    to = [period.endDate, period.payDate].sort().at(-1)!;
  return (['PAYE', 'NSSF', 'SHIF', 'AHL'] as const).map((statute) => {
    const relevant = versions.filter(
      (v) =>
        v.statute === statute && v.effectiveFrom <= to && (!v.effectiveTo || v.effectiveTo >= from),
    );
    const eligible = relevant.filter(
      (v) =>
        v.status === 'ACTIVE' ||
        (v.status === 'RETIRED' && !!v.effectiveTo && v.effectiveTo < today),
    );
    const covering = eligible.filter(
      (v) => v.effectiveFrom <= from && (!v.effectiveTo || v.effectiveTo >= to),
    );
    // Include retired overlaps: a historical calculation must never silently choose one of two policies.
    const ambiguous = eligible.some((a, i) =>
      eligible
        .slice(i + 1)
        .some(
          (b) =>
            a.effectiveFrom <= (b.effectiveTo ?? '9999-12-31') &&
            b.effectiveFrom <= (a.effectiveTo ?? '9999-12-31'),
        ),
    );
    const v = covering.length === 1 ? covering[0] : undefined;
    const issues = v ? payrollRuleIssues(v) : [];
    const verified =
      !!v?.verifiedOn &&
      !!v.verifiedBy &&
      !!v.verificationReference &&
      !!v.verificationPurpose &&
      v.verifiedOn <= today;
    const status =
      ambiguous || covering.length > 1
        ? 'AMBIGUOUS'
        : !v
          ? eligible.length
            ? 'DATE_GAP'
            : 'MISSING'
          : !verified
            ? 'UNVERIFIED'
            : issues.length
              ? 'INCOMPLETE'
              : v.verificationPurpose === 'SYNTHETIC_TEST'
                ? 'TEST_ONLY'
                : 'READY';
    return {
      statute,
      status,
      versionId: v?.id ?? null,
      label: v?.label ?? null,
      verifiedOn: v?.verifiedOn ?? null,
      verificationPurpose: v?.verificationPurpose ?? null,
      authority: v?.authority ?? null,
      sourceReference: v?.sourceReference ?? null,
      issues,
      ready: ['READY', 'TEST_ONLY'].includes(status),
      nextAction:
        status === 'READY'
          ? null
          : status === 'TEST_ONLY'
            ? 'Synthetic test policy only; replace with independently verified authority values before operational use.'
            : status === 'AMBIGUOUS'
              ? 'Resolve overlapping dated policies; do not guess which version to use.'
              : status === 'DATE_GAP'
                ? 'Record a verified version covering the full period and pay date; split periods at rule changes if needed.'
                : status === 'UNVERIFIED'
                  ? 'Record source verification on a draft replacement, then activate it.'
                  : status === 'INCOMPLETE'
                    ? issues.join(' ')
                    : `Record, verify and activate a source-cited ${statute} version for these dates.`,
    };
  });
}
