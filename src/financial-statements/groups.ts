/**
 * JaliCare HMIS — presentation groups for the financial statements.
 *
 * An account's `sub_type` is free text written by whoever created the account,
 * so it can be anything from `CURRENT_ASSET` to `PAYROLL`. A balance sheet line
 * that silently accepted an unfamiliar subtype could report a liability inside
 * property, plant and equipment, which is worse than refusing to produce the
 * statement.
 *
 * The rule here is therefore: resolve a presentation group from a documented
 * set of tokens; when nothing matches, return UNCLASSIFIED. Unclassified
 * accounts with a balance block approval and are listed for the accountant to
 * map explicitly. No account is ever created by this module.
 */

export const PRESENTATION_GROUPS = [
  // Non-current assets
  'NON_CURRENT_PPE',
  'ACCUMULATED_DEPRECIATION',
  'INTANGIBLE',
  'OTHER_NON_CURRENT_ASSET',
  // Current assets
  'INVENTORY',
  'RECEIVABLE',
  'PREPAYMENT',
  'CASH_AT_BANK',
  'CASH_ON_HAND',
  // Equity
  'PARTNERS_CAPITAL',
  'RETAINED_EARNINGS',
  'OTHER_EQUITY',
  // Liabilities
  'NON_CURRENT_LIABILITY',
  'PAYABLES',
  'STATUTORY_LIABILITY',
  'OTHER_CURRENT_LIABILITY',
  // Results
  'REVENUE',
  'OTHER_INCOME',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'DEPRECIATION_EXPENSE',
  'FINANCE_COST',
  'TAX_EXPENSE',
  // The honest fallback.
  'UNCLASSIFIED',
] as const;

export type PresentationGroup = (typeof PRESENTATION_GROUPS)[number];

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

const SET = new Set<string>(PRESENTATION_GROUPS);

export function isPresentationGroup(value: unknown): value is PresentationGroup {
  return typeof value === 'string' && SET.has(value);
}

/** Groups that hold cash, and are therefore the basis of the cash-flow statement. */
export const CASH_GROUPS: ReadonlySet<PresentationGroup> = new Set([
  'CASH_AT_BANK',
  'CASH_ON_HAND',
]);

export const ASSET_GROUPS: ReadonlySet<PresentationGroup> = new Set([
  'NON_CURRENT_PPE',
  'ACCUMULATED_DEPRECIATION',
  'INTANGIBLE',
  'OTHER_NON_CURRENT_ASSET',
  'INVENTORY',
  'RECEIVABLE',
  'PREPAYMENT',
  'CASH_AT_BANK',
  'CASH_ON_HAND',
]);

export const LIABILITY_GROUPS: ReadonlySet<PresentationGroup> = new Set([
  'NON_CURRENT_LIABILITY',
  'PAYABLES',
  'STATUTORY_LIABILITY',
  'OTHER_CURRENT_LIABILITY',
]);

export const EQUITY_GROUPS: ReadonlySet<PresentationGroup> = new Set([
  'PARTNERS_CAPITAL',
  'RETAINED_EARNINGS',
  'OTHER_EQUITY',
]);

/** Profit-and-loss groups, in presentation order. */
export const RESULT_GROUPS: readonly PresentationGroup[] = [
  'REVENUE',
  'OTHER_INCOME',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'DEPRECIATION_EXPENSE',
  'FINANCE_COST',
  'TAX_EXPENSE',
];

