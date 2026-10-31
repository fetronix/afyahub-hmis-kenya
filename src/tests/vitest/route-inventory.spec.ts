/**
 * Route inventory — is every domain actually mounted?
 *
 * The route tables used to be inline in `createApp`. They moved into
 * `src/routes/index.ts`, and that move is the kind that fails quietly: a
 * router whose mount was dropped simply stops existing, the server still
 * boots, and every source-text test that searches `src/routes/index.ts` for
 * a gate still passes because the gate is still written there.
 *
 * That is not hypothetical. The first version of the extraction deleted the
 * maternal-health and inpatient mounts, and nothing but a hand-run route
 * dump noticed.
 *
 * So this suite walks the real Express app that `createApp()` builds and
 * asserts that an anchor route from each domain family is present. It does
 * not care how the routes are registered - inline, in a router, split across
 * two files - only that a caller could reach them.
 *
 * What the walk can and cannot see, because the difference matters:
 *
 *   - A route registered with an absolute path keeps it. Every inline route
 *     is registered as `/api/...`, so those anchors are the full path and a
 *     mount that disappears takes its anchor with it.
 *   - A nested router's routes keep only their router-relative path. The
 *     prefix lives on the parent layer, not on the route, so a router
 *     mounted at `/wards` and one mounted at `/bogus` both report `GET /`.
 *     That is why the prefixed routers below are asserted by their *own*
 *     specs (`platform-router.spec.ts` and friends) and by the `api.use`
 *     source assertions in the legacy suites, and why only the two routers
 *     mounted at the API root are anchored here: with no prefix, there is
 *     no prefix to get wrong, and a dropped mount still shows up.
 *
 * No database is required: building the app registers routes without
 * connecting to anything.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';

const { createApp } = await import('../../app.ts');

type Layer = {
  regexp?: RegExp & { fast_slash?: boolean };
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

let appRoutes: string[];
let effectiveRoutes: string[];

function extractMountPrefix(regexp?: RegExp & { fast_slash?: boolean }): string {
  if (!regexp || regexp.fast_slash) return '';

  const prefix = regexp.source
    .replace('^\\/', '/')
    .replace('\\/?(?=\\/|$)', '')
    .replace('(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');

  return prefix === '^' ? '' : prefix;
}

/** Route paths reachable from the app, as registered by their routers. */
function collectRoutes(layers: Layer[]): string[] {
  const found: string[] = [];

  for (const layer of layers) {
    if (layer.route && typeof layer.route === 'object' && layer.route.methods) {
      for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
        if (enabled) found.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      found.push(...collectRoutes(layer.handle.stack));
    }
  }

  return found;
}

/** Effective public URLs, including every parent router's mount prefix. */
function collectEffectiveRoutes(layers: Layer[], prefix = ''): string[] {
  const found: string[] = [];

  for (const layer of layers) {
    if (layer.route && typeof layer.route === 'object' && layer.route.methods) {
      const fullPath = `${prefix}${layer.route.path}`.replace(/\/{2,}/g, '/');

      for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
        if (enabled) found.push(`${method.toUpperCase()} ${fullPath}`);
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      const childPrefix = extractMountPrefix(layer.regexp);

      found.push(...collectEffectiveRoutes(layer.handle.stack, `${prefix}${childPrefix}`));
    }
  }

  return found;
}

beforeAll(async () => {
  const app = (await createApp()) as unknown as { stack?: Layer[]; _router?: { stack: Layer[] } };
  const stack = app.stack ?? app._router?.stack ?? [];

  appRoutes = collectRoutes(stack);
  effectiveRoutes = collectEffectiveRoutes(stack);
});

describe('the API router', () => {
  it('is mounted at /api by the app', () => {
    const app = readFileSync(resolve(import.meta.dirname, '../../app.ts'), 'utf8');

    expect(app).toContain("app.use('/api', createApiRoutes())");
  });

  it('registers the bulk of the surface', () => {
    /*
     * A floor, not a target. `createApp` registers far more than this; the
     * number exists so that a mount accidentally nested one level too deep
     * - or removed outright - fails here rather than in production.
     */
    expect(appRoutes.length).toBeGreaterThan(150);
  });
});

describe('every inline domain is still reachable', () => {
  /*
   * One anchor per family whose routes are still registered in the API
   * router with absolute paths. When those routes move into a router of
   * their own, the anchor moves with them and this list is updated - the
   * assertion itself does not change.
   */
  const anchors = [
    // Administrator surfaces.
    ['platform tenants', 'GET /api/tenants'],
    ['facility administration', 'GET /api/facilities'],
    // Patient and clinical records.
    ['patients', 'GET /api/patients'],
    ['encounters', 'GET /api/encounters'],
    ['observations', 'GET /api/observations'],
    ['diagnoses', 'GET /api/diagnoses'],
    ['medications', 'GET /api/medications'],
    // Diagnostics and pharmacy.
    ['laboratory', 'GET /api/lab-tests'],
    ['radiology', 'GET /api/radiology-orders'],
    ['pharmacy', 'POST /api/pharmacy/dispense'],
    ['inventory', 'GET /api/inventory/batches'],
    // Money.
    ['billing', 'POST /api/invoices'],
    ['claims', 'POST /api/claims'],
    ['facility tariffs', 'GET /api/facility-tariffs'],
    // Reporting, interoperability and audit.
    ['reporting', 'GET /api/reporting/operations'],
    ['analytics', 'GET /api/analytics/revenue'],
    ['DHA integration', 'GET /api/integrations/dha/readiness'],
    ['audit trail', 'GET /api/audit-logs'],
  ] as const;

  for (const [family, route] of anchors) {
    it(`serves ${family}`, () => {
      expect(appRoutes).toContain(route);
      expect(effectiveRoutes).toContain(route);
    });
  }

  it('keeps master catalogue, synchronisation and approval endpoints unmounted', () => {
    const retired = [
      '/api/master-tariffs',
      '/api/master-tariff-sources',
      '/api/master-tariff-aliases',
      '/api/master-services',
      '/api/master-lab-specimens',
    ];
    expect(
      effectiveRoutes.filter((route) =>
        retired.some((prefix) => route.split(' ')[1]?.startsWith(prefix)),
      ),
    ).toEqual([]);
  });

  it('never doubles the /api mount prefix into /api/api/...', () => {
    const doubled = effectiveRoutes.filter((route) => route.includes('/api/api/'));

    expect(doubled).toStrictEqual([]);
  });
});

describe('the routers mounted at the API root are still mounted', () => {
  /*
   * `inpatientRoutes` and `maternalHealthRoutes` are mounted with no prefix,
   * so their registered paths are already the paths a caller sees. Removing
   * either mount removes every anchor below.
   */
  const anchors = [
    ['inpatient wards', 'GET /wards'],
    ['inpatient admissions', 'GET /admissions'],
    ['nursing notes', 'GET /nursing-notes'],
    ['maternal health', 'GET /maternity/summary'],
    ['immunisation', 'GET /immunisation/schedule'],
  ] as const;

  for (const [family, route] of anchors) {
    it(`serves ${family}`, () => {
      expect(appRoutes).toContain(route);
    });
  }
});
