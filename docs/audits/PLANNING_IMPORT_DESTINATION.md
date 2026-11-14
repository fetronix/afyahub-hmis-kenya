# Explicit planning import destination

## Outcome and boundaries

Implemented explicit **Import into an existing plan** (default) and **Create a new draft plan** paths. No actual import was executed, no pending batch was confirmed, and no production migration was run. Browser evidence uses a **disposable local synthetic facility**, not the real Syrona database. Its sole seeded plan mirrors the requested name and assumptions: **Syrona Medical Center Annual Plan 2026 / 2026 / MIXED / KES / 5% / DRAFT**. This is not evidence that a real facility's records were inspected or changed.

## Behavior

- Existing destinations come from the authenticated facility plans API, independently of the workspace's navigation filters and pagination. Options include name, year, type, currency, status, ID and revision. Only DRAFT targets are selectable. Choosing one fills and locks its assumptions; no editable new-plan name appears.
- New mode exposes editable name and assumptions, explicitly explains that confirmation would create a separate draft, checks existing non-archived facility/year plans, rejects duplicate names and requires independent authorization for an additional plan when that year already has one.
- The server independently checks tenant/facility scope, supported year/type/currency, exact target assumptions, DRAFT status and revision. Existing RBAC and authenticated facility middleware remain in place. Archived, approved and review targets are rejected.
- Preview displays the canonical destination (existing/new, plan name/ID or pending ID, facility name/ID, year, type, currency, inflation and revision), plus new/matching/skipped/conflicting/update counts and source normalization/warnings.
- Destination, merge mode, assumptions, target revision, reconciliation counts, original source hash and workbook preview hash are bound to a durable review hash. Confirmation validates that binding, locks and revalidates the destination and matching counts before writing. Changing destination, mappings or reviewed inputs requires a fresh preview. Legacy previews without an explicit destination must be regenerated.
- Existing mode defaults to SKIP, preserving matching imported rows. UPDATE needs a separate explicit authorization. Matching excludes manual rows and retains worksheet/source-row identity. Original bytes, SHA256, duplicate detection, calculations, audit events and optimistic concurrency remain in the existing pipeline.
- A facility-keyed import workspace avoids retaining a previous facility's component state. Fields are disabled during requests; confirmation uses the reviewed request snapshot rather than current editable inputs.

## Exact task files

Application:

1. `src/budget-planning/import-destination.ts` — new canonical destination resolver, scoped validation, matching/counts and review binding.
2. `src/budget-planning/planning.service.ts` — destination-aware preview and locked confirmation using the existing writers/audit pipeline.
3. `src/components/modules/planning/PlanningImport.tsx` — explicit destination UI, facility target loading, assumptions, intentional additional-plan authorization and bound review/confirmation.
4. `src/components/modules/planning/PlanningWorkspace.tsx` — facility key on the import component; existing workspace work preserved.

Tests and verification:

5. `src/tests/planning-import-destination.spec.ts` — 31 SQL-mocked service/middleware tests.
6. `src/tests/vitest/planning-import-destination-ui.spec.tsx` — 8 UI tests.
7. `src/tests/vitest/planning-import-history-ui.spec.tsx` — existing pagination/target test adapted to explicit destination UI.
8. `src/tests/budget-planning.db.spec.ts` — existing disposable-DB regression requests adapted to the bound destination protocol; **not executed** in this task.
9. `scripts/verify-planning-import-destination-browser.mjs` — guarded loopback synthetic-only browser verifier; intercepts confirmation and plan-create requests defensively.

Documentation/evidence:

10. `docs/audits/PLANNING_IMPORT_DESTINATION.md` — this report.
11. `docs/audits/planning-import-destination-evidence/01-existing-plan-assumptions.png`
12. `docs/audits/planning-import-destination-evidence/02-existing-plan-preview.png`
13. `docs/audits/planning-import-destination-evidence/03-new-draft-fields.png`
14. `docs/audits/planning-import-destination-evidence/browser-results.json`
15. `docs/audits/planning-import-destination-evidence/integrity.json`
16. `docs/audits/planning-import-destination-evidence/test-results.txt`

## Validation

