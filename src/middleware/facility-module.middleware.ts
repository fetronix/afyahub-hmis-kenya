import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';
import * as queries from '../db/queries.ts';

export type FacilityModuleId =
  | 'registration'
  | 'reception'
  | 'opd'
  | 'inpatient'
  | 'maternity'
  | 'theatre'
  | 'specialty'
  | 'laboratory'
  | 'radiology'
  | 'pharmacy'
  | 'inventory'
  | 'procurement'
  | 'finance'
  | 'insurance'
  | 'public_health'
  | 'analytics'
  | 'interoperability'
  | 'configuration'
  | 'patient_portal'
  | 'audit';

export function requireFacilityModule(moduleId: FacilityModuleId) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const context = req.authContext;

    if (!context) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return;
    }

    const queryFacilityId = req.query.facilityId;
    const bodyFacilityId = req.body?.facilityId;

    const parseFacilityId = (value: unknown): number | undefined | null => {
      if (value === undefined || value === null || value === '') {
        return undefined;
      }

      if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
      }

      const parsed = Number(value);

      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    };

    const queryId = parseFacilityId(queryFacilityId);
    const bodyId = parseFacilityId(bodyFacilityId);

    if (queryId === null || bodyId === null) {
      res.status(400).json({
        success: false,
        error: 'INVALID_FACILITY_ID',
        message: 'facilityId must be a positive integer.',
      });
      return;
    }

    if (queryId !== undefined && bodyId !== undefined && queryId !== bodyId) {
      res.status(403).json({
        success: false,
        error: 'FACILITY_SCOPE_MISMATCH',
        message: 'The requested facility identifiers do not match.',
      });
      return;
    }

    const requestedFacilityId = bodyId ?? queryId;

    // Global superadmins may view platform-wide audit logs without
    // selecting a facility. Facility-specific requests remain gated.
    if (moduleId === 'audit' && context.isSuperAdmin && requestedFacilityId === undefined) {
      next();
      return;
    }

    try {
      const facilityId = resolveFacilityScope(context, requestedFacilityId);

      const facility = await queries.getFacilityByIdScoped(context, facilityId);

      if (!facility) {
        res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'The requested facility was not found.',
        });
        return;
      }

      const enabledModules = Array.isArray(facility.enabledModules) ? facility.enabledModules : [];

      // "claims" is the frontend name; the saved module is "insurance".
      const normalizedModuleId = moduleId === 'insurance' ? 'insurance' : moduleId;

      if (!enabledModules.includes(normalizedModuleId)) {
        res.status(403).json({
          success: false,
          error: 'FACILITY_MODULE_DISABLED',
          module: normalizedModuleId,
          message: `The ${normalizedModuleId} module is disabled for this facility.`,
        });
        return;
      }

      next();
    } catch (error: unknown) {
      if (error instanceof ScopeAccessError) {
        res.status(403).json({
          success: false,
          error: error.code,
          message: error.message,
        });
        return;
      }

      next(error);
    }
  };
}
