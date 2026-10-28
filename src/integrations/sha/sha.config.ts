/**
 * JaliCare HMIS
 * SHA / DHA HIE v1, AfyaConnect, AfyaLink & Kenya eClaims FHIR R4 v0.1.0 — Gateway Configuration
 *
 * OFFICIAL SPECIFICATION SOURCES (VERIFIED 2026)
 * ----------------------------------------------
 * 1. DHA HIE Middleware & AfyaConnect Claims/Preauths API v1:
 *    - https://afyaconnect.dha.go.ke/docs/eclaims/getting-started/introduction
 *    - https://hie-docs.dha.go.ke/auth/authentication
 *    - https://hie-docs.dha.go.ke/registries/client-registry
 *    - https://hie-docs.dha.go.ke/eclaims/eligibility
 *    - https://hie-docs.dha.go.ke/eclaims/authorizations
 *    - https://hie-docs.dha.go.ke/eclaims/start-visit-consent
 *    - https://hie-docs.dha.go.ke/eclaims/interventions
 *    - https://hie-docs.dha.go.ke/eclaims/preauths
 *    - https://hie-docs.dha.go.ke/eclaims/billing
 *    - https://hie-docs.dha.go.ke/eclaims/claim-dispatch
 *    - https://hie-docs.dha.go.ke/eclaims/status-callbacks
 *    - https://hie-docs.dha.go.ke/docs/claims/process/remittances/getClaimsPaidByRemittance
 *    Published UAT Middleware Base URL: https://ilm-dev.dha.go.ke/uat-middleware/api/v1
 *    Required Service-Account Headers: X-Facility-Id: <FR-code>, X-Facility-Id-Type: fr-code
 *
 * 2. Kenya eClaims FHIR Implementation Guide v0.1.0 (FHIR R4 4.0.1 — Draft CI-Build):
 *    - https://fhir.dha.go.ke/ig/eclaims/
 *    Canonical / UAT FHIR Base: https://nshr-uat.sha.go.ke/fhir
 *    NOTE: Kenya eClaims IG v0.1.0 is published as Draft (CI-Build) and is subject to
 *    revision prior to formal DHA HIE Production Conformance Certificate issuance.
 *
 * 3. DHA AfyaLink SHR Mediator Portal Integration:
 *    - https://afyalink.dha.go.ke/sha-portal-api-integration
 *    Published UAT SHR Mediator Base: https://uat.dha.go.ke
 *
 * SAFETY & HONESTY GUARANTEES
 * ---------------------------
 * - Defaults to `mock` (`isSimulated: true`) when unconfigured so local/dev never
 *   touches real SHA endpoints or invents live confirmations.
 * - `production` requires BOTH `SHA_ALLOW_PRODUCTION=true` AND explicit HTTPS URLs,
 *   because production endpoints & mTLS/OAuth2 credentials are issued only after
 *   DHA/SHA facility onboarding and conformance certification.
 * - Never exposes `clientSecret`, `webhookSecret`, or bearer tokens in
 *   `describeShaConnectionStatus()` or any HTTP response/log.
 */

import { DHA_SANDBOX_BASE_URL } from '../dha/dha.config.ts';

export type ShaEnvironmentMode = 'mock' | 'sandbox' | 'production';

/** Published DHA AfyaLink SHR Mediator UAT base URL (`/v1/shr-med/bundle`, `/v1/shr-med/claim-status`). */
export const SHA_SANDBOX_AFYALINK_BASE_URL = 'https://uat.dha.go.ke';

/** Published Kenya eClaims FHIR R4 IG v0.1.0 (Draft) canonical / UAT FHIR server base URL. */
export const SHA_SANDBOX_FHIR_IG_BASE_URL = 'https://nshr-uat.sha.go.ke/fhir';

