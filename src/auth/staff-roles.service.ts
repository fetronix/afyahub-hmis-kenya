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

import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import { db } from '../db';
import {
  auditLogs,
  facilityRolePermissionOverridePermissions,
  facilityRolePermissionOverrides,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../db/schema';

import {
  isAdministratorRoleName,
  isDelegablePermission,
  isRestrictedRolePermission,
  MAX_PERMISSIONS_PER_ROLE,
  MAX_ROLES_PER_STAFF_MEMBER,
  MIN_PERMISSIONS_PER_ROLE,
} from './staff-role-policy';
import {
  regulatorForStaffRole,
  requiresProfessionalVerification,
} from '../integrations/professional/practitioner.contracts.ts';
import {
  findVerifiedCredentialForUser,
  listUsableCredentialsForStaff,
} from '../integrations/professional/professional-verification.service.ts';

export class StaffRoleError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'STAFF_ROLE_ERROR',
  ) {
    super(message);
    this.name = 'StaffRoleError';
  }
}

/* ============================================================
   ROLE ASSIGNABILITY POLICY
   ============================================================ */

export {
  isAdministratorRoleName,
  isDelegablePermission,
  isRestrictedRolePermission,
  MAX_ROLES_PER_STAFF_MEMBER,
  MIN_PERMISSIONS_PER_ROLE,
} from './staff-role-policy';

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

export type StaffRoleExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  Map<
    number,
    {
      name: string;
      description: string | null;
      permissions: { code: string; module: string | null }[];
    }
  >
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
    throw new StaffRoleError('Invalid tenant.', 400, 'INVALID_TENANT');
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

export async function listAssignableStaffRoles(tenantId: number): Promise<AssignableRole[]> {
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
          'That role carries administrative permissions and cannot be assigned here.',
          403,
          'ROLE_NOT_ASSIGNABLE',
        );
      }

      throw new StaffRoleError(
        'Choose an active role belonging to this tenant.',
        400,
        'INVALID_STAFF_ROLE',
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
  return pickAssignableRoles(await loadAssignableRoleCatalogue(executor, tenantId), roleIds);
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
      'Choose an active role belonging to this tenant.',
      400,
      'INVALID_STAFF_ROLE',
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
    throw new StaffRoleError('Invalid facility.', 400, 'INVALID_FACILITY');
  }

  const assignableRoles = await listAssignableStaffRoles(input.tenantId);
  const assignableIds = new Set(assignableRoles.map((role) => role.id));

  const search = (input.search ?? '').trim();

  if (search.length > 80) {
    throw new StaffRoleError('The search text is too long.', 400, 'INVALID_SEARCH');
  }

  // Escape LIKE wildcards so a searched '%' stays a literal.
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;

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
      protectionReason = 'This is your own account. Another administrator must change your roles.';
    } else if (holdsAdministratorRole) {
      protectionReason =
        'This account holds an administrator role. Only a platform administrator can change it here.';
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
    throw new StaffRoleError('A valid staff account is required.', 400, 'INVALID_STAFF_ID');
  }

  if (!Array.isArray(input.roleIds)) {
    throw new StaffRoleError('A list of roles is required.', 400, 'INVALID_ROLE_SELECTION');
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
      'INVALID_ROLE_SELECTION',
    );
  }

  /*
   * Only an administrator may hand out roles. The route already
   * requires the staff-invitation permission, but inviting someone and
   * re-scoping an existing account are not the same act, so the role
   * is checked here as well — a permission on its own is not enough.
   */
  const isAdministrator =
    input.isSuperAdmin || input.actorRoleNames.some((name) => isAdministratorRoleName(name));

  if (!isAdministrator) {
    throw new StaffRoleError(
      'Only a facility or platform administrator can change staff roles.',
      403,
      'ADMINISTRATOR_ROLE_REQUIRED',
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
      .for('update');

    /*
     * An account in another facility or another tenant is reported as
     * not found. Saying "forbidden" would confirm that the account
     * exists somewhere the caller cannot see.
     */
    if (!target || target.tenantId !== input.tenantId || target.facilityId !== input.facilityId) {
      throw new StaffRoleError(
        'That staff account was not found at this facility.',
        404,
        'STAFF_NOT_FOUND',
      );
    }

    if (target.id === input.actorUserId) {
      throw new StaffRoleError(
        'You cannot change your own roles. Another administrator must do it.',
        403,
        'SELF_ROLE_CHANGE_NOT_ALLOWED',
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
        'This account holds an administrator role. Only a platform administrator can change it here.',
        403,
        'ADMINISTRATOR_ACCOUNT_PROTECTED',
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
          `${role.name} is a clinical role. Verify ${target.fullName}'s professional registration with ${role.regulatorName ?? 'the regulator'} before assigning it.`,
          409,
          'VERIFICATION_REQUIRED',
        );
      }
    }

    /*
     * Roles that are held but no longer offered (for example a role
     * that was deactivated) are left alone: this endpoint changes the
     * assignable set, it does not quietly strip access.
     */
    const fixedHeldRoleIds = new Set(
      Array.from(heldRoleIds).filter((roleId) => !catalogue.offered.has(roleId)),
    );

    const heldAssignableRoleIds = Array.from(heldRoleIds).filter((roleId) =>
      catalogue.offered.has(roleId),
    );

    const toAdd = uniqueRoleIds.filter((roleId) => !heldRoleIds.has(roleId));
    const toRemove = heldAssignableRoleIds.filter((roleId) => !uniqueRoleIds.includes(roleId));

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
        .where(and(eq(userRoles.userId, target.id), eq(userRoles.roleId, roleId)))
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

    const addedNames = toAdd.map((roleId) => assignableById.get(roleId)?.name ?? String(roleId));
    const removedNames = toRemove.map(
      (roleId) => heldRows.find((row) => row.roleId === roleId)?.roleName ?? String(roleId),
    );

    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      userId: actor,
      action: 'UPDATE',
      resource: 'USER_ROLES',
      resourceId: String(target.id),
      details: `Changed roles for ${target.fullName}: added ${addedNames.length > 0 ? addedNames.join(', ') : 'none'}; removed ${removedNames.length > 0 ? removedNames.join(', ') : 'none'}.`,
      severity: 'INFO',
    });

    const finalRoleIds = [...Array.from(fixedHeldRoleIds), ...uniqueRoleIds];

    return {
      userId: target.id,
      changed: true,
      roles: Array.from(new Set(finalRoleIds)),
      added: addedNames,
      removed: removedNames,
    };
  });
}

