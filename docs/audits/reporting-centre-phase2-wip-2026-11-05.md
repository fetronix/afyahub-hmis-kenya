# Reporting Centre — functionality checkpoint (work in progress)

**Checkpoint:** 5 November 2026. This is a source-control checkpoint for review in VS Code, **not a completion or deployment approval**. The requested final 144-report acceptance matrix is still outstanding. The [pre-change functionality audit](reporting-centre-functionality-audit-2026-11-04.md) inventories all 144 catalogue entries and identifies their dependencies. The older [WIP matrix](reporting-centre-wip-matrix-2026-11-04.md) predates this checkpoint and must not be treated as its final status.

## Delivered subsets and boundaries

There are 18 distinct report engines mapped to 21 catalogue entries, plus the pre-existing finalized-invoice workflow. Four engines existed at the start; this checkpoint adds 14 engines and maps 16 additional catalogue entries. **All these are partial views, not completed versions of the broader requested reports.** The other catalogue entries remain unavailable or subject to their documented missing module, data, authorization policy, official specification or reconciliation dependency.

| New engine | Source | What it actually presents |
|---|---|---|
| `patient-registrations` | `patients` | Patients first registered at the selected facility; not a longitudinal patient record or all patients seen at the facility. |
| `inventory-expiry` | `inventory_items`, `inventory_batches`, `facilities` | Recorded batch expiry and remaining quantities; not stock movement or inventory valuation. |
| `outpatient-encounters` | `encounters`, scoped `patients`, `departments`, `practitioners` | Recorded outpatient encounters; not proof of attendance or completed consultation. |
| `inpatient-admissions`, `inpatient-discharges` | `admissions`, scoped `patients`, `wards`, `beds` | Recorded admission or discharge dates and current linked references; not reconstructed transfers or verified discharge completion. |
| `laboratory-orders`, `radiology-requests` | `lab_orders`, `radiology_orders`, scoped `patients` | Recorded orders/requests and statuses; not verified results or proof of a procedure. |
| `pharmacy-dispensations` | `pharmacy_dispensations`, scoped `patients` | Recorded dispensation events and item snapshots; not full returns, reversals, reconciliation or prescription fulfilment. |
| `cashier-receipts` | `billing_payments`, `billing_invoices` | Recorded positive receipts grouped by recorded date, free-text cashier and method. Not reconciled settlements, revenue or cash on hand; refunds are separate. |
| `recorded-refunds` | `billing_refunds`, scoped `billing_invoices` | Recorded manual refunds, not proof of external transfer or reconciliation. |
| `invoice-balances` | `billing_invoices`, scoped `patients` | Current recorded invoice-header balance snapshot, not historical balances or verified receivables. Unknown and invalid balances are flagged. |
| `ledger-trial-movements` | `chart_of_accounts`, `journal_entries`, `journal_lines` | Posted debit and credit movements by account; a date-filtered view omits opening balances and is **not** an as-of trial balance. |
| `ledger-income` | Same posted-ledger sources | Posted revenue and expense account movements only; unposted transactions and costs are excluded. |
| `ledger-balance-sheet` | Same posted-ledger sources | Posted balances through a required as-of date, including posted accumulated result; not a complete or certified balance sheet. |

The journal views use the ledger's recorded KES cents, include posted reversal entries and require `accounting.read`; printing/export additionally requires `accounting.reports.export` as well as `reports.export`. Billing, payments, claims and costs may not be fully posted or reconciled. An account-name search produces filtered account subtotals, not a balanced whole-facility statement. No automatic posting, policy, mapping, insurer settlement or clinical completion is fabricated by these reports.

General safeguards include facility and tenant scoping, parameterized SQL, domain/module permissions, a maximum 100-row page and 1,000-row export, mandatory transactional report/patient-access audit, explicit missing-data flags and generic redacted unexpected-error responses. Search, status, dates, patient, ward, department and staff filters are offered only where the source semantics support them; unsupported filters are rejected. PDF and Excel exports contain source values and stated limitations. Browser print is the current page. Missing/non-finite/non-positive receipt amounts and invalid negative invoice balances are flagged rather than silently counted as zero or netted against debts.

## Verification evidence and outstanding checks

- **Passed before this checkpoint:** TypeScript typecheck; five focused reporting suites, **46 tests passed, zero skipped**, against isolated synthetic PostgreSQL 16 and authenticated HTTP (`report-centre-operational.db.spec.ts`, `report-centre-ledger.db.spec.ts`, `report-centre.db.spec.ts`, `report-centre-error-redaction.spec.ts`, `report-centre-ui.spec.tsx`). This included exact ledger arithmetic and reversal dates, synthetic PDF/Excel bytes and contents, invalid amounts, filters, permissions, audit and cross-facility/cross-tenant denials.
- **Earlier browser pass:** A genuine-login synthetic Chromium-to-PostgreSQL run exercised the then-current 15 non-ledger engines through the Reporting Centre, including search and applicable date/status/patient/ward/department/staff filters, PDF/XLSX, browser print rendering, pagination, empty/error states, permission denial, facility denial and tablet layout. This predates the later ledger engines, shared-summary refactor and amount safeguards, so it is **not** proof of the final checkpoint build.
- **Not verified:** The subsequent expanded browser run for all 18 engines was interrupted by a workspace transition; its result and temporary runtime logs are unavailable. The latest browser script also adds three catalogue aliases after that run started. Rerun it on a newly provisioned, isolated synthetic database and suitable Chromium runtime before claiming final browser verification. Never reset an existing database.
- **Not run for this checkpoint:** Full regression/coverage, full lint and production dependency audit after these changes. Client and server builds passed before the last browser-script-only edits, with the existing large-client-chunk warning. Earlier failed attempts and skipped tests are not counted as passes.
- No production data, deployment, destructive migration or external payer/banking operation was performed. Official MOH/KRA output and complete financial reconciliation still require approved specifications, mappings, policies and facility UAT.

## Files in this checkpoint

`src/components/modules/report-centre/ReportCentre.tsx`, `ReportWorkbench.tsx`; `src/reporting/report-catalogue.ts`, `report-centre.{types,service,format,export}.ts`, `report-centre.{operational-definitions,operational-queries,ledger-definitions,ledger-queries}.ts`; `src/routes/domains/report-centre.routes.ts`; `scripts/report-centre-browser-synthetic.mjs`; `src/tests/integration/report-centre-{operational.db,ledger.db,error-redaction}.spec.ts`; `src/tests/vitest/report-centre-ui.spec.tsx`; and the two current-phase audit documents in `docs/audits/`.
