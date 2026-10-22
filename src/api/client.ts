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
  RevenueReport,
  OperationsReport,
  OccupancyTrendResponse,
  InventoryBatchRow,
  ExpirySummary,
  ReceiveBatchResult,
  DispenseAllocation,
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
  BillingChargeAttemptList,
  ServiceTariffLink,
  LabServiceDiagnostics,
  BillingChargeAttemptOutcome,
  BillingChargeRetrySummary,
  TariffMatchExplanation,
  RecordPaymentResult,
  PaymentLedgerRow,
  InsuranceClaim,
  DhaReadinessReport,
  DhaEligibilityResult,
  DhaCallLog,
  ClaimableLinesResponse,
  DraftClaimResult,
  ClaimSettlementResult,
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
  detail?: Record<string, unknown>;
}

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

/**
 * Error thrown for a non-2xx response.
 *
 * `code` carries the server's machine-readable error code (for example
 * PAYMENT_EXCEEDS_BALANCE) so callers can branch without parsing prose.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly detail?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
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

    throw new ApiError(
      errorData.message ||
        errorData.error ||
        `HTTP error ${res.status}`,
      res.status,
      errorData.error,
      errorData.detail,
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

/**
 * One entry from the server's staff role catalogue, with whether this
 * tenant has it yet. `exists: false` is the case the editor surfaces —
 * a role the application knows about but nobody can be granted.
 */
export interface RbacCatalogueRole {
  name: string;
  description: string;
  permissionCount: number;
  permissions: string[];
  exists: boolean;
  isActive: boolean | null;
  missingPermissionCodes: string[];
  unknownPermissionCodes: string[];
}

export interface RbacCatalogueCoverage {
  roleCount: number;
  roles: RbacCatalogueRole[];
  missingCount: number;
  driftCount: number;
}

export interface RbacRolesResponse {
  roles: RbacRole[];
  permissions: RbacPermission[];
  catalogue?: RbacCatalogueCoverage;
}

export interface RbacCatalogueApplyResult {
  createdRoles: string[];
  toppedUpRoles: Array<{ name: string; granted: number }>;
  skippedRoles: string[];
  addedPermissionLinks: number;
}
/**
 * Main API client.
 */
/* ============================================================
   MATERNITY / MCH
   ============================================================ */

export interface MaternityPatientRef {
  id: number;
  mrn: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
}

export interface GestationSummary {
  totalDays: number;
  weeks: number;
  days: number;
}

export interface MaternityPregnancy {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  bookedAt: string;
  lmpDate: string | null;
  eddDate: string;
  eddBasis: string;
  gravida: number | null;
  para: number | null;
  abortions: number | null;
  livingChildren: number | null;
  heightCm: string | null;
  bloodGroup: string | null;
  rhesus: string | null;
  haemoglobinGdl: string | null;
  riskFactors: string | null;
  status: string;
  closedAt: string | null;
  closedReason: string | null;
  createdAt: string;
  updatedAt: string;
  patient?: MaternityPatientRef;
  gestation?: GestationSummary | null;
  weeksToEdd?: number;
}

export interface AncVisit {
  id: number;
  pregnancyId: number;
  visitDate: string;
  visitNumber: number | null;
  gestationWeeks: number | null;
  gestationDays: number | null;
  weightKg: string | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulseBpm: number | null;
  temperatureC: string | null;
  fundalHeightCm: string | null;
  fetalHeartRateBpm: number | null;
  presentation: string | null;
  fetalMovements: string | null;
  urineProtein: string | null;
  urineGlucose: string | null;
  haemoglobinGdl: string | null;
  ttDose: number | null;
  ifasDispensed: boolean;
  dangerSigns: string | null;
  notes: string | null;
  nextVisitDate: string | null;
}

