/**
 * Operations status.
 *
 * Mounted at `/api/ops` *after* `requireAuth` and `requireAuthorization`, unlike
 * `/api/health` and `/api/ready`, which are public because a container probe
 * cannot authenticate. This endpoint names the facility's outstanding work, so
 * it is neither public nor usable without `audit.read`.
 *
 * The data is aggregate counters only — no patient, no amount, no free text.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope, ScopeAccessError } from '../auth/scope.service.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { facilityOperationsStatus } from '../operations/operations-status.service.ts';

const router = Router();

function respond(res: Response, err: unknown, fallback: string) {
  if (err instanceof ScopeAccessError) {
    return res.status(403).json({ success: false, error: err.code, message: err.message });
  }
  console.error('[ops]', fallback);
  return res
    .status(500)
    .json({ success: false, error: 'OPERATIONS_STATUS_FAILED', message: fallback });
}

router.get('/status', requirePermission('audit.read'), async (req: AuthRequest, res: Response) => {
  try {
    const context = req.authContext;
    if (!context) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    const raw = req.query.facilityId;
    const requested =
      typeof raw === 'string' && raw.trim() !== '' && /^[1-9]\d*$/.test(raw.trim())
        ? Number(raw)
        : undefined;
    const facilityId = resolveFacilityScope(context, requested);

    const [facility] = await db
      .select({ id: schema.facilities.id, tenantId: schema.facilities.tenantId })
      .from(schema.facilities)
      .where(eq(schema.facilities.id, facilityId))
      .limit(1);

    if (!facility) {
      return res.status(404).json({ success: false, error: 'FACILITY_NOT_FOUND' });
    }
    if (!context.isSuperAdmin && context.tenantId !== facility.tenantId) {
      return res.status(403).json({
        success: false,
        error: 'TENANT_ACCESS_DENIED',
        message: 'Facility access denied.',
      });
    }

    const status = await facilityOperationsStatus({
      tenantId: facility.tenantId,
      facilityId: facility.id,
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, ...status });
  } catch (err) {
    return respond(res, err, 'Operations status is unavailable.');
  }
});

export default router;