/* ============================================================
   TASK-LEVEL PERMISSIONS ON A ROLE
   ============================================================ */

/**
 * Who may administer staff access.
 *
 * The route already requires the staff-invitation permission; inviting
 * someone and re-scoping an existing account are not the same act, so
 * the administrator role is checked again here. A permission alone is
 * never enough.
 */
function assertActorIsAdministrator(input: {
  actorRoleNames: string[];
  isSuperAdmin: boolean;
}): void {
  const isAdministrator =
    input.isSuperAdmin || input.actorRoleNames.some((name) => isAdministratorRoleName(name));

  if (!isAdministrator) {
    throw new StaffRoleError(
      'Only a facility or platform administrator can change staff access.',
      403,
      'ADMINISTRATOR_ROLE_REQUIRED',
    );
  }
}

export type RoleTaskGroup = {
  module: string;
  permissions: {
    id: number;
    code: string;
    name: string;
    description: string | null;
  }[];
};

export type RoleTaskCatalogue = {
  role: {
    id: number;
    name: string;
    description: string | null;
    requiresVerification: boolean;
  };
  granted: string[];
  /** True when this facility's own override is the effective set. */
  facilityOverride: {
    applies: boolean;
    facilityId: number | null;
    permissionCount: number;
  };
  /** Where a save from this screen will write. */
  writeScope: 'FACILITY_OVERRIDE' | 'TENANT_DEFAULT';
  /**
   * Grants held by the role that sit outside the delegable allowlist
   * (a custom permission, for example). They are shown, left untouched
   * by a save, and never offered in the picker.
   */
  unmapped: string[];
  groups: RoleTaskGroup[];
};

/**
 * What one staff role is allowed to do, plus everything this facility
 * may hand it. Both halves come from the same request so the editor
 * cannot offer a task the save would refuse.
 */
