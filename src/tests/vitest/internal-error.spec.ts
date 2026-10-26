/**
 * A 500 must not return the exception's own text.
 *
 * This is the check that matters for a leak that is easy to write and hard
 * to notice. Every `catch (err) { res.status(500).json({ error: err.message }) }`
 * looks harmless in review, and the leak only shows up on the day a
 * constraint fires in production. A PostgreSQL driver error is not a
 * sentence about the user's request:
 *
 *     duplicate key value violates unique constraint "patients_mrn_key"
 *     DETAIL:  Key (mrn, tenant_id)=(MRN-000431, 7) already exists.
 *
 * That discloses the schema, the column names, and in the DETAIL line a
 * patient identifier alongside a tenant id — on a multi-tenant system, an
 * authenticated user of one facility can infer that a named patient record
 * exists at another.
 *
 * `respondInternalError` is the single place these are turned into a
 * response. The test below feeds it a genuine-shaped driver error and
 * asserts that none of it reaches the client.
 */

import { describe, expect, it, vi } from 'vitest';

import { respondInternalError } from '../../routes/shared/errors.ts';

/** Minimal stand-in for an Express response, capturing what was sent. */
function fakeResponse() {
  const captured: { status?: number; body?: unknown } = {};

  const res = {
    status(code: number) {
      captured.status = code;

      return this;
    },
    json(body: unknown) {
      captured.body = body;

      return this;
    },
  };

  return { res: res as never, captured };
}

/** The shape `pg` produces for a unique-violation. */
function driverError(): Error {
  const error = new Error(
    'duplicate key value violates unique constraint "patients_mrn_key"\n' +
      'DETAIL:  Key (mrn, tenant_id)=(MRN-000431, 7) already exists.',
  );

  Object.assign(error, { code: '23505', constraint: 'patients_mrn_key' });

  return error;
}

describe('respondInternalError', () => {
  it('responds 500 with a fixed message', () => {
    const original = console.error;
    console.error = () => undefined;

    try {
      const { res, captured } = fakeResponse();

      respondInternalError(res, driverError(), 'GET /api/patients');

      expect(captured.status).toBe(500);
      expect(captured.body).toStrictEqual({ error: 'The request could not be completed.' });
    } finally {
      console.error = original;
    }
  });

  it('does not echo the constraint, the column names, the MRN or the tenant id', () => {
    const original = console.error;
    console.error = () => undefined;

    try {
      const { res, captured } = fakeResponse();

      respondInternalError(res, driverError(), 'GET /api/patients');

      const body = JSON.stringify(captured.body);

      for (const secret of ['patients_mrn_key', 'DETAIL', 'MRN-000431', 'tenant_id', '23505']) {
        expect(body, `response leaked ${secret}`).not.toContain(secret);
      }
    } finally {
      console.error = original;
    }
  });

  it('records the operation and the original error on the server', () => {
    /* The detail has to go somewhere: an error nobody can diagnose is its
       own kind of outage. The log line names the operation so on-call know
       which query failed. */
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const { res } = fakeResponse();
      const error = driverError();

      respondInternalError(res, error, 'GET /api/patients');

      expect(spy).toHaveBeenCalledTimes(1);

      const [line, logged] = spy.mock.calls[0];

      expect(String(line)).toContain('GET /api/patients');
      expect(logged).toBe(error);
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts a public message where the operation is worth naming', () => {
    const original = console.error;
    console.error = () => undefined;

    try {
      const { res, captured } = fakeResponse();

      respondInternalError(res, driverError(), 'GET /api/tenants', 'Failed to fetch tenants');

      expect(captured.body).toStrictEqual({ error: 'Failed to fetch tenants' });
    } finally {
      console.error = original;
    }
  });

  it('survives a thrown value that is not an Error', () => {
    /* `catch` binds anything, including a string or a rejected promise's
       reason. Reading `.message` off those is how an error path itself
       throws and the request hangs with no response. */
    const original = console.error;
    console.error = () => undefined;

    try {
      for (const thrown of ['boom', undefined, null, 42, { message: 'leaky' }]) {
        const { res, captured } = fakeResponse();

        respondInternalError(res, thrown, 'GET /api/x');

        expect(captured.status).toBe(500);
        expect(captured.body).toStrictEqual({ error: 'The request could not be completed.' });
      }
    } finally {
      console.error = original;
    }
  });
});
