/**
 * Syrona Medical Center HMIS
 * Payroll calculation — pure functions, no database access.
 *
 * DESIGN RULES
 * ------------
 * 1. The engine contains no Kenyan statutory figures. Every rate, band,
 *    ceiling, relief and threshold arrives from a facility-configured,
 *    effective-dated version whose `sourceReference` records the authority's
 *    publication. If any of the four statutes lacks a version that covers the
 *    pay date, `calculatePayroll` throws and the run stays uncosted.
 *
 * 2. All money is integer cents. A percentage is basis points (1% = 100bp),
 *    applied per band and rounded half-up to the cent. Floating point never
 *    touches an amount that reaches the ledger.
 *
 * 3. A payslip is reproducible: the returned breakdown carries the exact
 *    versions, tier results and reliefs used, and is stored with the payslip.
 *
 * 4. A contribution may be tiered (NSSF charges Tier I and Tier II on
 *    different slices of pensionable pay). Bands are evaluated progressively
 *    for every statute: each band charges its rate on the part of the base
 *    that falls inside [lowerBound, upperBound). A single 0..∞ band therefore
 *    behaves exactly like a flat percentage.
 */

export type Statute = 'PAYE' | 'NSSF' | 'SHIF' | 'AHL';

export type TaxResidency = 'RESIDENT' | 'NON_RESIDENT';

export interface StatutoryBand {
  sequence: number;
  /** Inclusive lower bound in cents. */
  lowerBoundCents: bigint;
  /** Exclusive upper bound in cents; null means "and above". */
  upperBoundCents: bigint | null;
  employeeRateBp: number;
  employerRateBp: number;
  employeeFixedCents: bigint;
  employerFixedCents: bigint;
  employeeCapCents: bigint | null;
  employerCapCents: bigint | null;
  reliefCents: bigint;
}

/**
 * Stored on the effective-dated version, not inferred from today's date.
 *
 * The contribution-deduction fields and the two minima predate the relief
 * fields; a version recorded before they mattered carries only those and the
 * engine keeps its original semantics (`null` config = historical behaviour).
 * The relief fields are optional so an older row stays valid.
 */
export interface CalculationConfig {
  deductNssf: boolean;
  deductShif: boolean;
  deductAhl: boolean;
  employeeMinimumCents: string;
  employerMinimumCents: string;
  /**
   * PAYE only: monthly tax credit granted to resident individuals. Granted to
   * a non-resident only if a version says so explicitly; no version ships a
   * non-resident default.
   */
  personalReliefCents?: string;
  /** PAYE only: rate applied to declared qualifying insurance premiums (1500 = 15%). */
  insuranceReliefRateBp?: number;
  /** PAYE only: annual statutory ceiling on the premiums that earn relief. */
  insuranceReliefAnnualPremiumCapCents?: string;
  /**
   * PAYE only: monthly ceiling on qualifying pension/provident contributions
   * deducted before tax. `null` means the version sets no ceiling.
   */
  pensionDeductionCapCents?: string | null;
  /** PAYE only: whether a non-resident gets the personal relief. Default false. */
  personalReliefForNonResidents?: boolean;
}

export interface StatutoryVersion {
  calculationConfig?: CalculationConfig | null;
  id: number;
  statute: Statute;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  authority: string;
  sourceReference: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  bands: StatutoryBand[];
}

export interface PayrollComponent {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amountCents: bigint;
  taxable: boolean;
  statutoryExclusions?: string[];
  /**
   * A deduction that reduces taxable employment income (a qualifying pension
   * or provident contribution). Capped by the PAYE version, never by the
   * component itself.
   */
  taxDeductible?: boolean;
}

export interface PayrollEmployeeInput {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  baseSalaryCents: bigint;
  components: PayrollComponent[];
  /** Defaults to resident: the KRA personal relief is granted to residents. */
  taxResidency?: TaxResidency;
  /** Employee-declared qualifying life/health/education premiums for the month. */
  insurancePremiumCents?: bigint;
}

