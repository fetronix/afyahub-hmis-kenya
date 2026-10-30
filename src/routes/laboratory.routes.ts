/**
 * The laboratory routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as billing from '../billing/billing.service.ts';
import { chargeLabOrderBatch } from '../billing/service-charges.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';
import { db } from '../db/index.ts';
import * as queries from '../db/queries.ts';
import { chargeSafely } from './shared/charges.ts';
import { handleScopeError, respondInternalError } from './shared/errors.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';
import {
  createLabOrderBatchBodySchema,
  createLabOrderBodySchema,
  createLabResultBodySchema,
  updateLabOrderStatusBodySchema,
  verifyLabResultBodySchema,
} from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// LABORATORY
// =========================================================

router.get('/api/lab-tests', requirePermission('laboratory.read'), async (req, res) => {
  try {
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

    const list = await queries.getLabTests(facilityId);

    res.json(list);
  } catch (err: any) {
    respondInternalError(res, err, 'GET /api/lab-tests');
  }
});

router.get(
  '/api/lab-orders',
  requirePermission('laboratory.read'),
  async (req: AuthRequest, res) => {
    try {
      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      const list = await queries.getLabOrders(req.authContext!, facilityId, patientId);

      res.json(list);
    } catch (err: any) {
      respondInternalError(res, err, 'GET /api/lab-orders');
    }
  },
);

router.post(
  '/api/lab-orders/batch',
  requirePermission('laboratory.orders.create'),
  validateBody(createLabOrderBatchBodySchema),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({ error: 'Authentication context is required.' });
    }

    try {
      const body = getValidatedBody<Parameters<typeof queries.createLabOrderBatch>[1]>(req);
      const result = await queries.createLabOrderBatch(req.authContext, body);

      /*
       * Every order in the batch is priced, not just the first.
       *
       * The screen orders investigations through this endpoint and
       * never through the single-order one, so this is the only place
       * a laboratory charge can be raised. Before this, a batch of
       * tests reached the laboratory queue and the patient's invoice
       * stayed empty.
       */
      const billed = await chargeLabOrderBatch(result.orders, db);

      return res.status(201).json({ ...result, billing: billed });
    } catch (err: any) {
      const message = err?.message || 'Failed to create laboratory batch.';
      const clientError = [
        'Select at least one laboratory test.',
        'Enter no more than 100 laboratory investigations.',
        'Each investigation name must be 200 characters or fewer.',
        'Invalid laboratory investigation name.',
        'Invalid laboratory investigations.',
        'Enter at least one laboratory investigation.',
        'One or more laboratory test IDs are invalid.',
        'Duplicate tests are not allowed in one submission.',
        'Invalid laboratory priority.',
        'Clinical indication is required.',
        'Specimen type is required.',
        'Clinical text exceeds the permitted length.',
        'Encounter not found.',
        'A selected test is unavailable at this facility.',
      ].includes(message);

      return res.status(clientError ? 400 : 500).json({ error: message });
    }
  },
);
router.post(
  '/api/lab-orders',
  requirePermission('laboratory.orders.create'),
  validateBody(createLabOrderBodySchema),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({ error: 'Authentication context is required.' });
    }

    try {
      const body = getValidatedBody<Parameters<typeof queries.createLabOrder>[1]>(req);
      const order = await queries.createLabOrder(req.authContext, body);

      const labOrder = order as {
        id?: number;
        tenantId?: number;
        facilityId?: number;
        patientId?: number;
        encounterId?: number | null;
        testId?: number | null;
        testName?: string;
        testCode?: string | null;
      } | null;

      const charge =
        labOrder && labOrder.id
          ? await chargeSafely({
              tenantId: labOrder.tenantId ?? req.authContext.tenantId ?? 0,
              facilityId: labOrder.facilityId ?? req.authContext.facilityId ?? 0,
              patientId: labOrder.patientId ?? 0,
              encounterId: labOrder.encounterId ?? null,
              /*
               * The catalogue code first (LAB-CBC), then the name-derived
               * codes, then the generic fallbacks — the same order the batch
               * route uses, because a single order must price the same way
               * a batch does.
               */
              codes: codesForFamily({
                family: 'LABORATORY',
                code: labOrder.testCode ?? null,
                name: labOrder.testName,
              }),
              serviceKeys: billingServiceKeys('LABORATORY', [
                labOrder.testCode ?? null,
                labOrder.testName,
              ]),
              family: 'LABORATORY',
              serviceName: labOrder.testName,
              aliases: labOrder.testCode ? [labOrder.testCode] : [],
              serviceRef: {
                type: 'LAB_TEST',
                id: typeof labOrder.testId === 'number' ? labOrder.testId : null,
                code: labOrder.testCode ?? null,
              },
              sourceType: 'LAB_ORDER',
              sourceId: labOrder.id,
              itemType: 'Laboratory',
              description: labOrder.testName,
            })
          : null;

      res.status(201).json({ ...order, billing: charge });
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/lab-orders');
    }
  },
);

