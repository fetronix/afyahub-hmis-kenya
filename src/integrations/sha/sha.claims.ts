/** SHA gateway concern: claims. */
import { randomUUID } from 'node:crypto';
import { parseShaBundleSubmissionResponse, parseShaClaimStatusResponse } from './sha.fhir.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  BundleGatewayRequest,
  BundleGatewayResult,
  ClaimStatusGatewayRequest,
  ClaimStatusGatewayResult,
} from './sha.gateway-types.ts';

export async function submitBundle(
  context: ShaGatewayContext,
  req: BundleGatewayRequest,
): Promise<BundleGatewayResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const started = Date.now();

  if (cfg.mode === 'mock') {
    const prefix = req.operation === 'preauthorization.submit' ? 'SIM-PREAUTH' : 'SIM-CLM';
    const simRef = `${prefix}-${req.claimUuid.slice(0, 8).toUpperCase()}`;
    const simMediatorId = `SIM-MED-${req.bundleUuid.slice(0, 8).toUpperCase()}`;

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: req.operation,
      mode: 'mock',
      httpMethod: 'POST',
      endpointPath: cfg.bundleSubmitPath,
      subjectHint: req.claimUuid.slice(0, 12),
      httpStatus: 202,
      outcome: 'ACKNOWLEDGED',
      durationMs: Date.now() - started,
    });

    return {
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      mediatorId: simMediatorId,
      payerReference: simRef,
      upstreamState: 'queued',
      approvedAmountKes: null,
      rejectionReason: null,
      errors: [],
      mode: 'mock',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      httpStatus: 202,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.eclaimsBaseUrl) {
    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId: null,
      payerReference: null,
      upstreamState: 'config_missing',
      approvedAmountKes: null,
      rejectionReason: cfg.disabledReason ?? 'SHA AfyaLink credentials are not configured.',
      errors: [cfg.disabledReason ?? 'SHA AfyaLink credentials are not configured.'],
      mode: cfg.mode,
      source: 'UNAVAILABLE',
      isSimulated: false,
      httpStatus: null,
      correlationId,
    };
  }

  // IMPORTANT: Never auto-retry non-idempotent POST bundle submissions on timeout/5xx.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const response = await context.fetchImpl(`${cfg.eclaimsBaseUrl}${cfg.bundleSubmitPath}`, {
      method: 'POST',
      headers: context.buildServiceAccountHeaders(cfg, token, correlationId, {
        Accept: 'application/fhir+json, application/json',
        'Content-Type': 'application/fhir+json',
        'Idempotency-Key': req.bundleUuid,
      }),
      body: JSON.stringify(req.fhirBundle),
      signal: controller.signal,
    });
    clearTimeout(timer);

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    const parsed = parseShaBundleSubmissionResponse(response.status, parsedBody);

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: req.operation,
      mode: cfg.mode,
      httpMethod: 'POST',
      endpointPath: cfg.bundleSubmitPath,
      subjectHint: req.claimUuid.slice(0, 12),
      httpStatus: response.status,
      outcome: parsed.outcome,
      durationMs: Date.now() - started,
    });

    return {
      ...parsed,
      mode: cfg.mode,
      source:
        parsed.outcome === 'FAILED' && response.status >= 500
          ? 'UNAVAILABLE'
          : 'AUTHORITATIVE_PAYER',
      isSimulated: false,
      httpStatus: response.status,
      correlationId,
    };
  } catch (error) {
    clearTimeout(timer);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const msg = isTimeout
      ? 'SHA bundle submission timed out. Check claim status before resubmitting to prevent duplicate dispatch.'
      : 'SHA AfyaLink bundle endpoint could not be reached.';

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: req.operation,
      mode: cfg.mode,
      httpMethod: 'POST',
      endpointPath: cfg.bundleSubmitPath,
      subjectHint: req.claimUuid.slice(0, 12),
      httpStatus: null,
      outcome: 'FAILED',
      errorCode: isTimeout ? 'TIMEOUT' : 'TRANSPORT_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Transport failure',
      durationMs: Date.now() - started,
    });

    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId: null,
      payerReference: null,
      upstreamState: isTimeout ? 'timeout' : 'transport_error',
      approvedAmountKes: null,
      rejectionReason: msg,
      errors: [msg],
      mode: cfg.mode,
      source: 'UNAVAILABLE',
      isSimulated: false,
      httpStatus: null,
      correlationId,
    };
  }
}

