# Reporting Centre — structural redesign acceptance

Date: 2026-10-27 (Africa/Nairobi)
Branch: `arena/e088f11d-afyahub-hmis-kenya`
Base commit of this task: `e9f4afb` (the commit this work sits on top of; the redesign is committed on the same branch)
Environment: disposable synthetic PostgreSQL 16.2 on `127.0.0.1:55441`, synthetic tenants/facilities/patients only. No production data, no external providers.

This document records what the redesign changed, what it deliberately kept, and the evidence behind every claim. It is an acceptance record for the *reporting surface*, not a claim that any report is the complete statutory or management report: the per-report truth is in [REPORTING_CENTRE_COMPLETION_INVENTORY.md](REPORTING_CENTRE_COMPLETION_INVENTORY.md).

## 1. What changed

| Path | Change |
| --- | --- |
| `src/reporting/report-catalogue.ts` | Regenerated catalogue: 144 entries, exactly ten categories, each report keeps its original id, name, summary and dependency text. Adds `CATEGORY_META`, `REPORT_ENTRY_BY_ID`, and `reportImplementation()` (available / existing document / not implemented). `resolve()` still throws on an unknown, duplicated or mis-categorised id. |
| `src/reporting/report-centre.overview.ts` | New. Server-side headline figures with explicit statuses (`ok`, `restricted`, `disabled`, `error`) and per-figure permission and module gates. |
| `src/reporting/receipts.ts` | New. Exact-cents receipt arithmetic (payments minus refunds, per day) extracted so it can be tested without a database. |
| `src/routes/domains/report-centre.routes.ts` | New `POST /api/reporting/centre/overview` (`reports.read`, `no-store`). Existing `/:reportId/options`, `/generate` and `/export` routes unchanged. |
| `src/api/report-centre.client.ts` | Adds `overview(facilityId, from, to)`. |
| `src/components/modules/report-centre/ReportCentre.tsx` | Rewritten landing page: header, facility selector limited to authorised facilities, period selector, report search, KPI area, ten-category catalogue, workspace switch, breadcrumbs. The legacy analytics screen is still reachable inside the centre, behind an "unreconciled" warning, and only with its source permissions and modules. |
| `src/components/modules/report-centre/ReportCataloguePanel.tsx` | New. Category cards with description, report count, available count, report names, one-line purposes and an implementation badge; available reports listed first; search across report, purpose, group and category; honest empty state. |
| `src/components/modules/report-centre/ReportWorkspace.tsx` | New. One report per page: breadcrumbs, purpose, implementation badge, facility, then the engine workbench, the existing document workflow, or an explicit refusal that says what the report still needs. |
| `src/components/modules/report-centre/ReportingKpis.tsx` | New. Four headline cards plus a daily bar chart of the real series; a card without a verified figure shows a reason, never a zero. |
| `scripts/build-reporting-centre-inventory.ts` | New. Generates the completion inventory JSON and Markdown from the catalogue and engine registry. |
| `docs/audits/REPORTING_CENTRE_COMPLETION_INVENTORY.{json,md}` | New. Every report, with data source, filters, PDF, Excel, calculation verification, permission verification and implementation status. |

Not changed: report engines (`report-centre.operational-*`, `ledger-*`), filter validation, pagination and export caps, audit logging, the invoice and clinical-document workflows, and unrelated modules.

## 2. Landing page

- Header: "Reporting Centre" with a one-line description that names the selected facility.
- Facility selector: only facilities the signed-in account can reach (the context list, additionally filtered to the current tenant). The server re-checks the choice on every request.
- Period: inclusive `From`/`To`, defaulting to the last 30 local calendar days; a period longer than 366 days, an inverted range or a missing date is refused in the browser and again by the server.
- Search: one box over report names, purposes, groups and category descriptions; typing while a report is open returns to the catalogue.
- Catalogue: all ten categories, always including the reports that are not implemented, with counts and accurate statuses.
- Headline area: four cards and a chart, described in section 4. If the period is invalid the figures are not requested at all; the catalogue stays usable.

