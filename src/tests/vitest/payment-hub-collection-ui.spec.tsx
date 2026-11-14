// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 7, isSuperAdmin: false, permissions: [] as string[] },
  facility: { id: 11, name: 'Synthetic facility' },
}));
const api = vi.hoisted(() => ({
  collectionIntegrations: vi.fn(),
  collectionInvoices: vi.fn(),
  recoverCollection: vi.fn(),
  collect: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ authenticatedUser: state.user, currentFacility: state.facility }),
}));
vi.mock('../../api/payment-hub.client.ts', () => ({ paymentHubApi: api }));
import { SandboxCollectionForm } from '../../components/modules/payment-hub/SandboxCollectionForm.tsx';
import {
  collectionStatusLabel,
  collectionStatusNotice,
} from '../../payment-hub/collection-status.ts';

const storageKey = 'jalicare:mpesa:pending:7:11';
const recorded = (status = 'PENDING', resultCode: string | null = null) => ({
  recovery: 'RECORDED',
  transaction: {
    id: 9,
    invoiceId: 3,
    integrationId: 4,
    requestedAmountCents: '2000',
    status,
    resultCode,
    hasProviderReference: true,
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  state.user = {
    id: 7,
    isSuperAdmin: false,
    permissions: ['billing.read', 'payment_hub.collection.initiate', 'payment_hub.payments.verify'],
  };
  state.facility = { id: 11, name: 'Synthetic facility' };
  api.collectionIntegrations.mockResolvedValue({
    integrations: [{ id: 4, providerName: 'M-Pesa' }],
    nextCursor: null,
  });
  api.collectionInvoices.mockResolvedValue({
    invoices: [{ id: 3, invoiceNumber: 'SYN-3', balanceAmount: '100.00' }],
    nextCursor: null,
  });
  api.recoverCollection.mockResolvedValue(recorded());
  api.collect.mockResolvedValue({
    transactionId: 9,
    status: 'PENDING',
    notice: 'Accepted for processing; no invoice was paid.',
  });
  api.query.mockResolvedValue({
    transactionId: 9,
    status: 'PENDING',
    notice: 'Provider status only.',
  });
});

describe('M-Pesa sandbox collection interface', () => {
  it('browses actual options, persists an opaque retry identity before sending and recovers after refresh', async () => {
    const user = userEvent.setup();
    api.collect.mockImplementation(async (_body, key) => {
      const saved = JSON.parse(window.localStorage.getItem(storageKey)!);
      expect(saved).toEqual({
        key,
        invoiceId: 3,
        integrationId: 4,
        allowOverpayment: false,
        confirmSeparateRequest: false,
      });
      expect(JSON.stringify(saved)).not.toContain('254700000001');
      expect(saved).not.toHaveProperty('amountKes');
      return {
        transactionId: 9,
        status: 'PENDING',
        notice: 'Accepted for processing; no invoice was paid.',
      };
    });
    const view = render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await screen.findByRole('option', { name: /SYN-3/ });
    await user.selectOptions(screen.getByLabelText('Sandbox integration'), '4');
    await user.selectOptions(screen.getByLabelText('Invoice'), '3');
    await user.type(screen.getByLabelText('Amount (whole KES)'), '20');
    await user.type(screen.getByLabelText('Payment phone (254 format)'), '254700000001');
    await user.click(screen.getByRole('button', { name: 'Request sandbox STK' }));
    await waitFor(() => expect(api.collect).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Request #9: PENDING/)).toBeInTheDocument();
    expect(screen.getByText(/this is not proof of payment/i)).toBeInTheDocument();
    const firstKey = api.collect.mock.calls[0][1];
    view.unmount();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    expect(await screen.findByText(/Saved request for invoice #3/)).toBeInTheDocument();
    expect(api.collect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Check earlier request' }));
    expect(await screen.findByText(/Request #9: PENDING/)).toBeInTheDocument();
    expect(api.recoverCollection).toHaveBeenLastCalledWith(11, firstKey);
    expect(screen.getByRole('button', { name: 'Start a separate request' })).toBeDisabled();
    await user.click(screen.getByLabelText(/I reviewed this request/));
    await user.click(screen.getByRole('button', { name: 'Start a separate request' }));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByText(/different retry identity/)).toBeInTheDocument();
  });

  it('retries an unknown in-flight submission only with the saved identity and explicitly re-entered details', async () => {
    const saved = {
      key: 'synthetic-retry-key',
      invoiceId: 3,
      integrationId: 4,
      allowOverpayment: false,
      confirmSeparateRequest: true,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(saved));
    api.recoverCollection.mockResolvedValueOnce({ recovery: 'NOT_FOUND', transaction: null });
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await user.click(await screen.findByRole('button', { name: 'Check earlier request' }));
    expect(await screen.findByText(/could still arrive/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount (whole KES)'), '20');
    await user.type(screen.getByLabelText('Payment phone (254 format)'), '254700000001');
    expect(
      screen.getByRole('button', { name: 'Retry exact request with same identity' }),
    ).toBeDisabled();
    await user.click(screen.getByLabelText(/I re-entered the exact original amount and phone/));
    await user.click(
      screen.getByRole('button', { name: 'Retry exact request with same identity' }),
    );
    await waitFor(() =>
      expect(api.collect).toHaveBeenCalledWith(
        {
          facilityId: 11,
          invoiceId: 3,
          integrationId: 4,
          amountKes: '20',
          phone: '254700000001',
          allowOverpayment: false,
          confirmSeparateRequest: true,
        },
        saved.key,
      ),
    );
    expect(await screen.findByText(/Request #9: PENDING/)).toBeInTheDocument();
  });

  it('requires explicit review before abandoning a not-found retry identity', async () => {
    const saved = {
      key: 'synthetic-not-found-key',
      invoiceId: 3,
      integrationId: 4,
      allowOverpayment: false,
      confirmSeparateRequest: false,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(saved));
    api.recoverCollection.mockResolvedValue({ recovery: 'NOT_FOUND', transaction: null });
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await user.click(await screen.findByRole('button', { name: 'Check earlier request' }));
    expect(await screen.findByText(/could still arrive/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a separate request' })).toBeDisabled();
    await user.click(screen.getByLabelText(/I reviewed the transaction history/));
    await user.click(screen.getByRole('button', { name: 'Start a separate request' }));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByLabelText(/I reviewed earlier provider requests/)).toBeChecked();
    expect(api.collect).not.toHaveBeenCalled();
  });

  it('paginates and searches invoices without losing the selected integration', async () => {
    api.collectionInvoices.mockImplementation(async (_facility, query, after) => {
      if (query === 'needle')
        return {
          invoices: [{ id: 8, invoiceNumber: 'SYN-needle', balanceAmount: '10.00' }],
          nextCursor: null,
        };
      if (after)
        return {
          invoices: [{ id: 6, invoiceNumber: 'SYN-6', balanceAmount: '50.00' }],
          nextCursor: null,
        };
      return {
        invoices: [{ id: 3, invoiceNumber: 'SYN-3', balanceAmount: '100.00' }],
        nextCursor: 3,
      };
    });
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await screen.findByRole('option', { name: /SYN-3/ });
    await user.selectOptions(screen.getByLabelText('Sandbox integration'), '4');
    await user.click(screen.getByRole('button', { name: 'Load more invoices' }));
    expect(await screen.findByRole('option', { name: /SYN-6/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search invoice number (optional)'), 'needle');
    await user.click(screen.getByRole('button', { name: 'Browse invoices' }));
    expect(await screen.findByRole('option', { name: /SYN-needle/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /SYN-6/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sandbox integration')).toHaveValue('4');
    expect(api.collectionInvoices).toHaveBeenLastCalledWith(11, 'needle');
  });

  it('reports a failed option load and allows an explicit retry', async () => {
    api.collectionIntegrations.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    expect(await screen.findByText(/Sandbox integrations could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/No enabled M-Pesa sandbox integration/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry integration options' }));
    expect(await screen.findByRole('option', { name: /M-Pesa/ })).toBeInTheDocument();
    expect(api.collectionIntegrations).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale recovery from another tab clear the current retry identity', async () => {
    const first = {
      key: 'synthetic-first-key',
      invoiceId: 3,
      integrationId: 4,
      allowOverpayment: false,
      confirmSeparateRequest: false,
    };
    const second = { ...first, key: 'synthetic-second-key' };
    window.localStorage.setItem(storageKey, JSON.stringify(first));
    let finish!: (value: unknown) => void;
    api.recoverCollection.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await user.click(await screen.findByRole('button', { name: 'Check earlier request' }));
    await act(async () => {
      window.localStorage.setItem(storageKey, JSON.stringify(second));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageKey,
          newValue: JSON.stringify(second),
          storageArea: window.localStorage,
        }),
      );
      finish(recorded());
    });
    expect(await screen.findByText(/changed in another tab/)).toBeInTheDocument();
    expect(screen.queryByText(/Request #9: PENDING/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Start a separate request' }),
    ).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).key).toBe(second.key);
    expect(api.collect).not.toHaveBeenCalled();
  });

  it('fails closed without dispatch if durable browser storage fails', async () => {
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await screen.findByRole('option', { name: /SYN-3/ });
    await user.selectOptions(screen.getByLabelText('Sandbox integration'), '4');
    await user.selectOptions(screen.getByLabelText('Invoice'), '3');
    await user.type(screen.getByLabelText('Amount (whole KES)'), '20');
    await user.type(screen.getByLabelText('Payment phone (254 format)'), '254700000001');
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('synthetic quota failure');
    });
    try {
      await user.click(screen.getByRole('button', { name: 'Request sandbox STK' }));
      expect(await screen.findByText(/No new request can be sent/)).toBeInTheDocument();
      expect(api.collect).not.toHaveBeenCalled();
    } finally {
      failure.mockRestore();
    }
  });

  it('does not send if storage silently discards the retry identity', async () => {
    const user = userEvent.setup();
    render(<SandboxCollectionForm />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    await screen.findByRole('option', { name: /SYN-3/ });
    await user.selectOptions(screen.getByLabelText('Sandbox integration'), '4');
    await user.selectOptions(screen.getByLabelText('Invoice'), '3');
    await user.type(screen.getByLabelText('Amount (whole KES)'), '20');
    await user.type(screen.getByLabelText('Payment phone (254 format)'), '254700000001');
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    try {
      await user.click(screen.getByRole('button', { name: 'Request sandbox STK' }));
      expect(await screen.findByText(/No new request can be sent/)).toBeInTheDocument();
      expect(api.collect).not.toHaveBeenCalled();
    } finally {
      failure.mockRestore();
    }
  });

  it('uses the selected cashier invoice without exposing an invoice ID entry and enforces permissions', async () => {
    const user = userEvent.setup();
    const invoice = { id: 3, invoiceNumber: 'SYN-3', balanceAmount: '100.00', status: 'Pending' };
    const view = render(<SandboxCollectionForm selectedInvoice={invoice} />);
    await user.click(screen.getByText('Request M-Pesa sandbox prompt'));
    expect(await screen.findByText(/Selected invoice: SYN-3/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Invoice')).not.toBeInTheDocument();
    expect(api.collectionInvoices).not.toHaveBeenCalled();
    state.user.permissions = ['payment_hub.collection.initiate'];
    view.rerender(<SandboxCollectionForm selectedInvoice={invoice} />);
    expect(screen.queryByText('Request M-Pesa sandbox prompt')).not.toBeInTheDocument();
    state.user = {
      id: 7,
      isSuperAdmin: true,
      permissions: ['payment_hub.collection.initiate', 'billing.read'],
    };
    view.rerender(<SandboxCollectionForm selectedInvoice={invoice} />);
    expect(screen.queryByText('Request M-Pesa sandbox prompt')).not.toBeInTheDocument();
  });

  it('does not show a previous facility’s delayed options after switching facilities', async () => {
    const resolvers = new Map<number, (value: unknown) => void>();
    api.collectionIntegrations.mockImplementation(
      (id: number) => new Promise((resolve) => resolvers.set(id, resolve)),
    );
    const view = render(<SandboxCollectionForm />);
    await waitFor(() => expect(resolvers.has(11)).toBe(true));
    state.facility = { id: 22, name: 'Other synthetic facility' };
    view.rerender(<SandboxCollectionForm />);
    await waitFor(() => expect(resolvers.has(22)).toBe(true));
    await act(async () =>
      resolvers.get(22)?.({
        integrations: [{ id: 5, providerName: 'Other facility' }],
        nextCursor: null,
      }),
    );
    await userEvent.click(screen.getByText('Request M-Pesa sandbox prompt'));
    expect(await screen.findByRole('option', { name: /Other facility/ })).toBeInTheDocument();
    await act(async () =>
      resolvers.get(11)?.({
        integrations: [{ id: 4, providerName: 'Old facility' }],
        nextCursor: null,
      }),
    );
    expect(screen.queryByRole('option', { name: /Old facility/ })).not.toBeInTheDocument();
  });

  it('labels cancellation and query-reported success without claiming a receipt', () => {
    expect(collectionStatusLabel('FAILED', '1032')).toMatch(/CANCELLED/);
    expect(collectionStatusNotice('FAILED', '1032')).toMatch(/No receipt/);
    expect(collectionStatusLabel('PENDING', '4999')).toMatch(/INCONCLUSIVE/);
    expect(collectionStatusLabel('PROVIDER_CONFIRMED', '0')).toMatch(/NOT SETTLED/);
    expect(collectionStatusNotice('PROVIDER_CONFIRMED', '0')).toMatch(/created no invoice payment/);
    expect(collectionStatusNotice('UNKNOWN', null)).toMatch(/unknown/i);
  });
});
