# Report Centre inventory — Phase 4

**Inspection date:** 2026-10-27 (UTC). **Boundary:** source and synthetic evidence on `arena/e088f11d-afyahub-hmis-kenya`; not facility UAT or statutory acceptance. This is a fresh re-inventory of `src/reporting/report-catalogue.ts` and the engine definitions/SQL, not an assumption based on the older audit.

**Reconciled count:** 144 unique entries in seven categories: **23 entries linked to 19 limited engines**, **1 existing invoice-document workflow**, and **120 unavailable**. Before this slice there were 21 linked entries / 18 engines, one workflow and 122 unavailable. A linked engine does not mean the full named report is complete. Every one of the 144 entries is listed below; the profile linked in each row specifies its UI/API, source/query, scope/permissions, filters/date, exports/print and test evidence.

| Category | Entries | Linked to limited engines | Invoice workflow | Unavailable |
| --- | ---: | ---: | ---: | ---: |
| PRINTABLES | 15 | 0 | 1 | 14 |
| FINANCIAL | 21 | 7 | 0 | 14 |
| STOCK/GOODS | 19 | 4 | 0 | 15 |
| DEPARTMENTAL | 40 | 8 | 0 | 32 |
| RECORDS | 22 | 4 | 0 | 18 |
| HR | 15 | 0 | 0 | 15 |
| ACTIVITY | 12 | 0 | 0 | 12 |
| **Total** | **144** | **23** | **1** | **120** |

## Common engine contract

- UI: `ReportCentre.tsx` → `ReportWorkbench.tsx` and `ReportSelectionPicker.tsx`; shared `REPORT_CATEGORIES` and `REPORT_ENGINES`. The browser lists entries even when unavailable, but does not offer a fake generator. Engines are deliberately labelled operational subsets.
- API: authenticated `POST /api/reporting/centre/{engine}/options`, `/generate`, `/export`; `generate` optionally requests `intent=print`. Query plans are static SQL in `report-centre.service.ts`, `report-centre.operational-queries.ts` and `report-centre.ledger-queries.ts`; parameters are bound. `report-centre.auth.ts` resolves the selected facility and its owning tenant; requires enabled, unhidden `analytics` and source modules and a facility account, not platform `SUPER_ADMIN`. Every profile’s permissions are server-enforced. Print/export additionally require `reports.export` and any profile-specific export permission. Facility switching does not authorize another tenant.
- Selectors are scoped, audited, search/paged (max 25), and validate selected IDs server-side. Multi-selects are limited to 20 distinct IDs; an empty selection means All. General selectors use registration facility for patients; the new diagnosis profile instead requires a same-tenant outpatient encounter at the selected facility, including patients registered elsewhere. Staff selection also needs `users.read`; pharmacy inventory selection also needs `inventory.read`; receipt selection also needs `patients.read`. See `report-centre.selection.ts` for per-kind scope and dependencies.
- The server validates filters (literal search, 80 characters; selected IDs and status; valid inclusive date range of at most 366 days when used), pages (1–100; offset at most 1,000,000) and max **1,000 full filtered export rows**. Only the diagnosis profile requires a date range; ledger balance sheet requires an as-of date. Without a range, some engines include all recorded dates, including future dates. Most timestamp columns are without timezone: dates are recorded database calendar dates, not independently verified local event times; textual inpatient/expiry dates use validated ISO prefixes and flag exclusions. The count is for the full filtered snapshot, not only the page. Pages are live snapshots, so they can change between requests.
- Output: browser table and authorized, audited **current-page** print; PDF, XLSX and CSV of the full filtered set up to 1,000. Filters/notes are retained. CSV neutralizes spreadsheet formula leaders; XLSX uses text cells. Unsupported control characters or PDF glyphs fail rather than silently mutate text. Audit records request intent, counts and filter field names without search terms or patient identifiers; unique visible patient access is separately logged. Audit failures prevent returning report data. An audit is a request, not proof of physical delivery.
- Tests: generic view/scope/audit/export in `src/tests/integration/report-centre.db.spec.ts`, selection in `report-centre-selectors.db.spec.ts`, UI in `src/tests/vitest/report-centre-ui.spec.tsx`, CSV in `report-centre-export.spec.ts`; `scripts/report-centre-browser-synthetic.mjs` provides synthetic Chromium/HTTP/PostgreSQL evidence when run. A historical run rendered **23/23 linked catalogue journeys across 19 engines**, but its purchase order, dispensing, receipt and posted journal were directly seeded, so it did not verify those workflows. The repaired driver subsequently failed reopening a finalized invoice; an independent reproduction confirmed the stale same-selection panel, and that failure remains documented. After correction, focused and full synthetic Chromium passed, including **23/23** catalogue checks and the audited invoice print; a fresh DB-required regression passed **249 files / 2,296 tests**, with no failures or skips. See the [Phase 4 report](../completion-phases/PHASE-4-REPORTING-COMPLIANCE.md) for fixture provenance, prior failures and exact limitations. Profile-specific tests below identify additional coverage; they are not complete acceptance of every catalogue name.

