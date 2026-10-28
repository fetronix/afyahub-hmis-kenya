# Changelog

Changes to JaliCare Kenya HMIS, most recent first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Zod v4 route-level input validation (`src/validation/`)** across platform
  administration, authentication, staff roles/invitations, patients, invoices,
  insurance claims, tenancy, and audit-log endpoints, preserving the structured
  `400 VALIDATION_ERROR` response envelope and running strictly after
  authentication/RBAC middleware.
- **Behavioral Express HTTP & domain integration suites (`src/tests/integration/`)**
  covering authentication/session lifecycles, platform tenant/facility/RBAC/
  subscription workflows, cross-tenant and cross-facility boundary enforcement,
  billing/claims/FEFO inventory services, maternity/MCH and inpatient clinical
  workflows, and PostgreSQL end-to-end HTTP provisioning (`http-database.db.spec.ts`).

### Changed

- **Modularized five large clinical, API, platform, and service files** into
  cohesive `<500 LOC` domain modules with backward-compatible re-export facades:
  - `src/components/modules/MaternityModule.tsx` (2,746 -> 405 LOC) + 8 clinical
    sub-modules under `src/components/modules/maternity/`.
  - `src/api/client.ts` (2,607 -> 97 LOC) + 8 domain API clients under
    `src/api/clients/`.
  - `src/routes/platform.routes.ts` (2,014 -> 29 LOC) + sub-routers under
    `src/routes/platform/` (`tenants`, `facilities`, `invitations`, `rbac`,
    `subscriptions`, `shared`, `validation`).
  - `src/maternity/maternity.service.ts` (1,552 -> 62 LOC) + 5 clinical services
    under `src/maternity/services/`.
  - `src/auth/staff-roles.service.ts` (1,517 -> 45 LOC) + 4 RBAC/status modules
    under `src/auth/staff-roles/`.
- **Coverage ratchet raised in `vitest.config.ts`** from `19.0 / 19.1 / 19.3 / 16.6`
  to `41.0% lines / 40.5% statements / 41.5% functions / 35.5% branches` plus 12
  new per-module gates across validation, platform, maternity, staff-roles,
  claims, inventory, reporting, and patient-identifier encryption.
- Replaced brittle `readFileSync` source-substring assertions in `claims.spec.ts`,
  `pharmacy-batches.spec.ts`, `reporting.spec.ts`, and `staff-roles.spec.ts`
  with behavioral runtime tests, updated `verify:deploy` to invoke
  `deployment.spec.ts`, and removed unused direct dependencies (`pino-http`,
  `autoprefixer`, `eslint-config-prettier`).

### Fixed

- **A 500 returned the exception's own text.** Twenty-nine handlers answered
  unexpected failures with `error: err.message`. A PostgreSQL unique-violation
  carries the constraint name and, in its `DETAIL` line, the offending values —
  including patient identifiers and tenant ids. An authenticated user of one
  facility could therefore infer that a named patient record existed at another.
  All twenty-nine now call `respondInternalError`, which logs the operation and
  the original error server-side and returns a fixed message. Status codes and
  the response shape are unchanged; deliberate domain-error messages are still
  returned as before. Covered by `internal-error.spec.ts`.
- **The protected-route list named six routes that do not exist.** The
  authorization suite asserts that clinical and financial routes answer 401
  without a session. `requireAuth` is mounted on all of `/api`, so it rejects
  before routing resolves, and a typo'd path answers exactly like a real one.
  `POST /api/lab/orders`, `POST /api/billing/invoices`,
  `POST /api/insurance/claims` and their read counterparts were wrong; the real
  paths are `/api/lab-orders`, `/api/invoices` and `/api/claims`. The paths are
  corrected and every entry is now checked against the app's route table, so a
  rename cannot silently turn a test into a no-op.
- **`format:check` did not cover the files `format` rewrites.** The fixer
  formatted root `*.{json,md}`; the required CI check never looked at them, so
  `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md`, `SECURITY.md` and
  `tsconfig.json` were unformatted and nothing reported it. Both scripts now
  cover the same scope and those files are formatted (table alignment and
  indentation only; `tsconfig.json` parses to an identical object).

### Changed

- **`src/app.ts` split by domain.** 8,449 -> 6,188 lines, three extractions,
  each verified by dumping the app's route table before and after and comparing
  the sets rather than reading the diff:
  - `routes/platform/subscriptions.routes.ts` — 8 subscription routes.
  - `routes/maternal-health.routes.ts` — 23 maternity and immunisation routes.
  - `routes/inpatient.routes.ts` — 22 ward, bed, admission and nursing routes.
    Shared helpers that were trapped inside `createApp` moved to
    `routes/shared/` (request context, domain error handlers, charge helper,
    validation) so routes outside that function can use them.
- **Tenant and facility validation extracted** to
  `routes/platform/validation.ts` as pure functions, so the rules can be tested
  without authentication or a database. Behaviour is unchanged and was checked
  by driving the old inline logic and the new parsers over 40,000 generated
  bodies: 0 disagreements.
