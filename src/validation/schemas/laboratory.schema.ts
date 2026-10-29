import { z } from 'zod';

/** Collection status only. This endpoint cannot publish or verify a result. */
export const updateLabOrderStatusBodySchema = z.object({
  status: z.enum(['Ordered', 'Sample Collected']),
  accessionNumber: z.string().trim().max(200).optional(),
});
