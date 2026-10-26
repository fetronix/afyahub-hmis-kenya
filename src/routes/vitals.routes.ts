/**
 * The vitals & observations routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as queries from '../db/queries.ts';
import * as nursing from '../nursing/nursing.service.ts';
import { handleInpatientError } from './shared/errors.ts';
import { requireAuthContext } from './shared/request.ts';
import { Router, type Response } from 'express';

const router = Router();

// =========================================================
// VITALS & OBSERVATIONS
// =========================================================

router.get(
  '/api/observations',
  requirePermission('clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const list = await nursing.getObservationsScoped(context, {
        patientId: req.query.patientId ? Number(req.query.patientId) : undefined,
        encounterId: req.query.encounterId ? Number(req.query.encounterId) : undefined,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Observation list error:', err);
      res.status(500).json({
        success: false,
        error: 'OBSERVATIONS_FETCH_FAILED',
      });
    }
  },
);

/**
 * Record ward or clinic vitals.
 *
 * Inpatient vitals are recorded against an admission, which guarantees
 * the patient is actually in a bed at this facility. A bare patient
 * payload is no longer accepted: observations carry no facility column,
 * so unscoped writes were a cross-tenant hole.
 */
router.post(
  '/api/observations',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const admissionId = Number(req.body?.admissionId);
      const encounterId = Number(req.body?.encounterId);

      const recordedBy =
        typeof req.body?.recordedBy === 'string'
          ? req.body.recordedBy
          : (req.user?.fullName ?? null);

      /*
       * Ward vitals attach to an admission; OPD/triage vitals attach to
       * an encounter. Both paths resolve the patient from a scoped
       * record, so a bare patientId can no longer be written to.
       */
      const observation =
        Number.isSafeInteger(admissionId) && admissionId > 0
          ? await nursing.recordVitalsScoped(context, {
              ...req.body,
              admissionId,
              recordedBy,
            })
          : Number.isSafeInteger(encounterId) && encounterId > 0
            ? await nursing.recordObservationForEncounterScoped(context, {
                ...req.body,
                encounterId,
                recordedBy,
              })
            : null;

      if (!observation) {
        return res.status(400).json({
          success: false,
          error: 'ADMISSION_OR_ENCOUNTER_REQUIRED',
          message: 'Record vitals against an admission or an encounter at this facility.',
        });
      }

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'CREATE',
        'Observation',
        String(observation.id ?? ''),
        Number.isSafeInteger(admissionId) && admissionId > 0
          ? `Vitals recorded for admission ${admissionId}`
          : `Vitals recorded for encounter ${encounterId}`,
      );

      res.status(201).json(observation);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Observation creation error:', err);
      res.status(500).json({
        success: false,
        error: 'OBSERVATION_CREATION_FAILED',
      });
    }
  },
);

export default router;
