/**
 * The medications & prescriptions routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { checkMedicationAllergies } from '../clinical/allergy.service.ts';
import { MedicationWorkflowError } from '../clinical/medication-workflow-contracts.ts';
import * as queries from '../db/queries.ts';
import { handleScopeError, respondInternalError } from './shared/errors.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';
import {
  createMedicationBodySchema,
  medicationStatusBodySchema,
} from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// MEDICATIONS & PRESCRIPTIONS
// =========================================================

router.get(
  '/api/medications',
  requirePermission('pharmacy.read'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext) return res.status(401).json({ error: 'AUTHORIZATION_CONTEXT_MISSING' });
      const list = await queries.getMedicationsScoped(req.authContext, {
        encounterId:
          req.query.encounterId !== undefined ? Number(req.query.encounterId) : undefined,
        patientId: req.query.patientId !== undefined ? Number(req.query.patientId) : undefined,
        facilityId: req.query.facilityId !== undefined ? Number(req.query.facilityId) : undefined,
      });
      return res.json(list);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      respondInternalError(res, err, 'GET /api/medications');
    }
  },
);

router.post(
  '/api/medications',
  requirePermission('clinical.create'),
  validateBody(createMedicationBodySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const body = getValidatedBody<Record<string, unknown>>(req);

      /*
       * The allergy check runs before the prescription is written.
       *
       * It does not block care: a hard stop on a name match would
       * refuse a documented tolerance or a deliberate desensitisation,
       * and clinicians learn to click through hard stops. Instead the
       * prescriber is shown what the registry holds and must
       * acknowledge it explicitly. The acknowledgement goes into the
       * audit trail.
       */
      const patientId = Number(body.patientId);
      const drugName = typeof body.drugName === 'string' ? body.drugName.trim() : '';

      if (Number.isSafeInteger(patientId) && patientId > 0 && drugName !== '') {
        const check = await checkMedicationAllergies(req.authContext, patientId, [drugName]);

        if (check.warnings.length > 0) {
          const acknowledged = body.allergyAcknowledged === true;

          if (!acknowledged) {
            return res.status(409).json({
              success: false,
              error: 'ALLERGY_CONFLICT',
              message:
                'This patient has a recorded allergy that matches this medication. Confirm to prescribe anyway.',
              warnings: check.warnings,
              disclaimer: check.disclaimer,
              detail: {
                warnings: check.warnings,
                disclaimer: check.disclaimer,
              },
            });
          }

          await queries.logAuditEvent(
            req.authContext.tenantId,
            req.authContext.facilityId,
            String(req.authContext.userId),
            'PRESCRIBE',
            'Medication',
            null,
            `Allergy warning overridden for ${drugName}: ${check.warnings
              .map((warning) => warning.allergen)
              .join(', ')}`,
          );
        }
      }

      const { allergyAcknowledged: _acknowledged, ...payload } = body;

      const med = await queries.createMedicationScoped(
        req.authContext,
        payload as Parameters<typeof queries.createMedicationScoped>[1],
      );

      res.status(201).json(med);
    } catch (err: any) {
      if (handleScopeError(err, res)) return;

      respondInternalError(res, err, 'POST /api/medications');
    }
  },
);

router.put(
  '/api/medications/:id/status',
  requirePermission('clinical.update'),
  validateBody(medicationStatusBodySchema),
  async (req: AuthRequest, res) => {
    if (!req.authContext) return res.status(401).json({ error: 'AUTHORIZATION_CONTEXT_MISSING' });
    const { status, reason } = getValidatedBody<{ status: string; reason?: string }>(req);
    if (!['On Hold', 'Resume', 'Cancelled', 'Discontinued'].includes(status)) {
      return res.status(409).json({
        error: 'MEDICATION_STATUS_WORKFLOW_REQUIRED',
        message: 'Use the authorized dispensing or clinical workflow.',
      });
    }
    try {
      return res.json(
        await queries.updateMedicationStatusScoped(
          req.authContext,
          Number(req.params.id),
          status,
          reason ?? '',
        ),
      );
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;
      if (error instanceof MedicationWorkflowError)
        return res.status(error.status).json({ error: error.code, message: error.message });
      console.error('Medication status change failed.');
      return res.status(500).json({ error: 'Medication status could not be updated.' });
    }
  },
);

export default router;
