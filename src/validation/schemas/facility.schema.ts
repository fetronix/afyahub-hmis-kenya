import { z } from 'zod';

import { resolveLocation } from '../../constants/kenya-locations.ts';
import {
  idParamSchema,
  parsePositiveIntValue,
  triStateOptionalText,
  trimmedTextOrUndefined,
} from './common.schema.ts';

const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FACILITY_TEXT_FIELDS = [
  'code',
  'name',
  'level',
  'county',
  'subCounty',
  'mflCode',
  'address',
  'phone',
  'email',
] as const;

export type FacilityTextField = (typeof FACILITY_TEXT_FIELDS)[number];

export const FACILITY_NULLABLE_FIELDS: ReadonlySet<FacilityTextField> = new Set([
  'mflCode',
  'address',
  'phone',
  'email',
]);

export interface CreateFacilityValidated {
  tenantId: number;
  code: string;
  name: string;
  level?: string;
  county?: string | null;
  subCounty?: string | null;
  hasCountySelection: boolean;
  mflCode?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface UpdateFacilityValidated {
  code?: string;
  name?: string;
  level?: string;
  county?: string;
  subCounty?: string;
  mflCode?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  enabledModules?: string[];
  hiddenModules?: string[];
  isActive?: boolean;
}

export interface CreateFacilityAdminInvitationValidated {
  facilityId: number;
  fullName: string;
  email: string;
  phone?: string;
}

export const facilityIdParamSchema = idParamSchema('Invalid facility ID.');
export const invitationIdParamSchema = idParamSchema('Invalid invitation ID.');

export const createFacilitySchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): CreateFacilityValidated => {
    const tenantId = parsePositiveIntValue(body.tenantId);
    const code = trimmedTextOrUndefined(body.code)?.toUpperCase();
    const name = trimmedTextOrUndefined(body.name);

    if (
      tenantId === null ||
      !code ||
      !/^[A-Z0-9_-]{2,50}$/.test(code) ||
      !name ||
      name.length > 200
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Provide a valid tenantId, facility code, and facility name.',
      });
      return z.NEVER;
    }

    const email = trimmedTextOrUndefined(body.email);
    if (email && !VALID_EMAIL_RE.test(email)) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Facility email is invalid.',
      });
      return z.NEVER;
    }

    const location = resolveLocation(
      trimmedTextOrUndefined(body.county),
      trimmedTextOrUndefined(body.subCounty),
    );
    if (!location.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['subCounty'],
        message: location.message,
      });
      return z.NEVER;
    }

    const level = trimmedTextOrUndefined(body.level);
    const mflCode = trimmedTextOrUndefined(body.mflCode);
    const address = trimmedTextOrUndefined(body.address);
    const phone = trimmedTextOrUndefined(body.phone);

    return {
      tenantId,
      code,
      name,
      ...(level ? { level } : {}),
      hasCountySelection: Boolean(location.county),
      ...(location.county ? { county: location.county, subCounty: location.subCounty } : {}),
      ...(mflCode ? { mflCode } : {}),
      ...(address ? { address } : {}),
      ...(phone ? { phone } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
    };
  });

export const updateFacilitySchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): UpdateFacilityValidated => {
    if ('tenantId' in body || 'tenant_id' in body) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenantId'],
        message: 'Facility tenant cannot be reassigned.',
      });
      return z.NEVER;
    }

    const updates: UpdateFacilityValidated = {};

    for (const key of FACILITY_TEXT_FIELDS) {
      if (!(key in body)) continue;

      const value = triStateOptionalText(body, key);
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be a string or null.`,
        });
        return z.NEVER;
      }

      if (key === 'code' && (!value || value.length > 80)) {
        ctx.addIssue({
          code: 'custom',
          path: ['code'],
          message: 'Facility code is required and must not exceed 80 characters.',
        });
        return z.NEVER;
      }

      if (key === 'name' && (!value || value.length > 200)) {
        ctx.addIssue({
          code: 'custom',
          path: ['name'],
          message: 'Facility name is required and must not exceed 200 characters.',
        });
        return z.NEVER;
      }

      if (key === 'email' && value && !VALID_EMAIL_RE.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'Facility email is invalid.',
        });
        return z.NEVER;
      }

      const writable = updates as Record<FacilityTextField, string | null>;
      if (value === null) {
        if (!FACILITY_NULLABLE_FIELDS.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} cannot be empty.`,
          });
          return z.NEVER;
        }
        writable[key] = null;
        continue;
      }

      writable[key] = value;
    }

    if ('enabledModules' in body) {
      const modules = body.enabledModules;
      if (
        !Array.isArray(modules) ||
        !modules.every(
          (item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 80,
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['enabledModules'],
          message: 'enabledModules must be an array of non-empty strings.',
        });
        return z.NEVER;
      }
      updates.enabledModules = [...new Set(modules.map((item) => item.trim()))];
    }

    if ('hiddenModules' in body) {
      const hidden = body.hiddenModules;
      if (
        !Array.isArray(hidden) ||
        !hidden.every(
          (item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 80,
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['hiddenModules'],
          message: 'hiddenModules must be an array of non-empty strings.',
        });
        return z.NEVER;
      }
      updates.hiddenModules = [...new Set(hidden.map((item) => item.trim()))];
    }

    if ('clinicalProtocols' in body) {
      ctx.addIssue({
        code: 'custom',
        path: ['clinicalProtocols'],
        message: 'Clinical protocols require a separately authorized clinical workflow.',
      });
      return z.NEVER;
    }

    if ('isActive' in body) {
      if (typeof body.isActive !== 'boolean') {
        ctx.addIssue({
          code: 'custom',
          path: ['isActive'],
          message: 'isActive must be true or false.',
        });
        return z.NEVER;
      }
      updates.isActive = body.isActive;
    }

    if (updates.county && updates.subCounty) {
      const location = resolveLocation(updates.county, updates.subCounty);
      if (!location.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['subCounty'],
          message: location.message,
        });
        return z.NEVER;
      }
    }

    if (Object.keys(updates).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'No valid fields supplied to update.',
      });
      return z.NEVER;
    }

    return updates;
  });

export const updateFacilityModulesSchema = z.object({
  enabledModules: z
    .array(z.string().trim().min(1).max(80), {
      message: 'enabledModules must be an array of module identifiers.',
    })
    .max(50, 'enabledModules exceeds the maximum module count.'),
});

export const createFacilityAdminInvitationSchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): CreateFacilityAdminInvitationValidated => {
    const facilityId = parsePositiveIntValue(body.facilityId);
    const fullName = trimmedTextOrUndefined(body.fullName);
    const email = trimmedTextOrUndefined(body.email)?.toLowerCase();
    const phone = trimmedTextOrUndefined(body.phone);

    if (
      facilityId === null ||
      !fullName ||
      fullName.length > 200 ||
      !email ||
      email.length > 254 ||
      !VALID_EMAIL_RE.test(email)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Provide a valid facilityId, fullName, and email.',
      });
      return z.NEVER;
    }

    return {
      facilityId,
      fullName,
      email,
      ...(phone ? { phone } : {}),
    };
  });
