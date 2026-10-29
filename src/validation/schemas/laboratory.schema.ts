import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const optionalClinicalText = z.string().trim().max(5000).nullable().optional();

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
export const updateLabOrderStatusBodySchema = z.object({
  status: z.enum(['Ordered', 'Sample Collected']),
  accessionNumber: z.string().trim().max(200).optional(),
});
