# JaliCare — Presentation Readiness Verification and Correction

## Decision

**READY WITH DISCLOSED LIMITATION for the selected synthetic demonstration; not a complete Reporting Centre, production deployment or clinical/legal acceptance.**

Assessment date: **2026-10-27**. Entry baseline: `9814678a0229cdeb5946a717111cddfa1ba17364`, branch `arena/e088f11d-afyahub-hmis-kenya`. The sandbox database/browser timestamps show November 2026; actual exported timestamps are retained, not rewritten into a purported deployment chronology. Corrected source fingerprints and test evidence are in [verification-summary.json](presentation-readiness-evidence/verification-summary.json). Final commit/push is reported in the delivery response.

This is the requested narrow presentation check, not another system audit or reporting implementation batch. Read [the master register](JALICARE_MASTER_COMPLETION_REGISTER.md), [its JSON](JALICARE_MASTER_COMPLETION_REGISTER.json), [clinical-document acceptance](CLINICAL_DOCUMENTS_FINAL_ACCEPTANCE.md), its initial audit, and the current reporting matrix/Batch 1 evidence before proceeding. Historical acceptance is not counted as this run.

### Safety and entry state

- Initial local Git metadata was stale at `0111b55`, with 788 apparent status entries and no upstream. Fetched the current branch, independently compared every **1,710 remote blob** to disk, found **zero content differences, no extra unignored files and no staged changes**, verified ancestry, then fast-forwarded metadata/index only to `9814678`. No worktree file replacement, reset, clean, branch switch, rebase, history rewrite or force-push.
- All operations used a newly initialized private **PostgreSQL 16.12** cluster bound to `127.0.0.1:55439`, with two newly created databases: `clinical_documents_synthetic_test` and `reporting_programme_synthetic_test`. Independent control-file system identifier and actual data directory were checked before browser fixture writes; existing attestation guards were retained.
- The **101 existing migrations** were applied only to those new disposable databases. No historical migration/schema was edited, no production environment file was loaded, no real patient or production database was inspected, and no deployed permissions changed.
- The production-built Vite frontend and bundled Express server were exercised by **Chromium 143.0.7499.0** with normal staff/patient password login. The browser tests did not intercept/mock application HTTP or SQL. Broad synthetic staff permissions are test personas only, not application default grants.
- Existing consent storage, portal, radiology panel, letterhead renderer and Reporting Centre are reused. No parallel implementation, UI redesign, new report family, financial calculation or procurement workflow was introduced.

## 1. Presentation classifications

| Item | Classification | Evidence / presentation boundary |
| --- | --- | --- |
| Patient Management: PDF/PNG/JPG/JPEG upload, persisted metadata, independent signature assertions, original preview/download, correction/history/audit | READY WITH DISCLOSED LIMITATION | Actual UI upload/correction/preview and PostgreSQL/HTTP negatives pass. Manually uploaded signatures are staff-observed assertions, not electronic/digital signature authentication. DOCX and arbitrary other formats are deliberately unsupported. |
| Patient portal: released own document, signing date and secure bytes; deny other patient/unreleased version | READY TO DEMONSTRATE | Separate actual patient login and own-document UI/PDF opener pass; server denies other patient and unreleased original; internal notes/audit omitted. |
| Radiology: missing/generic/wrong/changed consent denied; specific signed consent and permitted exception accepted | READY WITH DISCLOSED LIMITATION | Actual request→consent upload→verification→report and direct API negatives pass. Cancelled-request API defect corrected. Exception policy/clinical roles still need real owner approval; PACS/DICOM is not connected or demonstrated. |
| Facility letterhead: draft→preview→explicit activation, same-facility generated output, historical A/B/fallback | READY WITH DISCLOSED LIMITATION | Actual API upload/preview/activation, active configuration UI, real PDFs and cross-facility/history regression pass. Synthetic template is not authorized Syrona stationery. |
| Reporting Centre inventory/category/store, recorded movements and existing query subsets | READY WITH DISCLOSED LIMITATION | All20 engines generate/export; persisted-value/scoping/filter tests pass; inventory/movement native exports inspected. Specific sources/semantics, not full named management/statutory reports. |
| Existing laboratory/radiology/invoice document workflows | READY WITH DISCLOSED LIMITATION | Authoritative owning-module PDFs reused; lab/radiology unsafe release cases corrected; finalized financial snapshot/history kept. Not new clinical certificates or generic tabular Excel reports. |
| Existing discharge-summary catalogue workflow as an approved final discharge document | NOT READY | Rendering/history regression passes, but master DOC-004 also records discharge-finality/issue-policy gaps outside this narrow correction. Do not present a prewritten summary as accepted final discharge certification. |
| 97 catalogue outputs without implementations | NOT READY | Actual detail pages open but explicitly cannot generate the requested reports. No fabricated figures or placeholder exports. |
| 19 additional catalogue outputs blocked by source/definition decisions | BLOCKED BY EXTERNAL DEPENDENCY | Client source/definition/mapping approval needed; code and acceptance may still be required after the decision. |
| Annual-budget/equity/payroll or other print families not replayed in this narrow run | NOT READY | Do not add them to the live presentation based on this report; prior evidence/source reuse is not a fresh demonstration. Preflight separately if included. |
| Desktop print dialog, physical printer, actual device fleet and national statutory submission | NOT READY | Not tested here; provider/statutory prerequisites and deployment/device acceptance remain. |

