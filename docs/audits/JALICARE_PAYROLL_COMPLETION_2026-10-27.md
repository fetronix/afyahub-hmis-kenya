# JaliCare existing HR / payroll — implementation and verification

Session date: **27 October 2026**. The sandbox clock and some pre-existing repository documents have later dates; those are not the business-rule effective date. Branch: `arena/e088f11d-afyahub-hmis-kenya`; starting HEAD `0111b5502e1a8d8a21faf53845360122275727df`.

## Outcome and limits

The existing implementation has been repaired and extended, not replaced. Authorized facility administrators can expose its HR and Payroll navigation through the existing facility module configuration. Staff pay/components, finalized review schedules, bulk payslips and audit/annual extract controls now have UI entry points. Preparation, independent approval and ledger finalization have been exercised against synthetic PostgreSQL and in real Chromium.

**This is not a declaration that every Kenyan employment/tax case is supported, that any deployed facility has been upgraded, or that salaries have been paid or returns filed.** Read the limitations and rollout checklist below before operational payroll.

## 1. Exact visibility diagnosis

The code already contained `WorkforceModule`, `PayrollModule`, the `hr` / `payroll` App switch cases, Header labels, workforce API registration, tables and calculation engine. A missing React route or absent payroll engine was **not** the cause.

The concrete configuration/RBAC gaps were:

1. `src/config/facility-modules.ts` did not list `hr` or `payroll`. The existing facility module editor consequently could not provision them, and the corresponding module-ID middleware did not accept those IDs.
2. Sidebar visibility requires the persisted facility `enabledModules`, absence from `hiddenModules`, and `hr.read` / `payroll.read`. Its facility-admin operational allowlist also omitted these modules. Adding App switch cases alone would not fix visibility.
3. Fresh tenant `FACILITY_ADMIN` provisioning in `src/routes/platform/tenants.routes.ts` omitted workforce grants, although the permission seed already included limited HR/payroll read/preparation grants. Existing seeded facilities and newly provisioned tenants could therefore differ.
4. HR/payroll tasks were missing from staff-role task delegation's module allowlist. Appropriate payroll work could not be consistently assigned through the existing facility role editor.

These are confirmed repository causes. **No production facility row, real user grant or deployed feature flag was inspected.** An intentionally disabled/hidden module remains disabled/hidden; this change does not silently enable salary access across all facilities.

### Exact navigation / provisioning

- Authorized facility administrator: **Configuration → Modular Features Engine → Facility modules**; enable **Human Resources** and **Payroll**, save, and ensure neither is hidden in navigation. This is the existing facility configuration editor, not a new payroll settings application.
- Sidebar → **Human Resources**: employee registration, employment details and the existing attendance/roster/leave surfaces.
- Sidebar → **Payroll**:
  - **Staff pay**: select staff, inspect current salary, save a reasoned basic-salary change, add effective-dated earnings/deductions, deactivate components. Salary mutation requires `payroll.manage`.
  - **Statutory rules**: inspect recorded versions; only `payroll.statutory.manage` can record/activate/retire them. Record the authority citation and explicit deduction/minimum policy.
  - **Ledger accounts**: map facility-scoped expense and payable accounts; posting also needs an open accounting period.
  - **Payroll runs**: New period → Calculate → View/review → a different authorized approver approves → authorized poster selects **Post to ledger**.
  - Finalized run View: **Generate finalized reports & bulk payslips**, inspect/download review schedules, **View bulk payslips**, **Print all payslips**. Individual **Payslip → Print payslip** remains available.
  - **History & annual reports**: scoped payroll audit events and internal P9/P10 data extracts, with an authority form profile required. Downloaded extracts are JSON review data, not official filing layouts.
- Existing facilities missing grants: use the existing additive permission seed (`npm run db:seed:permissions:dry`, review, then the approved non-dry command) and facility RBAC tools under normal change control. The seed requires the installation's existing bootstrap/admin prerequisites; this is not an instruction to bootstrap another administrator in production.
- Approval, posting and statutory-management grants are **not** added automatically to FACILITY_ADMIN. Delegate them explicitly to suitable staff. A global platform account is not a substitute for facility payroll authorization.

## 2. Existing implementation inventory and changes

### Frontend and registration

