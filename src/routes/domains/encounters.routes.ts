/**
 * Encounters.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import * as billing from '../../billing/billing.service.ts';
import { consultationChargeRequest } from '../../billing/service-charges.ts';
import { billingServiceKeys, isValidBillingKey } from '../../billing/tariff-codes.ts';
import { chargeSafely } from '../../routes/shared/charges.ts';
import { codesForFamily } from '../../billing/tariff-matching.ts';
import {
  handleClaimError,
  handleDhaError,
  handleEncounterValidationError,
  handleInpatientError,
  handleInventoryError,
  handlePaymentError,
  handleScopeError,
  respondInternalError,
} from '../../routes/shared/errors.ts';
import * as queries from '../../db/queries.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';

const router = Router();

// =========================================================
// CLINICAL ENCOUNTERS
// =========================================================

router.get(
  '/api/encounters',
  requirePermission('clinical.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const patientId = req.query.patientId === undefined ? undefined : Number(req.query.patientId);
      const facilityId =
        req.query.facilityId === undefined ? undefined : Number(req.query.facilityId);

      if (patientId !== undefined && (!Number.isSafeInteger(patientId) || patientId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PATIENT_ID',
        });
      }

      if (facilityId !== undefined && (!Number.isSafeInteger(facilityId) || facilityId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
        });
      }

      const list = await queries.getEncountersScoped(req.authContext, patientId, facilityId);

      return res.json(list);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (handleEncounterValidationError(err, res)) return;
      console.error('Encounter list error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTERS_LIST_FAILED',
      });
    }
  },
);

router.post(
  '/api/encounters',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ENCOUNTER_BODY',
        });
      }

      if (
        typeof req.body?.status === 'string' &&
        req.body.status.trim().toUpperCase() === 'COMPLETED'
      )
        return res.status(400).json({
          error: 'COMPLETE_ENCOUNTER_EXPLICITLY',
          message: 'Start the encounter, then explicitly record completion.',
        });
      const encounter = await queries.createEncounterScoped(req.authContext, req.body);

      // A started encounter is not proof that a consultation was performed.
      return res
        .status(encounter.idempotentReplay ? 200 : 201)
        .json({ ...encounter, billing: null });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (err instanceof queries.ConsultationSelectionError)
        return res.status(err.status).json({ error: err.code, message: err.message });
      if (handleEncounterValidationError(err, res)) return;
      console.error('Encounter creation error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTER_CREATION_FAILED',
      });
    }
  },
);

router.post(
  '/api/encounters/:id/consultation-selection',
  requirePermission('clinical.update'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) return res.status(401).json({ error: 'AUTHORIZATION_CONTEXT_MISSING' });
      const encounter = await queries.selectEncounterConsultation(
        req.authContext,
        Number(req.params.id),
        req.body?.masterServiceId,
        req.body?.reviewReason,
      );
      const charge =
        encounter.status.trim().toUpperCase() === 'COMPLETED'
          ? await chargeSafely(consultationChargeRequest(encounter))
          : null;
      return res.json({ ...encounter, billing: charge });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (err instanceof queries.ConsultationSelectionError)
        return res.status(err.status).json({ error: err.code, message: err.message });
      console.error('Consultation selection failed.');
      return res.status(500).json({ error: 'CONSULTATION_SELECTION_FAILED' });
    }
  },
);

router.put(
  '/api/encounters/:id',
  requirePermission('clinical.update'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const encounterId = Number(req.params.id);

      if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ENCOUNTER_ID',
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ENCOUNTER_BODY',
        });
      }

      const encounter = await queries.updateEncounterScoped(req.authContext, encounterId, req.body);

      if (!encounter) {
        return res.status(404).json({
          success: false,
          error: 'ENCOUNTER_NOT_FOUND',
        });
      }

      let charge: billing.ChargeResult | null = null;
      if (
        typeof req.body.status === 'string' &&
        req.body.status.trim().toUpperCase() === 'COMPLETED' &&
        encounter.encounterType.trim().toUpperCase() !== 'INPATIENT'
      ) {
        charge = await chargeSafely(consultationChargeRequest(encounter));
      }
      return res.json({ ...encounter, billing: charge });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (handleEncounterValidationError(err, res)) return;
      console.error('Encounter update error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTER_UPDATE_FAILED',
      });
    }
  },
);

export default router;
