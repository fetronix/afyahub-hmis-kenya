/**
 * JaliCare HMIS — financial statement derivation.
 *
 * Everything here is a pure function of ledger totals that the caller has
 * already read. No statement is ever given a figure the ledger does not
 * contain, and no difference is rounded into a plug:
 *
 *   - Balance-sheet lines are grouped by account *type* first. Whatever an
 *     account's subtype, its balance lands in assets, liabilities, equity or
 *     the period result, so `assets = equity + liabilities` follows from the
 *     fact that every journal balances. Where a subtype cannot be resolved to
 *     a presentation group, the residual is shown as an explicit unclassified
 *     row with the account codes behind it.
 *   - The cash-flow statement is derived from the same balance-sheet
 *     movements, so it ties to the change in cash by construction. If it ever
 *     fails to tie, the check reports the difference instead of adjusting it.
 *   - Year-end closing journals (`sourceType = 'YEAR_END_CLOSE'`) are excluded
 *     from trading results, so a closed year still shows its revenue and
 *     expenses rather than a column of zeroes.
 */

import { GROUP_LABELS, GROUP_NOTES, type PresentationGroup } from './groups.ts';
import { cents, centsString, sumCents } from './money.ts';
import {
  classifyAccounts,
  type AccountClassification,
  type ClassifiableAccount,
} from './classification.ts';
import { daysBetween, previousDay } from './period.ts';
import type {
  BalanceSheetBlock,
  CashFlowBlock,
  CashbookAccount,
  CashbookBlock,
  ClassificationSummary,
  EquityMovementRow,
  EquityStatementBlock,
  FixedAssetBlock,
  GeneralLedgerAccount,
  GeneralLedgerBlock,
  IncomeStatementBlock,
  ManagementNote,
  PartyRow,
  PartyStatementBlock,
  StatementMeta,
  StatementPayload,
  StatementRow,
  TrialBalanceBlock,
  TrialBalanceRow,
  ValidationCheck,
} from './types.ts';

export interface LedgerAccountInput extends ClassifiableAccount {}

export interface AccountMovement {
  accountId: number;
  closingDebitCents: bigint;
  closingCreditCents: bigint;
  periodDebitCents: bigint;
  periodCreditCents: bigint;
  priorDebitCents: bigint;
  priorCreditCents: bigint;
  comparativeDebitCents: bigint;
  comparativeCreditCents: bigint;
}

export interface LedgerLineInput {
  accountId: number;
  entryDate: string;
  journalNumber: string;
  description: string;
  sourceType: string;
  debitCents: bigint;
  creditCents: bigint;
  party: string | null;
}

export interface PartyLineInput {
  side: 'RECEIVABLE' | 'PAYABLE';
  partyId: number | null;
  partyName: string;
  reference: string | null;
  entryDate: string;
  debitCents: bigint;
  creditCents: bigint;
}

export interface BankAccountInput {
  id: number;
  name: string;
  kind: 'BANK' | 'CASH_ON_HAND';
  bankName: string | null;
  accountNumberMasked: string | null;
  glAccountId: number;
  storedBookBalanceCents: bigint;
  lastReconciledAt: string | null;
  imports: Array<{ id: number; statementDate: string | null; status: string; lineCount: number }>;
}

export interface FixedAssetInput {
  assetCode: string;
  assetName: string;
  category: string;
  acquisitionDate: string;
  status: string;
  costCents: bigint;
  accumulatedCents: bigint;
  netBookValueCents: bigint;
}

export interface PartnerEquityInput {
  available: boolean;
  statementId: number | null;
  status: string | null;
  periodLabel: string | null;
  partners: Array<{ name: string; closingCents: bigint | null }>;
  reason: string | null;
}

export interface PriorApprovedInput {
  version: number;
  periodEnd: string;
  assetsCents: bigint;
  liabilitiesCents: bigint;
  equityCents: bigint;
}

export interface BuildStatementInput {
  meta: StatementMeta;
  accounts: readonly LedgerAccountInput[];
  /** Totals from every posted journal, including year-end close journals. */
  movements: readonly AccountMovement[];
  /** Totals excluding year-end close journals; used for trading results and cash flow. */
  tradingMovements: readonly AccountMovement[];
  overrides: ReadonlyMap<number, string>;
  journalLines: readonly LedgerLineInput[];
  partyLines: readonly PartyLineInput[];
  bankAccounts: readonly BankAccountInput[];
  fixedAssets: readonly FixedAssetInput[];
  depreciation: {
    /** Total of posted depreciation batches whose entry date falls in the period. */
    batchChargeCents: bigint;
    batchesPosted: number;
    /** Per-asset charge from those batches, keyed by asset code. */
    byAssetCode: ReadonlyMap<string, bigint>;
  };
  partnerEquity: PartnerEquityInput | null;
  priorApproved: PriorApprovedInput | null;
  notes: readonly ManagementNote[];
}

const ZERO = 0n;

const ASSET_NON_CURRENT: PresentationGroup[] = [
  'NON_CURRENT_PPE',
  'ACCUMULATED_DEPRECIATION',
  'INTANGIBLE',
  'OTHER_NON_CURRENT_ASSET',
];
const ASSET_CURRENT: PresentationGroup[] = [
  'INVENTORY',
  'RECEIVABLE',
  'PREPAYMENT',
  'CASH_AT_BANK',
  'CASH_ON_HAND',
];
const EQUITY_ORDER: PresentationGroup[] = ['PARTNERS_CAPITAL', 'RETAINED_EARNINGS', 'OTHER_EQUITY'];
const LIABILITY_NON_CURRENT: PresentationGroup[] = ['NON_CURRENT_LIABILITY'];
const LIABILITY_CURRENT: PresentationGroup[] = [
  'PAYABLES',
  'STATUTORY_LIABILITY',
  'OTHER_CURRENT_LIABILITY',
];
const REVENUE_ORDER: PresentationGroup[] = ['REVENUE', 'OTHER_INCOME'];
const EXPENSE_ORDER: PresentationGroup[] = [
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'DEPRECIATION_EXPENSE',
  'FINANCE_COST',
  'TAX_EXPENSE',
];

/** Which side of the balance sheet each presentation group belongs to. */
export const GROUP_TYPE: Record<
  PresentationGroup,
  'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | null
> = {
  NON_CURRENT_PPE: 'ASSET',
  ACCUMULATED_DEPRECIATION: 'ASSET',
  INTANGIBLE: 'ASSET',
  OTHER_NON_CURRENT_ASSET: 'ASSET',
  INVENTORY: 'ASSET',
  RECEIVABLE: 'ASSET',
  PREPAYMENT: 'ASSET',
  CASH_AT_BANK: 'ASSET',
  CASH_ON_HAND: 'ASSET',
  PARTNERS_CAPITAL: 'EQUITY',
  RETAINED_EARNINGS: 'EQUITY',
  OTHER_EQUITY: 'EQUITY',
  NON_CURRENT_LIABILITY: 'LIABILITY',
  PAYABLES: 'LIABILITY',
  STATUTORY_LIABILITY: 'LIABILITY',
  OTHER_CURRENT_LIABILITY: 'LIABILITY',
  REVENUE: 'REVENUE',
  OTHER_INCOME: 'REVENUE',
  COST_OF_SALES: 'EXPENSE',
  OPERATING_EXPENSE: 'EXPENSE',
  DEPRECIATION_EXPENSE: 'EXPENSE',
  FINANCE_COST: 'EXPENSE',
  TAX_EXPENSE: 'EXPENSE',
  UNCLASSIFIED: null,
};

type CashFlowActivity = 'OPERATING' | 'INVESTING' | 'FINANCING';

const CASH_FLOW_ACTIVITY: Partial<Record<PresentationGroup, CashFlowActivity>> = {
  ACCUMULATED_DEPRECIATION: 'OPERATING',
  INVENTORY: 'OPERATING',
  RECEIVABLE: 'OPERATING',
  PREPAYMENT: 'OPERATING',
  PAYABLES: 'OPERATING',
  STATUTORY_LIABILITY: 'OPERATING',
  OTHER_CURRENT_LIABILITY: 'OPERATING',
  NON_CURRENT_PPE: 'INVESTING',
  INTANGIBLE: 'INVESTING',
  OTHER_NON_CURRENT_ASSET: 'INVESTING',
  PARTNERS_CAPITAL: 'FINANCING',
  RETAINED_EARNINGS: 'FINANCING',
  OTHER_EQUITY: 'FINANCING',
  NON_CURRENT_LIABILITY: 'FINANCING',
};

const CASH_FLOW_LABEL: Partial<Record<PresentationGroup, string>> = {
  ACCUMULATED_DEPRECIATION: 'Depreciation, amortisation and disposals (non-cash)',
  INVENTORY: 'Change in inventories',
  RECEIVABLE: 'Change in trade and other receivables',
  PREPAYMENT: 'Change in prepayments',
  PAYABLES: 'Change in trade and other payables',
  STATUTORY_LIABILITY: 'Change in statutory liabilities',
  OTHER_CURRENT_LIABILITY: 'Change in other current liabilities',
  NON_CURRENT_PPE: 'Additions to property, plant and equipment, net of disposals at cost',
  INTANGIBLE: 'Additions to intangible assets',
  OTHER_NON_CURRENT_ASSET: 'Movement in other non-current assets',
  PARTNERS_CAPITAL: "Partners' capital introduced and withdrawn",
  RETAINED_EARNINGS: 'Transfers to and from retained earnings',
  OTHER_EQUITY: 'Movement in other equity',
  NON_CURRENT_LIABILITY: 'Non-current borrowings raised and repaid',
};

const CASH_GROUPS: PresentationGroup[] = ['CASH_AT_BANK', 'CASH_ON_HAND'];
const RESULT_GROUPS: PresentationGroup[] = [...REVENUE_ORDER, ...EXPENSE_ORDER];

/** Debit-positive types; everything else is credit-positive. */
function presentationSign(type: string): 1n | -1n {
  return type === 'ASSET' || type === 'EXPENSE' ? 1n : -1n;
}

