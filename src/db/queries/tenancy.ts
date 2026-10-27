/**
 * JaliCare HMIS
 * Queries: Tenants, facilities, and departments
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import {
  ScopeAccessError,
  requireTenantScope,
  requireFacilityScope,
} from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.tenancy');

// Tenants
export async function getTenants() {
  try {
    return await db.select().from(schema.tenants).where(eq(schema.tenants.isActive, true));
  } catch (error) {
    log.error({ err: error }, 'tenants.fetch_failed');
    throw new Error('Failed to fetch tenants from database', { cause: error });
  }
}

export async function getTenantById(id: number) {
  try {
    const res = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id));
    return res[0] || null;
  } catch (error) {
    log.error({ err: error }, 'tenant.fetch_failed');
    throw new Error('Failed to fetch tenant', { cause: error });
  }
}

// Facilities
export async function getFacilities(tenantId?: number) {
  try {
    if (tenantId) {
      return await db
        .select()
        .from(schema.facilities)
        .where(eq(schema.facilities.tenantId, tenantId));
    }
    return await db.select().from(schema.facilities);
  } catch (error) {
    log.error({ err: error }, 'facilities.fetch_failed');
    throw new Error('Failed to fetch facilities', { cause: error });
  }
}

// =========================================================
// SECURE TENANT / FACILITY SCOPE QUERIES
// =========================================================

/**
 * Get a tenant only if the authenticated user
 * is authorized to access that tenant.
 *
 * IMPORTANT:
 * This function performs the authorization check BEFORE
 * returning tenant data.
 */
export async function getTenantByIdScoped(context: AuthorizationContext, tenantId: number) {
  try {
    requireTenantScope(context, tenantId);

    const result = await db
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.isActive, true)))
      .limit(1);

    return result[0] || null;
  } catch (error) {
    if (error instanceof Error && error.name === 'ScopeAccessError') {
      throw error;
    }

    log.error({ err: error }, 'scoped_tenant.fetch_failed');

    throw new Error('Failed to fetch tenant', { cause: error });
  }
}

/**
 * Get tenants visible to the authenticated user.
 *
 * SUPER_ADMIN:
 *   All active tenants.
 *
 * Tenant user:
 *   Only their own tenant.
 *
 * Facility user:
 *   Only their own tenant.
 */
export async function getTenantsScoped(context: AuthorizationContext) {
  try {
    if (context.tenantId === null) {
      return await db.select().from(schema.tenants).where(eq(schema.tenants.isActive, true));
    }

    return await db
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, context.tenantId), eq(schema.tenants.isActive, true)));
  } catch (error) {
    log.error({ err: error }, 'scoped_tenants.fetch_failed');

    throw new Error('Failed to fetch tenants', { cause: error });
  }
}

/**
 * Get facilities visible to the authenticated user.
 *
 * SUPER_ADMIN:
 *   Can see facilities for any requested tenant.
 *
 * TENANT user:
 *   Can see facilities only within their tenant.
 *
 * FACILITY user:
 *   Can see only their assigned facility.
 *
 * The requested tenantId is NEVER allowed to override
 * the authenticated user's actual tenant.
 */
