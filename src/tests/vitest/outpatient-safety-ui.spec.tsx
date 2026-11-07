// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  context: {
    currentTenant: { id: 1 },
    currentFacility: { id: 2 },
    currentUser: { name: 'Synthetic Clinician', role: 'Doctor' },
    authenticatedUser: null as null | { isSuperAdmin: boolean; permissions: string[] },
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getPatients: vi.fn(),
    getPatientDirectoryPage: vi.fn(),
    updateQueueStatus: vi.fn(),
    getLabTests: vi.fn(),
    getClinicalCatalogue: vi.fn(),
    getAvailableFacilityServices: vi.fn(),
    createEncounter: vi.fn(),
    createLabOrderBatch: vi.fn(),
    getQueues: vi.fn(),
    getEncounters: vi.fn(),
    getObservations: vi.fn(),
    getDiagnoses: vi.fn(),
    getMedications: vi.fn(),
    prescribeMedication: vi.fn(),
    createQueueItem: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api, ApiError: class extends Error {} }));
import { OutpatientModule } from '../../components/modules/OutpatientModule.tsx';

const patients = [
  { id: 11, firstName: 'Synthetic', lastName: 'One', mrn: 'P-11', allergies: null },
  { id: 22, firstName: 'Synthetic', lastName: 'Two', mrn: 'P-22', allergies: null },
];
const encounter = (patientId: number) => ({
  id: patientId + 100,
  tenantId: 1,
  facilityId: 2,
  patientId,
  status: 'Active',
});