The report-specific presentation matrix has **27 READY WITH DISCLOSED LIMITATION, 98 NOT READY (including discharge) and19 BLOCKED BY EXTERNAL DEPENDENCY**. These are presentation decisions, not replacements for the master completion statuses.

## 2. Confirmed product defects and focused corrections

| ID | Reproduction before correction | Correction | Regression / final result |
| --- | --- | --- | --- |
| PR-01: official laboratory release | Real PostgreSQL/HTTP returned200 for one unverified result, a non-Verified status retaining a timestamp, and a result linked to another patient. | `document.service.ts` now refuses the official PDF unless **every result** has a verification timestamp, a case-normalized Verified state and the order's patient ID. Returns409 `DOCUMENT_INCOMPLETE`; does not invent a draft/final policy bypass. | Three negative cases now409; positive verified report still200 and correctly branded. Same builder protects Reporting Centre clinical-document retrieval. |
| PR-02: official imaging release | Real PostgreSQL/HTTP returned200 for findings without a report timestamp, timestamp without meaningful findings, and cancelled status with stale findings. | Existing official PDF now requires case-normalized Reported state **and** report timestamp **and** nonblank findings. No change to source report text or signature claims. | Three negative cases now409; actual completed radiology report still opens from the built Reporting Centre and uses effective letterhead. |
| PR-03: cancelled radiology authorization/performance | Three persisted cancellation spellings still accepted new consent decisions; report writer did not reject cancellation. | Under the existing order row lock, consent decisions and the report transaction reject Cancelled/Canceled case-insensitively with409. HTTP route returns the domain error. Consent status explicitly reports `PROCEDURE_CANCELLED`, rather than implying earlier authorization revives the request. Existing signed-consent and exceptional-policy enforcement remains. |42-test consent suite covers cancellation, policy/roles, changed procedure, corrected versions, immutable storage, upload validation, audit failure and portal isolation. Actual Express API rejects both cancellation authorization and report requests even with earlier consent. |

Before-fix proof: official document suite **20 passed /6 failed** (the six unsafe release cases); consent suite **39 passed /3 failed** (cancelled authorization). These failures were retained as evidence of real defects, not weakened assertions. All nine new negative cases pass after the changes.

### Test-harness corrections, not claimed product defects

A browser download may finish before React clears its busy state; the harness now waits for enabled controls. The selector picker and report both have a Next button; the new report-pagination test is explicitly scoped to `#report-centre-print` rather than accidentally paging picker options. Duplicate catalogue names are selected within their actual category. These are automation corrections, not invented application fixes.

## 3. Actual verification results

