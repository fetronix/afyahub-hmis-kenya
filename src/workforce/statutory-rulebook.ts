/**
 * Syrona Medical Center HMIS
 * Published statutory rule catalogue.
 *
 * This module holds *reference data*, not calculation logic. It is the set of
 * Kenyan rules the application can install into a facility's effective-dated
 * configuration so an administrator does not retype published figures from a
 * PDF. Nothing here is used by the calculator directly: installing an entry
 * creates an ordinary draft `payroll_statutory_versions` row (with its bands
 * and calculation config) which still has to be verified and activated by an
 * authorised user before a payroll run may use it.
 *
 * Every entry records where its figures came from — authority, instrument,
 * publication date, URL and the exact passage relied on — and the tense of
 * each note. Where a figure could not be read from a machine-readable page
 * (the NSSF Year 4 notice is published as an image), the entry says so and
 * the installer keeps the version unverified until a named user attests.
 *
 * The application does not certify legal compliance. Installing, verifying
 * and activating a rule is a facility decision recorded against a person and
 * a date.
 */

import type { CalculationConfig, Statute, StatutoryBand } from './payroll-calculator.ts';

export type RulebookEntry = {
  /** Stable identifier used by the install endpoint and shown in the UI. */
  key: string;
  statute: Statute;
  label: string;
  ruleName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  authority: string;
  calculationMethod: string;
  currency: 'KES';
  basis: string;
  /** Short citation stored on the version (`source_reference`). */
  sourceReference: string;
  sourceTitle: string;
  sourceUrl: string;
  /** ISO date the authority published the source. */
  sourcePublishedOn: string;
  /** Where the figures were read from, in the authority's own terms. */
  citedPassage: string;
  /** What a verifier should check before attesting. */
  verificationNote: string;
  notes: string[];
  bands: StatutoryBand[];
  calculationConfig: CalculationConfig;
};

const band = (
  sequence: number,
  lowerBoundCents: string,
  upperBoundCents: string | null,
  employeeRateBp: number,
  employerRateBp: number,
  reliefCents = '0',
): StatutoryBand => ({
  sequence,
  lowerBoundCents: BigInt(lowerBoundCents),
  upperBoundCents: upperBoundCents === null ? null : BigInt(upperBoundCents),
  employeeRateBp,
  employerRateBp,
  employeeFixedCents: 0n,
  employerFixedCents: 0n,
  employeeCapCents: null,
  employerCapCents: null,
  reliefCents: BigInt(reliefCents),
});

/*
 * KRA monthly bands, Finance Act 2023 (effective 1 July 2023).
 * Cumulative band ceilings: 24,000 → 32,333 → 500,000 → 800,000 KES.
 */
const PAYE_BANDS: StatutoryBand[] = [
  band(1, '0', '2400000', 1000, 0),
  band(2, '2400000', '3233300', 2500, 0),
  band(3, '3233300', '50000000', 3000, 0),
  band(4, '50000000', '80000000', 3250, 0),
  band(5, '80000000', null, 3500, 0),
];

/**
 * NSSF Year 4. Tier I charges 6% of pensionable pay up to KES 9,000; Tier II
 * charges 6% of pensionable pay between KES 9,000 and KES 108,000. Band
 * bounds carry the limits, so the maximum contribution is 6% × 108,000 =
 * KES 6,480 per side without a separate cap.
 */
const NSSF_BANDS: StatutoryBand[] = [
  band(1, '0', '900000', 600, 600),
  band(2, '900000', '10800000', 600, 600),
];

const SHIF_BANDS: StatutoryBand[] = [band(1, '0', null, 275, 0)];
const AHL_BANDS: StatutoryBand[] = [band(1, '0', null, 150, 150)];

const KRA_PAYE_URL = 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye';
const KRA_PAYE_AMENDMENT_URL =
  'https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024';
const KRA_EMPLOYER_GUIDANCE_URL =
  'https://www.kra.go.ke/news-center/public-notices/2307-guidance-on-employer-obligations-in-applying-income-tax-deductions,-reliefs-and-exemptions';
const NSSF_YEAR4_URL =
  'https://www.nssf.or.ke/notice-to-employers-year-4-2026-nssf-contribution-rates';
const KRA_AHL_URL =
  'https://www.kra.go.ke/news-center/public-notices/2099-collection-of-the-affordable-housing-levy';
const SHIF_REGULATIONS_URL = 'https://new.kenyalaw.org/akn/ke/act/ln/2024/49/eng@2024-09-20/source';

/**
 * PAYE before the Tax Laws (Amendment) Act 2024. SHIF and AHL were not yet
 * deductible in arriving at taxable employment income, so a facility that
 * reprints a 2024 payslip gets the treatment that applied then rather than
 * today's.
 */
