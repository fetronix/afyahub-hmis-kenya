/**
 * The maternal-health router is intact and mounted where it used to be.
 *
 * Twenty-three routes moved out of `createApp` into their own module. A move
 * like that can go wrong in ways no type can catch: a route dropped in the
 * cut-and-paste, a path that loses its `/api` prefix or gains it twice, a
 * router that is exported and never mounted. All of those compile.
 *
 * The evidence for this refactor was a route-inventory diff: the app's
 * direct route table held 138 pairs before and 115 after, the 23 removed
 * were exactly the maternity and immunisation pairs, and the new router's
 * 23 pairs matched them one for one. This file keeps the result of that
 * diff as a test, so the next person does not have to run it again.
 *
 * On the mount prefix: Express does not expose a sub-router's mount path as
 * a property, but the layer does carry the compiled `regexp` used to match
 * it. A router mounted at '/api' produces a regexp that accepts
 * '/api/maternity/summary' and rejects '/maternity/summary'; a root mount
 * would accept both. That is how the mount is checked rather than assumed.
 */

import { describe, expect, it } from 'vitest';

import maternalHealthRoutes from '../../routes/maternal-health.routes.ts';

const { createApp } = await import('../../app.ts');

type Layer = {
  name: string;
  regexp?: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

const stackOf = (router: unknown): Layer[] => {
  const r = router as { stack?: Layer[]; _router?: { stack?: Layer[] } };

  return r.stack ?? r._router?.stack ?? [];
};

function collectRoutes(router: unknown): string[] {
  const found: string[] = [];

  for (const layer of stackOf(router)) {
    if (layer.route) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) found.push(`${method.toUpperCase()} ${layer.route.path}`);
      }

      continue;
    }

    if (layer.handle?.stack) found.push(...collectRoutes(layer.handle));
  }

  return found.sort();
}

/**
 * Every route these modules had before the move, written as they appeared
 * in the app's route table — absolute, including the `/api` prefix.
 */
const EXPECTED = [
  'GET /api/immunisation/card',
  'GET /api/immunisation/due',
  'GET /api/immunisation/records',
  'GET /api/immunisation/schedule',
  'GET /api/maternity/deliveries',
  'GET /api/maternity/deliveries/:id',
  'GET /api/maternity/labours',
  'GET /api/maternity/labours/:id',
  'GET /api/maternity/postnatal',
  'GET /api/maternity/pregnancies',
  'GET /api/maternity/pregnancies/:id',
  'GET /api/maternity/pregnancies/:id/anc-visits',
  'GET /api/maternity/pregnancies/:id/postnatal',
  'GET /api/maternity/summary',
  'PATCH /api/maternity/labours/:id',
  'PATCH /api/maternity/pregnancies/:id',
  'POST /api/immunisation/records',
  'POST /api/maternity/anc-visits',
  'POST /api/maternity/deliveries',
  'POST /api/maternity/labours',
  'POST /api/maternity/partograph',
  'POST /api/maternity/postnatal',
  'POST /api/maternity/pregnancies',
].sort();

const routerRoutes = collectRoutes(maternalHealthRoutes).map((route) => {
  const [method, path] = route.split(' ');

  return `${method} /api${path}`;
});

describe('maternal health router', () => {
  it('carries all 23 moved routes and no others', () => {
    expect(routerRoutes.sort()).toStrictEqual(EXPECTED);
  });

  it('has no duplicate method-and-path pair', () => {
    /* Express accepts a duplicate and silently never reaches the second
       handler, so a copy that was pasted rather than moved is invisible at
       runtime. */
    const duplicates = routerRoutes.filter((route, i) => routerRoutes.indexOf(route) !== i);

    expect(duplicates).toStrictEqual([]);
  });

  it.each(['maternity', 'immunisation'])('serves /api/%s paths only', (prefix) => {
    const own = routerRoutes.filter((route) => route.split(' ')[1].startsWith(`/api/${prefix}/`));

    expect(own.length).toBe(prefix === 'maternity' ? 18 : 5);
  });

  it('is mounted on the app at /api, not at the root', async () => {
    const app = await createApp();

    /* Find the mounted router that owns a maternity route, then inspect the
       layer's own match regexp. */
    const mounts = stackOf(app).filter(
      (layer) =>
        !layer.route &&
        layer.handle?.stack?.some((inner) => inner.route?.path === '/maternity/summary'),
    );

    expect(mounts, 'the maternal-health router should be mounted exactly once').toHaveLength(1);

    const [mount] = mounts;

    expect(mount.regexp, 'a mounted router carries its match regexp').toBeTruthy();
    expect(mount.regexp!.test('/api/maternity/summary')).toBe(true);
    expect(
      mount.regexp!.test('/maternity/summary'),
      'mounted at the root - the /api prefix would be missing and every route would 404',
    ).toBe(false);
  });
});
