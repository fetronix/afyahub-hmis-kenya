# Partner equity statements — implementation, verification and limits

## Scope and source contract

Implemented a separate **Accounting & Finance → Financial Reports → Partners’ Equity Statement** workspace. It does not post journals, change expenditure, generate purchase orders, update inventory, or reuse annual-budget/procurement projections as financial actuals. The previously published budget navigation remains intact.

The supplied Syrona screenshot is the source, **not an available Excel workbook**. The user selected `matched_pending_review` (proceed with review flags). Source image SHA-256 and explicit provenance are recorded in `partner-equity-evidence/source-provenance.json`.

- Original five names and display order are protected: Lucy Wanjiku; Jesee Mwaniki; Dr. Alex Muriithi; Teresia Gathoni; Dr. George Ngaruiya.
- All **14 rows** are retained: twelve monetary rows and two percentage rows.
- Source period: July 2025–June 2026, financial year 2026. The screenshot can be explicitly created only for that period; no page-load seeding or automatic copying into other years.
- Source net loss: **KES -2,353,704.47**; full-precision closing total: **KES 2,604,695.52**.
- Original admission dates remain unspecified/null. Dashes and source blanks are unspecified amounts, not verified zeroes. No interest/tax/depreciation rate has been inferred.

### Provisional, explicit formula definitions

Arithmetic uses bounded integer cents and BigInt rational operations, rounding only for displayed amounts. No spreadsheet formulas or cached workbook results are executed.

```
before = opening + capital + interest + salary
sharing = partner before / total before
allocation = net result × partner before / total before
after = before + allocation
closing = after + signed drawings + tax + revaluation + adjustments
ownership = partner closing / total closing
```

Null inputs contribute no amount to this provisional arithmetic but remain visibly unspecified. The screenshot's depreciation wording does not establish an independent depreciation rule. Formula Audit and the warning banner state these limitations rather than asserting workbook verification.

The one-cent differences are preserved, not distributed: displayed allocations sum to **KES -2,353,704.48**, versus total **KES -2,353,704.47**; displayed closing amounts sum to **KES 2,604,695.51**, versus total **KES 2,604,695.52**. Displayed sharing sums to **100.01%** and displayed ownership to **99.99%**. Reconciliation exposes these display differences separately from exact rational movement/allocation checks. Zero denominators produce explicit issues and block review/approval; negative denominators and negative partner values use signed rational arithmetic rather than an invented distribution.

## Implemented workflows

### Periods, storage and partners

Annual (365/366-day) and named other periods have explicit start/end dates, financial year ending in that year, scoped retrieval and duplicate-period checks. Creation and every save require an audit reason. Reload never reports an unsuccessful write as saved; stale versions fail closed.

The effective-dated partner register supports add/edit/archive, with no permanent-delete endpoint. Original names/order cannot be rewritten; additional partners follow the original five. Statements keep their own partner snapshots. Register edits do not silently change existing statements. Additional partners are included only in eligible periods; inclusion in an existing draft is explicit. Archival requires an effective departure date and does not remove historical financial records.

Carry-forward is never automatic. It requires an earlier **approved** statement in the same tenant/facility, a preview showing source/version/amounts/rounding, the current destination version, and the exact confirmation `CARRY REVIEWED OPENING BALANCES`. Rounded partner closings become opening inputs only after that acknowledgement; the source's one-cent difference is not silently assigned to anyone. The source identifier/version and rounding acknowledgement are audited.

### Dashboard and grid

Six KPIs and five accessible SVG charts derive from the same calculation result as the grid: opening versus closing, result allocations, ownership, movement waterfall, and closing comparison. Charts expose text values/tooltips and recalculate on input edits. Show/hide and executive presentation modes support report preparation. Presentation mode removes editing/workflow controls; it is an in-app presentation, **not a PowerPoint file export**.

