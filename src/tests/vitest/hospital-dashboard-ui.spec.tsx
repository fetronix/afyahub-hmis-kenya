// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api/client.ts';
import { HospitalDashboard } from '../../components/modules/HospitalDashboard.tsx';
import { Header } from '../../components/Header.tsx';
import type { DashboardOverview } from '../../dashboard/dashboard.types.ts';

let context: any;
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => context }));
vi.mock('../../components/modules/DashboardModule.tsx', () => ({
  DashboardModule: () => <div>Existing operational screen</div>,
}));
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });
const makeOverview = (facilityId = 10): DashboardOverview => ({
  facilityId,
  range: { start: '2025-04-01', end: '2025-04-30' },
  previousRange: { start: '2025-03-02', end: '2025-03-31' },
  registrations: ok({
    current: 2,
    previous: 1,
    totalThroughEnd: 10,
    trend: [
      { start: '2025-04-01', end: '2025-04-15', value: 1 },
      { start: '2025-04-16', end: '2025-04-30', value: 1 },
    ],
  }),
  receipts: ok({
    gross: '100.00',
    refunds: '20.00',
    net: '80.00',
    previousNet: '40.00',
    trend: [
      { start: '2025-04-01', end: '2025-04-15', net: '30.00' },
      { start: '2025-04-16', end: '2025-04-30', net: '50.00' },
    ],
  }),
  invoices: ok({
    current: 1,
    previous: 1,
    billed: '200.00',
    recordedBalance: '120.00',
    finalized: 0,
    categories: [{ label: 'Consultation', amount: '200.00' }],
  }),
  admissions: ok({ current: 0, previous: 0 }),
  flow: ok([{ start: '2025-04-01', end: '2025-04-30', registered: 2, returning: 1 }]),
  activity: ok([]),
  appointments: ok([
    {
      id: 7,
      patientName: 'Synthetic Patient',
      scheduledTime: '2026-12-01 09:00',
      appointmentType: 'Synthetic consultation',
      practitionerName: null,
      status: 'Scheduled',
    },
  ]),
});

