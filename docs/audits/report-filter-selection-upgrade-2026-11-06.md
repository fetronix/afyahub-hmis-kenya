# Reporting filter and selection upgrade — implementation and report matrix

**Date:** 6 November 2026. This is an implementation and synthetic-test checkpoint, **not a claim that the 144 requested reports are complete or approved for clinical, statutory or financial use**. The [pre-change audit](reporting-centre-functionality-audit-2026-11-04.md) describes the original source evidence and [phase-2 checkpoint](reporting-centre-phase2-wip-2026-11-05.md) describes the partial report engines and their limitations.

## What changed

- All five report-centre manual internal-ID entry controls were replaced: optional patient, ward, department and staff filters in the workbench, and the required invoice ID in the finalized-invoice document workflow. A patient/ward/staff filter is still optional; opening a specific invoice necessarily requires selecting one invoice.
- Existing 18 engines (21 catalogue entries/aliases) now use relevant selectors from the table below. The invoice document is the 22nd available entry. The other **122 catalogue entries have no report-centre engine or document workflow**; no fake records, options, filters or reports were enabled for them.
- Selection is browse-first, with a first page visible without a search, optional literal search, 20-option UI pages (maximum API page 25), bounded multi-selection of up to 20 items/services/accounts, explicit All/clear and keyboard-native controls. Changing ward, department, supplier or patient clears its dependent bed, staff, purchase order or invoice selection. Results and selection labels revalidate on generate, print and export; cross-facility/nonexistent/dependency-mismatched IDs are rejected, not silently ignored.
- CSV was added alongside existing PDF, Excel and print for the 18 report engines. CSV cells are quoted and formula-looking leading text is prefixed with an apostrophe for spreadsheet safety; this intentionally represents such text as text. Export remains capped at 1,000 rows and applies existing `reports.export` and domain export permissions; print is the current page. The existing finalized-invoice document remains print-only; PDF/Excel/CSV for that separate workflow were not implemented. A print request is not proof of physical printing.
- Actual invoice balance, receipt and journal arithmetic remains the existing scoped source logic. Selecting a receipt filters payments **before** grouping; selecting accounts narrows the posted-account subset and its summaries. No reconciliation, revenue recognition, historic repricing or posting policy was invented.

## Sources, API, authorization and important limitations

`POST /api/reporting/centre/:reportId/options` is a **single shared authenticated selector endpoint**. The body includes a supported kind, selected facility, optional search/page and only applicable dependencies. Search is not placed in a URL; responses are `no-store`; only bounded, parameterized queries run. The endpoint reuses the report's source permission, selected-facility and enabled/visible module checks; SUPER_ADMIN is not a facility reporting account. The invoice document's selector and report UI require billing, clinical, patient, reports read/export and the finance module. Its report-context print also requires those grants. The separate existing invoice GET service requires billing/clinical read and, in report context, reports/patient read; it does not require `reports.export` merely to view the invoice. Staff choices require `users.read`; pharmacy stock choices additionally require `inventory.read`; receipt choices additionally require `patients.read`. A user without these extra grants can still run the underlying report with All, but cannot use that protected selector. Patient-bearing option pages, selected labels and reports use mandatory transactional patient-access audits; search text and identifiers are omitted from the general selection audit.

| Choice | Source and actual relationship |
|---|---|
| Patient | `patients.tenant_id` and `registration_facility_id`, MRN/name, permitted phone and **record-created date**, not a verified arrival/registration event. Patients registered elsewhere are not offered even if they subsequently received care here, so those patients cannot currently be individually selected. Existing locally scoped encounter/order reports may still display a same-tenant patient's locally linked event with a patient-access audit; that cross-facility record access and any broader picker policy require authorized review. |
| Invoice | `billing_invoices` scoped by tenant/facility, with a registration-facility-scoped patient label, invoice number, recorded creation date, total, paid, balance, status/void marker. Outstanding report options default to nonzero/invalid balance; All statuses can be selected, but the report itself remains its original non-voided nonzero/invalid snapshot. A missing/out-of-scope patient is “Patient unavailable.” |
| Receipt | `billing_payments` joined to its scoped `billing_invoices` and, when permitted and registered here, patient; receipt and invoice numbers, date, recorded amount and method. This is recorded activity, not provider settlement. |
| Item and batch | `inventory_items.facility_id` via the scoped facility; code, name, category, current stock/unit, reorder level and active status. `inventory_batches.item_id` and `pharmacy_dispensations.item_id` are the only links used for expiry and dispensation filtering. Missing/unlinked historical snapshots are not matched by name. |
| Lab test and facility service | `lab_tests.facility_id`, `lab_test_specimen_options` explicitly reviewed for that test, and `lab_orders.test_id`; separately `facility_services` filtered to LABORATORY with `lab_orders.facility_service_id`. The legacy default specimen is not claimed to be reviewed. Unlinked/free-text historical orders are excluded by a selected ID, not guessed. |
| Radiology service | Scoped `facility_services` in RADIOLOGY, matched only to `radiology_orders.facility_service_id`; free-text/unlinked requests remain visible with All, not guessed as a procedure. |
| Ward and bed | `wards.facility_id` and `beds.ward_id`, including the bed's **current recorded status**, with `admissions.ward_id`/`bed_id`. This is not reconstructed transfer history. |
| Department and staff | `departments.facility_id`; linked `practitioners`/`users` for outpatient encounters and recorded `billing_refunds.actor_user_id` for refunds. Department choice includes current assignment or a recorded outpatient encounter in that department. Free-text cashier names are not falsely linked to staff. |
| Supplier and LPO | Tenant `suppliers` that actually have a `purchase_orders` record in the selected facility; `purchase_orders.tenant_id`/`facility_id` and `supplier_id` constrain dependent options. Inconsistent historical supplier links remain unavailable for selection and are flagged in reports. |
| Ledger account | `chart_of_accounts` tenant/facility and account type, matched by `journal_lines.account_id` in the already scoped posted-journal queries. Filtering accounts is not a balanced or complete statement. |

