# Phase 5 — final implementation report

**Status: Phase 5 implementation complete for the scope recorded below; Phase 5 is NOT closed.**
Several workflows are implemented and tested but facility UAT, supplier returns, three-way
tolerance, statutory returns and inventory-to-ledger posting remain outstanding, and the report
records them as incomplete rather than complete.

| Item                    | Value                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Branch                  | `arena/e088f11d-afyahub-hmis-kenya`                                                                                      |
| Verified published head | `d729178c4d4541af47201909b9c2c0c20218d38a` (`d729178`, "Add inventory stock control: ledger, adjustments, counts, transfers") |
| Phase 5 commits         | `f8a670a` workforce · `b036a86` fixed assets · `fff9bfb` UI/payslip · `070a0d4` procurement chain · `d729178` inventory control |
| Migrations              | 78 committed (`0000`–`0077`); `0077_inventory_control` is the last committed migration                                   |
| Verification environment| Embedded PostgreSQL 18.6 on `127.0.0.1:55432`, database `jalicare_synthetic_test`, all 78 migrations applied                |
| Report date             | 10 November 2026                                                                                                         |

Nothing in this report was produced with real patient, staff or financial data. Every database
used was synthetic and disposable.

---

## 1. Checkpoint verification

The sandbox restored a stale Git index: `HEAD` pointed at the branch base `0111b55` while the
working tree already held all Phase 5 work, so `git status` listed 587 modified/untracked paths.
That was an indexing artefact, not uncommitted work.

Verification performed, in this order:

1. `git ls-remote` showed the published head `d729178`. The local branch ref pointed elsewhere.
2. `git hash-object src/workforce/workforce.service.ts` = `d17c1b4…` matched
   `git rev-parse FETCH_HEAD:src/workforce/workforce.service.ts`, proving the file content was
   already the published content.
3. A scratch index (`GIT_INDEX_FILE=/tmp/…`, `git read-tree`, `git add -A`, `git write-tree`)
   compared the whole working tree against the published tree. Exactly **10 paths** differed —
   the in-progress approval-policy slice — and nothing else.
4. The branch ref and index were re-pointed to `d729178` with `git update-ref` + `git read-tree`.
   **No file was reset, checked out, stashed or discarded**, and no branch was switched.

After that: `git status` shows only the 10 deliberately uncommitted paths, and
`git rev-list --left-right --count HEAD...origin/…` returns `0 0`.

The 10 uncommitted paths are an approval-policy feature that was started before this closure
task. It is **not part of Phase 5**, is not mounted into the application, is not counted in any
result below, and was deliberately excluded from verification.

## 2. Migration inventory (Phase 5)

| Migration                  | Tables | Adds                                                                                    |
| -------------------------- | -----: | --------------------------------------------------------------------------------------- |
| `0074_workforce`           |     17 | HR employees, documents, departments, designations, shifts, rosters, attendance, leave types/requests/balances; payroll periods, runs, payslips, payslip lines, employee components, statutory versions/bands, ledger account settings |
| `0075_fixed_assets`        |      3 | Asset categories, maintenance records, transfers; register columns, custody, acquisition/disposal accounts |
| `0076_procurement_chain`   |      5 | Requisitions + items + events, goods received notes + items, supplier invoices (+ `goods_received_note_id`) |
| `0077_inventory_control`   |      5 | Append-only `inventory_movements`, stock counts + lines, transfers + items               |

Each migration is registered in `drizzle/meta/_journal.json`, applies to an empty database, and
reaches `db:status` **READY — every migration is applied and 0009 is intact**. `db:preflight`
reports READY WITH WARNINGS for one reason only: no `--backup` argument was supplied, which the
tool itself documents as acceptable on a local database and not on production.

## 3. Area-by-area acceptance

Legend: **complete and tested** (implementation + automated evidence, no known functional gap in
the stated scope) · **partial** (works, stated gaps remain) · **missing**.

