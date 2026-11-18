# Repository structure

| Field | Value |
| --- | --- |
| Document | REPOSITORY_STRUCTURE |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | JaliCare HMIS 0.1.0, commit `9d7274c` |
| Audience | Engineers joining the project |
| Status | Verified against the working tree |

## Top level

```
.
├── server.ts              production entry point (bundled to build/server.js)
├── src/                   application source (server, client, tests)
├── drizzle/               numbered SQL migrations + journal + snapshots
├── scripts/               build, deploy, backup, verification and documentation tooling
├── docs/                  this documentation library and older topic notes
├── public/                static assets copied into the client build
├── .github/workflows/     CI
├── package.json           scripts, dependencies, engines
├── vite.config.ts         client build, dev middleware
├── tsconfig.json          TypeScript configuration
└── .env.example           every environment variable, documented by name
```

## Server source

| Path | Contents |
| --- | --- |
| `src/app.ts` | Middleware order, public mounts, auth mounts, module gates, SPA fallback, JSON 404, error handler |
| `src/routes/index.ts` | `createApiRoutes()` and `createDomainRoutes()` — the mount table |
| `src/routes/*.routes.ts` | Routers that register full `/api/...` paths or are mounted with a prefix |
| `src/routes/domains/` | Domain routers extracted from the former monolith (patients, encounters, invoices, claims, tenancy, reporting…) |
| `src/routes/platform/` | Platform administration routers (tenants, facilities, invitations, subscriptions, RBAC) |
| `src/routes/shared/` | Shared route helpers (scoping, error mapping) |
| `src/auth/` | Session, login, invitation, authorisation and scope services and middleware |
| `src/middleware/` | Security headers, rate limits, facility module gates, request context |
| `src/db/` | Pool, schema barrel and modules, query modules |
| `src/*/` domain folders | `accounting/`, `billing/`, `clinical/`, `documents/`, `insurance/`, `inventory/`, `maternity/`, `portal/`, `reporting/`, `workforce/`, `theatre/`, `dialysis/`, `payment-hub/`, `integrations/`, … each holding services and engines for that domain |
| `src/validation/` | Zod schemas and the validation middleware |
| `src/security/` | Field encryption, hashing and security helpers |
| `src/logging/` | Pino configuration and redaction |
| `src/config/` | Environment parsing and the facility module catalogue |
| `src/seeds/` | Permission seeding |
| `src/tests/` | Vitest suites (`vitest/` unit and DB specs, `integration/` HTTP specs) |

## Client source

| Path | Contents |
| --- | --- |
| `src/App.tsx` | Application shell, module switch, session bootstrap, module/permission guards |
| `src/components/Sidebar.tsx` | Navigation rail, module → permission map, facility module filtering |
| `src/components/modules/` | One component per module (64 files); the largest are inpatient, outpatient, accounting and billing |
| `src/components/portal/` | Patient portal application and documents view |
| `src/components/ui/`, `src/components/dashboard/`, `src/components/inventory/`, `src/components/maternity/`, `src/components/patient/`, `src/components/procurement/` | Shared and module-specific UI building blocks |
| `src/api/` | Typed API clients per domain (`client.ts`, `clients/`, `payment-hub.client.ts`, `portal-client.ts`, …) |
| `src/context/` | `HmisContext` — authenticated user, facility, module state, permissions |
| `src/constants/`, `src/types/`, `src/utils/` | Shared values and helpers |

## Migrations

`drizzle/` holds 103 numbered SQL files (`0000`–`0102`) and `drizzle/meta/_journal.json`. Each
migration is append-only: an applied migration is never edited, because its hash is recorded in
`__drizzle_migrations`. A generated schema snapshot sits beside the journal for Drizzle tooling.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/run-script.mjs` | Runs migrations and status checks with environment preflight |
| `scripts/build-server.mjs` | Bundles the server to `build/server.js` |
| `scripts/deploy-artifacts.mjs` | Verifies that a deployment contains every required artifact |
| `scripts/backup/*.mjs` | Backup, verify, restore and restore-drill |
| `scripts/docs/build-*.ts` | Generate the API inventory, data dictionary, permissions matrix, test inventory and API reference |
| `scripts/docs/validate-docs.ts` | Validates links, tables, routes and schema references in this library |

## Documentation

`docs/` now contains the structured library (areas `01`–`12`) plus the pre-existing topic folders
(`architecture/`, `audits/`, `billing/`, `deployment/`, `integrations/`, `patient-portal/`,
`quality/`, `security/`, `testing/`) and the generated `evidence/` artefacts. Older topic notes are
retained because other documents reference them; where they disagree with this library, this library
wins because it is generated from and checked against the code.

## Conventions

- Route files are `*.routes.ts` or files mounted as routers; every route declares its guard chain in
  the registration itself, which is what makes the API inventory possible.
- Services receive an explicit scope object (`tenantId`, `facilityId`, actor) rather than reading
  globals.
- SQL is written with parameter placeholders; Drizzle is used for typed access and raw SQL for
  reporting and bulk work.
- Tests live beside the runner that executes them: `src/tests/vitest/*.spec.ts` for unit and DB
  specs, `src/tests/integration/*.spec.ts` for HTTP-level specs.

## Limitations

- Editor backup files exist under `src/components/modules/` (`*.catalogue-fix-*`,
  `*.fix-backup`) and are excluded from counts in this library, but they are still in the tree.
- The pre-existing `docs/` topic folders are not regenerated and may lag behind the code; see
  [the validation report](../VALIDATION_REPORT.md) for which ones were checked.

## Related documents

- [Application architecture](APPLICATION_ARCHITECTURE.md)
- [Backend architecture](BACKEND_ARCHITECTURE.md)
- [Migration procedure](../09-deployment-and-maintenance/DATABASE_MIGRATIONS.md)
