# Budget & Procurement Planning — implementation and verification

## Outcome and source-data blocker

Implemented a facility-scoped planning workspace inside **Accounting & Finance → Accounting Setup → Budget & Procurement Planning**. It has eight subsections and does not create a second Accounting or operational Procurement module. The existing eight finance navigation sections are preserved.

**The software has been exercised with synthetic data; reconciliation against the requested original workbook is blocked.** `SYRONA 2026 Annual Plan - Stationery and branding projections template-UP (1).xls` was not present in the checkout or available upload locations. No original rows have been imported or certified. Uploading that file and reviewing its mappings/calculation assumptions is still required before accepting its plan data. This is not a production-readiness or compliance attestation.

## Preservation and scope

- Branch: `arena/e088f11d-afyahub-hmis-kenya`.
- HEAD inspected before work: `0111b5502e1a8d8a21faf53845360122275727df`.
- Initial working tree: 678 status entries. Existing work was not reset, cleaned, staged, committed or pushed.
- A pre-task SHA-256 inventory was compared after implementation. No baseline paths were missing. Changes to baseline files were confined to the 11 integration/configuration files listed below.
- No production database, patient records, provider activation or live banking integration was used.
- `claim-invoice-gate.ts`, `assertAttestedCluster`, authorization/scoping implementations, existing published tests and `schema-contract-before-extraction.json` were not edited.

### New implementation files