export async function getRoleTaskCatalogue(input: {
  tenantId: number;
  roleId: number;
  /**
   * The facility the editor is acting for. When this facility holds an
   * override for the role, that override is the effective task set and
   * the one a save will write; without it the tenant default applies.
   */
  facilityId?: number | null;
}): Promise<RoleTaskCatalogue> {
  if (!Number.isSafeInteger(input.roleId) || input.roleId <= 0) {
    throw new StaffRoleError('A valid role is required.', 400, 'INVALID_ROLE_ID');
  }

  const [role] = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isActive: roles.isActive,
    })
    .from(roles)
    .where(and(eq(roles.id, input.roleId), eq(roles.tenantId, input.tenantId)))
    .limit(1);

  if (!role) {
    throw new StaffRoleError('That role was not found at this tenant.', 404, 'ROLE_NOT_FOUND');
  }

  if (!role.isActive) {
    throw new StaffRoleError(
      'That role has been deactivated. Activate it before editing its tasks.',
      409,
      'ROLE_INACTIVE',
    );
  }

  const catalogue = await loadAssignableRoleCatalogue(db, input.tenantId);
  const described = catalogue.offered.get(role.id);

  if (!described) {
    throw new StaffRoleError(
      'This is an administrator role. Task-level changes here would let it reach the platform, so it is not editable from the facility.',
      403,
      'ROLE_NOT_EDITABLE',
    );
  }

  const permissionRows = await db
    .select({
      id: permissions.id,
      code: permissions.code,
      name: permissions.name,
      description: permissions.description,
      module: permissions.module,
    })
    .from(permissions)
    .orderBy(asc(permissions.module), asc(permissions.code));

  /*
   * A facility override, where one exists, is what the people holding
   * this role actually get: authorization.service layers it over the
   * tenant rows. Showing the tenant default here would make a saved
   * change look applied while the staff kept the override.
   */
  const facilityId =
    typeof input.facilityId === 'number' &&
    Number.isSafeInteger(input.facilityId) &&
    input.facilityId > 0
      ? input.facilityId
      : null;

  const [override] = facilityId
    ? await db
        .select({ id: facilityRolePermissionOverrides.id })
        .from(facilityRolePermissionOverrides)
        .where(
          and(
            eq(facilityRolePermissionOverrides.tenantId, input.tenantId),
            eq(facilityRolePermissionOverrides.facilityId, facilityId),
            eq(facilityRolePermissionOverrides.roleId, role.id),
          ),
        )
        .limit(1)
    : [];

  const grantedRows = override
    ? await db
        .select({ code: permissions.code })
        .from(facilityRolePermissionOverridePermissions)
        .innerJoin(
          permissions,
          eq(permissions.id, facilityRolePermissionOverridePermissions.permissionId),
        )
        .where(eq(facilityRolePermissionOverridePermissions.overrideId, override.id))
    : await db
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, role.id));

  const groups = new Map<string, RoleTaskGroup>();

  for (const row of permissionRows) {
    if (!isDelegablePermission({ code: row.code, module: row.module })) {
      continue;
    }

    let group = groups.get(row.module);

    if (!group) {
      group = { module: row.module, permissions: [] };
      groups.set(row.module, group);
    }

    group.permissions.push({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
    });
  }

  const grantedCodes = grantedRows.map((row) => row.code).sort();
  const delegableCodes = new Set<string>();

  for (const group of groups.values()) {
    for (const permission of group.permissions) {
      delegableCodes.add(permission.code);
    }
  }

  return {
    role: {
      id: role.id,
      name: role.name,
      description: role.description,
      requiresVerification: described.requiresVerification,
    },
    granted: grantedCodes,
    unmapped: grantedCodes.filter((code) => !delegableCodes.has(code)),
    groups: Array.from(groups.values()),
    /*
     * The screen needs to say where a save lands, not just what was
     * saved. A role with a facility override is edited at this
     * facility; a role without one is edited at the tenant, and every
     * facility that inherits it sees the change.
     */
    facilityOverride: {
      applies: Boolean(override),
      facilityId,
      permissionCount: grantedCodes.length,
    },
    writeScope: override ? 'FACILITY_OVERRIDE' : 'TENANT_DEFAULT',
  };
}

/**
 * Replace the task list of one staff role.
 *
 * `permissionIds` is the complete desired set. Removing a task takes it
 * away from every account holding the role the next time a request
 * arrives, which is why the audit row names both sides of the change.
 *
 * The role itself is tenant-wide; the staff who hold it are not. The
 * screen says so before the save, and this comment is the same fact for
 * whoever reads the database later.
 */
