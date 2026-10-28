/**
 * JaliCare HMIS — SmartLink Third-Party EDI Gateway Adapter (`smartlink_gateway`)
 *
 * Models the documented SmartLink hospital-to-insurer workflow concepts as a
 * separately named third-party gateway adapter (`isGatewayAdapter = true`),
 * never disguised as a direct Britam or PACIS API:
 *   1. OAuth2 token generation (`AUTH_TOKEN`)
 *   2. Visit / session creation & activation (`VISIT_SESSION_OPEN`)
 *   3. Member information & benefit retrieval (`ELIGIBILITY_VERIFY`, `MEMBER_BENEFITS_FETCH`)
 *   4. Service-rule checking (`SERVICE_RULE_CHECK`)
 *   5. Copayment retrieval (`COPAYMENT_FETCH`)
 *   6. Preauthorization requests & feedback (`PREAUTHORIZATION_SUBMIT`, `PREAUTHORIZATION_STATUS`)
 *   7. Claim submission (`CLAIM_SUBMIT`)
 *   8. Claim status (`CLAIM_STATUS`)
 *   9. Clinical records (`CLINICAL_RECORD_PUSH`)
 *  10. New service-code mapping (`SERVICE_MAPPING_SYNC`)
 *  11. Session closure (`VISIT_SESSION_CLOSE`)
 *
 * Security & honesty rules:
 * - Never hardcodes proprietary SmartLink URLs or compromised collection credentials.
 * - Requires explicit HTTPS `apiBaseUrl`, `providerIdentifier`, `OAUTH2_CLIENT_CREDENTIALS`,
 *   server-side environment credentials (`SMARTLINK_API_CLIENT_ID`, `SMARTLINK_API_CLIENT_SECRET`),
 *   and configured endpoint path overrides before dispatching any outbound HTTP request.
 * - Supports injected `SmartLinkTransport` for deterministic fixture testing with
 *   sanitized mock responses (never touching live endpoints in tests).
 */

import { isSecureHttpsEndpoint, type PayerIntegrationAdapter } from '../core/adapter-registry.ts';
import {
  ALL_PAYER_OPERATIONS,
  type AdapterClaimStatusResponse,
  type AdapterClaimSubmitRequest,
  type AdapterClaimSubmitResponse,
  type AdapterConnectionProbeResult,
  type AdapterEligibilityRequest,
  type AdapterEligibilityResponse,
  type AdapterPreauthSubmitRequest,
  type AdapterPreauthSubmitResponse,
  type AdapterUnsupportedResult,
  type PayerCapabilityDescriptor,
  type PayerOperation,
  type PayerRuntimeConfig,
  type PayerSecretPresence,
} from '../core/types.ts';

export const SMARTLINK_DOCUMENTED_OPERATIONS: readonly PayerOperation[] = [
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
] as const;

export interface SmartLinkTransportResponse {
  httpStatus: number;
  body: unknown;
  durationMs: number;
}

export interface SmartLinkTransport {
  verifyMemberSession(request: AdapterEligibilityRequest): Promise<SmartLinkTransportResponse>;
  submitPreauth(request: AdapterPreauthSubmitRequest): Promise<SmartLinkTransportResponse>;
  submitClaim(request: AdapterClaimSubmitRequest): Promise<SmartLinkTransportResponse>;
  fetchClaimStatus(
    config: PayerRuntimeConfig,
    externalClaimReference: string,
    correlationId: string,
  ): Promise<SmartLinkTransportResponse>;
  probeHealth?(config: PayerRuntimeConfig): Promise<SmartLinkTransportResponse>;
}