export interface PartographEntry {
  id: number;
  labourRecordId: number;
  recordedAt: string;
  cervicalDilatationCm: string | null;
  descentStation: number | null;
  contractionsPer10Min: number | null;
  contractionDurationSec: number | null;
  fetalHeartRateBpm: number | null;
  membranes: string | null;
  liquor: string | null;
  maternalPulseBpm: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  temperatureC: string | null;
  oxytocin: string | null;
  drugsGiven: string | null;
  notes: string | null;
}

export interface PartographGuidance {
  zone: string;
  hoursSinceFourCm: number | null;
  dilatationCm: number | null;
  hoursBeyondAlert: number | null;
  note: string;
}

export interface LabourRecord {
  id: number;
  pregnancyId: number;
  patientId: number;
  facilityId: number;
  admittedAt: string;
  labourOnsetAt: string | null;
  membranesRupturedAt: string | null;
  gestationWeeksAtAdmission: number | null;
  status: string;
  notes: string | null;
  patient?: MaternityPatientRef;
  pregnancy?: MaternityPregnancy;
  entries?: PartographEntry[];
  guidance?: PartographGuidance;
  plot?: PartographPlot;
}

export interface DeliveryBaby {
  id: number;
  deliveryId: number;
  babyNumber: number;
  sex: string | null;
  birthWeightGrams: number | null;
  apgar1: number | null;
  apgar5: number | null;
  apgar10: number | null;
  outcome: string;
  resuscitation: string | null;
  notes: string | null;
}

export interface DeliveryRecord {
  id: number;
  pregnancyId: number;
  patientId: number;
  facilityId: number;
  deliveredAt: string;
  deliveryMode: string;
  bloodLossMl: number | null;
  perineum: string | null;
  placentaComplete: boolean | null;
  placentaDeliveredAt: string | null;
  oxytocinGiven: boolean;
  complications: string | null;
  notes: string | null;
  conductedByCadre: string | null;
  patient?: MaternityPatientRef;
  babies?: DeliveryBaby[];
}

export interface MaternitySummary {
  facilityId: number;
  asOf: string;
  activePregnancies: number;
  ancVisitsThisMonth: number;
  inLabour: number;
  deliveriesThisMonth: number;
  babiesThisMonth: number;
}

export interface MaternityPregnancyDetail extends MaternityPregnancy {
  ancVisits: AncVisit[];
  labours: LabourRecord[];
  deliveries: Array<DeliveryRecord & { babies: DeliveryBaby[] }>;
}

/**
 * One point on the partograph, positioned by the server.
 *
 * `hoursSinceAdmission` is computed from the stored admission time, not
 * from the browser clock, so a chart opened three days later plots the
 * same shape it did on the night.
 */
export interface PlottedReading {
  recordedAt: string;
  hoursSinceAdmission: number;
  dilatationCm: number | null;
  fetalHeartRateBpm: number | null;
  contractionsPer10Min: number | null;
  contractionDurationSec: number | null;
}

export interface PartographLine {
  startHour: number;
  endHour: number;
  startCm: number;
  endCm: number;
}

export interface PartographPlot {
  readings: PlottedReading[];
  alertLine: PartographLine | null;
  actionLine: PartographLine | null;
  maxHour: number;
  zone: string;
  note: string;
}

export interface PostnatalVisit {
  id: number;
  pregnancyId: number;
  patientId: number;
  facilityId: number;
  deliveryId: number | null;
  visitDate: string;
  visitNumber: number | null;
  dayPostpartum: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulseBpm: number | null;
  temperatureC: string | null;
  fundalHeightCm: string | null;
  involution: string | null;
  lochia: string | null;
  perineum: string | null;
  breasts: string | null;
  breastfeeding: string | null;
  moodScreening: string | null;
  haemoglobinGdl: string | null;
  dangerSigns: string | null;
  notes: string | null;
  nextVisitDate: string | null;
  babyWeightGrams: number | null;
  babyNotes: string | null;
  patient?: MaternityPatientRef;
}

