
import { Router } from "express";
import {
  createStaffInvitation,
  listAssignableStaffRoles,
  listStaffInvitations,
  revokeStaffInvitation,
  reissueStaffInvitation,
  StaffInvitationError,
} from "./staff-invitation.service";
import { requireAuth, type AuthRequest } from "./auth.middleware";
import { requirePermission } from "./authorization.middleware";

const router = Router();

router.use(requireAuth);

function getScope(req: AuthRequest) {
  const context = req.authContext;

  if (
    !context ||
    !Number.isSafeInteger(context.tenantId) ||
    !Number.isSafeInteger(context.facilityId)
  ) {
    throw new StaffInvitationError(
      "Your account must be assigned to a tenant and facility.",
      403,
      "FACILITY_SCOPE_REQUIRED",
    );
  }

  return {
    tenantId: context.tenantId as number,
    facilityId: context.facilityId as number,
    userId: context.userId,
  };
}

function sendError(res: any, error: unknown) {
  if (error instanceof StaffInvitationError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  console.error("Staff invitation API error:", error);

  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "The staff invitation request could not be completed.",
  });
}

router.get(
  "/roles",
  requirePermission("users.invite"),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const roles = await listAssignableStaffRoles(scope.tenantId);
      return res.json({ success: true, roles });
    } catch (error) {
      return sendError(res, error);
    }
  },
);
router.post(
  "/",
  requirePermission("users.invite"),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const { email, fullName, phone, designation, roleId } = req.body ?? {};

      if (
        typeof email !== "string" ||
        typeof fullName !== "string" ||
        !Number.isSafeInteger(Number(roleId)) ||
        Number(roleId) <= 0
      ) {
        return res.status(400).json({
          success: false,
          code: "INVALID_INPUT",
          message: "Email, full name, and a valid role are required.",
        });
      }

      const baseUrl = process.env.APP_BASE_URL?.trim();

      if (!baseUrl) {
        return res.status(500).json({
          success: false,
          code: "APP_BASE_URL_NOT_CONFIGURED",
          message: "Staff invitations are temporarily unavailable because the application URL is not configured.",
        });
      }

      let invitationBaseUrl: URL;

      try {
        invitationBaseUrl = new URL(baseUrl);

        if (
          !["http:", "https:"].includes(invitationBaseUrl.protocol) ||
          invitationBaseUrl.username ||
          invitationBaseUrl.password
        ) {
          throw new Error("Unsupported application URL.");
        }
      } catch {
        return res.status(500).json({
          success: false,
          code: "INVALID_APP_BASE_URL",
          message: "APP_BASE_URL must be a valid HTTP or HTTPS URL.",
        });
      }

      const result = await createStaffInvitation({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        email,
        fullName,
        phone: typeof phone === "string" ? phone : null,
        designation:
          typeof designation === "string" ? designation : null,
        roleId: Number(roleId),
        invitedBy: String(scope.userId),
      });

      invitationBaseUrl.pathname =
        `${invitationBaseUrl.pathname.replace(/\/+$/, "")}/accept-staff-invitation`;
      invitationBaseUrl.search = "";
      invitationBaseUrl.hash = "";
      invitationBaseUrl.searchParams.set("token", result.token);

      const invitationUrl = invitationBaseUrl.toString();

      return res.status(201).json({
        success: true,
        invitation: result.invitation,
        invitationUrl,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.get(
  "/",
  requirePermission("users.invitations.read"),
  async (req, res) => {
    try {
      const scope = getScope(req);

      const invitations = await listStaffInvitations(
        scope.tenantId,
        scope.facilityId,
      );

      return res.json({
        success: true,
        invitations,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.post(
  "/:id/reissue",
  requirePermission("users.invitations.reissue"),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const invitationId = Number(req.params.id);

      if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_INVITATION_ID",
          message: "A valid invitation ID is required.",
        });
      }

      const baseUrl = process.env.APP_BASE_URL?.trim();

      if (!baseUrl) {
        return res.status(500).json({
          success: false,
          code: "APP_BASE_URL_NOT_CONFIGURED",
          message: "Staff invitations are temporarily unavailable because the application URL is not configured.",
        });
      }

      let invitationBaseUrl: URL;

      try {
        invitationBaseUrl = new URL(baseUrl);

        if (
          !["http:", "https:"].includes(invitationBaseUrl.protocol) ||
          invitationBaseUrl.username ||
          invitationBaseUrl.password
        ) {
          throw new Error("Unsupported application URL.");
        }
      } catch {
        return res.status(500).json({
          success: false,
          code: "INVALID_APP_BASE_URL",
          message: "APP_BASE_URL must be a valid HTTP or HTTPS URL.",
        });
      }

      const result = await reissueStaffInvitation(
        invitationId,
        scope.tenantId,
        scope.facilityId,
      );

      invitationBaseUrl.pathname =
        `${invitationBaseUrl.pathname.replace(/\/+$/, "")}/accept-staff-invitation`;
      invitationBaseUrl.search = "";
      invitationBaseUrl.hash = "";
      invitationBaseUrl.searchParams.set("token", result.token);

      return res.json({
        success: true,
        invitation: result.invitation,
        invitationUrl: invitationBaseUrl.toString(),
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);
router.post(
  "/:id/revoke",
  requirePermission("users.invitations.revoke"),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const invitationId = Number(req.params.id);

      if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
        return res.status(400).json({
          success: false,
          code: "INVALID_INVITATION_ID",
          message: "A valid invitation ID is required.",
        });
      }

      const result = await revokeStaffInvitation(
        invitationId,
        scope.tenantId,
        scope.facilityId,
      );

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

export default router;
