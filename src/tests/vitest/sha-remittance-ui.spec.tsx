// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mock = vi.hoisted(() => ({
  listRemittances: vi.fn(),
  listClaims: vi.fn(),
  matchRemittanceReceipt: vi.fn(),
}));
vi.mock('../../api/sha-eclaims.client.ts', () => ({ shaEclaimsApi: mock }));
import { RemittanceAndAdminWorkspace } from '../../components/modules/eclaims/RemittanceAndAdminWorkspace.tsx';

const advice = {
  id: 10,
  remittanceNumber: 'SYN-ADVICE',
  payerRemittanceRef: 'SYN-REFERENCE',
  paymentDate: '2026-10-28',
  totalRemittedAmount: '75.00',
  allocatedAmount: '75.00',
  unallocatedAmount: '0.00',
  status: 'RECONCILED', // legacy advice-only status
  isSimulated: false,
  entries: [
    {
      id: 20,
      claimNumber: 'SYN-CLAIM',
      invoiceNumber: 'SYN-INVOICE',
      claimedAmount: '75.00',
      remittedAmount: '75.00',
      varianceAmount: '0.00',
      reconciliationStatus: 'MATCHED',
      postedPaymentId: null,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mock.listRemittances.mockResolvedValue({ remittances: [advice] });
  mock.listClaims.mockResolvedValue({ claims: [] });
  mock.matchRemittanceReceipt.mockResolvedValue({ idempotentReplay: false });
});
afterEach(cleanup);

function setup(canReconcile = true) {
  const toast = vi.fn();
  render(
    <RemittanceAndAdminWorkspace
      facilityId={5}
      section="remittance"
      canReconcile={canReconcile}
      canManageConfig={false}
      showToast={toast}
    />,
  );
  return toast;
}

describe('SHA advice receipt matching (mocked browser API)', () => {
  it('labels a legacy advice-only allocation as receipt pending and matches the existing receipt', async () => {
    const toast = setup();
    expect(await screen.findByText('RECONCILED · receipt pending')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Amount comparison')).toBeInTheDocument();
    expect(within(table).getByText('MATCHED')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Existing billing receipt ID for allocation 20'), '55');
    await user.click(screen.getByRole('button', { name: 'Match receipt' }));
    await waitFor(() => expect(mock.matchRemittanceReceipt).toHaveBeenCalledWith(10, 20, 5, 55));
    expect(toast).toHaveBeenCalledWith(
      'Existing receipt matched; no payment was created or changed.',
      'success',
    );
  });

  it('does not offer a match without permission or for simulated advice', async () => {
    setup(false);
    expect(await screen.findByText('Receipt pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Match receipt' })).not.toBeInTheDocument();
    cleanup();
    mock.listRemittances.mockResolvedValue({ remittances: [{ ...advice, isSimulated: true }] });
    setup();
    expect(await screen.findByText('Simulated; no real receipt match')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Match receipt' })).not.toBeInTheDocument();
    expect(mock.matchRemittanceReceipt).not.toHaveBeenCalled();
  });

  it('shows failure without claiming a match', async () => {
    mock.matchRemittanceReceipt.mockRejectedValue(new Error('Receipt reference does not match.'));
    const toast = setup();
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText('Existing billing receipt ID for allocation 20'),
      '55',
    );
    await user.click(screen.getByRole('button', { name: 'Match receipt' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Receipt reference does not match.', 'error'),
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.stringContaining('Existing receipt matched'),
      'success',
    );
  });
});
