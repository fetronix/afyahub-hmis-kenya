import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import { db } from '../../db';
import { auditLogs, permissions, rolePermissions, roles, userRoles, users } from '../../db/schema';
import {
  findVerifiedCredentialForUser,
  listUsableCredentialsForStaff,
} from '../../integrations/professional/professional-verification.service.ts';
import {
  MAX_ROLES_PER_STAFF_MEMBER,
  isAdministratorRoleName,
  isRestrictedRolePermission,
} from '../staff-role-policy';
import {
  StaffRoleError,
  listAssignableStaffRoles,
  loadAssignableRoleCatalogue,
  pickAssignableRoles,
} from './shared.ts';

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
    roleActive: boolean;
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

    const catalogue = await loadAssignableRoleCatalogue(tx, input.tenantId);
    const assignableById = pickAssignableRoles(catalogue, uniqueRoleIds);

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
