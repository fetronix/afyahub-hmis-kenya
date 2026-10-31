import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import { moduleLogger } from '../logging/logger.ts';
import { validateRange } from './date-range.ts';
import {
  getDashboardOverview,
  resolveDashboardFacility,
  searchDashboard,
} from './dashboard.service.ts';

const router = Router();
const log = moduleLogger('dashboard');
const anyDashboardAccess = requireAnyPermission(
  'patients.read',
  'appointments.read',
  'clinical.read',
  'inpatient.read',
  'theatre.read',
  'laboratory.read',
  'pharmacy.read',
  'inventory.read',
  'billing.read',
  'reports.read',
  'audit.read',
);

function facilityId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function handleError(error: unknown, res: Response) {
  if (error instanceof ScopeAccessError) {
    return res.status(403).json({ error: error.code, message: error.message });
  }
  // No query, search term, SQL or patient data in the log or response.
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  log.error({ code }, 'dashboard.request_failed');
  return res
    .status(500)
    .json({ error: 'DASHBOARD_UNAVAILABLE', message: 'Dashboard data could not be loaded.' });
}

router.get('/overview', anyDashboardAccess, async (req: AuthRequest, res: Response) => {
  const context = req.authContext;
  if (!context)
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication is required.' });
  const id = facilityId(req.query.facilityId);
  const range = validateRange(req.query.start, req.query.end);
  if (!id || !range)
    return res.status(400).json({
      error: 'INVALID_DASHBOARD_RANGE',
      message: 'Select a valid facility and an inclusive date range of at most 366 days.',
    });
  try {
    const facility = await resolveDashboardFacility(context, id);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(await getDashboardOverview(context, facility, range));
  } catch (error) {
    return handleError(error, res);
  }
});

// POST keeps search terms out of URLs, reverse-proxy access logs and browser history.
router.post(
  '/search',
  requireAnyPermission('patients.read', 'billing.read', 'tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    const context = req.authContext;
    if (!context)
      return res
        .status(401)
        .json({ error: 'UNAUTHORIZED', message: 'Authentication is required.' });
    const id = facilityId(req.body?.facilityId);
    const term = typeof req.body?.term === 'string' ? req.body.term.trim() : '';
    if (
      !id ||
      term.length < 2 ||
      term.length > 80 ||
      [...term].some((character) => character.charCodeAt(0) < 32)
    ) {
      return res.status(400).json({
        error: 'INVALID_SEARCH',
        message: 'Enter a search of 2 to 80 characters and select a facility.',
      });
    }
    try {
      const facility = await resolveDashboardFacility(context, id);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(await searchDashboard(context, facility, term));
    } catch (error) {
      return handleError(error, res);
    }
  },
);

export default router;
