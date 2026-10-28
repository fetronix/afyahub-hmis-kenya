/**
 * JaliCare HMIS
 * SHA / DHA HIE v1, AfyaConnect, AfyaLink & Kenya eClaims FHIR R4 Adapter
 *
 * Implements the payer-independent `PayerGatewayAdapter` contract for
 * Kenya's Social Health Authority (SHA). Keeps all DHA HIE REST v1,
 * AfyaLink SHR mediator, and FHIR R4 transport concerns isolated from
 * JaliCare's internal insurance domain engine.
 */

import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { maskIdentifier } from '../dha/dha.eligibility.ts';
import {
  describeShaConnectionStatus,
  loadShaConfig,
  type ShaConfig,
  type ShaConnectionStatusReport,
  type ShaEnvironmentMode,
} from './sha.config.ts';
import {
  isPomsfSchemeCode,
  parseShaBundleSubmissionResponse,
  parseShaClaimStatusResponse,
  type ParsedShaBundleResponse,
  type ParsedShaClaimStatus,
} from './sha.fhir.ts';

export type EligibilityOutcome =
  'Eligible' | 'Ineligible' | 'Pending' | 'Unable to verify' | 'Manual review required';

export type VerificationSource = 'AUTHORITATIVE_PAYER' | 'SANDBOX_SIMULATION' | 'UNAVAILABLE';

export interface ShaSchemeDetail {
  schemeCode: string;
  schemeName: string;
  memberType?: string | null;
  eligible: boolean;
  isPomsf: boolean;
  statusCode?: string | null;
  statusDesc?: string | null;
  coverageStartDate?: string | null;
  coverageEndDate?: string | null;
}

export interface EligibilityGatewayRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  identificationType: string;
  identificationValue: string;
  correlationId?: string;
}

export interface EligibilityGatewayResult {
  outcome: EligibilityOutcome;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  payerReference: string | null;
  memberCrNumber: string | null;
  memberStatus: string | null;
  isAlive: boolean | null;
  facilityBiometricsEnforced: boolean | null;
  whitelistedForOtp: boolean | null;
  hasPomsfScheme: boolean;
  schemes: string[];
  schemeDetails: ShaSchemeDetail[];
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  restrictions: string[];
  reason: string | null;
  possibleSolution: string | null;
  responseClassification:
    | 'CONFIRMED_ELIGIBLE'
    | 'CONFIRMED_INELIGIBLE'
    | 'CONFIRMED_DECEASED'
    | 'CONFIRMED_PENDING'
    | 'MANUAL_REVIEW'
    | 'CONFIG_MISSING'
    | 'UPSTREAM_TIMEOUT'
    | 'UPSTREAM_ERROR'
    | 'UNPARSEABLE_RESPONSE';
  correlationId: string;
}

export interface ClientRegistrySearchRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  identificationType: string;
  identificationValue: string;
  correlationId?: string;
}

export interface ClientRegistrySearchResult {
  found: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  crId: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  isAlive: boolean | null;
  deceasedDateTime: string | null;
  citizenship: string | null;
  county: string | null;
  subCounty: string | null;
  preferredPrimaryCareNetwork: string | null;
  errorMessage: string | null;
  correlationId: string;
}

export interface HieInterventionCoverageItem {
  code: string;
  name: string;
  accessPoint: string;
  fund: string;
  paymentMechanism: string;
  overallTariff: string | null;
  kephLevelTariff: string | null;
  needsPreauth: boolean;
  needsManualPreauthApproval: boolean;
  needsDoctorAuthorization: boolean;
  needApprovalBeforeClaimSubmission: boolean;
  needsMemberAuthorization: boolean;
  numberOfDoctorsRequired: number;
  applicableSchemes: string[];
  requiredPreauthDocumentTypes: string[];
  applicableDocumentTypes: string[];
  specialistFlags: {
    requiresSurgicalPreauth: boolean;
    requiresRenalPreauth: boolean;
    requiresOncologyPreauth: boolean;
    requiresRadiologyPreauth: boolean;
    requiresOpticalPreauth: boolean;
  };
}

export interface HieBenefitsLookupRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  memberCrNumber: string;
  parentBenefitCode?: string | null;
  subBenefitCode?: string | null;
  interventionCode?: string | null;
  accessPoint?: string | null;
  search?: string | null;
  correlationId?: string;
}

export interface HieBenefitsLookupResult {
  reachable: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  benefits: Array<{ code: string; name: string; fund?: string | null; status?: string | null }>;
  subBenefits: Array<{
    code: string;
    name: string;
    parentBenefitCode?: string | null;
    fund?: string | null;
  }>;
  interventions: HieInterventionCoverageItem[];
  errorMessage: string | null;
  correlationId: string;
}

export interface HieUtilizationLookupRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  memberCrNumber: string;
  interventionCode: string;
  includePomsfBalances?: boolean;
  policyYear?: number;
  principalMemberCrNumber?: string | null;
  includeBedOccupancy?: boolean;
  correlationId?: string;
}

export interface HieUtilizationItem {
  crId: string;
  code: string;
  limitScope: string | null;
  individualMaxLimitKes: string | null;
  individualUtilisedLimitKes: string | null;
  individualRemainingLimitKes: string | null;
  householdMaxLimitKes: string | null;
  householdUtilisedLimitKes: string | null;
  householdRemainingLimitKes: string | null;
  utilizationDays: number | null;
  nextAvailability: string | null;
}

export interface HieUtilizationLookupResult {
  reachable: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  utilization: HieUtilizationItem[];
  pomsfBalances: Array<{
    schemeCode: string;
    policyYear: string;
    annualAllocationKes: string | null;
    utilisedAmountKes: string | null;
    remainingBalanceKes: string | null;
  }>;
  bedOccupancy: {
    facilityCode: string;
    facilityName: string | null;
    bpLevel: string | null;
    occupancyRatePercent: number | null;
    totalBeds: number | null;
    occupiedBeds: number | null;
  } | null;
  errorMessage: string | null;
  correlationId: string;
}

export interface VisitAuthorizationRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  memberCrNumber: string;
  serviceType: 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CAPITATION';
  consentMethod: 'OTP' | 'BIOMETRICS' | 'MINORS_BIOMETRICS';
  otp?: string | null;
  biometricPayloadRef?: string | null;
  interventions: string[];
  isElectivePreVisit?: boolean;
  startVirtualClaimImmediately?: boolean;
  selectedPomsfScheme?: string | null;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: 'KMPDC' | 'COC' | 'NCK' | 'PPB' | null;
  correlationId?: string;
}

export interface VisitAuthorizationResult {
  authorized: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  authorizationGuid: string | null;
  consentToken: string | null;
  authCode: string | null;
  authStatus: string;
  needsPreauth: boolean;
  virtualClaimId: string | null;
  expiresAtIso: string | null;
  errorMessage: string | null;
  correlationId: string;
}

export interface HiePreauthGatewayRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  consentToken: string;
  variant: 'NORMAL' | 'SURGICAL' | 'RENAL' | 'ONCOLOGY' | 'OPTICAL' | 'IMAGING';
  isElective: boolean;
  interventionCode: string;
  serviceStart: string;
  serviceEnd: string;
  clinicalIndications: string;
  diagnoses: Array<{ icdCode: string; name: string; diagnosisType?: string }>;
  items: Array<{ code: string; name: string; quantity: number; unitPriceKes: string }>;
  doctors?: Array<{
    registrationNumber: string;
    regulationBody: 'KMPDC' | 'COC' | 'NCK' | 'PPB';
    name?: string | null;
  }>;
  providerNotificationEmail?: string | null;
  correlationId?: string;
}

export interface HiePreauthGatewayResult {
  accepted: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  hiePreauthGuid: string | null;
  payerAuthReference: string | null;
  status: string;
  doctorApproved: boolean | null;
  needsDoctorApproval: boolean;
  interimApprovedAmountKes: string | null;
  finalApprovedAmountKes: string | null;
  rejectionReason: string | null;
  errors: string[];
  httpStatus: number | null;
  correlationId: string;
}

export interface HieVirtualClaimSubmitRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  consentToken: string;
  subType: 'op' | 'ip';
  invoiceNumber: string;
  dischargeReason: 'RECOVERED' | 'REFERRED' | 'DECEASED' | 'ABSCONDED' | 'OTHER';
  dischargeDate?: string | null;
  otp?: string | null;
  dischargeAuthGuid?: string | null;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: 'KMPDC' | 'COC' | 'NCK' | 'PPB' | null;
  diagnoses: Array<{ icdCode: string; interventionCode: string }>;
  lines: Array<{
    interventionCode: string;
    serviceName: string;
    serviceIdentifier?: string | null;
    unitPriceKes: string;
    quantity: number;
  }>;
  notes?: string | null;
  correlationId?: string;
}

export interface HieRemittancesQueryRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  correlationId?: string;
}

export interface HieRemittanceSummaryItem {
  bankReference: string;
  remittanceReference: string;
  paymentDate: string;
  totalAmountKes: string;
  paymentChannel: string;
  claimCount: number | null;
}

export interface HieRemittancesQueryResult {
  reachable: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  remittances: HieRemittanceSummaryItem[];
  errorMessage: string | null;
  correlationId: string;
}

export interface HieRemittanceClaimsQueryRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  bankReference: string;
  correlationId?: string;
}

export interface HieRemittanceClaimLine {
  payerClaimReference: string;
  claimNumber: string | null;
  invoiceNumber: string | null;
  claimedAmountKes: string | null;
  approvedAmountKes: string | null;
  paidAmountKes: string;
  paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID';
}

export interface HieRemittanceClaimsQueryResult {
  reachable: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  bankReference: string;
  claims: HieRemittanceClaimLine[];
  errorMessage: string | null;
  correlationId: string;
}

export interface RegisterHieCallbackEndpointRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  entityType: 'claim' | 'preauth' | 'authorization';
  environment: 'sandbox' | 'production';
  baseUrl: string;
  callbackPath: string;
  authType?: 'bearer_static' | 'oauth2_client_credentials' | 'api_key' | 'none';
  secretRef?: string | null;
  correlationId?: string;
}

export interface RegisterHieCallbackEndpointResult {
  registered: boolean;
  source: VerificationSource;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  endpointId: string | null;
  operationId: string | null;
  errorMessage: string | null;
  correlationId: string;
}

export interface BundleGatewayRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  operation: 'preauthorization.submit' | 'claims.submit' | 'claims.resubmit';
  bundleUuid: string;
  claimUuid: string;
  fhirBundle: Record<string, unknown>;
  correlationId?: string;
}

export interface BundleGatewayResult extends ParsedShaBundleResponse {
  mode: ShaEnvironmentMode;
  source: VerificationSource;
  isSimulated: boolean;
  httpStatus: number | null;
  correlationId: string;
}

export interface ClaimStatusGatewayRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  claimUuid: string;
  payerClaimReference?: string | null;
  correlationId?: string;
}

export interface ClaimStatusGatewayResult extends ParsedShaClaimStatus {
  mode: ShaEnvironmentMode;
  source: VerificationSource;
  isSimulated: boolean;
  httpStatus: number | null;
  correlationId: string;
  errorMessage: string | null;
}

export interface PayerGatewayAdapter {
  readonly payerCode: string;
  getConnectionStatus(facilityRegistryOverride?: string | null): ShaConnectionStatusReport;
  checkEligibility(req: EligibilityGatewayRequest): Promise<EligibilityGatewayResult>;
  submitBundle(req: BundleGatewayRequest): Promise<BundleGatewayResult>;
  queryClaimStatus(req: ClaimStatusGatewayRequest): Promise<ClaimStatusGatewayResult>;
  searchClientRegistryPatient?(
    req: ClientRegistrySearchRequest,
  ): Promise<ClientRegistrySearchResult>;
  fetchPatientBenefitsAndInterventions?(
    req: HieBenefitsLookupRequest,
  ): Promise<HieBenefitsLookupResult>;
  fetchBenefitUtilizationAndBalances?(
    req: HieUtilizationLookupRequest,
  ): Promise<HieUtilizationLookupResult>;
  createVisitAuthorization?(req: VisitAuthorizationRequest): Promise<VisitAuthorizationResult>;
  submitHiePreauth?(req: HiePreauthGatewayRequest): Promise<HiePreauthGatewayResult>;
  queryHiePreauths?(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    correlationId?: string;
  }): Promise<HiePreauthGatewayResult>;
  cancelHiePreauth?(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    reason: string;
    correlationId?: string;
  }): Promise<{
    cancelled: boolean;
    source: VerificationSource;
    isSimulated: boolean;
    errorMessage: string | null;
    correlationId: string;
  }>;
  submitHieVirtualClaim?(req: HieVirtualClaimSubmitRequest): Promise<BundleGatewayResult>;
  fetchFacilityRemittances?(req: HieRemittancesQueryRequest): Promise<HieRemittancesQueryResult>;
  fetchClaimsPaidByRemittance?(
    req: HieRemittanceClaimsQueryRequest,
  ): Promise<HieRemittanceClaimsQueryResult>;
  registerCallbackEndpoint?(
    req: RegisterHieCallbackEndpointRequest,
  ): Promise<RegisterHieCallbackEndpointResult>;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export type FetchLike = typeof globalThis.fetch;

