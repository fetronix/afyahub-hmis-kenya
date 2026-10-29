import { z } from 'zod';
import { isoDateStringSchema, positiveIntField } from './common.schema.ts';
import { validateBalancedJournalLines } from '../../accounting/accounting.service.ts';

const facilityId = positiveIntField('facilityId must be a positive integer.').nullable().optional();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const reverseJournalBodySchema = z.object({
  facilityId,
  entryDate: isoDateStringSchema(),
  reason: text(500),
  idempotencyKey: text(128).optional(),
});

export const postJournalBodySchema = z.object({
  facilityId,
  entryDate: isoDateStringSchema(),
  description: text(500),
  // The key may instead be supplied in the Idempotency-Key header; the service enforces it.
  idempotencyKey: text(128).optional(),
  lines: z.unknown().superRefine((value, ctx) => {
    try {
      validateBalancedJournalLines(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Journal lines must be valid and balanced.' });
    }
  }),
});

export const closeFinancialPeriodBodySchema = z.object({ facilityId, notes: text(1000) });

export const createFinancialPeriodBodySchema = z
  .object({
    facilityId,
    periodCode: text(40),
    name: text(160),
    startDate: isoDateStringSchema(),
    endDate: isoDateStringSchema(),
  })
  .refine((body) => body.startDate <= body.endDate, {
    message: 'Period start must not be after its end.',
  });

export const createAccountBodySchema = z.object({
  facilityId,
  accountCode: text(40),
  accountName: text(160),
  accountType: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])),
  normalBalance: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['DEBIT', 'CREDIT'])),
  subType: text(80),
});
