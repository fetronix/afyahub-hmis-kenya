/**
 * The queues routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireAuthContext } from './shared/request.ts';
import { Router, type Response } from 'express';

const router = Router();

// =========================================================
// QUEUES
// =========================================================

router.get('/api/queues', requirePermission('appointments.read'), async (req, res) => {
  try {
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

    const queueType = req.query.queueType as string;

    const list = await queries.getQueues(facilityId, queueType);

    res.json(list);
  } catch (err: any) {
    respondInternalError(res, err, 'GET /api/queues');
  }
});

router.post(
  '/api/queues',
  requirePermission('appointments.create'),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({ error: 'Authentication context is required.' });
    }

    try {
      const item = await queries.createQueueEntry(req.authContext, req.body);

      res.status(201).json(item);
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/queues');
    }
  },
);

router.put(
  '/api/queues/:id/status',
  requirePermission('appointments.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const { status } = req.body ?? {};

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
