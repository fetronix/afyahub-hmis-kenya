/**
 * JaliCare HMIS
 * Authorization Middleware
 */

import type { Response, NextFunction } from 'express';

import type { AuthRequest } from './auth.middleware';

import {
  loadAuthorizationContext,
  hasAllPermissions,
  hasAnyPermission,
  hasRole,
  canAccessTenant,
} from './authorization.service';

/* ============================================================
   LOAD AUTHORIZATION
   ============================================================ */

export async function requireAuthorization(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication is required.',
      });

      return;
    }

    const context = await loadAuthorizationContext(req.user.id);

    if (!context) {
      res.status(403).json({
        success: false,
        error: 'AUTHORIZATION_FAILED',
        message: 'Your account is not authorized to access this resource.',
      });

      return;
    }

    req.authContext = context;

    next();
  } catch (error) {
    console.error('Authorization context error:', error);

    res.status(500).json({
      success: false,
      error: 'AUTHORIZATION_ERROR',
      message: 'An authorization error occurred.',
    });
  }
}

/* ============================================================
   REQUIRE ALL PERMISSIONS
   ============================================================ */

export function requirePermission(...requiredPermissions: string[]) {
  return async function permissionMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication is required.',
        });

        return;
      }

      if (!req.authContext) {
        const context = await loadAuthorizationContext(req.user.id);

        if (!context) {
          res.status(403).json({
            success: false,
            error: 'AUTHORIZATION_FAILED',
            message: 'Your account is not authorized.',
          });

          return;
        }

        req.authContext = context;
      }

      const allowed = hasAllPermissions(req.authContext, requiredPermissions);

      if (!allowed) {
        res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        });

        return;
      }

      next();
    } catch (error) {
      console.error('Permission middleware error:', error);

      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: 'An authorization error occurred.',
      });
    }
  };
}

/* ============================================================
   REQUIRE ANY PERMISSION
   ============================================================ */

export function requireAnyPermission(...requiredPermissions: string[]) {
  return async function permissionMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication is required.',
        });

        return;
      }

      if (!req.authContext) {
        const context = await loadAuthorizationContext(req.user.id);

        if (!context) {
          res.status(403).json({
            success: false,
            error: 'AUTHORIZATION_FAILED',
            message: 'Your account is not authorized.',
          });

          return;
        }

        req.authContext = context;
      }

      if (!hasAnyPermission(req.authContext, requiredPermissions)) {
        res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'You do not have the required permission.',
        });

        return;
      }

      next();
    } catch (error) {
      console.error('Permission middleware error:', error);

      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: 'An authorization error occurred.',
      });
    }
  };
}

/* ============================================================
   REQUIRE ROLE
   ============================================================ */

export function requireRole(...requiredRoles: string[]) {
  return async function roleMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication is required.',
        });

        return;
      }

      if (!req.authContext) {
        const context = await loadAuthorizationContext(req.user.id);

        if (!context) {
          res.status(403).json({
            success: false,
            error: 'AUTHORIZATION_FAILED',
            message: 'Your account is not authorized.',
          });

          return;
        }

        req.authContext = context;
      }

      const allowed = requiredRoles.some((role) => hasRole(req.authContext!, role));

      if (!allowed) {
        res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'You do not have the required role.',
        });

        return;
      }

      next();
    } catch (error) {
      console.error('Role middleware error:', error);

      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: 'An authorization error occurred.',
      });
    }
  };
}

/* ============================================================
   REQUIRE TENANT ACCESS
   ============================================================ */

export function requireTenantAccess(getTenantId: (req: AuthRequest) => number | null) {
  return async function tenantMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.authContext) {
        res.status(500).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context has not been initialized.',
        });

        return;
      }

      const tenantId = getTenantId(req);

      if (tenantId === null || !canAccessTenant(req.authContext, tenantId)) {
        res.status(403).json({
          success: false,
          error: 'TENANT_ACCESS_DENIED',
          message: 'You are not authorized to access this tenant.',
        });

        return;
      }

      next();
    } catch (error) {
      console.error('Tenant authorization error:', error);

      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: 'An authorization error occurred.',
      });
    }
  };
}

/* ============================================================
   REQUIRE SUPER ADMIN
   ============================================================ */

/**
 * Platform-owner only.
 *
 * Used for screens and endpoints whose audience is the organisation
 * running the installation, not the staff of one facility: the DHA
 * readiness assessment and the integration readiness report both
 * describe the whole product and name what it cannot do yet.
 *
 * This is deliberately not a permission. A permission can be granted to
 * a role inside a facility; `isSuperAdmin` is a property of the account
 * itself and cannot be assigned by a facility administrator.
 */
export function requireSuperAdmin() {
  return async function superAdminMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication is required.',
        });

        return;
      }

      if (!req.authContext) {
        const context = await loadAuthorizationContext(req.user.id);

        if (!context) {
          res.status(403).json({
            success: false,
            error: 'AUTHORIZATION_FAILED',
            message: 'Your account is not authorized.',
          });

          return;
        }

        req.authContext = context;
      }

      if (!req.authContext.isSuperAdmin) {
        res.status(403).json({
          success: false,
          error: 'SUPER_ADMIN_REQUIRED',
          message:
            'This view is restricted to the platform owner. A facility role cannot grant it.',
        });

        return;
      }

      next();
    } catch (error) {
      console.error('Super admin authorization error:', error);

      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: 'An authorization error occurred.',
      });
    }
  };
}
