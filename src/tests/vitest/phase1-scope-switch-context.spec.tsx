// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HmisProvider, useHmis } from '../../context/HmisContext.tsx';
import { api, clearSessionToken, setSessionToken } from '../../api/client.ts';

function Probe() {
  const {
    tenants,
    facilities,
    currentFacility,
    selectedPatient,
    setSelectedPatient,
    isJourneyModalOpen,
    setIsJourneyModalOpen,
    setCurrentFacility,
    setCurrentTenant,
  } = useHmis();
  return (
    <div>
      <span data-testid="facility">{currentFacility?.id ?? 'none'}</span>
      <span data-testid="patient">{selectedPatient?.id ?? 'none'}</span>
      <span data-testid="journey">{String(isJourneyModalOpen)}</span>
      <button
        onClick={() => {
          setSelectedPatient({ id: 11 } as any);
          setIsJourneyModalOpen(true);
        }}
      >
        Select patient
      </button>
      <button onClick={() => currentFacility && setCurrentFacility(currentFacility)}>
        Same facility
      </button>
      <button onClick={() => facilities[1] && setCurrentFacility(facilities[1])}>
        Other facility
      </button>
      <button onClick={() => tenants[1] && void setCurrentTenant(tenants[1])}>Other tenant</button>
    </div>
  );
}

beforeEach(() => {
  clearSessionToken();
  setSessionToken('synthetic-session');
  vi.spyOn(api, 'getSession').mockResolvedValue({
    success: true,
    user: {
      id: 1,
      uid: 'synthetic',
      username: 'synthetic',
      email: 'synthetic@example.test',
      fullName: 'Synthetic',
      tenantId: null,
      facilityId: null,
      roles: ['SUPER_ADMIN'],
      permissions: [],
      isSuperAdmin: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    session: { id: 1, expiresAt: '2099-01-01T00:00:00Z', lastActivityAt: '2026-01-01T00:00:00Z' },
  });
  vi.spyOn(api, 'getTenants').mockResolvedValue([
    { id: 1, name: 'Synthetic tenant A' },
    { id: 2, name: 'Synthetic tenant B' },
  ] as any);
  vi.spyOn(api, 'getFacilities').mockImplementation(
    async (tenantId) =>
      (tenantId === 1
        ? [
            { id: 10, tenantId: 1 },
            { id: 11, tenantId: 1 },
          ]
        : [{ id: 20, tenantId: 2 }]) as any,
  );
});
afterEach(() => {
  cleanup();
  clearSessionToken();
  vi.restoreAllMocks();
});

it('clears selected patient and closes their journey on actual facility or tenant changes', async () => {
  const user = userEvent.setup();
  render(
    <HmisProvider>
      <Probe />
    </HmisProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('facility')).toHaveTextContent('10'));
  await user.click(screen.getByRole('button', { name: 'Select patient' }));
  await user.click(screen.getByRole('button', { name: 'Same facility' }));
  expect(screen.getByTestId('patient')).toHaveTextContent('11');
  expect(screen.getByTestId('journey')).toHaveTextContent('true');
  await user.click(screen.getByRole('button', { name: 'Other facility' }));
  expect(screen.getByTestId('facility')).toHaveTextContent('11');
  expect(screen.getByTestId('patient')).toHaveTextContent('none');
  expect(screen.getByTestId('journey')).toHaveTextContent('false');
  await user.click(screen.getByRole('button', { name: 'Select patient' }));
  await user.click(screen.getByRole('button', { name: 'Other tenant' }));
  await waitFor(() => expect(screen.getByTestId('facility')).toHaveTextContent('20'));
  expect(screen.getByTestId('patient')).toHaveTextContent('none');
  expect(screen.getByTestId('journey')).toHaveTextContent('false');
});