The report-centre has no implemented insurer/SHA-claim, preauthorization, appointment, tariff-line, stock-movement, receipt-document, payroll or many other requested report engines. No selector can be truthfully added to those nonexistent reports. Legacy lab/radiology orders may lack service/test IDs; admission and other output tables still include some source event IDs where no approved human-readable reference exists. Historical data was not rewritten. The standalone theatre booking form's optional encounter/admission IDs, payment-hub sandbox collection's integration/invoice IDs and some dialysis/appointment configuration inputs are **workflow-entry fields, not report filters**, and were not altered by this report upgrade. They require separate workflow-scoped authorization and verification before any safe change.

Other reporting surfaces inspected: the existing analytics overview and financial-transaction view use date/range and free-text/search rather than required record IDs; accounting's standalone statements use dates; theatre's scheduling summary uses dates; public-health's export is a separate existing workflow (MOH 705 remains unavailable). These are not represented as newly completed catalogue reports. The standalone accounting report and legacy analytics remain subject to their previously documented reconciliation and isolation review.

## Verification performed

- Brand-new isolated loopback PostgreSQL 16: verified zero public tables, then applied all 67 existing migrations. No existing/production database was reset. Tests and browser fixtures use synthetic names and amounts only.
- `report-centre-selectors.db.spec.ts`: seven HTTP/PostgreSQL tests passed, including real initial browse/search/pagination, ownership/dependency/permission rejection, mandatory access-audit failure, all 18 engines' selected and unselected reports with print/PDF/XLSX/CSV, multi-select, exact receipt/refund/balance/ledger values, formula safety and disabled modules. The final full regression included this suite.
- `report-centre-browser-synthetic.mjs`: genuine sign-in, 21 catalogue entries mapping to all 18 engines, keyboard selection, generated rows, PDF/XLSX/CSV bytes and print-to-PDF content passed against synthetic PostgreSQL. The invoice selector opened an unfinalized invoice, then a separate complete synthetic invoice was finalized through the authorized existing service, selected, rendered and printed to PDF with an asserted patient print-access audit. The finalization integration suite separately checks immutable snapshots. This is not approval of any real facility's printable template. Patient selector and result pagination, empty/error cases, denied permissions/facility, 768px tablet and 390px mobile horizontal overflow, and uncaught browser errors passed. No real patient, credentials or facility were used. Browser PDF parser emitted font warnings; assertions still passed.
- The 15-test selector UI suite covered browse-by-default, retained multiple selections across pages, search, All/clear, dependent bed refresh, permission/error/retry, required invoice selection and stale responses. Full regression, lint and final suite outcomes are stated in the execution section following the matrix.

## Every inspected catalogue entry

For entries with a working engine, **PARTIALLY IMPLEMENTED** describes the narrow source-backed view, not the broader report. “Browser + HTTP PASS” refers only to the synthetic test above. For entries with no engine, the prior audit's classification is retained because a related source/workflow may exist outside the centre; **no report-centre report or selector is available**, regardless of a prior partial classification. “Restricted by permissions” is account-specific and is not a blanket implementation status.

