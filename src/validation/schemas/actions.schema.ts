import { z } from 'zod';
import { positiveIntField } from './common.schema.ts';

/** For actions that accept no input other than an optional facility scope hint. */
export const facilityActionBodySchema = z.object({
  facilityId: positiveIntField('facilityId must be a positive integer.').nullable().optional(),
});
