import { Router } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { requireScopedFacility } from '../routes/shared/scoping.ts';
import { PlanningError, assert } from './calculations.ts';
import { resetInventory, previewReset, executeReset } from './planning-reset.service.ts';

const router = Router();
router.use(requirePermission('accounting.planning.manage', 'accounting.planning.reset'));
router.use(async (req: AuthRequest, res, next) => {
  const ctx = req.authContext;
  if (
    !ctx ||
    ctx.isSuperAdmin ||
    !ctx.roles.includes('FACILITY_ADMIN') ||
    !ctx.facilityId ||
    !ctx.tenantId
  ) {
    res.status(403).json({
      error: 'FACILITY_ADMIN_REQUIRED',
      message:
        'Reset requires a facility-assigned FACILITY_ADMIN with planning manage and reset permissions.',
    });
    return;
  }
  // Scope is always the authenticated facility. A client hint may only agree with it.
  const hints = [req.query.facilityId, req.body?.facilityId].filter((v) => v !== undefined);
  if (hints.some((v) => Number(v) !== ctx.facilityId)) {
    res.status(403).json({
      error: 'RESET_FACILITY_MISMATCH',
      message:
        'The selected facility does not match your authenticated facility. Nothing was reset.',
    });
    return;
  }
  next();
});
for (const [path, method, work] of [
  ['/', 'get', resetInventory],
  ['/preview', 'post', previewReset],
  ['/execute', 'post', executeReset],
] as const) {
  router[method](path, async (req: AuthRequest, res) => {
    try {
      const ctx = req.authContext!;
      const f = await requireScopedFacility(req, res, ctx.facilityId);
      if (!f) return;
      assert(
        f.tenantId === ctx.tenantId,
        'RESET_TENANT_MISMATCH',
        'Facility is outside your tenant.',
        403,
      );
      const result = await work(
        { tenantId: f.tenantId, facilityId: f.id, actorId: ctx.userId },
        req.body ?? {},
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(result);
    } catch (e) {
      if (e instanceof PlanningError)
        res.status(e.status).json({ error: e.code, message: e.message });
      else
        res.status(500).json({
          error: 'RESET_FAILED',
          message:
            'Reset could not be verified. Refresh planning data and audit history before retrying. Reset writes are atomic.',
        });
    }
  });
}
export default router;
