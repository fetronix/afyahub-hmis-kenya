import React from 'react';
import { planningViews } from '../planning/PlanningWorkspace.tsx';
import {
  LayoutDashboard,
  Settings2,
  BookOpen,
  Receipt,
  Wallet,
  Users,
  Landmark,
  ChartNoAxesCombined,
} from 'lucide-react';

export type AccountingSection =
  'dashboard' | 'setup' | 'ledger' | 'billing' | 'expenses' | 'payroll' | 'banking' | 'reports';
export type AccountingView =
  | (typeof planningViews)[number][0]
  | 'dashboard'
  | 'chart'
  | 'periods'
  | 'mapping'
  | 'configuration'
  | 'journals'
  | 'postings'
  | 'reversal'
  | 'trial'
  | 'exceptions'
  | 'coverage'
  | 'tieout'
  | 'journalExceptions'
  | 'settlements'
  | 'billingPosting'
  | 'expenses'
  | 'payables'
  | 'payroll'
  | 'banking'
  | 'income'
  | 'balance';
export const ACCOUNTING_SECTIONS = [
  {
    id: 'dashboard',
    title: 'Accounting Dashboard',
    description: 'Posted financial activity, configuration alerts and review priorities.',
    icon: LayoutDashboard,
    views: [{ id: 'dashboard', label: 'Overview' }],
  },
  {
    id: 'setup',
    title: 'Accounting Setup',
    description: 'Manage the facility chart, accounting periods and payroll account configuration.',
    icon: Settings2,
    views: [
      { id: 'chart', label: 'Chart of Accounts' },
      { id: 'periods', label: 'Financial Periods' },
      { id: 'mapping', label: 'Payroll Account Mapping' },
      { id: 'configuration', label: 'Accounting Configuration' },
      { id: 'planningDashboard', label: 'Budget & Procurement Planning' },
    ],
  },
  {
    id: 'ledger',
    title: 'General Ledger',
    description:
      'Review posted journals and account movements, or make controlled entries and reversals.',
    icon: BookOpen,
    views: [
      { id: 'journals', label: 'Journal Entries' },
      { id: 'postings', label: 'Ledger Postings' },
      { id: 'reversal', label: 'Controlled Reversals' },
      { id: 'trial', label: 'Trial Balance' },
    ],
  },
  {
    id: 'billing',
    title: 'Billing & Revenue Accounting',
    description: 'Review source-to-ledger differences before posting approved billing sources.',
    icon: Receipt,
    views: [
      { id: 'exceptions', label: 'Billing Exceptions' },
      { id: 'coverage', label: 'Source-to-Ledger Coverage' },
      { id: 'tieout', label: 'Subledger Tie-out' },
      { id: 'journalExceptions', label: 'Journal-Side Exceptions' },
      { id: 'settlements', label: 'Receipt & Refund Settlement' },
      { id: 'billingPosting', label: 'Reviewed Billing Posting' },
    ],
  },
  {
    id: 'expenses',
    title: 'Expenses & Payables',
    description:
      'Independently review expenses and post approved payables. Posting is not payment.',
    icon: Wallet,
    views: [
      { id: 'expenses', label: 'Expense Review & Approval' },
      { id: 'payables', label: 'Outstanding Payables' },
    ],
  },
  {
    id: 'payroll',
    title: 'Payroll Accounting',
    description:
      'Open the existing payroll workspace with its readiness and approval controls intact.',
    icon: Users,
    views: [{ id: 'payroll', label: 'Payroll workspace' }],
  },
  {
    id: 'banking',
    title: 'Banking & Reconciliation',
    description:
      'Access controlled manual bank transfers, statements and reconciliation worksheets.',
    icon: Landmark,
    views: [{ id: 'banking', label: 'Banking workspace' }],
  },
  {
    id: 'reports',
    title: 'Financial Reports',
    description: 'Trial balance and financial statements based on posted journals only.',
    icon: ChartNoAxesCombined,
    views: [
      { id: 'trial', label: 'Trial Balance' },
      { id: 'income', label: 'Income Statement' },
      { id: 'balance', label: 'Balance Sheet' },
    ],
  },
] as const;

export function AccountingNavigation({
  section,
  onNavigate,
  billingAllowed,
}: {
  section: AccountingSection;
  onNavigate: (section: AccountingSection, view?: AccountingView) => void;
  billingAllowed: boolean;
}) {
  return (
    <nav
      aria-label="Accounting & Finance navigation"
      className="rounded-xl border border-hair bg-surface p-2 lg:sticky lg:top-4 lg:self-start"
    >
      <p className="px-3 py-2 text-2xs font-bold uppercase tracking-wider text-muted">
        Finance workspace
      </p>
      <label className="block px-2 pb-2 sm:hidden">
        <span className="sr-only">Accounting workspace</span>
        <select
          aria-label="Accounting workspace"
          value={section}
          onChange={(event) => onNavigate(event.target.value as AccountingSection)}
          className="w-full rounded-lg border border-hair bg-white px-3 py-3 text-sm"
        >
          {ACCOUNTING_SECTIONS.filter((item) => item.id !== 'billing' || billingAllowed).map(
            (item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ),
          )}
        </select>
      </label>
      <div className="hidden gap-1 sm:grid sm:grid-cols-2 lg:grid-cols-1">
        {ACCOUNTING_SECTIONS.filter((item) => item.id !== 'billing' || billingAllowed).map(
          (item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
              className={`flex min-w-0 items-center gap-2 rounded-lg px-3 py-3 text-left text-sm font-medium ${section === item.id ? 'bg-brand-700 text-white' : 'text-ink hover:bg-slate-100'}`}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.title}</span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
