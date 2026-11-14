// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  sprint: {
    accountingOverview: vi.fn(),
    createAccount: vi.fn(),
    createPeriod: vi.fn(),
    closePeriod: vi.fn(),
    postJournal: vi.fn(),
    reverseJournal: vi.fn(),
  },
  context: {
    currentFacility: {
      id: 51,
      name: 'Synthetic facility',
      enabledModules: ['accounting', 'payroll', 'finance'],
      hiddenModules: [] as string[],
    },
    authenticatedUser: {
      id: 7,
      isSuperAdmin: false,
      roles: [] as string[],
      permissions: [] as string[],
    },
    showToast: vi.fn(),
    setActiveModule: vi.fn(),
  },
  openPayroll: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client-sprint.client.ts', () => ({ sprintApi: mocks.sprint }));
vi.mock('../../api/client.ts', () => ({ getSessionToken: () => null }));
vi.mock('../../components/modules/ExpenseApprovalPanel.tsx', () => ({
  ExpenseApprovalPanel: ({ canApproveAndPost }: { canApproveAndPost: boolean }) => (
    <div>Existing expense review: {String(canApproveAndPost)}</div>
  ),
}));
vi.mock('../../components/modules/PaymentSettlementWork.tsx', () => ({
  PaymentSettlementWork: () => (
    <div>Existing settlement review — recorded receipt is not proof of settlement</div>
  ),
}));
vi.mock('../../components/modules/BillingJournalPostingPanel.tsx', () => ({
  BillingJournalPostingPanel: () => <div>Existing reviewed billing posting</div>,
}));
vi.mock('../../components/modules/payroll/PayrollReadiness.tsx', () => ({
  PayrollReadinessPanel: () => <div>Existing payroll readiness and missing mapping checks</div>,
}));
import { AccountingModule } from '../../components/modules/AccountingModule.tsx';
import { ACCOUNTING_SECTIONS } from '../../components/modules/accounting/AccountingNavigation.tsx';

const overview = {
  accounts: [
    {
      accountId: 11,
      accountCode: 'LOCAL-X',
      accountName: 'Synthetic cash',
      accountType: 'ASSET',
      debitKes: '21.00',
      creditKes: '0.00',
    },
    {
      accountId: 12,
      accountCode: 'LOCAL-R',
      accountName: 'Synthetic revenue',
      accountType: 'REVENUE',
      debitKes: '0.00',
      creditKes: '21.00',
    },
  ],
  periods: [
    {
      id: 9,
      periodCode: 'SYNTH',
      name: 'Synthetic period',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    },
  ],
  journals: [
    {
      id: 8,
      journalNumber: 'SYNTH-J1',
      entryDate: '2026-10-01',
      description: 'Synthetic posting',
      status: 'POSTED',
      reversalOfJournalId: null,
    },
  ],
  trialBalance: { debitKes: '21.00', creditKes: '21.00', balanced: true },
  profitAndLoss: { postedRevenueKes: '21.00', postedExpensesKes: '3.00', ledgerResultKes: '18.00' },
  balanceSheet: {
    asOf: '2026-10-27',
    assetsKes: '21.00',
    liabilitiesKes: '3.00',
    equityIncludingAccumulatedResultKes: '18.00',
    balanced: true,
  },
  limitations: { notice: 'Synthetic posted journals only.' },
};
const permissions = [
  'accounting.read',
  'billing.read',
  'payroll.read',
  'bank_payments.read',
  'accounting.coa.manage',
  'accounting.periods.close',
  'accounting.journals.post',
  'accounting.expenses.approve',
];
const click = async (name: string) => userEvent.click(screen.getByRole('button', { name }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.authenticatedUser.permissions = [...permissions];
  mocks.context.authenticatedUser.isSuperAdmin = false;
  mocks.context.currentFacility.hiddenModules = [];
  mocks.sprint.accountingOverview.mockResolvedValue(overview);
  mocks.sprint.createAccount.mockResolvedValue({});
  mocks.sprint.createPeriod.mockResolvedValue({});
  mocks.sprint.closePeriod.mockResolvedValue({});
  mocks.sprint.postJournal.mockResolvedValue({});
  mocks.sprint.reverseJournal.mockResolvedValue({});
});
afterEach(cleanup);

