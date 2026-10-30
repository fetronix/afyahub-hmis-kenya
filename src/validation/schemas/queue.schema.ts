import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const optionalId = (field: string) =>
  positiveIntField(`${field} must be a positive integer.`).nullable().optional();
const optionalText = z.string().trim().max(120).nullable().optional();

export const createQueueEntryBodySchema = z
  .object({
    tenantId: optionalId('tenantId'),
    facilityId: optionalId('facilityId'),
    patientId: optionalId('patientId'),
    encounterId: optionalId('encounterId'),
    queueType: z.string().trim().min(1, 'A queue type is required.').max(120),
    tokenNumber: optionalText,
    priority: optionalText,
    status: optionalText,
    waitingTimeMinutes: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  })
  .refine((body) => body.patientId != null || body.encounterId != null, {
    message: 'A patient or encounter is required.',
  });

/** The queue service checks the allowed transition status and facility scope. */
export const updateQueueStatusBodySchema = z.object({
  status: z.string().trim().min(1, 'A queue status is required.').max(80),
});
