/**
 * JaliCare HMIS — Reusable Multi-Insurer Core Contracts & Pure Rules
 *
 * Payer-independent types, capability descriptors, SmartLink reference
 * workflow concepts, decimal-safe cent arithmetic, and strict state
 * machines shared across Britam, PACIS, SmartLink gateway, SHA, and
 * future private insurers.
 */

import { formatCents, parseMoneyToCents } from '../../billing/settlement.ts';

export type PayerIntegrationType = 'DIRECT_API' | 'THIRD_PARTY_GATEWAY' | 'FILE_EXPORT' | 'MANUAL';

export type PayerEnvironment = 'UNCONFIGURED' | 'SANDBOX' | 'PRODUCTION';

export type PayerConnectionStatus =
  | 'NOT_CONFIGURED'
  | 'AWAITING_DOCUMENTATION'
  | 'SANDBOX_CONFIGURED'
  | 'CONNECTION_VERIFIED'
  | 'PRODUCTION_AUTHORIZED'
  | 'DEGRADED';

export type PayerAuthMethod =
  'NONE' | 'OAUTH2_CLIENT_CREDENTIALS' | 'API_KEY_HEADER' | 'BEARER_TOKEN_REF' | 'MUTUAL_TLS';

export type PayerAdapterKey =
  'britam_direct' | 'pacis_direct' | 'cic_direct' | 'smartlink_gateway' | 'sha_afyalink' | 'manual';

/**
 * Internal insurance operations modelled from the hospital-to-insurer
 * lifecycle (including SmartLink reference workflow concepts where
 * supported by a gateway or direct API).
 */
export type PayerOperation =
  | 'AUTH_TOKEN'
  | 'VISIT_SESSION_OPEN'
  | 'VISIT_SESSION_CLOSE'
  | 'ELIGIBILITY_VERIFY'
  | 'MEMBER_BENEFITS_FETCH'
  | 'SERVICE_RULE_CHECK'
  | 'COPAYMENT_FETCH'
  | 'PREAUTHORIZATION_SUBMIT'
  | 'PREAUTHORIZATION_STATUS'
  | 'CLAIM_SUBMIT'
  | 'CLAIM_STATUS'
  | 'CLINICAL_RECORD_PUSH'
  | 'SERVICE_MAPPING_SYNC'
  | 'REMITTANCE_FETCH';

export const ALL_PAYER_OPERATIONS: readonly PayerOperation[] = [
  'AUTH_TOKEN',
  'VISIT_SESSION_OPEN',
  'VISIT_SESSION_CLOSE',
  'ELIGIBILITY_VERIFY',
  'MEMBER_BENEFITS_FETCH',
  'SERVICE_RULE_CHECK',
  'COPAYMENT_FETCH',
  'PREAUTHORIZATION_SUBMIT',
  'PREAUTHORIZATION_STATUS',
  'CLAIM_SUBMIT',
  'CLAIM_STATUS',
  'CLINICAL_RECORD_PUSH',
  'SERVICE_MAPPING_SYNC',
  'REMITTANCE_FETCH',
] as const;

export type PrivateEligibilityOutcome =
  | 'Eligible'
  | 'Ineligible'
  | 'Pending'
  | 'Unable to verify'
  | 'Manual review required'
  | 'Not supported by current integration';

export type PrivateBenefitDecision =
  | 'COVERED'
  | 'NOT_COVERED'
  | 'AUTHORIZATION_REQUIRED'
  | 'INCOMPLETE_INFORMATION'
  | 'UNABLE_TO_VERIFY';

export type PrivatePreauthStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'PENDING'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export type PrivateClaimStatus =
  | 'DRAFT'
  | 'VALIDATION_FAILED'
  | 'READY'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'PARTIALLY_ADJUDICATED'
  | 'ADJUDICATED'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED';

export type PrivateServiceCategory =
  | 'OPD_CONSULTATION'
  | 'LABORATORY'
  | 'PHARMACY'
  | 'IMAGING'
  | 'PROCEDURE'
  | 'INPATIENT_BED'
  | 'THEATRE_SPECIALIST'
  | 'OTHER';