| # | Area | Status | What is actually implemented | Evidence |
| - | ---- | ------ | ---------------------------- | -------- |
| 1 | HR and employee management | **Partial** | Employee register with facility scoping, documents, departments, designations, shifts, roster, attendance, leave types/requests with approval and balances; `hr.read/manage/approve` | 27 `/api/hr` routes; `workforce-payroll.db.spec.ts` (9); Chromium 24/24 |
| 2 | Payroll and salary processing | **Partial** | Effective-dated statutory versions and bands, component model, period → calculate → **independent approver** → post pipeline, payslip documents, balanced idempotent journal (`sourceType: 'PAYROLL'`), ledger-account mapping | Segregation enforced by `payroll.approve` + creator check; `sourceType 'PAYROLL'` at `workforce.service.ts:2293`; statutory rates are **not** shipped — a facility must record them |
| 3 | Procurement and purchasing | **Partial** | Suppliers, purchase orders + revision control + separate approval, requisitions (draft → submit → approve/reject → convert), GRNs with over-receipt cap and replay-safe stock posting, supplier invoices posting AP, supplier payments with idempotency and one journal each | `procurement-workflow.db.spec.ts` (11), `procurement-suppliers.db.spec.ts` (12), `procurement-migration.db.spec.ts` (1); journey 27/27; Chromium 13/13 |
| 4 | Inventory and stock management | **Partial** | Append-only movement ledger, reasoned adjustments (closed reason list, no negative stock), physical counts with variance posting, two-legged store transfers, reorder levels/alerts, valuation and batch reconciliation, FEFO draw-down, GRN → `current_stock` + RECEIPT movement | `route-inventory`, `inventory-selling-price-ui`, `inventory-receipt-cost.db`, `inventory-receipt-migration.db`; journey 33/33; Chromium 17/17; focused vitest 7 files / 79 tests |
| 5 | Fixed assets | **Partial** | Register, categories with accounts, capitalisation, straight-line depreciation preview/post, maintenance, transfers, custody/location, disposal posting, printable valuation report | `fixed-assets.db.spec.ts` (8); `sourceType: 'FIXED_ASSET'` at 4 posting sites; Chromium 18/18 |
| 6 | Administration and permissions | **Partial** | Facility profile, module provisioning, staff invitations, role/permission catalogue, per-facility RBAC editor, tariff management; every Phase 5 route permission-gated and facility-scoped server-side | `requirePermission` on all Phase 5 routers; `procurement-rbac.spec.ts`; isolation assertions in integration specs |
| 7 | Audit trails and financial controls | **Partial** | Audit rows written in-transaction for workforce (22 call sites), assets (9), requisitions (6), receiving (3), stock control (5); separation of duties on PO approval, requisition decision and payroll approval; period-open enforcement and unique `(facility, source_type, source_id)` postings | Code inspection + `journal-scope-integrity`, `billing-posting` specs; no end-user audit viewer change in this phase |
| 8 | Integration with existing HMIS modules | **Partial** | Procurement → inventory (GRN moves stock + ledger movement in one transaction) → accounting (invoice + payment journals); payroll → accounting; fixed assets → accounting; pharmacy dispensing → inventory movement. **Inventory → general ledger is not posted** (no facility-approved stock/expense accounts) | `receiving.service.ts` transaction; `postInsideTransaction` call sites; `procurement-workflow.db.spec.ts` asserts stock +4 and replay safety |

### Explicitly not claimed

- Nothing in Phase 5 is **Complete** by the project's own definition: facility UAT has not been
  performed, and the gaps in §4 are real.
- Payroll statutory rates are not shipped and no return (P9/P10, SHIF, NSSF, housing levy) is
  generated. The engine refuses to compute without a facility-configured, effective-dated version
  rather than inventing Kenyan rates.
- No payment is made to staff or suppliers through a provider; supplier payments are recorded
  ledger movements, not bank transactions.
- Inventory adjustments and count variances do **not** create journals.
- No claim is made that any provider, regulator or facility has accepted this implementation.

## 4. Outstanding defects and gaps (ordered)

