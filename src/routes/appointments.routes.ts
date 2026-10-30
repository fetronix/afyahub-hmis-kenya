/**
 * The appointments routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import { respondInternalError } from './shared/errors.ts';
import { createAppointmentBodySchema } from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';
import { Router } from 'express';

const router = Router();

// =========================================================
// APPOINTMENTS
// =========================================================

router.get('/api/appointments', requirePermission('appointments.read'), async (req, res) => {
  try {
    const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

    const list = await queries.getAppointments(facilityId);

    res.json(list);
  } catch (err: any) {
    respondInternalError(res, err, 'GET /api/appointments');
  }
});

router.post(
  '/api/appointments',
  requirePermission('appointments.create'),
  validateBody(createAppointmentBodySchema),
  async (req, res) => {
    try {
      const body = getValidatedBody<Parameters<typeof queries.createAppointment>[0]>(req);
      const appt = await queries.createAppointment(body);

      res.status(201).json(appt);
    } catch (err: any) {
      respondInternalError(res, err, 'POST /api/appointments');
    }
  },
);

export default router;
