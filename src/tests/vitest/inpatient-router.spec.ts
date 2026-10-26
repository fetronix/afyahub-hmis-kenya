/**
 * The inpatient router is intact and mounted where it used to be.
 *
 * Twenty-two routes — wards, beds, admissions, transfers, discharge, the
 * ward board, admission vitals and the nursing record — moved out of
 * `createApp`. This is the module where the consequences of a bad move are
 * least visible and most expensive:
 *
 *   - a dropped `POST /api/admissions/:id/discharge` leaves patients
 *     admitted in the system after they have gone home;
 *   - a dropped `POST /api/admissions/:id/accrue-bed-days` stops the nightly
 *     billing job without erroring, so nights stop being charged;
 *   - a dropped `PUT /api/beds/:id/release` leaves a bed occupied after
 *     discharge and the ward board overstates occupancy.
 *
 * None of those throw. The route simply is not there.
 *
 * The evidence for this refactor was a route-inventory diff: the app's
 * direct table held 115 pairs before and 93 after, the 22 removed were
 * exactly these pairs, and the new router's 22 matched them one for one.
 * This file keeps that result.
 *
 * On the mount prefix: Express does not expose a sub-router's mount path,
 * but the layer carries the compiled `regexp` it matches with. Mounted at
 * '/api' it accepts '/api/wards' and rejects '/wards'; mounted at the root
 * it accepts both.
 */

import { describe, expect, it } from 'vitest';

import inpatientRoutes from '../../routes/inpatient.routes.ts';
import { findMounts, mountChain } from './support/express-stack.ts';

const { createApp } = await import('../../app.ts');

type Layer = {
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

/** The routes as a client calls them — absolute, with the `/api` prefix. */
const EXPECTED = [
  'DELETE /api/beds/:id',
  'DELETE /api/wards/:id',
  'GET /api/admissions',
  'GET /api/admissions/:id/transfers',
  'GET /api/admissions/:id/vitals',
  'GET /api/beds',
  'GET /api/inpatient/board',
  'GET /api/nursing-notes',
  'GET /api/nursing-notes/handover',
  'GET /api/wards',
  'POST /api/admissions',
  'POST /api/admissions/:id/accrue-bed-days',
  'POST /api/admissions/:id/discharge',
  'POST /api/admissions/:id/transfer',
  'POST /api/admissions/:id/vitals',
  'POST /api/beds',
  'POST /api/nursing-notes',
  'POST /api/wards',
  'PUT /api/beds/:id',
  'PUT /api/beds/:id/release',
  'PUT /api/beds/:id/status',
  'PUT /api/wards/:id',
].sort();

const routerRoutes = collectRoutes(inpatientRoutes).map((route) => {
  const [method, path] = route.split(' ');

  return `${method} /api${path}`;
});

describe('inpatient router', () => {
  it('carries all 22 moved routes and no others', () => {
    expect(routerRoutes.sort()).toStrictEqual(EXPECTED);
  });

  it('has no duplicate method-and-path pair', () => {
    const duplicates = routerRoutes.filter((route, i) => routerRoutes.indexOf(route) !== i);

    expect(duplicates).toStrictEqual([]);
  });

  it.each([
    'POST /api/admissions/:id/discharge',
    'POST /api/admissions/:id/transfer',
    'POST /api/admissions/:id/accrue-bed-days',
    'PUT /api/beds/:id/release',
  ])('keeps %s, which stops care or billing silently if it disappears', (route) => {
    expect(routerRoutes).toContain(route);
  });

  it('is mounted on the app at /api, not at the root', async () => {
    const app = await createApp();

    /*
     * The router is mounted inside the API router now, so it sits one level
     * deeper than the app's own stack. The chain still starts at a single
     * outermost mount, and that is the layer whose regexp decides whether
     * `/api` is present.
     */
    expect(
      findMounts(app, '/wards'),
      'the inpatient router should be mounted exactly once',
    ).toHaveLength(1);

    const chain = mountChain(app, '/wards');

    expect(chain, 'the inpatient router is reachable from the app').toBeDefined();

    const [mount] = chain!;

    expect(mount.regexp, 'a mounted router carries its match regexp').toBeTruthy();
    expect(mount.regexp!.test('/api/wards')).toBe(true);
    expect(
      mount.regexp!.test('/wards'),
      'mounted at the root - the /api prefix would be missing and every route would 404',
    ).toBe(false);
  });
});
