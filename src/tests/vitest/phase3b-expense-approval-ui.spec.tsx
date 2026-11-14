// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseReviewItem } from '../../api/client-sprint.client.ts';

const mocked = vi.hoisted(() => ({ list: vi.fn(), approve: vi.fn() }));
vi.mock('../../api/client-sprint.client.ts', () => ({
  sprintApi: { expenseReviewPage: mocked.list, approveAndPostExpense: mocked.approve },
}));
import { ExpenseApprovalPanel } from '../../components/modules/ExpenseApprovalPanel.tsx';

const expense: ExpenseReviewItem = {
  id: 12,
  requestNumber: 'EXP-SYNTHETIC',
  incurredDate: '2026-10-10',
  payeeName: 'Synthetic supplier',
  category: 'Synthetic category',
  amountKes: '50.00',
  currency: 'KES',
  description: 'Synthetic expense',
  serviceLine: null,
  status: 'SUBMITTED',
  requestedByUserId: 3,
  reviewedByUserId: null,
  journalId: null,
  reversalJournalId: null,
  accountingStatus: 'NOT_POSTED',
  expenseAccount: { id: 10, code: 'EXP', name: 'Synthetic expense account' },
  payableAccount: { id: 11, code: 'AP', name: 'Synthetic payable account' },
  supportingDocuments: [{ name: 'Invoice reference', storageReference: 'private/synthetic' }],
  reviewHash: 'a'.repeat(64),
  reviewIssue: null,
};
const page = (items = [expense], nextAfterId: number | null = null) => ({
  expenses: items,
  nextAfterId,
  notice: 'Document references only; no payment.',
});
const panel = (props: Partial<React.ComponentProps<typeof ExpenseApprovalPanel>> = {}) => (
  <ExpenseApprovalPanel facilityId={5} userId={7} canApproveAndPost onPosted={vi.fn()} {...props} />
);

