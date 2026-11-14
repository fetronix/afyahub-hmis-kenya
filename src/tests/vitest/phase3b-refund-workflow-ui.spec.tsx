// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BillingPayment, RefundRequestForReview } from '../../types/index.ts';

const mocked = vi.hoisted(() => ({
  context: { showToast: vi.fn(), refreshKey: 0 },
  api: {
    listRefundRequests: vi.fn(),
    createRefundRequest: vi.fn(),
    checkRefundRequestStatus: vi.fn(),
    decideRefundRequest: vi.fn(),
    revokeRefundApproval: vi.fn(),
  },
}));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
import { RefundRequestWorkflow } from '../../components/modules/RefundRequestWorkflow.tsx';

const payment = {
  id: 12,
  invoiceId: 8,
  receiptNumber: 'RCP-SYN',
  paymentMethod: 'Cash',
  amount: '100.00',
  cashierName: 'Synthetic',
  paymentDate: '2026-10-01',
} satisfies BillingPayment;
const requested = {
  id: 44,
  requestNumber: 'RFR-SYN',
  facilityId: 10,
  invoiceId: 8,
  paymentId: 12,
  amount: '20.00',
  refundMethod: 'CASH',
  reason: 'Synthetic reason',
  idempotencyKey: 'synthetic-request-key',
  status: 'REQUESTED',
  requestedByUserId: 7,
  reviewedByUserId: null,
  reviewNotes: null,
  reviewedAt: null,
  revokedByUserId: null,
  revocationReason: null,
  revokedAt: null,
  settledRefundId: null,
  createdAt: '2026-10-01',
  reviewHash: 'a'.repeat(64),
  issue: null,
  evidence: {
    invoiceStatus: 'Paid',
    invoiceTotal: '100.00',
    invoicePaid: '100.00',
    invoiceBalance: '0.00',
    invoiceCredit: '0.00',
    receiptNumber: 'RCP-SYN',
    receiptMethod: 'Cash',
    receiptGross: '100.00',
    receiptRefunded: '0.00',
    receiptReserved: '0.00',
    invoiceReserved: '0.00',
    receiptAvailable: '100.00',
    invoiceAvailable: '100.00',
  },
} satisfies RefundRequestForReview;
const renderWorkflow = (
  options: { canRequest?: boolean; canReview?: boolean; userId?: number } = {},
) =>
  render(
    <RefundRequestWorkflow
      facilityId={10}
      invoiceId={8}
      payments={[payment]}
      canRequest={options.canRequest ?? false}
      canReview={options.canReview ?? false}
      userId={options.userId ?? 9}
      recordBlocked={false}
      onRecordApproved={vi.fn()}
    />,
  );

describe('Refund request and independent review UI', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocked.api.listRefundRequests.mockResolvedValue({ requests: [], nextAfterId: null });
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('retains only a retry identity after a lost request response and confirms the persisted request', async () => {
    const user = userEvent.setup();
    mocked.api.createRefundRequest.mockRejectedValueOnce(new Error('Synthetic lost response'));
    renderWorkflow({ canRequest: true, userId: 7 });
    await user.selectOptions(screen.getByLabelText('Receipt for refund request'), '12');
    await user.type(screen.getByLabelText('Requested amount (KES)'), '20.00');
    await user.type(screen.getByLabelText('Request reason'), 'Synthetic reason');
    await user.click(screen.getByRole('button', { name: 'Submit refund request' }));
    await waitFor(() => expect(mocked.api.createRefundRequest).toHaveBeenCalledTimes(1));
    const sent = mocked.api.createRefundRequest.mock.calls[0]![0];
    const key = 'jalicare:refund-request:pending:7:10';
    const stored = window.localStorage.getItem(key)!;
    expect(JSON.parse(stored)).toEqual({ key: sent.idempotencyKey, invoiceId: 8, paymentId: 12 });
    expect(stored).not.toContain('20.00');
    expect(stored).not.toContain('Synthetic reason');
    mocked.api.checkRefundRequestStatus.mockResolvedValue({ status: 'NOT_FOUND' });
    await user.click(await screen.findByRole('button', { name: 'Check refund request' }));
    expect(window.localStorage.getItem(key)).not.toBeNull();
    mocked.api.checkRefundRequestStatus.mockResolvedValue({
      status: 'FOUND',
      request: { ...requested, idempotencyKey: sent.idempotencyKey },
    });
    await user.click(screen.getByRole('button', { name: 'Check refund request' }));
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());
    expect(mocked.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('no money was transferred'),
    );
  });

  it('shows persisted evidence to a different reviewer and sends its exact digest, not a transfer', async () => {
    mocked.api.listRefundRequests.mockResolvedValue({ requests: [requested], nextAfterId: null });
    mocked.api.decideRefundRequest.mockResolvedValue({
      requestId: 44,
      status: 'APPROVED',
      replayed: false,
    });
    const user = userEvent.setup();
    renderWorkflow({ canReview: true, userId: 9 });
    expect(await screen.findByText(/Receipt RCP-SYN: gross KES 100.00/)).toHaveTextContent(
      'available KES 100.00',
    );
    await user.type(
      screen.getByLabelText('Review notes for RFR-SYN'),
      'Independent synthetic review',
    );
    await user.click(screen.getByRole('button', { name: 'Approve RFR-SYN' }));
    await waitFor(() =>
      expect(mocked.api.decideRefundRequest).toHaveBeenCalledWith(44, {
        facilityId: 10,
        decision: 'APPROVE',
        reviewHash: 'a'.repeat(64),
        notes: 'Independent synthetic review',
      }),
    );
    expect(mocked.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('no funds were sent'),
    );
  });

  it('does not present self-approval and allows rejection, but not approval, when reserved funds are insufficient', async () => {
    mocked.api.listRefundRequests.mockResolvedValueOnce({
      requests: [requested],
      nextAfterId: null,
    });
    const view = renderWorkflow({ canReview: true, userId: 7 });
    expect(await screen.findByText(/different authorized reviewer/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve RFR-SYN' })).not.toBeInTheDocument();
    view.unmount();
    mocked.api.listRefundRequests.mockResolvedValue({
      requests: [
        {
          ...requested,
          issue: 'REFUND_APPROVAL_EXCEEDS_AVAILABLE',
          evidence: { ...requested.evidence, receiptReserved: '90.00', receiptAvailable: '10.00' },
        },
      ],
      nextAfterId: null,
    });
    const user = userEvent.setup();
    renderWorkflow({ canReview: true, userId: 9 });
    expect(await screen.findByText(/Approval unavailable/)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Review notes for RFR-SYN'),
      'Insufficient available amount',
    );
    expect(screen.getByRole('button', { name: 'Approve RFR-SYN' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject RFR-SYN' })).toBeEnabled();
  });

  it('fails closed on malformed review pages rather than presenting an empty queue or action', async () => {
    mocked.api.listRefundRequests.mockResolvedValue({
      requests: [{ ...requested, reviewHash: 'bad' }],
      nextAfterId: null,
    });
    renderWorkflow({ canReview: true, userId: 9 });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/not returned safely/)).toBeInTheDocument();
    expect(screen.queryByText('No refund requests on this page.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve RFR-SYN' })).not.toBeInTheDocument();
  });
});
