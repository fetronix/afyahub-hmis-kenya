// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  paymentSettlements: vi.fn(),
  settlementAccounts: vi.fn(),
  retryPaymentSettlement: vi.fn(),
}));
vi.mock('../../api/client-sprint.client.ts', () => ({ sprintApi: api }));
import { PaymentSettlementWork } from '../../components/modules/PaymentSettlementWork.tsx';

beforeEach(() => {
  vi.resetAllMocks();
  api.paymentSettlements.mockResolvedValue({
    sources: [
      {
        sourceType: 'BILLING_PAYMENT',
        sourceId: 4,
        paymentId: 4,
        invoiceId: 9,
        amountKes: '20.00',
        recordNumber: 'SYN-RECEIPT',
        method: 'Cash',
        createdAt: '2026-11-06T00:00:00Z',
        party: 'PATIENT',
        status: 'SUCCESS_AWAITING_SETTLEMENT',
        reviewCode: null,
        journalId: null,
        journalNumber: null,
        reversalJournalId: null,
      },
    ],
    next: null,
    notice: 'Manual receipt; not provider evidence.',
  });
  api.settlementAccounts.mockResolvedValue({
    accounts: [
      { id: 3, accountCode: 'CASH', accountName: 'Synthetic clearing', accountType: 'ASSET' },
      { id: 5, accountCode: 'CREDIT', accountName: 'Synthetic credit', accountType: 'LIABILITY' },
    ],
    nextAfterId: null,
  });
  api.retryPaymentSettlement.mockResolvedValue({
    journal: { id: 44, journalNumber: 'SYN-JOURNAL' },
    idempotentReplay: false,
    reversed: false,
  });
});

describe('facility settlement work interface', () => {
  it('shows scoped work but does not offer posting to read-only staff', async () => {
    render(<PaymentSettlementWork facilityId={11} canPost={false} onPosted={() => undefined} />);
    expect(await screen.findByText(/SYN-RECEIPT/)).toBeInTheDocument();
    expect(screen.getByText(/not provider verification/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review posting/ })).not.toBeInTheDocument();
    expect(api.paymentSettlements).toHaveBeenCalledWith(11, 'UNRESOLVED', undefined);
  });

  it('browses actual active accounts and sends a reviewed scoped posting', async () => {
    const user = userEvent.setup();
    const posted = vi.fn();
    render(<PaymentSettlementWork facilityId={11} canPost onPosted={posted} />);
    await user.click(
      await screen.findByRole('button', { name: 'Review posting BILLING_PAYMENT 4' }),
    );
    await screen.findByRole('option', { name: /CASH.*Synthetic clearing/ });
    expect(api.settlementAccounts).toHaveBeenCalledWith(11, '', 0);
    await user.selectOptions(screen.getByLabelText('Settlement asset account'), '3');
    await user.selectOptions(screen.getByLabelText('Credit liability account, if applicable'), '5');
    await user.type(screen.getByLabelText('Settlement entry date'), '2026-11-06');
    await user.type(screen.getByLabelText('Settlement description'), 'Synthetic review');
    await user.click(screen.getByRole('button', { name: 'Post reviewed settlement journal' }));
    await waitFor(() =>
      expect(api.retryPaymentSettlement).toHaveBeenCalledWith('BILLING_PAYMENT', 4, {
        facilityId: 11,
        entryDate: '2026-11-06',
        description: 'Synthetic review',
        settlementAccountId: 3,
        liabilityAccountId: 5,
      }),
    );
    expect(await screen.findByText(/Journal SYN-JOURNAL posted/)).toBeInTheDocument();
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it('locks the review and filter while the posting outcome is pending', async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    api.retryPaymentSettlement.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<PaymentSettlementWork facilityId={11} canPost onPosted={() => undefined} />);
    await user.click(
      await screen.findByRole('button', { name: 'Review posting BILLING_PAYMENT 4' }),
    );
    await screen.findByRole('option', { name: /CASH.*Synthetic clearing/ });
    await user.selectOptions(screen.getByLabelText('Settlement asset account'), '3');
    await user.type(screen.getByLabelText('Settlement entry date'), '2026-11-06');
    await user.type(screen.getByLabelText('Settlement description'), 'Synthetic review');
    await user.click(screen.getByRole('button', { name: 'Post reviewed settlement journal' }));
    expect(screen.getByLabelText('Settlement source filter')).toBeDisabled();
    expect(screen.getByLabelText('Settlement asset account')).toBeDisabled();
    expect(screen.getByLabelText('Settlement description')).toBeDisabled();
    await act(async () =>
      finish({
        journal: { id: 44, journalNumber: 'SYN-JOURNAL' },
        idempotentReplay: false,
        reversed: false,
      }),
    );
    expect(await screen.findByText(/Journal SYN-JOURNAL posted/)).toBeInTheDocument();
    expect(screen.getByLabelText('Settlement source filter')).not.toBeDisabled();
  });

  it('does not offer reposting a reversed journal', async () => {
    api.paymentSettlements.mockResolvedValueOnce({
      sources: [
        {
          sourceType: 'BILLING_PAYMENT',
          sourceId: 4,
          paymentId: 4,
          invoiceId: 9,
          amountKes: '20.00',
          recordNumber: 'SYN-RECEIPT',
          method: 'Cash',
          createdAt: '2026-11-06T00:00:00Z',
          party: 'PATIENT',
          status: 'REVERSED',
          reviewCode: 'JOURNAL_REVERSED',
          journalId: 44,
          journalNumber: 'SYN',
          reversalJournalId: 45,
        },
      ],
      next: null,
      notice: 'Reversal requires review.',
    });
    render(<PaymentSettlementWork facilityId={11} canPost onPosted={() => undefined} />);
    expect(await screen.findByText(/reversal #45/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review posting/ })).not.toBeInTheDocument();
  });
});
