/**
 * Platform router — are the moved routes still reachable?
 *
 * `src/routes/platform.routes.ts` was split so the subscription block lives
 * in its own module. That is easy to get subtly wrong: a router can be
 * created and never mounted, or mounted at the wrong prefix, and nothing
 * fails until a client asks for a URL that is now 404.
 *
 * The existing coverage of these routes searches `platform.routes.ts` for
 * strings like `router.post('/rbac/catalogue/apply'`. That passes for a
 * router nobody mounts, and says nothing at all about routes that moved to
 * another file.
 *
 * WHY THIS READS THE ROUTER STACK RATHER THAN ISSUING REQUESTS
 *
 * The obvious check — request the path and see whether it 404s — does not
 * work here, and the reason is worth stating plainly. `requireAuth` is
 * mounted on the whole `/api` prefix, so it runs before routing resolves.
 * An unauthenticated request to `/api/platform/anything-at-all` gets 401
 * whether or not a route exists. That is deliberate, because it makes the
 * API unenumerable from outside, but it means a status code cannot separate
 * a mounted route from a missing one. The control tests at the bottom pin
 * that behaviour so it does not change silently.
 *
 * So the routes are read from the table Express will actually match against,
 * and the mount prefix is verified rather than assumed. Express does not
 * expose a sub-router's mount path as a property, but it does expose the
 * compiled `regexp` it matches with: a root mount matches any path at zero
 * length, a prefixed mount does not. Checked against this router — the root
 * mount compiles to `^\/?(?=\/|$)` and matches '/__probe__'.
 *
 * Building the router opens no database connection, so nothing here needs
 * PostgreSQL. Every path below is a documented API path.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import platformRoutes from '../../routes/platform.routes.ts';

const { createApp } = await import('../../app.ts');

type Layer = {
  name: string;
  regexp?: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

const stackOf = (router: unknown): Layer[] => (router as { stack?: Layer[] }).stack ?? [];

/**
 * Collect every method-and-path pair the router will match, descending into
 * mounted sub-routers.
 */
function collectRoutes(router: unknown, prefix = ''): string[] {
  const found: string[] = [];

  for (const layer of stackOf(router)) {
    if (layer.route) {
      const methods = Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => method.toUpperCase())
        .sort();

      /* A sub-router mounted at '/' keeps its own absolute paths, so the
         parent prefix is all that is prepended. Collapse any doubled slash
         so the result reads like a URL. */
      const path = `${prefix}${layer.route.path}`.replace(/\/{2,}/g, '/');

      for (const method of methods) found.push(`${method} ${path}`);
      continue;
    }

    if (layer.handle?.stack) found.push(...collectRoutes(layer.handle, prefix));
  }

  return found;
}

const routes = collectRoutes(platformRoutes);

/** Sub-router mount layers, which carry a handler stack but no route. */
function mountLayers(): Layer[] {
  return stackOf(platformRoutes).filter((layer) => layer.handle?.stack && !layer.route);
}

/* ============================================================
   Routes that stayed
   ============================================================ */

describe('routes that stayed in platform.routes.ts', () => {
  it('registers the tenant, facility and RBAC routes', () => {
    const expected = [
      'POST /tenants',
      'PATCH /tenants/:id',
      'POST /facilities',
      'PATCH /facilities/:id',
      'GET /facilities/:id/onboarding',
      'POST /facilities/:id/onboarding',
      'POST /facility-admin-invitations',
      'GET /facility-admin-invitations',
      'POST /facility-admin-invitations/:id/revoke',
      'POST /facility-admin-invitations/:id/reissue',
      'GET /rbac/roles',
      'POST /rbac/catalogue/apply',
      'PUT /rbac/roles/:id/permissions',
    ];

    for (const route of expected) {
      expect(routes, `${route} should be routable`).toContain(route);
    }
  });
});

/* ============================================================
   Routes that moved
   ============================================================ */

describe('subscription routes after the extraction', () => {
  /*
   * All eight moved file. If the sub-router were created but never mounted,
   * every one of these would vanish and the subscription screens would be
   * dead - while `platform.routes.ts` still contained no reference to a
   * missing path.
   */
  it('registers all eight subscription routes', () => {
    const expected = [
      'GET /subscription-periods',
      'POST /subscription-periods',
      'GET /subscription-periods/:id/payments',
      'POST /subscription-periods/:id/payments',
      'POST /subscription-payments/:paymentId/verify',
      'POST /subscription-periods/:id/suspend',
      'POST /subscription-periods/:id/reactivate',
      'POST /subscription-periods/:id/price-changes',
    ];

    for (const route of expected) {
      expect(routes, `${route} should be routable`).toContain(route);
    }
  });
});

/* ============================================================
   Mounting mistakes
   ============================================================ */

describe('mounting', () => {
  it('mounts the extracted sub-router at the root, not under a prefix', () => {
    /*
     * `router.use(subRouter)` mounts at '/', which is right because the
     * sub-router carries absolute paths. A mount at '/subscriptions' would
     * rewrite every subscription path to
     * /api/platform/subscriptions/subscription-periods: the handlers would
     * still exist, just not where the client calls them, and nothing in the
     * route table would look wrong.
     */
    const mounts = mountLayers();

    expect(mounts.length, 'the extracted sub-router should be mounted').toBeGreaterThan(0);

    for (const mount of mounts) {
      expect(mount.regexp, 'a mounted sub-router carries its match regexp').toBeTruthy();
      expect(
        mount.regexp!.test('/__probe__'),
        'a sub-router is mounted under a path prefix, which rewrites its routes',
      ).toBe(true);
    }
  });

  it('has no duplicate method-and-path pair', () => {
    /*
     * The extraction copies routes between files. Express accepts a
     * duplicate and simply never reaches the second handler, so a copy that
     * was pasted rather than moved would be invisible at runtime.
     */
    const duplicates = routes.filter((route, index) => routes.indexOf(route) !== index);

    expect(duplicates).toStrictEqual([]);
  });

  it('collects absolute paths only', () => {
    /* A relative path would mean a mount prefix leaked into the collection,
       which would make every assertion above meaningless. */
    for (const route of routes) {
      expect(route, route).toMatch(/^[A-Z]{3,6} \/\S*$/);
    }
  });

  it('collects the whole router, not just the parent', () => {
    /* 13 in the parent plus 8 in the sub-router. Asserted as a floor so the
       figure is not a brittle specification, but a collector that stopped
       descending would fail loudly here rather than passing everything. */
    expect(routes.length).toBeGreaterThanOrEqual(21);
  });
});

/* ============================================================
   The property that forced this design
   ============================================================ */

describe('the API does not reveal which routes exist', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = await createApp();

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));

    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function statusOf(path: string): Promise<number> {
    const response = await fetch(`${base}${path}`);
    await response.text();

    return response.status;
  }

  it('answers 401, not 404, for an unknown path under /api', async () => {
    /*
     * This is exactly why the tests above read the router stack. It is also
     * worth pinning in its own right: an unauthenticated client cannot
     * enumerate the API by watching which paths 404.
     */
    expect(await statusOf('/api/platform/definitely-not-a-route')).toBe(401);
  });

  it('answers 401 for a real platform path too', async () => {
    /* Same status for the real path and the imaginary one. That is the point. */
    expect(await statusOf('/api/platform/rbac/roles')).toBe(401);
    expect(await statusOf('/api/platform/subscription-periods')).toBe(401);
  });
});
