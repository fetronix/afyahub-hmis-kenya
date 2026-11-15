# Reporting Centre completion programme — source audit and controlled delivery plan

## Phase 1 checkpoint (before report implementation)

Verified branch: `arena/e088f11d-afyahub-hmis-kenya`; baseline `f0a3bf20fb50397d7a37512e59522a08c8ded47d`. The restored checkout's Git metadata initially pointed at `0111b55`; all 1,678 published files were compared byte-for-byte with the fetched branch, with no differences, extra unignored files or residual old tracked files. Only then were branch/index metadata fast-forwarded. No working files were replaced, branch switched, reset, clean or history rewrite performed. Working tree was clean at this baseline.

Read `CLINICAL_DOCUMENTS_INITIAL_AUDIT.md` and `CLINICAL_DOCUMENTS_FINAL_ACCEPTANCE.md`; inspected `report-catalogue.ts`, engine definitions, operational/ledger query plans, `generateReport`, authorization, selector validation, route/export renderer, workbench and actual schema modules. The complete **144-row** preimplementation requirements matrix is `REPORTING_PROGRAMME_BASELINE_MATRIX.md` and its companion JSON. It lists proposed intended users, business group, schema-verified candidate entities, integrated API/engine, supported filters, exports, letterhead, actual status, missing implementation and specific risks. Proposed audiences and candidate sources for missing workflows are requirements, not approved role grants or evidence of functioning reports. Source paths are in JSON.

Baseline classification: **0 fully certified complete, 27 partial (23 subset entries / 19 engines + four document workflows), 117 unavailable**. Prior synthetic evidence remains historical evidence; it is not fresh certification of the full catalogue. The original 144 labels are preserved. Existing individual source-module APIs, menus and tables are not counted as an integrated report.

### Reuse and boundaries

- Keep `/api/reporting/centre/:engine/{options,generate,export}`, the existing workbench/selection controls, `REPORT_ENGINES`, scoped static query plans, repeatable-read query/audit transaction and the active-facility common PDF renderer. No second report API/application/schema.
- Existing shared date validation caps inclusive ranges at 366 days; strict whitelist rejects unsupported filters. Existing selection services ownership-check chosen records. Domain + report permissions, facility scope and enabled/hidden module policy are enforced server-side.
- Existing exports cap at 1,000 rows and refuse larger sets. PDF/Print PDF shares the active facility letterhead renderer; XLSX/CSV preserve data and explicit unknowns. Screen pages are not the export boundary.
- Actual source semantics remain distinct: stock movements are operational quantity evidence; billing payments are not reconciled settlements; journals must be posted; budgets/projections are not purchases or actual expenditure. Do not fill missing values with zero.
- Laboratory `lab_results.status='Verified'`/`verified_at` is not a separate release event. The existing verification workflow requires specimen identity. “Pending/released results” cannot be completed by renaming a status query without approving partial/cancelled order and release semantics.
- Current admissions/bed references are not historical ward occupancy; ward utilisation needs event-time capacity and denominator definitions. Clinical notes are not automatically approved signed certificates. Official MOH/KRA forms require versioned definitions and approval.

## Phase 2 — operational importance and delivery order

The facility has not supplied its exact go-live/presentation report list. The following is a **proposed immediate shortlist**, based on existing architecture/source reliability, not an invented facility-approved requirement. Confirm it with clinical, stores and finance owners before production use.

| Business importance group | Proposed immediate operations/presentation shortlist | Reliable source / next controlled batch | Deferrals and reason |
| --- | --- | --- | --- |
| 1. Patient and clinical operations | Patient registrations; controlled discharge/clinical documents; referral register | Existing patient registers and scoped document builders; later integrate referral state register | Sick-off, medical/operation/anaesthetic certificates need approved content, credentials and signature lifecycle; maternity/dialysis clinical aggregates need scoped acceptance |
| 2. OPD, admissions and inpatient activity | Recorded OPD attendance/diagnoses, admissions, discharges, current inpatients | Existing engines; re-accept exact operational scopes with clinical owner, then recorded referral activity | Workload, occupancy percentages and bed billing require encounter/denominator/night-policy definitions; no current-row reconstruction of history |
| 3. Laboratory and radiology | Recorded orders/requests; existing authorized individual report PDFs | Existing engines first; later specimen accession register from `lab_specimens` + explicit links | Pending/released/TAT need defined cancellation/partial/release/timing semantics; imaging revenue needs exact billing attribution |
| 4. Pharmacy and inventory | Dispensing, stock by item/store/category, expiry, **recorded stock movements** | **Batch 1: stock movements**, using the recorded `inventory_movements` register and safe item links; no schema change | Bin-card openings, historical store balances, valuation and patient returns require explicit provenance and policy. No mixed-item/unit quantity total |
| 5. Billing, collections and revenue | Outstanding invoice balances, recorded receipts/refunds, finalized invoice/receipt PDFs | Existing reports; later reuse authorized receipt PDF picker | Departmental revenue and managerial cash summaries need source attribution; callbacks/claims are not bank reconciliation or revenue |
| 6. Expenses, procurement and budgets | LPOs, GRNs/requisitions, posted/approved expense register and separate plan versions | Next candidates: existing GRN/LPO PDFs, approved requisition register; then expense state register | Supplier credit vs patient credit, incurred vs paid vs posted expenses and budget/actual comparisons must be approved separately |
| 7. Accounting and financial statements | Posted trial movements, income and as-of balance sheet subsets | Existing scoped ledger engines; finance validates classifications/openings/periods before labels are expanded | Cash flow, equity finalisation, depreciation and valuation must not infer mappings, full statements or final reviewed balances |
| 8. Management and statutory reporting | A restricted operational presentation pack of accepted reports; source-qualified metrics | Accept prior operational engines; restricted HR employee register is a later candidate with dedicated permissions | MOH/KHIS/KRA statutory forms, HR bank details, arbitrary audit JSON, SMS delivery and global jobs need definitions, source evidence, privacy review and sign-off |

