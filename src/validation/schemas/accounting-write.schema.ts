import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const facilityId = positiveIntField('facilityId must be a positive integer.').nullable().optional();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

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
