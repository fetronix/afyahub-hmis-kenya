// @vitest-environment jsdom
import React, { useState } from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { createFinancialBaseline } from '../../budget-planning/financial-budget.model.ts';

const mocks = vi.hoisted(() => ({
  context: {
    currentFacility: {
      id: 7,
      name: 'Synthetic facility',
      enabledModules: ['accounting'],
      hiddenModules: [],
    },
    authenticatedUser: {
      id: 9,
      isSuperAdmin: false,
      roles: ['FACILITY_ADMIN'],
      permissions: [] as string[],
    },
    showToast: vi.fn(),
    setActiveModule: vi.fn(),
  },
  overview: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  financialBudgetFile: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client-sprint.client.ts', () => ({
  sprintApi: { accountingOverview: mocks.overview },
}));
vi.mock('../../api/client.ts', () => ({ getSessionToken: () => null }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: { get: mocks.get, send: mocks.send, financialBudgetFile: mocks.financialBudgetFile },
}));
// Unrelated panels stay covered by the existing accounting workspace regression suite.
vi.mock('../../components/modules/ExpenseApprovalPanel.tsx', () => ({
  ExpenseApprovalPanel: () => <div>Existing expense panel</div>,
}));
import { AccountingModule } from '../../components/modules/AccountingModule.tsx';
import { ACCOUNTING_SECTIONS } from '../../components/modules/accounting/AccountingNavigation.tsx';
import {
  readBudgetingView,
  useBudgetingEntry,
} from '../../components/modules/accounting/accounting-budget-navigation.ts';

const permissions = [
  'accounting.read',
  'billing.read',
  'accounting.planning.read',
  'accounting.planning.manage',
  'accounting.planning.export',
];
let model = createFinancialBaseline();
let plan = {
  id: 41,
  tenant_id: 1,
  facility_id: 7,
  name: 'Existing saved 2026 draft',
  financial_year: 2026,
  currency: 'KES',
  status: 'DRAFT',
  version: 12,
  plan_type: 'ANNUAL',
  inflation_bp: 0,
};
const projection = () => ({
  plan,
  categories: [],
  items: [],
  uniforms: [],
  totalItems: 0,
  categoryTotals: [],
  summary: {
    annualCombinedCents: '0',
    selectedItemCents: '0',
    uniformAnnualCents: '0',
    blankMonths: 0,
  },
  facilityOverview: { pendingReviews: 0, imports: { pending: 0, imported: 0, cancelled: 0 } },
});
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const budgetingTabs = () =>
  screen.getByRole('navigation', { name: 'Budgeting & Financial Planning views' });
const activeTab = (name: string) => within(budgetingTabs()).getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  mocks.context.authenticatedUser.permissions = [...permissions];
  mocks.context.authenticatedUser.isSuperAdmin = false;
  model = createFinancialBaseline();
  model.rows[0].overrides['0'] = '20000';
  plan = { ...plan, version: 12 };
  mocks.overview.mockResolvedValue({
    accounts: [],
    periods: [],
    journals: [],
    trialBalance: { debitKes: '0', creditKes: '0', balanced: true },
    profitAndLoss: { postedRevenueKes: '0', postedExpensesKes: '0' },
    balanceSheet: { asOf: '2026-10-27' },
    limitations: { notice: 'Synthetic fixture' },
  });
  mocks.get.mockImplementation(async (_facility: number, path: string) => {
    if (path === '/plans') return { plans: [plan], total: 1 };
    if (path === '/plans/41/financial-budget')
      return { plan, facility: mocks.context.currentFacility, model };
    if (path === '/plans/41') return projection();
    if (path === '/imports/overview') return { recentBatches: [], counts: {}, selectedPlan: null };
    throw new Error('Unexpected fixture request: ' + path);
  });
  mocks.send.mockImplementation(
    async (_facility: number, path: string, body: { model: typeof model; version: number }) => {
      expect(path).toBe('/plans/41/financial-budget');
      expect(body.version).toBe(plan.version);
      model = body.model;
      plan = { ...plan, version: plan.version + 1 };
      return { plan, model };
    },
  );
  mocks.financialBudgetFile.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function EntryHarness({ authenticated }: { authenticated: boolean }) {
  const [active, setActive] = useState<string>('dashboard');
  useBudgetingEntry(authenticated, active, setActive);
  return (
    <>
      <output aria-label="Active module">{active}</output>
      <button onClick={() => setActive('dashboard')}>Leave accounting</button>
    </>
  );
}

