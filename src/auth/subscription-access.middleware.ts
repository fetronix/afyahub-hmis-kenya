import type { NextFunction, Response } from 'express';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import { facilitySubscriptionAccess } from '../db/schema';
import type { AuthRequest } from './auth.middleware';

export interface SubscriptionFacilityScope {
  tenantId: number;
  facilityId: number;
}

/**
 * The resolver must return a facility scope verified against the
 * database, never an unverified facility ID from the request.
 */
export type SubscriptionFacilityResolver = (
  req: AuthRequest,
) => Promise<SubscriptionFacilityScope | null>;

/**
 * Create a route-level subscription access check.
 *
 * - Super Admin can continue managing billing and reactivation.
 * - Facility users use their authenticated facility assignment.
 * - Tenant-level routes must provide a database-verified resolver.
 * - Missing access rows are treated as ACTIVE for facilities not
 *   yet enrolled in subscription access control.
 * - Database failures fail closed with 503.
 *
 * This middleware is not mounted globally. Attach it only to
 * routes covered by an approved subscription access policy.
 */
export function requireActiveFacilitySubscription(resolveScope?: SubscriptionFacilityResolver) {
  return async function facilitySubscriptionGuard(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const context = req.authContext;

    if (!context) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return;
    }

    if (context.isSuperAdmin) {
      next();
      return;
    }

    try {
      let scope: SubscriptionFacilityScope | null = null;

      if (resolveScope) {
        scope = await resolveScope(req);
      } else if (context.facilityId !== null && context.tenantId !== null) {
        scope = {
          facilityId: context.facilityId,
          tenantId: context.tenantId,
        };
      }

      if (
        !scope ||
        !Number.isSafeInteger(scope.facilityId) ||
        scope.facilityId <= 0 ||
        !Number.isSafeInteger(scope.tenantId) ||
        scope.tenantId <= 0
      ) {
        res.status(400).json({
          success: false,
          error: 'SUBSCRIPTION_FACILITY_SCOPE_REQUIRED',
          message: 'A verified facility scope is required for this operation.',
        });
        return;
      }

      if (context.tenantId !== null && context.tenantId !== scope.tenantId) {
        res.status(403).json({
          success: false,
          error: 'FACILITY_ACCESS_DENIED',
          message: 'The facility is outside your tenant scope.',
        });
        return;
      }

      const [access] = await db
        .select({
          tenantId: facilitySubscriptionAccess.tenantId,
          accessStatus: facilitySubscriptionAccess.accessStatus,
        })
        .from(facilitySubscriptionAccess)
        .where(
          and(
            eq(facilitySubscriptionAccess.facilityId, scope.facilityId),
            eq(facilitySubscriptionAccess.tenantId, scope.tenantId),
          ),
        )
        .limit(1);

      // Facilities without a subscription-access record remain
      // available until explicitly enrolled in access control.
      if (!access) {
        next();
        return;
      }

      if (access.accessStatus === 'SUSPENDED') {
        res.status(403).json({
          success: false,
          error: 'FACILITY_SUBSCRIPTION_SUSPENDED',
          message:
            "This facility's subscription access is suspended. Contact the platform administrator.",
        });
        return;
      }

      if (access.accessStatus !== 'ACTIVE') {
        res.status(503).json({
          success: false,
          error: 'SUBSCRIPTION_STATUS_INVALID',
          message: 'Facility subscription access could not be safely verified.',
        });
        return;
      }

      next();
    } catch (error) {
      console.error('[facility-subscription-guard] Access check failed:', error);

      res.status(503).json({
        success: false,
        error: 'SUBSCRIPTION_ACCESS_UNAVAILABLE',
        message: 'Facility access could not be verified. Please retry shortly.',
      });
    }
  };
}
