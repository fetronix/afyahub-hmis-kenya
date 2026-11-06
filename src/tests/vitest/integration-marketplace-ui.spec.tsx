// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubIntegration } from '../../api/payment-hub.client.ts';

const state = vi.hoisted(() => ({
  user: { isSuperAdmin: false, roles: [] as string[], permissions: [] as string[] },
  facility: { id: 11, name: 'Synthetic A' },
}));
const payment = vi.hoisted(() => ({
  catalogue: vi.fn(),
  access: vi.fn(),
  credentials: vi.fn(),
  health: vi.fn(),
  configurationAudit: vi.fn(),
}));
const payer = vi.hoisted(() => ({
  catalogue: vi.fn(),
  requestAccess: vi.fn(),
  configurationAudit: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ currentFacility: state.facility, authenticatedUser: state.user }),
}));
vi.mock('../../api/payment-hub.client.ts', () => ({ paymentHubApi: payment }));
vi.mock('../../api/payer-hub.client.ts', () => ({ payerHubApi: payer }));
import { FacilityIntegrationHub } from '../../components/modules/FacilityIntegrationHub.tsx';

const payProvider = (id: number, key: string, name: string) => ({
  id,
  code: key,
  adapterKey: key,
  displayName: name,
  documentationUrl: 'https://example.test/',
  description: 'Provider status not verified',
  isAllowed: false,
  requestStatus: 'NOT_REQUESTED',
  availableEnvironments: ['SANDBOX'],
  adapter: { key, implementedCapabilities: [] as string[], note: 'No verified live operation' },
  integrations: [] as HubIntegration[],
});
const payerProvider = (id: number, type: string, name: string) => ({
  id,
  code: name.toUpperCase(),
  displayName: name,
  payerType: type,
  adapterKey: 'manual',
  informationUrl: 'https://example.test/',
  status: 'ACTIVE',
  requestable: true,
  isAssigned: false,
  assignmentSource: null,
  requestStatus: 'NOT_REQUESTED',
  isActive: false,
  connectionStatus: 'NOT_VERIFIED',
  sandboxStatus: 'NOT_TESTED',
  productionApproval: 'NOT_REQUESTED',
  processing: 'Manual internal processing; no authorized live API',
  environments: [],
  workflows: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  state.user = { isSuperAdmin: false, roles: ['FACILITY_ADMIN'], permissions: [] };
  state.facility = { id: 11, name: 'Synthetic A' };
  payment.catalogue.mockResolvedValue({
    providers: [payProvider(1, 'MPESA_DARAJA', 'M-Pesa'), payProvider(2, 'KCB_BUNI', 'KCB')],
    notice: '',
  });
  payment.access.mockResolvedValue({});
  payer.catalogue.mockResolvedValue({
    providers: [
      payerProvider(3, 'PRIVATE_INSURER', 'Britam'),
      payerProvider(4, 'PUBLIC_SCHEME', 'SHA'),
    ],
    notice: '',
  });
});

