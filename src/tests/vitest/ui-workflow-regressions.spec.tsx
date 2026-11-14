// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  getQueues: vi.fn(),
  getAppointments: vi.fn(),
  getAppointmentCategories: vi.fn(),
  getAppointmentResources: vi.fn(),
  getAppointmentHistory: vi.fn(),
  checkInAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  rescheduleAppointment: vi.fn(),
  createAppointmentCategory: vi.fn(),
  updateAppointmentCategory: vi.fn(),
  getPatients: vi.fn(),
  getPatientDirectoryPage: vi.fn(),
  getPatient: vi.fn(),
  getEncounters: vi.fn(),
  getInvoices: vi.fn(),
  getFacilityTariffs: vi.fn(),
  createAppointment: vi.fn(),
  getInventory: vi.fn(),
  getInventoryBatches: vi.fn(),
  getExpirySummary: vi.fn(),
  createInventoryItem: vi.fn(),
  receiveBatch: vi.fn(),
  getAuditLogs: vi.fn(),
  getRadiologyOrders: vi.fn(),
  createRadiologyOrder: vi.fn(),
  updateRadiologyReport: vi.fn(),
  getPublicHealthReports: vi.fn(),
  getMoh705Summary: vi.fn(),
  recordPublicHealthReport: vi.fn(),
  correctPublicHealthReport: vi.fn(),
  publicHealthWeekSummary: vi.fn(),
  showToast: vi.fn(),
  triggerRefresh: vi.fn(),
  setActiveModule: vi.fn(),
}));
const privateMocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  listPayers: vi.fn(),
  listMembers: vi.fn(),
  listEligibility: vi.fn(),
  listBenefits: vi.fn(),
  listMappings: vi.fn(),
  listPreauthorizations: vi.fn(),
  listClaims: vi.fn(),
  listRemittances: vi.fn(),
  getReconciliation: vi.fn(),
  getDiagnostics: vi.fn(),
}));
vi.mock('../../api/private-insurance.client.ts', () => ({ privateInsuranceApi: privateMocks }));
vi.mock('../../api/client.ts', () => ({ api: mocks }));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    currentTenant: { id: 1 },
    currentFacility: {
      id: 10,
      tenantId: 1,
      name: 'Synthetic Facility',
      timezone: 'Africa/Nairobi',
      enabledModules: ['opd', 'dialysis'],
      hiddenModules: [],
    },
    authenticatedUser: {
      id: 7,
      isSuperAdmin: false,
      permissions: [
        'inventory.manage',
        'clinical.read',
        'dialysis.read',
        'appointments.read',
        'appointments.create',
        'appointments.update',
        'appointments.cancel',
        'appointments.categories.manage',
      ],
    },
    currentUser: { name: 'Synthetic Clinician', role: 'Clinician' },
    refreshKey: 0,
    showToast: mocks.showToast,
    triggerRefresh: mocks.triggerRefresh,
    setActiveModule: mocks.setActiveModule,
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
  }),
}));
vi.mock('../../components/portal/PortalInviteDialog.tsx', () => ({
  PortalInviteDialog: () => null,
}));
import { ReceptionQueueModule } from '../../components/modules/ReceptionQueueModule.tsx';
import { InventoryModule } from '../../components/modules/InventoryModule.tsx';
import { AuditLogModule } from '../../components/modules/AuditLogModule.tsx';
import { RadiologyModule } from '../../components/modules/RadiologyModule.tsx';
import { PublicHealthModule } from '../../components/modules/PublicHealthModule.tsx';
import { PrivateInsuranceModule } from '../../components/modules/private-insurance/PrivateInsuranceModule.tsx';
import { SpecialtyModule } from '../../components/modules/SpecialtyModule.tsx';

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(privateMocks)) mock.mockReset();
  privateMocks.getDashboard.mockResolvedValue({
    kpis: {
      activeMembersCount: 3,
      pendingPreauthsCount: 0,
      pendingSubmissionCount: 0,
      unreconciledRemittancesCount: 0,
    },
  });
  privateMocks.listPayers.mockResolvedValue({ payers: [] });
  privateMocks.listMembers.mockResolvedValue({ members: [] });
  privateMocks.listEligibility.mockResolvedValue({ verifications: [] });
  privateMocks.listBenefits.mockResolvedValue({ rules: [], validations: [] });
  privateMocks.listMappings.mockResolvedValue({ mappings: [] });
  privateMocks.listPreauthorizations.mockResolvedValue({ preauthorizations: [] });
  privateMocks.listClaims.mockResolvedValue({ claims: [] });
  privateMocks.listRemittances.mockResolvedValue({ remittances: [] });
  privateMocks.getReconciliation.mockResolvedValue({ summary: {}, entries: [] });
  privateMocks.getDiagnostics.mockResolvedValue({ diagnostics: [], auditEvents: [] });
  mocks.getEncounters.mockResolvedValue([]);
  mocks.getInvoices.mockResolvedValue([]);
  mocks.getFacilityTariffs.mockResolvedValue([]);
  mocks.getPatient.mockResolvedValue({
    id: 99,
    firstName: 'Synthetic',
    lastName: 'Earlier Patient',
    mrn: 'OLD',
  });
  mocks.getQueues.mockResolvedValue([]);
  mocks.getRadiologyOrders.mockResolvedValue([]);
  mocks.getPublicHealthReports.mockResolvedValue([]);
  mocks.publicHealthWeekSummary.mockResolvedValue({
    facilityId: 10,
    epiWeek: '2026-W44',
    tallies: [],
    superseded: [],
    totals: { diseases: 0, records: 0, casesCount: 0, mortalityCount: 0, disputedGroups: 0 },
    submission: {
      ready: false,
      blockedBy: 'No active records were recorded for this week.',
      transmitted: false,
    },
    limitations: { format: 'FACILITY_TALLY_ONLY', notice: 'Synthetic limitation notice.' },
  });
  mocks.getMoh705Summary.mockRejectedValue(new Error('This report is not produced by this build.'));
  mocks.getAppointments.mockResolvedValue([]);
  mocks.getAppointmentCategories.mockResolvedValue([]);
  mocks.getAppointmentResources.mockResolvedValue({ departments: [], practitioners: [] });
  mocks.getAppointmentHistory.mockResolvedValue([]);
  mocks.getPatients.mockResolvedValue([
    { id: 5, firstName: 'Synthetic', lastName: 'Patient', mrn: 'TEST' },
  ]);
  mocks.getPatientDirectoryPage.mockResolvedValue({
    items: [{ id: 5, firstName: 'Synthetic', lastName: 'Patient', mrn: 'TEST' }],
    nextCursor: null,
  });
  mocks.getInventory.mockResolvedValue([]);
  mocks.getInventoryBatches.mockResolvedValue([]);
  mocks.getExpirySummary.mockResolvedValue({
    expiredBatches: 0,
    expiringBatches: 0,
    expiredUnits: 0,
    expiringUnits: 0,
    affectedItems: 0,
    horizonDays: 30,
  });
  mocks.getAuditLogs.mockResolvedValue([]);
});
afterEach(cleanup);

