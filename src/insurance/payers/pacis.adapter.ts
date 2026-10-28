/**
 * JaliCare HMIS — Dedicated PACIS Insurance Connector (`pacis_direct`)
 *
 * Safeguards enforced:
 * - Completely independent of Britam and SmartLink assumptions.
 * - Never guesses PACIS API endpoints, credentials, copayment rules, or claim formats.
 * - Reflects PACIS operational requirements (PACIS medical card verification,
 *   provider panel tier checks, signed claim/invoice attachments where manual/portal
 *   submission is used, or explicit electronic claims aggregator configuration).
 * - Never fabricates live API verification or approval references.
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

export const PACIS_REQUIRED_ONBOARDING_ITEMS: readonly string[] = [
  'Signed PACIS Insurance Company Ltd Preferred Provider Panel Agreement and assigned PACIS Provider Code',
  'Official PACIS Medical Claims API Specification (or written confirmation of PACIS-designated Electronic Claims Aggregator)',
  'Authorized PACIS Sandbox & Production HTTPS Base URLs and authentication credentials specification',
  'Server-side credentials provisioned via PACIS_API_CLIENT_ID and PACIS_API_CLIENT_SECRET (never stored in database)',
  'Confirmed PACIS scheme panel restrictions (e.g. inpatient cover tier hospital panel rules, outpatient consultation copayments, waiting periods)',
  'Confirmed PACIS preauthorization & claim attachment checklist (e.g. signed outpatient claim form, itemized invoice, lab/imaging/prescription breakdown)',
] as const;

function buildPacisMissingList(config: PayerRuntimeConfig, secrets: PayerSecretPresence): string[] {
  const missing: string[] = [
    'Official PACIS direct hospital API endpoint & payload specification has not been supplied in this repository.',
  ];
  if (!config.providerIdentifier?.trim()) {
    missing.push('PACIS Preferred Provider Panel Code (providerIdentifier) is not configured.');
  }
  if (!isSecureHttpsEndpoint(config.apiBaseUrl)) {
    missing.push('Authorized PACIS HTTPS API Base URL (apiBaseUrl) is not configured.');
  }
  if (config.authMethod === 'NONE' || !secrets.allRequiredSecretsPresent) {
    missing.push(
      `Server-side PACIS credentials (${config.secretEnvPrefix || 'PACIS_API'}_*) are not provisioned.`,
    );
  }
  return missing;
}

function unsupportedForPacis(
  operation: PayerOperation,
  config: PayerRuntimeConfig,
  secrets: PayerSecretPresence,
): AdapterUnsupportedResult {
  const missing = buildPacisMissingList(config, secrets);
  return {
    supported: false,
    code: 'AWAITING_DOCUMENTATION',
    operation,
    payerCode: config.payerCode,
    adapterKey: 'pacis_direct',
    message:
      `Direct PACIS API operation "${operation}" is awaiting official PACIS technical specification and authorized provider access. ` +
      'Record verified PACIS medical card / case-management references via the explicit manual workflow or configure an approved gateway if designated by PACIS.',
    requiredFromInsurer: [...missing, ...PACIS_REQUIRED_ONBOARDING_ITEMS],
  };
}

export class PacisInsuranceAdapter implements PayerIntegrationAdapter {
  public readonly adapterKey = 'pacis_direct' as const;
  public readonly displayName = 'PACIS Insurance — Direct Connector';
  public readonly isGatewayAdapter = false;

  getRequiredOnboardingChecklist(config: PayerRuntimeConfig): string[] {
    const items = [...PACIS_REQUIRED_ONBOARDING_ITEMS];
    if (!config.providerIdentifier) {
      items.unshift('Facility PACIS Preferred Provider Panel Code is currently unset.');
    }
    return items;
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
      reason:
        'Awaiting official PACIS Direct Provider API specification and credentials; internal manual/file-export workflow is active.',
    }));
  }

  async probeConnection(
    config: PayerRuntimeConfig,
    secrets: PayerSecretPresence,
  ): Promise<AdapterConnectionProbeResult> {
    const missing = buildPacisMissingList(config, secrets);
    const hasPartialConfig = Boolean(config.providerIdentifier || config.apiBaseUrl);
    return {
      verified: false,
      connectionStatus: hasPartialConfig ? 'AWAITING_DOCUMENTATION' : 'NOT_CONFIGURED',
      httpStatus: null,
      durationMs: 0,
      summary:
        'PACIS direct API connectivity is not active: official PACIS API contract and credentials have not been verified. Internal PACIS membership, preauthorization, invoice-claim preparation, and remittance reconciliation workflows remain operational.',
      missingRequirements: missing,
    };
  }

  async verifyEligibility(
    request: AdapterEligibilityRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterEligibilityResponse | AdapterUnsupportedResult> {
    return unsupportedForPacis('ELIGIBILITY_VERIFY', request.payer, secrets);
  }

  async submitPreauthorization(
    request: AdapterPreauthSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterPreauthSubmitResponse | AdapterUnsupportedResult> {
    return unsupportedForPacis('PREAUTHORIZATION_SUBMIT', request.payer, secrets);
  }

  async submitClaim(
    request: AdapterClaimSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimSubmitResponse | AdapterUnsupportedResult> {
    return unsupportedForPacis('CLAIM_SUBMIT', request.payer, secrets);
  }

  async queryClaimStatus(
    config: PayerRuntimeConfig,
    _externalClaimReference: string,
    _correlationId: string,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimStatusResponse | AdapterUnsupportedResult> {
    return unsupportedForPacis('CLAIM_STATUS', config, secrets);
  }
}
