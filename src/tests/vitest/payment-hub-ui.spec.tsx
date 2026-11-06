// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { isSuperAdmin: false, roles: [] as string[], permissions: [] as string[] },
  facility: { id: 11, name: 'Synthetic facility', enabledModules: ['finance'], hiddenModules: [] },
}));
const api = vi.hoisted(() => ({
  catalogue: vi.fn(),
  access: vi.fn(),
  credentials: vi.fn(),
  reencryptCredentials: vi.fn(),
  revokeCredentials: vi.fn(),
  platform: vi.fn(),
  facilities: vi.fn(),
  transactions: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ authenticatedUser: state.user, currentFacility: state.facility }),
}));
vi.mock('../../api/payment-hub.client.ts', () => ({ paymentHubApi: api }));
import { FacilityPaymentIntegrations } from '../../components/modules/payment-hub/FacilityPaymentIntegrations.tsx';
import { PlatformPaymentProviders } from '../../components/modules/payment-hub/PlatformPaymentProviders.tsx';
import { PaymentTransactions } from '../../components/modules/payment-hub/PaymentTransactions.tsx';

beforeEach(() => {
  vi.resetAllMocks();
  state.user = { isSuperAdmin: false, roles: ['FACILITY_ADMIN'], permissions: [] };
  state.facility = {
    id: 11,
    name: 'Synthetic facility',
    enabledModules: ['finance'],
    hiddenModules: [],
  };
});
describe('payment hub administration views', () => {
  it('shows only requestable facility metadata and requests access', async () => {
    state.user.permissions = ['payment_hub.catalogue.read', 'payment_hub.facility.manage'];
    api.catalogue.mockResolvedValue({
      providers: [
        {
          id: 3,
          code: 'MPESA_DARAJA',
          displayName: 'M-Pesa',
          documentationUrl: 'https://example.test',
          description: 'Sandbox only',
          isAllowed: false,
          requestStatus: 'NOT_REQUESTED',
          availableEnvironments: ['SANDBOX'],
          adapter: {
            key: 'MPESA_DARAJA',
            implementedCapabilities: ['PAYMENT_COLLECTION'],
            note: 'Callback is unverified',
          },
          integrations: [],
        },
      ],
      notice: '',
    });
    api.access.mockResolvedValue({});
    render(<FacilityPaymentIntegrations />);
    expect(await screen.findByText('M-Pesa')).toBeInTheDocument();
    expect(screen.getByText(/Callback is unverified/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(api.access).toHaveBeenCalledWith(3, 11));
    expect(await screen.findByText(/Access request sent/)).toBeInTheDocument();
  });
  it('supports a server-side reference and write-only, masked sandbox credential entry', async () => {
    state.user.permissions = ['payment_hub.catalogue.read', 'payment_hub.credentials.manage'];
    api.catalogue.mockResolvedValue({
      providers: [
        {
          id: 3,
          code: 'MPESA_DARAJA',
          displayName: 'M-Pesa',
          documentationUrl: 'https://example.test',
          description: 'Sandbox only',
          isAllowed: true,
          requestStatus: 'GRANTED',
          availableEnvironments: ['SANDBOX'],
          adapter: {
            key: 'MPESA_DARAJA',
            implementedCapabilities: ['PAYMENT_COLLECTION'],
            note: 'Callback unverified',
          },
          integrations: [
            {
              id: 4,
              providerId: 3,
              environment: 'SANDBOX',
              enabledCapabilities: ['PAYMENT_COLLECTION'],
              isEnabled: false,
              isEffective: false,
              connectionStatus: 'NOT_TESTED',
              lastHealthAt: null,
              lastErrorCode: null,
              productionApproval: 'NOT_REQUESTED',
              credentialsConfigured: false,
              credentialEnvName: 'PAYMENT_HUB_T1_F11_I4_SANDBOX',
              credentials: 'Not configured',
              accounts: [],
            },
          ],
        },
      ],
      notice: '',
    });
    render(<FacilityPaymentIntegrations />);
    await userEvent.click(await screen.findByText('Add facility credential reference'));
    expect(screen.getByText('PAYMENT_HUB_T1_F11_I4_SANDBOX')).toBeInTheDocument();
    expect(screen.getByLabelText('Consumer key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Consumer secret')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('STK passkey')).toHaveAttribute('type', 'password');
    expect(screen.queryByLabelText(/PIN/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Consumer secret')).toHaveValue('');
    api.credentials.mockResolvedValue({});
    await userEvent.click(screen.getByText('Add or replace Daraja sandbox credentials'));
    await userEvent.type(screen.getByLabelText('Consumer key'), 'synthetic-key');
    await userEvent.type(screen.getByLabelText('Consumer secret'), 'synthetic-secret');
    await userEvent.type(screen.getByLabelText('STK passkey'), 'synthetic-passkey');
    await userEvent.type(screen.getByLabelText('Sandbox shortcode'), '123456');
    await userEvent.selectOptions(
      screen.getByLabelText('Authorized transaction type'),
      'CustomerPayBillOnline',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save encrypted sandbox credentials' }),
    );
    await waitFor(() =>
      expect(api.credentials).toHaveBeenCalledWith(4, {
        facilityId: 11,
        source: 'VAULT',
        credentials: {
          consumerKey: 'synthetic-key',
          consumerSecret: 'synthetic-secret',
          passkey: 'synthetic-passkey',
          shortcode: '123456',
          transactionType: 'CustomerPayBillOnline',
        },
        expiresAt: null,
      }),
    );
    expect(screen.getByLabelText('Consumer secret')).toHaveValue('');
  });
  it('offers audited revocation only to an authorized facility administrator', async () => {
    state.user.permissions = ['payment_hub.catalogue.read', 'payment_hub.credentials.manage'];
    api.catalogue.mockResolvedValue({
      providers: [
        {
          id: 3,
          code: 'MPESA_DARAJA',
          displayName: 'M-Pesa',
          documentationUrl: 'https://example.test',
          description: 'Sandbox only',
          isAllowed: true,
          requestStatus: 'GRANTED',
          availableEnvironments: ['SANDBOX'],
          adapter: {
            key: 'MPESA_DARAJA',
            implementedCapabilities: ['HEALTH'],
            note: 'Callback delivery disabled',
          },
          integrations: [
            {
              id: 4,
              providerId: 3,
              environment: 'SANDBOX',
              enabledCapabilities: ['HEALTH'],
              isEnabled: false,
              isEffective: false,
              connectionStatus: 'NOT_TESTED',
              lastHealthAt: null,
              lastErrorCode: null,
              productionApproval: 'NOT_REQUESTED',
              credentialsConfigured: true,
              credentialEnvName: null,
              credentialSource: 'VAULT',
              credentialsExpiresAt: null,
              credentialsExpired: false,
              credentialsRevoked: false,
              credentialsRevokedAt: null,
              credentials: 'Configured (secret hidden)',
              accounts: [],
            },
          ],
        },
      ],
      notice: '',
    });
    api.revokeCredentials.mockResolvedValue({ revoked: true });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const view = render(<FacilityPaymentIntegrations />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Revoke stored credentials' }),
      );
      await waitFor(() => expect(api.revokeCredentials).toHaveBeenCalledWith(4, 11));
      state.user.roles = ['CLERK'];
      view.rerender(<FacilityPaymentIntegrations />);
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Revoke stored credentials' }),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByText('Add or replace Daraja sandbox credentials'),
      ).not.toBeInTheDocument();
    } finally {
      confirmation.mockRestore();
    }
  });
  it('keeps restricted credential security maintenance available without exposing activation', async () => {
    state.user.permissions = ['payment_hub.catalogue.read', 'payment_hub.credentials.manage'];
    api.catalogue.mockResolvedValue({
      providers: [
        {
          id: 3,
          code: 'MPESA_DARAJA',
          displayName: 'M-Pesa',
          documentationUrl: 'https://example.test',
          description: 'Sandbox only',
          isAllowed: false,
          status: 'DISABLED',
          requestable: false,
          requestStatus: 'NOT_REQUESTED',
          availableEnvironments: [],
          adapter: { key: 'MPESA_DARAJA', implementedCapabilities: [], note: 'Unavailable' },
          integrations: [
            {
              id: 4,
              environment: 'SANDBOX',
              enabledCapabilities: [],
              credentialsConfigured: true,
              credentialsRevoked: false,
            },
          ],
        },
      ],
      notice: '',
    });
    api.revokeCredentials.mockResolvedValue({ revoked: true });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<FacilityPaymentIntegrations />);
      expect(await screen.findByText(/provider disabled or unassigned/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /enable sandbox/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Revoke stored credentials' }));
      await waitFor(() => expect(api.revokeCredentials).toHaveBeenCalledWith(4, 11));
    } finally {
      confirmation.mockRestore();
    }
  });
  it('does not show stale transaction data after switching facilities, even when requests resolve out of order', async () => {
    state.user.permissions = ['payment_hub.transactions.read'];
    const pending = new Map<number, (data: unknown) => void>();
    api.transactions.mockImplementation(
      (id: number) => new Promise((resolve) => pending.set(id, resolve)),
    );
    const tx = (invoiceNumber: string) => ({
      transactions: [
        {
          id: 1,
          integrationId: 2,
          provider: 'M-Pesa',
          environment: 'SANDBOX',
          invoiceId: 1,
          invoiceNumber,
          requestedAmountCents: '2000',
          providerRequestId: 'ws_test',
          status: 'PENDING',
          resultCode: null,
          createdAt: '2026-01-01',
          lastQueryAt: null,
          unverifiedNotifications: 0,
        },
      ],
      notifications: [],
      reconciliations: [],
      notice: '',
    });
    const view = render(<PaymentTransactions />);
    await waitFor(() => expect(pending.has(11)).toBe(true));
    state.facility = {
      id: 22,
      name: 'Other synthetic facility',
      enabledModules: ['finance'],
      hiddenModules: [],
    };
    view.rerender(<PaymentTransactions />);
    await waitFor(() => expect(pending.has(22)).toBe(true));
    await act(async () => {
      pending.get(22)?.(tx('SYN-OTHER'));
    });
    expect(await screen.findByText(/SYN-OTHER/)).toBeInTheDocument();
    await act(async () => {
      pending.get(11)?.(tx('SYN-OLD'));
    });
    expect(screen.queryByText(/SYN-OLD/)).not.toBeInTheDocument();
    expect(screen.getByText(/SYN-OTHER/)).toBeInTheDocument();
  });
  it('does not show a stale integration catalogue after switching facilities', async () => {
    state.user.permissions = ['payment_hub.catalogue.read'];
    const pending = new Map<number, (data: unknown) => void>();
    api.catalogue.mockImplementation(
      (id: number) => new Promise((resolve) => pending.set(id, resolve)),
    );
    const provider = (name: string) => ({
      providers: [
        {
          id: 1,
          code: 'TEST',
          displayName: name,
          documentationUrl: 'https://example.test',
          description: 'synthetic',
          isAllowed: false,
          requestStatus: 'NOT_REQUESTED',
          availableEnvironments: ['SANDBOX'],
          adapter: { key: 'UNCONFIGURED', implementedCapabilities: [], note: 'Not connected' },
          integrations: [],
        },
      ],
      notice: '',
    });
    const view = render(<FacilityPaymentIntegrations />);
    await waitFor(() => expect(pending.has(11)).toBe(true));
    state.facility = {
      id: 22,
      name: 'Other synthetic facility',
      enabledModules: ['finance'],
      hiddenModules: [],
    };
    view.rerender(<FacilityPaymentIntegrations />);
    await waitFor(() => expect(pending.has(22)).toBe(true));
    await act(async () => {
      pending.get(22)?.(provider('Other facility provider'));
    });
    expect(await screen.findByText('Other facility provider')).toBeInTheDocument();
    await act(async () => {
      pending.get(11)?.(provider('Old facility provider'));
    });
    expect(screen.queryByText('Old facility provider')).not.toBeInTheDocument();
    expect(screen.getByText('Other facility provider')).toBeInTheDocument();
  });
  it('does not open the facility view for a platform administrator', () => {
    state.user = {
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: ['payment_hub.catalogue.read'],
    };
    render(<FacilityPaymentIntegrations />);
    expect(
      screen.getByText(/Facility configuration requires an authorized facility user/),
    ).toBeInTheDocument();
    expect(api.catalogue).not.toHaveBeenCalled();
  });
  it('shows platform metadata without facility financial records', async () => {
    state.user = {
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: ['payment_hub.global.read'],
    };
    api.platform.mockResolvedValue({
      providers: [],
      assignments: [],
      requests: [],
      auditEvents: [],
      notice: 'metadata only',
    });
    render(<PlatformPaymentProviders />);
    expect(await screen.findByText('No providers have been registered.')).toBeInTheDocument();
    expect(
      screen.getByText(/credentials, balances and transactions are not visible here/),
    ).toBeInTheDocument();
  });
  it('displays pending and unverified finance records without a paid label', async () => {
    state.user.permissions = ['payment_hub.transactions.read'];
    api.transactions.mockResolvedValue({
      transactions: [
        {
          id: 10,
          integrationId: 2,
          provider: 'M-Pesa',
          environment: 'SANDBOX',
          invoiceId: 1,
          invoiceNumber: 'SYN-1',
          requestedAmountCents: '2000',
          providerRequestId: 'ws_synthetic',
          status: 'PENDING',
          resultCode: null,
          createdAt: '2026-01-01',
          lastQueryAt: null,
          unverifiedNotifications: 1,
        },
      ],
      notifications: [
        {
          id: 7,
          transactionId: 10,
          resultCode: '0',
          verificationState: 'UNVERIFIED',
          receivedAt: '2026-01-01',
        },
      ],
      reconciliations: [],
      notice: '',
    });
    render(<PaymentTransactions />);
    expect(await screen.findByText('PENDING')).toBeInTheDocument();
    expect(screen.getByText(/UNVERIFIED/)).toBeInTheDocument();
    expect(screen.getByText(/not proof of payment/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Query provider status' })).not.toBeInTheDocument();
  });
});
