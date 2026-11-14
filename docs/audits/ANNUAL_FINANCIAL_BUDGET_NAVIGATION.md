# Annual Financial Budget navigation relocation

## Change boundary

Base implementation: `788f09a`. Current branch: `arena/e088f11d-afyahub-hmis-kenya`.

The Accounting & Finance navigation now contains:

```text
Accounting & Finance
└── Budgeting & Financial Planning
    ├── Annual Financial Budget
    └── Budget & Procurement Planning
```

The existing financial projection is reused, not rebuilt or duplicated. The old procurement-planning financial tab and the old Accounting Setup procurement shortcut are removed from navigation. The procurement workspace retains its other tabs and settings; its workspace-wide reset is not displayed as part of the financial module. Financial reset itself is unchanged.

No changes to financial-budget components, schema/migrations, API routes/services/clients, formulas, exports, permission definitions or reset logic. The existing scoped plan selector is reused. Financial scenario records remain separate from procurement line items and from actual accounting. No data was migrated, merged or reseeded.

## Routes, access and refresh

Existing internal view IDs are preserved (`planningFinancials`, `planningDashboard`, and supporting `planning*` views). Only navigation dispatch and chrome change. Recognized hash bookmarks restore the accounting workspace and planning view after authentication:

- `/#accounting/planningFinancials` — Annual Financial Budget
- `/#accounting/planningDashboard` — Budget & Procurement Planning
- `/#accounting/planningItems` — existing stationery/consumables view

Fragments are client-only, so no Express route registration change is needed. Existing pathname/query parameters are retained. Unknown/malformed hashes do not select a budget view. Browser history changes are handled; leaving accounting clears a stale budget bookmark without modifying unrelated hash routes.

The new parent is displayed only to users with existing `accounting.planning.read` access. Direct bookmarks do not bypass the existing authentication, facility-module, accounting, planning, manage/export or server-side scope/RBAC gates. The URL supplies no tenant, facility or record identity. Users without planning-read access do not mount the planning workspace or make planning requests through this entry point.

## Files changed

| File                                                                | Navigation-only purpose                                                                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                                                       | Restore recognized budget bookmarks through the existing accounting module gate                                                           |
| `src/components/modules/AccountingModule.tsx`                       | Select the budgeting section, dispatch existing views, maintain active tabs/history and planning-read mount guard                         |
| `src/components/modules/accounting/AccountingNavigation.tsx`        | Add the parent and two sibling entries; remove the old Setup shortcut; filter the parent with the existing read permission                |
| `src/components/modules/accounting/accounting-budget-navigation.ts` | Narrow bookmark parser/writer and authenticated entry/exit hook                                                                           |
| `src/components/modules/planning/PlanningWorkspace.tsx`             | Hide the old financial navigation entry and procurement-only navigation/settings on the financial view; reuse all existing data workflows |
| `src/tests/vitest/budget-navigation-ui.spec.tsx`                    | Ten new navigation/access/refresh/saved-draft/edit/export regression tests                                                                |
| `src/tests/vitest/accounting-workspace-ui.spec.tsx`                 | Update only the expected unique section count for the added parent; existing assertions retained                                          |
| This report and `budget-navigation-evidence/`                       | Scope, results, synthetic browser screenshots and check results                                                                           |

## Regression verification

- **195 tests passed in 14 focused suites**: the ten new navigation tests, existing accounting workspace tests, financial model/export/React/PostgreSQL/HTTP tests, and existing planning/import/reset/section regressions.
- **11 Chromium checks passed** using the real AccountingModule/PlanningWorkspace/AnnualFinancialBudget with explicitly synthetic API/context adapters. Covered new parent, single entry, editing and chained formulas, export destination, refresh, direct links, separate procurement tabs/table, ordinary accounting navigation, mobile selector and no runtime errors or unexpected API/network requests.
- Existing saved-data contracts were verified with synthetic saved drafts in UI tests and real disposable PostgreSQL persistence/HTTP regressions. Browser persistence evidence uses synthetic local storage only; it is **not live facility data or authenticated end-to-end application evidence**.
- `npm run typecheck`, scoped ESLint, formatting, frontend build and server build passed. Scoped ESLint reports an existing `react-hooks/set-state-in-effect` warning at the unchanged accounting overview `load()` effect (no errors). Frontend build retains the existing large-bundle warning.
- The two database suites ran only against a newly created loopback `financial_budget_synthetic_test` PostgreSQL database, with explicit synthetic-test opt-in. The existing 99 migrations were applied there solely to prepare test schema; **no migration files were changed**.

Reproduction: run the financial-budget, budget-planning, planning-import-destination/outcomes/reset-contract suites plus the financial, budgeting-navigation, accounting-workspace and planning section/zero-fill/reset/import-outcomes UI suites with `vitest run --maxWorkers=2`. The database suites require their guarded disposable synthetic environment. In this resource-limited sandbox typecheck used `GOMEMLIMIT=1800MiB GOMAXPROCS=2 npm run typecheck`; source configuration was not changed for that limit.

Browser results and screenshots: `docs/audits/budget-navigation-evidence/`. The browser fixture deliberately has no authenticated application session/API/database. The repository-wide test suite was not represented as passed; results above are the focused verification scope.

## Git and operational boundary

Only navigation code, focused navigation tests and evidence/report are included. Existing published history is preserved on the same branch; no branch switch, force-push, reset, clean or working-tree discard. The sandbox initially exposed an old local reference with the published snapshot as dirty/untracked files; its initial bytes were compared against the published commit before index/reference-only alignment. This avoids recommitting or losing unrelated history.

No production migration, deployment, live query or live reset was performed. Final commit and push verification are provided in the completion message.
