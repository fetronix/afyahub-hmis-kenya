/**
 * JaliCare HMIS
 * Scope Enforcement Service
 *
 * Responsible for enforcing tenant and facility boundaries.
 *
 * IMPORTANT:
 * IDs supplied by the frontend are NEVER trusted by themselves.
 * Every access decision must be based on the authenticated user's
 * AuthorizationContext.
 */

import type { AuthorizationContext } from "./authorization.types";
import {
  canAccessTenant,
  canAccessFacility,
  isSuperAdmin,
} from "./authorization.service";

/**
 * Error thrown when a user attempts to access a resource
 * outside their authorized tenant or facility scope.
 */
export class ScopeAccessError extends Error {
  public readonly code: string;

  constructor(
    message = "You are not authorized to access this resource.",
    code = "SCOPE_ACCESS_DENIED",
  ) {
    super(message);

    this.name = "ScopeAccessError";
    this.code = code;
  }
}

/**
 * Validate that an ID is a positive integer.
 */
function validateId(
  value: number,
  fieldName: string,
): void {
  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new ScopeAccessError(
      `Invalid ${fieldName}.`,
      "INVALID_SCOPE_ID",
    );
  }
}

/**
 * Require access to a tenant.
 *
 * SUPER_ADMIN:
 *   Can access any tenant.
 *
 * TENANT_ADMIN / tenant user:
 *   Can access only their own tenant.
 *
 * FACILITY_ADMIN / facility user:
 *   Can access only their own tenant.
 */
export function requireTenantScope(
  context: AuthorizationContext,
  tenantId: number,
): void {
  validateId(tenantId, "tenant ID");

  if (
    !canAccessTenant(
      context,
      tenantId,
    )
  ) {
    throw new ScopeAccessError(
      "You are not authorized to access this tenant.",
      "TENANT_ACCESS_DENIED",
    );
  }
}

/**
 * Require access to a facility.
 *
 * SUPER_ADMIN:
 *   Can access any facility.
 *
 * Tenant-level user:
 *   Can access any facility belonging to their tenant.
 *
 * Facility-level user:
 *   Can access only their assigned facility.
 *
 * The facilityTenantId MUST come from the database,
 * not from an untrusted frontend value.
 */
export function requireFacilityScope(
  context: AuthorizationContext,
  facilityTenantId: number,
  facilityId: number,
): void {
  validateId(
    facilityTenantId,
    "facility tenant ID",
  );

  validateId(
    facilityId,
    "facility ID",
  );

  if (
    !canAccessFacility(
      context,
      facilityTenantId,
      facilityId,
    )
  ) {
    throw new ScopeAccessError(
      "You are not authorized to access this facility.",
      "FACILITY_ACCESS_DENIED",
    );
  }
}

/**
 * Require that a tenant belongs to the authenticated user,
 * unless the user is SUPER_ADMIN.
 *
 * Useful when creating or updating resources where the
 * tenantId comes from the request body.
 */
export function assertTenantOwnership(
  context: AuthorizationContext,
  tenantId: number,
): void {
  requireTenantScope(
    context,
    tenantId,
  );
}

/**
 * Require that a facility belongs to the authenticated user,
 * unless the user is SUPER_ADMIN.
 *
 * IMPORTANT:
 * facilityTenantId must be obtained from the database.
 */
export function assertFacilityOwnership(
  context: AuthorizationContext,
  facilityTenantId: number,
  facilityId: number,
): void {
  requireFacilityScope(
    context,
    facilityTenantId,
    facilityId,
  );
}

/**
 * Return the tenant ID that should be used for
 * tenant-scoped operations.
 *
 * For SUPER_ADMIN, the caller must explicitly provide
 * a target tenant.
 *
 * For normal users, the authenticated tenant is authoritative.
 */
export function resolveTenantScope(
  context: AuthorizationContext,
  requestedTenantId?: number | null,
): number {
  if (isSuperAdmin(context)) {
    if (
      requestedTenantId === null ||
      requestedTenantId === undefined
    ) {
      throw new ScopeAccessError(
        "A target tenant is required for this operation.",
        "TENANT_REQUIRED",
      );
    }

    validateId(
      requestedTenantId,
      "tenant ID",
    );

    return requestedTenantId;
  }

  if (
    context.tenantId === null ||
    context.tenantId === undefined
  ) {
    throw new ScopeAccessError(
      "Your account is not assigned to a tenant.",
      "TENANT_NOT_ASSIGNED",
    );
  }

  if (
    requestedTenantId !== undefined &&
    requestedTenantId !== null
  ) {
    requireTenantScope(
      context,
      requestedTenantId,
    );
  }

  return context.tenantId;
}

/**
 * Resolve the facility scope for the authenticated user.
 *
 * SUPER_ADMIN:
 *   Must explicitly provide a facility.
 *
 * TENANT-level user:
 *   Must provide a facility, which is checked against
 *   the authenticated tenant by the caller/database.
 *
 * FACILITY-level user:
 *   The authenticated facility is authoritative and cannot
 *   be overridden by the frontend.
 */
export function resolveFacilityScope(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
): number {
  if (isSuperAdmin(context)) {
    if (
      requestedFacilityId === null ||
      requestedFacilityId === undefined
    ) {
      throw new ScopeAccessError(
        "A target facility is required for this operation.",
        "FACILITY_REQUIRED",
      );
    }

    validateId(
      requestedFacilityId,
      "facility ID",
    );

    return requestedFacilityId;
  }

  if (
    context.facilityId !== null &&
    context.facilityId !== undefined
  ) {
    if (
      requestedFacilityId !== undefined &&
      requestedFacilityId !== null
    ) {
      validateId(
        requestedFacilityId,
        "facility ID",
      );

      if (
        requestedFacilityId !==
        context.facilityId
      ) {
        throw new ScopeAccessError(
          "You are not authorized to access this facility.",
          "FACILITY_ACCESS_DENIED",
        );
      }
    }

    return context.facilityId;
  }

  if (
    requestedFacilityId === null ||
    requestedFacilityId === undefined
  ) {
    throw new ScopeAccessError(
      "A target facility is required for this operation.",
      "FACILITY_REQUIRED",
    );
  }

  validateId(
    requestedFacilityId,
    "facility ID",
  );

  return requestedFacilityId;
}

/**
 * Check whether the authenticated user is operating
 * at tenant level rather than facility level.
 */
export function isTenantLevelUser(
  context: AuthorizationContext,
): boolean {
  return (
    !isSuperAdmin(context) &&
    context.tenantId !== null &&
    context.facilityId === null
  );
}

/**
 * Check whether the authenticated user is
 * restricted to a specific facility.
 */
export function isFacilityLevelUser(
  context: AuthorizationContext,
): boolean {
  return (
    !isSuperAdmin(context) &&
    context.tenantId !== null &&
    context.facilityId !== null
  );
}

/**
 * Check whether the user has global platform access.
 */
export function isGlobalUser(
  context: AuthorizationContext,
): boolean {
  return isSuperAdmin(context);
}