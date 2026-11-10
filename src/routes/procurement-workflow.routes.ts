/**
 * Procurement chain routes: requisitions → goods received notes → invoices
 * → supplier payments.
 *
 * Handlers declare full paths because this router is mounted bare, matching
 * the other domain routers. Permissions are checked before any work, and every
 * failure returns a stable error code the UI can act on.
 */
import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as matching from '../procurement/matching.service.ts';
import * as receiving from '../procurement/receiving.service.ts';
import * as returns from '../procurement/returns.service.ts';
import * as requisitions from '../procurement/requisitions.service.ts';
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
    permissions: context.permissions ?? [],
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
  if (
    err instanceof requisitions.RequisitionError ||
    err instanceof receiving.ReceivingError ||
    err instanceof returns.ReturnsError ||
    err instanceof matching.MatchingError
  ) {
    res.status(err.statusCode).json({ success: false, error: err.code, message: err.message });
    return;
  }
  respondInternalError(res, err, route);
}

/* ---------------------------------------------------------- requisitions */

router.get(
  '/api/procurement/requisitions',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await requisitions.listRequisitions(access, {
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          page: Number(req.query.page ?? 1),
          pageSize: Number(req.query.pageSize ?? 25),
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/requisitions');
    }
  },
);

router.get(
  '/api/procurement/requisitions/:id',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'requisition');
    if (!id) return;
    try {
      res.json(await requisitions.getRequisition(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/requisitions/:id');
    }
  },
);

router.post(
  '/api/procurement/requisitions',
  requirePermission('procurement.read', 'procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await requisitions.createRequisition(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/requisitions');
    }
  },
);

router.put(
  '/api/procurement/requisitions/:id',
  requirePermission('procurement.read', 'procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'requisition');
    if (!id) return;
    try {
      res.json(await requisitions.updateRequisition(access, id, body));
    } catch (err) {
      handleError(res, err, 'PUT /api/procurement/requisitions/:id');
    }
  },
);

router.post(
  '/api/procurement/requisitions/:id/submit',
  requirePermission('procurement.read', 'procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'requisition');
    if (!id) return;
    try {
      res.json(await requisitions.submitRequisition(access, id));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/requisitions/:id/submit');
    }
  },
);

for (const decision of ['approve', 'reject'] as const) {
  router.post(
    `/api/procurement/requisitions/:id/${decision}`,
    requirePermission('procurement.read', 'procurement.approve'),
    async (req: AuthRequest, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
      if (!access) return;
      const id = idParam(req, res, 'requisition');
      if (!id) return;
      try {
        res.json(await requisitions.decideRequisition(access, id, decision, body));
      } catch (err) {
        handleError(res, err, `POST /api/procurement/requisitions/:id/${decision}`);
      }
    },
  );
}

router.post(
  '/api/procurement/requisitions/:id/convert',
  requirePermission('procurement.read', 'procurement.create'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'requisition');
    if (!id) return;
    try {
      res.json(await requisitions.convertRequisition(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/requisitions/:id/convert');
    }
  },
);

/* ------------------------------------------------------ goods received */

router.get(
  '/api/procurement/goods-received',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const orderId = Number(req.query.purchaseOrderId ?? 0) || undefined;
      res.json(await receiving.listGoodsReceivedNotes(access, orderId));
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/goods-received');
    }
  },
);

router.get(
  '/api/procurement/purchase-orders/:id/outstanding',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'purchase order');
    if (!id) return;
    try {
      res.json(await receiving.outstandingOrderLines(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/purchase-orders/:id/outstanding');
    }
  },
);

router.post(
  '/api/procurement/goods-received',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await receiving.postGoodsReceivedNote(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/goods-received');
    }
  },
);

router.get(
  '/api/procurement/goods-received/:id',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'goods received note');
    if (!id) return;
    try {
      res.json(await receiving.getGoodsReceivedNote(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/goods-received/:id');
    }
  },
);

/* ------------------------------------------------------------ payables */

router.get(
  '/api/procurement/supplier-invoices',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await receiving.listSupplierInvoices(
          access,
          typeof req.query.status === 'string' ? req.query.status : undefined,
        ),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-invoices');
    }
  },
);

