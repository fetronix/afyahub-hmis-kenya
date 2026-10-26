/**
 * JaliCare HMIS
 * DHA / AfyaConnect — readiness report
 *
 * Answers, in one place, the questions an administrator actually asks:
 *
 *   - what is configured, and what is missing
 *   - can this installation reach DHA right now
 *   - which operations are implemented, and which are not
 *   - is production switched on, and if not, why
 *
 * It never returns a secret. Credentials are reported as
 * "configured" / "missing" and nothing more.
 */

import { describeDhaConfig, loadDhaConfig, type DhaConfig } from './dha.config.ts';
import { getAccessToken } from './dha.client.ts';
import { DhaError } from './dha.errors.ts';

export type CheckStatus = 'READY' | 'BLOCKED' | 'WARNING';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface OperationState {
  operation: string;
  method: string;
  path: string;
  /** Implemented and callable in this codebase. */
  implemented: boolean;
  /** Why it is not implemented, when it is not. */
  blockedReason?: string;
}

/**
 * What this build actually calls.
 *
 * Anything not in this list is not implemented, and saying so is more
 * useful than pretending otherwise. The claim line-item, diagnosis,
 * preauthorisation and remittance contracts have not been captured
 * against the published reference yet, so they are deliberately absent.
 */
export const DHA_OPERATIONS: OperationState[] = [
  {
    operation: 'auth.token',
    method: 'POST',
    path: '/tenants/token',
    implemented: true,
  },
  {
    operation: 'eligibility.check',
    method: 'GET',
    path: '/patients/eligibility',
    implemented: true,
  },
  {
    operation: 'coverage.benefits',
    method: 'GET',
    path: '/patients/benefits',
    implemented: true,
  },
  {
    operation: 'coverage.interventions',
    method: 'GET',
    path: '/patients/benefits/interventions',
    implemented: true,
  },
  {
    operation: 'coverage.subBenefits',
    method: 'GET',
    path: '/patients/sub-benefits',
    implemented: true,
  },
  {
    operation: 'coverage.utilization',
    method: 'GET',
    path: '/patients/benefits/utilization',
    implemented: true,
  },
  {
    operation: 'coverage.pomsf',
    method: 'GET',
    path: '/patients/pomsf-balances',
    implemented: true,
  },
  {
    operation: 'patients.search',
    method: 'GET',
    path: '/patients',
    implemented: false,
    blockedReason:
      'Patient Search returns the Client Registry record. The response schema has not been captured against the published reference, and eligibility already resolves a CR id, so this is queued rather than guessed.',
  },
  {
    operation: 'consent.authorize',
    method: 'POST',
    path: '/claims/authorize',
    implemented: false,
    blockedReason:
      'Consent capture needs an OTP delivered to the patient and, for biometrics, a registered hardware agent. The request shapes are documented, but this build has no OTP delivery channel and no biometric device, so it is not wired to a screen.',
  },
  {
    operation: 'claim.startVisit',
    method: 'POST',
    path: '/claims/visit',
    implemented: false,
    blockedReason:
      'Creating a visit consumes a consent token or authorization GUID. Until consent capture is wired, this cannot run end to end, so it is not exposed.',
  },
  {
    operation: 'claim.lines',
    method: 'POST',
    path: '(claim line items)',
    implemented: false,
    blockedReason: 'Contract not yet captured from the published reference. Not invented.',
  },
  {
    operation: 'claim.diagnoses',
    method: 'POST',
    path: '(claim diagnoses)',
    implemented: false,
    blockedReason: 'Contract not yet captured from the published reference. Not invented.',
  },
  {
    operation: 'preauth.submit',
    method: 'POST',
    path: '(preauthorisation)',
    implemented: false,
    blockedReason: 'Contract not yet captured from the published reference. Not invented.',
  },
  {
    operation: 'remittance.read',
    method: 'GET',
    path: '(remittance)',
    implemented: false,
    blockedReason: 'Contract not yet captured from the published reference. Not invented.',
  },
];

export interface ReadinessReport {
  generatedAt: string;
  config: ReturnType<typeof describeDhaConfig>;
  checks: ReadinessCheck[];
  operations: OperationState[];
  /** True only when nothing is BLOCKED. */
  ready: boolean;
  blockers: string[];
}

/**
 * Build the report.
 *
 * `probe` sends one token request when credentials are present, so the
 * report reflects reality rather than intention. Pass `false` for a
 * purely local report.
 */