export interface ShaGatewayAdapterOptions {
  config?: ShaConfig;
  fetchImpl?: FetchLike;
  recordAuditCall?: boolean;
}

function asObj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  }
  return null;
}

function readNumMoney(val: unknown): string | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val.toFixed(2);
  if (typeof val === 'string' && /^-?\d+(\.\d{1,4})?$/.test(val.trim())) {
    return Number(val.trim()).toFixed(2);
  }
  return null;
}

function normalizeIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return null;
}

/**
 * Maps internal JaliCare identifier enumerations to exact DHA HIE Client Registry /
 * Eligibility query parameter values (`ClientRegistry ID`, `National ID`, `Birth Notification`,
 * `Birth Certificate`, `Alien ID`, `Refugee ID`, `Mandate Number`).
 */
export function mapToHieIdentificationType(
  rawType: string,
  identificationValue?: string | null,
): string {
  const upper = rawType.trim().toUpperCase();
  if (upper === 'CLIENT_REGISTRY_ID' || upper === 'CR_NUMBER' || upper === 'CLIENTREGISTRY ID') {
    return 'ClientRegistry ID';
  }
  if (upper === 'NATIONAL_ID' || upper === 'NATIONAL ID') return 'National ID';
  if (upper === 'BIRTH_NOTIFICATION' || upper === 'BIRTH NOTIFICATION') {
    return 'Birth Notification';
  }
  if (upper === 'BIRTH_CERTIFICATE' || upper === 'BIRTH CERTIFICATE') return 'Birth Certificate';
  if (upper === 'ALIEN_ID' || upper === 'ALIEN ID') return 'Alien ID';
  if (upper === 'REFUGEE_ID' || upper === 'REFUGEE ID') return 'Refugee ID';
  if (upper === 'MANDATE_NUMBER' || upper === 'MANDATE NUMBER') return 'Mandate Number';
  if (upper === 'SHA_NUMBER') {
    if (identificationValue && /^CR/i.test(identificationValue.trim())) {
      return 'ClientRegistry ID';
    }
    return 'ClientRegistry ID';
  }
  return rawType.trim();
}

/**
 * Strict, non-guessing eligibility payload parser for DHA HIE v1 `/patients/eligibility`
 * and AfyaLink `/v2/eligibility`.
 *
 * Enforces official DHA HIE rules:
 *   1. Check `isAlive` BEFORE anything else — a deceased beneficiary (`isAlive === false`
 *      or `deceased_datetime` present) MUST be blocked (`CONFIRMED_DECEASED`), regardless
 *      of scheme array entries.
 *   2. Match POMSF schemes by prefix (`POMSF*`, `TSC`, `USALAMA`), never exact `"POMSF"` equality.
 *   3. HTTP 5xx, malformed JSON, or ambiguous 200 payload NEVER converts to `Eligible` or `Ineligible`.
 */
export function interpretShaEligibilityPayload(
  httpStatus: number,
  body: unknown,
): Omit<EligibilityGatewayResult, 'source' | 'mode' | 'isSimulated' | 'correlationId'> {
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      outcome: 'Unable to verify',
      payerReference: null,
      memberCrNumber: null,
      memberStatus: null,
      isAlive: null,
      facilityBiometricsEnforced: null,
      whitelistedForOtp: null,
      hasPomsfScheme: false,
      schemes: [],
      schemeDetails: [],
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: `SHA gateway returned HTTP ${httpStatus}; eligibility could not be confirmed.`,
      possibleSolution: 'Retry verification once SHA gateway connectivity recovers.',
      responseClassification: 'UPSTREAM_ERROR',
    };
  }

  const root = asObj(body);
  if (!root) {
    return {
      outcome: 'Unable to verify',
      payerReference: null,
      memberCrNumber: null,
      memberStatus: null,
      isAlive: null,
      facilityBiometricsEnforced: null,
      whitelistedForOtp: null,
      hasPomsfScheme: false,
      schemes: [],
      schemeDetails: [],
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: 'SHA gateway returned an empty or non-JSON eligibility payload.',
      possibleSolution: 'Inspect gateway diagnostics and retry verification.',
      responseClassification: 'UNPARSEABLE_RESPONSE',
    };
  }

  const payload = asObj(root.message) ?? asObj(root.data) ?? root;

  const payerReference = readStr(
    payload,
    'verification_id',
    'verificationId',
    'reference',
    'request_id',
    'requestIdNumber',
    'transactionId',
  );
  const memberCrNumber = readStr(
    payload,
    'memberCrNumber',
    'cr_id',
    'crNumber',
    'id',
    'member_number',
    'sha_number',
  );
  const memberStatus = readStr(
    payload,
    'member_status',
    'memberStatus',
    'status',
    'statusDesc',
    'coverage_status',
  );
  const statusCode = readStr(payload, 'statusCode', 'status_code');
  const reason = readStr(payload, 'reason', 'statusDesc', 'statusReason', 'message', 'detail');
  const possibleSolution = readStr(payload, 'possible_solution', 'possibleSolution');

  const isAlive =
    typeof payload.isAlive === 'boolean'
      ? payload.isAlive
      : typeof payload.is_alive === 'boolean'
        ? payload.is_alive
        : readStr(payload, 'deceased_datetime', 'deceasedDateTime')
          ? false
          : null;

  const facilityBiometricsEnforced =
    typeof payload.facilityBiometricsEnforced === 'boolean'
      ? payload.facilityBiometricsEnforced
      : typeof payload.facility_biometrics_enforced === 'boolean'
        ? payload.facility_biometrics_enforced
        : null;

  const whitelistedForOtp =
    typeof payload.whitelistedForOTP === 'boolean'
      ? payload.whitelistedForOTP
      : typeof payload.whitelisted_for_otp === 'boolean'
        ? payload.whitelisted_for_otp
        : null;

  let coverageStartDate = normalizeIsoDate(
    readStr(payload, 'coverageStartDate', 'coverage_start_date', 'validFrom', 'periodStart'),
  );
  let coverageEndDate = normalizeIsoDate(
    readStr(payload, 'coverageEndDate', 'coverage_end_date', 'validTo', 'periodEnd'),
  );

  const schemes: string[] = [];
  const schemeDetails: ShaSchemeDetail[] = [];

  if (Array.isArray(payload.schemes)) {
    for (const s of payload.schemes) {
      if (typeof s === 'string' && s.trim()) {
        const code = s.trim();
        schemes.push(code);
        schemeDetails.push({
          schemeCode: code,
          schemeName: code,
          eligible: true,
          isPomsf: isPomsfSchemeCode(code),
        });
      } else if (asObj(s)) {
        const sObj = s as Record<string, unknown>;
        const code = readStr(sObj, 'schemeCode', 'scheme_code', 'code', 'name');
        if (code) {
          const name = readStr(sObj, 'schemeName', 'scheme_name', 'name') ?? code;
          const covObj = asObj(sObj.coverage);
          const sStart = normalizeIsoDate(
            covObj ? readStr(covObj, 'startDate', 'start_date') : readStr(sObj, 'startDate'),
          );
          const sEnd = normalizeIsoDate(
            covObj ? readStr(covObj, 'endDate', 'end_date') : readStr(sObj, 'endDate'),
          );
          if (!coverageStartDate && sStart) coverageStartDate = sStart;
          if (!coverageEndDate && sEnd) coverageEndDate = sEnd;

          const covStatusUpper = (readStr(covObj ?? sObj, 'status') ?? '').toUpperCase();
          const schemeElig =
            typeof sObj.eligible === 'boolean'
              ? sObj.eligible
              : sObj.eligible === 1 || sObj.eligible === '1'
                ? true
                : sObj.eligible === 0 || sObj.eligible === '0'
                  ? false
                  : covStatusUpper === 'ACTIVE' || covStatusUpper === 'ELIGIBLE';

          if (schemeElig || payload.eligible !== undefined) {
            schemes.push(code);
          }
          schemeDetails.push({
            schemeCode: code,
            schemeName: name,
            memberType: readStr(sObj, 'memberType', 'member_type'),
            eligible: schemeElig,
            isPomsf: isPomsfSchemeCode(code),
            statusCode: readStr(sObj, 'statusCode', 'status_code'),
            statusDesc: readStr(sObj, 'statusDesc', 'status_desc'),
            coverageStartDate: sStart,
            coverageEndDate: sEnd,
          });
        }
      }
    }
  } else {
    const singleScheme = readStr(payload, 'scheme', 'package', 'fund');
    if (singleScheme) {
      schemes.push(singleScheme);
      schemeDetails.push({
        schemeCode: singleScheme,
        schemeName: singleScheme,
        eligible: true,
        isPomsf: isPomsfSchemeCode(singleScheme),
      });
    }
  }

  const hasPomsfScheme =
    schemeDetails.some((sd) => sd.isPomsf && sd.eligible) ||
    schemes.some((sc) => isPomsfSchemeCode(sc));

  const restrictions: string[] = Array.isArray(payload.restrictions)
    ? payload.restrictions.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : [];

  // CRITICAL DHA HIE RULE: Check `isAlive` BEFORE anything else!
  if (isAlive === false) {
    return {
      outcome: 'Ineligible',
      payerReference,
      memberCrNumber,
      memberStatus: 'DECEASED',
      isAlive: false,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme: false,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions: [
        'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); admission and billing are blocked.',
        ...restrictions,
      ],
      reason:
        reason ??
        'Beneficiary is recorded as deceased in the DHA Client Registry (isAlive=false); SHA transactions are blocked.',
      possibleSolution:
        'Verify patient identity against DHA Client Registry; deceased beneficiaries cannot be admitted or billed.',
      responseClassification: 'CONFIRMED_DECEASED',
    };
  }

  const rawEligible = payload.eligible ?? payload.isEligible;
  const normalizedStatus = (memberStatus ?? statusCode ?? '').toUpperCase();
  const hasAnyEligibleScheme =
    schemeDetails.length > 0 && schemeDetails.some((sd) => sd.eligible === true);
  const allSchemesExplicitlyIneligible =
    schemeDetails.length > 0 && schemeDetails.every((sd) => sd.eligible === false);

  if (
    normalizedStatus === 'PENDING' ||
    normalizedStatus === 'AWAITING_CONTRIBUTION' ||
    normalizedStatus === 'IN_TRANSITION'
  ) {
    return {
      outcome: 'Pending',
      payerReference,
      memberCrNumber,
      memberStatus,
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'SHA membership activation or contribution posting is pending.',
      possibleSolution,
      responseClassification: 'CONFIRMED_PENDING',
    };
  }

  if (
    normalizedStatus === 'MANUAL_REVIEW' ||
    normalizedStatus === 'REVIEW_REQUIRED' ||
    normalizedStatus === 'IDENTITY_CONFLICT'
  ) {
    return {
      outcome: 'Manual review required',
      payerReference,
      memberCrNumber,
      memberStatus,
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'Payer flagged member identity or household record for manual review.',
      possibleSolution,
      responseClassification: 'MANUAL_REVIEW',
    };
  }

  if (
    rawEligible === true ||
    rawEligible === 1 ||
    rawEligible === '1' ||
    normalizedStatus === 'ELIGIBLE' ||
    normalizedStatus === 'ACTIVE' ||
    (rawEligible === undefined && hasAnyEligibleScheme)
  ) {
    const eligibleSchemeCodes = schemeDetails
      .filter((sd) => sd.eligible)
      .map((sd) => sd.schemeCode);
    const finalSchemes =
      eligibleSchemeCodes.length > 0
        ? eligibleSchemeCodes
        : schemes.length > 0
          ? schemes
          : ['SHIF'];

    return {
      outcome: 'Eligible',
      payerReference,
      memberCrNumber,
      memberStatus: memberStatus ?? 'ACTIVE',
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme,
      schemes: finalSchemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'Confirmed eligible by SHA payer response.',
      possibleSolution,
      responseClassification: 'CONFIRMED_ELIGIBLE',
    };
  }

  if (
    rawEligible === false ||
    rawEligible === 0 ||
    rawEligible === '0' ||
    normalizedStatus === 'INELIGIBLE' ||
    normalizedStatus === 'INACTIVE' ||
    normalizedStatus === 'SUSPENDED' ||
    normalizedStatus === 'EXPIRED' ||
    (rawEligible === undefined && allSchemesExplicitlyIneligible)
  ) {
    return {
      outcome: 'Ineligible',
      payerReference,
      memberCrNumber,
      memberStatus: memberStatus ?? 'INELIGIBLE',
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme: false,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'Confirmed ineligible by SHA payer response.',
      possibleSolution,
      responseClassification: 'CONFIRMED_INELIGIBLE',
    };
  }

  // Ambiguous or unrecognised payload structure -> NEVER assume Eligible or Ineligible!
  return {
    outcome: 'Unable to verify',
    payerReference,
    memberCrNumber,
    memberStatus,
    isAlive,
    facilityBiometricsEnforced,
    whitelistedForOtp,
    hasPomsfScheme: false,
    schemes,
    schemeDetails,
    coverageStartDate,
    coverageEndDate,
    restrictions,
    reason: 'SHA response did not contain an unambiguous eligibility indicator.',
    possibleSolution: 'Verify member details or perform manual portal verification.',
    responseClassification: 'UNPARSEABLE_RESPONSE',
  };
}

