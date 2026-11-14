import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '../../db';
import {
  auditLogs,
  facilityRolePermissionOverridePermissions,
  facilityRolePermissionOverrides,
  permissions,
  rolePermissions,
  roles,
} from '../../db/schema';
import {
  MAX_PERMISSIONS_PER_ROLE,
  MIN_PERMISSIONS_PER_ROLE,
  isDelegablePermission,
} from '../staff-role-policy';
import {
  StaffRoleError,
  assertActorIsAdministrator,
  loadAssignableRoleCatalogue,
} from './shared.ts';

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
  facilityOverride: {
    applies: boolean;
    facilityId: number | null;
    permissionCount: number;
  };
  writeScope: 'FACILITY_OVERRIDE' | 'TENANT_DEFAULT';
  unmapped: string[];
  groups: RoleTaskGroup[];
};

export async function getRoleTaskCatalogue(input: {
  tenantId: number;
  roleId: number;
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
    facilityOverride: {
      applies: Boolean(override),
      facilityId,
      permissionCount: grantedCodes.length,
    },
    writeScope: override ? 'FACILITY_OVERRIDE' : 'TENANT_DEFAULT',
  };
}

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

    const delegableCurrentIds = currentRows
      .filter((row) => isDelegablePermission(row))
      .map((row) => row.permissionId);

    const toAdd = uniqueIds.filter((id) => !currentIds.has(id));
    const toRemove = delegableCurrentIds.filter((id) => !wantedIds.has(id));

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
