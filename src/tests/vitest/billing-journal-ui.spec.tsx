// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ post: vi.fn(), status: vi.fn() }));
vi.mock('../../api/client-sprint.client.ts', () => ({
  sprintApi: { postBillingSource: mocked.post, billingSourceStatus: mocked.status },
}));
import { BillingJournalPostingPanel } from '../../components/modules/BillingJournalPostingPanel.tsx';

const accounts = [
  {
    accountId: 11,
    accountCode: 'AR',
    accountName: 'Synthetic receivable',
    accountType: 'ASSET',
    debitKes: '0.00',
    creditKes: '0.00',
  },
  {
    accountId: 12,
    accountCode: 'REV',
    accountName: 'Synthetic revenue',
    accountType: 'REVENUE',
    debitKes: '0.00',
    creditKes: '0.00',
  },
];
const key = 'jalicare:billing-journal:pending:7:10';
const panel = () => (
  <BillingJournalPostingPanel facilityId={10} userId={7} accounts={accounts} onPosted={vi.fn()} />
);

describe('Reviewed billing journal recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('saves only source identity on a lost response and checks the recorded result after reload', async () => {
    const user = userEvent.setup();
    mocked.post.mockRejectedValueOnce(new Error('Synthetic response lost'));
    mocked.status.mockResolvedValueOnce({ status: 'NOT_FOUND' }).mockResolvedValueOnce({
      status: 'RECORDED',
      journalNumber: 'J-SYNTHETIC',
      reversed: false,
    });
    const view = render(panel());
    await user.type(screen.getByLabelText('Billing source ID'), '42');
    await user.type(screen.getByLabelText('Billing journal date'), '2026-10-30');
    await user.type(
      screen.getByLabelText('Billing journal description'),
      'Synthetic reviewed posting',
    );
    await user.selectOptions(screen.getByLabelText('Patient receivable (if applicable)'), '11');
    await user.selectOptions(screen.getByLabelText('Revenue account'), '12');
    await user.click(screen.getByRole('button', { name: 'Post reviewed source' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const saved = window.localStorage.getItem(key)!;
    expect(JSON.parse(saved)).toMatchObject({ sourceType: 'BILLING_INVOICE', sourceId: 42 });
    expect(saved).not.toContain('Synthetic reviewed posting');
    expect(saved).not.toContain('2026-10-30');
    view.unmount();
    render(panel());
    expect(await screen.findByLabelText('Billing source ID')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check recorded journal' }));
    expect(await screen.findByText(/A delayed request may still arrive/)).toBeInTheDocument();
    expect(window.localStorage.getItem(key)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check recorded journal' }));
    expect(await screen.findByText(/Journal J-SYNTHETIC was recorded/)).toBeInTheDocument();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('fails closed on a malformed saved identity', async () => {
    window.localStorage.setItem(key, '{bad');
    render(panel());
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be read');
    expect(screen.getByRole('button', { name: 'Post reviewed source' })).toBeDisabled();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
