/**
 * The pharmacy & inventory routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { hasAllPermissions } from '../auth/authorization.service.ts';
import { parseMoneyToCents } from '../billing/settlement.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import * as billing from '../billing/billing.service.ts';
import * as queries from '../db/queries.ts';
import * as inventory from '../inventory/inventory.service.ts';
import { chargeSafely } from './shared/charges.ts';
import { handleInventoryError, handleScopeError, respondInternalError } from './shared/errors.ts';
import { requireAuthContext } from './shared/request.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { createInventoryItemBodySchema } from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// PHARMACY & INVENTORY
// =========================================================

/**
 * Batches with their expiry status, ordered earliest expiry first.
 * Everything reaches the facility through inventory_items, because
 * inventory_batches has no facility column of its own.
 */
router.get(
  '/api/inventory/batches',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'All';

      if (!['All', 'Expired', 'Expiring', 'OK'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_STATUS',
          message: 'status must be one of All, Expired, Expiring, OK.',
        });
      }

      const rows = await inventory.getBatchesScoped(context, {
        facilityId: req.query.facilityId ? Number(req.query.facilityId) : undefined,
        itemId: req.query.itemId ? Number(req.query.itemId) : undefined,
        status: status as 'All' | 'Expired' | 'Expiring' | 'OK',
        horizonDays: req.query.horizonDays ? Number(req.query.horizonDays) : undefined,
      });

      return res.json(rows);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (handleInventoryError(err, res)) return;

      console.error('Batch list error:', err);
      return res.status(500).json({
        success: false,
        error: 'BATCH_LIST_FAILED',
      });
    }
  },
);

/**
 * Expired and near-expiry stock for the facility.
 */
router.get(
  '/api/inventory/expiry-summary',
  requirePermission('inventory.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const summary = await inventory.getExpirySummaryScoped(
        context,
        req.query.facilityId ? Number(req.query.facilityId) : undefined,
        req.query.days ? Number(req.query.days) : 30,
      );

      return res.json(summary);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (handleInventoryError(err, res)) return;

      console.error('Expiry summary error:', err);
      return res.status(500).json({
        success: false,
        error: 'EXPIRY_SUMMARY_FAILED',
      });
    }
  },
);

/**
 * Receive stock into a batch.
 *
 * Tops up an existing batch number instead of failing, so a second
 * delivery of the same lot is not rejected by the unique index.
 */
router.post(
  '/api/inventory/:id/batches',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    const itemId = Number(req.params.id);

    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ITEM_ID',
      });
    }

    const requestedFacilityId: unknown = req.body?.facilityId;
    if (
      requestedFacilityId !== undefined &&
      (typeof requestedFacilityId !== 'number' ||
        !Number.isSafeInteger(requestedFacilityId) ||
        requestedFacilityId <= 0)
    ) {
      return res.status(400).json({ success: false, error: 'INVALID_FACILITY_ID' });
    }

    try {
      const result = await inventory.receiveBatchScoped(
        context,
        itemId,
        req.body ?? {},
        requestedFacilityId,
      );

      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (handleInventoryError(err, res)) return;

      console.error('Batch receive error:', err);
      return res.status(500).json({
        success: false,
        error: 'BATCH_RECEIVE_FAILED',
      });
    }
  },
);

/** A status lookup never turns NOT_FOUND into permission to use a new identity. */
router.post(
  '/api/inventory/receipt-status',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    const facilityId: unknown = req.body?.facilityId;
    if (
      facilityId !== undefined &&
      (typeof facilityId !== 'number' || !Number.isSafeInteger(facilityId) || facilityId <= 0)
    )
      return res.status(400).json({ success: false, error: 'INVALID_FACILITY_ID' });
    try {
      return res.json(
        await inventory.getReceiptRequestStatusScoped(context, {
          facilityId,
          idempotencyKey: req.body?.idempotencyKey,
        }),
      );
    } catch (err: unknown) {
      if (handleScopeError(err, res) || handleInventoryError(err, res)) return;
      console.error('Receipt status error:', err);
      return res.status(500).json({ success: false, error: 'RECEIPT_STATUS_FAILED' });
    }
  },
);

/** Close only the retry identity, never a recorded receipt or its stock. */
router.post(
  '/api/inventory/receipt-retry-cancellation',
  requirePermission('inventory.manage'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    const facilityId: unknown = req.body?.facilityId;
    if (
      facilityId !== undefined &&
      (typeof facilityId !== 'number' || !Number.isSafeInteger(facilityId) || facilityId <= 0)
    )
      return res.status(400).json({ success: false, error: 'INVALID_FACILITY_ID' });
    try {
      return res.json(
        await inventory.cancelReceiptRetryScoped(context, {
          facilityId,
          idempotencyKey: req.body?.idempotencyKey,
          reason: req.body?.reason,
        }),
      );
    } catch (err: unknown) {
      if (handleScopeError(err, res) || handleInventoryError(err, res)) return;
      console.error('Receipt retry cancellation error:', err);
      return res.status(500).json({ success: false, error: 'RECEIPT_CANCELLATION_FAILED' });
    }
  },
);

