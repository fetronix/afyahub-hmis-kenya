/**
 * JaliCare HMIS
 * DHA / AfyaConnect integration — configuration
 *
 * SOURCE OF TRUTH
 * ---------------
 * https://hie-docs.dha.go.ke/auth/authentication
 * https://hie-docs.dha.go.ke/eclaims/eligibility
 * https://hie-docs.dha.go.ke/eclaims/authorizations
 * https://hie-docs.dha.go.ke/eclaims/start-visit-consent
 * https://hie-docs.dha.go.ke/docs/scenarios/overview
 *
 * Only endpoints that appear in that documentation are called by this
 * module. If a contract is not verified, the corresponding operation is
 * reported as BLOCKED rather than guessed at.
 *
 * ENVIRONMENTS
 * ------------
 *   mock       deterministic local fixtures. Never touches the network.
 *   sandbox    the documented UAT base URL, with approved sandbox credentials.
 *   production live. Refuses to run without an explicit opt-in AND a
 *              base URL, because no production base URL is published in
 *              the public documentation.
 *
 * Nothing here reads a secret into a log line, an error message or a
 * response body.
 */

export type DhaMode = 'mock' | 'sandbox' | 'production';

/** Published by DHA for the UAT / sandbox environment. */
export const DHA_SANDBOX_BASE_URL = 'https://ilm-dev.dha.go.ke/uat-middleware/api/v1';

export interface DhaConfig {
  mode: DhaMode;
  /** Base URL without a trailing slash, or null when unusable. */
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /** Facility Registry (FR) code, e.g. FID-47-115307-8. */
  facilityCode: string | null;
  /** Milliseconds before a request is abandoned. */
  timeoutMs: number;
  /** Retries for 429/5xx and network failures. */
  maxRetries: number;
  /** True only when the mode is usable end to end. */
  enabled: boolean;
  /** Why the integration is not enabled, or null. */
  disabledReason: string | null;
  productionOptIn: boolean;
}

function read(name: string): string | null {
  const value = process.env[name];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function positiveInt(name: string, fallback: number): number {
  const raw = read(name);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read configuration from the environment.
 *
 * This never throws: an HMIS must boot without DHA credentials, and the
 * readiness screen is how an administrator discovers what is missing.
 */
export function loadDhaConfig(overrides: Partial<DhaConfig> = {}): DhaConfig {
  const rawMode = (read('DHA_MODE') ?? 'mock').toLowerCase();

  const mode: DhaMode =
    rawMode === 'sandbox' || rawMode === 'production' || rawMode === 'mock' ? rawMode : 'mock';

  const productionOptIn = read('DHA_ALLOW_PRODUCTION') === 'true';

  const configuredBaseUrl = read('DHA_BASE_URL');

  let baseUrl: string | null = null;

  if (mode === 'sandbox') {
    baseUrl = configuredBaseUrl ?? DHA_SANDBOX_BASE_URL;
  } else if (mode === 'production') {
    /* No production URL is published publicly; it must be supplied. */
    baseUrl =
      configuredBaseUrl !== null && configuredBaseUrl.startsWith('https://')
        ? configuredBaseUrl
        : null;
  }

  const config: DhaConfig = {
    mode,
    baseUrl: baseUrl?.replace(/\/+$/, '') ?? null,
    clientId: read('DHA_CLIENT_ID'),
    clientSecret: read('DHA_CLIENT_SECRET'),
    facilityCode: read('DHA_FACILITY_CODE'),
    timeoutMs: positiveInt('DHA_TIMEOUT_MS', 15_000),
    maxRetries: positiveInt('DHA_MAX_RETRIES', 2),
    enabled: false,
    disabledReason: null,
    productionOptIn,
    ...overrides,
  };

  const problem = firstBlocker(config);

  config.enabled = problem === null;
  config.disabledReason = problem;

  return config;
}

function firstBlocker(config: DhaConfig): string | null {
  if (config.mode === 'production') {
    if (!config.productionOptIn) {
      return 'Production mode requires DHA_ALLOW_PRODUCTION=true. It is disabled by default.';
    }

    if (!config.baseUrl) {
      return 'Production requires DHA_BASE_URL. DHA has not published a production base URL in the public documentation.';
    }
  }

  if (config.mode === 'sandbox' && !config.baseUrl) {
    return 'Sandbox requires a base URL.';
  }

  if (config.mode === 'mock') return null;

  if (!config.clientId || !config.clientSecret) {
    return 'DHA_CLIENT_ID and DHA_CLIENT_SECRET are required outside mock mode.';
  }

  if (!config.facilityCode) {
    return 'DHA_FACILITY_CODE is required. It is the Facility Registry code (FR), for example FID-47-115307-8.';
  }

  return null;
}

/** Redacted view, safe to return from an HTTP endpoint. */
export function describeDhaConfig(config: DhaConfig) {
  return {
    mode: config.mode,
    baseUrl: config.baseUrl,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    productionOptIn: config.productionOptIn,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    credentials: {
      clientId: config.clientId ? 'configured' : 'missing',
      clientSecret: config.clientSecret ? 'configured' : 'missing',
      facilityCode: config.facilityCode ? 'configured' : 'missing',
    },
  };
}
