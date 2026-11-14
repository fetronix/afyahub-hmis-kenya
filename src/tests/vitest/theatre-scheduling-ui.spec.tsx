// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTheatreRooms: vi.fn(),
  getTheatreSchedule: vi.fn(),
  getTheatrePractitioners: vi.fn(),
  getPatients: vi.fn(),
  createTheatreRoom: vi.fn(),
  setTheatreRoomState: vi.fn(),
  scheduleTheatreCase: vi.fn(),
  rescheduleTheatreCase: vi.fn(),
  cancelTheatreCase: vi.fn(),
  getTheatreSchedulingHistory: vi.fn(),
  getTheatreScheduleReport: vi.fn(),
  reviewLegacyTheatreReservation: vi.fn(),
  getLegacyTheatreReviews: vi.fn(),
  context: {
    currentFacility: { id: 12, tenantId: 3, name: 'Synthetic facility' },
    authenticatedUser: {
      permissions: [
        'theatre.read',
        'theatre.reports.read',
        'theatre.schedule.create',
        'theatre.schedule.manage',
        'theatre.schedule.reconcile',
        'theatre.rooms.manage',
        'patients.read',
      ],
    },
    refreshKey: 0,
  },
}));
vi.mock('../../api/client.ts', () => ({ api: mocks }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
import { TheatreModule } from '../../components/modules/TheatreModule.tsx';

const room = { id: 21, facilityId: 12, tenantId: 3, name: 'Synthetic room', state: 'OPEN' };
const clinician = {
  id: 31,
  fullName: 'Synthetic clinician',
  credentialVerificationStatus: 'PENDING',
  profession: 'Clinician',
  specialty: null,
  licenseExpiryDate: null,
};
const record = {
  id: 41,
  patientId: 51,
  procedureName: 'Synthetic procedure',
  leadSurgeon: 'Synthetic clinician',
  roomName: room.name,
  scheduledStart: '2030-01-01T08:00:00Z',
  scheduledEnd: '2030-01-01T09:00:00Z',
  status: 'Scheduled',
  patient: { id: 51, firstName: 'Synthetic', lastName: 'Patient', mrn: 'MRN-TEST' },
  booking: {
    caseId: 41,
    roomId: 21,
    patientId: 51,
    leadPractitionerId: 31,
    urgency: 'ELECTIVE',
    startsAt: '2030-01-01T08:00:00Z',
    endsAt: '2030-01-01T09:00:00Z',
    reserved: true,
    revision: 1,
    encounterId: null,
    admissionId: null,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.currentFacility = { id: 12, tenantId: 3, name: 'Synthetic facility' };
  mocks.context.authenticatedUser.permissions = [
    'theatre.read',
    'theatre.reports.read',
    'theatre.schedule.create',
    'theatre.schedule.manage',
    'theatre.schedule.reconcile',
    'theatre.rooms.manage',
    'patients.read',
  ];
  mocks.context.refreshKey = 0;
  mocks.getTheatreRooms.mockResolvedValue([room]);
  mocks.getTheatrePractitioners.mockResolvedValue([clinician]);
  mocks.getTheatreSchedule.mockResolvedValue([record]);
  mocks.getPatients.mockResolvedValue([
    { id: 51, firstName: 'Synthetic', lastName: 'Patient', mrn: 'MRN-TEST' },
  ]);
  mocks.scheduleTheatreCase.mockResolvedValue({
    record: { id: 42 },
    booking: record.booking,
    replayed: false,
  });
  mocks.cancelTheatreCase.mockResolvedValue({
    booking: { ...record.booking, reserved: false, revision: 2 },
  });
  mocks.getTheatreScheduleReport.mockResolvedValue({
    from: '2030-01-01T00:00:00Z',
    to: '2030-01-02T00:00:00Z',
    totals: { bookings: 1, reserved: 1, cancelled: 0, otherUnreserved: 0, reservedMinutes: 60 },
    rows: [
      {
        roomId: 21,
        roomName: room.name,
        urgency: 'ELECTIVE',
        status: 'Scheduled',
        reserved: true,
        count: 1,
        plannedMinutes: 60,
      },
    ],
  });
  mocks.getTheatreSchedulingHistory.mockResolvedValue([
    {
      id: 1,
      action: 'SCHEDULED',
      actorId: 7,
      createdAt: '2030-01-01T08:00:00Z',
      reason: null,
      newRoomId: 21,
      newStartsAt: '2030-01-01T08:00:00Z',
      newEndsAt: '2030-01-01T09:00:00Z',
    },
  ]);
});

describe('Theatre scheduling UI', () => {
  it('requires read permission and does not fetch or fabricate cases without it', () => {
    mocks.context.authenticatedUser.permissions = ['theatre.schedule.create'];
    render(<TheatreModule />);
    expect(screen.getByText(/Theatre read permission is required/i)).toBeInTheDocument();
    expect(mocks.getTheatreSchedule).not.toHaveBeenCalled();
  });

  it('shows loading, real failures and an explicit scheduling-only warning', async () => {
    mocks.getTheatreSchedule.mockRejectedValueOnce(new Error('Synthetic server unavailable'));
    render(<TheatreModule />);
    expect(screen.getByText(/Loading theatre schedule/i)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic server unavailable');
    expect(screen.getByText(/not clinical readiness/i)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic procedure')).not.toBeInTheDocument();
  });

  it('starts with empty clinical inputs, searches real patients and preserves a retry key on error', async () => {
    mocks.scheduleTheatreCase.mockRejectedValueOnce(new Error('Synthetic conflict'));
    render(<TheatreModule />);
    await screen.findByText('Synthetic procedure');
    fireEvent.click(screen.getByRole('button', { name: /New booking/i }));
    expect(screen.getByLabelText('Procedure name')).toHaveValue('');
    expect(screen.getByLabelText('Patient')).toHaveValue('');
    expect(screen.getByLabelText('Lead practitioner')).toHaveValue('');
    expect(screen.getByLabelText('Urgency')).toHaveValue('');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Find a registered patient/i), {
      target: { value: 'MRN-TEST' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('option', { name: /Synthetic Patient · MRN-TEST/i });
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: '51' } });
    fireEvent.change(screen.getByLabelText('Procedure name'), {
      target: { value: 'Synthetic new case' },
    });
    fireEvent.change(screen.getByLabelText('Lead practitioner'), { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText('Urgency'), { target: { value: 'EMERGENCY' } });
    fireEvent.change(screen.getByLabelText('Room'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText(/^Start/), { target: { value: '2030-01-02T11:00' } });
    fireEvent.change(screen.getByLabelText(/^End/), { target: { value: '2030-01-02T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save booking/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic conflict');
    const first = mocks.scheduleTheatreCase.mock.calls[0][0];
    expect(first).toMatchObject({
      facilityId: 12,
      patientId: 51,
      leadPractitionerId: 31,
      urgency: 'EMERGENCY',
      roomId: 21,
    });
    expect(first.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.click(screen.getByRole('button', { name: /Save booking/i }));
    await waitFor(() => expect(mocks.scheduleTheatreCase).toHaveBeenCalledTimes(2));
    expect(mocks.scheduleTheatreCase.mock.calls[1][0].requestKey).toBe(first.requestKey);
    expect(
      await screen.findByText(/Clinical readiness has not been established/i),
    ).toBeInTheDocument();
  });

  it('loads scheduling history and submits a reason with the current cancellation revision', async () => {
    render(<TheatreModule />);
    await screen.findByText('Synthetic procedure');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const historyHeading = await screen.findByText(/Scheduling history · case #41/);
    expect(
      within(historyHeading.parentElement!.parentElement!).getByText(/SCHEDULED/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic reason' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() =>
      expect(mocks.cancelTheatreCase).toHaveBeenCalledWith(41, 12, 1, 'Synthetic reason'),
    );
  });

  it('loads a permission-gated report without calling planned minutes actual utilisation', async () => {
    render(<TheatreModule />);
    await screen.findByText('Synthetic procedure');
    fireEvent.change(screen.getByLabelText(/Report from/), {
      target: { value: '2030-01-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText(/Report to/), { target: { value: '2030-01-02T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    expect(await screen.findByText(/planned reserved minutes/i)).toHaveTextContent('60');
    expect(mocks.getTheatreScheduleReport).toHaveBeenCalledWith(
      12,
      expect.any(String),
      expect.any(String),
    );
    expect(screen.getByText(/Not actual utilisation or completed surgery/i)).toBeInTheDocument();
  });

  it('does not display an old facility response after switching facilities', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    const oldRequest = new Promise((resolve) => {
      resolveOld = resolve;
    });
    mocks.getTheatreSchedule.mockImplementation((id: number) =>
      id === 12 ? oldRequest : Promise.resolve([]),
    );
    mocks.getTheatreRooms.mockImplementation((id: number) =>
      Promise.resolve(id === 12 ? [room] : []),
    );
    const view = render(<TheatreModule />);
    mocks.context.currentFacility = { id: 13, tenantId: 3, name: 'Other synthetic facility' };
    view.rerender(<TheatreModule />);
    expect(await screen.findByText('No saved cases in this facility.')).toBeInTheDocument();
    resolveOld([record]);
    await waitFor(() => expect(screen.queryByText('Synthetic procedure')).not.toBeInTheDocument());
    expect(screen.getByText('Other synthetic facility')).toBeInTheDocument();
  });

  it('requires an explicit reservation attestation and never labels a legacy case clinically complete', async () => {
    mocks.getTheatreSchedule.mockResolvedValue([
      { ...record, booking: null, legacyReview: null, procedureName: 'Synthetic legacy' },
    ]);
    mocks.reviewLegacyTheatreReservation.mockResolvedValue({ id: 1 });
    render(<TheatreModule />);
    await screen.findByText('Synthetic legacy');
    expect(
      screen.getByText(/historical case\(s\) require a scheduling reservation review/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review reservation' }));
    expect(
      screen.getByText(/does not establish consent, clinical completion or readiness/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Review reason'), {
      target: { value: 'Synthetic verification' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record review' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Confirm that the historical reservation has been reviewed',
    );
    expect(mocks.reviewLegacyTheatreReservation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Record review' }));
    await waitFor(() =>
      expect(mocks.reviewLegacyTheatreReservation).toHaveBeenCalledWith(
        12,
        41,
        'NO_ACTIVE_RESERVATION',
        'Synthetic verification',
        true,
      ),
    );
  });

  it('does not expose create or change controls to a read-only user', async () => {
    mocks.context.authenticatedUser.permissions = ['theatre.read'];
    render(<TheatreModule />);
    await screen.findByText('Synthetic procedure');
    expect(screen.queryByRole('button', { name: /New booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add room' })).not.toBeInTheDocument();
  });
});
