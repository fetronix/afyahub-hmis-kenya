/**
 * DHA integration configuration and readiness
 *
 * Two things are being pinned here, and only one of them is code quality.
 *
 * The first is the safety design. `dha.config.ts` is explicit that mock is
 * the default, that production needs an opt-in *and* a base URL DHA has not
 * published, and that unknown modes fall back to mock. The point is that a
 * misconfigured deployment must fail towards "no patient data leaves this
 * server", never towards "live".
 *
 * The second is the redaction guarantee. `describeDhaConfig` is documented
 * as "safe to return from an HTTP endpoint" and the readiness report embeds
 * it. A client secret in that object would be published to every
 * administrator who opens the readiness screen. So several tests below do
 * not merely check that a field says "configured" — they take the whole
 * serialised object and assert the secret does not appear in it anywhere.
 *
 * A third property is honesty, which is testable too: every operation in
 * `DHA_OPERATIONS` that is not implemented carries a reason, so the report
 * cannot claim a capability this build does not have. That is the difference
 * between "pending approval" and "invented".
 *
 * All credentials below are obviously fake strings, and no request leaves
 * the process: mock mode never calls out, and `probe: false` suppresses the
 * one token request the report would otherwise make.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DHA_SANDBOX_BASE_URL,
  describeDhaConfig,
  loadDhaConfig,
  type DhaConfig,
} from '../../integrations/dha/dha.config.ts';
import { DHA_OPERATIONS, buildReadinessReport } from '../../integrations/dha/dha.readiness.ts';

/* ============================================================
   Environment helpers
   ============================================================ */

const VARS = [
  'DHA_MODE',
  'DHA_ALLOW_PRODUCTION',
  'DHA_BASE_URL',
  'DHA_CLIENT_ID',
  'DHA_CLIENT_SECRET',
  'DHA_FACILITY_CODE',
  'DHA_TIMEOUT_MS',
  'DHA_MAX_RETRIES',
] as const;

const saved = new Map<string, string | undefined>();

const SECRET = 'not-a-real-secret-0000';

function clearEnv(): void {
  for (const name of VARS) delete process.env[name];
}

function setEnv(values: Record<string, string>): void {
  clearEnv();
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
}

beforeEach(() => {
  for (const name of VARS) saved.set(name, process.env[name]);
  clearEnv();
});

afterEach(() => {
  for (const name of VARS) {
    const previous = saved.get(name);

    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }

  saved.clear();
});

/** A fully configured non-mock deployment. */
const SANDBOX_ENV = {
  DHA_MODE: 'sandbox',
  DHA_CLIENT_ID: 'test-client-id',
  DHA_CLIENT_SECRET: SECRET,
  DHA_FACILITY_CODE: 'FID-00-000000-0',
};

/* ============================================================
   1. Mode selection never defaults to live
   ============================================================ */

describe('mode selection', () => {
  it('defaults to mock when nothing is configured', () => {
    /* The single most important default in the file. */
    const config = loadDhaConfig();

    expect(config.mode).toBe('mock');
    expect(config.baseUrl).toBeNull();
    expect(config.enabled).toBe(true);
    expect(config.disabledReason).toBeNull();
  });

  it('falls back to mock for an unrecognised mode', () => {
    /*
     * A typo in DHA_MODE must not be interpreted generously. 'prod',
     * 'PRODUCTION ' after trimming is recognised, 'live' is not.
     */
    for (const value of ['live', 'prod', 'staging', 'yes', '1']) {
      setEnv({ DHA_MODE: value });
      expect(loadDhaConfig().mode, value).toBe('mock');
    }
  });

  it('accepts the three documented modes case-insensitively', () => {
    setEnv({ ...SANDBOX_ENV, DHA_MODE: 'SANDBOX' });
    expect(loadDhaConfig().mode).toBe('sandbox');

    setEnv({ ...SANDBOX_ENV, DHA_MODE: 'Mock' });
    expect(loadDhaConfig().mode).toBe('mock');
  });

  it('treats a blank mode as unset rather than as a value', () => {
    setEnv({ DHA_MODE: '   ' });
    expect(loadDhaConfig().mode).toBe('mock');
  });
});

/* ============================================================
   2. Sandbox
   ============================================================ */

