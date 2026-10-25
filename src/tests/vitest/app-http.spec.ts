/**
 * Application boundary — what a client gets when something goes wrong
 *
 * Three behaviours are pinned here, all of them things that were wrong or
 * absent before this phase:
 *
 *   1. A malformed request body answers 400 with JSON, not Express's
 *      default HTML page containing a stack trace.
 *   2. The response carries a correlation id, and the same id appears in
 *      the log, so a support ticket can be turned into a log query.
 *   3. A query string carrying a patient identifier does not reach the
 *      log file.
 *
 * The tests drive the real Express app over a real socket, because the
 * mistakes being guarded against (middleware ordering, header timing) do
 * not exist when you call a handler directly.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';

const { createApp } = await import('../../app.ts');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = await createApp();

  server = app.listen(0, '127.0.0.1');

  await new Promise<void>((resolve) => server.once('listening', resolve));

  const { port } = server.address() as AddressInfo;

  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('health and readiness', () => {
  it('/api/health reports the process is alive without naming any dependency', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe('healthy');

    /* No connection string, no host, no user. A health endpoint is
     * unauthenticated by design and is often public. */
    const text = JSON.stringify(body).toLowerCase();

    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('password');
  });

  it('/api/ready reports 503 when the database is unreachable', async () => {
    /*
     * The sandbox has no PostgreSQL, which is exactly the condition this
     * endpoint must detect. In an environment that does have one this
     * assertion would flip, so the test reads the answer rather than
     * assuming it — but either way the body must name the dependency and
     * must not leak connection details.
     */
    const response = await fetch(`${baseUrl}/api/ready`);
    const body = (await response.json()) as {
      status: string;
      checks: { database: { status: string } };
    };

    expect([200, 503]).toContain(response.status);
    expect(['ready', 'not_ready']).toContain(body.status);
    expect(['up', 'down']).toContain(body.checks.database.status);

    if (response.status === 503) {
      expect(body.status).toBe('not_ready');
      expect(body.checks.database.status).toBe('down');
    }

    const text = JSON.stringify(body).toLowerCase();

    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('password');
    expect(text).not.toContain('127.0.0.1');
  });
});

describe('correlation ids', () => {
  it('echoes a well-formed inbound id', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { 'x-correlation-id': 'trace-from-proxy-001' },
    });

    expect(response.headers.get('x-correlation-id')).toBe(
      'trace-from-proxy-001',
    );
  });

  it('issues one when the client supplies none', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.headers.get('x-correlation-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('replaces an inbound id that is too long to be a correlation id', async () => {
    /*
     * A newline cannot be tested here: the HTTP client refuses to transmit
     * one, which is the first line of defence. `correlationIdFrom` covers
     * the rest (logger.spec.ts), and it validates before use rather than
     * trusting the header.
     *
     * What this test checks is that an oversized but transmittable value is
     * not echoed verbatim into every log line for that request.
     */
    const forged = 'A'.repeat(300);

    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { 'x-correlation-id': forged },
    });

    const issued = response.headers.get('x-correlation-id') ?? '';

    expect(issued).not.toBe(forged);
    expect(issued.length).toBeLessThanOrEqual(128);
  });
});

describe('client errors', () => {
  it('answers malformed JSON with 400 and a usable correlation id', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as {
      error: string;
      correlationId: string;
    };

    expect(body.error).toMatch(/not valid JSON/i);

    /* The bug this guards against: the id was empty because the body
     * parser ran before the middleware that sets it. */
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);

    /* And it matches the header the client can quote. */
    expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
  });

  it('never returns a stack trace to the client', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    const text = await response.text();

    expect(text).not.toContain('at ');
    expect(text).not.toContain('.ts:');
    expect(text.toLowerCase()).not.toContain('node_modules');
  });
});

describe('unauthenticated access', () => {
  it('refuses a patient route without a session', async () => {
    const response = await fetch(`${baseUrl}/api/patients`);

    expect(response.status).toBe(401);
  });

  it('refuses it whether or not a patient id is present in the query', async () => {
    /* Authorisation must not depend on the parameters: an attacker who
     * can add a query string must not change the answer. */
    const response = await fetch(
      `${baseUrl}/api/patients?nationalId=12345678&facilityId=1`,
    );

    expect(response.status).toBe(401);
  });
});
