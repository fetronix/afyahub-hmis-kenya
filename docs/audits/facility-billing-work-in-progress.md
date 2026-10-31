# Facility-based billing: work-in-progress status

This is a development checkpoint, **not a release or deployment approval**. The complete database-required suite does not yet pass. Do not deploy or apply these migrations to production on the strength of this checkpoint.

## Architecture and retained history

The active configuration screen and router use facility-owned services and directly attached facility tariffs. The master catalogue, sync, service mappings, automatic master tariff generation, approval and legacy tariff-management routes have been removed from the active application. Their source files, database tables, references and historical financial records remain; the migrations do not copy or infer historical service selections. Existing invoice, payment, receipt, refund, reversal, ledger and audit records are not deliberately deleted or rewritten.

The service and tariff APIs enforce authenticated facility/tenant scope and facility tariff-management permissions. A service's code is unique within its facility, not globally. Tariffs may be archived without deleting referenced historical invoice lines. The invoice engine still stores a price and source snapshot. Missing, inactive, out-of-date, zero-priced, ambiguous or otherwise invalid configurations do not produce a charge. Clinical work can continue when a price is missing; existing charge attempts remain available for review and retry.

## Clinical connection

* OPD starts without a compulsory consultation-selection modal. An explicitly selected consultation, or the sole active consultation at creation, is persisted; otherwise billing requires review. The consultation is charged on completion, not start.
* The restored OPD investigation workflow retains individual specimen choices for multiple investigations. Laboratory billing uses the investigation's explicitly configured facility service/tariff and occurs after verified completion, not order placement. Free-text/unpriced orders remain clinical records.
* Imaging uses a selected facility examination and charges at reporting. Pharmacy, completed procedures, admissions, occupied bed days and deliveries use the existing invoice engine, with the direct service or exact configured source code as appropriate.
* New admissions persist their selected service identity at creation; existing admissions are deliberately left unselected rather than retrospectively guessed. Encounter request keys use a versioned input fingerprint so retries do not resolve a new service after a catalogue change. Previously stored request hashes are not rewritten.

## Evidence available at this checkpoint

All database and browser fixtures were synthetic and isolated; no production database, live patient data or provider connection was used.

* Additive migrations 0053–0056 applied successfully to a fresh synthetic clone of the 0052 baseline (`/home/user/jali-facility-migration-verify.log`). Historical migration data was retained.
* Ten facility-owned synthetic PostgreSQL/HTTP integration tests passed (`/home/user/jali-facility-test8.log`). They cover scoped service/tariff CRUD and archive, consultation/lab/imaging triggers and retries, missing pricing, a manual invoice, multi-specimen ordering, delivery concurrency, encounter replay after deactivation, admission/bed-day billing, and completed versus unconfirmed procedures.
* A synthetic Chromium journey passed on the preceding 0055 build (`/home/user/jali-facility-browser9.log`): service creation and price editing, OPD/triage, three laboratory specimens, lab results and verification, imaging reporting, consultation completion, and one four-line unpaid KES 575 invoice. It did **not** test the later admission/retry-identity changes, cashier/payment UI, maternity or inpatient UI. Runtime page errors were monitored, but complete console, network and server-log validation was not yet established.
* The earlier charge-concurrency suite passed 13 tests, and the clinical/finalized-invoice suites passed 33 tests. A TypeScript check passed after the admission and billing-review edits. Recent focused test runs passed 56 mock/UI/route/bootstrap cases and 29 tariff unit cases. These are not a substitute for a passing complete suite.
* The latest complete database-required run, before the subsequent focused corrections, reported **31 failed, 1,768 passed, 11 skipped and one unhandled error across 198 files** (`/home/user/jali-facility-full-tests-2.log`). Several failures were subsequently addressed and their focused suites passed (generated-build bootstrap precondition, delivery mock, private-insurance mock, route inventory and direct-resolver source assertions). The complete suite has **not** been rerun after those corrections. Other failing suites still expect the retired master catalogue, selection, approval, linking, tariff-validation and import endpoints. They need meaningful architecture-aware replacement while preserving their financial, authorization and clinical assertions; do not skip or weaken them merely to obtain a green result.

## Known limitations and required follow-up

1. Procedure insertion and billing are separate; retrying a procedure creation request can create a second clinical source ID. A durable, idempotent procedure-creation/billing workflow requires further design and real database concurrency testing.
2. A delivery currently has no encounter reference in its schema; its invoice can therefore have a null encounter association. Its API concurrency behavior has been tested, but the delivery UI has not.
3. Historical admission and other records without an explicit direct service require controlled review; do not infer or silently backfill selections or prices. Historical master links and financial snapshots must remain intact.
4. The most recent code needs a fresh full database-required test run, migration verification from a brand-new isolated database, lint, client/server builds, cashier/payment browser exercise, and sanitized browser console/network/server-log review. The inpatient, delivery, procedure and other departmental workflows also need broader real UI and concurrency validation.
5. No production migration, merge, deployment, live claims/payment, real facility price import or clinical acceptance has been performed. Facility and clinical owners must review configured prices, units, effective dates, completed-service triggers and workflows before any release.
