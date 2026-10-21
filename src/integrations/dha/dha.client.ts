/**
 * JaliCare HMIS
 * DHA / AfyaConnect — HTTP client
 *
 * Responsibilities, in order of importance:
 *
 * 1. Never log, return or throw a secret or a patient payload.
 * 2. Never call an undocumented endpoint.
 * 3. Behave predictably when the network is slow, rate limiting kicks in
 *    or the provider is down.
 *
 * Requests carry `X-Facility-Id` and `X-Facility-Id-Type: fr-code`, which
 * the documentation says are required when authenticating with a
 * service-account token.
 */

import {
  DhaError,
  safeProviderMessage,
  statusToCode,
} from './dha.errors.ts';

import type { DhaConfig, DhaMode } from './dha.config.ts';
import type { DhaTokenResponse } from './dha.contracts.ts';

import { DHA_ENDPOINTS } from './dha.contracts.ts';
import { mockResponse, isMockableOperation } from './dha.mock.ts';

/* ============================================================
   AUDIT
   ============================================================ */

export interface DhaAuditEvent {
  mode: DhaMode;
  /** Logical operation, e.g. "eligibility.check". */
  operation: string;
  method: string;
  /** Templated path. Never contains an identifier from a request. */
  path: string;
  status: number | null;
  durationMs: number;
  outcome: 'SUCCESS' | 'ERROR';
  errorCode: string | null;
  requestId: string | null;
}

export interface DhaCallContext {
  tenantId?: number | null;
  facilityId?: number | null;
  userId?: number | null;
  /** Called for every attempt that reaches a terminal state. */
  onAudit?: (event: DhaAuditEvent) => void | Promise<void>;
}

/* ============================================================
   TOKEN CACHE
   ============================================================ */

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Exposed for tests. Never called at startup. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

function tokenCacheKey(config: DhaConfig): string {
  return `${config.mode}|${config.baseUrl ?? ''}|${config.clientId ?? ''}`;
}

function requestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================================================
   CONFIG GUARD
   ============================================================ */

function assertUsable(config: DhaConfig): void {
  if (!config.enabled) {
    throw new DhaError(
      config.mode === 'production' ? 'PRODUCTION_BLOCKED' : 'NOT_CONFIGURED',
      'config',
      config.disabledReason ?? 'The DHA integration is not configured.',
      { retryable: false },
    );
  }
}

/* ============================================================
   LOW-LEVEL FETCH
   ============================================================ */

interface RawRequest {
  operation: string;
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Bearer token to use; the token call itself passes none. */
  token?: string | null;
  /** The token endpoint is the one call that does not send facility headers. */
  includeFacilityHeaders?: boolean;
}

async function rawRequest<T>(
  config: DhaConfig,
  context: DhaCallContext,
  request: RawRequest,
): Promise<T> {
  assertUsable(config);

  const url = new URL(`${config.baseUrl}${request.path}`);

  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (request.token) {
    headers.Authorization = `Bearer ${request.token}`;
  }

  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (request.includeFacilityHeaders !== false && config.facilityCode) {
    headers['X-Facility-Id'] = config.facilityCode;
    headers['X-Facility-Id-Type'] = 'fr-code';
  }

  const id = requestId();
  const startedAt = Date.now();

  let attempt = 0;
  let lastError: DhaError | null = null;

  while (attempt <= config.maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = null;

      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      /* Do not leak a provider body into the audit record. */
      await audit(context, {
        mode: config.mode,
        operation: request.operation,
        method: request.method,
        path: request.path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: response.ok ? 'SUCCESS' : 'ERROR',
        errorCode: response.ok ? null : statusToCode(response.status),
        requestId: id,
      });

      if (response.ok) {
        if (parsed === null) {
          throw new DhaError(
            'INVALID_RESPONSE',
            request.operation,
            'DHA returned a response that was not JSON.',
            { status: response.status, retryable: false },
          );
        }

        return parsed as T;
      }

      const safe = safeProviderMessage(parsed);
      const code = statusToCode(response.status);

      lastError = new DhaError(
        code,
        request.operation,
        safe.message ?? `DHA returned HTTP ${response.status}.`,
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          providerCode: safe.code,
        },
      );

      if (!lastError.retryable) throw lastError;
    } catch (error) {
      if (error instanceof DhaError) {
        if (!error.retryable) throw error;

        lastError = error;
      } else {
        const aborted =
          error instanceof Error && error.name === 'AbortError';

        lastError = new DhaError(
          aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
          request.operation,
          aborted
            ? 'The DHA request timed out.'
            : 'The DHA service could not be reached.',
          { retryable: true },
        );

        await audit(context, {
          mode: config.mode,
          operation: request.operation,
          method: request.method,
          path: request.path,
          status: null,
          durationMs: Date.now() - startedAt,
          outcome: 'ERROR',
          errorCode: lastError.code,
          requestId: id,
        });
      }
    } finally {
      clearTimeout(timer);
    }

    attempt += 1;

    if (attempt <= config.maxRetries) {
      await sleep(300 * 2 ** (attempt - 1));
    }
  }

  throw (
    lastError ??
    new DhaError('NETWORK_ERROR', request.operation, 'The DHA request failed.', {
      retryable: false,
    })
  );
}

