// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  facility: { id: 10, tenantId: 1, timezone: 'Africa/Nairobi' },
  getQueues: vi.fn(),
  getPatients: vi.fn(),
  getAppointments: vi.fn(),
  getAppointmentCategories: vi.fn(),
  getAppointmentResources: vi.fn(),
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
