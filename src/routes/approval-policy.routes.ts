/**
 * Facility approval-policy administration. Thresholds are tenant/facility scoped and audited.
 *
 * WHY `requireAnyPermission` AND NOT `requirePermission`
 * ----------------------------------------------------
 * `requirePermission` is ALL-of (`hasAllPermissions`). Written that way, viewing
 * required *both* `procurement.read` and `facilities.read`, and writing required
 * both `procurement.approve` and `facilities.update`. No seeded role holds
 * either pair — the facility-administrator set holds neither — so the screen
 * would have answered 403 to every real account. The gates are now any-of,
 * which is what the intent always was.
 *
 * SEGREGATION OF DUTIES
 * ---------------------
 * Writing a threshold deliberately does NOT accept `procurement.approve`.
 * A person who approves spending must not be able to move the bar that governs
 * their own approvals: lowering a threshold, or deactivating the rule that
 * blocks them, would otherwise be a one-step bypass of the control. Policy
 * administration is therefore a facility-governance act
 * (`approval_policies.manage`, `facilities.update` or `facilities.modules.manage`),
 * while reading the thresholds is open to procurement readers, who need to know
 * what an approval will require.
 *
 * Residual limitation, stated rather than hidden: an account that holds both a
 * governance permission and `procurement.approve` can still do both. Closing
 * that would need dual control on policy changes (propose/approve), which is a
 * larger workflow than this screen and is not claimed here.
 */
import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission } from '../auth/authorization.middleware.ts';
import * as policies from '../facility/approval-policy.service.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';

const router = Router();

type Scope = {
  tenantId: number;
  facilityId: number;
  actorId: number;
  actorName: string;
  permissions: string[];
};

async function scope(req: AuthRequest, res: Response, raw: unknown): Promise<Scope | null> {
  const context = req.authContext;
  if (!context || !req.user) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return null;
  }
  if (context.isSuperAdmin && context.tenantId === null) {
    res.status(403).json({
      success: false,
      error: 'FACILITY_USER_REQUIRED',
      message: 'Use an authorized facility account to administer approvals.',
    });
    return null;
  }
  const facility = await requireScopedFacility(req, res, raw);
  if (!facility) return null;
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorId: context.userId,
    actorName: req.user.fullName || req.user.username,
    permissions: context.permissions ?? [],
  };
}

/** Domain failures carry their own status; anything else is a 500. */
function handleError(res: Response, err: unknown, route: string) {
  if (err instanceof policies.ApprovalPolicyError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.code,
      message: err.message,
      ...(err.detail ? { detail: err.detail } : {}),
    });
  } else respondInternalError(res, err, route);
}

function idParam(req: AuthRequest, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      error: 'INVALID_ID',
      message: 'A numeric policy id is required.',
    });
    return null;
  }
  return id;
}

/** Who may see the thresholds: anyone who reads procurement, or governs the facility. */
const CAN_READ = [
  'approval_policies.read',
  'approval_policies.manage',
  'procurement.read',
  'procurement.approve',
  'facilities.read',
  'facilities.modules.manage',
] as const;

/** Who may change a threshold: facility governance only. Never `procurement.approve`. */
const CAN_WRITE = [
  'approval_policies.manage',
  'facilities.update',
  'facilities.modules.manage',
] as const;

router.get(
  '/api/approval-policies',
  requireAnyPermission(...CAN_READ),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const rows = await policies.listPolicies(access);
      res.json({ policies: rows, activeCount: rows.filter((row) => row.isActive).length });
    } catch (err) {
      handleError(res, err, 'GET /api/approval-policies');
    }
  },
);

router.get(
  '/api/approval-policies/preview',
  requireAnyPermission(...CAN_READ),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await policies.previewRequirement(
          access,
          req.query.scope ?? 'PURCHASE_ORDER',
          req.query.amountCents ?? 0,
          access.permissions,
        ),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/approval-policies/preview');
    }
  },
);

router.post(
  '/api/approval-policies',
  requireAnyPermission(...CAN_WRITE),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json({ policy: await policies.createPolicy(access, body) });
    } catch (err) {
      handleError(res, err, 'POST /api/approval-policies');
    }
  },
);

router.put(
  '/api/approval-policies/:id',
  requireAnyPermission(...CAN_WRITE),
  async (req: AuthRequest, res: Response) => {
    const id = idParam(req, res);
    if (!id) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json({ policy: await policies.updatePolicy(access, id, body) });
    } catch (err) {
      handleError(res, err, 'PUT /api/approval-policies/:id');
    }
  },
);

export default router;