### Unavailable catalogue entry

**UI:** selectable catalogue name and dependency text only. **API/engine/query/tables:** none for that entry; underlying tables/workflows may exist but are not an implemented centre report. **Permission/scope:** only catalogue visibility (`reports.read`, facility account and analytics module); no report-specific authorization or scope can be claimed until implemented. **Filters/date/export/print:** none. **Tests:** generic unavailable-state UI tests, not a dedicated calculation/export test. **Acceptance:** in addition to the row’s named dependency, define authoritative source/grain, ownership, required roles, event/date/null/deduplication semantics, validated scoped selectors, audited bounded calculation and export, reconciliation, and facility/authority UAT. Do not infer an official report from underlying tables.

### Invoice-document workflow

**UI/API:** the PRINTABLES Invoices entry reuses `FinalizedInvoicePanel`; `/centre/invoice-document/options` plus `GET /api/invoices/:id/finalization` and `POST /api/invoices/:id/print-access`. No separate report engine. **Source:** scoped `billing_invoices`, finalized snapshot/line and clinical evidence via `finalized-invoice.service.ts`. **Permissions/scope:** centre selector and UI require `reports.read`, `reports.export`, `billing.read`, `clinical.read`, `patients.read`, enabled analytics/finance and selected tenant/facility; invoice endpoints separately require billing/clinical read and scoped ownership. **Filters/date:** required single scoped invoice selector with search/pages (selection required to open), not an aggregate date report. **Output:** existing audited browser print of finalized document; unfinalized state is explicit, not centre CSV/XLSX/PDF. **Tests:** `report-centre.db.spec.ts`, `report-centre-selectors.db.spec.ts`, `finalized-invoices.db.spec.ts`, `report-centre-invoice-ui.spec.tsx` and synthetic browser script; the latter verified a printed synthetic PDF and access audit. **Gap:** facility-approved print template, physical print and production/facility acceptance; document print is not payment/claim settlement.

## Engine profiles

### patient-registrations

**UI/API:** shared engine workbench and `/centre/patient-registrations/{options,generate,export}`. **Source/query:** `patients` by `tenant_id` and first `registration_facility_id`; one patient row, ordered by creation.
**Scope/permission:** selected tenant/facility; analytics + `registration` modules; `reports.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient; optional inclusive Recorded patient creation date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; First-registration facility is not a permanent facility; patients registered elsewhere and unregistered people are not included. Creation time is the recorded patient-row timestamp, not independently verified arrival or visit time. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### inventory-expiry

**UI/API:** shared engine workbench and `/centre/inventory-expiry/{options,generate,export}`. **Source/query:** `inventory_batches` → `inventory_items` → `facilities`; current remaining quantity per batch; invalid ISO expiry dates are retained/flagged outside filtered periods.
**Scope/permission:** selected tenant/facility; analytics + `inventory` modules; `reports.read`, `inventory.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, inventory items (multi); optional inclusive Recorded expiry date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; This is a current batch snapshot, not a movement ledger or stock valuation. Quantities in different units are not added together. Only valid ISO calendar dates can be filtered; other recorded dates remain visible without a date range and are counted for review.

### outpatient-encounters