export interface ImmunisationRecord {
  id: number;
  patientId: number;
  facilityId: number;
  antigenCode: string;
  doseNumber: number;
  administeredOn: string;
  batchNumber: string | null;
  site: string | null;
  route: string | null;
  notes: string | null;
}

export interface ImmunisationAntigen {
  code: string;
  name: string;
  weeks: number;
  doses: number;
  route: string;
  note?: string;
}

export interface ImmunisationDoseStatus {
  antigenCode: string;
  name: string;
  scheduledWeeks: number;
  route: string;
  note?: string;
  givenOn: string | null;
  status: 'Given' | 'Due' | 'Overdue' | 'Not yet due';
}

export interface ImmunisationCard {
  patient: MaternityPatientRef & { dateOfBirth?: string | null };
  dateOfBirth: string | null;
  records: ImmunisationRecord[];
  statuses: ImmunisationDoseStatus[];
  outstanding: ImmunisationDoseStatus[];
  note: string;
}

export interface ImmunisationDueRow {
  id: number;
  mrn: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  outstandingCount: number;
  overdueCount: number;
  nextDue: {
    antigenCode: string;
    name: string;
    status: string;
    scheduledWeeks: number;
  } | null;
}

/**
 * What the billing engine answered for a clinical action.
 *
 * `charged: false` with `reason: 'TARIFF_NOT_CONFIGURED'` is a normal
 * outcome, not an error: the service happened and the facility has no
 * price for it yet. The screen must say that rather than show zero.
 */