export interface ShaConfig {
  mode: ShaEnvironmentMode;
  /** DHA HIE Middleware v1 base URL (without trailing slash). */
  middlewareBaseUrl: string | null;
  /** AfyaLink / FHIR eClaims bundle & claim-status base URL (without trailing slash). */
  eclaimsBaseUrl: string | null;
  tokenPath: string;
  clientRegistryPath: string;
  eligibilityPath: string;
  benefitsPath: string;
  subBenefitsPath: string;
  interventionsPath: string;
  utilizationPath: string;
  pomsfBalancesPath: string;
  bedOccupancyPathTemplate: string;
  authorizePath: string;
  visitPath: string;
  coversPath: string;
  preauthsPath: string;
  preauthCancelPath: string;
  claimDiagnosesPath: string;
  claimLinesPath: string;
  claimPreviewPath: string;
  claimSubmitPath: string;
  claimDischargePath: string;
  claimClosePath: string;
  remittancesPath: string;
  remittanceClaimsPath: string;
  callbackEndpointsPathTemplate: string;
  bundleSubmitPath: string;
  claimStatusPath: string;
  clientId: string | null;
  clientSecret: string | null;
  facilityRegistryCode: string | null;
  facilityIdType: 'fr-code';
  webhookSecret: string | null;
  timeoutMs: number;
  /** Retries ONLY for idempotent GET requests (never non-idempotent POST submissions). */
  maxGetRetries: number;
  productionOptIn: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

export interface ShaCapabilityReport {
  operation: string;
  protocol: string;
  documentedPath: string;
  status: 'SIMULATED' | 'READY' | 'CONFIG_REQUIRED' | 'CALLBACK_OR_MANUAL';
  notes: string;
}

export interface ShaConnectionStatusReport {
  payerCode: 'SHA';
  payerName: string;
  mode: ShaEnvironmentMode;
  isSimulated: boolean;
  enabled: boolean;
  disabledReason: string | null;
  middlewareBaseUrl: string | null;
  eclaimsBaseUrl: string | null;
  fhirIgVersion: string;
  fhirIgDraftNotice: string;
  requiredHeaders: string[];
  hasClientId: boolean;
  hasClientSecret: boolean;
  facilityRegistryCode: string | null;
  facilityIdType: 'fr-code';
  hasWebhookSecret: boolean;
  timeoutMs: number;
  maxGetRetries: number;
  missingSettings: string[];
  capabilities: ShaCapabilityReport[];
  checkedAt: string;
}

function readEnv(primary: string, fallback?: string): string | null {
  const first = process.env[primary];
  if (typeof first === 'string' && first.trim().length > 0) {
    return first.trim();
  }
  if (fallback) {
    const second = process.env[fallback];
    if (typeof second === 'string' && second.trim().length > 0) {
      return second.trim();
    }
  }
  return null;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizePath(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return value.startsWith('/') ? value : `/${value}`;
}

function boundedInt(
  name: string,
  fallbackName: string | undefined,
  def: number,
  min: number,
  max: number,
): number {
  const raw = readEnv(name, fallbackName);
  if (raw === null) return def;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return def;
  return Math.min(max, Math.max(min, parsed));
}

export function loadShaConfig(overrides: Partial<ShaConfig> = {}): ShaConfig {
  const rawMode = (readEnv('SHA_MODE', 'DHA_MODE') ?? 'mock').toLowerCase();
  const mode: ShaEnvironmentMode =
    rawMode === 'sandbox' || rawMode === 'production' || rawMode === 'mock' ? rawMode : 'mock';

  const productionOptIn = readEnv('SHA_ALLOW_PRODUCTION', 'DHA_ALLOW_PRODUCTION') === 'true';

  const configuredMiddlewareUrl = readEnv('SHA_MIDDLEWARE_BASE_URL', 'DHA_BASE_URL');
  const configuredEclaimsUrl = readEnv('SHA_AFYALINK_BASE_URL', 'SHA_FHIR_BASE_URL');

  let middlewareBaseUrl: string | null = null;
  let eclaimsBaseUrl: string | null = null;

  if (mode === 'sandbox') {
    const mw = configuredMiddlewareUrl ?? DHA_SANDBOX_BASE_URL;
    const ec = configuredEclaimsUrl ?? SHA_SANDBOX_AFYALINK_BASE_URL;
    middlewareBaseUrl = mw.startsWith('https://') ? trimTrailingSlash(mw) : null;
    eclaimsBaseUrl = ec.startsWith('https://') ? trimTrailingSlash(ec) : null;
  } else if (mode === 'production') {
    middlewareBaseUrl =
      configuredMiddlewareUrl && configuredMiddlewareUrl.startsWith('https://')
        ? trimTrailingSlash(configuredMiddlewareUrl)
        : null;
    eclaimsBaseUrl =
      configuredEclaimsUrl && configuredEclaimsUrl.startsWith('https://')
        ? trimTrailingSlash(configuredEclaimsUrl)
        : null;
  }

  const base: ShaConfig = {
    mode,
    middlewareBaseUrl,
    eclaimsBaseUrl,
    tokenPath: normalizePath(readEnv('SHA_TOKEN_PATH'), '/tenants/token'),
    clientRegistryPath: normalizePath(readEnv('SHA_CLIENT_REGISTRY_PATH'), '/patients'),
    eligibilityPath: normalizePath(readEnv('SHA_ELIGIBILITY_PATH'), '/patients/eligibility'),
    benefitsPath: normalizePath(readEnv('SHA_BENEFITS_PATH'), '/patients/benefits'),
    subBenefitsPath: normalizePath(readEnv('SHA_SUB_BENEFITS_PATH'), '/patients/sub-benefits'),
    interventionsPath: normalizePath(
      readEnv('SHA_INTERVENTIONS_PATH'),
      '/patients/benefits/interventions',
    ),
    utilizationPath: normalizePath(
      readEnv('SHA_UTILIZATION_PATH'),
      '/patients/benefits/utilization',
    ),
    pomsfBalancesPath: normalizePath(
      readEnv('SHA_POMSF_BALANCES_PATH'),
      '/patients/pomsf-balances',
    ),
    bedOccupancyPathTemplate: normalizePath(
      readEnv('SHA_BED_OCCUPANCY_PATH'),
      '/facilities/{facilityCode}/beds/occupancy',
    ),
    authorizePath: normalizePath(readEnv('SHA_AUTHORIZE_PATH'), '/claims/authorize'),
    visitPath: normalizePath(readEnv('SHA_VISIT_PATH'), '/claims/visit'),
    coversPath: normalizePath(readEnv('SHA_COVERS_PATH'), '/authorizations/covers'),
    preauthsPath: normalizePath(readEnv('SHA_PREAUTHS_PATH'), '/preauths'),
    preauthCancelPath: normalizePath(readEnv('SHA_PREAUTH_CANCEL_PATH'), '/preauths/cancel'),
    claimDiagnosesPath: normalizePath(readEnv('SHA_CLAIM_DIAGNOSES_PATH'), '/claims/diagnoses'),
    claimLinesPath: normalizePath(readEnv('SHA_CLAIM_LINES_PATH'), '/claims/lines'),
    claimPreviewPath: normalizePath(readEnv('SHA_CLAIM_PREVIEW_PATH'), '/claims/preview'),
    claimSubmitPath: normalizePath(readEnv('SHA_CLAIM_SUBMIT_PATH'), '/claims/submit'),
    claimDischargePath: normalizePath(readEnv('SHA_CLAIM_DISCHARGE_PATH'), '/claims/discharge'),
    claimClosePath: normalizePath(readEnv('SHA_CLAIM_CLOSE_PATH'), '/claims/close'),
    remittancesPath: normalizePath(readEnv('SHA_REMITTANCES_PATH'), '/remittances'),
    remittanceClaimsPath: normalizePath(
      readEnv('SHA_REMITTANCE_CLAIMS_PATH'),
      '/remittances/claims',
    ),
    callbackEndpointsPathTemplate: normalizePath(
      readEnv('SHA_CALLBACK_ENDPOINTS_PATH'),
      '/tenants/{tenant_id}/endpoints',
    ),
    bundleSubmitPath: normalizePath(readEnv('SHA_BUNDLE_PATH'), '/v1/shr-med/bundle'),
    claimStatusPath: normalizePath(readEnv('SHA_CLAIM_STATUS_PATH'), '/v1/shr-med/claim-status'),
    clientId: readEnv('SHA_CLIENT_ID', 'DHA_CLIENT_ID'),
    clientSecret: readEnv('SHA_CLIENT_SECRET', 'DHA_CLIENT_SECRET'),
    facilityRegistryCode: readEnv('SHA_FACILITY_REGISTRY_CODE', 'DHA_FACILITY_CODE'),
    facilityIdType: 'fr-code',
    webhookSecret: readEnv('SHA_WEBHOOK_SECRET'),
    timeoutMs: boundedInt('SHA_TIMEOUT_MS', 'DHA_TIMEOUT_MS', 15_000, 2_000, 30_000),
    maxGetRetries: boundedInt('SHA_MAX_GET_RETRIES', 'DHA_MAX_RETRIES', 1, 0, 3),
    productionOptIn,
    enabled: false,
    disabledReason: null,
    ...overrides,
  };

  const missing = missingShaSettings(base);
  if (base.mode === 'mock') {
    base.enabled = true;
    base.disabledReason = null;
  } else if (missing.length > 0) {
    base.enabled = false;
    base.disabledReason = `Missing required SHA ${base.mode} settings: ${missing.join(', ')}`;
  } else {
    base.enabled = true;
    base.disabledReason = null;
  }

  return base;
}

export function missingShaSettings(config: ShaConfig): string[] {
  if (config.mode === 'mock') return [];

  const missing: string[] = [];
  if (config.mode === 'production' && !config.productionOptIn) {
    missing.push('SHA_ALLOW_PRODUCTION=true');
  }
  if (!config.middlewareBaseUrl || !config.middlewareBaseUrl.startsWith('https://')) {
    missing.push('SHA_MIDDLEWARE_BASE_URL (https://)');
  }
  if (!config.eclaimsBaseUrl || !config.eclaimsBaseUrl.startsWith('https://')) {
    missing.push('SHA_AFYALINK_BASE_URL (https://)');
  }
  if (!config.clientId) {
    missing.push('SHA_CLIENT_ID');
  }
  if (!config.clientSecret) {
    missing.push('SHA_CLIENT_SECRET');
  }
  if (!config.facilityRegistryCode) {
    missing.push('SHA_FACILITY_REGISTRY_CODE');
  }
  return missing;
}

/**
 * Redacted, UI-safe readiness diagnostic. Never includes secrets or tokens.
 */
export function describeShaConnectionStatus(
  config: ShaConfig = loadShaConfig(),
  facilityRegistryOverride?: string | null,
): ShaConnectionStatusReport {
  const effectiveConfig: ShaConfig = facilityRegistryOverride
    ? loadShaConfig({ ...config, facilityRegistryCode: facilityRegistryOverride })
    : config;
  const missing = missingShaSettings(effectiveConfig);
  const isSimulated = effectiveConfig.mode === 'mock';
  const opStatus: 'SIMULATED' | 'READY' | 'CONFIG_REQUIRED' = isSimulated
    ? 'SIMULATED'
    : effectiveConfig.enabled
      ? 'READY'
      : 'CONFIG_REQUIRED';

  return {
    payerCode: 'SHA',
    payerName: 'Social Health Authority (SHA) via DHA HIE & AfyaLink',
    mode: effectiveConfig.mode,
    isSimulated,
    enabled: effectiveConfig.enabled,
    disabledReason: effectiveConfig.disabledReason,
    middlewareBaseUrl: effectiveConfig.middlewareBaseUrl,
    eclaimsBaseUrl: effectiveConfig.eclaimsBaseUrl,
    fhirIgVersion: 'ke.fhir.eclaims v0.1.0 (FHIR R4 4.0.1)',
    fhirIgDraftNotice:
      'Kenya eClaims FHIR IG v0.1.0 is published as Draft (CI-Build); HIE v1 REST middleware endpoints are supported alongside FHIR R4 bundles.',
    requiredHeaders: [
      'Authorization: Bearer <token>',
      'X-Facility-Id',
      'X-Facility-Id-Type: fr-code',
    ],
    hasClientId: effectiveConfig.clientId !== null,
    hasClientSecret: effectiveConfig.clientSecret !== null,
    facilityRegistryCode: effectiveConfig.facilityRegistryCode,
    facilityIdType: effectiveConfig.facilityIdType,
    hasWebhookSecret: effectiveConfig.webhookSecret !== null,
    timeoutMs: effectiveConfig.timeoutMs,
    maxGetRetries: effectiveConfig.maxGetRetries,
    missingSettings: missing,
    capabilities: [
      {
        operation: 'registry.patient_search',
        protocol: 'REST / JSON (DHA HIE Client Registry v1)',
        documentedPath: `GET ${effectiveConfig.clientRegistryPath}`,
        status: opStatus,
        notes: isSimulated
          ? 'Deterministic sandbox simulation resolving synthetic CR IDs.'
          : 'Resolves authoritative DHA Client Registry ID (CR ID) prior to eligibility and coverage calls.',
      },
      {
        operation: 'eligibility.verify',
        protocol: 'REST / JSON (DHA HIE v1 / AfyaLink)',
        documentedPath: `GET ${effectiveConfig.eligibilityPath}`,
        status: opStatus,
        notes: isSimulated
          ? 'Deterministic local sandbox simulation; responses are explicitly labelled SANDBOX_SIMULATION.'
          : 'Queries DHA HIE /patients/eligibility with X-Facility-Id (fr-code); enforces isAlive deceased check and POMSF* prefix scheme matching.',
      },
      {
        operation: 'benefits.coverage_and_interventions',
        protocol: 'REST / JSON (DHA HIE v1 Intervention Matrix) + Local Approved Rules',
        documentedPath: `GET ${effectiveConfig.benefitsPath} & ${effectiveConfig.interventionsPath}`,
        status: opStatus,
        notes:
          'Queries patient parent benefits, sub-benefits, and SHA intervention matrix flags (needsPreauth, needsManualPreauthApproval, needsDoctorAuthorization, specialist preauth variants) plus local approved rules.',
      },
      {
        operation: 'benefits.utilization_and_balances',
        protocol: 'REST / JSON (DHA HIE v1 Utilization & POMSF)',
        documentedPath: `GET ${effectiveConfig.utilizationPath} & ${effectiveConfig.pomsfBalancesPath}`,
        status: opStatus,
        notes:
          'Retrieves individual/household utilized vs remaining limits, POMSF scheme balances, and facility bed occupancy.',
      },
      {
        operation: 'consent.visit_authorization',
        protocol: 'REST / JSON (DHA HIE v1 OTP / Biometrics Consent)',
        documentedPath: `POST ${effectiveConfig.authorizePath} & POST ${effectiveConfig.visitPath}`,
        status: opStatus,
        notes:
          'Obtains beneficiary consent_token and authorization GUID (AUTHORIZED for active visits; AUTHORIZED_PENDING_VISIT for elective pre-visit preauths).',
      },
      {
        operation: 'preauthorization.submit',
        protocol: 'FHIR R4 Bundle (Kenya eClaims IG T-02) & HIE REST /preauths',
        documentedPath: `POST ${effectiveConfig.bundleSubmitPath} / POST ${effectiveConfig.preauthsPath}`,
        status: opStatus,
        notes:
          'Supports Normal, Surgical, Renal, Oncology, Optical, and Imaging preauth variants, practitioner regulatory body (KMPDC/COC/NCK/PPB), doctor consent tracking, and cancellation.',
      },
      {
        operation: 'claims.submit',
        protocol: 'FHIR R4 Bundle (Kenya eClaims IG T-01/T-04/T-05) & HIE Virtual Claim',
        documentedPath: `POST ${effectiveConfig.bundleSubmitPath} / POST ${effectiveConfig.claimSubmitPath}`,
        status: opStatus,
        notes:
          'Enforces FHIR R4 4.0.1 cardinalities, KES currency, ICD-11 primary diagnosis, SHA-* catalogue codes (no SNOMED CT), SHA combination rules, and idempotent non-retried POST submission.',
      },
      {
        operation: 'claims.status_and_callbacks',
        protocol: 'REST / FHIR ClaimResponse (IG T-03) + HIE Push Status Callbacks',
        documentedPath: `GET ${effectiveConfig.claimStatusPath} & POST /api/webhooks/sha/status`,
        status: opStatus,
        notes:
          'Polls ClaimResponse / virtual-claim preview and receives verified HIE status_changed callbacks (environment: sandbox | production).',
      },
      {
        operation: 'remittance.reconcile',
        protocol: 'HIE Two-Step Remittance (bank_reference) + FHIR PaymentNotice (IG T-06)',
        documentedPath: `GET ${effectiveConfig.remittancesPath} -> ${effectiveConfig.remittanceClaimsPath}`,
        status: isSimulated
          ? 'SIMULATED'
          : effectiveConfig.enabled
            ? 'READY'
            : 'CALLBACK_OR_MANUAL',
        notes:
          'Supports two-step HIE Get Remittances -> bank_reference -> Get Claims Paid by Remittance reconciliation, FHIR R4 PaymentNotice, and audited advice upload.',
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}
