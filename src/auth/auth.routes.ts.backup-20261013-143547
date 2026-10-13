
import { Router } from "express";

import {
  loginController,
  sessionController,
  logoutController,
  validateFacilityAdminInvitationController,
  acceptFacilityAdminInvitationController,
} from "./auth.controller";

import { requireAuth } from "./auth.middleware";

const router = Router();

/*
 * Public authentication endpoints
 */
router.post(
  "/login",
  loginController,
);

/*
 * Public facility administrator invitation endpoints.
 * These must be accessible before the invited user logs in.
 */
router.get(
  "/facility-admin-invitations/validate",
  validateFacilityAdminInvitationController,
);

router.post(
  "/facility-admin-invitations/accept",
  acceptFacilityAdminInvitationController,
);

/*
 * Session validation requires a valid session.
 */
router.get(
  "/session",
  requireAuth,
  sessionController,
);

/*
 * Logout requires the current authentication session.
 */
router.post(
  "/logout",
  requireAuth,
  logoutController,
);

export default router;
