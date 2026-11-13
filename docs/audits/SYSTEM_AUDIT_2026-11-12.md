# Full system audit — what is done, what remains

**Date:** 12 November 2026 (Africa/Nairobi)
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`, based on `0111b55`
**Auditor:** engineering session on Arena.ai
**Scope:** this repository as it exists in the working tree today — nothing committed since `0111b55`.

> **What this document is.** A measured statement of what works, what is configured but not
> proven, and what is not done. Every number in the evidence tables was produced during this
> audit (12 November 2026) on this machine, using synthetic data and a local PostgreSQL 16
> cluster. Where a claim could not be reproduced it is marked as not verified rather than
> repeated from an older report.
>
> **What this document is not.** It is not a production-readiness, regulatory-compliance,
> clinical-acceptance or provider-certification statement. No real patient, financial or
> facility data was used. No external system was contacted.

---

## 1. Executive summary

The application **builds, type-checks, lints, migrates and runs**, and its automated suite is
**fully green**:

| Check                       | Result                                                                      | Evidence                       |
| --------------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| Full test suite (286 files) | **286 passed / 2667 tests passed, 0 failed**, 398 s                         | local run log (not committed)  |
| TypeScript (`tsc --noEmit`) | **exit 0**, 49 s                                                            | local run                      |
| ESLint                      | **0 errors**, 102 warnings                                                  | local run                      |
| Client build (`vite build`) | **exit 0**, 1.34 s (chunk-size warning only)                                | local run                      |
| Server build (7 bundles)    | **exit 0**                                                                  | local run                      |
| Deploy artefact check       | **"Every artifact is present and consistent"**                              | `scripts/deploy-artifacts.mjs` |
| Migrations                  | **88 applied from empty** on 3 fresh databases                              | `drizzle/0000…0087`            |
| Production boot             | `/api/health` 200, `/api/ready` 200, `/` 200                                | server on :4613                |
| Authenticated API sweep     | 236 GET routes probed: 127×200, 102×403, 6×404 (retired), 1×501 (by design) | this audit                     |
| Production dependency audit | **0 vulnerabilities** (`npm audit --omit=dev`)                              | this audit                     |
| Dev-chain audit             | 4 moderate advisories via `drizzle-kit`/esbuild, not fixed (breaking)       | this audit                     |

**When this audit was measured, none of the work was committed** — 638 dirty entries
(859 untracked files, 149 modified, 1 deleted) on top of `0111b55`, so the verified state lived
only in the working tree. That has since been fixed: the work is committed in six reviewable
slices immediately before this document (build tooling, database, server, UI, tests, docs) and
pushed to the branch. What is still missing is a **hosted CI run on those commits** — every
figure below comes from a local run, not from the pipeline.

Two findings in the first draft of this document were carried over from the 31 October report
and turned out to be stale; they are corrected in §7.1 and §8. The rest was re-verified against
the code in this tree.

Beyond that: the DHA/SHA, M-Pesa, card, bank, SMS and insurer integrations are **not live**
(by design, blocked on external credentials and contracts); the statutory payroll outputs
(P9/P10) are **not certified**; Docker **was not executed** here; and no facility, clinician,
accountant or privacy officer has accepted any workflow.

**Verdict: engineering-complete as a local, synthetic, test-green codebase. Not deployable to
a real facility without the blockers in §7.**

---

## 2. What was verified in this audit

All of the following ran today, in this order, on freshly built artefacts.

### 2.1 Build and static analysis

```
npm ci --no-audit --no-fund          → 517 packages, exit 0
npm run build:server                 → exit 0, build/server.js + 6 script bundles
npm run build                        → exit 0, dist/ (chunk-size warning, not an error)
node scripts/deploy-artifacts.mjs    → "Every artifact is present and consistent"
npx tsc --noEmit                     → exit 0 (49 s)
npx eslint .                         → 0 errors, 102 warnings
```

The 102 lint warnings are not suppressed. Composition:
**91 × `react-hooks/set-state-in-effect`**, 7 × `react-hooks/exhaustive-deps`,
2 × `react-hooks/purity`, 2 × `react-hooks/preserve-manual-memoization`.
These are React 19 lint rules flagging `setState` inside effects in older panels; they are
warnings because each was judged non-blocking, not because the rule was disabled.

### 2.2 Database

- **88 migrations** (`0000` … `0087`) applied cleanly from empty on three separate fresh
  databases: `jalicare_synthetic_test`, `jalicare_firstrun`, `jalicare_docorder`.
- `drizzle/meta/_journal.json` has 88 entries; the newest is
  `0087_claim_dispatch_reconciliation`.
- Migration runner is transactional, prints the plan, requires `--yes` off localhost, and
  never runs at application startup.

### 2.3 Fresh-install path (this is what a new deployment actually does)

Verified end to end on a **new empty database**:

```
npm run db:migrate -- --yes                      → Applied 88 migration(s)
npm run db:bootstrap-admin                       → SUPER_ADMIN created, tenant PLATFORM
npm run db:seed:permissions -- --yes             → permission catalogue loaded (107 grants to SUPER_ADMIN)
npm run db:seed                                  → "Seeding initial Kenya HMIS multi-tenant dataset…"
                                                   "Seeding completed successfully!"
