/**
 * Syrona Medical Center HMIS — the shape of a generated statement set.
 *
 * Every amount is a decimal string of integer cents. The payload is stored as
 * `jsonb` when a statement is approved, and a `bigint` cannot be serialised to
 * JSON, so cents are strings from here to the screen. Nothing in this file
 * rounds: a figure either came from the ledger or it is not shown.
 */

import type { PresentationGroup } from './groups.ts';

export type StatementFrequency = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';
export type AccountingBasis = 'ACCRUAL';
export type RunStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'SUPERSEDED';
export type CheckStatus = 'PASS' | 'FAIL' | 'WARNING' | 'INFO';

export type RowKind = 'SECTION' | 'LINE' | 'SUBTOTAL' | 'TOTAL';

/** One line of a primary statement. */
export interface StatementRow {
  key: string;
  label: string;
  /** Supporting-note reference, e.g. "3". Null when the line has no note. */
  note: string | null;
  kind: RowKind;
  depth: number;
  currentCents: string;
  /** Null when no comparative period exists — never zero, which would claim a figure. */
  priorCents: string | null;
  /** Chart account codes behind the line, so a reader can trace it to the ledger. */
  accountCodes?: string[];
}

export interface StatementColumn {
  current: string;
  prior: string | null;
}

export interface StatementBlock {
  key: string;
  title: string;
  subtitle: string | null;
  columns: StatementColumn;
  rows: StatementRow[];
  /** Applied when the block is printed: 'KES', thousands separator, parentheses. */
  currency: string;
}

export interface ValidationCheck {
  code: string;
  label: string;
  status: CheckStatus;
  detail: string;
  expectedCents?: string;
  actualCents?: string;
  differenceCents?: string;
}

export interface BalanceSheetBlock extends StatementBlock {
  asAt: string;
  comparativeAsAt: string | null;
  totals: {
    assetsCents: string;
    equityCents: string;
    liabilitiesCents: string;
    equityAndLiabilitiesCents: string;
    priorAssetsCents: string | null;
    priorEquityCents: string | null;
    priorLiabilitiesCents: string | null;
    priorEquityAndLiabilitiesCents: string | null;
  };
  /** As at the day before the period, used for the opening/closing reconciliation. */
  opening: {
    assetsCents: string;
    equityCents: string;
    liabilitiesCents: string;
    balanced: boolean;
  };
  balanced: { current: boolean; prior: boolean | null };
  difference: { currentCents: string; priorCents: string | null };
}

export interface IncomeStatementBlock extends StatementBlock {
  periodStart: string;
  periodEnd: string;
  comparativeStart: string | null;
  comparativeEnd: string | null;
  totals: {
    revenueCents: string;
    otherIncomeCents: string;
    totalIncomeCents: string;
    costOfSalesCents: string;
    grossProfitCents: string;
    operatingExpensesCents: string;
    depreciationCents: string;
    financeCostsCents: string;
    profitBeforeTaxCents: string;
    taxExpenseCents: string;
    netResultCents: string;
    priorNetResultCents: string | null;
  };
}

export interface CashFlowBlock extends StatementBlock {
  periodStart: string;
  periodEnd: string;
  totals: {
    operatingCents: string;
    investingCents: string;
    financingCents: string;
    netIncreaseCents: string;
    openingCashCents: string;
    closingCashCents: string;
    priorNetIncreaseCents: string | null;
    priorClosingCashCents: string | null;
  };
  ties: { current: boolean; prior: boolean | null; differenceCents: string };
}

/**
 * A statement of changes in equity is a matrix, not two columns: each component
 * moves by capital introduced, drawings, the period result and year-end
 * transfers. Flattening it into a single "current" figure would hide the
 * movements the statement exists to show.
 */
export interface EquityMovementRow {
  key: string;
  label: string;
  note: string | null;
  depth: number;
  kind: RowKind;
  openingCents: string;
  introducedCents: string;
  withdrawnCents: string;
  resultCents: string;
  transfersCents: string;
  closingCents: string;
  priorClosingCents: string | null;
}

export interface EquityStatementBlock extends Omit<StatementBlock, 'rows' | 'columns'> {
  periodStart: string;
  periodEnd: string;
  columns: {
    current: string;
    prior: string | null;
    movements: ['opening', 'introduced', 'withdrawn', 'result', 'transfers', 'closing'];
  };
  rows: EquityMovementRow[];
  totals: {
    openingCents: string;
    introducedCents: string;
    withdrawnCents: string;
    resultCents: string;
    transfersCents: string;
    closingCents: string;
    priorClosingCents: string | null;
  };
  /** Partner-level closing balances from `src/partner-equity`, when a statement exists. */
  partnerRegister: PartnerEquityMemo | null;
}

export interface PartnerEquityMemo {
  available: boolean;
  statementId: number | null;
  status: string | null;
  periodLabel: string | null;
  closingTotalCents: string | null;
  partners: Array<{ name: string; closingCents: string | null }>;
  ledgerPartnersCapitalCents: string;
  differenceCents: string | null;
  reason: string | null;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  presentationGroup: PresentationGroup;
  openingDebitCents: string;
  openingCreditCents: string;
  movementDebitCents: string;
  movementCreditCents: string;
  closingDebitCents: string;
  closingCreditCents: string;
}

export interface TrialBalanceBlock {
  asAt: string;
  periodStart: string;
  rows: TrialBalanceRow[];
  totals: {
    openingDebitCents: string;
    openingCreditCents: string;
    movementDebitCents: string;
    movementCreditCents: string;
    closingDebitCents: string;
    closingCreditCents: string;
  };
  ties: boolean;
}