| Category | Group | Report | Current status / source | Relevant selector | Synthetic test |
|---|---|---|---|---|---|
| PRINTABLES | — | Sick-off certificates | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Medical notes | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Referral letters | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Inpatient statements | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Discharge summaries | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Operation notes | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Anaesthetist notes | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Bill consent forms | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Radiology reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Laboratory reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Invoices | **PARTIALLY IMPLEMENTED** — existing invoice document | Required invoice | Browser PASS: finalized and unfinalized; audited print |
| PRINTABLES | — | Receipts | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Purchase requisitions | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Local purchase orders | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| PRINTABLES | — | Goods received notes | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Cashier daily summary | **PARTIALLY IMPLEMENTED** — `cashier-receipts` | Receipt | Browser + HTTP PASS (subset) |
| FINANCIAL | — | All-cashier daily summary | **PARTIALLY IMPLEMENTED** — `cashier-receipts` | Receipt | Browser + HTTP PASS (subset) |
| FINANCIAL | — | Department receipt summary | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Department receipt breakdown | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Managerial daily summary | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Trial balance | **PARTIALLY IMPLEMENTED** — `ledger-trial-movements` | Account (multi) | Browser + HTTP PASS (subset) |
| FINANCIAL | — | Income statement | **PARTIALLY IMPLEMENTED** — `ledger-income` | Account (multi) | Browser + HTTP PASS (subset) |
| FINANCIAL | — | Balance sheet | **PARTIALLY IMPLEMENTED** — `ledger-balance-sheet` | Account (multi) | Browser + HTTP PASS (subset) |
| FINANCIAL | — | Monthly profit and loss | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Cash flow statement | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Budget management | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Credit notes | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Waiver reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Income by cashier | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Departmental revenue | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Patient outstanding balances | **PARTIALLY IMPLEMENTED** — `invoice-balances` | Patient; dependent invoice | Browser + HTTP PASS (subset) |
| FINANCIAL | — | SHA receivables | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Private insurance receivables | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | M-Pesa reconciliation | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Card payment reconciliation | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| FINANCIAL | — | Refund reports | **PARTIALLY IMPLEMENTED** — `recorded-refunds` | Staff | Browser + HTTP PASS (subset) |
| STOCK / GOODS | — | Stock usage | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Stock movements | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Goods received | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Goods returned | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | LPO summaries | **PARTIALLY IMPLEMENTED** — `purchase-orders` | Supplier; purchase order | Browser + HTTP PASS (subset) |
| STOCK / GOODS | — | Inward invoices | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Outward invoices | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Bin cards | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Inventory by store | **PARTIALLY IMPLEMENTED** — `inventory-store` | Item (multi) | Browser + HTTP PASS (subset) |
| STOCK / GOODS | — | Inventory by category | **PARTIALLY IMPLEMENTED** — `inventory-category` | Item (multi) | Browser + HTTP PASS (subset) |
| STOCK / GOODS | — | Expiry reports | **PARTIALLY IMPLEMENTED** — `inventory-expiry` | Item (multi) | Browser + HTTP PASS (subset) |
| STOCK / GOODS | — | Stock variance | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Stock transfers | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Goods price lists | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Supplier reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Stock valuation | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Asset register | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Asset tracking | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| STOCK / GOODS | — | Asset maintenance | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | OPD | OPD attendance | **PARTIALLY IMPLEMENTED** — `outpatient-encounters` | Patient; department; dependent staff | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | OPD | Consultation reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | OPD | Diagnosis reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | OPD | Referral reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | OPD | Doctor workload | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | INPATIENT | Current inpatient list | **PARTIALLY IMPLEMENTED** — `current-inpatients` | Patient; ward; dependent bed | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | INPATIENT | Admissions | **PARTIALLY IMPLEMENTED** — `inpatient-admissions` | Patient; ward; dependent bed | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | INPATIENT | Discharges | **PARTIALLY IMPLEMENTED** — `inpatient-discharges` | Patient; ward; dependent bed | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | INPATIENT | Ward occupancy | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | INPATIENT | Bed billing | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Test reports | **PARTIALLY IMPLEMENTED** — `laboratory-orders` | Patient; lab test; facility service (multi) | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | LABORATORY | Patient reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Specimen reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Sample reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Section reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Pending results | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Released results | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | LABORATORY | Turnaround times | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | RADIOLOGY | Imaging requests | **PARTIALLY IMPLEMENTED** — `radiology-requests` | Patient; facility service (multi) | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | RADIOLOGY | Completed procedures | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | RADIOLOGY | Patient reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | RADIOLOGY | Radiology revenue | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | PHARMACY | Prescriptions | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | PHARMACY | Dispensing | **PARTIALLY IMPLEMENTED** — `pharmacy-dispensations` | Patient; item (multi) | Browser + HTTP PASS (subset) |
| DEPARTMENTAL | PHARMACY | Drug movement | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | PHARMACY | Returns | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | PHARMACY | Stock and expiry | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | THEATRE | Procedure lists | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | THEATRE | Patient procedure reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | THEATRE | Theatre utilization | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | MATERNITY / MCH | ANC | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | MATERNITY / MCH | Deliveries | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | MATERNITY / MCH | Postnatal | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | MATERNITY / MCH | Child health | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | DIALYSIS | Patient sessions | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | DIALYSIS | Treatment records | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | DIALYSIS | Session billing | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | SOCIAL WORK | Waivers | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | SOCIAL WORK | Counselling | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| DEPARTMENTAL | SOCIAL WORK | Patient support reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Birth reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Death reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Current inpatient lists | **PARTIALLY IMPLEMENTED** — `current-inpatients` | Patient; ward; dependent bed | Browser + HTTP PASS (subset) |
| RECORDS | — | Patient reports | **PARTIALLY IMPLEMENTED** — `patient-registrations` | Patient | Browser + HTTP PASS (subset) |
| RECORDS | — | Patient review reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Unregistered patient reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Referral reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | OPD diagnosis reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | IPD diagnosis reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Triage analysis | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Doctors' workload | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Nurses' workload | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Cashier workload | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | Inpatient discharges | **PARTIALLY IMPLEMENTED** — `inpatient-discharges` | Patient; ward; dependent bed | Browser + HTTP PASS (subset) |
| RECORDS | — | MOH 505-IDSR | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH 705A | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH 705B | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH 717 | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH 301-IPD admissions | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH 204-OPD register | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH 240 laboratory and radiology reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| RECORDS | — | MOH financial reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Employee list | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Employee summaries | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Salary summaries | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Individual payslips | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | All payslips | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Attendance | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Overtime | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Leave reports | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Monthly deductions | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Monthly bank summaries | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Individual bank summaries | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | P9A reports | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | P10 reports | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | P10A reports | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| HR | — | Locum reports | **BLOCKED BY MISSING MODULE** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | System user list | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Queue reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Complete activity logs | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Activity logs by user | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Failed login reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Patient record access logs | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Financial approval logs | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | SMS reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Notification delivery reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Messages reports | **PARTIALLY IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Custom administrative reports | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |
| ACTIVITY | — | Background job failures | **NOT IMPLEMENTED** — no centre engine | Not applicable: no engine | NOT RUN: unavailable |

