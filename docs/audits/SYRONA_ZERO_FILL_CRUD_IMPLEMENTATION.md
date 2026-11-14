# Syrona Budget & Procurement — zero-fill import and CRUD evidence

## Outcome

**Implemented and verified in disposable test facilities; not deployed or imported into production.**

The user's new zero-fill instruction is implemented as the default **import policy**, not as a retroactive claim that missing source values were verified zeros. The prior read-only strict reconciliation remains available and explicitly uses `STRICT` mode. Existing unrelated work was preserved.

- CSV, XLS and XLSX imports accept missing/dash numeric inputs as `0` and missing/dash units as `unit` under `ZERO_FILL`.
- Same-name imported rows retain separate source-row identities; no source descriptions are renamed or dropped to avoid collisions.
- All **241 official item/projection rows** were previewed and persisted in isolated test facilities: **232 stationery, 5 monthly branding, 4 uniforms**.
- Existing authenticated year/facility-scoped CRUD routes were retained and verified. Draft-only changes, audited soft deletion, independent approval and optimistic concurrency remain in force.
- The UI supports CSV uploads, policy selection, categorized sorting/filtering, source default review, inline prices/quantities, live annual previews, deletion and refreshed server totals.
- **64 targeted tests pass across 5 suites, with zero skips. 27 authenticated browser checks pass. Typecheck and both builds pass.**
- A separately executed repository migration-integrity suite has **6 passed / 1 failed** due to unchanged historical migration `0095`. This is not hidden or classified as passing; see below.

## Import policy and provenance

### Default: ZERO_FILL

| Input                                                            | Import result                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Missing/whitespace-only base or buying price                     | `0`                                                              |
| Blank/whitespace/dash monthly quantity                           | `0`                                                              |
| Missing/whitespace/dash unit cell                                | `unit`                                                           |
| Explicit numeric zero                                            | Remains explicit zero; not recorded as a fabricated default      |
| Uniform blank opening balance, staff count or per-staff quantity | `0` for the mapped field                                         |
| Well-formed grouped numeric string, e.g. `1,200.50`              | Validated literal `1200.50`                                      |
| Negative, malformed, excessive-precision or unsafe numeric input | Still rejected                                                   |
| Formula/cached formula in a mapped input                         | Still rejected; never executed                                   |
| Missing column mapping, invalid row range, unnamed item          | Still rejected; zero-fill does not guess field mappings or names |

`STRICT` remains selectable for source-integrity review: blank monthly quantities remain unplanned, missing prices/units and dashes remain errors, and legacy duplicate-name validation is preserved. All original strict unit assertions remain covered explicitly rather than being deleted or relaxed.

Every default records **worksheet, one-based row, column, original raw value, normalized value and reason**. Defaults are shown in the preview (first 100 in a collapsible list), included in the preview hash, and persisted in the import batch's validation evidence. Raw source bytes and SHA256 remain stored unchanged. The confirmation result/audit includes policy and defaulted-cell count. An import update now records the new source-import reference in its audited updated values as well as in the item row.

A new preview is required after policy or mapped inputs change. Confirmation still requires a recorded server preview, matching hash, explicit confirmation and a transaction. Files already uploaded to a facility remain SHA256-deduplicated: duplicate **names inside a file** are supported, but uploading the exact same file again still directs the user to import history instead of duplicating the batch.

### File validation

- UTF-8 `.csv` with `text/csv` or `application/csv`; `.xls`/`.xlsx` retain matching MIME/signature checks.
- CSV parsing is literal-only and handles BOM, quoted commas, escaped quotes, embedded newlines, CRLF and empty cells.
- Malformed quotes, binary/NUL input, invalid UTF-8, cells above 1,000 characters, more than 2,000 rows, more than 80 columns or more than 150,000 cells are rejected.
- Existing 4 MiB upload, bounded worker memory/time, concurrent-parser limit, macro/external-link rejection and spreadsheet protections remain.
- Headers and totals must remain outside the explicitly mapped data ranges. “All rows” means all item/projection rows, not importing titles or total footers as items.

## Duplicate identity and required migration

