// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  api: {
    getFacilityServices: vi.fn(),
    getFacilityTariffs: vi.fn(),
    getChargeAttempts: vi.fn(),
    deleteFacilityService: vi.fn(),
    deleteFacilityTariff: vi.fn(),
  },
  triggerRefresh: vi.fn(),
}));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ triggerRefresh: mocks.triggerRefresh }),
}));
import { FacilityServicesManager } from '../../components/modules/FacilityServicesManager.tsx';

const service = {
  id: 1,
  code: 'SYN-SERVICE',
  name: 'Synthetic service',
  description: 'Synthetic service',
  department: 'finance',
  category: 'OTHER',
  unit: 'Service',
  isActive: true,
  autoBill: true,
};
const tariff = {
  id: 2,
  facilityServiceId: 1,
  code: 'SYN-TARIFF',
  description: 'Synthetic tariff',
  department: 'finance',
  unit: 'Service',
  fee: '10.00',
  effectiveFrom: null,
  effectiveTo: null,
  isActive: true,
  autoBill: true,
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getFacilityServices.mockResolvedValue([service]);
  mocks.api.getFacilityTariffs.mockResolvedValue([tariff]);
  mocks.api.getChargeAttempts.mockResolvedValue({ facilityId: 10, pending: 0, attempts: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Facility service and tariff deletion', () => {
  it('requires confirmation before requesting permanent deletion', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<FacilityServicesManager facilityId={10} enabledModules={['finance']} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Delete service SYN-SERVICE' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('associated tariffs'));
    expect(mocks.api.deleteFacilityService).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete tariff SYN-TARIFF' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'));
    expect(mocks.api.deleteFacilityTariff).not.toHaveBeenCalled();
  });

  it('removes a deleted service and its tariffs after refreshing the server data', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.api.deleteFacilityService.mockImplementation(async () => {
      mocks.api.getFacilityServices.mockResolvedValue([]);
      mocks.api.getFacilityTariffs.mockResolvedValue([]);
      return { deleted: true, id: 1, deletedTariffs: 1 };
    });
    const user = userEvent.setup();
    render(<FacilityServicesManager facilityId={10} enabledModules={['finance']} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Delete service SYN-SERVICE' }));
    await waitFor(() => expect(mocks.api.deleteFacilityService).toHaveBeenCalledWith(1, 10));
    expect(
      await screen.findByText(
        'Service SYN-SERVICE and its unused tariffs were permanently deleted.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete service SYN-SERVICE' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete tariff SYN-TARIFF' }),
    ).not.toBeInTheDocument();
    expect(mocks.triggerRefresh).toHaveBeenCalled();
  });

  it('allows an unreferenced archived tariff to be deleted while retaining the service', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.api.getFacilityTariffs.mockResolvedValue([
      { ...tariff, isActive: false, archivedAt: '2026-10-01' },
    ]);
    mocks.api.deleteFacilityTariff.mockImplementation(async () => {
      mocks.api.getFacilityTariffs.mockResolvedValue([]);
      return { deleted: true, id: 2 };
    });
    const user = userEvent.setup();
    render(<FacilityServicesManager facilityId={10} enabledModules={['finance']} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Delete tariff SYN-TARIFF' }));
    await waitFor(() => expect(mocks.api.deleteFacilityTariff).toHaveBeenCalledWith(2, 10));
    expect(
      await screen.findByText('Tariff SYN-TARIFF was permanently deleted.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete service SYN-SERVICE' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete tariff SYN-TARIFF' }),
    ).not.toBeInTheDocument();
  });

  it('shows the server refusal and leaves a referenced record visible', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.api.deleteFacilityTariff.mockRejectedValue(
      new Error('This tariff is linked to billing records. Archive it instead.'),
    );
    const user = userEvent.setup();
    render(<FacilityServicesManager facilityId={10} enabledModules={['finance']} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Delete tariff SYN-TARIFF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive it instead');
    expect(screen.getByRole('button', { name: 'Delete tariff SYN-TARIFF' })).toBeInTheDocument();
    expect(mocks.triggerRefresh).not.toHaveBeenCalled();
  });

  it('disables permanent deletion for users without tariff management permission', async () => {
    render(
      <FacilityServicesManager facilityId={10} enabledModules={['finance']} canManage={false} />,
    );
    expect(
      await screen.findByRole('button', { name: 'Delete service SYN-SERVICE' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete tariff SYN-TARIFF' })).toBeDisabled();
  });
});
