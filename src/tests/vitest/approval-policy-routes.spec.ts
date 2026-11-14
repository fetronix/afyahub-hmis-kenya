/**
 * Registration of the approval-policy routes.
 *
 * The audit that started this batch found the router written but never mounted:
 * the service, the guards and the SQL were all in place, and every request to
 * `/api/approval-policies` fell through to the 404 handler. Nothing failed,
 * because nothing ran. This file exists so that cannot happen silently again.
 *
 * It is deliberately structural and database-free: it inspects the Express
 * routers after construction, which catches the exact class of failure the
 * audit found (a correct router that nobody mounted) without needing a server
 * or a database.
 *
 * What it does not prove: that a real account is let through. That is the job of
 * `src/tests/integration/approval-policy.db.spec.ts`, which drives the mounted
 * app over HTTP against real PostgreSQL.
 */
import { Router } from 'express';
import { describe, expect, it } from 'vitest';

import approvalPolicyRoutes from '../../routes/approval-policy.routes.ts';
import { createDomainRoutes } from '../../routes/index.ts';

type Layer = {
  name: string;
  handle: unknown;
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name?: string } }>;
  };
};

type Stacked = { stack: Layer[] };

/** Every route in a router, as "METHOD /path". */
function routesOf(router: Router): Array<{ key: string; handlerCount: number; guard: string }> {
  const stack = (router as unknown as Stacked).stack ?? [];
  return stack
    .filter((layer) => layer.route)
    .flatMap((layer) => {
      const route = layer.route!;
      return Object.keys(route.methods)
        .filter((method) => route.methods[method])
        .map((method) => ({
          key: `${method.toUpperCase()} ${route.path}`,
          handlerCount: route.stack.length,
          guard: route.stack[0]?.handle?.name ?? '<anonymous>',
        }));
    });
}

/** Depth-first search of a router tree for a mounted sub-router by identity. */
function countMounted(tree: Router, target: unknown): number {
  const stack = (tree as unknown as Stacked).stack ?? [];
  let count = 0;
  for (const layer of stack) {
    if (layer.handle === target) count += 1;
    const nested = layer.handle as Stacked | undefined;
    if (nested && Array.isArray(nested.stack))
      count += countMounted(layer.handle as Router, target);
  }
  return count;
}

const EXPECTED = [
  'GET /api/approval-policies',
  'GET /api/approval-policies/preview',
  'POST /api/approval-policies',
  'PUT /api/approval-policies/:id',
];

describe('approval-policy route registration', () => {
  it('registers each management route exactly once', () => {
    const registered = routesOf(approvalPolicyRoutes).map((route) => route.key);

    for (const key of EXPECTED) {
      expect(
        registered.filter((entry) => entry === key),
        `${key} registration count`,
      ).toHaveLength(1);
    }
    /* Nothing else was bolted on: the surface is exactly these four routes. */
    expect(registered.sort()).toEqual([...EXPECTED].sort());
  });

  it('guards every route with a permission check before its handler', () => {
    for (const route of routesOf(approvalPolicyRoutes)) {
      /*
       * `requireAnyPermission` returns a function named `permissionMiddleware`.
       * If a route ever loses its guard, the first handler stops being a guard
       * and the route becomes reachable by any authenticated account.
       */
      expect(route.guard, `${route.key} guard`).toBe('permissionMiddleware');
      expect(route.handlerCount, `${route.key} handler count`).toBeGreaterThanOrEqual(2);
    }
  });

  it('is mounted in the domain router exactly once', () => {
    const domains = createDomainRoutes();
    expect(countMounted(domains, approvalPolicyRoutes)).toBe(1);

    /*
     * Negative control. Without this, a walker that silently found nothing
     * would still be satisfied by a mount that silently disappeared.
     */
    expect(countMounted(domains, Router())).toBe(0);
  });

  it('does not double-register the paths it owns through any other mount', () => {
    /*
     * Two routers answering the same path is how a fix silently stops taking
     * effect: Express calls the first match, so the second looks dead in the
     * source and is dead in production. Counted across the whole tree.
     */
    const seen: string[] = [];
    const walk = (tree: Router) => {
      for (const route of routesOf(tree)) seen.push(route.key);
      for (const layer of (tree as unknown as Stacked).stack ?? []) {
        const nested = layer.handle as Stacked | undefined;
        if (nested && Array.isArray(nested.stack)) walk(layer.handle as Router);
      }
    };
    walk(createDomainRoutes());

    for (const key of EXPECTED) {
      expect(
        seen.filter((entry) => entry === key),
        `${key} across the domain tree`,
      ).toHaveLength(1);
    }
  });
});
