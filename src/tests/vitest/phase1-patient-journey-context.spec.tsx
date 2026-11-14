// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  context: {
    currentTenant: { id: 1 },
    currentFacility: { id: 10 },
    selectedPatient: { id: 11, mrn: 'S-11', firstName: 'Synthetic', lastName: 'One' },
    isJourneyModalOpen: true,
    setIsJourneyModalOpen: vi.fn(),
    showToast: vi.fn(),
  },
  api: {
    getEncounters: vi.fn(),
    getObservations: vi.fn(),
    getDiagnoses: vi.fn(),
    getMedications: vi.fn(),
    getLabOrders: vi.fn(),
    getLabResults: vi.fn(),
    getInvoices: vi.fn(),
    getFhirPatient: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../components/PatientConsentAllergyPanel.tsx', () => ({
  PatientConsentAllergyPanel: () => null,
}));
import { PatientJourneyModal } from '../../components/PatientJourneyModal.tsx';

const patient = (id: number) => ({
  id,
  mrn: `S-${id}`,
  firstName: 'Synthetic',
  lastName: id === 11 ? 'One' : 'Two',
});
const encounter = (id: number) => [
  {
    id,
    encounterType: `SYNTHETIC_RECORD_${id}`,
    triageCategory: 'Synthetic',
    status: 'ACTIVE',
    startedAt: '2026-01-01T00:00:00Z',
  },
];
const fhir = (id: number) => ({ resourceType: 'Patient', id: `ke-hmis-${id}` });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe('Patient journey identity and facility context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.currentTenant = { id: 1 };
    mocks.context.currentFacility = { id: 10 };
    mocks.context.selectedPatient = patient(11);
    mocks.context.isJourneyModalOpen = true;
    mocks.api.getEncounters.mockImplementation(async (id: number) => encounter(id));
    for (const method of [
      'getObservations',
      'getDiagnoses',
      'getMedications',
      'getLabOrders',
      'getLabResults',
      'getInvoices',
    ] as const) {
      mocks.api[method].mockResolvedValue([]);
    }
    mocks.api.getFhirPatient.mockImplementation(async (id: number) => fhir(id));
  });
  afterEach(cleanup);

  it('hides previous records and disables FHIR export while a new patient loads', async () => {
    const pending = deferred<ReturnType<typeof encounter>>();
    mocks.api.getEncounters.mockImplementation((id: number) =>
      id === 22 ? pending.promise : Promise.resolve(encounter(id)),
    );
    const view = render(<PatientJourneyModal />);
    expect(await screen.findByText('SYNTHETIC_RECORD_11 Encounter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export FHIR' })).toBeEnabled();
    expect(mocks.api.getFhirPatient).toHaveBeenCalledWith(11, 10);
    mocks.context.selectedPatient = patient(22);
    view.rerender(<PatientJourneyModal />);
    expect(screen.queryByText('SYNTHETIC_RECORD_11 Encounter')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export FHIR' })).toBeDisabled();
    await act(async () => pending.resolve(encounter(22)));
    expect(await screen.findByText('SYNTHETIC_RECORD_22 Encounter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export FHIR' })).toBeEnabled();
  });

  it('ignores out-of-order records from a previously selected patient', async () => {
    const pending = deferred<ReturnType<typeof encounter>>();
    mocks.api.getEncounters.mockImplementation((id: number) =>
      id === 11 ? pending.promise : Promise.resolve(encounter(id)),
    );
    const view = render(<PatientJourneyModal />);
    mocks.context.selectedPatient = patient(22);
    view.rerender(<PatientJourneyModal />);
    expect(await screen.findByText('SYNTHETIC_RECORD_22 Encounter')).toBeInTheDocument();
    await act(async () => pending.resolve(encounter(11)));
    expect(screen.queryByText('SYNTHETIC_RECORD_11 Encounter')).not.toBeInTheDocument();
    expect(screen.getByText('SYNTHETIC_RECORD_22 Encounter')).toBeInTheDocument();
  });

  it('does not reuse old records when the same journey is closed and reopened', async () => {
    const view = render(<PatientJourneyModal />);
    await screen.findByText('SYNTHETIC_RECORD_11 Encounter');
    mocks.context.isJourneyModalOpen = false;
    view.rerender(<PatientJourneyModal />);
    const pending = deferred<ReturnType<typeof encounter>>();
    mocks.api.getEncounters.mockReturnValue(pending.promise);
    mocks.context.isJourneyModalOpen = true;
    view.rerender(<PatientJourneyModal />);
    expect(screen.queryByText('SYNTHETIC_RECORD_11 Encounter')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export FHIR' })).toBeDisabled();
    await act(async () => pending.resolve(encounter(11)));
    expect(await screen.findByText('SYNTHETIC_RECORD_11 Encounter')).toBeInTheDocument();
  });

  it('does not export an unavailable or identity-mismatched FHIR response', async () => {
    mocks.api.getFhirPatient.mockResolvedValue(fhir(22));
    render(<PatientJourneyModal />);
    await screen.findByText('SYNTHETIC_RECORD_11 Encounter');
    expect(screen.getByRole('button', { name: 'Export FHIR' })).toBeDisabled();
  });

  it('shows an error rather than a falsely empty history when clinical loading fails', async () => {
    mocks.api.getEncounters.mockRejectedValue(new Error('synthetic failure'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<PatientJourneyModal />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText(/No clinical encounters recorded/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export FHIR' })).toBeDisabled();
    vi.restoreAllMocks();
  });
});