New prepared migration: `drizzle/0096_planning_source_row_identity.sql`, registered as journal entry 96.

It replaces the prior name-only imported-item uniqueness with an active imported-row composite key:

`plan_id + source_import_id + source_worksheet + source_row`

Manual records retain their existing case-insensitive category/name/unit uniqueness. An imported row does not overwrite a manual entry merely because the names match. Source descriptions and units remain independently editable on draft records.

`SKIP` / explicitly confirmed `UPDATE` match existing imported records using plan, category, name, unit (monthly items), worksheet and source row. Same names at different rows remain distinct. Multiple candidates cause a conflict rather than choosing an arbitrary row. Imports never silently replace approved plans.

**Deployment prerequisite:** duplicate-row persistence requires migration `0096`. It was applied only to explicitly disposable local synthetic/test databases. **No production migration has been authorized or run.** Existing migration `0095` and schema-contract fixtures were not rewritten.

## API CRUD and scoping

Base path: `/api/budget-planning`. The browser uses same-origin requests; no browser-facing localhost API URL was added.

| Operation                                                               | Route                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| List plans by year                                                      | `GET /plans?year=2026`                                                       |
| Read categorized items/projections and totals                           | `GET /plans/:id?year=2026&categoryId=...&month=...`                          |
| Read full unfiltered item and twelve months                             | `GET /plans/:id/items/:recordId`                                             |
| Create item with twelve monthly quantities                              | `POST /plans/:id/items`                                                      |
| Update price/quantities                                                 | `PATCH /plans/:id/items/:recordId`                                           |
| Audited soft-delete item and exclude its projections from active totals | `DELETE /plans/:id/items/:recordId`                                          |
| Create/update/delete uniforms                                           | `POST /plans/:id/uniforms`, `PATCH` / `DELETE /plans/:id/uniforms/:recordId` |
| Source upload / preview / confirm                                       | `POST /imports`, `POST /imports/:id/preview`, `POST /imports/:id/confirm`    |
| Import evidence/history                                                 | `GET /imports`, `GET /imports/:id`                                           |
| Audit                                                                   | `GET /audit?planId=...`                                                      |

Monthly projections are updated atomically as the item's twelve-month array, not through unscoped standalone child IDs. Removing an item is a soft removal that preserves monthly/history records while excluding them from active projections. A manually cleared monthly quantity can remain unplanned/null; import zero-fill does not globally rewrite manual edits or previously saved records.

Tenant and facility come from the existing authenticated authorization context and scoped facility resolver. A browser facility ID is only a validated selector, never an authorization grant. Plans own their year; list/projection year filters are checked server-side. No Syrona tenant/facility ID is hardcoded. The workspace defaults to **2026**, but other authorized years remain supported.

Read/manage/import/audit/export permissions and protected-plan transitions remain enforced. Mutations require the current plan version. Negative-input, read-only-user, wrong-facility, stale-version, approved/reviewed-plan and immutable-history checks were exercised in the database suites.

## UI behavior

- Navigation entry: **CSV / Excel Import & History**.
- Upload accepts `.csv`, `.xls`, `.xlsx`; browser sends the correct content type.
- Missing-value policy defaults to zero-fill; switching policy invalidates the preview.
- Category/section sort is available and selected by default, alongside existing category filters and totals.
- **Inline edit** opens inside the item table. It first fetches all twelve months, regardless of visible month/date filters.
- Editing base price or quantities immediately recalculates the annual preview with the existing fixed-point arithmetic.
- Explicit save sends an audited, versioned PATCH. Authoritative list/category/annual totals reload after success.
- A stale version or other server error leaves the edit visible and reports the error; it does not claim a save succeeded.
- Approved/reviewed plans do not expose eligible draft-only inline edits/removal.
- Existing full editors, create actions, uniform controls and soft-deletion confirmation remain.

### Supplied CSV mapping reference

For both CSV uploads, worksheet name is `CSV`. Use description B, unit C, base price D; map monthly **quantity** columns `F,H,J,L,N,P,R,T,V,X,Z,AB`, not neighboring costs.

