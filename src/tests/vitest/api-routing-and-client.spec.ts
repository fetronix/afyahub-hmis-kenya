/**
 * End-to-end Express routing and API client JSON/HTML contract tests.
 *
 * Verifies the exact failure class where `/api/tenants`, `/api/facilities`,
 * and `/api/audit-logs` had their `/api` prefix doubled to `/api/api/...`
 * inside `app.use('/api', createApiRoutes())` and fell through to Vite's
 * SPA `index.html` fallback (`<!doctype html>...`).
 *
 * Also verifies `fetchJson` / `api.*` response status, content-type, empty
 * payload, unexpected HTML, unauthorized 401 session cleanup, forbidden 403
 * tenant/facility enforcement, and stack-trace sanitization.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as authService from '../../auth/auth.service.ts';
import * as authorizationService from '../../auth/authorization.service.ts';
import { ScopeAccessError } from '../../auth/scope.service.ts';
import * as queries from '../../db/queries.ts';
import {
  api,
  ApiError,
  clearSessionToken,
  fetchJson,
  getSessionToken,
  onUnauthorizedSession,
  setSessionToken,
} from '../../api/client.ts';

process.env.NODE_ENV = 'test';

const { createApp } = await import('../../app.ts');

const VALID_TOKEN = 'a'.repeat(64);

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('Express API routing for tenants, facilities, audit logs, and unmatched API paths', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockAuthenticatedSession(options: {
    userId?: number;
    tenantId: number | null;
    facilityId: number | null;
    isSuperAdmin: boolean;
    roles: string[];
    permissions: string[];
  }) {
    const userId = options.userId ?? 1;

    vi.spyOn(authService, 'validateSession').mockResolvedValue({
      session: {
        id: 101,
        userId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      user: {
        id: userId,
        uid: 'usr-test-001',
        username: 'platform.admin',
        email: 'admin@jalicare.test',
        fullName: 'Platform Admin',
        tenantId: options.tenantId,
        facilityId: options.facilityId,
        isActive: true,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      },
    } as any);

    vi.spyOn(authorizationService, 'loadAuthorizationContext').mockResolvedValue({
      userId,
      tenantId: options.tenantId,
      facilityId: options.facilityId,
      roles: options.roles,
      permissions: options.permissions,
      isSuperAdmin: options.isSuperAdmin,
    });
  }

  it('serves GET /api/tenants as 200 application/json (not SPA HTML)', async () => {
    mockAuthenticatedSession({
      tenantId: null,
      facilityId: null,
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: ['audit.read'],
    });

    vi.spyOn(queries, 'getTenantsScoped').mockResolvedValue([
      {
        id: 1,
        name: 'Nyeri County Referral Network',
        slug: 'nyeri-network',
        isActive: true,
      } as any,
    ]);

    const response = await fetch(`${baseUrl}/api/tenants`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = await response.json();

    expect(body).toEqual([
      expect.objectContaining({
        id: 1,
        name: 'Nyeri County Referral Network',
      }),
    ]);
  });

  it('serves GET /api/facilities and GET /api/facilities?tenantId=1 as 200 application/json', async () => {
    mockAuthenticatedSession({
      tenantId: null,
      facilityId: null,
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: [],
    });

    const spy = vi.spyOn(queries, 'getFacilitiesScoped').mockResolvedValue([
      {
        id: 10,
        tenantId: 1,
        code: 'NYR-001',
        name: 'Nyeri County Referral Hospital',
      } as any,
    ]);

    const response = await fetch(`${baseUrl}/api/facilities?tenantId=1`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ isSuperAdmin: true }), 1);

    const body = await response.json();

    expect(body).toEqual([
      expect.objectContaining({
        id: 10,
        tenantId: 1,
        name: 'Nyeri County Referral Hospital',
      }),
    ]);
  });

  it('serves GET /api/audit-logs as 200 application/json for authorized callers', async () => {
    mockAuthenticatedSession({
      tenantId: null,
      facilityId: null,
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: ['audit.read'],
    });

    vi.spyOn(queries, 'getAuditLogs').mockResolvedValue([
      {
        id: 501,
        action: 'AUTH_LOGIN_SUCCESS',
        resource: 'session',
        userId: 'platform.admin',
        timestamp: '2026-10-27T08:00:00.000Z',
      } as any,
    ]);

    const response = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = await response.json();

    expect(body).toEqual([
      expect.objectContaining({
        id: 501,
        action: 'AUTH_LOGIN_SUCCESS',
      }),
    ]);
  });

  it('returns 401 JSON when tenant, facility, or audit endpoints are called without a valid session', async () => {
    for (const path of ['/api/tenants', '/api/facilities', '/api/audit-logs']) {
      const response = await fetch(`${baseUrl}${path}`);

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');

      const body = await response.json();

      expect(body.error).toBe('UNAUTHORIZED');
    }
  });

  it('enforces 403 tenant and facility boundaries on facility and audit endpoints', async () => {
    mockAuthenticatedSession({
      userId: 22,
      tenantId: 1,
      facilityId: 10,
      isSuperAdmin: false,
      roles: ['AUDITOR'],
      permissions: ['audit.read'],
    });

    vi.spyOn(queries, 'getFacilitiesScoped').mockRejectedValue(
      new ScopeAccessError('You are not authorized to access this tenant.', 'TENANT_ACCESS_DENIED'),
    );

    const crossTenantRes = await fetch(`${baseUrl}/api/facilities?tenantId=2`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(crossTenantRes.status).toBe(403);
    expect(crossTenantRes.headers.get('content-type')).toContain('application/json');
    await expect(crossTenantRes.json()).resolves.toMatchObject({
      error: 'TENANT_ACCESS_DENIED',
    });

    vi.spyOn(queries, 'getFacilityByIdScoped').mockRejectedValue(
      new ScopeAccessError(
        'You are not authorized to access this facility.',
        'FACILITY_ACCESS_DENIED',
      ),
    );

    const crossFacilityAuditRes = await fetch(`${baseUrl}/api/audit-logs?facilityId=99`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(crossFacilityAuditRes.status).toBe(403);
    expect(crossFacilityAuditRes.headers.get('content-type')).toContain('application/json');
    await expect(crossFacilityAuditRes.json()).resolves.toMatchObject({
      error: 'FACILITY_ACCESS_DENIED',
    });
  });

  it('rejects unassigned non-superadmin accounts (tenantId === null && !isSuperAdmin) with 403 TENANT_NOT_ASSIGNED', async () => {
    mockAuthenticatedSession({
      userId: 33,
      tenantId: null,
      facilityId: null,
      isSuperAdmin: false,
      roles: ['STAFF'],
      permissions: [],
    });

    for (const path of ['/api/tenants', '/api/facilities']) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toMatchObject({
        error: 'TENANT_NOT_ASSIGNED',
      });
    }
  });

  it('returns 404 JSON (never Vite SPA index.html) when an authenticated caller requests an unknown /api route', async () => {
    mockAuthenticatedSession({
      tenantId: null,
      facilityId: null,
      isSuperAdmin: true,
      roles: ['SUPER_ADMIN'],
      permissions: [],
    });

    for (const method of ['GET', 'POST'] as const) {
      const response = await fetch(`${baseUrl}/api/non-existent-endpoint`, {
        method,
        headers: {
          Authorization: `Bearer ${VALID_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: method === 'POST' ? '{}' : undefined,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');

      const text = await response.text();

      expect(text.toLowerCase()).not.toContain('<!doctype');
      expect(text.toLowerCase()).not.toContain('<html');

      const parsed = JSON.parse(text);

      expect(parsed).toMatchObject({
        success: false,
        error: 'NOT_FOUND',
      });
    }
  });

  it('preserves API JSON responses and JSON 404 barrier in production static SPA mode', async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousCors = process.env.CORS_ORIGINS;
    const previousPublicUrl = process.env.PUBLIC_APP_URL;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://hmis.jalicare.co.ke';
    process.env.PUBLIC_APP_URL = 'https://hmis.jalicare.co.ke';

    let prodServer: Server | null = null;

    try {
      vi.resetModules();
      const prodAuthService = await import('../../auth/auth.service.ts');
      const prodAuthzService = await import('../../auth/authorization.service.ts');
      const prodQueries = await import('../../db/queries.ts');
      const { createApp: createProdApp } = await import('../../app.ts');

      vi.spyOn(prodAuthService, 'validateSession').mockResolvedValue({
        session: { id: 201, userId: 1, expiresAt: new Date(Date.now() + 3_600_000) },
        user: {
          id: 1,
          uid: 'usr-prod-1',
          username: 'superadmin',
          email: 'admin@jalicare.co.ke',
          fullName: 'Super Admin',
          tenantId: null,
          facilityId: null,
          isActive: true,
          accountStatus: 'ACTIVE',
          mustChangePassword: false,
          mfaEnabled: false,
          mfaRequired: false,
        },
      } as any);

      vi.spyOn(prodAuthzService, 'loadAuthorizationContext').mockResolvedValue({
        userId: 1,
        tenantId: null,
        facilityId: null,
        roles: ['SUPER_ADMIN'],
        permissions: ['audit.read'],
        isSuperAdmin: true,
      });

      vi.spyOn(prodQueries, 'getTenantsScoped').mockResolvedValue([
        { id: 1, name: 'Nyeri County Health', slug: 'nyeri', isActive: true } as any,
      ]);

      const prodApp = await createProdApp();
      prodServer = prodApp.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => prodServer!.once('listening', resolve));
      const prodBase = `http://127.0.0.1:${(prodServer.address() as AddressInfo).port}`;

      const tenantsRes = await fetch(`${prodBase}/api/tenants`, {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(tenantsRes.status).toBe(200);
      expect(tenantsRes.headers.get('content-type')).toContain('application/json');
      await expect(tenantsRes.json()).resolves.toHaveLength(1);

      const missingRes = await fetch(`${prodBase}/api/missing-in-production`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(missingRes.status).toBe(404);
      expect(missingRes.headers.get('content-type')).toContain('application/json');
      await expect(missingRes.json()).resolves.toMatchObject({
        success: false,
        error: 'NOT_FOUND',
      });
    } finally {
      if (prodServer) {
        await new Promise<void>((resolve) => prodServer!.close(() => resolve()));
      }
      process.env.NODE_ENV = previousEnv;
      if (previousCors === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = previousCors;
      if (previousPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
      else process.env.PUBLIC_APP_URL = previousPublicUrl;
    }
  });
});

describe('Centralized API client (fetchJson / api.*) defensive response handling', () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    });
    clearSessionToken();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('throws a diagnostic ApiError instead of SyntaxError when a 200 HTML page is returned', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    ) as unknown as typeof fetch;

    await expect(fetchJson('/api/tenants?nationalId=12345678')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(ApiError);
        const apiErr = error as ApiError;
        expect(apiErr.code).toBe('UNEXPECTED_HTML_RESPONSE');
        expect(apiErr.status).toBe(200);
        expect(apiErr.message).toContain('/api/tenants');
        expect(apiErr.message).toContain('HTML');
        /* Query parameters must never be echoed into diagnostic errors. */
        expect(apiErr.message).not.toContain('12345678');
        expect(apiErr.message).not.toContain('Unexpected token');
        return true;
      },
    );
  });

  it('maps 503 HTML gateway pages and network failures to SERVICE_UNAVAILABLE', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>503 Service Temporarily Unavailable</body></html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      }),
    ) as unknown as typeof fetch;

    await expect(api.getTenants()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });

    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    await expect(api.getFacilities()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('handles 204 No Content cleanly and rejects unexpected empty 200 GET bodies', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;

    await expect(fetchJson('/api/wards/1', { method: 'DELETE' })).resolves.toBeUndefined();

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(api.getTenants()).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      code: 'EMPTY_RESPONSE',
    });
  });

  it('clears the stored session token and notifies unauthorized listeners on 401', async () => {
    setSessionToken(VALID_TOKEN);
    const onExpired = vi.fn();
    const unsubscribe = onUnauthorizedSession(onExpired);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: 'INVALID_SESSION',
          message: 'Your session is invalid, expired, or has been revoked.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    await expect(api.getTenants()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_SESSION',
    });

    expect(getSessionToken()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('redacts accidental stack traces, server paths, DB URIs, and tokens from error messages', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'INTERNAL_ERROR',
          message:
            'Query failed on postgres://admin:secret@db.internal:5432/hmis\n    at query (/app/src/db/queries.ts:44:12)',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    await expect(api.getAuditLogs()).rejects.toSatisfy((error: unknown) => {
      const apiErr = error as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.message).toBe('An unexpected server error occurred.');
      expect(apiErr.message).not.toContain('postgres://');
      expect(apiErr.message).not.toContain('queries.ts');
      return true;
    });
  });
});