export const PRIVATE_SERVICE_CATEGORIES: readonly PrivateServiceCategory[] = [
  'OPD_CONSULTATION',
  'LABORATORY',
  'PHARMACY',
  'IMAGING',
  'PROCEDURE',
  'INPATIENT_BED',
  'THEATRE_SPECIALIST',
  'OTHER',
] as const;

export interface PayerCapabilityDescriptor {
  operation: PayerOperation;
  supportedByContract: boolean;
  readyInCurrentConfig: boolean;
  mode: 'LIVE_ADAPTER' | 'GATEWAY_ADAPTER' | 'MANUAL_INTERNAL' | 'UNSUPPORTED';
  reason: string;
}

export interface PayerSecretPresence {
  secretEnvPrefix: string | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasApiKey: boolean;
  allRequiredSecretsPresent: boolean;
}

export interface PayerRuntimeConfig {
  payerId: number;
  tenantId: number;
  facilityId: number;
  payerCode: string;
  payerName: string;
  payerType: string;
  integrationType: PayerIntegrationType;
  adapterKey: PayerAdapterKey;
  gatewayProvider: string | null;
  environment: PayerEnvironment;
  connectionStatus: PayerConnectionStatus;
  apiBaseUrl: string | null;
  authMethod: PayerAuthMethod;
  secretEnvPrefix: string | null;
  providerIdentifier: string | null;
  defaultCodingSystem: string;
  requireVerifiedEligibility: boolean;
  eligibilityMaxAgeHours: number;
  claimRequirements: PayerClaimRequirements;
  preauthRequirements: PayerPreauthRequirements;
  isActive: boolean;
}

export interface PayerClaimRequirements {
  requireMemberNumber?: boolean;
  requirePolicyNumber?: boolean;
  requireDiagnosis?: boolean;
  requireInvoiceAttachment?: boolean;
  requireSignedClaimForm?: boolean;
  maxSubmissionDays?: number;
  allowedCodingSystems?: string[];
  /** Explicitly confirmed from the payer's approved documentation or onboarding. */
  codingPolicyVerified?: boolean;
  codingPolicyEvidence?: string;
}

export interface PayerPreauthRequirements {
  requirePreauthForInpatient?: boolean;
  requirePreauthForImaging?: boolean;
  requirePreauthForSurgery?: boolean;
  requirePreauthForOptical?: boolean;
  requirePreauthForDental?: boolean;
  amountThresholdKes?: number | null;
}

export interface AdapterUnsupportedResult {
  supported: false;
  code: 'CAPABILITY_UNAVAILABLE' | 'NOT_CONFIGURED' | 'AWAITING_DOCUMENTATION';
  operation: PayerOperation;
  payerCode: string;
  adapterKey: PayerAdapterKey;
  message: string;
  requiredFromInsurer: string[];
}

export interface AdapterEligibilityRequest {
  correlationId: string;
  payer: PayerRuntimeConfig;
  memberNumber: string;
  policyNumber?: string | null;
  schemeName?: string | null;
  patientNationalId?: string | null;
  serviceDate: string;
  intendedServiceCategory?: string | null;
}

export interface AdapterEligibilityResponse {
  supported: true;
  outcome: PrivateEligibilityOutcome;
  source: 'LIVE_PAYER_API' | 'THIRD_PARTY_GATEWAY';
  payerReference: string | null;
  visitSessionRef: string | null;
  memberStatus: string | null;
  planName: string | null;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  restrictions: string[];
  reason: string;
  responseClassification:
    | 'CONFIRMED_ELIGIBLE'
    | 'CONFIRMED_INELIGIBLE'
    | 'PENDING'
    | 'UPSTREAM_UNAVAILABLE'
    | 'MALFORMED_RESPONSE'
    | 'MANUAL_REVIEW';
  httpStatus?: number | null;
  durationMs: number;
}

