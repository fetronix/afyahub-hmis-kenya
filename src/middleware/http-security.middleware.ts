/**
 * JaliCare HMIS
 * HTTP security middleware
 *
 * Three things every internet-facing deployment needs and this one did
 * not have: security headers, an origin allowlist, and a limit on how
 * fast a single client can hammer the API.
 *
 * The origin list is deliberately an allowlist. Reflecting whatever
 * origin asks, on an authenticated API, is how a clinic's patient data
 * ends up readable from any page a staff member happens to visit.
 *
 * Rate limiting is per IP. Behind a reverse proxy, set TRUST_PROXY=true
 * or every request appears to come from the proxy and one busy user locks
 * out the whole facility.
 */

import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

/* ============================================================
   ORIGIN ALLOWLIST
   ============================================================ */

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());

    if (!['http:', 'https:'].includes(url.protocol)) return null;

    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Origins allowed to call the API from a browser.
 *
 *   APP_BASE_URL            the deployment's own origin
 *   CORS_ALLOWED_ORIGINS    comma-separated extras (staging, preview hosts)
 *   localhost dev ports     only when NODE_ENV is not "production"
 */
export function resolveAllowedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const origins = new Set<string>();

  const appBaseUrl = env.APP_BASE_URL?.trim();

  if (appBaseUrl) {
    const origin = normaliseOrigin(appBaseUrl);

    if (origin) origins.add(origin);
  }

  for (const extra of (env.CORS_ALLOWED_ORIGINS ?? '').split(',')) {
    if (!extra.trim()) continue;

    const origin = normaliseOrigin(extra);

    if (origin) origins.add(origin);
  }

  if (env.NODE_ENV !== 'production') {
    for (const origin of DEV_ORIGINS) origins.add(origin);
  }

  return Array.from(origins);
}

/**
 * A request with no Origin header is not a browser cross-origin request:
 * curl, server-to-server calls and same-origin navigations all omit it.
 * Those are allowed through; the decision only matters when a browser
 * says where the request came from.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;

  return allowed.includes(origin);
}

export function createCorsMiddleware(env: Record<string, string | undefined> = process.env) {
  const allowed = resolveAllowedOrigins(env);

  return cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowed)) {
        callback(null, true);
        return;
      }

      /*
       * Answer without CORS headers rather than with an error. The browser
       * then blocks the response; the server has still refused to endorse
       * the origin, without leaking whether the route exists.
       */
      callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Idempotency-Key'],
    exposedHeaders: [],
    maxAge: 600,
  });
}

/* ============================================================
   SECURITY HEADERS
   ============================================================ */

/**
 * Helmet configuration.
 *
 * CSP is only switched on in production: the development server serves
 * the SPA through Vite, which injects inline scripts for HMR, and a
 * policy strict enough to be worth having would break the dev loop.
 */
export function createHelmetMiddleware(env: Record<string, string | undefined> = process.env) {
  const isProduction = env.NODE_ENV === 'production';

  return helmet({
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    /* The SPA is not embedded anywhere, and no camera or microphone is used. */
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
}

/* ============================================================
   RATE LIMITING
   ============================================================ */

export const AUTH_RATE_LIMIT = Object.freeze({
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

export const API_RATE_LIMIT = Object.freeze({
  windowMs: 60 * 1000,
  limit: 300,
});

function limitBody(message: string) {
  return {
    success: false,
    error: 'RATE_LIMITED',
    message,
  };
}

/**
 * Sign-in, invitation acceptance and password changes.
 *
 * Only failures count: a busy reception desk that signs in correctly all
 * day is not an attack, and locking them out would be the vulnerability.
 */
export function createAuthRateLimiter(env: Record<string, string | undefined> = process.env) {
  return rateLimit({
    windowMs: AUTH_RATE_LIMIT.windowMs,
    limit: env.NODE_ENV === 'test' ? 1000 : AUTH_RATE_LIMIT.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler(_req: Request, res: Response, _next: NextFunction) {
      res.status(429).json(limitBody('Too many failed attempts. Try again in a few minutes.'));
    },
  });
}

/** Broad per-IP limit for the rest of the API. */
export function createApiRateLimiter(env: Record<string, string | undefined> = process.env) {
  return rateLimit({
    windowMs: API_RATE_LIMIT.windowMs,
    limit: env.NODE_ENV === 'test' ? 100_000 : API_RATE_LIMIT.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(_req: Request, res: Response, _next: NextFunction) {
      res.status(429).json(limitBody('Too many requests. Slow down and try again shortly.'));
    },
  });
}
