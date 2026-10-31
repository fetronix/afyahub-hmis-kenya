import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const optionalId = (field: string) =>
  positiveIntField(`${field} must be a positive integer.`).nullable().optional();

export const radiologyReportBodySchema = z
  .object({
    facilityId: optionalId('facilityId'),
    findings: z.string().trim().max(10000).optional(),
    impression: z.string().trim().max(10000).optional(),
    reportedBy: z.string().trim().min(1, 'A reporter is required.').max(200),
  })
  .refine((body) => Boolean(body.findings || body.impression), {
    message: 'Enter findings or an impression before reporting.',
  });

export const createRadiologyOrderBodySchema = z.object({
  facilityId: optionalId('facilityId'),
  patientId: positiveIntField('A valid patient ID is required.'),
  encounterId: optionalId('encounterId'),
  masterServiceId: optionalId('masterServiceId'),
  idempotencyKey: z.string().trim().min(16).max(128).optional(),
  modality: z.string().trim().min(1, 'A modality is required.').max(120),
  procedureName: z.string().trim().min(1, 'A procedure name is required.').max(500),
  clinicalIndication: z.string().trim().max(2000).nullable().optional(),
  status: z.literal('Requested').optional(),
  orderedBy: z.string().trim().max(200).nullable().optional(),
});
