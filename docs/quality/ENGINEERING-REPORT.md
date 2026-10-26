# Engineering report — quality, refactoring and CI

Branch `arena/bf3abf18-afyahub-hmis-kenya`, based on `origin/main` at
`3945a91`. Fifteen commits, all pushed, all green in CI.

This report records what was measured, what was changed, what was verified,
and what was deliberately left alone. Where something could not be verified
in this environment it says so instead of claiming a result.

---

## 1. Baseline, before any edit

Measured on `3945a91` with `SQL_*` pointed at an unreachable host (no
PostgreSQL in this sandbox), `NODE_ENV=test`, `TZ=Africa/Nairobi`.

| Command                             | Result at baseline               |
| ----------------------------------- | -------------------------------- |
| `npm run typecheck`                 | pass (exit 0)                    |
| `npm run lint`                      | pass — 0 errors, 52 warnings     |
| `npm test` (32 legacy `tsx` suites) | pass (exit 0)                    |
| `npx vitest run`                    | pass — 463 tests, 11 skipped     |
| `npm run build`                     | pass (exit 0)                    |
| `npm run build:server`              | pass (exit 0)                    |
| `prettier --check`                  | **fail — 183 files unformatted** |
| `npm audit --omit=dev`              | 0 vulnerabilities                |

The system was not broken. The defects were in what the repository was
willing to claim about itself.

### Findings

**CI reported a formatting check that could not fail.** The `format` job
carried `continue-on-error: true`, so it went red on every run and was read
as noise. 183 files predated the formatter.

**206 backup snapshots were tracked** — timeline copies of `App.tsx`,
`schema.ts`, `platform.routes.ts`, `api/client.ts`, plus six inside
`drizzle/` sitting next to real migrations.

**Six paths in the authorization test named routes that do not exist.**
`POST /api/lab/orders`, `POST /api/billing/invoices`,
`POST /api/insurance/claims` and their read counterparts — the real paths are
`/api/lab-orders`, `/api/invoices`, `/api/claims`. They passed anyway,
because `requireAuth` is mounted on all of `/api` and rejects before routing
resolves. A typo'd path answers 401 exactly like a real protected one.

**Twenty-nine handlers returned the exception's own text.** A PostgreSQL
unique-violation carries the constraint name and, in its `DETAIL` line, the
offending values — including patient identifiers and tenant ids.

**`format:check` did not cover what `format` rewrites.** The fixer formatted
root `*.{json,md}`; the required check never looked at them. Five files were
unformatted and nothing reported it.

**`src/app.ts` was 8,449 lines** with 142 routes registered directly on the
app and the helpers they needed declared inside `createApp`, reachable from
nothing else. That, more than the size, is why it had not been split.

---

## 2. What changed

### Structure

| File                                          | Before | After     |
| --------------------------------------------- | ------ | --------- |
| `src/app.ts`                                  | 8,449  | **6,188** |
| `src/routes/platform.routes.ts`               | 3,444  | **2,000** |
| `src/routes/platform/subscriptions.routes.ts` | —      | 1,083     |
| `src/routes/inpatient.routes.ts`              | —      | 906       |
| `src/routes/maternal-health.routes.ts`        | —      | 711       |
| `src/routes/platform/validation.ts`           | —      | 273       |
| `src/routes/platform/shared.ts`               | —      | 120       |
| `src/routes/shared/errors.ts`                 | —      | 160       |
| `src/routes/shared/request.ts`                | —      | 70        |
| `src/routes/shared/charges.ts`                | —      | 23        |

### Three domains moved out of `createApp`

Each was moved whole — handlers, middleware, validation, error handling —
and mounted at the same `/api` prefix at the same point in the chain.

- **Platform subscriptions** — 8 routes.
- **Maternal and child health** — 23 routes (maternity, deliveries,
  postnatal, immunisation).
- **Inpatient care** — 22 routes (wards, beds, admissions, transfers,
  discharge, ward board, admission vitals, nursing record).

The extraction was only possible after moving the helpers out of
`createApp` (`requireAuthContext`, `parseOptionalPositiveId`,
`handleScopeError`, `handleInpatientError`, `chargeSafely`) into
`src/routes/shared/`. They were the actual blocker.

### Validation extracted, behaviour unchanged

`POST /tenants` and `PATCH /facilities/:id` validated inline, behind
authentication and a live database, so most rules had never been tested.
They are now pure functions in `src/routes/platform/validation.ts`.

The first draft of that module was **wrong**: written from what platform
settings usually look like, it validated `status`, `ownership`, `latitude`
and `bedCapacity`, none of which the handler reads. It was rewritten by
reading the handlers and reproducing their decisions. The equivalence claim
was checked, not asserted: the old inline logic and the new parsers were
driven over 40,000 generated bodies.

    tenants    1,582 accepted / 18,418 rejected    0 disagreements
    facilities 4,005 accepted / 15,995 rejected    0 disagreements

---

## 3. How each refactor was verified

