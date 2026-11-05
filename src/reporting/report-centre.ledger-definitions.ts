import type { ReportEngineDefinition } from './report-centre.types.ts';

const common = {
  module: 'accounting',
  permissions: ['reports.read', 'accounting.read'],
  exportPermissions: ['accounting.reports.export'],
  fixedCurrency: 'KES',
  searchLabel: 'Search posted account code or name',
} as const;
const ledgerNotes = [
  'Only posted, facility-scoped journal lines are included; reversals are separate posted entries. Out-of-scope or inconsistent references are excluded and require review.',
  'Billing, payments, claims and costs may not be posted or reconciled. These views are not complete, certified financial statements.',
  'The underlying journal service records KES cents. Summaries follow the selected account search; a filtered subset is not a complete statement.',
] as const;

export const LEDGER_REPORT_ENGINES = {
  'ledger-trial-movements': {
    ...common,
    id: 'ledger-trial-movements',
    title: 'Posted journal account movements',
    description: 'Debit and credit movements recorded on posted journals, grouped by account.',
    dateLabel: 'Journal entry date',
    columns: [
      { key: 'code', label: 'Account code' },
      { key: 'account', label: 'Account' },
      { key: 'type', label: 'Account type' },
      { key: 'debits', label: 'Posted debits', kind: 'money' },
      { key: 'credits', label: 'Posted credits', kind: 'money' },
      { key: 'netDebit', label: 'Net debit movement', kind: 'money' },
      { key: 'netCredit', label: 'Net credit movement', kind: 'money' },
    ],
    notes: [
      'A date range shows movements in that period, without an opening balance; it is not an as-of trial balance.',
      'Without a range, all posted journal dates are included, including any future-dated postings.',
      ...ledgerNotes,
    ],
  },
  'ledger-income': {
    ...common,
    id: 'ledger-income',
    title: 'Posted ledger income and expense accounts',
    description:
      'Posted revenue and expense account movements; unposted revenue and costs are not included.',
    dateLabel: 'Journal entry date',
    columns: [
      { key: 'code', label: 'Account code' },
      { key: 'account', label: 'Account' },
      { key: 'type', label: 'Account type' },
      { key: 'normalAmount', label: 'Posted net in category direction', kind: 'money' },
    ],
    notes: [
      'Revenue uses credits less debits; expense uses debits less credits. Negative amounts are preserved.',
      'Without a range, all posted journal dates are included, including any future-dated postings.',
      ...ledgerNotes,
    ],
  },
  'ledger-balance-sheet': {
    ...common,
    id: 'ledger-balance-sheet',
    title: 'Posted ledger balances as of date',
    description: 'Balances from posted journal entries through the selected as-of date.',
    dateLabel: 'As-of date',
    dateMode: 'asOf',
    columns: [
      { key: 'code', label: 'Account code' },
      { key: 'account', label: 'Account' },
      { key: 'type', label: 'Account type' },
      { key: 'normalAmount', label: 'Posted net in category direction', kind: 'money' },
    ],
    notes: [
      'Revenue and expense accounts are included to show their contribution to the posted accumulated result; formal closing entries require accounting review.',
      'Assets and expenses use debits less credits; liabilities, equity and revenue use credits less debits.',
      ...ledgerNotes,
    ],
  },
} satisfies Record<string, ReportEngineDefinition>;
