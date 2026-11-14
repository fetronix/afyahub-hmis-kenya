# JaliCare — Payroll configuration and readiness

Report date: **2026-10-27**. Scope: extend the existing workforce/payroll implementation, not replace it.

## Decision

**Configuration tooling and synthetic acceptance are implemented. Actual facility payroll readiness is NOT established.** No deployed facility database connection was supplied or discovered; no deployed chart, mappings, policy values, staff data or accounting periods were inspected. Nothing in this report authorizes live payroll, certifies Kenyan statutory compliance, evidences payment or files a return.

The only database used was an isolated, disposable, loopback PostgreSQL database with synthetic identities and arbitrary test policies. No production accounts or rules were created, mapped, migrated, verified or activated. The application always reports `productionReady: false`; complete synthetic policies produce `TEST_CONFIGURATION_ONLY`.

Some sandbox-generated evidence/logs carry a different system-clock date. The report date above follows the session date, not those timestamps. Evidence demonstrates executed synthetic checks, not a subsequent legal-rate review.

## 1. Existing functionality retained

- Existing HR employees, dated pay components, payroll periods, integer-cent calculations, payslips, internal statutory schedules and annual review extracts.
- Existing preparation/independent approval/posting separation, tenant/facility authorization, audit history and immutable finalized snapshots.
- Existing atomic, balanced, source-linked accounting journals and duplicate-posting prevention.
- Existing bank-payment safeguards. A posted payroll liability journal does not mean salaries have been paid. Internal schedules are not bank-upload instructions or statutory filing/remittance evidence.
- Facility-specific chart codes and structures remain administrator-controlled. Payroll does not create arbitrary operational accounts or choose mappings.

## 2. Chart and mapping readiness

The dashboard queries the selected facility's existing chart and shows total/active counts. It evaluates each selected account's availability, active state and required type. No chart count alone proves a facility chart is approved or complete.

| Purpose / settings field                             | Required type | Requirement                               |
| ---------------------------------------------------- | ------------- | ----------------------------------------- |
| Gross salary / `salaryExpenseAccountId`              | EXPENSE       | Required                                  |
| Employer statutory cost / `employerCostAccountId`    | EXPENSE       | Required                                  |
| Net salary / `netPayPayableAccountId`                | LIABILITY     | Required                                  |
| PAYE / `payePayableAccountId`                        | LIABILITY     | Required                                  |
| NSSF employee + employer / `nssfPayableAccountId`    | LIABILITY     | Required                                  |
| SHIF / `shifPayableAccountId`                        | LIABILITY     | Required                                  |
| AHL employee + employer / `ahlPayableAccountId`      | LIABILITY     | Required                                  |
| Other deductions / `otherDeductionsPayableAccountId` | LIABILITY     | Required when applicable deductions exist |

A facility may deliberately reuse an approved liability account; there are no prescribed codes. Statuses distinguish `MISSING`, `OPTIONAL`, `UNAVAILABLE`, `INACTIVE`, `WRONG_TYPE` and `READY`, with next actions. Existing inactive/unavailable selections remain visible rather than silently disappearing. Invalid mapping saves are disabled in the interface and checked on the server. Calculation and posting reject invalid required mappings. Posting rechecks after calculation so a later mapping problem cannot produce a partial journal.

**Actual missing facility mappings: unknown until an authorized connection/readiness query is run.** Synthetic mappings and counts are not substituted for facility results.

## 3. Statutory policy readiness

PAYE, NSSF, SHIF and AHL retain separate effective-dated versions, authority, source reference and calculation bands/configuration. This change adds:

- `verified_on`, `verified_by`, `verified_at`, `verification_reference`, `verification_purpose`.
- A deliberate source-review action on a draft: valid non-future calendar date, evidence/review reference, purpose (`AUTHORITY_SOURCE` or `SYNTHETIC_TEST`) and explicit confirmation that source, values and dates were reviewed.
- User/time audit attribution. This is an accountable user attestation, **not automatic verification of a URL or certification by the software**.
- One-time verification and immutable calculation/source/band history. Corrections require a replacement version; do not edit historical rules or backfill a verification claim.
- Activation requires verification, explicit calculation policy and bands. Application validation rejects incomplete/unsupported policies and activation overlaps. Database guards retain immutable history and basic activation/verification integrity. Direct SQL is not an administrator setup interface.
- Full-period selection: exactly one verified eligible version per statute must cover both the entire payroll period and its pay date, inclusively. Missing rules, ambiguity, gaps and an in-period change block calculation rather than guessing a split. Finite retired verified historical versions remain eligible after their end date; today's rules are not substituted.
- Verification/source metadata is copied into new payslip breakdowns alongside the selected statutory version IDs.