export class ShaGatewayAdapter implements PayerGatewayAdapter {
  public readonly payerCode = 'SHA';
  private readonly configOverride?: ShaConfig;
  private readonly fetchImpl: FetchLike;
  private readonly shouldRecordAuditCall: boolean;
  private cachedToken: CachedToken | null = null;

  constructor(options: ShaGatewayAdapterOptions = {}) {
    this.configOverride = options.config;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.shouldRecordAuditCall = options.recordAuditCall ?? true;
  }

  private resolveConfig(facilityRegistryOverride?: string | null): ShaConfig {
    const base = this.configOverride ?? loadShaConfig();
    if (facilityRegistryOverride && facilityRegistryOverride.trim().length > 0) {
      return loadShaConfig({ ...base, facilityRegistryCode: facilityRegistryOverride.trim() });
    }
    return base;
  }

  public getConnectionStatus(facilityRegistryOverride?: string | null): ShaConnectionStatusReport {
    const cfg = this.resolveConfig(facilityRegistryOverride);
    return describeShaConnectionStatus(cfg, facilityRegistryOverride);
  }

  /**
   * Builds official DHA HIE service-account headers (`X-Facility-Id`, `X-Facility-Id-Type: fr-code`,
   * `Authorization: Bearer <token>`, `X-Correlation-Id`).
   */
  private buildServiceAccountHeaders(
    cfg: ShaConfig,
    token: string,
    correlationId: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
      ...extra,
    };
    if (cfg.facilityRegistryCode) {
      headers['X-Facility-Id'] = cfg.facilityRegistryCode;
      headers['X-Facility-Id-Type'] = cfg.facilityIdType;
    }
    return headers;
  }

  private async logGatewayCall(entry: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    correlationId: string;
    operation: string;
    mode: ShaEnvironmentMode;
    httpMethod: string;
    endpointPath: string;
    subjectHint: string | null;
    httpStatus: number | null;
    outcome: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    durationMs: number;
  }): Promise<void> {
    if (!this.shouldRecordAuditCall) return;
    try {
      await db.insert(schema.dhaApiCalls).values({
        tenantId: entry.tenantId,
        facilityId: entry.facilityId,
        userId: entry.actorUserId,
        mode: entry.mode,
        operation: `sha.${entry.operation}`,
        method: entry.httpMethod,
        path: entry.endpointPath,
        status: entry.httpStatus,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        outcome: entry.outcome,
        errorCode: entry.errorCode ?? null,
        requestId: entry.correlationId,
      });
    } catch {
      // Never fail clinical/billing workflow if the telemetry table is unreachable in unit tests.
    }
  }

  private async obtainAccessToken(cfg: ShaConfig, correlationId: string): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - 30_000 > now) {
      return this.cachedToken.accessToken;
    }

    if (!cfg.middlewareBaseUrl || !cfg.clientId || !cfg.clientSecret) {
      throw new Error('Missing SHA OAuth2 credentials');
    }

    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, 'utf8').toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      // HIE `/tenants/token` reads `{ client_id, client_secret }` from JSON body;
      // SMART-on-FHIR / OAuth2 token servers read Basic Auth + `grant_type: client_credentials`.
      const res = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.tokenPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: 'client_credentials',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Token endpoint returned HTTP ${res.status}`);
      }

      const json = asObj(await res.json());
      const data = json ? (asObj(json.data) ?? json) : null;
      const token = data ? readStr(data, 'access_token', 'token', 'accessToken') : null;
      if (!token) {
        throw new Error('Token endpoint did not return an access_token');
      }

      const expiresIn =
        data && typeof data.expires_in === 'number' && data.expires_in > 60 ? data.expires_in : 900;

      this.cachedToken = {
        accessToken: token,
        expiresAtMs: now + expiresIn * 1000,
      };
      return token;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchGetWithBoundedRetry(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    maxRetries: number,
  ): Promise<Response> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          attempt += 1;
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (attempt >= maxRetries) throw err;
        attempt += 1;
      }
    }
    throw lastError ?? new Error('SHA GET request failed');
  }

  /* ============================================================
     WORKFLOW 1A: CLIENT REGISTRY PATIENT SEARCH (CR ID RESOLUTION)
     ============================================================ */

  public async searchClientRegistryPatient(
    req: ClientRegistrySearchRequest,
  ): Promise<ClientRegistrySearchResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const trimmed = req.identificationValue.trim();
    const started = Date.now();

    if (cfg.mode === 'mock') {
      const isNotFound = trimmed.endsWith('4040');
      const isDeceased = trimmed.endsWith('6666');
      const crId = isNotFound ? null : `CR${trimmed.replace(/\D/g, '').padStart(10, '2')}-1`;
      const result: ClientRegistrySearchResult = isNotFound
        ? {
            found: false,
            source: 'SANDBOX_SIMULATION',
            mode: 'mock',
            isSimulated: true,
            crId: null,
            fullName: null,
            firstName: null,
            lastName: null,
            gender: null,
            dateOfBirth: null,
            isAlive: null,
            deceasedDateTime: null,
            citizenship: null,
            county: null,
            subCounty: null,
            preferredPrimaryCareNetwork: null,
            errorMessage: 'Simulated Client Registry response: no matching patient profile found.',
            correlationId,
          }
        : {
            found: true,
            source: 'SANDBOX_SIMULATION',
            mode: 'mock',
            isSimulated: true,
            crId,
            fullName: 'SIMULATED BENEFICIARY',
            firstName: 'SIMULATED',
            lastName: 'BENEFICIARY',
            gender: 'female',
            dateOfBirth: '1990-05-14',
            isAlive: !isDeceased,
            deceasedDateTime: isDeceased ? '2026-02-10T08:00:00Z' : null,
            citizenship: 'KE',
            county: 'NYERI',
            subCounty: 'NYERI CENTRAL',
            preferredPrimaryCareNetwork: 'NYERI CENTRAL PCN',
            errorMessage: null,
            correlationId,
          };

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'registry.patient_search',
        mode: 'mock',
        httpMethod: 'GET',
        endpointPath: cfg.clientRegistryPath,
        subjectHint: maskIdentifier(trimmed),
        httpStatus: isNotFound ? 404 : 200,
        outcome: result.found ? 'FOUND' : 'NOT_FOUND',
        durationMs: Date.now() - started,
      });

      return result;
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        found: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        crId: null,
        fullName: null,
        firstName: null,
        lastName: null,
        gender: null,
        dateOfBirth: null,
        isAlive: null,
        deceasedDateTime: null,
        citizenship: null,
        county: null,
        subCounty: null,
        preferredPrimaryCareNetwork: null,
        errorMessage: cfg.disabledReason ?? 'SHA Client Registry credentials are not configured.',
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const url = new URL(`${cfg.middlewareBaseUrl}${cfg.clientRegistryPath}`);
      url.searchParams.set(
        'identification_type',
        mapToHieIdentificationType(req.identificationType, trimmed),
      );
      url.searchParams.set('identification_number', trimmed);

      const response = await this.fetchGetWithBoundedRetry(
        url.toString(),
        this.buildServiceAccountHeaders(cfg, token, correlationId),
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      const rawJson = await response.json().catch(() => null);
      const json = asObj(rawJson);
      const firstFromArray = Array.isArray(rawJson)
        ? asObj(rawJson[0])
        : json && Array.isArray(json.patients)
          ? asObj(json.patients[0])
          : json && Array.isArray(json.data)
            ? asObj(json.data[0])
            : null;
      const payload = firstFromArray ?? (json ? (asObj(json.data) ?? json) : null);
      const crId = payload ? readStr(payload, 'id', 'cr_id', 'memberCrNumber') : null;
      const deceasedDt = payload ? readStr(payload, 'deceased_datetime', 'deceasedDateTime') : null;

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'registry.patient_search',
        mode: cfg.mode,
        httpMethod: 'GET',
        endpointPath: cfg.clientRegistryPath,
        subjectHint: maskIdentifier(trimmed),
        httpStatus: response.status,
        outcome: response.ok && crId ? 'FOUND' : 'NOT_FOUND',
        durationMs: Date.now() - started,
      });

      if (!response.ok || !payload || !crId) {
        return {
          found: false,
          source: response.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          mode: cfg.mode,
          isSimulated: false,
          crId: null,
          fullName: null,
          firstName: null,
          lastName: null,
          gender: null,
          dateOfBirth: null,
          isAlive: null,
          deceasedDateTime: null,
          citizenship: null,
          county: null,
          subCounty: null,
          preferredPrimaryCareNetwork: null,
          errorMessage:
            (payload && readStr(payload, 'message', 'detail')) ??
            `Client Registry lookup returned HTTP ${response.status}.`,
          correlationId,
        };
      }

      const firstName = readStr(payload, 'first_name', 'firstName');
      const middleName = readStr(payload, 'middle_name', 'middleName');
      const lastName = readStr(payload, 'last_name', 'lastName');

      return {
        found: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        crId,
        fullName:
          [firstName, middleName, lastName].filter(Boolean).join(' ') ||
          readStr(payload, 'fullName'),
        firstName,
        lastName,
        gender: readStr(payload, 'gender'),
        dateOfBirth: normalizeIsoDate(readStr(payload, 'date_of_birth', 'dateOfBirth')),
        isAlive: deceasedDt ? false : true,
        deceasedDateTime: deceasedDt,
        citizenship: readStr(payload, 'citizenship'),
        county: readStr(payload, 'county'),
        subCounty: readStr(payload, 'sub_county', 'subCounty'),
        preferredPrimaryCareNetwork: readStr(
          payload,
          'preferred_primary_care_network',
          'preferredPrimaryCareNetwork',
        ),
        errorMessage: null,
        correlationId,
      };
    } catch (error) {
      return {
        found: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        crId: null,
        fullName: null,
        firstName: null,
        lastName: null,
        gender: null,
        dateOfBirth: null,
        isAlive: null,
        deceasedDateTime: null,
        citizenship: null,
        county: null,
        subCounty: null,
        preferredPrimaryCareNetwork: null,
        errorMessage:
          error instanceof Error
            ? `Client Registry unreachable: ${error.message}`
            : 'Client Registry unreachable.',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 1B: SHA BENEFICIARY ELIGIBILITY VERIFICATION
     ============================================================ */

  public async checkEligibility(req: EligibilityGatewayRequest): Promise<EligibilityGatewayResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const maskedHint = maskIdentifier(req.identificationValue);
    const started = Date.now();

    if (cfg.mode === 'mock') {
      const trimmed = req.identificationValue.trim();
      let result: EligibilityGatewayResult;

      if (trimmed.endsWith('5000')) {
        result = {
          outcome: 'Unable to verify',
          source: 'UNAVAILABLE',
          mode: 'mock',
          isSimulated: true,
          payerReference: null,
          memberCrNumber: null,
          memberStatus: null,
          isAlive: null,
          facilityBiometricsEnforced: null,
          whitelistedForOtp: null,
          hasPomsfScheme: false,
          schemes: [],
          schemeDetails: [],
          coverageStartDate: null,
          coverageEndDate: null,
          restrictions: [],
          reason: 'Simulated SHA gateway timeout in mock mode; eligibility is unverified.',
          possibleSolution: 'Retry eligibility check or verify connectivity.',
          responseClassification: 'UPSTREAM_TIMEOUT',
          correlationId,
        };
      } else if (trimmed.endsWith('6666')) {
        result = {
          outcome: 'Ineligible',
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
          memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
          memberStatus: 'DECEASED',
          isAlive: false,
          facilityBiometricsEnforced: true,
          whitelistedForOtp: false,
          hasPomsfScheme: false,
          schemes: ['SHIF'],
          schemeDetails: [
            {
              schemeCode: 'SHIF',
              schemeName: 'Social Health Insurance Fund',
              eligible: false,
              isPomsf: false,
            },
          ],
          coverageStartDate: '2026-01-01',
          coverageEndDate: '2026-12-31',
          restrictions: [
            'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); admission and billing are blocked.',
          ],
          reason:
            'Simulated SHA response: beneficiary is recorded as deceased in DHA Client Registry (isAlive=false).',
          possibleSolution: 'Verify patient identity; deceased beneficiaries cannot be billed.',
          responseClassification: 'CONFIRMED_DECEASED',
          correlationId,
        };
      } else if (trimmed.endsWith('0000')) {
        result = {
          outcome: 'Ineligible',
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
          memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
          memberStatus: 'INACTIVE',
          isAlive: true,
          facilityBiometricsEnforced: false,
          whitelistedForOtp: true,
          hasPomsfScheme: false,
          schemes: ['SHIF'],
          schemeDetails: [
            {
              schemeCode: 'SHIF',
              schemeName: 'Social Health Insurance Fund',
              eligible: false,
              isPomsf: false,
              statusDesc: 'Contributions in arrears',
            },
          ],
          coverageStartDate: '2026-01-01',
          coverageEndDate: '2026-06-30',
          restrictions: ['Household SHIF contribution in arrears'],
          reason: 'Simulated SHA response: member SHIF contributions are currently inactive.',
          possibleSolution: 'Advise patient to update SHIF contribution via AfyaYangu / *147#.',
          responseClassification: 'CONFIRMED_INELIGIBLE',
          correlationId,
        };
      } else if (trimmed.endsWith('9999')) {
        result = {
          outcome: 'Pending',
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
          memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
          memberStatus: 'PENDING',
          isAlive: true,
          facilityBiometricsEnforced: false,
          whitelistedForOtp: true,
          hasPomsfScheme: false,
          schemes: ['SHIF'],
          schemeDetails: [],
          coverageStartDate: null,
          coverageEndDate: null,
          restrictions: [],
          reason: 'Simulated SHA response: recent registration awaiting means-testing activation.',
          possibleSolution: 'Recheck eligibility once SHA registration activation completes.',
          responseClassification: 'CONFIRMED_PENDING',
          correlationId,
        };
      } else if (trimmed.endsWith('8888')) {
        result = {
          outcome: 'Manual review required',
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
          memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
          memberStatus: 'IDENTITY_CONFLICT',
          isAlive: true,
          facilityBiometricsEnforced: true,
          whitelistedForOtp: false,
          hasPomsfScheme: false,
          schemes: ['SHIF'],
          schemeDetails: [],
          coverageStartDate: null,
          coverageEndDate: null,
          restrictions: ['Duplicate dependant identity record flagged in Client Registry'],
          reason:
            'Simulated SHA response: Client Registry identity conflict requires manual review.',
          possibleSolution: 'Verify National ID / Birth Certificate against SHA portal.',
          responseClassification: 'MANUAL_REVIEW',
          correlationId,
        };
      } else {
        const isPomsfSim = trimmed.endsWith('7777');
        const schemes = isPomsfSim ? ['SHIF', 'PHC', 'POMSF-CIVIL'] : ['SHIF', 'PHC'];
        result = {
          outcome: 'Eligible',
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
          memberCrNumber: `SIM-CR-${trimmed.slice(-4).padStart(4, '0')}`,
          memberStatus: 'ACTIVE',
          isAlive: true,
          facilityBiometricsEnforced: false,
          whitelistedForOtp: true,
          hasPomsfScheme: isPomsfSim,
          schemes,
          schemeDetails: schemes.map((sc) => ({
            schemeCode: sc,
            schemeName: sc === 'POMSF-CIVIL' ? 'Public Officers Medical Scheme Fund' : sc,
            eligible: true,
            isPomsf: isPomsfSchemeCode(sc),
            coverageStartDate: '2026-01-01',
            coverageEndDate: '2026-12-31',
          })),
          coverageStartDate: '2026-01-01',
          coverageEndDate: '2026-12-31',
          restrictions: [],
          reason: 'Simulated SHA sandbox response: active SHIF & PHC beneficiary.',
          possibleSolution: null,
          responseClassification: 'CONFIRMED_ELIGIBLE',
          correlationId,
        };
      }

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'eligibility.verify',
        mode: 'mock',
        httpMethod: 'GET',
        endpointPath: cfg.eligibilityPath,
        subjectHint: maskedHint,
        httpStatus: result.outcome === 'Unable to verify' ? 504 : 200,
        outcome: result.outcome,
        durationMs: Date.now() - started,
      });

      return result;
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        outcome: 'Unable to verify',
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        payerReference: null,
        memberCrNumber: null,
        memberStatus: null,
        isAlive: null,
        facilityBiometricsEnforced: null,
        whitelistedForOtp: null,
        hasPomsfScheme: false,
        schemes: [],
        schemeDetails: [],
        coverageStartDate: null,
        coverageEndDate: null,
        restrictions: [],
        reason: cfg.disabledReason ?? 'SHA gateway credentials are not configured.',
        possibleSolution:
          'Configure SHA AfyaLink credentials in server environment settings before running live verification.',
        responseClassification: 'CONFIG_MISSING',
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const url = new URL(`${cfg.middlewareBaseUrl}${cfg.eligibilityPath}`);
      url.searchParams.set(
        'identification_type',
        mapToHieIdentificationType(req.identificationType, req.identificationValue),
      );
      url.searchParams.set('identification_number', req.identificationValue.trim());

      const response = await this.fetchGetWithBoundedRetry(
        url.toString(),
        this.buildServiceAccountHeaders(cfg, token, correlationId),
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }

      const interpreted = interpretShaEligibilityPayload(response.status, parsedBody);
      const source: VerificationSource =
        interpreted.outcome === 'Unable to verify' ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER';

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'eligibility.verify',
        mode: cfg.mode,
        httpMethod: 'GET',
        endpointPath: cfg.eligibilityPath,
        subjectHint: maskedHint,
        httpStatus: response.status,
        outcome: interpreted.outcome,
        durationMs: Date.now() - started,
      });

      return {
        ...interpreted,
        source,
        mode: cfg.mode,
        isSimulated: false,
        correlationId,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const errMessage = isTimeout
        ? 'SHA eligibility request timed out before payer responded.'
        : 'SHA eligibility gateway was unreachable or returned a transport failure.';

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'eligibility.verify',
        mode: cfg.mode,
        httpMethod: 'GET',
        endpointPath: cfg.eligibilityPath,
        subjectHint: maskedHint,
        httpStatus: null,
        outcome: 'Unable to verify',
        errorCode: isTimeout ? 'TIMEOUT' : 'TRANSPORT_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - started,
      });

      return {
        outcome: 'Unable to verify',
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        payerReference: null,
        memberCrNumber: null,
        memberStatus: null,
        isAlive: null,
        facilityBiometricsEnforced: null,
        whitelistedForOtp: null,
        hasPomsfScheme: false,
        schemes: [],
        schemeDetails: [],
        coverageStartDate: null,
        coverageEndDate: null,
        restrictions: [],
        reason: errMessage,
        possibleSolution:
          'Retry verification; do not treat patient as ineligible without payer confirmation.',
        responseClassification: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 2: HIE BENEFITS, SUB-BENEFITS & INTERVENTION MATRIX
     ============================================================ */

  public async fetchPatientBenefitsAndInterventions(
    req: HieBenefitsLookupRequest,
  ): Promise<HieBenefitsLookupResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const crId = req.memberCrNumber.trim();

    if (cfg.mode === 'mock') {
      const allSimInterventions: HieInterventionCoverageItem[] = [
        {
          code: 'SHA-12-001',
          name: 'Outpatient Consultation & Primary Care',
          accessPoint: 'OP',
          fund: 'PHC',
          paymentMechanism: 'CAPITATION',
          overallTariff: '0.00',
          kephLevelTariff: '0.00',
          needsPreauth: false,
          needsManualPreauthApproval: false,
          needsDoctorAuthorization: false,
          needApprovalBeforeClaimSubmission: false,
          needsMemberAuthorization: true,
          numberOfDoctorsRequired: 0,
          applicableSchemes: ['PHC', 'SHIF'],
          requiredPreauthDocumentTypes: [],
          applicableDocumentTypes: ['CLAIM_FORM'],
          specialistFlags: {
            requiresSurgicalPreauth: false,
            requiresRenalPreauth: false,
            requiresOncologyPreauth: false,
            requiresRadiologyPreauth: false,
            requiresOpticalPreauth: false,
          },
        },
        {
          code: 'SHA-09-021',
          name: 'CT / MRI Specialized Diagnostic Imaging',
          accessPoint: 'OP',
          fund: 'SHIF',
          paymentMechanism: 'FEE FOR SERVICE',
          overallTariff: '8000.00',
          kephLevelTariff: '8000.00',
          needsPreauth: true,
          needsManualPreauthApproval: false,
          needsDoctorAuthorization: true,
          needApprovalBeforeClaimSubmission: true,
          needsMemberAuthorization: true,
          numberOfDoctorsRequired: 1,
          applicableSchemes: ['SHIF', 'POMSF'],
          requiredPreauthDocumentTypes: ['IMAGING_RESULT', 'MEDICAL_REPORT', 'PREAUTH_FORM'],
          applicableDocumentTypes: ['CLAIM_FORM', 'IMAGING_RESULT'],
          specialistFlags: {
            requiresSurgicalPreauth: false,
            requiresRenalPreauth: false,
            requiresOncologyPreauth: false,
            requiresRadiologyPreauth: true,
            requiresOpticalPreauth: false,
          },
        },
        {
          code: 'SHA-19-152',
          name: 'Elective Major Surgical Intervention',
          accessPoint: 'IP',
          fund: 'SHIF',
          paymentMechanism: 'FEE FOR SERVICE',
          overallTariff: '44800.00',
          kephLevelTariff: '44800.00',
          needsPreauth: true,
          needsManualPreauthApproval: true,
          needsDoctorAuthorization: true,
          needApprovalBeforeClaimSubmission: true,
          needsMemberAuthorization: true,
          numberOfDoctorsRequired: 1,
          applicableSchemes: ['SHIF', 'POMSF'],
          requiredPreauthDocumentTypes: [
            'IMAGING_RESULT',
            'LAB_RESULTS',
            'MEDICAL_REPORT',
            'PREAUTH_FORM',
          ],
          applicableDocumentTypes: ['CLAIM_FORM', 'DISCHARGE_SUMMARY', 'THEATRE_NOTES'],
          specialistFlags: {
            requiresSurgicalPreauth: true,
            requiresRenalPreauth: false,
            requiresOncologyPreauth: false,
            requiresRadiologyPreauth: false,
            requiresOpticalPreauth: false,
          },
        },
      ];

      const filtered = req.interventionCode
        ? allSimInterventions.filter(
            (i) => i.code.toUpperCase() === req.interventionCode!.trim().toUpperCase(),
          )
        : allSimInterventions;

      return {
        reachable: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        benefits: [
          { code: 'SHA-12', name: 'Outpatient Services', fund: 'PHC', status: 'ACTIVE' },
          {
            code: 'SHA-09',
            name: 'Medical Imaging & Other Investigations',
            fund: 'SHIF',
            status: 'ACTIVE',
          },
          { code: 'SHA-19', name: 'Surgical Services', fund: 'SHIF', status: 'ACTIVE' },
        ],
        subBenefits: [
          {
            code: 'SHA-19-SC-13',
            name: 'General & Orthopaedic Surgery',
            parentBenefitCode: 'SHA-19',
            fund: 'SHIF',
          },
        ],
        interventions: filtered,
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        benefits: [],
        subBenefits: [],
        interventions: [],
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const headers = this.buildServiceAccountHeaders(cfg, token, correlationId);

      const benUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.benefitsPath}`);
      benUrl.searchParams.set('patient_id', crId);

      const intUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.interventionsPath}`);
      intUrl.searchParams.set('patient_id', crId);
      if (req.subBenefitCode) intUrl.searchParams.set('sub_benefit_code', req.subBenefitCode);
      if (req.interventionCode) intUrl.searchParams.set('code', req.interventionCode);
      if (req.accessPoint) intUrl.searchParams.set('access_point', req.accessPoint);
      if (req.search) intUrl.searchParams.set('search', req.search);

      const [benRes, intRes] = await Promise.all([
        this.fetchGetWithBoundedRetry(benUrl.toString(), headers, cfg.timeoutMs, cfg.maxGetRetries),
        this.fetchGetWithBoundedRetry(intUrl.toString(), headers, cfg.timeoutMs, cfg.maxGetRetries),
      ]);

      let subBenefits: HieBenefitsLookupResult['subBenefits'] = [];
      if (req.parentBenefitCode) {
        const subUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.subBenefitsPath}`);
        subUrl.searchParams.set('patient_id', crId);
        subUrl.searchParams.set('parent_benefit_code', req.parentBenefitCode);
        const subRes = await this.fetchGetWithBoundedRetry(
          subUrl.toString(),
          headers,
          cfg.timeoutMs,
          cfg.maxGetRetries,
        );
        if (subRes.ok) {
          const rawSub = await subRes.json().catch(() => null);
          const subJson = asObj(rawSub);
          const rows = Array.isArray(rawSub)
            ? rawSub
            : Array.isArray(subJson?.results)
              ? subJson.results
              : Array.isArray(subJson?.data)
                ? subJson.data
                : [];
          subBenefits = rows
            .map((r) => asObj(r))
            .filter((r): r is Record<string, unknown> => r !== null)
            .map((r) => ({
              code: readStr(r, 'code', 'sub_benefit_code') ?? 'UNKNOWN',
              name: readStr(r, 'name', 'sub_benefit_name') ?? 'Sub-Benefit',
              parentBenefitCode: req.parentBenefitCode,
              fund: readStr(r, 'fund'),
            }));
        }
      }

      if (!benRes.ok && !intRes.ok) {
        return {
          reachable: false,
          source: 'UNAVAILABLE',
          mode: cfg.mode,
          isSimulated: false,
          benefits: [],
          subBenefits: [],
          interventions: [],
          errorMessage: `SHA HIE benefits/interventions returned HTTP ${intRes.status}.`,
          correlationId,
        };
      }

      const rawBen = await benRes.json().catch(() => null);
      const rawInt = await intRes.json().catch(() => null);
      const benJson = asObj(rawBen);
      const intJson = asObj(rawInt);
      const benRows = Array.isArray(rawBen)
        ? rawBen
        : Array.isArray(benJson?.results)
          ? benJson.results
          : Array.isArray(benJson?.data)
            ? benJson.data
            : [];
      const intRows = Array.isArray(rawInt)
        ? rawInt
        : Array.isArray(intJson?.results)
          ? intJson.results
          : Array.isArray(intJson?.data)
            ? intJson.data
            : [];

      const benefits = benRows
        .map((r) => asObj(r))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => ({
          code: readStr(r, 'code', 'benefit_code') ?? 'UNKNOWN',
          name: readStr(r, 'name', 'benefit_name') ?? 'Benefit',
          fund: readStr(r, 'fund'),
          status: readStr(r, 'status'),
        }));

      const interventions: HieInterventionCoverageItem[] = intRows
        .map((r) => asObj(r))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => ({
          code: readStr(r, 'code', 'intervention_code') ?? 'UNKNOWN',
          name: readStr(r, 'name', 'intervention_name') ?? 'Intervention',
          accessPoint: readStr(r, 'accessPoint', 'access_point') ?? 'OP',
          fund: readStr(r, 'fund', 'intervention_fund') ?? 'SHIF',
          paymentMechanism:
            readStr(r, 'paymentMechanism', 'intervention_payment_mechanism') ?? 'FEE FOR SERVICE',
          overallTariff: readNumMoney(r.overallTariff ?? r.intervention_overall_tariff),
          kephLevelTariff: readNumMoney(r.kephLevelTarriff ?? r.keph_level_tarrif),
          needsPreauth: Boolean(r.needsPreauth ?? r.needs_preauth),
          needsManualPreauthApproval: Boolean(r.needsManualPreauthApproval),
          needsDoctorAuthorization: Boolean(r.needsDoctorAuthorization),
          needApprovalBeforeClaimSubmission: Boolean(r.needApprovalBeforeClaimSubmission),
          needsMemberAuthorization: Boolean(r.needsMemberAuthorization),
          numberOfDoctorsRequired:
            typeof r.numberOfDoctorsRequired === 'number' ? r.numberOfDoctorsRequired : 0,
          applicableSchemes: Array.isArray(r.applicableSchemes)
            ? r.applicableSchemes.map(String)
            : [],
          requiredPreauthDocumentTypes: Array.isArray(r.requiredPreauthDocumentTypes)
            ? r.requiredPreauthDocumentTypes.map(String)
            : [],
          applicableDocumentTypes: Array.isArray(r.applicableDocumentTypes)
            ? r.applicableDocumentTypes.map(String)
            : [],
          specialistFlags: {
            requiresSurgicalPreauth: Boolean(
              r.requiresSurgicalPreauth ?? r.requires_surgical_preauth,
            ),
            requiresRenalPreauth: Boolean(r.requiresRenalPreauth ?? r.requires_renal_preauth),
            requiresOncologyPreauth: Boolean(
              r.requiresOncologyPreauth ?? r.requires_oncology_preauth,
            ),
            requiresRadiologyPreauth: Boolean(
              r.requiresRadiologyPreauth ?? r.requires_radiology_preauth,
            ),
            requiresOpticalPreauth: Boolean(r.requiresOpticalPreauth ?? r.requires_optical_preauth),
          },
        }));

      return {
        reachable: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        benefits,
        subBenefits,
        interventions,
        errorMessage: null,
        correlationId,
      };
    } catch (error) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        benefits: [],
        subBenefits: [],
        interventions: [],
        errorMessage:
          error instanceof Error
            ? `SHA HIE benefits lookup failed: ${error.message}`
            : 'SHA HIE benefits lookup failed.',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 3: BENEFIT UTILIZATION, POMSF BALANCES & BED OCCUPANCY
     ============================================================ */

  public async fetchBenefitUtilizationAndBalances(
    req: HieUtilizationLookupRequest,
  ): Promise<HieUtilizationLookupResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const crId = req.memberCrNumber.trim();
    const code = req.interventionCode.trim().toUpperCase();

    if (cfg.mode === 'mock') {
      const isExhausted = crId.endsWith('0099') || code.endsWith('999');
      const indMax = 50000;
      const indUsed = isExhausted ? 50000 : 12000;
      const hhMax = 150000;
      const hhUsed = isExhausted ? 150000 : 28000;

      return {
        reachable: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        utilization: [
          {
            crId,
            code,
            limitScope: 'HOUSEHOLD_AND_INDIVIDUAL',
            individualMaxLimitKes: indMax.toFixed(2),
            individualUtilisedLimitKes: indUsed.toFixed(2),
            individualRemainingLimitKes: Math.max(0, indMax - indUsed).toFixed(2),
            householdMaxLimitKes: hhMax.toFixed(2),
            householdUtilisedLimitKes: hhUsed.toFixed(2),
            householdRemainingLimitKes: Math.max(0, hhMax - hhUsed).toFixed(2),
            utilizationDays: 3,
            nextAvailability: isExhausted ? '2027-01-01' : null,
          },
        ],
        pomsfBalances: req.includePomsfBalances
          ? [
              {
                schemeCode: 'POMSF-CIVIL',
                policyYear: String(req.policyYear ?? new Date().getFullYear()),
                annualAllocationKes: '200000.00',
                utilisedAmountKes: '35000.00',
                remainingBalanceKes: '165000.00',
              },
            ]
          : [],
        bedOccupancy: req.includeBedOccupancy
          ? {
              facilityCode: cfg.facilityRegistryCode ?? 'SIM-FID-001',
              facilityName: 'Simulated Facility',
              bpLevel: 'LEVEL_4',
              occupancyRatePercent: 62.5,
              totalBeds: 80,
              occupiedBeds: 50,
            }
          : null,
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        utilization: [],
        pomsfBalances: [],
        bedOccupancy: null,
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const headers = this.buildServiceAccountHeaders(cfg, token, correlationId);

      const utilUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.utilizationPath}`);
      utilUrl.searchParams.set('patient_id', crId);
      utilUrl.searchParams.set('intervention_code', code);

      const utilRes = await this.fetchGetWithBoundedRetry(
        utilUrl.toString(),
        headers,
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      if (!utilRes.ok) {
        return {
          reachable: false,
          source: 'UNAVAILABLE',
          mode: cfg.mode,
          isSimulated: false,
          utilization: [],
          pomsfBalances: [],
          bedOccupancy: null,
          errorMessage: `SHA HIE utilization endpoint returned HTTP ${utilRes.status}.`,
          correlationId,
        };
      }

      const rawUtil = await utilRes.json().catch(() => null);
      const utilArr = Array.isArray(rawUtil)
        ? rawUtil
        : Array.isArray(asObj(rawUtil)?.results)
          ? (asObj(rawUtil)!.results as unknown[])
          : Array.isArray(asObj(rawUtil)?.data)
            ? (asObj(rawUtil)!.data as unknown[])
            : [];

      const utilization: HieUtilizationItem[] = utilArr
        .map((u) => asObj(u))
        .filter((u): u is Record<string, unknown> => u !== null)
        .map((u) => {
          const indMax = readNumMoney(u.individualMaxLimit);
          const indUsed = readNumMoney(u.individualUtilisedLimit);
          const hhMax = readNumMoney(u.householdMaxLimit);
          const hhUsed = readNumMoney(u.householdUtilisedLimit);
          return {
            crId: readStr(u, 'crId') ?? crId,
            code: readStr(u, 'code') ?? code,
            limitScope: readStr(u, 'limitScope'),
            individualMaxLimitKes: indMax,
            individualUtilisedLimitKes: indUsed,
            individualRemainingLimitKes:
              indMax !== null && indUsed !== null
                ? Math.max(0, Number(indMax) - Number(indUsed)).toFixed(2)
                : null,
            householdMaxLimitKes: hhMax,
            householdUtilisedLimitKes: hhUsed,
            householdRemainingLimitKes:
              hhMax !== null && hhUsed !== null
                ? Math.max(0, Number(hhMax) - Number(hhUsed)).toFixed(2)
                : null,
            utilizationDays: typeof u.utilizationDays === 'number' ? u.utilizationDays : null,
            nextAvailability: readStr(u, 'nextAvailability'),
          };
        });

      const pomsfBalances: HieUtilizationLookupResult['pomsfBalances'] = [];
      if (req.includePomsfBalances) {
        const pomsfUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.pomsfBalancesPath}`);
        pomsfUrl.searchParams.set('patient_id', crId);
        pomsfUrl.searchParams.set(
          'policy_year',
          String(req.policyYear ?? new Date().getFullYear()),
        );
        pomsfUrl.searchParams.set('principal_member_number', req.principalMemberCrNumber ?? crId);
        const pomsfRes = await this.fetchGetWithBoundedRetry(
          pomsfUrl.toString(),
          headers,
          cfg.timeoutMs,
          cfg.maxGetRetries,
        );
        if (pomsfRes.ok) {
          const rawPomsf = await pomsfRes.json().catch(() => null);
          const pJson = asObj(rawPomsf);
          const pRows = Array.isArray(rawPomsf)
            ? rawPomsf
            : Array.isArray(pJson?.results)
              ? pJson.results
              : Array.isArray(pJson?.data)
                ? pJson.data
                : pJson
                  ? [pJson]
                  : [];
          for (const pr of pRows) {
            const pObj = asObj(pr);
            if (!pObj) continue;
            pomsfBalances.push({
              schemeCode: readStr(pObj, 'schemeCode', 'scheme_code') ?? 'POMSF',
              policyYear: String(req.policyYear ?? new Date().getFullYear()),
              annualAllocationKes: readNumMoney(pObj.annualAllocation ?? pObj.maxLimit),
              utilisedAmountKes: readNumMoney(pObj.utilisedAmount ?? pObj.utilisedLimit),
              remainingBalanceKes: readNumMoney(pObj.remainingBalance ?? pObj.availableBalance),
            });
          }
        }
      }

      let bedOccupancy: HieUtilizationLookupResult['bedOccupancy'] = null;
      if (req.includeBedOccupancy && cfg.facilityRegistryCode) {
        const occPath = cfg.bedOccupancyPathTemplate.replace(
          '{facilityCode}',
          encodeURIComponent(cfg.facilityRegistryCode),
        );
        const occRes = await this.fetchGetWithBoundedRetry(
          `${cfg.middlewareBaseUrl}${occPath}`,
          headers,
          cfg.timeoutMs,
          cfg.maxGetRetries,
        );
        if (occRes.ok) {
          const occObj = asObj(await occRes.json().catch(() => null));
          const rateObj = occObj ? asObj(occObj.bed_occupancy_rate) : null;
          bedOccupancy = {
            facilityCode: cfg.facilityRegistryCode,
            facilityName: occObj ? readStr(occObj, 'name') : null,
            bpLevel: occObj ? readStr(occObj, 'bp_level') : null,
            occupancyRatePercent: rateObj && typeof rateObj.rate === 'number' ? rateObj.rate : null,
            totalBeds:
              rateObj && typeof rateObj.total_beds === 'number' ? rateObj.total_beds : null,
            occupiedBeds:
              rateObj && typeof rateObj.occupied_beds === 'number' ? rateObj.occupied_beds : null,
          };
        }
      }

      return {
        reachable: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        utilization,
        pomsfBalances,
        bedOccupancy,
        errorMessage: null,
        correlationId,
      };
    } catch (error) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        utilization: [],
        pomsfBalances: [],
        bedOccupancy: null,
        errorMessage:
          error instanceof Error
            ? `SHA utilization lookup failed: ${error.message}`
            : 'SHA utilization lookup failed.',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 5A: BENEFICIARY CONSENT & VISIT AUTHORIZATION
     ============================================================ */

  public async createVisitAuthorization(
    req: VisitAuthorizationRequest,
  ): Promise<VisitAuthorizationResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (cfg.mode === 'mock') {
      if (req.consentMethod === 'OTP' && req.otp === '000000') {
        return {
          authorized: false,
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          authorizationGuid: null,
          consentToken: null,
          authCode: null,
          authStatus: 'OTP_REJECTED',
          needsPreauth: false,
          virtualClaimId: null,
          expiresAtIso: null,
          errorMessage: 'Simulated HIE OTP verification failed (expired or invalid OTP).',
          correlationId,
        };
      }

      const simGuid = randomUUID();
      const simToken = `SIMTOK-${correlationId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      const authStatus = req.isElectivePreVisit ? 'AUTHORIZED_PENDING_VISIT' : 'AUTHORIZED';

      return {
        authorized: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        authorizationGuid: simGuid,
        consentToken: simToken,
        authCode: simToken,
        authStatus,
        needsPreauth: Boolean(req.isElectivePreVisit),
        virtualClaimId:
          req.startVirtualClaimImmediately && !req.isElectivePreVisit
            ? `SIM-VCLAIM-${correlationId.slice(0, 8).toUpperCase()}`
            : null,
        expiresAtIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        authorized: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        authorizationGuid: null,
        consentToken: null,
        authCode: null,
        authStatus: 'UNAVAILABLE',
        needsPreauth: false,
        virtualClaimId: null,
        expiresAtIso: null,
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        correlationId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const headers = this.buildServiceAccountHeaders(cfg, token, correlationId, {
        'Content-Type': 'application/json',
      });

      const authRes = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.authorizePath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          patient_id: req.memberCrNumber.trim(),
          service_type: req.serviceType,
          interventions: req.interventions,
          ...(req.consentMethod === 'OTP' && req.otp ? { otp: req.otp.trim() } : {}),
          ...(req.biometricPayloadRef ? { biometric_ref: req.biometricPayloadRef } : {}),
        }),
        signal: controller.signal,
      });

      const authBody = asObj(await authRes.json().catch(() => null));
      const data = authBody ? (asObj(authBody.data) ?? authBody) : null;

      if (!authRes.ok || !data) {
        clearTimeout(timer);
        return {
          authorized: false,
          source: authRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          mode: cfg.mode,
          isSimulated: false,
          authorizationGuid: null,
          consentToken: null,
          authCode: null,
          authStatus: 'FAILED',
          needsPreauth: false,
          virtualClaimId: null,
          expiresAtIso: null,
          errorMessage:
            (data && readStr(data, 'message', 'detail', 'reason')) ??
            `HIE /claims/authorize returned HTTP ${authRes.status}.`,
          correlationId,
        };
      }

      const authorizationGuid = readStr(data, 'guid', 'authorization_guid', 'id');
      const consentToken = readStr(
        data,
        'token',
        'consent_token',
        'authCode',
        'authorization_code',
      );
      const authCode = readStr(data, 'authCode', 'authorization_code', 'token');
      const authStatus =
        readStr(data, 'status', 'claim_auth_status') ??
        (req.isElectivePreVisit ? 'AUTHORIZED_PENDING_VISIT' : 'AUTHORIZED');

      if (req.selectedPomsfScheme && consentToken) {
        await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.coversPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            consent_token: consentToken,
            scheme_code: req.selectedPomsfScheme,
          }),
          signal: controller.signal,
        }).catch(() => null);
      }

      let virtualClaimId: string | null = null;
      if (req.startVirtualClaimImmediately && !req.isElectivePreVisit) {
        const visitRes = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.visitPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            patient_id: req.memberCrNumber.trim(),
            service_type: req.serviceType,
            intervention_codes: req.interventions,
            ...(req.consentMethod === 'OTP' && req.otp
              ? { otp: req.otp.trim() }
              : { auth_guid: authorizationGuid }),
            ...(req.practitionerRegNumber && req.practitionerRegulator
              ? {
                  practitioner_identification_type: 'registration_number',
                  practitioner_identification_number: req.practitionerRegNumber,
                  practitioner_regulation_body: req.practitionerRegulator,
                }
              : {}),
          }),
          signal: controller.signal,
        });
        const visitJson = asObj(await visitRes.json().catch(() => null));
        if (visitRes.ok && visitJson) {
          virtualClaimId =
            readStr(visitJson, 'edi_claim_guid', 'visit_number') ??
            (typeof visitJson.claim_id === 'number' ? String(visitJson.claim_id) : null);
        }
      }

      clearTimeout(timer);
      return {
        authorized: Boolean(consentToken),
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        authorizationGuid,
        consentToken,
        authCode,
        authStatus,
        needsPreauth: Boolean(data.needsPreauth ?? data.needs_preauth),
        virtualClaimId,
        expiresAtIso: readStr(data, 'expiry', 'expires_at'),
        errorMessage: consentToken ? null : 'HIE authorization did not return a consent_token.',
        correlationId,
      };
    } catch (error) {
      clearTimeout(timer);
      return {
        authorized: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        authorizationGuid: null,
        consentToken: null,
        authCode: null,
        authStatus: 'UNAVAILABLE',
        needsPreauth: false,
        virtualClaimId: null,
        expiresAtIso: null,
        errorMessage:
          error instanceof Error
            ? `HIE visit authorization failed: ${error.message}`
            : 'HIE visit authorization failed.',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 5B: HIE PREAUTHORIZATIONS (SUBMIT / POLL / CANCEL)
     ============================================================ */

  public async submitHiePreauth(req: HiePreauthGatewayRequest): Promise<HiePreauthGatewayResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (cfg.mode === 'mock') {
      const simGuid = randomUUID();
      const needsDoc = Boolean(req.doctors && req.doctors.length > 0);
      return {
        accepted: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        hiePreauthGuid: simGuid,
        payerAuthReference: `SIM-HIE-PA-${simGuid.slice(0, 8).toUpperCase()}`,
        status: 'SUBMITTED',
        doctorApproved: needsDoc ? false : null,
        needsDoctorApproval: needsDoc,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: null,
        errors: [],
        httpStatus: 201,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        accepted: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: null,
        payerAuthReference: null,
        status: 'CONFIG_MISSING',
        doctorApproved: null,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        errors: [cfg.disabledReason ?? 'SHA HIE credentials are not configured.'],
        httpStatus: null,
        correlationId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const response = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.preauthsPath}`, {
        method: 'POST',
        headers: this.buildServiceAccountHeaders(cfg, token, correlationId, {
          'Content-Type': 'application/json',
          'Idempotency-Key': correlationId,
        }),
        body: JSON.stringify({
          consent_token: req.consentToken,
          preauth_type: req.variant,
          is_elective: req.isElective,
          intervention_code: req.interventionCode,
          service_start: req.serviceStart,
          service_end: req.serviceEnd,
          clinical_indications: req.clinicalIndications,
          diagnoses: req.diagnoses.map((d) => ({
            icd_code: d.icdCode,
            name: d.name,
            diagnosis_type: d.diagnosisType ?? 'PRIMARY',
          })),
          items: req.items.map((it) => ({
            code: it.code,
            name: it.name,
            quantity: String(it.quantity),
            unit_price: it.unitPriceKes,
          })),
          ...(req.doctors && req.doctors.length > 0
            ? {
                doctors: req.doctors.map((doc) => ({
                  practitioner_registration_number: doc.registrationNumber,
                  regulation_body: doc.regulationBody,
                  name: doc.name ?? undefined,
                })),
              }
            : {}),
          ...(req.providerNotificationEmail
            ? { provider_notification_email: req.providerNotificationEmail }
            : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const json = asObj(await response.json().catch(() => null));
      const data = json ? (asObj(json.data) ?? json) : null;

      if (!response.ok || !data) {
        const msg =
          (data && readStr(data, 'message', 'detail', 'reason')) ??
          `HIE /preauths returned HTTP ${response.status}.`;
        return {
          accepted: false,
          source: response.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          mode: cfg.mode,
          isSimulated: false,
          hiePreauthGuid: null,
          payerAuthReference: null,
          status: 'FAILED',
          doctorApproved: null,
          needsDoctorApproval: false,
          interimApprovedAmountKes: null,
          finalApprovedAmountKes: null,
          rejectionReason: msg,
          errors: [msg],
          httpStatus: response.status,
          correlationId,
        };
      }

      const guid = readStr(data, 'guid', 'id');
      const authDetails = asObj(data.authorizationDetails);
      const authCode =
        (authDetails ? readStr(authDetails, 'authCode') : null) ??
        readStr(data, 'token', 'authCode') ??
        guid;

      return {
        accepted: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: guid,
        payerAuthReference: authCode,
        status: (readStr(data, 'status') ?? 'SUBMITTED').toUpperCase(),
        doctorApproved: typeof data.doctorApproved === 'boolean' ? data.doctorApproved : null,
        needsDoctorApproval: Boolean(data.needsDoctorApproval),
        interimApprovedAmountKes: readNumMoney(data.totalInterimApprovedAmountForPreauth),
        finalApprovedAmountKes: readNumMoney(data.finalApprovedAmount),
        rejectionReason: readStr(data, 'rejectionReason', 'reason'),
        errors: [],
        httpStatus: response.status,
        correlationId,
      };
    } catch (error) {
      clearTimeout(timer);
      const msg =
        error instanceof Error
          ? `HIE preauthorization submission failed: ${error.message}`
          : 'HIE preauthorization submission failed.';
      return {
        accepted: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: null,
        payerAuthReference: null,
        status: 'TRANSPORT_ERROR',
        doctorApproved: null,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: msg,
        errors: [msg],
        httpStatus: null,
        correlationId,
      };
    }
  }

  public async queryHiePreauths(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    correlationId?: string;
  }): Promise<HiePreauthGatewayResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (cfg.mode === 'mock') {
      return {
        accepted: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        hiePreauthGuid: req.hiePreauthGuid ?? randomUUID(),
        payerAuthReference: `SIM-PA-REF-${req.consentToken.slice(-6)}`,
        status: 'SUBMITTED',
        doctorApproved: true,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: null,
        errors: [],
        httpStatus: 200,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        accepted: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: req.hiePreauthGuid ?? null,
        payerAuthReference: null,
        status: 'UNAVAILABLE',
        doctorApproved: null,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        errors: [],
        httpStatus: null,
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const url = new URL(`${cfg.middlewareBaseUrl}${cfg.preauthsPath}`);
      url.searchParams.set('consent_token', req.consentToken);

      const res = await this.fetchGetWithBoundedRetry(
        url.toString(),
        this.buildServiceAccountHeaders(cfg, token, correlationId),
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      const raw = await res.json().catch(() => null);
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray(asObj(raw)?.results)
          ? (asObj(raw)!.results as unknown[])
          : Array.isArray(asObj(raw)?.data)
            ? (asObj(raw)!.data as unknown[])
            : raw
              ? [raw]
              : [];
      const matching =
        list
          .map((item) => asObj(item))
          .find(
            (item) => item && (!req.hiePreauthGuid || readStr(item, 'guid') === req.hiePreauthGuid),
          ) ?? asObj(list[0]);

      if (!res.ok || !matching) {
        return {
          accepted: false,
          source: res.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          mode: cfg.mode,
          isSimulated: false,
          hiePreauthGuid: req.hiePreauthGuid ?? null,
          payerAuthReference: null,
          status: 'NOT_FOUND',
          doctorApproved: null,
          needsDoctorApproval: false,
          interimApprovedAmountKes: null,
          finalApprovedAmountKes: null,
          rejectionReason: null,
          errors: [],
          httpStatus: res.status,
          correlationId,
        };
      }

      const authDetails = asObj(matching.authorizationDetails);
      return {
        accepted: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: readStr(matching, 'guid') ?? req.hiePreauthGuid ?? null,
        payerAuthReference:
          (authDetails ? readStr(authDetails, 'authCode') : null) ?? readStr(matching, 'guid'),
        status: (readStr(matching, 'status') ?? 'SUBMITTED').toUpperCase(),
        doctorApproved:
          typeof matching.doctorApproved === 'boolean' ? matching.doctorApproved : null,
        needsDoctorApproval: Boolean(matching.needsDoctorApproval),
        interimApprovedAmountKes: readNumMoney(matching.totalInterimApprovedAmountForPreauth),
        finalApprovedAmountKes: readNumMoney(matching.finalApprovedAmount),
        rejectionReason: readStr(matching, 'rejectionReason', 'reason'),
        errors: [],
        httpStatus: res.status,
        correlationId,
      };
    } catch (error) {
      return {
        accepted: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: req.hiePreauthGuid ?? null,
        payerAuthReference: null,
        status: 'UNAVAILABLE',
        doctorApproved: null,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: error instanceof Error ? error.message : 'Transport failure',
        errors: [],
        httpStatus: null,
        correlationId,
      };
    }
  }

  public async cancelHiePreauth(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    reason: string;
    correlationId?: string;
  }) {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (cfg.mode === 'mock') {
      return {
        cancelled: true,
        source: 'SANDBOX_SIMULATION' as const,
        isSimulated: true,
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        cancelled: false,
        source: 'UNAVAILABLE' as const,
        isSimulated: false,
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        correlationId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const res = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.preauthCancelPath}`, {
        method: 'POST',
        headers: this.buildServiceAccountHeaders(cfg, token, correlationId, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          consent_token: req.consentToken,
          ...(req.hiePreauthGuid ? { guid: req.hiePreauthGuid } : {}),
          reason: req.reason,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return {
        cancelled: res.ok,
        source: (res.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER') as VerificationSource,
        isSimulated: false,
        errorMessage: res.ok ? null : `HIE preauth cancellation returned HTTP ${res.status}.`,
        correlationId,
      };
    } catch (error) {
      clearTimeout(timer);
      return {
        cancelled: false,
        source: 'UNAVAILABLE' as const,
        isSimulated: false,
        errorMessage: error instanceof Error ? error.message : 'Preauth cancellation failed.',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 7: FHIR BUNDLE & HIE VIRTUAL CLAIM SUBMISSION
     ============================================================ */

  public async submitBundle(req: BundleGatewayRequest): Promise<BundleGatewayResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const started = Date.now();

    if (cfg.mode === 'mock') {
      const prefix = req.operation === 'preauthorization.submit' ? 'SIM-PREAUTH' : 'SIM-CLM';
      const simRef = `${prefix}-${req.claimUuid.slice(0, 8).toUpperCase()}`;
      const simMediatorId = `SIM-MED-${req.bundleUuid.slice(0, 8).toUpperCase()}`;

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: req.operation,
        mode: 'mock',
        httpMethod: 'POST',
        endpointPath: cfg.bundleSubmitPath,
        subjectHint: req.claimUuid.slice(0, 12),
        httpStatus: 202,
        outcome: 'ACKNOWLEDGED',
        durationMs: Date.now() - started,
      });

      return {
        accepted: true,
        outcome: 'ACKNOWLEDGED',
        mediatorId: simMediatorId,
        payerReference: simRef,
        upstreamState: 'queued',
        approvedAmountKes: null,
        rejectionReason: null,
        errors: [],
        mode: 'mock',
        source: 'SANDBOX_SIMULATION',
        isSimulated: true,
        httpStatus: 202,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.eclaimsBaseUrl) {
      return {
        accepted: false,
        outcome: 'FAILED',
        mediatorId: null,
        payerReference: null,
        upstreamState: 'config_missing',
        approvedAmountKes: null,
        rejectionReason: cfg.disabledReason ?? 'SHA AfyaLink credentials are not configured.',
        errors: [cfg.disabledReason ?? 'SHA AfyaLink credentials are not configured.'],
        mode: cfg.mode,
        source: 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: null,
        correlationId,
      };
    }

    // IMPORTANT: Never auto-retry non-idempotent POST bundle submissions on timeout/5xx.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const response = await this.fetchImpl(`${cfg.eclaimsBaseUrl}${cfg.bundleSubmitPath}`, {
        method: 'POST',
        headers: this.buildServiceAccountHeaders(cfg, token, correlationId, {
          Accept: 'application/fhir+json, application/json',
          'Content-Type': 'application/fhir+json',
          'Idempotency-Key': req.bundleUuid,
        }),
        body: JSON.stringify(req.fhirBundle),
        signal: controller.signal,
      });
      clearTimeout(timer);

      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }

      const parsed = parseShaBundleSubmissionResponse(response.status, parsedBody);

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: req.operation,
        mode: cfg.mode,
        httpMethod: 'POST',
        endpointPath: cfg.bundleSubmitPath,
        subjectHint: req.claimUuid.slice(0, 12),
        httpStatus: response.status,
        outcome: parsed.outcome,
        durationMs: Date.now() - started,
      });

      return {
        ...parsed,
        mode: cfg.mode,
        source:
          parsed.outcome === 'FAILED' && response.status >= 500
            ? 'UNAVAILABLE'
            : 'AUTHORITATIVE_PAYER',
        isSimulated: false,
        httpStatus: response.status,
        correlationId,
      };
    } catch (error) {
      clearTimeout(timer);
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const msg = isTimeout
        ? 'SHA bundle submission timed out. Check claim status before resubmitting to prevent duplicate dispatch.'
        : 'SHA AfyaLink bundle endpoint could not be reached.';

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: req.operation,
        mode: cfg.mode,
        httpMethod: 'POST',
        endpointPath: cfg.bundleSubmitPath,
        subjectHint: req.claimUuid.slice(0, 12),
        httpStatus: null,
        outcome: 'FAILED',
        errorCode: isTimeout ? 'TIMEOUT' : 'TRANSPORT_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Transport failure',
        durationMs: Date.now() - started,
      });

      return {
        accepted: false,
        outcome: 'FAILED',
        mediatorId: null,
        payerReference: null,
        upstreamState: isTimeout ? 'timeout' : 'transport_error',
        approvedAmountKes: null,
        rejectionReason: msg,
        errors: [msg],
        mode: cfg.mode,
        source: 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: null,
        correlationId,
      };
    }
  }

  /**
   * Submits an HIE v1 virtual claim (`/claims/diagnoses`, `/claims/lines`, then
   * `/claims/submit` for OPD/Emergency or `/claims/discharge` for IPD).
   */
  public async submitHieVirtualClaim(
    req: HieVirtualClaimSubmitRequest,
  ): Promise<BundleGatewayResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (cfg.mode === 'mock') {
      const simRef = `SIM-HIE-CLM-${req.consentToken.slice(-6).toUpperCase()}`;
      return {
        accepted: true,
        outcome: 'ACKNOWLEDGED',
        mediatorId: `SIM-EDI-${correlationId.slice(0, 8).toUpperCase()}`,
        payerReference: simRef,
        upstreamState: 'submitted_claim',
        approvedAmountKes: null,
        rejectionReason: null,
        errors: [],
        mode: 'mock',
        source: 'SANDBOX_SIMULATION',
        isSimulated: true,
        httpStatus: 200,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl) {
      return {
        accepted: false,
        outcome: 'FAILED',
        mediatorId: null,
        payerReference: null,
        upstreamState: 'config_missing',
        approvedAmountKes: null,
        rejectionReason: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        errors: [cfg.disabledReason ?? 'SHA HIE credentials are not configured.'],
        mode: cfg.mode,
        source: 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: null,
        correlationId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const headers = this.buildServiceAccountHeaders(cfg, token, correlationId, {
        'Content-Type': 'application/json',
      });

      const practitionerFields =
        req.practitionerRegNumber && req.practitionerRegulator
          ? {
              practitioner_identification_type: 'registration_number',
              practitioner_identification_number: req.practitionerRegNumber,
              practitioner_regulation_body: req.practitionerRegulator,
            }
          : {};

      for (const diag of req.diagnoses) {
        const dRes = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.claimDiagnosesPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            consent_token: req.consentToken,
            icd_code: diag.icdCode,
            intervention_code: diag.interventionCode,
            ...practitionerFields,
          }),
          signal: controller.signal,
        });
        if (!dRes.ok) {
          clearTimeout(timer);
          return {
            accepted: false,
            outcome: 'FAILED',
            mediatorId: null,
            payerReference: null,
            upstreamState: `diagnosis_http_${dRes.status}`,
            approvedAmountKes: null,
            rejectionReason: `HIE /claims/diagnoses rejected diagnosis ${diag.icdCode} (HTTP ${dRes.status}).`,
            errors: [`HIE /claims/diagnoses failed with HTTP ${dRes.status}.`],
            mode: cfg.mode,
            source: dRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
            isSimulated: false,
            httpStatus: dRes.status,
            correlationId,
          };
        }
      }

      for (const line of req.lines) {
        const lRes = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.claimLinesPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            consent_token: req.consentToken,
            intervention_code: line.interventionCode,
            unit_price: line.unitPriceKes,
            quantity: String(line.quantity),
            service_name: line.serviceName,
            ...(line.serviceIdentifier ? { service_identifier: line.serviceIdentifier } : {}),
            ...practitionerFields,
          }),
          signal: controller.signal,
        });
        if (!lRes.ok) {
          clearTimeout(timer);
          return {
            accepted: false,
            outcome: 'FAILED',
            mediatorId: null,
            payerReference: null,
            upstreamState: `line_http_${lRes.status}`,
            approvedAmountKes: null,
            rejectionReason: `HIE /claims/lines rejected item ${line.interventionCode} (HTTP ${lRes.status}).`,
            errors: [`HIE /claims/lines failed with HTTP ${lRes.status}.`],
            mode: cfg.mode,
            source: lRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
            isSimulated: false,
            httpStatus: lRes.status,
            correlationId,
          };
        }
      }

      // Per HIE spec: Outpatient/Emergency uses POST /claims/submit (DECEASED invalid on OP);
      // Inpatient uses POST /claims/discharge.
      const isInpatient = req.subType === 'ip';
      const dispatchPath = isInpatient ? cfg.claimDischargePath : cfg.claimSubmitPath;
      const opDischargeReason =
        req.dischargeReason === 'DECEASED' && !isInpatient ? 'OTHER' : req.dischargeReason;

      const dispatchBody = isInpatient
        ? {
            consent_token: req.consentToken,
            discharge_reason: req.dischargeReason,
            invoice_number: req.invoiceNumber,
            ...(req.dischargeDate ? { discharge_date: req.dischargeDate } : {}),
            ...(req.otp ? { otp: req.otp } : {}),
            ...(req.dischargeAuthGuid ? { discharge_auth_guid: req.dischargeAuthGuid } : {}),
          }
        : {
            consent_token: req.consentToken,
            invoice_number: req.invoiceNumber,
            discharge_reason: opDischargeReason,
            discharge_status: 'FULL',
            ...(req.notes ? { notes: req.notes } : {}),
            ...(req.otp ? { otp: req.otp } : {}),
            ...(req.dischargeAuthGuid ? { discharge_auth_guid: req.dischargeAuthGuid } : {}),
          };

      const dispatchRes = await this.fetchImpl(`${cfg.middlewareBaseUrl}${dispatchPath}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Idempotency-Key': correlationId,
        },
        body: JSON.stringify(dispatchBody),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const parsedBody = await dispatchRes.json().catch(() => null);
      const parsed = parseShaBundleSubmissionResponse(dispatchRes.status, parsedBody);

      return {
        ...parsed,
        mode: cfg.mode,
        source:
          parsed.outcome === 'FAILED' && dispatchRes.status >= 500
            ? 'UNAVAILABLE'
            : 'AUTHORITATIVE_PAYER',
        isSimulated: false,
        httpStatus: dispatchRes.status,
        correlationId,
      };
    } catch (error) {
      clearTimeout(timer);
      const msg =
        error instanceof Error
          ? `HIE virtual claim dispatch failed: ${error.message}`
          : 'HIE virtual claim dispatch failed.';
      return {
        accepted: false,
        outcome: 'FAILED',
        mediatorId: null,
        payerReference: null,
        upstreamState: 'transport_error',
        approvedAmountKes: null,
        rejectionReason: msg,
        errors: [msg],
        mode: cfg.mode,
        source: 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: null,
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 8: CLAIM STATUS POLLING & CALLBACK REGISTRATION
     ============================================================ */

  public async queryClaimStatus(req: ClaimStatusGatewayRequest): Promise<ClaimStatusGatewayResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const started = Date.now();

    if (cfg.mode === 'mock') {
      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'claims.status',
        mode: 'mock',
        httpMethod: 'GET',
        endpointPath: cfg.claimStatusPath,
        subjectHint: req.claimUuid.slice(0, 12),
        httpStatus: 200,
        outcome: 'ACKNOWLEDGED',
        durationMs: Date.now() - started,
      });

      return {
        recognized: true,
        mappedStatus: 'ACKNOWLEDGED',
        upstreamState: 'in-review',
        payerClaimReference:
          req.payerClaimReference ?? `SIM-CLM-${req.claimUuid.slice(0, 8).toUpperCase()}`,
        approvedAmountKes: null,
        paidAmountKes: null,
        rejectionReason: null,
        mode: 'mock',
        source: 'SANDBOX_SIMULATION',
        isSimulated: true,
        httpStatus: 200,
        correlationId,
        errorMessage: null,
      };
    }

    if (!cfg.enabled || !cfg.eclaimsBaseUrl) {
      return {
        recognized: false,
        mappedStatus: null,
        upstreamState: 'config_missing',
        payerClaimReference: req.payerClaimReference ?? null,
        approvedAmountKes: null,
        paidAmountKes: null,
        rejectionReason: null,
        mode: cfg.mode,
        source: 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: null,
        correlationId,
        errorMessage: cfg.disabledReason ?? 'SHA AfyaLink credentials are not configured.',
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const url = new URL(`${cfg.eclaimsBaseUrl}${cfg.claimStatusPath}`);
      url.searchParams.set('claim_id', req.payerClaimReference ?? req.claimUuid);

      const response = await this.fetchGetWithBoundedRetry(
        url.toString(),
        this.buildServiceAccountHeaders(cfg, token, correlationId, {
          Accept: 'application/fhir+json, application/json',
        }),
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }

      const parsed = parseShaClaimStatusResponse(response.status, parsedBody);

      await this.logGatewayCall({
        tenantId: req.tenantId,
        facilityId: req.facilityId,
        actorUserId: req.actorUserId,
        correlationId,
        operation: 'claims.status',
        mode: cfg.mode,
        httpMethod: 'GET',
        endpointPath: cfg.claimStatusPath,
        subjectHint: req.claimUuid.slice(0, 12),
        httpStatus: response.status,
        outcome: parsed.mappedStatus ?? 'UNRECOGNIZED',
        durationMs: Date.now() - started,
      });

      return {
        ...parsed,
        mode: cfg.mode,
        source: parsed.recognized ? 'AUTHORITATIVE_PAYER' : 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: response.status,
        correlationId,
        errorMessage: parsed.recognized
          ? null
          : `SHA claim-status endpoint returned HTTP ${response.status} without a recognized adjudication state.`,
      };
    } catch (error) {
      return {
        recognized: false,
        mappedStatus: null,
        upstreamState: 'transport_error',
        payerClaimReference: req.payerClaimReference ?? null,
        approvedAmountKes: null,
        paidAmountKes: null,
        rejectionReason: null,
        mode: cfg.mode,
        source: 'UNAVAILABLE',
        isSimulated: false,
        httpStatus: null,
        correlationId,
        errorMessage:
          error instanceof Error
            ? `Unable to query SHA claim status: ${error.message}`
            : 'Unable to query SHA claim status.',
      };
    }
  }

  /**
   * Registers an HIE status callback endpoint (`POST /tenants/{tenant_id}/endpoints`
   * + `POST /tenants/{tenant_id}/endpoints/{endpoint_id}/operations`).
   * Per official HIE spec, only `environment: 'sandbox' | 'production'` is accepted (`'prod'` is rejected).
   */
  public async registerCallbackEndpoint(
    req: RegisterHieCallbackEndpointRequest,
  ): Promise<RegisterHieCallbackEndpointResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (req.environment !== 'sandbox' && req.environment !== 'production') {
      return {
        registered: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        endpointId: null,
        operationId: null,
        errorMessage:
          'Invalid callback environment; DHA HIE accepts only "sandbox" or "production" ("prod" is rejected).',
        correlationId,
      };
    }

    if (!req.baseUrl.startsWith('https://')) {
      return {
        registered: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        endpointId: null,
        operationId: null,
        errorMessage: 'Callback base_url must use https://.',
        correlationId,
      };
    }

    if (cfg.mode === 'mock') {
      return {
        registered: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        endpointId: randomUUID(),
        operationId: randomUUID(),
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl || !cfg.facilityRegistryCode) {
      return {
        registered: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        endpointId: null,
        operationId: null,
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
        correlationId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const headers = this.buildServiceAccountHeaders(cfg, token, correlationId, {
        'Content-Type': 'application/json',
      });
      const epPath = cfg.callbackEndpointsPathTemplate.replace(
        '{tenant_id}',
        encodeURIComponent(cfg.facilityRegistryCode),
      );

      const authType = req.authType ?? 'none';
      const epRes = await this.fetchImpl(`${cfg.middlewareBaseUrl}${epPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: `JaliCare ${req.entityType} status callbacks`,
          entity_type: req.entityType,
          environment: req.environment,
          base_url: req.baseUrl,
          facility_fr_code: cfg.facilityRegistryCode,
          auth_type: authType,
          ...(authType !== 'none' && req.secretRef ? { secret_ref: req.secretRef } : {}),
        }),
        signal: controller.signal,
      });

      const epJson = asObj(await epRes.json().catch(() => null));
      const endpointId = epJson ? readStr(epJson, 'endpoint_id') : null;
      if (!epRes.ok || !endpointId) {
        clearTimeout(timer);
        return {
          registered: false,
          source: epRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          mode: cfg.mode,
          isSimulated: false,
          endpointId: null,
          operationId: null,
          errorMessage: `HIE callback endpoint registration returned HTTP ${epRes.status}.`,
          correlationId,
        };
      }

      const opRes = await this.fetchImpl(
        `${cfg.middlewareBaseUrl}${epPath}/${encodeURIComponent(endpointId)}/operations`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: `${req.entityType} status_changed`,
            action: 'status_changed',
            method: 'POST',
            path: req.callbackPath.startsWith('/') ? req.callbackPath : `/${req.callbackPath}`,
            request_content_type: 'application/json',
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);
      const opJson = asObj(await opRes.json().catch(() => null));
      const operationId = opJson ? readStr(opJson, 'operation_id') : null;

      return {
        registered: opRes.ok,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        endpointId,
        operationId,
        errorMessage: opRes.ok
          ? null
          : `HIE callback operation registration returned HTTP ${opRes.status}.`,
        correlationId,
      };
    } catch (error) {
      clearTimeout(timer);
      return {
        registered: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        endpointId: null,
        operationId: null,
        errorMessage: error instanceof Error ? error.message : 'Callback registration failed.',
        correlationId,
      };
    }
  }

  /* ============================================================
     WORKFLOW 9: TWO-STEP HIE REMITTANCE RECONCILIATION
     Step 1: Get Remittances (facility_id + facility_id_type) -> bank_reference
     Step 2: Get Claims Paid by Remittance (facility_id + facility_id_type + bank_reference)
     ============================================================ */

  public async fetchFacilityRemittances(
    req: HieRemittancesQueryRequest,
  ): Promise<HieRemittancesQueryResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();

    if (cfg.mode === 'mock') {
      const today = new Date().toISOString().slice(0, 10);
      return {
        reachable: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        remittances: [
          {
            bankReference: 'SIM-BANK-REF-2026-001',
            remittanceReference: 'SIM-SHA-REM-2026-001',
            paymentDate: today,
            totalAmountKes: '25000.00',
            paymentChannel: 'EFT',
            claimCount: 2,
          },
        ],
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl || !cfg.facilityRegistryCode) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        remittances: [],
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials or facility FR code missing.',
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const url = new URL(`${cfg.middlewareBaseUrl}${cfg.remittancesPath}`);
      url.searchParams.set('facility_id', cfg.facilityRegistryCode);
      url.searchParams.set('facility_id_type', cfg.facilityIdType);
      if (req.fromDate) url.searchParams.set('from_date', req.fromDate);
      if (req.toDate) url.searchParams.set('to_date', req.toDate);

      const res = await this.fetchGetWithBoundedRetry(
        url.toString(),
        this.buildServiceAccountHeaders(cfg, token, correlationId),
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      if (!res.ok) {
        return {
          reachable: false,
          source: 'UNAVAILABLE',
          mode: cfg.mode,
          isSimulated: false,
          remittances: [],
          errorMessage: `HIE Get Remittances returned HTTP ${res.status}.`,
          correlationId,
        };
      }

      const raw = await res.json().catch(() => null);
      const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(asObj(raw)?.results)
          ? (asObj(raw)!.results as unknown[])
          : Array.isArray(asObj(raw)?.data)
            ? (asObj(raw)!.data as unknown[])
            : [];

      const remittances: HieRemittanceSummaryItem[] = rows
        .map((r) => asObj(r))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => {
          const bankRef = readStr(r, 'bank_reference', 'bankReference', 'reference') ?? '';
          return {
            bankReference: bankRef,
            remittanceReference:
              readStr(r, 'remittance_reference', 'remittanceReference', 'id') ?? bankRef,
            paymentDate:
              normalizeIsoDate(readStr(r, 'payment_date', 'paymentDate', 'created_at')) ??
              new Date().toISOString().slice(0, 10),
            totalAmountKes: readNumMoney(r.total_amount ?? r.totalAmount ?? r.amount) ?? '0.00',
            paymentChannel: readStr(r, 'payment_channel', 'paymentChannel') ?? 'EFT',
            claimCount: typeof r.claim_count === 'number' ? r.claim_count : null,
          };
        })
        .filter((r) => r.bankReference.length > 0);

      return {
        reachable: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        remittances,
        errorMessage: null,
        correlationId,
      };
    } catch (error) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        remittances: [],
        errorMessage: error instanceof Error ? error.message : 'Unable to query HIE remittances.',
        correlationId,
      };
    }
  }

  public async fetchClaimsPaidByRemittance(
    req: HieRemittanceClaimsQueryRequest,
  ): Promise<HieRemittanceClaimsQueryResult> {
    const cfg = this.resolveConfig(req.facilityRegistryOverride);
    const correlationId = req.correlationId ?? randomUUID();
    const bankRef = req.bankReference.trim();

    if (cfg.mode === 'mock') {
      return {
        reachable: true,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        bankReference: bankRef,
        claims: [
          {
            payerClaimReference: 'SIM-CLM-0001',
            claimNumber: null,
            invoiceNumber: null,
            claimedAmountKes: '15000.00',
            approvedAmountKes: '15000.00',
            paidAmountKes: '15000.00',
            paymentStatus: 'PAID',
          },
          {
            payerClaimReference: 'SIM-CLM-0002',
            claimNumber: null,
            invoiceNumber: null,
            claimedAmountKes: '12000.00',
            approvedAmountKes: '10000.00',
            paidAmountKes: '10000.00',
            paymentStatus: 'PARTIALLY_PAID',
          },
        ],
        errorMessage: null,
        correlationId,
      };
    }

    if (!cfg.enabled || !cfg.middlewareBaseUrl || !cfg.facilityRegistryCode) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        bankReference: bankRef,
        claims: [],
        errorMessage: cfg.disabledReason ?? 'SHA HIE credentials or facility FR code missing.',
        correlationId,
      };
    }

    try {
      const token = await this.obtainAccessToken(cfg, correlationId);
      const url = new URL(`${cfg.middlewareBaseUrl}${cfg.remittanceClaimsPath}`);
      url.searchParams.set('facility_id', cfg.facilityRegistryCode);
      url.searchParams.set('facility_id_type', cfg.facilityIdType);
      url.searchParams.set('bank_reference', bankRef);

      const res = await this.fetchGetWithBoundedRetry(
        url.toString(),
        this.buildServiceAccountHeaders(cfg, token, correlationId),
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );

      if (!res.ok) {
        return {
          reachable: false,
          source: 'UNAVAILABLE',
          mode: cfg.mode,
          isSimulated: false,
          bankReference: bankRef,
          claims: [],
          errorMessage: `HIE Get Claims Paid by Remittance returned HTTP ${res.status}.`,
          correlationId,
        };
      }

      const raw = await res.json().catch(() => null);
      const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(asObj(raw)?.results)
          ? (asObj(raw)!.results as unknown[])
          : Array.isArray(asObj(raw)?.data)
            ? (asObj(raw)!.data as unknown[])
            : Array.isArray(asObj(raw)?.claims)
              ? (asObj(raw)!.claims as unknown[])
              : [];

      const claims: HieRemittanceClaimLine[] = rows
        .map((r) => asObj(r))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => {
          const paid = readNumMoney(r.payment_amount ?? r.paid_amount ?? r.paidAmount) ?? '0.00';
          const rawStat = (
            readStr(r, 'payment_status', 'paymentStatus', 'status') ?? 'PAID'
          ).toUpperCase();
          const paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' = rawStat.includes('PARTIAL')
            ? 'PARTIALLY_PAID'
            : rawStat.includes('UNPAID') || Number(paid) <= 0
              ? 'UNPAID'
              : 'PAID';
          return {
            payerClaimReference:
              readStr(r, 'claim_id', 'payer_claim_id', 'edi_claim_guid', 'reference') ?? '',
            claimNumber: readStr(r, 'claim_number', 'provider_claim_number'),
            invoiceNumber: readStr(r, 'invoice_number', 'invoiceNumber'),
            claimedAmountKes: readNumMoney(r.claimed_amount ?? r.claimedAmount),
            approvedAmountKes: readNumMoney(r.approved_amount ?? r.approvedAmount),
            paidAmountKes: paid,
            paymentStatus,
          };
        })
        .filter((c) => c.payerClaimReference.length > 0);

      return {
        reachable: true,
        source: 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        bankReference: bankRef,
        claims,
        errorMessage: null,
        correlationId,
      };
    } catch (error) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        bankReference: bankRef,
        claims: [],
        errorMessage:
          error instanceof Error ? error.message : 'Unable to query claims paid by remittance.',
        correlationId,
      };
    }
  }
}

export const defaultShaGatewayAdapter = new ShaGatewayAdapter();