export interface BandResult {
  sequence: number;
  baseCents: string;
  employeeCents: string;
  employerCents: string;
  reliefCents: string;
}

export interface StatuteResult {
  statute: Statute;
  versionId: number;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  taxableBaseCents: string;
  employeeCents: string;
  employerCents: string;
  reliefCents: string;
  calculationConfig?: CalculationConfig | null;
  /** One row per band. NSSF rows are Tier I and Tier II. */
  bands: BandResult[];
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  amountCents: bigint;
}

export interface PayslipResult {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  taxResidency: TaxResidency;
  grossCents: bigint;
  /** Gross less exempt earnings, before statutory deductions. */
  taxableGrossCents: bigint;
  taxableCents: bigint;
  payeCents: bigint;
  /** PAYE before any relief, so a payslip can show what relief removed. */
  payeBeforeReliefCents: bigint;
  personalReliefCents: bigint;
  insuranceReliefCents: bigint;
  qualifyingPensionCents: bigint;
  nssfEmployeeCents: bigint;
  nssfEmployerCents: bigint;
  shifCents: bigint;
  ahlEmployeeCents: bigint;
  ahlEmployerCents: bigint;
  /** Employee-side statutory deductions in total. */
  statutoryDeductionsCents: bigint;
  otherDeductionsCents: bigint;
  netCents: bigint;
  /** Employer NSSF + employer AHL + any other employer charge. */
  employerContributionsCents: bigint;
  /** Gross + employer contributions. */
  employerCostCents: bigint;
  lines: PayslipLine[];
  statutes: StatuteResult[];
}

export interface PayrollTotals {
  employeeCount: number;
  grossCents: bigint;
  taxableCents: bigint;
  payeCents: bigint;
  nssfEmployeeCents: bigint;
  nssfEmployerCents: bigint;
  shifCents: bigint;
  ahlEmployeeCents: bigint;
  ahlEmployerCents: bigint;
  otherDeductionsCents: bigint;
  netCents: bigint;
  employerContributionsCents: bigint;
  employerCostCents: bigint;
}

export class PayrollCalculationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'PayrollCalculationError';
  }
}

/** Half-up percentage of an integer cent amount. */
export function applyRateBp(amountCents: bigint, rateBp: number): bigint {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000)
    throw new PayrollCalculationError(
      'INVALID_RATE',
      'A statutory rate must be 0–10000 basis points.',
    );
  const numerator = amountCents * BigInt(rateBp);
  const denominator = 10_000n;
  // Half-up for positive amounts; payroll amounts are never negative.
  return (numerator + denominator / 2n) / denominator;
}

function cap(amount: bigint, limit: bigint | null): bigint {
  return limit !== null && amount > limit ? limit : amount;
}

function floor(amount: bigint, minimum: bigint): bigint {
  return amount < minimum ? minimum : amount;
}

