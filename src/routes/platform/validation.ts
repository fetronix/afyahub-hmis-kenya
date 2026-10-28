/**
 * Platform administration payload validation — backed by `src/validation/schemas/`
 * (Zod schemas), preserving the `ParseResult<T>` adapter for callers and specs.
 */

import type { PlatformRequest } from './shared.ts';
import {
  FACILITY_NULLABLE_FIELDS,
  FACILITY_TEXT_FIELDS,
  createTenantSchema,
  slugFromTenantName,
  updateFacilitySchema,
  type CreateTenantValidated,
  type FacilityTextField,
  type UpdateFacilityValidated,
} from '../../validation/schemas/index.ts';

export { FACILITY_NULLABLE_FIELDS, FACILITY_TEXT_FIELDS, type FacilityTextField };

export type ParseFailure = { ok: false; message: string };
export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

export type TenantInput = CreateTenantValidated;
export type FacilityUpdateInput = UpdateFacilityValidated;

export function bodyOf(req: PlatformRequest): Record<string, unknown> {
  const body = req.body;

  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export const slugFromName = slugFromTenantName;

export function parseTenantInput(body: Record<string, unknown>): ParseResult<TenantInput> {
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Provide a valid tenant name and slug.',
    };
  }
  return { ok: true, value: parsed.data };
}

export function parseFacilityUpdate(
  body: Record<string, unknown>,
): ParseResult<FacilityUpdateInput> {
  const parsed = updateFacilitySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'No valid fields supplied to update.',
    };
  }
  return { ok: true, value: parsed.data };
}