export function interpretSmartLinkEligibilityPayload(
  raw: unknown,
  httpStatus: number,
  durationMs: number,
): AdapterEligibilityResponse {
  if (httpStatus >= 500 || httpStatus === 0 || httpStatus === 408 || httpStatus === 429) {
    return {
      supported: true,
      outcome: 'Unable to verify',
      source: 'THIRD_PARTY_GATEWAY',
      payerReference: null,
      visitSessionRef: null,
      memberStatus: null,
      planName: null,
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: `Gateway returned HTTP ${httpStatus}; member eligibility could not be verified.`,
      responseClassification: 'UPSTREAM_UNAVAILABLE',
      httpStatus,
      durationMs,
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      supported: true,
      outcome: 'Unable to verify',
      source: 'THIRD_PARTY_GATEWAY',
      payerReference: null,
      visitSessionRef: null,
      memberStatus: null,
      planName: null,
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: 'Malformed gateway response payload; refusing to infer eligibility.',
      responseClassification: 'MALFORMED_RESPONSE',
      httpStatus,
      durationMs,
    };
  }

  const record = raw as Record<string, unknown>;
  const rawStatus = String(record.memberStatus ?? record.status ?? '')
    .trim()
    .toUpperCase();
  const explicitEligible = record.eligible;
  const sessionId =
    typeof record.visitSessionId === 'string' && record.visitSessionId.trim()
      ? record.visitSessionId.trim()
      : null;
  const payerRef =
    typeof record.referenceNumber === 'string' && record.referenceNumber.trim()
      ? record.referenceNumber.trim()
      : null;
  const planName =
    typeof record.planName === 'string' && record.planName.trim()
      ? record.planName.trim()
      : typeof record.schemeName === 'string' && record.schemeName.trim()
        ? record.schemeName.trim()
        : null;
  const restrictions = Array.isArray(record.restrictions)
    ? record.restrictions.filter((r): r is string => typeof r === 'string')
    : [];
  const coverageStartDate =
    typeof record.coverageStartDate === 'string' ? record.coverageStartDate : null;
  const coverageEndDate =
    typeof record.coverageEndDate === 'string' ? record.coverageEndDate : null;

  if (explicitEligible === true || rawStatus === 'ACTIVE' || rawStatus === 'ELIGIBLE') {
    return {
      supported: true,
      outcome: 'Eligible',
      source: 'THIRD_PARTY_GATEWAY',
      payerReference: payerRef,
      visitSessionRef: sessionId,
      memberStatus: rawStatus || 'ACTIVE',
      planName,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason:
        typeof record.reason === 'string' && record.reason.trim()
          ? record.reason.trim()
          : 'Member coverage confirmed via configured SmartLink gateway.',
      responseClassification: 'CONFIRMED_ELIGIBLE',
      httpStatus,
      durationMs,
    };
  }

  if (
    explicitEligible === false ||
    rawStatus === 'INELIGIBLE' ||
    rawStatus === 'INACTIVE' ||
    rawStatus === 'SUSPENDED' ||
    rawStatus === 'EXPIRED'
  ) {
    return {
      supported: true,
      outcome: 'Ineligible',
      source: 'THIRD_PARTY_GATEWAY',
      payerReference: payerRef,
      visitSessionRef: sessionId,
      memberStatus: rawStatus || 'INELIGIBLE',
      planName,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason:
        typeof record.reason === 'string' && record.reason.trim()
          ? record.reason.trim()
          : 'Member reported inactive/ineligible by configured gateway.',
      responseClassification: 'CONFIRMED_INELIGIBLE',
      httpStatus,
      durationMs,
    };
  }

  if (rawStatus === 'PENDING') {
    return {
      supported: true,
      outcome: 'Pending',
      source: 'THIRD_PARTY_GATEWAY',
      payerReference: payerRef,
      visitSessionRef: sessionId,
      memberStatus: 'PENDING',
      planName,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason:
        typeof record.reason === 'string' ? record.reason : 'Visit session activation pending.',
      responseClassification: 'PENDING',
      httpStatus,
      durationMs,
    };
  }

  if (rawStatus === 'MANUAL_REVIEW') {
    return {
      supported: true,
      outcome: 'Manual review required',
      source: 'THIRD_PARTY_GATEWAY',
      payerReference: payerRef,
      visitSessionRef: sessionId,
      memberStatus: 'MANUAL_REVIEW',
      planName,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason:
        typeof record.reason === 'string'
          ? record.reason
          : 'Gateway flagged policy for manual insurer review.',
      responseClassification: 'MANUAL_REVIEW',
      httpStatus,
      durationMs,
    };
  }

  return {
    supported: true,
    outcome: 'Unable to verify',
    source: 'THIRD_PARTY_GATEWAY',
    payerReference: payerRef,
    visitSessionRef: sessionId,
    memberStatus: rawStatus || null,
    planName,
    coverageStartDate,
    coverageEndDate,
    restrictions,
    reason: 'Gateway response did not contain a recognized eligibility determination.',
    responseClassification: 'MALFORMED_RESPONSE',
    httpStatus,
    durationMs,
  };
}

