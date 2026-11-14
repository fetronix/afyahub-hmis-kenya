# Final System Acceptance

**Date:** 2026-10-27
**Repository:** `fetronix/afyahub-hmis-kenya`, branch `arena/e088f11d-afyahub-hmis-kenya`
**Baseline:** published `197a553`; local `HEAD` `0111b55` (stale shallow checkout)

> **This document does not declare the system ready for production.** It records
> exactly what has been implemented and verified, and precisely what has not. The
> distinction between those is the only useful content it has.

---

## 1. What was verified in this session

| Gate             | Command                                   | Result                                          |
| ---------------- | ----------------------------------------- | ----------------------------------------------- |
| TypeScript       | `tsc --noEmit`                            | **0 errors**                                    |
| Lint             | `eslint` (new and changed files)          | **0 errors, 0 warnings**                        |
| Formatting       | `prettier --check` on changed files       | clean                                           |
| Production build | `vite build`                              | succeeded, 1823 modules                         |
| Full test suite  | `vitest run`                              | **278 files / 2610 tests, 0 failed, 0 skipped** |
| Restore drill    | `node scripts/backup/restore-drill.mjs`   | **PASSED** — 230 tables, contents identical     |
| Migration state  | 88 migrations applied                     | journal 0000–0087 intact                        |
| Batch 3 tests    | `bank-reconciliation.db.spec.ts`          | **12 passed (12)**                              |
| Batch 4 tests    | fixed-asset impairment + UI               | **14 passed (14)**                              |
| Batch 6 tests    | dialysis billing + UI                     | **10 passed (10)**                              |
| Batch 7 tests    | billing subledger ⇄ GL tie-out + UI       | **10 passed (10)**                              |
| Batch 8 tests    | surveillance corrections + UI + catalogue | **15 passed (15)**                              |
| Batch 9 tests    | dispatch reconciliation DB + UI           | **21 passed (21)**                              |
| Batch 9 baseline | integration boundary suites, pre-change   | **110 passed (110)**                            |

The full suite is green **with** the synthetic-cluster attestation supplied
(`JALICARE_TEST_PG_SYSTEM_IDENTIFIER`). It was not "made green" by skipping or
weakening: the two initial failures were a genuine missing client-coverage entry
(fixed) and an unset safety guard (satisfied, not bypassed).

---

## 2. Acceptance status by evidence level

Each level is separate. Nothing below is claimed at a level it has not reached.

| Level                                | Status                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Implemented**                      | Batches 1–12 complete for scope. Batch 3 has no UI; Batch 11 has no alerting or metrics; Batch 12 has no deployed host. |
| **Tested locally**                   | Yes, for Batches 1–12 and the pre-existing suite (2663 tests).                                                          |
| **Verified with synthetic data**     | Yes, for approval-policy enforcement, tenant/facility isolation over HTTP, `/api/ops/status`, and database restore.     |
| **Verified in provider sandbox**     | No. No provider credentials were used.                                                                                  |
| **Accepted by an external provider** | No. Never claimed.                                                                                                      |
| **Accepted by a real facility**      | No. **UAT has not been performed.**                                                                                     |
| **Production deployed**              | No. No deployed environment was observed or touched.                                                                    |

---

## 3. Batch completion

| Batch                          | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Approval policy management | **Complete** for scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2 — Backup, restore, DR        | **Complete** for scope; `pgdump` path needs a drill on the real host                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3 — Bank reconciliation        | **Complete for scope on the backend.** Matching suggestions, investigation, unmatch, adjustments, second-person approval, period lock, reporting and audit are implemented and covered by 12 tests. Two gaps are stated, not papered over: no partial/many-to-one matching, and no reconciliation UI.                                                                                                                                                                                       |
| 4 — Fixed assets               | **Complete for scope.** Acquisition, depreciation, disposal, maintenance, **impairment, revaluation** and **configuration-driven tax allowance** implemented, journal-backed and covered by 14 tests. No Kenyan tax rate is encoded.                                                                                                                                                                                                                                                        |
| 5 — HR · payroll · procurement | **Complete for scope.** Existing HR/payroll/procurement verified by 199 tests; P9/P10 added as citation-gated extracts from posted payroll.                                                                                                                                                                                                                                                                                                                                                 |
| 6 — Clinical workflows         | **Verified by the full suite.** One real gap found and closed: dialysis sessions were never billable.                                                                                                                                                                                                                                                                                                                                                                                       |
| 7 — Billing and accounting     | **Verified by the full suite.** One real gap found and closed: nothing tied the billing subledger to the general ledger, and two endpoints said so in their own responses. A read-only tie-out now reports every difference, with explained posting backlog separated from unexplained leakage.                                                                                                                                                                                             |
| 8 — Reporting, MOH, KHIS/DHIS2 | **Verified for what exists.** One real gap found and closed: a wrong surveillance count could only be "fixed" by adding a second row, which doubled the week. MOH 705 remains 501 by design and no KHIS/DHIS2 submission exists — both stated in the software, not just here.                                                                                                                                                                                                               |
| 9 — External integrations      | **Verified at adapter and boundary level; no provider contact.** The integrations were executed (110 tests) and read. One real defect found and closed: a claim whose dispatch outcome was unknown could never be resolved, so one lost HTTP response blocked it permanently. Reconciliation is now an audited, scoped, evidence-required path that never calls a payer and never retries automatically. No provider credential exists here, so no sandbox or live transmission is claimed. |
| 10 — Tenancy and permissions   | **Verified over real HTTP.** A user holding every permission in the seed cannot read or write another tenant's or facility's patients, encounters, claims, payments, HR records or audit log; refusals are checked against the database afterwards, not just the status code. One real hole found and closed: `radiology.read` was demanded by routes and seeded nowhere, so no role could hold it. Isolation is proven for the swept resources, not the whole schema.                      |
| 11 — Monitoring and operations | **Complete for what it claims.** `/api/ops/status` reports dispatch holds, unbilled charges, refunds awaiting a second approver, 24-hour integration outcomes and journal-versus-applied schema — counts and ages only, no patient identity, no invented thresholds. The runbook states plainly that nothing alerts, nothing ships logs and there is no metrics endpoint.                                                                                                                   |
| 12 — Deployment readiness      | **Documentation audited against the code; three real defects fixed.** `DEFAULT_TIMEZONE` was documented and read by nothing; the production install carried React and Vite; and ten tests depended on the developer's build state. Production install is now 166 packages instead of 517, proven by booting the server from one. **No image was built, no container ran and no host was touched**, so deployment remains unverified.                                                        |

