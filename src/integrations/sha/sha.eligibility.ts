/** SHA gateway concern: eligibility. */
import { randomUUID } from 'node:crypto';
import { maskIdentifier } from '../dha/dha.eligibility.ts';
import { isPomsfSchemeCode } from './sha.fhir.ts';
import { mapToHieIdentificationType } from './sha.client-registry.ts';
import { interpretShaEligibilityPayload } from './sha.eligibility-parser.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  VerificationSource,
  EligibilityGatewayRequest,
  EligibilityGatewayResult,
} from './sha.types.ts';

export async function checkEligibility(
  context: ShaGatewayContext,
  req: EligibilityGatewayRequest,
): Promise<EligibilityGatewayResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const maskedHint = maskIdentifier(req.identificationValue);
  const started = Date.now();

  if (cfg.mode === 'mock') {
    const trimmed = req.identificationValue.trim();
    let result: EligibilityGatewayResult;

    if (trimmed.endsWith('5000')) {
      result = {
        outcome: 'Unable to verify',
        source: 'UNAVAILABLE',
        mode: 'mock',
        isSimulated: true,
        payerReference: null,
        memberCrNumber: null,
        memberStatus: null,
        isAlive: null,
        facilityBiometricsEnforced: null,
        whitelistedForOtp: null,
        hasPomsfScheme: false,
        schemes: [],
        schemeDetails: [],
        coverageStartDate: null,
        coverageEndDate: null,
        restrictions: [],
        reason: 'Simulated SHA gateway timeout in mock mode; eligibility is unverified.',
        possibleSolution: 'Retry eligibility check or verify connectivity.',
        responseClassification: 'UPSTREAM_TIMEOUT',
        correlationId,
      };
    } else if (trimmed.endsWith('6666')) {
      result = {
        outcome: 'Ineligible',
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
        memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
        memberStatus: 'DECEASED',
        isAlive: false,
        facilityBiometricsEnforced: true,
        whitelistedForOtp: false,
        hasPomsfScheme: false,
        schemes: ['SHIF'],
        schemeDetails: [
          {
            schemeCode: 'SHIF',
            schemeName: 'Social Health Insurance Fund',
            eligible: false,
            isPomsf: false,
          },
        ],
        coverageStartDate: '2026-01-01',
        coverageEndDate: '2026-12-31',
        restrictions: [
          'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); admission and billing are blocked.',
        ],
        reason:
          'Simulated SHA response: beneficiary is recorded as deceased in DHA Client Registry (isAlive=false).',
        possibleSolution: 'Verify patient identity; deceased beneficiaries cannot be billed.',
        responseClassification: 'CONFIRMED_DECEASED',
        correlationId,
      };
    } else if (trimmed.endsWith('0000')) {
      result = {
        outcome: 'Ineligible',
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
        memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
        memberStatus: 'INACTIVE',
        isAlive: true,
        facilityBiometricsEnforced: false,
        whitelistedForOtp: true,
        hasPomsfScheme: false,
        schemes: ['SHIF'],
        schemeDetails: [
          {
            schemeCode: 'SHIF',
            schemeName: 'Social Health Insurance Fund',
            eligible: false,
            isPomsf: false,
            statusDesc: 'Contributions in arrears',
          },
        ],
        coverageStartDate: '2026-01-01',
        coverageEndDate: '2026-06-30',
        restrictions: ['Household SHIF contribution in arrears'],
        reason: 'Simulated SHA response: member SHIF contributions are currently inactive.',
        possibleSolution: 'Advise patient to update SHIF contribution via AfyaYangu / *147#.',
        responseClassification: 'CONFIRMED_INELIGIBLE',
        correlationId,
      };
    } else if (trimmed.endsWith('9999')) {
      result = {
        outcome: 'Pending',
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
        memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
        memberStatus: 'PENDING',
        isAlive: true,
        facilityBiometricsEnforced: false,
        whitelistedForOtp: true,
        hasPomsfScheme: false,
        schemes: ['SHIF'],
        schemeDetails: [],
        coverageStartDate: null,
        coverageEndDate: null,
        restrictions: [],
        reason: 'Simulated SHA response: recent registration awaiting means-testing activation.',
        possibleSolution: 'Recheck eligibility once SHA registration activation completes.',
        responseClassification: 'CONFIRMED_PENDING',
        correlationId,
      };
    } else if (trimmed.endsWith('8888')) {
      result = {
        outcome: 'Manual review required',
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
        memberCrNumber: `SIM-CR-${trimmed.slice(-4)}`,
        memberStatus: 'IDENTITY_CONFLICT',
        isAlive: true,
        facilityBiometricsEnforced: true,
        whitelistedForOtp: false,
        hasPomsfScheme: false,
        schemes: ['SHIF'],
        schemeDetails: [],
        coverageStartDate: null,
        coverageEndDate: null,
        restrictions: ['Duplicate dependant identity record flagged in Client Registry'],
        reason: 'Simulated SHA response: Client Registry identity conflict requires manual review.',
        possibleSolution: 'Verify National ID / Birth Certificate against SHA portal.',
        responseClassification: 'MANUAL_REVIEW',
        correlationId,
      };
    } else {
      const isPomsfSim = trimmed.endsWith('7777');
      const schemes = isPomsfSim ? ['SHIF', 'PHC', 'POMSF-CIVIL'] : ['SHIF', 'PHC'];
      result = {
        outcome: 'Eligible',
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        payerReference: `SIM-ELIG-${correlationId.slice(0, 8).toUpperCase()}`,
        memberCrNumber: `SIM-CR-${trimmed.slice(-4).padStart(4, '0')}`,
        memberStatus: 'ACTIVE',
        isAlive: true,
        facilityBiometricsEnforced: false,
        whitelistedForOtp: true,
        hasPomsfScheme: isPomsfSim,
        schemes,
        schemeDetails: schemes.map((sc) => ({
          schemeCode: sc,
          schemeName: sc === 'POMSF-CIVIL' ? 'Public Officers Medical Scheme Fund' : sc,
          eligible: true,
          isPomsf: isPomsfSchemeCode(sc),
          coverageStartDate: '2026-01-01',
          coverageEndDate: '2026-12-31',
        })),
        coverageStartDate: '2026-01-01',
        coverageEndDate: '2026-12-31',
        restrictions: [],
        reason: 'Simulated SHA sandbox response: active SHIF & PHC beneficiary.',
        possibleSolution: null,
        responseClassification: 'CONFIRMED_ELIGIBLE',
        correlationId,
      };
    }

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'eligibility.verify',
      mode: 'mock',
      httpMethod: 'GET',
      endpointPath: cfg.eligibilityPath,
      subjectHint: maskedHint,
      httpStatus: result.outcome === 'Unable to verify' ? 504 : 200,
      outcome: result.outcome,
      durationMs: Date.now() - started,
    });

    return result;
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      outcome: 'Unable to verify',
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      payerReference: null,
      memberCrNumber: null,
      memberStatus: null,
      isAlive: null,
      facilityBiometricsEnforced: null,
      whitelistedForOtp: null,
      hasPomsfScheme: false,
      schemes: [],
      schemeDetails: [],
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: cfg.disabledReason ?? 'SHA gateway credentials are not configured.',
      possibleSolution:
        'Configure SHA AfyaLink credentials in server environment settings before running live verification.',
      responseClassification: 'CONFIG_MISSING',
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const url = new URL(`${cfg.middlewareBaseUrl}${cfg.eligibilityPath}`);
    url.searchParams.set(
      'identification_type',
      mapToHieIdentificationType(req.identificationType, req.identificationValue),
    );
    url.searchParams.set('identification_number', req.identificationValue.trim());

    const response = await context.fetchGetWithBoundedRetry(
      url.toString(),
      context.buildServiceAccountHeaders(cfg, token, correlationId),
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    const interpreted = interpretShaEligibilityPayload(response.status, parsedBody);
    const source: VerificationSource =
      interpreted.outcome === 'Unable to verify' ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER';

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'eligibility.verify',
      mode: cfg.mode,
      httpMethod: 'GET',
      endpointPath: cfg.eligibilityPath,
      subjectHint: maskedHint,
      httpStatus: response.status,
      outcome: interpreted.outcome,
      durationMs: Date.now() - started,
    });

    return {
      ...interpreted,
      source,
      mode: cfg.mode,
      isSimulated: false,
      correlationId,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const errMessage = isTimeout
      ? 'SHA eligibility request timed out before payer responded.'
      : 'SHA eligibility gateway was unreachable or returned a transport failure.';

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'eligibility.verify',
      mode: cfg.mode,
      httpMethod: 'GET',
      endpointPath: cfg.eligibilityPath,
      subjectHint: maskedHint,
      httpStatus: null,
      outcome: 'Unable to verify',
      errorCode: isTimeout ? 'TIMEOUT' : 'TRANSPORT_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - started,
    });

    return {
      outcome: 'Unable to verify',
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      payerReference: null,
      memberCrNumber: null,
      memberStatus: null,
      isAlive: null,
      facilityBiometricsEnforced: null,
      whitelistedForOtp: null,
      hasPomsfScheme: false,
      schemes: [],
      schemeDetails: [],
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: errMessage,
      possibleSolution:
        'Retry verification; do not treat patient as ineligible without payer confirmation.',
      responseClassification: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      correlationId,
    };
  }
}