export async function updateRolePermissions(input: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorRoleNames: string[];
  isSuperAdmin: boolean;
  roleId: number;
  permissionIds: number[];
}) {
  if (!Number.isSafeInteger(input.roleId) || input.roleId <= 0) {
    throw new StaffRoleError('A valid role is required.', 400, 'INVALID_ROLE_ID');
  }

  if (!Array.isArray(input.permissionIds)) {
    throw new StaffRoleError('A list of tasks is required.', 400, 'INVALID_PERMISSION_SELECTION');
  }

  const uniqueIds = Array.from(new Set(input.permissionIds));

  if (
    uniqueIds.length < MIN_PERMISSIONS_PER_ROLE ||
    uniqueIds.length > MAX_PERMISSIONS_PER_ROLE ||
    uniqueIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new StaffRoleError(
      `Choose between ${MIN_PERMISSIONS_PER_ROLE} and ${MAX_PERMISSIONS_PER_ROLE} tasks.`,
      400,
      'INVALID_PERMISSION_SELECTION',
    );
  }

  assertActorIsAdministrator(input);

  const actor = String(input.actorUserId);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: roles.id,
        name: roles.name,
        isActive: roles.isActive,
      })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.tenantId, input.tenantId)))
      .limit(1)
      .for('update');

    if (!target) {
      throw new StaffRoleError('That role was not found at this tenant.', 404, 'ROLE_NOT_FOUND');
    }

    if (!target.isActive) {
      throw new StaffRoleError(
        'That role has been deactivated. Activate it before editing its tasks.',
        409,
        'ROLE_INACTIVE',
      );
    }

    const catalogue = await loadAssignableRoleCatalogue(tx, input.tenantId);

    if (!catalogue.offered.has(target.id)) {
      throw new StaffRoleError(
        'This is an administrator role. Task-level changes here would let it reach the platform, so it is not editable from the facility.',
        403,
        'ROLE_NOT_EDITABLE',
      );
    }

    const wanted = await tx
      .select({
        id: permissions.id,
        code: permissions.code,
        module: permissions.module,
      })
      .from(permissions)
      .where(inArray(permissions.id, uniqueIds));

    if (wanted.length !== uniqueIds.length) {
      throw new StaffRoleError(
        'One of the selected tasks no longer exists. Reload the screen and try again.',
        400,
        'UNKNOWN_PERMISSION',
      );
    }

    for (const permission of wanted) {
      if (!isDelegablePermission(permission)) {
        throw new StaffRoleError(
          `"${permission.code}" belongs to administration and cannot be granted from the facility.`,
          403,
          'PERMISSION_NOT_DELEGABLE',
        );
      }
    }

    const currentRows = await tx
      .select({
        permissionId: rolePermissions.permissionId,
        code: permissions.code,
        module: permissions.module,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, target.id));

    const currentIds = new Set(currentRows.map((row) => row.permissionId));
    const wantedIds = new Set(uniqueIds);

    /*
     * Only grants inside the allowlist are compared. A custom or
     * administrative permission the role already holds is left exactly
     * as it is: this screen may add and remove delegable work, it may
     * not quietly strip something it never offered.
     */
    const delegableCurrentIds = currentRows
      .filter((row) => isDelegablePermission(row))
      .map((row) => row.permissionId);

    const toAdd = uniqueIds.filter((id) => !currentIds.has(id));
    const toRemove = delegableCurrentIds.filter((id) => !wantedIds.has(id));

    /*
     * A facility that carries its own override does not read the tenant
     * rows: authorization.service.replaces them with the override. If a
     * save only wrote role_permissions, the screen would report success
     * while every holder of the role kept the old access — the exact
     * "Update did not save" complaint. The same transaction therefore
     * brings the facility's override to the saved set.
     */
    const [override] = await tx
      .select({ id: facilityRolePermissionOverrides.id })
      .from(facilityRolePermissionOverrides)
      .where(
        and(
          eq(facilityRolePermissionOverrides.tenantId, input.tenantId),
          eq(facilityRolePermissionOverrides.facilityId, input.facilityId),
          eq(facilityRolePermissionOverrides.roleId, target.id),
        ),
      )
      .limit(1);

    const overrideRows = override
      ? await tx
          .select({
            permissionId: facilityRolePermissionOverridePermissions.permissionId,
            code: permissions.code,
            module: permissions.module,
          })
          .from(facilityRolePermissionOverridePermissions)
          .innerJoin(
            permissions,
            eq(permissions.id, facilityRolePermissionOverridePermissions.permissionId),
          )
          .where(eq(facilityRolePermissionOverridePermissions.overrideId, override.id))
      : [];

    /*
     * Keep an override's non-delegable grants for the same reason the
     * tenant rows keep theirs: this screen may not silently strip a
     * permission it never offered.
     */
    const preservedOverrideIds = overrideRows
      .filter((row) => !isDelegablePermission(row))
      .map((row) => row.permissionId);

    const overrideWantedIds = new Set<number>([...uniqueIds, ...preservedOverrideIds]);

    const overrideCurrentIds = new Set(overrideRows.map((row) => row.permissionId));

    const overrideToAdd = override
      ? Array.from(overrideWantedIds).filter((id) => !overrideCurrentIds.has(id))
      : [];
    const overrideToRemove = overrideRows
      .filter((row) => !overrideWantedIds.has(row.permissionId))
      .map((row) => row.permissionId);

    const globalChanged = toAdd.length > 0 || toRemove.length > 0;
    const overrideChanged = overrideToAdd.length > 0 || overrideToRemove.length > 0;

    if (!globalChanged && !overrideChanged) {
      return {
        roleId: target.id,
        roleName: target.name,
        changed: false,
        facilityOverrideUpdated: false,
        writeScope: override ? 'FACILITY_OVERRIDE' : 'TENANT_DEFAULT',
        added: [] as string[],
        removed: [] as string[],
        permissions: wanted.map((row) => row.code).sort(),
      };
    }

    if (toRemove.length > 0) {
      await tx
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, target.id),
            inArray(rolePermissions.permissionId, toRemove),
          ),
        );
    }

    if (toAdd.length > 0) {
      await tx.insert(rolePermissions).values(
        toAdd.map((permissionId) => ({
          roleId: target.id,
          permissionId,
        })),
      );
    }

    if (override && overrideToRemove.length > 0) {
      await tx
        .delete(facilityRolePermissionOverridePermissions)
        .where(
          and(
            eq(facilityRolePermissionOverridePermissions.overrideId, override.id),
            inArray(facilityRolePermissionOverridePermissions.permissionId, overrideToRemove),
          ),
        );
    }

    if (override && overrideToAdd.length > 0) {
      await tx.insert(facilityRolePermissionOverridePermissions).values(
        overrideToAdd.map((permissionId) => ({
          overrideId: override.id,
          permissionId,
        })),
      );
    }

    if (override) {
      await tx
        .update(facilityRolePermissionOverrides)
        .set({ updatedAt: new Date() })
        .where(eq(facilityRolePermissionOverrides.id, override.id));
    }

    const codeById = new Map(wanted.map((row) => [row.id, row.code]));

    for (const row of overrideRows) {
      if (!codeById.has(row.permissionId)) {
        codeById.set(row.permissionId, row.code);
      }
    }

    // A removed permission is no longer in `wanted`; name it from the
    // table itself. An empty IN () is not valid SQL, so skip the query.
    const removedRows =
      toRemove.length > 0
        ? await tx
            .select({ code: permissions.code })
            .from(permissions)
            .where(inArray(permissions.id, toRemove))
        : [];

    const removedCodes = Array.from(
      new Set([
        ...removedRows.map((row) => row.code),
        ...overrideToRemove.map((id) => codeById.get(id) ?? String(id)),
      ]),
    ).sort();

    const addedCodes = Array.from(
      new Set([
        ...toAdd.map((id) => codeById.get(id) ?? String(id)),
        ...overrideToAdd.map((id) => codeById.get(id) ?? String(id)),
      ]),
    ).sort();

    const writeScope = override ? 'FACILITY_OVERRIDE' : 'TENANT_DEFAULT';
    const savedPermissionCodes = Array.from(override ? overrideWantedIds : wantedIds)
      .map((id) => codeById.get(id) ?? String(id))
      .sort();

    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      userId: actor,
      action: 'UPDATE',
      resource: 'ROLE_PERMISSIONS',
      resourceId: String(target.id),
      details: `Changed tasks for role ${target.name}: added ${
        addedCodes.length > 0 ? addedCodes.join(', ') : 'none'
      }; removed ${removedCodes.length > 0 ? removedCodes.join(', ') : 'none'}. ${
        override
          ? `Facility ${input.facilityId} override synchronized (${overrideToAdd.length} added, ${overrideToRemove.length} removed).`
          : 'Tenant default updated; facilities with their own override are unaffected.'
      }`,
      severity: override ? 'HIGH' : 'WARNING',
    });

    return {
      roleId: target.id,
      roleName: target.name,
      changed: true,
      facilityOverrideUpdated: Boolean(override) && overrideChanged,
      writeScope,
      added: addedCodes,
      removed: removedCodes,
      permissions: savedPermissionCodes,
    };
  });
}

