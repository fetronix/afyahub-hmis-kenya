# JaliCare Kenya HMIS

A hospital management information system for Kenyan health facilities:
patient registration, OPD and triage, inpatient wards, maternity, laboratory,
pharmacy, billing with SHA/DHA claims, and a patient portal. Single Node
process serving a JSON API and a React SPA, backed by PostgreSQL.

---

## Contents

- [What this is](#what-this-is)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [Tariff and billing codes](#tariff-and-billing-codes)
- [Testing](#testing)
- [Continuous integration](#continuous-integration)
- [Production deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## What this is

|                 |                                                                     |
| --------------- | ------------------------------------------------------------------- |
| **Runtime**     | Node.js `^20.19.0` or `>=22.12.0` (declared in `engines`)           |
| **Database**    | PostgreSQL 16                                                       |
| **Server**      | Express 4, TypeScript, Drizzle ORM                                  |
| **Client**      | React 19, Vite 8, Tailwind CSS 4                                    |
| **Entry point** | `server.ts` (development) → `build/server.js` (production)          |
| **API and SPA** | One process, one port. `/api/*` is JSON; everything else is the SPA |

The application is multi-tenant: one installation can host several facilities,
and a facility belongs to a tenant. Every clinical table carries a tenant and
usually a facility scope, and the routes enforce both. See
[Tenant and facility scope](#tenant-and-facility-scope).

---

## Quick start

### Prerequisites

- Node.js in the range above
- PostgreSQL 16, reachable and empty
- No Docker required, but there is a [`docker-compose.yml`](docker-compose.yml)
  if you would rather not install PostgreSQL

### 1. Install

```bash
npm ci
```

`npm ci` rather than `npm install`: it installs exactly what
`package-lock.json` pins, which is the tree CI verified.

### 2. Configure

```bash
cp .env.example .env
```

Then edit `.env`. Four values need real entries before the application will
start:

| Variable               | What it is                           | How to get one                                                                |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `FIELD_ENCRYPTION_KEY` | Encrypts patient identifiers at rest | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SQL_HOST`             | PostgreSQL host                      | `localhost` for a local database                                              |
| `SQL_ADMIN_USER`       | PostgreSQL user                      | your database user                                                            |
| `SQL_ADMIN_PASSWORD`   | PostgreSQL password                  | your database password                                                        |

Also set `SQL_DB_NAME` and `SQL_PORT` (5432 unless you changed it), and
`APP_BASE_URL` (`http://localhost:3000` in development).

> **The encryption key is not recoverable.** Values encrypted with it cannot
> be read without it. Store it in a password manager next to the database
> password. Losing it loses the data; changing it does not re-encrypt
> existing values.

Every other variable is documented inline in [`.env.example`](.env.example),
and [Configuration](#configuration) explains what each one affects.

### 3. Create the schema

```bash
npm run db:preflight    # check the connection and what would be applied; changes nothing
npm run db:migrate      # apply the migrations
npm run db:status       # confirm the journal and the database agree
```

`db:migrate` refuses to touch a non-local database without `--yes`, and it
prints the plan before it applies anything. It never drops or recreates a
table.

### 4. Seed the first administrator and the permission catalogue

```bash
npm run db:seed:permissions
npm run db:seed
```

`db:seed` reads `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`,
`ADMIN_EMAIL` and `ADMIN_PHONE` from the environment. Set them first, or the
seed creates an administrator you cannot sign in as.

### 5. Run

```bash
npm run dev
```

The app is at <http://localhost:3000>. Vite serves the client through the same
process, so there is no second port and no CORS setup.

### Verify the install

```bash
curl http://localhost:3000/api/health   # {"status":"healthy",...}
curl http://localhost:3000/api/ready    # {"status":"ready",...}
```

`/api/health` answers 200 as long as the process is running. `/api/ready`
answers **503** if the database is unreachable, and names the check that
failed. If `health` is 200 and `ready` is 503, the process is fine and the
database connection is not.

### Or run everything in Docker

```bash
cp .env.example .env      # set the same four values
docker compose up -d --build
docker compose run --rm migrate                                  # inspect only
docker compose run --rm migrate npm run db:migrate -- --yes      # apply
```

The application container **does not migrate on start**. Two containers
starting together would both see a pending migration and both apply it.
Applying a schema change is a decision a person makes, with a backup.

---

## Architecture

```
                      ┌───────────────────────────────┐
  Browser ──────────► │  Node process (port 3000)     │
                      │                               │
                      │  helmet → CORS → rate limit   │
                      │       → correlation id        │
                      │       → JSON body parse       │
                      │                               │
                      │  /api/health   (public)       │
                      │  /api/ready    (public)       │
                      │  /api/auth/*   (public)       │
                      │  ─────── session required ─── │
                      │  /api/*        (tenant-scoped)│
                      │                               │
                      │  SPA fallback → dist/         │
                      └───────────┬───────────────────┘
                                  │ pg pool
                                  ▼
                      ┌───────────────────────────────┐
                      │  PostgreSQL 16                │
                      │  tenants → facilities         │
                      │  patients, encounters,        │
                      │  invoices, lab orders, ...    │
                      └───────────────────────────────┘
```

A text version, for anywhere a diagram will not render:

```
Browser
  │ HTTPS
  ▼
Reverse proxy (nginx / cPanel Passenger)
  │ HTTP
  ▼
Node process ── /api/health, /api/ready  → liveness and readiness
  │         ── /api/auth/*               → sign-in, invitation acceptance
  │         ── /api/*  (session, tenant) → clinical and billing endpoints
  │         ── /*                        → React SPA from dist/
  │
  └── pg connection pool ──► PostgreSQL 16
```

### Request lifecycle

```
request
  ├─ helmet            security headers
  ├─ CORS              origin allowlist
  ├─ correlation id    validate or issue; echoed in X-Correlation-Id
  ├─ rate limit        failures only on /api/auth, broad ceiling elsewhere
  ├─ body parse        1 MB limit
  ├─ route
  │    ├─ session      cookie or bearer → user
  │    ├─ permission   role → permission code
  │    ├─ tenant scope enforced in the query, not after it
  │    └─ handler
  └─ catch-all error handler → JSON { error, correlationId }
```

Every request produces one structured log line on completion: method, path
**without query string**, status, duration, correlation id. Query strings are
excluded because `?nationalId=...` would put a national identity number into
a log file.

### Tenant and facility scope

Multi-tenancy is enforced by filtering in SQL, not by checking results after
they are read. A query for another tenant's data returns nothing because the
`WHERE` clause excluded it. `src/tests/vitest/tenant-isolation.db.spec.ts`
proves this against a real database by creating two tenants with the same
tariff code at different prices.

Superadmin routes are the one exception and are marked as such in the file.

---

## Configuration

All configuration is environment variables; nothing is read from a file other
than `.env` in development. [`.env.example`](.env.example) lists every
variable the code reads, with the reasoning for each.

### Required

| Variable               | Purpose                              | Notes                                         |
| ---------------------- | ------------------------------------ | --------------------------------------------- |
| `FIELD_ENCRYPTION_KEY` | Encrypts patient identifiers at rest | 32 random bytes, base64. **Not recoverable.** |
| `SQL_HOST`             | PostgreSQL host                      | `db` inside the compose stack                 |
| `SQL_PORT`             | PostgreSQL port                      | `5432`                                        |
| `SQL_DB_NAME`          | Database name                        |                                               |
| `SQL_ADMIN_USER`       | Database user                        |                                               |
| `SQL_ADMIN_PASSWORD`   | Database password                    |                                               |
| `APP_BASE_URL`         | Public address of the installation   | Used for invitation links and CORS            |

### Runtime

| Variable                  | Default                                   | Purpose                                                                           |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`                             | `production` tightens CORS and refuses default secrets                            |
| `PORT`                    | `3000`                                    | cPanel and every PaaS set this                                                    |
| `HOST`                    | `0.0.0.0`                                 | Bind address; `127.0.0.1` behind a local proxy                                    |
| `STATIC_DIR`              | `dist/`                                   | Where the built SPA lives                                                         |
| `MIGRATIONS_DIR`          | `drizzle/`                                | Where the migration journal and SQL live                                          |
| `TRUST_PROXY`             | `false`                                   | **Set to `true` behind a reverse proxy**, or rate limiting keys on the proxy's IP |
| `CORS_ALLOWED_ORIGINS`    | empty                                     | Extra origins; comma separated                                                    |
| `TZ` / `DEFAULT_TIMEZONE` | `Africa/Nairobi`                          | Clinical dates and expiry countdowns                                              |
| `LOG_LEVEL`               | `info` (`debug` in dev, `silent` in test) | `fatal`–`trace`                                                                   |
| `LOG_PSEUDONYM_KEY`       | falls back to `FIELD_ENCRYPTION_KEY`      | Key for patient references in logs                                                |

### Database TLS

| Variable                      | Default | Purpose                                                       |
| ----------------------------- | ------- | ------------------------------------------------------------- |
| `SQL_SSL`                     | `false` | `true` for a managed PostgreSQL that requires TLS             |
| `SQL_SSL_REJECT_UNAUTHORIZED` | `true`  | Leave `true`; accepting any certificate is not authentication |

### DHA / AfyaConnect (SHA)

| Variable                                                                  | Default       | Purpose                                                |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ |
| `DHA_MODE`                                                                | `mock`        | `mock` (local fixtures), `sandbox` (UAT), `production` |
| `DHA_BASE_URL`, `DHA_CLIENT_ID`, `DHA_CLIENT_SECRET`, `DHA_FACILITY_CODE` | empty         | Required for `sandbox`                                 |
| `DHA_ALLOW_PRODUCTION`                                                    | `false`       | Must be `true` before `production` mode will run       |
| `DHA_TIMEOUT_MS` / `DHA_MAX_RETRIES`                                      | `15000` / `2` | Outbound resilience                                    |

`mock` mode makes no network calls and marks every result as simulated. Use it
for development and demos. It is the default on purpose.

### Build and development

These affect `npm run dev` and `npm run build`, not the running server.

| Variable             | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `BUILD_TARGET`       | Selects the server bundle target                                |
| `VITE_ALLOWED_HOSTS` | Extra hostnames the Vite dev server answers (tunnels, previews) |
| `DISABLE_HMR`        | `true` disables hot reload and file watching                    |

---

## Database and migrations

Migrations live in `drizzle/` with a journal at `drizzle/meta/_journal.json`.
They are plain SQL files, never edited after they have been applied anywhere.

### Commands

| Command                       | Changes data? | Use                                                 |
| ----------------------------- | ------------- | --------------------------------------------------- |
| `npm run db:preflight`        | No            | Check the connection and print the plan             |
| `npm run db:migrate:dry`      | No            | Print exactly which migrations would run            |
| `npm run db:status`           | No            | Compare the journal with what the database recorded |
| `npm run db:migrate`          | **Yes**       | Apply pending migrations                            |
| `npm run db:seed`             | **Yes**       | Create the first administrator                      |
| `npm run db:seed:permissions` | **Yes**       | Load the permission catalogue                       |

### Rules

1. **Never run a migration against production without a verified backup.**
   Take the backup, restore it somewhere else, and confirm it works before
   touching the real database.
2. **Never edit an applied migration.** Add a new one. The journal records a
   checksum, and `npm run db:status` reports a migration whose file no longer
   matches what was applied.
3. **Never mark a migration applied by hand** to get past an error. If it
   failed, the database is in a state the next migration was not written for.
4. **The application never migrates on start.** There is no automatic
   migration in `server.ts`, the Dockerfile or `docker-compose.yml`, and there
   should not be one.

### Checking a database you did not build

```bash
npm run db:status
```

This is read-only and safe against production. It reports pending migrations,
applied-but-missing files, and applied files edited since they were applied.
Run it before every deployment.

---

## Testing

Two suites, running side by side while the older one is migrated.

### `npm test` — legacy assertion suites

32 suites, ~3,700 assertions. **No database required, but `.env` must be
filled in, not merely copied.**

```bash
cp .env.example .env
# then set SQL_HOST, SQL_PORT, SQL_DB_NAME, SQL_ADMIN_USER,
# SQL_ADMIN_PASSWORD and FIELD_ENCRYPTION_KEY — see step 2 of Quick start.
npm test
```

The suites import `src/config/env.ts`, which validates configuration at load
time and refuses to start without `SQL_*`. **The values are never used to
connect** — any non-empty string satisfies validation — but `.env.example`
ships those keys empty, so an unedited copy is not enough. Run against a bare
`.env` and the first suite exits with:

```
Error: Missing required environment variable: SQL_HOST.
```

That is deliberate: a server with no database configuration must not start
quietly. Two consequences worth knowing:

- `npm test` will not run on a fresh clone until the six values above are
  filled in. Filling them with placeholders is enough; no database is
  contacted.
- This is why the `.env` step comes before it in [Quick start](#quick-start).

`npm run test:unit` is different: it needs `.env` too, but its database specs
skip when PostgreSQL is unreachable, so it runs anywhere.

These are the suites written during development. Each one runs as its own
process (`tsx src/tests/*.test.ts`). They are the reason the system is
trusted today, and they are being replaced one at a time rather than all at
once.

### `npm run test:unit` — Vitest

```bash
npm run test:unit        # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage and thresholds
```

Runs the specs in `src/tests/vitest/`. No database required for most of them.

| Command                 | What it runs                    |
| ----------------------- | ------------------------------- |
| `npm run test:unit`     | Vitest only                     |
| `npm test`              | Legacy suites only              |
| `npm run test:all`      | Both                            |
| `npm run test:coverage` | Vitest with coverage thresholds |

### Component tests

React components use React Testing Library under jsdom. A spec opts in with a
docblock, and everything else stays in Node:

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
```

### Database tests

Specs named `*.db.spec.ts` need PostgreSQL. Without one they **skip** and say
so; they do not fail:

```
PostgreSQL not reachable at 127.0.0.1:5432 — database specs will be skipped.
```

In CI, `JALICARE_REQUIRE_DB=1` turns that skip into a failure, so a database
that did not start cannot pass quietly. The migration specs also refuse to run
against a database whose name does not contain `test`.

### Coverage

Measured, not asserted. Current figures are in
[`docs/quality/BASELINE.md`](docs/quality/BASELINE.md) and enforced as a
ratchet in `vitest.config.ts`: global thresholds sit just below the measured
value so coverage cannot regress, plus high per-module thresholds on the
pricing rules, where a defect bills a patient the wrong amount.

```bash
npm run test:coverage
open coverage/index.html
```

---

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull
request and on pushes to `main`, `arena/**`, `restructure/**`, `feature/**`
and `fix/**`.

| Job        | What it proves                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `static`   | `tsc --noEmit` passes; ESLint reports 0 errors                                                     |
| `unit`     | Vitest passes and coverage meets the thresholds                                                    |
| `legacy`   | The 32 hand-written suites still pass                                                              |
| `database` | Migrations apply to a real **PostgreSQL 16**, status is clean, dry run is read-only, DB specs pass |
| `build`    | Client and server bundle, then **starts the real artifact** and checks `/api/health` and `/`       |
| `audit`    | `npm audit --omit=dev --audit-level=high`                                                          |
| `format`   | `npm run format:check` over every file `npm run format` rewrites                                   |

The PostgreSQL service uses throwaway credentials committed on purpose: they
grant access to an empty database that is destroyed with the runner. No real
patient data or production secret is used anywhere in CI.

No job uses `continue-on-error`, and none is conditional on another's
outcome, so any failure fails the run. The `database` job sets
`JALICARE_REQUIRE_DB=1`, which turns "PostgreSQL was unreachable" from a
skip into a failure — otherwise a missing service would report green.

`format:check` covers the same files `format` rewrites, including root
`*.{json,md}`. It did not always: the fixer formatted those and the check
never looked at them, so five files were unformatted and nothing said so.

Run the same gates locally:

```bash
npm run ci
```

Dependabot opens grouped patch/minor updates weekly, majors as separate pull
requests, and security fixes immediately
([`.github/dependabot.yml`](.github/dependabot.yml)).

---

## Tariff and billing codes

Codes to use in a facility, for a billing structure that works on the first try.

The engine tries, in order: an explicit **link** (`billing_key`), then the
tariff's **code**, then the tariff's **description**. A link is exact and is
always the cheapest way to make automatic billing work; the code and
description columns are what the engine falls back to when no link exists.

Two rules apply to every row below:

- **File the tariff under the right module.** An automatic charge only reads
  tariffs filed in the departments its family owns — `inpatient` for admission
  and bed nights, `laboratory` for tests, `radiology` for imaging, `pharmacy`
  for drugs. A correct code filed under the wrong module is invisible.
- **Give it the right unit.** A bed night must be `Per day`, an admission fee
  `Per admission`, a test `Per test`. The resolver refuses a contradictory unit
  (`UNIT_INCOMPATIBLE`) rather than billing the wrong one.

| Charge                  | Code to use                         | Description to write               | Unit          | Module     | Link (`Used for automatic billing`)                               |
| ----------------------- | ----------------------------------- | ---------------------------------- | ------------- | ---------- | ----------------------------------------------------------------- |
| Outpatient consultation | `OPD-001`                           | General outpatient consultation    | Per visit     | opd        | `CONSULTATION`                                                    |
| Follow-up consultation  | `OPD-002`                           | Follow-up consultation             | Per visit     | opd        | none — priced by code/description                                 |
| Laboratory test         | the test's own code, e.g. `LAB-CBC` | Full blood count                   | Per test      | laboratory | `LABORATORY:LAB-CBC`, or `LABORATORY` for one flat test price     |
| Imaging                 | `RAD-001`                           | Obstetric ultrasound               | Per study     | radiology  | `RADIOLOGY:RAD-001`, or `RADIOLOGY`                               |
| Procedure               | `PROC-001`                          | Wound dressing                     | Per procedure | theatre    | `PROCEDURE:PROC-001`, or `PROCEDURE`                              |
| Admission (one-off)     | `ADM-001`                           | Inpatient admission administration | Per admission | inpatient  | `ADMISSION`                                                       |
| Bed night               | `BED-GEN` (or the ward's own code)  | General ward bed charge            | Per day       | inpatient  | `BED_DAY` for general wards, or `BED_DAY:<WARDCODE>` for one ward |
| Delivery                | `MAT-001`                           | Normal delivery                    | Per delivery  | inpatient  | `DELIVERY`                                                        |
| Drug                    | `DRUG-<NAME>`                       | the drug name as dispensed         | Per unit      | pharmacy   | `PHARMACY`, or `PHARMACY:DRUG-<NAME>`                             |

The families the engine recognises are `CONSULTATION`, `LABORATORY`,
`RADIOLOGY`, `PROCEDURE`, `ADMISSION`, `BED_DAY`, `DELIVERY` and `PHARMACY`.

Notes that save an afternoon:

- **Ward codes drive bed-day codes.** A ward whose `wards.code` is `GEN` is
  offered `BED-GEN` and `WARD-GEN` before the generic `BED-DAY`. Keep ward codes
  short and stable (`GEN`, `ICU`, `MAT`, `PAED`).
- **A bed-night link means one category.** A plain `BED_DAY` link is skipped for ICU, HDU, maternity and isolation beds, so a special bed is reported as unconfigured rather than billed at the general rate. Link that ward explicitly (`BED_DAY:ICU`) or give it its own row.
- **Codes are compared after upper-casing and normalising punctuation**, so
  `opd-001` and `OPD-001` are the same code. The description fallback is
  stricter on purpose: a word like "consultation" alone will not choose between
  `OPD-001` and `OPD-002`, and an ambiguous description is reported, not
  guessed.
- **Pharmacy prices from the tariff first.** A dispensed drug is matched by
  code and description; the item's own selling price is only the fallback.
- **Nothing here is seeded.** These are the rows to create in Configuration →
  Services & Tariffs (and Configuration → Wards for the ward codes). The
  facility types its own prices; this code never invents one.

The rules above are pinned by `src/tests/vitest/tariff-matching.spec.ts`,
which executes them rather than checking that the source contains them.

---

## Production deployment

### Before you deploy

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build:deploy     # produces dist/ and build/server.js
npm run verify:deploy    # dry run + deployment contract checks
```

### What a deployment consists of

Two artifacts and the migration files:

```
build/server.js     the bundled server
dist/               the compiled SPA
drizzle/            the migration SQL and journal
package.json        production dependencies
```

`npm run build:deploy` produces the first two. Do not build on the production
server — build here, verify here, upload the artifacts.

### Starting it

```bash
NODE_ENV=production node build/server.js
```

`npm start` runs exactly that. **Do not use `node server.ts`**: it is the
development entry point, it compiles TypeScript at runtime, and it is not what
was tested.

cPanel/Passenger supplies `PORT` and `HOST`; the application reads both. If
`PORT` is missing in production it logs a warning and falls back to 3000,
which is almost certainly not what the proxy expects.

### Health checks

Point the platform's check at **`/api/ready`**, not `/api/health`:

```bash
curl -fsS https://your-host/api/ready || echo "not ready"
```

`/api/health` answers 200 while the process is alive even if it cannot reach
the database. That is the right answer for "should the supervisor restart
this process" and the wrong one for "should the proxy send it traffic".

### Docker

```bash
docker compose up -d --build
docker compose run --rm migrate npm run db:migrate -- --yes
```

The image runs as a non-root user, carries production dependencies only, has
no writable application code, and handles `SIGTERM` through `dumb-init`. The
database is not published to the host; the app reaches it by service name.

### Backups

Before any migration on a database holding real records:

```bash
docker compose exec db pg_dump -U "$SQL_ADMIN_USER" -Fc "$SQL_DB_NAME" > backup.dump
```

Restore it somewhere else and confirm it opens. A backup you have not restored
is a file, not a backup.

---

## Troubleshooting

**`Missing required environment variable: SQL_HOST`**
The `.env` is not being read, or the variable is empty. cPanel sets variables
in _Setup Node.js App → Environment variables_, not in a file.

**`/api/health` is 200 but `/api/ready` is 503**
The process is running and the database is not reachable. Check `SQL_HOST`,
the database is up, and the password. The response names the failing check;
the log has the error code.

**`FIELD_ENCRYPTION_KEY is required` / startup fails immediately**
Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Everyone is rate-limited at once**
`TRUST_PROXY` is not set. Behind a proxy every request appears to come from
the proxy's address, so one busy client exhausts the shared limit.

**`db:status` reports a migration as "edited after apply"**
The file changed after it was applied. Do not edit it back blindly: work out
what the database actually has, then write a new migration that reconciles it.

**The SPA is blank after a deploy but the API works**
The browser cached `index.html` and is asking for old asset hashes. The
application serves `index.html` with `no-store`; if a proxy or CDN overrides
that, it will happen again. `STATIC_DIR` pointing at the wrong directory
produces the same symptom, with a message in the log naming the path it tried.

**`npm ci` fails with `ERESOLVE`**
`@eslint/js` must stay on `^9` while ESLint is on 9. A dependency update that
moves it to 10 breaks the install.

**Tests fail only when formatting changes**
Some legacy suites assert on the exact layout of _other files'_ source text.
They are being migrated. Do not run `npm run format` across the tree and commit
it without re-running `npm test`.

---

## Project layout

```
src/
  app.ts                 6,188 lines — middleware and routes (being split)
  App.tsx                React root
  db/
    schema.ts            6,900 lines — every table (being split by domain)
    queries.ts           4,300 lines — shared queries
    index.ts             the connection pool
  routes/                extracted routers
    platform/            platform-admin helpers, validation, subscriptions
    shared/              request, error and billing helpers used by routers
    system.routes.ts
    inpatient.routes.ts
    maternal-health.routes.ts
  auth/                  sign-in, sessions, password policy
  billing/               pricing rules, invoices, claims
  logging/               structured logging and redaction
  middleware/            security, rate limiting, scoping
  components/            React components
  tests/
    *.test.ts            32 legacy suites
    vitest/              Vitest specs, including *.db.spec.ts
drizzle/                 migration SQL and journal
scripts/                 build, migrate, preflight, verification
docs/                    architecture, quality, deployment, history
server.ts                development and production entry point
```

`docs/` holds the details:

- [`docs/quality/BASELINE.md`](docs/quality/BASELINE.md) — measured test, build and coverage baseline
- [`docs/architecture/`](docs/architecture/) — domain notes
- [`docs/deployment/`](docs/deployment/) — hosting notes
- [`docs/history/HANDOVER-2025-2026.md`](docs/history/HANDOVER-2025-2026.md) — the development log, archived

---

## Known limitations

Stated here rather than discovered later.

- **Coverage is low.** The legacy suites assert on source text rather than
  executing code, so measured coverage is in single digits. The numbers and
  the migration plan are in
  [`docs/quality/BASELINE.md`](docs/quality/BASELINE.md).
- **`app.ts`, `schema.ts` and `queries.ts` are still large.** `app.ts` has
  come down from 8,449 to 6,188 lines by moving three domains out whole —
  platform administration, maternal and child health, and inpatient care —
  each behind its own router and verified by a route-inventory diff. Roughly
  90 routes remain inline, including billing, claims and the DHA integration.
  `schema.ts` (5,910) and `queries.ts` (4,303) are untouched.
- **Doctor and nurse portals depend on accounts created by an administrator.**
  There is no self-service registration, by design.
- **The DHA integration is not live.** `DHA_MODE=mock` is the default and no
  sandbox or production credentials are configured.
- **Backup snapshots are no longer tracked.** 206 `*.bak` / `*.backup-*`
  files were removed from the index with `git rm --cached`; the working copies
  remain on disk, untracked and ignored, and git history still holds every
  version. No tracked file matches those patterns today.
- **Docker was configured but not executed** in the environment where this was
  written: the files are linted and the commands are correct, but the image
  build itself has not been run here.
- **Database tests skip when no PostgreSQL is present.** They are not silently
  passing; they report the address they tried and why they skipped. In CI,
  skipping is an error.

---

## Licence and compliance

Patient data is handled under the Kenya Data Protection Act 2019. Credentials
and patient identifiers are encrypted at rest and redacted from logs. The
system records an audit trail for clinical and billing actions, and that trail
should not be disabled.
