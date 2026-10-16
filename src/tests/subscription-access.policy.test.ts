import {
  decideSubscriptionAccess,
  isValidSubscriptionFacilityScope,
} from "../auth/subscription-access.policy";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

function runTests(): void {
  const context = {
    userId: 10,
    tenantId: 1,
    facilityId: 20,
    isSuperAdmin: false,
  };

  const scope = { tenantId: 1, facilityId: 20 };

  assert(
    isValidSubscriptionFacilityScope(scope),
    "Valid positive tenant and facility IDs are accepted",
  );
  assert(
    !isValidSubscriptionFacilityScope({ tenantId: 0, facilityId: 20 }),
    "Zero tenant ID is rejected",
  );
  assert(
    !isValidSubscriptionFacilityScope({ tenantId: 1, facilityId: -20 }),
    "Negative facility ID is rejected",
  );
  assert(
    !isValidSubscriptionFacilityScope({ tenantId: 1.5, facilityId: 20 }),
    "Non-integer tenant ID is rejected",
  );
  assert(
    !isValidSubscriptionFacilityScope(null),
    "Missing facility scope is rejected",
  );

  assert(
    decideSubscriptionAccess({
      context,
      scope,
      access: { tenantId: 1, accessStatus: "ACTIVE" },
    }).allowed,
    "Active subscription access is allowed",
  );

  const suspended = decideSubscriptionAccess({
    context,
    scope,
    access: { tenantId: 1, accessStatus: "SUSPENDED" },
  });
  assert(
    !suspended.allowed &&
      suspended.statusCode === 403 &&
      suspended.error === "FACILITY_SUBSCRIPTION_SUSPENDED",
    "Suspended facility is denied with the expected error",
  );

  const missing = decideSubscriptionAccess({
    context,
    scope,
    access: null,
  });
  assert(
    missing.allowed && missing.reason === "NO_ACCESS_RECORD",
    "Missing access record remains available during rollout",
  );

  const wrongTenant = decideSubscriptionAccess({
    context,
    scope: { tenantId: 2, facilityId: 20 },
    access: { tenantId: 2, accessStatus: "ACTIVE" },
  });
  assert(
    !wrongTenant.allowed && wrongTenant.statusCode === 403,
    "Cross-tenant scope is rejected",
  );

  const mismatchedRecord = decideSubscriptionAccess({
    context,
    scope,
    access: { tenantId: 2, accessStatus: "ACTIVE" },
  });
  assert(
    !mismatchedRecord.allowed &&
      mismatchedRecord.error === "FACILITY_ACCESS_DENIED",
    "Subscription record from another tenant is rejected",
  );

  const invalidStatus = decideSubscriptionAccess({
    context,
    scope,
    access: { tenantId: 1, accessStatus: "UNKNOWN" },
  });
  assert(
    !invalidStatus.allowed &&
      invalidStatus.statusCode === 503 &&
      invalidStatus.error === "SUBSCRIPTION_STATUS_INVALID",
    "Unknown access status fails closed",
  );

  const missingScope = decideSubscriptionAccess({
    context: { ...context, facilityId: null },
    scope: null,
    access: null,
  });
  assert(
    !missingScope.allowed &&
      missingScope.error === "SUBSCRIPTION_FACILITY_SCOPE_REQUIRED",
    "Missing facility scope is denied",
  );

  const superAdmin = decideSubscriptionAccess({
    context: {
      tenantId: null,
      facilityId: null,
      isSuperAdmin: true,
    },
    scope: null,
    access: null,
  });
  assert(
    superAdmin.allowed && superAdmin.reason === "SUPER_ADMIN",
    "Super Admin retains access to management operations",
  );

  console.log("\nSubscription access policy tests passed.");
}

try {
  runTests();
} catch (error) {
  console.error("\nSubscription access policy tests failed.");
  console.error(error);
  process.exit(1);
}

