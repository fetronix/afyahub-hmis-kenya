/**
 * JaliCare HMIS
 * Patient portal middleware
 *
 * One job: turn a bearer token into `req.portalSession`, or refuse.
 *
 * It reads `patient_portal_sessions`, not `sessions`. That separation is
 * the reason a patient token cannot reach a staff route: the staff
 * `requireAuth` validates against the staff table and will never find a
 * portal token there. Neither middleware is a wrapper around the other,
 * and there is no shared "user" object to confuse.
 */

import type { Request, Response, NextFunction } from 'express';

import { resolvePortalSession, type PortalSession } from './portal-auth.service.ts';

export interface PortalRequest extends Request {
  portalSession?: PortalSession;
}

function bearerOf(req: Request): string | null {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice(7).trim();

  return token === '' ? null : token;
}

export async function requirePortalAuth(
  req: PortalRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerOf(req);

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'PORTAL_SESSION_REQUIRED',
      message: 'Sign in to view your records.',
    });

    return;
  }

  try {
    const session = await resolvePortalSession(token);

    if (!session) {
      res.status(401).json({
        success: false,
        error: 'PORTAL_SESSION_INVALID',
        message: 'Your session has ended. Sign in again.',
      });

      return;
    }

    req.portalSession = session;

    /*
     * A patient session must never be cached by a shared proxy: the
     * response is one identifiable person's health record.
     */
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    next();
  } catch (error) {
    console.error('Portal session validation failed:', error);

    res.status(500).json({
      success: false,
      error: 'PORTAL_SESSION_CHECK_FAILED',
    });
  }
}
