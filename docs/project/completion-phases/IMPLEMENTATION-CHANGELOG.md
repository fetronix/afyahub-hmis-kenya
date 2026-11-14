# Implementation Changelog

Reverse chronological. One entry per batch. Exact files, tests, results, and
anything that had to be discovered by running the software rather than reading it.

---

## Batch 12 — Deployment readiness: the guide checked against the code (2026-10-27)

Batch 12 did not try to prove a deployment. There is no Docker daemon in this
environment (`docker info` fails), no hosted account and no facility, so
"deployed" is not a claim this batch can make. What it could do is take the
deployment documentation that operators actually follow and check every claim in
it against the software, then fix what was wrong.

### Found: `DEFAULT_TIMEZONE` was decorative

`docs/deployment/truehost-cpanel.md` §5 tells the operator to set
`DEFAULT_TIMEZONE=Africa/Nairobi`, and `src/config/timezone.ts` did not exist.
Nothing in `src/`, `scripts/` or `server.ts` read the variable outside tests.
An operator could set `Pacific/Auckland` and every timestamp would still print
in the host's zone — which on a shared cPanel account is usually UTC, three hours
off the clock on the wall. The setting looked configured and did nothing.

Fixed rather than documented away: `applyDefaultTimezone()` validates the value
with the same `Intl` parser that formats dates and writes it to `process.env.TZ`
at startup, which is the variable Node actually honours. `DEFAULT_TIMEZONE` wins
over `TZ` when both are set. An invalid name is rejected with a warning naming
the value and the host zone is kept — a display setting must not stop a hospital
from starting. 8 tests.

Several findings came out of that one, which is the point of the guard below:

- `+03:00` is a **valid** zone to `Intl`. A hand-written `Region/City` pattern
  would have rejected correct configuration, so validation is "does the
  formatter accept it", nothing more.
- `DEFAULT_TIMEZONE` is now covered by a test that fails if it stops being read
  (`deployment-env-contract.spec.ts`, mutation-checked: renaming the constant in
  `timezone.ts` makes it fail with `documented but read by nothing`).

### Found: a production install carried the whole browser toolchain

`react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` and
`lucide-react` sat in `dependencies`. cPanel runs `npm install --production`, so
every shared-hosting account got the bundler on disk — the disk and inode
pressure §2 and §12 of the same guide warn about, while §3 claimed "`esbuild` is
a devDependency, so it is not installed in production mode", which was false
because Vite depends on it.

Moved to `devDependencies`; lockfile regenerated. Measured, not assumed:

| Install             | Packages |
| ------------------- | -------- |
| `npm ci` (full)     | 517      |
| `npm ci --omit=dev` | **166**  |

Proven by running it: with only the 166 production packages installed,
`import('vite')` fails with `ERR_MODULE_NOT_FOUND` (so the tree is genuinely
absent), and `NODE_ENV=production node build/server.js` boots, `/api/health`
returns 200, `/api/ready` returns 200 with `{"database":{"status":"up"}}`, and
`SIGTERM` shuts down cleanly. Full `npm ci` restored afterwards.

The honest consequence: `build/server.js` is production-only. Started without
`NODE_ENV=production` it reaches the Vite branch and now fails with an
explanation naming the fix instead of `Cannot find package 'vite'`.

### Added: `npm run deploy:verify`

The §13 checklist, as a command. `scripts/deploy-artifacts.mjs` reads the folder
about to be uploaded and refuses when a bundle or `dist/index.html` is missing
or empty, when `build/server.js` still imports `./src/` (a TypeScript-era shim),
when `npm start` does not point at `build/server.js`, or when `drizzle/` and
`drizzle/meta/_journal.json` disagree in either direction. It writes nothing and
connects to nothing. 11 tests, one per defect, plus one that fails if
`build-server.mjs` grows an entry point the checker does not cover.

Run against this repository after `npm run build:deploy`: every artifact
present, `88 migrations match the journal exactly`, no warnings.

### Fixed: a test suite that depended on who ran it

`docker-bootstrap.spec.ts` passed the repository itself as the bootstrap root,
so the stale-build guard in `scripts/test-docker.mjs` fired as soon as
`npm run build:server` had ever been run in that checkout — ten orchestration
tests failed for a reason unrelated to orchestration. The orchestration tests now
use a controlled fixture checkout, and the stale-build refusal — which had **no
test at all** — has one, including the property that the refusal does not delete
the artifact it is protecting.

### Not claimed

No image was built, no container ran, no host was touched. `Dockerfile` and
`docker-compose.yml` exist and their `HEALTHCHECK` points at `/api/ready`, but
their correctness is unverified here.

---

