/**
 * Kenyan statutory calculation — the published rules applied end to end.
 *
 * Every expectation here is arithmetic an accountant can reproduce on paper.
 * The versions are built from the published rule catalogue exactly as the
 * install action would write them, so this suite fails if either the engine
 * or the catalogue drifts.
 *
 * All figures are synthetic test data; the rates come from the cited
 * authority publications.
 */
import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  calculatePayroll,
  resolveStatutoryVersions,
  type PayslipResult,
  type Statute,
  type StatutoryVersion,
  type TaxResidency,
} from '../workforce/payroll-calculator.ts';
import {
  STATUTORY_RULEBOOK,
  rulebookEntry,
  rulebookEntryForDate,
} from '../workforce/statutory-rulebook.ts';
import { payrollRuleIssues } from '../workforce/payroll-readiness.ts';

/** Turn a catalogue entry into the version row an install would create. */
function versionFrom(key: string, id: number): StatutoryVersion {
  const entry = rulebookEntry(key);
  if (!entry) throw new Error(`Unknown rulebook entry ${key}`);
  return {
    id,
    statute: entry.statute,
    label: entry.label,
    effectiveFrom: entry.effectiveFrom,
    effectiveTo: entry.effectiveTo,
    authority: entry.authority,
    sourceReference: entry.sourceReference,
    status: 'ACTIVE',
    calculationConfig: entry.calculationConfig,
    bands: entry.bands,
  };
}

/** The versions that would be active for a pay date, resolved from the catalogue. */
function catalogueVersions(payDate: string): StatutoryVersion[] {
  const statutes: Statute[] = ['PAYE', 'NSSF', 'SHIF', 'AHL'];
  return statutes.map((statute, index) => {
    const entry = rulebookEntryForDate(statute, payDate);
    if (!entry) throw new Error(`Catalogue has no ${statute} rule covering ${payDate}`);
    return versionFrom(entry.key, index + 1);
  });
}

const KES = (value: number) => BigInt(Math.round(value * 100));

function slip(options: {
  grossKes?: number;
  baseKes?: number;
  components?: Array<{
    code: string;
    name: string;
    kind: 'EARNING' | 'DEDUCTION';
    amountKes: number;
    taxable?: boolean;
    statutoryExclusions?: string[];
    taxDeductible?: boolean;
  }>;
  payDate?: string;
  taxResidency?: TaxResidency;
  insurancePremiumKes?: number;
}): PayslipResult {
  const payDate = options.payDate ?? '2026-11-28';
  const baseKes = options.baseKes ?? options.grossKes ?? 0;
  return calculatePayslip({
    employee: {
      employeeId: 1,
      employeeNumber: 'SYN-001',
      fullName: 'Synthetic Employee',
      baseSalaryCents: KES(baseKes),
      taxResidency: options.taxResidency,
      insurancePremiumCents: options.insurancePremiumKes
        ? KES(options.insurancePremiumKes)
        : undefined,
      components: (options.components ?? []).map((component) => ({
        code: component.code,
        name: component.name,
        kind: component.kind,
        amountCents: KES(component.amountKes),
        taxable: component.taxable ?? true,
        statutoryExclusions: component.statutoryExclusions,
        taxDeductible: component.taxDeductible,
      })),
    },
    versions: resolveStatutoryVersions(catalogueVersions(payDate), payDate),
    payDate,
  });
}

