// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mock = vi.hoisted(() => ({
  tenant: { id: 1 },
  facility: { id: 2 },
  permissions: ['inpatient.admit', 'inpatient.read', 'clinical.read'] as string[],
  showToast: vi.fn(),
  triggerRefresh: vi.fn(),
  api: {
    getWards: vi.fn(),
    getAdmissions: vi.fn(),
    getPatients: vi.fn(),
    getPatientDirectoryPage: vi.fn(),
    getBeds: vi.fn(),
    getInpatientBoard: vi.fn(),
    getBedBillingPolicy: vi.fn(),
    getAvailableFacilityServices: vi.fn(),
    getEncounters: vi.fn(),
    createAdmission: vi.fn(),
    getBedOccupancy: vi.fn(),
  },
}));
vi.mock('../../api/client.ts', () => ({ api: mock.api }));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    currentTenant: mock.tenant,
    currentFacility: mock.facility,
    authenticatedUser: { permissions: mock.permissions },
    currentUser: { name: 'Synthetic clinician' },
    showToast: mock.showToast,
    triggerRefresh: mock.triggerRefresh,
    refreshKey: 0,
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
  }),
}));
vi.mock('../../components/modules/BedBillingPolicyPanel.tsx', () => ({
  BedBillingPolicyPanel: () => null,
}));
vi.mock('../../components/modules/BedBillingRecovery.tsx', () => ({
  BedBillingRecovery: () => null,
}));
vi.mock('../../components/modules/NursingPanel.tsx', () => ({ NursingPanel: () => null }));
import { InpatientModule } from '../../components/modules/InpatientModule.tsx';

