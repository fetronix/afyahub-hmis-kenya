/**
 * Validation for platform-administration payloads.
 *
 * The handlers in this folder validated as they went: read a field, check
 * it, respond 400, read the next field. That works, and the messages are
 * good, but the rules were only reachable through a request that had
 * already passed authentication and reached a live database. None could be
 * tested on their own.
 *
 * Each parser here takes the raw request body — which is `unknown` in every
 * sense that matters, it may be JSON, a form post, a string, or absent —
 * and returns either the fields the handler needs, trimmed and defaulted,
 * or a message describing the first thing wrong with it.
 *
 * THE CONTRACT IS THE HANDLER'S, NOT THIS FILE'S
 *
 * These parsers were written by reading the handlers and reproducing their
 * decisions, not by designing what the fields ought to be. A validation
 * layer that quietly changes which requests are accepted is worse than no
 * validation layer: it turns a refactor into a behaviour change that no
 * test was ever written for.
 *
 * So, deliberately: the field names are exactly the ones the handlers read
 * (`mflCode`, `isActive`, `enabledModules` — not `status` or `code`), the
 * boundaries are the same numbers, `null` clears only the four columns that
 * were nullable before, and every rejection message is the original
 * string. `validation.spec.ts` pins all of it so the two cannot drift.
 *
 * Two rules govern the file:
 *
 *   1. No side effects and no I/O. A parser cannot query, log or respond,
 *      so it can be tested exhaustively without PostgreSQL.
 *   2. Messages are written for a person and never echo the submitted
 *      value back. A rejection that repeats input can reflect an
 *      attacker-supplied string into an error the client renders, and for
 *      a contact address it can leak it into logs.
 *
 * The helpers next door are shared with handlers that have not been
 * converted yet, so they are used here rather than reimplemented.
 */

import { optionalText, textValue, validEmail, validSlug, type PlatformRequest } from './shared.ts';

export type ParseFailure = { ok: false; message: string };
export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

const fail = (message: string): ParseFailure => ({ ok: false, message });

/**
 * The request body, defensively.
 *
 * `express.json()` leaves `req.body` undefined when the content type is not
 * JSON. Handlers that index into it then throw a TypeError and return 500
 * for what is really a malformed request.
 */
export function bodyOf(req: PlatformRequest): Record<string, unknown> {
  const body = req.body;

  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/* ------------------------------------------------------------------
   Tenants
   ------------------------------------------------------------------ */

export type TenantInput = {
  name: string;
  slug: string;
  domain?: string;
  logoUrl?: string;
  brandColor?: string;
  contactEmail?: string;
  contactPhone?: string;
  currency: string;
  timezone: string;
};

/**
 * Derive a slug from a name, for callers that do not supply one.
 *
 * "Nyeri County Referral" becomes "nyeri-county-referral". Anything outside
 * a-z0-9 becomes a hyphen, runs collapse and the ends are trimmed — the
 * result is then checked by `validSlug` like any supplied value, so a name
 * of only punctuation is rejected rather than silently becoming an empty
 * slug.
 */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseTenantInput(body: Record<string, unknown>): ParseResult<TenantInput> {
  const name = textValue(body.name);
  const suppliedSlug = textValue(body.slug);
  const slug = (suppliedSlug ?? (name ? slugFromName(name) : undefined))?.toLowerCase();

  if (!name || name.length > 200 || !slug || !validSlug(slug)) {
    return fail('Provide a valid tenant name and slug.');
  }

  const contactEmail = textValue(body.contactEmail);

  if (contactEmail && !validEmail(contactEmail)) {
    return fail('Provide a valid contact email.');
  }

  /* No `.toUpperCase()` on currency: a lowercase code was rejected before
     and is still rejected. Silently accepting it here would be a change in
     what the API accepts, which is not this refactor's business. */
  const currency = textValue(body.currency) ?? 'KES';

  if (!/^[A-Z]{3}$/.test(currency)) {
    return fail('Currency must be a three-letter code such as KES.');
  }

  const timezone = textValue(body.timezone) ?? 'Africa/Nairobi';

  if (timezone.length > 100) {
    return fail('Timezone is too long.');
  }

  const domain = textValue(body.domain);
  const logoUrl = textValue(body.logoUrl);
  const brandColor = textValue(body.brandColor);
  const contactPhone = textValue(body.contactPhone);

  /* Optional fields are omitted rather than set to undefined, so the insert
     sends exactly the columns the caller supplied. */
  return {
    ok: true,
    value: {
      name,
      slug,
      ...(domain ? { domain } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(brandColor ? { brandColor } : {}),
      ...(contactEmail ? { contactEmail } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      currency,
      timezone,
    },
  };
}

/* ------------------------------------------------------------------
   Facilities
   ------------------------------------------------------------------ */

/** The text columns `PATCH /facilities/:id` reads, in the order it reads them. */
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

/** Columns that may be set to null to clear them. */
export const FACILITY_NULLABLE_FIELDS: ReadonlySet<FacilityTextField> = new Set([
  'mflCode',
  'address',
  'phone',
  'email',
]);

export type FacilityUpdateInput = {
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
  isActive?: boolean;
};

/**
 * Validate a facility update.
 *
 * Backs a PATCH, so every field is optional — but at least one must be
 * present, otherwise the request is a no-op that reports success and writes
 * an audit entry for nothing.
 *
 * Three states matter. `undefined` means "not supplied, leave it alone",
 * `null` means "clear it", and a string means "set it". `optionalText`
 * already draws exactly that line, which is why it is reused rather than
 * approximated.
 */
export function parseFacilityUpdate(
  body: Record<string, unknown>,
): ParseResult<FacilityUpdateInput> {
  const updates: FacilityUpdateInput = {};

  for (const key of FACILITY_TEXT_FIELDS) {
    if (!(key in body)) continue;

    const value = optionalText(body, key);

    if (value === undefined) {
      return fail(`${key} must be a string or null.`);
    }

    if (key === 'code' && (!value || value.length > 80)) {
      return fail('Facility code is required and must not exceed 80 characters.');
    }

    if (key === 'name' && (!value || value.length > 200)) {
      return fail('Facility name is required and must not exceed 200 characters.');
    }

    if (key === 'email' && value && !validEmail(value)) {
      return fail('Facility email is invalid.');
    }

    /* The update is a partial record, so a computed key assignment needs the
       value widened to the union every text column accepts. The set above
       has already established that null is legal for this key. */
    const writable = updates as Record<FacilityTextField, string | null>;

    if (value === null) {
      if (!FACILITY_NULLABLE_FIELDS.has(key)) {
        return fail(`${key} cannot be empty.`);
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
      return fail('enabledModules must be an array of non-empty strings.');
    }

    updates.enabledModules = [...new Set(modules.map((item) => item.trim()))];
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      return fail('isActive must be true or false.');
    }

    updates.isActive = body.isActive;
  }

  if (Object.keys(updates).length === 0) {
    return fail('No valid fields supplied to update.');
  }

  return { ok: true, value: updates };
}