**UI/API:** shared engine workbench and `/centre/outpatient-encounters/{options,generate,export}`. **Source/query:** `encounters` + tenant-matched `patients`, facility-matched `departments`/`practitioners`; `OUTPATIENT` encounters and recorded status.
**Scope/permission:** selected tenant/facility; analytics + `opd` modules; `reports.read`, `clinical.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, department, staff, status: `PLANNED`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `CANCELLED`; optional inclusive Recorded encounter start date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; An encounter is a recorded visit, not independent proof of arrival, consultation completion or a unique patient. The staff filter uses the linked practitioner user ID; unlinked names are not guessed. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### outpatient-diagnoses

**UI/API:** shared engine workbench and `/centre/outpatient-diagnoses/{options,generate,export}`. **Source/query:** Facility/tenant `encounters` + tenant-matched `patients` + facility `departments` LEFT JOIN `diagnoses` by encounter. A patient-inconsistent diagnosis is withheld and flagged; one row per linked diagnosis or per diagnosis-free encounter.
**Scope/permission:** selected tenant/facility; analytics + `opd` modules; `reports.read`, `clinical.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, department, status: `PENDING`, `COMPLETED`, `CANCELLED`, `UNKNOWN`; required inclusive Recorded encounter start date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-diagnoses.db.spec.ts` and UI/CSV tests; raw source reconciliation and adversarial synthetic HTTP tests. **Acceptance/gaps:** operational subset only; One row per linked diagnosis record, or one row for an encounter without a diagnosis; the total is not a count of patients or cases. Duplicate records are not merged. Pending means the encounter status is PLANNED, ACTIVE or ON_HOLD; completed and cancelled reflect the recorded encounter status only, not proof of clinical completion or diagnosis confirmation. Other statuses are unknown. Diagnosis status and coding fields are shown as recorded. Missing or inconsistent patient links withhold diagnosis details; missing code, release or diagnosis status is flagged. No ICD-10 history is recoded or WHO validity inferred. This operational register is not an MOH 705, statutory morbidity calculation or KHIS submission. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### inpatient-admissions

**UI/API:** shared engine workbench and `/centre/inpatient-admissions/{options,generate,export}`. **Source/query:** `admissions` + tenant `patients` + facility `wards` + ward `beds`; one admission, current ward/bed references.
**Scope/permission:** selected tenant/facility; analytics + `inpatient` modules; `reports.read`, `inpatient.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, ward, bed; optional inclusive Recorded admission date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Ward and bed are the current recorded references, not a reconstructed admission-time transfer history. Only valid ISO date prefixes can be filtered; missing or invalid dates are counted and excluded when a range is applied. Admission times are shown as recorded; manually corrected times and their origin require review. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### inpatient-discharges

**UI/API:** shared engine workbench and `/centre/inpatient-discharges/{options,generate,export}`. **Source/query:** Same admission joins, `discharge_date IS NOT NULL`; status is shown separately, not inferred.
**Scope/permission:** selected tenant/facility; analytics + `inpatient` modules; `reports.read`, `inpatient.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, ward, bed; optional inclusive Recorded discharge date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; A recorded discharge time is shown alongside the status; it is not proof that all discharge work or billing is complete. Only valid ISO date prefixes can be filtered; invalid dates are counted and excluded when a range is applied. Historical discharge times are shown as recorded without inferring a timezone. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### laboratory-orders

**UI/API:** shared engine workbench and `/centre/laboratory-orders/{options,generate,export}`. **Source/query:** `lab_orders` + tenant `patients`; one order with recorded specimen/status/times, not independently verified/released results.
**Scope/permission:** selected tenant/facility; analytics + `laboratory` modules; `reports.read`, `laboratory.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, lab test, services (multi), status: `Ordered`, `Sample Collected`, `Completed`, `Published`; optional inclusive Recorded order date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Test and service filters use recorded IDs only; historical or free-text orders with no matching link are not inferred. Orders are not verified results. Completion and release cannot be inferred from the order alone. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### radiology-requests

**UI/API:** shared engine workbench and `/centre/radiology-requests/{options,generate,export}`. **Source/query:** `radiology_orders` + tenant `patients`; one request/status, not proof of procedure completion.
**Scope/permission:** selected tenant/facility; analytics + `radiology` modules; `reports.read`, `clinical.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, services (multi), status: `Requested`, `Reported`; optional inclusive Recorded request date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; The service filter uses recorded facility-service IDs only; unlinked historical or free-text requests remain excluded when selected. An imaging request is not proof of a performed procedure or an externally verified report. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### pharmacy-dispensations

**UI/API:** shared engine workbench and `/centre/pharmacy-dispensations/{options,generate,export}`. **Source/query:** `pharmacy_dispensations` + tenant `patients`; per event recorded quantity, item/unit/price-independent snapshots and batch; no aggregate across units.
**Scope/permission:** selected tenant/facility; analytics + `pharmacy` modules; `reports.read`, `pharmacy.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, inventory items (multi); optional inclusive Recorded dispensation date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; This reports dispensation events, not prescribed quantity, a full stock movement ledger, returns, or reconciled charges. The item filter uses the recorded inventory-item ID only; unlinked historical events are not guessed. Missing historical item snapshots are left unknown; current inventory is not substituted. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### cashier-receipts

