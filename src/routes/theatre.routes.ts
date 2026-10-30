/** Legacy Theatre routes: historical reads remain; unsafe direct writes are retired. */
import { Router, type Response } from 'express';
import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';
import {
  createTheatreCaseBodySchema,
  updateTheatreCaseBodySchema,
} from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

router.get(
  '/api/theatre-cases',
  // Legacy rows can contain full clinical notes and checklist JSON.
  requirePermission('theatre.read', 'clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const facility = await requireScopedFacility(req, res, req.query.facilityId);
    if (!facility) return;
    try {
      res.json(await queries.getTheatreCases(facility.id));
    } catch (error: unknown) {
      respondInternalError(res, error, 'GET /api/theatre-cases');
    }
  },
);

// The old free-text path had neither patient scope nor conflict protection.
// Keep validation and the URL, but refuse all writes instead of silently
// migrating legacy or signed records into an unaudited workflow.
router.post(
  '/api/theatre-cases',
  requirePermission('theatre.schedule.create'),
  validateBody(createTheatreCaseBodySchema),
  async (req: AuthRequest, res: Response) => {
    const body = getValidatedBody<Record<string, unknown>>(req);
    const facility = await requireScopedFacility(req, res, body.facilityId ?? req.query.facilityId);
    if (!facility) return;
    res.status(409).json({
      success: false,
      error: 'LEGACY_THEATRE_WRITE_DISABLED',
      message: 'Use the structured Theatre scheduling API.',
    });
  },
);

router.put(
  '/api/theatre-cases/:id',
  requirePermission('theatre.schedule.manage'),
  validateBody(updateTheatreCaseBodySchema),
  async (req: AuthRequest, res: Response) => {
    const body = getValidatedBody<Record<string, unknown>>(req);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ success: false, error: 'INVALID_THEATRE_CASE_ID' });
      return;
    }
    const facility = await requireScopedFacility(req, res, req.query.facilityId ?? body.facilityId);
    if (!facility) return;
    try {
      if (!(await queries.getTheatreCaseScoped(id, facility.id))) {
        res.status(404).json({
          success: false,
          error: 'THEATRE_CASE_NOT_FOUND',
          message: 'The theatre case was not found in this facility.',
        });
        return;
      }
      res.status(409).json({
        success: false,
        error: 'LEGACY_THEATRE_WRITE_DISABLED',
        message:
          'Direct status and checklist updates are unavailable; use the structured scheduling API.',
      });
    } catch (error: unknown) {
      respondInternalError(res, error, 'PUT /api/theatre-cases/:id');
    }
  },
);

export default router;
