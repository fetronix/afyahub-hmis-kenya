# JaliCare HMIS — DHA Readiness Audit

**Audit date:** 21 October 2026
**Repository:** `fetronix/afyahub-hmis-kenya`
**Branch audited:** `arena/14785aa5-afyahub-hmis-kenya`
**Commit at start:** `9d504b3`
**Auditor:** Arena Agent Mode (code-level audit, no live database, no browser)

> **This is a technical self-assessment, not a DHA certification.**
> No score in this document, and no figure in the product, may be presented to a
> certifier as an assessment result. Only the Digital Health Agency can certify a
> system.

---

## 0. How to read this document

The brief supplied for this audit states that a DHA assessment "reports eight
implemented clinical functionality components and a 96% score", 100% public health
reporting, 84% security and 74% interoperability.

**None of those figures exist in this repository.** No code calculates them. The
only readiness surface in the product before this audit was
`src/integrations/dha/dha.readiness.ts`, which answers a narrower question — *can
this installation reach DHA right now* — and deliberately publishes no percentage.

This audit therefore did two things:

1. **Verified each claimed capability against the code**, and
2. **Built an evidence-based register** (`src/compliance/dha-requirements.ts`) so a
   score can only be produced from per-requirement statuses that name their own
   evidence.

The result is 42.5%, capped below a pass by seven critical gaps. That is a very
different number from 90%, and the difference is the point.

---

## 1. What JaliCare is, factually

| Item | Finding | Evidence |
|---|---|---|
| Frontend | React 19.0.1, Vite 8.3.0, TypeScript 7.0.2, Tailwind 4 | `package.json` |
| Backend | Express 4.21.2 on Node, TypeScript executed with `tsx` | `server.ts`, `src/app.ts` |
| Database | **PostgreSQL** via `pg` 8.23.1 — *not SQLite* | `src/db/index.ts` |
| ORM | Drizzle ORM 0.45.3 + drizzle-kit 0.31.11 | `src/db/schema.ts`, `drizzle.config.ts` |
| Authentication | First-party: argon2 password hashes, random 48-byte session tokens stored as SHA-256, 8-hour expiry, `security_version` invalidation | `src/auth/session.service.ts`, `src/utils/password.ts` |
| Authorisation | Permission codes in `role_permissions`, loaded per request | `src/auth/authorization.service.ts` |
| API | 134 route declarations under `/api` in one Express app | `src/app.ts` |
| Source size | 144 `.ts`/`.tsx` files, 84,426 lines (excluding backups) | `wc -l` |
| Schema | 75 tables, 211 `.references()` declarations | `src/db/schema.ts` |
| Migrations | 17 SQL files, 17 journal entries, 75 tables — parity confirmed | `drizzle/` |
| Tests | 21 suites, 2,553 counted assertions | `npm test` |
| Deployment | Single Node process; frontend built by Vite; no container, CI or IaC in repo | absence verified |

**The brief assumed SQLite.** It is not. PostgreSQL changes two conclusions:

- There is no "SQLite file encryption" question; the question is whether the
  PostgreSQL data directory, its volume and its backups are encrypted, which is a
  hosting decision (see §6).
- Foreign keys are enforced by the engine; no `PRAGMA foreign_keys` equivalent is
  needed.

---

## 2. Baseline: the condition of the system before this audit

The application was **not** a shell. Registration, outpatient flow, maternity,
laboratory, pharmacy, billing, claims, inventory, procurement, theatre, radiology,
staff roles and audit all had working backend code and, in most cases, tests. The
build succeeded and 19 suites were green at `9d504b3`.

The problems were of a different kind: **places where the product said more than
the system could do, and places where the system did less than it claimed.**

### 2.1 Critical findings