class LedgerView {
  private readonly byAccount = new Map<number, AccountMovement>();
  private readonly tradingByAccount = new Map<number, AccountMovement>();

  constructor(
    readonly accounts: readonly LedgerAccountInput[],
    movements: readonly AccountMovement[],
    tradingMovements: readonly AccountMovement[],
    readonly classified: ReadonlyMap<number, AccountClassification>,
    readonly hasComparative: boolean,
  ) {
    for (const movement of movements) this.byAccount.set(movement.accountId, movement);
    for (const movement of tradingMovements)
      this.tradingByAccount.set(movement.accountId, movement);
  }

  movement(accountId: number): AccountMovement {
    return (
      this.byAccount.get(accountId) ?? {
        accountId,
        closingDebitCents: ZERO,
        closingCreditCents: ZERO,
        periodDebitCents: ZERO,
        periodCreditCents: ZERO,
        priorDebitCents: ZERO,
        priorCreditCents: ZERO,
        comparativeDebitCents: ZERO,
        comparativeCreditCents: ZERO,
      }
    );
  }

  /**
   * Movements excluding year-end closing journals. An account touched only by
   * a closing journal has no trading movement — falling back to its full
   * movement would count the transfer twice.
   */
  tradingMovement(accountId: number): AccountMovement {
    return (
      this.tradingByAccount.get(accountId) ?? {
        accountId,
        closingDebitCents: ZERO,
        closingCreditCents: ZERO,
        periodDebitCents: ZERO,
        periodCreditCents: ZERO,
        priorDebitCents: ZERO,
        priorCreditCents: ZERO,
        comparativeDebitCents: ZERO,
        comparativeCreditCents: ZERO,
      }
    );
  }

  /** Signed balance: positive is a net debit. */
  net(accountId: number, mode: 'closing' | 'prior' | 'opening' | 'priorOpening'): bigint {
    const m = this.movement(accountId);
    const closing = m.closingDebitCents - m.closingCreditCents;
    const period = m.periodDebitCents - m.periodCreditCents;
    if (mode === 'closing') return closing;
    if (mode === 'opening') return closing - period;
    const prior = m.priorDebitCents - m.priorCreditCents;
    if (mode === 'prior') return prior;
    return prior - (m.comparativeDebitCents - m.comparativeCreditCents);
  }

  /** Signed movement excluding year-end closing journals. */
  tradingNet(accountId: number, mode: 'current' | 'comparative'): bigint {
    const m = this.tradingMovement(accountId);
    return mode === 'current'
      ? m.periodDebitCents - m.periodCreditCents
      : m.comparativeDebitCents - m.comparativeCreditCents;
  }

  /** Movement contributed by year-end closing journals alone. */
  closeJournalNet(accountId: number, mode: 'current' | 'comparative' = 'current'): bigint {
    const all = this.movement(accountId);
    const trading = this.tradingMovement(accountId);
    return mode === 'current'
      ? all.periodDebitCents -
          all.periodCreditCents -
          (trading.periodDebitCents - trading.periodCreditCents)
      : all.comparativeDebitCents -
          all.comparativeCreditCents -
          (trading.comparativeDebitCents - trading.comparativeCreditCents);
  }

  accountsOfType(type: string): LedgerAccountInput[] {
    return this.accounts.filter((account) => account.type === type);
  }

