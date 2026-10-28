import { Router, type Request, type Response } from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { STAFF_ROLE_CATALOGUE } from '../../auth/staff-role-catalogue.ts';
import { db } from '../../db/index.ts';
import * as queries from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import {
  applyRbacCatalogueSchema,
  rbacRolesQuerySchema,
  roleIdParamSchema,
  updateRolePermissionsBodySchema,
  type ApplyRbacCatalogueValidated,
  type UpdateRolePermissionsValidated,
} from '../../validation/schemas/index.ts';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
  validateBody,
  validateParams,
  validateQuery,
} from '../../validation/validate.ts';
import {
  auditActor,
  getContext,
  handleError,
  isRestrictedForFacilityAdmin,
  requireRbacAdminMiddleware,
} from './shared.ts';

const router = Router();

/**
 * GET /api/platform/rbac/roles
 * Return real database roles, their current permission assignments,
 * and the permission catalogue.
 */
router.get(
  '/rbac/roles',
  requireRbacAdminMiddleware('You are not authorized to view role permissions.'),
  validateQuery(rbacRolesQuerySchema, { code: 'INVALID_FACILITY_ID' }),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { facilityId } = getValidatedQuery<{ facilityId: number }>(req);

    try {
      const [facility] = await db
        .select()
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility) {
        res.status(404).json({
          error: 'FACILITY_NOT_FOUND',
          message: 'The selected facility was not found.',
        });
        return;
      }

      if (
        context.isSuperAdmin !== true &&
        (facility.tenantId !== context.tenantId ||
          (context.facilityId !== null && context.facilityId !== facility.id))
      ) {
        res.status(403).json({
          error: 'FACILITY_OUT_OF_SCOPE',
          message: 'You are not authorized to manage this facility.',
        });
        return;
      }

      const roleRows = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.tenantId, facility.tenantId))
        .orderBy(schema.roles.name);

      const permissionRows = await db
        .select()
        .from(schema.permissions)
        .orderBy(schema.permissions.module, schema.permissions.code);

      const roleIds = roleRows.map((role) => role.id);

      const defaults =
        roleIds.length > 0
          ? await db
              .select()
              .from(schema.rolePermissions)
              .where(inArray(schema.rolePermissions.roleId, roleIds))
          : [];

      const overrides =
        roleIds.length > 0
          ? await db
              .select()
              .from(schema.facilityRolePermissionOverrides)
              .where(
                and(
                  eq(schema.facilityRolePermissionOverrides.tenantId, facility.tenantId),
                  eq(schema.facilityRolePermissionOverrides.facilityId, facility.id),
                  inArray(schema.facilityRolePermissionOverrides.roleId, roleIds),
                ),
              )
          : [];

      const overrideIds = overrides.map((override) => override.id);

      const overrideAssignments =
        overrideIds.length > 0
          ? await db
              .select()
              .from(schema.facilityRolePermissionOverridePermissions)
              .where(
                inArray(schema.facilityRolePermissionOverridePermissions.overrideId, overrideIds),
              )
          : [];

      const defaultsByRole = new Map<number, number[]>();
      for (const assignment of defaults) {
        const ids = defaultsByRole.get(assignment.roleId) ?? [];
        ids.push(assignment.permissionId);
        defaultsByRole.set(assignment.roleId, ids);
      }

      const overrideByRole = new Map<number, number>();
      for (const override of overrides) {
        overrideByRole.set(override.roleId, override.id);
      }

      const overridePermissionsById = new Map<number, number[]>();
      for (const assignment of overrideAssignments) {
        const ids = overridePermissionsById.get(assignment.overrideId) ?? [];
        ids.push(assignment.permissionId);
        overridePermissionsById.set(assignment.overrideId, ids);
      }

      const assignedRoleRows = await db
        .select({ roleId: schema.userRoles.roleId })
        .from(schema.userRoles)
        .where(
          and(
            eq(schema.userRoles.userId, context.userId),
            eq(schema.userRoles.isActive, true),
            isNull(schema.userRoles.revokedAt),
          ),
        );

      const assignedRoleIds = new Set(assignedRoleRows.map((assignment) => assignment.roleId));

      const rolesWithPermissions = roleRows.map((role) => {
        const roleName = role.name.toUpperCase();

        const isPlatformProtectedRole =
          role.tenantId === null ||
          ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_ADMINISTRATOR', 'TENANT_ADMIN'].includes(
            roleName,
          );

        const canEdit =
          context.isSuperAdmin === true
            ? !isPlatformProtectedRole && (!role.isSystem || roleName === 'FACILITY_ADMIN')
            : !isPlatformProtectedRole &&
              role.isSystem !== true &&
              roleName !== 'FACILITY_ADMIN' &&
              role.tenantId === context.tenantId &&
              !assignedRoleIds.has(role.id);

        const overrideId = overrideByRole.get(role.id);
        const hasFacilityOverride = overrideId !== undefined;

        const effectivePermissionIds = hasFacilityOverride
          ? (overridePermissionsById.get(overrideId!) ?? [])
          : (defaultsByRole.get(role.id) ?? []);

        return {
          id: role.id,
          name: role.name,
          description: role.description,
          tenantId: role.tenantId,
          isSystem: role.isSystem,
          isActive: role.isActive,
          permissionIds: effectivePermissionIds,
          permissionCodes: permissionRows
            .filter((permission) => effectivePermissionIds.includes(permission.id))
            .map((permission) => permission.code),
          hasFacilityOverride,
          canEdit,
        };
      });

      const permissionIdByCode = new Map(
        permissionRows.map((permission) => [permission.code, permission.id]),
      );

      const roleRowByName = new Map(roleRows.map((role) => [role.name.trim().toUpperCase(), role]));

      const catalogueCoverage = STAFF_ROLE_CATALOGUE.map((entry) => {
        const existingRole = roleRowByName.get(entry.name);
        const assignedIds = existingRole
          ? new Set(defaultsByRole.get(existingRole.id) ?? [])
          : new Set<number>();

        const unknownPermissionCodes = entry.permissions.filter(
          (permissionCode) => !permissionIdByCode.has(permissionCode),
        );

        const missingPermissionCodes = existingRole
          ? entry.permissions.filter((permissionCode) => {
              const permissionId = permissionIdByCode.get(permissionCode);

              return permissionId !== undefined && !assignedIds.has(permissionId);
            })
          : [...entry.permissions];

        return {
          name: entry.name,
          description: entry.description,
          permissionCount: entry.permissions.length,
          permissions: [...entry.permissions],
          exists: existingRole !== undefined,
          isActive: existingRole ? existingRole.isActive : null,
          missingPermissionCodes,
          unknownPermissionCodes,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          roles: rolesWithPermissions,
          permissions: permissionRows.map((permission) => ({
            id: permission.id,
            code: permission.code,
            name: permission.name,
            module: permission.module,
            description: permission.description,
            assignable: context.isSuperAdmin === true || !isRestrictedForFacilityAdmin(permission),
          })),
          catalogue: {
            roleCount: STAFF_ROLE_CATALOGUE.length,
            roles: catalogueCoverage,
            missingCount: catalogueCoverage.filter((entry) => !entry.exists).length,
            driftCount: catalogueCoverage.filter(
              (entry) => entry.exists && entry.missingPermissionCodes.length > 0,
            ).length,
          },
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * POST /api/platform/rbac/catalogue/apply
 * Create the catalogue roles this tenant does not have yet (additive only).
 */
router.post(
  '/rbac/catalogue/apply',
  requireRbacAdminMiddleware('You are not authorized to manage role permissions.'),
  validateBody(applyRbacCatalogueSchema, {
    code: (issue) => (issue.path[0] === 'roleNames' ? 'INVALID_ROLE_NAMES' : 'INVALID_FACILITY_ID'),
  }),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const {
      facilityId,
      roleNames: requestedNames,
      topUpExisting,
    } = getValidatedBody<ApplyRbacCatalogueValidated>(req);

    try {
      const [facility] = await db
        .select()
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility) {
        res.status(404).json({
          error: 'FACILITY_NOT_FOUND',
          message: 'The selected facility was not found.',
        });
        return;
      }

      if (
        context.isSuperAdmin !== true &&
        (facility.tenantId !== context.tenantId ||
          (context.facilityId !== null && context.facilityId !== facility.id))
      ) {
        res.status(403).json({
          error: 'FACILITY_OUT_OF_SCOPE',
          message: 'You are not authorized to manage this facility.',
        });
        return;
      }

      const catalogueNames = new Set<string>(STAFF_ROLE_CATALOGUE.map((entry) => entry.name));
      const unknownNames = (requestedNames ?? []).filter((name) => !catalogueNames.has(name));

      if (unknownNames.length > 0) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          code: 'UNKNOWN_ROLE_NAMES',
          message: `Not in the catalogue: ${unknownNames.join(', ')}.`,
        });
        return;
      }

      const targets = STAFF_ROLE_CATALOGUE.filter((entry) =>
        requestedNames === null ? true : requestedNames.includes(entry.name),
      );

      const requiredCodes = [...new Set(targets.flatMap((entry) => [...entry.permissions]))];

      const permissionRows =
        requiredCodes.length > 0
          ? await db
              .select({
                id: schema.permissions.id,
                code: schema.permissions.code,
              })
              .from(schema.permissions)
              .where(inArray(schema.permissions.code, requiredCodes))
          : [];

      const permissionIdByCode = new Map(
        permissionRows.map((permission) => [permission.code, permission.id]),
      );

      const absentCodes = requiredCodes.filter((code) => !permissionIdByCode.has(code));

      if (absentCodes.length > 0) {
        res.status(409).json({
          error: 'CATALOGUE_PERMISSIONS_MISSING',
          message:
            'These permission codes are not seeded in this database, so the catalogue roles cannot be created: ' +
            absentCodes.join(', ') +
            '. Seed the permission catalogue before retrying.',
        });
        return;
      }

      const existingRoleRows = await db
        .select({
          id: schema.roles.id,
          name: schema.roles.name,
        })
        .from(schema.roles)
        .where(eq(schema.roles.tenantId, facility.tenantId));

      const existingByName = new Map(
        existingRoleRows.map((role) => [role.name.trim().toUpperCase(), role]),
      );

      const result = await db.transaction(async (tx) => {
        const createdRoles: string[] = [];
        const toppedUpRoles: Array<{ name: string; granted: number }> = [];
        const skippedRoles: string[] = [];
        let addedPermissionLinks = 0;

        for (const entry of targets) {
          const existing = existingByName.get(entry.name);

          if (!existing) {
            const [createdRole] = await tx
              .insert(schema.roles)
              .values({
                tenantId: facility.tenantId,
                name: entry.name,
                description: entry.description,
                isSystem: false,
                isActive: true,
              })
              .returning({ id: schema.roles.id });

            const values = entry.permissions.map((code) => ({
              roleId: createdRole.id,
              permissionId: permissionIdByCode.get(code)!,
            }));

            await tx.insert(schema.rolePermissions).values(values);

            addedPermissionLinks += values.length;
            createdRoles.push(entry.name);

            continue;
          }

          if (!topUpExisting) {
            skippedRoles.push(entry.name);
            continue;
          }

          const currentLinks = await tx
            .select({ permissionId: schema.rolePermissions.permissionId })
            .from(schema.rolePermissions)
            .where(eq(schema.rolePermissions.roleId, existing.id));

          const currentIds = new Set(currentLinks.map((link) => link.permissionId));

          const missingValues = entry.permissions
            .map((code) => permissionIdByCode.get(code)!)
            .filter((permissionId) => !currentIds.has(permissionId))
            .map((permissionId) => ({
              roleId: existing.id,
              permissionId,
            }));

          if (missingValues.length > 0) {
            await tx.insert(schema.rolePermissions).values(missingValues);

            addedPermissionLinks += missingValues.length;
            toppedUpRoles.push({
              name: entry.name,
              granted: missingValues.length,
            });
          }
        }

        return { createdRoles, toppedUpRoles, skippedRoles, addedPermissionLinks };
      });

      if (result.createdRoles.length > 0 || result.toppedUpRoles.length > 0) {
        await queries.logAuditEvent(
          facility.tenantId,
          facility.id,
          auditActor(context),
          'CREATE',
          'ROLE',
          null,
          [
            result.createdRoles.length > 0
              ? `Created catalogue roles: ${result.createdRoles.join(', ')}`
              : null,
            result.toppedUpRoles.length > 0
              ? `Granted missing catalogue permissions: ${result.toppedUpRoles
                  .map((entry) => `${entry.name} (+${entry.granted})`)
                  .join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join('. '),
        );
      }

      res.status(200).json({
        success: true,
        data: {
          createdRoles: result.createdRoles,
          toppedUpRoles: result.toppedUpRoles,
          skippedRoles: result.skippedRoles,
          addedPermissionLinks: result.addedPermissionLinks,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * PUT /api/platform/rbac/roles/:id/permissions
 * Save a facility-specific permission override without changing shared defaults.
 */
router.put(
  '/rbac/roles/:id/permissions',
  requireRbacAdminMiddleware('You are not authorized to edit role permissions.'),
  validateParams(roleIdParamSchema, { code: 'INVALID_ROLE_ID' }),
  validateBody(updateRolePermissionsBodySchema, {
    code: (issue) =>
      issue.message.includes('only be selected once')
        ? 'DUPLICATE_PERMISSION_IDS'
        : issue.path[0] === 'permissionIds'
          ? 'INVALID_PERMISSION_IDS'
          : 'INVALID_FACILITY_ID',
  }),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { id: roleId } = getValidatedParams<{ id: number }>(req);
    const { facilityId, permissionIds } = getValidatedBody<UpdateRolePermissionsValidated>(req);

    try {
      const [facility] = await db
        .select()
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility) {
        res.status(404).json({
          error: 'FACILITY_NOT_FOUND',
          message: 'The selected facility was not found.',
        });
        return;
      }

      if (
        context.isSuperAdmin !== true &&
        (facility.tenantId !== context.tenantId ||
          (context.facilityId !== null && context.facilityId !== facility.id))
      ) {
        res.status(403).json({
          error: 'FACILITY_OUT_OF_SCOPE',
          message: 'You are not authorized to manage this facility.',
        });
        return;
      }

      const [role] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.id, roleId))
        .limit(1);

      if (!role) {
        res.status(404).json({
          error: 'ROLE_NOT_FOUND',
          message: 'The requested role was not found.',
        });
        return;
      }

      if (role.tenantId !== facility.tenantId) {
        res.status(403).json({
          error: 'ROLE_OUT_OF_SCOPE',
          message: 'Only roles belonging to the facility tenant can be overridden.',
        });
        return;
      }

      if (context.isSuperAdmin !== true) {
        const isForbiddenRole =
          role.isSystem === true ||
          [
            'SUPER_ADMIN',
            'PLATFORM_ADMIN',
            'PLATFORM_ADMINISTRATOR',
            'FACILITY_ADMIN',
            'TENANT_ADMIN',
          ].includes(role.name.toUpperCase());

        if (isForbiddenRole) {
          res.status(403).json({
            error: 'ROLE_OUT_OF_SCOPE',
            message: 'Facility administrators may edit only eligible staff roles.',
          });
          return;
        }

        const [selfAssignment] = await db
          .select({ id: schema.userRoles.id })
          .from(schema.userRoles)
          .where(
            and(
              eq(schema.userRoles.userId, context.userId),
              eq(schema.userRoles.roleId, role.id),
              eq(schema.userRoles.isActive, true),
              isNull(schema.userRoles.revokedAt),
            ),
          )
          .limit(1);

        if (selfAssignment) {
          res.status(403).json({
            error: 'SELF_ROLE_MODIFICATION_BLOCKED',
            message: 'You cannot modify a role assigned to your own account.',
          });
          return;
        }
      }

      const requestedPermissions =
        permissionIds.length > 0
          ? await db
              .select()
              .from(schema.permissions)
              .where(inArray(schema.permissions.id, permissionIds))
          : [];

      if (requestedPermissions.length !== permissionIds.length) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          code: 'UNKNOWN_PERMISSION',
          message: 'One or more selected permissions do not exist.',
        });
        return;
      }

      if (
        context.isSuperAdmin !== true &&
        requestedPermissions.some(isRestrictedForFacilityAdmin)
      ) {
        res.status(403).json({
          error: 'PRIVILEGED_PERMISSION_BLOCKED',
          message:
            'Facility administrators cannot grant platform, tenant-administration, or RBAC-management permissions.',
        });
        return;
      }

      await db.transaction(async (tx) => {
        const [existingOverride] = await tx
          .select()
          .from(schema.facilityRolePermissionOverrides)
          .where(
            and(
              eq(schema.facilityRolePermissionOverrides.tenantId, facility.tenantId),
              eq(schema.facilityRolePermissionOverrides.facilityId, facility.id),
              eq(schema.facilityRolePermissionOverrides.roleId, role.id),
            ),
          )
          .limit(1);

        let overrideId: number;

        if (existingOverride) {
          overrideId = existingOverride.id;

          await tx
            .update(schema.facilityRolePermissionOverrides)
            .set({ updatedAt: new Date() })
            .where(eq(schema.facilityRolePermissionOverrides.id, overrideId));

          await tx
            .delete(schema.facilityRolePermissionOverridePermissions)
            .where(eq(schema.facilityRolePermissionOverridePermissions.overrideId, overrideId));
        } else {
          const [createdOverride] = await tx
            .insert(schema.facilityRolePermissionOverrides)
            .values({
              tenantId: facility.tenantId,
              facilityId: facility.id,
              roleId: role.id,
            })
            .returning({
              id: schema.facilityRolePermissionOverrides.id,
            });

          overrideId = createdOverride.id;
        }

        if (permissionIds.length > 0) {
          await tx.insert(schema.facilityRolePermissionOverridePermissions).values(
            permissionIds.map((permissionId) => ({
              overrideId,
              permissionId,
            })),
          );
        }

        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(context.userId),
          action: 'UPDATE',
          resource: 'facility_role_permission_override',
          resourceId: String(overrideId),
          details: JSON.stringify({
            facilityId: facility.id,
            facilityName: facility.name,
            roleId: role.id,
            roleName: role.name,
            permissionIds,
            permissionCodes: requestedPermissions.map((permission) => permission.code),
            hasFacilityOverride: true,
            changedBy: context.userId,
          }),
          severity: 'HIGH',
        });
      });

      res.status(200).json({
        success: true,
        message: 'Facility-specific role permissions updated successfully.',
        data: {
          facilityId: facility.id,
          roleId: role.id,
          permissionIds,
          permissionCodes: requestedPermissions.map((permission) => permission.code),
          hasFacilityOverride: true,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);

export default router;
