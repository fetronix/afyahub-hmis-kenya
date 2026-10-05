import type { Request, Response } from "express";

import {
  login,
  validateSession,
  revokeSession,
} from "./auth.service";

import {
  validateLoginInput,
  validateSessionToken,
  AuthValidationError,
} from "./auth.validation";

import type { LoginInput } from "./auth.types";

function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0].trim() || null;
  }

  if (Array.isArray(forwardedFor)) {
    return forwardedFor[0] ?? null;
  }

  return req.socket.remoteAddress ?? null;
}

function getUserAgent(req: Request): string | null {
  const userAgent = req.headers["user-agent"];

  return typeof userAgent === "string"
    ? userAgent
    : null;
}

/**
 * POST /api/auth/login
 */
export async function loginController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const validated =
      validateLoginInput({
        ...(req.body ?? {}),
        ipAddress:
          getClientIp(req),
        userAgent:
          getUserAgent(req),
      });

    const input: LoginInput = {
      identifier:
        validated.identifier,
      password:
        validated.password,
      ipAddress:
        validated.ipAddress,
      userAgent:
        validated.userAgent,
    };

    const result =
      await login(input);

    if (!result.success) {
      const status =
        result.error === "ACCOUNT_LOCKED"
          ? 423
          : result.error === "ACCOUNT_UNAVAILABLE"
            ? 403
            : 401;

      res.status(status).json({
        success: false,
        message:
          result.message ??
          "Authentication failed.",
        error:
          result.error ??
          "AUTHENTICATION_FAILED",
      });

      return;
    }

    /*
     * MFA is not yet a completed authenticated session.
     * The MFA verification endpoint will be added later.
     */
    if (result.requiresMfa) {
      res.status(200).json({
        success: true,
        message:
          result.message ??
          "MFA verification required.",
        user: result.user,
        requiresMfa: true,
        requiresPasswordChange:
          result.requiresPasswordChange ?? false,
      });

      return;
    }

    res.status(200).json({
      success: true,
      message:
        result.message ??
        "Login successful.",
      user: result.user,
      sessionToken:
        result.sessionToken,
      expiresAt:
        result.expiresAt,
      requiresMfa: false,
      requiresPasswordChange:
        result.requiresPasswordChange ?? false,
    });
  } catch (error) {
    if (
      error instanceof
      AuthValidationError
    ) {
      res.status(400).json({
        success: false,
        error: error.code,
        message: error.message,
      });

      return;
    }

    console.error(
      "Login controller error:",
      error
    );

    res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
      message:
        "An unexpected authentication error occurred.",
    });
  }
}

/**
 * GET /api/auth/session
 *
 * Validates the currently supplied Bearer session.
 */
export async function sessionController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const authorization =
      req.headers.authorization;

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message:
          "Authentication session is required.",
      });

      return;
    }

    const rawToken =
      authorization
        .slice(7)
        .trim();

    const sessionToken =
      validateSessionToken(
        rawToken
      );

    const result =
      await validateSession(
        sessionToken
      );

    if (!result) {
      res.status(401).json({
        success: false,
        error: "INVALID_SESSION",
        message:
          "Your session is invalid, expired, or revoked.",
      });

      return;
    }

    res.status(200).json({
      success: true,
      user: {
        id:
          result.user.id,
        uid:
          result.user.uid,
        username:
          result.user.username,
        email:
          result.user.email,
        fullName:
          result.user.fullName,
        tenantId:
          result.user.tenantId,
        facilityId:
          result.user.facilityId,
        accountStatus:
          result.user.accountStatus,
        mustChangePassword:
          result.user.mustChangePassword,
        mfaEnabled:
          result.user.mfaEnabled,
        mfaRequired:
          result.user.mfaRequired,
      },
      session: {
        id:
          result.session.id,
        expiresAt:
          result.session.expiresAt,
        lastActivityAt:
          result.session.lastActivityAt,
      },
    });
  } catch (error) {
    if (
      error instanceof
      AuthValidationError
    ) {
      res.status(401).json({
        success: false,
        error: error.code,
        message: error.message,
      });

      return;
    }

    console.error(
      "Session validation controller error:",
      error
    );

    res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
      message:
        "Unable to validate authentication session.",
    });
  }
}

/**
 * POST /api/auth/logout
 */
export async function logoutController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const authorization =
      req.headers.authorization;

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      res.status(200).json({
        success: true,
        message: "Already logged out.",
      });

      return;
    }

    const rawToken =
      authorization
        .slice(7)
        .trim();

    const sessionToken =
      validateSessionToken(
        rawToken
      );

    const revoked =
      await revokeSession(
        sessionToken,
        "USER_LOGOUT"
      );

    res.status(200).json({
      success: true,
      message:
        revoked
          ? "Logout successful."
          : "Session already inactive.",
    });
  } catch (error) {
    if (
      error instanceof
      AuthValidationError
    ) {
      res.status(200).json({
        success: true,
        message:
          "Logout completed.",
      });

      return;
    }

    console.error(
      "Logout controller error:",
      error
    );

    res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
      message:
        "Unable to complete logout.",
    });
  }
}