# JaliCare HMIS — DHA Readiness Audit

**Audit date:** 21 October 2026
**Last revised:** 22 October 2026 (revision 4 — patient portal round)
**Repository:** `fetronix/afyahub-hmis-kenya`
**Branch audited:** `arena/14785aa5-afyahub-hmis-kenya`
**Commit at start:** `9d504b3` · **working tree at revision 4:** `23a636d` plus the portal round
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

The result is **45.5%**, held below a pass by eleven critical gaps. That is a very
different number from 90%, and the difference is the point.

> **Remediation round, 2026-10-21 (evening).** After the audit was published, three
> of its critical findings were partially built: consent capture, a structured
> allergy registry with a prescribing warning, and application-level encryption of
> direct identifiers. The score moved from 42.5% to 45.5% because those rows moved
> from MISSING to PARTIAL. None of them is finished, all three remain critical gaps,
> and the cap still applies. The remaining work is named in §9 and in
> `REMEDIATION_PLAN.md`. Nothing here has been re-labelled as complete.

> **Revision 4 — patient portal round, 2026-10-22.** A patient-facing record
> portal was built: a separate identity and session namespace, single-use
> invitations, a read-only projection of the existing clinical tables, access
> logging for every patient read, a QR card that carries only an opaque code, and
> a facility administration surface behind five new permission codes. The evidence
> on **nine rows** was rewritten to include it: FN-05, FN-06, FN-17, SP-03, SP-04,
> SP-05, SP-06, SP-08 and SP-10.
>
> **The score did not move: it is 45.5% before and after.** That is the correct
> result, not an oversight. Every improvement landed inside a requirement that was
> already PARTIAL and remains PARTIAL: the portal adds guarded routes but does not
> audit the five legacy unguarded ones; it scopes its own queries but does not
> resolve object-level ownership elsewhere; it logs patient reads but the
> append-only guarantee is still an unapplied migration; it seals one more value
> but the volume and backups are still unencrypted. The eleven critical gaps are
> unchanged, and the critical gate would still refuse a pass.
>
> No requirement was added, removed or re-weighted to make room for the portal.
> Adding a requirement after building the thing that satisfies it is how a
> self-assessment starts to flatter itself.

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
| API | 226 route declarations: 134 in `src/app.ts` plus 92 in nine routers (`src/auth/*`, `src/routes/platform.routes.ts`, `src/clinical/*`, `src/compliance/*`, `src/config/facility-modules.routes.ts`, `src/portal/*`) | static scan, 22 Oct 2026 |
| Source size | 172 `.ts`/`.tsx` files, 102,925 lines under `src/` (excluding backups) | `wc -l`, 22 Oct 2026 |
| Schema | 82 tables (six added by migration 0018) | `src/db/schema.ts` |
| Migrations | 19 SQL files, 19 journal entries, 82 tables — parity confirmed. 0017 and 0018 are written and **unapplied** | `drizzle/` |
| Tests | 24 suites, 2,925 counted assertions (2,912 numbered + 13 catalogue `PASS:` lines) | `npm test` |
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