## Batch 10 — Multi-tenancy and the permission catalogue (2026-10-27)

Batch 10's claim is narrow and testable: a user who holds **every** permission
for their own tenant and facility still cannot read, write or infer another
tenant's or another facility's data over HTTP.

### The sweep

`src/tests/integration/tenancy-http-sweep.db.spec.ts` — 9 tests — starts the
real Express app, creates two tenants with two facilities each, grants a user
every permission code the seed file defines, and then attacks the boundary:
patients, encounters, claims and claim items, payments, HR status, and the audit
log. Assertions are on HTTP status **and** on the database afterwards: a refused
`PUT` must leave the row unchanged, a refused `POST /submit` must leave the claim
in `Draft`, and a list scoped to the caller's facility must return `[]` rather
than another site's records. 9/9.

Two fixture-level defects were found and fixed in the test, both of which would
have produced a green test that proved nothing:

- the `permissions` table on a fresh cluster is **empty** — the seed runs
  separately — so "grant every permission" granted nothing and six tests failed
  with `403` for a reason unrelated to tenancy. Codes are now read from
  `src/seeds/permissions.ts`, the same source the seeder uses;
- the facility-module gate runs **before** the tenancy check, so a facility
  without the `audit` module answers `403 FACILITY_MODULE_DISABLED` to its own
  tenants too. The audit assertion now names that code and the fixture enables
  the module, instead of reading a `403` as proof of isolation.

### The catalogue

`src/tests/vitest/permission-catalogue-integrity.spec.ts` — 4 tests — scans
`src/routes` for every `requirePermission(...)`/`requireAnyPermission(...)` call
and fails when a code it demands is not in the catalogue. That found one:
**`radiology.read`** was demanded by two shared catalogue endpoints and seeded
nowhere, so no role could ever be granted it. Added to `src/seeds/permissions.ts`
ahead of the pharmacy block.

Making the scan honest took two passes. A first regex missed
`requireAnyPermission(...CAN_READ)`, where the codes live in a file-local
constant; the scanner now resolves those arrays, which is what
`src/routes/approval-policy.routes.ts` uses. 4/4.

### What this batch does not claim

Isolation is proven for the resources the sweep exercises, not for every table in
the schema. A static scan of `.where({ id })` queries remains noisy and is
deliberately not used as evidence; the HTTP sweep is.

---

## Batch 11 — Monitoring and operations: what an operator can actually see (2026-10-27)

### `GET /api/ops/status`

New service (`src/operations/operations-status.service.ts`) and route
(`src/routes/operations.routes.ts`), mounted at `/api/ops` **after**
`requireAuth` in `src/routes/index.ts` and gated by `audit.read`. It returns
counts and ages only:

- `claimDispatchReviews` — claims held by a dispatch reservation, by state, plus
  the oldest age in minutes and a next action;
- `unbilledCharges` — `billing_charge_attempts.status='PENDING'`;
- `refundRequestsAwaitingDecision` — `billing_refund_requests.status='REQUESTED'`;
- `integration` — diagnostics in a 24-hour window, by operation and outcome, with
  a failure count limited to a named list of failure outcomes. An outcome that
  is neither success nor failure is counted as neither, because
  `PAYER_TRANSMISSION_NOT_VERIFIED` is not a failure and calling it one would
  send an operator hunting a network fault that does not exist;
- `schema` — journal entries versus `drizzle.__drizzle_migrations` rows.

No patient name, MRN, amount or free-text field appears in the payload, and a
test asserts it against the projection rather than the prose. No threshold is
invented: nothing is labelled "critical" on the strength of an age this project
made up.

7 tests against a synthetic PostgreSQL cluster. The first run failed at fixture
setup, twice, both times correctly: `insurance_claim_dispatch_guards` refuses a
claim id that has no matching `sha_eclaims` row (the scope trigger added in
`0040`), and `billing_refund_requests` refuses any initial status but
`REQUESTED`. The fixtures were corrected to satisfy the domain rules rather than
to bypass them.

### `docs/deployment/operations-runbook.md`

Says what is implemented and what is not, in a table an operator can read at
03:00: liveness versus readiness (and why liveness must not touch the database),
what each queue means and how it is cleared, the dispatch-review procedure for an
unknown payer outcome, a symptom→first-check table, and an explicit list of what
does **not** exist — no alerting, no log shipping, no metrics endpoint. Anything
requiring action on the real host is marked **HOST ACTION** rather than assumed.

8 tests pin the document to the code (`operations-surface.spec.ts`): health does
not query the database, readiness does and answers 503, `/api/ops` is not on the
public router, the shutdown handles the signals a supervisor sends, the
Dockerfile HEALTHCHECK points at readiness rather than liveness, and the runbook
still contains the sentences that admit what is missing.