| Check                                                       | Result                                               |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| Focused Vitest suite, 8 files                               | **92 passed**, no skips                              |
| New service/middleware destination tests                    | 31 passed (mocked SQL; no real writes)               |
| New destination UI tests                                    | 8 passed                                             |
| Existing planning tests                                     | 20 passed                                            |
| Source ZERO_FILL tests                                      | 10 passed                                            |
| Source reconciliation tests                                 | 5 passed                                             |
| Import history UI tests                                     | 7 passed                                             |
| ZERO_FILL UI tests                                          | 4 passed                                             |
| Planning sections UI tests                                  | 7 passed                                             |
| `npm run typecheck`                                         | Passed                                               |
| `npm run build`                                             | Passed; existing large-chunk advisory                |
| `npm run build:server`                                      | Passed                                               |
| Scoped ESLint, all 9 code/test/script task files            | Passed                                               |
| Scoped Prettier check, all 9 code/test/script task files    | Passed                                               |
| Chromium against compiled app + disposable PostgreSQL       | **19 checks passed**, no browser runtime errors      |
| Full plan/category/item/month/uniform before/after snapshot | SHA256 equal; one plan and one manual item preserved |

Focused test command:

```sh
SYRONA_SOURCE_DIR=/tmp/arena-coding-uploads npx vitest run \
  src/tests/planning-import-destination.spec.ts \
  src/tests/budget-planning.spec.ts \
  src/tests/syrona-zero-fill.spec.ts \
  src/tests/syrona-reconciliation.spec.ts \
  src/tests/vitest/planning-import-destination-ui.spec.tsx \
  src/tests/vitest/planning-import-history-ui.spec.tsx \
  src/tests/vitest/planning-zero-fill-ui.spec.tsx \
  src/tests/vitest/planning-sections-ui.spec.tsx
```

Service tests cover existing/new destinations, extra-plan authorization, facility/tenant isolation, incompatible year/type/currency/inflation, protected statuses, stale revision, permissions, destination/source/mapping/policy substitution, duplicate idempotency, manual-row exclusion, SKIP preservation, explicit UPDATE authorization and changed/ambiguous/inactive matches. Confirmation paths run **only against mocked SQL**. The real-DB regression file was updated and typechecked, not executed; this report does not claim full database mutation/concurrency-suite verification or full-repository test success.

## Browser evidence and integrity

The verifier selected the synthetic Syrona-named plan from the **import-specific loaded dropdown**, verified its selected assumptions, previewed Branding worksheet CSV rows 8–12, rejected an intentional direct USD preview request, then switched to NEW mode to show editable fields and required additional-plan authorization. Its initial attempt mistakenly waited for the workspace navigation option instead of the import dropdown; that verifier synchronization error was corrected, and the final complete run passed.

Preview counts: **5 new, 0 matching, 0 skipped, 0 conflicting, 0 updates**. Source rows and normalization evidence remained visible. No confirmation or plan-create request was sent (protective interception was not triggered). The original Branding batch remained **UPLOADED**, with no import result. Its source SHA256 remained `75f810a0265ad0e6a08d9efc1e43a6705591ae81ae0aa6c109466a605881797e`.

Before verification, a new disposable PostgreSQL database was initialized with the repository's existing 97 migrations and exactly one synthetic plan plus one manual item. Migrations and fixture seeding applied **only to that disposable local database**, never production. Upload staging and preview/audit metadata are expected writes; plan data was unchanged. The complete before/after plan snapshot hash comparison is in `integrity.json`. Synthetic credentials and database runtime files are confined to ignored scratch storage and are not deliverables.

## Migration and compatibility

**No new schema migration required.** Existing `planning_import_batches.validation` JSON stores the canonical destination/counts/hash. Original source-row protections and existing migrations are unchanged. Backend and frontend should be released together: callers must supply an explicit destination and obtain a new bound preview before confirmation; pre-change previews intentionally fail closed with `DESTINATION_PREVIEW_REQUIRED`.

## Working-tree and delivery status

Branch: `arena/e088f11d-afyahub-hmis-kenya`; HEAD remains `0111b5502e1a8d8a21faf53845360122275727df`. Existing extensive dirty/untracked work was preserved. A 1,435-file pre-edit SHA256 inventory comparison identified exactly five baseline files changed, all listed above: service, import component, workspace, DB regression tests, and history UI tests. The remaining task files are additions. No baseline file was deleted or changed outside that scope.

The branch still has **no configured upstream**. No upstream was configured and nothing was staged, committed or pushed; the earlier request to stop on a missing upstream remains a delivery blocker. No branch switch, reset, clean, rebase or history rewrite was performed. Real-facility acceptance and deployment remain unperformed and require appropriate authorization.
