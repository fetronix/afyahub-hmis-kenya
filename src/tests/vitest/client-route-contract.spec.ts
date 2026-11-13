/**
 * Every URL the browser client builds must exist on the server.
 *
 * Why this exists: three screens called endpoints that had been retired with
 * no replacement (family/alias tariff matching, the old tariff-validation
 * report) and two called endpoints that had been *written but never mounted*
 * (the catalogue → tariff link router, the laboratory diagnostics report).
 * None of that shows up in a type check — the client is typed against
 * interfaces, not against the router — and none of it shows up in the server
 * test suite, which never asks what the browser calls. It shows up when
 * somebody opens the screen and it silently shows nothing.
 *
 * The route table below is the real one: `createApp()` is constructed and its
 * Express router is walked, so a route counts only if it is genuinely
 * registered. A client method pointing at nothing fails this test unless it is
 * named in `RETIRED` with the surface it belonged to — and that list is only
 * allowed to shrink, because every entry is a dead end in the UI.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

interface RegisteredRoute {
  method: string;
  path: string;
}

interface ClientMethod {
  file: string;
  name: string;
  method: string;
  path: string;
}

/**
 * Methods that point at a surface this product has deliberately retired.
 *
 * Each one is a known dead end: the server answers 404 by design, and the test
 * that asserts the 404 is named here. The only two honest futures for an entry
 * are "re-point it at the live replacement" or "delete the method"; nothing
 * may be added to this list without a retired surface and a test that proves
 * the retirement.
 */
const RETIRED: Record<string, string> = {
  getReviewedLabSpecimens:
    'master tariff catalogue retired (master-tariffs-workflow.db.spec asserts /api/master-tariffs 404)',
  addReviewedLabSpecimen:
    'master tariff catalogue retired (master-tariffs-workflow.db.spec asserts /api/master-tariffs 404)',
  retireReviewedLabSpecimen:
    'master tariff catalogue retired (master-tariffs-workflow.db.spec asserts /api/master-tariffs 404)',
  getClinicalCatalogue:
    'master service catalogue retired (facility-owned-billing.db.spec asserts /api/master-tariffs 404)',
  getRadiologyMasterServices:
    'master service catalogue retired (facility-owned-billing.db.spec asserts /api/master-tariffs 404)',
  getFacilityTariffValidation:
    'tariff-validation report retired (billing-posting.db.spec asserts 404); the evaluator is still used server-side',
  seedData: 'there is no /api/seed endpoint; demo seeding is a CLI, not a route',
  explainTariffMatch:
    'family/alias tariff matching retired in favour of catalogue → tariff links; the screen now explains from the stored attempt',
};

/** Walk an Express 4 router into `{ method, path }` rows. */
function routesFrom(app: unknown): RegisteredRoute[] {
  const out: RegisteredRoute[] = [];

  interface Layer {
    route?: { path: string; methods?: Record<string, boolean> };
    handle?: { stack?: Layer[] };
    regexp?: RegExp;
  }

  // `app.use('/api/auth', r)` hides the mount path inside a regexp source such
  // as `^\/api\/auth\/?(?=\/|$)`; there is no other public way to read it.
  const mountOf = (layer: Layer): string => {
    const source = layer.regexp?.source;
    if (!source) return '';
    const match = /^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/.exec(source);
    return match ? `/${match[1].replace(/\\\//g, '/')}` : '';
  };

  const walk = (stack: Layer[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        if (!layer.route.methods) continue;
        const path = layer.route.path;
        const full = `${prefix}${path === '/' ? '' : path}` || '/';
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) out.push({ method: method.toUpperCase(), path: full });
        }
        continue;
      }

      if (layer.handle?.stack) walk(layer.handle.stack, prefix + mountOf(layer));
    }
  };

  walk((app as { _router: { stack: Layer[] } })._router.stack, '');

  return out;
}

/**
 * `\${API_BASE}/x/\${id}` → `/api/x/:param`, so ids match the route's `:id`.
 *
 * A URL built with a nested template — `` `${API_BASE}/invoices${query ? `?${q}` : ''}` ``
 * — ends the string capture at the inner backtick, so anything from an
 * unterminated interpolation onwards is discarded rather than guessed at.
 */
function normalisePath(raw: string): string {
  const path = raw.replace(/\$\{(?:API_BASE|API_URL)\}/g, '/api');

  /*
   * A `${...}` is part of the path only when it follows a slash — that is how
   * every id in this client is written (`/invoices/${id}`). Anything else is a
   * query suffix (`…/accrue-bed-days${facilityQuery(facilityId)}`) or a query
   * built from a nested template, and both end the path.
   */
  let result = '';
  let index = 0;
  while (index < path.length) {
    const open = path.indexOf('${', index);
    if (open === -1) {
      result += path.slice(index);
      break;
    }
    result += path.slice(index, open);
    if (!result.endsWith('/')) break;

    const close = path.indexOf('}', open);
    if (close === -1) break;
    result += ':param';
    index = close + 1;
  }

  const clean = result.split('?')[0];
  if (!clean.startsWith('/')) return `/${clean}`;
  return (clean.startsWith('/api') ? clean : `/api${clean}`).replace(/\/$/, '');
}

