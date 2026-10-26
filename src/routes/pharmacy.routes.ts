/**
 * The pharmacy & inventory routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
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

router.get('/api/inventory', requirePermission('inventory.read'), async (req, res) => {
  try {
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

    const list = await queries.getInventoryItems(facilityId);

    res.json(list);
  } catch (err: any) {
    respondInternalError(res, err, 'GET /api/inventory');
  }
});

router.post('/api/inventory', requirePermission('inventory.manage'), async (req, res) => {
  try {
    const item = await queries.createInventoryItem(req.body);

    res.status(201).json(item);
  } catch (err: any) {
    respondInternalError(res, err, 'POST /api/inventory');
  }
});

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
      const result = await inventory.dispenseFefoScoped(req.authContext, req.body);

      const dispensation = result.dispensation;

      /*
       * Price the dispensation from the facility tariff.
       *
       * The previous implementation created the invoice in the browser
       * with a hardcoded KES 15 unit price, which meant pharmacy revenue
       * never reflected the facility's own rates. Tariffs now win; the
       * medication's own price is used only as a fallback.
       */
      let charge: billing.ChargeResult | null = null;

      if (dispensation && dispensation.id && dispensation.patientId) {
        const drugName = typeof req.body.drugName === 'string' ? req.body.drugName : 'Medication';

        charge = await chargeSafely({
          tenantId: dispensation.tenantId ?? req.authContext.tenantId ?? 0,
          facilityId: dispensation.facilityId ?? req.authContext.facilityId ?? 0,
          patientId: dispensation.patientId,
          encounterId: typeof req.body.encounterId === 'number' ? req.body.encounterId : null,
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
          fallbackUnitPrice:
            typeof req.body.unitPrice === 'string' || typeof req.body.unitPrice === 'number'
              ? req.body.unitPrice
              : null,
          fallbackDescription: drugName,
        });
      }

      /*
       * The patient has been served, so the token that sent them here
       * is done. A board that keeps showing them is a board nobody
       * trusts by the end of the day.
       */
      await queries
        .completeQueueTokensForPatient(req.authContext, result.dispensation.patientId, 'Pharmacy')
        .catch((error: unknown) => {
          console.error('Could not close the pharmacy queue token:', error);
        });

      res.status(201).json({
        ...result.dispensation,
        stockTracking: result.stockTracking,
        allocations: result.allocations,
        stockAfter: result.stockAfter,
        billing: charge,
      });
    } catch (err: unknown) {
      if (handleInventoryError(err, res)) return;

      const message = err instanceof Error ? err.message : 'Dispensing failed.';

      console.error('Dispense error:', err);
      res.status(500).json({
        error: message,
      });
    }
  },
);

export default router;
