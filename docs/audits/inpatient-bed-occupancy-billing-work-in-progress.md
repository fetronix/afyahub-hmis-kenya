# Inpatient bed-occupancy billing — work in progress

**Status: not release-ready or complete.** The evidence below is synthetic only. An authorized real-facility discharge producing the correct invoice from the actual bed's configured daily charge has not been verified. No production database, real patient or external payer was accessed, and no deployment is authorized by this note. Pharmacy billing remains separately incomplete; see `pharmacy-inventory-billing-work-in-progress.md`.

## Cause and implementation

The former inpatient accrual constructed ward/date `BED_DAY` requests and resolved a generic facility service or tariff. It did not use `beds.daily_charge`, and it did not preserve sufficient historical bed/rate evidence. A current bed status or today's price cannot establish a prior stay's identity, price, transfers or policy. The real facility's historical records have not been investigated.

- New admission and transfer transactions capture scoped patient, ward, bed, database assignment time and the bed's positive, confirmed daily rate. The facility/tenant timezone and configured cutoff, grace and same-day rule are snapshotted at admission. Different beds can have different rates; the ward's displayed rate does not override or supply a bed rate. Unconfirmed, missing or zero rates are not treated as free.
- Billing uses the selected **facility-local cutoff crossings**: each cutoff is charged at the captured rate of the bed occupied at that instant, subject to the saved grace and same-day rules. Active-stay accrual is an estimate only; final nights are calculated from persisted occupancy at discharge. Manually entered clinical times, missing policy or historical evidence lead to review rather than silently overriding database event times.
- Discharge changes the bed to Cleaning and records an immutable, scoped bed-billing work marker in the clinical transaction. Night/review staging and invoice creation occur after discharge commits. Invoice creation uses the existing engine, with admission, invoice patient/encounter, occupancy, night, rate and amount provenance; it does not resolve a generic ward tariff. Replays use stable identities. Missing encounter or price evidence remains unresolved for authorized review and retry.
- Authorized facility staff can configure policy and create, change or confirm a bed rate with a reason; edits use revisions and audit records. Historical reviews require clinical and financial permissions, an evidence reference, a documented policy and explicit contiguous bed periods/rates checked against recorded transfers. Eligible earlier pending attempts are retained and auditably superseded. Existing billed, calculated or voided bed charges require separate controlled reconciliation, not automatic rewriting.
- Inpatient UI includes price, policy, occupancy estimate and recovery controls. Tariff-free bed lines retain their provenance through finalization; payer codes are not inferred from a bed number or unrelated tariff. This does not establish an insurer submission, approval or payment.

**Important discharge boundary:** synthetic failure injection now shows that a queue-staging failure, staging-audit failure or later invoice-insertion failure leaves a committed discharge and Cleaning status; pending work remains visible for authorized recovery. If the clinical transaction cannot persist its durable work marker or clinical audit, it still rolls back rather than silently committing an untrackable discharge. This is a database-persistence boundary, not an unconditional guarantee that every infrastructure failure permits discharge. No real facility has validated this behavior.

## Diagnosis of the reported null-policy / time-review case

- The supplied current bed value is `dailyCharge=100.00`, revision 1, with no price review flag; the ward's `dailyRate` is null. These values were supplied by the user, not verified against a real database. A current bed price does not establish the historical `daily_rate_snapshot` or bed occupied at each cutoff. `wards.daily_rate` is not the bed-night price source and must not be filled in or copied automatically.
- `GET /api/inpatient/bed-billing-policy` resolves an authenticated facility, queries `inpatient_bed_billing_policies` and serializes the row or the literal JSON `null`. A missing row returns HTTP 200 with `null`; a legacy row can have unknown (`null`) activation/effective-date metadata after 0065. A null result in an unspecified scope does not prove that a specific facility lacks a row. The endpoint now accepts a validated, scope-checked facility hint; a missing or inaccessible facility cannot be used to bypass authorization.
- Any nonempty client-supplied admission or discharge timestamp sets the corresponding `manual_admission_time` / `manual_discharge_time` flag in `inpatient_bed_stay_snapshots`. `readBedEvidence` checks those flags before validating the saved policy. The earlier browser client automatically sent its clock as a timestamp, and also appended an incorrect instruction to configure a ward tariff. The current client omits automatic times and the misleading suffix. An old-client cause is plausible but not established for the reported stay; timestamps close to a database time do not prove they were unedited.
- A stay with a null snapshotted policy remains unresolved even if a future facility policy is configured. Review requires authorized, documented evidence for the historical policy, dates, bed periods, rates and previous charges; it does not replace original time flags or silently invent a tariff. Generic retries no longer overwrite the original diagnosis/detail of undated or legacy dated bed attempts lacking a saved night. Detail already overwritten by older retries cannot be reconstructed automatically.
- The facility-scoped inpatient recovery panel lists unresolved bed admissions, including work not yet staged, and displays saved policy, time flags, occupancy rates and pending diagnostic codes to appropriately authorized users. It pages admissions in groups of 50 and bounds displayed attempts to 100 per admission; an empty page is not proof that every historic stay was billed. The panel does not restore the retired general pricing-review UI.
- Admission creation and bed policy updates reject conflicting query/body facility identifiers. Admission-specific inspection, review, encounter linking, retry, discharge and transfer check the selected facility against the admission, as well as the caller's tenant/facility permissions. Ward bed lists and the inpatient board propagate that selection. A cleaned bed's release also checks the selected facility and records its facility-scoped audit in the same transaction; an audit failure leaves it in Cleaning.
- **Outstanding scope risk:** other pre-existing ward/bed setup and bed-status endpoints resolve a record across an authorized tenant without consistently matching it to the module-gated selected facility; their UI requests also do not consistently carry a selected-facility hint. They require a separate scope, audit and concurrency correction before tenant-level use or release. The checks above do not certify those endpoints.

