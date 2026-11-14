# Syrona Medical Center — 2026 Annual Budget

## Scope and use

The existing Planning workspace now has an **Annual Financial Budget** view. It is a separate financial projection, not the procurement budget or actual accounting. Select an authorized **2026 / KES / DRAFT** plan. Opening an uninitialized financial budget only previews the supplied scenario; explicitly adopt the baseline to persist it. Approved plans are read-only. Existing planning sections remain available.

The supplied Syrona scenario has 75 lines and 13 departments (eight income, five expenditure). There are **16 columns**: reference, line name, rule, twelve months, annual total. Desktop reference/name/annual columns remain sticky; narrow screens use a horizontally swipeable grid to avoid covering monthly cells.

- Click a monthly value to edit. Enter or blur commits; Escape cancels. Amber marks a manual override; restore the cell to recover its underlying rule.
- Add custom departments or manual/formula-driven lines. Custom lines can be edited or deleted with confirmation; baseline lines cannot be deleted. Changing a custom line's calculation rebuilds its cells and clears incompatible overrides, as warned in the editor.
- Collapse departments or filter rows without changing totals.
- Formula Audit shows inert arithmetic rules instead of calculated money. References include `[INC-01]`, `[INC-01@-1]` and `PREV`. Only arithmetic, parentheses, references and numbers are supported—not JavaScript, spreadsheet functions or executable workbook formulas. Invalid references, dependency cycles and arithmetic errors block persistence.
- The Professional Fees checkbox optionally adds 70% of dialysis revenue in April–December; it defaults off, preserving the supplied rules.
- CSV and Excel export the entire current table (not just visible rows), including summaries. Excel contains genuine numeric money/percentage cells with number formats. Formula-audit expressions remain text, not executable formulas. CSV text is protected against spreadsheet-formula injection.
- Financial reset requires the exact phrase **RESET FINANCIAL BASELINE** and an audit reason. It removes this financial model's custom entities and overrides only. It is not the separate workspace-wide planning reset and does not delete procurement plans, imports, actuals, settings or audit records.

## Exact baseline reconciliation

| Measure                                          |           KES |
| ------------------------------------------------ | ------------: |
| January income                                   |    373,450.00 |
| January expenses                                 |    365,273.93 |
| January net profit                               |  **8,176.07** |
| Annual income                                    | 21,836,712.50 |
| Annual COGS                                      |    410,377.85 |
| Annual gross profit                              | 21,426,334.65 |
| Annual expenses, including COGS and depreciation |  5,182,107.26 |
| Annual net profit                                | 16,654,605.24 |
| Annual depreciation included above               |    210,095.16 |

Annual gross margin is **98.12%**; annual net margin is **76.27%**. Annual percentages use annual numerators/denominators, not a sum of monthly ratios. Ratios use zero when income is not positive. Negative amounts are red.

**The exact inputs produce a January profit, not a loss.** No extra expense was invented to force a loss. Likewise, the prescription formula's April/May change, Haematology's June-onward divisor of 1,000, and the changing Professional Fees composition are preserved rather than silently normalized. OGD is included in Minor Surgery/Endoscopy income. Zero statutory assumptions are editable projections, not verified payroll rates or compliance calculations.

## Persistence and isolation

Migration `0098_annual_financial_budget.sql` adds the separately scoped financial-model table. Session-resolved tenant/facility and existing planning RBAC govern API access. Writes lock the parent plan, require the correct year/currency/draft state and expected version, validate the entire model, then commit both model and previous/new audit in one transaction. Database triggers protect plan state and scope. Stale saves fail rather than overwrite. Failed saves do not show a successful receipt: the UI marks changes **unsaved/unverified**, blocks further mutations and requires reload.

Read-only repeatable-read lookup never automatically creates the baseline. Financial projections never generate ledger entries, purchase orders, inventory movements, goods receipts or payroll charges. No live facility identifiers, credentials or hardcoded letterheads are introduced.

## Verification (synthetic/local only)

- **182 tests passed across 13 suites**, including 19 financial model/engine/export tests, 10 financial PostgreSQL/HTTP tests and 12 financial React tests, plus planning/import/reset/accounting regressions.
- Applied 99 migrations, through 0098, to a disposable synthetic PostgreSQL database only.
- `npm run typecheck`, scoped ESLint, `npm run build` and `npm run build:server` passed. The frontend build still warns about a bundle over 500 kB.
- Browser verifier passed **13 checks** using the real grid in an explicitly isolated demo: inline edit and downstream recalculation, restore, desktop sticky columns, audit display, custom creation/deletion, reset guard, actual CSV/XLSX downloads, mobile overflow containment, and no browser runtime errors or application API requests.
- Evidence: `financial-budget-evidence/browser-results.json` and desktop/audit/mobile PNGs in the same directory.
- An initially oversubscribed parallel regression run timed out one UI test; the isolated UI suite passed, then the complete regression passed with two workers. No test assertions were weakened to hide it.

Reproduce the offline demo after a frontend build:

```sh
FINANCIAL_BUDGET_DEMO=YES PORT=5180 npx tsx scripts/preview-financial-budget.ts
```

This binds to `0.0.0.0`, uses no application session/API/database and discards edits on refresh. The demo is **not authenticated end-to-end integration evidence**. Browser verification requires an explicitly supplied Chromium executable and the demo on loopback; see `scripts/verify-financial-budget-browser.ts`. Financial DB tests require the explicit synthetic test opt-in; do not point them at a live database.

## Deployment boundary

No production migration, deployment, live query, live reset or live data change was performed. Production adoption requires authorized tenant/facility/year/currency selection, reviewed migration execution, permissions and authenticated environment verification. Existing unrelated guarded-DDL failure involving migration 0095 was not altered or represented as resolved. This feature does not establish statutory-rate accuracy or production readiness.
