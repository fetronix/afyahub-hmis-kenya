import { z } from 'zod';
import { isoDateStringSchema, positiveIntField } from './common.schema.ts';
import {
  parseKesToCents,
  validateBalancedJournalLines,
} from '../../accounting/accounting.service.ts';

const facilityId = positiveIntField('facilityId must be a positive integer.').nullable().optional();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const createBankAccountBodySchema = z
  .object({
    facilityId,
    accountName: text(160),
    bankCode: text(80),
    bankName: text(160),
    glAccountId: positiveIntField('A valid ledger account is required.'),
    accountLastFour: z
      .union([
        z
          .string()
          .trim()
          .regex(/^\d{4}$/),
        z.literal(''),
      ])
      .nullable()
      .optional(),
  })
  .strict();

export const decideExpenseRequestBodySchema = z.object({
  facilityId,
  decision: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(['APPROVE', 'REJECT'])),
  notes: text(1000),
});

export const createExpenseRequestBodySchema = z
  .object({
    facilityId,
    expenseAccountId: positiveIntField('A valid expense account is required.'),
    payableAccountId: positiveIntField('A valid payable account is required.'),
    amountKes: z.unknown().refine((value) => {
      try {
        return parseKesToCents(value) > 0n;
      } catch {
        return false;
      }
    }, 'Expense amount must be a positive KES amount.'),
    incurredDate: isoDateStringSchema(),
    idempotencyKey: text(128).optional(),
    payeeName: text(160),
    category: text(80),
    description: text(500),
    serviceLine: z.string().trim().max(80).nullable().optional(),
    supportingDocuments: z
      .array(
        z.object({
          name: text(160),
          storageReference: text(300)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._/:-]*$/)
            .refine((ref) => !/^https?:/i.test(ref)),
        }),
      )
      .max(20)
      .nullable()
      .optional(),
  })
  .refine((body) => body.expenseAccountId !== body.payableAccountId, {
    message: 'Expense and payable accounts must be distinct.',
  });

export const postBillingSourceBodySchema = z
  .object({
    facilityId,
    entryDate: isoDateStringSchema(),
    description: text(500),
    idempotencyKey: text(128).optional(),
    patientReceivableAccountId: facilityId,
    insurerReceivableAccountId: facilityId,
    revenueAccountId: facilityId,
    settlementAccountId: facilityId,
    liabilityAccountId: facilityId,
    receivableRefundKes: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

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
