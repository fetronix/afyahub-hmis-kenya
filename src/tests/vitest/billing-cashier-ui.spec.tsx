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
  bank: { workspace: vi.fn(), policy: vi.fn(), submit: vi.fn() },
  hub: {
    collectionIntegrations: vi.fn(),
    collectionInvoices: vi.fn(),
    recoverCollection: vi.fn(),
    collect: vi.fn(),
    query: vi.fn(),
  },
  api: {
    getInvoices: vi.fn(),
    getPatients: vi.fn(),
    getInvoiceItems: vi.fn(),
    getInvoiceDetail: vi.fn(),
    recordPayment: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
vi.mock('../../api/payment-hub.client.ts', () => ({ paymentHubApi: mocked.hub }));
vi.mock('../../api/clients/bank-payments.client.ts', () => ({ bankPaymentsApi: mocked.bank }));
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
    mocked.context.authenticatedUser.permissions = ['billing.read', 'billing.payments.record'];
    window.localStorage.clear();
    mocked.api.getInvoices.mockResolvedValue(invoices);
    mocked.api.getPatients.mockResolvedValue([
      { id: 2, firstName: 'Synthetic', lastName: 'Patient', mrn: 'TEST' },
    ]);
    mocked.api.getInvoiceItems.mockResolvedValue([]);
    mocked.api.getInvoiceDetail.mockImplementation(async (id: number) => ({
      invoice: invoices.find((invoice) => invoice.id === id),
      items: [{ totalAmount: invoices.find((invoice) => invoice.id === id)!.totalAmount }],
      payments: [],
      refunds: [],
    }));
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
    expect(within(detail).getByText('KES 50.00')).toBeInTheDocument();
  });
  it('records the selected invoice as a pending bank transfer, without STK or an unverified receipt', async () => {
    mocked.context.authenticatedUser.permissions.push('bank_payments.read', 'bank_payments.submit');
    mocked.bank.policy.mockResolvedValue({ bankOnly: true });
    mocked.bank.workspace.mockResolvedValue({
      accounts: [
        {
          id: 5,
          accountName: 'Synthetic bank account',
          bankName: 'Synthetic bank',
          accountNumberMasked: '****1234',
          currency: 'KES',
          isActive: true,
        },
      ],
      invoices: [{ id: 2, invoiceNumber: 'SYN-2', balanceAmount: '80.00' }],
    });
    mocked.bank.submit.mockResolvedValue({ id: 8, idempotentReplay: false });
    const user = userEvent.setup();
    render(<BillingCashierModule />);
    await screen.findByText('Patient Invoices (2)');
    await user.click(screen.getByText('SYN-2'));
    const invoice = await screen.findByLabelText('Bank payment invoice');
    expect(invoice).toHaveValue('2');
    expect(invoice).toBeDisabled();
    expect(screen.queryByText('Request M-Pesa sandbox prompt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment phone (254 format)')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Receiving bank account'), '5');
    await user.type(screen.getByLabelText('Amount (KES)'), '20.00');
    await user.type(screen.getByLabelText('Bank reference'), 'SYN-BANK-20');
    await user.type(screen.getByLabelText('Transfer date'), '2026-10-27');
    await user.click(screen.getByRole('button', { name: 'Save pending transfer — no receipt' }));
    await waitFor(() =>
      expect(mocked.bank.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 10,
          bankAccountId: 5,
          invoiceId: 2,
          amountKes: '20.00',
          bankReference: 'SYN-BANK-20',
          currency: 'KES',
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByText(/Pending transfer saved/)).toBeInTheDocument();
    expect(mocked.api.recordPayment).not.toHaveBeenCalled();
    expect(mocked.hub.collect).not.toHaveBeenCalled();
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
