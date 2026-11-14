// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const state = vi.hoisted(() => ({
  context: {
    currentFacility: { id: 10 },
    authenticatedUser: {
      id: 7,
      isSuperAdmin: false,
      roles: ['CASHIER'],
      permissions: ['bank_payments.read', 'bank_payments.submit'],
    },
    setActiveModule: vi.fn(),
  },
  bank: {
    workspace: vi.fn(),
    policy: vi.fn(),
    submit: vi.fn(),
    enable: vi.fn(),
    saveAccount: vi.fn(),
    verify: vi.fn(),
    settle: vi.fn(),
    reject: vi.fn(),
    ledgerAccounts: vi.fn(),
    statements: vi.fn(),
    previewImport: vi.fn(),
    importStatement: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => state.context }));
vi.mock('../../api/clients/bank-payments.client.ts', () => ({ bankPaymentsApi: state.bank }));
vi.mock('../../components/modules/RefundsPanel.tsx', () => ({
  RefundsPanel: () => <div>Authorized refund evidence controls</div>,
}));
import { BankPaymentsWorkspace } from '../../components/modules/payment-hub/BankPaymentsWorkspace.tsx';
const workspace = () => ({
  accounts: [
    {
      id: 5,
      accountName: 'Synthetic receiving',
      bankName: 'Synthetic bank',
      bankCode: 'TEST',
      branchName: 'Synthetic',
      currency: 'KES',
      isActive: true,
      accountNumberMasked: '****1234',
      glAccountId: 9,
      provider: 'MANUAL',
    },
  ],
  invoices: [{ id: 2, invoiceNumber: 'INV-SYNTHETIC', balanceAmount: '100.00' }],
  payments: [],
  events: [],
  configurationHistory: [],
  limit: 200,
  notice: 'Manual only',
});
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.context.currentFacility = { id: 10 };
  state.context.authenticatedUser = {
    id: 7,
    isSuperAdmin: false,
    roles: ['CASHIER'],
    permissions: ['bank_payments.read', 'bank_payments.submit'],
  };
  state.bank.workspace.mockResolvedValue(workspace());
  state.bank.policy.mockResolvedValue({ bankOnly: true });
  state.bank.submit.mockResolvedValue({ id: 3, idempotentReplay: false });
});
describe('Bank-first payment UI', () => {
  it('uses bank account/invoice/balance/reference/date, not phone, STK or sandbox selection', async () => {
    render(<BankPaymentsWorkspace />);
    await screen.findByText('Record external bank transfer');
    expect(
      screen.getByRole('heading', { name: 'Bank Payments & Reconciliation' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/sandbox integration/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No live bank collection/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Bank payment invoice'), '2');
    expect(screen.getByText('Outstanding balance: KES 100.00')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Receiving bank account'), '5');
    await user.type(screen.getByLabelText('Amount (KES)'), '25.00');
    await user.type(screen.getByLabelText('Bank reference'), 'BANK-SYN-25');
    await user.type(screen.getByLabelText('Transfer date'), '2026-10-27');
    await user.click(screen.getByRole('button', { name: 'Save pending transfer — no receipt' }));
    await waitFor(() =>
      expect(state.bank.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 10,
          invoiceId: 2,
          bankAccountId: 5,
          amountKes: '25.00',
          currency: 'KES',
          bankReference: 'BANK-SYN-25',
          paymentDate: '2026-10-27',
        }),
      ),
    );
    expect(state.bank.settle).not.toHaveBeenCalled();
    expect(state.bank.verify).not.toHaveBeenCalled();
  });
  it('does not offer account configuration or bank-only activation to ordinary payment users', async () => {
    state.bank.policy.mockResolvedValue({ bankOnly: false });
    render(<BankPaymentsWorkspace />);
    await screen.findByText('Facility setup required');
    expect(
      screen.queryByRole('button', { name: 'Enable bank-only payments' }),
    ).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(
      screen.queryByRole('button', { name: 'Save facility bank account' }),
    ).not.toBeInTheDocument();
    expect(state.bank.ledgerAccounts).not.toHaveBeenCalled();
  });
  it('reports a load failure instead of pretending there are no bank payments', async () => {
    state.bank.workspace.mockRejectedValueOnce(new Error('Synthetic outage'));
    render(<BankPaymentsWorkspace />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Do not assume there are no payments',
    );
    expect(screen.queryByText('No bank payment records in this facility.')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Refresh bank data' }));
    await screen.findByText('No bank payment records in this facility.');
  });
  it('requires independent review and never offers a submitter their own verification or settlement', async () => {
    state.context.authenticatedUser.permissions.push(
      'bank_payments.verify',
      'bank_payments.settle',
      'billing.payments.record',
    );
    state.bank.workspace.mockResolvedValue({
      ...workspace(),
      payments: [
        {
          id: 3,
          invoiceId: 2,
          invoiceNumber: 'INV-SYNTHETIC',
          bankAccountId: 5,
          amountKes: '25.00',
          bankReference: 'SYN',
          paymentDate: '2026-10-27',
          payerParty: 'PATIENT',
          status: 'PENDING',
          submittedByUserId: 7,
          verifiedByUserId: null,
          journalStatus: 'NOT_RECEIPTED',
          refundedKes: '0.00',
        },
      ],
    });
    render(<BankPaymentsWorkspace />);
    await screen.findByText(/Submitted by #7/);
    expect(
      screen.queryByRole('button', { name: 'Verify statement credit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve and issue verified receipt' }),
    ).not.toBeInTheDocument();
  });
  it('freezes an unconfirmed declaration and retries the same identity rather than issuing a receipt', async () => {
    state.bank.submit.mockRejectedValueOnce(new Error('Synthetic lost response'));
    const user = userEvent.setup();
    render(<BankPaymentsWorkspace />);
    await screen.findByText('Record external bank transfer');
    await user.selectOptions(screen.getByLabelText('Bank payment invoice'), '2');
    await user.selectOptions(screen.getByLabelText('Receiving bank account'), '5');
    await user.type(screen.getByLabelText('Amount (KES)'), '25.00');
    await user.type(screen.getByLabelText('Bank reference'), 'BANK-SYN-25');
    await user.type(screen.getByLabelText('Transfer date'), '2026-10-27');
    await user.click(screen.getByRole('button', { name: 'Save pending transfer — no receipt' }));
    await screen.findByText('Synthetic lost response');
    expect(screen.getByLabelText('Bank reference')).toBeDisabled();
    const identity = state.bank.submit.mock.calls[0][0];
    await user.click(screen.getByRole('button', { name: 'Retry same pending transfer' }));
    await waitFor(() => expect(state.bank.submit).toHaveBeenCalledTimes(2));
    expect(state.bank.submit.mock.calls[1][0]).toEqual(identity);
    expect(state.bank.settle).not.toHaveBeenCalled();
  });
  it('does not display delayed results from another facility', async () => {
    let resolveOld!: (value: ReturnType<typeof workspace>) => void;
    state.bank.workspace.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r;
        }),
    );
    const view = render(<BankPaymentsWorkspace />);
    await waitFor(() => expect(state.bank.workspace).toHaveBeenCalledWith(10));
    state.context.currentFacility = { id: 20 };
    state.bank.workspace.mockResolvedValue({ ...workspace(), invoices: [], accounts: [] });
    view.rerender(<BankPaymentsWorkspace />);
    await waitFor(() => expect(state.bank.workspace).toHaveBeenCalledWith(20));
    resolveOld(workspace());
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /INV-SYNTHETIC/ })).not.toBeInTheDocument(),
    );
  });
  it('shows facility configuration and payment history without account identifiers', async () => {
    state.bank.workspace.mockResolvedValue({
      ...workspace(),
      configurationHistory: [
        {
          id: 1,
          action: 'BANK_ACCOUNT_UPDATED',
          accountId: 5,
          actorUserId: 8,
          createdAt: '2026-10-27T12:00:00Z',
        },
      ],
      events: [
        {
          id: 2,
          bankPaymentId: 3,
          action: 'VERIFIED',
          actorUserId: 9,
          createdAt: '2026-10-27T12:01:00Z',
        },
      ],
    });
    const user = userEvent.setup();
    render(<BankPaymentsWorkspace />);
    await screen.findByText('Record external bank transfer');
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText(/BANK_ACCOUNT_UPDATED/)).toHaveTextContent('staff #8');
    expect(screen.getByText(/Payment #3/)).toHaveTextContent('VERIFIED');
    expect(screen.queryByText(/ciphertext|encryptedIdentifier/)).not.toBeInTheDocument();
  });
  it('requires a current duplicate-free preview and invalidates it when import inputs change', async () => {
    state.context.authenticatedUser.permissions.push('accounting.read', 'accounting.bank.manage');
    state.bank.statements.mockResolvedValue({ transactions: [], imports: [], reconciliations: [] });
    state.bank.previewImport.mockResolvedValue({
      lineCount: 1,
      overlappingLines: 0,
      duplicatesWithinFile: 0,
      canImport: true,
    });
    const user = userEvent.setup();
    render(<BankPaymentsWorkspace />);
    await screen.findByText('Record external bank transfer');
    await user.click(screen.getByRole('button', { name: 'Statements & Matching' }));
    const submit = screen.getByRole('button', {
      name: 'Import statement — does not issue receipts',
    });
    expect(submit).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Filter bank account'), '5');
    await user.type(screen.getByLabelText('Start date'), '2026-10-27');
    await user.type(screen.getByLabelText('End date'), '2026-10-27');
    await user.type(screen.getByLabelText('Closing statement balance (KES)'), '25.00');
    await user.type(
      screen.getByLabelText('Statement CSV'),
      'date,reference,description,direction,amount\n2026-10-27,SYN,Synthetic,INFLOW,25.00',
    );
    await user.click(screen.getByRole('button', { name: 'Validate import preview' }));
    await screen.findByText(/Ready for atomic validation and import/);
    expect(submit).toBeEnabled();
    await user.type(screen.getByLabelText('Closing statement balance (KES)'), '1');
    expect(submit).toBeDisabled();
    state.bank.previewImport.mockResolvedValue({
      lineCount: 1,
      overlappingLines: 1,
      duplicatesWithinFile: 0,
      canImport: false,
    });
    await user.click(screen.getByRole('button', { name: 'Validate import preview' }));
    await screen.findByText(/Resolve duplicates before importing/);
    expect(submit).toBeDisabled();
    expect(state.bank.importStatement).not.toHaveBeenCalled();
  });
});
