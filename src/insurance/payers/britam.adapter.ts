/**
 * JaliCare HMIS — Dedicated Britam Insurance Connector (`britam_direct`)
 *
 * Safeguards enforced:
 * - No undocumented Britam direct API specification exists in this repository.
 * - Never invents Britam URLs, authentication scopes, or payload schemas.
 * - Never reuses SmartLink gateway URLs or payloads as direct Britam endpoints.
 * - If a facility integrates with Britam via an approved third-party gateway
 *   (e.g. SmartLink), that must be configured with `integrationType = 'THIRD_PARTY_GATEWAY'`
 *   and `adapterKey = 'smartlink_gateway'`, never disguised as a direct Britam API.
 * - All internal JaliCare workflows (member policies, manual eligibility evidence,
 *   service mappings, benefit rules, preauth tracking, invoice claim generation,
 *   and remittance reconciliation) operate cleanly while external API specs are pending.
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

export const BRITAM_REQUIRED_ONBOARDING_ITEMS: readonly string[] = [
  'Signed Britam Medical Provider Panel Agreement and assigned Britam Provider Code',
  'Official Britam Direct Hospital Integration API Specification (OpenAPI / REST / FHIR schema)',
  'Authorized Britam Sandbox & Production HTTPS Base URLs and OAuth2 / mTLS authentication contract',
  'Server-side credentials provisioned via BRITAM_API_CLIENT_ID and BRITAM_API_CLIENT_SECRET (never stored in database)',
  'Confirmed Britam tariff schedule, benefit scheme codes (e.g. Milele / Corporate / Bima ya Wafanyikazi), and preauthorization rules',
  'Clarification whether facility claims route via direct Britam API or an approved third-party EDI gateway (e.g. SmartLink)',
] as const;

function buildBritamMissingList(
  config: PayerRuntimeConfig,
  secrets: PayerSecretPresence,
): string[] {
  const missing: string[] = [
    'Official Britam direct hospital API endpoint & payload specification has not been supplied in this repository.',
  ];
  if (!config.providerIdentifier?.trim()) {
    missing.push('Britam Provider Panel Identifier (providerIdentifier) is not configured.');
  }
  if (!isSecureHttpsEndpoint(config.apiBaseUrl)) {
    missing.push('Authorized Britam HTTPS API Base URL (apiBaseUrl) is not configured.');
  }
  if (config.authMethod === 'NONE' || !secrets.allRequiredSecretsPresent) {
    missing.push(
      `Server-side Britam credentials (${config.secretEnvPrefix || 'BRITAM_API'}_*) are not provisioned.`,
    );
  }
  return missing;
}

function unsupportedForBritam(
  operation: PayerOperation,
  config: PayerRuntimeConfig,
  secrets: PayerSecretPresence,
): AdapterUnsupportedResult {
  const missing = buildBritamMissingList(config, secrets);
  return {
    supported: false,
    code: 'AWAITING_DOCUMENTATION',
    operation,
    payerCode: config.payerCode,
    adapterKey: 'britam_direct',
    message:
      `Direct Britam API operation "${operation}" is awaiting official Britam technical specification and authorized provider credentials. ` +
      'Use JaliCare internal manual/file workflows or configure an approved third-party gateway if authorized by Britam.',
    requiredFromInsurer: [...missing, ...BRITAM_REQUIRED_ONBOARDING_ITEMS],
  };
}

export class BritamInsuranceAdapter implements PayerIntegrationAdapter {
  public readonly adapterKey = 'britam_direct' as const;
  public readonly displayName = 'Britam Insurance — Direct Connector';
  public readonly isGatewayAdapter = false;

  getRequiredOnboardingChecklist(config: PayerRuntimeConfig): string[] {
    const items = [...BRITAM_REQUIRED_ONBOARDING_ITEMS];
    if (!config.providerIdentifier) {
      items.unshift('Facility Britam Provider Panel Code is currently unset.');
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
        'Awaiting official Britam Direct Provider API specification and credentials; internal manual/file-export workflow is active.',
    }));
  }

  async probeConnection(
    config: PayerRuntimeConfig,
    secrets: PayerSecretPresence,
  ): Promise<AdapterConnectionProbeResult> {
    const missing = buildBritamMissingList(config, secrets);
    const hasPartialConfig = Boolean(config.providerIdentifier || config.apiBaseUrl);
    return {
      verified: false,
      connectionStatus: hasPartialConfig ? 'AWAITING_DOCUMENTATION' : 'NOT_CONFIGURED',
      httpStatus: null,
      durationMs: 0,
      summary:
        'Britam direct API connectivity is not active: official Britam API contract and credentials have not been verified. Internal policy, preauthorization, invoice-claim preparation, and remittance workflows remain operational.',
      missingRequirements: missing,
    };
  }

  async verifyEligibility(
    request: AdapterEligibilityRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterEligibilityResponse | AdapterUnsupportedResult> {
    return unsupportedForBritam('ELIGIBILITY_VERIFY', request.payer, secrets);
  }

  async submitPreauthorization(
    request: AdapterPreauthSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterPreauthSubmitResponse | AdapterUnsupportedResult> {
    return unsupportedForBritam('PREAUTHORIZATION_SUBMIT', request.payer, secrets);
  }

  async submitClaim(
    request: AdapterClaimSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimSubmitResponse | AdapterUnsupportedResult> {
    return unsupportedForBritam('CLAIM_SUBMIT', request.payer, secrets);
  }

  async queryClaimStatus(
    config: PayerRuntimeConfig,
    _externalClaimReference: string,
    _correlationId: string,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimStatusResponse | AdapterUnsupportedResult> {
    return unsupportedForBritam('CLAIM_STATUS', config, secrets);
  }
}