describe('unified workflow regressions', () => {
  it('requires an explicit patient and time and does not pre-populate clinical appointment text', async () => {
    const user = userEvent.setup();
    render(<ReceptionQueueModule />);
    await waitFor(() => expect(mocks.getPatients).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Book Appointment' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule Patient Clinic Appointment' });
    expect(within(dialog).getByLabelText('Select patient *')).toHaveValue('');
    expect(within(dialog).getByLabelText('Date & time *')).toHaveValue('');
    expect(within(dialog).getByLabelText('Clinical indication / reason')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Booking' }));
    expect(mocks.createAppointment).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('makes reception errors visible instead of showing failed data as an empty queue', async () => {
    mocks.getQueues.mockRejectedValueOnce(new Error('Queue unavailable'));
    render(<ReceptionQueueModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Queue unavailable');
    expect(screen.getByText('Queue data unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/No waiting tokens currently/)).not.toBeInTheDocument();
  });
  it('does not fabricate inventory item, quantity, unit price or batch inputs', async () => {
    const user = userEvent.setup();
    render(<InventoryModule />);
    await waitFor(() => expect(mocks.getInventory).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add Stock Item' }));
    let dialog = screen.getByRole('dialog', { name: 'Add Inventory Stock Item' });
    expect(within(dialog).getByLabelText('Item Code *')).toHaveValue('');
    expect(within(dialog).getByLabelText('Trade / Brand Name *')).toHaveValue('');
    expect(within(dialog).getByLabelText('Initial Stock Quantity')).toHaveValue(null);
    expect(within(dialog).getByLabelText('Unit Cost (KES)')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Save Stock Item' }));
    expect(mocks.createInventoryItem).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Receive Batch' }));
    dialog = screen.getByRole('dialog', { name: 'Receive Stock into a Batch' });
    expect(within(dialog).getByLabelText('Stock Item')).toHaveValue('');
    expect(within(dialog).getByLabelText('Quantity')).toHaveValue(null);
    expect(within(dialog).getByLabelText('Cost per Unit (KES)')).toHaveValue(null);
    expect(mocks.receiveBatch).not.toHaveBeenCalled();
  });
  it('distinguishes an unavailable stock or batch service from a genuine zero', async () => {
    mocks.getInventory.mockRejectedValueOnce(new Error('unavailable'));
    mocks.getInventoryBatches.mockRejectedValueOnce(new Error('unavailable'));
    mocks.getExpirySummary.mockRejectedValueOnce(new Error('unavailable'));
    const user = userEvent.setup();
    render(<InventoryModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Inventory items could not be loaded',
    );
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Batches & Expiry' }));
    expect(screen.queryByText('No batches recorded yet.')).not.toBeInTheDocument();
  });
  it('does not show a zero or empty audit ledger when its API fails and can retry', async () => {
    mocks.getAuditLogs
      .mockRejectedValueOnce(new Error('Audit unavailable'))
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<AuditLogModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Audit unavailable');
    expect(screen.queryByText('0 events shown')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No audit events found')).toBeInTheDocument();
    expect(screen.getByText('0 events shown')).toBeInTheDocument();
  });
  it('submits the explicitly entered appointment using the existing facility-scoped API', async () => {
    mocks.createAppointment.mockResolvedValueOnce({ id: 12 });
    const user = userEvent.setup();
    render(<ReceptionQueueModule />);
    await waitFor(() => expect(mocks.getPatients).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Book Appointment' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule Patient Clinic Appointment' });
    await user.selectOptions(within(dialog).getByLabelText('Select patient *'), '5');
    await user.type(within(dialog).getByLabelText('Date & time *'), '2026-11-06 10:00');
    await user.selectOptions(
      within(dialog).getByLabelText('Appointment type'),
      'Specialist Consultation',
    );
    await user.type(
      within(dialog).getByLabelText('Clinical indication / reason'),
      'Synthetic follow-up',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Booking' }));
    await waitFor(() =>
      expect(mocks.createAppointment).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 10,
          tenantId: 1,
          patientId: 5,
          scheduledTime: '2026-11-06 10:00',
          reason: 'Synthetic follow-up',
          notes: '',
        }),
        expect.any(String),
      ),
    );
    expect(mocks.triggerRefresh).toHaveBeenCalled();
  });
  it('keeps the same booking retry key after an unconfirmed response', async () => {
    mocks.createAppointment
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce({ id: 12 });
    const user = userEvent.setup();
    render(<ReceptionQueueModule />);
    await waitFor(() => expect(mocks.getPatients).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Book Appointment' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule Patient Clinic Appointment' });
    await user.selectOptions(within(dialog).getByLabelText('Select patient *'), '5');
    await user.type(within(dialog).getByLabelText('Date & time *'), '2031-11-06 10:00');
    await user.selectOptions(within(dialog).getByLabelText('Appointment type'), 'OPD');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Booking' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Connection interrupted');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Booking' }));
    await waitFor(() => expect(mocks.createAppointment).toHaveBeenCalledTimes(2));
    expect(mocks.createAppointment.mock.calls[0][1]).toBe(mocks.createAppointment.mock.calls[1][1]);
    expect(mocks.createAppointment.mock.calls[0][1]).toEqual(expect.any(String));
    expect(mocks.createAppointment.mock.calls[0][0]).toEqual(
      mocks.createAppointment.mock.calls[1][0],
    );
  });
  it('uses a date-scoped day/week/month diary and shows history and payment uncertainty', async () => {
    const user = userEvent.setup();
    mocks.getAppointments.mockResolvedValue([
      {
        id: 41,
        tenantId: 1,
        facilityId: 10,
        patientId: 5,
        scheduledTime: '2031-06-04T09:00',
        durationMinutes: 30,
        appointmentType: 'Synthetic',
        status: 'Scheduled',
        bookingReference: 'APT-SYNTHETIC',
        createdAt: '2031-01-01',
      },
    ]);
    mocks.getAppointmentHistory.mockResolvedValue([
      {
        id: 1,
        appointmentId: 41,
        eventType: 'CREATED',
        actorType: 'STAFF',
        actorUserId: 7,
        fromStatus: null,
        toStatus: 'Scheduled',
        reason: null,
        scheduledTimeBefore: null,
        scheduledTimeAfter: '2031-06-04T09:00',
        relatedAppointmentId: null,
        queueId: null,
        paymentState: 'NOT_ASSESSED',
        createdAt: '2031-01-01',
      },
    ]);
    render(<ReceptionQueueModule />);
    expect(await screen.findByText('APT-SYNTHETIC', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Payment: not linked or assessed in this diary.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Diary date'), { target: { value: '2031-06-04' } });
    await user.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() =>
      expect(mocks.getAppointments).toHaveBeenLastCalledWith(
        10,
        expect.objectContaining({ from: '2031-06-02', to: '2031-06-08', active: true }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() =>
      expect(mocks.getAppointments).toHaveBeenLastCalledWith(
        10,
        expect.objectContaining({ from: '2031-06-01', to: '2031-06-30' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    const history = screen.getByRole('dialog', { name: 'Appointment history' });
    expect(await within(history).findByText(/Staff user #7/)).toBeInTheDocument();
    expect(within(history).getByText(/Payment state is not assessed/)).toBeInTheDocument();
  });
  it('reports cancellation failure in the dialog, requires a reason and never implies a refund', async () => {
    const user = userEvent.setup();
    mocks.getAppointments.mockResolvedValue([
      {
        id: 42,
        tenantId: 1,
        facilityId: 10,
        patientId: 5,
        scheduledTime: '2031-06-04T09:00',
        durationMinutes: 30,
        appointmentType: 'Synthetic',
        status: 'Scheduled',
        createdAt: '2031-01-01',
      },
    ]);
    mocks.cancelAppointment
      .mockRejectedValueOnce(new Error('Cancellation unavailable'))
      .mockResolvedValueOnce({ id: 42, status: 'Cancelled' });
    render(<ReceptionQueueModule />);
    await screen.findByText('Payment: not linked or assessed in this diary.');
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel appointment' });
    expect(within(dialog).getByText(/No payment or refund is processed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.cancelAppointment).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason *'), 'Synthetic cancellation');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cancellation unavailable');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.cancelAppointment).toHaveBeenCalledWith(42, 10, 'Synthetic cancellation'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cancel appointment' })).not.toBeInTheDocument(),
    );
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Payment and refunds were not assessed'),
      expect.anything(),
    );
  });
  it('uses the appointment check-in endpoint and displays a refused queue operation', async () => {
    const user = userEvent.setup();
    mocks.getAppointments.mockResolvedValue([
      {
        id: 43,
        tenantId: 1,
        facilityId: 10,
        patientId: 5,
        scheduledTime: '2031-06-04T09:00',
        durationMinutes: 30,
        appointmentType: 'Synthetic',
        status: 'Scheduled',
        createdAt: '2031-01-01',
      },
    ]);
    mocks.checkInAppointment.mockRejectedValueOnce(new Error('Already checked in'));
    render(<ReceptionQueueModule />);
    await user.click(await screen.findByRole('button', { name: 'Check in' }));
    const dialog = screen.getByRole('dialog', { name: 'Check in appointment' });
    await user.selectOptions(within(dialog).getByLabelText('Queue station *'), 'Triage');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Already checked in');
    expect(mocks.checkInAppointment).toHaveBeenCalledWith(43, 10, 'Triage');
    expect(mocks.triggerRefresh).not.toHaveBeenCalled();
  });
  it('keeps a confirmed zero threshold distinct from missing cost when creating stock', async () => {
    mocks.createInventoryItem.mockResolvedValueOnce({ id: 9 });
    const user = userEvent.setup();
    render(<InventoryModule />);
    await waitFor(() => expect(mocks.getInventory).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Add Stock Item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Inventory Stock Item' });
    await user.type(within(dialog).getByLabelText('Item Code *'), 'SYN-ITEM');
    await user.type(within(dialog).getByLabelText('Trade / Brand Name *'), 'Synthetic item');
    await user.type(within(dialog).getByLabelText('Initial Stock Quantity'), '0');
    await user.type(within(dialog).getByLabelText('Reorder Level Alert'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save Stock Item' }));
    await waitFor(() =>
      expect(mocks.createInventoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 10,
          itemCode: 'SYN-ITEM',
          currentStock: 0,
          reorderLevel: 0,
          unitCost: null,
          sellingPrice: null,
        }),
      ),
    );
    expect(mocks.receiveBatch).not.toHaveBeenCalled();
  });
  it('does not count a zero reorder threshold as the old fallback of fifty', async () => {
    mocks.getInventory.mockResolvedValueOnce([
      {
        id: 1,
        itemCode: 'SYN',
        name: 'Synthetic',
        currentStock: 3,
        reorderLevel: 0,
        unitCost: null,
        sellingPrice: null,
      },
    ]);
    render(<InventoryModule />);
    const card = await screen.findByText('Reorder level alerts');
    expect(within(card.closest('article')!).getByText('0')).toBeInTheDocument();
    const valuation = screen.getByText('Store valuation').closest('article')!;
    expect(within(valuation).getByText('Unavailable')).toBeInTheDocument();
  });
  it('does not preselect a patient or prefill clinical details in an imaging request', async () => {
    mocks.createRadiologyOrder.mockResolvedValueOnce({ id: 42 });
    const user = userEvent.setup();
    render(<RadiologyModule />);
    await waitFor(() => expect(mocks.getRadiologyOrders).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'New Imaging Request' }));
    const dialog = screen.getByRole('dialog', { name: 'Request Diagnostic Medical Imaging' });
    expect(within(dialog).getByLabelText('Select patient *')).toHaveValue('');
    expect(within(dialog).getByLabelText('Procedure title *')).toHaveValue('');
    expect(within(dialog).getByLabelText('Clinical indication & history *')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Send Imaging Request' }));
    expect(mocks.createRadiologyOrder).not.toHaveBeenCalled();
    await user.selectOptions(within(dialog).getByLabelText('Select patient *'), '5');
    await user.type(within(dialog).getByLabelText('Procedure title *'), 'Synthetic procedure');
    await user.type(
      within(dialog).getByLabelText('Clinical indication & history *'),
      'Synthetic clinical reason',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send Imaging Request' }));
    await waitFor(() =>
      expect(mocks.createRadiologyOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 10,
          tenantId: 1,
          patientId: 5,
          procedureName: 'Synthetic procedure',
          clinicalIndication: 'Synthetic clinical reason',
          orderedBy: 'Synthetic Clinician',
          status: 'Requested',
        }),
      ),
    );
  });
  it('does not invent PACS connectivity, study metadata, or reporter credentials', async () => {
    mocks.getRadiologyOrders.mockResolvedValueOnce([
      {
        id: 42,
        patientId: 5,
        procedureName: 'Synthetic procedure',
        modality: 'X-Ray',
        status: 'Requested',
        createdAt: '2026-10-01',
        clinicalIndication: '',
      },
    ]);
    mocks.updateRadiologyReport.mockResolvedValueOnce({ id: 42 });
    const user = userEvent.setup();
    render(<RadiologyModule />);
    expect(await screen.findByText('Imaging connection not verified.')).toBeInTheDocument();
    expect(
      screen.queryByText(/DICOM 3.0 Connected|128 Slices|Routine imaging/),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText(/Detailed anatomical observations/),
      'Synthetic findings',
    );
    await user.click(screen.getByRole('button', { name: 'Save Imaging Report' }));
    await waitFor(() =>
      expect(mocks.updateRadiologyReport).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          reportedBy: 'Synthetic Clinician',
          findings: 'Synthetic findings',
        }),
      ),
    );
  });
  it('marks a default-zero stock valuation unconfirmed rather than assuming that zero is a recorded price', async () => {
    mocks.getInventory.mockResolvedValueOnce([
      {
        id: 2,
        itemCode: 'SYN-DEFAULT',
        name: 'Synthetic',
        currentStock: 3,
        reorderLevel: 0,
        unitCost: '0',
        sellingPrice: '0',
      },
    ]);
    render(<InventoryModule />);
    expect(await screen.findByText('Unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('Zero or unpriced')).toBeInTheDocument();
    expect(screen.getByText('Zero or unset')).toBeInTheDocument();
  });
  it('requires explicit surveillance condition, counts and age before saving a local case', async () => {
    mocks.recordPublicHealthReport.mockResolvedValueOnce({ id: 8 });
    const user = userEvent.setup();
    render(<PublicHealthModule />);
    await screen.findByText('This report is not produced by this build.');
    await user.click(screen.getByRole('button', { name: /Record.*case/i }));
    const dialog = screen.getByRole('dialog', { name: 'Record a notifiable case' });
    for (const label of ['Condition', 'Cases', 'Deaths', 'Age group', 'Epi-week']) {
      const field = within(dialog).getByLabelText(label);
      expect(field).toHaveValue(
        field instanceof HTMLInputElement && field.type === 'number' ? null : '',
      );
    }
    await user.click(within(dialog).getByRole('button', { name: 'Record case' }));
    expect(mocks.recordPublicHealthReport).not.toHaveBeenCalled();
    await user.selectOptions(within(dialog).getByLabelText('Condition'), 'A00');
    await user.type(within(dialog).getByLabelText('Cases'), '2');
    await user.type(within(dialog).getByLabelText('Deaths'), '0');
    await user.selectOptions(within(dialog).getByLabelText('Age group'), 'Under 5 Years');
    await user.type(within(dialog).getByLabelText('Epi-week'), '2026-W44');
    await user.click(within(dialog).getByRole('button', { name: 'Record case' }));
    await waitFor(() =>
      expect(mocks.recordPublicHealthReport).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 10,
          diseaseCode: 'A00',
          casesCount: 2,
          mortalityCount: 0,
          ageGroup: 'Under 5 Years',
          epiWeek: '2026-W44',
        }),
      ),
    );
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('not been transmitted'),
      expect.anything(),
    );
  });
  it('looks up an imaging patient outside the current directory page using the scoped patient API', async () => {
    mocks.getRadiologyOrders.mockResolvedValueOnce([
      {
        id: 42,
        patientId: 99,
        procedureName: 'Synthetic procedure',
        modality: 'X-Ray',
        status: 'Requested',
        createdAt: '2026-10-01',
      },
    ]);
    render(<RadiologyModule />);
    expect(await screen.findByText('Synthetic Earlier Patient')).toBeInTheDocument();
    expect(mocks.getPatient).toHaveBeenCalledWith(99);
  });
  it('marks a failed private insurance data source unavailable and retries without hiding unrelated views', async () => {
    privateMocks.getDashboard.mockRejectedValueOnce(new Error('unavailable'));
    const user = userEvent.setup();
    render(<PrivateInsuranceModule />);
    expect(
      await screen.findByText(
        /This view is unavailable because its data could not be loaded: Dashboard/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Active memberships')).not.toBeInTheDocument();
    expect(screen.getByText(/Failed sources are not empty records/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /2. Insurers/ }));
    expect(screen.getByText('Enabled private payers')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /1. Dashboard/ }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const label = await screen.findByText('Active memberships');
    expect(within(label.parentElement!).getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/Failed sources are not empty records/)).not.toBeInTheDocument();
  });
  it('does not present the non-persistent specialty examples as saved care or billing', async () => {
    const user = userEvent.setup();
    render(<SpecialtyModule />);
    expect(
      await screen.findByText(/former example forms did not persist records/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Patient record')).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: /Save Dental|Save Optical|Save ENT/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Renal & haemodialysis' }));
    expect(screen.getByRole('tabpanel', { name: 'Renal & haemodialysis' })).toHaveTextContent(
      'clinically approved',
    );
    await user.click(screen.getByRole('button', { name: 'Open dialysis' }));
    expect(mocks.setActiveModule).toHaveBeenCalledWith('dialysis');
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
