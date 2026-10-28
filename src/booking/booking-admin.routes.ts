import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';
import * as queries from '../db/queries.ts';
import {
  BookingError,
  confirmBookingScoped,
  createBookingClientScoped,
  createBookingSlotScoped,
  getBookingAdminWorkspace,
  revokeBookingClientScoped,
  sendBookingReminderScoped,
  type BookingAdminScope,
} from './website-booking.service.ts';

const router = Router();
async function scoped(req: AuthRequest): Promise<BookingAdminScope> {
  if (!req.authContext) throw new ScopeAccessError('Authorization context required.');
  const body = req.body?.facilityId,
    query = req.query.facilityId,
    raw = body ?? query;
  const id = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
    throw new BookingError('INVALID_FACILITY_ID', 'facilityId must be a positive integer.');
  if (body != null && query != null && Number(body) !== Number(query))
    throw new BookingError('FACILITY_SCOPE_MISMATCH', 'Facility identifiers do not match.', 403);
  const facility = await queries.getFacilityByIdScoped(
    req.authContext,
    resolveFacilityScope(req.authContext, id),
  );
  if (!facility) throw new BookingError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorUserId: req.authContext.userId,
  };
}
function fail(res: Response, error: unknown) {
  if (error instanceof BookingError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  if (error instanceof ScopeAccessError) {
    res.status(403).json({ success: false, error: error.code, message: 'Facility access denied.' });
    return;
  }
  res.status(500).json({
    success: false,
    error: 'BOOKING_OPERATION_FAILED',
    message: 'Booking operation failed.',
  });
}
router.get('/workspace', requirePermission('booking.read'), async (req: AuthRequest, res) => {
  try {
    res.json({ success: true, ...(await getBookingAdminWorkspace(await scoped(req))) });
  } catch (error) {
    fail(res, error);
  }
});
router.post(
  '/clients',
  requirePermission('booking.clients.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        ...(await createBookingClientScoped(await scoped(req), req.body ?? {})),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/clients/:id/revoke',
  requirePermission('booking.clients.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        client: await revokeBookingClientScoped(await scoped(req), Number(req.params.id)),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post('/slots', requirePermission('booking.manage'), async (req: AuthRequest, res) => {
  try {
    res.status(201).json({
      success: true,
      slot: await createBookingSlotScoped(await scoped(req), req.body ?? {}),
    });
  } catch (error) {
    fail(res, error);
  }
});
router.post(
  '/bookings/:id/confirm',
  requirePermission('booking.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        ...(await confirmBookingScoped(
          await scoped(req),
          Number(req.params.id),
          Number(req.body?.patientId),
          {
            identityVerified: req.body?.identityVerified,
            availabilityReviewed: req.body?.availabilityReviewed,
          },
        )),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/bookings/:id/reminders',
  requirePermission('booking.manage'),
  async (req: AuthRequest, res) => {
    try {
      const result = await sendBookingReminderScoped(
        await scoped(req),
        Number(req.params.id),
        req.get('Idempotency-Key'),
      );
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);
export default router;
