/**
 * Platform payload validation.
 *
 * These rules lived inside request handlers, behind authentication and a
 * live database, so the only way to check one was to start the app and send
 * a request. That is why several of the cases below — a body that is a
 * string rather than an object, a whitespace-only name, an empty string
 * versus an explicit null — had never been checked at all.
 *
 * They were moved into `src/routes/platform/validation.ts` without changing
 * which requests are accepted. The tests exist to hold that claim: if a
 * later edit makes a boundary stricter or looser, one of these fails.
 */

import { describe, expect, it } from 'vitest';

import {
  FACILITY_TEXT_FIELDS,
  bodyOf,
  parseFacilityUpdate,
  parseTenantInput,
  slugFromName,
} from '../../routes/platform/validation.ts';

/** Unwrap a successful parse, failing loudly with the message otherwise. */
function accepted<T>(result: { ok: boolean; value?: T; message?: string }): T {
  if (!result.ok) throw new Error(`expected acceptance, got: ${result.message}`);

  return result.value as T;
}

const rejection = (result: { ok: boolean; message?: string }): string => {
  expect(result.ok, 'expected a rejection').toBe(false);

  return result.message as string;
};

describe('bodyOf', () => {
  it('returns an object for a JSON body', () => {
    expect(bodyOf({ body: { name: 'Nyeri' } } as never)).toStrictEqual({ name: 'Nyeri' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'name=Nyeri'],
    ['an array', [{ name: 'Nyeri' }]],
    ['a number', 42],
  ])('treats %s as an empty body', (_label, body) => {
    expect(bodyOf({ body } as never)).toStrictEqual({});
  });
});

describe('slugFromName', () => {
  it.each([
    ['Nyeri County Referral', 'nyeri-county-referral'],
    ['  Kericho  ', 'kericho'],
    ['A/B--C', 'a-b-c'],
    ['Ophthalmology Dept.', 'ophthalmology-dept'],
    ['St. Mary"s Mission', 'st-mary-s-mission'],
  ])('turns %s into %s', (name, expected) => {
    expect(slugFromName(name)).toBe(expected);
  });

  it('produces an empty string for a name with no alphanumerics', () => {
    /* Not itself an error — but `validSlug` rejects '' so tenant creation
       still fails, which is the behaviour that matters. */
    expect(slugFromName('///')).toBe('');
  });
});

describe('parseTenantInput', () => {
  it('accepts a minimal body and applies the documented defaults', () => {
    const tenant = accepted(parseTenantInput({ name: 'Nyeri Referral' }));

    expect(tenant).toStrictEqual({
      name: 'Nyeri Referral',
      slug: 'nyeri-referral',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
    });
  });

  it('prefers a supplied slug and normalises its case', () => {
    const tenant = accepted(parseTenantInput({ name: 'Nyeri', slug: 'NYERI-Main' }));

    expect(tenant.slug).toBe('nyeri-main');
  });

  it('trims surrounding whitespace from text fields', () => {
    const tenant = accepted(parseTenantInput({ name: '  Nyeri  ', domain: ' nyeri.test ' }));

    expect(tenant.name).toBe('Nyeri');
    expect(tenant.domain).toBe('nyeri.test');
  });

  it('omits optional fields that were not supplied', () => {
    const tenant = accepted(parseTenantInput({ name: 'Nyeri' }));

    /* Omitted, not present-and-undefined: the insert sends only the columns
       the caller supplied. */
    expect('domain' in tenant).toBe(false);
    expect('contactEmail' in tenant).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(rejection(parseTenantInput({}))).toBe('Provide a valid tenant name and slug.');
  });

  it('rejects a blank name', () => {
    expect(rejection(parseTenantInput({ name: '   ' }))).toBe(
      'Provide a valid tenant name and slug.',
    );
  });

  it('rejects a name over 200 characters', () => {
    expect(rejection(parseTenantInput({ name: 'a'.repeat(201) }))).toBe(
      'Provide a valid tenant name and slug.',
    );
  });

  it('accepts a name of exactly 200 characters', () => {
    expect(accepted(parseTenantInput({ name: 'a'.repeat(200) })).name).toHaveLength(200);
  });

  it('rejects a name that yields no usable slug', () => {
    expect(rejection(parseTenantInput({ name: '///' }))).toBe(
      'Provide a valid tenant name and slug.',
    );
  });

  it.each(['Nyeri Main', '-nyeri', 'nyeri-', 'nyeri--main', 'nyeri_main'])(
    'rejects the malformed slug %s',
    (slug) => {
      expect(rejection(parseTenantInput({ name: 'Nyeri', slug }))).toBe(
        'Provide a valid tenant name and slug.',
      );
    },
  );

  it('rejects a malformed contact email', () => {
    expect(rejection(parseTenantInput({ name: 'Nyeri', contactEmail: 'not-an-email' }))).toBe(
      'Provide a valid contact email.',
    );
  });

  it('accepts an absent contact email', () => {
    expect('contactEmail' in accepted(parseTenantInput({ name: 'Nyeri' }))).toBe(false);
  });

  it('rejects a lowercase currency rather than silently upper-casing it', () => {
    /* The handler in main rejected 'kes'; a validation layer that quietly
       accepted it would be a behaviour change dressed up as a refactor. */
    expect(rejection(parseTenantInput({ name: 'Nyeri', currency: 'kes' }))).toBe(
      'Currency must be a three-letter code such as KES.',
    );
  });

  it.each(['K', 'KESS', 'KE1'])('rejects the currency %s', (currency) => {
    expect(parseTenantInput({ name: 'Nyeri', currency }).ok).toBe(false);
  });

  it('treats an empty currency as absent and defaults to KES', () => {
    /* Pinned because it looks like a bug and is not: `textValue` maps '' to
       undefined, so the `?? 'KES'` default applies. Same before and after
       the extraction, and a phone form posting an untouched currency
       select depends on it. */
    expect(accepted(parseTenantInput({ name: 'Nyeri', currency: '' })).currency).toBe('KES');
  });

  it('accepts any three-letter uppercase currency', () => {
    expect(accepted(parseTenantInput({ name: 'Nyeri', currency: 'UGX' })).currency).toBe('UGX');
  });

  it('rejects a timezone over 100 characters', () => {
    expect(rejection(parseTenantInput({ name: 'Nyeri', timezone: 'A'.repeat(101) }))).toBe(
      'Timezone is too long.',
    );
  });

  it('accepts a timezone of exactly 100 characters', () => {
    expect(
      accepted(parseTenantInput({ name: 'Nyeri', timezone: 'A'.repeat(100) })).timezone,
    ).toHaveLength(100);
  });

  it('ignores non-string field types instead of throwing', () => {
    /* A JSON body can put anything here. The old inline code would have hit
       `.trim()` on a number had `textValue` not guarded it. */
    const result = parseTenantInput({ name: 'Nyeri', domain: 42, contactEmail: null });

    expect(accepted(result).name).toBe('Nyeri');
  });

  it('never repeats the submitted value in a rejection message', () => {
    /* A reflection of input into an error the client renders, or into a
       log line, is how a contact address ends up somewhere it should not.
       Checked against the field most likely to carry personal data. */
    const secret = 'attacker-controlled-value';
    const message = rejection(parseTenantInput({ name: secret, contactEmail: secret }));

    expect(message).not.toContain(secret);
  });
});

describe('parseFacilityUpdate', () => {
  it('accepts every text field the handler reads', () => {
    const body: Record<string, string> = Object.fromEntries(
      FACILITY_TEXT_FIELDS.map((key) => [key, `${key}-value`]),
    );

    /* Email is the one text field with a format check, so a placeholder
       would be rejected for the wrong reason. */
    body.email = 'facility@example.test';

    const update = accepted(parseFacilityUpdate(body));

    for (const key of FACILITY_TEXT_FIELDS) {
      expect(update[key], key).toBe(body[key]);
    }
  });

  it('rejects an empty body so a no-op update cannot report success', () => {
    expect(rejection(parseFacilityUpdate({}))).toBe('No valid fields supplied to update.');
  });

  it('ignores keys the handler does not know', () => {
    expect(rejection(parseFacilityUpdate({ status: 'active', ownership: 'county' }))).toBe(
      'No valid fields supplied to update.',
    );
  });

  it('rejects a non-string, non-null value', () => {
    expect(rejection(parseFacilityUpdate({ name: 42 }))).toBe('name must be a string or null.');
  });

  it('rejects a blank name rather than clearing it', () => {
    expect(rejection(parseFacilityUpdate({ name: '   ' }))).toBe('name must be a string or null.');
  });

  it('rejects a name over 200 characters', () => {
    expect(rejection(parseFacilityUpdate({ name: 'a'.repeat(201) }))).toBe(
      'Facility name is required and must not exceed 200 characters.',
    );
  });

  it('rejects a code over 80 characters', () => {
    expect(rejection(parseFacilityUpdate({ code: 'a'.repeat(81) }))).toBe(
      'Facility code is required and must not exceed 80 characters.',
    );
  });

  it('accepts a code of exactly 80 characters', () => {
    expect(accepted(parseFacilityUpdate({ code: 'a'.repeat(80) })).code).toHaveLength(80);
  });

  it('rejects a malformed email', () => {
    expect(rejection(parseFacilityUpdate({ email: 'nope' }))).toBe('Facility email is invalid.');
  });

  it('clears the four nullable columns with null', () => {
    const update = accepted(
      parseFacilityUpdate({ mflCode: null, address: null, phone: null, email: null }),
    );

    expect(update).toStrictEqual({ mflCode: null, address: null, phone: null, email: null });
  });

  it('clears them with an empty string too', () => {
    /* `optionalText` treats '' as null, so the two arrive here alike. */
    expect(accepted(parseFacilityUpdate({ address: '' }))).toStrictEqual({ address: null });
  });

  it.each(['level', 'county', 'subCounty'] as const)('refuses to clear %s with null', (key) => {
    expect(rejection(parseFacilityUpdate({ [key]: null }))).toBe(`${key} cannot be empty.`);
  });

  it.each([
    ['code', 'Facility code is required and must not exceed 80 characters.'],
    ['name', 'Facility name is required and must not exceed 200 characters.'],
  ] as const)('refuses to clear %s with null', (key, message) => {
    /* These two hit the required-field check before the null branch, so the
       message names the field rather than saying "cannot be empty". The
       ordering is inherited, not chosen here - see the note at the top of
       the module about not changing which requests are accepted. */
    expect(rejection(parseFacilityUpdate({ [key]: null }))).toBe(message);
  });

  it('de-duplicates and trims enabledModules', () => {
    const update = accepted(parseFacilityUpdate({ enabledModules: [' opd ', 'opd', 'lab'] }));

    expect(update.enabledModules).toStrictEqual(['opd', 'lab']);
  });

  it.each([
    ['a string', 'opd'],
    ['a number', 3],
    ['an object', { opd: true }],
  ])('rejects enabledModules given as %s', (_label, value) => {
    expect(rejection(parseFacilityUpdate({ enabledModules: value }))).toBe(
      'enabledModules must be an array of non-empty strings.',
    );
  });

  it('rejects enabledModules containing a blank entry', () => {
    /* A whitespace-only entry trims to '', so it fails the same check as
       any other bad element - one message covers the whole array. */
    expect(rejection(parseFacilityUpdate({ enabledModules: ['opd', '   '] }))).toBe(
      'enabledModules must be an array of non-empty strings.',
    );
  });

  it('rejects enabledModules containing a non-string', () => {
    expect(parseFacilityUpdate({ enabledModules: ['opd', 7] }).ok).toBe(false);
  });

  it('rejects an enabledModules entry over 80 characters', () => {
    expect(parseFacilityUpdate({ enabledModules: ['a'.repeat(81)] }).ok).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('accepts isActive %s', (_label, value) => {
    expect(accepted(parseFacilityUpdate({ isActive: value }))).toStrictEqual({ isActive: value });
  });

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
  ])('rejects isActive given as %s', (_label, value) => {
    expect(rejection(parseFacilityUpdate({ isActive: value }))).toBe(
      'isActive must be true or false.',
    );
  });

  it('keeps only the keys that were supplied', () => {
    const update = accepted(parseFacilityUpdate({ name: 'Nyeri', isActive: false }));

    expect(Object.keys(update).sort()).toStrictEqual(['isActive', 'name']);
  });
});
