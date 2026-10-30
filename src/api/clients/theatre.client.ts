import { API_BASE, fetchJson } from './http.ts';

export type TheatreRoomState = 'OPEN' | 'MAINTENANCE' | 'INACTIVE';
export type TheatreUrgency = 'ELECTIVE' | 'URGENT' | 'EMERGENCY';
export interface TheatreRoom {
  id: number;
  tenantId: number;
  facilityId: number;
  name: string;
  state: TheatreRoomState;
}
export interface TheatrePractitioner {
  id: number;
  fullName: string;
  profession: string | null;
  specialty: string | null;
  credentialVerificationStatus: string;
  licenseExpiryDate: string | null;
}
export interface TheatreBooking {
  caseId: number;
  roomId: number;
  patientId: number;
  leadPractitionerId: number;
  encounterId: number | null;
  admissionId: number | null;
  urgency: TheatreUrgency;
  startsAt: string;
  endsAt: string;
  reserved: boolean;
  revision: number;
}
export interface TheatreLegacyReviewEvent {
  id: number;
  caseId: number;
  action: 'NO_ACTIVE_RESERVATION' | 'REVOKED';
  reason: string;
  actorId: number;
  createdAt: string;
}
export interface TheatreScheduledCase {
  id: number;
  patientId: number;
  procedureName: string;
  leadSurgeon: string;
  theatreRoom: string | null;
  scheduledStart: string;
  scheduledEnd: string | null;
  status: string | null;
  booking: TheatreBooking | null;
  legacyReview?: TheatreLegacyReviewEvent | null;
  roomName: string | null;
  patient: { id: number; firstName: string; lastName: string; mrn: string } | null;
}
export interface TheatreHistoryEvent {
  id: number;
  action: 'SCHEDULED' | 'RESCHEDULED' | 'CANCELLED' | 'NO_ACTIVE_RESERVATION' | 'REVOKED';
  reason: string | null;
  actorId: number;
  createdAt: string;
  previousRoomId: number | null;
  newRoomId: number | null;
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  newStartsAt: string | null;
  newEndsAt: string | null;
}
export interface TheatreScheduleReport {
  from: string;
  to: string;
  totals: {
    bookings: number;
    reserved: number;
    cancelled: number;
    otherUnreserved: number;
    reservedMinutes: number;
  };
  rows: Array<{
    roomId: number;
    roomName: string;
    urgency: string;
    status: string | null;
    reserved: boolean;
    count: number;
    plannedMinutes: number;
  }>;
}
export interface CreateTheatreBooking {
  facilityId: number;
  patientId: number;
  procedureName: string;
  leadPractitionerId: number;
  urgency: TheatreUrgency;
  roomId: number;
  startsAt: string;
  endsAt: string;
  requestKey: string;
  encounterId?: number;
  admissionId?: number;
}
export interface RescheduleTheatreBooking {
  facilityId: number;
  expectedRevision: number;
  roomId: number;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export const theatreClient = {
  getTheatreScheduleReport: (facilityId: number, from: string, to: string) => {
    const query = new URLSearchParams({ facilityId: String(facilityId), from, to });
    return fetchJson<TheatreScheduleReport>(
      `${API_BASE}/theatre/reports/schedule?${query.toString()}`,
    );
  },
  reviewLegacyTheatreReservation: (
    facilityId: number,
    caseId: number,
    action: 'NO_ACTIVE_RESERVATION' | 'REVOKED',
    reason: string,
    acknowledged: boolean,
  ) =>
    fetchJson<TheatreLegacyReviewEvent>(`${API_BASE}/theatre/cases/${caseId}/legacy-review`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, action, reason, acknowledged }),
    }),
  getLegacyTheatreReviews: (facilityId: number, caseId: number) =>
    fetchJson<TheatreLegacyReviewEvent[]>(
      `${API_BASE}/theatre/cases/${caseId}/legacy-reviews?facilityId=${facilityId}`,
    ),
  getTheatreRooms: (facilityId: number) =>
    fetchJson<TheatreRoom[]>(`${API_BASE}/theatre/rooms?facilityId=${facilityId}`),
  createTheatreRoom: (facilityId: number, name: string) =>
    fetchJson<TheatreRoom>(`${API_BASE}/theatre/rooms`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, name }),
    }),
  setTheatreRoomState: (facilityId: number, id: number, state: TheatreRoomState) =>
    fetchJson<TheatreRoom>(`${API_BASE}/theatre/rooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ facilityId, state }),
    }),
  getTheatrePractitioners: (facilityId: number) =>
    fetchJson<TheatrePractitioner[]>(`${API_BASE}/theatre/practitioners?facilityId=${facilityId}`),
  getTheatreSchedule: (facilityId: number) =>
    fetchJson<TheatreScheduledCase[]>(`${API_BASE}/theatre/cases?facilityId=${facilityId}`),
  scheduleTheatreCase: (data: CreateTheatreBooking) =>
    fetchJson<{ record: { id: number }; booking: TheatreBooking; replayed: boolean }>(
      `${API_BASE}/theatre/cases`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  rescheduleTheatreCase: (id: number, data: RescheduleTheatreBooking) =>
    fetchJson<{ booking: TheatreBooking }>(`${API_BASE}/theatre/cases/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  cancelTheatreCase: (id: number, facilityId: number, expectedRevision: number, reason: string) =>
    fetchJson<{ booking: TheatreBooking }>(`${API_BASE}/theatre/cases/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, expectedRevision, reason }),
    }),
  getTheatreSchedulingHistory: (id: number, facilityId: number) =>
    fetchJson<TheatreHistoryEvent[]>(
      `${API_BASE}/theatre/cases/${id}/history?facilityId=${facilityId}`,
    ),
};
