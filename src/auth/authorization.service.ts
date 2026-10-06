/**
 * JaliCare HMIS
 * Authorization Service
 *
 * Responsible for:
 * - Loading active user roles
 * - Loading role permissions
 * - Enforcing tenant role boundaries
 * - Identifying SUPER_ADMIN
 * - Checking permissions
 * - Checking tenant/facility scope
 */

import {
  and,
  eq,
  isNull,
} from "drizzle-orm";

import { db } from "../db";

import {
  users,
  roles,
  userRoles,
  permissions,
  rolePermissions,
} from "../db/schema";

import type {
  AuthorizationContext,
} from "./authorization.types";


/* ============================================================
   LOAD AUTHORIZATION CONTEXT
   ============================================================ */

export async function loadAuthorizationContext(
  userId: number,
): Promise<AuthorizationContext | null> {

  /* ----------------------------------------------------------
     1. Load the user
     ---------------------------------------------------------- */

  const [user] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      facilityId: users.facilityId,
      isActive: users.isActive,
      accountStatus: users.accountStatus,
    })
    .from(users)
    .where(
      eq(
        users.id,
        userId,
      ),
    )
    .limit(1);

  if (!user) {
    return null;
  }

  if (!user.isActive) {
    return null;
  }

  if (
    user.accountStatus === "DISABLED" ||
    user.accountStatus === "SUSPENDED"
  ) {
    return null;
  }


  /* ----------------------------------------------------------
     2. Load active roles + permissions
     ----------------------------------------------------------

     Important security rules:

     - revoked user-role assignments are ignored
     - inactive user-role assignments are ignored
     - inactive roles are ignored
     - tenant roles must belong to user's tenant
     - global roles are NOT automatically granted to
       tenant users
     - SUPER_ADMIN must be global
  */

  const rows = await db
    .select({
      roleName: roles.name,
      roleTenantId: roles.tenantId,
      permissionCode: permissions.code,
    })
    .from(userRoles)
    .innerJoin(
      roles,
      eq(
        userRoles.roleId,
        roles.id,
      ),
    )
    .innerJoin(
      rolePermissions,
      eq(
        rolePermissions.roleId,
        roles.id,
      ),
    )
    .innerJoin(
      permissions,
      eq(
        rolePermissions.permissionId,
        permissions.id,
      ),
    )
    .where(
      and(
        eq(
          userRoles.userId,
          userId,
        ),

        eq(
          userRoles.isActive,
          true,
        ),

        isNull(
          userRoles.revokedAt,
        ),

        eq(
          roles.isActive,
          true,
        ),

        /* ----------------------------------------------------
           Role scope

           SUPER_ADMIN is only valid as a global role.

           Tenant roles must belong to the authenticated
           user's tenant.
        ---------------------------------------------------- */

        user.tenantId === null
          ? isNull(
              roles.tenantId,
            )
          : eq(
              roles.tenantId,
              user.tenantId,
            ),
      ),
    );


  /* ----------------------------------------------------------
     3. Extract unique roles and permissions
     ---------------------------------------------------------- */

  const roleSet = new Set<string>();
  const permissionSet = new Set<string>();

  for (const row of rows) {

    if (row.roleName) {
      roleSet.add(
        row.roleName,
      );
    }

    if (row.permissionCode) {
      permissionSet.add(
        row.permissionCode,
      );
    }
  }


  const rolesList =
    Array.from(roleSet);

  const permissionsList =
    Array.from(permissionSet);


  /* ----------------------------------------------------------
     4. Determine SUPER_ADMIN
     ---------------------------------------------------------- */

  const isSuperAdmin =
    user.tenantId === null &&
    user.facilityId === null &&
    rolesList.includes(
      "SUPER_ADMIN",
    );


  /* ----------------------------------------------------------
     5. Return authorization context
     ---------------------------------------------------------- */

  return {
    userId: user.id,

    tenantId:
      user.tenantId,

    facilityId:
      user.facilityId,

    roles:
      rolesList,

    permissions:
      permissionsList,

    isSuperAdmin,
  };
}


/* ============================================================
   PERMISSION CHECK
   ============================================================ */

export function hasPermission(
  context: AuthorizationContext,
  permission: string,
): boolean {

  if (
    !permission ||
    !permission.trim()
  ) {
    return false;
  }

  return context.permissions.includes(
    permission,
  );
}


/* ============================================================
   MULTIPLE PERMISSION CHECK
   ============================================================ */

export function hasAllPermissions(
  context: AuthorizationContext,
  requiredPermissions: string[],
): boolean {

  return requiredPermissions.every(
    (permission) =>
      hasPermission(
        context,
        permission,
      ),
  );
}


/* ============================================================
   ANY PERMISSION CHECK
   ============================================================ */

export function hasAnyPermission(
  context: AuthorizationContext,
  requiredPermissions: string[],
): boolean {

  return requiredPermissions.some(
    (permission) =>
      hasPermission(
        context,
        permission,
      ),
  );
}


/* ============================================================
   ROLE CHECK
   ============================================================ */

export function hasRole(
  context: AuthorizationContext,
  roleName: string,
): boolean {

  return context.roles.includes(
    roleName,
  );
}


/* ============================================================
   SUPER ADMIN CHECK
   ============================================================ */

export function isSuperAdmin(
  context: AuthorizationContext,
): boolean {

  return context.isSuperAdmin;
}


/* ============================================================
   TENANT ACCESS
   ============================================================ */

export function canAccessTenant(
  context: AuthorizationContext,
  tenantId: number,
): boolean {

  if (
    !Number.isInteger(
      tenantId,
    ) ||
    tenantId <= 0
  ) {
    return false;
  }

  /*
   * Super Admin has platform-wide tenant access.
   */

  if (
    context.isSuperAdmin
  ) {
    return true;
  }

  /*
   * A normal user can only access
   * their own tenant.
   */

  return (
    context.tenantId ===
    tenantId
  );
}


/* ============================================================
   FACILITY ACCESS
   ============================================================ */

export function canAccessFacility(
  context: AuthorizationContext,
  facilityTenantId: number,
  facilityId: number,
): boolean {

  if (
    !Number.isInteger(
      facilityTenantId,
    ) ||
    facilityTenantId <= 0
  ) {
    return false;
  }

  if (
    !Number.isInteger(
      facilityId,
    ) ||
    facilityId <= 0
  ) {
    return false;
  }


  /*
   * Super Admin can access facilities
   * across the platform.
   */

  if (
    context.isSuperAdmin
  ) {
    return true;
  }


  /*
   * Tenant boundary must match.
   */

  if (
    context.tenantId !==
    facilityTenantId
  ) {
    return false;
  }


  /*
   * Tenant-level users have facilityId = NULL.
   *
   * They may operate across facilities
   * within their own tenant, subject to
   * their permissions.
   */

  if (
    context.facilityId ===
    null
  ) {
    return true;
  }


  /*
   * Facility-scoped users may only
   * access their assigned facility.
   */

  return (
    context.facilityId ===
    facilityId
  );
}