const PAYE_PRE_AMENDMENT: RulebookEntry = {
  key: 'PAYE-2023-07',
  statute: 'PAYE',
  label: 'PAYE — Finance Act 2023 bands (1 July 2023 to 30 November 2024)',
  ruleName: 'Individual income tax on employment income — monthly PAYE bands',
  effectiveFrom: '2023-07-01',
  effectiveTo: '2024-11-30',
  authority: 'Kenya Revenue Authority (Income Tax Act, Cap 470; Finance Act 2023)',
  calculationMethod: 'PROGRESSIVE_MONTHLY_BANDS_WITH_RELIEFS',
  currency: 'KES',
  basis: 'TAXABLE_EMPLOYMENT_INCOME',
  sourceReference:
    'KRA — Pay As You Earn (PAYE): "Income Tax Individual Tax Rates ... as per Finance Act 2023 as tabulated (effective 1st July 2023)" and "Personal Tax Relief KShs. 2,400.00".',
  sourceTitle: 'KRA — Pay As You Earn (PAYE)',
  sourceUrl: KRA_PAYE_URL,
  sourcePublishedOn: '2023-07-01',
  citedPassage:
    'Bands table (monthly): first 24,000 @ 10%; next 8,333 @ 25%; next 467,667 @ 30%; next 300,000 @ 32.5%; above 800,000 @ 35%. Personal Tax Relief KShs 2,400.00 monthly. Insurance relief 15% of premiums up to KShs 60,000 per annum. Allowable deductions include pension/provident up to KShs 360,000 per year.',
  verificationNote:
    'Confirm the band table and personal relief on the KRA PAYE page, and that SHIF/AHL were not yet deductible in the period being paid.',
  notes: [
    'Period before the Tax Laws (Amendment) Act 2024 took effect; SHIF and AHL are not deducted in arriving at taxable pay here.',
    'The 2023 Act granted an Affordable Housing Relief, which this version does not model as a credit; facilities that claimed it must review historical payslips with their tax adviser.',
  ],
  bands: PAYE_BANDS,
  calculationConfig: {
    deductNssf: true,
    deductShif: false,
    deductAhl: false,
    employeeMinimumCents: '0',
    employerMinimumCents: '0',
    personalReliefCents: '240000',
    insuranceReliefRateBp: 1500,
    insuranceReliefAnnualPremiumCapCents: '6000000',
    pensionDeductionCapCents: '3000000',
    personalReliefForNonResidents: false,
  },
};

const PAYE_CURRENT: RulebookEntry = {
  key: 'PAYE-2024-12',
  statute: 'PAYE',
  label: 'PAYE — Tax Laws (Amendment) Act 2024 bands (December 2024 onwards)',
  ruleName: 'Individual income tax on employment income — monthly PAYE bands',
  effectiveFrom: '2024-12-01',
  effectiveTo: null,
  authority: 'Kenya Revenue Authority (Income Tax Act, Cap 470; Tax Laws (Amendment) Act 2024)',
  calculationMethod: 'PROGRESSIVE_MONTHLY_BANDS_WITH_RELIEFS',
  currency: 'KES',
  basis: 'TAXABLE_EMPLOYMENT_INCOME',
  sourceReference:
    'KRA public notice 2157 (19/12/2024) "Amendments to PAYE Computation Pursuant to the Tax Laws (Amendment) Act, 2024" — amounts deductible now include AHL, SHIF and pension contributions; and KRA PAYE page for the band table and personal relief.',
  sourceTitle: 'Amendments to PAYE Computation Pursuant to the Tax Laws (Amendment) Act, 2024',
  sourceUrl: KRA_PAYE_AMENDMENT_URL,
  sourcePublishedOn: '2024-12-19',
  citedPassage:
    '"pursuant to the Tax Laws (Amendment) Act, 2024 which comes into force on 27th December 2024, the following changes shall be applicable in the computation of PAYE for December 2024 and subsequent periods" — deductible amounts include AHL, SHIF, post-retirement medical fund (15,000/month), mortgage interest (360,000/year) and pension/provident contributions (360,000/year).',
  verificationNote:
    'KRA applies the amendment to December 2024 computations although the Act commenced on 27 December 2024; confirm this treatment for any pay date between 1 and 26 December 2024. Confirm the band table and personal relief on the KRA PAYE page.',
  notes: [
    'The Affordable Housing Relief and the Post-Retirement Medical Fund Relief ceased to apply as reliefs under this Act; the underlying contributions became deductions instead.',
    'Personal relief is granted to resident individuals. Non-residents are charged PAYE but receive no personal relief under this version.',
    'Employer guidance notice 2307 is recorded as supporting guidance; verify the current notice before attesting.',
  ],
  bands: PAYE_BANDS,
  calculationConfig: {
    deductNssf: true,
    deductShif: true,
    deductAhl: true,
    employeeMinimumCents: '0',
    employerMinimumCents: '0',
    personalReliefCents: '240000',
    insuranceReliefRateBp: 1500,
    insuranceReliefAnnualPremiumCapCents: '6000000',
    pensionDeductionCapCents: '3000000',
    personalReliefForNonResidents: false,
  },
};

