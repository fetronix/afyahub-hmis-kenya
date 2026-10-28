import type {
  Admission,
  Bed,
  InpatientBoard,
  ShiftHandover,
  TheatreCase,
  VitalObservation,
  Ward,
} from '../../types/index.ts';
import { API_BASE, fetchJson, type ServiceCharge } from './http.ts';

export const inpatientClient = {
  getWards: (facilityId?: number) =>
    fetchJson<Ward[]>(`${API_BASE}/wards${facilityId ? `?facilityId=${facilityId}` : ''}`),

  getBeds: (wardId?: number) =>
    fetchJson<Bed[]>(`${API_BASE}/beds${wardId ? `?wardId=${wardId}` : ''}`),

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

  releaseBed: (id: number) =>
    fetchJson<Bed>(`${API_BASE}/beds/${id}/release`, {
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
      dischargeDate: string;
      dischargeType: string;
      dischargeSummary: string;
    },
  ) =>
    fetchJson<
      Admission & {
        billing?: {
          nights: number;
          bedDays: Array<ServiceCharge | null>;
        };
      }
    >(`${API_BASE}/admissions/${id}/discharge`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  transferAdmission: (
    id: number,
    data: { toWardId: number; toBedId: number; reason?: string; transferredBy?: string },
  ) =>
    fetchJson<any>(`${API_BASE}/admissions/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getAdmissionTransfers: (id: number) => fetchJson<any[]>(`${API_BASE}/admissions/${id}/transfers`),

  accrueBedDays: (id: number, untilDate?: string) =>
    fetchJson<any>(`${API_BASE}/admissions/${id}/accrue-bed-days`, {
      method: 'POST',
      body: JSON.stringify({ untilDate }),
    }),

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