export interface AdapterPreauthSubmitRequest {
  correlationId: string;
  payer: PayerRuntimeConfig;
  preauthNumber: string;
  memberNumber: string;
  policyNumber?: string | null;
  clinicalIndication: string;
  diagnosisCode: string;
  diagnosisDisplay: string;
  codingSystem: string;
  requestedItems: Array<{
    payerServiceCode: string;
    serviceName: string;
    quantity: number;
    unitPrice: string;
    estimatedTotal: string;
  }>;
  estimatedAmount: string;
}

export interface AdapterPreauthSubmitResponse {
  supported: true;
  status: 'REQUESTED' | 'PENDING' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED';
  source: 'LIVE_PAYER_API' | 'THIRD_PARTY_GATEWAY';
  payerAuthReference: string | null;
  approvedAmount: string | null;
  conditions: string | null;
  validFrom: string | null;
  validUntil: string | null;
  rejectionReason: string | null;
  httpStatus?: number | null;
  durationMs: number;
  summary: string;
}

export interface AdapterClaimSubmitRequest {
  correlationId: string;
  payer: PayerRuntimeConfig;
  claimNumber: string;
  idempotencyKey: string;
  memberNumber: string;
  policyNumber?: string | null;
  encounterType: 'OPD' | 'IPD';
  serviceDateStart: string;
  serviceDateEnd: string;
  currency: string;
  grossAmount: string;
  discountAmount: string;
  copayAmount: string;
  proposedClaimAmount: string;
  preauthReference?: string | null;
  visitSessionRef?: string | null;
  diagnoses: Array<{ code: string; display: string; system: string; type: string }>;
  lines: Array<{
    lineNumber: number;
    payerServiceCode: string;
    description: string;
    quantity: number;
    unitPrice: string;
    grossAmount: string;
    copayAmount: string;
    proposedClaimAmount: string;
    serviceDate: string;
  }>;
}

export interface AdapterClaimSubmitResponse {
  supported: true;
  outcome: 'SUBMITTED' | 'ACKNOWLEDGED' | 'REJECTED' | 'FAILED_TRANSPORT';
  submissionChannel: 'DIRECT_API' | 'THIRD_PARTY_GATEWAY';
  externalReference: string | null;
  rejectionCode?: string | null;
  rejectionReason?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  durationMs: number;
  responseSummary: string;
}

export interface AdapterClaimStatusResponse {
  supported: true;
  status: PrivateClaimStatus;
  externalReference: string | null;
  approvedAmount: string | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  adjudicationNotes: string | null;
  httpStatus?: number | null;
  durationMs: number;
  summary: string;
}

export interface AdapterConnectionProbeResult {
  verified: boolean;
  connectionStatus: PayerConnectionStatus;
  httpStatus: number | null;
  durationMs: number;
  summary: string;
  missingRequirements: string[];
}

export class PrivateInsuranceError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'PrivateInsuranceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/* ============================================================
   STRICT STATE MACHINES
   ============================================================ */

