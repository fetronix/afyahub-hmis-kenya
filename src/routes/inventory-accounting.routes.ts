/**
 * Inventory accounting routes: facility policy, activation and reconciliation.
 *
 * Kept apart from `/api/inventory` stock control because these endpoints change
 * *how the ledger treats stock*, not what is on the shelf. Configuration takes
 * `inventory.manage`; activation and reconciliation additionally require an
 * accounting permission, because a facility that can set up perpetual
 * accounting must be one whose finance function is actually involved.
 *
 * The facility is always resolved from the caller's scope, never from the body.
 */
import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as accounting from '../inventory/inventory-accounting.service.ts';
import { handleAccountingIntegrityError, respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';

const router = Router();

async function scope(req: AuthRequest, res: Response, rawFacilityId: unknown) {
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
      error: 'FACILITY_ACCOUNTING_USER_REQUIRED',
      message: 'Use an authorized facility account for inventory accounting.',
    });
    return null;
  }
  const facility = await requireScopedFacility(req, res, rawFacilityId);
  if (!facility) return null;
  return { tenantId: facility.tenantId, facilityId: facility.id };
}

function handleError(res: Response, err: unknown, where: string) {
  if (handleAccountingIntegrityError(err, res)) return;
  respondInternalError(res, err, where);
}

router.get(
  '/api/inventory/accounting-policy',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const state = await accounting.readInventoryAccountingPolicy(
        access.tenantId,
        access.facilityId,
      );
      res.json({ success: true, ...state });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/accounting-policy');
    }
  },
);

router.post(
  '/api/inventory/accounting-policy',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      const saved = await accounting.saveInventoryAccountingPolicy(access, req.body ?? {});
      res.status(201).json({ success: true, ...saved });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/accounting-policy');
    }
  },
);

router.post(
  '/api/inventory/accounting-policy/activate',
  requirePermission('inventory.manage', 'accounting.journals.post'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    const context = req.authContext!;
    try {
      const activated = await accounting.activateInventoryAccountingPolicy(
        {
          tenantId: access.tenantId,
          facilityId: access.facilityId,
          actorUserId: context.userId,
        },
        {
          ...(req.body ?? {}),
          /* The approver is the caller: this route already demands the posting
             permission, so the named approver is a real, identified user. */
          financeApprovedByUserId: (req.body ?? {}).financeApprovedByUserId ?? context.userId,
        },
      );
      res.status(201).json({ success: true, ...activated });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/accounting-policy/activate');
    }
  },
);

router.get(
  '/api/inventory/reconciliation',
  requirePermission('inventory.read', 'accounting.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const reconciliation = await accounting.readInventoryReconciliation({
        tenantId: access.tenantId,
        facilityId: access.facilityId,
        actorUserId: req.authContext!.userId,
      });
      res.json({ success: true, reconciliation });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/reconciliation');
    }
  },
);

export default router;