**UI/API:** shared engine workbench and `/centre/cashier-receipts/{options,generate,export}`. **Source/query:** `billing_payments` JOIN scoped `billing_invoices`; grouped by recorded payment date, cashier and method; counts and sums of positive finite amounts; invalid amounts flagged.
**Scope/permission:** selected tenant/facility; analytics + `finance` modules; `reports.read`, `billing.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, receipt; optional inclusive Recorded payment date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Recorded receipts are not reconciled bank/provider settlements, recognized revenue or cash on hand. Refunds are not deducted here. Cashier is recorded free text, not a verified staff identity. Unknown, non-finite or non-positive amounts are excluded from the known total and counted. Selecting a receipt narrows the grouped totals to that recorded payment; it is not provider reconciliation. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates.

### recorded-refunds

**UI/API:** shared engine workbench and `/centre/recorded-refunds/{options,generate,export}`. **Source/query:** `billing_refunds` JOIN same-tenant/facility `billing_invoices`; recorded manual refund rows, positive finite amounts only in known total.
**Scope/permission:** selected tenant/facility; analytics + `finance` modules; `reports.read`, `billing.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, staff; optional inclusive Recorded refund date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; A manual refund record is not proof that an external transfer occurred or was reconciled. Only invoices matching the refund tenant and facility are shown; inconsistent links require review. Unknown, non-finite or non-positive amounts are excluded from the known total and flagged. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates.

### invoice-balances

**UI/API:** shared engine workbench and `/centre/invoice-balances/{options,generate,export}`. **Source/query:** `billing_invoices` + tenant `patients`; nonvoided invoices with nonzero or invalid/unknown balance; known nonnegative balances summed.
**Scope/permission:** selected tenant/facility; analytics + `finance` modules; `reports.read`, `billing.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, invoice; optional inclusive Recorded invoice creation date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-operational.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; A current invoice-header snapshot, not a historical as-of balance, verified receivable, insurer balance or reconciled ledger. Unknown, non-finite or negative balances are flagged rather than treated as zero or subtracted from receivables. Dates are the recorded database calendar dates; these legacy timestamps do not record a timezone. Review historical timestamp origin before using them as local event dates. Missing or out-of-scope patient links are not inferred or matched by name and are counted for review.

### ledger-trial-movements

**UI/API:** shared engine workbench and `/centre/ledger-trial-movements/{options,generate,export}`. **Source/query:** `chart_of_accounts` + `journal_lines` + matching tenant/facility `journal_entries`, POSTED only, grouped per account; scoped posted journal/account mismatch blocks.
**Scope/permission:** selected tenant/facility; analytics + `accounting` modules; `reports.read`, `accounting.read`. Additional print/export: `accounting.reports.export`.
**Filters/date:** literal text search, accounts (multi); optional inclusive Journal entry date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-ledger.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; A date range shows movements in that period, without an opening balance; it is not an as-of trial balance. Without a range, all posted journal dates are included, including any future-dated postings. Only posted, facility-scoped journal lines are included; reversals are separate posted entries. Posted journal/account scope mismatches block the report for finance review; other inconsistent references are flagged. Billing, payments, claims and costs may not be posted or reconciled. These views are not complete, certified financial statements. The underlying journal service records KES cents. Summaries follow the selected account search; a filtered subset is not a complete statement.

### ledger-income

**UI/API:** shared engine workbench and `/centre/ledger-income/{options,generate,export}`. **Source/query:** Same ledger joins; revenue = credits − debits, expenses = debits − credits, result = revenue − expense; only posted REVENUE/EXPENSE accounts.
**Scope/permission:** selected tenant/facility; analytics + `accounting` modules; `reports.read`, `accounting.read`. Additional print/export: `accounting.reports.export`.
**Filters/date:** literal text search, accounts (multi); optional inclusive Journal entry date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-ledger.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Revenue uses credits less debits; expense uses debits less credits. Negative amounts are preserved. Without a range, all posted journal dates are included, including any future-dated postings. Only posted, facility-scoped journal lines are included; reversals are separate posted entries. Posted journal/account scope mismatches block the report for finance review; other inconsistent references are flagged. Billing, payments, claims and costs may not be posted or reconciled. These views are not complete, certified financial statements. The underlying journal service records KES cents. Summaries follow the selected account search; a filtered subset is not a complete statement.

### ledger-balance-sheet

**UI/API:** shared engine workbench and `/centre/ledger-balance-sheet/{options,generate,export}`. **Source/query:** Same ledger joins; asset/expense = debits − credits; liability/equity/revenue = credits − debits; posted through as-of date, accumulated result included in equity summary.
**Scope/permission:** selected tenant/facility; analytics + `accounting` modules; `reports.read`, `accounting.read`. Additional print/export: `accounting.reports.export`.
**Filters/date:** literal text search, accounts (multi); required inclusive as-of As-of date. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre-ledger.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Revenue and expense accounts are included to show their contribution to the posted accumulated result; formal closing entries require accounting review. Assets and expenses use debits less credits; liabilities, equity and revenue use credits less debits. Only posted, facility-scoped journal lines are included; reversals are separate posted entries. Posted journal/account scope mismatches block the report for finance review; other inconsistent references are flagged. Billing, payments, claims and costs may not be posted or reconciled. These views are not complete, certified financial statements. The underlying journal service records KES cents. Summaries follow the selected account search; a filtered subset is not a complete statement.

### inventory-category

**UI/API:** shared engine workbench and `/centre/inventory-category/{options,generate,export}`. **Source/query:** `inventory_items` JOIN `facilities`; current item stock ordered by free-text category, not a valuation or movement ledger.
**Scope/permission:** selected tenant/facility; analytics + `inventory` modules; `reports.read`, `inventory.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, inventory items (multi), status: `active`, `inactive`, `unknown`; no date filter; current/live snapshot. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; This is a current item snapshot, not a stock movement ledger or historical valuation. Blank values are not treated as zero. Quantities in different units are not added together.