Explicit policy includes deduction toggles, employee/employer minima and bands with integer-cent bounds/fixed amounts/caps/relief and basis-point rates. PAYE bands must be contiguous from zero through an open final band. Contribution policies use one zero/open band with explicit caps/minima rather than unsupported multiple contribution tiers. Unsupported employer PAYE/SHIF values are rejected.

**No new Kenyan statutory rates were seeded or certified.** Current authority publications, legal commencement dates, source images/notices, special cases and payroll professional approval still require facility review. Earlier research is not a replacement for validating actual configured values. In particular, no uninspected NSSF 2026 source image has been treated as verified evidence.

Legacy active/unverified or null-policy rules are not silently grandfathered into new calculations. An administrator must review the applicable dates and create/verify an appropriate replacement. Retire conflicting versions through the existing controlled status action; a verified finite historical version continues to protect its covered period against overlap. Existing historical records are not deleted.

## 4. Readiness dashboard and gates

The Payroll dashboard now shows:

1. Facility chart counts/status.
2. Every required/conditional account mapping and issue.
3. PAYE, NSSF, SHIF and AHL policy status, selected version/source/verification information and blockers.
4. Accounting-period status for the pay date.
5. Overall configuration status and exact next administrator actions.

Select a payroll period to assess its actual start/end/pay date. The default today-only preview is explicitly not a payroll-period sign-off. Loading/error handling does not invent readiness; stale responses from a prior facility/period are ignored.

- `configurationReady`: chart, mapping and rule checks passed.
- `canCalculate`: configuration checks passed; employee/run validations still apply at calculation.
- `canFinalize`: configuration checks plus exactly one open accounting period covering pay date; independent approval and other run checks still apply.
- `productionReady`: always false. Operational/legal sign-off is outside these checks.

A synthetic policy can exercise the calculation/posting workflow for tests but remains visibly test-only. The label is not a production-environment prohibition; operational administrators must never configure synthetic policies for actual salaries.

## 5. Database and API requirements

### Database/deployment

Use the existing PostgreSQL deployment and the repository's migration runner. Required environment keys: `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`; configure `SQL_SSL` and certificate validation appropriately for the deployment. Do not commit credentials or copy disposable test credentials into a facility environment.

After approved backup and staging validation, use the normal `npm run db:migrate` process. New migration: **`drizzle/0094_payroll_configuration_readiness.sql`**, journal index 94. A fresh synthetic database successfully applied all **95** migrations (0000–0094).

0094 adds nullable verification columns/FK/completeness constraint, replaces the insufficient facility/statute/start-date uniqueness index with a nonunique lookup index (allowing reviewed replacement drafts), replaces the existing statutory history guard function and adds verification/activation guard enforcement. The version and band history triggers installed by 0093 remain attached to the replaced function; SQL integration assertions verify their existence and enforcement. No rates, accounts, mappings or verification attestations are seeded/backfilled. Existing unverified policy metadata stays unverified.

The migration account needs the usual DDL rights for columns, foreign keys, constraints, indexes, functions and triggers. The runtime needs existing scoped table read/write and audit permissions. Never grant browser users direct SQL access. Existing tables used include users, chart_of_accounts, payroll_account_settings, payroll_statutory_versions/bands, payroll_periods/runs/payslips/lines/components, financial_periods, accounting journal tables and audit_logs.

### API

All routes use existing authenticated authorization and server-resolved tenant/facility scope. A supplied `facilityId` is not authority to access that facility.

