import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import {
  AppointmentError,
  appointmentRequestKey,
  cancelAppointmentScoped,
  checkInAppointmentScoped,
  createAppointmentCategoryScoped,
  createAppointmentScoped,
  getAppointmentHistoryScoped,
  listAppointmentCategoriesScoped,
  listAppointmentResourcesScoped,
  listAppointmentsScoped,
  rescheduleAppointmentScoped,
  updateAppointmentCategoryScoped,
} from '../appointments/appointments.service.ts';
import {
  appointmentCancelSchema,
  appointmentCategoryBodySchema,
  appointmentCategoryUpdateSchema,
  appointmentCheckInSchema,
  appointmentListQuerySchema,
  appointmentRescheduleSchema,
  createAppointmentBodySchema,
  type AppointmentCancelInput,
  type AppointmentCategoryInput,
  type AppointmentCategoryUpdate,
  type AppointmentCheckInInput,
  type AppointmentListQuery,
  type AppointmentRescheduleInput,
  type CreateAppointmentInput,
} from '../validation/schemas/appointments.schema.ts';
import { parsePositiveIntValue } from '../validation/schemas/common.schema.ts';
import {
  getValidatedBody,
  getValidatedQuery,
  validateBody,
  validateQuery,
} from '../validation/validate.ts';
import { requireAuthContext } from './shared/request.ts';

const router = Router();
function id(value: unknown, field: string): number {
  const result = parsePositiveIntValue(value);
  if (result === null)
    throw new AppointmentError('INVALID_ID', `A valid ${field} is required.`, 400);
  return result;
}
function queryFacility(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  return id(value, 'facilityId');
}
function selectedFacility(body: number | undefined, query: unknown): number | undefined {
  const selected = queryFacility(query);
  if (selected !== undefined && body !== undefined && selected !== body) {
    throw new AppointmentError(
      'FACILITY_SCOPE_MISMATCH',
      'The requested facility identifiers do not match.',
      403,
    );
  }
  return body ?? selected;
}
function respond(error: unknown, res: Response) {
  if (error instanceof AppointmentError || error instanceof ScopeAccessError) {
    const status =
      error instanceof AppointmentError
        ? error.status
        : error.code === 'FACILITY_REQUIRED'
          ? 400
          : 403;
    res.status(status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  // Do not log driver details, input, patient identifiers or clinical notes.
  console.error('[appointments] Request failed unexpectedly.');
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
  });
}

router.get(
  '/api/appointments/resources',
  requirePermission('appointments.read'),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(await listAppointmentResourcesScoped(context, queryFacility(req.query.facilityId)));
    } catch (error) {
      respond(error, res);
    }
  },
);
router.get(
  '/api/appointments/categories',
  requirePermission('appointments.read'),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(await listAppointmentCategoriesScoped(context, queryFacility(req.query.facilityId)));
    } catch (error) {
      respond(error, res);
    }
  },
);
router.post(
  '/api/appointments/categories',
  requirePermission('appointments.categories.manage'),
  validateBody(appointmentCategoryBodySchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const body = getValidatedBody<AppointmentCategoryInput>(req);
      res.status(201).json(
        await createAppointmentCategoryScoped(context, {
          ...body,
          facilityId: selectedFacility(body.facilityId, req.query.facilityId),
        }),
      );
    } catch (error) {
      respond(error, res);
    }
  },
);
router.patch(
  '/api/appointments/categories/:id',
  requirePermission('appointments.categories.manage'),
  validateBody(appointmentCategoryUpdateSchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const body = getValidatedBody<AppointmentCategoryUpdate>(req);
      res.json(
        await updateAppointmentCategoryScoped(context, id(req.params.id, 'category id'), {
          ...body,
          facilityId: selectedFacility(body.facilityId, req.query.facilityId),
        }),
      );
    } catch (error) {
      respond(error, res);
    }
  },
);

router.get(
  '/api/appointments',
  requirePermission('appointments.read'),
  validateQuery(appointmentListQuerySchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(await listAppointmentsScoped(context, getValidatedQuery<AppointmentListQuery>(req)));
    } catch (error) {
      respond(error, res);
    }
  },
);
router.post(
  '/api/appointments',
  requirePermission('appointments.create'),
  validateBody(createAppointmentBodySchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const body = getValidatedBody<CreateAppointmentInput>(req);
      const result = await createAppointmentScoped(
        context,
        { ...body, facilityId: selectedFacility(body.facilityId, req.query.facilityId) },
        appointmentRequestKey(req.get('Idempotency-Key')),
      );
      res
        .set('Idempotent-Replay', String(result.idempotentReplay))
        .status(result.idempotentReplay ? 200 : 201)
        .json(result.appointment);
    } catch (error) {
      respond(error, res);
    }
  },
);
router.get(
  '/api/appointments/:id/history',
  requirePermission('appointments.read'),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(
        await getAppointmentHistoryScoped(
          context,
          id(req.params.id, 'appointment id'),
          queryFacility(req.query.facilityId),
        ),
      );
    } catch (error) {
      respond(error, res);
    }
  },
);
router.post(
  '/api/appointments/:id/cancel',
  requirePermission('appointments.cancel'),
  validateBody(appointmentCancelSchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const body = getValidatedBody<AppointmentCancelInput>(req);
      res.json(
        await cancelAppointmentScoped(context, id(req.params.id, 'appointment id'), {
          ...body,
          facilityId: selectedFacility(body.facilityId, req.query.facilityId),
        }),
      );
    } catch (error) {
      respond(error, res);
    }
  },
);
router.post(
  '/api/appointments/:id/reschedule',
  requirePermission('appointments.update'),
  requirePermission('appointments.create'),
  validateBody(appointmentRescheduleSchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const body = getValidatedBody<AppointmentRescheduleInput>(req);
      const result = await rescheduleAppointmentScoped(
        context,
        id(req.params.id, 'appointment id'),
        { ...body, facilityId: selectedFacility(body.facilityId, req.query.facilityId) },
        appointmentRequestKey(req.get('Idempotency-Key'), true)!,
      );
      res
        .set('Idempotent-Replay', String(result.idempotentReplay))
        .status(result.idempotentReplay ? 200 : 201)
        .json(result.appointment);
    } catch (error) {
      respond(error, res);
    }
  },
);
router.post(
  '/api/appointments/:id/check-in',
  requirePermission('appointments.update'),
  requirePermission('appointments.create'),
  validateBody(appointmentCheckInSchema),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const body = getValidatedBody<AppointmentCheckInInput>(req);
      res.json(
        await checkInAppointmentScoped(context, id(req.params.id, 'appointment id'), {
          ...body,
          facilityId: selectedFacility(body.facilityId, req.query.facilityId),
        }),
      );
    } catch (error) {
      respond(error, res);
    }
  },
);
export default router;