| File | Role / change |
|---|---|
| `src/App.tsx` | Existing `hr` and `payroll` module switch cases, already keyed by user/facility to avoid retained cross-facility state; preserved. |
| `src/components/Header.tsx` | Existing workforce labels; preserved. |
| `src/components/Sidebar.tsx` | Existing Workforce navigation; repaired facility-admin allowlist and excluded global platform accounts from salary navigation. |
| `src/config/facility-modules.ts` | Added existing `hr`/`payroll` to provisioning catalogue, not a second payroll implementation. |
| `src/middleware/facility-module.middleware.ts` | Recognizes the module IDs; API requests also enforce provisioning. |
| `src/components/modules/WorkforceModule.tsx` | Existing HR UI; gated salary form/read displays by payroll authority. |
| `src/components/modules/PayrollModule.tsx` | Existing period/rule/account/review/payslip UI; integrated Staff pay and History tabs, finalized outputs and isolated print; explicit current-rule/legacy-policy warnings and safe failed-load state. |
| `src/components/modules/payroll/PayrollTools.tsx` | Supporting components inside the existing payroll UI: pay components/salary, reports/bulk print, history/form extracts; exact money parsing and isolated document cloning for print. |
| `src/api/clients/workforce.client.ts` | Existing client/type contracts extended for explicit statutory calculation policy. |

`src/app.ts` already mounts the existing workforce router. `src/routes/workforce.routes.ts` remains the single HR/payroll HTTP surface, with authentication, facility scope, per-action permissions, module gates and `Cache-Control: no-store`. Payroll staff reads no longer depend on an unrelated `hr.read` grant.

### Tables and migrations

Source: `src/db/schema/workforce.ts`, exported by the existing schema barrel. Existing tables:

- `hr_departments`, `hr_designations`, `hr_employees`, `hr_employee_documents`.
- `hr_shifts`, `hr_roster_entries`, `hr_attendance`, `hr_leave_types`, `hr_leave_requests`.
- `payroll_statutory_versions`, `payroll_statutory_bands`, `payroll_employee_components`.
- `payroll_account_settings`, `payroll_periods`, `payroll_runs`, `payroll_payslips`, `payroll_payslip_lines`, `payroll_form_profiles`.

Related existing records: facilities/tenants, roles/permissions, audit_logs, chart_of_accounts, financial_periods, journal_entries and journal_lines. Payroll is not a patient-billing payment source and this work does not manufacture a salary payment record.

Existing migrations: `0074_workforce.sql`, `0083_payroll_form_profiles.sql`. New additive migration: **`0093_payroll_completion_controls.sql`**, registered in `drizzle/meta/_journal.json`:

- Nullable `payroll_statutory_versions.calculation_config` preserves historical null policy instead of rewriting old results.
- `payroll_employee_components.statutory_exclusions`, default empty array.
- Approved/posted run, payslip and payslip-line immutability; period/run scope matching and fixed parent relationships.
- Approved payroll period history cannot be changed/deleted.
- Deferred finalization guard requires the payroll's own posted, tenant/facility-scoped, source-linked balanced journal and posting actor/time.
- Statutory calculation/source history and bands cannot be overwritten; replacement versions are required.

Columns use guarded additive DDL. Trigger creation follows the repository's once-only migration journal convention (as existing 0091/0092 do), not ad hoc repeat execution. The final migration was applied as part of **all 94 migrations on a new empty synthetic database**, not merely typechecked. There is no historical salary/identity backfill or rewriting of approved money.

### HTTP inventory

All payroll paths below begin `/api/payroll`; facility scope is required and resolved against the authenticated account, not trusted because supplied in a query/body.

| Methods / paths | Authorization / purpose |
|---|---|
| GET `employees`, `employees/:id` | `payroll.read`; staff salary/component read independent of HR navigation. |
| PUT `employees/:id/salary` | `payroll.manage`; exact cents, reason, audit; no implicit recalculation. |
| POST `components`; DELETE `components/:id` | `payroll.manage`; add dated component / deactivate, not delete history. |
| GET `statutory-versions`; POST `statutory-versions`; POST `statutory-versions/:id/status` | Read vs separate `payroll.statutory.manage` configuration authority. |
| GET `accounts`, `account-settings`; PUT `account-settings` | Scoped eligible accounts; existing manage/approve mapping authority. |
| GET/POST `periods`; POST `periods/:id/calculate` | Read vs `payroll.manage`; overlap/coverage/locked-run refusal. |
| GET `runs/:id`; POST `runs/:id/approve`; POST `runs/:id/post` | `payroll.read`, `payroll.approve`, `payroll.post` respectively; calculator cannot self-approve. |
| GET `payslips/:id` | `payroll.read`, immutable amounts and captured identity for new calculations. |
| GET `runs/:id/reports` | `payroll.read`; finalized-only bulk payslips, masked bank review and statutory review schedules. |
| GET `history` | `payroll.read`; latest 300 facility payroll audit events, not global logs. |
| GET/POST `form-profiles`; GET `statutory-extract` | Read vs statutory-management; annual internal extract requires an unambiguous whole-year authority profile. |

