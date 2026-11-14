import { z } from 'zod';

import { idParamSchema, triStateOptionalText, trimmedTextOrUndefined } from './common.schema.ts';

export interface CreateTenantValidated {
  name: string;
  slug: string;
  domain?: string;
  logoUrl?: string;
  brandColor?: string;
  contactEmail?: string;
  contactPhone?: string;
  currency: string;
  timezone: string;
}

export interface UpdateTenantValidated {
  name?: string;
  slug?: string;
  domain?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  currency?: string;
  timezone?: string;
  isActive?: boolean;
}

export function slugFromTenantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const VALID_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const tenantIdParamSchema = idParamSchema('Invalid tenant ID.');

export const createTenantSchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): CreateTenantValidated => {
    const name = trimmedTextOrUndefined(body.name);
    const suppliedSlug = trimmedTextOrUndefined(body.slug);
    const slug = (suppliedSlug ?? (name ? slugFromTenantName(name) : undefined))?.toLowerCase();

    if (!name || name.length > 200 || !slug || !VALID_SLUG_RE.test(slug)) {
      ctx.addIssue({
        code: 'custom',
        path: !name || name.length > 200 ? ['name'] : ['slug'],
        message: 'Provide a valid tenant name and slug.',
      });
      return z.NEVER;
    }

    const contactEmail = trimmedTextOrUndefined(body.contactEmail);
    if (contactEmail && !VALID_EMAIL_RE.test(contactEmail)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactEmail'],
        message: 'Provide a valid contact email.',
      });
      return z.NEVER;
    }

    const currency = trimmedTextOrUndefined(body.currency) ?? 'KES';
    if (!/^[A-Z]{3}$/.test(currency)) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency must be a three-letter code such as KES.',
      });
      return z.NEVER;
    }

    const timezone = trimmedTextOrUndefined(body.timezone) ?? 'Africa/Nairobi';
    if (timezone.length > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['timezone'],
        message: 'Timezone is too long.',
      });
      return z.NEVER;
    }

    const domain = trimmedTextOrUndefined(body.domain);
    const logoUrl = trimmedTextOrUndefined(body.logoUrl);
    if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['logoUrl'],
        message: 'Logo URL must be a valid HTTP or HTTPS URL.',
      });
      return z.NEVER;
    }
    const brandColor = trimmedTextOrUndefined(body.brandColor);
    const contactPhone = trimmedTextOrUndefined(body.contactPhone);

    return {
      name,
      slug,
      ...(domain ? { domain } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(brandColor ? { brandColor } : {}),
      ...(contactEmail ? { contactEmail } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      currency,
      timezone,
    };
  });

export const updateTenantSchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): UpdateTenantValidated => {
    const updates: UpdateTenantValidated = {};

    if ('name' in body) {
      const name = trimmedTextOrUndefined(body.name);
      if (!name || name.length > 200) {
        ctx.addIssue({
          code: 'custom',
          path: ['name'],
          message: 'Tenant name is invalid.',
        });
        return z.NEVER;
      }
      updates.name = name;
    }

    if ('slug' in body) {
      const slug = trimmedTextOrUndefined(body.slug)?.toLowerCase();
      if (!slug || !VALID_SLUG_RE.test(slug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['slug'],
          message: 'Tenant slug is invalid.',
        });
        return z.NEVER;
      }
      updates.slug = slug;
    }

    for (const key of ['domain', 'logoUrl', 'brandColor', 'contactPhone'] as const) {
      const value = triStateOptionalText(body, key);
      if (value === undefined) continue;
      updates[key] = value;
    }

    if ('contactEmail' in body) {
      const email = triStateOptionalText(body, 'contactEmail');
      if (email === undefined && body.contactEmail !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['contactEmail'],
          message: 'Contact email must be a valid string or null.',
        });
        return z.NEVER;
      }
      if (email && !VALID_EMAIL_RE.test(email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contactEmail'],
          message: 'Contact email is invalid.',
        });
        return z.NEVER;
      }
      if (email !== undefined) {
        updates.contactEmail = email;
      }
    }

    if ('currency' in body) {
      const currency = trimmedTextOrUndefined(body.currency);
      if (!currency || !/^[A-Z]{3}$/.test(currency)) {
        ctx.addIssue({
          code: 'custom',
          path: ['currency'],
          message: 'Currency must be a three-letter code such as KES.',
        });
        return z.NEVER;
      }
      updates.currency = currency;
    }

    if ('timezone' in body) {
      const timezone = trimmedTextOrUndefined(body.timezone);
      if (!timezone || timezone.length > 100) {
        ctx.addIssue({
          code: 'custom',
          path: ['timezone'],
          message: 'Timezone is invalid.',
        });
        return z.NEVER;
      }
      updates.timezone = timezone;
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