## Policy applicability and admission encounter follow-up

- The scope-checked policy GET reads a single row for the selected tenant/facility and returns JSON `null` only when that query finds no row. A present row now returns its revision, explicit `isActive`, effective dates, `scope: FACILITY` and current applicability. Missing migration columns cause a database error, not a null policy. The real deployment, database, selected scope and historical row state have not been inspected, so this does not establish why the reported real request was null.
- `0065` adds nullable activation/effective dates and captures the policy identity, revision, applicability and effective dates on new stays, plus the bed-price revision on each occupancy. Existing policy rows have unknown activation/effective dates and fail closed for new admissions until an authorized facility user explicitly confirms and saves them. Prior snapshots, rates and finance rows are not backfilled.
- The current model is **one mutable facility-wide policy**, covering its own wards and beds, not separate ward/bed overrides or scheduled future versions. Saving a future-dated replacement immediately supersedes the previous row and can leave new admissions in review until it becomes effective. The UI warns before saving. Do not configure this unless the facility has approved the cutoff, grace, same-day rule and effective period; the synthetic values in tests are not a recommendation.
- Admission displays policy, selected-bed price and encounter readiness. The transaction creates/audits an `INPATIENT` encounter at the database assignment time only if the user has `clinical.create` and did not supply a historical admission time. Otherwise an authorized, verified encounter is needed; care can proceed but bed billing is unresolved. A supplied encounter must be readable, active, inpatient, started, scoped to the patient and facility, and unused by another admission. The admission, encounter, occupancy, bed assignment and audit commit together.
- A patient must belong to the selected registration facility or have an existing `ACTIVE` patient-facility relationship. A synthetic active referral passed while a same-tenant patient without one was rejected. The broader patient picker still lists registration-facility patients; it does not implement full shared-record/referral consent workflows.
- Historical encounter linking requires inpatient/clinical/finance permissions, a reason, evidence reference and explicit staff affirmation. It checks facility, patient, type, non-reuse and inclusive local calendar-day overlap, and refuses to move an existing bed invoice. Reviewed occupancy periods are considered when original clinical dates are ambiguous. A calendar-day overlap is a guard, **not** proof that the encounter belongs to the stay. Existing wrong-type links are not billed automatically and require controlled financial reconciliation.
- Encounter start/end columns are PostgreSQL timestamps without timezone metadata. Current application writers use UTC, and these checks interpret them as UTC independently of the server's local timezone. Older records may have used a different convention; staff must verify the original documentation. The synthetic Nairobi midnight-boundary test does not establish the timezone provenance of any real historic encounter.
- After discharge, the existing billing engine uses bed occupancy/night evidence and normal invoice identities. Cash collection uses the existing receipt service, not a second ledger. A payment is marked settled only by that service's normal recording rules; an initiated or externally unverified payment is not proof of settlement.

## Schema and preservation

Migration `0062` adds bed price revision/review metadata; facility policy, stay snapshot, historical review, occupancy and night tables; invoice-line provenance; scope/uniqueness constraints and evidence immutability guards. It removes the former `1500.00` bed-price default and flags existing `1500.00` values for confirmation without changing those values. It does not infer or backfill past occupancy, rates or policies, and does not rewrite historical invoices, payments or audit entries.

Migration `0063` adds the scoped `inpatient_bed_billing_work` marker, its pending index and a one-way staging/retention guard. It does not backfill historical work. Staging the marker is atomic with durable night or review-queue evidence and a stage audit; invoice processing remains separately idempotent.

