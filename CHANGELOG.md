# Changelog

Changes to JaliCare Kenya HMIS, most recent first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
- **Malformed JSON answered 500.** A client sending a broken body now receives
  400. Answering 500 sent operators looking for an outage that did not exist.
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
because it records *why* decisions were made — which migrations were applied
when, which tenant-scoping problems were found, and what was verified against
a real database and what was not.
