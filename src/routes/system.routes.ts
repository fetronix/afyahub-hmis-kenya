/**
 * System routes — health and readiness
 *
 * The first module extracted from `app.ts` under the incremental refactor
 * plan, chosen because it is the smallest thing in that file with a clear
 * boundary: two unauthenticated endpoints, no tenant scope, no permission
 * check, no clinical state.
 *
 * WHY EXTRACT AT ALL
 *
 * `app.ts` is 8,300 lines and holds the schema-independent half of the
 * application: middleware, every route, and the SPA fallback. Nobody can
 * hold it in their head, so every change to it is made with a search and a
 * hope. The plan is domain by domain, each extraction with its own commit
 * and a green test run, leaving the routes that are entangled with
 * `schema.ts` until that file has been split too — moving a route that
 * depends on forty tables just relocates the problem.
 *
 * WHAT MUST NOT CHANGE
 *
 * The paths, the response shapes and the fact that both are public. These
 * are wired into deployment health checks, container HEALTHCHECKs and
 * whatever an uptime monitor was pointed at. The existing test suite drives
 * them over HTTP, so a path change fails the build rather than a monitor.
 *
 * TWO ENDPOINTS, TWO QUESTIONS
 *
 *   /api/health  is the process alive?        Always 200. Restart decision.
 *   /api/ready   can this instance work?      200 or 503. Traffic decision.
 *
 * Collapsing them into one is the common mistake: an orchestrator that
 * restarts a container because the database is briefly unavailable turns a
 * database blip into an outage, and a proxy that routes to a process with no
 * database sends real requests into failures.
 */

import express from 'express';
import { sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { moduleLogger } from '../logging/logger.ts';

const log = moduleLogger('system');

/**
 * How long a readiness answer is reused.
 *
 * Every orchestrator polls this every few seconds, and every proxy in front
 * of it may too. Uncached, the readiness probe becomes the busiest query in
 * the system, and a probe that causes load is a probe that causes the
 * outage it is meant to detect.
 *
 * Two seconds is short enough that a recovered database is noticed before a
 * proxy gives up on the instance.
 */
const READINESS_CACHE_MS = 2_000;

export function createSystemRouter(): express.Router {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      system: 'JaliCare Kenya HMIS',
      dhaReadiness: 'Not assessed',
      timestamp: new Date().toISOString(),
    });
  });

  let cached: { at: number; ok: boolean; latencyMs: number } | null = null;

  router.get('/ready', async (req, res) => {
    const started = Date.now();

    if (cached && started - cached.at < READINESS_CACHE_MS) {
      res.status(cached.ok ? 200 : 503).json({
        status: cached.ok ? 'ready' : 'not_ready',
        checks: {
          database: {
            status: cached.ok ? 'up' : 'down',
            latencyMs: cached.latencyMs,
            cached: true,
          },
        },
        timestamp: new Date().toISOString(),
      });

      return;
    }

    let ok = false;

    try {
      await db.execute(sql`SELECT 1`);
      ok = true;
    } catch (error) {
      const detail = error as { code?: string; message?: string };

      /*
       * The detail goes to the log, never to the response. This endpoint is
       * unauthenticated and often public: a connection error message names
       * the host, the port and sometimes the user.
       */
      log.error(
        { code: detail.code, err: error },
        'readiness.database_unreachable',
      );
    }

    const latencyMs = Date.now() - started;

    cached = { at: started, ok, latencyMs };

    res.status(ok ? 200 : 503).json({
      status: ok ? 'ready' : 'not_ready',
      checks: {
        database: { status: ok ? 'up' : 'down', latencyMs, cached: false },
      },
      /*
       * Reported, not enforced. A pending migration is a reason to alert,
       * not a reason to take a working hospital system out of service: the
       * application may run correctly against the previous schema for
       * hours, and refusing traffic would turn a maintenance task into an
       * outage.
       */
      schema: {
        expectedMigrations: 23,
        note: 'Run npm run db:status to compare the journal with the database.',
      },
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
