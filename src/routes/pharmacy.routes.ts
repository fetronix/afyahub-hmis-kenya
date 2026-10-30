/**
 * The pharmacy & inventory routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import * as billing from '../billing/billing.service.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';
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

    try {
      const result = await inventory.receiveBatchScoped(
        context,
        itemId,
        req.body ?? {},
        typeof req.body?.facilityId === 'number' ? req.body.facilityId : undefined,
      );

      return res.status(201).json(result);
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
      const facilityId = resolveFacilityScope(context, body.facilityId);
      const facility = await queries.getFacilityByIdScoped(context, facilityId);
      if (!facility) return res.status(404).json({ error: 'FACILITY_NOT_FOUND' });
      const item = await queries.createInventoryItem({ ...body, facilityId: facility.id });
      return res.status(201).json(item);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      respondInternalError(res, err, 'POST /api/inventory');
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

      /*
       * Price the dispensation from the facility tariff.
       *
       * The previous implementation created the invoice in the browser
       * with a hardcoded KES 15 unit price, which meant pharmacy revenue
       * never reflected the facility's own rates. Tariffs now win; the
       * client-provided price is never treated as an approved tariff.
       */
      let charge: billing.ChargeResult | null = null;

      if (dispensation && dispensation.id && dispensation.patientId) {
        const drugName = result.billingContext.drugName;

        charge = await chargeSafely({
          tenantId: dispensation.tenantId ?? req.authContext.tenantId ?? 0,
          facilityId: dispensation.facilityId ?? req.authContext.facilityId ?? 0,
          patientId: dispensation.patientId,
          encounterId: result.billingContext.encounterId,
          codes: codesForFamily({
            family: 'PHARMACY',
            name: drugName,
          }),
          serviceKeys: billingServiceKeys('PHARMACY', [drugName]),
          family: 'PHARMACY',
          serviceName: drugName,
          quantity:
            typeof dispensation.quantityDispensed === 'number' ? dispensation.quantityDispensed : 1,
          sourceType: 'PHARMACY',
          sourceId: dispensation.id,
          itemType: 'Pharmacy',
          description: drugName,
          // A browser-provided price is not an approved facility tariff.
          // Without a configured tariff this event remains explicitly unpriced.
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