Migration `0065` was applied on a new synthetic database with all 66 migrations and separately to a populated synthetic database through `0064`. The latter retained all pre-existing columns and rows across 19 inspected clinical, policy, occupancy, invoice, payment, attempt, audit and related table sets, and the legacy policy's new applicability fields remained null. Some inspected sets were empty; this is a synthetic preservation check, not a backup or certification of real data.

A disposable synthetic PostgreSQL upgrade applied migrations 0000–0061, seeded historical examples, then applied 0062. Pre-existing values across nine row sets (wards, beds, admissions, transfers, invoices, invoice lines, payments, billing attempts and audits) compared unchanged apart from added metadata. A `100.00` bed remained confirmed; a `1500.00` bed was flagged; new history tables were empty and old invoice provenance links were null. After separately applying 0063 to that synthetic upgrade, all 13 examined clinical, financial, audit and bed-evidence row sets remained unchanged and no work was inferred. A fresh synthetic database applied all 64 migrations through 0063. These exercises do not certify any real database. Before any future deployment, obtain authorization and backups, review schema/data integrity and lock effects, preserve new evidence on rollback and reconcile existing historical charges separately.

## Verification and outstanding work

All tests below used synthetic data and isolated local PostgreSQL:

### Final 0065 follow-up (2026-11-02)

- **100/100 focused tests passed across 8 files:** 33 inpatient DB/HTTP cases, 9 admission/transfer acceptance, 26 facility-owned billing, 12 invoice/payment acceptance, 5 cutoff policy, 8 policy/recovery UI, 2 admission-readiness UI and 5 API-client cases. They cover missing/inactive/future/expired policy, confirmation and scope, KES 100 with null ward rate, captured policy/price revisions, automatic encounter and permission fallback, patient-facility referrals, wrong/reused encounters, documented history/linking, multi-night transfers, failure rollback, Cleaning, billing/payment retries, invoice finalization, cash receipt and patient attribution. The same 33 inpatient DB tests also passed with the application host timezone set to UTC.
- A new local-only synthetic Chromium smoke (`scripts/synthetic-inpatient-bed-browser.mjs`) passed secure login, facility policy entry, database-timed admission, automatic inpatient encounter, policy and bed-price snapshots, same-day discharge, one invoice line at the configured synthetic KES 100 bed price, Cleaning, cashier cash receipt and patient attribution. It does not exercise a real patient, provider or facility. The script obtains the expected amount from its saved synthetic bed row; KES 100 is a test fixture, not production logic. Idempotent charge and receipt replay, and billing-failure/Cleaning isolation, were checked separately in DB/HTTP tests, not in that browser smoke.
- The final database-required full regression on a separately migrated fresh synthetic database finished with **206 files passed, 4 failed; 1,930 tests passed, 18 failed, 11 skipped; plus one failed suite setup**. The 18 failed tests are in `master-tariffs-workflow.db.spec.ts` (14), `billing-posting.db.spec.ts` (2), and `tariff-validation.db.spec.ts` (2). All 11 skipped tests belong to `clinical-catalogue-selection.db.spec.ts`, whose failed suite setup calls a retired master endpoint; they did not run. Failures include retired endpoint 404s and older pricing expectations, but not all share that cause: one old inpatient test now stops at the newly required `clinical.read` permission, its following transfer test encounters an invalid admission ID, and the older dispensing case encounters the batch/expiry-evidence guard. Those failure modes need review and must not be attributed solely to retired endpoints. This remains a failing release gate; the test failures are not suppressed. The log is `/home/user/bed-policy-full-regression-final.log`.
- Final typecheck, production client and server builds passed. The client build reports an existing large-chunk warning. The final lint passed with **0 errors and 86 warnings** after the browser script adjustments. `git diff --check` and syntax checks for both browser scripts passed. These checks do not prove real-facility correctness.

### Earlier evidence