router.get(
  '/api/procurement/supplier-invoices/:id',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'supplier invoice');
    if (!id) return;
    try {
      res.json(await receiving.getSupplierInvoice(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-invoices/:id');
    }
  },
);

router.post(
  '/api/procurement/supplier-invoices',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await receiving.createSupplierInvoice(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/supplier-invoices');
    }
  },
);

router.post(
  '/api/procurement/supplier-invoices/:id/payments',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'supplier invoice');
    if (!id) return;
    try {
      res.status(201).json(await receiving.paySupplierInvoice(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/supplier-invoices/:id/payments');
    }
  },
);

/* ------------------------------------------------- three-way matching */

router.get(
  '/api/procurement/supplier-invoices/:id/match',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'supplier invoice');
    if (!id) return;
    try {
      const match = await matching.readMatch(access.tenantId, access.facilityId, id);
      res.json({ success: true, match });
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-invoices/:id/match');
    }
  },
);

router.post(
  '/api/procurement/supplier-invoices/:id/match',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'supplier invoice');
    if (!id) return;
    try {
      const match = await matching.matchSupplierInvoice({
        tenantId: access.tenantId,
        facilityId: access.facilityId,
        supplierInvoiceId: id,
        toleranceCents: Number.isFinite(Number(body.tolerance))
          ? Math.max(0, Math.round(Number(body.tolerance) * 100))
          : 0,
        checkedByUserId: access.actorId,
      });
      res.json({ success: true, match });
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/supplier-invoices/:id/match');
    }
  },
);

router.post(
  '/api/procurement/supplier-invoices/:id/match-override',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'supplier invoice');
    if (!id) return;
    try {
      const match = await matching.overrideMatch(access, id, body);
      res.json({ success: true, match });
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/supplier-invoices/:id/match-override');
    }
  },
);

/* ------------------------------------------------------ supplier returns */

router.get(
  '/api/procurement/supplier-returns',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const rawGrn = req.query.goodsReceivedNoteId;
    const grnId = rawGrn === undefined || rawGrn === '' ? undefined : Number(rawGrn);
    if (grnId !== undefined && (!Number.isSafeInteger(grnId) || grnId <= 0)) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid note ID is required.' });
      return;
    }
    try {
      res.json({ success: true, returns: await returns.listSupplierReturns(access, grnId) });
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-returns');
    }
  },
);

router.get(
  '/api/procurement/supplier-returns/:id',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'supplier return');
    if (!id) return;
    try {
      res.json({ success: true, return: await returns.getSupplierReturn(access, id) });
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-returns/:id');
    }
  },
);

router.post(
  '/api/procurement/supplier-returns',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await returns.postSupplierReturn(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/supplier-returns');
    }
  },
);

/* --------------------------------------------------- supplier credit notes */

router.get(
  '/api/procurement/supplier-credit-notes',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const rawInvoice = req.query.supplierInvoiceId;
    const invoiceId =
      rawInvoice === undefined || rawInvoice === '' ? undefined : Number(rawInvoice);
    if (invoiceId !== undefined && (!Number.isSafeInteger(invoiceId) || invoiceId <= 0)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_ID',
        message: 'A valid invoice ID is required.',
      });
      return;
    }
    try {
      res.json({
        success: true,
        creditNotes: await returns.listSupplierCreditNotes(access, invoiceId),
      });
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-credit-notes');
    }
  },
);

router.get(
  '/api/procurement/supplier-credit-notes/:id',
  requirePermission('procurement.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'credit note');
    if (!id) return;
    try {
      res.json({ success: true, creditNote: await returns.getSupplierCreditNote(access, id) });
    } catch (err) {
      handleError(res, err, 'GET /api/procurement/supplier-credit-notes/:id');
    }
  },
);

router.post(
  '/api/procurement/supplier-credit-notes',
  requirePermission('procurement.read', 'procurement.complete'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await returns.createSupplierCreditNote(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/procurement/supplier-credit-notes');
    }
  },
);

export default router;