| Verification | Final result | What was actually exercised |
| --- | --- | --- |
| Scoped Vitest regression set | **177 passed,0 failed,0 skipped across13 unique files** |147 real PostgreSQL/HTTP tests across9 files;30 catalogue/mock-DOM tests across4 files. Individual cases include real native format parsing and source arithmetic; not every test is a browser action. |
| Main built-application journey | **200 checks passed** | Normal staff and portal login, patient UI upload/correction/history, signature/date reload, PNG preview, denied access/oversize, deliberate release, procedure-specific verification and exceptions, cancellation negatives, active letterhead,20 actual query/export engines, inventory pagination/native downloads and144 category-scoped detail pages. |
| Existing Batch1 built-browser journey | **32 checks passed** | Nonempty movement records, independent per-item nets7 Pieces/80mL, date/type filters, picker clear, empty results, native PDF/XLSX, scoped denial and audit. |
| Main saved PDF/XLSX inspection | **1162 checks passed** |20 engine files plus representative clinical PDFs/fallback; exact returned values, full35-row native inventory cells, page numbering, template repetition and geometry. |
| Batch1 saved export inspection | **101 checks passed** | All5 movement rows/cells, exact separate-unit nets, date boundaries, empty native outputs, scoped metadata and active/fallback branding. |
| Frontend build / server build | PASS | `npm run build`; `npm run build:server`. Vite retains a large-chunk warning; no performance readiness claim. |
| Typecheck / changed TS-file lint | PASS | `tsc --noEmit --singleThreaded` with bounded Go runtime; focused ESLint. Standard type analysis, no `noCheck`, suppression, weakened auth or test skip added. |

The first concurrent typecheck/regression attempt exhausted this4GiB sandbox and produced timeouts; it was stopped. Final single-worker regressions pass without changing assertions/timeouts. The original unconstrained typecheck was not called successful; the bounded equivalent completed. A later42-test consent rerun overlaps the177 and is not added again. Full-system coverage/CI/load/security suites were not rerun or declared green.

### Regression files

- `src/tests/integration/document-generation.db.spec.ts` — 26 passed.
- `src/tests/integration/report-centre-selectors.db.spec.ts` — 7 passed.
- `src/tests/integration/report-centre-operational.db.spec.ts` — 17 passed.
- `src/tests/integration/report-centre-diagnoses.db.spec.ts` — 13 passed.
- `src/tests/vitest/report-centre-ui.spec.tsx` — 16 passed.
- `src/tests/integration/letterhead-branding.db.spec.ts` — 13 passed.
- `src/tests/integration/report-centre.db.spec.ts` — 11 passed.
- `src/tests/integration/patient-signed-documents.db.spec.ts` — 42 passed.
- `src/tests/integration/report-centre-ledger.db.spec.ts` — 6 passed.
- `src/tests/vitest/reporting-programme-matrix.spec.ts` — 4 passed.
- `src/tests/vitest/report-catalogue-integrity.spec.ts` — 5 passed.
- `src/tests/vitest/clinical-document-report-ui.spec.tsx` — 5 passed.
- `src/tests/integration/report-centre-movements.db.spec.ts` — 12 passed.

## 4. Letterhead and actual downloaded files

Synthetic facility **61**, tenant **37**: one newly uploaded version (`id=30`,v1) was DRAFT, preview bytes matched the original synthetic PDF, then an explicit reasoned activation made it ACTIVE. The actual configuration page shows Active: version1 and upload/activation actor **#114** in history; see [the captured page](presentation-readiness-evidence/05-letterhead-active-version.png).

- [Native inventory PDF](presentation-readiness-evidence/native-inventory.pdf) and [native inventory Excel](presentation-readiness-evidence/native-inventory.xlsx): all35 persisted item rows, not just25 displayed. Every native Excel data cell was checked; every PDF record matches those cells. PDF is6 pages with repeated template/page numbering; Excel is a data workbook, not a page-stationery imitation.
- [Radiology report](presentation-readiness-evidence/radiology-after-activation.pdf): actual reported request **#63**, correct patient/MRN, persisted findings/impression, effective same-facility letterhead, readable page.
- [Laboratory report](presentation-readiness-evidence/laboratory-after-activation.pdf): request **#128**, refused while unverified, permitted only after the synthetic result became Verified; actual5.1 value and correct branding inspected. This is a PDF release test, not a complete specimen-to-verification clinical acceptance.
- [Before activation](presentation-readiness-evidence/report-before-activation.pdf): no uploaded stationery is silently implied; footer explicitly says no active facility letterhead/plain report.
- [Movement PDF](presentation-readiness-evidence/stock-movements/movements.pdf) and [Excel](presentation-readiness-evidence/stock-movements/movements.xlsx): native browser download bytes match the authenticated export; five scoped rows,7 Pieces and80mL remain separate. Empty/fallback PDFs and workbooks are also retained.
- Invoice, receipt/thermal, credit note, LPO, GRN, lab, radiology and discharge **rendering** were parsed through real PostgreSQL/HTTP tests, including A→B replacement, historical A reprint, preview before activation and facility isolation. These tests do not certify every clinical/final-issue rule. Thermal receipts intentionally use the established compact output instead of A4 artwork.
- Historical issued documents retain the effective historical version or explicit no-template fallback. Applying today's active version indiscriminately would corrupt reprint history; no such change was made.
- Uploaded signed consent originals are intentionally **not** overprinted/rebranded: preserving signed bytes takes precedence. No new signed certificate, prescription or consent-form generator was invented. Unsupported medical certificates remain unavailable.
- Rendered inventory first/last pages, lab, radiology and plain fallback were visually inspected in addition to text/geometry checks. Headless Chromium's iframe/opener was exercised, but native desktop PDF viewer controls/print dialogs and physical printing were not.