| Source file / section          | One-based item rows |
| ------------------------------ | ------------------- |
| Stationery / OPD CONSUMABLES   | 9–141               |
| Stationery / DENTAL CONSUABLES | 145–184             |
| Stationery / CONSUMABLE ITEMS  | 186–244             |
| Branding / BRANDING            | 8–12                |

Uniform rows are 22–25: description C, buying cost E, opening balance D, staff G, quantity per staff H. An opening-balance rule must still be explicitly chosen. The tests select `SUBTRACT` as a **test assumption**, not as proof of the original spreadsheet formula. If combining files into one draft, import the second file with the explicit target-draft action after its own preview. Keep the original category spellings/source references for traceability.

## Actual-source isolated test evidence

Source SHA256 values match the supplied originals:

- Stationery: `244f9ba9bdd8f5a28793610cabfa8d931ecc76eff52b0fa553b11702e3f198e1`
- Branding: `75f810a0265ad0e6a08d9efc1e43a6705591ae81ae0aa6c109466a605881797e`

| Result                                               | Stationery | Branding + uniforms |
| ---------------------------------------------------- | ---------: | ------------------: |
| Imported monthly items                               |        232 |                   5 |
| Imported uniform projections                         |          0 |                   4 |
| Persisted monthly children                           |      2,784 |                  60 |
| Null monthly quantities under zero-fill              |          0 |                   0 |
| Defaulted mapped cells                               |      2,187 |                  64 |
| Recalculated monthly-item annual numeric sum         | 263,046.00 |           22,365.00 |
| Issued PDF pages using synthetic facility letterhead |          7 |                   1 |

Stationery defaults comprise **1,190 dashes + 997 missing cells** (991 monthly blanks, 5 prices, 1 unit). Branding defaults comprise 52 monthly blanks plus 12 blank uniform opening/staff/per-staff cells. The six rows in the three conflicting duplicate-name pairs remain separate records. Total imported monthly children: **2,844**.

`official-source-test-results.json` records test-facility identification, hashes, counts, normalization evidence, duplicate source rows, audit counts and PDF page counts. The database suite also verifies exact source-byte retention and exact PDF re-read bytes, and opens the generated Excel workbook with the expected Months worksheet. Browser checks separately verify authenticated PDF/Excel downloads through the existing report routes.

### Financial caveats — zero-fill is not source correction

- The stationery source numeric-cost sum remains **260,380.50**, whereas server recalculation under zero-fill is **263,046.00**. The known difference remains **+2,665.50**: Toner January +2,875.00; Alcohol Swab April −210.00 due to blank quantity becoming zero; Medicaine September +0.50.
- Original half-pay uniform entries are currency amounts, not percentages. They are retained in the source bytes; this change **does not infer a percentage or claim to reproduce the unavailable source formula**. The existing uniform UI still requires an explicitly reviewed contribution-percentage assumption. The isolated tests omit that mapping (displayed as 0%) and zero-fill staff/per-staff/balance, producing zero projected purchase cost. Review the half-pay rule before using nonzero staff projections operationally.
- `SUBTRACT` in the source test and `KES` in the synthetic facility fixture are explicit test settings. They do not confirm the real facility's opening-balance rule or source currency.
- No uploaded letterhead was assigned to an arbitrary real facility. Source-data test reports use the synthetic fixture's active uploaded letterhead. Actual Syrona active-letterhead and currency configuration still require authorized facility context.
- No inventory, purchase order, receipt, expenditure or other actuals were fabricated. These remain planning drafts until reviewed through the normal lifecycle.

## Verification status

