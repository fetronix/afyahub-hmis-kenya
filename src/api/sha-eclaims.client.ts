/**
 * JaliCare HMIS
 * Typed Frontend Client for SHA eClaims, Eligibility, Benefits, Preauthorization & Remittance
 *
 * Uses relative `/api/insurance/sha/...` paths and the authenticated Bearer
 * session token from `src/api/client.ts`.
 */

import { getSessionToken } from './client.ts';

export interface ShaCapabilityItem {
  operation: string;
  protocol: string;
  documentedPath: string;
  status: 'SIMULATED' | 'READY' | 'CONFIG_REQUIRED' | 'CALLBACK_OR_MANUAL';
  notes: string;
}

export interface ShaConnectionStatusResponse {
  success: boolean;
  connection: {
    payerCode: 'SHA';
    payerName: string;
    mode: 'mock' | 'sandbox' | 'production';
    isSimulated: boolean;
    enabled: boolean;
    disabledReason: string | null;
    middlewareBaseUrl: string | null;
    eclaimsBaseUrl: string | null;
    fhirIgBaseUrl?: string | null;
    hasClientId: boolean;
    hasClientSecret: boolean;
    facilityRegistryCode: string | null;
    facilityIdType?: string;
    hasWebhookSecret: boolean;
    timeoutMs: number;
    maxGetRetries: number;
    missingSettings: string[];
    fhirIgDraftNotice?: string;
    capabilities: ShaCapabilityItem[];
    checkedAt: string;
  };
  facilityConfig: {
    facilityId: number;
    facilityName: string;
    facilityLevel: string | null;
    facilityRegistryCode: string | null;
    contractedSchemes: string[];
    defaultCodingSystem: string;
    requireVerifiedEligibility: boolean;
    eligibilityMaxAgeHours: number;
  };
}

export interface ShaEligibilityRecord {
  id: number;
  facilityId: number;
  patientId: number;
  patientName?: string;
  patientMrn?: string;
  encounterId: number | null;
  payerCode: string;
  identificationType: string;
  identificationHint: string;
  intendedServiceArea: string | null;
  outcome: 'Eligible' | 'Ineligible' | 'Pending' | 'Unable to verify' | 'Manual review required';
  source: string;
  isSimulated: boolean;
  payerReference: string | null;
  memberCrNumber: string | null;
  memberStatus: string | null;
  isAlive?: boolean | null;
  facilityBiometricsEnforced?: boolean | null;
  whitelistedForOtp?: boolean | null;
  schemes: string[];
  schemeDetails?: Array<{
    schemeCode: string;
    schemeName: string;
    memberType: string | null;
    coverageStatus: string;
    isPomsf: boolean;
  }>;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  restrictions: string[];
  reason: string | null;
  possibleSolution: string | null;
  responseClassification: string;
  correlationId: string | null;
  checkedAt: string;
}

export interface ShaBenefitValidationRecord {
  id: number;
  patientId: number;
  encounterId: number | null;
  eligibilityVerificationId: number | null;
  tariffId: number | null;
  mappingId: number | null;
  benefitRuleId: number | null;
  ruleVersion: number | null;
  serviceDescription: string;
  serviceCategory: string;
  payerServiceCode: string | null;
  benefitPackage: string | null;
  serviceDate: string;
  quantity: number;
  facilityTariffAmount: string;
  payerTariffAmount: string | null;
  estimatedCopayAmount: string;
  estimatedCoveredAmount: string | null;
  decision:
    | 'COVERED'
    | 'NOT_COVERED'
    | 'AUTHORIZATION_REQUIRED'
    | 'INCOMPLETE_INFORMATION'
    | 'UNABLE_TO_VERIFY';
  verificationSource: string;
  isSimulated: boolean;
  requiresPreauth: boolean;
  preauthReference: string | null;
  hasReferral: boolean;
  hasClinicalNotes: boolean;
  missingRequirements: string[];
  reason: string;
  validatedAt: string;
}