| Files                                                   | Purpose                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/budget-planning/calculations.ts`                   | Fixed-point validation, rounding, inflation and uniform calculations         |
| `src/budget-planning/workbook-worker.mjs`               | Bounded XLS/XLSX parser; no formula execution                                |
| `src/budget-planning/workbook.ts`                       | Binary/type validation, explicit mappings, preview errors and hash           |
| `src/budget-planning/planning.service.ts`               | Transactional CRUD, draft lifecycle, imports, concurrency and audit          |
| `src/budget-planning/reports.service.ts`                | Filtered projections, retained PDF/Excel reports and branding history        |
| `src/budget-planning/planning.routes.ts`                | Scoped, permission-checked HTTP endpoints                                    |
| `src/db/schema/planning.ts`                             | Drizzle table definitions                                                    |
| `drizzle/0095_budget_procurement_planning.sql`          | Planning tables, integrity constraints, lifecycle and immutability triggers  |
| `src/api/clients/planning.client.ts`                    | Authenticated UI client, binary upload and report downloads                  |
| `src/components/modules/planning/PlanningWorkspace.tsx` | Eight sections, filters, dashboard, tables, lifecycle, reports and audit     |
| `src/components/modules/planning/PlanningEditors.tsx`   | Plan/category/item/uniform forms                                             |
| `src/components/modules/planning/PlanningImport.tsx`    | Worksheet inspection, editable mapping, validation, confirmation and history |
| `src/tests/budget-planning.spec.ts`                     | 20 calculation/parser tests                                                  |
| `src/tests/budget-planning.db.spec.ts`                  | 23 database/workflow/security/report tests                                   |
| `scripts/seed-budget-planning-browser.ts`               | Explicitly gated synthetic browser fixtures; no schema reset                 |
| `scripts/verify-budget-planning-browser.mjs`            | Real authenticated Chromium workflow checks and screenshots                  |

### Existing integration files changed

`package.json`, `package-lock.json`, `drizzle/meta/_journal.json`, `scripts/build-server.mjs`, `src/db/schema.ts`, `src/routes/index.ts`, `src/seeds/permissions.ts`, `src/documents/document-model.ts`, `src/components/modules/AccountingModule.tsx`, `src/components/modules/accounting/AccountingNavigation.tsx`, `tsconfig.json`.

The runtime spreadsheet dependencies are `@e965/xlsx` and `fflate`. The production build includes a separate `build/workbook-worker.mjs` entry. TypeScript excludes generated/dependency/test-tool directories (`build`, `dist`, `node_modules`, `.tmp-tools`), in addition to the existing backup exclusion. No application source or tests were excluded. An initial post-build typecheck exhausted memory while generated/tool files were included; the normal `npx tsc --noEmit` command passed after that generated-file exclusion was corrected.

## Database and lifecycle

Migration **0095** adds eight tables:

1. `planning_import_batches` — facility-scoped private source bytes, filename, MIME, SHA-256, validation and result metadata.
2. `planning_plans` — year, currency, plan type, configurable inflation, status and optimistic revision.
3. `planning_categories` — source category labels and controlled active/inactive state.
4. `planning_items` — descriptions, units, base/adjusted prices and source references.
5. `planning_months` — twelve dated monthly children, nullable quantity/amount, explicit zero retained.
6. `planning_uniforms` — separate opening balances, staff quantities, costs and contribution calculations.
7. `planning_events` — immutable previous/new change evidence and actor references.
8. `planning_reports` — immutable issued PDF bytes, report model, export data, filters and letterhead version.

Composite scope references protect facility/tenant associations; plan/category membership, monthly year, uniqueness and draft-only child mutations are checked. Issued reports and audit events cannot be updated or deleted. Existing `audit_logs` receives companion planning-change entries.

Plans follow **DRAFT → REVIEW → APPROVED → ARCHIVED**, with return from REVIEW to DRAFT. A draft can also be archived. Review/approval requires a nonempty plan and no unreviewed blank monthly quantities. Approved records cannot be edited or soft-removed. Approval rejects the creator and last editor; archiving an approved plan requires approval permission. Draft mutations and transitions require the current plan revision and use transactional row locks.

The migration runner successfully applied **all 96 migrations, including 0095**, to a newly created disposable local synthetic PostgreSQL database. This does not mean any deployment database was migrated.

## Eight UI subsections

- **Planning Dashboard:** annual known budget, selected monthly/date-range item budget, item and uniform counts, annual uniform budget, category totals, facility pending-review count and import-state counts.
- **Excel Import & History:** secure upload, worksheet/header inspection, category row-block mapping, validation errors/warnings, preview, explicit confirm/cancel and batch history.
- **Annual Plans:** draft creation, configurable assumptions, category management and lifecycle actions.
- **Stationery & Consumables:** base/adjusted prices, monthly quantities/costs, annual totals, full-record viewing/editing, soft removal, sorting and pagination.
- **Branding & Uniform Projections:** explicit source-category selection for monthly branding items and a separate annual uniform structure. Mixed-plan branding is not guessed from description text.
- **Planning Periods:** annual and first-of-month planning periods plus lifecycle controls, explicitly separate from accounting posting periods.
- **Reports:** annual, monthly, category, item-level, branding/uniform and full-year prior-plan comparison; issued PDF/Excel and print/reprint history.
- **Audit History:** scoped immutable actor/action/previous/new records with pagination.

Read-only users do not receive mutation controls. The API remains authoritative even if browser controls or facility IDs are manipulated. During browser testing, an editor-refresh race was found and fixed; editing an item while a month filter is active now loads all twelve months and preserves unselected months.

## Import workflow and limits

1. Upload matching `.xls` or `.xlsx` binary with matching MIME and signature; maximum **4 MiB**.
2. Inspect returned worksheet names, source cells and candidate headers. Empty sheets remain visible.
3. Define source row blocks, exact category labels, description/unit/base-price columns and twelve monthly **quantity**, not cost, columns. Uniform blocks use their separate staff/balance/cost fields. Excluded rows are explicit.
4. Validate the preview. Missing names/units, invalid or negative numbers, duplicate source/matching rows, formula-based inputs and invalid mappings are rejected. Blank quantities remain null, not zero.
5. Review assumptions and choose **NEW**, **SKIP matching**, or explicitly confirmed **UPDATE matching** into the current revision of an eligible draft. An additional same-year draft needs a separate confirmation; existing plans are not silently replaced.
6. Confirm only the actually recorded, hash-matched preview. The server reparses/recalculates and commits all rows and audit evidence transactionally. A changed preview or stale draft revision is rejected. Repeated successful confirmation returns the retained result rather than duplicating rows.
7. Cancellation retains source/audit metadata without importing records.

The parser uses a worker with a five-second timeout, 128 MiB V8 old-generation limit and at most two concurrent parses. Limits include 12 worksheets, 2,000 rows/80 columns per sheet, 150,000 cells, and ZIP preflight limits of 20 MiB declared expanded data/1,000 members. Macro/external-link ZIP members and detected VBA workbooks are refused. Formula text is provenance only: formulas are never executed, and cached formula values are not accepted as mapped input values. Source bytes are not exposed through public filesystem URLs.

### Actual versus synthetic row evidence

| Dataset                         | Verified result                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Requested original `.xls`       | **Unavailable; zero original rows verified/imported**                                                                         |
| Generated synthetic workload    | 133 `OPD CONSUMABLES` + 40 `DENTAL CONSUABLES` + 59 `CONSUMABLE ITEMS` = **232 synthetic stationery items**                   |
| Same generated workbook         | 5 synthetic monthly branding items; 7 separate synthetic uniform rows at source rows 20–26; empty `Sheet3`                    |
| Synthetic import result         | **244 created**, 0 updated, 0 skipped, 0 validation errors; 237 monthly items, 7 uniforms and **2,844 monthly child entries** |
| Production browser `.xls` check | One synthetic mapped item previewed and explicitly confirmed through the built worker/API                                     |

These matching synthetic workload counts are capacity/structure tests, **not proof of the real workbook’s contents or formulas**. The generated count workload uses XLSX to retain writer-produced formula text; XLS is separately exercised by parser and production-browser tests. Details and hashes are in [synthetic-import-results.json](budget-planning-evidence/synthetic-import-results.json).

## Calculations and filters

- Money uses integer cents; quantities use three decimal places; percentages use hundredths of one percent.
- Adjusted unit price = base price × (1 + inflation/100), rounded half-up to cents **before** multiplying by monthly quantity.
- Monthly cost is rounded half-up; annual item total sums monthly costs. Blank months are explicitly marked as unplanned, with partial-known-total notices.
- Plan inflation is configurable. Five percent is supported as an imported assumption, not hardcoded globally. Optional item overrides are retained when plan assumptions are changed.
- Uniform projected units = staff × quantity per staff. An explicit SUBTRACT/IGNORE choice controls opening-balance treatment. Gross purchase cost minus the explicit staff-contribution percentage gives net annual budget. No monthly allocation is invented for uniforms.
- Plan assumption changes recalculate draft item/month values on the server and retain previous/new calculation evidence.
- Filters include plan year/type/status, actual date bounds against monthly first-day dates, month, category, description/unit search, item ID, sort and pagination. Item pages contain 20 records; report totals cover the full matching selection, not just the visible page.
- Year-on-year reports compare same-facility prior-year plans with matching type/currency. They deliberately require complete annual selections rather than silently comparing mismatched monthly/category filters.

## Reports and uploaded letterhead

Reports reuse existing **Facility Branding storage/resolution** and the shared document renderer. A real active uploaded PDF letterhead is required; a missing PDF produces `ACTIVE_LETTERHEAD_REQUIRED`, not a hardcoded facility name or fake uploaded reference. A small inner text-ascender inset keeps planning content inside the uploaded body rectangle without changing the shared renderer.

Issued PDF bytes, data/model, filters and letterhead version are immutable. The Excel export includes the issued report rows, active filters, item data, monthly entries and uniform inputs/calculations. Reprints return the original bytes after a replacement letterhead is activated; a later report uses the new version. Cross-facility report IDs are rejected.

A synthetic 62-item report produced two A4 pages. Both were rendered and inspected, retained the synthetic uploaded header, repeated the table header, and kept body text inside the reserved 85 pt top / 60 pt bottom margins:

- Page 1 measured body top/bottom: approximately **87.78 / 747.44 pt**.
- Page 2 measured body top/bottom: approximately **88.39 / 669.28 pt**.
- Page height: 841.89 pt; available body ends at 781.89 pt.

See [PDF layout results](budget-planning-evidence/pdf-layout-results.json), [synthetic PDF](budget-planning-evidence/synthetic-multipage-report.pdf), [Excel counterpart](budget-planning-evidence/synthetic-multipage-report.xlsx), and the two rendered page images. These are synthetic documents, not original-facility branding evidence.

**Budget versus actual is deliberately unavailable.** No verified attribution of actual expenditure to these planning items exists. `ACTUAL` reports return `ACTUALS_NOT_AVAILABLE`; no purchases, inventory, orders, GRNs, expenditure, journals or payments are fabricated or posted.

## Authorization and isolation evidence

Endpoints are mounted at `/api/budget-planning` behind the existing authenticated API, the Accounting module gate and `accounting.read` + `accounting.planning.read`. Additional permissions are:

- `accounting.planning.manage`
- `accounting.planning.import` (also requires manage)
- `accounting.planning.approve`
- `accounting.planning.export`
- `accounting.planning.audit`

The existing scoped-facility resolver checks the caller’s authenticated tenant/facility against any request hint. Global/super-administrator accounts are not allowed to operate facility plans through these routes. Queries then constrain plan/batch/report data to that scope. Responses are private/no-store.

Database/HTTP tests cover unauthenticated requests, read-only mutation/export/audit denials, super-admin rejection, cross-facility hints, foreign plan/category/import/report IDs, tenant predicates, stale revisions, independent approval, approved-child protection and immutable history. The real browser uses actual login sessions, persisted role permissions and the full production server rather than an authentication mock.

## Final checks

| Check                                    | Result                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Normal `npx tsc --noEmit`                | **PASS**, after excluding generated/tool directories; no source/tests excluded       |
| `npm run lint`                           | **PASS: 0 errors, 106 warnings** in the broader existing tree                        |
| `npm run format:check`                   | **PASS**                                                                             |
| `npm run build`                          | **PASS**, with the existing large-client-chunk advisory                              |
| `npm run build:server`                   | **PASS**, eight outputs including the workbook worker                                |
| Fresh disposable DB migrations           | **PASS: 96 migrations**, including 0095                                              |
| Selected unit/integration/regression run | **PASS: 91 tests / 6 suites**, no skipped tests                                      |
| Real Chromium workflows                  | **PASS: 24 checks**, no page runtime errors                                          |
| Two-page PDF layout inspection           | **PASS**, retained uploaded synthetic header and reserved body margins on both pages |
| Baseline preservation                    | No missing baseline files; no existing tests or protected gate/contract files edited |

The six suites were `budget-planning.spec.ts`, `budget-planning.db.spec.ts`, `vitest/accounting-workspace-ui.spec.tsx`, `vitest/client-accounting.spec.ts`, `integration/document-generation.db.spec.ts`, and `integration/letterhead-branding.db.spec.ts` under `src/tests/`. This was a targeted regression run, not a claim that the entire repository test suite passed.

The browser’s only HTTP error responses were the expected unauthenticated initial session probe (401) and the deliberately rejected negative-price input (400). See [browser-results.json](budget-planning-evidence/browser-results.json). Twelve browser screenshots and two PDF page images are retained in [budget-planning-evidence](budget-planning-evidence/README.md). Runtime artifact timestamps reflect the sandbox clock; they are not production timestamp attestations.

## Reproduction and deployment prerequisites

Use a newly created **local, disposable synthetic test database**, set the usual `SQL_*` environment variables, apply the normal migration runner, then run:

```sh
JALICARE_REQUIRE_DB=1 npx vitest run \
  src/tests/budget-planning.spec.ts \
  src/tests/budget-planning.db.spec.ts \
  src/tests/vitest/accounting-workspace-ui.spec.tsx \
  src/tests/vitest/client-accounting.spec.ts \
  src/tests/integration/document-generation.db.spec.ts \
  src/tests/integration/letterhead-branding.db.spec.ts
