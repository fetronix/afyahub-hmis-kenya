/**
 * JaliCare HMIS
 * Platform administration - shared request helpers
 *
 * These helpers were the first hundred lines of `platform.routes.ts`. Every
 * platform domain (tenants, facilities, invitations, subscriptions, RBAC)
 * uses them, so they live here once, ahead of the file being split further.
 *
 * Bodies moved verbatim; behaviour is unchanged.
 */

import type { Request, Response } from 'express';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';

export type PlatformRequest = Request & {
  authContext?: AuthorizationContext;
};

export function getContext(req: Request): AuthorizationContext | undefined {
  return (req as PlatformRequest).authContext;
}

export function requireSuperAdmin(req: Request, res: Response): boolean {
  if (getContext(req)?.isSuperAdmin !== true) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Super Admin privileges are required.',
    });
    return false;
  }

  return true;
}

export function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function optionalText(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) return undefined;

  if (body[key] === null || body[key] === '') {
    return null;
  }

  return textValue(body[key]);
}

export function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseMoneyCents(value: unknown): number | null {
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) return null;

  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));

  return Number.isSafeInteger(cents) ? cents : null;
}

export function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function auditActor(context: AuthorizationContext): string {
  return String(context.userId);
}

export function handleError(res: Response, error: unknown): void {
  const err = error as {
    code?: string;
    cause?: { code?: string };
  };

  const code = err?.code ?? err?.cause?.code;

  if (code === '23505') {
    res.status(409).json({
      error: 'CONFLICT',
      message: 'A record with one of these unique values already exists.',
    });
    return;
  }

  if (code === '23503') {
    res.status(400).json({
      error: 'INVALID_REFERENCE',
      message: 'A referenced record does not exist.',
    });
    return;
  }

  console.error('Platform route error:', error);

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'The request could not be completed.',
  });
}
