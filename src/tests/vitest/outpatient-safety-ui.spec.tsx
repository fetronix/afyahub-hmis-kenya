// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  facilityId: 2,
  patientId,
  status: 'Active',
});

describe('Outpatient worklist and patient isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.authenticatedUser = null;
    mocks.api.getPatients.mockResolvedValue(patients);
    mocks.api.getLabTests.mockResolvedValue([]);
    mocks.api.getClinicalCatalogue.mockResolvedValue([]);
    mocks.api.getAvailableFacilityServices.mockResolvedValue([]);
    mocks.api.createEncounter.mockResolvedValue({
      id: 111,
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

  it('submits multiple exact investigations with an individually entered specimen for each', async () => {
    const tests = [
      {
        id: 41,
        code: 'COUNT',
        name: 'Synthetic count',
        department: 'laboratory',
        unit: 'Test',
        unitPrice: '80.00',
      },
      {
        id: 42,
        code: 'URINE',
        name: 'Synthetic urine',
        department: 'laboratory',
        unit: 'Test',
        unitPrice: '45.00',
      },
      {
        id: 43,
        code: 'UNPRICED',
        name: 'Synthetic unpriced',
        department: 'laboratory',
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
