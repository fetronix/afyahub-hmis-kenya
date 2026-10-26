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

/**
 * Report an unexpected failure without handing its text to the client.
 *
 * `error.message` is not a safe thing to return from a 500. The errors that
 * reach here are the ones nobody anticipated — most often a driver error,
 * and a PostgreSQL driver error is not a sentence about the user's request:
 *
 *     duplicate key value violates unique constraint "patients_mrn_key"
 *     DETAIL:  Key (mrn, tenant_id)=(MRN-000431, 7) already exists.
 *
 * That leaks the schema, the column names, and - in the DETAIL line - a
 * patient identifier and a tenant id. On a multi-tenant clinical system an
 * authenticated user of one facility can then learn that a record exists
 * for a patient at another. The same is true of a failed insert that echoes
 * a value back.
 *
 * So the message stays on the server: it is logged, with the stack, by
 * whoever knew what operation failed and can therefore name it. The client
 * gets a fixed string that says the operation failed and nothing else.
 *
 * This does not affect the domain errors handled elsewhere in this file.
 * Those are deliberate, written for a person, and carry no internal detail.
 */
export function respondInternalError(
  res: Response,
  error: unknown,
  operation: string,
  message = 'The request could not be completed.',
): void {
  /* The operation is named in the log rather than the response: whoever is
     on call needs to know which query failed, and the client does not.
     console.error rather than the structured logger because this module is
     imported by routes that do not load it, and an error path that throws
     while reporting an error is worse than an unstructured line. */
  console.error(`[api] ${operation} failed:`, error);

  res.status(500).json({ error: message });
}