## Remaining work and acceptance boundary

This checkpoint does not implement the remaining 122 report-centre entries, clinical or MOH/KRA templates, missing modules, all insurer/SHA and appointment reports, accounting reconciliation, live payer/provider approvals, or facility-specific UAT. It does not prove real-world invoice, bed-rate or clinical correctness at any facility. Outstanding statutory forms, historical records lacking identity, data-quality conflicts, permission governance, complete financial statements and approved print templates still need owner review and end-to-end testing. No production access/deployment, live integration, provider outcome, unapproved migration or destructive database operation was performed.

## Final execution outcome

- **PASS:** full `npm test` with `JALICARE_REQUIRE_DB=1` against the isolated synthetic PostgreSQL 16 instance: **221 files, 2,038 tests**, no skips. Coverage: 63.40% statements, 58.96% branches, 63.81% functions, 64.52% lines. This includes 7 selector HTTP/DB tests, 15 workbench UI tests, two CSV-safety tests and 11 mocked Docker-bootstrap tests.
- The first combined run had **9 failures**: one old source assertion still expected a misleading pre-existing payment title, and eight mocked Docker tests rejected the generated `build/scripts/migrate.js` left by a prior build. The assertion was updated to require the more accurate invoice-cohort label **and to forbid the old misleading label**; only the generated build artifact was removed before the successful rerun. No check was disabled or skipped.
- **PASS:** final client and server builds, `npm run typecheck`, `npm run format:check`, `npm run lint` and `git diff --check`. ESLint reports **87 warnings, zero errors**; the client build warns about a JavaScript chunk larger than 500 kB.
- **PASS:** production dependency audit reports no vulnerabilities. Full dependency audit reports **four moderate development-tool advisories** in `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit` and `esbuild`; this is not a clean full audit.
- The first GitHub run for this upgrade failed its coverage and fresh-Docker jobs because the pre-existing synthetic-only test guards did not match the CI/Compose database name or Docker-forwarded server address. The follow-up test infrastructure names the disposable database explicitly synthetic, checks that the client endpoint is loopback, and obtains the freshly started container's PostgreSQL cluster identity **from inside that exact service** before migration. A private Docker server address is accepted only when its cluster identity matches; missing/mismatched attestation, public/remote addresses and non-synthetic database names fail closed. No test or coverage threshold is disabled. Focused appointment, safety and mocked-bootstrap tests passed 29/29. A subsequent local full rerun was interrupted under concurrent memory/CPU pressure and is not counted as a pass; the earlier complete 2,038-test run remains the local regression result.
- **NOT RUN locally:** actual Docker bootstrap/deployment — Docker CLI/socket unavailable. Mocked bootstrap tests are not a substitute; check the current GitHub CI run for the independent Docker outcome. Real facility data, provider integrations, production migration safety, statutory approval and user acceptance are also not verified.
