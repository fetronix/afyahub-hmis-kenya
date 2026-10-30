import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const optionalClinicalText = z.string().trim().max(5000).nullable().optional();
const optionalId = (field: string) =>
  positiveIntField(`${field} must be a positive integer.`).nullable().optional();

export const createLabOrderBatchBodySchema = z
  .object({
    patientId: optionalId('patientId'),
    encounterId: optionalId('encounterId'),
    investigations: z.array(z.string().trim().max(200)).max(100).optional(),
    testIds: z.array(positiveIntField('Each test ID must be positive.')).max(100).optional(),
    clinicalIndication: z.string().trim().min(1).max(2000),
    specimenType: z.string().trim().min(1).max(120),
    priority: z.enum(['Routine', 'Urgent', 'STAT']),
    clinicalNotes: z.string().trim().max(5000).optional(),
    orderedBy: z.string().trim().max(200).optional(),
  })
  .refine((body) => body.patientId != null || body.encounterId != null, {
    message: 'A patient or encounter is required.',
  })
  .refine(
    (body) =>
      body.investigations !== undefined
        ? body.investigations.some((name) => name.length > 0)
        : Boolean(body.testIds?.length),
    { message: 'Enter at least one laboratory investigation.' },
  )
  .refine((body) => !body.testIds || new Set(body.testIds).size === body.testIds.length, {
    message: 'Duplicate tests are not allowed in one submission.',
  });

export const createLabOrderBodySchema = z
  .object({
    tenantId: optionalId('tenantId'),
    facilityId: optionalId('facilityId'),
    patientId: optionalId('patientId'),
    encounterId: optionalId('encounterId'),
    testId: optionalId('testId'),
    testName: z.string().trim().min(1, 'A test name is required.').max(200),
    status: z.literal('Ordered').optional(),
    clinicalIndication: z.string().trim().max(2000).nullable().optional(),
    specimenType: z.string().trim().max(120).nullable().optional(),
    priority: z.enum(['Routine', 'Urgent', 'STAT']).nullable().optional(),
    clinicalNotes: optionalClinicalText,
    orderedBy: z.string().trim().max(200).nullable().optional(),
  })
  .refine((body) => body.patientId != null || body.encounterId != null, {
    message: 'A patient or encounter is required.',
  });

export const createLabResultBodySchema = z.object({
  orderId: positiveIntField('A valid order ID is required.'),
  patientId: positiveIntField('A valid patient ID is required.'),
  parameterName: z.string().trim().min(1, 'A parameter name is required.').max(500),
  measuredValue: z.string().trim().min(1, 'A measured value is required.').max(5000),
  unit: optionalClinicalText,
  referenceRange: optionalClinicalText,
  flag: optionalClinicalText,
  notes: optionalClinicalText,
});

/** Collection status only. This endpoint cannot publish or verify a result. */
export const verifyLabResultBodySchema = z.object({
  facilityId: optionalId('facilityId'),
});

export const updateLabOrderStatusBodySchema = z.object({
  status: z.enum(['Ordered', 'Sample Collected']),
  accessionNumber: z.string().trim().max(200).optional(),
});
