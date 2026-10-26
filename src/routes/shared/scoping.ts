/**
 * Facility scoping for request handlers.
 *
 * Two functions that decide which facility a request may touch, moved out
 * of `createApp` so routes outside that function can use them.
 *
 * The client may name a facility in a query string or a body. It never
 * gets to pick one outside its own scope: `resolveFacilityScope` narrows
 * the request to a facility the caller is entitled to, and the row is then
 * re-read with a scoped query rather than trusted from the parse.
 */

import type { Response } from 'express';

import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { resolveFacilityScope } from '../../auth/scope.service.ts';
import * as queries from '../../db/queries.ts';
import { handleScopeError } from './errors.ts';

export const requireScopedFacility = async (
  req: AuthRequest,
  res: Response,
  rawFacilityId: unknown,
): Promise<{ id: number; tenantId: number } | null> => {
  const context = req.authContext;

  if (!context) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });

    return null;
  }

  const isEmpty = rawFacilityId === undefined || rawFacilityId === null || rawFacilityId === '';

  const parsed = isEmpty ? undefined : Number(rawFacilityId);

  if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed <= 0)) {
    res.status(400).json({
      success: false,
      error: 'INVALID_FACILITY_ID',
      message: 'facilityId must be a positive integer.',
    });

    return null;
  }

  try {
    const facilityId = resolveFacilityScope(context, parsed);

    const facility = await queries.getFacilityByIdScoped(context, facilityId);

    if (!facility) {
      res.status(404).json({
        success: false,
        error: 'FACILITY_NOT_FOUND',
        message: 'The requested facility was not found.',
      });

      return null;
    }

    return { id: facility.id, tenantId: facility.tenantId };
  } catch (error) {
    if (!handleScopeError(error, res)) {
      res.status(500).json({
        success: false,
        error: 'FACILITY_SCOPE_RESOLUTION_FAILED',
        message: 'The facility scope could not be resolved.',
      });
    }

    return null;
  }
};

export const requestedFacilityHint = (req: AuthRequest): number | undefined => {
  const raw = req.body?.facilityId ?? req.query.facilityId;

  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;

  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);

    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
};
