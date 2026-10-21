/**
 * JaliCare HMIS
 * Staff directory and role assignment
 *
 * Staff invitations create an account with one role. Until now there was
 * no way to look at the staff already at a facility, or to correct the
 * role on an existing account — a wrong role could only be fixed by a
 * platform administrator working in the database, or by inviting the
 * person again (which their email address forbids).
 *
 * This service adds that missing half:
 *
 *   - list the staff at one facility, with the roles they hold
 *   - list the tenant roles a facility may hand out
 *   - replace the assignable roles on one account, atomically
 *
 * The guardrails are the point of the file:
 *
 *   - every query is scoped by tenant AND facility from the caller's
 *     authorization context; an account outside that scope is not
 *     found, rather than forbidden
 *   - administrator roles are never assignable, and an account that
 *     already holds one is read-only here
 *   - a role is judged by the permissions it carries, not only by its
 *     name, so a custom role called "System Administrator" cannot slip
 *     through the name check
 *   - a clinical role still needs a verified professional registration
 *   - the change is written once, with an audit row in the same
 *     transaction
 */

import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";

import { db } from "../db";
import {
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../db/schema";

import {
  isAdministratorRoleName,
  isRestrictedRolePermission,
  MAX_ROLES_PER_STAFF_MEMBER,
} from "./staff-role-policy";
import {
  regulatorForStaffRole,
  requiresProfessionalVerification,
} from "../integrations/professional/practitioner.contracts.ts";
import {
  findVerifiedCredentialForUser,
  listUsableCredentialsForStaff,
} from "../integrations/professional/professional-verification.service.ts";

export class StaffRoleError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "STAFF_ROLE_ERROR",
  ) {
    super(message);
    this.name = "StaffRoleError";
  }
}

/* ============================================================
   ROLE ASSIGNABILITY POLICY
   ============================================================ */

export {
  isAdministratorRoleName,
  isRestrictedRolePermission,
  MAX_ROLES_PER_STAFF_MEMBER,
} from "./staff-role-policy";

export type AssignableRole = {
  id: number;
  name: string;
  description: string | null;
  permissions: string[];
  permissionCount: number;
  /** True when the role must be backed by a verified registration. */
  requiresVerification: boolean;
  /** The regulator code that must be verified, when clinical. */
  regulator: string | null;
  regulatorName: string | null;
};

export type StaffRoleExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

type RolePermissionRow = {
  roleId: number;
  roleName: string;
  roleDescription: string | null;
  permissionCode: string | null;
  permissionModule: string | null;
};

/**
 * Read every active role in the tenant with its permissions, grouped.
 * Inactive roles are excluded: assigning one produces an account that
 * cannot use anything.
 */
async function loadTenantRoles(
  executor: StaffRoleExecutor,
  tenantId: number,
): Promise<
  Map<number, { name: string; description: string | null; permissions: { code: string; module: string | null }[] }>
> {
  const rows: RolePermissionRow[] = await executor
    .select({
      roleId: roles.id,
      roleName: roles.name,
      roleDescription: roles.description,
      permissionCode: permissions.code,
      permissionModule: permissions.module,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(roles.tenantId, tenantId), eq(roles.isActive, true)))
    .orderBy(asc(roles.name));

  const grouped = new Map<
    number,
    {
      name: string;
      description: string | null;
      permissions: { code: string; module: string | null }[];
    }
  >();

  for (const row of rows) {
    let entry = grouped.get(row.roleId);

    if (!entry) {
      entry = {
        name: row.roleName,
        description: row.roleDescription,
        permissions: [],
      };
      grouped.set(row.roleId, entry);
    }

    if (row.permissionCode) {
      entry.permissions.push({
        code: row.permissionCode,
        module: row.permissionModule,
      });
    }
  }

  return grouped;
}