async function audit(
  context: DhaCallContext,
  event: DhaAuditEvent,
): Promise<void> {
  if (!context.onAudit) return;

  try {
    await context.onAudit(event);
  } catch {
    /* An audit sink failure must never break a clinical request. */
  }
}

/* ============================================================
   TOKEN
   ============================================================ */

/**
 * Fetch (or reuse) an access token.
 *
 * Tokens are cached per mode/base/client until 60 seconds before they
 * expire. They are never written to disk, logged, or returned to a
 * caller outside this module.
 */
export async function getAccessToken(
  config: DhaConfig,
  context: DhaCallContext,
): Promise<string> {
  assertUsable(config);

  if (config.mode === 'mock') {
    return 'mock-access-token';
  }

  const key = tokenCacheKey(config);
  const cached = tokenCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const clientId = config.clientId;
  const clientSecret = config.clientSecret;

  if (!clientId || !clientSecret) {
    throw new DhaError(
      'NOT_CONFIGURED',
      'auth.token',
      'DHA_CLIENT_ID and DHA_CLIENT_SECRET are required.',
    );
  }

  const response = await rawRequest<DhaTokenResponse>(config, context, {
    operation: 'auth.token',
    method: 'POST',
    path: DHA_ENDPOINTS.token,
    body: { client_id: clientId, client_secret: clientSecret },
    includeFacilityHeaders: false,
  });

  if (!response?.access_token) {
    throw new DhaError(
      'AUTH_FAILED',
      'auth.token',
      'DHA did not return an access token.',
      { retryable: false },
    );
  }

  const lifetimeMs = Math.max(0, (response.expires_in ?? 0) * 1000);
  const safetyWindowMs = 60_000;

  tokenCache.set(key, {
    token: response.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - safetyWindowMs),
  });

  return response.access_token;
}

/* ============================================================
   PUBLIC CALL
   ============================================================ */

export interface DhaResponse<T> {
  data: T;
  mode: DhaMode;
  /** True for mock mode. Surfaced so a screen can label the data. */
  simulated: boolean;
  retrievedAt: string;
}

export interface DhaCallOptions {
  operation: string;
  method?: 'GET' | 'POST';
  path: string;
  query?: RawRequest['query'];
  body?: unknown;
}

export async function dhaCall<T>(
  config: DhaConfig,
  context: DhaCallContext,
  options: DhaCallOptions,
): Promise<DhaResponse<T>> {
  assertUsable(config);

  if (config.mode === 'mock') {
    if (!isMockableOperation(options.operation)) {
      throw new DhaError(
        'NOT_CONFIGURED',
        options.operation,
        'This operation has no mock fixture. Use sandbox mode to exercise it.',
      );
    }

    const data = mockResponse<T>(options.operation, {
      query: options.query,
      body: options.body,
    });

    await audit(context, {
      mode: 'mock',
      operation: options.operation,
      method: options.method ?? 'GET',
      path: options.path,
      status: 200,
      durationMs: 0,
      outcome: 'SUCCESS',
      errorCode: null,
      requestId: 'mock',
    });

    return {
      data,
      mode: 'mock',
      simulated: true,
      retrievedAt: new Date().toISOString(),
    };
  }

  const token = await getAccessToken(config, context);

  const data = await rawRequest<T>(config, context, {
    operation: options.operation,
    method: options.method ?? 'GET',
    path: options.path,
    query: options.query,
    body: options.body,
    token,
  });

  return {
    data,
    mode: config.mode,
    simulated: false,
    retrievedAt: new Date().toISOString(),
  };
}