### Not claimed

Nothing pages anyone. Nothing ships logs. No metrics endpoint exists. The
counters are only as current as the last person who looked at them.

---

## Batch 9 — External integrations: what they actually do (2026-10-27)

**Verified by execution**

The integration cluster was rebuilt from an empty cluster (88 migrations, then
`db:status` READY) and re-run before any change: `dha-boundaries`,
`payment-hub`, `payment-hub.db`, `sha-eclaims`, `sha-eclaims.db` and
`phase3-sha-benefits-scope.db` — 6 files, 110 tests, all passing. Only after that
was the transport code read line by line.

No provider credentials exist in this environment, and none were invented.
Nothing in this batch claims a payer received, adjudicated or paid anything.

**Found: an uncertain dispatch was a one-way door**

`reserveClaimDispatch` writes a durable guard row _before_ the external call.
When a response is lost, `markClaimDispatchUncertain` sets the guard to
`UNCERTAIN`, and from that point `lockMutableClaim` throws
`CLAIM_DISPATCH_REVIEW_REQUIRED` (409) for every submit, resubmit, status
refresh, adjudication and remittance action on that claim — forever.

That refusal is correct. What was missing was any way out of it: grep found no
service, route, permission or UI that read or resolved a guard. The error text
said "review the payer record", and the private claim screen said "contact an
authorized administrator", while neither had anything to review with. A single
lost HTTP response permanently bricked the claim.

**Fixed, end to end**

- `drizzle/0087_claim_dispatch_reconciliation.sql`: new append-only
  `insurance_claim_dispatch_reconciliations` table (tenant, facility, workflow,
  claim, guard id, correlation id, attempt, guard state at check, outcome, payer
  reference, evidence note, reviewer, timestamp). Constraints require a
  3+ character payer reference when receipt is confirmed and a 10+ character
  evidence note always. Index on `(tenant, facility, workflow, claim_id)` and on
  the guard table's `(tenant, facility, workflow, state)` so the queue is not a
  sequential scan.
- `src/db/schema/claim-dispatch.ts`: the new table plus the guard state index.
- `src/insurance/claims/claim-dispatch-reconciliation.service.ts` (new):
  `listBlockedClaimDispatches`, `recordClaimDispatchReconciliation`,
  `listClaimDispatchReconciliations`. Three outcomes only:
  `PAYER_CONFIRMED_RECEIVED` (needs the payer-side reference; marks the claim
  ACKNOWLEDGED with that reference), `PAYER_CONFIRMED_NOT_RECEIVED` (status
  unchanged, release so a human may dispatch again) and `STILL_UNRESOLVED`
  (records the check and keeps the block). The evidence row is written in the
  same transaction that releases the guard, and the guard is deleted, never
  duplicated — the unique `(workflow, claim_id)` index stays intact.
- Refuses to revert: a "not received" finding against a claim the local record
  already shows as submitted returns `DISPATCH_STATE_CONFLICT` (409) instead of
  silently reopening it. Every record bumps `dispatch_revision` so a stale screen
  cannot act on the pre-review snapshot, and raises `submission_count` to the
  reserved attempt so the next attempt number is not reused.
- `src/routes/sha-eclaims.routes.ts` and `src/routes/private-insurance.routes.ts`:
  `GET /claims/dispatch-reviews` (queue), `GET /claims/:id/dispatch-reviews`
  (permanent history), `POST /claims/:id/dispatch-review` (record a finding).
  SHA requires claims read plus `insurance.sha.reconciliation.manage`; private
  requires `insurance.private.claims.submit`. Both are tenant- and
  facility-scoped, and a stale `guardId` returns `CLAIM_CHANGED`.
- `src/insurance/hub/guards.ts`: dispatch review is declared a local, audited
  records operation. It sends nothing to a payer, so it remains usable even after
  a payer contract or configuration is withdrawn — otherwise a claim stranded by
  a lost response could never be resolved. Facility scope, module, RBAC and
  patient-read permission are still enforced.
- `DispatchReviewPanel.tsx` / `DispatchReviewQueue.tsx` (new): the queue lists
  blocked claims for the facility; the panel requires an explicit outcome, a
  payer reference for receipt, and an evidence note. It states that the
  reservation is local and is not payer acceptance, adjudication or payment, and
  a user without reconciliation authority gets no way to clear the block. Wired
  into the SHA eClaims tracking screen and the private claim tracking screen.
- `dispatch-review.types.ts`, both API clients, and the claim detail payloads
  now carry guard id/attempt/correlation.

**Tests**