Existing `/api/hr` endpoints handle overview, departments/designations, employee registration/details/update/status/documents, shifts, attendance, rosters, leave types/requests/decisions/balances. HR responses redact salary, tax/benefit IDs, bank information, component/payslip payloads without `payroll.read`. Merely holding `hr.manage` does not authorize salary writes.

Facility provisioning is the existing **PATCH `/api/facilities/:id/modules`**, not PUT. No new backend registration/router is needed.

## 3. Calculation, accounting and privacy controls

`src/workforce/payroll-calculator.ts` remains a pure integer-cent, effective-version engine. `src/workforce/workforce.service.ts` coordinates scoped persistence and audits.

- Basic salary plus dated fixed-amount earning components; deduction components; gross/taxable/net and employee/employer contributions retained in run/payslip/line snapshots.
- New explicit policies reject unsupported PAYE/SHIF employer charges and PAYE contribution minima instead of silently accepting values that have no ledger representation. Legacy null-policy versions remain visibly warned.
- Explicit effective-version PAYE pre-tax deduction policy can include employee NSSF, SHIF and AHL. The employer share is not deducted from employee taxable pay.
- Contribution minima use `max(rate-based contribution, minimum)`, not a fixed additive fee. Rates/caps/fixed amounts/relief/source dates remain configurable; no Kenyan rate seed was installed.
- Explicit component exclusions support the reviewed irregular-earning AHL case without blanket bonus exemption from PAYE. Exclusion/date/input validation is server-side, not only a checkbox.
- Null historical calculation policy keeps the previous NSSF/SHIF deduction behavior and does not silently retrofit AHL. UI warns operators not to treat legacy versions as current compliant policy.
- New payslip snapshots retain employee number/name, KRA/NSSF/SHIF IDs, masked bank information and employer/department/designation labels. Detail/review/report output uses snapshots, not a subsequent employee rename. Old missing snapshots are labelled; no invented historical identity is backfilled.
- Salary changes are current salary changes with an audit reason. Existing runs are not silently recalculated or changed. Recalculation of an unapproved run is explicit.
- Finalization takes the existing reconciliation advisory lock and a scoped run row lock. All payroll-finalization reads use the same PostgreSQL client, avoiding a second pool checkout inside the transaction.
- `postInsideTransaction` creates/verifies the journal; run status/journal link and payroll audit insert use that **same transaction**. An injected audit failure rolls back all three; concurrent posts yield one success and one conflict. The journal source/idempotency key derives from the run.
- There is no automatic PAID transition. POSTED means **liability journal posted**. Bank review rows use masked accounts, `instructionReady:false`, `paymentStatus:NOT_EVIDENCED`; statutory schedules use `filingStatus:NOT_FILED`. Downloads say they are not filing, remittance or bank instructions.
- Print clones only the selected document into an isolated iframe, removes action buttons and does not print the application sidebar/employee register. Browser assertions checked both individual and bulk print contents.
- Annual internal extracts now select finalized payroll by **payroll pay date**, not the date the bookkeeper finalized the journal. They include dated per-payslip rows and separate annual totals, retain snapshot identities, and audit generation. These are not official P9/P10 representations or proof of actual payment.

## 4. Kenyan statutory-source review

Authority publications were consulted before the policy/formula extension. No production rates were guessed or seeded. The synthetic browser/integration policies have explicit **SYNTHETIC TEST ONLY** authority references and are not deployable rate configuration.

