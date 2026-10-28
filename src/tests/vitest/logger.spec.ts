/**
 * Logging — redaction is the test that matters
 *
 * A redaction list that is never asserted is a comment. Every path in
 * `logger.ts` is exercised here against a real logger writing to a real
 * stream, and the assertion is on the bytes: the secret must not appear in
 * the output anywhere, not even inside a nested object or an error's
 * `config`.
 *
 * The second group of tests covers the things that are easy to get subtly
 * wrong and expensive to get wrong: a correlation id that a caller can
 * forge, and a patient reference that is stable but not reversible.
 */

import { PassThrough } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

/* Re-import the module under test with a known environment. The module
 * reads NODE_ENV at import time, so the test file sets it before importing
 * anything from it — vitest isolates each file for exactly this reason. */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'trace';

const { correlationIdFrom, newCorrelationId, patientRef, REDACT_PATHS } =
  await import('../../logging/logger.ts');

/**
 * Runs a logger through a memory stream and returns the parsed lines.
 *
 * Testing through the real pino serialisation path rather than calling the
 * redaction function directly: the interesting failures are in the paths
 * that are silently not matched (a wildcard that only covers one level, a
 * key that nested one object deeper than expected).
 */
function capture(): {
  log: pino.Logger;
  lines: () => Array<Record<string, unknown>>;
} {
  const stream = new PassThrough();
  const chunks: string[] = [];

  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  const log = pino(
    {
      level: 'trace',
      redact: {
        paths: REDACT_PATHS_UNDER_TEST,
        censor: '[REDACTED]',
      },
      timestamp: false,
      base: undefined,
    },
    stream,
  );

  return {
    log,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/*
 * The list under test is the one the application actually uses. Deleting an
 * entry from logger.ts therefore cannot silently shrink what is checked:
 * the coverage test below names the keys that must be present.
 */
const REDACT_PATHS_UNDER_TEST = REDACT_PATHS;

describe('the redaction list itself', () => {
  it('covers every key that must never be logged, at every depth', () => {
    /*
     * Named explicitly rather than derived, because the failure this guards
     * against is a key being *removed* from logger.ts.
     */
    const required = [
      'password',
      'token',
      'authorization',
      'cookie',
      'clientSecret',
      'apiKey',
      'nationalId',
      'phone',
      'dateOfBirth',
      'patientName',
      'email',
      'FIELD_ENCRYPTION_KEY',
    ];

    for (const key of required) {
      expect(REDACT_PATHS, `${key} missing at top level`).toContain(key);
      expect(REDACT_PATHS, `${key} missing two levels down`).toContain(`*.*.${key}`);
    }

    /*
     * Database errors are a second route to the same data: `pg` attaches the
     * bound parameter values to the error, and Pino's `err` serializer copies
     * every enumerable property. These paths are what stop a failed insert
     * writing a national ID to the log.
     */
    for (const path of ['err.parameters', 'error.parameters', 'err.query', 'error.query']) {
      expect(REDACT_PATHS, `${path} must be redacted`).toContain(path);
    }
  });

  it('names the Authorization header paths explicitly', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('req.headers.cookie');
  });

  it('has no duplicate paths', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});

describe('redaction', () => {
  /*
   * THE DATABASE ERROR THAT LOGGED A NATIONAL ID
   *
   * An insert fails on a unique constraint. `pg` hands back an error
   * carrying `query` and `parameters`; the data layer logs
   * `{ err: error }`. Before these redaction paths existed, the parameter
   * array - `['12345678']` - was written verbatim. The message and stack are
   * what an operator actually needs, and they survive.
   */
  it('redacts the bound parameters and SQL carried by a database error', () => {
    const { log, lines } = capture();

    const dbError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      query: 'INSERT INTO patients (national_id) VALUES ($1)',
      parameters: ['12345678'],
    });

    log.error({ err: dbError }, 'patient.create_failed');

    const out = JSON.stringify(lines());

    expect(out, 'the bound national ID is not written to the log').not.toContain('12345678');
    expect(out, 'the statement text is not written to the log').not.toContain(
      'INSERT INTO patients',
    );
    expect(out, 'the diagnostic message survives').toContain('duplicate key value');
    expect(out, 'the error code survives, so the failure is classifiable').toContain('23505');
  });

  it('redacts a password at the top level and one level down', () => {
    const { log, lines } = capture();

    log.info({ password: 'hunter2', user: { password: 'hunter2' } }, 'login');

    const out = JSON.stringify(lines());

    expect(out).not.toContain('hunter2');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts an Authorization header and a cookie', () => {
    const { log, lines } = capture();

    log.info(
      {
        req: {
          headers: {
            authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
            cookie: 'session=abc123',
          },
        },
      },
      'request',
    );

    const out = JSON.stringify(lines());

    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('session=abc123');
  });

  it('redacts patient identity fields', () => {
    const { log, lines } = capture();

    log.info(
      {
        patient: {
          nationalId: '12345678',
          phone: '254712345678',
          dateOfBirth: '1985-04-12',
          patientName: 'Wanjiku Kamau',
        },
      },
      'patient.lookup',
    );

    const out = JSON.stringify(lines());

    for (const secret of ['12345678', '254712345678', '1985-04-12', 'Wanjiku']) {
      expect(out).not.toContain(secret);
    }
  });

  it('redacts a client secret nested inside a config object', () => {
    const { log, lines } = capture();

    log.info({ dha: { credentials: { clientSecret: 'shh-this-is-the-secret' } } }, 'dha.auth');

    expect(JSON.stringify(lines())).not.toContain('shh-this-is-the-secret');
  });

  it('keeps the fields that are safe and useful', () => {
    const { log, lines } = capture();

    log.info({ invoiceId: 42, facilityId: 7, password: 'secret' }, 'invoice.created');

    const line = lines()[0]!;

    expect(line.invoiceId).toBe(42);
    expect(line.facilityId).toBe(7);
    expect(line.msg).toBe('invoice.created');
    expect(line.password).toBe('[REDACTED]');
  });
});