`claim-dispatch-reconciliation.db.spec.ts` (11, live HTTP + SQL): queue scoped to
the actor's facility; evidence and payer-reference refusals; an unresolved review
recorded while the claim stays blocked at `lockMutableClaim`; stale guard
reference rejected; confirmed receipt releases the guard, marks the claim
ACKNOWLEDGED with the payer reference, keeps the history after the guard is gone,
writes both audit actions and cannot be replayed into a second guard; confirmed
non-receipt releases a pre-dispatch claim without changing its status, and the
same gate then passes; a "not received" finding cannot revert an already
acknowledged claim; a reviewer without the permission is refused (403); a review
is scoped to the actor's facility (404); the private path releases without
changing `READY`.
`claim-dispatch-review-ui.spec.tsx` (10): no panel without a reservation; local
not-acceptance wording; no action without authority; outcome and note required;
payer reference required for receipt; unresolved check reported as still blocked;
receipt recorded with reference and refresh; API rejection surfaced as an error;
queue lists and opens blocked claims; empty queue offers no action.

**Integration reality (read, executed where possible — no new provider claims)**

| Surface                | What the code actually does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DHA / AfyaConnect      | `mock` / `sandbox` / `production` modes. Production additionally requires `DHA_ALLOW_PRODUCTION=true` **and** a base URL DHA never published in this repository, so it cannot silently run live. `dha.readiness.ts` lists only the operations this build implements (auth, eligibility, coverage/benefit reads, patient search, consent, visit start, claim lines/diagnoses, preauth submit, remittance read) and names the rest as not implemented. `describeDhaConfig()` reports credentials as configured/missing only. |
| SHA eClaims gateway    | Defaults to `mock`; mock responses are labelled `SANDBOX_SIMULATION` with `isSimulated`. Real transport throws/returns 503 `PAYER_TRANSMISSION_NOT_VERIFIED` until a verified adapter is injected. Production needs `SHA_ALLOW_PRODUCTION=true` plus explicit HTTPS endpoints.                                                                                                                                                                                                                                             |
| Private payer adapters | Britam, PACIS, CIC and Jubilee direct adapters are registered but every capability reports `supportedByContract: false` and probes return `AWAITING_DOCUMENTATION`; operations return `supported: false` with the missing onboarding list. SmartLink gateway and the manual/file adapter exist; `sha_afyalink` bridges to the SHA workspace. No direct adapter fabricates a dispatch.                                                                                                                                      |
| Payment hub / M-Pesa   | Secrets are AES-256-GCM with a versioned key id bound in the AAD; rotation refuses without an active key version and the legacy `privateDigest` key must not rotate. The M-Pesa callback endpoint rejects every delivery with 503 `CALLBACK_VERIFICATION_UNAVAILABLE` rather than pretend to verify a signature.                                                                                                                                                                                                           |
| Professional registry  | Registry lookup is distinct from licence confirmation; unreachable service is `SERVICE_UNAVAILABLE` and never overwrites a prior good result; mock results cannot issue an invitation for a clinical role.                                                                                                                                                                                                                                                                                                                 |

**Results.** `tsc --noEmit` 0; eslint 0 errors (and no new warnings) on changed
files; prettier clean; `vite build` succeeded; full suite **278 files / 2610
tests, 0 failed, 0 skipped** (up from 276/2589); migrations **88** applied,
journal 0000–0087.

**Reported, not fixed.** Provider sandbox credentials and facility UAT remain
absent, so no live eligibility, claim or remittance transmission is exercised or
claimed. M-Pesa callbacks cannot be accepted until signature verification is
specified. Bank partial/one-to-many matching and its UI remain open. MOH 705
stays 501 with no KHIS/DHIS2 adapter.

---

## Batch 8 — Reporting, MOH, KHIS/DHIS2 (2026-10-27)

**Verified by execution**

The report centre was run before anything changed: operational, ledger,
diagnoses and selector suites plus the export and UI specs — 8 files, 61 tests,
all passing. The surveillance endpoints were run too, then the code was read.

**Found: a wrong notifiable-disease count could not be corrected**

`public_health_reports` was insert-only. Entering 40 cholera cases instead of 4
left two options: leave a wrong figure, or record a second report — and both rows
then counted towards the facility's own total. A correction doubled the week, and
an inflated count in a surveillance table reads as an outbreak.

Secondary finding: an engine registered without a query plan returned a generic
internal error, which reads like the whole report centre failed rather than one
report being unavailable.

**Fixed, end to end**

- `drizzle/0086_public_health_report_corrections.sql`: `supersedes_report_id`
  self-reference, no-self-supersede constraint, and indexes on the facility/week/
  disease/age-group tuple. Deliberately no unique index — duplicates may already
  exist and must be reported, not blocked.