The complete grid distinguishes editable inputs from calculated cells, preserves unspecified inputs, formats calculated KES/percent/negative values, highlights subtotals/closing and keeps Description/Total sticky. Narrow screens scroll inside the grid instead of expanding the whole page. Inputs are available only on authorized drafts. Formula definitions and reconciliation remain visible for review.

### Review, approval, security and audit

Authenticated server-resolved tenant/facility context is mandatory. Facility spoofing and super-admin/non-facility contexts are refused. The route is also behind the accounting module gate. Granular permissions are catalogued separately:

- `accounting.equity.read`
- `accounting.equity.manage`
- `accounting.equity.partners`
- `accounting.equity.review`
- `accounting.equity.approve`
- `accounting.equity.export`
- `accounting.equity.audit`

Existing `accounting.read` is also required. Client visibility is not the authorization boundary: server middleware, validation and scope-qualified queries protect every operation. No facility equity permissions are automatically granted by this change; authorized role assignment is an operational prerequisite.

Draft → Under Review → Approved is enforced on the server. A reviewer other than the last financial editor must explicitly type **`ACCEPT PROVISIONAL SCREENSHOT FORMULAS`**; approval requires that acceptance and a non-editor approver with the separate approval permission. A suitably authorized independent reviewer may also approve: this is a two-person preparer/reviewer control, not a mandatory three-person workflow. Returning a statement to draft clears acceptance. Approved rows are immutable, including SQL guards; changes require an explicit reasoned child revision. Review/approval identity and dates are retained.

Scoped append-only events store actor/time/reason and previous/new values. Writes and events are atomic; an audit failure rolls back the financial write. Optimistic versions, row/advisory locks, scoped foreign keys and approved/audit guards protect concurrency/history. Read/export responses are private/no-store. This does not claim protection against an unrestricted database owner bypassing application controls.

### Exports and branding

CSV and numeric/formatted XLSX export all partners and all rows from the saved statement, plus period/workflow/formula metadata; XLSX has a Formula audit sheet. Text is protected against CSV formula injection, and no executable workbook formulas are emitted. Unsaved input edits block exports so a saved export cannot be mistaken for an unsaved preview.

PDF resolves the active letterhead for the authenticated tenant/facility, refuses a missing/unusable letterhead, and uses the shared document renderer for branding and page numbers. No Syrona logo or another facility's branding is hardcoded. Prepared/reviewed/approved names and dates are included.

**Print-layout decision:** portrait letterheads cannot legibly fit five full partner-name columns plus Description/Total. The PDF therefore prints a complete totals ledger followed by **all 14 rows for every individual partner**, formula audit and reconciliation. Nothing is filtered out. CSV/XLSX retain the complete side-by-side grid. This also scales to additional partners without truncating columns. The existing shared renderer and unrelated document layouts were not modified.

## Verification and evidence

**245 focused tests passed across 17 suites**, comprising:

| Scope                                                                                      | Tests | Evidence                                      |
| ------------------------------------------------------------------------------------------ | ----: | --------------------------------------------- |
| Model/baseline/arithmetic/validation/CSV/XLSX/PDF                                          |    27 | `src/tests/partner-equity.spec.ts`            |
| React workspace, authorized navigation, input/export/register/year/carry/stale-save        |    12 | `src/tests/vitest/partner-equity-ui.spec.tsx` |
| Existing accounting/budget navigation/planning/model/import/reset/financial UI regressions |   155 | Combined focused regression log               |
| Equity disposable PostgreSQL and real HTTP/RBAC/workflow/concurrency/audit/export          |    11 | `src/tests/partner-equity.db.spec.ts`         |
| Existing financial-budget/planning disposable PostgreSQL regressions                       |    40 | Existing DB regression log                    |

The 14 non-DB suites total 194; the three DB suites total 51. The repository-wide test suite is **not** represented as passed. DB suites require explicit synthetic opt-in and guarded loopback database names; no production database was accessed.

