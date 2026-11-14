import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { requireScopedFacility } from './shared/scoping.ts';
import {
  getValidatedBody,
  getValidatedQuery,
  validateBody,
  validateQuery,
} from '../validation/validate.ts';
import {
  theatreBookingCreateSchema,
  theatreCancelSchema,
  theatreLegacyReviewSchema,
  theatreRescheduleSchema,
  theatreReportQuerySchema,
  theatreRoomCreateSchema,
  theatreRoomStateSchema,
  type TheatreBookingCreate,
  type TheatreCancel,
  type TheatreLegacyReview,
  type TheatreReschedule,
  type TheatreRoomCreate,
  type TheatreRoomState,
} from '../validation/schemas/theatre-scheduling.schema.ts';
import * as theatre from '../theatre/scheduling.service.ts';

const router = Router();

async function scope(
  req: AuthRequest,
  res: Response,
  raw: unknown,
): Promise<theatre.TheatreScope | null> {
  const facility = await requireScopedFacility(req, res, raw);
  if (!facility || !req.authContext) return null;
  return { tenantId: facility.tenantId, facilityId: facility.id, actorId: req.authContext.userId };
}
function idParam(req: AuthRequest, res: Response): number | null {
  const value = Number(req.params.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    res.status(400).json({
      success: false,
      error: 'INVALID_THEATRE_ID',
      message: 'A valid identifier is required.',
    });
    return null;
  }
  return value;
}
function fail(res: Response, error: unknown) {
  if (error instanceof theatre.TheatreError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  // Do not log clinical inputs, SQL or internal details in API responses/logs.
  res.status(500).json({
    success: false,
    error: 'THEATRE_REQUEST_FAILED',
    message: 'The Theatre request could not be completed.',
  });
}

router.get(
  '/api/theatre/reports/schedule',
  requirePermission('theatre.reports.read'),
  validateQuery(theatreReportQuerySchema),
  async (req: AuthRequest, res) => {
    const query = getValidatedQuery<{ facilityId?: number; from: string; to: string }>(req);
    const access = await scope(req, res, query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.scheduleReport(access, query.from, query.to));
    } catch (error) {
      fail(res, error);
    }
  },
);

router.get(
  '/api/theatre/rooms',
  requirePermission('theatre.read'),
  async (req: AuthRequest, res) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.listRooms(access));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/api/theatre/rooms',
  requirePermission('theatre.rooms.manage'),
  validateBody(theatreRoomCreateSchema),
  async (req: AuthRequest, res) => {
    const body = getValidatedBody<TheatreRoomCreate>(req);
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await theatre.createRoom(access, body));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.patch(
  '/api/theatre/rooms/:id',
  requirePermission('theatre.rooms.manage'),
  validateBody(theatreRoomStateSchema),
  async (req: AuthRequest, res) => {
    const body = getValidatedBody<TheatreRoomState>(req);
    const id = idParam(req, res);
    if (!id) return;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.setRoomState(access, id, body));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.get(
  '/api/theatre/practitioners',
  requirePermission('theatre.read'),
  async (req: AuthRequest, res) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.listPractitioners(access));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.get(
  '/api/theatre/cases',
  requirePermission('theatre.read'),
  async (req: AuthRequest, res) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.listCases(access));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/api/theatre/cases',
  requirePermission('theatre.schedule.create'),
  validateBody(theatreBookingCreateSchema),
  async (req: AuthRequest, res) => {
    const body = getValidatedBody<TheatreBookingCreate>(req);
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      const result = await theatre.createBooking(access, body);
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/api/theatre/cases/:id/reschedule',
  requirePermission('theatre.schedule.manage'),
  validateBody(theatreRescheduleSchema),
  async (req: AuthRequest, res) => {
    const body = getValidatedBody<TheatreReschedule>(req);
    const id = idParam(req, res);
    if (!id) return;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.rescheduleBooking(access, id, body));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/api/theatre/cases/:id/cancel',
  requirePermission('theatre.schedule.manage'),
  validateBody(theatreCancelSchema),
  async (req: AuthRequest, res) => {
    const body = getValidatedBody<TheatreCancel>(req);
    const id = idParam(req, res);
    if (!id) return;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.cancelBooking(access, id, body));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/api/theatre/cases/:id/legacy-review',
  requirePermission('theatre.schedule.reconcile'),
  validateBody(theatreLegacyReviewSchema),
  async (req: AuthRequest, res) => {
    const body = getValidatedBody<TheatreLegacyReview>(req);
    const id = idParam(req, res);
    if (!id) return;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await theatre.reviewLegacyReservation(access, id, body));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.get(
  '/api/theatre/cases/:id/legacy-reviews',
  requirePermission('theatre.read'),
  async (req: AuthRequest, res) => {
    const id = idParam(req, res);
    if (!id) return;
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.legacyReviewHistory(access, id));
    } catch (error) {
      fail(res, error);
    }
  },
);
router.get(
  '/api/theatre/cases/:id/history',
  requirePermission('theatre.read'),
  async (req: AuthRequest, res) => {
    const id = idParam(req, res);
    if (!id) return;
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await theatre.schedulingHistory(access, id));
    } catch (error) {
      fail(res, error);
    }
  },
);

export default router;
