import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  hasRole,
  isSuperAdmin,
  canAccessTenant,
  canAccessFacility,
} from '../auth/authorization.service';
import type { AuthorizationContext } from '../auth/authorization.types';

import { describe, expect, it } from 'vitest';

function createContext(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
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

describe('RBAC / Authorization Tests', () => {
  it('Authorization', async () => {
    /*
     * =========================================================
     * SUPER ADMIN
     * =========================================================
     */

    const superAdmin = createContext({
      userId: 1,
      tenantId: null,
      facilityId: null,

      roles: ['SUPER_ADMIN'],

      permissions: [
        'platform.read',
        'platform.manage',
        'tenants.read',
        'tenants.create',
        'facilities.read',
        'patients.read',
      ],

      isSuperAdmin: true,
    });

    expect(isSuperAdmin(superAdmin), 'SUPER_ADMIN should be recognized as super admin').toBe(true);
    const staleFinancialGrants = {
      ...superAdmin,
      permissions: [
        ...superAdmin.permissions,
        'billing.read',
        'billing.payments.record',
        'accounting.journals.post',
        'tariffs.manage',
        'insurance.private.remittance.reconcile',
      ],
    };
    for (const permission of [
      'billing.read',
      'billing.payments.record',
      'accounting.journals.post',
      'tariffs.manage',
      'insurance.private.remittance.reconcile',
    ]) {
      expect(
        hasPermission(staleFinancialGrants, permission),
        `global role cannot use ${permission}`,
      ).toBe(false);
    }
    expect(hasPermission(staleFinancialGrants, 'platform.read')).toBe(true);

    expect(hasRole(superAdmin, 'SUPER_ADMIN'), 'SUPER_ADMIN should have SUPER_ADMIN role').toBe(
      true,
    );

    expect(
      hasPermission(superAdmin, 'platform.read'),
      'SUPER_ADMIN should have platform.read',
    ).toBe(true);

    expect(
      hasPermission(superAdmin, 'tenants.create'),
      'SUPER_ADMIN should have tenants.create',
    ).toBe(true);

    expect(
      hasAllPermissions(superAdmin, ['platform.read', 'tenants.read', 'facilities.read']),
      'SUPER_ADMIN should have all required permissions',
    ).toBe(true);

    expect(
      hasAnyPermission(superAdmin, ['nonexistent.permission', 'tenants.create']),
      'SUPER_ADMIN should have at least one requested permission',
    ).toBe(true);

    /*
     * SUPER_ADMIN tenant access
     */

    expect(canAccessTenant(superAdmin, 1), 'SUPER_ADMIN should access tenant 1').toBe(true);

    expect(canAccessTenant(superAdmin, 999), 'SUPER_ADMIN should access tenant 999').toBe(true);

    /*
     * SUPER_ADMIN facility access
     */

    expect(canAccessFacility(superAdmin, 1, 10), 'SUPER_ADMIN should access facility 10').toBe(
      true,
    );

    expect(canAccessFacility(superAdmin, 999, 999), 'SUPER_ADMIN should access facility 999').toBe(
      true,
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

      roles: ['TENANT_ADMIN'],

      permissions: [
        'tenants.read',
        'facilities.read',
        'facilities.create',
        'facilities.update',
        'users.read',
        'users.create',
        'patients.read',
      ],

      isSuperAdmin: false,
    });

    expect(!isSuperAdmin(tenantAdmin), 'TENANT_ADMIN must not be recognized as SUPER_ADMIN').toBe(
      true,
    );

    expect(hasRole(tenantAdmin, 'TENANT_ADMIN'), 'TENANT_ADMIN should have TENANT_ADMIN role').toBe(
      true,
    );

    expect(
      hasPermission(tenantAdmin, 'facilities.create'),
      'TENANT_ADMIN should have facilities.create',
    ).toBe(true);

    expect(
      !hasPermission(tenantAdmin, 'platform.manage'),
      'TENANT_ADMIN should not have platform.manage',
    ).toBe(true);

    /*
     * Own tenant
     */

    expect(canAccessTenant(tenantAdmin, 1), 'TENANT_ADMIN should access own tenant').toBe(true);

    /*
     * Different tenant
     */

    expect(!canAccessTenant(tenantAdmin, 2), 'TENANT_ADMIN must not access another tenant').toBe(
      true,
    );

    expect(
      !canAccessTenant(tenantAdmin, 999),
      'TENANT_ADMIN must not access arbitrary tenant',
    ).toBe(true);

    /*
     * Own tenant facilities
     */

    expect(
      canAccessFacility(tenantAdmin, 1, 10),
      'TENANT_ADMIN should access facility in own tenant',
    ).toBe(true);

    expect(
      canAccessFacility(tenantAdmin, 1, 20),
      'TENANT_ADMIN should access another facility in own tenant',
    ).toBe(true);

    /*
     * Different tenant facility
     */

    expect(
      !canAccessFacility(tenantAdmin, 2, 30),
      'TENANT_ADMIN must not access facility belonging to another tenant',
    ).toBe(true);

    /*
     * =========================================================
     * FACILITY ADMIN
     * =========================================================
     */

    const facilityAdmin = createContext({
      userId: 3,

      tenantId: 1,

      facilityId: 10,

      roles: ['FACILITY_ADMIN'],

      permissions: [
        'facilities.read',
        'users.read',
        'users.create',
        'patients.read',
        'patients.create',
        'patients.update',
        'clinical.read',
      ],

      isSuperAdmin: false,
    });

    expect(!isSuperAdmin(facilityAdmin), 'FACILITY_ADMIN must not be SUPER_ADMIN').toBe(true);

    expect(hasRole(facilityAdmin, 'FACILITY_ADMIN'), 'FACILITY_ADMIN role should be detected').toBe(
      true,
    );

    expect(
      hasPermission(facilityAdmin, 'patients.create'),
      'FACILITY_ADMIN should have patients.create',
    ).toBe(true);

    expect(
      !hasPermission(facilityAdmin, 'platform.manage'),
      'FACILITY_ADMIN should not have platform.manage',
    ).toBe(true);

    /*
     * Own tenant
     */

    expect(canAccessTenant(facilityAdmin, 1), 'FACILITY_ADMIN should access own tenant').toBe(true);

    /*
     * Different tenant
     */

    expect(
      !canAccessTenant(facilityAdmin, 2),
      'FACILITY_ADMIN must not access another tenant',
    ).toBe(true);

    /*
     * Own facility
     */

    expect(
      canAccessFacility(facilityAdmin, 1, 10),
      'FACILITY_ADMIN should access own facility',
    ).toBe(true);

    /*
     * Another facility in same tenant
     */

    expect(
      !canAccessFacility(facilityAdmin, 1, 20),
      'FACILITY_ADMIN must not access another facility',
    ).toBe(true);

    /*
     * Facility in another tenant
     */

    expect(
      !canAccessFacility(facilityAdmin, 2, 30),
      'FACILITY_ADMIN must not access another tenant facility',
    ).toBe(true);

    /*
     * =========================================================
     * USER WITH NO PERMISSIONS
     * =========================================================
     */

    const noPermissionUser = createContext({
      userId: 4,

      tenantId: 1,

      facilityId: 10,

      roles: ['STAFF'],

      permissions: [],

      isSuperAdmin: false,
    });

    expect(
      !hasPermission(noPermissionUser, 'patients.read'),
      'User without permission must be denied',
    ).toBe(true);

    expect(
      !hasAllPermissions(noPermissionUser, ['patients.read', 'patients.create']),
      'User without permissions must fail all-permissions check',
    ).toBe(true);

    expect(
      !hasAnyPermission(noPermissionUser, ['patients.read', 'patients.create']),
      'User without permissions must fail any-permission check',
    ).toBe(true);

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

    expect(
      !hasRole(revokedRoleUser, 'FACILITY_ADMIN'),
      'Revoked role must not appear in authorization context',
    ).toBe(true);

    expect(
      !hasPermission(revokedRoleUser, 'patients.read'),
      'Revoked role must provide no permissions',
    ).toBe(true);

    /*
     * =========================================================
     * ROLE CHECKS
     * =========================================================
     */

    const multiRoleUser = createContext({
      userId: 6,

      tenantId: 1,

      facilityId: 10,

      roles: ['DOCTOR', 'CLINICAL_OFFICER'],

      permissions: ['patients.read', 'clinical.read'],

      isSuperAdmin: false,
    });

    expect(hasRole(multiRoleUser, 'DOCTOR'), 'DOCTOR role should be detected').toBe(true);

    expect(
      hasRole(multiRoleUser, 'CLINICAL_OFFICER'),
      'CLINICAL_OFFICER role should be detected',
    ).toBe(true);

    expect(!hasRole(multiRoleUser, 'PHARMACIST'), 'PHARMACIST role should not be detected').toBe(
      true,
    );

    /*
     * =========================================================
     * INVALID TENANT / FACILITY IDS
     * =========================================================
     */

    expect(!canAccessTenant(tenantAdmin, 0), 'Tenant ID 0 must be rejected').toBe(true);

    expect(!canAccessTenant(tenantAdmin, -1), 'Negative tenant ID must be rejected').toBe(true);

    expect(!canAccessFacility(facilityAdmin, 0, 10), 'Invalid tenant ID must be rejected').toBe(
      true,
    );

    expect(!canAccessFacility(facilityAdmin, 1, 0), 'Invalid facility ID must be rejected').toBe(
      true,
    );

    /*
     * =========================================================
     * RESULTS
     * =========================================================
     */
  });
});