describe('Expense approval review UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.list.mockResolvedValue(page());
  });
  afterEach(cleanup);

  it('displays the actual scoped source, accounts and evidence references before posting a payable', async () => {
    const user = userEvent.setup();
    const onPosted = vi.fn();
    mocked.approve.mockResolvedValue({
      expenseId: 12,
      status: 'POSTED',
      journalId: 88,
      idempotentReplay: false,
      paymentRecorded: false,
    });
    render(panel({ onPosted }));
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(screen.getByText(/EXP — Synthetic expense account/)).toBeInTheDocument();
    expect(screen.getByText(/AP — Synthetic payable account/)).toBeInTheDocument();
    expect(screen.getByText(/Invoice reference — private\/synthetic/)).toBeInTheDocument();
    expect(screen.getByText(/Document references \(not verified\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Review notes'), 'Synthetic independent review');
    const button = screen.getByRole('button', { name: 'Approve and post payable' });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(button);
    await waitFor(() =>
      expect(mocked.approve).toHaveBeenCalledWith(12, {
        facilityId: 5,
        reviewHash: 'a'.repeat(64),
        notes: 'Synthetic independent review',
      }),
    );
    expect(await screen.findByText(/journal #88. No payment was recorded/)).toBeInTheDocument();
    expect(onPosted).toHaveBeenCalledTimes(1);
  });

  it('does not let the requester approve or an insufficiently privileged user post', async () => {
    const user = userEvent.setup();
    const first = render(panel({ userId: 3 }));
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(screen.getByText('You cannot approve your own expense.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve and post payable' }),
    ).not.toBeInTheDocument();
    first.unmount();
    render(panel({ canApproveAndPost: false }));
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(
      screen.getByText(/Both expense approval and journal posting permissions/),
    ).toBeInTheDocument();
    expect(mocked.approve).not.toHaveBeenCalled();
  });

  it('shows changed or reversed records without offering an approval', async () => {
    mocked.list.mockResolvedValue(
      page([{ ...expense, currency: 'USD', reviewHash: null, reviewIssue: 'SOURCE_CHANGED' }]),
    );
    const user = userEvent.setup();
    const first = render(panel());
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(screen.getByText(/Currency: USD · KES amount field: 50.00/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('SOURCE_CHANGED');
    expect(
      screen.queryByRole('button', { name: 'Approve and post payable' }),
    ).not.toBeInTheDocument();
    first.unmount();
    mocked.list.mockResolvedValue(
      page([{ ...expense, status: 'POSTED', accountingStatus: 'REVERSED', reversalJournalId: 99 }]),
    );
    render(panel());
    expect(await screen.findByText(/REVERSED · reversal #99/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(
      screen.queryByRole('button', { name: 'Approve and post payable' }),
    ).not.toBeInTheDocument();
  });

  it('does not misrepresent malformed document references as absent or render an approval', async () => {
    mocked.list.mockResolvedValue(
      page([
        {
          ...expense,
          supportingDocuments: [null] as unknown as ExpenseReviewItem['supportingDocuments'],
          reviewHash: null,
          reviewIssue: 'SOURCE_CHANGED',
        },
      ]),
    );
    const user = userEvent.setup();
    render(panel());
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(
      screen.getByText(/Document reference is invalid; manual review is required/),
    ).toBeInTheDocument();
    expect(screen.queryByText('None recorded.')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve and post payable' }),
    ).not.toBeInTheDocument();
  });

  it('requires a fresh confirmation after the reviewer refreshes the evidence', async () => {
    const user = userEvent.setup();
    render(panel());
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    await user.type(screen.getByLabelText('Review notes'), 'Synthetic review');
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Approve and post payable' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.queryByLabelText('Selected expense review')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Review notes')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Approve and post payable' })).toBeDisabled();
  });

  it('fails closed on load failure and retains the review after a lost response', async () => {
    mocked.list.mockRejectedValueOnce(new Error('Synthetic unavailable'));
    const user = userEvent.setup();
    const first = render(panel());
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume no requests exist');
    expect(screen.queryByText('No expense requests found on this page.')).not.toBeInTheDocument();
    first.unmount();
    mocked.list.mockResolvedValue(page());
    mocked.approve.mockRejectedValueOnce(new Error('Synthetic response lost'));
    render(panel());
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    await user.type(screen.getByLabelText('Review notes'), 'Synthetic review');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Approve and post payable' }));
    expect(
      await screen.findByText(/inspect the recorded expense and journal before retrying/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Review notes')).toHaveValue('Synthetic review');
  });

  it('does not claim success for an inconsistent approval response', async () => {
    const user = userEvent.setup();
    const onPosted = vi.fn();
    mocked.approve.mockResolvedValue({
      expenseId: 12,
      status: 'POSTED',
      journalId: 88,
      idempotentReplay: false,
      paymentRecorded: true,
    });
    render(panel({ onPosted }));
    await user.click(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' }));
    await user.type(screen.getByLabelText('Review notes'), 'Synthetic review');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Approve and post payable' }));
    expect(
      await screen.findByText(/approval response is inconsistent.*inspect the recorded expense/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No payment was recorded/)).not.toBeInTheDocument();
    expect(onPosted).not.toHaveBeenCalled();
  });

  it('does not present a malformed list as an empty page', async () => {
    mocked.list.mockResolvedValue({ expenses: null, nextAfterId: null, notice: 'Synthetic' });
    render(panel());
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume no requests exist');
    expect(screen.queryByText('No expense requests found on this page.')).not.toBeInTheDocument();
  });

  it('uses server search and pagination instead of fabricating options', async () => {
    const user = userEvent.setup();
    mocked.list.mockResolvedValueOnce(page([expense], 12)).mockResolvedValueOnce(page([]));
    render(panel());
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mocked.list).toHaveBeenCalledWith(5, '', 12));
    expect(await screen.findByText('No expense requests found on this page.')).toBeInTheDocument();
    mocked.list.mockResolvedValue(page([expense]));
    await user.type(screen.getByLabelText('Search expense number, ID or payee'), 'Synthetic');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(mocked.list).toHaveBeenCalledWith(5, 'Synthetic', 0));
    expect(await screen.findByRole('button', { name: 'Review EXP-SYNTHETIC' })).toBeInTheDocument();
  });
});
