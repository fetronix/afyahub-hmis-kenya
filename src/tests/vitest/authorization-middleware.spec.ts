/**
 * Authorization middleware — what happens at the door of every protected route
 *
 * `src/auth/authorization.middleware.ts` builds the guards mounted in front of
 * the API. The previous suite for it asserted that certain source lines
 * existed. This one drives the real middleware functions with a fake request,
 * a fake response and a spy for `next`, and then asks what the client would
 * have received.
 *
 * Only one thing is stubbed: `loadAuthorizationContext`, which is the
 * database read. Everything that decides the answer — `hasAllPermissions`,
 * `hasAnyPermission`, `hasRole`, `canAccessTenant` — is the real
 * implementation.
 *
 * The properties pinned:
 *
 *   1. A caller with no session is told 401, never 403. The distinction
 *      matters: 403 tells an unauthenticated client that the account exists
 *      and simply lacks the permission.
 *   2. `next()` is called on exactly the paths that allow the request, and
 *      on no other. A guard that responds *and* calls next runs the handler
 *      anyway, which is the worst possible failure — the client sees a 403
 *      while the write has already happened.
 *   3. A failed context load is 403, not 500, and not a pass.
 *   4. A thrown error is 500 and does not call next.
 *   5. Error bodies do not name the permission, the role or the tenant that
 *      was refused.
 *
 * Every user, tenant and permission string here is invented.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';

/*
 * Stub only the database read. `importOriginal` keeps the real predicates, so
 * the permission, role and tenant logic under test is the shipped logic.
 */
const loadAuthorizationContext = vi.fn();

vi.mock('../../auth/authorization.service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/authorization.service.ts')>();

  return {
    ...actual,
    loadAuthorizationContext: (...args: unknown[]) => loadAuthorizationContext(...args),
  };
});

const {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireRole,
  requireTenantAccess,
  requireSuperAdmin,
} = await import('../../auth/authorization.middleware.ts');

/* ============================================================
   Fakes
   ============================================================ */

interface FakeResponse {
  statusCode: number | null;
  body: Record<string, unknown> | null;
  status: (code: number) => FakeResponse;
  json: (payload: Record<string, unknown>) => FakeResponse;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };

  return res;
}

function context(over: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId: 7,
    tenantId: 101,
    facilityId: 1001,
    roles: ['CLINICIAN'],
    permissions: ['patients.read'],
    isSuperAdmin: false,
    ...over,
  };
}

/** Run a middleware and collect what the client would have seen. */
async function drive(
  middleware: (req: any, res: any, next: any) => Promise<void> | void,
  req: Record<string, unknown>,
): Promise<{ res: FakeResponse; next: ReturnType<typeof vi.fn> }> {
  const res = fakeResponse();
  const next = vi.fn();

  await middleware(req, res, next);

  return { res, next };
}

beforeEach(() => {
  loadAuthorizationContext.mockReset();
});

/* ============================================================
   1. requirePermission
   ============================================================ */

