// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  api: {
    getFacilityServices: vi.fn(),
    getFacilityTariffs: vi.fn(),
    getChargeAttempts: vi.fn(),
    getMasterTariffs: vi.fn(),
    syncMasterTariffs: vi.fn(),
  },
  context: {
    currentFacility: {
      id: 10,
      name: 'Synthetic Facility',
      enabledModules: ['finance', 'opd'],
      hiddenModules: [],
    },
    currentTenant: { id: 1, name: 'Synthetic Tenant' },
    authenticatedUser: {
      roles: ['FACILITY_ADMIN'],
      permissions: ['tariffs.read', 'tariffs.manage'],
      isSuperAdmin: false,
    },
    showToast: vi.fn(),
    triggerRefresh: vi.fn(),
    setCurrentFacility: vi.fn(),
    setActiveModule: vi.fn(),
  },
}));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
import { ConfigurationModule } from '../../components/modules/ConfigurationModule.tsx';

const service = {
  id: 20,
  code: 'OWN-01',
  name: 'Synthetic service',
  description: 'Synthetic service',
  department: 'finance',
  category: 'OTHER',
  unit: 'Service',
  isActive: true,
  autoBill: true,
};
const tariff = {
  id: 21,
  facilityServiceId: 20,
  code: 'OWN-01',
  description: 'Synthetic tariff',
  department: 'finance',
  unit: 'Service',
  fee: '20.00',
  isActive: true,
  autoBill: true,
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.authenticatedUser = {
    roles: ['FACILITY_ADMIN'],
    permissions: ['tariffs.read', 'tariffs.manage'],
    isSuperAdmin: false,
  };
  mocks.api.getFacilityServices.mockResolvedValue([service]);
  mocks.api.getFacilityTariffs.mockResolvedValue([
    { ...tariff, masterServiceId: null },
    {
      ...tariff,
      id: 22,
      facilityServiceId: null,
      masterServiceId: 30,
      code: 'JC-HISTORICAL',
      description: 'Synthetic master-only price',
    },
    {
      ...tariff,
      id: 23,
      facilityServiceId: null,
      masterServiceId: null,
      code: 'OLD-FACILITY',
      description: 'Synthetic legacy facility price',
    },
    {
      ...tariff,
      id: 24,
      facilityServiceId: 20,
      masterServiceId: 31,
      code: 'JC-USED',
      description: 'Synthetic attached price',
    },
  ]);
  mocks.api.getChargeAttempts.mockResolvedValue({ facilityId: 10, pending: 0, attempts: [] });
});
afterEach(cleanup);

describe('Facility pricing configuration', () => {
  it('shows the facility-owned manager without the retired master price list or master-only rows', async () => {
    const user = userEvent.setup();
    render(<ConfigurationModule />);
    await user.click(screen.getByRole('button', { name: 'Facility Services & Tariffs' }));
    expect(
      await screen.findByRole('heading', { name: 'Facility Services & Tariffs' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Synthetic tariff/)).toBeInTheDocument();
    expect(screen.getByText(/Synthetic legacy facility price/)).toBeInTheDocument();
    // An attached tariff can still bill and must not be hidden even if it has a historical master ID.
    expect(screen.getByText(/Synthetic attached price/)).toBeInTheDocument();
    expect(screen.queryByText(/Synthetic master-only price/)).not.toBeInTheDocument();
    expect(screen.queryByText('Master Tariff Price List')).not.toBeInTheDocument();
    for (const name of [
      'Synchronise actual services',
      'Approve',
      'History',
      'Mappings',
      'Link reviewed tariff',
      'Map source ID',
      'Approve code alias',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Master / source')).not.toBeInTheDocument();
    expect(mocks.api.getFacilityServices).toHaveBeenCalledWith(10);
    expect(mocks.api.getFacilityTariffs).toHaveBeenCalledWith(10);
    expect(mocks.api.getMasterTariffs).not.toHaveBeenCalled();
    expect(mocks.api.syncMasterTariffs).not.toHaveBeenCalled();
  });

  it('reports a loading failure rather than claiming the facility has no prices', async () => {
    mocks.api.getFacilityTariffs.mockRejectedValueOnce(new Error('Synthetic tariff load failed'));
    const user = userEvent.setup();
    render(<ConfigurationModule />);
    await user.click(screen.getByRole('button', { name: 'Facility Services & Tariffs' }));
    expect(await screen.findByText('Synthetic tariff load failed')).toBeInTheDocument();
    expect(screen.queryByText('No facility services have been created.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No facility tariffs are available to manage.'),
    ).not.toBeInTheDocument();
  });

  it('does not expose the tariff manager to a non-facility administrator', () => {
    mocks.context.authenticatedUser = {
      roles: ['CLINICIAN'],
      permissions: ['clinical.read'],
      isSuperAdmin: false,
    };
    render(<ConfigurationModule />);
    expect(
      screen.queryByRole('button', { name: 'Facility Services & Tariffs' }),
    ).not.toBeInTheDocument();
    expect(mocks.api.getFacilityServices).not.toHaveBeenCalled();
    expect(mocks.api.getFacilityTariffs).not.toHaveBeenCalled();
  });
});