describe('Budgeting navigation relocation — existing modules, unchanged data contracts', () => {
  it('opens the existing saved financial draft from the new parent with no duplicate procurement entry', async () => {
    render(<AccountingModule />);
    click('Budgeting & Financial Planning');
    await screen.findByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)');
    expect(mocks.get).toHaveBeenCalledWith(7, '/plans/41/financial-budget');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(activeTab('Annual Financial Budget')).toHaveAttribute('aria-current', 'page');
    expect(activeTab('Budget & Procurement Planning')).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('button', { name: 'Annual Financial Budget' })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Budget planning sections' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset Planning Data' })).toBeNull();
    expect(window.location.hash).toBe('#accounting/planningFinancials');
  });
  it('keeps formula editing, saved revisions and exports on the existing financial API', async () => {
    render(<AccountingModule />);
    click('Budgeting & Financial Planning');
    fireEvent.click(
      await screen.findByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)'),
    );
    const input = screen.getByLabelText('INC-01 Jan 2026');
    fireEvent.change(input, { target: { value: '21000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByLabelText('INC-01 Feb 2026: KES 31,500.00');
    expect(mocks.send).toHaveBeenCalledWith(
      7,
      '/plans/41/financial-budget',
      expect.objectContaining({ version: 12 }),
      'PUT',
    );
    click('CSV');
    click('Excel');
    expect(mocks.financialBudgetFile).toHaveBeenCalledWith(7, 41, 'csv', false);
    expect(mocks.financialBudgetFile).toHaveBeenCalledWith(7, 41, 'xlsx', false);
    fireEvent.click(screen.getByLabelText('Calculated Values View'));
    click('CSV');
    expect(mocks.financialBudgetFile).toHaveBeenLastCalledWith(7, 41, 'csv', true);
  });
  it('keeps procurement and supporting planning accessible without the financial tab or a second dataset', async () => {
    render(<AccountingModule />);
    click('Budgeting & Financial Planning');
    await screen.findByLabelText('INC-01 Feb 2026: KES 30,000.00');
    click('Budget & Procurement Planning');
    const nav = screen.getByRole('navigation', { name: 'Budget planning sections' });
    expect(within(nav).queryByRole('button', { name: 'Annual Financial Budget' })).toBeNull();
    expect(activeTab('Budget & Procurement Planning')).toHaveAttribute('aria-current', 'page');
    expect(activeTab('Annual Financial Budget')).not.toHaveAttribute('aria-current');
    fireEvent.click(within(nav).getByRole('button', { name: 'Stationery & Consumables' }));
    await screen.findByRole('table', { name: 'Stationery & Consumables table' });
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        7,
        '/plans/41',
        expect.objectContaining({ all: true }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Add First Item — Stationery' })).toBeInTheDocument();
    click('Annual Financial Budget');
    await screen.findByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('restores direct links and refresh/remount without changing saved data or selecting a facility from the URL', async () => {
    window.history.replaceState(null, '', '/#accounting/planningFinancials');
    const first = render(<AccountingModule />);
    await screen.findByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)');
    first.unmount();
    render(<AccountingModule />);
    await screen.findByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)');
    expect(activeTab('Annual Financial Budget')).toHaveAttribute('aria-current', 'page');
    expect(mocks.send).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/#accounting/planningItems');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await screen.findByRole('table', { name: 'Stationery & Consumables table' });
    expect(activeTab('Budget & Procurement Planning')).toHaveAttribute('aria-current', 'page');
  });
  it('does not grant planning access through a direct link or display the parent to unauthorized readers', async () => {
    mocks.context.authenticatedUser.permissions = ['accounting.read'];
    window.history.replaceState(null, '', '/#accounting/planningFinancials');
    render(<AccountingModule />);
    expect(screen.queryByRole('button', { name: 'Budgeting & Financial Planning' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('accounting.planning.read');
    await waitFor(() => expect(mocks.overview).toHaveBeenCalled());
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('retains read-only and export permission gates for authorized planning readers', async () => {
    mocks.context.authenticatedUser.permissions = ['accounting.read', 'accounting.planning.read'];
    render(<AccountingModule />);
    click('Budgeting & Financial Planning');
    expect(
      await screen.findByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)'),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add line item' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset baseline' })).toBeDisabled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('preserves unrelated accounting sections and removes the old setup shortcut', async () => {
    render(<AccountingModule />);
    click('Accounting Setup');
    const setup = screen.getByRole('navigation', { name: 'Accounting Setup views' });
    expect(
      within(setup).queryByRole('button', { name: 'Budget & Procurement Planning' }),
    ).toBeNull();
    expect(ACCOUNTING_SECTIONS.filter((s) => s.id !== 'budgeting').map((s) => s.title)).toEqual([
      'Accounting Dashboard',
      'Accounting Setup',
      'General Ledger',
      'Billing & Revenue Accounting',
      'Expenses & Payables',
      'Payroll Accounting',
      'Banking & Reconciliation',
      'Financial Reports',
    ]);
    const all = ACCOUNTING_SECTIONS.flatMap((s) => [...s.views]);
    expect(all.filter((v) => v.id === 'planningFinancials')).toHaveLength(1);
    expect(all.filter((v) => v.id === 'planningDashboard')).toHaveLength(1);
  });
  it('restores the top-level accounting module only after authentication and clears stale bookmarks on exit', async () => {
    window.history.replaceState(null, '', '/#accounting/planningFinancials');
    const entry = render(<EntryHarness authenticated={false} />);
    expect(screen.getByLabelText('Active module')).toHaveTextContent('dashboard');
    entry.rerender(<EntryHarness authenticated />);
    await waitFor(() =>
      expect(screen.getByLabelText('Active module')).toHaveTextContent('accounting'),
    );
    click('Leave accounting');
    expect(screen.getByLabelText('Active module')).toHaveTextContent('dashboard');
    expect(window.location.hash).toBe('');
  });
  it('handles budget bookmarks entered through browser history without hijacking unrelated hash routes', async () => {
    render(<EntryHarness authenticated />);
    window.history.replaceState(null, '', '/#unrelated');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(screen.getByLabelText('Active module')).toHaveTextContent('dashboard');
    window.history.replaceState(null, '', '/#accounting/planningDashboard');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() =>
      expect(screen.getByLabelText('Active module')).toHaveTextContent('accounting'),
    );
  });
  it('rejects unknown or malformed bookmarks and preserves ordinary nonbudget navigation', () => {
    for (const hash of [
      '#accounting/unknown',
      '#accounting/planningFinancials?facilityId=99',
      '#other/planningFinancials',
    ])
      expect(readBudgetingView(hash)).toBeNull();
    window.history.replaceState(null, '', '/#accounting/planningFinancials');
    render(<AccountingModule />);
    click('General Ledger');
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('heading', { name: 'General Ledger' })).toBeInTheDocument();
  });
});
