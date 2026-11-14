/** SHA gateway concern: preauthorization. */
import { randomUUID } from 'node:crypto';
import { asObj, readStr, readNumMoney } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  VerificationSource,
  HiePreauthGatewayRequest,
  HiePreauthGatewayResult,
} from './sha.types.ts';

export async function submitHiePreauth(
  context: ShaGatewayContext,
  req: HiePreauthGatewayRequest,
): Promise<HiePreauthGatewayResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (cfg.mode === 'mock') {
    const simGuid = randomUUID();
    const needsDoc = Boolean(req.doctors && req.doctors.length > 0);
    return {
      accepted: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      hiePreauthGuid: simGuid,
      payerAuthReference: `SIM-HIE-PA-${simGuid.slice(0, 8).toUpperCase()}`,
      status: 'SUBMITTED',
      doctorApproved: needsDoc ? false : null,
      needsDoctorApproval: needsDoc,
      interimApprovedAmountKes: null,
      finalApprovedAmountKes: null,
      rejectionReason: null,
      errors: [],
      httpStatus: 201,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      accepted: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      hiePreauthGuid: null,
      payerAuthReference: null,
      status: 'CONFIG_MISSING',
      doctorApproved: null,
      needsDoctorApproval: false,
      interimApprovedAmountKes: null,
      finalApprovedAmountKes: null,
      rejectionReason: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      errors: [cfg.disabledReason ?? 'SHA HIE credentials are not configured.'],
      httpStatus: null,
      correlationId,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const response = await context.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.preauthsPath}`, {
      method: 'POST',
      headers: context.buildServiceAccountHeaders(cfg, token, correlationId, {
        'Content-Type': 'application/json',
        'Idempotency-Key': correlationId,
      }),
      body: JSON.stringify({
        consent_token: req.consentToken,
        preauth_type: req.variant,
        is_elective: req.isElective,
        intervention_code: req.interventionCode,
        service_start: req.serviceStart,
        service_end: req.serviceEnd,
        clinical_indications: req.clinicalIndications,
        diagnoses: req.diagnoses.map((d) => ({
          icd_code: d.icdCode,
          name: d.name,
          diagnosis_type: d.diagnosisType ?? 'PRIMARY',
        })),
        items: req.items.map((it) => ({
          code: it.code,
          name: it.name,
          quantity: String(it.quantity),
          unit_price: it.unitPriceKes,
        })),
        ...(req.doctors && req.doctors.length > 0
          ? {
              doctors: req.doctors.map((doc) => ({
                practitioner_registration_number: doc.registrationNumber,
                regulation_body: doc.regulationBody,
                name: doc.name ?? undefined,
              })),
            }
          : {}),
        ...(req.providerNotificationEmail
          ? { provider_notification_email: req.providerNotificationEmail }
          : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = asObj(await response.json().catch(() => null));
    const data = json ? (asObj(json.data) ?? json) : null;

    if (!response.ok || !data) {
      const msg =
        (data && readStr(data, 'message', 'detail', 'reason')) ??
        `HIE /preauths returned HTTP ${response.status}.`;
      return {
        accepted: false,
        source: response.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: null,
        payerAuthReference: null,
        status: 'FAILED',
        doctorApproved: null,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: msg,
        errors: [msg],
        httpStatus: response.status,
        correlationId,
      };
    }

    const guid = readStr(data, 'guid', 'id');
    const authDetails = asObj(data.authorizationDetails);
    const authCode =
      (authDetails ? readStr(authDetails, 'authCode') : null) ??
      readStr(data, 'token', 'authCode') ??
      guid;

    return {
      accepted: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      hiePreauthGuid: guid,
      payerAuthReference: authCode,
      status: (readStr(data, 'status') ?? 'SUBMITTED').toUpperCase(),
      doctorApproved: typeof data.doctorApproved === 'boolean' ? data.doctorApproved : null,
      needsDoctorApproval: Boolean(data.needsDoctorApproval),
      interimApprovedAmountKes: readNumMoney(data.totalInterimApprovedAmountForPreauth),
      finalApprovedAmountKes: readNumMoney(data.finalApprovedAmount),
      rejectionReason: readStr(data, 'rejectionReason', 'reason'),
      errors: [],
      httpStatus: response.status,
      correlationId,
    };
  } catch (error) {
    clearTimeout(timer);
    const msg =
      error instanceof Error
        ? `HIE preauthorization submission failed: ${error.message}`
        : 'HIE preauthorization submission failed.';
    return {
      accepted: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      hiePreauthGuid: null,
      payerAuthReference: null,
      status: 'TRANSPORT_ERROR',
      doctorApproved: null,
      needsDoctorApproval: false,
      interimApprovedAmountKes: null,
      finalApprovedAmountKes: null,
      rejectionReason: msg,
      errors: [msg],
      httpStatus: null,
      correlationId,
    };
  }
}

export async function queryHiePreauths(
  context: ShaGatewayContext,
  req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    correlationId?: string;
  },
): Promise<HiePreauthGatewayResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (cfg.mode === 'mock') {
    return {
      accepted: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      hiePreauthGuid: req.hiePreauthGuid ?? randomUUID(),
      payerAuthReference: `SIM-PA-REF-${req.consentToken.slice(-6)}`,
      status: 'SUBMITTED',
      doctorApproved: true,
      needsDoctorApproval: false,
      interimApprovedAmountKes: null,
      finalApprovedAmountKes: null,
      rejectionReason: null,
      errors: [],
      httpStatus: 200,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      accepted: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      hiePreauthGuid: req.hiePreauthGuid ?? null,
      payerAuthReference: null,
      status: 'UNAVAILABLE',
      doctorApproved: null,
      needsDoctorApproval: false,
      interimApprovedAmountKes: null,
      finalApprovedAmountKes: null,
      rejectionReason: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      errors: [],
      httpStatus: null,
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const url = new URL(`${cfg.middlewareBaseUrl}${cfg.preauthsPath}`);
    url.searchParams.set('consent_token', req.consentToken);

    const res = await context.fetchGetWithBoundedRetry(
      url.toString(),
      context.buildServiceAccountHeaders(cfg, token, correlationId),
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    const raw = await res.json().catch(() => null);
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(asObj(raw)?.results)
        ? (asObj(raw)!.results as unknown[])
        : Array.isArray(asObj(raw)?.data)
          ? (asObj(raw)!.data as unknown[])
          : raw
            ? [raw]
            : [];
    const matching =
      list
        .map((item) => asObj(item))
        .find(
          (item) => item && (!req.hiePreauthGuid || readStr(item, 'guid') === req.hiePreauthGuid),
        ) ?? asObj(list[0]);

    if (!res.ok || !matching) {
      return {
        accepted: false,
        source: res.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        hiePreauthGuid: req.hiePreauthGuid ?? null,
        payerAuthReference: null,
        status: 'NOT_FOUND',
        doctorApproved: null,
        needsDoctorApproval: false,
        interimApprovedAmountKes: null,
        finalApprovedAmountKes: null,
        rejectionReason: null,
        errors: [],
        httpStatus: res.status,
        correlationId,
      };
    }

    const authDetails = asObj(matching.authorizationDetails);
    return {
      accepted: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      hiePreauthGuid: readStr(matching, 'guid') ?? req.hiePreauthGuid ?? null,
      payerAuthReference:
        (authDetails ? readStr(authDetails, 'authCode') : null) ?? readStr(matching, 'guid'),
      status: (readStr(matching, 'status') ?? 'SUBMITTED').toUpperCase(),
      doctorApproved: typeof matching.doctorApproved === 'boolean' ? matching.doctorApproved : null,
      needsDoctorApproval: Boolean(matching.needsDoctorApproval),
      interimApprovedAmountKes: readNumMoney(matching.totalInterimApprovedAmountForPreauth),
      finalApprovedAmountKes: readNumMoney(matching.finalApprovedAmount),
      rejectionReason: readStr(matching, 'rejectionReason', 'reason'),
      errors: [],
      httpStatus: res.status,
      correlationId,
    };
  } catch (error) {
    return {
      accepted: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      hiePreauthGuid: req.hiePreauthGuid ?? null,
      payerAuthReference: null,
      status: 'UNAVAILABLE',
      doctorApproved: null,
      needsDoctorApproval: false,
      interimApprovedAmountKes: null,
      finalApprovedAmountKes: null,
      rejectionReason: error instanceof Error ? error.message : 'Transport failure',
      errors: [],
      httpStatus: null,
      correlationId,
    };
  }
}

export async function cancelHiePreauth(
  context: ShaGatewayContext,
  req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    reason: string;
    correlationId?: string;
  },
) {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (cfg.mode === 'mock') {
    return {
      cancelled: true,
      source: 'SANDBOX_SIMULATION' as const,
      isSimulated: true,
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      cancelled: false,
      source: 'UNAVAILABLE' as const,
      isSimulated: false,
      errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      correlationId,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const res = await context.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.preauthCancelPath}`, {
      method: 'POST',
      headers: context.buildServiceAccountHeaders(cfg, token, correlationId, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        consent_token: req.consentToken,
        ...(req.hiePreauthGuid ? { guid: req.hiePreauthGuid } : {}),
        reason: req.reason,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return {
      cancelled: res.ok,
      source: (res.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER') as VerificationSource,
      isSimulated: false,
      errorMessage: res.ok ? null : `HIE preauth cancellation returned HTTP ${res.status}.`,
      correlationId,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      cancelled: false,
      source: 'UNAVAILABLE' as const,
      isSimulated: false,
      errorMessage: error instanceof Error ? error.message : 'Preauth cancellation failed.',
      correlationId,
    };
  }
}