describe('hospital dashboard behavior', () => {
  beforeEach(() => {
    context = {
      currentFacility: {
        id: 10,
        name: 'Synthetic Facility',
        enabledModules: ['registration', 'reception', 'opd', 'inpatient', 'finance', 'audit'],
        hiddenModules: [],
      },
      authenticatedUser: {
        id: 1,
        fullName: 'Synthetic Clinician',
        permissions: [
          'patients.read',
          'appointments.read',
          'clinical.read',
          'inpatient.read',
          'billing.read',
          'tariffs.read',
          'audit.read',
        ],
      },
      currentUser: { name: 'Synthetic Clinician', role: 'Clinician' },
      currentTenant: { id: 1, name: 'Synthetic Tenant' },
      facilities: [],
      tenants: [],
      setCurrentFacility: vi.fn(),
      setCurrentTenant: vi.fn(),
      setActiveModule: vi.fn(),
      setDirectorySearch: vi.fn(),
      isMobileMenuOpen: false,
      setIsMobileMenuOpen: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      refreshKey: 0,
    };
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows live metrics, a genuine zero, clear billing caveats, and existing operations', async () => {
    vi.spyOn(api, 'getDashboardOverview').mockResolvedValue(makeOverview());
    const user = userEvent.setup();
    render(<HospitalDashboard />);
    expect((await screen.findAllByText('KES 80')).length).toBeGreaterThan(0);
    expect(screen.getByText('Synthetic Facility')).toBeInTheDocument();
    expect(screen.getByText('No audit activity in the selected period.')).toBeInTheDocument();
    expect(screen.getByText(/Collection rate/)).toBeInTheDocument();
    expect(screen.getByText(/Invoice balances are unreconciled/)).toBeInTheDocument();
    expect(screen.getByText(/1 Dec/)).toBeInTheDocument();
    expect(screen.getByText(/ISO-style scheduled times only/)).toBeInTheDocument();
    expect(
      within(screen.getByText('Admission records').closest('article')!).getByText('0'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Operational dashboard/ }));
    expect(screen.getByText('Existing operational screen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reception' }));
    expect(context.setActiveModule).toHaveBeenCalledWith('reception');
  });

  it('renders a zone-less audit wall time as stored, without shifting it to the browser timezone', async () => {
    const data = makeOverview();
    data.activity = ok([
      { id: 11, action: 'CREATE', resource: 'Patient', at: '2025-04-05T11:00:00' },
    ]);
    vi.spyOn(api, 'getDashboardOverview').mockResolvedValue(data);
    render(<HospitalDashboard />);
    const time = (await screen.findByText('CREATE')).closest('li')?.querySelector('time');
    expect(time).toHaveTextContent('11:00');
    expect(time).toHaveAttribute('datetime', '2025-04-05T11:00:00');
  });

  it('distinguishes restricted or failed panels and total API failure from zero', async () => {
    const data = makeOverview();
    data.receipts = {
      status: 'restricted',
      message: 'Your account does not have permission to view this information.',
    };
    data.invoices = { status: 'disabled', message: 'The required facility module is not enabled.' };
    vi.spyOn(api, 'getDashboardOverview')
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error('Service unavailable'));
    const user = userEvent.setup();
    render(<HospitalDashboard />);
    expect(
      await screen.findAllByText('Your account does not have permission to view this information.'),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByText('The required facility module is not enabled.').length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByText('Net recorded receipts').closest('article')!).getByText('—'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select dashboard date range' }));
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(
      within(screen.getByText('Admission records').closest('article')!).getByText('—'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Dashboard request failed. Retry to load this information.').length,
    ).toBeGreaterThan(0);
  });

  it('requests the selected custom range and rejects malformed dates', async () => {
    const spy = vi.spyOn(api, 'getDashboardOverview').mockResolvedValue(makeOverview());
    const user = userEvent.setup();
    render(<HospitalDashboard />);
    await screen.findByText('Synthetic Facility');
    await user.click(screen.getByRole('button', { name: 'Select dashboard date range' }));
    await user.clear(screen.getByLabelText('Custom start date'));
    await user.type(screen.getByLabelText('Custom start date'), '2025-05-10');
    await user.clear(screen.getByLabelText('Custom end date'));
    await user.type(screen.getByLabelText('Custom end date'), '2025-05-01');
    await user.click(screen.getByRole('button', { name: 'Apply dates' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose valid dates');
    await user.clear(screen.getByLabelText('Custom start date'));
    await user.type(screen.getByLabelText('Custom start date'), '2025-04-01');
    await user.clear(screen.getByLabelText('Custom end date'));
    await user.type(screen.getByLabelText('Custom end date'), '2025-04-30');
    await user.click(screen.getByRole('button', { name: 'Apply dates' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        10,
        { start: '2025-04-01', end: '2025-04-30' },
        expect.any(AbortSignal),
      ),
    );
  });

  it('never renders a late response from a previously selected facility', async () => {
    let resolveFirst: (value: DashboardOverview) => void = () => {};
    vi.spyOn(api, 'getDashboardOverview').mockImplementation((id) =>
      id === 10
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(makeOverview(11)),
    );
    const { rerender } = render(<HospitalDashboard />);
    context = {
      ...context,
      currentFacility: { ...context.currentFacility, id: 11, name: 'Synthetic Other Facility' },
    };
    rerender(<HospitalDashboard />);
    await waitFor(() => expect(screen.getByText('Synthetic Other Facility')).toBeInTheDocument());
    resolveFirst(makeOverview(10));
    await waitFor(() => expect(screen.getByText('Synthetic Other Facility')).toBeInTheDocument());
    expect(screen.queryByText('Synthetic Facility')).not.toBeInTheDocument();
  });

  it('retains the real profile fields and closes the menu on an outside click', async () => {
    context.authenticatedUser.username = 'synthetic.clinician';
    context.authenticatedUser.accountStatus = 'ACTIVE';
    context.currentUser.department = 'Synthetic work area';
    context.currentUser.license = 'SYNTHETIC-ID';
    const user = userEvent.setup();
    render(<Header collapsed={false} onToggleCollapse={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Synthetic Clinician/ }));
    expect(screen.getByText('@synthetic.clinician')).toBeInTheDocument();
    expect(screen.getByText('Account: ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Work area: Synthetic work area')).toBeInTheDocument();
    expect(screen.getByText('Professional ID: SYNTHETIC-ID')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clears search input and results immediately when the authorized facility changes', async () => {
    vi.spyOn(api, 'searchDashboard').mockResolvedValue({
      patients: [{ id: 1, name: 'Synthetic Patient', mrn: 'TEST-001' }],
      invoices: [],
      services: [],
      available: { patients: true, invoices: false, services: false },
    });
    const user = userEvent.setup();
    const { rerender } = render(<Header collapsed={false} onToggleCollapse={vi.fn()} />);
    await user.type(screen.getByLabelText('Search patients, invoices, or services'), 'Synthetic');
    await screen.findByRole('button', { name: /Synthetic Patient/ });
    context = { ...context, currentFacility: { ...context.currentFacility, id: 11 } };
    rerender(<Header collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByLabelText('Search patients, invoices, or services')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Synthetic Patient/ })).not.toBeInTheDocument();
  });

  it('searches real result types and hands patient MRN to the existing directory', async () => {
    vi.spyOn(api, 'searchDashboard').mockResolvedValue({
      patients: [{ id: 1, name: 'Synthetic Patient', mrn: 'TEST-001' }],
      invoices: [],
      services: [],
      available: { patients: true, invoices: false, services: false },
    });
    const user = userEvent.setup();
    render(<Header collapsed={false} onToggleCollapse={vi.fn()} />);
    const input = screen.getByLabelText('Search patients, invoices, or services');
    await user.type(input, 'Synthetic');
    await user.click(await screen.findByRole('button', { name: /Synthetic Patient/ }));
    expect(context.setDirectorySearch).toHaveBeenCalledWith('TEST-001');
    expect(context.setActiveModule).toHaveBeenCalledWith('registration');
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(
      screen.getByText(/persistent notification inbox is not configured/i),
    ).toBeInTheDocument();
  });
});
