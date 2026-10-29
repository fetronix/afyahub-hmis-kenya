import { z } from 'zod';

/** The queue service checks the allowed transition status and facility scope. */
export const updateQueueStatusBodySchema = z.object({
  status: z.string().trim().min(1, 'A queue status is required.').max(80),
});
