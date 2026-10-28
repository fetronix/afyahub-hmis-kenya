import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createApiRoutes, createDomainRoutes } from './routes/index.ts';
import portalRoutes from './portal/portal.routes.ts';
import portalAdminRoutes from './portal/portal-admin.routes.ts';
import publicBookingRoutes from './booking/website-booking.routes.ts';
import paymentHubWebhookRoutes from './payment-hub/webhook.routes.ts';
import { createShaWebhooksRouter } from './routes/sha-eclaims.routes.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import { createSystemRouter } from './routes/system.routes.ts';
import { correlationIdFrom, moduleLogger } from './logging/logger.ts';
import authRoutes from './auth/auth.routes.ts';
import { requireAuth } from './middleware/auth.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from './auth/authorization.middleware.ts';
import * as reporting from './reporting/reporting.service.ts';
import {
  createApiRateLimiter,
  createAuthRateLimiter,
  createCorsMiddleware,
  createHelmetMiddleware,
} from './middleware/http-security.middleware.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '..');

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

/**
 * Where the built client lives.
 *
 * `src/app.ts` sits one level below the project root, and the bundle
 * (`build/server.js`) does too, so `..` is correct in both. STATIC_DIR
 * exists for cPanel layouts where the application root and the document
 * root differ; it is resolved against the process working directory.
 *
 * Absolute, never relative: cPanel's Passenger starts the process from a
 * directory that has nothing to do with the app, and relative paths then
 * resolve to a folder that does not contain dist/.
 */
const STATIC_DIR = process.env.STATIC_DIR
  ? path.resolve(process.cwd(), process.env.STATIC_DIR)
  : path.resolve(__dirname, 'dist');

/*
 * The application-wide logger. Structured, with credentials and patient
 * identity redacted at the logger rather than at each call site — a call
 * site that forgets is a leak, so the default has to be safe.
 */
const requestLog = moduleLogger('http');
const appLog = moduleLogger('app');