describe('the published rule catalogue', () => {
  it('covers the four statutes for November 2026 and cites a source for each', () => {
    for (const statute of ['PAYE', 'NSSF', 'SHIF', 'AHL'] as const) {
      const entry = rulebookEntryForDate(statute, '2026-11-28');
      expect(entry, `${statute} should have a rule for November 2026`).toBeDefined();
      expect(entry!.sourceUrl).toMatch(/^https:\/\//);
      expect(entry!.sourceTitle.length).toBeGreaterThan(10);
      expect(entry!.sourcePublishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry!.sourceReference.length).toBeGreaterThan(40);
    }
  });

  it('selects the rule in force on the pay date, not today', () => {
    expect(rulebookEntryForDate('PAYE', '2024-06-30')?.key).toBe('PAYE-2023-07');
    expect(rulebookEntryForDate('PAYE', '2024-12-31')?.key).toBe('PAYE-2024-12');
    expect(rulebookEntryForDate('NSSF', '2026-01-31')).toBeUndefined();
    expect(rulebookEntryForDate('NSSF', '2026-02-01')?.key).toBe('NSSF-2026-02');
  });

  it('publishes no NSSF rate before Year 4 rather than borrowing one', () => {
    expect(() => catalogueVersions('2026-01-15')).toThrowError(/NSSF/);
  });

  it('keeps every catalogue label unique', () => {
    const keys = STATUTORY_RULEBOOK.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('publishes only entries that pass the same validation as a recorded version', () => {
    /*
     * The catalogue is a convenience, not a bypass. Every entry must satisfy
     * the checks an administrator's hand-recorded version faces, otherwise the
     * install button would quietly create rules that can never be activated.
     */
    for (const [index, entry] of STATUTORY_RULEBOOK.entries()) {
      const issues = payrollRuleIssues(versionFrom(entry.key, index + 1));
      expect(issues, `${entry.key}: ${issues.join(' ')}`).toEqual([]);
    }
  });

  it('only publishes entries an install can verify from a real URL', () => {
    for (const entry of STATUTORY_RULEBOOK) {
      expect(entry.sourceUrl).toMatch(/^https?:\/\//);
      expect(entry.citedPassage.length).toBeGreaterThan(20);
      expect(entry.verificationNote).toBeTruthy();
    }
  });
});

describe('November 2026 — KES 100,000 gross', () => {
  /*
   * NSSF: Tier I 6% × 9,000 = 540; Tier II 6% × 91,000 = 5,460; total 6,000.
   * SHIF: 2.75% × 100,000 = 2,750 (above the KES 300 floor).
   * AHL:  1.5% × 100,000 = 1,500 each side.
   * Taxable: 100,000 − 6,000 − 2,750 − 1,500 = 89,750.
   * PAYE:  24,000@10% = 2,400; 8,333@25% = 2,083.25; 57,417@30% = 17,225.10
   *        gross tax 21,708.35; less personal relief 2,400 = 19,308.35.
   * Net:   100,000 − 6,000 − 2,750 − 1,500 − 19,308.35 = 70,441.65.
   * Employer: 6,000 + 1,500 = 7,500; cost 107,500.
   */
  const result = slip({ grossKes: 100_000 });

  it('charges NSSF in two tiers and reports them separately', () => {
    expect(result.nssfEmployeeCents).toBe(KES(6_000));
    expect(result.nssfEmployerCents).toBe(KES(6_000));
    const nssf = result.statutes.find((row) => row.statute === 'NSSF')!;
    expect(nssf.bands.map((band) => band.employeeCents)).toEqual(['54000', '546000']);
    expect(nssf.bands.map((band) => band.employerCents)).toEqual(['54000', '546000']);
  });

  it('charges SHIF at 2.75% and the housing levy at 1.5% on both sides', () => {
    expect(result.shifCents).toBe(KES(2_750));
    expect(result.ahlEmployeeCents).toBe(KES(1_500));
    expect(result.ahlEmployerCents).toBe(KES(1_500));
  });

  it('arrives at taxable pay after the three deductible contributions', () => {
    expect(result.taxableCents).toBe(KES(89_750));
  });

  it('applies the bands cumulatively and then the personal relief', () => {
    expect(result.payeBeforeReliefCents).toBe(KES(21_708) + 35n); // 21,708.35
    expect(result.personalReliefCents).toBe(KES(2_400));
    expect(result.payeCents).toBe(KES(19_308) + 35n); // 19,308.35
  });

  it('pays net salary without touching employer contributions', () => {
    expect(result.netCents).toBe(KES(70_441) + 65n); // 70,441.65
    expect(result.employerContributionsCents).toBe(KES(7_500));
    expect(result.employerCostCents).toBe(KES(107_500));
  });

  it('keeps the payslip lines and the totals consistent', () => {
    const employeeDeductions = result.lines
      .filter((line) => line.kind === 'DEDUCTION')
      .reduce((sum, line) => sum + line.amountCents, 0n);
    expect(employeeDeductions).toBe(result.statutoryDeductionsCents);
    expect(result.grossCents - employeeDeductions).toBe(result.netCents);
    expect(result.grossCents + result.employerContributionsCents).toBe(result.employerCostCents);
  });

  it('records the rule version and effective date used for every statute', () => {
    expect(result.statutes).toHaveLength(4);
    for (const statute of result.statutes) {
      expect(statute.versionId).toBeGreaterThan(0);
      expect(statute.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(statute.label.length).toBeGreaterThan(10);
    }
  });
});

describe('statutory boundaries', () => {
  it('applies the SHIF floor below the 2.75% minimum', () => {
    // 2.75% of 10,000 = 275, below the KES 300 floor.
    expect(slip({ grossKes: 10_000 }).shifCents).toBe(KES(300));
    // 2.75% of 20,000 = 550, above the floor.
    expect(slip({ grossKes: 20_000 }).shifCents).toBe(KES(550));
  });

  it('charges NSSF below, at and above the lower earnings limit', () => {
    expect(slip({ grossKes: 5_000 }).nssfEmployeeCents).toBe(KES(300)); // 6% of 5,000
    expect(slip({ grossKes: 9_000 }).nssfEmployeeCents).toBe(KES(540)); // 6% of 9,000
    // 18,000 = 540 on Tier I plus 540 on the whole of Tier II.
    expect(slip({ grossKes: 18_000 }).nssfEmployeeCents).toBe(KES(1_080));
  });

  it('caps NSSF at the upper earnings limit and does not charge above it', () => {
    expect(slip({ grossKes: 108_000 }).nssfEmployeeCents).toBe(KES(6_480));
    expect(slip({ grossKes: 108_000 }).nssfEmployerCents).toBe(KES(6_480));
    expect(slip({ grossKes: 500_000 }).nssfEmployeeCents).toBe(KES(6_480));
  });

  it('crosses every PAYE band for a high salary', () => {
    /*
     * Taxable on 1,000,000 with NSSF 6,480, SHIF 27,500 and AHL 15,000:
     * 1,000,000 − 48,980 = 951,020.
     * 24,000@10% = 2,400; 8,333@25% = 2,083.25; 467,667@30% = 140,300.10;
     * 300,000@32.5% = 97,500; remaining 151,020@35% = 52,857.
     * Gross tax = 295,140.35; less 2,400 = 292,740.35.
     */
    const result = slip({ grossKes: 1_000_000 });
    expect(result.taxableCents).toBe(KES(951_020));
    expect(result.payeBeforeReliefCents).toBe(KES(295_140) + 35n);
    expect(result.payeCents).toBe(KES(292_740) + 35n);
    expect(result.statutes.find((row) => row.statute === 'PAYE')!.bands).toHaveLength(5);
  });

  it('never lets PAYE go negative when relief exceeds the tax', () => {
    /*
     * 3,000: NSSF 180, SHIF hits the 300 floor, AHL 45 → taxable 2,475.
     * Tax at 10% is 247.50, less the 2,400 personal relief. PAYE is zero,
     * not a negative refund.
     */
    const result = slip({ grossKes: 3_000 });
    expect(result.payeBeforeReliefCents).toBe(24_750n);
    expect(result.payeCents).toBe(0n);
  });

  it('gives a resident the personal relief and a non-resident none', () => {
    const resident = slip({ grossKes: 100_000, taxResidency: 'RESIDENT' });
    const nonResident = slip({ grossKes: 100_000, taxResidency: 'NON_RESIDENT' });
    expect(resident.personalReliefCents).toBe(KES(2_400));
    expect(nonResident.personalReliefCents).toBe(0n);
    expect(nonResident.payeCents - resident.payeCents).toBe(KES(2_400));
    expect(nonResident.netCents).toBeLessThan(resident.netCents);
  });
});

describe('deductions and reliefs', () => {
  it('treats an approved exempt earning as income that is not taxed', () => {
    const result = slip({
      baseKes: 80_000,
      components: [
        {
          code: 'EXEMPT_MEDICAL',
          name: 'Approved exempt reimbursement',
          kind: 'EARNING',
          amountKes: 20_000,
          taxable: false,
        },
      ],
    });
    expect(result.grossCents).toBe(KES(100_000));
    // Exempt earnings stay in gross but are not in the taxable base.
    expect(result.taxableGrossCents).toBe(KES(80_000));
    // 80,000 − 6,000 − 2,750 − 1,500 = 69,750.
    expect(result.taxableCents).toBe(KES(69_750));
  });

  it('deducts a qualifying pension contribution before tax, within the monthly cap', () => {
    const within = slip({
      grossKes: 100_000,
      components: [
        {
          code: 'PENSION',
          name: 'Pension contribution',
          kind: 'DEDUCTION',
          amountKes: 20_000,
          taxDeductible: true,
        },
      ],
    });
    // 100,000 − 6,000 − 2,750 − 1,500 − 20,000 = 69,750
    expect(within.qualifyingPensionCents).toBe(KES(20_000));
    expect(within.taxableCents).toBe(KES(69_750));

    // A 50,000 contribution is capped at the 30,000 monthly limit.
    const capped = slip({
      grossKes: 100_000,
      components: [
        {
          code: 'PENSION',
          name: 'Pension contribution',
          kind: 'DEDUCTION',
          amountKes: 50_000,
          taxDeductible: true,
        },
      ],
    });
    expect(capped.qualifyingPensionCents).toBe(KES(30_000));
    expect(capped.taxableCents).toBe(KES(59_750));
    // The whole contribution is still withheld from net pay.
    expect(capped.otherDeductionsCents).toBe(KES(50_000));
  });

  it('gives insurance relief at 15% of premiums inside the annual ceiling', () => {
    const small = slip({ grossKes: 100_000, insurancePremiumKes: 2_000 });
    expect(small.insuranceReliefCents).toBe(KES(300)); // 15% of 2,000
    // The 60,000 annual ceiling is 5,000 a month: 4,000 earns 600, not 750.
    const large = slip({ grossKes: 100_000, insurancePremiumKes: 4_000 });
    expect(large.insuranceReliefCents).toBe(KES(600));
    // A premium above the cap earns relief on the cap only.
    const beyond = slip({ grossKes: 100_000, insurancePremiumKes: 20_000 });
    expect(beyond.insuranceReliefCents).toBe(KES(750)); // 15% of 5,000
    // 450 more relief than the 2,000-premium case means 450 less PAYE.
    expect(beyond.payeCents).toBe(small.payeCents - KES(450));
  });

  it('subtracts each statutory contribution exactly once from taxable pay', () => {
    const result = slip({ grossKes: 100_000 });
    expect(result.taxableCents).toBe(
      result.grossCents -
        result.nssfEmployeeCents -
        result.shifCents -
        result.ahlEmployeeCents -
        result.qualifyingPensionCents,
    );
  });

  it('includes regular cash allowances in every base and excludes an irregular bonus from AHL', () => {
    const result = slip({
      baseKes: 80_000,
      components: [
        // Regular cash allowance: taxable, and part of gross salary for AHL.
        { code: 'HOUSE', name: 'House allowance', kind: 'EARNING', amountKes: 20_000 },
        // Irregular bonus: taxable income, but not "gross monthly salary" for AHL.
        {
          code: 'BONUS',
          name: 'Annual bonus',
          kind: 'EARNING',
          amountKes: 30_000,
          statutoryExclusions: ['AHL'],
        },
      ],
    });
    expect(result.grossCents).toBe(KES(130_000));
    // AHL base is 80,000 + 20,000 = 100,000 → 1,500.
    expect(result.ahlEmployeeCents).toBe(KES(1_500));
    // NSSF and SHIF see the whole 130,000 (NSSF capped at 108,000).
    expect(result.nssfEmployeeCents).toBe(KES(6_480));
    expect(result.shifCents).toBe(KES(3_575));
  });

  it('costs a part-month at the actual earnings for that month', () => {
    const full = slip({ grossKes: 100_000 });
    const half = slip({ grossKes: 50_000 });
    expect(half.nssfEmployeeCents).toBe(KES(3_000)); // 6% of 50,000
    expect(half.shifCents).toBe(KES(1_375));
    expect(half.ahlEmployeeCents).toBe(KES(750));
    expect(half.netCents).toBeLessThan(full.netCents);
  });
});

describe('calculation trace', () => {
  it('reproduces a payslip from its recorded versions alone', () => {
    const versions = resolveStatutoryVersions(catalogueVersions('2026-11-28'), '2026-11-28');
    const first = calculatePayslip({
      employee: {
        employeeId: 7,
        employeeNumber: 'SYN-007',
        fullName: 'Replay',
        baseSalaryCents: KES(100_000),
        components: [],
      },
      versions,
      payDate: '2026-11-28',
    });
    const second = calculatePayslip({
      employee: {
        employeeId: 7,
        employeeNumber: 'SYN-007',
        fullName: 'Replay',
        baseSalaryCents: KES(100_000),
        components: [],
      },
      versions,
      payDate: '2026-12-28',
    });
    expect(second.netCents).toBe(first.netCents);
    expect(second.statutes.map((s) => s.versionId)).toEqual(first.statutes.map((s) => s.versionId));
  });

  it('totals a run without drift', () => {
    const versions = resolveStatutoryVersions(catalogueVersions('2026-11-28'), '2026-11-28');
    const { totals, payslips } = calculatePayroll({
      versions: catalogueVersions('2026-11-28'),
      payDate: '2026-11-28',
      employees: [100_000, 50_000, 10_000].map((salary, index) => ({
        employeeId: index + 1,
        employeeNumber: `SYN-${index + 1}`,
        fullName: `Employee ${index + 1}`,
        baseSalaryCents: KES(salary),
        components: [],
      })),
    });
    expect(totals.employeeCount).toBe(3);
    expect(totals.grossCents).toBe(payslips.reduce((sum, slip) => sum + slip.grossCents, 0n));
    expect(totals.netCents).toBe(payslips.reduce((sum, slip) => sum + slip.netCents, 0n));
    expect(totals.employerCostCents).toBe(totals.grossCents + totals.employerContributionsCents);
    expect(versions.PAYE.effectiveFrom).toBe('2024-12-01');
  });
});
