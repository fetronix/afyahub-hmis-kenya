/** Public SHA gateway contracts, re-exported by sha.adapter.ts. */
import type { ShaEnvironmentMode } from './sha.config.ts';

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
