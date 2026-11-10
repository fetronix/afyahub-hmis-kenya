/**
 * JaliCare HMIS
 * Staff roles API
 *
 * Mounted at /api/staff-roles.
 *
 *   GET  /            staff at the caller's facility, with their roles
 *   GET  /roles       roles this facility may assign
 *   PUT  /:userId/roles  replace the assignable roles on one account
 *   PUT  /:userId/status activate or deactivate one staff account
 *   GET  /roles/:roleId/permissions  a role's tasks and the delegable catalogue
 *   PUT  /roles/:roleId/permissions  replace a role's tasks
 *
 * Every route takes the tenant and facility from the authorization
 * context. Nothing here accepts a facility id from the request body, so
 * there is no parameter a caller can point at another site.
 */

import { Router } from 'express';

import { requireAuth, type AuthRequest } from './auth.middleware';
import { requirePermission } from './authorization.middleware';

import {
  assignStaffRoles,
  getRoleTaskCatalogue,
  getStaffRolesOverview,
  listAssignableStaffRoles,
  setStaffAccountStatus,
  StaffRoleError,
  updateRolePermissions,
} from './staff-roles.service';
import { ProfessionalVerificationError } from '../integrations/professional/professional-verification.service.ts';
import {
  staffAccountStatusBodySchema,
  staffRoleIdParamSchema,
  staffRoleIdsBodySchema,
  staffRolePermissionsBodySchema,
  staffUserIdParamSchema,
} from '../validation/schemas/index.ts';
import {
  getValidatedBody,
  getValidatedParams,
  validateBody,
  validateParams,
} from '../validation/validate.ts';

const router = Router();

router.use(requireAuth);

function getScope(req: AuthRequest) {
  const context = req.authContext;

  if (
    !context ||
    !Number.isSafeInteger(context.tenantId) ||
    !Number.isSafeInteger(context.facilityId)
  ) {
    throw new StaffRoleError(
      'Your account must be assigned to a tenant and facility.',
      403,
      'FACILITY_SCOPE_REQUIRED',
    );
  }

  return {
    tenantId: context.tenantId as number,
    facilityId: context.facilityId as number,
    userId: context.userId,
    roles: context.roles,
    isSuperAdmin: context.isSuperAdmin,
  };
}

function sendError(res: any, error: unknown) {
  if (error instanceof ProfessionalVerificationError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  if (error instanceof StaffRoleError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  console.error('Staff roles API error:', error);

  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'The staff role request could not be completed.',
  });
}

router.get('/', requirePermission('users.invite'), async (req: AuthRequest, res) => {
  try {
    const scope = getScope(req);
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 200) : null;

    const overview = await getStaffRolesOverview({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.userId,
      search,
    });

    return res.json({
      success: true,
      ...overview,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/roles', requirePermission('users.invite'), async (req: AuthRequest, res) => {
  try {
    const scope = getScope(req);
    const roles = await listAssignableStaffRoles(scope.tenantId);

    return res.json({ success: true, roles });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * Replace the assignable roles on one staff account.
 */
router.put(
  '/:userId/roles',
  requirePermission('users.invite'),
  validateParams(staffUserIdParamSchema, { code: 'INVALID_STAFF_ID' }),
  validateBody(staffRoleIdsBodySchema, { code: 'INVALID_ROLE_SELECTION' }),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const { userId: targetUserId } = getValidatedParams<{ userId: number }>(req);
      const { roleIds } = getValidatedBody<{ roleIds: number[] }>(req);

      const result = await assignStaffRoles({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        actorRoleNames: scope.roles,
        isSuperAdmin: scope.isSuperAdmin,
        targetUserId,
        roleIds,
      });

      return res.json({
        success: true,
        message: result.changed ? 'Roles updated.' : 'No role change was needed.',
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * The tasks one staff role may perform, beside the tasks this facility
 * is allowed to grant it.
 */
router.get(
  '/roles/:roleId/permissions',
  requirePermission('users.invite'),
  validateParams(staffRoleIdParamSchema, { code: 'INVALID_ROLE_ID' }),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const { roleId } = getValidatedParams<{ roleId: number }>(req);

      const catalogue = await getRoleTaskCatalogue({
        tenantId: scope.tenantId,
        roleId,
        facilityId: scope.facilityId,
      });

      return res.json({ success: true, ...catalogue });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * Replace the task list of one staff role.
 */
router.put(
  '/roles/:roleId/permissions',
  requirePermission('users.invite'),
  validateParams(staffRoleIdParamSchema, { code: 'INVALID_ROLE_ID' }),
  validateBody(staffRolePermissionsBodySchema, { code: 'INVALID_PERMISSION_SELECTION' }),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const { roleId } = getValidatedParams<{ roleId: number }>(req);
      const { permissionIds } = getValidatedBody<{ permissionIds: number[] }>(req);

      const result = await updateRolePermissions({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        actorRoleNames: scope.roles,
        isSuperAdmin: scope.isSuperAdmin,
        roleId,
        permissionIds,
      });

      return res.json({
        success: true,
        message: result.changed ? 'Role tasks updated.' : 'No task change was needed.',
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * Activate or deactivate one staff account.
 */
router.put(
  '/:userId/status',
  requirePermission('users.invite'),
  validateParams(staffUserIdParamSchema, { code: 'INVALID_STAFF_ID' }),
  validateBody(staffAccountStatusBodySchema, {
    code: (issue) => (issue.path[0] === 'reason' ? 'INVALID_REASON' : 'INVALID_STATUS'),
  }),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const { userId: targetUserId } = getValidatedParams<{ userId: number }>(req);
      const { active, reason } = getValidatedBody<{ active: boolean; reason: string | null }>(req);

      const result = await setStaffAccountStatus({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        actorRoleNames: scope.roles,
        isSuperAdmin: scope.isSuperAdmin,
        targetUserId,
        active,
        reason,
      });

      return res.json({
        success: true,
        message: result.changed
          ? result.active
            ? 'Account activated.'
            : 'Account deactivated.'
          : 'No status change was needed.',
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

export default router;