Reading a diff does not prove a router still works. Every extraction was
verified by dumping the app's route table before and after and comparing the
sets.

    platform subscriptions   removed 8   added 0   router matched 8/8
    maternal health          removed 23  added 0   router matched 23/23
    inpatient                removed 22  added 0   router matched 22/22

Mount prefixes are checked rather than assumed. Express does not expose a
sub-router's mount path, but the layer carries the regexp it matches with:
mounted at `/api` it accepts `/api/wards` and rejects `/wards`; mounted at
the root it accepts both.

Mutation testing — each mutation applied, observed, then reverted and
confirmed against a clean tree:

| Mutation                                   | Failures                                  |
| ------------------------------------------ | ----------------------------------------- |
| Sub-router not mounted                     | 3 (platform), 1 (maternal), 1 (inpatient) |
| Mounted at `/subscriptions` instead of `/` | 1                                         |
| Mounted at `/` instead of `/api`           | 1, 1                                      |
| Route left duplicated in both files        | 1                                         |
| Discharge route renamed                    | 2                                         |

Behaviour was preserved, and the tests that prove it still run:
`ward-billing.test.ts` still pins that discharge commits before billing,
that discharge has no bed-day loop of its own, and that transfer uses the
same shared accrual. `postnatal-immunisation.test.ts` still pins one charge
per delivery (twins do not multiply it), the `MATERNITY` source type, and
that no price is invented when a facility has no delivery tariff.

---

## 4. Commands, final state

Run on `7f6c5c1` from a clean tree.

| Command                                       | Exit | Result                                          |
| --------------------------------------------- | ---- | ----------------------------------------------- |
| `npm run typecheck`                           | 0    | clean                                           |
| `npm run lint`                                | 0    | 0 errors, 52 warnings (unchanged from baseline) |
| `npm test`                                    | 0    | 32 legacy suites pass                           |
| `npx vitest run`                              | 0    | 576 tests, 11 skipped                           |
| `npm run test:coverage`                       | 0    | thresholds met                                  |
| `npm run build`                               | 0    | client bundle                                   |
| `npm run build:server`                        | 0    | server bundle                                   |
| `npm run verify:deploy`                       | 0    | migration dry run + deployment suite            |
| `npm run format:check`                        | 0    | all files formatted                             |
| `npm run db:migrate` / `db:status` / DB specs | —    | **not runnable here — no PostgreSQL**           |
| PostgreSQL integration job                    | pass | **verified in CI, not locally**                 |

The `database` CI job passed on all seven pushed commits, which is where the
migrations actually apply, `db:status` is checked clean, the `*.db.spec.ts`
suites run, and `test:auth-db` runs. That job is real evidence; this
sandbox cannot reproduce it and no local claim is made for it.

---

## 5. Coverage

Measured by `npm run test:coverage` (v8).

| Metric       | Baseline | Now        | Change |
| ------------ | -------- | ---------- | ------ |
| Lines        | 11.50%   | **12.10%** | +0.60  |
| Statements   | 11.35%   | **11.90%** | +0.55  |
| Functions    | 8.77%    | **9.32%**  | +0.55  |
| Branches     | 7.42%    | **8.23%**  | +0.81  |
| Vitest tests | 463      | **576**    | +113   |

**This is not whole-repository coverage.** The Vitest config excludes
`src/components/**` from measurement (DOM coverage is tracked separately),
along with `src/main.tsx` and `.d.ts` files. The honest statement is: ~12%
line coverage of the server-side and domain code that the config includes.
The legacy suites contribute none of this — they assert on source text and
execute almost nothing, which is why the percentage is low despite ~3,700
assertions.

---

## 6. CI gating

### What the workflow does now

Eight jobs, none with `continue-on-error`, none conditional on another's
outcome: `static` (typecheck + lint), `unit` (Vitest + coverage thresholds),
`legacy` (32 suites), `database` (PostgreSQL 16: migrations, status, DB
specs, auth suites), `build` (both bundles, then starts the real artifact
and checks `/api/health` and `/`), `audit`, `format`.

The only `|| true` in the file is on an explicitly informational
`npm audit --json` step that uploads a report. The required audit,
`npm audit --omit=dev --audit-level=high`, has no escape.

### How failure propagation was verified

Not by reading YAML. Each gate was given a deliberate fault and had to turn
the run red:

| Injected fault                                                     | Exit                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Type error in a source file                                        | 1                                                                      |
| ESLint error                                                       | 1                                                                      |
| Unformatted file                                                   | 1                                                                      |
| Failing legacy assertion                                           | 1                                                                      |
| Failing Vitest test                                                | 1                                                                      |
| Coverage below global threshold (raised `lines` to 99)             | 1 — `Coverage for lines (12.08%) does not meet global threshold (99%)` |
| Coverage below per-module threshold (`tariff-codes` raised to 100) | 1                                                                      |
| Broken client build                                                | 1                                                                      |
| Broken server build                                                | 1                                                                      |
| PostgreSQL unreachable with `JALICARE_REQUIRE_DB=1`                | 1 — fails, does not skip                                               |