export async function getFacilitiesScoped(
  context: AuthorizationContext,
  requestedTenantId?: number,
) {
  try {
    /*
     * SUPER_ADMIN
     *
     * They can request a specific tenant's facilities.
     * If no tenant is supplied, they can see all facilities.
     */
    if (context.tenantId === null) {
      if (requestedTenantId !== undefined) {
        requireTenantScope(context, requestedTenantId);

        return await db
          .select()
          .from(schema.facilities)
          .where(eq(schema.facilities.tenantId, requestedTenantId));
      }

      return await db.select().from(schema.facilities);
    }

    /*
     * Normal tenant user
     *
     * The authenticated tenant is authoritative.
     */
    const tenantId = context.tenantId;

    requireTenantScope(context, tenantId);

    /*
     * If the frontend supplied another tenantId,
     * requireTenantScope above will reject it.
     */
    if (requestedTenantId !== undefined) {
      requireTenantScope(context, requestedTenantId);
    }

    /*
     * Facility-level user:
     * return ONLY their facility.
     */
    if (context.facilityId !== null) {
      return await db
        .select()
        .from(schema.facilities)
        .where(
          and(
            eq(schema.facilities.id, context.facilityId),
            eq(schema.facilities.tenantId, tenantId),
          ),
        );
    }

    /*
     * Tenant-level user:
     * return all facilities belonging
     * to their tenant.
     */
    return await db
      .select()
      .from(schema.facilities)
      .where(eq(schema.facilities.tenantId, tenantId));
  } catch (error) {
    if (error instanceof Error && error.name === 'ScopeAccessError') {
      throw error;
    }

    log.error({ err: error }, 'scoped_facilities.fetch_failed');

    throw new Error('Failed to fetch facilities', { cause: error });
  }
}

/**
 * Get a specific facility only when the authenticated
 * user is authorized to access it.
 *
 * The facility's tenantId is read FROM THE DATABASE.
 * It is never trusted from the request.
 */
export async function getFacilityByIdScoped(context: AuthorizationContext, facilityId: number) {
  try {
    const facilityResult = await db
      .select()
      .from(schema.facilities)
      .where(eq(schema.facilities.id, facilityId))
      .limit(1);

    const facility = facilityResult[0];

    if (!facility) {
      return null;
    }

    /*
     * IMPORTANT:
     *
     * facility.tenantId comes from the database.
     *
     * We do NOT use:
     *
     * req.query.tenantId
     * req.body.tenantId
     */
    requireFacilityScope(context, facility.tenantId, facility.id);

    return facility;
  } catch (error) {
    if (error instanceof Error && error.name === 'ScopeAccessError') {
      throw error;
    }

    log.error({ err: error }, 'scoped_facility.fetch_failed');

    throw new Error('Failed to fetch facility', { cause: error });
  }
}

// Departments
export async function getDepartments(facilityId?: number) {
  try {
    if (facilityId) {
      return await db
        .select()
        .from(schema.departments)
        .where(eq(schema.departments.facilityId, facilityId));
    }
    return await db.select().from(schema.departments);
  } catch (error) {
    log.error({ err: error }, 'departments.fetch_failed');
    throw new Error('Failed to fetch departments', { cause: error });
  }
}

/**
 * Departments within the caller's own tenant and facility.
 *
 * The unscoped reader above accepts any facility id, which let one
 * facility list another tenant's departments by guessing a number.
 * Departments are derived from facilities, so the same scope rules
 * apply: a facility user sees their facility, a tenant user sees the
 * tenant, a super admin sees everything (optionally filtered).
 */
export async function getDepartmentsScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number,
) {
  if (context.isSuperAdmin) {
    if (requestedFacilityId === undefined) {
      return db.select().from(schema.departments);
    }

    const facility = await getFacilityByIdScoped(context, requestedFacilityId);

    if (!facility) {
      throw new ScopeAccessError('Facility not found.', 'FACILITY_NOT_FOUND');
    }

    return db
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.facilityId, requestedFacilityId));
  }

  if (context.facilityId) {
    if (requestedFacilityId !== undefined && requestedFacilityId !== context.facilityId) {
      throw new ScopeAccessError(
        'You can only see departments of your own facility.',
        'FACILITY_ACCESS_DENIED',
      );
    }

    return db
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.facilityId, context.facilityId));
  }

  /*
   * A tenant-wide user (no single facility) sees the departments of
   * every facility in their tenant.
   */
  const tenantFacilities = await getFacilitiesScoped(context);

  if (tenantFacilities.length === 0) return [];

  return db
    .select()
    .from(schema.departments)
    .where(
      inArray(
        schema.departments.facilityId,
        tenantFacilities.map((facility) => facility.id),
      ),
    );
}