describe('facility integration marketplace', () => {
  it('filters actual authorized catalogues by category and preserves access requests', async () => {
    state.user.permissions = [
      'payment_hub.catalogue.read',
      'payment_hub.facility.manage',
      'payer_hub.catalogue.read',
    ];
    render(<FacilityIntegrationHub />);
    expect(await screen.findByText('M-Pesa')).toBeInTheDocument();
    expect(await screen.findByText('Britam')).toBeInTheDocument();
    expect(screen.getByText(/Synthetic A · Discover providers/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Banking' }));
    expect(await screen.findByText('KCB')).toBeInTheDocument();
    expect(screen.queryByText('M-Pesa')).not.toBeInTheDocument();
    expect(screen.queryByText('Britam')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(payment.access).toHaveBeenCalledWith(2, 11));
    await userEvent.click(screen.getByRole('button', { name: 'Private insurance' }));
    expect(await screen.findByText('Britam')).toBeInTheDocument();
    expect(screen.queryByText('KCB')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Public schemes' }));
    expect(await screen.findByText('SHA')).toBeInTheDocument();
    expect(screen.getByText('AfyaLink')).toBeInTheDocument();
    expect(screen.getByText('DHA eClaims / HIE')).toBeInTheDocument();
    expect(screen.getAllByText(/Live transport unavailable/)).toHaveLength(2);
    expect(screen.queryByText('Britam')).not.toBeInTheDocument();
  });
  it('never requests or renders a domain without its independent catalogue permission', async () => {
    state.user.permissions = ['payer_hub.catalogue.read'];
    render(<FacilityIntegrationHub />);
    expect(await screen.findByText('Britam')).toBeInTheDocument();
    expect(payment.catalogue).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Banking' })).not.toBeInTheDocument();
    expect(screen.queryByText('M-Pesa')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View configuration activity' }),
    ).not.toBeInTheDocument();
  });
  it('loads only authorized, sanitized configuration activity and drops stale facility responses', async () => {
    state.user.permissions = ['payment_hub.catalogue.read', 'payment_hub.facility.manage'];
    let resolveAudit: (value: unknown) => void = () => {};
    payment.configurationAudit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAudit = resolve;
        }),
    );
    const view = render(<FacilityIntegrationHub />);
    await screen.findByText('M-Pesa');
    await userEvent.click(screen.getByRole('button', { name: 'View configuration activity' }));
    expect(payment.configurationAudit).toHaveBeenCalledWith(11);
    state.facility = { id: 22, name: 'Synthetic B' };
    view.rerender(<FacilityIntegrationHub />);
    expect(await screen.findByText(/Synthetic B · Discover providers/)).toBeInTheDocument();
    await act(async () =>
      resolveAudit({
        events: [
          {
            id: 9,
            action: 'UPDATE',
            resource: 'payment_hub.credentials',
            resourceId: '9',
            actorUserId: '1',
            timestamp: '2026-11-06T00:00:00Z',
          },
        ],
      }),
    );
    expect(screen.queryByText(/payment_hub.credentials #9/)).not.toBeInTheDocument();
    expect(payer.configurationAudit).not.toHaveBeenCalled();
  });
  it('does not expose administration to non-admins even when delegated management permissions are present', async () => {
    state.user.roles = ['CLERK'];
    state.user.permissions = [
      'payment_hub.catalogue.read',
      'payment_hub.facility.manage',
      'payment_hub.credentials.manage',
      'payer_hub.catalogue.read',
      'payer_hub.facility.manage',
      'payer_hub.credentials.manage',
    ];
    render(<FacilityIntegrationHub />);
    expect(await screen.findByText('M-Pesa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View configuration activity' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Private insurance' }));
    expect(await screen.findByText('Britam')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request payer access' })).not.toBeInTheDocument();
  });
  it('allows a facility administrator to revoke a retained payer reference after unassignment', async () => {
    state.user.permissions = ['payer_hub.catalogue.read', 'payer_hub.credentials.manage'];
    const response = await payer.catalogue();
    response.providers[0].environments = [
      {
        environment: 'SANDBOX',
        secretReference: 'PAYER_SYNTHETIC',
        revoked: false,
        configured: true,
        connectionVerified: false,
      },
    ];
    payer.catalogue.mockResolvedValue(response);
    payer.revoke.mockResolvedValue({ revoked: true });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<FacilityIntegrationHub />);
      await userEvent.click(await screen.findByRole('button', { name: 'Private insurance' }));
      expect(
        await screen.findByText(/retained references can still be revoked/i),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Revoke sandbox reference' }));
      await waitFor(() =>
        expect(payer.revoke).toHaveBeenCalledWith(response.providers[0].id, 11, 'SANDBOX'),
      );
      expect(
        screen.queryByRole('button', { name: 'Activate accepted payer' }),
      ).not.toBeInTheDocument();
    } finally {
      confirmation.mockRestore();
    }
  });
  it.each([
    [
      'KCB_BUNI',
      'KCB',
      { 'KCB consumer key': 'synthetic-kcb-key', 'KCB consumer secret': 'synthetic-kcb-secret' },
      { consumerKey: 'synthetic-kcb-key', consumerSecret: 'synthetic-kcb-secret' },
    ],
    [
      'EQUITY',
      'Jenga',
      {
        'Jenga merchant code': 'synthetic-merchant',
        'Jenga consumer secret': 'synthetic-jenga-secret',
        'Jenga API key': 'synthetic-jenga-key',
      },
      {
        merchantCode: 'synthetic-merchant',
        consumerSecret: 'synthetic-jenga-secret',
        apiKey: 'synthetic-jenga-key',
      },
    ],
  ])(
    'configures the %s sandbox vault and describes the authentication-only check',
    async (key, label, fields, expected) => {
      state.user.permissions = [
        'payment_hub.catalogue.read',
        'payment_hub.facility.manage',
        'payment_hub.credentials.manage',
      ];
      const provider = payProvider(2, key, label);
      provider.isAllowed = true;
      provider.adapter.implementedCapabilities = ['HEALTH'];
      provider.integrations = [
        {
          id: 42,
          providerId: 2,
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
      ] as typeof provider.integrations;
      payment.catalogue.mockResolvedValue({ providers: [provider], notice: '' });
      payment.credentials.mockResolvedValue({ configured: true });
      payment.health.mockResolvedValue({ status: 'HEALTHY' });
      render(<FacilityIntegrationHub />);
      await userEvent.click(await screen.findByRole('button', { name: 'Banking' }));
      await userEvent.click(await screen.findByText(`Add or replace ${label} sandbox credentials`));
      for (const [name, value] of Object.entries(fields))
        await userEvent.type(screen.getByLabelText(name), value);
      await userEvent.click(
        screen.getByRole('button', { name: `Save encrypted ${label} credentials` }),
      );
      await waitFor(() =>
        expect(payment.credentials).toHaveBeenCalledWith(42, {
          facilityId: 11,
          source: 'VAULT',
          credentials: expected,
          expiresAt: null,
        }),
      );
      for (const name of Object.keys(fields)) expect(screen.getByLabelText(name)).toHaveValue('');
      expect(
        screen.getByText(/Configured · sandbox authentication not yet verified/),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Test sandbox authentication' }));
      await waitFor(() => expect(payment.health).toHaveBeenCalledWith(42, 11));
      expect(
        await screen.findByText(/account access and payments remain unverified/),
      ).toBeInTheDocument();
      for (const value of Object.values(fields))
        expect(document.body.textContent).not.toContain(value);
    },
  );

  it('does not treat platform administration as facility authorization', () => {
    state.user = {
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: ['payment_hub.catalogue.read', 'payer_hub.catalogue.read'],
    };
    render(<FacilityIntegrationHub />);
    expect(screen.getByText(/authorized facility-scoped user/)).toBeInTheDocument();
    expect(payment.catalogue).not.toHaveBeenCalled();
    expect(payer.catalogue).not.toHaveBeenCalled();
  });
});