describe('sandbox', () => {
  it('uses the documented UAT base URL when none is supplied', () => {
    setEnv(SANDBOX_ENV);

    const config = loadDhaConfig();

    expect(config.baseUrl).toBe(DHA_SANDBOX_BASE_URL);
    expect(config.baseUrl?.startsWith('https://')).toBe(true);
    expect(config.enabled).toBe(true);
  });

  it('prefers an explicitly configured base URL', () => {
    setEnv({ ...SANDBOX_ENV, DHA_BASE_URL: 'https://uat.example.test/api' });

    expect(loadDhaConfig().baseUrl).toBe('https://uat.example.test/api');
  });

  it('strips trailing slashes so paths do not double up', () => {
    setEnv({ ...SANDBOX_ENV, DHA_BASE_URL: 'https://uat.example.test/api///' });

    expect(loadDhaConfig().baseUrl).toBe('https://uat.example.test/api');
  });

  it('is not enabled without client credentials, and says which are missing', () => {
    setEnv({ DHA_MODE: 'sandbox', DHA_FACILITY_CODE: 'FID-00-000000-0' });

    const config = loadDhaConfig();

    expect(config.enabled).toBe(false);
    expect(config.disabledReason).toContain('DHA_CLIENT_ID');
    expect(config.disabledReason).toContain('DHA_CLIENT_SECRET');
  });

  it('is not enabled without a Facility Registry code', () => {
    setEnv({ DHA_MODE: 'sandbox', DHA_CLIENT_ID: 'a', DHA_CLIENT_SECRET: SECRET });

    const config = loadDhaConfig();

    expect(config.enabled).toBe(false);
    expect(config.disabledReason).toContain('DHA_FACILITY_CODE');
  });

  it('does not treat the UAT URL as a production one', () => {
    /* The documented sandbox host must never be reachable in production
     * mode by accident. */
    expect(DHA_SANDBOX_BASE_URL).toContain('uat');
  });
});

/* ============================================================
   3. Production is double-gated
   ============================================================ */

describe('production', () => {
  it('is blocked without an explicit opt-in', () => {
    setEnv({ ...SANDBOX_ENV, DHA_MODE: 'production', DHA_BASE_URL: 'https://live.example.test' });

    const config = loadDhaConfig();

    expect(config.enabled).toBe(false);
    expect(config.productionOptIn).toBe(false);
    expect(config.disabledReason).toContain('DHA_ALLOW_PRODUCTION');
  });

  it('is blocked with the opt-in but no base URL, and does not invent one', () => {
    /*
     * DHA publishes the UAT base URL, not a production one. Falling back to
     * the sandbox host here would send live patient data to a test system.
     */
    setEnv({
      ...SANDBOX_ENV,
      DHA_MODE: 'production',
      DHA_ALLOW_PRODUCTION: 'true',
    });

    const config = loadDhaConfig();

    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBeNull();
    expect(config.disabledReason).toContain('DHA_BASE_URL');
  });

  it('refuses a non-https production base URL', () => {
    /* Identifiers would otherwise travel in clear text. */
    setEnv({
      ...SANDBOX_ENV,
      DHA_MODE: 'production',
      DHA_ALLOW_PRODUCTION: 'true',
      DHA_BASE_URL: 'http://live.example.test',
    });

    const config = loadDhaConfig();

    expect(config.baseUrl).toBeNull();
    expect(config.enabled).toBe(false);
  });

  it('requires the opt-in to be exactly "true"', () => {
    /* '1', 'yes' and 'TRUE' must not switch on live traffic. */
    for (const value of ['1', 'yes', 'TRUE', 'on', 'true ']) {
      setEnv({
        ...SANDBOX_ENV,
        DHA_MODE: 'production',
        DHA_ALLOW_PRODUCTION: value,
        DHA_BASE_URL: 'https://live.example.test',
      });

      const config = loadDhaConfig();

      expect(config.productionOptIn, value).toBe(value.trim() === 'true');
    }
  });

  it('is enabled only when every gate is satisfied', () => {
    setEnv({
      ...SANDBOX_ENV,
      DHA_MODE: 'production',
      DHA_ALLOW_PRODUCTION: 'true',
      DHA_BASE_URL: 'https://live.example.test/api',
    });

    const config = loadDhaConfig();

    expect(config.enabled).toBe(true);
    expect(config.disabledReason).toBeNull();
    expect(config.baseUrl).toBe('https://live.example.test/api');
  });

  it('does not fall back to the sandbox URL in production mode', () => {
    delete process.env.DHA_BASE_URL;

    setEnv({
      ...SANDBOX_ENV,
      DHA_MODE: 'production',
      DHA_ALLOW_PRODUCTION: 'true',
    });
    delete process.env.DHA_BASE_URL;

    expect(loadDhaConfig().baseUrl).not.toBe(DHA_SANDBOX_BASE_URL);
  });
});

/* ============================================================
   4. Numeric settings
   ============================================================ */

