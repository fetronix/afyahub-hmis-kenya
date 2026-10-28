import { Router, type Request, type Response } from 'express';
import { eq, inArray } from 'drizzle-orm';

import { STAFF_ROLE_CATALOGUE } from '../../auth/staff-role-catalogue.ts';
import { db } from '../../db/index.ts';
import * as queries from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import {
  createTenantSchema,
  tenantIdParamSchema,
  updateTenantSchema,
  type CreateTenantValidated,
  type UpdateTenantValidated,
} from '../../validation/schemas/index.ts';
import {
  getValidatedBody,
  getValidatedParams,
  validateBody,
  validateParams,
} from '../../validation/validate.ts';
import { auditActor, getContext, handleError, requireSuperAdminMiddleware } from './shared.ts';

const router = Router();

export const FACILITY_ADMIN_PERMISSION_CODES = [
  'appointments.cancel',
  'appointments.create',
  'appointments.read',
  'appointments.update',
  'audit.read',
  'billing.read',
  'tariffs.read',
  'tariffs.manage',
  'clinical.read',
  'facilities.read',
  'facilities.update',
  'inpatient.read',
  'insurance.read',
  'inventory.read',
  'laboratory.read',
  'patients.create',
  'patients.read',
  'patients.update',
  'pharmacy.read',
  /*
   * Patient portal oversight. A facility administrator runs the
   * portal; the invitation codes are included because they also run
   * the desk when needed, but `portal.accounts.manage` is the one that
   * matters for the administration screen.
   */
  'portal.accounts.manage',
  'portal.audit.read',
  'portal.invite',
  'portal.invites.manage',
  'portal.settings.manage',
  'practitioners.read',
  'procurement.read',
  'reports.export',
  'reports.read',
  'roles.read',
  'users.create',
  'users.invitations.read',
  'users.invitations.revoke',
  'users.invitations.reissue',
  'users.invite',
  'users.read',
  'users.update',
] as const;

/**
 * POST /api/platform/tenants
 * Create a tenant and provision its tenant-scoped FACILITY_ADMIN and staff roles.
 */
router.post(
  '/tenants',
  requireSuperAdminMiddleware,
  validateBody(createTenantSchema),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const {
      name,
      slug,
      domain,
      logoUrl,
      brandColor,
      contactEmail,
      contactPhone,
      currency,
      timezone,
    } = getValidatedBody<CreateTenantValidated>(req);

    try {
      const tenant = await db.transaction(async (tx) => {
        const [createdTenant] = await tx
          .insert(schema.tenants)
          .values({
            name,
            slug,
            ...(domain ? { domain } : {}),
            ...(logoUrl ? { logoUrl } : {}),
            ...(brandColor ? { brandColor } : {}),
            ...(contactEmail ? { contactEmail } : {}),
            ...(contactPhone ? { contactPhone } : {}),
            currency,
            timezone,
          })
          .returning();

        const permissionRows = await tx
          .select({
            id: schema.permissions.id,
            code: schema.permissions.code,
          })
          .from(schema.permissions)
          .where(inArray(schema.permissions.code, [...FACILITY_ADMIN_PERMISSION_CODES]));

        const foundCodes = new Set(permissionRows.map((permission) => permission.code));
        const missingCodes = FACILITY_ADMIN_PERMISSION_CODES.filter(
          (code) => !foundCodes.has(code),
        );

        if (missingCodes.length > 0) {
          throw new Error(`FACILITY_ADMIN_PERMISSIONS_MISSING: ${missingCodes.join(', ')}`);
        }

        const [facilityAdminRole] = await tx
          .insert(schema.roles)
          .values({
            tenantId: createdTenant.id,
            name: 'FACILITY_ADMIN',
            description: 'Facility administrator for this healthcare organization.',
            isSystem: false,
            isActive: true,
          })
          .returning({
            id: schema.roles.id,
          });

        await tx.insert(schema.rolePermissions).values(
          permissionRows.map((permission) => ({
            roleId: facilityAdminRole.id,
            permissionId: permission.id,
          })),
        );

        const staffPermissionCodes = [
          ...new Set(STAFF_ROLE_CATALOGUE.flatMap((role) => [...role.permissions])),
        ];

        const staffPermissionRows = await tx
          .select({
            id: schema.permissions.id,
            code: schema.permissions.code,
          })
          .from(schema.permissions)
          .where(inArray(schema.permissions.code, staffPermissionCodes));

        const staffFoundCodes = new Set(staffPermissionRows.map((permission) => permission.code));
        const missingStaffCodes = staffPermissionCodes.filter((code) => !staffFoundCodes.has(code));

        if (missingStaffCodes.length > 0) {
          throw new Error(`STAFF_ROLE_PERMISSIONS_MISSING: ${missingStaffCodes.join(', ')}`);
        }

        for (const staffRole of STAFF_ROLE_CATALOGUE) {
          const [createdRole] = await tx
            .insert(schema.roles)
            .values({
              tenantId: createdTenant.id,
              name: staffRole.name,
              description: staffRole.description,
              isSystem: false,
              isActive: true,
            })
            .returning({ id: schema.roles.id });

          const rolePermissionRows = staffPermissionRows
            .filter((permission) =>
              (staffRole.permissions as readonly string[]).includes(permission.code),
            )
            .map((permission) => ({
              roleId: createdRole.id,
              permissionId: permission.id,
            }));

          await tx.insert(schema.rolePermissions).values(rolePermissionRows);
        }

        return createdTenant;
      });

      await queries.logAuditEvent(
        tenant.id,
        null,
        auditActor(context),
        'CREATE',
        'TENANT',
        String(tenant.id),
        `Created tenant "${tenant.name}" (${tenant.slug}) with a tenant-scoped FACILITY_ADMIN role.`,
      );

      res.status(201).json({ data: tenant });
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * PATCH /api/platform/tenants/:id
 * Update tenant configuration.
 */
router.patch(
  '/tenants/:id',
  requireSuperAdminMiddleware,
  validateParams(tenantIdParamSchema),
  validateBody(updateTenantSchema, { fallbackMessage: 'No valid fields supplied to update.' }),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { id: tenantId } = getValidatedParams<{ id: number }>(req);
    const validatedUpdates = getValidatedBody<UpdateTenantValidated>(req);

    const updates: Partial<typeof schema.tenants.$inferInsert> = {
      ...validatedUpdates,
      updatedAt: new Date(),
    };

    try {
      const [tenant] = await db
        .update(schema.tenants)
        .set(updates)
        .where(eq(schema.tenants.id, tenantId))
        .returning();

      if (!tenant) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Tenant not found.',
        });
        return;
      }

      await queries.logAuditEvent(
        tenant.id,
        null,
        auditActor(context),
        'UPDATE',
        'TENANT',
        String(tenant.id),
        `Updated tenant configuration. Fields: ${Object.keys(updates)
          .filter((key) => key !== 'updatedAt')
          .join(', ')}.`,
      );

      res.json({ data: tenant });
    } catch (error) {
      handleError(res, error);
    }
  },
);

export default router;
