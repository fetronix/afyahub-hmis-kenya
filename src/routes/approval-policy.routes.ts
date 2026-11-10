/** Facility approval-policy administration. Thresholds are tenant/facility scoped and audited. */
import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
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

router.get(
  '/api/approval-policies',
  requirePermission('procurement.read', 'facilities.read'),
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
  requirePermission('procurement.read', 'facilities.read'),
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
  requirePermission('procurement.approve', 'facilities.update'),
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
  requirePermission('procurement.approve', 'facilities.update'),
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
