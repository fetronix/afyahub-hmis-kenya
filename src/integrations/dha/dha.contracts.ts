/**
 * JaliCare HMIS
 * DHA / AfyaConnect — verified API contracts
 *
 * Every field below is taken from the published DHA documentation. Where
 * the documentation left a shape unspecified, the type says `unknown`
 * rather than guessing. Nothing here is invented.
 *
 *   auth        POST /tenants/token
 *   eligibility GET  /patients/eligibility
 *   coverage    GET  /patients/benefits
 *               GET  /patients/benefits/interventions
 *               GET  /patients/benefits/utilization
 *               GET  /patients/sub-benefits
 *               GET  /patients/pomsf-balances
 *   consent     POST /claims/authorize
 *               POST /claims/visit
 */

/* ============================================================
   AUTH — POST /tenants/token
   ============================================================ */

export interface DhaTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/* ============================================================
   PAGINATION — shared by the coverage endpoints
   ============================================================ */

export interface DhaPaginated<T> {
  count: number;
  currentPage: number;
  endIndex: number;
  next: string | null;
  pageSize: number;
  previous: string | null;
  results: T[];
  startIndex: number;
  totalPages: number;
}

/* ============================================================
   ELIGIBILITY — GET /patients/eligibility
   ============================================================ */

/**
 * Identification types accepted by SHA.
 *
 * The documentation states that `ClientRegistry ID` should be used by
 * default, and that the others are fallbacks for when a CR ID is not yet
 * known. The literal strings below are the documented enum values.
 */
export const DHA_IDENTIFICATION_TYPES = [
  'National ID',
  'ClientRegistry ID',
  'Birth Notification',
  'Birth Certificate',
  'Alien ID',
  'Refugee ID',
  'Mandate Number',
] as const;

export type DhaIdentificationType = (typeof DHA_IDENTIFICATION_TYPES)[number];

export interface DhaScheme {
  /** e.g. POMSF, POMSF-047, TSC, USALAMA */
  schemeName?: string;
  [key: string]: unknown;
}

export interface DhaEligibilityResponse {
  requestIdNumber: string;
  requestIdType: number | string;
  age?: number;
  dateOfBirth?: string;
  facilityBiometricsEnforced?: boolean;
  fullName?: string;
  gender?: string;
  /** When false the documentation requires integrators to block all
   *  subsequent transactions for the patient. */
  isAlive?: boolean;
  memberCrNumber?: string;
  schemes?: DhaScheme[];
  statusCode?: string;
  statusDesc?: string;
  whitelistedForOTP?: boolean;
}

/* ============================================================
   COVERAGE
   ============================================================ */

/** GET /patients/benefits — parent benefits. */
export interface DhaBenefit {
  code?: string;
  name?: string;
  [key: string]: unknown;
}

/** GET /patients/benefits/interventions — the fields the scenario
 *  documentation says decide which claim flow applies. */
export interface DhaIntervention {
  code?: string;
  name?: string;
  /** PER_DIEM | FEE_FOR_SERVICE */
  paymentMechanism?: string;
  needsPreauth?: boolean;
  needsManualPreauthApproval?: boolean;
  /** IP | OP */
  accessPoint?: string;
  /** SHIF | UHC | ECCIF ... */
  fund?: string;
  [key: string]: unknown;
}

/** GET /patients/sub-benefits */
export interface DhaSubBenefit {
  code?: string;
  name?: string;
  tariff?: unknown;
  [key: string]: unknown;
}

/** GET /patients/benefits/utilization */
export interface DhaUtilization {
  code?: string;
  crId?: string;
  householdMaxLimit?: number;
  householdUtilisedLimit?: number;
  individualMaxLimit?: number;
  individualUtilisedLimit?: number;
  limitScope?: string;
  nextAvailability?: string;
  utilizationDays?: number;
  [key: string]: unknown;
}

/* ============================================================
   CONSENT — POST /claims/authorize
   ============================================================ */

export interface DhaOtpAuthorizationRequest {
  patient_id: string;
  service_type: 'OUTPATIENT' | 'INPATIENT';
  otp: string;
  intervention_codes: string[];
}

export interface DhaAuthorizationResponse {
  authCode?: string;
  /** Used as `consent_token` downstream. Never logged. */
  token?: string;
  guid?: string;
  status?: string;
  authorizationType?: string[];
  needsPreauth?: boolean;
  expiry?: string;
  [key: string]: unknown;
}

/* ============================================================
   VISIT / VIRTUAL CLAIM — POST /claims/visit
   ============================================================ */

export interface DhaOtpVisitRequest {
  intervention_codes: string[];
  patient_id: string;
  service_type: 'CAPITATION' | 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY';
  otp: string;
  practitioner_identification_type?:
    'registration_number' | 'National ID' | 'Alien ID' | 'Refugee ID';
  practitioner_identification_number?: string;
  practitioner_regulation_body?: 'KMPDC' | 'COC' | 'NCK' | 'PPB';
}

/** Only the fields this system reads back are typed. */
export interface DhaVisitResponse {
  claim_id?: number;
  visit_number?: string;
  invoice_number?: string;
  reference_number?: string;
  authorization_code?: string;
  authorization_guid?: string;
  service_type?: string;
  scheme_name?: string;
  total_claim_amount?: number;
  total_claim_net_amount?: number;
  workflow_state?: string;
  visit_start?: string;
  patient_number?: string;
  [key: string]: unknown;
}

/* ============================================================
   PATIENT SEARCH — GET /patients
   ============================================================ */

export interface DhaRegistryPatient {
  id?: string;
  [key: string]: unknown;
}

/* ============================================================
   DOCUMENTED ENDPOINT PATHS
   ============================================================ */

/**
 * Path templates, all relative to the documented base URL. Keeping them
 * in one place makes it obvious that every call this module makes has a
 * documented origin.
 */
export const DHA_ENDPOINTS = {
  token: '/tenants/token',
  patientSearch: '/patients',
  eligibility: '/patients/eligibility',
  benefits: '/patients/benefits',
  interventions: '/patients/benefits/interventions',
  utilization: '/patients/benefits/utilization',
  subBenefits: '/patients/sub-benefits',
  pomsfBalances: '/patients/pomsf-balances',
  bedOccupancy: '/facilities/{facilityCode}/beds/occupancy',
  authorize: '/claims/authorize',
  visit: '/claims/visit',
} as const;

export type DhaEndpointKey = keyof typeof DHA_ENDPOINTS;
