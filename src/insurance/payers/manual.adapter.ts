/**
 * JaliCare HMIS — Manual / File-Based Payer Adapter (`manual`) & SHA Bridge (`sha_afyalink`)
 */

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
  // The stored key is retained for compatibility; it does not mean SHA,
  // AfyaLink and DHA HIE are the same interface.
  public readonly displayName = 'SHA eClaims bridge — facility transport unavailable';
  public readonly isGatewayAdapter = true;

  getRequiredOnboardingChecklist(): string[] {
    return [
      'Facility-specific SHA/DHA onboarding and an authorized interface contract',
      'Facility-isolated sandbox authentication and provider-approved validation and callback requirements',
      'Separate confirmation of any AfyaLink or DHA HIE interface the facility is authorized to use',
    ];
  }

  getCapabilities(): PayerCapabilityDescriptor[] {
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
        ? 'Dedicated SHA internal workflow exists; external facility transport is not verified or enabled.'
        : 'This bridge does not implement or verify the operation.',
    }));
  }

  async probeConnection(): Promise<AdapterConnectionProbeResult> {
    return {
      verified: false,
      connectionStatus: 'AWAITING_DOCUMENTATION',
      httpStatus: null,
      durationMs: 0,
      summary: 'No facility-specific SHA transport was contacted or verified.',
      missingRequirements: this.getRequiredOnboardingChecklist(),
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
        'SHA internal workflows are separate; external facility eligibility transport is blocked.',
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
        'SHA internal preauthorization workflows are separate; external facility transport is blocked.',
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
      message: 'SHA internal claim workflows are separate; external facility transport is blocked.',
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
      message:
        'SHA internal claim workflows are separate; external facility status transport is blocked.',
      requiredFromInsurer: [],
    };
  }
}