| Check                                         | Result                                                           |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Targeted planning, source, CSV and UI suites  | **64 passed, 0 failed, 0 skipped; 5 suites**                     |
| Included database workflows                   | **25 passed**, with `JALICARE_REQUIRE_DB=1`                      |
| Authenticated production-build browser smoke  | **27 checks passed**, no runtime errors                          |
| Browser HTTP errors                           | Only expected session 401 and deliberately invalid-price 400     |
| Typecheck                                     | **PASS** — `npm run typecheck`                                   |
| Client build                                  | **PASS** — `npm run build`; existing >500 kB bundle-size warning |
| Server build                                  | **PASS** — `npm run build:server`; worker bundled successfully   |
| Full lint                                     | **PASS exit code**, 0 errors / 106 warnings                      |
| Scoped planning lint                          | **PASS**, no findings                                            |
| Changed-code formatting                       | **PASS**                                                         |
| Fresh disposable migration application        | **97 migrations applied successfully**, including final `0096`   |
| Separate repository migration-integrity suite | **6 passed / 1 failed**, historical `0095` Guarded Ddl assertion |
| Production imports / migrations               | **0 / 0**                                                        |
| Unrelated pre-existing files changed          | **0** outside the explicit 13-file modification allowlist        |

The repository migration-integrity failure is at `src/tests/migrations.spec.ts:200`: historical `0095_budget_procurement_planning.sql` uses unguarded `CREATE TABLE` statements. Its SHA256 is unchanged from the pre-task baseline. Rewriting a potentially applied migration would change its hash and is not justified as a way to make the test green. The test was not altered or skipped. New migration `0096` uses guarded index DDL. This report therefore **does not claim an entirely green repository-wide suite or production readiness**; migration governance needs separate review before deployment. The whole repository test suite was not run.

## Evidence and reproduction

Evidence directory: [`syrona-zero-fill-evidence/`](syrona-zero-fill-evidence/)

- `tests.txt`, `typecheck.txt`, `build.txt`, `server-build.txt`, `lint.txt`, `scoped-lint.txt`, `format.txt`
- `migrations.txt` and `migration-integrity.txt` — successful scratch application and the separate baseline failure
- `browser.txt`, `browser/browser-results.json`, responsive/navigation/import/inline screenshots
- `official-source-test-results.json` — test-only actual-source results and all defaulted-cell references
- `preservation-check.json` — SHA256 comparison against 1,354 pre-existing files; 13 intentionally modified, 1,341 unchanged; no unexpected changes

Targeted test command (set **only an explicitly disposable local test database** and supply the official CSV directory):

```sh
JALICARE_REQUIRE_DB=1 SYRONA_SOURCE_DIR=/path/to/official-csvs npx vitest run \
  src/tests/budget-planning.spec.ts \
  src/tests/budget-planning.db.spec.ts \
  src/tests/syrona-reconciliation.spec.ts \
  src/tests/syrona-zero-fill.spec.ts \
  src/tests/vitest/planning-zero-fill-ui.spec.tsx
npm run typecheck
npm run build
npm run build:server
npm run lint
npx vitest run src/tests/migrations.spec.ts  # Known historical 0095 failure documented above
```

The source-dependent tests require `SYRONA_SOURCE_DIR`; they skip without uploads on another machine. This execution supplied both the sources and a required database, so none of the 64 targeted tests skipped. Test-only embedded PostgreSQL/Chromium dependencies, database contents, credentials and generated builds stay outside the tracked deliverables. The real-browser verifier now accepts `BUDGET_BROWSER_EVIDENCE_DIR`, so fresh evidence does not overwrite historical reports/screenshots.

## Files changed

Runtime: `src/budget-planning/{csv.mjs,workbook-worker.mjs,workbook.ts,planning.service.ts,planning.routes.ts,reports.service.ts}`; `src/api/clients/planning.client.ts`; `src/components/modules/planning/{PlanningImport.tsx,PlanningWorkspace.tsx,PlanningInlineItem.tsx}`.

Migration preparation: `drizzle/0096_planning_source_row_identity.sql`, `drizzle/meta/_journal.json`.

Verification: existing budget unit/database tests extended without removing their assertions; new `src/tests/syrona-zero-fill.spec.ts` and `src/tests/vitest/planning-zero-fill-ui.spec.tsx`; browser verifier extended; prior read-only audit explicitly selects `STRICT`.

No Git reset, cleanup, branch switch, staging, commit or push was performed for this task. No production plan was replaced, archived or otherwise altered. Before operational use: review migration governance, authorize the production index migration separately, choose the authenticated Syrona facility/year/currency, and explicitly review/confirm each zero-filled draft preview.
