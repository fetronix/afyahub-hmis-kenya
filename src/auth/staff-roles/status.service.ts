import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../../db';
import { auditLogs, permissions, rolePermissions, roles, userRoles, users } from '../../db/schema';
import { isAdministratorRoleName, isRestrictedRolePermission } from '../staff-role-policy';
import { StaffRoleError, assertActorIsAdministrator } from './shared.ts';

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
