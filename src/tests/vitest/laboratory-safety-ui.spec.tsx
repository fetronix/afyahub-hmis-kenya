// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({
  context: {
    currentTenant: { id: 1 },
    currentFacility: { id: 2 },
    authenticatedUser: {
      permissions: ['laboratory.read', 'laboratory.results.enter', 'laboratory.results.verify'],
    },
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getLabOrders: vi.fn(),
    getPatients: vi.fn(),
    getLabResults: vi.fn(),
    addLabResult: vi.fn(),
    verifyLabResult: vi.fn(),
    updateLabOrderStatus: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
import { LaboratoryModule } from '../../components/modules/LaboratoryModule.tsx';
const orders = [
  {
    id: 11,
    patientId: 1,
    testName: 'Synthetic test one',
    status: 'Sample Collected',
    sampleAccessionNumber: 'JC-1',
    orderedAt: '2026-10-30',
  },
  {
    id: 22,
    patientId: 2,
    testName: 'Synthetic test two',
    status: 'Sample Collected',
    sampleAccessionNumber: 'JC-2',
    orderedAt: '2026-10-30',
  },
];
const results = [
  {
    id: 33,
    parameterName: 'Synthetic result one',
    measuredValue: '99',
    status: 'Pending',
    flag: 'Normal',
  },
];
describe('Laboratory worklist and result isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.refreshKey = 0;
    mocks.api.getLabOrders.mockResolvedValue(orders);
    mocks.api.getPatients.mockResolvedValue([
      { id: 1, firstName: 'Synthetic', lastName: 'One', mrn: 'P-1' },
      { id: 2, firstName: 'Synthetic', lastName: 'Two', mrn: 'P-2' },
    ]);
    mocks.api.getLabResults.mockImplementation(async (id: number) => (id === 11 ? results : []));
  });
  afterEach(cleanup);
  it('shows a worklist error and retries rather than presenting an empty queue', async () => {
    mocks.api.getLabOrders.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<LaboratoryModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Do not assume the specimen queue is empty',
    );
    await user.click(screen.getByRole('button', { name: 'Retry laboratory data' }));
    expect(await screen.findByText('Specimen Queue (2)')).toBeInTheDocument();
  });
  it('shows result loading failure and prevents entry until results can be reviewed', async () => {
    mocks.api.getLabResults.mockRejectedValueOnce(new Error('synthetic outage'));
    const user = userEvent.setup();
    render(<LaboratoryModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume no results exist');
    expect(screen.getByRole('button', { name: 'Save Result' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry results' }));
    expect(await screen.findByText('Synthetic result one')).toBeInTheDocument();
  });
  it('clears the old result and draft when selecting a different order', async () => {
    const user = userEvent.setup();
    render(<LaboratoryModule />);
    await screen.findByText('Synthetic result one');
    await user.type(screen.getByPlaceholderText('e.g. Haemoglobin / Creatinine'), 'old draft');
    await user.click(screen.getByText('Synthetic test two'));
    await waitFor(() => expect(screen.queryByText('Synthetic result one')).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText('e.g. Haemoglobin / Creatinine')).toHaveValue('');
  });
  it('does not append an old order result to a newly selected patient after a delayed save', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.api.addLabResult.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<LaboratoryModule />);
    await screen.findByText('Synthetic result one');
    await user.type(
      screen.getByPlaceholderText('e.g. Haemoglobin / Creatinine'),
      'Synthetic new result',
    );
    await user.type(screen.getByPlaceholderText('e.g. 14.2'), '44');
    await user.click(screen.getByRole('button', { name: 'Save Result' }));
    await user.click(screen.getByText('Synthetic test two'));
    finish({
      id: 40,
      parameterName: 'Synthetic new result',
      measuredValue: '44',
      status: 'Pending',
    });
    await waitFor(() =>
      expect(mocks.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Lab result saved'),
      ),
    );
    expect(screen.queryByText('Synthetic new result')).not.toBeInTheDocument();
  });
});
