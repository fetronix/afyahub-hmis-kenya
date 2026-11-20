# Application architecture

| Field | Value |
| --- | --- |
| Document | APPLICATION_ARCHITECTURE |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | Syrona Medical Center HMIS 0.1.0, commit `9d7274c` |
| Audience | Engineers, security reviewers |
| Status | Verified against `server.ts`, `src/app.ts`, `src/routes/index.ts` and the middleware modules |

## Process model

`server.ts` reads `PORT` and `HOST` (default `0.0.0.0`), applies the configured timezone with
`applyDefaultTimezone()`, builds the application with `createApp()`, starts the HTTP server and
handles `SIGTERM` for a graceful shutdown. There is no cluster mode, no worker thread and no
in-process scheduler.

`src/app.ts` (about 540 lines) is the composition root. It registers **no domain routes itself**: it
mounts routers and defines the fallback handlers. Domain routes live in `src/routes/index.ts` and the
route modules it imports.

## Middleware order

The order below is the order in `src/app.ts`; it is load-bearing and changes here are security
changes.

| # | Middleware | Purpose | Notes |
| --- | --- | --- | --- |
| 1 | `app.set('trust proxy', …)` | Honour `X-Forwarded-*` only when `TRUST_PROXY=true` | Wrong value makes rate limiting and logging see the proxy's IP |
| 2 | `createHelmetMiddleware()` | Security headers | First, so even error responses carry them |
| 3 | `createCorsMiddleware()` | Origin allowlist | Same-origin deployment needs no permissive CORS |
| 4 | Correlation id | Validate inbound `X-Correlation-Id` or issue a UUID; echo it | Before the body parser so malformed JSON still has an id |
| 5 | `createAuthRateLimiter()` on `/api/auth` | 10 failed attempts per 15 minutes per IP | Successful logins do not count |
| 6 | `createApiRateLimiter()` on `/api` | 300 requests per minute per IP | Applies to every API request |
| 7 | Raw-body document and branding mounts | `/api/facility-branding`, `/api/patient-documents`, `/api/portal/documents` | Mounted before the JSON parser because uploads send raw bytes |
| 8 | `express.json({ limit: '1mb' })` | JSON body parsing | Oversized bodies become `413` |
| 9 | `/api/auth` router | Login, invitation validation and acceptance | Public |
| 10 | System router (`/api`) | `/api/health`, `/api/ready` | Public probes |
| 11 | Portal admin, portal, webhooks, booking | `/api/portal/admin`, `/api/portal`, `/api/webhooks/sha`, `/api/payment-hub/webhooks`, `/api/booking/v1` | Public mounts with their own authentication |
| 12 | `requireAuth` on `/api` | Staff bearer-token authentication | Everything below requires a session |
| 13 | `requireAuthorization` on `/api` | Builds the authorisation context | Loads roles, permissions, tenant and facility |
| 14 | `createApiRoutes()` on `/api` | Module gates, administrator routers and relative-path routers | See mount table |
| 15 | `createDomainRoutes()` | Domain routers declaring full `/api/...` paths | Mounted at the root, deliberately not under `/api` |
| 16 | JSON 404 for unmatched `/api` | `{ success:false, error:'NOT_FOUND' }` | Never the SPA shell |
| 17 | Vite middleware (dev) or static files (prod) | Serves the SPA and falls back to `index.html` | SPA routes are not API routes |
| 18 | Error handler | Uniform JSON error with correlation id | Logs detail, never returns it |

### Why the domain routers are mounted at the root

`createDomainRoutes()` routers declare paths that already start with `/api`. Mounting them inside
`app.use('/api', …)` produced `/api/api/...` and let real `/api/...` requests fall through to the SPA
shell. The comment in `src/app.ts` records this; the API inventory confirms no doubled prefixes
exist.

## Request lifecycle

```
Client → TLS proxy → Node
  helmet → CORS → correlation id → rate limit → (raw mounts) → JSON parse
  → public router (health/ready/auth/webhooks/booking/portal)
  → requireAuth (Bearer token → sessions table)
  → requireAuthorization (roles, permissions, tenant, facility)
  → requireFacilityModule (facilities.enabled_modules)
  → router → validation (zod) → service (scoped queries) → response
  → error handler (JSON { error, correlationId })
```

Handlers receive an `AuthRequest` carrying `authContext`, which contains the user id, tenant id,
facility id, roles and permissions. Services take that context (or a narrower scope object) as an
explicit argument; they do not read request globals.

## Failure behaviour

| Failure | Result |
| --- | --- |
| No or invalid token | `401 { success:false, error:'UNAUTHORIZED' }` |
| Valid token, missing permission | `403 { success:false, error:'FORBIDDEN' }` |
| Facility module disabled | `403` with the module-disabled error |
| Facility mismatch between session and request | `403` `FACILITY_ACCESS_DENIED` |
| Validation failure | `400` with `issues[]` |
| Unknown API path | `404 { success:false, error:'NOT_FOUND' }` |
| Unhandled exception | `500 { error:'An internal error occurred…', correlationId }` |
| Malformed JSON | `400 'The request body is not valid JSON.'` |
| Oversized body | `413 'The request body is too large.'` |
| Rate limit exceeded | `429 { success:false, error:'RATE_LIMITED' }` |

## Configuration and startup

Environment variables are parsed and validated in `src/config/env.ts`. The required set is
`SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_ADMIN_USER` and `SQL_ADMIN_PASSWORD`; a missing value
throws at import time with a message naming the variable and where to set it. `FIELD_ENCRYPTION_KEY`
is optional at boot: when absent, direct identifiers are stored as plaintext and readiness reports
the control as not configured (see [DATA_PROTECTION_AND_PRIVACY.md](../10-security-and-governance/DATA_PROTECTION_AND_PRIVACY.md)).
Other optional variables cover TLS-proxy trust, CORS origins, integration modes and document limits.

The database pool is created lazily; a database outage therefore does not prevent the process from
starting, but `/api/ready` returns `503` and data requests fail.

## Development versus production

| Concern | Development (`npm run dev`) | Production (`npm start`) |
| --- | --- | --- |
| Client | Vite middleware compiles on demand and provides HMR | Pre-built `dist/` served as static files |
| Server code | `tsx server.ts` runs TypeScript directly | `build/server.js` bundled by `npm run build:server` |
| SPA fallback | Vite handles it | Express serves `index.html` for non-API paths |
| Logging | Pino JSON, same as production | Pino JSON |

## Limitations

- No horizontal-scaling story is implemented: sessions are in PostgreSQL (shareable) but rate-limit
  counters are per process, and static assets are served from local disk.
- There is no request-level tracing beyond the correlation id; no OpenTelemetry instrumentation.
- Background work is limited to what is described in [BACKGROUND_PROCESSES.md](BACKGROUND_PROCESSES.md).

## Related documents

- [Backend architecture](BACKEND_ARCHITECTURE.md)
- [Authentication and authorisation](AUTHENTICATION_AND_AUTHORISATION.md)
- [Error handling and validation](ERROR_HANDLING_AND_VALIDATION.md)
- [API reference](API_REFERENCE.md)
