import type { PayerIntegrationAdapter } from '../core/adapter-registry.ts';
import {
  ALL_PAYER_OPERATIONS,
  type AdapterClaimSubmitRequest,
  type AdapterEligibilityRequest,
  type AdapterPreauthSubmitRequest,
  type PayerOperation,
  type PayerRuntimeConfig,
} from '../core/types.ts';

/**
 * Separate direct Jubilee boundary. The public medical-provider application is
 * onboarding information, not an electronic API contract. No external call is
 * made until a facility-specific contract and implementation are available.
 * Existing Jubilee manual configurations deliberately keep their manual key.
 */
export class JubileeInsuranceAdapter implements PayerIntegrationAdapter {
  readonly adapterKey = 'jubilee_direct' as const;
  readonly displayName = 'Jubilee Health Insurance — Unavailable Direct Connector';
  readonly isGatewayAdapter = false;

  getRequiredOnboardingChecklist() {
    return [
      'Jubilee-confirmed provider onboarding and facility identification requirements',
      'Official facility-approved electronic interface contract, authentication, sandbox access and operation schemas',
      'Provider-approved security, callback, status and remittance verification requirements',
    ];
  }

  getCapabilities() {
    return ALL_PAYER_OPERATIONS.map((operation) => ({
      operation,
      supportedByContract: false,
      readyInCurrentConfig: false,
      mode: 'UNSUPPORTED' as const,
      reason:
        'The direct Jubilee interface has not been supplied or implemented. Manual processing is separate.',
    }));
  }

  async probeConnection() {
    return {
      verified: false,
      connectionStatus: 'AWAITING_DOCUMENTATION' as const,
      httpStatus: null,
      durationMs: 0,
      summary: 'Jubilee direct API has not been contacted or verified.',
      missingRequirements: this.getRequiredOnboardingChecklist(),
    };
  }

  private unavailable(operation: PayerOperation, payer: PayerRuntimeConfig) {
    return {
      supported: false as const,
      code: 'AWAITING_DOCUMENTATION' as const,
      operation,
      payerCode: payer.payerCode,
      adapterKey: this.adapterKey,
      message:
        'Jubilee direct API operation is unavailable pending a provider contract and implementation.',
      requiredFromInsurer: this.getRequiredOnboardingChecklist(),
    };
  }

  async verifyEligibility(request: AdapterEligibilityRequest) {
    return this.unavailable('ELIGIBILITY_VERIFY', request.payer);
  }
  async submitPreauthorization(request: AdapterPreauthSubmitRequest) {
    return this.unavailable('PREAUTHORIZATION_SUBMIT', request.payer);
  }
  async submitClaim(request: AdapterClaimSubmitRequest) {
    return this.unavailable('CLAIM_SUBMIT', request.payer);
  }
  async queryClaimStatus(config: PayerRuntimeConfig) {
    return this.unavailable('CLAIM_STATUS', config);
  }
}
