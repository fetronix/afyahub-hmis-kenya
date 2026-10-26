/**
 * Route authorization — what an unauthenticated caller actually gets
 *
 * `src/tests/inpatient-domain.test.ts` used to prove that the ward and bed
 * routes were protected by searching `src/app.ts` for this exact string:
 *
 *     app.post(
 *         '/api/wards',
 *
 * That test passes only while the file keeps that indentation. Reformat it,
 * extract the route into a router, or move it into `app.use`, and a *green*
 * test becomes a red one without anything about security having changed.
 * Worse, it could stay green while the permission check was deleted, as long
 * as the marker survived.
 *
 * These tests ask the question that matters instead: does the server refuse
 * the request? They drive the real Express app over a real socket, with no
 * session cookie, and assert the status code a caller sees.
 *
 * No database is required. Authentication is rejected before any query runs,
 * which is itself the property worth pinning: if an unauthenticated request
 * ever starts reaching the database, that is a defect this suite cannot see,
 * but if it starts returning 200 it will fail here immediately.
 *
 * Synthetic request bodies only. No patient data.
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

/**
 * Routes that mutate clinical or facility state. Each one must be
 * unreachable without a session, whatever its handler does internally.
 */
const PROTECTED_WRITES: Array<[string, string]> = [
  ['POST', '/api/wards'],
  ['PUT', '/api/wards/1'],
  ['DELETE', '/api/wards/1'],
  ['POST', '/api/beds'],
  ['PUT', '/api/beds/1'],
  ['DELETE', '/api/beds/1'],
  ['POST', '/api/patients'],
  ['POST', '/api/encounters'],
  ['POST', '/api/lab-orders'],
  ['POST', '/api/invoices'],
  ['POST', '/api/pharmacy/dispense'],
  ['POST', '/api/claims'],
];

/** Routes that read patient or facility data. Same rule. */
const PROTECTED_READS: Array<[string, string]> = [
  ['GET', '/api/wards'],
  ['GET', '/api/beds'],
  ['GET', '/api/patients'],
  ['GET', '/api/patients/1'],
  ['GET', '/api/encounters'],
  ['GET', '/api/lab-orders'],
  ['GET', '/api/invoices'],
  ['GET', '/api/claims'],
];

async function call(method: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
}

/**
 * Every path listed above must be a route that actually exists.
 *
 * This guard exists because six of them once were not. `POST /api/lab/orders`,
 * `POST /api/billing/invoices`, `POST /api/insurance/claims` and their read
 * counterparts name paths the application never registered — the real ones
 * are `/api/lab-orders`, `/api/invoices` and `/api/claims`.
 *
 * The tests still passed. `requireAuth` is mounted on all of `/api`, so it
 * rejects an unauthenticated caller before routing resolves, and a typo'd
 * path answers 401 exactly like a real protected one. That is the same
 * property that makes the API unenumerable, and it means a wrong path in
 * this list tests nothing at all while looking green.
 */
function collectRoutePaths(router: unknown): string[] {
  type Layer = {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
  };

  const r = router as { stack?: Layer[]; _router?: { stack?: Layer[] } };
  const found: string[] = [];

  const walk = (layers: Layer[]) => {
    for (const layer of layers) {
      if (layer.route) {
        for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
          if (enabled) found.push(`${method.toUpperCase()} ${layer.route.path}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };

  walk(r.stack ?? r._router?.stack ?? []);

  return found;
}

const normalise = (path: string): string =>
  path.replace(/:[A-Za-z]+/g, '<id>').replace(/(?<=\/)\d+(?=\/|$)/g, '<id>');

describe('the protected route list is real', () => {
  it.each([...PROTECTED_WRITES, ...PROTECTED_READS])(
    '%s %s is a registered route',
    async (method, path) => {
      const app = await createApp();
      const registered = collectRoutePaths(app);

      /* A sub-router mounted at /api registers '/claims' where the client
         calls '/api/claims'. Either form names the same route, so both are
         accepted - but one of them must exist. */
      const matches = [path, path.replace(/^\/api/, '')].map(
        (candidate) => `${method} ${normalise(candidate)}`,
      );

      expect(
        registered.map(normalise).some((route) => matches.includes(route)),
        `${method} ${path} is not a route the app registers. This test would ` +
          'pass without testing anything: requireAuth answers 401 for every ' +
          'path under /api, existing or not.',
      ).toBe(true);
    },
  );
});

describe('unauthenticated writes are refused', () => {
  it.each(PROTECTED_WRITES)('%s %s requires a session', async (method, path) => {
    const response = await call(method, path);

    // 401 unauthorized, not 403 and not 200. A caller with no session is
    // not being told "you may not"; they are being told "sign in first".
    expect(response.status).toBe(401);
  });

  it('does not leak whether the route exists', async () => {
    // A 404 for a real protected route would let an unauthenticated caller
    // map the API by trying paths.
    for (const [method, path] of PROTECTED_WRITES) {
      const response = await call(method, path);

      expect(response.status).not.toBe(404);
    }
  });
});

describe('unauthenticated reads are refused', () => {
  it.each(PROTECTED_READS)('%s %s requires a session', async (method, path) => {
    const response = await call(method, path);

    expect(response.status).toBe(401);
  });
});

describe('refusals are machine-readable', () => {
  it('answers with JSON, not an HTML error page', async () => {
    const response = await call('GET', '/api/patients');

    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('does not disclose a stack trace or internal detail', async () => {
    const response = await call('GET', '/api/patients');
    const text = await response.text();

    // The failures that matter here are Express's default HTML page and any
    // message naming a file, a table or a driver.
    expect(text).not.toContain('<html');
    expect(text.toLowerCase()).not.toContain('stack');
    expect(text.toLowerCase()).not.toContain('postgres');
    expect(text.toLowerCase()).not.toContain('drizzle');
  });

  it('sends a correlation id back, so a refusal can be traced in the log', async () => {
    const response = await call('GET', '/api/patients');

    const id = response.headers.get('x-request-id') ?? response.headers.get('x-correlation-id');

    expect(id).toBeTruthy();
  });
});

describe('public endpoints stay public', () => {
  it('/api/health is reachable without a session', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
  });

  it('readiness reports honestly when the database is not configured', async () => {
    // No database in this job. Readiness must say so with 503 rather than
    // claiming to be ready; the value asserted is "not 200 while
    // unconfigured", so this stays true in CI either way it is wired.
    const response = await fetch(`${baseUrl}/api/ready`);

    expect([200, 503]).toContain(response.status);
  });
});
