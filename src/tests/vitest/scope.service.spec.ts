/**
 * Scope enforcement — the boundary between hospitals
 *
 * `src/auth/scope.service.ts` is the code that decides whether an
 * authenticated user may touch a particular tenant or facility. Its own
 * header states the rule it exists to enforce:
 *
 *   IDs supplied by the frontend are NEVER trusted by themselves. Every
 *   access decision must be based on the authenticated user's
 *   AuthorizationContext.
 *
 * A bug here is not a wrong number on an invoice — it is one hospital
 * reading another hospital's patients. So the tests below are written from
 * the attacker's side: take a correctly authenticated facility user, then
 * try to reach past their facility and past their tenant, and assert that
 * every route out is closed with the right error code.
 *
 * The four guarantees pinned:
 *
 *   1. **A facility user cannot change facility.** Supplying a different
 *      facilityId does not widen the scope; it is refused.
 *   2. **A tenant user cannot change tenant.** Supplying another tenantId
 *      is refused rather than silently replaced by their own — a silent
 *      replacement would look successful to the caller while acting on a
 *      different tenant than the request named.
 *   3. **A super admin gets no implicit default.** Platform-wide access
 *      requires the caller to say which tenant or facility it means.
 *   4. **Bad IDs are refused before any decision is made.** Zero, negative,
 *      fractional, NaN and missing IDs are all `INVALID_SCOPE_ID` rather
 *      than falling through to a comparison that happens to be false.
 *
 * One guarantee is deliberately *not* claimed by this module, and is tested
 * as such rather than papered over: for a tenant-level user,
 * `resolveFacilityScope` returns the requested facility without checking
 * that it belongs to their tenant. The header says the check belongs to the
 * "caller/database". Callers in this repository pair it with
 * `getFacilityByIdScoped`, which filters by tenant and returns null. There
 * is a test below that states this contract explicitly, so that a future
 * caller which forgets the second call has something to fail against.
 *
 * All contexts below are synthetic: invented user, tenant and facility ids.
 * No real user, facility or patient appears anywhere in this file.
 */

import { describe, expect, it } from 'vitest';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import {
  ScopeAccessError,
  assertFacilityOwnership,
  assertTenantOwnership,
  isFacilityLevelUser,
  isGlobalUser,
  isTenantLevelUser,
  requireFacilityScope,
  requireTenantScope,
  resolveFacilityScope,
  resolveTenantScope,
} from '../../auth/scope.service.ts';

/* ============================================================
   Fixtures
   ============================================================ */

const TENANT_A = 101;
const TENANT_B = 202;
const FACILITY_A1 = 1001;
const FACILITY_A2 = 1002;
const FACILITY_B1 = 2001;

function context(over: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId: 7,
    tenantId: TENANT_A,
    facilityId: FACILITY_A1,
    roles: ['FACILITY_ADMIN'],
    permissions: [],
    isSuperAdmin: false,
    ...over,
  };
}

/** A tenant-wide administrator: assigned to a tenant, not a facility. */
function tenantAdmin(): AuthorizationContext {
  return context({ roles: ['TENANT_ADMIN'], facilityId: null });
}

/** A platform administrator. */
function superAdmin(): AuthorizationContext {
  return context({
    tenantId: null,
    facilityId: null,
    roles: ['SUPER_ADMIN'],
    isSuperAdmin: true,
  });
}

/** Capture the ScopeAccessError a call throws, and fail loudly if it does not. */
function scopeError(run: () => unknown): ScopeAccessError {
  try {
    run();
  } catch (error) {
    if (error instanceof ScopeAccessError) return error;
    throw error;
  }

  throw new Error('Expected a ScopeAccessError, but the call returned normally.');
}

/* ============================================================
   1. The error itself
   ============================================================ */

