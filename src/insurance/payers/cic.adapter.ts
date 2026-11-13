import type { PayerIntegrationAdapter } from '../core/adapter-registry.ts';
import {
  ALL_PAYER_OPERATIONS,
  type AdapterEligibilityRequest,
  type AdapterPreauthSubmitRequest,
  type AdapterClaimSubmitRequest,
  type PayerOperation,
  type PayerRuntimeConfig,
} from '../core/types.ts';

/** Independent boundary: no CIC API contract or credentials have been verified. */
export class CicInsuranceAdapter implements PayerIntegrationAdapter {
  readonly adapterKey = 'cic_direct' as const;
  readonly displayName = 'CIC Insurance — Unverified Direct Connector';
  readonly isGatewayAdapter = false;
  getRequiredOnboardingChecklist() {
    return [
      'CIC provider agreement and manual claim instructions',
      'Authorized provider API contract, sandbox credentials and facility-specific approval if electronic exchange is requested',
    ];
  }
  getCapabilities() {
    return ALL_PAYER_OPERATIONS.map((operation) => ({
      operation,
      supportedByContract: false,
      readyInCurrentConfig: false,
      mode: 'UNSUPPORTED' as const,
      reason:
        'No authorized CIC API contract or facility credentials have been verified. Manual internal processing is separate.',
    }));
  }
  async probeConnection() {
    return {
      verified: false,
      connectionStatus: 'AWAITING_DOCUMENTATION' as const,
      httpStatus: null,
      durationMs: 0,
      summary: 'CIC API has not been tested or connected.',
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
      message: 'CIC API operation is unavailable pending an authorized contract and verification.',
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