export interface ServiceCharge {
  charged: boolean;
  reason?: string;
  invoiceId?: number;
  invoiceNumber?: string;
  itemId?: number;
  tariffCode?: string;
  description?: string;
  quantity?: number;
  /** The tariff's own unit: "Per visit", "Per day", "Test". */
  unit?: string | null;
  unitPrice?: string;
  totalAmount?: string;
  /** How the price was found, when one was. */
  matchRule?: "LINK" | "CODE" | "CATALOGUE";
  matchExplanation?: string;
  codesTried?: string[];
  message?: string;
}

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

  /**
   * Create the catalogue roles this tenant does not have yet.
   *
   * Additive only: it never removes a permission and never touches a
   * facility override. `topUpExisting` must be asked for explicitly.
   */
  applyRbacCatalogue: async (
    facilityId: number,
    options: { roleNames?: string[]; topUpExisting?: boolean } = {},
  ): Promise<RbacCatalogueApplyResult> => {
    const response = await fetchJson<{
      success: boolean;
      data?: RbacCatalogueApplyResult;
      message?: string;
      error?: string;
    }>(`${API_BASE}/platform/rbac/catalogue/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facilityId,
        roleNames: options.roleNames,
        topUpExisting: options.topUpExisting === true,
      }),
    });

    if (!response.success || !response.data) {
      throw new Error(
        response.message ||
        response.error ||
        'The catalogue roles could not be created.',
      );
    }

    return response.data;
  },

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

  /**
   * Facility module provisioning.
   *
   * The switch grid used to be local React state; these two calls are
   * what make it a setting the server enforces.
   */
  getFacilityModules:
    (facilityId: number) =>
      fetchJson<{
        success: boolean;
        facilityId: number;
        enabledModules: string[];
        alwaysEnabled: string[];
        canManage: boolean;
        catalogue: Array<{
          id: string;
          label: string;
          group: string;
          description: string;
          alwaysOn?: boolean;
        }>;
      }>(
        `${API_BASE}/facilities/${facilityId}/modules`
      ),

  updateFacilityModules:
    (facilityId: number, enabledModules: string[]) =>
      fetchJson<{
        success: boolean;
        facilityId: number;
        enabledModules: string[];
        added: string[];
        removed: string[];
        alwaysEnabled: string[];
        changed: boolean;
      }>(
        `${API_BASE}/facilities/${facilityId}/modules`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabledModules }),
        }
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
  // CONSENT (Data Protection Act 2019)
  // ============================================================

  getPatientConsents:
    (patientId: number) =>
      fetchJson<{ success: boolean; consents: PatientConsent[]; counts: Record<string, number> }>(
        `${API_BASE}/patients/${patientId}/consents`
      ),

  grantPatientConsent:
    (
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
        }
      ),

  revokePatientConsent:
    (patientId: number, consentId: number, reason?: string) =>
      fetchJson<{ success: boolean; consent: PatientConsent }>(
        `${API_BASE}/patients/${patientId}/consents/${consentId}/revoke`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }
      ),

  // ============================================================
  // ALLERGIES
  // ============================================================

  getPatientAllergies:
    (patientId: number) =>
      fetchJson<{ success: boolean; allergies: PatientAllergy[]; disclaimer: string }>(
        `${API_BASE}/patients/${patientId}/allergies`
      ),

  recordPatientAllergy:
    (patientId: number, allergy: Partial<PatientAllergy> & { allergen: string; allergenType: string }) =>
      fetchJson<{ success: boolean; allergy: PatientAllergy }>(
        `${API_BASE}/patients/${patientId}/allergies`,
        {
          method: 'POST',
          body: JSON.stringify(allergy),
        }
      ),

  setPatientAllergyStatus:
    (patientId: number, allergyId: number, status: string) =>
      fetchJson<{ success: boolean; allergy: PatientAllergy }>(
        `${API_BASE}/patients/${patientId}/allergies/${allergyId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }
      ),

  checkMedicationAllergies:
    (patientId: number, medications: string[]) =>
      fetchJson<AllergyCheckResult>(
        `${API_BASE}/patients/${patientId}/allergies/check`,
        {
          method: 'POST',
          body: JSON.stringify({ medications }),
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
      fetchJson<Encounter & { billing?: ServiceCharge | null }>(
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
    (med: Partial<Medication> & { allergyAcknowledged?: boolean }) =>
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
  // MATERNITY / MCH
  // ============================================================

  getMaternitySummary: (facilityId?: number) =>
    fetchJson<MaternitySummary>(
      `${API_BASE}/maternity/summary${
        facilityId ? `?facilityId=${facilityId}` : ''
      }`
    ),

  getPregnancies: (params: {
    facilityId?: number;
    patientId?: number;
    status?: string;
  } = {}) => {
    const query = new URLSearchParams();

    if (params.facilityId) query.set('facilityId', String(params.facilityId));
    if (params.patientId) query.set('patientId', String(params.patientId));
    if (params.status) query.set('status', params.status);

    const suffix = query.toString();

    return fetchJson<MaternityPregnancy[]>(
      `${API_BASE}/maternity/pregnancies${suffix ? `?${suffix}` : ''}`
    );
  },

  getPregnancy: (pregnancyId: number) =>
    fetchJson<MaternityPregnancyDetail>(
      `${API_BASE}/maternity/pregnancies/${pregnancyId}`
    ),

  bookPregnancy: (payload: Record<string, unknown>) =>
    fetchJson<MaternityPregnancy>(`${API_BASE}/maternity/pregnancies`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePregnancy: (pregnancyId: number, payload: Record<string, unknown>) =>
    fetchJson<MaternityPregnancy>(
      `${API_BASE}/maternity/pregnancies/${pregnancyId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  getAncVisits: (pregnancyId: number) =>
    fetchJson<AncVisit[]>(
      `${API_BASE}/maternity/pregnancies/${pregnancyId}/anc-visits`
    ),

  recordAncVisit: (payload: Record<string, unknown>) =>
    fetchJson<AncVisit>(`${API_BASE}/maternity/anc-visits`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getLabours: (params: { facilityId?: number; status?: string } = {}) => {
    const query = new URLSearchParams();

    if (params.facilityId) query.set('facilityId', String(params.facilityId));
    if (params.status) query.set('status', params.status);

    const suffix = query.toString();

    return fetchJson<LabourRecord[]>(
      `${API_BASE}/maternity/labours${suffix ? `?${suffix}` : ''}`
    );
  },

  getLabour: (labourRecordId: number) =>
    fetchJson<LabourRecord>(`${API_BASE}/maternity/labours/${labourRecordId}`),

  startLabour: (payload: Record<string, unknown>) =>
    fetchJson<LabourRecord>(`${API_BASE}/maternity/labours`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLabour: (labourRecordId: number, payload: Record<string, unknown>) =>
    fetchJson<LabourRecord>(`${API_BASE}/maternity/labours/${labourRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  recordPartograph: (payload: Record<string, unknown>) =>
    fetchJson<PartographEntry>(`${API_BASE}/maternity/partograph`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDeliveries: (params: {
    facilityId?: number;
    from?: string;
    to?: string;
  } = {}) => {
    const query = new URLSearchParams();

    if (params.facilityId) query.set('facilityId', String(params.facilityId));
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);

    const suffix = query.toString();

    return fetchJson<DeliveryRecord[]>(
      `${API_BASE}/maternity/deliveries${suffix ? `?${suffix}` : ''}`
    );
  },

  recordDelivery: (payload: Record<string, unknown>) =>
    fetchJson<{
      delivery: DeliveryRecord;
      babies: DeliveryBaby[];
      pregnancy: MaternityPregnancy;
      billing?: ServiceCharge | null;
    }>(`${API_BASE}/maternity/deliveries`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDelivery: (deliveryId: number) =>
    fetchJson<DeliveryRecord & { babies: DeliveryBaby[] }>(
      `${API_BASE}/maternity/deliveries/${deliveryId}`
    ),

  // ---- Postnatal care ----

  getPostnatalVisits: (pregnancyId: number) =>
    fetchJson<PostnatalVisit[]>(
      `${API_BASE}/maternity/pregnancies/${pregnancyId}/postnatal`
    ),

  getPostnatalRegister: (facilityId?: number) =>
    fetchJson<PostnatalVisit[]>(
      `${API_BASE}/maternity/postnatal${
        facilityId ? `?facilityId=${facilityId}` : ''
      }`
    ),

  recordPostnatalVisit: (payload: Record<string, unknown>) =>
    fetchJson<PostnatalVisit>(`${API_BASE}/maternity/postnatal`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ---- Immunisation ----

  getImmunisationSchedule: () =>
    fetchJson<{ antigens: ImmunisationAntigen[]; note: string }>(
      `${API_BASE}/immunisation/schedule`
    ),

  getImmunisationCard: (patientId: number) =>
    fetchJson<ImmunisationCard>(
      `${API_BASE}/immunisation/card?patientId=${patientId}`
    ),

  getImmunisationRecords: (patientId: number) =>
    fetchJson<ImmunisationRecord[]>(
      `${API_BASE}/immunisation/records?patientId=${patientId}`
    ),

  recordImmunisation: (payload: Record<string, unknown>) =>
    fetchJson<ImmunisationRecord>(`${API_BASE}/immunisation/records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getImmunisationDueList: (facilityId?: number) =>
    fetchJson<{
      asOf: string;
      children: ImmunisationDueRow[];
      note: string;
    }>(
      `${API_BASE}/immunisation/due${
        facilityId ? `?facilityId=${facilityId}` : ''
      }`
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

  /*
   * Ward and bed set-up.
   *
   * Each write has its own permission on the server; the screen hides
   * the buttons the user cannot use, and the server refuses anyway.
   */
  createWard:
    (data: {
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

  updateWard:
    (id: number, data: {
      name?: string;
      wardType?: string;
      genderAllocation?: string;
      dailyRate?: string | null;
      isActive?: boolean;
    }) =>
      fetchJson<Ward>(`${API_BASE}/wards/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

  deleteWard:
    (id: number) =>
      fetchJson<{ deleted: boolean; wardId: number; code: string }>(
        `${API_BASE}/wards/${id}`,
        { method: 'DELETE' }
      ),

  createBeds:
    (data: {
      wardId: number;
      bedNumbers?: string[];
      prefix?: string;
      startNumber?: number;
      count?: number;
      bedType: string;
      /** Omit for "not priced" — never send 0. */
      dailyCharge?: string | null;
    }) =>
      fetchJson<{ created: Bed[]; wardId: number; totalBeds: number }>(
        `${API_BASE}/beds`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),

  updateBed:
    (id: number, data: {
      bedNumber?: string;
      bedType?: string;
      dailyCharge?: string | null;
      status?: string;
    }) =>
      fetchJson<Bed>(`${API_BASE}/beds/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

  deleteBed:
    (id: number) =>
      fetchJson<{ deleted: boolean; bedId: number; bedNumber: string }>(
        `${API_BASE}/beds/${id}`,
        { method: 'DELETE' }
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
      fetchJson<
        Admission & {
          billing?: {
            nights: number;
            bedDays: Array<ServiceCharge | null>;
          };
        }
      >(
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
    (
      facilityId?: number,
      range?: { from?: string; to?: string }
    ) => {
      const params = new URLSearchParams();

      if (facilityId) params.set('facilityId', String(facilityId));
      if (range?.from) params.set('from', range.from);
      if (range?.to) params.set('to', range.to);

      const query = params.toString();

      return fetchJson<RevenueReport>(
        `${API_BASE}/analytics/revenue${query ? `?${query}` : ''}`
      );
    },

  getOperationsReport:
    (facilityId?: number) =>
      fetchJson<OperationsReport>(
        `${API_BASE}/reporting/operations${
          facilityId ? `?facilityId=${facilityId}` : ''
        }`
      ),

  getOccupancyTrend:
    (facilityId?: number, days?: number) => {
      const params = new URLSearchParams();

      if (facilityId) params.set('facilityId', String(facilityId));
      if (days) params.set('days', String(days));

      const query = params.toString();

      return fetchJson<OccupancyTrendResponse>(
        `${API_BASE}/reporting/occupancy-trend${query ? `?${query}` : ''}`
      );
    },

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
      fetchJson<{
        orders: LabOrder[];
        queue: QueueItem;
        billing?: Array<{
          orderId: number;
          testName: string;
          billing: ServiceCharge | null;
        }>;
      }>(
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

  getInventoryBatches:
    (
      facilityId?: number,
      options?: { itemId?: number; status?: 'All' | 'Expired' | 'Expiring' | 'OK'; horizonDays?: number }
    ) => {
      const params = new URLSearchParams();

      if (facilityId) params.set('facilityId', String(facilityId));
      if (options?.itemId) params.set('itemId', String(options.itemId));
      if (options?.status) params.set('status', options.status);
      if (options?.horizonDays) params.set('horizonDays', String(options.horizonDays));

      const query = params.toString();

      return fetchJson<InventoryBatchRow[]>(
        `${API_BASE}/inventory/batches${query ? `?${query}` : ''}`
      );
    },

  getExpirySummary:
    (facilityId?: number, days?: number) => {
      const params = new URLSearchParams();

      if (facilityId) params.set('facilityId', String(facilityId));
      if (days) params.set('days', String(days));

      const query = params.toString();

      return fetchJson<ExpirySummary>(
        `${API_BASE}/inventory/expiry-summary${query ? `?${query}` : ''}`
      );
    },

  receiveBatch:
    (
      itemId: number,
      payload: {
        batchNumber: string;
        expiryDate: string;
        quantity: number;
        costPerUnit?: string | number;
        facilityId?: number;
      }
    ) =>
      fetchJson<ReceiveBatchResult>(
        `${API_BASE}/inventory/${itemId}/batches`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),

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
        batchNumber?: string | null;
        stockTracking?: 'FEFO' | 'untracked';
        allocations?: DispenseAllocation[];
        stockAfter?: number | null;
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

  /**
   * Charges the engine could not price. They are owed, not lost: each
   * row holds the original request so it can be billed once a tariff
   * exists (migration 0020).
   */
  getChargeAttempts: (facilityId: number, status?: string) =>
    fetchJson<BillingChargeAttemptList>(
      `${API_BASE}/billing/charge-attempts?facilityId=${encodeURIComponent(
        String(facilityId)
      )}${status ? `&status=${encodeURIComponent(status)}` : ""}`
    ),

  retryChargeAttempt: (id: number, facilityId: number) =>
    fetchJson<BillingChargeAttemptOutcome>(
      `${API_BASE}/billing/charge-attempts/${encodeURIComponent(String(id))}/retry`,
      { method: "POST", body: JSON.stringify({ facilityId }) }
    ),

  retryChargeAttempts: (facilityId: number) =>
    fetchJson<BillingChargeRetrySummary>(
      `${API_BASE}/billing/charge-attempts/retry`,
      { method: "POST", body: JSON.stringify({ facilityId }) }
    ),

  voidChargeAttempt: (id: number, facilityId: number, reason?: string) =>
    fetchJson<{ success: boolean; id: number; status: string }>(
      `${API_BASE}/billing/charge-attempts/${encodeURIComponent(String(id))}/void`,
      { method: "POST", body: JSON.stringify({ facilityId, reason }) }
    ),

  /** Read-only: which tariff would price this service, and why. */
  explainTariffMatch: (input: {
    family: string;
    code?: string;
    name?: string;
    wardCode?: string;
    encounterType?: string;
    facilityId?: number;
  }) =>
    fetchJson<TariffMatchExplanation>(`${API_BASE}/billing/tariff-match`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Catalogue service → tariff links (migration 0021). */
  getServiceTariffLinks: (facilityId: number) =>
    fetchJson<ServiceTariffLink[]>(
      `${API_BASE}/service-tariff-links?facilityId=${encodeURIComponent(
        String(facilityId)
      )}`
    ),

  createServiceTariffLink: (input: {
    facilityId: number;
    serviceType: string;
    serviceId?: number | null;
    tariffId: number;
    autoBill?: boolean;
    note?: string;
  }) =>
    fetchJson<ServiceTariffLink & { replacedLinks: number[] }>(
      `${API_BASE}/service-tariff-links`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  deactivateServiceTariffLink: (id: number, facilityId: number) =>
    fetchJson<ServiceTariffLink>(
      `${API_BASE}/service-tariff-links/${encodeURIComponent(String(id))}/deactivate`,
      { method: "PATCH", body: JSON.stringify({ facilityId }) }
    ),

  /**
   * Every active laboratory test in this facility and what it would
   * bill today. Runs the same resolver the charger runs.
   */
  getLabServiceDiagnostics: (facilityId: number) =>
    fetchJson<LabServiceDiagnostics>(
      `${API_BASE}/billing/lab-service-diagnostics?facilityId=${encodeURIComponent(
        String(facilityId)
      )}`
    ),

  recordPayment:
    (payment: Partial<BillingPayment> & {
      transactionCode?: string;
      allowOverpayment?: boolean;
    }) =>
      fetchJson<RecordPaymentResult>(
        `${API_BASE}/billing/payments`,
        {
          method: 'POST',
          body: JSON.stringify(
            payment
          ),
        }
      ),

  /** Payments received at a facility, newest first, for reconciliation. */
  getPayments:
    (facilityId?: number, options?: { invoiceId?: number; method?: string; limit?: number }) => {
      const params = new URLSearchParams();

      if (facilityId !== undefined) params.set('facilityId', String(facilityId));
      if (options?.invoiceId !== undefined) params.set('invoiceId', String(options.invoiceId));
      if (options?.method) params.set('method', options.method);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));

      const suffix = params.toString();

      return fetchJson<PaymentLedgerRow[]>(
        `${API_BASE}/billing/payments${suffix ? `?${suffix}` : ''}`,
      );
    },

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

  /** Charges on an invoice that a claim could cover. */
  getClaimableLines:
    (invoiceId: number, facilityId?: number) =>
      fetchJson<ClaimableLinesResponse>(
        `${API_BASE}/invoices/${invoiceId}/claimable-lines${
          facilityId ? `?facilityId=${facilityId}` : ''
        }`
      ),

  getClaimItems:
    (claimId: number, facilityId?: number) =>
      fetchJson<Array<{ id: number; description: string; amount: string }>>(
        `${API_BASE}/claims/${claimId}/items${
          facilityId ? `?facilityId=${facilityId}` : ''
        }`
      ),

  /** Draft a claim. Omit lineItemIds to claim the whole outstanding balance. */
  draftClaim:
    (claim: {
      invoiceId: number;
      lineItemIds?: number[];
      payerName?: string;
      policyNumber?: string;
      preAuthCode?: string;
      notes?: string;
      facilityId?: number;
    }) =>
      fetchJson<DraftClaimResult>(
        `${API_BASE}/claims`,
        {
          method: 'POST',
          body: JSON.stringify(
            claim
          ),
        }
      ),

  submitClaim:
    (id: number, facilityId?: number) =>
      fetchJson<InsuranceClaim>(
        `${API_BASE}/claims/${id}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ facilityId }),
        }
      ),

  adjudicateClaim:
    (
      id: number,
      approvedAmount: string,
      notes?: string,
      facilityId?: number
    ) =>
      fetchJson<InsuranceClaim>(
        `${API_BASE}/claims/${id}/adjudicate`,
        {
          method: 'POST',
          body: JSON.stringify({
            approvedAmount,
            notes,
            facilityId,
          }),
        }
      ),

  settleClaim:
    (id: number, facilityId?: number) =>
      fetchJson<ClaimSettlementResult>(
        `${API_BASE}/claims/${id}/settle`,
        {
          method: 'POST',
          body: JSON.stringify({ facilityId }),
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

  /**
   * DHA self-assessment, computed server-side from the requirements
   * register. Read-only: there is no endpoint that edits a score.
   */
  getDhaCompliance:
    () =>
      fetchJson<{
        success: boolean;
        generatedAt: string;
        categories: Array<{
          category: string;
          label: string;
          weight: number;
          assessed: number;
          verified: number;
          score: number;
          contribution: number;
        }>;
        weightedAverage: number;
        overallScore: number;
        criticalGateTriggered: boolean;
        criticalGaps: Array<{
          id: string;
          title: string;
          status: string;
          severity: string;
          dependency?: string;
        }>;
        readyForSubmission: boolean;
        counts: Record<string, number>;
        totalRequirements: number;
        certification: false;
        disclaimer: string;
        requirements: Array<{
          id: string;
          category: string;
          title: string;
          requirement: string;
          module: string;
          status: string;
          severity: string;
          evidence: string;
          verification: string;
          externalDependency?: string;
          note?: string;
        }>;
      }>(
        `${API_BASE}/compliance/dha`
      ),

  // ============================================================
  // DHA / AFYACONNECT
  // ============================================================

  /** Readiness is computed locally and never returns a credential. */
  getDhaReadiness:
    (probe = false) =>
      fetchJson<DhaReadinessReport>(
        `${API_BASE}/integrations/dha/readiness?probe=${probe ? 'true' : 'false'}`
      ),

  getDhaCalls:
    (facilityId?: number, limit = 25) =>
      fetchJson<DhaCallLog[]>(
        `${API_BASE}/integrations/dha/calls?limit=${limit}${
          facilityId ? `&facilityId=${facilityId}` : ''
        }`
      ),

  checkDhaEligibility:
    (
      patientId: number,
      options: {
        identificationType?: string;
        identificationNumber?: string;
        facilityId?: number;
      } = {}
    ) =>
      fetchJson<DhaEligibilityResult>(
        `${API_BASE}/integrations/dha/patients/${patientId}/eligibility`,
        {
          method: 'POST',
          body: JSON.stringify(options),
        }
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

