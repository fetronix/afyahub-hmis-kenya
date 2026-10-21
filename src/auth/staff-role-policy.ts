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
