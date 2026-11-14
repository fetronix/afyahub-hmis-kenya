/**
 * Public health and MOH reporting.
 *
 * Existing paths, authorization and facility-module gates remain in place.
 * Report counts and age must be explicit: missing facts are not zero or a
 * default patient age group.
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
import * as queries from '../../db/queries.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';
import {
  SurveillanceError,
  correctReportScoped,
  recordReportScoped,
  validateEpiWeek,
  weeklySurveillanceSummaryScoped,
  type SurveillanceScope,
} from '../../public-health/surveillance.service.ts';
import { getFacilityByIdScoped } from '../../db/queries/tenancy.ts';

const router = Router();

// PUBLIC HEALTH & KHIS SURVEILLANCE
// =========================================================

router.get(
  '/api/public-health/reports',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const rawFacilityId = req.query.facilityId;

      if (
        rawFacilityId !== undefined &&
        (typeof rawFacilityId !== 'string' || !/^[1-9]\d*$/.test(rawFacilityId))
      ) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
          message: 'facilityId must be a positive integer.',
        });
      }

      const requestedFacilityId = rawFacilityId === undefined ? undefined : Number(rawFacilityId);

      const facilityId = resolveFacilityScope(req.authContext, requestedFacilityId);

      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

      if (!facility) {
        return res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'The requested facility was not found.',
        });
      }

      const reports = await queries.getPublicHealthReports(facility.id);

      return res.json(reports);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Failed to fetch public-health reports:', err);
      return res.status(500).json({
        success: false,
        error: 'PUBLIC_HEALTH_REPORTS_FETCH_FAILED',
        message: 'Failed to fetch public-health reports.',
      });
    }
  },
);

function failSurveillance(res: Response, error: unknown): boolean {
  if (error instanceof SurveillanceError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return true;
  }
  return false;
}

/** Resolve the facility from the caller's scope, never from a caller-supplied id alone. */
async function resolveSurveillanceScope(
  req: AuthRequest,
  rawFacilityId: unknown,
): Promise<SurveillanceScope> {
  if (!req.authContext) {
    throw new SurveillanceError(
      'AUTHORIZATION_CONTEXT_MISSING',
      'Authorization context is required.',
      401,
    );
  }
  let requested: number | undefined;
  if (rawFacilityId !== undefined && rawFacilityId !== null && rawFacilityId !== '') {
    const numeric =
      typeof rawFacilityId === 'string' && /^[1-9]\d*$/.test(rawFacilityId)
        ? Number(rawFacilityId)
        : typeof rawFacilityId === 'number' && Number.isSafeInteger(rawFacilityId)
          ? rawFacilityId
          : NaN;
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new SurveillanceError('INVALID_FACILITY_ID', 'facilityId must be a positive integer.');
    }
    requested = numeric;
  }
  const facilityId = resolveFacilityScope(req.authContext, requested);
  const facility = await getFacilityByIdScoped(req.authContext, facilityId);
  if (!facility)
    throw new SurveillanceError('FACILITY_NOT_FOUND', 'The requested facility was not found.', 404);
  const permissions = new Set(req.authContext.permissions);
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorUserId: req.authContext.userId,
    canCorrect: Boolean(
      req.authContext.isSuperAdmin || permissions.has('public_health.reports.create'),
    ),
  };
}

router.get(
  '/api/public-health/reports/summary',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveSurveillanceScope(req, req.query.facilityId);
      const epiWeek = validateEpiWeek(req.query.epiWeek);
      const summary = await weeklySurveillanceSummaryScoped(scope, { epiWeek });
      return res.json({ success: true, ...summary });
    } catch (error) {
      if (failSurveillance(res, error)) return;
      if (handleScopeError(error, res)) return;
      console.error('Failed to summarise public-health reports:', error);
      return res.status(500).json({
        success: false,
        error: 'PUBLIC_HEALTH_SUMMARY_FAILED',
        message: 'Failed to summarise public-health reports.',
      });
    }
  },
);

router.post(
  '/api/public-health/reports/:id/correction',
  requirePermission('public_health.reports.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveSurveillanceScope(req, req.body?.facilityId);
      const reportId = Number(req.params.id);
      const correction = await correctReportScoped(
        scope,
        reportId,
        (req.body ?? {}) as Record<string, unknown>,
      );
      return res.status(201).json({ success: true, ...correction });
    } catch (error) {
      if (failSurveillance(res, error)) return;
      if (handleScopeError(error, res)) return;
      console.error('Failed to correct public-health report:', error);
      return res.status(500).json({
        success: false,
        error: 'PUBLIC_HEALTH_CORRECTION_FAILED',
        message: 'Failed to correct the public-health report.',
      });
    }
  },
);

router.post(
  '/api/public-health/reports',
  requirePermission('public_health.reports.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const body: unknown = req.body;

      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REPORT_BODY',
          message: 'A valid report object is required.',
        });
      }

      const input = body as Record<string, unknown>;
      const scope = await resolveSurveillanceScope(req, input.facilityId);
      const report = await recordReportScoped(scope, input);

      return res.status(201).json(report);
    } catch (err: unknown) {
      if (failSurveillance(res, err)) return;
      if (handleScopeError(err, res)) return;

      console.error('Failed to record public-health report:', err);
      return res.status(500).json({
        success: false,
        error: 'PUBLIC_HEALTH_REPORT_CREATE_FAILED',
        message: 'Failed to record the public-health report.',
      });
    }
  },
);

export default router;