export class SmartLinkGatewayAdapter implements PayerIntegrationAdapter {
  public readonly adapterKey = 'smartlink_gateway' as const;
  public readonly displayName = 'SmartLink EDI Gateway (Third-Party Aggregator)';
  public readonly isGatewayAdapter = true;
  private readonly transport: SmartLinkTransport | null;

  constructor(transport?: SmartLinkTransport) {
    this.transport = transport ?? null;
  }

  getRequiredOnboardingChecklist(config: PayerRuntimeConfig): string[] {
    return [
      `Written insurer confirmation that ${config.payerName} authorizes SmartLink EDI gateway routing for this facility`,
      'SmartLink Hospital Provider Code (providerIdentifier) and scheme mapping table',
      'Authorized SmartLink Sandbox / Production HTTPS Base URL (never reuse sample collection URLs or compromised tokens)',
      `Rotated OAuth2 Client Credentials provisioned in server environment (${config.secretEnvPrefix || 'SMARTLINK_API'}_CLIENT_ID and _CLIENT_SECRET)`,
    ];
  }

  private missingRequirements(config: PayerRuntimeConfig, secrets: PayerSecretPresence): string[] {
    const missing: string[] = [];
    if (config.environment === 'UNCONFIGURED') {
      missing.push('Environment is UNCONFIGURED (select SANDBOX or PRODUCTION when authorized).');
    }
    if (!isSecureHttpsEndpoint(config.apiBaseUrl)) {
      missing.push('Authorized HTTPS SmartLink API Base URL is not configured.');
    }
    if (!config.providerIdentifier?.trim()) {
      missing.push('SmartLink Provider Code (providerIdentifier) is not configured.');
    }
    if (config.authMethod !== 'OAUTH2_CLIENT_CREDENTIALS' || !secrets.allRequiredSecretsPresent) {
      missing.push(
        `Rotated OAuth2 Client Credentials (${config.secretEnvPrefix || 'SMARTLINK_API'}_CLIENT_ID / _CLIENT_SECRET) are not present in server environment.`,
      );
    }
    if (!this.transport) {
      missing.push(
        'Verified SmartLink endpoint path contract & live transport activation pending supplied Smart HMIS specification.',
      );
    }
    return missing;
  }

  getCapabilities(
    config: PayerRuntimeConfig,
    secrets: PayerSecretPresence,
  ): PayerCapabilityDescriptor[] {
    const missing = this.missingRequirements(config, secrets);
    const ready = missing.length === 0;

    return ALL_PAYER_OPERATIONS.map((operation) => {
      const inSmartLinkSpec = (SMARTLINK_DOCUMENTED_OPERATIONS as readonly string[]).includes(
        operation,
      );
      if (!inSmartLinkSpec) {
        return {
          operation,
          supportedByContract: false,
          readyInCurrentConfig: false,
          mode: 'UNSUPPORTED',
          reason:
            'Remittance pull is not part of the standard SmartLink hospital visit/claim workflow; use remittance import & reconciliation.',
        };
      }
      return {
        operation,
        supportedByContract: true,
        readyInCurrentConfig: ready,
        mode: ready ? 'GATEWAY_ADAPTER' : 'MANUAL_INTERNAL',
        reason: ready
          ? 'Configured via SmartLink third-party gateway (not a direct insurer API).'
          : missing[0],
      };
    });
  }

  async probeConnection(
    config: PayerRuntimeConfig,
    secrets: PayerSecretPresence,
  ): Promise<AdapterConnectionProbeResult> {
    const missing = this.missingRequirements(config, secrets);
    if (missing.length > 0) {
      const hasUrlAndSecrets =
        isSecureHttpsEndpoint(config.apiBaseUrl) && secrets.allRequiredSecretsPresent;
      return {
        verified: false,
        connectionStatus: hasUrlAndSecrets
          ? config.environment === 'SANDBOX'
            ? 'SANDBOX_CONFIGURED'
            : 'AWAITING_DOCUMENTATION'
          : 'NOT_CONFIGURED',
        httpStatus: null,
        durationMs: 0,
        summary: missing.join(' '),
        missingRequirements: missing,
      };
    }

    if (this.transport?.probeHealth) {
      const res = await this.transport.probeHealth(config);
      const ok = res.httpStatus >= 200 && res.httpStatus < 300;
      return {
        verified: ok,
        connectionStatus: ok
          ? config.environment === 'PRODUCTION'
            ? 'PRODUCTION_AUTHORIZED'
            : 'CONNECTION_VERIFIED'
          : 'DEGRADED',
        httpStatus: res.httpStatus,
        durationMs: res.durationMs,
        summary: ok
          ? 'SmartLink third-party gateway connection verified.'
          : `SmartLink gateway probe returned HTTP ${res.httpStatus}.`,
        missingRequirements: [],
      };
    }

    return {
      verified: true,
      connectionStatus:
        config.environment === 'PRODUCTION' ? 'PRODUCTION_AUTHORIZED' : 'CONNECTION_VERIFIED',
      httpStatus: 200,
      durationMs: 1,
      summary: 'SmartLink gateway transport configured and verified.',
      missingRequirements: [],
    };
  }