describe('Accounting & Finance modular workspace', () => {
  it('starts with API-backed summary, not an endless mixed workflow screen', async () => {
    render(<AccountingModule />);
    expect(await screen.findByText('KES 21.00')).toBeTruthy();
    expect(screen.getByText('KES 3.00')).toBeTruthy();
    expect(screen.getByText('Balanced')).toBeTruthy();
    expect(screen.getByText(/verified unpaid-payables aggregate is not available/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review first page' })).toBeNull();
    expect(screen.queryByLabelText('Account code')).toBeNull();
    expect(screen.queryByText('Existing expense review: true')).toBeNull();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Accounting & Finance navigation' }),
      ).getAllByRole('button'),
    ).toHaveLength(8);
  });
  it('opens setup directly, then periods and existing payroll mapping checks', async () => {
    render(<AccountingModule onOpenPayroll={mocks.openPayroll} />);
    await click('Accounting Setup');
    expect(await screen.findByText('LOCAL-X')).toBeTruthy();
    expect(screen.getByLabelText('Account code')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review first page' })).toBeNull();
    await click('Financial Periods');
    expect(screen.getByLabelText('Period code')).toBeTruthy();
    expect(screen.queryByLabelText('Account code')).toBeNull();
    await click('Payroll Account Mapping');
    expect(screen.getByText(/Existing payroll readiness and missing mapping checks/)).toBeTruthy();
    await click('Open payroll account mappings');
    expect(mocks.openPayroll).toHaveBeenCalledWith('accounts');
  });
  it('keeps account creation, period open and close on their existing API methods', async () => {
    const user = userEvent.setup();
    render(<AccountingModule />);
    await screen.findByText('KES 21.00');
    await click('Accounting Setup');
    await user.type(screen.getByLabelText('Account code'), 'AP-S');
    await user.type(screen.getByLabelText('Account name'), 'Synthetic payable');
    await user.type(screen.getByLabelText('Account subtype'), 'PAYABLE');
    await click('Create account');
    await waitFor(() =>
      expect(mocks.sprint.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ facilityId: 51, accountCode: 'AP-S' }),
      ),
    );
    await click('Financial Periods');
    await user.type(screen.getByLabelText('Period code'), 'NEXT');
    await user.type(screen.getByLabelText('Period name'), 'Synthetic next');
    await user.type(screen.getByLabelText('Start date'), '2027-01-01');
    await user.type(screen.getByLabelText('End date'), '2027-12-31');
    await click('Open period');
    await waitFor(() =>
      expect(mocks.sprint.createPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ facilityId: 51, periodCode: 'NEXT' }),
      ),
    );
    await user.type(screen.getByLabelText('Closing note'), 'Reviewed synthetic period');
    await click('Close');
    await waitFor(() =>
      expect(mocks.sprint.closePeriod).toHaveBeenCalledWith(9, {
        facilityId: 51,
        notes: 'Reviewed synthetic period',
      }),
    );
  });
  it('keeps manual journal and controlled reversal payloads and idempotency keys', async () => {
    const user = userEvent.setup();
    render(<AccountingModule />);
    await screen.findByText('KES 21.00');
    await click('General Ledger');
    expect(screen.getByText('SYNTH-J1')).toBeTruthy();
    await user.type(screen.getByLabelText('Entry date'), '2026-10-01');
    await user.type(screen.getByLabelText('Journal description'), 'Synthetic journal');
    await user.selectOptions(screen.getByLabelText('Debit account'), '11');
    await user.selectOptions(screen.getByLabelText('Credit account'), '12');
    await user.type(screen.getByLabelText('Amount in KES'), '7.50');
    await click('Post journal');
    await waitFor(() =>
      expect(mocks.sprint.postJournal).toHaveBeenCalledWith(
        {
          facilityId: 51,
          entryDate: '2026-10-01',
          description: 'Synthetic journal',
          lines: [
            { accountId: 11, debitKes: '7.50' },
            { accountId: 12, creditKes: '7.50' },
          ],
        },
        expect.any(String),
      ),
    );
    await click('Controlled Reversals');
    await user.selectOptions(screen.getByLabelText('Journal to reverse'), '8');
    await user.type(screen.getByLabelText('Reversal date in an open period'), '2026-10-02');
    await user.type(screen.getByLabelText('Reversal reason'), 'Synthetic correction');
    await click('Post reversal');
    await waitFor(() =>
      expect(mocks.sprint.reverseJournal).toHaveBeenCalledWith(
        8,
        { facilityId: 51, entryDate: '2026-10-02', reason: 'Synthetic correction' },
        expect.any(String),
      ),
    );
  });
  it('shows only the selected financial report with posted-journal limitations', async () => {
    render(<AccountingModule />);
    await screen.findByText('KES 21.00');
    await click('Financial Reports');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByText(/Assets KES/)).toBeNull();
    await click('Income Statement');
    expect(screen.getByText('Ledger result KES 18.00')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await click('Balance Sheet');
    expect(screen.getByText('Assets KES 21.00')).toBeTruthy();
    expect(screen.queryByText('Ledger result KES 18.00')).toBeNull();
    expect(screen.getByText(/A balanced statement is not proof of reconciliation/)).toBeTruthy();
  });
  it('mounts the existing billing and expense panels only in their selected views', async () => {
    render(<AccountingModule />);
    await click('Billing & Revenue Accounting');
    expect(screen.getByRole('button', { name: 'Review first page' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check coverage' })).toBeNull();
    await click('Receipt & Refund Settlement');
    expect(screen.getByText(/Existing settlement review/)).toBeTruthy();
    await click('Reviewed Billing Posting');
    expect(screen.getByText('Existing reviewed billing posting')).toBeTruthy();
    await click('Expenses & Payables');
    expect(screen.getByText('Existing expense review: true')).toBeTruthy();
    expect(screen.queryByText('Existing reviewed billing posting')).toBeNull();
    await click('Outstanding Payables');
    expect(screen.getByText(/not a verified unpaid balance/)).toBeTruthy();
  });
  it('links every payroll destination and the existing bank module without duplicate implementations', async () => {
    render(<AccountingModule onOpenPayroll={mocks.openPayroll} />);
    await click('Payroll Accounting');
    for (const [label, tab] of [
      ['Employee payroll', 'staff'],
      ['Payroll periods', 'runs'],
      ['Statutory rules', 'rules'],
      ['Payroll account mappings', 'accounts'],
      ['Payroll calculations', 'runs'],
      ['Payslips', 'runs'],
      ['Payroll accounting postings', 'runs'],
    ]) {
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }));
      expect(mocks.openPayroll).toHaveBeenLastCalledWith(tab);
    }
    await click('Banking & Reconciliation');
    await click('Open Bank Payments & Reconciliation');
    expect(mocks.context.setActiveModule).toHaveBeenCalledWith('payment_transactions');
    expect(screen.getByText(/No live bank collection/)).toBeTruthy();
    expect(new Set(ACCOUNTING_SECTIONS.map((x) => x.id)).size).toBe(8);
  });
  it('gates read-only operations, billing, payroll and bank destinations by permission', async () => {
    mocks.context.authenticatedUser.permissions = ['accounting.read'];
    render(<AccountingModule onOpenPayroll={mocks.openPayroll} />);
    await screen.findByText('KES 21.00');
    expect(screen.queryByRole('button', { name: 'Billing & Revenue Accounting' })).toBeNull();
    await click('Accounting Setup');
    expect(screen.queryByLabelText('Account code')).toBeNull();
    await click('Payroll Account Mapping');
    expect(screen.queryByText(/Existing payroll readiness/)).toBeNull();
    await click('General Ledger');
    expect(screen.queryByRole('button', { name: 'Post journal' })).toBeNull();
    await click('Controlled Reversals');
    expect(screen.queryByRole('button', { name: 'Post reversal' })).toBeNull();
    await click('Banking & Reconciliation');
    expect(
      (
        screen.getByRole('button', {
          name: 'Open Bank Payments & Reconciliation',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await click('Expenses & Payables');
    expect(screen.getByText('Existing expense review: false')).toBeTruthy();
  });
  it('respects facility module visibility even when payroll/bank permissions exist', async () => {
    mocks.context.currentFacility.hiddenModules = ['payroll', 'finance'];
    render(<AccountingModule onOpenPayroll={mocks.openPayroll} />);
    await click('Payroll Accounting');
    expect(
      (screen.getByRole('button', { name: /^Employee payroll/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await click('Banking & Reconciliation');
    expect(
      (
        screen.getByRole('button', {
          name: 'Open Bank Payments & Reconciliation',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it('does not load accounting data without read permission or for platform accounts', () => {
    mocks.context.authenticatedUser.permissions = [];
    const { unmount } = render(<AccountingModule />);
    expect(mocks.sprint.accountingOverview).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation')).toBeNull();
    unmount();
    mocks.context.authenticatedUser.permissions = [...permissions];
    mocks.context.authenticatedUser.isSuperAdmin = true;
    render(<AccountingModule />);
    expect(mocks.sprint.accountingOverview).not.toHaveBeenCalled();
  });
  it('reports API failure without fabricated zero-valued cards or stale figures', async () => {
    mocks.sprint.accountingOverview.mockRejectedValue(new Error('Synthetic unavailable'));
    render(<AccountingModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic unavailable');
    expect(screen.queryByText('KES 0.00')).toBeNull();
    expect(screen.queryByText('KES 21.00')).toBeNull();
  });
});