describe('Admission bed-billing readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.permissions.splice(
      0,
      mock.permissions.length,
      'inpatient.admit',
      'inpatient.read',
      'clinical.read',
    );
    mock.api.getWards.mockResolvedValue([
      {
        id: 5,
        facilityId: 2,
        name: 'Synthetic ward',
        code: 'SYN',
        isActive: true,
        totalBeds: 1,
        dailyRate: null,
      },
    ]);
    mock.api.getBeds.mockResolvedValue([
      {
        id: 6,
        wardId: 5,
        bedNumber: 'SYN-01',
        bedType: 'Standard',
        status: 'Available',
        dailyCharge: '100.00',
        dailyChargeReviewRequired: false,
        priceRevision: 1,
      },
    ]);
    mock.api.getPatients.mockResolvedValue([
      { id: 7, firstName: 'Synthetic', lastName: 'Patient', mrn: 'SYN-7', payerType: 'Cash' },
    ]);
    mock.api.getPatientDirectoryPage.mockImplementation(
      async ({ beforeId }: { beforeId?: number }) =>
        beforeId
          ? {
              items: [
                {
                  id: 3,
                  firstName: 'Synthetic',
                  lastName: 'Older',
                  mrn: 'SYN-3',
                  dateOfBirth: '2000-01-01',
                },
              ],
              nextCursor: null,
            }
          : {
              items: [
                {
                  id: 7,
                  firstName: 'Synthetic',
                  lastName: 'Patient',
                  mrn: 'SYN-7',
                  dateOfBirth: '2000-01-01',
                },
              ],
              nextCursor: 7,
            },
    );
    mock.api.getAdmissions.mockResolvedValue([]);
    mock.api.getInpatientBoard.mockResolvedValue(null);
    mock.api.getBedBillingPolicy.mockResolvedValue(null);
    mock.api.getAvailableFacilityServices.mockResolvedValue([]);
    mock.api.getEncounters.mockResolvedValue([]);
    mock.api.createAdmission.mockResolvedValue({
      id: 1,
      bedBillingReadiness: {
        ready: false,
        issues: [
          { code: 'NOT_CONFIGURED', message: 'No facility bed billing policy is configured.' },
        ],
      },
    });
  });
  afterEach(cleanup);

  it('warns before admission and reports the server readiness result without implying billing is complete', async () => {
    const user = userEvent.setup();
    render(<InpatientModule />);
    await screen.findByText('Synthetic ward — Live Bed Board');
    await user.click(screen.getByRole('button', { name: /Admit Patient to Ward/ }));
    expect(
      await screen.findByText(
        /No facility bed billing policy is configured; billing will require review/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Selected rate: KES 100.00 per night \(bed override\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Automatic encounter creation requires clinical.create/),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Select Patient *'), '7');
    await user.selectOptions(screen.getByLabelText('Admission Type'), 'Elective');
    await user.type(
      screen.getByPlaceholderText('Enter the working diagnosis'),
      'Synthetic diagnosis',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm Admission' }));
    await waitFor(() => expect(mock.api.createAdmission).toHaveBeenCalled());
    expect(mock.api.createAdmission.mock.calls[0][0]).not.toHaveProperty('admissionDate');
    expect(mock.api.createAdmission.mock.calls[0][0]).not.toHaveProperty('encounterId');
    expect(mock.showToast).toHaveBeenCalledWith(
      expect.stringContaining(
        'Bed billing requires review: No facility bed billing policy is configured.',
      ),
    );
  });

  it('selects an older facility patient outside the initial list for admission', async () => {
    const user = userEvent.setup();
    render(<InpatientModule />);
    await screen.findByText('Synthetic ward — Live Bed Board');
    await user.click(screen.getByRole('button', { name: /Admit Patient to Ward/ }));
    await user.click(screen.getByRole('button', { name: 'Find another facility patient' }));
    await screen.findByRole('button', { name: /Synthetic Patient.*DOB/ });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(await screen.findByRole('button', { name: /Synthetic Older.*SYN-3/ }));
    expect(screen.getByLabelText('Select Patient *')).toHaveValue('3');
    await waitFor(() => expect(mock.api.getEncounters).toHaveBeenCalledWith(3, 2));
    await user.selectOptions(screen.getByLabelText('Admission Type'), 'Elective');
    await user.type(
      screen.getByPlaceholderText('Enter the working diagnosis'),
      'Synthetic diagnosis',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm Admission' }));
    await waitFor(() =>
      expect(mock.api.createAdmission).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 3, facilityId: 2 }),
      ),
    );
  });

  it('shows a confirmed ward default when there is no override, but never substitutes it for an unconfirmed legacy override', async () => {
    mock.api.getWards.mockResolvedValue([
      {
        id: 5,
        facilityId: 2,
        name: 'Synthetic ward',
        code: 'SYN',
        isActive: true,
        totalBeds: 1,
        dailyRate: '850.00',
        dailyRateConfigured: true,
        dailyRateRevision: 2,
      },
    ]);
    mock.api.getBeds.mockResolvedValue([
      {
        id: 6,
        wardId: 5,
        bedNumber: 'SYN-01',
        bedType: 'Standard',
        status: 'Available',
        dailyCharge: null,
        dailyChargeReviewRequired: false,
        priceRevision: 1,
      },
    ]);
    const user = userEvent.setup();
    const first = render(<InpatientModule />);
    await screen.findByText('Synthetic ward — Live Bed Board');
    await user.click(screen.getByRole('button', { name: /Admit Patient to Ward/ }));
    expect(
      screen.getByText(/Selected rate: KES 850.00 per night \(ward default\)/),
    ).toBeInTheDocument();
    first.unmount();

    mock.api.getBeds.mockResolvedValue([
      {
        id: 6,
        wardId: 5,
        bedNumber: 'SYN-01',
        bedType: 'Standard',
        status: 'Available',
        dailyCharge: '1500.00',
        dailyChargeReviewRequired: true,
        priceRevision: 1,
      },
    ]);
    render(<InpatientModule />);
    await screen.findByText('Synthetic ward — Live Bed Board');
    await user.click(screen.getByRole('button', { name: /Admit Patient to Ward/ }));
    expect(screen.getByText(/bed override needs explicit price confirmation/i)).toBeInTheDocument();
    expect(screen.queryByText(/Selected rate: KES 850.00/)).not.toBeInTheDocument();
  });

  it('offers only active inpatient encounters and warns about manually timed admissions', async () => {
    mock.permissions.push('clinical.create');
    mock.api.getBedBillingPolicy.mockResolvedValue({
      applicability: { code: 'APPLICABLE', message: 'An active facility-wide policy applies.' },
    });
    mock.api.getEncounters.mockResolvedValue([
      { id: 20, encounterType: 'INPATIENT', status: 'ACTIVE', startedAt: 'Synthetic time' },
      { id: 21, encounterType: 'OUTPATIENT', status: 'ACTIVE', startedAt: 'Synthetic time' },
      { id: 22, encounterType: 'INPATIENT', status: 'COMPLETED', startedAt: 'Synthetic time' },
    ]);
    const user = userEvent.setup();
    render(<InpatientModule />);
    await screen.findByText('Synthetic ward — Live Bed Board');
    await user.click(screen.getByRole('button', { name: /Admit Patient to Ward/ }));
    await user.selectOptions(screen.getByLabelText('Select Patient *'), '7');
    await screen.findByRole('option', { name: /#20/ });
    expect(screen.queryByRole('option', { name: /#21|#22/ })).not.toBeInTheDocument();
    expect(screen.getByText('An active facility-wide policy applies.')).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Historical admission time (optional)'),
      '2020-01-01T08:00:00Z',
    );
    expect(screen.getByText(/one will not be created automatically/i)).toBeInTheDocument();
  });
});
