// @vitest-environment jsdom
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { isSuperAdmin: false, roles: [] as string[], permissions: [] as string[] },
  facility: { id: 11, name: 'Synthetic A' },
}));
const payment = vi.hoisted(() => ({
  catalogue: vi.fn(),
  access: vi.fn(),
  configurationAudit: vi.fn(),
}));
const payer = vi.hoisted(() => ({
  catalogue: vi.fn(),
  requestAccess: vi.fn(),
  configurationAudit: vi.fn(),
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
  adapter: { key, implementedCapabilities: [], note: 'No verified live operation' },
  integrations: [],
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
  state.user = { isSuperAdmin: false, roles: [], permissions: [] };
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