/** Human labels used by the statements, exports and the mapping screen. */
export const GROUP_LABELS: Record<PresentationGroup, string> = {
  NON_CURRENT_PPE: 'Property, plant and equipment',
  ACCUMULATED_DEPRECIATION: 'Accumulated depreciation',
  INTANGIBLE: 'Intangible assets',
  OTHER_NON_CURRENT_ASSET: 'Other non-current assets',
  INVENTORY: 'Inventories',
  RECEIVABLE: 'Trade and other receivables',
  PREPAYMENT: 'Prepayments',
  CASH_AT_BANK: 'Cash at bank',
  CASH_ON_HAND: 'Cash on hand',
  PARTNERS_CAPITAL: "Partners' capital",
  RETAINED_EARNINGS: 'Retained earnings',
  OTHER_EQUITY: 'Other equity',
  NON_CURRENT_LIABILITY: 'Non-current liabilities',
  PAYABLES: 'Trade and other payables',
  STATUTORY_LIABILITY: 'Statutory liabilities',
  OTHER_CURRENT_LIABILITY: 'Other current liabilities',
  REVENUE: 'Revenue',
  OTHER_INCOME: 'Other income',
  COST_OF_SALES: 'Cost of sales',
  OPERATING_EXPENSE: 'Operating expenses',
  DEPRECIATION_EXPENSE: 'Depreciation and amortisation',
  FINANCE_COST: 'Finance costs',
  TAX_EXPENSE: 'Tax expense',
  UNCLASSIFIED: 'Unclassified accounts',
};

/** Note references keep the statements readable and traceable to a schedule. */
export const GROUP_NOTES: Record<PresentationGroup, string> = {
  NON_CURRENT_PPE: '3',
  ACCUMULATED_DEPRECIATION: '3',
  INTANGIBLE: '4',
  OTHER_NON_CURRENT_ASSET: '5',
  INVENTORY: '6',
  RECEIVABLE: '7',
  PREPAYMENT: '8',
  CASH_AT_BANK: '9',
  CASH_ON_HAND: '9',
  PARTNERS_CAPITAL: '10',
  RETAINED_EARNINGS: '10',
  OTHER_EQUITY: '10',
  NON_CURRENT_LIABILITY: '11',
  PAYABLES: '12',
  STATUTORY_LIABILITY: '12',
  OTHER_CURRENT_LIABILITY: '12',
  REVENUE: '13',
  OTHER_INCOME: '13',
  COST_OF_SALES: '14',
  OPERATING_EXPENSE: '15',
  DEPRECIATION_EXPENSE: '3',
  FINANCE_COST: '16',
  TAX_EXPENSE: '17',
  UNCLASSIFIED: '18',
};

type ClassifiableAccount = {
  accountType: string;
  subType?: string | null;
  accountCode?: string | null;
  accountName?: string | null;
};

/**
 * Normalise free-text subtypes before matching: `CURRENT ASSET`, `current-asset`
 * and `current_asset` describe the same thing.
 */