describe('requirePermission', () => {
  it('answers 401 and does not continue when there is no session', async () => {
    const { res, next } = await drive(requirePermission('patients.read'), {});

    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
    /* The context loader must not be reached with no user id. */
    expect(loadAuthorizationContext).not.toHaveBeenCalled();
  });

  it('continues when the caller holds every required permission', async () => {
    const { res, next } = await drive(requirePermission('patients.read'), {
      user: { id: 7 },
      authContext: context(),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('requires ALL of several permissions, not any of them', async () => {
    /*
     * The distinction between requirePermission and requireAnyPermission is
     * the whole reason both exist. A caller holding one of two must be
     * refused here.
     */
    const middleware = requirePermission('patients.read', 'patients.write');

    const partial = await drive(middleware, { user: { id: 7 }, authContext: context() });
    expect(partial.res.statusCode).toBe(403);
    expect(partial.res.body?.error).toBe('FORBIDDEN');
    expect(partial.next).not.toHaveBeenCalled();

    const full = await drive(middleware, {
      user: { id: 7 },
      authContext: context({ permissions: ['patients.read', 'patients.write'] }),
    });
    expect(full.next).toHaveBeenCalledTimes(1);
  });

  it('refuses a caller whose permissions do not include the required one', async () => {
    const { res, next } = await drive(requirePermission('billing.write'), {
      user: { id: 7 },
      authContext: context(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('loads the context when the request does not carry one', async () => {
    loadAuthorizationContext.mockResolvedValue(context({ permissions: ['billing.write'] }));

    const req: Record<string, unknown> = { user: { id: 7 } };
    const { next } = await drive(requirePermission('billing.write'), req);

    expect(loadAuthorizationContext).toHaveBeenCalledWith(7);
    expect(req.authContext).toMatchObject({ userId: 7 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers 403 when the account has no authorization context at all', async () => {
    loadAuthorizationContext.mockResolvedValue(null);

    const { res, next } = await drive(requirePermission('patients.read'), { user: { id: 7 } });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('AUTHORIZATION_FAILED');
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 500 and does not continue when the context load throws', async () => {
    /*
     * A database outage must not become an authorization pass. It also must
     * not become a 403, which would tell the caller their permissions are
     * wrong when the real problem is the server.
     */
    loadAuthorizationContext.mockRejectedValue(new Error('connection terminated'));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { res, next } = await drive(requirePermission('patients.read'), { user: { id: 7 } });

    expect(res.statusCode).toBe(500);
    expect(res.body?.error).toBe('AUTHORIZATION_ERROR');
    expect(next).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('does not name the missing permission or the internal reason', async () => {
    const { res } = await drive(requirePermission('billing.refund.approve'), {
      user: { id: 7 },
      authContext: context(),
    });

    const serialised = JSON.stringify(res.body);

    expect(serialised).not.toContain('billing.refund.approve');
    expect(serialised).not.toContain('permissions');
    expect(serialised).not.toMatch(/stack|at \w+ \(/);
  });

  it('KNOWN FOOTGUN: an empty permission list allows everyone', async () => {
    /*
     * `hasAllPermissions` is `[].every(...)`, which is true. So
     * `requirePermission()` with no arguments — reachable from a typo'd
     * spread, or a route that forwards `...undefined` — protects nothing
     * while looking exactly like a guard.
     *
     * Pinned rather than changed: making an empty list deny would turn a
     * startup-time typo into a 403 for real users, and the safer fix is a
     * lint or startup assertion on the call sites, which is out of scope
     * here. Recorded so the next reader knows.
     */
    const { res, next } = await drive(requirePermission(), {
      user: { id: 7 },
      authContext: context(),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('does not let a super admin bypass an explicit permission requirement', async () => {
    /*
     * There is no super-admin clause in hasPermission: a platform admin's
     * permissions come from the database like everyone else's, and
     * requireSuperAdmin is the separate, explicit way to gate a route on
     * being one. Pinning it means a future "helpful" bypass shows up here.
     */
    const { res, next } = await drive(requirePermission('patients.read'), {
      user: { id: 7 },
      authContext: context({ isSuperAdmin: true, permissions: [] }),
    });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

/* ============================================================
   2. requireAnyPermission
   ============================================================ */

describe('requireAnyPermission', () => {
  it('continues when the caller holds one of the permissions', async () => {
    const { next } = await drive(requireAnyPermission('patients.read', 'patients.write'), {
      user: { id: 7 },
      authContext: context(),
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('refuses a caller holding none of them', async () => {
    const { res, next } = await drive(requireAnyPermission('billing.write', 'billing.refund'), {
      user: { id: 7 },
      authContext: context(),
    });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const { res, next } = await drive(requireAnyPermission('patients.read'), {});

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('CONTRAST: an empty list denies, where requirePermission allows', async () => {
    /*
     * The asymmetry follows from `some` versus `every` over an empty array.
     * It is a real difference in behaviour between two guards that look
     * interchangeable, so it is pinned rather than left to be discovered.
     */
    const { res, next } = await drive(requireAnyPermission(), {
      user: { id: 7 },
      authContext: context(),
    });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

/* ============================================================
   3. requireRole
   ============================================================ */

describe('requireRole', () => {
  it('continues when the caller holds any one of the roles', async () => {
    const { next } = await drive(requireRole('DOCTOR', 'NURSE'), {
      user: { id: 7 },
      authContext: context({ roles: ['NURSE'] }),
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('refuses a caller holding none of the roles', async () => {
    const { res, next } = await drive(requireRole('DOCTOR'), {
      user: { id: 7 },
      authContext: context({ roles: ['CLINICIAN'] }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('matches the role name exactly', async () => {
    /* A case-insensitive comparison here would let `doctor` through. */
    const { res } = await drive(requireRole('DOCTOR'), {
      user: { id: 7 },
      authContext: context({ roles: ['doctor'] }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('answers 401 without a session', async () => {
    const { res } = await drive(requireRole('DOCTOR'), {});

    expect(res.statusCode).toBe(401);
  });

  it('answers 403 when no context can be loaded', async () => {
    loadAuthorizationContext.mockResolvedValue(null);

    const { res, next } = await drive(requireRole('DOCTOR'), { user: { id: 7 } });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

/* ============================================================
   4. requireTenantAccess
   ============================================================ */

describe('requireTenantAccess', () => {
  const ownTenant = requireTenantAccess(() => 101);

  it('continues for the caller\u2019s own tenant', async () => {
    const { next } = await drive(ownTenant, { user: { id: 7 }, authContext: context() });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('refuses a tenant the caller does not belong to', async () => {
    const foreign = requireTenantAccess(() => 202);

    const { res, next } = await drive(foreign, { user: { id: 7 }, authContext: context() });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('TENANT_ACCESS_DENIED');
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses when the route cannot determine a tenant', async () => {
    /* A null tenant must fail closed: treating it as "no restriction" would
     * turn a missing parameter into platform-wide access. */
    const unknown = requireTenantAccess(() => null);

    const { res, next } = await drive(unknown, { user: { id: 7 }, authContext: context() });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('TENANT_ACCESS_DENIED');
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses even a super admin when the route cannot determine a tenant', async () => {
    /*
     * The most privileged account in the system must not be let through by a
     * missing parameter. `canAccessTenant` validates the id before its
     * super-admin clause, so this holds twice over - which is why the
     * `tenantId === null` check ahead of it is defence in depth rather than
     * the only thing standing there. Asserting the outcome keeps both layers
     * honest if either is ever relaxed.
     */
    const unknown = requireTenantAccess(() => null);

    const { res, next } = await drive(unknown, {
      user: { id: 7 },
      authContext: context({ isSuperAdmin: true, tenantId: null }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('TENANT_ACCESS_DENIED');
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a super admin through to any tenant', async () => {
    const foreign = requireTenantAccess(() => 202);

    const { next } = await drive(foreign, {
      user: { id: 7 },
      authContext: context({ isSuperAdmin: true, tenantId: null }),
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('shows which tenant was requested to the resolver, without leaking it', async () => {
    const seen: unknown[] = [];
    const middleware = requireTenantAccess((req) => {
      seen.push(req.params?.tenantId);
      return 202;
    });

    const { res } = await drive(middleware, {
      user: { id: 7 },
      params: { tenantId: '202' },
      authContext: context(),
    });

    expect(seen).toStrictEqual(['202']);
    expect(JSON.stringify(res.body)).not.toContain('202');
  });

  it('DIFFERENT CONTRACT: answers 500, not 401, when the context is missing', async () => {
    /*
     * Unlike requirePermission, this guard does not try to load the context
     * itself — it has no user guard in front of it to guarantee a user id.
     * A missing context here means the route was mounted without
     * requireAuthorization, which is a server wiring bug, so 500 is the
     * honest answer and 401 would mislead.
     */
    const { res, next } = await drive(ownTenant, { user: { id: 7 } });

    expect(res.statusCode).toBe(500);
    expect(res.body?.error).toBe('AUTHORIZATION_CONTEXT_MISSING');
    expect(next).not.toHaveBeenCalled();
  });
});

/* ============================================================
   5. requireSuperAdmin
   ============================================================ */

describe('requireSuperAdmin', () => {
  it('answers 401 without a session', async () => {
    const { res, next } = await drive(requireSuperAdmin(), {});

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 403 when no context can be loaded', async () => {
    loadAuthorizationContext.mockResolvedValue(null);

    const { res, next } = await drive(requireSuperAdmin(), { user: { id: 7 } });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('AUTHORIZATION_FAILED');
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses an ordinary administrator with a distinct code', async () => {
    /*
     * SUPER_ADMIN_REQUIRED rather than a generic FORBIDDEN, so the client
     * can tell "you are not allowed to do this" from "you are not a
     * platform administrator".
     */
    const { res, next } = await drive(requireSuperAdmin(), {
      user: { id: 7 },
      authContext: context({ roles: ['TENANT_ADMIN'] }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('SUPER_ADMIN_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('continues for a super admin', async () => {
    const { next } = await drive(requireSuperAdmin(), {
      user: { id: 7 },
      authContext: context({ isSuperAdmin: true }),
    });

    expect(next).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
   6. requireAuthorization
   ============================================================ */

describe('requireAuthorization', () => {
  it('answers 401 without a session', async () => {
    const { res, next } = await drive(requireAuthorization, {});

    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches the context and continues', async () => {
    loadAuthorizationContext.mockResolvedValue(context());

    const req: Record<string, unknown> = { user: { id: 7 } };
    const { next } = await drive(requireAuthorization, req);

    expect(req.authContext).toMatchObject({ userId: 7, tenantId: 101 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers 403 when the account has no context, without leaking why', async () => {
    loadAuthorizationContext.mockResolvedValue(null);

    const { res, next } = await drive(requireAuthorization, { user: { id: 7 } });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/role|permission|tenant_id/i);
  });
});

/* ============================================================
   7. A refused request never reaches the handler
   ============================================================ */

describe('a refused request never reaches the handler', () => {
  const guards = [
    ['requirePermission', () => requirePermission('billing.write')],
    ['requireAnyPermission', () => requireAnyPermission('billing.write')],
    ['requireRole', () => requireRole('SUPERVISOR')],
    ['requireTenantAccess', () => requireTenantAccess(() => 202)],
    ['requireSuperAdmin', () => requireSuperAdmin()],
  ] as const;

  it.each(guards)('%s responds and does not call next', async (_name, build) => {
    /*
     * A guard that writes a 403 *and* calls next has already run the
     * handler: the client sees a refusal while the row has been written.
     * This is the single most damaging way an authorization layer fails, so
     * it is asserted for every guard at once.
     */
    const middleware = build();
    const { res, next } = await drive(middleware, { user: { id: 7 }, authContext: context() });

    expect(res.statusCode).not.toBeNull();
    expect(next).not.toHaveBeenCalled();
  });
});
