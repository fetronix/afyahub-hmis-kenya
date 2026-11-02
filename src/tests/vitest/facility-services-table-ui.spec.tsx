// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  api: {
    getFacilityServices: vi.fn(),
    getFacilityTariffs: vi.fn(),
    createFacilityService: vi.fn(),
    updateFacilityService: vi.fn(),
    createFacilityTariff: vi.fn(),
    updateFacilityTariff: vi.fn(),
    getChargeAttempts: vi.fn(),
    retryChargeAttempt: vi.fn(),
    retryChargeAttempts: vi.fn(),
  },
  triggerRefresh: vi.fn(),
}));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ triggerRefresh: mocks.triggerRefresh }),
}));
import { FacilityServicesManager } from '../../components/modules/FacilityServicesManager.tsx';
import { ApiError } from '../../api/clients/http.ts';

const consultation = {
  id: 10,
  tenantId: 1,
  facilityId: 5,
  code: 'SYN-OPD',
  name: 'Synthetic consultation',
  description: 'Consultation details',
  department: 'opd',
  category: 'CONSULTATION',
  unit: 'Visit',
  isActive: true,
  autoBill: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const pharmacy = {
  ...consultation,
  id: 11,
  code: 'SYN-PHARM',
  name: 'Synthetic pharmacy item',
  description: 'Pharmacy details',
  department: 'pharmacy',
  category: 'PHARMACY',
  unit: 'Pack',
  isActive: false,
  autoBill: false,
};
const tariff = {
  id: 20,
  tenantId: 1,
  facilityId: 5,
  facilityServiceId: 10,
  masterServiceId: null,
  code: 'PRICE-OPD',
  description: 'Consultation price',
  department: 'opd',
  unit: 'Visit',
  fee: '123.45',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  isActive: true,
  autoBill: true,
  archivedAt: null,
  revision: 4,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.getFacilityServices.mockResolvedValue([consultation, pharmacy]);
  mocks.api.getFacilityTariffs.mockResolvedValue([tariff]);
  mocks.api.getChargeAttempts.mockResolvedValue({
    facilityId: 5,
    pending: 1,
    attempts: [{ id: 99, description: 'Synthetic pending charge' }],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const renderManager = (enabledModules = ['opd', 'pharmacy']) =>
  render(<FacilityServicesManager facilityId={5} enabledModules={enabledModules} canManage />);

describe('Facility services and tariff tables', () => {
  it('does not load or show the pending billing review panel', async () => {
    renderManager();
    expect(await screen.findByRole('table', { name: 'Facility services' })).toBeInTheDocument();
    expect(
      screen.queryByText('Charges awaiting billing or pricing review'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic pending charge')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry all' })).not.toBeInTheDocument();
    expect(mocks.api.getChargeAttempts).not.toHaveBeenCalled();
    expect(mocks.api.retryChargeAttempt).not.toHaveBeenCalled();
    expect(mocks.api.retryChargeAttempts).not.toHaveBeenCalled();
  });

  it('renders real table headers, precise prices and dates, and filters without changing records', async () => {
    const user = userEvent.setup();
    renderManager();
    const serviceTable = await screen.findByRole('table', { name: 'Facility services' });
    const tariffTable = screen.getByRole('table', { name: 'Facility tariffs' });
    expect(
      within(serviceTable).getByRole('columnheader', { name: 'Department / category' }),
    ).toBeInTheDocument();
    expect(
      within(tariffTable).getByRole('columnheader', { name: 'Effective dates' }),
    ).toBeInTheDocument();
    expect(within(tariffTable).getByText('KES 123.45')).toBeInTheDocument();
    expect(within(tariffTable).getByText('From: 2026-01-01')).toBeInTheDocument();
    expect(within(tariffTable).getByText('To: 2026-12-31')).toBeInTheDocument();
    expect(within(tariffTable).getByText('Synthetic consultation')).toBeInTheDocument();
    const pharmacyRow = within(serviceTable).getByText('SYN-PHARM').closest('tr')!;
    expect(within(pharmacyRow).getByText('Inactive')).toBeInTheDocument();
    expect(within(pharmacyRow).getByText('Off')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'pharmacy');
    expect(within(serviceTable).getByText('SYN-PHARM')).toBeInTheDocument();
    expect(within(serviceTable).queryByText('SYN-OPD')).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('searchbox', { name: 'Search tariffs' }),
      'Synthetic consultation',
    );
    expect(within(tariffTable).getByText('PRICE-OPD')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search tariffs' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search tariffs' }), 'not a tariff');
    expect(within(tariffTable).getByText('No tariffs match your search.')).toBeInTheDocument();
    expect(mocks.api.createFacilityService).not.toHaveBeenCalled();
    expect(mocks.api.updateFacilityService).not.toHaveBeenCalled();
    expect(mocks.api.updateFacilityTariff).not.toHaveBeenCalled();
  });

  it('submits a new service and exact initial price, then displays the reloaded server rows', async () => {
    mocks.api.getFacilityServices.mockResolvedValue([]);
    mocks.api.getFacilityTariffs.mockResolvedValue([]);
    mocks.api.createFacilityService.mockImplementation(async () => {
      mocks.api.getFacilityServices.mockResolvedValue([consultation]);
      mocks.api.getFacilityTariffs.mockResolvedValue([tariff]);
      return { service: consultation, tariff };
    });
    const user = userEvent.setup();
    renderManager();
    await screen.findByText('No facility services have been created.');
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Service name'), 'Synthetic consultation');
    await user.type(screen.getByLabelText('Service code'), 'SYN-OPD');
    await user.type(screen.getByLabelText('Description'), 'Consultation details');
    await user.selectOptions(screen.getByLabelText('Service category'), 'CONSULTATION');
    await user.type(screen.getByLabelText('Billing unit'), 'Visit');
    await user.type(screen.getByLabelText('Initial price (KES)'), '123.45');
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() =>
      expect(mocks.api.createFacilityService).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 5,
          code: 'SYN-OPD',
          name: 'Synthetic consultation',
          department: 'opd',
          category: 'CONSULTATION',
          unit: 'Visit',
          initialPrice: '123.45',
        }),
      ),
    );
    expect(await screen.findByText('Service and initial tariff saved.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Facility tariffs' })).getByText('KES 123.45'),
    ).toBeInTheDocument();
  });

  it('requires an explicit category and unit and clears them when the department changes', async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByRole('button', { name: 'Edit service SYN-OPD' });
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.getByLabelText('Service category')).toHaveValue('');
    expect(screen.getByLabelText('Billing unit')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('Service category'), 'CONSULTATION');
    await user.type(screen.getByLabelText('Billing unit'), 'Visit');
    await user.selectOptions(screen.getByLabelText('Department'), 'pharmacy');
    expect(screen.getByLabelText('Service category')).toHaveValue('');
    expect(screen.getByLabelText('Billing unit')).toHaveValue('');
    expect(mocks.api.createFacilityService).not.toHaveBeenCalled();
  });

  it('does not save a tariff edit if its revision was unavailable', async () => {
    mocks.api.getFacilityTariffs.mockResolvedValue([{ ...tariff, revision: undefined }]);
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByRole('button', { name: 'Edit tariff PRICE-OPD' }));
    await user.click(screen.getByRole('button', { name: 'Save tariff' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload the tariff before saving.');
    expect(mocks.api.updateFacilityTariff).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Price (KES)')).toHaveValue('123.45');
  });

  it('submits a separately created tariff for its selected service and reloads it', async () => {
    const extra = {
      ...tariff,
      id: 21,
      code: 'PRICE-ALT',
      description: 'Synthetic alternate price',
      fee: '75.35',
      isActive: false,
      effectiveFrom: null,
      effectiveTo: null,
      revision: 1,
    };
    mocks.api.createFacilityTariff.mockImplementation(async () => {
      mocks.api.getFacilityTariffs.mockResolvedValue([tariff, extra]);
      return extra;
    });
    const user = userEvent.setup();
    renderManager();
    await screen.findByRole('button', { name: 'Edit service SYN-OPD' });
    await user.click(screen.getByRole('button', { name: 'Add tariff' }));
    await user.selectOptions(screen.getByLabelText('Service'), '10');
    await user.type(screen.getByLabelText('Tariff code'), 'PRICE-ALT');
    await user.type(screen.getByLabelText('Tariff description'), 'Synthetic alternate price');
    await user.type(screen.getByLabelText('Price (KES)'), '75.35');
    await user.click(screen.getByLabelText('Active tariff'));
    await user.click(screen.getByRole('button', { name: 'Save tariff' }));
    await waitFor(() =>
      expect(mocks.api.createFacilityTariff).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 5,
          serviceId: 10,
          code: 'PRICE-ALT',
          description: 'Synthetic alternate price',
          department: 'opd',
          unit: 'Visit',
          fee: '75.35',
          isActive: false,
          effectiveFrom: null,
          effectiveTo: null,
        }),
      ),
    );
    expect(await screen.findByText('Tariff saved.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Facility tariffs' })).getByText('KES 75.35'),
    ).toBeInTheDocument();
  });

  it('uses the originally loaded state when editing and does not invent or change the price', async () => {
    mocks.api.updateFacilityService.mockImplementation(async () => {
      mocks.api.getFacilityServices.mockResolvedValue([
        { ...consultation, name: 'Edited synthetic consultation' },
        pharmacy,
      ]);
    });
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByRole('button', { name: 'Edit service SYN-OPD' }));
    expect(screen.getByRole('button', { name: 'Add tariff' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit tariff PRICE-OPD' })).toBeDisabled();
    const input = screen.getByLabelText('Service name');
    await user.clear(input);
    await user.type(input, 'Edited synthetic consultation');
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() =>
      expect(mocks.api.updateFacilityService).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          name: 'Edited synthetic consultation',
          expectedState: {
            name: consultation.name,
            description: consultation.description,
            isActive: true,
            autoBill: true,
          },
        }),
      ),
    );
    expect(await screen.findByText('Service changes saved.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Facility tariffs' })).getByText('KES 123.45'),
    ).toBeInTheDocument();
    expect(mocks.api.updateFacilityTariff).not.toHaveBeenCalled();
  });

  it('submits an edited tariff as an exact string with its loaded revision', async () => {
    mocks.api.updateFacilityTariff.mockImplementation(async () => {
      mocks.api.getFacilityTariffs.mockResolvedValue([{ ...tariff, fee: '456.78', revision: 5 }]);
    });
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByRole('button', { name: 'Edit tariff PRICE-OPD' }));
    const input = screen.getByLabelText('Price (KES)');
    await user.clear(input);
    await user.type(input, '456.78');
    await user.click(screen.getByRole('button', { name: 'Save tariff' }));
    await waitFor(() =>
      expect(mocks.api.updateFacilityTariff).toHaveBeenCalledWith(
        20,
        expect.objectContaining({
          facilityId: 5,
          serviceId: 10,
          code: 'PRICE-OPD',
          fee: '456.78',
          expectedRevision: 4,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31',
        }),
      ),
    );
    expect(await screen.findByText('Tariff changes saved.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Facility tariffs' })).getByText('KES 456.78'),
    ).toBeInTheDocument();
  });

  it('keeps entered values on a conflict and asks before discarding them for reload', async () => {
    mocks.api.updateFacilityTariff.mockRejectedValue(
      new ApiError(
        'This tariff changed while you were editing. Reload and review the latest values before saving.',
        409,
        'TARIFF_CHANGED',
      ),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByRole('button', { name: 'Edit tariff PRICE-OPD' }));
    const input = screen.getByLabelText('Price (KES)');
    await user.clear(input);
    await user.type(input, '456.78');
    await user.click(screen.getByRole('button', { name: 'Save tariff' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed while you were editing');
    expect(screen.getByRole('button', { name: 'Save tariff' })).toBeEnabled();
    expect(input).toHaveValue('456.78');
    expect(screen.queryByText('Tariff changes saved.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload lists' }));
    expect(input).toHaveValue('456.78');
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reload lists' }));
    await waitFor(() => expect(screen.queryByLabelText('Price (KES)')).not.toBeInTheDocument());
    expect(
      within(screen.getByRole('table', { name: 'Facility tariffs' })).getByText('KES 123.45'),
    ).toBeInTheDocument();
  });

  it('requires a reload before retrying when the save response is uncertain', async () => {
    mocks.api.updateFacilityTariff.mockRejectedValue(
      new ApiError('Synthetic connection lost', 503, 'SERVICE_UNAVAILABLE'),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByRole('button', { name: 'Edit tariff PRICE-OPD' }));
    const input = screen.getByLabelText('Price (KES)');
    await user.clear(input);
    await user.type(input, '456.78');
    await user.click(screen.getByRole('button', { name: 'Save tariff' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');
    expect(input).toHaveValue('456.78');
    expect(screen.getByRole('button', { name: 'Save tariff' })).toBeDisabled();
    expect(mocks.api.updateFacilityTariff).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Reload lists' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('Price (KES)')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add tariff' })).toBeEnabled());
  });

  it('distinguishes an accepted save from a failed list refresh', async () => {
    mocks.api.updateFacilityService.mockImplementation(async () => {
      mocks.api.getFacilityServices.mockRejectedValueOnce(
        new Error('Synthetic list refresh failed'),
      );
    });
    const user = userEvent.setup();
    renderManager();
    await user.click(await screen.findByRole('button', { name: 'Edit service SYN-OPD' }));
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic list refresh failed');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Service changes saved. The list could not be refreshed.',
    );
    expect(screen.queryByText('No facility services have been created.')).not.toBeInTheDocument();
  });
});
