import { z } from 'zod';
import { isoDateStringSchema, positiveIntField } from './common.schema.ts';

const facilityId = positiveIntField('facilityId must be a positive integer.').nullable().optional();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const financialStatementSettingsBodySchema = z
  .object({
    facilityId,
    financialYearStartMonth: z
      .number()
      .int()
      .min(1, 'The financial year start month must be between 1 and 12.')
      .max(12, 'The financial year start month must be between 1 and 12.'),
    retainedEarningsAccountId: positiveIntField('Choose a valid equity account.')
      .nullable()
      .optional(),
    preparedByName: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

export const financialStatementMappingBodySchema = z
  .object({
    facilityId,
    accountId: positiveIntField('Choose an account to map.'),
    /**
     * The group is validated against the account's type by the service; here
     * only the shape is checked, because the allowed list depends on the
     * account. Null clears an override.
     */
    presentationGroup: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export const generateFinancialStatementBodySchema = z
  .object({
    facilityId,
    frequency: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM']),
    startYear: z.number().int().min(1900).max(2999).optional(),
    month: z.number().int().min(1).max(12).optional(),
    quarter: z.number().int().min(1).max(4).optional(),
    startDate: isoDateStringSchema().optional(),
    endDate: isoDateStringSchema().optional(),
    comparativeMode: z.enum(['PRIOR_PERIOD', 'PRIOR_YEAR', 'NONE']).optional(),
    accountingBasis: z.enum(['ACCRUAL']).optional(),
    notes: z
      .array(
        z
          .object({
            title: z.string().trim().max(160).optional(),
            body: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export const addStatementNoteBodySchema = z
  .object({
    facilityId,
    title: z.string().trim().max(160).optional(),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export const reviewFinancialStatementBodySchema = z
  .object({
    facilityId,
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const approveFinancialStatementBodySchema = z
  .object({
    facilityId,
    /**
     * A named approval note is mandatory: an approved statement is a signed
     * record, and "approved" without a reason is not evidence of anything.
     */
    comment: text(1000),
  })
  .strict();

export const reviseFinancialStatementBodySchema = z
  .object({
    facilityId,
    reason: text(1000),
  })
  .strict();

export const closeFinancialYearBodySchema = z
  .object({
    facilityId,
    startYear: z.number().int().min(1900).max(2999),
    reason: text(1000),
  })
  .strict();

export const reopenFinancialPeriodBodySchema = z
  .object({
    facilityId,
    periodId: positiveIntField('Choose a financial period.'),
    reason: text(1000),
  })
  .strict();
