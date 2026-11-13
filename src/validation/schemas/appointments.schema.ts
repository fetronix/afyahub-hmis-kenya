import { z } from 'zod';
import { parseCalendarDate, validateRange } from '../../dashboard/date-range.ts';
import {
  optionalPositiveIntField,
  paginationQuerySchema,
  positiveIntField,
} from './common.schema.ts';

const optionalId = (label: string) =>
  positiveIntField(`${label} must be a positive integer.`).nullable().optional();
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();

/** A facility-local wall time, not a guessed UTC time or an impossible calendar date. */
export function validAppointmentTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  return (
    !!match &&
    !!parseCalendarDate(match[1]) &&
    Number(match[2]) < 24 &&
    Number(match[3]) < 60 &&
    (match[4] === undefined || Number(match[4]) < 60)
  );
}
const scheduledTime = z
  .string()
  .trim()
  .refine(validAppointmentTime, 'Enter a valid local date and time (YYYY-MM-DD HH:mm).');
const reason = z
  .string()
  .trim()
  .min(3, 'A reason of at least three characters is required.')
  .max(2000);

/** The actor and the persisted tenant are always obtained from the authenticated scope. */
export const createAppointmentBodySchema = z.object({
  tenantId: positiveIntField('tenantId must be a positive integer.').optional(),
  facilityId: positiveIntField('facilityId must be a positive integer.').optional(),
  patientId: positiveIntField('patientId must be a positive integer.'),
  practitionerId: optionalId('practitionerId'),
  departmentId: optionalId('departmentId'),
  categoryId: optionalId('categoryId'),
  scheduledTime,
  durationMinutes: z.number().int().positive().max(1440).nullable().optional(),
  appointmentType: optionalText(120),
  priority: z.enum(['Normal', 'Priority', 'Urgent']).nullable().optional(),
  status: optionalText(80),
  reason: optionalText(2000),
  notes: optionalText(10000),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentBodySchema>;

const optionalDate = z
  .string()
  .refine((v) => !!parseCalendarDate(v), 'Enter a valid date (YYYY-MM-DD).')
  .optional();
export const appointmentListQuerySchema = paginationQuerySchema
  .extend({
    facilityId: optionalPositiveIntField('facilityId must be a positive integer.'),
    from: optionalDate,
    to: optionalDate,
    patientId: optionalPositiveIntField('patientId must be a positive integer.'),
    practitionerId: optionalPositiveIntField('practitionerId must be a positive integer.'),
    categoryId: optionalPositiveIntField('categoryId must be a positive integer.'),
    status: z.string().trim().min(1).max(80).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .refine((v) => (v.from === undefined && v.to === undefined) || !!validateRange(v.from, v.to), {
    message: 'Provide a valid date range of at most 366 days.',
    path: ['from'],
  });
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

export const appointmentCategoryBodySchema = z.object({
  facilityId: positiveIntField('facilityId must be a positive integer.').optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9_-]{0,39}$/,
      'Use a category code of letters, numbers, underscores or hyphens.',
    ),
  name: z.string().trim().min(1).max(120),
  facilityServiceId: optionalId('facilityServiceId'),
});
export type AppointmentCategoryInput = z.infer<typeof appointmentCategoryBodySchema>;
export const appointmentCategoryUpdateSchema = z
  .object({
    facilityId: positiveIntField('facilityId must be a positive integer.').optional(),
    name: z.string().trim().min(1).max(120).optional(),
    facilityServiceId: optionalId('facilityServiceId'),
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.facilityServiceId !== undefined || v.isActive !== undefined,
    'At least one change is required.',
  );
export type AppointmentCategoryUpdate = z.infer<typeof appointmentCategoryUpdateSchema>;

export const appointmentCancelSchema = z.object({
  facilityId: positiveIntField('facilityId must be a positive integer.').optional(),
  reason,
});
export type AppointmentCancelInput = z.infer<typeof appointmentCancelSchema>;
export const appointmentRescheduleSchema = appointmentCancelSchema.extend({ scheduledTime });
export type AppointmentRescheduleInput = z.infer<typeof appointmentRescheduleSchema>;
export const appointmentCheckInSchema = z.object({
  facilityId: positiveIntField('facilityId must be a positive integer.').optional(),
  queueType: z.enum(['Triage', 'Doctor', 'Laboratory', 'Radiology', 'Pharmacy', 'Billing']),
});
export type AppointmentCheckInInput = z.infer<typeof appointmentCheckInSchema>;
