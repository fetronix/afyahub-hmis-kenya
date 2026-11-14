/** Screenshot-derived Syrona source. Matching arithmetic is provisional, not verified Excel formulas. */
export const equityTitle = 'Statement of Changes in Partners’ Equity';
export const originalNames = [
  'Lucy Wanjiku',
  'Jesee Mwaniki',
  'Dr. Alex Muriithi',
  'Teresia Gathoni',
  'Dr. George Ngaruiya',
] as const;
export const inputKeys = [
  'opening',
  'capital',
  'interest',
  'salary',
  'drawings',
  'tax',
  'revaluation',
  'adjustments',
] as const;
export type InputKey = (typeof inputKeys)[number];
export type Partner = {
  id: string;
  name: string;
  admittedOn: string | null;
  departedOn: string | null;
  active: boolean;
  order: number;
  original: boolean;
};
export type EquityInputs = Record<InputKey, string | null>;
export type EquityModel = {
  schemaVersion: 1;
  netResult: string;
  partners: Partner[];
  inputs: Record<string, EquityInputs>;
};
export const equityRows = [
  { id: 'opening', label: 'Equity at Beginning of Period' },
  { id: 'capital', label: 'Add: Additional Capital Contributions' },
  { id: 'interest', label: 'Add: Interest on Capital (% Not Defined)' },
  { id: 'salary', label: 'Add: Partners’ Salaries' },
  { id: 'before', label: 'Subtotal Before Profit/Loss Allocation' },
  { id: 'sharing', label: 'Profit Sharing Ratio' },
  { id: 'allocation', label: 'Add: Share of Net Profit/(Loss)' },
  { id: 'after', label: 'Subtotal After Profit/Loss' },
  { id: 'drawings', label: 'Less: Drawings/Withdrawals' },
  { id: 'tax', label: 'Less: Tax on Partners’ Income' },
  { id: 'revaluation', label: 'Add/(Less): Revaluation of Assets' },
  { id: 'adjustments', label: 'Add/(Less): Other Adjustments' },
  { id: 'closing', label: 'Equity at End of Period' },
  {
    id: 'ownership',
    label: 'Percentage Ownership adjusted for depreciation — PROVISIONAL (formula unverified)',
  },
] as const;
export type RowKey = (typeof equityRows)[number]['id'];
export const formulaDefinitions = {
  before: 'opening + capital + interest + salary',
  sharing: 'partner before / total before (full precision)',
  allocation: 'netResult × partner before / total before (full precision)',
  after: 'before + allocation',
  closing: 'after + drawings + tax + revaluation + adjustments (signed movements)',
  ownership: 'partner closing / total closing (full precision)',
};
export const formulaNotice =
  'PROVISIONAL — screenshot-matching arithmetic, not verified workbook formulas. Ownership’s depreciation adjustment is not independently defined. No interest or tax rate or original admission date is inferred. Dashes remain unspecified inputs; they contribute no amount to provisional arithmetic, not confirmed source zeroes. Explicit review acceptance is required before approval.';
export const sourceNotes = [
  'Capital contributions, salaries and withdrawals remain unaffected by the loan unless partners choose to inject more capital to support repayments.',
  'Future loan principal repayments or additional interest may further reduce net profit and equity unless revenues increase; no loan schedule or automatic adjustment is supplied.',
  'Opening equity represents the initial capital each partner contributed to start Syrona Medical Center.',
  'Additional capital represents further investment during the period to fund setup costs.',
  'Interest on capital is subject to partner agreement; the example 5% in the screenshot note is not an approved rate.',
  'Partner salaries are subject to agreement; illustrative KES 10,000 per month is not a supplied calculation rule.',
  'Net result is distributed according to the partnership; the matched proportional rule requires review.',
  'Drawings are personal withdrawals. Tax liability and revaluation/depreciation rules require independent review.',
];
export function baselinePartners(): Partner[] {
  return originalNames.map((name, i) => ({
    id: `original-${i + 1}`,
    name,
    admittedOn: null,
    departedOn: null,
    active: true,
    order: i,
    original: true,
  }));
}
export function emptyInputs(): EquityInputs {
  return Object.fromEntries(inputKeys.map((k) => [k, null])) as EquityInputs;
}
export function baselineEquity(): EquityModel {
  const partners = baselinePartners();
  const opening = ['799999.99', '200000.00', '900000.00', '350000.00', '500000.00'];
  const capital = ['1133000.00', '98000.00', '250000.00', '50000.00', '197400.00'];
  return {
    schemaVersion: 1,
    netResult: '-2353704.47',
    partners,
    inputs: Object.fromEntries(
      partners.map((p, i) => [
        p.id,
        {
          ...emptyInputs(),
          opening: opening[i],
          capital: capital[i],
          salary: i === 3 ? '540000.00' : null,
          drawings: i === 0 ? '-10000.00' : i === 3 ? '-50000.00' : null,
        },
      ]),
    ),
  };
}
