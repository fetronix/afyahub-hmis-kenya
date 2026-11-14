// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  context: {
    currentTenant: { id: 1 },
    currentFacility: { id: 10 },
    authenticatedUser: { permissions: [], isSuperAdmin: false },
    directorySearch: '',
    setDirectorySearch: vi.fn(),
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: { getPatientDirectoryPage: vi.fn(), createPatient: vi.fn(), createQueueItem: vi.fn() },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../components/portal/PortalInviteDialog.tsx', () => ({
  PortalInviteDialog: () => null,
}));
import { PatientRegistrationModule } from '../../components/modules/PatientRegistrationModule.tsx';

const patient = (id: number, lastName = `Patient${id}`) => ({
  id,
  tenantId: 1,
  registrationFacilityId: 10,
  facilityId: 10,
  mrn: `S-${id}`,
  firstName: 'Synthetic',
  lastName,
  dateOfBirth: '2000-01-01',
  gender: 'Other',
  payerType: 'Self-Pay',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.currentTenant = { id: 1 };
  mocks.context.currentFacility = { id: 10 };
  mocks.context.refreshKey = 0;
  mocks.api.createPatient.mockResolvedValue(patient(100, 'Created'));
  mocks.api.createQueueItem.mockResolvedValue({ tokenNumber: 'SYNTHETIC' });
  mocks.api.getPatientDirectoryPage.mockImplementation(
    async ({ beforeId, search, exactMatch }: any) => {
      if (exactMatch) return { items: [], nextCursor: null };
      if (search) return { items: [patient(3, 'Found')], nextCursor: null };
      return beforeId
        ? { items: [patient(1, 'Older')], nextCursor: null }
        : { items: [patient(50, 'Recent')], nextCursor: 50 };
    },
  );
});
afterEach(cleanup);

describe('Patient directory browsing and duplicate review', () => {
  it('navigates beyond the first page, selects an older patient and returns to page one', async () => {
    const user = userEvent.setup();
    render(<PatientRegistrationModule />);
    await screen.findByRole('button', { name: 'Synthetic Recent' });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    const older = await screen.findByRole('button', { name: 'Synthetic Older' });
    await user.click(older);
    expect(mocks.context.setSelectedPatient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
    expect(mocks.context.setIsJourneyModalOpen).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByRole('button', { name: 'Synthetic Recent' })).toBeInTheDocument();
    expect(mocks.api.getPatientDirectoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1, facilityId: 10, beforeId: 50 }),
    );
  });

  it('routes a directory patient using the selected facility rather than a nonexistent patient facility field', async () => {
    const user = userEvent.setup();
    mocks.api.getPatientDirectoryPage.mockResolvedValue({
      items: [{ ...patient(50, 'Recent'), facilityId: undefined }],
      nextCursor: null,
    });
    render(<PatientRegistrationModule />);
    await screen.findByRole('button', { name: 'Synthetic Recent' });
    await user.click(screen.getByRole('button', { name: '+ Triage' }));
    await waitFor(() =>
      expect(mocks.api.createQueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 1,
          facilityId: 10,
          patientId: 50,
          queueType: 'Triage',
        }),
      ),
    );
  });

  it('searches within the facility and resets pagination', async () => {
    const user = userEvent.setup();
    render(<PatientRegistrationModule />);
    await screen.findByRole('button', { name: 'Synthetic Recent' });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByRole('button', { name: 'Synthetic Older' });
    await user.type(
      screen.getByRole('textbox', { name: 'Search patient directory' }),
      'synthetic-query',
    );
    expect(await screen.findByRole('button', { name: 'Synthetic Found' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(mocks.api.getPatientDirectoryPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tenantId: 1,
        facilityId: 10,
        search: 'synthetic-query',
        beforeId: undefined,
      }),
    );
  });

  it('does not render a late response from a previous facility', async () => {
    const old = deferred<{ items: ReturnType<typeof patient>[]; nextCursor: null }>();
    mocks.api.getPatientDirectoryPage.mockImplementation(({ facilityId }: any) =>
      facilityId === 10
        ? old.promise
        : Promise.resolve({ items: [patient(2, 'Current')], nextCursor: null }),
    );
    const view = render(<PatientRegistrationModule />);
    await waitFor(() => expect(mocks.api.getPatientDirectoryPage).toHaveBeenCalled());
    mocks.context.currentFacility = { id: 20 };
    view.rerender(<PatientRegistrationModule />);
    expect(await screen.findByRole('button', { name: 'Synthetic Current' })).toBeInTheDocument();
    await act(async () => old.resolve({ items: [patient(1, 'Stale')], nextCursor: null }));
    expect(screen.queryByRole('button', { name: 'Synthetic Stale' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Synthetic Current' })).toBeInTheDocument();
  });

  it('checks an exact ID independently of the displayed page and requires review of a match', async () => {
    mocks.api.getPatientDirectoryPage.mockImplementation(async ({ exactMatch }: any) =>
      exactMatch === 'nationalId'
        ? { items: [patient(1, 'Existing')], nextCursor: null }
        : { items: [patient(50, 'Recent')], nextCursor: 50 },
    );
    const user = userEvent.setup();
    render(<PatientRegistrationModule />);
    await user.click(screen.getByRole('button', { name: 'New Patient Registration' }));
    await user.type(screen.getByLabelText('Kenya National ID / Passport'), 'synthetic-id-12345');
    expect(await screen.findByRole('alert')).toHaveTextContent('Possible existing record');
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic Existing');
    const review = screen.getByRole('checkbox', { name: /reviewed this warning/ });
    expect(review).not.toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('e.g. Juma'), { target: { value: 'Synthetic' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Otieno'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Date of Birth *'), { target: { value: '1985-03-14' } });
    fireEvent.change(screen.getByDisplayValue('Select gender'), { target: { value: 'Female' } });
    await user.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    expect(mocks.api.createPatient).not.toHaveBeenCalled();
    expect(mocks.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Review and acknowledge'),
    );
    await user.click(review);
    expect(review).toBeChecked();
    await user.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    await waitFor(() => expect(mocks.api.createPatient).toHaveBeenCalledOnce());
    expect(mocks.api.getPatientDirectoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1, facilityId: 10, exactMatch: 'nationalId' }),
    );
  });

  it('makes a failed duplicate check explicit rather than reporting no match', async () => {
    mocks.api.getPatientDirectoryPage.mockImplementation(async ({ exactMatch }: any) => {
      if (exactMatch) throw new Error('synthetic outage');
      return { items: [], nextCursor: null };
    });
    const user = userEvent.setup();
    render(<PatientRegistrationModule />);
    await user.click(screen.getByRole('button', { name: 'New Patient Registration' }));
    await user.type(screen.getByLabelText('Phone Number (optional)'), '0700000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('check is unavailable');
    expect(screen.queryByText(/No exact match found/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /reviewed this warning/ })).not.toBeChecked();
  });
});