**No batch was marked complete on the strength of files existing.** Batches 3–12
carry partial implementations from earlier phases and require their own
inspection, defect fixing and tests before they can be called done.

---

## 4. Critical items not resolved

1. **Backups are not proven on the production host.** The sandbox has no
   `pg_dump`. The drill must run against the real deployment before anyone trusts
   a backup during an incident. This is the single highest-risk gap: the code is
   tested, the operational proof is not.
2. **Backups are not copied off the database host automatically.** Getting them
   off the machine is currently an operator responsibility.
3. **No point-in-time recovery.** The best recovery point is the last archive.
4. **Statutory payroll correctness is unverified** and depends on authoritative
   NSSF/SHIF/PAYE rates and forms that were not available. No rates were invented.
5. **MOH 705 / KHIS formats are unvalidated** against authoritative
   specifications.
6. **Every external integration is sandbox-or-unverified.** M-Pesa, banks, SHA,
   DHA: no provider has confirmed any of it. The M-Pesa callback endpoint cannot
   accept a delivery until signature verification is specified, and says so with
   a 503 rather than pretending.
7. **No facility acceptance testing** has occurred.
8. **Nothing alerts.** `/api/ops/status` and `/api/ready` exist for a human or a
   proxy to poll; no pager, no log shipping and no metrics endpoint exist in this
   repository. An outage is discovered by a person noticing.
9. **The deployment path is verified as documentation, not as a deployment.** A
   build was produced and checked (`npm run deploy:verify`, 88 migrations match
   the journal), and the production bundle was started locally against a
   synthetic database. No container was built, no host was provisioned.

---

## 5. Honest readiness statement

- The application **builds, typechecks and passes its entire test suite** in this
  environment.
- Approval-policy administration is **working, enforced, audited and covered by
  tests**, including cross-tenant and cross-facility refusal.
- Database backup and restore **work and are proven by an actual restore** with
  content-level comparison.
- Tenant and facility isolation is **proven over real HTTP** with
  permission-complete users, for the resources the sweep covers.
- An operator can see **work that is stuck** — claims held by an unknown payer
  outcome, charges that never billed, refunds waiting for a second approver —
  without the endpoint exposing a single patient identity.
- The application **runs from a production-only install** (166 packages) with
  the database reachable; that was started and checked, not assumed.
- The system is **not ready for production**. It lacks facility acceptance,
  provider verification, statutory validation, and an operational restore drill on
  the real host. Nothing alerts when it breaks: someone has to look.
- Nothing here should be read as regulatory or legal compliance.

---

## 6. Next actions, in order

1. Run `npm run db:restore:drill` on the real deployment host; record the output.
2. Copy archives off-host; schedule `db:backup` and `db:backup:verify` in cron.
3. ~~Batches 10–12 in order, each with its own focused tests.~~ Done. What
   remains from those batches is on the host: create the account, set the
   environment from `docs/deployment/truehost-cpanel.md` §5, run
   `npm run deploy:verify` on the uploaded folder, then `db:preflight`,
   `db:status` and the restore drill against the real database.
4. Decide how an operator is told something is wrong. `/api/ops/status` answers
   when asked; nothing asks it on a schedule.
5. Close the Batch 7 limits that the tie-out reports but does not resolve:
   line-level `BILLING_ITEM` postings, opening balances, and bank/insurer
   settlement are outside the tie-out and are listed as such.
6. Obtain the authoritative MOH 705 / KHIS specifications before Batch 8's
   external half can be attempted; nothing has been invented in their absence.
7. Full workflow journeys A–H with synthetic data.
8. Facility UAT.
