import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const id = positiveIntField('A positive integer is required.');
const facilityId = id.optional();
const instant = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO date and time with a UTC offset.' });
const slot = {
  roomId: id,
  startsAt: instant,
  endsAt: instant,
};
const validSlot = (value: { startsAt: string; endsAt: string }) =>
  new Date(value.startsAt).getTime() < new Date(value.endsAt).getTime();

export const theatreRoomCreateSchema = z
  .object({
    facilityId,
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const theatreRoomStateSchema = z
  .object({
    facilityId,
    state: z.enum(['OPEN', 'MAINTENANCE', 'INACTIVE']),
  })
  .strict();

export const theatreBookingCreateSchema = z
  .object({
    facilityId,
    patientId: id,
    procedureName: z.string().trim().min(1).max(200),
    leadPractitionerId: id,
    urgency: z.enum(['ELECTIVE', 'URGENT', 'EMERGENCY']),
    encounterId: id.optional(),
    admissionId: id.optional(),
    requestKey: z.string().uuid(),
    ...slot,
  })
  .strict()
  .refine(validSlot, { path: ['endsAt'], message: 'End must be later than start.' });

export const theatreRescheduleSchema = z
  .object({
    facilityId,
    expectedRevision: id,
    reason: z.string().trim().min(1).max(500),
    ...slot,
  })
  .strict()
  .refine(validSlot, { path: ['endsAt'], message: 'End must be later than start.' });

export const theatreCancelSchema = z
  .object({
    facilityId,
    expectedRevision: id,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const theatreReportQuerySchema = z
  .object({ facilityId, from: instant, to: instant })
  .strict()
  .refine((value) => new Date(value.from).getTime() < new Date(value.to).getTime(), {
    path: ['to'],
    message: 'End must be later than start.',
  });

export const theatreLegacyReviewSchema = z
  .object({
    facilityId,
    action: z.enum(['NO_ACTIVE_RESERVATION', 'REVOKED']),
    reason: z.string().trim().min(1).max(500),
    acknowledged: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.action !== 'NO_ACTIVE_RESERVATION' || value.acknowledged === true, {
    path: ['acknowledged'],
    message: 'Explicit confirmation is required.',
  });
export type TheatreLegacyReview = z.infer<typeof theatreLegacyReviewSchema>;

export type TheatreRoomCreate = z.infer<typeof theatreRoomCreateSchema>;
export type TheatreRoomState = z.infer<typeof theatreRoomStateSchema>;
export type TheatreBookingCreate = z.infer<typeof theatreBookingCreateSchema>;
export type TheatreReschedule = z.infer<typeof theatreRescheduleSchema>;
export type TheatreCancel = z.infer<typeof theatreCancelSchema>;
