// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  getPortalToken: vi.fn(),
  clearPortalToken: vi.fn(),
  loginPortal: vi.fn(),
  logoutPortal: vi.fn(),
  activatePortalAccount: vi.fn(),
  api: {
    me: vi.fn(),
    overview: vi.fn(),
    card: vi.fn(),
    accessHistory: vi.fn(),
    changePassword: vi.fn(),
  },
}));
vi.mock('../../api/portal-client.ts', () => ({
  getPortalToken: mocks.getPortalToken,
  clearPortalToken: mocks.clearPortalToken,
  loginPortal: mocks.loginPortal,
  logoutPortal: mocks.logoutPortal,
  activatePortalAccount: mocks.activatePortalAccount,
  portalApi: mocks.api,
  PortalApiError: class extends Error {
    status = 500;
  },
}));
import { PatientPortalApp } from '../../components/portal/PortalApp.tsx';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/portal');
  mocks.getPortalToken.mockReturnValue('synthetic-session');
  mocks.api.me.mockResolvedValue({
    account: { status: 'ACTIVE' },
    patient: { firstName: 'Synthetic', lastName: 'Patient', mrn: 'SYNTHETIC' },
    facilityName: 'Synthetic facility',
  });
  mocks.api.overview.mockResolvedValue({
    visits: [],
    upcomingAppointments: [],
    activeAllergies: [],
    recentVerifiedResults: [],
    recentMedications: [],
    releasedSections: {},
  });
  mocks.api.card.mockResolvedValue({ svg: '', issuedAt: null });
  mocks.api.accessHistory.mockResolvedValue([]);
});
afterEach(cleanup);

it('clears the local token and returns to sign-in after a successful password change', async () => {
  mocks.api.changePassword.mockResolvedValue({
    success: true,
    sessionsRevoked: 1,
    message:
      'Password changed. All devices, including this one, have been signed out. Sign in again.',
  });
  const user = userEvent.setup();
  render(<PatientPortalApp />);
  await screen.findByRole('heading', { name: 'Synthetic Patient' });
  await user.click(screen.getAllByRole('button', { name: 'Account' })[0]!);
  await user.type(screen.getByLabelText('Current password'), 'synthetic-old-password');
  await user.type(screen.getByLabelText(/^New password/), 'synthetic-new-password');
  await user.type(screen.getByLabelText('Repeat the new password'), 'synthetic-new-password');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(
    await screen.findByRole('heading', { name: 'Sign in to your record' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/All devices, including this one/)).toBeInTheDocument();
  expect(mocks.clearPortalToken).toHaveBeenCalledOnce();
  expect(screen.queryByRole('heading', { name: 'Synthetic Patient' })).not.toBeInTheDocument();
});
