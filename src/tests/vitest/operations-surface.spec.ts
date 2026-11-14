/**
 * Operational surface: the claims the runbook makes, checked against the code.
 *
 * This suite runs no server and needs no database. It exists because "we have
 * monitoring" is usually a statement about files: a health route in one file, a
 * HEALTHCHECK string in a Dockerfile, a runbook paragraph nobody re-read. Each
 * assertion below pins one sentence of
 * `docs/deployment/operations-runbook.md` to the code that must make it true,
 * so the document cannot drift away from the software without failing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('operations surface', () => {
  it('keeps liveness and readiness separate, and both public', () => {
    const system = read('src/routes/system.routes.ts');

    expect(system).toContain("router.get('/health'");
    expect(system).toContain("router.get('/ready'");

    // Liveness must never depend on the database: an orchestrator restarting a
    // healthy process because PostgreSQL blinked turns a blip into an outage.
    const health = system.slice(
      system.indexOf("router.get('/health'"),
      system.indexOf("router.get('/ready'"),
    );
    expect(health).not.toMatch(/db\.execute|SELECT 1/);

    // Readiness must actually touch the database and must answer 503 when it
    // cannot.
    const ready = system.slice(system.indexOf("router.get('/ready'"));
    expect(ready).toMatch(/SELECT 1/);
    expect(ready).toContain('503');

    // The error detail belongs in the log, not in a public response.
    expect(ready).toContain('readiness.database_unreachable');
  });

  it('does not mount /api/ops on the public system router', () => {
    const app = read('src/app.ts');
    const index = read('src/routes/index.ts');
    expect(app).not.toMatch(/app\.use\('\/api\/(ops|operations)/);
    expect(index).toMatch(/api\.use\('\/ops', operationsRoutes\)/);
    // api.use in routes/index.ts runs after requireAuth, which app.ts mounts on
    // /api before handing over.
    expect(app.indexOf("app.use('/api', requireAuth)")).toBeLessThan(
      app.indexOf('createApiRoutes('),
    );
  });

  it('shuts down on the signals a supervisor actually sends', () => {
    const server = read('server.ts');
    for (const signal of ['SIGINT', 'SIGTERM']) expect(server).toContain(`process.on('${signal}'`);
    expect(server).toContain("process.on('unhandledRejection'");
    expect(server).toContain("process.on('uncaughtException'");
    // A shutdown that can hang is worse than an abrupt one: the supervisor
    // SIGKILLs and the next instance fights for the port.
    expect(server).toMatch(/10_000|10000/);
    expect(server).toContain('process.exit(1)');
  });

  it('bounds request bodies and rate-limits the API', () => {
    const app = read('src/app.ts');
    const security = read('src/middleware/http-security.middleware.ts');

    expect(security).toContain('createApiRateLimiter');
    expect(security).toContain('createAuthRateLimiter');
    // The origin list is an allowlist, never a reflection of whatever asks.
    expect(security).toMatch(/isOriginAllowed/);
    expect(security).not.toMatch(/origin:\s*true/);
    expect(app).toMatch(/express\.json\(\{[^}]*limit/s);
  });

  it('keeps operational counters free of identity and free text', () => {
    const service = read('src/operations/operations-status.service.ts');
    // The select projections are what get serialised; they must not include a
    // name, an MRN or a free-text column.
    expect(service).not.toMatch(/patients\.(firstName|lastName|mrn)/);
    expect(service).not.toMatch(/\.summary,?\s*$/m);
    expect(service).toContain('no patient, staff, amount or free-text field is returned');
  });

  it('does not invent an alerting or metrics endpoint', () => {
    const app = read('src/app.ts');
    const index = read('src/routes/index.ts');
    // If someone adds one, the runbook has to be updated with it — the failing
    // assertion is the reminder, not a prohibition.
    expect(app + index).not.toMatch(/app\.use\('\/metrics'|api\.use\('\/metrics'/);
  });

  it('points the container HEALTHCHECK at readiness, not liveness', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/ready');
    // Liveness inside a container would keep a database-less process "healthy".
    expect(dockerfile).not.toMatch(/HEALTHCHECK[^\n]*\/api\/health/);
  });

  it('keeps the operations runbook honest about what is not implemented', () => {
    const runbook = read('docs/deployment/operations-runbook.md');
    expect(runbook).toMatch(/Alert delivery\s*\|\s*\*\*Not implemented/i);
    expect(runbook).toMatch(/Metrics scraping/i);
    expect(runbook).toMatch(/HOST ACTION/);
    // The two facts most likely to be overstated in a sales conversation.
    expect(runbook).toMatch(/not.*exercised on a production host/i);
    expect(runbook).toMatch(/no facility has\s+accepted it/i);
  });
});
