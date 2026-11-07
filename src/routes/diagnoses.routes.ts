/**
 * The diagnoses & procedures routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this absolute-path router at the
 * app root after the authenticated `/api` router and its module gates.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as billing from '../billing/billing.service.ts';
import { Icd11Error } from '../clinical/icd11/icd11.service.ts';
import * as queries from '../db/queries.ts';
import { chargeSafely } from './shared/charges.ts';
import { handleInpatientError } from './shared/errors.ts';
import { parseOptionalPositiveId, requireAuthContext } from './shared/request.ts';
import { Router, type Response } from 'express';

const router = Router();

// =========================================================
// DIAGNOSES & PROCEDURES
// =========================================================

router.get(
  '/api/diagnoses',
  requirePermission('clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const encounterId = parseOptionalPositiveId(req.query.encounterId, 'encounterId');
      const patientId = parseOptionalPositiveId(req.query.patientId, 'patientId');

      /*
       * Scoped: no filter is refused rather than answered with every
       * diagnosis in the database.
       */
      const list = await queries.getDiagnosesScoped(context, {
        encounterId,
        patientId,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Diagnosis list error:', err);
      res.status(500).json({
        success: false,
        error: 'DIAGNOSIS_LIST_FAILED',
      });
    }
  },
);

router.post(
  '/api/diagnoses',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      /*
       * The encounter decides the patient, not the request body. A caller
       * cannot file a diagnosis against another facility's encounter.
       */
      const diag = await queries.recordDiagnosisScoped(context, req.body);

      res.status(201).json(diag);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      if (err instanceof Icd11Error) {
        res.status(err.status).json({ success: false, error: err.code, message: err.message });
        return;
      }

      // Do not log the request, diagnostic text or patient-identifying values.
      res.status(500).json({
        success: false,
        error: 'DIAGNOSIS_CREATE_FAILED',
      });
    }
  },
);

router.get(
  '/api/procedures',
  requirePermission('clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const encounterId = parseOptionalPositiveId(req.query.encounterId, 'encounterId');
      const patientId = parseOptionalPositiveId(req.query.patientId, 'patientId');

      const list = await queries.getProceduresScoped(context, {
        encounterId,
        patientId,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Procedure list error:', err);
      res.status(500).json({
        success: false,
        error: 'PROCEDURE_LIST_FAILED',
      });
    }
  },
);

router.post(
  '/api/procedures',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const { billingRequest, billingOutboxAttemptId, ...proc } =
        await queries.recordProcedureScoped(context, req.body);
      let charge: billing.ChargeResult | null = null;
      if (billingRequest) charge = await chargeSafely(billingRequest, billingOutboxAttemptId);

      res.status(201).json({ ...proc, billing: charge });
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Procedure creation error:', err);
      res.status(500).json({
        success: false,
        error: 'PROCEDURE_CREATE_FAILED',
      });
    }
  },
);

export default router;