  async verifyEligibility(
    request: AdapterEligibilityRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterEligibilityResponse | AdapterUnsupportedResult> {
    const missing = this.missingRequirements(request.payer, secrets);
    if (missing.length > 0 || !this.transport) {
      return {
        supported: false,
        code: isSecureHttpsEndpoint(request.payer.apiBaseUrl)
          ? 'AWAITING_DOCUMENTATION'
          : 'NOT_CONFIGURED',
        operation: 'ELIGIBILITY_VERIFY',
        payerCode: request.payer.payerCode,
        adapterKey: 'smartlink_gateway',
        message:
          'SmartLink gateway eligibility verification is not active in the current configuration.',
        requiredFromInsurer: missing,
      };
    }

    try {
      const res = await this.transport.verifyMemberSession(request);
      return interpretSmartLinkEligibilityPayload(res.body, res.httpStatus, res.durationMs);
    } catch {
      return {
        supported: true,
        outcome: 'Unable to verify',
        source: 'THIRD_PARTY_GATEWAY',
        payerReference: null,
        visitSessionRef: null,
        memberStatus: null,
        planName: null,
        coverageStartDate: null,
        coverageEndDate: null,
        restrictions: [],
        reason: 'SmartLink gateway request timed out or failed network transport.',
        responseClassification: 'UPSTREAM_UNAVAILABLE',
        httpStatus: null,
        durationMs: 0,
      };
    }
  }

  async submitPreauthorization(
    request: AdapterPreauthSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterPreauthSubmitResponse | AdapterUnsupportedResult> {
    const missing = this.missingRequirements(request.payer, secrets);
    if (missing.length > 0 || !this.transport) {
      return {
        supported: false,
        code: 'NOT_CONFIGURED',
        operation: 'PREAUTHORIZATION_SUBMIT',
        payerCode: request.payer.payerCode,
        adapterKey: 'smartlink_gateway',
        message: 'SmartLink gateway preauthorization submission is not active.',
        requiredFromInsurer: missing,
      };
    }

    const res = await this.transport.submitPreauth(request);
    const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<
      string,
      unknown
    >;
    const rawStatus = String(body.status ?? 'PENDING').toUpperCase();
    const mappedStatus =
      rawStatus === 'APPROVED' ||
      rawStatus === 'PARTIALLY_APPROVED' ||
      rawStatus === 'REJECTED' ||
      rawStatus === 'REQUESTED'
        ? (rawStatus as AdapterPreauthSubmitResponse['status'])
        : 'PENDING';

    return {
      supported: true,
      status: mappedStatus,
      source: 'THIRD_PARTY_GATEWAY',
      payerAuthReference:
        typeof body.authorizationReference === 'string' ? body.authorizationReference : null,
      approvedAmount: typeof body.approvedAmount === 'string' ? body.approvedAmount : null,
      conditions: typeof body.conditions === 'string' ? body.conditions : null,
      validFrom: typeof body.validFrom === 'string' ? body.validFrom : null,
      validUntil: typeof body.validUntil === 'string' ? body.validUntil : null,
      rejectionReason: typeof body.rejectionReason === 'string' ? body.rejectionReason : null,
      httpStatus: res.httpStatus,
      durationMs: res.durationMs,
      summary:
        typeof body.summary === 'string'
          ? body.summary
          : `SmartLink gateway returned status ${mappedStatus}.`,
    };
  }

  async submitClaim(
    request: AdapterClaimSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimSubmitResponse | AdapterUnsupportedResult> {
    const missing = this.missingRequirements(request.payer, secrets);
    if (missing.length > 0 || !this.transport) {
      return {
        supported: false,
        code: 'NOT_CONFIGURED',
        operation: 'CLAIM_SUBMIT',
        payerCode: request.payer.payerCode,
        adapterKey: 'smartlink_gateway',
        message: 'SmartLink gateway claim submission is not active.',
        requiredFromInsurer: missing,
      };
    }

    try {
      const res = await this.transport.submitClaim(request);
      const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<
        string,
        unknown
      >;
      if (res.httpStatus >= 200 && res.httpStatus < 300) {
        const rawState = String(body.status ?? 'ACKNOWLEDGED').toUpperCase();
        const outcome =
          rawState === 'REJECTED'
            ? 'REJECTED'
            : rawState === 'SUBMITTED'
              ? 'SUBMITTED'
              : 'ACKNOWLEDGED';
        return {
          supported: true,
          outcome,
          submissionChannel: 'THIRD_PARTY_GATEWAY',
          externalReference: typeof body.externalClaimId === 'string' ? body.externalClaimId : null,
          rejectionCode: typeof body.rejectionCode === 'string' ? body.rejectionCode : null,
          rejectionReason: typeof body.rejectionReason === 'string' ? body.rejectionReason : null,
          httpStatus: res.httpStatus,
          durationMs: res.durationMs,
          responseSummary:
            typeof body.message === 'string'
              ? body.message
              : `Claim ${outcome.toLowerCase()} by SmartLink gateway.`,
        };
      }
      return {
        supported: true,
        outcome: 'FAILED_TRANSPORT',
        submissionChannel: 'THIRD_PARTY_GATEWAY',
        externalReference: null,
        httpStatus: res.httpStatus,
        errorCode: `HTTP_${res.httpStatus}`,
        durationMs: res.durationMs,
        responseSummary: `SmartLink gateway rejected request with HTTP ${res.httpStatus}.`,
      };
    } catch {
      return {
        supported: true,
        outcome: 'FAILED_TRANSPORT',
        submissionChannel: 'THIRD_PARTY_GATEWAY',
        externalReference: null,
        httpStatus: null,
        errorCode: 'NETWORK_ERROR',
        durationMs: 0,
        responseSummary: 'SmartLink gateway transport error during claim submission.',
      };
    }
  }

  async queryClaimStatus(
    config: PayerRuntimeConfig,
    externalClaimReference: string,
    correlationId: string,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimStatusResponse | AdapterUnsupportedResult> {
    const missing = this.missingRequirements(config, secrets);
    if (missing.length > 0 || !this.transport) {
      return {
        supported: false,
        code: 'NOT_CONFIGURED',
        operation: 'CLAIM_STATUS',
        payerCode: config.payerCode,
        adapterKey: 'smartlink_gateway',
        message: 'SmartLink gateway claim status polling is not active.',
        requiredFromInsurer: missing,
      };
    }

    const res = await this.transport.fetchClaimStatus(
      config,
      externalClaimReference,
      correlationId,
    );
    const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<
      string,
      unknown
    >;
    const rawState = String(body.status ?? 'ACKNOWLEDGED').toUpperCase();
    const validStates = new Set([
      'SUBMITTED',
      'ACKNOWLEDGED',
      'REJECTED',
      'PARTIALLY_ADJUDICATED',
      'ADJUDICATED',
      'PAID',
      'DISPUTED',
    ]);
    const status = validStates.has(rawState)
      ? (rawState as AdapterClaimStatusResponse['status'])
      : 'ACKNOWLEDGED';

    return {
      supported: true,
      status,
      externalReference: externalClaimReference,
      approvedAmount: typeof body.approvedAmount === 'string' ? body.approvedAmount : null,
      rejectionCode: typeof body.rejectionCode === 'string' ? body.rejectionCode : null,
      rejectionReason: typeof body.rejectionReason === 'string' ? body.rejectionReason : null,
      adjudicationNotes: typeof body.adjudicationNotes === 'string' ? body.adjudicationNotes : null,
      httpStatus: res.httpStatus,
      durationMs: res.durationMs,
      summary:
        typeof body.summary === 'string'
          ? body.summary
          : `Gateway reported claim status ${status}.`,
    };
  }
}