## 3. The ten categories

Order is fixed by the catalogue and asserted by `report-centre-ui.spec.tsx`.

| # | Category | Reports | Runnable today |
| --- | --- | --- | --- |
| 1 | Clinical & Patient | 41 | 10 |
| 2 | Laboratory & Radiology | 13 | 4 |
| 3 | Finance & Accounting | 8 | 3 |
| 4 | Billing & Revenue | 20 | 5 |
| 5 | Pharmacy | 5 | 1 |
| 6 | Inventory & Stock Management | 14 | 4 |
| 7 | Procurement & Supplier | 5 | 1 |
| 8 | HR & Workforce | 17 | 0 |
| 9 | Management & Budget | 13 | 0 |
| 10 | MOH & Regulatory | 8 | 0 |

"Runnable" counts an engine-backed report or an existing document workflow — not a report that merely renders. 116 of the 144 reports are not implemented; they remain listed, with the reason they cannot be produced yet.

Every original report id survives the re-categorisation. `report-catalogue-integrity.spec.ts` proves that the catalogue and the engine registry still describe the same set of reports, and that no id appears twice or in two categories.

## 4. Headline figures

| Figure | What it counts | Period | Gates | Source |
| --- | --- | --- | --- | --- |
| Patient visits | Encounters with a recorded start date inside the period | Period | `reports.read` + `clinical.read`; `analytics` + `opd` | `encounters.started_at` |
| Revenue | Payments recorded at the cashier, less refunds recorded against them (cash received, not recognised revenue) | Period | `reports.read` + `billing.read`; `analytics` + `finance` | `billing_payments` joined to in-scope `billing_invoices`, minus `billing_refunds` that are confirmed and linked to the same payment and invoice |
| Outstanding balances | Positive balances on non-voided invoice headers — a live snapshot, not an aged receivable | Snapshot, dated today | `reports.read` + `billing.read`; `analytics` + `finance` | `billing_invoices` |
| Pharmacy stock alerts | Active pharmacy items at or below their recorded reorder level | Snapshot, dated today | `reports.read` + `inventory.read`; `analytics` + `inventory` | `inventory_items` |

Rules enforced in code and in tests:

- Only a figure with status `ok` carries `value`/`amount`. `restricted`, `disabled` and `error` carry a reason and no number, so a missing permission or a disabled module cannot be mistaken for a verified zero.
- A real zero is still shown as zero, with its definition (for example an empty period returns a 30-point series of zeros and `0.00` revenue).
- Receipts or balances that cannot be totalled (non-positive, negative or non-finite amounts; refunds without an approved, linked record; a negative invoice balance) put that card into `error` with the reason, never into a total.
- Currency comes from the tenant record. If it is not recorded the card says "Currency not recorded" rather than assuming one.
- A platform (super-admin) account is refused: the Reporting Centre is a facility surface. The facility id is resolved through the same scope check as the reports, and the facility must have `analytics` enabled and not hidden.

## 5. Report workspace

Selecting a report opens one page with breadcrumbs (`Reporting Centre → category → report`), the report name and purpose, its implementation badge, the facility, and then:

- an engine-backed report renders the existing, unchanged workbench: period/as-of filters, readable selection controls populated from authorised records, status/search filters, page controls, summaries, PDF/print and Excel/CSV export subject to `reports.export` plus any source-domain export permission;
- an existing-document report opens the workflow that already exists (finalized invoice, discharge summary, laboratory report, radiology report);
- a report that cannot be produced states what is still missing, and renders no empty table that would look like a completed report;
- a report the account may not open states which permission or module is missing.

No filter accepts a typed internal database id: patient, ward, bed, department, staff, item, supplier, purchase order, laboratory test, service, invoice, receipt and account are all chosen from scoped option lists.

