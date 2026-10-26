import {
  decideSubscriptionAccess,
  isValidSubscriptionFacilityScope,
} from '../auth/subscription-access.policy';

import { describe, expect, it } from 'vitest';

describe('Subscription-access.policy', () => {
  it('runTests', async () => {
    const context = {
      userId: 10,
      tenantId: 1,
      facilityId: 20,
      isSuperAdmin: false,
    };

    const scope = { tenantId: 1, facilityId: 20 };

    expect(
      isValidSubscriptionFacilityScope(scope),
      'Valid positive tenant and facility IDs are accepted',
    ).toBe(true);
    expect(
      !isValidSubscriptionFacilityScope({ tenantId: 0, facilityId: 20 }),
      'Zero tenant ID is rejected',
    ).toBe(true);
    expect(
      !isValidSubscriptionFacilityScope({ tenantId: 1, facilityId: -20 }),
      'Negative facility ID is rejected',
    ).toBe(true);
    expect(
      !isValidSubscriptionFacilityScope({ tenantId: 1.5, facilityId: 20 }),
      'Non-integer tenant ID is rejected',
    ).toBe(true);
    expect(!isValidSubscriptionFacilityScope(null), 'Missing facility scope is rejected').toBe(
      true,
    );

    expect(
      decideSubscriptionAccess({
        context,
        scope,
        access: { tenantId: 1, accessStatus: 'ACTIVE' },
      }).allowed,
      'Active subscription access is allowed',
    ).toBe(true);

    const suspended = decideSubscriptionAccess({
      context,
      scope,
      access: { tenantId: 1, accessStatus: 'SUSPENDED' },
    });
    expect(
      !suspended.allowed &&
        suspended.statusCode === 403 &&
        suspended.error === 'FACILITY_SUBSCRIPTION_SUSPENDED',
      'Suspended facility is denied with the expected error',
    ).toBe(true);

    const missing = decideSubscriptionAccess({
      context,
      scope,
      access: null,
    });
    expect(
      missing.allowed && missing.reason === 'NO_ACCESS_RECORD',
      'Missing access record remains available during rollout',
    ).toBe(true);

    const wrongTenant = decideSubscriptionAccess({
      context,
      scope: { tenantId: 2, facilityId: 20 },
      access: { tenantId: 2, accessStatus: 'ACTIVE' },
    });
    expect(
      !wrongTenant.allowed && wrongTenant.statusCode === 403,
      'Cross-tenant scope is rejected',
    ).toBe(true);

    const mismatchedRecord = decideSubscriptionAccess({
      context,
      scope,
      access: { tenantId: 2, accessStatus: 'ACTIVE' },
    });
    expect(
      !mismatchedRecord.allowed && mismatchedRecord.error === 'FACILITY_ACCESS_DENIED',
      'Subscription record from another tenant is rejected',
    ).toBe(true);

    const invalidStatus = decideSubscriptionAccess({
      context,
      scope,
      access: { tenantId: 1, accessStatus: 'UNKNOWN' },
    });
    expect(
      !invalidStatus.allowed &&
        invalidStatus.statusCode === 503 &&
        invalidStatus.error === 'SUBSCRIPTION_STATUS_INVALID',
      'Unknown access status fails closed',
    ).toBe(true);

    const missingScope = decideSubscriptionAccess({
      context: { ...context, facilityId: null },
      scope: null,
      access: null,
    });
    expect(
      !missingScope.allowed && missingScope.error === 'SUBSCRIPTION_FACILITY_SCOPE_REQUIRED',
      'Missing facility scope is denied',
    ).toBe(true);

    const superAdmin = decideSubscriptionAccess({
      context: {
        tenantId: null,
        facilityId: null,
        isSuperAdmin: true,
      },
      scope: null,
      access: null,
    });
    expect(
      superAdmin.allowed && superAdmin.reason === 'SUPER_ADMIN',
      'Super Admin retains access to management operations',
    ).toBe(true);
  });
});
