/**
 * The timezone setting has to do something.
 *
 * `docs/deployment/truehost-cpanel.md` §5 tells an operator to set
 * `DEFAULT_TIMEZONE=Africa/Nairobi`. For a long time nothing read that
 * variable, so the instruction was decorative: the value was accepted, echoed
 * nowhere, and every timestamp silently used the host's zone. These tests pin
 * the fix — a configured zone is validated and written to `process.env.TZ`,
 * and an invalid one is refused loudly instead of being half-applied.
 */

import { describe, expect, it } from 'vitest';

import { applyDefaultTimezone } from '../../config/timezone';

const quiet = { warn: () => {} };

describe('default timezone', () => {
  it('applies DEFAULT_TIMEZONE to the process environment', () => {
    const env: NodeJS.ProcessEnv = { DEFAULT_TIMEZONE: 'Pacific/Auckland' };

    const result = applyDefaultTimezone(env, quiet);

    expect(result).toMatchObject({
      timezone: 'Pacific/Auckland',
      source: 'DEFAULT_TIMEZONE',
      warning: null,
    });
    // The assertion that matters: Node reads TZ, not our private name.
    expect(env.TZ).toBe('Pacific/Auckland');
  });

  it('prefers DEFAULT_TIMEZONE over a host-provided TZ', () => {
    const env: NodeJS.ProcessEnv = { TZ: 'UTC', DEFAULT_TIMEZONE: 'Africa/Nairobi' };

    const result = applyDefaultTimezone(env, quiet);

    expect(result.source).toBe('DEFAULT_TIMEZONE');
    expect(env.TZ).toBe('Africa/Nairobi');
  });

  it('leaves a host-provided TZ alone when the application name is unset', () => {
    const env: NodeJS.ProcessEnv = { TZ: 'Europe/London' };

    const result = applyDefaultTimezone(env, quiet);

    expect(result).toMatchObject({ timezone: 'Europe/London', source: 'TZ' });
    expect(env.TZ).toBe('Europe/London');
  });

  it('reports the host zone when neither variable is set', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyDefaultTimezone(env, quiet);

    expect(result.source).toBeNull();
    expect(result.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(env.TZ).toBeUndefined();
  });

  it('refuses an invalid zone instead of writing it through', () => {
    const warnings: string[] = [];
    const env: NodeJS.ProcessEnv = { DEFAULT_TIMEZONE: 'Africa/Nairobia' };

    const result = applyDefaultTimezone(env, { warn: (m: string) => warnings.push(m) });

    expect(result.source).toBeNull();
    expect(result.warning).toContain('Africa/Nairobia');
    expect(warnings).toHaveLength(1);
    // A typo must not be installed as the process timezone: Node would then
    // fall back to UTC for every date in the system, which is the very thing
    // the operator was trying to prevent.
    expect(env.TZ).toBeUndefined();
  });

  it('treats a blank value as unset rather than as the zone ""', () => {
    const env: NodeJS.ProcessEnv = { DEFAULT_TIMEZONE: '   ', TZ: 'Africa/Nairobi' };

    const result = applyDefaultTimezone(env, quiet);

    expect(result.source).toBe('TZ');
    expect(result.timezone).toBe('Africa/Nairobi');
  });

  it('does not throw for malformed values, and rejects them all', () => {
    // `Intl` throws TypeError for some inputs and RangeError for others; the
    // caller must still get a warning, not a crash on boot.
    for (const bad of ['Nairobi', '25:00', 'UTC+3', 'Africa/Nairobia']) {
      const env: NodeJS.ProcessEnv = { DEFAULT_TIMEZONE: bad };
      expect(() => applyDefaultTimezone(env, quiet)).not.toThrow();
      expect(applyDefaultTimezone(env, quiet).warning).not.toBeNull();
      expect(env.TZ).toBeUndefined();
    }
  });

  it('accepts a fixed offset zone, because ICU does', () => {
    /*
     * `+03:00` has no IANA region name but is a valid zone to `Intl`, and
     * Kenya has no daylight saving, so an operator who writes it is not
     * making a mistake. The validation is "does the formatter accept it",
     * not "does it contain a slash" — a hand-written pattern here would
     * reject working configuration and accept retired aliases.
     */
    const env: NodeJS.ProcessEnv = { DEFAULT_TIMEZONE: '+03:00' };
    const result = applyDefaultTimezone(env, quiet);

    expect(result).toMatchObject({ timezone: '+03:00', source: 'DEFAULT_TIMEZONE', warning: null });
    expect(env.TZ).toBe('+03:00');
  });
});
