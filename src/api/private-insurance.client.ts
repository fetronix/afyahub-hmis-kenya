/**
 * JaliCare HMIS — Typed Frontend Client for Private Insurance & Multi-Insurer Engine
 *
 * Uses relative `/api/insurance/...` paths and `getSessionToken()` from `./client.ts`.
 */

import { getSessionToken } from './client.ts';

export interface PrivatePayerCapability {
  operation: string;
  supportedByContract: boolean;
  readyInCurrentConfig: boolean;
  mode: 'LIVE_ADAPTER' | 'GATEWAY_ADAPTER' | 'MANUAL_INTERNAL' | 'UNSUPPORTED';
  reason: string;
}

export interface PrivatePayerConfig {
  id: number;
  tenantId: number;
  facilityId: number;
  payerCode: string;
  payerName: string;
  payerType: string;
  isActive: boolean;
  integrationType: 'DIRECT_API' | 'THIRD_PARTY_GATEWAY' | 'FILE_EXPORT' | 'MANUAL';
  adapterKey:
    | 'britam_direct'
    | 'pacis_direct'
    | 'cic_direct'
    | 'smartlink_gateway'
    | 'sha_afyalink'
    | 'manual';
  adapterDisplayName: string;
  isGatewayAdapter: boolean;
  gatewayProvider: string | null;
  environment: 'UNCONFIGURED' | 'SANDBOX' | 'PRODUCTION';
  connectionStatus:
    | 'NOT_CONFIGURED'
    | 'AWAITING_DOCUMENTATION'
    | 'SANDBOX_CONFIGURED'
    | 'CONNECTION_VERIFIED'
    | 'PRODUCTION_AUTHORIZED'
    | 'DEGRADED';
  apiBaseUrl: string | null;
  authMethod: string;
  secretReference: {
    envPrefix: string | null;
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasApiKey: boolean;
    allRequiredSecretsPresent: boolean;
  };
  providerIdentifier: string | null;
  contractedSchemes: string[];
  defaultCodingSystem: string;
  requireVerifiedEligibility: boolean;
  eligibilityMaxAgeHours: number;
  supportedOperations: string[];
  capabilities: PrivatePayerCapability[];
  claimRequirements: Record<string, unknown>;
  preauthRequirements: Record<string, unknown>;
  missingRequirements: string[];
  onboardingChecklist: string[];
  lastConnectionCheckAt: string | null;
  lastConnectionSummary: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface PrivateInsuranceDashboardResponse {
  payers: PrivatePayerConfig[];
  kpis: {
    configuredPayersCount: number;
    activeMembersCount: number;
    pendingPreauthsCount: number;
    totalClaimsCount: number;
    pendingSubmissionCount: number;
    rejectedClaimsCount: number;
    totalProposedClaimAmount: string;
    totalReconciledPaidAmount: string;
    unreconciledRemittancesCount: number;
  };
}

export interface PrivateMemberPolicy {
  id: number;
  patientId: number;
  patientName: string;
  patientGender?: string;
  patientDob?: string;
  payerCode: string;
  memberNumber: string;
  policyNumber: string | null;
  schemeName: string | null;
  planName: string | null;
  memberRole: string;
  principalMemberName: string | null;
  principalMemberNumber: string | null;
  relationshipToPrincipal: string | null;
  externalMemberId: string | null;
  validFrom: string | null;
  validTo: string | null;
  facilityRestrictions: string[];
  schemeRestrictions: string[];
  evidenceSource: string;
  verificationStatus: string;
  manualReviewStatus: string;
  manualReviewNotes: string | null;
  lastVerifiedAt: string | null;
  status: string;
  correctionCount: number;
  lastCorrectionReason: string | null;
  updatedAt: string;
}

export interface PrivateEligibilityRecord {
  id: number;
  patientId: number;
  memberPolicyId: number | null;
  encounterId: number | null;
  payerCode: string;
  identificationType: string;
  identificationHint: string;
  intendedServiceArea: string | null;
  outcome: string;
  source: string;
  payerReference: string | null;
  manualReference: string | null;
  evidenceDocumentRef: string | null;
  visitSessionRef: string | null;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  restrictions: string[];
  reason: string | null;
  possibleSolution: string | null;
  responseClassification: string;
  checkedAt: string;
  requiredFromInsurer?: string[];
}

export interface PrivateServiceMapping {
  id: number;
  payerCode: string;
  tariffId: number | null;
  localCode: string;
  localDescription: string;
  serviceArea: string;
  payerServiceCode: string;
  payerServiceName: string;
  reimbursementTariff: string | null;
  requiresPreauth: boolean;
  requiresReferral: boolean;
  requiresClinicalNotes: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface PrivateBenefitRule {
  id: number;
  payerCode: string;
  ruleCode: string;
  version: number;
  benefitPackage: string;
  serviceCategory: string;
  payerServiceCode: string | null;
  requiresPreauth: boolean;
  requiresReferral: boolean;
  copayType: string;
  copayValue: string;
  deductibleAmount: string;
  coinsurancePercent: string;
  waitingPeriodDays: number;
  annualLimit: string | null;
  perVisitLimit: string | null;
  exclusionNotes: string | null;
  sourceReference: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PrivateBenefitValidationResult {
  id: number;
  patientId: number;
  payerCode: string;
  serviceDescription: string;
  serviceCategory: string;
  jaliCareItemCode?: string | null;
  payerServiceCode: string | null;
  mappingStatus?: string;
  benefitPackage: string | null;
  serviceDate: string;
  quantity: number;
  facilityTariffAmount: string;
  payerTariffAmount: string | null;
  deductibleEstimate: string;
  estimatedCopayAmount: string;
  estimatedCoveredAmount: string | null;
  patientContributionEstimate?: string | null;
  decision: string;
  verificationSource: string;
  requiresPreauth: boolean;
  preauthReference: string | null;
  missingRequirements: string[];
  reason: string;
  validatedAt: string;
}

export interface PrivatePreauthRecord {
  id: number;
  patientId: number;
  patientName: string;
  memberPolicyId: number | null;
  encounterId: number | null;
  invoiceId: number | null;
  payerCode: string;
  preauthNumber: string;
  payerAuthReference: string | null;
  mediatorId: string | null;
  category: string;
  status: string;
  source: string;
  clinicalIndication: string;
  primaryDiagnosisCode: string;
  primaryDiagnosisDisplay: string;
  codingSystem: string;
  requestedServiceCode: string;
  requestedServiceName: string;
  requestedItems: Array<{
    serviceCode: string;
    serviceName: string;
    quantity: number;
    unitPrice: string;
    estimatedTotal: string;
  }>;
  quantity: number;
  estimatedAmount: string;
  approvedAmount: string | null;
  conditions: string | null;
  validFrom: string | null;
  validUntil: string | null;
  rejectionReason: string | null;
  attachments?: Array<{
    id: number;
    documentType: string;
    fileName: string;
    storageReference: string;
    uploadedAt: string;
  }>;
  updatedAt: string;
}

export interface PrivateClaimSummary {
  id: number;
  patientId: number;
  patientName: string;
  memberPolicyId: number;
  memberNumber: string;
  policyNumber: string | null;
  invoiceId: number;
  invoiceNumber: string;
  originalInvoiceStatus: string;
  payerCode: string;
  claimNumber: string;
  encounterType: string;
  currency: string;
  serviceDateStart: string;
  serviceDateEnd: string;
  grossInvoiceAmount: string;
  discountAmount: string;
  confirmedCopayAmount: string;
  patientPaidAmount: string;
  proposedClaimAmount: string;
  approvedAmount: string;
  paidAmount: string;
  status: string;
  submissionChannel: string;
  externalClaimReference: string | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  submissionCount: number;
  revisionNumber: number;
  validationIssues: Array<{
    code: string;
    severity: 'ERROR' | 'WARNING';
    field?: string;
    message: string;
  }>;
  updatedAt: string;
}

export interface PrivateClaimDetail extends PrivateClaimSummary {
  memberPolicy: PrivateMemberPolicy;
  originalInvoice: {
    id: number;
    invoiceNumber: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    status: string;
  };
  diagnosesSnapshot: Array<{ code: string; display: string; system: string; type: string }>;
  attachmentsManifest: Array<{
    documentType: string;
    fileName: string;
    storageReference: string;
  }>;
  lines: Array<{
    id: number;
    lineNumber: number;
    serviceCategory: string;
    itemCode: string | null;
    itemDescription: string;
    payerServiceCode: string | null;
    payerServiceName: string | null;
    mappingStatus: string;
    quantity: number;
    unitPrice: string;
    grossAmount: string;
    discountAmount: string;
    copayAmount: string;
    proposedClaimAmount: string;
    approvedAmount: string | null;
    rejectionReason: string | null;
  }>;
  submissions: Array<{
    id: number;
    attemptNumber: number;
    adapterKey: string;
    submissionChannel: string;
    operation: string;
    correlationId: string;
    outcome: string;
    externalReference: string | null;
    responseSummary: string | null;
    submittedAt: string;
  }>;
  statusHistory: Array<{
    id: number;
    fromStatus: string | null;
    toStatus: string;
    source: string;
    reason: string | null;
    createdAt: string;
  }>;
}

async function requestJson<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api/insurance${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof payload?.message === 'string'
        ? payload.message
        : `Request failed with HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload as T;
}

export const privateInsuranceApi = {
  getDashboard: (facilityId?: number) =>
    requestJson<PrivateInsuranceDashboardResponse>(
      `/dashboard${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getDiagnostics: (payerCode?: string) =>
    requestJson<{
      diagnostics: Array<Record<string, unknown>>;
      auditEvents: Array<Record<string, unknown>>;
    }>(`/diagnostics${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`),

  listPayers: () => requestJson<{ payers: PrivatePayerConfig[] }>('/payers'),
  createPayer: (body: Record<string, unknown>) =>
    requestJson<PrivatePayerConfig>('/payers', { method: 'POST', body }),
  updatePayer: (payerId: number, body: Record<string, unknown>) =>
    requestJson<PrivatePayerConfig>(`/payers/${payerId}`, { method: 'PATCH', body }),
  getPayerCapabilities: (payerId: number) =>
    requestJson<Record<string, unknown>>(`/payers/${payerId}/capabilities`),
  probePayerConnection: (payerId: number) =>
    requestJson<{
      verified: boolean;
      connectionStatus: string;
      summary: string;
      missingRequirements: string[];
    }>(`/payers/${payerId}/connection-status`),

  listMembers: (params?: { payerCode?: string; patientId?: number; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.payerCode) qs.set('payerCode', params.payerCode);
    if (params?.patientId) qs.set('patientId', String(params.patientId));
    if (params?.search) qs.set('search', params.search);
    const q = qs.toString();
    return requestJson<{ members: PrivateMemberPolicy[] }>(`/members${q ? `?${q}` : ''}`);
  },
  createMember: (body: Record<string, unknown>) =>
    requestJson<PrivateMemberPolicy>('/members', { method: 'POST', body }),
  updateMember: (memberId: number, body: Record<string, unknown>) =>
    requestJson<PrivateMemberPolicy>(`/members/${memberId}`, { method: 'PATCH', body }),

  listEligibility: (payerCode?: string) =>
    requestJson<{ verifications: PrivateEligibilityRecord[] }>(
      `/eligibility${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`,
    ),
  checkEligibility: (body: Record<string, unknown>) =>
    requestJson<PrivateEligibilityRecord>('/eligibility/check', { method: 'POST', body }),
  getPatientEligibilityHistory: (patientId: number) =>
    requestJson<{ patientId: number; verifications: PrivateEligibilityRecord[] }>(
      `/patients/${patientId}/eligibility-history`,
    ),

  listBenefits: (payerCode?: string) =>
    requestJson<{
      rules: PrivateBenefitRule[];
      validations: PrivateBenefitValidationResult[];
    }>(`/benefits${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`),
  createBenefitRule: (body: Record<string, unknown>) =>
    requestJson<PrivateBenefitRule>('/benefits', { method: 'POST', body }),
  updateBenefitRuleStatus: (ruleId: number, status: 'DRAFT' | 'APPROVED' | 'RETIRED') =>
    requestJson<PrivateBenefitRule>(`/benefits/${ruleId}`, {
      method: 'PATCH',
      body: { status },
    }),
  validateBenefit: (body: Record<string, unknown>) =>
    requestJson<PrivateBenefitValidationResult>('/benefits/validate', {
      method: 'POST',
      body,
    }),

  listMappings: (payerCode?: string) =>
    requestJson<{ mappings: PrivateServiceMapping[] }>(
      `/mappings${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`,
    ),
  createMapping: (body: Record<string, unknown>) =>
    requestJson<PrivateServiceMapping>('/mappings', { method: 'POST', body }),
  updateMapping: (mappingId: number, body: Record<string, unknown>) =>
    requestJson<PrivateServiceMapping>(`/mappings/${mappingId}`, {
      method: 'PATCH',
      body,
    }),

  listPreauthorizations: (payerCode?: string) =>
    requestJson<{ preauthorizations: PrivatePreauthRecord[] }>(
      `/preauthorizations${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`,
    ),
  getPreauthorization: (id: number) =>
    requestJson<PrivatePreauthRecord>(`/preauthorizations/${id}`),
  createPreauthorization: (body: Record<string, unknown>) =>
    requestJson<PrivatePreauthRecord>('/preauthorizations', { method: 'POST', body }),
  updatePreauthorization: (id: number, body: Record<string, unknown>) =>
    requestJson<PrivatePreauthRecord>(`/preauthorizations/${id}`, {
      method: 'PATCH',
      body,
    }),
  submitPreauthorization: (id: number, body: Record<string, unknown>) =>
    requestJson<PrivatePreauthRecord>(`/preauthorizations/${id}/submit`, {
      method: 'POST',
      body,
    }),
  addPreauthAttachment: (id: number, body: Record<string, unknown>) =>
    requestJson<Record<string, unknown>>(`/preauthorizations/${id}/attachments`, {
      method: 'POST',
      body,
    }),

  listClaims: (params?: { payerCode?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.payerCode) qs.set('payerCode', params.payerCode);
    if (params?.status) qs.set('status', params.status);
    const q = qs.toString();
    return requestJson<{ claims: PrivateClaimSummary[] }>(`/claims${q ? `?${q}` : ''}`);
  },
  getClaim: (claimId: number) => requestJson<PrivateClaimDetail>(`/claims/${claimId}`),
  prepareClaim: (body: Record<string, unknown>) =>
    requestJson<PrivateClaimDetail>('/claims/prepare', { method: 'POST', body }),
  updateClaim: (claimId: number, body: Record<string, unknown>) =>
    requestJson<PrivateClaimDetail>(`/claims/${claimId}`, { method: 'PATCH', body }),
  validateClaim: (claimId: number) =>
    requestJson<PrivateClaimDetail>(`/claims/${claimId}/validate`, { method: 'POST' }),
  submitClaim: (claimId: number, body: Record<string, unknown>) =>
    requestJson<PrivateClaimDetail>(`/claims/${claimId}/submit`, { method: 'POST', body }),
  resubmitClaim: (claimId: number, body: Record<string, unknown>) =>
    requestJson<PrivateClaimDetail>(`/claims/${claimId}/resubmit`, { method: 'POST', body }),
  recordClaimDecision: (claimId: number, body: Record<string, unknown>) =>
    requestJson<PrivateClaimDetail>(`/claims/${claimId}/decision`, { method: 'POST', body }),
  queryClaimStatus: (claimId: number) =>
    requestJson<{ liveStatusChecked: boolean; message: string; claim: PrivateClaimDetail }>(
      `/claims/${claimId}/status`,
    ),

  listRemittances: (payerCode?: string) =>
    requestJson<{ remittances: Array<Record<string, unknown>> }>(
      `/remittances${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`,
    ),
  importRemittance: (body: Record<string, unknown>) =>
    requestJson<Record<string, unknown>>('/remittances/import', { method: 'POST', body }),
  reconcileRemittance: (id: number, body: Record<string, unknown>) =>
    requestJson<Record<string, unknown>>(`/remittances/${id}/reconcile`, {
      method: 'POST',
      body,
    }),
  getReconciliation: (payerCode?: string) =>
    requestJson<{
      summary: {
        entriesCount: number;
        totalClaimedAmount: string;
        totalRemittedAmount: string;
        totalVarianceAmount: string;
      };
      entries: Array<Record<string, unknown>>;
    }>(`/reconciliation${payerCode ? `?payerCode=${encodeURIComponent(payerCode)}` : ''}`),
};
