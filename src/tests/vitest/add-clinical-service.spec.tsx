// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  getClinicalCatalogue: vi.fn(),
  createLabOrderBatch: vi.fn(),
  createRadiologyOrder: vi.fn(),
}));
vi.mock('../../api/client.ts', () => ({ api: mocks }));
import { AddClinicalService } from '../../components/modules/AddClinicalService.tsx';

const lab = {
  id: 1,
  testId: 1,
  code: 'SYN-LAB',
  description: 'Synthetic test',
  family: 'LABORATORY',
  unit: 'Test',
  unitPrice: '80.00',
  priceStatus: 'AVAILABLE',
  specimenOptions: [{ id: 11, specimenType: 'Synthetic specimen' }],
};
const unavailable = {
  ...lab,
  id: 2,
  testId: 2,
  code: 'NOT-READY',
  description: 'Unapproved test',
  unitPrice: null,
  priceStatus: 'TARIFF_UNAPPROVED',
};
const imaging = {
  id: 3,
  code: 'SYN-IMG',
  description: 'Specific synthetic examination',
  family: 'RADIOLOGY',
  unit: 'Examination',
  unitPrice: '300.00',
  priceStatus: 'AVAILABLE',
};
const props = {
  facilityId: 10,
  patientId: 20,
  encounterId: 30,
  orderedBy: 'Synthetic clinician',
  canOrderLab: true,
  canOrderImaging: true,
  onCreated: vi.fn(),
};

describe('Add Service clinical-order boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClinicalCatalogue.mockImplementation(async (_facility: number, family: string) =>
      family === 'LABORATORY' ? [lab, unavailable] : [imaging],
    );
    mocks.createLabOrderBatch.mockResolvedValue({ orders: [{ id: 1 }] });
    mocks.createRadiologyOrder.mockResolvedValue({ id: 2 });
  });
  afterEach(cleanup);
  it('requires a reviewed specimen and explicit priority, previews price and creates an order without a manual charge', async () => {
    const user = userEvent.setup();
    render(<AddClinicalService {...props} />);
    await user.click(screen.getByText('Add Service — clinical orders'));
    expect(await screen.findByText(/Synthetic test · SYN-LAB · KES 80.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Unapproved test/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Synthetic test/ }));
    await user.selectOptions(
      screen.getByLabelText('Add service specimen for Synthetic test'),
      '11',
    );
    await user.type(screen.getByLabelText('Add service clinical indication'), 'Synthetic reason');
    expect(screen.getByRole('button', { name: 'Create clinical order' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Add service laboratory priority'), 'Urgent');
    expect(screen.getByText(/Indicative total KES 80.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create clinical order' }));
    await waitFor(() =>
      expect(mocks.createLabOrderBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          encounterId: 30,
          patientId: 20,
          priority: 'Urgent',
          testSelections: [{ testId: 1, specimenOptionId: 11 }],
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByText(/No charge is created until/)).toBeInTheDocument();
    expect(mocks.createRadiologyOrder).not.toHaveBeenCalled();
  });
  it('selects an exact imaging examination and preserves encounter provenance', async () => {
    const user = userEvent.setup();
    render(<AddClinicalService {...props} />);
    await user.click(screen.getByText('Add Service — clinical orders'));
    await user.selectOptions(screen.getByLabelText('Add service department'), 'RADIOLOGY');
    await user.click(await screen.findByRole('radio', { name: /Specific synthetic examination/ }));
    await user.selectOptions(screen.getByLabelText('Add service imaging modality'), 'Ultrasound');
    await user.type(screen.getByLabelText('Add service clinical indication'), 'Synthetic reason');
    expect(screen.getByText(/Indicative total KES 300.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create clinical order' }));
    await waitFor(() =>
      expect(mocks.createRadiologyOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 20,
          encounterId: 30,
          masterServiceId: 3,
          modality: 'Ultrasound',
          idempotencyKey: expect.any(String),
        }),
      ),
    );
  });
  it('does not offer ordering without the relevant clinical permissions', () => {
    render(<AddClinicalService {...props} canOrderLab={false} canOrderImaging={false} />);
    expect(screen.queryByText('Add Service — clinical orders')).not.toBeInTheDocument();
  });
});
