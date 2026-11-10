/**
 * The queues routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import { handleScopeError, respondInternalError } from './shared/errors.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { requireAuthContext } from './shared/request.ts';
import { Router, type Response } from 'express';
import {
  createQueueEntryBodySchema,
  updateQueueStatusBodySchema,
} from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// QUEUES
// =========================================================

router.get(
  '/api/queues',
  requirePermission('appointments.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) return res.status(401).json({ error: 'AUTHORIZATION_CONTEXT_MISSING' });
      const raw = req.query.facilityId;
      if (
        raw !== undefined &&
        (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      )
        return res.status(400).json({
          error: 'INVALID_FACILITY_ID',
          message: 'facilityId must be a positive integer.',
        });
      const facilityId = resolveFacilityScope(
        req.authContext,
        raw === undefined ? undefined : Number(raw),
      );
      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);
      if (!facility) return res.status(404).json({ error: 'FACILITY_NOT_FOUND' });
      const queueType = typeof req.query.queueType === 'string' ? req.query.queueType : undefined;
      const active = req.query.active;
      if (active !== undefined && active !== 'true' && active !== 'false')
        return res
          .status(400)
          .json({ error: 'INVALID_QUEUE_FILTER', message: 'active must be true or false.' });
      return res.json(await queries.getQueues(facility.id, queueType, active === 'true'));
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      return respondInternalError(res, err, 'GET /api/queues');
    }
  },
);

router.post(
  '/api/queues',
  requirePermission('appointments.create'),
  validateBody(createQueueEntryBodySchema),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({ error: 'Authentication context is required.' });
    }

    try {
      const body = getValidatedBody<Parameters<typeof queries.createQueueEntry>[1]>(req);
      const item = await queries.createQueueEntry(req.authContext, body);

      res.status(201).json(item);
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/queues');
    }
  },
);

router.put(
  '/api/queues/:id/status',
  requirePermission('appointments.update'),
  validateBody(updateQueueStatusBodySchema),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const { status } = getValidatedBody<{ status: string }>(req);

      const updated = await queries.updateQueueStatusScoped(
        context,
        Number(req.params.id),
        String(status ?? ''),
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'QUEUE_TOKEN_NOT_FOUND',
        });
      }

      res.json(updated);
    } catch (err: any) {
      const message = err?.message ?? 'Failed to update queue status.';
      const clientError =
        message === 'Invalid queue status.' || message === 'A valid queue token is required.';

      res.status(clientError ? 400 : 500).json({
        error: message,
      });
    }
  },
);

export default router;
