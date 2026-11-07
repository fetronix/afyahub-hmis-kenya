// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  context: {
    currentTenant: { id: 1 },
    currentFacility: { id: 10 },
    refreshKey: 0,
    showToast: vi.fn(),
  },
  api: {
    getPatients: vi.fn(),
    getFhirPatient: vi.fn(),
    getDhaReadiness: vi.fn(),
    getDhaCalls: vi.fn(),
    checkDhaEligibility: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../components/modules/DhaCompliancePanel.tsx', () => ({
  DhaCompliancePanel: () => null,
}));
import { InteroperabilityModule } from '../../components/modules/InteroperabilityModule.tsx';

const patients = [
  { id: 11, firstName: 'Synthetic', lastName: 'One', mrn: 'S-11' },
  { id: 22, firstName: 'Synthetic', lastName: 'Two', mrn: 'S-22' },
];
const fhir = (id: number) => ({
  resourceType: 'Patient',
  id: `ke-hmis-${id}`,
  marker: `SYNTHETIC_FHIR_${id}`,
});
const eligibility = {
  simulated: true,
  identificationHint: 'synthetic',
  identificationType: 'synthetic',
  memberCrNumberRecorded: false,
  mode: 'mock',
  verdict: {
    deceased: false,
    eligible: true,
    pomsfEligible: false,
    biometricsEnforced: false,
    otpWhitelisted: false,
    matchedPrefixes: [],
    schemes: [],
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('Interoperability patient and facility context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.currentTenant = { id: 1 };
    mocks.context.currentFacility = { id: 10 };
    mocks.context.refreshKey = 0;
    mocks.api.getPatients.mockResolvedValue(patients);
    mocks.api.getFhirPatient.mockImplementation(async (id: number) => fhir(id));
    mocks.api.getDhaReadiness.mockRejectedValue(new Error('synthetic readiness unavailable'));
    mocks.api.getDhaCalls.mockResolvedValue([]);
    mocks.api.checkDhaEligibility.mockResolvedValue(eligibility);
  });
  afterEach(cleanup);

  it('clears the previous FHIR resource and disables transfer when the eligibility selection changes', async () => {
    const next = deferred<ReturnType<typeof fhir>>();
    mocks.api.getFhirPatient.mockImplementation((id: number) =>
      id === 22 ? next.promise : Promise.resolve(fhir(id)),
    );
    const user = userEvent.setup();
    render(<InteroperabilityModule />);
    expect(await screen.findByText(/SYNTHETIC_FHIR_11/)).toBeInTheDocument();
    expect(mocks.api.getFhirPatient).toHaveBeenCalledWith(11, 10);
    expect(mocks.api.getDhaReadiness).toHaveBeenCalledWith(false, 10);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Eligibility patient' }), '22');
    expect(screen.queryByText(/SYNTHETIC_FHIR_11/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download schema' })).toBeDisabled();
    await act(async () => next.resolve(fhir(22)));
    expect(await screen.findByText(/SYNTHETIC_FHIR_22/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeEnabled();
  });

  it('ignores an out-of-order FHIR response for a previous patient', async () => {
    const previous = deferred<ReturnType<typeof fhir>>();
    mocks.api.getFhirPatient.mockImplementation((id: number) =>
      id === 11 ? previous.promise : Promise.resolve(fhir(id)),
    );
    const user = userEvent.setup();
    render(<InteroperabilityModule />);
    await screen.findAllByRole('option', { name: /Synthetic Two/ });
    await user.selectOptions(screen.getByRole('combobox', { name: 'FHIR patient' }), '22');
    expect(await screen.findByText(/SYNTHETIC_FHIR_22/)).toBeInTheDocument();
    await act(async () => previous.resolve(fhir(11)));
    expect(screen.queryByText(/SYNTHETIC_FHIR_11/)).not.toBeInTheDocument();
    expect(screen.getByText(/SYNTHETIC_FHIR_22/)).toBeInTheDocument();
  });

  it('fails closed on a fetch failure or a resource with a mismatched identity and allows retry', async () => {
    mocks.api.getFhirPatient.mockImplementation(async (id: number) =>
      id === 11 ? fhir(id) : Promise.reject(new Error('synthetic failure')),
    );
    const user = userEvent.setup();
    render(<InteroperabilityModule />);
    await screen.findByText(/SYNTHETIC_FHIR_11/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'FHIR patient' }), '22');
    expect(await screen.findByText(/could not be verified or loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/SYNTHETIC_FHIR_11/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeDisabled();
    mocks.api.getFhirPatient.mockResolvedValueOnce(fhir(11));
    await user.click(screen.getByRole('button', { name: 'Retry FHIR' }));
    await screen.findByText(/could not be verified or loaded/);
    expect(screen.queryByText(/SYNTHETIC_FHIR_11/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download schema' })).toBeDisabled();
    mocks.api.getFhirPatient.mockResolvedValueOnce(fhir(22));
    await user.click(screen.getByRole('button', { name: 'Retry FHIR' }));
    expect(await screen.findByText(/SYNTHETIC_FHIR_22/)).toBeInTheDocument();
  });

  it('ignores late eligibility and clears a previous patient identifier override', async () => {
    const previous = deferred<typeof eligibility>();
    mocks.api.checkDhaEligibility.mockReturnValueOnce(previous.promise);
    const user = userEvent.setup();
    render(<InteroperabilityModule />);
    await screen.findByText(/SYNTHETIC_FHIR_11/);
    const override = screen.getByPlaceholderText('Leave blank to use the record');
    await user.type(override, 'synthetic-override');
    await user.click(screen.getByRole('button', { name: 'Check eligibility' }));
    expect(override).toHaveValue('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'FHIR patient' }), '22');
    await act(async () => previous.resolve(eligibility));
    expect(screen.queryByText('Eligible for the schemes listed below')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check eligibility' }));
    expect(await screen.findByText('Eligible for the schemes listed below')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'FHIR patient' }), '11');
    expect(screen.queryByText('Eligible for the schemes listed below')).not.toBeInTheDocument();
    expect(override).toHaveValue('');
  });

  it('does not report an empty call history when the call-log request fails', async () => {
    mocks.api.getDhaCalls.mockRejectedValue(new Error('synthetic call-log outage'));
    render(<InteroperabilityModule />);
    expect(await screen.findByText(/Do not assume there were no calls/)).toBeInTheDocument();
    expect(screen.queryByText('No calls recorded for this facility yet.')).not.toBeInTheDocument();
  });

  it('hides old patients and rejects late results after a facility change', async () => {
    const nextPatients = deferred<typeof patients>();
    mocks.api.getPatients.mockImplementation((_tenant: number, facility: number) =>
      facility === 10 ? Promise.resolve(patients) : nextPatients.promise,
    );
    const oldFhir = deferred<ReturnType<typeof fhir>>();
    mocks.api.getFhirPatient.mockImplementation((id: number) =>
      id === 11 ? oldFhir.promise : Promise.resolve(fhir(id)),
    );
    const view = render(<InteroperabilityModule />);
    await screen.findAllByRole('option', { name: /Synthetic Two/ });
    mocks.context.currentFacility = { id: 20 };
    view.rerender(<InteroperabilityModule />);
    expect(screen.queryByRole('option', { name: /Synthetic One/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeDisabled();
    await act(async () => oldFhir.resolve(fhir(11)));
    expect(screen.queryByText(/SYNTHETIC_FHIR_11/)).not.toBeInTheDocument();
    await act(async () =>
      nextPatients.resolve([{ id: 33, firstName: 'Synthetic', lastName: 'Three', mrn: 'S-33' }]),
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'FHIR patient' })).toHaveValue('33'),
    );
    expect(await screen.findByText(/SYNTHETIC_FHIR_33/)).toBeInTheDocument();
  });
});