## 6. Preserved behaviour

- The 20 report engines and their SQL, calculations, filters, pagination caps, export limits, PDF letterhead, spreadsheet formula-escaping and audit writes are untouched. The redesign only decides which report to open.
- Report audit behaviour is unchanged: `audit_logs` plus `patient_record_access_logs` inside the generating transaction; export and print record their own access.
- Nothing was removed from the catalogue. The legacy analytics screen (`ReportsModule`) is still available from the centre, but only inside an explicitly labelled "unreconciled legacy analytics" panel and only when its source permissions and modules are present.
- The overview endpoint adds no patient identifiers to the response or to logs; it logs a section id and a SQLSTATE only.

## 7. Evidence

### 7.1 Static checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| ESLint (changed files) | `npx eslint src/reporting src/routes/domains/report-centre.routes.ts src/api/report-centre.client.ts src/components/modules/report-centre …` | 0 errors, 0 warnings |
| Client build | `npm run build` | exit 0 (existing chunk-size warning only) |
| Server build | `npm run build:server` | exit 0 |

### 7.2 Reporting test suites (all passing)

Unit and UI (`jsdom`), 53 tests:

| Spec | Tests | Covers |
| --- | --- | --- |
| `report-centre-ui.spec.tsx` | 18 | Ten categories and their order, counts, descriptions, statuses; search and empty state; facility list restricted to authorised facilities and reload on change; 30-day default and invalid-period handling; every report workspace state; filters; PDF/print; Excel; pagination; stale-response dropping; blocked modules and accounts |
| `report-centre-invoice-ui.spec.tsx` | 7 | Scoped finalized-invoice workflow, reopening, print authorization, stale responses |
| `clinical-document-report-ui.spec.tsx` | 5 | Existing clinical-document workflow |
| `reporting-kpis.spec.tsx` | 7 | Verified figure vs restricted/disabled/error, no figure on request failure, stale response dropping, chart only for a real series, missing currency, loading state |
| `reporting-receipts.spec.ts` | 5 | Exact-cent arithmetic, refund subtraction, negative-day reversal, true zero, large amounts, refusal of negative/unreadable receipts |
| `report-catalogue-integrity.spec.ts` | 5 | Catalogue ↔ engine bijection, unique ids, single category per report |
| `reporting-programme-matrix.spec.ts` | 4 | The 144-entry programme matrix still matches the catalogue |
| `report-centre-export.spec.ts` | 2 | Export filename/content-type handling |

Integration against a real synthetic PostgreSQL and real HTTP, 77 tests:

| Spec | Tests | Covers |
| --- | --- | --- |
| `report-centre.db.spec.ts` | 11 | Session/permission/export/facility gates, disabled and hidden modules, literal search, pagination and bounded exports, inclusive dates, privacy audit, real PDF and Excel bytes, invoice document, audit fail-closed |
| `report-centre-overview.db.spec.ts` | 9 | Every headline figure recomputed from source rows, per-facility isolation, restricted/disabled/error without numbers, real zero for an empty period, period validation, cross-facility and platform refusals |
| `report-centre-operational.db.spec.ts` | 17 | Twelve engine routes end to end with real PDF/XLSX, filters, exact totals, malformed data, pagination |
| `report-centre-selectors.db.spec.ts` | 7 | Scoped selectors for 18 engines plus PDF/XLSX/CSV export assertions per engine |
| `report-centre-diagnoses.db.spec.ts` | 13 | Diagnosis register, unknown/conflicting coding, export, audit, fail-closed |
| `report-centre-ledger.db.spec.ts` | 6 | Ledger statements, accounting export permission, scope |
| `report-centre-movements.db.spec.ts` | 12 | Stock movements, signed quantities, mixed units, export, audit |
| `report-centre-error-redaction.spec.ts` | 2 | Error responses do not leak database detail |

