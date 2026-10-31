// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocked = vi.hoisted(() => ({
  context: {
    currentTenant: { id: 1 },
    currentFacility: { id: 10 },
    authenticatedUser: { id: 7 },
    currentUser: { name: 'Synthetic staff' },
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getMedications: vi.fn(),
    getInventory: vi.fn(),
    getPatients: vi.fn(),
    getInventoryBatches: vi.fn(),
    dispenseMedication: vi.fn(),
    checkDispenseRequest: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));

import { PharmacyModule } from '../../components/modules/PharmacyModule.tsx';

const storageName = 'jalicare:pharmacy:pending:7:10';

describe('Pharmacy retry recovery in one browser', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocked.context.currentFacility = { id: 10 };
    mocked.api.getMedications.mockResolvedValue([
      {
        id: 42,
        patientId: 22,
        drugName: 'Synthetic medicine',
        dosage: 'test',
        frequency: 'test',
        duration: 'test',
        route: 'test',
        quantity: 10,
        quantityDispensed: 0,
        status: 'Prescribed',
      },
    ]);
    mocked.api.getInventory.mockResolvedValue([
      { id: 55, name: 'Synthetic stock', currentStock: 10 },
    ]);
    mocked.api.getPatients.mockResolvedValue([]);
    mocked.api.getInventoryBatches.mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('retains the same key across a lost response and remount without storing notes', async () => {
    const user = userEvent.setup();
    mocked.api.dispenseMedication
      .mockRejectedValueOnce(new Error('Synthetic lost response'))
      .mockResolvedValueOnce({ replayed: true, stockTracking: 'untracked', billing: null });
    mocked.api.checkDispenseRequest.mockResolvedValue({ status: 'NOT_FOUND' });

    const view = render(<PharmacyModule />);
    await user.click(await screen.findByRole('button', { name: 'Dispense Item' }));
    await user.selectOptions(screen.getByRole('combobox'), '55');
    await user.type(screen.getByRole('textbox'), 'private synthetic note');
    await user.click(screen.getByRole('button', { name: 'Authorize & Dispense' }));
    await waitFor(() => expect(mocked.api.dispenseMedication).toHaveBeenCalledTimes(1));
    const first = mocked.api.dispenseMedication.mock.calls[0]![0];
    const saved = window.localStorage.getItem(storageName);
    expect(saved).not.toContain('private synthetic note');
    expect(JSON.parse(saved!)).toEqual({ key: first.idempotencyKey, prescriptionId: 42 });

    view.unmount();
    render(<PharmacyModule />);
    expect(await screen.findByText('Unconfirmed dispensing needs review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check recorded result' }));
    await waitFor(() => expect(mocked.api.checkDispenseRequest).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(storageName)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Resume same request' }));
    await user.selectOptions(screen.getByRole('combobox'), '55');
    await user.type(screen.getByRole('textbox'), 'private synthetic note');
    await user.click(screen.getByRole('button', { name: 'Authorize & Dispense' }));
    await waitFor(() => expect(mocked.api.dispenseMedication).toHaveBeenCalledTimes(2));
    expect(mocked.api.dispenseMedication.mock.calls[1]![0].idempotencyKey).toBe(
      first.idempotencyKey,
    );
    await waitFor(() => expect(window.localStorage.getItem(storageName)).toBeNull());
  });

  it('checks a committed result and clears the identity without sending a second dispense', async () => {
    window.localStorage.setItem(
      storageName,
      JSON.stringify({ key: 'synthetic-pending-key', prescriptionId: 42 }),
    );
    mocked.api.checkDispenseRequest.mockResolvedValue({
      status: 'RECORDED',
      prescriptionId: 42,
      quantity: 4,
      dispensationId: 77,
    });
    const user = userEvent.setup();
    render(<PharmacyModule />);
    await user.click(await screen.findByRole('button', { name: 'Check recorded result' }));
    await waitFor(() => expect(window.localStorage.getItem(storageName)).toBeNull());
    expect(mocked.api.dispenseMedication).not.toHaveBeenCalled();
    expect(mocked.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Review the prescription and billing queue'),
    );
  });

  it('shows a failed worklist as unavailable, not empty, and retries safely', async () => {
    mocked.api.getMedications.mockRejectedValueOnce(new Error('Synthetic database failure'));
    const user = userEvent.setup();
    render(<PharmacyModule />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pharmacy data could not be loaded. Do not assume the worklist is empty.',
    );
    expect(screen.queryByText(/No prescriptions in/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispense Item' })).not.toBeInTheDocument();
    expect(mocked.api.dispenseMedication).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry loading pharmacy data' }));
    expect(await screen.findByRole('button', { name: 'Dispense Item' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not retain another facility worklist while the new facility loads', async () => {
    const view = render(<PharmacyModule />);
    expect(await screen.findByText(/Synthetic medicine/)).toBeInTheDocument();

    let complete!: (items: unknown[]) => void;
    mocked.api.getMedications.mockImplementationOnce(
      () => new Promise((resolve) => (complete = resolve)),
    );
    mocked.context.currentFacility = { id: 11 };
    view.rerender(<PharmacyModule />);
    expect(screen.queryByText(/Synthetic medicine/)).not.toBeInTheDocument();
    expect(screen.getByText('Loading pharmacy data...')).toBeInTheDocument();
    await act(async () => {
      complete([]);
    });
    expect(await screen.findByText(/No prescriptions in/)).toBeInTheDocument();
  });

  it('ignores an old facility response that arrives after a facility switch', async () => {
    let completeOld!: (items: unknown[]) => void;
    mocked.api.getMedications.mockImplementationOnce(
      () => new Promise((resolve) => (completeOld = resolve)),
    );
    const view = render(<PharmacyModule />);
    await waitFor(() => expect(mocked.api.getMedications).toHaveBeenCalledTimes(1));
    mocked.context.currentFacility = { id: 11 };
    view.rerender(<PharmacyModule />);
    expect(await screen.findByText(/Synthetic medicine/)).toBeInTheDocument();

    await act(async () => {
      completeOld([
        {
          id: 99,
          patientId: 88,
          drugName: 'Old facility synthetic medicine',
          quantity: 1,
          status: 'Prescribed',
        },
      ]);
    });
    expect(screen.queryByText(/Old facility synthetic medicine/)).not.toBeInTheDocument();
    expect(screen.getByText(/Synthetic medicine/)).toBeInTheDocument();
  });

  it('does not send a dispensing request when the saved identity is malformed', async () => {
    window.localStorage.setItem(storageName, '{broken');
    const user = userEvent.setup();
    render(<PharmacyModule />);
    expect(await screen.findByText(/saved retry identity cannot be read/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Dispense Item' }));
    expect(mocked.api.dispenseMedication).not.toHaveBeenCalled();
  });
});