| Endpoint                                             | Purpose / permission                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/payroll/readiness?facilityId=…&periodId=…` | New scoped readiness; `payroll.read`. Omit periodId for today preview.                  |
| `GET /api/payroll/accounts?facilityId=…`             | Existing chart listing extended to retain active/inactive/type details.                 |
| `GET /api/payroll/account-settings?facilityId=…`     | Existing facility settings.                                                             |
| `PUT /api/payroll/account-settings`                  | Existing controlled mapping save; facilityId plus account ID fields above.              |
| `GET /api/payroll/statutory-versions?facilityId=…`   | Existing policy listing, now includes verification metadata.                            |
| `POST /api/payroll/statutory-versions`               | Existing draft creation with source, dates, policy, bands; `payroll.statutory.manage`.  |
| `POST /api/payroll/statutory-versions/:id/verify`    | New deliberate attestation; `payroll.statutory.manage`.                                 |
| `POST /api/payroll/statutory-versions/:id/status`    | Existing controlled activation/retirement, now rejects unverified activation.           |
| Existing calculate / approve / post routes           | Same workflow and separation; readiness is enforced server-side at calculation/posting. |

Verification JSON fields: `facilityId`, `verifiedOn` (YYYY-MM-DD), `verificationReference` (8–1000 characters), `verificationPurpose` (`AUTHORITY_SOURCE` or `SYNTHETIC_TEST`), `confirmSourceReviewed: true`. The actor and recorded timestamp come from the server, not client input. Verification is once-only on an unverified draft; corrections need a replacement.

Readiness returns `facilityId`, `period`, `chartOfAccounts`, `mapping`, `rules`, `accountingPeriod`, `configurationReady`, `canCalculate`, `canFinalize`, `productionReady`, `status`, `nextActions`, `notice`. Invalid period IDs return 400; out-of-scope access is refused. Configuration errors block calculation/posting rather than merely displaying a warning.

## 6. Administrator setup checklist

1. Deploy/stage the migration with approved backups. Confirm the intended database and facility; do not run the synthetic fixture in a real environment.
2. Sign in with authorized Accounting and payroll/statutory roles. Open **Payroll → configuration readiness**, select the intended period and retain the initial blockers.
3. Have Accounting review the existing active facility chart. Obtain explicit approval for any new/reactivated accounts through normal Accounting administration. Do not ask payroll to invent chart codes.
4. Open **Ledger accounts**. Select the two approved EXPENSE purposes and five approved LIABILITY purposes; map other deductions if used. Resolve unavailable/inactive/wrong-type entries and save. Refresh readiness.
5. Obtain current authoritative PAYE/NSSF/SHIF/AHL sources and applicable historical sources. A responsible payroll professional must check each numeric value, gross/taxable basis, minima/caps/relief, deduction policy and effective interval. Record evidence outside any synthetic example.
6. Open **Statutory rules**; create correctly dated replacement drafts as needed. Choose finite dates where known and review future transitions before activation. Never modify historical calculation values to make a current period work.
7. Use **Verify source & values**, inspect the displayed rule values/source/dates, enter actual verification date and evidence, select **authority source** for real policies and explicitly attest review. Use **synthetic test** only in a disposable test facility/database.
8. Activate only reviewed, complete, nonoverlapping rules; retire conflicting inappropriate versions using controlled actions. Resolve date gaps rather than falling back to another year's rules. A period crossing a change needs an explicitly approved supported period/policy arrangement; no guessed proration is supplied.
9. Ensure Accounting has exactly one OPEN financial period covering pay date. Recheck readiness for the actual payroll period, not just today's preview.
10. Review staff, dated earnings/deductions, identifiers, totals and special-case limitations. Run a controlled parallel payroll against independently approved expected results. Independent authorized staff approve; authorized staff post once and reconcile the source-linked journal.
11. Separately authorize/verify salary disbursement and statutory filing/remittance using approved external processes. Retain evidence. Obtain facility payroll/Accounting/legal operational sign-off; this dashboard cannot grant it.

## 7. Validation executed

| Check                                       | Actual result                                            |
| ------------------------------------------- | -------------------------------------------------------- |
| Fresh disposable PostgreSQL migration chain | **95 applied**                                           |
| Targeted Vitest suites                      | **7 files, 86 passed, 0 skipped**                        |
| Payroll real-DB integration                 | 23 passed                                                |
| Controlled bank payments real-DB regression | 13 passed, no provider network                           |
| Payroll UI                                  | 9 passed                                                 |
| Readiness pure checks                       | 11 passed                                                |
| Readiness/verification UI                   | 5 passed                                                 |
| Calculator                                  | 21 passed                                                |
| Statutory policy                            | 4 passed                                                 |
| Real Chromium + HTTP journey                | **27 assertions passed**, no uncaught rendering errors   |
| TypeScript `tsc --noEmit`                   | Passed                                                   |
| `npm run lint`                              | Passed with **106 warnings**, 0 errors; not warning-free |
| `npm run build`                             | Passed; large frontend chunk warning remains             |

Coverage includes missing/wrong-type/inactive/out-of-scope mappings; missing/unverified/incomplete/ambiguous rules; inclusive boundaries, pay-date coverage, historical retired rules and period-crossing gaps; tenant/facility isolation; deliberate verification, malformed/future dates, attestation and band/source immutability; no partial posting on mapping failures; synthetic calculations, reconciliation, approval separation and duplicate prevention. The browser journey explicitly recorded all four synthetic verifications, activated them, selected mappings through the UI, calculated, independently approved and finalized one balanced source-linked journal, and checked the test-only readiness disclaimer. No salary payment or filing occurred.

Reproducible targeted command after supplying an explicitly authorized disposable DB environment:

```sh
JALICARE_REQUIRE_DB=1 npx vitest run \
  src/tests/integration/workforce-payroll.db.spec.ts \
  src/tests/vitest/payroll-readiness.spec.ts \
  src/tests/vitest/payroll-readiness-ui.spec.tsx \
  src/tests/vitest/payroll-ui.spec.tsx \
  src/tests/vitest/payroll-statutory-policy.spec.ts \
  src/tests/workforce-payroll-calculator.spec.ts \
  src/tests/vitest/bank-payments.db.spec.ts
