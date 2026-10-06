import type { Request, Response, NextFunction } from "express";
import type {
  AuthorizationContext,
} from "./authorization.types";

import {
  validateSession,
} from "./auth.service";

import {
  validateSessionToken,
} from "./auth.validation";

import type {
  AuthenticatedUser,
} from "./auth.types";

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;

  session?: {
    id: number;
    userId: number;
    expiresAt: Date;
  };

  authContext?: AuthorizationContext;
}

function getSessionToken(
  req: Request
): string | null {
  const authorization =
    req.headers.authorization;

  if (
    authorization &&
    authorization.startsWith("Bearer ")
  ) {
    const token =
      authorization.slice(7).trim();

    if (token) {
      return token;
    }
  }

  return null;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawToken =
      getSessionToken(req);

    if (!rawToken) {
      res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message:
          "Authentication is required.",
      });
      return;
    }

    let sessionToken: string;

    try {
      sessionToken =
        validateSessionToken(
          rawToken
        );
    } catch {
      res.status(401).json({
        success: false,
        error: "INVALID_SESSION",
        message:
          "Invalid authentication session.",
      });
      return;
    }

    const result =
      await validateSession(
        sessionToken
      );

    if (!result) {
      res.status(401).json({
        success: false,
        error: "INVALID_SESSION",
        message:
          "Your session is invalid, expired, or has been revoked.",
      });
      return;
    }

    const {
      session,
      user,
    } = result;

    if (
      !user.isActive ||
      user.accountStatus === "DISABLED"
    ) {
      res.status(403).json({
        success: false,
        error: "ACCOUNT_DISABLED",
        message:
          "Your account has been disabled.",
      });
      return;
    }

    if (
      user.accountStatus === "SUSPENDED"
    ) {
      res.status(403).json({
        success: false,
        error: "ACCOUNT_SUSPENDED",
        message:
          "Your account has been suspended.",
      });
      return;
    }

    if (
      user.accountStatus === "LOCKED"
    ) {
      res.status(403).json({
        success: false,
        error: "ACCOUNT_LOCKED",
        message:
          "Your account is temporarily locked.",
      });
      return;
    }

    req.user = {
      id: user.id,
      uid: user.uid,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      tenantId: user.tenantId,
      facilityId: user.facilityId,
      accountStatus: user.accountStatus,
      mustChangePassword:
        user.mustChangePassword,
      mfaEnabled: user.mfaEnabled,
      mfaRequired: user.mfaRequired,
    };

    req.session = {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    };

    next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error
    );

    res.status(500).json({
      success: false,
      error: "AUTHENTICATION_ERROR",
      message:
        "An authentication error occurred.",
    });
  }
}