/* ============================================================
   ACTIVATE / DEACTIVATE A STAFF ACCOUNT
   ============================================================ */

/**
 * Turn one staff account off, or back on.
 *
 * Deactivation is not a soft hint: `requireAuth` re-reads the account
 * on every request and refuses an inactive or DISABLED user, so an open
 * session stops working at its next call as well as at its next login.
 * `security_version` is incremented too, which invalidates the session
 * records themselves.
 */
export async function setStaffAccountStatus(input: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorRoleNames: string[];
  isSuperAdmin: boolean;
  targetUserId: number;
  active: boolean;
  reason?: string | null;
}) {
  if (!Number.isSafeInteger(input.targetUserId) || input.targetUserId <= 0) {
    throw new StaffRoleError('A valid staff account is required.', 400, 'INVALID_STAFF_ID');
  }

  if (typeof input.active !== 'boolean') {
    throw new StaffRoleError('active must be true or false.', 400, 'INVALID_STATUS');
  }

  const reason = (input.reason ?? '').trim();

  if (reason.length > 200) {
    throw new StaffRoleError('Keep the reason under 200 characters.', 400, 'INVALID_REASON');
  }

  assertActorIsAdministrator(input);

  const actor = String(input.actorUserId);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        tenantId: users.tenantId,
        facilityId: users.facilityId,
        isActive: users.isActive,
        accountStatus: users.accountStatus,
        securityVersion: users.securityVersion,
      })
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1)
      .for('update');

    /*
     * An account in another facility or another tenant is reported as
     * not found, not forbidden: a 403 would confirm it exists.
     */
    if (!target || target.tenantId !== input.tenantId || target.facilityId !== input.facilityId) {
      throw new StaffRoleError(
        'That staff account was not found at this facility.',
        404,
        'STAFF_NOT_FOUND',
      );
    }

    if (target.id === input.actorUserId) {
      throw new StaffRoleError(
        'You cannot deactivate your own account. Another administrator must do it.',
        403,
        'SELF_STATUS_CHANGE_NOT_ALLOWED',
      );
    }

    /*
     * A pending account has not accepted its invitation yet, and
     * acceptance sets the account active. Switching it off here would
     * be undone by the person clicking the link, so it is refused and
     * the invitation is named as the thing to revoke.
     */
    if (target.accountStatus === 'PENDING') {
      throw new StaffRoleError(
        'This person has not accepted their invitation yet. Revoke the invitation instead of deactivating the account.',
        409,
        'ACCOUNT_PENDING_INVITATION',
      );
    }

    const heldRows = await tx
      .select({
        roleName: roles.name,
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
        'This account holds an administrator role. Only a platform administrator can change its status here.',
        403,
        'ADMINISTRATOR_ACCOUNT_PROTECTED',
      );
    }

    if (target.isActive === input.active) {
      return {
        userId: target.id,
        fullName: target.fullName,
        active: input.active,
        accountStatus: target.accountStatus,
        changed: false,
      };
    }

    const now = new Date();

    const [updated] = await tx
      .update(users)
      .set(
        input.active
          ? {
              isActive: true,
              accountStatus: 'ACTIVE',
              deactivatedAt: null,
              deactivationReason: null,
              failedLoginAttempts: 0,
              lastFailedLoginAt: null,
              lockedUntil: null,
              securityVersion: target.securityVersion + 1,
              updatedAt: now,
            }
          : {
              isActive: false,
              accountStatus: 'DISABLED',
              deactivatedAt: now,
              deactivationReason: reason || null,
              securityVersion: target.securityVersion + 1,
              updatedAt: now,
            },
      )
      .where(eq(users.id, target.id))
      .returning({
        accountStatus: users.accountStatus,
        isActive: users.isActive,
      });

    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      userId: actor,
      action: input.active ? 'ACTIVATE' : 'DEACTIVATE',
      resource: 'USER',
      resourceId: String(target.id),
      details: input.active
        ? `Reactivated the account for ${target.fullName}.`
        : `Deactivated the account for ${target.fullName}${reason ? `: ${reason}` : '.'}`,
      severity: input.active ? 'INFO' : 'WARNING',
    });

    return {
      userId: target.id,
      fullName: target.fullName,
      active: input.active,
      accountStatus: updated?.accountStatus ?? (input.active ? 'ACTIVE' : 'DISABLED'),
      changed: true,
    };
  });
}
