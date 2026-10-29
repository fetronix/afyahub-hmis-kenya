/** SHA gateway concern: virtual claim. */
import { randomUUID } from 'node:crypto';
import { parseShaBundleSubmissionResponse } from './sha.fhir.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type { HieVirtualClaimSubmitRequest } from './sha.types.ts';
import type { BundleGatewayResult } from './sha.gateway-types.ts';

/**
 * Submits an HIE v1 virtual claim (`/claims/diagnoses`, `/claims/lines`, then
 * `/claims/submit` for OPD/Emergency or `/claims/discharge` for IPD).
 */
export async function submitHieVirtualClaim(
  context: ShaGatewayContext,
  req: HieVirtualClaimSubmitRequest,
): Promise<BundleGatewayResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (cfg.mode === 'mock') {
    const simRef = `SIM-HIE-CLM-${req.consentToken.slice(-6).toUpperCase()}`;
    return {
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      mediatorId: `SIM-EDI-${correlationId.slice(0, 8).toUpperCase()}`,
      payerReference: simRef,
      upstreamState: 'submitted_claim',
      approvedAmountKes: null,
      rejectionReason: null,
      errors: [],
      mode: 'mock',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      httpStatus: 200,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId: null,
      payerReference: null,
      upstreamState: 'config_missing',
      approvedAmountKes: null,
      rejectionReason: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      errors: [cfg.disabledReason ?? 'SHA HIE credentials are not configured.'],
      mode: cfg.mode,
      source: 'UNAVAILABLE',
      isSimulated: false,
      httpStatus: null,
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

    const practitionerFields =
      req.practitionerRegNumber && req.practitionerRegulator
        ? {
            practitioner_identification_type: 'registration_number',
            practitioner_identification_number: req.practitionerRegNumber,
            practitioner_regulation_body: req.practitionerRegulator,
          }
        : {};

    for (const diag of req.diagnoses) {
      const dRes = await context.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.claimDiagnosesPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          consent_token: req.consentToken,
          icd_code: diag.icdCode,
          intervention_code: diag.interventionCode,
          ...practitionerFields,
        }),
        signal: controller.signal,
      });
      if (!dRes.ok) {
        clearTimeout(timer);
        return {
          accepted: false,
          outcome: 'FAILED',
          mediatorId: null,
          payerReference: null,
          upstreamState: `diagnosis_http_${dRes.status}`,
          approvedAmountKes: null,
          rejectionReason: `HIE /claims/diagnoses rejected diagnosis ${diag.icdCode} (HTTP ${dRes.status}).`,
          errors: [`HIE /claims/diagnoses failed with HTTP ${dRes.status}.`],
          mode: cfg.mode,
          source: dRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          isSimulated: false,
          httpStatus: dRes.status,
          correlationId,
        };
      }
    }

    for (const line of req.lines) {
      const lRes = await context.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.claimLinesPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          consent_token: req.consentToken,
          intervention_code: line.interventionCode,
          unit_price: line.unitPriceKes,
          quantity: String(line.quantity),
          service_name: line.serviceName,
          ...(line.serviceIdentifier ? { service_identifier: line.serviceIdentifier } : {}),
          ...practitionerFields,
        }),
        signal: controller.signal,
      });
      if (!lRes.ok) {
        clearTimeout(timer);
        return {
          accepted: false,
          outcome: 'FAILED',
          mediatorId: null,
          payerReference: null,
          upstreamState: `line_http_${lRes.status}`,
          approvedAmountKes: null,
          rejectionReason: `HIE /claims/lines rejected item ${line.interventionCode} (HTTP ${lRes.status}).`,
          errors: [`HIE /claims/lines failed with HTTP ${lRes.status}.`],
          mode: cfg.mode,
          source: lRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
          isSimulated: false,
          httpStatus: lRes.status,
          correlationId,
        };
      }
    }

    // Per HIE spec: Outpatient/Emergency uses POST /claims/submit (DECEASED invalid on OP);
    // Inpatient uses POST /claims/discharge.
    const isInpatient = req.subType === 'ip';
    const dispatchPath = isInpatient ? cfg.claimDischargePath : cfg.claimSubmitPath;
    const opDischargeReason =
      req.dischargeReason === 'DECEASED' && !isInpatient ? 'OTHER' : req.dischargeReason;

    const dispatchBody = isInpatient
      ? {
          consent_token: req.consentToken,
          discharge_reason: req.dischargeReason,
          invoice_number: req.invoiceNumber,
          ...(req.dischargeDate ? { discharge_date: req.dischargeDate } : {}),
          ...(req.otp ? { otp: req.otp } : {}),
          ...(req.dischargeAuthGuid ? { discharge_auth_guid: req.dischargeAuthGuid } : {}),
        }
      : {
          consent_token: req.consentToken,
          invoice_number: req.invoiceNumber,
          discharge_reason: opDischargeReason,
          discharge_status: 'FULL',
          ...(req.notes ? { notes: req.notes } : {}),
          ...(req.otp ? { otp: req.otp } : {}),
          ...(req.dischargeAuthGuid ? { discharge_auth_guid: req.dischargeAuthGuid } : {}),
        };

    const dispatchRes = await context.fetchImpl(`${cfg.middlewareBaseUrl}${dispatchPath}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Idempotency-Key': correlationId,
      },
      body: JSON.stringify(dispatchBody),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const parsedBody = await dispatchRes.json().catch(() => null);
    const parsed = parseShaBundleSubmissionResponse(dispatchRes.status, parsedBody);

    return {
      ...parsed,
      mode: cfg.mode,
      source:
        parsed.outcome === 'FAILED' && dispatchRes.status >= 500
          ? 'UNAVAILABLE'
          : 'AUTHORITATIVE_PAYER',
      isSimulated: false,
      httpStatus: dispatchRes.status,
      correlationId,
    };
  } catch (error) {
    clearTimeout(timer);
    const msg =
      error instanceof Error
        ? `HIE virtual claim dispatch failed: ${error.message}`
        : 'HIE virtual claim dispatch failed.';
    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId: null,
      payerReference: null,
      upstreamState: 'transport_error',
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
