import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  authenticateBookingClient,
  BookingError,
  createWebsiteBooking,
  getBookingAvailability,
  getWebsiteBooking,
  mutateWebsiteBooking,
  type BookingClient,
} from './website-booking.service.ts';

const router = Router();
type BookingRequest = Request & { bookingClient?: BookingClient };
function fail(res: Response, error: unknown) {
  if (error instanceof BookingError) {
    if (error.status === 429) res.setHeader('Retry-After', '60');
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  res.status(500).json({
    success: false,
    error: 'BOOKING_OPERATION_FAILED',
    message: 'Booking operation failed.',
  });
}
router.use(async (req: BookingRequest, res: Response, next: NextFunction) => {
  try {
    req.bookingClient = await authenticateBookingClient(
      req.get('X-Booking-Api-Key'),
      req.get('Origin'),
    );
    next();
  } catch (error) {
    fail(res, error);
  }
});
router.get('/availability', async (req: BookingRequest, res) => {
  try {
    res.json({
      success: true,
      ...(await getBookingAvailability(req.bookingClient!, {
        serviceCode: req.query.serviceCode,
        date: req.query.date,
      })),
    });
  } catch (error) {
    fail(res, error);
  }
});
router.post('/bookings', async (req: BookingRequest, res) => {
  try {
    const result = await createWebsiteBooking(req.bookingClient!, {
      ...req.body,
      idempotencyKey: req.get('Idempotency-Key'),
    });
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
  } catch (error) {
    fail(res, error);
  }
});
router.get('/bookings/:reference', async (req: BookingRequest, res) => {
  try {
    res.json({
      success: true,
      booking: await getWebsiteBooking(
        req.bookingClient!,
        req.params.reference,
        req.get('X-Booking-Manage-Token') ?? '',
      ),
    });
  } catch (error) {
    fail(res, error);
  }
});
router.post('/bookings/:reference/reschedule', async (req: BookingRequest, res) => {
  try {
    res.json({
      success: true,
      ...(await mutateWebsiteBooking(
        req.bookingClient!,
        req.params.reference,
        req.get('X-Booking-Manage-Token') ?? '',
        {
          action: 'RESCHEDULE',
          slotId: req.body?.slotId,
          idempotencyKey: req.get('Idempotency-Key'),
        },
      )),
    });
  } catch (error) {
    fail(res, error);
  }
});
router.post('/bookings/:reference/cancel', async (req: BookingRequest, res) => {
  try {
    res.json({
      success: true,
      ...(await mutateWebsiteBooking(
        req.bookingClient!,
        req.params.reference,
        req.get('X-Booking-Manage-Token') ?? '',
        { action: 'CANCEL', idempotencyKey: req.get('Idempotency-Key') },
      )),
    });
  } catch (error) {
    fail(res, error);
  }
});
export default router;
