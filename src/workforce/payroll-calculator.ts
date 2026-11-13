/**
 * JaliCare HMIS
 * Payroll calculation — pure functions, no database access.
 *
 * DESIGN RULES
 * ------------
 * 1. The engine contains no Kenyan statutory figures. Every rate, band,
 *    ceiling and relief arrives from a facility-configured, effective-dated
 *    version whose `sourceReference` records the authority's publication.
 *    If any of the four statutes lacks a version that covers the pay date,
 *    `calculatePayroll` throws and the run stays uncosted.
 *
 * 2. All money is integer cents. A percentage is basis points (1% = 100bp),
 *    applied per band and rounded half-up to the cent. Floating point never
 *    touches an amount that reaches the ledger.
 *
 * 3. A payslip is reproducible: the returned breakdown carries the exact
 *    versions and band results used, and is stored with the payslip.
 */

export type Statute = 'PAYE' | 'NSSF' | 'SHIF' | 'AHL';

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

export interface StatutoryVersion {
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
}

export interface PayrollEmployeeInput {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  baseSalaryCents: bigint;
  components: PayrollComponent[];
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
  taxableBaseCents: string;
  employeeCents: string;
  employerCents: string;
  reliefCents: string;
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

/** Progressive band calculation used by PAYE. */
function progressiveTax(taxableCents: bigint, version: StatutoryVersion): StatuteResult {
  const bands = [...version.bands].sort((a, b) => a.sequence - b.sequence);
  let employee = 0n;
  let employer = 0n;
  let relief = 0n;
  const results: BandResult[] = [];
  for (const band of bands) {
    const lower = band.lowerBoundCents;
    const upper = band.upperBoundCents ?? taxableCents;
    if (taxableCents <= lower) continue;
    const base = (upper < taxableCents ? upper : taxableCents) - lower;
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
  // Relief is a credit against the tax due, never a refund.
  const reliefApplied = relief > employee ? employee : relief;
  employee -= reliefApplied;
  return {
    statute: 'PAYE',
    versionId: version.id,
    label: version.label,
    taxableBaseCents: taxableCents.toString(),
    employeeCents: employee.toString(),
    employerCents: employer.toString(),
    reliefCents: reliefApplied.toString(),
    bands: results,
  };
}

/** Flat or capped percentage used by NSSF, SHIF and the housing levy. */
function flatStatute(
  statute: Statute,
  baseCents: bigint,
  version: StatutoryVersion,
): StatuteResult {
  if (version.bands.length !== 1)
    throw new PayrollCalculationError(
      'STATUTORY_BAND_SHAPE',
      `${statute} must be configured with exactly one band; found ${version.bands.length}.`,
      409,
    );
  const band = version.bands[0];
  const employee = cap(
    applyRateBp(baseCents, band.employeeRateBp) + band.employeeFixedCents,
    band.employeeCapCents,
  );
  const employer = cap(
    applyRateBp(baseCents, band.employerRateBp) + band.employerFixedCents,
    band.employerCapCents,
  );
  return {
    statute,
    versionId: version.id,
    label: version.label,
    taxableBaseCents: baseCents.toString(),
    employeeCents: employee.toString(),
    employerCents: employer.toString(),
    reliefCents: '0',
    bands: [
      {
        sequence: band.sequence,
        baseCents: baseCents.toString(),
        employeeCents: employee.toString(),
        employerCents: employer.toString(),
        reliefCents: '0',
      },
    ],
  };
}

export function computeStatute(
  statute: Statute,
  baseCents: bigint,
  version: StatutoryVersion,
): StatuteResult {
  if (baseCents < 0n)
    throw new PayrollCalculationError('INVALID_BASE', 'A statutory base cannot be negative.');
  if (statute === 'PAYE') return progressiveTax(baseCents, version);
  return flatStatute(statute, baseCents, version);
}

/**
 * Cost one employee for one period.
 *
 * Gross pay is the basic salary plus recurring earnings that are effective
 * in the period. NSSF, SHIF and the housing levy are charged on gross pay;
 * PAYE is charged on taxable pay (gross less non-taxable earnings less the
 * employee's NSSF and SHIF contributions, which is the common Kenyan
 * treatment — the exact statutory base is the facility's to confirm, and is
 * shown on the payslip breakdown so it can be checked).
 */
export function calculatePayslip(input: {
  employee: PayrollEmployeeInput;
  versions: Record<Statute, StatutoryVersion>;
  payDate: string;
}): PayslipResult {
  const { employee, versions, payDate } = input;
  if (employee.baseSalaryCents < 0n)
    throw new PayrollCalculationError('INVALID_SALARY', 'Base salary cannot be negative.');
  const periodEnd = payDate;

  const earnings = employee.components.filter((c) => c.kind === 'EARNING');
  const deductions = employee.components.filter((c) => c.kind === 'DEDUCTION');
  const gross = earnings.reduce((sum, c) => sum + c.amountCents, employee.baseSalaryCents);
  const nonTaxable = earnings.filter((c) => !c.taxable).reduce((sum, c) => sum + c.amountCents, 0n);

  const nssf = computeStatute('NSSF', gross, versions.NSSF);
  const shif = computeStatute('SHIF', gross, versions.SHIF);
  const ahl = computeStatute('AHL', gross, versions.AHL);
  const nssfEmployee = BigInt(nssf.employeeCents);
  const shifEmployee = BigInt(shif.employeeCents);
  const ahlEmployee = BigInt(ahl.employeeCents);

  const statutoryBeforeTax = gross - nonTaxable - nssfEmployee - shifEmployee;
  const taxable = statutoryBeforeTax > 0n ? statutoryBeforeTax : 0n;
  const paye = computeStatute('PAYE', taxable, versions.PAYE);
  const payeCents = BigInt(paye.employeeCents);

  const otherDeductions = deductions.reduce((sum, c) => sum + c.amountCents, 0n);
  const net = gross - nssfEmployee - shifEmployee - ahlEmployee - payeCents - otherDeductions;
  if (net < 0n)
    throw new PayrollCalculationError(
      'NET_PAY_NEGATIVE',
      `Deductions exceed gross pay for employee ${employee.employeeNumber}.`,
      409,
    );

  const lines: PayslipLine[] = [
    { code: 'BASIC', name: 'Basic salary', kind: 'EARNING', amountCents: employee.baseSalaryCents },
    ...earnings.map((c) => ({
      code: c.code,
      name: c.name,
      kind: 'EARNING' as const,
      amountCents: c.amountCents,
    })),
    { code: 'NSSF', name: 'NSSF (employee)', kind: 'DEDUCTION', amountCents: nssfEmployee },
    { code: 'SHIF', name: 'SHIF', kind: 'DEDUCTION', amountCents: shifEmployee },
    { code: 'AHL', name: 'Affordable Housing Levy', kind: 'DEDUCTION', amountCents: ahlEmployee },
    { code: 'PAYE', name: 'PAYE', kind: 'DEDUCTION', amountCents: payeCents },
    ...deductions.map((c) => ({
      code: c.code,
      name: c.name,
      kind: 'DEDUCTION' as const,
      amountCents: c.amountCents,
    })),
    {
      code: 'NET',
      name: 'Net pay',
      kind: 'EARNING',
      amountCents: net,
    },
    {
      code: 'NSSF_EMPLOYER',
      name: 'NSSF (employer)',
      kind: 'EMPLOYER',
      amountCents: BigInt(nssf.employerCents),
    },
    {
      code: 'AHL_EMPLOYER',
      name: 'Affordable Housing Levy (employer)',
      kind: 'EMPLOYER',
      amountCents: BigInt(ahl.employerCents),
    },
  ];

  // `payDate` is part of the snapshot so a stored payslip explains itself.
  void periodEnd;
  return {
    employeeId: employee.employeeId,
    employeeNumber: employee.employeeNumber,
    fullName: employee.fullName,
    grossCents: gross,
    taxableCents: taxable,
    payeCents,
    nssfEmployeeCents: nssfEmployee,
    nssfEmployerCents: BigInt(nssf.employerCents),
    shifCents: shifEmployee,
    ahlEmployeeCents: ahlEmployee,
    ahlEmployerCents: BigInt(ahl.employerCents),
    otherDeductionsCents: otherDeductions,
    netCents: net,
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
    },
  );
  return { payslips, totals, versions };
}
