// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocked = vi.hoisted(() => ({
  context: {
    currentFacility: { id: 10 },
    currentTenant: { id: 4 },
    currentUser: { name: 'Synthetic Cashier', role: 'Cashier' },
    authenticatedUser: {
      id: 7,
      isSuperAdmin: false,
      permissions: ['billing.read', 'billing.payments.record'],
    },
    setSelectedPatient: vi.fn(),
    setActiveModule: vi.fn(),
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getInvoices: vi.fn(),
    getPatients: vi.fn(),
    getInvoiceItems: vi.fn(),
    recordPayment: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
vi.mock('../../components/modules/RefundsPanel.tsx', () => ({
  RefundsPanel: ({ invoiceId }: { invoiceId: number }) => <div>Refund history for {invoiceId}</div>,
}));
import { BillingCashierModule } from '../../components/modules/BillingCashierModule.tsx';
const invoices = [
  {
    id: 1,
    patientId: 2,
    invoiceNumber: 'SYN-1',
    status: 'Pending',
    totalAmount: '100.00',
    paidAmount: '0.00',
    balanceAmount: '100.00',
  },
  {
    id: 2,
    patientId: 2,
    invoiceNumber: 'SYN-2',
    status: 'Pending',
    totalAmount: '80.00',
    paidAmount: '0.00',
    balanceAmount: '80.00',
  },
];
describe('Cashier loading and selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.context.refreshKey = 0;
    mocked.context.currentFacility = { id: 10 };
    mocked.api.getInvoices.mockResolvedValue(invoices);
    mocked.api.getPatients.mockResolvedValue([
      { id: 2, firstName: 'Synthetic', lastName: 'Patient', mrn: 'TEST' },
    ]);
    mocked.api.getInvoiceItems.mockResolvedValue([]);
  });
  afterEach(cleanup);
  it('reports billing load failures and retries instead of claiming an empty list', async () => {
    mocked.api.getInvoices.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<BillingCashierModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Do not assume there are no invoices',
    );
    expect(screen.queryByText(/Patient Invoices \(0\)/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry billing data' }));
    expect(await screen.findByText('Patient Invoices (2)')).toBeInTheDocument();
    expect(screen.queryByText("Today's Collections")).not.toBeInTheDocument();
    expect(screen.queryByText(/Shift Open/)).not.toBeInTheDocument();
  });
  it('refreshes the selected invoice instead of leaving stale totals', async () => {
    const user = userEvent.setup();
    const view = render(<BillingCashierModule />);
    await screen.findByText('Patient Invoices (2)');
    await user.click(screen.getByText('SYN-2'));
    await waitFor(() => expect(screen.getByText('Refund history for 2')).toBeInTheDocument());
    mocked.api.getInvoices.mockResolvedValueOnce([
      invoices[0],
      { ...invoices[1], paidAmount: '30.00', balanceAmount: '50.00', status: 'Partially Paid' },
    ]);
    mocked.context.refreshKey = 1;
    view.rerender(<BillingCashierModule />);
    await waitFor(() => expect(screen.getByText('Refund history for 2')).toBeInTheDocument());
    const detail = screen.getByText('Refund history for 2').parentElement!;
    expect(within(detail).getByText('KES 50')).toBeInTheDocument();
  });
  it('does not turn an invoice line load error into an empty line table', async () => {
    mocked.api.getInvoiceItems.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<BillingCashierModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invoice lines could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Retry invoice lines' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
