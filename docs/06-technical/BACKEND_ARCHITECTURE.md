# Backend architecture

| Field | Value |
| --- | --- |
| Document | BACKEND_ARCHITECTURE |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | JaliCare HMIS 0.1.0, commit `9d7274c` |
| Audience | Backend engineers |
| Status | Verified against the route modules, services and query modules |

## Layering

```
HTTP request
   → router (src/routes/**, src/*/*.routes.ts)
       validation (zod), permission guards, module gates, status codes
   → service or engine (src/<domain>/*.service.ts, *.engine.ts)
       business rules, transactions, calculations, audit writes
   → data access (src/db/queries/**, raw SQL in services)
       parameterised SQL, tenant/facility predicates
   → PostgreSQL
```

The rule is one-way. A service never imports a router; the data layer never imports a service. The
exceptions are deliberate and few: reporting engines read across domains through SQL views and
queries, and billing-posting services are called by both billing and accounting flows.

## Router conventions

- Every route declares its full guard chain inline:
  `router.post('/invoices', requirePermission('billing.create'), validateBody(schema), handler)`.
  This is what allows `scripts/docs/build-api-inventory.ts` to attribute permissions to routes.
- Routers that need a session for every route call `router.use(requireAuth)`; the staff routers that
  are mounted behind the global `/api` session check do not repeat it.
- Facility module gates are applied at the mount in `src/routes/index.ts`
  (`api.use('/laboratory', requireFacilityModule('laboratory'), laboratoryRoutes)`), not per route.
- Path parameters are parsed and validated in the handler; invalid identifiers produce `400` rather
  than a database error.
- Handlers map domain errors to status codes in one place per router (`fail()`, `handleError()`), so a
  new route inherits the same error contract.

## Service conventions

- Services take an explicit scope: `{ tenantId, facilityId, actorId, actorName }` or the full
  `AuthorizationContext`. No service reads a global or a request object.
- Money-moving operations open a transaction, post to the ledger and write an idempotency record in
  the same transaction.
- Audit writes accompany state changes that matter (clinical documents, billing, claims, ledger,
  configuration, access to records).
- Calculations live in engines (`billing`, `accounting`, `payroll`, `reporting`) that are unit-tested
  separately from HTTP.

## Data access conventions

- Parameterised SQL everywhere; no string interpolation of user values.
- `src/db/queries/` modules are thin, composable query builders; complex reporting SQL lives with its
  engine.
- `tenant_id` and `facility_id` are part of the `WHERE` clause, not a post-filter.
- Read models for reports are SQL views or dedicated queries; there is no ORM lazy-loading.

## Cross-cutting modules

| Concern | Module | Notes |
| --- | --- | --- |
| Authorisation | `src/auth/authorization.middleware.ts`, `authorization.service.ts` | `requirePermission`, `requireAnyPermission`, `requireRole`, `requireSuperAdmin` |
| Scope | `src/auth/scope.service.ts` | `resolveFacilityScope`, `requireTenantScope`, ownership assertions |
| Facility modules | `src/middleware/facility-module.middleware.ts` | Reads `facilities.enabled_modules` |
| Validation | `src/validation/` | Zod schemas, `validateBody`, `validateQuery` |
| Errors | `src/middleware/error-handler.ts` and per-router mappers | Uniform envelope |
| Logging | `src/logging/` | Pino with redaction |
| Crypto | `src/security/field-crypto.ts` | AES-256-GCM field encryption |
| Notifications | `src/notifications/` | In-app notification records and read receipts |
| Operations | `src/operations/` | Readiness, status and maintenance helpers |

## Adding a route: the checklist the codebase implies

1. Decide the prefix and whether it belongs to a domain router (full path) or an `api` router
   (relative path).
2. Declare the guard chain: authentication is inherited, but permission and module gate are not.
3. Validate body and query with a Zod schema in `src/validation/schemas/`.
4. Resolve scope from `req.authContext`; never trust a facility or tenant from the client.
5. Put business rules in a service; write the audit record there.
6. Map domain errors to status codes in the router's error helper.
7. Add a test — unit for the service, HTTP-level for the route.
8. Regenerate `docs/evidence/API_ROUTE_INVENTORY.json` and `docs/06-technical/API_REFERENCE.md`.

## Known irregularities

- Some route files apply guards with `router.use(...)` at the top, others per route. Both are
  captured by the inventory, but the two styles make review harder.
- A few routers (payment hub, platform) live in files named `routes.ts` rather than `*.routes.ts`.
  The inventory scans mounted modules, so they are covered, but a grep for `*.routes.ts` misses them.
- A handful of handlers authorise inside the service (they pass `authContext` and the service decides);
  the API reference marks these "checked in service".

## Limitations

- There is no dependency-injection container; services import their collaborators directly, which makes
  substitution in tests manual.
- Raw SQL is prevalent. It is portable only to PostgreSQL and is not type-checked by the ORM.

## Related documents

- [Application architecture](APPLICATION_ARCHITECTURE.md)
- [Database data dictionary](DATABASE_DATA_DICTIONARY.md)
- [API reference](API_REFERENCE.md)
- [Error handling and validation](ERROR_HANDLING_AND_VALIDATION.md)
