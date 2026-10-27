/**
 * Public health and MOH reporting.
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
import * as queries from '../../db/queries.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';

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

      let requestedFacilityId: number | undefined;

      if (input.facilityId !== undefined) {
        if (
          typeof input.facilityId !== 'number' ||
          !Number.isSafeInteger(input.facilityId) ||
          input.facilityId <= 0
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'facilityId must be a positive integer.',
          });
        }

        requestedFacilityId = input.facilityId;
      }

      if (
        typeof input.diseaseCode !== 'string' ||
        !input.diseaseCode.trim() ||
        input.diseaseCode.trim().length > 50 ||
        typeof input.diseaseName !== 'string' ||
        !input.diseaseName.trim() ||
        input.diseaseName.trim().length > 200 ||
        typeof input.epiWeek !== 'string' ||
        !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(input.epiWeek)
      ) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REPORT_FIELDS',
          message: 'Valid diseaseCode, diseaseName, and epiWeek are required.',
        });
      }

      const casesCount = input.casesCount === undefined ? 1 : input.casesCount;

      const mortalityCount = input.mortalityCount === undefined ? 0 : input.mortalityCount;

      const ageGroup = input.ageGroup === undefined ? 'Over 5 Years' : input.ageGroup;

      if (
        typeof casesCount !== 'number' ||
        !Number.isSafeInteger(casesCount) ||
        casesCount < 1 ||
        typeof mortalityCount !== 'number' ||
        !Number.isSafeInteger(mortalityCount) ||
        mortalityCount < 0 ||
        mortalityCount > casesCount ||
        typeof ageGroup !== 'string' ||
        !ageGroup.trim() ||
        ageGroup.trim().length > 100
      ) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_REPORT_COUNTS',
          message: 'Report counts and ageGroup are invalid.',
        });
      }

      const facilityId = resolveFacilityScope(req.authContext, requestedFacilityId);

      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

      if (!facility) {
        return res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'The requested facility was not found.',
        });
      }

      const report = await queries.recordPublicHealthReport({
        facilityId: facility.id,
        diseaseCode: input.diseaseCode.trim(),
        diseaseName: input.diseaseName.trim(),
        casesCount,
        mortalityCount,
        ageGroup: ageGroup.trim(),
        epiWeek: input.epiWeek,
        reportedBy: String(req.authContext.userId),
      });

      return res.status(201).json(report);
    } catch (err: unknown) {
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
