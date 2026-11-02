import type {
  Appointment,
  AppointmentCategory,
  AppointmentEvent,
  Diagnosis,
  Encounter,
  Medication,
  Observation,
  Patient,
  Procedure,
  QueueItem,
} from '../../types/index.ts';
import { API_BASE, fetchJson, type ServiceCharge } from './http.ts';

export interface PatientConsent {
  id: number;
  patientId: number;
  purpose: string;
  /** Derived by the server from stored status and expiry. */
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  storedStatus: string;
  scope: Record<string, boolean>;
  method: string;
  grantedThrough: string | null;
  documentHash: string | null;
  version: number | null;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedByUserId: number | null;
}

export interface PatientAllergy {
  id: number;
  patientId: number;
  allergenType: string;
  allergen: string;
  reaction: string | null;
  severity: string;
  status: 'ACTIVE' | 'RESOLVED' | 'ENTERED_IN_ERROR';
  notes: string | null;
  recordedAt: string;
  recordedByUserId: number | null;
  resolvedAt: string | null;
}

export interface AllergyWarning {
  allergyId: number;
  allergen: string;
  allergenType: string;
  severity: string;
  reaction: string | null;
  matchedOn: string;
}

export interface AllergyCheckResult {
  success: boolean;
  warnings: AllergyWarning[];
  checked: string[];
  disclaimer: string;
}

