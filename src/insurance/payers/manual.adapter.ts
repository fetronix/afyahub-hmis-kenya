/**
 * JaliCare HMIS — Manual / File-Based Payer Adapter (`manual`) & SHA Bridge (`sha_afyalink`)
 */

import { describeShaConnectionStatus, loadShaConfig } from '../../integrations/sha/sha.config.ts';
import type { PayerIntegrationAdapter } from '../core/adapter-registry.ts';
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

function manualUnsupported(
  operation: PayerOperation,
  config: PayerRuntimeConfig,
): AdapterUnsupportedResult {
  return {
    supported: false,
    code: 'CAPABILITY_UNAVAILABLE',
    operation,
    payerCode: config.payerCode,
    adapterKey: 'manual',
    message: `Payer "${config.payerName}" is configured for ${config.integrationType} processing; live external API operation "${operation}" is not supported.`,
    requiredFromInsurer: [
      'Insurer technical integration specification and authorized API credentials if automated electronic exchange is desired.',
    ],
  };
}

export class ManualFilePayerAdapter implements PayerIntegrationAdapter {
  public readonly adapterKey = 'manual' as const;
  public readonly displayName = 'Manual / File-Export Payer Processing';
  public readonly isGatewayAdapter = false;

  getRequiredOnboardingChecklist(_config: PayerRuntimeConfig): string[] {
    return [
      'Insurer provider panel agreement and claim submission instructions (portal upload / signed claim schedule)',
      'Tariff schedule and benefit/copayment rules for local JaliCare configuration',
    ];
  }

  getCapabilities(
    _config: PayerRuntimeConfig,
    _secrets: PayerSecretPresence,
  ): PayerCapabilityDescriptor[] {
    return ALL_PAYER_OPERATIONS.map((operation) => ({
      operation,
      supportedByContract: false,
      readyInCurrentConfig: false,
      mode: 'MANUAL_INTERNAL',
      reason: 'Configured for manual / file-based hospital-to-insurer processing.',
    }));
  }

  async probeConnection(
    config: PayerRuntimeConfig,
    _secrets: PayerSecretPresence,
  ): Promise<AdapterConnectionProbeResult> {
    return {
      verified: false,
      connectionStatus: 'NOT_CONFIGURED',
      httpStatus: null,
      durationMs: 0,
      summary: `${config.payerName} uses ${config.integrationType} processing; no live external API connection is configured.`,
      missingRequirements: [],
    };
  }

  async verifyEligibility(
    request: AdapterEligibilityRequest,
  ): Promise<AdapterEligibilityResponse | AdapterUnsupportedResult> {
    return manualUnsupported('ELIGIBILITY_VERIFY', request.payer);
  }

  async submitPreauthorization(
    request: AdapterPreauthSubmitRequest,
  ): Promise<AdapterPreauthSubmitResponse | AdapterUnsupportedResult> {
    return manualUnsupported('PREAUTHORIZATION_SUBMIT', request.payer);
  }

  async submitClaim(
    request: AdapterClaimSubmitRequest,
  ): Promise<AdapterClaimSubmitResponse | AdapterUnsupportedResult> {
    return manualUnsupported('CLAIM_SUBMIT', request.payer);
  }

  async queryClaimStatus(
    config: PayerRuntimeConfig,
  ): Promise<AdapterClaimStatusResponse | AdapterUnsupportedResult> {
    return manualUnsupported('CLAIM_STATUS', config);
  }
}

export class ShaPayerBridgeAdapter implements PayerIntegrationAdapter {
  public readonly adapterKey = 'sha_afyalink' as const;
  public readonly displayName = 'Social Health Authority (SHA / AfyaLink FHIR R4)';
  public readonly isGatewayAdapter = true;

  getRequiredOnboardingChecklist(): string[] {
    return [
      'DHA AfyaLink Facility Onboarding (FID-xx-xxxxxx-x)',
      'SHA_BASE_URL, SHA_TOKEN_URL, SHA_CLIENT_ID, SHA_CLIENT_SECRET in server environment',
    ];
  }

  getCapabilities(): PayerCapabilityDescriptor[] {
    const status = describeShaConnectionStatus(loadShaConfig());
    const supported = new Set<PayerOperation>([
      'AUTH_TOKEN',
      'ELIGIBILITY_VERIFY',
      'PREAUTHORIZATION_SUBMIT',
      'CLAIM_SUBMIT',
      'CLAIM_STATUS',
    ]);
    return ALL_PAYER_OPERATIONS.map((operation) => ({
      operation,
      supportedByContract: false, // Public draft documentation is not facility authorization.
      readyInCurrentConfig: false,
      mode: 'UNSUPPORTED',
      reason: supported.has(operation)
        ? `Dedicated SHA workflow exists (${status.mode} mode); live facility transport is not verified or enabled.`
        : 'Not part of the Kenya DHA eClaims FHIR R4 IG v0.1.0.',
    }));
  }

  async probeConnection(): Promise<AdapterConnectionProbeResult> {
    const status = describeShaConnectionStatus(loadShaConfig());
    return {
      verified: false,
      connectionStatus:
        status.mode === 'sandbox' && status.enabled ? 'SANDBOX_CONFIGURED' : 'NOT_CONFIGURED',
      httpStatus: null,
      durationMs: 0,
      summary:
        status.disabledReason ??
        `SHA settings present in ${status.mode} mode; connectivity and facility authorization have not been verified.`,
      missingRequirements: status.missingSettings,
    };
  }

  async verifyEligibility(request: AdapterEligibilityRequest): Promise<AdapterUnsupportedResult> {
    return {
      supported: false,
      code: 'CAPABILITY_UNAVAILABLE',
      operation: 'ELIGIBILITY_VERIFY',
      payerCode: request.payer.payerCode,
      adapterKey: 'sha_afyalink',
      message:
        'Use the dedicated /api/insurance/sha/* FHIR R4 endpoints for SHA public scheme operations.',
      requiredFromInsurer: [],
    };
  }

  async submitPreauthorization(
    request: AdapterPreauthSubmitRequest,
  ): Promise<AdapterUnsupportedResult> {
    return {
      supported: false,
      code: 'CAPABILITY_UNAVAILABLE',
      operation: 'PREAUTHORIZATION_SUBMIT',
      payerCode: request.payer.payerCode,
      adapterKey: 'sha_afyalink',
      message:
        'Use the dedicated /api/insurance/sha/* FHIR R4 endpoints for SHA preauthorizations.',
      requiredFromInsurer: [],
    };
  }

  async submitClaim(request: AdapterClaimSubmitRequest): Promise<AdapterUnsupportedResult> {
    return {
      supported: false,
      code: 'CAPABILITY_UNAVAILABLE',
      operation: 'CLAIM_SUBMIT',
      payerCode: request.payer.payerCode,
      adapterKey: 'sha_afyalink',
      message: 'Use the dedicated /api/insurance/sha/* FHIR R4 endpoints for SHA claims.',
      requiredFromInsurer: [],
    };
  }

  async queryClaimStatus(config: PayerRuntimeConfig): Promise<AdapterUnsupportedResult> {
    return {
      supported: false,
      code: 'CAPABILITY_UNAVAILABLE',
      operation: 'CLAIM_STATUS',
      payerCode: config.payerCode,
      adapterKey: 'sha_afyalink',
      message: 'Use the dedicated /api/insurance/sha/* FHIR R4 endpoints for SHA claim status.',
      requiredFromInsurer: [],
    };
  }
}