  accountsInGroup(group: PresentationGroup): LedgerAccountInput[] {
    return this.accounts
      .filter((account) => this.classified.get(account.id)?.group === group)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  groupNet(
    group: PresentationGroup,
    mode: 'closing' | 'prior' | 'opening' | 'priorOpening',
  ): bigint {
    return sumCents(this.accountsInGroup(group).map((account) => this.net(account.id, mode)));
  }

  groupTrading(group: PresentationGroup, mode: 'current' | 'comparative'): bigint {
    return sumCents(
      this.accountsInGroup(group).map((account) => this.tradingNet(account.id, mode)),
    );
  }

  typeNet(type: string, mode: 'closing' | 'prior' | 'opening' | 'priorOpening'): bigint {
    return sumCents(this.accountsOfType(type).map((account) => this.net(account.id, mode)));
  }

  typeTrading(type: string, mode: 'current' | 'comparative'): bigint {
    return sumCents(this.accountsOfType(type).map((account) => this.tradingNet(account.id, mode)));
  }

  cashNet(mode: 'closing' | 'prior' | 'opening' | 'priorOpening'): bigint {
    return sumCents(CASH_GROUPS.map((group) => this.groupNet(group, mode)));
  }

  /** Signed movement of the cash accounts. */
  cashMovement(mode: 'current' | 'comparative'): bigint {
    return sumCents(
      CASH_GROUPS.flatMap((group) =>
        this.accountsInGroup(group).map((account) => this.tradingNet(account.id, mode)),
      ),
    );
  }

  /** Accounts of a type that no presentation group has claimed. */
  unclassifiedAccounts(type: string): LedgerAccountInput[] {
    return this.accountsOfType(type).filter(
      (account) => this.classified.get(account.id)?.group === 'UNCLASSIFIED',
    );
  }
}

function row(
  key: string,
  label: string,
  current: bigint,
  prior: bigint | null,
  options: {
    kind?: StatementRow['kind'];
    depth?: number;
    note?: string | null;
    accountCodes?: string[];
  } = {},
): StatementRow {
  return {
    key,
    label,
    note: options.note ?? null,
    kind: options.kind ?? 'LINE',
    depth: options.depth ?? 1,
    currentCents: centsString(current),
    priorCents: prior === null ? null : centsString(prior),
    ...(options.accountCodes?.length ? { accountCodes: options.accountCodes } : {}),
  };
}

function totalRow(
  key: string,
  label: string,
  current: bigint,
  prior: bigint | null,
  kind: StatementRow['kind'] = 'TOTAL',
): StatementRow {
  return row(key, label, current, prior, { kind, depth: 0 });
}

function sectionRow(key: string, label: string, note: string | null = null): StatementRow {
  return {
    key,
    label,
    note,
    kind: 'SECTION',
    depth: 0,
    currentCents: centsString(ZERO),
    priorCents: null,
  };
}

interface SectionResult {
  rows: StatementRow[];
  current: bigint;
  prior: bigint | null;
}

/**
 * Lines for one side of the statement. `mode` selects closing balances or the
 * period's trading movement. Anything unclassified is added as its own row so
 * the section total always equals the account-type total.
 */
function buildSection(
  view: LedgerView,
  type: string,
  groups: readonly PresentationGroup[],
  mode: 'closing' | 'trading',
  includeAccountDetail: boolean,
  claim: Set<number>,
  includeResidual: boolean,
): SectionResult {
  const sign = presentationSign(type);
  const rows: StatementRow[] = [];
  let current = ZERO;
  let prior: bigint | null = view.hasComparative ? ZERO : null;

  for (const group of groups) {
    const accounts = view.accountsInGroup(group);
    if (!accounts.length) continue;
    for (const account of accounts) claim.add(account.id);

    let groupCurrent = ZERO;
    let groupPrior = view.hasComparative ? ZERO : null;
    for (const account of accounts) {
      const accountCurrent =
        (mode === 'closing'
          ? view.net(account.id, 'closing')
          : view.tradingNet(account.id, 'current')) * sign;
      const accountPrior = view.hasComparative
        ? (mode === 'closing'
            ? view.net(account.id, 'prior')
            : view.tradingNet(account.id, 'comparative')) * sign
        : null;
      groupCurrent += accountCurrent;
      if (groupPrior !== null && accountPrior !== null) groupPrior += accountPrior;
      if (includeAccountDetail && (accountCurrent !== ZERO || (accountPrior ?? ZERO) !== ZERO)) {
        rows.push(
          row(
            `${group}:${account.code}`,
            `${account.code} ${account.name}`,
            accountCurrent,
            accountPrior,
            {
              depth: 2,
              accountCodes: [account.code],
            },
          ),
        );
      }
    }
    if (groupCurrent === ZERO && (groupPrior === null || groupPrior === ZERO)) continue;
    rows.push(
      row(
        mode === 'closing' ? group : `${group}_MOVEMENT`,
        GROUP_LABELS[group],
        groupCurrent,
        groupPrior,
        {
          depth: 1,
          note: GROUP_NOTES[group],
          accountCodes: accounts.map((account) => account.code),
        },
      ),
    );
    current += groupCurrent;
    if (prior !== null && groupPrior !== null) prior += groupPrior;
  }

  if (includeResidual) {
    const residual = buildResidual(view, type, mode, claim);
    if (residual.row) {
      rows.push(residual.row);
      current += residual.current;
      if (prior !== null && residual.prior !== null) prior += residual.prior;
    }
  }

  return { rows, current, prior };
}

/**
 * Accounts of one type that no presentation group has claimed. They are shown
 * as a named row so the section total still equals the type total — which is
 * what keeps the balance sheet balanced when a subtype is unfamiliar.
 */
function buildResidual(
  view: LedgerView,
  type: string,
  mode: 'closing' | 'trading',
  claim: ReadonlySet<number>,
): { row: StatementRow | null; current: bigint; prior: bigint | null } {
  const sign = presentationSign(type);
  const accounts = view.accountsOfType(type).filter((account) => !claim.has(account.id));
  if (!accounts.length) return { row: null, current: ZERO, prior: null };
  let current = ZERO;
  let prior: bigint | null = view.hasComparative ? ZERO : null;
  for (const account of accounts) {
    current +=
      (mode === 'closing'
        ? view.net(account.id, 'closing')
        : view.tradingNet(account.id, 'current')) * sign;
    if (prior !== null) {
      prior +=
        (mode === 'closing'
          ? view.net(account.id, 'prior')
          : view.tradingNet(account.id, 'comparative')) * sign;
    }
  }
  if (current === ZERO && (prior === null || prior === ZERO)) {
    return { row: null, current: ZERO, prior };
  }
  return {
    row: row(
      `UNCLASSIFIED_${type}`,
      `Unclassified ${type.toLowerCase()} accounts`,
      current,
      prior,
      {
        depth: 1,
        note: GROUP_NOTES.UNCLASSIFIED,
        accountCodes: accounts.map((account) => account.code),
      },
    ),
    current,
    prior,
  };
}

/** Movement contributed by year-end closing journals across the result accounts. */
function sumSents(view: LedgerView, mode: 'current' | 'comparative'): bigint {
  return sumCents(
    view
      .accountsOfType('REVENUE')
      .concat(view.accountsOfType('EXPENSE'))
      .map((account) => view.closeJournalNet(account.id, mode)),
  );
}

interface FinancialPositionResult {
  block: BalanceSheetBlock;
  assetsCurrent: bigint;
  assetsPrior: bigint | null;
  equityCurrent: bigint;
  equityPrior: bigint | null;
  liabilitiesCurrent: bigint;
  liabilitiesPrior: bigint | null;
  differenceCurrent: bigint;
  differencePrior: bigint | null;
  accumulatedClosing: bigint;
  accumulatedOpening: bigint;
  accumulatedPrior: bigint;
  accumulatedPriorOpening: bigint;
  resultCurrent: bigint;
  resultPrior: bigint | null;
  transferCurrent: bigint;
  transferPrior: bigint;
}

function buildFinancialPosition(view: LedgerView, meta: StatementMeta): FinancialPositionResult {
  const hasPrior = view.hasComparative;

  const assetClaim = new Set<number>();
  const nonCurrent = buildSection(
    view,
    'ASSET',
    ASSET_NON_CURRENT,
    'closing',
    true,
    assetClaim,
    false,
  );
  const currentAssets = buildSection(
    view,
    'ASSET',
    ASSET_CURRENT,
    'closing',
    true,
    assetClaim,
    true,
  );
  const assetsCurrent = nonCurrent.current + currentAssets.current;
  const assetsPrior =
    nonCurrent.prior !== null && currentAssets.prior !== null
      ? nonCurrent.prior + currentAssets.prior
      : null;

  const equitySection = buildSection(
    view,
    'EQUITY',
    EQUITY_ORDER,
    'closing',
    true,
    new Set<number>(),
    true,
  );

  /**
   * Whatever the revenue and expense accounts still hold at the reporting
   * date. After a year-end close these accounts are empty and the balance sits
   * in retained earnings; before one, the period result is still here. Both
   * cases are shown, and the transfer row explains the difference between them.
   */
  const accumulatedClosing =
    -view.typeNet('REVENUE', 'closing') - view.typeNet('EXPENSE', 'closing');
  const accumulatedOpening =
    -view.typeNet('REVENUE', 'opening') - view.typeNet('EXPENSE', 'opening');
  const accumulatedPrior = -view.typeNet('REVENUE', 'prior') - view.typeNet('EXPENSE', 'prior');
  const resultCurrent =
    -view.typeTrading('REVENUE', 'current') - view.typeTrading('EXPENSE', 'current');
  const resultPrior = hasPrior
    ? -view.typeTrading('REVENUE', 'comparative') - view.typeTrading('EXPENSE', 'comparative')
    : null;
  const transferCurrent = sumSents(view, 'current');
  const transferPrior = hasPrior ? sumSents(view, 'comparative') : ZERO;
  const accumulatedPriorOpening =
    -view.typeNet('REVENUE', 'priorOpening') - view.typeNet('EXPENSE', 'priorOpening');
  const earlierCurrent = accumulatedOpening;
  const earlierPrior = hasPrior ? accumulatedPriorOpening : null;

  const equityTotalCurrent = equitySection.current + accumulatedClosing;
  const equityTotalPrior =
    hasPrior && equitySection.prior !== null && accumulatedPrior !== null
      ? equitySection.prior + accumulatedPrior
      : null;

  const liabilityClaim = new Set<number>();
  const nonCurrentLiabilities = buildSection(
    view,
    'LIABILITY',
    LIABILITY_NON_CURRENT,
    'closing',
    true,
    liabilityClaim,
    false,
  );
  const currentLiabilities = buildSection(
    view,
    'LIABILITY',
    LIABILITY_CURRENT,
    'closing',
    true,
    liabilityClaim,
    true,
  );
  const liabilitiesCurrent = nonCurrentLiabilities.current + currentLiabilities.current;
  const liabilitiesPrior =
    nonCurrentLiabilities.prior !== null && currentLiabilities.prior !== null
      ? nonCurrentLiabilities.prior + currentLiabilities.prior
      : null;

  const differenceCurrent = assetsCurrent - equityTotalCurrent - liabilitiesCurrent;
  const differencePrior =
    assetsPrior !== null && equityTotalPrior !== null && liabilitiesPrior !== null
      ? assetsPrior - equityTotalPrior - liabilitiesPrior
      : null;

  const openingAssets = view.typeNet('ASSET', 'opening');
  const openingLiabilities = -view.typeNet('LIABILITY', 'opening');
  const openingEquity =
    -view.typeNet('EQUITY', 'opening') -
    view.typeNet('REVENUE', 'opening') -
    view.typeNet('EXPENSE', 'opening');

  const equityResultRows: StatementRow[] = [
    sectionRow('ACCUMULATED_RESULTS', 'Accumulated results'),
    row('RESULT_FOR_PERIOD', 'Result for the period', resultCurrent, resultPrior, {
      depth: 1,
      note: GROUP_NOTES.REVENUE,
    }),
  ];
  if (transferCurrent !== ZERO) {
    equityResultRows.push(
      row(
        'RESULT_TRANSFER',
        'Transferred to equity accounts by a year-end close',
        -transferCurrent,
        hasPrior && transferPrior !== ZERO ? -transferPrior : null,
        { depth: 1 },
      ),
    );
  }
  equityResultRows.push(
    row(
      'RESULT_BROUGHT_FORWARD',
      'Results of earlier periods not yet closed',
      earlierCurrent,
      earlierPrior,
      {
        depth: 1,
      },
    ),
  );
  equityResultRows.push(
    totalRow(
      'ACCUMULATED_RESULTS_TOTAL',
      'Total accumulated results',
      accumulatedClosing,
      hasPrior ? accumulatedPrior : null,
      'SUBTOTAL',
    ),
  );

  const rows: StatementRow[] = [
    sectionRow('NON_CURRENT_ASSETS', 'Non-current assets'),
    ...nonCurrent.rows,
    totalRow(
      'NON_CURRENT_ASSETS_TOTAL',
      'Total non-current assets',
      nonCurrent.current,
      nonCurrent.prior,
      'SUBTOTAL',
    ),
    sectionRow('CURRENT_ASSETS', 'Current assets'),
    ...currentAssets.rows,
    totalRow(
      'CURRENT_ASSETS_TOTAL',
      'Total current assets',
      currentAssets.current,
      currentAssets.prior,
      'SUBTOTAL',
    ),
    totalRow('TOTAL_ASSETS', 'TOTAL ASSETS', assetsCurrent, assetsPrior),
    sectionRow('EQUITY', "Partners' equity"),
    ...equitySection.rows,
    ...equityResultRows,
    totalRow('TOTAL_EQUITY', 'TOTAL EQUITY', equityTotalCurrent, equityTotalPrior),
    sectionRow('NON_CURRENT_LIABILITIES', 'Non-current liabilities'),
    ...nonCurrentLiabilities.rows,
    totalRow(
      'NON_CURRENT_LIABILITIES_TOTAL',
      'Total non-current liabilities',
      nonCurrentLiabilities.current,
      nonCurrentLiabilities.prior,
      'SUBTOTAL',
    ),
    sectionRow('CURRENT_LIABILITIES', 'Current liabilities'),
    ...currentLiabilities.rows,
    totalRow(
      'CURRENT_LIABILITIES_TOTAL',
      'Total current liabilities',
      currentLiabilities.current,
      currentLiabilities.prior,
      'SUBTOTAL',
    ),
    totalRow('TOTAL_LIABILITIES', 'TOTAL LIABILITIES', liabilitiesCurrent, liabilitiesPrior),
    totalRow(
      'TOTAL_EQUITY_AND_LIABILITIES',
      'TOTAL EQUITY AND LIABILITIES',
      equityTotalCurrent + liabilitiesCurrent,
      equityTotalPrior !== null && liabilitiesPrior !== null
        ? equityTotalPrior + liabilitiesPrior
        : null,
    ),
  ];

  const block: BalanceSheetBlock = {
    key: 'financialPosition',
    title: 'Statement of Financial Position',
    subtitle: `As at ${meta.periodEnd}`,
    columns: {
      current: `As at ${meta.periodEnd}`,
      prior: meta.comparativeEnd ? `As at ${meta.comparativeEnd}` : null,
    },
    rows,
    currency: meta.currency,
    asAt: meta.periodEnd,
    comparativeAsAt: meta.comparativeEnd,
    totals: {
      assetsCents: centsString(assetsCurrent),
      equityCents: centsString(equityTotalCurrent),
      liabilitiesCents: centsString(liabilitiesCurrent),
      equityAndLiabilitiesCents: centsString(equityTotalCurrent + liabilitiesCurrent),
      priorAssetsCents: assetsPrior === null ? null : centsString(assetsPrior),
      priorEquityCents: equityTotalPrior === null ? null : centsString(equityTotalPrior),
      priorLiabilitiesCents: liabilitiesPrior === null ? null : centsString(liabilitiesPrior),
      priorEquityAndLiabilitiesCents:
        equityTotalPrior === null || liabilitiesPrior === null
          ? null
          : centsString(equityTotalPrior + liabilitiesPrior),
    },
    opening: {
      assetsCents: centsString(openingAssets),
      equityCents: centsString(openingEquity),
      liabilitiesCents: centsString(openingLiabilities),
      balanced: openingAssets - openingEquity - openingLiabilities === ZERO,
    },
    balanced: {
      current: differenceCurrent === ZERO,
      prior: hasPrior ? differencePrior === ZERO : null,
    },
    difference: {
      currentCents: centsString(differenceCurrent),
      priorCents: differencePrior === null ? null : centsString(differencePrior),
    },
  };

  return {
    block,
    assetsCurrent,
    assetsPrior,
    equityCurrent: equityTotalCurrent,
    equityPrior: equityTotalPrior,
    liabilitiesCurrent,
    liabilitiesPrior,
    differenceCurrent,
    differencePrior,
    accumulatedClosing,
    accumulatedOpening,
    accumulatedPrior,
    accumulatedPriorOpening,
    resultCurrent,
    resultPrior,
    transferCurrent,
    transferPrior,
  };
}

function buildIncomeStatement(view: LedgerView, meta: StatementMeta): IncomeStatementBlock {
  const hasPrior = view.hasComparative;
  const revenue = buildSection(
    view,
    'REVENUE',
    REVENUE_ORDER,
    'trading',
    true,
    new Set<number>(),
    true,
  );
  const expenseClaim = new Set<number>();
  const costOfSales = buildSection(
    view,
    'EXPENSE',
    ['COST_OF_SALES'],
    'trading',
    true,
    expenseClaim,
    false,
  );
  const operating = buildSection(
    view,
    'EXPENSE',
    ['OPERATING_EXPENSE'],
    'trading',
    true,
    expenseClaim,
    false,
  );
  const depreciation = buildSection(
    view,
    'EXPENSE',
    ['DEPRECIATION_EXPENSE'],
    'trading',
    true,
    expenseClaim,
    false,
  );
  const finance = buildSection(
    view,
    'EXPENSE',
    ['FINANCE_COST'],
    'trading',
    true,
    expenseClaim,
    false,
  );
  const tax = buildSection(view, 'EXPENSE', ['TAX_EXPENSE'], 'trading', true, expenseClaim, false);

  // Unclassified expenses are shown once, inside operating expenses, and the
  // operating subtotal is adjusted so the net result still equals the ledger.
  const expenseResidual = buildResidual(view, 'EXPENSE', 'trading', expenseClaim);
  if (expenseResidual.row) {
    operating.rows.push(expenseResidual.row);
    operating.current += expenseResidual.current;
    if (operating.prior !== null && expenseResidual.prior !== null)
      operating.prior += expenseResidual.prior;
  }

  const subtract = (a: bigint | null, b: bigint | null): bigint | null =>
    a === null || b === null ? null : a - b;
  const add = (a: bigint | null, b: bigint | null): bigint | null =>
    a === null || b === null ? null : a + b;

  const totalIncome = revenue.current;
  const grossProfit = totalIncome - costOfSales.current;
  const operatingExpenses = operating.current + depreciation.current;
  const operatingProfit = grossProfit - operatingExpenses;
  const profitBeforeTax = operatingProfit - finance.current;
  const netResult = profitBeforeTax - tax.current;

  const totalIncomePrior = revenue.prior;
  const grossProfitPrior = subtract(totalIncomePrior, costOfSales.prior);
  const operatingExpensesPrior = add(operating.prior, depreciation.prior);
  const operatingProfitPrior = subtract(grossProfitPrior, operatingExpensesPrior);
  const profitBeforeTaxPrior = subtract(operatingProfitPrior, finance.prior);
  const netResultPrior = subtract(profitBeforeTaxPrior, tax.prior);

  const rows: StatementRow[] = [
    sectionRow('REVENUE', 'Revenue'),
    ...revenue.rows,
    totalRow('TOTAL_INCOME', 'Total income', totalIncome, totalIncomePrior, 'SUBTOTAL'),
    ...(costOfSales.rows.length
      ? [
          sectionRow('COST_OF_SALES', 'Cost of sales'),
          ...costOfSales.rows,
          totalRow(
            'COST_OF_SALES_TOTAL',
            'Total cost of sales',
            costOfSales.current,
            costOfSales.prior,
            'SUBTOTAL',
          ),
        ]
      : []),
    totalRow('GROSS_PROFIT', 'Gross profit', grossProfit, grossProfitPrior, 'SUBTOTAL'),
    sectionRow('OPERATING_EXPENSES', 'Operating expenses'),
    ...operating.rows,
    ...depreciation.rows,
    totalRow(
      'OPERATING_EXPENSES_TOTAL',
      'Total operating expenses',
      operatingExpenses,
      operatingExpensesPrior,
      'SUBTOTAL',
    ),
    totalRow(
      'OPERATING_PROFIT',
      'Operating profit',
      operatingProfit,
      operatingProfitPrior,
      'SUBTOTAL',
    ),
    ...(finance.rows.length
      ? [
          sectionRow('FINANCE_COSTS', 'Finance costs'),
          ...finance.rows,
          totalRow(
            'FINANCE_COSTS_TOTAL',
            'Total finance costs',
            finance.current,
            finance.prior,
            'SUBTOTAL',
          ),
        ]
      : []),
    totalRow(
      'PROFIT_BEFORE_TAX',
      'Profit before tax',
      profitBeforeTax,
      profitBeforeTaxPrior,
      'SUBTOTAL',
    ),
    ...(tax.rows.length
      ? [
          sectionRow('TAX', 'Tax'),
          ...tax.rows,
          totalRow('TAX_TOTAL', 'Total tax expense', tax.current, tax.prior, 'SUBTOTAL'),
        ]
      : []),
    totalRow('NET_RESULT', 'NET RESULT FOR THE PERIOD', netResult, netResultPrior),
  ];

  return {
    key: 'incomeStatement',
    title: 'Income Statement',
    subtitle: `${meta.periodStart} to ${meta.periodEnd}`,
    columns: {
      current: `${meta.periodStart} to ${meta.periodEnd}`,
      prior:
        meta.comparativeStart && meta.comparativeEnd
          ? `${meta.comparativeStart} to ${meta.comparativeEnd}`
          : null,
    },
    rows,
    currency: meta.currency,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    comparativeStart: meta.comparativeStart,
    comparativeEnd: meta.comparativeEnd,
    totals: {
      revenueCents: centsString(-view.groupTrading('REVENUE', 'current')),
      otherIncomeCents: centsString(-view.groupTrading('OTHER_INCOME', 'current')),
      totalIncomeCents: centsString(totalIncome),
      costOfSalesCents: centsString(costOfSales.current),
      grossProfitCents: centsString(grossProfit),
      operatingExpensesCents: centsString(operatingExpenses),
      depreciationCents: centsString(depreciation.current),
      financeCostsCents: centsString(finance.current),
      profitBeforeTaxCents: centsString(profitBeforeTax),
      taxExpenseCents: centsString(tax.current),
      netResultCents: centsString(netResult),
      priorNetResultCents: netResultPrior === null ? null : centsString(netResultPrior),
    },
  };
}

interface CashFlowLine {
  key: string;
  label: string;
  current: bigint;
  prior: bigint | null;
  note: string | null;
}

function buildCashFlow(
  view: LedgerView,
  meta: StatementMeta,
  netResult: bigint,
  netResultPrior: bigint | null,
): CashFlowBlock {
  const hasPrior = view.hasComparative;
  const operating: CashFlowLine[] = [];
  const investing: CashFlowLine[] = [];
  const financing: CashFlowLine[] = [];

  for (const group of [
    ...ASSET_CURRENT,
    ...ASSET_NON_CURRENT,
    ...LIABILITY_NON_CURRENT,
    ...LIABILITY_CURRENT,
    ...EQUITY_ORDER,
  ]) {
    if (CASH_GROUPS.includes(group)) continue;
    const activity = CASH_FLOW_ACTIVITY[group];
    if (!activity) continue;
    const current = -view.groupTrading(group, 'current');
    const prior = hasPrior ? -view.groupTrading(group, 'comparative') : null;
    if (current === ZERO && (prior === null || prior === ZERO)) continue;
    (activity === 'OPERATING' ? operating : activity === 'INVESTING' ? investing : financing).push({
      key: group,
      label: CASH_FLOW_LABEL[group] ?? GROUP_LABELS[group],
      current,
      prior,
      note: GROUP_NOTES[group],
    });
  }

  /**
   * Accounts without a presentation group still moved. Their movement is shown
   * as a named line so the reconciliation remains complete and the difference
   * stays visible; it is never folded into another activity.
   */
  const residualCurrent: bigint[] = [];
  const residualPrior: bigint[] = [];
  for (const type of ['ASSET', 'LIABILITY', 'EQUITY'] as const) {
    const claimed = new Set<number>();
    // Cash accounts are not a cash-flow line: their movement *is* the change
    // the statement explains. Anything else must be accounted for.
    for (const group of [
      ...(Object.keys(CASH_FLOW_ACTIVITY) as PresentationGroup[]),
      ...CASH_GROUPS,
    ]) {
      if (GROUP_TYPE[group] !== type) continue;
      for (const account of view.accountsInGroup(group)) claimed.add(account.id);
    }
    for (const account of view.accountsOfType(type)) {
      if (claimed.has(account.id)) continue;
      residualCurrent.push(-view.tradingNet(account.id, 'current'));
      if (hasPrior) residualPrior.push(-view.tradingNet(account.id, 'comparative'));
    }
  }
  if (residualCurrent.some((value) => value !== ZERO)) {
    operating.push({
      key: 'UNCLASSIFIED_MOVEMENTS',
      label: 'Movement in unclassified accounts',
      current: sumCents(residualCurrent),
      prior: hasPrior ? sumCents(residualPrior) : null,
      note: GROUP_NOTES.UNCLASSIFIED,
    });
  }

  const operatingTotal = netResult + sumCents(operating.map((line) => line.current));
  const investingTotal = sumCents(investing.map((line) => line.current));
  const financingTotal = sumCents(financing.map((line) => line.current));
  const netIncrease = operatingTotal + investingTotal + financingTotal;

  const operatingPrior =
    netResultPrior === null
      ? null
      : netResultPrior + sumCents(operating.map((line) => line.prior ?? ZERO));
  const investingPrior = hasPrior ? sumCents(investing.map((line) => line.prior ?? ZERO)) : null;
  const financingPrior = hasPrior ? sumCents(financing.map((line) => line.prior ?? ZERO)) : null;
  const netIncreasePrior =
    operatingPrior === null || investingPrior === null || financingPrior === null
      ? null
      : operatingPrior + investingPrior + financingPrior;

  const openingCash = view.cashNet('opening');
  const closingCash = view.cashNet('closing');
  const priorOpeningCash = view.cashNet('priorOpening');
  const priorClosingCash = view.cashNet('prior');
  const priorEndCash =
    hasPrior && priorOpeningCash !== null && netIncreasePrior !== null
      ? priorOpeningCash + netIncreasePrior
      : null;

  const rows: StatementRow[] = [
    row('PROFIT_FOR_PERIOD', 'Net result for the period', netResult, netResultPrior, {
      note: GROUP_NOTES.REVENUE,
    }),
    sectionRow('OPERATING_ADJUSTMENTS', 'Adjustments for non-cash and working-capital movements'),
    ...operating.map((line) =>
      row(line.key, line.label, line.current, line.prior, { depth: 2, note: line.note }),
    ),
    totalRow(
      'NET_CASH_OPERATING',
      'Net cash generated from operating activities',
      operatingTotal,
      operatingPrior,
      'SUBTOTAL',
    ),
    sectionRow('INVESTING', 'Investing activities'),
    ...investing.map((line) =>
      row(line.key, line.label, line.current, line.prior, { depth: 2, note: line.note }),
    ),
    totalRow(
      'NET_CASH_INVESTING',
      'Net cash used in investing activities',
      investingTotal,
      investingPrior,
      'SUBTOTAL',
    ),
    sectionRow('FINANCING', 'Financing activities'),
    ...financing.map((line) =>
      row(line.key, line.label, line.current, line.prior, { depth: 2, note: line.note }),
    ),
    totalRow(
      'NET_CASH_FINANCING',
      'Net cash from financing activities',
      financingTotal,
      financingPrior,
      'SUBTOTAL',
    ),
    totalRow(
      'NET_INCREASE_CASH',
      'NET INCREASE / (DECREASE) IN CASH',
      netIncrease,
      netIncreasePrior,
      'SUBTOTAL',
    ),
    row(
      'OPENING_CASH',
      'Cash at the beginning of the period',
      openingCash,
      hasPrior ? priorOpeningCash : null,
      {
        depth: 2,
      },
    ),
    totalRow(
      'CLOSING_CASH',
      'CASH AT THE END OF THE PERIOD',
      openingCash + netIncrease,
      priorEndCash,
    ),
  ];

  const difference = closingCash - (openingCash + netIncrease);
  return {
    key: 'cashFlows',
    title: 'Statement of Cash Flows',
    subtitle: `For the period ${meta.periodStart} to ${meta.periodEnd} (indirect method)`,
    columns: {
      current: `${meta.periodStart} to ${meta.periodEnd}`,
      prior:
        meta.comparativeStart && meta.comparativeEnd
          ? `${meta.comparativeStart} to ${meta.comparativeEnd}`
          : null,
    },
    rows,
    currency: meta.currency,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    totals: {
      operatingCents: centsString(operatingTotal),
      investingCents: centsString(investingTotal),
      financingCents: centsString(financingTotal),
      netIncreaseCents: centsString(netIncrease),
      openingCashCents: centsString(openingCash),
      closingCashCents: centsString(closingCash),
      priorNetIncreaseCents: netIncreasePrior === null ? null : centsString(netIncreasePrior),
      priorClosingCashCents: hasPrior ? centsString(priorClosingCash) : null,
    },
    ties: {
      current: difference === ZERO,
      prior: hasPrior ? priorClosingCash === priorOpeningCash + (netIncreasePrior ?? ZERO) : null,
      differenceCents: centsString(difference),
    },
  };
}

function buildEquityStatement(
  view: LedgerView,
  meta: StatementMeta,
  netResult: bigint,
  netResultPrior: bigint | null,
  accumulated: {
    opening: bigint;
    priorOpening: bigint;
    transferCurrent: bigint;
    transferPrior: bigint;
  },
  partnerEquity: PartnerEquityInput | null,
): EquityStatementBlock {
  const hasPrior = view.hasComparative;
  const rows: EquityMovementRow[] = [];
  const total = {
    opening: ZERO,
    introduced: ZERO,
    withdrawn: ZERO,
    result: ZERO,
    transfers: ZERO,
    closing: ZERO,
    priorClosing: hasPrior ? ZERO : null,
  };

  const pushRow = (
    key: string,
    label: string,
    note: string | null,
    depth: number,
    kind: EquityMovementRow['kind'],
    values: {
      opening: bigint;
      introduced?: bigint;
      withdrawn?: bigint;
      result?: bigint;
      transfers?: bigint;
      closing: bigint;
      priorClosing?: bigint | null;
    },
  ) => {
    const introduced = values.introduced ?? ZERO;
    const withdrawn = values.withdrawn ?? ZERO;
    const result = values.result ?? ZERO;
    const transfers = values.transfers ?? ZERO;
    rows.push({
      key,
      label,
      note,
      depth,
      kind,
      openingCents: centsString(values.opening),
      introducedCents: centsString(introduced),
      withdrawnCents: centsString(withdrawn),
      resultCents: centsString(result),
      transfersCents: centsString(transfers),
      closingCents: centsString(values.closing),
      priorClosingCents:
        values.priorClosing === null || values.priorClosing === undefined
          ? null
          : centsString(values.priorClosing),
    });
    total.opening += values.opening;
    total.introduced += introduced;
    total.withdrawn += withdrawn;
    total.result += result;
    total.transfers += transfers;
    total.closing += values.closing;
    if (
      total.priorClosing !== null &&
      values.priorClosing !== null &&
      values.priorClosing !== undefined
    ) {
      total.priorClosing += values.priorClosing;
    }
  };

  for (const group of EQUITY_ORDER) {
    const accounts = view.accountsInGroup(group);
    if (!accounts.length) continue;
    for (const account of accounts) {
      const movement = view.movement(account.id);
      const opening = -view.net(account.id, 'opening');
      const closing = -view.net(account.id, 'closing');
      const priorClosing = hasPrior ? -view.net(account.id, 'prior') : null;
      const credits = movement.periodCreditCents;
      const debits = movement.periodDebitCents;

      /*
       * Partners' capital moves by money introduced and drawings. Retained
       * earnings and other equity move by transfers between equity accounts
       * and by a year-end close — calling a transfer "introduced" would
       * describe money that never arrived.
       */
      const isCapital = group === 'PARTNERS_CAPITAL';
      const introduced = isCapital ? credits : ZERO;
      const withdrawn = isCapital ? debits : ZERO;
      const transfers = isCapital ? ZERO : credits - debits;

      if (
        opening === ZERO &&
        introduced === ZERO &&
        withdrawn === ZERO &&
        transfers === ZERO &&
        closing === ZERO &&
        (priorClosing === null || priorClosing === ZERO)
      )
        continue;
      pushRow(
        `EQUITY:${account.code}`,
        `${account.code} ${account.name}`,
        GROUP_NOTES[group],
        1,
        'LINE',
        { opening, introduced, withdrawn, transfers, closing, priorClosing },
      );
    }
  }

  pushRow('RESULT_FOR_PERIOD', 'Result for the period', GROUP_NOTES.REVENUE, 1, 'LINE', {
    opening: ZERO,
    result: netResult,
    closing: netResult,
    priorClosing: netResultPrior,
  });

  if (accumulated.transferCurrent !== ZERO || accumulated.transferPrior !== ZERO) {
    pushRow('RESULT_TRANSFER', 'Transferred to equity by a year-end close', null, 1, 'LINE', {
      opening: ZERO,
      transfers: -accumulated.transferCurrent,
      closing: -accumulated.transferCurrent,
      priorClosing: accumulated.transferPrior === ZERO ? null : -accumulated.transferPrior,
    });
  }

  pushRow('RESULT_BROUGHT_FORWARD', 'Results of earlier periods not yet closed', null, 1, 'LINE', {
    opening: accumulated.opening,
    closing: accumulated.opening,
    priorClosing: accumulated.priorOpening,
  });

  const ledgerPartnersCapital = -view.groupNet('PARTNERS_CAPITAL', 'closing');
  const registerTotal = partnerEquity?.available
    ? sumCents(partnerEquity.partners.map((partner) => partner.closingCents ?? ZERO))
    : null;

  return {
    key: 'changesInEquity',
    title: "Statement of Changes in Partners' Equity",
    subtitle: `For the period ${meta.periodStart} to ${meta.periodEnd}`,
    columns: {
      current: `As at ${meta.periodEnd}`,
      prior: meta.comparativeEnd ? `As at ${meta.comparativeEnd}` : null,
      movements: ['opening', 'introduced', 'withdrawn', 'result', 'transfers', 'closing'],
    },
    rows,
    currency: meta.currency,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    totals: {
      openingCents: centsString(total.opening),
      introducedCents: centsString(total.introduced),
      withdrawnCents: centsString(total.withdrawn),
      resultCents: centsString(total.result),
      transfersCents: centsString(total.transfers),
      closingCents: centsString(total.closing),
      priorClosingCents: total.priorClosing === null ? null : centsString(total.priorClosing),
    },
    partnerRegister: partnerEquity
      ? {
          available: partnerEquity.available,
          statementId: partnerEquity.statementId,
          status: partnerEquity.status,
          periodLabel: partnerEquity.periodLabel,
          closingTotalCents: registerTotal === null ? null : centsString(registerTotal),
          partners: partnerEquity.partners.map((partner) => ({
            name: partner.name,
            closingCents: partner.closingCents === null ? null : centsString(partner.closingCents),
          })),
          ledgerPartnersCapitalCents: centsString(ledgerPartnersCapital),
          differenceCents:
            registerTotal === null ? null : centsString(registerTotal - ledgerPartnersCapital),
          reason: partnerEquity.reason,
        }
      : null,
  };
}

function buildTrialBalance(view: LedgerView, meta: StatementMeta): TrialBalanceBlock {
  const rows: TrialBalanceRow[] = [];
  const totals = {
    openingDebit: ZERO,
    openingCredit: ZERO,
    movementDebit: ZERO,
    movementCredit: ZERO,
    closingDebit: ZERO,
    closingCredit: ZERO,
  };

  for (const account of [...view.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const movement = view.movement(account.id);
    if (
      movement.closingDebitCents === ZERO &&
      movement.closingCreditCents === ZERO &&
      movement.periodDebitCents === ZERO &&
      movement.periodCreditCents === ZERO
    )
      continue;
    const openingDebit = movement.closingDebitCents - movement.periodDebitCents;
    const openingCredit = movement.closingCreditCents - movement.periodCreditCents;
    rows.push({
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      presentationGroup: view.classified.get(account.id)!.group,
      openingDebitCents: centsString(openingDebit),
      openingCreditCents: centsString(openingCredit),
      movementDebitCents: centsString(movement.periodDebitCents),
      movementCreditCents: centsString(movement.periodCreditCents),
      closingDebitCents: centsString(movement.closingDebitCents),
      closingCreditCents: centsString(movement.closingCreditCents),
    });
    totals.openingDebit += openingDebit;
    totals.openingCredit += openingCredit;
    totals.movementDebit += movement.periodDebitCents;
    totals.movementCredit += movement.periodCreditCents;
    totals.closingDebit += movement.closingDebitCents;
    totals.closingCredit += movement.closingCreditCents;
  }

  return {
    asAt: meta.periodEnd,
    periodStart: meta.periodStart,
    rows,
    totals: {
      openingDebitCents: centsString(totals.openingDebit),
      openingCreditCents: centsString(totals.openingCredit),
      movementDebitCents: centsString(totals.movementDebit),
      movementCreditCents: centsString(totals.movementCredit),
      closingDebitCents: centsString(totals.closingDebit),
      closingCreditCents: centsString(totals.closingCredit),
    },
    ties:
      totals.openingDebit === totals.openingCredit &&
      totals.movementDebit === totals.movementCredit &&
      totals.closingDebit === totals.closingCredit,
  };
}

function buildGeneralLedger(
  view: LedgerView,
  meta: StatementMeta,
  lines: readonly LedgerLineInput[],
): GeneralLedgerBlock {
  const byAccount = new Map<number, LedgerLineInput[]>();
  for (const line of lines) {
    const list = byAccount.get(line.accountId);
    if (list) list.push(line);
    else byAccount.set(line.accountId, [line]);
  }

  const accounts: GeneralLedgerAccount[] = [];
  let lineCount = 0;
  for (const account of [...view.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const own = byAccount.get(account.id);
    if (!own?.length) continue;
    const opening = view.net(account.id, 'opening');
    let running = opening;
    const rendered = own
      .slice()
      .sort(
        (a, b) =>
          a.entryDate.localeCompare(b.entryDate) || a.journalNumber.localeCompare(b.journalNumber),
      )
      .map((line) => {
        running += line.debitCents - line.creditCents;
        lineCount += 1;
        return {
          entryDate: line.entryDate,
          journalNumber: line.journalNumber,
          description: line.description,
          sourceType: line.sourceType,
          debitCents: centsString(line.debitCents),
          creditCents: centsString(line.creditCents),
          runningCents: centsString(running),
          party: line.party,
        };
      });
    accounts.push({
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      presentationGroup: view.classified.get(account.id)!.group,
      openingCents: centsString(opening),
      closingCents: centsString(running),
      lines: rendered,
    });
  }

  return { periodStart: meta.periodStart, periodEnd: meta.periodEnd, accounts, lineCount };
}

function buildCashbook(
  view: LedgerView,
  meta: StatementMeta,
  bankAccounts: readonly BankAccountInput[],
  lines: readonly LedgerLineInput[],
): CashbookBlock {
  const byAccount = new Map<number, LedgerLineInput[]>();
  for (const line of lines) {
    const list = byAccount.get(line.accountId);
    if (list) list.push(line);
    else byAccount.set(line.accountId, [line]);
  }
  for (const list of byAccount.values()) {
    list.sort(
      (a, b) =>
        a.entryDate.localeCompare(b.entryDate) || a.journalNumber.localeCompare(b.journalNumber),
    );
  }

  const banksByGl = new Map<number, BankAccountInput>();
  for (const bank of bankAccounts) banksByGl.set(bank.glAccountId, bank);

  const cashAccounts = CASH_GROUPS.flatMap((group) => view.accountsInGroup(group)).sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  const accounts: CashbookAccount[] = cashAccounts.map((account) => {
    const movement = view.movement(account.id);
    const opening = view.net(account.id, 'opening');
    const closing = view.net(account.id, 'closing');
    const bank = banksByGl.get(account.id);
    let running = opening;
    const transactions = (byAccount.get(account.id) ?? []).map((line) => {
      running += line.debitCents - line.creditCents;
      return {
        entryDate: line.entryDate,
        journalNumber: line.journalNumber,
        description: line.description,
        receiptCents: centsString(line.debitCents),
        paymentCents: centsString(line.creditCents),
        balanceCents: centsString(running),
      };
    });
    return {
      key: `CASH:${account.code}`,
      name: bank?.name ?? account.name,
      kind:
        bank?.kind ??
        (view.classified.get(account.id)!.group === 'CASH_ON_HAND' ? 'CASH_ON_HAND' : 'BANK'),
      bankName: bank?.bankName ?? null,
      accountNumberMasked: bank?.accountNumberMasked ?? null,
      glAccountCode: account.code,
      glAccountName: account.name,
      ledgerOpeningCents: centsString(opening),
      receiptsCents: centsString(movement.periodDebitCents),
      paymentsCents: centsString(movement.periodCreditCents),
      ledgerClosingCents: centsString(closing),
      storedBookBalanceCents: bank ? centsString(bank.storedBookBalanceCents) : null,
      differenceCents: bank ? centsString(closing - bank.storedBookBalanceCents) : null,
      lastReconciledAt: bank?.lastReconciledAt ?? null,
      imports: bank?.imports ?? [],
      transactions,
      unmapped: !bank,
    };
  });

  const totals = {
    opening: sumCents(accounts.map((account) => cents(account.ledgerOpeningCents))),
    receipts: sumCents(accounts.map((account) => cents(account.receiptsCents))),
    payments: sumCents(accounts.map((account) => cents(account.paymentsCents))),
    closing: sumCents(accounts.map((account) => cents(account.ledgerClosingCents))),
  };

  return {
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    accounts,
    totals: {
      openingCents: centsString(totals.opening),
      receiptsCents: centsString(totals.receipts),
      paymentsCents: centsString(totals.payments),
      closingCents: centsString(totals.closing),
    },
  };
}

function buildPartyStatement(
  view: LedgerView,
  meta: StatementMeta,
  side: 'RECEIVABLE' | 'PAYABLE',
  lines: readonly PartyLineInput[],
): PartyStatementBlock {
  const controlGroups: PresentationGroup[] = side === 'RECEIVABLE' ? ['RECEIVABLE'] : ['PAYABLES'];
  const controlAccounts = controlGroups.flatMap((group) => view.accountsInGroup(group));
  const sign = side === 'RECEIVABLE' ? 1n : -1n;
  const controlCents =
    sumCents(controlGroups.map((group) => view.groupNet(group, 'closing'))) * sign;

  type Lot = { date: string; amount: bigint };
  const parties = new Map<
    number,
    { name: string; reference: string | null; lots: Lot[]; credit: bigint; last: string | null }
  >();
  let unallocatedCents = ZERO;
  let unallocatedCredits = ZERO;

  for (const line of [...lines]
    .filter((entry) => entry.side === side)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate))) {
    const net = (line.debitCents - line.creditCents) * sign;
    if (line.partyId === null) {
      // A control-account line with no party is not attached to a debtor or
      // creditor. It stays visible as "unallocated" and in the reconciliation.
      if (net >= ZERO) unallocatedCents += net;
      else unallocatedCredits += net;
      continue;
    }
    let party = parties.get(line.partyId);
    if (!party) {
      party = {
        name: line.partyName,
        reference: line.reference,
        lots: [],
        credit: ZERO,
        last: null,
      };
      parties.set(line.partyId, party);
    }
    if (!party.last || line.entryDate > party.last) party.last = line.entryDate;
    if (net > ZERO) {
      party.lots.push({ date: line.entryDate, amount: net });
    } else if (net < ZERO) {
      /*
       * Receipts in this ledger are not matched to individual invoices, so a
       * payment is applied to the oldest outstanding charge first (FIFO). The
       * basis is disclosed on the statement; it is a presentation convention,
       * not a claim that the ledger allocated the money that way.
       */
      let remaining = -net;
      while (remaining > ZERO && party.lots.length) {
        const lot = party.lots[0];
        const applied = lot.amount < remaining ? lot.amount : remaining;
        lot.amount -= applied;
        remaining -= applied;
        if (lot.amount === ZERO) party.lots.shift();
      }
      if (remaining > ZERO) party.credit += remaining;
    }
  }

  const rows: PartyRow[] = [];
  const totals = { current: ZERO, d30: ZERO, d60: ZERO, over90: ZERO, balance: ZERO };
  let creditBalances = ZERO;

  for (const [partyId, party] of [...parties.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  )) {
    let current = ZERO;
    let d30 = ZERO;
    let d60 = ZERO;
    let over90 = ZERO;
    for (const lot of party.lots) {
      const age = daysBetween(lot.date, meta.periodEnd);
      if (age <= 30) current += lot.amount;
      else if (age <= 60) d30 += lot.amount;
      else if (age <= 90) d60 += lot.amount;
      else over90 += lot.amount;
    }
    const outstanding = current + d30 + d60 + over90;
    const balance = outstanding - party.credit;
    if (balance === ZERO) continue;
    if (balance < ZERO) creditBalances += balance;
    rows.push({
      partyId,
      name: party.name,
      reference: party.reference,
      currentCents: centsString(current),
      days30Cents: centsString(d30),
      days60Cents: centsString(d60),
      over90Cents: centsString(over90),
      balanceCents: centsString(balance),
      lastActivity: party.last,
    });
    totals.current += current;
    totals.d30 += d30;
    totals.d60 += d60;
    totals.over90 += over90;
    totals.balance += balance;
  }

  const unallocatedNet = unallocatedCents + unallocatedCredits;
  return {
    asAt: meta.periodEnd,
    ageingBasis:
      'Balances are aged by posting date. Receipts and payments are not allocated to individual invoices in this ledger, ' +
      'so a payment is applied to the oldest outstanding charge first (FIFO). Unallocated lines carry no party and are shown separately.',
    rows,
    unallocatedCents: centsString(unallocatedNet),
    controlCents: centsString(controlCents),
    totalCents: centsString(totals.balance),
    differenceCents: centsString(controlCents - totals.balance - unallocatedNet),
    controlAccountCodes: controlAccounts.map((account) => account.code),
    totals: {
      currentCents: centsString(totals.current),
      days30Cents: centsString(totals.d30),
      days60Cents: centsString(totals.d60),
      over90Cents: centsString(totals.over90),
      balanceCents: centsString(totals.balance),
    },
    creditBalancesCents: centsString(creditBalances),
  };
}

function buildFixedAssets(
  view: LedgerView,
  meta: StatementMeta,
  input: BuildStatementInput,
): FixedAssetBlock {
  const rows = input.fixedAssets
    .map((asset) => ({
      assetCode: asset.assetCode,
      assetName: asset.assetName,
      category: asset.category,
      acquisitionDate: asset.acquisitionDate,
      status: asset.status,
      costCents: centsString(asset.costCents),
      accumulatedCents: centsString(asset.accumulatedCents),
      netBookValueCents: centsString(asset.netBookValueCents),
      periodChargeCents: centsString(input.depreciation.byAssetCode.get(asset.assetCode) ?? ZERO),
    }))
    .sort((a, b) => a.assetCode.localeCompare(b.assetCode));

  const registerCost = sumCents(input.fixedAssets.map((asset) => asset.costCents));
  const registerAccumulated = sumCents(input.fixedAssets.map((asset) => asset.accumulatedCents));
  const ledgerCost = view.groupNet('NON_CURRENT_PPE', 'closing');
  const ledgerAccumulated = -view.groupNet('ACCUMULATED_DEPRECIATION', 'closing');
  const ledgerCharge = sumCents(
    view
      .accountsInGroup('DEPRECIATION_EXPENSE')
      .map((account) => view.tradingNet(account.id, 'current')),
  );

  return {
    asAt: meta.periodEnd,
    rows,
    totals: {
      costCents: centsString(registerCost),
      accumulatedCents: centsString(registerAccumulated),
      netBookValueCents: centsString(registerCost - registerAccumulated),
      periodChargeCents: centsString(input.depreciation.batchChargeCents),
    },
    reconciliation: {
      registerCostCents: centsString(registerCost),
      ledgerCostCents: centsString(ledgerCost),
      costDifferenceCents: centsString(ledgerCost - registerCost),
      registerAccumulatedCents: centsString(registerAccumulated),
      ledgerAccumulatedCents: centsString(ledgerAccumulated),
      accumulatedDifferenceCents: centsString(ledgerAccumulated - registerAccumulated),
      batchChargeCents: centsString(input.depreciation.batchChargeCents),
      ledgerChargeCents: centsString(ledgerCharge),
      chargeDifferenceCents: centsString(ledgerCharge - input.depreciation.batchChargeCents),
      batchesPosted: input.depreciation.batchesPosted,
    },
  };
}

function buildClassificationSummary(
  view: LedgerView,
  overrides: Array<{ accountCode: string; accountName: string; group: string }>,
  invalid: Array<{ accountCode: string; accountName: string; note: string }>,
): ClassificationSummary {
  return {
    overrides,
    invalidOverrides: invalid,
    unclassified: [...view.classified.values()]
      .filter((entry) => entry.group === 'UNCLASSIFIED')
      .map((entry) => ({
        accountCode: entry.account.code,
        accountName: entry.account.name,
        accountType: entry.account.type,
        subType: entry.account.subType,
        balanceCents: centsString(view.net(entry.account.id, 'closing')),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
  };
}

interface CheckBlocks {
  financialPosition: FinancialPositionResult;
  income: IncomeStatementBlock;
  cashFlow: CashFlowBlock;
  trialBalance: TrialBalanceBlock;
  receivables: PartyStatementBlock;
  payables: PartyStatementBlock;
  fixedAssets: FixedAssetBlock;
}

function buildChecks(
  view: LedgerView,
  meta: StatementMeta,
  blocks: CheckBlocks,
  input: BuildStatementInput,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const ledgerTotal = sumCents(view.accounts.map((account) => view.net(account.id, 'closing')));
  const periodTotal = sumCents(
    view.accounts.map((account) => {
      const movement = view.movement(account.id);
      return movement.periodDebitCents - movement.periodCreditCents;
    }),
  );
  checks.push({
    code: 'LEDGER_BALANCED',
    label: 'Every posted journal balances',
    status: ledgerTotal === ZERO && periodTotal === ZERO ? 'PASS' : 'FAIL',
    detail:
      ledgerTotal === ZERO && periodTotal === ZERO
        ? 'Closing debits equal closing credits and the period movement nets to zero.'
        : 'The posted ledger does not net to zero. The statements cannot be approved until the imbalanced postings are found.',
    expectedCents: '0',
    actualCents: centsString(ledgerTotal + periodTotal),
    differenceCents: centsString(ledgerTotal + periodTotal),
  });

  const { financialPosition } = blocks;
  const differenceCurrent =
    financialPosition.assetsCurrent -
    financialPosition.equityCurrent -
    financialPosition.liabilitiesCurrent;
  checks.push({
    code: 'BALANCE_SHEET_BALANCES',
    label: 'Assets equal equity plus liabilities',
    status:
      differenceCurrent === ZERO &&
      (financialPosition.differencePrior === null || financialPosition.differencePrior === ZERO)
        ? 'PASS'
        : 'FAIL',
    detail: `Assets ${centsString(financialPosition.assetsCurrent)}c against equity plus liabilities ${centsString(
      financialPosition.equityCurrent + financialPosition.liabilitiesCurrent,
    )}c at ${meta.periodEnd}.`,
    expectedCents: centsString(financialPosition.assetsCurrent),
    actualCents: centsString(
      financialPosition.equityCurrent + financialPosition.liabilitiesCurrent,
    ),
    differenceCents: centsString(differenceCurrent),
  });

  checks.push({
    code: 'TRIAL_BALANCE_TIES',
    label: 'Trial balance agrees to the general ledger',
    status: blocks.trialBalance.ties ? 'PASS' : 'FAIL',
    detail: blocks.trialBalance.ties
      ? 'Opening, movement and closing debit totals each equal their credit totals.'
      : 'A trial-balance column does not balance. Review the ledger detail before approving.',
    differenceCents: centsString(
      cents(blocks.trialBalance.totals.closingDebitCents) -
        cents(blocks.trialBalance.totals.closingCreditCents),
    ),
  });

  const statementResult = cents(blocks.income.totals.netResultCents);
  const ledgerResult =
    -view.typeTrading('REVENUE', 'current') - view.typeTrading('EXPENSE', 'current');
  checks.push({
    code: 'PROFIT_AGREES_TO_LEDGER',
    label: 'Net result agrees to the revenue and expense accounts',
    status: statementResult === ledgerResult ? 'PASS' : 'FAIL',
    detail: `Income statement result ${centsString(statementResult)}c against ledger result ${centsString(
      ledgerResult,
    )}c, both excluding year-end closing journals.`,
    expectedCents: centsString(ledgerResult),
    actualCents: centsString(statementResult),
    differenceCents: centsString(statementResult - ledgerResult),
  });

  checks.push({
    code: 'CASH_FLOW_TIES',
    label: 'Cash flow agrees to the change in cash',
    status: blocks.cashFlow.ties.current ? 'PASS' : 'FAIL',
    detail: blocks.cashFlow.ties.current
      ? 'Operating, investing and financing activities equal the change in cash balances.'
      : 'The cash-flow total does not equal the change in cash. The difference is reported, not adjusted.',
    expectedCents: blocks.cashFlow.totals.closingCashCents,
    actualCents: centsString(
      cents(blocks.cashFlow.totals.openingCashCents) +
        cents(blocks.cashFlow.totals.netIncreaseCents),
    ),
    differenceCents: blocks.cashFlow.ties.differenceCents,
  });

  const expectedOpeningDate = previousDay(meta.periodStart);
  const openingMatches =
    input.priorApproved !== null &&
    input.priorApproved.periodEnd === expectedOpeningDate &&
    cents(financialPosition.block.opening.assetsCents) === input.priorApproved.assetsCents &&
    cents(financialPosition.block.opening.liabilitiesCents) ===
      input.priorApproved.liabilitiesCents &&
    cents(financialPosition.block.opening.equityCents) === input.priorApproved.equityCents;
  checks.push({
    code: 'OPENING_EQUALS_PRIOR_CLOSING',
    label: 'Opening balances agree to the prior approved statement',
    status: input.priorApproved === null ? 'WARNING' : openingMatches ? 'PASS' : 'FAIL',
    detail:
      input.priorApproved === null
        ? 'No approved statement closes the day before this period, so opening balances are taken from the ledger alone and are not certified against an approved predecessor.'
        : openingMatches
          ? `Prior approved version ${input.priorApproved.version} closes at ${input.priorApproved.periodEnd}, matching this statement's opening balances.`
          : `Prior approved version ${input.priorApproved.version} closes at ${input.priorApproved.periodEnd}. Opening balances differ; the difference is shown and must be explained before approval.`,
    expectedCents: input.priorApproved ? centsString(input.priorApproved.assetsCents) : undefined,
    actualCents: financialPosition.block.opening.assetsCents,
    differenceCents: input.priorApproved
      ? centsString(
          cents(financialPosition.block.opening.assetsCents) - input.priorApproved.assetsCents,
        )
      : undefined,
  });

  const unclassifiedWithBalance = [...view.classified.values()].filter(
    (entry) =>
      entry.group === 'UNCLASSIFIED' &&
      (view.net(entry.account.id, 'closing') !== ZERO ||
        view.net(entry.account.id, 'opening') !== ZERO),
  );
  checks.push({
    code: 'ACCOUNTS_CLASSIFIED',
    label: 'Every account with a balance has a presentation group',
    status: unclassifiedWithBalance.length === 0 ? 'PASS' : 'FAIL',
    detail:
      unclassifiedWithBalance.length === 0
        ? 'All accounts with balances map to a balance-sheet or income-statement line.'
        : `${unclassifiedWithBalance.length} account(s) could not be classified and are shown as unclassified: ${unclassifiedWithBalance
            .map((entry) => `${entry.account.code} ${entry.account.name}`)
            .join(', ')}. Map them before approval.`,
    actualCents: centsString(
      sumCents(unclassifiedWithBalance.map((entry) => view.net(entry.account.id, 'closing'))),
    ),
    differenceCents: centsString(
      sumCents(unclassifiedWithBalance.map((entry) => view.net(entry.account.id, 'closing'))),
    ),
  });

  const arDifference = cents(blocks.receivables.differenceCents);
  checks.push({
    code: 'RECEIVABLES_RECONCILE',
    label: 'Debtor balances agree to the receivable control accounts',
    status: arDifference === ZERO ? 'PASS' : 'FAIL',
    detail:
      arDifference === ZERO
        ? `Debtor balances plus unallocated lines equal control accounts ${blocks.receivables.controlAccountCodes.join(', ') || '(none)'}.`
        : 'The sum of debtor balances and unallocated receivable lines does not equal the control account. Investigate before approval.',
    expectedCents: blocks.receivables.controlCents,
    actualCents: centsString(
      cents(blocks.receivables.totalCents) + cents(blocks.receivables.unallocatedCents),
    ),
    differenceCents: blocks.receivables.differenceCents,
  });

  const apDifference = cents(blocks.payables.differenceCents);
  checks.push({
    code: 'PAYABLES_RECONCILE',
    label: 'Supplier balances agree to the payable control accounts',
    status: apDifference === ZERO ? 'PASS' : 'FAIL',
    detail:
      apDifference === ZERO
        ? `Supplier balances plus unallocated lines equal control accounts ${blocks.payables.controlAccountCodes.join(', ') || '(none)'}.`
        : 'The sum of supplier balances and unallocated payable lines does not equal the control account. Investigate before approval.',
    expectedCents: blocks.payables.controlCents,
    actualCents: centsString(
      cents(blocks.payables.totalCents) + cents(blocks.payables.unallocatedCents),
    ),
    differenceCents: blocks.payables.differenceCents,
  });

  const bankDifferences = input.bankAccounts
    .map((bank) => view.net(bank.glAccountId, 'closing') - bank.storedBookBalanceCents)
    .filter((difference) => difference !== ZERO);
  checks.push({
    code: 'BANK_BOOK_BALANCE',
    label: 'Bank book balances agree to the general ledger',
    status: bankDifferences.length === 0 ? 'PASS' : 'FAIL',
    detail:
      bankDifferences.length === 0
        ? 'Every bank account’s stored book balance equals its ledger balance at the reporting date.'
        : `${bankDifferences.length} bank account(s) carry a stored book balance that differs from the ledger. Reconcile the account before approval.`,
    differenceCents: centsString(sumCents(bankDifferences)),
  });

  const fixed = blocks.fixedAssets.reconciliation;
  const costDifference = cents(fixed.costDifferenceCents);
  const accumulatedDifference = cents(fixed.accumulatedDifferenceCents);
  checks.push({
    code: 'FIXED_ASSET_REGISTER_AGREES',
    label: 'Fixed-asset register agrees to property, plant and equipment',
    status: costDifference === ZERO && accumulatedDifference === ZERO ? 'PASS' : 'FAIL',
    detail:
      costDifference === ZERO && accumulatedDifference === ZERO
        ? 'Register cost and accumulated depreciation equal the PPE control accounts.'
        : 'Register cost or accumulated depreciation differs from the PPE control accounts. The difference is shown on the schedule and is not adjusted.',
    expectedCents: fixed.ledgerCostCents,
    actualCents: fixed.registerCostCents,
    differenceCents: centsString(costDifference + accumulatedDifference),
  });

  const chargeDifference = cents(fixed.chargeDifferenceCents);
  checks.push({
    code: 'DEPRECIATION_AGREES',
    label: 'Depreciation expense agrees to the posted depreciation batches',
    status: chargeDifference === ZERO ? 'PASS' : 'WARNING',
    detail:
      chargeDifference === ZERO
        ? 'Depreciation charged in the ledger equals the posted fixed-asset batches for the period.'
        : `The ledger depreciation charge differs from posted batches by ${centsString(
            chargeDifference,
          )}c. This is expected where depreciation was posted outside the batch process; the difference is shown on the schedule.`,
    expectedCents: fixed.batchChargeCents,
    actualCents: fixed.ledgerChargeCents,
    differenceCents: fixed.chargeDifferenceCents,
  });

  const comparativeActivity = view.hasComparative
    ? sumCents(
        view.accounts.map((account) => {
          const movement = view.movement(account.id);
          return movement.comparativeDebitCents + movement.comparativeCreditCents;
        }),
      )
    : ZERO;
  checks.push({
    code: 'COMPARATIVE_AVAILABLE',
    label: 'Comparative period has ledger activity',
    status:
      meta.comparativeStart === null ? 'INFO' : comparativeActivity > ZERO ? 'PASS' : 'WARNING',
    detail:
      meta.comparativeStart === null
        ? 'No comparative period was requested for this statement.'
        : comparativeActivity > ZERO
          ? 'The comparative period contains posted journals; prior-period figures come from the ledger.'
          : 'The comparative period contains no posted journals. Prior-period columns are therefore empty rather than estimated.',
  });

  const memo = input.partnerEquity;
  const registerTotal = memo?.available
    ? sumCents(memo.partners.map((partner) => partner.closingCents ?? ZERO))
    : null;
  const registerAgrees =
    registerTotal !== null && registerTotal === -view.groupNet('PARTNERS_CAPITAL', 'closing');
  checks.push({
    code: 'PARTNER_EQUITY_REGISTER',
    label: "Partners' equity register agrees to partners' capital accounts",
    status: registerTotal === null ? 'WARNING' : registerAgrees ? 'PASS' : 'WARNING',
    detail:
      registerTotal === null
        ? 'No partner equity statement covers this period. The equity statement is derived from the ledger alone.'
        : registerAgrees
          ? 'The partner equity register total equals the ledger partners’ capital accounts.'
          : 'The partner equity register total differs from the ledger partners’ capital accounts. Both figures are shown; neither is adjusted.',
    expectedCents: registerTotal === null ? undefined : centsString(registerTotal),
    actualCents: centsString(-view.groupNet('PARTNERS_CAPITAL', 'closing')),
    differenceCents:
      registerTotal === null
        ? undefined
        : centsString(registerTotal - -view.groupNet('PARTNERS_CAPITAL', 'closing')),
  });

  checks.push({
    code: 'LEDGER_WATERMARK',
    label: 'Statement records the ledger watermark it was built from',
    status: meta.ledgerThrough === null ? 'WARNING' : 'INFO',
    detail:
      meta.ledgerThrough === null
        ? 'No posted journals fall inside the statement window.'
        : `${meta.journalCount} posted journal(s); latest posting at ${meta.ledgerThrough}.`,
  });

  return checks;
}

export function buildStatementPayload(input: BuildStatementInput): StatementPayload {
  const { meta } = input;
  const classified = classifyAccounts(input.accounts, input.overrides);
  const view = new LedgerView(
    input.accounts,
    input.movements,
    input.tradingMovements,
    classified,
    meta.comparativeStart !== null,
  );

  const financialPosition = buildFinancialPosition(view, meta);
  const income = buildIncomeStatement(view, meta);
  const netResult = cents(income.totals.netResultCents);
  const netResultPrior =
    income.totals.priorNetResultCents === null ? null : cents(income.totals.priorNetResultCents);
  const cashFlow = buildCashFlow(view, meta, netResult, netResultPrior);
  const equity = buildEquityStatement(
    view,
    meta,
    netResult,
    netResultPrior,
    {
      opening: financialPosition.accumulatedOpening,
      priorOpening: financialPosition.accumulatedPriorOpening,
      transferCurrent: financialPosition.transferCurrent,
      transferPrior: financialPosition.transferPrior,
    },
    input.partnerEquity,
  );
  const trialBalance = buildTrialBalance(view, meta);
  const generalLedger = buildGeneralLedger(view, meta, input.journalLines);
  const cashbook = buildCashbook(view, meta, input.bankAccounts, input.journalLines);
  const receivables = buildPartyStatement(view, meta, 'RECEIVABLE', input.partyLines);
  const payables = buildPartyStatement(view, meta, 'PAYABLE', input.partyLines);
  const fixedAssets = buildFixedAssets(view, meta, input);

  const classification = buildClassificationSummary(
    view,
    [...classified.values()]
      .filter((entry) => entry.source === 'OVERRIDE')
      .map((entry) => ({
        accountCode: entry.account.code,
        accountName: entry.account.name,
        group: entry.group,
      })),
    [...classified.values()]
      .filter((entry) => entry.source === 'INVALID_OVERRIDE')
      .map((entry) => ({
        accountCode: entry.account.code,
        accountName: entry.account.name,
        note: 'The stored presentation group does not suit this account type and was ignored.',
      })),
  );

  const checks = buildChecks(
    view,
    meta,
    { financialPosition, income, cashFlow, trialBalance, receivables, payables, fixedAssets },
    input,
  );

  return {
    schemaVersion: 1,
    meta,
    statements: {
      financialPosition: financialPosition.block,
      incomeStatement: income,
      cashFlows: cashFlow,
      changesInEquity: equity,
    },
    schedules: { trialBalance, generalLedger, cashbook, receivables, payables, fixedAssets },
    classification,
    notes: [...input.notes],
    checks,
    readyForApproval: checks.every((check) => check.status !== 'FAIL'),
  };
}

/** Statement blocks in print order, used by the exports and the UI. */
export function primaryStatements(payload: StatementPayload) {
  return [
    payload.statements.financialPosition,
    payload.statements.incomeStatement,
    payload.statements.cashFlows,
  ];
}

export { GROUP_LABELS, GROUP_NOTES, RESULT_GROUPS };
