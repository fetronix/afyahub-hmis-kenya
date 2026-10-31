/**
 * The laboratory routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { LaboratoryDomainError } from '../clinical/laboratory-contracts.ts';
import { labOrderChargeRequest } from '../billing/service-charges.ts';
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

function handleLaboratoryError(error: unknown, res: Response): boolean {
  if (handleScopeError(error, res)) return true;
  if (error instanceof LaboratoryDomainError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return true;
  }
  return false;
}

// =========================================================
// LABORATORY
// =========================================================

router.get(
  '/api/lab-tests',
  requirePermission('laboratory.read'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext) return res.status(401).json({ error: 'AUTHORIZATION_CONTEXT_MISSING' });
      const facilityId = resolveFacilityScope(
        req.authContext,
        req.query.facilityId !== undefined ? Number(req.query.facilityId) : undefined,
      );
      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);
      if (!facility) return res.status(404).json({ error: 'FACILITY_NOT_FOUND' });
      return res.json(await queries.getLabTests(facility.id));
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] GET /api/lab-tests failed.');
      return res.status(500).json({ error: 'The request could not be completed.' });
    }
  },
);

router.get(
  '/api/lab-orders',
  requirePermission('laboratory.read'),
  async (req: AuthRequest, res) => {
    try {
      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      const list = await queries.getLabOrders(req.authContext!, facilityId, patientId);

      res.json(list);
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] GET /api/lab-orders failed.');
      res.status(500).json({ error: 'The request could not be completed.' });
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

      // Ordering is not completion of the investigation.
      return res.status(201).json({ ...result, billing: [] });
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

      res.status(201).json({ ...order, billing: null });
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
      const { status, accessionNumber, sharedOrderId } = getValidatedBody<{
        status: string;
        accessionNumber?: string;
        sharedOrderId?: number;
      }>(req);

      const order = await queries.updateLabOrderStatus(
        req.authContext!,
        Number(req.params.id),
        status,
        accessionNumber,
        sharedOrderId,
      );

      res.json(order);
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] PUT /api/lab-orders/:id/status failed.');
      res.status(500).json({ error: 'The request could not be completed.' });
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
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] GET /api/lab-results failed.');
      res.status(500).json({ error: 'The request could not be completed.' });
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
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] POST /api/lab-results failed.');
      res.status(500).json({ error: 'The request could not be completed.' });
    }
  },
);

// =========================================================
router.post(
  '/api/lab-orders/:id/complete',
  requirePermission('laboratory.results.verify'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) return res.status(401).json({ error: 'Authentication is required.' });
      const order = await queries.completeLabInvestigation(req.authContext, Number(req.params.id));
      const charge = await chargeSafely(labOrderChargeRequest(order));
      return res.json({ ...order, billing: charge });
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] Laboratory completion could not be recorded.');
      return res.status(500).json({
        error:
          'Investigation completion could not be confirmed. Review its status before retrying.',
      });
    }
  },
);

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
    } catch (err: unknown) {
      if (handleLaboratoryError(err, res)) return;
      console.error('[api] POST /api/lab-results/:id/verify failed.');
      res.status(500).json({ error: 'Could not verify laboratory result.' });
    }
  },
);

export default router;
