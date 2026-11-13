// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocked = vi.hoisted(() => ({
  context: {
    currentFacility: { id: 10 },
    authenticatedUser: {
      id: 7,
      isSuperAdmin: false,
      permissions: ['billing.read', 'billing.refunds.record'],
    },
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getInvoiceDetail: vi.fn(),
    recordManualRefund: vi.fn(),
    checkRefundStatus: vi.fn(),
    listRefundRequests: vi.fn(),
    createRefundRequest: vi.fn(),
    checkRefundRequestStatus: vi.fn(),
    decideRefundRequest: vi.fn(),
    revokeRefundApproval: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
import { RefundsPanel } from '../../components/modules/RefundsPanel.tsx';

const key = 'jalicare:refund:pending:7:10';
const result = {
  refund: {
    id: 99,
    invoiceId: 8,
    paymentId: 12,
    refundNumber: 'REF-SYNTHETIC',
    amount: '20.00',
    refundMethod: 'CASH',
    externalReference: null,
    reason: 'Synthetic refund',
    actorUserId: 7,
    createdAt: '2026-10-30',
    status: 'MANUALLY_RECORDED',
  },
  replayed: false,
  accounting: 'NOT_POSTED',
};
const approved = {
  id: 44,
  requestNumber: 'RFR-SYNTHETIC',
  facilityId: 10,
  invoiceId: 8,
  paymentId: 12,
  amount: '20.00',
  refundMethod: 'CASH',
  reason: 'Synthetic refund',
  idempotencyKey: 'synthetic-approved-key',
  status: 'APPROVED',
  requestedByUserId: 7,
  reviewedByUserId: 9,
  reviewNotes: 'Synthetic independent review',
  reviewedAt: '2026-10-30',
  revokedByUserId: null,
  revocationReason: null,
  revokedAt: null,
  settledRefundId: null,
  createdAt: '2026-10-30',
  reviewHash: null,
  issue: null,
  evidence: null,
};
const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Amount (KES)'), '20.00');
  await user.type(screen.getByLabelText('Reason'), 'Synthetic refund');
  await user.click(screen.getByRole('checkbox'));
};

describe('Manual refund browser recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocked.context.currentFacility = { id: 10 };
    mocked.context.authenticatedUser = {
      id: 7,
      isSuperAdmin: false,
      permissions: ['billing.read', 'billing.refunds.record'],
    };
    mocked.api.listRefundRequests.mockResolvedValue({ requests: [approved], nextAfterId: null });
    mocked.api.getInvoiceDetail.mockResolvedValue({
      invoice: { id: 8 },
      items: [],
      payments: [
        {
          id: 12,
          invoiceId: 8,
          receiptNumber: 'RCP-SYNTHETIC',
          paymentMethod: 'Cash',
          amount: '100.00',
        },
      ],
      refunds: [],
    });
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('retains one retry key after a lost response and resends the same details', async () => {
    const user = userEvent.setup();
    mocked.api.recordManualRefund
      .mockRejectedValueOnce(new Error('Synthetic lost response'))
      .mockResolvedValueOnce({ ...result, replayed: true });
    mocked.api.checkRefundStatus.mockResolvedValue({ status: 'NOT_FOUND' });
    const view = render(<RefundsPanel invoiceId={8} />);
    await user.click(
      await screen.findByRole('button', { name: 'Record external refund for RFR-SYNTHETIC' }),
    );
    expect(screen.getByLabelText('Amount (KES)')).toHaveValue('20.00');
    expect(screen.getByLabelText('Reason')).toHaveValue('Synthetic refund');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Record refund receipt' }));
    await waitFor(() => expect(mocked.api.recordManualRefund).toHaveBeenCalledTimes(1));
    const first = mocked.api.recordManualRefund.mock.calls[0]![0];
    const stored = window.localStorage.getItem(key)!;
    expect(JSON.parse(stored)).toEqual({ key: first.idempotencyKey, invoiceId: 8, paymentId: 12 });
    expect(stored).not.toContain('20.00');
    expect(stored).not.toContain('Synthetic refund');
    view.unmount();
    render(<RefundsPanel invoiceId={8} />);
    await user.click(await screen.findByRole('button', { name: 'Check recorded refund' }));
    expect(window.localStorage.getItem(key)).not.toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Resume same refund' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Record refund receipt' }));
    await waitFor(() => expect(mocked.api.recordManualRefund).toHaveBeenCalledTimes(2));
    expect(mocked.api.recordManualRefund.mock.calls[1]![0].idempotencyKey).toBe(
      first.idempotencyKey,
    );
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());
  });

  it('checks a committed refund and clears the identity without a second refund', async () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ key: 'synthetic-refund-key', invoiceId: 8, paymentId: 12 }),
    );
    mocked.api.checkRefundStatus.mockResolvedValue({
      status: 'RECORDED',
      refund: result.refund,
      accounting: 'NOT_POSTED',
    });
    const user = userEvent.setup();
    render(<RefundsPanel invoiceId={8} />);
    await user.click(await screen.findByRole('button', { name: 'Check recorded refund' }));
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());
    expect(mocked.api.recordManualRefund).not.toHaveBeenCalled();
    expect(mocked.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('did not initiate a transfer'),
    );
  });

  it('retains a pending identity if the status belongs to a different receipt', async () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ key: 'synthetic-refund-key', invoiceId: 8, paymentId: 12 }),
    );
    mocked.api.checkRefundStatus.mockResolvedValue({
      status: 'RECORDED',
      refund: { ...result.refund, paymentId: 999 },
      accounting: 'NOT_POSTED',
    });
    const user = userEvent.setup();
    render(<RefundsPanel invoiceId={8} />);
    await user.click(await screen.findByRole('button', { name: 'Check recorded refund' }));
    await waitFor(() =>
      expect(mocked.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('does not match the pending receipt'),
      ),
    );
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(mocked.api.recordManualRefund).not.toHaveBeenCalled();
  });

  it('does not offer refunds without explicit facility permission', async () => {
    mocked.context.authenticatedUser.permissions = ['billing.read'];
    render(<RefundsPanel invoiceId={8} />);
    expect(await screen.findByText(/RCP-SYNTHETIC/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Record external refund for RFR-SYNTHETIC' }),
    ).not.toBeInTheDocument();
  });

  it('reports failed receipt loading rather than showing an empty history', async () => {
    mocked.api.getInvoiceDetail.mockRejectedValueOnce(new Error('Synthetic unavailable'));
    const user = userEvent.setup();
    render(<RefundsPanel invoiceId={8} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Receipt history could not be loaded',
    );
    expect(screen.queryByText(/No receipts recorded/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry receipt history' }));
    expect(await screen.findByText('RCP-SYNTHETIC', { selector: 'strong' })).toBeInTheDocument();
  });

  it('fails closed on malformed stored identity', async () => {
    window.localStorage.setItem(key, '{broken');
    render(<RefundsPanel invoiceId={8} />);
    expect(await screen.findByText(/saved refund identity cannot be read/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Record external refund for RFR-SYNTHETIC' }),
    ).toBeDisabled();
    expect(mocked.api.recordManualRefund).not.toHaveBeenCalled();
  });
});
