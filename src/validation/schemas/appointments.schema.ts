import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const optionalId = (label: string) =>
  positiveIntField(`${label} must be a positive integer.`).nullable().optional();
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();

/** The client may only submit fields belonging to a new appointment. */
export const createAppointmentBodySchema = z.object({
  tenantId: positiveIntField('tenantId must be a positive integer.'),
  facilityId: positiveIntField('facilityId must be a positive integer.'),
  patientId: positiveIntField('patientId must be a positive integer.'),
  practitionerId: optionalId('practitionerId'),
  departmentId: optionalId('departmentId'),
  scheduledTime: z.string().trim().min(1, 'A scheduled time is required.').max(128),
  durationMinutes: z.number().int().positive().nullable().optional(),
  appointmentType: optionalText(120),
  status: optionalText(80),
  reason: optionalText(2000),
  notes: optionalText(10000),
});
