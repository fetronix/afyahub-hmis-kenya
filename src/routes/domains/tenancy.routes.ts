/**
 * Tenants, facilities and departments.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
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
import {
  facilitiesListQuerySchema,
  facilityIdParamSchema,
  tenantIdParamSchema,
} from '../../validation/schemas/index.ts';
import { validateParams, validateQuery } from '../../validation/validate.ts';

const router = Router();

// TENANTS & FACILITIES
// =========================================================

router.get('/api/tenants', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.authContext) {
      return res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
    }

    const list = await queries.getTenantsScoped(req.authContext);

    res.json(list);
  } catch (err: any) {
    if (handleScopeError(err, res)) {
      return;
    }

    respondInternalError(res, err, 'GET /api/tenants', 'Failed to fetch tenants');
  }
});

router.get(
  '/api/tenants/:id',
  validateParams(tenantIdParamSchema, { code: 'INVALID_TENANT_ID' }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const tenantId = Number(req.params.id);

      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TENANT_ID',
          message: 'Invalid tenant ID.',
        });
      }

      const tenant = await queries.getTenantByIdScoped(req.authContext, tenantId);

      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      res.json(tenant);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      respondInternalError(res, err, 'GET /api/tenants/:id', 'Failed to fetch tenant');
    }
  },
);

router.get(
  '/api/facilities',
  validateQuery(facilitiesListQuerySchema, { code: 'INVALID_TENANT_ID' }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const tenantId = req.query.tenantId !== undefined ? Number(req.query.tenantId) : undefined;

      if (tenantId !== undefined && (!Number.isInteger(tenantId) || tenantId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TENANT_ID',
          message: 'Invalid tenant ID.',
        });
      }

      const list = await queries.getFacilitiesScoped(req.authContext, tenantId);

      res.json(list);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      respondInternalError(res, err, 'GET /api/facilities', 'Failed to fetch facilities');
    }
  },
);

router.get(
  '/api/facilities/:id',
  validateParams(facilityIdParamSchema, { code: 'INVALID_FACILITY_ID' }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const facilityId = Number(req.params.id);

      if (!Number.isInteger(facilityId) || facilityId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
          message: 'Invalid facility ID.',
        });
      }

      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

      if (!facility) {
        return res.status(404).json({
          error: 'Facility not found',
        });
      }

      res.json(facility);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      respondInternalError(res, err, 'GET /api/facilities/:id', 'Failed to fetch facility');
    }
  },
);

router.get(
  '/api/departments',
  requirePermission('patients.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      if (facilityId !== undefined && (!Number.isInteger(facilityId) || facilityId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
        });
      }

      const list = await queries.getDepartmentsScoped(req.authContext, facilityId);

      return res.json(list);
    } catch (err: any) {
      if (handleScopeError(err, res)) return;

      respondInternalError(res, err, 'GET /api/departments');
    }
  },
);

export default router;
