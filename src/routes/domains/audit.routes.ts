/**
 * Audit log.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import * as queries from '../../db/queries.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';

const router = Router();

// =========================================================
// AUDIT TRAIL
// =========================================================

router.get(
  '/api/audit-logs',
  requirePermission('audit.read'),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
      });
    }

    const rawFacilityId = req.query.facilityId;
    let facilityId: number | undefined;

    if (rawFacilityId !== undefined) {
      if (
        typeof rawFacilityId !== 'string' ||
        !/^[1-9]\d*$/.test(rawFacilityId) ||
        !Number.isSafeInteger(Number(rawFacilityId))
      ) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
          message: 'facilityId must be a positive integer.',
        });
      }

      facilityId = Number(rawFacilityId);
    }

    const context = req.authContext;

    if (
      !context.isSuperAdmin &&
      context.facilityId !== null &&
      facilityId !== undefined &&
      facilityId !== context.facilityId
    ) {
      return res.status(403).json({
        success: false,
        error: 'FACILITY_ACCESS_DENIED',
        message: "You cannot view another facility's audit logs.",
      });
    }

    try {
      const list = await queries.getAuditLogs(context, facilityId);
      return res.json(list);
    } catch (err: unknown) {
      console.error('Failed to fetch audit logs:', err);

      return res.status(500).json({
        success: false,
        error: 'AUDIT_LOG_FETCH_FAILED',
        message: 'Unable to retrieve audit logs.',
      });
    }
  },
);

export default router;
