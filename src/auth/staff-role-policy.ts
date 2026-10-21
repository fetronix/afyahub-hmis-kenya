/**
 * JaliCare HMIS
 * Which roles a facility may hand out — the rule, without a database
 *
 * Kept apart from staff-roles.service so the rule can be exercised by
 * a contract test without a connection string, and so the invitation
 * screen and the staff directory read the same definition.
 *
 * Two checks, both necessary:
 *
 *   - the four administrator role names the application creates
 *   - the permissions a role carries, because a tenant can name a role
 *     anything it likes. A role called "Front Desk" that grants
 *     `platform.tenants.update` is still a platform role.
 */

const ADMINISTRATOR_ROLE_PATTERN =
  /(SUPER[_ -]?ADMIN|PLATFORM[_ -]?ADMIN|FACILITY[_ -]?ADMIN|TENANT[_ -]?ADMIN)/i;

export function isAdministratorRoleName(
  name: string | null | undefined,
): boolean {
  return typeof name === "string" && ADMINISTRATOR_ROLE_PATTERN.test(name);
}

/**
 * Permissions that make a role administrative, whatever it is called.
 * The list mirrors the boundary the platform RBAC screen already uses
 * for facility administrators.
 */
export const RESTRICTED_PERMISSION_PREFIXES = [
  "platform.",
  "tenants.",
  "subscriptions.",
  "security.",
  "rbac.",
  "permissions.",
  "users.roles.",
] as const;

export const RESTRICTED_PERMISSION_MODULES = [
  "platform",
  "tenants",
  "subscriptions",
  "security",
  "rbac",
] as const;

export const RESTRICTED_PERMISSION_CODES = [
  "roles.manage",
  "roles.create",
  "roles.update",
  "roles.delete",
] as const;

export function isRestrictedRolePermission(
  permission: { code: string; module?: string | null },
): boolean {
  const code = permission.code.trim().toLowerCase();
  const module = (permission.module ?? "").trim().toLowerCase();

  return (
    (RESTRICTED_PERMISSION_MODULES as readonly string[]).includes(module) ||
    RESTRICTED_PERMISSION_PREFIXES.some((prefix) => code.startsWith(prefix)) ||
    (RESTRICTED_PERMISSION_CODES as readonly string[]).includes(code)
  );
}

/** A staff member may hold a handful of roles, not the whole catalogue. */
export const MAX_ROLES_PER_STAFF_MEMBER = 20;

/*
 * ============================================================
 * TASK-LEVEL DELEGATION
 * ============================================================
 *
 * A facility administrator may give a staff role a task it did not
 * have — "let a doctor read bills", "let the receptionist manage
 * service tariffs" — without turning that role into an administrator.
 *
 * The boundary is a module allowlist, not a caller-ceiling. The
 * facility administrator does not hold `billing.read` themselves on a
 * fresh install (they hold staff and tariff permissions), so a
 * "you may only grant what you hold" rule would make the feature
 * useless for exactly the case it was requested for.
 *
 * What is allowed is therefore operational work: seeing and recording
 * what happens to a patient, a specimen, a prescription, an invoice or
 * a report. What is never allowed is the machinery that decides who
 * may do any of it — accounts, roles, permissions, facilities, the
 * platform, the audit trail and authentication.
 */

export const DELEGABLE_PERMISSION_MODULES = [
  "patients",
  "appointments",
  "clinical",
  "inpatient",
  "maternity",
  "laboratory",
  "pharmacy",
  "inventory",
  "procurement",
  "billing",
  "insurance",
  "reports",
  "public_health",
  "interop",
  "practitioners",
] as const;

/**
 * Prefixes that stay with the administrator, whatever module they sit
 * in. The list is deliberately broader than `isRestrictedRolePermission`:
 * that function answers "is this an administrator role?", while this
 * one answers "may a facility hand this task to a staff role at all?".
 */
export const PROTECTED_PERMISSION_PREFIXES = [
  "users.",
  "roles.",
  "audit.",
  "facilities.",
  "system.",
  "auth.",
  "platform.",
  "tenants.",
  "subscriptions.",
  "security.",
  "rbac.",
  "permissions.",
] as const;

export function isDelegablePermission(permission: {
  code: string;
  module?: string | null;
}): boolean {
  const code = permission.code.trim().toLowerCase();
  const module = (permission.module ?? "").trim().toLowerCase();

  if (!code) return false;

  if (isRestrictedRolePermission({ code, module })) return false;

  if (
    PROTECTED_PERMISSION_PREFIXES.some((prefix) => code.startsWith(prefix))
  ) {
    return false;
  }

  return (DELEGABLE_PERMISSION_MODULES as readonly string[]).includes(module);
}

/** A role that grants nothing is not a role; keep at least one task. */
export const MIN_PERMISSIONS_PER_ROLE = 1;

/** A guard against a careless "select all" on a very large catalogue. */
export const MAX_PERMISSIONS_PER_ROLE = 200;