### inventory-store

**UI/API:** shared engine workbench and `/centre/inventory-store/{options,generate,export}`. **Source/query:** `inventory_items` JOIN `facilities`; current stock ordered by free-text store location, not a verified store master.
**Scope/permission:** selected tenant/facility; analytics + `inventory` modules; `reports.read`, `inventory.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, inventory items (multi), status: `active`, `inactive`, `unknown`; no date filter; current/live snapshot. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Store location is free text on the inventory item, not a verified store master or transfer ledger. This is a current snapshot; quantities in different units are not added together.

### purchase-orders

**UI/API:** shared engine workbench and `/centre/purchase-orders/{options,generate,export}`. **Source/query:** `purchase_orders` LEFT JOIN tenant `suppliers`; one purchase order with expected delivery/status/recorded value; no supplier-payment inference.
**Scope/permission:** selected tenant/facility; analytics + `procurement` modules; `reports.read`, `procurement.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, supplier, purchase order, status: `Pending Approval`, `Approved`, `Rejected`, `Completed`, `Cancelled`, `__unknown__`; optional inclusive Expected delivery date range, at most 366 days. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; Order values are recorded purchase-order amounts, not supplier invoices, payments or reconciled expenditure. When a delivery-date range is applied, orders without an expected delivery date are excluded and counted.

### current-inpatients

**UI/API:** shared engine workbench and `/centre/current-inpatients/{options,generate,export}`. **Source/query:** `admissions` + tenant `patients` + facility `wards` + ward `beds`, status = `Admitted`; current snapshot, not occupancy history.
**Scope/permission:** selected tenant/facility; analytics + `inpatient` modules; `reports.read`, `inpatient.read`, `patients.read`. Additional print/export: none beyond `reports.export`.
**Filters/date:** literal text search, patient, ward, bed; no date filter; current/live snapshot. **Output:** common bounded print/PDF/XLSX/CSV contract above.
**Tests:** `src/tests/integration/report-centre.db.spec.ts` plus shared selector/UI/export tests. **Acceptance/gaps:** operational subset only; A live snapshot of records marked Admitted; it is not a historical admission or discharge register. Admission times are shown as recorded; historical timezone and manually corrected times require review.

## Every catalogue entry

The linked profile defines the complete implementation facts for that entry. **Partial** means a limited operational subset or existing document, not the full catalogue promise; **Missing** means no dedicated centre engine. Gap text is re-read from the current catalogue; the shared profile acceptance criteria also apply. National form names and descriptions in this table reproduce catalogue labels, not verified official meanings or specifications.