function describeRole(
  roleId: number,
  role: {
    name: string;
    description: string | null;
    permissions: { code: string; module: string | null }[];
  },
): AssignableRole | null {
  if (isAdministratorRoleName(role.name)) {
    return null;
  }

  // A role with no permissions looks assignable but grants nothing;
  // invitation acceptance already refuses it, so do not offer it.
  if (role.permissions.length === 0) {
    return null;
  }

  if (role.permissions.some(isRestrictedRolePermission)) {
    return null;
  }

  const regulator = regulatorForStaffRole(role.name);

  return {
    id: roleId,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((permission) => permission.code).sort(),
    permissionCount: role.permissions.length,
    requiresVerification: requiresProfessionalVerification(role.name),
    regulator: regulator?.code ?? null,
    regulatorName: regulator?.shortName ?? null,
  };
}

/**
 * Active tenant roles a facility administrator may assign.
 *
 * This replaces the name-only filter the invitation screen used. The
 * same function feeds the invitation picker and the staff directory, so
 * the two can never offer different sets.
 */
export type AssignableRoleCatalogue = {
  /**
   * Every active role in the tenant. A role in here but not in
   * `offered` exists and is deliberately withheld — the caller asked
   * for an administrator role, or one with no permissions.
   */
  knownRoleIds: Set<number>;
  offered: Map<number, AssignableRole>;
};

export async function loadAssignableRoleCatalogue(
  executor: StaffRoleExecutor,
  tenantId: number,
): Promise<AssignableRoleCatalogue> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new StaffRoleError("Invalid tenant.", 400, "INVALID_TENANT");
  }

  const grouped = await loadTenantRoles(executor, tenantId);
  const offered = new Map<number, AssignableRole>();

  for (const [roleId, role] of grouped) {
    const described = describeRole(roleId, role);

    if (described) {
      offered.set(roleId, described);
    }
  }

  return { knownRoleIds: new Set(grouped.keys()), offered };
}

export async function listAssignableStaffRoles(
  tenantId: number,
): Promise<AssignableRole[]> {
  const catalogue = await loadAssignableRoleCatalogue(db, tenantId);
  return Array.from(catalogue.offered.values());
}

/**
 * Refuse roles that this facility must not hand out. Used on the write
 * path so a hand-crafted request cannot bypass the picker. The tenant
 * role set is read once, not once per role.
 */
export function pickAssignableRoles(
  catalogue: AssignableRoleCatalogue,
  roleIds: number[],
): Map<number, AssignableRole> {
  const checked = new Map<number, AssignableRole>();

  for (const roleId of roleIds) {
    const role = catalogue.offered.get(roleId);

    if (!role) {
      /*
       * Two different refusals. A role that exists in this tenant but
       * is withheld is an administrator role (or grants nothing); a
       * role that is not there at all may belong to another tenant, so
       * the message must not confirm it exists.
       */
      if (catalogue.knownRoleIds.has(roleId)) {
        throw new StaffRoleError(
          "That role carries administrative permissions and cannot be assigned here.",
          403,
          "ROLE_NOT_ASSIGNABLE",
        );
      }

      throw new StaffRoleError(
        "Choose an active role belonging to this tenant.",
        400,
        "INVALID_STAFF_ROLE",
      );
    }

    checked.set(roleId, role);
  }

  return checked;
}

export async function assertStaffRolesAssignable(
  executor: StaffRoleExecutor,
  tenantId: number,
  roleIds: number[],
): Promise<Map<number, AssignableRole>> {
  return pickAssignableRoles(
    await loadAssignableRoleCatalogue(executor, tenantId),
    roleIds,
  );
}

/** Single-role form used by the invitation path. */
export async function assertStaffRoleAssignable(
  executor: StaffRoleExecutor,
  tenantId: number,
  roleId: number,
): Promise<AssignableRole> {
  const checked = await assertStaffRolesAssignable(executor, tenantId, [roleId]);
  const role = checked.get(roleId);

  if (!role) {
    throw new StaffRoleError(
      "Choose an active role belonging to this tenant.",
      400,
      "INVALID_STAFF_ROLE",
    );
  }

  return role;
}

