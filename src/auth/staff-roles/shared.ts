import { and, asc, eq } from 'drizzle-orm';

import { db } from '../../db';
import { permissions, rolePermissions, roles } from '../../db/schema';
import {
  regulatorForStaffRole,
  requiresProfessionalVerification,
} from '../../integrations/professional/practitioner.contracts.ts';
import { isAdministratorRoleName, isRestrictedRolePermission } from '../staff-role-policy';

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

export async function loadTenantRoles(
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

export function describeRole(
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

export type AssignableRoleCatalogue = {
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

export function pickAssignableRoles(
  catalogue: AssignableRoleCatalogue,
  roleIds: number[],
): Map<number, AssignableRole> {
  const checked = new Map<number, AssignableRole>();

  for (const roleId of roleIds) {
    const role = catalogue.offered.get(roleId);

    if (!role) {
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

export function assertActorIsAdministrator(input: {
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
