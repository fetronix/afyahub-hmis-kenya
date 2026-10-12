# JaliCare HMIS — Target Architecture

## Objective

Restructure the existing React, TypeScript, Express, PostgreSQL and Drizzle application incrementally. Preserve existing behaviour, data and migration history.

## Target boundaries

1. **Application:** Express middleware, route registration, error handling and startup.
2. **Feature API:** route handlers, input validation and response mapping.
3. **Business services:** clinical and operational workflow rules and transaction boundaries.
4. **Data access:** Drizzle queries with explicit tenant and facility scoping.
5. **Database:** PostgreSQL schema and versioned, additive migrations.
6. **Frontend:** React modules, shared components and a consistent API client.
7. **Shared infrastructure:** validated configuration, logging, auditing and security controls.
8. **Verification:** unit, integration, security and end-to-end tests.

## Incremental implementation plan

### 1. Baseline
- Record current entry points, scripts, routes, environment variables and migrations.
- Work on `restructure/phase-2-foundation`.
- Keep changes small and reviewable.

### 2. Separate application composition
- Introduce `src/app.ts` to construct and configure the Express application.
- Keep `server.ts` as the startup entry point initially.
- Preserve existing route paths, middleware order and response contracts.
- Add graceful shutdown only after verifying HTTP server and database-pool lifecycle.

### 3. Standardise configuration and HTTP behaviour
- Centralise environment validation without silently renaming existing variables.
- Add consistent error handling, request validation and safe logging.
- Keep secrets out of source control.

### 4. Organise feature modules
- Extract one endpoint group at a time from `server.ts`.
- Separate route handlers from business services where useful.
- Preserve existing authorization and data-scope checks throughout each move.

### 5. Strengthen security
- Review permissions and tenant/facility isolation endpoint by endpoint.
- Review login throttling, session invalidation and MFA enforcement.
- Plan session-token transport changes with corresponding CSRF protections.
- Avoid claiming regulatory compliance without independent evidence.

### 6. Complete workflows
Organise and verify registration, reception, OPD, inpatient, theatre, laboratory, radiology, pharmacy, inventory, procurement, finance, insurance, referrals, patient portal, public health, interoperability, analytics and audit.

### 7. Verify release readiness
- Separate type-checking, frontend builds and automated tests.
- Test database changes against a disposable database or verified backup.
- Document deployment, backups, restoration, monitoring and incident response.

## Database safety rules

- Preserve existing files and journal history under `drizzle/`.
- Never edit an already-applied migration; add a new migration when required.
- Do not run `npm run db:clean` as a development shortcut.
- Back up the database before schema changes and verify restoration separately.
- Do not automatically reset or migrate the production database at application startup.

## Acceptance criteria

- Existing startup and routes continue to work.
- Existing data and migration history are preserved.
- Tenant and facility scope is enforced by backend logic.
- No secrets are committed.
- Type-checking, builds and tests are reported separately.
- Regulatory readiness is described only to the extent supported by evidence.