/* ============================================================
   STAFF DIRECTORY
   ============================================================ */

export type FacilityStaffMember = {
  id: number;
  fullName: string;
  email: string;
  username: string;
  designation: string | null;
  accountStatus: string;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  roles: {
    id: number;
    name: string;
    /** False when the role definition itself was deactivated. */
    roleActive: boolean;
    /** True when this role can be granted or revoked on this account. */
    assignable: boolean;
  }[];
  verifiedRegulators: { regulator: string; status: string }[];
  canAssign: boolean;
  protectionReason: string | null;
};

export async function getStaffRolesOverview(input: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  search?: string | null;
}) {
  if (!Number.isSafeInteger(input.facilityId) || input.facilityId <= 0) {
    throw new StaffRoleError("Invalid facility.", 400, "INVALID_FACILITY");
  }

  const assignableRoles = await listAssignableStaffRoles(input.tenantId);
  const assignableIds = new Set(assignableRoles.map((role) => role.id));

  const search = (input.search ?? "").trim();

  if (search.length > 80) {
    throw new StaffRoleError(
      "The search text is too long.",
      400,
      "INVALID_SEARCH",
    );
  }

  // Escape LIKE wildcards so a searched '%' stays a literal.
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;

  const scopeCondition = and(
    eq(users.tenantId, input.tenantId),
    eq(users.facilityId, input.facilityId),
  );

  const staffRows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      username: users.username,
      designation: users.designation,
      accountStatus: users.accountStatus,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(
      search
        ? and(
            scopeCondition,
            or(
              ilike(users.fullName, pattern),
              ilike(users.email, pattern),
              ilike(users.username, pattern),
            ),
          )
        : scopeCondition,
    )
    .orderBy(asc(users.fullName));

  if (staffRows.length === 0) {
    return {
      staff: [] as FacilityStaffMember[],
      roles: assignableRoles,
      currentUserId: input.actorUserId,
    };
  }

  const staffIds = staffRows.map((row) => row.id);

  const heldRows = await db
    .select({
      userId: userRoles.userId,
      roleId: roles.id,
      roleName: roles.name,
      roleActive: roles.isActive,
      permissionCode: permissions.code,
      permissionModule: permissions.module,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        inArray(userRoles.userId, staffIds),
        eq(userRoles.isActive, true),
        isNull(userRoles.revokedAt),
      ),
    )
    .orderBy(asc(roles.name));

  type HeldRole = {
    id: number;
    name: string;
    active: boolean;
    restricted: boolean;
  };

  const heldByUser = new Map<number, Map<number, HeldRole>>();

  for (const row of heldRows) {
    let byRole = heldByUser.get(row.userId);

    if (!byRole) {
      byRole = new Map<number, HeldRole>();
      heldByUser.set(row.userId, byRole);
    }

    let held = byRole.get(row.roleId);

    if (!held) {
      held = {
        id: row.roleId,
        name: row.roleName,
        active: row.roleActive,
        restricted: isAdministratorRoleName(row.roleName),
      };
      byRole.set(row.roleId, held);
    }

    if (
      row.permissionCode &&
      isRestrictedRolePermission({
        code: row.permissionCode,
        module: row.permissionModule,
      })
    ) {
      held.restricted = true;
    }
  }

  const credentials = await listUsableCredentialsForStaff({
    tenantId: input.tenantId,
    facilityId: input.facilityId,
    userIds: staffIds,
  });

  const staff: FacilityStaffMember[] = staffRows.map((row) => {
    const held = Array.from(heldByUser.get(row.id)?.values() ?? []);
    const isSelf = row.id === input.actorUserId;
    const holdsAdministratorRole = held.some((role) => role.restricted);

    let protectionReason: string | null = null;

    if (isSelf) {
      protectionReason =
        "This is your own account. Another administrator must change your roles.";
    } else if (holdsAdministratorRole) {
      protectionReason =
        "This account holds an administrator role. Only a platform administrator can change it here.";
    }

    return {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      username: row.username,
      designation: row.designation,
      accountStatus: row.accountStatus,
      isActive: row.isActive,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt,
      roles: held.map((role) => ({
        id: role.id,
        name: role.name,
        roleActive: role.active,
        assignable: role.active && assignableIds.has(role.id),
      })),
      verifiedRegulators: credentials.get(row.id) ?? [],
      canAssign: protectionReason === null,
      protectionReason,
    };
  });

  return {
    staff,
    roles: assignableRoles,
    currentUserId: input.actorUserId,
  };
}

