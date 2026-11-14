// @vitest-environment jsdom
/**
 * Accounting screen: the billing-to-ledger tie-out is only offered to someone
 * who may read both accounting and billing, and it reports differences exactly
 * as the API returns them.
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
    expenseReviewPage: vi.fn(),
    paymentSettlements: vi.fn(),
  },
  context: {
    currentFacility: { id: 33, name: 'Synthetic finance office' },
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

const tieOut = {
  asOf: '2026-10-27',
  periodStart: null,
  tieOut: [
    {
      control: 'PATIENT_RECEIVABLE',
      accounts: [],
      ledgerKes: '75.00',
      bridgeKes: '50.00',
      subledgerKes: '50.00',
      bridgeDifferenceKes: '25.00',
      subledgerDifferenceKes: '25.00',
      status: 'UNEXPLAINED',
    },
    {
      control: 'REVENUE',
      accounts: [],
      ledgerKes: '-100.00',
      bridgeKes: '-100.00',
      subledgerKes: '-100.00',
      bridgeDifferenceKes: '0.00',
      subledgerDifferenceKes: '0.00',
      status: 'TIED',
    },
  ],
  bridge: { postings: 3, reversedAsOf: 0, effective: 3, mismatchCount: 0 },
  subledger: {
    finalizedInvoices: 1,
    finalizedInvoiceTotalKes: '100.00',
    patientOutstandingKes: '50.00',
    insurerOutstandingKes: '0.00',
    creditLiabilityKes: '0.00',
    receiptsKes: '0.00',
    refundsKes: '0.00',
    unattributedReceiptsKes: '0.00',
  },
  exceptions: {
    unpostedInvoices: [],
    unpostedInvoiceKes: '0.00',
    unpostedReceipts: [],
    unpostedReceiptKes: '0.00',
    unexplainedJournals: [],
    unexplainedJournalCount: 1,
  },
  summary: {
    controlsTied: 1,
    controlsWithBacklog: 0,
    controlsUnexplained: 1,
    bridgeMismatchCount: 0,
    reconciled: false,
  },
  limitations: { notice: 'Synthetic limitation notice.' },
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

describe('billing to general ledger tie-out panel', () => {
  it('is not offered without billing read, even when accounting read is held', async () => {
    mocks.context.authenticatedUser.permissions = ['accounting.read'];
    render(<AccountingModule />);
    await screen.findByText(/accounting & finance/i);
    expect(screen.queryByText(/billing subledger to general ledger tie-out/i)).toBeNull();
  });

  it('shows every difference the API reports instead of a pass or fail badge', async () => {
    mocks.sprint.billingGlReconciliation.mockResolvedValue(tieOut);
    const user = userEvent.setup();
    render(<AccountingModule />);
    await user.click(screen.getByRole('button', { name: 'Billing & Revenue Accounting' }));
    await user.click(screen.getByRole('button', { name: 'Subledger Tie-out' }));
    await screen.findByText(/billing subledger to general ledger tie-out/i);
    await user.click(screen.getByRole('button', { name: /tie out as of end date/i }));

    await waitFor(() =>
      expect(mocks.sprint.billingGlReconciliation).toHaveBeenCalledWith(33, expect.any(String)),
    );
    expect(await screen.findByText('PATIENT RECEIVABLE')).toBeTruthy();
    expect(screen.getByText('UNEXPLAINED')).toBeTruthy();
    expect(screen.getByText('75.00')).toBeTruthy();
    expect(screen.getByText('50.00')).toBeTruthy();
    expect(screen.getByText('25.00')).toBeTruthy();
    expect(screen.getByText(/finance review is required/i)).toBeTruthy();
    expect(screen.getByText(/journals outside the bridge 1/i)).toBeTruthy();
  });

  it('surfaces an API failure instead of rendering stale figures', async () => {
    mocks.sprint.billingGlReconciliation.mockRejectedValue(new Error('Tie-out unavailable.'));
    const user = userEvent.setup();
    render(<AccountingModule />);
    await user.click(screen.getByRole('button', { name: 'Billing & Revenue Accounting' }));
    await user.click(screen.getByRole('button', { name: 'Subledger Tie-out' }));
    await screen.findByText(/billing subledger to general ledger tie-out/i);
    await user.click(screen.getByRole('button', { name: /tie out as of end date/i }));
    const alert = await screen.findByText('Tie-out unavailable.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.queryByText('PATIENT RECEIVABLE')).toBeNull();
  });
});
