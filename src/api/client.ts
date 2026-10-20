import {
  Tenant,
  Facility,
  Department,
  Patient,
  Encounter,
  QueueItem,
  Appointment,
  Observation,
  Diagnosis,
  Procedure,
  Medication,
  Ward,
  Bed,
  Admission,
  InpatientBoard,
  VitalObservation,
  ShiftHandover,
  TheatreCase,
  LabTest,
  LabOrder,
  LabResult,
  RadiologyOrder,
  InventoryItem,
  Supplier,
  PurchaseOrder,
  BillingInvoice,
  BillingItem,
  ServiceTariff,
  BillingPayment,
  InsuranceClaim,
  PublicHealthReport,
  AuditLog,
  AnalyticsSummary,
} from '../types/index.ts';

const API_BASE = '/api';



export interface AuthenticatedUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  tenantId: number | null;
  facilityId: number | null;
  designation?: string | null;
  roles?: string[];
  permissions?: string[];
  isSuperAdmin?: boolean;
  accountStatus: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
}

/**
 * Session storage
 *
 * The raw session token is stored on the client so it can be
 * sent as a Bearer token with authenticated API requests.
 *
 * The server stores only the SHA-256 hash of this token.
 */
const SESSION_TOKEN_KEY = 'jalicare_session_token';

/**
 * Get the current authentication session token.
 */
export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

/**
 * Store the authentication session token.
 */
export function setSessionToken(token: string): void {
  if (!token) {
    throw new Error('Cannot store an empty session token.');
  }

  localStorage.setItem(
    SESSION_TOKEN_KEY,
    token
  );
}

/**
 * Remove the authentication session token.
 */
export function clearSessionToken(): void {
  localStorage.removeItem(
    SESSION_TOKEN_KEY
  );
}

/**
 * Check whether a session token exists locally.
 *
 * This does NOT prove that the session is valid.
 * The server must validate the token.
 */
export function hasSessionToken(): boolean {
  return Boolean(
    getSessionToken()
  );
}

/**
 * Common API error structure.
 */
interface ApiErrorResponse {
  success?: boolean;
  error?: string;
  message?: string;
}

/**
 * Generic authenticated API request helper.
 *
 * Every request automatically receives:
 *
 * Authorization: Bearer <session-token>
 *
 * when a session token exists.
 */
async function fetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const sessionToken =
    getSessionToken();

  const headers =
    new Headers(
      options?.headers
    );

  /**
   * JSON is the default content type.
   *
   * Do not overwrite an explicitly supplied
   * Content-Type header.
   */
  if (!headers.has('Content-Type')) {
    headers.set(
      'Content-Type',
      'application/json'
    );
  }

  /**
   * Automatically attach the PostgreSQL
   * session token.
   */
  if (
    sessionToken &&
    !headers.has('Authorization')
  ) {
    headers.set(
      'Authorization',
      `Bearer ${sessionToken}`
    );
  }

  const res =
    await fetch(url, {
      ...options,
      headers,
    });

  if (!res.ok) {
    const errorData: ApiErrorResponse =
      await res
        .json()
        .catch(() => ({
          error:
            res.statusText ||
            'Request failed',
        }));

    /**
     * If the backend says the session is
     * invalid/expired/revoked, clear the
     * locally stored token.
     */
    if (
      res.status === 401 &&
      !url.endsWith('/auth/login')
    ) {
      clearSessionToken();
    }

    throw new Error(
      errorData.message ||
      errorData.error ||
      `HTTP error ${res.status}`
    );
  }

  /**
   * Some endpoints may eventually return
   * 204 No Content.
   */
  if (
    res.status === 204
  ) {
    return undefined as T;
  }

  return res.json();
}

/**
 * Authentication response.
 */
export interface LoginResponse {
  success: boolean;
  message?: string;
  error?: string;

  user?: {
    id: number;
    uid: string;
    username: string;
    email: string;
    fullName: string;
    tenantId: number | null;
    facilityId: number | null;
    accountStatus: string;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    mfaRequired: boolean;
  };

  sessionToken?: string;
  expiresAt?: string;

  requiresMfa?: boolean;
  requiresPasswordChange?: boolean;
}

/**
 * Session response.
 */
export interface SessionResponse {
  success: boolean;

