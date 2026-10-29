/**
 * The radiology routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import * as billing from '../billing/billing.service.ts';
import { radiologyChargeRequest } from '../billing/service-charges.ts';
import * as queries from '../db/queries.ts';
import { chargeSafely } from './shared/charges.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';
import {
  createRadiologyOrderBodySchema,
  radiologyReportBodySchema,
} from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// RADIOLOGY
// =========================================================

router.get(
  '/api/radiology-orders',
  requireAnyPermission('clinical.read', 'laboratory.read'),
  async (req: AuthRequest, res: Response) => {
    const facility = await requireScopedFacility(req, res, req.query.facilityId);

    if (!facility) return;

    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

    try {
      const list = await queries.getRadiologyOrders(facility.id, patientId);

      res.json(list);
    } catch (err: any) {
      respondInternalError(res, err, 'GET /api/radiology-orders');
    }
  },
);

router.post(
  '/api/radiology-orders',
  requirePermission('clinical.create'),
  validateBody(createRadiologyOrderBodySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const body = getValidatedBody<Record<string, unknown>>(req);

      const facility = await requireScopedFacility(
        req,
        res,
        body.facilityId ?? req.query.facilityId,
      );

      if (!facility) return;

      const payload = {
        ...body,
        facilityId: facility.id,
        tenantId: facility.tenantId,
      } as Parameters<typeof queries.createRadiologyOrder>[0];

      const order = await queries.createRadiologyOrder(payload);

      /*
       * The table has `procedure_name`, not `test_name`. Reading a field
       * that does not exist meant no RAD-<study> tariff could ever match:
       * a chest X-ray priced as RAD-CHEST-X-RAY was recorded and never
       * billed, while only a generic RADIOLOGY tariff would catch it.
       */
      const radiologyOrder = order as {
        id?: number;
        tenantId?: number;
        facilityId?: number;
        patientId?: number;
        encounterId?: number | null;
        procedureName?: string;
        modality?: string;
      } | null;

      let charge: billing.ChargeResult | null = null;

      if (radiologyOrder && radiologyOrder.id) {
        charge = await chargeSafely(radiologyChargeRequest(radiologyOrder as never));
      }

      res.status(201).json({ ...order, billing: charge });
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/radiology-orders');
    }
  },
);

router.put(
  '/api/radiology-orders/:id/report',
  requireAnyPermission('clinical.update', 'laboratory.results.enter'),
  validateBody(radiologyReportBodySchema),
  async (req: AuthRequest, res: Response) => {
    const body = getValidatedBody<{
      facilityId?: number | null;
      findings?: string;
      impression?: string;
      reportedBy: string;
    }>(req);
    const orderId = Number(req.params.id);

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      res.status(400).json({
        success: false,
        error: 'INVALID_RADIOLOGY_ORDER_ID',
      });

      return;
    }

    const facility = await requireScopedFacility(req, res, req.query.facilityId ?? body.facilityId);

    if (!facility) return;

    try {
      const existing = await queries.getRadiologyOrderScoped(orderId, facility.id);

      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'RADIOLOGY_ORDER_NOT_FOUND',
          message: 'The order was not found in this facility.',
        });

        return;
      }

      const { findings, impression, reportedBy } = body;

      const order = await queries.updateRadiologyReport(orderId, findings, impression, reportedBy);

      res.json(order);
    } catch (err: any) {
      respondInternalError(res, err, 'PUT /api/radiology-orders/:id/report');
    }
  },
);

export default router;
