# Remediation Plan

**Date:** 21 October 2026 · **Revised:** 22 October 2026 (patient portal round)
**Basis:** `JALICARE_DHA_READINESS_AUDIT.md`, `SECURITY_PRIVACY_GAP_REGISTER.md`,
`INTEROPERABILITY_AUDIT.md`, `DATABASE_MIGRATION_AUDIT.md`

Ordered by risk, not by effort. "Owner" distinguishes what the engineering team
can close from what only the responsible organisation or DHA can close.

---

## P1 — Blocking a credible certification application

| ID | Action | Owner | Dependency | Evidence of completion |
|---|---|---|---|---|
| P1-1 | Finish the authorisation audit: every `Number(req.params.id)` route | Engineering | — | Each route either uses a scoped query or includes `facility_id` in the `WHERE`; a test per route. **Partly done** — seven more unguarded routes closed on 2026-10-21 (claims ×3, DHA ×3, departments); the 38 portal routes added on 2026-10-22 are all guarded and none takes a patient id from the request. Still no exhaustive pass over the legacy routes, and five of them remain unguarded |
| P1-2 | ODPC registration for the responsible legal entity | Organisation / DPO | Legal entity identified | Certificate number and role recorded |
| P1-3 | Review, sign and date the DPIA | DPO / responsible officer | `DPIA_DRAFT.md` | Signed document, version and date |
| P1-4 | Enable encryption at rest for database and backups | Hosting / DBA | Hosting decision | Provider configuration evidence |
| P1-5 | Implement and test backup + restore | Operations | Storage target | A restore performed into an isolated database, with timings recorded |
| P1-6 | Apply migration `0017`: append-only `audit_logs` triggers + `REVOKE` | DBA | Backup taken | **Written and tested statically; not applied.** An attempted `UPDATE` must fail after the migration |
| P1-7 | Patient consent capture | Engineering | — | **Done except enforcement.** Grant, list, revoke, derived status, patient-record tab and 80 assertions. Consent does **not** yet gate sharing or insurer submission — see P2-9 |
| P1-8 | Allergy recording and a prescribing warning | Engineering | Clinical sign-off on the matching rules | **Done except interactions.** Registry, 409 conflict, audited override, screen. No drug-drug interaction engine — see P2-10 |

**Why P1-1 is first:** it is the only item that can expose another facility's
patient data *today*. The other P1 items are gaps in readiness; this one is an
active risk.

---

## P2 — Required for the clinical claims to be true

| ID | Action | Owner | Notes |
|---|---|---|---|
| P2-1 | Server-side duplicate-patient rule + merge/reconciliation workflow | Engineering | The UI warning is not enough |
| P2-2 | Radiology and theatre automated tests | Engineering | These routes had no guard and no test; they now have the guard |
| P2-3 | ~~Record patient-record **views** in `patient_record_access_logs`~~ | Engineering | **Done 2026-10-21**: VIEW / UPDATE / FHIR EXPORT logged before the response; the mislabelled FHIR row removed |
| P2-4 | IDSR weekly return and MOH 705 aggregate | Engineering | Needs the official reporting specification; do not invent definitions |
| P2-5 | Submission outbox with status, retry and idempotency | Engineering | Prerequisite for any national reporting |
| P2-6 | DHA sandbox verification | Engineering + DHA | Blocked on credentials |
| P2-7 | MFA for privileged accounts | Engineering | Required before production DHA credentials |
| P2-8 | Terminate TLS in deployment and set `SQL_SSL=true` for remote databases | Operations | App serves no TLS |
| P2-9 | Make consent gate cross-facility sharing and insurer submission | Engineering + clinical governance | `hasActiveConsent()` is exposed; the policy decision is not an engineering default. Do **not** block the treating clinician's own access |
| P2-10 | Drug-drug interaction data | Clinical governance | Needs a licensed interaction dataset; name matching is not that, and the UI says so |
| P2-11 | Decide whether to encrypt further columns | Engineering + DPO | Names, phone numbers and dates of birth are still plaintext. Encrypting them breaks search unless every lookup moves to a blind index |
| P2-12 | Apply migration 0018 and exercise the portal against a real database | DBA then Engineering | Preconditions in `../patient-portal/PATIENT_PORTAL_DEPLOYMENT_GUIDE.md`; blockers B1, B2 and B7 must be closed first. Until then no portal query has ever run |
| P2-13 | A message channel for portal invitations | Facility / vendor | Blocker B3. There is no SMS or email provider. Until one exists, an invitation is handed over in person and the code is read to the patient — which is a staff action, not a proven delivery. Do not describe an unconfigured provider as sending |
| P2-14 | Consent must gate portal-initiated sharing | Engineering + clinical governance | The portal adds a new disclosure path. `patient_record_sharing_grants` currently records the patient's own instruction but does not consult the consent register; decide whether the patient's act of sharing is itself the basis, and record that decision. See `DPIA_DRAFT.md` §7.3 |
| P2-15 | Answer the portal questions in `DPIA_DRAFT.md` §7.3 | Organisation / DPO | Lawful basis, contact verification, minors and guardianship, retention, deceased patients, privacy notice. The portal must not be enabled for real patients before this is answered and the DPIA is signed |

