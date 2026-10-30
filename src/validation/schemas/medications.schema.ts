import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const requiredText = z.string().trim().min(1).max(1000);
const optionalText = z.string().trim().max(5000).nullable().optional();
const optionalId = (field: string) =>
  positiveIntField(`${field} must be a positive integer.`).nullable().optional();
const amountPattern = /^\d{1,8}(?:\.\d{1,2})?$/;

export const createMedicationBodySchema = z.object({
  encounterId: positiveIntField('A valid encounter ID is required.'),
  patientId: positiveIntField('A valid patient ID is required.'),
  drugId: optionalId('drugId'),
  drugName: requiredText,
  dosage: requiredText,
  frequency: requiredText,
  duration: requiredText,
  route: optionalText,
  instructions: optionalText,
  quantity: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  unitPrice: z
    .union([
      z.string().trim().regex(amountPattern, 'Enter a non-negative monetary amount.'),
      z
        .number()
        .finite()
        .nonnegative()
        .max(99999999.99)
        .refine((value) => amountPattern.test(String(value))),
    ])
    .nullable()
    .optional(),
  status: z.literal('Prescribed').optional(),
  prescribedBy: optionalText,
  allergyAcknowledged: z.boolean().optional(),
});

/** Validates syntax only; this does not establish status transitions or record ownership. */
export const medicationStatusBodySchema = z.object({
  status: z.string().trim().min(1, 'A medication status is required.').max(80),
  reason: z.string().trim().min(1).max(1000).optional(),
});
