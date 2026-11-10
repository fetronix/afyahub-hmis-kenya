/**
 * Stock control routes: movements ledger, adjustments, physical counts,
 * store transfers, reorder alerts and stock valuation.
 *
 * These sit beside the existing `/api/inventory` endpoints (items, batches,
 * expiry, receipt) rather than replacing them. Handlers declare full paths
 * because the domain router is mounted bare.
 */
import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as stock from '../inventory/stock-control.service.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';

const router = Router();

type Scope = stock.StockScope;

async function scope(
  req: AuthRequest,
  res: Response,
  rawFacilityId: unknown,
): Promise<Scope | null> {
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
      error: 'FACILITY_STOCK_USER_REQUIRED',
      message: 'Use an authorized facility account for stock control.',
    });
    return null;
  }
  const facility = await requireScopedFacility(req, res, rawFacilityId);
  if (!facility) return null;
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorId: context.userId,
    actorName: req.user.fullName || req.user.username,
  };
}

function idParam(req: AuthRequest, res: Response, label = 'record'): number | null {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res
      .status(400)
      .json({ success: false, error: 'INVALID_ID', message: `A valid ${label} ID is required.` });
    return null;
  }
  return id;
}

function handleError(res: Response, err: unknown, route: string) {
  if (err instanceof stock.StockError) {
    res.status(err.statusCode).json({ success: false, error: err.code, message: err.message });
    return;
  }
  respondInternalError(res, err, route);
}

/* --------------------------------------------------------------- movements */

router.get(
  '/api/inventory/movements',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const itemId = req.query.itemId === undefined ? undefined : Number(req.query.itemId);
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    try {
      const movements = await stock.listMovements(access, { itemId, from, to, limit });
      res.json({ success: true, movements });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/movements');
    }
  },
);

/* ------------------------------------------------------------- adjustments */

router.post(
  '/api/inventory/adjustments',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      const adjustment = await stock.adjustStock(access, req.body ?? {});
      res.status(201).json({ success: true, adjustment });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/adjustments');
    }
  },
);

/* ------------------------------------------------------------------ counts */

router.get(
  '/api/inventory/stock-counts',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json({ success: true, counts: await stock.listStockCounts(access) });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/stock-counts');
    }
  },
);

router.post(
  '/api/inventory/stock-counts',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      const count = await stock.createStockCount(access, req.body ?? {});
      res.status(201).json({ success: true, count });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/stock-counts');
    }
  },
);

router.get(
  '/api/inventory/stock-counts/:id',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const id = idParam(req, res, 'stock count');
    if (id === null) return;
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json({ success: true, count: await stock.getStockCount(access, id) });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/stock-counts/:id');
    }
  },
);

router.post(
  '/api/inventory/stock-counts/:id/lines',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const id = idParam(req, res, 'stock count');
    if (id === null) return;
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      const count = await stock.recordCountedQuantity(access, id, req.body ?? {});
      res.json({ success: true, count });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/stock-counts/:id/lines');
    }
  },
);

router.post(
  '/api/inventory/stock-counts/:id/post',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const id = idParam(req, res, 'stock count');
    if (id === null) return;
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      const posted = await stock.postStockCount(access, id);
      res.json({ success: true, ...posted });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/stock-counts/:id/post');
    }
  },
);

/* --------------------------------------------------------------- transfers */

router.get(
  '/api/inventory/transfers',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json({ success: true, transfers: await stock.listTransfers(access) });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/transfers');
    }
  },
);

router.post(
  '/api/inventory/transfers',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      const transfer = await stock.createTransfer(access, req.body ?? {});
      res.status(201).json({ success: true, transfer });
    } catch (err) {
      handleError(res, err, 'POST /api/inventory/transfers');
    }
  },
);

router.get(
  '/api/inventory/transfers/:id',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const id = idParam(req, res, 'transfer');
    if (id === null) return;
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json({ success: true, transfer: await stock.getTransfer(access, id) });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/transfers/:id');
    }
  },
);

/* --------------------------------------------------------------- reporting */

router.get(
  '/api/inventory/reorder-alerts',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json({ success: true, items: await stock.getReorderAlerts(access) });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/reorder-alerts');
    }
  },
);

router.put(
  '/api/inventory/items/:id/reorder-level',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const id = idParam(req, res, 'stock item');
    if (id === null) return;
    const access = await scope(req, res, req.body?.facilityId);
    if (!access) return;
    try {
      res.json({
        success: true,
        item: await stock.updateReorderLevel(access, id, req.body ?? {}),
      });
    } catch (err) {
      handleError(res, err, 'PUT /api/inventory/items/:id/reorder-level');
    }
  },
);

router.get(
  '/api/inventory/valuation',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json({ success: true, valuation: await stock.getValuation(access) });
    } catch (err) {
      handleError(res, err, 'GET /api/inventory/valuation');
    }
  },
);

export default router;
