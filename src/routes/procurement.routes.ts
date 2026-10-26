/**
 * The procurement routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';
import { Router, type Response } from 'express';

const router = Router();

// =========================================================
// PROCUREMENT
// =========================================================

router.get(
  '/api/suppliers',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const context = req.authContext;

    if (!context) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });

      return;
    }

    const rawTenantId = req.query.tenantId;

    let tenantId: number | undefined;

    if (rawTenantId !== undefined && rawTenantId !== '') {
      tenantId = Number(rawTenantId);

      if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_TENANT_ID',
          message: 'tenantId must be a positive integer.',
        });

        return;
      }
    }

    if (!context.isSuperAdmin) {
      if (context.tenantId === null) {
        res.status(403).json({
          success: false,
          error: 'TENANT_SCOPE_REQUIRED',
          message: 'Your account is not attached to a tenant.',
        });

        return;
      }

      if (tenantId !== undefined && tenantId !== context.tenantId) {
        res.status(403).json({
          success: false,
          error: 'TENANT_ACCESS_DENIED',
          message: 'You are not authorized to access this tenant.',
        });

        return;
      }

      tenantId = context.tenantId;
    }

    try {
      const list = await queries.getSuppliers(tenantId);

      res.json(list);
    } catch (err: any) {
      respondInternalError(res, err, 'GET /api/suppliers');
    }
  },
);

router.get(
  '/api/purchase-orders',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const facility = await requireScopedFacility(req, res, req.query.facilityId);

    if (!facility) return;

    try {
      const list = await queries.getPurchaseOrders(facility.id);

      res.json(list);
    } catch (err: any) {
      respondInternalError(res, err, 'GET /api/purchase-orders');
    }
  },
);

router.post(
  '/api/purchase-orders',
  requirePermission('procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const facility = await requireScopedFacility(req, res, body.facilityId ?? req.query.facilityId);

    if (!facility) return;

    try {
      const payload = {
        ...body,
        facilityId: facility.id,
        tenantId: facility.tenantId,
      } as Parameters<typeof queries.createPurchaseOrder>[0];

      const po = await queries.createPurchaseOrder(payload);

      res.status(201).json(po);
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/purchase-orders');
    }
  },
);

export default router;