| # | Severity | Area | Gap | Why it matters |
| - | -------- | ---- | --- | -------------- |
| 1 | High | Inventory → accounting | Stock adjustments, count variances and transfers post no journal | Inventory value in the ledger and on the shelf can diverge. Needs a facility-approved account policy before it can be built honestly. |
| 2 | High | Procurement | No supplier returns / credit notes | A rejected delivery cannot be reversed through the same chain; only manual adjustment exists. |
| 3 | High | Procurement | No three-way tolerance policy (PO / GRN / invoice) | Invoices are matched to receipts without a configurable quantity/price tolerance or variance hold. |
| 4 | Medium | Procurement | No supplier statement reconciliation | Payables balance cannot be agreed to a supplier statement inside the app. |
| 5 | Medium | Inventory | Transfers record item-level quantities only | Batch/lot-level transfer quantities are not captured. |
| 6 | Medium | Payroll | No statutory return outputs | The calculations exist; the filings do not. |
| 7 | Medium | Payroll | No payroll disbursement | Gross-to-net is computed and posted; paying staff is out of scope. |
| 8 | Medium | Fixed assets | Straight-line depreciation only | No tax depreciation, revaluation or impairment. |
| 9 | Medium | Audit | No Phase 5 audit viewer | Rows are written; there is no dedicated UI to review them per module. |
| 10 | Low | Modules | HR/payroll are not behind a facility module switch | They are permission-gated, but an "hr" module key does not exist, so the provisioning screen cannot disable them. |
| 11 | Low | Dependencies | 4 moderate advisories (`esbuild` via `drizzle-kit`) | 0 high/critical. Dev-tooling only; upgrade requires a breaking `drizzle-kit` change. |

## 5. Test and CI results

### 5.1 GitHub CI at the published head — RED

`gh run list` shows the last four pushes failed:

| Commit    | Run         | Conclusion |
| --------- | ----------- | ---------- |
| `d729178` | 42780612973 | failure    |
| `070a0d4` | 42778218506 | failure    |
| `fff9bfb` | 42734080069 | failure    |
| `b036a86` | 42733804034 | cancelled  |
| `f8a670a` | 42726164228 | failure    |
| `3090dc7` | 42719195136 | success    |

Job outcomes for `d729178`: typecheck/lint **failure**, formatting **failure**, coverage
**failure**, database specs **failure**, bootstrap **failure**; production build and dependency
audit passed. `gh run view --log-failed` cannot retrieve the logs from this sandbox (the Actions
log store returns `EOF`), so every gate was reproduced locally instead.

### 5.2 Root causes found by local reproduction

Four committed defects, all pre-dating this task and all now fixed locally:

1. **Formatting** — `scripts/synthetic-procurement-journey.mjs` and
   `scripts/synthetic-workforce-journey.mjs` were not Prettier-formatted.
2. **Lint error** — `scripts/inventory-browser-synthetic.mjs:62` declared an unused
   `waitForText` helper (the only `severity: error` in the repo).
3. **Stale API-facade test** — `api-domain-clients.spec.ts` enumerated 10 domain clients while
   the facade spreads 13, so it asserted `301 === 237`. It also missed that `fixedAssetsClient`
   and `procurementWorkflowClient` were imported into the facade but never re-exported.
4. **Stale schema contract tests** — `schema-extraction.spec.ts` pinned 229 barrel exports while
   Phase 5 legitimately added 30, and `schema-financial-ledger.spec.ts` did not know about
   migration 0076's `goods_received_note_id` column and its unique GRN index.

A collision check across all 14 client modules found **313 unique method names and 0 duplicates**,
so the facade itself was sound; only the test's list was out of date.

### 5.3 CI-equivalent run after the fixes (local, synthetic PostgreSQL 18.6)

Run on a clean `git worktree` at `d729178` plus the seven verification fixes, so the untracked
approval-policy slice could not influence the result.

