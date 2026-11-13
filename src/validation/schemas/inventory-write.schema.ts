import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

const requiredText = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(1000).nullable().optional();
const count = z.number().int().min(0).max(2_147_483_647).nullable().optional();
const amountPattern = /^\d{1,8}(?:\.\d{1,2})?$/;
const money = z
  .union([
    z.string().trim().regex(amountPattern, 'Enter a non-negative monetary amount.'),
    z
      .number()
      .finite()
      .nonnegative()
      .max(99999999.99)
      .refine((value) => amountPattern.test(String(value)), 'Enter at most two decimal places.'),
  ])
  .nullable()
  .optional();

/** Catalogue fields only: calculated, database-owned IDs and timestamps are not writable. */
export const createInventoryItemBodySchema = z.object({
  facilityId: positiveIntField('facilityId must be a positive integer.'),
  itemCode: requiredText,
  name: requiredText,
  genericName: optionalText,
  category: optionalText,
  unit: optionalText,
  strength: optionalText,
  dosageForm: optionalText,
  currentStock: count,
  reorderLevel: count,
  unitCost: money,
  sellingPrice: money,
  storeLocation: optionalText,
  isActive: z.boolean().nullable().optional(),
});
