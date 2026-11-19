/**
 * Financial statement engine — hand-worked figures.
 *
 * The dataset below is small enough to total on paper. Every expected number
 * in this file was calculated independently of the code under test:
 *
 *   Opening (1 June 2025):
 *     cash 50,000 + receivables 20,000 + equipment 100,000 − accumulated 10,000
 *       = assets 160,000
 *     payables 15,000 + capital 125,000 = 160,000
 *
 *   July 2025:
 *     services invoiced 30,000 on credit
 *     cash received 25,000
 *     salaries paid 12,000
 *     depreciation charged 2,500
 *     inventory bought on credit 8,000
 *
 *   Closing 31 July 2025:
 *     cash 63,000; receivables 25,000; inventory 8,000;
 *     equipment 100,000; accumulated depreciation (12,500) = assets 183,500
 *     payables 23,000; capital 125,000;
 *     accumulated results 20,000 opening + 15,500 period = 35,500
 *     equity 160,500; equity + liabilities = 183,500
 *
 *   Result: 30,000 − 12,000 − 2,500 = 15,500
 *   Cash flow: 15,500 + 2,500 − (25,000−20,000) − 8,000 + 8,000 = 13,000
 *              closing cash 63,000 − opening cash 50,000 = 13,000
 */

import { describe, expect, it } from 'vitest';
import {
  buildStatementPayload,
  type AccountMovement,
  type BuildStatementInput,
  type LedgerLineInput,
  type PartyLineInput,
} from '../financial-statements/engine.ts';
import { classifyAccounts } from '../financial-statements/classification.ts';
import { centsFromKes, cents } from '../financial-statements/money.ts';
import {
  financialYear,
  financialYearFor,
  resolveComparative,
  resolvePeriod,
  priorPeriodRange,
} from '../financial-statements/period.ts';
import type { ManagementNote, StatementMeta } from '../financial-statements/types.ts';

interface AccountFixture {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  subType: string;
}

