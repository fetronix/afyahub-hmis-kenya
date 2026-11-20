# Reporting programme — Batch 1 acceptance and remaining work

## Decision and honest completion accounting

**Accepted only:** the bounded **recorded stock-movement register** in the existing Reporting Centre. **The 144-report completion programme is not complete.** This pass delivers the full source/requirements inventory, priority plan and one independently tested implementation batch. No production access, deployment, new reporting system, schema change or blanket permission grant.

| Classification | Before implementation | After Batch 1 |
| --- | ---: | ---: |
| Catalogue entries | 144 | 144 |
| Fully certified complete reports | 0 | 0 |
| Partial entries / individual-document workflows | 27 | 28 |
| Unavailable entries | 117 | 116 |
| Newly implemented bounded subsets | — | 1 |

The 27 baseline partial entries are 23 subset report labels backed by 19 engines and four existing individual-document workflows. Batch 1 adds the twentieth engine, `inventory-movements`, for the existing `stock-goods-stock-movements` entry. It remains **partial against the wider stock-report requirement**, although the explicitly bounded recorded register passed the acceptance below. Do not represent these counts as 28 fully complete reports.

## Audit, priorities and scope

- `REPORTING_PROGRAMME_BASELINE_MATRIX.{md,json}`: 144-entry preimplementation source/schema snapshot, frozen before report implementation.
- `REPORTING_PROGRAMME_CURRENT_MATRIX.{md,json}`: current per-entry functionality, intended users, candidate schema entities/source module, API/query engine, filters, exports, letterhead, missing implementation, dependencies/risks and eight business-priority groups. Proposed audiences are not role grants. Some unavailable workflows have no established source entities; this is explicitly not evidence that their source exists.
- `REPORTING_PROGRAMME_PLAN.md`: initial findings, operational shortlist and controlled follow-on batches. Immediate clinical/lab work was not replaced with invented release, utilisation or workload rules just to increase counts. Stock movements were the first reliable bounded new source available for acceptance.
- Required clinical-document initial/final audits were read and existing implementations preserved. Their historical test counts are not counted as fresh results here.

### Exact implemented meaning

Movement rows are scoped by authenticated tenant and facility; only same-facility item metadata is joined. Current code/name/unit are labelled as current, not historical snapshots. A deliberately malformed link to a sibling-facility item remains visible as a local movement but exposes no foreign item metadata or net. The result warns about this inconsistent link.

Required inclusive recorded movement dates (maximum 366 days), optional literal search, movement type and ownership-checked item selectors reuse shared validation and UI. Unsupported department filters are rejected: recorded free-text locations/actors are not trusted department/staff identities. Existing report/source/export permissions and module policy remain enforced.

Per-item signed net is calculated **after filters, before pagination**, repeated on that item's rows, never summed across items or units. Synthetic truth is Alpha Pieces `+10 - 3 = 7`, Beta mL `+100 - 20 = 80`; the malformed `+1` row has withheld item/net. There is no fabricated `87` summary, stock valuation, historical opening/closing balance or posted accounting. Adjacent-date and sibling/foreign rows are excluded. `stock_after` is shown as recorded, not replayed after backdated movements. The service producers append movements; no database-level immutability trigger was established by this audit.

Shared generate/export/selector paths, repeatable-read query/audit transaction, common active-facility PDF renderer and existing workbench are reused. No operational records are changed by report generation.

## Fresh executed verification

| Check | Result |
| --- | --- |
| New real PostgreSQL/HTTP movement suite | **12/12 passed** |
| Seven-suite reporting/branding DB regression, including those 12 | **79/79 passed**; do not add the 12 again |
| Four existing focused catalogue/UI/export/invoice suites | **30/30 passed** |
| New requirements-matrix/claims guard | **4/4 passed** |
| Built SPA, normal staff authentication, real Chromium/native downloads | **32 checks passed**, zero uncaught browser errors |
| Inspection of saved native PDF/XLSX bytes | **101 checks passed** |
| TypeScript, frontend production build, server build | Passed |
| ESLint on changed TypeScript files | Passed; not whole-repository lint |

DB regression suites: `report-centre-movements`, `report-centre-operational`, `report-centre`, `report-centre-ledger`, `report-centre-selectors`, `report-centre-diagnoses`, `letterhead-branding`. New tests cover exact source calculations, both date boundaries, invalid/missing/reversed/excessive dates, literal wildcard search, selector and pagination net recalculation, tenant/facility isolation, source/export permission denials, hidden/disabled module policy, clear empty results, export parity and existing draft/active letterhead. Mandatory audit insertion was deliberately forced to fail in the disposable cluster: generation failed closed rather than releasing report data. Expected injected database errors are not successful-report errors.

The browser used the actual built application, existing catalogue navigation and workbench, normal username/password staff login and existing selectors/status/date controls. Native browser download completion was observed through CDP, and the five downloaded files were verified byte-for-byte against their authenticated export responses. Scope denials and audit persistence were checked through the same browser-authenticated session. No in-memory HTTP adapters.