/* ============================================================
   ASSIGN ROLES
   ============================================================ */

export async function assignStaffRoles(input: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorRoleNames: string[];
  isSuperAdmin: boolean;
  targetUserId: number;
  roleIds: number[];
}) {
  if (!Number.isSafeInteger(input.targetUserId) || input.targetUserId <= 0) {
    throw new StaffRoleError(
      "A valid staff account is required.",
      400,
      "INVALID_STAFF_ID",
    );
  }

  if (!Array.isArray(input.roleIds)) {
    throw new StaffRoleError(
      "A list of roles is required.",
      400,
      "INVALID_ROLE_SELECTION",
    );
  }

  const uniqueRoleIds = Array.from(new Set(input.roleIds));

  if (
    uniqueRoleIds.length === 0 ||
    uniqueRoleIds.length > MAX_ROLES_PER_STAFF_MEMBER ||
    uniqueRoleIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new StaffRoleError(
      `Choose between 1 and ${MAX_ROLES_PER_STAFF_MEMBER} roles.`,
      400,
      "INVALID_ROLE_SELECTION",
    );
  }

  /*
   * Only an administrator may hand out roles. The route already
   * requires the staff-invitation permission, but inviting someone and
   * re-scoping an existing account are not the same act, so the role
   * is checked here as well — a permission on its own is not enough.
   */
  const isAdministrator =
    input.isSuperAdmin ||
    input.actorRoleNames.some((name) => isAdministratorRoleName(name));

  if (!isAdministrator) {
    throw new StaffRoleError(
      "Only a facility or platform administrator can change staff roles.",
      403,
      "ADMINISTRATOR_ROLE_REQUIRED",
    );
  }

  const actor = String(input.actorUserId);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        tenantId: users.tenantId,
        facilityId: users.facilityId,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1)
      .for("update");

    /*
     * An account in another facility or another tenant is reported as
     * not found. Saying "forbidden" would confirm that the account
     * exists somewhere the caller cannot see.
     */
    if (
      !target ||
      target.tenantId !== input.tenantId ||
      target.facilityId !== input.facilityId
    ) {
      throw new StaffRoleError(
        "That staff account was not found at this facility.",
        404,
        "STAFF_NOT_FOUND",
      );
    }

    if (target.id === input.actorUserId) {
      throw new StaffRoleError(
        "You cannot change your own roles. Another administrator must do it.",
        403,
        "SELF_ROLE_CHANGE_NOT_ALLOWED",
      );
    }

    const heldRows = await tx
      .select({
        roleId: userRoles.roleId,
        roleName: roles.name,
        roleActive: roles.isActive,
        permissionCode: permissions.code,
        permissionModule: permissions.module,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(userRoles.userId, target.id),
          eq(userRoles.isActive, true),
          isNull(userRoles.revokedAt),
        ),
      );

    const heldRoleIds = new Set(heldRows.map((row) => row.roleId));

    const holdsAdministratorRole = heldRows.some(
      (row) =>
        isAdministratorRoleName(row.roleName) ||
        (row.permissionCode !== null &&
          isRestrictedRolePermission({
            code: row.permissionCode,
            module: row.permissionModule,
          })),
    );

    if (holdsAdministratorRole) {
      throw new StaffRoleError(
        "This account holds an administrator role. Only a platform administrator can change it here.",
        403,
        "ADMINISTRATOR_ACCOUNT_PROTECTED",
      );
    }

    /*
     * The whole offered set is loaded, not only the requested roles:
     * "held but not offered" and "held but no longer requested" are
     * different things, and only the second should be revoked.
     */
    const catalogue = await loadAssignableRoleCatalogue(tx, input.tenantId);
    const assignableById = pickAssignableRoles(catalogue, uniqueRoleIds);

    // A clinical role needs a registration that was verified for this
    // person at this facility. A registry answer alone never grants it.
    for (const role of assignableById.values()) {
      if (heldRoleIds.has(role.id) || !role.requiresVerification) {
        continue;
      }

      const credential = await findVerifiedCredentialForUser({
        tenantId: input.tenantId,
        facilityId: input.facilityId,
        userId: target.id,
        roleName: role.name,
      });

      if (!credential) {
        throw new StaffRoleError(
          `${role.name} is a clinical role. Verify ${target.fullName}'s professional registration with ${role.regulatorName ?? "the regulator"} before assigning it.`,
          409,
          "VERIFICATION_REQUIRED",
        );
      }
    }

    /*
     * Roles that are held but no longer offered (for example a role
     * that was deactivated) are left alone: this endpoint changes the
     * assignable set, it does not quietly strip access.
     */
    const fixedHeldRoleIds = new Set(
      Array.from(heldRoleIds).filter(
        (roleId) => !catalogue.offered.has(roleId),
      ),
    );

    const heldAssignableRoleIds = Array.from(heldRoleIds).filter((roleId) =>
      catalogue.offered.has(roleId),
    );

    const toAdd = uniqueRoleIds.filter((roleId) => !heldRoleIds.has(roleId));
    const toRemove = heldAssignableRoleIds.filter(
      (roleId) => !uniqueRoleIds.includes(roleId),
    );

    if (toAdd.length === 0 && toRemove.length === 0) {
      return {
        userId: target.id,
        changed: false,
        roles: Array.from(heldRoleIds),
        added: [],
        removed: [],
      };
    }

    const now = new Date();

    // Revoke first: this can never leave an account with nothing,
    // because at least one role was requested and is held afterwards.
    if (toRemove.length > 0) {
      await tx
        .update(userRoles)
        .set({ isActive: false, revokedAt: now })
        .where(
          and(
            eq(userRoles.userId, target.id),
            inArray(userRoles.roleId, toRemove),
            eq(userRoles.isActive, true),
          ),
        );
    }

    for (const roleId of toAdd) {
      const [existing] = await tx
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(
          and(eq(userRoles.userId, target.id), eq(userRoles.roleId, roleId)),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(userRoles)
          .set({
            isActive: true,
            revokedAt: null,
            assignedBy: actor,
            assignedAt: now,
          })
          .where(eq(userRoles.id, existing.id));
      } else {
        await tx.insert(userRoles).values({
          userId: target.id,
          roleId,
          assignedBy: actor,
          isActive: true,
        });
      }
    }

    const addedNames = toAdd.map(
      (roleId) => assignableById.get(roleId)?.name ?? String(roleId),
    );
    const removedNames = toRemove.map(
      (roleId) =>
        heldRows.find((row) => row.roleId === roleId)?.roleName ??
        String(roleId),
    );

    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      userId: actor,
      action: "UPDATE",
      resource: "USER_ROLES",
      resourceId: String(target.id),
      details: `Changed roles for ${target.fullName}: added ${addedNames.length > 0 ? addedNames.join(", ") : "none"}; removed ${removedNames.length > 0 ? removedNames.join(", ") : "none"}.`,
      severity: "INFO",
    });

    const finalRoleIds = [
      ...Array.from(fixedHeldRoleIds),
      ...uniqueRoleIds,
    ];

    return {
      userId: target.id,
      changed: true,
      roles: Array.from(new Set(finalRoleIds)),
      added: addedNames,
      removed: removedNames,
    };
  });
}