- README corrected: the `format` job is no longer described as advisory, the
  legacy-suite count (29 -> 32), the `app.ts` size and the extraction status,
  and the note about tracked backup files (none remain).

### Added

- Router tests that fail if an extracted router is mounted at the wrong prefix,
  mounted nowhere, or loses a route: `platform-router.spec.ts` (8),
  `maternal-health-router.spec.ts` (5), `inpatient-router.spec.ts` (7),
  `platform-validation.spec.ts` (67), `internal-error.spec.ts` (5). Each was
  mutation-tested by breaking the mount or renaming a route.
- Coverage thresholds verified as enforced, not assumed: raising the global
  `lines` threshold to 99 fails the run with
  `ERROR: Coverage for lines (12.08%) does not meet global threshold (99%)`,
  and raising one per-module threshold fails it too.

### Repository hygiene

- **Untracked 206 backup snapshots** (523 tracked files -> 317). Timeline
  copies of `App.tsx`, `schema.ts`, `platform.routes.ts`, `api/client.ts` and
  others, plus six backups sitting inside `drizzle/` next to the real
  migrations. Removed with `git rm --cached`, so the local files are intact.
  No real migration matched; all 23 `.sql` files and the journal remain.
- `.gitignore` already covered the patterns, so they cannot be re-added.

### Security

- **Confirmed and documented the dump exposure.** The four committed
  `pg_dump` archives were inspected at the structure level (outside the
  repository; no values printed or committed). They contain real personal
  data and user credential material — up to 14 Argon2id password hashes, 19
  Kenyan phone numbers, 83 email addresses across the four files — not
  synthetic fixtures. `docs/security/DATA-EXPOSURE.md` now records the
  finding, the DPA 2019 consequences, and the owner actions outstanding.
  The files remain in history; the purge still needs authorisation.
- `SECURITY.md` added: private reporting route, what must never be pasted
  into a report, the known exposure, and an honest statement that no tagged
  releases exist and no security email is published.
- `.env.example` now documents `LOG_LEVEL`, `LOG_PSEUDONYM_KEY`,
  `JALICARE_DB_AVAILABLE` and `JALICARE_REQUIRE_DB`, which the source read
  but the example omitted. Empty values; no credential introduced.

### Testing

- `src/tests/vitest/auth-validation.spec.ts` — 46 tests over
  `src/auth/auth.validation.ts`, the gate every login, session check and
  password reset passes through, previously untested. 0% -> 97.67% lines.
- `src/tests/vitest/notification-dialog.spec.tsx` — 17 tests over the
  notification component: tone labelling (a failure must never read
  "Saved"), empty-queue rendering, every dismissal path, and accessibility.
- Both mutation-checked against deliberately broken source.
- Coverage 7.27% -> 7.90% lines (7.06 -> 7.66 statements, 4.05 -> 4.57
  functions, 1.84 -> 2.54 branches); 99 -> 162 passing Vitest tests.
  Thresholds raised to just under the new measurement.

### Changed

- `package.json` identity: `react-example` / `0.0.0` -> `jalicare-hmis` /
  `0.1.0`. Deliberately not 1.0.0: there are no tags and no releases. No
  `license` field is added — that decision belongs to the owner.
- README testing instructions corrected: copying `.env.example` alone is not
  enough, because its `SQL_*` values ship empty. Verified by following the
  instructions as written and hitting the failure.
- README and CI comments corrected from 29 suites to 32.

Repository quality and buyer-readiness upgrade. Every entry below was applied
on its own and verified with the full local gate: `tsc --noEmit`, ESLint,
29 legacy suites, Vitest, `build:deploy`, and a smoke test of the built
server.

### Added

**Testing**

- Vitest, alongside the 29 legacy suites rather than replacing them. Rewriting
  ~3,700 assertions in one step would destroy the only evidence the system
  works; suites move one at a time, with their assertions carried across.
- React Testing Library under jsdom. Specs opt in with a
  `// @vitest-environment jsdom` docblock; everything else stays in Node.
- Coverage reporting with v8, enforced as a ratchet rather than an aspiration:
  global thresholds sit just below the measured value, and the pricing rules
  (`tariff-codes`, `tariff-words`, `tariff-matching`) carry high per-module
  thresholds because a defect there bills a patient the wrong amount.
- `src/tests/vitest/tariff-matching.spec.ts` — executes the pricing ladder
  (link beats code beats description) instead of asserting the source contains
  it.
- `src/tests/vitest/logger.spec.ts` — proves each redaction path against a
  real logger writing to a real stream.
- `src/tests/vitest/app-http.spec.ts` — drives the real Express app over a
  real socket: health, readiness, correlation ids, malformed bodies,
  unauthenticated access.
- `src/tests/vitest/migrations.db.spec.ts` and
  `tenant-isolation.db.spec.ts` — the first tests in this repository that
  touch PostgreSQL. They skip with the address they tried when no database is
  present, and fail when `JALICARE_REQUIRE_DB=1`.

