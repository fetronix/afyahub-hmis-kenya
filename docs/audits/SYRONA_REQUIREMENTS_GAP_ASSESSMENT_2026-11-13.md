# Syrona Medical Center — Requirements Gap Assessment

**Scope:** evidence-based assessment of the current JaliCare HMIS source tree against the
Syrona Medical Center requirement list supplied with the assessment request.

**Assessment date:** 2026-11-13
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`
**Repository:** `fetronix/afyahub-hmis-kenya`

**This document is an assessment only.** No feature was implemented, no source file was
modified for behaviour, and no commit was made. The only file created is this report.

---

## 0. Method and limits — read this before any status below

### 0.1 What was inspected

| Activity | Detail |
| --- | --- |
| Full repository tree | 546 non-test TypeScript/TSX files, 232,953 LOC under `src/` |
| Database schema | 234 `pgTable` definitions across 44 schema modules; 90 SQL migrations on disk matching 90 journal entries |
| HTTP surface | 644 route declarations across 64 files, mounted via `src/routes/index.ts` |
| UI surface | 62 module components at the top level of `src/components/modules` (90 `.tsx` files including sub-folders), plus 3 stale `PlatformAdministrationModule.tsx.catalogue-fix-*` backup files |
| Test suite executed | `npx vitest run` — **2,673 tests / 287 files: 1,898 passed, 4 failed, 771 skipped** (307.9 s) |
| Static analysis | `tsc --noEmit` — 0 errors; `eslint .` — 0 errors, 102 warnings |
| Documents | `docs/`, `README.md`, `SECURITY.md`, `reportfidelis.md`, `.github/workflows/ci.yml` |

### 0.2 What could **not** be executed, and why that limits the conclusion

**No PostgreSQL server and no Docker were available in this assessment environment**
(`pg` unreachable on 127.0.0.1:5432, no `postgres`/`psql`/`pg_dump` binary, no Docker daemon).
The suite runs 141 `*.db.spec.ts` files that require a live database; they self-skip, producing
the **771 skipped** tests.

Consequences, stated plainly:

- Every status below that rests only on database-backed assertions is marked in the Evidence
  column **“not executed here”**. The specs exist and CI runs them against
  `postgres:16`, but *this assessment did not observe them pass*. They are evidence that the
  behaviour is *tested*, not evidence that it *works in this checkout today*.
- The 4 failures observed are all schema-contract assertions, and all are caused by uncommitted
  working-tree changes (see §9.1). They are not Syrona requirement failures, but they mean the
  tree in its present state is **not green**.
- No external provider (SHA/DHA, Britam, NCBA, Equity, Safaricom) was contacted. No claim,
  payment, statement or settlement was produced or verified.

### 0.3 The client's requirement document is not in the repository

`grep -ri syrona` over the whole tree returns **no matches**. There is no Syrona requirements note,
no client requirement register and no client phase plan in the codebase. Therefore:

- The requirement list assessed here is the one supplied in the task brief.
- **“Three-phase implementation” and “confirmed Phase 1 scope” cannot be verified against a
  client document** — the repository contains a *different* phase taxonomy (`docs/project/
  completion-phases/PHASE-1..6`), which is an internal engineering sequence, not the Syrona one.
  See §4.

---

## 1. Branch, commit and working-tree condition

### 1.1 Git position

| Item | Value |
| --- | --- |
| Current branch | `arena/e088f11d-afyahub-hmis-kenya` |
| Local `HEAD` | `0111b55` — *“docs: record what shipped after the engineering report was written”* |
| Remote branch head | `origin/arena/e088f11d-afyahub-hmis-kenya` = `4cdbc93` |
| Local vs remote | HEAD is an **ancestor** of the remote head; the remote is **50 commits ahead** |
| `git diff` vs remote | `860 files changed, 14 insertions(+), 265,312 deletions(-)` — **do not read this as lost features.** `git diff` only sees *tracked* files; most of the product is untracked on disk here, so it looks deleted. The blob audit below is the truthful comparison |
| Reflog | 2 entries only: `clone` → `63903c5`, then `checkout` `main` → this branch, landing on `0111b55` |
| Local object availability | The 50 later commits (`6b744f7`, `81a7552`, `4cdbc93`, …) were **not** present as local objects before the fetch performed for this assessment |

**What this means.** The sandbox clone was created from `main` and checked out at `0111b55`.
It does **not** contain the git history that was pushed to the remote branch (`4cdbc93` and its
ancestors). The *working tree* nevertheless contains all of that work, written to disk by this
session. A file-level audit against the remote tree confirms this:

| Audit | Result |
| --- | --- |
| Blobs in `origin/…/4cdbc93` | 1,217 |
| Present on disk, byte-identical | **1,206** |
| Present but differing | 11 |
| Absent from disk | **0** |

The 11 differing files are the most recent work items (the claim-invoice gate / source-ledger
coverage pair, and the dialysis client sprint) plus their tests:
`drizzle/meta/_journal.json`, `src/api/client-sprint.client.ts`,
`src/components/modules/AccountingModule.tsx`, `src/db/schema/private-insurance.ts`,
`src/db/schema/sha-claims.ts`, `src/insurance/claims/private-claims.service.ts`,
`src/insurance/eclaims/claims-workflow.service.ts`, `src/routes/accounting.routes.ts`,
`src/tests/integration/billing-posting.db.spec.ts`, `src/tests/vitest/private-insurance.db.spec.ts`,
`src/tests/vitest/sha-eclaims.db.spec.ts`.

### 1.2 Inherited session work that must not be lost

The following exist **only as uncommitted working-tree content on this branch** and are not
represented by a local commit:

| Path | Lines | State |
| --- | --- | --- |
| `src/insurance/core/claim-invoice-gate.ts` | 166 | Untracked — claims must cite a finalized invoice |
| `drizzle/0088_claim_invoice_finalization.sql` | 52 | Untracked — `invoice_finalized_at` / `invoice_snapshot` on both claim tables |
| `src/accounting/source-ledger-coverage.service.ts` | 330 | Untracked — source-to-ledger coverage by activity date |
| `src/tests/vitest/source-ledger-coverage-ui.spec.tsx` | 204 | Untracked |
| `drizzle/0089_facility_letterheads.sql` | 197 | **Untracked and unverified** — facility letterhead versions; the migration has never been applied in this environment |
| `src/db/schema/facility-branding.ts` | 81 | **Untracked**, not exported from `src/db/schema.ts`, no service, no route, no UI, no test |
| `docs/PHASE_A3_CHECKPOINT.md` | 35 | Untracked checkpoint |

`drizzle/meta/_journal.json` on disk has **90 entries and idx 89 = `0089_facility_letterheads`**,
so the journal already points at a migration that no verified run has executed.

### 1.3 Working-tree condition

| Metric | Value |
| --- | --- |
| Modified tracked files | 149 |
| Deleted tracked file | 1 — `src/tests/auth-api.test.ts` |
| Untracked files/directories | 493 before this report, 494 including it |
| Net diff vs local `HEAD` | effectively the entire product (HEAD predates almost all of it) |

The untracked set includes the 0043–0089 migrations, the whole `src/insurance/`, `src/payment-hub/`,
`src/procurement/`, `src/reporting/` report-centre, `src/workforce/`, `src/dialysis/` and
`src/routes/accounting.routes.ts` — i.e. **most of the system under assessment is untracked in
this clone**.

**Do not run `git checkout .`, `git clean`, `git reset --hard` or any branch switch here.**
The remote branch `4cdbc93` is the only durable record of this work; the local `HEAD` is stale by
hundreds of files.

---

## 2. Requirements matrix

Status vocabulary (as instructed): **COMPLETE** — implementation and relevant tests provide
sufficient evidence; **PARTIAL** — some functionality exists but important requirements remain;
**MISSING** — no sufficient implementation found; **BLOCKED** — depends on credentials, client
decisions, external approval or infrastructure; **UNVERIFIED** — insufficient evidence.

### 2.1 Platform and front office

| # | Requirement | Existing module | Implementation status | Evidence | Outstanding work | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Unified online HMIS and facility administration** | Single Express/TypeScript API + React/Vite SPA on PostgreSQL/Drizzle: `src/app.ts`, `server.ts`, `src/routes/index.ts`, `src/components/modules` (62 top-level modules), `src/routes/platform/*` (tenants, facilities, onboarding, RBAC, invitations, subscriptions) | **COMPLETE** | 644 route declarations in 64 files; 22 facility modules registered in `src/config/facility-modules.ts` (the middleware type knows 23), enforced server-side by `requireFacilityModule` (`src/middleware/facility-module.middleware.ts`) — 19 distinct module ids currently appear in an explicit guard; `route-inventory.spec.ts` walks the real Express app and asserts 27 domain anchors — **27 passed**; `route-scope.spec.ts`, `facility-modules.spec.ts` pass | Production instance, TLS, DNS and client acceptance are separate items (see #22). Client branding/letterhead is not on documents (#11) | Client hosting account; see #22 |
| 2 | **Reception and patient registration** | `src/routes/domains/patients.routes.ts` (list, audited `directory-page`, get, create, update), `src/db/queries/patients.ts` (`nextPatientMrn`, `createPatientScoped`), `src/routes/queues.routes.ts` (3 endpoints), `src/routes/appointments.routes.ts`, `PatientRegistrationModule.tsx`, `ReceptionQueueModule.tsx` | **COMPLETE** | Server-allocated MRN `MRN-<year>-<6 digits>` with a global unique index (the browser no longer mints IDs); `patient_mrn_allocation.db.spec.ts` present; `phase2-patient-directory.db.spec.ts` present (audited directory page); `patient-registration-birth-date.spec.tsx` — **15 passed**; `phase2-patient-directory-ui.spec.tsx` — **6 passed** | MRN allocation DB spec **not executed here** (no PostgreSQL). Reception is queue-based; no printed encounter/registration slip | — |
| 3 | **Unique patient identification and duplicate detection** | MRN unique index; `patients.national_id` + blind index; `merged_into_patient_id` column; client-side pre-registration check in `PatientRegistrationModule.tsx` (`exactMatch: 'nationalId' \| 'phone'`) | **PARTIAL** | MRN allocation and uniqueness: implemented and tested at DB level. Duplicate detection exists **only in the browser** — a 300 ms debounce calling `getPatientDirectoryPage` with an exact national-ID or phone match, then a “possible existing record” warning plus an acknowledgement checkbox. **There is no server-side duplicate rule, no national-ID uniqueness constraint, and no merge workflow**: `merged_into_patient_id` is referenced by exactly one query (`consent.service.ts` excludes merged rows) and by nothing else in `src/` or `drizzle/` | Server-side duplicate policy; national-ID uniqueness per tenant; a controlled merge with audit, redirect of historical rows and consent/allergy reconciliation; fuzzy/inter-facility matching; DHA Client Registry cross-check | **Client decision**: which identifiers are mandatory and whether two patients may share a phone/ID (guardians, minors). DHA/DHA CR integration if cross-facility identity is required |
| 4 | **OPD and clinical records** | `src/routes/domains/encounters.routes.ts` (create, list, `consultation-selection`, get), `src/routes/diagnoses.routes.ts` (diagnoses + `/api/procedures`, 4 endpoints), `src/routes/vitals.routes.ts` (`/api/observations`, 2 endpoints), `OutpatientModule.tsx`, `AddClinicalService.tsx`, `EncounterBillingView.tsx` | **PARTIAL** | Encounter → diagnosis → procedure → observation → charge chain exists with facility-scoped writes and idempotency keys (migrations 0046–0050); `outpatient-safety-ui.spec.tsx` — **19 passed**; `clinical-workflows-acceptance.db.spec.ts`, `diagnosis-patient-link.db.spec.ts` present but **not executed here**. The repo's own register states the outstanding item as “verified patient/encounter association, clinical history, **completed-vs-unperformed care**” (`PHASE-1-4-OUTSTANDING-REGISTER.md`, Phase 2) | Signed/closed consultation, clinician sign-off with time-of-signature, “not performed” disposition, OPD queue↔encounter linkage audit, clinical UAT | Facility workflow confirmation (which OPD paths are mandatory); clinician accounts |
| 5 | **Medical history, diagnoses, prescriptions and allergies** | `src/clinical/consent.service.ts`; `patient_allergies` table + `/api/patients/:id/allergies`, `…/allergies/:allergyId`, `…/allergies/check` in `src/clinical/clinical-records.routes.ts`; `medications.routes.ts` (`/api/medications`, `/api/medications/:id/status`); `PatientJourneyModal.tsx` aggregates encounters, observations, diagnoses, medications, lab orders, lab results, invoices and FHIR patient | **PARTIAL** | Allergies are a first-class register with status/severity and an interaction-style `check` endpoint; diagnoses carry ICD-10 and ICD-11 columns; medications carry a status lifecycle with `medication_status_events`; `consent-allergy.spec.ts` and `PatientConsentAllergyPanel.tsx` exist and pass. **No longitudinal problem list and no structured medical/surgical/family/social history record** exists — `patients.allergies` free-text is legacy and a new table supersedes it. History is a client-side fan-out of seven endpoints, not a server-side clinical summary | Structured problem list; medical/surgical/family/social history; immunisation linkage in the same view; server-side longitudinal summary with access audit; prescription↔dispensation reconciliation view | Clinical content model sign-off (which history fields Syrona requires) |
| 6 | **Signed forms, consent documents and radiology requests** | `patient_consents` + `src/clinical/consent.service.ts` (grant/revoke/expire, `hasActiveConsent`); radiology requests `POST /api/radiology-orders` with idempotency (migration 0049); attachment tables: `insurance_preauthorization_attachments`, `referral_documents`, `facility_documents`, `hr_employee_documents` | **PARTIAL** | Consent is a real lifecycle: purposes (TREATMENT, SHARING_WITH_FACILITY/INSURER, RESEARCH, TEACHING), methods (WRITTEN, VERBAL_WITNESSED, ELECTRONIC), revocation with reason, expiry enforced on read. Radiology *requests* are implemented and idempotent. **However every “document” in the system is a reference only**: `addPrivatePreauthAttachment` requires `fileName` + `storageReference` and stores a checksum — it writes no bytes; `express.json({ limit: '1mb' })` is the only body parser and there is **no upload endpoint, no object store and no e-signature capture anywhere in `src/`** (`grep` for `multer`, `S3`, `minio`, `writeFile` returns nothing relevant). Consent also **does not gate clinical reads** — the service header states this explicitly | File upload + storage (with virus/type/size checks, private access, retention); signed-form templates; e-signature or wet-signature scan capture; consent enforcement policy per access path; printable consent form | **Client decision**: signature model (electronic vs scanned wet signature) and consent enforcement policy (emergency override) |
| 7 | **Laboratory workflows and reports** | `src/routes/laboratory.routes.ts` (9 endpoints), `src/db/queries/laboratory.ts`, `lab-specimens` schema table, `LaboratoryModule.tsx`, `ReviewedLabSpecimens.tsx` | **PARTIAL** | A genuine state machine: `Ordered` → `Sample Collected` (accession number required) → `Pending Verification` → `Verified` (verifier + timestamp, conditional update so a double-verify fails) → `Completed` (all results verified, then billing is staged). Collections reject a specimen that was not collected, and billing fires only on completion. `laboratory-safety-ui.spec.tsx` passes; `laboratory-facility-identity.db.spec.ts`, `laboratory-migration.db.spec.ts`, `laboratory-write-validation.spec.ts` (11 passed) exist. **Missing**: result amendment with version history, critical-value flag/escalation workflow, released-to-patient state, and a printable laboratory report (`printables-laboratory-reports` → `engine: null`) | Amendment trail; critical/panic-value alerting to the requesting clinician; report template with facility letterhead; reference ranges per analyser; interfacing with lab analysers (HL7/ASTM) | Reference-range and critical-limit source per test (Syrona laboratory SOP); analyser interface documentation |
| 8 | **Pharmacy inventory, dispensing and usage** | `src/routes/pharmacy.routes.ts` (10 endpoints incl. `/api/pharmacy/dispense`, `/api/pharmacy/dispense/status`), `inventory.service.ts` (`dispenseFefoScoped`), `inventory-control.routes.ts` (movements, adjustments, stock counts, transfers, reorder alerts, valuation), `PharmacyModule.tsx` | **PARTIAL** | Dispensing is FEFO inside a transaction with batch rows locked (two tills cannot take the last strip; an expired lot is never issued), writes `pharmacy_dispense_requests` + allocations, snapshots selling price/code/name/unit/date/timezone onto the dispensation, appends a `DISPENSE` stock movement, posts the consumption journal from the lots actually consumed, and stages billing through the durable `billing_charge_attempts` outbox. `pharmacy-batches.spec.ts` (10), `pharmacy-retry-ui.spec.tsx` (7), `pharmacy-inventory-billing.db.spec.ts` all present. **Missing**: ward/departmental issue — `CONSUMPTION` movements are produced only by dispensing; there is no “issue to ward” endpoint and no per-store balance (see #14); no dispensing↔prescription completeness report | Ward/unit issue and requisition; per-store balances; prescription fill/partial-fill reconciliation; drug-usage report by department | Syrona stock-location model (main store, pharmacy, wards) and which users issue stock |
| 9 | **Radiology workflows** | `src/routes/radiology.routes.ts` — 3 endpoints: `POST /api/radiology-orders`, `GET /api/radiology-orders`, `PUT /api/radiology-orders/:id/report`; `RadiologyModule.tsx` | **PARTIAL** | Request creation is idempotent and explicitly refuses to claim the study was performed (`“Requesting a study does not establish that it was performed”`, `billing: null`). Report writing captures findings and impression with a reporting user. **Missing**: report verification/approval by a second reader, study status lifecycle (scheduled → performed → reported → verified), modality worklist, DICOM/PACS or image storage (none exists), and a printable radiology report (`printables-radiology-reports` → `engine: null`) | Radiologist verification step; study lifecycle; report template; image/PACS integration; radiation-dose and contrast documentation | **Client decision**: whether imaging is in-house or outsourced; PACS vendor and DICOM endpoint. PACS connectivity is **not** claimed and cannot be claimed without provider-side testing |
| 10 | **Inpatient admissions, bed management and billing** | `src/routes/inpatient.routes.ts` — **29 endpoints** (wards, beds, bed status/release, admissions, discharge, transfer, transfers list, `accrue-bed-days`, `bed-occupancy`, `bed-billing-encounter`, `bed-history-review`, `bed-billing-retry`, `/inpatient/board`, bed-billing policy, vitals, nursing notes/handover); `src/inpatient/` (5 modules, 2,703 LOC) incl. `bed-night-policy.ts`, `bed-rate.ts`, `bed-evidence.ts`, `bed-billing.service.ts` | **COMPLETE** | Bed-night charging is a real, tested policy: per-facility timezone, cutoff minutes, grace minutes, `sameDayRule` ONE/ZERO, DST-safe wall-clock calculation, per-night rate snapshot tied to an occupancy row, plus a recovery/retry path for unresolved bed billing. Tests: `inpatient-bed-night-policy.spec.ts` (5), `inpatient-bed-rate.spec.ts` (9), `ward-billing.spec.ts` (9), `inpatient-domain.spec.ts` (6), `inpatient-router.spec.ts` (7), `inpatient-admission-readiness.spec.tsx`, `inpatient-bed-recovery-ui.spec.tsx` (8); DB specs `inpatient-acceptance`, `inpatient-bed-billing`, `inpatient-migration` present but **not executed here** | Nursing/clinical sign-off for the discharge summary; bed-cleaning state independent of billing (documented outstanding); occupancy reporting to MOH 301 (printable) | — |
| 11 | **Invoices, receipts and local billing** | `src/routes/billing.routes.ts` (invoice create, items, get, `finalization`, `finalize`, `print-access`, payment attribution, `void`); `src/routes/domains/invoices.routes.ts` (payments, refund requests + decisions, refunds); `src/billing/` (31 modules, 13,725 LOC); `FinalizedInvoicePanel.tsx`, `BillingCashierModule.tsx`, `RefundsPanel.tsx`, `RefundRequestWorkflow.tsx` | **PARTIAL** | Strong financial core: facility-owned tariffs only, invoice finalization freezes lines + responsibility split + a JSON snapshot (PostgreSQL triggers in `drizzle/0037_finalized_invoices.sql` reject UPDATE/DELETE on finalized invoices, their items and their attributions), payments require idempotency and party attribution on a finalized invoice, over-collection becomes a liability not a negative balance, refunds need independent approval, voids are audit-preserving and refused once paid. `finalized-invoice-ui.spec.tsx`, `billing-cashier-ui.spec.tsx`, `refund-ui.spec.tsx`, `phase3b-refund-workflow-ui.spec.tsx` pass. **Missing (material for Syrona)**: (a) **no printable receipt at all** — `printables-receipts` dependency = “Standalone receipt print template”, and no `window.print()` exists in the cashier module; (b) **no server-rendered invoice PDF** — “print” is `window.print()` of a React view (`FinalizedInvoicePanel.print()`), audited but browser-dependent; (c) **no facility letterhead** on any document | Receipt template (thermal/A4); server-side invoice PDF; letterhead/branding; credit notes and waivers as first-class documents; statement of account | Facility-brand design assets and a client-approved document layout; see #22 for hosting-driven print routing |
| 12 | **Financial reporting and revenue tracking** | `src/accounting/` (10 modules, 4,858 LOC: chart of accounts, journals, periods, posting/reversal, bank statement import & reconciliation, GL tie-out, source-ledger coverage); `src/reporting/report-catalogue.ts` (151 entries), `report-centre.*` (19 executable engines), `ReportsModule.tsx`, `FinancialTransactionsPanel.tsx` | **PARTIAL** | Real double-entry: balanced/idempotent journals, period control, reversal-not-mutation, immutable `accounting_billing_postings` bridge, subledger→GL tie-out that reports differences instead of netting them, and source coverage by activity date. Trial balance, income statement, balance sheet, patient outstanding, refunds, cashier receipts and inventory/stock reports are executable. `report-centre-ui.spec.tsx` (16), `report-centre-export.spec.ts`, `report-centre-invoice-ui.spec.tsx` (7), `billing-gl-reconciliation-ui.spec.tsx` pass. **The catalogue is candid: of 151 requested reports only 23 are wired to an engine and 121 are explicitly `engine: null`**, including department receipt summary/breakdown, managerial daily summary, monthly P&L, cash flow, budget, credit notes, waivers, income by cashier, departmental revenue, SHA and private-insurer receivables, M-Pesa and card reconciliation, and all MOH returns | The 121 unbuilt/unwired reports; receivable ageing; revenue-vs-cash distinction surfaced in the UI; **MOH 705/705A/705B/717/301/204/240 and MOH financial reports** (all `engine: null`) | **Client** must supply the Excel workbooks/format definitions (see §6); **MOH** must supply current authoritative forms and indicator dictionaries before any return can be generated |
| 13 | **Procurement, LPOs and GRNs** | `src/procurement/` (6 modules, 3,752 LOC: requisitions, orders, receiving, matching, returns, order items); `src/routes/procurement.routes.ts` (10) + `procurement-workflow.routes.ts` (24); `ProcurementModule.tsx`, `procurement/*` components | **PARTIAL** | A real chain: requisition → purchase order (unique `po_number`, approval state) → goods received note (`grn_number` required, idempotency key, reversal-aware) → stock movements → three-way matching → supplier returns. `procurement-workflow.spec.tsx` (11), `procurement-order-items.spec.ts` (11), `procurement-suppliers.spec.tsx` (17), `procurement-matching-returns.spec.tsx` (7), `procurement-rbac.spec.ts` pass; `BATCH-E-PROCUREMENT-MATCHING-REPORT.md` documents the design. **Missing**: an LPO *document* — `printables-local-purchase-orders` and `printables-goods-received-notes` are `engine: null`, so a PO/GRN cannot be issued on paper; no supplier invoice record or payment run (accounts payable is absent) | LPO/GRN print templates; supplier invoice capture and payment; commitment accounting | Syrona procurement approval thresholds and signatory list |
| 14 | **Inventory and supply contracts** | `src/inventory/` (5 modules, 4,328 LOC), `inventoryItems`, `inventoryBatches`, `inventoryMovements`, stock counts, transfers, `inventory-accounting` policy + posting + reconciliation; `InventoryModule.tsx` | **PARTIAL** | Items, batches with expiry, FEFO enforcement, adjustments with reason codes, write-offs, stock counts with variance posting, valuation, reorder alerts, movement ledger with `stock_after`, and an inventory accounting policy that posts consumption/write-off/variance only when the facility sets one. Tests: `inventory-selling-price-ui.spec.tsx` (8), `inventory-accounting-errors.db.spec.ts` (11 passed), `inventory-accounting-posting.db.spec.ts`, `inventory-stock-count.db.spec.ts`, `inventory-receipt-cost.db.spec.ts` present. **Two structural gaps**: (a) **no supply contracts** — the `suppliers` table has only `name, contactPerson, phone, email, kraPin, address, isActive` (plus tenancy and timestamps); there is no contract, framework agreement, price-list validity or payment-terms field anywhere in `src/`. (The file `src/inventory/inventory-contracts.ts` is about batch expiry and FEFO allocation, not supplier agreements — the name misleads); (b) **stores are labels, not entities** — `inventory_items.store_location` is one free-text field per item (default `'Main Pharmacy Store'`), there is no stores table and no per-store holding balance; `createTransfer` (`stock-control.service.ts:745–832`) leaves the *facility* total unchanged, writes both legs with `stockAfter: item.currentStock`, and updates neither `current_stock` nor `store_location`. The by-store report (`stock-goods-inventory-by-store`) groups on that label, so it reports home locations rather than holdings | Supplier contract register (dates, prices, terms, renewal alerts); real per-store balances; store requisition and issue; supplier performance | Syrona's actual supplier contracts/price agreements; decision on store model |
| 15 | **Fixed assets and depreciation** | `src/assets/fixed-assets.service.ts` (~1,900 LOC), `src/assets/depreciation.ts`, `src/routes/fixed-assets.routes.ts` (22 endpoints), `assets.ts` schema, `FixedAssetsModule.tsx` | **COMPLETE** | Categories, asset register, acquisition, transfer, maintenance, depreciation preview and run, disposal, impairment, revaluation, register report and depreciation history, all posted to the ledger; tax rates are facility-configured rows that **carry an `authorityReference`** and the service refuses to compute an allowance with no covering rate (no invented Kenyan rates). `fixed-asset-depreciation.spec.ts` (15), `fixed-assets-ui.spec.tsx` (6); DB specs `fixed-assets.db.spec.ts`, `fixed-asset-impairment.db.spec.ts` present but **not executed here** | Asset physical verification/tagging exports; depreciation policy values and useful lives | **Client/consultant decision**: useful lives and depreciation policy per asset class (the system deliberately contains none) |
| 16 | **Role-based access control** | `src/seeds/permissions.ts` (**187 permission codes**), `src/auth/staff-role-catalogue.ts`, `staff-role-policy.ts`, `src/routes/platform/rbac.routes.ts`, `src/auth/staff-roles/*`, `FacilityRbacEditor.tsx`, `StaffRolesPanel.tsx`, `StaffInvitationsPanel.tsx` | **COMPLETE** | Permissions are checked at the API (`requirePermission` / `requireAnyPermission`), not merely hidden in the UI; tenant/facility scope resolution is centralised (`src/auth/scope.service.ts`, held at **100 % coverage** by a threshold); SUPER_ADMIN cannot be assigned by a facility admin; facility roles are edited within a policy that prevents self-escalation; module gating is server-side. `authorization.spec.ts`, `staff-roles.spec.ts` (10), `staff-role-catalogue.spec.ts`, `permission-catalogue-integrity.spec.ts`, `permission-seed.db.spec.ts`, `route-scope.spec.ts` pass. **Caveat:** RBAC says *who may act*; **MFA is not implemented** — see #17 | MFA challenge/session flow; periodic access review report; segregation-of-duties matrix sign-off | **Client decision**: role names and which staff hold which role at Syrona; whether MFA is mandatory for all staff or only privileged roles |
| 17 | **Backups and security documentation** | `scripts/backup/` — `backup-lib.mjs`, `db-backup.mjs`, `db-restore.mjs`, `db-verify.mjs`, `restore-drill.mjs`, `engines.mjs`; npm scripts `db:backup`, `db:backup:verify`, `db:restore`, `db:restore:drill`; `docs/deployment/operations-runbook.md`, `SECURITY.md`, `docs/security/DATA-EXPOSURE.md` | **PARTIAL** | Backup is encrypted, checksummed, manifest-writing, retention-applying and **exits non-zero on any failure**; the restore drill restores into a *separate* database and compares **every table row-for-row** against the source (counts catch truncation, content hashes catch misplaced rows), never touching the source. `backup-lib.spec.ts` (16 passed). The runbook is unusually honest: alert delivery **not implemented**, log shipping/retention **not implemented**, metrics scraping **not implemented**, and no production drill has been performed. **MFA**: `auth.service.ts:393–440` detects `mfaRequired`/`mfaEnabled` and then **refuses to create a session**, returning `requiresMfa: true` — but **no challenge endpoint exists**, so such a user can never complete login. (The unused `login.service.ts:328` would instead hand out a session when `mfaEnabled` is true — see §4.6.) | Run a restore drill against the Syrona deployment; backup scheduling and off-site storage; MFA challenge flow (enrolment, recovery codes, reset); alerting and log retention; an independent security review | **Infrastructure**: backup destination, retention policy and encryption-key custody belong to the client. **Client decision**: MFA rollout scope |
| 18 | **Insurance eligibility, benefit verification and claims** | `src/insurance/` (35 modules, 19,545 LOC): `eclaims/` (eligibility, benefits, preauthorization, claims-workflow, remittance, configuration), `claims/` (private), `eligibility/`, `benefits/`, `preauthorization/`, `remittance/`, `hub/`, `payers/`; `InsuranceClaimsModule.tsx`, `PrivateInsuranceModule`, payer-hub screens; five payer adapters plus a manual one | **PARTIAL** | A complete *local* claim lifecycle: eligibility verification with nine accepted identifiers and an honest outcome set (Eligible / Ineligible / Pending / Unable to verify / Manual review), benefit validation, preauthorisation with scope locking and audited amendment, claim prepare → validate → submit → reject → resubmit → adjudicate, remittance advice import and reconciliation that **links an independently recorded receipt**. Claims now require a **finalized invoice** and record its snapshot (`0088`). Tests: `sha-eclaims.spec.ts` (24), `private-claims-validation.spec.ts` (16), `private-insurance.spec.ts` (12), `sha-eligibility-parser.spec.ts` (8), `sha-claims.spec.ts`, `sha-remittances.spec.ts`, `claim-dispatch-review-ui.spec.tsx` (10), `claim-evidence-ui.spec.tsx`; DB specs `sha-eclaims.db.spec.ts` and `private-insurance.db.spec.ts` exist but **were not executed here**. **All external transport is blocked by design** (`SHA_MODE` defaults to `mock`; production needs `SHA_ALLOW_PRODUCTION=true` **and** explicit HTTPS URLs; gateway health reports `enabled: false, verified: false`; `callbackVerification: 'NOT_ESTABLISHED'`) | Live eligibility, claim submission and remittance for each payer; callback authentication; conformance testing with SHA | **Credentials and approvals**: SHA/DHA onboarding, facility registry code, API contract, sandbox access. **Client decision**: which payer contracts are signed |
| 19 | **Britam integration** | `src/insurance/payers/britam.adapter.ts` (`britam_direct`); Britam member policies, mappings, benefit rules, preauth and claim records in `private-insurance` | **BLOCKED** | The adapter is deliberately **unsupported**: its header states no documented Britam direct API specification exists in the repository and it will not invent URLs, scopes or payloads. Operations return an explicit unsupported result listing six onboarding items (provider identification, official interface specification, sandbox/production addresses, credential provisioning, tariff/scheme rules, written confirmation of direct vs gateway routing). **The manual Britam workflow does work**: `private-insurance.db.spec.ts` exercises Britam end-to-end synthetically (member, mapping, preauth, claim, adjudication, remittance reconciliation) — but that spec **did not run here** | Obtain Britam's signed contract, provider ID, API specification, sandbox access and callback contract; then implement and conformance-test transport | **Britam** must supply the interface specification and sandbox credentials. Nothing in the repo substitutes for this |
| 20 | **NCBA and Equity integration** | `src/payment-hub/adapters/banks.ts`; `FacilityPaymentIntegrations.tsx`; payment-hub provider registry | **BLOCKED** | **NCBA** is a fail-closed stub: `implementedCapabilities: []`, `productionReady: false`, note *“NCBA API contract, authentication and sandbox access not yet verified.”* **Equity (Jenga)** implements a **sandbox token check only** (`https://uat.finserve.africa/authentication/api/v3/authenticate/merchant`); its descriptor states *“Jenga sandbox authentication only; account access, statements, transfers, callbacks and production are not implemented or verified.”* No statement import, no payment initiation, no verified callback | NCBA: official contract and sandbox. Equity: account/statement/transfer endpoints, callbacks, production approval. Both: sandbox conformance test, then production | **Bank contracts, sandbox credentials and callback specifications.** A token exchange is not account access and must not be presented as integration |
| 21 | **Safaricom integration status** | `src/payment-hub/adapters/daraja.ts` (M-Pesa Daraja); `payment-hub/routes.ts`, `webhook.routes.ts`; `payment-lifecycle.ts`; `M_PESA`/`MPESA_DARAJA` references in billing and reporting | **PARTIAL** | Implemented against Safaricom's published reference: credentials validated strictly (no trimming, no control characters), sandbox base URL, `PAYMENT_COLLECTION`, `PAYMENT_STATUS` and `HEALTH` capabilities, with **mock-tested** request/response handling. Descriptor is explicit: `sandboxOnly: true`, `productionReady: false`, *“Sandbox OAuth and status only; **callback verification is unavailable and deliveries are rejected**. Production is blocked.”* `payment-hub.spec.ts` (8), `payment-hub.db.spec.ts`, `payment-hub-collection-ui.spec.tsx` (11), `payment-hub-ui.spec.tsx` (9), `mpesa-phase-1-audit-2026-11-06.md`, `mpesa-settlement-hardening-2026-11-06.md` | Real sandbox test with Syrona's shortcode; callback signature verification; production activation and approval; STK push reconciliation against bank/statement; settlement proof | **Safaricom**: PayBill/till number, passkey, consumer key/secret, callback URL approval. **Client decision**: whether collections are PayBill or Buy Goods, and who owns the shortcode |
| 22 | **Hosting and deployment arrangements** | `Dockerfile`, `docker-compose.yml`, `docker-compose.test.yml`, `.github/workflows/ci.yml`, `docs/deployment/truehost-cpanel.md`, `docs/deployment/operations-runbook.md`, `scripts/deploy-artifacts.mjs`, `scripts/verify-dry-run.mjs`; `GET /api/health`, `GET /api/ready`, `GET /api/ops/status` | **PARTIAL** | CI builds the production bundle and **starts it**, then asserts `/api/health` answers and the SPA returns **200** (with an explicit failure branch — the workflow documents that the previous version could not fail). `deploy:verify` checks the artifact set including journal/file consistency; `verify-dry-run` proves the migration runner issues only `SELECT` without a database. The operations runbook is accurate about what it is not. **No production host exists**: the runbook states nothing has been exercised on a production host because none was available; the Dockerfile has never been built or run in this environment | Actual provisioning (Truehost cPanel or container), TLS, DNS, database sizing, backup destination, secret/key custody, go-live rehearsal, monitoring | **Client hosting account**, domain, TLS certificate, database provisioning. **Client decision**: Truehost cPanel vs a container host |
| 23 | **Tax requirements and outstanding consultant decisions** | `src/workforce/payroll-calculator.ts` (statutory engine), `workforce` statutory versions with `authority` + `sourceReference`, `fixed_asset_tax_rates` with `authorityReference`; accounting chart of accounts | **BLOCKED** | The engine is deliberately **rate-free**: *“The engine contains no Kenyan statutory figures. Every rate, band, ceiling and relief arrives from a facility-configured, effective-dated version whose `sourceReference` records the authority's publication. If any of the four statutes lacks a version that covers the pay date, `calculatePayroll` throws and the run stays uncosted.”* PAYE/NSSF/SHIF/AHL bands are configurable and `workforce-payroll-calculator.spec.ts` passes. **There is no VAT, withholding tax or tax-invoice field on invoices** (`grep VAT` in billing returns nothing), and no Kenyan rates are seeded | Confirm the applicable statutory rates and effective dates; VAT/WHT treatment of hospital services; whether a KRA-compliant tax invoice is required; payroll go-live rules | **Client + tax consultant decision.** The system must not invent rates; this is correctly blocked rather than guessed |
| 24 | **Three-phase implementation and confirmed Phase 1 scope** | — | **UNVERIFIED** | `grep -ri syrona` across the repository returns **no matches**; there is no client phase plan. The repository's own phases (`docs/project/completion-phases/PHASE-1-SECURITY-MULTITENANCY.md` … `PHASE-6-INTEGRATION-MATRIX.md`, ten files) are an **internal engineering taxonomy** and their Phase 1 is “security and multi-tenancy”, which is almost certainly not what the client means. `PHASE-1-4-OUTSTANDING-REGISTER.md` states outright: *“No phase below is complete.”* | Obtain the client's phase documents and the signed Phase 1 scope | **Client**: supply the requirement document and the three-phase plan. Assessment against them cannot proceed without that document |

---

## 3. Requirements that are already satisfied

These have implementation **and** executed tests in this environment, and I found no material gap
against the stated requirement:

1. **Unified HMIS and facility administration** (#1) — one application, a governed facility-module
   registry enforced at the API, tenant/facility onboarding, module enablement, invitations and RBAC
   administration;
   `route-inventory.spec.ts` proves each domain is actually mounted on the real Express app.
2. **Reception and patient registration** (#2) — audited patient directory, server-allocated MRN
   with a database unique index, registration UI with required-field validation and county/sub-county
   consistency, reception queues and appointments.
3. **Inpatient admissions, bed management and billing** (#10) — 29 endpoints covering wards, beds,
   admissions, transfers, discharge, nursing notes, bed-day accrual and bed billing, with a
   timezone-aware, cutoff/grace-based bed-night policy and a recovery path for unresolved charges.
4. **Fixed assets and depreciation** (#15) — a full asset lifecycle (acquire, transfer, maintain,
   depreciate, impair, revalue, dispose) posting to the ledger, with statutory rates left to the
   facility and traceable to an authority reference.
5. **Role-based access control** (#16) — 187 permissions enforced at the API, centralised tenant/
   facility scope resolution held at 100 % coverage, no facility-level privilege escalation.

---

## 4. Critical gaps requiring attention

Ordered by risk to Syrona's ability to run the hospital, not by effort.

### 4.1 Documents cannot be produced *(highest operational risk)*

Syrona is a hospital. It must hand a patient an invoice and a receipt, send an LPO to a supplier,
and file a claim with a payer.

- **No receipt can be printed.** `printables-receipts` carries `dependency: 'Standalone receipt
  print template.'` and `engine: null`; `BillingCashierModule.tsx` contains no print path.
- **No invoice is generated server-side.** “Print” is `window.print()` of a React view
  (`FinalizedInvoicePanel.print()`), with an audited `print-access` call in front of it. It is
  browser- and stylesheet-dependent, and it is the only document path in the product.
- **No facility letterhead exists in committed code.** The only occurrence of “letterhead” under
  `src/` is in an uncommitted schema file (see §1.2). An uncommitted
  `0089_facility_letterheads.sql` + `src/db/schema/facility-branding.ts` are present
  on disk but have **no service, no route, no UI, no test and no applied migration**.
- **No LPO or GRN can be printed** (both `engine: null`), and no laboratory or radiology report.

### 4.2 No file storage or e-signature anywhere

Every “document” in the system is a reference string plus a checksum
(`storageReference`, `documentUrl`, `storageKey`). There is no upload endpoint, no object store,
no virus/type validation and no signature capture. This blocks “signed forms and consent
documents” regardless of how good the consent *record* is.

### 4.3 Duplicate patient detection is browser-only

The uniqueness guarantee is one server-allocated MRN. Duplicate detection is a 300 ms debounce in
`PatientRegistrationModule.tsx` calling an exact-match directory lookup, then a checkbox. A caller
that POSTs to `/api/patients` directly bypasses it entirely. There is no merge workflow, and
`merged_into_patient_id` is write-never.

### 4.4 Inventory stores are cosmetic

A store is not an entity. `inventory_items.store_location` is a **single free-text label per item**
(default `'Main Pharmacy Store'`); there is no stores table and no per-store holding balance. The
`stock-goods-inventory-by-store` report therefore groups items by their *home* label, not by what is
actually on each shelf.

`createTransfer` (the only store-move path) writes both legs with `stockAfter` set to the
**unchanged facility total** and updates neither `current_stock` nor `store_location`. Run a transfer
from Main Store to the Ward and nothing changes: not the item row, not the stock balance, not the
by-store report — only the movement log records intent. A facility cannot answer “what is on the
ward shelf?”. There is also **no supplier-contract entity at all**.

### 4.5 The report catalogue is 15 % executable

151 requested reports; 23 wired to an engine; 121 explicitly `engine: null`. Critically, **every
MOH return is `engine: null`**, including MOH 705, and `GET /api/interop/dha/moh-705` returns
**501 `MOH705_REPORT_NOT_IMPLEMENTED` by design**. If Syrona files MOH returns through this system
on day one, it cannot.

### 4.6 MFA is a dead end, not a missing feature

`auth.service.ts:393–440` detects a user who requires MFA, records a successful password check, and
then **refuses to create a session**. The comment in `auth.controller.ts:78–80` is explicit:
*“MFA is not yet a completed authenticated session. The MFA verification endpoint will be added
later.”* No challenge endpoint exists. Enabling MFA on any account locks that user out.

There is a second, unwired login implementation that would be worse if someone connected it:
`src/auth/login.service.ts:328` computes `requiresMfa: user.mfaRequired && !user.mfaEnabled`, so a
user with MFA **enabled** would be marked as needing no second factor and handed a full session
token. Nothing imports that file except a source-text test — but it is a loaded gun sitting next to
the login route.

### 4.7 No live payer, bank or mobile-money connection

Every external adapter is explicit that no provider relationship exists. This is *correct*
behaviour — nothing has been fabricated — but it means eligibility, claim submission, remittance
and payment confirmation are all **manual, local records** today.

---

## 5. Phase 1 completion assessment

**Cannot be assessed as defined.** Two independent reasons:

1. **The Syrona Phase 1 scope is not in the repository.** There is no requirements note, no phase
   plan and no signed scope (`grep -ri syrona` → no matches). The requirements list in the task
   brief does not state which items are in Phase 1.
2. **The repository's own phase numbering is a different taxonomy** and explicitly incomplete:
   `docs/project/completion-phases/PHASE-1-4-OUTSTANDING-REGISTER.md` opens with *“No phase below
   is complete.”* Its Phase 1 is “Security and multi-tenancy”, with nine open items including
   revalidating the crosswalk against current routes, portal ownership, session/password-reset
   review, and MFA.

**What can be said with evidence**, assuming a conventional Phase 1 = “registration through OPD
billing plus finance basics”:

| Phase-1-shaped capability | Ready for a supervised pilot? | Why |
| --- | --- | --- |
| Facility/tenant/module administration, RBAC, staff invitations | **Yes** | Server-enforced, tested, no external dependency |
| Registration, MRN allocation, directory, queues, appointments | **Yes, with a manual duplicate check** | Server guarantees MRN uniqueness; duplicate detection is advisory and bypassable |
| OPD encounter → diagnosis → procedure → observation → charge | **Yes** | Chain exists with idempotency; clinical sign-off of the workflow is a facility matter |
| Laboratory order → accession → verify → complete → bill | **Yes, but no printable report** | State machine is sound; report printing is absent |
| Pharmacy dispensing → stock → billing | **Yes, in a single store** | FEFO + locking + price snapshot are solid; multi-store is not modelled |
| Inpatient admission → bed → bed-day billing → discharge | **Yes** | Bed-night policy is the strongest-tested financial rule in the product |
| Invoicing, payment capture, refunds, void | **Yes, but no receipt to give the patient** | The accounting is right; the *documents* are missing |
| Financial statements (trial balance, income, balance sheet) | **Yes, for posted journals only** | Real double-entry; but posting billing to the GL is a **manual, reviewed action**, so statements are only as complete as the posting discipline |
| MOH returns | **No** | 501 by design |
| Insurance claims to a live payer | **No** | Manual/local only; no provider contract |
| Payroll with statutory deductions | **No** | No rates may be invented; needs the consultant's decision |

**Verdict:** a Phase 1 limited to *facility administration + registration + OPD + inpatient +
local billing + ledger* is **substantially implemented and would be credible in a supervised
pilot with printed documents supplied outside the system**. A Phase 1 that includes **receipts
handed to patients, MOH returns, pharmacy multi-store, insurance submission or payroll** is
**not closable** without the work in §7.

---

## 6. Requirements dependent on the client's Excel workbooks

The workbooks were **not** supplied and were not assessed (as instructed). The repository contains
no `.xlsx` file at all — `find` for `*.xlsx`/`*.xls` returns nothing. The only tabular data files are
four CSVs under `docs/`: three internal audit inventories
(`hospital-service-discovery/*.csv`) and a tariff intake template.

Their absence is visible in the code: **121 catalogue entries have `engine: null`**, and each carries
a `dependency` string naming the missing ingredient. Representative values, with occurrence counts:

| `dependency` value | Count |
| --- | --- |
| “Payroll and approved current-year HR/KRA and secure payment policies.” | 13 |
| “Precise result/release and timing rules, grouped reports and safe exports.” | 8 |
| “Complete safe grouping, historical/cost evidence, filters and export.” | 6 |
| “Dedicated controlled workflow and reconciled classification.” | 4 |
| “Approved, confidential case and waiver workflows.” | 3 |

The financial and MOH entries below are the ones where a **client-supplied workbook** — not more
engineering — is the missing input.

| Report / requirement | Catalogue id | Blocked on |
| --- | --- | --- |
| Cashier daily summary variants | `financial-cashier-daily-summary`, `financial-all-cashier-daily-summary` | **Already wired** (`cashier-receipts`); the workbook decides whether the engine's columns and totals match Syrona's format |
| Department receipt summary / breakdown | `financial-department-receipt-summary`, `…-breakdown` | Workbook layout + department attribution source |
| Managerial daily summary | `financial-managerial-daily-summary` | Workbook |
| Monthly profit & loss | `financial-monthly-profit-and-loss` | Workbook + expense classification |
| Cash-flow statement | `financial-cash-flow-statement` | Workbook + reconciled classification |
| Budget management | `financial-budget-management` | Workbook (budget lines) |
| Credit notes / waiver reports | `financial-credit-notes`, `financial-waiver-reports` | Workbook + a credit-note/waiver document workflow that does not exist |
| Income by cashier, departmental revenue | `financial-income-by-cashier`, `financial-departmental-revenue` | Workbook |
| SHA and private-insurer receivables | `financial-sha-receivables`, `financial-private-insurance-receivables` | Workbook + payer contract ageing terms |
| M-Pesa / card reconciliation | `financial-m-pesa-reconciliation`, `financial-card-payment-reconciliation` | Workbook + provider statements |
| **MOH 505-IDSR, 705A, 705B, 717, 301, 204, 240, MOH financial reports** | `records-moh-*` | Workbook **and** authoritative MOH forms/indicator dictionaries |
| Daily/periodic stock and departmental reports | `stock-goods-*`, `departmental-*` | Workbook layout for the ones not wired |

> The correct interpretation of “dependent on the Excel workbooks” is: **the workbooks define the
> target output, not a formula source.** No formula from a client workbook should be implemented
> without the client confirming it, and none has been invented.

---

## 7. Requirements dependent on external credentials or client decisions

### 7.1 External credentials / provider approval (no code can close these)

| Item | What is needed | Owner |
| --- | --- | --- |
| SHA / DHA eligibility, preauth, claims, remittance | Signed facility agreement, facility registry code, official API/IG specification, sandbox credentials, callback authentication contract | SHA/DHA |
| **Britam** | Signed contract, provider identifier, official direct API specification (or written confirmation that access is via an approved gateway), sandbox access | Britam |
| PACIS, CIC, Jubilee, SmartLink (registered adapters) | Same per payer; none has a verified specification in the repo | Each payer |
| **NCBA** | API contract, authentication, sandbox | NCBA |
| **Equity (Jenga)** | Statement/transfer API access, callbacks, production approval (only sandbox token exchange exists) | Equity |
| **Safaricom M-Pesa** | PayBill/till number, passkey, consumer key/secret, **approved callback URL**, production approval | Safaricom + client |
| **Hosting** | Server/account (Truehost cPanel or container host), domain, TLS certificate, PostgreSQL instance, backup destination and off-site copy, secret/key custody | Client |
| SMS/email delivery (portal invitations, reminders) | Provider account and sender ID. The code has a deliberate `NOT_CONFIGURED` stub (`src/notifications/notification-provider.ts`) that reports `NOT_CONFIGURED` instead of pretending to send — no SDK, no credentials, no gateway | Client |
| PACS / DICOM (radiology) | Vendor, endpoint, DICOM conformance statement | Client + vendor |

### 7.2 Client decisions (no code should proceed until answered)

1. **Phase 1 scope and phase plan** — in writing (#24). *Nothing in §7 can be sequenced without this.*
2. **Document set** — which documents Syrona must issue from day one (receipt, invoice, LPO, GRN,
   lab report, radiology report, discharge summary, sick-off certificate, referral letter) and the
   approved layout/letterhead for each.
3. **Signature model** — wet signature scanned, captured e-signature, or none; and whether consent
   must gate clinical reads (with an emergency override).
4. **Identity policy** — mandatory identifiers, whether two patients may share a phone/ID, and
   whether an inter-facility merge or DHA Client Registry check is required.
5. **Store model** — how many physical stores exist, who issues stock, and whether ward requisitions
   are required.
6. **Supplier contracts** — the actual contract/price-agreement data and payment terms.
7. **Payer contracts** — which insurers Syrona has signed contracts with (drives #19/#20 and the
   priority of each adapter).
8. **Tax treatment** — VAT/WHT applicability to hospital services, whether KRA-compliant tax
   invoices are required, and the payroll statutory rates/effective dates (with the tax consultant).
9. **Depreciation policy** — useful lives and method per asset class.
10. **MFA scope** — all staff or privileged roles only; acceptable second factor (TOTP, SMS).
11. **MOH reporting obligation** — which returns Syrona files, on which schedule, and through
    which channel.

---

## 8. Prioritized implementation sequence

Sequenced by *what stops the hospital operating*, then by dependency, not by module size. Each item
names the completion evidence that would be required.

### P0 — Document output (unblocks daily operation)

| # | Work | Evidence of completion |
| --- | --- | --- |
| 1 | Facility letterhead: finish `0089`, apply the migration, service + routes + UI + PDF integration, version activation history, reprint fidelity | Migration applied on a scratch DB; API test for version activation and supersession; PDF asserts the recorded version, including for a historical reprint |
| 2 | Server-rendered **receipt** document (A4 + thermal) with letterhead | Byte-valid PDF test; receipt content matches the immutable payment row; audited print access |
| 3 | Server-rendered **invoice** PDF replacing `window.print()`, keeping audited `print-access` and snapshot fidelity | PDF from the finalization snapshot, not live rows; a later tariff change does not alter a reprinted invoice |
| 4 | LPO and GRN print documents | PO/GRN PDF from the recorded document, with approval state and signature block |

*Why first:* these are the only gaps that block a patient leaving with a receipt on day one, and
none depends on an external party.

### P1 — Correctness gaps a hospital will hit in week one

| # | Work | Evidence |
| --- | --- | --- |
| 5 | **File storage + upload** (private object store, type/size/virus checks, access audit) and wire preauth/referral/consent documents to it | Upload→store→retrieve round trip; wrong-type and oversized rejection; cross-tenant retrieval refused |
| 6 | **Server-side duplicate policy**: national-ID uniqueness per tenant (configurable), duplicate refusal at the API, and a controlled **merge** workflow using `merged_into_patient_id` with audit and historical-row redirect | Duplicate POST refused; merge transfers encounters/invoices/consents with an immutable audit trail; merged patient cannot be selected |
| 7 | **Real store balances** — make stores entities with their own holding rows; transfers move holdings and update `stock_after` per leg; add a ward/department issue endpoint (today `CONSUMPTION` movements come only from pharmacy dispensing) | Transfer changes both stores' balances and the by-store report; a ward issue produces a `CONSUMPTION` movement and posts cost |
| 8 | **MFA challenge flow** (enrolment, verification, recovery codes, reset) — currently a lockout; and delete or align the unwired `login.service.ts` so there is only one login path | Login with MFA enabled completes; wrong code refused; recovery code works once; disable requires re-auth; only `auth.service.ts` remains wired to `/api/auth/login` |
| 9 | Laboratory **result amendment** and **critical-value** escalation | Amended result keeps a version chain; critical flag notifies the ordering clinician |

### P2 — Reporting that the client can specify now

| # | Work | Evidence |
| --- | --- | --- |
| 10 | Implement the financial reports whose templates Syrona supplies (dept receipt summary, managerial daily summary, monthly P&L, cash flow, budget, credit notes, waivers, income by cashier, departmental revenue, receivables) | Each report: engine wired in `report-catalogue.ts`, fixture-based totals reconciled to posted journals, export (PDF/XLSX/CSV) test |
| 11 | Credit-note and waiver **document workflows** (currently no such entity) | Credit note reduces a receivable through a reversal entry, never by mutating an invoice |
| 12 | Accounts payable: supplier invoice capture and payment run, closing the procurement chain | GRN → supplier invoice → approved payment → ledger, with matching exceptions surfaced |

### P3 — External integrations (only after credentials arrive)

| # | Work | Evidence |
| --- | --- | --- |
| 13 | M-Pesa Daraja: callback signature verification, sandbox collection + status, production gate | Sandbox transaction evidenced by Safaricom's own record; callback rejected when the signature is wrong |
| 14 | Britam (or the confirmed gateway): implement to the supplied specification | Provider sandbox conformance |
| 15 | Equity Jenga: statements → bank reconciliation; NCBA when contracted | Sandbox statement import matched to a journal |
| 16 | SHA: live eligibility/submission when onboarding completes | SHA sandbox conformance, then facility acceptance |

### P4 — Statutory and clinical acceptance

| # | Work | Evidence |
| --- | --- | --- |
| 17 | MOH returns once forms/dictionaries are supplied — including replacing the 501 | Return generated from recorded data, reviewed against the official form |
| 18 | Payroll statutory versions loaded from the consultant's confirmed rates | A payslip reproduces with the recorded version and band results |
| 19 | Clinical UAT per department with facility staff on synthetic data | Signed UAT record per workflow |

---

## 9. Test results and exact evidence

### 9.1 Suite executed in this environment

```
npx vitest run --reporter=json
  Test Files   3 failed | 199 passed | 85 skipped (287)
       Tests    4 failed | 1898 passed | 771 skipped (2673)
       Duration 307.86s
```

Static gates:

```
npx tsc --noEmit     → 0 errors
npx eslint .         → 102 problems (0 errors, 102 warnings)
```

**The 4 failures are all schema-contract assertions, and all are caused by uncommitted work:**

| Failing test | Cause |
| --- | --- |
| `src/tests/schema-sha-claims.spec.ts` → `shaEclaims retains its pre-extraction metadata` | New `invoice_finalized_at` (`timestamp`) and `invoice_snapshot` (`jsonb`) columns present, absent from `src/tests/fixtures/schema-contract-before-extraction.json` |
| `src/tests/schema-extraction.spec.ts` → `shaEclaims keeps its table metadata` | Same |
| `src/tests/schema-private-insurance.spec.ts` → `privateInsuranceClaims retains its pre-extraction metadata` | Same, on `private_insurance_claims` |
| `src/tests/schema-extraction.spec.ts` → `privateInsuranceClaims keeps its table metadata` | Same |

This is a *deliberate-guard* suite: it fails when a table's shape changes without a reviewed
baseline update. The correct fix is to update the baseline as part of the A3 change, not to relax
the test. **It was not done here because this task is assessment-only.**

### 9.2 Tests skipped, and what that costs the assessment

**771 tests in 141 `*.db.spec.ts` files** were skipped because no PostgreSQL was reachable.

Specs that would have provided the strongest Syrona evidence but did **not** run:

| Area | Spec not executed |
| --- | --- |
| Registration / MRN | `src/tests/integration/patient-mrn-allocation.db.spec.ts`, `phase2-patient-directory.db.spec.ts` |
| Billing documents | `src/tests/integration/finalized-invoices.db.spec.ts`, `invoice-payment-acceptance.db.spec.ts`, `billing-posting.db.spec.ts`, `billing-gl-reconciliation.db.spec.ts` |
| Inpatient | `inpatient-acceptance.db.spec.ts`, `inpatient-bed-billing.db.spec.ts`, `inpatient-migration.db.spec.ts` |
| Laboratory | `laboratory-facility-identity.db.spec.ts`, `laboratory-migration.db.spec.ts` |
| Pharmacy | `pharmacy-inventory-billing.db.spec.ts`, `inventory-accounting-posting.db.spec.ts` |
| Insurance | `src/tests/vitest/sha-eclaims.db.spec.ts`, `private-insurance.db.spec.ts`, `payer-hub.db.spec.ts`, `payer-patient-scope.db.spec.ts` |
| Fixed assets | `fixed-assets.db.spec.ts`, `fixed-asset-impairment.db.spec.ts` |
| Backup | `src/tests/integration/backup-restore.db.spec.ts` |

CI (`.github/workflows/ci.yml`) runs these in a `database` job and in the `unit` job against
`postgres:16` with `JALICARE_REQUIRE_DB=1`, which converts a skip into a failure. That is the
mechanism by which they are verified — **but this assessment did not observe a green CI run**, and
the last known green run belongs to a different commit than this working tree.

### 9.3 Evidence that did run, per requirement

| Requirement | Executed evidence |
| --- | --- |
| Unified HMIS / facility admin | `route-inventory.spec.ts` **27 passed**; `facility-modules.spec.ts`; `route-scope.spec.ts` |
| Registration | `patient-registration-birth-date.spec.tsx` **15**; `phase2-patient-directory-ui.spec.tsx` **6** |
| OPD / clinical | `outpatient-safety-ui.spec.tsx` **19**; `inpatient-domain.spec.ts` **6** |
| Allergies / consent | `consent-allergy.spec.ts` |
| Laboratory | `laboratory-safety-ui.spec.tsx`; `laboratory-write-validation.spec.ts` **11** |
| Pharmacy | `pharmacy-batches.spec.ts` **10**; `pharmacy-retry-ui.spec.tsx` **7**; `inventory-selling-price-ui.spec.tsx` **8** |
| Inpatient / beds | `inpatient-bed-night-policy.spec.ts` **5**; `inpatient-bed-rate.spec.ts` **9**; `ward-billing.spec.ts` **9**; `inpatient-router.spec.ts` **7**; `inpatient-bed-recovery-ui.spec.tsx` **8** |
| Billing | `finalized-invoice-ui.spec.tsx`; `billing-cashier-ui.spec.tsx`; `refund-ui.spec.tsx`; `phase3b-refund-workflow-ui.spec.tsx` **9**; `payments.spec.ts` **5**; `billing-engine.spec.ts` **7** |
| Reports | `report-centre-ui.spec.tsx` **16**; `report-centre-invoice-ui.spec.tsx` **7**; `report-centre-export.spec.ts`; `billing-gl-reconciliation-ui.spec.tsx` |
| Procurement | `procurement-suppliers.spec.tsx` **17**; `procurement-workflow.spec.tsx` **11**; `procurement-order-items.spec.ts` **11**; `procurement-matching-returns.spec.tsx` **7**; `procurement-rbac.spec.ts` |
| Fixed assets | `fixed-asset-depreciation.spec.ts` **15**; `fixed-assets-ui.spec.tsx` **6** |
| RBAC | `staff-roles.spec.ts` **10**; `staff-role-catalogue.spec.ts`; `authorization.spec.ts`; `permission-catalogue-integrity.spec.ts` |
| Backup | `backup-lib.spec.ts` **16** |
| Insurance | `sha-eclaims.spec.ts` **24**; `private-claims-validation.spec.ts` **16**; `private-insurance.spec.ts` **12**; `sha-eligibility-parser.spec.ts` **8** |
| Payments / M-Pesa | `payment-hub.spec.ts` **8**; `payment-hub-collection-ui.spec.tsx` **11**; `payment-hub-ui.spec.tsx` **9** |

### 9.4 Code-level evidence for the negative findings

| Finding | Verifiable evidence |
| --- | --- |
| No letterhead | `grep -ril letterhead src` → exactly one file, the **uncommitted** `src/db/schema/facility-branding.ts` |
| No receipt print | `printables-receipts` → `engine: null`; no `window.print()` in `BillingCashierModule.tsx` |
| Invoice print is browser-only | `FinalizedInvoicePanel.tsx:148–161` — `recordInvoicePrintAccess()` then `window.print()` |
| No file storage | no `multer`/`S3`/`minio`/`writeFile` in `src/`; attachments require `storageReference` only |
| Duplicate check is client-side | `PatientRegistrationModule.tsx:146–190`; no server rule in `patients.routes.ts` or `queries/patients.ts` |
| No patient merge | `merged_into_patient_id` referenced only in `consent.service.ts:480` |
| Transfer moves no stock | `stock-control.service.ts:745–832` — both legs write `stockAfter: item.currentStock`; no update to `current_stock` or `store_location`; `grep storeLocation` shows only item create/update |
| No supplier contracts | `suppliers` table fields: `name, contactPerson, phone, email, kraPin, address, isActive, revision` |
| Report catalogue mostly unbuilt | `grep -c "id: '"` → 151; `grep -c "engine: '"` → 23; `grep -c "engine: null"` → 121 |
| MOH 705 not implemented | `src/routes/domains/interop.routes.ts:201–206` returns **501 `MOH705_REPORT_NOT_IMPLEMENTED`** |
| MFA locks users out | `src/auth/auth.service.ts:393–440` returns `requiresMfa: true` without a session; `auth.controller.ts:78–80` says the verification endpoint “will be added later”; no challenge route exists. `src/auth/login.service.ts:328` is an unwired second implementation that would skip MFA when `mfaEnabled` |
| Payer transport blocked | `britam.adapter.ts` header; `payment-hub/adapters/banks.ts` descriptors; `sha.config.ts:168–276` |
| No monitoring | `docs/deployment/operations-runbook.md` — alert delivery, log shipping and metrics all marked **not implemented** |

---

## 10. Summary position

| Status | Count | Requirements |
| --- | --- | --- |
| **COMPLETE** | 5 | 1, 2, 10, 15, 16 |
| **PARTIAL** | 15 | 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 17, 18, 21, 22 |
| **MISSING** | 0 | — |
| **BLOCKED** | 3 | 19, 20, 23 |
| **UNVERIFIED** | 1 | 24 |

*(24 requirements assessed. No requirement is MISSING outright: in every case *something*
real exists, though “PARTIAL” here spans a wide range — #3 is a browser warning with no server
rule, #9 is three endpoints.)*

**Bottom line.** The product's *financial and clinical control* layer is stronger than its
*document* layer. The invariants a hospital cannot afford to get wrong — finalized-invoice
immutability, party-attributed receipts, reversal-not-mutation, bed-night pricing, FEFO dispensing,
menu-and-API RBAC, tenant isolation — are implemented and tested. What is missing is what Syrona
will notice first: **a receipt in the patient's hand, a letterhead on the invoice, a LPO on the
supplier's desk, and an MOH return at month end.** None of those depend on an external party, which
is why they are P0.

**Nothing in this assessment is evidence of clinical safety certification, regulatory approval,
provider connectivity or production readiness.** No provider was contacted; no live deployment was
inspected; and the four failing schema-contract tests mean this exact working tree is not green.

---

*Assessment produced without modifying behaviour, without committing, and without contacting any
external system. Every status above cites a file, a test result or an executed command in this
document.*