router.get('/api/inventory', requirePermission('inventory.read'), async (req: AuthRequest, res) => {
  try {
    const context = requireAuthContext(req, res);
    if (!context) return;
    const facilityId = resolveFacilityScope(
      context,
      req.query.facilityId !== undefined ? Number(req.query.facilityId) : undefined,
    );
    const facility = await queries.getFacilityByIdScoped(context, facilityId);
    if (!facility) return res.status(404).json({ error: 'FACILITY_NOT_FOUND' });
    const list = await queries.getInventoryItems(facility.id);
    return res.json(list);
  } catch (err: unknown) {
    if (handleScopeError(err, res)) return;
    respondInternalError(res, err, 'GET /api/inventory');
  }
});

router.post(
  '/api/inventory',
  requirePermission('inventory.manage'),
  validateBody(createInventoryItemBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const context = requireAuthContext(req, res);
      if (!context) return;
      const body = getValidatedBody<Parameters<typeof queries.createInventoryItem>[0]>(req);
      if (
        (parseMoneyToCents(body.sellingPrice) ?? 0) > 0 &&
        !hasAllPermissions(context, ['billing.update'])
      )
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Facility finance permission is required to set a selling price.',
        });
      const facilityId = resolveFacilityScope(context, body.facilityId);
      const facility = await queries.getFacilityByIdScoped(context, facilityId);
      if (!facility) return res.status(404).json({ error: 'FACILITY_NOT_FOUND' });
      const item = await queries.createInventoryItem(
        { ...body, facilityId: facility.id },
        { tenantId: facility.tenantId, facilityId: facility.id, userId: context.userId },
      );
      return res.status(201).json(item);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      respondInternalError(res, err, 'POST /api/inventory');
    }
  },
);

router.put(
  '/api/inventory/:id/selling-price',
  requirePermission('inventory.manage', 'billing.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
      return res.status(400).json({ error: 'INVALID_INPUT' });
    try {
      const result = await inventory.updateInventorySellingPriceScoped(
        context,
        Number(req.params.id),
        {
          facilityId: req.body.facilityId,
          sellingPrice: req.body.sellingPrice,
          expectedPriceRevision: req.body.expectedPriceRevision,
          reason: req.body.reason,
        },
      );
      return res.json(result);
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;
      if (handleInventoryError(error, res)) return;
      respondInternalError(res, error, 'PUT /api/inventory/:id/selling-price');
    }
  },
);

// The retry identity is in the request body, not the URL/access log.
router.post(
  '/api/pharmacy/dispense/status',
  requirePermission('pharmacy.dispense'),
  async (req: AuthRequest, res) => {
    try {
      const context = requireAuthContext(req, res);
      if (!context) return;
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'INVALID_DISPENSE_BODY' });
      }
      const status = await inventory.getDispenseRequestStatusScoped(context, {
        facilityId: req.body.facilityId,
        idempotencyKey: req.body.idempotencyKey,
      });
      return res.json(status);
    } catch (error: unknown) {
      if (handleInventoryError(error, res)) return;
      console.error('Dispensing status could not be checked.');
      return res.status(500).json({ error: 'DISPENSE_STATUS_FAILED' });
    }
  },
);

router.post(
  '/api/pharmacy/dispense',
  requirePermission('pharmacy.dispense'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DISPENSE_BODY',
        });
      }

      /*
       * Dispensing draws first-expiry-first-out inside a transaction
       * with the batch rows locked, so two tills cannot take the same
       * last strip and an expired lot is never handed to a patient.
       */
      // The operator identity is taken from the authenticated session, not
      // from a caller-supplied label.
      const result = await inventory.dispenseFefoScoped(req.authContext, {
        ...req.body,
        idempotencyKey: req.get('Idempotency-Key') ?? req.body.idempotencyKey,
        dispensedBy: req.user?.fullName || req.user?.username || String(req.authContext.userId),
      });

      const dispensation = result.dispensation;

      /* The committed dispensing contains the authoritative inventory price.
       * Billing must not accept a client price or infer a pharmacy tariff. */
      let charge: billing.ChargeResult | null = null;

      if (dispensation && dispensation.id && dispensation.patientId) {
        const drugName = result.billingContext.drugName;

        charge = await chargeSafely({
          tenantId: dispensation.tenantId ?? req.authContext.tenantId ?? 0,
          facilityId: dispensation.facilityId ?? req.authContext.facilityId ?? 0,
          patientId: dispensation.patientId,
          encounterId: result.billingContext.encounterId,
          codes: [],
          serviceKeys: [],
          family: 'PHARMACY',
          serviceName: drugName,
          quantity:
            typeof dispensation.quantityDispensed === 'number' ? dispensation.quantityDispensed : 1,
          sourceType: 'PHARMACY',
          sourceId: dispensation.id,
          itemType: 'Pharmacy',
          description: drugName,
          // Never accept a browser price or substitute a service tariff.
          // Missing dispensing-time inventory evidence remains unresolved.
          fallbackUnitPrice: null,
          fallbackDescription: drugName,
        });
      }

      // One patient can have multiple prescriptions. A single dispensing (or
      // an unlinked sale) is not evidence that the entire pharmacy visit ended.
      const queueWarning = 'Complete the pharmacy queue separately when the visit is finished.';

      res.status(201).json({
        ...result.dispensation,
        stockTracking: result.stockTracking,
        allocations: result.allocations,
        stockAfter: result.stockAfter,
        replayed: result.replayed,
        prescriptionComplete: result.prescriptionComplete,
        queueWarning,
        billing: charge,
      });
    } catch (err: unknown) {
      if (handleInventoryError(err, res)) return;

      console.error('Dispense failed; review server-side operational status.');
      res.status(500).json({ error: 'Dispensing could not be completed.' });
    }
  },
);

export default router;
