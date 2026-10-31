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
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { chargeSafely } from './shared/charges.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';
import { and, eq, isNull, or } from 'drizzle-orm';
import { LaboratoryDomainError } from '../clinical/laboratory-contracts.ts';
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

      if (!facility || !req.authContext) return;
      const patient = await queries.requirePatientInTenant(
        req.authContext,
        Number(body.patientId),
        facility.tenantId,
      );
      if (!patient) return res.status(404).json({ error: 'PATIENT_NOT_FOUND' });
      if (body.encounterId != null) {
        const [encounter] = await db
          .select({ id: schema.encounters.id })
          .from(schema.encounters)
          .where(
            and(
              eq(schema.encounters.id, Number(body.encounterId)),
              eq(schema.encounters.patientId, patient.id),
              eq(schema.encounters.facilityId, facility.id),
              eq(schema.encounters.tenantId, facility.tenantId),
            ),
          )
          .limit(1);
        if (!encounter)
          return res.status(400).json({
            error: 'PATIENT_ENCOUNTER_MISMATCH',
            message: 'The encounter must belong to this patient and facility.',
          });
      }

      let examinationName = body.procedureName;
      if (body.masterServiceId != null) {
        const [exam] = await db
          .select({ id: schema.masterServices.id, description: schema.masterServices.description })
          .from(schema.masterServices)
          .innerJoin(
            schema.facilityServiceTariffs,
            and(
              eq(schema.facilityServiceTariffs.masterServiceId, schema.masterServices.id),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .where(
            and(
              eq(schema.masterServices.id, Number(body.masterServiceId)),
              eq(schema.masterServices.billingFamily, 'RADIOLOGY'),
              eq(schema.masterServices.isActive, true),
              or(
                isNull(schema.masterServices.tenantId),
                eq(schema.masterServices.tenantId, facility.tenantId),
              ),
              or(
                isNull(schema.masterServices.originFacilityId),
                eq(schema.masterServices.originFacilityId, facility.id),
              ),
            ),
          )
          .limit(1);
        if (!exam)
          return res.status(400).json({
            error: 'EXAMINATION_NOT_AVAILABLE',
            message: 'The examination is not available in this facility catalogue.',
          });
        examinationName = exam.description;
      }
      const { idempotencyKey, ...orderBody } = body;
      const payload = {
        ...orderBody,
        procedureName: examinationName,
        facilityId: facility.id,
        tenantId: facility.tenantId,
      } as Parameters<typeof queries.createRadiologyOrder>[0];

      const result =
        typeof idempotencyKey === 'string'
          ? await queries.createRadiologyOrderIdempotent(
              payload,
              idempotencyKey,
              req.authContext.userId,
            )
          : { order: await queries.createRadiologyOrder(payload), idempotentReplay: false };

      // Requesting a study does not establish that it was performed.
      res
        .status(result.idempotentReplay ? 200 : 201)
        .json({ ...result.order, idempotentReplay: result.idempotentReplay, billing: null });
    } catch (err: any) {
      if (err instanceof LaboratoryDomainError)
        return res.status(err.status).json({ error: err.code, message: err.message });
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

      const order = await queries.updateRadiologyReport(
        orderId,
        findings,
        impression,
        reportedBy,
        req.authContext!.userId,
      );
      const charge = order ? await chargeSafely(radiologyChargeRequest(order)) : null;
      res.json({ ...order, billing: charge });
    } catch (err: any) {
      respondInternalError(res, err, 'PUT /api/radiology-orders/:id/report');
    }
  },
);

export default router;