## 5. Why Reporting Centre can still feel incomplete

The current catalogue has **144 labels**, not144 finished reports. **24 labels reuse20 query engines;4 open existing individual-document workflows;116 have neither.** The master classification remains **0 Complete and verified,28 Partially supported,97 Unavailable,19 source/definition-blocked**. No label was promoted merely for opening.

Every actual detail page was selected in the built frontend, including duplicate names in separate categories. The per-entry answer to all12 requested checks is recorded in [catalogue-presentation-matrix.json](presentation-readiness-evidence/catalogue-presentation-matrix.json). Query aliases explicitly inherit their common engine's tests; unsupported workflows are marked not applicable/missing, not passed.

Observed causes and boundaries:

1. Many labels are a proposed report inventory with **no integrated backend**. Opening the explanation panel is not generation.
2. Implemented engines are intentionally narrower: recorded receipts≠bank settlement; account movements≠opening/closing trial balance; recorded movements≠verified balances/valuation; current inventory≠historical snapshot; note≠signed certificate; projection≠posted actual.
3. Dates are event-specific and only shown where a reliable source exists. Current item snapshots intentionally have no historical date picker. Ledger balance is as-of; movement dates require an inclusive range. Invalid/reversed/overlong dates and unsupported filters must be refused, not guessed.
4. No rows can be a correct answer. The main browser fixture has nonempty patient, lab, radiology and inventory data, but **15 of20 engines are empty there**. Nonempty movement and other seeded query/aggregate/scoping cases run in the separate DB suites; empty exports are not proof of complete business data coverage.
5. Pickers browse only authorized source records and impose their additional source permissions. Foreign patient/facility/tenant joins are not completed by matching a name. Shared selectors and invalid/dependent choices were tested through real PostgreSQL/HTTP.
6. Screen pagination shows25 by default; exports include the entire filtered set up to the existing1,000-row limit. Above-limit export refusal is retained, not silent truncation. The report and picker have separate pagination controls.
7. Workbench filter edits require **Generate report** before changing the displayed/generated snapshot. PDF/Excel use the last generated filters, explicitly disclosed in the UI, not unsaved edits. Data can change between separate snapshot queries; no immutable issued-report archive is claimed.
8. Clinical document entries use source IDs and owning PDF rules, not date-based tabular reports; Excel for those is not implemented. Finalized invoices use their existing workflow.
9. Source/denominator/statutory/formula decisions remain client/authority blockers. National MOH/KHIS/SHA filing is not demonstrated by local counts or a catalogue name.

## 6. Concise demonstration checklist

**Use only the freshly provisioned disposable database. Do not execute seeding/migration/replay commands on an existing facility database.** Synthetic passwords/session tokens are absent from Git and this report. With `CLINICAL_DOCUMENTS_KEEP_DEMO_ACCESS=YES`, the harness writes the private, Git-ignored,mode0600 `.tmp-tools/presentation-demo-access.json`; use its per-run staff/portal credentials locally, never publish it. Database IDs below describe this saved evidence run; reruns create new additive identifiers.

