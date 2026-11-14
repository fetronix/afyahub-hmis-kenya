# Master Completion Register

**Repository:** `fetronix/afyahub-hmis-kenya`
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`
**Baseline:** published `197a553`; this checkout's `HEAD` is the stale shallow `0111b55`
**Updated:** 2026-10-27

Status vocabulary — kept strictly separate, never merged into one word:

| Term                           | Means                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| **Implemented**                | the code exists and is wired                                        |
| **Tested locally**             | automated tests exercise it in this repository                      |
| **Verified w/ synthetic data** | exercised against a real PostgreSQL database with synthetic records |
| **Sandbox-verified**           | exercised against a provider's sandbox, with their credentials      |
| **Provider-accepted**          | the provider has confirmed the integration                          |
| **Facility-accepted**          | a real facility has signed it off                                   |
| **Production**                 | running for real users                                              |

---

## Batch status

| #   | Batch                               | Status                                                                                    | Evidence                                                        | Notes                                                                    |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Approval policy management          | **Implemented · Tested locally · Verified w/ synthetic data**                             | 98 tests; `BATCH-1-APPROVAL-POLICY-MANAGEMENT.md`               | complete for scope                                                       |
| 2   | Backup, restore, DR                 | **Implemented · Tested locally · Verified w/ synthetic data**                             | 21 tests + restore drill passed (230 tables, content-identical) | `pgdump` path unproven here (no client tools in sandbox); see runbook §8 |
| 3   | Bank reconciliation                 | **Backend implemented · Tested locally · Verified w/ synthetic data.** No UI.             | 12 focused tests; migration 0081                                | see notes below                                                          |
| 4   | Fixed asset accounting              | **Complete for scope · Tested locally · Verified w/ synthetic data.**                     | 8 new integration tests, 6 UI tests, migration 0082             | see notes below                                                          |
| 5   | HR · payroll · procurement          | **Complete for scope · Tested locally.** P9/P10 as gated extracts, not filings.           | 143 payroll/HR + 56 procurement tests                           | see notes below                                                          |
| 6   | Clinical workflows                  | **Verified by the full suite · One real gap found and closed (dialysis billing).**        | 271 files / 2564 tests at the time; migrations 0084–0085        | see notes below                                                          |
| 7   | Billing and accounting end to end   | **Verified by the full suite · One real gap found and closed (no subledger↔GL tie-out).** | 273 files / 2574 tests; 7 integration + 3 UI tests added        | see notes below                                                          |
| 8   | Reporting, MOH, KHIS/DHIS2          | **Verified for what exists · One real gap closed (surveillance correction)**              | 276 files / 2589 tests; 15 new tests; migration 0086            | MOH 705 still 501; no KHIS/DHIS2 adapter                                 |
| 9   | Integrations                        | **Verified at adapter/boundary level · One real gap closed (dispatch dead-end)**          | 278 files / 2610 tests; 21 new tests; migration 0087            | no provider credentials; nothing claimed as sandbox-verified             |
| 10  | Security and multi-tenancy          | **Verified over real HTTP · One real hole closed (ungrantable permission)**               | 9 HTTP isolation tests + 4 catalogue tests                      | isolation proven for the swept resources, not the whole schema           |
| 11  | Monitoring and operations           | **Implemented · Tested locally · Verified w/ synthetic data.** No alerting, no metrics.   | `/api/ops/status` (7 tests), runbook (8 tests)                  | nothing pages anyone; see runbook §1 and §8                              |
| 12  | Deployment and production readiness | **Doc audited against the code · 3 real defects fixed · No host observed**                | `deploy:verify` (11 tests), env contract (5), timezone (8)      | no image built, no container run, no facility UAT                        |

**Nothing in this register is claimed as production-ready, provider-accepted or
facility-accepted.** No external party has tested this software.

---

## Completed work in this session

### Batch 1 — Approval policy management

Preserved and re-verified, not rebuilt. Two defects fixed earlier in the batch
remain fixed: the router's ALL-of guard (now any-of) and the policy refusal that
surfaced as HTTP 500 instead of 403. Added this session: a route-registration
test, mutation-checked against the original defect.

### Batch 2 — Backup, restore and disaster recovery

New: `scripts/backup/` (library, backup, verify, restore, drill), four npm
scripts, `docs/project/operations/BACKUP-RESTORE-RUNBOOK.md`, 21 focused tests.

Proven: an encrypted archive is written, cannot be read without the key, fails on
tamper; retention keeps the newest N and the last 30 days; a restore into a
separate database reproduces all 230 tables with **identical row counts and
identical content hashes**.

Three real defects found by the drill, not by inspection:

1. **Microsecond precision loss.** Temporal columns were read as JS `Date`
   (milliseconds) and written back, shaving three digits off every timestamp.
   Invisible until rows are compared. Fixed by reading those types as text.
2. **JSON columns corrupted.** The driver sends JS arrays as Postgres array
   literals, which is invalid in a `json` column. Fixed by serialising by the
   declared column type.
3. **The audit log refused the restore** — `audit_logs` has a `BEFORE TRUNCATE`
   guard. Rather than disable a security control, the restore now clears only
   non-empty tables and refuses an in-place restore with instructions.

---

### Batch 3 — Bank reconciliation

What already existed and was preserved: CSV parsing and validation, statement
import with file-hash and per-line duplicate detection, manual exact match to a
posted journal line, the reconciliation worksheet, and reconciliation save.

What this session added:

| Capability                                                                           | Where                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Automatic match suggestions with stated reasons and confidence                       | `suggestMatchesForTransactionScoped`            |
| Unmatched investigation: per-item likely explanation plus ledger-only candidates     | `investigateUnmatchedScoped`                    |
| Reversal of a wrong match, audited, refused if a covering reconciliation is approved | `unmatchBankTransactionScoped`                  |
| Second-person approval with segregation of duties and a period lock                  | `approveBankReconciliationScoped`               |
| Reconciliation report with the gaps named                                            | `bankReconciliationReportScoped`                |
| Statement adjustment posted through the existing double-entry poster                 | `postBankStatementAdjustmentScoped`             |
| Five routes                                                                          | `src/routes/accounting.routes.ts`               |
| Approval columns and a duplicate-match index                                         | `drizzle/0081_bank_reconciliation_approval.sql` |

Deliberate limits, stated rather than hidden:

- **Partial matching is not supported.** The accounting model is one statement
  line to one posted journal line, with an exactly equal amount and the same
  direction; this session added a unique index that enforces it. A genuine
  many-to-one match needs a junction table and a change to the worksheet maths,
  and was not attempted. A statement line that nets several ledger entries will
  therefore show as unmatched and be investigated, not silently forced.
- **No reconciliation UI exists in the application.** There was none to extend.
  The API is complete and tested; the screens are not built.
- Suggestions never write a match, and nothing in this module contacts a bank.

### Batch 4 — Fixed asset accounting

Already present and verified working in this session: registration, categories,
straight-line monthly depreciation with idempotent period runs, accumulated
depreciation, disposal with gain/loss, maintenance, transfers, register report
and audit.

Added or corrected in this session:

| Capability         | Notes                                                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Impairment**     | Writes the asset down to a recoverable amount, posts `Dr loss / Cr asset`, and depreciates the reduced basis afterwards. Cannot take an asset below zero.                                                                                            |
| **Revaluation**    | Restates the carrying amount. Increases go to a revaluation surplus (equity, never revenue); falls reverse the surplus held for that asset first and only the excess reaches profit or loss, refusal if no loss account is supplied for that excess. |
| **Carrying basis** | New `carrying_basis_kes`. Historical cost is never rewritten; the amount still being depreciated is tracked separately and the depreciation engine spreads the remainder over the remaining life.                                                    |
| **Tax allowance**  | Computed **only** from rates the facility records, each carrying a mandatory `authority_reference`. With no configured rate the schedule returns `NO_CONFIGURED_RATE` rather than a number. No Kenyan rate is encoded anywhere in the product.       |
| **UI**             | Impair / Revalue dialogs on the asset drawer (gated by `assets.dispose`), impairment and revaluation columns on the register report, and a tax allowance panel with its rate form.                                                                   |
| Migration          | `drizzle/0082_fixed_asset_impairment_revaluation_tax.sql`                                                                                                                                                                                            |

Known limits, stated plainly:

- The tax schedule is a **schedule**, not a return. It does not model capital
  allowances, balancing charges, or any regime-specific rule beyond the
  configured method (reducing balance or straight line) and rate.
- Revaluation assumes the asset continues to be depreciated over the remaining
  months of its original useful life; it does not re-estimate useful life.
- No revaluation of a whole class at once; revaluations are per asset.

### Batch 5 — HR, payroll, procurement and statutory forms

Verified working in this session: departments, designations, employees, documents,
attendance, roster, leave with independent approval, payroll periods, statutory
version management, calculation with mandatory effective-dated rules, approval
segregation, posting to a balanced journal, payslip detail, and the procurement
lifecycle including supplier returns and three-way matching.

Added in this session:

| Capability            | Notes                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll form profiles | New `payroll_form_profiles` (migration 0083) records which **published** P9/P10 version the facility produces, with a mandatory citation and effective dates.   |
| P9/P10 extract        | `statutoryFormExtract` aggregates posted payroll only, per employee and in total, and refuses with `FORM_PROFILE_REQUIRED` when no profile covers the tax year. |
| Routes                | `GET                                                                                                                                                            | POST /api/payroll/form-profiles`, `GET /api/payroll/statutory-extract`. |

What is deliberately **not** claimed:

- The extract is not a filed return, and its layout is not asserted to match any
  KRA form. The response says so in its own `notice` field. Reproducing a
  regulator's form without the authoritative document would be invention.
- The statutory rates remain whatever the facility recorded, with citations.
  The engine still refuses to calculate when no version covers the pay date.

### Batch 6 — Clinical workflows

Verified in this session by execution, not by inspection:

| Area                            | Evidence                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPD / registration / encounters | `clinical-catalogue-selection` (11), `phase3-financial-journeys` (5) including one-charge-per-visit assertions                                                |
| Laboratory                      | `clinical-workflows-acceptance` — accessioning, collection before result, verification, no concurrent duplicate accession, explicit completion before billing |
| Pharmacy / inventory            | same file — FEFO dispensing once, partial fills, stock locking, no caller-supplied price                                                                      |
| Radiology                       | `radiology-write-validation` + catalogue selection billing                                                                                                    |
| Inpatient                       | `inpatient-acceptance`, `inpatient-bed-billing`, `inpatient-migration`                                                                                        |
| Maternity / immunisation        | `scoped-queries-and-mch` — postnatal contact checks, KEPI schedule rules                                                                                      |
| Theatre                         | `theatre-scheduling` (13) and `theatre-write-validation` (4)                                                                                                  |
| Patient portal                  | `phase1-portal-isolation`, portal grant/revocation tests                                                                                                      |

**The defect that was found and fixed.** Dialysis sessions were completed as
`UNBILLED` and nothing anywhere billed them: there was no billing family, no
tariff link and no charge source. A completed session produced a clinical record
and no revenue, with not even a charge-attempt row to recover it from. Fixed
end to end:

- `DIALYSIS` added to the closed billing-family list and to the facility service
  category list (migration 0085), with the family's department and code rules.
- `dialysis_treatment_plans.facility_service_id` (migration 0084) names the
  service a plan delivers, so the price comes from the ordinary facility tariff
  machinery rather than a modality name.
- Resolver case for `DIALYSIS`: refuses a session that is not `COMPLETED`, one
  from another tenant/facility/patient, and a plan with no service.
- `billDialysisSessionScoped` — charges once, marks `BILLED` only on a real
  charge, audits both outcomes, and refuses a second attempt.
- A partial unique index on `billing_items(source_id) WHERE source_type='DIALYSIS'`.
- UI: a billing form on the dialysis screen, gated by `billing.create`, kept
  separate from the outcome form.

Tests: `client-dialysis.db.spec.ts` 5 → 7, plus new
`dialysis-billing-ui.spec.tsx` (3).

**Honest limits.** The other clinical modules were exercised by their existing
suite, not re-audited line by line this session. Nothing in this batch was tested
against a real facility, and UAT remains outstanding.

### Batch 7 — Billing and accounting end to end

Verified in this session by execution, not by inspection:

| Area                      | Evidence                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Invoice → ledger posting  | `billing-posting` (15) — allocation, idempotent replay, reversal ordering, pre-finalization refusal                    |
| Payments, refunds, voids  | `phase3-financial-journeys` (5), `invoice-payment-acceptance`, `refund-receipt-acceptance`, `invoice-void-validation`  |
| Facility-owned billing    | `facility-owned-billing`, `finalized-invoices`, `master-tariffs-workflow`, `billing-charge-concurrency`                |
| Journals and period close | `client-accounting` (6) — period close, unbalanced-SQL rejection, idempotency-key reuse, account deactivation race     |
| Expenses and approval     | `phase3b-expense-approval` (11) — independent approval, source-linked posting, refusal paths                           |
| Statements and reports    | `report-centre-ledger` (6) — trial movements, income and balance-sheet subsets with scope and export permission checks |
| Bank reconciliation       | `bank-reconciliation` (12) — import, match, unmatch, adjustments, approval, period lock                                |
| New tie-out, HTTP + DB    | `billing-gl-reconciliation.db.spec.ts` (7)                                                                             |
| New tie-out, UI           | `billing-gl-reconciliation-ui.spec.tsx` (3)                                                                            |

**The gap that was found.** The system could post billing journals into a
balanced double-entry ledger, and it could list which billing sources had a
journal. Nothing compared the two sets of numbers. Two endpoints said so
themselves: the statements overview returned
`billingReconciliation: 'NOT_IMPLEMENTED'` and the billing consistency report
returned `ledgerReconciliation: 'NOT_IMPLEMENTED'`. In that state a facility could
finalize invoices and record receipts without posting them and the ledger would
still look balanced, with no report naming the missing revenue.

**The fix.** `reconcileBillingLedgerScoped` and
`GET /api/accounting/billing-gl-reconciliation` (`accounting.read` **and**
`billing.read`), read-only, one repeatable-read snapshot, as-of date required.
It answers five controls independently — patient receivable, insurer receivable,
revenue, settlement clearing and credit liability — and each control reports the
ledger balance, the reviewed-bridge expectation, the billing-subledger
expectation and both differences. A control is `TIED`, `POSTING_BACKLOG` (the
difference is exactly the unposted invoices, receipts and refunds, listed with
amounts), `NOT_CONFIGURED`, or `UNEXPLAINED`. Nothing is netted away and no
difference is called immaterial.

Proof, all against synthetic PostgreSQL data:

1. Invoice 100 (patient 40 / insurer 60), receipts of 45 and 60 → all five
   controls tie; the 5.00 overpayment is a credit liability, not a negative
   receivable.
2. A finalized invoice that was never posted → `POSTING_BACKLOG` on revenue,
   patient and insurer receivable, with the invoice id and 50.00 listed; not a
   false tie.
3. A manual journal debiting patient receivable and crediting revenue outside
   the bridge → both controls `UNEXPLAINED`, the journal named with its 25.00
   debit magnitude, `reconciled: false`; a controlled reversal returns both to
   `TIED` and empties the exception list.
4. An invoice journal reversed while the invoice stayed active → revenue
   `UNEXPLAINED` by exactly the invoice total, receivables by their
   responsibilities; voiding the invoice ties every control.
5. A facility with no postings → all five controls `NOT_CONFIGURED`, not a
   fabricated pass.
6. Missing `billing.read` → 403; missing, malformed or inverted dates → 400.
7. Two facilities with different postings → each report counts only its own, and
   no account appears in both account lists.

**Honest limits, reported by the endpoint itself.** Line-level `BILLING_ITEM`
journals, opening balances, bank statements and insurer settlement are not
reconciled by this report. The UI panel is read-only and does not post or write
off anything. The tie-out proves arithmetic agreement between three sources; it
proves nothing about whether a payer actually paid.

### Batch 8 — Reporting, MOH, KHIS/DHIS2

Verified in this session by execution, not by inspection:

| Area                         | Evidence                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Report centre queries        | `report-centre-operational`, `report-centre-ledger`, `report-centre-diagnoses`, `report-centre-selectors` |
| Report centre auth and scope | `report-centre.db`, `report-centre-error-redaction` — every engine is tenant/facility parameterised       |
| Export formats               | `report-centre-export` — CSV formula injection, PDF glyph coverage, size ceilings                         |
| Report centre UI             | `report-centre-ui`, `report-centre-invoice-ui`                                                            |
| Surveillance writes          | `public-health-explicit-counts` (3) — explicit facts, no invented defaults                                |
| New correction path          | `public-health-corrections.db.spec.ts` (5)                                                                |
| New surveillance UI          | `public-health-corrections-ui.spec.tsx` (5)                                                               |
| New navigation guard         | `report-catalogue-integrity.spec.ts` (5)                                                                  |

**The gap that was found.** `public_health_reports` was insert-only. A
notifiable-disease count keyed in wrongly — 40 cholera cases instead of 4 — had
no correction path. The only way to "fix" the week was to record a second
report, and both rows then counted: the facility's own totalled figure doubled,
and nothing on the screen said so. For a surveillance table that is the worst
possible failure mode, because the inflated number looks like an outbreak.

**The fix.**

- Migration 0086 adds `supersedes_report_id` with a self-reference, a constraint
  forbidding self-supersession, and indexes on
  `(facility_id, epi_week, disease_code, age_group)`. No unique index was added:
  existing deployments may already hold duplicates, and refusing to migrate
  would be worse than reporting them.
- `correctReportScoped` inserts a replacement row pointing at the original and
  marks the original `SUPERSEDED`. Nothing is deleted or edited. A mandatory
  reason, at least 10 characters, is audited with both the previous and the
  corrected figures.
- `POST /api/public-health/reports/:id/correction` (`public_health.reports.create`).
  Refusals: identical counts (`NO_CHANGE`), a second correction of the same row
  (`ALREADY_SUPERSEDED`), moving a record to another disease or week
  (`IMMUTABLE_FIELD`), a reader without the write permission (403).
- `GET /api/public-health/reports/summary?epiWeek=` (`reports.read`) — the weekly
  tally. Only non-superseded rows count. Where two active rows share a disease
  and age group the figure is returned **disputed** with its contributing ids and
  `submission.ready: false`, rather than being summed and presented as fact.
- Recording a second competing row now returns a warning naming the conflict.
- The screen now excludes replaced rows from its headline totals — before this,
  the correction path would have made the display wrong in a new way — shows
  each replaced row struck through with the id that replaced it, offers a
  correction form with a required reason, and shows the weekly tally with its
  disputed flags.
- `report-catalogue-integrity.spec.ts` guards the navigation: no catalogue entry
  may name an unregistered engine, no engine may be unreachable, every
  unavailable report must state its dependency, and every engine must build a
  plan that binds tenant and facility as parameters 1 and 2. An engine with no
  plan now returns `REPORT_UNAVAILABLE` (501) instead of a generic internal error.

**What is deliberately still not done.** `GET /api/interop/dha/moh-705` returns
501 with its reason intact. There is no KHIS or DHIS2 adapter anywhere in the
codebase, and the screen says so in a standing banner. Inventing either format
would be fabricating a statutory return, so neither was attempted; the blocker is
an external specification, not effort.

**Honest limits.** The weekly tally is a facility-local sum of staff-entered
counts. It does not verify case definitions, week boundaries, or that the counts
match the paper register, and it is explicitly not a submission. Two existing
duplicate rows are reported, not silently merged. Nothing here has been compared
with a real KHIS export because none was available.

### Batch 9 — External integrations: configuration versus what the adapter does

Verified in this session by execution, on a rebuilt cluster (88 migrations,
`db:status` READY), before anything changed:

| Area                  | Evidence                                                         |
| --------------------- | ---------------------------------------------------------------- |
| DHA boundary          | `dha-boundaries.spec.ts`                                         |
| SHA eClaims boundary  | `sha-eclaims.spec.ts` (rule-level)                               |
| SHA claims DB         | `sha-eclaims.db.spec.ts`, `phase3-sha-benefits-scope.db.spec.ts` |
| Payment hub (unit+DB) | `payment-hub.spec.ts`, `payment-hub.db.spec.ts`                  |
| Baseline total        | **6 files / 110 tests, 0 failed**                                |
| New reconciliation    | `claim-dispatch-reconciliation.db.spec.ts` (11) + UI (10)        |

**The gap that was found.** A claim dispatch reserves its guard row before the
provider call. When the response is lost, the guard becomes `UNCERTAIN` and
`lockMutableClaim` refuses every later action on that claim with
`CLAIM_DISPATCH_REVIEW_REQUIRED`. That is the right default — but nothing in the
codebase could read, list or resolve the guard. No service, route, permission or
screen referenced `UNCERTAIN` outside the guard itself. The message told staff to
"review the payer record" and there was no way to do so, so one lost HTTP
response bricked the claim permanently.

**The fix.** Migration 0087 adds an append-only
`insurance_claim_dispatch_reconciliations` table and a facility/state index on the
guard table. `claim-dispatch-reconciliation.service.ts` lists blocked dispatches
and records one of three findings: payer confirmed received (needs the payer-side
reference; claim becomes `ACKNOWLEDGED`), payer confirmed not received (status
unchanged, guard released so a human may dispatch again), or still unresolved
(recorded, guard retained). A finding is written in the same transaction that
deletes the guard, so the history outlives it and the unique
`(workflow, claim_id)` index stays single-row. A "not received" finding against a
claim the local record already shows as submitted is refused rather than
reopening it. Both route families expose queue, history and record endpoints
under their existing reconciliation/submit permissions, and both claim screens
render a queue and an evidence-required form. Nothing calls a payer; nothing
retries automatically.

**Integration reality, verified without provider credentials.**

| Surface               | What it actually does                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DHA                   | mock/sandbox/production; production needs `DHA_ALLOW_PRODUCTION=true` and a base URL DHA never published. Readiness names only implemented operations and marks the rest absent. |
| SHA gateway           | mock by default, `SANDBOX_SIMULATION` labelling; real transport 503 `PAYER_TRANSMISSION_NOT_VERIFIED`.                                                                           |
| Private insurers      | Britam/PACIS/CIC/Jubilee direct adapters report `supportedByContract: false` and `AWAITING_DOCUMENTATION`; manual/file and SmartLink paths remain.                               |
| Payment hub           | AES-256-GCM secrets with key-id AAD and rotation guards; M-Pesa callback always 503 `CALLBACK_VERIFICATION_UNAVAILABLE`.                                                         |
| Professional registry | registration ≠ licence; mock results cannot authorise a clinical invitation.                                                                                                     |

**Honest limits.** No provider sandbox credential exists in this environment and
none was fabricated, so no live eligibility, claim, remittance or callback was
exercised. The reconciliation form records what a human saw in the payer's
record; it does not verify that record, and it is not adjudication or payment.

### Batch 10 — Multi-tenancy and the permission catalogue

Proven over real HTTP rather than by reading `.where` clauses: two tenants, two
facilities each, a user holding every permission in the seed, and nine tests that
attempt cross-tenant and cross-facility reads and writes on patients,
encounters, claims, payments, HR status and the audit log — asserting the status
code **and** the row afterwards. 9/9.

One real hole: `radiology.read` was demanded by two shared catalogue endpoints
and existed in no seed, so it could not be granted to any role. Added, and a
route-scanning test now fails when any route demands a code the catalogue lacks
(4 tests). Two test-fixture defects were also fixed — an empty `permissions`
table on a fresh cluster, and the module gate answering before the tenancy gate.

### Batch 11 — Monitoring and operations

`GET /api/ops/status` (requires `audit.read`, mounted after `requireAuth`)
returns aggregate counters for dispatch reviews held by an unknown payer
outcome, unbilled charges and refunds awaiting a second decision, plus a 24-hour
integration summary and a schema comparison — no patient identity, no amounts, no
free text, and no invented thresholds. 7 tests against synthetic PostgreSQL.

`docs/deployment/operations-runbook.md` states what exists and what does not: no
alerting, no log shipping, no metrics endpoint, and nothing exercised on a real
host. 8 tests pin the runbook to the code so it cannot quietly drift.

### Batch 12 — Deployment readiness

The deployment guide was audited against the software, and three real defects
came out of it:

- `DEFAULT_TIMEZONE` was documented, set by operators and **read by nothing**.
  It is now validated and applied to `process.env.TZ` at startup; an invalid name
  warns instead of crashing.
- `react`, `react-dom`, `vite` and three build plugins were runtime
  dependencies, so every production install carried the browser toolchain.
  Moved to `devDependencies`: **166 packages** instead of 517, proven by booting
  the server from a `--omit=dev` tree (`/api/health` and `/api/ready` both 200).
- `docker-bootstrap.spec.ts` used the repository as its fixture root, so ten
  tests failed once a build existed; the stale-build refusal it tripped over had
  no test of its own. Both fixed.

Added `npm run deploy:verify`: 11 tests over the artifact set, `npm start`,
and `drizzle/` versus its journal.

**No image was built, no container ran, no host was touched.** Docker is not
available in this environment (`docker info` fails), so the Dockerfile and
compose file remain unverified configuration.

## External dependencies and blockers

| Item                                                              | Blocks                               | Status                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| PostgreSQL client tools (`pg_dump`, `pg_restore`) in this sandbox | proving the `pgdump` engine here     | **environment limitation**; the logical engine is proven instead; drill must be run on the real host |
| Provider sandbox credentials (M-Pesa, banks, SHA, DHA)            | Live integration verification        | blocked, not claimed; Batch 9 verified adapters and boundaries only                                  |
| Authoritative NSSF/SHIF/PAYE rates and forms                      | statutory payroll output correctness | blocked on authoritative sources; no rates invented                                                  |
| Authoritative MOH 705 / KHIS specifications                       | Batch 8 format validation            | blocked                                                                                              |
| Real facility UAT                                                 | acceptance                           | not started                                                                                          |
| Deployment target access                                          | Batch 12 verification                | none observed                                                                                        |

---

## Quality gates (this session)

| Gate                     | Result                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `tsc --noEmit`           | 0 errors                                                         |
| eslint (changed files)   | 0 errors, 0 warnings                                             |
| prettier (changed files) | clean                                                            |
| `vite build`             | succeeded                                                        |
| **Full suite**           | **285 files / 2663 tests — 0 failed, 0 skipped**                 |
| Restore drill            | PASSED (230 tables, identical contents)                          |
| `npm run deploy:verify`  | passes on a real `build:deploy`; 88 migrations match the journal |
| production install       | 166 packages; `build/server.js` boots, health and readiness 200  |

The full suite initially failed two files; both were investigated. One was a real
Batch 1 gap — `api-domain-clients.spec.ts` did not cover the new approval-policy
client, so its collision guard had stopped measuring what it claims. Fixed. The
other was an unset `JALICARE_TEST_PG_SYSTEM_IDENTIFIER` safety guard; satisfied,
not bypassed.

## Git checkpoint

Working tree only. **Nothing committed or pushed in this session.** The tree
carries the Batch 1–7 files plus a large body of pre-existing prior-phase WIP
(~610 paths) that must not be committed together. See
`IMPLEMENTATION-CHANGELOG.md` for the exact file list.
