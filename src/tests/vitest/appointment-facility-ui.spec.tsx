// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  facility: { id: 10, tenantId: 1, timezone: 'Africa/Nairobi' },
  getQueues: vi.fn(),
  getPatients: vi.fn(),
  getPatientDirectoryPage: vi.fn(),
  getAppointments: vi.fn(),
  getAppointmentCategories: vi.fn(),
  getAppointmentResources: vi.fn(),
  createAppointment: vi.fn(),
  showToast: vi.fn(),
  triggerRefresh: vi.fn(),
}));
vi.mock('../../api/client.ts', () => ({ api: mocks }));
vi.mock('../../components/portal/PortalInviteDialog.tsx', () => ({
  PortalInviteDialog: () => null,
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    currentFacility: mocks.facility,
    currentTenant: { id: 1, timezone: 'Africa/Nairobi' },
    authenticatedUser: { permissions: ['appointments.read', 'appointments.create'] },
    setActiveModule: vi.fn(),
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
    showToast: mocks.showToast,
    refreshKey: 0,
    triggerRefresh: mocks.triggerRefresh,
  }),
}));
import { ReceptionQueueModule } from '../../components/modules/ReceptionQueueModule.tsx';

afterEach(cleanup);
it('discards the previous facility queue, patient and unsaved notes before the new facility loads', async () => {
  const user = userEvent.setup();
  let finishB: (value: any[]) => void = () => {};
  const pendingB = new Promise<any[]>((resolve) => {
    finishB = resolve;
  });
  mocks.facility = { id: 10, tenantId: 1, timezone: 'Africa/Nairobi' };
  mocks.getQueues.mockImplementation((id: number) =>
    id === 10
      ? Promise.resolve([
          {
            id: 7,
            patientId: 101,
            tokenNumber: 'SYN-1',
            queueType: 'Triage',
            priority: 'Normal',
            status: 'Waiting',
            waitingTimeMinutes: 0,
          },
        ])
      : pendingB,
  );
  mocks.getPatients.mockImplementation((_tenant: number, id: number) =>
    id === 10
      ? Promise.resolve([{ id: 101, firstName: 'Synthetic', lastName: 'Facility A', mrn: 'SYN-A' }])
      : pendingB,
  );
  mocks.getPatientDirectoryPage.mockResolvedValue({ items: [], nextCursor: null });
  mocks.getAppointments.mockResolvedValue([]);
  mocks.getAppointmentCategories.mockResolvedValue([]);
  mocks.getAppointmentResources.mockResolvedValue({ departments: [], practitioners: [] });
  const view = render(<ReceptionQueueModule />);
  expect(await screen.findByText('Synthetic Facility A')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Book Appointment' }));
  const dialog = screen.getByRole('dialog', { name: 'Schedule Patient Clinic Appointment' });
  await user.type(within(dialog).getByLabelText('Notes'), 'Private synthetic note');
  mocks.facility = { id: 11, tenantId: 1, timezone: 'Africa/Nairobi' };
  view.rerender(<ReceptionQueueModule />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Synthetic Facility A')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Private synthetic note')).not.toBeInTheDocument();
  finishB([]);
  await waitFor(() => expect(mocks.getQueues).toHaveBeenCalledWith(11, 'All'));
  expect(screen.queryByText('Synthetic Facility A')).not.toBeInTheDocument();
});

it('books an explicitly selected patient from a later scoped directory page', async () => {
  mocks.facility = { id: 10, tenantId: 1, timezone: 'Africa/Nairobi' };
  mocks.getQueues.mockResolvedValue([]);
  mocks.getPatients.mockResolvedValue([]);
  mocks.getAppointments.mockResolvedValue([]);
  mocks.getAppointmentCategories.mockResolvedValue([]);
  mocks.getAppointmentResources.mockResolvedValue({ departments: [], practitioners: [] });
  mocks.getPatientDirectoryPage.mockImplementation(async ({ beforeId }: { beforeId?: number }) =>
    beforeId
      ? {
          items: [{ id: 7, firstName: 'Synthetic', lastName: 'Older', mrn: 'SYN-7' }],
          nextCursor: null,
        }
      : {
          items: [{ id: 50, firstName: 'Synthetic', lastName: 'Recent', mrn: 'SYN-50' }],
          nextCursor: 50,
        },
  );
  mocks.createAppointment.mockResolvedValue({ id: 1 });
  const user = userEvent.setup();
  render(<ReceptionQueueModule />);
  await user.click(await screen.findByRole('button', { name: 'Book Appointment' }));
  const dialog = screen.getByRole('dialog', { name: 'Schedule Patient Clinic Appointment' });
  await within(dialog).findByRole('option', { name: /Synthetic Recent/ });
  await user.click(within(dialog).getByRole('button', { name: 'Next page' }));
  await within(dialog).findByRole('option', { name: /Synthetic Older/ });
  await user.selectOptions(within(dialog).getByLabelText('Select patient *'), '7');
  await user.type(within(dialog).getByLabelText('Date & time *'), '2031-11-06 10:00');
  await user.selectOptions(within(dialog).getByLabelText('Appointment type'), 'OPD');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm Booking' }));
  await waitFor(() =>
    expect(mocks.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1, facilityId: 10, patientId: 7 }),
      expect.any(String),
    ),
  );
  expect(mocks.getPatientDirectoryPage).toHaveBeenCalledWith(
    expect.objectContaining({
      tenantId: 1,
      facilityId: 10,
      beforeId: 50,
    }),
  );
});

it('discards a delayed appointment-directory response after the facility changes', async () => {
  mocks.getPatientDirectoryPage.mockClear();
  let finish: (page: unknown) => void = () => {};
  mocks.facility = { id: 10, tenantId: 1, timezone: 'Africa/Nairobi' };
  mocks.getQueues.mockResolvedValue([]);
  mocks.getPatients.mockResolvedValue([]);
  mocks.getAppointments.mockResolvedValue([]);
  mocks.getAppointmentCategories.mockResolvedValue([]);
  mocks.getAppointmentResources.mockResolvedValue({ departments: [], practitioners: [] });
  mocks.getPatientDirectoryPage.mockImplementation(({ facilityId }: { facilityId: number }) =>
    facilityId === 10
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({
          items: [{ id: 8, firstName: 'Synthetic', lastName: 'Current', mrn: 'SYN-8' }],
          nextCursor: null,
        }),
  );
  const user = userEvent.setup();
  const view = render(<ReceptionQueueModule />);
  await user.click(await screen.findByRole('button', { name: 'Book Appointment' }));
  await waitFor(() =>
    expect(mocks.getPatientDirectoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ facilityId: 10 }),
    ),
  );
  mocks.facility = { id: 11, tenantId: 1, timezone: 'Africa/Nairobi' };
  view.rerender(<ReceptionQueueModule />);
  await user.click(screen.getByRole('button', { name: 'Book Appointment' }));
  const dialog = screen.getByRole('dialog', { name: 'Schedule Patient Clinic Appointment' });
  await within(dialog).findByRole('option', { name: /Synthetic Current/ });
  finish({
    items: [{ id: 7, firstName: 'Synthetic', lastName: 'Stale', mrn: 'SYN-7' }],
    nextCursor: null,
  });
  await waitFor(() =>
    expect(
      within(dialog).queryByRole('option', { name: /Synthetic Stale/ }),
    ).not.toBeInTheDocument(),
  );
  expect(within(dialog).getByRole('option', { name: /Synthetic Current/ })).toBeInTheDocument();
});