function token(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function has(value: string, ...needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

/**
 * The documented default classification.
 *
 * Order matters: the more specific token wins, so `ACCUMULATED_DEPRECIATION`
 * is not mistaken for depreciation expense and `NON_CURRENT_LIABILITY` is not
 * mistaken for a current payable.
 */
export function defaultPresentationGroup(account: ClassifiableAccount): PresentationGroup {
  const type = token(account.accountType);
  const sub = token(account.subType);

  if (type === 'ASSET') {
    if (has(sub, 'ACCUMULATED_DEPRECIATION', 'ACC_DEP', 'ACCUM_DEP'))
      return 'ACCUMULATED_DEPRECIATION';
    if (has(sub, 'CASH_AT_BANK', 'BANK', 'MOBILE_MONEY', 'PETTY_CASH_BANK')) return 'CASH_AT_BANK';
    if (has(sub, 'CASH')) return 'CASH_ON_HAND';
    if (has(sub, 'RECEIVABLE', 'DEBTOR', 'AR_', '_AR', 'INSURANCE_RECEIVABLE')) return 'RECEIVABLE';
    if (has(sub, 'INVENTORY', 'STOCK', 'INVENTORIES')) return 'INVENTORY';
    if (has(sub, 'PREPAY', 'PREPAID', 'DEPOSIT')) return 'PREPAYMENT';
    if (has(sub, 'INTANGIBLE', 'SOFTWARE', 'GOODWILL')) return 'INTANGIBLE';
    if (has(sub, 'PPE', 'PROPERTY', 'FIXED_ASSET', 'PLANT', 'EQUIPMENT', 'MOTOR', 'FURNITURE'))
      return 'NON_CURRENT_PPE';
    if (has(sub, 'NON_CURRENT', 'LONG_TERM')) return 'OTHER_NON_CURRENT_ASSET';
    return 'UNCLASSIFIED';
  }

  if (type === 'LIABILITY') {
    if (has(sub, 'STATUTORY', 'PAYE', 'NSSF', 'SHIF', 'AHL', 'HOUSING_LEVY', 'VAT', 'TAX'))
      return 'STATUTORY_LIABILITY';
    if (has(sub, 'PAYABLE', 'CREDITOR', 'SUPPLIER', 'AP_', '_AP')) return 'PAYABLES';
    if (has(sub, 'LOAN', 'BORROW', 'MORTGAGE', 'LEASE', 'NON_CURRENT', 'LONG_TERM'))
      return 'NON_CURRENT_LIABILITY';
    return 'UNCLASSIFIED';
  }

  if (type === 'EQUITY') {
    if (has(sub, 'PARTNER', 'CAPITAL')) return 'PARTNERS_CAPITAL';
    if (has(sub, 'RETAINED', 'ACCUMULATED')) return 'RETAINED_EARNINGS';
    return 'OTHER_EQUITY';
  }

  if (type === 'REVENUE') {
    if (has(sub, 'OTHER_INCOME', 'OTHER')) return 'OTHER_INCOME';
    if (has(sub, 'REVENUE', 'INCOME', 'SALES', 'SERVICE')) return 'REVENUE';
    return 'UNCLASSIFIED';
  }

  if (type === 'EXPENSE') {
    if (has(sub, 'DEPRECIATION', 'AMORTISATION', 'AMORTIZATION')) return 'DEPRECIATION_EXPENSE';
    if (has(sub, 'COST_OF_SALES', 'COST_OF_GOODS', 'COS', 'DIRECT_COST')) return 'COST_OF_SALES';
    if (has(sub, 'FINANCE', 'INTEREST')) return 'FINANCE_COST';
    if (has(sub, 'TAX')) return 'TAX_EXPENSE';
    if (has(sub, 'OPERATING', 'ADMIN', 'SALAR', 'PAYROLL', 'UTILIT', 'RENT', 'SUPPLIES'))
      return 'OPERATING_EXPENSE';
    return 'UNCLASSIFIED';
  }

  return 'UNCLASSIFIED';
}

/**
 * Resolve the group for one account, honouring a stored override.
 *
 * An override that names an unknown group, or that puts an account in a group
 * belonging to a different side of the ledger (a liability in `CASH_AT_BANK`),
 * is ignored rather than applied: a bad mapping must not silently rearrange the
 * statements.
 */
export function resolvePresentationGroup(
  account: ClassifiableAccount & { id: number },
  overrides: ReadonlyMap<number, string>,
): { group: PresentationGroup; source: 'OVERRIDE' | 'DEFAULT' | 'INVALID_OVERRIDE' } {
  const stored = overrides.get(account.id);
  if (stored) {
    if (isPresentationGroup(stored) && groupMatchesType(stored, account.accountType))
      return { group: stored, source: 'OVERRIDE' };
    return { group: defaultPresentationGroup(account), source: 'INVALID_OVERRIDE' };
  }
  return { group: defaultPresentationGroup(account), source: 'DEFAULT' };
}

/** Whether a group may legitimately hold an account of this type. */
export function groupMatchesType(group: PresentationGroup, accountType: string): boolean {
  if (group === 'UNCLASSIFIED') return true;
  const type = token(accountType);
  if (type === 'ASSET') return ASSET_GROUPS.has(group);
  if (type === 'LIABILITY') return LIABILITY_GROUPS.has(group);
  if (type === 'EQUITY') return EQUITY_GROUPS.has(group);
  if (type === 'REVENUE') return group === 'REVENUE' || group === 'OTHER_INCOME';
  if (type === 'EXPENSE') {
    return (
      group === 'COST_OF_SALES' ||
      group === 'OPERATING_EXPENSE' ||
      group === 'DEPRECIATION_EXPENSE' ||
      group === 'FINANCE_COST' ||
      group === 'TAX_EXPENSE'
    );
  }
  return false;
}

/** Groups offered in the mapping dropdown for a given account type. */
export function groupsForAccountType(accountType: string): PresentationGroup[] {
  return PRESENTATION_GROUPS.filter(
    (group) => group !== 'UNCLASSIFIED' && groupMatchesType(group, accountType),
  );
}