- `src/db/schema/public-health.ts`: the new column.
- `src/public-health/surveillance.service.ts` (new): `recordReportScoped`,
  `correctReportScoped`, `weeklySurveillanceSummaryScoped`, and the shared
  validators. Corrections supersede; the original row survives as `SUPERSEDED`.
- `src/routes/domains/public-health.routes.ts`: the existing POST now goes through
  the service; new `POST /api/public-health/reports/:id/correction` and
  `GET /api/public-health/reports/summary`. Published error codes
  (`INVALID_REPORT_FIELDS`, `INVALID_REPORT_COUNTS`) are preserved so existing
  clients keep matching.
- `PublicHealthModule.tsx`: headline totals exclude replaced rows (they would
  otherwise double), replaced rows render struck through with the replacing id, a
  correction form requires a reason, and the weekly tally shows disputed groups
  with their review notes.
- `platform.client.ts` / `types/index.ts`: correction and summary calls and types.
- `report-centre.service.ts`: `queryPlan` exported; a missing plan now raises
  `REPORT_UNAVAILABLE` (501) instead of a bare `Error`.
- `report-catalogue-integrity.spec.ts` (new, 5): catalogue↔engine bidirectional
  reachability, dependencies stated for every unavailable report, unique ids, and
  a scoped plan for every engine.

**Tests**

`public-health-corrections.db.spec.ts` (5, live HTTP + SQL): duplicate warning at
entry and a disputed tally; correction supersedes with the original retained and
audited; refusals for no-change, already-superseded, week moves, readers and
anonymous callers; no cross-facility totals and ISO-week validation; an empty week
reported as not-ready rather than zero cases.
`public-health-corrections-ui.spec.tsx` (5): replaced rows excluded from totals,
disputed weeks not shown as ready, correction posted to the correction endpoint
(never the recording one), no correction offered on a replaced row, empty week not
rendered as zero.

**Results.** `tsc --noEmit` 0; eslint 0 errors on changed files; prettier clean;
`vite build` succeeded; full suite **276 files / 2589 tests, 0 failed, 0 skipped**
(up from 273/2574); migrations 87 applied, journal 0000–0086.

**Reported, not fixed.** MOH 705 remains 501 and no KHIS/DHIS2 adapter exists.
Both are blocked on authoritative external specifications, and inventing a
statutory return format would be fabrication. The weekly tally is a facility-local
sum of staff-entered counts and says so in its own payload.

---

## Batch 7 — Billing and accounting end to end (2026-10-27)

**Verified by execution**

The existing billed cluster was run before anything changed:
`phase3-financial-journeys`, `billing-posting`, `facility-owned-billing`,
`finalized-invoices`, `invoice-payment-acceptance`, `invoice-void-validation`,
`master-tariffs-workflow` and `billing-charge-concurrency` — 7 files, 99 tests,
all passing. Invoices, receipts, refunds, voids, journals, reversals, period
close, expenses, bank reconciliation approval and the trial balance were then
read and exercised.

**Found: nothing tied the billing subledger to the general ledger**

Two endpoints already admitted it in their own payloads —
`getAccountingOverviewScoped` returned `billingReconciliation:
'NOT_IMPLEMENTED'` and `inspectBillingConsistencyScoped` returned
`ledgerReconciliation: 'NOT_IMPLEMENTED'`. A facility could finalize invoices and
record receipts without posting them and the ledger would still balance, with no
report naming the missing revenue or stating the difference.

**Fixed, end to end**

- `src/accounting/billing-gl-reconciliation.service.ts` (new):
  `reconcileBillingLedgerScoped` — read-only, one `REPEATABLE READ READ ONLY`
  snapshot, as-of date required. Recomputes the expected effect of every
  reviewed bridge row from the row's own classification and the invoice's
  finalized responsibility split, compares it against the actual journal lines
  per account, and separately compares each control account's posted balance
  with what the billing tables say is owed, received and recognized.
- Five independent controls (`PATIENT_RECEIVABLE`, `INSURER_RECEIVABLE`,
  `REVENUE`, `SETTLEMENT`, `CREDIT_LIABILITY`) with statuses `TIED`,
  `POSTING_BACKLOG` (difference exactly equals the unposted invoices, receipts
  and refunds, which are listed), `NOT_CONFIGURED`, `UNEXPLAINED`.
- Exceptions: unposted invoices with their patient/insurer split, unposted
  receipts with party, unposted refunds, and journals touching a control account
  with no bridge row, each with its debit magnitude and account ids. A journal
  that has been fully reversed drops out, so a clean tie-out has an empty list.