const ACCOUNTS: AccountFixture[] = [
  { code: '1000', name: 'Cash at bank', type: 'ASSET', subType: 'CASH_AT_BANK' },
  { code: '1010', name: 'Petty cash', type: 'ASSET', subType: 'CASH_ON_HAND' },
  { code: '1100', name: 'Patient receivables', type: 'ASSET', subType: 'RECEIVABLE' },
  { code: '1200', name: 'Pharmacy inventory', type: 'ASSET', subType: 'INVENTORY' },
  { code: '1500', name: 'Medical equipment', type: 'ASSET', subType: 'PPE' },
  {
    code: '1590',
    name: 'Accumulated depreciation',
    type: 'ASSET',
    subType: 'ACCUMULATED_DEPRECIATION',
  },
  { code: '2000', name: 'Supplier payables', type: 'LIABILITY', subType: 'PAYABLE' },
  { code: '2100', name: 'PAYE payable', type: 'LIABILITY', subType: 'STATUTORY' },
  { code: '3000', name: 'Partners capital', type: 'EQUITY', subType: 'PARTNER_CAPITAL' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY', subType: 'RETAINED_EARNINGS' },
  { code: '4000', name: 'Outpatient services', type: 'REVENUE', subType: 'REVENUE' },
  { code: '5000', name: 'Salaries and wages', type: 'EXPENSE', subType: 'OPERATING' },
  { code: '5100', name: 'Depreciation', type: 'EXPENSE', subType: 'DEPRECIATION' },
];

type FixtureLine = {
  account: string;
  debitKes?: string;
  creditKes?: string;
  patientId?: number;
  patientName?: string;
  supplierId?: number;
  supplierName?: string;
};

interface FixtureEntry {
  date: string;
  description: string;
  sourceType?: string;
  journalNumber: string;
  lines: FixtureLine[];
}

const JULY_ENTRIES: FixtureEntry[] = [
  {
    date: '2025-06-01',
    journalNumber: 'J-OPEN-1',
    description: 'Opening cash and capital',
    lines: [
      { account: '1000', debitKes: '50000.00' },
      { account: '3000', creditKes: '50000.00' },
    ],
  },
  {
    date: '2025-06-01',
    journalNumber: 'J-OPEN-2',
    description: 'Opening receivables',
    lines: [
      { account: '1100', debitKes: '20000.00', patientId: 7, patientName: 'Wanjiku Kamau' },
      { account: '4000', creditKes: '20000.00' },
    ],
  },
  {
    date: '2025-06-01',
    journalNumber: 'J-OPEN-3',
    description: 'Opening equipment, depreciation and supplier balance',
    lines: [
      { account: '1500', debitKes: '100000.00' },
      { account: '1590', creditKes: '10000.00' },
      {
        account: '2000',
        creditKes: '15000.00',
        supplierId: 3,
        supplierName: 'Nyeri Medical Supplies',
      },
      { account: '3000', creditKes: '75000.00' },
    ],
  },
  {
    date: '2025-07-05',
    journalNumber: 'J-1001',
    description: 'Outpatient services invoiced',
    lines: [
      { account: '1100', debitKes: '30000.00', patientId: 7, patientName: 'Wanjiku Kamau' },
      { account: '4000', creditKes: '30000.00' },
    ],
  },
  {
    date: '2025-07-12',
    journalNumber: 'J-1002',
    description: 'Cash received from patients',
    lines: [
      { account: '1000', debitKes: '25000.00' },
      { account: '1100', creditKes: '25000.00', patientId: 7, patientName: 'Wanjiku Kamau' },
    ],
  },
  {
    date: '2025-07-20',
    journalNumber: 'J-1003',
    description: 'July salaries',
    lines: [
      { account: '5000', debitKes: '12000.00' },
      { account: '1000', creditKes: '12000.00' },
    ],
  },
  {
    date: '2025-07-25',
    journalNumber: 'J-1004',
    description: 'Pharmacy stock received on credit',
    lines: [
      { account: '1200', debitKes: '8000.00' },
      {
        account: '2000',
        creditKes: '8000.00',
        supplierId: 3,
        supplierName: 'Nyeri Medical Supplies',
      },
    ],
  },
  {
    date: '2025-07-31',
    journalNumber: 'J-1005',
    description: 'July depreciation',
    lines: [
      { account: '5100', debitKes: '2500.00' },
      { account: '1590', creditKes: '2500.00' },
    ],
  },
];

interface Window {
  periodStart: string;
  periodEnd: string;
  comparativeStart: string | null;
  comparativeEnd: string | null;
}

function accountId(code: string, accounts: Array<AccountFixture & { id: number }>): number {
  const found = accounts.find((account) => account.code === code);
  if (!found) throw new Error(`Unknown fixture account ${code}`);
  return found.id;
}

function movementsFor(
  accounts: Array<AccountFixture & { id: number }>,
  entries: FixtureEntry[],
  window: Window,
  options: { excludeClose?: boolean } = {},
): AccountMovement[] {
  const byAccount = new Map<number, AccountMovement>();
  const blank = (accountIdValue: number): AccountMovement => ({
    accountId: accountIdValue,
    closingDebitCents: 0n,
    closingCreditCents: 0n,
    periodDebitCents: 0n,
    periodCreditCents: 0n,
    priorDebitCents: 0n,
    priorCreditCents: 0n,
    comparativeDebitCents: 0n,
    comparativeCreditCents: 0n,
  });
  for (const entry of entries) {
    if (options.excludeClose && entry.sourceType === 'YEAR_END_CLOSE') continue;
    for (const line of entry.lines) {
      const id = accountId(line.account, accounts);
      const debit = line.debitKes ? centsFromKes(line.debitKes) : 0n;
      const credit = line.creditKes ? centsFromKes(line.creditKes) : 0n;
      const movement = byAccount.get(id) ?? blank(id);
      byAccount.set(id, movement);
      if (entry.date <= window.periodEnd) {
        movement.closingDebitCents += debit;
        movement.closingCreditCents += credit;
      }
      if (entry.date >= window.periodStart && entry.date <= window.periodEnd) {
        movement.periodDebitCents += debit;
        movement.periodCreditCents += credit;
      }
      if (window.comparativeEnd && entry.date <= window.comparativeEnd) {
        movement.priorDebitCents += debit;
        movement.priorCreditCents += credit;
      }
      if (
        window.comparativeStart &&
        window.comparativeEnd &&
        entry.date >= window.comparativeStart &&
        entry.date <= window.comparativeEnd
      ) {
        movement.comparativeDebitCents += debit;
        movement.comparativeCreditCents += credit;
      }
    }
  }
  return [...byAccount.values()];
}

function buildFixture(options: {
  entries: FixtureEntry[];
  window: Window;
  extraAccounts?: AccountFixture[];
  meta?: Partial<StatementMeta>;
  overrides?: Map<number, string>;
  notes?: ManagementNote[];
  fixedAssets?: BuildStatementInput['fixedAssets'];
  depreciation?: BuildStatementInput['depreciation'];
  bankBookBalanceKes?: string;
  partnerEquity?: BuildStatementInput['partnerEquity'];
}): ReturnType<typeof buildStatementPayload> {
  const accounts = [...ACCOUNTS, ...(options.extraAccounts ?? [])].map((account, index) => ({
    ...account,
    id: index + 1,
  }));
  const overrides = options.overrides ?? new Map<number, string>();
  const classified = classifyAccounts(accounts, overrides);

  const journalLines: LedgerLineInput[] = [];
  for (const entry of options.entries) {
    if (entry.date < options.window.periodStart || entry.date > options.window.periodEnd) continue;
    for (const line of entry.lines) {
      journalLines.push({
        accountId: accountId(line.account, accounts),
        entryDate: entry.date,
        journalNumber: entry.journalNumber,
        description: entry.description,
        sourceType: entry.sourceType ?? 'MANUAL',
        debitCents: line.debitKes ? centsFromKes(line.debitKes) : 0n,
        creditCents: line.creditKes ? centsFromKes(line.creditKes) : 0n,
        party: line.patientName ?? line.supplierName ?? null,
      });
    }
  }

  const partyLines: PartyLineInput[] = [];
  for (const entry of options.entries) {
    if (entry.date > options.window.periodEnd) continue;
    for (const line of entry.lines) {
      const classification = classified.get(accountId(line.account, accounts))!;
      const side =
        classification.group === 'RECEIVABLE'
          ? ('RECEIVABLE' as const)
          : classification.group === 'PAYABLES'
            ? ('PAYABLE' as const)
            : null;
      if (!side) continue;
      const isReceivable = side === 'RECEIVABLE';
      partyLines.push({
        side,
        partyId: isReceivable ? (line.patientId ?? null) : (line.supplierId ?? null),
        partyName: (isReceivable ? line.patientName : line.supplierName) ?? 'Unallocated',
        reference: isReceivable ? 'MRN-0007' : null,
        entryDate: entry.date,
        debitCents: line.debitKes ? centsFromKes(line.debitKes) : 0n,
        creditCents: line.creditKes ? centsFromKes(line.creditKes) : 0n,
      });
    }
  }

  const meta: StatementMeta = {
    facilityId: 1,
    facilityName: 'Syrona Medical Center',
    facilityCode: 'SMC',
    facilityAddress: 'Nyeri',
    currency: 'KES',
    frequency: 'MONTHLY',
    financialYear: '2025/2026',
    financialYearStartMonth: 7,
    periodStart: options.window.periodStart,
    periodEnd: options.window.periodEnd,
    periodLabel: 'July 2025',
    comparativeMode: options.window.comparativeStart ? 'PRIOR_PERIOD' : 'NONE',
    comparativeStart: options.window.comparativeStart,
    comparativeEnd: options.window.comparativeEnd,
    comparativeLabel: options.window.comparativeStart ? 'June 2025' : null,
    accountingBasis: 'ACCRUAL',
    basisNote: 'Accrual basis, posted journals only.',
    generatedAt: '2025-08-01T09:00:00.000Z',
    generatedByName: 'Test Accountant',
    ledgerThrough: '2025-07-31T18:00:00.000Z',
    journalCount: options.entries.length,
    sourcePeriods: [],
    ...options.meta,
  };

  const fixedAssets = options.fixedAssets ?? [
    {
      assetCode: 'FA-001',
      assetName: 'Ultrasound scanner',
      category: 'Medical equipment',
      acquisitionDate: '2024-07-01',
      status: 'ACTIVE',
      costCents: 100_000_00n,
      accumulatedCents: 12_500_00n,
      netBookValueCents: 87_500_00n,
    },
  ];
  const depreciation = options.depreciation ?? {
    batchChargeCents: 2_500_00n,
    batchesPosted: 1,
    byAssetCode: new Map([['FA-001', 2_500_00n]]),
  };

  return buildStatementPayload({
    meta,
    accounts,
    movements: movementsFor(accounts, options.entries, options.window),
    tradingMovements: movementsFor(accounts, options.entries, options.window, {
      excludeClose: true,
    }),
    overrides,
    journalLines,
    partyLines,
    bankAccounts: [
      {
        id: 1,
        name: 'Equity Bank — operations',
        kind: 'BANK',
        bankName: 'Equity Bank',
        accountNumberMasked: '****1234',
        glAccountId: accountId('1000', accounts),
        storedBookBalanceCents: centsFromKes(options.bankBookBalanceKes ?? '63000.00'),
        lastReconciledAt: null,
        imports: [],
      },
    ],
    fixedAssets,
    depreciation,
    partnerEquity: options.partnerEquity ?? null,
    priorApproved: null,
    notes: options.notes ?? [],
  });
}

const JULY_WINDOW: Window = {
  periodStart: '2025-07-01',
  periodEnd: '2025-07-31',
  comparativeStart: null,
  comparativeEnd: null,
};

describe('financial statement engine — monthly statement', () => {
  const payload = buildFixture({ entries: JULY_ENTRIES, window: JULY_WINDOW });

  it('balances assets against equity and liabilities', () => {
    const bs = payload.statements.financialPosition;
    expect(bs.totals.assetsCents).toBe('18350000');
    expect(bs.totals.liabilitiesCents).toBe('2300000');
    expect(bs.totals.equityCents).toBe('16050000');
    expect(bs.totals.equityAndLiabilitiesCents).toBe('18350000');
    expect(bs.balanced.current).toBe(true);
    expect(bs.difference.currentCents).toBe('0');
    expect(bs.opening.balanced).toBe(true);
    expect(bs.opening.assetsCents).toBe('16000000');
  });

  it('shows accumulated depreciation as a contra asset inside non-current assets', () => {
    const rows = payload.statements.financialPosition.rows;
    const depreciation = rows.find((row) => row.key === 'ACCUMULATED_DEPRECIATION');
    expect(depreciation?.currentCents).toBe('-1250000');
    const nonCurrentTotal = rows.find((row) => row.key === 'NON_CURRENT_ASSETS_TOTAL');
    // 100,000 equipment less 12,500 accumulated depreciation
    expect(nonCurrentTotal?.currentCents).toBe('8750000');
  });

  it('separates the period result from results brought forward', () => {
    const rows = payload.statements.financialPosition.rows;
    expect(rows.find((row) => row.key === 'RESULT_FOR_PERIOD')?.currentCents).toBe('1550000');
    expect(rows.find((row) => row.key === 'RESULT_BROUGHT_FORWARD')?.currentCents).toBe('2000000');
    expect(rows.find((row) => row.key === 'ACCUMULATED_RESULTS_TOTAL')?.currentCents).toBe(
      '3550000',
    );
  });

  it('derives the income statement from posted revenue and expenses', () => {
    const income = payload.statements.incomeStatement;
    expect(income.totals.revenueCents).toBe('3000000');
    expect(income.totals.grossProfitCents).toBe('3000000');
    expect(income.totals.operatingExpensesCents).toBe('1450000');
    expect(income.totals.netResultCents).toBe('1550000');
  });

  it('ties the cash flow to the movement in cash', () => {
    const cashFlow = payload.statements.cashFlows;
    expect(cashFlow.totals.operatingCents).toBe('1300000');
    expect(cashFlow.totals.netIncreaseCents).toBe('1300000');
    expect(cashFlow.totals.openingCashCents).toBe('5000000');
    expect(cashFlow.totals.closingCashCents).toBe('6300000');
    expect(cashFlow.ties.current).toBe(true);
  });

  it('presents the change in equity by component', () => {
    const equity = payload.statements.changesInEquity;
    const capital = equity.rows.find((row) => row.key === 'EQUITY:3000');
    expect(capital?.openingCents).toBe('12500000');
    expect(capital?.closingCents).toBe('12500000');
    expect(equity.rows.find((row) => row.key === 'RESULT_FOR_PERIOD')?.closingCents).toBe(
      '1550000',
    );
    expect(equity.totals.closingCents).toBe('16050000');
  });

  it('produces a trial balance whose columns each agree', () => {
    const tb = payload.schedules.trialBalance;
    expect(tb.ties).toBe(true);
    expect(tb.totals.closingDebitCents).toBe(tb.totals.closingCreditCents);
    expect(tb.totals.openingDebitCents).toBe(tb.totals.openingCreditCents);
    // Every debit ever posted: opening 170,000 + July 77,500 = 247,500.
    expect(cents(tb.totals.closingDebitCents)).toBe(24_750_000n);
  });

  it('reconciles the debtor statement to the receivable control account', () => {
    const receivables = payload.schedules.receivables;
    expect(receivables.controlCents).toBe('2500000');
    expect(receivables.totalCents).toBe('2500000');
    expect(receivables.unallocatedCents).toBe('0');
    expect(receivables.differenceCents).toBe('0');
    expect(receivables.rows).toHaveLength(1);
    expect(receivables.rows[0].name).toBe('Wanjiku Kamau');
    // The 25,000 received on 12 July settles the 1 June balance first (FIFO),
    // leaving 25,000 from the 5 July invoice, which is 26 days old at 31 July.
    expect(receivables.rows[0].currentCents).toBe('2500000');
    expect(receivables.rows[0].over90Cents).toBe('0');
    expect(receivables.rows[0].balanceCents).toBe('2500000');
    expect(receivables.ageingBasis).toMatch(/FIFO/);
  });

  it('reconciles the supplier statement to the payable control account', () => {
    const payables = payload.schedules.payables;
    expect(payables.controlCents).toBe('2300000');
    expect(payables.totalCents).toBe('2300000');
    expect(payables.differenceCents).toBe('0');
  });

  it('reconciles the fixed-asset register to the PPE accounts', () => {
    const fixed = payload.schedules.fixedAssets;
    expect(fixed.reconciliation.costDifferenceCents).toBe('0');
    expect(fixed.reconciliation.accumulatedDifferenceCents).toBe('0');
    expect(fixed.reconciliation.chargeDifferenceCents).toBe('0');
    expect(fixed.totals.netBookValueCents).toBe('8750000');
  });

  it('shows the cashbook with its ledger balance and bank book balance agreeing', () => {
    const cashbook = payload.schedules.cashbook;
    expect(cashbook.accounts).toHaveLength(2);
    const bank = cashbook.accounts.find((account) => account.glAccountCode === '1000');
    expect(bank?.ledgerOpeningCents).toBe('5000000');
    expect(bank?.receiptsCents).toBe('2500000');
    expect(bank?.paymentsCents).toBe('1200000');
    expect(bank?.ledgerClosingCents).toBe('6300000');
    expect(bank?.differenceCents).toBe('0');
    const petty = cashbook.accounts.find((account) => account.glAccountCode === '1010');
    expect(petty?.unmapped).toBe(true);
  });

  it('records the general ledger with a running balance that closes correctly', () => {
    const ledger = payload.schedules.generalLedger;
    const cash = ledger.accounts.find((account) => account.accountCode === '1000');
    expect(cash?.openingCents).toBe('5000000');
    expect(cash?.closingCents).toBe('6300000');
    expect(cash?.lines.at(-1)?.runningCents).toBe('6300000');
  });

  it('passes every reconciliation check', () => {
    const failures = payload.checks.filter((check) => check.status === 'FAIL');
    expect(failures).toEqual([]);
    expect(payload.readyForApproval).toBe(true);
    expect(payload.checks.find((check) => check.code === 'BALANCE_SHEET_BALANCES')?.status).toBe(
      'PASS',
    );
    expect(payload.checks.find((check) => check.code === 'CASH_FLOW_TIES')?.status).toBe('PASS');
    expect(
      payload.checks.find((check) => check.code === 'OPENING_EQUALS_PRIOR_CLOSING')?.status,
    ).toBe('WARNING');
  });
});

describe('financial statement engine — comparative period', () => {
  const payload = buildFixture({
    entries: JULY_ENTRIES,
    window: {
      periodStart: '2025-07-01',
      periodEnd: '2025-07-31',
      comparativeStart: '2025-06-01',
      comparativeEnd: '2025-06-30',
    },
  });

  it('fills prior-period columns from the ledger', () => {
    const income = payload.statements.incomeStatement;
    expect(income.totals.netResultCents).toBe('1550000');
    expect(income.totals.priorNetResultCents).toBe('2000000');
  });

  it('compares the balance sheet with the prior period end', () => {
    const bs = payload.statements.financialPosition;
    expect(bs.totals.priorAssetsCents).toBe('16000000');
    expect(bs.totals.priorEquityCents).toBe('14500000');
    expect(bs.totals.priorLiabilitiesCents).toBe('1500000');
    expect(bs.balanced.prior).toBe(true);
  });

  it('keeps the cash-flow comparative tied', () => {
    expect(payload.statements.cashFlows.ties.prior).toBe(true);
  });

  it('does not invent a comparative when none was requested', () => {
    const without = buildFixture({ entries: JULY_ENTRIES, window: JULY_WINDOW });
    expect(without.statements.financialPosition.totals.priorAssetsCents).toBeNull();
    expect(without.statements.incomeStatement.totals.priorNetResultCents).toBeNull();
    expect(without.statements.financialPosition.columns.prior).toBeNull();
  });
});

describe('financial statement engine — year-end close', () => {
  const ENTRIES: FixtureEntry[] = [
    {
      date: '2025-07-01',
      journalNumber: 'J-OPEN',
      description: 'Capital',
      lines: [
        { account: '1000', debitKes: '1000.00' },
        { account: '3000', creditKes: '1000.00' },
      ],
    },
    {
      date: '2025-09-10',
      journalNumber: 'J-2001',
      description: 'Services invoiced and received',
      lines: [
        { account: '1000', debitKes: '10000.00' },
        { account: '4000', creditKes: '10000.00' },
      ],
    },
    {
      date: '2025-12-15',
      journalNumber: 'J-2002',
      description: 'Salaries paid',
      lines: [
        { account: '5000', debitKes: '4000.00' },
        { account: '1000', creditKes: '4000.00' },
      ],
    },
    {
      date: '2026-06-30',
      journalNumber: 'J-CLOSE',
      description: 'Year-end close',
      sourceType: 'YEAR_END_CLOSE',
      lines: [
        { account: '4000', debitKes: '10000.00' },
        { account: '5000', creditKes: '4000.00' },
        { account: '3100', creditKes: '6000.00' },
      ],
    },
  ];

  const payload = buildFixture({
    entries: ENTRIES,
    window: {
      periodStart: '2025-07-01',
      periodEnd: '2026-06-30',
      comparativeStart: null,
      comparativeEnd: null,
    },
    meta: {
      frequency: 'ANNUAL',
      financialYear: '2025/2026',
      periodLabel: 'Financial year 2025/2026',
    },
    fixedAssets: [],
    depreciation: { batchChargeCents: 0n, batchesPosted: 0, byAssetCode: new Map() },
    bankBookBalanceKes: '6000.00',
  });

  it('still reports revenue and expenses after the close', () => {
    const income = payload.statements.incomeStatement;
    expect(income.totals.revenueCents).toBe('1000000');
    expect(income.totals.netResultCents).toBe('600000');
  });

  it('moves the result into retained earnings and shows the transfer', () => {
    const bs = payload.statements.financialPosition;
    const retained = bs.rows.find((row) => row.key === 'RETAINED_EARNINGS');
    expect(retained?.currentCents).toBe('600000');
    expect(bs.rows.find((row) => row.key === 'RESULT_FOR_PERIOD')?.currentCents).toBe('600000');
    expect(bs.rows.find((row) => row.key === 'RESULT_TRANSFER')?.currentCents).toBe('-600000');
    expect(bs.rows.find((row) => row.key === 'ACCUMULATED_RESULTS_TOTAL')?.currentCents).toBe('0');
    // Capital 1,000.00 + retained earnings 6,000.00
    expect(bs.totals.equityCents).toBe('700000');
    expect(bs.balanced.current).toBe(true);
  });

  it('does not double count the result in the equity statement', () => {
    const equity = payload.statements.changesInEquity;
    expect(equity.totals.closingCents).toBe('700000');
    expect(equity.rows.find((row) => row.key === 'RESULT_FOR_PERIOD')?.resultCents).toBe('600000');
    expect(equity.rows.find((row) => row.key === 'RESULT_TRANSFER')?.transfersCents).toBe(
      '-600000',
    );
    expect(equity.rows.find((row) => row.key === 'EQUITY:3100')?.transfersCents).toBe('600000');
  });

  it('keeps the cash flow tied when a close journal exists', () => {
    const cashFlow = payload.statements.cashFlows;
    // 1,000 capital introduced + 10,000 received − 4,000 paid = 7,000.
    expect(cashFlow.totals.netIncreaseCents).toBe('700000');
    expect(cashFlow.totals.closingCashCents).toBe('700000');
    expect(cashFlow.ties.current).toBe(true);
  });
});

describe('financial statement engine — classification honesty', () => {
  const ENTRIES: FixtureEntry[] = [
    ...JULY_ENTRIES,
    {
      date: '2025-07-15',
      journalNumber: 'J-1099',
      description: 'Unmapped asset purchase',
      lines: [
        { account: '1900', debitKes: '5000.00' },
        {
          account: '2000',
          creditKes: '5000.00',
          supplierId: 3,
          supplierName: 'Nyeri Medical Supplies',
        },
      ],
    },
  ];

  const payload = buildFixture({
    entries: ENTRIES,
    window: JULY_WINDOW,
    extraAccounts: [
      { code: '1900', name: 'Deposits with suppliers', type: 'ASSET', subType: 'SOMETHING_NEW' },
    ],
    bankBookBalanceKes: '63000.00',
  });

  it('shows an explicit unclassified row and keeps the balance sheet balanced', () => {
    const bs = payload.statements.financialPosition;
    expect(bs.totals.assetsCents).toBe('18850000');
    expect(bs.balanced.current).toBe(true);
    const residual = bs.rows.find((row) => row.key === 'UNCLASSIFIED_ASSET');
    expect(residual?.currentCents).toBe('500000');
  });

  it('blocks approval rather than hiding the unmapped account', () => {
    expect(payload.classification.unclassified.map((entry) => entry.accountCode)).toEqual(['1900']);
    const check = payload.checks.find((entry) => entry.code === 'ACCOUNTS_CLASSIFIED');
    expect(check?.status).toBe('FAIL');
    expect(payload.readyForApproval).toBe(false);
  });

  it('reports the cash-flow residual instead of plugging another line', () => {
    const cashFlow = payload.statements.cashFlows;
    expect(cashFlow.ties.current).toBe(true);
    const residual = cashFlow.rows.find((row) => row.key === 'UNCLASSIFIED_MOVEMENTS');
    expect(residual?.currentCents).toBe('-500000');
  });

  it('honours a valid presentation override', () => {
    const accounts = [
      ...ACCOUNTS,
      {
        code: '1900',
        name: 'Deposits with suppliers',
        type: 'ASSET' as const,
        subType: 'SOMETHING_NEW',
      },
    ];
    const id = accounts.findIndex((account) => account.code === '1900') + 1;
    const overridden = buildFixture({
      entries: ENTRIES,
      window: JULY_WINDOW,
      extraAccounts: [
        { code: '1900', name: 'Deposits with suppliers', type: 'ASSET', subType: 'SOMETHING_NEW' },
      ],
      overrides: new Map([[id, 'PREPAYMENT']]),
    });
    expect(overridden.classification.unclassified).toEqual([]);
    expect(overridden.checks.find((entry) => entry.code === 'ACCOUNTS_CLASSIFIED')?.status).toBe(
      'PASS',
    );
    expect(
      overridden.statements.financialPosition.rows.some((row) => row.key === 'PREPAYMENT'),
    ).toBe(true);
  });

  it('ignores an override that puts a liability on the asset side', () => {
    const accounts = [
      ...ACCOUNTS,
      {
        code: '1900',
        name: 'Deposits with suppliers',
        type: 'ASSET' as const,
        subType: 'SOMETHING_NEW',
      },
    ];
    const id = accounts.findIndex((account) => account.code === '1900') + 1;
    const overridden = buildFixture({
      entries: ENTRIES,
      window: JULY_WINDOW,
      extraAccounts: [
        { code: '1900', name: 'Deposits with suppliers', type: 'ASSET', subType: 'SOMETHING_NEW' },
      ],
      overrides: new Map([[id, 'PAYABLES']]),
    });
    expect(overridden.classification.invalidOverrides.map((entry) => entry.accountCode)).toEqual([
      '1900',
    ]);
    expect(overridden.readyForApproval).toBe(false);
  });
});

describe('financial statement engine — recorded discrepancies stay visible', () => {
  it('reports a bank book balance that disagrees with the ledger', () => {
    const payload = buildFixture({
      entries: JULY_ENTRIES,
      window: JULY_WINDOW,
      bankBookBalanceKes: '61000.00',
    });
    const check = payload.checks.find((entry) => entry.code === 'BANK_BOOK_BALANCE');
    expect(check?.status).toBe('FAIL');
    expect(check?.differenceCents).toBe('200000');
    expect(payload.statements.financialPosition.balanced.current).toBe(true);
  });

  it('reports a fixed-asset register that disagrees with the ledger', () => {
    const payload = buildFixture({
      entries: JULY_ENTRIES,
      window: JULY_WINDOW,
      fixedAssets: [
        {
          assetCode: 'FA-001',
          assetName: 'Ultrasound scanner',
          category: 'Medical equipment',
          acquisitionDate: '2024-07-01',
          status: 'ACTIVE',
          costCents: 90_000_00n,
          accumulatedCents: 12_500_00n,
          netBookValueCents: 77_500_00n,
        },
      ],
    });
    const check = payload.checks.find((entry) => entry.code === 'FIXED_ASSET_REGISTER_AGREES');
    expect(check?.status).toBe('FAIL');
    expect(check?.differenceCents).toBe('1000000');
    expect(payload.readyForApproval).toBe(false);
  });

  it('reports depreciation that disagrees with the posted batches as a warning', () => {
    const payload = buildFixture({
      entries: JULY_ENTRIES,
      window: JULY_WINDOW,
      depreciation: { batchChargeCents: 2_000_00n, batchesPosted: 1, byAssetCode: new Map() },
    });
    const check = payload.checks.find((entry) => entry.code === 'DEPRECIATION_AGREES');
    expect(check?.status).toBe('WARNING');
    expect(check?.differenceCents).toBe('50000');
  });

  it('never reports a result the ledger does not contain', () => {
    const payload = buildFixture({ entries: JULY_ENTRIES, window: JULY_WINDOW });
    const income = payload.statements.incomeStatement;
    expect(income.totals.netResultCents).toBe('1550000');
    expect(income.totals.taxExpenseCents).toBe('0');
    expect(income.rows.some((row) => row.key === 'TAX')).toBe(false);
  });
});

describe('financial period resolution', () => {
  it('derives a July financial year without assuming January', () => {
    const fy = financialYear(2025, 7);
    expect(fy.start).toBe('2025-07-01');
    expect(fy.end).toBe('2026-06-30');
    expect(fy.label).toBe('2025/2026');
  });

  it('labels a January financial year with a single year', () => {
    const fy = financialYear(2026, 1);
    expect(fy.start).toBe('2026-01-01');
    expect(fy.end).toBe('2026-12-31');
    expect(fy.label).toBe('2026');
  });

  it('places a date in the right financial year', () => {
    expect(financialYearFor('2026-03-15', 7).label).toBe('2025/2026');
    expect(financialYearFor('2026-07-01', 7).label).toBe('2026/2027');
    expect(financialYearFor('2026-03-15', 1).label).toBe('2026');
  });

  it('resolves a monthly period inside the financial year', () => {
    const period = resolvePeriod({ frequency: 'MONTHLY', startYear: 2025, month: 9 }, 7);
    expect(period.start).toBe('2025-09-01');
    expect(period.end).toBe('2025-09-30');
    expect(period.financialYear).toBe('2025/2026');
  });

  it('places a calendar month in the correct calendar year of a July financial year', () => {
    // March 2026, not March 2025, is the March of the 2025/2026 year.
    const period = resolvePeriod({ frequency: 'MONTHLY', startYear: 2025, month: 3 }, 7);
    expect(period.start).toBe('2026-03-01');
    expect(period.end).toBe('2026-03-31');
    expect(() => resolvePeriod({ frequency: 'MONTHLY', startYear: 2025, month: 13 }, 7)).toThrow(
      /between 1 and 12/i,
    );
  });

  it('resolves quarters from the financial year start, not the calendar', () => {
    const q1 = resolvePeriod({ frequency: 'QUARTERLY', startYear: 2025, quarter: 1 }, 7);
    expect(q1.start).toBe('2025-07-01');
    expect(q1.end).toBe('2025-09-30');
    const q3 = resolvePeriod({ frequency: 'QUARTERLY', startYear: 2025, quarter: 3 }, 7);
    expect(q3.start).toBe('2026-01-01');
    expect(q3.end).toBe('2026-03-31');
  });

  it('rejects a custom period that spans two financial years', () => {
    expect(() =>
      resolvePeriod({ frequency: 'CUSTOM', startDate: '2025-11-01', endDate: '2026-08-31' }, 7),
    ).toThrow(/outside the financial year/i);
  });

  it('computes a prior-year comparative', () => {
    const period = resolvePeriod({ frequency: 'ANNUAL', startYear: 2025 }, 7);
    const comparative = resolveComparative(period, 'PRIOR_YEAR');
    expect(comparative.range).toEqual({ start: '2024-07-01', end: '2025-06-30' });
  });

  it('computes the prior month for a monthly period', () => {
    expect(
      priorPeriodRange(resolvePeriod({ frequency: 'MONTHLY', startYear: 2025, month: 8 }, 7)),
    ).toEqual({
      start: '2025-07-01',
      end: '2025-07-31',
    });
    // August is month 2 of a July year; February is month 8 and its "prior
    // month" is January of the following calendar year.
    expect(
      priorPeriodRange(resolvePeriod({ frequency: 'MONTHLY', startYear: 2025, month: 2 }, 7)),
    ).toEqual({
      start: '2026-01-01',
      end: '2026-01-31',
    });
  });
});