**CI**

- `.github/workflows/ci.yml` with seven jobs: `static`, `unit`, `legacy`,
  `database` (real PostgreSQL 16 service with health checks), `build` (which
  starts the built artifact and checks it answers), `audit`, and an advisory
  `format`.

**Deployment**

- `Dockerfile` — three stages, non-root runtime, production dependencies only,
  no writable application code, `dumb-init` for signal handling.
- `docker-compose.yml` — PostgreSQL 16 with a real healthcheck, service-DNS
  connectivity, named volumes for data and uploads, no database port published
  to the host.
- Separate one-shot migration service. Migrations are never run on start.
- `.dockerignore` — excludes `.env`, keys, tests, backups and data dumps.

**Observability**

- `src/logging/logger.ts` — Pino structured logging, JSON in every environment.
- Redaction of credentials **and patient identity**, generated across four
  levels of nesting.
- `patientRef()` — keyed HMAC so logs can correlate two events about one
  patient without containing anything that identifies them.
- `correlationIdFrom()` — validates a caller-supplied correlation id, so a
  forged header cannot inject newlines into log lines.
- One structured line per request with method, path, status, duration and
  correlation id. Query strings are excluded: `?nationalId=...` is a national
  identity number in a log file.
- `/api/ready` — reports 200/503 against a real `SELECT 1`, cached for two
  seconds. `/api/health` continues to report only that the process is alive.

**Documentation**

- `README.md` rewritten: quick start, architecture with a diagram, full
  environment reference, migration rules, testing, CI, production deployment,
  troubleshooting, project layout, and a list of known limitations.
- `CONTRIBUTING.md` — the rules this project holds to, and the checklist for a
  migration or a pull request.
- `CHANGELOG.md` — this file.
- `docs/quality/BASELINE.md` — measured baseline, taken before any change.
- The previous 2,400-line development log is preserved at
  `docs/history/HANDOVER-2025-2026.md`, marked as an archive.

**Tooling**

- ESLint (flat config, TypeScript via `@babel/eslint-parser`) and Prettier.
- `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test:unit`,
  `test:watch`, `test:coverage`, `test:all`, `ci`.
- `engines` declaring the Node range the build tools actually require.
- `.github/dependabot.yml` — grouped weekly patch/minor updates, separate
  majors, immediate security fixes, plus actions and the Docker base image.

### Changed

- `src/app.ts` lost its health and readiness routes to
  `src/routes/system.routes.ts`. Paths, response shapes and public access are
  unchanged; the extraction is the first slice of the split.
- `matchTariff` does not filter `isActive` on the code rung — the guarantee
  comes from the query in `loadTariffs`. This was always true; the test now
  records it instead of assuming otherwise.

### Fixed

- **Unaliased errors returned stack traces.** The application had no catch-all
  error handler, so an unhandled route error answered with Express's HTML page
  containing the stack, file paths and library versions. It now answers JSON
  with a status and a correlation id; the detail goes to the log.
- **Malformed JSON answered 500.** A client sending a broken body now receives 400. Answering 500 sent operators looking for an outage that did not exist.
- **The correlation id on a malformed body was empty**, because the body parser
  ran before the middleware that set it. Request logging now runs before the
  rate limiters and the body parser.
- **`sql.raw(ARRAY[...])` string-built SQL** in `maternity.service.ts`. The
  interpolated values came from the database and were integers, so it was not
  exploitable — but it was one refactor away from being so. Replaced with
  parameterised `inArray`. Zero string-built SQL remains.
- **12 dependency advisories, 4 high → 4 moderate, none high.**
  `body-parser` (high, DoS), `uuid`, `gaxios` and `vite` upgraded;
  `firebase`, `firebase-admin`, `@google/genai` and `motion` removed — none
  was imported anywhere and `firebase` alone carried three high advisories
  with no fixed release.
- **The redaction list missed `dha.credentials.clientSecret`**, two levels
  deep, where a single `*` does not reach. The list is now generated, and a
  test proves it.

### Removed

- `firebase`, `firebase-admin`, `@google/genai`, `motion` — unused project
  template leftovers. Removal verified against typecheck, build, all 29 legacy
  suites and Vitest.

### Not changed

Deliberately, and for the record:

- `src/app.ts` (8,449 lines), `src/db/schema.ts` (6,862) and
  `src/db/queries.ts` (4,303) are not split. The domain extraction has begun;
  the clinical routes depend on nearly every table, so they wait for the
  schema split.
- No migration was edited, deleted or re-applied.
- No clinical or billing behaviour changed.
- No authentication, permission, encryption or audit control was relaxed.
- No production database was contacted.

---

## Earlier history

Development before this changelog was kept as a running handover log rather
than release notes. It is preserved at
[`docs/history/HANDOVER-2025-2026.md`](docs/history/HANDOVER-2025-2026.md)
because it records _why_ decisions were made — which migrations were applied
when, which tenant-scoping problems were found, and what was verified against
a real database and what was not.
