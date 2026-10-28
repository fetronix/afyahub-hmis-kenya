import { z } from 'zod';

import {
  idParamSchema,
  optionalPositiveIntField,
  paginationQuerySchema,
  positiveIntField,
} from './common.schema.ts';

export const scopedCollectionQuerySchema = paginationQuerySchema.extend({
  tenantId: optionalPositiveIntField('Invalid tenant ID.'),
  facilityId: optionalPositiveIntField('Invalid facility ID.'),
  search: z.string().trim().max(200, 'Search query must not exceed 200 characters.').optional(),
});

export const patientIdParamSchema = idParamSchema('Invalid patient ID.');
export const invoiceIdParamSchema = idParamSchema('Invalid invoice ID.');
export const claimIdParamSchema = idParamSchema('Invalid claim ID.');

export const createPatientBodySchema = z
  .object({
    firstName: z
      .string({ message: 'Patient firstName is required.' })
      .trim()
      .min(1, 'Patient firstName is required.')
      .max(120, 'Patient firstName must not exceed 120 characters.'),
    lastName: z
      .string({ message: 'Patient lastName is required.' })
      .trim()
      .min(1, 'Patient lastName is required.')
      .max(120, 'Patient lastName must not exceed 120 characters.'),
    dateOfBirth: z
      .string({ message: 'Patient dateOfBirth is required.' })
      .trim()
      .min(1, 'Patient dateOfBirth is required.')
      .max(32),
    gender: z
      .string({ message: 'Patient gender is required.' })
      .trim()
      .min(1, 'Patient gender is required.')
      .max(40),
    registrationFacilityId: positiveIntField(
      'Valid registrationFacilityId is required.',
    ).optional(),
    facilityId: positiveIntField('Valid facilityId is required.').optional(),
  })
  .passthrough();

export const updatePatientBodySchema = z
  .record(z.string(), z.unknown())
  .refine((body) => Object.keys(body).length > 0, {
    message: 'No valid fields supplied to update.',
  });

export const voidInvoiceBodySchema = z.object({
  reason: z
    .string({ message: 'A void reason is required.' })
    .trim()
    .min(3, 'Void reason must be at least 3 characters.')
    .max(500, 'Void reason must not exceed 500 characters.'),
});

export const recordPaymentBodySchema = z
  .object({
    invoiceId: positiveIntField('A valid invoiceId is required.'),
    amount: z.union([
      z.number().positive('Payment amount must be greater than zero.'),
      z
        .string()
        .trim()
        .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, 'Payment amount must be a valid monetary value.'),
    ]),
    paymentMethod: z.string().trim().min(1).max(60).optional(),
    method: z.string().trim().min(1).max(60).optional(),
  })
  .passthrough();

export const draftClaimBodySchema = z
  .object({
    invoiceId: positiveIntField('A valid invoiceId is required.'),
    lineItemIds: z
      .array(z.number().int().positive('Each lineItemId must be a positive integer.'))
      .max(500, 'lineItemIds exceeds maximum batch size.')
      .optional(),
    payerName: z.string().trim().max(160).optional(),
    policyNumber: z.string().trim().max(120).optional(),
    preAuthCode: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
    facilityId: optionalPositiveIntField('Invalid facilityId.'),
  })
  .passthrough();

export const adjudicateClaimBodySchema = z
  .object({
    approvedAmount: z.union([
      z.number().nonnegative('approvedAmount cannot be negative.'),
      z
        .string()
        .trim()
        .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, 'approvedAmount must be a valid monetary value.'),
    ]),
    notes: z.string().trim().max(1000).optional(),
    facilityId: optionalPositiveIntField('Invalid facilityId.'),
  })
  .passthrough();

export const paymentLedgerQuerySchema = z.object({
  facilityId: optionalPositiveIntField('facilityId must be a positive integer.'),
  invoiceId: optionalPositiveIntField('invoiceId must be a positive integer.'),
  method: z.string().trim().max(50).optional(),
  limit: z
    .unknown()
    .optional()
    .transform((val, ctx): number | undefined => {
      if (val === undefined || val === null || val === '') return undefined;
      const parsed = Number(val);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
        ctx.addIssue({
          code: 'custom',
          message: 'limit must be an integer between 1 and 500.',
        });
        return z.NEVER;
      }
      return parsed;
    }),
});

export const facilitiesListQuerySchema = z.object({
  tenantId: optionalPositiveIntField('Invalid tenant ID.'),
});

export const auditLogsQuerySchema = z.object({
  facilityId: optionalPositiveIntField('facilityId must be a positive integer.'),
});

export const claimOptionalFacilityBodySchema = z
  .object({
    facilityId: optionalPositiveIntField('facilityId must be a positive integer.'),
  })
  .passthrough();

export const createInvoiceBodySchema = z
  .object({
    invoice: z
      .object({
        facilityId: positiveIntField('A valid facility ID is required.'),
        patientId: positiveIntField('A valid patient ID is required.'),
        invoiceNumber: z
          .string({ message: 'A valid invoice number is required.' })
          .trim()
          .min(1, 'A valid invoice number is required.')
          .max(100, 'Invoice number must not exceed 100 characters.'),
        payerType: z.string().trim().max(50).optional(),
        payerName: z.string().trim().max(200).nullable().optional(),
        memberNumber: z.string().trim().max(100).nullable().optional(),
      })
      .passthrough(),
    items: z
      .array(z.record(z.string(), z.unknown()), {
        message: 'Provide between 1 and 200 invoice items.',
      })
      .min(1, 'Provide between 1 and 200 invoice items.')
      .max(200, 'Provide between 1 and 200 invoice items.'),
  })
  .passthrough();
