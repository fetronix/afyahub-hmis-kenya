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

      const encounter = await queries.createEncounterScoped(req.authContext, req.body);

      /*
       * Consultation fee.
       *
       * Inpatient encounters are billed through the admission and the
       * daily bed charges instead, so they do not raise a consultation.
       */
      let charge: billing.ChargeResult | null = null;

      if (encounter && encounter.encounterType !== 'INPATIENT') {
        charge = await chargeSafely({
          tenantId: encounter.tenantId,
          facilityId: encounter.facilityId,
          patientId: encounter.patientId,
          encounterId: encounter.id,
          codes: codesForFamily({
            family: 'CONSULTATION',
            encounterType: encounter.encounterType,
          }),
          /*
           * A facility that numbered its price list (OPD-001) links that
           * row to CONSULTATION on the tariff screen; without the link
           * the engine can only guess, and between a 150 consultation and
           * a 300 follow-up a guess is a wrong charge.
           */
          serviceKeys: billingServiceKeys('CONSULTATION', [encounter.encounterType]),
          /*
           * Naming the service lets the engine read the facility's own
           * description when neither a link nor a code matches. It only
           * accepts a tariff that says it is this service, inside the
           * OPD family of departments, and only when exactly one does —
           * OPD-001 (General outpatient consultation, 150) wins while
           * OPD-002 (Follow-up consultation, 300) does not match at all.
           */
          family: 'CONSULTATION',
          serviceName: null,
          encounterType: encounter.encounterType,
          sourceType: 'CONSULTATION',
          sourceId: encounter.id,
          itemType: 'Consultation',
          description: 'Clinical consultation',
        });
      }

      return res.status(201).json({
        ...encounter,
        billing: charge,
      });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      if (handleEncounterValidationError(err, res)) return;
      console.error('Encounter creation error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTER_CREATION_FAILED',
      });
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

      return res.json(encounter);
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
