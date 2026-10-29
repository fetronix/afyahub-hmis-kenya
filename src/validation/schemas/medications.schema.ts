import { z } from 'zod';

/** Validates syntax only; this does not establish status transitions or record ownership. */
export const medicationStatusBodySchema = z.object({
  status: z.string().trim().min(1, 'A medication status is required.').max(80),
});
