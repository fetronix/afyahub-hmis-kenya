/** Shared per-adapter configuration, safe telemetry and bounded HTTP transport. */
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  describeShaConnectionStatus,
  loadShaConfig,
  type ShaConfig,
  type ShaConnectionStatusReport,
  type ShaEnvironmentMode,
} from './sha.config.ts';
import { asObj, readStr } from './sha.values.ts';
import type { FetchLike, ShaGatewayAdapterOptions } from './sha.gateway-types.ts';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class ShaGatewayContext {
  private readonly configOverride?: ShaConfig;

  public readonly fetchImpl: FetchLike;

  private readonly shouldRecordAuditCall: boolean;

  private cachedToken: CachedToken | null = null;

  constructor(options: ShaGatewayAdapterOptions = {}) {
    this.configOverride = options.config;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.shouldRecordAuditCall = options.recordAuditCall ?? true;
  }

  public resolveConfig(facilityRegistryOverride?: string | null): ShaConfig {
    const base = this.configOverride ?? loadShaConfig();
    if (facilityRegistryOverride && facilityRegistryOverride.trim().length > 0) {
      return loadShaConfig({ ...base, facilityRegistryCode: facilityRegistryOverride.trim() });
    }
    return base;
  }

  public getConnectionStatus(facilityRegistryOverride?: string | null): ShaConnectionStatusReport {
    const cfg = this.resolveConfig(facilityRegistryOverride);
    return describeShaConnectionStatus(cfg, facilityRegistryOverride);
  }

  /**
   * Builds official DHA HIE service-account headers (`X-Facility-Id`, `X-Facility-Id-Type: fr-code`,
   * `Authorization: Bearer <token>`, `X-Correlation-Id`).
   */
  public buildServiceAccountHeaders(
    cfg: ShaConfig,
    token: string,
    correlationId: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
      ...extra,
    };
    if (cfg.facilityRegistryCode) {
      headers['X-Facility-Id'] = cfg.facilityRegistryCode;
      headers['X-Facility-Id-Type'] = cfg.facilityIdType;
    }
    return headers;
  }

  public async logGatewayCall(entry: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    correlationId: string;
    operation: string;
    mode: ShaEnvironmentMode;
    httpMethod: string;
    endpointPath: string;
    subjectHint: string | null;
    httpStatus: number | null;
    outcome: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    durationMs: number;
  }): Promise<void> {
    if (!this.shouldRecordAuditCall) return;
    try {
      await db.insert(schema.dhaApiCalls).values({
        tenantId: entry.tenantId,
        facilityId: entry.facilityId,
        userId: entry.actorUserId,
        mode: entry.mode,
        operation: `sha.${entry.operation}`,
        method: entry.httpMethod,
        path: entry.endpointPath,
        status: entry.httpStatus,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        outcome: entry.outcome,
        errorCode: entry.errorCode ?? null,
        requestId: entry.correlationId,
      });
    } catch {
      // Never fail clinical/billing workflow if the telemetry table is unreachable in unit tests.
    }
  }

  public async obtainAccessToken(cfg: ShaConfig, correlationId: string): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - 30_000 > now) {
      return this.cachedToken.accessToken;
    }

    if (!cfg.middlewareBaseUrl || !cfg.clientId || !cfg.clientSecret) {
      throw new Error('Missing SHA OAuth2 credentials');
    }

    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, 'utf8').toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      // HIE `/tenants/token` reads `{ client_id, client_secret }` from JSON body;
      // SMART-on-FHIR / OAuth2 token servers read Basic Auth + `grant_type: client_credentials`.
      const res = await this.fetchImpl(`${cfg.middlewareBaseUrl}${cfg.tokenPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: 'client_credentials',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Token endpoint returned HTTP ${res.status}`);
      }

      const json = asObj(await res.json());
      const data = json ? (asObj(json.data) ?? json) : null;
      const token = data ? readStr(data, 'access_token', 'token', 'accessToken') : null;
      if (!token) {
        throw new Error('Token endpoint did not return an access_token');
      }

      const expiresIn =
        data && typeof data.expires_in === 'number' && data.expires_in > 60 ? data.expires_in : 900;

      this.cachedToken = {
        accessToken: token,
        expiresAtMs: now + expiresIn * 1000,
      };
      return token;
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchGetWithBoundedRetry(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    maxRetries: number,
  ): Promise<Response> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          attempt += 1;
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (attempt >= maxRetries) throw err;
        attempt += 1;
      }
    }
    throw lastError ?? new Error('SHA GET request failed');
  }
}