- `GET /api/accounting/billing-gl-reconciliation` requiring **both**
  `accounting.read` and `billing.read`; missing, malformed or inverted dates
  return 400.
- `billingGlReconciliation` in `src/api/client-sprint.client.ts` and a read-only
  tie-out panel in `AccountingModule.tsx` that shows every control and states
  that finance review is required when anything is unexplained.
- The two `NOT_IMPLEMENTED` notices now point at the new report instead of
  implying the comparison does not exist. The flags themselves were left alone
  because those reports still do not reconcile billing into themselves.

**Tests**

`billing-gl-reconciliation.db.spec.ts` (7, live HTTP + direct SQL assertions):
tie after invoice and two receipts including an overpayment credit; unposted
invoice reported as explained backlog rather than a false tie; manual
receivable/revenue journal detected as unexplained and cleared by a controlled
reversal; invoice reversed but left active reported as a revenue and receivable
leak and tied after the void; unconfigured facility reported honestly; permission
and date validation; per-facility scoping across two facilities.
`billing-gl-reconciliation-ui.spec.tsx` (3): panel hidden without `billing.read`,
every reported difference rendered, API failure surfaced without stale figures.

**Results.** `tsc --noEmit` 0; eslint 0 errors on changed files; prettier clean;
full suite **273 files / 2574 tests, 0 failed, 0 skipped** (up from 271/2564).

**Reported, not fixed.** Line-level `BILLING_ITEM` journals, opening balances,
bank statements and insurer settlement are outside this tie-out and are named as
such in its own `limitations`. The tie-out proves arithmetic agreement between
three sources; it does not prove a payer paid.

---

## Batch 6 — Clinical workflows (2026-10-27)

**Verified by execution**

78 integration specs and the clinical Vitest suites were run, not merely read:
laboratory accessioning/collection/verification, pharmacy FEFO dispensing with
partial fills and stock locking, radiology, inpatient bed billing, maternity and
immunisation rules, theatre scheduling, and the portal isolation tests.

**Found and fixed: dialysis sessions never reached the ledger**

A completed session was marked `UNBILLED` and no code path billed it — revenue
lost silently, with no charge-attempt row to recover it from.

- `drizzle/0084_dialysis_session_billing.sql`: `facility_service_id` on
  treatment plans, and a partial unique index preventing two billing lines for
  one session.
- `drizzle/0085_dialysis_service_category.sql`: adds `DIALYSIS` to the closed
  facility service category list (a session could previously only be priced by
  mislabelling it a procedure).
- `DIALYSIS` billing family: code candidates, department mapping, type union.
- Resolver case: completed-only, scoped to tenant/facility/patient, requires the
  plan's facility service, prices through the existing tariff machinery.
- `billDialysisSessionScoped`: one charge per completed session, `BILLED` only
  when a charge actually happened, audited either way, refuses a second attempt.
- `POST /api/dialysis/sessions/:id/bill` gated by `billing.create`, deliberately
  separate from `dialysis.sessions.record`.
- UI billing form on the dialysis screen; client method.
- Tests: `client-dialysis.db.spec.ts` 5 → 7 (charge once, retry refused, cross
  facility refused, wrong session number refused), `dialysis-billing-ui.spec.tsx`
  (3: permission gate, correct endpoint, no re-completion).

**Reported, not fixed**

The remaining clinical modules were exercised through their existing suites.
That is coverage, not a fresh line-by-line audit, and it is not a facility UAT.

## Batch 5 — HR, payroll, procurement and statutory forms (2026-10-27)

**Verified, not rebuilt**

The existing HR/payroll and procurement modules were exercised rather than
rewritten: 143 payroll/HR tests and 56 procurement tests pass against the
synthetic database. Payroll already refuses to calculate without an
effective-dated statutory version per statute, enforces approver segregation in
a database constraint, and posts one balanced journal per run.

**Added**

- `drizzle/0083_payroll_form_profiles.sql`: form code, form version, mandatory
  authority citation, effective range, active flag.
- `createFormProfile` / `listFormProfiles` — recording which published P9/P10
  version a facility produces, audited, refusing a citation under 8 characters.
- `statutoryFormExtract` — per-employee and total figures for a tax year from
  **posted** payroll only, carrying the form version and citation, and refusing
  with `FORM_PROFILE_REQUIRED` when nothing covers the year.
- Three routes under `/api/payroll`.
- Four tests appended to `workforce-payroll.db.spec.ts` (13 total in that file).

**Not done, deliberately**

- No P9/P10 layout is hard-coded, and no claim is made that the extract matches
  the authority's form. The response states this in its own `notice`.
