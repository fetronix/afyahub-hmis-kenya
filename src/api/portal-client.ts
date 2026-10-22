/**
 * JaliCare HMIS
 * Patient portal API client
 *
 * Deliberately separate from `src/api/client.ts`. The staff client
 * attaches the staff session token from `localStorage`; this one
 * attaches a patient token from a different key. Keeping them apart
 * means a bug in the portal cannot accidentally send a staff bearer
 * token to a patient endpoint — or the reverse.
 *
 * Only `POST /api/portal/auth/activate` and `/auth/login` are called
 * without a token; everything else requires one.
 */

const API_BASE = '/api/portal';

const PORTAL_TOKEN_KEY = 'jalicare_portal_token';
const PORTAL_EXPIRY_KEY = 'jalicare_portal_expiry';

export function getPortalToken(): string | null {
  return localStorage.getItem(PORTAL_TOKEN_KEY);
}

export function setPortalToken(token: string, expiresAt: string): void {
  localStorage.setItem(PORTAL_TOKEN_KEY, token);
  localStorage.setItem(PORTAL_EXPIRY_KEY, expiresAt);
}

export function clearPortalToken(): void {
  localStorage.removeItem(PORTAL_TOKEN_KEY);
  localStorage.removeItem(PORTAL_EXPIRY_KEY);
}

export function portalTokenExpired(): boolean {
  const expiry = localStorage.getItem(PORTAL_EXPIRY_KEY);

  if (!expiry) return false;

  const at = new Date(expiry).getTime();

  return Number.isFinite(at) && at <= Date.now();
}

export class PortalApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PortalApiError';
    this.status = status;
    this.code = code;
  }
}

async function portalFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getPortalToken();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    /*
     * `same-origin` credentials are enough: the portal authenticates
     * with a bearer token, not a cookie, so there is no CSRF surface.
     */
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({}) as Record<string, unknown>);

    if (response.status === 401) {
      clearPortalToken();
    }

    throw new PortalApiError(
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : `Request failed (${response.status})`,
      response.status,
      typeof body.error === 'string' ? body.error : undefined,
    );
  }

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/* ============================================================
   Types
   ============================================================ */

export interface PortalMe {
  account: {
    id: number;
    loginIdentifier: string;
    loginType: string;
    status: string;
    activatedAt: string | null;
    lastLoginAt: string | null;
    hasDigitalCard: boolean;
  } | null;
  patient: {
    id: number;
    mrn: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    dateOfBirth: string | null;
    gender: string | null;
    phone: string | null;
    county: string | null;
  } | null;
  facilityName: string | null;
}

export interface PortalOverview {
  visits: Array<{
    id: number;
    encounterType: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    followUpDate: string | null;
  }>;
  upcomingAppointments: Array<{
    id: number;
    scheduledTime: string;
    appointmentType: string | null;
    status: string | null;
    reason: string | null;
  }>;
  activeAllergies: Array<{
    id: number;
    allergen: string;
    allergenType: string;
    severity: string;
    reaction: string | null;
  }>;
  recentVerifiedResults: Array<{
    id: number;
    parameterName: string;
    measuredValue: string;
    unit: string | null;
    referenceRange: string | null;
    flag: string | null;
    verifiedAt: string | null;
  }>;
  recentMedications: Array<{
    id: number;
    drugName: string;
    dosage: string;
    frequency: string;
    duration: string;
    status: string | null;
    prescribedAt: string;
  }>;
  releasedSections: Record<string, boolean>;
}

export interface PortalVisit {
  id: number;
  encounterType: string;
  status: string;
  triageCategory: string | null;
  chiefComplaint: string | null;
  clinicalNotes: string | null;
  followUpDate: string | null;
  startedAt: string;
  endedAt: string | null;
  facilityName: string | null;
  diagnoses: Array<{
    icd10Code: string;
    icd10Description: string;
    diagnosisType: string | null;
    status: string | null;
    diagnosedBy: string | null;
    diagnosedAt: string;
  }>;
}

export interface PortalLabOrder {
  id: number;
  testName: string;
  status: string;
  priority: string | null;
  orderedAt: string;
  released: boolean;
  results: Array<{
    parameterName: string;
    measuredValue: string;
    unit: string | null;
    referenceRange: string | null;
    flag: string | null;
    verifiedAt: string | null;
  }>;
}

