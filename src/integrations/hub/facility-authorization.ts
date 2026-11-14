import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';

/**
 * Integration administration is deliberately narrower than general task
 * delegation: the account must be assigned to a facility, hold the existing
 * FACILITY_ADMIN role, and separately hold each route's required permission.
 * The route still resolves and verifies the requested facility against the DB.
 */
export function requireFacilityIntegrationAdministrator(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const context = req.authContext;
  if (
    !context ||
    context.isSuperAdmin ||
    !context.tenantId ||
    !context.facilityId ||
    !context.roles.includes('FACILITY_ADMIN')
  ) {
    res.status(403).json({
      success: false,
      error: 'FACILITY_ADMIN_REQUIRED',
      message: 'An authorized facility administrator is required for integration administration.',
    });
    return;
  }
  next();
}