| Category / group | Report (catalogue ID) | Delivery, source, permissions, filters, output and tests | Gap / acceptance dependency |
| --- | --- | --- | --- |
| PRINTABLES | Sick-off certificates (`printables-sick-off-certificates`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved certificate, signatory and output. |
| PRINTABLES | Medical notes (`printables-medical-notes`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Signed print template and referral workflow. |
| PRINTABLES | Referral letters (`printables-referral-letters`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Signed print template and referral workflow. |
| PRINTABLES | Inpatient statements (`printables-inpatient-statements`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved integrated printable output and clinical sign-off. |
| PRINTABLES | Discharge summaries (`printables-discharge-summaries`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved integrated printable output and clinical sign-off. |
| PRINTABLES | Operation notes (`printables-operation-notes`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Structured authorized notes and approved printable output. |
| PRINTABLES | Anaesthetist notes (`printables-anaesthetist-notes`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Structured authorized notes and approved printable output. |
| PRINTABLES | Bill consent forms (`printables-bill-consent-forms`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Financial-consent workflow, signatory and approved template. |
| PRINTABLES | Radiology reports (`printables-radiology-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Verified released result and approved print template. |
| PRINTABLES | Laboratory reports (`printables-laboratory-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Verified released result and approved print template. |
| PRINTABLES | Invoices (`printables-invoices`) | **Partial** — [invoice document](#invoice-document-workflow) | Facility-approved template, physical print and production/facility acceptance unverified. |
| PRINTABLES | Receipts (`printables-receipts`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Standalone receipt print template. |
| PRINTABLES | Purchase requisitions (`printables-purchase-requisitions`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Requisition or receiving workflow and approved template. |
| PRINTABLES | Local purchase orders (`printables-local-purchase-orders`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved LPO output and print validation. |
| PRINTABLES | Goods received notes (`printables-goods-received-notes`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Requisition or receiving workflow and approved template. |
| FINANCIAL | Cashier daily summary (`financial-cashier-daily-summary`) | **Partial** — [`cashier-receipts`](#cashier-receipts) | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | All-cashier daily summary (`financial-all-cashier-daily-summary`) | **Partial** — [`cashier-receipts`](#cashier-receipts) | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | Department receipt summary (`financial-department-receipt-summary`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | Department receipt breakdown (`financial-department-receipt-breakdown`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | Managerial daily summary (`financial-managerial-daily-summary`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | Trial balance (`financial-trial-balance`) | **Partial** — [`ledger-trial-movements`](#ledger-trial-movements) | Opening balances, posting completeness, mappings and source reconciliation; the available view is posted account movements only. |
| FINANCIAL | Income statement (`financial-income-statement`) | **Partial** — [`ledger-income`](#ledger-income) | Posting completeness, recognized revenue/cost policies, account mappings and source reconciliation. |
| FINANCIAL | Balance sheet (`financial-balance-sheet`) | **Partial** — [`ledger-balance-sheet`](#ledger-balance-sheet) | Posting completeness, opening balances, classification, account mappings and source reconciliation. |
| FINANCIAL | Monthly profit and loss (`financial-monthly-profit-and-loss`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Auto posting, mappings, costs and source reconciliation; current statements are not complete. |
| FINANCIAL | Cash flow statement (`financial-cash-flow-statement`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | Budget management (`financial-budget-management`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | Credit notes (`financial-credit-notes`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | Waiver reports (`financial-waiver-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | Income by cashier (`financial-income-by-cashier`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | Departmental revenue (`financial-departmental-revenue`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | Patient outstanding balances (`financial-patient-outstanding-balances`) | **Partial** — [`invoice-balances`](#invoice-balances) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | SHA receivables (`financial-sha-receivables`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | Private insurance receivables (`financial-private-insurance-receivables`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | M-Pesa reconciliation (`financial-m-pesa-reconciliation`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | Card payment reconciliation (`financial-card-payment-reconciliation`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | Refund reports (`financial-refund-reports`) | **Partial** — [`recorded-refunds`](#recorded-refunds) | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| STOCK / GOODS | Stock usage (`stock-goods-stock-usage`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | Stock movements (`stock-goods-stock-movements`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | Goods received (`stock-goods-goods-received`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | Goods returned (`stock-goods-goods-returned`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | LPO summaries (`stock-goods-lpo-summaries`) | **Partial** — [`purchase-orders`](#purchase-orders) | Complete filtered/exportable report. |
| STOCK / GOODS | Inward invoices (`stock-goods-inward-invoices`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Stock-linked invoice classification and matching. |
| STOCK / GOODS | Outward invoices (`stock-goods-outward-invoices`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Stock-linked invoice classification and matching. |
| STOCK / GOODS | Bin cards (`stock-goods-bin-cards`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Location-aware movement ledger, stocktake and transfers. |
| STOCK / GOODS | Inventory by store (`stock-goods-inventory-by-store`) | **Partial** — [`inventory-store`](#inventory-store) | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | Inventory by category (`stock-goods-inventory-by-category`) | **Partial** — [`inventory-category`](#inventory-category) | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | Expiry reports (`stock-goods-expiry-reports`) | **Partial** — [`inventory-expiry`](#inventory-expiry) | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | Stock variance (`stock-goods-stock-variance`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Location-aware movement ledger, stocktake and transfers. |
| STOCK / GOODS | Stock transfers (`stock-goods-stock-transfers`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Location-aware movement ledger, stocktake and transfers. |
| STOCK / GOODS | Goods price lists (`stock-goods-goods-price-lists`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | Supplier reports (`stock-goods-supplier-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | Stock valuation (`stock-goods-stock-valuation`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | Asset register (`stock-goods-asset-register`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Mounted asset, movement and maintenance workflows. |
| STOCK / GOODS | Asset tracking (`stock-goods-asset-tracking`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Mounted asset, movement and maintenance workflows. |
| STOCK / GOODS | Asset maintenance (`stock-goods-asset-maintenance`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Mounted asset, movement and maintenance workflows. |
| DEPARTMENTAL / OPD | OPD attendance (`departmental-opd-opd-attendance`) | **Partial** — [`outpatient-encounters`](#outpatient-encounters) | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL / OPD | Consultation reports (`departmental-opd-consultation-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL / OPD | Diagnosis reports (`departmental-opd-diagnosis-reports`) | **Partial** — [`outpatient-diagnoses`](#outpatient-diagnoses) | Recorded encounter/diagnosis register only; deduplicated morbidity, verified MOH 705 definitions and facility acceptance remain outstanding. |
| DEPARTMENTAL / OPD | Referral reports (`departmental-opd-referral-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL / OPD | Doctor workload (`departmental-opd-doctor-workload`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL / INPATIENT | Current inpatient list (`departmental-inpatient-current-inpatient-list`) | **Partial** — [`current-inpatients`](#current-inpatients) | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL / INPATIENT | Admissions (`departmental-inpatient-admissions`) | **Partial** — [`inpatient-admissions`](#inpatient-admissions) | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL / INPATIENT | Discharges (`departmental-inpatient-discharges`) | **Partial** — [`inpatient-discharges`](#inpatient-discharges) | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL / INPATIENT | Ward occupancy (`departmental-inpatient-ward-occupancy`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL / INPATIENT | Bed billing (`departmental-inpatient-bed-billing`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL / LABORATORY | Test reports (`departmental-laboratory-test-reports`) | **Partial** — [`laboratory-orders`](#laboratory-orders) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Patient reports (`departmental-laboratory-patient-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Specimen reports (`departmental-laboratory-specimen-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Sample reports (`departmental-laboratory-sample-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Section reports (`departmental-laboratory-section-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Pending results (`departmental-laboratory-pending-results`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Released results (`departmental-laboratory-released-results`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / LABORATORY | Turnaround times (`departmental-laboratory-turnaround-times`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL / RADIOLOGY | Imaging requests (`departmental-radiology-imaging-requests`) | **Partial** — [`radiology-requests`](#radiology-requests) | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL / RADIOLOGY | Completed procedures (`departmental-radiology-completed-procedures`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL / RADIOLOGY | Patient reports (`departmental-radiology-patient-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL / RADIOLOGY | Radiology revenue (`departmental-radiology-radiology-revenue`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL / PHARMACY | Prescriptions (`departmental-pharmacy-prescriptions`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL / PHARMACY | Dispensing (`departmental-pharmacy-dispensing`) | **Partial** — [`pharmacy-dispensations`](#pharmacy-dispensations) | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL / PHARMACY | Drug movement (`departmental-pharmacy-drug-movement`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL / PHARMACY | Returns (`departmental-pharmacy-returns`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL / PHARMACY | Stock and expiry (`departmental-pharmacy-stock-and-expiry`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL / THEATRE | Procedure lists (`departmental-theatre-procedure-lists`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Actual performed cases and utilization definitions. |
| DEPARTMENTAL / THEATRE | Patient procedure reports (`departmental-theatre-patient-procedure-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Actual performed cases and utilization definitions. |
| DEPARTMENTAL / THEATRE | Theatre utilization (`departmental-theatre-theatre-utilization`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Actual performed cases and utilization definitions. |
| DEPARTMENTAL / MATERNITY / MCH | ANC (`departmental-maternity-mch-anc`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Validated grouped reports and privacy controls. |
| DEPARTMENTAL / MATERNITY / MCH | Deliveries (`departmental-maternity-mch-deliveries`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Validated grouped reports and privacy controls. |
| DEPARTMENTAL / MATERNITY / MCH | Postnatal (`departmental-maternity-mch-postnatal`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Validated grouped reports and privacy controls. |
| DEPARTMENTAL / MATERNITY / MCH | Child health (`departmental-maternity-mch-child-health`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Validated grouped reports and privacy controls. |
| DEPARTMENTAL / DIALYSIS | Patient sessions (`departmental-dialysis-patient-sessions`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Clinician-verified session facts and reconciled billing; no inferred completion. |
| DEPARTMENTAL / DIALYSIS | Treatment records (`departmental-dialysis-treatment-records`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Clinician-verified session facts and reconciled billing; no inferred completion. |
| DEPARTMENTAL / DIALYSIS | Session billing (`departmental-dialysis-session-billing`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Clinician-verified session facts and reconciled billing; no inferred completion. |
| DEPARTMENTAL / SOCIAL WORK | Waivers (`departmental-social-work-waivers`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved, confidential case and waiver workflows. |
| DEPARTMENTAL / SOCIAL WORK | Counselling (`departmental-social-work-counselling`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved, confidential case and waiver workflows. |
| DEPARTMENTAL / SOCIAL WORK | Patient support reports (`departmental-social-work-patient-support-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Approved, confidential case and waiver workflows. |
| RECORDS | Birth reports (`records-birth-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Death reports (`records-death-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Current inpatient lists (`records-current-inpatient-lists`) | **Partial** — [`current-inpatients`](#current-inpatients) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Patient reports (`records-patient-reports`) | **Partial** — [`patient-registrations`](#patient-registrations) | Complete longitudinal records and governed patient-report definitions; the available view covers facility registrations only. |
| RECORDS | Patient review reports (`records-patient-review-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Unregistered patient reports (`records-unregistered-patient-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Referral reports (`records-referral-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | OPD diagnosis reports (`records-opd-diagnosis-reports`) | **Partial** — [`outpatient-diagnoses`](#outpatient-diagnoses) | Recorded encounter/diagnosis register only; deduplicated morbidity, verified MOH 705 definitions and facility acceptance remain outstanding. |
| RECORDS | IPD diagnosis reports (`records-ipd-diagnosis-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Triage analysis (`records-triage-analysis`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Doctors' workload (`records-doctors-workload`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Nurses' workload (`records-nurses-workload`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Cashier workload (`records-cashier-workload`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | Inpatient discharges (`records-inpatient-discharges`) | **Partial** — [`inpatient-discharges`](#inpatient-discharges) | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | MOH 505-IDSR (`records-moh-505-idsr`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH 705A (`records-moh-705a`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH 705B (`records-moh-705b`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH 717 (`records-moh-717`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH 301-IPD admissions (`records-moh-301-ipd-admissions`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH 204-OPD register (`records-moh-204-opd-register`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH 240 laboratory and radiology reports (`records-moh-240-laboratory-and-radiology-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | MOH financial reports (`records-moh-financial-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| HR | Employee list (`hr-employee-list`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Employment register and HR-authorized report. |
| HR | Employee summaries (`hr-employee-summaries`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Employment register and HR-authorized report. |
| HR | Salary summaries (`hr-salary-summaries`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Individual payslips (`hr-individual-payslips`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | All payslips (`hr-all-payslips`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Attendance (`hr-attendance`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Overtime (`hr-overtime`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Leave reports (`hr-leave-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Monthly deductions (`hr-monthly-deductions`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Monthly bank summaries (`hr-monthly-bank-summaries`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Individual bank summaries (`hr-individual-bank-summaries`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | P9A reports (`hr-p9a-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | P10 reports (`hr-p10-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | P10A reports (`hr-p10a-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | Locum reports (`hr-locum-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Payroll and approved current-year HR/KRA and secure payment policies. |
| ACTIVITY | System user list (`activity-system-user-list`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | Queue reports (`activity-queue-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | Complete activity logs (`activity-complete-activity-logs`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | Activity logs by user (`activity-activity-logs-by-user`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | Failed login reports (`activity-failed-login-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | Patient record access logs (`activity-patient-record-access-logs`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | Financial approval logs (`activity-financial-approval-logs`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | SMS reports (`activity-sms-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Authorized provider and verified delivery events. |
| ACTIVITY | Notification delivery reports (`activity-notification-delivery-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Authorized provider and verified delivery events. |
| ACTIVITY | Messages reports (`activity-messages-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Message/delivery data and report definitions. |
| ACTIVITY | Custom administrative reports (`activity-custom-administrative-reports`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Governed report definitions or durable job-run failure records. |
| ACTIVITY | Background job failures (`activity-background-job-failures`) | **Missing** — [unavailable](#unavailable-catalogue-entry) | Governed report definitions or durable job-run failure records. |

## Outside the centre catalogue

- `/api/reporting/operations` and `/api/reporting/occupancy-trend` are older inpatient views; `/api/analytics/revenue` is an invoice-creation-cohort view, not transaction-date collections or recognized revenue. `financial-transactions.service.ts` exposes separately recorded receipts, refunds, billed items, bed nights and an invoice cohort, with explicit unreconciled/timezone limitations. These are not extra catalogue engines or statutory outputs. See the Phase 4 report’s financial crosswalk.
- `/api/public-health/reports` stores manually provided disease, epi-week, counts, age group and status; the create route requires explicit counts/age. It does not generate the catalogue MOH 505 form, provide the full approved indicator dictionary or submit to KHIS. `/api/interop/dha/moh-705` is deliberately HTTP 501. A manually stored row is not evidence of national submission or acceptance.
- The MOH 705A/B, MOH 505, MOH 717, MOH 301, MOH 204, MOH 240 and MOH financial catalogue entries above are **Missing**, regardless of neighbouring operational views. Official forms, mappings, periods, data-quality controls, authority submission and acceptance must be independently verified as documented in the Phase 4 report.
