import type {
  Admission,
  Bed,
  BedBillingPolicy,
  BedBillingUnresolvedPage,
  BedOccupancyView,
  InpatientBoard,
  ShiftHandover,
  TheatreCase,
  VitalObservation,
  Ward,
} from '../../types/index.ts';
import { API_BASE, fetchJson, type ServiceCharge } from './http.ts';

const facilityQuery = (facilityId?: number) => facilityId === undefined ? '' : `?facilityId=${encodeURIComponent(String(facilityId))}`;

export const inpatientClient = {
  getWards: (facilityId?: number) =>
    fetchJson<Ward[]>(`${API_BASE}/wards${facilityId ? `?facilityId=${facilityId}` : ''}`),

  getBeds: (wardId?: number, facilityId?: number) => {
    const params = new URLSearchParams();
    if (wardId !== undefined) params.set('wardId', String(wardId));
    if (facilityId !== undefined) params.set('facilityId', String(facilityId));
    const query = params.toString();
    return fetchJson<Bed[]>(`${API_BASE}/beds${query ? `?${query}` : ''}`);
  },

  createWard: (data: {
    facilityId?: number;
    name: string;
    code: string;
    wardType: string;
    genderAllocation: string;
    /** Omit or send undefined for "not priced" — never send 0. */
    dailyRate?: string | null;
  }) =>
    fetchJson<Ward>(`${API_BASE}/wards`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateWard: (
    id: number,
    data: {
      name?: string;
      wardType?: string;
      genderAllocation?: string;
      dailyRate?: string | null;
      isActive?: boolean;
    },
  ) =>
    fetchJson<Ward>(`${API_BASE}/wards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteWard: (id: number) =>
    fetchJson<{ deleted: boolean; wardId: number; code: string }>(`${API_BASE}/wards/${id}`, {
      method: 'DELETE',
    }),

  createBeds: (data: {
    wardId: number;
    bedNumbers?: string[];
    prefix?: string;
    startNumber?: number;
    count?: number;
    bedType: string;
    /** Omit for "not priced" — never send 0. */
    dailyCharge?: string | null;
    priceReason?: string;
  }) =>
    fetchJson<{ created: Bed[]; wardId: number; totalBeds: number }>(`${API_BASE}/beds`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateBed: (
    id: number,
    data: {
      bedNumber?: string;
      bedType?: string;
      dailyCharge?: string | null;
      expectedPriceRevision?: number;
      priceReason?: string;
      status?: string;
    },
  ) =>
    fetchJson<Bed>(`${API_BASE}/beds/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteBed: (id: number) =>
    fetchJson<{ deleted: boolean; bedId: number; bedNumber: string }>(`${API_BASE}/beds/${id}`, {
      method: 'DELETE',
    }),

  updateBedStatus: (id: number, status: string) =>
    fetchJson<Bed>(`${API_BASE}/beds/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
      }),
    }),

  releaseBed: (id: number, facilityId?: number) =>
    fetchJson<Bed>(`${API_BASE}/beds/${id}/release${facilityQuery(facilityId)}`, {
      method: 'PUT',
    }),

  getAdmissions: (facilityId?: number, status?: string) => {
    const params = new URLSearchParams();

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    if (status) {
      params.append('status', status);
    }

    const query = params.toString();

    return fetchJson<Admission[]>(`${API_BASE}/admissions${query ? `?${query}` : ''}`);
  },

  createAdmission: (adm: Partial<Admission>) =>
    fetchJson<Admission>(`${API_BASE}/admissions`, {
      method: 'POST',
      body: JSON.stringify(adm),
    }),

  dischargePatient: (
    id: number,
    data: {
      facilityId?: number;
      dischargeDate?: string;
      dischargeType: string;
      dischargeSummary: string;
    },
  ) =>
    fetchJson<
      Admission & {
        billing?: {
          nights: number | null;
          bedDays: Array<ServiceCharge | null>;
          review?: { code: string; message: string } | null;
        };
      }
    >(`${API_BASE}/admissions/${id}/discharge`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  transferAdmission: (
    id: number,
    data: { facilityId?: number; toWardId: number; toBedId: number; reason?: string; transferredBy?: string },
  ) =>
    fetchJson<any>(`${API_BASE}/admissions/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getAdmissionTransfers: (id: number) => fetchJson<any[]>(`${API_BASE}/admissions/${id}/transfers`),

  accrueBedDays: (id: number, untilDate?: string, facilityId?: number) =>
    fetchJson<any>(`${API_BASE}/admissions/${id}/accrue-bed-days${facilityQuery(facilityId)}`, {
      method: 'POST',
      body: JSON.stringify({ untilDate }),
    }),

  getBedBillingPolicy: (facilityId?: number) => fetchJson<BedBillingPolicy | null>(`${API_BASE}/inpatient/bed-billing-policy${facilityQuery(facilityId)}`),
  setBedBillingPolicy: (data: { facilityId?: number; cutoffMinutes: number; graceMinutes: number; sameDayRule: 'ONE' | 'ZERO'; isActive: boolean; effectiveFrom: string; effectiveUntil?: string | null; expectedRevision?: number | null; reason: string }) =>
    fetchJson<BedBillingPolicy>(`${API_BASE}/inpatient/bed-billing-policy`, { method: 'PUT', body: JSON.stringify(data) }),
  getUnresolvedBedBilling: (facilityId?: number, offset = 0) => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (facilityId !== undefined) params.set('facilityId', String(facilityId));
    return fetchJson<BedBillingUnresolvedPage>(`${API_BASE}/inpatient/bed-billing-unresolved?${params.toString()}`);
  },
  getBedOccupancy: (id: number, facilityId?: number) => fetchJson<BedOccupancyView>(`${API_BASE}/admissions/${id}/bed-occupancy${facilityQuery(facilityId)}`),
  linkBedBillingEncounter: (id: number, encounterId: number, reason: string, evidenceReference: string, affirmRelationship: boolean, facilityId?: number) =>
    fetchJson<Admission>(`${API_BASE}/admissions/${id}/bed-billing-encounter${facilityQuery(facilityId)}`, { method: 'POST', body: JSON.stringify({ encounterId, reason, evidenceReference, affirmRelationship }) }),
  reviewBedHistory: (id: number, data: { timezone: string; cutoffMinutes: number; graceMinutes: number; sameDayRule: 'ONE' | 'ZERO'; reason: string; evidenceReference: string; affirmReviewedHistoryAndCharges: boolean; periods: Array<{ wardId: number; bedId: number; startedAt: string; endedAt: string; dailyRate: string }> }, facilityId?: number) =>
    fetchJson<{ reviewId: number; nights: number }>(`${API_BASE}/admissions/${id}/bed-history-review${facilityQuery(facilityId)}`, { method: 'POST', body: JSON.stringify(data) }),
  retryBedBilling: (id: number, facilityId?: number) => fetchJson<{ nights: number | null; charges: ServiceCharge[]; review: { code: string; message: string } | null }>(`${API_BASE}/admissions/${id}/bed-billing-retry${facilityQuery(facilityId)}`, { method: 'POST', body: '{}' }),

  getInpatientBoard: (facilityId?: number) =>
    fetchJson<InpatientBoard>(
      `${API_BASE}/inpatient/board${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getAdmissionVitals: (admissionId: number, limit = 20) =>
    fetchJson<VitalObservation[]>(`${API_BASE}/admissions/${admissionId}/vitals?limit=${limit}`),

  recordWardVitals: (
    admissionId: number,
    vitals: Partial<
      Omit<VitalObservation, 'id' | 'recordedAt' | 'encounterId' | 'patientId' | 'flags'>
    > & {
      recordedBy?: string;
    },
  ) =>
    fetchJson<VitalObservation>(`${API_BASE}/admissions/${admissionId}/vitals`, {
      method: 'POST',
      body: JSON.stringify(vitals),
    }),

  getShiftHandover: (date?: string, shift?: string) => {
    const params = new URLSearchParams();

    if (date) params.append('date', date);
    if (shift) params.append('shift', shift);

    const query = params.toString();

    return fetchJson<ShiftHandover>(
      `${API_BASE}/nursing-notes/handover${query ? `?${query}` : ''}`,
    );
  },

  getNursingNotes: (filters: { admissionId?: number; patientId?: number }) => {
    const params = new URLSearchParams();

    if (filters.admissionId) {
      params.append('admissionId', String(filters.admissionId));
    }

    if (filters.patientId) {
      params.append('patientId', String(filters.patientId));
    }

    const query = params.toString();

    return fetchJson<any[]>(`${API_BASE}/nursing-notes${query ? `?${query}` : ''}`);
  },

  createNursingNote: (data: {
    admissionId?: number;
    patientId: number;
    encounterId?: number;
    noteType?: string;
    shift?: string;
    note: string;
    recordedBy?: string;
  }) =>
    fetchJson<any>(`${API_BASE}/nursing-notes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTheatreCases: (facilityId?: number) =>
    fetchJson<TheatreCase[]>(
      `${API_BASE}/theatre-cases${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  createTheatreCase: (tc: Partial<TheatreCase>) =>
    fetchJson<TheatreCase>(`${API_BASE}/theatre-cases`, {
      method: 'POST',
      body: JSON.stringify(tc),
    }),

  updateTheatreCase: (id: number, tc: Partial<TheatreCase>) =>
    fetchJson<TheatreCase>(`${API_BASE}/theatre-cases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(tc),
    }),
};