export const patientsClinicalClient = {
  getPatients: (tenantId?: number, facilityId?: number, search?: string) => {
    const params = new URLSearchParams();

    if (tenantId) {
      params.append('tenantId', tenantId.toString());
    }

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    if (search) {
      params.append('search', search);
    }

    const query = params.toString();

    return fetchJson<Patient[]>(`${API_BASE}/patients${query ? `?${query}` : ''}`);
  },

  getPatient: (id: number) => fetchJson<Patient>(`${API_BASE}/patients/${id}`),

  createPatient: (patient: Partial<Patient> & { registrationFacilityId: number }) =>
    fetchJson<Patient>(`${API_BASE}/patients`, {
      method: 'POST',
      body: JSON.stringify(patient),
    }),

  updatePatient: (id: number, patient: Partial<Patient>) =>
    fetchJson<Patient>(`${API_BASE}/patients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patient),
    }),

  getPatientConsents: (patientId: number) =>
    fetchJson<{ success: boolean; consents: PatientConsent[]; counts: Record<string, number> }>(
      `${API_BASE}/patients/${patientId}/consents`,
    ),

  grantPatientConsent: (
    patientId: number,
    consent: {
      purpose: string;
      method: string;
      scope: Record<string, boolean>;
      expiresAt?: string | null;
      documentHash?: string | null;
    },
  ) =>
    fetchJson<{ success: boolean; consent: PatientConsent }>(
      `${API_BASE}/patients/${patientId}/consents`,
      {
        method: 'POST',
        body: JSON.stringify(consent),
      },
    ),

  revokePatientConsent: (patientId: number, consentId: number, reason?: string) =>
    fetchJson<{ success: boolean; consent: PatientConsent }>(
      `${API_BASE}/patients/${patientId}/consents/${consentId}/revoke`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    ),

  getPatientAllergies: (patientId: number) =>
    fetchJson<{ success: boolean; allergies: PatientAllergy[]; disclaimer: string }>(
      `${API_BASE}/patients/${patientId}/allergies`,
    ),

  recordPatientAllergy: (
    patientId: number,
    allergy: Partial<PatientAllergy> & { allergen: string; allergenType: string },
  ) =>
    fetchJson<{ success: boolean; allergy: PatientAllergy }>(
      `${API_BASE}/patients/${patientId}/allergies`,
      {
        method: 'POST',
        body: JSON.stringify(allergy),
      },
    ),

  setPatientAllergyStatus: (patientId: number, allergyId: number, status: string) =>
    fetchJson<{ success: boolean; allergy: PatientAllergy }>(
      `${API_BASE}/patients/${patientId}/allergies/${allergyId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    ),

  checkMedicationAllergies: (patientId: number, medications: string[]) =>
    fetchJson<AllergyCheckResult>(`${API_BASE}/patients/${patientId}/allergies/check`, {
      method: 'POST',
      body: JSON.stringify({ medications }),
    }),

  getEncounters: (patientId?: number, facilityId?: number) => {
    const params = new URLSearchParams();

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    const query = params.toString();

    return fetchJson<Encounter[]>(`${API_BASE}/encounters${query ? `?${query}` : ''}`);
  },

  createEncounter: (encounter: Partial<Encounter> & { idempotencyKey?: string }) =>
    fetchJson<Encounter & { billing?: ServiceCharge | null; idempotentReplay?: boolean }>(
      `${API_BASE}/encounters`,
      {
        method: 'POST',
        body: JSON.stringify(encounter),
      },
    ),

  selectEncounterConsultation: (id: number, facilityServiceId: number, reviewReason: string) =>
    fetchJson<Encounter & { billing?: ServiceCharge | null }>(
      `${API_BASE}/encounters/${id}/consultation-selection`,
      {
        method: 'POST',
        body: JSON.stringify({ facilityServiceId, reviewReason }),
      },
    ),
  updateEncounter: (id: number, encounter: Partial<Encounter>) =>
    fetchJson<Encounter>(`${API_BASE}/encounters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(encounter),
    }),

  getQueues: (facilityId?: number, queueType?: string, activeOnly = false) => {
    const params = new URLSearchParams();

    if (facilityId) {
      params.append('facilityId', facilityId.toString());
    }

    if (queueType) {
      params.append('queueType', queueType);
    }

    if (activeOnly) params.append('active', 'true');

    const query = params.toString();

    return fetchJson<QueueItem[]>(`${API_BASE}/queues${query ? `?${query}` : ''}`);
  },

  createQueueItem: (queue: Partial<QueueItem>) =>
    fetchJson<QueueItem>(`${API_BASE}/queues`, {
      method: 'POST',
      body: JSON.stringify(queue),
    }),

  updateQueueStatus: (id: number, status: string) =>
    fetchJson<QueueItem>(`${API_BASE}/queues/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
      }),
    }),

  getAppointments: (
    facilityId?: number,
    options?: {
      from?: string;
      to?: string;
      active?: boolean;
      status?: string;
      categoryId?: number;
      patientId?: number;
      practitionerId?: number;
      limit?: number;
      offset?: number;
    },
  ) => {
    const params = new URLSearchParams();
    if (facilityId) params.set('facilityId', String(facilityId));
    for (const [key, value] of Object.entries(options ?? {}))
      if (value !== undefined) params.set(key, String(value));
    return fetchJson<Appointment[]>(`${API_BASE}/appointments${params.size ? `?${params}` : ''}`);
  },

  getAppointmentResources: (facilityId: number) =>
    fetchJson<{
      departments: Array<{ id: number; name: string }>;
      practitioners: Array<{ id: number; name: string; departmentId: number | null }>;
    }>(`${API_BASE}/appointments/resources?facilityId=${facilityId}`),

  getAppointmentCategories: (facilityId: number) =>
    fetchJson<AppointmentCategory[]>(
      `${API_BASE}/appointments/categories?facilityId=${facilityId}`,
    ),

  createAppointmentCategory: (input: {
    facilityId: number;
    code: string;
    name: string;
    facilityServiceId?: number | null;
  }) =>
    fetchJson<AppointmentCategory>(`${API_BASE}/appointments/categories`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAppointmentCategory: (
    id: number,
    input: {
      facilityId: number;
      name?: string;
      facilityServiceId?: number | null;
      isActive?: boolean;
    },
  ) =>
    fetchJson<AppointmentCategory>(`${API_BASE}/appointments/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  getAppointmentHistory: (facilityId: number, id: number) =>
    fetchJson<AppointmentEvent[]>(
      `${API_BASE}/appointments/${id}/history?facilityId=${facilityId}`,
    ),

  createAppointment: (appointment: Partial<Appointment>, key?: string) =>
    fetchJson<Appointment>(`${API_BASE}/appointments`, {
      method: 'POST',
      ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
      body: JSON.stringify(appointment),
    }),

  cancelAppointment: (id: number, facilityId: number, reason: string) =>
    fetchJson<Appointment>(`${API_BASE}/appointments/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, reason }),
    }),

  rescheduleAppointment: (
    id: number,
    facilityId: number,
    scheduledTime: string,
    reason: string,
    key: string,
  ) =>
    fetchJson<Appointment>(`${API_BASE}/appointments/${id}/reschedule`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ facilityId, scheduledTime, reason }),
    }),

  checkInAppointment: (id: number, facilityId: number, queueType: string) =>
    fetchJson<{ appointment: Appointment; queue: QueueItem }>(
      `${API_BASE}/appointments/${id}/check-in`,
      { method: 'POST', body: JSON.stringify({ facilityId, queueType }) },
    ),

  getObservations: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (encounterId) {
      params.append('encounterId', encounterId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<Observation[]>(`${API_BASE}/observations${query ? `?${query}` : ''}`);
  },

  recordObservation: (obs: Partial<Observation>) =>
    fetchJson<Observation>(`${API_BASE}/observations`, {
      method: 'POST',
      body: JSON.stringify(obs),
    }),

  searchIcd11: (query: string) =>
    fetchJson<{
      success: boolean;
      items: Array<{ code: string; title: string; releaseId: string }>;
      source: 'WHO_LIVE_API' | 'CACHE';
      releaseId: string;
      completeCatalogue: false;
      warning: string | null;
    }>(`${API_BASE}/icd11/search?${new URLSearchParams({ q: query }).toString()}`),

  getDiagnoses: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (encounterId) {
      params.append('encounterId', encounterId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<Diagnosis[]>(`${API_BASE}/diagnoses${query ? `?${query}` : ''}`);
  },

  recordDiagnosis: (diag: Partial<Diagnosis>) =>
    fetchJson<Diagnosis>(`${API_BASE}/diagnoses`, {
      method: 'POST',
      body: JSON.stringify(diag),
    }),

  getProcedures: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (encounterId) {
      params.append('encounterId', encounterId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<Procedure[]>(`${API_BASE}/procedures${query ? `?${query}` : ''}`);
  },

  recordProcedure: (proc: Partial<Procedure>) =>
    fetchJson<Procedure>(`${API_BASE}/procedures`, {
      method: 'POST',
      body: JSON.stringify(proc),
    }),

  getMedications: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();

    if (encounterId) {
      params.append('encounterId', encounterId.toString());
    }

    if (patientId) {
      params.append('patientId', patientId.toString());
    }

    const query = params.toString();

    return fetchJson<Medication[]>(`${API_BASE}/medications${query ? `?${query}` : ''}`);
  },

  prescribeMedication: (med: Partial<Medication> & { allergyAcknowledged?: boolean }) =>
    fetchJson<Medication>(`${API_BASE}/medications`, {
      method: 'POST',
      body: JSON.stringify(med),
    }),

  updateMedicationStatus: (id: number, status: string, reason?: string) =>
    fetchJson<Medication>(`${API_BASE}/medications/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        reason,
      }),
    }),
};