The last one matters: without `JALICARE_REQUIRE_DB=1` a missing database
makes the suite skip and the run green (verified: `5 skipped`, exit 0). With
it, the same run fails. That is the difference between a gate and a
formality.

The strongest evidence was not a probe: during the inpatient extraction
`npm test` went red three separate times on real regressions, blocking the
commit each time. The gate works because it stopped real work.

### Known gap

Whether these checks are **required for merge** could not be verified.
`gh api .../branches/main/protection` returns `403 Resource not accessible
by integration` with the available token, and the repository has no rulesets
(`[]`). The workflow runs and fails correctly; nothing in the repository can
make a failure block a merge. That is an owner action in repository
settings.

---

## 7. Remaining risks and deferred work

**`src/app.ts` is still 6,188 lines, 97 routes inline.** Billing, claims,
inventory, laboratory, radiology, tariffs, DHA and reporting have not moved.

**`src/db/schema.ts` (5,910) and `src/db/queries.ts` (4,303) are untouched.**

**32 legacy suites still assert on source text.** Four more had to be
repointed during this work (`maternity.test.ts`, `postnatal-immunisation.test.ts`,
`opd-journey.test.ts`, `tariff-matching.test.ts`, plus `inpatient-domain.test.ts`,
`nursing-contracts.test.ts`, `ward-billing.test.ts`). Each was updated where
the code actually went, with assertion counts unchanged or higher — none was
deleted or loosened. But this fragility is the reason migration to Vitest
matters, and it is unfinished. Two of them would have gone _quietly vacuous_
if left alone (an absent route yields an empty slice that passes every
`includes`); both now have guards.

**Coverage is ~12% of measured files and excludes components.** Thresholds
are a ratchet at that level. They are enforced (verified), but they are low.

**`local-backups/` still exists on disk**, untracked and ignored. It is no
longer in git.

**Committed `pg_dump` archives remain in git history.** Documented in
`docs/security/DATA-EXPOSURE.md` during earlier work; purging requires owner
authorisation and a history rewrite, which is out of scope here.

**No PostgreSQL in this environment.** All database claims in this report
are CI evidence; none was produced locally.

**DHA integration is mock-only** (`DHA_MODE=mock`), unchanged.

---

## 8. Next highest-impact work

1. **Split `schema.ts` by domain** (`drizzle` table groups re-exported from an
   index). It is the largest file and everything imports from it, so it is the
   last thing gating further route extraction.
2. **Migrate the legacy suites to Vitest, converting source-text assertions to
   behavioural ones.** This is the only path to meaningful coverage. The
   router specs added here are the pattern: assert what the server does, not
   what a file says.
3. **Move billing and claims out of `app.ts` next.** These are where a silent
   mistake costs money, and the route-inventory method is proven for exactly
   that risk.
4. **Raise per-module coverage thresholds as suites migrate** — not the global
   number, which is diluted by untested surface.
5. **Set branch protection / required status checks.** The gates work; they
   are not yet enforced at merge.

---

## 9. Postscript: what shipped after this report, and where it landed

This report was written when the branch held fifteen commits. It was merged
into `main` as PR #16 (`480c71f`) with twenty. The difference, recorded here
so the sections above are read as the point-in-time snapshot they are:

1. **All 34 legacy suites moved to Vitest.** `npm test` is now
   `vitest run --coverage` and nothing else runs tests. 829 tests pass, 14
   skip; coverage 19.86 statements / 16.88 branches → **19.86 / 17.18 / 20.89
   / 19.67**, and the global thresholds were raised from 11.4/11.2/8.7/7.3 to
   19.0/19.1/19.3/16.6. See `MIGRATION.md` for the three conversion defects
   this surfaced.
2. **`src/app.ts` is 3,370 lines**, not the 6,188 quoted in §7 — maternity,
   immunisation, inpatient care and the platform validators were extracted
   after this report, and billing, claims, inventory, laboratory, radiology,
   tariffs, DHA and reporting are listed there as still to do.
3. **All 47 counties**, with a sub-county that must match its county, plus
   the data migration for records already stored. See
   `docs/architecture/county-subcounty.md`.
4. **Two CI defects fixed, both of which had been making the gate lie.**
   The `database` job ran `vitest --coverage` over one directory and was then
   measured against whole-suite thresholds, so it failed on arithmetic while
   every test in it passed; thresholds now belong to the `unit` job alone.
   The new county migration spec sat outside every CI job and would have
   skipped silently in each, so it has its own step.
5. **A Daraja passkey was removed from the client bundle.** It was a
   published Safaricom sandbox value, not a live credential, but a passkey was
   being shipped to every browser for a panel with no integration behind it.
   GitGuardian flagged it on #16 because a formatting commit reflowed the line
   onto its own — the finding was real in the history it scanned, and HEAD is
   now clean.

§8 item 5 is still true and still the highest-value five minutes available:
the checks work, and nothing yet makes a failure block a merge.