Figures as at revision 4 (22 Oct 2026). The audit-day figures are given in brackets where they
changed.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run lint` | **Passes** — previously always failed on `firebase.ts` |
| Production build | `npm run build` | **577 ms, 1,707 modules** (audit day: 644 ms) |
| Test suite | `npm test` | **24 suites, 2,925 assertions, no failures** (audit day: 23 suites, 2,717) |
| Route inventory | static scan of `src/app.ts` and the nine routers | 226 declarations (audit day: 134); 9 previously unguarded routes now guarded; all 38 portal routes guarded |
| Schema/migration parity | static comparison | 82 = 82; 19 journal entries = 19 files (audit day: 75 / 17) |
| Portal migration | `npm run test:migrations` | 692 assertions pass; **0017 and 0018 not executed against PostgreSQL** |
| Database status | `npm run db:status` | **BLOCKED** — `Missing required environment variable: SQL_HOST` |
| Browser walkthrough | — | **BLOCKED** — no browser in this environment |
| Portal runtime | — | **BLOCKED** — no database; no SMS/email provider exists |

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
| At rest | Storage encryption, key management and encrypted backups are still absent. Application-level sealing of national ID and SHA number exists (`src/security/field-crypto.ts`, AES-256-GCM, `FIELD_ENCRYPTION_KEY`), but a sealed column is not an encrypted database. |
| Backups | No backup automation, retention policy or restore runbook. |

HTTPS does not encrypt a database. No such claim is made here.

---

## 7. Final status by DHA category

Computed by `buildDhaScore()` in `src/compliance/dha-score.ts` from 46
requirements (see `DHA_REQUIREMENT_TRACEABILITY.md`).

| Category | Weight | Requirements assessed | Verified | Score | Contribution |
|---|---:|---:|---:|---:|---:|
| Clinical functionality | 35% | 20 | 9 | 66.3% | 23.2 |
| Security & privacy | 30% | 12 | 2 | 41.7% | 12.5 |
| Public health reporting | 20% | 6 | 0 | 16.7% | 3.3 |
| Interoperability | 15% | 7 | 0 | 42.9% | 6.4 |
| **Weighted average** | | | | **45.5%** | |
| **Reported score** | | | | **45.5%** | |

Status counts across 46 requirements: **11 verified**, 3 built-but-untested, 18
partial, 11 missing, 2 blocked on an external party, 1 not applicable.

The critical gate is triggered, but the average is already below the 59.9 ceiling,
so the cap does not change the figure. `readyForSubmission` is false either way.

**Eleven critical requirements are unmet:** consent capture (FN-06, partial),
allergy and interaction checking (FN-15, partial), ODPC registration (SP-01),
DPIA (SP-02), role-based access control review (SP-04, partial), tenant and
facility isolation (SP-05, partial), audit trail (SP-06, partial), encryption in
transit (SP-07, partial), encryption at rest (SP-08, partial), backup and
disaster recovery (SP-09), surveillance submission (PH-01, partial) and IDSR
weekly reporting (PH-02).

> The labels for SP-05 and SP-07 were transposed in revisions 1–3 ("incident
> response" and "audit trail"). The identifiers and statuses were correct; the
> prose was not. Corrected here rather than carried forward.

**Method note.** The critical gate now also counts a PARTIAL critical
requirement as a gap. Without that, implementing half of each critical control
would lift the 59.9 cap while none of them worked end to end — which is exactly
the arithmetic that produced the 90% figure this audit rejected.

**Ready for submission:** no.

### 7.1 What the portal round changed, requirement by requirement

Nothing below altered a status. The table exists so a reader can see exactly what was
added, where, and why it was not enough to move the number.

| Requirement | Before revision 4 | After revision 4 | Status |
|---|---|---|---|
| FN-05 Duplicate patient detection | Client-side warning on registration | Plus `UNIQUE (patient_id)`, `UNIQUE (login_identifier)`, refusal to attach an already-owned contact, and a review list of shared identifiers | PARTIAL |
| FN-06 Consent | Captured, not enforced | Unchanged; the portal is a new disclosure channel that does not consult consent, recorded as a caveat | PARTIAL |
| FN-17 Clinical summary | Visit-centred staff screen | Plus a patient-facing summary generated on request, no stored file | PARTIAL |
| SP-03 Authentication | Staff sessions only | Plus a second identity/session namespace for patients; patient tokens cannot satisfy staff routes | VERIFIED (unchanged) |
| SP-04 RBAC | 8 of 13 unguarded routes closed | Plus 38 portal routes, every one guarded; 5 legacy routes still open | PARTIAL |
| SP-05 Isolation | Four cross-facility leaks closed | Plus facility-scoped portal reads and a 404-not-403 rule for other facilities | PARTIAL |
| SP-06 Audit trail | Access logging on some reads | Plus eight patient read paths, admin actions, and auditing of audit reads; 0017 still unapplied | PARTIAL |
| SP-08 Encryption at rest | Two sealed identifier columns | Plus a sealed card code (hash for lookup, sealed copy for re-display); volume and backups unchanged | PARTIAL |
| SP-10 Brute force | Staff rate limits and lockout | Plus 10/15 min public limits and a per-account patient lock that cannot be used to enumerate | VERIFIED (unchanged) |

What the portal did **not** do, and must not be read into the rows above: it did not
apply a migration, run a query against PostgreSQL, send a message, prove facility
isolation with real rows, or close any of the eleven critical gaps.

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
- **The portal has never run.** Migration 0018 is unapplied, no portal query has
  been executed, concurrent invitation redemption has not been exercised, and there
  is no SMS or email provider, so no delivery has ever been attempted. The patient
  and administration screens were built and type-checked, not clicked.
- **The portal added processing the DPIA did not originally cover** — patient
  accounts, portal access logs, digital-card lookups and patient-initiated sharing
  grants. `DPIA_DRAFT.md` §7 now records it; the draft is still unsigned.

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
| `DPIA_DRAFT.md` | Populated draft, unsigned; §11 covers the portal |
| `../patient-portal/PATIENT_PORTAL_IMPLEMENTATION.md` | What the portal does, endpoint by endpoint |
| `../patient-portal/PATIENT_PORTAL_SECURITY_AUDIT.md` | Threat model, token handling, open legal questions |
| `../patient-portal/PATIENT_PORTAL_TEST_RESULTS.md` | What was executed, what was not |
| `../patient-portal/PATIENT_PORTAL_DATABASE_CHANGES.md` | Migration 0018 in full |
| `../patient-portal/PATIENT_PORTAL_DEPLOYMENT_GUIDE.md` | Preconditions and blockers |