export interface ShaAuthorizationRecord {
  id: number;
  patientId: number;
  encounterId: number | null;
  memberCrNumber: string;
  serviceType: string;
  consentMethod: string;
  authorizationGuid: string | null;
  hasConsentToken: boolean;
  hasAuthCode: boolean;
  authStatus: string;
  isElective: boolean;
  interventions: string[];
  selectedPomsfScheme: string | null;
  virtualClaimId: string | null;
  practitionerRegNumber: string | null;
  practitionerRegulator: string | null;
  source: string;
  isSimulated: boolean;
  createdAt: string;
}

export interface ShaPreauthRecord {
  id: number;
  patientId: number;
  patientName?: string;
  patientMrn?: string;
  encounterId: number | null;
  authorizationId?: number | null;
  hasConsentToken: boolean;
  hiePreauthGuid?: string | null;
  isElective?: boolean;
  needsDoctorAuthorization?: boolean;
  doctorApproved?: boolean | null;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: string | null;
  interimApprovedAmount?: string | null;
  preauthNumber: string;
  externalBundleId: string;
  payerAuthReference: string | null;
  mediatorId: string | null;
  category: string;
  status:
    'DRAFT' | 'PENDING' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  source: string;
  isSimulated: boolean;
  clinicalIndication: string;
  primaryDiagnosisCode: string;
  primaryDiagnosisDisplay: string;
  codingSystem: string;
  requestedServiceCode: string;
  requestedServiceName: string;
  quantity: number;
  estimatedAmount: string;
  approvedAmount: string | null;
  conditions: string | null;
  validFrom: string | null;
  validUntil: string | null;
  supportingNotes: string | null;
  rejectionReason: string | null;
  amendmentCount: number;
  lastAmendmentReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ShaEclaimItemRecord {
  id: number;
  eclaimId: number;
  billingItemId: number | null;
  tariffId: number | null;
  sequence: number;
  localCode: string | null;
  description: string;
  serviceArea: string | null;
  payerServiceCode: string | null;
  payerServiceName: string | null;
  fund: string;
  paymentMechanism: string;
  servicedStart: string;
  servicedEnd: string;
  quantity: number;
  facilityUnitPrice: string;
  claimedUnitPrice: string;
  claimedNetAmount: string;
  approvedAmount: string | null;
  rejectionReason: string | null;
  preauthReference: string | null;
}

export interface ShaEclaimSubmissionRecord {
  id: number;
  attemptNumber: number;
  operation: string;
  bundleUuid: string;
  environmentMode: string;
  isSimulated: boolean;
  requestCorrelationId: string;
  httpStatus: number | null;
  outcome: string;
  mediatorId: string | null;
  payerClaimId: string | null;
  upstreamState: string | null;
  rejectionReason: string | null;
  submittedAt: string;
}

export interface ShaEclaimHistoryRecord {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  source: string;
  reason: string | null;
  createdAt: string;
}

export interface ShaEclaimRecord {
  dispatchReview?: { state: string; createdAt: string } | null;
  id: number;
  patientId: number;
  patientName?: string;
  patientMrn?: string;
  encounterId: number | null;
  invoiceId: number;
  invoiceNumber?: string;
  invoiceStatus?: string;
  eligibilityVerificationId: number | null;
  preauthorizationId: number | null;
  authorizationId?: number | null;
  hasConsentToken?: boolean;
  submissionProtocol?: 'FHIR_BUNDLE' | 'HIE_VIRTUAL_CLAIM';
  hieVirtualClaimId?: string | null;
  dischargeReason?: string | null;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: string | null;
  payerCode: string;
  schemeCode: string;
  claimNumber: string;
  claimUuid: string;
  claimType: string;
  subType: string;
  status:
    | 'DRAFT'
    | 'VALIDATION_FAILED'
    | 'READY_FOR_SUBMISSION'
    | 'SUBMITTED'
    | 'ACKNOWLEDGED'
    | 'REJECTED'
    | 'PARTIALLY_ADJUDICATED'
    | 'ADJUDICATED'
    | 'PAID'
    | 'DISPUTED'
    | 'CANCELLED';
  environmentMode: string;
  isSimulated: boolean;
  billableStart: string;
  billableEnd: string;
  totalBilledAmount: string;
  totalClaimedAmount: string;
  totalApprovedAmount: string;
  totalPaidAmount: string;
  patientCopayAmount: string;
  isPhcClaim: boolean;
  diagnosesSnapshot: Array<{ code: string; display: string; system: string; type: string }>;
  supportingSummary: Record<string, unknown>;
  validationIssues: Array<{
    code: string;
    severity: 'ERROR' | 'WARNING';
    field?: string;
    message: string;
  }>;
  payerClaimReference: string | null;
  mediatorId: string | null;
  rejectionReason: string | null;
  submissionCount: number;
  previousSubmissionRef: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  adjudicatedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ShaEclaimItemRecord[];
  submissions?: ShaEclaimSubmissionRecord[];
  statusHistory?: ShaEclaimHistoryRecord[];
}

export type ShaEclaimSummary = Omit<ShaEclaimRecord, 'diagnosesSnapshot' | 'supportingSummary'>;

export interface ShaRemittanceRecord {
  id: number;
  remittanceNumber: string;
  payerRemittanceRef: string;
  bankReference?: string | null;
  facilityIdType?: string;
  isSimulated?: boolean;
  paymentDate: string;
  paymentChannel: string;
  totalRemittedAmount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  status: 'RECEIVED' | 'PARTIALLY_RECONCILED' | 'RECONCILED' | 'DISPUTED';
  source: string;
  notes: string | null;
  createdAt: string;
  entries: Array<{
    id: number;
    eclaimId: number;
    claimNumber: string;
    invoiceId: number;
    invoiceNumber: string;
    claimedAmount: string;
    approvedAmount: string;
    remittedAmount: string;
    appliedToInvoiceAmount: string;
    varianceAmount: string;
    varianceReason: string | null;
    reconciliationStatus: string;
    postedPaymentId: number | null;
    reconciledAt: string;
  }>;
}

export interface ShaServiceMappingRecord {
  id: number;
  tariffId: number | null;
  localCode: string;
  localDescription: string;
  serviceArea: string;
  payerServiceCode: string;
  payerServiceName: string;
  fund: string;
  accessPoint: string;
  paymentMechanism: string;
  reimbursementTariff: string | null;
  isPhcZeroTariff: boolean;
  requiresPreauth: boolean;
  preauthCategory: string | null;
  requiresReferral: boolean;
  requiresClinicalNotes: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface ShaBenefitRuleRecord {
  id: number;
  ruleCode: string;
  version: number;
  benefitPackage: string;
  serviceCategory: string;
  payerServiceCode: string | null;
  minFacilityLevel: string | null;
  requiresPreauth: boolean;
  requiresReferral: boolean;
  requiredEvidence: string[];
  copayType: string;
  copayValue: string;
  annualLimit: string | null;
  perVisitLimit: string | null;
  exclusionNotes: string | null;
  sourceReference: string;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedAt: string | null;
}

async function shaRequest<T>(
  path: string,
  facilityId?: number | null,
  options: RequestInit = {},
): Promise<T> {
  const token = getSessionToken();
  const sep = path.includes('?') ? '&' : '?';
  const scopedPath =
    facilityId && (!options.method || options.method === 'GET')
      ? `${path}${sep}facilityId=${encodeURIComponent(String(facilityId))}`
      : path;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let bodyStr = options.body;
  if (
    facilityId &&
    options.method &&
    options.method !== 'GET' &&
    typeof options.body === 'string'
  ) {
    try {
      const parsed = JSON.parse(options.body) as Record<string, unknown>;
      if (parsed.facilityId === undefined) {
        bodyStr = JSON.stringify({ ...parsed, facilityId });
      }
    } catch {
      bodyStr = options.body;
    }
  }

  const res = await fetch(`/api/insurance/sha${scopedPath}`, {
    ...options,
    headers,
    body: bodyStr,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof payload?.message === 'string'
        ? payload.message
        : `SHA request failed with status ${res.status}`;
    throw new Error(msg);
  }
  return payload as T;
}

export const shaEclaimsApi = {
  getConnectionStatus: (facilityId?: number | null) =>
    shaRequest<ShaConnectionStatusResponse>('/connection-status', facilityId),

  updateConfiguration: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; config: Record<string, unknown> }>(
      '/configuration',
      facilityId,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  listRecentEligibility: (facilityId?: number | null) =>
    shaRequest<{ success: boolean; verifications: ShaEligibilityRecord[] }>(
      '/eligibility',
      facilityId,
    ),

  checkEligibility: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{
      success: boolean;
      verification: ShaEligibilityRecord;
      patient: { id: number; mrn: string; fullName: string; dhaClientRegistryId?: string | null };
    }>('/eligibility/check', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  searchClientRegistryPatient: (
    facilityId: number | null | undefined,
    body: Record<string, unknown>,
  ) =>
    shaRequest<{
      success: boolean;
      registry: {
        found: boolean;
        crId: string | null;
        fullName: string | null;
        gender: string | null;
        birthDate: string | null;
        isAlive: boolean | null;
        source: string;
        isSimulated: boolean;
        errorMessage: string | null;
      };
      patient: { id: number; mrn: string; fullName: string; dhaClientRegistryId: string | null };
    }>('/registry/patient-search', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  lookupHieBenefitsAndUtilization: (
    facilityId: number | null | undefined,
    body: Record<string, unknown>,
  ) =>
    shaRequest<{
      success: boolean;
      memberCrNumber: string;
      coverage: {
        reachable: boolean;
        isSimulated: boolean;
        benefits: Array<{ code: string; name: string; fund: string; status: string }>;
        subBenefits: Array<{ code: string; name: string; parentCode: string }>;
        interventions: Array<{
          code: string;
          name: string;
          fund: string;
          paymentMechanism: string;
          overallTariff: string | null;
          needsPreauth: boolean;
          needsManualPreauthApproval: boolean;
          needsDoctorAuthorization: boolean;
          specialistFlags: Record<string, boolean>;
        }>;
      } | null;
      utilization: {
        reachable: boolean;
        isSimulated: boolean;
        utilization: Array<{
          code: string;
          limitScope: string;
          individualMaxLimitKes: string | null;
          individualUtilisedLimitKes: string | null;
          individualRemainingLimitKes: string | null;
          householdMaxLimitKes: string | null;
          householdUtilisedLimitKes: string | null;
          householdRemainingLimitKes: string | null;
          nextAvailability: string | null;
        }>;
        pomsfBalances: Array<{
          schemeCode: string;
          policyYear: string;
          remainingBalanceKes: string;
        }>;
        bedOccupancy: {
          totalBeds: number;
          occupiedBeds: number;
          availableBeds: number;
        } | null;
      } | null;
    }>('/benefits/hie-lookup', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listAuthorizations: (facilityId?: number | null, patientId?: number) =>
    shaRequest<{ success: boolean; authorizations: ShaAuthorizationRecord[] }>(
      patientId ? `/authorizations?patientId=${patientId}` : '/authorizations',
      facilityId,
    ),

  authorizeVisitConsent: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; authorization: ShaAuthorizationRecord }>(
      '/authorizations/consent',
      facilityId,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getPatientEligibilityHistory: (patientId: number, facilityId?: number | null) =>
    shaRequest<{
      success: boolean;
      patient: { id: number; mrn: string; fullName: string };
      history: ShaEligibilityRecord[];
    }>(`/patients/${patientId}/eligibility-history`, facilityId),

  validateBenefits: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{
      success: boolean;
      validation: ShaBenefitValidationRecord;
      advisoryDisclaimer: string;
    }>('/benefits/validate', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getPatientBenefits: (patientId: number, facilityId?: number | null) =>
    shaRequest<{
      success: boolean;
      patient: { id: number; mrn: string; fullName: string };
      facilityContractedSchemes: string[];
      facilityAccreditationLevel: string | null;
      latestEligibility: ShaEligibilityRecord | null;
      approvedBenefitRulesCount: number;
      recentValidations: ShaBenefitValidationRecord[];
    }>(`/patients/${patientId}/benefits`, facilityId),

  listPreauthorizations: (facilityId?: number | null) =>
    shaRequest<{ success: boolean; preauthorizations: ShaPreauthRecord[] }>(
      '/preauthorizations',
      facilityId,
    ),

  createPreauthorization: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; preauthorization: ShaPreauthRecord }>(
      '/preauthorizations',
      facilityId,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  updatePreauthorization: (
    id: number,
    facilityId: number | null | undefined,
    body: Record<string, unknown>,
  ) =>
    shaRequest<{ success: boolean; preauthorization: ShaPreauthRecord }>(
      `/preauthorizations/${id}`,
      facilityId,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  submitPreauthorization: (
    id: number,
    facilityId?: number | null,
    options?: { protocol?: 'FHIR_BUNDLE' | 'HIE_PREAUTH' },
  ) =>
    shaRequest<{
      success: boolean;
      preauthorization: ShaPreauthRecord;
      gateway: { mode: string; isSimulated: boolean; correlationId: string };
    }>(`/preauthorizations/${id}/submit`, facilityId, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),

  refreshPreauthorizationStatus: (id: number, facilityId?: number | null) =>
    shaRequest<{ success: boolean; preauthorization: ShaPreauthRecord }>(
      `/preauthorizations/${id}/status`,
      facilityId,
    ),

  cancelPreauthorization: (id: number, facilityId: number | null | undefined, reason: string) =>
    shaRequest<{ success: boolean; preauthorization: ShaPreauthRecord }>(
      `/preauthorizations/${id}/cancel`,
      facilityId,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  listClaims: (facilityId?: number | null, status?: string) =>
    shaRequest<{ success: boolean; claims: ShaEclaimSummary[] }>(
      status ? `/claims?status=${encodeURIComponent(status)}` : '/claims',
      facilityId,
    ),

  getClaimDetail: (claimId: number, facilityId?: number | null) =>
    shaRequest<{ success: boolean; claim: ShaEclaimRecord }>(`/claims/${claimId}`, facilityId),

  prepareClaim: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; claim: ShaEclaimRecord }>('/claims/prepare', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  validateClaim: (claimId: number, facilityId?: number | null) =>
    shaRequest<{ success: boolean; claim: ShaEclaimRecord }>(
      `/claims/${claimId}/validate`,
      facilityId,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  submitClaim: (claimId: number, facilityId?: number | null) =>
    shaRequest<{ success: boolean; claim: ShaEclaimRecord }>(
      `/claims/${claimId}/submit`,
      facilityId,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  resubmitClaim: (
    claimId: number,
    facilityId: number | null | undefined,
    body: Record<string, unknown>,
  ) =>
    shaRequest<{ success: boolean; claim: ShaEclaimRecord }>(
      `/claims/${claimId}/resubmit`,
      facilityId,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  refreshClaimStatus: (claimId: number, facilityId?: number | null) =>
    shaRequest<{
      success: boolean;
      claim: ShaEclaimRecord;
      gatewayStatus: {
        checked: boolean;
        recognized?: boolean;
        upstreamState?: string | null;
        isSimulated?: boolean;
        errorMessage?: string | null;
      };
    }>(`/claims/${claimId}/status`, facilityId),

  adjudicateClaim: (
    claimId: number,
    facilityId: number | null | undefined,
    body: Record<string, unknown>,
  ) =>
    shaRequest<{ success: boolean; claim: ShaEclaimRecord }>(
      `/claims/${claimId}/adjudicate`,
      facilityId,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listRemittances: (facilityId?: number | null) =>
    shaRequest<{ success: boolean; remittances: ShaRemittanceRecord[] }>(
      '/remittances',
      facilityId,
    ),

  recordRemittance: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; remittance: ShaRemittanceRecord }>('/remittances', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reconcileRemittance: (
    remittanceId: number,
    facilityId: number | null | undefined,
    body: Record<string, unknown>,
  ) =>
    shaRequest<{ success: boolean; remittance: ShaRemittanceRecord }>(
      `/remittances/${remittanceId}/reconcile`,
      facilityId,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  syncRemittances: (facilityId: number | null | undefined, body?: Record<string, unknown>) =>
    shaRequest<{
      success: boolean;
      imported: ShaRemittanceRecord[];
      fetchedCount: number;
      isSimulated: boolean;
    }>('/remittances/sync', facilityId, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  getRemittanceClaims: (remittanceId: number, facilityId?: number | null) =>
    shaRequest<{
      success: boolean;
      remittanceId: number;
      bankReference: string;
      isSimulated: boolean;
      claims: Array<{
        payerClaimReference: string;
        claimNumber: string | null;
        approvedAmountKes: string;
        paidAmountKes: string;
        matchedLocalEclaimId: number | null;
        matchedLocalClaimNumber: string | null;
        matchedLocalStatus: string | null;
      }>;
    }>(`/remittances/${remittanceId}/claims`, facilityId),

  getOperationalReport: (facilityId?: number | null) =>
    shaRequest<{
      success: boolean;
      report: {
        metrics: {
          eligibilityChecksTotal: number;
          eligibleCount: number;
          ineligibleCount: number;
          deceasedBlockedCount: number;
          unableToVerifyCount: number;
          visitAuthorizationsTotal: number;
          electivePendingVisitCount: number;
          preauthorizationsTotal: number;
          preauthApprovedCount: number;
          claimsTotal: number;
          claimsByStatus: Record<string, number>;
          financialsKes: {
            totalBilled: string;
            totalClaimed: string;
            totalApproved: string;
            totalPaid: string;
            totalRemitted: string;
            unallocatedRemittance: string;
          };
          callbacksReceivedCount: number;
        };
        atnaAuditTrail: Array<{
          eventId: number;
          eventActionCode: string;
          eventDateTime: string;
          eventTypeCode: string;
          activeParticipantUserId: string;
          auditSourceId: string;
          participantObjectId: string;
        }>;
      };
    }>('/operational-report', facilityId),

  listServiceMappings: (facilityId?: number | null) =>
    shaRequest<{
      success: boolean;
      mappings: ShaServiceMappingRecord[];
      facilityTariffs: Array<{
        id: number;
        code: string;
        description: string;
        department: string;
        fee: string;
      }>;
    }>('/service-mappings', facilityId),

  upsertServiceMapping: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; mapping: ShaServiceMappingRecord }>(
      '/service-mappings',
      facilityId,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listBenefitRules: (facilityId?: number | null) =>
    shaRequest<{ success: boolean; rules: ShaBenefitRuleRecord[] }>('/benefit-rules', facilityId),

  createBenefitRule: (facilityId: number | null | undefined, body: Record<string, unknown>) =>
    shaRequest<{ success: boolean; rule: ShaBenefitRuleRecord }>('/benefit-rules', facilityId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reviewBenefitRule: (
    ruleId: number,
    facilityId: number | null | undefined,
    action: 'APPROVE' | 'RETIRE',
  ) =>
    shaRequest<{ success: boolean; rule: ShaBenefitRuleRecord }>(
      `/benefit-rules/${ruleId}/review`,
      facilityId,
      { method: 'POST', body: JSON.stringify({ action }) },
    ),
};
