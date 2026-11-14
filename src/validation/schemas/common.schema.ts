import { z } from 'zod';

export const MAX_PAGINATION_LIMIT = 200;
export const DEFAULT_PAGINATION_LIMIT = 50;
export const MAX_PAGINATION_OFFSET = 100_000;

export function parsePositiveIntValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
  }
  return null;
}

export function positiveIntField(invalidMessage: string) {
  return z.unknown().transform((val, ctx) => {
    const parsed = parsePositiveIntValue(val);
    if (parsed === null) {
      ctx.addIssue({ code: 'custom', message: invalidMessage });
      return z.NEVER;
    }
    return parsed;
  });
}

export function optionalPositiveIntField(invalidMessage: string) {
  return z
    .unknown()
    .optional()
    .transform((val, ctx) => {
      if (val === undefined || val === '') return undefined;
      const parsed = parsePositiveIntValue(val);
      if (parsed === null) {
        ctx.addIssue({ code: 'custom', message: invalidMessage });
        return z.NEVER;
      }
      return parsed;
    });
}

export const idParamSchema = (invalidMessage = 'Invalid resource ID.') =>
  z.object({
    id: positiveIntField(invalidMessage),
  });

export const paginationQuerySchema = z.object({
  limit: z
    .unknown()
    .optional()
    .transform((val, ctx) => {
      if (val === undefined || val === '') return DEFAULT_PAGINATION_LIMIT;
      const parsed = parsePositiveIntValue(val);
      if (parsed === null || parsed > MAX_PAGINATION_LIMIT) {
        ctx.addIssue({
          code: 'custom',
          message: `limit must be an integer between 1 and ${MAX_PAGINATION_LIMIT}.`,
        });
        return z.NEVER;
      }
      return parsed;
    }),
  offset: z
    .unknown()
    .optional()
    .transform((val, ctx) => {
      if (val === undefined || val === '') return 0;
      const raw = typeof val === 'number' ? String(val) : typeof val === 'string' ? val.trim() : '';
      if (!/^\d+$/.test(raw)) {
        ctx.addIssue({
          code: 'custom',
          message: `offset must be an integer between 0 and ${MAX_PAGINATION_OFFSET}.`,
        });
        return z.NEVER;
      }
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_PAGINATION_OFFSET) {
        ctx.addIssue({
          code: 'custom',
          message: `offset must be an integer between 0 and ${MAX_PAGINATION_OFFSET}.`,
        });
        return z.NEVER;
      }
      return parsed;
    }),
});

export const emailStringSchema = (invalidMessage = 'Email address is invalid.') =>
  z
    .string({ message: invalidMessage })
    .trim()
    .min(1, invalidMessage)
    .max(254, invalidMessage)
    .refine((val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), { message: invalidMessage });

export const slugStringSchema = (invalidMessage = 'Slug is invalid.') =>
  z
    .string({ message: invalidMessage })
    .trim()
    .toLowerCase()
    .min(1, invalidMessage)
    .max(120, invalidMessage)
    .refine((val) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(val), { message: invalidMessage });

export const currencyCodeSchema = (
  invalidMessage = 'Currency must be a three-letter code such as KES.',
) =>
  z
    .string({ message: invalidMessage })
    .trim()
    .refine((val) => /^[A-Z]{3}$/.test(val), { message: invalidMessage });

export const isoDateStringSchema = (invalidMessage = 'Provide a valid YYYY-MM-DD calendar date.') =>
  z
    .string({ message: invalidMessage })
    .trim()
    .refine(
      (val) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
        const parsed = new Date(`${val}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === val;
      },
      { message: invalidMessage },
    );

export function trimmedTextOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function triStateOptionalText(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) return undefined;
  if (body[key] === null || body[key] === '') return null;
  return trimmedTextOrUndefined(body[key]);
}