describe('ScopeAccessError', () => {
  it('is a real error with a stable name and code', () => {
    const error = new ScopeAccessError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ScopeAccessError);
    expect(error.name).toBe('ScopeAccessError');
    expect(error.code).toBe('SCOPE_ACCESS_DENIED');
  });

  it('carries a message the user can read without leaking internals', () => {
    const error = scopeError(() => requireTenantScope(context(), TENANT_B));

    expect(error.message).toBe('You are not authorized to access this tenant.');
    /* No ids, no table names, no stack detail. */
    expect(error.message).not.toContain(String(TENANT_B));
    expect(error.message).not.toMatch(/\btenant_id\b|select |public\./i);
  });

  it('keeps the code distinct per failure so the UI can react differently', () => {
    expect(scopeError(() => requireTenantScope(context(), TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
    expect(scopeError(() => requireFacilityScope(context(), TENANT_A, FACILITY_A2)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
    expect(scopeError(() => requireTenantScope(context(), 0)).code).toBe('INVALID_SCOPE_ID');
  });
});

/* ============================================================
   2. Invalid ids are refused before any decision
   ============================================================ */

describe('invalid ids', () => {
  const bad = [0, -1, -999, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('refuses a non-positive, fractional or non-finite tenant id', () => {
    /*
     * A zero id must not be allowed to reach a comparison: `context.tenantId
     * === 0` is false for everyone, which reads like "denied" but is only
     * accidental, and `null === 0` is also false for a super admin.
     */
    for (const id of bad) {
      const error = scopeError(() => requireTenantScope(superAdmin(), id));
      expect(error.code, `tenant id ${String(id)}`).toBe('INVALID_SCOPE_ID');
      expect(error.message).toContain('tenant ID');
    }
  });

  it('refuses a bad facility id even when the tenant matches', () => {
    for (const id of bad) {
      expect(scopeError(() => requireFacilityScope(context(), TENANT_A, id)).code).toBe(
        'INVALID_SCOPE_ID',
      );
    }
  });

  it('refuses a bad facility tenant id', () => {
    for (const id of bad) {
      expect(scopeError(() => requireFacilityScope(context(), id, FACILITY_A1)).code).toBe(
        'INVALID_SCOPE_ID',
      );
    }
  });

  it('checks the tenant id before the facility id', () => {
    /* Both are invalid; the message must name the first field so the caller
     * can tell which one to fix. */
    expect(scopeError(() => requireFacilityScope(context(), 0, 0)).message).toContain(
      'facility tenant ID',
    );
  });

  it('accepts the smallest valid id', () => {
    expect(() => requireTenantScope(superAdmin(), 1)).not.toThrow();
    expect(() => requireFacilityScope(superAdmin(), 1, 1)).not.toThrow();
  });
});

/* ============================================================
   3. Tenant scope
   ============================================================ */

describe('requireTenantScope', () => {
  it('lets a user reach their own tenant', () => {
    expect(() => requireTenantScope(context(), TENANT_A)).not.toThrow();
    expect(() => requireTenantScope(tenantAdmin(), TENANT_A)).not.toThrow();
  });

  it('refuses another tenant', () => {
    expect(scopeError(() => requireTenantScope(context(), TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
    expect(scopeError(() => requireTenantScope(tenantAdmin(), TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
  });

  it('refuses a user with no tenant at all', () => {
    /* No tenant means no tenant is theirs — including tenant id 0, which is
     * invalid anyway, and any real id. */
    const homeless = context({ tenantId: null, facilityId: null });

    expect(scopeError(() => requireTenantScope(homeless, TENANT_A)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
  });

  it('lets a super admin reach any tenant', () => {
    expect(() => requireTenantScope(superAdmin(), TENANT_A)).not.toThrow();
    expect(() => requireTenantScope(superAdmin(), TENANT_B)).not.toThrow();
  });
});

/* ============================================================
   4. Facility scope
   ============================================================ */

describe('requireFacilityScope', () => {
  it('lets a facility user reach their own facility', () => {
    expect(() => requireFacilityScope(context(), TENANT_A, FACILITY_A1)).not.toThrow();
  });

  it('refuses a facility user a different facility in the same tenant', () => {
    /*
     * The most likely mistake in a multi-facility tenant: both facilities
     * belong to the same organisation, so a tenant check alone would pass.
     * The facility check is what stops it.
     */
    expect(scopeError(() => requireFacilityScope(context(), TENANT_A, FACILITY_A2)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('refuses a facility user a facility in another tenant', () => {
    expect(scopeError(() => requireFacilityScope(context(), TENANT_B, FACILITY_B1)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('refuses a facility whose tenant id does not match, even with the right facility id', () => {
    /* If the caller passes a facility id that is real but attributes it to
     * the wrong tenant, the tenant boundary must reject it — this is the
     * check that assumes the tenant id came from the database, not the
     * request. */
    expect(scopeError(() => requireFacilityScope(context(), TENANT_A, FACILITY_B1)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('lets a tenant-level user reach any facility in their own tenant', () => {
    expect(() => requireFacilityScope(tenantAdmin(), TENANT_A, FACILITY_A1)).not.toThrow();
    expect(() => requireFacilityScope(tenantAdmin(), TENANT_A, FACILITY_A2)).not.toThrow();
  });

  it('refuses a tenant-level user a facility in another tenant', () => {
    expect(scopeError(() => requireFacilityScope(tenantAdmin(), TENANT_B, FACILITY_B1)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('lets a super admin reach any facility', () => {
    expect(() => requireFacilityScope(superAdmin(), TENANT_A, FACILITY_A1)).not.toThrow();
    expect(() => requireFacilityScope(superAdmin(), TENANT_B, FACILITY_B1)).not.toThrow();
  });

  it('refuses a user with no tenant and no facility', () => {
    const homeless = context({ tenantId: null, facilityId: null });

    expect(scopeError(() => requireFacilityScope(homeless, TENANT_A, FACILITY_A1)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });
});

/* ============================================================
   5. Ownership assertions delegate to the same rules
   ============================================================ */

describe('ownership assertions', () => {
  it('assertTenantOwnership applies the tenant rule', () => {
    expect(() => assertTenantOwnership(context(), TENANT_A)).not.toThrow();
    expect(scopeError(() => assertTenantOwnership(context(), TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
    expect(scopeError(() => assertTenantOwnership(context(), 0)).code).toBe('INVALID_SCOPE_ID');
  });

  it('assertFacilityOwnership applies the facility rule', () => {
    expect(() => assertFacilityOwnership(context(), TENANT_A, FACILITY_A1)).not.toThrow();
    expect(scopeError(() => assertFacilityOwnership(context(), TENANT_A, FACILITY_A2)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });
});

/* ============================================================
   6. Resolving a tenant scope
   ============================================================ */

describe('resolveTenantScope', () => {
  it('uses the authenticated tenant when the caller asks for nothing', () => {
    expect(resolveTenantScope(context())).toBe(TENANT_A);
    expect(resolveTenantScope(context(), null)).toBe(TENANT_A);
    expect(resolveTenantScope(context(), undefined)).toBe(TENANT_A);
  });

  it('accepts the caller naming their own tenant', () => {
    expect(resolveTenantScope(context(), TENANT_A)).toBe(TENANT_A);
  });

  it('refuses the caller naming another tenant instead of silently substituting', () => {
    /*
     * Returning TENANT_A here would "work" for the caller but act on a
     * tenant the request did not name. Refusing is the only answer that
     * cannot be mistaken for success.
     */
    expect(scopeError(() => resolveTenantScope(context(), TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
  });

  it('refuses a user who has no tenant', () => {
    const homeless = context({ tenantId: null, facilityId: null });

    expect(scopeError(() => resolveTenantScope(homeless)).code).toBe('TENANT_NOT_ASSIGNED');
    expect(scopeError(() => resolveTenantScope(homeless, TENANT_A)).code).toBe(
      'TENANT_NOT_ASSIGNED',
    );
  });

  it('requires a super admin to name the tenant explicitly', () => {
    expect(scopeError(() => resolveTenantScope(superAdmin())).code).toBe('TENANT_REQUIRED');
    expect(scopeError(() => resolveTenantScope(superAdmin(), null)).code).toBe('TENANT_REQUIRED');
  });

  it('returns the tenant a super admin names', () => {
    expect(resolveTenantScope(superAdmin(), TENANT_B)).toBe(TENANT_B);
  });

  it('validates the id a super admin names', () => {
    expect(scopeError(() => resolveTenantScope(superAdmin(), 0)).code).toBe('INVALID_SCOPE_ID');
    expect(scopeError(() => resolveTenantScope(superAdmin(), 2.5)).code).toBe('INVALID_SCOPE_ID');
  });
});

/* ============================================================
   7. Resolving a facility scope
   ============================================================ */

describe('resolveFacilityScope', () => {
  it('returns the assigned facility when the caller asks for nothing', () => {
    expect(resolveFacilityScope(context())).toBe(FACILITY_A1);
    expect(resolveFacilityScope(context(), null)).toBe(FACILITY_A1);
  });

  it('ignores a request for the facility the user already belongs to', () => {
    expect(resolveFacilityScope(context(), FACILITY_A1)).toBe(FACILITY_A1);
  });

  it('refuses to let a facility user switch facility', () => {
    /*
     * The frontend supplies facilityId. If this returned FACILITY_A2 the
     * rest of the request would run against another facility; the caller
     * has already been authenticated, so nothing downstream would ask again.
     */
    expect(scopeError(() => resolveFacilityScope(context(), FACILITY_A2)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
    expect(scopeError(() => resolveFacilityScope(context(), FACILITY_B1)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('validates a facility id the user supplied', () => {
    expect(scopeError(() => resolveFacilityScope(context(), 0)).code).toBe('INVALID_SCOPE_ID');
    expect(scopeError(() => resolveFacilityScope(context(), 1.5)).code).toBe('INVALID_SCOPE_ID');
  });

  it('requires a tenant-level user to say which facility', () => {
    expect(scopeError(() => resolveFacilityScope(tenantAdmin())).code).toBe('FACILITY_REQUIRED');
    expect(scopeError(() => resolveFacilityScope(tenantAdmin(), null)).code).toBe(
      'FACILITY_REQUIRED',
    );
  });

  it('requires a super admin to say which facility', () => {
    expect(scopeError(() => resolveFacilityScope(superAdmin())).code).toBe('FACILITY_REQUIRED');
    expect(scopeError(() => resolveFacilityScope(superAdmin(), undefined)).code).toBe(
      'FACILITY_REQUIRED',
    );
  });

  it('returns the facility a super admin or tenant admin names', () => {
    expect(resolveFacilityScope(superAdmin(), FACILITY_B1)).toBe(FACILITY_B1);
    expect(resolveFacilityScope(tenantAdmin(), FACILITY_A2)).toBe(FACILITY_A2);
  });

  it('DOCUMENTED CONTRACT: a tenant-level request is not tenant-checked here', () => {
    /*
     * This function has no access to the facility-to-tenant mapping, so it
     * cannot verify that FACILITY_B1 belongs to TENANT_A. It returns what
     * the caller asked for and the header says the caller/database must
     * check it.
     *
     * The test states the behaviour plainly instead of pretending the
     * guarantee exists. Every caller in this repository pairs the call with
     * `getFacilityByIdScoped`, which filters by tenant and returns null for
     * a facility outside it - that second call is what makes this safe.
     *
     * If this ever starts throwing, the contract changed and callers that
     * were relying on the scoped query should be reviewed, not just this
     * test.
     */
    expect(resolveFacilityScope(tenantAdmin(), FACILITY_B1)).toBe(FACILITY_B1);
  });

  it('requires a facility even from a user with no tenant', () => {
    const homeless = context({ tenantId: null, facilityId: null });

    expect(scopeError(() => resolveFacilityScope(homeless)).code).toBe('FACILITY_REQUIRED');
    expect(resolveFacilityScope(homeless, FACILITY_A1)).toBe(FACILITY_A1);
  });
});

/* ============================================================
   8. Classification helpers
   ============================================================ */

describe('user classification', () => {
  it('classifies a platform administrator as global', () => {
    expect(isGlobalUser(superAdmin())).toBe(true);
    expect(isGlobalUser(context())).toBe(false);
    expect(isGlobalUser(tenantAdmin())).toBe(false);
  });

  it('classifies a tenant admin as tenant level', () => {
    expect(isTenantLevelUser(tenantAdmin())).toBe(true);
    expect(isTenantLevelUser(context())).toBe(false);
  });

  it('classifies a facility user as facility level', () => {
    expect(isFacilityLevelUser(context())).toBe(true);
    expect(isFacilityLevelUser(tenantAdmin())).toBe(false);
  });

  it('never classifies a super admin as tenant or facility level', () => {
    /* A super admin has both ids null, which is the tenant-level shape, so
     * the super-admin exclusion has to come first. */
    expect(isTenantLevelUser(superAdmin())).toBe(false);
    expect(isFacilityLevelUser(superAdmin())).toBe(false);
  });

  it('keeps a super admin global even when they also belong to a tenant and facility', () => {
    /*
     * The `!isSuperAdmin` clause in both classifiers is invisible in the
     * fixture above, because a super admin with no tenant fails the next
     * condition anyway. It matters for the real shape where a platform
     * administrator is also attached to a tenant: without the clause, a
     * tenant-shaped super admin is reported as tenant-level, and a
     * facility-shaped one as facility-level, which would restrict a global
     * user to one organisation's screens.
     */
    const tenantShaped = context({ tenantId: TENANT_A, facilityId: null, isSuperAdmin: true });
    const facilityShaped = context({
      tenantId: TENANT_A,
      facilityId: FACILITY_A1,
      isSuperAdmin: true,
    });

    expect(isGlobalUser(tenantShaped)).toBe(true);
    expect(isGlobalUser(facilityShaped)).toBe(true);

    expect(isTenantLevelUser(tenantShaped)).toBe(false);
    expect(isTenantLevelUser(facilityShaped)).toBe(false);

    expect(isFacilityLevelUser(tenantShaped)).toBe(false);
    expect(isFacilityLevelUser(facilityShaped)).toBe(false);
  });

  it('classifies a user with no tenant as neither level', () => {
    const homeless = context({ tenantId: null, facilityId: null });

    expect(isTenantLevelUser(homeless)).toBe(false);
    expect(isFacilityLevelUser(homeless)).toBe(false);
    expect(isGlobalUser(homeless)).toBe(false);
  });

  it('KNOWN INCONSISTENCY: an undefined facility id is neither level but resolves as tenant level', () => {
    /*
     * The type says `facilityId: number | null`, so `undefined` is out of
     * contract. If a caller builds a partial context anyway, the helpers
     * disagree about what the user is:
     *
     *   - `isTenantLevelUser` compares `=== null`, so it says no;
     *   - `isFacilityLevelUser` compares `!== null`, so it says YES for an
     *     undefined id - the user is reported as pinned to a facility that
     *     does not exist;
     *   - `resolveFacilityScope` checks `!== null && !== undefined`, so it
     *     treats the same user as tenant-level and demands a facility.
     *
     * So a caller that asks "is this a facility user?" gets yes, and one
     * that asks "which facility?" gets told to supply one. Neither answer
     * is unsafe on its own - both end in a refusal or a validation error -
     * but they cannot both be true, and a UI branching on the first would
     * show a facility-scoped screen to a user with no facility.
     *
     * Pinned rather than fixed: changing the classifiers could alter which
     * screens a real user sees, and the right fix is to reject an undefined
     * id where the context is built, not to guess here. Recorded so the
     * trap is visible to the next reader.
     */
    const partial = { ...context(), facilityId: undefined } as unknown as AuthorizationContext;

    expect(isTenantLevelUser(partial)).toBe(false);
    expect(isFacilityLevelUser(partial)).toBe(true);
    expect(scopeError(() => resolveFacilityScope(partial)).code).toBe('FACILITY_REQUIRED');
  });
});

/* ============================================================
   9. Cross-tenant escape attempts, as a single scenario
   ============================================================ */

describe('a facility user attempting to escape', () => {
  const attacker = context({ tenantId: TENANT_A, facilityId: FACILITY_A1 });

  it('cannot read another tenant by naming it', () => {
    expect(scopeError(() => requireTenantScope(attacker, TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
    expect(scopeError(() => resolveTenantScope(attacker, TENANT_B)).code).toBe(
      'TENANT_ACCESS_DENIED',
    );
  });

  it('cannot read another facility by naming it', () => {
    expect(scopeError(() => resolveFacilityScope(attacker, FACILITY_A2)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
    expect(scopeError(() => requireFacilityScope(attacker, TENANT_A, FACILITY_A2)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('cannot launder a foreign facility through a matching tenant id', () => {
    /* Naming their own tenant but another tenant's facility must still fail:
     * the pair is what is checked. */
    expect(scopeError(() => requireFacilityScope(attacker, TENANT_A, FACILITY_B1)).code).toBe(
      'FACILITY_ACCESS_DENIED',
    );
  });

  it('cannot use a zero or negative id to fall through', () => {
    for (const id of [0, -1, Number.NaN]) {
      expect(scopeError(() => requireTenantScope(attacker, id)).code).toBe('INVALID_SCOPE_ID');
      expect(scopeError(() => requireFacilityScope(attacker, TENANT_A, id)).code).toBe(
        'INVALID_SCOPE_ID',
      );
      expect(scopeError(() => resolveFacilityScope(attacker, id)).code).toBe('INVALID_SCOPE_ID');
    }
  });

  it('still reaches its own facility and tenant after all of that', () => {
    /* A denial must not be sticky: the same context continues to work. */
    expect(() => requireTenantScope(attacker, TENANT_A)).not.toThrow();
    expect(() => requireFacilityScope(attacker, TENANT_A, FACILITY_A1)).not.toThrow();
    expect(resolveFacilityScope(attacker)).toBe(FACILITY_A1);
  });
});
