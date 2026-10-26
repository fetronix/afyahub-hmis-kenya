/**
 * Domain error handlers shared by the API routers.
 *
 * Each service throws its own error class carrying an intended HTTP status
 * and a stable error code. The handlers here are the single place those
 * become a response, and they all follow the same contract:
 *
 *   return `true`  — this was a known error and a response has been sent
 *   return `false` — not ours; the caller keeps its 500
 *
 * That boolean is what stops an unexpected failure from being reported as
 * whatever error happened to be checked first. A handler that guessed
 * would turn a database outage into a tidy 400.
 *
 * Nothing here logs. The caller decides, because the caller knows what
 * operation failed and so can write a useful line; these functions only
 * know an exception and a response.
 */

import type { Response } from 'express';

import { ScopeAccessError } from '../../auth/scope.service.ts';
import * as queries from '../../db/queries.ts';
import * as immunisation from '../../immunisation/immunisation.service.ts';
import * as maternity from '../../maternity/maternity.service.ts';

/**
 * Convert a scope failure into 400 or 403.
 *
 * A missing target facility is the caller's omission rather than a
 * refusal, so a superadmin who did not choose a facility gets 400 and the
 * client can prompt. A facility the caller is not entitled to is 403.
 */
export function handleScopeError(error: unknown, res: Response): boolean {
  if (error instanceof ScopeAccessError) {
    const status =
      error.code === 'FACILITY_REQUIRED' || error.code === 'INVALID_SCOPE_ID' ? 400 : 403;

    res.status(status).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}

/**
 * Maternity and MCH failures.
 *
 *   400 invalid input, with the field errors that caused it
 *   404 a record outside the caller's scope (indistinguishable from absent)
 *   409 a state conflict: already delivered, labour already open, a
 *       duplicate partograph reading
 */
export function handleMaternityError(error: unknown, res: Response): boolean {
  if (handleScopeError(error, res)) return true;

  if (error instanceof maternity.MaternityDomainError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
      ...(error.fields && error.fields.length > 0 ? { fields: error.fields } : {}),
    });

    return true;
  }

  return false;
}

/**
 * Immunisation failures.
 *
 * 400 an antigen outside the schedule, a future date, an impossible dose
 * number; 404 a patient outside the caller's scope; 409 a dose the database
 * has already seen.
 */
export function handleImmunisationError(error: unknown, res: Response): boolean {
  if (handleScopeError(error, res)) return true;

  if (error instanceof immunisation.ImmunisationDomainError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}

/**
 * Inpatient failures: wards, beds, admissions, transfers, discharge.
 *
 * `InpatientDomainError` carries its own status. 400 for bad input, 404 for
 * a record outside the caller's scope, 409 for a state conflict such as
 * discharging an admission that is already closed or admitting to a bed
 * that is occupied.
 */
export function handleInpatientError(error: unknown, res: Response): boolean {
  if (handleScopeError(error, res)) return true;

  if (error instanceof queries.InpatientDomainError) {
    res.status(error.status).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}