describe('Outpatient worklist and patient isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.refreshKey = 0;
    mocks.context.currentTenant = { id: 1 };
    mocks.context.currentFacility = { id: 2 };
    mocks.context.authenticatedUser = null;
    mocks.api.getPatients.mockResolvedValue(patients);
    mocks.api.getPatientDirectoryPage.mockResolvedValue({ items: [], nextCursor: null });
    mocks.api.updateQueueStatus.mockResolvedValue({});
    mocks.api.getLabTests.mockResolvedValue([]);
    mocks.api.getClinicalCatalogue.mockResolvedValue([]);
    mocks.api.getAvailableFacilityServices.mockResolvedValue([]);
    mocks.api.createEncounter.mockResolvedValue({
      id: 111,
      tenantId: 1,
      facilityId: 2,
      patientId: 11,
      status: 'Active',
      consultationMasterServiceId: 7,
    });
    mocks.api.createLabOrderBatch.mockResolvedValue({ orders: [{ id: 1 }, { id: 2 }], queue: {} });
    mocks.api.getQueues.mockResolvedValue([]);
    mocks.api.getEncounters.mockImplementation(async (id: number) => [encounter(id)]);
    mocks.api.getObservations.mockResolvedValue([]);
    mocks.api.getDiagnoses.mockResolvedValue([]);
    mocks.api.getMedications.mockResolvedValue([]);
    mocks.api.prescribeMedication.mockResolvedValue({
      id: 50,
      drugName: 'Synthetic drug',
      status: 'Prescribed',
    });
    mocks.api.createQueueItem.mockResolvedValue({ tokenNumber: 'P-1' });
  });
  afterEach(cleanup);

  it('exposes encounter billing only to a non-platform account with billing.read', async () => {
    const user = userEvent.setup();
    mocks.context.authenticatedUser = { isSuperAdmin: false, permissions: ['billing.read'] };
    const view = render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    expect(await screen.findByText('Encounter billing and receipts')).toBeInTheDocument();
    view.unmount();
    mocks.context.authenticatedUser = { isSuperAdmin: true, permissions: ['billing.read'] };
    const platform = render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await screen.findByText('Triage Vital Signs');
    expect(screen.queryByText('Encounter billing and receipts')).not.toBeInTheDocument();
    platform.unmount();
    mocks.context.authenticatedUser = { isSuperAdmin: false, permissions: [] };
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await screen.findByText('Triage Vital Signs');
    expect(screen.queryByText('Encounter billing and receipts')).not.toBeInTheDocument();
  });

  it('does not require the unused legacy lab list to open outpatient care', async () => {
    mocks.api.getLabTests.mockRejectedValue(new Error('no laboratory access'));
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    expect(await screen.findByText('Triage Vital Signs')).toBeInTheDocument();
    expect(mocks.api.getLabTests).not.toHaveBeenCalled();
  });

  it('shows an outpatient data failure and retries instead of an empty queue', async () => {
    mocks.api.getQueues.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<OutpatientModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Do not assume the triage queue is empty',
    );
    await user.click(screen.getByRole('button', { name: 'Retry outpatient data' }));
    expect(await screen.findByRole('button', { name: /Synthetic One/ })).toBeInTheDocument();
  });

  it('does not offer a new visit when loading the existing visit fails', async () => {
    mocks.api.getEncounters.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Do not assume there is no active visit',
    );
    expect(
      screen.queryByRole('button', { name: 'Start outpatient visit' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry patient visit' }));
    expect(await screen.findByText('Triage Vital Signs')).toBeInTheDocument();
  });

  it('ignores a delayed encounter for a patient who is no longer selected', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.api.getEncounters.mockImplementation((id: number) =>
      id === 11
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve([encounter(id)]),
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await user.click(screen.getByRole('button', { name: /Synthetic Two/ }));
    expect(await screen.findByText('Triage Vital Signs')).toBeInTheDocument();
    finish([encounter(11)]);
    await waitFor(() => expect(mocks.api.getObservations).toHaveBeenCalledWith(122));
    expect(mocks.api.getObservations).not.toHaveBeenCalledWith(111);
    expect(screen.getByText('Allergies:').textContent).toContain('Not recorded');
  });

  it('browses beyond the first directory page and selects the older patient for care', async () => {
    const older = {
      id: 7,
      firstName: 'Synthetic',
      lastName: 'Older',
      mrn: 'P-7',
      dateOfBirth: '2000-01-01',
    };
    mocks.api.getPatientDirectoryPage.mockImplementation(
      async ({ beforeId }: { beforeId?: number }) =>
        beforeId
          ? { items: [older], nextCursor: null }
          : { items: [{ ...patients[0], dateOfBirth: '2000-01-01' }], nextCursor: 11 },
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await screen.findByRole('button', { name: /Synthetic One/ });
    await user.click(screen.getByRole('button', { name: 'Find another facility patient' }));
    await screen.findByRole('button', { name: /Synthetic One.*DOB/ });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(await screen.findByRole('button', { name: /Synthetic Older.*P-7/ }));
    await waitFor(() => expect(mocks.api.getEncounters).toHaveBeenCalledWith(7, 2));
    expect(mocks.api.getPatientDirectoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1, facilityId: 2, beforeId: 11 }),
    );
    expect(
      screen.queryByRole('region', { name: 'Find a facility patient' }),
    ).not.toBeInTheDocument();
  });

  it('resolves a queued patient absent from the carousel through the scoped audited directory', async () => {
    const older = {
      id: 7,
      firstName: 'Synthetic',
      lastName: 'Older',
      mrn: 'P-7',
      dateOfBirth: '2000-01-01',
    };
    mocks.api.getQueues.mockResolvedValue([
      { id: 9, patientId: 7, tokenNumber: 'TRG-7', status: 'Waiting' },
    ]);
    mocks.api.getPatientDirectoryPage.mockResolvedValue({ items: [older], nextCursor: null });
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /TRG-7/ }));
    await waitFor(() => expect(mocks.api.getEncounters).toHaveBeenCalledWith(7, 2));
    expect(mocks.api.getPatientDirectoryPage).toHaveBeenCalledWith({
      tenantId: 1,
      facilityId: 2,
      patientId: 7,
    });
  });

  it('does not select a queued patient not found in the scoped facility directory', async () => {
    mocks.api.getQueues.mockResolvedValue([
      { id: 9, patientId: 7, tokenNumber: 'TRG-7', status: 'Waiting' },
    ]);
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /TRG-7/ }));
    await waitFor(() =>
      expect(mocks.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('could not be resolved'),
      ),
    );
    expect(mocks.api.getEncounters).not.toHaveBeenCalled();
  });

  it('ignores a delayed queued-patient lookup after another patient is selected', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.api.getQueues.mockResolvedValue([
      { id: 9, patientId: 7, tokenNumber: 'TRG-7', status: 'Waiting' },
    ]);
    mocks.api.getPatientDirectoryPage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /TRG-7/ }));
    await user.click(screen.getByRole('button', { name: /Synthetic Two/ }));
    await screen.findByText('Triage Vital Signs');
    await act(async () =>
      finish({ items: [{ id: 7, firstName: 'Synthetic', lastName: 'Old' }], nextCursor: null }),
    );
    expect(mocks.api.getEncounters).toHaveBeenCalledWith(22, 2);
    expect(mocks.api.getEncounters).not.toHaveBeenCalledWith(7, 2);
  });

  it('does not clear the next patient’s notes when an earlier visit’s queue update returns late', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.api.getQueues.mockResolvedValue([
      { id: 9, patientId: 11, tokenNumber: 'TRG-1', status: 'Waiting' },
    ]);
    mocks.api.getEncounters.mockImplementation(async (id: number) =>
      id === 11 ? [] : [{ ...encounter(id), clinicalNotes: 'Second patient notes' }],
    );
    mocks.api.updateQueueStatus.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /^Synthetic\s+One\s*P-11$/ }));
    await user.click(await screen.findByRole('button', { name: 'Start outpatient visit' }));
    await waitFor(() => expect(mocks.api.updateQueueStatus).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /Synthetic Two/ }));
    const notes = await screen.findByPlaceholderText(
      'Impression, clinical advice, lifestyle counseling...',
    );
    expect(notes).toHaveValue('Second patient notes');
    await act(async () => finish({}));
    expect(notes).toHaveValue('Second patient notes');
  });

  it('clears a prescription draft on patient change', async () => {
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await screen.findByText('Triage Vital Signs');
    await user.type(screen.getByPlaceholderText('Drug Name'), 'old draft');
    await user.click(screen.getByRole('button', { name: /Synthetic Two/ }));
    await screen.findByText('Triage Vital Signs');
    expect(screen.getByPlaceholderText('Drug Name')).toHaveValue('');
  });
  it('reports a saved prescription separately from an unconfirmed pharmacy route', async () => {
    mocks.api.createQueueItem.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await screen.findByText('Triage Vital Signs');
    for (const [placeholder, value] of [
      ['Drug Name', 'Synthetic drug'],
      ['Dosage (e.g. 500mg)', '1 mg'],
      ['Frequency (TDS / BD)', 'daily'],
      ['Duration (5 days)', '1 day'],
      ['Route (e.g. Oral)', 'oral'],
      ['Quantity', '1'],
      ['Unit price (KES)', '1'],
    ])
      await user.type(screen.getByPlaceholderText(placeholder), value);
    await user.click(screen.getByRole('button', { name: 'Prescribe & Route to Pharmacy' }));
    await waitFor(() =>
      expect(mocks.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Prescription saved, but pharmacy routing could not be confirmed'),
      ),
    );
    expect(mocks.api.prescribeMedication).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Drug Name')).toHaveValue('');
  });

  it('does not display a delayed prescription under another patient', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.api.prescribeMedication.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await screen.findByText('Triage Vital Signs');
    for (const [placeholder, value] of [
      ['Drug Name', 'Synthetic drug'],
      ['Dosage (e.g. 500mg)', '1 mg'],
      ['Frequency (TDS / BD)', 'daily'],
      ['Duration (5 days)', '1 day'],
      ['Route (e.g. Oral)', 'oral'],
      ['Quantity', '1'],
      ['Unit price (KES)', '1'],
    ])
      await user.type(screen.getByPlaceholderText(placeholder), value);
    await user.click(screen.getByRole('button', { name: 'Prescribe & Route to Pharmacy' }));
    await user.click(screen.getByRole('button', { name: /Synthetic Two/ }));
    await screen.findByText('Triage Vital Signs');
    finish({ id: 50, drugName: 'Synthetic drug', status: 'Prescribed' });
    await waitFor(() => expect(mocks.api.createQueueItem).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Synthetic drug')).not.toBeInTheDocument();
  });
  it('allows optional consultation selection and shows facility prices without a compulsory modal', async () => {
    mocks.api.getEncounters.mockResolvedValue([]);
    mocks.api.getAvailableFacilityServices.mockImplementation(
      async (_facility: number, filter: { category: string }) =>
        filter.category === 'CONSULTATION'
          ? [
              {
                id: 7,
                code: 'SYN-FOLLOW',
                name: 'Synthetic follow-up',
                department: 'opd',
                unit: 'Visit',
                unitPrice: '150.00',
              },
              {
                id: 8,
                code: 'SYN-CONS',
                name: 'Synthetic consultation',
                department: 'opd',
                unit: 'Visit',
                unitPrice: '100.00',
              },
            ]
          : [],
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    const select = await screen.findByLabelText('Consultation service');
    expect(select).toHaveTextContent('Synthetic follow-up · KES 150.00');
    expect(screen.getByRole('button', { name: 'Start outpatient visit' })).toBeEnabled();
    await user.selectOptions(select, '7');
    await user.click(screen.getByRole('button', { name: 'Start outpatient visit' }));
    await waitFor(() =>
      expect(mocks.api.createEncounter).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 11,
          facilityId: 2,
          consultationFacilityServiceId: 7,
          idempotencyKey: expect.any(String),
        }),
      ),
    );
  });

  it('retains a selected facility identity if the catalogue refreshes before a mixed order is submitted', async () => {
    const blood = {
      id: 41,
      code: 'BLOOD01',
      name: 'Synthetic blood test',
      department: 'laboratory',
      facilityId: 2,
      tenantId: 1,
      unit: 'Service',
      unitPrice: '456.00',
    };
    let available = [blood];
    mocks.context.refreshKey = 0;
    mocks.api.getAvailableFacilityServices.mockImplementation(
      async (_facility: number, filter: { category: string }) =>
        filter.category === 'LABORATORY' ? available : [],
    );
    const user = userEvent.setup();
    const view = render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Synthetic blood test/ }));
    await user.type(screen.getByLabelText('Specimen for Synthetic blood test'), 'Synthetic blood');
    await user.type(
      screen.getByLabelText('Laboratory investigations, one per line'),
      'Synthetic unlisted',
    );
    await user.type(screen.getByLabelText('Specimen for Synthetic unlisted'), 'Synthetic swab');
    await user.type(
      screen.getByPlaceholderText('Why are these investigations required?'),
      'Synthetic reason',
    );
    // A refresh may temporarily or permanently remove the selected row from
    // the latest catalogue. Its already-selected ID must not silently vanish.
    available = [];
    mocks.context.refreshKey = 1;
    view.rerender(<OutpatientModule />);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Synthetic blood test/ })).toBeChecked(),
    );
    expect(screen.getByText(/not in the current list/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit Orders to Laboratory' }));
    await waitFor(() =>
      expect(mocks.api.createLabOrderBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          orderLines: [
            { facilityServiceId: 41, specimenType: 'Synthetic blood' },
            { investigation: 'Synthetic unlisted', specimenType: 'Synthetic swab' },
          ],
        }),
      ),
    );
  });

  it('does not display catalogue entries returned for another facility or tenant', async () => {
    mocks.api.getAvailableFacilityServices.mockImplementation(
      (_facilityId: number, filter: { category: string }) =>
        filter.category === 'LABORATORY'
          ? Promise.resolve([
              {
                id: 41,
                facilityId: 2,
                tenantId: 1,
                name: 'Current synthetic',
                code: 'CUR',
                unitPrice: '10.00',
              },
              {
                id: 42,
                facilityId: 3,
                tenantId: 1,
                name: 'Other facility synthetic',
                code: 'OTHER-F',
                unitPrice: '11.00',
              },
              {
                id: 43,
                facilityId: 2,
                tenantId: 9,
                name: 'Other tenant synthetic',
                code: 'OTHER-T',
                unitPrice: '12.00',
              },
            ])
          : Promise.resolve([]),
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    expect(await screen.findByLabelText(/Current synthetic/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Other facility synthetic/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Other tenant synthetic/)).not.toBeInTheDocument();
  });

  it('clears an unsent laboratory draft on a facility change and will not send the old encounter', async () => {
    const blood = {
      id: 41,
      code: 'BLOOD01',
      name: 'Synthetic blood test',
      department: 'laboratory',
      facilityId: 2,
      tenantId: 1,
      unit: 'Service',
      unitPrice: '456.00',
    };
    mocks.api.getAvailableFacilityServices.mockImplementation(
      async (facilityId: number, filter: { category: string }) =>
        facilityId === 2 && filter.category === 'LABORATORY' ? [blood] : [],
    );
    const user = userEvent.setup();
    const view = render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Synthetic blood test/ }));
    await user.type(screen.getByLabelText('Specimen for Synthetic blood test'), 'Synthetic blood');
    await user.type(
      screen.getByPlaceholderText('Why are these investigations required?'),
      'Synthetic reason',
    );
    mocks.context.currentFacility = { id: 3 };
    view.rerender(<OutpatientModule />);
    await waitFor(() =>
      expect(mocks.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('unsent laboratory draft was cleared'),
      ),
    );
    expect(
      screen.queryByRole('checkbox', { name: /Synthetic blood test/ }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Laboratory investigations, one per line'),
      'Synthetic other',
    );
    await user.type(screen.getByLabelText('Specimen for Synthetic other'), 'Synthetic specimen');
    await user.type(
      screen.getByPlaceholderText('Why are these investigations required?'),
      'Synthetic reason',
    );
    await user.click(await screen.findByRole('button', { name: 'Submit Orders to Laboratory' }));
    expect(mocks.api.createLabOrderBatch).not.toHaveBeenCalled();
    expect(mocks.context.showToast).toHaveBeenCalledWith(
      'Select a patient and investigations for the current facility before ordering.',
    );
  });

  it('keeps a stale selected row visible after the server rejects it so the clinician can remove it', async () => {
    const blood = {
      id: 41,
      code: 'BLOOD01',
      name: 'Synthetic blood test',
      department: 'laboratory',
      facilityId: 2,
      tenantId: 1,
      unit: 'Service',
      unitPrice: '456.00',
    };
    let available = [blood];
    mocks.api.getAvailableFacilityServices.mockImplementation(
      async (_facility: number, filter: { category: string }) =>
        filter.category === 'LABORATORY' ? available : [],
    );
    mocks.api.createLabOrderBatch.mockRejectedValueOnce(
      new Error('The facility investigation is inactive or unavailable.'),
    );
    const user = userEvent.setup();
    const view = render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Synthetic blood test/ }));
    await user.type(screen.getByLabelText('Specimen for Synthetic blood test'), 'Synthetic blood');
    await user.type(
      screen.getByPlaceholderText('Why are these investigations required?'),
      'Synthetic reason',
    );
    available = [];
    mocks.context.refreshKey = 1;
    view.rerender(<OutpatientModule />);
    await screen.findByText(/not in the current list/);
    await user.click(screen.getByRole('button', { name: 'Submit Orders to Laboratory' }));
    await waitFor(() =>
      expect(mocks.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('inactive or unavailable'),
      ),
    );
    const retained = screen.getByRole('checkbox', { name: /Synthetic blood test/ });
    expect(retained).toBeChecked();
    await user.click(retained);
    expect(
      screen.queryByRole('checkbox', { name: /Synthetic blood test/ }),
    ).not.toBeInTheDocument();
  });

  it('submits multiple exact investigations with an individually entered specimen for each', async () => {
    const tests = [
      {
        id: 41,
        code: 'COUNT',
        name: 'Synthetic count',
        department: 'laboratory',
        facilityId: 2,
        tenantId: 1,
        unit: 'Test',
        unitPrice: '80.00',
      },
      {
        id: 42,
        code: 'URINE',
        name: 'Synthetic urine',
        department: 'laboratory',
        facilityId: 2,
        tenantId: 1,
        unit: 'Test',
        unitPrice: '45.00',
      },
      {
        id: 43,
        code: 'UNPRICED',
        name: 'Synthetic unpriced',
        department: 'laboratory',
        facilityId: 2,
        tenantId: 1,
        unit: 'Test',
        unitPrice: null,
      },
    ];
    mocks.api.getAvailableFacilityServices.mockImplementation(
      async (_facility: number, filter: { category: string }) =>
        filter.category === 'LABORATORY' ? tests : [],
    );
    const user = userEvent.setup();
    render(<OutpatientModule />);
    await user.click(await screen.findByRole('button', { name: /Synthetic One/ }));
    expect(
      await screen.findByText(/Synthetic unpriced · UNPRICED · price unavailable/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Synthetic count/ }));
    await user.click(screen.getByRole('checkbox', { name: /Synthetic urine · URINE/ }));
    await user.type(screen.getByLabelText('Specimen for Synthetic count'), 'Synthetic blood');
    await user.type(
      screen.getByLabelText('Specimen for Synthetic urine'),
      'Synthetic urine specimen',
    );
    await user.type(
      screen.getByPlaceholderText('Why are these investigations required?'),
      'Synthetic reason',
    );
    await user.click(screen.getByRole('button', { name: 'Submit Orders to Laboratory' }));
    await waitFor(() =>
      expect(mocks.api.createLabOrderBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          encounterId: 111,
          patientId: 11,
          orderLines: [
            { facilityServiceId: 41, specimenType: 'Synthetic blood' },
            { facilityServiceId: 42, specimenType: 'Synthetic urine specimen' },
          ],
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(mocks.api.createLabOrderBatch.mock.calls[0][0]).not.toHaveProperty('specimenType');
  });
});