const NSSF_YEAR_FOUR: RulebookEntry = {
  key: 'NSSF-2026-02',
  statute: 'NSSF',
  label: 'NSSF — Year 4 (2026) contribution rates (1 February 2026 onwards)',
  ruleName: 'NSSF pension contributions — Tier I and Tier II',
  effectiveFrom: '2026-02-01',
  effectiveTo: null,
  authority: 'National Social Security Fund (NSSF Act 2013; Year 4 contribution rates)',
  calculationMethod: 'TIERED_PENSION_CONTRIBUTION',
  currency: 'KES',
  basis: 'PENSIONABLE_EARNINGS',
  sourceReference:
    'NSSF "Notice to Employers – Year 4 (2026) NSSF Contribution Rates", published 18 February 2026: employee 6%, employer 6%, lower earnings limit KES 9,000, upper earnings limit KES 108,000.',
  sourceTitle: 'NOTICE TO EMPLOYERS – YEAR 4 (2026) NSSF CONTRIBUTION RATES',
  sourceUrl: NSSF_YEAR4_URL,
  sourcePublishedOn: '2026-02-18',
  citedPassage:
    'Year 4 (2026) rates: employee 6% and employer 6% of pensionable earnings; Tier I on pensionable earnings up to KES 9,000; Tier II on pensionable earnings between KES 9,000 and KES 108,000 (maximum KES 6,480 per side per month).',
  verificationNote:
    'The NSSF notice is published as an image, so the two earnings limits could not be read from the page text in this environment. Confirm both limits and both rates against the published notice (or a later NSSF notice) before attesting.',
  notes: [
    'Band bounds carry the statutory limits: Tier I ends at the lower earnings limit and Tier II at the upper earnings limit, so no separate cap is needed.',
    'Earlier NSSF years are not in this catalogue. Payroll dated before 1 February 2026 reports a date gap rather than borrowing these limits.',
  ],
  bands: NSSF_BANDS,
  calculationConfig: {
    deductNssf: true,
    deductShif: true,
    deductAhl: true,
    employeeMinimumCents: '0',
    employerMinimumCents: '0',
  },
};

const SHIF: RulebookEntry = {
  key: 'SHIF-2024-10',
  statute: 'SHIF',
  label: 'SHIF — Social Health Insurance Fund (1 October 2024 onwards)',
  ruleName: 'Social Health Insurance Fund contribution',
  effectiveFrom: '2024-10-01',
  effectiveTo: null,
  authority: 'Social Health Authority (Social Health Insurance Act 2023; Regulations 2024)',
  calculationMethod: 'PERCENTAGE_WITH_MONTHLY_MINIMUM',
  currency: 'KES',
  basis: 'GROSS_MONTHLY_SALARY',
  sourceReference:
    'Social Health Insurance Regulations 2024 (Legal Notice 49 of 2024), regulation 17 — 2.75% of gross monthly salary, minimum KES 300 per month; effective 1 October 2024.',
  sourceTitle: 'Social Health Insurance Regulations, 2024 (Legal Notice No. 49 of 2024)',
  sourceUrl: SHIF_REGULATIONS_URL,
  sourcePublishedOn: '2024-09-20',
  citedPassage:
    'Regulation 17: a salaried member contributes 2.75% of gross monthly salary, subject to a minimum of KES 300 per month; the employer withholds and remits the member contribution.',
  verificationNote:
    'The kenyalaw.org page could not be retrieved in this environment. Confirm regulation 17 and the commencement date (1 October 2024) against the gazetted regulations before attesting.',
  notes: [
    'SHIF replaced NHIF contributions from 1 October 2024. The former NHIF band table is not reproduced here and must not be used for periods on or after that date.',
    'The employer contribution is zero. SHIF is an allowable deduction in arriving at taxable employment income; the separate insurance relief does not apply to it.',
  ],
  bands: SHIF_BANDS,
  calculationConfig: {
    deductNssf: true,
    deductShif: true,
    deductAhl: true,
    employeeMinimumCents: '30000',
    employerMinimumCents: '0',
  },
};

