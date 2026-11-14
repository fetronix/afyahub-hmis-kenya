# JaliCare — Accounting & Finance workspace redesign

**Report date:** 2026-10-27  
**Scope:** interface/navigation restructuring of existing accounting; no accounting rebuild.  
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`

## 1. Previous structure and inspection

`AccountingModule.tsx` was a 973-line component rendering billing diagnostics, source coverage, GL tie-out, journal exceptions, expense approval, receipt/refund settlement, reviewed billing posting, report summaries, account creation, period creation/closing, manual journals and reversals on one long screen. Its date filters appeared after several billing workflows. Finding chart setup required scrolling through unrelated reconciliation controls.

Inspected before implementation:

- Application module routing and its facility-module/permission gates in `src/App.tsx`; Sidebar and Header navigation.
- AccountingModule, ExpenseApprovalPanel, PaymentSettlementWork and BillingJournalPostingPanel.
- Existing accounting overview/client, `src/routes/accounting.routes.ts`, accounting service, chart listing, financial-period and journal operations.
- Existing PayrollModule tabs, source verification and readiness panel.
- Existing BankPaymentsWorkspace and its finance-module, facility-account and bank-read requirements.
- Existing accounting/banking/payroll UI, route-contract and PostgreSQL tests.

The underlying accounting APIs and calculations already existed. They were reused rather than replaced.

### Git preservation

The checkout reported HEAD `0111b55` with the large pre-existing dirty/untracked application tree, despite the prior turn's verified push. That state was recorded, not reset/reconstructed. All **1,291 existing files captured at task start remain present**. Only seven captured files were changed for this task; the rest retain their captured hashes. New files are limited to workspace presentation, targeted acceptance tests/script and this report/evidence. No staging, commit, branch switch, force-push, reset or clean was performed for this redesign.

## 2. New navigation structure

The same application `accounting` module now opens **Accounting & Finance**, defaulting to its dashboard. Desktop uses left-side finance navigation; small screens use a compact native workspace selector. Within a section, only the selected view is rendered. There are no new backend or duplicate application module routes.

| Workspace section                | Views / destination                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accounting Dashboard**         | Posted revenue/expenses, trial-balance status, open-period count, configuration alerts, last checked exception snapshots and clear next actions    |
| **Accounting Setup**             | Chart of Accounts; Financial Periods; Payroll Account Mapping; Accounting Configuration                                                            |
| **General Ledger**               | Journal Entries; Ledger Postings; Controlled Reversals; Trial Balance                                                                              |
| **Billing & Revenue Accounting** | Billing Exceptions; Source-to-Ledger Coverage; Subledger Tie-out; Journal-Side Exceptions; Receipt & Refund Settlement; Reviewed Billing Posting   |
| **Expenses & Payables**          | Existing Expense Review & Approval / payable posting; explicit Outstanding Payables limitation                                                     |
| **Payroll Accounting**           | Seven links into the existing Payroll module: employee payroll, periods, statutory rules, mappings, calculations, payslips and accounting postings |
| **Banking & Reconciliation**     | Entry into the existing Bank Payments & Reconciliation workspace, with manual-only/live-integration disclaimers                                    |
| **Financial Reports**            | Trial Balance; Income Statement; Balance Sheet                                                                                                     |

Trial balance in General Ledger and Financial Reports is the same rendering and data source, not two report implementations. Ledger Postings shows the existing account-level posted debit/credit movements, not a fabricated transaction drill-down. Journal Entries now also presents the overview's existing recent posted-journal list, clearly limited to the latest 100 within the date range.

The report-date filter bar is consistently above the selected view. Report values are returned by the existing scoped accounting overview. No fallback financial zero is invented on loading/error. A failed overview refresh clears its displayed financial data instead of presenting old figures as a successful refresh. Empty lists provide clear next actions.

### Dashboard truthfulness

- Revenue and expenses: posted-journal values for the selected reporting dates.
- Trial balance: API-provided totals/status, not a client-side accounting recalculation.
- Period count: all recorded OPEN facility periods, explicitly labelled; the configuration alert separately checks whether an open period covers the report end date.
- Billing/ledger exception indicators: not checked until the user runs the existing diagnostics. Last examined page results are labelled as such, not presented as facility-wide counts. Changing date/facility scope hides prior-scope reports.
- Outstanding payables: no verified unpaid aggregate is available, so no guessed monetary amount appears.
- Payroll mapping/statutory readiness: dashboard directs the administrator to the existing checks; it does not certify payroll configuration or production readiness.

## 3. Preserved workflows and permissions

| Operation                       | Existing implementation retained                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/view chart accounts      | Existing overview account data and `sprintApi.createAccount` → `POST /api/accounting/accounts`; create requires `accounting.coa.manage`           |
| Open financial periods          | Existing `createPeriod` → `POST /api/accounting/periods`, same permission and validation                                                          |
| Close periods                   | Existing `closePeriod`, required review note and `accounting.periods.close` control                                                               |
| Manual journal posting          | Existing balanced two-line form, exact payload, idempotency key and server enforcement; `accounting.journals.post`                                |
| Controlled journal reversal     | Existing reason/open-period requirements, key/retry behaviour and immutable original history; same posting permission                             |
| Billing diagnostics and tie-out | Same client methods, scoped APIs, amounts, pagination and limitations; requires both `accounting.read` and `billing.read`                         |
| Reviewed billing posting        | Same BillingJournalPostingPanel, source review, account choices, lost-response recovery and duplicate controls; same permissions                  |
| Receipt/refund review           | Same PaymentSettlementWork and reviewed settlement recovery; same permissions and warnings                                                        |
| Expense review/approval/posting | Same ExpenseApprovalPanel; independent reviewer and both expense-approval/journal-post permissions still required for mutation                    |
| Trial balance/CSV               | Same overview data and authenticated CSV export; `accounting.reports.export` still required for export                                            |
| Income statement/balance sheet  | Same API-provided posted-journal summaries; no formula changes                                                                                    |
| Payroll readiness and posting   | Same PayrollModule with an optional initial-tab hint only; verification, mappings, effective dates, periods, approval and posting gates unchanged |
| Banking                         | Same separate application module and BankPaymentsWorkspace, not an embedded duplicate transaction register                                        |

Accounting still requires an authorized facility account and `accounting.read`. The existing application-level enabled/hidden accounting-module checks remain unchanged. The component additionally avoids fetching the overview for unauthorized/platform accounts. Read-only users do not receive journal/create/reversal mutation controls. A real read-only browser session also received HTTP 403 when attempting the existing journal mutation API.

Payroll entry links require the facility Payroll module to be enabled/not hidden and `payroll.read`. Setup reuses **PayrollReadinessPanel** to show actual missing account-purpose mappings and statutory blockers. Its today-only preview is explicit; an administrator opens the existing payroll Ledger accounts tab to save mappings or chooses a real period in Payroll for period-specific validation. No missing-chart, rule or accounting-period check is bypassed.

Banking entry requires the facility Finance module to be enabled/not hidden, a facility account and `bank_payments.read`, matching the existing application route requirements.

No accounting services, financial calculations, API routes, database schemas, migration files, audit mechanisms, facility/tenant scoping or idempotency implementations were modified.

## 4. Missing/limited functionality identified honestly

1. **Chart editing and activation/deactivation:** not exposed by the inspected accounting API/UI. The chart view supports the existing create/view capability and states this limit. It does not add unsafe direct edits or pretend these controls exist. The overview does not provide per-row active-state metadata, so the chart table does not invent it; payroll readiness still diagnoses inactive selected mappings through its existing API.
2. **Outstanding payables:** expense approval can post a payable journal, but there is no verified unpaid-balance/ageing/payment-tracking aggregate in this interface. The dashboard and dedicated view state that limitation and direct users to actual expense review records.
3. **Supporting documents:** existing expense references remain references only. No upload/existence-verification feature was added or claimed.
4. **Expense payment processing:** payable posting is not payment. No payment initiation was introduced.
5. **Bank integrations:** controlled manual transfers, statement import, match review and reconciliation worksheets exist. No live bank collection, transfer or notification API is enabled; sandbox authentication is not live integration. No fake transactions or reconciliation results are displayed.
6. **Detailed ledger browsing:** the existing overview returns account movements and at most 100 posted journals. No individual journal-line drill-down or comprehensive paginated journal register was invented.
7. **Financial statements:** retain the existing posted-journal summaries only. Unposted sources, unrecorded costs and unverified cost allocations are excluded. No cash-flow, service-line profitability or other unsupported reports were added.
8. **Navigation model:** workspace sections use local view state, consistent with the existing application module architecture; no new bookmarkable URLs/browser-history routes were introduced. Reload defaults to Accounting Dashboard.
9. **Receipt evidence:** recorded receipts remain distinct from verified bank/provider settlement. Existing settlement/reconciliation warnings remain visible.
10. No live facility configuration, production payroll compliance, live bank integration, salary payment or statutory filing was certified by this UI work.

## 5. Exact files changed

### Existing files extended (seven)

- `src/App.tsx` — passes a payroll initial-tab destination from Accounting to the existing PayrollModule; existing route/module gates retained.
- `src/components/Header.tsx` — Accounting & Finance module title.
- `src/components/Sidebar.tsx` — Accounting & Finance navigation label, same module ID.
- `src/components/modules/AccountingModule.tsx` — renders one selected workspace view while preserving existing handlers, forms and business panels; setup mapping preview and entry points.
- `src/components/modules/PayrollModule.tsx` — exported tab type and optional initial-tab prop only; no readiness/calculation/posting changes.
- `src/tests/vitest/billing-gl-reconciliation-ui.spec.tsx` — original assertions retained, with navigation to the relocated panel.
- `src/tests/vitest/source-ledger-coverage-ui.spec.tsx` — original assertions retained, with navigation and an unambiguous heading query for the relocated panel.

### New code/tests (four)

- `src/components/modules/accounting/AccountingNavigation.tsx` — typed eight-section catalogue, desktop navigation and compact mobile selector.
- `src/components/modules/accounting/AccountingWorkspacePanels.tsx` — API-backed dashboard and honest links/status panels; no financial calculations.
- `src/tests/vitest/accounting-workspace-ui.spec.tsx` — 11 targeted tests covering modular navigation, original mutation payloads/keys, reports, links, permissions, missing capabilities and API error states.
- `scripts/accounting-workspace-browser-synthetic.mjs` — guarded, additive real-Chromium acceptance runner against an explicitly authorized loopback synthetic database and app.

### Report/evidence

- This report: `docs/audits/JALICARE_ACCOUNTING_WORKSPACE_REDESIGN_2026-10-27.md`.
- `docs/audits/accounting-workspace-evidence/browser-results.json` — 39 browser assertions.
- `docs/audits/accounting-workspace-evidence/validation-output.txt` — sanitized validation output.
- The twelve screenshot files listed below, all under `docs/audits/accounting-workspace-evidence/`.

No unrelated file was staged. No new database migration was needed.

## 6. Screenshots and browser evidence

Real Chromium used actual HTTP APIs and an isolated disposable PostgreSQL database with synthetic users/data. No production credentials, real staff/patient records or provider calls were used. Repeated additive smoke attempts left clearly labelled synthetic fixture journals/accounts/periods, so screenshot totals reflect that test database's real posted records rather than a fixed screenshot seed. The successful journey verifies its own original/reversal pair; it does not claim that every prior interrupted attempt was reversed.

| Evidence                                     | Screenshot                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Dashboard                                    | [01-accounting-dashboard.png](accounting-workspace-evidence/01-accounting-dashboard.png)             |
| Chart and account creation                   | [02-chart-of-accounts.png](accounting-workspace-evidence/02-chart-of-accounts.png)                   |
| Period setup                                 | [03-financial-periods.png](accounting-workspace-evidence/03-financial-periods.png)                   |
| Posted journal list/form                     | [04-journal-entries.png](accounting-workspace-evidence/04-journal-entries.png)                       |
| Posted income statement                      | [05-income-statement.png](accounting-workspace-evidence/05-income-statement.png)                     |
| Receipt/refund settlement                    | [06-billing-settlement.png](accounting-workspace-evidence/06-billing-settlement.png)                 |
| Expenses/payables                            | [07-expenses-payables.png](accounting-workspace-evidence/07-expenses-payables.png)                   |
| Actual missing payroll mapping/rule blockers | [08-payroll-mapping-blockers.png](accounting-workspace-evidence/08-payroll-mapping-blockers.png)     |
| Existing separate banking workspace          | [09-existing-banking-workspace.png](accounting-workspace-evidence/09-existing-banking-workspace.png) |
| Mobile dashboard, 390 × 844                  | [10-mobile-dashboard.png](accounting-workspace-evidence/10-mobile-dashboard.png)                     |
| Mobile setup, 390 × 844                      | [11-mobile-accounting-setup.png](accounting-workspace-evidence/11-mobile-accounting-setup.png)       |
| Read-only role controls                      | [12-read-only-permissions.png](accounting-workspace-evidence/12-read-only-permissions.png)           |

Browser assertions: login; eight distinct sections; dashboard separation; two account creates; period opening; balanced manual journal; trial balance/CSV; income/balance-sheet values; four real billing diagnostic APIs; settlement warning; reviewed billing controls; expense empty state; honest payables limit; missing mapping/rule diagnostics; setup-to-payroll mapping link; all seven payroll destinations; existing banking destination; controlled reversal plus SQL-balanced history check; compact mobile navigation/no horizontal document overflow; read-only UI restrictions and API 403; no uncaught browser rendering errors. Reviewed billing-source and expense posting integrity is additionally exercised by the real-DB regression suites below, not claimed as a new browser posting implementation.

Report date follows the session date. Sandbox-generated screenshots/log timestamps use the sandbox system clock, which differs; they are synthetic execution evidence, not a later legal or production audit.

## 7. Test results

**Final targeted run: 20 suites, 158 passed, 0 skipped.** Database availability was required (`JALICARE_REQUIRE_DB=1`). Tests ran against isolated PostgreSQL 18.6 on loopback. The existing full migration chain applied successfully: **95 migrations**; no migration was authored for this redesign.

| Suite                        |  Passed |
| ---------------------------- | ------: |
| accounting-workspace-ui      |      11 |
| billing-gl-reconciliation-ui |       3 |
| source-ledger-coverage-ui    |       4 |
| billing-journal-ui           |       2 |
| payment-settlement-work-ui   |       4 |
| phase3b-expense-approval-ui  |       9 |
| payroll-ui                   |       9 |
| payroll-readiness-ui         |       5 |
| bank-payments-ui             |       8 |
| client-accounting.db         |       6 |
| client-accounting primitives |       4 |
| client-expenses.db           |       2 |
| journal-scope-integrity.db   |       5 |
| bank-reconciliation.db       |      12 |
| bank-payments.db             |      13 |
| workforce-payroll.db         |      23 |
| client-route-contract        |       4 |
| billing-posting.db           |      16 |
| billing-gl-reconciliation.db |       7 |
| phase3b-expense-approval.db  |      11 |
| **Total**                    | **158** |

Additional checks:

- Real Chromium/HTTP: **39 assertions passed**; desktop 1600 × 1050 and mobile 390 × 844; no uncaught rendering errors.
- TypeScript: `GOMAXPROCS=2 GOGC=50 NODE_OPTIONS=--max-old-space-size=1000 npx tsc --noEmit` — passed.
- Prettier check on all eleven changed/new code/test/script files — passed.
- `npm run lint` — passed, **0 errors / 106 warnings**; not warning-free. Existing hook warnings remain; they were not suppressed for this task.
- `npm run build` — passed; existing large frontend-chunk warning remains (approximately 2.04 MB minified main JavaScript, 469 KB gzip).
- Browser client/server route contract — passed; no new/duplicate backend routes were introduced.
- Preservation audit — no captured baseline file missing; unrelated captured hashes unchanged.

The entire repository-wide test suite was not rerun. No production migration or live accounting transaction was performed.

### Reproduction notes

Use an explicitly authorized disposable synthetic PostgreSQL database, the existing migration runner and the existing synthetic workforce fixture; never point the fixture or browser runner at a live database. The browser runner validates target name, loopback host and database identity before use. It requires finance access including the existing accounting create/post/report-export, billing-read, payroll-read/statutory and bank-read permissions, plus an accounting-read-only synthetic HR session. In this run those grants and Finance module enablement were added only to the disposable fixture, not production permission catalogues.

Supply normal `SQL_*` environment variables, separate `SYNTH_FINANCE_PASSWORD` / `SYNTH_HR_PASSWORD`, `BASE_URL` for the loopback development app and a working `CHROME_EXECUTABLE_PATH`. Set `BROWSER_SMOKE_SYNTHETIC=YES`; the runner refuses production mode. Run:

```sh
node scripts/accounting-workspace-browser-synthetic.mjs
```

Browser fixture preconditions include an open accounting period covering the synthetic October 2026 entry/reversal dates. The runner adds its own future period without modifying existing periods. Dependencies/tools/database files and credentials used for this run are ignored local tooling, not application deliverables.

## 8. Remaining work and conclusion

The Accounting & Finance workspace is modular and synthetically verified without changing accounting calculations or services. Chart/period/mapping setup can now be reached directly, billing review no longer precedes every accounting action, and report views are separate from posting forms.

For a demonstration, use approved synthetic/demo configuration and actual data returned by the application; retain the displayed capability limitations. For operational use, facility administrators must still verify chart/rule/period configuration, access rights, reconciliations and financial expectations. Implementing chart editing/activation, a verified outstanding-payables register, detailed ledger drill-down or live bank integrations would be separate explicitly scoped backend work, not concealed inside this navigation change.