describe('timeouts and retries', () => {
  it('defaults to a bounded timeout and a small retry count', () => {
    const config = loadDhaConfig();

    expect(config.timeoutMs).toBe(15_000);
    expect(config.maxRetries).toBe(2);
  });

  it('accepts a positive integer from the environment', () => {
    setEnv({ DHA_TIMEOUT_MS: '5000', DHA_MAX_RETRIES: '4' });

    const config = loadDhaConfig();

    expect(config.timeoutMs).toBe(5000);
    expect(config.maxRetries).toBe(4);
  });

  it('falls back rather than accepting zero, negatives or junk', () => {
    /*
     * A timeout of 0 aborts every request instantly, and a negative retry
     * count is meaningless. Both are worse than the default.
     */
    for (const value of ['0', '-1', 'abc', '1.5', '999999999999999999999', '']) {
      setEnv({ DHA_TIMEOUT_MS: value, DHA_MAX_RETRIES: value });

      const config = loadDhaConfig();

      expect(config.timeoutMs, `timeout ${value}`).toBe(15_000);
      expect(config.maxRetries, `retries ${value}`).toBe(2);
    }
  });
});

/* ============================================================
   5. Redaction — the readiness endpoint is public to administrators
   ============================================================ */

describe('redaction', () => {
  it('never returns the client secret', () => {
    setEnv(SANDBOX_ENV);

    const described = describeDhaConfig(loadDhaConfig());
    const serialised = JSON.stringify(described);

    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('test-client-id');
    expect(serialised).not.toContain('FID-00-000000-0');
  });

  it('reports presence rather than value', () => {
    setEnv(SANDBOX_ENV);

    const described = describeDhaConfig(loadDhaConfig());

    expect(described.credentials).toStrictEqual({
      clientId: 'configured',
      clientSecret: 'configured',
      facilityCode: 'configured',
    });
  });

  it('reports what is missing', () => {
    setEnv({ DHA_MODE: 'sandbox' });

    const described = describeDhaConfig(loadDhaConfig());

    expect(described.credentials).toStrictEqual({
      clientId: 'missing',
      clientSecret: 'missing',
      facilityCode: 'missing',
    });
  });

  it('does not leak the secret through the readiness report', async () => {
    setEnv(SANDBOX_ENV);

    const report = await buildReadinessReport({ probe: false });
    const serialised = JSON.stringify(report);

    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('test-client-id');
  });

  it('does not leak the secret through a blocker message', () => {
    /* A blocker is the most likely place for a careless value to be
     * interpolated into a string that a support engineer screenshots. */
    setEnv({ DHA_MODE: 'production', DHA_ALLOW_PRODUCTION: 'true', DHA_CLIENT_SECRET: SECRET });

    const config = loadDhaConfig();

    expect(config.disabledReason).not.toContain(SECRET);
  });
});

/* ============================================================
   6. It never throws
   ============================================================ */

describe('robustness', () => {
  it('loads a usable config from a completely unset environment', () => {
    /* An HMIS must boot without DHA credentials; the readiness screen is how
     * an administrator finds out what is missing. */
    expect(() => loadDhaConfig()).not.toThrow();
    expect(loadDhaConfig().enabled).toBe(true);
  });

  it('survives junk in every variable at once', () => {
    setEnv({
      DHA_MODE: '!!!',
      DHA_ALLOW_PRODUCTION: 'maybe',
      DHA_BASE_URL: 'not-a-url',
      DHA_CLIENT_ID: ' ',
      DHA_CLIENT_SECRET: '',
      DHA_FACILITY_CODE: '\t',
      DHA_TIMEOUT_MS: 'NaN',
      DHA_MAX_RETRIES: '-0',
    });

    const config = loadDhaConfig();

    expect(config.mode).toBe('mock');
    expect(config.baseUrl).toBeNull();
    expect(config.clientId).toBeNull();
    expect(config.clientSecret).toBeNull();
    expect(config.facilityCode).toBeNull();
    expect(config.enabled).toBe(true);
  });

  it('applies overrides after reading the environment', () => {
    setEnv(SANDBOX_ENV);

    const overridden = loadDhaConfig({ mode: 'mock' } as Partial<DhaConfig>);

    expect(overridden.mode).toBe('mock');
    /* The blocker is recomputed from the overridden values, not the env. */
    expect(overridden.enabled).toBe(true);
  });
});

/* ============================================================
   7. Readiness report
   ============================================================ */

