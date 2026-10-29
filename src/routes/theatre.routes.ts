/**
 * The theatre cases routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { createTheatreCaseBodySchema } from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// THEATRE CASES
// =========================================================

router.get(
  '/api/theatre-cases',
  requireAnyPermission('clinical.read', 'inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const facility = await requireScopedFacility(req, res, req.query.facilityId);

    if (!facility) return;

    try {
      const list = await queries.getTheatreCases(facility.id);

      res.json(list);
    } catch (err: any) {
      respondInternalError(res, err, 'GET /api/theatre-cases');
    }
  },
);

router.post(
  '/api/theatre-cases',
  requirePermission('clinical.create'),
  validateBody(createTheatreCaseBodySchema),
  async (req: AuthRequest, res: Response) => {
    const body = getValidatedBody<Record<string, unknown>>(req);

    const facility = await requireScopedFacility(req, res, body.facilityId ?? req.query.facilityId);

    if (!facility) return;

    try {
      /*
       * Required columns are enforced by the table, and the two
       * identifiers are taken from the resolved facility rather than
       * from the payload, so the record cannot be filed elsewhere.
       */
      const payload = {
        ...body,
        facilityId: facility.id,
        tenantId: facility.tenantId,
      } as Parameters<typeof queries.createTheatreCase>[0];

      const tc = await queries.createTheatreCase(payload);

      res.status(201).json(tc);
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/theatre-cases');
    }
  },
);

router.put(
  '/api/theatre-cases/:id',
  requirePermission('clinical.update'),
  async (req: AuthRequest, res: Response) => {
    const caseId = Number(req.params.id);

    if (!Number.isSafeInteger(caseId) || caseId <= 0) {
      res.status(400).json({
        success: false,
        error: 'INVALID_THEATRE_CASE_ID',
      });

      return;
    }

    const facility = await requireScopedFacility(
      req,
      res,
      req.query.facilityId ?? (req.body ?? {}).facilityId,
    );

    if (!facility) return;

    try {
      const existing = await queries.getTheatreCaseScoped(caseId, facility.id);

      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'THEATRE_CASE_NOT_FOUND',
          message: 'The theatre case was not found in this facility.',
        });

        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      const payload = {
        ...body,
        facilityId: facility.id,
        tenantId: facility.tenantId,
      } as Parameters<typeof queries.updateTheatreCase>[1];

      const tc = await queries.updateTheatreCase(caseId, payload);

      res.json(tc);
    } catch (err: any) {
      respondInternalError(res, err, 'PUT /api/theatre-cases/:id');
    }
  },
);

export default router;