```

Browser runner: `scripts/payroll-completion-browser-synthetic.mjs`, with the existing synthetic fixture, explicit synthetic authorization, loopback target, separate test credentials, and a working Chromium executable/library environment. Set `PAYROLL_EVIDENCE_DIR` to a separate directory so historical evidence is not overwritten. It deliberately creates approved synthetic fixture accounts through the API; this is not operational auto-provisioning.

Evidence: [browser assertions](payroll-readiness-evidence/browser-results.json), [initial blockers](payroll-readiness-evidence/00-readiness-blockers.png), [selected ledger mapping](payroll-readiness-evidence/09-ledger-mapping.png), [test-only readiness](payroll-readiness-evidence/10-test-only-readiness.png), [validation output](payroll-readiness-evidence/validation-output.txt). These contain synthetic data only. The complete repository-wide test suite was not rerun for this change; previous reports are historical evidence, not current test results.

## 8. Changed code and preservation

New: `src/workforce/payroll-readiness.ts`, `src/components/modules/payroll/PayrollReadiness.tsx`, migration 0094, pure readiness/UI test files and this report/evidence.

Extended existing: workforce service/routes/schema, migration journal, workforce API types, PayrollModule, payroll DB/UI tests and synthetic browser acceptance runner. Frontend service typing is type-only and erased from the browser build; no database runtime is imported for this type.

Baseline preservation audit: all **1,272** captured baseline files still exist. Only nine baseline files changed for this task: the browser runner, API client, PayrollModule, workforce schema/routes/service, migration journal and payroll DB/UI tests. Preexisting unrelated dirty/untracked work was preserved; no reset, clean, repository replacement or branch switch was performed. No commit/push was made for this readiness task.

## 9. Remaining production blockers

- **No authorized deployed database inspection**: actual facility chart approval, mapping gaps, policy dates/values and accounting periods are unknown. Run the scoped dashboard against the intended deployment.
- **No facility statutory source attestation/sign-off**: software validates structure and user evidence, not current Kenyan legal truth. Do not activate guessed values or treat test policies as authority.
- **No approved parallel payroll and operational acceptance** with real facility expectations, appropriate staff access review and special-case assessment.
- **No new production migration or configuration deployment** performed here.
- Existing limits remain: automatic overtime/proration and full special PAYE cases are not supplied; internal schedules/annual review do not establish official P9/P10 filing acceptance; no live bank integration activation, salary disbursement or statutory filing/payment evidence was performed.

**Conclusion: the requested configuration controls and administrator readiness workflow are implemented and synthetically validated. Live facility readiness and compliance remain pending the concrete administrator actions above.**
