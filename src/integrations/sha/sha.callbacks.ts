/** SHA gateway concern: callbacks. */
import { randomUUID } from 'node:crypto';
import { asObj, readStr } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  RegisterHieCallbackEndpointRequest,
  RegisterHieCallbackEndpointResult,
} from './sha.types.ts';

/**
 * Registers an HIE status callback endpoint (`POST /tenants/{tenant_id}/endpoints`
 * + `POST /tenants/{tenant_id}/endpoints/{endpoint_id}/operations`).
 * Per official HIE spec, only `environment: 'sandbox' | 'production'` is accepted (`'prod'` is rejected).
 */
export async function registerCallbackEndpoint(
  context: ShaGatewayContext,
  req: RegisterHieCallbackEndpointRequest,
): Promise<RegisterHieCallbackEndpointResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (req.environment !== 'sandbox' && req.environment !== 'production') {
    return {
      registered: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      endpointId: null,
      operationId: null,
      errorMessage:
        'Invalid callback environment; DHA HIE accepts only "sandbox" or "production" ("prod" is rejected).',
      correlationId,
    };
  }

  if (!req.baseUrl.startsWith('https://')) {
    return {
      registered: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      endpointId: null,
      operationId: null,
      errorMessage: 'Callback base_url must use https://.',
      correlationId,
    };
  }

  if (cfg.mode === 'mock') {
    return {
      registered: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      endpointId: randomUUID(),
      operationId: randomUUID(),
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl || !cfg.facilityRegistryCode) {
    return {
      registered: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      endpointId: null,
      operationId: null,
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
    const epPath = cfg.callbackEndpointsPathTemplate.replace(
      '{tenant_id}',
      encodeURIComponent(cfg.facilityRegistryCode),
    );

    const authType = req.authType ?? 'none';
    const epRes = await context.fetchImpl(`${cfg.middlewareBaseUrl}${epPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `JaliCare ${req.entityType} status callbacks`,
        entity_type: req.entityType,
        environment: req.environment,
        base_url: req.baseUrl,
        facility_fr_code: cfg.facilityRegistryCode,
        auth_type: authType,
        ...(authType !== 'none' && req.secretRef ? { secret_ref: req.secretRef } : {}),
      }),
      signal: controller.signal,
    });

    const epJson = asObj(await epRes.json().catch(() => null));
    const endpointId = epJson ? readStr(epJson, 'endpoint_id') : null;
    if (!epRes.ok || !endpointId) {
      clearTimeout(timer);
      return {
        registered: false,
        source: epRes.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        endpointId: null,
        operationId: null,
        errorMessage: `HIE callback endpoint registration returned HTTP ${epRes.status}.`,
        correlationId,
      };
    }

    const opRes = await context.fetchImpl(
      `${cfg.middlewareBaseUrl}${epPath}/${encodeURIComponent(endpointId)}/operations`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: `${req.entityType} status_changed`,
          action: 'status_changed',
          method: 'POST',
          path: req.callbackPath.startsWith('/') ? req.callbackPath : `/${req.callbackPath}`,
          request_content_type: 'application/json',
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    const opJson = asObj(await opRes.json().catch(() => null));
    const operationId = opJson ? readStr(opJson, 'operation_id') : null;

    return {
      registered: opRes.ok,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      endpointId,
      operationId,
      errorMessage: opRes.ok
        ? null
        : `HIE callback operation registration returned HTTP ${opRes.status}.`,
      correlationId,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      registered: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      endpointId: null,
      operationId: null,
      errorMessage: error instanceof Error ? error.message : 'Callback registration failed.',
      correlationId,
    };
  }
}
