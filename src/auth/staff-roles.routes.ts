/**
 * JaliCare HMIS
 * Staff roles API
 *
 * Mounted at /api/staff-roles.
 *
 *   GET  /            staff at the caller's facility, with their roles
 *   GET  /roles       roles this facility may assign
 *   PUT  /:userId/roles  replace the assignable roles on one account
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
  getStaffRolesOverview,
  listAssignableStaffRoles,
  StaffRoleError,
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

export default router;