| # | Finding | Location | Impact | Status after audit |
|---|---|---|---|---|
| C1 | **Cross-facility / cross-tenant exposure.** `GET /api/theatre-cases`, `GET /api/radiology-orders`, `GET /api/suppliers` and `GET /api/purchase-orders` required only a session. With no `facilityId` (or with someone else's) the query returned **every facility's rows**. | `src/app.ts` (routes before this commit), `src/db/queries.ts:2234, 2688, 2676` | Any authenticated user of any tenant could read theatre cases, imaging orders, suppliers and purchase orders belonging to other facilities. | **Fixed.** Permission + scope guard on all four; body/query ids can no longer choose the facility. |
| C2 | **Unguarded writes.** `POST /api/theatre-cases`, `PUT /api/theatre-cases/:id`, `POST /api/radiology-orders`, `PUT /api/radiology-orders/:id/report` and `POST /api/purchase-orders` inserted or updated `req.body` with no permission check and no ownership check. | `src/app.ts` | Any authenticated user could create or modify another facility's clinical and procurement records by id. | **Fixed.** Permissions added; facility and tenant forced from the session; theatre and radiology updates verify the row belongs to the facility. |
| C3 | **Records filed against facility 1.** Six screens sent `facilityId: currentFacility?.id \|\| 1`. | Inventory, Procurement, Radiology, Reception, Theatre, Public health modules | With no facility selected, a clinical or financial record was written to facility 1 — the wrong facility, silently. | **Fixed.** Guard added; no fallback remains (asserted by `test:route-scope`). |
| C4 | **Public-health screen claimed integrations that do not exist.** "Integrated with Kenya Digital Health Agency (DHA) national disease surveillance network", "DHIS2 Auto-Push", "queued for KHIS submission", and "Epidemic Threshold: Normal Trend" on every row. | `src/components/modules/PublicHealthModule.tsx` | A facility could believe a notifiable disease had been transmitted nationally when nothing left the building. The threshold label was invented from no data. | **Fixed.** Screen rewritten: local-record caveat, no invented thresholds, server refusal shown, export disabled without a real payload. |
| C5 | **No patient consent record.** `patient_consents` exists in the schema with version, document hash and method columns; no route, service or screen reads or writes it. | `src/db/schema.ts:1568` | Consent cannot be demonstrated for any patient. This is a legal and DHA-readiness gap. | **Open.** |
| C6 | **No allergy or interaction record.** The only allergy field is a boolean in a theatre safety checklist. | `TheatreModule.tsx:43` | Prescribing proceeds with no allergy warning. Patient-safety gap. | **Open.** |

### 2.2 High findings

| # | Finding | Location | Impact | Status |
|---|---|---|---|---|
| H1 | `npm run lint` could never pass: `src/lib/firebase.ts` imported a gitignored JSON file that does not exist. Both Firebase modules were dead code and the auth system does not use them. | `src/lib/firebase.ts`, `firebase-admin.ts` | Type check permanently red; real type errors could hide behind a known failure. | **Fixed.** Both removed; `tsc --noEmit` is now clean. |
| H2 | Database TLS hard-coded to `ssl: false`. | `src/config/env.ts:33` | No encrypted path to PostgreSQL, on any deployment. | **Fixed.** `SQL_SSL` / `SQL_SSL_REJECT_UNAUTHORIZED`, verification on by default. |
| H3 | MOH 705 endpoint returns 501 while the screen rendered an empty table, a hard-coded "October 2026" period, and an export button that downloaded JSON `null` and reported success. | `src/app.ts:6482`, `PublicHealthModule.tsx` | A false impression that a statutory return existed. | **Fixed.** The screen now states that the report is not produced by this build. |
| H4 | Six supplier/PO/theatre/radiology routes had no permission code at all. | `src/app.ts` | RBAC effectively incomplete. | **Fixed** for those routes; see H5. |
| H5 | **Five unguarded routes remain, and 33 id-addressed routes have not been checked for object ownership.** | `src/app.ts` | Unknown residual exposure. | **Open — must be completed before any deployment.** |
| H6 | Duplicate-patient detection is a client-side warning only; no server rule and no merge/reconciliation path. | `PatientRegistrationModule.tsx:90` | Duplicates persist in the master index. | **Open.** |
| H7 | Audit log has no database-level immutability: no trigger, no `REVOKE UPDATE, DELETE`. | `drizzle/0000_new_vertigo.sql` (audit_logs) | A database user can rewrite history; ordinary application users cannot (no route exists). | **Open** — SQL supplied, not executed. |

### 2.3 Medium findings

| # | Finding | Impact | Status |
|---|---|---|---|
| M1 | No clinical decision support of any kind. | No threshold or interaction alerts. | Open |
| M2 | No family history, allied health (physiotherapy, occupational therapy, nutrition, social work, counselling) or growth charts. | Eight CPOE elements in the DHA list are absent. | Open |
| M3 | Diagnoses are free text ICD-10; no code validation, no problem list. | Coding quality and aggregation. | Open |
| M4 | FHIR support is one read-only `Patient` resource. | Interoperability maturity. | Open |
| M5 | Radiology, theatre and procurement routes have no automated test. | Regressions in these paths are invisible. | Open |
| M6 | `patients.facility_id` is dropped by migration `0002`. | On an existing installation, any value in that column is lost unless migrated first. | Documented |
| M7 | Three tables (`admission_transfers`, `dha_service_mappings`, `nursing_notes`) are created by migrations but were briefly reported missing by a naive text scan; verified present. | Audit accuracy. | Verified — no defect |

### 2.4 What was *not* wrong

Worth stating plainly, because the brief implies a system that may be mostly
theatre:

- Password hashing, session handling, lockout and rate limiting are implemented
  and tested (`test:auth-service`, `test:http-security`).
- The DHA integration never pretends to be live: mock results are labelled, the
  production switch is off by default, and unimplemented operations publish their
  reason (`src/integrations/dha/dha.readiness.ts`).
- The maternity module is real (2,439 lines, five tabs) and tested (282 assertions
  across two suites).
- Migrations are complete and internally consistent: 75 schema tables = 75 tables
  created by 17 migrations.

---

## 3. Method

1. Read the schema, the migration set, every route declaration and the auth stack.
2. Enumerated all 134 `/api` route declarations and inspected every route without
   a permission guard.
3. Searched the entire source tree for the capabilities the brief lists, and
   recorded zero-match results rather than assuming.
4. Ran the build, the type check and all test suites; captured exact output.
5. Attempted the database status check; it failed for want of credentials and is
   recorded as BLOCKED, not as passed.
6. Wrote regression tests for every defect fixed.
7. Built a requirement register with per-row evidence, and a scoring function that
   cannot hide a critical gap.

**Not available in this environment:** a PostgreSQL instance, database credentials,
a browser, DHA sandbox credentials, and ODPC/DPIA documents. Every conclusion that
would need one of those is marked BLOCKED.

---

## 4. Changes implemented in this audit

| Change | Files | Why |
|---|---|---|
| Scope helper and nine guarded routes | `src/app.ts` | C1, C2, H4 |
| Object-ownership readers | `src/db/queries.ts` (`getTheatreCaseScoped`, `getRadiologyOrderScoped`) | C2 |
| No facility-1 fallback | six module screens | C3 |
| Public-health screen rewritten | `PublicHealthModule.tsx` | C4, H3 |
| Requirement register | `src/compliance/dha-requirements.ts` | Phase 10 |
| Scoring with critical gate | `src/compliance/dha-score.ts` | Phase 10 |
| Read-only assessment API | `src/compliance/compliance.routes.ts` | Phase 10 |
| Assessment panel | `DhaCompliancePanel.tsx`, `InteroperabilityModule.tsx` | Phase 10 |
| Dead Firebase modules removed | `src/lib/firebase.ts`, `firebase-admin.ts` (deleted) | H1 |
| Configurable database TLS | `src/config/env.ts`, `.env.example` | H2 |
| Regression suites | `src/tests/route-scope.test.ts`, `src/tests/dha-compliance.test.ts` | Phases 11–12 |

Nothing was removed from the product's functionality. The only deletions are two
modules that nothing imported.

---

## 5. Verification performed

| Check | Command | Result |
|---|---|---|
| Type check | `npm run lint` | **Passes** — previously always failed on `firebase.ts` |
| Production build | `npm run build` | **716 ms**, bundle emitted |
| Test suite | `npm test` | **21 suites, 2,553 assertions, no failures** |
| Route inventory | static scan of `src/app.ts` | 134 routes; 9 previously unguarded routes now guarded |
| Schema/migration parity | static comparison | 75 = 75; 17 journal entries = 17 files |
| Database status | `npm run db:status` | **BLOCKED** — `Missing required environment variable: SQL_HOST` |
| Browser walkthrough | — | **BLOCKED** — no browser in this environment |

---

## 6. The three questions a certifier will ask first

### 6.1 ODPC registration

**Not present, and not verifiable from code.** No certificate, registration number
or responsible legal entity is recorded anywhere in the repository. Nothing was
invented. See `SECURITY_PRIVACY_GAP_REGISTER.md` §1 for the exact evidence needed.

### 6.2 DPIA

**Not present.** A populated draft is delivered as `DPIA_DRAFT.md`. It contains
only verified system facts and clearly marked assumptions. It is **not approved**
and must be reviewed and signed by the responsible officer.

### 6.3 Encryption

| Path | Finding |
|---|---|
| Client ↔ server | The application terminates no TLS. Helmet and CORS are configured; HSTS is only meaningful behind TLS. Deployment must terminate TLS 1.2+. |
| App ↔ PostgreSQL | Was hard-coded off. Now `SQL_SSL`, default off for local, with certificate verification on. **Not enabled in any environment I could see.** |
| At rest | No storage encryption, no key management, no encrypted-backup procedure in the repository. |
| Backups | No backup automation, retention policy or restore runbook. |

HTTPS does not encrypt a database. No such claim is made here.

---

## 7. Final status by DHA category

Computed by `buildDhaScore()` in `src/compliance/dha-score.ts` from 46
requirements (see `DHA_REQUIREMENT_TRACEABILITY.md`).

| Category | Weight | Requirements assessed | Verified | Score | Contribution |
|---|---:|---:|---:|---:|---:|
| Clinical functionality | 35% | 20 | 9 | 61.3% | 21.4 |
| Security & privacy | 30% | 12 | 2 | 37.5% | 11.3 |
| Public health reporting | 20% | 6 | 0 | 16.7% | 3.3 |
| Interoperability | 15% | 7 | 0 | 42.9% | 6.4 |
| **Weighted average** | | | | **42.5%** | |
| **Reported score** | | | | **42.5%** | |

Status counts across 46 requirements: **11 verified**, 3 built-but-untested, 15
partial, 14 missing, 2 blocked on an external party, 1 not applicable.

The critical gate is triggered, but the average is already below the 59.9 ceiling,
so the cap does not change the figure. `readyForSubmission` is false either way.

**Seven critical requirements are unmet:** consent capture (FN-06), allergy
checking (FN-15), ODPC registration (SP-01), DPIA (SP-02), encryption at rest
(SP-08), backup and disaster recovery (SP-09), and IDSR weekly reporting (PH-02).

**Ready for submission:** no.

---

## 8. Limitations of this audit

- **No database.** Nothing was executed against PostgreSQL. SQL paths are
  contract-checked, not run.
- **No browser.** No screen was clicked. UI assertions are source-level.
- **No DHA sandbox credentials.** The integration is verified against fixtures
  only; no live token exchange was attempted.
- **No ODPC or DPIA artefacts.** Status is "not evidenced", not "failed".
- **Not a penetration test.** Only non-destructive static and test-based checks
  were performed, as instructed.
- **Five unguarded routes and 33 id-addressed routes remain unaudited.** This is
  the largest residual technical risk and is item P1-1 in the remediation plan.

---

## 9. Related documents

| Document | Contents |
|---|---|
| `DHA_REQUIREMENT_TRACEABILITY.md` | All 46 requirements, evidence, status |
| `SECURITY_PRIVACY_GAP_REGISTER.md` | Technical and organisational gaps |
| `INTEROPERABILITY_AUDIT.md` | HIE, FHIR, terminology, exchange |
| `DATABASE_MIGRATION_AUDIT.md` | Schema, migrations, constraints |
| `TEST_RESULTS.md` | Executed commands and real output |
| `REMEDIATION_PLAN.md` | Ordered work, owners, dependencies |
| `DEPLOYMENT_AND_RECOVERY.md` | Deployment, backup, restore |
| `DPIA_DRAFT.md` | Populated draft, unsigned |