| Step | Exact navigation / action | Synthetic data and expected result |
| --- | --- | --- |
| Setup | Log in through the staff login using the private per-run fixture; select its synthetic facility. | Facility #61; patient **Synthetic Consent Patient**, MRN **CL-e27aa3c9**, patient ID119; another patient ID120. No real records. |
| A1 | **Patient Management → View Patient Record → Consent & Signed Documents**. Choose generated `.tmp-tools/clinical-audit/consent.pdf`; title `Synthetic general signed consent`; reason required. | Upload does not infer signatures; title/type/date/upload time/original preview are retained. PDF/PNG/JPG/JPEG only; unsupported file/MIME/oversize rejected. |
| A2 | **Create correction →** title `Synthetic corrected signed consent`, signing date `2026-10-01`, patient signature **PRESENT**, doctor signature **ABSENT**, reason → same file → **Upload document version → Refresh documents → Version & audit history**. | Independent signature metadata survives persisted reload; original remains version1, correction is version2. Never describe these assertions as authenticated digital signatures. |
| A3 | Add a deliberate release reason → **Release to patient portal** for correction **#48** only. | Original **#47** stays unreleased. Release is a recorded action, not an upload side effect. |
| B | Open **/portal**, normal patient login → **My Documents & Signed Consents → Preview Synthetic corrected signed consent**. Then use the second synthetic patient account and direct API negatives. | Only the released own version/signing date appears; original bytes preserved; internal staff notes/audit omitted. Unreleased original and other-patient file return404. |
| C1 | **Radiology & Imaging → New Imaging Request → Select patient → Procedure title** `Synthetic procedure-specific imaging`; enter a synthetic clinical indication → **Send Imaging Request**. Select the new request and attempt **Save Imaging Report** without consent. |409; generic consent cannot satisfy this request. Uploaded procedure file must have correct patient/request/name, date, both signature assertions and active responsible doctor. |
| C2 | In **Procedure-specific radiology consent**, upload the generated file; set signatures/date/doctor **#114**; enter actual returned document ID, clinician ID and audit reason → **Verify this procedure consent → Save Imaging Report**. | Reporting succeeds only after valid verification. The document event identifies order/document/clinician. Changed procedure/correction requires new verification. Cancelled requests remain denied even with earlier consent. |
| C3 | Demonstrate exception only in the disposable fixture after an explicit reasoned policy change. | Without policy/permission/reason, denied. Do not enable exceptions on a client facility merely to ease the demo. |
| D | **System Configuration → Branding & Documents → upload synthetic letterhead as draft → Preview file / Preview on a document → explicitly Activate with reason → Refresh**. | The saved fixture has v1 active, ID30; upload a new draft to replay activation instead of treating an already-active version as a draft. Show upload≠activation and history. Generate a **new** reported study after activation, then print; older study retains historical fallback. |
| E1 | **Reporting Centre → STOCK / GOODS → Inventory by category → Generate report**. |35 items `Synthetic presentation item 00` through `Synthetic presentation item 34`;25 first-page rows. Use the **report's** Next button, not the Goods picker Next. |
| E2 | **PDF** and **Excel**; inspect the actual downloaded files. Optionally change search, regenerate, then export again. | All35 rows, correct values, no truncation, PDF active template on every page; workbook data not forced onto stationery. Empty search clearly returns no records. |
| E3 | **STOCK / GOODS → Stock movements** (recorded movements) in the separate generated Batch1 fixture; dates `2026-01-01`–`2026-01-31`; Generate, filter/clear, PDF/Excel. | Five records; separate nets7 Pieces and80mL, never87 mixed units or a certified closing balance. Sibling/foreign facility attempts denied. |
| E4 | **PRINTABLES → Radiology reports → Request / admission reference → 63 → Preview / Print PDF**. Show an unavailable certificate entry next. | Actual same-facility radiology PDF; unavailable entry explicitly says it cannot generate a report. Do not present the whole catalogue as delivered. |

### Repeatable harness commands (after safe disposable provisioning)

```bash
npm ci
npm run build
npm run build:server
# Set explicit loopback SQL_* for the newly created synthetic database only.
# Independently obtain JALICARE_TEST_PG_SYSTEM_IDENTIFIER and the data directory
# from the cluster you just initialized, not by trusting an arbitrary endpoint.
# Apply scripts/migrate.ts ONLY to those new scratch databases before fixtures.
export SQL_DB_NAME=clinical_documents_synthetic_test
export CLINICAL_DOCUMENTS_SYNTHETIC=YES
export CLINICAL_TEST_PG_DATA_DIRECTORY=/absolute/path/to/new/disposable/pgdata
export CHROME_EXECUTABLE_PATH=/absolute/path/to/controlled/chromium
export CLINICAL_DOCUMENTS_EVIDENCE_DIR=.tmp-tools/presentation-rehearsal
export CLINICAL_DOCUMENTS_KEEP_DEMO_ACCESS=YES
node --import tsx scripts/clinical-documents-acceptance.ts
CLINICAL_DOCUMENTS_EVIDENCE_DIR=.tmp-tools/presentation-rehearsal \
  python scripts/inspect-clinical-document-exports.py

export SQL_DB_NAME=reporting_programme_synthetic_test
export REPORTING_TEST_PG_DATA_DIRECTORY="$CLINICAL_TEST_PG_DATA_DIRECTORY"
export REPORTING_PROGRAMME_SYNTHETIC=YES
export REPORTING_PROGRAMME_EVIDENCE_DIR=.tmp-tools/movement-rehearsal
node --import tsx scripts/reporting-programme-acceptance.ts
python scripts/inspect-reporting-programme-exports.py
```