export async function buildReadinessReport(
  options: {
    config?: DhaConfig;
    probe?: boolean;
  } = {},
): Promise<ReadinessReport> {
  const config = options.config ?? loadDhaConfig();
  const checks: ReadinessCheck[] = [];

  checks.push({
    id: 'mode',
    label: 'Integration mode',
    status: config.mode === 'production' ? 'WARNING' : 'READY',
    detail:
      config.mode === 'mock'
        ? 'Mock mode: deterministic local fixtures. No network calls are made and every result is marked simulated.'
        : config.mode === 'sandbox'
          ? 'Sandbox mode: calls the published UAT base URL.'
          : 'Production mode selected. Live patient data will leave this system.',
  });

  if (config.mode === 'production') {
    checks.push({
      id: 'production_gate',
      label: 'Production switch',
      status: config.productionOptIn ? 'READY' : 'BLOCKED',
      detail: config.productionOptIn
        ? 'DHA_ALLOW_PRODUCTION is true.'
        : 'Production is disabled by default. Set DHA_ALLOW_PRODUCTION=true only after go-live approval.',
    });

    checks.push({
      id: 'production_url',
      label: 'Production base URL',
      status: config.baseUrl ? 'READY' : 'BLOCKED',
      detail: config.baseUrl
        ? 'A production base URL is configured.'
        : 'DHA publishes the UAT base URL in the public documentation, not a production one. Supply DHA_BASE_URL after go-live approval.',
    });
  } else if (config.mode === 'mock') {
    checks.push({
      id: 'base_url',
      label: 'Base URL',
      status: 'READY',
      detail: 'Not used in mock mode. No request leaves this process.',
    });
  } else {
    checks.push({
      id: 'base_url',
      label: 'Base URL',
      status: config.baseUrl ? 'READY' : 'BLOCKED',
      detail: config.baseUrl
        ? config.baseUrl
        : 'DHA_BASE_URL is required in sandbox mode. The documented UAT base URL is used when it is not set.',
    });
  }

  checks.push({
    id: 'credentials',
    label: 'OAuth client credentials',
    status:
      config.mode === 'mock'
        ? 'READY'
        : config.clientId && config.clientSecret
          ? 'READY'
          : 'BLOCKED',
    detail:
      config.mode === 'mock'
        ? 'Not required in mock mode.'
        : config.clientId && config.clientSecret
          ? 'Client id and secret are configured. Values are never returned by this endpoint.'
          : 'DHA_CLIENT_ID and DHA_CLIENT_SECRET are required outside mock mode. Obtain them from the AfyaConnect onboarding portal once the application is approved.',
  });

  checks.push({
    id: 'facility_code',
    label: 'Facility Registry code',
    status: config.mode === 'mock' ? 'READY' : config.facilityCode ? 'READY' : 'BLOCKED',
    detail:
      config.mode === 'mock'
        ? 'Not required in mock mode.'
        : config.facilityCode
          ? 'An FR code is configured and sent as X-Facility-Id with X-Facility-Id-Type: fr-code.'
          : 'DHA_FACILITY_CODE is required. It is the Facility Registry code, for example FID-47-115307-8, and is sent on every business call.',
  });

  if (config.mode !== 'mock' && config.enabled && options.probe !== false) {
    try {
      await getAccessToken(config, {});
      checks.push({
        id: 'connectivity',
        label: 'Token exchange',
        status: 'READY',
        detail: 'DHA issued an access token.',
      });
    } catch (error) {
      const dhaError = error instanceof DhaError ? error : null;

      checks.push({
        id: 'connectivity',
        label: 'Token exchange',
        status: 'BLOCKED',
        detail: dhaError ? `${dhaError.code}: ${dhaError.message}` : 'The token exchange failed.',
      });
    }
  } else if (config.mode !== 'mock') {
    checks.push({
      id: 'connectivity',
      label: 'Token exchange',
      status: 'WARNING',
      detail: 'Not attempted because configuration is incomplete.',
    });
  }

  const blockers = checks
    .filter((check) => check.status === 'BLOCKED')
    .map((check) => `${check.label}: ${check.detail}`);

  return {
    generatedAt: new Date().toISOString(),
    config: describeDhaConfig(config),
    checks,
    operations: DHA_OPERATIONS,
    ready: blockers.length === 0,
    blockers,
  };
}