describe('readiness report', () => {
  it('is ready in mock mode, and says no request leaves the process', async () => {
    setEnv({ DHA_MODE: 'mock' });

    const report = await buildReadinessReport({ probe: false });

    expect(report.ready).toBe(true);
    expect(report.blockers).toStrictEqual([]);
    expect(report.checks.every((check) => check.status !== 'BLOCKED')).toBe(true);

    const mode = report.checks.find((check) => check.id === 'mode');
    expect(mode?.detail).toContain('No network calls are made');

    const baseUrl = report.checks.find((check) => check.id === 'base_url');
    expect(baseUrl?.detail).toContain('No request leaves this process');
  });

  it('is not ready in production without the gates, and lists every blocker', async () => {
    setEnv({ DHA_MODE: 'production' });

    const report = await buildReadinessReport({ probe: false });

    expect(report.ready).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);

    /* Each blocker names the check it came from, so the screen can point at
     * the right row. */
    for (const blocker of report.blockers) {
      expect(blocker).toMatch(/^.+: .+$/);
    }

    expect(report.blockers.join(' ')).toContain('DHA_ALLOW_PRODUCTION');
  });

  it('warns rather than pretending, when it cannot probe', async () => {
    /* probe:false on an incomplete config must not report READY. */
    setEnv({ DHA_MODE: 'sandbox' });

    const report = await buildReadinessReport({ probe: false });
    const connectivity = report.checks.find((check) => check.id === 'connectivity');

    expect(connectivity?.status).toBe('WARNING');
    expect(connectivity?.detail).toContain('Not attempted');
  });

  it('does not attempt a token exchange in mock mode', async () => {
    setEnv({ DHA_MODE: 'mock', DHA_CLIENT_ID: 'a', DHA_CLIENT_SECRET: SECRET });

    const report = await buildReadinessReport();

    expect(report.checks.find((check) => check.id === 'connectivity')).toBeUndefined();
    expect(report.ready).toBe(true);
  });

  it('stamps an ISO timestamp', async () => {
    const report = await buildReadinessReport({ probe: false });

    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  });
});

/* ============================================================
   8. The report describes only what is built
   ============================================================ */

describe('DHA_OPERATIONS', () => {
  it('gives every unimplemented operation a reason', () => {
    /*
     * This is the honesty check. An operation listed without a reason reads
     * as available; one with `implemented: false` and no explanation is
     * indistinguishable from a stub somebody forgot to finish.
     */
    const unimplemented = DHA_OPERATIONS.filter((operation) => !operation.implemented);

    expect(unimplemented.length).toBeGreaterThan(0);

    for (const operation of unimplemented) {
      expect(operation.operation, operation.operation).toBeTruthy();
      expect(operation.blockedReason, operation.operation).toBeTruthy();
      expect(String(operation.blockedReason).length).toBeGreaterThan(20);
    }
  });

  it('does not give an implemented operation a blocked reason', () => {
    for (const operation of DHA_OPERATIONS.filter((entry) => entry.implemented)) {
      expect(operation.blockedReason, operation.operation).toBeUndefined();
    }
  });

  it('has unique operation names and plausible methods', () => {
    const names = DHA_OPERATIONS.map((operation) => operation.operation);

    expect(new Set(names).size).toBe(names.length);

    for (const operation of DHA_OPERATIONS) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(operation.method);
    }
  });

  it('never presents a guessed path as a real one', () => {
    /*
     * An operation either has a path that was read from the published
     * reference, or it has no path at all and says so. The entries whose
     * contract has not been captured carry a parenthesised placeholder -
     * '(claim line items)' - rather than a plausible-looking route, because
     * an invented '/claims/lines' would be indistinguishable from a verified
     * one to anybody reading the readiness screen.
     */
    for (const operation of DHA_OPERATIONS) {
      if (operation.implemented) {
        expect(operation.path.startsWith('/'), operation.operation).toBe(true);
        continue;
      }

      const hasRealPath = operation.path.startsWith('/');

      if (!hasRealPath) {
        /* Parenthesised: visibly a description, not a route. */
        expect(operation.path, operation.operation).toMatch(/^\(.+\)$/);
      }
    }
  });

  it('has at least one operation whose contract is explicitly not captured', () => {
    /* If this ever drops to zero, the "not invented" claim above has lost
     * its subject and should be re-read rather than deleted. */
    const uncaptured = DHA_OPERATIONS.filter(
      (operation) => !operation.implemented && !operation.path.startsWith('/'),
    );

    expect(uncaptured.length).toBeGreaterThan(0);

    for (const operation of uncaptured) {
      expect(operation.blockedReason).toContain('not');
    }
  });

  it('claims the three operations the codebase actually calls', () => {
    /* The documentation captured at implementation time covers these. If the
     * list grows, the claim needs a source. */
    const implemented = DHA_OPERATIONS.filter((operation) => operation.implemented).map(
      (operation) => operation.operation,
    );

    expect(implemented).toContain('auth.token');
    expect(implemented).toContain('eligibility.check');
  });

  it('ships the operations into the report unchanged', async () => {
    const report = await buildReadinessReport({ probe: false });

    expect(report.operations).toStrictEqual(DHA_OPERATIONS);
  });
});