Use a new evidence directory on reruns so retained acceptance evidence is not overwritten. PyMuPDF is required for saved-file inspection; the native browser needs its runtime libraries. The harness starts/stops its built application process; this is **not a persistent demo deployment**. For a manual rehearsal, start the same built server separately with only the same disposable settings; never copy production credentials. The intentionally synthetic accounts/fixtures are not provisioning instructions for staff roles.

## 7. Remaining failures, external dependencies and mandatory disclosures

- **Unavailable reports remain unavailable:**97 missing implementations,19 definition/source holds, no authenticated original report shortlist. Full clinical templates/certificates, statutory mappings and advanced financial/actual reports were not manufactured. Client must approve sources, period bases, denominators, form versions and acceptance fixtures before implementation/acceptance.
- **Clinical governance:** real signature/doctor authority, approved consent text, procedure-specific applicability, exception policy, patient identity/release/retention and clinical final-issue rules require named owner approval. Scanned signature presence is not electronic signing; no digital certificate/PAdES provider is integrated.
- **Historical release gaps:** master DOC-004 is only partially addressed here (lab/radiology guards). Discharge-finality and immutable official issue/revision/audit policy are not certified or silently marked COMPLETE. Keep the master baseline intact; this narrow report records the delta.
- **Alternative writers:** the retained0100 database trigger uses case-sensitive completion statuses and fires on status transitions. This task corrected and verified mounted-API cancellation/release boundaries, but does **not** certify arbitrary SQL/import writers or post-completion procedure amendments. A reviewed forward hardening migration and related legacy-fixture/import acceptance remain required before claiming universal database enforcement; no historical migration was rewritten or trigger disabled.
- **Branding:** the synthetic template was explicitly activated. Actual Syrona artwork/facility identity, margins, signer/stamp authorization and historical issue policy still need client approval. No silent activation on a real facility.
- **Presentation environment:** supported desktop PDF viewer, physical printer, device/browser fleet, actual staging/host configuration and an authorized presentation account must be preflighted. Headless PDF bytes/frame tests are not a physical-print acceptance.
- **Production/system:** earlier red CI/migration-governance/security/recovery gates are not closed by this presentation suite. No full coverage run, production deployment, restore drill, clinical certification or live-provider acceptance is claimed. The larger Vite chunk remains a build warning.
- **External systems:** PACS/DICOM images, bank/M-Pesa settlement, insurers, SHA/AfyaLink/KHIS and notification delivery were not contacted. Their credentials/contracts cannot be inferred from generated PDFs or local report rows.

**Presentation message:** the selected patient-document, controlled portal and radiology consent journeys work against the actual application with synthetic data, focused unsafe-release/cancellation defects are corrected, and selected source-backed reports produce inspected branded outputs. The system and full Reporting Centre are not complete or production-certified.

## Appendix — every catalogue entry retained

For all12 answers per entry, use [the machine-readable presentation matrix](presentation-readiness-evidence/catalogue-presentation-matrix.json). Master statuses are retained; the screen-open check is independent from backend/report readiness.

