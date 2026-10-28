/**
 * JaliCare HMIS — Common Payer Adapter Interface & Registry
 *
 * Every external insurer or third-party aggregator implements this
 * contract. Unsupported or unconfigured operations return an explicit
 * `AdapterUnsupportedResult` rather than fabricating success.
 */

import type {
  AdapterClaimStatusResponse,
  AdapterClaimSubmitRequest,
  AdapterClaimSubmitResponse,
  AdapterConnectionProbeResult,
  AdapterEligibilityRequest,
  AdapterEligibilityResponse,
  AdapterPreauthSubmitRequest,
  AdapterPreauthSubmitResponse,
  AdapterUnsupportedResult,
  PayerAdapterKey,
  PayerAuthMethod,
  PayerCapabilityDescriptor,
  PayerRuntimeConfig,
  PayerSecretPresence,
} from './types.ts';

export interface PayerIntegrationAdapter {
  readonly adapterKey: PayerAdapterKey;
  readonly displayName: string;
  readonly isGatewayAdapter: boolean;

  /**
   * Lists the exact official specifications, credentials, and onboarding
   * artifacts required before external HTTP calls can be activated.
   */
  getRequiredOnboardingChecklist(config: PayerRuntimeConfig): string[];

  /**
   * Reports per-operation support honestly for the given facility payer
   * configuration and server-side secret presence.
   */
  getCapabilities(
    config: PayerRuntimeConfig,
    secrets: PayerSecretPresence,
  ): PayerCapabilityDescriptor[];

  /**
   * Checks whether external connectivity is genuinely configured and
   * verified. Never reports `CONNECTION_VERIFIED` unless verified.
   */
  probeConnection(
    config: PayerRuntimeConfig,
    secrets: PayerSecretPresence,
  ): Promise<AdapterConnectionProbeResult>;

  verifyEligibility(
    request: AdapterEligibilityRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterEligibilityResponse | AdapterUnsupportedResult>;

  submitPreauthorization(
    request: AdapterPreauthSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterPreauthSubmitResponse | AdapterUnsupportedResult>;

  submitClaim(
    request: AdapterClaimSubmitRequest,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimSubmitResponse | AdapterUnsupportedResult>;

  queryClaimStatus(
    config: PayerRuntimeConfig,
    externalClaimReference: string,
    correlationId: string,
    secrets: PayerSecretPresence,
  ): Promise<AdapterClaimStatusResponse | AdapterUnsupportedResult>;
}

const VALID_ENV_PREFIX = /^[A-Z][A-Z0-9_]{1,48}$/;

/**
 * Inspects server-side environment variables by prefix WITHOUT reading
 * or returning secret values to callers.
 */
export function inspectSecretEnvPresence(
  secretEnvPrefix: string | null | undefined,
  authMethod: PayerAuthMethod,
  envSource: Record<string, string | undefined> = process.env,
): PayerSecretPresence {
  const prefix = secretEnvPrefix?.trim().toUpperCase() || null;
  if (!prefix || !VALID_ENV_PREFIX.test(prefix)) {
    return {
      secretEnvPrefix: prefix,
      hasClientId: false,
      hasClientSecret: false,
      hasApiKey: false,
      allRequiredSecretsPresent: authMethod === 'NONE',
    };
  }

  const hasClientId = Boolean(envSource[`${prefix}_CLIENT_ID`]?.trim());
  const hasClientSecret = Boolean(envSource[`${prefix}_CLIENT_SECRET`]?.trim());
  const hasApiKey = Boolean(
    envSource[`${prefix}_API_KEY`]?.trim() || envSource[`${prefix}_BEARER_TOKEN`]?.trim(),
  );

  let allRequiredSecretsPresent = false;
  switch (authMethod) {
    case 'NONE':
      allRequiredSecretsPresent = true;
      break;
    case 'OAUTH2_CLIENT_CREDENTIALS':
      allRequiredSecretsPresent = hasClientId && hasClientSecret;
      break;
    case 'API_KEY_HEADER':
    case 'BEARER_TOKEN_REF':
      allRequiredSecretsPresent = hasApiKey;
      break;
    case 'MUTUAL_TLS':
      allRequiredSecretsPresent = Boolean(
        envSource[`${prefix}_MTLS_CERT_PATH`]?.trim() &&
        envSource[`${prefix}_MTLS_KEY_PATH`]?.trim(),
      );
      break;
  }

  return {
    secretEnvPrefix: prefix,
    hasClientId,
    hasClientSecret,
    hasApiKey,
    allRequiredSecretsPresent,
  };
}

export function isSecureHttpsEndpoint(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

const adapterMap = new Map<PayerAdapterKey, PayerIntegrationAdapter>();

export function registerPayerAdapter(adapter: PayerIntegrationAdapter): void {
  adapterMap.set(adapter.adapterKey, adapter);
}

export function getPayerAdapter(adapterKey: string): PayerIntegrationAdapter | undefined {
  return adapterMap.get(adapterKey as PayerAdapterKey);
}

export function listRegisteredPayerAdapters(): PayerIntegrationAdapter[] {
  return [...adapterMap.values()];
}
