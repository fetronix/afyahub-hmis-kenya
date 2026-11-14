import 'dotenv/config';

/**
 * The timezone the deployment runs in.
 *
 * `TZ` is the variable Node itself honours: set it and `Date#getHours`,
 * `toLocaleString` without an explicit zone, and the default `Intl`
 * formatter all follow it. It must therefore be applied to the *process*
 * before any date is formatted, which is why this lives beside `env.ts`
 * and is called from `server.ts` rather than threaded through every
 * formatter.
 *
 * `DEFAULT_TIMEZONE` is the name this project has always documented
 * (`docs/deployment/truehost-cpanel.md` §5, `.env.example`). Until now
 * nothing read it: an operator could set `DEFAULT_TIMEZONE=Pacific/Auckland`
 * and every timestamp would still print in Nairobi time. Rather than delete
 * a documented setting and surprise anyone who set it, the two names are now
 * reconciled: `DEFAULT_TIMEZONE` wins when both are present, because it is
 * the more specific statement about this application, and the value is
 * written into `process.env.TZ` so it actually takes effect.
 *
 * Both names remaining is deliberate. `TZ` is still the escape hatch for a
 * host that sets it globally.
 */

export interface TimezoneResolution {
  /** The zone in force after this call. */
  timezone: string;
  /** Which variable supplied it, or `null` if neither did. */
  source: 'DEFAULT_TIMEZONE' | 'TZ' | null;
  /** A non-empty message when a configured value was rejected. */
  warning: string | null;
}

/**
 * A zone name is valid if `Intl` accepts it. This is the same parser that
 * will format the dates, so it is the only check that matters — a hand
 * written regex over `Region/City` would accept retired aliases and reject
 * legitimate ones.
 *
 * An invalid zone throws `RangeError`; an invalid *shape* throws `TypeError`.
 * Both mean "this deployment would print nonsense", so both are rejected.
 */
function isValidTimezone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

function read(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Apply the configured timezone to the process.
 *
 * Never throws: a bad timezone name is a configuration mistake that should be
 * visible and loud, but refusing to boot a hospital's system over a display
 * setting is worse than booting with a warning and the host default. The
 * warning is returned as well as logged so it can be asserted in tests.
 */
export function applyDefaultTimezone(
  env: NodeJS.ProcessEnv = process.env,
  log: Pick<Console, 'warn'> = console,
): TimezoneResolution {
  const configured = read(env, 'DEFAULT_TIMEZONE');
  const fallback = read(env, 'TZ');
  const source = configured !== null ? 'DEFAULT_TIMEZONE' : fallback !== null ? 'TZ' : null;
  const candidate = configured ?? fallback;

  if (candidate === null) {
    // Node's default is the host's zone. Saying so once at boot is cheaper
    // than explaining a three-hour offset in a support ticket later.
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: null,
      warning: null,
    };
  }

  if (!isValidTimezone(candidate)) {
    const warning = `${source} is not a valid IANA timezone: "${candidate}". Keeping the host timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Fix it in the environment panel; timestamps will otherwise not match the facility clock.`;
    log.warn(warning);
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: null,
      warning,
    };
  }

  env.TZ = candidate;

  return { timezone: candidate, source, warning: null };
}