| Subject | Source / verified scope |
|---|---|
| PAYE bands/relief and current allowable deductions | KRA's PAYE page: monthly bands 24,000 at 10%; next 8,333 at 25%; next 467,667 at 30%; next 300,000 at 32.5%; balance above 800,000 at 35%; resident personal relief 2,400/month. Its allowable deductions include employee AHL/SHIF and qualifying pension/mortgage/post-retirement medical amounts subject to their limits. [KRA PAYE](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye). These are source-review notes, not a shipped configuration or confirmation that all listed employee circumstances are modelled. |
| AHL/SHIF deduction before PAYE | KRA's notice says changes apply to December 2024 and subsequent periods, with Tax Laws (Amendment) Act 2024 commencing 27 December 2024; AHL and SHIF are allowable deductions and Affordable Housing Relief ceases. [1](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024). |
| SHIF minimum | Consolidated Social Health Insurance Regulations, Legal Notice 49/2024, version 28 February 2025, regulation 17: 2.75% of gross salary/wage, minimum KES 300 per month. This is a floor, not an additional fixed amount. [Kenya Law consolidated regulation](https://new.kenyalaw.org/akn/ke/act/ln/2024/49/eng@2025-02-28). |
| AHL rate and irregular earnings base | KRA PAYE publication describes employee/employer 1.5% each. [2](https://www.kra.go.ke/images/publications/PAYE-AS-YOU-EARN-PAYE_4-01-2025.pdf). KRA's AHL clarification defines regular cash salary/allowances and excludes irregular bonus/leave allowance/gratuity etc. [1](https://www.kra.go.ke/news-center/public-notices/1979-affordable-housing-levy-ahl). The clarification references the original 2023 framework: payroll owners must confirm continued applicability to their 2024 Act/current situation before configuring exclusions. No automatic classification by component name is performed. |
| NSSF Year 4 (2026) | Official employer notice located: [1](https://www.nssf.or.ke/notice-to-employers-year-4-2026-nssf-contribution-rates), posted 18 February 2026. **Its rate table is image-only and was not successfully inspected in this environment.** Secondary figures are not promoted to verified authority or seeded. Operator verification/transcription of the original notice (including pensionable base, tiers and effective date) remains a rollout blocker. The generic capped employee/employer contribution engine can represent the total, but separate Tier I/Tier II remittance layout is not implemented. |

This review is not legal/tax advice or certification that no later administrative/court change affects a particular payroll. Preserve citations and have the responsible payroll/tax owner confirm effective dates, earning-base classification, residence/relief eligibility and rounding before activation.

## 5. Executed verification

Only synthetic, explicitly authorized loopback PostgreSQL was used. No patient data, real employee records, live bank/provider calls, production credentials or external payment/filing operation was used. Fixture passwords are environment-provided, not saved in the repository/report/screenshots.

| Check | Result |
|---|---|
| New empty synthetic DB: complete migration chain including final 0093 | **94 applied, PASS**. `/tmp/payroll-migrate-final.log`. |
| Final payroll authenticated HTTP/database suite | **19 PASS**, including salary/PII redaction, separate permissions, same-/cross-tenant facility denial, finalized-only reports, snapshots, DB immutability including period, atomic rollback, duplicate/concurrent posting, annual pay-date selection and module provisioning. `/tmp/payroll-db-final2.log` (latest final-policy rerun); combined payroll+bank run `/tmp/payroll-db-verified.log`. |
| Adjacent manual-bank financial safeguards DB regression | **13 PASS** on the same fresh synthetic cluster; no provider network. `/tmp/payroll-bank-final.log`. |
| UI/policy/calculator/RBAC/schema/migration targeted run | Earlier run **166 PASS** across 8 suites; full fresh offline results below supersede counts for the final test revisions. `/tmp/payroll-ui-check.log`. |
| Real Chromium + actual HTTP journey | **18 assertions PASS**. HR form registration, Staff pay component creation, calculation, preparer approval denial, separate-user approval, posting, schedules/bulk, individual/bulk isolated print, annual download and one balanced source journal. `docs/audits/payroll-evidence/browser-results.json`; eight synthetic screenshots. Final source journey rerun used the freshly migrated release synthetic database, `/tmp/payroll-browser-release.log`. Known dev HMR-only `WebSocket closed without opened.` noise is excluded from application rendering errors by the harness; no other uncaught rendering error was recorded. |
| TypeScript | **PASS**, final `tsc --noEmit` recheck is recorded in `/tmp/payroll-ts-release-final.log`. An intermediate concurrent attempt was killed by sandbox memory pressure and a later check caught missing department/designation select fields; both were resolved rather than counted as success. |
| ESLint | **0 errors, 105 warnings**, full repository. `/tmp/payroll-lint-release-final.log`; warnings are not represented as a warning-free build. |
| Changed-file Prettier | PASS, including full repository `npm run format:check`. `/tmp/payroll-format-final.log`, `/tmp/payroll-format-repo.log`; no mass reformat was used to change unrelated WIP. |
| Production frontend build | PASS, 1,826 modules; existing large-bundle warning (>500 kB), ~2 MB JS before gzip. `/tmp/payroll-build-release-final.log`. |
| Production server build | PASS. `/tmp/payroll-server-release-final.log`. |
| Fresh full offline suite | **205 suites PASS, 88 skipped; 1,922 tests PASS, 824 skipped; 0 failed** (297.41 s). `/tmp/payroll-offline-final.log`. Database-only suites were intentionally skipped in this offline run; the payroll and bank DB suites were executed separately above. |

Reproduction harness: `scripts/payroll-completion-browser-synthetic.mjs`. It verifies the synthetic DB identity and fixture tenant, requires explicit synthetic authorization, checks the application is loopback, uses real login forms and throws on failed assertions. It can use `CHROME_EXECUTABLE_PATH` for a locally installed Chromium. Re-runs append a new synthetic pay year rather than altering finalized history. It is **not** an operational payroll seeder.

## 6. Remaining limitations / not implemented

Do not market this as a complete statutory filing/payment or all-employment-scenarios product:

1. **No actual salary disbursement workflow or payment evidence link.** Bank schedules are masked internal review, not bank upload files or payment instructions. No batch authorization/provider transfer/reconciliation proves salaries paid. No statutory filing/remittance integration or accepted-return acknowledgement.
2. **No automatic overtime hours/rate/multiplier or leave/attendance/proration engine.** A payroll preparer may enter an independently reviewed dated monetary earning (allowance/overtime/bonus), but the software does not calculate entitlement from hours, unpaid leave, mid-month joining/leaving or overtime law. Existing attendance does not silently change salary.
3. **Salary effective-date history is not a salary-scale/version engine.** Current salary edits are audited and calculated payslips snapshot the result; retroactive/pre-hire/full-period salary derivation needs a separate supported policy, not an assumption.
4. **Not all individual PAYE cases are modelled.** Mortgage interest, voluntary/registered pension deductions with aggregate ceilings, post-retirement medical limits, insurance/disability/non-resident relief differences, benefits in kind, termination/gratuity and other special treatments are not complete first-class per-employee tax-policy features. Configurable generic components must not be represented as automatically handling those laws. Do not activate a payroll for an unsupported employee scenario without an approved supported extension.
5. **NSSF official image transcription and tier-specific schedule approval remain outstanding**; no claim of independently verified 2026 limits was made. Current rate/policy setup and the facility's authority form profiles need payroll-owner verification. The engine refuses missing/ambiguous active versions but cannot decide whether an administrator typed a legally correct rate/citation.
6. P9/P10 downloads are **annual internal JSON extracts**, with monthly detail, not official KRA layouts or filing-ready P10 monthly submission files. Pay date is the configured payroll date, not independently evidenced bank value date. Profiles must unambiguously cover the whole year; mixed form layouts within a year need a deliberate design rather than silent selection of any overlapping profile.
7. **Legacy identity snapshots cannot be reconstructed reliably.** Such details are flagged as unavailable; financial amounts are retained, not recalculated. Old masked bank details are not full bank-account verification evidence.
8. History UI shows latest 300 payroll events; there is no new paginated compliance archive, year-end closing/reversal/correction payroll engine, payslip email delivery or employee self-service portal added here.
9. Only synthetic deployments were tested. Actual facility module settings, overrides, account mappings, open periods, payroll staff assignments, backups/migration review and operational rate/form sign-off remain the deploying owner's responsibility.

## 7. Rollout / review checklist

1. Review this branch against the pre-existing dirty worktree; do not replace the project or rerun old patches. No commit/push was requested or performed.
2. Back up and review migration 0093, then apply through the repository's normal migration runner under approved deployment change control. Do not manually recreate payroll tables.
3. Review additive permission-seed dry-run; grant preparation/read without automatically granting approval/posting/statutory management. Assign an independent approver. Keep payment release under its separate authorized process.
4. Explicitly enable HR/Payroll and unhide them for the intended facility through Configuration. Sign out/in or refresh session/module data after approved role/provisioning changes.
5. Verify official current statutory publications (including NSSF image), classify each earning base and confirm employee eligibility/supported cases. Record source-cited effective-dated replacement versions. Do not use synthetic fixtures or legacy-null policy as production rates.
6. Map scoped active accounts and open the proper accounting period; reconcile reviewed draft totals before independent approval and ledger finalization.
7. Independently verify bank details and payment authorization; file/remit through the approved real channels and retain their evidence externally until a dedicated supported evidence workflow exists. A printed payslip or posted liability is not proof of payment.

## 8. Preservation / change boundary

Initial inspection found **661 dirty Git-status entries**; they were treated as intentional WIP. A 1,256-file baseline hash comparison found **no deleted baseline files** and only the payroll-related existing files listed above changed during this task (17 existing files at the preservation check, plus new payroll UI/test/migration/harness/evidence/report files). No reset/clean/switch, root/.git move, unrelated refactor, credential commit or production migration was performed. Protected claim/attestation code and `schema-contract-before-extraction.json` were not edited.