---

## P3 — Completeness of the clinical record

| ID | Action | Notes |
|---|---|---|
| P3-1 | Family history | Schema + screen |
| P3-2 | Allied health: physiotherapy, occupational therapy, nutrition, social work, counselling | Five disciplines; a shared order/note model would cover them |
| P3-3 | BMI and paediatric growth charts | Derived from observations |
| P3-4 | Diagnoses: validate ICD-10 and persist a problem list | Currently free text |
| P3-5 | Clinical decision support | Needs clinical rules owned by a clinician |
| P3-6 | FHIR: Encounter, Condition, Observation, DiagnosticReport | Validate each |
| P3-7 | KNHTS / LOINC / ATC mapping | Blocked on terminology release files |
| P3-8 | Quality indicator set with denominators | Currently operational aggregates only |

---

## P4 — Hygiene

| ID | Action |
|---|---|
| P4-1 | Remove ~30 `*.bak` files from the working tree (never committed, but they clutter the tree) |
| P4-2 | Remove the now-unused `firebase` and `firebase-admin` dependencies from `package.json` |
| P4-3 | Delete the duplicate `app.get('/api/medications', …)` middleware-only declarations at `src/app.ts:240-242` |
| P4-4 | Add a CI job that runs `lint`, `build` and `test` on every push |
| P4-5 | Replace the `as never` / `Parameters<…>` casts in routes with schema-validated payloads (zod or equivalent) |

---

## Dependencies the project cannot resolve alone

| Dependency | Needed for | Who provides it |
|---|---|---|
| ODPC registration certificate | Legal compliance | Office of the Data Protection Commissioner via the responsible entity |
| Signed DPIA | Legal compliance | DPO / responsible officer |
| DHA client id, secret, facility registry code | Any real integration | DHA / AfyaConnect onboarding |
| DHA claim, line-item, diagnosis, pre-auth and remittance contracts | Claims submission | DHA published reference |
| IDSR and MOH 705 reporting specifications | Statutory returns | Ministry of Health / DHA |
| KNHTS terminology release | Coded diagnoses and medicines | DHA terminology service |
| Hosting encryption configuration | Encryption at rest | Hosting provider |
| Clinical rules for CDS and allergy interaction | Decision support | Clinical governance |

---

## Suggested sequence

1. **Week 1** — P1-1 (authorisation), P1-6 (audit immutability, after backup).
2. **Weeks 1–2** — P1-4, P1-5, P2-8 with the hosting team.
3. **Weeks 2–4** — P1-7, P1-8, P2-1 with clinical input.
3a. **Before any patient is invited to the portal** — P2-12, P2-13, P2-14, P2-15.
4. **In parallel** — the organisation starts P1-2 and P1-3; both have lead times
   outside engineering's control.
5. **When credentials arrive** — P2-6, then P2-4/P2-5 once specifications are in hand.

Dates are deliberately absent. A date invented here would be a promise the
engineering team cannot keep on behalf of DHA or the ODPC.

---

## How progress is measured

Not by a percentage. By the register:

```bash
npx tsx -e "import {buildDhaScore} from './src/compliance/dha-score.ts'; console.log(buildDhaScore().overallScore)"
```

The figure moves only when a requirement's status changes, and a status changes
only when its evidence does. The critical gate prevents a rising average from
burying P1-2 and P1-3.

The portal round is the demonstration: nine requirement rows gained evidence, the
test count rose by 208 assertions, and the score stayed at
45.5% because no critical gap was closed. A future reader who sees the score
unchanged should read that as the measure working, not as work not happening.
