import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const text = z.string().trim().max(2000);
const optionalText = text.nullable().optional();
const optionalFacility = positiveIntField('facilityId must be a positive integer.')
  .nullable()
  .optional();

export const updateTheatreCaseBodySchema = z
  .object({
    facilityId: optionalFacility,
    procedureName: text.min(1).optional(),
    leadSurgeon: text.min(1).optional(),
    scheduledStart: text.min(1).optional(),
    theatreRoom: optionalText,
    theatreType: optionalText,
    anaesthetist: optionalText,
    scrubNurse: optionalText,
    scheduledEnd: optionalText,
    postOpNotes: optionalText,
    preOpChecklist: z.record(z.string().max(100), z.boolean()).optional(),
    status: z.enum(['Scheduled', 'In-Theatre', 'Recovery', 'Completed', 'Cancelled']).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'facilityId'), {
    message: 'Provide at least one theatre case field to update.',
  });

/** No clinical checklist, dates or staff details are fabricated. */
export const createTheatreCaseBodySchema = z.object({
  facilityId: optionalFacility,
  patientId: positiveIntField('A valid patient ID is required.'),
  procedureName: text.min(1, 'A procedure name is required.'),
  leadSurgeon: text.min(1, 'A lead surgeon is required.'),
  scheduledStart: text.min(1, 'A scheduled start is required.'),
  theatreRoom: optionalText,
  theatreType: optionalText,
  anaesthetist: optionalText,
  scrubNurse: optionalText,
  scheduledEnd: optionalText,
  status: z.literal('Scheduled').optional(),
});