const CLIENT_FILES = [
  'src/api/clients/auth.client.ts',
  'src/api/clients/billing.client.ts',
  'src/api/clients/dashboard.client.ts',
  'src/api/clients/diagnostics-pharmacy.client.ts',
  'src/api/clients/fixed-assets.client.ts',
  'src/api/clients/inpatient.client.ts',
  'src/api/clients/inventory-control.client.ts',
  'src/api/clients/maternity.client.ts',
  'src/api/clients/notifications.client.ts',
  'src/api/clients/patients-clinical.client.ts',
  'src/api/clients/platform.client.ts',
  'src/api/clients/procurement-workflow.client.ts',
  'src/api/clients/theatre.client.ts',
  'src/api/clients/workforce.client.ts',
  'src/api/clients/approval-policy.client.ts',
];

/**
 * Reads `name: (args) => fetchJson(... `${API_BASE}/path` ...)`.
 *
 * The method is taken from the object literal's key, so an entry that builds
 * its URL inside a helper is reported rather than silently skipped.
 */
function clientMethods(): ClientMethod[] {
  const found: ClientMethod[] = [];

  for (const file of CLIENT_FILES) {
    const source = readFileSync(resolve(ROOT, file), 'utf8');

    // Split on the object-literal keys at two-space indentation, so each body
    // is exactly one method. A shared 1.8 kB window bled the next method's
    // `method: 'POST'` into a getter and made every other line look broken.
    // `name: (…) =>` and `name: async (…) =>` are both method definitions; the
    // second form was missed at first, which bled the next method's `method:`
    // into a getter and reported a GET as a POST.
    const starts = [...source.matchAll(/\n {2}([a-zA-Z][a-zA-Z0-9]*): (?:async )?\(/g)];
    for (const [index, entry] of starts.entries()) {
      const next = starts[index + 1];
      const body = source.slice(entry.index ?? 0, next ? next.index : undefined);

      const url = /`\$\{API_BASE\}([^`]*)`/.exec(body) ?? /`(\/api\/[^`]*)`/.exec(body);
      if (!url) continue;

      const call = /\bmethod: '([A-Z]+)'/.exec(body);

      found.push({
        file,
        name: entry[1],
        method: call ? call[1] : 'GET',
        path: normalisePath(url[1]),
      });
    }
  }

  return found;
}

function hasRoute(routes: RegisteredRoute[], path: string, method?: string): boolean {
  const wanted = path.split('/').filter(Boolean);

  return routes.some((route) => {
    if (method && route.method !== method && route.method !== 'ALL') return false;
    const have = route.path.split('/').filter(Boolean);
    if (have.length !== wanted.length) return false;

    return have.every(
      (segment, index) =>
        segment === '*' ||
        segment.startsWith(':') ||
        wanted[index].startsWith(':param') ||
        segment === wanted[index],
    );
  });
}

describe('browser client ↔ server route contract', () => {
  let methods: ClientMethod[];
  let routes: RegisteredRoute[];

  const load = async () => {
    if (routes) return;
    /*
     * `createApp` decides at import time whether to mount the Vite dev
     * middleware. Loading it as "production" keeps this test to the router and
     * out of the bundler; the routes are identical either way.
     */
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { createApp } = await import('../../app.ts');
      routes = routesFrom(await createApp());
    } finally {
      process.env.NODE_ENV = previous;
    }
    methods = clientMethods();
  };

  it('finds the client methods and the server routes', async () => {
    await load();

    // Guards the two parsers: a refactor that changes either shape must not
    // make every assertion below vacuous.
    expect(methods.length).toBeGreaterThan(250);
    expect(routes.length).toBeGreaterThan(400);
    expect(routes.some((route) => route.path === '/api/patients')).toBe(true);
  });

  it('points every live client method at a route that exists', async () => {
    await load();

    const dead = methods
      .filter((entry) => !(entry.name in RETIRED))
      .filter((entry) => !hasRoute(routes, entry.path, entry.method))
      .map((entry) => `${entry.file}: ${entry.name} → ${entry.method} ${entry.path}`);

    expect(dead, `client methods with no server route:\n${dead.join('\n')}`).toEqual([]);
  });

  it('keeps the retired list honest — nothing dead is hiding in it', async () => {
    await load();

    for (const name of Object.keys(RETIRED)) {
      const entry = methods.find((candidate) => candidate.name === name);
      // An entry for a method that no longer exists is stale scaffolding that
      // would hide the next real gap under a familiar name.
      expect(entry, `RETIRED names ${name}, which no client defines`).toBeDefined();
      expect(
        hasRoute(routes, entry!.path, entry!.method),
        `RETIRED names ${name}, but ${entry!.method} ${entry!.path} now exists — remove the exemption`,
      ).toBe(false);
    }
  });

  it('keeps the screens that were repaired working', async () => {
    await load();

    /*
     * These four were broken and are the reason the guard exists; asserting
     * them by name means a future refactor cannot quietly unmount them again.
     */
    for (const [method, path] of [
      ['GET', '/api/service-tariff-links'],
      ['POST', '/api/service-tariff-links'],
      ['PATCH', '/api/service-tariff-links/:param/deactivate'],
      ['GET', '/api/billing/lab-service-diagnostics'],
    ] as const) {
      expect(hasRoute(routes, path, method), `${method} ${path} is not registered`).toBe(true);
    }
  });
});