npx tsc --noEmit
npm run lint
npm run format:check
npm run build
npm run build:server
```

For browser reproduction, the database name must explicitly contain both `synthetic` and `test`, and the SQL host must be loopback:

```sh
BUDGET_BROWSER_SYNTHETIC=YES npx tsx scripts/seed-budget-planning-browser.ts
# Start the built production server against that SAME synthetic database.
# Set CHROME_EXECUTABLE_PATH to an installed Chromium executable.
BUDGET_BROWSER_SYNTHETIC=YES node scripts/verify-budget-planning-browser.mjs
```

The fixture writes randomized, synthetic-only login details to ignored `.tmp-tools/budget/browser-session.json`, not source control or this report. `BUDGET_BROWSER_BASE_URL` defaults to loopback port 4193; optional `BUDGET_BROWSER_ARGS` accepts the arguments required by the installed test browser. The verification script does not weaken production authentication or add a demo bypass.

Before an authorized deployment: back up the intended environment, review/apply 0095 with the normal migration tooling, seed the permission catalogue and deliberately grant appropriate planning roles. Upload/activate the real facility’s letterhead using existing Facility Branding. No deployment migration, commit or push was performed here.

## Remaining limitations and acceptance work

1. **Upload and reconcile the original workbook.** Real descriptions, all source rows/categories, actual worksheet layout, formulas, cached inputs, prices and projected totals remain unverified.
2. **Uniform source semantics require confirmation.** The implemented model is an explicit contribution **percentage of gross purchase cost**, with a chosen opening-unit balance rule. A source half-pay currency amount, per-staff contribution, Excel fractional-percent cell, monetary opening balance or different formula is not silently reinterpreted. Review/normalize inputs in a corrected workbook or extend the mapping model with verified source semantics before accepting such data. The original formula is never executed.
3. No automatic guess maps arbitrary workbooks; mappings and exclusions require review. The inspector previews the first 40 rows, while mapped ranges may address all accepted rows. Pending import mappings are not an autosaved editing session and must be re-entered after reopening a batch.
4. Planning dates represent monthly buckets, not actual daily purchases. Uniform values remain annual unless a separately verified allocation model is introduced.
5. Full-year YoY comparisons only; verified actual-expenditure integration is not implemented. Import/history and report/history displays are capped at the latest 100 entries; matching projections are capped at 5,000 items and worksheet/parser limits apply.
6. The source-specific clinical/stationery plan data and production tenant permissions/letterhead must receive facility-owner review. Synthetic tests and screenshots do not establish production readiness.