### Saved artifacts and visual inspection

Evidence directory: `reporting-programme-batch-1-evidence/`.

- `results.json`: 32 browser checks and five native-download records; `report-result.json`: actual generated five-row source snapshot; `audit-events.json`: corresponding synthetic audit actions.
- `movements.pdf`, `movements.xlsx`: exact five-row branded exports. All 15 columns/values, metadata scope, per-item nets and count compared with the generated snapshot. OOXML inspected directly; no workbook formulas.
- `movements-before-activation.pdf`: disclosed **No active facility letterhead** fallback. Upload stayed draft; activation was explicit through the existing letterhead service.
- `movements-empty.{pdf,xlsx}`: no stale rows, fabricated balances or silently zero-filled quantities; active letterhead retained for the empty PDF.
- `export-inspection.json`: 101 individual content assertions. Branded PDF is two pages, with same-facility active version and correct page numbering on both. Text stays inside page bounds; foreign item metadata is absent.
- `01–04` browser PNGs and `05–07` rendered PDF PNGs: representative workbench, actual rows, empty/error states, both branded PDF pages and unbranded fallback. Reviewed rendered first/last branded pages and real rows/date-error screenshots: readable labels/nets, no clipped page text or foreign branding. The common renderer can continue a record onto the following page; it does not repeat that record's heading. No claim of a redesigned print layout or clinical sign-off.

Synthetic artifact generation timestamps reflect the sandbox clock (2026-11-15), which differs from the conversation date. They are recorded output timestamps, not evidence of real clinical dates or production operation. All source movements use explicit January 2026 synthetic dates.

## Reproduction and safety

`npm ci`, then frontend/server builds. Provision only a **new disposable PostgreSQL 16 cluster** with the repository migrations (101 for this baseline); never load deployment credentials or reuse an unknown database. The fixture refuses to proceed unless `SQL_HOST=127.0.0.1`, `SQL_DB_NAME=reporting_programme_synthetic_test`, the independently obtained PostgreSQL system identifier (`SYRONA_TEST_PG_SYSTEM_IDENTIFIER`) and exact absolute `REPORTING_TEST_PG_DATA_DIRECTORY` all match the live connection. Supply only disposable credentials through environment variables, and `SQL_SSL=false`, `SYRONA_REQUIRE_DB=1`.

Run `npx vitest run src/tests/integration/report-centre-movements.db.spec.ts` under that attested environment. Browser script: `REPORTING_PROGRAMME_SYNTHETIC=YES CHROME_EXECUTABLE_PATH=<local-chromium> npx tsx scripts/reporting-programme-acceptance.ts`; it starts/stops the built server on port 4196 and uses a disposable random-password staff fixture. Native Chromium libraries may need local provisioning. Inspect downloads with `python3 scripts/inspect-reporting-programme-exports.py` (PyMuPDF required). `npx tsx scripts/reporting-programme-matrix.ts` regenerates CURRENT only; baseline regeneration is refused. The source-only matrix test requires no database. Disposable tooling/dependencies/database files remain ignored, not shipped artifacts.

## Deferred work, blockers and limitations

Every remaining entry has its specific gap in the current matrix; no additional batch is claimed implemented. Principal dependencies:

1. **Clinical/OPD/inpatient:** approved certificate/signature content, encounter/completion attribution, event-time ward capacity and occupancy denominators. Existing registers/documents do not solve historical utilisation or general workload.
2. **Lab/radiology:** approve pending/partial/cancelled and released-event semantics, specimen links, TAT clocks and billing attribution. Verified is not independently released.
3. **Inventory/pharmacy:** provenance for historical openings, movement coverage, paired transfers/returns, immutable item/unit snapshots and costing/valuation policy. Current metadata and quantities do not establish any of these.
4. **Billing/expenses/procurement:** integrate existing authorized GRN/LPO/receipt workflows in later small batches; validate approved/incurred/paid/posted distinctions, attribution and reversals. Budget/projection is never expenditure.
5. **Accounting:** validate posted mappings, openings, effective periods and approved full financial statement semantics. Historical provisional equity and posted ledger remain separate and unchanged.
6. **Management/statutory/HR:** owner-approved definitions, form versions, privacy/RBAC and effective-dated official mappings. No unverified statutory-rate seeds, arbitrary audit JSON exports or unrestricted payroll/bank access.

No facility-approved presentation shortlist has been supplied: plan priorities are proposals pending owner confirmation. Full repository suites/coverage/lint, cross-browser/native Microsoft Excel rendering, accessibility/security/load review, live deployment and production data reconciliation were **not** performed. Only synthetic source correctness and the bounded paths above are evidenced. Push preserves engineering work; it is not deployment, legal compliance or production readiness certification.
