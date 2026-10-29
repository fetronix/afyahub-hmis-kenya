/** SHA gateway concern: authorization. */
import { randomUUID } from 'node:crypto';
import { asObj, readStr } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type { VisitAuthorizationRequest, VisitAuthorizationResult } from './sha.types.ts';

export async function createVisitAuthorization(
  context: ShaGatewayContext,
  req: VisitAuthorizationRequest,
): Promise<VisitAuthorizationResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (cfg.mode === 'mock') {
    if (req.consentMethod === 'OTP' && req.otp === '000000') {
      return {
        authorized: false,
        source: 'SANDBOX_SIMULATION',
        mode: 'mock',
        isSimulated: true,
        authorizationGuid: null,
        consentToken: null,
        authCode: null,
        authStatus: 'OTP_REJECTED',
        needsPreauth: false,
        virtualClaimId: null,
        expiresAtIso: null,
        errorMessage: 'Simulated HIE OTP verification failed (expired or invalid OTP).',
        correlationId,
      };
    }

    const simGuid = randomUUID();
    const simToken = `SIMTOK-${correlationId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const authStatus = req.isElectivePreVisit ? 'AUTHORIZED_PENDING_VISIT' : 'AUTHORIZED';

    return {
      authorized: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      authorizationGuid: simGuid,
      consentToken: simToken,
      authCode: simToken,
      authStatus,
      needsPreauth: Boolean(req.isElectivePreVisit),
      virtualClaimId:
        req.startVirtualClaimImmediately && !req.isElectivePreVisit
          ? `SIM-VCLAIM-${correlationId.slice(0, 8).toUpperCase()}`
          : null,
      expiresAtIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      authorized: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      authorizationGuid: null,
      consentToken: null,
      authCode: null,
      authStatus: 'UNAVAILABLE',
      needsPreauth: false,
      virtualClaimId: null,
      expiresAtIso: null,
      errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      correlationId,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const headers = context.buildServiceAccountHeaders(cfg, token, correlationId, {
      'Content-Type': 'application/json',
    });

    const authRes = await context.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.authorizePath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        patient_id: req.memberCrNumber.trim(),
        service_type: req.serviceType,
        interventions: req.interventions,
        ...(req.consentMethod === 'OTP' && req.otp ? { otp: req.otp.trim() } : {}),
        ...(req.biometricPayloadRef ? { biometric_ref: req.biometricPayloadRef } : {}),
      }),
      signal: controller.signal,
    });

    const authBody = asObj(await authRes.json().catch(() => null));
    const data = authBody ? (asObj(authBody.data) ?? authBody) : null;

    if (!authRes.ok || !data) {
      clearTimeout(timer);
      return {
        authorized: false,
        source: authRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        authorizationGuid: null,
        consentToken: null,
        authCode: null,
        authStatus: 'FAILED',
        needsPreauth: false,
        virtualClaimId: null,
        expiresAtIso: null,
        errorMessage:
          (data && readStr(data, 'message', 'detail', 'reason')) ??
          `HIE /claims/authorize returned HTTP ${authRes.status}.`,
        correlationId,
      };
    }

    const authorizationGuid = readStr(data, 'guid', 'authorization_guid', 'id');
    const consentToken = readStr(data, 'token', 'consent_token', 'authCode', 'authorization_code');
    const authCode = readStr(data, 'authCode', 'authorization_code', 'token');
    const authStatus =
      readStr(data, 'status', 'claim_auth_status') ??
      (req.isElectivePreVisit ? 'AUTHORIZED_PENDING_VISIT' : 'AUTHORIZED');

    if (req.selectedPomsfScheme && consentToken) {
      await context
        .fetchImpl(`${cfg.middlewareBaseUrl}${cfg.coversPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            consent_token: consentToken,
            scheme_code: req.selectedPomsfScheme,
          }),
          signal: controller.signal,
        })
        .catch(() => null);
    }

    let virtualClaimId: string | null = null;
    if (req.startVirtualClaimImmediately && !req.isElectivePreVisit) {
      const visitRes = await context.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.visitPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          patient_id: req.memberCrNumber.trim(),
          service_type: req.serviceType,
          intervention_codes: req.interventions,
          ...(req.consentMethod === 'OTP' && req.otp
            ? { otp: req.otp.trim() }
            : { auth_guid: authorizationGuid }),
          ...(req.practitionerRegNumber && req.practitionerRegulator
            ? {
                practitioner_identification_type: 'registration_number',
                practitioner_identification_number: req.practitionerRegNumber,
                practitioner_regulation_body: req.practitionerRegulator,
              }
            : {}),
        }),
        signal: controller.signal,
      });
      const visitJson = asObj(await visitRes.json().catch(() => null));
      if (visitRes.ok && visitJson) {
        virtualClaimId =
          readStr(visitJson, 'edi_claim_guid', 'visit_number') ??
          (typeof visitJson.claim_id === 'number' ? String(visitJson.claim_id) : null);
      }
    }

    clearTimeout(timer);
    return {
      authorized: Boolean(consentToken),
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      authorizationGuid,
      consentToken,
      authCode,
      authStatus,
      needsPreauth: Boolean(data.needsPreauth ?? data.needs_preauth),
      virtualClaimId,
      expiresAtIso: readStr(data, 'expiry', 'expires_at'),
      errorMessage: consentToken ? null : 'HIE authorization did not return a consent_token.',
      correlationId,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      authorized: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      authorizationGuid: null,
      consentToken: null,
      authCode: null,
      authStatus: 'UNAVAILABLE',
      needsPreauth: false,
      virtualClaimId: null,
      expiresAtIso: null,
      errorMessage:
        error instanceof Error
          ? `HIE visit authorization failed: ${error.message}`
          : 'HIE visit authorization failed.',
      correlationId,
    };
  }
}