router.put(
  '/api/lab-orders/:id/status',
  requirePermission('laboratory.results.enter'),
  validateBody(updateLabOrderStatusBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const { status, accessionNumber } = getValidatedBody<{
        status: string;
        accessionNumber?: string;
      }>(req);

      const order = await queries.updateLabOrderStatus(
        req.authContext!,
        Number(req.params.id),
        status,
        accessionNumber,
      );

      res.json(order);
    } catch (err: any) {
      respondInternalError(res, err, 'PUT /api/lab-orders/:id/status');
    }
  },
);

router.get(
  '/api/lab-results',
  requirePermission('laboratory.read'),
  async (req: AuthRequest, res) => {
    try {
      const orderId = req.query.orderId ? Number(req.query.orderId) : undefined;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      const list = await queries.getLabResults(
        req.authContext!,
        orderId,
        patientId,
        req.query.facilityId ? Number(req.query.facilityId) : undefined,
      );

      res.json(list);
    } catch (err: any) {
      respondInternalError(res, err, 'GET /api/lab-results');
    }
  },
);

router.post(
  '/api/lab-results',
  requirePermission('laboratory.results.enter'),
  validateBody(createLabResultBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const {
        orderId,
        patientId,
        parameterName,
        measuredValue,
        unit,
        referenceRange,
        flag,
        notes,
      } = getValidatedBody<{
        orderId: number;
        patientId: number;
        parameterName: string;
        measuredValue: string;
        unit?: string | null;
        referenceRange?: string | null;
        flag?: string | null;
        notes?: string | null;
      }>(req);

      const result = await queries.addLabResult(req.authContext!, {
        orderId: Number(orderId),
        patientId: Number(patientId),
        parameterName: parameterName.trim(),
        measuredValue: measuredValue.trim(),
        unit: typeof unit === 'string' ? unit.trim() || null : null,
        referenceRange: typeof referenceRange === 'string' ? referenceRange.trim() || null : null,
        flag: typeof flag === 'string' && flag.trim() ? flag.trim() : null,
        notes: typeof notes === 'string' ? notes.trim() || null : null,
      });

      res.status(201).json(result);
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/lab-results');
    }
  },
);

// =========================================================
router.post(
  '/api/lab-results/:id/verify',
  requirePermission('laboratory.results.verify'),
  validateBody(verifyLabResultBodySchema),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext || !req.user) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }

      const resultId = Number(req.params.id);
      if (!Number.isInteger(resultId) || resultId <= 0) {
        res.status(400).json({ error: 'A valid laboratory result ID is required.' });
        return;
      }

      const verifier = req.user.fullName || req.user.username || String(req.user.id);

      const result = await queries.verifyLabResult(req.authContext, resultId, verifier);

      res.json(result);
    } catch (err: any) {
      if (typeof handleScopeError === 'function' && handleScopeError(err, res)) {
        return;
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Could not verify laboratory result.',
      });
    }
  },
);

export default router;
