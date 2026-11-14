# JaliCare HMIS / AfyaHub Kenya — Full System Audit and Completion Assessment

**Audit date:** 2026-10-27
**Repository:** `fetronix/afyahub-hmis-kenya`
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`
**Method:** static inspection of the repository as it stands on disk
**Data:** synthetic only. No real patient, staff, supplier or financial record was read or written.

---

## 0. Scope, method and honest limitations

This is an **evidence-based assessment**, not an implementation task. No source file, schema,
migration or test was modified. No dependency was installed and no environment configuration was
changed, because the audit brief forbids it without authorisation.

**The single most important limitation, stated first:** this session had **no `node_modules` and no
reachable PostgreSQL**, and I was not authorised to install either. **No test was executed during
this audit.** Everything below is derived from reading the code, the migrations, the tests and the
CI configuration.

Where I cite test results, they come from a **prior run in the previous session at commit
`197a553`**, which is byte-identical to the code on disk today (proven in §1). That is legitimate
evidence, but it is *recorded* evidence, not something re-verified in this session. Anything that
could only be settled by running code is marked **NEEDS EXECUTION** rather than asserted.

---

## 1. Repository protection and baseline

### 1.1 What was found

| Item | Value |
| --- | --- |
| Local HEAD | `0111b5502e1a8d8a21faf53845360122275727df` (stale) |
| Published branch tip | `197a553ae5fbf5269234f2bce6e34752f233bda3` |
| Clone type | **shallow** (`.git/shallow` present; history depth 1 at the local ref) |
| Working tree | 141 modified, 803 untracked, 1 deleted, **0 staged** |
| Worktrees | one (`/home/user/afyahub-hmis-kenya`) |

### 1.2 The baseline inconsistency, recorded exactly as instructed

The sandbox reset local Git refs to `0111b55` again while the published branch had advanced to
`197a553`. Because the clone is shallow and the fetch objects were discarded by the reset,
`origin/arena/e088f11d-afyahub-hmis-kenya` did not resolve locally at the start of this audit.

**I did not repair it.** I ran one read-only `git fetch` (no merge, no checkout, no reset) purely to
obtain the published tree for comparison.

### 1.3 Proof that no work is lost

I compared **every one of the 1,161 files** in the published commit against the bytes on disk:

```
IDENTICAL: 1161   DIFFERENT: 0   MISSING-ON-DISK: 0
```

**Conclusion:** the working tree is byte-for-byte the published state. The stale local ref is a
cosmetic/bookkeeping defect, not a data-loss event. Nothing needs recovering.

### 1.4 Preserved as required

All eight approval-policy WIP files, the Batch B inventory-accounting design (`0079`,
`inventory-accounting.service.ts`), the Batch E artefacts (`0080`, `matching.service.ts`,
`returns.service.ts`, `MatchingReturnsPanel.tsx`), and the Phase 5 delivery evidence (30
screenshots, 5 JSON captures) are present and intact.

### 1.5 Minimum action needed (reported, not taken)

To make the local clone truthful: `git fetch origin` then `git reset --hard 197a553` — **destructive
and unnecessary**, since the content already matches. A non-destructive alternative is simply
`git checkout -B <branch> 197a553`. Neither is required for correctness today.

---

## 2. System inventory

| Dimension | Count | Note |
| --- | --- | --- |
| SQL migrations | **81** | `0078`–`0080` registered at idx 78–80 |
| Tables in migrations | **229** | |
| Tables in Drizzle schema | **229** | exact match — no drift found |
| Schema modules | 43 | |
| Route files | 47 (4 unmounted) | |
| Declared endpoints | **481** | 205 GET, 220 POST, 30 PUT, 18 PATCH, 8 DELETE |
| Mounted routers | 49 imports in `src/routes/index.ts` | |
| UI modules | 61 | |
| React components | 116 (4 orphans) | |
| API client modules | `src/api/clients/*` | |
| Test files | **262** (78 DB-backed) | |
| CI jobs | 7 | static, unit, bootstrap, database, build, audit, format |

Architecture is coherent and not a collection of demos: an Express/TypeScript API with a Drizzle/
PostgreSQL data layer and a React/Vite frontend, organised by domain (`billing/`, `accounting/`,
`inventory/`, `procurement/`, `insurance/`, `maternity/`, `theatre/`, `dialysis/`, `portal/`,
`workforce/`, `assets/`, `reporting/`, `payment-hub/`, `integrations/`).

---

## 3. Findings — defects and dead code

These are things that are **actually wrong or wasteful** in the repository, each verified rather
than suspected.

### F1 — Four route files are never mounted (30 endpoints) · severity: low (dead code)

| File | Endpoints | Status |
| --- | --- | --- |
| `src/routes/service-tariffs.routes.ts` | 7 | superseded |
| `src/routes/master-tariffs.routes.ts` | 16 | superseded |
| `src/routes/domains/service-tariff-links.routes.ts` | 3 | superseded |
| `src/routes/approval-policy.routes.ts` | 4 | **functional gap** |

I verified with a quote-agnostic search that none of these paths are declared in any other router,
and that none are mounted in `app.ts`.

**Important nuance, and a correction to the obvious reading:** this is *mostly* not user-facing
breakage. Tariff management is genuinely served by the **mounted** `/api/facility-tariffs` and
`/api/facility-services`, and `clinical-catalogue-selection.db.spec.ts` **asserts 404** for
`/api/master-services` — retiring that endpoint was deliberate and tested.

The exception is **F2**.

### F2 — Approval-policy management has no API surface · severity: **medium-high**

`approval-policy.service.ts` is wired into procurement: `procurement.service.ts` and
`requisitions.service.ts` both call `assertApprovalAuthority`, so **policy enforcement works**. But
`approval-policy.routes.ts` (list, preview, create, update) is never mounted, and no UI manages
policies.

**Consequence:** a facility can be *governed* by an approval threshold but has **no supported way to
create, inspect or change one** through the application. Policies can only exist via direct
database writes. Enforcement without management is an incomplete control — an administrator cannot
audit or correct the rules that block their own approvals.

This is the clearest functional gap found in this audit and it is cheap to close (mount the router
with permission checks and scope resolution, add a settings panel).

### F3 — Four orphaned components · severity: low

Never imported outside their own tests, so they never render:

- `AddClinicalService.tsx` — calls `/api/master-services`, which returns **404** by design
- `FacilityServiceTariffsPanel.tsx` — calls `/api/service-tariffs` (unmounted)
- `FacilityBillingReview.tsx`
- `FinancialTransactionsPanel.tsx`

The first two are dead code kept alive by tests that mock the client, which is why the 404s never
surfaced. **116 − 4 = 96.5% of components are wired**, which is a good ratio, but these two should
be deleted or repaired rather than left as traps for the next developer.

### F4 — Dead client methods · severity: low

- `platformClient.seedData()` → `/api/seed` — no route anywhere; never called by any component.
- `billingClient.explainTariffMatch()` → `/api/billing/tariff-match` — no route; its only caller is
  the orphan `FacilityServiceTariffsPanel`.

### F5 — Falsified-negative risk in the wiring check

Worth recording because it nearly produced a wrong finding: `API_BASE` already contains `/api`, so
a naive path comparison reported **167 of 167 client paths as missing**. Corrected, the real number
of disconnected calls is the handful above. Method matters more than the result.

### F6 — Declarative input validation does not cover every endpoint · severity: **medium** · NEEDS EXECUTION

There are **90 declarative Zod validations** (`validateBody`/`validateQuery`/`validateParams`)
across **481 endpoints**, with 17 schema modules.

I did **not** verify that the remaining ~390 endpoints lack validation — many validate inline inside
handlers, which is legitimate. But the ratio means a per-endpoint review is required before anyone
claims uniform input validation. I am not asserting a vulnerability here; I am flagging an
unmeasured surface.

### F7 — No backup/restore, no monitoring · severity: medium · Phase 7

See §9. `check-tracked-database-backups.mjs` *prevents committing database dumps*; it is not a
backup. There is no `pg_dump`/restore script, no drill evidence, and no metrics/APM/error-reporting
integration (no Prometheus, Sentry or OpenTelemetry).

### F8 — Orphaned test fixtures vs time · severity: low, already fixed

For completeness: `billing-claims-inventory.spec.ts` previously hard-coded an expiry date
(`2026-11-10`) and failed deterministically once Africa/Nairobi passed it. Fixed in `d16fe87` by
deriving the date. Recorded because it demonstrates the suite contains **calendar-dependent
assertions**, so a future run near any hard-coded date is suspect.

---

## 4. Phase 1 — Security and multi-tenancy

**Overall: PARTIAL — strong foundations, one structural gap (F2), several external blockers.**

### 4.1 Authentication and session management · IMPLEMENTED

- `requireAuth` and `requireAuthorization` are applied to the whole `/api` surface at `app.ts:266–267`,
  so the default is deny-by-default rather than per-route opt-in.
- Session-based auth (`src/auth/session.service.ts`), security-version invalidation, rate limiting
  (`createAuthRateLimiter`), and a must-change-password gate exist.
- MFA is present but **fails closed** when required — recorded as an external blocker, not a defect.

### 4.2 Roles and permissions · IMPLEMENTED

- **415** `requirePermission(...)` guards and **68** role/any-permission guards across 47 route files.
- RBAC routes use a bespoke `requireRbacAdminMiddleware` **plus** explicit tenant/facility scope
  checks rather than `requirePermission`. I initially flagged this as unguarded; on reading the
  handlers it is properly protected. **Not a finding.**

### 4.3 Tenant and facility isolation · IMPLEMENTED, well instrumented

- **536** `tenantId` predicates and **652** `facilityId` predicates in services/queries.
- `resolveFacilityScope(...)` is used **87** times; `requireScopedFacility(...)` 14 times on routes.
- The recurring design principle — *never trust a browser-supplied facility id* — is visible in the
  code and asserted in DB specs (cross-facility 403/404 cases appear across the suites).
- The diagnosis read path carries the D1 fix requiring the diagnosis patient to match the encounter
  patient (verified present in `src/db/queries/clinical.ts`).

### 4.4 API authorization · IMPLEMENTED

481 endpoints; the only unauthenticated routes are `/api/health` and `/api/ready`, which are public
**by design** (load balancer and container probe), documented in `app.ts:188`. Portal and webhook
routers are mounted separately with their own controls.

### 4.5 Audit logging · IMPLEMENTED

**106** audit-write sites (`insert(schema.auditLogs)` / `writeAudit`), including the Batch E match
override, which records reason, actor and time.

### 4.6 Sensitive-data handling · IMPLEMENTED

- `src/security/field-crypto.ts` and `patient-identifiers.ts`; used in 8 modules (selected patient
  fields, facility vault, payment-hub credentials).
- `src/logging/logger.ts` implements an allowlist-style redaction list with tests asserting each
  entry actually redacts.
- `src/config/env.ts` **fails fast at module load** on missing configuration, which prevents a
  misconfigured production boot from silently running with undefined secrets.

### 4.7 Input validation · PARTIAL (see F6)

### 4.8 Known external blockers (unchanged, correctly not claimed as complete)

Patient-portal record-release policy, MFA recovery model, and the deferred repository-exposure
matter (`IR-01`). These need named clinical/privacy owners, not code.

---

## 5. Phase 2 — Clinical workflows

**Overall: IMPLEMENTED for the core hospital; PARTIAL at the edges.**

Evidence is route + service + test presence, not a claim of clinical acceptance.

| Workflow | Endpoints (indicative) | Evidence | Status |
| --- | --- | --- | --- |
| Patient registration/directory | 5 (`domains/patients`) | tests incl. >50-record paging | IMPLEMENTED |
| OPD / encounters | 4 + consult selection | `encounters`, clinical catalogue spec | IMPLEMENTED |
| Queues / reception | 3 | | IMPLEMENTED |
| Inpatient / wards / beds / admissions | **29** (`inpatient.routes`) | nursing notes, bed billing, transfers | IMPLEMENTED |
| Laboratory | 9 | `laboratory`, specimen review | IMPLEMENTED |
| Pharmacy | 10 + medications 3 | FEFO dispensing, stock integration | IMPLEMENTED |
| Radiology | 3 | report workflow | PARTIAL — thin surface for a full modality |
| Maternity / MCH | **23** (`maternal-health`) | ANC, labour, partograph, postnatal, immunisation | IMPLEMENTED |
| Theatre | 12 + 3 | scheduling, cases, rooms, legacy review | IMPLEMENTED |
| Dialysis | 15 | accounting-linked | IMPLEMENTED |
| Patient portal | `portal.routes` + admin | records, sharing, lockout | PARTIAL — release policy blocked |
| Missing-charge recovery | 16 files reference charge attempts | bounded, idempotent retry | IMPLEMENTED |

**Clinical→financial connection:** clinical events post to billing through the charge-attempt and
encounter-billing services rather than writing invoices directly, which is the correct seam. 15 test
files cover charge attempts.

**Gaps:** radiology depth; specialty documentation is explicitly not implemented
(`SpecialtyModule.tsx:154` says so honestly); no clinical acceptance/UAT at any facility.

---

## 6. Phase 3 — Billing and accounting

**Overall: IMPLEMENTED and the strongest part of the system; PARTIAL on reconciliation and asset
accounting.**

| Capability | Status | Evidence |
| --- | --- | --- |
| Tariffs (facility services, prices, history, transfer) | IMPLEMENTED | `/api/facility-services` (18), `/api/facility-tariffs` |
| Clinical & dispensing charges | IMPLEMENTED | charge attempts, dispensing posts |
| Bed billing | IMPLEMENTED | `BedBillingPolicyPanel`, nights, occupancy, review |
| Invoices / receipts | IMPLEMENTED | `domains/invoices` (12), finalize/void/print |
| Payments / attribution | IMPLEMENTED | payment requests, cancellation, attribution |
| Refunds (dual control) | IMPLEMENTED | refund request → decision → revoke, 27 test files |
| AR / AP | IMPLEMENTED | supplier invoices, payables, payments |
| Expenses | IMPLEMENTED | expense payable posting, approval panel |
| General ledger | IMPLEMENTED | 27 endpoints; draft-then-post header discipline |
| Inventory accounting | IMPLEMENTED | `0079`; opening, receipt, consumption, count, write-off, **returns**, **credit notes** |
| Bank reconciliation | **PARTIAL** | 6 source files, 2 tests; statement import exists, full reconciliation not proven |
| Fixed assets | **PARTIAL** | register, depreciation (straight-line), maintenance, disposal; **revaluation 0 files, impairment 0 files, tax depreciation 0 files** |
| Trial balance / P&L / balance sheet | IMPLEMENTED | accounting module + reporting |

**Integrity controls observed in code:** double-entry `JournalLine[]` with balanced debit/credit,
advisory locks for posting (`146908`), idempotency keys per economic event, closed-period refusal,
reversal rather than mutation, and one journal per goods-received-note.

**Explicitly not claimed:** bank reconciliation completeness, and asset revaluation/impairment.

---

## 7. Phase 4 — Reporting and Kenyan compliance

**Overall: PARTIAL.**

| Capability | Status | Evidence |
| --- | --- | --- |
| Operational / financial / clinical dashboards | IMPLEMENTED | dashboard service + `searchDashboard`, 25 test files |
| Report centre | IMPLEMENTED | `report-centre.routes`, scoped diagnosis register |
| Exports | IMPLEMENTED | CSV/print paths in report modules |
| MOH reporting / MOH 705 | PARTIAL | 10 source files reference 705; format acceptance unproven |
| KHIS / DHIS2 | **PARTIAL / adapter only** | 3 and 2 source files, 1 test each — no evidence of submission acceptance |
| ICD-11 | PARTIAL | supported classifications list verified; app default version is a **verification item**, not a defect |

No national submission has been accepted. Nothing here asserts MOH acceptance, and the code does
not claim it either.

---

## 8. Phase 5 — HR, payroll, procurement, administration

**Overall: PARTIAL — procurement is now the most complete part.**

| Capability | Status | Evidence |
| --- | --- | --- |
| HR records (employees, documents, departments, designations) | IMPLEMENTED | `workforce.routes` (39) |
| Attendance, leave, roster, shifts | IMPLEMENTED | |
| Payroll runs, components, payslips, statutory versions | IMPLEMENTED | effective-dated, DRAFT→ACTIVE→RETIRED |
| Statutory returns (P9/P10) | **MISSING** | 1 mention, 0 tests; no rates invented — correct decision |
| Requisitions & approvals | IMPLEMENTED | segregation of duties enforced |
| Purchase orders | IMPLEMENTED | revision control, separate approval |
| GRNs (partial delivery, over-receipt cap) | IMPLEMENTED | |
| Supplier invoices / AP | IMPLEMENTED | one journal per payment |
| **Three-way matching** | **IMPLEMENTED** | `0080`; payment gate + written override |
| **Supplier returns** | **IMPLEMENTED** | lot-cost valued, clearing vs payable |
| **Supplier credit notes** | **IMPLEMENTED** | input-VAT reversal, balance floor |
| **Approval-policy management** | **MISSING (F2)** | enforcement only; no API/UI |
| Inventory controls | IMPLEMENTED | ledger, adjustments, counts, transfers, FEFO |
| Fixed-asset revaluation / impairment / tax depreciation | **MISSING** | 0 source files |
| Supplier statement reconciliation | **MISSING** | no statement import |

---

## 9. Phase 6 — External integrations

**Overall: IMPLEMENTED AS SANDBOX ADAPTERS — correctly claims no connectivity.**

This is the phase where overclaiming is most tempting, and the code resists it well:

- `dha.client.ts` is gated by `config.enabled` (fails closed with a `disabledReason`) and
  `config.mode === 'mock'` short-circuits to `mock-access-token`. It also **avoids leaking provider
  bodies into audit records**.
- **Exactly one** live `fetch()` exists in the integration/payment/insurance surface
  (`dha.client.ts:155`), behind that gate.
- Provider hosts present as configuration constants, not proven connections: Safaricom sandbox,
  KCB BUNI, Jenga, DHA AfyaLink/AfyaConnect/FHIR, SHA NSHR UAT, KMPDC, NCK, ILM.
- Payment hub enforces a **production-readiness gate** that approval cannot bypass
  (`service.ts:1501`) and models sandbox vs operational isolation.

**Status: EXTERNAL BLOCKER for anything real.** Sandbox and mock only; no credentials, no provider
approval, no end-to-end acceptance. No live claim is made anywhere in the code or this report.

---

## 10. Phase 7 — Deployment and operations

**Overall: PARTIAL.**

| Capability | Status | Evidence |
| --- | --- | --- |
| Container build | IMPLEMENTED | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.test.yml` |
| Configuration | IMPLEMENTED | `.env.example`; `env.ts` fails fast on missing vars |
| Migrations | IMPLEMENTED | `migrate.ts`, `migration-status.ts`, `migration-journal.ts`, integrity contract tests |
| Preflight | IMPLEMENTED | `scripts/preflight.ts` |
| Health / readiness | IMPLEMENTED | `/api/health`, `/api/ready` (public by design) |
| Logging | IMPLEMENTED | redacting logger with tests |
| CI | IMPLEMENTED | 7 jobs; green 7/7 at `197a553` (prior run) |
| **Backup / restore** | **MISSING** | no `pg_dump`/restore script, no drill evidence |
| **Monitoring / metrics / APM** | **MISSING** | no Prometheus, Sentry or OpenTelemetry |
| Access-control review | PARTIAL | extensive automated tests; no independent penetration test |
| Performance testing | **MISSING** | no load/soak evidence |
| Operational docs | PARTIAL | `docs/deployment/truehost-cpanel.md` only |

**A deployment without backup/restore and monitoring is not production-ready**, regardless of how
good the application code is. This is the largest non-functional gap in the system.

---

## 11. Test and CI evidence

**Recorded, not re-run this session** (no dependencies installed):

- Last full coverage run at `197a553` — the exact code on disk: **262/262 files, 2469/2469 tests
  passed**, coverage thresholds met.
- GitHub Actions run `42903442859` at `197a553`: **7/7 jobs green** — static (tsc + eslint),
  unit+coverage on PostgreSQL 16, bootstrap, database+migrations, build, audit, format.
- `tsc --noEmit`: **0 errors**. `eslint`: 0 errors, 103 warnings. Prettier: clean.

Test shape: **262 files, 78 DB-backed** against real PostgreSQL, 184 unit/component. Domain
distribution is broad (auth 158, facility 203, billing 99, report 99, security 58, integration 58,
laboratory 50, inventory 46, accounting 31, procurement 19, theatre 17, maternity 16, dialysis 11).

**What this evidence does not establish:** that any real clinician, cashier, accountant or
administrator has used the system. There is **no facility UAT anywhere**, and that is the single
biggest caveat on every "IMPLEMENTED" in this document.

---

## 12. Completion scorecard

| Phase | Status | Blocking gaps |
| --- | --- | --- |
| 1 — Security & multi-tenancy | **PARTIAL** | approval-policy management (F2); MFA recovery, portal release policy, IR-01 external |
| 2 — Clinical workflows | **IMPLEMENTED** | radiology depth, specialty notes, facility UAT |
| 3 — Billing & accounting | **IMPLEMENTED** | bank reconciliation, asset revaluation/impairment/tax depreciation |
| 4 — Reporting & compliance | **PARTIAL** | MOH 705 acceptance, KHIS/DHIS2 submission evidence |
| 5 — HR, procurement, admin | **PARTIAL** | P9/P10 statutory returns, approval-policy management, supplier statements, asset revaluation |
| 6 — Integrations | **EXTERNAL BLOCKER** | credentials, provider approval, E2E acceptance — sandbox only, correctly claimed |
| 7 — Deployment & ops | **PARTIAL** | backup/restore, monitoring, performance, operational runbooks |

**The system is not complete**, and this audit does not declare it so. Roughly two thirds of the
functional surface is implemented and tested to a good standard; the remaining third is
concentrated in accounting edge cases (assets, reconciliation), statutory payroll output, compliance
submission proof, and operational readiness.

---

## 13. Prioritised recommendations

Ordered by risk reduced per unit of effort.

1. **Mount the approval-policy router** (F2). Small change, closes an enforcement-without-management
   hole. *Highest value in this list.*
2. **Write a backup/restore runbook and rehearse it** (F7). A disaster-test, not a document.
3. **Delete or repair the four orphan components and their dead client methods** (F3, F4). Prevents
   the `/api/master-services` 404 trap from being re-wired by a future change.
4. **Add monitoring**: at minimum error reporting plus a metrics endpoint.
5. **Bank reconciliation** to a stated, tested boundary — then say what it does not cover.
6. **Fixed-asset revaluation, impairment and tax depreciation**, which are entirely absent.
7. **Statutory payroll outputs (P9/P10)** only once authoritative rates and forms are supplied;
   inventing them would be worse than the gap.
8. **Book facility UAT.** No other item converts "tested" into "works in a hospital".

**Deliberately not recommended:** rewiring the retired `/service-tariffs` and `/master-tariffs`
routers. They are superseded by `/api/facility-services`, and one retirement is asserted by test.

---

## 14. What this audit could not determine

Stated plainly, so no one mistakes absence of a finding for a clean bill of health:

- Whether any test currently fails — nothing was executed.
- Whether the database on a real deployment matches the 229-table schema.
- Whether the ~390 endpoints without declarative validation are validated inline.
- Whether MOH 705 output is accepted by any authority.
- Whether the system performs acceptably under load.
- Whether any clinician or accountant finds the workflows usable.

Each of these requires execution or a human, not more reading.
