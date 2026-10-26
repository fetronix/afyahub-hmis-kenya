/**
 * Reading an Express router stack in tests.
 *
 * Express does not expose a sub-router's mount path, so the specs that care
 * about mounting have to walk the layer tree themselves. Two facts about
 * that tree matter here:
 *
 *   - A router mounted with `app.use(router)` or `app.use('/api', router)`
 *     is a layer with no `route` of its own and a `handle.stack` holding the
 *     router's layers.
 *   - That layer carries the compiled `regexp` Express matches requests
 *     against. A layer mounted at '/api' accepts '/api/wards' and rejects
 *     '/wards'; a layer mounted at the root accepts both.
 *
 * So finding the layer that mounts a router, and testing its regexp, is the
 * only structural way to prove the router is reachable at the path the
 * client calls. A router nested one level deeper than expected still traces
 * back to a single outermost mount - that is the layer whose regexp decides
 * whether the `/api` prefix is present.
 */

type Layer = {
  regexp?: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

export function stackOf(router: unknown): Layer[] {
  const r = router as { stack?: Layer[]; _router?: { stack?: Layer[] } };

  return r.stack ?? r._router?.stack ?? [];
}

/**
 * Every layer at any depth whose child stack directly registers `routePath`.
 *
 * "Directly" is the point: nested routers report router-relative paths, so
 * the layer that owns `'/wards'` is the inpatient router's own mount, not
 * some ancestor that happens to contain it.
 */
export function findMounts(router: unknown, routePath: string): Layer[] {
  const found: Layer[] = [];

  for (const layer of stackOf(router)) {
    if (layer.route || !layer.handle?.stack) continue;

    if (layer.handle.stack.some((inner) => inner.route?.path === routePath)) found.push(layer);

    found.push(...findMounts(layer.handle, routePath));
  }

  return found;
}

/**
 * The outermost-to-innermost chain of layers that reaches `routePath`.
 *
 * The first element is the mount on the app; the last is the router that
 * registers the path. Undefined when the path is not mounted at all.
 */
export function mountChain(
  router: unknown,
  routePath: string,
  chain: Layer[] = [],
): Layer[] | undefined {
  for (const layer of stackOf(router)) {
    if (layer.route || !layer.handle?.stack) continue;

    const next = [...chain, layer];

    if (layer.handle.stack.some((inner) => inner.route?.path === routePath)) return next;

    const deeper = mountChain(layer.handle, routePath, next);

    if (deeper) return deeper;
  }

  return undefined;
}