- No statutory rate was added. The rates remain facility data with citations.

## Batch 4 — Fixed asset accounting (2026-10-27)

**Added**

- `drizzle/0082_fixed_asset_impairment_revaluation_tax.sql`: `carrying_basis_kes`,
  cumulative impairment and revaluation figures, two account references, a
  non-negative-basis check, and the `fixed_asset_tax_rates` table.
- `impairAsset` — write-down to recoverable amount with a balanced journal, a
  movement row, and an audit entry. Refuses an amount that would take the asset
  below zero, a disposed asset, and a closed period (via the poster).
- `revalueAsset` — increase to surplus, decrease against the asset's own surplus
  first and to profit or loss only beyond it; refuses the excess without a loss
  account, refuses a no-change revaluation.
- `createTaxRate` / `listTaxRates` / `taxDepreciationSchedule` — tax allowances
  computed strictly from facility-configured rates, each of which must cite an
  authority. Assets with no configured rate are reported as such.
- Register report and overview now expose impairment and revaluation totals.
- Four routes: `POST /:id/impair`, `POST /:id/revalue`, `GET|POST /tax/rates`,
  `GET /tax/schedule`.
- UI: Impair / Revalue dialogs on the asset drawer, two new register report
  columns, and a tax allowance panel with a rate form that cannot be saved
  without a citation.
- Tests: `fixed-asset-impairment.db.spec.ts` (8) and `fixed-assets-ui.spec.tsx` (6).

**Changed**

- Depreciation preview and run now compute from `carrying_basis_kes` when it is
  set, so an impairment or revaluation changes future charges without rewriting
  recorded cost.
- `schema-contract.ts` and `schema-extraction.spec.ts` extended for the reviewed
  schema additions; the drift guards still fail on anything unreviewed.

**Not done, deliberately**

- No Kenyan tax rate, allowance class or balancing charge is implemented. The
  rates must be entered by the facility against a citation.
- Revaluation does not re-estimate useful life or revalue an entire class in one
  action.

## Batch 3 — Bank reconciliation (2026-10-27)

**Added**

- `drizzle/0081_bank_reconciliation_approval.sql`: preparer/approver separation
  (`approved_by_user_id`, `approved_at`, `approval_notes`) and a partial unique
  index making a posted journal line matchable only once per bank account.
- `suggestMatchesForTransactionScoped` — candidate matches with confidence and
  human-readable reasons. Scores the statement reference against both the
  journal number and the description, because clerk-raised references live in
  the latter. Never writes; suggestions are advice.
- `investigateUnmatchedScoped` — for each unmatched line, an explanation of the
  most likely cause, plus ledger entries one-sided at that date which may be the
  counterpart of a timing difference.
- `unmatchBankTransactionScoped` — reverses a wrong match, audits the reversal,
  leaves the journal untouched, and refuses when a covering reconciliation has
  been approved.
- `approveBankReconciliationScoped` — second-person sign-off. Refuses
  self-approval, double approval, a closed financial period, and any worksheet
  with a non-zero difference or a remaining unmatched statement line. Stamps
  the account's `last_reconciled_at`.
- `bankReconciliationReportScoped` — account position, counts, and the named gap.
- `postBankStatementAdjustmentScoped` — posts bank charges, interest and errors
  as a **new** journal through the existing `postJournalScoped`, so balance
  validation, period locking, idempotency and double entry are not
  re-implemented. Refuses once the statement's reconciliation is approved.
- Five routes under `/accounting/bank/...`.
- `src/tests/vitest/bank-reconciliation.db.spec.ts` — 12 tests.

**Changed**

- Match candidate queries select `journal_number` as the reference and cast
  `entry_date` to text; the driver's timestamp objects produced `NaN` in the
  day-difference score.

**Not done, deliberately**

- Partial / many-to-one matching. Requires a junction table; forcing it would
  break the single-line invariant the worksheet and the new unique index rely on.
- Reconciliation screens — no bank UI existed in the app to extend.

## Batch 2 — Backup, restore and disaster recovery

**Date:** 2026-10-27 · **Status:** implemented, tested, drill passed

### Files created

