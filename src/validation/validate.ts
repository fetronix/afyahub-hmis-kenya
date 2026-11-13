import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationErrorPayload {
  success: false;
  error: string;
  code: string;
  message: string;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /**
   * Optional sub-code (`payload.code`) for routes that expose a secondary
   * domain code while keeping `payload.error` normalized to `'VALIDATION_ERROR'`.
   */
  code?: string | ((firstIssue: z.core.$ZodIssue) => string);
  /**
   * Optional override for `payload.error` only when an existing external contract
   * requires a non-default top-level error string; defaults to `'VALIDATION_ERROR'`.
   */
  errorCode?: string | ((firstIssue: z.core.$ZodIssue) => string);
  /**
   * Fallback human-readable message when the schema fails at root level.
   */
  fallbackMessage?: string;
}

export type ValidatedRequest<TBody = unknown, TQuery = unknown, TParams = unknown> = Request & {
  validatedBody?: TBody;
  validatedQuery?: TQuery;
  validatedParams?: TParams;
};

/**
 * Scrub any accidental stack frames, file paths, SQL fragments, or bearer
 * tokens from a validation message. Messages in JaliCare schemas never echo
 * raw user input.
 */
function safeIssueMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) return fallback;
  if (
    /\n\s*at\s+\S+/.test(trimmed) ||
    /\bpostgres(?:ql)?:\/\//i.test(trimmed) ||
    /\bSELECT\s+.+\s+FROM\b/i.test(trimmed) ||
    /\bBearer\s+/i.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

export function formatValidationFailure(
  zodError: z.ZodError,
  options: ValidateOptions = {},
): ValidationErrorPayload {
  const fallback = options.fallbackMessage ?? 'Request validation failed.';
  const rawIssues = zodError.issues;
  const firstRawIssue = rawIssues[0];

  const issues: ValidationIssue[] = rawIssues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : 'root',
    message: safeIssueMessage(issue.message, fallback),
  }));

  const error =
    typeof options.errorCode === 'function' && firstRawIssue
      ? options.errorCode(firstRawIssue)
      : typeof options.errorCode === 'string'
        ? options.errorCode
        : 'VALIDATION_ERROR';

  const code =
    typeof options.code === 'function' && firstRawIssue
      ? options.code(firstRawIssue)
      : typeof options.code === 'string'
        ? options.code
        : error;

  return {
    success: false,
    error,
    code,
    message: issues[0]?.message ?? fallback,
    issues,
  };
}

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  options: ValidateOptions = {},
): { ok: true; data: T } | { ok: false; payload: ValidationErrorPayload } {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    payload: formatValidationFailure(parsed.error, options),
  };
}

function normalizeObjectCandidate(value: unknown): Record<string, unknown> | unknown {
  if (value === undefined) return {};
  return value;
}

export function validateBody<T>(
  schema: z.ZodType<T>,
  options: ValidateOptions = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const candidate = normalizeObjectCandidate(req.body);
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      const parsedNonObject = schema.safeParse({});
      if (!parsedNonObject.success) {
        res.status(400).json(formatValidationFailure(parsedNonObject.error, options));
        return;
      }
      const fallbackMessage = options.fallbackMessage ?? 'Request body must be a JSON object.';
      const error = typeof options.errorCode === 'string' ? options.errorCode : 'VALIDATION_ERROR';
      const code = typeof options.code === 'string' ? options.code : error;
      res.status(400).json({
        success: false,
        error,
        code,
        message: fallbackMessage,
        issues: [{ path: 'root', message: fallbackMessage }],
      });
      return;
    }

    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      res.status(400).json(formatValidationFailure(parsed.error, options));
      return;
    }

    (req as ValidatedRequest<T>).validatedBody = parsed.data;
    next();
  };
}

export function validateQuery<T>(
  schema: z.ZodType<T>,
  options: ValidateOptions = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) {
      res.status(400).json(formatValidationFailure(parsed.error, options));
      return;
    }

    (req as ValidatedRequest<unknown, T>).validatedQuery = parsed.data;
    next();
  };
}

export function validateParams<T>(
  schema: z.ZodType<T>,
  options: ValidateOptions = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.params ?? {});
    if (!parsed.success) {
      res.status(400).json(formatValidationFailure(parsed.error, options));
      return;
    }

    (req as ValidatedRequest<unknown, unknown, T>).validatedParams = parsed.data;
    next();
  };
}

export function getValidatedBody<T>(req: Request): T {
  return (req as ValidatedRequest<T>).validatedBody as T;
}

export function getValidatedQuery<T>(req: Request): T {
  return (req as ValidatedRequest<unknown, T>).validatedQuery as T;
}

export function getValidatedParams<T>(req: Request): T {
  return (req as ValidatedRequest<unknown, unknown, T>).validatedParams as T;
}
