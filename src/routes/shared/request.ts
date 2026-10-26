/**
 * Request helpers shared by the API routers.
 *
 * These two were `const` arrow functions inside `createApp`, which meant
 * every route written in that file could use them and no route written
 * anywhere else could. Extracting the domains out of `app.ts` therefore
 * required moving them first — which is the order these things have to
 * happen in, and the reason `app.ts` stayed monolithic for as long as it
 * did: the helpers it defined were reachable only from inside it.
 *
 * Both are pure with respect to the database. Neither queries.
 */

import type { Response } from 'express';

import type { AuthRequest } from '../../auth/auth.middleware.ts';
import * as queries from '../../db/queries.ts';

/**
 * The request's authorization context, or a 401 response.
 *
 * Returning `null` rather than throwing keeps the handler shape readable:
 *
 *     const context = requireAuthContext(req, res);
 *     if (!context) return;
 *
 * `requireAuth` has already rejected unauthenticated requests by the time a
 * handler runs, so reaching the null branch means the middleware chain was
 * configured wrongly. The 401 is a last line of defence, not the usual
 * path, and it fails closed.
 */
export function requireAuthContext(req: AuthRequest, res: Response) {
  if (!req.authContext) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authentication is required.',
    });

    return null;
  }

  return req.authContext;
}

/**
 * Parse an optional positive integer query parameter.
 *
 * Absent, null and empty all mean "not supplied". Anything else must be a
 * positive integer with no sign, decimal point or leading zero, because
 * `Number('007')` and `Number('1e3')` both succeed and neither is a row id
 * anyone typed.
 *
 * Throws rather than responding, so a caller can decide how to map it — the
 * query string carries several of these and reporting the first bad one in
 * a single 400 is better than responding mid-parse.
 */
export function parseOptionalPositiveId(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new queries.InpatientDomainError('INVALID_INPUT', `A valid ${field} is required.`, 400);
  }

  return Number(raw);
}