function centsFromConfig(value: string | undefined | null): bigint | null {
  if (value === undefined || value === null || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

/** Smallest non-null ceiling across the bands: a ceiling on the amount charged. */
function totalCeiling(bands: StatutoryBand[], side: 'employee' | 'employer'): bigint | null {
  const key = side === 'employee' ? 'employeeCapCents' : 'employerCapCents';
  const values = bands.map((band) => band[key]).filter((value): value is bigint => value !== null);
  if (!values.length) return null;
  return values.reduce((lowest, value) => (value < lowest ? value : lowest));
}

export function statuteAppliesOn(version: StatutoryVersion, date: string): boolean {
  if (version.status !== 'ACTIVE') return false;
  if (date < version.effectiveFrom) return false;
  return version.effectiveTo === null || date <= version.effectiveTo;
}

/**
 * Resolve exactly one active version per statute for a pay date. Silence is
 * an error: paying a statutory deduction from a guessed rate is worse than
 * refusing to run payroll.
 */
export function resolveStatutoryVersions(
  versions: StatutoryVersion[],
  payDate: string,
): Record<Statute, StatutoryVersion> {
  const statutes: Statute[] = ['PAYE', 'NSSF', 'SHIF', 'AHL'];
  const resolved = {} as Record<Statute, StatutoryVersion>;
  for (const statute of statutes) {
    const matches = versions.filter((v) => v.statute === statute && statuteAppliesOn(v, payDate));
    if (matches.length === 0)
      throw new PayrollCalculationError(
        'STATUTORY_VERSION_REQUIRED',
        `No active ${statute} version covers ${payDate}. Record the authority's published version before running payroll.`,
        409,
      );
    if (matches.length > 1)
      throw new PayrollCalculationError(
        'STATUTORY_VERSION_AMBIGUOUS',
        `More than one active ${statute} version covers ${payDate}. Retire the superseded version first.`,
        409,
      );
    const version = matches[0];
    if (version.bands.length === 0)
      throw new PayrollCalculationError(
        'STATUTORY_BANDS_REQUIRED',
        `The ${statute} version effective ${version.effectiveFrom} has no bands.`,
        409,
      );
    resolved[statute] = version;
  }
  return resolved;
}

/**
 * Progressive band calculation.
 *
 * Used by PAYE (where the bands are tax rates and each band also carries the
 * relief it grants) and by contributions (where the bands are tiers of
 * pensionable pay and each carries a contribution rate). Each band charges
 * only the part of the base that falls inside it, so a version with a single
 * 0..∞ band is exactly a flat percentage of the base.
 */
function bandedCharge(
  statute: Statute,
  baseCents: bigint,
  version: StatutoryVersion,
): { employee: bigint; employer: bigint; relief: bigint; bands: BandResult[] } {
  const bands = [...version.bands].sort((a, b) => a.sequence - b.sequence);
  let employee = 0n;
  let employer = 0n;
  let relief = 0n;
  const results: BandResult[] = [];
  for (const band of bands) {
    const lower = band.lowerBoundCents;
    const upper = band.upperBoundCents ?? baseCents;
    // A band that starts at or above the base contributes nothing.
    if (baseCents <= lower) continue;
    const base = (upper < baseCents ? upper : baseCents) - lower;
    if (base <= 0n) continue;
    const bandEmployee = cap(
      applyRateBp(base, band.employeeRateBp) + band.employeeFixedCents,
      band.employeeCapCents,
    );
    const bandEmployer = cap(
      applyRateBp(base, band.employerRateBp) + band.employerFixedCents,
      band.employerCapCents,
    );
    employee += bandEmployee;
    employer += bandEmployer;
    relief += band.reliefCents;
    results.push({
      sequence: band.sequence,
      baseCents: base.toString(),
      employeeCents: bandEmployee.toString(),
      employerCents: bandEmployer.toString(),
      reliefCents: band.reliefCents.toString(),
    });
  }
  // A version-level ceiling on the charge itself. For a single band this is
  // the same rule as before; for tiers it prevents the sum exceeding the
  // published maximum.
  employee = cap(employee, totalCeiling(bands, 'employee'));
  employer = cap(employer, totalCeiling(bands, 'employer'));
  if (statute === 'PAYE') {
    // Relief is a credit against the tax due, never a refund.
    const applied = relief > employee ? employee : relief;
    return { employee: employee - applied, employer, relief: applied, bands: results };
  }
  return { employee, employer, relief: 0n, bands: results };
}

export function computeStatute(
  statute: Statute,
  baseCents: bigint,
  version: StatutoryVersion,
): StatuteResult {
  if (baseCents < 0n)
    throw new PayrollCalculationError('INVALID_BASE', 'A statutory base cannot be negative.');
  const charge = bandedCharge(statute, baseCents, version);
  const config = version.calculationConfig ?? null;
  let employee = charge.employee;
  let employer = charge.employer;
  if (statute !== 'PAYE') {
    // A floor is max(rate-based contribution, minimum), never an additive fee.
    const employeeMinimum = centsFromConfig(config?.employeeMinimumCents) ?? 0n;
    const employerMinimum = centsFromConfig(config?.employerMinimumCents) ?? 0n;
    employee = floor(employee, employeeMinimum);
    employer = floor(employer, employerMinimum);
  }
  return {
    statute,
    versionId: version.id,
    label: version.label,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    taxableBaseCents: baseCents.toString(),
    employeeCents: employee.toString(),
    employerCents: employer.toString(),
    reliefCents: charge.relief.toString(),
    calculationConfig: config,
    bands: charge.bands,
  };
}

/**
 * Cost one employee for one period.
 *
 * Order of calculation (the order the ledger and the payslip depend on):
 *   1. gross earnings (basic + components);
 *   2. exempt earnings removed from the taxable base;
 *   3. NSSF, SHIF and AHL charged on their own contribution bases;
 *   4. qualifying pension deducted, within the version's monthly ceiling;
 *   5. taxable employment income = gross − exempt − deductible contributions;
 *   6. PAYE bands applied progressively;
 *   7. personal and insurance reliefs credited, PAYE floored at zero;
 *   8. net pay = gross − employee statutory deductions − other deductions;
 *   9. employer cost = gross + employer contributions.
 *
 * Employer contributions are never subtracted from employee net pay, and a
 * deduction is never counted twice: the PAYE base subtracts exactly the three
 * configured contributions plus the capped pension, once.
 */
export function calculatePayslip(input: {
  employee: PayrollEmployeeInput;
  versions: Record<Statute, StatutoryVersion>;
  payDate: string;
}): PayslipResult {
  const { employee, versions, payDate } = input;
  if (employee.baseSalaryCents < 0n)
    throw new PayrollCalculationError('INVALID_SALARY', 'Base salary cannot be negative.');
  const taxResidency: TaxResidency = employee.taxResidency ?? 'RESIDENT';

  const earnings = employee.components.filter((c) => c.kind === 'EARNING');
  const deductions = employee.components.filter((c) => c.kind === 'DEDUCTION');
  const gross = earnings.reduce((sum, c) => sum + c.amountCents, employee.baseSalaryCents);
  const nonTaxable = earnings.filter((c) => !c.taxable).reduce((sum, c) => sum + c.amountCents, 0n);

  const statutoryBase = (statute: string) =>
    earnings
      .filter((c) => !c.statutoryExclusions?.includes(statute))
      .reduce((sum, c) => sum + c.amountCents, employee.baseSalaryCents);

  const nssf = computeStatute('NSSF', statutoryBase('NSSF'), versions.NSSF);
  const shif = computeStatute('SHIF', statutoryBase('SHIF'), versions.SHIF);
  const ahl = computeStatute('AHL', statutoryBase('AHL'), versions.AHL);
  const nssfEmployee = BigInt(nssf.employeeCents);
  const shifEmployee = BigInt(shif.employeeCents);
  const ahlEmployee = BigInt(ahl.employeeCents);

  // Preserve historical version semantics when no config was recorded. New
  // versions state explicitly which contributions are deductible and which
  // reliefs exist, against the authority publication.
  const config = versions.PAYE.calculationConfig;
  const deductibleNssf = (config?.deductNssf ?? true) ? nssfEmployee : 0n;
  const deductibleShif = (config?.deductShif ?? true) ? shifEmployee : 0n;
  const deductibleAhl = (config?.deductAhl ?? false) ? ahlEmployee : 0n;

  const pensionCap = centsFromConfig(config?.pensionDeductionCapCents ?? null);
  const declaredPension = deductions
    .filter((c) => c.taxDeductible)
    .reduce((sum, c) => sum + c.amountCents, 0n);
  const qualifyingPension =
    pensionCap === null ? declaredPension : cap(declaredPension, pensionCap);

  const taxableGross = gross - nonTaxable;
  const beforeContributions = taxableGross - deductibleNssf - deductibleShif - deductibleAhl;
  const taxable = beforeContributions - qualifyingPension;
  const taxableCents = taxable > 0n ? taxable : 0n;

  const paye = computeStatute('PAYE', taxableCents, versions.PAYE);
  const payeBeforeRelief = BigInt(paye.employeeCents) + BigInt(paye.reliefCents);

  // Personal relief is granted to residents; a version may extend it to
  // non-residents only by saying so explicitly.
  const personalReliefConfigured = centsFromConfig(config?.personalReliefCents) ?? 0n;
  const personalReliefEligible =
    taxResidency === 'RESIDENT' || config?.personalReliefForNonResidents === true;
  const personalRelief = personalReliefEligible ? personalReliefConfigured : 0n;

  // Insurance relief: a percentage of declared premiums, with the statutory
  // annual premium ceiling prorated to one month. Residents only, and never
  // applied to SHIF — SHIF is a deduction in arriving at taxable income.
  const premiumCapAnnual = centsFromConfig(config?.insuranceReliefAnnualPremiumCapCents);
  const monthlyPremiumCap = premiumCapAnnual === null ? null : premiumCapAnnual / 12n;
  const declaredPremiums = employee.insurancePremiumCents ?? 0n;
  const qualifyingPremiums =
    monthlyPremiumCap === null ? declaredPremiums : cap(declaredPremiums, monthlyPremiumCap);
  const insuranceReliefRate = config?.insuranceReliefRateBp ?? 0;
  const insuranceRelief =
    personalReliefEligible && insuranceReliefRate > 0
      ? applyRateBp(qualifyingPremiums, insuranceReliefRate)
      : 0n;

  const reliefTotal = personalRelief + insuranceRelief;
  const payeCents =
    BigInt(paye.employeeCents) > reliefTotal ? BigInt(paye.employeeCents) - reliefTotal : 0n;

  const otherDeductions = deductions.reduce((sum, c) => sum + c.amountCents, 0n);
  const statutoryDeductions = nssfEmployee + shifEmployee + ahlEmployee + payeCents;
  const net = gross - statutoryDeductions - otherDeductions;
  if (net < 0n)
    throw new PayrollCalculationError(
      'NET_PAY_NEGATIVE',
      `Deductions exceed gross pay for employee ${employee.employeeNumber}.`,
      409,
    );

  const nssfEmployer = BigInt(nssf.employerCents);
  const ahlEmployer = BigInt(ahl.employerCents);
  const shifEmployer = BigInt(shif.employerCents);
  const employerContributions = nssfEmployer + ahlEmployer + shifEmployer;

  const nssfTiers = nssf.bands;
  const lines: PayslipLine[] = [
    { code: 'BASIC', name: 'Basic salary', kind: 'EARNING', amountCents: employee.baseSalaryCents },
    ...earnings.map((c) => ({
      code: c.code,
      name: c.name,
      kind: 'EARNING' as const,
      amountCents: c.amountCents,
    })),
    ...nssfTiers.map((tier) => ({
      code: `NSSF_T${tier.sequence}`,
      name: `NSSF Tier ${tier.sequence === 1 ? 'I' : tier.sequence === 2 ? 'II' : tier.sequence}`,
      kind: 'DEDUCTION' as const,
      amountCents: BigInt(tier.employeeCents),
    })),
    { code: 'SHIF', name: 'SHIF', kind: 'DEDUCTION', amountCents: shifEmployee },
    { code: 'AHL', name: 'Affordable Housing Levy', kind: 'DEDUCTION', amountCents: ahlEmployee },
    { code: 'PAYE', name: 'PAYE', kind: 'DEDUCTION', amountCents: payeCents },
    ...deductions.map((c) => ({
      code: c.code,
      name: c.name,
      kind: 'DEDUCTION' as const,
      amountCents: c.amountCents,
    })),
    { code: 'NET', name: 'Net pay', kind: 'EARNING', amountCents: net },
    ...nssfTiers.map((tier) => ({
      code: `NSSF_EMPLOYER_T${tier.sequence}`,
      name: `NSSF Tier ${tier.sequence === 1 ? 'I' : tier.sequence === 2 ? 'II' : tier.sequence} (employer)`,
      kind: 'EMPLOYER' as const,
      amountCents: BigInt(tier.employerCents),
    })),
    {
      code: 'AHL_EMPLOYER',
      name: 'Affordable Housing Levy (employer)',
      kind: 'EMPLOYER',
      amountCents: ahlEmployer,
    },
  ];

  // `payDate` is part of the snapshot so a stored payslip explains itself.
  void payDate;
  return {
    employeeId: employee.employeeId,
    employeeNumber: employee.employeeNumber,
    fullName: employee.fullName,
    taxResidency,
    grossCents: gross,
    taxableGrossCents: taxableGross,
    taxableCents,
    payeCents,
    payeBeforeReliefCents: payeBeforeRelief,
    personalReliefCents: personalRelief,
    insuranceReliefCents: insuranceRelief,
    qualifyingPensionCents: qualifyingPension,
    nssfEmployeeCents: nssfEmployee,
    nssfEmployerCents: nssfEmployer,
    shifCents: shifEmployee,
    ahlEmployeeCents: ahlEmployee,
    ahlEmployerCents: ahlEmployer,
    statutoryDeductionsCents: statutoryDeductions,
    otherDeductionsCents: otherDeductions,
    netCents: net,
    employerContributionsCents: employerContributions,
    employerCostCents: gross + employerContributions,
    lines,
    statutes: [paye, nssf, shif, ahl],
  };
}

export function calculatePayroll(input: {
  employees: PayrollEmployeeInput[];
  versions: StatutoryVersion[];
  payDate: string;
}): {
  payslips: PayslipResult[];
  totals: PayrollTotals;
  versions: Record<Statute, StatutoryVersion>;
} {
  if (input.employees.length === 0)
    throw new PayrollCalculationError(
      'NO_EMPLOYEES',
      'There are no active employees to pay for this period.',
      409,
    );
  const versions = resolveStatutoryVersions(input.versions, input.payDate);
  const payslips = input.employees.map((employee) =>
    calculatePayslip({ employee, versions, payDate: input.payDate }),
  );
  const totals = payslips.reduce<PayrollTotals>(
    (acc, slip) => ({
      employeeCount: acc.employeeCount + 1,
      grossCents: acc.grossCents + slip.grossCents,
      taxableCents: acc.taxableCents + slip.taxableCents,
      payeCents: acc.payeCents + slip.payeCents,
      nssfEmployeeCents: acc.nssfEmployeeCents + slip.nssfEmployeeCents,
      nssfEmployerCents: acc.nssfEmployerCents + slip.nssfEmployerCents,
      shifCents: acc.shifCents + slip.shifCents,
      ahlEmployeeCents: acc.ahlEmployeeCents + slip.ahlEmployeeCents,
      ahlEmployerCents: acc.ahlEmployerCents + slip.ahlEmployerCents,
      otherDeductionsCents: acc.otherDeductionsCents + slip.otherDeductionsCents,
      netCents: acc.netCents + slip.netCents,
      employerContributionsCents: acc.employerContributionsCents + slip.employerContributionsCents,
      employerCostCents: acc.employerCostCents + slip.employerCostCents,
    }),
    {
      employeeCount: 0,
      grossCents: 0n,
      taxableCents: 0n,
      payeCents: 0n,
      nssfEmployeeCents: 0n,
      nssfEmployerCents: 0n,
      shifCents: 0n,
      ahlEmployeeCents: 0n,
      ahlEmployerCents: 0n,
      otherDeductionsCents: 0n,
      netCents: 0n,
      employerContributionsCents: 0n,
      employerCostCents: 0n,
    },
  );
  return { payslips, totals, versions };
}
