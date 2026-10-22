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

import { Router } from "express";

import { requireAuth, type AuthRequest } from "./auth.middleware";
import { requirePermission } from "./authorization.middleware";

import {
  assignStaffRoles,
  getRoleTaskCatalogue,
  getStaffRolesOverview,
  listAssignableStaffRoles,
  setStaffAccountStatus,
  StaffRoleError,
  updateRolePermissions,
} from "./staff-roles.service";
import { ProfessionalVerificationError } from "../integrations/professional/professional-verification.service.ts";

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
      "Your account must be assigned to a tenant and facility.",
      403,
      "FACILITY_SCOPE_REQUIRED",
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

  console.error("Staff roles API error:", error);

  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "The staff role request could not be completed.",
  });
}

/**
 * The staff directory and the assignable role list.
 *
 * One call, because the screen needs both and they must describe the
 * same tenant: a role picker built from a second request could offer a
 * role the directory has already ruled out.
 */
router.get(
  "/",
  requirePermission("users.invite"),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const search = typeof req.query.search === "string" ? req.query.search : null;

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
  },
);

router.get(
  "/roles",
  requirePermission("users.invite"),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const roles = await listAssignableStaffRoles(scope.tenantId);

      return res.json({ success: true, roles });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * Replace the assignable roles on one staff account.
 *
 * `roleIds` is the complete desired set of assignable roles, not a
 * patch: sending [NURSE, RECEPTIONIST] for an account that held
 * [NURSE, BILLING_CLERK] removes the billing role. Roles the facility
 * may no longer offer are left untouched rather than silently revoked.
 */
router.put(
  "/:userId/roles",
  requirePermission("users.invite"),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const targetUserId = Number(req.params.userId);
      const body = (req.body ?? {}) as { roleIds?: unknown };

      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_STAFF_ID",
          message: "A valid staff account is required.",
        });
      }

      if (
        !Array.isArray(body.roleIds) ||
        body.roleIds.some(
          (roleId) => !Number.isSafeInteger(Number(roleId)) || Number(roleId) <= 0,
        )
      ) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ROLE_SELECTION",
          message: "roleIds must be an array of role identifiers.",
        });
      }

      const result = await assignStaffRoles({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        actorRoleNames: scope.roles,
        isSuperAdmin: scope.isSuperAdmin,
        targetUserId,
        roleIds: body.roleIds.map((roleId) => Number(roleId)),
      });

      return res.json({
        success: true,
        message: result.changed
          ? "Roles updated."
          : "No role change was needed.",
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * The tasks one staff role may perform, beside the tasks this facility
 * is allowed to grant it. One response, so the editor cannot offer a
 * checkbox the save would refuse.
 */
router.get(
  "/roles/:roleId/permissions",
  requirePermission("users.invite"),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const roleId = Number(req.params.roleId);

      if (!Number.isSafeInteger(roleId) || roleId <= 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ROLE_ID",
          message: "A valid role is required.",
        });
      }

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
 *
 * The body is the complete desired set of permission ids. Administrator
 * roles are refused by the service, and every permission is checked
 * against the delegable allowlist before a single row is written.
 */
router.put(
  "/roles/:roleId/permissions",
  requirePermission("users.invite"),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const roleId = Number(req.params.roleId);
      const body = (req.body ?? {}) as { permissionIds?: unknown };

      if (!Number.isSafeInteger(roleId) || roleId <= 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ROLE_ID",
          message: "A valid role is required.",
        });
      }

      if (
        !Array.isArray(body.permissionIds) ||
        body.permissionIds.some(
          (id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0,
        )
      ) {
        return res.status(400).json({
          success: false,
          code: "INVALID_PERMISSION_SELECTION",
          message: "permissionIds must be an array of permission identifiers.",
        });
      }

      const result = await updateRolePermissions({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        actorRoleNames: scope.roles,
        isSuperAdmin: scope.isSuperAdmin,
        roleId,
        permissionIds: body.permissionIds.map((id) => Number(id)),
      });

      return res.json({
        success: true,
        message: result.changed
          ? "Role tasks updated."
          : "No task change was needed.",
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * Activate or deactivate one staff account.
 *
 * `active: false` sets `is_active = false`, `account_status = DISABLED`
 * and bumps `security_version`. The auth middleware re-reads the account
 * on every request, so an open session stops at its next call as well.
 */
router.put(
  "/:userId/status",
  requirePermission("users.invite"),
  async (req: AuthRequest, res) => {
    try {
      const scope = getScope(req);
      const targetUserId = Number(req.params.userId);
      const body = (req.body ?? {}) as { active?: unknown; reason?: unknown };

      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_STAFF_ID",
          message: "A valid staff account is required.",
        });
      }

      if (typeof body.active !== "boolean") {
        return res.status(400).json({
          success: false,
          code: "INVALID_STATUS",
          message: "active must be true or false.",
        });
      }

      if (body.reason !== undefined && typeof body.reason !== "string") {
        return res.status(400).json({
          success: false,
          code: "INVALID_REASON",
          message: "reason must be text.",
        });
      }

      const result = await setStaffAccountStatus({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        actorRoleNames: scope.roles,
        isSuperAdmin: scope.isSuperAdmin,
        targetUserId,
        active: body.active,
        reason: typeof body.reason === "string" ? body.reason : null,
      });

      return res.json({
        success: true,
        message: result.changed
          ? result.active
            ? "Account activated."
            : "Account deactivated."
          : "No status change was needed.",
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

export default router;