const AHL: RulebookEntry = {
  key: 'AHL-2024-03',
  statute: 'AHL',
  label: 'Affordable Housing Levy (19 March 2024 onwards)',
  ruleName: 'Affordable Housing Levy — employee and employer',
  effectiveFrom: '2024-03-19',
  effectiveTo: null,
  authority: 'Kenya Revenue Authority (Affordable Housing Act 2024; Employment Act 2007 s.31B)',
  calculationMethod: 'PERCENTAGE_EMPLOYEE_AND_EMPLOYER_MATCH',
  currency: 'KES',
  basis: 'GROSS_MONTHLY_SALARY',
  sourceReference:
    'KRA public notice "Collection of Affordable Housing Levy by Kenya Revenue Authority" (21/03/2024): 1.5% of the employee\'s gross monthly salary by the employee and 1.5% by the employer, with effect from 19 March 2024.',
  sourceTitle: 'Collection of Affordable Housing Levy by Kenya Revenue Authority',
  sourceUrl: KRA_AHL_URL,
  sourcePublishedOn: '2024-03-21',
  citedPassage:
    "\"With effect from 19th March, 2024, all Employers are required to deduct the AHL from the employee's gross salary and remit together with the employer's contribution as follows: 1.5% of the employee's gross monthly salary by the employee; 1.5% of the employee's monthly gross salary by the employer.\"",
  verificationNote:
    'Confirm the current rate and effective date on KRA guidance; the Finance Act 2023 imposed the levy from 1 July 2023 and the Affordable Housing Act 2024 designated KRA as collector from 19 March 2024.',
  notes: [
    'Gross monthly salary for the levy includes basic salary and regular cash allowances; non-cash benefits and irregular payments are excluded by KRA guidance. The payroll engine does this by excluding earnings an operator flags for AHL, not by guessing.',
    'The employer 1.5% is a cost to the employer and is never deducted from employee net pay.',
  ],
  bands: AHL_BANDS,
  calculationConfig: {
    deductNssf: true,
    deductShif: true,
    deductAhl: true,
    employeeMinimumCents: '0',
    employerMinimumCents: '0',
  },
};

export const STATUTORY_RULEBOOK: readonly RulebookEntry[] = Object.freeze([
  PAYE_PRE_AMENDMENT,
  PAYE_CURRENT,
  NSSF_YEAR_FOUR,
  SHIF,
  AHL,
]);

export const RULEBOOK_STATUTES: readonly Statute[] = Object.freeze([
  'PAYE',
  'NSSF',
  'SHIF',
  'AHL',
] as const);

export function rulebookEntry(key: string): RulebookEntry | undefined {
  return STATUTORY_RULEBOOK.find((entry) => entry.key === key);
}

/**
 * The catalogue entry that governs `date` for one statute: the entry whose
 * range contains the date. Returns undefined when the catalogue has no rule
 * for that date, which the caller must report rather than substitute.
 */
export function rulebookEntryForDate(statute: Statute, date: string): RulebookEntry | undefined {
  return STATUTORY_RULEBOOK.filter(
    (entry) => entry.statute === statute && entry.effectiveFrom <= date,
  )
    .filter((entry) => entry.effectiveTo === null || entry.effectiveTo >= date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
    .at(0);
}

/** Entries that start on or before `date` and are still open (for UI listing). */
export function currentRulebookEntries(date: string): RulebookEntry[] {
  return RULEBOOK_STATUTES.flatMap((statute) => {
    const entry = rulebookEntryForDate(statute, date);
    return entry ? [entry] : [];
  });
}

/** Employer guidance recorded for reference; not used by the calculator. */
export const PAYROLL_SOURCE_GUIDANCE = Object.freeze([
  {
    title:
      'KRA — Guidance on employer obligations in applying income tax deductions, reliefs and exemptions',
    url: KRA_EMPLOYER_GUIDANCE_URL,
  },
  {
    title: 'KRA — Pay As You Earn (PAYE): bands, personal relief, allowable deductions',
    url: KRA_PAYE_URL,
  },
  {
    title: 'KRA — Amendments to PAYE computation pursuant to the Tax Laws (Amendment) Act, 2024',
    url: KRA_PAYE_AMENDMENT_URL,
  },
  {
    title: 'NSSF — Notice to employers, Year 4 (2026) contribution rates',
    url: NSSF_YEAR4_URL,
  },
  {
    title: 'KRA — Collection of the Affordable Housing Levy',
    url: KRA_AHL_URL,
  },
  {
    title: 'Social Health Insurance Regulations, 2024 (Legal Notice No. 49 of 2024)',
    url: SHIF_REGULATIONS_URL,
  },
]);