- Focused inpatient and related checks: **46 passed**, including **14** database/HTTP bed-billing cases and **5** cutoff-policy cases. Tests cover one/multiple cutoffs, same-day and grace, daylight-saving ambiguity, transfers, changed prices, policy snapshots, missing/zero/unconfirmed prices, encounter linking, retry/replay, failed invoice insertion, authorization, isolation, history review, finalization and local payer-mapping safeguards. Three KES 100 nights produced three bed-linked lines and a KES 300 synthetic invoice.
- The final targeted run passed **159 tests across 5 files**. Its updated facility-owned billing regression confirms that a selected KES 60 admission fee remains separate, active bed accrual creates no line, and a KES 100 bed—not a conflicting KES 90 generic ward service—prices the discharge line. It checks patient, encounter, bed, ward, night and snapshot provenance and duplicate replay.
- The latest investigation follow-up passed **202 focused tests across 10 files**, including **23** synthetic inpatient bed-billing DB/HTTP tests, **7** jsdom recovery/policy tests, **9** inpatient acceptance tests and the 107-test schema contract. It explicitly covers KES 100 with a null ward rate, database versus client-supplied times, the manual-time-before-missing-policy precedence, documented admission/discharge review, legacy diagnosis preservation, scoped pagination, concurrent safe recovery, staging/marker/audit/invoice failure injection, no duplicate charge, policy snapshots, transfers and historic price changes. Same-tenant selected-facility mismatch tests deny inspection, review, linking, retry, transfer, discharge and bed release; valid selections work, and release-audit failure rolls back.
- An earlier full database-required Vitest regression had **203 files passed, 4 failed; 1,898 tests passed, 18 failed, 11 skipped**, plus one suite setup failure. The same 18 test names failed in the latest run, but some failure modes changed as described above. The suite is not a passing release gate. No tests were disabled to obtain this result.
- Typecheck and client/server production builds passed. Lint reported **0 errors and 83 warnings**. The dependency install reported 10 moderate vulnerabilities; the client build also reported the existing large-chunk warning.

Still required: authorized real-facility browser, role and usability UAT; broader admission/transfer versus ward retirement/deletion concurrency tests; clinical/financial review of policy and historical edge cases; backup, migration and rollback approval; and an authorized real-facility bed-price discharge invoice with end-to-end verification. Do not mark the inpatient workflow complete until that real invoice is verified. No merge to main or deployment is implied.

## WIP file manifest at verification (2026-11-02)

At verification, relative to `f09522d` on `arena/b6df05ed-afyahub-hmis-kenya`, there were 33 tracked files modified and 12 untracked files. `M` means modified and `??` means untracked at that time. This historical snapshot includes preserved, unfinished booking/dialysis changes as well as inpatient work. Refer to Git for their current commit and working-tree status; no deployment or merge to main is implied.

```text
 M docs/audits/inpatient-bed-occupancy-billing-work-in-progress.md
 M drizzle/meta/_journal.json
 M src/api/client-sprint.client.ts
 M src/api/clients/inpatient.client.ts
 M src/api/clients/patients-clinical.client.ts
 M src/billing/bed-occupancy-charge.ts
 M src/components/modules/BedBillingPolicyPanel.tsx
 M src/components/modules/BedBillingRecovery.tsx
 M src/components/modules/DialysisModule.tsx
 M src/components/modules/InpatientModule.tsx
 M src/components/modules/ReceptionQueueModule.tsx
 M src/db/inpatient-contracts.ts
 M src/db/queries/inpatient.ts
 M src/db/queries/queues.ts
 M src/db/schema.ts
 M src/db/schema/clinical.ts
 M src/db/schema/inpatient.ts
 M src/dialysis/dialysis.service.ts
 M src/inpatient/bed-billing.service.ts
 M src/routes/appointments.routes.ts
 M src/routes/dialysis.routes.ts
 M src/routes/inpatient.routes.ts
 M src/seeds/permissions.ts
 M src/tests/integration/appointments-validation.spec.ts
 M src/tests/integration/facility-owned-billing.db.spec.ts
 M src/tests/integration/inpatient-bed-billing.db.spec.ts
 M src/tests/schema-extraction.spec.ts
 M src/tests/vitest/api-domain-clients.spec.ts
 M src/tests/vitest/client-dialysis.db.spec.ts
 M src/tests/vitest/inpatient-bed-recovery-ui.spec.tsx
 M src/tests/vitest/ui-workflow-regressions.spec.tsx
 M src/types/index.ts
 M src/validation/schemas/appointments.schema.ts
?? docs/audits/patient-booking-dialysis-work-in-progress.md
?? drizzle/0064_staff_appointment_lifecycle.sql
?? drizzle/0065_inpatient_policy_and_admission_evidence.sql
?? scripts/synthetic-appointments-browser.mjs
?? scripts/synthetic-inpatient-bed-browser.mjs
?? src/appointments/appointments.service.ts
?? src/components/modules/AppointmentCategoryManager.tsx
?? src/components/modules/AppointmentDiary.tsx
?? src/db/schema/appointment-booking.ts
?? src/tests/integration/appointment-booking.db.spec.ts
?? src/tests/vitest/appointment-facility-ui.spec.tsx
?? src/tests/vitest/inpatient-admission-readiness.spec.tsx
```