  user: {
    id: number;
    uid: string;
    username: string;
    email: string;
    fullName: string;
    tenantId: number | null;
    facilityId: number | null;
    designation?: string | null;
    roles?: string[];
    permissions?: string[];
    isSuperAdmin?: boolean;
    accountStatus: string;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    mfaRequired: boolean;
  };

  session: {
    id: number;
    expiresAt: string;
    lastActivityAt: string;
  };
}

export interface RbacPermission {
  id: number;
  code: string;
  name: string;
  module: string;
  description: string | null;
  assignable: boolean;
}

export interface RbacRole {
  id: number;
  tenantId: number | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionIds: number[];
  permissionCodes: string[];
  hasFacilityOverride: boolean;
  canEdit: boolean;
}

export interface RbacRolesResponse {
  roles: RbacRole[];
  permissions: RbacPermission[];
}
/**
 * Main API client.
 */
export const api = {
  // ============================================================
  // ROLE-BASED ACCESS CONTROL
  // ============================================================

  getRbacRoles: async (facilityId: number): Promise<RbacRolesResponse> => {
    const response = await fetchJson<{
      success: boolean;
      data?: RbacRolesResponse;
      message?: string;
      error?: string;
    }>(
      `${API_BASE}/platform/rbac/roles?facilityId=${encodeURIComponent(String(facilityId))}`,
    );

    if (
      !response.success ||
      !response.data ||
      !Array.isArray(response.data.roles) ||
      !Array.isArray(response.data.permissions)
    ) {
      throw new Error(
        response.message ||
        response.error ||
        "Invalid RBAC roles response from server."
      );
    }

    return response.data;
  },

  updateRbacRolePermissions: (
    roleId: number,
    facilityId: number,
    permissionIds: number[],
  ): Promise<{ success: boolean; message?: string }> =>
    fetchJson<{ success: boolean; message?: string }>(
      `${API_BASE}/platform/rbac/roles/${roleId}/permissions`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, permissionIds }),
      }
    ),

  // ============================================================
  // AUTHENTICATION
  // ============================================================

  /**
   * Login using username OR email and password.
   *
   * The backend creates the PostgreSQL session.
   * The raw session token is then stored locally.
   */
  login: async (
    identifier: string,
    password: string
  ): Promise<LoginResponse> => {
    /**
     * Do not use fetchJson here if an old/expired
     * token happens to exist in localStorage.
     *
     * Login itself should be independent of
     * the previous session.
     */
    const response =
      await fetch(
        `${API_BASE}/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            identifier,
            password,
          }),
        }
      );

    const result: LoginResponse =
      await response
        .json()
        .catch(() => ({
          success: false,
          error:
            'INVALID_SERVER_RESPONSE',
          message:
            'The server returned an invalid response.',
        }));

    if (!response.ok) {
      throw new Error(
        result.message ||
        result.error ||
        `HTTP error ${response.status}`
      );
    }

    /**
     * MFA is intentionally NOT treated as
     * a completed session.
     *
     * The backend currently returns requiresMfa
     * without a session token.
     */
    if (
      result.success &&
      result.sessionToken
    ) {
      setSessionToken(
        result.sessionToken
      );
    }

    return result;
  },

  /**
   * Validate the current server-side session.
   */
  getSession:
    (): Promise<SessionResponse> =>
      fetchJson<SessionResponse>(
        `${API_BASE}/auth/session`
      ),

  /**
   * Logout the current session.
   *
   * The server revokes the session and the
   * local token is removed regardless of whether
   * the server request succeeds.
   */
  logout: async () => {
    try {
      return await fetchJson<{
        success: boolean;
        message: string;
      }>(
        `${API_BASE}/auth/logout`,
        {
          method: 'POST',
        }
      );
    } finally {
      clearSessionToken();
    }
  },

  /**
   * Clear the local session without contacting
   * the server.
   *
   * Useful when the session is already expired.
   */
  clearLocalSession: () => {
    clearSessionToken();
  },

  // ============================================================
  // HEALTH & SYSTEM
  // ============================================================

  getHealth:
    () =>
      fetchJson<{
        status: string;
        system: string;
        dhaReadiness: string;
        timestamp: string;
      }>(
        `${API_BASE}/health`
      ),

  seedData:
    () =>
      fetchJson<{
        success: boolean;
        message: string;
      }>(
        `${API_BASE}/seed`,
        {
          method: 'POST',
        }
      ),

  // ============================================================
  // TENANTS & FACILITIES
  // ============================================================

  getTenants:
    () =>
      fetchJson<Tenant[]>(
        `${API_BASE}/tenants`
      ),

  getTenant:
    (id: number) =>
      fetchJson<Tenant>(
        `${API_BASE}/tenants/${id}`
      ),

  getFacilities:
    (tenantId?: number) =>
      fetchJson<Facility[]>(
        `${API_BASE}/facilities${
          tenantId
            ? `?tenantId=${tenantId}`
            : ''
        }`
      ),

  getDepartments:
    (facilityId?: number) =>
      fetchJson<Department[]>(
        `${API_BASE}/departments${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  // ============================================================
  // PATIENTS
  // ============================================================

  getPatients:
    (
      tenantId?: number,
      facilityId?: number,
      search?: string
    ) => {
      const params =
        new URLSearchParams();

      if (tenantId) {
        params.append(
          'tenantId',
          tenantId.toString()
        );
      }

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      if (search) {
        params.append(
          'search',
          search
        );
      }

      const query =
        params.toString();

      return fetchJson<Patient[]>(
        `${API_BASE}/patients${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  getPatient:
    (id: number) =>
      fetchJson<Patient>(
        `${API_BASE}/patients/${id}`
      ),

  createPatient:
    (patient: Partial<Patient> & { registrationFacilityId: number }) =>
      fetchJson<Patient>(
        `${API_BASE}/patients`,
        {
          method: 'POST',
          body: JSON.stringify(
            patient
          ),
        }
      ),

  updatePatient:
    (
      id: number,
      patient: Partial<Patient>
    ) =>
      fetchJson<Patient>(
        `${API_BASE}/patients/${id}`,
        {
          method: 'PUT',
          body: JSON.stringify(
            patient
          ),
        }
      ),

  // ============================================================
  // ENCOUNTERS
  // ============================================================

  getEncounters:
    (
      patientId?: number,
      facilityId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<Encounter[]>(
        `${API_BASE}/encounters${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  createEncounter:
    (encounter: Partial<Encounter>) =>
      fetchJson<Encounter>(
        `${API_BASE}/encounters`,
        {
          method: 'POST',
          body: JSON.stringify(
            encounter
          ),
        }
      ),

  updateEncounter:
    (
      id: number,
      encounter: Partial<Encounter>
    ) =>
      fetchJson<Encounter>(
        `${API_BASE}/encounters/${id}`,
        {
          method: 'PUT',
          body: JSON.stringify(
            encounter
          ),
        }
      ),

  // ============================================================
  // QUEUES
  // ============================================================

  getQueues:
    (
      facilityId?: number,
      queueType?: string
    ) => {
      const params =
        new URLSearchParams();

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      if (queueType) {
        params.append(
          'queueType',
          queueType
        );
      }

      const query =
        params.toString();

      return fetchJson<QueueItem[]>(
        `${API_BASE}/queues${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  createQueueItem:
    (queue: Partial<QueueItem>) =>
      fetchJson<QueueItem>(
        `${API_BASE}/queues`,
        {
          method: 'POST',
          body: JSON.stringify(
            queue
          ),
        }
      ),

  updateQueueStatus:
    (
      id: number,
      status: string
    ) =>
      fetchJson<QueueItem>(
        `${API_BASE}/queues/${id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status,
          }),
        }
      ),

  // ============================================================
  // APPOINTMENTS
  // ============================================================

  getAppointments:
    (facilityId?: number) =>
      fetchJson<Appointment[]>(
        `${API_BASE}/appointments${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  createAppointment:
    (
      appointment: Partial<Appointment>
    ) =>
      fetchJson<Appointment>(
        `${API_BASE}/appointments`,
        {
          method: 'POST',
          body: JSON.stringify(
            appointment
          ),
        }
      ),

  // ============================================================
  // VITALS & OBSERVATIONS
  // ============================================================

  getObservations:
    (
      encounterId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (encounterId) {
        params.append(
          'encounterId',
          encounterId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<Observation[]>(
        `${API_BASE}/observations${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  recordObservation:
    (obs: Partial<Observation>) =>
      fetchJson<Observation>(
        `${API_BASE}/observations`,
        {
          method: 'POST',
          body: JSON.stringify(
            obs
          ),
        }
      ),

  // ============================================================
  // DIAGNOSES
  // ============================================================

  getDiagnoses:
    (
      encounterId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (encounterId) {
        params.append(
          'encounterId',
          encounterId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<Diagnosis[]>(
        `${API_BASE}/diagnoses${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  recordDiagnosis:
    (diag: Partial<Diagnosis>) =>
      fetchJson<Diagnosis>(
        `${API_BASE}/diagnoses`,
        {
          method: 'POST',
          body: JSON.stringify(
            diag
          ),
        }
      ),

  // ============================================================
  // PROCEDURES
  // ============================================================

  getProcedures:
    (
      encounterId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (encounterId) {
        params.append(
          'encounterId',
          encounterId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<Procedure[]>(
        `${API_BASE}/procedures${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  recordProcedure:
    (proc: Partial<Procedure>) =>
      fetchJson<Procedure>(
        `${API_BASE}/procedures`,
        {
          method: 'POST',
          body: JSON.stringify(
            proc
          ),
        }
      ),

  // ============================================================
  // MEDICATIONS
  // ============================================================

  getMedications:
    (
      encounterId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (encounterId) {
        params.append(
          'encounterId',
          encounterId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<Medication[]>(
        `${API_BASE}/medications${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  prescribeMedication:
    (med: Partial<Medication>) =>
      fetchJson<Medication>(
        `${API_BASE}/medications`,
        {
          method: 'POST',
          body: JSON.stringify(
            med
          ),
        }
      ),

  updateMedicationStatus:
    (
      id: number,
      status: string
    ) =>
      fetchJson<Medication>(
        `${API_BASE}/medications/${id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status,
          }),
        }
      ),

  // ============================================================
  // INPATIENT WARDS, BEDS & ADMISSIONS
  // ============================================================

  getWards:
    (facilityId?: number) =>
      fetchJson<Ward[]>(
        `${API_BASE}/wards${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  getBeds:
    (wardId?: number) =>
      fetchJson<Bed[]>(
        `${API_BASE}/beds${
          wardId
            ? `?wardId=${wardId}`
            : ''
        }`
      ),

  updateBedStatus:
    (
      id: number,
      status: string
    ) =>
      fetchJson<Bed>(
        `${API_BASE}/beds/${id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status,
          }),
        }
      ),

  /**
   * Return a bed to service after terminal cleaning
   * (Cleaning -> Available).
   */
  releaseBed:
    (id: number) =>
      fetchJson<Bed>(
        `${API_BASE}/beds/${id}/release`,
        {
          method: 'PUT',
        }
      ),

  getAdmissions:
    (
      facilityId?: number,
      status?: string
    ) => {
      const params =
        new URLSearchParams();

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      if (status) {
        params.append(
          'status',
          status
        );
      }

      const query =
        params.toString();

      return fetchJson<Admission[]>(
        `${API_BASE}/admissions${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  createAdmission:
    (adm: Partial<Admission>) =>
      fetchJson<Admission>(
        `${API_BASE}/admissions`,
        {
          method: 'POST',
          body: JSON.stringify(
            adm
          ),
        }
      ),

  dischargePatient:
    (
      id: number,
      data: {
        dischargeDate: string;
        dischargeType: string;
        dischargeSummary: string;
      }
    ) =>
      fetchJson<Admission>(
        `${API_BASE}/admissions/${id}/discharge`,
        {
          method: 'POST',
          body: JSON.stringify(
            data
          ),
        }
      ),

  /**
   * Transfer an admitted patient to another ward/bed.
   * Bed-day charges for the departing ward segment are accrued
   * server-side and returned in `billing`.
   */
  transferAdmission:
    (
      id: number,
      data: { toWardId: number; toBedId: number; reason?: string; transferredBy?: string }
    ) =>
      fetchJson<any>(
        `${API_BASE}/admissions/${id}/transfer`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),

  getAdmissionTransfers:
    (id: number) =>
      fetchJson<any[]>(
        `${API_BASE}/admissions/${id}/transfers`
      ),

  /**
   * Accrue bed-day charges up to a date. Idempotent: each night is
   * billed once regardless of how often this is called.
   */
  accrueBedDays:
    (id: number, untilDate?: string) =>
      fetchJson<any>(
        `${API_BASE}/admissions/${id}/accrue-bed-days`,
        {
          method: 'POST',
          body: JSON.stringify({ untilDate }),
        }
      ),

  // ============================================================
  // NURSING & BEDSIDE CARE
  // ============================================================

  /**
   * Ward board: occupancy, per-admission vitals status and note counts.
   */
  getInpatientBoard:
    (facilityId?: number) =>
      fetchJson<InpatientBoard>(
        `${API_BASE}/inpatient/board${
          facilityId ? `?facilityId=${facilityId}` : ''
        }`
      ),

  getAdmissionVitals:
    (admissionId: number, limit = 20) =>
      fetchJson<VitalObservation[]>(
        `${API_BASE}/admissions/${admissionId}/vitals?limit=${limit}`
      ),

  recordWardVitals:
    (
      admissionId: number,
      vitals: Partial<Omit<VitalObservation, 'id' | 'recordedAt' | 'encounterId' | 'patientId' | 'flags'>> & {
        recordedBy?: string;
      }
    ) =>
      fetchJson<VitalObservation>(
        `${API_BASE}/admissions/${admissionId}/vitals`,
        {
          method: 'POST',
          body: JSON.stringify(vitals),
        }
      ),

  getShiftHandover:
    (date?: string, shift?: string) => {
      const params = new URLSearchParams();

      if (date) params.append('date', date);
      if (shift) params.append('shift', shift);

      const query = params.toString();

      return fetchJson<ShiftHandover>(
        `${API_BASE}/nursing-notes/handover${query ? `?${query}` : ''}`
      );
    },

  // ============================================================
  // NURSING NOTES
  // ============================================================

  getNursingNotes:
    (filters: { admissionId?: number; patientId?: number }) => {
      const params = new URLSearchParams();

      if (filters.admissionId) {
        params.append('admissionId', String(filters.admissionId));
      }

      if (filters.patientId) {
        params.append('patientId', String(filters.patientId));
      }

      const query = params.toString();

      return fetchJson<any[]>(
        `${API_BASE}/nursing-notes${query ? `?${query}` : ''}`
      );
    },

  createNursingNote:
    (data: {
      admissionId?: number;
      patientId: number;
      encounterId?: number;
      noteType?: string;
      shift?: string;
      note: string;
      recordedBy?: string;
    }) =>
      fetchJson<any>(
        `${API_BASE}/nursing-notes`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),

  // ============================================================
  // INVOICE LIFECYCLE & REVENUE
  // ============================================================

  getInvoiceDetail:
    (id: number) =>
      fetchJson<{
        invoice: BillingInvoice;
        items: BillingItem[];
        payments: BillingPayment[];
      }>(
        `${API_BASE}/invoices/${id}`
      ),

  voidInvoice:
    (id: number, reason: string) =>
      fetchJson<BillingInvoice>(
        `${API_BASE}/invoices/${id}/void`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }
      ),

  getRevenueReport:
    (facilityId?: number) =>
      fetchJson<{
        facilityId: number;
        totalRevenue: string;
        byService: Array<{
          itemType: string;
          sourceType: string | null;
          lineCount: number;
          revenue: string;
        }>;
      }>(
        `${API_BASE}/analytics/revenue${
          facilityId ? `?facilityId=${facilityId}` : ''
        }`
      ),

  // ============================================================
  // THEATRE CASES
  // ============================================================

  getTheatreCases:
    (facilityId?: number) =>
      fetchJson<TheatreCase[]>(
        `${API_BASE}/theatre-cases${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  createTheatreCase:
    (tc: Partial<TheatreCase>) =>
      fetchJson<TheatreCase>(
        `${API_BASE}/theatre-cases`,
        {
          method: 'POST',
          body: JSON.stringify(
            tc
          ),
        }
      ),

  updateTheatreCase:
    (
      id: number,
      tc: Partial<TheatreCase>
    ) =>
      fetchJson<TheatreCase>(
        `${API_BASE}/theatre-cases/${id}`,
        {
          method: 'PUT',
          body: JSON.stringify(
            tc
          ),
        }
      ),

  // ============================================================
  // LABORATORY
  // ============================================================

  getLabTests:
    (facilityId?: number) =>
      fetchJson<LabTest[]>(
        `${API_BASE}/lab-tests${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  getLabOrders:
    (
      facilityId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<LabOrder[]>(
        `${API_BASE}/lab-orders${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  createLabOrderBatch:
    (data: {
      encounterId: number;
      patientId: number;
      testIds?: number[];
      investigations?: string[];
      clinicalIndication: string;
      specimenType: string;
      priority: string;
      clinicalNotes?: string;
      orderedBy?: string;
    }) =>
      fetchJson<{ orders: LabOrder[]; queue: QueueItem }>(
        `${API_BASE}/lab-orders/batch`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),
  createLabOrder:
    (order: Partial<LabOrder>) =>
      fetchJson<LabOrder>(
        `${API_BASE}/lab-orders`,
        {
          method: 'POST',
          body: JSON.stringify(
            order
          ),
        }
      ),

  updateLabOrderStatus:
    (
      id: number,
      status: string,
      accessionNumber?: string
    ) =>
      fetchJson<LabOrder>(
        `${API_BASE}/lab-orders/${id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status,
            accessionNumber,
          }),
        }
      ),

  getLabResults:
    (
      orderId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (orderId) {
        params.append(
          'orderId',
          orderId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<LabResult[]>(
        `${API_BASE}/lab-results${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  addLabResult:
    (res: Partial<LabResult>) =>
      fetchJson<LabResult>(
        `${API_BASE}/lab-results`,
        {
          method: 'POST',
          body: JSON.stringify(
            res
          ),
        }
      ),

  // ============================================================
  verifyLabResult:
    (id: number) =>
      fetchJson<LabResult>(
        `${API_BASE}/lab-results/${id}/verify`,
        { method: 'POST' }
      ),
  // RADIOLOGY
  // ============================================================

  getRadiologyOrders:
    (
      facilityId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<RadiologyOrder[]>(
        `${API_BASE}/radiology-orders${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  createRadiologyOrder:
    (order: Partial<RadiologyOrder>) =>
      fetchJson<RadiologyOrder>(
        `${API_BASE}/radiology-orders`,
        {
          method: 'POST',
          body: JSON.stringify(
            order
          ),
        }
      ),

  updateRadiologyReport:
    (
      id: number,
      data: {
        findings: string;
        impression: string;
        reportedBy: string;
      }
    ) =>
      fetchJson<RadiologyOrder>(
        `${API_BASE}/radiology-orders/${id}/report`,
        {
          method: 'PUT',
          body: JSON.stringify(
            data
          ),
        }
      ),

  // ============================================================
  // PHARMACY & INVENTORY
  // ============================================================

  getInventory:
    (facilityId?: number) =>
      fetchJson<InventoryItem[]>(
        `${API_BASE}/inventory${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  createInventoryItem:
    (item: Partial<InventoryItem>) =>
      fetchJson<InventoryItem>(
        `${API_BASE}/inventory`,
        {
          method: 'POST',
          body: JSON.stringify(
            item
          ),
        }
      ),

  dispenseMedication:
    (data: {
      prescriptionId?: number;
      patientId: number;
      itemId?: number;
      quantityDispensed: number;
      batchNumber?: string;
      dispensedBy: string;
      notes?: string;
      /**
       * Scope is derived server-side from the session. facilityId is
       * only a hint for tenant-level users.
       */
      facilityId?: number;
      tenantId?: number;
      /** Passed to the billing engine for tariff matching / fallback. */
      drugName?: string;
      encounterId?: number;
      unitPrice?: string;
    }) =>
      fetchJson<{
        billing?: {
          charged: boolean;
          invoiceNumber?: string;
          totalAmount?: string;
          message?: string;
        };
      }>(
        `${API_BASE}/pharmacy/dispense`,
        {
          method: 'POST',
          body: JSON.stringify(
            data
          ),
        }
      ),

  // ============================================================
  // PROCUREMENT
  // ============================================================

  getSuppliers:
    (tenantId?: number) =>
      fetchJson<Supplier[]>(
        `${API_BASE}/suppliers${
          tenantId
            ? `?tenantId=${tenantId}`
            : ''
        }`
      ),

  getPurchaseOrders:
    (facilityId?: number) =>
      fetchJson<PurchaseOrder[]>(
        `${API_BASE}/purchase-orders${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  createPurchaseOrder:
    (po: Partial<PurchaseOrder>) =>
      fetchJson<PurchaseOrder>(
        `${API_BASE}/purchase-orders`,
        {
          method: 'POST',
          body: JSON.stringify(
            po
          ),
        }
      ),

  // ============================================================
  // FINANCE & BILLING
  // ============================================================

  getInvoices:
    (
      facilityId?: number,
      patientId?: number
    ) => {
      const params =
        new URLSearchParams();

      if (facilityId) {
        params.append(
          'facilityId',
          facilityId.toString()
        );
      }

      if (patientId) {
        params.append(
          'patientId',
          patientId.toString()
        );
      }

      const query =
        params.toString();

      return fetchJson<BillingInvoice[]>(
        `${API_BASE}/invoices${
          query
            ? `?${query}`
            : ''
        }`
      );
    },

  getInvoiceItems:
    (invoiceId: number) =>
      fetchJson<BillingItem[]>(
        `${API_BASE}/invoices/${invoiceId}/items`
      ),

  createInvoice:
    (
      invoice: Partial<BillingInvoice>,
      items: Partial<BillingItem>[]
    ) =>
      fetchJson<BillingInvoice>(
        `${API_BASE}/invoices`,
        {
          method: 'POST',
          body: JSON.stringify({
            invoice,
            items,
          }),
        }
      ),

  getServiceTariffs: (facilityId: number) =>
    fetchJson<ServiceTariff[]>(
      `${API_BASE}/service-tariffs?facilityId=${encodeURIComponent(String(facilityId))}`
    ),

  createServiceTariff: (
    input: Partial<ServiceTariff> & { facilityId: number }
  ) =>
    fetchJson<ServiceTariff>(
      `${API_BASE}/service-tariffs`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),

  updateServiceTariff: (
    id: number,
    input: Partial<ServiceTariff> & { facilityId: number }
  ) =>
    fetchJson<ServiceTariff>(
      `${API_BASE}/service-tariffs/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      }
    ),

  deactivateServiceTariff: (id: number, facilityId: number) =>
    fetchJson<ServiceTariff>(
      `${API_BASE}/service-tariffs/${id}/deactivate`,
      {
        method: 'PATCH',
        body: JSON.stringify({ facilityId }),
      }
    ),

  recordPayment:
    (payment: Partial<BillingPayment>) =>
      fetchJson<BillingPayment>(
        `${API_BASE}/billing/payments`,
        {
          method: 'POST',
          body: JSON.stringify(
            payment
          ),
        }
      ),

  // ============================================================
  // INSURANCE CLAIMS
  // ============================================================

  getClaims:
    (facilityId?: number) =>
      fetchJson<InsuranceClaim[]>(
        `${API_BASE}/claims${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  createClaim:
    (claim: Partial<InsuranceClaim>) =>
      fetchJson<InsuranceClaim>(
        `${API_BASE}/claims`,
        {
          method: 'POST',
          body: JSON.stringify(
            claim
          ),
        }
      ),

  updateClaimStatus:
    (
      id: number,
      status: string,
      approvedAmount?: string,
      notes?: string
    ) =>
      fetchJson<InsuranceClaim>(
        `${API_BASE}/claims/${id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status,
            approvedAmount,
            notes,
          }),
        }
      ),

  // ============================================================
  // PUBLIC HEALTH
  // ============================================================

  getPublicHealthReports:
    (facilityId?: number) =>
      fetchJson<PublicHealthReport[]>(
        `${API_BASE}/public-health/reports${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  recordPublicHealthReport:
    (rep: Partial<PublicHealthReport>) =>
      fetchJson<PublicHealthReport>(
        `${API_BASE}/public-health/reports`,
        {
          method: 'POST',
          body: JSON.stringify(
            rep
          ),
        }
      ),

  // ============================================================
  // ANALYTICS & INTEROPERABILITY
  // ============================================================

  getAnalyticsSummary:
    (facilityId?: number) =>
      fetchJson<AnalyticsSummary>(
        `${API_BASE}/analytics/summary${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  getFhirPatient:
    (id: number) =>
      fetchJson<any>(
        `${API_BASE}/interop/fhir/patient/${id}`
      ),

  getMoh705Summary:
    (facilityId?: number) =>
      fetchJson<any>(
        `${API_BASE}/interop/dha/moh-705${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),

  getAuditLogs:
    (facilityId?: number) =>
      fetchJson<AuditLog[]>(
        `${API_BASE}/audit-logs${
          facilityId
            ? `?facilityId=${facilityId}`
            : ''
        }`
      ),
};