| File                                                | Purpose                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `scripts/backup/backup-lib.mjs`                     | archive format, AES-256-GCM, checksums, manifest, retention, directory resolution                   |
| `scripts/backup/engines.mjs`                        | `pg_dump` engine and driver-based logical engine; dump, restore, fingerprints, database create/drop |
| `scripts/backup/db-backup.mjs`                      | CLI: take a backup, write manifest, apply retention, read back and verify                           |
| `scripts/backup/db-verify.mjs`                      | CLI: prove an archive is intact                                                                     |
| `scripts/backup/db-restore.mjs`                     | CLI: restore into a named target, with refusal guards                                               |
| `scripts/backup/restore-drill.mjs`                  | CLI: backup → restore into a separate database → compare every table → drop                         |
| `src/tests/vitest/backup-lib.spec.ts`               | 16 unit tests, no database                                                                          |
| `src/tests/integration/backup-restore.db.spec.ts`   | 5 tests against real PostgreSQL                                                                     |
| `docs/project/operations/BACKUP-RESTORE-RUNBOOK.md` | operator procedure, refusals, DR scenarios                                                          |

### Files modified

- `package.json` — four scripts: `db:backup`, `db:backup:verify`, `db:restore`, `db:restore:drill`

### Defects found by running it, not by reading it

1. **Microsecond timestamps were being lost.** Temporal columns were read as
   JavaScript `Date` (millisecond precision) and written back, so every restored
   timestamp lost its last three digits. Row counts matched; only a content
   comparison exposed it. Fixed by reading temporal and interval types as text.
2. **`json` columns were corrupted.** The driver serialises a JS array as a
   PostgreSQL array literal (`{a,b}`), which is invalid in a `json` column.
   Fixed by serialising according to the declared column type.
3. **The audit log refused the restore.** `audit_logs` carries a `BEFORE TRUNCATE`
   guard. Rather than disable a security control to make the tool work, the
   restore now clears only non-empty tables and refuses an in-place restore with
   instructions. A refused restore is better than a silently weakened audit trail.

### Evidence

```
drill PASSED
  tables compared  230
  rows (source)    84
  rows (restored)  84
  duration         3295ms
```

Independent CLI restore into `jalicare_restore_cli` produced `tenants=2,
facilities=1`, matching the source exactly.

### Limitations recorded

`pg_dump` is not installed in this sandbox (server binaries only), so the
`pgdump` engine is exercised through its preflight and shared archive path but was
not drilled here. The `logical` engine is the one proved end-to-end. Production
must run `npm run db:restore:drill` on the real host before relying on backups.

---

## Batch 1 — Approval policy management

**Date:** 2026-10-27 · **Status:** preserved, re-verified, defects closed

### Work this session

- Re-verified from a rebuilt environment (dependencies restored, database
  re-initialised, 81 migrations applied): the router is mounted once, every route
  carries `requireAnyPermission`, both permission codes are seeded, the client is
  spread into `api`, and the settings panel renders.
- **Added** `src/tests/vitest/approval-policy-routes.spec.ts` — proves each route is
  registered exactly once, that a permission guard is the first handler on every
  route, and that the domain router mounts the approval router once and nothing
  else claims those paths. Mutation-checked: commenting out the mount makes it
  fail; `src/routes/index.ts` was restored byte-identically.
- **Added** two HTTP-level checks to `approval-policy.db.spec.ts`: the management
  path answers an authorisation code rather than `NOT_FOUND`, and the retired
  `/api/master-tariffs` still answers 404.
- **Fixed a real gap in the repository's own client guard.**
  `src/tests/vitest/api-domain-clients.spec.ts` asserts that every domain client's
  methods appear on `api` with no name collisions, but the new
  `approvalPolicyClient` was not in its list — so the guard silently stopped
  measuring what its name claims (it failed 314 vs 310 instead). The client is now
  covered, which is what makes the prefixed method names meaningful.

### Earlier in the batch (carried, re-verified)

Two defects fixed at source: the router's ALL-of guard became any-of (no seeded
role held both required codes, so every real account would have been refused), and
a policy refusal that reached callers as HTTP 500 now returns 403
`APPROVAL_AUTHORITY_REQUIRED` naming the rule.

---

## Regression checkpoints

| When             | Scope                                              | Result                                         |
| ---------------- | -------------------------------------------------- | ---------------------------------------------- |
| After Batch 1    | focused: routes, API, UI, procurement, permissions | 98 passed                                      |
| After Batch 2    | focused: backup, Batch 1, procurement, permissions | 119 passed                                     |
| Final acceptance | **full suite**                                     | **267 files, 2529 tests, 0 failed, 0 skipped** |

The first full-suite run failed two files, and both were investigated rather than
retried until green:

1. `api-domain-clients.spec.ts` — a genuine Batch 1 gap, fixed (above).
2. `report-centre-diagnoses.db.spec.ts` — not a code failure. It refuses to create
   fixtures unless `JALICARE_TEST_PG_SYSTEM_IDENTIFIER` matches the cluster's real
   system identifier, which is a deliberate guard against running destructive
   fixtures on a cluster nobody has vouched for. Supplied, and all 13 tests passed.
