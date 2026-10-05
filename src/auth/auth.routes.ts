import { Router } from "express";

import {
  loginController,
  sessionController,
  logoutController,
} from "./auth.controller";

import {
  requireAuth,
} from "./auth.middleware";

const router =
  Router();

/*
 * Public authentication endpoints
 */
router.post(
  "/login",
  loginController
);

/*
 * Session validation.
 *
 * This endpoint requires a valid session.
 */
router.get(
  "/session",
  requireAuth,
  sessionController
);

/*
 * Logout requires the current
 * authentication session.
 */
router.post(
  "/logout",
  requireAuth,
  logoutController
);

export default router;