export interface GeneralLedgerLine {
  entryDate: string;
  journalNumber: string;
  description: string;
  sourceType: string;
  debitCents: string;
  creditCents: string;
  runningCents: string;
  /** Party name where the posting carried one, else null. */
  party: string | null;
}

export interface GeneralLedgerAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  presentationGroup: PresentationGroup;
  openingCents: string;
  closingCents: string;
  lines: GeneralLedgerLine[];
}

export interface GeneralLedgerBlock {
  periodStart: string;
  periodEnd: string;
  accounts: GeneralLedgerAccount[];
  lineCount: number;
}

export interface CashbookTransaction {
  entryDate: string;
  journalNumber: string;
  description: string;
  receiptCents: string;
  paymentCents: string;
  balanceCents: string;
}

export interface BankImportSummary {
  id: number;
  statementDate: string | null;
  status: string;
  lineCount: number;
}

export interface CashbookAccount {
  key: string;
  name: string;
  kind: 'BANK' | 'CASH_ON_HAND';
  bankName: string | null;
  accountNumberMasked: string | null;
  glAccountCode: string;
  glAccountName: string;
  ledgerOpeningCents: string;
  receiptsCents: string;
  paymentsCents: string;
  ledgerClosingCents: string;
  /** Balance stored on `bank_accounts.book_balance_kes`, when the row exists. */
  storedBookBalanceCents: string | null;
  differenceCents: string | null;
  lastReconciledAt: string | null;
  imports: BankImportSummary[];
  transactions: CashbookTransaction[];
  /** True when the GL account is cash but no bank account record points at it. */
  unmapped: boolean;
}

export interface CashbookBlock {
  periodStart: string;
  periodEnd: string;
  accounts: CashbookAccount[];
  totals: {
    openingCents: string;
    receiptsCents: string;
    paymentsCents: string;
    closingCents: string;
  };
}

export interface PartyRow {
  partyId: number | null;
  name: string;
  reference: string | null;
  currentCents: string;
  days30Cents: string;
  days60Cents: string;
  over90Cents: string;
  balanceCents: string;
  lastActivity: string | null;
}

export interface PartyStatementBlock {
  asAt: string;
  /** How balances were aged, stated because the ledger does not allocate receipts to invoices. */
  ageingBasis: string;
  rows: PartyRow[];
  /** Lines on the control accounts that carry no party — shown, never absorbed. */
  unallocatedCents: string;
  controlCents: string;
  totalCents: string;
  differenceCents: string;
  controlAccountCodes: string[];
  totals: {
    currentCents: string;
    days30Cents: string;
    days60Cents: string;
    over90Cents: string;
    balanceCents: string;
  };
  creditBalancesCents: string;
}

export interface FixedAssetRow {
  assetCode: string;
  assetName: string;
  category: string;
  acquisitionDate: string;
  status: string;
  costCents: string;
  accumulatedCents: string;
  netBookValueCents: string;
  periodChargeCents: string;
}

export interface FixedAssetBlock {
  asAt: string;
  rows: FixedAssetRow[];
  totals: {
    costCents: string;
    accumulatedCents: string;
    netBookValueCents: string;
    periodChargeCents: string;
  };
  reconciliation: {
    registerCostCents: string;
    ledgerCostCents: string;
    costDifferenceCents: string;
    registerAccumulatedCents: string;
    ledgerAccumulatedCents: string;
    accumulatedDifferenceCents: string;
    batchChargeCents: string;
    ledgerChargeCents: string;
    chargeDifferenceCents: string;
    batchesPosted: number;
  };
}

export interface ManagementNote {
  noteRef: string;
  title: string;
  body: string;
  authorUserId: number | null;
  authorName: string | null;
  recordedAt: string;
}

export interface ClassificationSummary {
  overrides: Array<{ accountCode: string; accountName: string; group: string }>;
  invalidOverrides: Array<{ accountCode: string; accountName: string; note: string }>;
  unclassified: Array<{
    accountCode: string;
    accountName: string;
    accountType: string;
    subType: string;
    balanceCents: string;
  }>;
}

export interface StatementMeta {
  facilityId: number;
  facilityName: string;
  facilityCode: string | null;
  facilityAddress: string | null;
  currency: string;
  frequency: StatementFrequency;
  financialYear: string;
  financialYearStartMonth: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  comparativeMode: string;
  comparativeStart: string | null;
  comparativeEnd: string | null;
  comparativeLabel: string | null;
  accountingBasis: AccountingBasis;
  basisNote: string;
  generatedAt: string;
  generatedByName: string | null;
  ledgerThrough: string | null;
  journalCount: number;
  sourcePeriods: Array<{
    periodCode: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
}

export interface StatementPayload {
  schemaVersion: 1;
  meta: StatementMeta;
  statements: {
    financialPosition: BalanceSheetBlock;
    incomeStatement: IncomeStatementBlock;
    cashFlows: CashFlowBlock;
    changesInEquity: EquityStatementBlock;
  };
  schedules: {
    trialBalance: TrialBalanceBlock;
    generalLedger: GeneralLedgerBlock;
    cashbook: CashbookBlock;
    receivables: PartyStatementBlock;
    payables: PartyStatementBlock;
    fixedAssets: FixedAssetBlock;
  };
  classification: ClassificationSummary;
  notes: ManagementNote[];
  checks: ValidationCheck[];
  /** The single figure an approval gate reads. */
  readyForApproval: boolean;
}