| Master ID | Catalogue report | Engine / owning document | Master classification | Presentation classification |
| --- | --- | --- | --- | --- |
| CAT-001 | Sick-off certificates | None | Unavailable | NOT READY |
| CAT-002 | Medical notes | None | Unavailable | NOT READY |
| CAT-003 | Referral letters | None | Unavailable | NOT READY |
| CAT-004 | Inpatient statements | None | Unavailable | NOT READY |
| CAT-005 | Discharge summaries | discharge | Partially supported | NOT READY |
| CAT-006 | Operation notes | None | Unavailable | NOT READY |
| CAT-007 | Anaesthetist notes | None | Unavailable | NOT READY |
| CAT-008 | Bill consent forms | None | Unavailable | NOT READY |
| CAT-009 | Radiology reports | radiology | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-010 | Laboratory reports | laboratory | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-011 | Invoices | invoice | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-012 | Receipts | None | Unavailable | NOT READY |
| CAT-013 | Purchase requisitions | None | Unavailable | NOT READY |
| CAT-014 | Local purchase orders | None | Unavailable | NOT READY |
| CAT-015 | Goods received notes | None | Unavailable | NOT READY |
| CAT-016 | Cashier daily summary | cashier-receipts | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-017 | All-cashier daily summary | cashier-receipts | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-018 | Department receipt summary | None | Unavailable | NOT READY |
| CAT-019 | Department receipt breakdown | None | Unavailable | NOT READY |
| CAT-020 | Managerial daily summary | None | Unavailable | NOT READY |
| CAT-021 | Trial balance | ledger-trial-movements | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-022 | Income statement | ledger-income | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-023 | Balance sheet | ledger-balance-sheet | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-024 | Monthly profit and loss | None | Unavailable | NOT READY |
| CAT-025 | Cash flow statement | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-026 | Budget management | None | Unavailable | NOT READY |
| CAT-027 | Credit notes | None | Unavailable | NOT READY |
| CAT-028 | Waiver reports | None | Unavailable | NOT READY |
| CAT-029 | Income by cashier | None | Unavailable | NOT READY |
| CAT-030 | Departmental revenue | None | Unavailable | NOT READY |
| CAT-031 | Patient outstanding balances | invoice-balances | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-032 | SHA receivables | None | Unavailable | NOT READY |
| CAT-033 | Private insurance receivables | None | Unavailable | NOT READY |
| CAT-034 | M-Pesa reconciliation | None | Unavailable | NOT READY |
| CAT-035 | Card payment reconciliation | None | Unavailable | NOT READY |
| CAT-036 | Refund reports | recorded-refunds | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-037 | Stock usage | None | Unavailable | NOT READY |
| CAT-038 | Stock movements | inventory-movements | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-039 | Goods received | None | Unavailable | NOT READY |
| CAT-040 | Goods returned | None | Unavailable | NOT READY |
| CAT-041 | LPO summaries | purchase-orders | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-042 | Inward invoices | None | Unavailable | NOT READY |
| CAT-043 | Outward invoices | None | Unavailable | NOT READY |
| CAT-044 | Bin cards | None | Unavailable | NOT READY |
| CAT-045 | Inventory by store | inventory-store | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-046 | Inventory by category | inventory-category | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-047 | Expiry reports | inventory-expiry | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-048 | Stock variance | None | Unavailable | NOT READY |
| CAT-049 | Stock transfers | None | Unavailable | NOT READY |
| CAT-050 | Goods price lists | None | Unavailable | NOT READY |
| CAT-051 | Supplier reports | None | Unavailable | NOT READY |
| CAT-052 | Stock valuation | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-053 | Asset register | None | Unavailable | NOT READY |
| CAT-054 | Asset tracking | None | Unavailable | NOT READY |
| CAT-055 | Asset maintenance | None | Unavailable | NOT READY |
| CAT-056 | OPD attendance | outpatient-encounters | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-057 | Consultation reports | None | Unavailable | NOT READY |
| CAT-058 | Diagnosis reports | outpatient-diagnoses | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-059 | Referral reports | None | Unavailable | NOT READY |
| CAT-060 | Doctor workload | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-061 | Current inpatient list | current-inpatients | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-062 | Admissions | inpatient-admissions | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-063 | Discharges | inpatient-discharges | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-064 | Ward occupancy | None | Unavailable | NOT READY |
| CAT-065 | Bed billing | None | Unavailable | NOT READY |
| CAT-066 | Test reports | laboratory-orders | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-067 | Patient reports | None | Unavailable | NOT READY |
| CAT-068 | Specimen reports | None | Unavailable | NOT READY |
| CAT-069 | Sample reports | None | Unavailable | NOT READY |
| CAT-070 | Section reports | None | Unavailable | NOT READY |
| CAT-071 | Pending results | None | Unavailable | NOT READY |
| CAT-072 | Released results | None | Unavailable | NOT READY |
| CAT-073 | Turnaround times | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-074 | Imaging requests | radiology-requests | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-075 | Completed procedures | None | Unavailable | NOT READY |
| CAT-076 | Patient reports | None | Unavailable | NOT READY |
| CAT-077 | Radiology revenue | None | Unavailable | NOT READY |
| CAT-078 | Prescriptions | None | Unavailable | NOT READY |
| CAT-079 | Dispensing | pharmacy-dispensations | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-080 | Drug movement | None | Unavailable | NOT READY |
| CAT-081 | Returns | None | Unavailable | NOT READY |
| CAT-082 | Stock and expiry | None | Unavailable | NOT READY |
| CAT-083 | Procedure lists | None | Unavailable | NOT READY |
| CAT-084 | Patient procedure reports | None | Unavailable | NOT READY |
| CAT-085 | Theatre utilization | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-086 | ANC | None | Unavailable | NOT READY |
| CAT-087 | Deliveries | None | Unavailable | NOT READY |
| CAT-088 | Postnatal | None | Unavailable | NOT READY |
| CAT-089 | Child health | None | Unavailable | NOT READY |
| CAT-090 | Patient sessions | None | Unavailable | NOT READY |
| CAT-091 | Treatment records | None | Unavailable | NOT READY |
| CAT-092 | Session billing | None | Unavailable | NOT READY |
| CAT-093 | Waivers | None | Unavailable | NOT READY |
| CAT-094 | Counselling | None | Unavailable | NOT READY |
| CAT-095 | Patient support reports | None | Unavailable | NOT READY |
| CAT-096 | Birth reports | None | Unavailable | NOT READY |
| CAT-097 | Death reports | None | Unavailable | NOT READY |
| CAT-098 | Current inpatient lists | current-inpatients | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-099 | Patient reports | patient-registrations | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-100 | Patient review reports | None | Unavailable | NOT READY |
| CAT-101 | Unregistered patient reports | None | Unavailable | NOT READY |
| CAT-102 | Referral reports | None | Unavailable | NOT READY |
| CAT-103 | OPD diagnosis reports | outpatient-diagnoses | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-104 | IPD diagnosis reports | None | Unavailable | NOT READY |
| CAT-105 | Triage analysis | None | Unavailable | NOT READY |
| CAT-106 | Doctors' workload | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-107 | Nurses' workload | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-108 | Cashier workload | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-109 | Inpatient discharges | inpatient-discharges | Partially supported | READY WITH DISCLOSED LIMITATION |
| CAT-110 | MOH 505-IDSR | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-111 | MOH 705A | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-112 | MOH 705B | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-113 | MOH 717 | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-114 | MOH 301-IPD admissions | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-115 | MOH 204-OPD register | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-116 | MOH 240 laboratory and radiology reports | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-117 | MOH financial reports | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-118 | Employee list | None | Unavailable | NOT READY |
| CAT-119 | Employee summaries | None | Unavailable | NOT READY |
| CAT-120 | Salary summaries | None | Unavailable | NOT READY |
| CAT-121 | Individual payslips | None | Unavailable | NOT READY |
| CAT-122 | All payslips | None | Unavailable | NOT READY |
| CAT-123 | Attendance | None | Unavailable | NOT READY |
| CAT-124 | Overtime | None | Unavailable | NOT READY |
| CAT-125 | Leave reports | None | Unavailable | NOT READY |
| CAT-126 | Monthly deductions | None | Unavailable | NOT READY |
| CAT-127 | Monthly bank summaries | None | Unavailable | NOT READY |
| CAT-128 | Individual bank summaries | None | Unavailable | NOT READY |
| CAT-129 | P9A reports | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-130 | P10 reports | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-131 | P10A reports | None | Blocked by missing source data or approved business definitions | BLOCKED BY EXTERNAL DEPENDENCY |
| CAT-132 | Locum reports | None | Unavailable | NOT READY |
| CAT-133 | System user list | None | Unavailable | NOT READY |
| CAT-134 | Queue reports | None | Unavailable | NOT READY |
| CAT-135 | Complete activity logs | None | Unavailable | NOT READY |
| CAT-136 | Activity logs by user | None | Unavailable | NOT READY |
| CAT-137 | Failed login reports | None | Unavailable | NOT READY |
| CAT-138 | Patient record access logs | None | Unavailable | NOT READY |
| CAT-139 | Financial approval logs | None | Unavailable | NOT READY |
| CAT-140 | SMS reports | None | Unavailable | NOT READY |
| CAT-141 | Notification delivery reports | None | Unavailable | NOT READY |
| CAT-142 | Messages reports | None | Unavailable | NOT READY |
| CAT-143 | Custom administrative reports | None | Unavailable | NOT READY |
| CAT-144 | Background job failures | None | Unavailable | NOT READY |
