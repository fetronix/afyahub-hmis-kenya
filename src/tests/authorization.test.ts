/**
 * JaliCare HMIS
 * RBAC / Authorization Tests
 *
 * These tests verify the authorization engine independently
 * from the HTTP layer.
 */

import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  hasRole,
  isSuperAdmin,
  canAccessTenant,
  canAccessFacility,
} from "../auth/authorization.service";

import type {
  AuthorizationContext,
} from "../auth/authorization.types";

function createContext(
  overrides: Partial<AuthorizationContext> = {}
): AuthorizationContext {
  return {
    userId: 1,
    tenantId: 1,
    facilityId: 10,

    roles: [],
    permissions: [],

    isSuperAdmin: false,

    ...overrides,
  };
}

function assert(
  condition: boolean,
  message: string
): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runAuthorizationTests() {
  console.log("");
  console.log("==============================================");
  console.log("JALICARE HMIS RBAC AUTHORIZATION TESTS");
  console.log("==============================================");

  /*
   * =========================================================
   * SUPER ADMIN
   * =========================================================
   */

  const superAdmin = createContext({
    userId: 1,
    tenantId: null,
    facilityId: null,

    roles: ["SUPER_ADMIN"],

    permissions: [
      "platform.read",
      "platform.manage",
      "tenants.read",
      "tenants.create",
      "facilities.read",
      "patients.read",
    ],

    isSuperAdmin: true,
  });

  assert(
    isSuperAdmin(superAdmin),
    "SUPER_ADMIN should be recognized as super admin"
  );

  assert(
    hasRole(superAdmin, "SUPER_ADMIN"),
    "SUPER_ADMIN should have SUPER_ADMIN role"
  );

  assert(
    hasPermission(superAdmin, "platform.read"),
    "SUPER_ADMIN should have platform.read"
  );

  assert(
    hasPermission(superAdmin, "tenants.create"),
    "SUPER_ADMIN should have tenants.create"
  );

  assert(
    hasAllPermissions(superAdmin, [
      "platform.read",
      "tenants.read",
      "facilities.read",
    ]),
    "SUPER_ADMIN should have all required permissions"
  );

  assert(
    hasAnyPermission(superAdmin, [
      "nonexistent.permission",
      "tenants.create",
    ]),
    "SUPER_ADMIN should have at least one requested permission"
  );

  /*
   * SUPER_ADMIN tenant access
   */

  assert(
    canAccessTenant(superAdmin, 1),
    "SUPER_ADMIN should access tenant 1"
  );

  assert(
    canAccessTenant(superAdmin, 999),
    "SUPER_ADMIN should access tenant 999"
  );

  /*
   * SUPER_ADMIN facility access
   */

  assert(
    canAccessFacility(superAdmin, 1, 10),
    "SUPER_ADMIN should access facility 10"
  );

  assert(
    canAccessFacility(superAdmin, 999, 999),
    "SUPER_ADMIN should access facility 999"
  );

  /*
   * =========================================================
   * TENANT ADMIN
   * =========================================================
   */

  const tenantAdmin = createContext({
    userId: 2,

    tenantId: 1,

    facilityId: null,

    roles: ["TENANT_ADMIN"],

    permissions: [
      "tenants.read",
      "facilities.read",
      "facilities.create",
      "facilities.update",
      "users.read",
      "users.create",
      "patients.read",
    ],

    isSuperAdmin: false,
  });

  assert(
    !isSuperAdmin(tenantAdmin),
    "TENANT_ADMIN must not be recognized as SUPER_ADMIN"
  );

  assert(
    hasRole(tenantAdmin, "TENANT_ADMIN"),
    "TENANT_ADMIN should have TENANT_ADMIN role"
  );

  assert(
    hasPermission(
      tenantAdmin,
      "facilities.create"
    ),
    "TENANT_ADMIN should have facilities.create"
  );

  assert(
    !hasPermission(
      tenantAdmin,
      "platform.manage"
    ),
    "TENANT_ADMIN should not have platform.manage"
  );

  /*
   * Own tenant
   */

  assert(
    canAccessTenant(tenantAdmin, 1),
    "TENANT_ADMIN should access own tenant"
  );

  /*
   * Different tenant
   */

  assert(
    !canAccessTenant(tenantAdmin, 2),
    "TENANT_ADMIN must not access another tenant"
  );

  assert(
    !canAccessTenant(tenantAdmin, 999),
    "TENANT_ADMIN must not access arbitrary tenant"
  );

  /*
   * Own tenant facilities
   */

  assert(
    canAccessFacility(
      tenantAdmin,
      1,
      10
    ),
    "TENANT_ADMIN should access facility in own tenant"
  );

  assert(
    canAccessFacility(
      tenantAdmin,
      1,
      20
    ),
    "TENANT_ADMIN should access another facility in own tenant"
  );

  /*
   * Different tenant facility
   */

  assert(
    !canAccessFacility(
      tenantAdmin,
      2,
      30
    ),
    "TENANT_ADMIN must not access facility belonging to another tenant"
  );

  /*
   * =========================================================
   * FACILITY ADMIN
   * =========================================================
   */

  const facilityAdmin = createContext({
    userId: 3,

    tenantId: 1,

    facilityId: 10,

    roles: ["FACILITY_ADMIN"],

    permissions: [
      "facilities.read",
      "users.read",
      "users.create",
      "patients.read",
      "patients.create",
      "patients.update",
      "clinical.read",
    ],

    isSuperAdmin: false,
  });

  assert(
    !isSuperAdmin(facilityAdmin),
    "FACILITY_ADMIN must not be SUPER_ADMIN"
  );

  assert(
    hasRole(
      facilityAdmin,
      "FACILITY_ADMIN"
    ),
    "FACILITY_ADMIN role should be detected"
  );

  assert(
    hasPermission(
      facilityAdmin,
      "patients.create"
    ),
    "FACILITY_ADMIN should have patients.create"
  );

  assert(
    !hasPermission(
      facilityAdmin,
      "platform.manage"
    ),
    "FACILITY_ADMIN should not have platform.manage"
  );

  /*
   * Own tenant
   */

  assert(
    canAccessTenant(
      facilityAdmin,
      1
    ),
    "FACILITY_ADMIN should access own tenant"
  );

  /*
   * Different tenant
   */

  assert(
    !canAccessTenant(
      facilityAdmin,
      2
    ),
    "FACILITY_ADMIN must not access another tenant"
  );

  /*
   * Own facility
   */

  assert(
    canAccessFacility(
      facilityAdmin,
      1,
      10
    ),
    "FACILITY_ADMIN should access own facility"
  );

  /*
   * Another facility in same tenant
   */

  assert(
    !canAccessFacility(
      facilityAdmin,
      1,
      20
    ),
    "FACILITY_ADMIN must not access another facility"
  );

  /*
   * Facility in another tenant
   */

  assert(
    !canAccessFacility(
      facilityAdmin,
      2,
      30
    ),
    "FACILITY_ADMIN must not access another tenant facility"
  );

  /*
   * =========================================================
   * USER WITH NO PERMISSIONS
   * =========================================================
   */

  const noPermissionUser = createContext({
    userId: 4,

    tenantId: 1,

    facilityId: 10,

    roles: ["STAFF"],

    permissions: [],

    isSuperAdmin: false,
  });

  assert(
    !hasPermission(
      noPermissionUser,
      "patients.read"
    ),
    "User without permission must be denied"
  );

  assert(
    !hasAllPermissions(
      noPermissionUser,
      [
        "patients.read",
        "patients.create",
      ]
    ),
    "User without permissions must fail all-permissions check"
  );

  assert(
    !hasAnyPermission(
      noPermissionUser,
      [
        "patients.read",
        "patients.create",
      ]
    ),
    "User without permissions must fail any-permission check"
  );

  /*
   * =========================================================
   * REVOKED / INACTIVE ROLE SIMULATION
   * =========================================================
   *
   * AuthorizationContext should contain only ACTIVE roles.
   *
   * Therefore a revoked/inactive role should not appear in
   * the context and should provide no permissions.
   */

  const revokedRoleUser = createContext({
    userId: 5,

    tenantId: 1,

    facilityId: 10,

    roles: [],

    permissions: [],

    isSuperAdmin: false,
  });

  assert(
    !hasRole(
      revokedRoleUser,
      "FACILITY_ADMIN"
    ),
    "Revoked role must not appear in authorization context"
  );

  assert(
    !hasPermission(
      revokedRoleUser,
      "patients.read"
    ),
    "Revoked role must provide no permissions"
  );

  /*
   * =========================================================
   * ROLE CHECKS
   * =========================================================
   */

  const multiRoleUser = createContext({
    userId: 6,

    tenantId: 1,

    facilityId: 10,

    roles: [
      "DOCTOR",
      "CLINICAL_OFFICER",
    ],

    permissions: [
      "patients.read",
      "clinical.read",
    ],

    isSuperAdmin: false,
  });

  assert(
    hasRole(
      multiRoleUser,
      "DOCTOR"
    ),
    "DOCTOR role should be detected"
  );

  assert(
    hasRole(
      multiRoleUser,
      "CLINICAL_OFFICER"
    ),
    "CLINICAL_OFFICER role should be detected"
  );

  assert(
    !hasRole(
      multiRoleUser,
      "PHARMACIST"
    ),
    "PHARMACIST role should not be detected"
  );

  /*
   * =========================================================
   * INVALID TENANT / FACILITY IDS
   * =========================================================
   */

  assert(
    !canAccessTenant(
      tenantAdmin,
      0
    ),
    "Tenant ID 0 must be rejected"
  );

  assert(
    !canAccessTenant(
      tenantAdmin,
      -1
    ),
    "Negative tenant ID must be rejected"
  );

  assert(
    !canAccessFacility(
      facilityAdmin,
      0,
      10
    ),
    "Invalid tenant ID must be rejected"
  );

  assert(
    !canAccessFacility(
      facilityAdmin,
      1,
      0
    ),
    "Invalid facility ID must be rejected"
  );

  /*
   * =========================================================
   * RESULTS
   * =========================================================
   */

  console.log("");
  console.log("✓ SUPER_ADMIN authorization passed");
  console.log("✓ TENANT_ADMIN authorization passed");
  console.log("✓ FACILITY_ADMIN authorization passed");
  console.log("✓ Permission checks passed");
  console.log("✓ Role checks passed");
  console.log("✓ Tenant isolation checks passed");
  console.log("✓ Facility isolation checks passed");
  console.log("✓ Revoked/inactive role behavior passed");
  console.log("✓ Invalid ID protection passed");

  console.log("");
  console.log("==============================================");
  console.log("RBAC AUTHORIZATION TEST PASSED");
  console.log("==============================================");
  console.log("");
}

runAuthorizationTests().catch((error) => {
  console.error("");
  console.error("==============================================");
  console.error("RBAC AUTHORIZATION TEST FAILED");
  console.error("==============================================");
  console.error("");
  console.error(error);
  process.exit(1);
});