### Batch 1 approved implementation scope for this engineering pass

One existing unavailable entry: `stock-goods-stock-movements`. Implement a **recorded movement register**, not valuation, stock usage, a historical balance reconstruction or a ledger.

- Source: `inventory_movements` (migration 0077; producer services append records, but no DB immutability trigger established), left joined only to same-facility `inventory_items`. `tenant_id` and `facility_id` predicates belong to movement rows. Current item code/name/unit are explicitly labelled current metadata; absent/mismatched item links are withheld and flagged.
- Required inclusive `movement_date` range; optional literal search, movement-type/status and ownership-checked item selection. No invented department selector because movements have no trusted department identity. Movement types include RECEIPT, DISPENSE, ADJUSTMENT, WRITE_OFF, COUNT_VARIANCE, TRANSFER_IN/OUT, RETURN_OUT; unknown source types remain visible when unfiltered.
- Display recorded delta/stock-after and **per-item net delta within the currently selected filters**. Compute the window before pagination, partition by item ID; never sum different items or units. This is not opening/closing stock, valuation, purchases or posted accounting. Transfers preserve both recorded legs; paired transfer legs can net to zero for an item without implying no activity.
- Reuse existing permissions `reports.read`, `reports.export`, `inventory.read`; no permission grants, migration or source writes. Keep missing values explicit and disclose current metadata/historical coverage limits.
- The catalogue entry remains **partial** even after batch acceptance because broader historical completeness is not established. Acceptance is for this precisely bounded register; do not inflate the fully functional count.

### Per-report acceptance gate (applies to every later batch)

1. Freeze source/meaning, owner and filter/calculation specification before code.
2. Synthetic real PostgreSQL/HTTP fixtures: two facilities in one tenant plus a second tenant; source-domain/report/export denials; disabled module; date boundaries/reversed/invalid ranges; supported selectors; empty results; calculation truth from raw records; pagination/export parity; audit persistence/failure behavior.
3. Actual built SPA and authenticated browser: open catalogue entry, generate/filter, inspect displayed source values, empty/error states and request/export buttons; no in-memory server adapters.
4. Save actual PDF/XLSX, parse their contents, verify exact values, full filtered scope and active facility letterhead/page numbering. Visually inspect representative rendered PDF and screen output. A downloaded filename or menu is not acceptance.
5. Record executed tests, warnings, omitted suites and limitations, update current matrix/counts only to the demonstrated scope, review task-only changes, commit and normal push to this branch. Push is not deployment.

## Safety and programme boundary

Use only a newly provisioned, independently identified disposable loopback PostgreSQL cluster and synthetic fixtures. Do not load deployment credentials or connect to production. Do not weaken authorization, consent, ledger integrity, source contracts or schema-extraction baselines. No data reset, source-module redesign or broad refactor is in scope. Additional batches remain explicitly queued; this pass does not promise 144-report completion.

## Batch 1 outcome

Bounded stock-movement register accepted with real synthetic PostgreSQL, authenticated built-browser workflow and inspected PDF/XLSX downloads. See `REPORTING_PROGRAMME_BATCH_1_ACCEPTANCE.md` for precise evidence, remaining gaps and reproducibility. Current classification: **144 total, 0 fully certified complete, 28 partial, 116 unavailable; one newly implemented bounded subset**. The baseline snapshot remains frozen; current matrix clarifies proposed business audiences and candidate source requirements without granting access. Further batches are queued, not implemented by this pass.