**11 Chromium checks passed** against actual workspace/chart components with explicitly synthetic, in-memory API adapters: five-partner/14-row/six-KPI baseline, five charts, desktop sticky columns, edit-to-chart recalculation, explicit versioned save, saved export destination, chart hiding, 390px overflow containment, and no browser runtime errors or unexpected application/network requests. The mobile document width was 390px while the statement scroller retained its wider contents. This evidence is **not authenticated end-to-end live application testing**.

Browser screenshots/results: `partner-equity-evidence/01-partner-equity-desktop.png`, `02-partner-equity-mobile.png`, and `browser-results.json`. Desktop screenshot is the original source baseline; mobile screenshot deliberately shows the synthetic recalculation scenario after changing net result to KES 100.00.

PDF evidence uses a clearly labelled **synthetic** letterhead, never a production facility asset. The baseline PDF is 3 pages; the 15-partner PDF is 5 pages. Text extraction checks confirmed original names, closing total, formula warning, synthetic branding and page numbering throughout; the large-roster file contains every added partner. The first pages were rasterized and inspected. Evidence: `03-baseline-synthetic.pdf`, `04-large-roster-synthetic.pdf`, their page-one images and `pdf-results.json`.

Typecheck, frontend build and server build pass. Scoped ESLint has zero errors and two React effect-style warnings; frontend build retains the existing large-chunk warning. Formatting/diff checks cover the task files. Sanitized command output is retained under `partner-equity-evidence/verification/`.

### Reproduction

Run `npx vitest run --maxWorkers=2` on the 14 suites listed in the retained regression log. For the equity DB suite, set `EQUITY_SYNTHETIC=YES`, `SYRONA_REQUIRE_DB=1`, a loopback SQL host and disposable database **`equity_synthetic_test`**. Existing DB suites instead require `FINANCIAL_BUDGET_SYNTHETIC=YES` and **`financial_budget_synthetic_test`**. Use locally supplied synthetic credentials, never production credentials. Prepare the disposable schema with `scripts/migrate.ts` first. Typecheck in this resource-limited sandbox used `GOMEMLIMIT=1800MiB GOMAXPROCS=2 npm run typecheck`; no source settings were weakened. Then run `npm run build` and `npm run build:server`.

## Operational boundary and remaining review

- **No production migrations, deployment, live queries or financial-data edits were performed.** All 100 schema migrations, including new `0099_partner_equity_statements.sql`, were applied only to the disposable synthetic database.
- Production migration, permission catalogue synchronization, explicit facility role assignments and active-letterhead setup require a separately authorized rollout. This code is not a claim that the feature is already active in production.
- Original Excel formulas and depreciation semantics still need source-workbook/business review. Explicit acceptance authorizes the documented provisional interpretation; it is not proof of Excel equivalence.
- The executive presentation is in-app. A separately branded chart PDF/PPTX export is not implemented; the statement PDF contains the complete financial values and audit, not the interactive charts.
- Real authenticated facility browser/print-device acceptance and production-scale monitoring remain rollout tasks. Browser evidence here is synthetic, and PDF inspection used a synthetic A4 letterhead; unusually configured real letterheads need acceptance testing.

## Git protection

The sandbox initially exposed local HEAD `0111b5502e1a8d8a21faf53845360122275727df` while the working files already contained published history through `0e464a22da6959e53172da882e78a5274c4185f3`. Before alignment, **all 1,503 published files matched the initial SHA-256 manifest**. The branch reference and index were fast-forward-aligned only after that verification, without rewriting working files, resetting, cleaning or switching branches.

Only six existing files changed for equity integration; the other **1,497 baseline files remained byte-identical**. New equity modules/tests/migration/report/evidence are task-specific. Work stays on `arena/e088f11d-afyahub-hmis-kenya`, preserving published ancestry. No unrelated work, schema extraction contract, claim invoice gate or authentication/authorization tests were weakened.