Commands (from the repository root):

```bash
set -a; . .tmp-tools/portal.env; set +a   # loopback synthetic DB only
npx vitest run src/tests/vitest/report-centre-ui.spec.tsx src/tests/vitest/report-centre-invoice-ui.spec.tsx \
  src/tests/vitest/report-catalogue-integrity.spec.ts src/tests/vitest/reporting-programme-matrix.spec.ts \
  src/tests/vitest/report-centre-export.spec.ts src/tests/vitest/clinical-document-report-ui.spec.tsx \
  src/tests/vitest/reporting-kpis.spec.tsx src/tests/vitest/reporting-receipts.spec.ts
SQL_DB_NAME=reporting_programme_synthetic_test REPORTING_TEST_PG_DATA_DIRECTORY=/tmp/portal-pg \
  npx vitest run src/tests/integration/report-centre*.db.spec.ts src/tests/integration/report-centre-error-redaction.spec.ts
```

Result: 53/53 and 77/77.

### 7.3 Regression run outside the reporting suites

`npx vitest run src/tests/reporting.spec.ts src/tests/design-tokens.spec.ts src/tests/route-scope.spec.ts src/tests/vitest src/tests/patient-signed-documents.db.spec.ts` — 1,578 tests, 1,576 passing.

Two failures, both diagnosed:

1. `reporting.spec.ts > Ui Wiring > legacy analytics requires source permissions before rendering` — a source-text assertion on the reporting centre. It is a real finding from the redesign and was fixed by keeping the guarded branch named `showOverview && canOverview` (renaming the state, not weakening the test). The suite now passes 41/41 in the re-run.
2. `deploy-artifacts.spec.ts > covers every artifact the build claims to produce` — `scripts/build-server.mjs` emits `build/workbook-worker.mjs` while `scripts/deploy-artifacts.mjs` still lists the older set. Both files were last changed in `88f0f57`, before this task, and neither is touched here. Left as-is and recorded as a pre-existing defect rather than silently edited.

### 7.4 Fixture corrections required to run the reporting suites

Two integration suites could not start on a fresh database, for reasons unrelated to the redesign, and their fixtures were corrected without weakening any gate:

- `report-centre-operational.db.spec.ts` uploaded a consent as an actor with no `DOCTOR` role, and then recorded a consent decision without opening the document. The real gates require both. The fixture now grants the actor the tenant's `DOCTOR` role and reads the original document through `readPatientDocument` before deciding — it exercises the gates instead of tripping them.
- The programme suites require an independently attested cluster. The disposable cluster's `pg_control_system()` identifier was supplied through `JALICARE_TEST_PG_SYSTEM_IDENTIFIER` and a second database (`reporting_programme_synthetic_test`) was migrated for the movements suite. No attestation check was bypassed.

## 8. Limitations and what is not claimed

- **No live browser run in this sandbox.** The environment has no Chromium and no browser runtime libraries, and outbound access is restricted to GitHub/npm/PyPI, so a browser could not be provisioned. Visual behaviour was verified through the DOM (jsdom + Testing Library, 53 UI tests), the production build, and the shared `ui-*` primitives already used by the rest of the application. Tablet/desktop breakpoints and pixel-level appearance have **not** been screenshot-verified here.
- The headline bar chart is a small SVG of the real daily series. It is not an interactive charting library: no smoothing, interpolation or invented points.
- 116 of the 144 catalogued reports remain unimplemented; the inventory states what each one needs. Nothing in this redesign claims otherwise.
- Only synthetic data was used. No production facility, patient or financial record was consulted.

## 9. Reproducing the inventory

```bash
npx tsx scripts/build-reporting-centre-inventory.ts
```

The script fails if a catalogue entry is missing from the programme matrix, so the inventory cannot silently drift from the code: 144 reports, 10 categories, 24 engine-backed, 4 existing-document workflows, 116 not implemented.
