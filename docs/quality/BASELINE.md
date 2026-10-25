# Repository baseline — measured before any change

Recorded on `main` (`e5daca2`), branch `arena/c43ff5c1-afyahub-hmis-kenya`,
Node **22.22.3**, npm **10.9.8**, Linux sandbox with **no PostgreSQL**.

Nothing in this document is estimated. Each figure comes from a command run
against the checkout at that commit; the command is named beside it.

## 1. What the repository contained

| Item | Value |
|---|---|
| Tracked files | 492 |
| Runtime dependencies | 20 |
| Dev dependencies | 12 |
| npm scripts | 51 |
| `package.json` name / version | `react-example` / `0.0.0` |
| `engines` field | **absent** |
| ESLint / Prettier | **absent** |
| CI workflow | **absent** |
| Docker / compose | **absent** |
| Coverage tooling | **absent** |
| Structured logging | **absent** (200+ bare `console.*` calls) |

Largest source files, measured with `wc -l`:

| File | Lines |
|---|---|
| `src/app.ts` | 8,297 |
| `src/db/schema.ts` | 6,862 |
| `src/db/queries.ts` | 4,303 |
| `src/routes/platform.routes.ts` | 3,444 |

## 2. Checks that pass today

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **pass**, 6.6 s |
| Tests | `npm test` | **pass**, 29 suites, **3,752 assertions**, 15 s |
| Client build | `npm run build` | **pass**, 1,708 modules, 761 ms |
| Server bundle | `npm run build:server` | **pass**, 6 bundles, 0.2 s |
| Dry-run proof | `npm run verify:dry-run` | **pass**, 3 statements, 0 writes |

`npm run build:deploy` produces `dist/index.html` (1,116 B) and
`build/server.js` (1,120,482 B).

## 3. Test inventory — and the gap

35 files match `src/tests/*.test.ts`. **29 are wired into `npm test`.**
The other six were never added to the script:

| File | Runs? | Needs |
|---|---|---|
| `auth-api.test.ts` | **empty file** (0 lines) | — |
| `auth-validation.test.ts` | passes | nothing |
| `subscription-access.policy.test.ts` | passes | nothing |
| `authorization.test.ts` | passes | `SQL_*` env present (no connection) |
| `auth-service.test.ts` | fails | `SQL_*` + `ADMIN_*` env |
| `authentication.test.ts` | fails | **live PostgreSQL** (`SELECT … FROM users`) |

So the real split is:

* **31 suites: pure.** No database, no network. Assertions on source text and
  on pure functions.
* **1 suite: environment only.** `authorization.test.ts` fails only because
  `src/config/env.ts` throws when `SQL_HOST` is absent — no connection is made.
* **2 suites: need a live database.** `authentication.test.ts` and
  `auth-service.test.ts`.

This matters for the assessment's requirement to "separate tests requiring
PostgreSQL": before this work, **no test in the repository exercised
PostgreSQL at all**, and the two that wanted to had been silently left out of
`npm test`. Tenant isolation and facility permissions — the two properties the
brief names first — were verified only by reading source text, never by
querying a database.

## 4. Environment template

`.env.example` documents 29 variables. The code reads these but they are
**missing from the template**:

`FIELD_ENCRYPTION_KEY`, `PORT`, `NODE_ENV`, `HOST`, `MIGRATIONS_DIR`,
`STATIC_DIR`, `DISABLE_HMR`, `BUILD_TARGET`, `VITE_ALLOWED_HOSTS`.

`FIELD_ENCRYPTION_KEY` is the most serious omission: it is required for the
patient-identifier encryption path, and a new installation following the
template cannot start the application.

## 5. Security observations

| Observation | Status |
|---|---|
| Raw SQL built from request input | **none found** — `sql.raw` and template interpolation of user values do not appear in `src/` |
| Identifier interpolation | limited to `tracking.qualified` (schema/table read from `pg_class`), not user-supplied |
| Authentication / permission checks | present; `requirePermission` guards the tariff, billing, staff and platform routes |
| Secrets in logs | no `console.*` call prints a password; the startup path was audited in an earlier change |
| `/api/health` | present, returns status and uptime |
| Readiness endpoint | **absent** — nothing reports whether the database is reachable |
| `/api/health` details | reports process state only, not dependency state |

## 6. What this baseline means for the work

1. The code is **green** today, so every phase must keep it green; a regression
   is my change, not a pre-existing condition.
2. Typecheck is the only static gate — there is no lint, so style, unused
   imports and React hook mistakes are unguarded.
3. Test volume (3,752 assertions) is high but shallow for the properties a
   buyer cares about: almost none of it queries a database.
4. The three largest files hold the routes, the schema and the queries for the
   whole application. They cannot be split safely in one step.
5. There is no CI, so none of the above is enforced by anything but a
   developer remembering to run it.