export interface PortalLabResponse {
  note: string;
  orders: PortalLabOrder[];
}

export interface PortalMedication {
  id: number;
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string | null;
  instructions: string | null;
  status: string | null;
  prescribedBy: string | null;
  prescribedAt: string;
}

export interface PortalAppointment {
  id: number;
  scheduledTime: string;
  durationMinutes: number | null;
  appointmentType: string | null;
  status: string | null;
  reason: string | null;
  facilityName: string | null;
}

export interface PortalSharingGrant {
  id: number;
  recipientName: string;
  purpose: string;
  categories: string[];
  expiresAt: string;
  revokedAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
  state: 'OPEN' | 'USED' | 'EXPIRED' | 'REVOKED';
}

export interface PortalAccessEvent {
  action: string;
  accessChannel: string | null;
  recordType: string | null;
  createdAt: string;
}

/* ============================================================
   Public calls
   ============================================================ */

export async function activatePortalAccount(input: {
  token: string;
  password: string;
  confirmPassword: string;
  dateOfBirth?: string;
}): Promise<{
  success: boolean;
  requiresStaffVerification: boolean;
  message: string;
  loginIdentifier?: string;
}> {
  return portalFetch('/auth/activate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function loginPortal(input: {
  identifier: string;
  password: string;
}): Promise<{
  success: boolean;
  sessionToken: string;
  expiresAt: string;
  firstName: string;
  lastName: string;
}> {
  const result = await portalFetch<{
    success: boolean;
    sessionToken: string;
    expiresAt: string;
    firstName: string;
    lastName: string;
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  setPortalToken(result.sessionToken, result.expiresAt);

  return result;
}

export async function logoutPortal(): Promise<void> {
  try {
    await portalFetch('/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    /* Signing out locally is the important part. */
  } finally {
    clearPortalToken();
  }
}

/* ============================================================
   Authenticated calls
   ============================================================ */

export const portalApi = {
  me: () => portalFetch<PortalMe>('/me'),

  overview: () => portalFetch<PortalOverview>('/overview'),

  visits: () => portalFetch<PortalVisit[]>('/visits'),

  laboratory: () => portalFetch<PortalLabResponse>('/laboratory'),

  medications: () => portalFetch<PortalMedication[]>('/medications'),

  appointments: () => portalFetch<PortalAppointment[]>('/appointments'),

  dischargeSummaries: () =>
    portalFetch<
      Array<{
        id: number;
        admissionDate: string | null;
        dischargeDate: string | null;
        dischargeType: string | null;
        dischargeSummary: string | null;
        dischargeDisposition: string | null;
        dischargedBy: string | null;
      }>
    >('/discharge-summaries'),

  sharing: () => portalFetch<PortalSharingGrant[]>('/sharing'),

  createSharing: (input: {
    recipientName: string;
    purpose: string;
    categories: string[];
    hours: number;
  }) =>
    portalFetch<{
      success: boolean;
      grantId: number;
      code: string;
      expiresAt: string;
      message: string;
    }>('/sharing', { method: 'POST', body: JSON.stringify(input) }),

  revokeSharing: (id: number) =>
    portalFetch<{ state: string }>(`/sharing/${id}/revoke`, {
      method: 'POST',
      body: '{}',
    }),

  accessHistory: () => portalFetch<PortalAccessEvent[]>('/access-history'),

  card: () => portalFetch<{ svg: string; issuedAt: string | null }>('/card'),

  issueCard: () =>
    portalFetch<{ success: boolean; svg: string; issuedAt: string; message: string }>(
      '/card',
      { method: 'POST', body: '{}' },
    ),

  requestCorrection: (input: { recordType: string; detail: string }) =>
    portalFetch<{ success: boolean; requestId: string; message: string }>(
      '/records/correction-request',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  changePassword: (input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) =>
    portalFetch<{ success: boolean; sessionsRevoked: number; message: string }>('/password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Download the record.
   *
   * Fetched with the bearer token and turned into a Blob, so the file is
   * produced only for a live session. A copied URL without that session
   * returns 401 — there is no public document path to leak.
   */
  downloadRecord: async (): Promise<Blob> => {
    const token = getPortalToken();

    const response = await fetch(`${API_BASE}/records/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));

      throw new PortalApiError(
        typeof body.message === 'string' ? body.message : 'The download failed.',
        response.status,
        typeof body.error === 'string' ? body.error : undefined,
      );
    }

    return response.blob();
  },
};

/* ============================================================
   Staff-side portal administration
   ============================================================ */

/**
 * These calls use the **staff** token and are kept here only so the
 * portal's own types live together. The endpoint they hit is
 * `/api/portal/admin`, which requires `requireAuth` and a permission —
 * a patient token is not accepted there.
 */
export const portalAdminApi = {
  patientStatus: (patientId: number) =>
    staffFetch<PatientPortalStatus>(`/api/portal/admin/patients/${patientId}/status`),

  invite: (
    patientId: number,
    input: { channel?: 'MANUAL' | 'SMS' | 'EMAIL'; contact?: string; purpose?: string },
  ) =>
    staffFetch<IssuedInvitation>(`/api/portal/admin/patients/${patientId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  reissueLink: (invitationId: number) =>
    staffFetch<{ success: boolean; activationLink: string; expiresAt: string; message: string }>(
      `/api/portal/admin/invitations/${invitationId}/link`,
      { method: 'POST', body: '{}' },
    ),

  markHandedOver: (invitationId: number) =>
    staffFetch<{ success: boolean; deliveryStatus: string; handedOverAt: string }>(
      `/api/portal/admin/invitations/${invitationId}/handed-over`,
      { method: 'POST', body: '{}' },
    ),

  revokeInvitation: (invitationId: number, reason: string) =>
    staffFetch<{ success: boolean; status: string }>(
      `/api/portal/admin/invitations/${invitationId}/revoke`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  overview: () => staffFetch<PortalAdminOverview>('/api/portal/admin/overview'),

  accounts: (params: { search?: string; status?: string; limit?: number }) => {
    const query = new URLSearchParams();

    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));

    const suffix = query.toString();

    return staffFetch<{ success: boolean; accounts: PortalAccountRow[] }>(
      `/api/portal/admin/accounts${suffix ? `?${suffix}` : ''}`,
    );
  },

  accountDetail: (accountId: number) =>
    staffFetch<PortalAccountDetail>(`/api/portal/admin/accounts/${accountId}`),

  suspend: (accountId: number, reason: string) =>
    staffFetch<{ success: boolean; status: string; sessionsRevoked: number }>(
      `/api/portal/admin/accounts/${accountId}/suspend`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  reactivate: (accountId: number, reason: string) =>
    staffFetch<{ success: boolean; status: string }>(
      `/api/portal/admin/accounts/${accountId}/reactivate`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  revoke: (accountId: number, reason: string) =>
    staffFetch<{ success: boolean; status: string; sessionsRevoked: number }>(
      `/api/portal/admin/accounts/${accountId}/revoke`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  forceReset: (accountId: number) =>
    staffFetch<{ success: boolean; sessionsRevoked: number }>(
      `/api/portal/admin/accounts/${accountId}/force-reset`,
      { method: 'POST', body: '{}' },
    ),

  audit: (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();

    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    const suffix = query.toString();

    return staffFetch<PortalAuditResponse>(
      `/api/portal/admin/audit${suffix ? `?${suffix}` : ''}`,
    );
  },

  risks: () =>
    staffFetch<{
      sharedIdentifiers: Array<{ masked: string | null; accounts: number }>;
      pendingVerification: Array<{ accountId: number; patientId: number; status: string }>;
      note: string;
    }>('/api/portal/admin/risks'),

  getSettings: () =>
    staffFetch<{ facilityId: number; policy: PortalPolicy }>(
      '/api/portal/admin/settings',
    ),

  saveSettings: (policy: Partial<PortalPolicy>) =>
    staffFetch<{ success: boolean; policy: PortalPolicy }>('/api/portal/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(policy),
    }),

  lookupCard: (code: string) =>
    staffFetch<{
      patientId: number;
      mrn: string;
      firstName: string;
      middleName: string | null;
      lastName: string;
      dateOfBirth: string | null;
      gender: string | null;
      portalAccountStatus: string;
      note: string;
    }>('/api/portal/admin/card/lookup', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

/* ============================================================
   Shared staff fetch
   ============================================================ */

async function staffFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = localStorage.getItem('jalicare_session_token');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));

    throw new PortalApiError(
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : `Request failed (${response.status})`,
      response.status,
      typeof body.error === 'string' ? body.error : undefined,
    );
  }

  return (await response.json()) as T;
}

/* ============================================================
   Staff-side types
   ============================================================ */

export interface PortalAuditResponse {
  success: boolean;
  rows: Array<{
    id: number;
    action: string;
    resource: string;
    resourceId: string | null;
    details: string | null;
    userId: string | null;
    ipAddress: string | null;
    timestamp: string;
  }>;
  invitationEvents: Array<{
    id: number;
    invitationId: number;
    eventType: string;
    detail: string | null;
    actorUserId: number | null;
    createdAt: string;
  }>;
  limit: number;
  offset: number;
  note: string;
}

export interface PortalPolicy {
  invitationExpiryHours: number;
  maxResends: number;
  allowManualDelivery: boolean;
  allowSms: boolean;
  allowEmail: boolean;
  showLabResults: boolean;
  showAppointments: boolean;
  showPrescriptions: boolean;
  showAllergies: boolean;
  showDischargeSummaries: boolean;
  allowDownloads: boolean;
}

export interface PatientPortalStatus {
  patientId: number;
  hasAccount: boolean;
  accountStatus: string | null;
  accountMaskedContact: string | null;
  latestInvitation: {
    id: number;
    status: string;
    deliveryStatus: string;
    deliveryChannel: string;
    purpose: string;
    contactHint: string | null;
    expiresAt: string;
    createdAt: string;
    sentAt: string | null;
    handedOverAt: string | null;
    deliveryAttempts: number;
    lastDeliveryError: string | null;
    canResend: boolean;
    resendBlockedReason: string | null;
  } | null;
  policy: PortalPolicy;
  notificationConfigured: { sms: boolean; email: boolean };
}

export interface IssuedInvitation {
  success: boolean;
  invitationId: number;
  status: string;
  deliveryStatus: string;
  deliveryChannel: string;
  expiresAt: string;
  activationLink?: string;
  deliveryMessage?: string;
  providerReference?: string;
}

export interface PortalAdminOverview {
  facilityId: number;
  eligiblePatients: number;
  invitedPatients: number;
  accountsTotal: number;
  activeAccounts: number;
  pendingVerificationAccounts: number;
  suspendedAccounts: number;
  revokedAccounts: number;
  invitations: {
    pending: number;
    activated: number;
    expired: number;
    revoked: number;
    superseded: number;
    failedDelivery: number;
    notConfigured: number;
  };
  recentEvents: Array<{
    id: number;
    eventType: string;
    detail: string | null;
    createdAt: string;
  }>;
  recentAccountEvents: Array<{
    id: number;
    action: string;
    resource: string;
    resourceId: string | null;
    details: string | null;
    timestamp: string;
  }>;
  policy: PortalPolicy;
  policyBounds: {
    minExpiryHours: number;
    maxExpiryHours: number;
    maxResends: number;
  };
  note: string;
}

export interface PortalAccountRow {
  accountId: number;
  status: string;
  maskedIdentifier: string | null;
  loginType: string;
  activatedAt: string | null;
  lastLoginAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  revokedAt: string | null;
  patientId: number;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  registrationFacilityId: number;
}

export interface PortalAccountDetail {
  account: {
    id: number;
    status: string;
    maskedIdentifier: string | null;
    loginType: string;
    activatedAt: string | null;
    lastLoginAt: string | null;
    suspendedAt: string | null;
    suspendedReason: string | null;
    revokedAt: string | null;
    revokedReason: string | null;
    hasDigitalCard: boolean;
  };
  patient: { id: number; mrn: string; firstName: string; lastName: string };
  invitations: Array<{
    id: number;
    status: string;
    deliveryStatus: string;
    deliveryChannel: string;
    purpose: string;
    createdAt: string;
    expiresAt: string;
    activatedAt: string | null;
    revokedAt: string | null;
    effectiveStatus: string;
  }>;
  events: Array<{ eventType: string; detail: string | null; createdAt: string }>;
  sessions: Array<{
    id: number;
    createdAt: string;
    lastActivityAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
}
