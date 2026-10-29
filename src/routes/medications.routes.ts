/**
 * The medications & prescriptions routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { checkMedicationAllergies } from '../clinical/allergy.service.ts';
import * as queries from '../db/queries.ts';
import { handleScopeError, respondInternalError } from './shared/errors.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { medicationStatusBodySchema } from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// MEDICATIONS & PRESCRIPTIONS
// =========================================================

router.get('/api/medications', requirePermission('pharmacy.read'), async (req, res) => {
  try {
    const encounterId = req.query.encounterId ? Number(req.query.encounterId) : undefined;

    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

    const list = await queries.getMedications(encounterId, patientId);

    res.json(list);
  } catch (err: any) {
    respondInternalError(res, err, 'GET /api/medications');
  }
});

router.post(
  '/api/medications',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

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

      const med = await queries.createMedication(
        payload as Parameters<typeof queries.createMedication>[0],
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
  requirePermission('pharmacy.dispense'),
  validateBody(medicationStatusBodySchema),
  async (req, res) => {
    try {
      const { status } = getValidatedBody<{ status: string }>(req);

      const med = await queries.updateMedicationStatus(Number(req.params.id), status);

      res.json(med);
    } catch (err: any) {
      respondInternalError(res, err, 'PUT /api/medications/:id/status');
    }
  },
);

export default router;