| Gate | Command | Result |
| ---- | ------- | ------ |
| Typecheck | `npm run typecheck` | **pass** (exit 0) |
| Lint | `npm run lint` | **pass** — 0 errors, 103 warnings |
| Formatting | `npm run format:check` | **pass** — all files formatted |
| Full suite + coverage | `npm test` | **255 files / 2371 tests passed**, 0 failed |
| Coverage thresholds | statements 62.91 / branches 60.00 / functions 61.48 / lines 64.21 (min 55/48/58/55) | **pass** |
| Database specs | `npx vitest run src/tests/vitest` | **104 files / 1137 tests passed** |
| Auth DB specs | `auth-service.db.spec.ts` + `authentication.db.spec.ts` | 2 passed |
| County migration | `county-migration.db.spec.ts` | 1 passed |
| HTTP + PostgreSQL | `integration/http-database.db.spec.ts` | 1 passed |
| Production build | `npm run build` | **pass** |
| Dependency audit | `npm audit --audit-level=high` | **pass** — 0 high/critical, 4 moderate |
| Backup-path guard | `npm run security:check-tracked-database-backups` | **pass** |
| Migrations | `db:migrate` + `db:status` on two empty databases | **READY**, 78 migrations, 0009 intact |

Baseline comparison at `d729178` before any fix: **4 failed tests / 3 files** out of 2371 —
exactly the four defects above. No other test regressed.

### 5.4 Not reproducible in this sandbox

- The `Fresh checkout Docker bootstrap` job (`npm run test:docker`) needs a Docker daemon, which
  this environment does not provide. It must be confirmed by CI on the next push.
- GitHub-hosted CI itself cannot be re-run from here without pushing, which this task does not
  authorize.

### 5.5 Browser evidence (recorded, still valid files in the repo)

| Artefact | Assertions | Result | Captured |
| -------- | ---------: | ------ | -------- |
| `browser-acceptance.json` (HR + payroll) | 24 | 24 passed, 0 page errors | 2026-11-10T01:12Z |
| `fixed-assets-browser-acceptance.json` | 18 | 18 passed | 2026-11-10T01:09Z |
| `procurement-browser-acceptance.json` | 13 | 13 passed, 0 page errors | 2026-11-10T08:08Z |
| `inventory-browser-acceptance.json` | 17 | 17 passed, 0 page errors | 2026-11-10T08:08Z |

Screenshots 1–27 accompany them in `docs/project/delivery-evidence/phase-5/`. The browser runs
were performed against the previous synthetic database instance, which the sandbox reset
destroyed; the files listed above are the preserved evidence.

### 5.6 API journeys (recorded)

- Procurement: **27/27** assertions including over-receipt `409 OVER_RECEIPT`, payment exceeding
  balance `409 PAYMENT_EXCEEDS_BALANCE`, payment idempotency and payables netting to zero.
- Inventory: **33/33** assertions including receipt replay, negative-stock refusal, count posting
  and double-post refusal, transfer legs, reorder alerts, FEFO dispensing, valuation and
  facility-isolation checks.

These were run on the pre-reset synthetic database; the scripts are committed
(`scripts/synthetic-*-journey.mjs`) and re-runnable with the documented fixture setup.

## 6. Evidence index

| Path | Contents |
| ---- | -------- |
| `docs/project/delivery-evidence/phase-5/*.json` | Four browser acceptance reports |
| `docs/project/delivery-evidence/phase-5/1…27-*.png` | 30 screenshots across HR, payroll, assets, procurement, inventory |
| `scripts/synthetic-workforce-*.{ts,mjs}`, `synthetic-procurement-*`, `synthetic-inventory-*` | Fixture + journey drivers |
| `scripts/{procurement,inventory}-browser-synthetic.mjs` | Chromium acceptance drivers |
| `drizzle/0074…0077_*.sql` | Phase 5 schema |

## 7. Recommendation

Phase 5 should be recorded as **implemented and synthetically tested, awaiting facility UAT**, not
as complete. Before it can be closed: fix the two High gaps (inventory→ledger policy, supplier
returns), decide the three-way tolerance policy with the client, and run facility UAT on payroll
and stores. Phase 6 readiness is assessed separately in
[`PHASE-6-INTEGRATION-MATRIX.md`](./PHASE-6-INTEGRATION-MATRIX.md).
