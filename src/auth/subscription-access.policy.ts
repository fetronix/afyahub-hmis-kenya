export type SubscriptionAccessStatus = "ACTIVE" | "SUSPENDED";

export type SubscriptionAccessDecision =
  | { allowed: true; reason: "SUPER_ADMIN" | "NO_ACCESS_RECORD" | "ACTIVE" }
  | {
      allowed: false;
      statusCode: 400 | 403 | 503;
      error:
        | "SUBSCRIPTION_FACILITY_SCOPE_REQUIRED"
        | "FACILITY_ACCESS_DENIED"
        | "FACILITY_SUBSCRIPTION_SUSPENDED"
        | "SUBSCRIPTION_STATUS_INVALID";
      reason: string;
    };

export interface SubscriptionAccessContext {
  tenantId: number | null;
  facilityId: number | null;
  isSuperAdmin: boolean;
}

export interface SubscriptionAccessRecord {
  tenantId: number;
  accessStatus: string;
}

export function isValidSubscriptionFacilityScope(
  scope: { tenantId: number; facilityId: number } | null,
): boolean {
  return !!scope &&
    Number.isSafeInteger(scope.tenantId) &&
    scope.tenantId > 0 &&
    Number.isSafeInteger(scope.facilityId) &&
    scope.facilityId > 0;
}

export function decideSubscriptionAccess(input: {
  context: SubscriptionAccessContext;
  scope: { tenantId: number; facilityId: number } | null;
  access: SubscriptionAccessRecord | null;
}): SubscriptionAccessDecision {
  const { context, scope, access } = input;

  if (context.isSuperAdmin) {
    return { allowed: true, reason: "SUPER_ADMIN" };
  }

  if (!scope || !isValidSubscriptionFacilityScope(scope)) {
    return {
      allowed: false,
      statusCode: 400,
      error: "SUBSCRIPTION_FACILITY_SCOPE_REQUIRED",
      reason: "A valid facility and tenant scope is required.",
    };
  }

  if (
    context.tenantId !== null &&
    context.tenantId !== scope.tenantId
  ) {
    return {
      allowed: false,
      statusCode: 403,
      error: "FACILITY_ACCESS_DENIED",
      reason: "The facility is outside your tenant scope.",
    };
  }

  if (access === null) {
    return { allowed: true, reason: "NO_ACCESS_RECORD" };
  }

  if (access.tenantId !== scope.tenantId) {
    return {
      allowed: false,
      statusCode: 403,
      error: "FACILITY_ACCESS_DENIED",
      reason: "The subscription record is outside the facility tenant scope.",
    };
  }

  if (access.accessStatus === "SUSPENDED") {
    return {
      allowed: false,
      statusCode: 403,
      error: "FACILITY_SUBSCRIPTION_SUSPENDED",
      reason: "Facility subscription access is suspended.",
    };
  }

  if (access.accessStatus !== "ACTIVE") {
    return {
      allowed: false,
      statusCode: 503,
      error: "SUBSCRIPTION_STATUS_INVALID",
      reason: "Facility subscription access could not be safely verified.",
    };
  }

  return { allowed: true, reason: "ACTIVE" };
}

