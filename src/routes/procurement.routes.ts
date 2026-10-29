/** Tenant/facility scoped procurement routes. Mutations are permission-gated and audited. */
import { Router, type Response } from 'express';
import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import * as procurement from '../procurement/procurement.service.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';

const router = Router();

type Scope = { tenantId: number; facilityId: number; actorId: number; actorName: string };
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
  // A platform-only administrator is not automatically a facility procurement user.
  if (context.isSuperAdmin && context.tenantId === null) {
    res.status(403).json({
      success: false,
      error: 'FACILITY_PROCUREMENT_USER_REQUIRED',
      message: 'Use an authorized facility account for procurement.',
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
function idParam(req: AuthRequest, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res
      .status(400)
      .json({ success: false, error: 'INVALID_ID', message: 'A valid record ID is required.' });
    return null;
  }
  return id;
}
function handleError(res: Response, err: unknown, route: string) {
  if (err instanceof queries.PurchaseOrderError) {
    res.status(err.statusCode).json({ success: false, error: err.code, message: err.message });
  } else respondInternalError(res, err, route);
}

router.get(
  '/api/suppliers',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    if (req.query.tenantId !== undefined && req.query.tenantId !== '') {
      const requested = Number(req.query.tenantId);
      if (!Number.isSafeInteger(requested) || requested <= 0)
        return res.status(400).json({
          success: false,
          error: 'INVALID_TENANT_ID',
          message: 'tenantId must be a positive integer.',
        });
      if (requested !== access.tenantId)
        return res.status(403).json({
          success: false,
          error: 'TENANT_ACCESS_DENIED',
          message: 'You are not authorized to access this tenant.',
        });
    }
    try {
      res.json(await queries.getSuppliers(access.tenantId));
    } catch (err) {
      handleError(res, err, 'GET /api/suppliers');
    }
  },
);

router.post(
  '/api/suppliers',
  requirePermission('procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await procurement.createSupplier(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/suppliers');
    }
  },
);
router.put(
  '/api/suppliers/:id',
  requirePermission('procurement.read', 'procurement.update'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await procurement.updateSupplier(access, id, body));
    } catch (err) {
      handleError(res, err, 'PUT /api/suppliers/:id');
    }
  },
);
router.delete(
  '/api/suppliers/:id',
  requirePermission('procurement.read', 'procurement.delete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await procurement.deactivateSupplier(access, id, body));
    } catch (err) {
      handleError(res, err, 'DELETE /api/suppliers/:id');
    }
  },
);

router.get(
  '/api/purchase-orders',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await queries.getPurchaseOrders(access.facilityId, access.tenantId));
    } catch (err) {
      handleError(res, err, 'GET /api/purchase-orders');
    }
  },
);
router.get(
  '/api/purchase-orders/:id',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await procurement.purchaseOrderDetails(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/purchase-orders/:id');
    }
  },
);
router.post(
  '/api/purchase-orders',
  requirePermission('procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    if (
      (body.status !== undefined && body.status !== 'Pending Approval') ||
      (body.approvedBy !== undefined && body.approvedBy !== null && body.approvedBy !== '')
    ) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PURCHASE_ORDER_STATUS',
        message: 'New purchase orders must be pending approval and cannot specify an approver.',
      });
    }
    try {
      const payload = {
        facilityId: access.facilityId,
        tenantId: access.tenantId,
        supplierId: body.supplierId,
        supplierName: body.supplierName,
        confirmDuplicateSupplier: body.confirmDuplicateSupplier,
        poNumber: body.poNumber,
        totalAmount: body.totalAmount,
        description: body.description,
        expectedDeliveryDate: body.expectedDeliveryDate,
        deliveryAddress: body.deliveryAddress,
        paymentTerms: body.paymentTerms,
        notes: body.notes,
        items: body.items,
        ...(body.taxAmount !== undefined ? { taxAmount: body.taxAmount } : {}),
        ...(body.shippingAmount !== undefined ? { shippingAmount: body.shippingAmount } : {}),
        ...(body.discountAmount !== undefined ? { discountAmount: body.discountAmount } : {}),
        status: 'Pending Approval',
        orderedBy: access.actorName,
      } as Parameters<typeof queries.createPurchaseOrder>[0];
      res.status(201).json(await queries.createPurchaseOrder(payload, access.actorId));
    } catch (err) {
      handleError(res, err, 'POST /api/purchase-orders');
    }
  },
);
router.put(
  '/api/purchase-orders/:id',
  requirePermission('procurement.read', 'procurement.update'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await procurement.updatePurchaseOrder(access, id, body));
    } catch (err) {
      handleError(res, err, 'PUT /api/purchase-orders/:id');
    }
  },
);
for (const action of ['approve', 'reject', 'complete'] as const) {
  router.post(
    `/api/purchase-orders/:id/${action}`,
    requirePermission('procurement.read', `procurement.${action}`),
    async (req: AuthRequest, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
      if (!access) return;
      const id = idParam(req, res);
      if (!id) return;
      try {
        res.json(await procurement.transitionPurchaseOrder(access, id, action, body));
      } catch (err) {
        handleError(res, err, `POST /api/purchase-orders/:id/${action}`);
      }
    },
  );
}
router.delete(
  '/api/purchase-orders/:id',
  requirePermission('procurement.read', 'procurement.delete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await procurement.transitionPurchaseOrder(access, id, 'cancel', body));
    } catch (err) {
      handleError(res, err, 'DELETE /api/purchase-orders/:id');
    }
  },
);
export default router;