describe('correlation ids', () => {
  it('accepts a well-formed inbound id so a trace can span services', () => {
    expect(correlationIdFrom('abc12345-def6-7890')).toBe('abc12345-def6-7890');
  });

  it('rejects an inbound id containing newlines, which would forge log lines', () => {
    const forged = 'abc12345\n{"level":50,"msg":"payment.failed"}';

    const id = correlationIdFrom(forged);

    expect(id).not.toContain('\n');
    expect(id).not.toBe(forged);
  });

  it('rejects an inbound id that is too short, too long, or the wrong type', () => {
    expect(correlationIdFrom('short')).not.toBe('short');
    expect(correlationIdFrom('a'.repeat(200))).not.toBe('a'.repeat(200));
    expect(correlationIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationIdFrom(12345)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCorrelationId()));

    expect(ids.size).toBe(50);
  });
});

describe('patient references', () => {
  it('is stable for the same patient', () => {
    expect(patientRef(1234)).toBe(patientRef('1234'));
  });

  it('differs for different patients', () => {
    expect(patientRef(1234)).not.toBe(patientRef(1235));
  });

  it('does not contain the patient id', () => {
    const ref = patientRef(987654);

    expect(ref).toMatch(/^hmac:[0-9a-f]{16}$/);
    expect(ref).not.toContain('987654');
  });

  it('changes when the key changes, so two installations do not correlate', () => {
    process.env.LOG_PSEUDONYM_KEY = 'installation-a';
    const a = patientRef(555);

    process.env.LOG_PSEUDONYM_KEY = 'installation-b';
    const b = patientRef(555);

    expect(a).not.toBe(b);

    delete process.env.LOG_PSEUDONYM_KEY;
  });
});
