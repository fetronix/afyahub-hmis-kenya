// @vitest-environment jsdom
/**
 * Accounting screen: source-to-ledger coverage.
 *
 * Verifies that the panel is only offered to someone who may read both
 * accounting and billing, that every figure the API returns is rendered
 * (including unposted and reversed counts), and that an API failure is shown
 * instead of a stale "complete" claim.
 *
 * The API client and context are mocked; every value is synthetic.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  sprint: {
    accountingOverview: vi.fn(),
    billingGlReconciliation: vi.fn(),
    billingLedgerReview: vi.fn(),
    billingJournalExceptions: vi.fn(),
    sourceLedgerCoverage: vi.fn(),
    expenseReviewPage: vi.fn(),
    paymentSettlements: vi.fn(),
  },
  context: {
    currentFacility: { id: 41, name: 'Synthetic coverage office' },
    authenticatedUser: { permissions: [] as string[], isSuperAdmin: false },
    showToast: vi.fn(),
  },
}));

vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client-sprint.client.ts', () => ({ sprintApi: mocks.sprint }));
vi.mock('../../api/client.ts', () => ({ getSessionToken: () => null }));

import { AccountingModule } from '../../components/modules/AccountingModule.tsx';

const overview = {
  accounts: [],
  periods: [],
  journals: [],
  trialBalance: { debitKes: '0.00', creditKes: '0.00', balanced: true },
  profitAndLoss: {
    postedRevenueKes: '0.00',
    postedExpensesKes: '0.00',
    ledgerResultKes: '0.00',
  },
  balanceSheet: {
    asOf: '2026-10-27',
    assetsKes: '0.00',
    liabilitiesKes: '0.00',
    equityIncludingAccumulatedResultKes: '0.00',
    balanced: true,
  },
  limitations: { billingReconciliation: 'NOT_IMPLEMENTED', notice: 'Synthetic notice.' },
};

const family = (values: {
  examined: number;
  posted: number;
  unposted: number;
  reversed: number;
  amount: string;
  unpostedAmount: string;
  reversedAmount: string;
}) => values;

const gaps = {
  window: { startDate: '2026-10-01', endDate: '2026-10-27' },
  sources: {
    invoices: family({
      examined: 2,
      posted: 1,
      unposted: 1,
      reversed: 0,
      amount: '300.00',
      unpostedAmount: '100.00',
      reversedAmount: '0.00',
    }),
    receipts: family({
      examined: 1,
      posted: 0,
      unposted: 0,
      reversed: 1,
      amount: '50.00',
      unpostedAmount: '0.00',
      reversedAmount: '50.00',
    }),
    refunds: family({
      examined: 0,
      posted: 0,
      unposted: 0,
      reversed: 0,
      amount: '0.00',
      unpostedAmount: '0.00',
      reversedAmount: '0.00',
    }),
  },
  coverage: 'GAPS_FOUND' as const,
  exceptions: [
    {
      sourceType: 'BILLING_INVOICE' as const,
      sourceId: 9001,
      reference: 'INV-COVERAGE-1',
      sourceDate: '2026-10-12',
      amount: '100.00',
      reason: 'UNPOSTED' as const,
      journalId: null,
      reversedOn: null,
    },
    {
      sourceType: 'BILLING_PAYMENT' as const,
      sourceId: 9002,
      reference: 'RCP-COVERAGE-1',
      sourceDate: '2026-10-19',
      amount: '50.00',
      reason: 'REVERSED' as const,
      journalId: 512,
      reversedOn: '2026-10-20',
    },
  ],
  exceptionsTruncated: false,
  openExceptionCount: 2,
  limitations: { posting: 'MANUAL_REVIEWED', notice: 'Synthetic coverage limitation notice.' },
};

beforeEach(() => {
  mocks.sprint.accountingOverview.mockResolvedValue(overview);
  mocks.sprint.expenseReviewPage.mockResolvedValue({ expenses: [], nextAfterId: null });
  mocks.sprint.paymentSettlements.mockResolvedValue({
    sources: [],
    nextCursor: null,
    summary: { unresolved: 0, examined: 0 },
  });
  mocks.context.authenticatedUser.permissions = ['accounting.read', 'billing.read'];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('source-to-ledger coverage panel', () => {
  it('is not offered without billing read, even when accounting read is held', async () => {
    mocks.context.authenticatedUser.permissions = ['accounting.read'];
    render(<AccountingModule />);
    await screen.findByText(/accounting & finance/i);
    expect(screen.queryByText(/source-to-ledger coverage/i)).toBeNull();
  });

  it('renders every family and exception with its reason', async () => {
    mocks.sprint.sourceLedgerCoverage.mockResolvedValue(gaps);
    const user = userEvent.setup();
    render(<AccountingModule />);
    await user.click(screen.getByRole('button', { name: 'Billing & Revenue Accounting' }));
    await user.click(screen.getByRole('button', { name: 'Source-to-Ledger Coverage' }));
    await screen.findByRole('heading', { name: /source-to-ledger coverage/i });
    await user.click(screen.getByRole('button', { name: /check coverage/i }));

    await waitFor(() =>
      expect(mocks.sprint.sourceLedgerCoverage).toHaveBeenCalledWith(
        41,
        expect.any(String),
        expect.any(String),
      ),
    );
    expect(await screen.findByText(/2 source\(s\) are unposted or reversed/i)).toBeTruthy();
    expect(screen.getByText('INV-COVERAGE-1')).toBeTruthy();
    expect(screen.getByText('RCP-COVERAGE-1')).toBeTruthy();
    expect(screen.getByText('UNPOSTED')).toBeTruthy();
    expect(screen.getByText('REVERSED')).toBeTruthy();
    // The same figure appears in the family totals and in the exception row.
    expect(screen.getAllByText('100.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('50.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/synthetic coverage limitation notice/i)).toBeTruthy();
  });

  it('reports a complete range only when the API says so', async () => {
    mocks.sprint.sourceLedgerCoverage.mockResolvedValue({
      ...gaps,
      coverage: 'COMPLETE',
      exceptions: [],
      openExceptionCount: 0,
    });
    const user = userEvent.setup();
    render(<AccountingModule />);
    await user.click(screen.getByRole('button', { name: 'Billing & Revenue Accounting' }));
    await user.click(screen.getByRole('button', { name: 'Source-to-Ledger Coverage' }));
    await screen.findByRole('heading', { name: /source-to-ledger coverage/i });
    await user.click(screen.getByRole('button', { name: /check coverage/i }));
    expect(
      await screen.findByText(/every source in this range has an active reviewed journal/i),
    ).toBeTruthy();
  });

  it('surfaces an API failure instead of rendering stale figures', async () => {
    mocks.sprint.sourceLedgerCoverage.mockRejectedValue(new Error('Coverage unavailable.'));
    const user = userEvent.setup();
    render(<AccountingModule />);
    await user.click(screen.getByRole('button', { name: 'Billing & Revenue Accounting' }));
    await user.click(screen.getByRole('button', { name: 'Source-to-Ledger Coverage' }));
    await screen.findByRole('heading', { name: /source-to-ledger coverage/i });
    await user.click(screen.getByRole('button', { name: /check coverage/i }));
    const alert = await screen.findByText('Coverage unavailable.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.queryByText(/every source in this range/i)).toBeNull();
  });
});