export async function createApp() {
  const app = express();

  /*
   * =========================================================
   * HTTP SECURITY
   * =========================================================
   *
   * Headers, origin allowlist and rate limits run before the body is
   * parsed, so a refused request costs nothing and never reaches a route.
   *
   * TRUST_PROXY must be set when the app sits behind a reverse proxy,
   * otherwise every request appears to come from the proxy address and a
   * single busy client would rate-limit the whole facility.
   */
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

  app.use(createHelmetMiddleware());
  app.use(createCorsMiddleware());

  /*
   * =========================================================
   * REQUEST LOGGING AND CORRELATION
   * =========================================================
   *
   * Every request gets one line on completion, and one correlation id that
   * every log statement inside it inherits.
   *
   * WHAT IS NOT LOGGED
   *
   * The query string is dropped. `GET /api/patients?nationalId=...` puts a
   * national identity number into a log file, and a log file is a copy of
   * patient data with none of the database's access control. The route path
   * is enough to see what happened; the parameters belong in the database
   * and in the audit trail, which has its own access rules.
   *
   * The body is never read. A discharge summary is a body.
   *
   * WHAT IS LOGGED
   *
   * method, path, status, duration, and the correlation id. That is enough
   * to answer "which requests got slower at 14:32" and "was there a burst
   * of 401s before this ticket" without storing anything about a patient.
   *
   * Health and readiness probes are not logged at info: an orchestrator
   * polls them every few seconds and would bury every other line.
   *
   * ORDER MATTERS AND THIS IS DELIBERATE. It runs before the rate limiters
   * and before `express.json()`, so that:
   *   - a rate-limited request is still logged (429s are worth seeing);
   *   - a malformed JSON body is still answered with a correlation id.
   * Placed after the body parser, a client sending bad JSON receives an
   * empty id and the operator has nothing to search for.
   */
  app.use((req, res, next) => {
    const correlationId = correlationIdFrom(req.headers['x-correlation-id']);
    const startedAt = process.hrtime.bigint();

    /* Echoed so a client (or a proxy log) can quote the id when reporting
     * a problem, which is how a support ticket becomes a log query. */
    res.setHeader('X-Correlation-Id', correlationId);

    const probe = req.path === '/api/health' || req.path === '/api/ready';

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      requestLog[probe ? 'debug' : 'info'](
        {
          correlationId,
          method: req.method,
          /* `originalUrl.split('?')[0]` and not `req.path`: on a mounted
           * router they differ, and the mounted path is the useful one. */
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          /* A failed request at warn level is what makes a 5xx alerting
           * rule possible without parsing messages. */
        },
        res.statusCode >= 500
          ? 'request.failed'
          : res.statusCode >= 400
            ? 'request.rejected'
            : 'request.completed',
      );
    });

    next();
  });

  /* Sign-in and invitation acceptance: counted on failures only. */
  app.use('/api/auth', createAuthRateLimiter());

  /* Everything else: a broad per-IP ceiling. */
  app.use('/api', createApiRateLimiter());

  /*
   * 1 MB is generous for this application (the largest body is a
   * claim or an invoice) and stops a single request from pinning the
   * process while it parses.
   */
  app.use(express.json({ limit: '1mb' }));

  /*
   * =========================================================
   * AUTHENTICATION ROUTES
   * =========================================================
   *
   * /api/auth/login
   *     Public
   *
   * /api/auth/session
   *     Protected internally by auth.routes.ts
   *
   * /api/auth/logout
   *     Protected internally by auth.routes.ts
   */
  app.use('/api/auth', authRoutes);

  /*
   * =========================================================
   * HEALTH AND READINESS
   * =========================================================
   *
   * Extracted to src/routes/system.routes.ts. Both stay PUBLIC, because a
   * load balancer and a container probe cannot authenticate. The paths are
   * unchanged: deployment health checks are already pointed at them.
   */
  app.use('/api', createSystemRouter());

  /*
   * =========================================================
   * AUTHENTICATED HMIS API
   * =========================================================
   *
   * IMPORTANT:
   *
   * Every API route registered AFTER this middleware requires
   * a valid authenticated session.
   *
   * Protected areas include:
   *
   * - Tenants
   * - Facilities
   * - Departments
   * - Patients
   * - Encounters
   * - Queues
   * - Appointments
   * - Observations
   * - Diagnoses
   * - Procedures
   * - Medications
   * - Wards
   * - Beds
   * - Admissions
   * - Theatre
   * - Laboratory
   * - Radiology
   * - Pharmacy
   * - Inventory
   * - Procurement
   * - Billing
   * - Claims
   * - Public Health
   * - Audit Logs
   * - Interoperability
   * - Analytics
   *
   * Authentication is NOT the same as authorization.
   *
   * The next security stage will add:
   *
   * - RBAC
   * - Permissions
   * - Tenant isolation
   * - Facility isolation
   */
  /*
   * Patient digital health record portal.
   *
   * Mounted BEFORE the staff gate below, and that order is the whole point:
   * a patient has no staff session. When these mounts sat under
   * `app.use('/api', requireAuth)`, `/api/portal/auth/activate` and
   * `/api/portal/auth/login` answered "Authentication is required." to the
   * patient holding a valid invitation — the link worked, the token was
   * good, and the door was bolted by a middleware the router never needed.
   *
   * `/api/portal` is the patient surface. Only activation and login are
   * public; every other route in that router carries `requirePortalAuth`,
   * which reads `patient_portal_sessions` and cannot accept a staff token.
   * `/api/portal/admin` is the staff surface and applies `requireAuth` and
   * `requirePermission` inside its own router, so moving it above this line
   * neither opens it nor duplicates the gate.
   */
  app.use('/api/portal/admin', portalAdminRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/webhooks/sha', createShaWebhooksRouter());
  app.use('/api/payment-hub/webhooks', paymentHubWebhookRoutes);
  // Facility-scoped machine-to-machine booking authenticates its own client key.
  app.use('/api/booking/v1', publicBookingRoutes);

  app.use('/api', requireAuth);
  app.use('/api', requireAuthorization);

  /*
   * Everything below `/api` authentication: module gates, administrator
   * routers and the clinical domains. See ./routes/index.ts.
   *
   * `createApiRoutes()` holds the `/api`-relative prefixes, module gates,
   * and relative-path routers (`maternal-health`, `inpatient`).
   * `createDomainRoutes()` holds the domain routers whose handlers declare
   * full `/api/...` paths; mounting them inside `app.use('/api', ...)`
   * doubled the prefix to `/api/api/...` and let real `/api/...` requests
   * fall through to the SPA shell.
   */
  app.use('/api', createApiRoutes());
  app.use(createDomainRoutes());

  /*
   * Unmatched `/api` requests must answer with JSON in both development
   * (before `vite.middlewares` SPA fallback) and production, across every
   * HTTP method — never `index.html` and never Express's default HTML 404.
   */
  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `No API route matches ${req.method} ${req.originalUrl.split('?')[0]}.`,
    });
  });

  /*
   * There is no route registered in this file any more, and that is on
   * purpose. The last three thousand lines of handlers - tenants, patients,
   * encounters, invoices, payments, claims, public health, audit, interop -
   * were moved to `src/routes/domains/` and mounted by `createApiRoutes()` in
   * the same position they occupied here: after `requireAuth`,
   * `requireAuthorization` and the facility-module gates.
   *
   * What stays: the server itself. Security headers, body limits, the
   * pre-authentication portal mounts, the gates, health and readiness, the
   * SPA fallback and the error handler.
   */

  // =========================================================
  // VITE MIDDLEWARE / STATIC ASSETS
  // =========================================================

  if (!isProduction) {
    /*
     * Vite is imported HERE, not at the top of the file.
     *
     * A static `import 'vite'` makes every production process load Vite
     * and its whole tree — esbuild, the bundler, the CSS pipeline — into
     * memory and spin up its service threads, only to serve a predist
     * folder that `vite build` already wrote. On a shared cPanel account
     * with a low thread and memory ceiling that is a real cost, and it is
     * paid on every restart.
     *
     * It also removes the dev server from the production dependency
     * graph entirely, which is the property we actually want: there is no
     * code path in production that can start Vite.
     */
    const { createServer: createViteServer } = await import('vite');

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },

      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const indexHtml = path.join(STATIC_DIR, 'index.html');

    const hasClientBuild = existsSync(indexHtml);

    if (!hasClientBuild) {
      /*
       * Serving nothing silently is how a deployment shows a working API
       * and a blank page. Say exactly which path is missing and how it is
       * produced, then keep serving the API: a missing frontend must not
       * take the clinical endpoints down with it.
       */
      console.error('');
      console.error('No client build found.');
      console.error(`  Looked for: ${indexHtml}`);
      console.error('  Build it with: npm run build   (vite build -> dist/)');
      console.error('  Or point STATIC_DIR at the directory that holds index.html.');
      console.error('');
    } else {
      /*
       * Hashed assets are immutable and can be cached for a year;
       * index.html must not be cached or a client keeps loading the old
       * bundle after a deploy.
       */
      app.use(
        express.static(STATIC_DIR, {
          index: false,
          etag: true,
          lastModified: true,
          maxAge: '1y',
          immutable: true,
          setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          },
        }),
      );
    }

    /*
     * Client-side routes fall through to the SPA. An unmatched /api
     * path must not: answering JSON with HTML is worse than a 404, and
     * the client cannot tell a typo from an outage.
     */
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: `No API route matches ${req.method} ${req.path}.`,
        });

        return;
      }

      if (!hasClientBuild) {
        res
          .status(503)
          .type('text/plain')
          .send(
            'The client build is missing on this server. Run npm run build and restart the application.',
          );

        return;
      }

      /*
       * The shell must never be cached: a client holding yesterday's
       * index.html asks for yesterday's asset hashes, and after a deploy
       * that is a blank page served from a cache nobody can clear.
       */
      res.setHeader('Cache-Control', 'no-store, must-revalidate');

      res.sendFile(indexHtml, (error) => {
        if (error) next(error);
      });
    });
  }

  // =========================================================

  /*
   * =========================================================
   * CATCH-ALL ERROR HANDLER
   * =========================================================
   *
   * Without this, an error thrown inside a route that did not handle it
   * reaches Express's default handler, which answers with an HTML page
   * containing the stack trace and the file paths. To a client that
   * expects JSON that is a parse failure; to anyone else it is a map of
   * the server.
   *
   * The response is deliberately uniform: a status and a correlation id.
   * Not the message, because a database error message contains table and
   * column names, and not the stack, because it contains paths. The full
   * detail goes to the log, where the correlation id joins it to the
   * request line, and an operator can read it.
   *
   * A 4xx is the client's problem and is logged at warn; a 5xx is ours and
   * is logged at error with the stack.
   */
  app.use(
    (
      error: Error & { status?: number; statusCode?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      /* A response already started cannot be replaced with JSON; the only
       * correct move is to let Express close the connection. */
      if (res.headersSent) {
        next(error);

        return;
      }

      const correlationId = String(res.getHeader('X-Correlation-Id') ?? '');

      /* A malformed JSON body is a client mistake, not a server fault, and
       * answering 500 for it sends operators looking for an outage. */
      const isBadJson = error.type === 'entity.parse.failed';
      const isTooLarge = error.type === 'entity.too.large';

      const status = isBadJson ? 400 : isTooLarge ? 413 : (error.status ?? error.statusCode ?? 500);

      const detail = {
        correlationId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status,
        err: error,
      };

      if (status >= 500) {
        appLog.error(detail, 'unhandled.error');
      } else {
        appLog.warn(detail, 'request.bad_input');
      }

      res.status(status).json({
        error:
          status >= 500
            ? 'An internal error occurred. Quote the correlation id when reporting it.'
            : isBadJson
              ? 'The request body is not valid JSON.'
              : isTooLarge
                ? 'The request body is too large.'
                : 'The request could not be processed.',
        /* Never the message and never the stack. The id is the whole
         * contract between the client and the log. */
        correlationId,
      });
    },
  );

  return app;
}
