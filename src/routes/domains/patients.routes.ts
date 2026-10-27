/**
 * Patient records.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
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
import { logPatientAccess } from '../../clinical/access-log.service.ts';
import * as queries from '../../db/queries.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { resolveLocation } from '../../constants/kenya-locations.ts';

const router = Router();

// =========================================================
// PATIENT MANAGEMENT
// =========================================================

router.get(
  '/api/patients',
  requirePermission('patients.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const tenantId = req.query.tenantId !== undefined ? Number(req.query.tenantId) : undefined;

      const facilityId =
        req.query.facilityId !== undefined ? Number(req.query.facilityId) : undefined;

      if (
        (tenantId !== undefined && (!Number.isInteger(tenantId) || tenantId <= 0)) ||
        (facilityId !== undefined && (!Number.isInteger(facilityId) || facilityId <= 0))
      ) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SCOPE_ID',
          message: 'Invalid tenant or facility ID.',
        });
      }

      const list = await queries.getPatientsScoped(
        req.authContext,
        tenantId,
        facilityId,
        typeof req.query.search === 'string' ? req.query.search : undefined,
      );

      return res.json(list);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Patient list error:', err);
      return res.status(500).json({
        success: false,
        error: 'PATIENT_LIST_FAILED',
      });
    }
  },
);

router.get(
  '/api/patients/:id',
  requirePermission('patients.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const patientId = Number(req.params.id);

      if (!Number.isInteger(patientId) || patientId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PATIENT_ID',
        });
      }

      const patient = await queries.getPatientByIdScoped(req.authContext, patientId);

      if (!patient) {
        return res.status(404).json({
          success: false,
          error: 'PATIENT_NOT_FOUND',
          message: 'Patient not found.',
        });
      }

      /*
       * Every read of a patient record is accounted for. The insert
       * happens before the response is written: if the log cannot be
       * written the request fails, because an unaccountable read of
       * identifiable health data is the thing the DPA prohibits.
       */
      await logPatientAccess({
        context: req.authContext,
        patientId: patient.id,
        tenantId: patient.tenantId,
        facilityId: patient.registrationFacilityId,
        action: 'VIEW',
        purpose: 'DIRECT_CARE',
        recordType: 'Patient',
        request: {
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        },
      });

      return res.json(patient);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Patient retrieval error:', err);
      return res.status(500).json({
        success: false,
        error: 'PATIENT_RETRIEVAL_FAILED',
      });
    }
  },
);

router.post(
  '/api/patients',
  requirePermission('patients.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      /* The pair is checked before anything is written: a sub-county that
           is not in its county is a refusal, not a value to store. */
      const body = req.body ?? {};
      const location = resolveLocation(body.county, body.subCounty);

      if (!location.ok) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SUB_COUNTY',
          message: location.message,
        });
      }

      const patient = await queries.createPatientScoped(req.authContext, {
        ...body,
        county: location.county,
        subCounty: location.subCounty,
      });

      await queries.logAuditEvent(
        patient.tenantId,
        patient.registrationFacilityId,
        String(req.authContext.userId),
        'CREATE',
        'Patient',
        String(patient.id),
        'Patient registered',
      );

      return res.status(201).json(patient);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      if (err instanceof queries.PatientMrnConflictError) {
        return res.status(409).json({
          success: false,
          error: err.code,
          message: err.message,
        });
      }

      console.error('Patient creation error:', err);
      return res.status(500).json({
        success: false,
        error: 'PATIENT_CREATION_FAILED',
      });
    }
  },
);

router.put(
  '/api/patients/:id',
  requirePermission('patients.update'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const patientId = Number(req.params.id);

      if (!Number.isInteger(patientId) || patientId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PATIENT_ID',
        });
      }

      // A partial update may carry neither field, either one, or both. The
      // pair is only checkable together, so a sub-county on its own is
      // refused rather than stored against a county nobody looked at. A
      // county on its own clears the sub-county: the old one belonged to
      // the county that has just been replaced.
      const body = req.body ?? {};
      const touchesLocation = 'county' in body || 'subCounty' in body;

      let locationPatch: Partial<{ county: string | null; subCounty: string | null }> = {};

      if (touchesLocation) {
        const location = resolveLocation(body.county, body.subCounty);

        if (!location.ok) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SUB_COUNTY',
            message: location.message,
          });
        }

        locationPatch = { county: location.county, subCounty: location.subCounty };
      }

      const patient = await queries.updatePatientScoped(req.authContext, patientId, {
        ...body,
        ...locationPatch,
      });

      if (!patient) {
        return res.status(404).json({
          success: false,
          error: 'PATIENT_NOT_FOUND',
          message: 'Patient not found.',
        });
      }

      /*
       * This route previously wrote an access row marked
       * EXPORT / FHIR / "FHIR patient resource retrieval" — on a staff
       * edit. The row was wrong twice over: wrong action, wrong
       * channel, and it meant the real FHIR endpoint logged nothing.
       * It is now a correct UPDATE row, and the FHIR route logs its
       * own read.
       */
      await logPatientAccess({
        context: req.authContext,
        patientId: patient.id,
        tenantId: patient.tenantId,
        facilityId: patient.registrationFacilityId,
        action: 'UPDATE',
        purpose: 'DIRECT_CARE',
        recordType: 'Patient',
        request: {
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        },
      });

      await queries.logAuditEvent(
        patient.tenantId,
        patient.registrationFacilityId,
        String(req.authContext.userId),
        'UPDATE',
        'Patient',
        String(patient.id),
        'Patient record updated',
      );

      return res.json(patient);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Patient update error:', err);
      return res.status(500).json({
        success: false,
        error: 'PATIENT_UPDATE_FAILED',
      });
    }
  },
);

export default router;