export async function queryClaimStatus(
  context: ShaGatewayContext,
  req: ClaimStatusGatewayRequest,
): Promise<ClaimStatusGatewayResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const started = Date.now();

  if (cfg.mode === 'mock') {
    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'claims.status',
      mode: 'mock',
      httpMethod: 'GET',
      endpointPath: cfg.claimStatusPath,
      subjectHint: req.claimUuid.slice(0, 12),
      httpStatus: 200,
      outcome: 'ACKNOWLEDGED',
      durationMs: Date.now() - started,
    });

    return {
      recognized: true,
      mappedStatus: 'ACKNOWLEDGED',
      upstreamState: 'in-review',
      payerClaimReference:
        req.payerClaimReference ?? `SIM-CLM-${req.claimUuid.slice(0, 8).toUpperCase()}`,
      approvedAmountKes: null,
      paidAmountKes: null,
      rejectionReason: null,
      mode: 'mock',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      httpStatus: 200,
      correlationId,
      errorMessage: null,
    };
  }

  if (!cfg.enabled || !cfg.eclaimsBaseUrl) {
    return {
      recognized: false,
      mappedStatus: null,
      upstreamState: 'config_missing',
      payerClaimReference: req.payerClaimReference ?? null,
      approvedAmountKes: null,
      paidAmountKes: null,
      rejectionReason: null,
      mode: cfg.mode,
      source: 'UNAVAILABLE',
      isSimulated: false,
      httpStatus: null,
      correlationId,
      errorMessage: cfg.disabledReason ?? 'SHA AfyaLink credentials are not configured.',
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const url = new URL(`${cfg.eclaimsBaseUrl}${cfg.claimStatusPath}`);
    url.searchParams.set('claim_id', req.payerClaimReference ?? req.claimUuid);

    const response = await context.fetchGetWithBoundedRetry(
      url.toString(),
      context.buildServiceAccountHeaders(cfg, token, correlationId, {
        Accept: 'application/fhir+json, application/json',
      }),
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    const parsed = parseShaClaimStatusResponse(response.status, parsedBody);

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'claims.status',
      mode: cfg.mode,
      httpMethod: 'GET',
      endpointPath: cfg.claimStatusPath,
      subjectHint: req.claimUuid.slice(0, 12),
      httpStatus: response.status,
      outcome: parsed.mappedStatus ?? 'UNRECOGNIZED',
      durationMs: Date.now() - started,
    });

    return {
      ...parsed,
      mode: cfg.mode,
      source: parsed.recognized ? 'AUTHORITATIVE_PAYER' : 'UNAVAILABLE',
      isSimulated: false,
      httpStatus: response.status,
      correlationId,
      errorMessage: parsed.recognized
        ? null
        : `SHA claim-status endpoint returned HTTP ${response.status} without a recognized adjudication state.`,
    };
  } catch (error) {
    return {
      recognized: false,
      mappedStatus: null,
      upstreamState: 'transport_error',
      payerClaimReference: req.payerClaimReference ?? null,
      approvedAmountKes: null,
      paidAmountKes: null,
      rejectionReason: null,
      mode: cfg.mode,
      source: 'UNAVAILABLE',
      isSimulated: false,
      httpStatus: null,
      correlationId,
      errorMessage:
        error instanceof Error
          ? `Unable to query SHA claim status: ${error.message}`
          : 'Unable to query SHA claim status.',
    };
  }
}