```

and a **second** `db:seed` run correctly prints
`"Database already seeded. Skipping initial seeding."` (idempotent).

### 2.4 Running server

Production bundle started with `NODE_ENV=production` on port 4613 against the fresh database:

| Probe                                       | Result                     |
| ------------------------------------------- | -------------------------- |
| `GET /api/health`                           | 200                        |
| `GET /api/ready`                            | 200 (database check up)    |
| `GET /`                                     | 200 (SPA shell)            |
| `POST /api/auth/login`                      | 200, session token issued  |
| `GET /api/auth/session`                     | 200                        |
| `GET /api/patients?tenantId=1&facilityId=1` | 200 (4 synthetic patients) |
| `GET /api/ops/status?facilityId=1`          | 200                        |
| `GET /api/tenants`                          | 200                        |

**Authenticated sweep of 236 GET routes** (every parameterised path substituted with `1`):

- 127 × 200
- 102 × 403 — expected: the platform `SUPER_ADMIN` deliberately does **not** hold
  facility financial permissions (`isSuperAdmin` filters them out), and facility-scoped
  routes require a facility account.
- 6 × 404 — all six are the **intentionally retired** master-tariff catalogue endpoints
  (`/api/master-tariffs`, `/api/master-lab-specimens`, `/api/master-services`,
  `/api/master-tariff-sources`, `/api/service-tariffs`, `/api/master-tariffs/:id/history`).
  A spec asserts these 404.
- 1 × 501 — `/api/interop/dha/moh-705`, deliberately unimplemented pending the official
  MOH 705 contract.

**No route failed with a 5xx and no route was unreachable.**

### 2.5 Scope enforcement (live, not mocked)

| Request                                                                      | Response                           |
| ---------------------------------------------------------------------------- | ---------------------------------- |
| `/api/patients?facilityId=1` (platform admin, no tenant)                     | **400** `TARGET_TENANT_REQUIRED`   |
| `/api/patients?tenantId=1&facilityId=1`                                      | 200                                |
| `/api/patients?tenantId=2&facilityId=1` (facility belongs to another tenant) | **403** `FACILITY_TENANT_MISMATCH` |
| `/api/patients?facilityId=999`                                               | 404 `FACILITY_NOT_FOUND`           |

This was a real defect fixed during the audit: the same condition previously returned
**500 `PATIENT_LIST_FAILED`** because `scopedPatientConditions()` threw a plain `Error`.
It now throws `ScopeAccessError` with a machine-readable code, and `handleScopeError()`
maps "parameter missing" to 400 (it was 403). The fix matters beyond patients:
`handleScopeError` is called from **99 route handlers**.

---

## 3. Defects found and fixed in this audit cycle

These are real breakages that were reproduced, fixed, and re-verified — not refactors.

| #   | Defect                                                                                                                                                            | Impact                                                                                                                  | Fix                                                                                                                                             | Verified                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `npm run db:seed` was a **silent no-op** — `seedInitialData()` was exported but never called, and its `catch` swallowed errors                                    | A fresh install looked seeded and exited 0 with an empty database. The most dangerous class of bug in a bootstrap path. | Direct-invocation guard + rethrow + `pool.end()` in `finally` (`src/db/seed.ts`)                                                                | Second run prints "already seeded"; a failing run exits **1**                 |
| 2   | **No supported way to create the first administrator** — `src/bootstrap-admin.ts` existed but was not in `package.json`, the script dispatcher, or the build      | A new deployment could never sign in; `db:seed:permissions` refuses without a `SUPER_ADMIN` role                        | Added `db:bootstrap-admin` npm script, dispatcher entry, and `build/scripts/bootstrap-admin.js` bundle entry                                    | Ran on 2 fresh DBs; deploy-artefact checker verifies the bundle               |
| 3   | `/api/master-tariffs` style clients pointed at **retired** endpoints (service-tariff link router not mounted; `lab-service-diagnostics` route lost in extraction) | 4 client screens called routes that did not exist                                                                       | Mounted `serviceTariffLinksRoutes`; restored `GET /api/billing/lab-service-diagnostics`; re-pointed 4 client methods to `/api/facility-tariffs` | Live 200/201/PATCH on all repaired paths; `client-route-contract.spec.ts` 4/4 |
| 4   | Patient list returned **500** for a platform admin without a tenant                                                                                               | Unhandled exception on a normal admin screen                                                                            | Typed `ScopeAccessError` codes + 400 mapping                                                                                                    | Live 400/403 matrix above                                                     |
| 5   | `deploy-artifacts.spec.ts` failed once `bootstrap-admin.js` was added to the build                                                                                | The guard that keeps the checker in step with the build did its job                                                     | Added the artefact to `REQUIRED_ARTIFACTS` **and** the test fixture                                                                             | 11/11 pass                                                                    |
| 6   | Documented install order was **wrong** — README, CONTRIBUTING, deployment guide and the Truehost guide all ran `db:seed:permissions` before any admin existed     | Documented first run fails with `Global SUPER_ADMIN role was not found` (exit 1)                                        | Not yet fixed — tracked in §7.1                                                                                                                 | Reproduced on `jalicare_docorder`                                             |

A client↔server route guard (`src/tests/vitest/client-route-contract.spec.ts`) now parses every
client method and every registered server route and fails if a client method has no route. It
pins the retired endpoints with a reason and is **mutation-tested**: introducing a typo in a
route path makes it fail and name the exact client method.

---

## 4. Module-by-module status

Status vocabulary:
**Built & tested** = implemented, exercised by the automated suite (and, where stated, live HTTP).
**Partial** = the happy path works; named gaps remain.
**Configured only** = code/config exists, never exercised against the real thing.
**Not done** = no implementation, or deliberately blocked.

| Area                                                 | Status                      | What exists                                                                                                                                                                 | What remains                                                                                                                                           |
| ---------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth, sessions, RBAC**                             | Built & tested              | Argon2id hashing, `SUPER_ADMIN` / tenant / facility scopes, 187 seeded permission codes, per-facility overrides, session token, permission middleware, access-audited reads | No MFA, no SSO, no password-reset self-service, no independent security audit                                                                          |
| **Tenancy & scope**                                  | Built & tested              | Tenant→facility hierarchy, server-derived scope (browser-supplied facility IDs never trusted), 403/400 distinction, cross-tenant refusal proven live                        | —                                                                                                                                                      |
| **Platform administration**                          | Partial                     | Tenant/facility CRUD, module toggles, RBAC editor, audit log screens                                                                                                        | Global admin deliberately cannot read facility finance; some screens need a facility account                                                           |
| **Patient registration & demographics**              | Built & tested              | Registration, MRN, encrypted identifiers, access logging, directory paging                                                                                                  | Server-side idempotency for patient/visit creation not comprehensive                                                                                   |
| **Outpatient / triage / clinical**                   | Partial                     | Encounters, observations, diagnoses, prescriptions                                                                                                                          | Clinical acceptance; complete care pathways                                                                                                            |
| **Inpatient, nursing, theatre, maternity, dialysis** | Partial                     | Admission, bed occupancy, ward billing, night policy, theatre checklist, maternity, dialysis sessions                                                                       | Transfers/discharge completeness, consent capture, real clinical sign-off                                                                              |
| **Laboratory**                                       | Partial                     | Order → collect → result → verify, accessioning, scoped specimen sharing                                                                                                    | Historical accession conflicts, critical-result workflow, amendments                                                                                   |
| **Pharmacy & inventory**                             | Partial                     | Batches, FEFO allocation, dispensing, stock counts, procurement, supplier returns                                                                                           | Catalogue identity/strength, expiry edge cases, cross-device ambiguity                                                                                 |
| **Billing & tariffs**                                | Built & tested (with gaps)  | Facility tariffs, service links, price resolution, charge attempts, invoices, splits, receipts, refunds with independent approval, tariff import API                        | No bulk-import UI; claims can still be prepared from unfinalised invoices; refund settlement itself stays manual (no provider transfer)                |
| **Accounting / GL**                                  | Partial                     | Source-linked double-entry posting for invoice/payment/refund, reversals, period locks, consistency & exception reports                                                     | No source posting for claim recognition, remittance, credit notes or adjustments; ordering uses transaction `created_at`; no corrected-repost workflow |
| **Insurance / SHA / private payers**                 | Partial, externally blocked | Claim preparation, dispatch guards, evidence preview, eligibility, preauth, remittance records, audited dispatch reconciliation (migration 0087)                            | No live transport; Britam/PACIS are manual, not APIs; claim preparation does not require a finalised invoice                                           |
| **Payment hub / M-Pesa**                             | Configured only             | Sandbox Daraja adapter boundary, callback ingestion, manual reconciliation                                                                                                  | Callback is unauthenticated and cannot settle; production blocked on Safaricom contract                                                                |
| **Bank / card**                                      | Configured only             | Bank statement import/reconciliation, disabled transfers                                                                                                                    | No contracted API, no verified settlement                                                                                                              |
| **Notifications (SMS/email)**                        | Configured only             | Provider interface that reports "not configured" honestly                                                                                                                   | No provider selected or tested                                                                                                                         |
| **Patient portal**                                   | Partial                     | Portal login, appointments, results view                                                                                                                                    | No self-service registration (by design); delivery of results not verified                                                                             |
| **Reporting centre**                                 | Built & tested              | Operational registers, report catalogue, filters, exports                                                                                                                   | Not validated against MOH/DHIS2 submission requirements                                                                                                |
| **Public health / immunisation**                     | Partial                     | IDSR-oriented registers, immunisation schedule, postnatal care                                                                                                              | No verified national acceptance; IDSR completeness unproven                                                                                            |
| **Workforce / payroll**                              | Partial                     | Payroll calculator with configurable rates, staff roles, verification                                                                                                       | **P9/P10 statutory outputs not produced** — authoritative rates/forms not available; do not invent                                                     |
| **Fixed assets**                                     | Built & tested              | Asset register, depreciation policies (configurable rates)                                                                                                                  | Facility must supply approved rates; no tax-rule invention                                                                                             |
| **Procurement**                                      | Built & tested              | Requisitions, POs, matching, returns, approval separation                                                                                                                   | Supplier-side integration absent                                                                                                                       |
| **Interoperability / DHA**                           | Configured only             | Adapter boundaries, readiness checks, compliance panels                                                                                                                     | `DHA_MODE=mock`; no credentials; `/api/interop/dha/moh-705` returns **501 by design**                                                                  |
| **Audit & logging**                                  | Built & tested              | Structured JSON logs with correlation IDs, audit rows, patient-access log                                                                                                   | No log shipping/SIEM; retention policy not enforced                                                                                                    |
| **Backup & recovery**                                | Verified by drill           | Backup/restore scripts, drill harness, verification of restored data                                                                                                        | **Not** scheduled, monitored or run on the real host                                                                                                   |
| **Deployment / ops**                                 | Partial                     | Build bundles, preflight, migrate/status scripts, timezone config, env contract, operations runbook, health/ready probes                                                    | **Docker never executed here**; no monitoring/alerting deployed; no host run                                                                           |

---

## 5. Test suite anatomy

| Layer                                | Files   | Count                    | Nature                                        |
| ------------------------------------ | ------- | ------------------------ | --------------------------------------------- |
| `src/tests/integration/*.db.spec.ts` | 84      | bulk of DB/HTTP coverage | Real PostgreSQL + Express, synthetic data     |
| `src/tests/vitest/*.spec.ts(x)`      | 122     | unit/component/contract  | Pure units, React components, route contracts |
| `src/tests/*.spec.ts` (legacy)       | 82      | source-text assertions   | Assert on file contents, not behaviour        |
| **Total**                            | **286** | **2667 tests**           | all green, 398 s                              |

**Honest caveat:** the 82 legacy source-text specs inflate the file count and do not prove
behaviour. Repository `docs/quality/BASELINE.md` records measured line coverage in **single
digits**; no coverage run was made in this audit, so the current coverage number is
**unknown**, and should be re-measured before anyone quotes a figure.

---

## 6. Codebase size and shape

- 843 TypeScript/TSX files, **334,481 lines** under `src/`.
- 42 domain directories (`accounting`, `billing`, `insurance`, `clinical`, `inventory`,
  `procurement`, `reporting`, `workforce`, `payment-hub`, …).
- 74 files register routes; **603 route declarations** (248 GET, 283 POST, 43 PUT, 21 PATCH,
  8 DELETE).
- Largest single modules: `workforce.service.ts` (2,655), `private-claims.service.ts` (2,189),
  `claims-workflow.service.ts` (2,099), `OutpatientModule.tsx` (2,077).
- `src/app.ts` still holds billing, claims and DHA routes inline; three domains have been
  extracted to `src/routes/domains/` (12 routers).
- No `TODO`/`FIXME`/`HACK` markers remain in `src/` (1 hit is a synthetic test string).

---

## 7. What remains — ordered by risk

### 7.1 Must be fixed before any deployment (code/docs, doable here)

1. **Run hosted CI on the new commits.** The work is now committed, but the pipeline has not
   seen it. Everything in §2 is a local result.
2. **Constrain claim preparation to finalised invoices.** Verified in the code this audit:
   `prepareShaClaim` and `preparePrivateInsuranceClaim` load the invoice and check
   tenant/facility/patient ownership, but neither requires `finalizedAt`. Only the claim
   _evidence preview_ insists on a non-void finalised invoice. A claim can therefore be built
   from an invoice whose contents can still change, which undermines the snapshot the claim is
   supposed to rest on.
3. **Re-measure coverage** and record the number. The documented single-digit figure predates
   the 236 specs added since; nobody should quote either number until it is measured again.
4. **Source ordering and corrected repost.** The posting bridge orders predecessors by
   transaction `created_at` (`billing-posting.service.ts`), so a transaction that began before
   waiting on a lock can look earlier than the business event. There is still no authorised
   corrected-repost workflow.

Closed since the 31 October report, and verified here rather than assumed:

- **Refund approval separation is implemented.** Migration `0072_independent_refund_review`,
  `refund-requests.service.ts` and `RefundsPanel`/`RefundRequestWorkflow`. A manual refund
  without a matching independent approval is refused with 409 `REFUND_APPROVAL_REQUIRED`, and
  the requester cannot approve their own request (`phase3b-refund-approval.db.spec.ts` asserts
  both, including the 403 for the requester).
- **Ambiguous claim dispatch now has a recovery path.** Migration
  `0087_claim_dispatch_reconciliation` plus `claim-dispatch-reconciliation.service.ts`: a named
  reviewer records what the payer's own record shows (`PAYER_CONFIRMED_RECEIVED`,
  `PAYER_CONFIRMED_NOT_RECEIVED`, `STILL_UNRESOLVED`) and the guard is released in the same
  transaction that writes the finding. It never calls a payer and never treats the finding as
  adjudication.
- **The documented install order is fixed** — `db:bootstrap-admin` now precedes the permission
  seed in `README.md`, `CONTRIBUTING.md`,
  `docs/dha-audit/DEPLOYMENT_AND_RECOVERY.md`, `docs/deployment/truehost-cpanel.md` §11 and
  `docs/patient-portal/PATIENT_PORTAL_DEPLOYMENT_GUIDE.md`, and the corrected sequence was
  re-run end to end on a fresh database.

### 7.2 Must be decided/approved by the facility (cannot be done here)

- Approved chart of accounts, prices, service mappings and clinical units.
- Delegated least-privilege roles; the platform bootstrap account is **not** a facility
  finance account.
- Independent reviewer sign-off: financial, clinical, privacy/security, operational.
- Data migration plan for any existing database (dump → verify restore → rehearse on a copy).

### 7.3 Blocked externally (contracts, credentials, official specifications)

| Dependency                                                 | What is needed                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SHA / DHA HIE                                              | Official interface contract, facility onboarding, sandbox credentials, callback authentication, MOH 705 form definition |
| Britam / PACIS / CIC                                       | Written contract and documented API; today these are manual workflows                                                   |
| Safaricom M-Pesa (Daraja)                                  | Production onboarding, callback authenticity, reconciliation agreement                                                  |
| Bank / card                                                | Contracted API with facility-scoped secrets; no scraping/OTP collection                                                 |
| SMS / email                                                | Provider selection, secrets, delivery and privacy tests                                                                 |
| Statutory payroll (P9/P10, PAYE, SHIF, NSSF, housing levy) | Authoritative current rates, forms and legal confirmation — must not be inferred from old guidance                      |
| ICD-11                                                     | Confirm current release (WHO lists `2026-01`; app default is `2025-01`) and licensing before changing                   |
| MOH / KHIS / DHIS2                                         | National acceptance criteria and reporting specification                                                                |

### 7.4 Operational proof still missing

- **Docker image never built or run** in this environment. `Dockerfile` and both compose
  files exist and are linted; that is configuration, not capability.
- **No monitoring/alerting deployed** — probes exist, no collector, no on-call.
- **Backups are proven by drill, not scheduled** — no cron, no off-site copy, no restore test
  on the real host.
- **No HTTPS/reverse-proxy proof**; origin and trust-proxy settings exist but were not
  exercised behind a real proxy.
- **No load/performance testing** with realistic volume.
- **No browser acceptance on real hardware**; earlier Chromium smoke runs were automated.

---

## 8. Corrections to earlier claims

| Earlier claim                                                                                   | Current fact                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Full suite green, 2667 passed" (pre-audit)                                                     | Still true, but only **after** today's fixes; the suite was red mid-audit (1 failure) once `bootstrap-admin.js` was added to the build                                       |
| "`db:seed` creates the first administrator" (README)                                            | Wrong. `db:bootstrap-admin` does; `db:seed` creates demo data                                                                                                                |
| "Install: `db:seed:permissions` then `db:seed`" (README, 4 other docs)                          | Wrong order. `bootstrap-admin` must run first; verified failure otherwise                                                                                                    |
| "Patient list error is a 500"                                                                   | Fixed to 400/403 with typed codes                                                                                                                                            |
| "18 client methods have no server route"                                                        | False alarm from a parser; the corrected guard reports **0** dead methods                                                                                                    |
| "Refund has no independent approval" (31 Oct report, repeated in the first draft of this audit) | Wrong for this tree. Migration `0072`, `refund-requests.service.ts` and the 409 `REFUND_APPROVAL_REQUIRED` path implement it; the requester cannot approve their own request |
| "No recovery for an ambiguous claim dispatch" (31 Oct report, repeated in the first draft)      | Wrong for this tree. Migration `0087` and `claim-dispatch-reconciliation.service.ts` record a reviewer finding and release the guard transactionally                         |
| Implicit assumption that the tree is checkpointed                                               | It was not when measured (638 dirty entries). Committed afterwards in six slices; hosted CI still has not run on them                                                        |

---

## 9. Bottom line

**Done:** a large, coherent HMIS — tenancy, RBAC, clinical records, laboratory, pharmacy and
inventory, inpatient and ward billing, tariffs, invoicing, payments, refunds, double-entry
posting, insurance claims, procurement, fixed assets, workforce, patient portal, reporting,
and a full operations/deployment tooling layer. 88 migrations. 2,667 automated tests pass
against real PostgreSQL. The production bundle boots and serves authenticated traffic with
correct scope enforcement.

**Not done:** committing it; the documented install order; refund approval separation;
ambiguous-dispatch recovery; claims-vs-finalised-invoice enforcement; coverage measurement;
Docker/monitoring/backup/HTTPS proof; every external integration; statutory payroll outputs;
facility and clinical acceptance.

**Recommendation:** land §7.1 on this branch, run the hosted CI on the commit, then hand §7.2
to the facility and §7.3 to the integration owners. Do not describe this system as
production-ready, compliant or integrated until those are closed with evidence.