const PREAUTH_TRANSITIONS: Record<PrivatePreauthStatus, readonly PrivatePreauthStatus[]> = {
  DRAFT: ['REQUESTED', 'PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED'],
  REQUESTED: ['PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  PENDING: ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['PARTIALLY_APPROVED', 'EXPIRED', 'CANCELLED'],
  PARTIALLY_APPROVED: ['APPROVED', 'EXPIRED', 'CANCELLED'],
  REJECTED: ['REQUESTED', 'PENDING', 'CANCELLED'],
  EXPIRED: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransitionPrivatePreauthStatus(
  from: PrivatePreauthStatus,
  to: PrivatePreauthStatus,
): boolean {
  if (from === to) return true;
  return (PREAUTH_TRANSITIONS[from] ?? []).includes(to);
}

const CLAIM_TRANSITIONS: Record<PrivateClaimStatus, readonly PrivateClaimStatus[]> = {
  DRAFT: ['VALIDATION_FAILED', 'READY', 'CANCELLED'],
  VALIDATION_FAILED: ['DRAFT', 'READY', 'CANCELLED'],
  READY: ['DRAFT', 'VALIDATION_FAILED', 'SUBMITTED', 'ACKNOWLEDGED', 'CANCELLED'],
  SUBMITTED: [
    'ACKNOWLEDGED',
    'REJECTED',
    'PARTIALLY_ADJUDICATED',
    'ADJUDICATED',
    'PAID',
    'DISPUTED',
    'CANCELLED',
  ],
  ACKNOWLEDGED: [
    'REJECTED',
    'PARTIALLY_ADJUDICATED',
    'ADJUDICATED',
    'PAID',
    'DISPUTED',
    'CANCELLED',
  ],
  REJECTED: ['DRAFT', 'VALIDATION_FAILED', 'READY', 'DISPUTED', 'CANCELLED'],
  PARTIALLY_ADJUDICATED: ['ADJUDICATED', 'PAID', 'DISPUTED'],
  ADJUDICATED: ['PAID', 'PARTIALLY_ADJUDICATED', 'DISPUTED'],
  PAID: ['DISPUTED'],
  DISPUTED: ['READY', 'ADJUDICATED', 'PARTIALLY_ADJUDICATED', 'PAID', 'REJECTED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionPrivateClaimStatus(
  from: PrivateClaimStatus,
  to: PrivateClaimStatus,
): boolean {
  if (from === to) return true;
  return (CLAIM_TRANSITIONS[from] ?? []).includes(to);
}

/* ============================================================
   DECIMAL-SAFE BENEFIT, COPAYMENT & DEDUCTIBLE ARITHMETIC
   ============================================================ */

export interface BenefitRuleFinancialInput {
  unitAmountKes: string | number;
  quantity: number;
  discountAmountKes?: string | number | null;
  copayType?: 'NONE' | 'FIXED' | 'PERCENTAGE' | string | null;
  copayValueKesOrPercent?: string | number | null;
  deductibleAmountKes?: string | number | null;
  coinsurancePercent?: string | number | null;
  perVisitLimitKes?: string | number | null;
  annualLimitRemainingKes?: string | number | null;
}

export interface BenefitFinancialBreakdown {
  grossCents: number;
  discountCents: number;
  netAfterDiscountCents: number;
  deductibleCents: number;
  copayCents: number;
  coinsuranceCents: number;
  patientContributionCents: number;
  estimatedClaimableCents: number;
  cappedByLimit: boolean;
  grossFormatted: string;
  discountFormatted: string;
  deductibleFormatted: string;
  copayFormatted: string;
  patientContributionFormatted: string;
  estimatedClaimableFormatted: string;
}

export function moneyToCentsStrict(
  value: string | number | null | undefined,
  label: string,
): number {
  if (value === null || value === undefined || value === '') return 0;
  const normalized = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const cents = parseMoneyToCents(normalized);
  if (cents === null || cents < 0) {
    throw new PrivateInsuranceError(
      'INVALID_MONEY_AMOUNT',
      `${label} must be a non-negative monetary amount with at most 2 decimal places.`,
      400,
    );
  }
  return cents;
}

/**
 * Pure integer-cent calculation for private insurance line / benefit
 * estimation. Never uses floating point for currency totals.
 */
export function computeBenefitFinancialsCents(
  input: BenefitRuleFinancialInput,
): BenefitFinancialBreakdown {
  const qty = Math.max(1, Math.trunc(input.quantity || 1));
  const unitCents = moneyToCentsStrict(input.unitAmountKes, 'Unit amount');
  const grossCents = unitCents * qty;
  const rawDiscountCents = moneyToCentsStrict(input.discountAmountKes ?? '0.00', 'Discount amount');
  const discountCents = Math.min(grossCents, rawDiscountCents);
  const netAfterDiscountCents = Math.max(0, grossCents - discountCents);

  let remainingCents = netAfterDiscountCents;

  // 1. Deductible
  const ruleDeductibleCents = moneyToCentsStrict(
    input.deductibleAmountKes ?? '0.00',
    'Deductible amount',
  );
  const deductibleCents = Math.min(remainingCents, ruleDeductibleCents);
  remainingCents -= deductibleCents;

  // 2. Fixed or percentage copayment
  const copayMode = (input.copayType ?? 'NONE').toUpperCase();
  let copayCents = 0;
  if (copayMode === 'FIXED') {
    const fixedCents = moneyToCentsStrict(input.copayValueKesOrPercent ?? '0.00', 'Fixed copay');
    copayCents = Math.min(remainingCents, fixedCents);
  } else if (copayMode === 'PERCENTAGE') {
    const pctBasisPoints = moneyToCentsStrict(
      input.copayValueKesOrPercent ?? '0.00',
      'Copay percentage',
    );
    const boundedBp = Math.min(10_000, pctBasisPoints);
    copayCents = Math.min(remainingCents, Math.floor((remainingCents * boundedBp) / 10_000));
  }
  remainingCents -= copayCents;

  // 3. Coinsurance percentage (if separate from copay)
  const coinsuranceBp = Math.min(
    10_000,
    moneyToCentsStrict(input.coinsurancePercent ?? '0.00', 'Coinsurance percentage'),
  );
  const coinsuranceCents =
    coinsuranceBp > 0
      ? Math.min(remainingCents, Math.floor((remainingCents * coinsuranceBp) / 10_000))
      : 0;
  remainingCents -= coinsuranceCents;

  // 4. Apply per-visit or remaining annual benefit caps when known
  let estimatedClaimableCents = remainingCents;
  let cappedByLimit = false;

  if (
    input.perVisitLimitKes !== null &&
    input.perVisitLimitKes !== undefined &&
    input.perVisitLimitKes !== ''
  ) {
    const visitCapCents = moneyToCentsStrict(input.perVisitLimitKes, 'Per-visit limit');
    if (estimatedClaimableCents > visitCapCents) {
      estimatedClaimableCents = visitCapCents;
      cappedByLimit = true;
    }
  }

  if (
    input.annualLimitRemainingKes !== null &&
    input.annualLimitRemainingKes !== undefined &&
    input.annualLimitRemainingKes !== ''
  ) {
    const annualCapCents = moneyToCentsStrict(
      input.annualLimitRemainingKes,
      'Remaining annual limit',
    );
    if (estimatedClaimableCents > annualCapCents) {
      estimatedClaimableCents = annualCapCents;
      cappedByLimit = true;
    }
  }

  const patientContributionCents = Math.max(0, netAfterDiscountCents - estimatedClaimableCents);

  return {
    grossCents,
    discountCents,
    netAfterDiscountCents,
    deductibleCents,
    copayCents,
    coinsuranceCents,
    patientContributionCents,
    estimatedClaimableCents,
    cappedByLimit,
    grossFormatted: formatCents(grossCents),
    discountFormatted: formatCents(discountCents),
    deductibleFormatted: formatCents(deductibleCents),
    copayFormatted: formatCents(copayCents),
    patientContributionFormatted: formatCents(patientContributionCents),
    estimatedClaimableFormatted: formatCents(estimatedClaimableCents),
  };
}

export function inferPrivateServiceCategory(rawArea?: string | null): PrivateServiceCategory {
  const norm = (rawArea ?? '').trim().toUpperCase();
  if (norm.includes('OPD') || norm.includes('CONSULT')) return 'OPD_CONSULTATION';
  if (norm.includes('LAB') || norm.includes('PATHOL')) return 'LABORATORY';
  if (norm.includes('PHARM') || norm.includes('MED') || norm.includes('DRUG')) return 'PHARMACY';
  if (
    norm.includes('RAD') ||
    norm.includes('IMAG') ||
    norm.includes('XRAY') ||
    norm.includes('SCAN')
  )
    return 'IMAGING';
  if (norm.includes('THEATRE') || norm.includes('SURG') || norm.includes('SPECIAL'))
    return 'THEATRE_SPECIALIST';
  if (
    norm.includes('WARD') ||
    norm.includes('BED') ||
    norm.includes('IPD') ||
    norm.includes('INPATIENT')
  )
    return 'INPATIENT_BED';
  if (norm.includes('PROC')) return 'PROCEDURE';
  return 'OTHER';
}
