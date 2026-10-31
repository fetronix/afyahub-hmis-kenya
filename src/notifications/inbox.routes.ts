import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import { moduleLogger } from '../logging/logger.ts';
import { inboxRequest, InboxError } from './inbox.service.ts';
import type { NotificationSeverity } from './inbox.types.ts';

const router = Router();
const log = moduleLogger('notification-inbox');
const access = requireAnyPermission(
  'inventory.read',
  'laboratory.read',
  'patients.read',
  'appointments.read',
  'inpatient.read',
  'theatre.read',
  'billing.read',
);
function id(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)))
    return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
function errorResponse(error: unknown, res: Response) {
  if (error instanceof ScopeAccessError)
    return res.status(403).json({ error: error.code, message: error.message });
  if (error instanceof InboxError)
    return res.status(error.status).json({ error: error.code, message: error.message });
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  log.error({ code }, 'inbox.request_failed');
  return res.status(500).json({
    error: 'INBOX_UNAVAILABLE',
    message: 'Notifications could not be loaded. Retry or contact support.',
  });
}
router.get('/', access, async (req: AuthRequest, res: Response) => {
  if (!req.authContext) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const facilityId = id(req.query.facilityId);
  const rawOffset = req.query.offset ?? '0';
  const rawLimit = req.query.limit ?? '50';
  const severity = req.query.severity;
  if (
    !facilityId ||
    typeof rawOffset !== 'string' ||
    !/^\d+$/.test(rawOffset) ||
    Number(rawOffset) > 1_000_000 ||
    typeof rawLimit !== 'string' ||
    !/^[1-9]\d*$/.test(rawLimit) ||
    Number(rawLimit) > 100 ||
    (severity !== undefined &&
      !['CRITICAL', 'WARNING', 'INFO', 'SUCCESS'].includes(String(severity)))
  ) {
    return res.status(400).json({
      error: 'INVALID_INBOX_QUERY',
      message: 'Provide a valid facility, filter and page.',
    });
  }
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(
      await inboxRequest(req.authContext, facilityId, {
        offset: Number(rawOffset),
        limit: Number(rawLimit),
        severity: severity as NotificationSeverity | undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error, res);
  }
});
router.post('/read', access, async (req: AuthRequest, res: Response) => {
  if (!req.authContext) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const facilityId = id(req.body?.facilityId),
    key = req.body?.key;
  if (
    !facilityId ||
    typeof key !== 'string' ||
    !/^(alert:\d+:\d+|event:[a-z-]+:\d+)$/.test(key) ||
    key.length > 200
  )
    return res.status(400).json({
      error: 'INVALID_NOTIFICATION',
      message: 'Provide a valid notification and facility.',
    });
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(await inboxRequest(req.authContext, facilityId, { mark: key }));
  } catch (error) {
    return errorResponse(error, res);
  }
});
router.post('/read-all', access, async (req: AuthRequest, res: Response) => {
  if (!req.authContext) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const facilityId = id(req.body?.facilityId);
  if (!facilityId)
    return res.status(400).json({ error: 'INVALID_FACILITY', message: 'Select a valid facility.' });
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(await inboxRequest(req.authContext, facilityId, { mark: 'all' }));
  } catch (error) {
    return errorResponse(error, res);
  }
});
export default router;
