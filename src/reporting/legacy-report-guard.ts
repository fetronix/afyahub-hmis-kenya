import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries/tenancy.ts';
import { handleScopeError } from '../routes/shared/errors.ts';

/** Legacy mixed-domain analytics must not bypass the relevant facility modules. */
export function requireReportSourceModules(...modules: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const context = req.authContext;
    if (!context) {
      res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
      return;
    }
    if (context.isSuperAdmin || context.roles.includes('SUPER_ADMIN')) {
      res.status(403).json({
        success: false,
        error: 'FACILITY_ACCOUNT_REQUIRED',
        message: 'A facility account is required.',
      });
      return;
    }
    try {
      const raw = req.query.facilityId;
      const requested = raw === undefined ? undefined : Number(raw);
      const facilityId = resolveFacilityScope(context, requested);
      const facility = await getFacilityByIdScoped(context, facilityId);
      if (!facility) {
        res.status(404).json({ success: false, error: 'FACILITY_NOT_FOUND' });
        return;
      }
      const enabled = Array.isArray(facility.enabledModules) ? facility.enabledModules : [];
      const hidden = Array.isArray(facility.hiddenModules) ? facility.hiddenModules : [];
      if (
        ![...modules, 'analytics'].every(
          (module) => enabled.includes(module) && !hidden.includes(module),
        )
      ) {
        res.status(403).json({
          success: false,
          error: 'FACILITY_MODULE_DISABLED',
          message: 'A report source module is unavailable for this facility.',
        });
        return;
      }
      next();
    } catch (error) {
      if (!handleScopeError(error, res)) next(error);
    }
  };
}
